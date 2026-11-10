/**
 * paycalc-result-headline.test.mjs — the headline figure and the words beside it must agree.
 * Run: node scripts/run-tests.mjs paycalc-result-headline.test.mjs   (part of `npm run test:hygiene`)
 *
 * @nodeps-safe — runs on a bare checkout with nothing installed.
 *
 * ── ORGANISED BY WHAT A WRONG ANSWER COSTS ──────────────────────────────────────────────────────
 *
 * This module has one job and one failure mode, and a per-function suite would miss it. Both of its
 * branches are trivially right in isolation: the actual path says "actual", the estimate path says
 * "estimated". The defect is not INSIDE a branch — it is BETWEEN them, and it is silent.
 *
 * CALLING AN ESTIMATE AN ACTUAL is the expensive direction. A member reading "✅ Your Actual
 * Take-Home Pay" over a figure the calculator guessed has no reason to check it against anything;
 * that is the whole point of the label. Nothing throws, the number is plausible, and the two differ
 * by real money — which is the only reason the actuals overlay exists at all.
 *
 * A STALE TARGET is how that happens in practice. Six DOM targets, two paths: leave one unwritten
 * on one path and it keeps the previous render's value. Switching periods is enough to produce it.
 * So the renderer is asserted to write every target on BOTH paths, against a recording fake DOM —
 * a harness that only checked the values it expected could not see a target nobody wrote.
 *
 * SAYING TWO DIFFERENT THINGS is the third: the visible label and the accessible name are built
 * from one branch deliberately, because a screen-reader user and a sighted user must not disagree
 * about whether the number in front of them is confirmed.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { headlineLabels, renderResultHeadline, renderYtdLine } from './paycalc-result-headline.js';

const PAYDAY = new Date(2026, 8, 25);          // Fri 25 Sep 2026
const ACTUAL = { gross: 4200, tax: 700, ni: 300, sl: 0, net: 3200 };

// ── a recording fake DOM ────────────────────────────────────────────────────────────────────────
// It records WHICH targets were touched, not only what they were set to. That distinction is the
// point: the defect this file exists for is a target nobody wrote.
const TARGETS = ['netLabel', 'netDisplay', 'summary', 'bdBtn', 'stickyAmount', 'stickyLabel', 'stickyTotal'];
function fakeDom() {
    /** @type {Record<string, any>} */ const els = {};
    // `ownerDocument` is not decoration: setStatus (status-text.js) builds the hidden-glyph span as
    // real NODES rather than an innerHTML template, so an element without one throws. A stub that
    // papered over that would be testing a different function from the one that ships.
    const doc = {
        getElementById: (/** @type {string} */ id) => els[id] ?? null,
        createElement: () => node(),
        createTextNode: (/** @type {string} */ t) => ({ nodeText: String(t) }),
    };
    function node(id = '') {
        return {
            id, ownerDocument: doc, written: new Set(),
            attrs: /** @type {Record<string,string>} */ ({}), kids: /** @type {any[]} */ ([]),
            _t: '', _h: '',
            set textContent(v) { this._t = String(v); this.kids = []; this.written.add('textContent'); },
            // Reads back the whole rendered string, children included — the same thing the real
            // platform does, and what lets an assertion see what a member would read.
            get textContent() {
                return this._t + this.kids.map(k => k.nodeText ?? k.textContent ?? '').join('');
            },
            set innerHTML(v) { this._h = String(v); this.written.add('innerHTML'); },
            get innerHTML() { return this._h; },
            setAttribute(k, v) { this.attrs[k] = String(v); this.written.add(`@${k}`); },
            getAttribute(k) { return this.attrs[k] ?? null; },
            appendChild(k) { this.kids.push(k); return k; },
            append(...k) { this.kids.push(...k); },
        };
    }
    for (const id of TARGETS) els[id] = node(id);
    globalThis.document = /** @type {any} */ (doc);
    return els;
}
/** What the member actually reads on the card and in the strip. */
const visible = (els) => `${els.netLabel.textContent} | ${els.stickyLabel.innerHTML} | ${els.stickyAmount.textContent}`;

