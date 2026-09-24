// Pick the winner, offer it to the app's own reorder, assess today + proposal + comparators, render.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { assess, today, tryAppReorder, demand, hmFromHours, family, startMinutes, endMinutes, weekdayFit } from './report-data.mjs';
import { evaluate } from './anneal.mjs';
import { renderPdf } from './render.mjs';
import { generateLink, ROTATING_LINES, DAYS } from '../../../links-design.js';
import { buildDefaultTargets } from '../../../links-default-targets.js';
import { reorderLines, applyOrder, OBJECTIVES } from '../../../links-adjacency.js';

const PROPOSAL = process.env.PROPOSAL ?? 'ST';   // ST = Same Turns · BB = By the Book · QT = Quarter To (ST with the closer at 15:45) · EF = Eight Forty (BB with no duty over 8h40) · B2 = By the Book 2 (EF's cap, two ticket-office turns pinned) · Q2 = Quarter To 2 (QT's weekday, Saturday and Sunday rebuilt under the cap)
const files = process.argv.slice(2).filter(existsSync);
// Demand fit of a design's weekday cover against the December 2026 timetable curve (same formula as fit.mjs):
// squared distance between each hour's share of cover and its share of traffic, inside the window.
// How many times on a candidate's sheet nobody works today — a tiebreak AFTER rules and fit, before the
// search's own score (v23.70). Zero for every Same Turns candidate, equal across By the Book's, and the
// thing that separates Quarter To's two tables: Q's stretched openers are Saturday's own times.
const T0_ = today(); const todayTimes = new Set(assess(T0_.patterns, T0_.lines).tableRows.map(r => r.time));
const newTimesOf = p => assess(p, 24).tableRows.filter(r => !todayTimes.has(r.time)).length;
const cands = files.map(f => ({ file: f, ...JSON.parse(readFileSync(f, 'utf8')) })).map(c => ({ ...c, fit: weekdayFit(c.patterns), newTimes: newTimesOf(c.patterns) }))
  // THE PICK: rules first, then how the cover sits against the service, then the search's own feel score.
  .sort((a, b) => a.facts.turnarounds - b.facts.turnarounds || Math.max(0,a.facts.longest-6) - Math.max(0,b.facts.longest-6)
    || a.facts.present - b.facts.present || b.facts.weekends - a.facts.weekends || a.fit - b.fit || a.newTimes - b.newTimes || a.cost - b.cost);
console.log('candidates:'); for (const c of cands) console.log(`  ${c.file} ${c.variant} cost=${c.cost.toFixed(0)} fit=${c.fit} newTimes=${c.newTimes} present=${c.facts.present} run=${c.facts.longest} wk=${c.facts.weekends} fam=${c.facts.famWeeks} iso=${c.facts.iso}`);
const win = cands[0];
const re = tryAppReorder(win.patterns, evaluate);
console.log('app reorder:', re.attempt === null ? 'no improvement — search order kept' : `attempt ${re.attempt} improved ${win.cost.toFixed(0)} → ${re.cost.toFixed(0)}`);
const P = { patterns: re.p, lines: 24, ...assess(re.p, 24) };
const T0 = today(); const T = { ...T0, ...assess(T0.patterns, T0.lines) };

// comparator: the workspace's own December 2026 duty-table default, generated + reordered with every switch on
const dt = buildDefaultTargets(); const g = generateLink({ slots: dt.slots, spareLines: dt.spareLines, lines: ROTATING_LINES });
const ALL = Object.fromEntries(OBJECTIVES.map(o => [o.key, true])); const gr = reorderLines(g.patterns, { on: ALL }); const gp = applyOrder(g.patterns, gr.order);
const G = assess(gp, 24); const gEval = evaluate(gp);

