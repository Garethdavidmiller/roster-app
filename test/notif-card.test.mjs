// @lane unit
/**
 * notif-card.test.mjs — the Settings Notifications card's WIRING, through the real `initNotificationsCard`.
 * Run: node --experimental-test-module-mocks scripts/run-tests.mjs test/notif-card.test.mjs   (part of `npm run test:unit`)
 *
 * notif-card-core.test.mjs proves the words for every state; this proves the card ASKS at the right
 * moments and paints what it hears. Each block is a defect the words could not see:
 *
 *   · it read once, so a member who allowed notifications in the phone's settings came back to
 *     "Blocked" until a reload — the visibility, back/forward-cache and Permissions API re-reads;
 *   · Enable did not wait for the session, so the record was saved with no owner — or not at all;
 *     and then it waited BEFORE asking, outside the tap that iPhone Safari needs the ask inside;
 *   · Chrome's quiet prompt can leave `requestPermission()` unsettled for ever, and the button sat on
 *     "Turning on…" with it;
 *   · Settings never re-registered the device, so "✓ On" could have no record behind it;
 *   · and it must still hear `myb:notif-changed`, which is how the drawer's bell tells it.
 *
 * notif.js is stubbed (it imports the Firebase SDK, unloadable in Node) by a stand-in that keeps the
 * one property under test: enable and disable ANNOUNCE, as the real `_announce` does. The DOM is a
 * small fake that records what the card paints.
 */
import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── notif.js, as the card sees it ────────────────────────────────────────────────────────────────
const env = {
    supported: true, ios: false, standalone: false, mirror: false, offByChoice: false,
    /** what both reads answer @type {string} */ state: 'off-default',
    peeks: 0, gets: 0, enables: 0, subscribes: 0, disables: 0,
    /** when set, enableNotifications waits on this before answering @type {Promise<void>|null} */ enableHold: null,
    /** when true, enableNotifications never settles (Chrome's quiet prompt) */ enableHangs: false,
};
const announce = (/** @type {string} */ state) => { globalThis.document.dispatchEvent(new CustomEvent('myb:notif-changed', { detail: { state } })); return state; };
mock.module('../notif.js', { namedExports: {
    notifSupported: () => env.supported,
    isIOS: () => env.ios,
    isStandalonePWA: () => env.standalone,
    onPagesMirror: () => env.mirror,
    notifOffByChoice: () => env.offByChoice,
    peekNotifState: async () => { env.peeks++; return env.state; },
    getNotifState: async () => { env.gets++; return env.state; },
    // Like the real one: the permission request (counted in `enables`) is made before anything is
    // awaited, and `beforeSubscribe` is awaited only after it, before the subscribe (`subscribes`).
    enableNotifications: async (/** @type {{ beforeSubscribe?: () => Promise<unknown> }} */ { beforeSubscribe } = {}) => {
        env.enables++;
        if (env.enableHangs) await new Promise(() => {});
        if (beforeSubscribe) await beforeSubscribe();
        env.subscribes++;
        if (env.enableHold) await env.enableHold;
        env.state = 'on'; env.offByChoice = false;
        return announce('on');
    },
    disableNotifications: async () => { env.disables++; env.state = 'off-default'; env.offByChoice = true; return announce('off-default'); },
} });
mock.module('../overlay.js', { namedExports: { initCardCollapse: () => ({ setOpen() {} }) } });

// ── A small DOM that records what the card paints ───────────────────────────────────────────────
/** @type {Record<string, any>} */ let els;
/** @type {Record<string, Function[]>} */ let docListeners;
/** @type {Record<string, Function[]>} */ let winListeners;
/** @type {Function[]} */ let permListeners;

