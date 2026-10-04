// THE ROTA STRIP (3 Oct 2026, from the reader's critique: "the colleague deck has no picture of the rota"). One PNG of the
// 26 weeks for a colleague deck's slide 10: each week a cell — all earlies, all lates, mixed, or a cover week — with the
// full weekends off drawn as a green bar between the Saturday and the Sunday it joins. Nothing is typed: the families and
// the weekends come from the grid.   node rota-strip.mjs <grid.json> <out.png>
// 4 Oct 2026 (visual review): a run of consecutive weekends off is ONE bar, not abutting segments with seams; a weekend
// that straddles a row break (week 13 into 14, or 26 back into 1) ends the row with an arrow tip and begins the next with
// one, so the two halves read as deliberate; a mixed week carries its number on a solid band across the split tile so it
// is as strong as its neighbours; the legend shows a swatch only for a kind the design has; cover tiles read darker.
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '../../../node_modules/playwright/index.mjs';
const [GRID, OUT] = process.argv.slice(2);
const j = JSON.parse(readFileSync(GRID, 'utf8')), p = j.patterns ?? j, L = Object.keys(p).length;
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], timed = s => /^\d\d:\d\d-\d\d:\d\d$/.test(s);
const fam = s => (+s.slice(0, 2) * 60 + +s.slice(3, 5)) < 11 * 60 ? 'E' : 'L';
const kind = k => { const ts = DAYS.map(d => p[k][d]); if (ts.every(s => s === 'SPARE')) return 'C'; const f = new Set(ts.filter(timed).map(fam)); return f.size === 1 ? [...f][0] : 'M'; };
const off = (k, d) => !timed(p[k][d]) && p[k][d] !== 'SPARE';
const weekend = k => off(k, 'sat') && off(k % L + 1, 'sun');          // week k's Saturday and the next week's Sunday both off
const prev = k => (k - 2 + L) % L + 1;
const LABEL = { E: 'earlies', L: 'lates', M: 'mixed', C: 'cover' };
const weeks = Array.from({ length: L }, (_, i) => i + 1), kinds = Object.fromEntries(weeks.map(k => [k, kind(k)]));

// geometry, in px at 1×: two rows so the cells read on a projected slide
const PER = Math.ceil(L / 2), W = 1700, PAD = 10, GAP = 8, CELL = 170, TOP = 18, BAR_Y = TOP + CELL + 14, BAR_H = 12, TIP = 14;
const cw = (W - 2 * PAD - (PER - 1) * GAP) / PER, centre = c => PAD + c * (cw + GAP) + cw / 2;
const cell = k => { const t = kinds[k], inner = `<b>${k}</b><span>${LABEL[t]}</span>`; return `<div class="c ${t}">${t === 'M' ? `<div class="band">${inner}</div>` : inner}</div>`; };
/** One row's weekend bars: runs of consecutive weekends off merged into one bar from the first Saturday's cell centre
 *  to the last Sunday's; a bar arriving from the row above (or from week 26 into week 1) starts at the row's left edge
 *  with an arrow tip, and one leaving the row ends at its right edge with one. */
