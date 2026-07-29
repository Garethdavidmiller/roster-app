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
import { lsGet, lsSet, lsDel, lsKeys } from './ls.js';

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

/** Active member segment, e.g. 'gmiller_' or '' (unnamespaced). @type {string} */
let _nsSeg = '';

/** Slug a member name to a localStorage-safe segment: lowercase, alphanumerics only.
 *  'G. Miller' → 'gmiller'. teamMembers names are unique, so slugs do not collide. */
export function memberSlug(/** @type {string=} */ name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Slugs of every known member — used to tell a member's namespaced key
 *  (`myb_pc_<slug>_…`) apart from genuinely unnamespaced legacy data. */
const _MEMBER_SLUGS = new Set(teamMembers.map(m => memberSlug(m.name)));

/** The member slug that OWNS a paycalc key, or null when the key has no member-slug
 *  segment (i.e. genuinely unnamespaced legacy data). `myb_pc_<slug>_<tail>` belongs to
 *  <slug> only when <slug> is a real member; legacy keys (`myb_pc_rate`, `myb_pc_p43`,
 *  `myb_pc_setup_2025_26`, `myb_pc_ytd_pay_2026_27`) have a non-member first segment (or
 *  none) and classify as null. This is what stops the ownership prompt from ever treating
 *  ANOTHER member's namespaced data as claimable legacy data (v14.27 review fix).
 *  @param {string} key @returns {string|null} */
function _keyOwnerSlug(key) {
    const m = key.match(/^myb_pc_([a-z0-9]+)_/);
    return m && _MEMBER_SLUGS.has(m[1]) ? m[1] : null;
}

/** The active per-member key prefix. Every per-member paycalc key starts with this. */
export function pcPrefix() { return `myb_pc_${_nsSeg}`; }

/** Per-member storage keys. Rebuilt in place (object mutated, binding kept) whenever
 *  the namespace changes, so every module that imported SK sees the new key names. */
/** @type {{ rate:string, rates:string, code:string, sl:string, pgLoan:string, slPaidOff:string, pension:string, setup:string, ytdPay:string, ytdTax:string, grade:string }} */
export const SK = {
    rate: '', rates: '', code: '', sl: '', pgLoan: '', slPaidOff: '', pension: '', setup: '', ytdPay: '', ytdTax: '', grade: '',
};

/** Recompute the SK key strings from the active namespace. */
function _rebuildSK() {
    const p = pcPrefix();
    SK.rate    = `${p}rate`;
    SK.rates   = `${p}rates`;   // JSON object: { '2025/26': 20.74, '2026/27': 21.49 }
    SK.code    = `${p}code`;
    SK.sl      = `${p}sl`;      // undergraduate plan: 'none'|'plan1'|'plan2'|'plan4'|'plan5'
    SK.pgLoan  = `${p}pg_loan`; // separate Postgraduate Loan flag ('1' | absent) — repayable ALONGSIDE a plan
    SK.slPaidOff = `${p}sl_paid_off`; // loan fully repaid: p.num of the FIRST payslip with no deduction ('' = still repaying). Once-ever fact → member-level, not per-tax-year (v18.41)
    SK.pension = `${p}pension`;
    SK.setup   = `${p}setup`;
    SK.ytdPay  = `${p}ytd_pay`;
    SK.ytdTax  = `${p}ytd_tax`;
    SK.grade   = `${p}grade`;
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
 *   • valid JSON     → `{ data, error: false }`
 *   • malformed JSON → `{ data: null, error: true }` — the caller SURFACES it, so a corrupt period is
 *     never dropped silently from a pay estimate (the no-silent-caps principle).
 * @param {string|null|undefined} raw
 * @returns {{ data: any, error: boolean }}
 */
export function parseSavedPeriod(raw) {
    if (!raw) return { data: null, error: false };
    try { return { data: JSON.parse(raw), error: false }; }
    catch { return { data: null, error: true }; }
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
/** HPP amount-source state (mode + quick-YTD-extra + exact figure, one JSON blob) — PER TAX YEAR,
 *  keyed like hppIncKey. Lets the current-year estimate come from entered hours (default), a quick
 *  year-to-date extra-pay figure, or a hand-entered amount (v18.32). @param {{ label:string }} ty @returns {string} */
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
export const NOTICE_YTD_KEY = 'myb_pc_ytd_notice_shown';

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

/** Persist a payslip-actuals map (ISO-payday → { gross, tax, ni, sl, net, varPay })
 *  for the active member. @param {Record<string, any>} map @returns {number} count stored */
export function writePayslipActuals(map) {
    lsSet(payslipActualsKey(), JSON.stringify(map || {}));
    return Object.keys(map || {}).length;
}

/** Delete the active member's device-local payslip actuals. */
export function clearPayslipActuals() { lsDel(payslipActualsKey()); }

/** Device-level `myb_pc_*` keys that must NOT be moved into a member namespace:
 *  one-time migration guards and per-device "seen" flags. Everything else under
 *  the `myb_pc_` prefix is member-financial data and gets namespaced. */
/** Keys that describe the BROWSER, not the member — never namespaced, and never carried by a
 *  backup (paycalc-transfer.js): importing `ns_migrated` onto a fresh device would suppress the
 *  legacy-ownership prompt on a device that genuinely needs it. */
export const DEVICE_KEYS = new Set([
    'myb_pc_cea_migrated',
    'myb_pc_pension_v882_migrated',
    'myb_pc_pay_welcome_shown',
    'myb_pc_ytd_notice_shown',
    'myb_pc_ns_migrated',
]);

// ── KEY MIGRATION ─────────────────────────────────────────────────────────────
// Renames all cea_ prefixed localStorage keys to myb_pc_ in one pass.
// Idempotent: guarded by myb_pc_cea_migrated flag so it runs once per device.
/** @param {{ getPeriods: Function }} deps */
function _migrateCeaKeys({ getPeriods }) {
    if (lsGet('myb_pc_cea_migrated')) return;

    const migrate = (/** @type {string} */ oldKey, /** @type {string} */ newKey) => {
        const val = lsGet(oldKey);
        if (val !== null && !lsGet(newKey)) { lsSet(newKey, val); lsDel(oldKey); }
        else if (val !== null) { lsDel(oldKey); } // new key already present — just remove old
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
    migrate('cea_pay_welcome_shown',     'myb_pc_pay_welcome_shown');

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

    lsSet('myb_pc_cea_migrated', '1');
}

// ── PER-MEMBER NAMESPACE MIGRATION (v14.11; ownership prompt v14.25) ───────────
// Device-level, one-shot. There may be legacy unnamespaced ("shared") paycalc data
// from before per-member namespacing. We must NOT silently assign it to whoever loads
// first — on a shared device that could be another member's tax code / YTD / pension.
// So runMigrations only ACTIVATES the member's namespace; the shared data is left in
// place until the member explicitly resolves ownership via resolveLegacyMigration
// ('mine' → move it into their namespace; 'fresh' → discard it). The device flag
// myb_pc_ns_migrated is set on resolution, so the prompt appears at most once.

/** True when the device holds genuinely-unnamespaced legacy paycalc data — a key with NO
 *  known-member slug segment (and not a device key). Another member's namespaced data
 *  (owner = their slug) is explicitly NOT legacy, so it never triggers the prompt. */
function _hasUnnamespacedPaycalcData() {
    return lsKeys().some(k =>
        k.startsWith('myb_pc_') && !DEVICE_KEYS.has(k) && _keyOwnerSlug(k) === null);
}

/** Move only genuinely-unnamespaced legacy keys into memberName's namespace. Keys owned by
 *  ANY member (this one or another) are left untouched. Used by the 'mine' choice.
 *  @param {string|undefined} memberName */
function _moveLegacyToNamespace(memberName) {
    const seg = memberSlug(memberName);
    if (!seg) return;
    const nsPrefix = `myb_pc_${seg}_`;
    lsKeys().forEach(k => {                       // lsKeys() is a copy — safe to mutate in loop
        if (!k.startsWith('myb_pc_')) return;
        if (DEVICE_KEYS.has(k)) return;
        if (_keyOwnerSlug(k) !== null) return;    // belongs to a member — never move it
        const newKey = nsPrefix + k.slice('myb_pc_'.length);
        const val = lsGet(k);
        if (val !== null && lsGet(newKey) === null) lsSet(newKey, val);
        lsDel(k);
    });
}

/** Delete only genuinely-unnamespaced legacy keys. Every member's namespaced data (the
 *  current member AND any other member on a shared device) is preserved. 'fresh' choice. */
function _clearLegacyData() {
    lsKeys().forEach(k => {
        if (!k.startsWith('myb_pc_')) return;
        if (DEVICE_KEYS.has(k)) return;
        if (_keyOwnerSlug(k) !== null) return;    // belongs to a member — keep it
        lsDel(k);
    });
}

/** True when a logged-in member should be asked whether the device's shared paycalc
 *  data is theirs: shared data exists and ownership hasn't been resolved yet.
 *  @param {string|undefined} memberName @returns {boolean} */
export function hasPendingLegacyMigration(memberName) {
    if (lsGet('myb_pc_ns_migrated')) return false;
    if (!memberSlug(memberName)) return false;
    return _hasUnnamespacedPaycalcData();
}

/** Resolve the shared-data ownership prompt. 'mine' moves the data into memberName's
 *  namespace; 'fresh' discards it. Either way the namespace is (re)activated and the
 *  one-shot guard is set so the prompt never reappears.
 *  @param {string|undefined} memberName @param {'mine'|'fresh'} choice */
export function resolveLegacyMigration(memberName, choice) {
    if (choice === 'mine') _moveLegacyToNamespace(memberName);
    else if (choice === 'fresh') _clearLegacyData();
    else return;                                  // unknown choice — leave undecided
    setPaycalcNamespace(memberName);
    lsSet('myb_pc_ns_migrated', '1');
}

// ── ALL DATA MIGRATIONS ───────────────────────────────────────────────────────
// Called once at startup before loadSettings(). Order matters: key prefix
// migration runs first so all subsequent migrations read the new key names.
/**
 * @param {{ getPeriods: Function, getLoggedMember: Function, getPensionDefault: Function }} deps
 */
export function runMigrations({ getPeriods, getLoggedMember, getPensionDefault }) {
    _migrateCeaKeys({ getPeriods });

    // Migration: legacy single rate → per-tax-year rates
    if (!lsGet(SK.rates)) {
        const legacyRate = lsGet(SK.rate);
        if (legacyRate) {
            const rates = /** @type {Record<string, number>} */ ({});
            TAX_YEARS.forEach(ty => { rates[ty.label] = parseFloat(legacyRate); });
            lsSet(SK.rates, JSON.stringify(rates));
        }
    }

    // Migration: legacy global YTD values (myb_pc_ytd_pay / ytd_tax) to per-year keys
    const legacyYtdPay = lsGet(SK.ytdPay);
    const legacyYtdTax = lsGet(SK.ytdTax);
    if (legacyYtdPay != null || legacyYtdTax != null) {
        const firstTy = TAX_YEARS[0];
        if (!lsGet(ytdPayKey(firstTy))) lsSet(ytdPayKey(firstTy), legacyYtdPay || '');
        if (!lsGet(ytdTaxKey(firstTy))) lsSet(ytdTaxKey(firstTy), legacyYtdTax || '');
        lsDel(SK.ytdPay);
        lsDel(SK.ytdTax);
    }

    // Migration: legacy global hppActual (cea_hpp_actual) to per-year key
    const legacyHppActual = lsGet('cea_hpp_actual');
    if (legacyHppActual) {
        const firstTy = TAX_YEARS[0];
        if (!lsGet(hppActualKey(firstTy))) lsSet(hppActualKey(firstTy), legacyHppActual);
        lsDel('cea_hpp_actual');
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
    //   calcProRateFactor half-day invariant. With a midnight anchor, M. Okeke's P51
    //   pro-ration factor was 13/28 instead of the correct 14/28, producing auto-saved
    //   pension values of £71.86 or £68.42 instead of £73.68. The old-rate noon-anchor
    //   value (£77.39) is also stale. All three are fingerprint values that cannot
    //   plausibly be intentional custom entries.
    if (!lsGet('myb_pc_pension_v882_migrated')) {
        const _pensionCutover = new Date(2026, 4, 8);
        const _member = getLoggedMember();
        const _joiningP = _member?.startDate
            ? getPeriods().find((/** @type {any} */ p) => _member.startDate > p.start && _member.startDate <= p.cutoff)
            : null;

        getPeriods().forEach((/** @type {any} */ p) => {
            const raw = lsGet(periodKey(p.num));
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
                if (changed) lsSet(periodKey(p.num), JSON.stringify(d));
            } catch(e) { console.warn('[paycalc-migrations] pension patch failed for period', p.num, e); }
        });
        lsSet('myb_pc_pension_v882_migrated', '1');
    }

    // Per-member namespacing (v14.11) — runs LAST, after the legacy migrations have
    // normalised the unnamespaced data. Only ACTIVATE the member's namespace here; any
    // pre-existing shared data is NOT silently claimed (it might be another member's on a
    // shared device). paycalc-app.js calls hasPendingLegacyMigration() after load and, if
    // true, prompts the member to resolve ownership via resolveLegacyMigration().
    const _nsMember = getLoggedMember();
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
                if (!lsGet(_yk)) lsSet(_yk, _oldBp);
            }
            lsDel(`${pcPrefix()}bp_state`);
        }
    } catch { try { lsDel(`${pcPrefix()}bp_state`); } catch { /* storage unavailable */ } }
}
