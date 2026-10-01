// Grow a 24-line rotation's week structure to 26 lines: one extra working line (it works exactly the days the source is
// one duty short on), five cover weeks at link.mjs's lines, every insertion point and every rotation offset tried. The
// new table is then carried on (carry-order's pairing: by start then finish, per day). Scored by anneal.mjs's rules-mode
// evaluate. Usage: MODE=rules [TOP=4] node grow-from-24.mjs <table.json> <out-prefix> <src24.json>...   (writes <out-prefix>-<Xx><n>.json, the best TOP per source)
import fs from 'node:fs';
const TL = './';
const { evaluate } = await import(TL + 'anneal.mjs');
const { LINES, COVER_LINES, HEADS } = await import(TL + 'link.mjs');
const { feel, tightestRest } = await import(TL + 'report-data.mjs');
const [TABLE, OUT, ...SRCS] = process.argv.slice(2);
const slots = JSON.parse(fs.readFileSync(TABLE)).slots;
const D = ['sun','mon','tue','wed','thu','fri','sat'], cls = d => d === 'sun' ? 'sun' : d === 'sat' ? 'sat' : 'weekday';
const tgt = d => slots.reduce((a, r) => a + r[cls(d)], 0);
const key = t => t.replace('-', '');
function carry(p) { for (const d of D) { const ls = Object.keys(p).filter(k => p[k][d] !== 'RD' && p[k][d] !== 'SPARE').sort((a, b) => key(p[a][d]).localeCompare(key(p[b][d])) || (+a - +b));
  const want = slots.flatMap(r => Array(r[cls(d)]).fill(r.time)).sort((a, b) => key(a).localeCompare(key(b)));
  if (want.length !== ls.length) return null; ls.forEach((k, i) => { p[k][d] = want[i]; }); } return p; }
const res = [];
for (const src of SRCS) {
  const sp = JSON.parse(fs.readFileSync(src)); const p0 = sp.patterns ?? sp; const n0 = Object.keys(p0).length;
  const work = Array.from({ length: n0 }, (_, i) => p0[String(i + 1)]).filter(r => r.mon !== 'SPARE');
  const extra = {}; let okSrc = true;
  for (const d of D) { const c = work.filter(r => r[d] !== 'RD').length, gap = tgt(d) - c; if (gap < 0 || gap > 1) okSrc = false; extra[d] = gap ? '07:00-15:00' : 'RD'; }
  if (!okSrc) { console.error('skip', src, 'counts do not fit'); continue; }
  for (let ins = 0; ins <= work.length; ins++) {
    const seq = [...work.slice(0, ins), { ...extra }, ...work.slice(ins)];
    for (let off = 0; off < seq.length; off++) {
      const rot = [...seq.slice(off), ...seq.slice(0, off)]; const p = {}; let w = 0;
      for (let i = 1; i <= LINES; i++) p[String(i)] = COVER_LINES.includes(i) ? Object.fromEntries(D.map(d => [d, 'SPARE'])) : { ...rot[w++] };
      if (!carry(p)) continue;
      const e = evaluate(p); const f = feel(p, LINES);
      res.push({ src: src.split('/').pop().slice(0, 14), ins, off, cost: Math.round(e.cost), ...e.facts, one: f.oneTurn, iso: f.isolatedRest, rest: tightestRest(p, LINES)?.minutes, p });
    }
  }
}
res.sort((a, b) => a.cost - b.cost);
const per = {}; for (const r of res) (per[r.src] ??= []).push(r);
for (const [src, rs] of Object.entries(per)) rs.slice(0, Number(process.env.TOP ?? 4)).forEach((r, i) => { const { p, ...x } = r; console.log(JSON.stringify(x));
  fs.writeFileSync(`${OUT}-${src.slice(0, 2)}${i}.json`, JSON.stringify({ variant: 'tpl', mode: process.env.MODE, patterns: r.p }, null, 1)); });
