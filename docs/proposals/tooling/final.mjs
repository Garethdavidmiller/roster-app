// Pick the winner, offer it to the app's own reorder, assess today + proposal + comparators, render.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { assess, today, tryAppReorder, demand, hmFromHours, family, startMinutes, endMinutes } from './report-data.mjs';
import { evaluate } from './anneal.mjs';
import { renderPdf } from './render.mjs';
import { generateLink, ROTATING_LINES, DAYS } from '../../../links-design.js';
import { buildDefaultTargets } from '../../../links-default-targets.js';
import { reorderLines, applyOrder, OBJECTIVES } from '../../../links-adjacency.js';

const PROPOSAL = process.env.PROPOSAL ?? 'ST';   // ST = Same Turns · BB = By the Book · QT = Quarter To (ST with the closer at 15:45)
const files = process.argv.slice(2).filter(existsSync);
// Demand fit of a design's weekday cover against the December curve (same formula as fit.mjs):
// squared distance between each hour's share of cover and its share of traffic, inside the window.
import { calcHourlyCoverage } from '../../../links-design.js';
function weekdayFit(p) {
  const cov = calcHourlyCoverage(p, 24).tue.hours; const cars = demand.profile.weekday.cars; const ws = 6*60+20, we = 23*60+55;
  const hrs = []; for (let h = 6; h <= 23; h++) hrs.push(h); const frac = h => Math.max(0, Math.min(we,(h+1)*60) - Math.max(ws,h*60)) / 60;
  const D = hrs.reduce((a,h)=>a+cars[h]*frac(h),0), C = hrs.reduce((a,h)=>a+cov[h],0);
  return +hrs.reduce((a,h)=>a+((cars[h]*frac(h)/D)-(cov[h]/C))**2*1e4,0).toFixed(1);
}
const cands = files.map(f => ({ file: f, ...JSON.parse(readFileSync(f, 'utf8')) })).map(c => ({ ...c, fit: weekdayFit(c.patterns) }))
  // THE PICK: rules first, then how the cover sits against the service, then the search's own feel score.
  .sort((a, b) => a.facts.turnarounds - b.facts.turnarounds || Math.max(0,a.facts.longest-6) - Math.max(0,b.facts.longest-6)
    || a.facts.present - b.facts.present || b.facts.weekends - a.facts.weekends || a.fit - b.fit || a.cost - b.cost);
console.log('candidates:'); for (const c of cands) console.log(`  ${c.file} ${c.variant} cost=${c.cost.toFixed(0)} fit=${c.fit} present=${c.facts.present} run=${c.facts.longest} wk=${c.facts.weekends} fam=${c.facts.famWeeks} iso=${c.facts.iso}`);
const win = cands[0];
const re = tryAppReorder(win.patterns, evaluate);
console.log('app reorder:', re.attempt === null ? 'no improvement — search order kept' : `attempt ${re.attempt} improved ${win.cost.toFixed(0)} → ${re.cost.toFixed(0)}`);
const P = { patterns: re.p, lines: 24, ...assess(re.p, 24) };
const T0 = today(); const T = { ...T0, ...assess(T0.patterns, T0.lines) };

// comparator: the workspace's own December default, generated + reordered with every switch on
const dt = buildDefaultTargets(); const g = generateLink({ slots: dt.slots, spareLines: dt.spareLines, lines: ROTATING_LINES });
const ALL = Object.fromEntries(OBJECTIVES.map(o => [o.key, true])); const gr = reorderLines(g.patterns, { on: ALL }); const gp = applyOrder(g.patterns, gr.order);
const G = assess(gp, 24); const gEval = evaluate(gp);

