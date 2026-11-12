// Playwright configuration for the SIGNED-IN lane — the app's real Firebase SDK against the local
// emulators (signed-in-fixtures.js says why the lane exists and how it is wired).
//
// Run with `npm run test:signed-in`, never directly: scripts/signed-in.mjs starts the Auth, Firestore
// and Functions emulators, makes the roster's accounts the way production does, runs this and stops
// them. Run on its own, every test stops at its first step with "no Firestore emulator", which is why.
//
// WHY THIS CONFIG IS IN e2e/ WHEN EVERY OTHER IS AT THE ROOT: Firebase Hosting publishes the checkout
// root, so a new root file is SERVED unless firebase.json's ignore list names it — and a change to
// firebase.json is a release, with a version bump that sends every device a new service worker. A test
// lane must not cost that. e2e/ is already outside the bundle, the deploy trigger and the version
// check. So every path below is relative to e2e/, and the output goes to the root like every lane's.

import { defineConfig, devices } from '@playwright/test';
import { devServer } from './dev-server.mjs';
import { IPHONE_PRO_VIEWPORT } from '../playwright.webkit.mjs';

const DEV = devServer(4001);

export default defineConfig({
    testDir: '.',
    testMatch: ['signed-in.spec.js'],
    outputDir: '../test-results',

    // A real sign-in, a real Firestore round trip and a Cloud Function cold start are each slower
    // than the stub's answers; these give the emulators room without hiding a hang.
    timeout: 90_000,
    expect: { timeout: 20_000 },

    // ONE worker: every test shares one set of emulators, and the accounts in them are the roster's.
    // Each test starts from an empty database (the spec's beforeEach), but two tests signing the same
    // member in at once would race on that member's own records.
    workers: 1,
    fullyParallel: false,

    // Same as the smoke lane, for the same reason: one retry in CI absorbs a dropped local socket,
    // and the run still prints `flaky` rather than `passed`.
    retries: process.env.CI ? 1 : 0,
    forbidOnly: !!process.env.CI,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: '../playwright-report' }]] : 'list',

    use: {
        baseURL: DEV.baseURL,
        // The app's service worker would answer fetches itself and step around the routes that send
        // the SDK's calls to the emulators.
        serviceWorkers: 'block',
        // NOT bypassCSP: each page keeps its own CSP, widened by the emulators' addresses alone
        // (e2e/signed-in-fixtures.js → allowEmulatorsInCsp). WebKit would enforce the <meta> tag anyway.
        trace: 'retain-on-failure',
    },

    // The two phones staff carry: Android Chrome and iPhone Safari, both with a real coarse pointer.
    projects: [
        {
            name: 'mobile-chrome',
            use: {
                ...devices['Pixel 5'],
                // Chrome's Local Network Access rule: a page with no network address of its own is
                // filed as a PUBLIC site, and its requests to 127.0.0.1 wait for a permission prompt
                // nobody in a headless browser can answer — the sign-in hangs with no error at all.
                // Every page here arrives through Playwright (its CSP is widened in transit, see
                // signed-in-fixtures.js), so it has no address. This grants the permission a person
                // would be asked for; it switches nothing else off. WebKit has no such rule, and
                // refuses the permission's name, so it is Chrome's alone.
                permissions: ['local-network-access'],
            },
        },
        { name: 'mobile-safari', use: { ...devices['iPhone 13'], viewport: IPHONE_PRO_VIEWPORT } },
    ],

    webServer: DEV.webServer,
    globalSetup: DEV.globalSetup,
});
