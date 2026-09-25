// A day table to the OWNER'S BRIEF of 25 Sep 2026 with EVERY UNPINNED TIME ON THE QUARTER HOUR — "Pinned Turns 2".
//
// The owner's second question of the day: "What if you can rewrite the rest of the times apart from the pinned
// turns? But they must start and finish on non-confusing times." Pinned Turns kept today's clock times where it
// could (07:00–15:40, 06:20–14:50, 14:45–23:25); this search drops that aim entirely. The PINS stand exactly as
// briefed (Mon–Fri 06:20–14:20 x3, 14:00–22:30 x2, 15:45–23:55 x3 · Sat two openers from 06:20 until at least
// 14:20 and one 14:00–22:30 · Sun one 13:00–21:30); every other duty starts and finishes on :00, :15, :30 or :45,
// or at the window's own instants (06:20 open, 23:55 close; 07:15 and 23:25 on a Sunday). The one further time
// allowed is the owner's own pinned turn 06:20–14:20, which any day may use as an opener — it is a time the
// brief itself set, so it cannot be a confusing one.
//
// WHY THAT ONE EXCEPTION IS LOAD-BEARING. Monday to Saturday is an equality (5W + S = 42,000, 20 lines x 35h).
// On a pure quarter-hour grid every opener from 06:20 and every closer to 23:55 is 10 minutes off a multiple of
// fifteen and every middle turn is a multiple, so a weekday pays 10 mod 15 and a Saturday 5 mod 15, and no pair
// (W, S) balances — the contract is unreachable. Pinned Turns balanced it with today's 07:00–15:40; here the
// Saturday's opener count on 06:20–14:20 does it (measured in the header of the run, not assumed).
//
// THE RULES are Pinned Turns' (brief-table.mjs): four at the open, three through to the close (four on a Saturday),
// exactly five on after 22:00 Monday to Saturday, fourteen on a Saturday and ten on a Sunday, nothing finishing in
// the hour before the close unless it is a closer, nothing starting in the forty minutes after the open, an evening
// finish only at a ticket-office close (22:00 or 22:30 weekday, 22:30 Saturday, 21:30 Sunday), no duty over 8h40,
// no turn on more than four duties, the thinnest fully-covered hour never below today's.
//
// THE PICK: demand fit against the December 2026 timetable curve, then fewer distinct turns, then fewer distinct
// starts and finishes. Familiarity is NOT a criterion — the owner asked for the times to be rewritten.
//
// THE SEARCH is exhaustive where the space is countable and proven where it is not:
//   · every opener multiset x every closer multiset x every middle multiset paying the exact remainder, with a
//     branch-and-bound on the fit (an hour already over its traffic share can only get further over as duties are
//     added, so the squared gaps of the over-covered hours are a lower bound on the finished fit — a partial table
//     whose bound already beats the incumbent is abandoned). EXHAUSTIVE=0 skips it.
//   · a simulated anneal with restarts (MS ms per restart, RESTARTS of them) supplies the incumbent first and is
//     the answer on a day the enumeration does not finish; it is calibrated by whether it finds the enumerated
//     optimum on the days that do.
//   CLS=weekday TOTAL=6970 node quarter-table.mjs     CLS=sat TOTAL=7150 …     CLS=sun TOTAL_MIN=5100 TOTAL_MAX=5145 …
import { writeFileSync } from 'node:fs';
import { DEC_2026_DEMAND } from '../../../links-demand.js';
import { today, assess } from './report-data.mjs';

