// Simulated annealing over the 26-line grid (copied from the 24-line tooling, 1 Oct 2026; the line count, the cover
// weeks and the table now come from link.mjs and TABLE=<table.json>). Coverage per day is FIXED by the table and preserved by
// every move (same-day swaps, whole-line swaps). The app's own modules judge every candidate;
// the "feel" terms are the only thing added, and they are what "like today's roster" means in numbers.
import { writeFileSync, readFileSync } from 'node:fs';
import { runDesignChecks, startMinutes, DAYS, dutyMinutes } from '../../../links-design.js';
import { assessFatigue } from '../../../links-fatigue.js';
import { scoreOrder } from '../../../links-adjacency.js';
import { LINES, COVER_LINES } from './link.mjs';
const MODE = process.env.MODE ?? 'feel';   // 'feel' = like today's roster · 'rules' = fatigue-first, no feel terms
const GAP_W = Number(process.env.GAP_W ?? 0), ISO_X = Number(process.env.ISO_X ?? 0);
const GAP_CAP = Number(process.env.GAP_CAP ?? 0), GAP_CAP_W = Number(process.env.GAP_CAP_W ?? 60000), MIX_X = Number(process.env.MIX_X ?? 0), STEP_X = Number(process.env.STEP_X ?? 0);
const DAYS_X = Number(process.env.DAYS_X ?? 0), HEAVY_W = Number(process.env.HEAVY_W ?? 0), HEAVY_CAP = Number(process.env.HEAVY_CAP ?? 99);   // weekend spacing; extra weight on single rest days (both off by default)

const VARIANT = process.argv[2] ?? 'B';
const STEPS = Number(process.argv[3] ?? 60000), RESTARTS = Number(process.argv[4] ?? 4), SEED0 = Number(process.argv[5] ?? 7);
// SPARE= overrides the cover lines (comma list); the default is link.mjs's, as even as 26 allows
const SPARE = new Set(process.env.SPARE ? process.env.SPARE.split(',').map(Number) : COVER_LINES);
const WORK = []; for (let i = 1; i <= LINES; i++) if (!SPARE.has(i)) WORK.push(i);

// ── the table ────────────────────────────────────────────────────────────────────────────────
// The assembled duty table (assemble-table.mjs) named by TABLE=: one row per shift time, with its count on a weekday,
// a Saturday and a Sunday. The 24-line tooling kept a dozen designs' tables here by letter; the 26-line link has one
// way in, so a run can never be judged against a table it did not use.
const TABLE = process.env.TABLE;
const SLOTS = TABLE ? JSON.parse(readFileSync(TABLE, 'utf8')).slots : null;
const rowsOf = k => SLOTS.filter(r => r[k] > 0).map(r => [r.time, r[k]]);
const expand = t => t.flatMap(([s, n]) => Array(n).fill(s));
const dayDuties = () => { if (!SLOTS) throw new Error('anneal: TABLE=<table.json> is required');
  const wk = expand(rowsOf('weekday'));
  // ONE WEEKDAY OF ITS OWN (2 Oct 2026, the owner's 217-day what-if, option C: 15 on four weekdays and 14 on one). A row
  // may give a count for a named weekday ('mon'…'fri') as well, and that day then takes its own counts instead of the
  // weekday's. No earlier table has such a column, so every earlier run reproduces exactly.
  const own = d => SLOTS.some(r => d in r) ? expand(rowsOf(d)) : wk;
  return { sun: expand(rowsOf('sun')), mon: own('mon'), tue: own('tue'), wed: own('wed'), thu: own('thu'), fri: own('fri'), sat: expand(rowsOf('sat')) }; };

// Families — what "the same turn" means across the weekend variants.
// Two families, as today's roster works them: the EARLY wave (06:20 to 08:30 starts — line 6 works
// 06:20 Monday then 08:00 the rest of the week, and nobody calls that two turns) and the LATE wave.
function family(t) { const s = startMinutes(t); if (s === null) return null; return s < 9*60 ? 'E' : 'L'; }

