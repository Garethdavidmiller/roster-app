/**
 * functions/documents.js — the DOCUMENT-AND-NOTIFICATION domain of the Cloud Functions
 * (second cut of the index.js domain split; the first was push.js at v20.52).
 *
 * Owns: ingestHuddle (the Power Automate upload), the three onDocumentCreated notification
 * triggers, the scheduled pay reminder, and their private helpers (the huddle prune, the
 * fan-out wrappers). Everything DOCUMENT-shaped: a file arrives or a doc is created, staff
 * are told, old copies are reclaimed.
 *
 * ── WHY A FACTORY, NOT A PLAIN MODULE ──────────────────────────────────────────────────────────
 * `buildDocumentEndpoints(deps)` takes its shared infrastructure as ARGUMENTS — the secret
 * params, the VAPID public key, STAFF_SITE_URL, readRawBody and the size caps — rather than
 * importing them, for two reasons that are really one reason:
 *   · index.js stays the COMPOSITION ROOT. The static guards read index.js for the VAPID
 *     public key literal (sw-asset-check) precisely because one home for it is the contract;
 *     a shared-constants module would move the literal out from under the guard.
 *   · a Node test can call this factory with a FAKE admin SDK boundary later without any
 *     emulator — the same seam push.js's setupWebPush(vapidPrivate, vapidPublic) established.
 * The domain requires its own third-party modules (admin, crypto, the helpers, the push
 * transport) directly: those are not configuration, they are the domain's own tools, and
 * Node's module cache makes the `admin` instance the same one index.js initialised.
 *
 * Deploy surface: index.js re-exports the returned handlers under the SAME names, so
 * `firebase deploy` sees an unchanged function list. Do not export anything from here
 * directly — a handler that is not re-exported from index.js does not exist to Firebase.
 */

const { onRequest }         = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule }        = require('firebase-functions/v2/scheduler');
const admin  = require('firebase-admin');
const crypto = require('crypto');
const { parseStrictIsoDate, isPayCutoffDay, fileSignatureMatches, buildPushPayload } = require('./roster-parse-helpers');
const { setupWebPush, fanOutPush } = require('./push');

/**
 * Build the document-domain endpoints. Called once from index.js with the shared infra.
 * @param {object} deps
 * @param {import('firebase-functions/params').SecretParam} deps.HUDDLE_SECRET
 * @param {import('firebase-functions/params').SecretParam} deps.VAPID_PRIVATE_KEY
 * @param {string}   deps.VAPID_PUBLIC_KEY
 * @param {string}   deps.STAFF_SITE_URL
 * @param {Function} deps.readRawBody           shared streaming body reader (also used by parseRosterPDF)
 * @param {Function} deps.nowInLondon           TZ-independent London calendar date
 * @param {Function} deps.isRetriableFirestoreError  commit-ambiguous classifier
 * @param {number}   deps.MAX_FILE_BYTES
 * @param {number}   deps.MAX_HUDDLE_HTML_CHARS
 */
