/**
 * Unit tests for notif.js — the shared Web Push state machine + subscribe/unsubscribe.
 * Run with: node --experimental-test-module-mocks --test notif.test.mjs
 *
 * notif.js imports firebase-client.js (which statically imports the Firebase SDK from the gstatic
 * CDN — unloadable in Node) and ls.js. Both are mocked. The browser Push APIs (Notification,
 * navigator.serviceWorker, PushManager, window.matchMedia) are stubbed on globalThis via a small
 * configurable environment the tests drive per-case. notif.js reads these at CALL time (not module
 * load), so the env can be reconfigured before each call.
 */
import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── firebase-client + ls mocks (spies the tests inspect) ──────────────────────
let _saveCalls = 0;
let _saveThrows = false;   // structural failure — savePushSubscription throws 'push/subscription-missing-keys' (keyless sub — review B2)
let _saveThrowsTransient = false;   // transient failure — an offline/Firestore blip (a DIFFERENT, non-structural error)
let _deleteCalls = 0;
let _lastDeletedEndpoint = null;
const _ls = new Map();

mock.module('./firebase-client.js', {
    namedExports: {
        savePushSubscription:   async () => { _saveCalls++; if (_saveThrows) throw new Error('push/subscription-missing-keys'); if (_saveThrowsTransient) throw new Error('unavailable'); },
        deletePushSubscription: async (/** @type {string} */ endpoint) => { _deleteCalls++; _lastDeletedEndpoint = endpoint; },
    },
});
mock.module('./ls.js', {
    namedExports: {
        lsGet: (/** @type {string} */ k) => (_ls.has(k) ? _ls.get(k) : null),
        lsSet: (/** @type {string} */ k, /** @type {string} */ v) => { _ls.set(k, String(v)); },
        lsDel: (/** @type {string} */ k) => { _ls.delete(k); },
    },
});

const { notifSupported, isIOS, getNotifState, peekNotifState, enableNotifications, disableNotifications,
    notifOffByChoice, releaseDevicePush } = await import('./notif.js');

// ── Configurable browser environment ──────────────────────────────────────────
/**
 * @param {object} cfg
 * @param {boolean} [cfg.apis]        push APIs present (default true)
 * @param {boolean} [cfg.ios]         report an iOS user agent (default false)
 * @param {boolean} [cfg.standalone]  installed-PWA display mode (default true)
 * @param {'default'|'granted'|'denied'} [cfg.permission]
 * @param {'granted'|'denied'|'default'} [cfg.requestResult] what requestPermission resolves to
 * @param {boolean} [cfg.hasSub]      an active subscription exists (default false)
 * @param {boolean} [cfg.swFails]     serviceWorker.ready rejects
 * @param {boolean} [cfg.subscribeFails] pushManager.subscribe rejects
 * @param {string}  [cfg.endpoint]
 */
function setupEnv(cfg = {}) {
    const {
        apis = true, ios = false, standalone = true, permission = 'default',
        requestResult = 'granted', hasSub = false, swFails = false, subscribeFails = false,
        endpoint = 'https://fcm.googleapis.com/push/ABC', keyless = false,
    } = cfg;

    // Real PushSubscriptions expose getKey(); a keyless one (some Android builds) returns null.
    const _getKey = /** @param {string} _n */ (_n) => (keyless ? null : new ArrayBuffer(16));
    const sub = { endpoint, getKey: _getKey, unsubscribe: async () => { sub._unsubscribed = true; return true; }, _unsubscribed: false };
    const newSub = { endpoint: endpoint + '-new', unsubscribe: async () => { newSub._unsubscribed = true; return true; }, _unsubscribed: false };
    const pushManager = {
        getSubscription: async () => (hasSub ? sub : null),
        subscribe: async () => { if (subscribeFails) throw new Error('subscribe failed'); return newSub; },
    };
    const registration = { pushManager };

    // `ready` is a lazy getter so the rejecting promise (swFails) is created only when swReady()
    // actually consumes it (inside the Promise.race) — avoids an eager unhandled rejection.
    const serviceWorker = { get ready() { return swFails ? Promise.reject(new Error('SW not ready')) : Promise.resolve(registration); } };

    const nav = {
        userAgent: ios ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' : 'Mozilla/5.0 (Linux; Android 13)',
        platform: ios ? 'iPhone' : 'Linux armv8l',
        maxTouchPoints: ios ? 5 : 0,
        standalone: ios && standalone ? true : undefined,
    };
    if (apis) /** @type {any} */ (nav).serviceWorker = serviceWorker;   // omit → notifSupported() trips

    const Notification = apis ? { permission, requestPermission: async () => requestResult } : undefined;
    const PushManager  = apis ? function PushManager() {} : undefined;

    // notifSupported() checks `'Notification' in window`, `'serviceWorker' in navigator`,
    // `'PushManager' in window` — so the APIs must live on BOTH window and the globals.
    const win = {
        matchMedia: (/** @type {string} */ q) => ({ matches: q.includes('standalone') ? standalone : false }),
        navigator: nav,
    };
    if (apis) { /** @type {any} */ (win).Notification = Notification; /** @type {any} */ (win).PushManager = PushManager; }

    globalThis.window = /** @type {any} */ (win);
    // navigator is a read-only Node global — must be redefined, not assigned.
    Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
    if (apis) { globalThis.Notification = /** @type {any} */ (Notification); globalThis.PushManager = /** @type {any} */ (PushManager); }
    else { delete (/** @type {any} */ (globalThis)).Notification; delete (/** @type {any} */ (globalThis)).PushManager; }
    return { sub, newSub, registration };
}