const CLS = process.env.CLS ?? 'weekday';
if (!['weekday', 'sat', 'sun'].includes(CLS)) { console.error('CLS must be weekday, sat or sun'); process.exit(2); }
const mm = t => +t.slice(0, 2) * 60 + +t.slice(3);
const hm = m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const WIN = { weekday: [6*60+20, 23*60+55], sat: [6*60+20, 23*60+55], sun: [7*60+15, 23*60+25] }; const [OPEN, CLOSE] = WIN[CLS];
const N = { weekday: 14, sat: 14, sun: 10 }[CLS], OPENERS = 4, CLOSERS = { weekday: 3, sat: 4, sun: 3 }[CLS], AT22 = CLS === 'sun' ? null : 5;
// PIN_WK / PIN_SAT / PIN_SUN override the brief's pins ("14:00-22:30x2,15:45-23:55x3"; "none" for no pins) — used to
// measure what each pin costs. SAT_OPENERS=0 drops the brief's "two Saturday openers to 14:20 or later"; EVENING=
// "21:30,22:00" overrides the day's allowed evening finishes. Measurement knobs: the defaults are the brief.
const parsePins = v => v === 'none' ? [] : v.split(',').filter(Boolean).map(x => { const [t, n] = x.split('x'); return [t, Number(n ?? 1)]; });
const PIN_ENV = { weekday: process.env.PIN_WK, sat: process.env.PIN_SAT, sun: process.env.PIN_SUN }[CLS];
const PINS = PIN_ENV ? parsePins(PIN_ENV) : { weekday: [['06:20-14:20', 3], ['14:00-22:30', 2], ['15:45-23:55', 3]], sat: [['14:00-22:30', 1]], sun: [['13:00-21:30', 1]] }[CLS];
const OPENER_MIN_END = CLS === 'sat' && process.env.SAT_OPENERS !== '0' ? { count: 2, end: 14*60+20 } : null;
const EVENING = process.env.EVENING ? process.env.EVENING.split(',').map(mm) : { weekday: [22*60, 22*60+30], sat: [22*60+30], sun: [21*60+30] }[CLS];
const TOTAL_MIN = Number(process.env.TOTAL_MIN ?? process.env.TOTAL ?? (CLS === 'sun' ? 5100 : 7000)), TOTAL_MAX = Number(process.env.TOTAL_MAX ?? process.env.TOTAL ?? (CLS === 'sun' ? 5145 : 7000));
const LO = 420, HI = Number(process.env.HI ?? 520), MAX_PER = 4;
const EXHAUSTIVE = process.env.EXHAUSTIVE !== '0', MS = Number(process.env.MS ?? 20000), RESTARTS = Number(process.env.RESTARTS ?? 12);
// BOUND=0 disables the branch-and-bound, so the enumeration visits EVERY feasible table and the count it reports is the
// true size of the space rather than the number the bound let through — slower, and the only way to state that figure.
const BOUND = process.env.BOUND !== '0';
// MAX_TURNS=n caps the DISTINCT TURNS a day may work (pins included) — "a sensible number of shift times, not too complex"
// (owner, 25 Sep 2026). It is a hard rule, not a tie-break, so that the bound is taken against the best table UNDER the
// cap: with the cap as a mere preference, a seven-turn table could be pruned by a nine-turn incumbent it would have beaten.
const MAX_TURNS = Number(process.env.MAX_TURNS ?? 99);

const T0 = today(); const todayRows = assess(T0.patterns, T0.lines).tableRows; const TODAY = new Set(todayRows.map(r => r.time));
const legalEnd = e => e === CLOSE || (e <= CLOSE - 60 && (!(e > 21*60 && e < 23*60) || EVENING.includes(e)));
const legalStart = s => s === OPEN || s >= OPEN + 40;
const STARTS = [OPEN]; for (let m = OPEN + 40; m < CLOSE; m++) if (m % 15 === 0) STARTS.push(m);
const ENDS = [CLOSE]; for (let m = OPEN; m < CLOSE; m++) if (m % 15 === 0 && legalEnd(m)) ENDS.push(m);
const POOL = []; for (const s of STARTS) for (const e of ENDS) { const L = e - s; if (L >= LO && L <= HI && legalStart(s)) POOL.push({ s, e, L, t: `${hm(s)}-${hm(e)}` }); }
if (CLS !== 'sun') POOL.push({ s: OPEN, e: 14*60+20, L: 480, t: '06:20-14:20' });   // the owner's own pinned turn, usable as an opener on any day
POOL.forEach((p, i) => { p.id = i; p.cov = new Float64Array(24); for (let m = p.s; m < p.e; m += 5) p.cov[Math.floor(m/60)] += 1/12; });
const byT = Object.fromEntries(POOL.map(p => [p.t, p]));
const pinned = PINS.map(([t, n]) => { const p = byT[t]; if (!p) throw new Error(`pin ${t} is not in the pool`); return [p, n]; });
const PIN_N = pinned.reduce((a, [, n]) => a + n, 0), PIN_MIN = pinned.reduce((a, [p, n]) => a + p.L * n, 0);
const FREE = N - PIN_N;
const needO = OPENERS - pinned.filter(([p]) => p.s === OPEN).reduce((a, [, n]) => a + n, 0);
const needC = CLOSERS - pinned.filter(([p]) => p.e === CLOSE).reduce((a, [, n]) => a + n, 0);
const needM = FREE - needO - needC;
const pinAt22 = AT22 === null ? 0 : pinned.filter(([p]) => p.e > 22*60 && p.e !== CLOSE).reduce((a, [, n]) => a + n, 0);
const midAt22 = AT22 === null ? Infinity : AT22 - CLOSERS - pinAt22;   // how many MIDDLE duties may still be on after 22:00
if (needO < 0 || needC < 0 || needM < 0 || midAt22 < 0) { console.error('pins exceed the roles'); process.exit(2); }
const openersPool = POOL.filter(p => p.s === OPEN && p.e !== CLOSE), closersPool = POOL.filter(p => p.e === CLOSE && p.s !== OPEN);
const midPool = POOL.filter(p => p.s !== OPEN && p.e !== CLOSE && (midAt22 > 0 || p.e <= 22*60));

