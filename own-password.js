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
 * ── TWO PROPERTIES AN EDIT CAN SILENTLY BREAK ──────────────────────────────────────────────────
 *
 *   1. RE-AUTHENTICATION TRIES THE NEXT CANDIDATE ONLY ON A DEFINITIVE REJECTION. The candidate list is
 *      the sign-in's own (`credentialCandidatesFor`: the typed value, then the surname default when the
 *      typed value normalises to it), so an un-migrated member typing their surname in any case
 *      re-authenticates. A transient failure — network, rate limit, provider outage,
 *      requires-recent-login — stops at once: retrying the surname behind it duplicates traffic, worsens
 *      rate-limiting and ends on a misleading error (PASSWORD_DESIGN.md §3.2). The one shared classifier
 *      (`isCredentialRejection`) keeps this ladder and the sign-in's in step.
 *   2. A CHANGED PASSWORD IS NEVER REPORTED AS UNCHANGED. `changeOwnPassword` resolves once the password
 *      HAS changed — the half a deadline belongs on (settings-ops-2): timed together, a slow commit read
 *      as "we couldn't confirm". The `passwordSetAt` stamp is a SEPARATE Firestore write that can fail on
 *      its own (transient, a `permission-denied` surviving the claim retry, an offline queue rejection);
 *      had that failed the change, the member would be told to retry with a password that NO LONGER
 *      EXISTS, and a Firestore error would read as "current password incorrect". So `stamp` settles false
 *      and never rejects: only the migration record (a monitoring signal, not a security control) is
 *      missing until the next successful set. It is counted until it lands (`trackBackgroundWrite`), so
 *      no page's update reload can drop it.
 */

import { credentialCandidatesFor, isCredentialRejection } from './auth-identity.js';

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
     * Re-authenticate the currently signed-in member with their typed CURRENT password — required by
     * Firebase before `updatePassword` (property 1 in the header).
     * @param {string} memberName
     * @param {string} typed
     * @returns {Promise<void>} resolves on success; rejects with the last Firebase error otherwise
     */
    async function reauthenticateWithPassword(memberName, typed) {
        const user = auth.currentUser;
        if (!user || !user.email) throw new Error('Not signed in');
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
        const user = auth.currentUser;
        if (!user) throw new Error('Not signed in');
        await updatePassword(user, newPassword);   // (A) the password is now genuinely changed
        // (B) record migration — best-effort, must not undo (A), and never awaited here.
        const stamp = trackBackgroundWrite(savePasswordSetAt(memberName)).then(() => true,
            (e) => { console.warn('[Auth] password changed, but passwordSetAt stamp failed:', e); return false; });
        return { stamp };
    }

    return { reauthenticateWithPassword, changeOwnPassword };
}