beforeEach(() => {
    _saveCalls = 0; _saveThrows = false; _saveThrowsTransient = false; _deleteCalls = 0; _lastDeletedEndpoint = null; _ls.clear();
});

// notifSupported reads `'Notification' in window` / `'serviceWorker' in navigator` / `'PushManager' in window`.
// Our win/nav carry those; strip for the unsupported case.

describe('notifSupported / isIOS', () => {
    test('supported when all push APIs present (non-iOS)', () => {
        setupEnv({ apis: true, ios: false });
        assert.equal(notifSupported(), true);
    });
    test('unsupported when the push APIs are missing', () => {
        setupEnv({ apis: false });
        assert.equal(notifSupported(), false);
    });
    test('iOS in a browser tab (not standalone) is unsupported', () => {
        setupEnv({ ios: true, standalone: false });
        assert.equal(notifSupported(), false);
    });
    test('iOS installed as a PWA is supported', () => {
        setupEnv({ ios: true, standalone: true });
        assert.equal(notifSupported(), true);
    });
    test('isIOS detects an iPhone user agent', () => {
        setupEnv({ ios: true });
        assert.equal(isIOS(), true);
        setupEnv({ ios: false });
        assert.equal(isIOS(), false);
    });
});

describe('getNotifState', () => {
    test('unsupported device → "unsupported"', async () => {
        setupEnv({ apis: false });
        assert.equal(await getNotifState(), 'unsupported');
    });
    test('permission denied → "denied"', async () => {
        setupEnv({ permission: 'denied' });
        assert.equal(await getNotifState(), 'denied');
    });
    test('permission default (not yet asked) → "off-default"', async () => {
        setupEnv({ permission: 'default' });
        assert.equal(await getNotifState(), 'off-default');
    });
    test('granted but no active subscription → "off-lapsed"', async () => {
        setupEnv({ permission: 'granted', hasSub: false });
        assert.equal(await getNotifState(), 'off-lapsed');
    });
    test('granted with a current-fingerprint subscription → "on", throttled re-save writes once', async () => {
        setupEnv({ permission: 'granted', hasSub: true });
        _ls.set('myb_vapid_ver', 'BDycpNlvciF7'); // current fingerprint (first 12 chars of the VAPID key)
        assert.equal(await getNotifState(), 'on');
        assert.equal(_saveCalls, 1, 'first check re-saves (no prior throttle stamp)');
        // Second check within the 24h window must NOT re-save.
        assert.equal(await getNotifState(), 'on');
        assert.equal(_saveCalls, 1, 'throttled — no second re-save within ~24h');
    });
    test('VAPID rotation: stale fingerprint unsubscribes the old sub and re-subscribes', async () => {
        const { sub } = setupEnv({ permission: 'granted', hasSub: true });
        _ls.set('myb_vapid_ver', 'STALE_FINGER'); // != current → rotation path
        const state = await getNotifState();
        assert.equal(sub._unsubscribed, true, 'old subscription unsubscribed FIRST (avoids InvalidStateError)');
        assert.equal(_saveCalls, 1, 're-subscribe persisted the new subscription');
        assert.equal(state, 'on');
        assert.equal(_ls.get('myb_vapid_ver'), 'BDycpNlvciF7', 'fingerprint updated so rotation does not retry every check');
    });
    test('serviceWorker never ready → "off-lapsed" (never stuck)', async () => {
        setupEnv({ permission: 'granted', swFails: true });
        assert.equal(await getNotifState(), 'off-lapsed');
    });
    test('a TRANSIENT re-save failure keeps a LIVE subscription "on" (not mislabelled off-lapsed)', async () => {
        // Whole-codebase review, nav/notif finding #1: the throttled best-effort self-heal save must
        // NOT bubble to the outer catch (which returns 'off-lapsed'). A live subscription whose ~daily
        // re-save hits an offline blip must stay 'on', and the throttle stamp must be withheld so it retries.
        setupEnv({ permission: 'granted', hasSub: true });
        _ls.set('myb_vapid_ver', 'BDycpNlvciF7'); // current fingerprint → throttled self-heal path
        _saveThrowsTransient = true;               // the re-save rejects with a transient Firestore/offline error
        assert.equal(await getNotifState(), 'on', 'a live sub must stay on when only the best-effort re-save failed');
        assert.equal(_saveCalls, 1, 'the re-save was attempted');
        assert.equal(_ls.has('myb_push_resave_at'), false, 'the throttle stamp is withheld on failure so it retries next load');
    });
    test('a STRUCTURAL keyless failure on the self-heal path rolls the sub back and reports "off-lapsed"', async () => {
        // The self-heal guard must swallow ONLY transient errors. A keyless subscription
        // (savePushSubscription throws push/subscription-missing-keys) genuinely cannot receive pushes,
        // so it must surface as off-lapsed — AND be unsubscribed (v17.21) so it doesn't re-trigger the
        // save→throw cycle every load / leave the bell showing 'on' via peekNotifState.
        const { sub } = setupEnv({ permission: 'granted', hasSub: true });
        _ls.set('myb_vapid_ver', 'BDycpNlvciF7'); // current fingerprint → throttled self-heal path
        _saveThrows = true;                        // structural: 'push/subscription-missing-keys'
        assert.equal(await getNotifState(), 'off-lapsed', 'a keyless (structural) failure must not be masked as on');
        assert.equal(sub._unsubscribed, true, 'the dead keyless subscription must be rolled back');
    });
});

