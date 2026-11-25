/**
 * functions/huddle-ingest.js — ingestHuddle, the Daily Huddle upload from Power Automate, server to
 * server (bearer HUDDLE_SECRET). Split out of ./documents.js, which builds it and returns it with the
 * rest of the document domain, so index.js re-exports it under the same name and the deploy surface
 * is unchanged.
 *
 * A factory for documents.js's reasons (its header): the shared infrastructure arrives as arguments.
 * So do the two things this endpoint shares with the Huddle's create trigger, `isLatestOfKind` and
 * `sendHuddlePushNotifications`, which stay in documents.js beside HUDDLE_PUSH_PAUSED — one send,
 * one switch, whichever door the Huddle came in by. What happens to a Huddle once it is stored — the
 * 3-month prune and what it may delete — is ./huddle-retention.js.
 */

const { onRequest } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const crypto = require('crypto');
const { parseStrictIsoDate, fileSignatureMatches } = require('./roster-parse-helpers');
const { pruneOldHuddles } = require('./huddle-retention');
const { headerText } = require('./request-helpers');
const { fieldsOf } = require('./caught');
const { REGION } = require('./region');

/**
 * Build the ingestHuddle endpoint. Called once, from buildDocumentEndpoints.
 * @param {object} deps
 * @param {import('firebase-functions/params').SecretParam} deps.HUDDLE_SECRET
 * @param {import('firebase-functions/params').SecretParam} deps.VAPID_PRIVATE_KEY
 * @param {(req: any, res: any, logTag: string) => Promise<string|null>} deps.readRawBody
 *        shared streaming body reader (also used by parseRosterPDF); null once it has answered
 * @param {() => { year: number, month: number, day: number }} deps.nowInLondon
 *        TZ-independent London calendar date (a 0-based month, as `Date` takes it)
 * @param {(err: unknown) => boolean} deps.isRetriableFirestoreError  commit-ambiguous classifier
 * @param {number}   deps.MAX_FILE_BYTES
 * @param {number}   deps.MAX_HUDDLE_HTML_CHARS
 * @param {(collectionName: string, date: string) => Promise<boolean>} deps.isLatestOfKind
 * @param {(huddleDate: string, vapidPrivate: any) => Promise<void>} deps.sendHuddlePushNotifications
 */
