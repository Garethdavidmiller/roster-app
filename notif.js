// @ts-check
/**
 * notif.js — Shared Web Push notification state + subscribe/unsubscribe logic.
 *
 * Single source of truth for the VAPID key and the push-subscription lifecycle.
 * Imported by nav-panel.js (footer bell), calendar-app.js (silent renewal + one-off prompt),
 * and huddle.js (Notifications card enable/disable UI).
 *
 * Public API:
 *   notifSupported()        → boolean — push usable on this device/browser
 *   getNotifState()         → Promise<state> — reads state AND runs VAPID-rotation/persist side effects
 *   peekNotifState()        → Promise<state> — reads state only, no side effects (for frequent UI reads)
 *   enableNotifications()   → Promise<state> — requests permission if needed, subscribes
 *   disableNotifications()  → Promise<state> — unsubscribes, removes server record
 *   state = 'on'|'off-default'|'off-lapsed'|'denied'|'unsupported'
 */

import { savePushSubscription, deletePushSubscription } from './firebase-client.js';
import { lsGet, lsSet } from './ls.js';

const VAPID_PUBLIC_KEY  = 'BDycpNlvciF7kfUv3yxSQ0iRzWdi3BDZipNf-vk7QYaOSsbbIgb5FRSW9GrJlZJlmThoyQrbK0t9sd3hEdmhgSg';
const VAPID_VER_KEY     = 'myb_vapid_ver';
const VAPID_FINGERPRINT = VAPID_PUBLIC_KEY.slice(0, 12);
const PROMPT_DISMISSED  = 'myb_notif_prompt_done';
const SUB_RESAVE_KEY    = 'myb_push_resave_at';   // throttle for the periodic subscription re-save
const SUB_RESAVE_MS     = 86400000;               // at most one keep-alive re-save per ~24h/device

/** True on iOS/iPadOS (incl. iPadOS reporting as MacIntel with touch). */
export function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
           (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** True when running as an installed Home Screen PWA (standalone display mode). */
function isStandalonePWA() {
    return window.matchMedia?.('(display-mode: standalone)').matches ||
           /** @type {any} */ (window.navigator).standalone === true;
}

/**
 * Whether push notifications can be used here at all. Folds in the iOS rule that
 * Web Push only works inside a Home Screen PWA — in a Safari tab the APIs are
 * either missing or silently fail, so the bell should not appear.
 * @returns {boolean}
 */
export function notifSupported() {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    if (isIOS() && !isStandalonePWA()) return false;
    return true;
}

/**
 * swReady() can pend forever when SW registration fails
 * (e.g. private browsing on some Android builds). Race it against a timeout
 * so the Notifications card buttons never get stuck at "Enabling…" indefinitely.
 */
function swReady() {
    return Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('SW not ready')), 8000)
        ),
    ]);
}

/** Convert the URL-safe base64 VAPID key to the Uint8Array the Push API expects. */
function vapidKey() {
    const base64 = VAPID_PUBLIC_KEY.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
    return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

/** Subscribe via the service worker, persist to Firestore, record the VAPID fingerprint. */
async function subscribe() {
    const reg  = await swReady();
    const sub  = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey() });
    try {
        await savePushSubscription(sub);
    } catch (err) {
        // Couldn't persist the subscription (a keyless PushSubscription on some Android builds, or a
        // Firestore rejection). Roll back the BROWSER subscription so the device reads as 'off-lapsed'
        // and can retry — instead of leaving the bell "on" forever with no server record and no pushes
        // (review B2). Without the rollback getSubscription() would keep returning a live sub → 'on'.
        await sub.unsubscribe().catch(() => {});
        throw err;
    }
    lsSet(VAPID_VER_KEY, VAPID_FINGERPRINT);
    lsSet(PROMPT_DISMISSED, '1');
    return sub;
}

/**
 * Current notification state. Reads the synchronous permission first, then (only
 * when granted) the async active-subscription check. Performs the same silent
 * VAPID-rotation migration the other entry points do, so the bell benefits from it.
 * @returns {Promise<'on'|'off-default'|'off-lapsed'|'denied'|'unsupported'>}
 */
