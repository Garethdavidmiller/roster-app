// Re-render EVERY proposal in this folder, from the same inputs that produced it.
//
// WHY THIS EXISTS. A change to `render.mjs` or `report-data.mjs` changes every sheet, and until now
// the twelve build commands lived only in shell history and one README code block that covered four
// of them. Recovering the other eight meant reading the NAME and STRAP back out of the rendered
// HTML — which works, and is exactly the kind of thing that stops working the first time somebody
// deletes an HTML file. The arguments are data; they belong in a file.
//
// WHAT IT GUARANTEES. A proposal's identity is its cells, so a re-render must not move a
// fingerprint: the same grid in, the same eight hex characters out. This checks that and FAILS if
// one moves, because a moved fingerprint means the cells changed and a printout that has been in a
// room no longer matches its name. Pass --check to do that and nothing else.
//
// SEARCHED proposals (none in the folder since the 29 Sep 2026 withdrawals) are rebuilt from the committed candidates
// in `results/`, so they depend on those files and not on a re-run of the annealer, which would take hours and is not
// deterministic across Node versions in the way the candidates are.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DAYS } from '../../../links-design.js';
import { STRAPS } from './fresh.mjs';
import { PACK_DIRS, today, weekdayFloorFit } from './report-data.mjs';

const fingerprint = p => createHash('sha256')
    .update(JSON.stringify(Object.keys(p).sort((a, b) => a - b).map(k => DAYS.map(d => p[k][d]))))
    .digest('hex').slice(0, 8);

