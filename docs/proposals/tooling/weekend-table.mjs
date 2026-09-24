// A SATURDAY or SUNDAY table for "Quarter To 2" — Quarter To with the weekend genuinely rebuilt.
//
// WHY. Quarter To (QT-24-Q34) applied its two asks — the closer at 15:45, nothing over 8h40 — to the
// weekday only; Saturday and Sunday were Same Turns' tables carried over, and two of their turns
// (14:45-23:55, 9h10; 14:30-23:25, 8h55) are over the cap the sheet is named for. Its page 6 says so, and
// says a rebuilt weekend is "a different proposal". This is that proposal's weekend.
//
// WHAT IS FIXED. Saturday pays 7,100 minutes — the Q weekday pays 6,980 and Monday to Saturday must
// come to 42,000 (20 lines x 35h), an equality — with 14 duties, four at the 06:20 open, four through to
// the 23:55 close and EXACTLY five on after 22:00 (the December rules as the sheets' rule rows read
// them). Sunday sits outside the contract: 10 duties, four at 07:15, three through to 23:25, and a total
// within TOTAL_MIN..TOTAL_MAX (default 5,100..5,145 — Quarter To's own Sunday pays 5,145, and a person's
// Sunday should not shrink by more than the cap itself takes off the closers). Every duty 7h00–8h40.
//
// THE POOL, in Quarter To's spirit. Starts and finishes are the quarter hours plus every clock time
// somebody works TODAY (13:35, 14:50, 13:45 …) plus the window instants; no :05 or :10 except the open
// and close. A finish between 21:00 and 23:00 must be when the ticket office closes — 22:30 on a
// Saturday (owner, 22 Sep 2026, sat-table.mjs) and 22:00 on a Sunday (the hour By the Book 2's Sunday
// pair is pinned to). The thinnest fully-covered hour may not fall below today's (FLOOR).
//
// THE PICK. Quarter To's identity is familiarity — 12 of its 13 turns are worked today — so the default
// order is: fewest turns that are NEW (not on today's roster and not on the Q weekday), then demand fit
// against the December curve, then fewer distinct turns. PICK=fit reverses the first two. Both bests are
// printed, so the trade is on the record whichever is taken.
//
// TWO PASSES. First every multiset of KNOWN turns is enumerated exhaustively — if a weekend can be built
// entirely from times people already work, the search must find it rather than hope to. Then a seeded
// random search over the whole pool (MS milliseconds, default 150,000) looks for a better fit at each
// count of new turns.
//   CLS=sat node weekend-table.mjs      CLS=sun node weekend-table.mjs      → JSON line on stdout
import { readFileSync } from 'node:fs';
import { DEC_2026_DEMAND } from '../../../links-demand.js';
import { dayFit, today, assess } from './report-data.mjs';

const CLS = process.env.CLS ?? 'sat';
if (!['sat', 'sun'].includes(CLS)) { console.error('CLS must be sat or sun'); process.exit(2); }
const WIN = { sat: [6*60+20, 23*60+55], sun: [7*60+15, 23*60+25] }; const [OPEN, CLOSE] = WIN[CLS];
const N = { sat: 14, sun: 10 }[CLS], OPENERS = 4, CLOSERS = { sat: 4, sun: 3 }[CLS], AT22 = CLS === 'sat' ? 5 : null;
const TOTAL_MIN = Number(process.env.TOTAL_MIN ?? (CLS === 'sat' ? 7100 : 5100)), TOTAL_MAX = Number(process.env.TOTAL_MAX ?? (CLS === 'sat' ? 7100 : 5145));
const OFFICE_CLOSE = { sat: 22*60+30, sun: 22*60 }[CLS];
const LO = 420, HI = 520, MAX_PER = 4;
const PICK = process.env.PICK ?? 'known';
// FIT_CEILING: the familiarity pick only considers tables at least as even as the day Quarter To
// inherited (its Saturday 32.7, its Sunday 80.6 — read from best-Q-34, never typed). A weekend rebuilt
// "under the cap" that follows the timetable WORSE than the one it replaces is not a rebuild.
const hm = m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const mm = t => +t.slice(0, 2) * 60 + +t.slice(3);

