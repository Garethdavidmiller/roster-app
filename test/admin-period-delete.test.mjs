// @ts-check
/**
 * admin-period-delete.test.mjs — a Recorded-dates row's ✕ (admin-period-delete.js), through the real
 * delete with every page handle and Firebase call injected.
 * Run with: node --experimental-test-module-mocks scripts/run-tests.mjs test/admin-period-delete.test.mjs   (part of test:unit)
 *
 * Until 25 Nov 2026 this lived inside admin-app.js, which imports Firebase, so its one guarded rule —
 * the control is in flight from the confirming tap, before anything is awaited — was a search of the
 * coordinator's source text. Here it is asserted by tapping twice while the session wait is held.
 *
 * Real: which records a period holds and the line that says so (`periodDelete`), the failure wording
 * (`deleteFailureLine`, admin-override-store.js, loaded with its Firebase module mocked), the feedback
 * line and its fade. Mocked: the over-allowance planner (its rule is admin-al-week-save.test.mjs's; what
 * only this file can see is that the delete ASKS it and what it does with the answer). Names are invented.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

mock.module('../firebase-client.js', {
    namedExports: Object.fromEntries(['db', 'collection', 'query', 'where', 'orderBy', 'limit', 'getDocs', 'getDoc', 'doc',
        'runTransaction', 'writeBatch', 'whenOwnWritesSentFor', 'COLLECTIONS'].map(n => [n, () => { throw new Error(`${n} is not used here`); }])),
});
mock.module('../session.js', { namedExports: { sessionReady: Promise.resolve() } });
/** What the planner answers, and every question it was asked. @type {any} */ let _overage = null;
/** @type {any[]} */ let _planned = [];
mock.module('../admin-al-week-save.js', {
    namedExports: { planAlDelete: (/** @type {any} */ args) => { _planned.push(args); return _overage; } },
});

const { createPeriodDelete } = await import('../admin-period-delete.js');
const { DELETE_REFUSED } = await import('../admin-override-store.js');

const WHO = 'Q. Tester';
const leave = (/** @type {string} */ date) => ({ id: `${WHO}|${date}`, memberName: WHO, date, type: 'annual_leave', value: 'AL', source: 'manual' });

/** A node enough for `setStatus` (status-text.js), whose textContent reads back the whole line. */
function fakeEl() {
    /** @type {any[]} */ let kids = [];
    let own = '';
    const doc = { createElement: () => ({ textContent: '', setAttribute() {} }), createTextNode: (/** @type {string} */ t) => ({ textContent: t }) };
    return /** @type {any} */ ({
        className: '', disabled: false, ownerDocument: doc, focused: 0, scrolled: 0,
        get textContent() { return own + kids.map(k => k.textContent).join(''); },
        set textContent(v) { own = String(v ?? ''); kids = []; },
        appendChild(/** @type {any} */ k) { kids.push(k); return k; },
        focus() { this.focused++; },
        scrollIntoView() { this.scrolled++; },
    });
}

/** A held promise, released by hand — the session wait a second tap could arrive during. */
function held() {
    /** @type {(v?: any) => void} */ let release = () => {};
    const promise = new Promise(r => { release = r; });
    return { promise, release };
}

/** @type {any[]} */ let overrides;
/** @type {string[]} */ let order;
/** @type {any[][]} */ let commits;
/** @type {any[]} */ let confirms;
/** @type {string[]} */ let toasts;
/** @type {(shown: any[]) => Promise<any>} */ let commit;

function build({ sessionReady = Promise.resolve(), signedIn = () => true } = {}) {
    return createPeriodDelete({
        getOverrides: () => overrides, members: [{ name: WHO }], isRestGap: () => false, isRead: () => true,
        showConfirm: (...a) => { confirms.push(a); },
        sessionReady, signedIn,
        commit: (shown) => { commits.push(shown); order.push('commit'); return commit(shown); },
        removeFromCache: (ids) => { order.push(`removed ${[...ids].join(',')}`); },
        afterDelete: () => { order.push('redrawn'); },
        syncWeek: () => { order.push('week'); return []; },
        showToast: (m) => { toasts.push(m); },
    });
}

beforeEach(() => {
    overrides = [leave('2026-11-02'), leave('2026-11-03')];
    order = []; commits = []; confirms = []; toasts = []; _planned = []; _overage = null;
    commit = async () => {};
    mock.timers.enable({ apis: ['setTimeout'] });
});
afterEach(() => { mock.timers.reset(); });

