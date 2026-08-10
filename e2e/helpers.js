// Shared helpers for the Playwright specs. Extracted from smoke.spec.js when it was split
// into per-area files (v17.46) so every spec draws from one source. Imported by
// calendar.spec.js, auth.spec.js, paycalc.spec.js, pages.spec.js, responsive.spec.js.

import { expect } from '@playwright/test';
import { enforceNamedSession } from './fixtures.js';

// Collect uncaught JS exceptions on a page. Firebase network/auth errors are
// filtered out — they're expected when running against localhost with no valid
// referrer, and the app handles them gracefully with no visible effect.
export function collectFatalErrors(page) {
    const errors = [];
    page.on('pageerror', err => {
        const msg = err.message || '';
        if (
            msg.includes('FirebaseError') ||
            msg.includes('auth/') ||
            msg.toLowerCase().includes('network request failed') ||
            msg.toLowerCase().includes('failed to fetch')
        ) return;
        errors.push(msg);
    });
    return errors;
}

// Seed a valid signed-in session before any page script runs. Shape must match
// session.js getSession(): { name, ver: SESSION_VER (2), expiry }. There is no idle timestamp —
// the 7-day inactivity cutoff was removed at v20.41, leaving `expiry` as the only clock.
//
// The expiry below is deliberately an ARBITRARY future date, not a copy of `SESSION_MS`: these
// tests only need a session that is unexpired, and mirroring the real term would make every spec
// a place the policy is restated (it changed 30 → 60 at v20.47 and nothing here needed to move).
export function seedSession(page, name = 'G. Miller') {
    return page.addInitScript((n) => {
        localStorage.setItem('myb_admin_session', JSON.stringify({
            name: n,
            ver: 2,
            expiry: Date.now() + 90 * 24 * 60 * 60 * 1000,   // arbitrary future — NOT SESSION_MS
        }));
    }, name);
}

// Seed a chosen calendar member so index.html renders the grid instead of the first-run
// "choose your name" prompt (shown only when NO member is saved AND not signed in).
export function seedMember(page, name = 'G. Miller') {
    return page.addInitScript((n) => localStorage.setItem('myb_roster_selected_member', n), name);
}

// Select the first real grade, then its first member, and return that member's expected
// surname password (mirrors normaliseSurname: drop the initial, keep the surname,
// lowercase, strip non-alpha).
export async function pickFirstMemberAndPassword(page) {
    await page.locator('#loginGrade option').nth(1).waitFor({ state: 'attached' });
    await page.locator('#loginGrade').selectOption({ index: 1 });
    await page.locator('#loginName option').nth(1).waitFor({ state: 'attached' });
    const name = await page.locator('#loginName option').nth(1).getAttribute('value');
    await page.locator('#loginName').selectOption(name);
    const pw = name.split(' ').slice(1).join('').toLowerCase().replace(/[^a-z]/g, '');
    return { name, pw };
}

// Desktop widths exercised by the geometry checks (1024 = the desktop breakpoint edge).
export const DESKTOP_WIDTHS = [1024, 1280, 1440];

// Flip the B1 kill-switch on and force every sign-in to fail, then seed a valid local session.
export async function armEnforcementWithFailingSignIn(page, name = 'G. Miller') {
    await enforceNamedSession(page);
    await page.addInitScript(() => { window.__E2E = { failSignIn: true }; });
    await seedSession(page, name);
}

// Drive the real login overlay: find the grade that lists `fullName`, select it, type the
// surname password (mirrors normaliseSurname), submit. The fixture's default sign-in resolves.
export async function signInThroughOverlay(page, fullName) {
    await page.locator('#loginOverlay').waitFor({ state: 'visible' });
    const grades = await page.locator('#loginGrade option').evaluateAll(
        opts => opts.map(o => o.value).filter(Boolean));
    for (const g of grades) {
        await page.locator('#loginGrade').selectOption(g);
        const names = await page.locator('#loginName option').evaluateAll(opts => opts.map(o => o.value));
        if (names.includes(fullName)) break;
    }
    await page.locator('#loginName').selectOption(fullName);
    const pw = fullName.split(' ').slice(1).join('').toLowerCase().replace(/[^a-z]/g, '');
    await page.locator('#loginPassword').fill(pw);
    await page.locator('#loginSubmit').click();
}


