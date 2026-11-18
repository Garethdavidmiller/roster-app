// @ts-check
/**
 * huddle.js — the Daily Huddle's manual upload, and the Notifications card's wiring.
 *
 * Owns: Notifications card (Settings, all staff), daily Huddle manual upload (Operations, admin only),
 *   including the browser's own DOCX→HTML conversion of a manually uploaded Word Huddle.
 * Does NOT own: Huddle ingest Cloud Function (functions/huddle-ingest.js), Firestore huddles
 *   collection writes (uploadHuddle, via firebase-client.js), the VAPID key and re-subscription
 *   (notif.js), roster data (roster-data.js), the Huddle card's collapse toggle (operations-app.js,
 *   with the page's other cards).
 * Edit here for: notification subscribe/unsubscribe UI, Huddle file upload form.
 */

import { uploadHuddle, getLatestHuddle } from './firebase-client.js';
import { initDocUploadCard, isPdfFile, isDocxFile } from './doc-upload.js';
import { notifSupported, peekNotifState, enableNotifications, disableNotifications, isIOS, notifOffByChoice } from './notif.js';
import { initCardCollapse } from './overlay.js';

/**
 * Wires the Huddle upload card. Used by operations.html, an admin-only page whose markup always holds
 * the card; its collapse toggle is operations-app.js's, wired with the page's other cards.
 * @param {{ currentIsAdmin: boolean, currentUser: string|null }} cfg
 */
export function initHuddleUpload({ currentIsAdmin, currentUser }) {
    _initHuddleUpload(currentIsAdmin, currentUser);
}

/**
 * Initialises the Notifications card only.
 * Used by settings.html where notifications are available to all staff.
 *
 * @param {{ onState?: (state: 'ok'|'error'|'action'|'blocked'|'n/a', chip: string, tone?: 'plain') => void, payReminders?: boolean }} [opts]
 *   `onState` is called whenever the card learns what state this device is in. It exists so
 *   Settings can put a chip in the header and count the card in its summary WITHOUT this module
 *   importing anything from that page — the words below are already the authority on what each
 *   state means, and a second reading of `peekNotifState` elsewhere could disagree with them.
 *   `tone` is passed only to stop the chip being coloured by its state (v25.14): Settings colours
 *   an `ok` chip green, which is right for "✓ On" and wrong for an "Off" the member chose.
 *   `payReminders` — whether THIS member is sent the pay reminder. Only CEA and CES are
 *   (`PAY_REMINDER_GRADES`, functions/pay-reminder.js), and the card promised it to everybody — its
 *   subtitle, its list and both of its status lines (whole-app check, 17 Nov 2026). Without it the
 *   card names documents alone, which is true for everyone.
 * @returns {{ setOpen(open: boolean): void }} the card's collapse handle, so a caller can open it
 *   once it knows the state warrants it.
 */
