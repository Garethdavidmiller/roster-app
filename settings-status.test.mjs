/**
 * settings-status.test.mjs — the one line at the top of Settings, and which cards open themselves.
 *
 * Organised by what a wrong answer COSTS, and the two directions are nothing like each other:
 *
 *   FALSE REASSURANCE is the dangerous one and it is silent. "✓ You're all set" over a page that
 *   has not finished reading — or over a read that FAILED — tells a member their password is
 *   their own when nobody knows, and they close the page. Nothing errors, nothing looks wrong,
 *   and the thing Settings exists to tell them is the thing it got wrong. Every state that is not
 *   a confirmed `ok` has to be prevented from reading as one, which is why `unknown` and `error`
 *   each get their own block below rather than being folded into "not ok".
 *
 *   FALSE ALARM costs attention. A card that opens itself when nothing is wrong, or a to-do listed
 *   for a device that cannot do the thing, teaches the member that the summary is noise — and a
 *   summary nobody believes is worse than no summary, because the page is now longer as well.
 *
 * A per-function suite would pass on exactly the code that produces the first failure: `summarise`
 * is trivially right for every state it is GIVEN, and the defect is what it does with the states
 * it was not given.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { summarise, shouldOpen, CARD_ORDER } from './settings-status.js';

const ALL_OK = { password: 'ok', 'work-email': 'ok', notifications: 'ok' };

describe('false reassurance — the silent failure', () => {
    test('an empty report set is CHECKING, never all set', () => {
        // First paint. Three of the four states are async, so this is the state the page is
        // genuinely in for a moment on every single load.
        assert.equal(summarise({}).tone, 'checking');
    });

    test('one card still out is enough to hold the whole summary back', () => {
        for (const id of CARD_ORDER) {
            const states = { ...ALL_OK };
            delete states[id];
            assert.equal(summarise(states).tone, 'checking', `${id} unreported must not read as OK`);
        }
    });

    test('an explicit `unknown` is treated exactly like an absent report', () => {
        // A card that reports "I do not know yet" must not be luckier than one that says nothing.
        assert.equal(summarise({ ...ALL_OK, password: 'unknown' }).tone, 'checking');
    });

    test('unknown OUTRANKS a to-do, so the count can never be understated', () => {
        // The alternative — list what you know and keep counting — shows "1 thing to finish"
        // and then silently becomes 2. A member who acts on the first number leaves one undone.
        const s = summarise({ password: 'action', 'work-email': 'unknown', notifications: 'ok' });
        assert.equal(s.tone, 'checking');
        assert.deepEqual(s.items, []);
    });

    test('a FAILED read is not a pass', () => {
        // Everything has reported and nothing is outstanding — but one card learnt nothing, and
        // "all set" over the top of that is the same lie as "all set" over silence.
        const s = summarise({ ...ALL_OK, 'work-email': 'error' });
        assert.equal(s.tone, 'error');
        assert.notEqual(s.headline, '✓ You’re all set');
    });

    test('all set is reachable, and says so — the guard must not be a permanent hedge', () => {
        const s = summarise(ALL_OK);
        assert.equal(s.tone, 'all-set');
        assert.deepEqual(s.items, []);
    });

    test('a card that cannot be in a bad state does not hold the page in limbo', () => {
        // Notifications are unsupported (iOS in a browser tab). Not a to-do, not an error, and it
        // must not stop the other two reporting all-set.
        assert.equal(summarise({ ...ALL_OK, notifications: 'n/a' }).tone, 'all-set');
    });
});

describe('false alarm — the noisy failure', () => {
    test('a configured card does not open itself', () => {
        assert.equal(shouldOpen('ok'), false);
    });

    test('nor does one that has not reported yet', () => {
        // Opening on `unknown` means every card flaps open at first paint and shuts as its answer
        // lands — the reflow this whole feature exists to remove.
        assert.equal(shouldOpen('unknown'), false);
    });

    test('nor one that has nothing to be right or wrong about', () => {
        assert.equal(shouldOpen('n/a'), false);
    });

    test('but anything the member must look at DOES open', () => {
        for (const s of ['action', 'blocked', 'error']) {
            assert.equal(shouldOpen(/** @type {any} */ (s)), true, `${s} must open its card`);
        }
    });

    test('a blocked card is named as blocked, not as a thing to go and do', () => {
        // "Turn on notifications" is a lie when the browser will refuse: the member taps, nothing
        // happens, and the summary has sent them into a dead end.
        const s = summarise({ ...ALL_OK, notifications: 'blocked' });
        assert.deepEqual(s.items, ['Notifications are blocked on this phone']);
    });

    test('pay data can never appear in the summary at all', () => {
        // It has no wrong state — it is a fact about the device, not a setting to get right — so
        // it must not be able to nag, whatever it reports.
        assert.ok(!CARD_ORDER.includes('pay-data'));
        for (const state of ['action', 'error', 'unknown', 'blocked']) {
            assert.equal(summarise({ ...ALL_OK, 'pay-data': state }).tone, 'all-set',
                `pay-data '${state}' must not disturb the summary`);
        }
    });
});

describe('the list itself', () => {
    test('the order is DECLARED, not the order the answers arrived in', () => {
        // Two report maps built in opposite key orders must produce the same list; otherwise the
        // line reshuffles between loads depending on which network answer won the race.
        const a = summarise({ password: 'action', 'work-email': 'action', notifications: 'action' });
        const b = summarise({ notifications: 'action', 'work-email': 'action', password: 'action' });
        assert.deepEqual(a.items, b.items);
        assert.deepEqual(a.items,
            ['Set your own password', 'Add your work email', 'Turn on notifications']);
    });

    test('the headline agrees with the list it sits above', () => {
        for (const n of [1, 2, 3]) {
            const states = { ...ALL_OK };
            CARD_ORDER.slice(0, n).forEach(id => { states[id] = 'action'; });
            const s = summarise(states);
            assert.equal(s.items.length, n);
            assert.ok(s.headline.startsWith(n === 1 ? '1 thing' : `${n} things`),
                `headline "${s.headline}" must state ${n}`);
        }
    });

    test('one outstanding item is singular', () => {
        // "1 things to finish" is the kind of thing a member notices and nothing else catches.
        assert.equal(summarise({ ...ALL_OK, password: 'action' }).headline, '1 thing to finish');
    });

    test('every listed card has words to be listed WITH', () => {
        // A card added to CARD_ORDER without a label would render its raw id — 'work-email' — in a
        // line staff read. Structural, so a later addition fails here rather than on the page.
        for (const id of CARD_ORDER) {
            const s = summarise({ ...ALL_OK, [id]: 'action' });
            assert.equal(s.items.length, 1);
            assert.notEqual(s.items[0], id, `${id} has no to-do label`);
            assert.ok(/^[A-Z]/.test(s.items[0]), `${id}'s label should read as a sentence`);
        }
    });
});
