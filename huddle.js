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
import { notifSupported, getNotifState, enableNotifications, disableNotifications } from './notif.js';
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
 * Used by admin.html where notifications are available to all staff.
 */
export function initHuddleNotifications() {
    _initNotificationsCard();
}

// ============================================
// NOTIFICATIONS CARD — all staff
// ============================================
// Lets staff enable or disable Huddle and pay-reminder push notifications.
// Shows current permission state and provides appropriate action buttons.
// Subscribe/unsubscribe logic lives in notif.js — edit there for VAPID changes.

function _initNotificationsCard() {
    const statusMsg  = document.getElementById('notifStatusMsg');
    const enableBtn  = document.getElementById('notifEnableBtn');
    const disableBtn = document.getElementById('notifDisableBtn');
    const deniedMsg  = document.getElementById('notifDeniedMsg');

    // Shared collapse helper — adds aria-expanded, role="button", and keyboard nav
    initCardCollapse('notifToggleHeader', 'notifBody', 'notifChevron');

    // notifSupported() returns false on iOS outside a standalone PWA — show
    // the add-to-home-screen message rather than a misleading "not supported".
    if (!notifSupported()) {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        if (statusMsg) statusMsg.textContent = isIOS
            ? 'On iPhone/iPad, notifications only work when the app is added to your Home Screen. Tap Share → Add to Home Screen, then open from your Home Screen and return here.'
            : 'Push notifications are not supported on this device or browser.';
        if (enableBtn)  enableBtn.style.display  = 'none';
        if (disableBtn) disableBtn.style.display = 'none';
        return;
    }

    async function refreshUI() {
        const state = await getNotifState();
        enableBtn.style.display  = 'none';
        disableBtn.style.display = 'none';
        deniedMsg.style.display  = 'none';
        if (state === 'on') {
            statusMsg.textContent    = 'Notifications are on — you\'ll be alerted when the Huddle is ready and when payday is approaching.';
            disableBtn.style.display = 'block';
        } else if (state === 'off-lapsed') {
            statusMsg.textContent   = 'Notifications are enabled in your browser but your subscription has lapsed. Tap Enable to resubscribe.';
            enableBtn.style.display = 'block';
        } else if (state === 'denied') {
            statusMsg.textContent   = 'Notifications are blocked. To re-enable, change your browser settings.';
            deniedMsg.style.display = 'block';
        } else {
            statusMsg.textContent   = 'Tap Enable to get an alert when the daily Huddle is ready or when payday is approaching.';
            enableBtn.style.display = 'block';
        }
    }

    enableBtn.addEventListener('click', async () => {
        await enableNotifications().catch(err => console.warn('[Notifications] Enable failed:', err));
        await refreshUI().catch(err => console.warn('[Notifications] Refresh error:', err));
    });

    disableBtn.addEventListener('click', async () => {
        await disableNotifications().catch(err => console.warn('[Notifications] Disable failed:', err));
        await refreshUI().catch(err => console.warn('[Notifications] Refresh error:', err));
    });

    refreshUI().catch(err => console.warn('[Notifications] Init error:', err));
}

// ============================================
// DAILY HUDDLE UPLOAD — admin only
// ============================================
// The card HTML is always in the DOM but hidden via style="display:none".
// This block reveals it and wires up the upload flow only when the signed-in
// user is an admin. Non-admins never see the card.
function _initHuddleUpload(currentIsAdmin, currentUser) {
    if (!currentIsAdmin) return;

    const card      = document.getElementById('huddleUploadCard');
    const dateInput = document.getElementById('huddleDate');
    const fileInput = document.getElementById('huddleFileInput');
    const fileLabel = document.getElementById('huddleFileName');
    const uploadBtn = document.getElementById('huddleUploadBtn');
    const feedback  = document.getElementById('huddleFeedback');

    if (!card || !dateInput || !fileInput || !uploadBtn) return;

    // Reveal card for admin
    card.style.display = '';

    // Default date to today
    dateInput.value = formatISO(new Date());

    function _rejectFile(reason) {
        fileLabel.style.display = 'none';
        uploadBtn.disabled = true;
        feedback.textContent = reason;
        feedback.className = 'huddle-feedback huddle-feedback--err';
        fileInput.value = '';
    }

    // Show chosen filename and enable upload button when a file is selected
    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        feedback.textContent = '';
        feedback.className = 'huddle-feedback';
        if (!file) {
            fileLabel.style.display = 'none';
            uploadBtn.disabled = true;
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
        fileLabel.textContent = file.name;
        fileLabel.style.display = '';
        uploadBtn.disabled = false;
    });

    uploadBtn.addEventListener('click', async () => {
        const date = dateInput.value;
        const file = fileInput.files[0];
        if (!date || !file) return;

        uploadBtn.disabled = true;
        feedback.textContent = '';
        feedback.className = 'huddle-feedback';

        let htmlContent = null;
        const isDocx = file.name.toLowerCase().endsWith('.docx');
        if (isDocx) {
            uploadBtn.textContent = 'Converting…';
            try {
                await new Promise((resolve, reject) => {
                    if (window.mammoth) { resolve(); return; }
                    const s = document.createElement('script');
                    s.src         = 'https://cdn.jsdelivr.net/npm/mammoth@1.12.0/mammoth.browser.min.js';
                    s.crossOrigin = 'anonymous';
                    s.integrity   = 'sha384-fWLn06AIo00H32MDcWUZTT+4Ru3OuoYn1DRH0o6JkhDl89YFSF4tJ4odze9bI+4r';
                    s.onload      = resolve;
                    s.onerror     = () => reject(new Error('load'));
                    document.head.appendChild(s);
                });
                const arrayBuffer = await file.arrayBuffer();
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
                feedback.textContent = convErr.message === 'load'
                    ? 'Could not load Word converter — check your connection and try again'
                    : 'Could not read the Word file — make sure it is a valid .docx';
                feedback.className = 'huddle-feedback huddle-feedback--err';
                uploadBtn.disabled = false;
                uploadBtn.textContent = 'Upload Huddle';
                return;
            }
        }

        uploadBtn.textContent = 'Uploading…';

        try {
            // Operations starts Firebase Auth restoration in the background
            // (window._mybSession). A returning admin with a valid localStorage
            // session skips the login handler, so auth.currentUser may still be
            // null for a moment after the page opens. uploadHuddle writes to
            // Storage + Firestore, both admin-gated — without this await a fast
            // click (especially a PDF, which skips DOCX conversion) could hit a
            // permission failure before the session is live. Mirrors the roster
            // upload path's getIdToken guard in operations-app.js.
            if (window._mybSession) await window._mybSession;
            await uploadHuddle(date, file, currentUser, htmlContent);
            feedback.textContent = `Huddle uploaded for ${date} — staff will see it on the main app`;
            feedback.className = 'huddle-feedback huddle-feedback--ok';
            fileInput.value = '';
            fileLabel.textContent = '';
            fileLabel.style.display = 'none';
        } catch (err) {
            console.error('[Huddle] Upload failed:', err);
            feedback.textContent = 'Upload failed — please try again';
            feedback.className = 'huddle-feedback huddle-feedback--err';
            uploadBtn.disabled = false;
        }

        uploadBtn.textContent = 'Upload Huddle';
    });
}