function el(/** @type {string} */ id, /** @type {Partial<any>} */ props = {}) {
    /** @type {Record<string, Function[]>} */ const on = {};
    const e = {
        id, hidden: false, disabled: false, textContent: '', style: { display: '' }, className: '',
        addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { (on[t] ??= []).push(fn); },
        replaceChildren: (/** @type {any[]} */ ...nodes) => { e.children = nodes; e.textContent = nodes.map(n => (typeof n === 'string' ? n : n.textContent)).join(''); },
        focus: () => { globalThis.document.activeElement = e; },
        click: () => Promise.all((on.click ?? []).map(fn => fn())),
        ...props,
    };
    return e;
}

function installDom() {
    docListeners = {}; winListeners = {}; permListeners = [];
    els = {
        notifStatusMsg: el('notifStatusMsg'), notifEnableBtn: el('notifEnableBtn'), notifDisableBtn: el('notifDisableBtn'),
        notifDeniedMsg: el('notifDeniedMsg'), notifHintPay: el('notifHintPay', { hidden: true }),
        notifKinds: el('notifKinds'), notifKindsLead: el('notifKindsLead', { textContent: 'You’ll get:' }),
        notifKindPay: el('notifKindPay', { hidden: true, textContent: 'Pay reminder ·' }),
        notifKindTimetable: el('notifKindTimetable', { textContent: 'Timetable changes ·' }),
        notifKindResetRequests: el('notifKindResetRequests', { hidden: true, textContent: 'Reset requests ·' }),
        notifKindErrorLog: el('notifKindErrorLog', { hidden: true, textContent: 'Error Log' }),
    };
    const kinds = [el('k1', { textContent: 'Daily Huddle ·' }), el('k2', { textContent: 'Weekly Retail Circular ·' }),
        el('k3', { textContent: 'Marylebone Newsletter ·' }), els.notifKindPay, el('k5', { textContent: 'Password reset ·' }),
        els.notifKindTimetable, els.notifKindResetRequests, els.notifKindErrorLog];
    const body = el('body');
    globalThis.document = /** @type {any} */ ({
        visibilityState: 'visible', body, activeElement: body,
        getElementById: (/** @type {string} */ id) => els[id] ?? null,
        querySelectorAll: (/** @type {string} */ sel) => (sel === '#notifKinds .notif-kind' ? kinds : []),
        querySelector: (/** @type {string} */ sel) => (sel === 'meta[name="apple-mobile-web-app-title"]' ? { getAttribute: () => 'Home Label' } : null),
        createElement: () => el(''),
        addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { (docListeners[t] ??= []).push(fn); },
        dispatchEvent: (/** @type {Event} */ ev) => { for (const fn of docListeners[ev.type] ?? []) fn(ev); return true; },
    });
    globalThis.window = /** @type {any} */ ({
        addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { (winListeners[t] ??= []).push(fn); },
    });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: {
        userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 5)',
        permissions: { query: async () => ({ addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { if (t === 'change') permListeners.push(fn); } }) },
    } });
    globalThis.Notification = /** @type {any} */ ({ permission: 'default' });
    return kinds;
}

/** Let every pending promise and zero-delay timer run. */
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)); };

const { initNotificationsCard } = await import('../notif-card.js');
const { STILL_ASKING_LINE } = await import('../notif-card-core.js');

/** @type {Array<[string, string, string|undefined]>} */ let reports;
/** @param {Partial<Parameters<typeof initNotificationsCard>[0]>} [o] */
async function openCard(o = {}) {
    reports = [];
    initNotificationsCard({ onState: (s, c, t) => reports.push([s, c, t]), sessionReady: Promise.resolve(true), ...o });
    await settle();
}
const lastReport = () => reports.at(-1);
const shown = (/** @type {any} */ b) => b.style.display === 'block';

/** @type {any[]} */ let kinds;
beforeEach(() => {
    Object.assign(env, { supported: true, ios: false, standalone: false, mirror: false, offByChoice: false, state: 'off-default',
        peeks: 0, gets: 0, enables: 0, subscribes: 0, disables: 0, enableHold: null, enableHangs: false });
    kinds = installDom();
});

