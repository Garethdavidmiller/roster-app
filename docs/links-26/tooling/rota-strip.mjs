// THE ROTA STRIP (3 Oct 2026, from the reader's critique: "the colleague deck has no picture of the rota"). One PNG of the
// 26 weeks for a colleague deck's slide 10: each week a cell — all earlies, all lates, mixed, or a cover week — with the
// full weekends off drawn as a bar between the Saturday and the Sunday it joins. Nothing is typed: the families and the
// weekends come from the grid.   node rota-strip.mjs <grid.json> <out.png>
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '../../../node_modules/playwright/index.mjs';
const [GRID, OUT] = process.argv.slice(2);
const j = JSON.parse(readFileSync(GRID, 'utf8')), p = j.patterns ?? j, L = Object.keys(p).length;
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], timed = s => /^\d\d:\d\d-\d\d:\d\d$/.test(s);
const fam = s => (+s.slice(0, 2) * 60 + +s.slice(3, 5)) < 11 * 60 ? 'E' : 'L';
const kind = k => { const ts = DAYS.map(d => p[k][d]); if (ts.every(s => s === 'SPARE')) return 'C'; const f = new Set(ts.filter(timed).map(fam)); return f.size === 1 ? [...f][0] : 'M'; };
const off = (k, d) => !timed(p[k][d]) && p[k][d] !== 'SPARE';
const weekend = k => off(k, 'sat') && off(k % L + 1, 'sun');
const LABEL = { E: 'earlies', L: 'lates', M: 'mixed', C: 'cover' };
const PER = Math.ceil(L / 2);   // two rows, so the cells read on a projected slide
const cell = k => { const t = kind(k), last = k % PER === 0, first = k % PER === 1; return `<div class="c ${t}"><b>${k}</b><span>${LABEL[t]}</span>${weekend(k) ? `<i class="${last ? 'half-r' : ''}"></i>` : ''}${first && weekend((k - 2 + L) % L + 1) ? '<i class="half-l"></i>' : ''}</div>`; };
const cells = Array.from({ length: L }, (_, i) => i + 1).map(cell).join('');
const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:white;font-family:Inter,Arial,sans-serif;width:1700px}
.row{display:grid;grid-template-columns:repeat(${PER},1fr);gap:34px 8px;padding:14px 10px 40px;position:relative}
.c{position:relative;height:150px;border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px}
.c b{font-size:40px;font-weight:800} .c span{font-size:22px;letter-spacing:.2px}
.E{background:#FFF1BF;color:#5A4200;border:2px solid #F5C800} .L{background:#001E3C;color:white;border:2px solid #001E3C}
.M{background:linear-gradient(135deg,#FFF1BF 50%,#001E3C 50%);color:#1B2533;border:2px solid #8A96A3} .M span,.M b{background:rgba(255,255,255,.85);padding:0 5px;border-radius:4px}
.C{background:#EEF1F5;color:#5B6778;border:2px dashed #AEB7C2}
.c i{position:absolute;left:50%;bottom:-24px;width:calc(100% + 8px);height:12px;border-radius:6px;background:#1E7B4B}
.c i.half-r{width:50%;border-radius:6px 0 0 6px} .c i.half-l{left:0;width:50%;border-radius:0 6px 6px 0}
.key{display:flex;gap:26px;padding:0 10px 14px;font-size:22px;color:#1B2533;align-items:center}
.key span{display:inline-flex;align-items:center;gap:7px} .sw{width:22px;height:16px;border-radius:4px;display:inline-block}
</style><div class="row">${cells}</div>
<div class="key"><span><i class="sw" style="background:#FFF1BF;border:2px solid #F5C800"></i>all earlies</span><span><i class="sw" style="background:#001E3C"></i>all lates</span><span><i class="sw" style="background:linear-gradient(135deg,#FFF1BF 50%,#001E3C 50%)"></i>mixed</span><span><i class="sw" style="background:#EEF1F5;border:2px dashed #AEB7C2"></i>cover week — four duties placed later</span><span><i class="sw" style="background:#1E7B4B;height:10px"></i>full weekend off (Saturday and the Sunday after)</span></div>`;
const tmp = OUT.replace(/\.png$/, '.html'); writeFileSync(tmp, html);
const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1700, height: 500 }, deviceScaleFactor: 2 });
await pg.goto('file://' + tmp); await pg.evaluate(() => document.fonts.ready);
const h = await pg.evaluate(() => document.body.scrollHeight); await pg.setViewportSize({ width: 1700, height: h });
await pg.screenshot({ path: OUT, fullPage: true }); await b.close();
console.log('wrote', OUT, `${L} weeks, ${Array.from({ length: L }, (_, i) => i + 1).filter(weekend).length} full weekends`);