describe('peekNotifState (no side effects)', () => {
    test('granted + subscription → "on" but performs NO Firestore write (even with stale fingerprint)', async () => {
        setupEnv({ permission: 'granted', hasSub: true });
        _ls.set('myb_vapid_ver', 'STALE_FINGER');
        assert.equal(await peekNotifState(), 'on');
        assert.equal(_saveCalls, 0, 'peek never writes');
        assert.equal(_ls.get('myb_vapid_ver'), 'STALE_FINGER', 'peek never runs the rotation migration');
    });
    test('granted + no sub → "off-lapsed"; denied → "denied"; default → "off-default"', async () => {
        setupEnv({ permission: 'granted', hasSub: false });
        assert.equal(await peekNotifState(), 'off-lapsed');
        setupEnv({ permission: 'denied' });
        assert.equal(await peekNotifState(), 'denied');
        setupEnv({ permission: 'default' });
        assert.equal(await peekNotifState(), 'off-default');
    });
    test('granted + KEYLESS subscription → "off-lapsed" (not "on") — matches getNotifState, no side effect', async () => {
        setupEnv({ permission: 'granted', hasSub: true, keyless: true });
        assert.equal(await peekNotifState(), 'off-lapsed');
        assert.equal(_saveCalls, 0, 'peek still never writes');
    });
});

describe('enableNotifications', () => {
    test('already granted → subscribes → "on"', async () => {
        setupEnv({ permission: 'granted' });
        assert.equal(await enableNotifications(), 'on');
        assert.equal(_saveCalls, 1);
        assert.equal(_ls.get('myb_notif_prompt_done'), '1');
    });
    test('user grants the prompt → "on"', async () => {
        setupEnv({ permission: 'default', requestResult: 'granted' });
        assert.equal(await enableNotifications(), 'on');
        assert.equal(_saveCalls, 1);
    });
    test('user blocks the prompt → "denied" and marks the prompt dismissed', async () => {
        setupEnv({ permission: 'default', requestResult: 'denied' });
        assert.equal(await enableNotifications(), 'denied');
        assert.equal(_saveCalls, 0);
        assert.equal(_ls.get('myb_notif_prompt_done'), '1');
    });
    test('subscribe failure after grant → "off-lapsed" (not a throw)', async () => {
        setupEnv({ permission: 'granted', subscribeFails: true });
        assert.equal(await enableNotifications(), 'off-lapsed');
    });
    test('save failure (keyless sub) rolls back the browser subscription → "off-lapsed", not phantom "on" (B2)', async () => {
        const { newSub } = setupEnv({ permission: 'granted' });
        _saveThrows = true;   // savePushSubscription rejects (missing p256dh/auth keys)
        assert.equal(await enableNotifications(), 'off-lapsed');
        assert.equal(newSub._unsubscribed, true, 'the browser subscription must be rolled back so the bell is not stuck "on"');
        assert.equal(_ls.has('myb_vapid_ver'), false, 'the VAPID fingerprint must NOT be recorded when the save failed');
    });
    test('unsupported → "unsupported"', async () => {
        setupEnv({ apis: false });
        assert.equal(await enableNotifications(), 'unsupported');
    });
});

