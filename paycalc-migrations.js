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
function _memberSlug(/** @type {string=} */ name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The active per-member key prefix. Every per-member paycalc key starts with this. */
export function pcPrefix() { return `myb_pc_${_nsSeg}`; }

/** Per-member storage keys. Rebuilt in place (object mutated, binding kept) whenever
 *  the namespace changes, so every module that imported SK sees the new key names. */
/** @type {{ rate:string, rates:string, code:string, sl:string, pension:string, setup:string, ytdPay:string, ytdTax:string, grade:string }} */
export const SK = {
    rate: '', rates: '', code: '', sl: '', pension: '', setup: '', ytdPay: '', ytdTax: '', grade: '',
};

/** Recompute the SK key strings from the active namespace. */
function _rebuildSK() {
    const p = pcPrefix();
    SK.rate    = `${p}rate`;
    SK.rates   = `${p}rates`;   // JSON object: { '2025/26': 20.74, '2026/27': 21.50 }
    SK.code    = `${p}code`;
    SK.sl      = `${p}sl`;
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
    _nsSeg = memberName ? `${_memberSlug(memberName)}_` : '';
    _rebuildSK();
}

/** @param {number} pNum @returns {string} */
export function periodKey(pNum)   { return `${pcPrefix()}p${pNum}`; }
/** @param {{ label:string }} ty @returns {string} */
export function hppEstKey(ty)     { return `${pcPrefix()}hpp_est_${ty.label.replace('/', '_')}`; }
/** @param {{ label:string }} ty @returns {string} */
export function hppActualKey(ty)  { return `${pcPrefix()}hpp_actual_${ty.label.replace('/', '_')}`; }
/** @param {{ label:string }} ty @returns {string} */
export function ytdPayKey(ty)     { return `${pcPrefix()}ytd_pay_${ty.label.replace('/', '_')}`; }
/** @param {{ label:string }} ty @returns {string} */
export function ytdTaxKey(ty)     { return `${pcPrefix()}ytd_tax_${ty.label.replace('/', '_')}`; }

/** localStorage key: YTD notice seen-flag (set when the YTD notice is dismissed).
 *  Device-level — not namespaced. */
export const NOTICE_YTD_KEY = 'myb_pc_ytd_notice_shown';

/** Device-level `myb_pc_*` keys that must NOT be moved into a member namespace:
 *  one-time migration guards and per-device "seen" flags. Everything else under
 *  the `myb_pc_` prefix is member-financial data and gets namespaced. */
const DEVICE_KEYS = new Set([
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

// ── PER-MEMBER NAMESPACE MIGRATION (v14.11) ───────────────────────────────────
// One-shot, device-level. The FIRST member to load paycalc after this ships
// inherits the existing (shared) unnamespaced data under their own namespace;
// every other member on the same device then starts with a clean calculator and
// is isolated going forward. This is the intended outcome for a shared device —
// the pre-migration data was never separated by member, so freezing it under the
// first signed-in member (and clearing the shared copy) is the safe resolution.
// Guarded by the device flag myb_pc_ns_migrated so it runs exactly once per device.
/** @param {string|undefined} memberName */
function _migrateToNamespace(memberName) {
    if (lsGet('myb_pc_ns_migrated')) return;     // already run on this device
    const seg = _memberSlug(memberName);
    if (!seg) return;                            // no logged-in member — defer until one loads
    const nsPrefix = `myb_pc_${seg}_`;
    // Snapshot first: lsKeys() returns a copy, so deleting keys mid-loop is safe.
    lsKeys().forEach(k => {
        if (!k.startsWith('myb_pc_')) return;    // not a paycalc key
        if (DEVICE_KEYS.has(k)) return;          // device-level — keep unnamespaced
        if (k.startsWith(nsPrefix)) return;      // already namespaced (defensive)
        const newKey = nsPrefix + k.slice('myb_pc_'.length);
        const val = lsGet(k);
        if (val !== null && lsGet(newKey) === null) lsSet(newKey, val);
        lsDel(k);                                // remove the shared unnamespaced copy
    });
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
            } catch(e) { console.warn('paycalc-migrations: pension patch failed for period', p.num, e); }
        });
        lsSet('myb_pc_pension_v882_migrated', '1');
    }

    // Per-member namespacing (v14.11) — runs LAST, after every legacy migration has
    // normalised the unnamespaced data. _migrateToNamespace moves this member's data
    // into their namespace (one-shot); setPaycalcNamespace then activates it so
    // loadSettings() and all later reads/writes resolve to the member's keys.
    const _nsMember = getLoggedMember();
    _migrateToNamespace(_nsMember?.name);
    setPaycalcNamespace(_nsMember?.name);
}
