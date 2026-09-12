// The duty TABLE for "Eight Forty" — By the Book's rules with NO DUTY OVER 8h40 (owner, 12 Sep 2026).
//
// By the Book's table (links-default-targets.js) runs earlies to 9h30, and five of its eleven Mon–Sat turns
// are over 8h40 — so the cap is not a trim, it re-poses the whole table. Every rule that file's test pins is
// ported here as a hard check (`violations`), the length ceiling is 520 minutes instead of 570, and the
// times are searched again on the five-minute grid against the December demand curve, the way the
// original table was searched. What the cap does to the design is arithmetic, and worth stating before the
// search: 14 duties paying 7,000 minutes is a mean of 8h20, and "every other early longer than every late"
// under a ceiling of 8h40 leaves the whole set inside a 7h–8h40 band with its mean 20 minutes from the top —
// so the long earlies sit at 8h25–8h40, the lates at 7h55–8h20, and the margin the owner asked for ("slightly
// shorter") is the only size it can be. The search chooses WHEN those duties fall, not how long they are.
//
// The method, as the other tables were built: every LENGTH structure that pays the day under the rules is
// enumerated (roles first — openers, closers, morning and late middles — then the ordering rule and the
// total), and for each one the free starts are searched for the best demand fit. The lengths are the
// combinatorial core; the starts are a small placement problem on top.
// Two searches, one answer. The ENUMERATION counts every length structure that can pay the day under the pins
// (weekday: 84,085 with the two late middles the 22:00 rule needs) — that is the figure the PDF reports. The
// PLACEMENT is a role-preserving anneal over the whole day (four openers whose finish moves, closers whose
// start moves, middles that slide or change length, every move keeping the day's minutes), because placing
// each of 84,085 structures in turn is hours of work for the same answer; the winner's lengths are then
// CHECKED against the enumeration, so the two cannot disagree.
//   node table-book.mjs [STEPS] [RESTARTS] [SEED]   → eight-forty-table.json + the counts
import { writeFileSync } from 'node:fs';
import { DEC_2026_DEMAND } from '../../../links-demand.js';
import { buildDefaultTargets } from '../../../links-default-targets.js';

const CAP = Number(process.env.CAP ?? 520), MIN = 420;
// Knobs for the feasibility diagnosis (defaults are the rules as By the Book's test pins them): SPACING is the
// minimum gap between two different starts (or finishes), CEIL_EXTRA loosens the distinct-times ceilings.
const SPACING = Number(process.env.SPACING ?? 15), CEIL_EXTRA = Number(process.env.CEIL_EXTRA ?? 0), DIAG = !!process.env.DIAG;
const STEPS = Number(process.argv[2] ?? 200000), RESTARTS = Number(process.argv[3] ?? 8), SEED0 = Number(process.argv[4] ?? 7);
// Sunday sits outside the contract, so nothing fixes its minutes. At the week's own 8h20 mean (5,000) the half-hour
// mean gap is unreachable — the same arithmetic as Saturday's, with five earlies facing five lates — so the search
// walks DOWN from 5,000 in five-minute steps and takes the LARGEST Sunday total at which every pin holds. By the
// Book's own Sunday pays 4,965.
let SUN_TOTAL = 5000; const SUN_FLOOR = 4600;
const WIN = { weekday: [6*60+20, 23*60+55], sat: [6*60+20, 23*60+55], sun: [7*60+15, 23*60+25] };
const N = { weekday: 14, sat: 14, sun: 10 }, CLOSERS = { weekday: 3, sat: 4, sun: 3 }, OPENERS = 4, AT22 = 5;
const TOTAL = { weekday: 7000, sat: 7000, sun: null };   // Sunday is outside the contract (its search total is SUN_TOTAL)
const CEILING = { weekday: { starts: 7, finishes: 9 }, sat: { starts: 9, finishes: 9 }, sun: { starts: 6, finishes: 7 } };
const PINNED = new Set([6*60+20, 23*60+55, 7*60+15, 23*60+25]);
const LATE_FROM = 11*60;
// The half-hour mean gap ("the set has to move, not just the boundary pair") is UNREACHABLE on a Saturday under
// the cap, and that is arithmetic rather than search: four closers with distinct starts and the 22:00 rule leave
// three morning middles as the only split that pays 7,000, so seven earlies face seven lates and the gap is
// (2 x ΣE − 7000) / 7. ΣE is at most the short early plus 520+515+510 for the three long openers plus three
// morning middles at the cap — 3,105 plus a short early that must itself be below every late (≤ 480) — so the
// gap tops out at (2 x 3,585 − 7,000) / 7 = 24 minutes, and ten restarts stop at 23. The pin is held at 20 on a
// Saturday and 30 elsewhere; the PDF reports the day's own figure. Every OTHER ordering pin still holds.
const MEAN_GAP = { weekday: 30, sat: 20, sun: 30 };
const hhmm = m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const timeOf = d => `${hhmm(d.s)}-${hhmm(d.e)}`;

