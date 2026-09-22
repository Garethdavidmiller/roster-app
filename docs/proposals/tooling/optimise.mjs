// Improve a SUPPLIED design without changing what it costs to staff.
//
// Two move types, and both are chosen because they leave each day's multiset of duties EXACTLY as
// it was: swap two working lines' duty within one day column, or swap two whole lines' positions.
// So the coverage curve, the headcounts, the duty table and the contracted week are invariant by
// construction rather than by re-checking — only the SHAPE of a week and the order of the lines
// move. That is the same reasoning anneal.mjs uses, and the reason a search like this cannot
// quietly sell a repair by dropping a duty.
//
// It does NOT reuse anneal.mjs's `evaluate`: that module fixes the cover weeks at lines 1, 7, 13
// and 19, and a supplied design may put them anywhere (this one has 6, 12, 18, 24). Scoring it with
// the wrong spare set reads four cover weeks as working lines. The WEIGHTS below are anneal's,
// unchanged — they are owner-tuned and measured — with the working set derived from the design.
//
//   node optimise.mjs <design.json> [steps] [restarts] [seed]
import { readFileSync, writeFileSync } from 'node:fs';
import { runDesignChecks, DAYS, startMinutes, weeklyHours } from '../../../links-design.js';
import { assessFatigue } from '../../../links-fatigue.js';
import { scoreOrder } from '../../../links-adjacency.js';

const FILE = process.argv[2];
const STEPS = Number(process.argv[3] ?? 40000), RESTARTS = Number(process.argv[4] ?? 3);
let seed = Number(process.argv[5] ?? 7);
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

const START = JSON.parse(readFileSync(FILE, 'utf8'));
const LINES = Object.keys(START).length;
const KEYS = Array.from({ length: LINES }, (_, i) => String(i + 1));
const SPARE = new Set(KEYS.filter(k => START[k].mon === 'SPARE'));
// FREEZE=13-18 or FREEZE=3,9,14 — lines held at both their content and their POSITION. A frozen line
// is excluded from every move, so the search cannot reach the result by quietly editing it. Asserted
// at the end against the starting grid rather than trusted to the move set.
const parseLines = spec => new Set((spec ?? '').split(',').filter(Boolean).flatMap(part => {
  const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
  if (!m) return [part.trim()];
  const out = []; for (let i = +m[1]; i <= +m[2]; i++) out.push(String(i));
  return out;
}));
const FREEZE = parseLines(process.env.FREEZE);
// FLOAT=13 — a line whose PATTERN is held but whose POSITION is free, used ALONGSIDE a pinned
// FREEZE rather than instead of it. FREEZE_POS is all-or-nothing and that is not enough for the
// case this was added for: holding weeks 14, 15 and 16 together in order (FREEZE, pinned) while
// week 13 is free to go anywhere (FLOAT) — which is the only arrangement that keeps four of the
// five protected weeks in sequence AND clears MRSF, because 13 immediately followed by 14 is a
// single 58.9h seven-day window that nothing outside those two weeks can break.
const FLOAT = parseLines(process.env.FLOAT);
// FREEZE_POS=0 protects a frozen line's PATTERN but lets it move in the rotation: it can be swapped
// whole with another working line, never edited. That distinction decides real cases — Weekday Lates'
// line 13 runs Tue–Sat and line 14 Sun–Mon, so while both are pinned in place they form one 58.9h
// seven-day window that nothing else in the grid can break.
const FREEZE_POS = process.env.FREEZE_POS !== '0';
const WORK = KEYS.filter(k => !SPARE.has(k) && !FREEZE.has(k));
/** Lines a whole-line swap may move: the working set, plus frozen lines when only content is held. */
const SWAPPABLE = FREEZE_POS ? KEYS.filter(k => !SPARE.has(k) && !FREEZE.has(k))
                             : KEYS.filter(k => !SPARE.has(k));
// RULES=1 charges every factor PRESENT over and above its size, which is what anneal.mjs's own
// rules mode does. Use it when the goal is "no factors present" rather than the softest rotation.
const RULES = process.env.RULES === '1';
const family = t => { const s = startMinutes(t); return s === null ? null : s < 9 * 60 ? 'E' : 'L'; };
const clone = p => { const q = {}; for (const k in p) q[k] = { ...p[k] }; return q; };

