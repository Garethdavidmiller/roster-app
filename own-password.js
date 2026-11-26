// @ts-check
/**
 * own-password.js — re-authenticating with, and changing, the signed-in member's OWN password: the two
 * calls Settings → Password and the forced change (password-force.js) both make.
 *
 * A factory with every Firebase handle injected — the shape documents-client.js and analytics-client.js
 * took for the same reason — so it loads in Node. firebase-client.js builds it once and re-exports both
 * functions under their old names, so no caller changed; firebase-client.test.mjs drives them through
 * the real module against a fake SDK. They left firebase-client.js when it reached its size cap
 * (coordinator-ratchet.test.mjs), and they are one subject: the member's own credential, changed from
 * the page they are signed in to.
 *
 * It also holds the SAVE SEQUENCE both pages run around those two calls — `runPasswordSave`, its
 * deadline helpers `withTimeout` and `settleOrTimeout`, and the one `SAVE_TIMEOUT_MS` (below the factory).
 *
 * ── THREE PROPERTIES AN EDIT CAN SILENTLY BREAK ────────────────────────────────────────────────
 *
 *   1. RE-AUTHENTICATION TRIES THE NEXT CANDIDATE ONLY ON A DEFINITIVE REJECTION. The candidate list is
 *      the sign-in's own (`credentialCandidatesFor`: the typed value, or — when it normalises to the
 *      surname — the surname default first, then the typed value), so an un-migrated member typing
 *      their surname in any case re-authenticates at the first attempt. A transient failure — network,
 *      rate limit, provider outage, requires-recent-login — stops at once: retrying behind it duplicates
 *      traffic, worsens rate-limiting and ends on a misleading error (AUTH_AND_SESSIONS.md → "The gated dual-attempt"). The one
 *      shared classifier (`isCredentialRejection`) keeps this ladder and the sign-in's in step.
 *   2. A CHANGED PASSWORD IS NEVER REPORTED AS UNCHANGED. `changeOwnPassword` resolves once the password
 *      HAS changed — the half a deadline belongs on (settings-ops-2): timed together, a slow commit read
 *      as "we couldn't confirm". The `passwordSetAt` stamp is a SEPARATE Firestore write that can fail on
 *      its own (transient, a `permission-denied` surviving the claim retry, an offline queue rejection);
 *      had that failed the change, the member would be told to retry with a password that NO LONGER
 *      EXISTS, and a Firestore error would read as "current password incorrect". So `stamp` settles false
 *      and never rejects: only the migration record (a monitoring signal, not a security control) is
 *      missing until the next successful set. It is counted until it lands (`trackBackgroundWrite`), so
 *      no page's update reload can drop it.
 *   3. IT IS THE PAGE MEMBER'S OWN ACCOUNT, OR NOTHING IS SENT (sign-in audit A3/B4, Nov 2026). Both act on
 *      `auth.currentUser`, which another tab on a shared browser can change, while the page's member comes
 *      from its local session. Only the cross-tab reload stood between the two — and the forced change
 *      calls `updatePassword` with no re-authentication, so a colleague signed in from another tab could
 *      have their password set to what this member typed, stamped as this member's. So both refuse, coded
 *      `NOT_THIS_MEMBER`, unless the account's email is `nameToEmail(memberName)` (an account with no
 *      email — the PIN viewer — is nobody's). Settings and the forced change word the refusal through
 *      their shared ladder (`passwordChangeFailure`); it is never a credential rejection, so it can never
 *      read "Current password incorrect" and send somebody to an admin reset.
 */

import { credentialCandidatesFor, isCredentialRejection, nameToEmail } from './auth-identity.js';

/** The code both calls refuse with when the signed-in account is not the page's member (property 3). */
const NOT_THIS_MEMBER = 'myb/account-mismatch';

/**
 * @param {object} deps
 * @param {{ currentUser: any }} deps.auth  read at CALL time — never a user captured at build
 * @param {(user: any, credential: any) => Promise<any>} deps.reauthenticateWithCredential
 * @param {{ credential: (email: string, password: string) => any }} deps.EmailAuthProvider
 * @param {(user: any, password: string) => Promise<void>} deps.updatePassword
 * @param {(memberName: string) => Promise<void>} deps.savePasswordSetAt  the migration stamp
 * @param {<T>(p: Promise<T>) => Promise<T>} deps.trackBackgroundWrite  counts a write no page started (claim-retry.js)
 */
