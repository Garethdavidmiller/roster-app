/**
 * functions/documents.js — the DOCUMENT-AND-NOTIFICATION domain of the Cloud Functions
 * (second cut of the index.js domain split; the first was push.js at v20.52).
 *
 * Owns: ingestHuddle (the Power Automate upload), getDocumentUrl (the short-lived document url),
 * rotateDocumentLinks (new keys for the permanent links — the work is ./doc-link-rotation.js),
 * the three onDocumentCreated notification triggers, the scheduled pay reminder (its audience and
 * send: ./pay-reminder.js), the one-off timetable reminder (sendTimetableReminder), and their
 * private helpers (the huddle prune, the fan-out wrappers). Everything DOCUMENT-shaped: a file
 * arrives or a doc is created, staff are told, old copies are reclaimed, and a member is handed a
 * link to open one.
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
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const crypto = require('crypto');
const { getAuth } = require('firebase-admin/auth');
const { parseStrictIsoDate, isPayCutoffDay, fileSignatureMatches, buildPushPayload } = require('./roster-parse-helpers');
const { mayReceiveDocumentUrl, resolveKind, kindFromBody, signedUrlExpiry, SIGNED_URL_TTL_MS,
    isSignablePathForKind } = require('./doc-url-core');
const { setupWebPush, fanOutPush } = require('./push');
const { memberNameFromClaims } = require('./member-identity');
const { bearerToken, requireAdmin, readJsonBody } = require('./request-helpers');
const { sendPayReminder } = require('./pay-reminder');
const { rotateDocumentLinks: rotateLinks } = require('./doc-link-rotation');

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
 * @param {string[]} deps.ADMIN_FUNCTION_ORIGINS  the CORS allowlist for getDocumentUrl
 * @param {Record<string, any>} deps.rosterMembers  the server-owned roster (roster-members.json) — the pay reminder's audience
 */
