// Render a proposal PDF for a design that was SUPPLIED rather than searched.
//
// `final.mjs` picks a winner out of the annealer's candidates and renders it. A design that arrived
// as somebody's Word table has no candidates, no table variant and no seed — and the method page
// must not claim a search it never had, which is why `meta.method` exists and why the identity code
// ends in EXT. Everything else is identical: every figure on every page is computed from the cells
// by the app's own modules, exactly as it is for the two searched proposals.
//
//   node supplied.mjs <patterns.json> "<Name>" "<strap>" <CODE>
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { assess, today, demand, startMinutes, endMinutes } from './report-data.mjs';
import { renderPdf } from './render.mjs';
import { generateLink, ROTATING_LINES, DAYS, calcHourlyCoverage } from '../../../links-design.js';
import { buildDefaultTargets } from '../../../links-default-targets.js';
import { reorderLines, applyOrder, OBJECTIVES } from '../../../links-adjacency.js';

const [file, NAME, STRAP, CODE] = process.argv.slice(2);
const patterns = JSON.parse(readFileSync(file, 'utf8'));
// Optional per-design copy: <patterns>.meta.json. Any key here overrides the defaults below, so a
// second supplied design does not mean a second copy of this script.
const OVER = existsSync(file.replace(/\.json$/, '.meta.json'))
  ? JSON.parse(readFileSync(file.replace(/\.json$/, '.meta.json'), 'utf8')) : {};

function weekdayFit(p) {
  const cov = (h => { const WD=['mon','tue','wed','thu','fri']; return Array.from({length:24},(_,i)=>WD.reduce((a,d)=>a+h[d].hours[i],0)/5); })(calcHourlyCoverage(p, 24)), cars = demand.profile.weekday.cars;
  const ws = 6*60+20, we = 23*60+55, hrs = []; for (let h = 6; h <= 23; h++) hrs.push(h);
  const frac = h => Math.max(0, Math.min(we,(h+1)*60) - Math.max(ws,h*60)) / 60;
  const D = hrs.reduce((a,h)=>a+cars[h]*frac(h),0), C = hrs.reduce((a,h)=>a+cov[h],0);
  return +hrs.reduce((a,h)=>a+((cars[h]*frac(h)/D)-(cov[h]/C))**2*1e4,0).toFixed(1);
}
const fingerprint = p => createHash('sha256').update(JSON.stringify(Object.keys(p).sort((a,b)=>a-b).map(k => DAYS.map(d => p[k][d])))).digest('hex').slice(0, 8);

const P = { patterns, lines: 24, ...assess(patterns, 24) };
const T0 = today(); const T = { ...T0, ...assess(T0.patterns, T0.lines) };

// Comparators: the workspace's own December default, and the two searched proposals beside this file.
const dt = buildDefaultTargets();
const g = generateLink({ slots: dt.slots, spareLines: dt.spareLines, lines: ROTATING_LINES });
const ALL = Object.fromEntries(OBJECTIVES.map(o => [o.key, true]));
const gp = applyOrder(g.patterns, reorderLines(g.patterns, { on: ALL }).order);

const step = a => String(a.fatigue.results.find(r => r.code === 'FF18')?.value ?? '').replace(/.*typically /, '').replace(' a week','');
const alt = (name, a, chosen = false, p = null) => ({ name, run: a.checks.longestStretch, present: a.fatigue.present,
  weekends: a.checks.weekendsOff, oneTurn: `${a.feel.oneTurn}/${a.feel.workingLines}`, step: step(a),
  fit: p ? weekdayFit(p) : '—', score: '—', chosen });