// ── IDENTITY. A proposal needs a name a room can use, a code that pins how it was built, and a
// fingerprint of the exact cells so a printout can be matched to the design in the workspace.
const fingerprint = p => createHash('sha256').update(JSON.stringify(Object.keys(p).sort((a,b)=>a-b).map(k => DAYS.map(d => p[k][d])))).digest('hex').slice(0, 8);
// FAMILY from the result file itself, not from the PROPOSAL env — a comparator row must carry its own
// family's code. Tables Q and R are Same Turns' table B with the closer at 15:45 (see anneal.mjs).
const famOf = c => c.mode === 'rules' ? (c.variant === 'E' ? 'EF' : c.variant === 'G' ? 'B2' : 'BB') : /^[QR]$/.test(String(c.variant)) ? 'QT' : c.variant === 'W' ? 'Q2' : 'ST';
const NAMES = { BB: 'By the Book', ST: 'Same Turns', QT: 'Quarter To', EF: 'Eight Forty', B2: 'By the Book 2', Q2: 'Quarter To 2' };
// EF: the table search's own record — how many length structures paid the day, how many placed, the fits.
const efTable = PROPOSAL === 'EF' ? JSON.parse(readFileSync('eight-forty-table.json', 'utf8')) : PROPOSAL === 'B2' ? JSON.parse(readFileSync('by-the-book-2-table.json', 'utf8')) : PROPOSAL === 'Q2' ? JSON.parse(readFileSync('quarter-to-2-table.json', 'utf8')) : null;
const codeFor = c => `${famOf(c)}-24-${c.variant}${c.seed ?? '?'}`;
const identity = PROPOSAL === 'BB' ? {
  name: 'By the Book', strap: 'The December 2026 timetable rules, built for the fatigue factors',
  code: codeFor(win), fingerprint: fingerprint(P.patterns), table: win.variant, seed: win.seed,
  lineage: 'Family BB — the workspace’s own December 2026 duty table (your rules in table form), with the rotation searched for the ORR factors and nothing carried over from today’s roster. Compare with “Same Turns” (ST-24-B7 · d15e1b74) and “Five Shift Times” (23 Aug 2026).',
} : PROPOSAL === 'EF' ? {
  name: 'Eight Forty', strap: 'By the Book, with no duty over 8h40',
  code: codeFor(win), fingerprint: fingerprint(P.patterns), table: win.variant, seed: win.seed,
  lineage: 'Family EF — “By the Book” (BB-24-D7 · 0f14abce) under one more rule: no duty runs over 8h40. Five of that table’s eleven Mon–Sat turns did (its earlies ran to 9h30), so the whole December 2026 duty table was searched again under the same rules with the ceiling at 8h40, and the rotation then searched for the ORR factors exactly as “By the Book” was. Nothing is carried over from today’s roster. Compare with “By the Book”, “Same Turns” (ST-24-B7 · d15e1b74) and “Quarter To” (QT-24-Q34 · 70cf9874).',
} : PROPOSAL === 'B2' ? {
  name: 'By the Book 2', strap: 'Eight Forty, with the ticket office rostered — two 14:00–22:30 a day',
  code: codeFor(win), fingerprint: fingerprint(P.patterns), table: win.variant, seed: win.seed,
  lineage: 'Family B2 — “Eight Forty” (EF-24-E21 · 0cf19f56) with the ticket office written in: two 14:00–22:30 turns every day Monday to Saturday and two 13:30–22:00 on a Sunday, fixed before the rest of the day was searched. Same 8h40 ceiling, same December 2026 timetable rules, demand fit ahead of the count of distinct times (owner, 22 Sep 2026). The rotation was then searched for the ORR factors exactly as “By the Book” and “Eight Forty” were. Compare with “Eight Forty”, “By the Book” (BB-24-D7 · 0f14abce) and “Same Turns” (ST-24-B7 · d15e1b74).',
} : PROPOSAL === 'Q2' ? {
  name: 'Quarter To 2', strap: 'Quarter To, with Saturday and Sunday rebuilt under the cap',
  code: codeFor(win), fingerprint: fingerprint(P.patterns), table: win.variant, seed: win.seed,
  lineage: 'Family Q2 — “Quarter To” (QT-24-Q34 · 70cf9874) with its own open question answered: the 8h40 cap reaches the weekend. The weekday is Quarter To’s table Q unchanged; Saturday and Sunday were searched again from today’s clock times and the quarter hour, under the December 2026 headcounts and nothing over 8h40, and the rotation was then searched exactly as Quarter To was. Compare with “Quarter To”, “Same Turns” (ST-24-B7 · d15e1b74) and “By the Book” (BB-24-D7 · 0f14abce).',
} : PROPOSAL === 'QT' ? {
  name: 'Quarter To', strap: "Same Turns, with the closing turn starting at quarter to four",
  code: codeFor(win), fingerprint: fingerprint(P.patterns), table: win.variant, seed: win.seed,
  lineage: 'Family QT — “Same Turns” (ST-24-B7 · d15e1b74) with two things asked for: the weekday closing turn starts 15:45, not 15:15, and no duty runs over 8h40. The later start is thirty minutes off three duties a day, and the contract is exact, so the two 06:20 openers run on at their finish to put the minutes back; the table letter says how far (Q to 14:00 and 14:50, Saturday’s own opening times; R to 14:30). Saturday and Sunday are unchanged. Compare with “Same Turns” and “By the Book” (BB-24-D7 · 0f14abce).',
} : {
  name: 'Same Turns', strap: "Today's link, widened to 24",
  code: codeFor(win), fingerprint: fingerprint(P.patterns), table: win.variant, seed: win.seed,
  lineage: 'Family ST — the existing 20-line link kept in its own shift times and week shapes. Compare with “Five Shift Times” (23 Aug 2026, family FST) and the workspace’s own December 2026 duty-table default.',
};
const step = a => String(a.fatigue.results.find(r => r.code === 'FF18')?.value ?? '').replace(/.*typically /, '').replace(' a week','');
const alt = (name, a, ev, chosen = false, p = null) => ({ name, run: a.checks.longestStretch, present: a.fatigue.present, weekends: a.checks.weekendsOff, oneTurn: `${a.feel.oneTurn}/${a.feel.workingLines}`, step: step(a), fit: p ? weekdayFit(p) : '—', score: ev ? ev.cost.toFixed(0) : '—', chosen });
const alternatives = [];
// The rows that carry information. Every seed's result is in results/ and named in the note below;
// listing all eight on the page put the alternatives table past the printable A4 height (measured
// 1117px against 1032 — shots.mjs), so QT shows the winner, the runner-up and the other table's best.
const shown = PROPOSAL === 'QT'
  ? [...new Set([cands[0], cands[1], cands.find(c => c.variant !== cands[0].variant)].filter(Boolean))]
  : PROPOSAL === 'EF' || PROPOSAL === 'B2' || PROPOSAL === 'Q2' ? cands.slice(0, 2) : cands;
