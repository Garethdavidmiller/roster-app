// @ts-check
/**
 * viewer-shed.js — the shared Calendar viewer is signed out BEFORE a member signs in (v20.12), in the
 * one order that keeps it out of long-lived storage.
 *
 * Moved out of session.js whole (Nov 2026), when that file reached its size cap: it is the one part of
 * the sign-in with a single subject of its own — a security ORDERING between two calls to Firebase
 * Auth — and it shares nothing with the session record. Nothing about it changed in the move.
 * session.js imports it (its sign-in, `ensureFirebaseSession`, is the one caller) and re-exports it,
 * so session.test.mjs still drives it from there.
 *
 * The ordering is AUTH_AND_SESSIONS.md invariant 8: `setPersistence` moves the CURRENT user between
 * stores, so restoring member persistence with the viewer still signed in would carry it into IndexedDB
 * (proven both ways in a real browser by experiments/viewer-persistence-proof/).
 *
 * Owns: `shedCalendarViewer`. Does NOT own: when a viewer is kept (`reconcileExpiredIdentity`,
 * session.js), or the viewer's own persistence at unlock (`setViewerPersistence`, firebase-client.js).
 */

import { auth, signOut as firebaseSignOut, restoreMemberPersistence, letViewerWritesGo } from './firebase-client.js';
import { isViewerUser } from './calendar-access-core.js';

/**
 * Drop the shared Calendar viewer, if this browser holds one, before a MEMBER signs in (v20.12).
 *
 * Called from `ensureFirebaseSession`, which is the single choke point every member sign-in in the
 * app passes through — so there is no second path that could reach Firebase with the viewer still
 * current. A no-op for every other identity, which is why it is safe to run unconditionally there.
 *
 * Why a member sign-in cannot simply overwrite the viewer: Firebase holds one current user, so
 * signing in DOES replace it — the problem is the PERSISTENCE, not the user. The viewer runs under
 * session-only persistence and the member needs the long-lived chain, and the order in which those
 * two facts are reconciled decides whether the shared viewer ends up in IndexedDB.
 *
 * If the member sign-in then FAILS, this browser is left with no identity and the long-lived chain
 * armed. That is the correct resting state, not a leak: the Calendar re-locks (there is no viewer to
 * find), and the next unlock explicitly asks for session persistence again.
 *
 * ── IT FAILED OPEN UNTIL v20.35, WHICH DEFEATED ITS OWN ORDERING ────────────────────────────────
 *
 * The sign-out was wrapped in a `try/catch` that only warned, and the persistence restore then ran
 * regardless. So on the one path that matters — sign-out rejects, the viewer is STILL the current
 * user — the code went on to do precisely what the paragraph above says must never happen: migrate
 * the shared viewer into IndexedDB, where it survives the browser closing. An external review
 * caught it. The ordering was right and documented; the error handling quietly undid it.
 *
 * **A failed sign-out now ABORTS the transition and throws.** The caller
 * (`ensureFirebaseSession`) is the single choke point every member sign-in passes through, so a
 * throw there fails the sign-in — the member sees a sign-in failure and can retry, which is a far
 * better outcome than a shared viewer silently promoted to a long-lived session on an office PC.
 * Refusing to cross a security boundary beats degrading it quietly.
 * @returns {Promise<void>}
 * @throws {Error} if the viewer could not be signed out — persistence is then left untouched
 */
export async function shedCalendarViewer() {
    const u = auth.currentUser;
    // NOBODY current still needs the member chain re-armed (Sep 2026 review): the viewer may already
    // have been signed out (reconcile does it when its session lapses) while the SESSION-only
    // persistence its unlock set is still in force — and the member about to sign in would inherit
    // it, and be signed out when the browser closed. With no current user there is nothing for
    // `setPersistence` to migrate, so this is safe; a member already current is left alone.
    if (!u) {
        try { await restoreMemberPersistence(); }
        catch (err) { console.warn('[Auth] member persistence restore failed:', /** @type {any} */ (err)?.message); }
        return;
    }
    if (!isViewerUser(u)) return;
    // Sign out BEFORE restoring the member persistence chain. `setPersistence` migrates the CURRENT
    // user into the new persistence, so doing these two the other way round would move the shared
    // viewer into IndexedDB — where it outlives the browser session, which is the one property that
    // makes unlocking a shared office PC safe in the first place. This is the ONLY ordering that is
    // correct here and it is not obvious from either call on its own.
    // The viewer's queued writes get a moment to leave first (`letViewerWritesGo`, which says why).
    await letViewerWritesGo();
    if (auth.currentUser !== u) return shedCalendarViewer();   // the identity moved during the wait: decide afresh
    try {
        await firebaseSignOut(auth);
    } catch (err) {
        console.warn('[Auth] viewer signOut failed — aborting member transition, persistence left as-is:',
            /** @type {any} */ (err)?.message);
        throw err instanceof Error ? err : new Error('viewer sign-out failed');
    }
    // Belt-and-braces: `signOut` resolving is the contract, but the invariant this function exists
    // to hold is that the viewer is GONE before persistence changes — so assert the state rather
    // than trust the call. Cheap, synchronous, and the only check that survives an SDK that resolves
    // without clearing.
    if (isViewerUser(auth.currentUser)) {
        throw new Error('viewer still current after sign-out — persistence not changed');
    }
    // The restore may still fail open: at this point the viewer is definitely gone, so the worst
    // case is a member session on a shorter-lived persistence — an inconvenience, not a leak.
    try { await restoreMemberPersistence(); }
    catch (err) { console.warn('[Auth] member persistence restore failed:', /** @type {any} */ (err)?.message); }
}
