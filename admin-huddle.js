/**
 * admin-huddle.js — Huddle upload, Huddle collapse card, and push notifications.
 *
 * Owns: Notifications card (all staff), daily Huddle manual upload (admin only),
 *   Huddle viewer card collapse/expand toggle.
 * Does NOT own: Huddle ingest Cloud Function (functions/index.js), Firestore huddles
 *   collection writes (firebase-client.js uploadHuddle), roster data (roster-data.js).
 * Edit here for: notification subscribe/unsubscribe UI, VAPID key rotation handling,
 *   Huddle file upload form, Huddle card toggle.
 */

import { formatISO } from './roster-data.js?v=9.60';
import { uploadHuddle, savePushSubscription, deletePushSubscription } from './firebase-client.js?v=9.60';

/**
 * Initialises all three Huddle-related cards. Call once after authentication resolves.
 * @param {{ currentIsAdmin: boolean, currentUser: object|null, lsGet: Function, lsSet: Function }} cfg
 */
export function initHuddleCards({ currentIsAdmin, currentUser, lsGet, lsSet }) {
    _initNotificationsCard(lsGet, lsSet);
    _initHuddleUpload(currentIsAdmin, currentUser);
    _initHuddleCard();
}

// ============================================
// NOTIFICATIONS CARD — all staff
// ============================================
// Lets staff enable or disable Huddle and pay-reminder push notifications.
// Shows current permission state and provides appropriate action buttons.
function _initNotificationsCard(lsGet, lsSet) {
    const VAPID_PUBLIC_KEY = 'BDycpNlvciF7kfUv3yxSQ0iRzWdi3BDZipNf-vk7QYaOSsbbIgb5FRSW9GrJlZJlmThoyQrbK0t9sd3hEdmhgSg';

    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        const statusMsg = document.getElementById('notifStatusMsg');
        if (statusMsg) statusMsg.textContent = 'Push notifications are not supported on this device or browser.';
        return;
    }

    const header     = document.getElementById('notifToggleHeader');
    const body       = document.getElementById('notifBody');
    const chevron    = document.getElementById('notifChevron');
    const statusMsg  = document.getElementById('notifStatusMsg');
    const enableBtn  = document.getElementById('notifEnableBtn');
    const disableBtn = document.getElementById('notifDisableBtn');
    const deniedMsg  = document.getElementById('notifDeniedMsg');

    if (!header || !body || !chevron) return;

    // Collapse/expand
    header.addEventListener('click', () => {
        body.classList.toggle('open');
        chevron.textContent = body.classList.contains('open') ? '▴' : '▾';
    });

    // Fingerprint stored in localStorage so we can detect a VAPID key rotation.
    // Value is just the first 12 chars of the public key — enough to spot a change.
    const VAPID_VER_KEY     = 'myb_vapid_ver';
    const VAPID_FINGERPRINT = VAPID_PUBLIC_KEY.slice(0, 12);

    function vapidKey() {
        const base64 = VAPID_PUBLIC_KEY.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
        return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
    }

    async function refreshUI() {
        const perm = Notification.permission;
        const reg  = await navigator.serviceWorker.ready;
        let sub    = await reg.pushManager.getSubscription();

        // If the VAPID key has been rotated since this device subscribed, silently
        // unsubscribe and re-subscribe with the current key. Staff never see this happen.
        if (perm === 'granted' && sub && lsGet(VAPID_VER_KEY) !== VAPID_FINGERPRINT) {
            try {
                await sub.unsubscribe();
                sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey() });
                await savePushSubscription(sub);
                lsSet(VAPID_VER_KEY, VAPID_FINGERPRINT);
                console.log('[Notifications] Re-subscribed after VAPID key rotation');
            } catch (err) {
                console.warn('[Notifications] VAPID key refresh failed:', err);
                sub = null;
            }
        } else if (perm === 'granted' && sub) {
            lsSet(VAPID_VER_KEY, VAPID_FINGERPRINT);
        }

        const active = perm === 'granted' && !!sub;

        enableBtn.style.display  = 'none';
        disableBtn.style.display = 'none';
        deniedMsg.style.display  = 'none';

        if (perm === 'granted' && active) {
            statusMsg.textContent = 'Notifications are on — you\'ll be alerted when the Huddle is ready and when payday is approaching.';
            disableBtn.style.display = 'block';
        } else if (perm === 'granted' && !active) {
            statusMsg.textContent = 'Notifications are enabled in your browser but your subscription has lapsed. Tap Enable to resubscribe.';
            enableBtn.style.display = 'block';
        } else if (perm === 'denied') {
            statusMsg.textContent = 'Notifications are blocked. To re-enable, change your browser settings.';
            deniedMsg.style.display = 'block';
        } else {
            statusMsg.textContent = 'Tap Enable to get an alert when the daily Huddle is ready or when payday is approaching.';
            enableBtn.style.display = 'block';
        }
    }

    enableBtn.addEventListener('click', async () => {
        try {
            const perm = await Notification.requestPermission();
            if (perm === 'granted') {
                const reg = await navigator.serviceWorker.ready;
                const sub = await reg.pushManager.subscribe({
                    userVisibleOnly:      true,
                    applicationServerKey: vapidKey(),
                });
                await savePushSubscription(sub);
                lsSet(VAPID_VER_KEY, VAPID_FINGERPRINT);
            }
        } catch (err) {
            console.warn('[Notifications] Enable failed:', err);
        }
        await refreshUI();
    });

    disableBtn.addEventListener('click', async () => {
        try {
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.getSubscription();
            if (sub) {
                const endpoint = sub.endpoint;
                await sub.unsubscribe();
                await deletePushSubscription(endpoint).catch(() => {});
            }
        } catch (err) {
            console.warn('[Notifications] Disable failed:', err);
        }
        await refreshUI();
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
            fileLabel.style.display = 'none';
            uploadBtn.disabled = true;
            feedback.textContent = 'Please choose a PDF or Word (.docx) file';
            feedback.className = 'huddle-feedback huddle-feedback--err';
            fileInput.value = '';
            return;
        }
        if (file.size > 20 * 1024 * 1024) {
            fileLabel.style.display = 'none';
            uploadBtn.disabled = true;
            feedback.textContent = 'File too large — maximum 20 MB';
            feedback.className = 'huddle-feedback huddle-feedback--err';
            fileInput.value = '';
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
                    s.src     = 'https://cdn.jsdelivr.net/npm/mammoth@1.12.0/mammoth.browser.min.js';
                    s.onload  = resolve;
                    s.onerror = () => reject(new Error('load'));
                    document.head.appendChild(s);
                });
                const arrayBuffer = await file.arrayBuffer();
                const result      = await mammoth.convertToHtml({ arrayBuffer });
                const html        = result.value || null;
                // Firestore document limit is 1 MB — skip htmlContent if the conversion
                // is too large; the viewer will fall back to opening the Storage URL.
                htmlContent = html && html.length < 800_000 ? html : null;
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

// ============================================
// HUDDLE CARD — collapse/expand
// ============================================
function _initHuddleCard() {
    const header  = document.getElementById('huddleToggleHeader');
    const body    = document.getElementById('huddleBody');
    const chevron = document.getElementById('huddleChevron');
    if (!header || !body || !chevron) return;
    header.addEventListener('click', () => {
        const isOpen = body.classList.toggle('open');
        chevron.classList.toggle('open', isOpen);
    });
}
