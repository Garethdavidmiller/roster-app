/**
 * Parity tests for the pay-cutoff cycle that is DELIBERATELY duplicated across the ESM/CommonJS
 * boundary:
 *   - browser:   getPaydaysAndCutoffs() / isCutoffDate() in roster-data.js (driven by CONFIG.FIRST_PAYDAY
 *                + CONFIG.PAYDAY_INTERVAL_DAYS)
 *   - functions: isPayCutoffDay() in functions/roster-parse-helpers.js (hardcoded FIRST_PAYDAY_MS +
 *                INTERVAL_DAYS), used by the scheduled pay-reminder push.
 *
 * Cloud Functions are CommonJS and cannot import the browser ES module, so the anchor is copied.
 * The functions copy carried only a "must stay in sync" comment and NO test (unlike surname-parity) —
 * so a new-tax-year update to CONFIG.FIRST_PAYDAY/INTERVAL in roster-data.js would silently leave the
 * scheduled push firing the cutoff reminder on the WRONG Saturday (whole-codebase review, functions
 * finding #1). These tests fail loudly if the two ever drift:
 *   1. Source-equivalence — the functions anchor literals are DERIVED from CONFIG here, so editing the
 *      anchor in one place alone (the likely drift) breaks the build even though functions isn't
 *      importable as a browser module.
 *   2. Behavioural — isPayCutoffDay() must recognise every roster-data cutoff that sits on the pure
 *      28-day grid (i.e. weeks with no bank-holiday payday shift, which isPayCutoffDay deliberately
 *      does not model — a documented, separate divergence).
 *
 * Pure — no Firebase, no network. Run: node --test payday-cutoff-parity.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { isPayCutoffDay } = require('./functions/roster-parse-helpers.js');
const { CONFIG, getPaydaysAndCutoffs } = await import('./roster-data.js');

const DAY = 86_400_000;
const at = (/** @type {string} */ iso) => new Date(iso + 'T12:00:00'); // local-noon, matches the callers

describe('pay-cutoff cycle — browser ↔ functions parity', () => {
    test('functions anchor literals are still in sync with CONFIG (source-equivalence)', () => {
        const src = readFileSync(new URL('./functions/roster-parse-helpers.js', import.meta.url), 'utf8');
        const fp  = CONFIG.FIRST_PAYDAY;
        // functions uses `Date.UTC(<y>, <m>, <d>, 12, 0, 0)` mirroring CONFIG.FIRST_PAYDAY's y/m/d.
        const expectedAnchor = `Date.UTC(${fp.getFullYear()}, ${fp.getMonth()}, ${fp.getDate()}, 12`;
        assert.ok(src.includes(expectedAnchor),
            `isPayCutoffDay FIRST_PAYDAY_MS drifted from CONFIG.FIRST_PAYDAY — expected "${expectedAnchor}". ` +
            `Update FIRST_PAYDAY_MS in functions/roster-parse-helpers.js to match roster-data CONFIG.`);
        assert.ok(new RegExp(`INTERVAL_DAYS\\s*=\\s*${CONFIG.PAYDAY_INTERVAL_DAYS}\\b`).test(src),
            `isPayCutoffDay INTERVAL_DAYS drifted from CONFIG.PAYDAY_INTERVAL_DAYS (${CONFIG.PAYDAY_INTERVAL_DAYS}).`);
    });

    test('recognises the anchor cutoff and its ±28-day neighbours, rejects adjacent days', () => {
        // Anchor payday 13 Feb 2026 (Fri) → cutoff Sat 7 Feb 2026.
        assert.equal(isPayCutoffDay(at('2026-02-07')), true, 'anchor cutoff (7 Feb 2026)');
        assert.equal(isPayCutoffDay(at('2026-03-07')), true, 'anchor + 28 days');
        assert.equal(isPayCutoffDay(at('2026-01-10')), true, 'anchor − 28 days (the negative-diff cycle the fix restored)');
        assert.equal(isPayCutoffDay(at('2026-02-06')), false, 'day before the cutoff is not a cutoff');
        assert.equal(isPayCutoffDay(at('2026-02-08')), false, 'day after the cutoff is not a cutoff');
        assert.equal(isPayCutoffDay(at('2026-02-14')), false, 'the payday itself is not a cutoff');
    });

    test('isPayCutoffDay recognises every pure-grid cutoff roster-data produces (2026–2027)', () => {
        let checked = 0;
        for (const year of [2026, 2027]) {
            const { paydays, cutoffs } = getPaydaysAndCutoffs(year);
            cutoffs.forEach((/** @type {Date} */ cutoff, /** @type {number} */ i) => {
                const payday = paydays[i];
                // Skip weeks where a bank holiday shifted the payday off the pure 28-day grid: there the
                // real cutoff→payday gap is not the normal Friday-minus-Saturday 6 days, and isPayCutoffDay
                // (which does not model BH adjustment) is EXPECTED to disagree — a documented divergence,
                // not drift. A normal week: payday is a Friday exactly 6 days after its Saturday cutoff.
                const normalWeek = payday.getDay() === 5 && Math.round((+payday - +cutoff) / DAY) === 6;
                if (!normalWeek) return;
                checked++;
                assert.equal(isPayCutoffDay(cutoff), true,
                    `isPayCutoffDay missed a pure-grid cutoff ${cutoff.toDateString()} (payday ${payday.toDateString()}) ` +
                    `— the functions anchor/interval no longer matches roster-data's cycle.`);
            });
        }
        assert.ok(checked >= 20, `expected to exercise ≥20 pure-grid cutoffs across two years, only checked ${checked}`);
    });
});
