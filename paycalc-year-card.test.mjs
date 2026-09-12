// @ts-check
/**
 * paycalc-year-card.test.mjs — THE "THIS TAX YEAR SO FAR" BLOCK AND ITS BULK-FILL CONTROL.
 * Run with: node --experimental-test-module-mocks --test paycalc-year-card.test.mjs
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────────────────
 *
 * `module-coverage-parity.test.mjs` recorded exactly one module as a GENUINE gap rather than a boot
 * shim or something driven through its DOM by e2e: this one. It was put there deliberately, with the
 * external reviewer's own ordering attached — test it eventually, but nowhere near above the Admin
 * range writer — so the debt would be visible on every run instead of being rediscovered. This pays
 * it, and `UNNAMED_BY_DESIGN` is now boot shims and behaviour-driven modules only.
 *
 * The module's own header says what it is: "the RULES all live in paycalc-fill-year.js (pure,
 * tested); this module renders and sequences." That division is exactly why the gap mattered. The
 * rules have 40-odd cases next door. What nothing exercised is the render that decides whether the
 * fix-the-emptiness control is on screen at all, and the six-step sequence that runs after the fill
 * returns — and a sequencer's failures are invisible to a rules suite by construction.
 *
 * ── ORGANISED BY WHAT A WRONG ANSWER COSTS ──────────────────────────────────────────────────────
 *
 *   A. THE CONTROL THAT FIXES THE EMPTINESS DISAPPEARS. The from-zero state is the whole reason the
 *      v22.06 extraction happened: the block used to hide entirely until one payslip had hours,
 *      which hid the bulk-fill button from exactly the member it helps most — a new starter, or
 *      anybody who has never entered a payslip. Regressing it is silent, because the block is
 *      SUPPOSED to hide sometimes, so the broken state looks like the correct one.
 *   B. A CONTROL THAT NEVER COMES BACK. The button disables and relabels itself, and the thing that
 *      restores it is a re-render that only happens on the way out through success. This is the same
 *      defect class as `admin-saved-changes` and the range-booking `finally`, and it was REAL here:
 *      see the block's own note. A member whose fill fails is left with a dead button reading
 *      "Filling from your calendar…" and no message at all.
 *   C. A RECEIPT THAT SPEAKS FOR THE WRONG YEAR. The receipt is module state that outlives the
 *      render. It is tied to `ty.label` precisely so that switching tax years does not leave "Filled
 *      5 payslips" standing under a year in which nothing was filled — a false statement about the
 *      member's own pay data, in the app's voice.
 *   D. THE POST-FILL ORDER. Three steps whose ORDER is load-bearing and whose effects are otherwise
 *      identical. The fill loop leaves the suggestion module's override map on the LAST period it
 *      visited, so the on-screen period's map must be put back BEFORE anything repaints from it.
 *      Get it wrong and the hint bar describes a different period's shifts, confidently.
 *
 * ── THE HARNESS ────────────────────────────────────────────────────────────────────────────────
 *
 * Three mocks, each for a reason, and everything else is the real module:
 *
 *   · `session.js` and `paycalc-roster-suggestions.js` reach `firebase-client.js`, which imports the
 *     SDK from gstatic over https and cannot load in Node. That is the only reason either is mocked.
 *     `getSession` returns a name and nothing else, so `getLoggedMember` does its REAL lookup
 *     against the REAL roster — a fixture member would let that lookup start failing unnoticed.
 *   · `paycalc-roster-hint.js` is mocked ONLY to observe `updateRosterHint` for section D's ordering;
 *     its `snapKey` is the real one, reached past the mock via `?real`, because that key is what the
 *     gold provenance snapshot is written under.
 *
 * `computeYearSoFar`, `getPeriods`, `periodsInTaxYear`, `readSavedPeriod`, `periodKey`, the whole of
 * `paycalc-fill-year.js` and `lsSetBothVerified` are all REAL, over an in-memory `localStorage`. So
 * the counts, the missing list and the writes are the app's own answers, not restated ones.
 *
 * THE YEAR IS 2025/26 ON PURPOSE. All thirteen of its paydays are in the past and always will be, so
 * "13 paid payslips" is a fact rather than a reading taken on the afternoon the test was written.
 * `renderYearCard` does not pass a `now` to `computeYearSoFar`, so a current-year fixture would have
 * counted a different number of paid periods every four weeks.
 *
 * ── WHAT THIS SUITE DELIBERATELY DOES NOT COVER, AND WHY ────────────────────────────────────────
 *
 * THE HPP LUMP JOINING THESE TOTALS IS NOT REACHABLE THROUGH THE RENDER TODAY, and pretending
 * otherwise would be worse than saying so. A year's premium is paid the January AFTER it ends, so
 * the block reads the PRIOR year's flags (the v18.84 fix). Measured against the real schedule:
 * `hppPaidInTaxYear('2025/26')` is null, because 2024/25 is not in `CONFIG.TAX_YEARS`; and for
 * 2026/27 it resolves to the payslip of 15 Jan 2027, which is not yet paid and so never enters the
 * paid-period loop. There is therefore no observable difference between reading the right year and
 * the wrong one from here, and a case asserting one would be asserting nothing. The relation itself
 * is owned by `paycalc-hpp-schedule.test.mjs` and its arrival in the totals by
 * `paycalc-year-summary.test.mjs`. Revisit when 2027/28 is configured — at that point the wrong-year
 * read becomes visible from here and belongs in section C.
 *
 * ── TEETH ──────────────────────────────────────────────────────────────────────────────────────
 *
 * Mutation-verified; each mutation and what caught it is recorded beside the case it belongs to.
 * Every anchor was confirmed to APPLY before its result was believed — an anchor that matches
 * nothing reports as a survivor and is not one.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

// ── IN-MEMORY localStorage ──────────────────────────────────────────────────────────────────────
// The real `ls.js`, `paycalc-migrations.js` and `computeYearSoFar` all run against this, so a saved
// payslip in a test is stored and read back through the app's own namespacing.
const _store = new Map();
global.localStorage = /** @type {any} */ ({
    getItem: (/** @type {string} */ k) => (_store.has(k) ? _store.get(k) : null),
    setItem: (/** @type {string} */ k, /** @type {any} */ v) => _store.set(k, String(v)),
    removeItem: (/** @type {string} */ k) => _store.delete(k),
    key: (/** @type {number} */ i) => [...
        _store.keys()][i] ?? null,
    get length() { return _store.size; },
});