/** The supplied designs: a grid, a name, a strap line and a code. */
// 26 LINES (1 Oct 2026; nine by 3 Oct). Each 26-line design is one entry, in the shape the 24-line list used
// (docs/links-24/tooling/regenerate.mjs, removed 7 Nov 2026; `git checkout 924b9dbc -- docs/links-24` restores it): { file, name, code, fp, strap }, the code carrying -26- (e.g. AB-26-EXT).
// A design ships into proposals/ unless its entry says `dir:` — one of report-data.mjs's PACK_DIRS — after its fp
// (4 Nov 2026: the links where 14 days' leave buys 30 days off live in 30-days-off/, and are the pack all the same).
export const SUPPLIED = [
    // FOUR WITHDRAWN ON 3 NOV 2026 (owner: "Remove the four weak proposals please and reengineer the pack"): Second Nature
    // (SN-26-F2 · a52d0f20), Second Wind (SW-26-F1 · 4bec8d8e), Second Sight (SS-26-F1 · 3c6aac4d) and Second Gear
    // (SG-26-H1 · 8d61e5c3), the bottom four of the main league, each matched or beaten on all but one measure by a design
    // that stays (README.md → "Four designs withdrawn"). DELETED ON 6 NOV 2026 with five others (owner: "Permanently delete
    // well kept, quarter past, the four second designs, quiet friday, little and often and same again"): their grids, metas
    // and search starts are gone, and pack.py refuses their names (README.md → "Nine designs deleted"). Their duty tables stay,
    // because the designs that grew from them were drawn from them: table F (results/second-nature-*.json) Second Edition,
    // Short Run and Long Break, and table H1 (results/second-gear-table.json) Fine Tune and Even Keel. Those designs —
    // with Second Look — keep their comments below.
    // Second Look (2 Oct 2026): from the same restart as Second Sight, on a variation of Second Nature's duty table (table
    // G3: the Saturday 08:00-16:30 pair moved to 07:15-15:45), one of the only two rotas in it that met every floor (the
    // other, Second Gear, is withdrawn). README.md → "Second Look and Second Gear".
    { file: 'second-look.json',            name: 'Second Look',    code: 'SL-26-G3',   fp: 'a97f4052', strap: 'Weekends never more than five weeks apart, four single rest days, and one week mixing earlies and lates' },
    // Second Edition (2 Oct 2026): the owner asked for a roster stronger than any so far, at 219 days. Same duty table as
    // Second Nature; the weeks were built from a rest-day SKELETON (skeleton.mjs) that carries every rule a finished rota
    // must meet, then the times were searched. Weekends at most five apart, four single rest days, no mixed week, 18 of 21
    // weeks on one shift time, heaviest week 42h 00m, step 1h 01m — better than or equal to every design on every line.
    // README.md → "Second Edition".
    { file: 'second-edition.json',         name: 'Second Edition', code: 'SE-26-F1',   fp: '40715a41', strap: 'Weekends never more than five weeks apart, every week all earlies or all lates, and 18 of 21 weeks on one shift time' },
    // Fine Tune (3 Oct 2026): Second Gear with its weeks reordered by an outside reviewer (their candidate SGR-26-C1, with
    // its own search and recount in external/second-gear-refined/). The same duties every day, so the same table figures;
    // one mixed week instead of two and a smaller week-to-week step. Checked here by the app's own code before shipping.
    { file: 'fine-tune.json',              name: 'Fine Tune',      code: 'FT-26-H1',   fp: '702d7a15', strap: 'No Mon–Sat week over 42h, one week mixing earlies and lates, and a week-to-week change of 1h 10m' },
    // Even Keel (3 Oct 2026): a second reordering of Second Gear by the same outside reviewer (their SGR-26-C2, with its
    // recount in external/roster-search-results-2/). Same duties every day; 18 of 21 weeks on one shift time. Checked
    // here by the app's own code. Their other candidate, Five-Day Flow, was NOT shipped: README.md → "Even Keel".
    { file: 'even-keel.json',              name: 'Even Keel',      code: 'EK-26-H1',   fp: '250f90d5', strap: '18 of 21 weeks on one shift time, no Mon–Sat week over 42h, and never less than 14h 35m between fixed duties' },
    // Short Run (3 Oct 2026): the final targeted search's one find. Second Edition's duty table on a rest-day skeleton
    // the EXACT solver produced (exact-skeletons.py: no run over FIVE days, no mixed week, four single rest days — a
    // layout the annealing skeleton search never reached in 16 seeds), then the same soft → hard polish chain. Equal to
    // Second Edition on every line the sheets compare, with the longest run down from six days to five; the heaviest
    // week is 42h 30m against Second Edition's 42h 00m. README.md → "Short Run".
    { file: 'short-run.json',              name: 'Short Run',      code: 'SR-26-F1',   fp: '247f3636', strap: 'No run over five days outside the cover weeks, weekends never more than five weeks apart, and 18 of 21 weeks on one shift time' },
    // Long Break (3 Oct 2026): the 14-day-leave search. Second Edition's duty table on an exact-solver skeleton
    // (exact-skeletons.py with FOUR=14) in which four full weeks off cost 14 days' leave, as today, where every other
    // 26-line design needs 15; its best leave stretch is 29 days. The price: five single rest days (not four), 16 of 21
    // weeks on one shift time (not 18) and a week-to-week step of 1h 44m. README.md → "Long Break".
    { file: 'long-break.json',             name: 'Long Break',     code: 'LB-26-F1',   fp: 'a57bfbcf', strap: 'Four weeks off for 14 days’ leave, as today, with weekends never more than five weeks apart and no mixed week' },
    // Home Grown, Closing Time and Both Ways (26 Oct 2026): the owner's brief — today's 20-line link on 26 lines, five cover
    // weeks, a 16:00 closing shift, a 13:35 or 13:45 finish every weekday, every rule met and Short Run's fatigue factors
    // matched or improved. Today's week order carries four fatigue factors, so its shift TIMES were kept and the weeks
    // rebuilt: Home Grown on Short Run's skeleton, the other two on Home Grown's weeks (skeleton-from.mjs), so all three
    // have the same rest days and differ only in their shift times. Each is the best week for one way of paying for the short finishes
    // (short-earlies.mjs): Home Grown keeps Saturday's 14:45 closers, Closing Time adds 13:30-22:30, Both Ways adds that
    // and 07:00-16:00 to keep a 13:35 AND a 13:45 every weekday. Every fatigue factor's value is Short Run's or better
    // (factors-like.mjs). README.md → "Today's link on 26 lines".
    { file: 'home-grown.json',             name: 'Home Grown',     code: 'HG-26-T1',   fp: '021e6f03', strap: 'Today’s shift times but two new closers, 16:00 on a weekday and 15:15 on a Sunday, and the ticket office’s new Saturday late, with a 13:35 finish every weekday and Saturday closing as today' },
    { file: 'closing-time.json',           name: 'Closing Time',   code: 'CT-26-T2',   fp: 'd6c56b87', strap: 'A 16:00 closer every day from Monday to Saturday, a 13:45 finish every weekday, and never less than 14h 35m between fixed duties' },
    { file: 'both-ways.json',              name: 'Both Ways',      code: 'BW-26-T3',   fp: '2cb2d145', strap: 'A 16:00 closer every day from Monday to Saturday, and a 13:35 and a 13:45 finish every weekday, as today' },
    // In Step (30 Oct 2026): the owner asked whether Closing Time could be improved to fix the Saturday open or fit the trains
    // better on a weekday, and to give the answer a new name. Closing Time's rest days and early and late weeks, held while
    // exact-rota.py chose every time from a table with 15:45 closers, five at every opening Monday to Saturday and two new
    // early times that finish by 15:45, so its 14h 35m rest holds. README.md → "In Step".
    { file: 'in-step.json',                name: 'In Step',        code: 'IS-26-T4',   fp: '2bb1a9f4', strap: 'Five on at every opening from Monday to Saturday, a 13:45 finish every weekday, and never less than 14h 35m between fixed duties' },
    // Even Step (31 Oct 2026): the owner's one reservation about In Step was the length of its main early shift. The same
    // weeks (Closing Time's rest days and early and late weeks) with every duty Monday to Saturday 8h 30m or less, every
    // early one of today's times and every closer still 15:45; the lates take the half hour. README.md → "Even Step".
    { file: 'even-step.json',              name: 'Even Step',      code: 'ES-26-T5',   fp: 'fb7a3988', strap: 'No shift over 8h 30m and every early one of today’s times, Monday to Saturday, with a 13:45 finish every weekday' },
    // Clean Slate (3 Nov 2026): the owner's question — the link if today's shift times carried no weight in the league, every
    // other rule applying, with the weekday rules closers from 15:45, nothing over 9 hours, openers at most 8h 30m, and one
    // 13:45 a weekday. Searched afresh and laid on Home Grown's weeks: nothing over 8h 30m Monday to Saturday, 19 weeks on one
    // shift time. Next Step is Even Step with only Clean Slate's three weekday changes. README.md → "Clean Slate and Next Step".
    { file: 'clean-slate.json',            name: 'Clean Slate',    code: 'CS-26-N2',   fp: 'e4486f13', strap: 'Shift times chosen afresh for the trains, with nothing over 8h 30m Monday to Saturday, and a 13:45 finish and a closer from 15:45 every weekday' },
    { file: 'next-step.json',              name: 'Next Step',      code: 'NS-26-T6',   fp: '150a0d25', strap: 'No shift over 8h 30m Monday to Saturday, a 13:45 finish every weekday, and a weekday fit to the trains of 30.3 (today 52.0)' },
    // 4 Nov 2026: Fair Share is Next Step with its Sunday evened out, seven Sunday cells retimed (README.md → "Fair Share")
    { file: 'fair-share.json',             name: 'Fair Share',     code: 'FS-26-T7',   fp: 'cb5849c3', strap: 'Every Sunday duty 8h 10m or 8h 15m, so a Sunday early and late pay within a few pounds, and no shift over 8h 30m on any day' },
    // 4 Nov 2026 (owner: "Do a proposal sheet for all of today's work. Put them into the repo"): Quarter Past, a one-page roster
    // supplied as a PDF and read in cell by cell; its duties in new weeks so 14 days' leave buys 30 days off (drawn as Quarter
    // Past Relaid, QR-26-EXT); and Short Openers, that link with every weekday 06:20 finishing by 14:20 and every weekday
    // closer at 15:45 (README.md → "Quarter Past", "Quarter Past Relaid", "Short Openers"). Their grids and meta files live in
    // results/, under the names they were drawn with.
    // THREE NEW NAMES AND A FOLDER (owner, 4 Nov 2026: "Give all proposals individual names", then "Put all of the links that
    // give 30 days off for 14 days AL into a subfolder within links 26"). Quarter Past Relaid is Open Return, a name of its own
    // rather than its parent's; Fair Share's 30-day search result, which had none, is Grand Tour and joins the pack; and the
    // three links where 14 days' leave buys 30 days off ship into 30-days-off/ (README.md → "30 days off for 14 days' leave").
    // The fingerprints did not move: the cells are the same, only the names and the folder.
    // QUARTER PAST TAKEN OUT, 4 NOV 2026 (owner: "Remove quarter past from the pack please"): the one-page roster QP-26-EXT ·
    // dfdbd724, in the pack for a few hours, and DELETED on 6 Nov 2026 (above). Open Return and Short Openers keep its shift
    // times and say so in their lineage, so its duty table stays (results/quarter-past-table.json): Open Return was drawn from it.
    { file: 'results/quarter-past-re-laid.json', name: 'Open Return',          code: 'OR-26-EXT', fp: '190eba69', dir: '30-days-off', strap: 'A 16:15 closer every weekday, 14 days’ leave buys 30 days off, as today, and no fatigue warning, even if a cover week falls badly' },
    { file: 'results/short-openers.json',        name: 'Short Openers',        code: 'SO-26-EXT', fp: '65f99952', dir: '30-days-off', strap: 'Every weekday 06:20 finishing by 14:20, every weekday closer at 15:45, and 14 days’ leave buys 30 days off, as today' },
    // Grand Tour (4 Nov 2026): Fair Share's duties in new weeks, so that 14 days' leave buys 30 days off and four weeks off
    // take 14, as today — the answer to the owner's question that morning (README.md → "Fair Share", run e). It was a search
    // result with no name, sheet or import file until the 30-day folder was made
    // WELL KEPT TAKEN OUT, 5 NOV 2026 (owner: "Remove well kept"): Same Again Tidy, WK-26-S2 · 1db1381a, in the 30-day folder
    // from the evening of 4 Nov, and DELETED on 6 Nov 2026 with Same Again, its untidied first version (above).
    { file: 'results/fair-share-leave30.json',   name: 'Grand Tour',           code: 'GT-26-T7',  fp: 'd9b82d23', dir: '30-days-off', strap: 'No shift over 8h 30m on any day, and 14 days’ leave buys 30 days off and four weeks off take 14, as today' },
    // 4 Nov 2026: Common Ground is today's link taken to 26 weeks on the owner's brief, its weeks the 30-for-14 grid found on
    // Fair Share's duties (README.md → "Common Ground"). It buys 30 days off for 14 days' leave, so it ships into 30-days-off/
    // with the other four (owner, the same evening: "add any other 30 days off proposals to the subfolder")
    { file: 'common-ground.json',          name: 'Common Ground',  code: 'CG-26-T8',   fp: '03af96b2', dir: '30-days-off', strap: 'Seven of today’s shift times, a 13:45 finish every weekday, nothing over 8h 30m, and 14 days’ leave buys 30 days off, as today' },
    // 5 Nov 2026: Middle Ground is Common Ground's weeks with the shift times varied from week to week (README.md → "Middle
    // Ground"). Its rest days are Common Ground's, so it buys 30 days off for 14 days' leave too and ships into 30-days-off/
    { file: 'middle-ground.json',          name: 'Middle Ground',  code: 'MG-26-T8',   fp: '20668ac9', dir: '30-days-off', strap: 'Seven of today’s shift times, varied from week to week so that no two closing weeks and no two 06:20 weeks fall together, and 14 days’ leave buys 30 days off, as today' },
    // 6 Nov 2026 (owner: "Balanced v5 and Relief Point need adding to the pack, but can you rename Relief Point as Balanced v6"):
    // Balanced V5 is its author's one-page Marylebone Balanced 26, version 5, read cell by cell; Balanced V6 (drawn as Relief Point,
    // RP-26-V5) is the owner's 15-minute weekday handover drawn from it. Both buy 30 days off for 14 days' leave, and both finish
    // the Saturday office lates at 22:30 as drawn, so the 6 Nov correction changed neither (README.md → "Balanced V5 and Balanced
    // V6 join the pack")
    { file: 'results/balanced-v5.json',        name: 'Balanced V5',          code: 'MB-26-V5',  fp: 'ded4a15f', dir: '30-days-off', strap: 'Early weeks built from 06:20 and 08:00 starts, a 15:45 closer every weekday, and 14 days’ leave buys 30 days off, as today' },
    { file: 'results/balanced-v6.json',        name: 'Balanced V6',          code: 'MB-26-V6',  fp: '1818a1c2', dir: '30-days-off', strap: 'A 15-minute handover every weekday, from the three 07:30\u2060–\u206016:00s to the three 15:45 closers, and 14 days’ leave buys 30 days off, as today' },
    // 6 Nov 2026 (owner: Balanced V6 made again "without losing anything", then "Add v7 please"): Balanced V7 is Balanced V6's
    // duties, every one, laid again by exact-rota.py (MIXED) on Grand Tour's rest days, so it keeps V6's handover, closers, early
    // finishes and leave, with no six-day weeks and at most 7 days in a row however the cover weeks fall (README.md → "Balanced V7")
    { file: 'results/balanced-v7.json',        name: 'Balanced V7',          code: 'MB-26-V7',  fp: '75e9e7f3', dir: '30-days-off', strap: 'A 15-minute handover every weekday, from the three 07:30\u2060–\u206016:00s to the three 15:45 closers, no six-day weeks, and 14 days’ leave buys 30 days off, as today' },
    // 7 Nov 2026 (owner: "create a proposal that keeps the 1345 finishes and converts all the 1335 finishes to 1345 too … all
    // closers on a 1545 start on a weekday … 30 days off for 14 days AL … all the rules, fatigue rules, minimise numbers of shift
    // times and be competitive with the best proposals in the league table"; then "give hb a new name and put that into the
    // pack. Delete set fair as it would not work"; then "Needs a better name" and "Use railway names in future"): Crossover, drawn
    // as Safe Hands the same day, two 13:45s every weekday, and no weekday early finishing between 15:00 and 16:00, so two are
    // still on for the 15:45 closers' first 15 minutes. Set Fair, drawn first the same day, had three 07:15-15:45s leaving as the
    // closers came on, and was deleted. Laid on Short Openers' rest days with the 55-hour worst case held (README.md →
    // "Crossover"). It buys 30 days off for 14 days' leave, so it ships into 30-days-off/
    { file: 'crossover.json',              name: 'Crossover',            code: 'CO-26-T10', fp: '6596c0d9', dir: '30-days-off', strap: 'Two 13:45 finishes every weekday, a 15-minute handover from two 07:30\u2060–\u206016:00s to the three 15:45 closers, no fatigue warning even if a cover week falls badly, and 14 days’ leave buys 30 days off, as today' },
    // 7 Nov 2026 (owner, of Crossover: "Middle ground is a reworking of common ground to make it a gentle change between weeks.
    // As people don't want to do several weeks of closes. How possible is it to do the same to crossover?", then "Do it"):
    // Level Crossing is Crossover's duties and rest days, its weeks chosen again so that no two closing weeks fall side by side,
    // at 18 weeks of 21 on one shift time (README.md → "Level Crossing"). It buys 30 days off for 14 days' leave, so it ships
    // into 30-days-off/
    { file: 'level-crossing.json',         name: 'Level Crossing',       code: 'LC-26-T10', fp: '32241e32', dir: '30-days-off', strap: 'Two 13:45 finishes every weekday, a 15-minute handover to the three 15:45 closers, never two closing weeks in a row, no fatigue warning even if a cover week falls badly, and 14 days’ leave buys 30 days off, as today' },
];

