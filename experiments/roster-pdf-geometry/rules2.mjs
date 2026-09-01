import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync } from 'node:fs';
const doc = await getDocument({ data: new Uint8Array(readFileSync(process.argv[2])), useSystemFonts: true }).promise;
const names = Object.fromEntries(Object.entries(OPS).map(([k, v]) => [v, k]));
for (const p of [1, 3]) {
    const page = await doc.getPage(p);
    const ops = await page.getOperatorList();
    const counts = {};
    for (const fn of ops.fnArray) counts[names[fn]] = (counts[names[fn]] || 0) + 1;
    console.log(`page ${p} ops:`, Object.entries(counts).filter(([, n]) => n > 1).sort((a,b)=>b[1]-a[1]).slice(0, 14));
    // segments from constructPath
    const vx = new Map(), hy = new Map();
    for (let i = 0; i < ops.fnArray.length; i++) {
        if (ops.fnArray[i] !== OPS.constructPath) continue;
        const [fns, args] = ops.argsArray[i];
        let a = 0, cx = 0, cy = 0, sx = 0, sy = 0;
        for (const fn of fns) {
            if (fn === OPS.moveTo)      { cx = args[a]; cy = args[a+1]; sx = cx; sy = cy; a += 2; }
            else if (fn === OPS.lineTo) {
                const nx = args[a], ny = args[a+1]; a += 2;
                if (Math.abs(nx - cx) < 0.6 && Math.abs(ny - cy) > 3) vx.set(+nx.toFixed(1), (vx.get(+nx.toFixed(1))||0)+1);
                if (Math.abs(ny - cy) < 0.6 && Math.abs(nx - cx) > 3) hy.set(+ny.toFixed(1), (hy.get(+ny.toFixed(1))||0)+1);
                cx = nx; cy = ny;
            }
            else if (fn === OPS.curveTo)   { a += 6; }
            else if (fn === OPS.rectangle) { a += 4; }
            else if (fn === OPS.closePath) { cx = sx; cy = sy; }
        }
    }
    console.log(`  vertical x:`, [...vx.keys()].sort((a,b)=>a-b));
    console.log(`  horizontal y count:`, hy.size, [...hy.keys()].sort((a,b)=>b-a).slice(0,10));
}
