// @ts-check
/**
 * test-fixtures/xlsx-write.mjs — a real, openable .xlsx, built by hand, for the leave-file tests.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 *
 * `scripts/make-leave-file.mjs` reads the clerks' annual-leave workbook, and the real workbook can
 * never be a fixture: it names every colleague against their leave, `.xlsx` is gitignored, and the
 * Pages mirror serves whatever is committed. So the tests BUILD a workbook at run time, with
 * invented people, dates and figures, and drive the real reader (`scripts/xlsx-read.mjs`) at it.
 *
 * A mock that handed the method ready-made cells would prove the method and nothing about the
 * reading — and every rule the method follows was learnt from a READING going wrong: comments
 * merged across sheets, a decoy calendar chosen by its name, a phonetic run read as text
 * (docs/AL_WORKBOOK.md §2, §6). So this writes the parts Excel writes, wired the way Excel wires
 * them: sheets reached through `xl/_rels/workbook.xml.rels`, each sheet's threaded comments and
 * notes through ITS OWN `_rels` file, the comment parts numbered DIFFERENTLY from the sheets (as
 * they are in the real file, where the totals sheet is `sheet22.xml` and its thread
 * `threadedComment15.xml`), text in shared strings, and a zip with real CRCs.
 *
 * ── WHAT IT COVERS ──────────────────────────────────────────────────────────────────────────────
 *
 *   · cells: text (through the shared strings), an inline string, a rich-text shared string with a
 *     phonetic (`rPh`) run that a reader must leave out, numbers (date serials), and formulas with
 *     their cached value;
 *   · per sheet: threaded comments (a root and its replies, linked by `parentId`, each with a
 *     `personId` from `xl/persons/person.xml`) and legacy notes (`xl/commentsN.xml`). Every thread
 *     ALSO gets the legacy note Excel writes beside it for older versions — its placeholder sentence,
 *     then `Comment:` and each `Reply:` (the shape AL_WORKBOOK.md §5 measured) — because the real
 *     file has one on every column-E thread. Read INSTEAD of the thread, it is one entry where the
 *     thread is several: a joiner's `START…` root would take its replies' dates down with it;
 *   · `docProps/core.xml` — the last save and who made it;
 *   · damage on request, for the reader's refusals: a central-directory CRC that does not match, an
 *     uncompressed size the reader must refuse before it inflates anything, or a compression method
 *     it does not know.
 *
 * Nothing here is app code and nothing imports it at runtime. It requires nothing but node:zlib.
 */
import { deflateRawSync, crc32 } from 'node:zlib';

/**
 * @typedef {string|number|null
 *   |{ f: string, v?: number|string|null }
 *   |{ inline: string }
 *   |{ rich: Array<{ t: string, rPh?: boolean }> }} CellSpec
 * @typedef {{ text: string, person: string, reply?: boolean }} ThreadEntry
 * @typedef {{ name: string, cells: Record<string, CellSpec>,
 *             threaded?: Record<string, ThreadEntry[]>, notes?: Record<string, string> }} SheetSpec
 * @typedef {{ sheets: SheetSpec[], date1904?: boolean,
 *             core?: { modified?: string|null, lastModifiedBy?: string|null } }} WorkbookSpec
 * @typedef {{ method?: 0|8, badCrc?: string, claimSize?: { name: string, size: number },
 *             claimMethod?: { name: string, method: number } }} ZipDamage
 */

/**
 * A placeholder of the kind Excel puts in the legacy note of a threaded comment, for versions without
 * threads. Only its shape is relied on: it is words, with no date and no "start" in it.
 */
export const THREAD_NOTE_PLACEHOLDER = '[Threaded comment]\n\nYour version of Excel allows you to read this threaded comment; '
    + 'however, any edits to it will get removed if the file is opened in a newer version of Excel. '
    + 'Learn more: https://go.microsoft.com/fwlink/?linkid=870924';

/**
 * Excel's legacy copy of a thread: the placeholder, then `Comment:` and each `Reply:` with its text
 * indented beneath. Written beside every thread here, and on its own for a test of a workbook where
 * only the copy survives.
 * @param {Array<{ text: string, reply?: boolean }>} list
 */
export function legacyThreadNote(list) {
    return `${THREAD_NOTE_PLACEHOLDER}\n\n` + list.map(e => `${e.reply ? 'Reply' : 'Comment'}:\n    ${e.text}`).join('\n');
}

