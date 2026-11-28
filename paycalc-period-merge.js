// @ts-check
/**
 * paycalc-period-merge.js — what a payslip's save may write when another tab has saved it too.
 *
 * Owns: the three-way merge of one payslip's saved entries (`planPeriodSave`) — the version this
 *   form was opened from (the BASE), what storage holds NOW (the DISK) and what the form says (the
 *   FORM) — and the question put to the member when the merge cannot decide (`periodSaveQuestion`).
 * Does NOT own: reading or writing storage, the dialog, or WHEN a save runs (paycalc-app.js's
 *   autosave), nor how a field is read from the form (paycalc-form-data.js). Pure: no DOM, no storage.
 * Edit here for: a new saved field's merge unit and plain-English name (`PERIOD_UNITS`).
 *
 * WHY IT EXISTS (Nov 2026). Every save wrote the whole form. Open one payslip in two tabs, change
 * Saturday in the first and Sunday in the second, and the second tab's save put its stale Saturday
 * back over the first tab's — "Entries saved" in both, and one change gone. A browser tab can sit
 * open for days, so this is ordinary use, not a race.
 *
 * THE RULE, per unit:
 *   - only this tab changed it since the base  → the form's value;
 *   - only the disk changed it                 → the disk's value (and the form is brought up to it);
 *   - both, to the same value                  → that value;
 *   - both, to different values                → a CONFLICT: nothing is written and the member is
 *                                                asked which to keep. Never a silent pick.
 * A payslip CLEARED elsewhere (base held entries, disk holds none) is asked about too: merging field
 * by field would write back a half of what the other tab deliberately removed, and dropping this tab's
 * edit would lose what the member just typed. Saved entries changed elsewhere into something
 * unreadable are asked about rather than overwritten. A disk still byte-identical to the base takes
 * the form exactly as it is — the single-tab path, unchanged.
 *
 * AN HOURS ROW IS ONE UNIT, not two fields. Merged field by field, 8h → 3h in one tab and
 * 8h → 8h 30m in the other wrote 3h 30m, a figure nobody typed.
 *
 * A CALENDAR SUGGESTION IS NOT AN EDIT. A gold box shows the calendar's figure without the member
 * having typed it (paycalc.md: viewing never saves). When storage has a figure there that another tab
 * TYPED, that figure wins over the suggestion, rather than being asked about as though this tab had
 * changed it.
 *
 * The storage `storage` event is only a prompt to pull the other tab's figures early: every save
 * checks the disk itself, because a tab can miss the event (asleep, discarded, or the other write
 * happened while this one was loading).
 */

import { HM_PAIRS } from './paycalc-format.js';
import { emptyPeriodData } from './paycalc-form-data.js';
import { isSavedPeriodShape } from './paycalc-inventory.js';

/**
 * One merge unit: the saved fields it spans, its plain-English name (the row's own title on the
 * page), and how its value is said aloud.
 * @typedef {{ id: string, fields: string[], label: string, kind: 'hours'|'money'|'pension'|'tick'|'days' }} PeriodUnit
 */

/** The row titles of the hours rows on paycalc.html, keyed by HM_PAIRS's `cat`. */
const HOURS_LABELS = /** @type {Record<string, string>} */ ({
    sat: 'Rostered Saturday', sun: 'Sunday Working', bh: 'Bank Holiday Rostered',
    bhOt: 'Bank Holiday Overtime', ot: 'Overtime', rdw: 'Rest Day Working', box: 'Boxing Day Working',
});

/**
 * Every saved field of a payslip, grouped into the units a merge decides. Each `readFormData` key
 * appears exactly once (paycalc-period-merge.test.mjs holds that), so a new saved field that is not
 * given a unit here fails a test instead of being silently dropped from a merged save.
 * @type {PeriodUnit[]}
 */
export const PERIOD_UNITS = [
    ...HM_PAIRS.map(({ cat, hId, mId }) => /** @type {PeriodUnit} */ ({ id: cat, fields: [hId, mId], label: HOURS_LABELS[cat], kind: 'hours' })),
    { id: 'peer',           fields: ['peer'],           label: 'Peer Training',                          kind: 'days' },
    { id: 'noSpecialHours', fields: ['noSpecialHours'], label: 'No special-rate hours on this payslip',  kind: 'tick' },
    { id: 'slSkip',         fields: ['slSkip'],         label: 'Student loan was not deducted on this payslip', kind: 'tick' },
    { id: 'otherAdj',       fields: ['otherAdj'],       label: 'Any other payslip adjustment',           kind: 'money' },
    { id: 'pension',        fields: ['pension'],        label: 'Pension contribution',                   kind: 'pension' },
    { id: 'actualNet',      fields: ['actualNet'],      label: 'Take-home on your payslip',              kind: 'money' },
    { id: 'actualGross',    fields: ['actualGross'],    label: 'Taxable Pay on your payslip',            kind: 'money' },
    { id: 'actualPension',  fields: ['actualPension'],  label: 'Pension on your payslip',                kind: 'money' },
    { id: 'actualTax',      fields: ['actualTax'],      label: 'Tax on your payslip',                    kind: 'money' },
    { id: 'actualNi',       fields: ['actualNi'],       label: 'National Insurance on your payslip',     kind: 'money' },
];

