// @ts-check
/**
 * account-calls.js — the browser's side of three ACCOUNT endpoints: the admin's Reset
 * (`resetMemberPassword`), the admin's provisioning audit (`getAccountSetupGaps`, which also says
 * whether the staff PIN is blocked for everyone) and the locked-out member's reset request
 * (`requestPasswordReset`).
 *
 * A factory with the one Firebase handle it needs injected (`auth`) — the shape own-password.js took,
 * for the same reason: it left firebase-client.js when that reached its size cap
 * (coordinator-ratchet.test.mjs), and firebase-client.js builds it once and re-exports the three under
 * their old names, so no caller changed and firebase-client.test.mjs still drives them through the real
 * module. Imports nothing from firebase-client.js, so the two make no cycle (import-graph.test.mjs).
 *
 * The one rule all three keep: a deadline ABOVE the endpoint's own ceiling (fetch-timeout.js), and a
 * WRITE that times out says it may still have happened — the server can finish after we stop waiting.
 */

import { fetchWithTimeout, isFetchTimeout } from './fetch-timeout.js';

/** The code `resetMemberPassword` gives a failure BEFORE anything was sent: the admin's sign-in could not be renewed
 *  (offline, most often), so the request never left this device and nothing was reset — the one failure that knows
 *  that for certain, which Operations says beside Retry (operations-reset.js `resetFailure`). */
export const RESET_NOT_SENT = 'reset/not-sent';

/**
 * @param {{ auth: { currentUser: any } }} deps
 */
