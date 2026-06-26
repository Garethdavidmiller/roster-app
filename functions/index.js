/**
 * functions/index.js — MYB Roster Firebase Cloud Functions
 *
 * ingestHuddle     — Called by Power Automate when the daily Huddle email arrives.
 *                    Stores the file in Firebase Storage and writes a metadata doc
 *                    to the `huddles` Firestore collection.
 *
 * parseRosterPDF   — Called from the admin page when Gareth uploads a weekly roster PDF.
 *                    Extracts the text, passes it to Claude AI, and returns a list of
 *                    each person's shifts for that week. Does NOT write to Firestore —
 *                    Gareth reviews and approves first, then the browser writes the changes.
 *
 * Secrets required (set once via Google Cloud Console → Secret Manager):
 *   HUDDLE_SECRET       — Bearer token for Power Automate auth
 *   ANTHROPIC_API_KEY   — API key for the Claude AI service
 *   VAPID_PRIVATE_KEY   — Web Push VAPID private key
 *
 * Deploy:
 *   Push any change to functions/ on main — GitHub Actions deploys automatically.
 */

const { onRequest }         = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule }        = require('firebase-functions/v2/scheduler');
const { defineSecret }  = require('firebase-functions/params');
const admin             = require('firebase-admin');
const crypto            = require('crypto');
const { Anthropic }     = require('@anthropic-ai/sdk');
const mammoth           = require('mammoth');
const webpush           = require('web-push');
const {
    normaliseShift,
    buildWeekDates,
    extractAIJson,
    HEADER_TO_INDEX,
    mapColumnHeadersToDates,
    buildSafeEntries,
    applySundayScanCorrections,
    huddleDayLabel,
    isPayCutoffDay,
    nameToEmail,
    nameToPassword,
} = require('./roster-parse-helpers');
const rosterMembers = require('./roster-members.json');

admin.initializeApp();

const HUDDLE_SECRET      = defineSecret('HUDDLE_SECRET');
const ANTHROPIC_API_KEY  = defineSecret('ANTHROPIC_API_KEY');
const VAPID_PRIVATE_KEY  = defineSecret('VAPID_PRIVATE_KEY');


// VAPID public key — safe to expose, matches the private key stored in Secret Manager.
// Staff browsers use this to encrypt push payloads so only this server can read them.
const VAPID_PUBLIC_KEY = 'BDycpNlvciF7kfUv3yxSQ0iRzWdi3BDZipNf-vk7QYaOSsbbIgb5FRSW9GrJlZJlmThoyQrbK0t9sd3hEdmhgSg';

// Staff-facing URL — change here when the domain changes, push payloads update automatically.
const STAFF_SITE_URL = 'https://garethdavidmiller.github.io';

// Set to true to silence all Huddle push notifications (e.g. while the staff
// site is down). See RESTART_NOTIFICATIONS.md for the re-enable checklist.
const HUDDLE_PUSH_PAUSED = true;

/**
 * Returns {year, month(0-based), day} in London local time, derived directly from
 * Intl.DateTimeFormat parts so the result is never dependent on the server's TZ setting.
 * @returns {{ year: number, month: number, day: number }}
 */
function nowInLondon() {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    return {
        year:  +parts.find(p => p.type === 'year').value,
        month: +parts.find(p => p.type === 'month').value - 1,
        day:   +parts.find(p => p.type === 'day').value,
    };
}