// ── the pins, as a checker (one string per broken rule) ──────────────────────────────────────────
function coverAt(duties, h) { return duties.reduce((a, d) => a + Math.max(0, Math.min(d.e, h*60+60) - Math.max(d.s, h*60)) / 60, 0); }
export function violations(cls, duties, weekday = null) {
  const v = []; const push = (msg, w = 1) => v.push([msg, w]);   // weight = how far off, so a placement search has a slope
  const [open, close] = WIN[cls]; const cars = DEC_2026_DEMAND[cls].cars;
  if (duties.length !== N[cls]) push(`count ${duties.length}`, Math.abs(duties.length - N[cls]));
  const openers = duties.filter(d => d.s === open), closers = duties.filter(d => d.e === close);
  if (openers.length !== OPENERS) push(`openers ${openers.length}`, Math.abs(openers.length - OPENERS));
  if (closers.length !== CLOSERS[cls]) push(`closers ${closers.length}`, Math.abs(closers.length - CLOSERS[cls]));
  const near = duties.filter(d => d.e !== close && d.e > close - 60); if (near.length) push(`de-facto closer ${near.map(timeOf)}`, near.length);
  for (const d of duties) { if (d.s < open || d.e > close) push(`outside window ${timeOf(d)}`); const L = d.e - d.s; if (L < MIN || L > CAP) push(`length ${timeOf(d)}=${L}`, Math.max(MIN - L, L - CAP) / 5); }
  if (new Set(openers.map(d => d.e)).size !== openers.length) push('openers share a finish', openers.length - new Set(openers.map(d => d.e)).size);
  if (new Set(closers.map(d => d.s)).size !== closers.length) push('closers share a start', closers.length - new Set(closers.map(d => d.s)).size);
  const counts = new Map(); for (const d of duties) counts.set(timeOf(d), (counts.get(timeOf(d)) ?? 0) + 1);
  for (const [t, n] of counts) if (n > 2) push(`${t} x${n}`, n - 2);
  for (const d of duties) for (const m of [d.s, d.e]) if (!PINNED.has(m) && [5, 10].includes(m % 60)) push(`:05/:10 ${hhmm(m)}`);
  // no shadow opener: nothing starts in the 40 minutes after the open (By the Book's first arrival is 55 after)
  for (const d of duties) if (d.s > open && d.s < open + 40) push(`shadow opener ${timeOf(d)}`);
  // ordering: one short early, then every late, then every other early
  const lates = duties.filter(d => d.s >= LATE_FROM).map(d => d.e - d.s), earlies = duties.filter(d => d.s < LATE_FROM).map(d => d.e - d.s);
  if (lates.length < 3 || earlies.length < 3) push('premise: both kinds');
  else {
    const lmin = Math.min(...lates), lmax = Math.max(...lates);
    const shorter = earlies.filter(x => x < lmin).length, longer = earlies.filter(x => x > lmax).length;
    // graded by DISTANCE, not count: a flat weight left the Saturday search with no slope toward a short early
    if (shorter !== 1) push(`short earlies ${shorter}`, shorter === 0 ? 1 + (Math.min(...earlies) - lmin + 5) / 5 : shorter - 1);
    if (longer !== earlies.length - 1) { const sortedE = earlies.slice().sort((a, b) => a - b).slice(1); push(`long earlies ${longer} of ${earlies.length - 1}`, longer > earlies.length - 1 ? 1 : sortedE.filter(x => x <= lmax).reduce((a, x) => a + (lmax - x + 5) / 5, 0)); }   // every early but the shortest, by how far it falls short of the longest late
    const longs = earlies.filter(x => x > lmax); if (longs.length) { const gap = Math.min(...longs) - lmax; if (gap < 5 || gap > 60) push(`gap ${gap}`, Math.max(5 - gap, gap - 60) / 5); }
    const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length; if (mean(earlies) - mean(lates) < MEAN_GAP[cls]) push(`means ${(mean(earlies) - mean(lates)).toFixed(0)}`, (MEAN_GAP[cls] - (mean(earlies) - mean(lates))) / 5);
  }
  const at22 = duties.filter(d => d.s <= 22*60 && d.e > 22*60); if (at22.length !== AT22) push(`at 22:00 ${at22.length}`, Math.abs(at22.length - AT22));
  if (at22.filter(d => d.e === close).length !== CLOSERS[cls]) push('closers not among the five');
  // the busiest hour is never a trough
  const hours = []; for (let h = Math.ceil(open/60); h < close/60; h++) hours.push(h);
  const busiest = hours.reduce((a, h) => coverAt(duties, h) > coverAt(duties, a) ? h : a, hours[0]);
  const sorted = hours.map(h => cars[h]).sort((a, b) => a - b); if (cars[busiest] < sorted[Math.floor(sorted.length/2)]) push(`bulge on a trough at ${busiest}:00`);
  if (cls !== 'sun') {
    const hrs = []; for (let h = Math.floor(open/60); h < Math.ceil(close/60); h++) hrs.push(h);
    const band = hrs.filter(h => h >= 17 && h <= 22); const frac = f => band.reduce((a, h) => a + f(h), 0) / hrs.reduce((a, h) => a + f(h), 0);
    const c = frac(h => coverAt(duties, h)), dm = frac(h => cars[h]);
    if (cls === 'sat' && !(c > dm)) push(`evening share ${(c*100).toFixed(1)} not above demand ${(dm*100).toFixed(1)}`, 1 + (dm - c) * 20);
    if (cls === 'weekday' && !(c < dm)) push(`weekday evening leans ${(c*100).toFixed(1)} vs ${(dm*100).toFixed(1)}`, 1 + (c - dm) * 20);
    if (cls === 'sat') for (let h = 17; h <= 21; h++) if (coverAt(duties, h) < coverAt(duties, 13)) push(`sat ${h}:00 below 13:00`, coverAt(duties, 13) - coverAt(duties, h));
    const tot = duties.reduce((a, d) => a + d.e - d.s, 0); if (tot !== TOTAL[cls]) push(`total ${tot}`, Math.abs(tot - TOTAL[cls]) / 5);
  }
  if (new Set(duties.map(d => d.s)).size > CEILING[cls].starts + CEIL_EXTRA) push('too many starts', new Set(duties.map(d => d.s)).size - CEILING[cls].starts - CEIL_EXTRA);
  if (new Set(duties.map(d => d.e)).size > CEILING[cls].finishes + CEIL_EXTRA) push('too many finishes', new Set(duties.map(d => d.e)).size - CEILING[cls].finishes - CEIL_EXTRA);
  return v;
}

