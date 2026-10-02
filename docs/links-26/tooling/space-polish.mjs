// SPREAD THE WEEKENDS, THEN THE REST DAYS (2 Oct 2026). An external review of Second Nature asked for one more pass
// before it is called finished, with its priorities in this order:
//   1-5  keep every rule and hard limit, no fatigue warning, at most 6 days in a row, the shortest rest at least the
//        start's, and the late finishes and shift times as they are;
//   6    spread the full weekends: Second Nature's seven can be ten weeks apart;
//   7    fewer single rest days (4, where Familiar Nine has 2);
//   8    a lighter heaviest Monday-to-Saturday week (43h 40m);
//   9    keep the five cover weeks where they are.
// Every move here is a same-day swap between two working lines or a swap of two whole working lines, so each day's
// duties never change: 1-5's staffing, late finishes, shift times and the cover weeks are held by construction, and
// what is left is a search over the ORDER, which is where both weaknesses live. A rota with a short turnaround, more
// than six days in a row or a fatigue factor present is never accepted.
// The other floors (env, each defaulting to the start's own figure) are COSTS while searching and FLOORS on what is
// kept: the way to a better rota often passes through a worse one, so a move that dips below a floor may be taken, but
// only a rota that meets every floor is ever written. A run that keeps nothing says which floors its closest rota missed.
//   REST_MIN (minutes) · ONE_MIN · WKENDS_MIN · HEAVY_MAX (hours) · STEP_MAX (minutes) · ISO_MAX · GAP_MAX · BAD_MAX (0)
//   MIXED_MAX (weeks with earlies and lates) · LEAVE_WORST_MIN (leave.mjs: days off from 14 days' leave, worst place)
//   GAP_W, ISO_W, MIX_W: how hard to push the weekend gap, the single rest days and the mixed weeks down, beyond their floors.
// The weekend gap is the sheet's own measure (plain.mjs: weeks from one full weekend to the next, round the wheel).
// With cover weeks at 1, 6, 11, 16 and 21 only 16 weeks can START a full weekend, and the closest seven of those can be
// is five weeks apart at most — so 5 is the floor this can reach, not a target it falls short of.
// This polishes a rota that is already close; it cannot remove a structural fault such as a six-day week, so the rotas
// it starts from come from anneal.mjs with its spacing terms (GAP_W, ISO_X, DAYS_X, HEAVY_W) switched on.
//   [floors] node space-polish.mjs <start.json> <out.json> <seed> <iterations>
import { readFileSync, writeFileSync } from 'node:fs';
import { runDesignChecks, DAYS } from '../../../links-design.js';
import { assessFatigue } from '../../../links-fatigue.js';
import { scoreOrder } from '../../../links-adjacency.js';
import { feel, dutyMinutes, tightestRest } from './report-data.mjs';
import { leave } from './leave.mjs';

const [SRC, OUT, SEED_, ITERS_] = process.argv.slice(2);
if (!ITERS_) { console.error('usage: node space-polish.mjs <start.json> <out.json> <seed> <iterations>'); process.exit(2); }
const load = f => { const j = JSON.parse(readFileSync(f, 'utf8')); return j.patterns ?? j; };
const p = load(SRC), L = Object.keys(p).length, KEYS = Object.keys(p), WORK = KEYS.filter(k => p[k].mon !== 'SPARE');
let seed = Number(SEED_); const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const timed = s => /^\d\d:\d\d-\d\d:\d\d$/.test(s), off = s => !timed(s) && s !== 'SPARE';

