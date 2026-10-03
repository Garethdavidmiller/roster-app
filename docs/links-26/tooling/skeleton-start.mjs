// SKELETON → START GRID (2 Oct 2026). Lays Second Nature's duty table onto a rest-day skeleton (skeleton.mjs): each day's
// early duties go to that day's early lines and its lates to the late lines, with the 07:00 and 08:00 duties placed
// where the skeleton's own supply rule says an early run needs them (so FF8b and FF15 are clear from the start), any
// left over at the START of a run (a 07:00 at the end of a 06:20 block makes the block illegal), the five 12:00-20:00
// duties on one late line working Monday to Friday with Sunday off (FF19), and the Sunday 09:00 on an early line with
// Monday off. The rest is dealt by seed; space-polish.mjs does the rest.
//   [TABLE=results/<x>-table.json] node skeleton-start.mjs <skeleton.json> <start.json> [seed]
import { readFileSync, writeFileSync } from 'node:fs';
const [SK, OUT, SEED_] = process.argv.slice(2);
// TABLE=<table.json> lays another duty table onto the skeleton (3 Oct 2026, for Second Gear's); Second Nature's by default
const T = JSON.parse(readFileSync(process.env.TABLE ?? new URL('./results/second-nature-table.json', import.meta.url), 'utf8')).slots;
const { on, fam } = JSON.parse(readFileSync(SK, 'utf8'));
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], L = 26, COVER = new Set([1, 6, 11, 16, 21]);
const WORK = Object.keys(on).map(Number).sort((a, b) => a - b);
let seed = Number(SEED_ ?? 1); const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const start = t => +t.slice(0, 2) * 60 + +t.slice(3, 5), famOf = t => start(t) < 11 * 60 ? 'E' : 'L', nonEarly = t => start(t) >= 7 * 60;
const famOn = (k, d) => { if (fam[k] !== 'M') return fam[k]; let seen = false; for (const x of DAYS) { if (!on[k][x]) seen = true; if (x === d) return seen ? 'E' : 'L'; } };
// the demands, as skeleton.mjs v7 states them
const need = {}; for (const k of WORK) need[k] = new Set();
const cap = { mon: 2, tue: 2, wed: 2, thu: 2, fri: 2, sat: 2 }, used = { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0 };
const demands = [];
for (const k of WORK) { const days = DAYS.slice(1); let i = 0;
  while (i < 6) { if (!(on[k][days[i]] && famOn(k, days[i]) === 'E')) { i++; continue; }
    let j = i; while (j < 6 && on[k][days[j]] && famOn(k, days[j]) === 'E') j++;
    const run = days.slice(i, j), r = run.length;
    let rest = 0, intoCover = false; if (j < 6) { let x = j; while (x < 6 && !on[k][days[x]]) { rest++; x++; } if (x >= 6) { const nk = k % L + 1; if (!COVER.has(nk)) { if (!on[nk].sun) { rest++; if (!on[nk].mon) rest++; } } } }   // a cover week is worked: no rest beyond the line
    else { const nk = k % L + 1; if (COVER.has(nk)) { rest = 0; intoCover = true; } else if (!on[nk].sun) { rest = 1; if (!on[nk].mon) rest++; } else rest = 0; }
    let opts = null;
    if (rest >= 2) { if (r === 5) opts = [[run[0]], [run[1]]]; else if (r === 6) opts = [[run[1]]]; }
    else if (intoCover) opts = r === 1 ? [[run[0]]] : r === 2 ? [[run[1]]] : r === 3 ? [[run[1], run[2]], [run[0], run[2]]] : r === 4 ? [[run[1], run[3]]] : r === 5 ? [[run[1], run[3], run[4]]] : [[run[1], run[3], run[5]]];
    else if (rest === 0) { if (r === 2) opts = [[run[0]], [run[1]]]; else if (r === 3) opts = [[run[1]]]; else if (r === 4) opts = [[run[1], run[3]], [run[0], run[2]]]; else if (r === 5) opts = [[run[1], run[3]]]; else if (r === 6) opts = [[run[1], run[3], run[5]]]; }
    else if (rest === 1) console.error(`line ${k}: an early run ending at a single rest day (${run.join(' ')})`);
    if (opts) demands.push({ k, opts }); i = j; } }
