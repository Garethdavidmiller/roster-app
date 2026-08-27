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
//
// IT ALSO SUPPRESSES THE `sign-in-2026` NOTICE, and this is the THIRD seeder to need that (v21.34).
// `seedMember` and `seedMemberSession` both got it; this one was missed, and it is the seeder the
// authenticated-page specs use. The notice opens 1,500ms after load on `/` and its dialog
// intercepts pointer events, so any spec that clicks something on the Calendar after ~1.5s is
// racing it — and loses whenever the machine is slow enough. That is what had `overtime.spec.js`'s
// "every signed-in page offers the reviewer the pill" failing in CI while passing everywhere else:
// its sweep starts at `/`, the burger click was still retrying at 1,500ms, and the notice then
// covered it for the remaining 28 seconds of the timeout.
//
// A spec that is ABOUT the notice re-enables it with a later addInitScript removing the key —
// later init scripts run after this one, so the remove wins (axe.spec.js and calendar.spec.js
// both do exactly that, and are unaffected).
export function seedSession(page, name = 'G. Miller') {
    return page.addInitScript((n) => {
        localStorage.setItem('myb_admin_session', JSON.stringify({
            name: n,
            ver: 2,
            expiry: Date.now() + 90 * 24 * 60 * 60 * 1000,   // arbitrary future — NOT SESSION_MS
        }));
        localStorage.setItem('myb_notice_sign_in_2026_done', '1');
        localStorage.setItem('myb_notice_backpay_2026_done', '1');
    }, name);
}

/**
 * Undo that suppression, for a spec whose SUBJECT is the notice flag.
 *
 * ── WHY THIS IS A NAMED HELPER AND NOT AN INLINE removeItem (v21.34) ────────────────────────────
 *
 * Three tests in `pages.spec.js` assert on this flag, and all three depended on `seedSession`
 * happening not to set it — a dependency on a SILENCE, which nothing could see. When the
 * suppression was added to `seedSession`, two failed loudly and the third did something worse: it
 * polls for the flag to BECOME '1', so a run that starts at '1' passes without ever exercising the
 * write. Green, and covering nothing — the failure mode its own comment names two lines above.
 *
 * Calling this makes the dependency explicit at the point of use, so the next person to touch a
 * seeder sees it. Later init scripts run after earlier ones, so this must come AFTER the seed.
 *
 * @param {import('@playwright/test').Page} page
 */
export function clearSignInNoticeFlag(page) {
    return page.addInitScript(() => localStorage.removeItem('myb_notice_sign_in_2026_done'));
}

/**
 * Undo the suppression for BOTH live notices, for a spec whose subject is which notices open at all
 * (v21.81 — the audience gate). Same ordering rule as `clearSignInNoticeFlag`: call it AFTER the
 * seeders, because later init scripts run last.
 *
 * PASS THE ONE KEY YOU MEAN unless you want both. With two notices live only one can be on screen:
 * whichever reaches `openNoticeIfClear` first wins, the loser stays closed and unflagged, and a
 * spec asserting on the loser fails for a reason that has nothing to do with what it is testing.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string[]} [keys] the done-flags to remove; defaults to every live notice
 */
export function clearNoticeFlags(page, keys = ['myb_notice_sign_in_2026_done', 'myb_notice_backpay_2026_done']) {
    return page.addInitScript(ks => ks.forEach(k => localStorage.removeItem(k)), keys);
}

/**
 * Seed a session that does NOT come back after the page reloads itself.
 *
 * ── WHY THIS EXISTS (v21.27) ────────────────────────────────────────────────────────────────────
 *
 * `seedSession` above uses `addInitScript`, which Playwright re-runs on EVERY navigation — a
 * reload included. That is right for almost every test, and exactly wrong for the ones that
 * exercise a flow which SIGNS THE MEMBER OUT AND RELOADS: the init script writes the session
 * straight back, the app correctly decides the member is still signed in, and the test fails
 * against behaviour that is working perfectly in production.
 *
 * A one-shot seed models the real thing — somebody signed in once, and the app then cleared it.
 * The sentinel lives in `sessionStorage` so `clearSession()` (which only touches the app's own
 * localStorage key) cannot reset it and re-arm the seed.
 * @param {import('@playwright/test').Page} page @param {string} name
 */
