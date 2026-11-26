// @lane hygiene
/**
 * rdw-term-parity.test.mjs — RDW has one name on screen: "Rest Day Working".
 * Run: node scripts/run-tests.mjs test/rdw-term-parity.test.mjs   (part of `npm run test:hygiene`)
 *
 * @nodeps-safe — runs on a bare checkout with nothing installed.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 *
 * RDW was spelt two ways (review, 17 Nov 2026). "Rest Day Worked" was on the Calendar's legend, its
 * day panel and Team Week, on Admin's Saved Changes and in the Pay Calculator's glossary.
 * "Rest Day Working" was on the Pay Calculator's own row — the one that decides where a member types
 * the hours — on Admin's Sunday pill and in the Pay Calculator Guide.
 *
 * A colleague matching a payslip line ("RDW 1.25") to the app should meet ONE name for it. "Rest Day
 * Working" is the railway's own term and the one the Pay Calculator row already used, so it is the
 * one kept. Surfaces written in sentence case ("Rest day", "Annual leave") write "Rest day working".
 *
 * ── WHAT IT READS, AND WHAT IT LEAVES ALONE ─────────────────────────────────────────────────────
 *
 * Every file served from the root (.html, .js, .css), with comments stripped, as
 * app-name-parity.test.mjs does. It forbids the old LABEL: "Rest Day Worked" or "Rest day worked"
 * with a capital R, or "rest day worked" in brackets or after a dash. Lower-case prose — "a rest day
 * worked is paid at a different rate" — is an ordinary English noun phrase, and is left alone.
 *
 * Not functions/: the one use there is the roster-import prompt's vocabulary, read by a model, and
 * no push notification names RDW. Copy assembled at runtime from parts is beyond a source scan; the
 * anchors below pin the surfaces that matter by name.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Tests live in test/ but address files from the repository root (moved 24 Nov 2026).
const REPO_ROOT_URL = new URL('../', import.meta.url);

const read = (/** @type {string} */ f) => readFileSync(new URL(f, REPO_ROOT_URL), 'utf8');

/** Comments out, so a header (like this file's) may quote the old label. */
function code(/** @type {string} */ src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, ' ')
              .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
              .replace(/<!--[\s\S]*?-->/g, ' ');
}

/** The old label, in each of the three shapes it took on screen. */
const OLD_LABEL = /\bRest\s+(?:Day|day)\s+(?:Worked|worked)\b|\(\s*rest\s+day\s+worked\s*\)|[—–]\s*rest\s+day\s+worked\b/g;

const SERVED = readdirSync(new URL('.', REPO_ROOT_URL))
    .filter(f => /\.(html|js|css)$/.test(f) && !f.includes('.test.') && f !== 'purify.es.mjs');

describe('RDW is "Rest Day Working" everywhere a colleague reads it', () => {
    test('the guard can see each shape of the old label, and leaves prose alone', () => {
        // Guard the guard: a pattern that matched nothing would pass every file forever.
        for (const s of ['Rest Day Worked', 'Rest day worked', 'Induction (rest day worked)', 'Training — rest day worked']) {
            assert.ok(s.match(OLD_LABEL), `the pattern misses ${JSON.stringify(s)}`);
        }
        for (const s of ['a rest day worked is paid at 1.25×', 'Rest Day Working', 'Rest day working hours']) {
            assert.equal(s.match(OLD_LABEL), null, `the pattern wrongly flags ${JSON.stringify(s)}`);
        }
    });

    test('no served file labels RDW "Rest Day Worked"', () => {
        /** @type {string[]} */
        const offenders = [];
        for (const f of SERVED) {
            const src = code(read('./' + f));
            for (const m of src.matchAll(OLD_LABEL)) {
                offenders.push(`${f}: "${m[0]}"`);
            }
        }
        assert.deepEqual(offenders, [],
            'RDW is "Rest Day Working" (or "Rest day working" in sentence case) — one name for one '
            + 'payslip line:\n  ' + offenders.join('\n  '));
    });

    test('the surfaces that name RDW use the one name', () => {
        assert.match(read('./index.html'), /id="legend-rdw"[^\n]*<span class="legend-text">Rest Day Working<\/span>/,
            'the Calendar legend');
        assert.match(read('./admin-shift-types.js'), /rdw:\s*\{\s*label:\s*'Rest Day Working'/,
            'Admin\'s name for the type (Saved Changes, receipts)');
        assert.match(read('./calendar-renderer.js'), /if \(shift === 'RDW'\)\s+return 'Rest Day Working';/,
            'the Calendar day panel');
        assert.match(read('./paycalc.html'), /<div class="h-title"><span aria-hidden="true">💼<\/span> Rest Day Working<\/div>/,
            'the Pay Calculator row where the hours are typed');
        assert.match(read('./paycalc-help.js'), /RDW = Rest Day Working/, 'the Pay Calculator glossary');
        // Sentence case, as every entry in that key is ("Rest or off day", "Annual leave"). Title case
        // also wrapped the label onto a third line and printed the Staff Guide on a third sheet
        // (e2e/print.spec.js), which has a few pixels to spare.
        assert.match(read('./staff-guide.html'), /<span class="badge-desc">Rest day working \(overtime\)<\/span>/,
            'the Staff Guide badge key');
    });
});
