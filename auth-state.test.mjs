/**
 * Unit tests for auth-state.js — the auth STORE (Phase 2).
 * Pure (the store imports only the pure reducer); no mocks. Part of test:hygiene.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getAuthSnapshot, subscribeAuth, dispatchAuth, _resetAuthState } from './auth-state.js';

beforeEach(() => _resetAuthState());

describe('getAuthSnapshot / dispatchAuth', () => {
    test('starts at the initialising state', () => {
        assert.deepEqual(getAuthSnapshot(), { status: 'initialising', member: null, error: null });
    });
    test('dispatch updates the snapshot via the reducer', () => {
        dispatchAuth({ type: 'RESOLVE_START', member: 'G. Miller' });
        assert.equal(getAuthSnapshot().status, 'resolving');
        dispatchAuth({ type: 'NAMED', member: 'G. Miller' });
        assert.deepEqual(getAuthSnapshot(), { status: 'named', member: 'G. Miller', error: null });
    });
    test('the snapshot is always a frozen object', () => {
        dispatchAuth({ type: 'NAMED', member: 'G. Miller' });
        assert.ok(Object.isFrozen(getAuthSnapshot()));
    });
});

describe('subscribeAuth', () => {
    test('calls the listener immediately with the current state', () => {
        dispatchAuth({ type: 'NAMED', member: 'G. Miller' });
        /** @type {any[]} */ const seen = [];
        subscribeAuth(s => seen.push(s.status));
        assert.deepEqual(seen, ['named'], 'listener is invoked synchronously on subscribe');
    });
    test('calls the listener again on every change', () => {
        /** @type {any[]} */ const seen = [];
        subscribeAuth(s => seen.push(s.status));   // immediate: initialising
        dispatchAuth({ type: 'RESOLVE_START', member: 'X' });
        dispatchAuth({ type: 'NAMED', member: 'X' });
        assert.deepEqual(seen, ['initialising', 'resolving', 'named']);
    });
    test('unsubscribe stops further calls', () => {
        /** @type {any[]} */ const seen = [];
        const off = subscribeAuth(s => seen.push(s.status));   // immediate: initialising
        off();
        dispatchAuth({ type: 'NAMED', member: 'X' });
        assert.deepEqual(seen, ['initialising'], 'no calls after unsubscribe');
    });
    test('a no-op transition does NOT notify (unknown event)', () => {
        /** @type {any[]} */ const seen = [];
        subscribeAuth(s => seen.push(s.status));   // immediate: initialising
        dispatchAuth({ type: 'NONSENSE' });
        dispatchAuth({ type: 'RETRY' });           // RETRY from non-degraded = no-op
        assert.deepEqual(seen, ['initialising'], 'no-op transitions must not fire listeners');
    });
    test('a throwing listener is isolated — others still run and dispatch does not throw', () => {
        /** @type {any[]} */ const seen = [];
        subscribeAuth(() => { throw new Error('boom'); });
        subscribeAuth(s => seen.push(s.status));
        assert.doesNotThrow(() => dispatchAuth({ type: 'NAMED', member: 'X' }));
        assert.ok(seen.includes('named'), 'the well-behaved listener still received the update');
    });
});

describe('_resetAuthState', () => {
    test('resets the state and drops listeners', () => {
        /** @type {any[]} */ const seen = [];
        subscribeAuth(s => seen.push(s.status));
        dispatchAuth({ type: 'NAMED', member: 'X' });
        _resetAuthState();
        assert.deepEqual(getAuthSnapshot(), { status: 'initialising', member: null, error: null });
        dispatchAuth({ type: 'NAMED', member: 'Y' });   // old listener was dropped
        assert.ok(!seen.includes('named') || seen.filter(x => x === 'named').length === 1,
            'the pre-reset listener must not receive post-reset events');
    });
});