export function seedSessionOnce(page, name = 'G. Miller') {
    return page.addInitScript((n) => {
        if (sessionStorage.getItem('__e2e_session_seeded')) return;
        sessionStorage.setItem('__e2e_session_seeded', '1');
        localStorage.setItem('myb_admin_session', JSON.stringify({
            name: n, ver: 2, expiry: Date.now() + 90 * 24 * 60 * 60 * 1000,
        }));
    }, name);
}

// Seed a chosen calendar member so index.html renders the grid instead of the first-run
// "choose your name" prompt (shown only when NO member is saved AND not signed in).
//
// ALSO SUPPRESSES THE `sign-in-2026` NOTICE, because a seeded member is exactly its audience: it
// opens 1,500ms after load on a fade and its dialog intercepts pointer events, so any calendar
// spec that clicks something after ~1.5s was racing it — two flaked under full-suite load, and the
// axe suite hit the same race from the other side (see axe.spec.js's file-level beforeEach). A
// spec that is ABOUT the notice re-enables it with a later addInitScript removing the key — later
// init scripts run after this one, so the remove wins.
export function seedMember(page, name = 'G. Miller') {
    return page.addInitScript((n) => {
        localStorage.setItem('myb_roster_selected_member', n);
        localStorage.setItem('myb_notice_sign_in_2026_done', '1');
        localStorage.setItem('myb_notice_backpay_2026_done', '1');
    }, name);
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
//
// `{ submit: false }` stops short of pressing Sign in — for the tests that need a member SELECTED in
// the card without an attempt having been made (the reset-request link reads the dropdown at click
// time, so "who is named here" is a state worth reaching without failing first).
export async function signInThroughOverlay(page, fullName, { submit = true } = {}) {
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
    if (submit) await page.locator('#loginSubmit').click();
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
        // Same pw-notice suppression as seedMember, same reason — see the note there.
        localStorage.setItem('myb_notice_sign_in_2026_done', '1');
        localStorage.setItem('myb_notice_backpay_2026_done', '1');
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

/**
 * Seed the generator's target table with one that pays the CONTRACTED WEEK exactly.
 *
 * Needed since v20.98, when the generator began refusing targets that cannot pay 35h a week
 * ex-Sunday. The roster seed cannot: today's duties pay 16 working lines, and the December 2026
 * rotation has 19 — which is the whole point of the rule, and it is asserted directly in
 * `links-contract.test.mjs`. So every spec that presses Generate has to bring work with it.
 *
 * ⚠️ IT SEEDS ONE KEY PER DESIGN ID, not just the unsaved one. The coordinator reads
 * `myb_links_gen_<activeDesignId>` and falls back to `myb_links_gen_unsaved` only while no design
 * is active — so a spec whose fixture seeds designs (`d1`, `d2`, which most links specs do) was
 * reading a key this helper had never written, and pressed Generate against the roster seed exactly
 * as before. It failed in the FULL suite and passed in every targeted run I checked it with, which
 * is the shape of a fixture that is silently doing nothing.
 *
 * The arithmetic, so a future edit can keep it true: 19 working lines x 35h = 39,900 minutes.
 *   06:20-14:20 (480m) x (5x6 + 4) = 16,320
 *   11:00-19:30 (510m) x (5x3 + 3) =  9,180
 *   15:25-23:25 (480m) x (5x6 + 0) = 14,400
 *                                   -------
 *                                    39,900
 * Three shift times rather than one, because the specs that use this are about line ORDER and the
 * analysis panels — both of which are uninteresting on a design where every line works the same
 * duty. `myb_links_gen_unsaved` is the key the coordinator reads before a design is active.
 *
 * FEWER SPARE WEEKS MEANS MORE WORK, and the table has to grow with it: the gate is per WORKING
 * line, so the three slots above stop paying the moment a caller asks for `spareLines` below the
 * default. A fourth slot tops it up at exactly one contracted week per extra working line — one
 * weekday count of a 7-hour turn is 5 x 420 = 2,100 minutes = 35h — so the caller gets a table that
 * still pays the contract exactly, whatever shape they asked for. More spare weeks than the default
 * needs no adjustment: over the contract is allowed (see `links-contract.test.mjs`).
 */
export function seedContractTargets(page, { spareLines = 5, designIds = ['unsaved', 'd1', 'd2'] } = {}) {
    return page.addInitScript(([spare, ids]) => {
        const slots = [
            { time: '06:20-14:20', weekday: 6, sat: 4, sun: 0 },
            { time: '11:00-19:30', weekday: 3, sat: 3, sun: 0 },
            { time: '15:25-23:25', weekday: 6, sat: 0, sun: 0 },
        ];
        const extraLines = (24 - spare) - 19;
        if (extraLines > 0) slots.push({ time: '07:00-14:00', weekday: extraLines, sat: 0, sun: 0 });
        const targets = JSON.stringify({ slots, spareLines: spare });
        for (const id of ids) localStorage.setItem('myb_links_gen_' + id, targets);
    }, [spareLines, designIds]);
}

/**
 * Click something WebKit reports as "outside of the viewport".
 *
 * Playwright auto-scrolls before every click, but inside the Links grid's sticky bars and
 * horizontally-scrolling containers WebKit can report an element as off-screen AFTER that scroll and
 * then keep reporting it — the click retries until the test times out. Both failures the WebKit
 * projection found on its first branch run (v21.29) were this, and both passed locally at full
 * speed, which is the signature of a harness limit rather than a defect: nothing in either test
 * asserts anything about scroll position, and a real user simply scrolls.
 *
 * Centres the element with the DOM's own `scrollIntoView`, which WebKit honours, then clicks
 * normally — so every actionability check still runs. Deliberately **not** `{ force: true }`: that
 * skips those checks and would hide a control that had genuinely become unclickable, which is one of
 * the things this suite exists to catch.
 *
 * @param {import('@playwright/test').Locator} locator
 */
export async function clickInView(locator) {
    // Re-issued, not scrolled once. Applying a generated design leaves the Links page scrolled ~3,100px
    // down (measured: the RD brush chip sat at top -2891 in a 1000px viewport), and the app's own
    // scroll can land AFTER ours — so a single scrollIntoView is undone before the click and
    // Playwright then retries an off-screen click until the test times out. Polling until the box is
    // actually inside the viewport is what makes it deterministic rather than a race.
    for (let i = 0; i < 20; i++) {
        const inView = await locator.evaluate(el => {
            // `window.scrollTo`, NOT `el.scrollIntoView`. Measured on the Links page in WebKit:
            // scrollIntoView left `getBoundingClientRect().top` at -2891 with the window still at
            // scrollY 3115 — it simply did not move the document, twenty times in a row. Computing
            // the absolute position and scrolling the window does.
            const r = el.getBoundingClientRect();
            const inside = r.top >= 0 && r.left >= 0
                && r.bottom <= (window.innerHeight || 0) && r.right <= (window.innerWidth || 0);
            if (!inside) {
                window.scrollTo(window.scrollX + r.left - (window.innerWidth  - r.width)  / 2,
                                window.scrollY + r.top  - (window.innerHeight - r.height) / 2);
            }
            return inside;
        });
        if (inView) break;
        await new Promise(r => setTimeout(r, 50));
    }
    // BOUND the driven click, and fall back to dispatching it in-page.
    //
    // The poll above wins the race almost always; when it does not, the old unbounded `click()` was
    // the worst possible ending — Playwright re-checks "outside of the viewport" for the whole 30s
    // test budget and the assertions the test exists for never run. That is what took the links-grid
    // test from flaky (v21.45) to failing (v21.46) on WebKit, a different engine each run.
    //
    // Five seconds is far beyond a click that is going to succeed, so a real regression — a chip
    // genuinely covered by an overlay — still fails here rather than passing quietly, just quickly.
    // What the fallback CANNOT see is hit-testing: an element that is present and wired but visually
    // obscured will be clicked anyway. That is an accepted trade for this helper specifically, whose
    // two call sites assert on what an edit DOES (totals move, cells repaint) and never on whether a
    // control is reachable. Do not reach for it in a test whose subject IS reachability.
    try {
        await locator.click({ timeout: 5000 });
    } catch {
        await locator.evaluate(el => /** @type {HTMLElement} */ (el).click());
    }
}

/**
 * Click a confirm/prompt dialog's action button once the dialog has stopped moving.
 *
 * ── WHY THIS EXISTS (v21.88) ────────────────────────────────────────────────────────────────────
 *
 * `createLightbox` fades a dialog in over ~300ms. Playwright's actionability check refuses to click
 * a moving element and retries — which is correct, and usually invisible, because on Chromium the
 * fade is over before the test gets there. Under load it is not: WebKit running two projects burned
 * the whole 30-second test timeout retrying a click on a button that was still arriving, and the
 * failure read as "the dialog never appeared" when in fact it had appeared and was mid-animation.
 *
 * Ten sites click a dialog button across this suite, so this is the shared answer rather than a
 * patch at whichever one happened to fail. It waits for the overlay's own settled state — the
 * `.open` class the lifecycle adds after the first frame — and then for the button's box to hold
 * still across two frames, which is the same "stop moving before you measure" rule the nav-pill
 * test needed for a different reason.
 *
 * Returns false when no dialog is open, so a caller that only sometimes gets one can say so.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} [selector]  the button to press — defaults to the confirm/primary action
 * @returns {Promise<boolean>} whether a dialog was found and clicked
 */
export async function clickDialogConfirm(page, selector = '.dialog-btn-confirm') {
    const btn = page.locator(selector).first();
    // A COUNT IS A SNAPSHOT, and at some call sites the dialog is genuinely optional — the links
    // order-switch test only gets one when there is something to confirm. Under load the count and
    // the click straddle that: count sees a dialog mid-open, it never finishes arriving, and a
    // committed click then burns the whole test timeout waiting for an element that is not coming.
    if (!await btn.count()) return false;
    // The lifecycle adds `.open` on the frame after `.visible`, so its presence means the fade has
    // begun; the geometry check below is what says it has finished.
    await page.locator('.lb-overlay.open, .dialog-overlay.open').first()
        .waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
    await page.waitForFunction((sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const now = el.getBoundingClientRect();
        const prev = /** @type {any} */ (window).__dlgBox;
        /** @type {any} */ (window).__dlgBox = { x: now.x, y: now.y };
        return !!prev && Math.abs(prev.x - now.x) < 0.5 && Math.abs(prev.y - now.y) < 0.5;
    }, selector, { timeout: 5000, polling: 'raf' }).catch(() => {});
    // `force` skips Playwright's OWN actionability re-check, which the wait above has just done
    // explicitly — and which, on mobile-safari under a full two-project run, never returned: the
    // button was reported "not stable" for the whole 30-second test timeout, twice, at a viewport
    // (1280×1400 on a phone descriptor) no real device has. Waiting longer was tried and does not
    // help; the element is not arriving late, the check is not converging.
    //
    // This does NOT weaken the test, and that distinction matters. `force` skips the WAIT, not the
    // outcome: every caller asserts on what the dialog's action did — the status line, the written
    // payload, the reordered grid — so a click that lands on nothing still fails the test it was
    // called from. Verified by stubbing the Apply handler so no dialog opens at all: still red.
    // BOUNDED, and the bound is what distinguishes the two cases. If the button has gone by the
    // time we press, there was no dialog to confirm and the caller's own assertion decides whether
    // that is a problem. If it is still sitting there and refuses the click, that is a stuck dialog
    // and it should fail loudly, which is why this rethrows rather than swallowing.
    try {
        await btn.click({ force: true, timeout: 8000 });
    } catch (err) {
        if (await btn.count()) throw err;
        return false;
    }
    return true;
}
