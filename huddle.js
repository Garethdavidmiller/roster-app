// @ts-check
/**
 * huddle.js — the Daily Huddle's manual upload.
 *
 * Owns: daily Huddle manual upload (Operations, admin only), including the browser's own DOCX→HTML
 *   conversion of a manually uploaded Word Huddle.
 * Does NOT own: Huddle ingest Cloud Function (functions/huddle-ingest.js), Firestore huddles
 *   collection writes (uploadHuddle, via firebase-client.js), roster data (roster-data.js), the
 *   Huddle card's collapse toggle (operations-app.js, with the page's other cards), or the Settings
 *   Notifications card — notif-card.js since 22 Nov 2026, so Settings no longer loads this upload code.
 * Edit here for: the Huddle file upload form.
 */

import { uploadHuddle, getLatestHuddle } from './firebase-client.js';
import { initDocUploadCard, isPdfFile, isDocxFile } from './doc-upload.js';

/**
 * Wires the Huddle upload card. Used by operations.html, an admin-only page whose markup always holds
 * the card; its collapse toggle is operations-app.js's, wired with the page's other cards.
 * @param {{ currentIsAdmin: boolean, currentUser: string|null }} cfg
 */
export function initHuddleUpload({ currentIsAdmin, currentUser }) {
    _initHuddleUpload(currentIsAdmin, currentUser);
}

// ============================================
// DAILY HUDDLE UPLOAD — admin only
// ============================================
// The card is in operations.html's markup, shown: the page itself is admin-only, so its one caller
// passes `currentIsAdmin: true`. The admin check below stays as a guard for any other caller, and the
// `display` it clears is a leftover — the markup sets none (the card was once hidden inline).

/** Inline-HTML cap for a converted DOCX — the SAME number, and the same `<=` boundary, as
 *  `MAX_HUDDLE_HTML_CHARS` in functions/index.js (upload-cap-parity.test.mjs pins both). */
const MAX_HUDDLE_HTML_CHARS = 200_000;

/**
 * Load the Mammoth DOCX→HTML converter from CDN once (SRI-pinned; the hash is patched by
 * generate-sri.mjs — do not edit by hand). Resolves when window.mammoth is available.
 * @returns {Promise<void>}
 */
function _loadMammoth() {
    return new Promise((resolve, reject) => {
        if (/** @type {any} */ (window).mammoth) { resolve(); return; }
        const sc = document.createElement('script');
        sc.src         = 'https://cdn.jsdelivr.net/npm/mammoth@1.13.0/mammoth.browser.min.js';
        sc.crossOrigin = 'anonymous';
        sc.integrity   = 'sha384-8NWE3bZDrmRI4IePMoQaEoLhAQ1MmRMJkdNgnGiHRFanTqsFKr0TmK6aSZvFJ/PO';
        sc.onload      = () => resolve();
        sc.onerror     = () => reject(new Error('load'));
        document.head.appendChild(sc);
    });
}

/**
 * doc-upload transform for the Huddle: a PDF passes straight through (htmlContent = null); a DOCX
 * is converted to inline HTML via Mammoth, capped at 200 KB (matches functions/index.js so inline
 * behaviour is identical whether the Huddle arrived via Power Automate or manual upload). A CDN
 * failure is NON-fatal (upload the .docx download-only, like a PDF); only a genuine parse failure
 * aborts. Returns { extraArgs: [htmlContent] } (the 4th arg to uploadHuddle) or { abortMsg }.
 * @param {File} file
 * @param {{ setBtnText: (t: string) => void }} ctx
 * @returns {Promise<{ extraArgs?: any[], abortMsg?: string }>}
 */
async function _convertHuddleDocx(file, { setBtnText }) {
    if (!isDocxFile(file)) return { extraArgs: [null] }; // PDF → no inline HTML
    setBtnText('Converting…');
    let htmlContent = null;
    try {
        await _loadMammoth();
        const arrayBuffer = await file.arrayBuffer();
        // @ts-ignore — mammoth is loaded onto window by _loadMammoth
        const result = await mammoth.convertToHtml({ arrayBuffer });
        const html = result.value || null;
        htmlContent = html && html.length <= MAX_HUDDLE_HTML_CHARS ? html : null;
    } catch (convErr) {
        console.error('[Huddle] DOCX conversion failed:', convErr);
        if ((/** @type {any} */ (convErr)).message === 'load') {
            // Converter CDN unreachable — the .docx is fine; upload download-only (the PDF path).
            console.warn('[Huddle] Word converter unavailable — uploading DOCX without inline preview.');
            // htmlContent stays null → the viewer falls back to its "Open Huddle" download (the PDF path).
        } else {
            return { abortMsg: "Couldn't read the Word file — make sure it is a valid .docx" };
        }
    }
    return { extraArgs: [htmlContent] };
}

function _initHuddleUpload(/** @type {boolean} */ currentIsAdmin, /** @type {string|null} */ currentUser) {
    if (!currentIsAdmin) return;
    const card = document.getElementById('huddleUploadCard');
    if (!card) return;
    card.style.display = ''; // reveal for admin

    // Shared upload skeleton (doc-upload.js) with the Huddle's differences: accepts PDF OR .docx,
    // caps the date at TOMORROW (Huddle is sent the evening before — see notifications.md; the cap
    // still blocks a far-future typo shadowing the latest-Huddle query), converts DOCX via the
    // transform above, and passes htmlContent as uploadHuddle's 4th arg.
    initDocUploadCard({
        dateId: 'huddleDate', fileId: 'huddleFileInput', fileLabelId: 'huddleFileName',
        uploadBtnId: 'huddleUploadBtn', feedbackId: 'huddleFeedback',
        uploadFn: uploadHuddle, currentUser,
        successMsg: date => `Huddle uploaded for ${date} — staff can open it from ☰ → Daily Huddle`,
        btnLabel: 'Upload Huddle', logPrefix: 'Huddle',
        whereToCheck: '☰ → Daily Huddle',
        // A later Huddle already filed — tomorrow's, sent the evening before — hides this one from staff.
        noun: 'Huddle', newest: getLatestHuddle,
        maxDateOffsetDays: 1,
        isAccepted: f => isPdfFile(f) || isDocxFile(f),
        rejectTypeMsg: 'Please choose a PDF or Word (.docx) file',
        sigMismatchMsg: 'That file isn’t a valid PDF or Word document — please choose the original file',
        transform: _convertHuddleDocx,
    });
}
