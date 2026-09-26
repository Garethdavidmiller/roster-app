// @ts-check
/**
 * payroll-anonymity.test.mjs — NO ROSTER NAME SITS BESIDE A PAYROLL FACT IN THE TRACKED TREE.
 *
 * ── WHY THIS IS A TEST AND NOT A TIDY-UP (v23.96) ───────────────────────────────────────────────
 *
 * It has been cleaned once already. v23.71 removed the thirteen real payslips from the repository
 * because `firebase.json`'s `test-fixtures/**` exclusion governs Firebase Hosting and cannot speak
 * for the GitHub Pages mirror, which publishes the repository root with no ignore list. What that
 * pass moved was the FIGURES. What it left behind was the commentary that attributed them — and an
 * external review found it still there four releases later, naming four colleagues against payslip
 * numbers, a student-loan plan, a pro-rata factor and a pay baseline.
 *
 * Measured at the time, on the staff-facing origin:
 *
 *     garethdavidmiller.github.io/roster-app/paycalc.test.mjs      200
 *     garethdavidmiller.github.io/roster-app/e2e/paycalc.spec.js   200
 *     myb-roster.web.app/paycalc.test.mjs                          404
 *
 * So this is not a repository-hygiene preference. A colleague's name beside their payroll figure
 * was fetchable from the app's own URL, by the origin most staff use.
 *
 * ── WHAT IT IS NOT ──────────────────────────────────────────────────────────────────────────────
 *
 * It is NOT "no roster names in tests". Names are legitimate fixtures: the roster-suggestion suite
 * looks members up BY NAME because it needs their real base patterns, and `roster-data.js` is a
 * deliberate public classification (owner, 4 Sep 2026 — shift patterns are on the station's own
 * printed rosters). Blanket-replacing those would break real tests and protect nothing.
 *
 * The line this draws is a name CO-LOCATED WITH A PAYROLL TERM. A rota pattern is public; what
 * somebody was paid, what they were deducted, and which student-loan plan they are on is not.
 *
 * ── HOW TO SATISFY IT ───────────────────────────────────────────────────────────────────────────
 *
 * Keep the arithmetic; drop the attribution. "the reference payslip", "a 20 April joiner", "the
 * developer account" all carry the provenance a reader needs — that a figure came from a real
 * payslip rather than an invented one — without naming whose it was. There is no testing value in
 * the name, which is the whole reason this is cheap to obey.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { teamMembers } from './roster-data.js';

/** Payroll vocabulary. Deliberately broad — a false positive costs one reworded comment. */
const PAYROLL = /student\s*loan|\bplan\s*[1245]\b|postgrad|taxable pay|tax paid|payslip|pension|\bYTD\b|year to date|net pay|take[- ]home|national insurance/i;

/**
 * LEAVE vocabulary — a person's leave BALANCE, not the subject of annual leave (v24.15).
 *
 * Added after an external review found `docs/AL_WORKBOOK.md` publishing roughly fifty dated entries
 * naming colleagues against their days taken, days remaining and — in one line — a reason for
 * absence. `docs/` is inside the Pages mirror, and that file answered HTTP 200 while returning 404
 * on Firebase, which is the same asymmetry this suite already exists for.
 *
 * Deliberately NARROWER than `PAYROLL`. The words "annual leave" are everywhere in this app and
 * mean nothing on their own; what identifies a person is a COUNT against them — a balance, a
 * remainder, an over-quota day — or a reason for absence, which this app never records anywhere
 * (CLAUDE.md states that as a GDPR rule, and a served document is the last place to break it).
 */
const LEAVE = /over[- ]quota|days remaining|grid days|days taken|\blong[- ]term sick|\bsickness\b|reason for absence/i;

/** Every name the roster publishes, INCLUDING hidden rows — a leaver is still a person. */
const NAMES = teamMembers.map(m => m.name).filter(Boolean);

/** Escape a string for use inside a RegExp. */
const reEscape = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The depot workbook's own name form, `Surname . I` (and `Surname, I`), derived from each app name
 * `I. Surname` — plus the workbook's hyphen shortening (`X-Surname . I` for `I. Xxx-Surname`).
 *
 * Without these the guard read only the app's spelling, and `docs/AL_WORKBOOK.md` quoted the
 * workbook's: it carried a named row's reason for absence beside a leave balance for a release after
 * this suite gained its LEAVE rule, and passed, because `I. Surname` never appeared on that line.
 *
 * @type {{ name: string, re: RegExp }[]}
 */