// The fit, incrementally: hours in the window, each hour's traffic share, and the cover C = total/60.
const cars = DEC_2026_DEMAND[CLS].cars; const HRS = []; for (let h = Math.floor(OPEN/60); h <= Math.floor((CLOSE-1)/60); h++) HRS.push(h);
const frac = h => Math.max(0, Math.min(CLOSE, (h+1)*60) - Math.max(OPEN, h*60)) / 60;
const D = HRS.reduce((a, h) => a + cars[h]*frac(h), 0); const T = new Float64Array(24); for (const h of HRS) T[h] = cars[h]*frac(h)/D;
const FULL = HRS.filter(h => frac(h) >= 0.99);
const fitOf = (cov, C) => { let f = 0; for (const h of HRS) { const d = T[h] - cov[h]/C; f += d*d; } return f * 1e4; };
const lowerBound = (cov, C) => { let f = 0; for (const h of HRS) { const d = cov[h]/C - T[h]; if (d > 0) f += d*d; } return f * 1e4; };
const todayDuties = todayRows.filter(r => r[CLS] > 0).map(r => [{ s: mm(r.time.split('-')[0]), e: mm(r.time.split('-')[1]) }, r[CLS]]);
const thinnestOf = duties => { const c = new Array(24).fill(0); for (const [p, n] of duties) for (let m = p.s; m < p.e; m += 5) c[Math.floor(m/60)] += n/12; return Math.min(...FULL.map(h => c[h])); };
const FLOOR = Number(process.env.FLOOR ?? thinnestOf(todayDuties).toFixed(2));

// A finished table: counts per pool id (pins included). Returns its record or null when a rule fails.
const pinCounts = new Int32Array(POOL.length); for (const [p, n] of pinned) pinCounts[p.id] += n;
const pinCov = new Float64Array(24); for (const [p, n] of pinned) for (let h = 0; h < 24; h++) pinCov[h] += p.cov[h]*n;
function evaluate(counts, cov) {   // counts and cov INCLUDE the pins
  let total = 0, n = 0, nO = 0, nC = 0, at22 = 0, lateO = 0, turns = 0, fresh = 0; const starts = new Set(), ends = new Set();
  for (let i = 0; i < POOL.length; i++) { const k = counts[i]; if (!k) continue; const p = POOL[i]; if (k > MAX_PER) return null;
    total += p.L*k; n += k; turns++; starts.add(p.s); ends.add(p.e); if (!TODAY.has(p.t)) fresh++;
    if (p.s === OPEN) { nO += k; if (OPENER_MIN_END && p.e >= OPENER_MIN_END.end) lateO += k; } if (p.e === CLOSE) nC += k; if (p.e > 22*60) at22 += k; }
  if (n !== N || total < TOTAL_MIN || total > TOTAL_MAX || nO !== OPENERS || nC !== CLOSERS || turns > MAX_TURNS) return null;
  if (AT22 !== null && at22 !== AT22) return null; if (OPENER_MIN_END && lateO < OPENER_MIN_END.count) return null;
  let thin = Infinity; for (const h of FULL) if (cov[h] < thin) thin = cov[h]; if (thin < FLOOR - 1e-9) return null;
  const fit = fitOf(cov, total/60);
  return { fit: +fit.toFixed(1), fitRaw: fit, turns, fresh, total, thin: +thin.toFixed(2), starts: starts.size, ends: ends.size,
    duties: POOL.map((p, i) => [p.t, counts[i]]).filter(([, k]) => k).sort((a, b) => a[0].localeCompare(b[0])) };
}
const keyOf = r => r.fitRaw * 1e4 + r.turns * 10 + (r.starts + r.ends);   // the pick
let best = null, feasible = 0, annealDistinct = 0; const seen = new Set(); const byTurns = {};
// feasible counts the exhaustive enumeration's finished tables that pass every rule (each is distinct by construction: the
// role pools are disjoint and multisets are enumerated once). The anneal's distinct tables are counted separately, in a
// set capped well below the engine's limit — at 7,075 minutes the uncapped set overflowed at ~16.7M entries.
function offer(rec, exhaustive = false) { if (!rec) return false; if (exhaustive) feasible++; else if (seen.size < 4e6) { const k = rec.duties.map(([t, n]) => `${t}x${n}`).join(); if (!seen.has(k)) { seen.add(k); annealDistinct++; } }
  if (!byTurns[rec.turns] || keyOf(rec) < keyOf(byTurns[rec.turns])) byTurns[rec.turns] = rec;
  if (!best || keyOf(rec) < keyOf(best)) { best = rec; return true; } return false; }

