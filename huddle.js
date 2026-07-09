// @ts-check
/**
 * huddle.js — Huddle upload, Huddle card toggle, and notification card wiring.
 *
 * Owns: Notifications card (all staff), daily Huddle manual upload (admin only),
 *   Huddle viewer card collapse/expand toggle.
 * Does NOT own: Huddle ingest Cloud Function (functions/index.js), Firestore huddles
 *   collection writes (firebase-client.js uploadHuddle), roster data (roster-data.js).
 * Edit here for: notification subscribe/unsubscribe UI, VAPID key rotation handling,
 *   Huddle file upload form, Huddle card toggle.
 */

import { uploadHuddle } from './firebase-client.js';
import { initDocUploadCard, isPdfFile } from './doc-upload.js';
import { notifSupported, peekNotifState, enableNotifications, disableNotifications, isIOS } from './notif.js';
import { initCardCollapse } from './overlay.js';

/**
 * Initialises the Huddle upload card and the Huddle collapse toggle.
 * Used by operations.html where the card is always present (admin-only page).
 * @param {{ currentIsAdmin: boolean, currentUser: string|null }} cfg
 */
export function initHuddleUpload({ currentIsAdmin, currentUser }) {
    _initHuddleUpload(currentIsAdmin, currentUser);
}

/**
 * Initialises the Notifications card only.
 * Used by settings.html where notifications are available to all staff.
 */
export function initHuddleNotifications() {
    const statusMsg  = /** @type {HTMLElement|null} */ (document.getElementById('notifStatusMsg'));
    const enableBtn  = /** @type {HTMLButtonElement|null} */ (document.getElementById('notifEnableBtn'));
    const disableBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('notifDisableBtn'));
    const deniedMsg  = /** @type {HTMLElement|null} */ (document.getElementById('notifDeniedMsg'));

    // Shared collapse helper — adds aria-expanded, role="button", and keyboard nav
    initCardCollapse('notifToggleHeader', 'notifBody', 'notifChevron');

    // notifSupported() returns false on iOS outside a standalone PWA — show
    // the add-to-home-screen message rather than a misleading "not supported".
    if (!notifSupported()) {
        if (statusMsg) statusMsg.textContent = isIOS()
            ? 'On iPhone/iPad, notifications only work when the app is added to your Home Screen. Tap Share → Add to Home Screen, then open from your Home Screen and return here.'
            : 'Push notifications are not supported on this device or browser.';
        if (enableBtn)  enableBtn.style.display  = 'none';
        if (disableBtn) disableBtn.style.display = 'none';
        return;
    }

    if (!statusMsg || !enableBtn || !disableBtn || !deniedMsg) return;

    const _statusMsg  = /** @type {HTMLElement} */ (statusMsg);
    const _enableBtn  = /** @type {HTMLButtonElement} */ (enableBtn);
    const _disableBtn = /** @type {HTMLButtonElement} */ (disableBtn);
    const _deniedMsg  = /** @type {HTMLElement} */ (deniedMsg);

    // peekNotifState reads state without triggering the VAPID-rotation side effect —
    // calendar-app.js runs the full getNotifState() on load; this page only needs to read.
    async function refreshUI() {
        const state = await peekNotifState();
        _enableBtn.style.display  = 'none';
        _disableBtn.style.display = 'none';
        _deniedMsg.style.display  = 'none';
        _enableBtn.disabled  = false;
        _disableBtn.disabled = false;
        _enableBtn.textContent  = 'Enable notifications';
        _disableBtn.textContent = 'Disable notifications';
        if (state === 'on') {
            _statusMsg.textContent    = 'Notifications are on — you\'ll be alerted when the Daily Huddle is ready or payday is approaching.';
            _disableBtn.style.display = 'block';
        } else if (state === 'off-lapsed') {
            _statusMsg.textContent   = 'Notifications were switched on but have stopped. Tap Enable to turn them back on.';
            _enableBtn.style.display = 'block';
        } else if (state === 'denied') {
            _statusMsg.textContent   = 'Notifications are blocked. To re-enable, check your browser or device settings.';
            if (isIOS()) {
                _deniedMsg.textContent = 'On iPhone/iPad: Settings → Chrome or Safari → Notifications → Allow.';
            } else if (/Android/i.test(navigator.userAgent)) {
                _deniedMsg.textContent = 'On Android: tap the padlock in Chrome → Site settings → Notifications → Allow.';
            } else {
                _deniedMsg.textContent = 'In Chrome: click the padlock in the address bar → Site settings → Notifications → Allow.';
            }
            _deniedMsg.style.display = 'block';
        } else {
            _statusMsg.textContent   = 'Tap Enable to get an alert when the Daily Huddle is ready or payday is approaching.';
            _enableBtn.style.display = 'block';
        }
    }

    const safeRefresh = () => refreshUI().catch(err => console.warn('[Notifications] Refresh error:', err));

    _enableBtn.addEventListener('click', async () => {
        _enableBtn.disabled = true;
        _enableBtn.textContent = 'Enabling…';
        await enableNotifications().catch(err => console.warn('[Notifications] Enable failed:', err));
        await safeRefresh();
    });

    _disableBtn.addEventListener('click', async () => {
        _disableBtn.disabled = true;
        _disableBtn.textContent = 'Disabling…';
        await disableNotifications().catch(err => console.warn('[Notifications] Disable failed:', err));
        await safeRefresh();
    });

    safeRefresh();
}

// ============================================
// DAILY HUDDLE UPLOAD — admin only
// ============================================
// The card HTML is always in the DOM but hidden via style="display:none".
// This block reveals it and wires up the upload flow only when the signed-in
// user is an admin. Non-admins never see the card.
/** @param {File} f */
function _isDocx(f) {
    return f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        || f.name.toLowerCase().endsWith('.docx');
}

/**
 * Load the Mammoth DOCX→HTML converter from CDN once (SRI-pinned; the hash is patched by
 * generate-sri.mjs — do not edit by hand). Resolves when window.mammoth is available.
 * @returns {Promise<void>}
 */
function _loadMammoth() {
    return new Promise((resolve, reject) => {
        if (/** @type {any} */ (window).mammoth) { resolve(); return; }
        const sc = document.createElement('script');
        sc.src         = 'https://cdn.jsdelivr.net/npm/mammoth@1.12.0/mammoth.browser.min.js';
        sc.crossOrigin = 'anonymous';
        sc.integrity   = 'sha384-fWLn06AIo00H32MDcWUZTT+4Ru3OuoYn1DRH0o6JkhDl89YFSF4tJ4odze9bI+4r';
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
    if (!_isDocx(file)) return { extraArgs: [null] }; // PDF → no inline HTML
    setBtnText('Converting…');
    let htmlContent = null;
    try {
        await _loadMammoth();
        const arrayBuffer = await file.arrayBuffer();
        // @ts-ignore — mammoth is loaded onto window by _loadMammoth
        const result = await mammoth.convertToHtml({ arrayBuffer });
        const html = result.value || null;
        htmlContent = html && html.length < 200_000 ? html : null;
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
        successMsg: date => `Huddle uploaded for ${date} — staff will see it on the main app`,
        btnLabel: 'Upload Huddle', logPrefix: 'Huddle',
        maxDateOffsetDays: 1,
        isAccepted: f => isPdfFile(f) || _isDocx(f),
        rejectTypeMsg: 'Please choose a PDF or Word (.docx) file',
        sigMismatchMsg: "That file isn't a valid PDF or Word document — please choose the original file",
        transform: _convertHuddleDocx,
    });
}
