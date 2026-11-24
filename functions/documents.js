/**
 * functions/documents.js — the DOCUMENT-AND-NOTIFICATION domain of the Cloud Functions.
 *
 * Owns: ingestHuddle (the Power Automate upload — built from ./huddle-ingest.js), getDocumentUrl
 * (the short-lived document url), rotateDocumentLinks (new keys for the permanent links — the work is
 * ./doc-link-rotation.js), the three onDocumentCreated notification triggers, the scheduled pay
 * reminder (its audience and send: ./pay-reminder.js), the one-off timetable reminder
 * (sendTimetableReminder), the admin's Error Log notification (sendErrorLogNotification — its work:
 * ./error-log-notify.js), and their private helpers (the fan-out wrappers; the Huddle prune is
 * ./huddle-retention.js). Everything DOCUMENT-shaped: a file arrives or a doc is created, staff are
 * told, old copies are reclaimed, and a member is handed a link to open one.
 *
 * ── WHY A FACTORY, NOT A PLAIN MODULE ──────────────────────────────────────────────────────────
 * `buildDocumentEndpoints(deps)` takes its shared infrastructure as ARGUMENTS — the secret
 * params, the VAPID public key, STAFF_SITE_URL, readRawBody and the size caps — rather than
 * importing them, for two reasons that are really one reason:
 *   · index.js stays the COMPOSITION ROOT. The static guards read index.js for the VAPID
 *     public key literal (sw-asset-check) precisely because one home for it is the contract;
 *     a shared-constants module would move the literal out from under the guard.
 *   · a Node test can call this factory with a FAKE admin SDK boundary without any emulator —
 *     the same seam push.js's setupWebPush(vapidPrivate, vapidPublic) established.
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
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const crypto = require('crypto');
const { getAuth } = require('firebase-admin/auth');
const { isPayCutoffDay, buildPushPayload } = require('./roster-parse-helpers');
const { mayReceiveDocumentUrl, resolveKind, kindFromBody, signedUrlExpiry, SIGNED_URL_TTL_MS,
    isSignablePathForKind } = require('./doc-url-core');
const { setupWebPush, fanOutPush } = require('./push');
const { memberNameFromClaims } = require('./member-identity');
const { bearerToken, requireAdmin, readJsonBody } = require('./request-helpers');
const { sendPayReminder } = require('./pay-reminder');
const { notifyAdminOfErrorLog } = require('./error-log-notify');
const { rotateDocumentLinks: rotateLinks } = require('./doc-link-rotation');
const { buildIngestHuddle } = require('./huddle-ingest');

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
 * @param {string[]} deps.ADMIN_FUNCTION_ORIGINS  the CORS allowlist for the endpoints the browser calls here
 * @param {Record<string, any>} deps.rosterMembers  the server-owned roster (roster-members.json) — the pay reminder's audience, and the admin the Error Log notification goes to
 */
function buildDocumentEndpoints({
    HUDDLE_SECRET, VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, STAFF_SITE_URL,
    readRawBody, nowInLondon, isRetriableFirestoreError,
    MAX_FILE_BYTES, MAX_HUDDLE_HTML_CHARS, ADMIN_FUNCTION_ORIGINS, rosterMembers,
}) {

    // Set to true to silence all Huddle push notifications (e.g. while the staff site is genuinely
    // down), then redeploy. Check STAFF_SITE_URL first: taps that 404 have meant a wrong path, not a down site.
    const HUDDLE_PUSH_PAUSED = false;

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

    // POST /ingestHuddle — the Power Automate upload (./huddle-ingest.js). It shares this domain's
    // latest-of-kind question and the Huddle send, so HUDDLE_PUSH_PAUSED governs both doors.
    const ingestHuddle = buildIngestHuddle({
        HUDDLE_SECRET, VAPID_PRIVATE_KEY, readRawBody, nowInLondon, isRetriableFirestoreError,
        MAX_FILE_BYTES, MAX_HUDDLE_HTML_CHARS, isLatestOfKind, sendHuddlePushNotifications,
    });

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

// The web-push TRANSPORT is ./push.js. What stays here is the DECISION to send and what to say,
// which is domain knowledge; how a payload reaches a phone is not.

/**
 * Fan out Huddle push notifications: "📋 Latest Huddle", via buildPushPayload
 * (.claude/rules/notifications.md). Never "Today's"/"Tomorrow's": a Huddle is the next day's plan,
 * sent the evening before, so a day-relative label is wrong by the time it is read. `huddleDate` is
 * logging context only. Shared by ingestHuddle and onHuddleCreated, so the pause above stops both.
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
 *   - A bank holiday that moves a payday back is NOT replicated here, so the reminder would name the
 *     Friday. No payday the app covers is moved today, and payday-cutoff-parity.test.mjs fails the
 *     day one is (a one-off bank holiday on a payday, a wider year range): replicate it then.
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
            // and this domain's convention (isPayCutoffDay, pruneOldHuddles) is TZ-independence.
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
// sendTimetableReminder — the evening before Chiltern's timetable change
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
// The push's words come from the constant, so moving it moves the guard AND the sentence. documents-endpoints.test.mjs
// also holds this date equal to trains-data.js's CHANGE_DATE, and to a Sunday (the headline says so). The Settings
// Notifications card keeps a client copy (notif-card-core.js, listing "Timetable changes" only until this send),
// held to this one and to the 18:00 schedule below by notif-card-core.test.mjs — move all three together.
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

// ============================================================================
// sendErrorLogNotification — the admin's Error Log notification (v26.04)
// ============================================================================
/**
 * Every fifteen minutes: when new entries have reached the Error Log, tell the ADMIN's devices, at most
 * once an hour. A schedule rather than a trigger on each entry, because every signed-in member can write
 * an entry; the reasons, the audience and the record are ./error-log-notify.js,
 * and the rules ./error-log-notice.js. One instance at a time, so two checks never overlap.
 */
const sendErrorLogNotification = onSchedule(
    {
        schedule:       '*/15 * * * *',
        timeZone:       'Europe/London',
        region:         'europe-west2',
        secrets:        [VAPID_PRIVATE_KEY],
        maxInstances:   1,
        timeoutSeconds: 60,
    },
    async () => {
        try {
            await notifyAdminOfErrorLog({ vapidPrivate: VAPID_PRIVATE_KEY, vapidPublic: VAPID_PUBLIC_KEY,
                STAFF_SITE_URL, roster: rosterMembers });
        } catch (err) {
            console.error('[errorLog] Unhandled error:', err);
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
                + `${report.linked} linked (${report.recordsDeadLink} dead stored links), ${report.unlinkedWithKey} unlinked with a key, `
                + `${report.unlinkedTooNew} too new to clear, ${report.held} held; `
                + `rotated ${report.rotated} (${report.recordsMended} dead stored links mended), cleared ${report.cleared}, changed ${report.changedDuringRun}, `
                + `failed ${report.failed.length}`);
            return res.status(200).json(report);
        },
    );

    return { ingestHuddle, getDocumentUrl, rotateDocumentLinks, onHuddleCreated, onCircularCreated, onNewsletterCreated, sendPayReminderNotification, sendTimetableReminder, sendErrorLogNotification };
}

module.exports = { buildDocumentEndpoints };
