// THE NEW LINK PAGE'S FIGURES (2 Nov 2026, owner: "Do 0 and 1" — the app page that presents the shortlist to the
// colleagues who will work it; "the December link page" until v25.10). Writes the app's `newlink-data.js` from the same
// figures the one-page sheet prints (what-it-means-data.mjs), so the page staff read in the app and the sheet they are
// handed cannot disagree.
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
//   · a recommendation. The page shows the three evenly, A to Z (owner, 2 Nov 2026: "No, three evenly"), and since 5 Nov
//     2026 the pack names none either (owner: "Remove the marks"), so there is nothing to read;
//   · anything about a person. The page has no member data, no pay estimate of anyone's own, and no votes.
//
// EVERY SENTENCE IS ASSERTED, as on the sheets: a design that stops fitting one stops this script. The "What's changed
// since you saw Short Run" lines are DRAFTS for the owner to correct ("Draft them; I'll correct") — each one's figure is
// asserted like the rest, and the one piece of history in them (a figure that moved on 31 Oct) is the README's, not computed.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { GROUPS, TC, C, CG, ES, SR, FIG, RATE, claim, tidyText, isBest, hm, H, first, timed, m, mins, isEarly, MS, SHORTLIST } from './what-it-means-data.mjs';
import { FIRST } from './fresh.mjs';
import { PROPOSALS } from '../../../links-proposals.js';
import { DAYS } from '../../../links-design.js';

