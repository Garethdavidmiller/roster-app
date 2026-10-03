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

const fingerprint = p => createHash('sha256')
    .update(JSON.stringify(Object.keys(p).sort((a, b) => a - b).map(k => DAYS.map(d => p[k][d]))))
    .digest('hex').slice(0, 8);

/** The supplied designs: a grid, a name, a strap line and a code. */
// 26 LINES (1 Oct 2026): none yet. Each 26-line design is one entry, in the shape the 24-line list used
// (../../links-24/tooling/regenerate.mjs): { file, name, code, fp, strap }, the code carrying -26- (e.g. AB-26-EXT).
export const SUPPLIED = [
    // Second Nature (1 Oct 2026): the first 26-line design, built the Familiar Nine way — a duty table chosen from the
    // final-table.mjs sweep (results/second-nature-*.json), Silva Lining's week structure grown to 26 lines, then searched
    // and polished. README.md → "Second Nature" has every step and command.
    { file: 'second-nature.json',          name: 'Second Nature',  code: 'SN-26-F2',   fp: 'a52d0f20', strap: 'No duty over nine hours, seven full weekends off, and only the late finishes the closing rule needs' },
    // Second Wind (2 Oct 2026): Second Nature with its weeks reordered so the full weekends are never more than five weeks
    // apart, after an external review (README.md → "The review"). Same duty table, so same rules, times and late finishes.
    { file: 'second-wind.json',            name: 'Second Wind',    code: 'SW-26-F1',   fp: '4bec8d8e', strap: 'No duty over nine hours, and seven full weekends off never more than five weeks apart' },
    // Second Sight (2 Oct 2026): the same duty table again, its weeks searched afresh with the weekend gap capped at five
    // from the start (the restart the owner asked for, "the way we started Familiar Nine"), then polished with every
    // Second Nature / Second Wind figure as a floor. No week mixes earlies and lates. README.md → "Second Sight".
    { file: 'second-sight.json',           name: 'Second Sight',   code: 'SS-26-F1',   fp: '3c6aac4d', strap: 'No duty over nine hours, weekends never more than five weeks apart, and no week mixing earlies and lates' },
    // Second Look and Second Gear (2 Oct 2026): from the same restart as Second Sight, on two variations of Second Nature's
    // duty table, and the only rotas in it that met every floor. Second Look (table G3: the Saturday 08:00-16:30 pair moved
    // to 07:15-15:45) keeps the 42 late finishes; Second Gear (table H1) has the lightest weeks and costs two more a year.
    // README.md → "Second Look and Second Gear".
    { file: 'second-look.json',            name: 'Second Look',    code: 'SL-26-G3',   fp: '7095fdda', strap: 'Weekends never more than five weeks apart, four single rest days, and one week mixing earlies and lates' },
    { file: 'second-gear.json',            name: 'Second Gear',    code: 'SG-26-H1',   fp: '8d61e5c3', strap: 'Weekends never more than five weeks apart, no week over 41h 30m, and the gentlest week-to-week change' },
    // Quiet Friday (2 Oct 2026): the owner's what-if, "217 was the maximum working days per year … keep the rest of the
    // rules". One duty fewer a week (88): 14 on a Friday, the quietest day (owner), and 15 the other weekdays, so every rule
    // and flexible rule still holds. Its own family: a different ceiling and table. README.md → "Quiet Friday".
    { file: 'quiet-friday.json',           name: 'Quiet Friday',   code: 'QF-26-C1',   fp: 'daf8f3c9', strap: 'Built to 217 days a year: 14 on a Friday, and weekends never more than five weeks apart' },
    // Second Edition (2 Oct 2026): the owner asked for a roster stronger than any so far, at 219 days. Same duty table as
    // Second Nature; the weeks were built from a rest-day SKELETON (skeleton.mjs) that carries every rule a finished rota
    // must meet, then the times were searched. Weekends at most five apart, four single rest days, no mixed week, 18 of 21
    // weeks on one shift time, heaviest week 42h 00m, step 1h 01m — better than or equal to every design on every line.
    // README.md → "Second Edition".
    { file: 'second-edition.json',         name: 'Second Edition', code: 'SE-26-F1',   fp: 'dea6417f', strap: 'Weekends never more than five weeks apart, every week all earlies or all lates, and 18 of 21 weeks on one shift time' },
    // Fine Tune (3 Oct 2026): Second Gear with its weeks reordered by an outside reviewer (their candidate SGR-26-C1, with
    // its own search and recount in external/second-gear-refined/). The same duties every day, so the same table figures;
    // one mixed week instead of two and a smaller week-to-week step. Checked here by the app's own code before shipping.
    { file: 'fine-tune.json',              name: 'Fine Tune',      code: 'FT-26-H1',   fp: '9a7393d3', strap: 'Second Gear fine-tuned: no week over 41h 30m, one mixed week, and a gentler week-to-week change' },
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
const shipFiles = (base, fp, json, imp) => { if (!ship) return;
    copyFileSync(`${base}-${fp}.pdf`, `../proposals/${base}-${fp}.pdf`); copyFileSync(json, `../proposals/${base}.json`); copyFileSync(imp, `../proposals/${base}-import.txt`); };
let failed = 0, done = 0;
// THE SHIPPED CELLS, FINGERPRINTED (25 Sep 2026). --check printed "ok" for every SEARCHED proposal after
// counting its candidate files and fingerprinting nothing, while this file's header and the README said it
// checked every fingerprint. The searched sheet's cells are the ones shipped beside its PDF
// (`<Name>-<CODE>.json`), so that is what is fingerprinted — for the supplied designs too, whose SOURCE grid
// is checked above it. Re-deriving a searched pick needs final.mjs, which renders; a full run does that.
const shippedFp = fp => { const pdf = readdirSync('../proposals').find(f => f.endsWith(`-${fp}.pdf`)); if (!pdf) return { error: `no ../proposals/*-${fp}.pdf` };
    const base = pdf.slice(0, -`-${fp}.pdf`.length), json = `../proposals/${base}.json`; if (!existsSync(json)) return { error: `no ${json}` };
    const j = JSON.parse(readFileSync(json, 'utf8')); return { base, got: fingerprint(j.patterns ?? j) }; };
const checkShipped = (label, fp) => { const r = shippedFp(fp);
    if (r.error) { console.log(`FAIL ${label}: ${r.error}`); failed++; return false; }
    if (r.got !== fp) { console.log(`FAIL ${label}: ../${r.base}.json fingerprints ${r.got}, expected ${fp}`); failed++; return false; }
    return true; };

for (const s of SUPPLIED) {
    if (only && !s.code.startsWith(only)) continue;
    if (!existsSync(s.file)) { console.log(`skip ${s.code} — ${s.file} is not on this branch`); continue; }
    const j = JSON.parse(readFileSync(s.file, 'utf8'));
    const got = fingerprint(j.patterns ?? j);
    if (got !== s.fp) { console.log(`FAIL ${s.code}: ${s.file} fingerprints ${got}, expected ${s.fp}`); failed++; continue; }
    if (checkOnly) { if (checkShipped(s.code, s.fp)) { console.log(`ok   ${s.code}  ${got} (source grid and shipped JSON)`); done++; } continue; }
    process.stdout.write(`render ${s.code} … `);
    execFileSync('node', ['supplied.mjs', s.file, s.name, s.strap, s.code], { stdio: 'inherit' });
    shipFiles(`${s.name.replace(/ /g, '-')}-${s.code}`, s.fp, 'supplied.json', 'supplied-import.txt');
    done++;
}
for (const t of SEARCHED) {
    if (only && !t.proposal.startsWith(only)) continue;
    const files = t.globs.flatMap(expand);
    if (!files.length) { console.log(`skip ${t.proposal} — no candidates`); continue; }
    if (checkOnly) { if (checkShipped(t.proposal, t.fp)) { console.log(`ok   ${t.proposal}  ${t.fp} (shipped JSON; ${files.length} candidates on disk)`); done++; } continue; }
    process.stdout.write(`render ${t.proposal} … `);
    execFileSync('node', ['final.mjs', ...files], { stdio: 'inherit', env: { ...process.env, PROPOSAL: t.proposal, ...(t.env ?? {}) } });
    const pdf = readdirSync('.').find(f => f.endsWith(`-${t.fp}.pdf`)); if (!pdf) throw new Error(`${t.proposal}: no PDF ending -${t.fp}.pdf was written — did the pick change?`);
    shipFiles(pdf.slice(0, -`-${t.fp}.pdf`.length), t.fp, 'proposal.json', 'proposal-import.txt');
    done++;
}
console.log(`\n${done} proposal${done === 1 ? '' : 's'}${failed ? `, ${failed} FAILED` : ''}`);
// THE RULES REFERENCE (28 Sep 2026) is rendered by every full run, after the sheets, from the same rule code
// (sheetRules and flexibleRules, both built on currentRules) and the same folder — so it can never describe a rule set the sheets beside it were not judged against.
if (!checkOnly && !only) execFileSync('node', ['rules-sheet.mjs'], { stdio: 'inherit' });
// A SHIPPED PDF THAT GIT DOES NOT TRACK IS NOT SHIPPED. `.gitignore` ignores every *.pdf, so `git add docs/links-26`
// updates the PDFs already tracked and silently skips a NEW one; Weekend Capped's and Pinned Turns' PDFs sat on disk
// for a day while their JSON and import files were on main (25 Sep 2026). This refuses to report success while any
// PDF in the folder is untracked, and names the command that fixes it.
if (ship && !checkOnly) {
    const untracked = [...readdirSync('..').map(f => f), ...readdirSync('../proposals').map(f => `proposals/${f}`)].filter(f => f.endsWith('.pdf')).filter(f => { try { execFileSync('git', ['ls-files', '--error-unmatch', `../${f}`], { stdio: 'ignore' }); return false; } catch { return true; } });
    if (untracked.length) { console.log(`\nNOT TRACKED BY GIT — run: git add -f ${untracked.map(f => `docs/links-26/${f}`).join(' ')}`); process.exit(1); }
}
process.exit(failed ? 1 : 0);
