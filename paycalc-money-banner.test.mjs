/**
 * paycalc-money-banner.test.mjs — a banner may only say "Includes" when the sum is actually in it.
 * Run: node --test paycalc-money-banner.test.mjs   (part of `npm run test:hygiene`)
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
import { backPayBannerCopy, hppBannerCopy, paintBanner } from './paycalc-money-banner.js';

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
            assert.match(c.text, /could land on this payslip|will land on this payslip/);
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

    test('HPP hedges an unconfirmed premium on both sentences', () => {
        assert.match(HPP({ isEstimate: true, forPeriod: 480 }).text, /estimated Holiday Pay Premium/);
        assert.match(HPP({ isEstimate: true }).text, /^ℹ️ Estimated Holiday Pay Premium/);
        assert.match(HPP({ isEstimate: false }).text, /^ℹ️ A Holiday Pay Premium/);
    });
});

describe('the notes, which differ on purpose', () => {
    test('back pay always explains how to improve the estimate', () => {
        assert.match(BP().note, /back to 1 April 2026\.$/);
        assert.match(BP({ thisPeriod: 1240 }).note, /back to 1 April 2026\.$/);
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
// "The figure above it" is `net`, computed in `calculate()` from `grossWithBp = gross +
// _bpThisPeriod + _hppForPeriod`. So the invariant holds exactly while the value handed to the copy
// builder is the SAME value folded into the gross. Pass `_bpAmount` (the lump available on this
// payslip) instead of `_bpThisPeriod` (the lump actually added) and every assertion above still
// passes, while a member reading an opted-OUT estimate is told it includes £476 it does not.
//
// ── WHY THIS IS STATIC, AND WHAT IT CANNOT SEE ──────────────────────────────────────────────────
//
// `calculate()` is a nested function inside `init()` in `paycalc-app.js`. It is not exported, not
// attached to `window`, and closes over ~40 pieces of coordinator state — so there is no seam a unit
// test can reach it through, and the only behavioural route is a rendered page. That route EXISTS
// and is used: `e2e/paycalc.spec.js` drives the tick and asserts the rendered £ beside the rendered
// sentence, which is the real guard. This is the cheap one that runs on every branch.
//
// It reads SOURCE TEXT, so it can be defeated by rewriting the call site in a shape it does not
// recognise — a variable renamed, the amount computed inline, the whole block moved to another
// module. Each of those would fail here loudly rather than silently, which is the behaviour wanted
// from a static guard; none of them would be a silent pass. What it genuinely cannot see is a change
// to what `_bpThisPeriod` MEANS: if line 840's own expression stopped requiring the tick, the two
// sides would still match and the banner would faithfully describe a wrong figure. Contract 3 below
// closes that one as far as text can.

describe('the CALLER passes the added sum, not the available one', () => {
    const APP = readFileSync(new URL('./paycalc-app.js', import.meta.url), 'utf8');

    /** The `paintBanner({...})` / `xBannerCopy({...})` block for one banner, comments stripped. */
    const callSite = (/** @type {string} */ fn) => {
        const at = APP.indexOf(`${fn}({`);
        assert.ok(at > 0, `${fn} is not called in paycalc-app.js — the guard is looking at the wrong file`);
        return APP.slice(at, APP.indexOf('})', at)).replace(/\/\/[^\n]*/g, '');
    };

    test('1 — the value fed to the back-pay banner is the value folded into the gross', () => {
        const gross = APP.match(/const grossWithBp = ([^;]+);/);
        assert.ok(gross, 'grossWithBp is no longer assembled in paycalc-app.js — re-read this guard');
        const added = gross[1];
        assert.match(added, /_bpThisPeriod/, 'the back-pay lump is not what joins the gross any more');
        assert.match(added, /_hppForPeriod/, 'the Holiday Pay Premium is not what joins the gross any more');

        // The copy builder must be handed the SAME names. Handing it `_bpAmount`/`_hppAmount` — the
        // sums merely AVAILABLE — is the defect, and it is one identifier apart from correct.
        assert.match(callSite('backPayBannerCopy'), /thisPeriod:\s*_bpThisPeriod\b/,
            'the back-pay banner is told about a different sum from the one in the total');
        assert.match(callSite('hppBannerCopy'), /forPeriod:\s*_hppForPeriod\b/,
            'the HPP banner is told about a different sum from the one in the total');
    });

    test('2 — and the tick each banner shows is the tick that gated that sum', () => {
        // `included` drives the checkbox, `thisPeriod` drives the sentence. A member who sees a
        // ticked box over "not added to this estimate" has been given two answers to one question.
        const bp = callSite('paintBanner');
        assert.match(bp, /included:\s*_bpIncluded\b/, 'the back-pay tick no longer reflects the opt-in state');
        const hppPaint = APP.slice(APP.indexOf('hppActiveBanner'));
        assert.match(hppPaint.slice(0, 400), /included:\s*_hppIncluded\b/, 'the HPP tick no longer reflects the opt-in state');
    });

    test('3 — and the sum only exists once the member has opted in', () => {
        // What contract 1 cannot see: the two sides agreeing about a value that stopped meaning
        // "added". Both are defined from their own tick, and if either definition drops it the
        // banner would say "Includes" truthfully about a figure nobody asked for.
        const bp = APP.match(/const _bpThisPeriod\s*=\s*([^;]+);/);
        const hpp = APP.match(/const _hppForPeriod\s*=\s*([^;]+);/);
        assert.ok(bp && hpp, 'the two added-sum variables are no longer declared here — re-read this guard');
        assert.match(bp[1], /_bpIncluded/, 'the back-pay lump joins the total without consulting the tick');
        assert.match(bp[1], /_bpAmount/, 'the back-pay lump is no longer the amount the card computed');
        assert.match(hpp[1], /_hppIncluded/, 'the Holiday Pay Premium joins the total without consulting the tick');
        assert.match(hpp[1], /_hppAmount/, 'the premium is no longer the amount the card computed');
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