/** The searched proposals: `final.mjs` picks from the committed candidates. */
// The By the Book family (BB-24-D7 · 0f14abce, EF-24-E21 · 0cf19f56, B2-24-G21 · 02f3c005) was WITHDRAWN on 29 Sep 2026
// (owner). Its candidates stay in results/ and final.mjs keeps its code; to rebuild one, restore its entry here and its
// strap, family and date in fresh.mjs from git history. Unlisted, a full run cannot ship them back into the folder.
// The Same Turns family (ST-24-B7 · d15e1b74, QT-24-Q34 · 70cf9874, Q2-24-W21 · 7ea671d5) was withdrawn the same way
// the same day: its entries were { ST: results/best-{A,B}-*.json }, { QT: results/best-{Q,R}-*.json }, { Q2: results/best-W-*.json }.
// The Pinned Turns family (PT-24-P34 · dae6292e, P2-24-N13 · 33a78cbe) was withdrawn the same way on 30 Sep 2026 (owner):
// its entries were { PT: results/best-RP-*.json, OTHER_MODE results/best-P-13.json } and { P2: results/best-RN-*.json,
// OTHER_MODE results/best-N-7.json }. Both grids are kept unchanged in test-fixtures/links-designs/ for the Links compare tests.
// Quiet Friday (QF-26-C1 · daf8f3c9), the 217-day what-if, was WITHDRAWN on 3 Oct 2026 (owner: "we can remove Quiet
// Friday from the proposals"), and DELETED on 6 Nov 2026 with its tables and start (SUPPLIED, above).
export const SEARCHED = [];   // the 26-line link ships every design as a grid (SUPPLIED): searched rotas are built first and then supplied

