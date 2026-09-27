// A day table to the OWNER'S FINAL SOFT RULES of 27 Sep 2026 — every time not fixed by the owner placed by demand.
//
// The brief, in substance: "Saturday evenly balanced to demand (not leaning late); keep the number of shift
// patterns similar to today (not necessarily the times); the weekday 15:15-till-close late starts at 15:45; keep
// 06:20–14:20 x2 and 14:00–22:30 x2 on a weekday; 06:20–14:50 x2 and 14:30–22:00 x2 on a Saturday; two identical
// earlies and two identical lates for the Sunday ticket office, which runs 07:15 until 22:30 to allow for setting
// up and shutting up; everything else demand based. Three at the close is a MINIMUM — more is fine."
//
// HOW IT IS READ, every reading stated so it can be overruled:
//   · The owner's fixed turns are EXACT counts ("keep x2" means two, not "at least two"), and every other turn is
//     searched. A fixed turn's time is taken out of the free pool on its own day so the count cannot drift.
//   · Every weekday closer is 15:45–23:55 (today's 15:15 closer, moved); Saturday's and Sunday's closer times are
//     searched. Closers are at least three, at most CLOSERS_MAX (default 4).
//   · At least four on at the open (at most OPENERS_MAX, default 5) — the owner's floors are minimums: too few is
//     the problem, never too many. The Sunday ticket-office earlies start 07:15, so they are two of the
//     four Sunday openers; its lates finish 22:30, and the early pair must still be on when the late pair arrives
//     (early finish ≥ late start), so the office is never unstaffed between 07:15 and 22:30.
//   · Five on at 22:00 is a minimum. The owner's evening turns already make it by construction — three closers plus
//     14:00–22:30 x2 on a weekday, 14:30–22:00 x2 on a Saturday (a fixed turn finishing AT 22:00 counts as on at
//     22:00, the By the Book 2 reading), the ticket-office lates on a Sunday — so every OTHER duty finishes by 22:00
//     (MID_END_MAX), and the only way to put more people on after 22:00 is a fourth closer, which the search may
//     choose. — SUPERSEDED the same day: the owner dropped "nothing finishes in the hour before the close" ("can
//     go"), so a free duty may now finish at any quarter hour up to the close (MID_END_MAX = CLOSE − 15), and the
//     floors of five at 22:00 and three at the close are minimums the fixed turns meet on their own.
//   · "A similar number of shifts as today, or less" (owner) is MAX_TURNS, a HARD cap on the distinct turns a day works (fixed
//     turns included), so the bound is taken against the best table under the cap. Run it at several caps to read
//     the ladder; today's link works 7–8 on a weekday, 6 on a Saturday, 4 on a Sunday, 18 in the week.
//   · Times: the quarter hour, the window's own instants (06:20/23:55; 07:15/23:25 on a Sunday) and the owner's own
//     06:20–14:20 and 06:20–14:50 as openers — every time a person could not find confusing. TODAY=1 adds today's
//     clock times to the pool as well. No :05 or :10 otherwise.
//   · Duties 7h to HI minutes (default 9h30, the December default's band); no turn on more than four duties; the
//     thinnest fully-covered hour never below today's; no start in the forty minutes after the open.
//   · Monday to Friday is one table (the searched families' shape), and 5W + S = 42,000 exactly. Sunday is not
//     contracted, so its total is a range (SUN_MIN..SUN_MAX) and the fit decides within it.
//
// THE PICK: demand fit (minutes-weighted, the folder's one measure — `dayFit` in report-data.mjs), then fewer
// distinct turns, then fewer distinct starts and finishes.
//
// THE SEARCH is exhaustive with a branch-and-bound on the fit, as quarter-table.mjs: every closer multiset x every
// opener multiset x every middle multiset paying the exact remainder; a partial table whose over-covered hours
// alone already lose to the incumbent is abandoned. Sunday's space is small enough to enumerate without a bound.
//   CLS=weekday TOTAL=7000 MAX_TURNS=7 node final-table.mjs     CLS=sat TOTAL=7000 …     CLS=sun MAX_TURNS=5 …
import { writeFileSync } from 'node:fs';
import { DEC_2026_DEMAND } from '../../../links-demand.js';
import { today, assess } from './report-data.mjs';

