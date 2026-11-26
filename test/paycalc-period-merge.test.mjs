// @lane unit
/**
 * Unit tests for paycalc-period-merge.js — what a payslip's save may write when another tab saved it.
 * Run: node scripts/run-tests.mjs test/paycalc-period-merge.test.mjs
 *
 * The defect (Nov 2026): every save wrote the whole form, so two tabs on one payslip each wrote their
 * stale copy of the other's figures back — "Entries saved" in both, and one change gone. The merge is
 * three-way (base, disk, form) per UNIT; the browser half — two pages, one payslip — is
 * e2e/paycalc-saving.spec.js.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { planPeriodSave, periodSaveQuestion, formChangedSince, fieldsOfUnits, unitValueText, PERIOD_UNITS } from '../paycalc-period-merge.js';
import { emptyPeriodData } from '../paycalc-form-data.js';

/** A saved/read period: the empty schema with `over` on top. @param {Record<string, any>} [over] */
const period = (over = {}) => ({ ...emptyPeriodData(), pension: null, ...over });
/** The base a form was opened from. @param {Record<string, any>|null} d */
const base = (d) => ({ raw: d === null ? null : JSON.stringify(d) });
/** @param {Record<string, any>|null} d */
const raw = (d) => (d === null ? null : JSON.stringify(d));

describe('one tab — the ordinary save is unchanged', () => {
    test('storage still holds what the form was opened from: the form is written exactly as it is', () => {
        const was = period({ satH: 8 });
        const form = period({ satH: 3, otherAdj: 5 });
        const plan = planPeriodSave({ base: base(was), diskRaw: raw(was), form });
        assert.equal(plan.kind, 'write');
        assert.equal(/** @type {any} */ (plan).data, form, 'the very form object, not a merge of it');
        assert.deepEqual(/** @type {any} */ (plan).fromDisk, []);
    });

    test('a payslip nobody has saved stays a plain write', () => {
        const plan = planPeriodSave({ base: base(null), diskRaw: null, form: period({ sunH: 4 }) });
        assert.equal(plan.kind, 'write');
    });
});

describe('two tabs — the three-way merge', () => {
    test('different rows: this tab\'s Sunday and the other tab\'s Saturday both survive (the reported case)', () => {
        const was = period({ satH: 8 });
        const disk = { ...was, satH: 3 };                 // tab A saved Saturday 8h → 3h
        const form = period({ satH: 8, sunH: 5 });        // tab B, still showing 8h, typed Sunday 5h
        const plan = /** @type {any} */ (planPeriodSave({ base: base(was), diskRaw: raw(disk), form }));
        assert.equal(plan.kind, 'write');
        assert.equal(plan.data.satH, 3, 'the other tab\'s Saturday is kept, not the stale form\'s');
        assert.equal(plan.data.sunH, 5, 'this tab\'s Sunday is written');
        assert.deepEqual(plan.fromDisk, ['sat'], 'the form is told which rows to bring up to storage');
    });

    test('the same row changed to DIFFERENT figures is a conflict: nothing is picked silently', () => {
        const was = period({ satH: 8 });
        const disk = { ...was, satH: 3, sunH: 2 };
        const form = period({ satH: 6 });
        const plan = /** @type {any} */ (planPeriodSave({ base: base(was), diskRaw: raw(disk), form }));
        assert.equal(plan.kind, 'conflict');
        assert.deepEqual(plan.conflicts.map((/** @type {any} */ c) => c.unit.id), ['sat']);
        assert.equal(plan.mine.satH, 6, 'keep-mine keeps this screen\'s Saturday');
        assert.equal(plan.theirs.satH, 3, 'keep-theirs keeps the stored Saturday');
        assert.equal(plan.mine.sunH, 2, 'either answer keeps the other tab\'s Sunday');
        assert.equal(plan.theirs.sunH, 2);
        assert.deepEqual(plan.fromDisk, ['sun']);
    });

    test('the same row changed to the SAME figure is no conflict', () => {
        const was = period({ satH: 8 });
        const plan = planPeriodSave({ base: base(was), diskRaw: raw({ ...was, satH: 3 }), form: period({ satH: 3 }) });
        assert.equal(plan.kind, 'write');
    });

    test('an hours row is ONE unit: 3h in one tab and 8h 30m in the other never writes 3h 30m', () => {
        const was = period({ satH: 8, satM: 0 });
        const plan = /** @type {any} */ (planPeriodSave({ base: base(was), diskRaw: raw({ ...was, satM: 30 }), form: period({ satH: 3, satM: 0 }) }));
        assert.equal(plan.kind, 'conflict', 'field by field this merged to a figure nobody typed');
    });

    test('a calendar suggestion on screen is not an edit: a figure another tab typed wins over it', () => {
        const disk = period({ satH: 3 });                 // nothing was saved when this tab opened it
        const form = period({ satH: 8, sunH: 5 });        // satH is the calendar's gold suggestion
        const plan = /** @type {any} */ (planPeriodSave({ base: base(null), diskRaw: raw(disk), form, suggested: new Set(['satH', 'satM']) }));
        assert.equal(plan.kind, 'write');
        assert.equal(plan.data.satH, 3);
        assert.equal(plan.data.sunH, 5);
    });

    test('…and the same row TYPED in this tab is a conflict', () => {
        const plan = planPeriodSave({ base: base(null), diskRaw: raw(period({ satH: 3 })), form: period({ satH: 8 }) });
        assert.equal(plan.kind, 'conflict');
    });

    test('an absent key reads as its default, so an older save missing a field is not a change', () => {
        const was = { satH: 8 };                          // written before the payslip-actual lines existed
        const plan = planPeriodSave({ base: base(was), diskRaw: raw({ ...period({ satH: 8 }), sunH: 1 }), form: period({ satH: 8 }) });
        assert.equal(plan.kind, 'write');
        assert.deepEqual(/** @type {any} */ (plan).fromDisk, ['sun']);
    });

    test('every saved field, and the pension, belongs to exactly one unit — a new field cannot be dropped', () => {
        const fields = PERIOD_UNITS.flatMap(u => u.fields);
        assert.equal(new Set(fields).size, fields.length, 'a field in two units');
        assert.deepEqual([...fields].sort(), [...Object.keys(emptyPeriodData()), 'pension'].sort());
    });

    test('a ticked box, a pension and a payslip line merge like hours', () => {
        const was = period({ slSkip: false, pension: null, actualNet: null });
        const disk = { ...was, slSkip: true, actualNet: 1500 };
        const plan = /** @type {any} */ (planPeriodSave({ base: base(was), diskRaw: raw(disk), form: period({ pension: 0 }) }));
        assert.equal(plan.kind, 'write');
        assert.deepEqual(plan.data, period({ slSkip: true, actualNet: 1500, pension: 0 }));
        assert.deepEqual(fieldsOfUnits(plan.fromDisk), new Set(['slSkip', 'actualNet']));
    });
});