// ── the objective: demand fit (fit.mjs's formula; Saturday's 17:00–22:00 valued at 1.25x, as the default was) ──
function fit(cls, duties) {
  const [ws, we] = WIN[cls]; const cars = DEC_2026_DEMAND[cls].cars;
  const hrs = []; for (let h = Math.floor(ws/60); h <= Math.floor((we-1)/60); h++) hrs.push(h);
  const frac = h => Math.max(0, Math.min(we, (h+1)*60) - Math.max(ws, h*60)) / 60;
  const w = h => cls === 'sat' && h >= 17 && h <= 21 ? 1.25 : 1;
  const D = hrs.reduce((a, h) => a + cars[h]*frac(h)*w(h), 0), C = hrs.reduce((a, h) => a + coverAt(duties, h), 0);
  return hrs.reduce((a, h) => a + ((cars[h]*frac(h)*w(h)/D) - (coverAt(duties, h)/C))**2 * 1e4, 0);
}
// The header's quarter-hour spacing is a PREFERENCE here, not a pin: with it hard, no weekday table exists under
// the cap (four distinct opener finishes a quarter apart need 45 minutes the ordering rule does not leave).
const closePairs = duties => ['s', 'e'].reduce((n, k) => { const xs = [...new Set(duties.map(d => d[k]))].sort((a, b) => a - b); for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i-1] < SPACING) n++; return n; }, 0);
const offQuarter = duties => new Set(duties.flatMap(d => [d.s, d.e]).filter(m => !PINNED.has(m) && ![0,15,30,45].includes(m % 60)).map(hhmm));
function cost(cls, duties, weekday) {
  const v = violations(cls, duties).reduce((a, [, w]) => a + w, 0);
  const times = new Set(duties.map(timeOf)).size;
  const notWk = weekday ? duties.filter(d => !weekday.some(w => w.s === d.s && w.e === d.e)).length : 0;
  return v * 400 + fit(cls, duties) + times * 0.6 + offQuarter(duties).size * 2.5 + notWk * 1.2;
}