describe('Enable and Disable, through the real card — and it hears myb:notif-changed', () => {
    test('Enable turns it on; Disable turns it off as a choice', async () => {
        await openCard();
        assert.ok(shown(els.notifEnableBtn), 'premise: off, with Enable shown');
        assert.deepEqual(lastReport(), ['action', 'Off', undefined]);
        await els.notifEnableBtn.click();
        await settle();
        assert.equal(env.enables, 1);
        assert.deepEqual(lastReport(), ['ok', '✓ On', undefined]);
        assert.ok(shown(els.notifDisableBtn) && !shown(els.notifEnableBtn));
        assert.equal(els.notifStatusMsg.textContent, 'Notifications are on for this device — you’ll get each one listed above.');
        await els.notifDisableBtn.click();
        await settle();
        assert.equal(env.disables, 1);
        assert.deepEqual(lastReport(), ['ok', 'Off', 'plain']);
        assert.equal(els.notifDisableBtn.textContent, 'Turn off notifications', 'the button is not left on "Turning off…"');
    });
    test('another control\'s change — the drawer\'s bell — repaints the card', async () => {
        await openCard();
        const before = env.peeks;
        env.state = 'on';
        globalThis.document.dispatchEvent(new CustomEvent('myb:notif-changed', { detail: { state: 'on' } }));
        await settle();
        assert.ok(env.peeks > before, 'the card re-read on the event');
        assert.deepEqual(lastReport(), ['ok', '✓ On', undefined]);
    });
});

describe('it re-reads when the answer may have changed outside the page', () => {
    test('coming back to the page: visible again repaints; hidden does not read', async () => {
        env.state = 'denied';
        await openCard();
        assert.deepEqual(lastReport(), ['blocked', 'Blocked', undefined], 'premise: blocked');
        env.state = 'off-default';     // allowed again in the phone's settings — not yet subscribed
        const before = env.peeks;
        globalThis.document.visibilityState = 'hidden';
        for (const fn of docListeners.visibilitychange ?? []) fn();
        await settle();
        assert.equal(env.peeks, before, 'nothing to read while hidden');
        globalThis.document.visibilityState = 'visible';
        for (const fn of docListeners.visibilitychange ?? []) fn();
        await settle();
        assert.deepEqual(lastReport(), ['action', 'Off', undefined]);
        assert.ok(shown(els.notifEnableBtn), 'Enable is offered without leaving the page');
        assert.equal(els.notifDeniedMsg.style.display, 'none', 'the blocked steps are gone');
    });
    test('restored from the back/forward cache repaints; an ordinary pageshow does not read again', async () => {
        await openCard();
        const before = env.peeks;
        for (const fn of winListeners.pageshow ?? []) fn({ persisted: false });
        await settle();
        assert.equal(env.peeks, before);
        env.state = 'on';
        for (const fn of winListeners.pageshow ?? []) fn({ persisted: true });
        await settle();
        assert.deepEqual(lastReport(), ['ok', '✓ On', undefined]);
    });
    test('the browser reporting the permission changed repaints', async () => {
        await openCard();
        assert.equal(permListeners.length, 1, 'the card listens to the notifications permission');
        env.state = 'denied';
        permListeners[0]();
        await settle();
        assert.deepEqual(lastReport(), ['blocked', 'Blocked', undefined]);
    });
    test('no Permissions API: the card still opens and reads', async () => {
        /** @type {any} */ (globalThis.navigator).permissions = undefined;
        await openCard();
        assert.deepEqual(lastReport(), ['action', 'Off', undefined]);
    });
});