describe('an estimate is never called an actual, and an actual is never called an estimate', () => {
    test('the actual path says ACTUAL in every place it speaks', () => {
        const L = headlineLabels({ hasActual: true, payday: PAYDAY });
        assert.match(L.netLabel, /Actual/);
        assert.match(L.stickyLabelHtml, /Actual take-home/);
        assert.match(L.stickyWords, /Actual take-home/);
        assert.ok(!/[Ee]stimated take-home/.test(L.stickyLabelHtml), 'the strip must not hedge a confirmed figure');
    });

    test('the estimate path says ESTIMATED in every place it speaks', () => {
        const L = headlineLabels({ hasActual: false, payday: PAYDAY });
        assert.match(L.netLabel, /Estimated/);
        assert.match(L.stickyLabelHtml, /Estimated take-home/);
        assert.match(L.stickyWords, /Estimated take-home/);
        assert.ok(!/Actual take-home/.test(L.stickyLabelHtml));
    });

    test('the two branches are never confusable — no wording is shared', () => {
        // The assertion that would have caught a copy-paste between branches, which is how they
        // were maintained before this module existed: every fix had to be made twice by hand.
        const a = headlineLabels({ hasActual: true,  payday: PAYDAY });
        const e = headlineLabels({ hasActual: false, payday: PAYDAY });
        for (const k of /** @type {const} */ (['netLabel', 'stickyLabelHtml', 'stickyWords', 'bdBtnHtml'])) {
            assert.notEqual(a[k], e[k], `${k} is identical on both paths — one of them is wrong`);
        }
    });

    test('the breakdown button changes JOB, not just wording', () => {
        // With a confirmed figure on screen the panel below is a COMPARISON, not a breakdown of the
        // number above it. A member told "full pay breakdown" would read the estimate as the detail
        // of their actual pay.
        assert.match(headlineLabels({ hasActual: true,  payday: PAYDAY }).bdBtnHtml, /Compare with estimate/);
        assert.match(headlineLabels({ hasActual: false, payday: PAYDAY }).bdBtnHtml, /Full pay breakdown/);
    });

    test('the headline FIGURE follows the label — the actual, not the estimate', () => {
        const els = fakeDom();
        renderResultHeadline({ actual: ACTUAL, net: 2900, payday: PAYDAY });
        assert.equal(els.netDisplay.textContent, '£3,200.00');
        assert.equal(els.stickyAmount.textContent, '£3,200.00', 'the strip must not carry the estimate under an actual label');
        assert.match(els.summary.innerHTML, /Calculator estimate.*£2,900\.00/s, 'and the estimate is shown as the comparison');
    });
});

describe('a stale target — the silent way the two get crossed', () => {
    test('every shared target is written on BOTH paths', () => {
        const SHARED = ['netLabel', 'bdBtn', 'stickyAmount', 'stickyLabel', 'stickyTotal'];
        for (const actual of [ACTUAL, null]) {
            const els = fakeDom();
            renderResultHeadline({ actual, net: 2900, payday: PAYDAY });
            for (const id of SHARED) {
                assert.ok(els[id].written.size > 0,
                    `#${id} was not written on the ${actual ? 'actual' : 'estimate'} path — it keeps `
                    + 'whatever the previous render left there, which is how a confirmed figure ends '
                    + 'up under an estimate label');
            }
        }
    });

    test('rendering an estimate after an actual leaves nothing of the actual behind', () => {
        // The real sequence: a member on a payslip with imported actuals switches to one without.
        const els = fakeDom();
        renderResultHeadline({ actual: ACTUAL, net: 2900, payday: PAYDAY });
        const before = visible(els);
        renderResultHeadline({ actual: null, net: 2900, payday: new Date(2026, 9, 23) });
        const after = visible(els);
        assert.notEqual(after, before);
        assert.ok(!/Actual/.test(after), `the actual label survived into the estimate render: ${after}`);
        assert.equal(els.stickyAmount.textContent, '£2,900.00');
    });

    test('#summary is the ONE target the estimate path leaves alone, and that is deliberate', () => {
        // Named rather than left to be noticed: the ordinary summary rows are paycalc-breakdown.js's
        // and the coordinator writes them. If that ever stops being true this test says so.
        const els = fakeDom();
        renderResultHeadline({ actual: null, net: 2900, payday: PAYDAY });
        assert.equal(els.summary.written.size, 0);
    });

    test('a missing element does not throw — the sticky bar is not on every layout', () => {
        globalThis.document = /** @type {any} */ ({ getElementById: () => null });
        assert.doesNotThrow(() => renderResultHeadline({ actual: null, net: 10, payday: PAYDAY }));
    });
});