export function buildAccountCalls({ auth }) {
    /** Admin-only Cloud Function that resets a member's Firebase password back to their surname default
     *  and stamps `passwordStatus.resetAt` (server-side). Mirrors admin-auth.js's setupRosterAuth caller:
     *  a FRESH admin ID token as a Bearer header on every call. */
    const RESET_PASSWORD_URL = 'https://europe-west2-myb-roster.cloudfunctions.net/resetMemberPassword';

    /**
     * Reset a member's password to the surname default (admin break-glass). Requires the caller's admin
     * claim (enforced server-side). A reset always signs the member out on every device.
     * @param {string} memberName @param {{ lostDevice?: boolean }} [opts] a lost phone: no notice, every push record released — sent only for `true` itself
     * @returns {Promise<any>} the function's JSON response
     */
    async function resetMemberPassword(memberName, { lostDevice = false } = {}) {
        const user = auth.currentUser;
        if (!user) throw new Error('Not signed in');
        // NOTHING HAS BEEN SENT YET (18 Nov 2026). A renewal that fails here meant the request never left this device,
        // and it reached the page as an unmarked error: a bare "Retry" with no reason. Marked, it says nothing changed.
        let token;
        try {
            ({ token } = await user.getIdTokenResult(/* forceRefresh */ true));
        } catch (err) {
            throw Object.assign(new Error('Couldn’t renew the admin sign-in, so the reset was not sent', { cause: err }), { code: RESET_NOT_SENT });
        }
        // 65s: above the endpoint's own 60s ceiling (see fetch-timeout.js — a client that gives up
        // first reports a working server as broken).
        let r;
        try {
            r = await fetchWithTimeout(RESET_PASSWORD_URL, {
                method:  'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body:    JSON.stringify(lostDevice === true ? { member: memberName, lostDevice: true } : { member: memberName }),
            }, 65_000);
            // Read INSIDE the try: the body shares the deadline, and a body cut off by it is a timeout too.
            if (!r.ok) { const e = await r.text(); throw new Error(`Server responded ${r.status}: ${e}`); }
            return await r.json();
        } catch (err) {
            // A WRITE. The abort stopped us waiting, not the server working, so this must not claim the
            // reset did not happen — the admin needs to go and look rather than reset a second time.
            if (isFetchTimeout(err)) throw new Error('Timed out waiting for the server — the reset may still have gone through. Check Account status before trying again.', { cause: err });
            throw err;
        }
    }

    /** Admin-only Cloud Function returning who is not properly provisioned (v22.53). */
    const ACCOUNT_GAPS_URL = 'https://europe-west2-myb-roster.cloudfunctions.net/getAccountSetupGaps';

    /**
     * Which roster members are not properly set up, and which leavers still can sign in (admin only —
     * enforced server-side). A pure read: nothing is created, disabled or re-claimed by asking.
     *
     * Unlike `getSignInStats` this one returns NAMES, deliberately — a count of provisioning gaps the
     * admin cannot act on is worse than no count at all. Both groups are named after the button that
     * fixes them rather than after what went wrong: everything in `setUp` is fixed by Set up accounts,
     * `leavers` needs the separate confirmed disable sweep.
     *
     * `refused` present means the server could not see the roster's accounts at all and declined to
     * answer — **which is not the same as "no gaps"** and must never be rendered as one.
     *
     * `pinLockout` (Nov 2026) says whether the staff PIN is blocked for everyone: an object while a
     * block runs or one began in the last day, `null` for none, and ABSENT when the server could not
     * read it or does not send it yet — unknown, never "none" (operations-pin-lockout.js).
     *
     * @returns {Promise<{ refused?: string, setUp: {name: string, why: 'no-account'|'viewer-linked'|'other-member'|'disabled'|'claims'|'unstamped'}[], leavers: string[],
     *   pinLockout?: { active: boolean, blockedUntil: number, lastBlockedAt: number, blocks: number }|null }>}
     */
    async function getAccountSetupGaps() {
        const user = auth.currentUser;
        if (!user) throw new Error('Not signed in');
        const { token } = await user.getIdTokenResult(/* forceRefresh */ true);
        // A READ, so a timeout may say plainly that it failed. 65s clears the 60s server ceiling.
        const r = await fetchWithTimeout(ACCOUNT_GAPS_URL, {
            method:  'GET',
            headers: { 'Authorization': `Bearer ${token}` },
        }, 65_000);
        if (!r.ok) { const e = await r.text(); throw new Error(`Server responded ${r.status}: ${e}`); }
        return r.json();
    }

    /** The public `requestPasswordReset` endpoint (PASSWORD_DESIGN.md — the request queue). */
    const REQUEST_RESET_URL = 'https://europe-west2-myb-roster.cloudfunctions.net/requestPasswordReset';

    /**
     * Ask the admin to reset a member's password. Called from the LOGIN OVERLAY, by someone who is
     * therefore NOT signed in — so unlike every other function caller here it sends **no auth token**.
     * That is the whole reason this route exists as a server endpoint: a locked-out member has no Firebase
     * identity, so they cannot write to Firestore at all (the `resetRequests` rules deny every client
     * write). The endpoint validates the name against the server-owned roster and records a request; it
     * never resets anything.
     * @param {string} memberName  the name the member picked in the login dropdown (never free-typed)
     * @returns {Promise<any>}
     */
    async function requestPasswordReset(memberName) {
        // 35s: above the endpoint's own 30s ceiling. This is the call the review named — a stalled
        // transport left the login card's button on "Sending…" indefinitely, with no way back.
        let r;
        try {
            r = await fetchWithTimeout(REQUEST_RESET_URL, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ member: memberName }),
            }, 35_000);
            // Read INSIDE the try: the body shares the deadline, and a body cut off by it is a timeout too.
            if (!r.ok) { const e = await r.text(); throw new Error(`Server responded ${r.status}: ${e}`); }
            return await r.json();
        } catch (err) {
            // The request MAY have been recorded — the server writes the row before responding. So the
            // login overlay's copy for this case says "couldn't confirm", never "not sent"; a member
            // told it failed would ask again, and the throttle would then silently drop the repeat.
            if (isFetchTimeout(err)) throw new Error('Timed out waiting for the server — your request may still have been sent.', { cause: err });
            throw err;
        }
    }

    return { resetMemberPassword, getAccountSetupGaps, requestPasswordReset };
}
