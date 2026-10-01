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
//     22:00, the Office Written In reading), the ticket-office lates on a Sunday — so every OTHER duty finishes by 22:00
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
//     no start in the forty minutes after the open (the floor minimum replaced "thinnest hour never below today's").
//   · Monday to Friday is one table (the searched families' shape), and 5W + S = 42,000 exactly. Sunday is not
//     contracted, so its total is a range (SUN_MIN..SUN_MAX) and the fit decides within it.
//
// THE TICKET OFFICE IS NOT FLOOR COVER (owner, 27 Sep 2026, on reading the first Sunday): every fixed pair is the
// ticket office — weekday 06:20–14:20 and 14:00–22:30, Saturday 06:20–14:50 and 14:30–22:00, Sunday's earlies and
// lates — so they are left out of the cover the demand fit is measured on, and at least FLOOR_MIN (default 2) people
// must be on the floor at every five-minute point of the staffed day. They still count for the day's headcount, the
// openers, the closers, the five at 22:00 and the contract. The first Sunday found without this rule had all four
// openers finishing 14:20, two of them the office, so ONE person was on the floor from 14:20 to 15:15 — a table
// that fitted the curve beautifully and could not be worked. Sunday shifts are 8h to 9h (LO/HI), the owner's band:
// that same table paired 7h turns with one lone 9h30.
//
// THE PICK: demand fit (minutes-weighted, the folder's one measure — `dayFit` in report-data.mjs), then fewer
// distinct turns, then fewer distinct starts and finishes.
//
// THE SEARCH is exhaustive with a branch-and-bound on the fit, as quarter-table.mjs: every closer multiset x every
// opener multiset x every middle multiset paying the exact remainder; a partial table whose over-covered hours
// alone already lose to the incumbent is abandoned. Sunday's space is small enough to enumerate without a bound.
//   CLS=weekday TOTAL=7000 MAX_TURNS=7 node final-table.mjs     CLS=sat TOTAL=7000 …     CLS=sun MAX_TURNS=5 …
//
// TWO SWITCHES ADDED 28 SEP 2026, both off by default, so every table built before is built the same way:
//   · NEWPEN=<n> — prefer the shift times people work TODAY: every time in the table nobody works today costs n on
//     top of the fit, so the pick trades fit for familiarity at a stated rate (0.5–1 is nearly free; 2 roughly halves
//     the new times; 8 leaves four). The search bound adds the same penalty, so a returned table is still the best
//     under it. With TODAY=1 today's own clock times are in the pool, which a familiar table needs.
//   · AT22_STRICT=1 — five on AFTER 22:00, counted exactly as currentRules counts them. Without it the five at 22:00
//     is left to the fixed turns, and on a Saturday those are the office lates FINISHING at 22:00, which the rules do
//     not count: the option sweep found three tables that passed here and failed page 7 on exactly that.
// Familiar Nine (F9-24-K31) is table K: HI=540 TODAY=1 NEWPEN=2, the office kept off the floor as for Right Away —
// README → "Familiar Nine" has the commands.
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
const LO = Number(process.env.LO ?? (CLS === 'sun' ? 480 : 420)), HI = Number(process.env.HI ?? (CLS === 'sun' ? 540 : 570)), MAX_PER = 4;
const FLOOR_MIN = Number(process.env.FLOOR_MIN ?? 2);
// HANDOVER (owner, 27 Sep 2026, on the Sunday whose openers left at 15:15 as the closers arrived): every closer must
// arrive at least HANDOVER minutes before somebody already on the floor leaves — somebody who started earlier and is
// still there at closer-start + HANDOVER. The ticket office's own early pair must overlap its late pair by the same.   // people on the FLOOR (ticket office excluded) at every five-minute point
const HANDOVER = Number(process.env.HANDOVER ?? 15);
// On a Sunday the OPENERS themselves hand over (owner): every floor opener still on HANDOVER minutes after the
// closers arrive — a middle turn standing between them does not count. Weekday and Saturday openers cannot reach a
// 15:45 closer inside the 9h30 band, so there the general rule (someone already on the floor) is the handover.
const OPENER_HANDOVER = CLS === 'sun' && process.env.OPENER_HANDOVER !== '0';
// The ticket office's early pair overlaps its late pair by TO_HANDOVER (owner: 20 minutes). The owner's weekday and
// Saturday pairs already do, to the minute (14:00/14:20, 14:30/14:50); on a Sunday it is enforced here.
const TO_HANDOVER = Number(process.env.TO_HANDOVER ?? 20);
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

