// @ts-check
/**
 * ai-map-lib.mjs — the export lines in `docs/AI_MAP.md`, generated from the code.
 *
 * An AI_MAP entry is a module's `###` heading and its export list; what the module is for, and where its
 * rules live, is its FILE_INDEX row (the hand-written cards went on 25 Nov 2026). The export list is
 * read from the module here, so it cannot drift from the code. That is the whole
 * reason the map's export lists stopped being prose (17 Nov 2026) — the hand-kept lists had become a
 * second copy of every module's surface, kept current by a pre-commit nag.
 *
 * Used by `npm run generate:ai-map` (scripts/generate-ai-map.mjs), which rewrites the lines, and by
 * `doc-parity.test.mjs`, which fails when they are stale. One renderer, so the two cannot disagree.
 *
 * THE LINE FORMAT, owned here and nowhere else:
 *   - **Exports:** `a` · `b`                 one module in the heading
 *   - **Exports of `x.js`:** `a` · `b`       a heading that names several modules, one line each
 *   - **Exports:** none                       a module with no exports (a boot shim, the worker)
 * The lines always sit at the END of the entry: the generator removes every existing export line in
 * an entry and appends fresh ones, so hand-written text above them is never touched.
 */

/** A generated export line, in any of its forms. */
export const EXPORT_LINE = /^- \*\*Exports(?: of `[^`]+`)?:\*\* .*$/;

/**
 * The names an ES module exports, in source order: `export function|const|let|var|class NAME` and
 * `export { a, b as c }` (re-exports included — they are part of the surface the page imports).
 * @param {string} src
 * @returns {string[]}
 */
export function esmExports(src) {
    const found = [];
    const re = /^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z0-9_$]+)|^export\s*\{([^}]*)\}/gm;
    for (const m of src.matchAll(re)) {
        if (m[1]) { found.push(m[1]); continue; }
        for (const part of m[2].replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').split(',')) {
            const seg = part.trim();
            if (!seg) continue;
            const as = seg.match(/\bas\s+([A-Za-z0-9_$]+)/);
            const name = as ? as[1] : seg.split(/\s+/)[0];
            if (name && name !== 'default' && /^[A-Za-z_$]/.test(name)) found.push(name);
        }
    }
    return [...new Set(found)];
}

/**
 * The names a CommonJS Functions module exports: the keys of `module.exports = { … }` and every
 * `exports.NAME =`. `functions/index.js` also merges builders' endpoints in with
 * `Object.assign(exports, buildX(…))`; those cannot be read statically, so the builder is named
 * instead (`builders`).
 * @param {string} src
 * @returns {{ names: string[], builders: string[] }}
 */
export function cjsExports(src) {
    const names = [];
    const block = src.match(/^module\.exports\s*=\s*\{([\s\S]*?)^\};?/m) || src.match(/^module\.exports\s*=\s*\{([^}]*)\}/m);
    if (block) {
        const body = block[1].replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
        for (const part of body.split(',')) {
            const seg = part.trim();
            if (!seg) continue;
            const key = seg.match(/^([A-Za-z_$][\w$]*)/);
            if (key) names.push(key[1]);
        }
    }
    for (const m of src.matchAll(/^exports\.([A-Za-z_$][\w$]*)\s*=/gm)) names.push(m[1]);
    const builders = [...src.matchAll(/^Object\.assign\(exports,\s*(build[A-Za-z]+)\(/gm)].map(m => m[1]);
    return { names: [...new Set(names)], builders: [...new Set(builders)] };
}

/**
 * The export line(s) for one module.
 * @param {string} path      repo-relative, as the heading names it (`functions/push.js`, `ls.js`)
 * @param {string} src
 * @param {boolean} grouped  the heading names more than one module
 */
export function exportLine(path, src, grouped) {
    const label = grouped ? `- **Exports of \`${path}\`:**` : '- **Exports:**';
    let names, tail = '';
    if (path.startsWith('functions/')) {
        const { names: n, builders } = cjsExports(src);
        names = n;
        if (builders.length) tail = ` · and every endpoint ${builders.map(b => `\`${b}\``).join(', ')} returns`;
    } else {
        names = esmExports(src);
    }
    if (!names.length && !tail) return `${label} none`;
    return `${label} ${names.map(n => `\`${n}\``).join(' · ')}${tail}`;
}

/** The modules a `###` heading names that carry an export line: `.js` files, root or `functions/`. */
export function headingModules(heading) {
    return [...heading.matchAll(/`((?:functions\/)?[A-Za-z0-9_.-]+\.js)`/g)].map(m => m[1]);
}

/**
 * The map with every entry's export lines regenerated. Text outside the "File responsibilities"
 * entries is returned unchanged.
 * @param {string} map
 * @param {(path: string) => string} readSource  throws for a file that does not exist
 * @returns {string}
 */
export function renderAiMap(map, readSource) {
    const lines = map.split('\n');
    /** @type {string[]} */
    const out = [];
    /** @type {string[] | null} */
    let entry = null;
    /** @type {string[]} */
    let mods = [];
    const flush = () => {
        if (!entry) return;
        const body = entry.filter(l => !EXPORT_LINE.test(l));
        let end = body.length;
        while (end > 1 && (body[end - 1].trim() === '' || body[end - 1].trim() === '---')) end--;
        const gen = mods.map(m => exportLine(m, readSource(m), mods.length > 1));
        out.push(...body.slice(0, end), ...gen, ...body.slice(end));
        entry = null;
    };
    for (const line of lines) {
        if (line.startsWith('### ')) {
            flush();
            entry = [line];
            mods = headingModules(line);
        } else if (line.startsWith('## ')) {
            flush();
            out.push(line);
        } else if (entry) {
            entry.push(line);
        } else {
            out.push(line);
        }
    }
    flush();
    return out.join('\n');
}
