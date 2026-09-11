/**
 * overtime-form.test.mjs — WHAT THE FORM TELLS A MEMBER ABOUT A SUBMISSION IT CANNOT SEE.
 * Run with: node --experimental-test-module-mocks --test overtime-form.test.mjs
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────────────────
 *
 * `overtime-form.js` had no unit suite. The e2e already drives the three rules its header names
 * through a real browser — an unanswered day sends nothing, a submission past the deadline still
 * goes, and a timeout whose re-read ALSO fails admits it does not know — so none of those is
 * repeated here. What a browser test cannot force is the rest of the ladder that hangs off a
 * timeout: which verdict was reached, what the form then believes about the server, and whether a
 * second press is possible while the re-read is still in flight. Those need the re-read's answer
 * chosen by the test, and the button's state read at an instant between two awaits.
 *
 * ── ORGANISED BY WHAT A WRONG ANSWER COSTS ──────────────────────────────────────────────────────
 *
 *   1. A SECOND, CONTRADICTORY DECLARATION. The expensive direction, and every case in the first
 *      block is a door to it. `AbortController` stops us waiting; it does not stop the server
 *      writing. So a timeout reported as a failure — or a re-read that found our own write and
 *      then failed to adopt its revision — sends a member back to submit a second version of their
 *      own availability. The roster is then planned from one of two answers, and nobody knows
 *      which. Nothing errors on either path.
 *   2. SOMEBODY ELSE'S WEEK, QUIETLY MERGED. A conflict means a version we have not seen is
 *      stored. Offering it must REPLACE what is on screen, never blend the two: a merge produces a
 *      third declaration about a person's own life that neither of them made, and it looks exactly
 *      like a normal saved form.
 *   3. A SAVE THE REST OF THE PAGE DOES NOT KNOW ABOUT. The cheapest of the three and still not
 *      free: the week LIST is re-rendered from the same `win` objects, so a submission that is not
 *      written back leaves a member who pressed Back reading "Not submitted yet" about the form
 *      they had just watched succeed (v20.75).
 *
 * ── THE HARNESS ────────────────────────────────────────────────────────────────────────────────
 *
 * `renderWeekForm` writes markup into a host and then queries a fixed, small set of selectors out
 * of it, so the fake DOM answers those by NAME rather than parsing anything. Everything the module
 * decides — the verdicts, the copy, the disabled window — is reachable that way.
 *
 * `overtime-format.js` is the REAL module: `reconcileVerdict` and `conflictIsOurs` are the rules
 * under test here, and a restatement of them in the harness would pin the harness. Only the three
 * modules that reach the network or the platform are mocked.
 */

import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── THE FAKE DOM ────────────────────────────────────────────────────────────────────────────────

/** One element: enough surface for what this module actually touches, and nothing more. */
function fakeEl(extra = {}) {
    return {
        innerHTML: '', textContent: '', className: '', value: '', type: '',
        disabled: false, checked: false, hidden: false,
        /** @type {Record<string, Function[]>} */ _on: {},
        addEventListener(/** @type {string} */ t, /** @type {Function} */ f) { (this._on[t] ||= []).push(f); },
        /** Fire every listener of a type, awaiting each — a click handler here is async. */
        async fire(/** @type {string} */ t) { for (const f of this._on[t] || []) await f(); },
        querySelector: () => null,
        querySelectorAll: () => [],
        appendChild() {}, focus() {}, scrollIntoView() {},
        ...extra,
    };
}

/** The host, answering the four selectors `renderWeekForm` reads back out of its own markup. */
function fakeHost() {
    const parts = {
        '.ot-days': fakeEl(), '.ot-feedback': fakeEl(),
        '.ot-submit': fakeEl(), '.ot-form-head': fakeEl(),
        '.ot-bulk-unavailable': fakeEl(),
    };
    return Object.assign(fakeEl({ querySelector: (/** @type {string} */ s) => parts[s] || null }), { parts });
}

