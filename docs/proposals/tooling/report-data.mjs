// Everything the PDF states, computed by the app's own modules for BOTH the live roster and the proposal.
import { readFileSync } from 'node:fs';
import { runDesignChecks, weeklyHours, lineTotals, calcHourlyCoverage, classifyShift, startMinutes, endMinutes, dutyMinutes, DAYS, hmFromHours } from '../../../links-design.js';
import { assessFatigue } from '../../../links-fatigue.js';
import { assessHardLimits, MAX_CONSECUTIVE_WORKED_DAYS } from '../../../links-limits.js';
import { scoreOrder, reorderLines, applyOrder, OBJECTIVES } from '../../../links-adjacency.js';
import { DEC_2026_DEMAND, demandBucket, peakCars, movementsOutside, DEC_2026_MOVEMENTS } from '../../../links-demand.js';
import { weeklyRoster } from '../../../roster-cycle-data.js';

export const family = t => { const s = startMinutes(t); if (s === null) return null; return s < 9*60 ? 'E' : 'L'; };

export function feel(p, lines) {
  const keys = Array.from({ length: lines }, (_, i) => String(i+1));
  const work = keys.filter(k => p[k].mon !== 'SPARE');
  let oneTurn = 0, hybrid = 0, isolated = 0, pairedRest = 0, restIslands = 0; const daysHist = {}; const times = new Set();
  const seq = []; for (const k of keys) for (const d of DAYS) seq.push(p[k][d]);
  const n = seq.length;
  for (let i = 0; i < n; i++) { if (seq[i] !== 'RD') continue; const prev = seq[(i+n-1)%n] === 'RD', next = seq[(i+1)%n] === 'RD'; if (!prev) { restIslands++; if (!next) isolated++; else pairedRest++; } }
  for (const k of work) { const row = p[k]; const wk = ['mon','tue','wed','thu','fri'].map(d => row[d]).filter(s => s !== 'RD');
    const fams = new Set(DAYS.map(d => row[d]).filter(s => s !== 'RD').map(family));
    if (new Set(wk).size <= 1 && fams.size <= 1) oneTurn++; if (fams.size > 1) hybrid++;
    const days = DAYS.filter(d => row[d] !== 'RD').length; daysHist[days] = (daysHist[days] ?? 0) + 1;
    for (const d of DAYS) if (row[d] !== 'RD') times.add(row[d]); }
  return { workingLines: work.length, oneTurn, hybrid, isolatedRest: isolated, pairedRest, restIslands, daysHist, distinctTimes: times.size, spareLines: keys.filter(k => p[k].mon === 'SPARE').map(Number) };
}

export function assess(p, lines) {
  const keys = Array.from({ length: lines }, (_, i) => String(i+1));
  const checks = runDesignChecks(p, lines), hours = weeklyHours(p, lines), totals = lineTotals(p, lines);
  const fatigue = assessFatigue(p, lines), hard = assessHardLimits(p, lines), adj = scoreOrder(p, keys, { maxRunTarget: 6 });
  const hourly = calcHourlyCoverage(p, lines);
  // duty table by day class (busiest weekday, sat, sun)
  const table = {};
  for (const k of keys) for (const d of DAYS) { const s = p[k][d]; if (s === 'RD' || s === 'SPARE') continue; const cls = d === 'sun' ? 'sun' : d === 'sat' ? 'sat' : 'weekday';
    table[s] ??= { weekday: {}, sat: 0, sun: 0 }; if (cls === 'weekday') table[s].weekday[d] = (table[s].weekday[d] ?? 0) + 1; else table[s][cls]++; }
  const tableRows = Object.entries(table).map(([time, c]) => ({ time, weekday: Math.max(0, ...Object.values(c.weekday)), sat: c.sat, sun: c.sun, minutes: dutyMinutes(time), family: family(time) }))
    .sort((a, b) => startMinutes(a.time) - startMinutes(b.time) || endMinutes(a.time) - endMinutes(b.time));
  const daily = {}; for (const d of DAYS) daily[d] = keys.filter(k => p[k][d] !== 'RD' && p[k][d] !== 'SPARE').length;
  return { checks, hours, totals, fatigue, hard, adj, hourly, tableRows, daily, feel: feel(p, lines) };
}

export function today() { const p = {}; for (let i = 1; i <= 20; i++) p[String(i)] = { ...weeklyRoster[String(i)] }; return { patterns: p, lines: 20 }; }

export function pickBest(files) {
  const cands = files.map(f => JSON.parse(readFileSync(f, 'utf8'))).sort((a, b) => a.cost - b.cost);
  return cands;
}

/** Try the app's own line-order optimiser on top; keep it only if the proposal's own cost improves. */
export function tryAppReorder(p, evaluate) {
  const ALL = Object.fromEntries(OBJECTIVES.map(o => [o.key, true]));
  let best = { p, cost: evaluate(p).cost, attempt: null };
  for (let attempt = 0; attempt < 8; attempt++) { const r = reorderLines(p, { on: ALL, attempt, maxRunTarget: 6 }); const q = applyOrder(p, r.order); const c = evaluate(q).cost; if (c < best.cost) best = { p: q, cost: c, attempt }; }
  return best;
}

export const demand = { profile: DEC_2026_DEMAND, peak: peakCars(DEC_2026_DEMAND), bucket: demandBucket, movements: DEC_2026_MOVEMENTS, movementsOutside };
export { hmFromHours, classifyShift, MAX_CONSECUTIVE_WORKED_DAYS, DAYS, dutyMinutes, startMinutes, endMinutes };
