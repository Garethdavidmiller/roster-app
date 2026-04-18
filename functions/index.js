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
 *   ROSTER_SECRET       — Bearer token for the admin roster upload page
 *   ANTHROPIC_API_KEY   — API key for the Claude AI service
 *
 * Deploy:
 *   Push any change to functions/ on main — GitHub Actions deploys automatically.
 */

const { onRequest }         = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret }  = require('firebase-functions/params');
const admin             = require('firebase-admin');
const crypto            = require('crypto');
const { Anthropic }     = require('@anthropic-ai/sdk');
const mammoth           = require('mammoth');
const webpush           = require('web-push');

admin.initializeApp();

const HUDDLE_SECRET      = defineSecret('HUDDLE_SECRET');
const ROSTER_SECRET      = defineSecret('ROSTER_SECRET');
const ANTHROPIC_API_KEY  = defineSecret('ANTHROPIC_API_KEY');
const VAPID_PRIVATE_KEY  = defineSecret('VAPID_PRIVATE_KEY');

// VAPID public key — safe to expose, matches the private key stored in Secret Manager.
// Staff browsers use this to encrypt push payloads so only this server can read them.
const VAPID_PUBLIC_KEY = 'BLX8DG2Yot8lOwmQpSWwVOIW6ymhVDpK4eSuh0J911R2svlkE9RTRLTSz4f7NThtyPuhYeP1NuVbADKacjNQhGw';

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
        secrets:       [HUDDLE_SECRET],
        region:        'europe-west2',
        cors:          false,
        timeoutSeconds: 60,
    },
    async (req, res) => {

        // ---- Method check ----
        if (req.method !== 'POST') {
            res.status(405).send('Method not allowed');
            return;
        }

        // ---- Authentication ----
        const authHeader = req.headers['authorization'] || '';
        if (authHeader !== `Bearer ${HUDDLE_SECRET.value()}`) {
            res.status(401).send('Unauthorised');
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

        if (!base64Content) {
            res.status(400).json({ error: 'Request body is empty' });
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
        const isDocx   = filename.toLowerCase().endsWith('.docx');
        const fileType = isDocx ? 'docx' : 'pdf';
        const mimeType = isDocx
            ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : 'application/pdf';

        // ---- Upload to Firebase Storage ----
        const storagePath   = `huddles/${date}.${fileType}`;
        const downloadToken = crypto.randomUUID();

        try {
            const bucket = admin.storage().bucket();
            const file   = bucket.file(storagePath);

            await file.save(fileBuffer, {
                contentType: mimeType,
                metadata: {
                    metadata: { firebaseStorageDownloadTokens: downloadToken },
                },
            });

            const encodedPath = encodeURIComponent(storagePath);
            const storageUrl  = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${downloadToken}`;

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
            // Push notifications are handled by the onHuddleCreated Firestore trigger —
            // that fires for both Power Automate uploads and manual admin uploads.
            res.status(200).json({ success: true, date, storageUrl });

        } catch (err) {
            console.error('[ingestHuddle] Upload failed:', err);
            res.status(500).json({ error: 'Upload failed — check function logs' });
        }
    }
);

// ============================================================================
// sendHuddlePushNotifications
// ============================================================================
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
        const date = event.params.date;
        console.log(`[onHuddleCreated] New huddle for ${date} — fanning out push`);
        try {
            await sendHuddlePushNotifications(date, VAPID_PRIVATE_KEY);
        } catch (err) {
            console.warn('[onHuddleCreated] Push fan-out error:', err.message);
        }
    }
);

/**
 * Fan out Web Push notifications to all subscribed devices.
 * Builds a smart day label in London time:
 *   Same day as huddleDate  → "Today's Huddle is ready"
 *   Day after huddleDate    → "Tomorrow's Huddle is ready"
 *   Any other day           → "Thursday's Huddle is ready" (weekday name)
 *
 * Dead subscriptions (HTTP 410 Gone) are silently deleted from Firestore.
 *
 * @param {string}       huddleDate    YYYY-MM-DD — the date the huddle is FOR
 * @param {SecretParam}  vapidPrivate  Firebase secret param for VAPID private key
 */
async function sendHuddlePushNotifications(huddleDate, vapidPrivate) {
    webpush.setVapidDetails(
        'mailto:noreply@myb-roster.web.app',
        VAPID_PUBLIC_KEY,
        vapidPrivate.value(),
    );

    // Build smart day label — compare huddle date to today in London timezone
    const nowLondon   = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' }));
    const todayMs     = Date.UTC(nowLondon.getFullYear(), nowLondon.getMonth(), nowLondon.getDate());
    const parts       = huddleDate.split('-').map(Number); // [YYYY, MM, DD]
    const huddleMs    = Date.UTC(parts[0], parts[1] - 1, parts[2]);
    const diffDays    = Math.round((huddleMs - todayMs) / 86_400_000);

    let dayLabel;
    if (diffDays === 0)      dayLabel = "Today's";
    else if (diffDays === 1) dayLabel = "Tomorrow's";
    else {
        const dayName = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'Europe/London' })
            .format(new Date(huddleDate + 'T12:00:00Z'));
        dayLabel = `${dayName}'s`;
    }

    const payload = JSON.stringify({
        title: 'Marylebone Roster',
        body:  `${dayLabel} Huddle is ready`,
    });

    const snapshot = await admin.firestore().collection('pushSubscriptions').get();
    if (snapshot.empty) {
        console.log('[push] No subscriptions — skipping');
        return;
    }

    const sends = snapshot.docs.map(async docSnap => {
        const { endpoint, keys } = docSnap.data();
        try {
            await webpush.sendNotification({ endpoint, keys }, payload);
        } catch (err) {
            if (err.statusCode === 410 || err.statusCode === 404) {
                // Subscription expired or was revoked — clean it up silently
                await docSnap.ref.delete();
                console.log(`[push] Removed dead subscription ${docSnap.id}`);
            } else {
                console.warn(`[push] Failed for ${docSnap.id}: HTTP ${err.statusCode} — ${err.message}`);
            }
        }
    });

    await Promise.allSettled(sends);
    console.log(`[push] Notified ${snapshot.size} device(s) — "${dayLabel} Huddle is ready"`);
}

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
 *   Authorization:    Bearer <ROSTER_SECRET>
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
        secrets:        [ROSTER_SECRET, ANTHROPIC_API_KEY],
        region:         'europe-west2',
        cors:           true,           // auth is handled by Bearer token — CORS origin restriction adds nothing
        timeoutSeconds: 120,            // PDF parse + AI call can take up to ~30s
        memory:         '512MiB',       // pdf-parse needs a little headroom
    },
    async (req, res) => {

        // ---- Method check ----
        if (req.method !== 'POST') {
            res.status(405).send('Method not allowed');
            return;
        }

        // ---- Auth ----
        const authHeader = req.headers['authorization'] || '';
        if (authHeader !== `Bearer ${ROSTER_SECRET.value()}`) {
            res.status(401).send('Unauthorised');
            return;
        }

        // ---- Headers ----
        const weekEnding = (req.headers['x-week-ending']  || '').trim();
        const rosterType = (req.headers['x-roster-type']  || '').trim().toLowerCase();

        if (!weekEnding || !/^\d{4}-\d{2}-\d{2}$/.test(weekEnding)) {
            res.status(400).json({ error: 'Missing or invalid X-Week-Ending header (expected YYYY-MM-DD)' });
            return;
        }
        // Roster weeks always end on Saturday — validate so the day-date mapping is correct
        if (new Date(weekEnding + 'T12:00:00Z').getUTCDay() !== 6) {
            res.status(400).json({ error: 'X-Week-Ending must be a Saturday' });
            return;
        }
        if (!['cea', 'ces', 'dispatcher'].includes(rosterType)) {
            res.status(400).json({ error: 'X-Roster-Type must be cea, ces, or dispatcher' });
            return;
        }

        // ---- Read raw body ----
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
            console.error('[parseRosterPDF] Failed to read body:', err.message);
            res.status(400).json({ error: 'Could not read request body' });
            return;
        }

        if (!base64Content) {
            res.status(400).json({ error: 'Request body is empty' });
            return;
        }

        // ---- Validate the PDF ----
        // Decode just enough to check the size — we pass the original base64 to the AI.
        let pdfBuffer;
        try {
            pdfBuffer = Buffer.from(base64Content, 'base64');
        } catch {
            res.status(400).json({ error: 'Body must be valid base64' });
            return;
        }

        if (pdfBuffer.length === 0) {
            res.status(400).json({ error: 'Decoded PDF is empty' });
            return;
        }
        if (pdfBuffer.length > 20 * 1024 * 1024) {
            res.status(413).json({ error: 'File exceeds 20 MB limit' });
            return;
        }

        // Strip any whitespace from base64 before sending to the API
        const cleanBase64 = base64Content.replace(/\s/g, '');

        console.log(`[parseRosterPDF] PDF size: ${pdfBuffer.length} bytes`);

        // ---- Build the 7 dates for this week (Sun → Sat) ----
        // weekEnding is always a Saturday (validated above).
        // Subtract 6 days to get Sunday, then work forward to Saturday.
        const weekEndDate = new Date(weekEnding + 'T12:00:00Z');
        const dates = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(weekEndDate);
            d.setUTCDate(d.getUTCDate() - i);
            dates.push(d.toISOString().slice(0, 10));
        }
        // dates[0] = Sunday, dates[6] = Saturday (= weekEnding)

        // ---- Build the staff name list relevant to this roster type ----
        // Staff names come from the teamMembers array that is embedded in the prompt.
        // We only include names relevant to the roster type being parsed, so the AI
        // doesn't accidentally match a CES name in a CEA document (or vice versa).
        //
        // We embed the names directly — this function has no access to roster-data.js
        // (that is a browser ES module). The names are therefore hardcoded here and
        // must be kept in sync with roster-data.js. The AI is instructed to skip any
        // name in the PDF that is NOT in this list (vacancies, agency staff, etc.).
        const STAFF_NAMES = {
            cea: [
                'L. Springer', 'A. Hared', 'G. Miller', 'M. Robson', 'I. Cooper',
                'A. Panchal', 'C. Francisco-Charles', 'O. Mylla', 'S. Boyle',
                'L. Atrakimaviciene', 'J. Haque', 'N. Tuck', 'R. Forrester-Blackstock',
                'S. Langley', 'S. Silva', 'J. Sumaili', 'T. Bibi', 'T. Nsuala',
                'D. Irvine', 'T. Gherbi', 'C. Reen', 'M. Okeke',
            ],
            ces: [
                'F. Mohamed', 'P. Lloyd', 'P. Prashanthan', 'G. Rotaru',
                'L. Webster', 'Z. Lewis', 'M. Bowler', 'W. Cummings', 'S. Horsman',
            ],
            dispatcher: [
                'D. Minto', 'A. Targanov', 'S. Warman', 'S. Faure', 'L. Szpejer',
                'K. Porter', 'A. Murray', 'S. Clarke', 'A. Atkins', 'K. Yeboah',
            ],
        };

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
                model:      'claude-sonnet-4-6',
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

            const responseText = message.content[0]?.text || '';
            console.log(`[parseRosterPDF] Claude response length: ${responseText.length}`);

            // Extract the JSON object robustly — find the first { and last } so any
            // preamble, markdown fences, or trailing text is safely stripped.
            const start = responseText.indexOf('{');
            const end   = responseText.lastIndexOf('}');
            if (start === -1 || end === -1 || end <= start) {
                throw new SyntaxError('No JSON object found in AI response');
            }
            parsed = JSON.parse(responseText.slice(start, end + 1));

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
        // This removes date assignment from the AI entirely, closing the root cause of
        // day-column misalignment bugs.
        const HEADER_TO_INDEX = {
            'sun': 0, 'sunday': 0,
            'mon': 1, 'monday': 1,
            'tue': 2, 'tues': 2, 'tuesday': 2,
            'wed': 3, 'weds': 3, 'wednesday': 3,
            'thu': 4, 'thur': 4, 'thurs': 4, 'thursday': 4,
            'fri': 5, 'friday': 5,
            'sat': 6, 'saturday': 6,
        };

        const columnDates = [];
        for (const header of parsed.columnHeaders) {
            const key = String(header).trim().toLowerCase();
            // Try full key first, then first-3-chars abbreviation
            const dayIndex = HEADER_TO_INDEX[key] ?? HEADER_TO_INDEX[key.slice(0, 3)];
            if (dayIndex === undefined) {
                console.error(`[parseRosterPDF] Unrecognised column header: "${header}"`);
                res.status(502).json({ error: `The AI returned an unrecognised column header: "${header}". Please try again.` });
                return;
            }
            columnDates.push(dates[dayIndex]);
        }

        // Reject duplicate day columns (e.g. two "Mon" headers)
        if (new Set(columnDates).size !== columnDates.length) {
            console.error('[parseRosterPDF] Duplicate day columns in columnHeaders');
            res.status(502).json({ error: 'The AI returned duplicate day columns — please try again.' });
            return;
        }

        console.log(`[parseRosterPDF] Columns: ${parsed.columnHeaders.join(', ')} → ${columnDates.join(', ')}`);

        // ---- Build safe entries — map named day keys to dated shifts ----
        // The AI returns each member as an object with day-name keys (e.g. "Sun": "RD")
        // rather than a position-indexed array. This makes blank-cell omission structurally
        // much harder: the AI must write "Sun": before deciding the value, which forces it
        // to acknowledge the column. Any key the AI still omits is filled with "RD" here
        // (blank = RD by definition), so a missing key is corrected rather than fatal.
        const safeEntries = [];
        for (const entry of parsed.parsed) {
            if (typeof entry.memberName !== 'string' || !entry.memberName.trim()) continue;

            // All dates default to RD first — covers any day not mentioned by the AI
            const shifts = {};
            for (const date of dates) shifts[date] = 'RD';

            const missingKeys = [];
            for (let i = 0; i < parsed.columnHeaders.length; i++) {
                const header    = parsed.columnHeaders[i];
                const key       = String(header).trim().toLowerCase();
                const dayIndex  = HEADER_TO_INDEX[key] ?? HEADER_TO_INDEX[key.slice(0, 3)];
                if (dayIndex === undefined) continue; // unrecognised header already caught above

                const date  = dates[dayIndex];
                const raw   = entry[header];              // named key lookup
                const value = (raw !== undefined && raw !== null && String(raw).trim() !== '')
                    ? String(raw).trim()
                    : 'RD';

                if (raw === undefined || raw === null || String(raw).trim() === '') {
                    missingKeys.push(header);
                }

                shifts[date] = normaliseShift(value);
            }

            if (missingKeys.length > 0) {
                // Log the gap but continue — filling with RD is always safe because
                // blank cells on this roster always mean rest day.
                console.warn(`[parseRosterPDF] ${entry.memberName}: AI omitted key(s) [${missingKeys.join(', ')}] — filled with RD`);
            }

            safeEntries.push({ memberName: entry.memberName.trim(), shifts });
        }

        if (safeEntries.length === 0) {
            res.status(502).json({ error: 'The AI found no recognisable staff members — check the roster type is correct and try again' });
            return;
        }

        // ---- Post-processing: validate Sunday values using sundayScan ----
        // The AI commits to what it sees in each Sunday cell via the sundayScan field
        // before producing the full parsed output. This lets the server catch two failure
        // modes that are otherwise indistinguishable:
        //   A) Blank Sunday misread as Monday — sundayScan says "blank" but parsed has a time
        //   B) Worked Sunday with RDW stripped — sundayScan says "RDW HH:MM" but parsed has plain time
        //
        // Both are corrected here. Without sundayScan, these cases look identical (Sun = Mon value)
        // so any heuristic that uses Sun=Mon equality causes false positives on genuine Sunday shifts.
        const hasSundayColumn = parsed.columnHeaders.some(h => ['sun', 'sunday'].includes(h.trim().toLowerCase()));
        if (parsed.sundayScan && typeof parsed.sundayScan === 'object' && hasSundayColumn && dates.length >= 2) {
            const sunDate    = dates[0]; // Sunday is always index 0
            const isPlainTime = v => /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(v);

            for (const entry of safeEntries) {
                const scanRaw = parsed.sundayScan[entry.memberName];
                if (scanRaw === undefined || scanRaw === null) continue;

                const scanStr  = String(scanRaw).trim().toUpperCase();
                const sunShift = entry.shifts[sunDate];

                // Case A: scan says this Sunday was blank but parsed has a plain time → blank misread
                const isBlank = ['BLANK', '', 'RD', 'EMPTY', '-', 'N/A', 'NA'].includes(scanStr);
                if (isBlank && isPlainTime(sunShift)) {
                    console.warn(`[parseRosterPDF] ${entry.memberName}: sundayScan="${scanRaw}" (blank) but parsed Sunday="${sunShift}" — correcting to RD`);
                    entry.shifts[sunDate] = 'RD';
                    continue;
                }

                // Case B: scan says this Sunday was an RDW shift but AI stripped the RDW prefix
                if (scanStr.includes('RDW') && isPlainTime(sunShift)) {
                    console.warn(`[parseRosterPDF] ${entry.memberName}: sundayScan="${scanRaw}" (RDW) but parsed Sunday="${sunShift}" (plain time) — adding RDW prefix`);
                    entry.shifts[sunDate] = `RDW|${sunShift}`;
                }
            }
        }

        console.log(`[parseRosterPDF] Returning ${safeEntries.length} parsed members for week ${weekEnding}`);

        res.status(200).json({
            weekEnding,
            rosterType,
            dates,
            parsed: safeEntries,
        });
    }
);

