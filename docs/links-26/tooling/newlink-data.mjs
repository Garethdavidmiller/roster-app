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
// since Short Run was shown" lines are DRAFTS for the owner to correct ("Draft them; I'll correct") — each one's figure is
// asserted like the rest. Redrafted on 8 Nov 2026 for the new shortlist; the history they carried until then (In Step's and
// Even Step's beginnings, Short Run's 31 Oct cover-week figure) went with the designs it was about.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GROUPS, TC, C, BV, LC, MG, FIG, RATE, claim, tidyText, isBest, hm, H, Hmax, first, timed, mins, MS, SHORTLIST, grid } from './what-it-means-data.mjs';
import { PROPOSALS } from '../../../links-proposals.js';
import { DAYS } from '../../../links-design.js';

// fileURLToPath, never `.pathname`: a checkout whose path holds a space reads as %20 and every file goes missing
const OUT = fileURLToPath(new URL('../../../newlink-data.js', import.meta.url));
const DIR = fileURLToPath(new URL('../', import.meta.url));   // docs/links-26/
const t = s => tidyText(s);
const WORDS = { 1: 'One', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine' };   // a sentence never opens on a small figure
/** One figure across the three: "12", or "0 to 12" where they differ. @param {number[]} v */
const span = v => { const lo = Math.min(...v), hi = Math.max(...v); return lo === hi ? `${lo}` : `${lo} to ${hi}`; };

// THE WORDS ARE WRITTEN FOR THESE THREE, in this order — A to Z, which is the Links workspace's order and fresh.mjs's too, with
// no recommendation (5 Nov 2026). Since 8 Nov 2026 they are Balanced V6, Level Crossing and Middle Ground (owner: "Put Level
// Crossing, Middle Ground and Balanced V6 as the shortlist for now", for a new design target: no two closing weeks side by side)
const NAMES = C.map(c => c.name);
if (NAMES.join() !== 'Balanced V6,Level Crossing,Middle Ground' || SHORTLIST.join() !== NAMES.join()) throw new Error(`the page's sentences are written for Balanced V6, Level Crossing and Middle Ground, A to Z; the shortlist is ${SHORTLIST}`);
claim('the three in alphabetical order', [...NAMES].sort().join() === NAMES.join());
// the page sorts the three A to Z itself (newlink-render.js aToZ), whatever order the built-in list keeps
claim('the built-in proposals are the shortlist, which the page shows A to Z as COLUMNS lists them', PROPOSALS.map(p => p.name.replace(/ — Dec 2026$/, '')).sort().join() === NAMES.join());
const codeOf = name => PROPOSALS.find(p => p.name.startsWith(name + ' ')).code;
const refOf = name => PROPOSALS.find(p => p.name.startsWith(name + ' ')).ref;

// ── WHAT'S CHANGED SINCE SHORT RUN WAS SHOWN — drafts ─────────────────────────────────────────────────────────────────
// Written for a reader who may not have been there: "since Short Run was shown", never "since you saw it" (the review,
// 2 Nov 2026). The 26 on the new link are not the room it was shown to. A NEW SHORTLIST SINCE 8 NOV 2026: none of the three on
// the page is Short Run, so the lines say what changed and why against the Short Run colleagues were shown — the closing weeks
// first, the reason the three were drawn — and name no other design the page does not show. Short Run's own figures are the
// pack's (deck-check.mjs's --print, which covers the designs with decks) and its grid the pack's file
const monSatDuties = p => Object.values(p).flatMap(r => MS.map(d => r[d])).filter(timed);
const SRp = grid('Short Run'), SRf = FIG['Short Run'];
claim('Short Run is off the shortlist, and the pack still has its figures', !SHORTLIST.includes('Short Run') && !!SRf);
// A CLOSING WEEK, as the shortlist sheet reads one: its most common Monday-to-Friday duty works to the 23:55 close. Side by side
// lapping the rotation; a cover week is neither, so the line says "cover weeks aside"
const mainDuty = row => { const c = {}; for (const d of MS.slice(0, 5)) if (timed(row[d])) c[row[d]] = (c[row[d]] ?? 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''; };
const closeRun = p => { const ks = Object.keys(p).sort((a, b) => a - b), n = ks.length, is = k => mainDuty(p[k]).endsWith('-23:55'); let most = 0;
  for (let i = 0; i < n; i++) { if (!is(ks[i]) || is(ks[(i + n - 1) % n])) continue; let r = 0; while (r < n && is(ks[(i + r) % n])) r++; most = Math.max(most, r); }
  return ks.every(is) ? n : most; };
claim('no two closing weeks side by side on any of the three, cover weeks aside; three together on Short Run', C.every(c => closeRun(c.p) === 1) && closeRun(SRp) === 3);
claim('all three keep today’s leave; on Short Run four weeks off take a day more, and 14 days buy two fewer at best', C.every(c => +c.f.leaveFour === +TC.f.leaveFour && +c.f.leaveBest === +TC.f.leaveBest)
  && +SRf.leaveFour === +TC.f.leaveFour + 1 && +SRf.leaveBest === +TC.f.leaveBest - 2);
const oneOf = f => +String(f.oneTurn).split(' of ')[0];
// THE RUNS WITH THEIR COVER WEEK (the bug check, 9 Nov 2026): "three weeks at most" alone was the figure cover weeks aside,
// beside a table cell reading "3 (up to 5)" — the line now says both, as the COSTS line below does
claim('Level Crossing and Middle Ground: 18 of 21 weeks on one shift time, as Short Run; Balanced V6 7, its runs of earlies or of lates three weeks at most, or five if a cover week falls badly',
  oneOf(LC.f) === 18 && oneOf(MG.f) === 18 && oneOf(SRf) === 18 && oneOf(BV.f) === 7 && +BV.f.block === 3 && +BV.f.blockUpTo === 5 && C.every(c => /^\d+ of 21$/.test(c.f.oneTurn)));
const keeps1345 = p => MS.slice(0, 5).every(d => Object.values(p).some(r => timed(r[d]) && r[d].endsWith('-13:45')));
claim('all three keep a 13:45 every weekday; Short Run has no 13:35 or 13:45', C.every(c => keeps1345(c.p)) && monSatDuties(SRp).every(s => !/-13:(35|45)$/.test(s)) && +SRf.shortYear === 0);
// THE 22:30 OFFICE ON ALL THREE (6 Nov 2026): two Saturday ticket-office lates, 14:30–22:30, where today's finish at 22:00
const satAt = (p, t) => Object.values(p).filter(r => r.sat === t).length;
claim('on all three, two Saturday office lates to 22:30; today’s to 22:00', C.every(c => satAt(c.p, '14:30-22:30') === 2) && satAt(TC.p, '14:30-22:00') === 2 && satAt(TC.p, '14:30-22:30') === 0);
const CHANGES = [
  'The shortlist is new: Balanced V6, Level Crossing and Middle Ground. Short Run is no longer on it.',
  'All three keep closing weeks apart: a week of closing shifts is never followed by another, cover weeks aside. On Short Run three closing weeks fall together.',
  'All three keep today’s leave: four full weeks off, Sunday to Saturday, for 14 days, and 30 days off for 14 at best. On Short Run four weeks off take 15, and 14 days buy 28 at best.',
  'Level Crossing and Middle Ground keep 18 of 21 weeks on one shift time, as Short Run does. Balanced V6 has 7, with more weeks mixing start times, and its runs of earlies or of lates are three weeks at most, or five if a cover week falls badly.',
  // OF THE ROTA, not of a person: someone on it finishes at 13:45 each weekday, where one person has 12 or 20 a year
  'All three keep a shift finishing at 13:45 on every weekday of the rota. Short Run has none.',
  'On all three, the two Saturday ticket-office lates finish at 22:30, to cash up after the office shuts at 22:10.',
].map(t);

// ── WHAT ALL THREE GIVE EVERYONE, AND WHAT THEY COST ──────────────────────────────────────────────────────────────────
const shared = (what, get) => { const v = C.map(c => get(c)); claim(`${what}, the same on all three`, v.every(x => x === v[0])); return v[0]; };
const newTimes = c => (x => +x[1] - +x[2])(/^(\d+) \((\d+) you know\)$/.exec(c.f.times));
// NOT ONE FIGURE OF WEEKENDS SINCE 8 NOV 2026: Balanced V6 has 12 a year, the other two 14, so the line gives the range
const weekends = C.map(c => +c.f.weekendsYear), run = shared('most days in a row', c => first(c.f.run)), ff = shared('avoidable fatigue warnings', c => first(c.f.ff));
const restLo = Math.min(...C.map(c => H(c.f.rest))), hours = shared('contracted hours', c => c.f.hours);
claim('better than today on all three', weekends.every(w => w > +TC.f.weekendsYear) && run < first(TC.f.run) && restLo > H(TC.f.rest) && ff === 0 && first(TC.f.ff) > 0 && hours === TC.f.hours);
// EVERY CLOSER SHORTER, BY ITS LONGEST (8 Nov 2026): Balanced V6's Saturday has two, and its 8h 55m is 15 minutes under today's 9h 10m
const cuts = C.flatMap(c => ['closerWk', 'closerSat', 'closerSun'].map(k => Hmax(TC.f[k]) - Hmax(c.f[k]))), cutLo = Math.min(...cuts);
claim('every closing shift 15 minutes to an hour shorter', cutLo === 15 && Math.max(...cuts) === 60);
// …BUT A BADLY PLACED COVER WEEK ON BALANCED V6 MAKES ONE DAY MORE IN A ROW THAN TODAY'S WORST (the bug check, 9 Nov 2026).
// The sheet's "Whoever you are" says so; the page said only "cover weeks aside", which is kindest to the one design it is true
// of. The rest line is the set shifts' too, so it says so as the days-in-a-row line does: nothing gives a cover week's rest
const worstRun = c => +(/up to (\d+)/.exec(c.f.run)?.[1] ?? first(c.f.run));
claim('if a cover week falls badly, Balanced V6 one day more in a row than today’s worst; the other two fewer than today’s',
  worstRun(BV) === worstRun(TC) + 1 && [LC, MG].every(c => worstRun(c) < worstRun(TC)));
const GAINS = [
  `The same ${hours.replace('h', '-hour')} week, so the same basic pay.`,
  `${span(weekends)} full weekends off a year (today ${TC.f.weekendsYear}).`,
  `At most ${run} days in a row, cover weeks aside (today ${first(TC.f.run)}). If a cover week falls badly, Balanced V6 can make ${worstRun(BV)} in a row, one more than today’s worst.`,
  `Every closing shift ${cutLo} minutes to an hour shorter.`,
  `At least ${hm(restLo)} between shifts, cover weeks aside (today ${hm(H(TC.f.rest))}).`,
  `No avoidable fatigue warnings on the set shifts (today ${first(TC.f.ff)}).`,
].map(t);
const late23 = shared('finishes at 23:00 or later', c => +c.f.late23);   // the leave is not a cost on any of the three since 8 Nov 2026 (CHANGES says so)
// NOT ONE FIGURE OF RUNS SINCE 8 NOV 2026: Balanced V6's are shorter (3, up to 5) than the other two's (5, up to 7), so ranges
const block = C.map(c => +c.f.block), blockUpTo = C.map(c => +c.f.blockUpTo);
const sat = shared('Saturdays a year', c => +c.f.sat);
const nt = C.map(newTimes);
claim('worse than today on all three', late23 > +TC.f.late23 && block.every(b => b > +TC.f.block) && blockUpTo.every(b => b > +TC.f.blockUpTo) && sat > +TC.f.sat
  && C.every(c => +c.f.shortYear < +TC.f.shortYear) && nt.every(n => n > 0));
const COSTS = [
  `${late23} finishes a year at 23:00 or later (today ${TC.f.late23}).`,
  `At most ${span(block)} weeks of earlies, or of lates, in a row, or ${span(blockUpTo)} if a cover week falls badly (today ${TC.f.block}, or ${TC.f.blockUpTo}).`,
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
  // "THE BEST", NOT "THE CLEAR BEST" (the bug check, 9 Nov 2026): isBest marks the best however small the lead — 8h 06m beside
  // 8h 07m is marked — so "clear" promised a margin the marks do not keep. The sheet's own key still says "clear"
  'Bold green marks the best of the three for that person. The swap rows are not marked: which link suits a swapper depends on which swaps they make. Nor are the no-overtime rows: the three are within one Saturday shift’s hours a year.',
  '“Up to” is the worst place a cover week’s shifts could fall. Fatigue warnings follow the Office of Rail and Road’s good-practice list, and are never a pass or a fail.',
].map(t);
claim('the swap rows are left unranked, as the notes say', GROUPS[2].rows.every(r => !r.better));
claim('the no-overtime rows are left unranked, as the notes say', GROUPS.find(g => /no overtime at all/.test(g.who)).rows.every(r => !r.better));

// ── THE FULL PACK — what a colleague is handed, nothing more ──────────────────────────────────────────────────────────
// Not the shortlist sheet or the What it means sheet, whose comparison this page already is, and not the managers' decks.
// THE SHORTLIST AT A GLANCE IS ON IT (owner, 9 Nov 2026: "add the comparison sheet to the new links section (as you have
// with the proposals and presentations)"): one page of all three beside today, first of the files for all three. Page
// counts are read from the files, so a rebuilt pack that adds a page fails --check until this is run again.
const pages = rel => (readFileSync(DIR + rel).toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
// a 30-day link's sheet is in 30-days-off/, a Balanced design's in its balanced/ subfolder (all three shortlisted since 8 Nov 2026),
// every other in proposals/
const sheetOf = name => { const f = ['proposals', '30-days-off', '30-days-off/balanced'].flatMap(dir => readdirSync(DIR + dir).filter(x => x.startsWith(`${name.replace(/ /g, '-')}-${codeOf(name)}-`) && x.endsWith('.pdf')).map(x => `${dir}/${x}`));
  claim(`one proposal sheet for ${name}`, f.length === 1 && f[0].includes(refOf(name).split(' · ')[1])); return f[0]; };
// THE PRESENTATION ONLY WHERE THERE IS ONE (8 Nov 2026): the three shortlisted that day had no decks that morning, so each
// offered its proposal sheet alone; their colleague decks were drawn later the same day and joined the list (owner: "The
// presentations once complete should be put in the new links page on the app"). The managers' decks stay off it, as above
const deckOf = name => `presentations/${name.replace(/ /g, '-')}-for-colleagues.pdf`;
const PACK = [
  ...NAMES.flatMap(name => [
    ...(existsSync(DIR + deckOf(name)) ? [{ design: name, label: 'The presentation', path: deckOf(name) }] : []),
    { design: name, label: 'The proposal sheet — every week on page 3', path: sheetOf(name) },
  ]),
  { design: null, label: 'The shortlist at a glance — all three beside today, on one page', path: 'links-26-shortlist-at-a-glance.pdf' },
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

/** @typedef {{ text: string, best: boolean }} Cell  one figure; \`best\`: the best of the three for that person, however small the lead */
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
