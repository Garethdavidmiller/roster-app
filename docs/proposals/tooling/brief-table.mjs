// A day table to the OWNER'S BRIEF of 25 Sep 2026 — "start with today's roster" — for "Pinned Turns".
//
// THE BRIEF, as pins the search may not move:
//   Mon–Fri   every 23:55 finish starts 15:45 · three openers work 06:20–14:20 · two lates work 14:00–22:30
//             · no duty over 8h40
//   Saturday  two openers work 06:20 until AT LEAST 14:20 · one late works 14:00–22:30
//   Sunday    one duty works 13:00–21:30
// These REPLACE By the Book 2's ticket-office pins. Every other rule stands: four at the open, three through
// to the close (four on a Saturday), exactly five on after 22:00 Monday to Saturday, fourteen on a Saturday
// and ten on a Sunday, no :05 or :10 but the window's own, nothing finishing in the hour before the close
// unless it is a closer, nothing starting in the forty minutes after the open, an evening finish only at a
// time the ticket office closes — 22:00 or 22:30 on a weekday (both worked today), 22:30 on a Saturday
// (owner, 22 Sep 2026), 21:30 on a Sunday (the brief's own pin) — and the thinnest fully-covered hour never
// below today's. The 8h40 cap is applied to every day (the brief states it for Monday to Friday; HI=550
// lifts it on a weekend day to measure what that buys).
//
// THE POOL starts from today's roster: every clock time somebody works today, plus the quarter hours.
// THE PICK is the brief's: demand fit against the December 2026 timetable curve first, then fewer turns
// nobody works today, then fewer distinct turns. Every table made only of known turns is enumerated, then
// every table with one new turn (EXHAUSTIVE=0 skips both for a quick sweep), then a seeded search (MS ms).
//
// THE MINUTES. Monday to Saturday is an equality at 42,000 (20 lines x 35h), so a weekday total W and a
// Saturday total S are coupled: 5W + S = 42,000. TOTAL pins one day's figure; brief-sweep.sh walks W and
// picks the pair by 5 x weekday fit + Saturday fit. Sunday sits outside the contract (TOTAL_MIN..TOTAL_MAX).
//   CLS=weekday TOTAL=7000 node brief-table.mjs        CLS=sat TOTAL=7000 …        CLS=sun …
import { readFileSync, writeFileSync } from 'node:fs';
import { DEC_2026_DEMAND } from '../../../links-demand.js';
import { dayFit, today, assess } from './report-data.mjs';