// Claude model used by parseRosterPDF. Pin here so version bumps are explicit and grep-able.
const CLAUDE_MODEL = 'claude-sonnet-4-6';

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
exports.ingestHuddle = onRequest(
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

        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            res.status(400).json({ error: 'Invalid date format — expected YYYY-MM-DD' });
            return;
        }
        const parsedDate = new Date(date + 'T12:00:00Z');
        if (isNaN(parsedDate.getTime())) {
            res.status(400).json({ error: 'Invalid date value — month or day out of range' });
            return;
        }
        // Strict calendar check — JS normalises impossible dates (e.g. 2026-02-30 → 2026-03-02)
        // instead of returning NaN, so the isNaN check above is not sufficient on its own.
        const [dYear, dMonth, dDay] = date.split('-').map(Number);
        if (parsedDate.getUTCFullYear() !== dYear || parsedDate.getUTCMonth() + 1 !== dMonth || parsedDate.getUTCDate() !== dDay) {
            res.status(400).json({ error: 'Invalid date value — month or day out of range' });
            return;
        }

        // ---- Read raw body ----
        // The file arrives as a base64 plain-text body, bypassing JSON body-size limits.
        // Firebase Functions runtime exposes req.rawBody; fall back to reading the stream.
        let base64Content;
        try {
            if (req.rawBody) {
                base64Content = req.rawBody.toString('utf8').trim();
            } else {
                const chunks = [];
                await new Promise((resolve, reject) => {
                    req.on('data', chunk => chunks.push(chunk));
                    req.on('end', resolve);
                    req.on('error', reject);
                });
                base64Content = Buffer.concat(chunks).toString('utf8').trim();
            }
        } catch (err) {
            console.error('[ingestHuddle] Failed to read body:', err.message);
            res.status(400).json({ error: 'Could not read request body' });
            return;
        }

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
        let fileBuffer;
        try {
            fileBuffer = Buffer.from(base64Content, 'base64');
        } catch (err) {
            res.status(400).json({ error: 'Body must be valid base64' });
            return;
        }

        if (fileBuffer.length === 0) {
            res.status(400).json({ error: 'Decoded file is empty' });
            return;
        }

        if (fileBuffer.length > 20 * 1024 * 1024) {
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

        // ---- Upload to Firebase Storage ----
        const storagePath = `huddles/${date}.${fileType}`;

        try {
            const bucket = admin.storage().bucket();
            const file   = bucket.file(storagePath);

            await file.save(fileBuffer, { contentType: mimeType });

            // Prefer a time-limited signed URL (v4, 1 year). Falls back to a
            // permanent download token if the service account lacks the
            // iam.serviceAccountTokenCreator role needed to sign URLs.
            let storageUrl;
            try {
                // 1-year expiry: after 365 days this URL returns 403. Staff viewing an
                // archive huddle older than one year will see an access error. The
                // Firestore document remains, but the file itself must be re-uploaded.
                const [signedUrl] = await file.getSignedUrl({
                    version: 'v4',
                    action:  'read',
                    expires: Date.now() + 365 * 24 * 60 * 60 * 1000,
                });
                storageUrl = signedUrl;
            } catch (signErr) {
                console.warn('[ingestHuddle] getSignedUrl unavailable, falling back to download token:', signErr.message);
                const downloadToken = crypto.randomUUID();
                await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: downloadToken } });
                const encodedPath = encodeURIComponent(storagePath);
                storageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${downloadToken}`;
            }

            // ---- Convert DOCX to HTML for in-app viewing ----
            // mammoth converts the Word document to clean HTML at upload time so the
            // client never needs to download the raw DOCX or rely on an external viewer.
            // The HTML is stored in Firestore alongside the storage URL.
            // PDF files are opened natively by Chrome — no conversion needed.
            let htmlContent = null;
            if (isDocx) {
                try {
                    const result = await mammoth.convertToHtml({ buffer: fileBuffer });
                    htmlContent  = result.value || null;
                    console.log(`[ingestHuddle] DOCX converted to HTML (${htmlContent ? htmlContent.length : 0} chars)`);
                    // Cap at 200 KB — a Huddle is a short daily briefing. A larger HTML blob
                    // indicates something unexpected (a giant document, a conversion anomaly).
                    // Store the file in Storage and let staff download it directly instead.
                    if (htmlContent && htmlContent.length > 200_000) {
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
                fileType,
                uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
                uploadedBy: 'power-automate',
            };
            if (htmlContent !== null) firestoreDoc.htmlContent = htmlContent;
            await admin.firestore().collection('huddles').doc(date).set(firestoreDoc);

            console.log(`[ingestHuddle] Uploaded ${fileType} for ${date} (${fileBuffer.length} bytes)`);

            // Send push notifications directly here — before res.json() so Cloud Run
            // doesn't reclaim the container before the fan-out completes.
            // The onHuddleCreated Firestore trigger handles manual admin uploads separately;
            // it skips Power Automate uploads (uploadedBy === 'power-automate') to avoid
            // double-notifying. This direct call is the authoritative path for PA uploads.
            try {
                await sendHuddlePushNotifications(date, VAPID_PRIVATE_KEY);
            } catch (pushErr) {
                console.warn('[ingestHuddle] Push notifications failed (non-fatal):', pushErr.message);
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
exports.onHuddleCreated = onDocumentCreated(
    {
        document: 'huddles/{date}',
        secrets:  [VAPID_PRIVATE_KEY],
        region:   'europe-west2',
    },
    async event => {
        const date       = event.params.date;
        const uploadedBy = event.data.data().uploadedBy || '';

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

// Module-level flag so setVapidDetails() is only called once per warm instance.
// Secrets are not available at module init, so we defer to first call.
let _vapidConfigured = false;

/** Configures web-push VAPID credentials once per process lifetime. */
function setupWebPush(vapidPrivate) {
    if (_vapidConfigured) return;
    webpush.setVapidDetails(
        'mailto:noreply@myb-roster.web.app',
        VAPID_PUBLIC_KEY,
        vapidPrivate.value(),
    );
    _vapidConfigured = true;
}

/**
 * Fan out Web Push notifications to all subscribed devices for a given JSON payload.
 * Dead subscriptions (HTTP 410/404/401) are silently deleted from Firestore.
 *
 * @param {object} payload   Object that will be JSON.stringify'd — must include title, body, url, tag
 * @param {string} logTag    Short string for console log lines, e.g. '[push]'
 */
async function fanOutPush(payload, logTag) {
    const snapshot = await admin.firestore().collection('pushSubscriptions').get();
    if (snapshot.empty) {
        console.log(`${logTag} No subscriptions — skipping`);
        return;
    }

    const payloadStr = JSON.stringify(payload);
    const sends = snapshot.docs.map(async docSnap => {
        const { endpoint, keys } = docSnap.data();
        try {
            await webpush.sendNotification({ endpoint, keys }, payloadStr);
        } catch (err) {
            if (err.statusCode === 410 || err.statusCode === 404 || err.statusCode === 401) {
                await docSnap.ref.delete();
                console.log(`${logTag} Removed dead subscription ${docSnap.id}`);
            } else {
                console.warn(`${logTag} Failed for ${docSnap.id}: HTTP ${err.statusCode} — ${err.message}`);
            }
        }
    });

    await Promise.allSettled(sends);
    console.log(`${logTag} Fan-out complete — attempted ${snapshot.size} subscription(s)`);
}

/**
 * Fan out Huddle push notifications.
 * Builds a smart day label in London time:
 *   Same day as huddleDate  → "Today's Huddle is ready"
 *   Day after huddleDate    → "Tomorrow's Huddle is ready"
 *   Any other day           → "Thursday's Huddle is ready" (weekday name)
 *
 * @param {string}       huddleDate    YYYY-MM-DD — the date the huddle is FOR
 * @param {SecretParam}  vapidPrivate  Firebase secret param for VAPID private key
 */
async function sendHuddlePushNotifications(huddleDate, vapidPrivate) {
    if (HUDDLE_PUSH_PAUSED) {
        console.log(`[push] HUDDLE_PUSH_PAUSED=true — skipping notifications for ${huddleDate}. See RESTART_NOTIFICATIONS.md`);
        return;
    }
    setupWebPush(vapidPrivate);

    // Build smart day label — compare huddle date to today in London timezone.
    // nowInLondon() reads parts directly via Intl so the result is independent
    // of the server's local TZ setting (Cloud Run is UTC but the code shouldn't
    // rely on that).
    const { year, month, day } = nowInLondon();
    const dayLabel = huddleDayLabel(huddleDate, new Date(year, month, day));

    await fanOutPush({
        title: 'Marylebone Roster',
        body:  `${dayLabel} Huddle is ready`,
        tag:   'huddle',
        url:   `${STAFF_SITE_URL}/#huddle`,
    }, '[push]');
    console.log(`[push] "${dayLabel} Huddle is ready" sent`);
}

