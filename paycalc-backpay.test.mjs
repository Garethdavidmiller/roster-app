/**
 * paycalc-backpay.test.mjs — the back-pay lump sum, ASSEMBLED.
 *
 * Run: node --experimental-test-module-mocks --test paycalc-backpay.test.mjs   (`npm run test:unit`)
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────────────────
 *
 * The RULES under `calcBackPay` were extracted and tested years ago — `_accrueBackPayPeriod` does the
 * money, `awardWindowFactor` scales the first period, `resolveAuthoritativeRates` decides which
 * figures are on record, `paidInPeriodNum` finds the payslip. Every one of them is pure and pinned.
 * The ASSEMBLY had nothing: one 300-line DOM-bound function reading eleven inputs off the page,
 * filtering the period grid four ways and handing the result back to the coordinator, with no test
 * of any kind. That is the "rule tested, the wiring not" risk CLAUDE.md names, on the app's largest
 * single money figure, and a v23.63 mutation sweep found two probes inside it that survived.
 *
 * It is testable at all because `calcBackPay` needs only `document.getElementById`,
 * `document.querySelector` and localStorage — no layout, no events, no Firebase. A fake `document`
 * of about twenty stub elements drives the real function to its real return value.
 *
 * ── ORGANISED BY WHAT A WRONG ANSWER COSTS ──────────────────────────────────────────────────────
 *
 * This figure is money the member is owed, arriving once a year on one payslip, and the app is their
 * only way to check it before it lands. The directions are not symmetrical:
 *
 *   · TOO HIGH is the one with history. Counting the first period of the award window WHOLE made the
 *     lump 19% high — £977.69 against the £821.68 actually paid (VAL-PAY-001). A member who has been
 *     shown £977 has a grievance the payroll office cannot settle, and nothing about the number looks
 *     wrong. Every filter in the loop can produce it: a period past the award date, the paid-in
 *     payslip itself, a period from another tax year.
 *   · TOO LOW is quieter but not harmless: the member is told they are owed less than they are and
 *     has no reason to query the payslip.
 *   · CLAIMED WITHOUT A PAYSLIP TO PUT IT ON is the third, and it is the one that reaches the
 *     take-home figure: `calcBackPay`'s return feeds the opt-in tick, so a non-zero lump with no
 *     paid-in period would land the money on whatever payslip happened to be on screen.
 *
 * THE EXPECTED FIGURES ARE DERIVED, never written down: the award window is rebuilt from the tax-year
 * table and the award date, and priced with the same pure accrual the loop calls. A hardcoded £ would
 * have to be re-typed on every pay award, which is exactly when this file most needs to be true.
 *
 * ── WHY THE CLOCK IS NOT MOCKED ─────────────────────────────────────────────────────────────────
 *
 * `calcBackPay` reads `todaysPeriodNum()`, which reads the real clock, in `Math.min(bpPNum - 1,
 * todaysPeriodNum())`. Every case here uses the 2026/27 award, whose paid-in payslip is 28 Aug 2026
 * — so `bpPNum - 1` is the smaller of the two for any date after that, and time only moves forward.
 * The cap is therefore deterministic without a clock seam, and `the window is closed by the award
 * date` asserts the assumption rather than resting on it.
 */
import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const _ls = new Map();
/** @type {any} */
let _session = { name: 'Z. Member' };
/** @type {any[]} */
const _members = [];

