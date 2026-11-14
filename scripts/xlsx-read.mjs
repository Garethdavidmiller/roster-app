// @ts-check
/**
 * xlsx-read.mjs — just enough of an .xlsx reader for the clerks' annual-leave workbook, with no
 * dependency: Node's own zlib for the zip, and a small scanner for the XML inside it.
 *
 * ── WHY NOT A LIBRARY ──────────────────────────────────────────────────────────────────────────
 *
 * Every earlier reading of the workbook used Python and openpyxl, which is not a project dependency
 * and no CI lane runs (docs/AL_WORKBOOK.md §6). The leave file's rules live in a JavaScript module
 * shared with the app (al-leave-file.js), so the reader that feeds them is JavaScript too — one
 * implementation, tested where the rest is. A spreadsheet library would be a new runtime dependency
 * for one session-side script (CLAUDE.md: a discuss-first decision); the format here is narrow and
 * machine-written, and this file reads only the parts the method needs.
 *
 * ── WHAT IT READS, AND WHAT IT REFUSES ─────────────────────────────────────────────────────────
 *
 * Sheet names and their parts (through the relationships, never by guessing a file name — §6),
 * cells (values and formula text), shared strings (phonetic runs left out, as Excel shows them),
 * the threaded comments and the legacy notes of a sheet (scoped to THAT sheet through its own
 * relationships: reading every comment file into one map once invented a day of leave, §6), the
 * people who wrote threaded comments, and docProps/core.xml (the last save, and who made it).
 *
 * The workbook is UNTRUSTED input. Sizes are capped before and during inflation, every entry's
 * CRC is checked, and a structure this reader does not know is refused with a message that names the
 * PART, never a cell's content: the content is colleagues' names against their leave.
 */
import { inflateRawSync, crc32 } from 'node:zlib';

const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;

/** @param {string} msg */
const refuse = msg => Object.assign(new Error(`xlsx: ${msg}`), { code: 'XLSX_REFUSED' });

// ── The zip ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Every entry of a zip, by name, inflated on demand.
 * @param {Buffer} buf
 * @returns {Map<string, () => Buffer>}
 */
export function readZip(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 22) throw refuse('not a zip file');
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw refuse('not a zip file (no end record)');
    const count = buf.readUInt16LE(eocd + 10);
    const cdSize = buf.readUInt32LE(eocd + 12);
    const cdOffset = buf.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdOffset === 0xffffffff || cdOffset + cdSize > buf.length) throw refuse('zip64 or damaged directory');
    /** @type {Map<string, () => Buffer>} */
    const entries = new Map();
    let total = 0;
    let p = cdOffset;
    for (let n = 0; n < count; n++) {
        if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw refuse('damaged central directory');
        const flags = buf.readUInt16LE(p + 8);
        const method = buf.readUInt16LE(p + 10);
        const crc = buf.readUInt32LE(p + 16);
        const csize = buf.readUInt32LE(p + 20);
        const usize = buf.readUInt32LE(p + 24);
        const nameLen = buf.readUInt16LE(p + 28);
        const extraLen = buf.readUInt16LE(p + 30);
        const commentLen = buf.readUInt16LE(p + 32);
        const local = buf.readUInt32LE(p + 42);
        const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
        p += 46 + nameLen + extraLen + commentLen;
        if (flags & 1) throw refuse(`encrypted entry ${name}`);
        if (usize > MAX_ENTRY_BYTES) throw refuse(`entry too large: ${name}`);
        total += usize;
        if (total > MAX_TOTAL_BYTES) throw refuse('archive too large');
        if (method !== 0 && method !== 8) throw refuse(`unsupported compression in ${name}`);
        entries.set(name, () => {
            if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw refuse(`damaged entry ${name}`);
            const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
            if (start + csize > buf.length) throw refuse(`truncated entry ${name}`);
            const raw = buf.subarray(start, start + csize);
            const out = method === 0 ? Buffer.from(raw) : inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES });
            if (out.length !== usize || crc32(out) !== crc) throw refuse(`checksum mismatch in ${name}`);
            return out;
        });
    }
    return entries;
}

// ── A small XML scanner ─────────────────────────────────────────────────────────────────────────

/**
 * @typedef {{ name: string, attrs: Record<string, string>, children: XmlNode[], text: string }} XmlNode
 */

