// @ts-check
/**
 * paycalc-migrations.js — localStorage storage keys and data migrations for the Pay Calculator.
 *
 * Exports storage key constants (SK, periodKey, etc.) used by paycalc-app.js for
 * all per-setting and per-period data. Also exports runMigrations(), called
 * once at startup before loadSettings() to rename legacy keys and patch stale values.
 *
 * Pure localStorage — no DOM, no Firebase.
 * @module paycalc-migrations
 */

import { TAX_YEARS, calcProRateFactor } from './paycalc-calc.js';
import { teamMembers } from './roster-data.js';
import { lsGet, lsSet, lsDel, lsMove, lsSetVerified, lsDelVerified, lsGetChecked, lsKeysChecked } from './ls.js';
import { classifyPayKey, isSavedPeriodShape } from './paycalc-inventory.js';

// ── STORAGE KEYS ──────────────────────────────────────────────────────────────
// Keys use the myb_pc_ prefix (previously cea_ — migrated in _migrateCeaKeys below).
//
// PER-MEMBER NAMESPACING (v14.11):
//   On a shared device, two staff members signing into the same browser would
//   otherwise read each other's pay data (tax code, YTD, grade, period figures).
//   To isolate them, every per-member key carries a member segment between the
//   `myb_pc_` prefix and the rest of the key — e.g. `myb_pc_gmiller_rate`. The
//   segment is set once at startup by setPaycalcNamespace() (called from
//   runMigrations) and read at call time via pcPrefix(), so all key functions and
//   the SK object resolve to the logged-in member's namespace.
//   Device-level keys (migration guards, "seen this notice/welcome" flags) stay
//   unnamespaced — see DEVICE_KEYS — because they describe the browser, not a member.
//   With no member (default / unit tests) the segment is empty, so keys are exactly
//   the legacy `myb_pc_*` names and behaviour is unchanged.

/**
 * The GENERATION of the stored pay data — what SHAPE the values are in, as opposed to what shape
 * the backup FILE is in (that is `BACKUP_VERSION` in paycalc-transfer.js, and the two answer
 * different questions: a file format can change without a single stored value moving, and every
 * migration below changed values without touching the file format).
 *
 * A backup carries this so a restore knows which of the migrations below the incoming values have
 * already been through. Without it the only available signal is the DEVICE's own one-shot
 * migration flags — which describe the browser, are deliberately excluded from every backup, and
 * would therefore say "already migrated" about data that has never been near this device.
 *
 * The generations, each a change to what a stored value MEANS:
 *   1  `cea_*` keys                                          (pre-`myb_pc_`)
 *   2  `myb_pc_*`, single shared namespace                   (_migrateCeaKeys)
 *   3  per-member namespace `myb_pc_<slug>_*`                (v14.11)
 *   4  `sl: 'postgrad'` split into plan + separate PGL flag  (v17.17)
 *      back-pay `bp_state` split per tax year                (v17.86)
 *   5  pension opt-out boolean replaced by a timeline        (v21.78)
 *
 * BUMP IT when a migration changes the meaning of a value that a backup can carry — not when a
 * new key is merely added, which needs no migration to read.
 *
 * Nothing consumes it yet, and that is deliberate rather than unfinished: every live migration
 * over backed-up keys is DATA-gated (`if (sl === 'postgrad')`, `if (timeline === null && flag)`),
 * so each already re-runs correctly over restored values. The device-flag-gated ones operate only
 * on legacy device-local keys no backup carries. The generation is recorded now so that the first
 * migration which is NOT data-gated has an honest anchor to gate on, instead of inferring one from
 * the app version string.
 */
export const PAY_DATA_GENERATION = 5;

/** Active member segment, e.g. 'gmiller_' or '' (unnamespaced). @type {string} */
let _nsSeg = '';

/** Slug a member name to a localStorage-safe segment: lowercase, alphanumerics only.
 *  'G. Miller' → 'gmiller'. Two distinct names CAN share a slug ('Q. Example' and 'Q Example'), so
 *  it is the roster that keeps namespaces apart — paycalc-migrations.test.mjs checks every row. */
