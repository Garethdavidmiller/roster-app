// Place EVERY enumerated length structure, and keep the best FEASIBLE one.
//
// WHY THIS EXISTS. `table-book.mjs` searches lengths and start times together, with a role-preserving
// anneal over the whole day. At By the Book's own 9h30 that space is enormous (540,737 weekday length
// structures at 8h40) and the anneal finds an answer easily. Tighten the cap and the space collapses --
// 13,925 structures at 8h35, 62 at 8h30, and exactly ONE on a Saturday or a Sunday at 8h30 -- and a
// blind anneal stops finding the needle. Measured: it reports "no feasible weekday table" at both 8h35
// and 8h30, while this script places a weekday table at 8h30.
//
// That difference is the point. "We could not find one" and "there is not one" are different claims,
// and only the second belongs in a proposal document. The enumeration already knows every legal set of
// LENGTHS; inside one of those the only freedom left is where the middle turns start, which is a small
// search. So: enumerate, then place each one, rather than hope.
//
// THE PICK is the owner's brief for By the Book 2, in order: fewest distinct start and finish times,
// then demand fit. CLS / CAP / GAP / PSTEPS / SEED are environment knobs; CAP and GAP are read by
// table-book.mjs itself, so the pins this honours are its pins, not a second copy of them.
import { violations, structures } from './table-book.mjs';
import { DEC_2026_DEMAND } from '../../../links-demand.js';

const CLS = process.env.CLS ?? 'weekday';
const WIN = { weekday: [6*60+20, 23*60+55], sat: [6*60+20, 23*60+55], sun: [7*60+15, 23*60+25] };
const [OPEN, CLOSE] = WIN[CLS];
const STEPS = Number(process.env.PSTEPS ?? 2500);
let _s = (Number(process.env.SEED ?? 7) >>> 0) || 7;
const rnd = () => { _s ^= _s << 13; _s >>>= 0; _s ^= _s >> 17; _s ^= _s << 5; _s >>>= 0; return _s / 4294967296; };

const build = st => [
    ...st.openers.map(L => ({ s: OPEN, e: OPEN + L, role: 'o' })),
    ...st.closers.map(L => ({ s: CLOSE - L, e: CLOSE, role: 'c' })),
    ...st.mornMids.map(L => ({ s: 8*60, e: 8*60 + L, role: 'm' })),
    ...st.lateMids.map(L => ({ s: 13*60, e: 13*60 + L, role: 'l' })),
];
const clone = d => d.map(x => ({ ...x }));
function move(d) {
    const q = clone(d); const i = (rnd() * q.length) | 0; const x = q[i];
    if (x.role === 'o' || x.role === 'c') return null;      // pinned to the open / the close
    const L = x.e - x.s, lo = x.role === 'm' ? 7*60 : 11*60, hi = x.role === 'm' ? 11*60 : 16*60 + 30;
    const ns = Math.max(lo, Math.min(hi, x.s + [15, -15, 30, -30, 5, -5, 60, -60][(rnd() * 8) | 0]));
    if (ns === x.s) return null;
    x.s = ns; x.e = ns + L; return q;
}
const cost = d => violations(CLS, d).reduce((a, [, w]) => a + w, 0);
const nTimes = d => new Set(d.map(x => x.s)).size + new Set(d.map(x => x.e)).size;
function fit(d) {
    const cars = DEC_2026_DEMAND[CLS].cars, [ws, we] = WIN[CLS]; const hrs = [];
    for (let h = Math.floor(ws/60); h <= Math.floor((we-1)/60); h++) hrs.push(h);
    const frac = h => Math.max(0, Math.min(we, (h+1)*60) - Math.max(ws, h*60)) / 60;
    const cov = h => d.reduce((a, x) => a + Math.max(0, Math.min(x.e, h*60+60) - Math.max(x.s, h*60)) / 60, 0);
    const D = hrs.reduce((a, h) => a + cars[h]*frac(h), 0), C = hrs.reduce((a, h) => a + cov(h), 0);
    return +hrs.reduce((a, h) => a + ((cars[h]*frac(h)/D) - (cov(h)/C))**2 * 1e4, 0).toFixed(1);
}

let n = 0, feas = 0, best = null, closest = { c: Infinity, v: null };
for (const st of structures(CLS)) {
    n++;
    let cur = build(st), cc = cost(cur);
    for (let s = 0; s < STEPS && cc > 0; s++) {
        const T = 60 * Math.pow(0.05 / 60, s / STEPS);
        const q = move(cur); if (!q) continue; const c2 = cost(q);
        if (c2 <= cc || rnd() < Math.exp((cc - c2) / T)) { cur = q; cc = c2; }
    }
    if (cc > 0) { if (cc < closest.c) closest = { c: cc, v: violations(CLS, cur).map(([m]) => m) }; continue; }
    feas++;
    const key = nTimes(cur) * 1000 + fit(cur);
    if (!best || key < best.key) best = { key, d: clone(cur), t: nTimes(cur), f: fit(cur) };
}
const hm = m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
console.log(`${CLS}: ${n} structures, ${feas} placed feasibly`);
if (!best) { console.log(`  NONE. Closest cost ${closest.c.toFixed(1)}: ${closest.v.join('; ')}`); process.exit(1); }
const srt = [...best.d].sort((a, b) => a.s - b.s || a.e - b.e);
console.log(`  best: ${new Set(srt.map(x=>x.s)).size} starts + ${new Set(srt.map(x=>x.e)).size} finishes = ${best.t} times · fit ${best.f}`);
console.log('  ' + srt.map(x => `${hm(x.s)}-${hm(x.e)}`).join(' | '));
console.log('  lengths: ' + srt.map(x => { const L = x.e - x.s; return `${Math.floor(L/60)}h${String(L%60).padStart(2,'0')}`; }).join(' '));
console.log('JSON ' + JSON.stringify(srt.map(x => `${hm(x.s)}-${hm(x.e)}`)));