// ---- anneal: state = free duties as pool ids by role; moves keep every count and repair the total ----
let _s = (Number(process.env.SEED ?? 7) >>> 0) || 7; const rnd = () => { _s ^= _s << 13; _s >>>= 0; _s ^= _s >> 17; _s ^= _s << 5; _s >>>= 0; return _s / 4294967296; };
const pick = a => a[(rnd() * a.length) | 0];
const roleOf = p => p.s === OPEN ? openersPool : p.e === CLOSE ? closersPool : midPool;
function randomState() {   // random free duties whose lengths pay the exact remainder; null if this draw cannot
  for (let tries = 0; tries < 200; tries++) {
    const free = [...Array.from({ length: needO }, () => pick(openersPool)), ...Array.from({ length: needC }, () => pick(closersPool)), ...Array.from({ length: needM }, () => pick(midPool))];
    let total = PIN_MIN + free.reduce((a, p) => a + p.L, 0); const want = total < TOTAL_MIN ? TOTAL_MIN : total > TOTAL_MAX ? TOTAL_MAX : total;
    let d = want - total; let guard = 0;
    while (d !== 0 && guard++ < 40) { const i = (rnd() * free.length) | 0, p = free[i]; const step = Math.max(-p.L + LO, Math.min(HI - p.L, d)); const cand = roleOf(p).filter(q => q.L === p.L + step && (p.s === OPEN ? true : p.e === CLOSE ? true : (q.s === p.s || q.e === p.e)));
      if (!cand.length) continue; free[i] = pick(cand); d -= step; }
    if (d === 0) return free;
  }
  return null;
}
function stateRecord(free) { const counts = Int32Array.from(pinCounts), cov = Float64Array.from(pinCov); for (const p of free) { counts[p.id]++; for (let h = 0; h < 24; h++) cov[h] += p.cov[h]; } return evaluate(counts, cov); }
function neighbour(free) {
  const f = free.slice(); const i = (rnd() * f.length) | 0, p = f[i]; const pool = roleOf(p);
  if (rnd() < 0.5) { const cand = pool.filter(q => q.L === p.L && q.id !== p.id); if (!cand.length) return null; f[i] = pick(cand); return f; }   // slide: same length, other clock
  const q = pick(pool); if (q.id === p.id) return null; const d = q.L - p.L; f[i] = q; if (!d) return f;
  const order = f.map((_, j) => j).filter(j => j !== i).sort(() => rnd() - 0.5);
  for (const j of order) { const r = f[j]; const L2 = r.L - d; if (L2 < LO || L2 > HI) continue;
    const cand = roleOf(r).filter(x => x.L === L2 && (r.s === OPEN || r.e === CLOSE || x.s === r.s || x.e === r.e)); if (!cand.length) continue; f[j] = pick(cand); return f; }
  return null;
}
const energy = r => r.fitRaw + 0.02 * r.turns + 0.002 * (r.starts + r.ends);
let annealSteps = 0, hits = 0, restartBest = [];
function anneal() {
  for (let run = 0; run < RESTARTS; run++) {
    let cur = null, curRec = null; for (let t = 0; t < 50 && !curRec; t++) { cur = randomState(); curRec = cur && stateRecord(cur); }
    if (!curRec) { restartBest.push(null); continue; }
    offer(curRec); let localBest = curRec; const t0 = Date.now(); const T0 = 4, T1 = 0.01;
    while (Date.now() - t0 < MS) { annealSteps++;
      const frac = (Date.now() - t0) / MS; const temp = T0 * Math.pow(T1 / T0, frac);
      const nx = neighbour(cur); if (!nx) continue; const rec = stateRecord(nx); if (!rec) continue;
      const dE = energy(rec) - energy(curRec); if (dE <= 0 || rnd() < Math.exp(-dE / temp)) { cur = nx; curRec = rec; if (keyOf(rec) < keyOf(localBest)) localBest = rec; offer(rec); }
    }
    restartBest.push(localBest.fit);
  }
  const b = best?.fit; hits = restartBest.filter(f => f !== null && f <= b + 0.05).length;
}