mock.module('./firebase-client.js', { namedExports: {
    auth: {}, authReady: Promise.resolve(), onAuthStateChanged: () => () => {},
    signInWithEmailAndPassword: async () => {}, createUserWithEmailAndPassword: async () => {},
    signInAnonymously: async () => {}, signOut: async () => {}, db: null,
    collection: () => {}, query: () => {}, where: () => {},
    getDocs: async () => ({ forEach: () => {}, docs: [] }),
    COLLECTIONS: { overrides: 'overrides', clientErrors: 'clientErrors' },
    nameToEmail: (/** @type {string} */ n) => n + '@test', normaliseSurname: (/** @type {string} */ n) => n,
} });
mock.module('./session.js', { namedExports: {
    AUTH_KEY: 'myb_admin_session', SESSION_MS: 1,
    getSession: () => _session, saveSession: () => {}, clearSession: async () => {},
    ensureFirebaseSession: async () => {}, sessionReady: Promise.resolve(),
    resolveSession: () => {}, getSurname: () => '',
} });
mock.module('./ls.js', { namedExports: {
    lsGet: (/** @type {string} */ k) => _ls.has(k) ? _ls.get(k) : null,
    lsSet: (/** @type {string} */ k, /** @type {any} */ v) => { _ls.set(k, String(v)); },
    lsDel: (/** @type {string} */ k) => { _ls.delete(k); },
    lsKeys: () => [..._ls.keys()],
    lsSetVerified: (/** @type {string} */ k, /** @type {any} */ v) => { _ls.set(k, String(v)); return true; },
    lsMove: (/** @type {string} */ a, /** @type {string} */ b, /** @type {any} */ v) => {
        const val = v === undefined ? (_ls.has(a) ? _ls.get(a) : null) : v;
        if (val === null) return false;
        _ls.set(b, String(val)); _ls.delete(a); return true;
    },
} });
// The REAL role → grade rule (roster-data.js since v24.86), so the mock cannot restate it.
const { gradeForRole: _realGradeForRole } = await import('./roster-data.js?real');
mock.module('./roster-data.js', { namedExports: {
    teamMembers: _members, APP_VERSION: '13.00', gradeForRole: _realGradeForRole,
    CONFIG: { ADMIN_NAMES: [], LINKS_DESIGNERS: [], MAX_YEAR: 2027, MIN_YEAR: 2025 },
    formatISO: (/** @type {Date} */ d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    // The REAL smart-float semantics: a £ string with separators parses, garbage is 0. A stub that
    // returned the raw string would make every figure below NaN and the suite would say so; one that
    // returned a number unconditionally would hide the card's own empty-box handling.
    parseSmartFloat: (/** @type {any} */ v) => {
        const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
        return Number.isFinite(n) ? n : 0;
    },
    parseSmartFloatOrNull: (/** @type {any} */ v) => {
        const n = parseFloat(String(v));
        return Number.isFinite(n) ? n : null;
    },
} });
mock.module('./paycalc-roster-suggestions.js', { namedExports: {
    bhsForYear: () => [], getRosterSuggestion: async () => ({}), fetchOverridesForPeriod: async () => {},
} });

// ── a fake document ─────────────────────────────────────────────────────────────────────────────
// Everything `calcBackPay` touches and nothing it does not. The stubs RECORD what was written —
// `textContent`, `innerHTML`, `value`, `readOnly` — because half of what this function does is say
// what it did, and a harness that discarded those could not tell a £476 lump from a £0 one.
/** @type {Record<string, any>} */
const els = {};
const doc = {
    getElementById: (/** @type {string} */ id) => els[id] ?? null,
    querySelector: (/** @type {string} */ sel) =>
        (sel === 'input[name="bpMode"]:checked'
            ? (els.bpModeManual?.checked ? els.bpModeManual : (els.bpModeCompute?.checked ? els.bpModeCompute : null))
            : null),
    createElement: () => node(),
    createTextNode: (/** @type {string} */ t) => ({ nodeText: String(t) }),
};
function node(id = '') {
    return {
        id, ownerDocument: doc, value: '', checked: false, readOnly: false, disabled: false, hidden: false,
        style: /** @type {Record<string, string>} */ ({}), options: /** @type {any[]} */ ([]),
        classList: {
            _s: new Set(),
            add(/** @type {string} */ c) { this._s.add(c); },
            remove(/** @type {string} */ c) { this._s.delete(c); },
            toggle(/** @type {string} */ c, /** @type {boolean} */ on) { if (on) this._s.add(c); else this._s.delete(c); },
            contains(/** @type {string} */ c) { return this._s.has(c); },
        },
        attrs: /** @type {Record<string, string>} */ ({}), kids: /** @type {any[]} */ ([]), _t: '', _h: '',
        set textContent(v) { this._t = String(v); this.kids = []; },
        get textContent() { return this._t + this.kids.map((/** @type {any} */ k) => k.nodeText ?? k.textContent ?? '').join(''); },
        set innerHTML(v) { this._h = String(v); },
        get innerHTML() { return this._h; },
        setAttribute(/** @type {string} */ k, /** @type {any} */ v) { this.attrs[k] = String(v); },
        getAttribute(/** @type {string} */ k) { return this.attrs[k] ?? null; },
        appendChild(/** @type {any} */ k) { this.kids.push(k); return k; },
        append(/** @type {any[]} */ ...k) { this.kids.push(...k); },
        closest() { return null; },
        dispatchEvent() { return true; },
        scrollHeight: 100,
    };
}
/**
 * A `<select>` stub whose `value` follows its options, because that is how `_setSelectPeriod`
 * moves it: it sets `selected` on an option and fires no event, so a plain `{ value }` stub reads
 * back whatever the test wrote and the derive-the-paid-in-payslip rule cannot be seen at all.
 */
function selectNode(/** @type {string} */ id) {
    const n = node(id);
    let _v = '';
    Object.defineProperty(n, 'value', {
        get() { const sel = n.options.filter((/** @type {any} */ o) => o.selected).pop(); return sel ? sel.value : _v; },
        set(v) { _v = String(v); n.options.forEach((/** @type {any} */ o) => { o.selected = o.value === _v; }); },
        configurable: true,
    });
    return n;
}

const IDS = [
    'backPayRows', 'backPayTotal', 'backPayTotalAmt', 'backPayTotalBasis', 'backPayNotice',
    'bpBreakdownBtn', 'oldRate', 'newRateInput', 'oldLondon', 'newLondon', 'backPayPeriod',
    'bpIncludeTick', 'bpManualAmt', 'bpModeManual', 'bpModeCompute', 'bpAwardScope',
    'backPayTotalLabel', 'backPayPeriodWrap', 'bpEstimateNote', 'bpOrderWarn', 'bpRatesLine',
    'bpRateField', 'bpLondonField', 'bpRisePctField', 'bpModeManualWhy', 'bpComputeFields',
    'bpManualWrap', 'periodSelect', 'bpRisePct',
];
globalThis.document = /** @type {any} */ (doc);

/** The card itself, made ONCE and never replaced by `openCard`: the module wires its member-edit
 *  tracking to it on first use, so a card rebuilt per test would leave the listeners on a stale node.
 *  @type {Record<string, Function[]>} */
const _cardListeners = {};
els.backPayCard = { addEventListener: (/** @type {string} */ type, /** @type {Function} */ fn) => { (_cardListeners[type] ??= []).push(fn); } };
/** An event reaching the card as the member's own does (`bubbles`), or as the app's own
 *  `_setSelectPeriod` announces a paid-in it set (non-bubbling `input`). */
function cardEvent(/** @type {string} */ type, /** @type {boolean} */ bubbles) {
    for (const fn of _cardListeners[type] ?? []) fn({ type, bubbles });
}

const { SK, periodKey, bpKey } = await import('./paycalc-migrations.js');
const { getPeriods, CONFIG: PERIOD_CONFIG, payslipPeriodNum } = await import('./paycalc-periods.js');
const { awardRatesFor, awardFromForYear } = await import('./paycalc-calc.js');
const { resolveAuthoritativeRates } = await import('./paycalc-backpay-state.js');
const { calcBackPay, prefillBackPay, restoreBpState, raiseByPercent, _accrueBackPayPeriod, awardWindowFactor, _awardBackdateDate, paidInPeriodNum } =
    await import('./paycalc-backpay.js');
const { getEffectiveContr, getProRateFactor } = await import('./paycalc-settings.js');
const { _decodeHours } = await import('./paycalc-hpp.js');
const { fd } = await import('./paycalc-format.js');

// ── the 2026/27 award ───────────────────────────────────────────────────────────────────────────
const TY = PERIOD_CONFIG.TAX_YEARS.find(/** @param {any} t */ t => t.label === '2026/27');
const AWARD_FROM = awardFromForYear(TY.label);
const PERIODS = getPeriods();
const YEAR_PERIODS = PERIODS.filter(/** @param {any} p */ p => p.num - 48 >= TY.first && p.num - 48 <= TY.last);
/** The payslip the lump lands on — derived the way the card derives it. */
const PAID_IN = paidInPeriodNum(PERIODS, AWARD_FROM);
/**
 * The window, stated INDEPENDENTLY of the loop's own filters: every payslip of the award's tax year
 * paid before the award was applied. The loop reaches the same set by three separate tests; if it
 * stops doing so, the totals below move.
 */
const WINDOW = YEAR_PERIODS.filter(/** @param {any} p */ p => p.payday < AWARD_FROM);

/** Price the window with the same pure accrual `calcBackPay` calls, at the rates on record. */
function expectedLump({ windowFactor = true, round = true, rates = null } = {}) {
    const auth = resolveAuthoritativeRates(TY, awardRatesFor('cea', TY.label));
    const rateDiff = rates ? rates.rateDiff : /** @type {number} */ (auth.newRateInput) - /** @type {number} */ (auth.oldRate);
    const londonDiff = rates ? rates.londonDiff : /** @type {number} */ (auth.newLondon) - /** @type {number} */ (auth.oldLondon);
    const backdate = _awardBackdateDate(TY);
    let total = 0;
    const rows = [];
    for (const p of WINDOW) {
        const { backPay } = _accrueBackPayPeriod({
            effContr: getEffectiveContr(p),
            proRateFactor: getProRateFactor(p),
            windowFactor: windowFactor ? awardWindowFactor(p, backdate) : 1,
            peer: 0,
            rateDiff, londonDiff,
            hours: _decodeHours(p, {}),
        });
        if (backPay > 0) {
            const row = round ? Math.round(backPay * 100) / 100 : backPay;
            total += row;
            rows.push({ p, row });
        }
    }
    return { total: Math.round(total * 1e6) / 1e6, rows, rateDiff, londonDiff };
}

/** Reset the fake page and storage to a compute-mode card viewing a 2026/27 payslip. */
function openCard({ mode = 'compute', viewed = YEAR_PERIODS[6], paidIn = PAID_IN } = {}) {
    for (const id of IDS) els[id] = node(id);
    els.backPayPeriod = selectNode('backPayPeriod');
    // The radios carry the VALUE `_bpMode()` reads off them — without it the mode is always ''
    // (i.e. compute) and manual mode is untestable while looking tested.
    els.bpModeCompute.value = 'compute';
    els.bpModeManual.value = 'manual';
    _ls.clear();
    _ls.set(SK.grade, 'cea');
    _members.length = 0;
    _session = { name: 'Z. Member' };
    els.periodSelect.value = String(viewed.num);
    els.backPayPeriod.options = PERIODS.map(/** @param {any} x */ x => ({ value: String(x.num), selected: false }));
    els.backPayPeriod.value = paidIn == null ? '' : String(paidIn);
    els.bpModeCompute.checked = mode === 'compute';
    els.bpModeManual.checked = mode === 'manual';
    // Deliberately WRONG figures in the four rate boxes. A settled award is on record, so
    // `calcBackPay` must overwrite them — if it ever priced off what the page happened to hold, the
    // totals below would be built from these.
    els.oldRate.value = '1.00';
    els.newRateInput.value = '2.00';
    els.oldLondon.value = '3.00';
    els.newLondon.value = '4.00';
}

beforeEach(() => openCard());

// ── THE FIGURE ──────────────────────────────────────────────────────────────────────────────────

describe('the lump a member is actually shown', () => {
    test('the real card, end to end, produces the window priced at the rates on record', () => {
        const exp = expectedLump();
        assert.ok(exp.total > 100, 'the fixture window accrues almost nothing — nothing below would mean anything');

        const out = calcBackPay();

        assert.equal(out.bpPNum, PAID_IN, 'the lump was put on the wrong payslip');
        assert.ok(Math.abs(out.bpAmount - exp.total) < 0.005,
            `the card returned £${out.bpAmount.toFixed(2)} for a window worth £${exp.total.toFixed(2)}`);
        assert.equal(out.bpIsEstimate, false, 'the 2026/27 award is confirmed — it must not be labelled an estimate');
        assert.equal(out.bpIncluded, false, 'the opt-in tick is off, so the lump must not be marked as included');

        // The hero states the same figure it returned. They are written from one variable today, and
        // the reason to assert both is that the member reads one and the take-home uses the other.
        assert.match(els.backPayTotalAmt.textContent, new RegExp(`^£${exp.total.toFixed(2).replace('.', '\\.')}`),
            `the hero read "${els.backPayTotalAmt.textContent}"`);
        assert.equal(els.backPayTotal.style.display, 'block', 'the total was computed and then not shown');
    });

    test('a settled award OVERWRITES the rate boxes rather than pricing off whatever is in them', () => {
        // The fixture puts £1.00 → £2.00 in the boxes. A card that trusted them would return a lump
        // built from a £1 rise, which is a plausible-looking number nobody could trace.
        const exp = expectedLump();
        const out = calcBackPay();
        assert.equal(Number(els.oldRate.value), awardRatesFor('cea', TY.label).pre);
        assert.equal(Number(els.newRateInput.value), awardRatesFor('cea', TY.label).rate);
        assert.equal(els.oldRate.readOnly, true, 'a figure on record must be locked as well as written');
        // What the card WOULD have returned had it priced off the boxes as it found them: a £1.00
        // rise and a £1.00 London step. Both figures are plausible lumps; only one is the member's.
        const fromTheBoxes = expectedLump({ rates: { rateDiff: 1, londonDiff: 1 } }).total;
        assert.ok(Math.abs(out.bpAmount - exp.total) < 0.005);
        assert.ok(Math.abs(out.bpAmount - fromTheBoxes) > 50,
            `pricing off the fixture's own boxes gives £${fromTheBoxes.toFixed(2)}, too close to £${out.bpAmount.toFixed(2)} to prove anything`);
    });

    test('one row per payslip, and the rows sum EXACTLY to the headline', () => {
        // The member cross-checks the breakdown against the hero by hand, so the headline is summed
        // from PENNY-ROUNDED rows and not from the raw accruals. The fixture deliberately carries
        // untidy minutes on several payslips: with whole hours every accrual here lands on an exact
        // penny and the rounding is invisible, which is how a total a penny adrift from the rows
        // printed beneath it could ship. Equality, not a tolerance — a tolerance is the thing being
        // tested.
        for (const [i, p] of WINDOW.entries()) {
            _ls.set(periodKey(p.num), JSON.stringify({ otH: 3, otM: 7 + i, sunH: 2, sunM: 23 }));
        }
        const out = calcBackPay();
        const printed = [...els.backPayRows.innerHTML.matchAll(/class="bp-val">£([\d,]+\.\d\d)</g)]
            .map(m => Number(m[1].replace(/,/g, '')));
        assert.equal(printed.length, WINDOW.length, 'the breakdown does not list one row per payslip in the window');

        const summed = printed.reduce((a, b) => a + b, 0);
        assert.ok(Math.abs(summed - out.bpAmount) < 1e-6,
            `the rows add up to £${summed.toFixed(4)} under a headline of £${out.bpAmount.toFixed(4)}`);
        // Guard on the guard: the accruals must actually have sub-penny tails, or an unrounded sum
        // would equal the rounded one and this case would pass on arithmetic rather than on the rule.
        const raw = expectedLump({ round: false }).total;
        assert.ok(Math.abs(raw - summed) > 1e-9,
            'every accrual in the fixture is already an exact penny — the rounding is not being exercised');

        assert.match(els.backPayTotalBasis.textContent, new RegExp(`^${WINDOW.length} periods? backdated`),
            `the basis line read "${els.backPayTotalBasis.textContent}"`);
    });
});

// ── THE WINDOW ──────────────────────────────────────────────────────────────────────────────────

// THE LOWER END OF THE WINDOW IS HELD BY ONE LINE, AND IT IS NOT THE ONE THAT LOOKS LIKE IT.
// Three statements appear to bound the window from below — `if (fromPNum && p.num < fromPNum)`, the
// tax-year fence `getTaxYearForOffset(p.num - 48) !== awardTy`, and `awardWindowFactor`. Deleting
// EITHER of the first two leaves every case here green, and deleting both together does too.
// `awardWindowFactor` returns 0 for a period whose cut-off falls before the backdate, so a March
// payslip accrues £0 and is never rowed. The two guards are cheap and correct and worth keeping —
// they stop the loop rather than pricing it to nothing — but the money property is the factor's, and
// that is the line the first case below pins. Recorded rather than hidden behind cases invented to
// make each guard look protected.
describe('which payslips the window contains', () => {
    test('the FIRST payslip of the award year is a fraction of the others', () => {
        // Invariant 14 (VAL-PAY-001). A period is 28 days of shifts and the award backdates to
        // 1 April, so the year's first payslip is mostly March work and owes only the days from the
        // 1st. Counting it whole made the app 19% high against the real payslip — and the line that
        // does it, `windowFactor: awardWindowFactor(p, _backdateDate)`, carries a comment saying
        // deleting it leaves every unit test green. It no longer does.
        const exp = expectedLump();
        const flat = expectedLump({ windowFactor: false });
        assert.ok(flat.total - exp.total > 50,
            `the first period's fraction is worth only £${(flat.total - exp.total).toFixed(2)} here — too little to prove anything`);

        const out = calcBackPay();
        assert.ok(Math.abs(out.bpAmount - exp.total) < 0.005);
        assert.ok(Math.abs(out.bpAmount - flat.total) > 50,
            'the card priced the first payslip of the year as a whole period');

        // …and the fraction is visible in the breakdown, which is where a member would see it: the
        // first row is a small part of the second.
        const printed = [...els.backPayRows.innerHTML.matchAll(/class="bp-val">£([\d,]+\.\d\d)</g)]
            .map(m => Number(m[1].replace(/,/g, '')));
        assert.ok(printed.length >= 2, 'need at least two rows to compare');
        assert.ok(printed[0] < printed[1] / 2, `first row £${printed[0]} is not a fraction of £${printed[1]}`);
    });

    test('the window is closed by the award date, and the paid-in payslip is not in it', () => {
        const out = calcBackPay();
        const lastRow = WINDOW[WINDOW.length - 1];
        assert.ok(lastRow.payday < AWARD_FROM);
        assert.ok(lastRow.num < PAID_IN, 'the last window payslip is not before the paid-in one');
        // In the month the lump lands you are already paid at the new rate, so that payslip owes
        // nothing — and every payslip after it likewise. Asserted as a COUNT of rows, because the
        // £ assertions above would also pass if the loop stopped one period early for another reason.
        assert.equal(
            [...els.backPayRows.innerHTML.matchAll(/class="bp-lbl"/g)].length,
            WINDOW.length,
            'the breakdown covers a different set of payslips from the award window',
        );
        assert.ok(out.bpAmount > 0);
    });

    test('nothing on or after the award date accrues — asserted JOINTLY, and here is why', () => {
        // TWO filters do this, and while every award in `TAX_YEARS` has a payment date on record
        // they are REDUNDANT with each other, so neither can be pinned alone:
        //
        //   · `_capPNum = Math.min(bpPNum - 1, todaysPeriodNum())` — the paid-in payslip is excluded
        //     because in the month the lump lands you are already paid at the new rate.
        //   · `if (_awardFrom && p.payday >= _awardFrom) return` — a payslip already paid at the new
        //     rate owes no arrears.
        //
        // A decided award DERIVES its paid-in payslip as the first payday on or after the award date,
        // so `bpPNum - 1` and "before the award date" name the same last payslip, always. Deleting
        // either one on its own leaves this whole file green, and that is recorded rather than
        // papered over with a case that cannot occur: the two would only separate for an award with
        // no payment date on record, where the selector is honoured instead, and no such award exists
        // in the table today. What IS worth holding is the property they jointly deliver, which is
        // the one a member would feel — arrears claimed for a payslip that already carried the rise.
        const out = calcBackPay();
        const labels = [...els.backPayRows.innerHTML.matchAll(/class="bp-lbl">([^<]+)</g)].map(m => m[1]);
        const beyond = YEAR_PERIODS.filter(/** @param {any} p */ p => p.payday >= AWARD_FROM);
        assert.ok(beyond.length > 0, 'the award lands after the last payslip of its year — this case proves nothing');
        for (const p of beyond) {
            assert.ok(!labels.some(l => l.endsWith(`· P${payslipPeriodNum(p)}`)),
                `P${payslipPeriodNum(p)} was paid on/after the award and still accrued arrears`);
        }
        assert.equal(labels.length, WINDOW.length);
        assert.ok(out.bpAmount > 0);
    });

    test('a payslip from the PREVIOUS tax year never joins this award', () => {
        // Without a fence a March payslip — belonging to last year's award — would accrue this year's
        // rise as well as its own. THREE things keep it out, and each is redundant with the others for
        // an earlier year: the window's lower bound (`p.num < fromPNum`), the tax-year fence
        // (`getTaxYearForOffset(p.num - 48) !== awardTy`), and `awardWindowFactor`, which is 0 for a
        // period wholly before 1 April. Deleting any one, or both loop fences together, leaves this file
        // green (test audit, 7 Nov 2026), and that is recorded rather than papered over. What this holds
        // is the property they jointly deliver, which is what a member would feel.
        const march = PERIODS.filter(/** @param {any} p */ p => p.num < YEAR_PERIODS[0].num);
        assert.ok(march.length > 0, 'the grid holds no earlier periods — this case proves nothing');
        calcBackPay();
        // Read AFTER the card has run. This loop used to look at the breakdown BEFORE calcBackPay(),
        // when beforeEach had just emptied it, so it could not fail. And by DATE: the printed payslip
        // number restarts every April, so last year's P4 and this year's P4 print alike.
        const printed = [...els.backPayRows.innerHTML.matchAll(/class="bp-lbl">([^<]+)</g)].map(m => m[1]);
        for (const p of march) {
            assert.ok(!WINDOW.includes(p));
            assert.ok(!printed.some(l => l.startsWith(`${fd(p.payday)} ·`)),
                `the ${fd(p.payday)} payslip, from before the award year, appeared in the breakdown`);
        }
        assert.deepEqual(printed, WINDOW.map(/** @param {any} p */ p => `${fd(p.payday)} · P${payslipPeriodNum(p)}`),
            'the breakdown is exactly the award window, one row per payslip, in order');
    });

    test('an entered payslip raises the lump; the same window with no hours is the floor', () => {
        // The window periods have no saved hours in the fixture, so they accrue contracted arrears
        // only — a normal week is owed the rise whether or not the member has filled it in. Saving
        // premium hours into one of them must move the figure UP, or the loop is not reading storage.
        const before = calcBackPay().bpAmount;
        _ls.set(periodKey(WINDOW[2].num), JSON.stringify({ otH: 20, otM: 0, sunH: 12, sunM: 0 }));
        const after = calcBackPay().bpAmount;
        assert.ok(after > before + 5, `saved premium hours moved the lump by only £${(after - before).toFixed(2)}`);
    });
});

// ── THE PAYSLIP IT LANDS ON ─────────────────────────────────────────────────────────────────────

describe('the lump is never claimed without a payslip to put it on', () => {
    test('no paid-in period → the figure is computed and reported as landing nowhere', () => {
        // `newBpPNum` gates both returned money fields. The coordinator adds `bpAmount` to whichever
        // payslip `bpPNum` names, so a non-zero amount with a zero period is money on an arbitrary
        // payslip. The card still SHOWS the total — the estimate stays discoverable — which is why
        // the on-screen figure is asserted to be non-zero in the same breath.
        openCard({ paidIn: null });
        els.backPayPeriod.options.length = 0;   // a card whose selector was never populated
        const out = calcBackPay();
        assert.equal(out.bpPNum, 0);
        assert.equal(out.bpAmount, 0, 'a lump was returned for no payslip');
        assert.equal(out.bpVarAmount, 0);
    });

    test('a decided award DERIVES its paid-in payslip and ignores a stale saved one', () => {
        // The 3.6% award moved from the 31 Jul payslip to the 28 Aug one. A saved selection pinning
        // the lump to the old payslip would put the green "includes back pay" banner on a payslip the
        // member can no longer choose, with no control on screen to correct it.
        openCard({ paidIn: YEAR_PERIODS[3].num });
        assert.notEqual(YEAR_PERIODS[3].num, PAID_IN, 'the fixture did not actually set a stale value');
        const out = calcBackPay();
        assert.equal(out.bpPNum, PAID_IN);
        assert.equal(Number(els.backPayPeriod.value), PAID_IN, 'the selector was left naming the stale payslip');
    });
});

// ── ENTER-THE-FIGURE-FROM-YOUR-PAYSLIP ──────────────────────────────────────────────────────────

describe('manual mode returns what the member typed, and nothing else', () => {
    test('the typed figure is the lump, with no accrual behind it', () => {
        openCard({ mode: 'manual' });
        els.bpManualAmt.value = '1,234.56';
        const out = calcBackPay();
        assert.equal(out.bpAmount, 1234.56);
        assert.equal(out.bpVarAmount, 0, 'manual mode has no variable-pay portion to report');
        assert.equal(out.bpIsEstimate, false);
        assert.equal(out.bpPNum, PAID_IN);
        assert.equal(els.backPayRows.innerHTML, '', 'compute-mode breakdown rows lingered under a typed figure');
        assert.match(els.backPayTotalAmt.textContent, /^£1,234\.56/);
    });

    test('an empty box reports nothing rather than a stale accrual', () => {
        openCard({ mode: 'manual' });
        els.bpManualAmt.value = '';
        const out = calcBackPay();
        assert.equal(out.bpAmount, 0);
        assert.equal(out.bpPNum, 0);
        assert.match(els.backPayNotice.textContent, /Enter the back-pay lump sum/);
    });

    test('a typed figure with no payslip to put it on is reported as landing nowhere', () => {
        // The manual branch has its own copy of the paid-in gate, and it is the branch where the
        // figure is a real number the member typed rather than something the app computed — so a
        // gate that stopped reading would put a stated £ on whatever payslip is open.
        openCard({ mode: 'manual', paidIn: null });
        els.backPayPeriod.options.length = 0;
        els.bpManualAmt.value = '1,234.56';
        const out = calcBackPay();
        assert.equal(out.bpPNum, 0);
        assert.equal(out.bpAmount, 0, 'a typed lump was handed back for no payslip');
        // The card still SHOWS it — the figure is the member's own and must not vanish — and says
        // what is missing. Only the returned amount is withheld.
        assert.match(els.backPayTotalAmt.textContent, /^£1,234\.56/);
        assert.match(els.backPayNotice.textContent, /Select which payslip/);
    });
});

// ── WHEN THE PAYSLIP'S FIGURE CAN BE COPIED (paycalc-2-3) ───────────────────────────────────────
// The one case here that moves the clock, and only inside itself: the gate is ABOUT the date.
describe('"Enter the amount from your payslip" opens once that payslip can be in hand', () => {
    const PAID = /** @type {any} */ (PERIODS.find(/** @param {any} p */ p => p.num === PAID_IN));

    test('locked before the paid-in payslip\'s cut-off, open from it — days before its payday', (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: new Date(PAID.cutoff.getTime() - 3600e3) });
        openCard();
        calcBackPay();
        assert.equal(els.bpModeManual.disabled, true, 'no printed figure exists before the cut-off');

        t.mock.timers.setTime(PAID.cutoff.getTime() + 3600e3);
        assert.ok(new Date() < PAID.payday, 'precondition: payday is still ahead, so the payday proxy would lock it');
        calcBackPay();
        assert.equal(els.bpModeManual.disabled, false,
            'payslips are issued before they pay: from the cut-off the member may hold it (payslipMayBeInHand)');
    });
});