/** Every element the module BUILT rather than found — the conflict offer is the only one. */
let created = [];
globalThis.document = /** @type {any} */ ({ createElement: () => { const e = fakeEl(); created.push(e); return e; } });
globalThis.CSS = /** @type {any} */ ({ escape: (/** @type {string} */ s) => s });

// ── THE MOCKED EDGES ────────────────────────────────────────────────────────────────────────────

/** Every call the form made to the server, in order. */
let calls = [];
/** Queued answers for `submitOvertimeAvailability`, consumed one per press. */
let submitResults = [];
/** The answer `getMyOvertimeState` gives the reconciliation re-read. */
let stateResult = { ok: false };
/** Read at the instant the re-read is issued — the only place the disabled window is observable. */
let disabledDuringReread = null;
/** The host under test, so the mock can read the button mid-flight. */
let liveHost = null;

mock.module('./overtime-data.js', {
    namedExports: {
        correctedNow: () => Date.parse('2026-08-20T09:00:00Z'),
        submitOvertimeAvailability: async (weekEnding, answers, baseRevision) => {
            calls.push({ call: 'submit', weekEnding, answers: JSON.parse(JSON.stringify(answers)), baseRevision });
            return submitResults.shift() ?? { ok: true, data: { revision: 1 } };
        },
        getMyOvertimeState: async () => {
            calls.push({ call: 'state' });
            disabledDuringReread = liveHost?.parts['.ot-submit'].disabled ?? null;
            return stateResult;
        },
    },
});

mock.module('./overlay.js', { namedExports: { confirmDialog: async () => true } });

mock.module('./overtime-roster.js', {
    namedExports: {
        rosterBadge: () => '',
        loadRosterContext: async (_m, dates) => ({
            knowledge: 'authoritative',
            byDate: Object.fromEntries(dates.map(d => [d, {
                shift: 'RD', isRest: true, hasTime: false, overnight: false,
                start: '', end: '', rosteredMinutes: 0,
            }])),
        }),
    },
});

const { renderWeekForm } = await import('./overtime-form.js');

// ── THE WEEK ────────────────────────────────────────────────────────────────────────────────────

const WEEK_START = '2026-08-30';
const WEEK_ENDING = '2026-09-05';
const DATES = ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'];
const MEMBER = 'G. Miller';

/** Seven answered days — the state a form must be in before Submit will send anything at all. */
const answeredWeek = (mode = 'unavailable') => Object.fromEntries(DATES.map(d => [d, { mode }]));

function makeWin(over = {}) {
    return {
        weekStart: WEEK_START, weekEnding: WEEK_ENDING, phase: 'INITIAL_OPEN',
        initialDeadlineAt: Date.parse('2026-08-25T11:00:00Z'),
        finalDeadlineAt: Date.parse('2026-09-01T11:00:00Z'),
        submission: { days: answeredWeek(), currentRevision: 3, lastMutationId: 'older' },
        ...over,
    };
}

/** Build the form and hand back everything a case needs to drive and read it. */
async function mountForm(over = {}) {
    const host = fakeHost();
    liveHost = host;
    const win = makeWin(over.win);
    let saved = 0;
    const handle = await renderWeekForm(/** @type {any} */ (host), win, MEMBER, { onSaved: () => { saved++; } });
    return {
        host, win, handle,
        savedCount: () => saved,
        submit: () => host.parts['.ot-submit'].fire('click'),
        /** The page's own all-week shortcut — how an empty form gets seven answers for real. */
        fillWeek: () => host.parts['.ot-bulk-unavailable'].fire('click'),
        feedback: () => host.parts['.ot-feedback'].textContent,
        submitDisabled: () => host.parts['.ot-submit'].disabled,
    };
}