/** anneal.mjs's own weights, with WORK derived from the design rather than assumed. */
function evaluate(p) {
  const c = runDesignChecks(p, LINES), f = assessFatigue(p, LINES);
  const a = scoreOrder(p, KEYS, { maxRunTarget: 6 });
  const ff = (code, t) => f.results.find(r => r.code === code && (!t || r.title.includes(t)));
  const v = code => Number(ff(code)?.value ?? 0);
  const h55 = Number(ff('MRSF', '55 hours')?.value ?? 0), e8 = Number(ff('MRSF', '7 consecutive 8h')?.value ?? 0);
  const [bk, fw] = String(ff('FF17')?.value ?? '0 backward / 0 forward').match(/\d+/g).map(Number);
  let fam = 0, times = 0, iso = 0, daysPen = 0, varMis = 0;
  const seq = []; for (const k of KEYS) for (const d of DAYS) seq.push(p[k][d]);
  const n = seq.length;
  for (let i = 0; i < n; i++) if (seq[i] === 'RD' && seq[(i + n - 1) % n] !== 'RD' && seq[(i + 1) % n] !== 'RD') iso++;
  for (const ln of WORK) {
    const row = p[ln], wk = ['mon','tue','wed','thu','fri'].map(d => row[d]).filter(s => s !== 'RD');
    times += Math.max(0, new Set(wk).size - 1);
    fam += Math.max(0, new Set(DAYS.map(d => row[d]).filter(s => s !== 'RD').map(family)).size - 1);
    const days = DAYS.filter(d => row[d] !== 'RD').length;
    daysPen += days < 4 ? 4 - days : days > 5 ? days - 5 : 0;
    const domFam = wk.length ? family(wk[0]) : null;
    for (const d of ['sat','sun']) if (row[d] !== 'RD' && domFam && family(row[d]) !== domFam) varMis++;
  }
  const terms = {
    present: RULES ? f.present * 50000 : 0,
    turnarounds: c.turnarounds.length * 1e9,
    stretch: Math.max(0, c.longestStretch - 6) * 2e6 + (c.longestStretch > 13 ? 1e9 : 0),
    ff11: (v('FF11') > 13 ? 1e6 : 0) + Math.max(0, v('FF11') - 12) * 20000,
    ff15: Math.max(0, v('FF15') - 4) * 2500, ff8b: v('FF8b') * 4000, ff19: v('FF19') * 800,
    h55: Math.max(0, h55 - 55) * 3000, e8: Math.max(0, e8 - 7) * 3000,
    ff17: Math.max(0, bk - fw) * 400 + (bk > fw ? 30000 : 0),
    famWeeks: fam * 3000, extraTimes: times * 2500, isolatedRest: iso * 1500,
    daysOff45: daysPen * 3000, variantMismatch: varMis * 1200,
    weekends: -c.weekendsOff * 900, longWeekends: -a.longWeekends * 300, fourDay: -a.fourDayBreaks * 150,
    gentle: a.gentleMean * 6 + a.gentleOver * 250, blocks: Math.max(0, a.longestBlock - 3) * 2000,
  };
  return { cost: Object.values(terms).reduce((s, x) => s + x, 0),
    facts: { turnarounds: c.turnarounds.length, longest: c.longestStretch, weekends: c.weekendsOff,
             present: f.present, ff11: v('FF11'), ff15: v('FF15'), ff8b: v('FF8b'), ff19: v('FF19'),
             h55, e8, gentleMean: a.gentleMean, longestBlock: a.longestBlock, spareGaps: a.spareGaps.join(',') } };
}

const pick = a => a[Math.floor(rnd() * a.length)];
/** Frozen PATTERNS, by content. Under FREEZE_POS=0 a frozen line may move, so "which positions must
 *  not be edited" has to be recomputed from the current grid — freezing position numbers instead is
 *  what let a moved pattern be edited by a later day-swap, which the end-of-run assertion caught. */
const FROZEN_PATTERNS = new Set([...FREEZE, ...FLOAT].map(k => JSON.stringify(START[k])));
const editable = p => (FREEZE_POS ? WORK : KEYS.filter(k => !SPARE.has(k)))
  .filter(k => !FROZEN_PATTERNS.has(JSON.stringify(p[k])));

function move(p) {
  const q = clone(p);
  const ed = editable(p);
  if (rnd() < 0.72 && ed.length > 1) {      // swap one day's duty between two EDITABLE lines
    const d = pick(DAYS); let x = pick(ed), y = pick(ed);
    while (y === x) y = pick(ed);
    [q[x][d], q[y][d]] = [q[y][d], q[x][d]];
  } else {                                  // swap two whole lines (pure reorder, patterns intact)
    let x = pick(SWAPPABLE), y = pick(SWAPPABLE);
    while (y === x) y = pick(SWAPPABLE);
    const t = q[x]; q[x] = q[y]; q[y] = t;
  }
  return q;
}