/**
 * Fan out pay reminder push notifications.
 * URL includes ?payday=YYYY-MM-DD so the Pay Calculator opens on the correct period.
 *
 * @param {Date}         payday        The upcoming payday date
 * @param {SecretParam}  vapidPrivate  Firebase secret param for VAPID private key
 */
async function sendPayPushNotifications(payday, vapidPrivate) {
    setupWebPush(vapidPrivate);

    // Use toISOString() (UTC) rather than local-time getters — payday is constructed
    // as midnight UTC so the UTC date is always the correct London date on Cloud Run.
    const paydayISO = payday.toISOString().slice(0, 10);

    const paydayDay = payday.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Europe/London' });
    const paydayFmt = payday.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'Europe/London' });

    await fanOutPush({
        title: `💷 Payday is ${paydayDay}!`,
        body:  `Hours cutoff today — open the Pay Calculator to estimate your ${paydayFmt} pay`,
        tag:   'pay-reminder',
        url:   `${STAFF_SITE_URL}/paycalc.html?payday=${paydayISO}`,
    }, '[payReminder]');
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
exports.sendPayReminderNotification = onSchedule(
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

            const payday = new Date(today);
            payday.setDate(today.getDate() + 6);
            console.log(`[payReminder] Cutoff day — sending pay reminder`);
            await sendPayPushNotifications(payday, VAPID_PRIVATE_KEY);
        } catch (err) {
            console.error('[payReminder] Unhandled error:', err);
            throw err;
        }
    }
);