export function memberSlug(/** @type {string=} */ name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Slugs of every known member — used to tell a member's namespaced key
 *  (`myb_pc_<slug>_…`) apart from genuinely unnamespaced legacy data. */
const _MEMBER_SLUGS = new Set(teamMembers.map(m => memberSlug(m.name)));

/** The member slug that OWNS a paycalc key, or null when the key has no member-slug
 *  segment (i.e. genuinely unnamespaced legacy data). `myb_pc_<slug>_<tail>` belongs to
 *  <slug> when <slug> is a real member; legacy keys (`myb_pc_rate`, `myb_pc_p43`,
 *  `myb_pc_setup_2025_26`, `myb_pc_ytd_pay_2026_27`) have a non-member first segment (or
 *  none) and classify as null. This is what stops the ownership prompt from ever treating
 *  ANOTHER member's namespaced data as claimable legacy data (v14.27 review fix) — and, since the
 *  72-hour review, what stops a backup with its `slug` stripped passing as legacy (paycalc-transfer).
 *
 *  A slug the roster NO LONGER names owns its keys too (paycalc-3-5): a renamed member's data, or a
 *  row removed outright. Hidden leavers stay on the roster, but nothing kept a rename's old slug
 *  there, and its data was offered to the next person to sign in, re-keyed by "Yes, it's mine" to
 *  `myb_pc_<new>_<old>_…` where nothing reads it, or deleted by another member's "No — delete it". It is
 *  told apart from legacy by what the key IS (`classifyPayKey`, the one authority on that —
 *  invariant 15): the remainder after the slug is a pay key this app writes, which no legacy key's
 *  remainder is (`myb_pc_ytd_pay_2026_27` leaves `pay_2026_27`; paycalc-migrations.test.mjs runs
 *  every legacy shape).
 *  @param {string} key @returns {string|null} */
export function keyOwnerSlug(key) {
    const m = key.match(/^myb_pc_([a-z0-9]+)_/);
    if (!m) return null;
    if (_MEMBER_SLUGS.has(m[1])) return m[1];
    return classifyPayKey(key.slice(m[0].length)).kind !== 'unknown' ? m[1] : null;
}

/** The active per-member key prefix. Every per-member paycalc key starts with this. */
export function pcPrefix() { return `myb_pc_${_nsSeg}`; }

/** Per-member storage keys. Rebuilt in place (object mutated, binding kept) whenever
 *  the namespace changes, so every module that imported SK sees the new key names. */
/** @type {{ rate:string, rates:string, code:string, sl:string, pgLoan:string, slPaidOff:string, pension:string, pensionOptOut:string, pensionTimeline:string, setup:string, ytdPay:string, ytdTax:string, grade:string, gradeFrom:string, gradeKept:string, gradeNote:string }} */
export const SK = {
    rate: '', rates: '', code: '', sl: '', pgLoan: '', slPaidOff: '', pension: '', pensionOptOut: '', pensionTimeline: '', setup: '', ytdPay: '', ytdTax: '', grade: '', gradeFrom: '', gradeKept: '', gradeNote: '',
};

/** Recompute the SK key strings from the active namespace. */
function _rebuildSK() {
    const p = pcPrefix();
    // RETIRED, still declared: `rate` and `rates` are never read (the rate is fixed by grade —
    // invariant 8) or written; legacy copies sit on devices, so the names stay for the cea_ rename.
    SK.rate    = `${p}rate`;
    SK.rates   = `${p}rates`;
    SK.code    = `${p}code`;
    SK.sl      = `${p}sl`;      // undergraduate plan: 'none'|'plan1'|'plan2'|'plan4'|'plan5'
    SK.pgLoan  = `${p}pg_loan`; // separate Postgraduate Loan flag ('1' | absent) — repayable ALONGSIDE a plan
    SK.slPaidOff = `${p}sl_paid_off`; // loan fully repaid: p.num of the FIRST payslip with no deduction ('' = still repaying). Once-ever fact → member-level, not per-tax-year (v18.41)
    // RETIRED, still declared: a member-level pension default that nothing read (paycalc-3-15) — each
    // payslip keeps its own figure, and one with none takes its period default.
    SK.pension = `${p}pension`;
    // NOT in the pension scheme at all (opted out / withdrawn from the RPS): '1' | absent.
    // A SEPARATE flag from the amount, deliberately. `SK.pension` is an amount, and every
    // amount this app stores has one reading — "how much", never "whether". Overloading £0 to
    // mean "not a member" would collide with the round trip's existing rule that a value equal
    // to the period default stores as null and re-heals to future defaults: an opted-out member's
    // 0 IS the default, so it would erase itself. The flag answers the different question, and
    // `getPensionDefault` reads it (paycalc-settings.js) so every downstream site — the field
    // default, calculate()'s fallback, the HPP estimate and the year summary — inherits it from
    // the one place they already agree on. Member-level, so a shared device keeps them separate.
    // RETIRED at v21.78 but still DECLARED: the v21.64-v21.77 boolean. Nothing writes it any
    // more; `loadSettings` reads it once to build a timeline and then never again (the timeline
    // key's mere existence ends the migration). Left in place so a device that has it can still
    // be migrated — deleting the declaration would strand the one member who set it.
    SK.pensionOptOut = `${p}pension_optout`;
    // WHEN the member was in the pension scheme, as a list of changes — see paycalc-pension.js.
    // A timeline rather than a flag because the flag rewrote history: it made the pension default
    // £0 for every payslip that has ever existed, and a period whose pension equals the default
    // stores `null`, so most historical payslips had nothing of their own to defend them.
    SK.pensionTimeline = `${p}pension_timeline`;
    SK.setup   = `${p}setup`;
    SK.ytdPay  = `${p}ytd_pay`;
    SK.ytdTax  = `${p}ytd_tax`;
    // 'roster' (price each payslip by the roster's dated grades — the default) or a grade the member
    // chose ('cea'|'ces'). A chosen grade covers whole payslips from `gradeFrom` on — see
    // paycalc-grade.js. A device's grade saved before grades had dates has no `gradeFrom`, and
    // loadSettings converts it once (settingFromLegacy).
    SK.grade   = `${p}grade`;
    SK.gradeFrom = `${p}grade_from`;   // p.num of the first payslip a CHOSEN grade covers ('' / absent with 'roster')
    // The roster grade the member chose NOT to switch to when the grade prompt asked ('cea'|'ces',
    // absent = never declined) — paycalc-settings.js → gradeToOffer. Member-level, like the grade.
    SK.gradeKept = `${p}grade_kept`;
    // The roster change of grade this device has shown its one-time note for — the change's first day,
    // YYYY-MM-DD (paycalc-grade.js → gradeChangeNote). A later change is a different day, so it shows.
    SK.gradeNote = `${p}grade_note`;
}
_rebuildSK(); // initialise to the unnamespaced (legacy) key names at module load

/** Activate the per-member namespace. Pass the logged-in member's name, or a
 *  falsy value for unnamespaced (legacy) keys. Idempotent. */
export function setPaycalcNamespace(/** @type {string=} */ memberName) {
    _nsSeg = memberName ? `${memberSlug(memberName)}_` : '';
    _rebuildSK();
}

/** @param {number} pNum @returns {string} */
export function periodKey(pNum)   { return `${pcPrefix()}p${pNum}`; }

/**
 * Parse a raw saved-period JSON string into `{ data, error }`. PURE (no storage) so the corrupt-data
 * path is unit-testable and the back-pay / HPP loops share one decoder instead of each doing an ad-hoc
 * `lsGet` + `JSON.parse` (which they handled inconsistently — reset / skip / warn / silent). Contract:
 *   • null/empty raw → `{ data: null, error: false }` (a period that was never saved — not an error)
 *   • a period object → `{ data, error: false }`
 *   • malformed JSON, or JSON of the wrong SHAPE (`[]`, `"text"`, `null`, a number — anything
 *     `isSavedPeriodShape` refuses) → `{ data: null, error: true }` — the caller SURFACES it, so a
 *     damaged period is never dropped silently from a pay estimate, nor shown as an empty payslip (the
 *     no-silent-caps principle). Nothing here rewrites or deletes it: the stored value is left as it is.
 * @param {string|null|undefined} raw
 * @returns {{ data: any, error: boolean }}
 */
export function parseSavedPeriod(raw) {
    if (!raw) return { data: null, error: false };
    /** @type {unknown} */
    let data;
    try { data = JSON.parse(raw); } catch { return { data: null, error: true }; }
    return isSavedPeriodShape(data) ? { data, error: false } : { data: null, error: true };
}

/** Read + decode a saved period by number (composes lsGet + parseSavedPeriod). @param {number} pNum @returns {{ data:any, error:boolean }} */
export function readSavedPeriod(pNum) {
    return parseSavedPeriod(lsGet(periodKey(pNum)));
}
/** @param {{ label:string }} ty @returns {string} */
export function hppEstKey(ty)     { return `${pcPrefix()}hpp_est_${ty.label.replace('/', '_')}`; }
/** @param {{ label:string }} ty @returns {string} */
export function hppActualKey(ty)  { return `${pcPrefix()}hpp_actual_${ty.label.replace('/', '_')}`; }
/** Per-tax-year opt-in flag ('1' = the member ticked "add my HPP to the January take-home"). @param {{ label:string }} ty @returns {string} */
export function hppIncKey(ty)     { return `${pcPrefix()}hpp_inc_${ty.label.replace('/', '_')}`; }
/** HPP amount-source state — the mode and the member's own typed figure, one JSON blob
 *  (`{ mode, exact }`, saveHppState) — PER TAX YEAR, keyed like hppIncKey. The current-year estimate
 *  comes from entered hours (default), a rough figure from the Year to Date card's Taxable Pay, or
 *  the member's own figure (v18.32). @param {{ label:string }} ty @returns {string} */
export function hppModeKey(ty)    { return `${pcPrefix()}hpp_mode_${ty.label.replace('/', '_')}`; }
/** Back-pay card state (rates/%/paid-in/mode/manual, one JSON blob) — PER TAX YEAR since v17.86 (the
 *  card follows the viewed payslip's award year), keyed like hppIncKey. @param {{ label:string }} ty @returns {string} */
export function bpKey(ty)          { return `${pcPrefix()}bp_state_${ty.label.replace('/', '_')}`; }
/** @param {{ label:string }} ty @returns {string} */
export function ytdPayKey(ty)     { return `${pcPrefix()}ytd_pay_${ty.label.replace('/', '_')}`; }
/** SOURCE payslip of the year's Year to Date figures (internal period num, e.g. "53") — which
 *  payslip the two totals were copied from. Anchors the cumulative tax method: it only engages on
 *  the payslip immediately after the source (v17.98). @param {{ label:string }} ty @returns {string} */
export function ytdSrcKey(ty)     { return `${pcPrefix()}ytd_src_${ty.label.replace('/', '_')}`; }
/** @param {{ label:string }} ty @returns {string} */
export function ytdTaxKey(ty)     { return `${pcPrefix()}ytd_tax_${ty.label.replace('/', '_')}`; }

/** localStorage key: YTD notice seen-flag (set when the YTD notice is dismissed).
 *  Device-level — not namespaced. */
// v21.91 — the SECOND run of the YTD notice, and it needed a new key rather than a new date.
// The first run expired on ~5 Jul 2026, and the expiry branch sets the flag WITHOUT showing
// anything — so every device that arrived after that date is marked "shown" for a notice it never
// saw. Those are exactly the people the restart is for (a new starter's tax estimate is only
// accurate once they enter Year-to-Date figures). Re-dating the old key would have reached nobody.
// Same reasoning as the links welcome notice at v19.51.
export const NOTICE_YTD_KEY = 'myb_pc_ytd_notice_2_shown';

/** localStorage key: the Holiday Pay Premium notice's seen-flag (`hpp_2526`, v26.22 — set by every
 *  way of answering it, and silently once it has ended; never because it is not THIS member's, since
 *  the flag is the device's). Device-level — not namespaced, like the Year to Date notice's, and so
 *  declared in `_ACTIVE_DEVICE_KEYS` below: an undeclared `myb_pc_` key reads as somebody's
 *  unnamespaced pay data and fires the ownership prompt. */
export const NOTICE_HPP_KEY = 'myb_pc_hpp_notice_2526_shown';

// ── DEVICE-LOCAL PAYSLIP ACTUALS (v14.69) ─────────────────────────────────────
// A member's own real payslip figures, keyed by ISO payday, used by the Pay
// Calculator's actual-vs-estimate comparison. Stored ONLY in the member's own
// browser (namespaced via pcPrefix, so per-member and never shared) — never in a
// served file (real pay figures were moved out of roster-data.js at v14.68 for
// privacy). Seeded once per device via the owner-only import in paycalc.html.
/** The active member's payslip-actuals storage key (namespaced → per-member). */
function payslipActualsKey() { return `${pcPrefix()}actuals`; }

/** True for the developer account with a device-local payslip-actuals overlay (dev-only feature gate).
 *  Single source for the hardcoded name literal that used to be repeated across paycalc modules.
 *  @param {{name?:string}|null|undefined} member */
export function isActualsDev(member) { return member?.name === 'G. Miller'; }

/** Read the active member's device-local payslip actuals. Returns {} when none are
 *  stored or the stored JSON is unparseable. @returns {Record<string, any>} */
export function readPayslipActuals() {
    try { const raw = lsGet(payslipActualsKey()); return raw ? JSON.parse(raw) : {}; }
    catch { return {}; }
}

/** Persist a payslip-actuals map (ISO-payday → { gross, tax, ni, sl, net, varPay }) for the active
 *  member. The answer is the READ-BACK, never the caller's own count: the import said "Imported …"
 *  and reloaded over a write `lsSet` had silently dropped, and the pasted text went with the page.
 *  @param {Record<string, any>} map @returns {boolean} true only when stored and read back identical */
export function writePayslipActuals(map) {
    return lsSetVerified(payslipActualsKey(), JSON.stringify(map || {}));
}

/** Delete the active member's device-local payslip actuals.
 *  @returns {boolean} true only when a read afterwards finds nothing (lsDelVerified) */
export function clearPayslipActuals() { return lsDelVerified(payslipActualsKey()); }

/** Device-level `myb_pc_*` keys that must NOT be moved into a member namespace:
 *  one-time migration guards and per-device "seen" flags. Everything else under
 *  the `myb_pc_` prefix is member-financial data and gets namespaced. */
/** Keys that describe the BROWSER, not the member — never namespaced, and never carried by a
 *  backup (paycalc-transfer.js): importing `ns_migrated` onto a fresh device would suppress the
 *  legacy-ownership prompt on a device that genuinely needs it. */
const _ACTIVE_DEVICE_KEYS = [
    'myb_pc_cea_migrated',
    'myb_pc_pension_v882_migrated',
    'myb_pc_ytd_notice_2_shown',
    'myb_pc_hpp_notice_2526_shown',   // the Holiday Pay Premium notice, 16 Nov 2026 – 8 Jan 2027 (v26.22)
    'myb_pc_ns_migrated',
    'myb_pc_ns_claim',                // who answered "mine" while their copy is unfinished (NS_CLAIM_KEY)
];

/** Device keys the app NO LONGER WRITES — but which still sit in localStorage on every device that
 *  set them, sometimes for years. They must stay classified as device-level for as long as they can
 *  plausibly exist in the wild.
 *
 *  This list exists because deleting one was a live bug (v19.36 → fixed v19.37). Retiring the
 *  welcome lightbox removed `myb_pc_pay_welcome_shown` from the set above, which is correct in the
 *  sense that nothing writes it any more — but every device that ever dismissed that lightbox still
 *  HAS the flag. The moment it stopped being declared, `_hasUnnamespacedPaycalcData` began reading it
 *  as unnamespaced member data, and the "Is this your pay data?" ownership prompt started firing at
 *  members who have no legacy data whatsoever. Worst affected were anyone who first used the pay
 *  calculator AFTER the v14.11 namespacing: their data was namespaced from the start, so the prompt
 *  never ran, so `myb_pc_ns_migrated` — the guard that short-circuits all of this — was never set.
 *
 *  RULE: retiring a feature that owned a device flag means MOVING its key here, never deleting it.
 *  Removing an entry from this list is a data-classification change affecting existing devices, not
 *  a tidy-up. `paycalc-key-parity.test.mjs` deliberately exempts these from its no-ghosts check —
 *  having no writer is what "retired" MEANS. */
const _RETIRED_DEVICE_KEYS = [
    'myb_pc_pay_welcome_shown',   // welcome lightbox, retired v19.36
    'myb_pc_ytd_notice_shown',    // YTD notice run 1 (Apr–Jul 2026), superseded by run 2 at v21.91
];

export const DEVICE_KEYS = new Set([..._ACTIVE_DEVICE_KEYS, ..._RETIRED_DEVICE_KEYS]);

/** The retired subset, for the parity guard (which must not demand a writer for these). */
export const RETIRED_DEVICE_KEYS = new Set(_RETIRED_DEVICE_KEYS);

// ── LEFTOVER SOURCES — a copy that landed beside a source that would not go ─────────
// A move has two halves, and they fail differently (external review of v26.95). A COPY that did not
// land means the data is not yet where it belongs, so the one-shot flag waits and the migration runs
// again. A copy that LANDED beside a source that would not go is different: the migration's work is
// done, and only tidying is left. Withholding the flag for that second case re-ran the whole
// migration — which re-asked the ownership question on a shared device (a second member was offered,
// and could take, data the first had already claimed) and re-copied CEA data the member had since
// said to delete.
//
// So a flag records the leftover SOURCES instead of waiting: '1' is done, a JSON list is "done, and
// these keys are still to be removed". Every reader of a flag asks only whether it is SET, so either
// value closes the question. A later load tries each listed key again and NEVER copies anything; a
// key still refused stays on the list, a key gone comes off, and an empty list becomes '1'. The list
// names the exact keys, so data that arrives under a legacy name later is never swept up with them.

/** A one-shot migration flag's value once nothing is left to tidy. */
const _FLAG_DONE = '1';

/**
 * Record a migration as finished: '1', or the list of source keys that would not be removed.
 * @param {string} flagKey
 * @param {string[]} leftovers source keys whose value is safely elsewhere but which are still present
 * @returns {boolean} true when the flag reads back — the namespace claim is cleared only then
 */
function _settleFlag(flagKey, leftovers) {
    return lsSetVerified(flagKey, leftovers.length ? JSON.stringify(leftovers) : _FLAG_DONE);
}

/**
 * Try again to remove the leftover sources a finished migration listed in its flag (see above).
 * Removes only — never copies, never writes anywhere but the flag. A listed key `mayRemove` refuses
 * is dropped from the list untouched: it is no longer a source, so it is not this function's to
 * delete. A flag of '1', an absent flag or an unreadable value is left alone.
 * @param {string} flagKey
 * @param {(key: string) => boolean} mayRemove
 */
function _tidyLeftovers(flagKey, mayRemove) {
    const raw = lsGet(flagKey);
    if (!raw || raw === _FLAG_DONE) return;
    /** @type {unknown} */
    let listed;
    try { listed = JSON.parse(raw); } catch { return; }
    if (!Array.isArray(listed)) return;
    const still = listed.filter(k => typeof k === 'string' && mayRemove(k) && !lsDelVerified(k));
    if (still.length !== listed.length) _settleFlag(flagKey, still);   // unchanged → no write
}

// ── KEY MIGRATION ─────────────────────────────────────────────────────────────
// Renames all cea_ prefixed localStorage keys to myb_pc_ in one pass.
// Guarded by the myb_pc_cea_migrated flag: it COPIES once per device, and a later load only tidies
// a source that would not be removed (_tidyLeftovers). Nothing writes a cea_ key any more, so a
// listed one is always safe to remove — its value reached myb_pc_ on the load that listed it.
/** @param {{ getPeriods: Function }} deps */
function _migrateCeaKeys({ getPeriods }) {
    // A flag that cannot be READ is not an absent flag: re-running the copy would put back a value
    // the member has since deleted (see the end of this function). Unreadable: nothing this load.
    const done = lsGetChecked('myb_pc_cea_migrated');
    if (!done.ok) return;
    if (done.value) { _tidyLeftovers('myb_pc_cea_migrated', k => k.startsWith('cea_')); return; }

    // Every failed copy is counted, and the completion flag is withheld if there were any (v21.86).
    // The old form was `lsSet(newKey, val); lsDel(oldKey);` — and `lsSet` swallows a storage error
    // by design, so a write that failed was indistinguishable from one that worked. The delete then
    // destroyed the only copy, and the flag below made sure it was never retried. An external audit
    // reproduced exactly that against `cea_code`: old key gone, new key absent, migration recorded
    // as complete. `lsMove` deletes only after reading the destination back.
    let _failed = 0;
    /** @type {string[]} */
    const _leftovers = [];
    const migrate = (/** @type {string} */ oldKey, /** @type {string} */ newKey) => {
        // CHECKED READS: "could not read" is never "absent". A source skipped as absent let the flag
        // close over a value never moved; a destination read as empty let an older value overwrite
        // it. Either counts as a failed copy — nothing is touched, and the flag waits.
        const src = lsGetChecked(oldKey);
        if (!src.ok) { _failed++; return; }
        const val = src.value;
        if (val === null) return;                                  // nothing here to move
        const dst = lsGetChecked(newKey);
        if (!dst.ok) { _failed++; return; }
        // Destination already holds a value (an older copy): never written over. Only the source is
        // removed, and one that will not go is a leftover, not a failure.
        if (dst.value !== null) { if (!lsDelVerified(oldKey)) _leftovers.push(oldKey); return; }
        if (lsMove(oldKey, newKey, val)) return;
        // lsMove keeps BOTH sides when it cannot finish; which half failed decides what happens next.
        if (lsGet(newKey) === val) _leftovers.push(oldKey);       // copy landed; the source would not go
        else _failed++;                                            // copy did not land: retry next load
    };

    // Fixed single keys
    migrate('cea_rate',    SK.rate);
    migrate('cea_rates',   SK.rates);
    migrate('cea_code',    SK.code);
    migrate('cea_sl',      SK.sl);
    migrate('cea_pension', SK.pension);
    migrate('cea_setup',   SK.setup);
    migrate('cea_ytd_pay', SK.ytdPay);
    migrate('cea_ytd_tax', SK.ytdTax);
    migrate('cea_grade',   SK.grade);
    migrate('cea_pension_v882_migrated', 'myb_pc_pension_v882_migrated');

    // Per-period keys: cea_p{N} → myb_pc_p{N}
    getPeriods().forEach((/** @type {any} */ p) => migrate(`cea_p${p.num}`, periodKey(p.num)));

    // Per-tax-year keys
    TAX_YEARS.forEach(ty => {
        const slug = ty.label.replace('/', '_');
        migrate(`cea_setup_${slug}`,      `myb_pc_setup_${slug}`);
        migrate(`cea_hpp_est_${slug}`,    `myb_pc_hpp_est_${slug}`);
        migrate(`cea_hpp_actual_${slug}`, `myb_pc_hpp_actual_${slug}`);
        migrate(`cea_ytd_pay_${slug}`,    `myb_pc_ytd_pay_${slug}`);
        migrate(`cea_ytd_tax_${slug}`,    `myb_pc_ytd_tax_${slug}`);
    });

    // Only claim the migration is done if every value actually arrived. A device that could not write
    // (private mode, a full quota) retries on the next load with its data still intact, which is
    // the entire difference between a deferred migration and a lost tax code. A source that would not
    // go is NOT a reason to copy again: a re-run would put back a value the member has since deleted
    // (the ownership prompt's "No — delete it" clears myb_pc_code), so it is listed instead.
    if (_failed === 0) _settleFlag('myb_pc_cea_migrated', _leftovers);
    else console.warn(`[paycalc] CEA key migration deferred — ${_failed} value(s) could not be stored; nothing was deleted`);
}

// ── PER-MEMBER NAMESPACE MIGRATION (v14.11; ownership prompt v14.25) ───────────
// Device-level, one-shot. There may be legacy unnamespaced ("shared") paycalc data
// from before per-member namespacing. We must NOT silently assign it to whoever loads
// first — on a shared device that could be another member's tax code / YTD / pension.
// So runMigrations only ACTIVATES the member's namespace; the shared data is left in
// place until the member explicitly resolves ownership via resolveLegacyMigration
// ('mine' → move it into their namespace; 'fresh' → discard it). The device flag
// myb_pc_ns_migrated is set on resolution, so the prompt appears at most once — set once every value
// has REACHED the namespace, whether or not each legacy source would go. A source that stayed is
// listed in the flag and removed quietly on a later load (_tidyLeftovers); it is never offered to
// anyone again, because on a shared device the next person asked would be offered the data the first
// one had already claimed.
//
// THE CLAIM COMES FIRST. A "mine" whose copy fails part-way used to leave only the withheld flag, and
// a withheld flag reads exactly like a question nobody has answered: the next member to sign in was
// asked, and their "mine" copied the first member's tax code and loan setting into their own
// namespace (invariant 3). So "mine" now records WHO answered, and the keys they claimed, in
// NS_CLAIM_KEY before it changes anything — verified by read-back, or nothing is changed and the
// question stays open. While a claim stands nobody is asked, `resolveLegacyMigration` moves nothing
// for anybody else, and the claimant's own later loads finish the copy without asking again (they
// already answered). It is cleared only once myb_pc_ns_migrated reads back. A claimant who never
// returns leaves the legacy data where it is, unoffered: the safe direction for somebody else's pay.
//
// "COULD NOT READ" IS NEVER "ABSENT". Every read here that decides a write, a delete or a flag is a
// checked one (lsGetChecked / lsKeysChecked): one failed read used to delete the only copy, write an
// older value over a newer one, or close the question over data never enumerated. On any uncertainty
// both values are left untouched and nothing advances.

/** Device key: the pending "mine" — `{ by: <slug>, keys: [<legacy keys still to finish>] }`. */
const NS_CLAIM_KEY = 'myb_pc_ns_claim';
/** Device key: the ownership question is answered (`_settleFlag` — '1', or leftovers to tidy). */
const NS_DONE_KEY = 'myb_pc_ns_migrated';

/** True for a genuinely-unnamespaced legacy paycalc key — a `myb_pc_` key with NO member-slug
 *  segment that is not a device key. Another member's namespaced data (owner = their slug) is
 *  explicitly NOT legacy, so it is never offered, moved or cleared.
 *  @param {string} k @returns {boolean} */
function _isLegacyPayKey(k) {
    return k.startsWith('myb_pc_') && !DEVICE_KEYS.has(k) && keyOwnerSlug(k) === null;
}

/** True when the device holds genuinely-unnamespaced legacy paycalc data (_isLegacyPayKey). An
 *  enumeration that fails answers false: nobody is asked about data nothing could list. */
function _hasUnnamespacedPaycalcData() {
    return lsKeysChecked().keys.some(_isLegacyPayKey);
}

/**
 * Where the ownership question stands, read with checked reads. `ok` false means storage would not
 * say — every caller then changes nothing and asks nobody.
 * @returns {{ ok: boolean, done: boolean, claim: { by: string, keys: string[] } | null }}
 *   `done` the question is closed; `claim` an outstanding "mine" (a record that will not parse is a
 *   claim by nobody: it blocks every member and resumes for none, the safe reading of somebody's data)
 */
function _ownershipState() {
    const done = lsGetChecked(NS_DONE_KEY);
    if (!done.ok) return { ok: false, done: false, claim: null };
    if (done.value) return { ok: true, done: true, claim: null };
    const raw = lsGetChecked(NS_CLAIM_KEY);
    if (!raw.ok) return { ok: false, done: false, claim: null };
    if (raw.value === null) return { ok: true, done: false, claim: null };
    /** @type {any} */
    let c = null;
    try { c = JSON.parse(raw.value); } catch { /* unparseable — a claim by nobody, below */ }
    const valid = c && typeof c.by === 'string' && Array.isArray(c.keys);
    return { ok: true, done: false,
        claim: valid ? { by: c.by, keys: c.keys.filter((/** @type {unknown} */ k) => typeof k === 'string') } : { by: '', keys: [] } };
}

/** Move the listed legacy keys into the namespace of member slug `seg`. Keys owned by ANY member
 *  (this one or another), and device keys, are left untouched. Used by the 'mine' choice and by its
 *  resumption on the claimant's later loads, so it is idempotent: a key already moved is skipped,
 *  and a populated destination is never written over.
 *
 *  The delete was UNCONDITIONAL until v21.86 — `if (val !== null && …) lsSet(…); lsDel(k);` — so a
 *  write `lsSet` had silently dropped still cost the source key. An external audit reproduced it
 *  with a tax code: `myb_pc_code` gone, the member-namespaced replacement absent, the prompt
 *  suppressed for good. Now a key that cannot be moved is LEFT WHERE IT IS, and the caller is told.
 *
 *  A COPY THAT LANDED is not a failure, even when its source would not go (review of v26.95): the
 *  value is in this member's namespace, so `ok` stays true and the source is returned as a leftover
 *  for the caller to list.
 *
 *  A READ THAT FAILED is not an absence. An unreadable source is not a source to skip (it may be the
 *  only copy), and an unreadable destination is not an empty one (it may hold the member's newer
 *  value): either leaves both sides alone and counts as unfinished.
 *  @param {string} seg the claimant's member slug
 *  @param {string[]} keys the legacy keys to move
 *  @returns {{ ok: boolean, leftovers: string[], remaining: string[] }} `ok` true only if every
 *    value reached the namespace; `leftovers` the sources still present beside a copy that did;
 *    `remaining` every listed source that may still be present (the claim's new list) */
function _moveLegacyToNamespace(seg, keys) {
    /** @type {string[]} */
    const leftovers = [];
    /** @type {string[]} */
    const remaining = [];
    const nsPrefix = `myb_pc_${seg}_`;
    let ok = true;
    const unfinished = (/** @type {string} */ k) => { ok = false; remaining.push(k); };
    keys.forEach(k => {
        if (!_isLegacyPayKey(k)) return;          // a device key, or a member's — never move it
        const newKey = nsPrefix + k.slice('myb_pc_'.length);
        const src = lsGetChecked(k);
        if (!src.ok) { unfinished(k); return; }
        const val = src.value;
        if (val === null) return;                              // gone already — nothing to move
        const dst = lsGetChecked(newKey);
        if (!dst.ok) { unfinished(k); return; }
        if (dst.value !== null) {                              // populated: only the source goes
            if (!lsDelVerified(k)) { leftovers.push(k); remaining.push(k); }
            return;
        }
        if (lsMove(k, newKey, val)) return;
        const after = lsGetChecked(newKey);
        if (after.ok && after.value === val) { leftovers.push(k); remaining.push(k); }   // copy landed; the source would not go
        else unfinished(k);                                    // copy did not land — BOTH sides kept
    });
    return { ok, leftovers, remaining };
}

/**
 * Carry an outstanding claim forward: move what is left, then close the question, or keep the claim
 * with the keys still to finish. Never asks anybody and never touches a key the claim does not list.
 * @param {{ by: string, keys: string[] }} claim
 */
function _continueClaim(claim) {
    if (!claim.by) return;                        // a claim by nobody — nothing to resume
    const { ok, leftovers, remaining } = _moveLegacyToNamespace(claim.by, claim.keys);
    if (ok) {
        // The claim goes only once the closed question READS BACK: a flag that did not land beside a
        // claim that had gone would reopen the question for the next member — the hole this closes.
        if (_settleFlag(NS_DONE_KEY, leftovers)) lsDelVerified(NS_CLAIM_KEY);
        return;
    }
    // A shorter list is written when one is due; if that write fails the longer one stands, which
    // only means a later load re-checks a key already finished — every step above is idempotent.
    if (remaining.length !== claim.keys.length) lsSetVerified(NS_CLAIM_KEY, JSON.stringify({ by: claim.by, keys: remaining }));
    console.warn('[paycalc] namespace migration deferred — some values could not be stored; nothing was deleted');
}

/** True when a logged-in member should be asked whether the device's shared paycalc
 *  data is theirs: shared data exists and ownership hasn't been resolved yet — nor CLAIMED, by
 *  anybody (a claimant's unfinished copy resumes without asking; nobody else is ever asked about
 *  it). Storage that will not say where the question stands asks nobody.
 *  @param {string|undefined} memberName @returns {boolean} */
export function hasPendingLegacyMigration(memberName) {
    if (!memberSlug(memberName)) return false;
    const state = _ownershipState();
    if (!state.ok || state.done || state.claim) return false;
    return _hasUnnamespacedPaycalcData();
}

/** Resolve the shared-data ownership prompt. 'mine' records the claim, then moves the data into
 *  memberName's namespace; 'fresh' discards it. Either way the namespace is (re)activated and the
 *  one-shot guard is set once the work is done so the prompt never reappears. Once it is set — or
 *  while ANOTHER member's claim stands — a further call only activates the namespace: it moves and
 *  deletes nothing. The claimant's own further call only carries their claim forward.
 *  @param {string|undefined} memberName @param {'mine'|'fresh'} choice */
export function resolveLegacyMigration(memberName, choice) {
    if (choice !== 'mine' && choice !== 'fresh') return;   // unknown choice — leave undecided
    const seg = memberSlug(memberName);
    setPaycalcNamespace(memberName);
    // ANSWERED ONCE, FOR THE DEVICE. A prompt left open in a stale tab, or any caller that did not ask
    // hasPendingLegacyMigration first, must not move legacy data a member has already claimed — the
    // sources a landed copy left behind are still under their legacy names — into a second namespace.
    const state = _ownershipState();
    if (!state.ok || state.done) return;
    if (state.claim) {                            // the first answer stands, whatever this one says
        if (seg && state.claim.by === seg) _continueClaim(state.claim);
        return;
    }
    // The keys the answer is ABOUT, enumerated with a check: a list that could not be read is not
    // an empty one, and closing the question over it would leave unseen data claimed by nobody.
    const listed = lsKeysChecked();
    if (!listed.ok) return;
    const keys = listed.keys.filter(_isLegacyPayKey);
    if (choice === 'fresh') {
        // 'fresh' sets the guard even when a delete fails: that leaves the data there, the safe
        // direction, and the flag lists it for a later load to remove without asking (_tidyLeftovers).
        _settleFlag(NS_DONE_KEY, keys.filter(k => !lsDelVerified(k)));
        return;
    }
    if (!seg) return;                             // nobody to claim it for
    // THE CLAIM BEFORE ANY CHANGE, verified. If it will not hold, nothing is moved and the question
    // stays open: a copy begun without it is the half-claim the next member could take. A claim that
    // landed under a read-back that failed is removed again where storage allows.
    if (!lsSetVerified(NS_CLAIM_KEY, JSON.stringify({ by: seg, keys }))) {
        lsDelVerified(NS_CLAIM_KEY);
        console.warn('[paycalc] namespace migration not started — the claim could not be recorded; nothing was changed');
        return;
    }
    _continueClaim({ by: seg, keys });
}

/**
 * On the claimant's own load, carry an outstanding "mine" forward without asking again. A claim
 * left beside a question that has since been closed is tidied away; anybody else's load leaves it.
 * @param {string|undefined} memberName the member signed in on this load
 */
function _resumeLegacyClaim(memberName) {
    const state = _ownershipState();
    if (!state.ok) return;
    if (state.done) { if (lsGetChecked(NS_CLAIM_KEY).value !== null) lsDelVerified(NS_CLAIM_KEY); return; }
    const seg = memberSlug(memberName);
    if (state.claim && seg && state.claim.by === seg) _continueClaim(state.claim);
}

// ── ALL DATA MIGRATIONS ───────────────────────────────────────────────────────
// Called once at startup before loadSettings(). Order matters: key prefix
// migration runs first so all subsequent migrations read the new key names.

/** The tax year the pre-per-year Year to Date and premium values belong to: the only year the
 *  calculator held when those keys were written. Named by its LABEL, never TAX_YEARS[0], so adding
 *  or retiring a year can never move where legacy figures land (Nov 2026 debt pass). */
const LEGACY_TAX_YEAR = Object.freeze({ label: '2025/26' });

/**
 * Re-home one legacy value under its per-year key: written only where the destination holds nothing,
 * and the source removed only once the destination holds a value. The destination is read CHECKED —
 * an unreadable one read as empty let an older legacy figure overwrite the member's newer one — and
 * on a failed read both keys are left as they are, for a later load. The caller has already read the
 * source the same way.
 * @param {string} srcKey the legacy key
 * @param {string} dstKey the per-year key
 * @param {string} value what to write when the destination is empty
 */
function _rehomeLegacyValue(srcKey, dstKey, value) {
    const dst = lsGetChecked(dstKey);
    if (!dst.ok) return;
    if (dst.value !== null || lsSetVerified(dstKey, value)) lsDel(srcKey);
}

/**
 * Passed in rather than imported: two of them live in modules that import this one (getPensionDefault
 * in paycalc-settings.js, getLoggedMember in paycalc-grade-setting.js), so importing them would be a cycle.
 * @param {{ getPeriods: Function, getLoggedMember: Function, getPensionDefault: Function }} deps
 */
export function runMigrations({ getPeriods, getLoggedMember, getPensionDefault }) {
    _migrateCeaKeys({ getPeriods });

    // (The legacy single rate → per-tax-year `rates` migration is retired (paycalc-3-15): the rate is
    // fixed by grade and never read from storage (invariant 8), so it only built a key nothing reads
    // and every backup carried.)

    // Migration: legacy global YTD values (myb_pc_ytd_pay / ytd_tax) to per-year keys
    // Checked reads throughout (see _rehomeLegacyValue): a source that could not be read is left for
    // a later load, never taken for absent — there is no flag here, so waiting costs nothing.
    const legacyYtdPay = lsGetChecked(SK.ytdPay);
    const legacyYtdTax = lsGetChecked(SK.ytdTax);
    if (legacyYtdPay.ok && legacyYtdTax.ok && (legacyYtdPay.value != null || legacyYtdTax.value != null)) {
        const firstTy = LEGACY_TAX_YEAR;
        // Each half deletes only its OWN source, and only once the destination reads back (v21.86).
        // These are the two figures that sharpen a member's tax estimate for the whole year; losing
        // them to a swallowed storage error is silent and only noticed as a wrong take-home.
        _rehomeLegacyValue(SK.ytdPay, ytdPayKey(firstTy), legacyYtdPay.value || '');
        _rehomeLegacyValue(SK.ytdTax, ytdTaxKey(firstTy), legacyYtdTax.value || '');
    }

    // Migration: legacy global hppActual (cea_hpp_actual) to per-year key
    const legacyHppActual = lsGetChecked('cea_hpp_actual');
    if (legacyHppActual.ok && legacyHppActual.value) {
        _rehomeLegacyValue('cea_hpp_actual', hppActualKey(LEGACY_TAX_YEAR), legacyHppActual.value);
    }

    // Migration (v8.88): two-part pension localStorage cleanup.
    //
    // Part A — pension rate cut-over (all users, P51+):
    //   Any period with payday ≥ May 8 2026 and pension === £154.77 (old full-period
    //   default) is updated to £147.36. Only the exact old default is patched — custom
    //   values are untouched.
    //
    // Part B — joining-period anchor bug (joiners only):
    //   ANCHOR_DATE was midnight before v8.88; it must be noon to maintain the
    //   calcProRateFactor half-day invariant. With a midnight anchor, a 20 April joiner's P51
    //   pro-ration factor was 13/28 instead of the correct 14/28, producing auto-saved
    //   pension values of £71.86 or £68.42 instead of £73.68. The old-rate noon-anchor
    //   value (£77.39) is also stale. All three are fingerprint values that cannot
    //   plausibly be intentional custom entries.
    const _v882Marker = lsGetChecked('myb_pc_pension_v882_migrated');
    if (_v882Marker.ok && !_v882Marker.value) {
        const _pensionCutover = new Date(2026, 4, 8);
        const _member = getLoggedMember();
        const _joiningP = _member?.startDate
            ? getPeriods().find((/** @type {any} */ p) => _member.startDate > p.start && _member.startDate <= p.cutoff)
            : null;

        // A MARKER IS A PROMISE THAT THE WORK IS DONE (v21.96). This patch corrects a stale pension
        // figure inside saved periods, and it stamps itself complete exactly once — so anything it
        // fails to write is never revisited, and the member keeps a wrong figure on a payslip
        // estimate for ever. It used to stamp unconditionally: `lsSet` swallows a storage failure
        // by design (iOS private mode throws on any access), and a period that would not parse was
        // caught, logged and stepped over. Both left the marker saying otherwise.
        //
        // So the marker now waits for every intended mutation to be VERIFIED — the same rule the
        // v14.11 namespace move was given, applied to the one older patch that had not inherited
        // it. Failing means running again next load, which is safe: every branch below is a
        // fingerprint match on a specific stale value, so re-running finds nothing left to do.
        let _v882Complete = true;
        getPeriods().forEach((/** @type {any} */ p) => {
            // CHECKED: a period that could not be read is not a period never saved. Taking it for
            // absent stamped the marker over a figure the patch never saw.
            const read = lsGetChecked(periodKey(p.num));
            if (!read.ok) { _v882Complete = false; return; }
            const raw = read.value;
            if (!raw) return;
            try {
                const d = JSON.parse(raw);
                let changed = false;
                if (p.payday >= _pensionCutover && d.pension === 154.77) {
                    d.pension = 147.36;
                    changed = true;
                }
                if (_joiningP && p.num === _joiningP.num && !changed) {
                    const _correctPension = parseFloat(
                        (getPensionDefault(p) * calcProRateFactor(_member.startDate, p.start, p.cutoff)).toFixed(2)
                    );
                    const _stale = new Set([71.86, 68.42, 77.39]);
                    if (_stale.has(d.pension) && d.pension !== _correctPension) {
                        d.pension = _correctPension;
                        changed = true;
                    }
                }
                if (changed && !lsSetVerified(periodKey(p.num), JSON.stringify(d))) _v882Complete = false;
            } catch(e) {
                // A period we could not read is a period we could not correct. It may hold the very
                // figure this patch exists to fix, so it must not count as done.
                _v882Complete = false;
                console.warn('[paycalc-migrations] pension patch failed for period', p.num, e);
            }
        });
        if (_v882Complete) lsSet('myb_pc_pension_v882_migrated', '1');
    }

    // Per-member namespacing (v14.11) — runs LAST, after the legacy migrations have
    // normalised the unnamespaced data. Only ACTIVATE the member's namespace here; any
    // pre-existing shared data is NOT silently claimed (it might be another member's on a
    // shared device). paycalc-app.js calls hasPendingLegacyMigration() after load and, if
    // true, prompts the member to resolve ownership via resolveLegacyMigration().
    // A question already answered may have left legacy sources that would not go: they are only
    // removed here, never offered or copied again — whoever is signed in (_tidyLeftovers).
    _tidyLeftovers('myb_pc_ns_migrated', _isLegacyPayKey);
    const _nsMember = getLoggedMember();
    // A "mine" whose copy did not finish is carried forward here — on the claimant's load only, and
    // without asking them again (they answered). On anybody else's load it is left alone.
    _resumeLegacyClaim(_nsMember?.name);
    setPaycalcNamespace(_nsMember?.name);

    // Migration (v17.86): the single back-pay blob (myb_pc_<slug>_bp_state — one pinned award) →
    // per-tax-year keys (bp_state_<year>), now that the card follows the viewed payslip's year.
    // Runs AFTER namespace activation (the blob is member-namespaced). Idempotent — once the old key
    // is gone it does nothing. The blob carries its own award-year label, so it re-homes under that
    // year with no loss (preserves an in-flight include-tick / hand-entered rates).
    try {
        const _oldBp = lsGet(`${pcPrefix()}bp_state`);
        if (_oldBp) {
            const _parsed = JSON.parse(_oldBp);
            const _yr = _parsed && typeof _parsed.year === 'string' ? _parsed.year : null;
            if (_yr) {
                const _yk = `${pcPrefix()}bp_state_${_yr.replace('/', '_')}`;
                // Re-homed only once the year key holds it. The blob can carry a hand-entered rate
                // and an in-flight include-tick, i.e. money the member typed in themselves. The year
                // key is read checked: one that could not be read is never written over.
                _rehomeLegacyValue(`${pcPrefix()}bp_state`, _yk, _oldBp);
            } else {
                lsDel(`${pcPrefix()}bp_state`);   // no year label — nowhere to re-home it to
            }
        }
    } catch { try { lsDel(`${pcPrefix()}bp_state`); } catch { /* storage unavailable */ } }
}