const T0 = today(); const todayRows = assess(T0.patterns, T0.lines).tableRows;   // today's clock times, for TODAY=1
// POOL: every legal turn on the grid.
const legalStartMin = s => s === OPEN || s >= OPEN + 40;
const onGrid = m => m % 15 === 0;
const extraOpenerEnds = [14 * 60 + 20, 14 * 60 + 50];
const TODAY_TIMES = process.env.TODAY === '1' ? new Set(todayRows.map(r => r.time)) : new Set();
const KNOWN = new Set(todayRows.map(r => r.time)); const NEWPEN = Number(process.env.NEWPEN ?? 0);
const POOL = []; const seenT = new Set();
const addTurn = (s, e) => { const L = e - s, t = `${hm(s)}-${hm(e)}`; if (seenT.has(t) || L < LO || L > HI || !legalStartMin(s) || e > CLOSE) return;
  const isC = e === CLOSE, isO = s === OPEN; 
  seenT.add(t); POOL.push({ s, e, L, t }); };
for (let s = OPEN; s < CLOSE; s++) { if (s !== OPEN && !onGrid(s)) continue; for (let e = s + LO; e <= CLOSE; e++) { if (e !== CLOSE && !onGrid(e)) continue; addTurn(s, e); } }
for (const e of extraOpenerEnds) addTurn(OPEN, e);
for (const t of TODAY_TIMES) { const [a, b] = t.split('-').map(mm); addTurn(a, b); }
for (const [t] of FIXED) { const [a, b] = t.split('-').map(mm); addTurn(a, b); }
POOL.forEach((p, i) => { p.id = i; p.cov = new Float64Array(24); p.slots = []; for (let m = p.s; m < p.e; m += 5) { p.cov[Math.floor(m / 60)] += 1 / 12; p.slots.push(m / 5); } });
const SLOT0 = OPEN / 5, SLOT1 = CLOSE / 5;
const byT = Object.fromEntries(POOL.map(p => [p.t, p]));

// WHEN THE TICKET OFFICE IS ON THE FLOOR (owner, 28 Sep 2026). One of each office pair helps on the floor at the quiet
// ends of its shift: on a weekday and a Saturday the second morning person until 08:00 and the second evening person
// from 19:30 to the end of the shift; on a Sunday the second morning person until 09:00, and the second evening person
// splits their shift between the office and the floor (owner, after two corrections: the office queues and the excess
// window are office work, so this is not "mostly floor"), counted as HALF a person on the floor for the whole shift —
// in the demand fit only; the floor minimum counts whole people. The rest of the office's time stays out of the floor
// cover. TO_EARLY_HELP / TO_LATE_HELP override (minutes; 'shift' for the whole shift), TO_LATE_SHARE the fraction.
const TO_EARLY_HELP = Number(process.env.TO_EARLY_HELP ?? (CLS === 'sun' ? 9 * 60 : 8 * 60));
const TO_LATE_HELP = process.env.TO_LATE_HELP !== undefined ? (process.env.TO_LATE_HELP === 'shift' ? 'shift' : Number(process.env.TO_LATE_HELP)) : (CLS === 'sun' ? 'shift' : 19 * 60 + 30);
const TO_LATE_SHARE = Number(process.env.TO_LATE_SHARE ?? (CLS === 'sun' ? 0.5 : 1));
// SUN_PLAN=1 — THE DECEMBER SUNDAY (owner, 29 Sep 2026): one early on the floor until 09:00; both lates on the floor
// from their start until 15:00, then both in the office, and one back on the floor from 18:00 to the end, a WHOLE
// person; the office handover at least 30 minutes, counted from 15:00. Off by default, so every table built before
// rebuilds exactly; report-data.mjs measures every sheet this way.
const SUN_PLAN = CLS === 'sun' && process.env.SUN_PLAN === '1';
function officeOnFloor(fixed) {
  const cov = new Float64Array(24), slots = new Int16Array(24 * 12); let minutes = 0;
  if (SUN_PLAN) { for (const [t, n] of fixed) { const p = byT[t]; if (n < 2) continue;
      const spans = p.s === OPEN ? [[p.s, Math.min(p.e, 9 * 60), 1]] : [[p.s, Math.min(p.e, 15 * 60), 2], [Math.max(p.s, 18 * 60), p.e, 1]];
      for (const [a, b, k] of spans) for (let m = a; m < b; m += 5) { cov[Math.floor(m / 60)] += k / 12; slots[m / 5] += k; minutes += 5 * k; } }
    return { cov, slots, minutes }; }
  for (const [t, n] of fixed) { const p = byT[t]; if (n < 2) continue;   // one of a PAIR helps; a lone fixed turn is not the office
    const from = p.s === OPEN ? p.s : TO_LATE_HELP === 'shift' ? p.s : Math.max(p.s, TO_LATE_HELP);
    const share = p.s === OPEN ? 1 : TO_LATE_SHARE;
    const to = p.s === OPEN ? Math.min(p.e, TO_EARLY_HELP) : p.e;
    for (let m = from; m < to; m += 5) { cov[Math.floor(m / 60)] += share / 12; if (share >= 1) slots[m / 5]++; minutes += 5 * share; } }
  return { cov, slots, minutes };
}