// ── IDENTITY. A proposal needs a name a room can use, a code that pins how it was built, and a
// fingerprint of the exact cells so a printout can be matched to the design in the workspace.
const fingerprint = p => createHash('sha256').update(JSON.stringify(Object.keys(p).sort((a,b)=>a-b).map(k => DAYS.map(d => p[k][d])))).digest('hex').slice(0, 8);
// FAMILY from the result file itself, not from the PROPOSAL env — a comparator row must carry its own
// family's code. Tables Q and R are Same Turns' table B with the closer at 15:45 (see anneal.mjs).
const famOf = c => c.mode === 'rules' ? 'BB' : /^[QR]$/.test(String(c.variant)) ? 'QT' : 'ST';
const NAMES = { BB: 'By the Book', ST: 'Same Turns', QT: 'Quarter To' };
const codeFor = c => `${famOf(c)}-24-${c.variant}${c.seed ?? '?'}`;
const identity = PROPOSAL === 'BB' ? {
  name: 'By the Book', strap: 'The December rules, built for the fatigue factors',
  code: codeFor(win), fingerprint: fingerprint(P.patterns), table: win.variant, seed: win.seed,
  lineage: 'Family BB — the workspace’s own December duty table (your rules in table form), with the rotation searched for the ORR factors and nothing carried over from today’s roster. Compare with “Same Turns” (ST-24-B7 · d15e1b74) and “Five Shift Times” (23 Aug 2026).',
} : PROPOSAL === 'QT' ? {
  name: 'Quarter To', strap: "Same Turns, with the closing turn starting at quarter to four",
  code: codeFor(win), fingerprint: fingerprint(P.patterns), table: win.variant, seed: win.seed,
  lineage: 'Family QT — “Same Turns” (ST-24-B7 · d15e1b74) with one change asked for: the weekday closing turn starts 15:45, not 15:15. That is thirty minutes off three duties a day, and the contract is exact, so one other turn is stretched at its end to put the minutes back; the table letter says which (Q the 08:00 turn to 17:00, R the 14:00 turn to 23:15). Saturday and Sunday are unchanged. Compare with “Same Turns” and “By the Book” (BB-24-D7 · 0f14abce).',
} : {
  name: 'Same Turns', strap: "Today's link, widened to 24",
  code: codeFor(win), fingerprint: fingerprint(P.patterns), table: win.variant, seed: win.seed,
  lineage: 'Family ST — the existing 20-line link kept in its own shift times and week shapes. Compare with “Five Shift Times” (23 Aug 2026, family FST) and the workspace’s own December default.',
};
const step = a => String(a.fatigue.results.find(r => r.code === 'FF18')?.value ?? '').replace(/.*typically /, '').replace(' a week','');
const alt = (name, a, ev, chosen = false, p = null) => ({ name, run: a.checks.longestStretch, present: a.fatigue.present, weekends: a.checks.weekendsOff, oneTurn: `${a.feel.oneTurn}/${a.feel.workingLines}`, step: step(a), fit: p ? weekdayFit(p) : '—', score: ev ? ev.cost.toFixed(0) : '—', chosen });
const alternatives = [];
for (const c of cands) { const A = assess(c.patterns, 24); alternatives.push(alt(`${codeFor(c)} · ${fingerprint(c.patterns)}${c === win ? ` — <b>${identity.name}</b> (this proposal)` : c === cands[1] ? ' — runner-up' : ''}`, A, { cost: c.cost }, c === win, c.patterns)); }
alternatives.push(alt(`Workspace default · ${fingerprint(gp)} (Dec 2026 table, generated)`, G, gEval, false, gp));
for (const x of (process.env.EXTRA ?? '').split(',').filter(existsSync)) { const e = JSON.parse(readFileSync(x, 'utf8')); alternatives.push(alt(`${codeFor(e)}p · ${fingerprint(e.patterns)} — rules only, no coherence term`, assess(e.patterns, 24), null, false, e.patterns)); }
// The siblings: the OTHER shipped proposals, so a reader can put this one beside them on one table.
const siblings = PROPOSAL === 'BB' ? ['best-B-7.json'] : PROPOSAL === 'QT' ? ['best-B-7.json', 'best-RD-7.json'] : ['best-RD-7.json'];
for (const sibling of siblings.map(f => `results/${f}`).concat(siblings).filter(existsSync).filter((f, i, a) => a.findIndex(x => x.endsWith(f.split('/').pop())) === i)) { const sb = JSON.parse(readFileSync(sibling, 'utf8')); alternatives.push(alt(`${codeFor(sb)} · ${fingerprint(sb.patterns)} — <b>${NAMES[famOf(sb)]}</b> (a sibling proposal)`, assess(sb.patterns, 24), null, false, sb.patterns)); }
const tp24 = {}; for (let i = 1; i <= 24; i++) tp24[i] = T.patterns[String(((i-1)%20)+1)];
alternatives.push(alt("Today's 20-line link (for scale)", T, null, false, null)); alternatives[alternatives.length-1].fit = weekdayFit(tp24);

