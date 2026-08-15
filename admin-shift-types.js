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
    // Training / Induction / Assessment (OTHER_PLAN.md). NOT fixed — the time inputs show —
    // but times are OPTIONAL: blank is VALID (pay defaults apply: base shift on a rostered
    // day, 8h RDW on an Other rest-day). Value is composed at save time from the row's
    // flavour buttons + RDW tick + optional times: FLAVOUR[" RDW"][" HH:MM-HH:MM"].
    // `timesOptional` is DESCRIPTIVE metadata — consumers branch on type === 'other'
    // explicitly (collector, validateShiftRules, prefill); keep it for the next such type.
    other:        { label: 'Other',            pill: 'Other',    fixed: false, timesOptional: true },
    // Legacy types — no pill buttons; kept so old Saved Changes records display correctly.
    // SUNSET: these are display-only (never creatable). Delete this block + the `legacyToShift` map +
    // the `isLegacyType` guard + 'allocated'/'overtime'/'swap' from `WORKED_OVERRIDE_TYPES` (search
    // those symbol names — line anchors drift in this ~1700-line file) once a one-time Firestore
    // migration rewrites any surviving legacy-typed override docs to their modern equivalents
    // (allocated/overtime→shift, swap→shift). Until that migration runs, removing these would make
    // old records render as UNKNOWN.
    allocated:    { label: 'Allocated shift',  fixed: false },
    overtime:     { label: 'Overtime',         fixed: false },
    swap:         { label: 'Swap',             fixed: false },
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
// booking must never overwrite one of these (real overtime). Covers the current creatable worked
// types plus the legacy-but-still-in-data ones (see CLAUDE.md → overrides `type`). (v16.19)
export const WORKED_OVERRIDE_TYPES = new Set(['rdw', 'shift', 'spare_shift', 'allocated', 'overtime', 'swap']);

