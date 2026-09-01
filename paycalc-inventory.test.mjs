// @ts-check
/**
 * paycalc-inventory.test.mjs — what a stored pay key IS, and what a set of them adds up to.
 *
 * ORGANISED BY WHAT A WRONG ANSWER COSTS, not by function.
 *
 * This module replaced a hand-written regex that named five of the nine per-tax-year key types.
 * Nothing failed: the count on the "Move Your Pay Data" card was simply SMALLER than the truth, on
 * the one surface whose entire job is to tell a member what they are about to carry to a new phone.
 * So the two directions are:
 *
 *   UNDER-REPORTING — a real thing goes unnamed. Silent, and it is the shipped defect: a member
 *     decides "my old tax year isn't in there" and re-enters figures they already had, or worse,
 *     believes a backup is fuller than it is because the missing kind was the one they cared about.
 *
 *   OVER-REPORTING — a thing named that is not there, or damage claimed where there is none. Loud
 *     and correctable, but it teaches the member to distrust the card, after which the inventory
 *     is decoration.
 *
 * Contract 1 is the important one and is not a unit test at all: it drives the REAL key builders
 * out of the source tree and asserts every key they produce lands on a known kind. A hand-written
 * table checked by a hand-written test would reproduce exactly the defect this module exists to end.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import {
    KEY_KINDS, classifyPayKey, inventoryOf, inventoryLines, damagedEntries, describePayKey,
} from './paycalc-inventory.js';

const P = 'myb_pc_gmiller_';
const k = (/** @type {string} */ tail) => P + tail;

// ── CONTRACT 1: THE CLASSIFIER KNOWS EVERY KEY THE APP ACTUALLY BUILDS ──────────────────────────
//
// Read from SOURCE rather than by importing, because two of the three modules that build pay keys
// (paycalc-settings.js, paycalc-roster-hint.js) reach the gstatic Firebase SDK through their own
// imports and cannot load in Node at all. Scanning the tree is also the STRONGER check: it sees a
// key builder added in a module that does not exist yet, which an import list cannot.

