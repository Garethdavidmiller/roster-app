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
// Weeks 17-18 Swapped (WS-24-EXT · 0bebb675), Targeted Fatigue Redo (TF-24-EXT · 8eef9a13) and Three Mondays
// (TM-24-EXT · fe90c0b8) were WITHDRAWN on 29 Sep 2026 (owner: "we have better options"); git history holds their grids.
// Frozen Block (WL3-24-F7 · a6234195) and Tenth Sunday (TN-24-R7 · 84b60df9) followed the same day (owner).
// Short Closer (CF-24-EXT · 6d21169b) and Light Retime (CFT-24-M3 · ae1a15bd), built from it, too.
export const SUPPLIED = [
    { file: 'weekday-lates.json',      name: 'Weekday Lates',         code: 'WL-24-EXT',  fp: 'a52ec588', strap: 'Weekday lates at 16:25, Saturdays untouched' },
    { file: 'weekday-lates-2.json',    name: 'Evening Peak',       code: 'WL2-24-R21', fp: '33f70893', strap: 'The 08:30 turns moved under the 17:00 peak' },
    { file: 'weekday-lates-4.json',    name: 'Anchored Lines',       code: 'WL4-24-F7',  fp: 'f0d403d6', strap: 'Weeks 14-17 kept in order, on their own line numbers' },
    { file: 'fifteen-turns.json',      name: 'Fifteen Turns',         code: 'FT-24-EXT',  fp: '9a028392', strap: 'Fifteen turns, cover weeks evenly spread' },
    // Gates Mended (FT-24-R21 · b76bf9e1) was WITHDRAWN on 29 Sep 2026 (owner). Its grid stays as fifteen-turns-repaired.json:
    // its shift times are part of the exact solver's allowed pool (exact/common.py), so All Clear stays reproducible.
    // Cover at Seventeen (C17-24-EXT · edc1b731) and Saturday Four (S4-24-EXT · 481ba9ed) were WITHDRAWN on 29 Sep 2026
    // (owner), with their source grids; git history holds both (sat-assign.mjs built Saturday Four from the first).
    // Familiar Nine (28 Sep 2026) is built rather than supplied — table K proven by final-table.mjs, Right Away's week
    // structure carried onto it and polished — but its grid is the finished product of three tools, so it ships as a grid.
    // 29 Sep 2026: its Sunday re-searched under the owner's December Sunday office plan — three Sunday cells (the
    // 08:30–16:30 now 09:00–18:00, the office lates 14:30–22:30 not 14:00), was F9-24-K31 · c450951c.
    { file: 'right-away.json',             name: 'Right Away',     code: 'FR-24-F34s', fp: '745e98b0', strap: 'The ticket office rostered in fixed pairs, every other duty timed so the floor follows the trains' },
    { file: 'familiar-nine.json',          name: 'Familiar Nine',  code: 'F9-24-K31s', fp: '598a1294', strap: 'No duty over nine hours, and more than half its duties at times people already work' },
    // Just Enough (28 Sep 2026) is Fifteen Turns with the fewest cells changed that meet every rule — 29, proven by the exact
    // solver in tooling/exact/ — and, among those, the fewest fatigue factors (three, also proven).
    // Just Enough (JE-24-M29 · 49717d70) was WITHDRAWN on 29 Sep 2026 (owner). Its grid stays as just-enough.json, the
    // exact solver's 29-change answer, which All Clear is the zero-fatigue end of; it no longer ships a sheet.
    // Polished Clean (28 Sep 2026) was supplied as a one-page Word table; every weekly total was checked against its cells.
    // Polished Clean (PC-24-EXT · 12424ed2) was WITHDRAWN on 29 Sep 2026 (owner) and RESTORED on 30 Sep 2026 (owner),
    // re-rendered in the managers' plain edition against the nine December rules. Clean Sweep is still counted from it.
    { file: 'polished-clean.json',         name: 'Polished Clean', code: 'PC-24-EXT',  fp: '12424ed2', strap: 'Weekday closers from 16:25, with twelve on a Saturday' },
    // All Clear and Clean Sweep (28 Sep 2026): the exact solver's other two answers — Fifteen Turns with no fatigue factor
    // at all (41 changes, proven), and Polished Clean made to meet the rules but its waived 15:45 closer (34, proven).
    { file: 'all-clear.json',              name: 'All Clear',      code: 'AC-24-M41',  fp: '094fd369', strap: 'Fifteen Turns with the fewest changes that meet every rule with no fatigue finding' },
    { file: 'clean-sweep.json',            name: 'Clean Sweep',    code: 'CS-24-M34',  fp: '92366924', strap: 'Polished Clean with the fewest changes that meet every rule but the 15:45 closer' },
    // The Running Repair family (29 Sep 2026, owner): Weekday Lates with three rules waived (16:25 closers, twelve on a
    // Saturday, cover weeks anywhere not side by side), each day's duty mix re-searched so the fits compete with the best
    // sheets (exact/mixsa.mjs → exact/rr-mix.json), then the rota built in the fewest changes for that mix (exact/tiebreak.py
    // with MIX= and WIDE=1): up to four tiring patterns (Running Repair) and none (Full Overhaul).
    // Running Repair (RR-24-M34 · 621165eb, the 34-change, four-pattern member) was WITHDRAWN on 30 Sep 2026 (owner);
    // exact/rr-mix.json and the commands in the README rebuild it. Full Overhaul, the same mix with no pattern, stays.
    { file: 'full-overhaul.json',          name: 'Full Overhaul',  code: 'FO-24-M49',  fp: 'bb9b6c24', strap: 'Weekday Lates retimed to follow the trains, with no tiring pattern' },
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
export const SEARCHED = [
    // FR ran fatigue-first only, on the owner's final rules of 28 Sep 2026 (table F, final-rules-table.json, built by final-table.mjs).
    // 34o (28 Sep 2026) is seed 34's rotation with its week order improved by order-polish.mjs — the same duties on every
    // day, better or equal on every figure; it wins the pick on the search's own score, by the rule every seed is judged by.
    // Right Away left this list on 29 Sep 2026: its Sunday was re-searched under the owner's December Sunday office plan
    // (three Sunday cells — the 09:15–18:15 now 09:00–18:00, the office lates 14:30–22:30 not 13:30), so it ships as a
    // grid (SUPPLIED, right-away.json); the searched FR-24-F34o · be01f0db it came from is still rebuilt by final.mjs.
];

const expand = g => { const [dir, pat] = [g.slice(0, g.lastIndexOf('/')), g.slice(g.lastIndexOf('/') + 1)];
    const re = new RegExp('^' + pat.replace(/[.]/g, '\\.').replace(/\*/g, '.*') + '$');
    return readdirSync(dir).filter(f => re.test(f)).sort().map(f => `${dir}/${f}`); };

const checkOnly = process.argv.includes('--check');
const only = process.argv.find(a => a.startsWith('--only='))?.slice(7);
// SHIP: copy each render's three artefacts up into docs/proposals under the names the folder uses
// (`<Name>-<CODE>-<fp>.pdf`, `<Name>-<CODE>.json`, `<Name>-<CODE>-import.txt`). This used to be a
// hand-typed cp per proposal after every regeneration, and a hand-typed cp is how a folder ends up
// with a PDF from one render and a JSON from another. --no-ship leaves the outputs in tooling/.
const ship = !process.argv.includes('--no-ship');
const shipFiles = (base, fp, json, imp) => { if (!ship) return;
    copyFileSync(`${base}-${fp}.pdf`, `../${base}-${fp}.pdf`); copyFileSync(json, `../${base}.json`); copyFileSync(imp, `../${base}-import.txt`); };
let failed = 0, done = 0;
// THE SHIPPED CELLS, FINGERPRINTED (25 Sep 2026). --check printed "ok" for every SEARCHED proposal after
// counting its candidate files and fingerprinting nothing, while this file's header and the README said it
// checked every fingerprint. The searched sheet's cells are the ones shipped beside its PDF
// (`<Name>-<CODE>.json`), so that is what is fingerprinted — for the supplied designs too, whose SOURCE grid
// is checked above it. Re-deriving a searched pick needs final.mjs, which renders; a full run does that.
const shippedFp = fp => { const pdf = readdirSync('..').find(f => f.endsWith(`-${fp}.pdf`)); if (!pdf) return { error: `no ../*-${fp}.pdf` };
    const base = pdf.slice(0, -`-${fp}.pdf`.length), json = `../${base}.json`; if (!existsSync(json)) return { error: `no ${json}` };
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
// A SHIPPED PDF THAT GIT DOES NOT TRACK IS NOT SHIPPED. `.gitignore` ignores every *.pdf, so `git add docs/proposals`
// updates the PDFs already tracked and silently skips a NEW one; Weekend Capped's and Pinned Turns' PDFs sat on disk
// for a day while their JSON and import files were on main (25 Sep 2026). This refuses to report success while any
// PDF in the folder is untracked, and names the command that fixes it.
if (ship && !checkOnly) {
    const untracked = readdirSync('..').filter(f => f.endsWith('.pdf')).filter(f => { try { execFileSync('git', ['ls-files', '--error-unmatch', `../${f}`], { stdio: 'ignore' }); return false; } catch { return true; } });
    if (untracked.length) { console.log(`\nNOT TRACKED BY GIT — run: git add -f ${untracked.map(f => `docs/proposals/${f}`).join(' ')}`); process.exit(1); }
}
process.exit(failed ? 1 : 0);