// ============================================================================
// parseRosterPDF
// ============================================================================
/**
 * POST /parseRosterPDF
 *
 * Called from admin.html when Gareth uploads a weekly roster PDF.
 * Extracts the text from the PDF, sends it to Claude AI with a structured
 * prompt, and returns each recognised staff member's shifts for the week.
 *
 * This function does NOT write anything to Firestore. It just reads and
 * returns. The admin reviews the results in the browser, then approves them,
 * at which point the browser writes the changes to Firestore directly.
 *
 * Request headers:
 *   Authorization:    Bearer <Firebase-ID-token>  (admin custom claim required)
 *   Content-Type:     text/plain
 *   X-Week-Ending:    YYYY-MM-DD  (must be a Saturday — the last day of the roster week)
 *   X-Roster-Type:    cea | ces | dispatcher
 *
 * Request body:
 *   Raw base64-encoded PDF content (same pattern as ingestHuddle — avoids JSON size limits).
 *
 * Success response (200):
 *   {
 *     weekEnding:  "2026-04-05",
 *     rosterType:  "cea",
 *     dates:       ["2026-03-30", ..., "2026-04-05"],   // Sun → Sat
 *     parsed: [
 *       { memberName: "L. Springer", shifts: { "2026-03-30": "05:30-11:30", ... } },
 *       ...
 *     ]
 *   }
 */