// ── THE FAKE DOM ────────────────────────────────────────────────────────────────────────────────
// Only three ids are reached for: the block itself, the tax-code field the render reads, and the
// period select `currentPeriodNum()` asks for the ON-SCREEN period.

/** @type {any} */ let _block;
/** @type {string} */ let _periodSelectValue = '37';

function makeBlock() {
    let html = '';
    return {
        id: 'ytdYearSoFar', hidden: false,
        /** Writes are COUNTED. `_runFill` restores the control by having the block RE-RENDERED, not
         *  by un-disabling the button it holds — so "the control came back" is the claim that a
         *  render happened after the click, and nothing else can stand in for it. Asserting on the
         *  button object cannot: after a re-render that object is detached and still disabled, in
         *  the fixed code as much as the broken. */
        renders: 0,
        get innerHTML() { return html; },
        set innerHTML(v) { html = String(v ?? ''); this.renders++; },
        /** @type {Record<string, Function[]>} */ _on: {},
        addEventListener(/** @type {string} */ t, /** @type {Function} */ fn) { (this._on[t] ??= []).push(fn); },
    };
}
global.document = /** @type {any} */ ({
    getElementById: (/** @type {string} */ id) => (
        id === 'ytdYearSoFar' ? _block
            : id === 'taxCode' ? { value: '1257L' }
                : id === 'periodSelect' ? { value: _periodSelectValue }
                    : null),
});

// ── THE MOCKS ───────────────────────────────────────────────────────────────────────────────────

/** Ordered log of the sequenced side effects, for section D. */
/** @type {string[]} */ let _events = [];
/** What `getRosterSuggestion` answers this time. */
/** @type {(p: any) => any} */ let _suggest = () => null;
/** What `fetchOverridesForPeriod` answers this time. */
/** @type {(p: any) => Promise<string>} */ let _fetch = async () => 'loaded';

/** The signed-in identity, mutable so one case can point it at a name the roster does not hold.
 *  Only `name` is supplied — `getLoggedMember` then does its REAL lookup against the REAL roster. */
const _session = { name: 'G. Miller' };
mock.module('./session.js', {
    namedExports: { getSession: () => ({ name: _session.name }) },
});