const WORKBOOK_FORMS = NAMES.flatMap(name => {
    const m = /^([A-Z])\.\s*(.+)$/.exec(name);
    if (!m) return [];
    const [, , surname] = m;
    const surnames = [surname];
    if (surname.includes('-')) {
        const parts = surname.split('-');
        surnames.push(`${parts[0][0]}-${parts.slice(1).join('-')}`);   // Francisco-Charles → F-Charles
    }
    return surnames.map(s => ({
        name,
        // ANY initial, not only the app's: the workbook disagrees on three people (a known-as name,
        // or an error), and one of those three is the row that carried the reason for absence.
        re: new RegExp(`\\b${reEscape(s)}\\s*[.,]\\s*[A-Z]\\b`),
    }));
});

/**
 * Every roster name found on a line, in either spelling. Reported by its APP form, once.
 * @param {string} line
 * @returns {string[]}
 */
function namesOn(line) {
    const found = new Set(NAMES.filter(n => line.includes(n)));
    for (const { name, re } of WORKBOOK_FORMS) if (re.test(line)) found.add(name);
    return [...found];
}

/** Binary shapes nothing can leak a name through, and the one directory scanned on purpose. */
const SKIP_EXT = /\.(png|pdf|woff2|ico|jpg|jpeg|webp|zip)$/i;
/** `docs/proposals/**` is excluded on purpose: the December 2026 link proposals carry rota names
 *  throughout and no pay at all, so scanning them yields a long list of matches on the word
 *  "pension" in a fatigue-rule paragraph and nothing else. */
const SKIP_DIR = 'docs/proposals/';

/**
 * Directories a WALK must not descend into. `git ls-files` excludes these for free; a filesystem
 * walk has to be told. They are either not tracked (node_modules, run artefacts) or not files
 * (.git itself), so skipping them cannot hide a tracked leak.
 */
const UNTRACKED_DIRS = new Set([
    '.git', 'node_modules', 'test-results', 'playwright-report', 'coverage', '.firebase',
]);

/**
 * ── WHY THIS IS NOT JUST `git ls-files` (v24.13) ────────────────────────────────────────────────
 *
 * It was, and that broke an explicit repository promise. `npm test` is supposed to run on a bare
 * checkout — README states it, `test:nodeps` gates it in CI, and an external reviewer verifies each
 * release by unzipping the GitHub archive and running the estate. A ZIP has no `.git`, so this
 * suite died with `fatal: not a git repository` and took the whole hygiene lane red with it —
 * 3,263 of 3,264 passing, the one failure being the guard itself rather than anything it guards.
 *
 * CI never saw it, because CI clones. That is the same shape as the defect this release already
 * fixed in the roster importer: a path nobody executes cannot fail, and the environment that would
 * have shown it is the one nobody runs.
 *
 * `git ls-files` stays the PREFERRED answer, because "tracked" is exactly the question — the Pages
 * mirror publishes the tracked tree and nothing else. The walk is the fallback, and it is
 * deliberately WIDER than git: it may scan an untracked stray, which costs a reworded line, where
 * missing a tracked file would cost the thing this guard exists to prevent. The superset property
 * is asserted below rather than assumed.
 *
 * @param {{ allowGit?: boolean }} [opts] — `allowGit: false` forces the archive path, for the test
 *        that proves the fallback works without having to delete a `.git` directory to find out.
 * @returns {string[]} repo-relative paths, scannable text files only
 */
function listFiles({ allowGit = true } = {}) {
    const keep = (/** @type {string} */ f) => !SKIP_EXT.test(f) && !f.startsWith(SKIP_DIR);
    if (allowGit) {
        try {
            return execFileSync('git', ['ls-files'], {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],   // a missing .git must not print to the run
            }).split('\n').filter(Boolean).filter(keep);
        } catch {
            // No git metadata (an unzipped archive) or no git binary. Fall through to the walk.
        }
    }
    /** @type {string[]} */
    const out = [];
    (function walk(/** @type {string} */ dir) {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const rel = dir === '.' ? entry.name : `${dir}/${entry.name}`;
            if (entry.isDirectory()) {
                if (UNTRACKED_DIRS.has(entry.name)) continue;
                walk(rel);
            } else if (entry.isFile()) {
                out.push(rel);
            }
        }
    })('.');
    return out.filter(keep).sort();
}

const TRACKED = listFiles();

