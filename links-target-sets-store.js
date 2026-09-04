// @ts-check
/**
 * links-target-sets-store.js — the Firestore half of the saved staffing sets.
 *
 * Owns: reading the shared set collection, and the one write primitive that refuses to land on a
 *   version nobody agreed to.
 * Does NOT own: what a set IS or who may change it (`links-target-sets.js`, pure), what the picker
 *   SAYS (`describeSetList`, same file), or any of the dialogs (links-app.js).
 * Edit here for: how a set reaches or leaves Firestore.
 *
 * ── WHY IT EXISTS ──────────────────────────────────────────────────────────────────────────────
 *
 * Two reasons, and the second is the one that matters.
 *
 * The coordinator hit its ratchet cap (v22.57). That is the trigger, not the argument: `links-app.js`
 * had no room for the four-state picker the review asked for, and the rule the cap enforces is that
 * the next Links rule goes in a domain module rather than back into the big file.
 *
 * The argument is that this code had NO TESTS AT ALL and could not have any. It is a transaction
 * with a conflict window in it, living inside a 3,000-line coordinator that imports the gstatic
 * Firebase SDK, so nothing about it could load in Node — the same wall that kept `pruneOldDocs` and
 * the design store untestable until each was pulled out. Every Firebase handle is INJECTED for
 * exactly that reason: `links-target-sets-store.test.mjs` drives the real decision against a fake
 * Firestore whose `onRead` seam runs a competing writer at the instant between the transaction's
 * read and its commit — the window no ordering of real calls can force.
 *
 * ── THE TWO RULES ──────────────────────────────────────────────────────────────────────────────
 *
 * 1. **A read that fails is not an empty collection.** `list()` reports `status`, never an empty
 *    array standing in for "we could not tell". These sets are SHARED, so the old collapse told a
 *    designer whose connection dropped that their colleagues' sets did not exist — which reads as
 *    somebody having deleted them. What the picker may then SAY is `describeSetList`'s decision.
 *
 * 2. **Consent names a VERSION.** `writeIfUnchanged` lands only on the revision the picker was
 *    showing. A confirm dialog is human think-time and a set has two writers — its creator and the
 *    admin — so "the version I clicked" and "the version that exists when I confirm" are different
 *    questions. Answering only the second silently discards the other person's work, and for a
 *    delete there is no bin to recover it from. Gone-already is not a conflict for a DELETE (the
 *    outcome asked for is the outcome) but is for an overwrite, because recreating the document
 *    would resurrect a set somebody deleted.
 */

import { targetSetFromDoc, sortTargetSets } from './links-target-sets.js';

/**
 * @param {object} deps every Firebase handle, injected so this module loads in Node
 * @param {any} deps.db
 * @param {any} deps.doc
 * @param {any} deps.getDocs
 * @param {any} deps.runTransaction
 * @param {any} deps.writeWithClaimRetry
 * @param {any} deps.setsCol       the collection reference to read
 * @param {string} deps.collectionPath  the path `doc()` needs to address one set
 */
export function createTargetSetStore({ db, doc, getDocs, runTransaction, writeWithClaimRetry, setsCol, collectionPath }) {
    return {
        /**
         * Every set, or the fact that we could not find out.
         * @returns {Promise<{ status: 'ready'|'error', sets: Array<any> }>}
         */
        async list() {
            try {
                const snap = await getDocs(setsCol);
                /** @type {any[]} */
                const rows = [];
                snap.forEach((/** @type {any} */ d) => {
                    const set = targetSetFromDoc(d.id, d.data());
                    if (set) rows.push(set);   // a corrupt document is skipped whole, never half-loaded
                });
                return { status: 'ready', sets: sortTargetSets(rows) };
            } catch {
                return { status: 'error', sets: [] };
            }
        },

        /**
         * Write (or delete) a set ONLY if it is still the revision the caller was shown.
         *
         * @param {{id: string, name?: string, updatedAt: any}} set the row the picker showed
         * @param {any|null} payload what to write, or null to DELETE
         * @returns {Promise<boolean>} false when somebody else moved it first — nothing was written
         */
        async writeIfUnchanged(set, payload) {
            const seen = set.updatedAt?.toMillis?.() ?? null;
            let moved = false;
            await writeWithClaimRetry(() => runTransaction(db, async (/** @type {any} */ tx) => {
                moved = false;                       // a retried transaction re-decides from scratch
                const ref = doc(db, collectionPath, set.id);
                const snap = await tx.get(ref);
                if (!snap.exists()) { moved = !!payload; return; }
                if ((snap.data()?.updatedAt?.toMillis?.() ?? null) !== seen) { moved = true; return; }
                if (payload) tx.set(ref, payload); else tx.delete(ref);
            }));
            return !moved;
        },
    };
}