beforeEach(() => {
    calls = [];
    submitResults = [];
    stateResult = { ok: false };
    disabledDuringReread = null;
    liveHost = null;
    created = [];
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
describe('a timeout must never become a second, contradictory declaration', () => {
// ────────────────────────────────────────────────────────────────────────────────────────────────

    test('the re-read finds OUR write, and the form adopts the revision it found', async () => {
        // Saying "it saved" and then leaving `baseRevision` where it was is the quiet half of this
        // failure: the member is reassured, presses Save again later out of habit, and that press
        // carries a revision the server has already moved past — so a submission that was never in
        // any danger comes back as a conflict about somebody else's changes.
        submitResults = [{ ok: false, code: 'timeout', mutationId: 'mine-1' }, { ok: true, data: { revision: 9 } }];
        stateResult = { ok: true, data: { windows: [{
            weekEnding: WEEK_ENDING,
            submission: { days: answeredWeek('all_day'), currentRevision: 7, lastMutationId: 'mine-1' },
        }] } };

        const f = await mountForm();
        await f.submit();

        assert.match(f.feedback(), /did save/, 'the member is told their submission landed');
        assert.equal(f.win.submission.currentRevision, 7, 'the week the page holds is the server\'s');
        assert.equal(f.savedCount(), 1, 'and the rest of the page is told, exactly as a plain success tells it');

        await f.submit();
        const sends = calls.filter(c => c.call === 'submit');
        assert.equal(sends.length, 2);
        assert.equal(sends[1].baseRevision, 7, 'the next press builds on the revision the re-read found');
    });

    test('the button stays disabled ACROSS the re-read, not merely during the send', async () => {
        // The window between "the send timed out" and "we know whether it landed" is the one moment
        // a second press would do real damage, and it is the one moment a browser test cannot
        // reliably catch the button in. Read here at the instant the re-read is issued.
        submitResults = [{ ok: false, code: 'timeout', mutationId: 'mine-1' }];
        stateResult = { ok: false };

        const f = await mountForm();
        await f.submit();

        assert.equal(disabledDuringReread, true, 'a second submission cannot race the read that decides the first');
        assert.equal(f.submitDisabled(), false, 'and the form is usable again once there is an answer');
    });

    test('a re-read that fails claims NOTHING, and changes nothing', async () => {
        // The copy is pinned in e2e. What is pinned here is that the form does not quietly adopt a
        // position anyway — an unknown outcome that had moved `win.submission` would make the next
        // press build on a revision nobody established.
        submitResults = [{ ok: false, code: 'timeout', mutationId: 'mine-1' }];
        stateResult = { ok: false };

        const f = await mountForm();
        const before = JSON.stringify(f.win.submission);
        await f.submit();

        assert.doesNotMatch(f.feedback(), /didn't reach the server/, 'never a claim the re-read cannot support');
        assert.equal(JSON.stringify(f.win.submission), before, 'and nothing is adopted on an unknown outcome');
        assert.equal(f.savedCount(), 0, 'the page is not told a save happened');
    });

    test('a week that has GONE is not reported as a submission that failed', async () => {
        // A withdrawal landing in the seconds after a timed-out send. Our id is nowhere to be
        // found, which reads exactly like "it never arrived" — and sending somebody to re-answer a
        // form that no longer exists is the one instruction that cannot possibly work.
        submitResults = [{ ok: false, code: 'timeout', mutationId: 'mine-1' }];
        stateResult = { ok: true, data: { windows: [] } };

        const f = await mountForm();
        await f.submit();

        assert.doesNotMatch(f.feedback(), /didn't reach the server/);
        assert.match(f.feedback(), /no longer available to you/);
        assert.equal(f.savedCount(), 0);
    });

    test('an ordinary refusal does NOT reconcile — there is nothing ambiguous about it', async () => {
        // Reconciliation exists because an abort leaves the outcome unknown. A server that answered
        // has already said what happened, and re-reading after one would be an extra round trip
        // that can only introduce a second opinion.
        submitResults = [{ ok: false, code: 'bad-time', data: { date: DATES[2] } }];

        const f = await mountForm();
        await f.submit();

        assert.equal(calls.filter(c => c.call === 'state').length, 0, 'no re-read after a stated refusal');
        assert.equal(f.submitDisabled(), false, 'and the member can correct it and press again');
    });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
describe('a conflict is shown, never blended', () => {
// ────────────────────────────────────────────────────────────────────────────────────────────────

    test('OUR OWN late write and somebody else\'s get opposite words', async () => {
        // The two states are indistinguishable from the client — a version we have not seen is
        // stored either way — and the server tells them apart by naming the id that won. Getting
        // this backwards tells a member their answer was overwritten when it is the stored one, or
        // that their own answer is safely stored when a colleague's is.
        submitResults = [
            { ok: false, code: 'timeout', mutationId: 'mine-1' },
            { ok: false, code: 'revision-conflict', data: { lastMutationId: 'mine-1', currentRevision: 8, days: answeredWeek('all_day') } },
        ];
        stateResult = { ok: false };   // leaves pendingMutationId set, which is the real sequence

        const ours = await mountForm();
        await ours.submit();          // times out, re-read fails, id stays pending
        await ours.submit();          // the late write lands and the server refuses this one
        assert.match(ours.feedback(), /Your earlier submission did save/);

        submitResults = [{ ok: false, code: 'revision-conflict', data: { lastMutationId: 'somebody-else', currentRevision: 8, days: answeredWeek('all_day') } }];
        const theirs = await mountForm();
        await theirs.submit();
        assert.match(theirs.feedback(), /newer version of this form is already saved/);
        assert.match(theirs.feedback(), /haven't overwritten it/);
    });

    test('showing the saved version REPLACES every day, and takes its revision with it', async () => {
        // Blending is the hazard the module header names, and it is invisible: a merged week is a
        // perfectly well-formed seven-day answer that neither the member nor the server ever made.
        submitResults = [
            { ok: false, code: 'revision-conflict', data: { lastMutationId: 'somebody-else', currentRevision: 8, days: answeredWeek('all_day') } },
            { ok: true, data: { revision: 9 } },
        ];

        const f = await mountForm();
        await f.submit();

        const show = created.find(e => e.textContent === 'Show the saved version');
        assert.ok(show, 'the conflict offers the stored week rather than describing it');
        await show.fire('click');

        assert.equal(f.win.submission.currentRevision, 8, 'the stored revision is adopted with the stored days');
        for (const d of DATES) {
            assert.equal(f.win.submission.days[d].mode, 'all_day', `${d} reads as the server has it`);
        }

        await f.submit();
        const sends = calls.filter(c => c.call === 'submit');
        assert.equal(sends[1].baseRevision, 8, 'and the next press is made against what was shown');
        for (const d of DATES) {
            assert.equal(sends[1].answers[d].mode, 'all_day', `${d} is sent as the stored answer, not the local one`);
        }
    });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
describe('a save the rest of the page can see', () => {
// ────────────────────────────────────────────────────────────────────────────────────────────────

    test('a plain success writes the answers and the revision back into the week', async () => {
        // The week LIST is re-rendered from these same `win` objects, so a submission left out of
        // one shows as "Not submitted yet" to a member who pressed Back on the form they had just
        // watched succeed (v20.75). Nothing errors and the answers are safely on the server.
        submitResults = [{ ok: true, data: { revision: 4 } }, { ok: true, data: { revision: 5 } }];

        const f = await mountForm({ win: { submission: null } });
        await f.fillWeek();       // an empty form, answered the way the page actually answers one
        await f.submit();

        assert.equal(f.win.submission.currentRevision, 4);
        assert.equal(f.savedCount(), 1);

        await f.submit();
        const sends = calls.filter(c => c.call === 'submit');
        assert.equal(sends[0].baseRevision, 0, 'a first submission builds on nothing');
        assert.equal(sends[1].baseRevision, 4, 'and the one after it builds on what came back');
    });
});