const bars = ks => {
  const n = ks.length, segs = [];
  if (weekend(prev(ks[0]))) segs.push([-1, 0]);                                   // arriving from the previous row
  ks.forEach((k, c) => { if (!weekend(k)) return; const last = segs[segs.length - 1]; if (last && last[1] === c) last[1] = c + 1; else segs.push([c, c + 1]); });
  return segs.map(([a, b]) => {
    const x0 = a < 0 ? PAD + TIP : centre(a), x1 = b >= n ? W - PAD - TIP : centre(b), cls = (a < 0 ? ' in' : '') + (b >= n ? ' out' : '');
    return `<i class="bar${cls}" style="left:${x0.toFixed(1)}px;width:${(x1 - x0).toFixed(1)}px"></i>`;
  }).join('');
};
const rows = [weeks.slice(0, PER), weeks.slice(PER)].filter(r => r.length);
const straddles = rows.some(r => weekend(r[r.length - 1]));
const has = t => weeks.some(k => kinds[k] === t);
const sw = (style, text) => `<span><i class="sw" style="${style}"></i>${text}</span>`;
const key = [has('E') && sw('background:#FFF1BF;border:2px solid #F5C800', 'all earlies'), has('L') && sw('background:#001E3C', 'all lates'),
  has('M') && sw('background:linear-gradient(135deg,#FFF1BF 50%,#001E3C 50%)', 'mixed earlies and lates'),
  has('C') && sw('background:#EEF1F5;border:2px dashed #9AA5B2', 'cover week — four duties placed later'),
  sw('background:#1E7B4B;height:10px', 'full weekend off (Saturday and the Sunday after)'),
  straddles && `<span><i class="sw tip"></i>carries on in the next row${weekend(L) ? ` — and from week ${L} back into week 1` : ''}</span>`].filter(Boolean).join('');
const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:white;font-family:Inter,Arial,sans-serif;width:${W}px}
.row{position:relative;height:${TOP + CELL + 54}px;padding:${TOP}px ${PAD}px 0;display:grid;grid-template-columns:repeat(${PER},1fr);gap:${GAP}px;box-sizing:border-box}
.c{position:relative;height:${CELL}px;border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;box-sizing:border-box}
.c b{font-size:42px;font-weight:800;line-height:1} .c span{font-size:23px;letter-spacing:.2px;line-height:1.1}
.E{background:#FFF1BF;color:#5A4200;border:2px solid #F5C800} .L{background:#001E3C;color:white;border:2px solid #001E3C}
.M{background:linear-gradient(135deg,#FFF1BF 50%,#001E3C 50%);border:2px solid #8A96A3}
.M .band{width:100%;background:rgba(255,255,255,.94);color:#1B2533;display:flex;flex-direction:column;align-items:center;gap:4px;padding:9px 0 8px}
.C{background:#EEF1F5;color:#3D4A5C;border:2px dashed #9AA5B2}
.bar{position:absolute;top:${BAR_Y}px;height:${BAR_H}px;border-radius:${BAR_H / 2}px;background:#1E7B4B}
.bar.in{border-radius:0 ${BAR_H / 2}px ${BAR_H / 2}px 0} .bar.out{border-radius:${BAR_H / 2}px 0 0 ${BAR_H / 2}px}
.bar.in::before,.bar.out::after{content:'';position:absolute;top:${-(TIP - BAR_H) / 2}px;border-top:${TIP / 2}px solid transparent;border-bottom:${TIP / 2}px solid transparent;border-left:${TIP}px solid #1E7B4B}
.bar.in::before{left:-${TIP}px} .bar.out::after{right:-${TIP}px}
.key{display:flex;flex-wrap:wrap;gap:10px 26px;padding:4px ${PAD}px 16px;font-size:23px;color:#1B2533;align-items:center}
.key span{display:inline-flex;align-items:center;gap:7px} .sw{width:22px;height:16px;border-radius:4px;display:inline-block;box-sizing:border-box}
.sw.tip{width:0;height:0;border-radius:0;border-top:9px solid transparent;border-bottom:9px solid transparent;border-left:16px solid #1E7B4B}
</style>${rows.map(r => `<div class="row">${r.map(cell).join('')}${bars(r)}</div>`).join('')}<div class="key">${key}</div>`;
const tmp = OUT.replace(/\.png$/, '.html'); writeFileSync(tmp, html);
const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: W, height: 500 }, deviceScaleFactor: 2 });
await pg.goto('file://' + tmp); await pg.evaluate(() => document.fonts.ready);
const h = await pg.evaluate(() => document.body.scrollHeight); await pg.setViewportSize({ width: W, height: h });
await pg.screenshot({ path: OUT, fullPage: true }); await b.close();
console.log('wrote', OUT, `${L} weeks, ${weeks.filter(weekend).length} full weekends`);