describe('the visible label and the accessible name say the same thing', () => {
    for (const hasActual of [true, false]) {
        test(`${hasActual ? 'actual' : 'estimate'}: both name the same payslip and the same confidence`, () => {
            const L = headlineLabels({ hasActual, payday: PAYDAY });
            const word = hasActual ? 'Actual' : 'Estimated';
            assert.match(L.stickyLabelHtml, new RegExp(word));
            assert.match(L.stickyWords, new RegExp(word));
            // v18.14: the payday is the load-bearing half — a scrolled-away £ must name WHICH
            // payslip, because the back-pay lump lands on exactly one.
            assert.match(L.stickyLabelHtml, /25 Sep/);
            assert.match(L.stickyWords, /25 Sep/);
        });
    }

    test('with no period selected, neither claims a payslip', () => {
        const L = headlineLabels({ hasActual: false, payday: null });
        assert.ok(!/Paid/.test(L.stickyLabelHtml));
        assert.ok(!/Paid/.test(L.stickyWords), 'the bar\'s name must not claim a payslip either');
    });
});

// ── THE BAR'S NAME CONTAINS WHAT THE STRIP SHOWS (WCAG 2.5.3 Label in Name, v25.27) ──────────────
//
// axe checks it word by word from 4.14: the strip's visible words — its label, then the amount — must
// stand in the bar's accessible name in that order and side by side, because somebody driving the
// phone by voice says what they see. Driven through the real render, on every branch the label has,
// and read off the elements the member reads. axe's word rule restated small: case-folded, a bracketed
// aside dropped, anything not a letter or a digit a gap (the emoji, the £ and the "·" included).
describe('the take-home bar is named by what it shows', () => {
    const words = (/** @type {string} */ t) => t.normalize('NFKD').toLowerCase().replace(/\([^()]*\)/g, ' ')
        .split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const inOrder = (/** @type {string} */ name, /** @type {string} */ shown) => {
        const n = words(name), v = words(shown);
        return n.some((_, i) => v.every((w, j) => n[i + j] === w));
    };
    const CASES = [
        ['an actual, with its payday', { actual: ACTUAL, net: 2900, payday: PAYDAY }],
        ['an estimate, with its payday', { actual: null, net: 2900, payday: PAYDAY }],
        ['an estimate, no period', { actual: null, net: 2900, payday: null }],
        ['an estimate carrying back pay, no period', { actual: null, net: 2900, payday: null, bpThisPeriod: 400 }],
    ];
    for (const [what, cfg] of CASES) {
        test(what, () => {
            const els = fakeDom();
            renderResultHeadline(/** @type {any} */ (cfg));
            const shown = `${els.stickyLabel.innerHTML.replace(/<[^>]+>/g, ' ')} ${els.stickyAmount.textContent}`;
            const name = els.stickyTotal.getAttribute('aria-label');
            assert.ok(inOrder(name, shown), `the strip shows "${shown.replace(/\s+/g, ' ').trim()}" but is named "${name}"`);
            // Pressing it scrolls to the result and opens nothing — it promised the breakdown. Said
            // without "tap" (desktop audit, 7 Nov 2026): a keyboard reaches the bar as well as a thumb.
            assert.match(name, / — go to the result$/, 'and the name still says what pressing it does');
            assert.doesNotMatch(name, /\btap\b/i, 'in words a keyboard user can follow too');
        });
    }
});