// The fit (dayFit's formula), and its lower bound from the over-covered hours.
const cars = DEC_2026_DEMAND[CLS].cars; const HRS = []; for (let h = Math.floor(OPEN / 60); h <= Math.floor((CLOSE - 1) / 60); h++) HRS.push(h);
const frac = h => Math.max(0, Math.min(CLOSE, (h + 1) * 60) - Math.max(OPEN, h * 60)) / 60;
const D = HRS.reduce((a, h) => a + cars[h] * frac(h), 0); const TSH = new Float64Array(24); for (const h of HRS) TSH[h] = cars[h] * frac(h) / D;
const fitOf = (cov, C) => { let f = 0; for (const h of HRS) { const d = TSH[h] - cov[h] / C; f += d * d; } return f * 1e4; };
const lowerBound = (cov, C) => { let f = 0; for (const h of HRS) { const d = cov[h] / C - TSH[h]; if (d > 0) f += d * d; } return f * 1e4; };

function handoverOk(counts, fixedCounts) {
  const floor = i => counts[i] - (fixedCounts ? fixedCounts[i] : 0);
  for (let i = 0; i < POOL.length; i++) { if (!floor(i) || POOL[i].e !== CLOSE) continue; const c = POOL[i].s;
    let ok = false; for (let j = 0; j < POOL.length && !ok; j++) { if (!floor(j) || POOL[j].e === CLOSE) continue; if (POOL[j].s < c && POOL[j].e >= c + HANDOVER) ok = true; }
    if (!ok) return false; }
  if (OPENER_HANDOVER) { let lastCloser = -Infinity; for (let i = 0; i < POOL.length; i++) if (floor(i) && POOL[i].e === CLOSE) lastCloser = Math.max(lastCloser, POOL[i].s);   // EVERY closer, not just the first
    for (let i = 0; i < POOL.length; i++) if (floor(i) && POOL[i].s === OPEN && POOL[i].e < lastCloser + HANDOVER) return false; }
  return true;
}
function evaluate(counts, cov, total, floorMin, floorSlots, fixedCounts) {
  let n = 0, nO = 0, nC = 0, turns = 0; const starts = new Set(), ends = new Set();
  for (let i = 0; i < POOL.length; i++) { const k = counts[i]; if (!k) continue; const p = POOL[i]; if (k > MAX_PER) return null;
    n += k; turns++; starts.add(p.s); ends.add(p.e); if (p.s === OPEN) nO += k; if (p.e === CLOSE) nC += k; }
  if (n !== N || nO < OPENERS_MIN || nO > OPENERS_MAX || nC < CLOSERS_MIN || nC > CLOSERS_MAX || turns > MAX_TURNS) return null;
  if (!handoverOk(counts, fixedCounts)) return null;
  if (process.env.AT22_STRICT === '1') { let at22 = 0; for (let i = 0; i < POOL.length; i++) if (counts[i] && POOL[i].s <= 1320 && POOL[i].e > 1320) at22 += counts[i]; if (at22 < 5) return null; }   // five on AFTER 22:00, counted as currentRules counts them
  let thin = Infinity; for (let k = SLOT0; k < SLOT1; k++) if (floorSlots[k] < thin) thin = floorSlots[k]; if (thin < FLOOR_MIN) return null;
  const fit = fitOf(cov, floorMin / 60);
  let newT = 0; for (let i = 0; i < POOL.length; i++) if (counts[i] && !KNOWN.has(POOL[i].t)) newT++;
  return { newT, fit: +fit.toFixed(1), fitRaw: fit, turns, total, thin: +thin.toFixed(2), starts: starts.size, ends: ends.size, closers: nC,
    duties: POOL.map((p, i) => [p.t, counts[i]]).filter(([, k]) => k).sort((a, b) => a[0].localeCompare(b[0])) };
}
const keyOf = r => (r.fitRaw + NEWPEN * r.newT) * 1e4 + r.turns * 10 + (r.starts + r.ends);
let best = null, feasible = 0, nodes = 0, pruned = 0; const byTurns = {};
const offer = rec => { if (!rec) return; feasible++; if (!byTurns[rec.turns] || keyOf(rec) < keyOf(byTurns[rec.turns])) byTurns[rec.turns] = rec; if (!best || keyOf(rec) < keyOf(best)) best = rec; };

