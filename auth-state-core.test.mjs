/**
 * Unit tests for auth-state-core.js — the pure identity state machine (Phase 1).
 * Pure logic, no mocks. Run as part of test:hygiene.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { reduceAuthState, INITIAL_STATE, AUTH_STATUSES } from './auth-state-core.js';

describe('INITIAL_STATE', () => {
    test('is the initialising state with no member or error', () => {
        assert.deepEqual(INITIAL_STATE, { status: 'initialising', member: null, error: null });
    });
    test('is frozen (immutable)', () => {
        assert.ok(Object.isFrozen(INITIAL_STATE));
    });
    test('AUTH_STATUSES lists exactly the seven identity states', () => {
        assert.deepEqual([...AUTH_STATUSES].sort(), [
            'anonymous', 'degraded', 'error', 'initialising', 'named', 'resolving', 'signedOut',
        ]);
    });
});

describe('reduceAuthState — each event', () => {
    test('RESOLVE_START with a member → resolving, member set', () => {
        const s = reduceAuthState(INITIAL_STATE, { type: 'RESOLVE_START', member: 'G. Miller' });
        assert.deepEqual(s, { status: 'resolving', member: 'G. Miller', error: null });
    });
    test('RESOLVE_START with no member → resolving, member null (anonymous bootstrap)', () => {
        const s = reduceAuthState(INITIAL_STATE, { type: 'RESOLVE_START' });
        assert.deepEqual(s, { status: 'resolving', member: null, error: null });
    });
    test('NAMED → named, member set, error cleared', () => {
        const prev = { status: 'resolving', member: 'G. Miller', error: 'auth/network-request-failed' };
        const s = reduceAuthState(prev, { type: 'NAMED', member: 'G. Miller' });
        assert.deepEqual(s, { status: 'named', member: 'G. Miller', error: null });
    });
    test('NAMED without an explicit member falls back to the member being resolved', () => {
        const prev = { status: 'resolving', member: 'S. Boyle', error: null };
        const s = reduceAuthState(prev, { type: 'NAMED' });
        assert.equal(s.status, 'named');
        assert.equal(s.member, 'S. Boyle');
    });
    test('ANONYMOUS → anonymous, member null', () => {
        const prev = { status: 'resolving', member: null, error: null };
        const s = reduceAuthState(prev, { type: 'ANONYMOUS' });
        assert.deepEqual(s, { status: 'anonymous', member: null, error: null });
    });
    test('NONE → signedOut, error recorded', () => {
        const prev = { status: 'resolving', member: 'G. Miller', error: null };
        const s = reduceAuthState(prev, { type: 'NONE', error: 'auth/invalid-credential' });
        assert.deepEqual(s, { status: 'signedOut', member: null, error: 'auth/invalid-credential' });
    });
    test('TRANSIENT → degraded, member PRESERVED so RETRY can resume', () => {
        const prev = { status: 'resolving', member: 'G. Miller', error: null };
        const s = reduceAuthState(prev, { type: 'TRANSIENT', error: 'auth/network-request-failed' });
        assert.deepEqual(s, { status: 'degraded', member: 'G. Miller', error: 'auth/network-request-failed' });
    });
    test('FATAL → error', () => {
        const prev = { status: 'resolving', member: 'G. Miller', error: null };
        const s = reduceAuthState(prev, { type: 'FATAL', error: 'auth/internal-error' });
        assert.deepEqual(s, { status: 'error', member: 'G. Miller', error: 'auth/internal-error' });
    });
    test('SIGN_OUT → signedOut, member + error cleared', () => {
        const prev = { status: 'named', member: 'G. Miller', error: null };
        const s = reduceAuthState(prev, { type: 'SIGN_OUT' });
        assert.deepEqual(s, { status: 'signedOut', member: null, error: null });
    });
});

describe('reduceAuthState — RETRY guard', () => {
    test('RETRY from degraded → resolving, member preserved', () => {
        const prev = { status: 'degraded', member: 'G. Miller', error: 'auth/timeout' };
        const s = reduceAuthState(prev, { type: 'RETRY' });
        assert.deepEqual(s, { status: 'resolving', member: 'G. Miller', error: null });
    });
    test('RETRY from a NON-degraded state is a no-op (returns the same reference)', () => {
        const prev = reduceAuthState(INITIAL_STATE, { type: 'NAMED', member: 'G. Miller' });
        const s = reduceAuthState(prev, { type: 'RETRY' });
        assert.equal(s, prev, 'RETRY only resumes a degraded resolution; otherwise inert');
    });
});

describe('reduceAuthState — purity & robustness', () => {
    test('an unknown event type returns the SAME state reference unchanged', () => {
        const s = reduceAuthState(INITIAL_STATE, { type: 'NONSENSE' });
        assert.equal(s, INITIAL_STATE);
    });
    test('a null/empty event returns the state unchanged', () => {
        assert.equal(reduceAuthState(INITIAL_STATE, /** @type {any} */ (null)), INITIAL_STATE);
    });
    test('never mutates the previous state', () => {
        const prev = { status: 'resolving', member: 'G. Miller', error: null };
        const snapshot = { ...prev };
        reduceAuthState(prev, { type: 'NAMED', member: 'G. Miller' });
        assert.deepEqual(prev, snapshot, 'prev must be untouched');
    });
    test('every produced state is frozen', () => {
        for (const ev of [
            { type: 'RESOLVE_START', member: 'X' }, { type: 'NAMED', member: 'X' }, { type: 'ANONYMOUS' },
            { type: 'NONE', error: 'e' }, { type: 'TRANSIENT', error: 'e' }, { type: 'FATAL', error: 'e' },
            { type: 'SIGN_OUT' },
        ]) {
            assert.ok(Object.isFrozen(reduceAuthState(INITIAL_STATE, ev)), `${ev.type} result must be frozen`);
        }
    });
    test('deterministic: same state + event → equal result', () => {
        const ev = { type: 'TRANSIENT', error: 'auth/timeout' };
        assert.deepEqual(reduceAuthState(INITIAL_STATE, ev), reduceAuthState(INITIAL_STATE, ev));
    });
});