describe('the session', () => {
    test('Settings re-registers the device ONCE, when the session is ready', async () => {
        await openCard();
        assert.equal(env.gets, 1, 'getNotifState re-saves the record when its owner is missing');
        for (const fn of docListeners.visibilitychange ?? []) fn();
        await settle();
        assert.equal(env.gets, 1, 'every later read is a peek');
    });
    test('no session, no re-registration', async () => {
        await openCard({ sessionReady: Promise.resolve(false) });
        assert.equal(env.gets, 0);
    });
    test('Enable asks for permission inside the tap, and waits for the session before it subscribes', async () => {
        /** @type {(v: boolean) => void} */ let ready = () => {};
        await openCard({ sessionReady: new Promise(r => { ready = r; }) });
        const click = els.notifEnableBtn.click();
        // Read with nothing awaited since the tap: iPhone Safari honours a permission request only
        // while the tap's activation lasts, so one made after an await may show no prompt (v26.53).
        assert.equal(env.enables, 1, 'the permission request waited for something — it must run in the tap itself');
        await settle();
        assert.equal(env.subscribes, 0, 'subscribed before the session was ready');
        assert.equal(els.notifEnableBtn.textContent, 'Turning on…');
        ready(true);
        await click;
        await settle();
        assert.equal(env.enables, 1, 'asked once');
        assert.equal(env.subscribes, 1);
        assert.deepEqual(lastReport(), ['ok', '✓ On', undefined]);
    });
});

describe('a permission question that never settles does not hold the button', () => {
    test('after the limit, the button is back and the card says the browser is still asking', async () => {
        env.enableHangs = true;
        await openCard({ askLimitMs: 20 });
        els.notifEnableBtn.click();
        await settle();
        assert.equal(els.notifEnableBtn.textContent, 'Turning on…', 'premise: waiting on the browser');
        await new Promise(r => setTimeout(r, 40));
        await settle();
        assert.equal(els.notifEnableBtn.textContent, 'Turn on notifications');
        assert.equal(els.notifEnableBtn.disabled, false);
        assert.equal(els.notifStatusMsg.textContent, STILL_ASKING_LINE);
    });
    test('a tap on the returned button waits on the enable in flight — it never starts a second', async () => {
        /** @type {() => void} */ let release = () => {};
        env.enableHold = new Promise(r => { release = () => r(); });
        await openCard({ askLimitMs: 20 });
        const first = els.notifEnableBtn.click();
        await new Promise(r => setTimeout(r, 40));
        await settle();
        assert.equal(els.notifEnableBtn.disabled, false, 'premise: the button is back past the ask limit');
        const second = els.notifEnableBtn.click();
        assert.equal(env.enables, 1, 'a second tap asked for permission again, alongside the first');
        assert.equal(els.notifEnableBtn.textContent, 'Turning on…');
        release();
        await Promise.all([first, second]);
        await settle();
        assert.equal(env.subscribes, 1, 'one subscribe and save');
        assert.deepEqual(lastReport(), ['ok', '✓ On', undefined]);
        await els.notifDisableBtn.click();
        await settle();
        env.enableHold = null;
        await els.notifEnableBtn.click();
        await settle();
        assert.equal(env.enables, 2, 'once it has finished, the next tap enables afresh');
    });
    test('once permission is answered the subscribe is not cut short — its own limits apply', async () => {
        /** @type {() => void} */ let release = () => {};
        env.enableHold = new Promise(r => { release = () => r(); });
        await openCard({ askLimitMs: 20 });
        const click = els.notifEnableBtn.click();
        globalThis.Notification.permission = 'granted';
        await new Promise(r => setTimeout(r, 40));
        await settle();
        assert.equal(els.notifEnableBtn.textContent, 'Turning on…', 'a slow subscribe is not "still asking"');
        release();
        await click;
        await settle();
        assert.deepEqual(lastReport(), ['ok', '✓ On', undefined]);
    });
});

