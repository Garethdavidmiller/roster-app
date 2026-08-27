// @ts-check
/**
 * documents-client.js — the browser's side of the three date-keyed document collections
 * (Daily Huddle · Weekly Retail Circular · Marylebone Newsletter).
 *
 * ── THE ONE INVARIANT ───────────────────────────────────────────────────────────────────────────
 *
 * **A live document must never point at a file that is not there.** An upload writes to TWO
 * systems — the bytes go to Storage, the metadata to Firestore — and there is no transaction
 * across them. Every rule in this module exists to keep those two in step across a failure:
 *
 * · the file is signature-checked BEFORE anything is written, so a renamed non-PDF never reaches
 *   Storage behind a trusted in-app link;
 * · the new object goes to a VERSIONED path, so the old file stays readable until Firestore
 *   commits — a re-upload (including a PDF↔DOCX swap, which changes the extension) cannot orphan
 *   the document mid-commit;
 * · a failed `setDoc` rolls the new object back ONLY when the failure is definite. A still-retriable
 *   final error is commit-AMBIGUOUS, and deleting there would leave a committed document pointing
 *   at nothing — one orphaned file is recoverable, a 404 behind the staff Huddle button is not;
 * · a retriable failure RESOLVES BY READING rather than re-issuing blind (`resolveUploadCommit`),
 *   because a `deadline-exceeded` can be raised after the server committed, and a blind retry can
 *   overwrite a competing upload's file reference with a path that upload has already deleted.
 *
 * Those four are one argument, and they were previously spread through the middle of
 * `firebase-client.js` between the auth bootstrap, the push-subscription writers, the password
 * timestamps, the analytics counters and the error log — five domains that have nothing to do with
 * each other and no reason to be read together.
 *
 * ── WHY IT IS A FACTORY, AND NOT A MODULE THAT IMPORTS `db` ─────────────────────────────────────
 *
 * Two reasons, and the second is the one that earns it:
 *
 * 1. `firebase-client.js` re-exports these functions, so a module importing `db` back from it would
 *    be a cycle — `import-graph.test.mjs` refuses that, and rightly.
 * 2. With every Firebase handle INJECTED, this file imports nothing from the gstatic CDN and so
 *    **loads in Node**. That is what `doc-retention.js` gained at v21.86 and what this module was
 *    missing: the ordering rules above are the highest-risk code in the upload path and the least
 *    reachable — you cannot force a Firestore failure between two real calls, but you can hand a
 *    fake `setDoc` that throws `deadline-exceeded` and assert what happened to the file.
 *
 * The pure DECISION behind the ambiguous commit already lives, tested, in `upload-commit.js`; the
 * six-month sweep in `doc-retention.js`. This module ORCHESTRATES them — it owns the sequence, not
 * the rules.
 */

/**
 * Firestore error codes that warrant a single retry — transient service unavailability only.
 * @type {Set<string>}
 */
const RETRIABLE_FIRESTORE_CODES = new Set(['unavailable', 'deadline-exceeded', 'internal']);

/**
 * Verify a chosen file's leading bytes (magic number) actually match its declared type before it is
 * uploaded. Browser uploads otherwise trust only the file extension / reported MIME, so a renamed
 * non-PDF (e.g. a `.txt` saved as `.pdf`) would be stored behind a trusted in-app document link.
 * This mirrors the server-side `fileSignatureMatches` check the Cloud Function ingest path already
 * performs (`functions/roster-parse-helpers.js`) — PDF must start with `%PDF-`, DOCX (a ZIP
 * container) with `PK\x03\x04`.
 *
 * **Fails CLOSED** (v14.99): a file that can't be read, or is shorter than the 5-byte signature
 * window, can't be a genuine PDF/DOCX — a real one is always ≥5 bytes and reads fine — so reject it
 * rather than wave it through. This is an admin-only manual-upload path, so a rejection is
 * retryable (it never affects the server-side daily Huddle ingest, which runs its own check).
 *
 * @param {File}         file         the chosen file
 * @param {'pdf'|'docx'} expectedType the type derived from the filename
 * @returns {Promise<void>} resolves when valid; throws `Error('SIGNATURE_MISMATCH')` when invalid/unreadable
 */
