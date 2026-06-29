// @ts-check
/**
 * auth-state-core.js — the PURE identity state machine (ARCHITECTURE_PLAN.md, Phase 1).
 *
 * No DOM, no Firebase, no localStorage, no redirects, no overlays — only
 * `reduceAuthState(prevState, event) → nextState`. The imperative shell
 * (`auth-state.js`, Phase 2) translates real Firebase/localStorage signals into events,
 * owns the single in-flight resolution, and renders; this module owns ONLY the
 * status-determination logic that is today scattered across `ensureFirebaseSession`'s
 * `_fbIdentity` writes (the global that concurrent calls race — the root of the
 * "works after reload" class of bug). A single pure reducer makes that determination
 * deterministic and unit-testable.
 *
 * **Identity states are facts about who the user is** — `initialising` / `resolving` /
 * `named` / `anonymous` / `signedOut` / `degraded` / `error`. They are NOT
 * page-authorisation outcomes: the same `named` user is "allowed" on Admin but
 * "forbidden" on Operations, so `needsLogin` / `forbidden` are POLICY decisions
 * (`requirePageAuth`, Phase 3), never states here.
 *
 * Behaviour-preserving: this module is not wired into anything yet (Phase 1). It maps
 * 1:1 onto the outcomes pinned by the Phase-0 characterisation tests
 * (`session.test.mjs`): a named sign-in → `named`; the flag-off anonymous fallback →
 * `anonymous`; a transient blip → `degraded` (retryable); a persistent named failure →
 * `signedOut`; total failure → `error`.
 */

/** @typedef {'initialising'|'resolving'|'named'|'anonymous'|'signedOut'|'degraded'|'error'} AuthStatus */
/** @typedef {{ status: AuthStatus, member: string|null, error: string|null }} AuthState */

/** Every valid identity status (for the shell + tests to reference). */
export const AUTH_STATUSES = Object.freeze(
    /** @type {AuthStatus[]} */ (['initialising', 'resolving', 'named', 'anonymous', 'signedOut', 'degraded', 'error']),
);

/** The state before anything has been checked. @type {AuthState} */
export const INITIAL_STATE = Object.freeze({ status: 'initialising', member: null, error: null });

/** @returns {AuthState} */
function make(/** @type {AuthStatus} */ status, /** @type {string|null} */ member, /** @type {string|null} */ error) {
    return Object.freeze({ status, member, error });
}

/**
 * Pure transition: given the current state and an event, return the next state.
 * Always returns a NEW frozen object (never mutates `state`); an unknown event type
 * returns `state` unchanged (Redux convention), so out-of-vocabulary events are inert.
 *
 * Events (dispatched by the Phase-2 shell from real auth signals):
 *  - `RESOLVE_START { member }` — begin establishing identity. `member` set → named
 *    resolution; `member` null → anonymous (calendar) bootstrap.
 *  - `NAMED { member }`         — the member's named session is confirmed.
 *  - `ANONYMOUS`                — an anonymous session is active (bootstrap / flag-off fallback).
 *  - `NONE { error }`           — no session could be established; recoverable → `signedOut`.
 *  - `TRANSIENT { error }`      — a retryable blip mid-resolution → `degraded` (member preserved).
 *  - `RETRY`                    — resume from `degraded` → `resolving` (no-op from any other state).
 *  - `FATAL { error }`          — non-recoverable → `error`.
 *  - `SIGN_OUT`                 — explicit logout → `signedOut`.
 *
 * Concurrency note: this reducer is deterministic and stateless; preventing STALE events
 * (e.g. a sign-in result from a superseded resolution) is the shell's job — it owns the
 * single in-flight resolution and a generation token. That separation is exactly what
 * removes the `_fbIdentity` race without the pure core needing any concurrency logic.
 *
 * @param {AuthState} state
 * @param {{ type: string, member?: string|null, error?: string|null }} event
 * @returns {AuthState}
 */
export function reduceAuthState(state, event) {
    const e = event || {};
    switch (e.type) {
        case 'RESOLVE_START': return make('resolving', e.member ?? null, null);
        case 'NAMED':         return make('named', e.member ?? state.member, null);
        case 'ANONYMOUS':     return make('anonymous', null, null);
        case 'NONE':          return make('signedOut', null, e.error ?? null);
        case 'TRANSIENT':     return make('degraded', state.member, e.error ?? null);
        case 'RETRY':         return state.status === 'degraded' ? make('resolving', state.member, null) : state;
        case 'FATAL':         return make('error', state.member, e.error ?? null);
        case 'SIGN_OUT':      return make('signedOut', null, null);
        default:              return state;
    }
}