// December design figures, checked on the proposal itself
const cnt = (day, pred) => Object.values(P.patterns).filter(r => r[day] !== 'RD' && r[day] !== 'SPARE' && pred(r[day])).length;
const rules = [
  { rule: 'Four on at the open, every day', value: `${cnt('tue', t => t.startsWith('06:20'))} weekday · ${cnt('sat', t => t.startsWith('06:20'))} Saturday · ${cnt('sun', t => t.startsWith('07:15'))} Sunday`, ok: cnt('tue', t => t.startsWith('06:20')) === 4 && cnt('sat', t => t.startsWith('06:20')) === 4 && cnt('sun', t => t.startsWith('07:15')) === 4, note: '' },
  { rule: 'Three through to the close; four on a Saturday', value: `${cnt('tue', t => t.endsWith('23:55'))} weekday · ${cnt('sat', t => t.endsWith('23:55'))} Saturday · ${cnt('sun', t => t.endsWith('23:25'))} Sunday`, ok: cnt('tue', t => t.endsWith('23:55')) === 3 && cnt('sat', t => t.endsWith('23:55')) === 4 && cnt('sun', t => t.endsWith('23:25')) === 3, note: '' },
  { rule: 'Five still on duty at 22:00', value: `${cnt('tue', t => endMinutes(t) > 22*60)} weekday · ${cnt('sat', t => endMinutes(t) > 22*60)} Saturday`, ok: cnt('tue', t => endMinutes(t) > 22*60) === 5 && cnt('sat', t => endMinutes(t) > 22*60) === 5, note: 'a 22:00 finish is not "on at 22:00"' },
  { rule: 'Fourteen on a Saturday, ten on a Sunday', value: `${P.daily.sat} · ${P.daily.sun}`, ok: P.daily.sat === 14 && P.daily.sun === 10, note: '' },
  { rule: 'Four cover weeks, evenly spread', value: `lines ${P.feel.spareLines.join(', ')} — gaps ${P.adj.spareGaps.join(', ')}`, ok: P.adj.spareExcess === 0, note: 'whole weeks, never scattered days' },
  { rule: 'About 4.2 days a week worked, Mon–Sat', value: `${P.totals.daysAverage.toFixed(2)} over the 20 working lines`, ok: Math.abs(P.totals.daysAverage - 4.2) < 0.15, note: '' },
  { rule: 'No :05 or :10 times except the open and close', value: 'none', ok: P.tableRows.every(r => !/[:](05|10)$/.test(r.time.split('-')[0]) && !/[:](05|10)$/.test(r.time.split('-')[1])), note: "today's times already obey this" },
  (() => { const rows = P.tableRows.filter(r => r.weekday > 0 || r.sat > 0); const E = rows.filter(r => startMinutes(r.time) < 11*60).map(r => r.minutes).sort((a,b)=>a-b), L = rows.filter(r => startMinutes(r.time) >= 11*60).map(r => r.minutes);
      const hm = m => `${Math.floor(m/60)}h${String(m%60).padStart(2,'0')}`; const ok = E.length > 1 && L.length > 0 && E[0] < Math.min(...L) && E[1] > Math.max(...L);
      return { rule: 'Late turns slightly shorter than most earlies', value: ok ? `met — lates ${hm(Math.min(...L))}–${hm(Math.max(...L))}, earlies ${hm(E[0])} then ${hm(E[1])}–${hm(E[E.length-1])}` : `not met — lates ${hm(Math.min(...L))}–${hm(Math.max(...L))}, earlies ${hm(E[0])}–${hm(E[E.length-1])}, as today`, ok,
        note: ok ? 'one short open turn, then every other early longer than every late' : 'incompatible with keeping today’s times: meeting it needs 9h+ earlies or 15 duties a day — flagged for decision, below' }; })(),
];