// ---- exhaustive with branch-and-bound ----
function multisets(pool, k, maxPer) { const out = []; const rec = (i, left, cur) => { if (!left) { out.push(cur.slice()); return; } if (i === pool.length) return; for (let n = Math.min(maxPer, left); n >= 0; n--) { for (let x = 0; x < n; x++) cur.push(pool[i]); rec(i + 1, left - n, cur); for (let x = 0; x < n; x++) cur.pop(); } }; rec(0, k, []); return out; }
let nodes = 0, pruned = 0, leaves = 0, exhaustiveDone = false;
function exhaustive() {
  const midByL = {}; for (const p of midPool) (midByL[p.L] ??= []).push(p); const Ls = Object.keys(midByL).map(Number).sort((a, b) => a - b);
  const osets = multisets(openersPool, needO, MAX_PER).filter(o => !OPENER_MIN_END || o.filter(p => p.e >= OPENER_MIN_END.end).length >= OPENER_MIN_END.count);
  const csets = multisets(closersPool, needC, MAX_PER);
  const counts = Int32Array.from(pinCounts), cov = Float64Array.from(pinCov);
  const add = (p, sgn) => { counts[p.id] += sgn; for (let h = 0; h < 24; h++) cov[h] += sgn * p.cov[h]; };
  const C = TOTAL_MIN / 60;   // exact total ⇒ the cover denominator is known from the start
  const bestRaw = () => BOUND && best ? best.fitRaw - 0.05 : Infinity;
  // middles: choose a non-decreasing length sequence paying R, then turns of each length as a multiset
  const chosen = [];
  const leaf = () => { leaves++; const rec = evaluate(counts, cov); if (rec) offer(rec, true); };
  const pickTurns = (li, lens, pos) => {   // lens: array of lengths (sorted); pos: index in lens; choose turns for lens[pos..] grouped by equal length
    if (pos === lens.length) { leaf(); return; }
    let end = pos; while (end < lens.length && lens[end] === lens[pos]) end++; const k = end - pos; const turns = midByL[lens[pos]];
    const rec = (i, left) => { if (!left) { nodes++; if (lowerBound(cov, C) >= bestRaw()) { pruned++; return; } pickTurns(li, lens, end); return; } if (i === turns.length) return;
      for (let n = Math.min(MAX_PER - counts[turns[i].id], left); n >= 0; n--) { for (let x = 0; x < n; x++) add(turns[i], 1); rec(i + 1, left - n); for (let x = 0; x < n; x++) add(turns[i], -1); } };
    rec(0, k);
  };
  const lenSeqs = (k, R, minL, cur) => { if (!k) { if (R === 0) pickTurns(0, cur, 0); return; } for (const L of Ls) { if (L < minL) continue; if (L * k > R || R - L > (k - 1) * Ls[Ls.length - 1]) continue; cur.push(L); lenSeqs(k - 1, R - L, L, cur); cur.pop(); } };
  let combos = 0;
  for (const O of osets) for (const Cc of csets) { combos++;
    for (const p of O) add(p, 1); for (const p of Cc) add(p, 1);
    const R = TOTAL_MIN - PIN_MIN - O.reduce((a, p) => a + p.L, 0) - Cc.reduce((a, p) => a + p.L, 0);
    if (R >= needM * LO && R <= needM * HI && lowerBound(cov, C) < bestRaw()) { if (TOTAL_MIN === TOTAL_MAX) lenSeqs(needM, R, 0, []); else for (let r = R; r >= R - (TOTAL_MAX - TOTAL_MIN); r -= 15) if (r >= needM * LO) lenSeqs(needM, r, 0, []); }
    for (const p of O) add(p, -1); for (const p of Cc) add(p, -1);
    if (process.env.DEADLINE && Date.now() > Number(process.env.DEADLINE)) { console.log(`  exhaustive stopped at the deadline after ${combos} of ${osets.length * csets.length} opener/closer combinations`); return; }
  }
  exhaustiveDone = true; console.log(`  exhaustive: ${osets.length} opener sets x ${csets.length} closer sets = ${combos} combinations · ${nodes.toLocaleString()} bounded nodes (${pruned.toLocaleString()} pruned) · ${leaves.toLocaleString()} finished tables evaluated`);
}