// KNOWN turns: today's whole table plus the Q weekday (the table this weekend will sit beside).
const T0 = today(); const todayRows = assess(T0.patterns, T0.lines).tableRows;
const Q = JSON.parse(readFileSync('results/best-Q-34.json', 'utf8')); const qRows = assess(Q.patterns, 24).tableRows.filter(r => r.weekday > 0);
const KNOWN = new Set([...todayRows.map(r => r.time), ...qRows.map(r => r.time)]);
const QT_FIT = assess(Q.patterns, 24).fits[CLS]; const FIT_CEILING = Number(process.env.FIT_CEILING ?? QT_FIT);
const knownStarts = new Set([...KNOWN].map(t => mm(t.split('-')[0]))), knownEnds = new Set([...KNOWN].map(t => mm(t.split('-')[1])));
const legalMinute = m => m === OPEN || m === CLOSE || ![5, 10].includes(m % 60);
// No de-facto closer: nothing finishes in the hour before the close unless it IS a closer (table-book.mjs's
// rule; the first run of this search returned a 16:15-23:25 Saturday turn, thirty minutes short of the
// station's close, which is exactly the turn that rule exists to refuse). ALLOW_TODAY_ENDS=1 admits an
// evening finish somebody works today (Saturday's 14:30-22:00) even where the office rule would not.
const todayEvening = new Set(todayRows.filter(r => r[CLS] > 0).map(r => mm(r.time.split('-')[1])));
const legalEnd = e => e === CLOSE || (e <= CLOSE - 60 && (!(e > 21*60 && e < 23*60) || e === OFFICE_CLOSE || (process.env.ALLOW_TODAY_ENDS && todayEvening.has(e))));
const STARTS = [...new Set([OPEN, ...Array.from({ length: 41 }, (_, i) => 7*60 + 15*i), ...knownStarts])].filter(s => s >= OPEN && s < CLOSE && legalMinute(s)).sort((a, b) => a - b);
const ENDS = [...new Set([CLOSE, ...Array.from({ length: 38 }, (_, i) => 13*60+30 + 15*i), ...knownEnds])].filter(e => e > OPEN && e <= CLOSE && legalMinute(e) && legalEnd(e)).sort((a, b) => a - b);
const POOL = []; for (const s of STARTS) for (const e of ENDS) { const L = e - s; if (L >= LO && L <= HI) POOL.push({ s, e, L, t: `${hm(s)}-${hm(e)}` }); }
const KNOWN_POOL = POOL.filter(p => KNOWN.has(p.t));

// today's floor: the thinnest fully-covered hour of today's table for this day class
function cover(duties) { const c = new Array(24).fill(0); for (const [p, n] of duties) for (let m = p.s; m < p.e; m += 5) c[Math.floor(m/60)] += n / 12; return c; }
function thinnest(c) { let w = Infinity; for (let h = Math.floor(OPEN/60); h < Math.ceil(CLOSE/60); h++) { const frac = (Math.min(CLOSE, (h+1)*60) - Math.max(OPEN, h*60)) / 60; if (frac >= 0.99 && c[h] < w) w = c[h]; } return w; }
const todayDuties = todayRows.filter(r => r[CLS] > 0).map(r => [{ s: mm(r.time.split('-')[0]), e: mm(r.time.split('-')[1]) }, r[CLS]]);
const FLOOR = Number(process.env.FLOOR ?? thinnest(cover(todayDuties)).toFixed(2));

