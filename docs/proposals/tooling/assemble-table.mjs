// Assemble a December duty TABLE from three placed days, in the shape eight-forty-table.json has, so that
// anneal.mjs (variant G) and final.mjs (family B2) read it exactly as they read Eight Forty's.
//
//   node assemble-table.mjs <out.json> <weekday.json> <sat.json> <sun.json>
//
// Each day file is the JSON line place-structures.mjs prints: an array of "HH:MM-HH:MM" strings, one per
// duty. The record fields (cap, pins, counts, fits) are carried so the sheet can state how the table was
// found rather than assert it.
import { readFileSync, writeFileSync } from 'node:fs';
import { DEC_2026_DEMAND } from '../../../links-demand.js';

const [out, wkF, satF, sunF] = process.argv.slice(2);
if (!out || !wkF || !satF || !sunF) { console.error('usage: node assemble-table.mjs <out.json> <weekday.json> <sat.json> <sun.json>'); process.exit(2); }
const read = f => { const j = JSON.parse(readFileSync(f, 'utf8')); return Array.isArray(j) ? j : j.duties; };
const days = { weekday: read(wkF), sat: read(satF), sun: read(sunF) };

const m = t => +t.slice(0, 2) * 60 + +t.slice(3);
const L = t => { const [a, b] = t.split('-'); return m(b) - m(a); };
const WIN = { weekday: [6*60+20, 23*60+55], sat: [6*60+20, 23*60+55], sun: [7*60+15, 23*60+25] };
function fit(cls, duties) {
    const cars = DEC_2026_DEMAND[cls].cars, [ws, we] = WIN[cls]; const hrs = [];
    for (let h = Math.floor(ws/60); h <= Math.floor((we-1)/60); h++) hrs.push(h);
    const frac = h => Math.max(0, Math.min(we, (h+1)*60) - Math.max(ws, h*60)) / 60;
    const cov = h => duties.reduce((a, t) => { const [s, e] = t.split('-').map(m); return a + Math.max(0, Math.min(e, h*60+60) - Math.max(s, h*60)) / 60; }, 0);
    const D = hrs.reduce((a, h) => a + cars[h]*frac(h), 0), C = hrs.reduce((a, h) => a + cov(h), 0);
    return +hrs.reduce((a, h) => a + ((cars[h]*frac(h)/D) - (cov(h)/C))**2 * 1e4, 0).toFixed(1);
}
const rows = new Map();
for (const [cls, ds] of Object.entries(days)) for (const t of ds) { if (!rows.has(t)) rows.set(t, { time: t, weekday: 0, sat: 0, sun: 0 }); rows.get(t)[cls]++; }
const slots = [...rows.values()].sort((a, b) => a.time.localeCompare(b.time));
const total = ds => ds.reduce((a, t) => a + L(t), 0);
const record = {
    cap: Number(process.env.CAP ?? 520),
    pins: { weekday: process.env.PIN_WK ?? '14:00-22:30x2', sat: process.env.PIN_SAT ?? '14:00-22:30x2', sun: process.env.PIN_SUN ?? '13:30-22:00x2' },
    at22: process.env.AT22_FLOOR ? 'floor' : 'exact',
    sunTotal: total(days.sun),
    totals: { weekday: total(days.weekday), sat: total(days.sat), sun: total(days.sun) },
    fit: { weekday: fit('weekday', days.weekday), sat: fit('sat', days.sat), sun: fit('sun', days.sun) },
    distinct: Object.fromEntries(Object.entries(days).map(([c, ds]) => [c, { starts: new Set(ds.map(t => t.split('-')[0])).size, finishes: new Set(ds.map(t => t.split('-')[1])).size, turns: new Set(ds).size }])),
    longest: Math.max(...Object.values(days).flat().map(L)),
    // Times off the quarter hour, excluding the pinned window instants -- the same figure Eight Forty's record
    // carries, so render.mjs's method page reads it the same way.
    offQuarter: [...new Set(Object.values(days).flat().flatMap(t => t.split('-')).filter(x => ![0, 15, 30, 45].includes(m(x) % 60) && !['06:20', '23:55', '07:15', '23:25'].includes(x)))].sort(),
    counts: process.env.COUNTS_JSON ? JSON.parse(process.env.COUNTS_JSON) : undefined,
    slots, spareLines: 4,
};
writeFileSync(out, JSON.stringify(record, null, 1));
console.log(`wrote ${out}: ${slots.length} rows · totals ${JSON.stringify(record.totals)} · fits ${JSON.stringify(record.fit)} · longest ${record.longest}min`);