exports.parseRosterPDF = onRequest(
    {
        secrets:        [ANTHROPIC_API_KEY],
        region:         'europe-west2',
        cors:           true,
        timeoutSeconds: 120,            // PDF parse + AI call can take up to ~30s
        memory:         '512MiB',       // pdf-parse needs a little headroom
    },
    async (req, res) => {

        // ---- Method check ----
        if (req.method !== 'POST') {
            res.status(405).json({ error: 'Method not allowed' });
            return;
        }

        // ---- Auth: Firebase ID token with admin custom claim ----
        // The browser sends the logged-in user's Firebase ID token.
        // verifyIdToken checks the signature + expiry; the admin claim gates access
        // so only Gareth's account can call this function.
        const authHeader = req.headers['authorization'] || '';
        if (!authHeader.startsWith('Bearer ')) {
            res.status(401).json({ error: 'Unauthorised' });
            return;
        }
        const idToken = authHeader.slice('Bearer '.length);
        let decodedToken;
        try {
            decodedToken = await admin.auth().verifyIdToken(idToken);
        } catch (err) {
            console.warn('[parseRosterPDF] Token verification failed:', err.message);
            res.status(401).json({ error: 'Unauthorised' });
            return;
        }
        if (decodedToken.admin !== true) {
            res.status(403).json({ error: 'Forbidden — admin access required' });
            return;
        }

        // ---- Headers ----
        const weekEnding = (req.headers['x-week-ending']  || '').trim();
        const rosterType = (req.headers['x-roster-type']  || '').trim().toLowerCase();

        if (!weekEnding || !/^\d{4}-\d{2}-\d{2}$/.test(weekEnding)) {
            res.status(400).json({ error: 'Missing or invalid X-Week-Ending header (expected YYYY-MM-DD)' });
            return;
        }
        // Roster weeks always end on Saturday — validate so the day-date mapping is correct.
        // Also apply a strict round-trip calendar check: JS normalises impossible dates
        // (e.g. 2025-02-29 → 2025-03-01) instead of returning NaN, so the format check
        // above is not sufficient on its own to reject an impossible date.
        const weekEndingDate = new Date(weekEnding + 'T12:00:00Z');
        if (weekEndingDate.getUTCDay() !== 6) {
            res.status(400).json({ error: 'X-Week-Ending must be a Saturday' });
            return;
        }
        const [weYear, weMonth, weDay] = weekEnding.split('-').map(Number);
        if (weekEndingDate.getUTCFullYear() !== weYear || weekEndingDate.getUTCMonth() + 1 !== weMonth || weekEndingDate.getUTCDate() !== weDay) {
            res.status(400).json({ error: 'X-Week-Ending is not a valid calendar date' });
            return;
        }
        if (!['cea', 'ces', 'dispatcher'].includes(rosterType)) {
            res.status(400).json({ error: 'X-Roster-Type must be cea, ces, or dispatcher' });
            return;
        }

        // ---- Read raw body ----
        // 20 MB decoded ≈ 27 MB of base64; cap the raw body a little above that so
        // an oversized upload is rejected *during* streaming rather than after the
        // whole thing is buffered + decoded (which could OOM the 512MiB instance).
        const MAX_BODY_BYTES = 28 * 1024 * 1024;
        let base64Content;
        try {
            if (req.rawBody) {
                if (req.rawBody.length > MAX_BODY_BYTES) {
                    res.status(413).json({ error: 'File exceeds the size limit' });
                    return;
                }
                base64Content = req.rawBody.toString('utf8').trim();
            } else {
                const chunks = [];
                let total = 0;
                await new Promise((resolve, reject) => {
                    req.on('data', chunk => {
                        total += chunk.length;
                        if (total > MAX_BODY_BYTES) {
                            req.destroy();
                            reject(new Error('BODY_TOO_LARGE'));
                            return;
                        }
                        chunks.push(chunk);
                    });
                    req.on('end', resolve);
                    req.on('error', reject);
                });
                base64Content = Buffer.concat(chunks).toString('utf8').trim();
            }
        } catch (err) {
            if (err.message === 'BODY_TOO_LARGE') {
                res.status(413).json({ error: 'File exceeds the size limit' });
                return;
            }
            console.error('[parseRosterPDF] Failed to read body:', err.message);
            res.status(400).json({ error: 'Could not read request body' });
            return;
        }

        if (!base64Content) {
            res.status(400).json({ error: 'Request body is empty' });
            return;
        }

        // ---- Validate the PDF ----
        // Strip whitespace, then verify the body is genuinely base64 BEFORE decoding.
        // Buffer.from(..., 'base64') silently ignores invalid characters rather than
        // throwing, so a try/catch around it is dead code — an explicit charset check
        // is the only real guard against garbage being sent to the AI.
        const cleanBase64 = base64Content.replace(/\s/g, '');
        if (cleanBase64.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleanBase64)) {
            res.status(400).json({ error: 'Body must be valid base64' });
            return;
        }
        const pdfBuffer = Buffer.from(cleanBase64, 'base64');

        if (pdfBuffer.length === 0) {
            res.status(400).json({ error: 'Decoded PDF is empty' });
            return;
        }
        if (pdfBuffer.length > 20 * 1024 * 1024) {
            res.status(413).json({ error: 'File exceeds 20 MB limit' });
            return;
        }

        console.log(`[parseRosterPDF] PDF size: ${pdfBuffer.length} bytes`);

        // ---- Build the 7 dates for this week (Sun → Sat) ----
        // weekEnding is always a Saturday (validated above).
        const dates = buildWeekDates(weekEnding);
        // dates[0] = Sunday, dates[6] = Saturday (= weekEnding)

        // ---- Build the staff name list relevant to this roster type ----
        // Staff names come from the teamMembers array that is embedded in the prompt.
        // We only include names relevant to the roster type being parsed, so the AI
        // doesn't accidentally match a CES name in a CEA document (or vice versa).
        //
        // Names are loaded from functions/roster-members.json, which is generated from
        // roster-data.js by scripts/generate-roster-members.mjs. Run that script whenever
        // a staff member joins or leaves. Verified in sync by sw-asset-check.test.mjs.
        const STAFF_NAMES = rosterMembers;

        const relevantNames = STAFF_NAMES[rosterType];

        // ---- Build the Claude prompt ----
        const namesBlock = relevantNames.map(n => `  - ${n}`).join('\n');

        const prompt = `You are reading a weekly staff roster PDF for a UK rail company.
Your job is to extract each staff member's shift for each day of the week.

---
STAFF NAMES TO LOOK FOR (only these — skip anyone else):
${namesBlock}

---
HOW TO READ THE TABLE:

STEP 1 — Read the column headers from left to right.
List each day abbreviation in order, e.g. ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].
Only include days that appear as column headers. Some rosters start on Monday (no Sunday column).
If you can see a "Sun" or "Sunday" column header, include it even if every cell in that column is blank.

STEP 2 — For each staff member, write a JSON object where each key is a column header and each value is the shift.
You MUST include a key for EVERY column header — even if the cell is blank.
A blank cell = "RD". Write the key, then write "RD". Do not skip it.

---
THE BLANK SUNDAY RULE — THE MOST IMPORTANT RULE IN THIS PROMPT:
Sunday cells are very often blank on this roster. Blank does not mean absent from the output.
A blank Sunday cell means the person is on a rest day. You MUST write "Sun": "RD" for it.

CORRECT example (Sunday column exists, Sunday cell is blank):
  Table row: G. Miller | [blank] | 06:00-14:00 | 06:00-14:00 | RD | 06:00-14:00 | RD | RD
  Correct output:
  {
    "memberName": "G. Miller",
    "Sun": "RD",
    "Mon": "06:00-14:00",
    "Tue": "06:00-14:00",
    "Wed": "RD",
    "Thu": "06:00-14:00",
    "Fri": "RD",
    "Sat": "RD"
  }

WRONG example (do not do this — Sun key is missing):
  {
    "memberName": "G. Miller",
    "Mon": "06:00-14:00",
    ...
  }

---
SUNDAY SCAN — REQUIRED IF THE ROSTER HAS A SUNDAY COLUMN:
Before producing the main parsed data, scan ONLY the Sunday column.
Add a "sundayScan" object to your output where each key is a staff member name and
the value is exactly what you see in their Sunday cell:
  - Blank, dash, or empty cell → "blank"
  - Worked shift with RDW (e.g. "06:00-14:00 RDW") → "RDW 06:00-14:00"
  - SPARE, AL, SICK, or any keyword → the keyword as-is
  - If there is no Sunday column → omit sundayScan from the output entirely

Your "Sun" value for each person in "parsed" MUST match their sundayScan entry:
  "blank"            → "Sun": "RD"
  "RDW HH:MM-HH:MM" → "Sun": "RDW HH:MM-HH:MM"   ← keep the RDW, never strip it
  anything else      → "Sun": that value (normalised per the codes above)

---
WHAT THE CODES MEAN:
- A time like "05:30-11:30" or "0530-1130" = a worked shift. Always format as HH:MM-HH:MM.
- RD = Rest day
- AL or A/L or A.L. = Annual leave. Always return "AL".
- SP or SPARE = Spare (on standby). Always return "SPARE" — never "SP".
- OFF = Uncontracted rest day (used in CES and bilingual rosters). Return "RD".
- RDW = Rest day worked. A cell with RDW always shows a time too, e.g. "14:30-22:00 RDW" or "RDW 06:00-12:00". Return as "RDW HH:MM-HH:MM". Always keep the RDW — never strip it.
- SC or SN = Sick. Return "SICK".
- NA or N/A or NS = Not available. Return "RD".
- GER = Gerrards Cross station. Extract the shift time next to it (e.g. "GER 06:00-12:00" → "06:00-12:00"). If no time, return "RD".
- Blank, dashed, or no entry = "RD".
- Duty/diagram codes on a second line (e.g. "CEA 16", "D123") are train duty numbers — ignore them. Only the first line of each cell is the shift value.

---
RULES:
1. Only include people from the STAFF NAMES list. Skip "Vacant", agency staff, or anyone not on the list.
2. If a name in the document differs slightly (initials, spacing), match it to the closest name on the list.
3. Every member object MUST contain a key for every column header — never omit a key, even for blank cells.
4. Blank/dashed/empty cells = "RD" — always include them as a named key, never skip.
5. Return ONLY valid JSON — no explanation, no markdown fences, nothing else.

---
OUTPUT FORMAT — return exactly this structure:
{
  "sundayScan": {
    "L. Springer": "blank",
    "G. Miller": "RDW 06:00-14:00"
  },
  "columnHeaders": ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  "parsed": [
    {
      "memberName": "L. Springer",
      "Sun": "RD",
      "Mon": "05:30-11:30",
      "Tue": "05:30-11:30",
      "Wed": "SPARE",
      "Thu": "05:30-11:30",
      "Fri": "RD",
      "Sat": "RD"
    }
  ]
}

sundayScan: one key per staff member — what you see in their Sunday cell before reading shifts.
columnHeaders: the day abbreviations from the column headers, left to right.
Each member object: "memberName" plus one key per column header, in any order.
Every column header must appear as a key in every member object.`;

        // ---- Call Claude AI ----
        // We pass the PDF as a document content block so Claude reads the actual
        // visual layout of the roster table — preserving column structure.
        // This is far more reliable than extracting text first (which destroys
        // the table structure and causes day-column misalignment).
        let parsed;
        try {
            const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });

            const message = await client.messages.create({
                model:      CLAUDE_MODEL,
                max_tokens: 8192,
                messages: [{
                    role: 'user',
                    content: [
                        {
                            type: 'document',
                            source: {
                                type:       'base64',
                                media_type: 'application/pdf',
                                data:       cleanBase64,
                            },
                        },
                        {
                            type: 'text',
                            text: prompt,
                        },
                    ],
                }],
            });

            // Scan for the first text block rather than assuming content[0] is text —
            // a leading non-text block (e.g. a thinking block) would otherwise yield
            // '' and a spurious "unreadable response" 502.
            const responseText = (message.content.find(b => b.type === 'text') || {}).text || '';
            console.log(`[parseRosterPDF] Claude response length: ${responseText.length}`);

            // Extract the JSON object robustly — strips any preamble, fences, or trailing text.
            parsed = extractAIJson(responseText);

        } catch (err) {
            console.error('[parseRosterPDF] Claude AI call failed:', err.message);
            // Distinguish JSON parse errors (bad AI output) from API errors
            if (err instanceof SyntaxError) {
                res.status(502).json({ error: 'The AI returned an unreadable response — please try again' });
            } else {
                res.status(502).json({ error: 'Could not reach the AI service — please try again in a moment' });
            }
            return;
        }

        // ---- Validate the response shape ----
        // Each member is now an object with day-name keys rather than a rowValues array.
        // We only require parsed[] and columnHeaders[] to be present at the top level.
        if (!parsed || !Array.isArray(parsed.parsed) || !Array.isArray(parsed.columnHeaders)) {
            res.status(502).json({ error: 'The AI returned an unexpected format — please try again' });
            return;
        }

        // ---- Map columnHeaders to dates (server owns all date assignment) ----
        // The AI only reads column headers left-to-right and cell values left-to-right.
        // The server maps "Mon" → dates[1], "Sun" → dates[0], etc.
        const { columnDates, error: colError } = mapColumnHeadersToDates(parsed.columnHeaders, dates);
        if (colError) {
            console.error(`[parseRosterPDF] Column mapping error: ${colError}`);
            res.status(502).json({ error: colError });
            return;
        }

        console.log(`[parseRosterPDF] Columns: ${parsed.columnHeaders.join(', ')} → ${columnDates.join(', ')}`);

        // ---- Build safe entries — map named day keys to dated shifts ----
        // Any missing key is filled with 'RD' (blank = rest day by definition).
        const safeEntries = buildSafeEntries(parsed.parsed, parsed.columnHeaders, dates);

        if (safeEntries.length === 0) {
            res.status(502).json({ error: 'The AI found no recognisable staff members — check the roster type is correct and try again' });
            return;
        }

        // ---- Post-processing: validate Sunday values using sundayScan ----
        // Catches blank-misread-as-Monday (Case A) and RDW-stripped (Case B).
        const hasSundayColumn = parsed.columnHeaders.some(h => ['sun', 'sunday'].includes(h.trim().toLowerCase()));
        applySundayScanCorrections(safeEntries, parsed.sundayScan, hasSundayColumn, dates);

        // ---- Filter to known staff names only ----
        // The AI could hallucinate a name not in the prompt list — strip any entry
        // whose memberName is not in the relevant staff list for this roster type.
        const knownNamesSet = new Set(relevantNames);
        const filteredEntries = safeEntries.filter(e => knownNamesSet.has(e.memberName));
        if (filteredEntries.length < safeEntries.length) {
            const dropped = safeEntries.filter(e => !knownNamesSet.has(e.memberName)).map(e => e.memberName);
            console.warn(`[parseRosterPDF] Dropped ${dropped.length} unknown member(s): ${dropped.join(', ')}`);
        }

        console.log(`[parseRosterPDF] Returning ${filteredEntries.length} parsed members for week ${weekEnding}`);

        res.status(200).json({
            weekEnding,
            rosterType,
            dates,
            parsed: filteredEntries,
        });
    }
);