/**
 * Normalise a shift value returned by the AI into the canonical app format.
 *
 * Handles common variations:
 *   "0530-1130"   → "05:30-11:30"
 *   "05:30-11:30" → "05:30-11:30"  (already correct)
 *   "05.30-11.30" → "05:30-11:30"
 *   "RD", "AL", "SPARE", "SICK" → unchanged (uppercase)
 *   "RDW" → should not appear (prompt instructs AI to return the time instead)
 *
 * @param {string} raw - Shift value from Claude AI
 * @returns {string}   - Normalised shift value
 */
function normaliseShift(raw) {
    if (typeof raw !== 'string') return 'RD';
    const s = raw.trim().toUpperCase();

    // Normalise "SP" → "SPARE" (prompt says both are valid in source PDFs)
    if (s === 'SP') return 'SPARE';

    // RDW with time: "RDW 14:30-22:00" or "RDW 1430-2200" → "RDW|14:30-22:00"
    // The pipe-separated format carries both the RDW flag and the time through the
    // review pipeline so RDW is identified correctly regardless of the base shift
    // (e.g. a SPARE week where baseShift is not 'RD').
    const rdwMatch = s.match(/^RDW\s+(\d{2})[:\.]?(\d{2})[\s\-–]+(\d{2})[:\.]?(\d{2})$/);
    if (rdwMatch) return `RDW|${rdwMatch[1]}:${rdwMatch[2]}-${rdwMatch[3]}:${rdwMatch[4]}`;

    // Known keyword values — return as-is
    // OFF is treated as RD by the app; keeping both here so either passes through cleanly.
    // Plain "RDW" (no time) is kept as sentinel in case the AI ignores the format instruction.
    if (['RD', 'OFF', 'AL', 'SPARE', 'SICK', 'RDW'].includes(s)) return s;

    // Try to match a plain time range: four digits, separator, four digits
    // Covers "0530-1130", "05:30-11:30", "05.30-11.30", "0530 1130"
    const match = s.match(/^(\d{2})[:\.]?(\d{2})[\s\-–]+(\d{2})[:\.]?(\d{2})$/);
    if (match) {
        return `${match[1]}:${match[2]}-${match[3]}:${match[4]}`;
    }

    // Unrecognised — default to RD rather than storing garbage
    console.warn(`[parseRosterPDF] Unrecognised shift value: "${raw}" — defaulting to RD`);
    return 'RD';
}