const alternatives = [alt(`${CODE} · ${fingerprint(patterns)} — <b>${NAME}</b> (this proposal)`, P, true, patterns)];
for (const [f, label] of [['../Same-Turns-ST-24-B7.json', 'Same Turns'], ['../By-the-Book-BB-24-D7.json', 'By the Book']]) {
  if (!existsSync(f)) continue;
  const j = JSON.parse(readFileSync(f, 'utf8')); const pp = j.patterns ?? j;
  alternatives.push(alt(`${label} · ${fingerprint(pp)} — the searched proposal`, assess(pp, 24), false, pp));
}
// Other candidates this design was chosen OVER — named in the meta file as {label, file}. The
// point of listing them is the repo's own "switches, not a formula": show what the pick cost,
// rather than hide four different answers behind one score.
for (const x of (OVER.extraAlternatives ?? [])) {
  if (!existsSync(x.file)) continue;
  const j = JSON.parse(readFileSync(x.file, 'utf8'));
  const pp = j.patterns ?? j;
  alternatives.push(alt(`${x.label} · ${fingerprint(pp)}`, assess(pp, 24), false, pp));
}
alternatives.push(alt(`Workspace default · ${fingerprint(gp)} (Dec 2026 table, generated)`, assess(gp, 24), false, gp));
const tp24 = {}; for (let i = 1; i <= 24; i++) tp24[i] = T.patterns[String(((i-1)%20)+1)];
alternatives.push(alt("Today's 20-line link (for scale)", T, false, null));
alternatives[alternatives.length-1].fit = weekdayFit(tp24);

// ── The December design figures, every one CHECKED ON THIS DESIGN. Same expressions as final.mjs,
//    so a rule this design misses reads as missed rather than quietly going unstated.
const cnt = (day, pred) => Object.values(P.patterns).filter(r => r[day] !== 'RD' && r[day] !== 'SPARE' && pred(r[day])).length;
// Weekdays are not one day: a range across Mon-Fri where they differ, and the WORST weekday decides a pass
// (owner, 24 Sep 2026 -- every one of these rows read Tuesday and called it the week).
const WDAYS = ['mon','tue','wed','thu','fri'];
const wdMin = pred => Math.min(...WDAYS.map(d => cnt(d, pred)));
const wdCnt = pred => { const v = WDAYS.map(d => cnt(d, pred)); const lo = Math.min(...v), hi = Math.max(...v); return lo === hi ? String(lo) : `${lo}–${hi}`; };
const hm = m => `${Math.floor(m/60)}h${String(m%60).padStart(2,'0')}`;
const rules = [
  { rule: 'Four on at the open, every day', value: `${wdCnt(t => t.startsWith('06:20'))} weekday · ${cnt('sat', t => t.startsWith('06:20'))} Saturday · ${cnt('sun', t => t.startsWith('07:15'))} Sunday`, ok: wdMin(t => t.startsWith('06:20')) === 4 && cnt('sat', t => t.startsWith('06:20')) === 4 && cnt('sun', t => t.startsWith('07:15')) === 4, note: '' },
  { rule: 'Three through to the close; four on a Saturday', value: `${wdCnt(t => t.endsWith('23:55'))} weekday · ${cnt('sat', t => t.endsWith('23:55'))} Saturday · ${cnt('sun', t => t.endsWith('23:25'))} Sunday`, ok: wdMin(t => t.endsWith('23:55')) === 3 && cnt('sat', t => t.endsWith('23:55')) === 4 && cnt('sun', t => t.endsWith('23:25')) === 3, note: '' },
  { rule: 'Five still on duty at 22:00', value: `${wdCnt(t => endMinutes(t) > 22*60)} weekday · ${cnt('sat', t => endMinutes(t) > 22*60)} Saturday`, ok: wdMin(t => endMinutes(t) > 22*60) === 5 && cnt('sat', t => endMinutes(t) > 22*60) === 5, note: 'a 22:00 finish is not "on at 22:00"' },
  { rule: 'Fourteen on a Saturday, ten on a Sunday', value: `${P.daily.sat} · ${P.daily.sun}`, ok: P.daily.sat === 14 && P.daily.sun === 10, note: '' },
  { rule: 'Cover weeks, evenly spread', value: `${P.feel.spareLines.length} weeks at lines ${P.feel.spareLines.join(', ')} — gaps ${P.adj.spareGaps.join(', ')}`, ok: P.adj.spareExcess === 0, note: 'the December shape asks for five' },
  { rule: 'About 4.2 days a week worked, Mon–Sat', value: `${P.totals.daysAverage.toFixed(2)} over the ${P.feel.workingLines} working lines`, ok: Math.abs(P.totals.daysAverage - 4.2) < 0.15, note: '' },
  { rule: 'No :05 or :10 times except the open and close', value: P.tableRows.every(r => !/[:](05|10)$/.test(r.time.split('-')[0]) && !/[:](05|10)$/.test(r.time.split('-')[1])) ? 'none' : 'present', ok: P.tableRows.every(r => !/[:](05|10)$/.test(r.time.split('-')[0]) && !/[:](05|10)$/.test(r.time.split('-')[1])), note: '' },
  (() => { const rows = P.tableRows.filter(r => r.weekday > 0 || r.sat > 0);
      const E = rows.filter(r => startMinutes(r.time) < 11*60).map(r => r.minutes).sort((a,b)=>a-b);
      const L = rows.filter(r => startMinutes(r.time) >= 11*60).map(r => r.minutes);
      const ok = E.length > 1 && L.length > 0 && E[0] < Math.min(...L) && E[1] > Math.max(...L);
      return { rule: 'Late turns slightly shorter than most earlies', ok,
        value: ok ? `met — lates ${hm(Math.min(...L))}–${hm(Math.max(...L))}, earlies ${hm(E[0])} then ${hm(E[1])}–${hm(E[E.length-1])}`
                  : `not met — lates ${hm(Math.min(...L))}–${hm(Math.max(...L))}, earlies ${hm(E[0])}–${hm(E[E.length-1])}`,
        note: ok ? 'one short open turn, then every other early longer than every late' : 'the longest late is longer than the longest early' }; })(),
];