function buildDocumentEndpoints({
    HUDDLE_SECRET, VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, STAFF_SITE_URL,
    readRawBody, nowInLondon, isRetriableFirestoreError,
    MAX_FILE_BYTES, MAX_HUDDLE_HTML_CHARS, ADMIN_FUNCTION_ORIGINS, rosterMembers,
}) {

    // Set to true to silence all Huddle push notifications (e.g. while the staff site
    // is genuinely down). Re-enabled after fixing the real cause of the 16 Jun 2026 pause:
    // STAFF_SITE_URL was missing the `/roster-app` path, so notification taps hit a 404
    // (mis-recorded at the time as "the site is down"). To pause again: set true, redeploy.
    const HUDDLE_PUSH_PAUSED = false;

    // The largest .docx the ingest converts to HTML (functions-core-3). Generous on purpose: an
    // ordinary text Huddle is tens of kilobytes, and a file this size whose HTML still fitted
    // MAX_HUDDLE_HTML_CHARS would have to be almost entirely content Word does not render.
    const MAX_DOCX_CONVERT_BYTES = 2 * 1024 * 1024;

    /**
     * Is the document just written under `date` the one a tap would now open — the LATEST of its
     * kind? Every arrival notice says "Latest …" and every viewer opens the newest `date`, so a
     * back-filled older document announced as "Latest" sent staff to the newer one they had already
     * read (functions-core-1). Asked with the viewer's own query, so the two cannot disagree.
     *
     * A read that FAILS answers true — announce, as before. A missed arrival is the failure nobody
     * sees; a wrongly-announced back-fill is one extra buzz.
     * @param {string} collectionName  'huddles' | 'circulars' | 'newsletters'
     * @param {string} date            YYYY-MM-DD — the document just written
     * @returns {Promise<boolean>}
     */
    async function isLatestOfKind(collectionName, date) {
        try {
            const snap = await getFirestore().collection(collectionName).orderBy('date', 'desc').limit(1).get();
            if (snap.empty) return true;
            const newest = (snap.docs[0].data() || {}).date;
            return !(typeof newest === 'string' && newest > date);
        } catch (err) {
            console.warn(`[${collectionName}] could not read the latest document — announcing ${date} anyway:`, err && err.message);
            return true;
        }
    }

    /** London's tomorrow as YYYY-MM-DD — the latest date a Huddle may be filed under, as on the card. */
    function londonTomorrowIso() {
        const { year, month, day } = nowInLondon();
        return new Date(Date.UTC(year, month, day + 1)).toISOString().slice(0, 10);
    }

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
        // Declared, not the platform's 256 MiB (functions-core-3): a file at the upload cap is held as
        // the base64 body, its text and the decoded bytes at once — measured near 270 MiB just under
        // the cap, before the Storage and Firestore clients. parseRosterPDF has the same cap and 512 MiB.
        memory:        '512MiB',
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
        // No later than London's tomorrow, the bound the manual card holds. The flow dates a Huddle
        // by the day its email was received, so this never refuses a real one — but a far-future
        // date would be "the latest" for every Huddle after it: shown in their place, and silencing
        // every notice (isLatestOfKind) until somebody deleted it.
        if (date > londonTomorrowIso()) {
            res.status(400).json({ error: 'Date is in the future — a Huddle is filed under the day it was received' });
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
            const prevSnap = await getFirestore().collection('huddles').doc(date).get();
            if (prevSnap.exists) prevStoragePath = (prevSnap.data() || {}).storagePath || null;
        } catch (readErr) {
            console.warn('[ingestHuddle] Could not read previous huddle metadata (non-fatal, cleanup only):', readErr.message);
        }

        try {
            const bucket = getStorage().bucket();
            const file   = bucket.file(storagePath);

            await file.save(fileBuffer, { contentType: mimeType });

            // Use a permanent download-token URL scoped to the retention window. We deliberately do
            // NOT use a v4 signed URL: GCS caps v4 expiry at 7 DAYS, so the old 365-day request threw
            // on every ingest and silently fell through to this same token path anyway — and a real
            // 7-day URL would 403 on huddles still within the 3-month retention window. Huddles
            // auto-prune at 3 months (pruneOldHuddles), so a token URL that lives for the retention
            // window is the correct fit. (This said reads on the collection were "open, matching the
            // calendar's no-auth model" — true until v23.18, when they closed to a member, the admin
            // or the PIN viewer. The FILE behind this URL is still a bearer URL — ARCHITECTURE.md
            // EXC-007 — which is what getDocumentUrl's short-lived links narrow.) The bucket segment
            // matches isSafeStorageUrl's allowlist.
            const downloadToken = crypto.randomUUID();
            await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: downloadToken } });
            const encodedPath = encodeURIComponent(storagePath);
            const storageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${downloadToken}`;

            // ---- Convert DOCX to HTML for in-app viewing ----
            // mammoth converts the Word document to clean HTML at upload time so the
            // client never needs to download the raw DOCX or rely on an external viewer.
            // The HTML is stored in Firestore alongside the storage URL.
            // PDF files are opened natively by Chrome — no conversion needed.
            //
            // NOT FOR A LARGE .docx (functions-core-3). Mammoth inlines every picture as base64, so a
            // file of one megabyte already converts to ~1.4 million characters, seven times the cap
            // below, and one near the upload cap costs a further 100–200 MiB at its peak — all thrown
            // away. Over MAX_DOCX_CONVERT_BYTES the file is stored and offered as a file, exactly as
            // after a failed conversion.
            let htmlContent = null;
            if (isDocx && fileBuffer.length > MAX_DOCX_CONVERT_BYTES) {
                console.log(`[ingestHuddle] DOCX of ${fileBuffer.length} bytes — too large for its HTML to be kept; not converting`);
            } else if (isDocx) {
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
                uploadedAt: FieldValue.serverTimestamp(),
                uploadedBy: 'power-automate',
            };
            if (htmlContent !== null) firestoreDoc.htmlContent = htmlContent;
            // Write the metadata AND learn what it replaced ATOMICALLY (Finding #6). The old flow read
            // the doc up front (check) then, separately, notified when that read said 'absent' (act) —
            // a check-then-act race: two concurrent Power Automate runs for the same date both read
            // "absent" before either wrote, so BOTH fanned out a push. A transaction serialises them —
            // whichever commits first sees what was there before it and owns the notify; the other
            // sees the first one's upload and suppresses. The transaction's own retry replaces the
            // manual commit-ambiguous re-issue (the set is idempotent, so an internal retry recomputes
            // against the latest committed state — if a concurrent run wrote the doc meanwhile, the
            // retry sees ITS upload and we don't double-notify).
            //
            // READ THAT NARROWLY (v22.13). What makes the retry safe is that it happens INSIDE the
            // transaction, which re-reads and recomputes; idempotence alone does not make a rewrite
            // safe, and generalising this sentence is how you get the opposite. The browser side is
            // the proof: `upload-commit.js` exists because a commit-ambiguous metadata write was
            // re-issued outside any transaction, and an equally idempotent `set` then overwrote a
            // competing upload's file reference. Same operation, no transaction, real data loss.
            // Do not cite this comment when reasoning about a write that is not in one.
            /** @type {{ existed: boolean, replacedBy: any }} */
            let written = { existed: false, replacedBy: null };
            const huddleRef = getFirestore().collection('huddles').doc(date);
            try {
                written = await getFirestore().runTransaction(async tx => {
                    const snap = await tx.get(huddleRef);
                    // WHO wrote what this replaces is what separates a re-send from a new arrival.
                    const before = { existed: snap.exists, replacedBy: snap.exists ? (snap.data() || {}).uploadedBy : null };
                    tx.set(huddleRef, firestoreDoc);
                    return before;
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
            // WHETHER TO ANNOUNCE (functions-core-1, 10 Nov 2026). Two questions, both needed:
            //
            //  1. Is this a NEW arrival? Yes for a first upload under the date. No when it replaces
            //     this flow's OWN earlier upload — a retry, or a concurrent double-run — which used to
            //     fan out a second push to everyone for one Huddle. But YES when it replaces a HAND
            //     upload: the card files under today and this flow files under the day received, so a
            //     Huddle uploaded by hand this morning shares its date with tonight's automatic one —
            //     the next day's plan, which nobody would otherwise be told about. The price is one
            //     extra buzz on the rare day the flow delivers late a Huddle already uploaded by hand
            //     (the shared tag replaces the first notice rather than stacking). An unknown writer —
            //     a document with no `uploadedBy` — stays silent, as before.
            //  2. Is it the LATEST? A back-filled older date is kept, and announcing it as "Latest
            //     Huddle" would open the newer one staff already had (isLatestOfKind).
            const newArrival = !written.existed
                || (typeof written.replacedBy === 'string' && written.replacedBy !== '' && written.replacedBy !== 'power-automate');
            if (!newArrival) {
                console.log(`[ingestHuddle] Re-send / concurrent duplicate of this flow's own upload for ${date} — not re-notifying`);
            } else if (!(await isLatestOfKind('huddles', date))) {
                console.log(`[ingestHuddle] ${date} is older than the latest Huddle — stored, not announced as "Latest"`);
            } else {
                try {
                    await sendHuddlePushNotifications(date, VAPID_PRIVATE_KEY);
                } catch (pushErr) {
                    console.warn('[ingestHuddle] Push notifications failed (non-fatal):', pushErr.message);
                }
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
 * from the manual upload card on operations.html. It announces only a hand
 * upload, and only when that date is now the latest Huddle (isLatestOfKind).
 *
 * Re-uploads for the same date (setDoc overwrite) are UPDATE events, not
 * CREATE events, so a hand correction never re-notifies.
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

        // Manual admin upload — fire push from here (ingestHuddle is not involved), unless it is a
        // back-fill: an older date announced as "Latest Huddle" would open the newer one.
        if (!(await isLatestOfKind('huddles', date))) {
            console.log(`[onHuddleCreated] ${date} is older than the latest Huddle — not announced as "Latest"`);
            return;
        }
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
// = UPDATE) does not re-notify; and a back-filled OLDER date is not announced, because
// "Latest …" would open the newer one (isLatestOfKind).
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
        if (!(await isLatestOfKind('circulars', date))) {
            console.log(`[onCircularCreated] ${date} is older than the latest Circular — not announced as "Latest"`);
            return;
        }
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
        if (!(await isLatestOfKind('newsletters', date))) {
            console.log(`[onNewsletterCreated] ${date} is older than the latest Newsletter — not announced as "Latest"`);
            return;
        }
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
// and newsletters keep 6 months (browser-side pruneOldDocs, doc-retention.js); huddles are higher-volume and
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
    // 3 Mar), which would over-prune by a few days. Mirrors pruneOldDocs in
    // doc-retention.js (the browser circular/newsletter prune).
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

    const db     = getFirestore();
    const bucket = getStorage().bucket();
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

// ============================================================================
// sendPayReminderNotification — scheduled pay cutoff reminder
// ============================================================================
/**
 * Runs daily at 08:00 London time. On pay cutoff Saturdays (the Saturday before
 * payday), sends a push notification to the devices of CEA and CES members — the
 * grades the Pay Calculator prices — reminding them to enter their hours in it.
 * This decides WHEN; who it reaches, and why it is targeted, is ./pay-reminder.js.
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
            // midnight. sendPayReminder derives the ?payday= deep link via toISOString();
            // a local-midnight Date only yields the right UTC day because Cloud Run pins TZ=UTC,
            // and this file's convention (isPayCutoffDay, pruneOldHuddles) is TZ-independence.
            const payday = new Date(Date.UTC(year, month, day, 12));
            payday.setUTCDate(payday.getUTCDate() + 6);
            console.log(`[payReminder] Cutoff day — sending pay reminder`);
            await sendPayReminder({ payday, roster: rosterMembers, vapidPrivate: VAPID_PRIVATE_KEY,
                vapidPublic: VAPID_PUBLIC_KEY, STAFF_SITE_URL });
        } catch (err) {
            console.error('[payReminder] Unhandled error:', err);
            throw err;
        }
    }
);

// ============================================================================
// sendTimetableReminder — the evening before Chiltern's timetable change (v24.94)
// ============================================================================
/**
 * Runs daily at 18:00 London time and sends on ONE evening: the day before TIMETABLE_CHANGE, when
 * every subscribed device is told that the times change from Sunday and the tap lands on the Trains
 * page. Daily with a date guard rather than a yearly cron, so a forgotten function cannot fire on
 * the same calendar day of some later year; the next timetable change moves the one constant.
 * A broadcast by design — the question in .claude/rules/notifications.md ("would I be happy for all
 * 50 staff to read this?") answers itself for a timetable every member will be asked about.
 */
const TIMETABLE_CHANGE = Object.freeze({ year: 2026, month: 11, day: 13 });   // Sunday 13 December 2026 (month 0-based)
// The words the push carries come from the constant (v24.96): "13 December" was typed beside it, so
// moving the one constant would have moved the guard and not the sentence. documents-endpoints.test.mjs
// also holds this date equal to trains-data.js's CHANGE_DATE, and to a Sunday (the headline says so).
const MONTH_WORDS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TIMETABLE_CHANGE_WORDS = `${TIMETABLE_CHANGE.day} ${MONTH_WORDS[TIMETABLE_CHANGE.month]}`;
const sendTimetableReminder = onSchedule(
    {
        schedule:  '0 18 * * *',
        timeZone:  'Europe/London',
        region:    'europe-west2',
        secrets:   [VAPID_PRIVATE_KEY],
    },
    async () => {
        try {
            const { year, month, day } = nowInLondon();
            const eve = new Date(Date.UTC(TIMETABLE_CHANGE.year, TIMETABLE_CHANGE.month, TIMETABLE_CHANGE.day - 1));
            if (year !== eve.getUTCFullYear() || month !== eve.getUTCMonth() || day !== eve.getUTCDate()) {
                console.log('[timetable] Not the evening before the change — skipping');
                return;
            }
            setupWebPush(VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY);
            await fanOutPush(buildPushPayload({
                feature: 'timetable',
                body:    `Chiltern’s times change on ${TIMETABLE_CHANGE_WORDS}. Tap to see what changes at Marylebone.`,
                baseUrl: STAFF_SITE_URL,
                url:     `${STAFF_SITE_URL}/trains.html`,
            }), '[timetable]');
            console.log('[timetable] Timetable reminder sent');
        } catch (err) {
            console.error('[timetable] Unhandled error:', err);
            throw err;
        }
    }
);

    /**
     * POST /getDocumentUrl  — a SHORT-LIVED URL for the latest document of one kind.
     *
     * ── WHY THIS ENDPOINT EXISTS (v24.16, owner decision 19 Sep 2026) ──────────────────────────
     *
     * The three documents have always been opened through the PERMANENT tokenised download URL in
     * their Firestore document, which bypasses `storage.rules` and outlives any access change.
     * `AUTH_PLAN.md` §5 costs four ways out; the owner chose this one, on two facts only they had:
     * the documents ARRIVE as `.docx`, and a Circular is a designed document that must not be
     * flattened into HTML. Both of the routes that would have removed Microsoft entirely therefore
     * cost either fidelity or a manual export on every weekly issue.
     *
     * So the Office viewer stays and the URL it is handed becomes short-lived. That bounds the leak
     * without changing one thing a member sees or one step an admin takes.
     *
     * ── FIVE PROPERTIES, EACH LOAD-BEARING ────────────────────────────────────────────────────
     *
     * 1. THE CALLER NAMES A KIND, NEVER A PATH. `resolveKind` answers from a frozen allowlist; the
     *    collection, the document and the storage path are all resolved HERE. An endpoint that
     *    signs what it is told is an arbitrary-read hole into the whole bucket, and that is the one
     *    mistake this design cannot make.
     * 2. THE DOOR MIRRORS `firestore.rules`. `mayReceiveDocumentUrl` is the same three claims the
     *    read rule allows, pinned to the rules text by `doc-url-core.test.mjs`. If this were more
     *    permissive it would be a way to read a document the rules refuse.
     * 3. `checkRevoked: true`. A member who has been disabled must not keep minting URLs for up to
     *    an hour on a cached token — the same reasoning `setupRosterAuth` records.
     * 4. IT SIGNS THE LATEST, exactly as the viewer opens the latest. Nothing is taken from the
     *    caller about WHICH document, so there is no id to tamper with.
     * 5. AND THE PATH IS BOUND TO THE KIND (v24.18). Properties 1 and 4 mean the caller cannot
     *    choose a document; this one means a document cannot choose a FILE outside its own
     *    collection. The signer bypasses `storage.rules` and will sign whatever object it is
     *    handed, so a `circulars` doc carrying `roster/…` would be this server turning one field
     *    into a real read of something else. `firestore.rules` now refuses to store such a path and
     *    `isSignablePathForKind` refuses to act on one — the second layer matters because the first
     *    cannot reach a document written before it existed.
     *
     * ⚠️ DEPLOY PREREQUISITE — this endpoint cannot work without an IAM grant. `getSignedUrl` needs
     * to sign as the runtime service account, which on Cloud Functions means that account holds
     * `roles/iam.serviceAccountTokenCreator` ON ITSELF. Without it every call fails at the signing
     * line with a permission error, and the client must fall back to the stored URL rather than
     * show a member a dead button. RECOVERY_RUNBOOK.md records the grant.
     *
     * Request:  POST { "kind": "huddle" | "circular" | "newsletter" }, Authorization: Bearer <ID token>
     * Success:  200 { url, expiresAt, fileType, storagePath }   (storagePath: the file signed — see below)
     * Refusals: 405 method · 401 no/!valid token · 403 no door · 400 unknown kind
     *           404 nothing published yet · 503 signing unavailable (the IAM case above)
     */
    const getDocumentUrl = onRequest(
        {
            region:         'europe-west2',
            timeoutSeconds: 30,
            cors:           ADMIN_FUNCTION_ORIGINS,
        },
        async (req, res) => {
            if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

            const bearer = bearerToken(req);
            let claims;
            try {
                // checkRevoked — property 3 above.
                claims = await getAuth().verifyIdToken(bearer, true);
            } catch (_) {
                return res.status(401).json({ error: 'Unauthorised' });
            }
            if (!mayReceiveDocumentUrl(claims)) {
                return res.status(403).json({ error: 'Forbidden' });
            }

            // kindFromBody, not `req.body.kind` — an unparsed body (no JSON Content-Type) would
            // otherwise be refused as an unknown kind, which is the one thing it is not.
            const kind = resolveKind(kindFromBody(req.body, req.rawBody));
            if (!kind.ok) return res.status(400).json({ error: 'Unknown document kind' });

            // The LATEST of that kind — the same query, on the `date` field, the viewer opens with.
            let snap;
            try {
                snap = await getFirestore().collection(kind.collection)
                    .orderBy('date', 'desc').limit(1).get();
            } catch (err) {
                console.error(`[getDocumentUrl] ${kind.kind} lookup failed:`, err);
                return res.status(503).json({ error: 'Could not look up the document' });
            }
            if (snap.empty) return res.status(404).json({ error: `No ${kind.label} has been published yet` });

            const data = snap.docs[0].data() || {};
            // FOR THIS KIND — not merely well-formed. The signer bypasses storage.rules, so a
            // circulars document carrying a huddles path (or any other) must not be signed: see
            // doc-url-core.js for why the kind is an argument rather than an assumption.
            if (!isSignablePathForKind(kind.kind, data.storagePath)) {
                // The server wrote this path; a bad one is our defect, not the caller's. Say so in
                // the log and refuse — never hand an unchecked path to the signer.
                console.error(`[getDocumentUrl] ${kind.kind} ${snap.docs[0].id} storagePath is missing or not a ${kind.collection}/ path`);
                return res.status(503).json({ error: 'That document cannot be opened right now' });
            }

            const expiresAt = signedUrlExpiry(Date.now());
            let url;
            try {
                [url] = await getStorage().bucket().file(data.storagePath)
                    .getSignedUrl({ action: 'read', expires: expiresAt });
            } catch (err) {
                // Overwhelmingly the IAM grant in the prerequisite above. 503 (not 500) so the
                // client reads it as "try the old way", which is what its fallback is for.
                console.error('[getDocumentUrl] signing failed — is serviceAccountTokenCreator granted?', err);
                return res.status(503).json({ error: 'Document signing unavailable' });
            }

            // ── THE DOOR, NEVER THE PERSON (v24.18, external review of v24.17) ────────────────
            // This line named the member. Once the client calls this endpoint, that would make
            // every document open a NAMED server-side access trail — at the exact moment the app
            // shipped a privacy feature, and in direct contradiction of how it treats the same
            // question elsewhere: `recordOpen` sends an increment and deliberately keeps who did it
            // on the device. What is worth knowing here is which door was used and whether signing
            // works, and both survive without an identity. If named document auditing is ever
            // WANTED, that is a decision to take deliberately and write down, not to inherit from
            // a debug log.
            const door = claims.admin === true ? 'admin' : (memberNameFromClaims(claims) ? 'member' : 'pin');
            console.log(`[getDocumentUrl] signed ${kind.kind} for a ${door} `
                + `(${SIGNED_URL_TTL_MS / 60000} min)`);
            // ── THE FILE IT SIGNED TRAVELS WITH THE URL (v24.33, external review of v24.32) ──
            // The client reads "the latest" from Firestore and this endpoint reads it again, so an
            // upload landing between the two reads left the client holding document A with a url
            // for document B. `storagePath` is versioned per upload (`<kind>/<date>-<uploadId>`), so
            // it names the exact FILE — which a date or document id would not, because a same-day
            // re-upload keeps the id and replaces the file. The client uses the url only when this
            // matches the document it is holding. It is not new information: the client already
            // reads the same field from the document it holds.
            return res.status(200).json({ url, expiresAt, fileType: data.fileType || null, storagePath: data.storagePath });
        },
    );

    /**
     * POST /rotateDocumentLinks — a NEW key for the permanent link of every stored Huddle, Circular
     * and Newsletter file, so every copy of an old link stops opening it (owner, 12 Nov 2026 —
     * ARCHITECTURE.md EXC-007). Admin only. The work, its three steps and what it leaves alone are
     * ./doc-link-rotation.js; this handler is the door and the log line.
     *
     * A PREVIEW unless the body says `rotate: true`, exactly: a missing, malformed or unparsed body
     * only counts. The card asks for the preview first and shows it before offering the real run.
     *
     * Request:  POST { "rotate": true } to change anything, Authorization: Bearer <ID token>
     * Success:  200 RotationReport (doc-link-rotation.js)
     * Refusals: 405 method · 401 no/invalid/revoked token · 403 not admin
     *           503 { changed: false } the records or files could not be read — and then NOTHING
     *           changed, because the read is finished before the first write and every write is
     *           caught per file. A 503 WITHOUT `changed: false` is the platform's, and proves nothing
     */
    const rotateDocumentLinks = onRequest(
        {
            region:         'europe-west2',
            // A few hundred files at four at a time is well under a minute; the margin is for a slow
            // Storage day, so a run is never cut off by the platform halfway through a file.
            timeoutSeconds: 300,
            cors:           ADMIN_FUNCTION_ORIGINS,
        },
        async (req, res) => {
            if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
            if (!(await requireAdmin(req, res, 'rotateDocumentLinks'))) return;
            const rotate = readJsonBody(req).rotate === true;
            let report;
            try {
                report = await rotateLinks({
                    bucket: getStorage().bucket(), db: getFirestore(), rotate,
                    newKey: () => crypto.randomUUID(),
                });
            } catch (err) {
                console.error('[rotateDocumentLinks] could not read the documents — nothing was changed:', err);
                // `changed: false` is the card's to read. The platform answers a 503 of its own when an
                // instance dies, which may be halfway through the writes, so only this body may say so.
                return res.status(503).json({ error: 'Couldn’t read the documents, so nothing was changed', changed: false });
            }
            // Counts only: the admin who pressed it is the only possible caller, and the paths of any
            // failures travel back in the answer, where the admin can act on them.
            console.log(`[rotateDocumentLinks] ${rotate ? 'rotated' : 'previewed'}: ${report.files} files, `
                + `${report.linked} linked, ${report.unlinkedWithKey} unlinked with a key, ${report.held} held; `
                + `rotated ${report.rotated}, cleared ${report.cleared}, changed ${report.changedDuringRun}, `
                + `failed ${report.failed.length}`);
            return res.status(200).json(report);
        },
    );

    return { ingestHuddle, getDocumentUrl, rotateDocumentLinks, onHuddleCreated, onCircularCreated, onNewsletterCreated, sendPayReminderNotification, sendTimetableReminder };
}

module.exports = { buildDocumentEndpoints };
