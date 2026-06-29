// @ts-check
/**
 * auth-state.js — the auth STORE (ARCHITECTURE_PLAN.md Track 1, Phase 2).
 *
 * Holds the single identity state (reduced by auth-state-core.js) and lets the rest of the
 * app OBSERVE it (`subscribeAuth` / `getAuthSnapshot`). The "shell adapter" role — the actual
 * Firebase/localStorage I/O — is fulfilled by the existing `session.js`, which FEEDS this store
 * via `dispatchAuth()`. Reusing the proven auth path (rather than re-wrapping Firebase, which
 * would duplicate session.js and add risk) keeps the dependency graph ACYCLIC:
 *
 *     session.js → auth-state.js → auth-state-core.js
 *
 * `auth-state.js` imports NEITHER `session.js` NOR `firebase-client.js`.
 *
 * Phase 2 is OBSERVING ONLY: nothing consumes the store yet, and `session.js` feeds it purely
 * as a side-effect (wrapped so a store error can never break auth), so `sessionReady` and every
 * page behave exactly as before. Phase 4+ coordinators subscribe to it; the policy layer
 * (Phase 3) reads it. ONLY the session.js bridge dispatches — everything else subscribes.
 */
import { reduceAuthState, INITIAL_STATE } from './auth-state-core.js';

/** @typedef {import('./auth-state-core.js').AuthState} AuthState */

/** @type {AuthState} */
let _state = INITIAL_STATE;
/** @type {Set<(s: AuthState) => void>} */
const _listeners = new Set();

/** The current identity snapshot (always a frozen AuthState). @returns {AuthState} */
export function getAuthSnapshot() {
    return _state;
}

/**
 * Subscribe to identity changes. The listener is called IMMEDIATELY with the current state,
 * then again on every change. Returns an unsubscribe function. A listener that throws is
 * isolated (logged, never breaks dispatch or other listeners).
 * @param {(s: AuthState) => void} listener
 * @returns {() => void}
 */
export function subscribeAuth(listener) {
    _listeners.add(listener);
    try { listener(_state); } catch (e) { console.error('[auth-state] listener threw on subscribe', e); }
    return () => { _listeners.delete(listener); };
}

/**
 * Feed an event into the store (the session.js bridge is the only caller in production).
 * A no-op transition — the reducer returning the SAME state, e.g. an unknown event or a
 * RETRY from a non-degraded state — does not notify listeners.
 * @param {{ type: string, member?: string|null, error?: string|null }} event
 */
export function dispatchAuth(event) {
    const next = reduceAuthState(_state, event);
    if (next === _state) return;
    _state = next;
    for (const fn of _listeners) {
        try { fn(_state); } catch (e) { console.error('[auth-state] listener threw', e); }
    }
}

/** Test-only: reset the store to INITIAL_STATE and drop all listeners. Not used in production. */
export function _resetAuthState() {
    _state = INITIAL_STATE;
    _listeners.clear();
}