/** What an ABSENT key means, field by field — the saved schema itself (`emptyPeriodData`), never a
 *  copy of it, so a field added there cannot merge as 0: hours 0, ticks false, figures null. The
 *  pension, which the schema leaves out on purpose, reads null ("the period default"). */
const DEFAULTS = /** @type {Record<string, any>} */ ({ ...emptyPeriodData(), pension: null });

/** A field's value in a saved or read period, with an absent key read as its default.
 *  @param {Record<string, any>|null|undefined} d @param {string} f */
function _field(d, f) {
    const v = d?.[f];
    if (v !== undefined && v !== null) return v;
    return f in DEFAULTS ? DEFAULTS[f] : 0;   // a field the schema does not name (none today)
}

/** Do two periods agree on a unit? @param {PeriodUnit} u @param {any} a @param {any} b */
function _same(u, a, b) {
    return u.fields.every(f => _field(a, f) === _field(b, f));
}

/** @param {string|null} raw @returns {{ ok: boolean, data: Record<string, any>|null }} */
function _parse(raw) {
    if (raw === null) return { ok: true, data: null };
    try {
        const d = JSON.parse(raw);
        return isSavedPeriodShape(d) ? { ok: true, data: d } : { ok: false, data: null };   // the shared shape check
    } catch { return { ok: false, data: null }; }
}

/**
 * The stored payslip a form was last in step with: what storage held when the form was loaded, or
 * what this tab last wrote and read back. `raw` is the exact stored string (null for nothing stored).
 * @typedef {{ raw: string|null }} PeriodBase
 */

/**
 * One unit both tabs changed to different values.
 * @typedef {{ unit: PeriodUnit, mine: Record<string, any>, theirs: Record<string, any> }} PeriodConflict
 */

/**
 * What a save may do.
 *   - `write`: store `data`; `fromDisk` names the units taken from storage, which the form should be
 *     brought up to (empty on the single-tab path).
 *   - `conflict`: write nothing yet — ask. `mine` keeps this tab's values for the conflicting units,
 *     `theirs` keeps the stored ones; both carry every other unit merged.
 *   - `cleared`: the payslip was cleared elsewhere since the form was loaded — ask.
 *   - `unreadable`: what storage holds changed and cannot be read — ask before replacing it.
 * @typedef {{ kind: 'write', data: Record<string, any>, fromDisk: string[] }
 *         | { kind: 'conflict', mine: Record<string, any>, theirs: Record<string, any>, fromDisk: string[], conflicts: PeriodConflict[] }
 *         | { kind: 'cleared' }
 *         | { kind: 'unreadable' }} PeriodSavePlan
 */

/**
 * Plan a payslip's save: merge the form into what storage holds now, against the version the form
 * was opened from. Pure.
 * @param {object} a
 * @param {PeriodBase} a.base      the stored payslip the form was last in step with
 * @param {string|null} a.diskRaw  what storage holds for the payslip now (null for nothing)
 * @param {Record<string, any>} a.form  `readFormData`'s answer
 * @param {Set<string>} [a.suggested]   form fields showing the calendar's suggestion, not a typed figure
 * @returns {PeriodSavePlan}
 */
export function planPeriodSave({ base, diskRaw, form, suggested = new Set() }) {
    if (diskRaw === base.raw) return { kind: 'write', data: form, fromDisk: [] };
    const disk = _parse(diskRaw);
    if (!disk.ok) return { kind: 'unreadable' };
    const was = _parse(base.raw).data;   // an unreadable base was loaded as an empty form: compare against nothing
    if (disk.data === null) return was === null ? { kind: 'write', data: form, fromDisk: [] } : { kind: 'cleared' };
    /** @type {Record<string, any>} */ const merged = { ...form };
    /** @type {string[]} */ const fromDisk = [];
    /** @type {PeriodConflict[]} */ const conflicts = [];
    for (const u of PERIOD_UNITS) {
        const diskChanged = !_same(u, disk.data, was);
        if (!diskChanged) continue;                               // only this tab, or nobody: the form's
        const mineChanged = !_same(u, form, was) && !u.fields.some(f => suggested.has(f));
        if (!mineChanged) {                                        // only the other tab: storage's
            for (const f of u.fields) merged[f] = _field(disk.data, f);
            fromDisk.push(u.id);
        } else if (!_same(u, form, disk.data)) {                   // both, differently: ask
            conflicts.push({ unit: u,
                mine: Object.fromEntries(u.fields.map(f => [f, _field(form, f)])),
                theirs: Object.fromEntries(u.fields.map(f => [f, _field(disk.data, f)])) });
        }
    }
    if (!conflicts.length) return { kind: 'write', data: merged, fromDisk };
    const theirs = { ...merged };
    for (const c of conflicts) Object.assign(theirs, c.theirs);
    return { kind: 'conflict', mine: merged, theirs, fromDisk, conflicts };
}

