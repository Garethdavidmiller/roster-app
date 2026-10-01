// Drive fatigue warnings to zero by reordering only: same-day swaps between working lines, and whole-line swaps.
// Every day's duties stay as they are. Kept for reference (links-24).
import fs from 'fs';
const R = new URL('../../../../', import.meta.url).pathname, TL = new URL('../../tooling/', import.meta.url).pathname;
const { assessFatigue } = await import(R+'links-fatigue.js');
const { runDesignChecks, DAYS } = await import(R+'links-design.js');
const { feel, dutyMinutes, h55Worst, tightestRest } = await import(TL+'report-data.mjs');
const [SRC, OUT, SEED, ITERS] = [process.argv[2], process.argv[3], +(process.argv[4] ?? 1), +(process.argv[5] ?? 20000)];
const j = JSON.parse(fs.readFileSync(SRC, 'utf8')); let p = j.patterns ?? j;
const KEYS = Object.keys(p).sort((a, b) => a - b), WORK = KEYS.filter(k => !Object.values(p[k]).includes('SPARE'));
let seed = SEED; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const SKIP = new Set(['FF2', 'FF18']);                     // standing: the 06:20 open, and rotating weekly at all
const fixedOf = q => Object.fromEntries(KEYS.map(k => [k, Object.fromEntries(DAYS.map(d => [d, q[k][d] === 'SPARE' ? 'RD' : q[k][d]]))]));
const MS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const weekH = (q, k) => MS.reduce((s, d) => s + (/^\d/.test(q[k][d]) ? dutyMinutes(q[k][d]) : 0), 0) / 60;
const startH = WORK.map(k => weekH(p, k)), HMAX = Math.max(...startH), HMIN = Math.min(...startH);
function measure(q) {
  const ff = assessFatigue(fixedOf(q), 24).results.filter(r => !SKIP.has(r.code));
  const fw = assessFatigue(q, 24).results.filter(r => !SKIP.has(r.code));
  const c = runDesignChecks(q, 24), fe = feel(q, 24);
  const fixedPresent = ff.filter(r => r.status === 'present'), worstPresent = fw.filter(r => r.status === 'present');
  const mag = rs => rs.reduce((s, r) => s + (Number.isFinite(+r.value) ? +r.value : 1), 0);
  const wh = WORK.map(k => weekH(q, k)), days = WORK.map(k => DAYS.filter(d => /^\d/.test(q[k][d])).length);
  const h = (fixedPresent.length || worstPresent.length) ? { hi: 99 } : h55Worst(q, 24);
  return { h55: h?.hi ?? 0, fixed: fixedPresent.length, worst: worstPresent.length, fixedNames: fixedPresent.map(r => `${r.code} ${r.value}`), worstNames: worstPresent.map(r => `${r.code} ${r.value}`),
    magF: mag(fixedPresent), magW: mag(worstPresent), turn: c.turnarounds.length, run: c.longestStretch, wk: c.weekendsOff, six: fe.daysHist?.['6'] ?? 0, iso: fe.isolatedRest,
    one: fe.oneTurn, paired: fe.pairedRest, islands: fe.restIslands, heavy: Math.max(...wh), light: Math.min(...wh), seven: days.filter(n => n > 6).length };
}
// PAIRED REST (owner, 1 Oct 2026): the floors are hard — no fatigue warning, no 55-hour week, at least ONE_MIN weeks on
// one shift time and WK_MIN full weekends off; inside them, as few single rest days as possible, then more paired.
const ONE_MIN = +(process.env.ONE_MIN ?? 7), WK_MIN = +(process.env.WK_MIN ?? 6);
const cost = m => (m.fixed + m.worst) * 1e5 + Math.max(0, m.h55 - 55) * 1e5 + Math.max(0, ONE_MIN - m.one) * 3e4 + Math.max(0, WK_MIN - m.wk) * 2e5
  + m.turn * 1e6 + Math.max(0, m.run - 6) * 3e4 + m.six * 3e4 + m.magF * 500 + m.magW * 300
  + m.iso * 900 - m.paired * 300 - m.one * 60 - m.wk * 60 + Math.max(0, m.heavy - HMAX) * 2e4 + Math.max(0, HMIN - m.light) * 2e4;
let cur = JSON.parse(JSON.stringify(p)), cm = measure(cur), cc = cost(cm), best = cur, bm = cm, bc = cc;
console.log('start', JSON.stringify(cm));
for (let i = 0; i < ITERS; i++) {
  const T = 300 * Math.pow(0.0005, i / ITERS), q = JSON.parse(JSON.stringify(cur));
  if (rnd() < 0.7) { const d = DAYS[Math.floor(rnd() * 7)], a = WORK[Math.floor(rnd() * WORK.length)], b = WORK[Math.floor(rnd() * WORK.length)]; if (a === b || q[a][d] === 'SPARE' || q[b][d] === 'SPARE') continue; [q[a][d], q[b][d]] = [q[b][d], q[a][d]]; }
  else { const a = KEYS[Math.floor(rnd() * KEYS.length)], b = KEYS[Math.floor(rnd() * KEYS.length)]; if (a === b) continue; [q[a], q[b]] = [q[b], q[a]]; }
  const m = measure(q), c = cost(m);
  if (c <= cc || rnd() < Math.exp((cc - c) / T)) { cur = q; cm = m; cc = c; if (c < bc) { best = q; bm = m; bc = c; } }
}
console.log('best', JSON.stringify({ ...bm, h55: h55Worst(best, 24), rest: tightestRest(best, 24)?.minutes }));
fs.writeFileSync(OUT, JSON.stringify(best));