describe('reduceAuthState — realistic lifecycles', () => {
    /** Fold a sequence of events from INITIAL_STATE. */
    const run = (events) => events.reduce(reduceAuthState, INITIAL_STATE);

    test('named happy path: start → resolve → named', () => {
        const s = run([{ type: 'RESOLVE_START', member: 'G. Miller' }, { type: 'NAMED', member: 'G. Miller' }]);
        assert.equal(s.status, 'named');
        assert.equal(s.member, 'G. Miller');
    });
    test('transient blip recovers: resolve → degraded → retry → named', () => {
        const s = run([
            { type: 'RESOLVE_START', member: 'G. Miller' },
            { type: 'TRANSIENT', error: 'auth/network-request-failed' },
            { type: 'RETRY' },
            { type: 'NAMED', member: 'G. Miller' },
        ]);
        assert.deepEqual(s, { status: 'named', member: 'G. Miller', error: null });
    });
    test('persistent failure: resolve → none → signedOut', () => {
        const s = run([
            { type: 'RESOLVE_START', member: 'G. Miller' },
            { type: 'NONE', error: 'auth/invalid-credential' },
        ]);
        assert.equal(s.status, 'signedOut');
        assert.equal(s.error, 'auth/invalid-credential');
    });
    test('anonymous calendar path: resolve(null) → anonymous', () => {
        const s = run([{ type: 'RESOLVE_START' }, { type: 'ANONYMOUS' }]);
        assert.equal(s.status, 'anonymous');
        assert.equal(s.member, null);
    });
    test('logout after named: → signedOut, clean', () => {
        const s = run([
            { type: 'RESOLVE_START', member: 'G. Miller' }, { type: 'NAMED', member: 'G. Miller' },
            { type: 'SIGN_OUT' },
        ]);
        assert.deepEqual(s, { status: 'signedOut', member: null, error: null });
    });
});
