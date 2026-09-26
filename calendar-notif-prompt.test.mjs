// @ts-check
/**
 * calendar-notif-prompt.test.mjs — the two ACCESS rules behind the Calendar's notification strip.
 * Run: node --experimental-test-module-mocks --test calendar-notif-prompt.test.mjs   (part of test:unit)
 *
 * WHY THIS FILE EXISTS (v24.28 review). module-coverage-parity counted calendar-notif-prompt.js as
 * named only because a COMMENT in coordinator-ratchet.test.mjs mentions it. Nothing loaded it — and
 * headless Chromium has no push service, so the e2e suite can never reach it either (calendar.spec.js
 * says so and forces the strip on by hand). Yet its header states two rules with real teeth:
 *
 *   1. RENEWAL never runs under the shared Calendar viewer — it re-stamps a subscription's owner with
 *      the current uid, which under the PIN is the same uid on every office PC.
 *   2. THE PROMPT is offered to named (and open-mode) sessions only — a subscription made under the
 *      viewer belongs to an identity fifty people share.
 *
 * Both are pinned here through the real `initNotifPrompt`, with notif.js and ls.js stubbed.
 */
import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let renewals = 0;
/** @type {Record<string, string>} */
let store = {};
mock.module('./notif.js', { namedExports: {
    notifSupported: () => true,
    getNotifState: () => { renewals++; return Promise.resolve('on'); },
    enableNotifications: () => Promise.resolve(),
} });
mock.module('./ls.js', { namedExports: {
    lsGet: (/** @type {string} */ k) => store[k] ?? null,
    lsSet: (/** @type {string} */ k, /** @type {string} */ v) => { store[k] = v; },
} });

/** @type {Record<string, any>} */
let els;
function btn() {
    /** @type {Record<string, Function>} */
    const on = {};
    return { on, style: { display: '' }, addEventListener: (/** @type {string} */ t, /** @type {Function} */ f) => { on[t] = f; } };
}
globalThis.document = /** @type {any} */ ({ getElementById: (/** @type {string} */ id) => els[id] ?? null });
globalThis.Notification = /** @type {any} */ ({ permission: 'default', requestPermission: async () => 'denied' });

const { initNotifPrompt } = await import('./calendar-notif-prompt.js');
const { NOTIF_PROMPT_DONE } = await import('./storage-keys.js');

/** Let the authReady `.then` chains run. */
const settle = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
    renewals = 0;
    store = {};
    els = { notifPrompt: btn(), notifPromptEnable: btn(), notifPromptDismiss: btn() };
    /** @type {any} */ (globalThis.Notification).permission = 'default';
});

describe('rule 1 — renewal never runs under the shared viewer', () => {
    for (const [access, expected] of /** @type {const} */ ([['named', 1], ['open', 1], ['viewer', 0]])) {
        test(`permission granted, ${access} session → ${expected ? 'renews' : 'writes nothing'}`, async () => {
            /** @type {any} */ (globalThis.Notification).permission = 'granted';
            initNotifPrompt({ authReady: Promise.resolve(), getAccessType: () => access });
            await settle();
            assert.equal(renewals, expected);
            assert.equal(els.notifPrompt.style.display, '', 'a granted device is never shown the prompt');
        });
    }
});

describe('rule 2 — the prompt is offered to named sessions, never to the viewer', () => {
    test('a named session sees the strip', async () => {
        initNotifPrompt({ authReady: Promise.resolve(), getAccessType: () => 'named' });
        await settle();
        assert.equal(els.notifPrompt.style.display, 'flex');
    });

    test('the shared viewer does not', async () => {
        initNotifPrompt({ authReady: Promise.resolve(), getAccessType: () => 'viewer' });
        await settle();
        assert.equal(els.notifPrompt.style.display, '');
    });

    test('an answered device is never asked again', async () => {
        store[NOTIF_PROMPT_DONE] = '1';
        initNotifPrompt({ authReady: Promise.resolve(), getAccessType: () => 'named' });
        await settle();
        assert.equal(els.notifPrompt.style.display, '');
    });

    test('× hides it and records the answer', async () => {
        initNotifPrompt({ authReady: Promise.resolve(), getAccessType: () => 'named' });
        await settle();
        els.notifPromptDismiss.on.click();
        assert.equal(els.notifPrompt.style.display, 'none');
        assert.equal(store[NOTIF_PROMPT_DONE], '1');
    });
});
