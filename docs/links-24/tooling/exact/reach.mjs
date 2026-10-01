// Every duty multiset for one day reachable from the base grid's column by changing at most R cells, that passes the
// day's December rows; each with its floor fit. Output: rows [count per domain value..., fit*10, cellsChanged].
//   node reach.mjs spec.json out.json    spec = { base: [values of the working lines], domain: [...], cls, r, satmin }
import { readFileSync, writeFileSync } from 'node:fs';
import { evalDay } from './dayfast.mjs';
const S = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const V = [...S.domain, 'RD'], idx = Object.fromEntries(V.map((v, i) => [v, i]));
const B = Array(V.length).fill(0); for (const v of S.base) { if (!(v in idx)) throw new Error('base value outside domain ' + v); B[idx[v]]++; }
const seen = new Map();
function subs(vec, k, from, cur, out) { if (k === 0) { out.push(cur.slice()); return; } for (let i = from; i < vec.length; i++) if (vec[i] > cur[i]) { cur[i]++; subs(vec, k - 1, i, cur, out); cur[i]--; } }
for (let r = 0; r <= S.r; r++) {
  const Rs = []; subs(B, r, 0, Array(V.length).fill(0), Rs);
  const As = []; subs(Array(V.length).fill(99), r, 0, Array(V.length).fill(0), As);
  for (const Rm of Rs) for (const Am of As) {
    const c = B.map((b, i) => b - Rm[i] + Am[i]); const key = c.join(',');
    if (seen.has(key)) continue;
    // cells actually changed = sum of positive differences
    const d = c.reduce((a, x, i) => a + Math.max(0, x - B[i]), 0);
    const times = []; S.domain.forEach((t, i) => { for (let n = 0; n < c[i]; n++) times.push(t); });
    const e = evalDay(times, S.cls, S.satmin ?? 14);
    seen.set(key, e.ok ? [...c.slice(0, S.domain.length), Math.round(e.fit * 10), d] : null);
  }
  console.error('r', r, 'multisets', seen.size);
}
const rows = [...seen.values()].filter(Boolean).sort((a, b) => a[a.length - 2] - b[b.length - 2]);
writeFileSync(process.argv[3], JSON.stringify(rows));
const basefit = evalDay(S.base.filter(v => v !== 'RD'), S.cls, S.satmin ?? 14);
console.log('kept', rows.length, 'base fit', basefit.fit, 'ok', basefit.ok, 'best', rows.slice(0, 3).map(r => r[r.length - 2] / 10 + '@' + r[r.length - 1]).join(' '));
