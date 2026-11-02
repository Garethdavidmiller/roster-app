// THE DECEMBER LINK PAGE'S FIGURES (2 Nov 2026, owner: "Do 0 and 1" — the app page that presents the shortlist to the
// colleagues who will work it). Writes the app's `newlink-data.js` from the same figures the one-page sheet prints
// (what-it-means-data.mjs), so the page staff read in the app and the sheet they are handed cannot disagree.
//
//   node docs/links-26/tooling/newlink-data.mjs           → writes newlink-data.js at the repository root
//   node docs/links-26/tooling/newlink-data.mjs --check   → exit 1 if newlink-data.js is not what this would write
//
// `--check` is what `newlink-data.test.mjs` runs, so a rota, a figure or a sentence that changes here without the app's copy
// being rewritten fails the build rather than reaching staff. Run it after what-it-means-sheet.mjs, whenever the pack moves.
//
// WHAT IS NOT HERE, ON PURPOSE:
//   · the grids. The page draws the 26 weeks from links-proposals.js, the copy the Links workspace already builds in and
//     links-proposals.test.mjs already pins to the proposals' own files — a second copy would be a second thing to drift;
//   · the recommendation. The page shows the three evenly, A to Z (owner, 2 Nov 2026: "No, three evenly"), so nothing it
//     reads names one. RECOMMENDED is read below only to refuse a shortlist the sentences were not written for;
//   · anything about a person. The page has no member data, no pay estimate of anyone's own, and no votes.
//
// EVERY SENTENCE IS ASSERTED, as on the sheets: a design that stops fitting one stops this script. The "What's changed
// since you saw Short Run" lines are DRAFTS for the owner to correct ("Draft them; I'll correct") — each one's figure is
// asserted like the rest, and the one piece of history in them (a figure that moved on 31 Oct) is the README's, not computed.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { GROUPS, TC, C, ES, IS, SR, FIG, RATE, claim, tidyText, isBest, hm, H, first, timed, m, mins, isEarly, MS, SHORTLIST, RECOMMENDED } from './what-it-means-data.mjs';
import { FIRST } from './fresh.mjs';
import { PROPOSALS } from '../../../links-proposals.js';