// ── PRNG ─────────────────────────────────────────────────────────────────────────────────────
let seed = SEED0; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const shuffle = a => { for (let i = a.length-1; i > 0; i--) { const j = Math.floor(rnd()*(i+1)); [a[i],a[j]] = [a[j],a[i]]; } return a; };

// ── initial grid: each day's duties dealt across the working lines at random ─────────────────
function initial() {
  const DAY_DUTIES = dayDuties();
  const p = {}; for (let i = 1; i <= LINES; i++) { p[i] = {}; for (const d of DAYS) p[i][d] = SPARE.has(i) ? 'SPARE' : 'RD'; }
  for (const d of DAYS) { const cells = shuffle([...DAY_DUTIES[d], ...Array(WORK.length - DAY_DUTIES[d].length).fill('RD')]); WORK.forEach((ln, k) => { p[ln][d] = cells[k]; }); }
  return p;
}
const clone = p => { const q = {}; for (const k in p) q[k] = { ...p[k] }; return q; };

// ── cost ─────────────────────────────────────────────────────────────────────────────────────
const KEYS = Array.from({ length: LINES }, (_, i) => String(i+1));
const ff = (f, code, t) => f.results.find(r => r.code === code && (!t || r.title.includes(t)));
export function evaluate(p) {
  const c = runDesignChecks(p, LINES);
  const f = assessFatigue(p, LINES);
  const a = scoreOrder(p, KEYS, { maxRunTarget: 6 });
  const v = code => Number(ff(f, code)?.value ?? 0);
  const h55 = Number(ff(f, 'MRSF', '55 hours')?.value ?? 0);
  const e8 = Number(ff(f, 'MRSF', '7 consecutive 8h')?.value ?? 0);
  const ff17 = String(ff(f, 'FF17')?.value ?? '0 backward / 0 forward'); const [bk, fw] = ff17.match(/\d+/g).map(Number);
  // feel
  let fam = 0, times = 0, iso = 0, daysPen = 0, varMis = 0;
  const seq = []; for (const k of KEYS) for (const d of DAYS) seq.push(p[k][d]);
  const n = seq.length;
  for (let i = 0; i < n; i++) if (seq[i] === 'RD' && seq[(i+n-1)%n] !== 'RD' && seq[(i+1)%n] !== 'RD') iso++;
  for (const ln of WORK) {
    const row = p[ln]; const wk = ['mon','tue','wed','thu','fri'].map(d => row[d]).filter(s => s !== 'RD');
    const wkTimes = new Set(wk); const fams = new Set(DAYS.map(d => row[d]).filter(s => s !== 'RD').map(family));
    times += Math.max(0, wkTimes.size - 1); fam += Math.max(0, fams.size - 1);
    const days = DAYS.filter(d => row[d] !== 'RD').length; daysPen += days < 4 ? (4-days) : days > 5 ? (days-5) : 0;
    // weekend variant should belong to the family the weekdays are on
    const domFam = wk.length ? family(wk[0]) : null;
    for (const d of ['sat','sun']) if (row[d] !== 'RD' && domFam && family(row[d]) !== domFam) varMis++;
  }
  const R = MODE === 'rules';
  const presentCount = f.present;   // every factor present costs, over and above its size
  const terms = {
    present: R ? presentCount * 50000 : 0,
    turnarounds: c.turnarounds.length * 1e9,
    stretch: Math.max(0, c.longestStretch - 6) * 2e6 + (c.longestStretch > 13 ? 1e9 : 0),
    ff11: (v('FF11') > 13 ? 1e6 : 0) + Math.max(0, v('FF11') - 12) * 20000,
    ff15: Math.max(0, v('FF15') - 4) * 2500,
    ff8b: v('FF8b') * 4000,
    ff19: v('FF19') * 800,
    h55: Math.max(0, h55 - 55) * 3000,
    e8: Math.max(0, e8 - 7) * 3000,
    ff17: Math.max(0, bk - fw) * 400 + (bk > fw ? 30000 : 0),
    // Rules mode: coherence of a week counts, but at a weight no fatigue factor can be traded for
    // (a present factor costs 50,000; the whole of a chopped-up rotation costs less than one).
    famWeeks: fam * (R ? 1000 : 3000), extraTimes: times * (R ? 600 : 2500), isolatedRest: iso * 1500, daysOff45: daysPen * 3000, variantMismatch: varMis * (R ? 400 : 1200),
    weekends: -c.weekendsOff * 900, longWeekends: -a.longWeekends * 300, fourDay: -a.fourDayBreaks * 150,
    gentle: a.gentleMean * (R ? 10 : 6) + a.gentleOver * (R ? 400 : 250), blocks: Math.max(0, a.longestBlock - 3) * 2000,
  };
  // WEEKEND SPACING (2 Oct 2026, the Second Nature review): GAP_W per week of the longest wait between two full weekends
  // (the sheet's measure, plain.mjs), plus a small push towards even gaps; ISO_X adds weight to single rest days. Both
  // are off by default, so every earlier run reproduces exactly.
  if (GAP_W) { const at = []; for (let k = 1; k <= LINES; k++) { const sa = p[String(k)].sat, su = p[String(k % LINES + 1)].sun; if (sa === 'RD' && su === 'RD') at.push(k); }
    const g = at.map((k, i) => i < at.length - 1 ? at[i + 1] - k : at[0] + LINES - k);
    terms.weekendGap = g.length ? GAP_W * Math.max(...g) + GAP_W / 20 * g.reduce((s, x) => s + x * x, 0) / LINES : GAP_W * LINES; }
  if (ISO_X) terms.isolatedRest += iso * ISO_X;
  // WEEKENDS AS A RULE (2 Oct 2026, owner: "weekends off either four weeks apart or as spaced out as possible"): GAP_CAP
  // is the longest wait allowed between two full weekends (5 is the closest seven can be with these cover weeks), and
  // every week over it costs GAP_CAP_W. MIX_X and STEP_X add weight to weeks mixing earlies and lates and to the
  // week-to-week move in start time, the two things a spread found by reordering alone gave up. All off by default.
  if (GAP_CAP) { const at = []; for (let k = 1; k <= LINES; k++) { if (p[String(k)].sat === 'RD' && p[String(k % LINES + 1)].sun === 'RD') at.push(k); }
    const g = at.length ? Math.max(...at.map((k, i) => i < at.length - 1 ? at[i + 1] - k : at[0] + LINES - k)) : LINES;
    terms.weekendCap = Math.max(0, g - GAP_CAP) * GAP_CAP_W; }
  if (MIX_X) terms.famWeeks += fam * MIX_X;
  if (STEP_X) terms.gentle += a.gentleMean * STEP_X;
  // DAYS_X: extra weight on weeks of fewer than 4 or more than 5 days (a six-day week is what the spacing search reached
  // for first); HEAVY_CAP / HEAVY_W: a cost per hour any working week's Monday-to-Saturday duty is over HEAVY_CAP.
  if (DAYS_X) terms.daysOff45 += daysPen * DAYS_X;
  if (HEAVY_W) { const over = WORK.reduce((s, ln) => s + Math.max(0, ['mon','tue','wed','thu','fri','sat'].reduce((h, d) => h + (/^\d/.test(p[ln][d]) ? dutyMinutes(p[ln][d]) : 0), 0) / 60 - HEAVY_CAP), 0);
    terms.heavy = over * HEAVY_W; }
  const cost = Object.values(terms).reduce((s, x) => s + x, 0);
  return { cost, terms, facts: { turnarounds: c.turnarounds.length, longest: c.longestStretch, weekends: c.weekendsOff, present: f.present, ff11: v('FF11'), ff15: v('FF15'), ff8b: v('FF8b'), ff19: v('FF19'), h55, e8, ff17, gentleMean: a.gentleMean, gentleOver: a.gentleOver, gentleWorst: a.gentleWorst, longestBlock: a.longestBlock, longWeekends: a.longWeekends, famWeeks: fam, extraTimes: times, iso, daysPen, varMis } };
}