export function initHuddleNotifications({ onState, payReminders = false } = {}) {
    const statusMsg  = /** @type {HTMLElement|null} */ (document.getElementById('notifStatusMsg'));
    const enableBtn  = /** @type {HTMLButtonElement|null} */ (document.getElementById('notifEnableBtn'));
    const disableBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('notifDisableBtn'));
    const deniedMsg  = /** @type {HTMLElement|null} */ (document.getElementById('notifDeniedMsg'));

    // The pay reminder, where the card names it, is shown to the members it is sent to and nobody else —
    // before the support check below, because the subtitle and the list show on every device.
    for (const id of ['notifHintPay', 'notifKindPay']) {
        const el = document.getElementById(id);
        if (el) el.hidden = !payReminders;
    }
    const alerted = payReminders ? 'when a new document arrives and before the pay cut-off' : 'when a new document arrives';

    // Shared collapse helper — adds aria-expanded, role="button", and keyboard nav
    const collapse = initCardCollapse('notifToggleHeader', 'notifBody', 'notifChevron');

    // notifSupported() returns false on iOS outside a standalone PWA — show
    // the add-to-home-screen message rather than a misleading "not supported".
    // A POINTER, NOT A SECOND COPY OF THE STEPS (polish round 2, owner-approved). The Install card
    // directly below already lists the taps on exactly this path (`initDeviceCard`: an iPhone, not
    // installed, not the mirror), so repeating them here gave the page two sets of instructions to
    // keep in step. On the Pages mirror that card never shows, so the mirror keeps the steps here,
    // browser-neutral like the card's own (v22.45 — name the control, not Safari's chrome). An
    // iPhone ALREADY on the Home Screen that still has no push (an iOS too old for it) has no card
    // either, and nothing to install — so it gets the plain "not supported" line.
    if (!notifSupported()) {
        const onMirror  = /github\.io$/i.test(window.location.hostname);
        const installed = window.matchMedia?.('(display-mode: standalone)').matches
            || /** @type {any} */ (window.navigator).standalone === true;
        if (statusMsg) statusMsg.textContent = !isIOS() || installed
            ? 'Push notifications are not supported on this device or browser.'
            : onMirror
                // NOT "add THIS page" (whole-app review, Oct 2026): installing the mirror is what the
                // install notice and the guide tell staff not to do — the install belongs to web.app.
                ? 'On iPhone or iPad, notifications only work in the app on your Home Screen. Open myb-roster.web.app and add it to your Home Screen from there.'
                : 'On iPhone or iPad, notifications only work once the app is on your Home Screen — see “Install on this device” below.';
        if (enableBtn)  enableBtn.style.display  = 'none';
        if (disableBtn) disableBtn.style.display = 'none';
        // Not a to-do and not a fault: this device cannot do it at all, so it must neither nag
        // nor hold back a summary that is otherwise complete.
        onState?.('n/a', 'Not available');
        return collapse;
    }

    // REPORT BEFORE BAILING (v22.42). `onState` feeds a summary in which `unknown` outranks every
    // answer, so returning silently here does not just cost this card its chip — it freezes the
    // whole Settings summary on "Checking your settings…", hiding to-dos on cards that are fine.
    // The markup is missing, so nothing was learnt: `n/a` would claim this device cannot do
    // notifications, which is a different and unearned statement.
    if (!statusMsg || !enableBtn || !disableBtn || !deniedMsg) {
        onState?.('error', 'Couldn’t check');
        return collapse;
    }

    const _statusMsg  = /** @type {HTMLElement} */ (statusMsg);
    const _enableBtn  = /** @type {HTMLButtonElement} */ (enableBtn);
    const _disableBtn = /** @type {HTMLButtonElement} */ (disableBtn);
    const _deniedMsg  = /** @type {HTMLElement} */ (deniedMsg);

    // peekNotifState reads state without triggering the VAPID-rotation side effect —
    // calendar-notif-prompt.js runs the full getNotifState() on load; this page only needs to read.
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
            _statusMsg.textContent    = `Notifications are on — you’ll be alerted ${alerted}.`;
            _disableBtn.style.display = 'block';
            onState?.('ok', '✓ On');
        } else if (state === 'off-lapsed') {
            _statusMsg.textContent   = 'Notifications were switched on but have stopped. Select “Enable notifications” to turn them back on.';
            _enableBtn.style.display = 'block';
            onState?.('action', 'Off');
        } else if (state === 'denied') {
            _statusMsg.textContent   = 'Notifications are blocked. To re-enable, check your browser or device settings.';
            if (isIOS()) {
                // An installed web app's permission lives in iOS Settings under the app's OWN name,
                // not under a browser (whole-app review, Oct 2026).
                _deniedMsg.textContent = 'On iPhone or iPad: open Settings → Notifications, find this app by its Home Screen name, and turn on Allow Notifications.';
            } else if (/Android/i.test(navigator.userAgent)) {
                // The INSTALLED app has no address bar, so no icon there to tap (whole-app check, 17 Nov 2026):
                // there the permission is the app's own, in the phone's settings — as on an iPhone.
                // IN A TAB THE ICON IS DESCRIBED, NOT NAMED A PADLOCK (18 Nov 2026): Chrome replaced the padlock
                // with a "two sliders" site icon in 2023, so a member looking for a padlock found none. Both are
                // said, because an older Chrome still draws the padlock.
                _deniedMsg.textContent = window.matchMedia?.('(display-mode: standalone)').matches
                    ? 'On Android: open your phone’s Settings → Apps, find this app by its home screen name, and turn on Notifications.'
                    : 'On Android: tap the icon at the left of Chrome’s address bar (a padlock or two sliders) → Site settings → Notifications → Allow.';
            } else {
                // The route is one unit (`.nav-path`), and the arrow into it keeps to the word before it
                // (a no-break space): a line that starts "→" reads as broken punctuation. WebKit broke
                // before that arrow where Chromium broke after it, so the space is what holds it.
                _deniedMsg.replaceChildren('In Chrome: click the icon at the left of the address bar (a padlock or two sliders)\u00a0→ ',
                    Object.assign(document.createElement('span'), { className: 'nav-path', textContent: 'Site settings → Notifications → Allow' }), '.');
            }
            _deniedMsg.style.display = 'block';
            // BLOCKED, not off. The member cannot fix this from here — the browser will refuse
            // to ask again — so the summary must name it rather than telling them to tap Enable.
            onState?.('blocked', 'Blocked');
        } else if (notifOffByChoice()) {
            // Switched off HERE, on purpose (Sep 2026 review). Not a to-do: the member decided.
            _statusMsg.textContent   = 'Notifications are off on this device. Select “Enable notifications” to turn them back on.';
            _enableBtn.style.display = 'block';
            // `ok` to the summary — nothing to do — but not good news, so the chip is not green:
            // a green "Off" would have the colour and the word disagree (v25.14).
            onState?.('ok', 'Off', 'plain');
        } else {
            _statusMsg.textContent   = `Select “Enable notifications” to get an alert ${alerted}.`;
            _enableBtn.style.display = 'block';
            onState?.('action', 'Off');
        }
    }

    const safeRefresh = () => refreshUI().catch(err => console.warn('[Notifications] Refresh error:', err));
    // Another control changed the setting — the drawer's bell, or a prompt (whole-app review, Oct 2026).
    document.addEventListener('myb:notif-changed', safeRefresh);

    _enableBtn.addEventListener('click', async () => {
        _enableBtn.disabled = true;
        _enableBtn.textContent = 'Enabling…';
        const result = await enableNotifications().catch(err => { console.warn('[Notifications] Enable failed:', err); return 'off-lapsed'; });
        await safeRefresh();
        // A failed subscribe used to leave the card exactly as it was, as if the tap had not landed.
        // (A dismissed permission prompt is 'off-default' and a refusal 'denied' — both say so above.)
        if (result === 'off-lapsed') {
            _statusMsg.textContent = 'Couldn’t turn notifications on. Check your connection and try again — if it keeps failing, contact the admin.';
        }
    });

    _disableBtn.addEventListener('click', async () => {
        _disableBtn.disabled = true;
        _disableBtn.textContent = 'Disabling…';
        await disableNotifications().catch(err => console.warn('[Notifications] Disable failed:', err));
        await safeRefresh();
    });

    safeRefresh();
    return collapse;
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
        successMsg: date => `Huddle uploaded for ${date} — staff will see it on the main app`,
        btnLabel: 'Upload Huddle', logPrefix: 'Huddle',
        whereToCheck: '☰ → Daily Huddle',
        // A later Huddle already filed — tomorrow's, sent the evening before — hides this one from staff.
        noun: 'Huddle', newest: getLatestHuddle,
        maxDateOffsetDays: 1,
        isAccepted: f => isPdfFile(f) || isDocxFile(f),
        rejectTypeMsg: 'Please choose a PDF or Word (.docx) file',
        sigMismatchMsg: "That file isn't a valid PDF or Word document — please choose the original file",
        transform: _convertHuddleDocx,
    });
}
