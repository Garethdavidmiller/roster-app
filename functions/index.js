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

const { onRequest }    = require('firebase-functions/v2/https');
const { defineSecret }  = require('firebase-functions/params');
const admin             = require('firebase-admin');
const crypto            = require('crypto');
const { Anthropic }     = require('@anthropic-ai/sdk');
const mammoth           = require('mammoth');

admin.initializeApp();

const HUDDLE_SECRET     = defineSecret('HUDDLE_SECRET');
const ROSTER_SECRET     = defineSecret('ROSTER_SECRET');
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

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
            res.status(200).json({ success: true, date, storageUrl });

        } catch (err) {
            console.error('[ingestHuddle] Upload failed:', err);
            res.status(500).json({ error: 'Upload failed — check function logs' });
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
                'D. Irvine', 'T. Gherbi', 'C. Reen',
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
HOW TO READ THE TABLE — follow these two steps exactly:

STEP 1 — Read the column headers from left to right.
Write down each day abbreviation in order (e.g. "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat").
Only include days that actually appear as column headers. Some rosters start on Monday (no Sunday column). Some have a Sunday column where every cell is blank — if you can see a "Sun" or "Sunday" column header, include it.

STEP 2 — For each staff member, read their row from left to right.
Write down one value per column — the same number of values as column headers, no more, no fewer.
If a cell is blank, dashed, or empty, write "RD". NEVER skip a blank cell.

---
BLANK CELLS — THIS IS THE MOST IMPORTANT RULE:
A blank cell is still a cell. It takes up a column position.
If Sunday is blank for everyone, it still counts as column 1. Write "RD" for it.
Do NOT jump to the next non-blank cell and start from there.

CHECK BEFORE YOU OUTPUT: count your columnHeaders. Every staff member's rowValues must have exactly that many entries. If anyone has fewer, you skipped a blank cell — go back and add "RD" for it.

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
3. rowValues must have EXACTLY the same number of entries as columnHeaders — never more, never fewer.
4. Blank/dashed cells = "RD" — always include them, never skip.
5. Return ONLY valid JSON — no explanation, no markdown fences, nothing else.

---
OUTPUT FORMAT — return exactly this structure:
{
  "columnHeaders": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  "parsed": [
    {
      "memberName": "L. Springer",
      "rowValues": ["05:30-11:30", "05:30-11:30", "SPARE", "05:30-11:30", "RD", "RD"]
    }
  ]
}

columnHeaders: day abbreviations from the column headers, left to right.
rowValues: each person's shift values, left to right, one per column, never fewer than columnHeaders.`;

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

        // ---- Build safe entries — validate and map rowValues to dated shifts ----
        // Key validation: rowValues.length must equal columnDates.length.
        // If the AI skipped a blank Sunday cell, rowValues will be short by 1 and we
        // catch it here with a clear error rather than silently misaligning all shifts.
        const safeEntries = [];
        for (const entry of parsed.parsed) {
            if (typeof entry.memberName !== 'string' || !entry.memberName.trim()) continue;

            if (!Array.isArray(entry.rowValues)) {
                console.warn(`[parseRosterPDF] ${entry.memberName}: missing rowValues — skipping`);
                continue;
            }

            if (entry.rowValues.length !== columnDates.length) {
                console.error(`[parseRosterPDF] ${entry.memberName}: ${entry.rowValues.length} values for ${columnDates.length} columns`);
                res.status(502).json({
                    error: `The AI returned ${entry.rowValues.length} shift values for "${entry.memberName}" but there are ${columnDates.length} column headers — a blank cell was likely skipped. Please try uploading again.`,
                });
                return;
            }

            // All dates default to RD; then fill in what the AI returned
            const shifts = {};
            for (const date of dates) shifts[date] = 'RD';
            for (let i = 0; i < columnDates.length; i++) {
                shifts[columnDates[i]] = normaliseShift(entry.rowValues[i]);
            }

            safeEntries.push({ memberName: entry.memberName.trim(), shifts });
        }

        if (safeEntries.length === 0) {
            res.status(502).json({ error: 'The AI found no recognisable staff members — check the roster type is correct and try again' });
            return;
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