function buildIngestHuddle({
    HUDDLE_SECRET, VAPID_PRIVATE_KEY, readRawBody, nowInLondon, isRetriableFirestoreError,
    MAX_FILE_BYTES, MAX_HUDDLE_HTML_CHARS, isLatestOfKind, sendHuddlePushNotifications,
}) {

    // The largest .docx the ingest converts to HTML (functions-core-3). Generous on purpose: an
    // ordinary text Huddle is tens of kilobytes, and a file this size whose HTML still fitted
    // MAX_HUDDLE_HTML_CHARS would have to be almost entirely content Word does not render.
    const MAX_DOCX_CONVERT_BYTES = 2 * 1024 * 1024;

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
        region:        REGION,
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
        // A BLANK OR MALFORMED SECRET IS A DEPLOYMENT FAULT, answered 503 before any compare (Nov 2026
        // review — as the retired `unlockCalendarViewer` treated its PIN). Unchecked, an empty secret made the
        // expected header the bare "Bearer ", which a caller sending exactly that would match: the door
        // to the staff-wide Huddle broadcast open to anybody with the URL. Trimmed, as the PIN was: a
        // newline picked up when the secret was piped in can never arrive in a header, so it could only
        // ever refuse the real caller. A control character left inside it cannot arrive in one either.
        const secret = String(HUDDLE_SECRET.value() || '').trim();
        if (!secret || [...secret].some(c => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)) {
            console.error(`[ingestHuddle] HUDDLE_SECRET is ${secret ? 'malformed' : 'not configured'}`);
            res.status(503).json({ error: 'Huddle ingest is not configured' });
            return;
        }
        const authHeader = req.headers['authorization'] || '';
        const expected   = `Bearer ${secret}`;
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
        const date     = headerText(req, 'x-huddle-date').trim();
        const filename = headerText(req, 'x-huddle-filename').trim();

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
        // readRawBody size-caps it — a length check on the already-buffered body (request-helpers.js says why).
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
            console.warn('[ingestHuddle] Could not read previous huddle metadata (non-fatal, cleanup only):', fieldsOf(readErr).message);
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
                    console.warn('[ingestHuddle] mammoth conversion failed:', fieldsOf(mammothErr).message);
                }
            }

            // ---- Write Firestore metadata document ----
            /** @type {{ date: string, storageUrl: string, storagePath: string, fileType: string,
             *           uploadedAt: import('firebase-admin/firestore').FieldValue, uploadedBy: string, htmlContent?: string }} */
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
            //
            // A RE-RUN THAT FINDS ITS OWN RECORD WRITES NOTHING (13 Nov 2026). Firestore also runs the
            // transaction again after a commit whose ANSWER was lost, and that attempt reads the record
            // the first one wrote. Setting it again was not harmless: Operations → Document links may
            // have moved the record's link onto a new key in between, and writing the first link back
            // left it naming a key that run then took away — a dead stored link (doc-link-rotation.js).
            // Nobody else writes this path, whose uploadId is this request's, so a record naming it is
            // this ingest's own, whatever key it carries: it is left exactly as it is. The answer is what
            // the attempt that wrote it saw, so a first upload is still announced — before, the re-run
            // read its own record as a re-send and stayed silent. When no attempt after the lost answer
            // succeeds, a read after the transaction finds the record the same way (the catch below).
            /** @type {{ existed: boolean, replacedBy: any }} */
            let written = { existed: false, replacedBy: null };
            /** What the last attempt that WROTE saw before writing: a re-run's answer (above), and the catch's. @type {{ existed: boolean, replacedBy: any }|null} */
            let seenByWrite = /** @type {{ existed: boolean, replacedBy: any }|null} */ (null);
            const huddleRef = getFirestore().collection('huddles').doc(date);
            try {
                written = await getFirestore().runTransaction(async tx => {
                    const snap = await tx.get(huddleRef);
                    const cur = snap.exists ? (snap.data() || {}) : null;
                    // WHO wrote what this replaces is what separates a re-send from a new arrival.
                    const before = { existed: snap.exists, replacedBy: cur ? cur.uploadedBy : null };
                    // This ingest's own earlier attempt, committed: the same path, any key (above).
                    // (`?? before` cannot apply: only an attempt that wrote can have put this path here.)
                    if (cur && cur.storagePath === storagePath) return seenByWrite ?? before;
                    seenByWrite = before;
                    tx.set(huddleRef, firestoreDoc);
                    return before;
                });
            } catch (metaErr) {
                if (!isRetriableFirestoreError(metaErr)) {
                    // Definite non-commit — safe to delete the just-uploaded object so it isn't orphaned.
                    await bucket.file(storagePath).delete().catch(() => {});
                    throw metaErr;
                }
                // A RETRIABLE ERROR CAN FOLLOW A COMMIT THAT LANDED (13 Nov 2026). The transaction ran out of
                // retries, and the attempt that committed may have lost its answer with every retry after it
                // failing too. Answering 500 then left a live Huddle unannounced: Power Automate's retry is a
                // new request, which finds this flow's own record and stays silent as a re-send. So READ, as
                // the browser upload does (upload-commit.js). A record naming this request's storagePath means
                // the commit landed — its uploadId is this request's, so nobody else wrote it — and the ingest
                // carries on with what that attempt saw. No record, another path or a failed read is no
                // answer: deleting the object could orphan a record that did commit (staff tap a 404), so it
                // is LEFT (the next upload's cleanup or pruneOldHuddles supersedes it) and the error rethrown.
                // A Huddle now goes unannounced only if Firestore stays unreachable through the retries AND
                // this read.
                const live = await huddleRef.get().then(snap => snap.data(), () => null);   // null: unread
                if (!live || live.storagePath !== storagePath) {
                    console.warn(`[ingestHuddle] metadata transaction failed (${fieldsOf(metaErr).code}) and ${live === null ? 'the record could not be read back' : 'the record does not name this upload'} — leaving new object in place (commit-ambiguous), not deleting`);
                    throw metaErr;
                }
                console.warn(`[ingestHuddle] metadata transaction failed (${fieldsOf(metaErr).code}), but its commit had landed — carrying on`);
                // Only an attempt that wrote can have put this path there, so seenByWrite is set.
                written = /** @type {{ existed: boolean, replacedBy: any }} */ (seenByWrite);
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
            // Instead pruneOldHuddles (huddle-retention.js) reclaims it once the date ages out of the
            // retention window (v16.89) — and since v25.89 only through `sweepHuddleOrphans`, because "no ingest can be racing it"
            // proved untrue: a back-dated upload can land on an expired date while the prune runs.

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
                    console.warn('[ingestHuddle] Push notifications failed (non-fatal):', fieldsOf(pushErr).message);
                }
            }

            // Bound the collection: huddles are daily and would otherwise grow without limit.
            // Best-effort prune of anything older than 3 months. Awaited (not fire-and-forget)
            // so it completes within the request — Cloud Run may reclaim the container the
            // moment res.json() returns. Never blocks success: failures are swallowed.
            try {
                await pruneOldHuddles(date, { db: getFirestore(), bucket: getStorage().bucket(), nowInLondon });
            } catch (pruneErr) {
                console.warn('[ingestHuddle] Huddle prune failed (non-fatal):', fieldsOf(pruneErr).message);
            }

            res.status(200).json({ success: true, date, storageUrl });

        } catch (err) {
            console.error('[ingestHuddle] Upload failed:', err);
            res.status(500).json({ error: 'Upload failed — check function logs' });
        }
    }
);

    return ingestHuddle;
}

module.exports = { buildIngestHuddle };