// ── enumeration of length structures ─────────────────────────────────────────────────────────────
const lens = []; for (let L = MIN; L <= CAP; L += 5) lens.push(L);
const okMin = m => ![5, 10].includes(((m % 60) + 60) % 60);
// The owner's ideal is the quarter hour, so the vocabulary is: openers and closers whose free end lands on
// :00/:15/:30/:45, middles a multiple of a quarter long — and 8h40 itself, the cap, wherever the window's
// own :20/:55/:25 instants put it off the quarter (07:15–15:55 is the shape). With every length a multiple
// of five the weekday alone had 540,737 length structures; with this vocabulary the table stays readable.
const quarter = m => [0, 15, 30, 45].includes(((m % 60) + 60) % 60);
// Openers and closers keep the five-minute grid (minus :05/:10): four distinct opener finishes on the quarter
// hour need 45 minutes of spread, and the cap with the ordering rule leaves the long earlies about 20 —
// quarter-only openers enumerate to NOTHING, on every day. The quarter hour stays a preference (penalised).
const openerLens = cls => lens.filter(L => okMin(WIN[cls][0] + L));
const closerLens = cls => lens.filter(L => okMin(WIN[cls][1] - L));
const middleLens = lens;   // every five-minute length: the enumeration COUNTS, so it must admit whatever the anneal may place
// pick k values from a sorted list, strictly increasing (distinct) or non-decreasing
function* choose(vals, k, distinct, from = 0, acc = []) {
  if (acc.length === k) { yield acc.slice(); return; }
  for (let i = from; i < vals.length; i++) { acc.push(vals[i]); yield* choose(vals, k, distinct, distinct ? i + 1 : i, acc); acc.pop(); }
}
const sum = xs => xs.reduce((a, b) => a + b, 0), mean = xs => sum(xs) / xs.length;
// Groups of slots, each with a count, an allowed value list and whether values must be distinct; enumerated
// sorted within a group (no permutations) and pruned on the running total against what the remaining slots
// can still reach — the unpruned version enumerated 888,000 late-middle combinations per closer set.
function* fill(groups, gi, remaining, acc) {
  if (gi === groups.length) { if (remaining === 0) yield acc.map(g => g.slice()); return; }
  const g = groups[gi]; const vals = g.vals;
  // min/max the LATER groups can still contribute
  let laterMin = 0, laterMax = 0; for (let j = gi + 1; j < groups.length; j++) { const h = groups[j]; if (!h.vals.length && h.count) return; laterMin += h.count * (h.vals[0] ?? 0); laterMax += h.count * (h.vals[h.vals.length - 1] ?? 0); }
  function* rec(k, from, left, cur) {
    if (k === g.count) { acc[gi] = cur; yield* fill(groups, gi + 1, left, acc); return; }
    const slotsLeft = g.count - k;
    for (let i = from; i < vals.length; i++) {
      const v = vals[i]; const minRest = (slotsLeft - 1) * (g.distinct ? v + 5 : v), maxRest = (slotsLeft - 1) * vals[vals.length - 1];
      if (left - v - maxRest > laterMax) continue;   // too little left even at the maximum
      if (left - v - minRest < laterMin) break;      // too much left even at the minimum (values ascend)
      cur.push(v); yield* rec(k + 1, g.distinct ? i + 1 : i, left - v, cur); cur.pop();
    }
  }
  yield* rec(0, 0, remaining, []);
}
export function* structures(cls) {
  const n = N[cls], nc = CLOSERS[cls], total = cls === 'sun' ? SUN_TOTAL : TOTAL[cls]; const nm = n - OPENERS - nc;
  const oL = openerLens(cls), cL = closerLens(cls);
  for (const lmax of lens) for (const lmin of lens.filter(L => L <= lmax)) {
    const lateVals = lens.filter(L => L >= lmin && L <= lmax), longVals = lens.filter(L => L > lmax && L - lmax <= 60), shortVals = lens.filter(L => L < lmin);
    if (!longVals.length || !shortVals.length) continue;
    for (let m = 0; m <= nm; m++) for (const shortRole of ['opener', 'morning']) {
      if (shortRole === 'morning' && m === 0) continue;
      const groups = [
        { name: 'closers', count: nc, vals: cL.filter(L => lateVals.includes(L)), distinct: true },
        { name: 'lateMids', count: nm - m, vals: lateVals.filter(L => middleLens.includes(L)), distinct: false },
        { name: 'openers', count: shortRole === 'opener' ? OPENERS - 1 : OPENERS, vals: oL.filter(L => longVals.includes(L)), distinct: true },
        { name: 'mornMids', count: shortRole === 'opener' ? m : m - 1, vals: longVals.filter(L => middleLens.includes(L)), distinct: false },
        { name: 'short', count: 1, vals: shortRole === 'opener' ? oL.filter(L => shortVals.includes(L)) : shortVals.filter(L => middleLens.includes(L)), distinct: false },
      ];
      for (const [closers, lateMids, openers, mornMids, short] of fill(groups, 0, total, [])) {
        const lates = [...closers, ...lateMids]; if (Math.min(...lates) !== lmin || Math.max(...lates) !== lmax) continue;   // this (lmin, lmax) cell owns it
        if (lates.length < 3) continue;
        const earlies = [...openers, ...mornMids, short]; if (earlies.length < 3) continue;
        if (mean(earlies) - mean(lates) < MEAN_GAP[cls]) continue;
        yield { m, closers, lateMids, openers: shortRole === 'opener' ? [...openers, short[0]] : openers, mornMids: shortRole === 'morning' ? [...mornMids, short[0]] : mornMids };
      }
    }
  }
}

