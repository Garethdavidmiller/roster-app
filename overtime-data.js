// @ts-check
/**
 * overtime-data.js — every call the Overtime page makes to the server, and the corrected clock it
 * keeps from their answers.
 *
 * Owns: the four endpoint wrappers, the auth header, the timeout budgets, and `correctedNow()`.
 * Does NOT own: what any of it MEANS — the words live in overtime-format.js, the rules on the
 * server. No DOM.
 *
 * ── WHY EVERY CALL GOES THROUGH HERE ────────────────────────────────────────────────────────────
 * Three things have to happen identically on every request and are easy to forget on the fourth
 * one: a fresh ID token, a timeout budget ABOVE the endpoint's own ceiling, and — for the two read
 * endpoints — feeding `serverNow` back into the clock. Scattering them across the coordinator is
 * how one call ends up unbounded, which is exactly the defect `fetch-timeout.js` was written for.
 *
 * ── THE TIMEOUT BUDGETS ARE ABOVE THE SERVER'S, NEVER BELOW ─────────────────────────────────────
 * Each endpoint declares `timeoutSeconds: 60`. A client that gives up first turns a slow-but-
 * succeeding write into a reported failure — and for a submission that means telling a member
 * their availability did not save while the server is saving it.
 */

import { fetchWithTimeout, isFetchTimeout, isFetchAborted } from './fetch-timeout.js';
import { auth } from './firebase-client.js';
import { clockOffset } from './overtime-format.js';

const BASE = 'https://europe-west2-myb-roster.cloudfunctions.net';

/** 60s server ceiling + headroom. See the header: the bound ends an infinite wait, nothing more. */
const BUDGET_MS = 65_000;

/** Server-minus-client offset, refreshed by every read. 0 until the first answer arrives. */
let _offset = 0;
/** Whether the offset has ever been set — an unsynced page must not claim server-grade certainty. */
let _synced = false;

/** Corrected server time. Falls back to the device clock, which is better than nothing and known. */
export function correctedNow() {
    return Date.now() + _offset;
}

/** Has the clock been reconciled with the server at least once? */
export function clockSynced() {
    return _synced;
}

/** Test seam — the module holds process-wide clock state. */
export function _resetClock() { _offset = 0; _synced = false; }

/**
 * A single POST to an Overtime endpoint.
 *
 * Errors are NORMALISED into one shape so callers branch on a code rather than on a status number
 * and a message; `timeout` in particular must never be flattened into `failed`, because the two
 * want opposite copy on screen (see fetch-timeout.js).
 *
 * @param {string} name endpoint name
 * @param {object} body
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<{ ok: true, data: any } | { ok: false, code: string, status?: number, data?: any }>}
 */
async function post(name, body, opts = {}) {
    let token;
    try {
        const user = auth.currentUser;
        if (!user) return { ok: false, code: 'no-session' };
        token = await user.getIdToken();
    } catch (_) {
        return { ok: false, code: 'no-session' };
    }

    const tSend = Date.now();
    let res;
    try {
        res = await fetchWithTimeout(`${BASE}/${name}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(body || {}),
            signal: opts.signal,
        }, BUDGET_MS);
    } catch (err) {
        // The three-way distinction the copy depends on. A caller-cancelled request is the only one
        // that may be reported as nothing at all; a timeout must never be called a failure.
        if (isFetchTimeout(err))  return { ok: false, code: 'timeout' };
        if (isFetchAborted(err))  return { ok: false, code: 'cancelled' };
        return { ok: false, code: 'network' };
    }
    const tReceive = Date.now();

    let data = null;
    try { data = await res.json(); } catch (_) { /* a body-less error is still an error */ }

    if (typeof data?.serverNow === 'number') {
        _offset = clockOffset(data.serverNow, tSend, tReceive);
        _synced = true;
    }

    if (res.ok) return { ok: true, data };
    return {
        ok: false,
        status: res.status,
        // The server's own machine code where it sent one, so the UI can distinguish a conflict
        // from a closed window from a validation refusal without parsing prose.
        code: (data && data.error) || `http-${res.status}`,
        data,
    };
}

/**
 * The member's own windows, their submissions, and the authoritative clock.
 * @param {{ signal?: AbortSignal }} [opts]
 */
export function getMyOvertimeState(opts) {
    return post('getMyOvertimeState', {}, opts);
}

/**
 * The reviewer's planning horizon and retained history.
 * @param {{ signal?: AbortSignal }} [opts]
 */
export function getOvertimeManagerOverview(opts) {
    return post('getOvertimeManagerOverview', {}, opts);
}

/**
 * Preview (`dryRun: true`) or create a weekly window. Reviewer only.
 * The same server code runs either way — the preview is not a separate prediction.
 * @param {string} weekEnding
 * @param {{ dryRun?: boolean, signal?: AbortSignal }} [opts]
 */
export function createOvertimeWindow(weekEnding, { dryRun = false, signal } = {}) {
    return post('createOvertimeWindow', { weekEnding, dryRun }, { signal });
}

/**
 * Submit or amend availability.
 *
 * `clientMutationId` is generated HERE rather than by the caller, so no call site can forget it —
 * it is what lets a timed-out submission be reconciled afterwards. All of a member's devices share
 * one Firebase uid, so the uid alone cannot tell this phone's lost request from another tab's.
 *
 * @returns the normalised result, plus the `mutationId` that was sent, which the caller must keep
 *   in order to recognise its own write if the response never arrives.
 * @param {string} weekEnding
 * @param {Record<string, any>} days
 * @param {number} ifRevision
 * @param {{ signal?: AbortSignal }} [opts]
 */
export async function submitOvertimeAvailability(weekEnding, days, ifRevision, { signal } = {}) {
    const clientMutationId = newMutationId();
    const r = await post('submitOvertimeAvailability',
        { weekEnding, days, ifRevision, clientMutationId }, { signal });
    return { ...r, mutationId: clientMutationId };
}

/** A random correlation id in the server's accepted alphabet (`[A-Za-z0-9_-]{8,64}`). */
function newMutationId() {
    const bytes = new Uint8Array(16);
    (globalThis.crypto || /** @type {any} */ ({})).getRandomValues?.(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