/** XML text and attribute escaping — a name with `&` or `'` must survive the round trip. */
export function esc(/** @type {string} */ s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** 1-based column number → letters (1 → A, 27 → AA). @param {number} n */
export function colLetters(n) {
    let s = '';
    for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
    return s;
}
/** @param {string} col */
const colNum = col => [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

/**
 * The Excel date serial of an ISO date (the 1900 system unless `date1904`).
 * @param {string} iso @param {boolean} [date1904]
 */
export function isoToSerial(iso, date1904 = false) {
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
    return Math.round((Date.parse(`${iso}T00:00:00Z`) - epoch) / 86_400_000);
}

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NS_TC = 'http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments';
const REL_SHEET = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';
const REL_SST = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings';
const REL_TC = 'http://schemas.microsoft.com/office/2017/10/relationships/threadedComment';
const REL_NOTES = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const REL_PERSON = 'http://schemas.microsoft.com/office/2017/10/relationships/person';

/**
 * Build a workbook's bytes from a spec.
 * @param {WorkbookSpec} spec
 * @param {ZipDamage} [damage]
 * @returns {Buffer}
 */
export function buildXlsx(spec, damage = {}) {
    /** @type {Array<[string, string]>} */ const parts = [];
    /** @type {string[]} */ const sst = [];
    /** @type {Map<string, number>} */ const sstIndex = new Map();
    const shared = (/** @type {string} */ xml, /** @type {string} */ key) => {
        if (!sstIndex.has(key)) { sstIndex.set(key, sst.length); sst.push(xml); }
        return /** @type {number} */ (sstIndex.get(key));
    };

    // People who write threaded comments, by display name, given stable ids.
    /** @type {Map<string, string>} */ const personId = new Map();
    for (const s of spec.sheets) for (const list of Object.values(s.threaded ?? {})) for (const e of list) {
        if (!personId.has(e.person)) personId.set(e.person, `{0000000${personId.size + 1}-AAAA-BBBB-CCCC-DDDDDDDDDDDD}`);
    }

    const n = spec.sheets.length;
    let tcCount = 0, noteCount = 0;
    spec.sheets.forEach((s, i) => {
        // Rows of cells, in order.
        /** @type {Map<number, Array<[number, string]>>} */ const rows = new Map();
        for (const [ref, value] of Object.entries(s.cells)) {
            const m = /^([A-Z]+)(\d+)$/.exec(ref);
            if (!m) throw new Error(`bad ref ${ref}`);
            const r = Number(m[2]), c = colNum(m[1]);
            let xml;
            if (value === null || value === undefined) continue;
            if (typeof value === 'number') xml = `<c r="${ref}"><v>${value}</v></c>`;
            else if (typeof value === 'string') xml = `<c r="${ref}" t="s"><v>${shared(`<si><t xml:space="preserve">${esc(value)}</t></si>`, `t:${value}`)}</v></c>`;
            else if ('f' in value) {
                const v = value.v;
                const t = typeof v === 'string' ? ' t="str"' : '';
                xml = `<c r="${ref}"${t}><f>${esc(value.f)}</f>${v === null || v === undefined ? '' : `<v>${esc(String(v))}</v>`}</c>`;
            } else if ('inline' in value) xml = `<c r="${ref}" t="inlineStr"><is><t>${esc(value.inline)}</t></is></c>`;
            else {
                const runs = value.rich.map(run => (run.rPh
                    ? `<rPh sb="0" eb="1"><t>${esc(run.t)}</t></rPh>`
                    : `<r><rPr><b/></rPr><t xml:space="preserve">${esc(run.t)}</t></r>`)).join('');
                xml = `<c r="${ref}" t="s"><v>${shared(`<si>${runs}<phoneticPr fontId="1"/></si>`, `r:${JSON.stringify(value.rich)}`)}</v></c>`;
            }
            if (!rows.has(r)) rows.set(r, []);
            /** @type {Array<[number, string]>} */ (rows.get(r)).push([c, xml]);
        }
        const sheetData = [...rows.keys()].sort((a, b) => a - b)
            .map(r => `<row r="${r}">${/** @type {Array<[number, string]>} */ (rows.get(r)).sort((a, b) => a[0] - b[0]).map(x => x[1]).join('')}</row>`)
            .join('');
        parts.push([`xl/worksheets/sheet${i + 1}.xml`,
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheetData>${sheetData}</sheetData></worksheet>`]);

        // This sheet's own comments, numbered from the END so they never share a sheet's number.
        /** @type {string[]} */ const rels = [];
        const threads = Object.entries(s.threaded ?? {});
        if (threads.length) {
            const k = n - tcCount++;
            let id = 0;
            const body = threads.map(([ref, list]) => {
                let root = '';
                return list.map(e => {
                    const cid = `{C${String(i + 1).padStart(3, '0')}${String(++id).padStart(5, '0')}-0000-0000-0000-000000000000}`;
                    if (!e.reply) root = cid;
                    return `<threadedComment ref="${ref}" dT="2026-01-01T09:00:00.00" personId="${personId.get(e.person)}" id="${cid}"${e.reply ? ` parentId="${root}"` : ''}><text>${esc(e.text)}</text></threadedComment>`;
                }).join('');
            }).join('');
            parts.push([`xl/threadedComments/threadedComment${k}.xml`,
                `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<ThreadedComments xmlns="${NS_TC}">${body}</ThreadedComments>`]);
            rels.push(`<Relationship Id="rId${rels.length + 1}" Type="${REL_TC}" Target="../threadedComments/threadedComment${k}.xml"/>`);
        }
        // Excel's own legacy copy of each thread, unless the spec gives that ref a note of its own.
        /** @type {Record<string, string>} */ const threadNotes = {};
        for (const [ref, list] of threads) threadNotes[ref] = legacyThreadNote(list);
        const notes = Object.entries({ ...threadNotes, ...(s.notes ?? {}) });
        if (notes.length) {
            const k = n - noteCount++;
            const body = notes.map(([ref, text]) => `<comment ref="${ref}" authorId="0" shapeId="0"><text><r><t xml:space="preserve">${esc(text)}</t></r></text></comment>`).join('');
            parts.push([`xl/comments${k}.xml`,
                `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<comments xmlns="${NS_MAIN}"><authors><author>Clerk</author></authors><commentList>${body}</commentList></comments>`]);
            rels.push(`<Relationship Id="rId${rels.length + 1}" Type="${REL_NOTES}" Target="../comments${k}.xml"/>`);
        }
        if (rels.length) {
            parts.push([`xl/worksheets/_rels/sheet${i + 1}.xml.rels`,
                `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS_PKG}">${rels.join('')}</Relationships>`]);
        }
    });

    const sheetsXml = spec.sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
    parts.push(['xl/workbook.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">${spec.date1904 ? '<workbookPr date1904="1"/>' : '<workbookPr/>'}<sheets>${sheetsXml}</sheets></workbook>`]);
    const wbRels = spec.sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL_SHEET}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
        + `<Relationship Id="rId${n + 1}" Type="${REL_SST}" Target="sharedStrings.xml"/>`
        + (personId.size ? `<Relationship Id="rId${n + 2}" Type="${REL_PERSON}" Target="persons/person.xml"/>` : '');
    parts.push(['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS_PKG}">${wbRels}</Relationships>`]);
    parts.push(['xl/sharedStrings.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="${NS_MAIN}" count="${sst.length}" uniqueCount="${sst.length}">${sst.join('')}</sst>`]);
    if (personId.size) {
        const persons = [...personId].map(([name, id]) => `<person displayName="${esc(name)}" id="${id}" userId="${esc(name)}" providerId="None"/>`).join('');
        parts.push(['xl/persons/person.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<personList xmlns="${NS_TC}">${persons}</personList>`]);
    }
    const core = spec.core ?? {};
    parts.push(['docProps/core.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
        + (core.lastModifiedBy ? `<cp:lastModifiedBy>${esc(core.lastModifiedBy)}</cp:lastModifiedBy>` : '')
        + (core.modified ? `<dcterms:modified xsi:type="dcterms:W3CDTF">${esc(core.modified)}</dcterms:modified>` : '')
        + '</cp:coreProperties>']);
    parts.push(['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS_PKG}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`]);
    parts.unshift(['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>']);
    return zip(parts.map(([name, text]) => [name, Buffer.from(text, 'utf8')]), damage);
}

/**
 * A zip of the entries given, deflated (or stored), with every CRC computed — and damaged only
 * where `damage` asks.
 * @param {Array<[string, Buffer]>} entries @param {ZipDamage} damage
 * @returns {Buffer}
 */
export function zip(entries, damage = {}) {
    const method = damage.method ?? 8;
    /** @type {Buffer[]} */ const locals = [];
    /** @type {Buffer[]} */ const central = [];
    let offset = 0;
    for (const [name, data] of entries) {
        const nameBuf = Buffer.from(name, 'utf8');
        const body = method === 8 ? deflateRawSync(data) : data;
        const crc = damage.badCrc === name ? (crc32(data) ^ 0xffffffff) >>> 0 : crc32(data);
        const usize = damage.claimSize?.name === name ? damage.claimSize.size : data.length;
        const said = damage.claimMethod?.name === name ? damage.claimMethod.method : method;
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x0800, 6);           // names are UTF-8
        local.writeUInt16LE(said, 8);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(body.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        locals.push(local, nameBuf, body);
        const cd = Buffer.alloc(46);
        cd.writeUInt32LE(0x02014b50, 0);
        cd.writeUInt16LE(20, 4);
        cd.writeUInt16LE(20, 6);
        cd.writeUInt16LE(0x0800, 8);
        cd.writeUInt16LE(said, 10);
        cd.writeUInt32LE(crc, 16);
        cd.writeUInt32LE(body.length, 20);
        cd.writeUInt32LE(usize >>> 0, 24);
        cd.writeUInt16LE(nameBuf.length, 28);
        cd.writeUInt32LE(offset, 42);
        central.push(cd, nameBuf);
        offset += 30 + nameBuf.length + body.length;
    }
    const cdBuf = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(cdBuf.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, cdBuf, end]);
}
