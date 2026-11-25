// @lane hygiene
/**
 * paycalc-money-banner.test.mjs — a banner may only say "Includes" when the sum is actually in it.
 * Run: node scripts/run-tests.mjs test/paycalc-money-banner.test.mjs   (part of `npm run test:hygiene`)
 *
 * @nodeps-safe — runs on a bare checkout with nothing installed.
 *
 * ── ORGANISED BY WHAT A WRONG ANSWER COSTS ──────────────────────────────────────────────────────
 *
 * OVERSTATING is the expensive direction and the reason this module exists. "✓ Includes back pay
 * lump sum of £1,240" over a figure that does not contain it, and a member plans around a number
 * that is hundreds of pounds too high. Nothing is out of range, nothing throws, and the estimate is
 * exactly as plausible either way — the ONLY thing distinguishing the two states is the sentence,
 * which is why the sentence is what gets tested.
 *
 * UNDERSTATING costs the opposite way and is the one a careful fix produces: a member who has opted
 * in, sees "not added to this estimate", and unticks something that was already right.
 *
 * DROPPING THE HEDGE is the third, and it hides inside both of the above: an unconfirmed figure
 * that stops saying "Estimated" reads as settled. Same defect, different words.
 *
 * The two banners are asserted TOGETHER wherever the rule is shared, because they were two
 * hand-kept copies before this module and the failure was always one of them drifting.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { backPayBannerCopy, hppBannerCopy, paintBanner, wireBannerTicks } from '../paycalc-money-banner.js';
import { hppIncKey } from '../paycalc-migrations.js';
import { takeHomeInputs, getThresholds } from '../paycalc-calc.js';

// Tests live in test/ but address files from the repository root (moved 24 Nov 2026).
const REPO_ROOT_URL = new URL('../', import.meta.url);

const BP = (o = {}) => backPayBannerCopy({ thisPeriod: 0, amount: 1240, isEstimate: false, aprilYear: '2026', ...o });
const HPP = (o = {}) => hppBannerCopy({ forPeriod: 0, amount: 480, isEstimate: false, ...o });

describe('overstating — a sum claimed to be in a figure that does not contain it', () => {
    test('neither banner says "Includes" when nothing was added', () => {
        for (const [name, c] of [['back pay', BP()], ['HPP', HPP()]]) {
            assert.ok(!/Includes/.test(c.text), `${name}: claims inclusion with nothing added — ${c.text}`);
            assert.match(c.text, /not added to this estimate/, `${name}: must say so explicitly`);
        }
    });

    test('and both DO say it when the sum was added', () => {
        assert.match(BP({ thisPeriod: 1240 }).text, /^✓ Includes .*back pay lump sum of £1,240\.00$/);
        assert.match(HPP({ forPeriod: 480 }).text, /^✓ Includes .*Holiday Pay Premium of £480\.00$/);
    });

    test('availability alone never reads as inclusion', () => {
        // The state the whole module is about: there IS a sum on this payslip, and it is NOT in the
        // total. Both sentences have to carry that, and neither may lead with the tick.
        for (const c of [BP({ amount: 1240 }), HPP({ amount: 480 })]) {
            assert.match(c.text, /^ℹ️/);
            assert.match(c.text, /could land on this payslip|will land on this payslip|is on this payslip/);
        }
    });

    test('a hidden banner is hidden by display, not by emptying its text', () => {
        // If a banner were "hidden" by clearing its sentence it would reappear on the next render
        // still carrying the previous payslip's number.
        const els = fakeDom();
        paintBanner({ ...IDS.bp, available: false, included: false, copy: BP({ thisPeriod: 1240 }) });
        assert.equal(els.bpActiveBanner.style.display, 'none');
        assert.equal(els.bpBannerText.textContent, '', 'nothing should have been written at all');
    });
});

describe('understating — telling a member their opt-in did not take', () => {
    test('the tick follows `included`, not availability', () => {
        const els = fakeDom();
        paintBanner({ ...IDS.bp, available: true, included: true, copy: BP({ thisPeriod: 1240 }) });
        assert.equal(els.bpBannerTick.checked, true);
        assert.match(els.bpBannerText.textContent, /Includes/);
    });

    test('the sentence and the tick are the same fact', () => {
        // The failure this pairing prevents: a ticked box beside "not added to this estimate".
        for (const [ids, copy, included] of [
            [IDS.bp, BP({ thisPeriod: 1240 }), true], [IDS.bp, BP(), false],
            [IDS.hpp, HPP({ forPeriod: 480 }), true], [IDS.hpp, HPP(), false],
        ]) {
            const els = fakeDom();
            paintBanner({ ...ids, available: true, included, copy });
            const said = els[ids.textId].textContent;
            assert.equal(/✓ Includes/.test(said), els[ids.tickId].checked,
                `the words and the tick disagree: "${said}" with checked=${els[ids.tickId].checked}`);
        }
    });
});

describe('dropping the hedge — an unconfirmed figure reading as settled', () => {
    test('back pay hedges an unconfirmed award on BOTH sentences', () => {
        assert.match(BP({ isEstimate: true, thisPeriod: 1240 }).text, /estimated back pay/);
        assert.match(BP({ isEstimate: true }).text, /^ℹ️ Estimated back pay/);
        // …and a CONFIRMED award is definite rather than hedged: it will land, not could.
        assert.match(BP({ isEstimate: false }).text, /will land on this payslip/);
        assert.ok(!/could land/.test(BP({ isEstimate: false }).text));
    });

    test('a confirmed lump IS on its payslip once that payslip may be in hand — never "will land" after it paid', () => {
        // The 28 Aug 2026 payslip, viewed in November, said the lump "will land" on it (17 Nov 2026).
        assert.equal(BP({ isEstimate: false, inHand: true }).text,
            'ℹ️ Your back pay lump sum of £1,240.00 is on this payslip — not added to this estimate');
        assert.match(BP({ isEstimate: false, inHand: false }).text, /will land on this payslip/, 'before it arrives, it will land');
        // An unconfirmed award has no decided payslip, so it stays hedged either way.
        assert.match(BP({ isEstimate: true, inHand: true }).text, /could land on this payslip/);
    });

    test('HPP hedges an unconfirmed premium on both sentences', () => {
        assert.match(HPP({ isEstimate: true, forPeriod: 480 }).text, /estimated Holiday Pay Premium/);
        assert.match(HPP({ isEstimate: true }).text, /^ℹ️ Estimated Holiday Pay Premium .* could land on this payslip/);
    });

    test('…and never hedges a CONFIRMED premium, which the member read off this very payslip', () => {
        // A confirmed figure is the Holiday Pay Premium line the HPP card asked them to copy from this
        // January payslip. "Could land" undersold what they had just read (whole-app check, 10 Nov 2026).
        const c = HPP({ isEstimate: false });
        assert.equal(c.text, 'ℹ️ Your Holiday Pay Premium of £480.00 is on this payslip — not added to this estimate');
        assert.doesNotMatch(c.text, /could land|Estimated/);
    });
});

describe('the notes, which differ on purpose', () => {
    test('back pay always explains how to improve a lump worked out from hours', () => {
        assert.match(BP().note, /back to 1 April 2026\.$/);
        assert.match(BP({ thisPeriod: 1240 }).note, /back to 1 April 2026\.$/);
        assert.match(BP({ fromPayslip: false }).note, /fill in your hours/);
    });

    test('…and says nothing of hours for a lump typed from the payslip, which hours cannot change', () => {
        // Whole-app check, 10 Nov 2026: the payslip's own figure has nothing left to sharpen.
        assert.equal(BP({ fromPayslip: true }).note, '');
        assert.equal(BP({ fromPayslip: true, thisPeriod: 1240 }).note, '');
    });

    test('HPP prompts only where there is something to do', () => {
        // Opted in AND still an estimate is the one state with a next action — replace it when the
        // payslip arrives. Every other state would be a sentence with no instruction in it.
        assert.match(HPP({ forPeriod: 480, isEstimate: true }).note, /enter the confirmed Holiday Pay Premium/);
        assert.equal(HPP({ forPeriod: 480, isEstimate: false }).note, '');
        assert.equal(HPP({ isEstimate: true }).note, '');
        assert.equal(HPP().note, '');
    });
});

describe('the HPP tick carries its year', () => {
    test('so the once-wired change listener targets the right tax year', () => {
        const els = fakeDom();
        paintBanner({ ...IDS.hpp, available: true, included: true, copy: HPP({ forPeriod: 480 }), tickYear: '2026/27' });
        assert.equal(els.hppBannerTick.dataset.year, '2026/27');
    });

    test('and back pay, which has no per-year flag, sets none', () => {
        const els = fakeDom();
        paintBanner({ ...IDS.bp, available: true, included: false, copy: BP() });
        assert.equal(els.bpBannerTick.dataset.year, undefined);
    });
});

// THE TICKS AND LINKS (wireBannerTicks, out of paycalc-app.js on 25 Nov 2026). The tick is the
// member's answer to "add it?", and what it sets is what takeHomeInputs reads — so a tick that sets the
// wrong year's flag, or none, is a banner whose word and figure part company on the next render.
describe('the ticks set what the take-home reads, and the links open the card they name', () => {
    /** A fake page: elements that record listeners, clicks, scrolls and dispatched events. */
    function wiredPage() {
        /** @type {Record<string, any>} */ const els = {};
        const store = new Map();
        /** @type {any} */ (globalThis).localStorage = {
            getItem: (/** @type {string} */ k) => (store.has(k) ? store.get(k) : null),
            setItem: (/** @type {string} */ k, /** @type {any} */ v) => { store.set(k, String(v)); },
            removeItem: (/** @type {string} */ k) => { store.delete(k); },
        };
        const mk = (/** @type {string} */ id) => {
            const cls = new Set(); /** @type {Record<string, Function[]>} */ const on = {};
            return els[id] = {
                id, checked: false, dataset: {}, clicks: 0, scrolled: 0, /** @type {string[]} */ fired: [],
                classList: { contains: (/** @type {string} */ c) => cls.has(c), add: (/** @type {string} */ c) => cls.add(c) },
                addEventListener(/** @type {string} */ t, /** @type {Function} */ fn) { (on[t] ??= []).push(fn); },
                fire(/** @type {string} */ t) { for (const fn of on[t] ?? []) fn({}); },
                click() { this.clicks++; },
                scrollIntoView() { this.scrolled++; },
                dispatchEvent(/** @type {any} */ e) { this.fired.push(e.type); return true; },
            };
        };
        for (const id of ['hppBannerTick', 'bpBannerTick', 'bpIncludeTick', 'bpBannerViewLink', 'hppBannerViewLink', 'hppBackPayLink',
            'backPayCard', 'backPayBody', 'backPayCardToggle', 'hppCard', 'hppCardBody', 'hppCardToggle']) mk(id);
        globalThis.document = /** @type {any} */ ({ getElementById: (/** @type {string} */ id) => els[id] ?? null });
        let priced = 0;
        wireBannerTicks({ calculate: () => { priced++; } });
        return { els, store, priced: () => priced };
    }
    const TY = { label: '2025/26' };

    test('the HPP tick sets — and clears — the flag for the year stamped on it, then re-prices', () => {
        const { els, store, priced } = wiredPage();
        els.hppBannerTick.dataset.year = '2025/26';
        els.hppBannerTick.checked = true; els.hppBannerTick.fire('change');
        assert.equal(store.get(hppIncKey(TY)), '1');
        assert.equal(priced(), 1);
        els.hppBannerTick.checked = false; els.hppBannerTick.fire('change');
        assert.equal(store.has(hppIncKey(TY)), false, 'un-ticking removes the flag');
        assert.equal(priced(), 2);
    });

    test('a year that is not on record sets nothing', () => {
        const { els, store, priced } = wiredPage();
        els.hppBannerTick.dataset.year = '1999/00';
        els.hppBannerTick.checked = true; els.hppBannerTick.fire('change');
        assert.equal(store.size, 0);
        assert.equal(priced(), 0);
    });

    test('the back-pay tick hands its state to the card\'s own tick, and fires its change', () => {
        const { els } = wiredPage();
        els.bpBannerTick.checked = true; els.bpBannerTick.fire('change');
        assert.equal(els.bpIncludeTick.checked, true);
        assert.deepEqual(els.bpIncludeTick.fired, ['change'], 'the card\'s persist-and-re-price runs');
    });

    test('each link opens a shut card through its header, and only scrolls to an open one', () => {
        const { els } = wiredPage();
        els.bpBannerViewLink.fire('click');
        assert.equal(els.backPayCardToggle.clicks, 1, 'the shut back-pay card is opened by its header');
        assert.equal(els.backPayCard.scrolled, 1);
        els.backPayBody.classList.add('open');
        els.hppBackPayLink.fire('click');
        assert.equal(els.backPayCardToggle.clicks, 1, 'an open card is not toggled shut');
        assert.equal(els.backPayCard.scrolled, 2, 'the HPP card\'s link goes to the back-pay card too');
        els.hppBannerViewLink.fire('click');
        assert.equal(els.hppCardToggle.clicks, 1);
        assert.equal(els.hppCard.scrolled, 1);
    });
});

