// Fast one-day evaluator (Saturday or Sunday): a day's duty multiset -> floor fit + that day's rows of the December
// rules. Mirrors report-data.mjs (officeSplit / currentRules / headcounts) for the plan model. Validated by check_dayfast.mjs.
import { DEC_2026_MOVEMENTS } from '../../../../links-demand.js';
const sm = t => { const [a] = t.split('-'); const [h, m] = a.split(':'); return +h * 60 + +m; };
const em = t => { const b = t.split('-')[1]; const [h, m] = b.split(':'); const v = +h * 60 + +m; return v > sm(t) ? v : v + 1440; };
const OPEN = { weekday: 380, sat: 380, sun: 435 }, CLOSE = { weekday: 1435, sat: 1435, sun: 1405 };
const PLAN = { weekday: [['06:20-14:20', 2], ['14:00-22:30', 2]], sat: [['06:20-14:50', 2], ['14:30-22:00', 2]], sun: [['07:15-15:30', 2], ['13:30-22:30', 2]] };
const W = {};
for (const c of ['weekday', 'sat', 'sun']) { const ws = OPEN[c], we = CLOSE[c]; const hrs = []; for (let h = Math.floor(ws / 60); h <= Math.floor((we - 1) / 60); h++) hrs.push(h);
  const inWin = Array(24).fill(0); for (const [t, n] of DEC_2026_MOVEMENTS[c]) if (t >= ws && t <= we) inWin[Math.floor(t / 60) % 24] += n;
  W[c] = { hrs, inWin, D: hrs.reduce((a, h) => a + inWin[h], 0) }; }
function helpers(sp, c) { const out = [];
  for (const t of sp) { if (t.n < 2) continue;
    if (c === 'sun') {
      if (t.st === OPEN.sun) { const en = Math.min(t.en, 540); if (en > t.st) out.push({ st: t.st, en, share: 1 }); continue; }
      if (t.st < 900) out.push({ st: t.st, en: 900, share: 1 }, { st: t.st, en: 900, share: 1 });
      out.push({ st: Math.max(t.st, 1080), en: t.en, share: 1 }); continue; }
    if (t.st === OPEN[c]) { const en = Math.min(t.en, 480); if (en > t.st) out.push({ st: t.st, en, share: 1 }); }
    else if (t.en > 1170) out.push({ st: Math.max(t.st, 1170), en: t.en, share: 1 }); }
  return out; }
function pairs(times, c) { const byT = {}; for (const s of times) byT[s] = (byT[s] ?? 0) + 1;
  if (c !== 'sun') { const [[e], [l]] = PLAN[c]; return (byT[e] ?? 0) >= 2 && (byT[l] ?? 0) >= 2 ? [e, l] : null; }
  const e = Object.keys(byT).filter(t => sm(t) === OPEN.sun && byT[t] >= 2).sort((a, b) => em(b) - em(a))[0];
  const l = Object.keys(byT).filter(t => em(t) === 1350 && byT[t] >= 2).sort((a, b) => sm(a) - sm(b))[0];
  return e && l ? [e, l] : null; }
export function evalDay(times, c, satmin = 14) {
  const pr = pairs(times, c), named = !!pr;
  const sp = named ? pr.map(t => ({ st: sm(t), en: em(t), n: 2 })) : PLAN[c].map(([t, n]) => ({ st: sm(t), en: em(t), n }));
  const hp = helpers(sp, c);
  const cov = Array(24).fill(0);
  for (const s of times) { const a = sm(s), b = em(s); for (let m = a; m < Math.min(b, 1440); m += 5) cov[Math.floor(m / 60)] += 1 / 12; }
  const minsIn = (t, h) => Math.max(0, Math.min(t.en, (h + 1) * 60) - Math.max(t.st, h * 60)) / 60;
  const fc = cov.map((v, h) => Math.max(0, v - (sp.reduce((a, t) => a + t.n * minsIn(t, h), 0) - hp.reduce((a, x) => a + x.share * minsIn(x, h), 0))));
  const { hrs, inWin, D } = W[c]; const C = hrs.reduce((a, h) => a + fc[h], 0);
  const fit = C ? +hrs.reduce((a, h) => a + ((inWin[h] / D) - (fc[h] / C)) ** 2 * 1e4, 0).toFixed(1) : null;
  const op = OPEN[c], cl = CLOSE[c];
  const open = times.filter(s => sm(s) <= op && em(s) > op).length;
  const close = times.filter(s => sm(s) < cl && em(s) >= cl).length;
  const at22 = times.filter(s => sm(s) <= 1320 && em(s) > 1320).length;
  let duties = times.map(s => ({ s, st: sm(s), en: em(s) })), office = [];
  if (named) { for (const t of [pr[0], pr[0], pr[1], pr[1]]) duties.splice(duties.findIndex(x => x.s === t), 1); } else office = sp;
  let lo = Infinity;
  for (let m = op; m < cl; m += 5) lo = Math.min(lo, duties.filter(x => x.st <= m && x.en > m).length - office.filter(t => t.st <= m && t.en > m).reduce((a, t) => a + t.n, 0) + hp.filter(x => x.share >= 1 && x.st <= m && x.en > m).length);
  const floor = Math.max(0, lo);
  const cls = duties.filter(x => x.en === cl);
  let hand = cls.length > 0 && cls.every(k => duties.some(x => x.st < k.st && x.en >= k.st + 15));
  if (c === 'sun' && cls.length) { const last = Math.max(...cls.map(k => k.st)); hand = hand && duties.filter(x => x.st === op).every(x => x.en >= last + 15); }
  const [pe, pl] = named ? pr : PLAN[c].map(x => x[0]);
  const overlap = em(pe) - (c === 'sun' ? Math.max(sm(pl), 900) : sm(pl));
  const lens = c !== 'sun' || times.every(s => em(s) - sm(s) >= 480 && em(s) - sm(s) <= 540);
  const heads = c === 'sat' ? times.length >= satmin : c === 'sun' ? times.length >= 10 : true;
  const ok = open >= 4 && close >= 3 && at22 >= 5 && heads && named && floor >= 2 && hand && overlap >= (c === 'sun' ? 30 : 20) && lens;
  return { fit, open, close, at22, named, floor, hand, overlap, ok, fc };
}

/** The weekday fit the sheets print: the fit of the MEAN Monday–Friday floor cover (weekdayFit / officeSplit.wkFit). */
export function meanFit(fcs, c = 'weekday') { const { hrs, inWin, D } = W[c]; const m = Array.from({ length: 24 }, (_, h) => fcs.reduce((a, f) => a + f[h], 0) / fcs.length);
  const C = hrs.reduce((a, h) => a + m[h], 0); return C ? +hrs.reduce((a, h) => a + ((inWin[h] / D) - (m[h] / C)) ** 2 * 1e4, 0).toFixed(1) : null; }
