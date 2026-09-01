/**
 * Unit tests for paycalc-form-data.js — the per-period form ↔ saved-data round trip.
 * Run: node --experimental-test-module-mocks --test paycalc-form-data.test.mjs
 *
 * WHY THIS FILE EXISTS. These ~70 lines produced FOUR money-affecting defects in four releases,
 * every one the same shape — a value the form could legitimately hold being persisted as something
 * it does not mean:
 *
 *   pre-v16.84  blank pension coerced to 0 by `|| 0` → an autosave during a transient blank stored
 *               a PERMANENT £0 and overstated take-home by ~£147 per period.
 *   v16.84      `numVal` floored garbage to 0, so a stray "." or "-" left mid-edit stored the same
 *               £0 "opt-out" — identical error, different input.
 *   v18.42      `actualNet` had the identical shape: a mid-edit autosave stored a phantom £0.
 *   v18.43      a pension equal to the period default must store as null, or the period freezes
 *               onto an old default and stops healing when the default changes.
 *
 * Every one was fixed by adding a COMMENT. None was covered by a test, because the logic sat inside
 * a 1,963-line coordinator with no seam to test through. The bug class is a round-trip asymmetry —
 * what read stores and what write restores drifting apart — which a write→read→write test catches
 * and a comment cannot. That, not the line count, is why the module exists.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { emptyPeriodData, readFormData, writeFormData } = await import('./paycalc-form-data.js');

// ── Minimal fake DOM: just the fields this module touches ─────────────────────
const INPUT_IDS = ['satH','satM','bhH','bhM','bhOtH','bhOtM','otH','otM','rdwH','rdwM',
                   'sunH','sunM','boxH','boxM','otherAdj','pensionAmt','actualNetInput',
                   'actualGrossInput','actualTaxInput','actualNiInput','actualPensionInput'];
/**
 * A field that coerces like the real thing. `HTMLInputElement.value` and `Node.textContent` are
 * DOMString-typed, so the platform stringifies whatever you assign — and writeFormData does assign
 * raw numbers (`pa.value = d.pension`). A naive `{ value: '' }` stub stores the number instead,
 * which made `readFormData`'s `.trim()` throw and reported a product bug that does not exist.
 * Model the coercion, or the harness invents failures — and can hide real ones just as easily.
 * @param {'value'|'textContent'} prop
 */
function makeField(prop, initial = '') {
    let v = String(initial);
    const el = { checked: false };
    Object.defineProperty(el, prop, {
        get: () => v, set: (x) => { v = String(x); }, enumerable: true, configurable: true,
    });
    return el;
}
let _els;
function setupDOM() {
    _els = {};
    INPUT_IDS.forEach(id => { _els[id] = makeField('value'); });
    _els.peerVal      = makeField('textContent', '0');
    _els.slSkipCheck  = makeField('value');
    global.document = { getElementById: id => _els[id] ?? null };
}
beforeEach(setupDOM);

/** Put a saved-period object into the form, then read it straight back out. */
function roundTrip(saved, readOpts = {}) {
    const { adjNegative } = writeFormData(saved);
    return readFormData({ adjNegative, ...readOpts });
}

describe('the saved-period schema', () => {
    test('emptyPeriodData deliberately carries NO pension key', () => {
        // An ABSENT key and an explicit null both mean "apply the period default" (writeFormData
        // only restores when `!= null`). Adding `pension: 0` here would re-introduce the pre-v16.84
        // defect for every cleared period — a permanent £0 salary-sacrifice opt-out nobody chose.
        assert.equal('pension' in emptyPeriodData(), false);
    });

    test('a blank form reads back as the empty schema (no phantom values)', () => {
        const d = readFormData();
        assert.equal(d.pension, null, 'blank pension must be null, never 0');
        assert.equal(d.actualNet, null, 'blank actual-net must be null, never 0');
        assert.equal(d.otherAdj, 0);
        assert.equal(d.satH, 0);
    });
});

describe('round trip — what is written must read back unchanged', () => {
    test('a fully-populated period survives write → read', () => {
        const saved = {
            satH: 7, satM: 30, bhH: 8, bhM: 0, bhOtH: 1, bhOtM: 15, otH: 2, otM: 45,
            rdwH: 9, rdwM: 5, sunH: 6, sunM: 20, boxH: 3, boxM: 40,
            peer: 4, slSkip: true, otherAdj: 12.34, pension: 99.99, actualNet: 1234.56,
        };
        const out = roundTrip(saved);
        for (const k of Object.keys(saved)) {
            assert.equal(out[k], saved[k], `field "${k}" did not survive the round trip`);
        }
    });

    test('every key the schema defines is produced by a read', () => {
        // Catches the asymmetry directly: a field added to the schema but never read back would be
        // silently dropped on the next autosave, quietly discarding whatever the user had entered.
        const produced = Object.keys(readFormData());
        const missing = Object.keys(emptyPeriodData()).filter(k => !produced.includes(k));
        assert.deepEqual(missing, [],
            `the schema declares ${missing.join(', ')} but readFormData never produces it — an ` +
            'autosave would drop the field');
    });

    test('a NEGATIVE adjustment keeps its sign through the trip', () => {
        // The sign lives outside the value (the form holds a magnitude + a ± button), so this is
        // exactly where a sign can be silently lost.
        const out = roundTrip({ ...emptyPeriodData(), otherAdj: -45.5 });
        assert.equal(out.otherAdj, -45.5);
    });

    test('a zero adjustment is not written as a spurious "0.00" string', () => {
        writeFormData({ ...emptyPeriodData(), otherAdj: 0 });
        assert.equal(_els.otherAdj.value, '', 'an empty adjustment field must stay visibly empty');
    });
});