// ── placement: a role-preserving anneal over the day, graded pins as the slope ────────────────────
let seed = SEED0; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = a => a[Math.floor(rnd() * a.length)];
const clone = ds => ds.map(d => ({ ...d }));
function score(cls, ds, weekday) {
  const v = violations(cls, ds); const shared = weekday ? ds.filter(d => weekday.some(w => w.s === d.s && w.e === d.e)).length : 0;
  return { c: v.reduce((a, [, w]) => a + w, 0) * 1000 + fit(cls, ds) + new Set(ds.map(timeOf)).size * 0.6 + offQuarter(ds).size * 15 + closePairs(ds) * 10 - shared * 2.5, v };
}
function initial(cls) {
  // ON THE GRID: a total that is not a multiple of 5n (a Sunday walk step of 4,835) must not seed 483.5-minute
  // duties — every move keeps whatever grid the seed is on, and the first cut put 14:37 on a Sunday sheet.
  const [open, close] = WIN[cls]; const n = N[cls]; const total = cls === 'sun' ? SUN_TOTAL : TOTAL[cls];
  const base = Math.floor(total / n / 5) * 5; let extra = (total - base * n) / 5;   // this many duties get five more
  const len = () => base + (extra-- > 0 ? 5 : 0); const d = [];
  for (let i = 0; i < OPENERS; i++) { const L = len(); d.push({ role: 'o', s: open, e: open + L }); }
  for (let i = 0; i < CLOSERS[cls]; i++) { const L = len(); d.push({ role: 'c', s: close - L, e: close }); }
  while (d.length < n) { const L = len(); const s0 = open + 60 + 15 * Math.floor(rnd() * ((close - 60 - L - open - 60) / 15)); d.push({ role: 'm', s: s0, e: s0 + L }); }
  return d;
}
function move(cls, ds) {
  const [open, close] = WIN[cls]; const q = clone(ds); const r = rnd();
  const freeEnd = d => d.role === 'o' ? 'e' : d.role === 'c' ? 's' : pick(['s', 'e']);
  if (r < 0.55) {   // transfer minutes between two duties: the total is preserved
    const i = Math.floor(rnd() * q.length), j = Math.floor(rnd() * q.length); if (i === j) return null;
    const delta = pick([5, 5, 15, 15, 30]); const ki = freeEnd(q[i]), kj = freeEnd(q[j]);
    if (ki === 'e') q[i].e += delta; else q[i].s -= delta;
    if (kj === 'e') q[j].e -= delta; else q[j].s += delta;
  } else if (r < 0.8) {   // slide a middle
    const mids = q.filter(d => d.role === 'm'); if (!mids.length) return null; const d = pick(mids); const delta = pick([-30, -15, 15, 30]); d.s += delta; d.e += delta;
  } else if (r < 0.9) {   // relocate a middle outright — a morning middle cannot become a late one fifteen minutes at a time
    const mids = q.filter(d => d.role === 'm'); if (!mids.length) return null; const d = pick(mids); const L = d.e - d.s;
    const lo = open + 45, hi = close - 60 - L; d.s = lo + 15 * Math.floor(rnd() * ((hi - lo) / 15 + 1)); d.e = d.s + L;
  } else {   // swap two duties' lengths (roles keep their pinned end)
    const i = Math.floor(rnd() * q.length), j = Math.floor(rnd() * q.length); if (i === j) return null;
    const Li = q[i].e - q[i].s, Lj = q[j].e - q[j].s; if (Li === Lj) return null;
    const set = (d, L) => { if (d.role === 'o') d.e = d.s + L; else if (d.role === 'c') d.s = d.e - L; else d.e = d.s + L; };
    set(q[i], Lj); set(q[j], Li);
  }
  for (const d of q) if (d.s < open || d.e > close || d.e - d.s < MIN - 30 || d.e - d.s > CAP + 30) return null;
  return q;
}
function annealDay(cls, weekday, restarts = RESTARTS) {
  let best = null;
  for (let r = 0; r < restarts; r++) {
    let cur = initial(cls), cc = score(cls, cur, weekday).c; let lb = { d: clone(cur), c: cc };
    for (let st = 0; st < STEPS; st++) {
      const T = 2000 * Math.pow(0.3 / 2000, st / STEPS);
      const q = move(cls, cur); if (!q) continue; const c2 = score(cls, q, weekday).c;
      if (c2 <= cc || rnd() < Math.exp((cc - c2) / T)) { cur = q; cc = c2; if (cc < lb.c) lb = { d: clone(cur), c: cc }; }
    }
    const sc = score(cls, lb.d, weekday);
    console.error(`  [${cls}] restart ${r}: cost ${lb.c.toFixed(1)} fit ${fit(cls, lb.d).toFixed(1)}${sc.v.length ? ' — ' + sc.v.map(([m]) => m).join('; ') : ' ✓'}`);
    if (!sc.v.length && (!best || lb.c < best.c)) best = { ...lb, v: sc.v };
  }
  return best;
}
// Is a placed day one of the enumerated length structures? (roles by pinned end; middles by start class)
function inEnumeration(cls, ds) {
  const [open, close] = WIN[cls]; const key = st => JSON.stringify([st.openers.slice().sort((a,b)=>a-b), st.closers.slice().sort((a,b)=>a-b), st.mornMids.slice().sort((a,b)=>a-b), st.lateMids.slice().sort((a,b)=>a-b)]);
  const L = d => d.e - d.s; const mine = key({ openers: ds.filter(d => d.s === open).map(L), closers: ds.filter(d => d.e === close).map(L), mornMids: ds.filter(d => d.s !== open && d.e !== close && d.s < LATE_FROM).map(L), lateMids: ds.filter(d => d.s !== open && d.e !== close && d.s >= LATE_FROM).map(L) });
  let n = 0; let found = false; for (const st of structures(cls)) { n++; if (key(st) === mine) found = true; } return { n, found };
}