const CLS = process.env.CLS ?? 'weekday';
if (!['weekday', 'sat', 'sun'].includes(CLS)) { console.error('CLS must be weekday, sat or sun'); process.exit(2); }
const mm = t => +t.slice(0, 2) * 60 + +t.slice(3);
const hm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const WIN = { weekday: [380, 1435], sat: [380, 1435], sun: [435, 1405] }; const [OPEN, CLOSE] = WIN[CLS];
const N = { weekday: 14, sat: 14, sun: 10 }[CLS], OPENERS_MIN = 4, OPENERS_MAX = Number(process.env.OPENERS_MAX ?? 5);
const CLOSERS_MIN = 3, CLOSERS_MAX = Number(process.env.CLOSERS_MAX ?? 4);
const LO = 420, HI = Number(process.env.HI ?? 570), MAX_PER = 4;
const MID_END_MAX = Number(process.env.MID_END_MAX ?? CLOSE - 15);
const MAX_TURNS = Number(process.env.MAX_TURNS ?? 99);
const BOUND = process.env.BOUND !== '0';
// BEST0: a fit no table worse than which is worth finishing — prunes from the first node rather than after the first
// incumbent. It can only hide tables WORSE than it, so a run that returns a table is still proven optimal; one that
// returns none says only that nothing beats BEST0.
const BEST0 = Number(process.env.BEST0 ?? Infinity);
const parse = v => v.split(',').filter(Boolean).map(x => { const [t, n] = x.split('x'); return [t, Number(n ?? 1)]; });
const FIXED = process.env.FIXED !== undefined ? (process.env.FIXED === 'none' ? [] : parse(process.env.FIXED))
  : { weekday: [['06:20-14:20', 2], ['14:00-22:30', 2]], sat: [['06:20-14:50', 2], ['14:30-22:00', 2]], sun: [] }[CLS];
const CLOSER_ONLY = CLS === 'weekday' ? (process.env.WK_CLOSER ?? '15:45-23:55') : null;
const TOTAL = Number(process.env.TOTAL ?? 7000);
const SUN_MIN = Number(process.env.SUN_MIN ?? 4800), SUN_MAX = Number(process.env.SUN_MAX ?? 5300);

const T0 = today(); const todayRows = assess(T0.patterns, T0.lines).tableRows;
// POOL: every legal turn on the grid.
const legalStartMin = s => s === OPEN || s >= OPEN + 40;
const onGrid = m => m % 15 === 0;
const extraOpenerEnds = [14 * 60 + 20, 14 * 60 + 50];
const TODAY_TIMES = process.env.TODAY === '1' ? new Set(todayRows.map(r => r.time)) : new Set();
const POOL = []; const seenT = new Set();
const addTurn = (s, e) => { const L = e - s, t = `${hm(s)}-${hm(e)}`; if (seenT.has(t) || L < LO || L > HI || !legalStartMin(s) || e > CLOSE) return;
  const isC = e === CLOSE, isO = s === OPEN; 
  seenT.add(t); POOL.push({ s, e, L, t }); };
for (let s = OPEN; s < CLOSE; s++) { if (s !== OPEN && !onGrid(s)) continue; for (let e = s + LO; e <= CLOSE; e++) { if (e !== CLOSE && !onGrid(e)) continue; addTurn(s, e); } }
for (const e of extraOpenerEnds) addTurn(OPEN, e);
for (const t of TODAY_TIMES) { const [a, b] = t.split('-').map(mm); addTurn(a, b); }
for (const [t] of FIXED) { const [a, b] = t.split('-').map(mm); addTurn(a, b); }
POOL.forEach((p, i) => { p.id = i; p.cov = new Float64Array(24); for (let m = p.s; m < p.e; m += 5) p.cov[Math.floor(m / 60)] += 1 / 12; });
const byT = Object.fromEntries(POOL.map(p => [p.t, p]));

// The fit (dayFit's formula), and its lower bound from the over-covered hours.
const cars = DEC_2026_DEMAND[CLS].cars; const HRS = []; for (let h = Math.floor(OPEN / 60); h <= Math.floor((CLOSE - 1) / 60); h++) HRS.push(h);
const frac = h => Math.max(0, Math.min(CLOSE, (h + 1) * 60) - Math.max(OPEN, h * 60)) / 60;
const D = HRS.reduce((a, h) => a + cars[h] * frac(h), 0); const TSH = new Float64Array(24); for (const h of HRS) TSH[h] = cars[h] * frac(h) / D;
const FULL = HRS.filter(h => frac(h) >= 0.99);
const fitOf = (cov, C) => { let f = 0; for (const h of HRS) { const d = TSH[h] - cov[h] / C; f += d * d; } return f * 1e4; };
const lowerBound = (cov, C) => { let f = 0; for (const h of HRS) { const d = cov[h] / C - TSH[h]; if (d > 0) f += d * d; } return f * 1e4; };
const todayDuties = todayRows.filter(r => r[CLS] > 0).map(r => [{ s: mm(r.time.split('-')[0]), e: mm(r.time.split('-')[1]) }, r[CLS]]);
const thinnestOf = duties => { const c = new Array(24).fill(0); for (const [p, n] of duties) for (let m = p.s; m < p.e; m += 5) c[Math.floor(m / 60)] += n / 12; return Math.min(...FULL.map(h => c[h])); };
const FLOOR = Number(process.env.FLOOR ?? thinnestOf(todayDuties).toFixed(2));

