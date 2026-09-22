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
// The four SEARCHED proposals are rebuilt from the committed candidates in `results/`, so they
// depend on those files and not on a re-run of the annealer, which would take hours and is not
// deterministic across Node versions in the way the candidates are.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DAYS } from '../../../links-design.js';

const fingerprint = p => createHash('sha256')
    .update(JSON.stringify(Object.keys(p).sort((a, b) => a - b).map(k => DAYS.map(d => p[k][d]))))
    .digest('hex').slice(0, 8);

/** The supplied designs: a grid, a name, a strap line and a code. */
export const SUPPLIED = [
    { file: 'weekday-lates.json',      name: 'Weekday Lates',         code: 'WL-24-EXT',  fp: 'a52ec588', strap: 'Weekday lates at 16:25, Saturdays untouched' },
    { file: 'weekday-lates-2.json',    name: 'Weekday Lates 2',       code: 'WL2-24-R21', fp: '33f70893', strap: 'The 08:30 turns moved under the 17:00 peak' },
    { file: 'weekday-lates-3.json',    name: 'Weekday Lates 3',       code: 'WL3-24-F7',  fp: 'a6234195', strap: 'Weeks 13-17 protected, fatigue at its floor' },
    { file: 'weekday-lates-4.json',    name: 'Weekday Lates 4',       code: 'WL4-24-F7',  fp: 'f0d403d6', strap: 'Weeks 14-17 kept in order, on their own line numbers' },
    { file: 'fifteen-turns.json',      name: 'Fifteen Turns',         code: 'FT-24-EXT',  fp: '9a028392', strap: 'Fifteen turns, cover weeks evenly spread' },
    { file: 'fifteen-turns-repaired.json', name: 'Fifteen Turns Repaired', code: 'FT-24-R21', fp: 'b76bf9e1', strap: 'The supplied design, repaired and re-searched' },
    { file: 'weeks1718.json',          name: 'Weeks 17-18 Swapped',   code: 'WS-24-EXT',  fp: '0bebb675', strap: 'Cover week at 18, midday turn at 12:00-20:30' },
    { file: 'targeted-fatigue.json',   name: 'Targeted Fatigue Redo', code: 'TF-24-EXT',  fp: '8eef9a13', strap: 'Weeks 17-18 Swapped re-ordered by hand — same duties, same days, same coverage' },
    { file: 'three-mondays.json',     name: 'Three Mondays',         code: 'TM-24-EXT',  fp: 'fe90c0b8', strap: 'The eight-day run across weeks 14-15 broken by rotating three Monday duties' },
    { file: 'cover-at-seventeen.json', name: 'Cover at Seventeen',    code: 'C17-24-EXT', fp: 'edc1b731', strap: 'Lines 17 and 18 swapped back - the cover week returns to 17, and FF11 clears' },
];

/** The searched proposals: `final.mjs` picks from the committed candidates. */
export const SEARCHED = [
    { proposal: 'ST', fp: 'd15e1b74', globs: ['results/best-A-*.json', 'results/best-B-*.json'] },
    { proposal: 'BB', fp: '0f14abce', globs: ['results/best-RD-*.json'], env: { EXTRA: 'results/best-RDpure-21.json' } },
    { proposal: 'QT', fp: '70cf9874', globs: ['results/best-Q-*.json', 'results/best-R-*.json'] },
    { proposal: 'EF', fp: '0cf19f56', globs: ['results/best-RE-*.json'] },
];

const expand = g => { const [dir, pat] = [g.slice(0, g.lastIndexOf('/')), g.slice(g.lastIndexOf('/') + 1)];
    const re = new RegExp('^' + pat.replace(/[.]/g, '\\.').replace(/\*/g, '.*') + '$');
    return readdirSync(dir).filter(f => re.test(f)).sort().map(f => `${dir}/${f}`); };

const checkOnly = process.argv.includes('--check');
const only = process.argv.find(a => a.startsWith('--only='))?.slice(7);
let failed = 0, done = 0;

for (const s of SUPPLIED) {
    if (only && !s.code.startsWith(only)) continue;
    if (!existsSync(s.file)) { console.log(`skip ${s.code} — ${s.file} is not on this branch`); continue; }
    const j = JSON.parse(readFileSync(s.file, 'utf8'));
    const got = fingerprint(j.patterns ?? j);
    if (got !== s.fp) { console.log(`FAIL ${s.code}: ${s.file} fingerprints ${got}, expected ${s.fp}`); failed++; continue; }
    if (checkOnly) { console.log(`ok   ${s.code}  ${got}`); done++; continue; }
    process.stdout.write(`render ${s.code} … `);
    execFileSync('node', ['supplied.mjs', s.file, s.name, s.strap, s.code], { stdio: 'inherit' });
    done++;
}
for (const t of SEARCHED) {
    if (only && !t.proposal.startsWith(only)) continue;
    const files = t.globs.flatMap(expand);
    if (!files.length) { console.log(`skip ${t.proposal} — no candidates`); continue; }
    if (checkOnly) { console.log(`ok   ${t.proposal}  (${files.length} candidates)`); done++; continue; }
    process.stdout.write(`render ${t.proposal} … `);
    execFileSync('node', ['final.mjs', ...files], { stdio: 'inherit', env: { ...process.env, PROPOSAL: t.proposal, ...(t.env ?? {}) } });
    done++;
}
console.log(`\n${done} proposal${done === 1 ? '' : 's'}${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
