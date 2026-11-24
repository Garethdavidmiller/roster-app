// @ts-check
/**
 * notif-card.js — the Settings page's Notifications card: reads this device's state, paints it, and
 *   wires Enable and Disable.
 *
 * Owns: the card's wiring — when it reads, what it paints, its two buttons, and the one re-registration
 *   Settings makes as it opens.
 * Does NOT own: the words or the state reported for each case (notif-card-core.js, pure), the push
 *   lifecycle and the VAPID key (notif.js), what a card state means to the summary (settings-status.js),
 *   or the rest of Settings (settings-app.js, which calls `initNotificationsCard` once).
 * Edit here for: when the card re-reads, the buttons' behaviour, the card's markup hooks.
 *
 * Its own module since 22 Nov 2026: it lived in huddle.js beside the Daily Huddle upload, so Settings
 * loaded the upload card's code — doc-upload.js and the Huddle's Firestore calls — to draw a toggle.
 *
 * ── IT RE-READS WHEN THE ANSWER CAN HAVE CHANGED ELSEWHERE ────────────────────────────────────────
 *
 * The permission is changed OUTSIDE the page — a member blocked, follows the card's steps in the
 * phone's settings and comes back — so a card that read only once showed "Blocked" until a reload.
 * It re-reads when the page becomes visible again, when it is restored from the back/forward cache
 * (`pageshow` with `persisted`), when the browser reports the permission changed (Permissions API,
 * where there is one), and when another control on the page changes the setting (`myb:notif-changed`
 * — the drawer's bell). A read started before a later one is never painted over it (`_gen`), and a
 * read is not painted while a button's own action is in flight; that action repaints when it ends.
 *
 * ── SETTINGS RE-REGISTERS THE DEVICE ONCE (owner, 22 Nov 2026) ───────────────────────────────────
 *
 * Every other read here is `peekNotifState`, which writes nothing. But a record released at a
 * sign-out (`releaseDevicePush`) was saved again only by a signed-in Calendar load, so a member who
 * signed back in on Settings read "✓ On" with nothing behind it. So once the session is ready, the
 * card runs `getNotifState()` ONCE: it re-saves the `pushSubscriptions` record at once when the
 * account it was saved under differs (or is unknown), and at most once a day otherwise.
 *
 * ── ENABLE ASKS AT ONCE, SAVES AFTER THE SESSION, AND NEVER WAITS FOR EVER ON THE BROWSER ──────────
 *
 * `savePushSubscription` names the record's owner from the signed-in account AT THAT MOMENT, so a tap
 * before the session was ready saved a record with no owner, or none at all. So the subscribe waits
 * for `sessionReady` — but the PERMISSION REQUEST does not: iPhone Safari (and Firefox) show the
 * prompt only while the tap's user activation lasts, and v26.53's wait in front of the request could
 * outlive it, so a tap during the sign-in on opening Settings got no prompt. The handler calls
 * `enableNotifications` before it awaits anything, and passes the wait as its `beforeSubscribe`. And `Notification.requestPermission()` may never settle — Chrome's quiet
 * prompt is a small icon a member can miss — so after `askLimitMs` with the question still unanswered
 * the button comes back with a line saying the browser is still asking. Only the ASK is bounded here:
 * once permission is answered, the subscribe and its save have their own limits (notif.js).
 */

import { notifSupported, peekNotifState, getNotifState, enableNotifications, disableNotifications,
    notifOffByChoice, isIOS, isStandalonePWA, onPagesMirror } from './notif.js';
import { notifCardWords, homeScreenLabel, timetableListed, punctuateKinds,
    STILL_ASKING_LINE, ENABLE_FAILED_LINE } from './notif-card-core.js';
import { initCardCollapse } from './overlay.js';

/** How long Enable waits on an unanswered permission question before giving the button back. */
const ASK_LIMIT_MS = 15_000;