const OUT = new URL('../../../newlink-data.js', import.meta.url).pathname;
const DIR = new URL('../', import.meta.url).pathname;   // docs/links-26/
const t = s => tidyText(s);
const WORDS = { 1: 'One', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine' };   // a sentence never opens on a small figure

// THE WORDS ARE WRITTEN FOR THESE THREE, in this order — A to Z, which is also the Links workspace's order
if (SHORTLIST.join() !== 'Even Step,In Step,Short Run' || RECOMMENDED !== 'Even Step') throw new Error(`the page's sentences are written for Even Step, In Step and Short Run; the shortlist is ${SHORTLIST}`);
claim('the three in alphabetical order', [...SHORTLIST].sort().join() === SHORTLIST.join());
claim('the built-in proposals are the shortlist, in the same order', PROPOSALS.map(p => p.name.replace(/ — Dec 2026$/, '')).join() === SHORTLIST.join());
const codeOf = name => PROPOSALS.find(p => p.name.startsWith(name + ' ')).code;
const refOf = name => PROPOSALS.find(p => p.name.startsWith(name + ' ')).ref;

// ── WHAT'S CHANGED SINCE YOU SAW SHORT RUN — drafts ───────────────────────────────────────────────────────────────────
const monSatDuties = p => Object.values(p).flatMap(r => MS.map(d => r[d])).filter(timed);
claim('Even Step and In Step drawn up after Short Run', [codeOf('Even Step'), codeOf('In Step')].every(c => new Date(FIRST[c]) > new Date(FIRST[codeOf('Short Run')])));
const keeps1345 = p => MS.slice(0, 5).every(d => Object.values(p).some(r => timed(r[d]) && r[d].endsWith('-13:45')));
claim('Even Step and In Step keep a 13:45 every weekday; Short Run has no 13:35 or 13:45', keeps1345(ES.p) && keeps1345(IS.p)
  && monSatDuties(SR.p).every(s => !/-13:(35|45)$/.test(s)) && +SR.f.shortYear === 0);
const longEarlies = p => monSatDuties(p).filter(s => isEarly(s) && mins(s) > 510);
claim('Even Step: nothing over 8h 30m Monday to Saturday', monSatDuties(ES.p).every(s => mins(s) <= 510));
claim('In Step and Short Run: some earlies of 8h 45m to 9 hours', [IS, SR].every(c => longEarlies(c.p).length > 0 && longEarlies(c.p).every(s => mins(s) >= 525 && mins(s) <= 540)));
claim('Short Run is the rota of 3 Oct 2026, fingerprint 618348d6', refOf('Short Run').endsWith('618348d6') && FIRST[codeOf('Short Run')] === '3 Oct 2026');
claim('on all three, the most days in a row is 5, and 7 with a cover week placed badly', C.every(c => c.f.run === '5 (up to 7)'));
const CHANGES = [
  'Two more proposals sit beside Short Run now: Even Step and In Step. Both were drawn up after Short Run was first shown, from what colleagues said about it.',
  'Both keep a 13:45 finish every weekday. Short Run has no 13:35 or 13:45 finish.',
  'Even Step has nothing over 8h 30m, Monday to Saturday. In Step and Short Run have some earlies of 8h 45m to 9 hours.',
  'Short Run is the same rota you were shown.',
  // HISTORY, NOT COMPUTED: before 31 Oct a cover week's Sunday counted inside its four duties (README, the folder's opening)
  'One figure has moved since, on all three: when a cover week falls badly, the most days in a row is 7, not 6. A cover week’s four shifts are Monday to Saturday, and its Sunday is overtime on top.',
].map(t);

// ── WHAT ALL THREE GIVE EVERYONE, AND WHAT THEY COST ──────────────────────────────────────────────────────────────────
const shared = (what, get) => { const v = C.map(c => get(c)); claim(`${what}, the same on all three`, v.every(x => x === v[0])); return v[0]; };
const newTimes = c => (x => +x[1] - +x[2])(/^(\d+) \((\d+) you know\)$/.exec(c.f.times));
const weekends = shared('full weekends off a year', c => +c.f.weekendsYear), run = shared('most days in a row', c => first(c.f.run)), ff = shared('avoidable fatigue warnings', c => first(c.f.ff));
const restLo = Math.min(...C.map(c => H(c.f.rest))), hours = shared('contracted hours', c => c.f.hours);
claim('better than today on all three', weekends > +TC.f.weekendsYear && run < first(TC.f.run) && restLo > H(TC.f.rest) && ff === 0 && first(TC.f.ff) > 0 && hours === TC.f.hours);
const cuts = C.flatMap(c => ['closerWk', 'closerSat', 'closerSun'].map(k => H(TC.f[k]) - H(c.f[k])));
claim('every closing shift 30 minutes to an hour shorter', Math.min(...cuts) === 30 && Math.max(...cuts) === 60);
const GAINS = [
  `The same ${hours.replace('h', '-hour')} week, so the same basic pay.`,
  `${weekends} full weekends off a year (today ${TC.f.weekendsYear}).`,
  `At most ${run} days in a row, cover weeks aside (today ${first(TC.f.run)}).`,
  `Every closing shift 30 minutes to an hour shorter.`,
  `At least ${hm(restLo)} between shifts (today ${hm(H(TC.f.rest))}).`,
  `No avoidable fatigue warnings on the set shifts (today ${first(TC.f.ff)}).`,
].map(t);
const leaveFour = shared('leave for four weeks off', c => +c.f.leaveFour), late23 = shared('finishes at 23:00 or later', c => +c.f.late23);
const block = shared('weeks of one kind in a row', c => +c.f.block), sat = shared('Saturdays a year', c => +c.f.sat);
const nt = C.map(newTimes);
claim('worse than today on all three', leaveFour > +TC.f.leaveFour && late23 > +TC.f.late23 && block > +TC.f.block && sat > +TC.f.sat
  && C.every(c => +c.f.shortYear < +TC.f.shortYear) && nt.every(n => n > 0));
const COSTS = [
  `Four full weeks off, Sunday to Saturday, take ${leaveFour} days’ leave (today ${TC.f.leaveFour}).`,
  `${late23} finishes a year at 23:00 or later (today ${TC.f.late23}).`,
  `Up to ${block} weeks of earlies, or of lates, in a row, cover weeks aside (today ${TC.f.block}).`,
  `${WORDS[sat - +TC.f.sat]} more Saturdays a year (${sat}, today ${TC.f.sat}).`,
  `Fewer earlies that finish before 14:00 (today ${TC.f.shortYear} a year).`,
  `${WORDS[Math.min(...nt)]}${Math.max(...nt) > Math.min(...nt) ? ` or ${WORDS[Math.max(...nt)].toLowerCase()}` : ''} new shift times to learn.`,
].map(t);

// ── WHAT IT MEANS IF YOU… — the sheet's six bands, as the page's choices ──────────────────────────────────────────────
// Each band keeps the sheet's own words; `chip` is the short label on its button. The sheet's seventh band, "Whoever you are",
// is the GAINS above, in sentences.
// `icon` is the app's own emoji for the thing where it has one: ☀️ and 🌙 are the Calendar's Early and Late badges, 🏠 its
// rest day, 🏖️ its annual leave.
const CHIPS = [['earlies', '☀️', 'Prefer earlies', '…prefer earlies'], ['lates', '🌙', 'Prefer lates', '…prefer lates'],
  ['swap', '🤝', 'Swap for overtime', '…swap earlies for lates, for the overtime'], ['sundays', '📆', 'Work Sundays', '…work your share of Sundays and no other overtime'],
  ['no-overtime', '🏠', 'No overtime', '…work no overtime at all'], ['leave', '🏖️', 'Save leave', '…save your leave for long breaks']];
claim('the sheet has the six bands the page offers, then "Whoever you are"', GROUPS.length === 7 && CHIPS.every(([, , , who], i) => GROUPS[i].who === who) && GROUPS[6].who === 'Whoever you are');
const PERSONAS = CHIPS.map(([id, icon, chip], i) => { const g = GROUPS[i];
  return { id, icon, chip, who: g.who, gist: t(g.gist), rows: g.rows.map(r => ({ label: t(r.label), cells: r.cells.map((c, j) => ({ text: t(String(c.text)), best: isBest(r, j) })) })) }; });
const COLUMNS = ['Today', ...SHORTLIST];

// ── HOW THE FIGURES ARE WORKED OUT ────────────────────────────────────────────────────────────────────────────────────
const NOTES = [
  'Every figure is worked out from the rotas by the app’s own tooling. None is typed in.',
  'One person, over a year, cover weeks aside. Earlies and lates are counted Monday to Saturday, as Sunday is overtime. An early starts before 11:00, a late at 11:00 or after.',
  `Pounds are gross, before tax, at the CEA rate of £${RATE.toFixed(2)} an hour. The Sunday figure is rounded to £50, the others to £10. The Pay Calculator estimates a payslip.`,
  'A swap is counted on the same day. The swap figures assume a partner for every swap, and the extra time paid at time and a quarter (“Overtime 1.25” on a payslip): the most those particular swaps could make, not a forecast.',
  'Bold green marks the clear best of the three for that person. The swap rows are not marked: which link suits a swapper depends on which swaps they make.',
  '“Up to” is the worst place a cover week’s shifts could fall. Fatigue warnings follow the Office of Rail and Road’s good-practice list, and are never a pass or a fail.',
].map(t);
claim('the swap rows are left unranked, as the notes say', GROUPS[2].rows.every(r => !r.better));

// ── THE FULL PACK — what a colleague is handed, nothing more ──────────────────────────────────────────────────────────
// Not the shortlist sheet (it carries the recommendation), not the managers' decks, not the one-page sheet (its subtitle names
// the recommendation, and this page is its content). Page counts are read from the files, so a rebuilt pack that adds a page
// fails --check until this is run again.
const pages = rel => (readFileSync(DIR + rel).toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
const sheetOf = name => { const f = readdirSync(DIR + 'proposals').filter(x => x.startsWith(`${name.replace(/ /g, '-')}-${codeOf(name)}-`) && x.endsWith('.pdf'));
  claim(`one proposal sheet for ${name}`, f.length === 1 && f[0].includes(refOf(name).split(' · ')[1])); return 'proposals/' + f[0]; };
const PACK = [
  ...SHORTLIST.flatMap(name => [
    { design: name, label: 'The presentation', path: `presentations/${name.replace(/ /g, '-')}-for-colleagues.pdf` },
    { design: name, label: 'The proposal sheet — every week on page 3', path: sheetOf(name) },
  ]),
  { design: null, label: 'The rules every proposal is judged against', path: 'links-26-rules.pdf' },
].map(f => ({ ...f, pages: pages(f.path) }));
claim('every file in the pack has pages', PACK.every(f => f.pages > 0));

// ── WRITE ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// one line for anything short (a cell, a pack file), one item a line above that — so a changed figure is a one-line diff
const flat = v => JSON.stringify(v).replace(/":/g, '": ').replace(/,"/g, ', "').replace(/^\{/, '{ ').replace(/\}$/, ' }');
const lit = (v, pad = '') => {
  if (v === null || typeof v !== 'object' || flat(v).length + pad.length <= 112) return flat(v).replace(/ /g, '\\u00a0');
  const inner = pad + '    ';
  const items = Array.isArray(v) ? v.map(x => inner + lit(x, inner)) : Object.entries(v).map(([k, x]) => `${inner}${JSON.stringify(k)}: ${lit(x, inner)}`);
  return `${Array.isArray(v) ? '[' : '{'}\n${items.join(',\n')}\n${pad}${Array.isArray(v) ? ']' : '}'}`;
};
const src = `// @ts-check
/**
 * newlink-data.js — GENERATED by docs/links-26/tooling/newlink-data.mjs. Do not edit by hand.
 *
 * The figures and sentences the December link page (newlink.html) presents: the three shortlisted proposals against today's
 * link, for six ways of working the roster, and what all three give and cost everyone. The same figures as the pack's
 * one-page sheet, from the same module (what-it-means-data.mjs), and every sentence asserted against them when this was
 * written. newlink-data.test.mjs fails when this file is not what the generator would write now.
 *
 * The 26 weeks themselves are not here: the page draws them from links-proposals.js. Nor is a recommendation: the page shows
 * the three evenly, A to Z.
 *
 * PUBLIC, like every file in this repository: it holds the proposals' published figures and nothing about any person.
 */

/** @typedef {{ text: string, best: boolean }} Cell  one figure; \`best\`: the clear best of the three for that person */
/** @typedef {{ label: string, cells: Cell[] }} Row  cells in COLUMNS order */
/** @typedef {{ id: string, icon: string, chip: string, who: string, gist: string, rows: Row[] }} Persona */
/** @typedef {{ design: string|null, label: string, path: string, pages: number }} PackFile  path is under docs/links-26/ */

/** @template T @param {T} o @returns {T} */
function deepFreeze(o) {
    for (const v of Object.values(/** @type {object} */ (o))) if (v && typeof v === 'object') deepFreeze(v);
    return Object.freeze(o);
}

/** The figure columns, in order: today's link, then the three proposals A to Z. */
export const COLUMNS = deepFreeze(${lit(COLUMNS)});

/** What has changed since colleagues were first shown Short Run — drafts, for the owner to correct. */
export const CHANGES = deepFreeze(${lit(CHANGES)});

/** What all three proposals give everyone, against today. */
export const GAINS = deepFreeze(${lit(GAINS)});

/** What all three proposals cost everyone, against today. */
export const COSTS = deepFreeze(${lit(COSTS)});

/** @type {ReadonlyArray<Persona>} What each proposal means for six ways of working the roster — the sheet's bands. */
export const PERSONAS = deepFreeze(${lit(PERSONAS)});

/** How the figures are worked out. */
export const NOTES = deepFreeze(${lit(NOTES)});

/** @type {ReadonlyArray<PackFile>} The pack's colleague files. */
export const PACK = deepFreeze(${lit(PACK)});
`;

if (process.argv.includes('--check')) {
  let now = ''; try { now = readFileSync(OUT, 'utf8'); } catch { /* absent: out of date */ }
  if (now !== src) { console.error('newlink-data.js is out of date — run: node docs/links-26/tooling/newlink-data.mjs'); process.exit(1); }
  console.log('newlink-data.js is current');
} else {
  writeFileSync(OUT, src);
  console.log(`wrote newlink-data.js — ${CHANGES.length} changes, ${GAINS.length} gains, ${COSTS.length} costs, ${PERSONAS.length} ways of working (${PERSONAS.reduce((n, p) => n + p.rows.length, 0)} rows), ${PACK.length} pack files`);
}