// ── THE ARCHIVE FALLBACK (v24.13) ──────────────────────────────────────────────────────────────
//
// These run in a CLONE, where git is available, so they cannot prove "the ZIP works" by being here.
// What they prove is the property that makes the ZIP work: the walk sees everything git sees. A
// test that merely called the fallback and checked it returned SOMETHING would pass on a walk that
// had quietly stopped descending — which is the failure mode worth catching, because a file this
// guard does not scan is a file it cannot protect.
describe('the enumeration survives an unzipped archive, with nothing lost', () => {
    test('the fallback is a SUPERSET of what git tracks — no scanned file is dropped', () => {
        const viaGit  = listFiles();                      // the preferred answer, in a clone
        const viaWalk = new Set(listFiles({ allowGit: false }));
        assert.ok(viaGit.length > 100, `git listed only ${viaGit.length} files — this proves nothing`);
        const missed = viaGit.filter(f => !viaWalk.has(f));
        assert.deepEqual(missed, [],
            'the archive fallback does not reach these tracked files, so in a ZIP they would go '
            + 'unscanned and a name beside a payroll figure in one of them would ship unnoticed:\n  '
            + missed.slice(0, 20).join('\n  '));
    });

    test('every file class this guard must read is actually in the list', () => {
        // THE SUPERSET TEST ABOVE CANNOT SEE A BUG IN `keep`, and a mutation proved it: narrowing
        // `keep` to drop every `.md` left that assertion green, because the git list and the walk
        // are filtered by the SAME predicate and so lose the same files together. Two copies
        // agreeing because they share the broken part is the defect shape this repo keeps meeting.
        //
        // Docs are not an incidental class here — they are where the external review found real
        // names beside payroll figures. So the classes are asserted against the FINAL list.
        const have = new Set(TRACKED.map(f => f.replace(/^.*\./, '')));
        for (const ext of ['js', 'mjs', 'md', 'html', 'css', 'json']) {
            assert.ok(have.has(ext),
                `no .${ext} file survived the filter, so this guard scans none of them — `
                + 'a name beside a payroll figure in one would ship unseen');
        }
    });

    test('and it refuses the directories git excludes for free', () => {
        // A walk that descended into node_modules would scan tens of thousands of third-party files,
        // turn a fast guard into a slow one, and report offences in code this repo does not own.
        const viaWalk = listFiles({ allowGit: false });
        const strays  = viaWalk.filter(f => /(^|\/)(\.git|node_modules|test-results|playwright-report)\//.test(f));
        assert.deepEqual(strays, [], `the walk descended where it should not:\n  ${strays.slice(0, 5).join('\n  ')}`);
    });

    test('the scan itself runs on the fallback list, not merely the git one', () => {
        // Guard the guard: the walk must produce a list the real scan can consume — same shape,
        // same relative paths, readable. A fallback that returned absolute paths, or `./`-prefixed
        // ones, would read zero files and report a clean tree.
        const viaWalk = listFiles({ allowGit: false });
        assert.ok(viaWalk.includes('payroll-anonymity.test.mjs'), 'the walk did not find this file');
        assert.ok(viaWalk.every(f => !f.startsWith('/') && !f.startsWith('./')),
            'the walk returned paths readFileSync cannot resolve from the repo root');
    });
});

describe('no roster name sits beside a LEAVE BALANCE in the tracked tree', () => {
    test('every tracked text file', () => {
        /** @type {string[]} */
        const offences = [];
        for (const file of TRACKED) {
            let text;
            try { text = readFileSync(file, 'utf8'); } catch { continue; }
            text.split('\n').forEach((line, i) => {
                if (!LEAVE.test(line)) return;
                const named = namesOn(line);
                if (named.length) {
                    offences.push(`${file}:${i + 1}  [${named.join(', ')}]  ${line.trim().slice(0, 120)}`);
                }
            });
        }
        assert.deepEqual(offences, [],
            'A roster name is on the same line as a leave balance or a reason for absence, in a file '
            + `the GitHub Pages mirror serves at HTTP 200:\n\n  ${offences.join('\n  ')}\n\n`
            + 'Same remedy as the payroll rule above: keep the arithmetic, drop the attribution — '
            + '"a member", "one Dispatcher", "the joining year". A METHOD needs no name. If the '
            + 'per-person record itself is the point, it does not belong in the tree at all: '
            + 'docs/AL_WORKBOOK.local.md is gitignored for exactly that, and docs/AL_WORKBOOK.md '
            + 'section 12 says why.');
    });
});

describe('no roster name sits beside a payroll fact in the tracked tree', () => {
    test('every tracked text file', () => {
        /** @type {string[]} */
        const offences = [];
        for (const file of TRACKED) {
            let text;
            try { text = readFileSync(file, 'utf8'); } catch { continue; }
            text.split('\n').forEach((line, i) => {
                if (!PAYROLL.test(line)) return;
                const named = namesOn(line);
                if (named.length) {
                    offences.push(`${file}:${i + 1}  [${named.join(', ')}]  ${line.trim().slice(0, 120)}`);
                }
            });
        }
        assert.deepEqual(offences, [],
            'A roster name is on the same line as a payroll term, in a file the GitHub Pages mirror '
            + `serves at HTTP 200:\n\n  ${offences.join('\n  ')}\n\n`
            + 'Keep the assertion, drop the attribution — "the reference payslip", "a 20 April '
            + 'joiner", "the developer account". The provenance survives; the name is not needed to '
            + 'make the arithmetic true. If this really is a false positive (a name beside the WORD '
            + '"pension" with no personal figure attached), reword the line rather than widening '
            + 'the rule: this guard exists because the same cleanup was done once and grew back.');
    });
});