function multisets(pool, k, maxPer) { const out = []; const rec = (i, left, cur) => { if (!left) { out.push(cur.slice()); return; } if (i === pool.length) return; for (let n = Math.min(maxPer, left); n >= 0; n--) { for (let x = 0; x < n; x++) cur.push(pool[i]); rec(i + 1, left - n, cur); for (let x = 0; x < n; x++) cur.pop(); } }; rec(0, k, []); return out; }

// Run one configuration: fixed duties (exact) + free openers/closers/middles paying `total` exactly.
function solve(fixed, total, exclude) {
  const counts = new Int32Array(POOL.length), cov = new Float64Array(24);
  let distinct = 0; const floorSlots = new Int16Array(24 * 12);
  // THE TICKET OFFICE IS NOT FLOOR COVER (owner, 27 Sep 2026): a fixed (ticket-office) duty counts for the headcount,
  // the openers, the closers and the contract, but adds nothing to the cover the demand fit and the floor minimum read.
  const add = (p, sgn, floor = true) => { if (sgn > 0 && counts[p.id] === 0) distinct++; counts[p.id] += sgn; if (sgn < 0 && counts[p.id] === 0) distinct--;
    if (floor) { for (let h = 0; h < 24; h++) cov[h] += sgn * p.cov[h]; for (const k of p.slots) floorSlots[k] += sgn; } };
  let fixedN = 0, fixedMin = 0, fixedO = 0, fixedC = 0; const fixedCounts = new Int32Array(POOL.length);
  for (const [t, n] of fixed) { const p = byT[t]; if (!p) throw new Error(`fixed ${t} not in pool`); for (let x = 0; x < n; x++) add(p, 1, false); fixedCounts[p.id] += n; fixedN += n; fixedMin += p.L * n; if (p.s === OPEN) fixedO += n; if (p.e === CLOSE) fixedC += n; }
  const office = officeOnFloor(fixed); for (let h = 0; h < 24; h++) cov[h] += office.cov[h]; for (let k = 0; k < floorSlots.length; k++) floorSlots[k] += office.slots[k];
  const floorFixed = office.minutes - fixedMin;   // add to a day's total to get its FLOOR minutes
  const ex = new Set(exclude);
  const openersPool = POOL.filter(p => p.s === OPEN && p.e !== CLOSE && !ex.has(p.t));
  const closersPool = POOL.filter(p => p.e === CLOSE && p.s !== OPEN && !ex.has(p.t) && (!CLOSER_ONLY || p.t === CLOSER_ONLY));
  const midPool = POOL.filter(p => p.s !== OPEN && p.e !== CLOSE && p.e <= MID_END_MAX && !ex.has(p.t));

  const midByL = {}; for (const p of midPool) (midByL[p.L] ??= []).push(p); const Ls = Object.keys(midByL).map(Number).sort((a, b) => a - b);
  const C = ((total ?? 0) + floorFixed) / 60; const bestRaw = () => !BOUND ? Infinity : best ? best.fitRaw + NEWPEN * best.newT - 1e-9 : BEST0;
  for (let needO = Math.max(0, OPENERS_MIN - fixedO); needO <= OPENERS_MAX - fixedO; needO++) {
  const osets = multisets(openersPool, needO, MAX_PER);
  for (let nC = Math.max(0, CLOSERS_MIN - fixedC); nC <= CLOSERS_MAX - fixedC; nC++) {
    const csets = multisets(closersPool, nC, MAX_PER);
    const needM = N - fixedN - needO - nC; if (needM < 0) continue;
    const leaf = () => { const rec = evaluate(counts, cov, total, total + floorFixed, floorSlots, fixedCounts); if (rec) offer(rec); };
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
          if (distinct <= MAX_TURNS && tot >= SUN_MIN && tot <= SUN_MAX) { const rec = evaluate(counts, cov, tot, tot + floorFixed, floorSlots, fixedCounts); if (rec) offer(rec); } for (const p of M) add(p, -1); }
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

// ---- ANNEAL=1: a fast local search for the SPLIT SWEEP (weekday and Saturday). It proves nothing; it estimates the best
// fit at each total in seconds so the exhaustive proof need only be run at the chosen split and its neighbours. Every
// candidate is judged by the same evaluate() as the enumeration, so it can only return tables the rules allow.
function annealSolve(fixed, total, exclude) {
  const ex = new Set(exclude);
  const openersPool = POOL.filter(p => p.s === OPEN && p.e !== CLOSE && !ex.has(p.t));
  const closersPool = POOL.filter(p => p.e === CLOSE && p.s !== OPEN && !ex.has(p.t) && (!CLOSER_ONLY || p.t === CLOSER_ONLY));
  const midPool = POOL.filter(p => p.s !== OPEN && p.e !== CLOSE && p.e <= MID_END_MAX && !ex.has(p.t));
  const fixedItems = []; for (const [t, n] of fixed) for (let x = 0; x < n; x++) fixedItems.push(byT[t]);
  const fixedMin = fixedItems.reduce((a, p) => a + p.L, 0), fixedO = fixedItems.filter(p => p.s === OPEN).length, fixedC = fixedItems.filter(p => p.e === CLOSE).length;
  const fixedCounts = new Int32Array(POOL.length); for (const p of fixedItems) fixedCounts[p.id]++;
  let seed = Number(process.env.SEED ?? 7) >>> 0 || 7; const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
  const pick = a => a[(rnd() * a.length) | 0];
  const roleOf = p => p.s === OPEN ? openersPool : p.e === CLOSE ? closersPool : midPool;
  const office = officeOnFloor(fixed);
  const record = free => { const counts = Int32Array.from(fixedCounts), cov = Float64Array.from(office.cov), slots = Int16Array.from(office.slots);
    for (const p of fixedItems) counts[p.id] += 0;
    for (const p of free) { counts[p.id]++; for (let h = 0; h < 24; h++) cov[h] += p.cov[h]; for (const k of p.slots) slots[k]++; }
    return evaluate(counts, cov, total, total - fixedMin + office.minutes, slots, fixedCounts); };
  const randomState = () => { for (let tries = 0; tries < 400; tries++) {
      const nO = OPENERS_MIN - fixedO + ((rnd() * (OPENERS_MAX - OPENERS_MIN + 1)) | 0), nC = CLOSERS_MIN - fixedC + ((rnd() * (CLOSERS_MAX - CLOSERS_MIN + 1)) | 0);
      const nM = N - fixedItems.length - nO - nC; if (nO < 0 || nC < 0 || nM < 0) continue;
      const free = [...Array.from({ length: nO }, () => pick(openersPool)), ...Array.from({ length: nC }, () => pick(closersPool)), ...Array.from({ length: nM }, () => pick(midPool))];
      let d = total - fixedMin - free.reduce((a, p) => a + p.L, 0), guard = 0;
      while (d !== 0 && guard++ < 60) { const i = (rnd() * free.length) | 0, p = free[i]; const step = Math.max(LO - p.L, Math.min(HI - p.L, d)); if (!step) continue;
        const cand = roleOf(p).filter(q => q.L === p.L + step); if (!cand.length) continue; free[i] = pick(cand); d -= step; }
      if (d === 0) return free; } return null; };
  const neighbour = free => { const f = free.slice(); const i = (rnd() * f.length) | 0, p = f[i]; const pool = roleOf(p);
    if (rnd() < 0.5) { const cand = pool.filter(q => q.L === p.L && q.id !== p.id); if (!cand.length) return null; f[i] = pick(cand); return f; }
    const q = pick(pool); if (q.id === p.id) return null; const d = q.L - p.L; f[i] = q; if (!d) return f;
    for (const j of f.map((_, k) => k).filter(k => k !== i).sort(() => rnd() - 0.5)) { const r = f[j], L2 = r.L - d; if (L2 < LO || L2 > HI) continue;
      const cand = roleOf(r).filter(x => x.L === L2); if (cand.length) { f[j] = pick(cand); return f; } }
    return null; };
  const energy = r => r.fitRaw + NEWPEN * r.newT + 0.02 * r.turns + 0.002 * (r.starts + r.ends);
  const MSR = Number(process.env.MS ?? 8000), RESTARTS = Number(process.env.RESTARTS ?? 8); const per = [];
  for (let run = 0; run < RESTARTS; run++) {
    let cur = null, rec = null; for (let t = 0; t < 200 && !rec; t++) { cur = randomState(); rec = cur && record(cur); }
    if (!rec) { per.push(null); continue; } offer(rec); let localBest = rec; const t0 = Date.now();
    while (Date.now() - t0 < MSR) { const frac = (Date.now() - t0) / MSR, temp = 4 * Math.pow(0.01 / 4, frac);
      const nx = neighbour(cur); if (!nx) continue; const r2 = record(nx); if (!r2) continue;
      if (energy(r2) <= energy(rec) || rnd() < Math.exp(-(energy(r2) - energy(rec)) / temp)) { cur = nx; rec = r2; offer(r2); if (keyOf(r2) < keyOf(localBest)) localBest = r2; } }
    per.push(localBest.fit); }
  console.log(`  anneal: ${RESTARTS} restarts x ${MSR} ms · per restart ${per.join(' ')}`);
}

const t0 = Date.now();
if (CLS !== 'sun' && process.env.ANNEAL === '1') {
  annealSolve(FIXED, TOTAL, FIXED.map(([t]) => t));
} else if (CLS !== 'sun') {
  solve(FIXED, TOTAL, FIXED.map(([t]) => t));
} else {
  // The ticket office: 07:15–X x2 (two of the four openers) and Y–22:30 x2, with X ≥ Y. Every such pair, and every
  // Sunday total in the range, is enumerated.
  const earlies = POOL.filter(p => p.s === OPEN && p.e !== CLOSE), lates = POOL.filter(p => p.e === 22 * 60 + 30);
  for (const E of earlies) for (const Lt of lates) { if (SUN_PLAN ? E.e < Math.max(Lt.s, 15 * 60) + 30 : E.e < Lt.s + TO_HANDOVER) continue;
    solve([[E.t, 2], [Lt.t, 2], ...FIXED], null, [Lt.t]); }
}
const ms = Date.now() - t0;
const show = (label, b) => { if (!b) { console.log(`  ${label}: none`); return; }
  console.log(`  ${label}: ${b.newT} new · ${b.turns} turns · ${b.starts} starts + ${b.ends} finishes · ${b.closers} closers · fit ${b.fit} · pays ${b.total} · fewest on the floor ${b.thin}`);
  console.log('    ' + b.duties.map(([t, n]) => `${t} x${n}`).join('  ')); };
console.log(`${CLS}: cap ${MAX_TURNS < 99 ? MAX_TURNS : 'none'} · fixed ${FIXED.map(([t, n]) => `${t} x${n}`).join(', ') || '(ticket office enumerated)'} · pool ${POOL.length} · floor ≥${FLOOR_MIN} (ticket office excluded) · ${LO}–${HI} min · ${CLS === 'sun' ? `total ${SUN_MIN}–${SUN_MAX}` : `total ${TOTAL}`} · ${feasible.toLocaleString()} feasible tables scored · ${nodes.toLocaleString()} nodes (${pruned.toLocaleString()} pruned) · ${(ms / 1000).toFixed(1)}s`);
show('best', best);
if (process.env.LADDER === '1') for (const k of Object.keys(byTurns).sort((a, b) => a - b)) show(`${k} turns`, byTurns[k]);
if (process.env.OUT && best) writeFileSync(process.env.OUT, JSON.stringify({ cls: CLS, newT: best.newT, total: best.total, fit: best.fit, turns: best.turns, closers: best.closers, duties: best.duties, cap: MAX_TURNS, LO, HI, floorMin: FLOOR_MIN, feasible }, null, 1));
if (!best) process.exit(1);
