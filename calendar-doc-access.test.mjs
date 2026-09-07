/**
 * calendar-doc-access.test.mjs — the DOCUMENT gate, by what a wrong answer costs.
 * Run: node --test calendar-doc-access.test.mjs   (part of `npm run test:hygiene`)
 *
 * OPEN WHEN IT SHOULD BE SHUT is the expensive direction and it is silent: a Huddle the local cache
 * still holds paints for whoever picked up the phone, and no rule on the server can see the read.
 * So the gate defaults shut, opens only on a literal `true` (a provisional scope string is truthy
 * and must not count), and a subscriber that throws must not stop the others being told to close.
 * SHUT WHEN IT SHOULD BE OPEN costs a tap: a "sign in to read this" message over a document the
 * reader is entitled to. Pinned too, from the other side.
 */
import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { hasDocumentAccess, setDocumentAccess, onDocumentAccess, documentAccess, _resetDocumentAccessForTests }
    from './calendar-doc-access.js';

beforeEach(() => _resetDocumentAccessForTests());

describe('open when it should be shut — the silent direction', () => {
    test('shut on a freshly-loaded module', () => {
        assert.equal(hasDocumentAccess(), false);
    });
    test('only a literal true opens it — a provisional scope string is truthy and is NOT access', () => {
        setDocumentAccess(/** @type {any} */ ('G. Miller'));
        assert.equal(hasDocumentAccess(), false);
        setDocumentAccess(/** @type {any} */ (1));
        assert.equal(hasDocumentAccess(), false);
        setDocumentAccess(true);
        assert.equal(hasDocumentAccess(), true);
    });
    test('a throwing subscriber does not stop the next one hearing that access is GONE', () => {
        const heard = [];
        onDocumentAccess(() => { throw new Error('boom'); });
        onDocumentAccess(open => heard.push(open));
        setDocumentAccess(true);
        setDocumentAccess(false);
        assert.deepEqual(heard, [true, false], 'the viewer behind the broken subscriber must still lock');
    });
});

describe('shut when it should be open — the visible direction', () => {
    test('a full grant opens it and tells every subscriber once', () => {
        const heard = [];
        onDocumentAccess(open => heard.push(open));
        setDocumentAccess(true);
        assert.equal(hasDocumentAccess(), true);
        assert.deepEqual(heard, [true]);
    });
    test('a repeated grant is a no-op — a subscription already listening must not be re-attached', () => {
        let calls = 0;
        onDocumentAccess(() => { calls++; });
        setDocumentAccess(true); setDocumentAccess(true); setDocumentAccess(true);
        assert.equal(calls, 1);
    });
    test('unsubscribing works, and the shared handle reads the same state', () => {
        let calls = 0;
        const off = onDocumentAccess(() => { calls++; });
        off();
        setDocumentAccess(true);
        assert.equal(calls, 0);
        assert.equal(documentAccess.has(), true);
    });
});