// ── Roster review table ───────────────────────────────────────────────────────────────────────
// The review table only exists after a successful PDF parse, so reaching it means stubbing the
// Cloud Function and driving the real upload flow. Defined ONCE here because two suites need it:
// the opt-in visual baseline (composition) and the CI-gated smoke test (wiring). A copy in each
// would drift, and the fixture is the part that has to stay honest.
//
// The week is chosen so the flagged rows land on days G. Miller WORKS: on a base rest day both
// candidate readings normalise to RD, the picker is correctly not offered, and a test written
// against a rest day would silently cover nothing.
export const ROSTER_REVIEW_DATES = [
    '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08',
];

/** Rows produced: 3 × DIFF, 1 × CONFLICT (seeded below), 1 flagged-garbled, 2 flagged-with-readings. */
export const ROSTER_REVIEW_PARSE = {
    weekEnding: '2026-08-08',
    rosterType: 'cea',
    dates: ROSTER_REVIEW_DATES,
    crossCheck: 'partial',
    missingMembers: [],
    choices: {
        'G. Miller|2026-08-06': ['RDW|14:30-22:00', 'SICK'],
        'G. Miller|2026-08-07': ['AL', 'RD'],
    },
    parsed: [{
        memberName: 'G. Miller',
        shifts: {
            '2026-08-02': 'RD',
            '2026-08-03': '06:00-14:00',
            '2026-08-04': '13:00-21:00',
            '2026-08-05': 'UNKNOWN|XZ9 GARBLED',
            '2026-08-06': 'UNKNOWN|RDW 14:30-22:00 or Absent? (PDF unclear)',
            '2026-08-07': 'UNKNOWN|AL or Rest day? (PDF unclear)',
            '2026-08-08': 'AL',
        },
    }],
};

/**
 * Drive the real Operations roster upload to a rendered review table. The caller seeds the session
 * (and viewport/clock) first; this does the navigation.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ wasParseCalled: () => boolean }>}
 */
export async function openRosterReview(page) {
    // A seeded MANUAL override on the Tuesday gives the CONFLICT row something to conflict with.
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = /** @type {any} */ (window).__E2E || {};
        /** @type {any} */ (window).__E2E.docs = [{
            id: 'm1', memberName: 'G. Miller', date: '2026-08-04',
            value: '23:00-06:00', type: 'shift', source: 'manual',
        }, {
            // A MANUAL entry under a FLAGGED row (Thu). Picking a reading would replace it, so the
            // row has to show it — the review table's "never silently overwrite a manual entry"
            // guarantee (v19.37).
            id: 'm2', memberName: 'G. Miller', date: '2026-08-06',
            value: 'AL', type: 'annual_leave', source: 'manual',
        }];
    });
    let called = false;
    await page.route('**/parseRosterPDF*', route => {
        called = true;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROSTER_REVIEW_PARSE) });
    });

    await page.goto('/operations.html');
    await expect(page.locator('#rosterUploadCard')).toBeVisible();
    await page.evaluate(() => {
        const b = document.getElementById('rosterUploadBody');
        if (b && !b.classList.contains('open')) document.getElementById('rosterUploadToggleHeader')?.click();
    });
    await page.locator('#rosterWeekEnding').evaluate(el => {
        /** @type {any} */ (el).value = '2026-08-08';
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.setInputFiles('#rosterFileInput',
        { name: 'roster.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fixture') });
    await page.locator('#rosterParseBtn').click();
    await expect(page.locator('.roster-change-row').first()).toBeVisible({ timeout: 15000 });
    return { wasParseCalled: () => called };
}

/**
 * Open the drawer and expand its "Reference" section, then return the named guide link.
 *
 * Written once because four specs needed it, and four inline copies is how a collapse-state change
 * becomes a four-file edit. That paid off immediately: the section was collapsed by default at
 * v20.06 and expanded again at v20.09, and because `openReference` only clicks when it finds the
 * section CLOSED, neither change touched a spec. A helper that clicked unconditionally would have
 * closed the section at v20.09 and failed all four.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} label - the guide's visible label, e.g. 'Railcard Guide'
 */