// ── AN AWARD FLAGGED AS ACCEPTED (paycalc-2-23) ─────────────────────────────────────────────────
// The "accepted, not yet paid" branch is dormant: no year carries `rateUnconfirmed`. When the next
// one does, the percentage it opens with must be THAT year's. The old free-standing constant still
// held 2026/27's 3.6% after it was paid, so flagging any later year offered last year's rise as an
// accepted award and priced a lump from it.
describe('a year flagged as accepted opens with its own offered percentage, or none', () => {
    test('a flagged year with no percentage on record opens blank and prices nothing', () => {
        TY.rateUnconfirmed = true;   // the shape a year is in once flagged (restored below)
        try {
            openCard();
            for (const id of ['oldRate', 'newRateInput', 'oldLondon', 'newLondon', 'bpRisePct']) els[id].value = '';
            prefillBackPay();
            assert.equal(els.bpRisePct.value, '', 'no percentage is on record for this year, so none may be offered');
            // …and what the coordinator's "Pay rise %" step would then do with whatever was offered.
            const pct = parseFloat(els.bpRisePct.value);
            if (pct > 0) {
                els.newRateInput.value = raiseByPercent(parseFloat(els.oldRate.value), pct).toFixed(2);
                els.newLondon.value = raiseByPercent(parseFloat(els.oldLondon.value), pct).toFixed(2);
            }
            const out = calcBackPay();
            assert.equal(out.bpAmount, 0, 'a lump was priced from a rise nobody has announced');
            assert.doesNotMatch(els.bpAwardScope.innerHTML, /Yours is roughly/);
        } finally {
            delete TY.rateUnconfirmed;
        }
    });
});