test('a missing banner element does not throw', () => {
    globalThis.document = /** @type {any} */ ({ getElementById: () => null });
    assert.doesNotThrow(() => paintBanner({ ...IDS.bp, available: true, included: true, copy: BP() }));
});

// ── harness ─────────────────────────────────────────────────────────────────────────────────────
const IDS = {
    bp:  { rootId: 'bpActiveBanner',  textId: 'bpBannerText',  tickId: 'bpBannerTick',  noteId: 'bpBannerNote' },
    hpp: { rootId: 'hppActiveBanner', textId: 'hppBannerText', tickId: 'hppBannerTick', noteId: 'hppBannerNote' },
};
function fakeDom() {
    /** @type {Record<string, any>} */ const els = {};
    for (const ids of Object.values(IDS)) {
        for (const id of Object.values(ids)) {
            els[id] = { id, textContent: '', checked: false, style: {}, dataset: {} };
        }
    }
    globalThis.document = /** @type {any} */ ({ getElementById: (/** @type {string} */ id) => els[id] ?? null });
    return els;
}

// ── THE CALLER, WHICH IS THE HALF NOTHING ABOVE CAN SEE ─────────────────────────────────────────
//
// Everything above hands `backPayBannerCopy` a `thisPeriod` and checks what it says about it. That
// is the builder being right, and the builder is trivially right — it has one ternary. The invariant
// this module exists for is about something else entirely:
//
//     a banner may only say "Includes" when the sum is actually IN THE FIGURE ABOVE IT.
//
// "The figure above it" is `net`, priced in `calculate()` from the gross `takeHomeInputs`
// (paycalc-calc.js) returns: `grossWithBp`, the hours' gross plus `bpThisPeriod` plus
// `hppForPeriod`. So the invariant holds exactly while (a) those two are the sums that went into the
// gross, (b) each exists only once the member has ticked it in, on the payslip that carries it, and
// (c) calculate() hands the copy builder THOSE two rather than the sums merely available. Pass
// `_bpAmount` instead of `_bpThisPeriod` and every assertion above still passes, while a member
// reading an opted-OUT estimate is told it includes £476 it does not.
//
// (a) and (b) are RULES, and since 25 Nov 2026 they are run: `takeHomeInputs` is a pure function, so
// contracts 1 and 3 call it over each case. Before that they were lines inside `calculate()` — a
// closure inside `init()` with no seam — and this file sliced them out of the source text and ran
// them through `new Function`.
//
// (c) is the HAND-OFF, and it stays static, because `calculate()` still has no seam a unit test can
// reach it through. It reads SOURCE TEXT, so it can be defeated by rewriting the call site in a shape
// it does not recognise — a variable renamed, the amount computed inline, the whole block moved to
// another module. Each of those fails here loudly rather than silently, which is the behaviour wanted
// from a static guard. The behavioural guard of the whole chain is the rendered page:
// `e2e/paycalc-backpay.spec.js` drives the tick and asserts the rendered £ beside the rendered sentence.

