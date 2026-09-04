/**
 * Tests for the Error Log noise filters in error-reporter.js.
 * Run: node --test error-reporter.test.mjs   (part of `npm run test:hygiene`)
 *
 * WHY THIS FILE EXISTS — the filters shipped untested for six versions (v13.31 → v19.19), and this
 * is precisely the code where that is backwards. The two failure directions are not symmetric:
 *
 *   too NARROW  → noise stays in the Error Log. Visible, annoying, self-announcing.
 *   too BROAD   → real errors are silently swallowed. Nothing ever tells you. The Error Log looks
 *                 healthy BECAUSE it is broken.
 *
 * So every filter is pinned from both sides: the thing it must suppress, and the neighbouring real
 * error it must NOT. Added when a fifth filter (WebKit's IndexedDB teardown) was needed, because
 * adding one more untested suppressor to four untested suppressors is how a log goes quiet.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { shouldReport } from './client-errors.js';

const HOST = 'myb-roster.web.app';
const SDK  = 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
const OWN  = 'https://myb-roster.web.app/calendar-app.js';

/** @param {string} msg @param {string} [src] */
const reports = (msg, src = OWN) => shouldReport(msg, src, HOST);

describe('empty and cross-origin script errors', () => {
    test('an empty message is dropped', () => {
        assert.equal(reports(''), false);
    });
    test('the opaque cross-origin "Script error." is dropped', () => {
        assert.equal(reports('Script error.'), false);
    });
    test("a browser extension's error is dropped", () => {
        assert.equal(reports('boom', 'chrome-extension://abcd/inject.js'), false);
    });
    test('but a crash inside the app\'s OWN CDN dependency is kept', () => {
        // The Firebase SDK and Mammoth are the app's code for this purpose — a crash in them is
        // app-breaking, so the cross-origin rule must not swallow it.
        assert.equal(reports('t is not a function', SDK), true);
        assert.equal(reports('convert failed', 'https://cdn.jsdelivr.net/npm/mammoth/mammoth.browser.min.js'), true);
    });
});

describe('ResizeObserver and view transitions', () => {
    test('the ResizeObserver loop warning is dropped', () => {
        assert.equal(reports('ResizeObserver loop completed with undelivered notifications.'), false);
    });
    test('the skipped view-transition notice is dropped', () => {
        assert.equal(reports('Skipping view transition because the document is hidden.'), false);
    });
    // Reported live from Android Chrome 152 on 4 Sep 2026 (v22.62). Same declarative opt-in as the
    // line above, different Chromium wording: the promise rejection when the document stops being
    // fully active mid-navigation. The app never asked for the transition, so there is nothing to
    // catch it and it lands here as an unhandled rejection.
    test('the aborted view-transition rejection is dropped', () => {
        assert.equal(reports('Transition was aborted because of invalid state'), false);
    });
    test('a REAL error that merely mentions a transition is kept', () => {
        assert.equal(reports("Cannot read properties of null (reading 'startViewTransition')"), true);
    });
    // The other side of the filter above, and the reason it matches the WHOLE sentence. The app's
    // own overlays run CSS transitions with a transitionend fallback; if one ever throws while
    // aborting, that is a real fault in a real lightbox and must not be swallowed by a rule written
    // for the browser's navigation animation.
    test('an app-thrown abort that is NOT the browser\'s navigation transition is kept', () => {
        assert.equal(reports('Transition was aborted by the overlay before it opened'), true);
        assert.equal(reports('AbortError: Transition was aborted'), true);
    });
});

describe('service-worker update failures', () => {
    test('a network blip during the background update check is dropped', () => {
        for (const net of ['net::ERR_INTERNET_DISCONNECTED', 'NetworkError', 'Failed to fetch', 'Load failed']) {
            assert.equal(reports(`Failed to update a ServiceWorker: ${net}`), false, net);
        }
    });
    test('a GENUINE service-worker installation failure is kept', () => {
        // A script that cannot be parsed or executed is worded differently and is a real fault —
        // it means the app cannot update at all.
        assert.equal(reports('Failed to update a ServiceWorker: the script has an unsupported MIME type'), true);
        assert.equal(reports('ServiceWorker script evaluation failed'), true);
    });
});

describe("WebKit's IndexedDB teardown (v19.20 — reported from an iPhone on 19.19)", () => {
    // Firebase Auth's indexedDBLocalPersistence POLLS its object store because Safari's storage
    // events are unreliable across tabs. WebKit closes IDB connections when it suspends a page
    // (backgrounding the PWA, screen lock, memory pressure), so a poll landing in that window throws
    // from deep inside the SDK with no app frame on the stack. Harmless and self-healing — but it
    // recurs on every iPhone, and the Error Log is only worth reading if it is mostly signal.
    const TEARDOWN = [
        "Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing.",
        'Connection to Indexed Database server lost. Refresh the page to try again',
        'An internal error was encountered in the Indexed Database server',
    ];

    for (const msg of TEARDOWN) {
        test(`dropped when it comes from the SDK — ${msg.slice(0, 40)}…`, () => {
            assert.equal(reports(msg, SDK), false);
        });

        test(`KEPT when it comes from our OWN code — ${msg.slice(0, 40)}…`, () => {
            // Same phrase from our own origin means the FIRESTORE persistent cache is failing,
            // which is a real fault: the calendar's offline-first paint depends on it. Scoping the
            // filter to the SDK origin is the whole difference between suppressing noise and
            // going blind to a broken cache.
            assert.equal(reports(msg, OWN), true);
        });
    }

    test('an unrelated IndexedDB error from the SDK is still kept', () => {
        // The filter matches exact teardown phrases, never a loose substring — a quota failure or a
        // version conflict is a real problem that happens to involve the same subsystem.
        assert.equal(reports('QuotaExceededError: IndexedDB storage is full', SDK), true);
        assert.equal(reports('VersionError: The requested version is less than the existing version', SDK), true);
        // This one is load-bearing: it is the SAME API call as the teardown error and differs only
        // in the tail, so it contains "IDBDatabase" — and therefore the substring "Database".
        // Without it, loosening the phrase list to a generic 'Database' passes the whole suite
        // (verified: it did), and a real version-conflict would vanish from the log unnoticed.
        assert.equal(
            reports("Failed to execute 'transaction' on 'IDBDatabase': A version change transaction is running.", SDK),
            true);
    });
});

describe('ordinary app errors always report', () => {
    for (const msg of [
        "Cannot read properties of undefined (reading 'name')",
        'tips.sections is not iterable',
        'permission-denied: Missing or insufficient permissions.',
        'Failed to execute \'setItem\' on \'Storage\': quota exceeded',
    ]) {
        test(msg.slice(0, 50), () => assert.equal(reports(msg), true));
    }
});
