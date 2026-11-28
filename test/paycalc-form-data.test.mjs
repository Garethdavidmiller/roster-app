// @lane unit
/**
 * Unit tests for paycalc-form-data.js — the per-period form ↔ saved-data round trip.
 * Run: node --experimental-test-module-mocks scripts/run-tests.mjs test/paycalc-form-data.test.mjs
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

const { emptyPeriodData, readFormData, readOtherAdj, writeFormData, settingFieldsWrite, planSettingWrite, syncNoSpecialTick } = await import('../paycalc-form-data.js');

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
    _els.noSpecialCheck = makeField('value');
    // The tick's row, hidden by the CLASS (a `.toggle-row` sets display, which out-ranks `hidden`).
    const cls = new Set();
    _els.noSpecialRow = { classList: { toggle: (/** @type {string} */ c, /** @type {boolean} */ on) => { if (on) cls.add(c); else cls.delete(c); },
        contains: (/** @type {string} */ c) => cls.has(c) } };
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

    test('an hours box still holding a decimal is STORED as the split the blur would make', () => {
        // An autosave while "7.5" is focused (the app killed mid-edit, or a tap straight onto
        // another control) used to store parseInt's 7 — half an hour lost with nothing on screen
        // to say so. Stored as 7h 30m, exactly what the blur would have written back.
        _els.otH.value = '7.5'; _els.otM.value = '';
        _els.rdwH.value = '8'; _els.rdwM.value = '15';
        const d = readFormData();
        assert.equal(d.otH, 7);  assert.equal(d.otM, 30);
        assert.equal(d.rdwH, 8); assert.equal(d.rdwM, 15, 'a plain pair is untouched');
    });

    test('minutes SHOW two digits and still store the same number (polish round 2)', () => {
        // Display only: a restored 5 shows "05" (as a calendar fill does), a restored 0 stays BLANK
        // so the box's "00" placeholder shows through, and a filled "00" reads back as 0. The saved
        // object must be identical to what went in, and a second trip identical to the first.
        const saved = { ...emptyPeriodData(), rdwH: 16, rdwM: 0, otH: 7, otM: 5 };
        writeFormData(saved);
        assert.equal(_els.otM.value, '05', 'a single-digit minute shows its leading zero');
        assert.equal(_els.rdwM.value, '', 'a zero minute stays blank — the "00" placeholder shows');

        // A calendar fill of 16h writes "00" into the box — that is what the member sees.
        _els.rdwM.value = '00';
        const read = readFormData();
        assert.equal(read.rdwH, 16);
        assert.equal(read.rdwM, 0, '"00" must store the number 0');
        assert.equal(read.otM, 5, '"05" must store the number 5');
        const again = roundTrip(read);
        for (const k of Object.keys(saved)) {
            assert.deepEqual(again[k], read[k], `field "${k}" changed on a second trip`);
        }
    });

    test('an adjustment typed past the penny is STORED as the penny figure the box will show', () => {
        // 1.005 was stored as 1.005, came back as "1.00" (toFixed), and the next edit stored 1.00:
        // the figure changed on a trip through storage. Rounded on read, the trip is a fixed point.
        for (const [typed, neg, want] of [['1.005', false, 1], ['12.346', false, 12.35], ['7.999', true, -8]]) {
            _els.otherAdj.value = typed;
            const first = readFormData({ adjNegative: neg });
            assert.equal(first.otherAdj, want, `"${typed}" stored as ${first.otherAdj}`);
            assert.equal(readOtherAdj(neg), want, 'the price on screen takes the same figure');
            const again = roundTrip(first);
            assert.equal(again.otherAdj, first.otherAdj, `"${typed}" changed on a second trip`);
        }
    });

    test('a zero adjustment is not written as a spurious "0.00" string', () => {
        writeFormData({ ...emptyPeriodData(), otherAdj: 0 });
        assert.equal(_els.otherAdj.value, '', 'an empty adjustment field must stay visibly empty');
    });
});

