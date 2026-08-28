// @ts-check
/**
 * doc-retention.js — the six-month sweep behind Circular and Newsletter uploads.
 *
 * ── WHY IT IS ITS OWN MODULE (v21.86) ───────────────────────────────────────────────────────────
 *
 * This is the only DESTRUCTIVE operation the browser performs on shared data, and it ran for
 * nineteen versions with no test at all — because it lived inside `firebase-client.js`, which
 * imports the Firebase SDK from gstatic and therefore cannot be loaded in Node. An external audit
 * found two defects in it (Aug 2026) by reading, which is the only way anyone could have.
 *
 * Every Firebase handle is INJECTED rather than imported, so the whole sweep can be driven against
 * fakes: `doc-retention.test.mjs` replays the interleaving that produced the stale-delete race, and
 * a clock months fast, neither of which is reachable from a browser test.
 *
 * ── THE TWO RULES THAT MATTER ───────────────────────────────────────────────────────────────────
 *
 * **The clock must be the server's.** A six-month cutoff computed from `new Date()` is a deletion
 * driven by whichever admin device happened to upload; one running months fast takes months of
 * current documents with it, silently. This repo already knows that hazard — it is why the Links
 * bin's automatic purge was disarmed at v19.86 — and this path had it too. No server time, no
 * sweep: retention is housekeeping and runs again on the next upload.
 *
 * **Delete only what you read.** The query is a snapshot. A re-upload for one of those dates
 * between the query and the delete used to destroy the FRESH metadata while the cleanup removed the
 * stale object: the document disappears and a newer file is orphaned. Each delete now re-reads
 * inside a transaction and stands down if the storage path has moved.
 *
 * The right long-term home is a scheduled Cloud Function, where the time is trusted by construction
 * and no client is involved — the shape `purgeExpiredOvertimeWindows` already has. This makes the
 * existing path safe rather than pretending it is finished.
 */

import { sixMonthCutoffISO, legacyDocPath } from './storage-utils.js';

/**
 * Delete Firestore documents (and matching Storage files) for a collection
 * whose `date` field is older than 6 months. Called fire-and-forget after
 * each successful upload to cap collection growth automatically.
 *
 * Each document is deleted independently — a failure on one does not abort the rest.
 * Firestore is deleted first; Storage follows only on success. This ordering means a
 * partial failure leaves an orphaned Storage file (invisible to users) rather than a
 * Firestore doc with a broken storageUrl (user-facing 404).
 *
 * @param {string}   collectionName - 'circulars' or 'newsletters'
 * @param {string}   excludeDate    - Date string of the just-uploaded doc to skip — prevents
 *                                    immediately pruning a historical correction (date > 6 months old)
 * @param {object}   storage        - Firebase Storage instance
 * @param {Function} refFn          - Firebase Storage `ref` function
 * @param {Function} deleteObject   - Firebase Storage `deleteObject` function
 * @param {{ db: any, doc: Function, getDoc: Function, collection: Function, query: Function,
 *          where: Function, getDocs: Function, runTransaction: Function }} fs
 *                                  - the Firestore handles, injected so this is testable in Node
 * @returns {Promise<void>}
 */
export async function pruneOldDocs(collectionName, excludeDate, storage, refFn, deleteObject, fs) {
    // TRUSTED TIME (v21.86, external audit). The cutoff came from `new Date()` — a destructive
    // delete driven by whichever admin device uploaded, so a clock running months fast silently
    // took months of current documents. This is the hazard that had the Links purge disarmed at
    // v19.86, in a path nobody had disarmed. The doc we just wrote carries a server `uploadedAt`;
    // reading it back costs one read and needs no new infrastructure. Unreadable or missing →
    // SKIP: retention is housekeeping and runs again on the next upload. The right long-term home
    // is a scheduled Function (KNOWN_LIMITATIONS → document retention).
    let serverNow;
    try {
        const anchor = await fs.getDoc(fs.doc(fs.db, collectionName, excludeDate));
        serverNow = anchor.exists() ? /** @type {any} */ (anchor.data())?.uploadedAt?.toDate?.() : null;
    } catch (e) {
        console.warn(`[pruneOldDocs] ${collectionName} could not read a server time — skipping:`, /** @type {any} */ (e)?.code);
        return;
    }
    if (!serverNow) {
        console.warn(`[pruneOldDocs] ${collectionName} no server timestamp to anchor the cutoff — skipping`);
        return;
    }
    // The month-underflow-safe 6-month cutoff lives in storage-utils.js so it can be unit-tested.
    const cutoffStr = sixMonthCutoffISO(serverNow);
    const q = fs.query(fs.collection(fs.db, collectionName), fs.where('date', '<', cutoffStr));
    const snap = await fs.getDocs(q);
    await Promise.all(snap.docs
        .filter(/** @param {any} d */ d => d.id !== excludeDate)
        .map(/** @param {any} d */ async d => {
            // storagePath added at v13.99; legacyDocPath is the fallback for older documents
            // uploaded before the versioned upload scheme — it honours the doc's own fileType
            // (default 'pdf'), the same one rule the upload engine's own cleanup reads (documents-client.js), so the two
            // deciders of "which old object do we delete" can no longer drift (v20.55).
            const _docData    = d.data() || {};
            const storagePath = _docData.storagePath ?? legacyDocPath(collectionName, d.id, _docData.fileType);
            try {
                // DELETE ONLY WHAT WE READ. The query is a snapshot; a re-upload for that date
                // between it and here meant deleting the FRESH metadata and cleaning up the stale
                // object — document vanished, newer file orphaned. Re-read, and stand down if the
                // path has moved.
                const removed = await fs.runTransaction(fs.db, async (/** @type {any} */ tx) => {
                    const ref  = fs.doc(fs.db, collectionName, d.id);
                    const cur  = await tx.get(ref);
                    if (!cur.exists()) return false;                       // already gone
                    const now  = /** @type {any} */ (cur.data()) || {};
                    const curPath = now.storagePath ?? legacyDocPath(collectionName, d.id, now.fileType);
                    if (curPath !== storagePath) return false;             // replaced under us — leave it
                    tx.delete(ref);
                    return true;
                });
                if (!removed) {
                    console.log(`[pruneOldDocs] ${collectionName} ${d.id} changed since the query — left alone`);
                    return;
                }
                await deleteObject(refFn(storage, storagePath))
                    .catch(/** @param {any} e */ e => console.warn(`[pruneOldDocs] ${collectionName} Storage delete ${d.id}:`, e));
            } catch (/** @param {any} e */ e) {
                console.error(`[pruneOldDocs] ${collectionName} Firestore delete ${d.id}:`, e);
            }
        }));
}
