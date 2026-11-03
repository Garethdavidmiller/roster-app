/**
 * admin-leave-year.test.mjs — the Annual Leave card's "which year's allowance" panel (v25.18).
 * Run: node --test admin-leave-year.test.mjs   (part of `npm run test:hygiene`)
 *
 * The markup is pure, so what a reader is OFFERED is tested without a page: which button is pressed,
 * which is refused and why, and that the figures say what `alPosition` says. The wiring — that a tap
 * reaches the save, and the save the right year — is the browser's, in e2e/pages.spec.js.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { leaveYearPanelHtml, leftWords, initLeaveYearPanel } from './admin-leave-year.js';

/** One January group as `leaveYearChoices` returns it. */
const group = (/** @type {any} */ over = {}) => ({
    january: 2027, prev: 2026, prevOpen: true,
    days: [{ date: '2027-01-05', from: 2027 }, { date: '2027-01-06', from: 2026 }],
    positions: { 2026: { remaining: 3 }, 2027: { remaining: 30 } },
    ...over,
});
/** The `<button>` for a date and year, as a string. */
const button = (/** @type {string} */ html, /** @type {string} */ date, /** @type {number} */ year) =>
    html.match(new RegExp(`<button[^>]*data-date="${date}" data-year="${year}"[^>]*>`))?.[0] ?? '';

describe('what the panel offers', () => {
    test('each day offers both years, with the one it comes out of pressed', () => {
        const html = leaveYearPanelHtml([group()]);
        assert.match(button(html, '2027-01-05', 2027), /aria-pressed="true"/);
        assert.match(button(html, '2027-01-05', 2026), /aria-pressed="false"/);
        assert.match(button(html, '2027-01-06', 2026), /aria-pressed="true"/);
        assert.match(html, /Tue 5 Jan/);
    });

    test('both years\' figures, in the words a reader uses', () => {
        assert.match(leaveYearPanelHtml([group()]), /2026: 3 days left · 2027: 30 days left/);
        assert.equal(leftWords(1), '1 day left');
        assert.equal(leftWords(0), '0 days left');
        assert.equal(leftWords(-2), '2 over');
    });

    test('THE CAP: with the earlier year full, it is refused on a day still on the later year — and says why', () => {
        const html = leaveYearPanelHtml([group({ prevOpen: false, positions: { 2026: { remaining: 0 }, 2027: { remaining: 30 } } })]);
        assert.match(button(html, '2027-01-05', 2026), / disabled/);
        assert.match(html, /2026 has no days left, so these days stay on 2027’s allowance\./);
    });

    test('a day already moved can always move FORWARD again, even with the earlier year full', () => {
        const html = leaveYearPanelHtml([group({ prevOpen: false, positions: { 2026: { remaining: 0 }, 2027: { remaining: 30 } } })]);
        assert.doesNotMatch(button(html, '2027-01-06', 2027), / disabled/);
        assert.doesNotMatch(button(html, '2027-01-06', 2026), / disabled/, 'its own pressed year is not refused either');
    });

    test('while a day saves, both its buttons are disabled — and only that day\'s', () => {
        const html = leaveYearPanelHtml([group()], { busyDate: '2027-01-05' });
        assert.match(button(html, '2027-01-05', 2026), / disabled/);
        assert.match(button(html, '2027-01-05', 2027), / disabled/);
        assert.doesNotMatch(button(html, '2027-01-06', 2027), / disabled/);
    });

    test('each day\'s pair is a labelled group, so a screen reader hears which day it is choosing for', () => {
        assert.match(leaveYearPanelHtml([group()]), /role="group" aria-label="Which year’s allowance Tue 5 Jan comes out of"/);
    });
});

describe('the wiring, with a stand-in page', () => {
    /** A tiny element: enough DOM for the panel to draw into and be clicked. */
    function fakeEl() {
        /** @type {any} */
        const el = { hidden: true, innerHTML: '', textContent: '', className: '', listeners: /** @type {any[]} */ ([]) };
        el.addEventListener = (/** @type {string} */ _t, /** @type {any} */ fn) => el.listeners.push(fn);
        return el;
    }
    const MEMBER = { name: 'G. Miller', role: 'CEA', rosterType: 'main', currentWeek: 3 };
    const deps = (/** @type {any} */ over = {}) => ({
        root: fakeEl(), body: fakeEl(), feedback: fakeEl(),
        getMember: () => MEMBER, hasAuthority: () => true,
        getOverrides: () => [{ memberName: 'G. Miller', date: '2027-01-05', type: 'annual_leave', value: 'AL' }],
        todayStr: () => '2026-11-03',
        save: async () => {}, onSaved: () => {}, failureMessage: () => 'failed',
        ...over,
    });

    test('hidden while the switch is off — for everyone, whatever they hold', () => {
        const d = deps();
        initLeaveYearPanel(d).refresh();
        assert.equal(d.root.hidden, true);
        assert.equal(d.body.innerHTML, '');
    });

    test('with the switch on, a tap saves THAT day on THAT year — and the default year saves as nothing', async () => {
        const g = /** @type {any} */ (globalThis);
        const was = g.__E2E;
        g.__E2E = { leaveYearChoice: true };
        try {
            /** @type {any[]} */
            const saved = [];
            const d = deps({ save: async (/** @type {any} */ a) => { saved.push(a); } });
            const panel = initLeaveYearPanel(d);
            panel.refresh();
            const tap = async (/** @type {number} */ year) => {
                const btn = { disabled: false, dataset: { date: '2027-01-05', year: String(year) },
                    getAttribute: () => 'false' };
                await d.body.listeners[0]({ target: { closest: () => btn } });
            };
            await tap(2026);
            await tap(2027);
            assert.deepEqual(saved, [
                { memberName: 'G. Miller', date: '2027-01-05', leaveYear: 2026 },
                { memberName: 'G. Miller', date: '2027-01-05', leaveYear: null },
            ]);
            assert.match(d.feedback.textContent, /now comes out of 2027’s allowance/);
        } finally {
            if (was === undefined) delete g.__E2E; else g.__E2E = was;
        }
    });

    test('unread records show nothing — an unread member and one with no leave look alike', () => {
        const g = /** @type {any} */ (globalThis);
        const was = g.__E2E;
        g.__E2E = { leaveYearChoice: true };
        try {
            const d = deps({ hasAuthority: () => false });
            initLeaveYearPanel(d).refresh();
            assert.equal(d.root.hidden, true);
        } finally {
            if (was === undefined) delete g.__E2E; else g.__E2E = was;
        }
    });
});