export function buildPasswordClient({ auth, reauthenticateWithCredential, EmailAuthProvider, updatePassword, savePasswordSetAt, trackBackgroundWrite }) {
    /**
     * The signed-in account, read now — only if it is `memberName`'s own (property 3 in the header).
     * @param {string} memberName @returns {any}
     */
    function ownAccount(memberName) {
        const user = auth.currentUser;
        if (!user) throw new Error('Not signed in');
        if (typeof memberName !== 'string' || user.email !== nameToEmail(memberName)) {
            throw Object.assign(new Error('the signed-in account is not this member\'s'), { code: NOT_THIS_MEMBER });
        }
        return user;
    }

    /**
     * Re-authenticate the currently signed-in member with their typed CURRENT password — required by
     * Firebase before `updatePassword` (property 1 in the header).
     * @param {string} memberName
     * @param {string} typed
     * @returns {Promise<void>} resolves on success; rejects `NOT_THIS_MEMBER` for another account, else
     *   with the last Firebase error
     */
    async function reauthenticateWithPassword(memberName, typed) {
        const user = ownAccount(memberName);
        const candidates = credentialCandidatesFor(memberName, typed);
        if (!candidates.length) throw Object.assign(new Error('empty password'), { code: 'auth/missing-password' });
        let lastErr;
        for (const pw of candidates) {
            try {
                await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, pw));
                return;
            } catch (e) {
                lastErr = e;
                if (!isCredentialRejection(/** @type {any} */ (e)?.code)) break;
            }
        }
        throw lastErr;
    }

    /**
     * Set the signed-in member's OWN password (after a fresh reauth) — the server never sees it — and
     * START the `passwordSetAt` stamp without waiting (property 2 in the header).
     * @param {string} memberName @param {string} newPassword
     * @returns {Promise<{ stamp: Promise<boolean> }>} rejects only if the password itself was not changed
     */
    async function changeOwnPassword(memberName, newPassword) {
        const user = ownAccount(memberName);
        await updatePassword(user, newPassword);   // (A) the password is now genuinely changed
        // (B) record migration — best-effort, must not undo (A), and never awaited here.
        const stamp = trackBackgroundWrite(savePasswordSetAt(memberName)).then(() => true,
            (e) => { console.warn('[Auth] password changed, but passwordSetAt stamp failed:', e); return false; });
        return { stamp };
    }

    return { reauthenticateWithPassword, changeOwnPassword };
}

// ── THE SAVE SEQUENCE BOTH SURFACES RUN (settings review, Nov 2026) ─────────────────────────────────
// Settings → Password and the forced change (password-force.js) each wrote the same steps out —
// re-authenticate inside a deadline, change the password inside a SEPARATE deadline that may answer
// "we don't know", and say which stage a failure came from — with `SAVE_TIMEOUT_MS` declared twice.
// The sequence is here, Node-tested (password-force.test.mjs); each caller keeps only what the result
// means on its own screen. The deadline helpers moved with it; password-force.js re-exports them for
// the sign-in card, which imports `withTimeout` from there.

/** Ceiling on each password network call — the same 8s budget as sign-in (runNamedSignIn). */
export const SAVE_TIMEOUT_MS = 8000;

/**
 * Reject `promise` if it hasn't settled in `ms`. Load-bearing, not defensive padding: a promise that
 * never settles reaches neither `catch` nor `finally`, so without this a dead-air mobile connection left
 * the MANDATORY overlay on "Saving…" with its escape hidden — a member who could neither satisfy it nor
 * dismiss it (v18.94) — and Settings' button disabled on "Saving…" until a reload (v18.95).
 *
 * **Use this only for operations that change NOTHING** — a read, or an idempotent re-auth. For a
 * STATE-CHANGING call, use `settleOrTimeout` below: this one reports a timeout as a rejection, and a
 * rejection means "it did not happen", which for a password write is a claim we cannot make.
 * @template T @param {Promise<T>} promise @param {number} ms @returns {Promise<T>}
 */
