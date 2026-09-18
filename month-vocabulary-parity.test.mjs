// @ts-check
/**
 * month-vocabulary-parity.test.mjs — nothing in the shipped app may spell a month with ICU's table.
 *
 * ── THE DEFECT THIS FILE IS THE FIFTH ANSWER TO ────────────────────────────────────────────────
 *
 * `toLocaleDateString` / `Intl.DateTimeFormat` with `month: 'short'` abbreviates September to FOUR
 * letters in en-GB and every other month to three. Measured on Node 22, Chromium and WebKit — so
 * it reached every staff device. The app's own table (`MONTH_ABB`) says "Sep".
 *
 * It was found and fixed LOCALLY twice before v24.06, which is why a repo-wide rule exists rather
 * than a third local fix:
 *
 *   v22.86  Team View composed the string from MONTH_ABB by hand, because its print header said
 *           "Printed 3 Sept 2026" above a week label saying "5 Sep 2026".
 *   v23.xx  Overtime formatted through Intl and then trimmed with `.replace(/\bSept\b/, 'Sep')`,
 *           in TWO functions, because a column of deadlines came out ragged.
 *
 * Both were correct and neither generalised, so the Links print header, the Pay Calculator, the
 * Settings work-email card and the Operations error log went on saying "Sept" — on screen as well
 * as on paper. That is the shape this repo calls "the rule tested, the wiring not": each fix was
 * right about its own line and nothing asked the question anywhere else.
 *
 * ── WHAT IS CHECKED, AND WHY IT IS THE SOURCE AND NOT THE OUTPUT ───────────────────────────────
 *
 * A behavioural test would have to render every surface in September to see this, which is why it
 * survived a year of green suites. So this reads the SOURCE: no shipped module may ask a formatter
 * for a month name at all. `date-format.js` is the one place allowed to, and only for the NUMERIC
 * parts of the London shim.
 *
 * Deleting any composer's use in a call site and putting `toLocaleDateString` back turns this red;
 * that is the mutation it is written against.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (/** @type {string} */ f) => readFileSync(new URL(f, import.meta.url), 'utf8');

/**
 * CODE only — the same stripper `storage-key-parity.test.mjs` uses, and borrowed rather than
 * reinvented so the two behave identically.
 *
 * It matters more here than usual: this rule is about a defect whose HISTORY several modules now
 * quote in their headers ("...spells September Sept...", "...used to `.replace(/\bSept\b/, 'Sep')`
 * ..."). A scan that could not tell code from prose would fail on exactly the files that explain
 * themselves best, and the cheapest way to go green would be to delete the explanation. The
 * `[^:]` guard is what keeps `https://` in a string from swallowing the rest of its line.
 * @param {string} src
 */
const codeOnly = src =>
    src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

/**
 * The shipped browser modules: every root .js that is not a test, a script or a config.
 * Derived from the directory rather than listed, so a new module is covered the day it lands.
 */
const MODULES = readdirSync(new URL('.', import.meta.url))
    .filter(f => f.endsWith('.js'))
    .filter(f => !f.endsWith('.test.mjs') && f !== 'eslint.config.js');

/**
 * `functions/` is deliberately OUT of scope: Cloud Functions are CommonJS and cannot import a
 * browser ES module, so `functions/overtime-core.js` carries its own `MONTH_ABB_EN` — the same
 * documented duplication as `normaliseSurname`. It is already correct, and `overtime-core`'s own
 * suite pins its output. Listing it here would demand an import it cannot make.
 */

/**
 * A month name asked of a date formatter — in the two registers that are BANNED.
 *
 * `long` is deliberately NOT here, and the reason is measured rather than assumed: en-GB's long
 * month names are identical to `MONTH_NAMES` for all twelve, so the five `month: 'long'` call sites
 * in the app disagree with nothing. Banning them would have meant five edits with no behaviour
 * change, on the strength of a divergence that does not exist — the mirror image of the mistake
 * this file was written about. The test below checks that this stays true, so the exemption is a
 * standing measurement and not a guess that ages.
 *
 * `narrow` is banned although nothing uses it: it renders single letters, so June and July are both
 * "J". That is a worse failure than "Sept" and costs nothing to close now.
 */