// ── search ───────────────────────────────────────────────────────────────────────────────────
function anneal(p, steps, T0, T1) {
  let cur = evaluate(p).cost, best = cur, bestP = clone(p);
  for (let s = 0; s < steps; s++) {
    const T = T0 * Math.pow(T1 / T0, s / steps);
    const r = rnd();
    if (r < 0.7) { // same-day swap
      const d = DAYS[Math.floor(rnd()*7)]; const a = WORK[Math.floor(rnd()*WORK.length)], b = WORK[Math.floor(rnd()*WORK.length)];
      if (a === b || p[a][d] === p[b][d]) continue;
      [p[a][d], p[b][d]] = [p[b][d], p[a][d]];
      const c2 = evaluate(p).cost;
      if (c2 <= cur || rnd() < Math.exp((cur - c2) / T)) { cur = c2; if (cur < best) { best = cur; bestP = clone(p); } }
      else [p[a][d], p[b][d]] = [p[b][d], p[a][d]];
    } else { // whole-line swap (order)
      const a = WORK[Math.floor(rnd()*WORK.length)], b = WORK[Math.floor(rnd()*WORK.length)]; if (a === b) continue;
      [p[a], p[b]] = [p[b], p[a]];
      const c2 = evaluate(p).cost;
      if (c2 <= cur || rnd() < Math.exp((cur - c2) / T)) { cur = c2; if (cur < best) { best = cur; bestP = clone(p); } }
      else [p[a], p[b]] = [p[b], p[a]];
    }
    if (s % 10000 === 9999) console.error(`  [${VARIANT}] step ${s+1} T=${T.toFixed(0)} cur=${cur.toFixed(0)} best=${best.toFixed(0)}`);
  }
  return { p: bestP, cost: best };
}
function polish(p) { // steepest descent over every same-day swap and every line swap
  let cur = evaluate(p).cost, improved = true, rounds = 0;
  while (improved && rounds < 8) { improved = false; rounds++;
    for (const d of DAYS) for (let i = 0; i < WORK.length; i++) for (let j = i+1; j < WORK.length; j++) {
      const a = WORK[i], b = WORK[j]; if (p[a][d] === p[b][d]) continue;
      [p[a][d], p[b][d]] = [p[b][d], p[a][d]]; const c2 = evaluate(p).cost;
      if (c2 < cur) { cur = c2; improved = true; } else [p[a][d], p[b][d]] = [p[b][d], p[a][d]];
    }
    for (let i = 0; i < WORK.length; i++) for (let j = i+1; j < WORK.length; j++) {
      const a = WORK[i], b = WORK[j]; [p[a], p[b]] = [p[b], p[a]]; const c2 = evaluate(p).cost;
      if (c2 < cur) { cur = c2; improved = true; } else [p[a], p[b]] = [p[b], p[a]];
    }
    console.error(`  [${VARIANT}] polish round ${rounds}: ${cur.toFixed(0)}`);
  }
  return { p, cost: cur };
}

if (process.argv[1].endsWith('anneal.mjs')) {
  let globalBest = null;
  for (let r = 0; r < RESTARTS; r++) {
    seed = SEED0 + r * 1000;
    const p = initial();
    const a = anneal(p, STEPS, 4000, 15);
    const q = polish(a.p);
    console.error(`  [${VARIANT}] restart ${r}: ${q.cost.toFixed(0)}`);
    if (!globalBest || q.cost < globalBest.cost) globalBest = { ...q, restart: r };
  }
  const ev = evaluate(globalBest.p);
  writeFileSync(`best-${MODE === 'rules' ? 'R' : ''}${VARIANT}-${SEED0}.json`, JSON.stringify({ variant: VARIANT, mode: MODE, seed: SEED0, cost: ev.cost, terms: ev.terms, facts: ev.facts, patterns: globalBest.p }, null, 1));
  console.log(VARIANT, 'BEST', ev.cost.toFixed(0), JSON.stringify(ev.facts));
}
