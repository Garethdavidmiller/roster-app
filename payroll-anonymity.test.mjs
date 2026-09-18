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
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { teamMembers } from './roster-data.js';

/** Payroll vocabulary. Deliberately broad — a false positive costs one reworded comment. */
const PAYROLL = /student\s*loan|\bplan\s*[1245]\b|postgrad|taxable pay|tax paid|payslip|pension|\bYTD\b|year to date|net pay|take[- ]home|national insurance/i;

/** Every name the roster publishes, INCLUDING hidden rows — a leaver is still a person. */
const NAMES = teamMembers.map(m => m.name).filter(Boolean);

/**
 * Tracked text files. `docs/proposals/**` is excluded on purpose: the December 2026 link proposals
 * carry rota names throughout and no pay at all, so scanning them would produce a long list of
 * matches on the word "pension" in a fatigue-rule paragraph and nothing else.
 */
const TRACKED = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split('\n').filter(Boolean)
    .filter(f => !/\.(png|pdf|woff2|ico|jpg|jpeg|webp|zip)$/i.test(f))
    .filter(f => !f.startsWith('docs/proposals/'));

describe('no roster name sits beside a payroll fact in the tracked tree', () => {
    test('every tracked text file', () => {
        /** @type {string[]} */
        const offences = [];
        for (const file of TRACKED) {
            let text;
            try { text = readFileSync(file, 'utf8'); } catch { continue; }
            text.split('\n').forEach((line, i) => {
                if (!PAYROLL.test(line)) return;
                const named = NAMES.filter(n => line.includes(n));
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