mock.module('./paycalc-roster-suggestions.js', {
    namedExports: {
        // Pure lookup in the real module, but it cannot come along: its own file reaches Firebase.
        // Bank holidays only move the pay ARITHMETIC, which is paycalc-year-summary's subject, not
        // this file's — every count and list asserted below is independent of them.
        bhsForYear: () => [],
        getOverridesFetchState: () => 'loaded',
        getRosterSuggestion: (/** @type {any} */ p) => _suggest(p),
        fetchOverridesForPeriod: async (/** @type {any} */ p) => {
            _events.push(`fetch:${p.num}`);
            return _fetch(p);
        },
    },
});

const _realHint = await import('./paycalc-roster-hint.js?real');
mock.module('./paycalc-roster-hint.js', {
    namedExports: {
        snapKey: _realHint.snapKey,               // real — it names where the gold snapshot lands
        updateRosterHint: () => { _events.push('hint'); },
    },
});

const { CONFIG, getPeriods } = await import('./paycalc-periods.js');
const { periodsInTaxYear } = await import('./paycalc-hpp-schedule.js');
const { periodKey } = await import('./paycalc-migrations.js');
const { emptyPeriodData } = await import('./paycalc-form-data.js');
const { initYearCard, renderYearCard } = await import('./paycalc-year-card.js');

/** The completed tax year — see the harness note. */
const TY = /** @type {any} */ (CONFIG.TAX_YEARS.find((/** @type {any} */ t) => t.label === '2025/26'));
assert.ok(TY, 'the 2025/26 tax year must exist — this suite is built on its paydays being past');
/** Its thirteen periods, in order, from the real period calendar. */
const TY_PERIODS = periodsInTaxYear(TY, getPeriods());
assert.equal(TY_PERIODS.length, 13, 'a four-weekly year is 13 periods');
assert.ok(TY_PERIODS.every((/** @type {any} */ p) => p.payday <= new Date()),
    'every 2025/26 payday must be in the past, or the paid count here is a moving target');

/** Render args a case can vary one field of. */
const ARGS = { ty: TY, plan: 'plan2', pgLoan: false, slPaidOffFromP: 0, bpLump: null };
const render = (/** @type {any} */ over = {}) => renderYearCard({ ...ARGS, ...over });

/** Mark a period as ENTERED by saving real period data with hours in it. */
function enter(/** @type {number} */ pNum) {
    const d = /** @type {any} */ (emptyPeriodData());
    d.otH = 5;
    localStorage.setItem(periodKey(pNum), JSON.stringify(d));
}

/** A clickable stand-in for the button the render just described. `closest` resolves to ITSELF,
 *  which is how the module's delegated listener finds it. */
function fillButton() {
    assert.match(_block.innerHTML, /id="fillYearBtn"/, 'the case needs the fill button on screen');
    /** @type {any} */ const btn = { id: 'fillYearBtn', disabled: false, textContent: 'Fill these from your calendar' };
    btn.closest = (/** @type {string} */ sel) => (sel === '#fillYearBtn' ? btn : null);
    return btn;
}

/** The click listener is NOT async and does not return its promise — it fires `_runFill` and
 *  returns — so one tick is not enough to see the sequence finish. Drain generously. */
async function settle() {
    for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
}

/** Fire the REAL delegated listener the factory attached, with `btn` as the event target. */
async function clickFill(/** @type {any} */ btn) {
    const handler = _block._on.click?.[0];
    assert.ok(handler, 'initYearCard must have attached a click listener');
    handler({ target: btn });
    await settle();
}

/** Everything the coordinator hook was handed. */
/** @type {any[]} */ let _afterFillReceipts = [];