// ── FOCUS IS NOT DROPPED, AND THE MIRROR SENDS THE MEMBER ON (owner, 26 Nov 2026) ────────────────────
describe('after Turn on or Turn off, focus goes to the button the card now shows', () => {
    test('focus that fell to the page goes to Turn off, then back to Turn on', async () => {
        await openCard();
        await els.notifEnableBtn.click();
        await settle();
        assert.equal(document.activeElement, els.notifDisableBtn, 'focus left on <body> once Turn on was hidden');
        document.activeElement = document.body;
        await els.notifDisableBtn.click();
        await settle();
        assert.equal(document.activeElement, els.notifEnableBtn);
    });
    test('a member who has moved focus on keeps their place', async () => {
        await openCard();
        const elsewhere = el('elsewhere');
        document.activeElement = elsewhere;
        await els.notifEnableBtn.click();
        await settle();
        assert.equal(document.activeElement, elsewhere);
    });
});

describe('on the Pages mirror', () => {
    test('off: no button, and the main address is a link', async () => {
        env.mirror = true;
        await openCard();
        assert.ok(!shown(els.notifEnableBtn) && !shown(els.notifDisableBtn), 'Turn on offered at the address that is closing');
        assert.equal(els.notifStatusMsg.textContent, 'This is the app’s older address, which will close. Turn notifications on at myb-roster.web.app instead.');
        const link = els.notifStatusMsg.children?.find((/** @type {any} */ n) => typeof n !== 'string');
        assert.equal(link?.href, 'https://myb-roster.web.app/');
        assert.deepEqual(lastReport(), ['n/a', 'Off', undefined]);
    });
    test('on: Turn off is still there', async () => {
        Object.assign(env, { mirror: true, state: 'on' });
        await openCard();
        assert.ok(shown(els.notifDisableBtn));
        assert.deepEqual(lastReport(), ['ok', '✓ On', undefined]);
    });
});

describe('what the card lists', () => {
    test('the timetable change while it is due, and the list ends on a kind', async () => {
        await openCard({ now: () => new Date('2026-12-01T12:00:00Z') });
        assert.equal(els.notifKindTimetable.hidden, false);
        assert.equal(els.notifKindTimetable.textContent, 'Timetable changes');
        assert.equal(kinds[2].textContent, 'Marylebone Newsletter ·');
    });
    test('after its reminder is sent, no timetable item — and no stray separator', async () => {
        await openCard({ now: () => new Date('2026-12-13T08:00:00Z') });
        assert.equal(els.notifKindTimetable.hidden, true);
        assert.equal(kinds[4].textContent, 'Password reset', 'the last kind shown carries no "·"');
    });
    test('the admin-only kinds are listed to the admin alone, and the list still ends on a kind', async () => {
        await openCard({ now: () => new Date('2026-12-13T08:00:00Z') });
        assert.deepEqual([els.notifKindResetRequests.hidden, els.notifKindErrorLog.hidden], [true, true], 'listed to a member who is never sent them');
        kinds = installDom();
        await openCard({ adminNotices: true, now: () => new Date('2026-12-13T08:00:00Z') });
        assert.deepEqual([els.notifKindResetRequests.hidden, els.notifKindErrorLog.hidden], [false, false]);
        assert.deepEqual(kinds.filter(k => !k.hidden).map(k => k.textContent).slice(-3), ['Password reset ·', 'Reset requests ·', 'Error Log']);
    });
    test('an iPhone in a browser: "After install", and the list is the installed app\'s', async () => {
        Object.assign(env, { supported: false, ios: true, standalone: false });
        await openCard();
        assert.deepEqual(lastReport(), ['n/a', 'After install', undefined]);
        assert.equal(els.notifKinds.hidden, false);
        assert.equal(els.notifKindsLead.textContent, 'In the Home Screen app, you’ll get:');
        assert.match(els.notifStatusMsg.textContent, /find Home Label \(the name under its icon\)/, 'the label is read from the page');
        assert.equal(env.gets, 0, 'nothing to re-register on a device without push');
    });
    test('a browser that can never get them is promised nothing', async () => {
        env.supported = false;
        await openCard();
        assert.deepEqual(lastReport(), ['n/a', 'Not available', undefined]);
        assert.equal(els.notifKinds.hidden, true);
    });
});