/**
 * Has this tab changed anything since `base`? A calendar suggestion on screen is not a change.
 * The `storage` prompt asks it before showing a payslip another tab cleared: a form with nothing of
 * its own can follow the clear at once; one with edits waits for its next save, which asks.
 * @param {PeriodBase} base @param {Record<string, any>} form @param {Set<string>} [suggested]
 * @returns {boolean}
 */
export function formChangedSince(base, form, suggested = new Set()) {
    const was = _parse(base.raw).data;
    return PERIOD_UNITS.some(u => !_same(u, form, was) && !u.fields.some(f => suggested.has(f)));
}

/**
 * The units whose fields are in `fromDisk`, as a set of saved field names — what the form must be
 * brought up to after a merged write.
 * @param {string[]} unitIds @returns {Set<string>}
 */
export function fieldsOfUnits(unitIds) {
    return new Set(PERIOD_UNITS.filter(u => unitIds.includes(u.id)).flatMap(u => u.fields));
}

/** @param {number} n @param {string} one @param {string} many */
const _count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * A unit's value said plainly: "3 hrs 30 mins", "£12.50", "ticked", "the usual amount".
 * @param {PeriodUnit} u @param {Record<string, any>} v
 * @returns {string}
 */
export function unitValueText(u, v) {
    const x = _field(v, u.fields[0]);
    if (u.kind === 'hours') {
        const h = +x || 0, m = +_field(v, u.fields[1]) || 0;
        if (!h && !m) return 'none';
        return [h ? _count(h, 'hr', 'hrs') : '', m ? _count(m, 'min', 'mins') : ''].filter(Boolean).join(' ');
    }
    if (u.kind === 'tick') return x ? 'ticked' : 'not ticked';
    if (u.kind === 'days') return +x ? _count(+x, 'day', 'days') : 'none';
    if (u.kind === 'pension' && x === null) return 'the usual amount';
    if (x === null) return 'blank';
    const n = +x;
    if (u.id === 'otherAdj' && !n) return 'none';
    return `${n < 0 ? '−' : ''}£${Math.abs(n).toFixed(2)}`;
}

/**
 * The question for a plan that cannot be written without the member: its title, its message and
 * which answer each button gives. Confirm keeps what is on THIS screen; Cancel takes the other
 * tab's. Plain text (the dialog sets it as textContent).
 * @param {PeriodSavePlan} plan  a `conflict`, `cleared` or `unreadable` plan
 * @returns {{ title: string, message: string, confirmLabel: string, cancelLabel: string }}
 */
export function periodSaveQuestion(plan) {
    if (plan.kind === 'cleared') return {
        title: 'Cleared in another tab',
        message: 'This payslip\'s entries were cleared in another tab after this one opened it. '
            + 'Keep what is on this screen, or leave the payslip cleared?',
        confirmLabel: 'Keep this screen\'s', cancelLabel: 'Leave it cleared',
    };
    if (plan.kind === 'unreadable') return {
        title: 'Changed in another tab',
        message: 'This payslip\'s saved entries were changed in another tab, and this tab cannot read them. '
            + 'Replace them with what is on this screen?',
        confirmLabel: 'Replace them', cancelLabel: 'Not now',
    };
    if (plan.kind !== 'conflict') throw new Error('periodSaveQuestion: nothing to ask about a plain write');
    const say = (/** @type {PeriodConflict} */ c) =>
        `${c.unit.label}: ${unitValueText(c.unit, c.theirs)} in the other tab, ${unitValueText(c.unit, c.mine)} on this screen`;
    const lead = plan.conflicts.length === 1
        ? 'Another tab saved a different entry on this payslip after this one opened it. '
        : 'Another tab saved different entries on this payslip after this one opened it. ';
    return {
        title: 'Changed in another tab',
        message: lead + plan.conflicts.map(say).join('; ') + '. Which do you want to keep? '
            + 'Anything else either tab changed is kept.',
        confirmLabel: 'Keep this screen\'s', cancelLabel: 'Keep the other tab\'s',
    };
}