// fileURLToPath, never `.pathname`: a checkout whose path holds a space reads as %20 and every file goes missing
const OUT = fileURLToPath(new URL('../../../newlink-data.js', import.meta.url));
const DIR = fileURLToPath(new URL('../', import.meta.url));   // docs/links-26/
const t = s => tidyText(s);
const WORDS = { 1: 'One', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine' };   // a sentence never opens on a small figure
/** One figure across the three: "12", or "0 to 12" where they differ. @param {number[]} v */
const span = v => { const lo = Math.min(...v), hi = Math.max(...v); return lo === hi ? `${lo}` : `${lo} to ${hi}`; };

// THE WORDS ARE WRITTEN FOR THESE THREE, in this order — A to Z, which is the Links workspace's order and, since 5 Nov 2026
// (owner: Common Ground and Short Run beside Even Step, In Step off the shortlist, and no recommendation), fresh.mjs's too
const NAMES = C.map(c => c.name);
if (NAMES.join() !== 'Common Ground,Even Step,Short Run' || SHORTLIST.join() !== NAMES.join()) throw new Error(`the page's sentences are written for Common Ground, Even Step and Short Run, A to Z; the shortlist is ${SHORTLIST}`);
claim('the three in alphabetical order', [...NAMES].sort().join() === NAMES.join());
// the page sorts the three A to Z itself (newlink-render.js aToZ), whatever order the built-in list keeps
claim('the built-in proposals are the shortlist, which the page shows A to Z as COLUMNS lists them', PROPOSALS.map(p => p.name.replace(/ — Dec 2026$/, '')).sort().join() === NAMES.join());
const codeOf = name => PROPOSALS.find(p => p.name.startsWith(name + ' ')).code;
const refOf = name => PROPOSALS.find(p => p.name.startsWith(name + ' ')).ref;

// ── WHAT'S CHANGED SINCE SHORT RUN WAS SHOWN — drafts ─────────────────────────────────────────────────────────────────
// Written for a reader who may not have been there: "since Short Run was shown", never "since you saw it" (the review,
// 2 Nov 2026). The 26 on the new link are not the room it was shown to.
const monSatDuties = p => Object.values(p).flatMap(r => MS.map(d => r[d])).filter(timed);
// "after Short Run was first shown" is the owner's history (2 Nov 2026); what the folder can check is that both were MADE after it
claim('Common Ground and Even Step created after Short Run (fresh.mjs FIRST)', [codeOf('Common Ground'), codeOf('Even Step')].every(c => new Date(FIRST[c]) > new Date(FIRST[codeOf('Short Run')])));
const keeps1345 = p => MS.slice(0, 5).every(d => Object.values(p).some(r => timed(r[d]) && r[d].endsWith('-13:45')));
claim('Common Ground and Even Step keep a 13:45 every weekday; Short Run has no 13:35 or 13:45', keeps1345(CG.p) && keeps1345(ES.p)
  && monSatDuties(SR.p).every(s => !/-13:(35|45)$/.test(s)) && +SR.f.shortYear === 0);
const over = p => [...new Set(monSatDuties(p).filter(s => mins(s) > 510))];
claim('Even Step: nothing over 8h 30m Monday to Saturday', over(ES.p).length === 0);
// COMMON GROUND HAS NO LONG DUTY SINCE 6 NOV 2026: its one, a 9-hour Saturday late (13:30–22:30), finishes at 22:00 now that the
// Saturday ticket-office lates finish at 22:30 (README → "The Saturday ticket office to 22:30"), and it has no 9-hour Sunday early.
// Short Run's are its 9-hour earlies (and an 8h 40m Saturday closer)
claim('Common Ground: nothing over 8h 30m on any day', over(CG.p).length === 0 && Object.values(CG.p).every(r => !timed(r.sun) || mins(r.sun) <= 510));
claim('Short Run: some 9-hour earlies', over(SR.p).some(s => isEarly(s) && mins(s) === 540) && over(SR.p).filter(isEarly).every(s => mins(s) === 540));
claim('Common Ground keeps today’s leave: four weeks off for 14 days, and 30 days off for 14 at best; the other two need 15 and buy 28', +CG.f.leaveFour === +TC.f.leaveFour
  && +CG.f.leaveBest === +TC.f.leaveBest && [ES, SR].every(c => +c.f.leaveFour === +TC.f.leaveFour + 1 && +c.f.leaveBest === +TC.f.leaveBest - 2));
// THE PRICE OF THE LEAVE, SAID BESIDE IT (whole-pack review, 5 Nov 2026): the line read as a gain with nothing paid for it
claim('Common Ground: about 12 single rest days a year, where Even Step and Short Run have about 8', CG.singles === 12 && ES.singles === 8 && SR.singles === 8);
// HOW OFTEN THE LONG DUTIES COME ROUND, a year each, counted as the shortlist sheet counts them: Monday to Saturday (a Sunday
// is overtime), duty by duty across the rota, times 52 over its length
const longYear = c => Math.round(monSatDuties(c.p).filter(s => mins(s) > 510).length * 52 / Object.keys(c.p).length);
claim('over 8h 30m Monday to Saturday, a year each: Short Run about 26, Common Ground and Even Step none', longYear(SR) === 26 && longYear(CG) === 0 && longYear(ES) === 0);
// EACH KIND COUNTED (6 Nov 2026, the 72-hour review): "about 26 a year each" read as 26 of the earlies AND 26 of the closers,
// where the grid gives 26 in all, so the line names both counts and this holds them
const longOf = (c, early) => Math.round(monSatDuties(c.p).filter(s => mins(s) > 510 && isEarly(s) === early).length * 52 / Object.keys(c.p).length);
claim('Short Run’s long duties a year each: about 20 of the 9-hour earlies and 6 of the 8h 40m closers', longOf(SR, true) === 20 && longOf(SR, false) === 6);
claim('Short Run’s long duties: 9-hour earlies on weekdays only, and an 8h 40m closer on Saturdays only',
  over(SR.p).every(s => (isEarly(s) && mins(s) === 540) || (s.endsWith('-23:55') && mins(s) === 520))
  && Object.values(SR.p).every(r => !(timed(r.sat) && isEarly(r.sat) && mins(r.sat) > 510) && MS.slice(0, 5).every(d => !(timed(r[d]) && r[d].endsWith('-23:55') && mins(r[d]) > 510)))
  && Object.values(SR.p).some(r => timed(r.sat) && r.sat.endsWith('-23:55') && mins(r.sat) === 520));
// THE GRID ITSELF, NOT ITS LABEL (the review, 2 Nov 2026): a ref string can outlive an edited grid, so the fingerprint is
// recomputed from the cells as report-data.mjs computes every sheet's. 618348d6 was Short Run's from 3 Oct 2026; 9b0bf83a for a
// few hours on 6 Nov 2026, when its Saturday ticket-office lates moved to 22:30 and its Saturday floor pair to 22:00; 247f3636 since
// later that day (the owner's "Yes"), when that floor pair went back to one 14:00–22:30 and one 13:30–21:00, today's Saturday time.
// Against 3 Oct's grid (git c87c465c) that is THREE cells, all on a Saturday: the two office lates, 14:30–22:00 to 14:30–22:30, and
// one floor late, 14:00–22:30 to 13:30–21:00 — the changes to its shifts since it was shown, which CHANGES says
const fpOf = p => createHash('sha256').update(JSON.stringify(Object.keys(p).sort((a, b) => a - b).map(k => DAYS.map(d => p[k][d])))).digest('hex').slice(0, 8);
claim('Short Run is the rota of 3 Oct 2026 with its Saturday office lates to 22:30 and one Saturday late to 13:30–21:00, fingerprint 247f3636, recomputed from its cells', fpOf(SR.p) === '247f3636' && refOf('Short Run').endsWith(fpOf(SR.p)) && FIRST[codeOf('Short Run')] === '3 Oct 2026');
// THE 22:30 OFFICE ON ALL THREE (6 Nov 2026): two Saturday ticket-office lates, 14:30–22:30, where today's finish at 22:00, and
// since the owner's "Yes" the same day one Saturday floor late, 14:00–22:30, finishing with them — three at 22:30 on each
const satAt = (p, t) => Object.values(p).filter(r => r.sat === t).length;
claim('on all three, two Saturday office lates to 22:30 and one floor late with them; today’s office lates to 22:00', C.every(c => satAt(c.p, '14:30-22:30') === 2
  && satAt(c.p, '14:00-22:30') === 1 && Object.values(c.p).filter(r => timed(r.sat) && r.sat.endsWith('-22:30')).length === 3) && satAt(TC.p, '14:30-22:00') === 2 && satAt(TC.p, '14:30-22:30') === 0);
// SHORT RUN'S OTHER SATURDAY LATE IS TODAY'S 13:30–21:00, worked on a Saturday on today's link, which CHANGES says
claim('Short Run: one Saturday 13:30–21:00, a time worked on a Saturday today', satAt(SR.p, '13:30-21:00') === 1 && satAt(TC.p, '13:30-21:00') > 0);
claim('Short Run: the shortest lates of the three on average', C.every(c => c === SR || H(SR.f.avgLate) < H(c.f.avgLate)));
claim('on all three, the most days in a row is 5, and 7 with a cover week placed badly', C.every(c => c.f.run === '5 (up to 7)'));
// SINCE 5 NOV 2026 the two beside Short Run are Common Ground and Even Step. "From what colleagues said about it" was the owner's
// history for In Step and Even Step; Common Ground was drawn on the owner's own brief (README → "Common Ground"), so the line
// now says only what the folder can check, that both were drawn up after Short Run was shown
const CHANGES = [
  'Two more proposals sit beside Short Run now: Common Ground and Even Step. Both were drawn up after Short Run was first shown.',
  // OF THE ROTA, not of a person: someone on it finishes at 13:45 each weekday, where one person has 10 or 12 a year
  'Both keep a shift finishing at 13:45 on every weekday of the rota. Short Run has no shift finishing at 13:35 or 13:45.',
  'Common Ground keeps today’s leave: four full weeks off, Sunday to Saturday, for 14 days, and 30 days off for 14 at best. On Even Step and Short Run four weeks off take 15. The price on Common Ground is more single rest days: about 12 a year, where the other two have about 8.',
  'Common Ground has nothing over 8h 30m on any day, and Even Step nothing over 8h 30m from Monday to Saturday. Short Run has 9-hour weekday earlies and an 8h 40m Saturday closer: about 20 of the earlies and 6 of the closers a year each.',
  // THE 22:30 OFFICE (6 Nov 2026): the one change to Short Run's shifts since it was shown, made on all three
  'On all three, the two Saturday ticket-office lates finish at 22:30, to cash up after the office shuts at 22:10. To keep the hours the same, one Saturday late on Short Run is now 13:30–21:00, a time worked on Saturdays today. Those are the only changes to Short Run’s shifts since it was shown.',
  `Short Run still has the shortest lates of the three: ${hm(H(SR.f.avgLate))} on average, closers included.`,
  // HISTORY, NOT COMPUTED: before 31 Oct a cover week's Sunday counted inside its four duties (README, the folder's opening).
  // Short Run's figure moved; the other two were drawn up under the new reading
  'And when a cover week falls badly, the most days in a row is now 7, not 6 — the same as on the other two. A cover week’s four shifts are Monday to Saturday, and its Sunday is overtime on top.',
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
const late23 = shared('finishes at 23:00 or later', c => +c.f.late23);   // the leave left the shared costs on 5 Nov 2026: Common Ground keeps today's (CHANGES says so)
const block = shared('weeks of one kind in a row', c => +c.f.block), blockUpTo = shared('weeks of one kind with a cover week badly placed', c => +c.f.blockUpTo);
const sat = shared('Saturdays a year', c => +c.f.sat);
const nt = C.map(newTimes);
claim('worse than today on all three', late23 > +TC.f.late23 && block > +TC.f.block && sat > +TC.f.sat
  && C.every(c => +c.f.shortYear < +TC.f.shortYear) && nt.every(n => n > 0));
const COSTS = [
  `${late23} finishes a year at 23:00 or later (today ${TC.f.late23}).`,
  `At most ${block} weeks of earlies, or of lates, in a row, or ${blockUpTo} if a cover week falls badly (today ${TC.f.block}, or ${TC.f.blockUpTo}).`,
  `${WORDS[sat - +TC.f.sat]} more Saturdays a year (${sat}, today ${TC.f.sat}).`,
  // the three's own figures, not only today's (the review, 2 Nov 2026: a cost with no new figure says nothing)
  `Fewer earlies that finish before 14:00: ${span(C.map(c => +c.f.shortYear))} a year (today ${TC.f.shortYear}).`,
  `${(v => v.length === 1 ? WORDS[v[0]] : v.length === 2 ? `${WORDS[v[0]]} or ${WORDS[v[1]].toLowerCase()}` : `${WORDS[v[0]]} to ${WORDS[v[v.length - 1]].toLowerCase()}`)([...new Set(nt)].sort((a, b) => a - b))} new shift times to learn.`,
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
// THE SHEET'S WORDS, FOR THIS PAGE (the review, 2 Nov 2026). The sheet compares links; on the page "the link" is the one that
// changes on 1 January and the three are "the three", so "on every link" reads as something else. The page names nothing it
// does not show, so Long Break — never shortlisted — becomes "a design". And every swap figure is a year's, as the page's
// other labels say. The sheet keeps its own words. Each rewording must FIND its words: a sheet sentence that changes under
// one stops the generator, rather than reaching the page unadapted.
const REWORD = [
  [/ on every link\b/g, ' on all three'],
  [/^Each 13:35 or 13:45 early swapped for the day’s longest late$/g, 'Each 13:35 or 13:45 early swapped for the day’s longest late, a year'],
  [/^That overtime, gross, at time and a quarter$/g, 'That overtime a year, gross, at time and a quarter'],
];
const reworded = REWORD.map(() => 0);
const forPage = s => REWORD.reduce((txt, [re, to], k) => { reworded[k] += (txt.match(re) ?? []).length; return txt.replace(re, to); }, s);
const PERSONAS = CHIPS.map(([id, icon, chip], i) => { const g = GROUPS[i];
  return { id, icon, chip, who: g.who, gist: t(forPage(g.gist)), rows: g.rows.map(r => ({ label: t(forPage(r.label)), cells: r.cells.map((c, j) => ({ text: t(String(c.text)), best: isBest(r, j) })) })) }; });
claim('every rewording for the page found its words in the sheet', reworded.every(n => n > 0));
claim('the page says "all three", never "every link", and names no design it does not show',
  !/every link|Long\s+Break/.test(JSON.stringify(PERSONAS)) && PERSONAS[2].rows.every(r => !/^(Each|That)\b/.test(r.label) || / a year\b/.test(r.label.replace(/ /g, ' '))));
const COLUMNS = ['Today', ...NAMES];

// ── HOW THE FIGURES ARE WORKED OUT ────────────────────────────────────────────────────────────────────────────────────
const NOTES = [
  'Every figure is worked out from the rotas by the app’s own tooling. None is typed in.',
  'One person, over a year, cover weeks aside. Earlies and lates are counted Monday to Saturday, as Sunday is overtime. An early starts before 11:00, a late at 11:00 or after.',
  `Pounds are gross, before tax, at the CEA rate of £${RATE.toFixed(2)} an hour. The Sunday figure is rounded to £50, the others to £10. The Pay Calculator estimates a payslip.`,
  'A swap is counted on the same day. The swap figures assume a partner for every swap, and the extra time paid at time and a quarter (“Overtime 1.25” on a payslip): the most those particular swaps could make, not a forecast.',
  'Bold green marks the clear best of the three for that person. The swap rows are not marked: which link suits a swapper depends on which swaps they make. Nor are the no-overtime rows: the three are within a few Saturday hours a year.',
  '“Up to” is the worst place a cover week’s shifts could fall. Fatigue warnings follow the Office of Rail and Road’s good-practice list, and are never a pass or a fail.',
].map(t);
claim('the swap rows are left unranked, as the notes say', GROUPS[2].rows.every(r => !r.better));
claim('the no-overtime rows are left unranked, as the notes say', GROUPS.find(g => /no overtime at all/.test(g.who)).rows.every(r => !r.better));

// ── THE FULL PACK — what a colleague is handed, nothing more ──────────────────────────────────────────────────────────
// Not the shortlist sheet or the one-page sheet, whose comparison this page already is, and not the managers' decks. Page
// counts are read from the files, so a rebuilt pack that adds a page fails --check until this is run again.
const pages = rel => (readFileSync(DIR + rel).toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
// a 30-day link's sheet is in 30-days-off/ (Common Ground's, since it joined the shortlist on 5 Nov 2026), every other in proposals/
const sheetOf = name => { const f = ['proposals', '30-days-off'].flatMap(dir => readdirSync(DIR + dir).filter(x => x.startsWith(`${name.replace(/ /g, '-')}-${codeOf(name)}-`) && x.endsWith('.pdf')).map(x => `${dir}/${x}`));
  claim(`one proposal sheet for ${name}`, f.length === 1 && f[0].includes(refOf(name).split(' · ')[1])); return f[0]; };
const PACK = [
  ...NAMES.flatMap(name => [
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
 * The figures and sentences the New link page (newlink.html) presents: the three shortlisted proposals against today's
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
