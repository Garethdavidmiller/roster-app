// @ts-check
/**
 * calendar-notif-prompt.js — THE ONE-OFF NOTIFICATION PROMPT STRIP, AND THE SILENT RENEWAL.
 *
 * `initNotifPrompt({ authReady, getAccessType })`. Two jobs that share one guard:
 *   · permission already GRANTED → renew/migrate the subscription silently (the VAPID-rotation
 *     self-heal in notif.js), and show nothing;
 *   · permission never ASKED → show the one-off `#notifPrompt` strip on the Calendar, once per
 *     device, and never again once it has been answered either way.
 *
 * ── WHY IT LEFT THE COORDINATOR (v23.16) ────────────────────────────────────────────────────────
 *
 * Because calendar-app.js stood four lines under its ratchet and this was the largest self-contained
 * thing in it: an IIFE that closed over nothing the coordinator owns — it needed notif.js, ls.js,
 * the auth promise and the access type, and the last two now arrive as arguments, exactly the shape
 * install-prompt.js already takes. Moving it BEFORE the next Calendar rule arrives is the ratchet
 * working as designed; moving it under the pressure of that rule would have been the alternative.
 *
 * ── THE TWO ACCESS RULES, AND THE ONE THAT WOULD NOT OCCUR TO YOU ───────────────────────────────
 *
 * Both halves run for `named` and `open` access and NEVER for the shared Calendar viewer:
 *   1. RENEWAL re-stamps the subscription's `owner` with the current Firebase uid — and under the
 *      staff-PIN viewer that uid is the SAME on every office PC in the building. One machine's
 *      renewal would overwrite the owner of a real member's subscription, and any viewer anywhere
 *      could then delete it. Skipping is write-free, so an existing subscription is left exactly as
 *      it was; the only loss is VAPID-rotation self-healing during a viewer session, on a machine
 *      that should not be carrying anybody's notifications.
 *   2. THE PROMPT is offered to named sessions only, because a subscription made under the viewer
 *      is owned by an identity fifty people share — it would sit on a shared PC pushing one person's
 *      Huddle into the mess room indefinitely, with nobody able to turn it off. Somebody who wants
 *      notifications wants them on their own phone, where they are signed in.
 * Both are gated on AUTH rather than access: a lapsed subscription re-subscribes, which is a
 * Firestore write, and in `open` mode access resolves before the session exists.
 *
 * ── TWO ORDERINGS THAT MUST SURVIVE AN EDIT ─────────────────────────────────────────────────────
 *
 * `notifSupported()` is checked FIRST. It folds in the `'Notification' in window` test, so in a
 * plain iOS Safari tab (no Notification global) we return before touching `Notification.permission`
 * — reading it unguarded threw at module top level and took the nav panel, error reporter and
 * keyboard navigation down with it. And `requestPermission()` runs INSIDE the tap, before any await:
 * iOS/WebKit silently rejects a request outside a user gesture and Chrome demotes it to the quiet
 * UI (v16.23). Only the Firestore subscription SAVE needs auth, and that comes after.
 *
 * The coordinator wires this BEFORE install-prompt.js, which hides this strip when it shows its
 * own — one ask at a time, install first. That precedence is install-prompt.js's to argue.
 */
import { notifSupported, getNotifState, enableNotifications } from './notif.js';
import { lsGet, lsSet } from './ls.js';

/**
 * @param {{ authReady: Promise<any>, getAccessType: () => string }} deps
 *   `authReady` — the Calendar's AUTH promise (persistence configured, session resolved), not its
 *   access promise; `getAccessType` — 'named' | 'open' | 'viewer' | …, read when each promise
 *   settles rather than at init, because access is decided asynchronously.
 */
