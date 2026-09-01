// Geometry-first roster extraction: assign every text run to a physical (row, column) cell.
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync } from 'node:fs';

const DAYS = ['sun','mon','tue','wed','thu','fri','sat'];

/** Every vertical and horizontal rule actually drawn on the page. */
function rulesOf(ops) {
    const vx = new Set(), hy = new Set();
    for (let i = 0; i < ops.fnArray.length; i++) {
        if (ops.fnArray[i] !== OPS.constructPath) continue;
        const [fns, args] = ops.argsArray[i];
        let a = 0, cx = 0, cy = 0, sx = 0, sy = 0;
        for (const fn of fns) {
            if (fn === OPS.moveTo)      { cx = args[a]; cy = args[a+1]; sx = cx; sy = cy; a += 2; }
            else if (fn === OPS.lineTo) {
                const nx = args[a], ny = args[a+1]; a += 2;
                if (Math.abs(nx - cx) < 0.6 && Math.abs(ny - cy) > 3) vx.add(+((nx+cx)/2).toFixed(1));
                if (Math.abs(ny - cy) < 0.6 && Math.abs(nx - cx) > 3) hy.add(+((ny+cy)/2).toFixed(1));
                cx = nx; cy = ny;
            }
            else if (fn === OPS.curveTo)   { a += 6; }
            else if (fn === OPS.rectangle) { a += 4; }
            else if (fn === OPS.closePath) { cx = sx; cy = sy; }
        }
    }
    const cluster = (arr, tol) => {
        const out = [];
        for (const v of [...arr].sort((a, b) => a - b)) {
            if (out.length && Math.abs(v - out[out.length - 1]) <= tol) continue;
            out.push(v);
        }
        return out;
    };
    return { vx: cluster(vx, 2), hy: cluster(hy, 2) };
}

const doc = await getDocument({ data: new Uint8Array(readFileSync(process.argv[2])), useSystemFonts: true }).promise;
const out = [];
for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    if (!tc.items.length) continue;
    const { vx, hy } = rulesOf(await page.getOperatorList());
    if (vx.length !== 9) { console.error(`page ${p}: ${vx.length} vertical rules — not the 9-column grid`); continue; }

    // Rows: the horizontal rules, descending. A member's row is between two of them.
    const rows = [...hy].sort((a, b) => b - a);
    /** @type {Map<number, {name: string[], cells: string[][]}>} */
    const byRow = new Map();
    for (const it of tc.items) {
        const s = it.str.trim();
        if (!s) continue;
        const [, , , , x, y] = it.transform;
        const ri = rows.findIndex((r, i) => y < r && (i + 1 >= rows.length || y >= rows[i + 1]));
        if (ri < 0) continue;
        const ci = vx.findIndex((v, i) => i + 1 < vx.length && x >= v - 1 && x < vx[i + 1]);
        if (ci < 0) continue;
        if (!byRow.has(ri)) byRow.set(ri, { name: [], cells: DAYS.map(() => []) });
        const r = byRow.get(ri);
        if (ci === 0) r.name.push(s); else r.cells[ci - 1].push({ s, x, y });
    }
    for (const [ri, r] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
        const name = r.name.join(' ').trim();
        if (!name || /^(Sunday|Weekly|MARYLEBONE|Marylebone|Week)/.test(name)) continue;
        const cells = r.cells.map(items => {
            // Group by line (y), then join left-to-right; the top line is the time, below is the duty.
            const lines = new Map();
            for (const it of items) {
                const key = Math.round(it.y);
                const k = [...lines.keys()].find(v => Math.abs(v - key) < 4) ?? key;
                (lines.get(k) || lines.set(k, []).get(k)).push(it);
            }
            return [...lines.entries()].sort((a, b) => b[0] - a[0])
                .map(([, its]) => its.sort((a, b) => a.x - b.x).map(i => i.s).join('').replace(/\s+/g, ' ').trim())
                .filter(Boolean).join(' | ');
        });
        out.push({ page: p, name, cells });
    }
}
console.log(JSON.stringify(out, null, 1));