const seen = new Set(); let feasible = 0; const bestBy = { known: null, fit: null }; const byNew = {};
function consider(duties) { // duties: [[pool, n], ...]
  const key = duties.map(([p, n]) => `${p.t}x${n}`).sort().join(); if (seen.has(key)) return; seen.add(key);
  const count = duties.reduce((a, [, n]) => a + n, 0); if (count !== N) return;
  const total = duties.reduce((a, [p, n]) => a + p.L * n, 0); if (total < TOTAL_MIN || total > TOTAL_MAX) return;
  const openers = duties.filter(([p]) => p.s === OPEN).reduce((a, [, n]) => a + n, 0); if (openers !== OPENERS) return;
  const closers = duties.filter(([p]) => p.e === CLOSE).reduce((a, [, n]) => a + n, 0); if (closers !== CLOSERS) return;
  if (AT22 !== null) { const at22 = duties.filter(([p]) => p.e > 22*60).reduce((a, [, n]) => a + n, 0); if (at22 !== AT22) return; }
  const c = cover(duties); const thin = thinnest(c); if (thin < FLOOR - 1e-9) return;
  const fit = dayFit(c, CLS); const turns = duties.length; const fresh = duties.filter(([p]) => !KNOWN.has(p.t)).length;
  feasible++;
  const rec = { duties: duties.map(([p, n]) => [p.t, n]).sort((a, b) => a[0].localeCompare(b[0])), fit, turns, fresh, total, thin: +thin.toFixed(2),
    starts: new Set(duties.map(([p]) => p.s)).size, ends: new Set(duties.map(([p]) => p.e)).size };
  const kKnown = fresh * 1e6 + fit * 100 + turns, kFit = fit * 1e4 + fresh * 100 + turns;
  if (fit <= FIT_CEILING && (!bestBy.known || kKnown < bestBy.known.k)) bestBy.known = { k: kKnown, ...rec };
  if (!bestBy.fit || kFit < bestBy.fit.k) bestBy.fit = { k: kFit, ...rec };
  if (!byNew[fresh] || kFit < byNew[fresh].k) byNew[fresh] = { k: kFit, ...rec };
}

// Pass 1 — every multiset of KNOWN turns (exhaustive, with pruning on count and total); then, for EACH
// turn in the pool, every multiset of KNOWN turns plus that one — so "one new turn" is exhaustive too,
// and the sampled pass below only has to find the tables with two or more.
function enumerate(pool) {
  const cur = [];
  const rec = (i, left, total) => {
    if (left === 0) { if (total >= TOTAL_MIN && total <= TOTAL_MAX) consider(cur.slice()); return; }
    if (i === pool.length) return;
    const p = pool[i];
    for (let n = Math.min(MAX_PER, left); n >= 0; n--) {
      const t2 = total + p.L * n; if (t2 > TOTAL_MAX) continue;
      if (t2 + (left - n) * HI < TOTAL_MIN) continue;   // a smaller n reaches further, so never break here
      if (n) cur.push([p, n]); rec(i + 1, left - n, t2); if (n) cur.pop();
    }
  };
  rec(0, N, 0);
}
enumerate(KNOWN_POOL);
const knownFeasible = feasible;
const t1 = Date.now(); for (const extra of POOL) if (!KNOWN.has(extra.t)) enumerate([...KNOWN_POOL, extra]);
const oneNewFeasible = feasible - knownFeasible, oneNewMs = Date.now() - t1;