function buildDocumentEndpoints({
    HUDDLE_SECRET, VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, STAFF_SITE_URL,
    readRawBody, nowInLondon, isRetriableFirestoreError,
    MAX_FILE_BYTES, MAX_HUDDLE_HTML_CHARS,
}) {

    // Set to true to silence all Huddle push notifications (e.g. while the staff site
    // is genuinely down). Re-enabled after fixing the real cause of the 16 Jun 2026 pause:
    // STAFF_SITE_URL was missing the `/roster-app` path, so notification taps hit a 404
    // (mis-recorded at the time as "the site is down"). To pause again: set true, redeploy.
    const HUDDLE_PUSH_PAUSED = false;

/**
 * POST /ingestHuddle
 *
 * Called by Power Automate when a Huddle email arrives.
 *
 * Request headers:
 *   Authorization:    Bearer <HUDDLE_SECRET>
 *   Content-Type:     text/plain
 *   X-Huddle-Date:    YYYY-MM-DD   (London date of the huddle)
 *   X-Huddle-Filename: huddle.pdf  (original filename — detects pdf vs docx)
 *
 * Request body:
 *   The raw base64-encoded file content as plain text.
 *   (Power Automate's contentBytes, sent directly — no JSON wrapper.)
 *
 * Success response (200):
 *   { "success": true, "date": "2026-03-19", "storageUrl": "https://..." }
 */
const ingestHuddle = onRequest(
    {
        secrets:       [HUDDLE_SECRET, VAPID_PRIVATE_KEY],
        region:        'europe-west2',
        cors:          false,
        timeoutSeconds: 60,
    },
    async (req, res) => {

        // ---- Method check ----
        if (req.method !== 'POST') {
            res.status(405).json({ error: 'Method not allowed' });
            return;
        }

        // ---- Authentication ----
        const authHeader = req.headers['authorization'] || '';
        const expected   = `Bearer ${HUDDLE_SECRET.value()}`;
        // Compare byte-length buffers, not string character lengths — a multi-byte
        // UTF-8 char can match character count but differ in byte count, causing
        // timingSafeEqual to throw ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH.
        const authBuf   = Buffer.from(authHeader);
        const expectBuf = Buffer.from(expected);
        const match = authBuf.length === expectBuf.length &&
            crypto.timingSafeEqual(authBuf, expectBuf);
        if (!match) {
            res.status(401).json({ error: 'Unauthorised' });
            return;
        }

        // ---- Metadata from headers ----
        const date     = (req.headers['x-huddle-date']     || '').trim();
        const filename = (req.headers['x-huddle-filename'] || '').trim();

        if (!date || !filename) {
            res.status(400).json({ error: 'Missing required headers: x-huddle-date, x-huddle-filename' });
            return;
        }

        const parsedDate = parseStrictIsoDate(date);
        if (!parsedDate) {
            res.status(400).json({ error: 'Invalid date — expected a real YYYY-MM-DD calendar date' });
            return;
        }

        // ---- Read raw body ----
        // The file arrives as a base64 plain-text body (bypasses the JSON body-size limit);
        // readRawBody streams + size-caps it (rejecting oversized uploads mid-stream).
        let base64Content = await readRawBody(req, res, 'ingestHuddle');
        if (base64Content === null) return;   // helper already sent the 413/400 response

        console.log(`[ingestHuddle] base64 length received: ${base64Content.length}`);

        // Strip internal whitespace — Power Automate may wrap base64 at 76 chars.
        base64Content = base64Content.replace(/\s+/g, '');

        if (!base64Content) {
            res.status(400).json({ error: 'Request body is empty' });
            return;
        }

        // Validate base64 before decode — Node's Buffer.from silently ignores invalid
        // characters rather than throwing, so the try/catch below is not sufficient alone.
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64Content)) {
            res.status(400).json({ error: 'Body must be valid base64' });
            return;
        }

        // ---- Decode file ----
        // Buffer.from(..., 'base64') never throws — it silently drops non-base64 chars — which is
        // why the base64 charset is validated above. (Mirrors parseRosterPDF's decode; the old
        // try/catch here was dead code.)
        const fileBuffer = Buffer.from(base64Content, 'base64');

        if (fileBuffer.length === 0) {
            res.status(400).json({ error: 'Decoded file is empty' });
            return;
        }

        if (fileBuffer.length > MAX_FILE_BYTES) {
            res.status(413).json({ error: 'File exceeds 20 MB limit' });
            return;
        }

        // ---- Determine file type ----
        const lcFilename = filename.toLowerCase();
        const isDocx     = lcFilename.endsWith('.docx');
        const isPdf      = lcFilename.endsWith('.pdf');
        if (!isDocx && !isPdf) {
            res.status(400).json({ error: 'Only .pdf and .docx files are accepted' });
            return;
        }
        const fileType = isDocx ? 'docx' : 'pdf';
        const mimeType = isDocx
            ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : 'application/pdf';

        // Verify the decoded bytes actually match the claimed type — a mislabelled
        // extension or spoofed upload should not reach Storage or the DOCX converter.
        if (!fileSignatureMatches(fileBuffer, fileType)) {
            res.status(400).json({ error: `File content does not match its .${fileType} extension` });
            return;
        }

        // ---- Upload to Firebase Storage ----
        // Versioned suffix prevents a second upload (different file type) for the same
        // date from silently orphaning the first file in Storage — each gets its own path.
        const uploadId    = crypto.randomBytes(4).toString('hex');
        const storagePath = `huddles/${date}-${uploadId}.${fileType}`;

        // Capture the previous version's Storage path (if any) BEFORE overwriting the
        // Firestore doc, so the orphaned object can be deleted once the new metadata
        // commits. Versioned paths mean each upload writes a NEW object — without this
        // the prior file is left behind in Storage on every re-upload for a date.
        let prevStoragePath = null;
        // This read now feeds ONLY the old-file cleanup — the create-vs-notify decision is made
        // atomically inside the metadata transaction below (Finding #6). Non-fatal: a failed read just
        // means a prior version's object may be left for pruneOldHuddles to reclaim.
        try {
            const prevSnap = await admin.firestore().collection('huddles').doc(date).get();
            if (prevSnap.exists) prevStoragePath = (prevSnap.data() || {}).storagePath || null;
        } catch (readErr) {
            console.warn('[ingestHuddle] Could not read previous huddle metadata (non-fatal, cleanup only):', readErr.message);
        }

        try {
            const bucket = admin.storage().bucket();
            const file   = bucket.file(storagePath);

            await file.save(fileBuffer, { contentType: mimeType });

            // Use a permanent download-token URL scoped to the retention window. We deliberately do
            // NOT use a v4 signed URL: GCS caps v4 expiry at 7 DAYS, so the old 365-day request threw
            // on every ingest and silently fell through to this same token path anyway — and a real
            // 7-day URL would 403 on huddles still within the 3-month retention window. Reads on the
            // huddles collection are open (matching the calendar's no-auth model) and huddles
            // auto-prune at 3 months (pruneOldHuddles), so a token URL that lives for the retention
            // window is the correct fit. The bucket segment matches isSafeStorageUrl's allowlist.
            const downloadToken = crypto.randomUUID();
            await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: downloadToken } });
            const encodedPath = encodeURIComponent(storagePath);
            const storageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${downloadToken}`;

            // ---- Convert DOCX to HTML for in-app viewing ----
            // mammoth converts the Word document to clean HTML at upload time so the
            // client never needs to download the raw DOCX or rely on an external viewer.
            // The HTML is stored in Firestore alongside the storage URL.
            // PDF files are opened natively by Chrome — no conversion needed.
            let htmlContent = null;
            if (isDocx) {
                try {
                    const mammoth = require('mammoth'); // M8: lazy-loaded only for DOCX conversion
                    const result = await mammoth.convertToHtml({ buffer: fileBuffer });
                    htmlContent  = result.value || null;
                    console.log(`[ingestHuddle] DOCX converted to HTML (${htmlContent ? htmlContent.length : 0} chars)`);
                    // Cap at 200 KB — a Huddle is a short daily briefing. A larger HTML blob
                    // indicates something unexpected (a giant document, a conversion anomaly).
                    // Store the file in Storage and let staff download it directly instead.
                    if (htmlContent && htmlContent.length > MAX_HUDDLE_HTML_CHARS) {
                        console.warn(`[ingestHuddle] HTML too large (${htmlContent.length} chars) — discarding, staff will download from Storage`);
                        htmlContent = null;
                    }
                } catch (mammothErr) {
                    // Conversion failure is non-fatal — file still saved to Storage
                    console.warn('[ingestHuddle] mammoth conversion failed:', mammothErr.message);
                }
            }

            // ---- Write Firestore metadata document ----
            const firestoreDoc = {
                date,
                storageUrl,
                storagePath,
                fileType,
                uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
                uploadedBy: 'power-automate',
            };
            if (htmlContent !== null) firestoreDoc.htmlContent = htmlContent;
            // Write the metadata AND decide create-vs-re-send ATOMICALLY (Finding #6). The old flow read
            // the doc up front (check) then, separately, notified when that read said 'absent' (act) —
            // a check-then-act race: two concurrent Power Automate runs for the same date both read
            // "absent" before either wrote, so BOTH fanned out a push. A transaction serialises them —
            // whichever commits first sees `!exists` and owns the notify; the other sees the doc and
            // suppresses. The transaction's own retry replaces the manual commit-ambiguous re-issue (the
            // set is idempotent, so an internal retry recomputes createdNew against the latest committed
            // state — if a concurrent run created the doc meanwhile, createdNew flips false and we don't
            // double-notify, consistent with "a missed notification is safer than spamming staff").
            let createdNew = false;
            const huddleRef = admin.firestore().collection('huddles').doc(date);
            try {
                createdNew = await admin.firestore().runTransaction(async tx => {
                    const snap = await tx.get(huddleRef);
                    tx.set(huddleRef, firestoreDoc);
                    return !snap.exists;   // true ⇒ this run created the date's doc → a genuine first upload
                });
            } catch (metaErr) {
                if (isRetriableFirestoreError(metaErr)) {
                    // Transaction exhausted its retries on a retriable/commit-ambiguous error. Deleting the
                    // object could orphan a doc that actually committed (staff tap a 404), so LEAVE it (the
                    // next upload's cleanup or pruneOldHuddles supersedes it) and rethrow.
                    console.warn(`[ingestHuddle] metadata transaction failed (${metaErr.code}) — leaving new object in place (commit-ambiguous), not deleting`);
                    throw metaErr;
                }
                // Definite non-commit — safe to delete the just-uploaded object so it isn't orphaned.
                await bucket.file(storagePath).delete().catch(() => {});
                throw metaErr;
            }

            // New metadata committed — delete the previous version's object (best-effort;
            // a failure just leaves one stale file, superseded by the next upload).
            if (prevStoragePath && prevStoragePath !== storagePath) {
                await bucket.file(prevStoragePath).delete().catch(delErr =>
                    console.warn('[ingestHuddle] Old huddle object cleanup failed (non-fatal):', delErr.message));
            }
            // When the pre-upload read failed, prevStoragePath was never captured, so a prior version
            // for this date is left orphaned. We deliberately do NOT sweep
            // `huddles/<date>*` HERE to reclaim it: Power Automate can double-run a date (see the notify
            // guard below), and a sweep could catch a CONCURRENT ingest's just-committed object, leaving
            // that doc pointing at a deleted file — a staff-visible 404, worse than the invisible orphan.
            // Instead pruneOldHuddles reclaims it with a date-prefix sweep once the date ages out of the
            // retention window, where no ingest can be racing it. (v16.89)

            console.log(`[ingestHuddle] Uploaded ${fileType} for ${date} (${fileBuffer.length} bytes)`);

            // Send push notifications directly here — before res.json() so Cloud Run
            // doesn't reclaim the container before the fan-out completes.
            // The onHuddleCreated Firestore trigger handles manual admin uploads separately;
            // it skips Power Automate uploads (uploadedBy === 'power-automate') to avoid
            // double-notifying. This direct call is the authoritative path for PA uploads.
            //
            // Notify only on a genuine CREATE for this date (createdNew from the atomic transaction
            // above). onHuddleCreated is create-only, so a MANUAL re-upload never re-notifies; without
            // this guard a Power Automate RE-SEND — or a concurrent double-run — for a date that already
            // had a huddle still fanned out a second push to everyone. Matching the manual path's
            // convention means an accidental duplicate can't spam staff; a genuine correction still
            // updates the huddle silently (the in-app viewer has a live subscription and refreshes).
            if (createdNew) {
                try {
                    await sendHuddlePushNotifications(date, VAPID_PRIVATE_KEY);
                } catch (pushErr) {
                    console.warn('[ingestHuddle] Push notifications failed (non-fatal):', pushErr.message);
                }
            } else {
                console.log(`[ingestHuddle] Re-send / concurrent duplicate for existing date ${date} — not re-notifying (matches the manual re-upload path)`);
            }

            // Bound the collection: huddles are daily and would otherwise grow without limit.
            // Best-effort prune of anything older than 3 months. Awaited (not fire-and-forget)
            // so it completes within the request — Cloud Run may reclaim the container the
            // moment res.json() returns. Never blocks success: failures are swallowed.
            try {
                await pruneOldHuddles(date);
            } catch (pruneErr) {
                console.warn('[ingestHuddle] Huddle prune failed (non-fatal):', pruneErr.message);
            }

            res.status(200).json({ success: true, date, storageUrl });

        } catch (err) {
            console.error('[ingestHuddle] Upload failed:', err);
            res.status(500).json({ error: 'Upload failed — check function logs' });
        }
    }
);

// ============================================================================
// onHuddleCreated — Firestore trigger
// ============================================================================
/**
 * Fires whenever a new document is created in the `huddles` collection —
 * i.e. the first upload for a given date, whether from Power Automate or
 * from the manual upload card in admin.html.
 *
 * Re-uploads for the same date (setDoc overwrite) are UPDATE events, not
 * CREATE events, so staff are only notified once per huddle date.
 */
const onHuddleCreated = onDocumentCreated(
    {
        document: 'huddles/{date}',
        secrets:  [VAPID_PRIVATE_KEY],
        region:   'europe-west2',
    },
    async event => {
        const date       = event.params.date;
        // event.data is DocumentSnapshot | undefined in Functions v2 (e.g. the doc was
        // deleted before the trigger read it) — guard so a missing snapshot cleanly no-ops
        // instead of throwing a TypeError and forcing a retry with no push sent.
        const snap = event.data;
        if (!snap) {
            console.warn(`[onHuddleCreated] No snapshot for ${date} — skipping`);
            return;
        }
        const uploadedBy = snap.data().uploadedBy || '';

        // Power Automate uploads are handled directly inside ingestHuddle (before the
        // HTTP response, so the container is guaranteed to be alive). This guard is
        // essential — without it, both ingestHuddle and this trigger would fan out push
        // notifications for the same date, double-notifying all staff.
        if (uploadedBy === 'power-automate') {
            console.log(`[onHuddleCreated] Skipping — Power Automate upload already notified via ingestHuddle`);
            return;
        }

        // Manual admin upload — fire push from here (ingestHuddle is not involved).
        console.log(`[onHuddleCreated] Manual upload by "${uploadedBy}" for ${date} — fanning out push`);
        try {
            await sendHuddlePushNotifications(date, VAPID_PRIVATE_KEY);
        } catch (err) {
            console.warn('[onHuddleCreated] Push fan-out error:', err.message);
        }
    }
);

// ============================================================================
// onCircularCreated / onNewsletterCreated — Firestore triggers
// ============================================================================
// Circulars and newsletters are browser-upload-only today, so unlike the Huddle there
// is no double-send concern — the create trigger is the single notification source.
// Fires on CREATE only, so re-uploading a correction to the same date (setDoc overwrite
// = UPDATE) does not re-notify.
//
// FUTURE — Power Automate automation: this trigger fires on doc CREATE regardless of
// WHO writes it (Firestore triggers fire for Admin SDK writes too). So a future
// ingestCircular/ingestNewsletter Cloud Function only needs to WRITE the Firestore doc —
// the push is sent automatically here, no notification code to add. Crucially, that
// future ingest must NOT also fan out push inline (the way ingestHuddle does): doing so
// would double-notify and force the same `uploadedBy === 'power-automate'` guard the
// Huddle needs. Keep the trigger as the single source. See .claude/rules/notifications.md.

/** Fan out a document-arrival push for a circular/newsletter, to the design language. */
async function sendDocPushNotifications(feature, body, vapidPrivate) {
    setupWebPush(vapidPrivate, VAPID_PUBLIC_KEY);
    await fanOutPush(buildPushPayload({ feature, body, baseUrl: STAFF_SITE_URL }), `[${feature}]`);
    console.log(`[${feature}] notification sent`);
}

const onCircularCreated = onDocumentCreated(
    { document: 'circulars/{date}', secrets: [VAPID_PRIVATE_KEY], region: 'europe-west2' },
    async event => {
        const date = event.params.date;
        console.log(`[onCircularCreated] ${date} — fanning out push`);
        try {
            await sendDocPushNotifications('circular', "Tap to read this week's retail update.", VAPID_PRIVATE_KEY);
        } catch (err) {
            console.warn('[onCircularCreated] Push fan-out error:', err.message);
        }
    }
);

const onNewsletterCreated = onDocumentCreated(
    { document: 'newsletters/{date}', secrets: [VAPID_PRIVATE_KEY], region: 'europe-west2' },
    async event => {
        const date = event.params.date;
        console.log(`[onNewsletterCreated] ${date} — fanning out push`);
        try {
            await sendDocPushNotifications('newsletter', 'Tap to read the latest newsletter.', VAPID_PRIVATE_KEY);
        } catch (err) {
            console.warn('[onNewsletterCreated] Push fan-out error:', err.message);
        }
    }
);

// The web-push TRANSPORT lives in ./push.js (v20.52) — lazy require, VAPID setup, fanOutPush and
// the fail-closed sendTargetedPush. What stays here is the DECISION to send and what to say, which
// is domain knowledge; how a payload reaches a phone is not.
// Number of months of Huddle history to retain. Huddles are daily and short-lived in
// usefulness; older ones are pruned so the collection and Storage stay bounded. Circulars
// and newsletters keep 6 months (browser-side _pruneOldDocs); huddles are higher-volume and
// less referenced after the day, so 3 months is enough.
const HUDDLE_RETENTION_MONTHS = 3;

/**
 * Delete Huddle Firestore docs (and their Storage objects) older than
 * HUDDLE_RETENTION_MONTHS. Each huddle doc's ID is its "YYYY-MM-DD" date and the same value
 * is stored in the `date` field, so a string range query on `date` finds the stale ones
 * (ISO date strings sort lexicographically the same as chronologically). Firestore is deleted
 * first, then Storage — a partial failure leaves an orphaned Storage object (invisible to
 * staff) rather than a Firestore doc pointing at a deleted file (a user-facing broken link).
 *
 * @param {string} excludeDate  The date just written — never pruned even if the clock is odd.
 * @returns {Promise<void>}
 */
async function pruneOldHuddles(excludeDate) {
    // Clamp the day to the last valid day of the target month — a bare
    // setMonth(getMonth() - N) overflows on a month-end run (e.g. 31 May → 31 Feb →
    // 3 Mar), which would over-prune by a few days. Mirrors _pruneOldDocs in
    // firebase-client.js (the browser circular/newsletter prune).
    // nowInLondon (v16.23): huddle dates are London dates; a bare new Date() on UTC Cloud Run
    // skews the 3-month cutoff by a day during BST (midnight–1am London) — this file's own
    // convention (the pay reminder) already derives London dates this way. nowInLondon returns
    // {year, month, day} parts; rebuild a Date carrying the LONDON calendar date so the
    // month-arithmetic below is TZ-independent.
    // NOTE: the month-underflow clamp below (daysInTargetMonth + Math.min) is the SAME algorithm as
    // storage-utils.js `sixMonthCutoffISO` — the browser circular/newsletter 6-month prune. Kept as a
    // deliberate duplicate because Cloud Functions are CommonJS and can't import the browser ES module
    // (same boundary as normaliseSurname); if the clamp logic changes, update BOTH. (cross-file review E5)
    const ldn = nowInLondon();
    const now = new Date(ldn.year, ldn.month, ldn.day);
    const tm  = now.getMonth() - HUDDLE_RETENTION_MONTHS;
    const daysInTargetMonth = new Date(now.getFullYear(), tm + 1, 0).getDate();
    const cutoff = new Date(now.getFullYear(), tm, Math.min(now.getDate(), daysInTargetMonth));
    const cutoffISO = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;   // "YYYY-MM-DD"

    const db     = admin.firestore();
    const bucket = admin.storage().bucket();
    const stale  = await db.collection('huddles').where('date', '<', cutoffISO).get();
    if (stale.empty) return;

    await Promise.allSettled(stale.docs.map(async docSnap => {
        if (docSnap.id === excludeDate) return;
        // Defensive re-validation before a DESTRUCTIVE prefix delete: the sweep below removes Storage
        // objects by the `huddles/<id>` prefix, so a malformed/truncated id (e.g. "2026-07") would nuke
        // unrelated objects — a whole month. No current write path can produce one (huddle ids are the
        // strict YYYY-MM-DD date, doc-id === the `date` field), but a hand-created or corrupted doc must
        // never let this prefix widen. parseStrictIsoDate enforces the exact format + a real calendar date.
        if (!parseStrictIsoDate(docSnap.id)) {
            console.warn(`[pruneOldHuddles] Skipping doc with a non-date id (not swept): ${docSnap.id}`);
            return;
        }
        // Firestore FIRST — a partial failure must leave a harmless orphan, never a doc pointing at a
        // deleted file. If the doc delete fails, do NOT sweep: the doc still references its object.
        try {
            await docSnap.ref.delete();
        } catch (e) {
            console.error(`[pruneOldHuddles] Firestore delete ${docSnap.id} failed (Storage NOT swept):`, e.message);
            return;
        }
        // Sweep EVERY Storage object for this date, not just the doc's current path. A transient
        // Firestore read failure during a same-day re-ingest can leave an EARLIER versioned object
        // orphaned (the overwritten doc no longer points at it, and the ingest-time targeted delete
        // never captured its path). This date is older than the retention window, so no ingest is
        // racing it — the sweep is unambiguous. The `huddles/<date>` prefix matches BOTH the
        // versioned (`<date>-<id>.<ext>`) and legacy pre-v13.99 (`<date>.<ext>`) object names, so it
        // supersedes the old storagePath-based delete that reclaimed only the current object.
        try {
            const [files] = await bucket.getFiles({ prefix: `huddles/${docSnap.id}` });
            await Promise.all(files.map(f => f.delete().catch(e =>
                console.warn(`[pruneOldHuddles] Storage delete ${f.name} failed (orphaned):`, e.message))));
        } catch (e) {
            console.warn(`[pruneOldHuddles] Storage sweep for ${docSnap.id} failed (orphaned):`, e.message);
        }
    }));
    console.log(`[pruneOldHuddles] Pruned huddles older than ${cutoffISO}`);
}

/**
 * Fan out Huddle push notifications. Uses the fixed "Latest Huddle" design-language copy via
 * buildPushPayload (see .claude/rules/notifications.md) — day-relative labels ("Today's"/
 * "Tomorrow's") were retired in that redesign because a Huddle is sent the evening before and the
 * label is wrong by the time it's read. `huddleDate` is now only logging/deep-link context.
 *
 * @param {string}       huddleDate    YYYY-MM-DD — the date the huddle is FOR
 * @param {SecretParam}  vapidPrivate  Firebase secret param for VAPID private key
 */
async function sendHuddlePushNotifications(huddleDate, vapidPrivate) {
    if (HUDDLE_PUSH_PAUSED) {
        console.log(`[push] HUDDLE_PUSH_PAUSED=true — skipping notifications for ${huddleDate}.`);
        return;
    }
    setupWebPush(vapidPrivate, VAPID_PUBLIC_KEY);

    // Notification design language (.claude/rules/notifications.md): "📋 Latest Huddle".
    // "Latest" (not "Today's") because the Huddle is the next-day plan sent the evening
    // before, so a day-relative label is inaccurate by the time staff read it.
    await fanOutPush(buildPushPayload({
        feature: 'huddle',
        body:    'Tap to read the latest day plan.',
        baseUrl: STAFF_SITE_URL,
    }), '[push]');
    console.log(`[push] Huddle notification sent for ${huddleDate}`);
}

/**
 * Fan out pay reminder push notifications.
 * URL includes ?payday=YYYY-MM-DD so the Pay Calculator opens on the correct period.
 *
 * @param {Date}         payday        The upcoming payday date
 * @param {SecretParam}  vapidPrivate  Firebase secret param for VAPID private key
 */
async function sendPayPushNotifications(payday, vapidPrivate) {
    setupWebPush(vapidPrivate, VAPID_PUBLIC_KEY);

    // Use toISOString() (UTC) — the caller constructs payday at NOON UTC from London calendar
    // parts, so the UTC date is the correct London date on any runtime timezone.
    const paydayISO = payday.toISOString().slice(0, 10);

    const paydayDay = payday.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Europe/London' });
    const paydayFmt = payday.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'Europe/London' });

    // Event-reminder grammar (.claude/rules/notifications.md): "💷 <Event> — <urgency>",
    // calm/no-exclamation tone, action in the body.
    await fanOutPush(buildPushPayload({
        feature:  'pay',
        headline: `Payday ${paydayDay} — hours cutoff today`,
        body:     `Open the Pay Calculator to estimate your ${paydayFmt} pay.`,
        url:      `${STAFF_SITE_URL}/paycalc.html?payday=${paydayISO}`,
    }), '[payReminder]');
    console.log(`[payReminder] Pay reminder sent — payday ${paydayISO}`);
}

// ============================================================================
// sendPayReminderNotification — scheduled pay cutoff reminder
// ============================================================================
/**
 * Runs daily at 08:00 London time. On pay cutoff Saturdays (the Saturday before
 * payday), sends a push notification to all subscribed devices reminding staff
 * to enter their hours in the Pay Calculator.
 *
 * Cutoff date logic mirrors isCutoffDate() in roster-data.js:
 *   - First payday: 13 Feb 2026 (Friday). Cycle: every 28 days.
 *   - Cutoff = Saturday 6 days before payday.
 *   - Bank holiday adjustments to payday are not replicated here (rare edge case).
 */
const sendPayReminderNotification = onSchedule(
    {
        schedule:  '0 8 * * *',
        timeZone:  'Europe/London',
        region:    'europe-west2',
        secrets:   [VAPID_PRIVATE_KEY],
    },
    async () => {
        try {
            const { year, month, day } = nowInLondon();
            const today = new Date(year, month, day);

            if (!isPayCutoffDay(today)) {
                console.log('[payReminder] Not a cutoff date — skipping');
                return;
            }

            // Anchor the payday at NOON UTC built from the London calendar parts — not local
            // midnight. sendPayPushNotifications derives the ?payday= deep link via toISOString();
            // a local-midnight Date only yields the right UTC day because Cloud Run pins TZ=UTC,
            // and this file's convention (isPayCutoffDay, pruneOldHuddles) is TZ-independence.
            const payday = new Date(Date.UTC(year, month, day, 12));
            payday.setUTCDate(payday.getUTCDate() + 6);
            console.log(`[payReminder] Cutoff day — sending pay reminder`);
            await sendPayPushNotifications(payday, VAPID_PRIVATE_KEY);
        } catch (err) {
            console.error('[payReminder] Unhandled error:', err);
            throw err;
        }
    }
);
    return { ingestHuddle, onHuddleCreated, onCircularCreated, onNewsletterCreated, sendPayReminderNotification };
}

module.exports = { buildDocumentEndpoints };