const expand = g => { const [dir, pat] = [g.slice(0, g.lastIndexOf('/')), g.slice(g.lastIndexOf('/') + 1)];
    const re = new RegExp('^' + pat.replace(/[.]/g, '\\.').replace(/\*/g, '.*') + '$');
    return readdirSync(dir).filter(f => re.test(f)).sort().map(f => `${dir}/${f}`); };

const checkOnly = process.argv.includes('--check');
const only = process.argv.find(a => a.startsWith('--only='))?.slice(7);
// SHIP: copy each render's three artefacts up into docs/links-26 under the names the folder uses
// (`<Name>-<CODE>-<fp>.pdf`, `<Name>-<CODE>.json`, `<Name>-<CODE>-import.txt`). This used to be a
// hand-typed cp per proposal after every regeneration, and a hand-typed cp is how a folder ends up
// with a PDF from one render and a JSON from another. --no-ship leaves the outputs in tooling/.
const ship = !process.argv.includes('--no-ship');
const shipFiles = (base, fp, json, imp, dir = 'proposals') => { if (!ship) return;
    if (!PACK_DIRS.includes(dir)) throw new Error(`${base}: ${dir} is not one of the pack's folders (report-data.mjs PACK_DIRS)`);
    copyFileSync(`${base}-${fp}.pdf`, `../${dir}/${base}-${fp}.pdf`); copyFileSync(json, `../${dir}/${base}.json`); copyFileSync(imp, `../${dir}/${base}-import.txt`); };