// Pass 2 — seeded random search over the whole pool.
let _s = (Number(process.env.SEED ?? 7) >>> 0) || 7; const rnd = () => { _s ^= _s << 13; _s >>>= 0; _s ^= _s >> 17; _s ^= _s << 5; _s >>>= 0; return _s / 4294967296; };
const pick = a => a[(rnd() * a.length) | 0];
function comps(n, k, max) { if (k === 1) return n >= 1 && n <= max ? [[n]] : []; const out = []; for (let i = 1; i <= Math.min(max, n - (k - 1)); i++) for (const r of comps(n - i, k - 1, max)) out.push([i, ...r]); return out; }
const COMPS = {}; for (let k = 5; k <= 9; k++) COMPS[k] = comps(N, k, MAX_PER);
const openersPool = POOL.filter(p => p.s === OPEN), closersPool = POOL.filter(p => p.e === CLOSE), midPool = POOL.filter(p => p.s !== OPEN && p.e !== CLOSE);
const t0 = Date.now(); const BUDGET = Number(process.env.MS ?? 150000); let sampled = 0;
while (Date.now() - t0 < BUDGET) {
  // role-aware draw: some opener turns, some closer turns, the rest middles — then every composition
  const K = 5 + ((rnd() * 5) | 0); const nO = 1 + ((rnd() * Math.min(3, K - 2)) | 0), nC = 1 + ((rnd() * Math.min(3, K - nO - 1)) | 0), nM = K - nO - nC; if (nM < 1) continue;
  const turns = []; const used = new Set(); const draw = (pool, n) => { let guard = 0; while (n > 0 && guard++ < 50) { const p = pick(pool); if (used.has(p.t)) continue; used.add(p.t); turns.push(p); n--; } return n === 0; };
  if (!draw(openersPool, nO) || !draw(closersPool, nC) || !draw(midPool, nM)) continue;
  for (const c of COMPS[K]) { sampled++;
    const openers = turns.reduce((a, p, i) => a + (p.s === OPEN ? c[i] : 0), 0); if (openers !== OPENERS) continue;
    const closers = turns.reduce((a, p, i) => a + (p.e === CLOSE ? c[i] : 0), 0); if (closers !== CLOSERS) continue;
    const total = turns.reduce((a, p, i) => a + p.L * c[i], 0);
    if (total >= TOTAL_MIN && total <= TOTAL_MAX) { consider(turns.map((p, i) => [p, c[i]])); continue; }
    // repair: move ONE middle turn's finish so the total lands in range
    const want = total < TOTAL_MIN ? TOTAL_MIN : TOTAL_MAX;
    for (let i = 0; i < K; i++) { const p = turns[i]; if (p.s === OPEN || p.e === CLOSE) continue; const d = want - total; if (d % c[i]) continue;
      const ne = p.e + d / c[i], q = POOL.find(x => x.s === p.s && x.e === ne); if (!q || turns.some((x, j) => j !== i && x.t === q.t)) continue;
      consider(turns.map((x, j) => [j === i ? q : x, c[j]])); }
  }
}
const show = (label, b) => { if (!b) { console.log(`  ${label}: none`); return; }
  console.log(`  ${label}: ${b.turns} turns · ${b.starts} starts + ${b.ends} finishes · ${b.fresh} new · fit ${b.fit} · pays ${b.total} · thinnest hour ${b.thin}`);
  console.log('    ' + b.duties.map(([t, n]) => `${t} x${n}`).join('  ')); };
console.log(`${CLS}: pool ${POOL.length} turns (${KNOWN_POOL.length} known) · known-only tables feasible ${knownFeasible} · one-new-turn tables feasible ${oneNewFeasible} (exhaustive, ${(oneNewMs/1000).toFixed(0)}s) · sampled ${sampled.toLocaleString()} · feasible ${feasible} · floor ${FLOOR} · total ${TOTAL_MIN}${TOTAL_MAX !== TOTAL_MIN ? `–${TOTAL_MAX}` : ''} · fit ceiling ${FIT_CEILING} (Quarter To's ${CLS} ${QT_FIT})`);
show(`best by familiarity (fewest new turns with fit ≤ ${FIT_CEILING}, then fit)`, bestBy.known); show('best by fit (then fewest new turns)', bestBy.fit);
console.log('  best fit at each count of new turns:'); for (const k of Object.keys(byNew).sort((a, b) => a - b)) show(`    ${k} new`, byNew[k]);
const chosen = bestBy[PICK]; if (!chosen) process.exit(1);
console.log('JSON ' + JSON.stringify(chosen.duties.flatMap(([t, n]) => Array(n).fill(t))));
