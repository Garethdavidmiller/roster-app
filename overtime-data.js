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
import { auth, db, collection, doc, getDocs } from './firebase-client.js';
import { clockOffset, deriveHistory } from './overtime-format.js';

const BASE = 'https://europe-west2-myb-roster.cloudfunctions.net';

/** 60s server ceiling + headroom. See the header: the bound ends an infinite wait, nothing more. */
const BUDGET_MS = 65_000;

/**
 * Server-minus-client offset, refreshed by every read. 0 until the first answer arrives.
 *
 * There is deliberately no `clockSynced()` beside it. One was written, on the reasoning that an
 * unsynced page must not claim server-grade certainty — but nothing can read it: the form only
 * exists after `getMyOvertimeState` has returned, and that return is what sets the offset. An
 * exported flag that is structurally always true is worse than none, because the next reader
 * believes it distinguishes something.
 */
let _offset = 0;

/** Corrected server time. Falls back to the device clock, which is better than nothing and known. */
export function correctedNow() {
    return Date.now() + _offset;
}

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

    if (typeof data?.serverNow === 'number') _offset = clockOffset(data.serverNow, tSend, tReceive);

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

/**
 * A random correlation id in the server's accepted alphabet (`[A-Za-z0-9_-]{8,64}`).
 *
 * The `Math.random` fallback matters: without it, a browser with no `crypto.getRandomValues` left
 * the buffer all zeroes, so EVERY submission from that device carried the same id — which still
 * passes the server's format check and quietly breaks the one thing the id exists for. A device
 * reconciling a timeout would match against its own previous request and report "your earlier
 * submission did save" about the wrong one.
 */
function newMutationId() {
    const bytes = new Uint8Array(16);
    const c = /** @type {any} */ (globalThis).crypto;
    if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}


// ── The reviewer's direct Firestore read ─────────────────────────────────────────────────────────

/** The Overtime collection root. Server-owned, so it is not in firebase-client's COLLECTIONS map. */
const WINDOWS = 'overtimeWindows';

/**
 * Read everything the reviewer's workspace needs for one week — DIRECTLY from Firestore.
 *
 * The one place this feature reads Firestore from the client. Ordinary members cannot: their path
 * is `getMyOvertimeState`, which resolves participation server-side. Reviewers can, because the
 * rules give `admin`/`manager` read across the tree, and this is the surface that benefits.
 *
 * Revisions are read for every submission rather than lazily, because the late/changed markers are
 * wanted INLINE in the by-day view — a marker that only appears after a drill-down is a marker
 * nobody sees. At a full roster that is one small subcollection read per responder, in parallel.
 *
 * @param {string} weekEnding
 * @param {{ initialDeadlineAt: number }} milestones
 * @returns {Promise<{ ok: boolean, participants: any[], submissions: Map<string, any> }>}
 */
export async function loadWeekDetail(weekEnding, milestones) {
    try {
        const windowRef = doc(db, WINDOWS, weekEnding);
        const [pSnap, sSnap] = await Promise.all([
            getDocs(collection(windowRef, 'participants')),
            getDocs(collection(windowRef, 'submissions')),
        ]);

        /** @type {any[]} */
        const participants = [];
        pSnap.forEach((/** @type {any} */ d) => participants.push({ memberName: d.id, ...d.data() }));
        participants.sort((a, b) => (a.rosterOrder ?? 0) - (b.rosterOrder ?? 0)
            || String(a.memberName).localeCompare(String(b.memberName)));

        /** @type {any[]} */
        const heads = [];
        sSnap.forEach((/** @type {any} */ d) => heads.push({ memberName: d.id, ...d.data() }));

        const withHistory = await Promise.all(heads.map(async (h) => {
            /** @type {any[]} */
            const revisions = [];
            try {
                const rSnap = await getDocs(collection(doc(windowRef, 'submissions', h.memberName), 'revisions'));
                rSnap.forEach((/** @type {any} */ d) => {
                    const r = d.data();
                    revisions.push({ ...r, acceptedAt: toMillis(r.acceptedAt) });
                });
            } catch (_) {
                // A missing revision history is not a missing SUBMISSION. The head still shows what
                // they said; only the "changed since initial" marker is unavailable, so it is simply
                // omitted rather than guessed at.
            }
            return { ...h, history: deriveHistory(revisions, h.days, milestones.initialDeadlineAt) };
        }));

        return { ok: true, participants, submissions: new Map(withHistory.map(h => [h.memberName, h])) };
    } catch (_) {
        return { ok: false, participants: [], submissions: new Map() };
    }
}

/** Firestore Timestamp | number | Date → epoch ms. */
/** @param {any} v */
function toMillis(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return v;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (v instanceof Date) return v.getTime();
    return 0;
}
