import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync } from 'node:fs';
const V = [25.3, 154.8, 250.3, 347, 442.3, 537.5, 633.5, 729.5, 822.5];
const NAMES = ['NAME','Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const doc = await getDocument({ data: new Uint8Array(readFileSync(process.argv[2])), useSystemFonts: true }).promise;
const want = process.argv[3];
for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const items = tc.items.filter(i => i.str.trim()).map(i => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5] }));
    const anchor = items.find(i => i.s === want);
    if (!anchor) continue;
    console.log(`${want} — page ${p}, row y ≈ ${anchor.y.toFixed(1)}\n`);
    for (const it of items.filter(i => Math.abs(i.y - anchor.y) < 18).sort((a, b) => a.x - b.x)) {
        const ci = V.findIndex((v, i) => i + 1 < V.length && it.x >= v - 1 && it.x < V[i + 1]);
        console.log(`  x=${it.x.toFixed(1).padStart(6)}  →  ${NAMES[ci].padEnd(10)}  ${JSON.stringify(it.s)}`);
    }
    break;
}