const t0 = Date.now(); anneal(); const annealMs = Date.now() - t0; const annealBest = best?.fit ?? null;
if (EXHAUSTIVE && TOTAL_MIN === TOTAL_MAX) exhaustive(); else if (EXHAUSTIVE) exhaustive();
const show = (label, b) => { if (!b) { console.log(`  ${label}: none`); return; }
  console.log(`  ${label}: ${b.turns} turns · ${b.starts} starts + ${b.ends} finishes · ${b.fresh} new · fit ${b.fit} · pays ${b.total} · thinnest hour ${b.thin}`);
  console.log('    ' + b.duties.map(([t, n]) => `${t} x${n}`).join('  ')); };
console.log(`${CLS}: ${MAX_TURNS < 99 ? `at most ${MAX_TURNS} distinct turns · ` : ''}pins ${PINS.map(([t, n]) => `${t} x${n}`).join(', ')} · free ${FREE} (${needO} opener, ${needC} closer, ${needM} middle) · pool ${POOL.length} (${openersPool.length} opener, ${closersPool.length} closer, ${midPool.length} middle turns) · floor ${FLOOR} · total ${TOTAL_MIN}${TOTAL_MAX !== TOTAL_MIN ? `–${TOTAL_MAX}` : ''} · cap ${HI}`);
console.log(`  anneal: ${RESTARTS} restarts x ${MS} ms · ${annealSteps.toLocaleString()} steps · best ${annealBest} · restarts within 0.05 of the final best: ${hits} of ${RESTARTS} · per restart ${restartBest.join(' ')}`);
console.log(`  feasible tables ${exhaustiveDone ? (BOUND ? `finished and scored ${feasible.toLocaleString()} (the bound abandoned ${pruned.toLocaleString()} partial tables as provably worse; BOUND=0 counts them all)` : `${feasible.toLocaleString()} — every one, no bound`) : `seen by the anneal ${annealDistinct.toLocaleString()}`} · exhaustive ${exhaustiveDone ? 'COMPLETE — the best is proven' : EXHAUSTIVE ? 'incomplete' : 'skipped'}${exhaustiveDone && annealBest !== null ? ` · anneal ${annealBest === best.fit ? 'found the optimum' : `stopped at ${annealBest}, optimum ${best.fit}`}` : ''}`);
show('best by fit (then fewest turns)', best);
console.log('  best at each count of distinct turns:'); for (const k of Object.keys(byTurns).sort((a, b) => a - b)) show(`    ${k} turns`, byTurns[k]);
if (!best) { if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify({ cls: CLS, total: TOTAL_MIN, feasible: 0 })); process.exit(1); }
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify({ cls: CLS, grid: 'quarter', total: best.total, fit: best.fit, fresh: best.fresh, turns: best.turns, duties: best.duties,
  maxTurns: MAX_TURNS < 99 ? MAX_TURNS : null, counts: { pool: POOL.length, openerTurns: openersPool.length, closerTurns: closersPool.length, middleTurns: midPool.length, feasible: exhaustiveDone ? feasible : annealDistinct, bounded: BOUND, exhaustive: exhaustiveDone, nodes, leaves, pruned, restarts: RESTARTS, msPerRestart: MS, annealSteps, annealBest, hits }, floor: FLOOR, cap: HI,
  byTurns: Object.fromEntries(Object.entries(byTurns).map(([k, r]) => [k, { fit: r.fit, fresh: r.fresh, starts: r.starts, ends: r.ends, duties: r.duties }])) }, null, 1));
console.log('JSON ' + JSON.stringify(best.duties.flatMap(([t, n]) => Array(n).fill(t))));