export function initNotifPrompt({ authReady, getAccessType }) {
    // Guard support FIRST. notifSupported() folds in the `'Notification' in window` check and the
    // iOS-standalone rule, so in a plain iOS Safari tab (where the Notification global is absent)
    // we return before ever touching `Notification.permission` — reading it unguarded threw a
    // ReferenceError at module top level, aborting the rest of the module (nav panel, error
    // reporter, keyboard nav). Do not reorder this below the permission checks.
    if (!notifSupported()) return;

    // Already granted — getNotifState() handles VAPID rotation and keeps the
    // subscription fresh. Early-return avoids showing the prompt.
    if (Notification.permission === 'granted') {
        // NAMED sessions only (v20.12). This renews the subscription and re-stamps its `owner` with
        // the current Firebase uid, and under a shared Calendar viewer that uid is the SAME for
        // every office PC in the building — so one machine's renewal would overwrite the owner of a
        // real member's subscription, and any viewer anywhere could then delete it. Skipping is a
        // no-op write-wise, so an existing subscription is left exactly as it was; the only thing
        // lost is VAPID-rotation self-healing during a viewer session, which is a rare manual event
        // on a machine that should not be carrying somebody's notifications anyway.
        authReady
            // `open` too (v20.16): with the staff PIN switched off the Calendar is back on its
            // pre-v20.12 anonymous model, and renewal under an anonymous uid is exactly what it did
            // then. Only VIEWER mode is excluded, because that uid is shared by every office PC.
            // Gated on AUTH rather than access: a lapsed subscription re-subscribes, which is a
            // Firestore write, and in `open` mode access resolves before the session exists.
            .then(() => { const t = getAccessType(); if (t === 'named' || t === 'open') return getNotifState(); })
            .catch((/** @type {any} */ err) => console.warn('[Notifications] Renewal failed:', err.message));
        return;
    }

    if (Notification.permission === 'denied') return;
    if (lsGet('myb_notif_prompt_done')) return;

    const prompt     = document.getElementById('notifPrompt');
    const enableBtn  = document.getElementById('notifPromptEnable');
    const dismissBtn = document.getElementById('notifPromptDismiss');
    if (!prompt || !enableBtn || !dismissBtn) return;
    const _prompt = /** @type {HTMLElement} */ (prompt);

    // Offered to NAMED sessions only, and only once access is settled (v20.12). Two reasons, and
    // the second is the one that would not occur to you: a subscription made under the shared
    // viewer is owned by an identity fifty people share, so it can be deleted by any of them — and
    // it would sit on a shared office PC pushing one person's Huddle to a machine in the mess room
    // indefinitely, with nobody who could turn it off. A staff member who wants notifications wants
    // them on their own phone, where they are signed in.
    authReady.then(() => {
        // Same rule as the renewal above: everyone EXCEPT the shared viewer. With the PIN switched
        // off that restores the prompt to every calendar visitor, which is what it was before.
        const t = getAccessType();
        if (t !== 'named' && t !== 'open') return;
        _prompt.style.display = 'flex';
    });
    function hide() { _prompt.style.display = 'none'; }

    enableBtn.addEventListener('click', async () => {
        hide();
        try {
            // Request the permission FIRST, inside the click's transient user activation (v16.23).
            // Awaiting an auth round-trip first ran requestPermission outside the gesture:
            // iOS/WebKit silently rejects a no-gesture request and Chrome demotes it to the quiet
            // UI, so the tap did nothing. Only the Firestore subscription SAVE needs auth.
            const perm = await Notification.requestPermission();
            if (perm !== 'granted') {
                lsSet('myb_notif_prompt_done', '1');   // asked and declined — don't re-prompt
                return;
            }
            // Already resolved — the prompt is only shown from inside a `authReady`
            // callback — but kept so the gesture/auth ordering above stays explicit at the one
            // place it matters.
            await authReady;
            await enableNotifications();   // permission already granted → goes straight to subscribe
        } catch (err) {
            console.warn('[Notifications] Enable failed:', /** @type {any} */ (err).message);
        }
    });

    dismissBtn.addEventListener('click', () => {
        hide();
        lsSet('myb_notif_prompt_done', '1');
    });
}