describe('pension — the field behind three of the four defects', () => {
    test('a BLANK field stores null, never 0 (pre-v16.84)', () => {
        _els.pensionAmt.value = '';
        assert.equal(readFormData().pension, null,
            'a transient blank during an autosave must not become a permanent £0 opt-out');
    });

    test('GARBAGE stores null, never 0 (v16.84)', () => {
        for (const junk of ['.', '-', '-.', 'abc']) {
            _els.pensionAmt.value = junk;
            assert.equal(readFormData().pension, null,
                `"${junk}" left mid-edit must not persist as a real £0 opt-out`);
        }
    });

    test('a genuinely typed 0 IS preserved — it is a real opt-out', () => {
        _els.pensionAmt.value = '0';
        assert.equal(readFormData().pension, 0,
            'salary-sacrifice opt-out is a real choice and must survive; only blank/garbage is null');
    });

    test('a value EQUAL to the period default stores as null, so the period keeps healing (v18.43)', () => {
        _els.pensionAmt.value = '147.36';
        assert.equal(readFormData({ periodDefaultPension: 147.36 }).pension, null);
    });

    test('a value that DIFFERS from the default persists as custom', () => {
        _els.pensionAmt.value = '200.00';
        assert.equal(readFormData({ periodDefaultPension: 147.36 }).pension, 200);
    });

    test('the default match is a tolerance, not an exact compare (±0.005)', () => {
        _els.pensionAmt.value = '147.36';
        assert.equal(readFormData({ periodDefaultPension: 147.363 }).pension, null,
            'inside tolerance → still the default');
        assert.equal(readFormData({ periodDefaultPension: 147.40 }).pension, 147.36,
            'outside tolerance → a custom value the member chose');
    });

    test('with NO period default supplied the self-heal is skipped, not misapplied', () => {
        // Mirrors the old inline behaviour when no period object was found.
        _els.pensionAmt.value = '147.36';
        assert.equal(readFormData().pension, 147.36);
    });

    test('write restores a saved 0 but leaves the field ALONE when the value is null', () => {
        _els.pensionAmt.value = 'untouched';
        writeFormData({ ...emptyPeriodData(), pension: null });
        assert.equal(_els.pensionAmt.value, 'untouched',
            'null means "caller applies the period default" — write must not blank it first');

        writeFormData({ ...emptyPeriodData(), pension: 0 });
        assert.equal(_els.pensionAmt.value, '0',
            'a stored 0 is a real opt-out and must be restored (as the DOMString the platform coerces it to)');
    });
});

describe('actualNet — the same shape, found later (v18.42)', () => {
    test('blank and garbage both store null, never a phantom £0', () => {
        for (const v of ['', '  ', '.', '-']) {
            _els.actualNetInput.value = v;
            assert.equal(readFormData().actualNet, null, `"${v}" must not persist as £0 take-home`);
        }
    });

    test('a real figure survives, and a typed 0 is kept', () => {
        _els.actualNetInput.value = '1234.56';
        assert.equal(readFormData().actualNet, 1234.56);
        _els.actualNetInput.value = '0';
        assert.equal(readFormData().actualNet, 0);
    });
});

// ── The other payslip lines (v22.07) — actualNet's shape, four more times ──────────────────────
describe('payslip-actual lines — the phantom-£0 rule holds for every one of them', () => {
    const KEYS = /** @type {const} */ ([
        ['actualGross', 'actualGrossInput'], ['actualTax', 'actualTaxInput'],
        ['actualNi', 'actualNiInput'], ['actualPension', 'actualPensionInput'],
    ]);

    test('blank reads as null on every line — a mid-edit autosave must not store a £0 actual', () => {
        const d = readFormData();
        for (const [key] of KEYS) assert.equal(d[key], null, key);
    });

    test('typed figures round-trip exactly, and garbage collapses to null rather than 0', () => {
        const saved = { ...emptyPeriodData(), actualGross: 3808.87, actualTax: 540.20, actualNi: 215.48, actualPension: 151.86 };
        const d = roundTrip(saved);
        for (const [key] of KEYS) assert.equal(d[key], saved[key], key);
        _els.actualTaxInput.value = 'not money';
        assert.equal(readFormData().actualTax, null);
    });

    test('a period with only payslip actuals still counts as EMPTY — they are checks, not entries', async () => {
        const { isDataEmpty } = await import('./paycalc-format.js');
        assert.equal(isDataEmpty({ ...emptyPeriodData(), actualGross: 3808.87, actualNet: 2907.23 }), true,
            'actuals must not make a period look entered — the fill-year eligibility reads this');
    });

    test('restoring saved actuals OPENS the disclosure; a period without them leaves it alone', () => {
        const btn = { attrs: /** @type {Record<string, string>} */ ({}),
            setAttribute(/** @type {string} */ k, /** @type {string} */ v) { this.attrs[k] = v; },
            getAttribute(/** @type {string} */ k) { return this.attrs[k]; } };
        const wrap = { hidden: true };
        _els.actualMoreBtn = btn; _els.actualMoreWrap = wrap;
        writeFormData({ ...emptyPeriodData(), actualGross: 3808.87 });
        assert.equal(wrap.hidden, false, 'saved figures must not restore into a closed section');
        assert.equal(btn.attrs['aria-expanded'], 'true');
        wrap.hidden = true; btn.attrs['aria-expanded'] = 'false';
        writeFormData(emptyPeriodData());
        assert.equal(wrap.hidden, true, 'no actuals → the member\'s own open/closed choice stands');
    });
});