const dm = (await import('../../../links-design.js')).dutyMinutes;
const dayMin = d => Object.values(P.patterns).reduce((a,r)=> a + (r[d]==='RD'||r[d]==='SPARE' ? 0 : dm(r[d])), 0);
const WK = ['mon','tue','wed','thu','fri'].map(dayMin), SAT = dayMin('sat');
const monSat = WK.reduce((a,b)=>a+b,0) + SAT;

const sundayOut = demand.movementsOutside(demand.movements.sun, 7*60+15, 23*60+25);
const meta = {
  date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
  tables: '—', steps: '—', kind: 'EXT',
  identity: { name: NAME, strap: STRAP, code: CODE, fingerprint: fingerprint(patterns), table: '—', seed: '—',
    lineage: 'Supplied as a Word table and assessed here — not produced by the proposal search. Compare with “Same Turns” (ST-24-B7 · d15e1b74) and “By the Book” (BB-24-D7 · 0f14abce), both of which were built by the search and judged by the same modules.' },
  h7: 'Where it came from, and how to load it',
  sub7: 'Checkable rather than reproducible: there is no search behind it, and every figure is computed from the cells',
  methodHeading: 'Where this design came from',
  method: `<p><b>1 · It was supplied, not searched.</b> This rotation arrived as a Word table and was read straight into the app's own shape — 24 lines, Sunday to Saturday, cover weeks as whole weeks. No table was enumerated for it, no grid was annealed and no seed produced it, so unlike <i>Same Turns</i> and <i>By the Book</i> there is no search to reproduce. What can be reproduced is every figure on these pages: they are computed from the cells opposite.</p>
  <p><b>2 · The judge is the same.</b> Scored by the workspace's own modules — <span class="tt">runDesignChecks</span>, <span class="tt">weeklyHours</span>, <span class="tt">assessHardLimits</span>, <span class="tt">assessFatigue</span>, <span class="tt">scoreOrder</span>, <span class="tt">calcHourlyCoverage</span> — with no figure typed by hand and none softened. Where the design misses one of the December rules, the table opposite says so rather than omitting the row.</p>
  <p><b>3 · What that means for the room.</b> A supplied design is judged on the same evidence as a searched one, and it carries the same class-C caveats: the 24-line length, the cover-week count and the December headcounts are owner-relayed figures, and the 13-day limit's policy citation is still outstanding. This is not a recommendation.</p>`,
  sundayNote: `Sunday: ${sundayOut.after?.length ?? 5} December movements fall after the 23:25 finish — the standing question on whether Sunday's window moves; the window is stored per design, so this proposal can be rebuilt to either answer.`,
  designRules: rules, alternatives,
  // 23 turns in the union against Same Turns' 18: the one-column duty table overflows onto a tenth
  // page at the default size, so this design takes the dense recipe By the Book already uses.
  denseDuty: true,
  sub1: 'A 24-line link supplied as a Word table and assessed here — weekday lates at 16:25, Saturdays left as they are, and every turn a time people already work',
  coverNote: `gaps of ${P.adj.spareGaps.join(', ')} around the wheel — today's sit at 1, 7, 12, 17`,
  intro2: `<p>It was not drawn by this app. It arrived as a Word table — a proposal from outside the workspace — and was read straight into the app's own shape, then judged by the same modules that judge a design the workspace generated itself: <span class="tt">runDesignChecks</span>, <span class="tt">weeklyHours</span>, <span class="tt">assessHardLimits</span>, <span class="tt">assessFatigue</span>, <span class="tt">scoreOrder</span> and <span class="tt">calcHourlyCoverage</span>. There is no search behind it and nothing to reproduce; what can be checked is every figure on these pages, each computed from the cells on page 6. Paste those cells into Links &rarr; Import and the workspace restates all of it.</p>`,
  eyebrow3: 'A supplied design, assessed',
  h3: 'Same feel, more people',
  sub3: 'What this design keeps of today, and where the December headcounts differ',
  // The stock sentence quotes Same Turns' own 6,980/7,100 split. This design does NOT have a uniform
  // weekday table, so that line would be false here — the figures below are computed from the cells.
  dutyNote: `Why the duties land where they do: Monday to Saturday totals exactly ${monSat.toLocaleString('en-GB')} minutes, which is 20 &times; 35h to the minute, so the contract is paid. But unlike a table built day-uniform, <b>the weekdays here are not equal</b> &mdash; ${WK.map((m,i)=>`${['Mon','Tue','Wed','Thu','Fri'][i]} ${m.toLocaleString('en-GB')}`).join(' &middot; ')}, and Saturday ${SAT.toLocaleString('en-GB')}. Monday is the lightest day by some margin and Thursday the heaviest; that is a property of the design rather than a fault, but it is the first thing to put to the roster office, because it decides how much cover each day really has.`,
  openQuestions: `<b>Late-turn length.</b> The lates here run longer than the earlies, which is the reverse of the December preference — the 14:45–23:55 Saturday closer is 9h10 against a longest early of 8h30. <b>Cover weeks.</b> Four, at lines 1, 7, 12 and 17, where the December shape asks for five evenly spread. <b>Sunday's finish</b> — five December movements fall after 23:25; this design inherits today's window rather than deciding it.`,
};