describe('the CALLER passes the added sum, not the available one', () => {
    const APP = readFileSync(new URL('./paycalc-app.js', REPO_ROOT_URL), 'utf8');
    const CODE = APP.replace(/\/\/[^\n]*/g, '');

    /** The `paintBanner({...})` / `xBannerCopy({...})` block for one banner, comments stripped. */
    const callSite = (/** @type {string} */ fn) => {
        const at = APP.indexOf(`${fn}({`);
        assert.ok(at > 0, `${fn} is not called in paycalc-app.js — the guard is looking at the wrong file`);
        return APP.slice(at, APP.indexOf('})', at)).replace(/\/\/[^\n]*/g, '');
    };

    /** A 2026/27 payslip's inputs with nothing on it but `over` (paycalc-calc.js → takeHomeInputs). */
    const inputs = (/** @type {Record<string, any>} */ over = {}) => takeHomeInputs({
        p: { num: 55 }, ty: { first: 2 }, gross: 3000, thresholds: getThresholds('2026/27'),
        plan: 'none', pgLoan: false, slSkip: false, taxCode: '1257L',
        backPay: { pNum: 0, amount: 0, included: false }, premium: { amount: 0, included: false },
        pensionBox: null, pensionDefault: 151.86, slStopShown: '', slStopStored: null,
        ytdPay: null, ytdTax: null, ytdSrc: 0, ...over,
    });
    const LUMP = 476.18, HPP = 1843.01;

    test('1 — the sums the banners are told about are the sums folded into the gross that is priced', () => {
        const r = inputs({ backPay: { pNum: 55, amount: LUMP, included: true }, premium: { amount: HPP, included: true } });
        assert.equal(r.grossWithBp, 3000 + r.bpThisPeriod + r.hppForPeriod, 'the gross is not the hours plus the two added sums');
        assert.equal(r.bpThisPeriod, LUMP, 'premise: the lump was added');
        assert.equal(r.hppForPeriod, HPP, 'premise: the premium was added');
        assert.equal(r.pricing.gross, r.grossWithBp, 'the payslip is priced on a gross other than the one the banners describe');

        // The hand-off, which only the source can show: calculate() takes the two sums, the gross and
        // the pricing from ONE takeHomeInputs call, prices that pricing, and hands the copy builders the
        // SAME names. Handing them `_bpAmount`/`_hppAmount` — the sums merely AVAILABLE — is the
        // defect, and it is one identifier apart from correct.
        const decl = CODE.match(/const\s*\{([^}]*)\}\s*=\s*takeHomeInputs\(/);
        assert.ok(decl, 'calculate() no longer takes its inputs from takeHomeInputs — re-read this guard');
        assert.match(decl[1], /bpThisPeriod:\s*_bpThisPeriod\b/, 'the back-pay sum calculate() keeps is not takeHomeInputs\' added one');
        assert.match(decl[1], /hppForPeriod:\s*_hppForPeriod\b/, 'the premium calculate() keeps is not takeHomeInputs\' added one');
        assert.match(decl[1], /\bpricing\b/, 'the pricing is not taken from the same call');
        assert.match(CODE, /\bpricePayslip\(\s*pricing\s*\)/, 'calculate() prices something other than takeHomeInputs\' pricing');
        assert.doesNotMatch(CODE, /const\s+(_bpThisPeriod|_hppForPeriod|grossWithBp)\s*=/,
            'an added sum or the gross is worked out again in calculate(), beside takeHomeInputs\'');
        assert.match(callSite('backPayBannerCopy'), /thisPeriod:\s*_bpThisPeriod\b/,
            'the back-pay banner is told about a different sum from the one in the total');
        assert.match(callSite('hppBannerCopy'), /forPeriod:\s*_hppForPeriod\b/,
            'the HPP banner is told about a different sum from the one in the total');
        // …and whether the payslip ON SCREEN may be in hand, by the app's one rule for that. (No
        // `!!_curP &&` in front since Nov 2026: calculate() has returned already when there is none.)
        assert.match(callSite('backPayBannerCopy'), /inHand:\s*payslipMayBeInHand\(_curP\)/,
            'the back-pay banner is not told whether its payslip has arrived');
    });

    test('2 — and the tick each banner shows is the tick that gated that sum', () => {
        // `included` drives the checkbox, `thisPeriod` drives the sentence. A member who sees a
        // ticked box over "not added to this estimate" has been given two answers to one question.
        const bp = callSite('paintBanner');
        assert.match(bp, /included:\s*_bpIncluded\b/, 'the back-pay tick no longer reflects the opt-in state');
        const hppPaint = APP.slice(APP.indexOf('hppActiveBanner'));
        assert.match(hppPaint.slice(0, 400), /included:\s*_hppIncluded\b/, 'the HPP tick no longer reflects the opt-in state');
        // …and those are the ticks takeHomeInputs was handed for the two sums.
        const call = CODE.slice(CODE.search(/=\s*takeHomeInputs\(/));
        const args = call.slice(0, call.indexOf('});'));
        assert.match(args, /backPay:\s*\{[^}]*included:\s*_bpIncluded\b/, 'the lump is gated on a tick other than the banner\'s');
        assert.match(args, /premium:\s*\{[^}]*included:\s*_hppIncluded\b/, 'the premium is gated on a tick other than the banner\'s');
    });

    test('3 — and the sum only exists once the member has opted in, on the payslip that carries it', () => {
        // What contract 1 cannot see: the two sides agreeing about a value that stopped meaning
        // "added". Both are defined from their own tick, and if either definition drops it the banner
        // would say "Includes" truthfully about a figure nobody asked for. Run over every case (test
        // audit, 7 Nov 2026: looking for the tick's NAME passed `(_bpIncluded || true)`).
        const bpAdded = (/** @type {number} */ pNum, /** @type {number} */ num, /** @type {boolean} */ included) =>
            inputs({ p: { num }, backPay: { pNum, amount: LUMP, included } }).bpThisPeriod;
        const hppAdded = (/** @type {boolean} */ included) => inputs({ premium: { amount: HPP, included } }).hppForPeriod;
        assert.equal(bpAdded(55, 55, true), LUMP, 'ticked, on the payslip that carries it: the lump is added');
        assert.equal(bpAdded(55, 55, false), 0, 'the back-pay lump joins the total without consulting the tick');
        // The payslip gate as well (PAY-3): deleting the payslip check put the lump on EVERY payslip
        // of the year while the banner, which has a gate of its own, hid on all but one.
        assert.equal(bpAdded(55, 56, true), 0, 'ticked, but this is another payslip: nothing is added');
        assert.equal(bpAdded(0, 0, true), 0, 'no payslip carries the lump, and none is on screen: nothing is added');
        assert.equal(hppAdded(true), HPP, 'ticked: the premium is added');
        assert.equal(hppAdded(false), 0, 'the Holiday Pay Premium joins the total without consulting the tick');
        // And what is not added is not priced: the gross is the hours alone.
        assert.equal(inputs({ backPay: { pNum: 55, amount: LUMP, included: false }, premium: { amount: HPP, included: false } }).pricing.gross, 3000);
    });

    test('4 — every banner the page paints goes through this module', () => {
        // A fourth banner hand-rolled beside these two would carry no copy builder and none of the
        // rules above. The module owns the surface, so the surface has to be enumerable.
        const paints = [...APP.matchAll(/paintBanner\(/g)].length;
        const copies = [...APP.matchAll(/(backPayBannerCopy|hppBannerCopy)\(/g)].length;
        assert.equal(paints, 2, `paycalc-app.js paints ${paints} banners; this guard knows about 2`);
        assert.equal(copies, 2, `paycalc-app.js builds ${copies} banner copies; this guard knows about 2`);
        for (const id of ['bpActiveBanner', 'hppActiveBanner']) {
            assert.ok(APP.includes(id), `${id} is no longer painted from paycalc-app.js`);
        }
    });
});