export async function openGuideLink(page, label) {
    await openReference(page);
    return page.locator('.nav-panel-link--guide', { hasText: label });
}

/**
 * Open the drawer and expand its "Reference" section — the guides AND App Notices live there.
 *
 * Split out from `openGuideLink` because App Notices is not a guide link but is behind the same
 * collapse, and the visual suite needs it. **Idempotent, and that is load-bearing rather than
 * tidy:** it expands only when it finds the section closed, so it is correct whichever way the
 * default currently points (collapsed v20.06, expanded again v20.09) and a caller that already
 * opened the section does not collapse it again.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function openReference(page) {
    await page.locator('#navMenuBtn').click();
    const toggle = page.locator('#navGuidesToggle');
    if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
}

// ── Staff Calendar PIN (v20.12) ─────────────────────────────────────────────────────────────────

/**
 * Seed a signed-in MEMBER for the Calendar: the local session AND the Firebase identity.
 *
 * BOTH are required, and that is the point rather than an inconvenience. `decideAccess` demands a
 * live local session *and* a restorable named identity — a member holding only one of the two sees
 * the PIN, which is a real state (iOS ITP evicts IndexedDB after ~7 days of no PWA use). A helper
 * that seeded only the session would make every "member sees no PIN" test fail for a reason that
 * has nothing to do with what it was written to check.
 */
export function seedMemberSession(page, name = 'G. Miller') {
    return page.addInitScript((n) => {
        localStorage.setItem('myb_admin_session', JSON.stringify({
            name: n, ver: 2,
            expiry: Date.now() + 90 * 24 * 60 * 60 * 1000,   // arbitrary future — NOT SESSION_MS
        }));
        localStorage.setItem('myb_roster_selected_member', n);
        window.__E2E = Object.assign(window.__E2E || {}, { authUser: true });
    }, name);
}

/**
 * Intercept the PIN exchange so a spec can drive the REAL unlock path without a Cloud Function.
 *
 * The endpoint is an ordinary HTTPS POST, so Playwright routes it directly — which means the spec
 * exercises `calendar-access.js`'s whole ladder (fetch → persistence switch → custom-token sign-in
 * → claim verification), not a shortcut around it. `status` lets a spec produce the three failures
 * that matter: 401 (wrong PIN), 429 (throttled) and a transport failure.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ status?: number, token?: string|null, abort?: boolean }} [opts]
 */
export async function stubPinExchange(page, { status = 200, token = 'E2E_VIEWER_TOKEN', abort = false } = {}) {
    await page.route('**/unlockCalendarViewer', async (route) => {
        if (abort) return route.abort('failed');
        await route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(status === 200 ? (token ? { token } : {}) : { error: 'nope' }),
        });
    });
}

/** Type the PIN and press Unlock. Uses the real form, so the digits-only filter and the
 *  disabled-until-complete button are exercised rather than bypassed. */
export async function enterPin(page, pin = '1234') {
    await page.locator('#calLockPin').fill(pin);
    await page.locator('#calLockSubmit').click();
}

/**
 * Give this page Calendar access as the shared staff-PIN VIEWER, with no member session.
 *
 * The default state for every Calendar spec that is not specifically about a signed-in member,
 * because it is the state most of them were implicitly written against: the roster is on screen and
 * `getSession()` is null. Before v20.12 that was simply what an unauthenticated visitor got; now it
 * takes an unlock, and a viewer session is exactly what an unlocked shared PC holds.
 *
 * Seeded through sessionStorage rather than by driving the PIN card, so a spec about first-run
 * behaviour or the stale-member banner does not have to type four digits before it can begin. The
 * flow itself is covered end-to-end in calendar-pin.spec.js.
 */
export function seedViewerAccess(page) {
    return page.addInitScript(() => {
        try { sessionStorage.setItem('__e2e_viewer', '1'); } catch (_) { /* private mode */ }
    });
}