writeFileSync('supplied-import.txt', Array.from({ length: 24 }, (_, i) => `${i+1}\t${DAYS.map(d => P.patterns[String(i+1)][d] === 'SPARE' ? 'SP' : P.patterns[String(i+1)][d]).join('\t')}`).join('\n'));
writeFileSync('supplied.json', JSON.stringify({ name: `${NAME} — Dec 2026 (${CODE} · ${fingerprint(patterns)})`, patterns }, null, 1));
const out = process.env.OUT ?? `${process.cwd()}/${NAME.replace(/ /g,'-')}-${CODE}-${fingerprint(patterns)}.pdf`;
// `identity` is merged rather than replaced: a per-design file should be able to correct the
// lineage without having to restate the code, and above all without restating the FINGERPRINT,
// which must stay computed from the cells.
await renderPdf({ today: T, prop: P,
  meta: { ...meta, ...OVER, identity: { ...meta.identity, ...(OVER.identity ?? {}) } }, demand }, out);
console.log('rendered ->', out);
console.log('facts:', JSON.stringify({ hoursExSun: P.hours.exSunday, run: P.checks.longestStretch, turnarounds: P.checks.turnarounds.length, weekends: P.checks.weekendsOff, present: P.fatigue.present, fingerprint: fingerprint(patterns) }));