// ── Firebase Auth account setup ──────────────────────────────────────────────

/**
 * POST /setupRosterAuth
 *
 * Creates Firebase Auth accounts for all active roster members and optionally
 * disables accounts for anyone who has left. Run any time membership changes —
 * it is fully idempotent (existing accounts are skipped).
 *
 * The member list comes from the request body, not a hardcoded array, so there
 * is no separate list to keep in sync with teamMembers in roster-data.js. Claude
 * generates the curl command with the current active members each time.
 *
 * Body (JSON):
 *   {
 *     "members": ["G. Miller", "L. Springer", ...],  // active non-hidden teamMembers
 *     "removeOrphans": true                           // optional, default false
 *   }
 *
 * removeOrphans: scans all @myb-roster.local Firebase Auth accounts and disables
 * any that are not in the members list. Disabled accounts cannot sign in.
 * They are not deleted — use the Firebase Console to delete permanently if needed.
 *
 * Auth: Authorization: Bearer <Firebase ID token with admin custom claim>
 *
 * Response:
 *   { created: string[], skipped: string[], disabled: string[], failed: string[] }
 */
exports.setupRosterAuth = onRequest(
    {
        region:        'europe-west2',
        timeoutSeconds: 120,
        cors:          true,
    },
    async (req, res) => {
        if (req.method !== 'POST') {
            return res.status(405).json({ error: 'Method not allowed' });
        }

        const bearer = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
        let decodedAuth;
        try {
            decodedAuth = await admin.auth().verifyIdToken(bearer);
        } catch (_) {
            return res.status(401).json({ error: 'Unauthorised' });
        }
        if (!decodedAuth.admin) {
            return res.status(403).json({ error: 'Forbidden — admin claim required' });
        }

        // firebase-functions v2 auto-parses req.body only when Content-Type: application/json
        // is sent. Fall back to rawBody so callers that omit the header still work, and so
        // admin claims are never silently skipped due to an unparsed body.
        let body = req.body || {};
        if (!body.members && req.rawBody) {
            try { body = JSON.parse(req.rawBody.toString('utf8')); } catch (_e) { /* malformed — caught below */ }
        }
        const members = body.members;
        if (!Array.isArray(members) || members.length === 0) {
            return res.status(400).json({ error: '`members` array is required — send Content-Type: application/json' });
        }

        // adminMembers: names that should receive the Firebase Auth admin:true custom claim.
        // This claim gates parseRosterPDF — it is set here so there is one place to manage membership.
        const adminMembers   = Array.isArray(body.adminMembers) ? new Set(body.adminMembers) : new Set();
        const removeOrphans  = body.removeOrphans === true;
        const created  = [];
        const skipped  = [];
        const disabled = [];
        const failed   = [];
        // Emails of members whose name+email derivation succeeded — the authoritative
        // "active" set for orphan removal. Built here (not re-derived from the raw,
        // unvalidated `members` array later) so a single bad entry can't throw during
        // orphan removal and abort it.
        const activeEmails = new Set();

        // Create accounts for all current members, then (re)apply custom claims.
        for (const name of members) {
            if (typeof name !== 'string' || !name.trim()) {
                failed.push(String(name));
                console.error(`[setupRosterAuth] Skipping invalid member entry: ${JSON.stringify(name)}`);
                continue;
            }
            let email, password;
            try {
                email    = nameToEmail(name);
                password = nameToPassword(name);
            } catch (err) {
                failed.push(`${name} (invalid: ${err.message})`);
                console.error(`[setupRosterAuth] Name derivation failed for "${name}": ${err.message}`);
                continue;
            }
            // Derivation succeeded — this is an active member; never orphan-disable it.
            activeEmails.add(email);
            let uid;
            try {
                const user = await admin.auth().createUser({ email, password, displayName: name });
                uid = user.uid;
                created.push(name);
                console.log(`[setupRosterAuth] Created: ${email}`);
            } catch (err) {
                if (err.code === 'auth/email-already-exists') {
                    // Fetch UID so we can still (re)apply claims, and re-enable
                    // if the account was previously disabled (returning staff member).
                    try {
                        const existing = await admin.auth().getUserByEmail(email);
                        uid = existing.uid;
                        if (existing.disabled) {
                            await admin.auth().updateUser(uid, { disabled: false });
                            console.log(`[setupRosterAuth] Re-enabled returning member: ${email}`);
                        }
                        skipped.push(name);
                    } catch (lookupErr) {
                        // Lookup/re-enable failed: the account exists but we couldn't act on
                        // it, so claims won't be applied. Report it as a real failure, not a
                        // benign skip, so the result reflects what actually happened.
                        failed.push(`${name} (lookup-failed: ${lookupErr.message})`);
                        console.error(`[setupRosterAuth] Lookup/re-enable failed for ${name}: ${lookupErr.message}`);
                    }
                } else {
                    const reason = err.code || err.message || 'unknown';
                    failed.push(`${name} (${reason})`);
                    console.error(`[setupRosterAuth] Failed for ${name}: ${reason}`);
                }
            }

            // Set or clear the admin custom claim — applies to both new and existing accounts.
            // Also sets the name claim for all members — required by Firestore rules
            // for staffContact owner-isolation (staffContact/{name}: token.name == name).
            if (uid) {
                const isAdmin = adminMembers.has(name);
                const claims  = isAdmin ? { admin: true, name } : { name };
                try {
                    await admin.auth().setCustomUserClaims(uid, claims);
                    if (isAdmin) console.log(`[setupRosterAuth] Set admin+name claim: ${email}`);
                    else         console.log(`[setupRosterAuth] Set name claim: ${email}`);
                } catch (claimErr) {
                    failed.push(`${name} (claim-failed: ${claimErr.message})`);
                    console.error(`[setupRosterAuth] Failed to set claim for ${name}: ${claimErr.message}`);
                }
            }
        }

        // Disable accounts for leavers — anyone with @myb-roster.local not in the
        // validated active set (built during the main loop above).
        if (removeOrphans) {
            let pageToken;
            do {
                const page = await admin.auth().listUsers(1000, pageToken);
                for (const user of page.users) {
                    if (user.email &&
                        user.email.endsWith('@myb-roster.local') &&
                        !activeEmails.has(user.email) &&
                        !user.disabled) {
                        try {
                            await admin.auth().updateUser(user.uid, { disabled: true });
                            disabled.push(user.displayName || user.email);
                            console.log(`[setupRosterAuth] Disabled leaver: ${user.email}`);
                        } catch (err) {
                            failed.push(user.email);
                            console.error(`[setupRosterAuth] Failed to disable ${user.email}: ${err.message}`);
                        }
                    }
                }
                pageToken = page.pageToken;
            } while (pageToken);
        }

        res.json({ created, skipped, disabled, failed });
    }
);