// ── VIEWING IS NOT ENTERING (paycalc-2-6) ───────────────────────────────────────────────────────
// Every recompute used to save the card, so merely opening the page wrote back-pay state, and every
// "does this device hold pay data?" question answered yes about data nobody entered. ORDER MATTERS
// in this block: the module remembers a member's change for the rest of the page view, as it should.
describe('merely viewing writes nothing; the member\'s first change does', () => {
    test('a first visit computes the default lump and saves NOTHING', () => {
        openCard();
        assert.equal(restoreBpState(), false, 'precondition: nothing saved for this year');
        const out = prefillBackPay();
        calcBackPay();                                        // the coordinator's second pass, same tick
        assert.ok(out.bpAmount > 0, 'the default estimate is still computed, closed card or not');
        assert.equal(_ls.has(bpKey(TY)), false, 'opening the page wrote back-pay state');
    });

    test('the app announcing a paid-in it set is not the member changing the card', () => {
        openCard();
        restoreBpState();                                     // the coordinator's first call: starts the watch
        assert.ok(_cardListeners.input?.length, 'precondition: the card is being watched');
        cardEvent('input', false);                            // _setSelectPeriod's own, non-bubbling
        calcBackPay();
        assert.equal(_ls.has(bpKey(TY)), false);
    });

    test('the member\'s first change saves the card — the banner\'s tick included', () => {
        openCard();
        prefillBackPay();
        els.bpIncludeTick.checked = true;
        cardEvent('change', true);                            // the tick, as the coordinator proxies it
        calcBackPay();
        assert.ok(_ls.has(bpKey(TY)), 'a choice the member made must survive a reload');
        assert.equal(JSON.parse(_ls.get(bpKey(TY))).inc, '1');
    });
});