describe('what the estimate says it INCLUDES', () => {
    const L = (o) => headlineLabels({ hasActual: false, payday: PAYDAY, ...o }).netLabel;

    test('back pay and HPP together, each hedged only when unconfirmed', () => {
        assert.match(L({ bpThisPeriod: 500, hppForPeriod: 200 }), /inc\. back pay & HPP/);
        assert.match(L({ bpThisPeriod: 500, hppForPeriod: 200, bpIsEstimate: true }), /inc\. est\. back pay & HPP/);
    });

    test('either alone', () => {
        assert.match(L({ bpThisPeriod: 500 }), /\(inc\. back pay\)/);
        assert.match(L({ hppForPeriod: 200 }), /\(inc\. HPP\)/);
        assert.match(L({ hppForPeriod: 200, hppIsEstimate: true }), /\(inc\. HPP estimate\)/);
    });

    test('neither — no empty parenthesis', () => {
        assert.equal(L({}), '💷 Estimated Take-Home Pay');
    });

    test('the composition does not reach the strip when a payslip is named', () => {
        // Deliberate: the strip stays compact, and what has to survive scrolling is WHICH payslip,
        // not what the figure is made of.
        const s = headlineLabels({ hasActual: false, payday: PAYDAY, bpThisPeriod: 500, hppForPeriod: 200 });
        assert.ok(!/inc\./.test(s.stickyLabelHtml));
    });

    test('…but the no-payday fallback DOES carry it, and that asymmetry is inherited', () => {
        // Found by mutation: the first version of the test above claimed the composition never
        // reaches the strip, which is false for the branch where no period is selected — and the
        // test passed only because it never exercised that branch. The behaviour predates this
        // module and the extraction was behaviour-preserving, so it is PINNED here rather than
        // tidied. With no payslip to name, the strip has nothing else to say, which is a defensible
        // reason for the difference; if it is ever made consistent, that is a product decision and
        // this test is where it gets made.
        const s = headlineLabels({ hasActual: false, payday: null, bpThisPeriod: 500, hppForPeriod: 200 });
        assert.match(s.stickyLabelHtml, /Estimated take-home \(inc\. back pay & HPP\)/);
    });
});

// ── THE YEAR TO DATE LINE (owner, 7 Nov 2026) ───────────────────────────────────────────────────
// The same discipline as the headline: written on every run, so a payslip that should be quiet
// never shows the previous payslip's line or date. When it shows is ytdUpdateFrom's rule
// (paycalc-periods.test.mjs); this pins that the renderer obeys it in both directions.
describe('the Year to Date line under the figure', () => {
    /** A line and its date span, recording what was written. */
    const lineDom = () => {
        const line = { hidden: true }, when = { textContent: '' };
        globalThis.document = /** @type {any} */ ({
            getElementById: (/** @type {string} */ id) => ({ netYtdNudge: line, netYtdNudgeDate: when })[id] ?? null,
        });
        return { line, when };
    };

    test('shows the date of the payslip to copy from, then clears both when told to be quiet', () => {
        const { line, when } = lineDom();
        renderYtdLine({ payday: new Date(2026, 9, 23, 12) });
        assert.equal(line.hidden, false);
        assert.equal(when.textContent, '23 Oct');
        renderYtdLine(null);
        assert.equal(line.hidden, true);
        assert.equal(when.textContent, '', 'a hidden line keeps no date for the next payslip to inherit');
    });

    test('a page without the line does not throw', () => {
        globalThis.document = /** @type {any} */ ({ getElementById: () => null });
        assert.doesNotThrow(() => renderYtdLine({ payday: new Date(2026, 9, 23, 12) }));
        assert.doesNotThrow(() => renderYtdLine(null));
    });
});
