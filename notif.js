/**
 * notif.js — Shared Web Push notification state + subscribe/unsubscribe logic.
 *
 * Single source of truth for the VAPID key and the push-subscription lifecycle.
 * Imported by nav-panel.js (footer bell), app.js (silent renewal + one-off prompt),
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

/** True on iOS/iPadOS (incl. iPadOS reporting as MacIntel with touch). */
export function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
           (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** True when running as an installed Home Screen PWA (standalone display mode). */
function isStandalonePWA() {
    return window.matchMedia?.('(display-mode: standalone)').matches ||
           window.navigator.standalone === true;
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
        swReady(),
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
    await savePushSubscription(sub);
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
        let sub   = await reg.pushManager.getSubscription();
        if (!sub) return 'off-lapsed';

        if (lsGet(VAPID_VER_KEY) !== VAPID_FINGERPRINT) {
            await sub.unsubscribe();
            sub = await subscribe();
        } else {
            await savePushSubscription(sub);
        }
        return sub ? 'on' : 'off-lapsed';
    } catch (err) {
        console.warn('[Notifications] State check failed:', err.message);
        return 'off-lapsed';
    }
}

/**
 * Read-only notification state — same return values as getNotifState() but with
 * NO side effects: it never writes to Firestore, never re-subscribes, and never
 * runs the VAPID-rotation migration. Use this for UI that re-reads state often
 * (e.g. the nav-panel bell repaints on every drawer open) so opening the menu
 * doesn't trigger a Firestore write each time. The migration still runs from
 * app.js on page load via getNotifState().
 * @returns {Promise<'on'|'off-default'|'off-lapsed'|'denied'|'unsupported'>}
 */
export async function peekNotifState() {
    if (!notifSupported()) return 'unsupported';

    const perm = Notification.permission;
    if (perm === 'denied') return 'denied';
    if (perm !== 'granted') return 'off-default';

    try {
        const reg = await swReady();
        const sub = await reg.pushManager.getSubscription();
        return sub ? 'on' : 'off-lapsed';
    } catch (err) {
        console.warn('[Notifications] State peek failed:', err.message);
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
        console.warn('[Notifications] Enable failed:', err.message);
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
        console.warn('[Notifications] Disable failed:', err.message);
    }
    return Notification.permission === 'denied' ? 'denied' : 'off-lapsed';
}