function anneal(p0, steps, T0, T1) {
  let cur = p0, curC = evaluate(cur).cost, best = cur, bestC = curC;
  for (let i = 0; i < steps; i++) {
    const T = T0 * Math.pow(T1 / T0, i / steps);
    const cand = move(cur), c = evaluate(cand).cost;
    if (c <= curC || rnd() < Math.exp((curC - c) / T)) { cur = cand; curC = c; if (c < bestC) { best = cand; bestC = c; } }
  }
  return { p: best, cost: bestC };
}

/** Steepest descent over every same-day swap and every line swap, to convergence. */
function polish(p) {
  let cur = p, curC = evaluate(cur).cost, moved = true;
  while (moved) {
    moved = false;
    const ed = editable(cur);
    for (const d of DAYS) for (let i = 0; i < ed.length; i++) for (let j = i + 1; j < ed.length; j++) {
      const q = clone(cur); [q[ed[i]][d], q[ed[j]][d]] = [q[ed[j]][d], q[ed[i]][d]];
      const c = evaluate(q).cost; if (c < curC - 1e-9) { cur = q; curC = c; moved = true; }
    }
    for (let i = 0; i < SWAPPABLE.length; i++) for (let j = i + 1; j < SWAPPABLE.length; j++) {
      const q = clone(cur); const t = q[SWAPPABLE[i]]; q[SWAPPABLE[i]] = q[SWAPPABLE[j]]; q[SWAPPABLE[j]] = t;
      const c = evaluate(q).cost; if (c < curC - 1e-9) { cur = q; curC = c; moved = true; }
    }
  }
  return { p: cur, cost: curC };
}

const base = evaluate(START);
console.log('start  cost', base.cost.toFixed(0), JSON.stringify(base.facts));
let best = { p: START, cost: base.cost };
for (let r = 0; r < RESTARTS; r++) {
  const a = anneal(START, STEPS, 120000, 200);
  const b = polish(a.p);
  console.log(`  restart ${r}: anneal ${a.cost.toFixed(0)} -> polish ${b.cost.toFixed(0)}`);
  if (b.cost < best.cost) best = b;
}
const fin = evaluate(best.p);
console.log('best   cost', fin.cost.toFixed(0), JSON.stringify(fin.facts));

// The invariants the move set is supposed to guarantee — asserted, not assumed.
const dayMulti = p => DAYS.map(d => KEYS.map(k => p[k][d]).sort().join('|')).join('#');
if (dayMulti(START) !== dayMulti(best.p)) throw new Error('a day column changed its duties — the search broke its own invariant');
const h0 = weeklyHours(START, LINES), h1 = weeklyHours(best.p, LINES);
if (h0.exSundayHours !== h1.exSundayHours) throw new Error('contracted hours moved');
if (JSON.stringify(Object.keys(best.p).filter(k => best.p[k].mon === 'SPARE')) !== JSON.stringify([...SPARE])) throw new Error('cover weeks moved');
if (FREEZE_POS) { for (const k of FREEZE) if (JSON.stringify(START[k]) !== JSON.stringify(best.p[k]))
    throw new Error(`frozen line ${k} was changed — the freeze is not holding`); }
else { // content-only: every frozen pattern must still be somewhere in the grid, unedited
  const present = new Set(Object.values(best.p).map(r => JSON.stringify(r)));
  for (const k of FREEZE) if (!present.has(JSON.stringify(START[k])))
    throw new Error(`frozen line ${k}'s pattern is no longer in the rotation — the freeze is not holding`); }
for (const k of FLOAT) { // pattern must still exist somewhere, unedited; position may have moved
  const present = new Set(Object.values(best.p).map(r => JSON.stringify(r)));
  if (!present.has(JSON.stringify(START[k])))
    throw new Error(`floated line ${k}'s pattern is no longer in the rotation — the float is not holding`);
}
console.log('invariants hold: day duties, contracted hours and cover weeks all unchanged'
  + (FREEZE.size ? `; lines ${[...FREEZE].join(', ')} ${FREEZE_POS ? 'untouched' : 'kept as patterns (position free)'}` : '')
  + (FLOAT.size ? `; line${FLOAT.size > 1 ? 's' : ''} ${[...FLOAT].join(', ')} kept as pattern${FLOAT.size > 1 ? 's' : ''}, position free` : ''));
writeFileSync(FILE.replace(/\.json$/, '-optimised.json'), JSON.stringify(best.p, null, 0));