let failed = 0, done = 0;
// THE SHIPPED CELLS, FINGERPRINTED (25 Sep 2026). --check printed "ok" for every SEARCHED proposal after
// counting its candidate files and fingerprinting nothing, while this file's header and the README said it
// checked every fingerprint. The searched sheet's cells are the ones shipped beside its PDF
// (`<Name>-<CODE>.json`), so that is what is fingerprinted — for the supplied designs too, whose SOURCE grid
// is checked above it. Re-deriving a searched pick needs final.mjs, which renders; a full run does that.
// Since 4 Nov 2026 a design ships into its own folder (`dir:`), so the shipped PDF is looked for in every one of the pack's
// folders and must be in the one its entry names, once: a design left behind in proposals/ when it moved would otherwise
// print twice, under two folders, and pass.
const shippedFp = (fp, dir = 'proposals') => { const at = PACK_DIRS.flatMap(d => readdirSync(`../${d}`).filter(f => f.endsWith(`-${fp}.pdf`)).map(f => [d, f]));
    if (!at.length) return { error: `no ${PACK_DIRS.map(d => `../${d}`).join(' or ')}/*-${fp}.pdf` };
    if (at.length > 1 || at[0][0] !== dir) return { error: `its sheet is at ${at.map(([d, f]) => `${d}/${f}`).join(' and ')}, and it belongs in ${dir}/ only` };
    const pdf = at[0][1], base = pdf.slice(0, -`-${fp}.pdf`.length), json = `../${dir}/${base}.json`; if (!existsSync(json)) return { error: `no ${json}` };
    const j = JSON.parse(readFileSync(json, 'utf8')); return { base, got: fingerprint(j.patterns ?? j) }; };
