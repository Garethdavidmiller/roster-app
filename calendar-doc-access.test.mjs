/**
 * calendar-doc-access.test.mjs — the DOCUMENT gate, by what a wrong answer costs.
 * Run: node scripts/run-tests.mjs calendar-doc-access.test.mjs   (part of `npm run test:hygiene`)
 *
 * OPEN WHEN IT SHOULD BE SHUT is the expensive direction and it is silent: a Huddle the local cache
 * still holds paints for whoever picked up the phone, and no rule on the server can see the read.
 * So the gate defaults shut, opens only on a literal `true` (a name or a 1 is truthy and must not
 * count), and a subscriber that throws must not stop the others being told to close.
 * SHUT WHEN IT SHOULD BE OPEN costs a tap: a "sign in to read this" message over a document the
 * reader is entitled to. Pinned too, from the other side.
 *
 * THE GATE KEEPS NO ANSWER AND HAS NO WRITE. It reads calendar-access-state.js, so every test here
 * opens and shuts it through that module's one write, `setCalendarAccess` — the call the access
 * layer makes in the app. What this file pins is the gate's own half: that it reports that answer,
 * and that it tells its subscribers once per change.
 *
 * ── ONE ASSERTION HERE RUNS BEFORE THE `beforeEach`, AND THAT IS THE POINT ──────────────────────
 *
 * Every test below starts from a state the `beforeEach` has just shut, so none of them can see the
 * value the modules actually LOAD with — which is the only value a real page ever gets, because
 * nothing in the app resets it. The state could be initialised open and this whole file would stay
 * green while a locked Calendar reported document access from its first line: the Huddle, Circular
 * and Newsletter viewers and the drawer's two document links would each issue a read the local
 * Firestore cache answers WITHOUT consulting the server's rules, and yesterday's Huddle would paint
 * for whoever picked up the station phone before any PIN. `AT_LOAD` is therefore captured at
 * import, where the harness cannot reach it.
 * (`e2e/calendar-pin.spec.js` does catch this in a real browser — this closes the unit half.)
 */
import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { hasDocumentAccess, onDocumentAccess, documentAccess, _clearDocumentSubscribersForTests }
    from './calendar-doc-access.js';
import { setCalendarAccess } from './calendar-access-state.js';

// Read AT IMPORT — this line runs while the module graph is still being evaluated, before any test
// and therefore before any reset. Both readers are sampled: `documentAccess` is the frozen handle
// the viewers are actually given, and it is a separate expression from `hasDocumentAccess`.
const AT_LOAD = { has: hasDocumentAccess(), viaHandle: documentAccess.has() };

// The subscribers go FIRST, so none hears the shut that follows.
const reset = () => { _clearDocumentSubscribersForTests(); setCalendarAccess(false); };
beforeEach(reset);

describe('open when it should be shut — the silent direction', () => {
    test('shut AS LOADED — the value no reset has touched, and the only one a real page gets', () => {
        // The assertion is on AT_LOAD, not on a fresh call: calling here would measure the answer
        // the `beforeEach` left, which is what every other test in this file measures and is not
        // the same question. Nothing in the app resets the state, so if it can load open, a locked
        // Calendar is open.
        assert.equal(AT_LOAD.has, false,
            'the gate must load SHUT — a browser holding a cached Huddle would paint it before any PIN');
        assert.equal(AT_LOAD.viaHandle, false,
            'and the frozen handle the viewers are given must agree with it at load');
    });

    test('and the reset puts it back to that same value, so the rest of this file is honest', () => {
        // Guard on the guard: if the reset ever left something OTHER than the load value, every
        // test below would be describing a state the shipped modules never occupy.
        setCalendarAccess(true);
        reset();
        assert.equal(hasDocumentAccess(), AT_LOAD.has);
    });

    test('the test seam drops the subscribers and shuts NOTHING — this gate has no write of its own', () => {
        // The seam used to shut the state as well. A gate that can write is a second name for
        // locking the whole Calendar, so the write went and the tests shut the state themselves.
        let told = 0;
        onDocumentAccess(() => { told++; });
        setCalendarAccess(true);
        _clearDocumentSubscribersForTests();
        assert.equal(hasDocumentAccess(), true, 'the seam shut the state — the document gate must not be able to');
        setCalendarAccess(false);
        assert.equal(told, 1, 'a dropped subscriber still heard the shut');
    });

    test('only a literal true opens it — a truthy name string is NOT access', () => {
        setCalendarAccess(/** @type {any} */ ('G. Miller'));
        assert.equal(hasDocumentAccess(), false);
        setCalendarAccess(/** @type {any} */ (1));
        assert.equal(hasDocumentAccess(), false);
        setCalendarAccess(true);
        assert.equal(hasDocumentAccess(), true);
    });
    test('a throwing subscriber does not stop the next one hearing that access is GONE', () => {
        const heard = [];
        onDocumentAccess(() => { throw new Error('boom'); });
        onDocumentAccess(open => heard.push(open));
        setCalendarAccess(true);
        setCalendarAccess(false);
        assert.deepEqual(heard, [true, false], 'the viewer behind the broken subscriber must still lock');
    });
});

describe('shut when it should be open — the visible direction', () => {
    test('a full grant opens it and tells every subscriber once', () => {
        const heard = [];
        onDocumentAccess(open => heard.push(open));
        setCalendarAccess(true);
        assert.equal(hasDocumentAccess(), true);
        assert.deepEqual(heard, [true]);
    });
    test('a repeated grant is a no-op — a subscription already listening must not be re-attached', () => {
        let calls = 0;
        onDocumentAccess(() => { calls++; });
        setCalendarAccess(true); setCalendarAccess(true); setCalendarAccess(true);
        assert.equal(calls, 1);
    });
    test('unsubscribing works, and the shared handle reads the same state', () => {
        let calls = 0;
        const off = onDocumentAccess(() => { calls++; });
        off();
        setCalendarAccess(true);
        assert.equal(calls, 0);
        assert.equal(documentAccess.has(), true);
    });
});