// ── A PAYSLIP WITH NO SPECIAL-RATE HOURS (18 Nov 2026) ───────────────────────────────────────────
// Every hours box is a special rate and basic pay needs nothing typed, so such a payslip saved only
// zeros, which read as "not entered" — a Monday-to-Friday member's year could never be completed. The
// tick is its entry, and the round trip must carry it like any other field (invariant 2).
describe('the no-special-rate-hours tick', () => {
    test('a ticked payslip survives write → read, and counts as entered', async () => {
        const { isDataEmpty } = await import('../paycalc-format.js');
        const saved = { ...emptyPeriodData(), noSpecialHours: true };
        assert.equal(isDataEmpty(saved), false, 'the checked zeros are this payslip\'s entry');
        writeFormData(saved);
        assert.equal(_els.noSpecialCheck.checked, true, 'the saved tick is shown');
        // (`pension: null` is the blank box's "take the period default" — the schema has no key for it.)
        assert.deepEqual(readFormData(), { ...saved, pension: null }, 'and read back, unchanged');
        assert.equal(roundTrip(emptyPeriodData()).noSpecialHours, false, 'CONTROL: an unticked payslip stays unticked');
    });

    test('hours typed SUPERSEDE the tick: it is never stored beside them', () => {
        writeFormData({ ...emptyPeriodData(), noSpecialHours: true });
        _els.rdwH.value = '8';
        assert.equal(readFormData().noSpecialHours, false, 'a payslip cannot say "no special-rate hours" and hold 8 RDW');
        _els.rdwH.value = ''; _els.rdwM.value = '30';
        assert.equal(readFormData().noSpecialHours, false, 'minutes alone are hours too');
        _els.rdwM.value = '0';
        assert.equal(readFormData().noSpecialHours, true, 'a typed 0 is no hours — the tick still stands');
    });

    test('the tick shows only while no special-rate hours are on screen, and hours arriving clear it', () => {
        writeFormData({ ...emptyPeriodData(), noSpecialHours: true });
        syncNoSpecialTick();
        assert.equal(_els.noSpecialRow.classList.contains('hidden'), false, 'no hours: the tick is offered');
        assert.equal(_els.noSpecialCheck.checked, true);
        _els.sunH.value = '7';                 // typed, or the calendar's suggestion shown in gold
        syncNoSpecialTick();
        assert.equal(_els.noSpecialRow.classList.contains('hidden'), true, 'with hours on screen the tick goes');
        assert.equal(_els.noSpecialCheck.checked, false, 'and it is cleared, so it says what the next save stores');
        _els.sunH.value = '';
        syncNoSpecialTick();
        assert.equal(_els.noSpecialRow.classList.contains('hidden'), false, 'hours gone: offered again');
        assert.equal(_els.noSpecialCheck.checked, false, '…unticked — the hours superseded it');
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

    // A LOCKED BOX IS NOBODY'S FIGURE (17 Nov 2026). Inside an opt-out spell the box is disabled and
    // reads £0.00, equal to that payslip's default of £0 — so any edit stored null over the £140 the
    // member had typed, and correcting the opt-out date brought the scheme default back instead.
    test('a box LOCKED by the opt-out keeps the payslip\'s own saved figure — never the lock\'s £0.00', () => {
        _els.pensionAmt.value = '0.00';
        _els.pensionAmt.disabled = true;
        assert.equal(readFormData({ periodDefaultPension: 0, savedPension: 140 }).pension, 140,
            'the typed £140 was replaced by "the default"');
        assert.equal(readFormData({ periodDefaultPension: 0, savedPension: 0 }).pension, 0, 'a saved £0 opt-out stays a £0');
        assert.equal(readFormData({ periodDefaultPension: 0, savedPension: null }).pension, null,
            'a payslip that never held a figure still follows its default');
        _els.pensionAmt.disabled = false;
        _els.pensionAmt.value = '151.86';
        assert.equal(readFormData({ periodDefaultPension: 151.86, savedPension: 140 }).pension, null,
            'CONTROL: unlocked, the box is the figure — here the period default, stored as null');
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
        const { isDataEmpty } = await import('../paycalc-format.js');
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

// ── A SETTING CHANGE CARRIES ONLY ITS OWN FIELDS (whole-app review, Oct 2026) ──────────────────
// The loan plan and the pension scheme ran the payslip's autosave, which writes the WHOLE form: the
// calendar's display-only suggestion was saved as entered hours (invariant 11), and saved entries
// that could not be read were written over. `e2e/paycalc-entries.spec.js` drives both through the page.
describe('settingFieldsWrite — a setting change carries only its own fields', () => {
    const formNow = { ...emptyPeriodData(), satH: 8, satM: 30, slSkip: false, pension: null };

    test('only the named field moves; every saved figure stays as saved', () => {
        const raw = JSON.stringify({ ...emptyPeriodData(), satH: 7, slSkip: true, pension: 120 });
        assert.deepEqual(JSON.parse(/** @type {string} */ (settingFieldsWrite(raw, formNow, ['slSkip']))),
            { ...emptyPeriodData(), satH: 7, slSkip: false, pension: 120 });
    });

    test('a payslip with nothing saved stays unsaved — the form on screen may be a suggestion', () => {
        assert.equal(settingFieldsWrite(null, formNow, ['slSkip']), null);
        assert.equal(settingFieldsWrite('', formNow, ['pension']), null);
    });

    test('saved entries that cannot be read are never written over', () => {
        assert.equal(settingFieldsWrite('{not json', formNow, ['slSkip']), null);
        assert.equal(settingFieldsWrite('null', formNow, ['slSkip']), null);
        // Valid JSON of the wrong shape is damaged too (isSavedPeriodShape) — a list was spread into
        // a fresh record and written over the period.
        for (const raw of ['[]', '[1,2]', '"text"', '42']) {
            assert.equal(settingFieldsWrite(raw, formNow, ['slSkip']), null, `a period holding ${raw} was rewritten`);
        }
    });
});

// ── A SETTING'S WRITE MOVES THE MERGE'S BASE (28 Nov 2026) ─────────────────────────────────────
// The coordinator's `persistSetting` stored the setting and left the two-tab merge's base where the
// payslip was loaded, so the next typed save read this tab's OWN setting as another tab's and took it
// from storage. Driven here through the real merge (`planPeriodSave`), as the save runs it; the page
// half is e2e/paycalc-saving.spec.js ("a setting this tab saved is not mistaken for another tab's").
describe('planSettingWrite — the base a setting write leaves behind', () => {
    test('the loan skip, cleared by a setting and ticked again, saves TICKED (the reported case)', async () => {
        const { planPeriodSave } = await import('../paycalc-period-merge.js');
        const loaded = JSON.stringify({ ...emptyPeriodData(), satH: 3, slSkip: true });
        // Student Loan → None: the setting clears the skip and stores it.
        const cleared = { ...emptyPeriodData(), satH: 3, slSkip: false, pension: null };
        const s = planSettingWrite({ diskRaw: loaded, baseRaw: loaded, formNow: cleared, fields: ['slSkip'] });
        assert.equal(JSON.parse(/** @type {string} */ (s.write)).slSkip, false);
        assert.equal(s.base, s.write, 'no other tab wrote: the base is exactly what was stored');
        // A plan again, and the box ticked: the autosave merges against that base.
        const ticked = { ...cleared, slSkip: true };
        const plan = planPeriodSave({ base: { raw: s.base }, diskRaw: s.write, form: ticked });
        assert.equal(plan.kind, 'write');
        assert.equal(/** @type {any} */ (plan).data.slSkip, true, 'the tick was stored unticked');
        assert.deepEqual(/** @type {any} */ (plan).fromDisk, [], 'and the screen was unticked under "saved"');
    });

    test('another tab changing the setting back afterwards is kept, not written over', async () => {
        const { planPeriodSave } = await import('../paycalc-period-merge.js');
        const loaded = JSON.stringify({ ...emptyPeriodData(), satH: 3, slSkip: true });
        const formNow = { ...emptyPeriodData(), satH: 3, slSkip: false, pension: null };
        const s = planSettingWrite({ diskRaw: loaded, baseRaw: loaded, formNow, fields: ['slSkip'] });
        const other = JSON.stringify({ ...JSON.parse(/** @type {string} */ (s.write)), slSkip: true });   // the other tab ticks it
        const plan = planPeriodSave({ base: { raw: s.base }, diskRaw: other, form: { ...formNow, satH: 4 } });
        assert.equal(plan.kind, 'write');
        assert.equal(/** @type {any} */ (plan).data.slSkip, true, 'the other tab\'s tick was overwritten');
        assert.equal(/** @type {any} */ (plan).data.satH, 4);
        assert.deepEqual(/** @type {any} */ (plan).fromDisk, ['slSkip']);
    });

    test('figures another tab saved before the setting are NOT folded into the base', async () => {
        const { planPeriodSave } = await import('../paycalc-period-merge.js');
        const loaded = JSON.stringify({ ...emptyPeriodData(), satH: 3, slSkip: true });
        const disk = JSON.stringify({ ...emptyPeriodData(), satH: 8, slSkip: true });       // the other tab: Saturday 8h
        const formNow = { ...emptyPeriodData(), satH: 3, slSkip: false, pension: null };    // this screen still shows 3h
        const s = planSettingWrite({ diskRaw: disk, baseRaw: loaded, formNow, fields: ['slSkip'] });
        assert.deepEqual(JSON.parse(/** @type {string} */ (s.base)), { ...emptyPeriodData(), satH: 3, slSkip: false });
        const plan = planPeriodSave({ base: { raw: s.base }, diskRaw: s.write, form: { ...formNow, sunH: 2 } });
        assert.equal(/** @type {any} */ (plan).data.satH, 8, 'this screen\'s stale Saturday went over the other tab\'s');
    });

    test('nothing written leaves the base alone', () => {
        const formNow = { ...emptyPeriodData(), slSkip: false, pension: null };
        assert.deepEqual(planSettingWrite({ diskRaw: null, baseRaw: null, formNow, fields: ['slSkip'] }), { write: null, base: null });
        assert.deepEqual(planSettingWrite({ diskRaw: '{bad', baseRaw: '{bad', formNow, fields: ['slSkip'] }), { write: null, base: '{bad' });
    });
});

// ── WRITING ONLY SOME FIELDS (Nov 2026) ─────────────────────────────────────────────────────────
// A save merged with another tab's brings the form up to the figures it took from storage
// (paycalc-period-merge.js). It must touch only those boxes: rewriting the one being typed in would
// turn "7." into "7" under the member's cursor.
describe('writeFormData — `only` writes just the named fields', () => {
    test('the named fields are written; every other box keeps what it holds', () => {
        _els.satH.value = '7.'; _els.otherAdj.value = '1.5'; _els.actualTaxInput.value = '99';
        _els.peerVal.textContent = '2';
        writeFormData({ ...emptyPeriodData(), satH: 3, sunH: 5, sunM: 30, actualTax: 12, otherAdj: -2, peer: 0 },
            { only: new Set(['sunH', 'sunM', 'actualTax']) });
        assert.equal(_els.sunH.value, '5');
        assert.equal(_els.sunM.value, '30');
        assert.equal(_els.actualTaxInput.value, '12');
        assert.equal(_els.satH.value, '7.', 'the box being typed in is left alone');
        assert.equal(_els.otherAdj.value, '1.5');
        assert.equal(_els.peerVal.textContent, '2');
    });

    test('with no `only`, every field is written exactly as before', () => {
        _els.satH.value = '7.';
        writeFormData({ ...emptyPeriodData(), satH: 3 });
        assert.equal(_els.satH.value, '3');
    });
});