for (const c of shown) { const A = assess(c.patterns, 24); alternatives.push(alt(`${codeFor(c)} · ${fingerprint(c.patterns)}${c === win ? ` — <b>${identity.name}</b> (this proposal)` : c === cands[1] ? ' — runner-up' : ''}`, A, { cost: c.cost }, c === win, c.patterns)); }
alternatives.push(alt(`Workspace default · ${fingerprint(gp)} (Dec 2026 table, generated)`, G, gEval, false, gp));
for (const x of (process.env.EXTRA ?? '').split(',').filter(existsSync)) { const e = JSON.parse(readFileSync(x, 'utf8')); alternatives.push(alt(`${codeFor(e)}p · ${fingerprint(e.patterns)} — rules only, no coherence term`, assess(e.patterns, 24), null, false, e.patterns)); }
// The siblings: the OTHER shipped proposals, so a reader can put this one beside them on one table.
const siblings = PROPOSAL === 'BB' ? ['best-B-7.json'] : PROPOSAL === 'QT' ? ['best-B-7.json', 'best-RD-7.json'] : PROPOSAL === 'EF' ? ['best-RD-7.json', 'best-B-7.json', 'best-Q-34.json'] : PROPOSAL === 'B2' ? ['best-RE-21.json', 'best-RD-7.json', 'best-B-7.json'] : PROPOSAL === 'Q2' ? ['best-Q-34.json', 'best-B-7.json', 'best-RD-7.json'] : ['best-RD-7.json'];
for (const sibling of siblings.map(f => `results/${f}`).concat(siblings).filter(existsSync).filter((f, i, a) => a.findIndex(x => x.endsWith(f.split('/').pop())) === i)) { const sb = JSON.parse(readFileSync(sibling, 'utf8')); alternatives.push(alt(`${codeFor(sb)} · ${fingerprint(sb.patterns)} — <b>${NAMES[famOf(sb)]}</b> (a sibling proposal)`, assess(sb.patterns, 24), null, false, sb.patterns)); }
const tp24 = {}; for (let i = 1; i <= 24; i++) tp24[i] = T.patterns[String(((i-1)%20)+1)];
alternatives.push(alt("Today's 20-line link (for scale)", T, null, false, null)); alternatives[alternatives.length-1].fit = weekdayFit(tp24);