export function weekendGaps(q) {
  const at = []; for (let k = 1; k <= L; k++) if (off(q[String(k)].sat) && off(q[String(k % L + 1)].sun)) at.push(k);
  return at.map((k, i) => i < at.length - 1 ? at[i + 1] - k : at[0] + L - k);
}
const RUN_MAX = Number(process.env.RUN_MAX ?? 6);   // see the note beside LOCK_REST
function measure(q) {
  const c = runDesignChecks(q, L); if (c.turnarounds.length || c.longestStretch > RUN_MAX) return null;
  // FATIGUE_SOFT=1: a fatigue factor present is a cost while searching and a floor on what is kept (never kept), so a
  // start that carries one can be polished out of it; off by default, so every earlier chain rebuilds exactly
  const f = assessFatigue(q, L); if (f.present && process.env.FATIGUE_SOFT !== '1') return null;
  const rest = tightestRest(q, L)?.minutes ?? 9999;
  const fe = feel(q, L), a = scoreOrder(q, KEYS, { maxRunTarget: 6 });
  const wk = WORK.map(k => ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'].reduce((s, d) => s + (timed(q[k][d]) ? dutyMinutes(q[k][d]) : 0), 0) / 60);
  const badDays = WORK.filter(k => { const n = DAYS.filter(d => q[k][d] !== 'RD').length; return n < 4 || n > 5; }).length;
  const gaps = weekendGaps(q);
  return { present: f.present, rest, wkends: c.weekendsOff, gaps, maxGap: gaps.length ? Math.max(...gaps) : 99, spread: gaps.reduce((s, g) => s + g * g, 0),
    iso: fe.isolatedRest, one: fe.oneTurn, mixed: fe.hybrid, leaveWorst: leave(q).worst, heavy: Math.max(...wk), light: Math.min(...wk), badDays, step: a.gentleMean, block: a.longestBlock };
}
const S0 = measure(p);
if (!S0) throw new Error('the start has a short turnaround, a run over 6 or a fatigue factor');
// WHAT IS KEPT. Every floor is a COST while searching — the way to a better rota often passes through a worse one, and a
// rejected move cannot be built on — and a FLOOR on what is kept: `best` only ever records a rota that meets them all.
// Defaults are the start's own figures, so with no settings nothing kept is worse than the start on any of them.
const env = (k, d) => process.env[k] !== undefined ? Number(process.env[k]) : d;
const F = { restMin: env('REST_MIN', S0.rest), oneMin: env('ONE_MIN', S0.one), wkendsMin: env('WKENDS_MIN', S0.wkends),
  heavyMax: env('HEAVY_MAX', S0.heavy), badMax: env('BAD_MAX', 0), mixedMax: env('MIXED_MAX', S0.mixed), leaveMin: env('LEAVE_WORST_MIN', S0.leaveWorst),   // badMax: weeks of 3 or 6 days (Second Nature has none)
  stepMax: env('STEP_MAX', S0.step), isoMax: env('ISO_MAX', S0.iso), gapMax: env('GAP_MAX', S0.maxGap) };
const GAP_W = env('GAP_W', 1e5), ISO_W = env('ISO_W', 2e4);
// MIX_W (2 Oct 2026, the "stronger than any" search): a cost per week mixing earlies and lates, beyond the MIXED_MAX
// floor — until then a mixed week cost nothing until it crossed the floor, so a run could not be asked to PREFER an
// all-early or all-late week. Off by default (0), so every earlier chain rebuilds exactly.
const MIX_W = env('MIX_W', 0);
// LOCK_REST=1 (2 Oct 2026, the skeleton build): the rest days stay where the start put them — a same-day swap moves only
// two timed duties, and whole lines are never swapped — so the weekends, their spacing, the single rest days and the
// runs are the START's by construction and only the TIMES are searched (one-turn weeks, the step, rest, fatigue, the
// heaviest week). Off by default, so every earlier chain rebuilds exactly.
const LOCK_REST = process.env.LOCK_REST === '1';
// RUN_MAX (default 6, declared above measure): the longest run accepted, a cover week's duties placed as badly as they
// can be — 7 lets the owner weigh 'up to 7 if a cover week falls badly' (today: up to 9) against fewer single rest days
const keeps = m => !m.present && m.rest >= F.restMin && m.one >= F.oneMin && m.wkends >= F.wkendsMin && m.heavy <= F.heavyMax + 1e-9
  && m.step <= F.stepMax && m.iso <= F.isoMax && m.maxGap <= F.gapMax && m.badDays <= F.badMax && m.mixed <= F.mixedMax && m.leaveWorst >= F.leaveMin;
const misses = m => [['fatigue', m.present > 0], ['rest', m.rest < F.restMin], ['one-turn', m.one < F.oneMin], ['weekends', m.wkends < F.wkendsMin],
  ['heaviest', m.heavy > F.heavyMax + 1e-9], ['step', m.step > F.stepMax], ['single rest days', m.iso > F.isoMax],
  ['gap', m.maxGap > F.gapMax], ['3/6-day weeks', m.badDays > F.badMax], ['mixed weeks', m.mixed > F.mixedMax], ['leave worst', m.leaveWorst < F.leaveMin]].filter(([, x]) => x).map(([k]) => k);
let closest = null;   // the rota missing the fewest floors, so a run that keeps nothing still says what stood in its way
const score = m => {
  if (!m || m.block > S0.block) return null;
  const short = 3e5 * m.present + 5e3 * Math.max(0, F.restMin - m.rest) + 2e5 * Math.max(0, F.oneMin - m.one) + 1e6 * Math.max(0, F.wkendsMin - m.wkends)
    + 2e5 * Math.max(0, m.heavy - F.heavyMax) + 2e3 * Math.max(0, m.step - F.stepMax) + 2e5 * Math.max(0, m.iso - F.isoMax)
    + 2e5 * Math.max(0, m.maxGap - F.gapMax) + 3e5 * Math.max(0, m.badDays - F.badMax)
    + 1e5 * Math.max(0, m.mixed - F.mixedMax) + 1e5 * Math.max(0, F.leaveMin - m.leaveWorst);
  return short
    + GAP_W * m.maxGap + 2e3 * m.spread                       // 6: spread the weekends
    + ISO_W * m.iso + MIX_W * m.mixed                         // 7: single rest days (and mixed weeks, when asked)
    + 1e3 * m.heavy - 2e3 * m.wkends - 500 * m.one + 50 * m.step;   // 8: the heaviest week, and more of what is good
};
let cur = measure(p), cs = score(cur), best = keeps(cur) ? { m: cur, s: cs, p: structuredClone(p) } : null;
const ITERS = Number(ITERS_);
for (let i = 0; i < ITERS; i++) {
  const T = 3e4 * Math.pow(10 / 3e4, i / ITERS); let undo;
  if (LOCK_REST || rnd() < 0.75) { const d = DAYS[Math.floor(rnd() * 7)], a = WORK[Math.floor(rnd() * WORK.length)], b = WORK[Math.floor(rnd() * WORK.length)];
    if (a === b || p[a][d] === p[b][d] || (LOCK_REST && !(timed(p[a][d]) && timed(p[b][d])))) continue; [p[a][d], p[b][d]] = [p[b][d], p[a][d]]; undo = () => { [p[a][d], p[b][d]] = [p[b][d], p[a][d]]; }; }
  else { const a = WORK[Math.floor(rnd() * WORK.length)], b = WORK[Math.floor(rnd() * WORK.length)]; if (a === b) continue;
    [p[a], p[b]] = [p[b], p[a]]; undo = () => { [p[a], p[b]] = [p[b], p[a]]; }; }
  const m = measure(p), s = score(m);
  if (s !== null && (s <= cs || rnd() < Math.exp((cs - s) / T))) { cur = m; cs = s; if (keeps(m) && (!best || s < best.s)) best = { m, s, p: structuredClone(p) };
    const ms = misses(m).length; if (!closest || ms < closest.n || (ms === closest.n && s < closest.s)) closest = { m, s, n: ms, p: structuredClone(p) }; }
  else undo();
}
const r = m => `mixed ${m.mixed} · leave worst ${m.leaveWorst} · weekends ${m.wkends} · max gap ${m.maxGap} (${m.gaps.join(' ')}) · single rest days ${m.iso} · one-turn ${m.one} · heaviest ${m.heavy.toFixed(2)}h · lightest ${m.light.toFixed(2)}h · rest ${m.rest} · step ${m.step}`;
console.log(`start  ${r(S0)}\n${best ? `best   ${r(best.m)}` : `NONE kept — closest missed ${misses(closest.m).join(', ')}: ${r(closest.m)}`}`);
// With nothing kept, the closest rota is written beside OUT (<out>.closest.json) so a rerun can polish on from it with
// the floor it missed set where it landed; the run still exits 1, so a pipeline never mistakes it for a kept result.
if (best) writeFileSync(OUT, JSON.stringify({ patterns: best.p }, null, 1));
else { writeFileSync(OUT.replace(/\.json$/, '.closest.json'), JSON.stringify({ patterns: closest.p, misses: misses(closest.m) }, null, 1)); process.exitCode = 1; }