const sundayOut = demand.movementsOutside(demand.movements.sun, 7*60+15, 23*60+25);
// QT: which turn was stretched to keep the contract, READ from the finished table against Same Turns'
// (table B, best-B-7.json), so the PDF cannot name a stretch the cells do not carry.
const stretch = (() => {
  if (PROPOSAL !== 'QT') return null;
  const bFile = ['results/best-B-7.json', 'best-B-7.json'].find(existsSync); if (!bFile) return null;
  const B = assess(JSON.parse(readFileSync(bFile, 'utf8')).patterns, 24);
  const gone = B.tableRows.filter(r => r.weekday > 0 && !P.tableRows.some(x => x.time === r.time)).map(r => r.time);
  const came = P.tableRows.filter(r => r.weekday > 0 && !B.tableRows.some(x => x.time === r.time)).map(r => r.time);
  const pair = (from, to) => from.slice(0,5) === to.slice(0,5) ? { from, to, people: P.tableRows.find(r => r.time === to).weekday, each: endMinutes(to) - endMinutes(from) } : null;
  const st = gone.flatMap(g => came.map(c => pair(g, c))).find(Boolean);
  const closer = { from: gone.find(t => t.endsWith('23:55')), to: came.find(t => t.endsWith('23:55')) };
  return { ...st, closer, closerShift: closer.from && closer.to ? startMinutes(closer.to) - startMinutes(closer.from) : null, weekly: st ? st.people * st.each * 5 : null };
})();
// Which rule (or the fit) separated the winner from the runner-up — computed, so page 7 cannot claim a tie that was not one.
const pickNote = (() => {
  const [a, b] = cands; if (!b) return 'One candidate.';
  const rules = [['turnarounds', 'rest'], ['longest', 'the longest run'], ['present', 'fatigue factors present']];
  for (const [k, w] of rules) if (a.facts[k] !== b.facts[k]) return `${w} decided it (${a.facts[k]} against ${b.facts[k]} for the runner-up).`;
  if (a.facts.weekends !== b.facts.weekends) return `full weekends off decided it (${a.facts.weekends} against ${b.facts.weekends}).`;
  if (a.fit !== b.fit) return `The top two tied on every rule; the fit decided it (${a.fit} against ${b.fit}), and the runner-up is named so it can be asked for.`;
  return `The top two tied on every rule and on fit; the search's own score decided it (${a.cost.toFixed(0)} against ${b.cost.toFixed(0)}).`;
})();
const meta = {
  date: PROPOSAL === 'QT' ? '12 September 2026' : '8 September 2026',
  tables: PROPOSAL === 'QT' ? 59 : 81, steps: PROPOSAL === 'QT' ? '120,000' : '60,000', restarts: PROPOSAL === 'QT' ? 'six' : 'four',
  runs: PROPOSAL === 'QT' ? 'four seeded runs per table, two tables' : PROPOSAL === 'BB' ? 'four seeded runs' : 'three seeded runs per table',
  stretch, pickNote, candidateFiles: cands.map(c => c.file), winnerVariant: win.variant,
  sundayNote: `Sunday: ${sundayOut.after?.length ?? 5} December movements fall after the 23:25 finish (the last at 23:54, three of them arrivals) — the standing question on whether Sunday's window moves; the window is stored per design, so the proposal can be rebuilt to either answer.`,
  designRules: rules, alternatives, identity,
  openQuestions: PROPOSAL === 'QT' ? `<b>The stretched turn.</b> Moving the closer to 15:45 takes ${stretch?.closerShift ?? ''} minutes off three duties a day, and the 35-hour contract is exact, so those minutes have to go back somewhere. With today's turns alone no table does it; the proposal lengthens ${stretch ? `the ${stretch.from} turn to ${stretch.to.split('-')[1]} (${stretch.people} people, ${stretch.each} minutes each)` : 'one turn'} — a new finish time for those on it, and the question for the room is whether that is the right turn to carry it. The other three ways of doing it are on page 7. <b>Late-turn length</b> is inherited from <i>Same Turns</i> and still not met — lates longer than earlies, as today. <b>Sunday's finish</b> — five December movements fall after 23:25; the proposal inherits today's window deliberately rather than deciding it.` : PROPOSAL === 'BB' ? `<b>Familiarity.</b> Every rule is met, and the price is that none of the 19 turns is one people work today — the earlies run to 9h30 and the closers start at 15:45–16:40 rather than 15:15. That is the trade between this family and <i>Same Turns</i>, and it is a people question rather than a rules one. <b>Sunday's finish</b> — five December movements fall after 23:25; the proposal inherits today's window deliberately rather than deciding it.` : `<b>Late-turn length.</b> The one December preference this proposal does not meet is the owner's own — lates slightly shorter than most earlies. Today's link has it the other way round (a 15:15–23:55 late is 8h40, a 06:20–14:20 early 8h00) and the brief was to keep today's times; meeting both is arithmetically impossible at 14 duties a day, because the day's minutes are fixed by the contract. The choice is between today's clock times and shorter lates paid for by longer earlies (the workspace default does this, with 9h25 earlies). <b>Sunday's finish</b> — five December movements fall after 23:25; the proposal inherits today's window deliberately rather than deciding it.`,
};
writeFileSync('proposal.json', JSON.stringify({ name: `${identity.name} — Dec 2026 (${identity.code} · ${identity.fingerprint})`, patterns: P.patterns }, null, 1));
console.log('identity', JSON.stringify(identity));
writeFileSync('proposal-import.txt', Array.from({ length: 24 }, (_, i) => `${i+1}\t${DAYS.map(d => P.patterns[String(i+1)][d] === 'SPARE' ? 'SP' : P.patterns[String(i+1)][d]).join('\t')}`).join('\n'));
meta.kind = PROPOSAL;
await renderPdf({ today: T, prop: P, meta, demand }, process.env.OUT ?? `${process.cwd()}/${identity.name.replace(/ /g,'-')}-${identity.code}-${identity.fingerprint}.pdf`);
console.log('rendered. proposal facts:', JSON.stringify({ hours: P.hours.exSunday, run: P.checks.longestStretch, turnarounds: P.checks.turnarounds.length, weekends: P.checks.weekendsOff, present: P.fatigue.present, feel: P.feel }));