const CLS = process.env.CLS ?? 'weekday';
if (!['weekday', 'sat', 'sun'].includes(CLS)) { console.error('CLS must be weekday, sat or sun'); process.exit(2); }
const mm = t => +t.slice(0, 2) * 60 + +t.slice(3);
const hm = m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const WIN = { weekday: [6*60+20, 23*60+55], sat: [6*60+20, 23*60+55], sun: [7*60+15, 23*60+25] }; const [OPEN, CLOSE] = WIN[CLS];
const N = { weekday: 14, sat: 14, sun: 10 }[CLS], OPENERS = 4, CLOSERS = { weekday: 3, sat: 4, sun: 3 }[CLS], AT22 = CLS === 'sun' ? null : 5;
// MOVE is a MEASUREMENT, not a design (25 Sep 2026). It was built to answer "would moving one or two turn times do
// better?" by letting the brief's own weekday times float, and found that closers at 15:15 would take the weekday
// fit from 33.8 to about 32.4, and 06:20-14:00 openers with them to about 30.9 -- and the owner then ruled that the
// 15:45 closer and the 06:20-14:20 openers were set for a reason and stay. The knob is kept for the record; nothing
// is built on it. The ticket-office pins (14:00-22:30, 13:00-21:30) never move;
// MOVE=openers lets the three 06:20-14:20 openers keep their count but choose ONE finish together; MOVE=closers
// lets the three 15:45-23:55 closers choose ONE start together; MOVE=both frees both. Weekday only — the
// weekend's other pins are counts, not times.
const MOVE = new Set((process.env.MOVE ?? '').split(',').filter(Boolean));
const PINS = { weekday: [...(MOVE.has('openers') || MOVE.has('both') ? [] : [['06:20-14:20', 3]]), ['14:00-22:30', 2], ...(MOVE.has('closers') || MOVE.has('both') ? [] : [['15:45-23:55', 3]])], sat: [['14:00-22:30', 1]], sun: [['13:00-21:30', 1]] }[CLS];
const SHARED_OPENERS = CLS === 'weekday' && (MOVE.has('openers') || MOVE.has('both')) ? 3 : 0;   // at least this many openers on ONE turn
const SHARED_CLOSERS = CLS === 'weekday' && (MOVE.has('closers') || MOVE.has('both'));            // every closer on ONE turn
const OPENER_MIN_END = CLS === 'sat' ? { count: 2, end: 14*60+20 } : null;   // "two openers on Saturday until at least 14:20"
const EVENING = { weekday: [22*60, 22*60+30], sat: [22*60+30], sun: [21*60+30] }[CLS];
const TOTAL_MIN = Number(process.env.TOTAL_MIN ?? process.env.TOTAL ?? (CLS === 'sun' ? 5100 : 7000)), TOTAL_MAX = Number(process.env.TOTAL_MAX ?? process.env.TOTAL ?? (CLS === 'sun' ? 5145 : 7000));
const LO = 420, HI = Number(process.env.HI ?? 520), MAX_PER = 4;
// FINE=n (25 Sep 2026, the owner's question tried again on the turns that are NOT pinned): the pool is the quarter
// hours plus today's clock times, so the one move the search cannot make is OFF that grid. FINE lets at most n turns
// take any legal five-minute time (still no :05 or :10, still the office-close rule); 0 keeps the grid.
const FINE = Number(process.env.FINE ?? 0);
const PICK = process.env.PICK ?? 'fit', EXHAUSTIVE = process.env.EXHAUSTIVE !== '0';

const T0 = today(); const todayRows = assess(T0.patterns, T0.lines).tableRows;
const TODAY = new Set(todayRows.map(r => r.time));
const knownStarts = new Set([...TODAY].map(t => mm(t.split('-')[0]))), knownEnds = new Set([...TODAY].map(t => mm(t.split('-')[1])));
const todayEvening = new Set(todayRows.filter(r => r[CLS] > 0).map(r => mm(r.time.split('-')[1])));
const legalMinute = m => m === OPEN || m === CLOSE || ![5, 10].includes(m % 60);
const legalEnd = e => e === CLOSE || (e <= CLOSE - 60 && (!(e > 21*60 && e < 23*60) || EVENING.includes(e) || (process.env.ALLOW_TODAY_ENDS && todayEvening.has(e))));
const legalStart = s => s === OPEN || s >= OPEN + 40;
const QUARTER = m => m === OPEN || m === CLOSE || m % 15 === 0;
const onGrid = p => (QUARTER(p.s) || knownStarts.has(p.s)) && (QUARTER(p.e) || knownEnds.has(p.e));
const fineStarts = FINE ? Array.from({ length: 121 }, (_, i) => 7*60 + 5*i) : [], fineEnds = FINE ? Array.from({ length: 112 }, (_, i) => 13*60+30 + 5*i) : [];
const STARTS = [...new Set([OPEN, ...Array.from({ length: 41 }, (_, i) => 7*60 + 15*i), ...knownStarts, ...fineStarts])].filter(s => s >= OPEN && s < CLOSE && legalMinute(s) && legalStart(s)).sort((a, b) => a - b);
const ENDS = [...new Set([CLOSE, ...Array.from({ length: 38 }, (_, i) => 13*60+30 + 15*i), ...knownEnds, ...EVENING, ...fineEnds])].filter(e => e > OPEN && e <= CLOSE && legalMinute(e) && legalEnd(e)).sort((a, b) => a - b);
const POOL = []; for (const s of STARTS) for (const e of ENDS) { const L = e - s; if (L >= LO && L <= HI) POOL.push({ s, e, L, t: `${hm(s)}-${hm(e)}` }); }
const byT = Object.fromEntries(POOL.map(p => [p.t, p]));
const pinned = PINS.map(([t, n]) => { const [a, b] = t.split('-'); return [{ s: mm(a), e: mm(b), L: mm(b) - mm(a), t }, n]; });
const PIN_N = pinned.reduce((a, [, n]) => a + n, 0), PIN_MIN = pinned.reduce((a, [p, n]) => a + p.L * n, 0);
const FREE = N - PIN_N;
const needO = OPENERS - pinned.filter(([p]) => p.s === OPEN).reduce((a, [, n]) => a + n, 0);
const needC = CLOSERS - pinned.filter(([p]) => p.e === CLOSE).reduce((a, [, n]) => a + n, 0);
const needM = FREE - needO - needC;
if (needO < 0 || needC < 0 || needM < 0) { console.error('pins exceed the roles'); process.exit(2); }
const KNOWN_POOL = POOL.filter(p => TODAY.has(p.t) || PINS.some(([t]) => t === p.t));