describe('disableNotifications', () => {
    test('unsubscribes the active sub AND removes the server record', async () => {
        const { sub } = setupEnv({ permission: 'granted', hasSub: true });
        const state = await disableNotifications();
        assert.equal(sub._unsubscribed, true);
        assert.equal(_deleteCalls, 1);
        assert.equal(_lastDeletedEndpoint, sub.endpoint);
        assert.equal(state, 'off-default', 'a deliberate off is OFF, not "stopped"');
    });
    test('no active sub → still resolves (off), no delete call', async () => {
        setupEnv({ permission: 'granted', hasSub: false });
        assert.equal(await disableNotifications(), 'off-default');
        assert.equal(_deleteCalls, 0);
    });
    test('permission denied is reported as "denied"', async () => {
        setupEnv({ permission: 'denied', hasSub: false });
        assert.equal(await disableNotifications(), 'denied');
    });
    test('unsupported → "unsupported"', async () => {
        setupEnv({ apis: false });
        assert.equal(await disableNotifications(), 'unsupported');
    });
});

// ── A DELIBERATE OFF IS NOT A LAPSE (Sep 2026 review) ──────────────────────────────────────────────
// Granted + no subscription is what BOTH a lapse and a deliberate Disable look like to the browser, so
// the Settings card told a member who had just switched notifications off that they "have stopped",
// and listed turning them back on as a to-do. The choice is recorded on the device.
describe('a deliberate Disable is remembered as a choice', () => {
    test('after Disable, both state reads say OFF, not lapsed, and the choice is readable', async () => {
        setupEnv({ permission: 'granted', hasSub: true });
        await disableNotifications();
        setupEnv({ permission: 'granted', hasSub: false });
        assert.equal(await peekNotifState(), 'off-default');
        assert.equal(await getNotifState(), 'off-default');
        assert.equal(notifOffByChoice(), true);
    });
    test('turning them back on clears the choice, so a LATER lapse is reported as one', async () => {
        setupEnv({ permission: 'granted', hasSub: true });
        await disableNotifications();
        setupEnv({ permission: 'granted', hasSub: false });
        assert.equal(await enableNotifications(), 'on');
        assert.equal(notifOffByChoice(), false);
        setupEnv({ permission: 'granted', hasSub: false });
        assert.equal(await peekNotifState(), 'off-lapsed');
    });
    test('a device that never chose is not reported as having chosen', () => {
        assert.equal(notifOffByChoice(), false);
    });
});

// ── SIGN-OUT RELEASES THIS DEVICE'S SUBSCRIPTION RECORD (Sep 2026 review) ─────────────────────────
// The record carries `owner` = the signed-in uid, and targeted pushes (a reset request naming a
// locked-out colleague, a "your password was reset") go to every device that uid owns. On a shared
// device that owner outlived sign-out, so the next person to pick it up got them.
describe('releaseDevicePush', () => {
    test('deletes this device\'s server record, keeps the browser subscription, and re-arms the re-save', async () => {
        const { sub } = setupEnv({ permission: 'granted', hasSub: true });
        _ls.set('myb_push_resave_at', String(Date.now()));
        await releaseDevicePush();
        assert.equal(_deleteCalls, 1);
        assert.equal(_lastDeletedEndpoint, sub.endpoint);
        assert.equal(sub._unsubscribed, false, 'the device keeps its setting — the next identity re-saves it as its own');
        assert.equal(_ls.has('myb_push_resave_at'), false, 'so the next load re-saves under whoever is signed in then');
    });
    test('no subscription → nothing to delete, and it still resolves', async () => {
        setupEnv({ permission: 'granted', hasSub: false });
        await releaseDevicePush();
        assert.equal(_deleteCalls, 0);
    });
    test('it never holds sign-out hostage — a hung service worker is abandoned at the time box', async () => {
        setupEnv({ permission: 'granted', hasSub: true });
        Object.defineProperty(/** @type {any} */ (globalThis.navigator).serviceWorker, 'ready', { get: () => new Promise(() => {}) });
        const t0 = Date.now();
        await releaseDevicePush(50);
        assert.ok(Date.now() - t0 < 1000, 'sign-out waited on a service worker that will never answer');
    });
});