export async function getNotifState() {
    if (!notifSupported()) return 'unsupported';

    const perm = Notification.permission;
    if (perm === 'denied') return 'denied';
    if (perm !== 'granted') return 'off-default';

    try {
        const reg = await swReady();
        /** @type {PushSubscription|null} */
        let sub   = await reg.pushManager.getSubscription();
        if (!sub) return 'off-lapsed';

        // Rotate ONLY on a genuine key change: a NON-NULL stored fingerprint that DIFFERS.
        // A null read (localStorage unavailable/evicted on a budget Android, or never recorded)
        // must NOT trigger rotation — the old `!== FINGERPRINT` churned unsubscribe→resubscribe on
        // EVERY load of such a device (the post-subscribe lsSet also couldn't stick), and a failed
        // resubscribe mid-churn silently lapsed a working device. On null we keep the live
        // subscription and just (re)record the fingerprint best-effort below. A genuinely-rotated
        // old-key sub whose fingerprint was ALSO evicted still self-heals via fanOutPush's 410
        // cleanup → re-subscribe. (v16.84 review fix.)
        const _storedFp = lsGet(VAPID_VER_KEY);
        if (_storedFp !== null && _storedFp !== VAPID_FINGERPRINT) {
            // The Push API rejects subscribe() with a NEW applicationServerKey while a
            // subscription for the OLD key still exists (InvalidStateError), so the old
            // subscription must be removed FIRST — accepting a brief no-subscription
            // window. The reverse order (subscribe new, then unsubscribe old) can never
            // succeed when the key actually changes: subscribe() throws, the new
            // fingerprint is never recorded, and the migration retries on every state
            // check — leaving the bell stuck. If subscribe() now fails after the
            // unsubscribe, getSubscription() returns null next time → 'off-lapsed', and
            // the user can re-enable (no infinite retry). See ROADMAP "VAPID rotation".
            await sub.unsubscribe().catch(e => console.warn('[Notifications] Old sub cleanup failed (non-fatal):', /** @type {any} */ (e).message));
            sub = await subscribe();
        } else {
            // Current key, or an unreadable/absent fingerprint: (re)record it best-effort (no-op if
            // localStorage is unavailable) so a device that CAN persist stops re-checking, without
            // ever churning one that can't.
            if (_storedFp !== VAPID_FINGERPRINT) lsSet(VAPID_VER_KEY, VAPID_FINGERPRINT);
            // Re-persist the subscription to self-heal a record fanOutPush deleted on a transient
            // error — but THROTTLE it. getNotifState runs on EVERY calendar load (the most-used,
            // offline-first page), so an unconditional write here was a redundant pushSubscriptions
            // write competing with the page's own Firestore traffic every launch. Once per ~24h
            // per device keeps the self-heal without the per-open write (v16.19).
            const lastSave = parseInt(lsGet(SUB_RESAVE_KEY) || '0', 10);
            if (!Number.isFinite(lastSave) || Date.now() - lastSave > SUB_RESAVE_MS) {
                // GUARD the self-heal save (whole-codebase review, nav/notif finding #1): this write
                // must NOT propagate to the outer catch, which returns 'off-lapsed'. A transient
                // Firestore failure (offline/blip) on this ~daily best-effort re-save would otherwise
                // mislabel a genuinely-LIVE subscription as lapsed. Only stamp the throttle timestamp
                // on success, so a failed save simply retries on the next load instead of churning
                // the bell state. (The enable + VAPID-rotation saves already guard their own writes.)
                try {
                    await savePushSubscription(sub);
                    lsSet(SUB_RESAVE_KEY, String(Date.now()));
                } catch (e) {
                    console.warn('[Notifications] Subscription re-save failed (non-fatal, will retry):', /** @type {any} */ (e).message);
                }
            }
        }
        return sub ? 'on' : 'off-lapsed';
    } catch (err) {
        console.warn('[Notifications] State check failed:', /** @type {any} */ (err).message);
        return 'off-lapsed';
    }
}

/**
 * Read-only notification state — same return values as getNotifState() but with
 * NO side effects: it never writes to Firestore, never re-subscribes, and never
 * runs the VAPID-rotation migration. Use this for UI that re-reads state often
 * (e.g. the nav-panel bell repaints on every drawer open) so opening the menu
 * doesn't trigger a Firestore write each time. The migration still runs from
 * calendar-app.js on page load via getNotifState().
 * @returns {Promise<'on'|'off-default'|'off-lapsed'|'denied'|'unsupported'>}
 */
export async function peekNotifState() {
    if (!notifSupported()) return 'unsupported';

    const perm = Notification.permission;
    if (perm === 'denied') return 'denied';
    if (perm !== 'granted') return 'off-default';

    try {
        const reg = await swReady();
        /** @type {PushSubscription|null} */
        const sub = await reg.pushManager.getSubscription();
        return sub ? 'on' : 'off-lapsed';
    } catch (err) {
        console.warn('[Notifications] State peek failed:', /** @type {any} */ (err).message);
        return 'off-lapsed';
    }
}

/**
 * Turn notifications on. Requests browser permission when it has not been asked,
 * then subscribes. A no-op resulting in 'denied' if the user blocks the prompt.
 * @returns {Promise<'on'|'off-default'|'off-lapsed'|'denied'|'unsupported'>}
 */
export async function enableNotifications() {
    if (!notifSupported()) return 'unsupported';
    try {
        const perm = Notification.permission === 'granted'
            ? 'granted'
            : await Notification.requestPermission();
        if (perm !== 'granted') {
            lsSet(PROMPT_DISMISSED, '1');
            return perm === 'denied' ? 'denied' : 'off-default';
        }
        await subscribe();
        return 'on';
    } catch (err) {
        console.warn('[Notifications] Enable failed:', /** @type {any} */ (err).message);
        return 'off-lapsed';
    }
}

/**
 * Turn notifications off — unsubscribe locally and remove the server record.
 * @returns {Promise<'off-lapsed'|'denied'|'unsupported'>}
 */
export async function disableNotifications() {
    if (!notifSupported()) return 'unsupported';
    try {
        const reg = await swReady();
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
            const { endpoint } = sub;
            await sub.unsubscribe();
            await deletePushSubscription(endpoint).catch(() => {});
        }
    } catch (err) {
        console.warn('[Notifications] Disable failed:', /** @type {any} */ (err).message);
    }
    return Notification.permission === 'denied' ? 'denied' : 'off-lapsed';
}