function cover(duties) { const c = new Array(24).fill(0); for (const [p, n] of duties) for (let m = p.s; m < p.e; m += 5) c[Math.floor(m/60)] += n / 12; return c; }
function thinnest(c) { let w = Infinity; for (let h = Math.floor(OPEN/60); h < Math.ceil(CLOSE/60); h++) { const frac = (Math.min(CLOSE, (h+1)*60) - Math.max(OPEN, h*60)) / 60; if (frac >= 0.99 && c[h] < w) w = c[h]; } return w; }
const todayDuties = todayRows.filter(r => r[CLS] > 0).map(r => [{ s: mm(r.time.split('-')[0]), e: mm(r.time.split('-')[1]) }, r[CLS]]);
const FLOOR = Number(process.env.FLOOR ?? thinnest(cover(todayDuties)).toFixed(2));

const seen = new Set(); let feasible = 0; const bestBy = { fit: null, known: null }; const byNew = {};
function consider(free) {   // free: [[pool, n], ...] — the pins are added here
  const duties = [...pinned, ...free]; const merged = new Map();
  for (const [p, n] of duties) merged.set(p.t, [p, (merged.get(p.t)?.[1] ?? 0) + n]);
  const all = [...merged.values()];
  const key = all.map(([p, n]) => `${p.t}x${n}`).sort().join(); if (seen.has(key)) return; seen.add(key);
  const count = all.reduce((a, [, n]) => a + n, 0); if (count !== N) return;
  const total = all.reduce((a, [p, n]) => a + p.L * n, 0); if (total < TOTAL_MIN || total > TOTAL_MAX) return;
  const openers = all.filter(([p]) => p.s === OPEN), nO = openers.reduce((a, [, n]) => a + n, 0); if (nO !== OPENERS) return;
  const nC = all.filter(([p]) => p.e === CLOSE).reduce((a, [, n]) => a + n, 0); if (nC !== CLOSERS) return;
  if (AT22 !== null) { const at22 = all.filter(([p]) => p.e > 22*60).reduce((a, [, n]) => a + n, 0); if (at22 !== AT22) return; }
  if (OPENER_MIN_END) { const late = openers.filter(([p]) => p.e >= OPENER_MIN_END.end).reduce((a, [, n]) => a + n, 0); if (late < OPENER_MIN_END.count) return; }
  if (SHARED_OPENERS && !openers.some(([, n]) => n >= SHARED_OPENERS)) return;
  if (all.filter(([p]) => !onGrid(p)).length > FINE) return;   // at most FINE turns off the quarter-hour grid
  if (SHARED_CLOSERS && all.filter(([p]) => p.e === CLOSE).length !== 1) return;
  const c = cover(all); const thin = thinnest(c); if (thin < FLOOR - 1e-9) return;
  const fit = dayFit(c, CLS); const turns = all.length; const fresh = all.filter(([p]) => !TODAY.has(p.t)).length;
  feasible++;
  const rec = { duties: all.map(([p, n]) => [p.t, n]).sort((a, b) => a[0].localeCompare(b[0])), fit, turns, fresh, total, thin: +thin.toFixed(2), offGrid: all.filter(([p]) => !onGrid(p)).map(([p]) => p.t),
    starts: new Set(all.map(([p]) => p.s)).size, ends: new Set(all.map(([p]) => p.e)).size };
  const kFit = fit * 1e4 + fresh * 100 + turns, kKnown = fresh * 1e6 + fit * 100 + turns;
  if (!bestBy.fit || kFit < bestBy.fit.k) bestBy.fit = { k: kFit, ...rec };
  if (!bestBy.known || kKnown < bestBy.known.k) bestBy.known = { k: kKnown, ...rec };
  if (!byNew[fresh] || kFit < byNew[fresh].k) byNew[fresh] = { k: kFit, ...rec };
}