const checkShipped = (label, fp, dir) => { const r = shippedFp(fp, dir);
    if (r.error) { console.log(`FAIL ${label}: ${r.error}`); failed++; return false; }
    if (r.got !== fp) { console.log(`FAIL ${label}: ../${r.base}.json fingerprints ${r.got}, expected ${fp}`); failed++; return false; }
    return true; };

for (const s of SUPPLIED) {
    if (only && !s.code.startsWith(only)) continue;
    if (!existsSync(s.file)) { console.log(`skip ${s.code} — ${s.file} is not on this branch`); continue; }
    const j = JSON.parse(readFileSync(s.file, 'utf8'));
    const got = fingerprint(j.patterns ?? j);
    if (got !== s.fp) { console.log(`FAIL ${s.code}: ${s.file} fingerprints ${got}, expected ${s.fp}`); failed++; continue; }
    // ONE STRAP (31 Oct 2026 review): the sheet prints fresh.mjs's STRAPS, so a strap here is only ever passed along. Six of them
    // had drifted from the printed ones ("no week over 41h 30m" against "no Mon–Sat week"); a reader of this list was misled
    if (STRAPS[s.code]?.[0] !== s.strap) { console.log(`FAIL ${s.code}: its strap here is not fresh.mjs's, which the sheet prints`); failed++; continue; }
    // A STRAP NEVER NAMES ANOTHER DESIGN (owner, 5 Nov 2026: "the proposal description headlines should not reference other
    // proposals"). The one-line description under a design's name has to say what the design IS to somebody who has not
    // read the one it came from — Next Step's once read "Even Step with three weekday shifts retimed…"
    const named = SUPPLIED.map(x => x.name).filter(n => n !== s.name && s.strap.includes(n));
    if (named.length) { console.log(`FAIL ${s.code}: its strap names ${named.join(' and ')}; say what this design is instead`); failed++; continue; }
    // A STRAP'S FIGURES ARE THE GRIDS' (6 Nov 2026, the 72-hour review): Next Step's quotes its weekday fit to the trains and
    // today's, and nothing recomputed either, so a change to the fit or to one of the two grids would have left the headline
    // stale. Both are read again here, as every sheet reads them (report-data.mjs weekdayFloorFit), on each grid's own lines
    // THE PACK REVIEW'S WORDING TOO (6 Nov 2026): the strap now says "of 30.3 (today 52.0)", and a pattern written for the
    // old wording would match nothing and check nothing — so a strap that names the fit but cannot be read is a failure
    const fitQuote = s.strap.match(/weekday fit to the trains of ([\d.]+)(?:, where today’s is | \(today )([\d.]+)\)?/);
    if (/fit to the trains/.test(s.strap) && !fitQuote) { console.log(`FAIL ${s.code}: its strap names a fit to the trains this check cannot read; say it as "of N (today M)"`); failed++; continue; }
    if (fitQuote) { const g = j.patterns ?? j, T = today().patterns;
        const got = [weekdayFloorFit(g, Object.keys(g).length), weekdayFloorFit(T, Object.keys(T).length)].map(v => v.toFixed(1));
        if (got[0] !== fitQuote[1] || got[1] !== fitQuote[2]) { console.log(`FAIL ${s.code}: its strap quotes a weekday fit of ${fitQuote[1]} against today’s ${fitQuote[2]}; the grids give ${got[0]} and ${got[1]}`); failed++; continue; } }
    if (checkOnly) { if (checkShipped(s.code, s.fp, s.dir ?? 'proposals')) { console.log(`ok   ${s.code}  ${got} (source grid and shipped JSON${s.dir ? `, in ${s.dir}/` : ''})`); done++; } continue; }
    process.stdout.write(`render ${s.code} … `);
    execFileSync('node', ['supplied.mjs', s.file, s.name, s.strap, s.code], { stdio: 'inherit' });
    shipFiles(`${s.name.replace(/ /g, '-')}-${s.code}`, s.fp, 'supplied.json', 'supplied-import.txt', s.dir);
    done++;
}
for (const t of SEARCHED) {
    if (only && !t.proposal.startsWith(only)) continue;
    const files = t.globs.flatMap(expand);
    if (!files.length) { console.log(`skip ${t.proposal} — no candidates`); continue; }
    if (checkOnly) { if (checkShipped(t.proposal, t.fp)) { console.log(`ok   ${t.proposal}  ${t.fp} (shipped JSON; ${files.length} candidates on disk)`); done++; } continue; }
    process.stdout.write(`render ${t.proposal} … `);
    // final.mjs is the 24-line tooling's and was never copied here (SEARCHED has been empty since); a SEARCHED entry
    // needs it back from docs/links-24/tooling, removed 7 Nov 2026 (`git checkout 924b9dbc -- docs/links-24`).
    execFileSync('node', ['final.mjs', ...files], { stdio: 'inherit', env: { ...process.env, PROPOSAL: t.proposal, ...(t.env ?? {}) } });
    const pdf = readdirSync('.').find(f => f.endsWith(`-${t.fp}.pdf`)); if (!pdf) throw new Error(`${t.proposal}: no PDF ending -${t.fp}.pdf was written — did the pick change?`);
    shipFiles(pdf.slice(0, -`-${t.fp}.pdf`.length), t.fp, 'proposal.json', 'proposal-import.txt');
    done++;
}
// NOTHING IN THE PACK'S FOLDERS THAT NO ENTRY SHIPS (4 Nov 2026). A rename or a move leaves the old name's three files
// behind, and everything that reads the folders would count them as one more design: a renamed design twice in the
// league, a moved one twice in the summary. Every sheet, grid and import file must be an entry's, under its name, code
// and folder; the 30-day folder may also hold its own README.md.
if (!only) { const want = new Set(SUPPLIED.flatMap(s => { const base = `${s.dir ?? 'proposals'}/${s.name.replace(/ /g, '-')}-${s.code}`;
    return [`${base}-${s.fp}.pdf`, `${base}.json`, `${base}-import.txt`]; }));
  const stray = PACK_DIRS.flatMap(d => readdirSync(`../${d}`).map(f => `${d}/${f}`)).filter(f => !want.has(f) && !/\/README\.md$/.test(f));
  if (stray.length) { console.log(`FAIL files no entry ships: ${stray.join(', ')}`); failed++; } }