export async function assertFileSignature(file, expectedType) {
    let bytes;
    try {
        bytes = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    } catch {
        throw new Error('SIGNATURE_MISMATCH'); // can't read the file — fail CLOSED (admin-only, retryable)
    }
    if (bytes.length < 5) throw new Error('SIGNATURE_MISMATCH'); // too short to be a real PDF/DOCX — fail closed
    // %PDF-  → 25 50 44 46 2D
    const isPdfSig = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 &&
                     bytes[3] === 0x46 && bytes[4] === 0x2D;
    // PK\x03\x04 → 50 4B 03 04 (ZIP container; DOCX is a ZIP)
    const isZipSig = bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04;
    if (expectedType === 'pdf'  && !isPdfSig) throw new Error('SIGNATURE_MISMATCH');
    if (expectedType === 'docx' && !isZipSig) throw new Error('SIGNATURE_MISMATCH');
}

/**
 * Build the document-collection client.
 *
 * Every Firebase handle arrives here — nothing is imported from the SDK — which is what lets the
 * whole upload sequence be replayed in Node against fakes.
 *
 * @param {object} deps
 * @param {any} deps.db                        the Firestore instance
 * @param {Record<string,string>} deps.collections   COLLECTIONS (huddles/circulars/newsletters)
 * @param {any} deps.fs                        the Firestore functions this module calls: doc, getDoc,
 *                                             setDoc, collection, query, where, orderBy, limit,
 *                                             getDocs, onSnapshot, runTransaction, serverTimestamp
 * @param {() => Promise<any>} deps.getStorageSdk    resolves { storage, ref, uploadBytes, getDownloadURL, deleteObject }
 * @param {(uploadBytes:any, ref:any, file:any, meta:any) => Promise<any>} deps.uploadBytesWithClaimRetry
 * @param {object} deps.utils                  the pure path/type helpers
 * @param {(f:any)=>boolean} deps.utils.isDocxUpload
 * @param {(t:'pdf'|'docx')=>string} deps.utils.uploadMimeType
 * @param {(c:string,d:string,t?:string)=>string} deps.utils.legacyDocPath
 * @param {(c:string,d:string,id:string,t:string)=>string} deps.utils.versionedDocPath
 * @param {(a:any)=>string} deps.resolveUploadCommit  the pure ambiguous-commit verdict
 * @param {(...a:any[])=>Promise<any>} deps.pruneOldDocs  the six-month sweep
 * @returns {{
 *   uploadHuddle: (date:string, file:any, uploadedBy:string, htmlContent?:string|null) => Promise<string>,
 *   uploadCircular: (date:string, file:any, uploadedBy:string) => Promise<string>,
 *   uploadNewsletter: (date:string, file:any, uploadedBy:string) => Promise<string>,
 *   getLatestCircular: () => Promise<any>,
 *   getLatestNewsletter: () => Promise<any>,
 *   subscribeToLatestHuddle: (onData:Function, onError:Function) => Function,
 * }}
 */
