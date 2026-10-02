// THE REST-DAY SKELETON (2 Oct 2026, the owner's "a stronger roster than any we have done so far"). Shift times set
// aside: every working line is a week of worked and rest cells and ONE family — all earlies, all lates, or (when
// MIXED_MAX allows) lates, a rest island, then earlies, which is the only mixed shape whose single rest day is harmless.
// It answers a question the rota search could not: what is the FLOOR on single rest days for this table's day counts
// (weekday 15 on, 7 of them earlies; Saturday 14, 7; Sunday 10, 5) under every rule a finished rota must meet?
//
// WHAT IT FOUND, relaxing one rule at a time (each over six or more seeds):
//   every rule                                       4 single rest days (pure weeks: 5 — see FF8b below)
//   mixed weeks allowed freely                        4   so the families are not the cause
//   weekends any distance apart                       1–3 (Familiar Nine's 2 came from here)
//   a cover week's four duties not counted in the run 1   the cause: spacing pushes each full weekend up against a cover
//   cover-week worst case allowed to reach 7 · 8      3 · 1   week, and the run rule then leaves a lone rest day beside it
//
// THE RULES IT CARRIES, each learned from a rota that failed on exactly it (links-fatigue.js is the authority):
//   · rows of 4 or 5 duties; 7 full weekends never more than GAP apart; no run over MAXRUN with a cover week's four duties
//     placed as badly as they can be (COVER_RUN);
//   · a rest day at every change of family between consecutive lines — late into early is a turnaround (23:55 → 06:20),
//     early into late with no rest between is FF19's jump of more than two hours (06:20 Saturday → 14:30 Sunday);
//   · FF8b: a block of two or more 06:20 starts must be followed by TWO rest days, and a 07:00 after the block does not
//     help, so a single rest day may never follow an early line's weekday or Saturday (a Sunday never starts before 07:15);
//   · the 07:00 SUPPLY: only 06:20 starts are "early starts" (FF8b, FF15), and an early run needs non-06:20 duties at set
//     places to keep its 06:20 blocks legal — one for a run of 5 or 6 ending in two rest days, one in two for a run ending
//     in a worked Sunday, and the Saturday into a cover week must itself be one (FF15's worst case adds the cover week's
//     four). Weekdays have two 07:00 duties and a Saturday two 08:00; a day asked for more is a fault;
//   · the Sunday 09:00 duty goes to an early line with Monday off, or costs a Monday 07:00 (09:00 → 06:20 is an FF19 jump);
//   · leave.mjs's figures, early-exit: the worst place for 14 days' leave must give 20 days off, four full weeks must
//     cost 15 days at most, and a best stretch under 28 costs half a point a day.
// The search is simulated annealing over same-day swaps of worked/rest cells, family flips and whole-line swaps; the
// score is the faults ×1000 plus the single rest days plus CHG_W per change of family round the wheel (so the weeks come
// in blocks, which is what keeps the week-to-week step small).
//   [MIXED_MAX=0] [CHG_W=0.5] [COVER_RUN=6] node skeleton.mjs <seed> <iterations> [GAP=5]   → skel8-<seed>-g<GAP>-c<run>-m<mixed>.json
// Then skeleton-start.mjs lays the duty table onto it and space-polish.mjs (LOCK_REST=1 or not) searches the times.
const [SEED_, ITERS_, GAP_] = process.argv.slice(2); const GAP = Number(GAP_ ?? 5);
const MIXED_MAX = Number(process.env.MIXED_MAX ?? 0);
const NOFAM = process.env.NOFAM === '1', MAXRUN = Number(process.env.MAXRUN ?? 6), COVER_OK = process.env.COVER_OK === '1', COVER_RUN = Number(process.env.COVER_RUN ?? process.env.MAXRUN ?? 6);   // COVER_RUN: the run allowed when a cover week's duties fall badly   // relaxations, to see which rule costs the singles
const L = 26, COVER = new Set([1, 6, 11, 16, 21]), WORK = []; for (let i = 1; i <= L; i++) if (!COVER.has(i)) WORK.push(i);
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const ON = { sun: 10, mon: 15, tue: 15, wed: 15, thu: 15, fri: 15, sat: 14 }, EARLY = { sun: 5, mon: 7, tue: 7, wed: 7, thu: 7, fri: 7, sat: 7 };
let seed = Number(SEED_ ?? 1); const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
// state: on[line][day] 0/1, fam[line] 'E'|'L'
const on = {}, fam = {};
for (const k of WORK) { on[k] = {}; fam[k] = rnd() < 0.5 ? 'E' : 'L'; }
// the family of line k on day d: an M line is L until its first rest day of the week, E after it
const famOn = (k, d) => { if (fam[k] !== 'M') return fam[k]; let seen = false; for (const x of DAYS) { if (!on[k][x]) seen = true; if (x === d) return seen ? 'E' : 'L'; } };
const startFam = k => fam[k] === 'M' ? 'L' : fam[k], endFam = k => fam[k] === 'M' ? 'E' : fam[k];
for (const d of DAYS) { const cells = shuffle([...Array(ON[d]).fill(1), ...Array(WORK.length - ON[d]).fill(0)]); WORK.forEach((k, i) => { on[k][d] = cells[i]; }); }
const cell = (k, d) => COVER.has(k) ? 'S' : on[k][d] ? famOn(k, d) : 'R';
function measure() {
  let bad = 0, iso = 0;
  // column early counts
  if (!NOFAM) for (const d of DAYS) { let e = 0; for (const k of WORK) if (on[k][d] && famOn(k, d) === 'E') e++; bad += Math.abs(e - EARLY[d]) * 10; }
  { let m = 0; for (const k of WORK) if (fam[k] === 'M') { m++; if (on[k].sun && !DAYS.some(d => !on[k][d])) bad += 10; } if (m > MIXED_MAX) bad += (m - MIXED_MAX) * 10; }
  // row sums 4..5
  for (const k of WORK) { const n = DAYS.reduce((a, d) => a + on[k][d], 0); if (n < 4 || n > 5) bad += 20 * Math.abs(n < 4 ? 4 - n : n - 5); }
  // sequence over the wheel
  const seq = []; for (let k = 1; k <= L; k++) for (const d of DAYS) seq.push(cell(k, d));
  const n = seq.length;
  for (let i = 0; i < n; i++) if (seq[i] === 'R' && seq[(i + n - 1) % n] !== 'R' && seq[(i + 1) % n] !== 'R') { iso++;
    // v5 — FF8b: a block of two or more 06:20 starts must be followed by TWO rest days, and a 07:00 after the block does
    // not help (the block is then followed by none). So a single rest day may never follow an early week's weekday or
    // Saturday; after a late week, or after a Sunday (every Sunday start is 07:15 or later), it is harmless.
    if (seq[(i + n - 1) % n] === 'E' && ((i + n - 1) % n) % 7 !== 0) bad += 10; }
  // runs: a cover week counts as 4 worked days that may sit at either end
  let run = 0, maxRun = 0; const seq2 = [...seq, ...seq];
  for (let i = 0; i < seq2.length; i++) { const c = seq2[i]; if (c === 'R') run = 0; else if (c === 'S') { /* handled below */ run = 0; } else { run++; if (run > maxRun) maxRun = run; } }
  // worst case round a cover week: trailing run before it + 4, and 4 + leading run after it
  for (const c of COVER) { const prev = c === 1 ? L : c - 1, next = c === L ? 1 : c + 1;
    let t = 0; for (let i = 6; i >= 0 && !COVER.has(prev) && on[prev][DAYS[i]]; i--) t++;
    let l = 0; for (let i = 0; i < 7 && !COVER.has(next) && on[next][DAYS[i]]; i++) l++;
    if (!COVER_OK) { const w = Math.max(t + 4, 4 + l); if (w > COVER_RUN) bad += (w - COVER_RUN) * 15; } }
  if (maxRun > MAXRUN) bad += (maxRun - MAXRUN) * 15;
  // weekends and gaps
  const at = []; for (let k = 1; k <= L; k++) { const nk = k % L + 1; if (!COVER.has(k) && !COVER.has(nk) && !on[k].sat && !on[nk].sun) at.push(k); }
  const gaps = at.map((k, i) => i < at.length - 1 ? at[i + 1] - k : at[0] + L - k);
  const maxGap = gaps.length ? Math.max(...gaps) : 99;
  if (at.length < 7) bad += (7 - at.length) * 30; if (maxGap > GAP) bad += (maxGap - GAP) * 20;
  // late → early join needs a rest day (Sat of k or Sun of k+1)
  // a rest day at EVERY change of family (v4): late into early is a turnaround (23:55 → 06:20); early into late with no
  // rest between is FF19's jump of more than two hours between successive starts (06:20 Saturday → 14:30 Sunday)
  if (!NOFAM) for (const k of WORK) { const nk = k % L + 1; if (COVER.has(nk)) continue; if (endFam(k) !== startFam(nk) && on[k].sat && on[nk].sun) bad += 10; }
  if (!NOFAM) { const cap = { mon: 2, tue: 2, wed: 2, thu: 2, fri: 2, sat: 2 }, used = { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0 };
    const demands = [];
    for (const k of WORK) { const days = DAYS.slice(1); let i = 0;
      while (i < 6) { if (!(on[k][days[i]] && famOn(k, days[i]) === 'E')) { i++; continue; }
        let j = i; while (j < 6 && on[k][days[j]] && famOn(k, days[j]) === 'E') j++;
        const run = days.slice(i, j), r = run.length;
        // what follows: a rest island (how long) or, after Saturday, the next line's Sunday
        let rest = 0, intoCover = false; if (j < 6) { let x = j; while (x < 6 && !on[k][days[x]]) { rest++; x++; } if (x >= 6) { const nk = k % L + 1; if (!COVER.has(nk)) { if (!on[nk].sun) { rest++; if (!on[nk].mon) rest++; } } } }   // a cover week is worked: no rest beyond the line
        else { const nk = k % L + 1; if (COVER.has(nk)) { rest = 0; intoCover = true; } else if (!on[nk].sun) { rest = 1; if (!on[nk].mon) rest++; } else rest = 0; }
        if (rest >= 2) { if (r === 5) demands.push([[run[0]], [run[1]]]); else if (r === 6) demands.push([[run[1]]]); }
        else if (intoCover) { const o = r === 1 ? [[run[0]]] : r === 2 ? [[run[1]]] : r === 3 ? [[run[1], run[2]], [run[0], run[2]]] : r === 4 ? [[run[1], run[3]]] : r === 5 ? [[run[1], run[3], run[4]]] : [[run[1], run[3], run[5]]]; demands.push(o); }
        else if (rest === 0) { if (r === 2) demands.push([[run[0]], [run[1]]]); else if (r === 3) demands.push([[run[1]]]); else if (r === 4) demands.push([[run[1], run[3]], [run[0], run[2]]]);
          else if (r === 5) demands.push([[run[1], run[3]]]); else if (r === 6) demands.push([[run[1], run[3], run[5]]]); }
        i = j; } }
    { const sunE = WORK.filter(k => on[k].sun && famOn(k, 'sun') === 'E'); if (sunE.length && !sunE.some(k => !on[k].mon)) demands.push([['mon']]); }
    for (const opts of demands) { let pick = null, best = 1e9; for (const o of opts) { const over = o.reduce((a, d) => a + (used[d] + 1 > cap[d] ? 1 : 0), 0); if (over < best) { best = over; pick = o; } }
      for (const d of pick) { used[d]++; if (used[d] > cap[d]) bad += 10; } } }
  let chg = 0; for (let i = 0; i < WORK.length; i++) { const a = WORK[i], b = WORK[(i + 1) % WORK.length]; if (endFam(a) !== startFam(b)) chg++; }
  let lv = null;
  if (bad === 0) { lv = leaveOf(seq); if (lv.worst < 20) bad += (20 - lv.worst) * 5; if (lv.four > 15) bad += (lv.four - 15) * 5; }
  return { bad, iso, weekends: at.length, maxGap, maxRun, lv, chg };
}
// leave.mjs's walk with an early exit: days off in a row from 14 days' leave, from every first day; four full weeks from a Sunday
function leaveOf(seq) {
  const n = seq.length, isCover = i => seq[i] === 'S', costs = i => seq[i] !== 'R' && (i % 7) !== 0;   // a rest day or a Sunday costs nothing
  const run = s => { let c = 0, len = 0; const used = {};
    for (;;) { const i = (s + len) % n; if (costs(i)) { if (isCover(i)) { const wk = `${Math.floor(i / 7)}|${Math.floor((s + len) / n)}`; used[wk] = (used[wk] ?? 0) + 1; if (used[wk] <= 4) c++; } else c++; }
      if (c > 14 || len >= n) return len; len++; } };
  let best = 0, worst = 1e9, sum = 0; for (let s = 0; s < n; s++) { const r = run(s); if (r > best) best = r; if (r < worst) worst = r; sum += r; }
  let four = 1e9; for (let s = 0; s < n; s += 7) { let c = 0; const used = {}; for (let i = 0; i < 28; i++) { const j = (s + i) % n; if (costs(j)) { if (isCover(j)) { const wk = `${Math.floor(j / 7)}|${Math.floor((s + i) / n)}`; used[wk] = (used[wk] ?? 0) + 1; if (used[wk] <= 4) c++; } else c++; } } if (c < four) four = c; }
  return { best, worst, avg: +(sum / n).toFixed(1), four };
}
const CHG_W = Number(process.env.CHG_W ?? 0);   // cost per change of family between consecutive working weeks
const score = m => m.bad * 1000 + m.iso + CHG_W * m.chg + (m.lv ? Math.max(0, 28 - m.lv.best) * 0.5 : 0);
let cur = measure(), cs = score(cur), best = { m: cur, s: cs, on: JSON.stringify(on), fam: JSON.stringify(fam) };
const ITERS = Number(ITERS_ ?? 200000);
for (let i = 0; i < ITERS; i++) {
  const T = 3000 * Math.pow(0.3 / 3000, i / ITERS); let undo;
  const r = rnd();
  if (r < 0.7) { const d = DAYS[Math.floor(rnd() * 7)], a = WORK[Math.floor(rnd() * 21)], b = WORK[Math.floor(rnd() * 21)];
    if (on[a][d] === on[b][d]) continue; [on[a][d], on[b][d]] = [on[b][d], on[a][d]]; undo = () => { [on[a][d], on[b][d]] = [on[b][d], on[a][d]]; }; }
  else if (r < 0.85) { const a = WORK[Math.floor(rnd() * 21)], was = fam[a]; fam[a] = was === 'E' ? 'L' : was === 'L' ? (MIXED_MAX ? 'M' : 'E') : 'E'; undo = () => { fam[a] = was; }; }
  else { const a = WORK[Math.floor(rnd() * 21)], b = WORK[Math.floor(rnd() * 21)]; if (a === b) continue; [on[a], on[b]] = [on[b], on[a]]; [fam[a], fam[b]] = [fam[b], fam[a]]; undo = () => { [on[a], on[b]] = [on[b], on[a]]; [fam[a], fam[b]] = [fam[b], fam[a]]; }; }
  const m = measure(), s = score(m);
  if (s <= cs || rnd() < Math.exp((cs - s) / T)) { cur = m; cs = s; if (s < best.s) best = { m, s, on: JSON.stringify(on), fam: JSON.stringify(fam) }; } else undo();
}
console.log(`seed ${SEED_} GAP ${GAP} cover ${COVER_RUN} mixed ≤${MIXED_MAX} (${WORK.filter(k => fam[k] === 'M').length}): bad ${best.m.bad} · single rest days ${best.m.iso} · weekends ${best.m.weekends} · max gap ${best.m.maxGap} · run ${best.m.maxRun} · family changes ${best.m.chg} · leave ${best.m.lv ? `${best.m.lv.best} · ${best.m.lv.avg} · ${best.m.lv.worst} · four ${best.m.lv.four}` : '—'}`);
if (best.m.bad === 0) { const o = JSON.parse(best.on), f = JSON.parse(best.fam); const rows = [];
  for (let k = 1; k <= L; k++) rows.push(String(k).padStart(2) + ' ' + (COVER.has(k) ? 'cover' : f[k] + ' ' + DAYS.map(d => o[k][d] ? '#' : '.').join('')));
  console.log(rows.join('\n')); (await import("node:fs")).writeFileSync(`skel8-${SEED_}-g${GAP}-c${COVER_RUN}-m${MIXED_MAX}.json`, JSON.stringify({ on: o, fam: f, m: best.m })); }