/**
 * Wire the Notifications card. Used by settings.html, where notifications are available to all staff.
 *
 * @param {object} [opts]
 * @param {(state: 'ok'|'error'|'action'|'blocked'|'n/a', chip: string, tone?: 'plain') => void} [opts.onState]
 *   called whenever the card learns what state this device is in, so Settings can put a chip in the
 *   header and count the card in its summary WITHOUT this module importing that page. `tone` is passed
 *   only to stop the chip being coloured by its state (v25.14): an `ok` "Off" the member chose.
 * @param {boolean} [opts.payReminders] whether THIS member is sent the pay reminder — only CEA and CES
 *   are (`PAY_REMINDER_GRADES`, functions/pay-reminder.js); without it the card names the rest alone.
 * @param {Promise<boolean>} [opts.sessionReady] the page's `sessionReady` (session.js): Enable's subscribe
 *   waits for it (the permission request does not), and the once-per-open re-registration runs when it resolves true.
 * @param {number} [opts.askLimitMs] how long Enable waits on an unanswered permission question.
 * @param {() => Date} [opts.now] the clock the timetable item is listed by.
 * @returns {{ setOpen(open: boolean): void }} the card's collapse handle, so a caller can open it once
 *   it knows the state warrants it.
 */
export function initNotificationsCard({ onState, payReminders = false, sessionReady = Promise.resolve(false),
    askLimitMs = ASK_LIMIT_MS, now = () => new Date() } = {}) {
    const statusMsg  = /** @type {HTMLElement|null} */ (document.getElementById('notifStatusMsg'));
    const enableBtn  = /** @type {HTMLButtonElement|null} */ (document.getElementById('notifEnableBtn'));
    const disableBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('notifDisableBtn'));
    const deniedMsg  = /** @type {HTMLElement|null} */ (document.getElementById('notifDeniedMsg'));

    // What the card lists — before the support check, because the subtitle shows on every device. The
    // pay reminder only to the members it is sent to; the timetable change only while one is due.
    for (const id of ['notifHintPay', 'notifKindPay']) {
        const el = document.getElementById(id);
        if (el) el.hidden = !payReminders;
    }
    const timetable = document.getElementById('notifKindTimetable');
    if (timetable) timetable.hidden = !timetableListed(now());
    const shownKinds = [...document.querySelectorAll('#notifKinds .notif-kind')].filter(el => !(/** @type {HTMLElement} */ (el)).hidden);
    punctuateKinds(shownKinds.map(el => el.textContent ?? '')).forEach((text, i) => { shownKinds[i].textContent = text; });

    const collapse = initCardCollapse('notifToggleHeader', 'notifBody', 'notifChevron');

    /** The device facts the words need, besides the state. @returns {Omit<import('./notif-card-core.js').NotifDevice, 'state'>} */
    const device = () => ({
        supported: notifSupported(), offByChoice: notifOffByChoice(), ios: isIOS(),
        android: /Android/i.test(navigator.userAgent), installed: isStandalonePWA(), onMirror: onPagesMirror(),
        appLabel: homeScreenLabel(document),
    });

    /** Say whether, and as whose, the card lists what it sends. @param {'shown'|'after-install'|'hidden'} how */
    const showKinds = (how) => {
        const list = document.getElementById('notifKinds');
        if (list) list.hidden = how === 'hidden';
        const lead = document.getElementById('notifKindsLead');
        if (lead) lead.textContent = how === 'after-install' ? 'In the Home Screen app, you’ll get:' : 'You’ll get:';
    };

    if (!notifSupported()) {
        const words = notifCardWords({ ...device(), state: 'unsupported' });
        if (statusMsg) statusMsg.textContent = words.status;
        if (enableBtn)  enableBtn.style.display  = 'none';
        if (disableBtn) disableBtn.style.display = 'none';
        showKinds(words.kinds);
        // Not a to-do and not a fault: this device cannot do it (or not until it is installed, which the
        // Install card's own to-do names), so it must neither nag nor hold back a complete summary.
        onState?.(words.report, words.chip);
        return collapse;
    }

    // REPORT BEFORE BAILING (v22.42). `unknown` outranks every answer in the summary, so a silent return
    // here froze Settings on "Checking your settings…". The markup is missing, so nothing was learnt:
    // `n/a` would claim this device cannot do notifications, which is a different, unearned statement.
    if (!statusMsg || !enableBtn || !disableBtn || !deniedMsg) {
        onState?.('error', 'Couldn’t check');
        return collapse;
    }
    const _statusMsg  = /** @type {HTMLElement} */ (statusMsg);
    const _enableBtn  = /** @type {HTMLButtonElement} */ (enableBtn);
    const _disableBtn = /** @type {HTMLButtonElement} */ (disableBtn);
    const _deniedMsg  = /** @type {HTMLElement} */ (deniedMsg);

    /** Paint one state. @param {'on'|'off-default'|'off-lapsed'|'denied'|'unsupported'} state */
    function paint(state) {
        const words = notifCardWords({ ...device(), state });
        _enableBtn.disabled  = false;
        _disableBtn.disabled = false;
        _enableBtn.textContent  = 'Enable notifications';
        _disableBtn.textContent = 'Disable notifications';
        _enableBtn.style.display  = words.button === 'enable'  ? 'block' : 'none';
        _disableBtn.style.display = words.button === 'disable' ? 'block' : 'none';
        _statusMsg.textContent = words.status;
        const steps = words.steps;
        if (!steps) {
            _deniedMsg.replaceChildren();
            _deniedMsg.style.display = 'none';
        } else {
            if ('text' in steps) _deniedMsg.textContent = steps.text;
            else _deniedMsg.replaceChildren(steps.lead,
                Object.assign(document.createElement('span'), { className: 'nav-path', textContent: steps.route }), steps.tail);
            _deniedMsg.style.display = 'block';
        }
        showKinds(words.kinds);
        onState?.(words.report, words.chip, words.tone);
    }

    let _gen = 0;          // the newest read started; an older one that lands later is not painted
    let _busy = false;     // a button's action is in flight — it repaints when it ends
    /** @param {() => Promise<any>} [read] */
    async function refresh(read = peekNotifState) {
        const gen = ++_gen;
        const state = await read();
        if (gen !== _gen || _busy) return;
        paint(state);
    }
    const safeRefresh = (/** @type {() => Promise<any>} */ read = peekNotifState) =>
        refresh(read).catch(err => console.warn('[Notifications] Refresh error:', err));

    // Changed elsewhere — see the header.
    document.addEventListener('myb:notif-changed', () => safeRefresh());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') safeRefresh(); });
    window.addEventListener('pageshow', (e) => { if (/** @type {PageTransitionEvent} */ (e).persisted) safeRefresh(); });
    try {
        navigator.permissions?.query({ name: /** @type {PermissionName} */ ('notifications') })
            .then(status => status.addEventListener('change', () => safeRefresh()))
            .catch(() => { /* no Permissions API for notifications here — the other three still re-read */ });
    } catch { /* a browser whose query throws synchronously */ }

    _enableBtn.addEventListener('click', async () => {
        _busy = true;
        _enableBtn.disabled = true;
        _enableBtn.textContent = 'Enabling…';
        // NOTHING IS AWAITED BEFORE THIS CALL: it asks for permission at once, inside the tap, which
        // iPhone Safari requires. The record's owner is the account signed in when it is SAVED, so the
        // session is awaited after the answer, before the subscribe — see the header.
        let settled = false;
        const run = enableNotifications({ beforeSubscribe: () => Promise.resolve(sessionReady) })
            .catch(err => { console.warn('[Notifications] Enable failed:', err); return 'off-lapsed'; })
            .finally(() => { settled = true; });
        const timer = setTimeout(() => {
            // Bounded on the ASK alone: past it, the subscribe's own limits apply (notif.js). The
            // button comes back; should the question be answered later, the enable still finishes
            // and repaints the card below.
            if (settled || Notification.permission !== 'default') return;
            _busy = false;
            safeRefresh().then(() => { if (!settled) _statusMsg.textContent = STILL_ASKING_LINE; });
        }, askLimitMs);
        const result = await run;
        clearTimeout(timer);
        _busy = false;
        await safeRefresh();
        // A failed subscribe used to leave the card exactly as it was, as if the tap had not landed.
        // (A dismissed prompt is 'off-default' and a refusal 'denied' — both say so above.)
        if (result === 'off-lapsed') _statusMsg.textContent = ENABLE_FAILED_LINE;
    });

    _disableBtn.addEventListener('click', async () => {
        _busy = true;
        _disableBtn.disabled = true;
        _disableBtn.textContent = 'Disabling…';
        await disableNotifications().catch(err => console.warn('[Notifications] Disable failed:', err));
        _busy = false;
        await safeRefresh();
    });

    safeRefresh();
    // Once per open, signed in: re-save this device's record (see the header), then paint what it found.
    Promise.resolve(sessionReady)
        .then(ok => (ok ? safeRefresh(getNotifState) : undefined))
        .catch(err => console.warn('[Notifications] Re-registration failed:', err));
    return collapse;
}