const ASKS_FOR_A_MONTH_NAME = /month:\s*['"](short|narrow)['"]/g;

describe('no shipped module spells a month with ICU', () => {
    test('every root module composes month names from the app\'s own table', () => {
        const offenders = [];
        for (const file of MODULES) {
            if (file === 'date-format.js') continue;   // the one exemption, checked below
            const src = codeOnly(read(`./${file}`));
            ASKS_FOR_A_MONTH_NAME.lastIndex = 0;
            const hits = src.match(ASKS_FOR_A_MONTH_NAME);
            if (hits) offenders.push(`${file}: ${hits.join(', ')}`);
        }
        assert.deepEqual(offenders, [],
            'These ask a date formatter for a month NAME. en-GB spells September "Sept" and every\n'
          + 'other month in three letters, so the surface will disagree with the calendar beside it.\n'
          + 'Use the composers in date-format.js — formatDayMonth / formatDayMonthYear /\n'
          + 'formatDayMonthYear2 / formatWeekdayDate, and londonDate first for a London document.');
    });

    test('date-format.js itself asks only for NUMERIC parts', () => {
        // The exemption has to be narrow or it is not an exemption. `londonDate` reads the London
        // month as a NUMBER; if it ever read a name, the module built to avoid ICU's table would be
        // depending on it.
        const src = codeOnly(read('./date-format.js'));
        ASKS_FOR_A_MONTH_NAME.lastIndex = 0;
        assert.equal(ASKS_FOR_A_MONTH_NAME.test(src), false,
            'date-format.js asked a formatter for a month NAME — the shim must stay numeric');
        assert.match(src, /month:\s*'numeric'/, 'the London shim no longer reads a numeric month');
    });

    test('the pattern has teeth — it catches every form the app actually wrote', () => {
        // Stated rather than assumed. All four shipped in this repo before v24.06; a regex edit
        // that stopped matching them would leave this file green while guarding nothing.
        for (const shipped of [
            "d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })",
            "new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })",
            "new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', month: 'short' })",
            'd.toLocaleString("en-GB", { month: "narrow" })',
        ]) {
            ASKS_FOR_A_MONTH_NAME.lastIndex = 0;
            assert.ok(ASKS_FOR_A_MONTH_NAME.test(shipped), `no longer caught: ${shipped}`);
        }
        // ...and does not flag the numeric form the shim needs, or an unrelated word.
        for (const fine of ["{ month: 'numeric', day: 'numeric' }", "const month = 'short';",
                            // the exempt register, per the measurement below
                            'd.toLocaleString("en-GB", { month: "long", year: "numeric" })']) {
            ASKS_FOR_A_MONTH_NAME.lastIndex = 0;
            assert.equal(ASKS_FOR_A_MONTH_NAME.test(fine), false, `wrongly flagged: ${fine}`);
        }
    });
});

describe('the two local fixes it replaced are gone, not merely bypassed', () => {
    test('no module trims "Sept" out of a formatted string any more', () => {
        // A surviving `.replace(/\bSept\b/, 'Sep')` would mean a surface still formats through ICU
        // and patches the result, which is the second strategy this file exists to retire. It also
        // only ever fixed September; the composers cannot have a month-shaped exception at all.
        //
        // No file is exempt here — `codeOnly` already means a module may QUOTE the old patch in
        // its header without tripping this, which several now do. The next test requires that
        // history to still be there, so going green by deleting the explanation is also closed.
        for (const file of MODULES) {
            assert.ok(!/Sept\\b\/\s*,\s*'Sep'/.test(codeOnly(read(`./${file}`))),
                `${file} still string-patches "Sept" — compose from date-format.js instead`);
        }
    });

    test('date-format.js still records WHY it exists', () => {
        // The exemption above is only safe while the header is doing the job it is exempted for.
        const src = read('./date-format.js');
        assert.match(src, /Sept/, 'the header no longer names the spelling this module was written for');
        assert.match(src, /v22\.86/, 'the header no longer names the first local fix it generalised');
    });

    test('the long register still agrees with the app, which is why it is exempt', () => {
        // The standing measurement behind ASKS_FOR_A_MONTH_NAME leaving `long` alone. If a future
        // ICU ever disagrees here, this fails and `long` joins the ban — which is the outcome we
        // want, rather than discovering it on a printed sheet.
        const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
                             'July', 'August', 'September', 'October', 'November', 'December'];
        for (let m = 0; m < 12; m++) {
            assert.equal(new Date(2026, m, 15).toLocaleDateString('en-GB', { month: 'long' }),
                MONTH_NAMES[m], `en-GB's long month ${m} no longer matches MONTH_NAMES`);
        }
    });

    test('both registers still have a table, and each is in the right module', () => {
        // Not everything abbreviates: "Week ending Saturday 5 September 2026" is correct, and the
        // rule above must not be read as banning month names. The app has two registers — full for
        // headings, abbreviated for compact lines — and each needs a table for the ban to be
        // followable rather than merely obeyed.
        //
        // WHERE they live is the part worth pinning. MONTH_ABB moved into date-format.js at v24.06
        // so the vocabulary owns the words it spells with, which is also what let five paycalc
        // suites keep mocking roster-data.js by name. MONTH_NAMES did not move: no composer uses
        // it, and it is read straight by the heading builders.
        assert.match(read('./date-format.js'), /export const MONTH_ABB\s*=/,
            'MONTH_ABB left date-format.js — the composers now spell from somewhere else');
        assert.match(read('./date-format.js'), /export const DAY_NAMES\s*=/);
        assert.match(read('./roster-data.js'), /export const MONTH_NAMES\s*=/);
        // Re-exported, so nothing that already read the tables from roster-data.js had to change.
        assert.match(read('./roster-data.js'), /export \{[^}]*MONTH_ABB[^}]*\} from '\.\/date-format\.js'/);
    });
});