export function buildDocumentClient({
    db, collections, fs, getStorageSdk, uploadBytesWithClaimRetry,
    utils, resolveUploadCommit, pruneOldDocs,
}) {
    const {
        doc, getDoc, setDoc, collection, query, where, orderBy, limit,
        getDocs, onSnapshot, runTransaction, serverTimestamp,
    } = fs;
    const { isDocxUpload, uploadMimeType, legacyDocPath, versionedDocPath } = utils;

    /**
     * The shared transactional upload engine behind all three collections. Flow: read the old
     * storagePath → write a VERSIONED Storage object → getDownloadURL → setDoc (resolve-by-reading
     * on a retriable code) → roll the new object back only on a DEFINITE non-commit → best-effort
     * delete of the superseded old object after commit. The reasoning for each step is in the
     * module header; do not reorder them.
     *
     * @param {string} collectionName  Firestore collection AND Storage folder prefix (e.g. 'huddles')
     * @param {string} date            ISO "YYYY-MM-DD" (also the Firestore doc id)
     * @param {any}    file            PDF or Word (.docx)
     * @param {string} uploadedBy      memberName of the uploading admin
     * @param {{ extraFields?: Record<string, any>, postCommit?: (sdk: any) => void, logTag?: string }} [opts]
     * @returns {Promise<string>} the permanent tokenised download URL of the stored file
     */
    async function transactionalUpload(collectionName, date, file, uploadedBy, opts = {}) {
        const { extraFields = {}, postCommit, logTag = collectionName } = opts;
        // Detect by extension OR the docx MIME so it matches the accept predicate (isDocxFile) — a
        // .docx accepted via its MIME (a cloud/Android picker with no .docx in the name) would
        // otherwise be mis-detected as 'pdf' and rejected with a confusing "not a valid" error.
        const fileType = isDocxUpload(file) ? 'docx' : 'pdf';
        await assertFileSignature(file, fileType);   // reject a renamed/mismatched file before Storage
        // Set the MIME explicitly — Android sometimes reports a .docx (a ZIP archive) as
        // application/zip or application/octet-stream, which can trip the Storage content-type rule.
        const mimeType = uploadMimeType(fileType);
        const { storage, ref, uploadBytes, getDownloadURL, deleteObject } = await getStorageSdk();

        // Read the previous storagePath first (storagePath added v13.99 — legacyDocPath is the
        // fallback for older docs, honouring the OLD doc's fileType so a PDF↔DOCX swap still finds
        // and cleans up the previous file).
        const oldSnap = await getDoc(doc(db, collectionName, date));
        const oldData = oldSnap.exists() ? oldSnap.data() : null;
        const oldStoragePath = oldData
            ? (oldData.storagePath ?? legacyDocPath(collectionName, date, oldData.fileType))
            : null;

        // The upload id is generated HERE (impure) so the path builder stays pure.
        const uploadId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const newStoragePath = versionedDocPath(collectionName, date, uploadId, fileType);
        const storageRef = ref(storage, newStoragePath);

        let storageUrl;
        try {
            await uploadBytesWithClaimRetry(uploadBytes, storageRef, file, { contentType: mimeType });
            storageUrl = await getDownloadURL(storageRef);  // permanent tokenised URL — never expires
            /** @type {Record<string, any>} */
            const firestoreDoc = {
                date, storageUrl, storagePath: newStoragePath, fileType,
                uploadedAt: serverTimestamp(), uploadedBy, ...extraFields,
            };
            try {
                await setDoc(doc(db, collectionName, date), firestoreDoc);
            } catch (setErr) {
                const e = /** @type {any} */ (setErr);
                if (!RETRIABLE_FIRESTORE_CODES.has(e?.code)) throw setErr;
                console.warn(`[upload] ${logTag} setDoc attempt 1 failed (${e?.code}) — checking what committed`);
                await new Promise(r => setTimeout(r, 2000));
                /** @type {any} */
                let liveNow = null;
                let readable = true;
                try {
                    const snap = await getDoc(doc(db, collectionName, date));
                    liveNow = snap.exists() ? snap.data() : null;
                } catch (readErr) {
                    // Could not read either. Fall back to re-issuing — the alternative is leaving a
                    // possibly-uncommitted upload with no metadata at all, and an unreadable
                    // Firestore is the same outage that produced the ambiguity.
                    readable = false;
                    console.warn(`[upload] ${logTag} post-failure read failed; re-issuing:`, /** @type {any} */ (readErr)?.code);
                }
                const livePath = liveNow
                    ? (liveNow.storagePath ?? legacyDocPath(collectionName, date, liveNow.fileType))
                    : null;
                const verdict = resolveUploadCommit({
                    ourPath: newStoragePath, oldPath: oldStoragePath, livePath, readable,
                });
                if (verdict === 'committed') {
                    console.log(`[upload] ${logTag} first write had committed after all — not re-writing`);
                } else if (verdict === 'superseded') {
                    // Somebody else's upload is live. Ours is an orphan, and this must NOT report
                    // success — that would send the admin away believing their file is the one staff
                    // will open. The throw goes to the outer catch, whose non-retriable branch
                    // deletes our object: the rollback belongs there, and duplicating it here would
                    // mean two deletes racing over one path for no gain.
                    const sup = /** @type {any} */ (new Error('A newer upload for this date was saved by someone else.'));
                    sup.code = 'upload/superseded';
                    throw sup;
                } else {
                    await setDoc(doc(db, collectionName, date), firestoreDoc);
                }
            }
        } catch (err) {
            // Old file is unaffected. Roll back the new object ONLY on a non-retriable failure
            // (definite non-commit). A still-retriable FINAL error is commit-ambiguous — deleting
            // could leave a committed doc pointing at nothing (staff taps 404 until re-upload) — so
            // leave the file (at most one orphan, which the next upload's cleanup tolerates).
            if (!RETRIABLE_FIRESTORE_CODES.has(/** @type {any} */ (err)?.code)) {
                deleteObject(storageRef).catch(/** @param {any} e */ e => console.warn(`[upload] ${logTag} rollback failed:`, e));
            } else {
                console.warn(`[upload] ${logTag} commit-ambiguous failure — leaving new Storage object in place:`, /** @type {any} */ (err)?.code);
            }
            throw err;
        }

        // Firestore committed: asynchronously remove the superseded old object (best-effort).
        if (oldStoragePath && oldStoragePath !== newStoragePath) {
            deleteObject(ref(storage, oldStoragePath)).catch(
                /** @param {any} e */ e => console.warn(`[upload] ${logTag} old-file cleanup failed (orphaned):`, e)
            );
        }

        postCommit?.({ storage, ref, deleteObject });
        return storageUrl;
    }

    /**
     * Circular/newsletter uploads: download-only (no inline conversion, so no extraFields), with
     * the six-month prune running post-commit.
     * @param {string} collectionName @param {string} date @param {any} file @param {string} uploadedBy
     * @returns {Promise<string>}
     */
    function uploadDoc(collectionName, date, file, uploadedBy) {
        return transactionalUpload(collectionName, date, file, uploadedBy, {
            logTag: collectionName,
            postCommit: ({ storage, ref, deleteObject }) =>
                pruneOldDocs(collectionName, date, storage, ref, deleteObject,
                    { db, doc, getDoc, collection, query, where, getDocs, runTransaction })
                    .catch(/** @param {any} e */ e => console.error(`[pruneOldDocs] ${collectionName}:`, e)),
        });
    }

    /**
     * Read the most recent document in a date-keyed collection (one-shot).
     * A row with no `storageUrl` is treated as absent — it points at nothing.
     * @param {string} collectionName
     * @returns {Promise<any>} the latest document's data, or null
     */
    async function latestIn(collectionName) {
        const q = query(collection(db, collectionName), orderBy('date', 'desc'), limit(1));
        const snap = await getDocs(q);
        if (snap.empty) return null;
        const data = snap.docs[0].data();
        return data.storageUrl ? data : null;
    }

    return {
        /**
         * Upload a Huddle file (PDF or Word .docx) for a given date. Overwrites any existing upload
         * for that date (latest wins). The `fileType` field tells the app whether to open the file
         * directly (PDF) or via the Office Online viewer (docx). Three-month huddle retention is
         * pruned server-side by the ingestHuddle Cloud Function, so there is no postCommit here.
         * @param {string} date @param {any} file @param {string} uploadedBy
         * @param {string|null} [htmlContent] pre-converted HTML for DOCX; null for PDF
         * @returns {Promise<string>} download URL of the stored file
         */
        uploadHuddle: (date, file, uploadedBy, htmlContent = null) =>
            transactionalUpload(collections.huddles, date, file, uploadedBy, {
                logTag: 'huddle',
                extraFields: htmlContent !== null ? { htmlContent } : {},
            }),

        /**
         * Upload a Weekly Retail Circular (PDF or Word .docx). Documents older than six months are
         * pruned after each upload.
         * @param {string} date @param {any} file @param {string} uploadedBy @returns {Promise<string>}
         */
        uploadCircular: (date, file, uploadedBy) =>
            uploadDoc(collections.circulars, date, file, uploadedBy),

        /**
         * Upload a Marylebone Newsletter (PDF or Word .docx). Same six-month prune.
         * @param {string} date @param {any} file @param {string} uploadedBy @returns {Promise<string>}
         */
        uploadNewsletter: (date, file, uploadedBy) =>
            uploadDoc(collections.newsletters, date, file, uploadedBy),

        /** @returns {Promise<any>} the latest Retail Circular, or null if none uploaded */
        getLatestCircular: () => latestIn(collections.circulars),

        /** @returns {Promise<any>} the latest Newsletter, or null if none uploaded */
        getLatestNewsletter: () => latestIn(collections.newsletters),

        /**
         * Subscribe to real-time updates for the latest Huddle document. Fires immediately with
         * cached data (IndexedDB) on repeat visits, then again when the network confirms — so the
         * Huddle button becomes active almost instantly — and again whenever a new huddle arrives.
         * @param {Function} onData  called with the huddle data object, or null
         * @param {Function} onError called with the Firestore error if the listener fails
         * @returns {Function} unsubscribe
         */
        subscribeToLatestHuddle: (onData, onError) => {
            // Single-field orderBy — Firestore auto-indexes this; no composite index needed.
            const q = query(collection(db, collections.huddles), orderBy('date', 'desc'), limit(1));
            return onSnapshot(q, /** @param {any} snap */ (snap) => {
                if (snap.empty) { onData(null); return; }
                const data = snap.docs[0].data();
                if (!data.storageUrl) console.warn('[Huddle] Document missing storageUrl:', snap.docs[0].id);
                onData(data.storageUrl ? data : null);
            }, onError);
        },
    };
}