describe('a clear, and damage, made in another tab', () => {
    test('a payslip cleared elsewhere is asked about — neither resurrected nor merged half-back', () => {
        const was = period({ satH: 8 });
        assert.equal(planPeriodSave({ base: base(was), diskRaw: null, form: period({ satH: 8, sunH: 5 }) }).kind, 'cleared');
    });

    test('saved entries changed into something unreadable are asked about before being replaced', () => {
        assert.equal(planPeriodSave({ base: base(period()), diskRaw: '{not json', form: period({ sunH: 1 }) }).kind, 'unreadable');
    });

    test('entries this tab LOADED unreadable are replaced by typing, as the warning on screen promised', () => {
        const plan = planPeriodSave({ base: { raw: '{not json' }, diskRaw: '{not json', form: period({ sunH: 1 }) });
        assert.equal(plan.kind, 'write');
    });

    test('formChangedSince: a form with nothing of its own can follow the clear at once', () => {
        const was = period({ satH: 8 });
        assert.equal(formChangedSince(base(was), period({ satH: 8 })), false);
        assert.equal(formChangedSince(base(was), period({ satH: 8, sunH: 1 })), true);
        assert.equal(formChangedSince(base(null), period({ satH: 8 }), new Set(['satH'])), false, 'a suggestion is not an edit');
    });
});

describe('the question — plain UK English, naming the row and both figures', () => {
    const was = period({ satH: 8 });
    const one = planPeriodSave({ base: base(was), diskRaw: raw({ ...was, satH: 3 }), form: period({ satH: 6 }) });
    const two = planPeriodSave({ base: base(was), diskRaw: raw({ ...was, satH: 3, otherAdj: -12.5 }), form: period({ satH: 6, otherAdj: 4 }) });

    test('one row', () => {
        assert.deepEqual(periodSaveQuestion(one), {
            title: 'Changed in another tab',
            message: 'Another tab saved a different entry on this payslip after this one opened it. '
                + 'Rostered Saturday: 3 hrs in the other tab, 6 hrs on this screen. Which do you want to keep? '
                + 'Anything else either tab changed is kept.',
            confirmLabel: 'Keep this screen\'s', cancelLabel: 'Keep the other tab\'s',
        });
    });

    test('two rows, each with both figures', () => {
        assert.match(periodSaveQuestion(two).message,
            /^Another tab saved different entries .*Rostered Saturday: 3 hrs in the other tab, 6 hrs on this screen; Any other payslip adjustment: −£12\.50 in the other tab, £4\.00 on this screen\. /);
    });

    test('a clear and damage have their own question; a plain write has none', () => {
        assert.equal(periodSaveQuestion({ kind: 'cleared' }).cancelLabel, 'Leave it cleared');
        assert.equal(periodSaveQuestion({ kind: 'unreadable' }).confirmLabel, 'Replace them');
        assert.throws(() => periodSaveQuestion({ kind: 'write', data: {}, fromDisk: [] }));
    });

    test('calm: no exclamation marks, no "override"', () => {
        for (const q of [one, two, { kind: 'cleared' }, { kind: 'unreadable' }].map(p => periodSaveQuestion(/** @type {any} */ (p)))) {
            assert.doesNotMatch(Object.values(q).join(' '), /!|override/i);
        }
    });

    test('values said plainly', () => {
        const sat = PERIOD_UNITS[0], tick = /** @type {any} */ (PERIOD_UNITS.find(u => u.id === 'slSkip'));
        const pen = /** @type {any} */ (PERIOD_UNITS.find(u => u.id === 'pension'));
        assert.equal(unitValueText(sat, { satH: 1, satM: 30 }), '1 hr 30 mins');
        assert.equal(unitValueText(sat, { satH: 0, satM: 1 }), '1 min');
        assert.equal(unitValueText(sat, {}), 'none');
        assert.equal(unitValueText(tick, { slSkip: true }), 'ticked');
        assert.equal(unitValueText(pen, { pension: null }), 'the usual amount');
        assert.equal(unitValueText(pen, { pension: 0 }), '£0.00');
    });
});