// Exhaustive: every multiset of FREE duties from a pool, total-pruned (the pins are added by consider()).
function enumerate(pool) {
  const cur = []; const lo = TOTAL_MIN - PIN_MIN, hi = TOTAL_MAX - PIN_MIN;
  const rec = (i, left, total) => {
    if (left === 0) { if (total >= lo && total <= hi) consider(cur.slice()); return; }
    if (i === pool.length) return;
    const p = pool[i];
    for (let n = Math.min(MAX_PER, left); n >= 0; n--) {
      const t2 = total + p.L * n; if (t2 > hi) continue;
      if (t2 + (left - n) * HI < lo) continue;
      if (n) cur.push([p, n]); rec(i + 1, left - n, t2); if (n) cur.pop();
    }
  };
  rec(0, FREE, 0);
}
let knownFeasible = 0, oneNewFeasible = 0, oneNewMs = 0;
if (EXHAUSTIVE) {
  enumerate(KNOWN_POOL); knownFeasible = feasible;
  const t1 = Date.now(); for (const extra of POOL) if (!KNOWN_POOL.includes(extra)) enumerate([...KNOWN_POOL, extra]);
  oneNewFeasible = feasible - knownFeasible; oneNewMs = Date.now() - t1;
}

// Seeded random search over the whole pool, role-aware: draw distinct opener, closer and middle turns,
// then every composition of the role counts across them; repair the total by moving ONE duty's free end.
let _s = (Number(process.env.SEED ?? 7) >>> 0) || 7; const rnd = () => { _s ^= _s << 13; _s >>>= 0; _s ^= _s >> 17; _s ^= _s << 5; _s >>>= 0; return _s / 4294967296; };
const pick = a => a[(rnd() * a.length) | 0];
function comps(n, k, max) { if (k === 0) return n === 0 ? [[]] : []; if (k === 1) return n >= 1 && n <= max ? [[n]] : []; const out = []; for (let i = 1; i <= Math.min(max, n - (k - 1)); i++) for (const r of comps(n - i, k - 1, max)) out.push([i, ...r]); return out; }
const openersPool = POOL.filter(p => p.s === OPEN && p.e !== CLOSE), closersPool = POOL.filter(p => p.e === CLOSE && p.s !== OPEN), midPool = POOL.filter(p => p.s !== OPEN && p.e !== CLOSE);
const draw = (pool, k, used) => { const out = []; let guard = 0; while (out.length < k && guard++ < 60) { const p = pick(pool); if (used.has(p.t)) continue; used.add(p.t); out.push(p); } return out.length === k ? out : null; };
const t0 = Date.now(); const BUDGET = Number(process.env.MS ?? 150000); let sampled = 0;
const compCache = {}; const C = (n, k) => (compCache[`${n},${k}`] ??= comps(n, k, MAX_PER));
while (Date.now() - t0 < BUDGET) {
  const used = new Set();
  const kO = needO ? 1 + ((rnd() * Math.min(needO, 3)) | 0) : 0, kC = needC ? 1 + ((rnd() * Math.min(needC, 3)) | 0) : 0, kM = needM ? 1 + ((rnd() * Math.min(needM, 5)) | 0) : 0;
  const O = draw(openersPool, kO, used), Cc = draw(closersPool, kC, used), M = draw(midPool, kM, used); if (!O || !Cc || !M) continue;
  const turns = [...O, ...Cc, ...M];
  for (const co of C(needO, kO)) for (const cc of C(needC, kC)) for (const cm of C(needM, kM)) { sampled++;
    const cnt = [...co, ...cc, ...cm];
    const total = PIN_MIN + turns.reduce((a, p, i) => a + p.L * cnt[i], 0);
    if (total >= TOTAL_MIN && total <= TOTAL_MAX) { consider(turns.map((p, i) => [p, cnt[i]])); continue; }
    const want = total < TOTAL_MIN ? TOTAL_MIN : TOTAL_MAX, d = want - total;
    for (let i = 0; i < turns.length; i++) { const p = turns[i]; if (d % cnt[i]) continue; const step = d / cnt[i];
      const q = p.e === CLOSE ? byT[`${hm(p.s - step)}-${hm(p.e)}`] : byT[`${hm(p.s)}-${hm(p.e + step)}`];   // a closer moves its start, anything else its finish
      if (!q || turns.some((x, j) => j !== i && x.t === q.t)) continue;
      consider(turns.map((x, j) => [j === i ? q : x, cnt[j]])); }
  }
}
const show = (label, b) => { if (!b) { console.log(`  ${label}: none`); return; }
  console.log(`  ${label}: ${b.turns} turns · ${b.starts} starts + ${b.ends} finishes · ${b.fresh} new · fit ${b.fit} · pays ${b.total} · thinnest hour ${b.thin}${b.offGrid?.length ? ` · off the quarter hour: ${b.offGrid.join(', ')}` : ''}`);
  console.log('    ' + b.duties.map(([t, n]) => `${t} x${n}`).join('  ')); };