if (process.argv[1]?.endsWith('table-book.mjs')) {
  const show = ds => [...ds].sort((a, b) => a.s - b.s || a.e - b.e).map(d => `${timeOf(d)} ${Math.floor((d.e-d.s)/60)}h${String((d.e-d.s)%60).padStart(2,'0')}`).join(' | ');
  const found = {}; const counts = {};
  for (const cls of ['weekday', 'sat', 'sun']) {
    let best = null;
    if (cls === 'sun') { for (SUN_TOTAL = 5000; SUN_TOTAL >= SUN_FLOOR && !best; SUN_TOTAL -= 5) { best = annealDay('sun', null, Math.min(4, RESTARTS)); if (!best) console.error(`  [sun] no table pays ${SUN_TOTAL} under the pins; trying ${SUN_TOTAL - 5}`); } if (best) { SUN_TOTAL += 5; best = annealDay('sun', null) ?? best; } }   // a short walk finds the total; the full run then places it
    else best = annealDay(cls, cls === 'sat' ? found.weekday.d : null);
    if (!best) { console.error(`no feasible ${cls} table`); process.exit(1); }
    const { n, found: ok } = inEnumeration(cls, best.d); counts[cls] = { structures: n, inEnumeration: ok };
    console.log(`${cls}: ${n} length structures pay the day under the pins; the placed table's lengths are ${ok ? 'one of them' : 'NOT AMONG THEM — check the pins'}`);
    found[cls] = best;
    console.log(`  best fit ${fit(cls, best.d).toFixed(1)}${cls === 'sat' ? `, turns not on the weekday: ${best.d.filter(d => !found.weekday.d.some(w => w.s === d.s && w.e === d.e)).length}` : ''}\n  ${show(best.d)}`);
  }
  const rows = new Map(); const add = (cls, ds) => { for (const d of ds) { const t = timeOf(d); if (!rows.has(t)) rows.set(t, { time: t, weekday: 0, sat: 0, sun: 0 }); rows.get(t)[cls]++; } };
  add('weekday', found.weekday.d); add('sat', found.sat.d); add('sun', found.sun.d);
  const slots = [...rows.values()].sort((a, b) => a.time.localeCompare(b.time));
  const off = offQuarter([...found.weekday.d, ...found.sat.d, ...found.sun.d]);
  const gapOf = ds => { const E = ds.filter(d => d.s < LATE_FROM).map(d => d.e - d.s), L = ds.filter(d => d.s >= LATE_FROM).map(d => d.e - d.s); return +(mean(E) - mean(L)).toFixed(1); };
  const meanGap = { weekday: gapOf(found.weekday.d), sat: gapOf(found.sat.d), sun: gapOf(found.sun.d) };
  console.log('mean early − mean late:', JSON.stringify(meanGap), '(By the Book asks 30; Saturday cannot exceed 24 under the cap)');
  console.log('rows', slots.length, '· off-quarter times', [...off].join(', ') || 'none', '(By the Book: 3)');
  const bb = buildDefaultTargets().slots; console.log('times shared with By the Book:', slots.filter(s => bb.some(b => b.time === s.time)).map(s => s.time).join(', ') || 'none');
  const satMoves = found.sat.d.filter(d => !found.weekday.d.some(w => w.s === d.s && w.e === d.e)).length;
  writeFileSync('eight-forty-table.json', JSON.stringify({ cap: CAP, seed: SEED0, steps: STEPS, restarts: RESTARTS, sunTotal: SUN_TOTAL, counts, meanGap, fit: { weekday: +fit('weekday', found.weekday.d).toFixed(1), sat: +fit('sat', found.sat.d).toFixed(1), sun: +fit('sun', found.sun.d).toFixed(1) }, satMoves, offQuarter: [...off], slots, spareLines: 4 }, null, 1));
  console.log('wrote eight-forty-table.json');
}