console.log(`\n${done} proposal${done === 1 ? '' : 's'}${failed ? `, ${failed} FAILED` : ''}`);
// THE RULES REFERENCE (28 Sep 2026) is rendered by every full run, after the sheets, from the same rule code
// (sheetRules and flexibleRules, both built on currentRules) and the same folder — so it can never describe a rule set the sheets beside it were not judged against.
if (!checkOnly && !only) execFileSync('node', ['rules-sheet.mjs'], { stdio: 'inherit' });
// A SHIPPED PDF THAT GIT DOES NOT TRACK IS NOT SHIPPED. `.gitignore` ignores every *.pdf, so `git add docs/links-26`
// updates the PDFs already tracked and silently skips a NEW one; Weekend Capped's and Pinned Turns' PDFs sat on disk
// for a day while their JSON and import files were on main (25 Sep 2026). This refuses to report success while any
// PDF in the folder is untracked, and names the command that fixes it.
if (ship && !checkOnly) {
    const untracked = [...readdirSync('..').map(f => f), ...PACK_DIRS.flatMap(d => readdirSync(`../${d}`).map(f => `${d}/${f}`))].filter(f => f.endsWith('.pdf')).filter(f => { try { execFileSync('git', ['ls-files', '--error-unmatch', `../${f}`], { stdio: 'ignore' }); return false; } catch { return true; } });
    if (untracked.length) { console.log(`\nNOT TRACKED BY GIT — run: git add -f ${untracked.map(f => `docs/links-26/${f}`).join(' ')}`); process.exit(1); }
}
process.exit(failed ? 1 : 0);
