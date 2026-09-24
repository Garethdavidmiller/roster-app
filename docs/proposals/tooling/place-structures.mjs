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
// PINNED DUTIES (owner, 22 Sep 2026): the ticket office wants two 14:00-22:30 turns Monday to Saturday and
// two 13:00-21:30 on a Sunday. PIN="14:00-22:30x2" fixes them: a structure must carry two late middles of
// that length, and those two never move. Everything else is searched around them.
const PIN = (process.env.PIN ?? '').split(',').filter(Boolean).map(p => {
    const [t, n] = p.split('x'); const [a, b] = t.split('-'); const m = x => +x.slice(0, 2) * 60 + +x.slice(3);
    return { s: m(a), e: m(b), L: m(b) - m(a), n: Number(n ?? 1) };
});
// FIT FIRST (owner): demand fit outranks the count of distinct times. PICK=times reverses it.
const PICK = process.env.PICK ?? 'fit';
let _s = (Number(process.env.SEED ?? 7) >>> 0) || 7;
const rnd = () => { _s ^= _s << 13; _s >>>= 0; _s ^= _s >> 17; _s ^= _s << 5; _s >>>= 0; return _s / 4294967296; };

function build(st) {
    // The structure was enumerated WITHOUT the pinned duties (PIN_N / PIN_MIN on table-book.mjs), so they
    // are simply added back here, fixed in place.
    const pinned = PIN.flatMap(p => Array.from({ length: p.n }, () => ({ s: p.s, e: p.e, role: 'p' })));
    return [
        ...st.openers.map(L => ({ s: OPEN, e: OPEN + L, role: 'o' })),
        ...st.closers.map(L => ({ s: CLOSE - L, e: CLOSE, role: 'c' })),
        ...st.mornMids.map(L => ({ s: 8*60, e: 8*60 + L, role: 'm' })),
        ...st.lateMids.map(L => ({ s: 13*60, e: 13*60 + L, role: 'l' })),
        ...pinned,
    ];
}
const clone = d => d.map(x => ({ ...x }));
function move(d) {
    const q = clone(d); const i = (rnd() * q.length) | 0; const x = q[i];
    if (x.role === 'o' || x.role === 'c' || x.role === 'p') return null;   // open, close, or a pinned duty
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
    let cur = build(st); if (!cur) continue; let cc = cost(cur);
    for (let s = 0; s < STEPS && cc > 0; s++) {
        const T = 60 * Math.pow(0.05 / 60, s / STEPS);
        const q = move(cur); if (!q) continue; const c2 = cost(q);
        if (c2 <= cc || rnd() < Math.exp((cc - c2) / T)) { cur = q; cc = c2; }
    }
    if (cc > 0) { if (cc < closest.c) closest = { c: cc, v: violations(CLS, cur).map(([m]) => m) }; continue; }
    feas++;
    const key = PICK === 'times' ? nTimes(cur) * 1000 + fit(cur) : fit(cur) * 1000 + nTimes(cur);
    if (!best || key < best.key) best = { key, d: clone(cur), t: nTimes(cur), f: fit(cur) };
}
const hm = m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
console.log(`${CLS}: ${n} structures, ${feas} placed feasibly`);
if (!best) { console.log(`  NONE. Closest cost ${closest.c.toFixed(1)}: ${(closest.v ?? ['no structure could be built']).join('; ')}`); process.exit(1); }
const srt = [...best.d].sort((a, b) => a.s - b.s || a.e - b.e);
console.log(`  best: ${new Set(srt.map(x=>x.s)).size} starts + ${new Set(srt.map(x=>x.e)).size} finishes = ${best.t} times · fit ${best.f}`);
console.log('  ' + srt.map(x => `${hm(x.s)}-${hm(x.e)}`).join(' | '));
console.log('  lengths: ' + srt.map(x => { const L = x.e - x.s; return `${Math.floor(L/60)}h${String(L%60).padStart(2,'0')}`; }).join(' '));
console.log('JSON ' + JSON.stringify(srt.map(x => `${hm(x.s)}-${hm(x.e)}`)));