for (const { k, opts } of demands) { let pick = null, best = 1e9; for (const o of opts) { const over = o.reduce((a, d) => a + (used[d] + 1 > cap[d] ? 1 : 0), 0); if (over < best) { best = over; pick = o; } }
  for (const d of pick) { used[d]++; need[k].add(d); if (used[d] > cap[d]) console.error(`${d}: more 07:00/08:00 duties needed than exist`); } }
const p = {}; for (let k = 1; k <= L; k++) { p[k] = {}; for (const d of DAYS) p[k][d] = COVER.has(k) ? 'SPARE' : 'RD'; }
// the 12:00 line: a late line working Monday to Friday with Sunday off (and Saturday off or a 14:00 start)
const noonLine = WORK.find(k => fam[k] === 'L' && !on[k].sun && ['mon', 'tue', 'wed', 'thu', 'fri'].every(d => on[k][d]));
for (const d of DAYS) { const col = d === 'sat' ? 'sat' : d === 'sun' ? 'sun' : 'weekday';
  const duties = T.flatMap(r => Array(r[col]).fill(r.time));
  const lines = WORK.filter(k => on[k][d]); const eL = lines.filter(k => famOn(k, d) === 'E'), lL = lines.filter(k => famOn(k, d) === 'L');
  if (eL.length !== duties.filter(t => famOf(t) === 'E').length) throw new Error(`${d}: ${eL.length} E lines for ${duties.filter(t => famOf(t) === 'E').length} early duties`);
  let E = duties.filter(t => famOf(t) === 'E'), Lt = duties.filter(t => famOf(t) === 'L');
  if (eL.length !== E.length || lL.length !== Lt.length) throw new Error(`${d}: ${eL.length} E lines for ${E.length} early duties, ${lL.length} L for ${Lt.length}`);
  // earlies: the lines that need a non-06:20 get one first
  if (d === 'sun') { const nineLine = eL.find(k => !on[k].mon); if (nineLine) { const i = E.indexOf('09:00-18:00'); if (i >= 0) { p[nineLine][d] = E.splice(i, 1)[0]; eL.splice(eL.indexOf(nineLine), 1); } } }
  const must = eL.filter(k => need[k].has(d)), rest = eL.filter(k => !need[k].has(d));
  const ne = shuffle(E.filter(nonEarly)), e6 = shuffle(E.filter(t => !nonEarly(t)));
  for (const k of must) p[k][d] = ne.length ? ne.pop() : e6.pop();
  // leftover 07:00 / 08:00 duties go where a non-06:20 is harmless: the first day of a line's early run (yesterday not a 06:20)
  const prevDay = DAYS[(DAYS.indexOf(d) + 6) % 7], prevLine = k => d === 'sun' ? (k === 2 ? 26 : k - 1) : k;
  const startOfRun = k => { const pk = prevLine(k); return COVER.has(pk) || !p[pk] || p[pk][prevDay] === 'RD' || p[pk][prevDay] === 'SPARE' || nonEarly(p[pk][prevDay]) || famOf(p[pk][prevDay]) === 'L'; };
  const firsts = shuffle(rest.filter(startOfRun)), others = shuffle(rest.filter(k => !startOfRun(k)));
  for (const k of [...firsts, ...others]) p[k][d] = ne.length ? ne.pop() : e6.pop();
  // lates: the 12:00 duty to the noon line, the Saturday 14:00 beside it, the rest at random
  const lrest = [...lL]; let lt = [...Lt];
  if (noonLine && lrest.includes(noonLine)) { const want = d === 'sat' ? '14:00-22:30' : '12:00-20:00'; const i = lt.indexOf(want); if (i >= 0) { p[noonLine][d] = lt.splice(i, 1)[0]; lrest.splice(lrest.indexOf(noonLine), 1); } }
  lt = shuffle(lt); lrest.forEach((k, i) => { p[k][d] = lt[i]; }); }
writeFileSync(OUT, JSON.stringify({ patterns: p }, null, 1)); console.log('built', OUT, 'noon line', noonLine ?? 'none');