// December 2026 timetable design figures, checked on the proposal itself
const cnt = (day, pred) => Object.values(P.patterns).filter(r => r[day] !== 'RD' && r[day] !== 'SPARE' && pred(r[day])).length;
// Weekdays are not one day: a range across Mon-Fri where they differ, and the WORST weekday decides a pass
// (owner, 24 Sep 2026 -- every one of these rows read Tuesday and called it the week).
const WDAYS = ['mon','tue','wed','thu','fri'];
const wdMin = pred => Math.min(...WDAYS.map(d => cnt(d, pred)));
const wdCnt = pred => { const v = WDAYS.map(d => cnt(d, pred)); const lo = Math.min(...v), hi = Math.max(...v); return lo === hi ? String(lo) : `${lo}–${hi}`; };
const rules = [
  { rule: 'Four on at the open, every day', value: `${wdCnt(t => t.startsWith('06:20'))} weekday · ${cnt('sat', t => t.startsWith('06:20'))} Saturday · ${cnt('sun', t => t.startsWith('07:15'))} Sunday`, ok: wdMin(t => t.startsWith('06:20')) === 4 && cnt('sat', t => t.startsWith('06:20')) === 4 && cnt('sun', t => t.startsWith('07:15')) === 4, note: '' },
  { rule: 'Three through to the close; four on a Saturday', value: `${wdCnt(t => t.endsWith('23:55'))} weekday · ${cnt('sat', t => t.endsWith('23:55'))} Saturday · ${cnt('sun', t => t.endsWith('23:25'))} Sunday`, ok: wdMin(t => t.endsWith('23:55')) === 3 && cnt('sat', t => t.endsWith('23:55')) === 4 && cnt('sun', t => t.endsWith('23:25')) === 3, note: '' },
  { rule: 'Five still on duty at 22:00', value: `${wdCnt(t => endMinutes(t) > 22*60)} weekday · ${cnt('sat', t => endMinutes(t) > 22*60)} Saturday`, ok: wdMin(t => endMinutes(t) > 22*60) === 5 && cnt('sat', t => endMinutes(t) > 22*60) === 5, note: 'a 22:00 finish is not "on at 22:00"' },
  { rule: 'Fourteen on a Saturday, ten on a Sunday', value: `${P.daily.sat} · ${P.daily.sun}`, ok: P.daily.sat === 14 && P.daily.sun === 10, note: '' },
  { rule: 'Four cover weeks, evenly spread', value: `lines ${P.feel.spareLines.join(', ')} — gaps ${P.adj.spareGaps.join(', ')}`, ok: P.adj.spareExcess === 0, note: 'whole weeks, never scattered days' },
  { rule: 'About 4.2 days a week worked, Mon–Sat', value: `${P.totals.daysAverage.toFixed(2)} over the 20 working lines`, ok: Math.abs(P.totals.daysAverage - 4.2) < 0.15, note: '' },
  { rule: 'No :05 or :10 times except the open and close', value: 'none', ok: P.tableRows.every(r => !/[:](05|10)$/.test(r.time.split('-')[0]) && !/[:](05|10)$/.test(r.time.split('-')[1])), note: "today's times already obey this" },
  (() => {
      // Per DAY CLASS, not pooled: pooling weekday and Saturday rows reads two short earlies (one per day) as a
      // failure of the ordering, which By the Book escaped only because its short early is the same turn both days.
      const hm = m => `${Math.floor(m/60)}h${String(m%60).padStart(2,'0')}`;
      const per = ['weekday', 'sat', 'sun'].map(cls => { const rows = P.tableRows.filter(r => r[cls] > 0);
        const E = rows.flatMap(r => Array(r[cls]).fill(r.minutes)).filter((_, i, a) => true).length ? rows.filter(r => startMinutes(r.time) < 11*60).flatMap(r => Array(r[cls]).fill(r.minutes)).sort((a,b)=>a-b) : [], L = rows.filter(r => startMinutes(r.time) >= 11*60).flatMap(r => Array(r[cls]).fill(r.minutes));
        const ok = E.length > 1 && L.length > 0 && E[0] < Math.min(...L) && E[1] > Math.max(...L);
        return { cls: { weekday: 'weekday', sat: 'Saturday', sun: 'Sunday' }[cls], ok, E, L }; });
      const ok = per.every(x => x.ok); const words = x => x.ok ? `${x.cls} met (lates ${hm(Math.min(...x.L))}–${hm(Math.max(...x.L))}, earlies ${hm(x.E[0])} then ${hm(x.E[1])}–${hm(x.E[x.E.length-1])})` : `${x.cls} not met (lates ${hm(Math.min(...x.L))}–${hm(Math.max(...x.L))}, earlies ${hm(x.E[0])}–${hm(x.E[x.E.length-1])})`;
      const allL = per.flatMap(x => x.L), longs = per.flatMap(x => x.E.slice(1)), shorts = per.map(x => x.E[0]);
      return { rule: 'Late turns slightly shorter than most earlies', value: ok ? `met on every day — lates ${hm(Math.min(...allL))}–${hm(Math.max(...allL))}; one short early a day (${hm(Math.min(...shorts))}–${hm(Math.max(...shorts))}), every other early ${hm(Math.min(...longs))}–${hm(Math.max(...longs))}` : per.map(words).join(' · '), ok,
        note: ok ? 'one short open turn, then every other early longer than every late' : 'incompatible with keeping today’s times: meeting it needs 9h+ earlies or 15 duties a day — flagged for decision, below' }; })(),
];