describe('a period delete', () => {
    it('deletes the rows the period listed, in ONE commit, then redraws the page and the week, and says so', async () => {
        const del = build(), fb = fakeEl(), btn = fakeEl();
        await del('annual_leave', WHO, '2026-11-02', '2026-11-03', fb, btn, 2, { resume: () => {} });
        assert.deepEqual(commits.map(c => c.map((/** @type {any} */ o) => o.date)), [['2026-11-02', '2026-11-03']]);
        assert.deepEqual(order, ['commit', `removed ${WHO}|2026-11-02,${WHO}|2026-11-03`, 'redrawn', 'week']);
        assert.match(fb.textContent, /Deleted 2 days of Annual Leave for Q\. Tester/);
        assert.equal(fb.className, 'feedback success');
        assert.equal(toasts.length, 1, 'and the toast, since the line can be a screen above the row');
        assert.equal(btn.disabled, false, 'the control is given back');
    });

    it('is in flight from the confirming tap: a second tap during the session wait starts no second delete', async () => {
        const wait = held();
        const del = build({ sessionReady: wait.promise }), fb = fakeEl(), btn = fakeEl();
        const first = del('annual_leave', WHO, '2026-11-02', '2026-11-03', fb, btn, 2, { resume: () => {} });
        assert.equal(btn.disabled, true, 'disabled before anything is awaited');
        assert.equal(btn.textContent, '…');
        // The list's two-tap reads `disabled`: a disabled control takes no tap, so a second delete never starts.
        assert.equal(commits.length, 0);
        wait.release();
        await first;
        assert.equal(commits.length, 1);
        assert.equal(btn.disabled, false);
    });

    it('signed out while the session restored: says so, deletes nothing, and gives the control back', async () => {
        const del = build({ signedIn: () => false }), fb = fakeEl(), btn = fakeEl();
        await del('annual_leave', WHO, '2026-11-02', '2026-11-03', fb, btn, 2, { resume: () => {} });
        assert.deepEqual(commits, []);
        assert.match(fb.textContent, /signed out — please sign in again/);
        assert.equal(btn.disabled, false);
    });

    it('a failed delete says it could not DELETE — never "Couldn\'t save" — and a refusal shows its own line', async () => {
        const del = build(), btn = fakeEl();
        commit = async () => { throw new Error('network'); };
        const fb = fakeEl();
        await del('annual_leave', WHO, '2026-11-02', '2026-11-03', fb, btn, 2, { resume: () => {} });
        assert.equal(fb.textContent, '⚠ Could not delete — check your connection and try again.');
        assert.doesNotMatch(fb.textContent, /save/i);
        assert.equal(fb.className, 'feedback error');
        assert.deepEqual(order, ['commit'], 'nothing is redrawn as deleted');

        commit = async () => { throw Object.assign(new Error('x'), { code: DELETE_REFUSED, line: 'Someone else has changed Mon 2 Nov since your list loaded, so nothing was deleted.' }); };
        const fb2 = fakeEl();
        await del('annual_leave', WHO, '2026-11-02', '2026-11-03', fb2, btn, 2, { resume: () => {} });
        assert.equal(fb2.textContent, '⚠ Someone else has changed Mon 2 Nov since your list loaded, so nothing was deleted.');
        assert.equal(btn.disabled, false);
    });

    it('asks the over-allowance question first, deleting nothing; "Save anyway" deletes the rows shown at the first tap', async () => {
        _overage = { headline: 'This leaves 2027 one over', detail: 'by 1 day' };
        overrides = [{ ...leave('2026-11-02'), id: 'abs-1', type: 'sick', value: 'SICK' }];
        const del = build(), fb = fakeEl(), btn = fakeEl();
        /** @type {any} */ let resumedWith = null;
        const r = await del('sick', WHO, '2026-11-02', '2026-11-03', fb, btn, 2, { resume: (atPress) => { resumedWith = atPress; } });
        assert.equal(r, 'asked');
        assert.deepEqual(commits, []);
        assert.equal(confirms.length, 1);
        assert.equal(confirms[0][0], 'This leaves 2027 one over');
        assert.equal(confirms[0][5], 'sick', 'the Absence list\'s question is the Absence card\'s');
        assert.equal(btn.focused, 1, 'the ✕ holds focus, for the bar\'s Cancel to return to');
        assert.deepEqual(_planned[0].rows.map((/** @type {any} */ o) => o.id), ['abs-1'], 'the planner is asked about the rows shown');

        // Answered: what was on screen at the first tap goes, whatever the cache holds now.
        confirms[0][4]();
        const shownAtPress = [leave('2026-11-02')];
        overrides = [];
        await del('annual_leave', WHO, '2026-11-02', '2026-11-03', fb, btn, 1, { resume: () => {}, atPress: { shown: shownAtPress, said: '✓ Deleted 1 day of Annual Leave for Q. Tester' } });
        assert.ok(resumedWith, 'the bar\'s answer runs the delete again');
        assert.deepEqual(commits, [shownAtPress]);
        assert.equal(_planned.length, 1, 'and does not ask a second time');
    });
});