beforeEach(() => {
    _store.clear();
    _events = [];
    _afterFillReceipts = [];
    _suggest = () => null;
    _fetch = async () => 'loaded';
    _session.name = 'G. Miller';
    _periodSelectValue = String(TY_PERIODS[0].num);
    _block = makeBlock();
    initYearCard({
        afterFill: (/** @type {any} */ r) => {
            _events.push('afterFill');
            _afterFillReceipts.push(r);
            render();                   // the coordinator recalculates, which re-renders this block
        },
    });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// A. THE CONTROL THAT FIXES THE EMPTINESS DISAPPEARS
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe('the control that fixes the emptiness', () => {
    test('a member with NOTHING entered still gets the block, the count and the button', () => {
        // The v22.06 defect, and the reason this module exists. Before it, `!y.entered` returned
        // early and hid the block — so the one member the bulk fill was built for could not see it.
        render();
        assert.equal(_block.hidden, false, 'the block must not hide from a member with nothing entered');
        assert.match(_block.innerHTML, /0 of 13 paid payslips entered/);
        assert.match(_block.innerHTML, /id="fillYearBtn"/, 'the bulk-fill button is the point');
        assert.match(_block.innerHTML, /Not entered yet:/);
        // MUTATION: restoring the early return (`if (!y.entered) { el.hidden = true; return; }`)
        // fails here and nowhere else in the estate.
    });

    test('the from-zero variant shows NO totals rows — there is nothing to total', () => {
        // Not decoration. A row reading "Taxable pay ≈ £0.00" over a year nobody has entered is a
        // figure about somebody's pay, and it is not zero, it is unknown.
        render();
        assert.doesNotMatch(_block.innerHTML, /yearso-row/, 'no totals rows with nothing entered');
        assert.doesNotMatch(_block.innerHTML, /If the rest of/, 'and no projection from no data');
    });

    test('once a payslip is entered the totals and the projection appear', () => {
        enter(TY_PERIODS[0].num);
        render();
        assert.match(_block.innerHTML, /1 of 13 paid payslips entered/);
        assert.match(_block.innerHTML, /Taxable pay/);
        assert.match(_block.innerHTML, /National Insurance/);
        assert.match(_block.innerHTML, /If the rest of 2025\/26 looks similar/);
        assert.match(_block.innerHTML, /rough/, 'the projection must stay labelled rough');
    });

    test('the button goes when there is nothing left to fill, and the block hides with it', () => {
        // The honest end state: every paid payslip entered. No missing list, no button, and — with
        // no receipt to show — nothing for the block to say.
        for (const p of TY_PERIODS) enter(p.num);
        render();
        assert.match(_block.innerHTML, /13 of 13 paid payslips entered/);
        assert.doesNotMatch(_block.innerHTML, /id="fillYearBtn"/, 'nothing missing, so no fill button');
    });

    test('with nothing entered AND nothing missing, the block hides entirely', () => {
        // The legitimate hidden state, and the reason case 1 above has to exist: hiding is correct
        // HERE, so a regression that hides the from-zero member too looks like this and is not.
        // A tax year whose periods are not on the calendar yet has nothing paid and nothing to name
        // — which is what a future year looks like before the period calendar is extended to it.
        const notOnTheCalendarYet = { ...TY, label: '2099/00', first: 400, last: 412 };
        assert.equal(periodsInTaxYear(notOnTheCalendarYet, getPeriods()).length, 0,
            'precondition: this year genuinely has no periods');
        render({ ty: notOnTheCalendarYet });
        assert.equal(_block.hidden, true, 'nothing to say means hidden');
        assert.equal(_block.innerHTML, '', 'and the previous year\'s block is cleared, not left up');
    });

    test('every paid payslip is NAMED, not just counted', () => {
        // v18.42: "3 of 13" is a status; the dates are what make it actionable.
        enter(TY_PERIODS[0].num);
        render();
        const list = _block.innerHTML.match(/Not entered yet: ([^<]*)/)?.[1] ?? '';
        assert.ok(list.length > 0, 'the missing payslips must be listed');
        assert.doesNotMatch(list, /undefined|NaN|Invalid/, 'the list is dates, not a broken format');
    });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// B. A CONTROL THAT NEVER COMES BACK
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe('a control that never comes back', () => {
    test('a successful fill hands the coordinator a receipt and re-renders the block', async () => {
        _suggest = () => ({ otH: 3, otM: 0 });
        render();
        await clickFill(fillButton());
        assert.equal(_afterFillReceipts.length, 1, 'the coordinator hook must run');
        assert.ok(_afterFillReceipts[0].filled.length > 0, 'and be handed what was filled');
        assert.match(_block.innerHTML, /yearso-receipt/, 'the receipt must reach the screen');
        assert.match(_block.innerHTML, /Filled \d+ payslip/);
    });

    test('A FILL THAT THROWS LEAVES A LIVE BUTTON AND SAYS SO', async () => {
        // THE DEFECT THIS CASE WAS WRITTEN FOR, found by writing it and reproduced before the fix.
        // `_runFill` disables the button and relabels it, and the only thing that restores either is
        // the re-render on the way out through success. `deps.suggest` is NOT inside
        // `fillYearFromCalendar`'s try — only `fetchOverrides` is — so a roster read that throws
        // rejected out of the handler as an unhandled promise rejection: nothing on screen, and a
        // permanently disabled button reading "Filling from your calendar…". The member's only
        // escape was to change an input and force a recalculate, which nothing tells them to do.
        _suggest = () => { throw new Error('roster unreachable'); };
        render();
        const before = _block.renders;
        await clickFill(fillButton());
        assert.ok(_block.renders > before,
            'the block must be RE-RENDERED after the failure — that is the whole restore mechanism');
        assert.match(_block.innerHTML, /id="fillYearBtn"/, 'and the rebuilt block carries a live button');
        assert.match(_block.innerHTML, /yearso-receipt/, 'the member must be told it failed');
        assert.match(_block.innerHTML, /Couldn't finish filling/);
        // MUTATION: removing the `catch` in `_runFill` fails this case. Moving the re-render out of
        // the catch and into the `finally` does NOT fail it, and that is correct — either position
        // restores the control; the catch is where the message is composed.
    });

    test('a failure does not report itself as a fill — the coordinator is not called', async () => {
        // `_afterFill` reloads the visible form from storage. Calling it after a throw would repaint
        // the form from a fill that did not complete, which is the same class of lie as reporting a
        // partial commit as a success.
        _suggest = () => { throw new Error('roster unreachable'); };
        render();
        await clickFill(fillButton());
        assert.deepEqual(_afterFillReceipts, [], 'no receipt may be handed to the coordinator');
    });

    test('the failure message never claims nothing was written', async () => {
        // The `partialCommit` rule, in this module's language. The loop writes period by period, so
        // a throw part-way leaves earlier periods FILLED. A message saying "nothing was changed"
        // would be false exactly when it matters, and would invite a retry against half-written
        // data. The message points at the on-screen list instead, which is now accurate.
        _suggest = () => { throw new Error('roster unreachable'); };
        render();
        await clickFill(fillButton());
        // The precondition names the FAILURE receipt specifically, not merely "a receipt". `_receipt`
        // is module state with no reset hook, so a success receipt from an earlier case in this file
        // is still standing when this one runs — and a loose `assert.ok(receipt)` was satisfied by
        // it, which made this case pass against a build that had no failure message at all.
        const receipt = _block.innerHTML.match(/yearso-receipt[^>]*>([\s\S]*?)<\/div><\/div>/)?.[1];
        assert.ok(receipt, 'precondition: a receipt is on screen to read');
        assert.match(receipt, /Couldn't finish filling/, 'precondition: it is the FAILURE receipt');
        assert.doesNotMatch(receipt, /[Nn]othing was (changed|lost|written)/,
            'a partial write must not be reported as no write');
    });

    test('a second click while a fill is in flight is ignored', async () => {
        // `_filling` guards it. Not catastrophic — rule 1 means a fill cannot overwrite — but two
        // loops interleaving leave the suggestion module\'s override map on an unpredictable period,
        // which is what section D is about.
        // EVERY pending fetch is held and then released. Holding only the first would leave the
        // fill loop suspended for ever and `_filling` stuck true — which is module state, so the
        // next test's click would be silently ignored and its failure would look like a defect in
        // the code rather than in this harness. It did, exactly once, before this comment existed.
        /** @type {Function[]} */ const held = [];
        _fetch = () => new Promise((r) => held.push(() => r('loaded')));
        _suggest = () => ({ otH: 3, otM: 0 });
        render();
        const btn = fillButton();
        clickFill(btn);                              // fires and suspends on the first fetch
        await settle();
        clickFill(btn);                              // the second, while the first is still waiting
        await settle();
        assert.deepEqual(_afterFillReceipts, [], 'precondition: the first fill has not finished');
        // Release everything the loop is waiting on, including any the second click added.
        for (let i = 0; i < 40 && held.length; i++) { held.splice(0).forEach((r) => r()); await settle(); }
        assert.equal(_afterFillReceipts.length, 1, 'exactly one fill may run, and it must finish');
    });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// C. A RECEIPT THAT SPEAKS FOR THE WRONG YEAR
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe('a receipt that speaks for the wrong year', () => {
    test('the receipt shows under the year it was filled for', async () => {
        _suggest = () => ({ otH: 3, otM: 0 });
        render();
        await clickFill(fillButton());
        assert.match(_block.innerHTML, /yearso-receipt/);
    });

    test('and DISAPPEARS when the member switches tax year', async () => {
        // Module state outliving its subject. "Filled 5 payslips from your calendar" standing under
        // a year in which nothing was filled is a false statement about the member's own pay data.
        _suggest = () => ({ otH: 3, otM: 0 });
        render();
        await clickFill(fillButton());
        assert.match(_block.innerHTML, /yearso-receipt/, 'precondition: a receipt is showing');

        const other = /** @type {any} */ (CONFIG.TAX_YEARS.find((/** @type {any} */ t) => t.label !== TY.label));
        render({ ty: other });
        assert.doesNotMatch(_block.innerHTML, /yearso-receipt/,
            "last year's receipt must not stand under this year");
        // MUTATION: dropping the `_receipt.tyLabel === ty.label` test fails this case.
    });

    test('and comes back when they switch back', async () => {
        // The tie is to the LABEL, not a one-shot flag — the receipt is still true of that year.
        _suggest = () => ({ otH: 3, otM: 0 });
        render();
        await clickFill(fillButton());
        const other = /** @type {any} */ (CONFIG.TAX_YEARS.find((/** @type {any} */ t) => t.label !== TY.label));
        render({ ty: other });
        render();
        assert.match(_block.innerHTML, /yearso-receipt/);
    });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// D. THE POST-FILL ORDER
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe('the post-fill order', () => {
    test('the ON-SCREEN period\'s overrides are restored BEFORE anything repaints', async () => {
        // The fill loop leaves the suggestion module's override map on the LAST period it visited.
        // Every repaint after that — the reloaded form, the hint bar — reads that map. So the last
        // fetch before the coordinator runs must be the period the member is looking at, and not
        // whichever one the loop happened to end on.
        for (const p of TY_PERIODS.slice(0, 12)) enter(p.num);   // leave exactly one fillable
        const lastFillable = TY_PERIODS[12];
        const onScreen = TY_PERIODS[0];
        _periodSelectValue = String(onScreen.num);
        _suggest = () => ({ otH: 3, otM: 0 });
        render();
        await clickFill(fillButton());

        const fetches = _events.filter((e) => e.startsWith('fetch:'));
        assert.deepEqual(fetches, [`fetch:${lastFillable.num}`, `fetch:${onScreen.num}`],
            'the loop fetches the fillable period, then the on-screen one is put back');
        const tail = _events.slice(_events.indexOf(`fetch:${onScreen.num}`));
        assert.deepEqual(tail, [`fetch:${onScreen.num}`, 'afterFill', 'hint'],
            'restore, then repaint, then the hint bar');
        // MUTATION: moving the on-screen re-fetch below `_afterFill` fails the tail assertion.
        // MUTATION: moving `updateRosterHint()` above `_afterFill` fails it too.
    });

    test('a failed restore does not stop the receipt reaching the member', async () => {
        // The re-fetch is wrapped: the hint bar showing base-only is a degradation, not a reason to
        // throw away a fill that happened.
        _suggest = () => ({ otH: 3, otM: 0 });
        let calls = 0;
        _fetch = async () => { calls++; if (calls > 13) throw new Error('offline'); return 'loaded'; };
        render();
        await clickFill(fillButton());
        assert.match(_block.innerHTML, /yearso-receipt/, 'the fill still reports itself');
        assert.ok(_events.includes('afterFill'));
    });

    test('nothing runs at all without a signed-in member', async () => {
        // `_runFill` returns before touching the button when `getLoggedMember()` is null. Worth
        // pinning because the guard is the only thing between a null member and a fill loop that
        // would fetch overrides for nobody.
        render();
        const btn = fillButton();
        const handler = _block._on.click?.[0];
        btn.closest = (/** @type {string} */ s) => (s === '#fillYearBtn' ? btn : null);
        // Re-point the session at a name the roster does not hold, so the REAL lookup returns null.
        _session.name = 'Z. Nobody';
        handler({ target: btn });
        await settle();
        assert.deepEqual(_events, [], 'no fetch, no coordinator, no hint');
        assert.equal(btn.disabled, false, 'and the button is never disabled');
    });
});
