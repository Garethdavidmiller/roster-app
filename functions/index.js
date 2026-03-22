/**
 * functions/index.js — MYB Roster Firebase Cloud Functions
 *
 * ingestHuddle — HTTP endpoint called by Power Automate when the daily
 * Huddle email arrives. Accepts a base64-encoded PDF or DOCX attachment,
 * stores it in Firebase Storage, and writes a metadata document to the
 * `huddles` Firestore collection — exactly the same result as a manual
 * upload through admin.html.
 *
 * Deploy:
 *   npm install -g firebase-tools          # one-time
 *   firebase login                          # one-time
 *   firebase use myb-roster                 # one-time
 *   firebase functions:secrets:set HUDDLE_SECRET   # paste a strong random string when prompted
 *   cd functions && npm install             # one-time
 *   firebase deploy --only functions        # run this each time the function changes
 *
 * The function URL after deploy will be printed in the terminal, e.g.:
 *   https://europe-west2-myb-roster.cloudfunctions.net/ingestHuddle
 * Copy that URL into Power Automate.
 *
 * Generating a strong secret (run in any terminal):
 *   node -e "console.log(require('crypto').randomUUID())"
 */

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();

const HUDDLE_SECRET = defineSecret('HUDDLE_SECRET');

/**
 * POST /ingestHuddle
 *
 * Called by Power Automate when a Huddle email arrives.
 *
 * Request headers:
 *   Authorization: Bearer <HUDDLE_SECRET>
 *   Content-Type: application/json
 *
 * Request body (JSON):
 *   {
 *     "date":     "2026-03-19",       // YYYY-MM-DD — London date of the huddle
 *     "filename": "huddle.pdf",       // Original filename — used to detect pdf vs docx
 *     "content":  "<base64 string>"   // Full file content, base64-encoded
 *   }
 *
 * Success response (200):
 *   { "success": true, "date": "2026-03-19", "storageUrl": "https://..." }
 *
 * The storageUrl written to Firestore is in the same format as the one
 * produced by uploadHuddle() in firebase-client.js, so the app's
 * getLatestHuddle() and getTodaysHuddle() functions work without any change.
 */
exports.ingestHuddle = onRequest(
    {
        secrets:  [HUDDLE_SECRET],
        region:   'europe-west2',   // London — lowest latency for UK users
        cors:     false,            // Server-to-server only; no browser calls expected
        timeoutSeconds: 60,
    },
    async (req, res) => {

        // ---- Method check ----
        if (req.method !== 'POST') {
            res.status(405).send('Method not allowed');
            return;
        }

        // ---- Authentication ----
        // Power Automate sends the secret in the Authorization header.
        // Any request without it — including accidental browser hits — is rejected.
        const authHeader = req.headers['authorization'] || '';
        if (authHeader !== `Bearer ${HUDDLE_SECRET.value()}`) {
            res.status(401).send('Unauthorised');
            return;
        }

        // ---- Parse body ----
        const { date, filename, content } = req.body || {};

        if (!date || !filename || !content) {
            res.status(400).json({ error: 'Missing required fields: date, filename, content' });
            return;
        }

        // Validate date is YYYY-MM-DD — prevents path traversal in the storage path
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            res.status(400).json({ error: 'Invalid date format — expected YYYY-MM-DD' });
            return;
        }

        // ---- Decode file ----
        let fileBuffer;
        try {
            fileBuffer = Buffer.from(content, 'base64');
        } catch (err) {
            res.status(400).json({ error: 'content must be valid base64' });
            return;
        }

        if (fileBuffer.length === 0) {
            res.status(400).json({ error: 'File content is empty' });
            return;
        }

        // Cap at 20 MB — matches the client-side validation in admin.html
        if (fileBuffer.length > 20 * 1024 * 1024) {
            res.status(413).json({ error: 'File exceeds 20 MB limit' });
            return;
        }

        // ---- Determine file type ----
        const isDocx    = filename.toLowerCase().endsWith('.docx');
        const fileType  = isDocx ? 'docx' : 'pdf';
        const mimeType  = isDocx
            ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : 'application/pdf';

        // ---- Upload to Firebase Storage ----
        // A random download token is embedded in the file's custom metadata.
        // This produces a URL in exactly the same format as getDownloadURL()
        // from the browser Firebase SDK, so the app reads it identically.
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

            // Construct the Firebase Storage download URL
            // Format mirrors what the browser SDK's getDownloadURL() returns
            const encodedPath = encodeURIComponent(storagePath);
            const storageUrl  = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${downloadToken}`;

            // ---- Write Firestore metadata document ----
            // Document ID = date string. Same-day re-upload overwrites (latest wins).
            await admin.firestore().collection('huddles').doc(date).set({
                date,
                storageUrl,
                fileType,
                uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
                uploadedBy: 'power-automate',
            });

            console.log(`[ingestHuddle] Uploaded ${fileType} for ${date} (${fileBuffer.length} bytes)`);
            res.status(200).json({ success: true, date, storageUrl });

        } catch (err) {
            console.error('[ingestHuddle] Upload failed:', err);
            res.status(500).json({ error: 'Upload failed — check function logs' });
        }
    }
);