// ── A DAMAGED SAVED STATE IS RESET ALOUD (paycalc-2-10) ─────────────────────────────────────────
describe('a damaged saved card state is reset ALOUD, until the member re-checks it', () => {
    test('the warning survives the second render of the same tick, and every render after', () => {
        openCard();
        _ls.set(bpKey(TY), '{"mode":"manual","manual":"612.40","paidIn":"55","inc":"1"');   // truncated
        assert.equal(restoreBpState(), false);
        prefillBackPay();                                     // render 1: the coordinator's prefill
        calcBackPay();                                        // render 2: its "Pay rise %" pass, same tick
        assert.match(els.backPayNotice.innerHTML, /couldn't be read and were reset/,
            'wiped by the second render before anybody could see it');
        // Gone, or replaced by a readable state (this year was changed earlier in the page view, so
        // its card saves) — but never the damaged text, which would reset it again on the next load.
        const kept = _ls.get(bpKey(TY));
        assert.ok(kept == null || typeof JSON.parse(kept) === 'object', 'the damaged text was left in storage');
        calcBackPay();                                        // opening the card renders again
        assert.match(els.backPayNotice.innerHTML, /couldn't be read and were reset/);

        cardEvent('change', true);                            // the member re-checks a figure
        calcBackPay();
        assert.doesNotMatch(els.backPayNotice.innerHTML, /couldn't be read/);
    });

    test('a saved state that is not an object is damage, never a deliberate all-blank clear', () => {
        openCard();
        _ls.set(bpKey(TY), '"hello"');
        assert.equal(restoreBpState(), false, 'a string read as "a saved state, all blank"');
        calcBackPay();
        assert.match(els.backPayNotice.innerHTML, /couldn't be read and were reset/);
        cardEvent('change', true);                            // leave the module as later cases expect
    });
});