function evaluate(counts, cov, total) {
  let n = 0, nO = 0, nC = 0, turns = 0; const starts = new Set(), ends = new Set();
  for (let i = 0; i < POOL.length; i++) { const k = counts[i]; if (!k) continue; const p = POOL[i]; if (k > MAX_PER) return null;
    n += k; turns++; starts.add(p.s); ends.add(p.e); if (p.s === OPEN) nO += k; if (p.e === CLOSE) nC += k; }
  if (n !== N || nO < OPENERS_MIN || nO > OPENERS_MAX || nC < CLOSERS_MIN || nC > CLOSERS_MAX || turns > MAX_TURNS) return null;
  let thin = Infinity; for (const h of FULL) if (cov[h] < thin) thin = cov[h]; if (thin < FLOOR - 1e-9) return null;
  const fit = fitOf(cov, total / 60);
  return { fit: +fit.toFixed(1), fitRaw: fit, turns, total, thin: +thin.toFixed(2), starts: starts.size, ends: ends.size, closers: nC,
    duties: POOL.map((p, i) => [p.t, counts[i]]).filter(([, k]) => k).sort((a, b) => a[0].localeCompare(b[0])) };
}
const keyOf = r => r.fitRaw * 1e4 + r.turns * 10 + (r.starts + r.ends);
let best = null, feasible = 0, nodes = 0, pruned = 0; const byTurns = {};
const offer = rec => { if (!rec) return; feasible++; if (!byTurns[rec.turns] || keyOf(rec) < keyOf(byTurns[rec.turns])) byTurns[rec.turns] = rec; if (!best || keyOf(rec) < keyOf(best)) best = rec; };

function multisets(pool, k, maxPer) { const out = []; const rec = (i, left, cur) => { if (!left) { out.push(cur.slice()); return; } if (i === pool.length) return; for (let n = Math.min(maxPer, left); n >= 0; n--) { for (let x = 0; x < n; x++) cur.push(pool[i]); rec(i + 1, left - n, cur); for (let x = 0; x < n; x++) cur.pop(); } }; rec(0, k, []); return out; }