const ENTITY = /&(?:#x([0-9a-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos));/g;
const NAMED = /** @type {Record<string,string>} */ ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" });
/** @param {string} s */
const decode = s => s.replace(ENTITY, (_m, hex, dec, named) =>
    named ? NAMED[named] : String.fromCodePoint(parseInt(hex ?? dec, hex ? 16 : 10)));
/** Excel's own escape for characters XML cannot carry, e.g. `_x000D_` (a carriage return). */
const unescapeExcel = (/** @type {string} */ s) => s.replace(/_x([0-9A-Fa-f]{4})_/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
/** @param {string} qname */
const local = qname => qname.slice(qname.indexOf(':') + 1);

/**
 * Parse XML into a light tree. Element names lose their namespace prefix; attributes keep theirs
 * (`r:id`). Text is decoded and kept on the element that holds it. Machine-written OOXML is
 * well-formed, and anything that is not is refused.
 * @param {string} xml
 * @returns {XmlNode}
 */
export function parseXml(xml) {
    /** @type {XmlNode} */
    const root = { name: '#root', attrs: {}, children: [], text: '' };
    const stack = [root];
    const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
    let m;
    while ((m = re.exec(xml))) {
        const top = stack[stack.length - 1];
        if (m[1] !== undefined) { top.text += m[1]; continue; }
        if (m[6] !== undefined) { top.text += decode(m[6]); continue; }
        if (m[3] === undefined) continue;                     // comment, declaration, doctype
        const name = local(m[3]);
        if (m[2] === '/') {
            if (top.name !== name) throw refuse('malformed XML');
            stack.pop();
            continue;
        }
        /** @type {Record<string,string>} */
        const attrs = {};
        for (const a of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] ?? a[3]);
        /** @type {XmlNode} */
        const node = { name, attrs, children: [], text: '' };
        top.children.push(node);
        if (m[5] !== '/') stack.push(node);
    }
    if (stack.length !== 1) throw refuse('malformed XML (unclosed element)');
    return root;
}

/** @param {XmlNode} node @param {string} name @returns {XmlNode[]} every descendant with that local name */
export function findAll(node, name) {
    /** @type {XmlNode[]} */ const out = [];
    const walk = (/** @type {XmlNode} */ n) => { for (const c of n.children) { if (c.name === name) out.push(c); walk(c); } };
    walk(node);
    return out;
}
/** @param {XmlNode} node @param {string} name */
const child = (node, name) => node.children.find(c => c.name === name) ?? null;

/** The text of a string item: its `t`, or its runs' `t`s — never the phonetic guide (`rPh`). */
function stringItemText(/** @type {XmlNode} */ si) {
    let s = '';
    for (const c of si.children) {
        if (c.name === 't') s += c.text;
        else if (c.name === 'r') for (const t of c.children) if (t.name === 't') s += t.text;
    }
    return unescapeExcel(s);
}

// ── Cell references ─────────────────────────────────────────────────────────────────────────────

/** @param {string} col letters @returns {number} 1-based */
export function colNumber(col) {
    let n = 0;
    for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n;
}
/** @param {string} ref e.g. `E12` @returns {{ col: string, row: number }} */
export function splitRef(ref) {
    const m = /^\$?([A-Z]{1,3})\$?(\d+)$/.exec(ref);
    if (!m) throw refuse(`unexpected cell reference ${ref}`);
    return { col: m[1], row: Number(m[2]) };
}

// ── The workbook ────────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {{ v: string|number|boolean|null, f: string|null, shared: boolean }} Cell
 * @typedef {{ name: string, path: string, cells: Map<string, Cell>,
 *             threaded: Map<string, Array<{ id: string, parentId: string|null, personId: string|null, text: string }>>,
 *             notes: Map<string, string> }} Sheet
 */

/** @param {string} base a part's directory, e.g. `xl/worksheets/` @param {string} target */
function resolvePart(base, target) {
    if (target.startsWith('/')) return target.slice(1);
    const parts = (base + target).split('/');
    /** @type {string[]} */ const out = [];
    for (const p of parts) { if (p === '..') out.pop(); else if (p !== '.' && p !== '') out.push(p); }
    return out.join('/');
}

/**
 * Open a workbook.
 * @param {Buffer} buf the .xlsx file's bytes
 * @returns {{ sheetNames: string[], date1904: boolean,
 *             props: { modified: string|null, lastModifiedBy: string|null },
 *             persons: Map<string, string>, sheet: (name: string) => Sheet }}
 */
export function readXlsx(buf) {
    const zip = readZip(buf);
    const text = (/** @type {string} */ name) => {
        const get = zip.get(name);
        if (!get) throw refuse(`missing part ${name}`);
        return get().toString('utf8');
    };
    const has = (/** @type {string} */ name) => zip.has(name);

    const wb = parseXml(text('xl/workbook.xml'));
    const rels = new Map(findAll(parseXml(text('xl/_rels/workbook.xml.rels')), 'Relationship')
        .map(r => [r.attrs.Id, r.attrs.Target]));
    /** @type {Map<string, string>} sheet name → part path */
    const sheetPath = new Map();
    for (const s of findAll(wb, 'sheet')) {
        const target = rels.get(s.attrs['r:id']);
        if (!target) throw refuse('a sheet with no part');
        sheetPath.set(s.attrs.name, resolvePart('xl/', target));
    }
    const pr = findAll(wb, 'workbookPr')[0];
    const date1904 = pr ? ['1', 'true'].includes(pr.attrs.date1904 ?? '') : false;

    /** @type {string[]} */
    const shared = has('xl/sharedStrings.xml') ? findAll(parseXml(text('xl/sharedStrings.xml')), 'si').map(stringItemText) : [];

    const props = { modified: /** @type {string|null} */ (null), lastModifiedBy: /** @type {string|null} */ (null) };
    if (has('docProps/core.xml')) {
        const core = parseXml(text('docProps/core.xml'));
        props.modified = findAll(core, 'modified')[0]?.text.trim() || null;
        props.lastModifiedBy = findAll(core, 'lastModifiedBy')[0]?.text.trim() || null;
    }

    /** @type {Map<string, string>} person id → display name, across the workbook */
    const persons = new Map();
    for (const name of zip.keys()) {
        if (!/^xl\/persons\/[^/]+\.xml$/.test(name)) continue;
        for (const p of findAll(parseXml(text(name)), 'person')) persons.set(p.attrs.id, p.attrs.displayName ?? '');
    }

    /** @type {Map<string, Sheet>} */
    const cache = new Map();
    /** @param {string} name @returns {Sheet} */
    function sheet(name) {
        const hit = cache.get(name);
        if (hit) return hit;
        const path = sheetPath.get(name);
        if (!path) throw refuse('no such sheet');
        const xml = parseXml(text(path));
        /** @type {Map<string, Cell>} */
        const cells = new Map();
        for (const c of findAll(xml, 'c')) {
            const ref = c.attrs.r;
            if (!ref) throw refuse(`a cell with no reference in ${path}`);
            const t = c.attrs.t ?? 'n';
            const vNode = child(c, 'v');
            const fNode = child(c, 'f');
            /** @type {string|number|boolean|null} */ let v = null;
            if (t === 's') v = vNode ? (shared[Number(vNode.text)] ?? null) : null;
            else if (t === 'inlineStr') { const is = child(c, 'is'); v = is ? stringItemText(is) : ''; }
            else if (t === 'str' || t === 'e' || t === 'd') v = vNode ? unescapeExcel(vNode.text) : null;
            else if (t === 'b') v = vNode ? vNode.text === '1' : null;
            else if (vNode && vNode.text !== '') { const n = Number(vNode.text); v = Number.isFinite(n) ? n : null; }
            cells.set(ref, { v, f: fNode && fNode.text ? fNode.text : null, shared: !!fNode && fNode.attrs.t === 'shared' });
        }
        // This sheet's OWN comments, through its own relationships (§6: never by file name).
        const relName = path.replace(/([^/]+)$/, '_rels/$1.rels');
        /** @type {Sheet['threaded']} */ const threaded = new Map();
        /** @type {Map<string, string>} */ const notes = new Map();
        if (has(relName)) {
            const dir = path.replace(/[^/]+$/, '');
            for (const r of findAll(parseXml(text(relName)), 'Relationship')) {
                const type = r.attrs.Type ?? '';
                const part = resolvePart(dir, r.attrs.Target ?? '');
                if (/\/threadedComment$/.test(type)) {
                    for (const tc of findAll(parseXml(text(part)), 'threadedComment')) {
                        const tNode = child(tc, 'text');
                        const list = threaded.get(tc.attrs.ref) ?? [];
                        list.push({ id: tc.attrs.id ?? '', parentId: tc.attrs.parentId ?? null, personId: tc.attrs.personId ?? null,
                                    text: tNode ? unescapeExcel(tNode.text) : '' });
                        threaded.set(tc.attrs.ref, list);
                    }
                } else if (/\/comments$/.test(type)) {
                    for (const cm of findAll(parseXml(text(part)), 'comment')) {
                        const tNode = child(cm, 'text');
                        notes.set(cm.attrs.ref, tNode ? stringItemText(tNode) : '');
                    }
                }
            }
        }
        const out = { name, path, cells, threaded, notes };
        cache.set(name, out);
        return out;
    }

    return { sheetNames: [...sheetPath.keys()], date1904, props, persons, sheet };
}

/**
 * An Excel date serial as an ISO date. Whole days only: a time of day on a calendar date is refused.
 * @param {unknown} serial @param {boolean} date1904 @returns {string|null}
 */
export function serialToIso(serial, date1904) {
    if (typeof serial !== 'number' || !Number.isInteger(serial) || serial < 1) return null;
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
    return new Date(epoch + serial * 86_400_000).toISOString().slice(0, 10);
}