if (PROPOSAL === 'EF' || PROPOSAL === 'B2') { const longest = Math.max(...P.tableRows.map(r => r.minutes)); const hm = m => `${Math.floor(m/60)}h${String(m%60).padStart(2,'0')}`;
  rules.push({ rule: 'No duty over 8h40', value: `longest ${hm(longest)}`, ok: longest <= 520, note: `every day class — By the Book's longest is 9h30, today's 9h10` }); }
const sundayOut = demand.movementsOutside(demand.movements.sun, 7*60+15, 23*60+25);
// QT: which turns were stretched to keep the contract, READ from the finished table against Same Turns'
// (table B, best-B-7.json) — so the PDF cannot name a stretch the cells do not carry — and, for each new
// finish, whether it is a time somebody already works (Q's are Saturday's opening turns).
const stretch = (() => {
  if (PROPOSAL !== 'QT' && PROPOSAL !== 'Q2') return null;   // Q2 carries Q's weekday, so the same stretch
  const bFile = ['results/best-B-7.json', 'best-B-7.json'].find(existsSync); if (!bFile) return null;
  const B = assess(JSON.parse(readFileSync(bFile, 'utf8')).patterns, 24);
  const wk = A => A.tableRows.filter(r => r.weekday > 0);
  const gone = wk(B).filter(r => !wk(P).some(x => x.time === r.time)), came = wk(P).filter(r => !wk(B).some(x => x.time === r.time));
  const closer = { from: gone.find(r => r.time.endsWith('23:55'))?.time, to: came.find(r => r.time.endsWith('23:55'))?.time };
  // Pair the openers POSITIONALLY: both lists sorted by finish, then zipped. A nearest-finish heuristic
  // (v1 of this reader) dropped the second opener — 06:20-14:00 is nearer to 14:20 than 14:50 is, so
  // 14:50 found nobody and the PDF said 150 minutes a week where the arithmetic says 450.
  const byEnd = rows => rows.filter(r => !r.time.endsWith('23:55')).sort((a, b) => endMinutes(a.time) - endMinutes(b.time));
  const g2 = byEnd(gone), c2 = byEnd(came);
  const turns = c2.map((r, i) => {
    const from = g2[i]?.time;
    return { from, to: r.time, people: r.weekday, each: from ? endMinutes(r.time) - endMinutes(from) : null, onToday: todayTimes.has(r.time) };
  }).filter(t => t.from);
  return { closer, closerShift: closer.from && closer.to ? startMinutes(closer.to) - startMinutes(closer.from) : null, turns, weekly: turns.reduce((n, t) => n + t.people * t.each * 5, 0), allOnToday: turns.every(t => t.onToday) };
})();
// Which rule (or the fit) separated the winner from the runner-up — computed, so page 8 cannot claim a tie that was not one.
// EVERY family reads this (24 Sep 2026): Same Turns' and By the Book's sentences were typed literals in
// render.mjs, true on the day they were written and checked by nothing after it.
const pickNote = (() => {
  const [a, b] = cands; if (!b) return 'One candidate.';
  const oneTable = cands.every(c => c.variant === a.variant);
  const sameFit = new Set(cands.map(c => c.fit)).size === 1;
  const lead = cands.length > 2 && cands.every(c => c.facts.present === 0) ? `All ${cands.length} candidates clear every factor${oneTable ? ' and share one table' : ''}${sameFit ? ', so the fit is identical' : ''}; ` : '';
  const cap = w => lead ? w : w.charAt(0).toUpperCase() + w.slice(1);
  const rules = [['turnarounds', 'rest'], ['longest', 'the longest run'], ['present', 'fatigue factors present']];
  for (const [k, w] of rules) if (a.facts[k] !== b.facts[k]) return `${lead}${cap(w)} decided it (${a.facts[k]} against ${b.facts[k]} for the runner-up).`;
  if (a.facts.weekends !== b.facts.weekends) return `${lead}${cap('full weekends off')} decided it (${a.facts.weekends} against ${b.facts.weekends}), and the runner-up is named so it can be asked for.`;
  if (a.fit !== b.fit) return `The top two tied on every rule; the fit decided it (${a.fit} against ${b.fit}), and the runner-up is named so it can be asked for.`;
  return `The top two tied on every rule and on fit; the search's own score decided it (${a.cost.toFixed(0)} against ${b.cost.toFixed(0)}).`;
})();
// What the coherence term cost against the factors, READ from the rules-only row (EXTRA) beside the winner.
const rulesOnlyNote = (() => {
  const ro = alternatives.filter(x => /rules only/.test(x.name)); if (!ro.length) return '';
  const winRow = alternatives.find(x => x.chosen); const d = winRow.present - Math.min(...ro.map(x => x.present));
  return ` The rules-only row shows what the coherence term cost against the factors: ${d <= 0 ? 'nothing' : `${d} more present`}.`;
})();
// Same Turns' two-table comparison and By the Book 2's Eight Forty comparison, READ rather than typed
// (24 Sep 2026): the sheet said 57.7 / 58.5 / 69.5 — heads-per-hour figures from before the one fit on
// minutes — and would have gone on saying so. Today's figure is the alternatives table's own row (tp24).
const otherTableFit = cands.filter(c => c.variant !== win.variant).map(c => c.fit).sort((a, b) => a - b)[0] ?? null;
const efRecord = PROPOSAL === 'B2' && existsSync('eight-forty-table.json') ? JSON.parse(readFileSync('eight-forty-table.json', 'utf8')) : null;
const meta = {
  otherTableFit, efFit: efRecord?.fit ?? null,
  date: PROPOSAL === 'Q2' ? '24 September 2026' : PROPOSAL === 'B2' ? '22 September 2026' : PROPOSAL === 'QT' || PROPOSAL === 'EF' ? '12 September 2026' : '8 September 2026',
  tables: PROPOSAL === 'QT' || PROPOSAL === 'Q2' ? 42 : 81, steps: ['QT', 'EF', 'B2', 'Q2'].includes(PROPOSAL) ? '100,000' : '60,000', restarts: ['QT', 'EF', 'B2', 'Q2'].includes(PROPOSAL) ? 'five' : 'four',
  runs: PROPOSAL === 'QT' ? 'four seeded runs per table, two tables' : ['BB', 'EF', 'B2', 'Q2'].includes(PROPOSAL) ? 'four seeded runs' : 'three seeded runs per table',
  efTable,
  stretch, pickSentence: pickNote + rulesOnlyNote + (cands.length > shown.length ? ` The other ${cands.length - shown.length} seeded results are in <span class="tt">results/</span> (${cands.filter(c => !shown.includes(c)).map(c => `${c.variant}${c.seed}`).join(', ')}); none stands higher on the pick than the rows shown.` : ''),
  candidateFiles: cands.map(c => c.file), winnerVariant: win.variant,
  sundayNote: `Sunday: ${sundayOut.after?.length ?? 5} December 2026 timetable movements fall after the 23:25 finish (the last at 23:54, three of them arrivals) — the standing question on whether Sunday's window moves; the window is stored per design, so the proposal can be rebuilt to either answer.`,
  designRules: rules, alternatives, identity,
  tightDuty: PROPOSAL === 'Q2' || undefined,   // the union of today's rows and a searched weekend is a taller table
  openQuestions: PROPOSAL === 'Q2' ? (() => {
    // Every figure READ: the longest duty from the finished table, the fits from assess() on this grid,
    // Quarter To's and today's, the Sunday total from the table record, the new times against today's table.
    const hm = m => `${Math.floor(m/60)}h${String(m%60).padStart(2,'0')}`; const T2 = efTable;
    const qFile = ['results/best-Q-34.json', 'best-Q-34.json'].find(existsSync); const QA = qFile ? assess(JSON.parse(readFileSync(qFile, 'utf8')).patterns, 24) : null;
    const longest = Math.max(...P.tableRows.map(r => r.minutes));
    const fresh = cls => P.tableRows.filter(r => r[cls] > 0 && !todayTimes.has(r.time)).map(r => r.time);
    const fs = fresh('sat'), fu = fresh('sun');
    return `<b>The cap reaches the weekend.</b> Every duty on this sheet is ${hm(longest)} or under. <i>Quarter To</i> carried Saturday's 14:45–23:55 (9h10) and Sunday's 14:30–23:25 (8h55) over from today unchanged and said so on its page 6; here both days were searched again. Saturday still pays 7,100 minutes and keeps its headcounts; Sunday pays ${T2.totals.sun.toLocaleString('en-GB')} minutes against <i>Quarter To</i>'s 5,145. <b>What it cost in familiarity.</b> ${fs.length ? `Saturday works ${fs.length} turn${fs.length === 1 ? '' : 's'} nobody works today (${fs.join(', ')})` : 'Every Saturday turn is one people work today'}; ${fu.length ? `Sunday ${fu.length} (${fu.join(', ')})` : 'every Sunday turn is one people work today'}. <b>What it bought in shape.</b> Saturday's fit is ${P.fits.sat} against <i>Quarter To</i>'s ${QA?.fits.sat ?? '—'} and today's ${T.fits.sat}; Sunday's ${P.fits.sun} against ${QA?.fits.sun ?? '—'} and ${T.fits.sun} (lower is more even). <b>The openers' finish.</b> Moving the closer to 15:45 takes ${stretch?.closerShift ?? 30} minutes off three duties a day, and the contract is exact, so the two 06:20 openers run on — ${stretch ? stretch.turns.map(t => `${t.from.slice(0,5)} to ${t.to.split('-')[1]}`).join(' and ') : 'see page 4'}${stretch?.allOnToday ? ', which are Saturday’s own opening times' : ''}; as <i>Quarter To</i>. <b>A Saturday finish at 22:00.</b> The search let an evening turn finish only when the ticket office closes — 22:30 on a Saturday (owner, 22 Sep 2026) — which rules out today's own 14:30–22:00 Saturday turns. Admit that finish and ${T2.counts?.sat?.ifTodayEnds ? `a Saturday of fit ${T2.counts.sat.ifTodayEnds.fit}, still entirely in today's times, exists (${T2.counts.sat.ifTodayEnds.duties.join(', ')})` : 'a better Saturday may exist'}; whether 22:00 is a Saturday handover point is the room's to say. <b>Late-turn length</b> is inherited from <i>Same Turns</i> and still not met. <b>Sunday's finish</b> — five December 2026 timetable movements fall after 23:25; the proposal inherits today's window deliberately rather than deciding it.`; })() : PROPOSAL === 'B2' ? (() => {
    const hm = m => `${Math.floor(m/60)}h${String(m%60).padStart(2,'0')}`; const T2 = efTable;
    const shared = P.tableRows.filter(r => todayTimes.has(r.time)).map(r => r.time);
    return `<b>The ticket office is written in, and it changed what the rules could give.</b> Two <span class="tt">14:00-22:30</span> turns Monday to Saturday and two <span class="tt">13:30-22:00</span> on a Sunday were fixed before anything else was searched (owner, 22 Sep 2026). They sit outside the early-versus-late ordering rule, which an 8h30 late would otherwise make unsatisfiable under an 8h40 ceiling. <b>Two pins are read differently for them, and only for them:</b> "five still on at 22:00" is a floor (four Saturday closers plus the pair make six by arithmetic, and the rule exists so the evening is not thin), and a pinned turn finishing AT 22:00 counts as on at 22:00, while design duties keep the strict reading, so <i>Eight Forty</i>'s Saturday assesses as before. <b>Fit before count</b> (owner): ${T2.fit.weekday} weekday, ${T2.fit.sat} Saturday, ${T2.fit.sun} Sunday against <i>Eight Forty</i>'s ${efRecord?.fit.weekday ?? '—'}, ${efRecord?.fit.sat ?? '—'} and ${efRecord?.fit.sun ?? '—'}. Saturday is the best table in the folder; Sunday is the price — the pair sits across its quietest afternoon, and Sunday pays ${T2.sunTotal.toLocaleString('en-GB')} minutes against 4,820. <b>Familiarity.</b> ${shared.length ? `${shared.length} of ${P.tableRows.length} turns ${shared.length === 1 ? 'is a time' : 'are times'} people work today (${shared.join(', ')})` : `none of the ${P.tableRows.length} turns is a time people work today`}. <b>Sunday's finish</b> — five December 2026 timetable movements fall after 23:25; the window is inherited, not decided.`; })() : PROPOSAL === 'EF' ? (() => {
    const hm = m => `${Math.floor(m/60)}h${String(m%60).padStart(2,'0')}`;
    const wk = P.tableRows.filter(r => r.weekday > 0); const E = wk.filter(r => startMinutes(r.time) < 11*60).map(r => r.minutes).sort((a,b)=>a-b), L = wk.filter(r => startMinutes(r.time) >= 11*60).map(r => r.minutes);
    const gap = E.filter(x => x > Math.max(...L)).sort((a,b)=>a-b)[0] - Math.max(...L);
    const shared = P.tableRows.filter(r => todayTimes.has(r.time)).map(r => r.time);
    return `<b>The size of the lever.</b> Met, and the cap has squeezed it: 14 duties paying 7,000 minutes average 8h20, so with nothing over 8h40 the long earlies sit at ${hm(E[1])}–${hm(E[E.length-1])} and the lates at ${hm(Math.min(...L))}–${hm(Math.max(...L))} — the shortest long early is ${gap} minutes longer than the longest late, against <i>By the Book</i>'s 15. Whether that still buys anything against unpopular lates is the room's question. And on a Saturday the earlies can average at most 24 minutes longer than the lates (<i>By the Book</i> asks 30; four closers with distinct starts leave one split that pays 7,000): this table has ${efTable.meanGap.sat}, the weekday ${efTable.meanGap.weekday}, Sunday ${efTable.meanGap.sun}. <b>The clock.</b> ${efTable.offQuarter.length} times sit off the quarter hour against <i>By the Book</i>'s three — the price of four distinct opener finishes when the cap leaves the long earlies twenty minutes of room. <b>Sunday's minutes</b> are not fixed by the contract; the search took the largest Sunday total at which every pin holds — ${efTable.sunTotal.toLocaleString('en-GB')}, a mean of ${(() => { const m = Math.round(efTable.sunTotal / 10); return `${Math.floor(m/60)}h${String(m%60).padStart(2,'0')}`; })()} against <i>By the Book</i>'s 4,965. <b>Familiarity.</b> ${shared.length ? `${shared.length} of the ${P.tableRows.length} turns ${shared.length === 1 ? 'is a time' : 'are times'} people work today (${shared.join(', ')})` : `none of the ${P.tableRows.length} turns is a time people work today`} — the same trade as <i>By the Book</i>. <b>Sunday's finish</b> — five December 2026 timetable movements fall after 23:25; the proposal inherits today's window deliberately rather than deciding it.`; })() : PROPOSAL === 'QT' ? `<b>The weekend's two long turns.</b> The rule was no duty over 8h40, and every weekday duty here is 8h30 or under — but Saturday's 14:45–23:55 (9h10) and Sunday's 14:30–23:25 (8h55) are today's own turns, carried over from <i>Same Turns</i> unchanged. Shortening Saturday's closer to 8h40 leaves 7,004 minutes a weekday, which no table of today's turns reaches, so the cap is read here as governing what the proposal introduces; if it is meant to reach the weekend too, Saturday's table has to be redesigned, and that is a different proposal. <b>The openers' finish.</b> Moving the closer to 15:45 takes ${stretch?.closerShift ?? 30} minutes off three duties a day, and the contract is exact, so the two 06:20 openers run on — ${stretch ? stretch.turns.map(t => `${t.from.slice(0,5)} to ${t.to.split('-')[1]}`).join(' and ') : 'see page 4'}${stretch?.allOnToday ? ', which are Saturday’s own opening times' : ''}; the other ways of doing it are on page 8. <b>Late-turn length</b> is inherited from <i>Same Turns</i> and still not met. <b>Sunday's finish</b> — five December 2026 timetable movements fall after 23:25; the proposal inherits today's window deliberately rather than deciding it.` : PROPOSAL === 'BB' ? `<b>Familiarity.</b> Every rule is met, and the price is that none of the 19 turns is one people work today — the earlies run to 9h30 and the closers start at 15:45–16:40 rather than 15:15. That is the trade between this family and <i>Same Turns</i>, and it is a people question rather than a rules one. <b>Sunday's finish</b> — five December 2026 timetable movements fall after 23:25; the proposal inherits today's window deliberately rather than deciding it.` : `<b>Late-turn length.</b> The one December 2026 preference this proposal does not meet is the owner's own — lates slightly shorter than most earlies. Today's link has it the other way round (a 15:15–23:55 late is 8h40, a 06:20–14:20 early 8h00) and the brief was to keep today's times; meeting both is arithmetically impossible at 14 duties a day, because the day's minutes are fixed by the contract. The choice is between today's clock times and shorter lates paid for by longer earlies (the workspace default does this, with 9h25 earlies). <b>Sunday's finish</b> — five December 2026 timetable movements fall after 23:25; the proposal inherits today's window deliberately rather than deciding it.`,
};
writeFileSync('proposal.json', JSON.stringify({ name: `${identity.name} — Dec 2026 (${identity.code} · ${identity.fingerprint})`, patterns: P.patterns }, null, 1));
console.log('identity', JSON.stringify(identity));
writeFileSync('proposal-import.txt', Array.from({ length: 24 }, (_, i) => `${i+1}\t${DAYS.map(d => P.patterns[String(i+1)][d] === 'SPARE' ? 'SP' : P.patterns[String(i+1)][d]).join('\t')}`).join('\n'));
meta.kind = PROPOSAL;
await renderPdf({ today: T, prop: P, meta, demand }, process.env.OUT ?? `${process.cwd()}/${identity.name.replace(/ /g,'-')}-${identity.code}-${identity.fingerprint}.pdf`);
console.log('rendered. proposal facts:', JSON.stringify({ hours: P.hours.exSunday, run: P.checks.longestStretch, turnarounds: P.checks.turnarounds.length, weekends: P.checks.weekendsOff, present: P.fatigue.present, feel: P.feel }));