// Run one configuration: fixed duties (exact) + free openers/closers/middles paying `total` exactly.
function solve(fixed, total, exclude) {
  const counts = new Int32Array(POOL.length), cov = new Float64Array(24);
  let distinct = 0;
  const add = (p, sgn) => { if (sgn > 0 && counts[p.id] === 0) distinct++; counts[p.id] += sgn; if (sgn < 0 && counts[p.id] === 0) distinct--; for (let h = 0; h < 24; h++) cov[h] += sgn * p.cov[h]; };
  let fixedN = 0, fixedMin = 0, fixedO = 0, fixedC = 0;
  for (const [t, n] of fixed) { const p = byT[t]; if (!p) throw new Error(`fixed ${t} not in pool`); for (let x = 0; x < n; x++) add(p, 1); fixedN += n; fixedMin += p.L * n; if (p.s === OPEN) fixedO += n; if (p.e === CLOSE) fixedC += n; }
  const ex = new Set(exclude);
  const openersPool = POOL.filter(p => p.s === OPEN && p.e !== CLOSE && !ex.has(p.t));
  const closersPool = POOL.filter(p => p.e === CLOSE && p.s !== OPEN && !ex.has(p.t) && (!CLOSER_ONLY || p.t === CLOSER_ONLY));
  const midPool = POOL.filter(p => p.s !== OPEN && p.e !== CLOSE && p.e <= MID_END_MAX && !ex.has(p.t));

  const midByL = {}; for (const p of midPool) (midByL[p.L] ??= []).push(p); const Ls = Object.keys(midByL).map(Number).sort((a, b) => a - b);
  const C = (total ?? 1) / 60; const bestRaw = () => !BOUND ? Infinity : best ? best.fitRaw - 1e-9 : BEST0;
  for (let needO = Math.max(0, OPENERS_MIN - fixedO); needO <= OPENERS_MAX - fixedO; needO++) {
  const osets = multisets(openersPool, needO, MAX_PER);
  for (let nC = Math.max(0, CLOSERS_MIN - fixedC); nC <= CLOSERS_MAX - fixedC; nC++) {
    const csets = multisets(closersPool, nC, MAX_PER);
    const needM = N - fixedN - needO - nC; if (needM < 0) continue;
    const leaf = () => { const rec = evaluate(counts, cov, total); if (rec) offer(rec); };
    const pickTurns = (lens, pos) => {
      if (pos === lens.length) { leaf(); return; }
      let end = pos; while (end < lens.length && lens[end] === lens[pos]) end++; const k = end - pos; const turns = midByL[lens[pos]];
      const rec = (i, left) => { if (distinct > MAX_TURNS) return; if (!left) { nodes++; if (lowerBound(cov, C) >= bestRaw()) { pruned++; return; } pickTurns(lens, end); return; } if (i === turns.length) return;
        for (let n = Math.min(MAX_PER - counts[turns[i].id], left); n >= 0; n--) { for (let x = 0; x < n; x++) add(turns[i], 1); rec(i + 1, left - n); for (let x = 0; x < n; x++) add(turns[i], -1); } };
      rec(0, k);
    };
    const lenSeqs = (k, R, minL, cur) => { if (!k) { if (R === 0) pickTurns(cur, 0); return; } for (const L of Ls) { if (L < minL) continue; if (L * k > R || R - L > (k - 1) * Ls[Ls.length - 1]) continue; cur.push(L); lenSeqs(k - 1, R - L, L, cur); cur.pop(); } };
    for (const O of osets) for (const Cc of csets) {
      for (const p of O) add(p, 1); for (const p of Cc) add(p, 1);
      if (distinct > MAX_TURNS) { for (const p of O) add(p, -1); for (const p of Cc) add(p, -1); continue; }
      if (total === null) {   // Sunday: not contracted, so the total is whatever the duties sum to, inside SUN_MIN..SUN_MAX
        const base = fixedMin + O.reduce((a, p) => a + p.L, 0) + Cc.reduce((a, p) => a + p.L, 0);
        for (const M of multisets(midPool, needM, MAX_PER)) { for (const p of M) add(p, 1); const tot = base + M.reduce((a, p) => a + p.L, 0);
          if (distinct <= MAX_TURNS && tot >= SUN_MIN && tot <= SUN_MAX) { const rec = evaluate(counts, cov, tot); if (rec) offer(rec); } for (const p of M) add(p, -1); }
      } else {
      const R = total - fixedMin - O.reduce((a, p) => a + p.L, 0) - Cc.reduce((a, p) => a + p.L, 0);
      if (needM === 0) { if (R === 0) leaf(); }
      else if (R >= needM * LO && R <= needM * HI && lowerBound(cov, C) < bestRaw()) lenSeqs(needM, R, 0, []);
      }
      for (const p of O) add(p, -1); for (const p of Cc) add(p, -1);
    }
  }
}
}

const t0 = Date.now();
if (CLS !== 'sun') {
  solve(FIXED, TOTAL, FIXED.map(([t]) => t));
} else {
  // The ticket office: 07:15–X x2 (two of the four openers) and Y–22:30 x2, with X ≥ Y. Every such pair, and every
  // Sunday total in the range, is enumerated.
  const earlies = POOL.filter(p => p.s === OPEN && p.e !== CLOSE), lates = POOL.filter(p => p.e === 22 * 60 + 30);
  for (const E of earlies) for (const Lt of lates) { if (E.e < Lt.s) continue;
    solve([[E.t, 2], [Lt.t, 2], ...FIXED], null, [Lt.t]); }
}
const ms = Date.now() - t0;
const show = (label, b) => { if (!b) { console.log(`  ${label}: none`); return; }
  console.log(`  ${label}: ${b.turns} turns · ${b.starts} starts + ${b.ends} finishes · ${b.closers} closers · fit ${b.fit} · pays ${b.total} · thinnest ${b.thin}`);
  console.log('    ' + b.duties.map(([t, n]) => `${t} x${n}`).join('  ')); };
console.log(`${CLS}: cap ${MAX_TURNS < 99 ? MAX_TURNS : 'none'} · fixed ${FIXED.map(([t, n]) => `${t} x${n}`).join(', ') || '(ticket office enumerated)'} · pool ${POOL.length} · floor ${FLOOR} · HI ${HI} · ${CLS === 'sun' ? `total ${SUN_MIN}–${SUN_MAX}` : `total ${TOTAL}`} · ${feasible.toLocaleString()} feasible tables scored · ${nodes.toLocaleString()} nodes (${pruned.toLocaleString()} pruned) · ${(ms / 1000).toFixed(1)}s`);
show('best', best);
if (process.env.LADDER === '1') for (const k of Object.keys(byTurns).sort((a, b) => a - b)) show(`${k} turns`, byTurns[k]);
if (process.env.OUT && best) writeFileSync(process.env.OUT, JSON.stringify({ cls: CLS, total: best.total, fit: best.fit, turns: best.turns, closers: best.closers, duties: best.duties, cap: MAX_TURNS, HI, floor: FLOOR, feasible }, null, 1));
if (!best) process.exit(1);
