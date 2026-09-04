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
