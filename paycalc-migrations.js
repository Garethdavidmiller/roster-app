// @ts-check
/**
 * paycalc-migrations.js — localStorage storage keys and data migrations for the Pay Calculator.
 *
 * Exports storage key constants (SK, periodKey, etc.) used by paycalc.js for
 * all per-setting and per-period data. Also exports runMigrations(), called
 * once at startup before loadSettings() to rename legacy keys and patch stale values.
 *
 * Pure localStorage — no DOM, no Firebase.
 * @module paycalc-migrations
 */

import { TAX_YEARS, calcProRateFactor } from './paycalc-calc.js';
import { lsGet, lsSet, lsDel } from './ls.js';

// ── STORAGE KEYS ──────────────────────────────────────────────────────────────
// Keys use the myb_pc_ prefix (previously cea_ — migrated in _migrateCeaKeys below).
/** @type {{ rate:string, rates:string, code:string, sl:string, pension:string, setup:string, ytdPay:string, ytdTax:string, grade:string }} */
export const SK = {
    rate:    'myb_pc_rate',
    rates:   'myb_pc_rates',   // JSON object: { '2025/26': 20.74, '2026/27': 21.50 }
    code:    'myb_pc_code',
    sl:      'myb_pc_sl',
    pension: 'myb_pc_pension',
    setup:   'myb_pc_setup',
    ytdPay:  'myb_pc_ytd_pay',
    ytdTax:  'myb_pc_ytd_tax',
    grade:   'myb_pc_grade',
};

/** @param {number} pNum @returns {string} */
export function periodKey(pNum)   { return `myb_pc_p${pNum}`; }
/** @param {{ label:string }} ty @returns {string} */
export function hppEstKey(ty)     { return `myb_pc_hpp_est_${ty.label.replace('/', '_')}`; }
/** @param {{ label:string }} ty @returns {string} */
export function hppActualKey(ty)  { return `myb_pc_hpp_actual_${ty.label.replace('/', '_')}`; }
/** @param {{ label:string }} ty @returns {string} */
export function ytdPayKey(ty)     { return `myb_pc_ytd_pay_${ty.label.replace('/', '_')}`; }
/** @param {{ label:string }} ty @returns {string} */
export function ytdTaxKey(ty)     { return `myb_pc_ytd_tax_${ty.label.replace('/', '_')}`; }

/** localStorage key: YTD notice seen-flag (set when the YTD notice is dismissed). */
export const NOTICE_YTD_KEY = 'myb_pc_ytd_notice_shown';

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
}