export function withTimeout(promise, ms) {
    /** @type {any} */ let timer;
    return /** @type {Promise<T>} */ (Promise.race([
        promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('timed out'), { code: 'myb/timeout' })), ms); }),
    ]).finally(() => clearTimeout(timer)));
}

/**
 * Race a promise against a deadline WITHOUT claiming that a slow operation failed.
 *
 * `Promise.race` stops *waiting*, it does not *cancel* — Firebase's `updatePassword` keeps going and can
 * succeed a second after the member was told it failed. They then believe their old password still
 * works, retry against a credential that has already changed, or walk away from a compulsory overlay
 * mis-informed: a route into a genuine lockout, caused by the guard added to prevent one (v18.96).
 *
 * So this reports THREE outcomes, and hands back a handle on the original work:
 *   { status: 'ok', value }        — settled in time
 *   { status: 'failed', error }    — genuinely rejected in time
 *   { status: 'pending', settled } — deadline passed, STILL RUNNING; `settled` resolves to an 'ok' or a
 *                                    'failed' record, and never rejects
 *
 * The tracked promise absorbs its own rejection at once, so a late failure can never surface as an
 * unhandled rejection even if the caller stops caring.
 * @template T @param {Promise<T>} promise @param {number} ms
 * @returns {Promise<{status:'ok',value:T}|{status:'failed',error:any}|{status:'pending',settled:Promise<{status:'ok',value:T}|{status:'failed',error:any}>}>}
 */
export function settleOrTimeout(promise, ms) {
    /** @type {any} */ let timer;
    const settled = promise.then(
        value => /** @type {any} */ ({ status: 'ok', value }),
        error => /** @type {any} */ ({ status: 'failed', error }),
    );
    const deadline = new Promise(resolve => {
        timer = setTimeout(() => resolve(/** @type {any} */ ({ status: 'pending', settled })), ms);
    });
    return /** @type {any} */ (Promise.race([settled, deadline]).finally(() => clearTimeout(timer)));
}

/**
 * Re-authenticate (when asked to) and change the member's own password — the sequence both surfaces
 * run, returning what happened rather than throwing it.
 *
 *   · Re-authentication is time-boxed as a plain failure: it changes nothing, so "it did not happen"
 *     is a true statement about it, and retrying is free.
 *   · The change is timed ALONE and may come back `pending` (settings-ops-2: timed with the migration
 *     stamp, a slow stamp turned a changed password into "we couldn't confirm").
 *   · The change is COUNTED for as long as it runs (`track` — claim-retry.js → trackBackgroundWrite),
 *     past the deadline too, so every page's update reload and sign-out question can see it (audit E5).
 *   · A failure carries `reauthed`, the STAGE it came from: a write refused after the current password
 *     was accepted must never read "Current password incorrect" (`passwordChangeFailure`).
 *
 * @param {object} a
 * @param {string} a.member
 * @param {string|null} a.current the typed current password, or null to skip re-authentication (the
 *   forced change straight after a sign-in, until Firebase asks for a recent one)
 * @param {string} a.next the new password, already validated
 * @param {(member: string, typed: string) => Promise<void>} a.reauthenticate
 * @param {(member: string, next: string) => Promise<any>} a.change
 * @param {<T>(p: Promise<T>) => Promise<T>} a.track
 * @param {number} [a.ms]
 * @returns {Promise<{status:'ok', value:any}|{status:'failed', error:any, reauthed:boolean}|{status:'pending', settled:Promise<{status:'ok', value?:any, error?:any}|{status:'failed', value?:any, error:any}>}>}
 */
export async function runPasswordSave({ member, current, next, reauthenticate, change, track, ms = SAVE_TIMEOUT_MS }) {
    let reauthed = false;
    try {
        if (current !== null) await withTimeout(reauthenticate(member, current), ms);
        reauthed = true;
        const res = await settleOrTimeout(track(change(member, next)), ms);
        return res.status === 'failed' ? { ...res, reauthed } : res;
    } catch (error) {
        return { status: 'failed', error, reauthed };
    }
}
