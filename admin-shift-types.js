// @ts-check
/**
 * admin-shift-types.js — the shift-type table the Change-a-Shift surface is built from.
 *
 * ── WHY IT IS ITS OWN MODULE (v21.38) ───────────────────────────────────────────────────────────
 *
 * `TYPES` and `PILL_TYPES` are read by the week editor (which draws a pill per entry), the Saved
 * Changes list (which labels a row from it), the save receipt, and `admin-app.js` (which builds the
 * bulk bar from it). Splitting the first two out of `admin-overrides.js` would have made every one
 * of them import the coordinator back — a cycle, which `import-graph.test.mjs` refuses.
 *
 * So the table moved to where nothing depends on anything: pure data, no imports, no DOM. That is
 * also the honest home for it. It is not the coordinator's private state; it is the vocabulary the
 * whole feature speaks.
 *
 * **`PILL_TYPES` remains the ONE declaration of which pills exist and in what order.** Both pill
 * rows are generated from it — the per-row grid in the week editor and the bulk bar in
 * `admin-app.js` — and neither may restate the list. That rule predates this move (v13.48) and is
 * the reason the arrays live together rather than beside their renderers.
 */

/** @type {Record<string, any>} */
export const TYPES = {
    spare_shift:  { label: 'Spare shift',      pill: 'Spare',    fixed: true,  fixedValue: 'SPARE' },
    shift:        { label: 'Shift',            pill: 'Shift',    fixed: false },
    rdw:          { label: 'Rest Day Worked',  pill: 'RDW',      fixed: false },
    annual_leave: { label: 'Annual Leave',     pill: 'AL',       fixed: true,  fixedValue: 'AL' },
    correction:   { label: 'Set as Rest Day',  pill: 'Rest Day', fixed: true,  fixedValue: 'RD' },
    sick:         { label: 'Absent',           pill: 'Absent',   fixed: true,  fixedValue: 'SICK' },
    // Training / Induction / Assessment (OTHER_DAYS.md). NOT fixed — the time inputs show —
    // but times are OPTIONAL: blank is VALID (pay defaults apply: base shift on a rostered
    // day, 8h RDW on an Other rest-day). Value is composed at save time from the row's
    // flavour buttons + RDW tick + optional times: FLAVOUR[" RDW"][" HH:MM-HH:MM"].
    // `timesOptional` is DESCRIPTIVE metadata — consumers branch on type === 'other'
    // explicitly (collector, validateShiftRules, prefill); keep it for the next such type.
    other:        { label: 'Other',            pill: 'Other',    fixed: false, timesOptional: true },
    // No rows for `allocated`, `overtime` or `swap`: no record is of those types since the 4 Nov 2026
    // conversion. Their names live on only as a historic `replacedType` (LEGACY_OVERRIDE_TYPES,
    // override-utils.js), which nothing here labels.
};

/** Ordered list of type keys for the per-row and bulk-bar pill buttons (single source of truth).
 *  Order: AL · Shift · RDW · Absent · Rest Day · Other — do not reorder; matches admin.html label order.
 *  Spare moved OUT of the top pill row into the Other submenu (v15.57): it's a rarely-used
 *  standby placeholder (only reached to correct an error), so it doesn't earn a top-level pill.
 *  It stays its OWN override type (`spare_shift`/'SPARE', 📋 purple badge) — only the entry
 *  point moved: picking "Spare" in the Other submenu writes a spare_shift, not an 'other' day.
 */
export const PILL_TYPES = ['annual_leave', 'shift', 'rdw', 'sick', 'correction', 'other'];

// Override types that represent genuinely WORKED days — a Sunday RD-correction during an AL/absence
// booking must never overwrite one of these (real overtime). (v16.19)
// The three retired types are not in it: no record is of them (owner, 7 Nov 2026 — Operations' count
// after the 4 Nov conversion read none left). A 6 Nov review put them back as a defence against a
// survivor nobody had ruled out; that question is answered, so the v25.32 set stands.
export const WORKED_OVERRIDE_TYPES = new Set(['rdw', 'shift', 'spare_shift']);


/**
 * What a Saved Changes row should PRINT for an override's raw value — or `''` when printing it would
 * only repeat the badge beside it.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────
 *
 * A row renders a type badge and then the stored value, which for a `fixed` type is DERIVED from
 * that type and so says nothing new: the absence row read **“Absent  SICK”** and the leave row
 * **“Annual Leave  AL”**. The first of those is worse than clutter — `SICK` is a word this app does
 * not put in front of staff (CLAUDE.md's wording conventions: the reason for an absence is never
 * stored, and "Absent" is the term), and it had been sitting on the Admin page's own list of
 * everything ever recorded.
 *
 * The value is kept wherever it CARRIES something the badge cannot: a shift's times, an RDW's times,
 * an Other day's flavour. So the test is not a list of types to hide but the same `fixed` flag that
 * makes the value derivable in the first place — a type added later is handled by whichever answer
 * its own declaration gives, rather than by somebody remembering this function exists.
 *
 * It fails toward SHOWING: an unknown type, or a value that does not match the fixed one it should
 * have, is printed. A row whose data disagrees with its own type is exactly the row an admin needs
 * to see, and hiding it would make a real inconsistency invisible.
 *
 * @param {string} type  the override's type
 * @param {string} value the stored value
 * @returns {string} the text to print, or `''` to print nothing
 */
export function rowValueText(type, value) {
    const meta = TYPES[type];
    if (meta && meta.fixed && meta.fixedValue === value) return '';
    return value ?? '';
}