/** Every `${pcPrefix()}…` / `${p}…` template literal in the tree, as key TAILS. */
function builtKeyTails() {
    const files = readdirSync('.').filter(f => f.endsWith('.js') && !f.endsWith('.test.mjs'));
    const re = /`\$\{(?:pcPrefix\(\)|p)\}([^`]*)`/g;
    /** @type {Map<string,string>} */
    const found = new Map();
    for (const f of files) {
        const src = readFileSync(f, 'utf8');
        let m;
        while ((m = re.exec(src))) found.set(m[1], f);
    }
    return found;
}

/** Turn a template tail into a concrete example key: `hpp_est_${ty.label…}` → `hpp_est_2026_27`. */
function concrete(/** @type {string} */ tail) {
    // A `label` interpolation is a tax year; anything else in a paycalc key is a period number.
    return tail.replace(/\$\{[^}]*\}/g, (expr) => (/label|_yr/.test(expr) ? '2026_27' : '16'));
}

describe('the classifier knows every key the app builds', () => {
    test('every key builder in the tree produces a recognised kind', () => {
        const found = builtKeyTails();
        // The scan itself must keep working. If the template shape ever changes, this number is
        // what turns a silently-empty scan into a failure instead of a pass.
        assert.ok(found.size >= 25, `the key-builder scan found only ${found.size} tails — has the template shape changed?`);

        /** @type {string[]} */
        const unknown = [];
        for (const [tail, file] of found) {
            const example = concrete(tail);
            assert.ok(!example.includes('$'), `could not build an example key from ${tail} (${file})`);
            if (classifyPayKey(example).kind === 'unknown') unknown.push(`${example} (built in ${file})`);
        }
        assert.deepEqual(unknown, [], 'these keys the app writes are not classified — add them to KEY_KINDS');
    });

    test('every per-tax-year key builder yields a readable tax year', () => {
        // The original defect in one assertion: a key can be recognised and still not surrender its
        // year, which is exactly how `hpp_actual` and `setup_<year>` went missing from the count.
        const perYear = [...builtKeyTails().keys()]
            .filter(t => /label|_yr/.test(t))
            .map(concrete);
        assert.ok(perYear.length >= 9, `expected at least nine per-year key builders, found ${perYear.length}`);
        for (const key of perYear) {
            assert.equal(classifyPayKey(key).taxYear, '2026/27', `${key} did not yield its tax year`);
        }
    });
});

// ── UNDER-REPORTING: a real thing goes unnamed ─────────────────────────────────────────────────

describe('under-reporting', () => {
    test('a tax year known only by a setup, an HPP actual or a YTD source still counts', () => {
        // Each of these four was invisible to the pre-v22.14 regex. One key per year, one year each.
        for (const tail of ['setup_2024_25', 'hpp_actual_2024_25', 'hpp_inc_2024_25', 'ytd_src_2024_25']) {
            const inv = inventoryOf([k(tail)], P);
            assert.deepEqual(inv.taxYears, ['2024/25'], `${tail} did not report its tax year`);
        }
    });

    test('every tax year present is named, not counted', () => {
        const inv = inventoryOf(['setup_2024_25', 'bp_state_2025_26', 'hpp_mode_2026_27'].map(k), P);
        assert.deepEqual(inv.taxYears, ['2024/25', '2025/26', '2026/27']);
        assert.ok(inventoryLines(inv).some(l => l === 'Tax years 2024/25, 2025/26 and 2026/27'),
            'three years must read as a list, not "a and b and c"');
    });

    test('a key this version has never heard of is carried and SAID, never dropped', () => {
        const inv = inventoryOf([k('p16'), k('brass_2027_28')], P);
        assert.equal(inv.unknown, 1);
        assert.equal(inv.keys, 2, 'an unrecognised key still counts toward what is being carried');
        assert.ok(inventoryLines(inv).some(l => /does not recognise/.test(l) && /carried across unchanged/.test(l)));
    });

    test('the whole namespace is described, not just payslips', () => {
        const keys = ['p16', 'bp_state_2026_27', 'ytd_pay_2026_27', 'pension_timeline', 'actuals', 'rate'].map(k);
        const lines = inventoryLines(inventoryOf(keys, P));
        for (const expected of ['Back pay', 'Year to Date figures', 'Pension', 'Payslip comparison', 'Your settings']) {
            assert.ok(lines.includes(expected), `"${expected}" was not named — it used to hide inside "plus your settings"`);
        }
    });

    test('a damaged payslip is named by name, not by storage key', () => {
        const bad = damagedEntries({ [k('p16')]: '{"satH":1', [k('p17')]: '{}' }, P);
        assert.equal(bad.length, 1);
        assert.equal(bad[0].label, 'payslip 16');
        assert.ok(!bad[0].label.includes('myb_pc_'), 'a member is never shown a storage key');
    });
});

// ── OVER-REPORTING: a thing named that is not there ────────────────────────────────────────────

describe('over-reporting', () => {
    test('a scalar value is never JSON-parsed, so a healthy device is never called damaged', () => {
        // `code` holds `1257L` and `rate` holds `21.49`; neither is JSON. Parsing them to look for
        // damage would report every member in the app as corrupt.
        const entries = { [k('code')]: '1257L', [k('rate')]: '21.49', [k('sl')]: 'plan2', [k('ytd_pay_2026_27')]: '21758.94' };
        assert.deepEqual(damagedEntries(entries, P), []);
    });

    test('only entries the table declares structured are ever parsed', () => {
        // Per KEY, not per kind: `pension` is a MIXED kind — an amount and a retired boolean that
        // are plain scalars, plus `pension_timeline`, which is a JSON array. Asserting at kind
        // level would pass with the timeline unchecked or the amount wrongly parsed.
        const tails = ['p16', 'snap_16', 'bp_state_2026_27', 'actuals', 'pension_timeline',
                       'code', 'rate', 'grade', 'hpp_est_2026_27', 'ytd_tax_2026_27',
                       'pension', 'pension_optout', 'setup_2026_27'];
        const entries = Object.fromEntries(tails.map(t => [k(t), 'definitely not json']));
        const flagged = new Set(damagedEntries(entries, P).map(d => d.tail));
        const declared = tails.filter(t => classifyPayKey(t).structured);
        assert.deepEqual([...flagged].sort(), declared.sort(),
            'the parsed set must be exactly the structured set — no more, no fewer');
        // …and the table itself must be right about the mixed kind, or the line above is circular.
        assert.equal(classifyPayKey('pension_timeline').structured, true, 'a JSON timeline must be checked');
        assert.equal(classifyPayKey('pension').structured, false, 'a pension AMOUNT is not JSON');
    });

    test('setup_years_migrated is not a tax year, and ytd_pay is not ytd_pay_2026_27', () => {
        // Three near-misses in one assertion, and this is the case that pins RULE 3. What keeps
        // them apart is the `\d{4}_\d{2}$` inside each KIND's own test — mutating that to
        // `setup_.+` fails here. The end-anchor in `taxYearOf` looks like the guard and is not:
        // removing it passes everything, because no key in today's vocabulary has anything after
        // its year. Worth knowing before anyone "simplifies" the kind tests trusting that anchor.
        assert.equal(classifyPayKey('setup_years_migrated').taxYear, '');
        assert.equal(classifyPayKey('setup_years_migrated').kind, 'settings');
        assert.equal(classifyPayKey('ytd_pay').taxYear, '');
        assert.equal(classifyPayKey('ytd_pay_2026_27').taxYear, '2026/27');
    });

    test('an empty namespace claims nothing', () => {
        const inv = inventoryOf([], P);
        assert.deepEqual(inv, { periods: 0, taxYears: [], groups: [], unknown: 0, keys: 0 });
        assert.deepEqual(inventoryLines(inv), []);
    });

    test('payslip counts are stated once, in their own words', () => {
        // The list must not carry both "2 payslips of entered figures" and a second "Payslip
        // figures" group row saying the same thing again.
        const lines = inventoryLines(inventoryOf([k('p16'), k('p17')], P));
        assert.deepEqual(lines, ['2 payslips of entered figures']);
    });

    test('one payslip and one tax year read as singular', () => {
        const lines = inventoryLines(inventoryOf([k('p16'), k('bp_state_2026_27')], P));
        assert.ok(lines.includes('1 payslip of entered figures'));
        assert.ok(lines.includes('Tax year 2026/27'));
    });
});

// ── NAMING ─────────────────────────────────────────────────────────────────────────────────────

describe('naming an entry', () => {
    test('each kind describes itself the way a message about it should read', () => {
        assert.equal(describePayKey('p16'), 'payslip 16');
        assert.equal(describePayKey('snap_16'), 'roster-suggested figures for payslip 16');
        assert.equal(describePayKey('bp_state_2026_27'), 'back pay 2026/27');
        assert.equal(describePayKey('bp_state'), 'back pay');
        assert.equal(describePayKey('actuals'), 'payslip comparison');
        assert.equal(describePayKey('hpp_est_2025_26'), 'Holiday Pay Premium 2025/26');
        assert.equal(describePayKey('pension_timeline'), 'your pension history');
    });
});
