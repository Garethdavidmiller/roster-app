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

import { formatISO } from './roster-data.js';
import { uploadHuddle } from './firebase-client.js';
import { notifSupported, peekNotifState, enableNotifications, disableNotifications, isIOS } from './notif.js';
import { sessionReady } from './session.js';
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
            _statusMsg.textContent    = 'Notifications are on — you\'ll be alerted when payday is approaching. (Daily Huddle alerts temporarily paused)';
            _disableBtn.style.display = 'block';
        } else if (state === 'off-lapsed') {
            _statusMsg.textContent   = 'Notifications are enabled in your browser but your subscription has lapsed. Tap Enable to resubscribe.';
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
            _statusMsg.textContent   = 'Tap Enable to get an alert when payday is approaching. (Daily Huddle alerts temporarily paused)';
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
function _initHuddleUpload(/** @type {boolean} */ currentIsAdmin, /** @type {string|null} */ currentUser) {
    if (!currentIsAdmin) return;

    const card      = document.getElementById('huddleUploadCard');
    const dateInput = /** @type {HTMLInputElement|null} */ (document.getElementById('huddleDate'));
    const fileInput = /** @type {HTMLInputElement|null} */ (document.getElementById('huddleFileInput'));
    const fileLabel = document.getElementById('huddleFileName');
    const uploadBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('huddleUploadBtn'));
    const feedback  = document.getElementById('huddleFeedback');

    if (!card || !dateInput || !fileInput || !uploadBtn || !fileLabel || !feedback) return;

    const _fileLabel = /** @type {HTMLElement} */ (fileLabel);
    const _uploadBtn = /** @type {HTMLButtonElement} */ (uploadBtn);
    const _feedback  = /** @type {HTMLElement} */ (feedback);
    const _fileInput = /** @type {HTMLInputElement} */ (fileInput);

    // Reveal card for admin
    card.style.display = '';

    // Default date to today
    dateInput.value = formatISO(new Date());

    function _rejectFile(/** @type {string} */ reason) {
        _fileLabel.classList.remove('visible');
        _uploadBtn.disabled = true;
        _feedback.textContent = reason;
        _feedback.className = 'huddle-feedback huddle-feedback--err';
        _fileInput.value = '';
    }

    // Show chosen filename and enable upload button when a file is selected
    _fileInput.addEventListener('change', () => {
        const file = (_fileInput.files || [])[0];
        _feedback.textContent = '';
        _feedback.className = 'huddle-feedback';
        if (!file) {
            _fileLabel.classList.remove('visible');
            _uploadBtn.disabled = true;
            return;
        }
        const isPdf  = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        const isDocx = file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                    || file.name.toLowerCase().endsWith('.docx');
        if (!isPdf && !isDocx) {
            _rejectFile('Please choose a PDF or Word (.docx) file');
            return;
        }
        if (file.size > 20 * 1024 * 1024) {
            _rejectFile('File too large — maximum 20 MB');
            return;
        }
        _fileLabel.textContent = file.name;
        _fileLabel.classList.add('visible');
        _uploadBtn.disabled = false;
    });

    _uploadBtn.addEventListener('click', async () => {
        const date = dateInput.value;
        const file = (_fileInput.files || [])[0];
        if (!date || !file) return;

        _uploadBtn.disabled = true;
        _feedback.textContent = '';
        _feedback.className = 'huddle-feedback';

        let htmlContent = null;
        const isDocx = file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                    || file.name.toLowerCase().endsWith('.docx');
        if (isDocx) {
            _uploadBtn.textContent = 'Converting…';
            try {
                await new Promise(/** @param {(v?: any) => void} resolve @param {(e: any) => void} reject */ (resolve, reject) => {
                    if (/** @type {any} */ (window).mammoth) { resolve(); return; }
                    const s = document.createElement('script');
                    s.src         = 'https://cdn.jsdelivr.net/npm/mammoth@1.12.0/mammoth.browser.min.js';
                    s.crossOrigin = 'anonymous';
                    s.integrity   = 'sha384-fWLn06AIo00H32MDcWUZTT+4Ru3OuoYn1DRH0o6JkhDl89YFSF4tJ4odze9bI+4r';
                    s.onload      = resolve;
                    s.onerror     = () => reject(new Error('load'));
                    document.head.appendChild(s);
                });
                const arrayBuffer = await file.arrayBuffer();
                // @ts-ignore
                const result      = await mammoth.convertToHtml({ arrayBuffer });
                const html        = result.value || null;
                // Cap at 200 KB — a Huddle is a short daily briefing; anything larger
                // indicates an unexpected document or conversion anomaly. Fall back to
                // the Storage URL so the viewer downloads the file directly.
                // Matches the cap in functions/index.js so inline behaviour is consistent
                // regardless of whether the Huddle arrived via Power Automate or manual upload.
                htmlContent = html && html.length < 200_000 ? html : null;
            } catch (convErr) {
                console.error('[Huddle] DOCX conversion failed:', convErr);
                if ((/** @type {any} */ (convErr)).message === 'load') {
                    // The converter CDN was unreachable — but the .docx itself is fine.
                    // Don't block the upload: proceed with htmlContent = null so the file
                    // still reaches Storage and the viewer falls back to its "Open Huddle"
                    // download button (exactly the PDF path). Better a download-only Huddle
                    // than no Huddle when the admin is on a poor connection.
                    console.warn('[Huddle] Word converter unavailable — uploading DOCX without inline preview.');
                    htmlContent = null;
                    // fall through to the upload step
                } else {
                    // A real parse failure: the file could not be read as a valid .docx.
                    // Abort rather than store a file that may be corrupt or mislabelled.
                    _feedback.textContent = "Couldn't read the Word file — make sure it is a valid .docx";
                    _feedback.className = 'huddle-feedback huddle-feedback--err';
                    _uploadBtn.disabled = false;
                    _uploadBtn.textContent = 'Upload Huddle';
                    return;
                }
            }
        }

        _uploadBtn.textContent = 'Uploading…';

        try {
            // sessionReady resolves once the page coordinator confirms the Firebase
            // Auth session. A returning admin skips the login handler so auth.currentUser
            // may still be null when the page opens — awaiting here prevents a fast click
            // hitting a permission failure before the session is live.
            await sessionReady;
            await uploadHuddle(date, file, currentUser || '', htmlContent);
            _feedback.textContent = `Huddle uploaded for ${date} — staff will see it on the main app`;
            _feedback.className = 'huddle-feedback huddle-feedback--ok';
            _fileInput.value = '';
            _fileLabel.textContent = '';
            _fileLabel.classList.remove('visible');
        } catch (err) {
            console.error('[Huddle] Upload failed:', err);
            _feedback.textContent = (/** @type {any} */ (err))?.message === 'SIGNATURE_MISMATCH'
                ? "That file isn't a valid PDF or Word document — please choose the original file"
                : 'Upload failed — please try again';
            _feedback.className = 'huddle-feedback huddle-feedback--err';
            _uploadBtn.disabled = false;
        }

        _uploadBtn.textContent = 'Upload Huddle';
    });
}