console.log(`${CLS}: ${MOVE.size ? `MOVE=${[...MOVE].join(',')} · ` : ''}${FINE ? `FINE=${FINE} · ` : ''}pins ${PINS.map(([t, n]) => `${t} x${n}`).join(', ')} · free ${FREE} (${needO} opener, ${needC} closer, ${needM} middle) · pool ${POOL.length} (${KNOWN_POOL.length} known) · known-only feasible ${EXHAUSTIVE ? knownFeasible : '—'} · one-new feasible ${EXHAUSTIVE ? `${oneNewFeasible} (${(oneNewMs/1000).toFixed(0)}s)` : '—'} · sampled ${sampled.toLocaleString()} · feasible ${feasible} · floor ${FLOOR} · total ${TOTAL_MIN}${TOTAL_MAX !== TOTAL_MIN ? `–${TOTAL_MAX}` : ''} · cap ${HI}`);
show('best by fit (then fewest new turns)', bestBy.fit); show('best by familiarity (fewest new turns, then fit)', bestBy.known);
console.log('  best fit at each count of new turns:'); for (const k of Object.keys(byNew).sort((a, b) => a - b)) show(`    ${k} new`, byNew[k]);
const chosen = bestBy[PICK]; if (!chosen) { if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify({ cls: CLS, total: TOTAL_MIN, feasible: 0 })); process.exit(1); }
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify({ cls: CLS, move: [...MOVE], total: chosen.total, fit: chosen.fit, fresh: chosen.fresh, turns: chosen.turns, duties: chosen.duties, counts: { pool: POOL.length, known: KNOWN_POOL.length, knownFeasible, oneNewFeasible, feasible, sampled }, floor: FLOOR, cap: HI, bestKnown: bestBy.known && { fit: bestBy.known.fit, fresh: bestBy.known.fresh, duties: bestBy.known.duties } }, null, 1));
console.log('JSON ' + JSON.stringify(chosen.duties.flatMap(([t, n]) => Array(n).fill(t))));
