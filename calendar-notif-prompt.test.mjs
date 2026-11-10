// @ts-check
/**
 * calendar-notif-prompt.test.mjs — the two ACCESS rules behind the Calendar's notification strip.
 * Run: node --experimental-test-module-mocks scripts/run-tests.mjs calendar-notif-prompt.test.mjs   (part of test:unit)
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
import { readFileSync } from 'node:fs';

let renewals = 0;
/** What `enableNotifications` answers — notif.js's own states. @type {string} */
let enableResult = 'on';
let enables = 0;
/** @type {Record<string, string>} */
let store = {};
mock.module('./notif.js', { namedExports: {
    notifSupported: () => true,
    getNotifState: () => { renewals++; return Promise.resolve('on'); },
    enableNotifications: () => { enables++; return Promise.resolve(enableResult); },
} });
mock.module('./ls.js', { namedExports: {
    lsGet: (/** @type {string} */ k) => store[k] ?? null,
    lsSet: (/** @type {string} */ k, /** @type {string} */ v) => { store[k] = v; },
} });

/** @type {Record<string, any>} */
let els;
/** @param {{ hidden?: boolean, textContent?: string }} [init] */
function btn(init = {}) {
    /** @type {Record<string, Function>} */
    const on = {};
    return { on, style: { display: '' }, hidden: false, textContent: '', ...init,
             addEventListener: (/** @type {string} */ t, /** @type {Function} */ f) => { on[t] = f; } };
}
globalThis.document = /** @type {any} */ ({ getElementById: (/** @type {string} */ id) => els[id] ?? null });
/** What the system's permission prompt answers. */
let permissionAnswer = 'denied';
globalThis.Notification = /** @type {any} */ ({ permission: 'default', requestPermission: async () => permissionAnswer });
globalThis.requestAnimationFrame = /** @type {any} */ ((/** @type {Function} */ f) => setTimeout(f, 0));

mock.module('./install-prompt.js', { namedExports: { installNoticeHasTheVisit: () => false } });   // v24.96: the strip's yield, not under test here
const { initNotifPrompt } = await import('./calendar-notif-prompt.js');
const { NOTIF_PROMPT_DONE } = await import('./storage-keys.js');

/** Let the authReady `.then` chains run. */
const settle = () => new Promise(r => setTimeout(r, 0));

/** The strip's failure line as index.html has it — read from the markup, so a test cannot pass on a
 *  line the page does not carry. */
const HTML = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const FAILED_LINE = (/<span id="notifPromptFailedLine">([\s\S]*?)<\/span><\/span>/.exec(HTML)?.[1] ?? '')
    .replace(/<[^>]+>/g, '').trim();

beforeEach(() => {
    renewals = 0;
    enables = 0;
    enableResult = 'on';
    permissionAnswer = 'denied';
    store = {};
    els = { notifPrompt: btn(), notifPromptEnable: btn(), notifPromptDismiss: btn(),
            notifPromptOffer: btn(), notifPromptFailed: btn({ hidden: true }),
            notifPromptFailedLine: btn({ textContent: FAILED_LINE }), ariaAnnouncer: btn() };
    /** @type {any} */ (globalThis.Notification).permission = 'default';
});

describe('rule 1 — renewal never runs under the shared viewer', () => {
    for (const [access, expected] of /** @type {const} */ ([['named', 1], ['viewer', 0], ['none', 0]])) {
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

describe('Enable is answered, not just acted on (cal-docs-5, whole-app review 10 Nov 2026)', () => {
    // The system grants, the subscription fails ('off-lapsed' — no signal, or a push service that
    // would not register). The strip used to have gone already, and with permission now 'granted' it
    // is never offered again: the member believed notifications were on.

    /** Show the strip to a member, tap Enable, and let every await run. @param {() => string} [access] */
    async function tapEnable(access = () => 'named') {
        initNotifPrompt({ authReady: Promise.resolve(), getAccessType: access });
        await settle();
        assert.equal(els.notifPrompt.style.display, 'flex', 'the strip was offered');
        permissionAnswer = 'granted';
        const done = els.notifPromptEnable.on.click();
        /** @type {any} */ (globalThis.Notification).permission = 'granted';
        await done;
        await settle();
    }

    test('granted but not switched on: the strip comes back saying so — and says it aloud', async () => {
        enableResult = 'off-lapsed';
        await tapEnable();
        assert.equal(enables, 1);
        assert.equal(els.notifPrompt.style.display, 'flex', 'the strip is back, not gone for good');
        assert.equal(els.notifPromptOffer.hidden, true, 'the offer line has stood down');
        assert.equal(els.notifPromptFailed.hidden, false, 'the failure line is shown');
        assert.ok(FAILED_LINE.length > 0, 'the markup carries the line');
        assert.equal(els.ariaAnnouncer.textContent, FAILED_LINE, 'and the Calendar\'s announcer speaks it');
    });

    test('granted and switched on: the strip stays gone, and nothing is announced', async () => {
        enableResult = 'on';
        await tapEnable();
        assert.equal(els.notifPrompt.style.display, 'none');
        assert.equal(els.notifPromptFailed.hidden, true);
        assert.equal(els.ariaAnnouncer.textContent, '');
    });

    test('a Calendar re-locked while the system asked is not shown the strip again', async () => {
        enableResult = 'off-lapsed';
        let access = 'named';
        initNotifPrompt({ authReady: Promise.resolve(), getAccessType: () => access });
        await settle();
        permissionAnswer = 'granted';
        const done = els.notifPromptEnable.on.click();
        access = 'none';                          // the lock card is up now
        await done;
        await settle();
        assert.equal(els.notifPrompt.style.display, 'none', 'the strip would sit above the lock card');
    });

    test('the failure line names where to try later, as one unbreakable route — and so does every route the Calendar tells', () => {
        // shared.css `.nav-path`: without it the wrap can land between ☰ and →, leaving a line that
        // starts "→ Settings". Every "☰ →" route in the page's markup is held to it, the Team View tip
        // included (css-shared lead, whole-app review 10 Nov 2026).
        assert.match(HTML, /<span class="top-prompt-text" id="notifPromptFailed" hidden>/,
            'the failure line is in the markup, hidden until it is needed');
        assert.match(FAILED_LINE, /☰ → Settings/);
        const routes = [...HTML.matchAll(/☰ →/g)].map(m => m.index ?? 0);
        assert.ok(routes.length >= 2, 'the strip\'s route and the Team View tip, at least');
        for (const at of routes) {
            assert.match(HTML.slice(Math.max(0, at - 40), at), /class="nav-path">$/,
                `a route told without .nav-path: …${HTML.slice(at - 30, at + 25)}…`);
        }
    });
});
