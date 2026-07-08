/**
 * Smoke tests — verify every app page loads and runs JS without crashing.
 *
 * Philosophy: test the RENDERED output, not the static HTML.
 * Every assertion below targets an element that only exists if JavaScript
 * actually ran and completed (month heading built from roster data,
 * grade options injected from teamMembers, period options from pay schedule).
 * A 404, a CSP violation, a SyntaxError, or a module import failure all
 * produce a blank page with none of those elements — the test fails.
 *
 * Firebase is stubbed at the network layer (see ./fixtures.js): the gstatic
 * Firebase SDK modules are intercepted and served as local no-op stubs, so the
 * suite never depends on a live CDN and verifies our own UI, not Firestore.
 * (Before this, every page's static import of the Firebase SDK meant a slow or
 * blocked CDN on the CI runner aborted the whole module graph — no JS ran and
 * every test timed out. The stub removes that single point of failure.)
 *
 * Run: npx playwright test
 */

import { test, expect, enforceNamedSession, enableInplaceLogin } from './fixtures.js';

// Collect uncaught JS exceptions on a page. Firebase network/auth errors are
// filtered out — they're expected when running against localhost with no valid
// referrer, and the app handles them gracefully with no visible effect.
function collectFatalErrors(page) {
    const errors = [];
    page.on('pageerror', err => {
        const msg = err.message || '';
        if (
            msg.includes('FirebaseError') ||
            msg.includes('auth/') ||
            msg.toLowerCase().includes('network request failed') ||
            msg.toLowerCase().includes('failed to fetch')
            // (The old 'Not authorised — redirecting' / 'Not signed in — showing login overlay'
            //  suppressions were removed at v15.07: those top-level throws no longer exist — the
            //  Phase 4a.2 coordinators early-return instead — so keeping the filters could only
            //  ever hide a future real error that happened to match those strings.)
        ) return;
        errors.push(msg);
    });
    return errors;
}

// Seed a valid signed-in session before any page script runs. Shape must match
// session.js getSession(): { name, ver: SESSION_VER (2), expiry, lastActivity }.
// Pages with a session guard (paycalc redirects unsigned users to admin.html;
// settings runs its full initApp only when signed in) need this to exercise the
// signed-in path. addInitScript runs on every navigation before page JS.
function seedSession(page, name = 'G. Miller') {
    return page.addInitScript((n) => {
        localStorage.setItem('myb_admin_session', JSON.stringify({
            name: n,
            ver: 2,
            expiry: Date.now() + 30 * 24 * 60 * 60 * 1000,
            lastActivity: Date.now(),
        }));
    }, name);
}

// Seed a chosen calendar member so index.html renders the grid instead of the first-run
// "choose your name" prompt (which shows only when NO member is saved AND not signed in).
// Use in calendar render/geometry tests that assert the grid. (Onboarding H1.)
function seedMember(page, name = 'G. Miller') {
    return page.addInitScript((n) => localStorage.setItem('myb_roster_selected_member', n), name);
}

// ── CALENDAR (index.html) ──────────────────────────────────────────────────

test('calendar: renders the current month from roster data', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedMember(page);   // saved member → render the grid, not the first-run prompt (H1)
    await page.goto('/');

    // .month-year is built entirely by JS — if this is visible, the whole
    // roster-data → buildCalendarContainer → renderCalendar pipeline ran.
    await expect(page.locator('.month-year')).toBeVisible();

    // At least one day cell must exist (the calendar grid rendered)
    await expect(page.locator('.calendar-day').first()).toBeVisible();

    expect(errors, 'Uncaught JS exceptions on index.html').toHaveLength(0);
});

test('calendar: first run (no saved member, not signed in) shows the choose-your-name prompt', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.goto('/');   // fresh context: no saved member, no session → first run
    // Prompt shows INSTEAD of a rendered roster.
    await expect(page.locator('.first-run-prompt')).toBeVisible();
    await expect(page.locator('.calendar-day')).toHaveCount(0);
    await expect(page.locator('#teamMemberSelect option').first()).toHaveText('— Choose your name —');
    // No default member leaked onto the print header (stampPrintDate + beforeprint must respect first run).
    expect(await page.locator('.header').getAttribute('data-member-name'),
        'first run must not stamp a member on the print header').toBeNull();
    // Picking a name renders the real calendar and clears the prompt (index 0 is the placeholder).
    await page.locator('#teamMemberSelect').selectOption({ index: 1 });
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await expect(page.locator('.first-run-prompt')).toHaveCount(0);
    expect(errors, 'Uncaught JS exceptions on first-run calendar').toHaveLength(0);
});

test('calendar: first-run pick survives a failed localStorage write (iOS private mode)', async ({ page }) => {
    const errors = collectFatalErrors(page);
    // Simulate iOS Safari private mode: writing the selected-member key throws, so it never persists.
    // The in-memory backstop must still clear the first-run prompt and show the picked member's
    // calendar — otherwise the prompt re-appears on every render and the app is a dead-end.
    await page.addInitScript(() => {
        const realSet = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
            if (key === 'myb_roster_selected_member') throw new Error('QuotaExceededError (simulated private mode)');
            return realSet.call(this, key, value);
        };
    });
    await page.goto('/');
    await expect(page.locator('.first-run-prompt')).toBeVisible();
    await page.locator('#teamMemberSelect').selectOption({ index: 1 });
    // Pick sticks despite the write failure — calendar renders and the prompt is gone.
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await expect(page.locator('.first-run-prompt')).toHaveCount(0);
    expect(errors, 'Uncaught JS exceptions in private-mode first-run').toHaveLength(0);
});

test('calendar: a removed saved member falls back to the calendar + stale banner, NOT the first-run prompt', async ({ page }) => {
    // Saved member that no longer exists in the roster (e.g. a leaver who was removed).
    await page.addInitScript(() => localStorage.setItem('myb_roster_selected_member', 'Z. Nonexistent'));
    await page.goto('/');
    // Regression: this must render the fallback (default) calendar, not the choose-your-name prompt —
    // the stale case had a saved member at load, so it's not a true first run.
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await expect(page.locator('.first-run-prompt')).toHaveCount(0);
    await expect(page.locator('#errorBanner')).toContainText('no longer in the roster');
});

test('calendar: member dropdown is populated by JS from teamMembers', async ({ page }) => {
    await page.goto('/');
    const select = page.locator('#teamMemberSelect');
    // Wait for JS to populate options — the select is in static HTML so toBeVisible()
    // would pass immediately before any JS runs. toBeAttached() retries until an
    // <option> element is present in the DOM (option elements have no bounding box).
    await expect(select.locator('option').first()).toBeAttached();
    const count = await select.locator('option').count();
    // Should have more than 5 options (the full team, excluding hidden members)
    expect(count, 'teamMemberSelect should have options from teamMembers').toBeGreaterThan(5);
});

test('calendar: nav drawer opens on burger click', async ({ page }) => {
    await page.goto('/');
    // Wait for app.js to finish initialising before clicking. The burger is in
    // static HTML so it is clickable immediately, but initNavPanel() (which wires
    // the click handler) runs during the same init that populates the member
    // dropdown. Clicking before the handler is attached silently loses the click,
    // and the aria-expanded assertion never re-clicks — so it would time out.
    await expect(page.locator('#teamMemberSelect option').first()).toBeAttached();
    await page.locator('#navMenuBtn').click();
    // nav-panel.js sets aria-expanded="true" when the drawer is open
    await expect(page.locator('#navMenuBtn')).toHaveAttribute('aria-expanded', 'true');
});

// ── ADMIN (admin.html) ────────────────────────────────────────────────────

test('admin: login overlay renders with JS-populated grade options', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.goto('/admin.html');

    // Login overlay must be visible (no session in test environment)
    await expect(page.locator('#loginOverlay')).toBeVisible();

    // Grade select — static HTML has only a placeholder; JS adds one option per grade.
    // If JS didn't run the grade list would be empty, login would be unusable.
    const gradeCount = await page.locator('#loginGrade option').count();
    expect(gradeCount, '#loginGrade should have JS-added grade options').toBeGreaterThan(1);

    expect(errors, 'Uncaught JS exceptions on admin.html').toHaveLength(0);
});

// ── LOGIN OVERLAY — the actual sign-in click flow (DOM-level, v14.79) ──────
// The unit suite (login-overlay.test.mjs) tests the DOM-free core (runNamedSignIn); these drive
// the REAL overlay markup + wiring in a browser — selecting grade/name, typing the surname
// password, clicking Sign in — which is where the v14.72–75 freeze regressions actually lived.

// Helper: select the first real grade, then its first member, and return that member's expected
// surname password (mirrors normaliseSurname in firebase-client.js: drop the initial, keep the
// surname, lowercase, strip non-alpha).
async function pickFirstMemberAndPassword(page) {
    await expect(page.locator('#loginGrade option').nth(1)).toBeAttached();
    await page.locator('#loginGrade').selectOption({ index: 1 });
    await expect(page.locator('#loginName option').nth(1)).toBeAttached();
    const name = await page.locator('#loginName option').nth(1).getAttribute('value');
    await page.locator('#loginName').selectOption(name);
    const pw = name.split(' ').slice(1).join('').toLowerCase().replace(/[^a-z]/g, '');
    return { name, pw };
}

test('login overlay: while auth is in flight, button shows "Signing in…", no session is saved, and Back is inert', async ({ page }) => {
    // Make Firebase sign-in hang forever so we can observe the in-flight UI deterministically.
    await page.addInitScript(() => { window.__E2E = { hangSignIn: true }; });
    await page.goto('/admin.html');
    await expect(page.locator('#loginOverlay')).toBeVisible();

    const { pw } = await pickFirstMemberAndPassword(page);
    await page.locator('#loginPassword').fill(pw);
    await page.locator('#loginSubmit').click();

    // In-flight: the button is disabled with the progress label, and NO local session exists yet —
    // the whole point of the v14.75 fix is that saveSession runs only AFTER auth resolves.
    await expect(page.locator('#loginSubmit')).toHaveText('Signing in…');
    await expect(page.locator('#loginSubmit')).toBeDisabled();
    // The staged status line gives "still working" reassurance during the wait (v14.80).
    await expect(page.locator('#loginStatus')).toHaveText('Checking your sign-in…');
    const session = await page.evaluate(() => localStorage.getItem('myb_admin_session'));
    expect(session, 'no local session may be written while auth is pending').toBeNull();
    // The login-to-usable timer (markLoginStart) is set when the sign-in begins (v14.92).
    const t0 = await page.evaluate(() => sessionStorage.getItem('myb_perf_login_t0'));
    expect(Number(t0), 'login timer marker is set at sign-in start').toBeGreaterThan(0);

    // The Back link is marked inert (v14.79). Dispatching a click (bypassing the CSS pointer-events
    // guard) must hit the JS preventDefault guard, so the page does NOT navigate away mid sign-in.
    await expect(page.locator('.login-back')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('.login-back')).toHaveClass(/login-back--busy/);
    await page.locator('.login-back').dispatchEvent('click');
    await page.waitForTimeout(150);
    await expect(page, 'Back link must not navigate during an in-flight sign-in').toHaveURL(/admin\.html/);
    const stillNone = await page.evaluate(() => localStorage.getItem('myb_admin_session'));
    expect(stillNone, 'still no session after the (blocked) Back click').toBeNull();
});

test('login overlay: a failed named sign-in (B1 on) shows an error, restores the button, re-enables Back, writes no session', async ({ page }) => {
    // Enforce named sessions AND force sign-in to fail → runNamedSignIn returns ok:false.
    await enforceNamedSession(page);
    await page.addInitScript(() => { window.__E2E = { failSignIn: true }; });
    await page.goto('/admin.html');
    await expect(page.locator('#loginOverlay')).toBeVisible();

    const { pw } = await pickFirstMemberAndPassword(page);
    await page.locator('#loginPassword').fill(pw);
    await page.locator('#loginSubmit').click();

    // Failure path: an error is shown, the button returns to its idle label, and no session is saved.
    await expect(page.locator('#loginError')).toBeVisible();
    await expect(page.locator('#loginSubmit')).toHaveText('Sign in →');
    await expect(page.locator('#loginSubmit')).toBeEnabled();
    const session = await page.evaluate(() => localStorage.getItem('myb_admin_session'));
    expect(session, 'a failed enforced sign-in must not write a local session').toBeNull();

    // Back link is no longer inert once the attempt settled.
    await expect(page.locator('.login-back')).not.toHaveClass(/login-back--busy/);
    await expect(page.locator('.login-back')).not.toHaveAttribute('aria-disabled', 'true');
});

// ── PAY CALCULATOR (paycalc.html) ─────────────────────────────────────────

test('paycalc: shows the in-place login when not signed in (no redirect)', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.goto('/paycalc.html');
    // Option B: paycalc no longer redirects to admin to sign in — the shared overlay is in place.
    await expect(page).toHaveURL(/paycalc\.html/);
    await expect(page.locator('#loginOverlay')).toBeVisible();
    expect(errors, 'Uncaught JS exceptions on paycalc login').toHaveLength(0);
});

test('paycalc (signed in): pay period selector is populated', async ({ page }) => {
    const errors = collectFatalErrors(page);

    // paycalc.html requires a session (per-member pay data); seed one so the page runs its
    // own init and builds the period <select> instead of showing the in-place login.
    await seedSession(page);
    await page.goto('/paycalc.html');

    // Proof we were NOT redirected — the guard let us through.
    await expect(page).toHaveURL(/paycalc\.html$/);

    // #periodSelect is in the static HTML but its <option>s are added by JS
    // from getPeriods(). toBeAttached() retries until an <option> is present in
    // the DOM — option elements have no bounding box so toBeVisible() is
    // unreliable. Once the first option is attached all options are there
    // (the function is synchronous).
    await expect(page.locator('#periodSelect option').first()).toBeAttached();
    const count = await page.locator('#periodSelect option').count();
    expect(count, '#periodSelect should have pay period options').toBeGreaterThan(10);

    expect(errors, 'Uncaught JS exceptions on paycalc.html').toHaveLength(0);
});

// Desktop WORKSPACE layout (v16.14): Hours card beside a sticky live-estimate rail,
// with the setup/reference cards in a 2-up grid below. Rendered-viewport assertions —
// a passing maths/unit suite never catches a broken grid. The two required review
// viewports (1366×768 laptop, 1440×900) plus the pre-existing 1280 guard.
for (const { w, h } of [{ w: 1024, h: 900 }, { w: 1280, h: 1000 }, { w: 1366, h: 768 }, { w: 1440, h: 900 }]) {
    test(`paycalc desktop workspace @${w}×${h}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width: w, height: h });
        await seedSession(page);
        // Suppress the one-time notices so we measure the underlying layout.
        await page.addInitScript(() => {
            localStorage.setItem('myb_pc_pay_welcome_shown', '1');
            localStorage.setItem('myb_pc_ytd_notice_shown', '1');
            localStorage.setItem('myb_pc_ns_migrated', '1');
        });
        await page.goto('/paycalc.html');
        await expect(page.locator('#settingsCard')).toBeVisible();
        // The roster-assist hint loads asynchronously and changes the Hours card height;
        // let the layout settle so the measurement isn't a mid-render frame.
        await page.waitForTimeout(800);

        const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, 'no horizontal overflow on desktop').toBeLessThanOrEqual(1);

        // The result rail is the primary live output — on-screen at load.
        await expect(page.locator('.result-card')).toBeInViewport();

        // WORKSPACE: Hours + Settings span the two WIDE work columns (col 1–2); the result
        // RAIL is the separate col 3, to the right of them, sharing the top row with Hours.
        const zone = await page.evaluate(() => {
            const hh = document.getElementById('hoursCard').getBoundingClientRect();
            const ss = document.getElementById('settingsCard').getBoundingClientRect();
            const rr = document.querySelector('.result-card').getBoundingClientRect();
            const pp = document.getElementById('payslipCard').getBoundingClientRect();
            return {
                railRightOfHours: rr.left > hh.right - 2,
                railSameTopAsHours: Math.abs(hh.top - rr.top) < 40,
                // Settings spans the work columns → clearly wider than a single 2-up collapsible.
                settingsWide: ss.width > pp.width * 1.5,
                stickyPos: getComputedStyle(document.querySelector('.result-card')).position,
            };
        });
        expect(zone.railRightOfHours, 'result rail is its own column right of the work cards').toBe(true);
        expect(zone.railSameTopAsHours, 'rail shares the top row with Hours').toBe(true);
        expect(zone.settingsWide, 'Settings spans the wide work columns').toBe(true);
        expect(zone.stickyPos, 'the result rail is sticky').toBe('sticky');

        // REFERENCE 2-up: the four occasional cards pair across the work columns —
        // Improve-Accuracy (col 1) beside Pay-Rise-Back-Pay (col 2), same row.
        const refRow = await page.evaluate(() => {
            const p = document.getElementById('payslipCard').getBoundingClientRect();
            const b = document.getElementById('backPayCard').getBoundingClientRect();
            return { payslipLeft: p.left, backpayLeft: b.left, sameRow: Math.abs(p.top - b.top) < 40 };
        });
        expect(refRow.backpayLeft, 'Back-Pay is right of Improve-Accuracy (2-up)').toBeGreaterThan(refRow.payslipLeft);
        expect(refRow.sameRow, 'the two share a reference row').toBe(true);

        // STICKY RAIL SAFETY (the v16.14-probe overlap guard): scroll to the bottom work
        // card and assert the rail (col 3) does not HORIZONTALLY overlap any work-column
        // card — its left edge must be at or past every work card's right edge. A rail that
        // crept back into a shared column (the historical failure) would fail this
        // regardless of viewport width. Geometric, so it's robust at the tight 1024 end too.
        await page.getByText('Decimal Hours Converter').scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        const overlapPx = await page.evaluate(() => {
            const rail = document.querySelector('.result-card').getBoundingClientRect();
            const worst = ['hoursCard', 'settingsCard', 'payslipCard', 'backPayCard', 'hppCard', 'decimalConverterCard']
                .map(id => {
                    const c = document.getElementById(id).getBoundingClientRect();
                    return c.right - rail.left;   // >0 means the card extends past the rail's left edge = overlap
                });
            return Math.max(...worst);
        });
        expect(overlapPx, 'rail must not horizontally overlap any work card').toBeLessThanOrEqual(1);

        await page.screenshot({ path: testInfo.outputPath(`paycalc-${w}x${h}.png`), fullPage: true });
    });
}

// One-time notices must not stack: with legacy data pending AND the welcome notice
// unseen, only the data-ownership prompt (highest priority) should open — not both.
test('paycalc: one-time notices do not stack (data-ownership prompt wins)', async ({ page }) => {
    await seedSession(page);   // signs in as a real member (G. Miller)
    await page.addInitScript(() => {
        // Genuine unnamespaced legacy pay data → migration pending. Welcome unseen →
        // without the priority guard, both the welcome AND data-ownership lightboxes
        // would call .open() in the same startup tick.
        localStorage.setItem('myb_pc_rate', '20.74');
        localStorage.removeItem('myb_pc_pay_welcome_shown');
        localStorage.removeItem('myb_pc_ns_migrated');
    });
    await page.goto('/paycalc.html');

    await expect(page.locator('#dataOwnerLightbox.visible')).toBeVisible();
    await expect(page.locator('.lb-overlay.visible'), 'exactly one overlay open').toHaveCount(1);
    await expect(page.locator('#welcomeLightbox.visible'), 'welcome suppressed').toHaveCount(0);
});

// ── SETTINGS (settings.html) ──────────────────────────────────────────────

test('settings: login overlay renders with JS-populated grade options', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.goto('/settings.html');

    await expect(page.locator('#loginOverlay')).toBeVisible();

    const gradeCount = await page.locator('#loginGrade option').count();
    expect(gradeCount, '#loginGrade should have JS-added grade options').toBeGreaterThan(1);

    expect(errors, 'Uncaught JS exceptions on settings.html').toHaveLength(0);
});

// Regression: the settings login fields must be STYLED (full-width, like admin), not raw browser
// controls. They fell back to defaults because the field CSS lived in admin.css's generic
// `select, input {}` rule, which settings.css doesn't have — fixed by styling `.login-field`
// fields in shared.css (v14.43). A raw <select> renders at its tiny intrinsic width (~120px);
// the styled one fills the card (~280px).
test('settings login fields are styled full-width, not raw browser defaults', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/settings.html');
    await expect(page.locator('#loginOverlay')).toBeVisible();
    const w = await page.locator('#loginGrade').evaluate(el => el.getBoundingClientRect().width);
    expect(w, 'settings login GRADE select should be full-width (styled), not a raw control').toBeGreaterThan(200);
});

test('settings (signed in): card "?" button opens the Tips lightbox, not the card', async ({ page }) => {
    // Regression guard for the per-card Tips wiring. The logged-out tests above
    // never run initApp(), so a break in the signed-in path (e.g. a throw before
    // initCardCollapse wires the Work Email header) would ship unnoticed —
    // clicking "?" would then fall through to the header and toggle the card
    // collapse instead of opening the tips. This test exercises that path.
    const errors = collectFatalErrors(page);

    // Seed a valid session so the page runs initApp() instead of the login overlay.
    await seedSession(page);
    await page.goto('/settings.html');

    // Proof that initApp() → initContactCard() → initCardCollapse() ran: the
    // collapse helper sets aria-expanded on the Work Email header synchronously
    // (to "false" since the card starts collapsed). The static HTML has no
    // aria-expanded attribute, so its presence proves the signed-in init wired
    // the header — meaning the "?" handler is in place and the click below
    // cannot race the wiring. (The earlier "none" faith-radio anchor was removed
    // when the cultural calendar card was retired at v13.23.)
    await expect(page.locator('#contactToggleHeader')).toHaveAttribute('aria-expanded', 'false');

    // The Work Email card starts collapsed and the tips overlay starts hidden.
    await expect(page.locator('#tipsLightbox')).toBeHidden();
    await expect(page.locator('#contactBody')).not.toHaveClass(/\bopen\b/);

    await page.locator('.btn-card-tips[data-card="work-email"]').click();

    // The Tips lightbox must open with the right content …
    await expect(page.locator('#tipsLightbox')).toBeVisible();
    await expect(page.locator('#tipsLbTitle')).toHaveText('Work Email');
    // … and the card MUST NOT have toggled open (the reported bug symptom).
    await expect(page.locator('#contactBody')).not.toHaveClass(/\bopen\b/);

    expect(errors, 'Uncaught JS exceptions on signed-in settings.html').toHaveLength(0);
});

// ── OPERATIONS (operations.html) ──────────────────────────────────────────

test('operations: shows the in-place login when not signed in', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.goto('/operations.html');
    // No redirect any more (Option B) — the shared login overlay is injected in place.
    await expect(page).toHaveURL(/operations\.html/);
    await expect(page.locator('#loginOverlay')).toBeVisible();
    expect(errors, 'Uncaught JS exceptions triggering operations redirect').toHaveLength(0);
});

// Desktop layout contract: the wrapper-column grid (v14.35) must keep the three
// publishing cards in the narrow LEFT column and the width-hungry cards (roster +
// monitoring) in the wide RIGHT column — not auto-placed into mismatched positions.
for (const width of [1280, 1440]) {
    test(`operations desktop @${width}px: cards land in the right columns, no overflow`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await seedSession(page, 'G. Miller');   // admin — passes the operations guard
        // Suppress the one-time work-email overlay so it doesn't cover the cards.
        await page.addInitScript(() => localStorage.setItem('myb_email_check_done_G. Miller', '1'));
        await page.goto('/operations.html');
        await expect(page).toHaveURL(/operations\.html$/);   // admin was NOT redirected out
        await expect(page.locator('#huddleUploadCard')).toBeVisible();

        const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, 'no horizontal overflow on desktop').toBeLessThanOrEqual(1);

        // The two columns must not overlap horizontally: every left-column (publishing)
        // card's right edge sits left of every right-column (roster + monitoring) card's
        // left edge. Comparing the columns to EACH OTHER (not the viewport centre) is
        // robust to the centred max-width:1100 container + narrow-left/wide-right split.
        // An auto-placement regression (the v14.31 symptom) would break this separation.
        const leftIds  = ['#huddleUploadCard', '#circularUploadCard', '#newsletterUploadCard'];
        const rightIds = ['#rosterUploadCard', '#workEmailCard', '#errorLogCard', '#usageCard', '#pageSpeedCard', '#authSetupCard'];
        const boxesOf = async ids => Promise.all(ids.map(id => page.locator(id).boundingBox()));
        const leftBoxes  = await boxesOf(leftIds);
        const rightBoxes = await boxesOf(rightIds);
        const leftColumnRight = Math.max(...leftBoxes.map(b => b.x + b.width));
        const rightColumnLeft = Math.min(...rightBoxes.map(b => b.x));
        expect(leftColumnRight, 'left column must sit entirely left of the right column')
            .toBeLessThanOrEqual(rightColumnLeft + 1);
        // And the right (wide) column should genuinely be wider than the left (narrow) one.
        const rightWidth = rightBoxes[0].width, leftWidth = leftBoxes[0].width;
        expect(rightWidth, 'roster column should be wider than the publishing column').toBeGreaterThan(leftWidth);
    });
}

// App speed card (Project 0): renders its plain-language summary without throwing. Firebase is
// stubbed (getDoc → empty), so getPerfStats yields no data and the card shows the "still building
// up" empty state — proving the read + perfVerdict + render path runs end-to-end.
test('operations: App speed card renders both sections + empty-state verdict (no throw)', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => localStorage.setItem('myb_email_check_done_G. Miller', String(Date.now())));
    await page.goto('/operations.html');
    await expect(page.locator('#pageSpeedCard')).toBeVisible();
    // Two journeys: "Signing in" (login) + "Opening pages" (page-open), both empty on a stubbed read.
    await expect(page.locator('#pageSpeedContent')).toContainText('Signing in');
    await expect(page.locator('#pageSpeedContent')).toContainText('Opening pages');
    await expect(page.locator('#pageSpeedContent')).toContainText('No sign-ins recorded'); // login empty state (month-neutral copy, v16.22)
    await expect(page.locator('#pageSpeedContent')).toContainText('Not enough data yet');       // pages empty state
});

// Work Email Progress rows must not overflow the card on a narrow phone. The bug
// (v14.35): each row is a flex item inside the --added flex COLUMN, which inherited
// flex-wrap:wrap, so a long-email row sized to its content (~388px) and overflowed
// the ~291px list — the card's overflow:hidden then clipped the Remove button.
test('operations: Work Email rows keep Edit/Remove on-screen at 375px (long emails ellipsise)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 760 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => localStorage.setItem('myb_email_check_done_G. Miller', '1'));
    await page.goto('/operations.html');
    await expect(page.locator('#workEmailCard')).toBeVisible();

    // Inject a row with a deliberately long email (Firestore is stubbed empty in e2e),
    // matching operations-app.js's row markup, into the expanded card.
    const res = await page.evaluate(() => {
        const body = document.getElementById('emailStatusContent');
        const row = document.createElement('div'); row.className = 'email-added-row';
        const chip = document.createElement('span'); chip.className = 'email-count-chip email-count-chip--added';
        const nm = document.createElement('span'); nm.className = 'email-chip-name'; nm.textContent = 'C. Francisco-Charles';
        const em = document.createElement('span'); em.className = 'email-chip-email'; em.textContent = 'csherrice.francisco-charles@chilternrailways.co.uk';
        chip.append(nm, em);
        const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'email-set-btn'; edit.textContent = 'Edit';
        const rem = document.createElement('button'); rem.type = 'button'; rem.className = 'email-set-btn email-set-btn--remove'; rem.textContent = 'Remove';
        row.append(chip, edit, rem);
        const list = document.createElement('div'); list.className = 'email-count-list email-count-list--added';
        list.appendChild(row); body.innerHTML = ''; body.appendChild(list);
        document.getElementById('workEmailBody')?.classList.add('open');
        const cardRight = document.getElementById('workEmailCard').getBoundingClientRect().right;
        return {
            removeRight: rem.getBoundingClientRect().right,
            cardRight,
            emailEllipsized: em.scrollWidth > em.clientWidth,
        };
    });
    // The Remove button (rightmost element) must sit within the card, not clipped.
    expect(res.removeRight, 'Remove button must be inside the card').toBeLessThanOrEqual(res.cardRight + 1);
    expect(res.emailEllipsized, 'a long email must ellipsise, not force the row wide').toBe(true);
    const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'no horizontal overflow').toBeLessThanOrEqual(1);
});

// ── LINKS (links.html) ────────────────────────────────────────────────────

test('links: shows the in-place login when not signed in', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.goto('/links.html');
    // No redirect any more (Option B) — the shared login overlay is injected in place.
    await expect(page).toHaveURL(/links\.html/);
    await expect(page.locator('#loginOverlay')).toBeVisible();
    expect(errors, 'Uncaught JS exceptions triggering links redirect').toHaveLength(0);
});

// ── DESKTOP GEOMETRY (added v14.37) ───────────────────────────────────────
// The unit/maths suites never see layout; only a rendered viewport catches
// horizontal overflow, off-screen primary content, or CSS-grid column traps.
// These extend the existing paycalc/operations desktop checks (1280/1440px) down
// to 1024px (the desktop breakpoint edge) and out to the calendar, team view and
// signed-in admin — plus a short-height laptop case where sticky chrome and tall
// content most often misbehave. A single horizontal scrollbar is the cheapest,
// most reliable signal that a desktop layout has broken.

const DESKTOP_WIDTHS = [1024, 1280, 1440];

// CALENDAR — the most-used page, and anonymous (no session needed).
for (const width of DESKTOP_WIDTHS) {
    test(`calendar desktop @${width}px: renders, no horizontal overflow`, async ({ page }) => {
        const errors = collectFatalErrors(page);
        await page.setViewportSize({ width, height: 800 });
        await seedMember(page);
        await page.goto('/');
        await expect(page.locator('.month-year')).toBeVisible();
        await expect(page.locator('.calendar-day').first()).toBeVisible();
        const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, 'no horizontal overflow on desktop calendar').toBeLessThanOrEqual(1);
        expect(errors, 'Uncaught JS exceptions on desktop calendar').toHaveLength(0);
    });
}

// CALENDAR short height — a 1024×720 laptop. Guards against the sticky header or an
// oversized control row forcing the page wider (or producing a stray scrollbar).
test('calendar desktop @1024×720 (short height): renders, no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 720 });
    await seedMember(page);
    await page.goto('/');
    await expect(page.locator('.month-year')).toBeVisible();
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'no horizontal overflow on a short-height desktop').toBeLessThanOrEqual(1);
});

// TEAM VIEW — the wide week grid must scroll INSIDE its wrapper, never widening the
// page. A regression where .team-table-wrap loses overflow-x:auto would push the
// whole document wide; this catches that.
test('team view desktop @1280px: grid renders, table scrolls internally without page overflow', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await seedMember(page);
    await page.goto('/');
    await expect(page.locator('#teamMemberSelect option').first()).toBeAttached();
    await page.locator('#teamViewBtn').click();
    // calendar-team-view.js renders the week grid into #calendarDisplay.
    await expect(page.locator('.team-table-wrap')).toBeVisible();
    await expect(page.locator('.grade-tab').first()).toBeVisible();
    const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'team table must scroll internally, not overflow the page').toBeLessThanOrEqual(1);
    expect(errors, 'Uncaught JS exceptions in team view').toHaveLength(0);
});

// ADMIN (signed in) — the member selector and override cards must lay out without
// horizontal overflow across the desktop widths. The login-overlay tests above only
// exercise the logged-OUT page; this covers the actual admin working surface.
for (const width of DESKTOP_WIDTHS) {
    test(`admin desktop @${width}px (signed in): selector + cards reachable, no overflow`, async ({ page }) => {
        const errors = collectFatalErrors(page);
        await page.setViewportSize({ width, height: 900 });
        await seedSession(page, 'G. Miller');   // admin
        // Suppress the one-time work-email overlay so it doesn't cover the page.
        await page.addInitScript(() => localStorage.setItem('myb_email_check_done_G. Miller', '1'));
        await page.goto('/admin.html');
        // Signed in → the login overlay is never made .visible, and the admin UI shows.
        await expect(page.locator('#loginOverlay')).toBeHidden();
        await expect(page.locator('#fieldMember')).toBeVisible();
        const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, 'no horizontal overflow on desktop admin').toBeLessThanOrEqual(1);
        expect(errors, 'Uncaught JS exceptions on signed-in admin').toHaveLength(0);
    });
}

// PAY CALCULATOR short height — a 1280×720 laptop. The result card is the primary
// output; on a short viewport it sits below the fold (reached by scrolling), but the
// page itself must not overflow horizontally and the result card must still render.
test('paycalc desktop @1280×720 (short height): result card renders, no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await seedSession(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_pay_welcome_shown', '1');
        localStorage.setItem('myb_pc_ytd_notice_shown', '1');
        localStorage.setItem('myb_pc_ns_migrated', '1');
    });
    await page.goto('/paycalc.html');
    await expect(page.locator('.result-card')).toBeVisible();
    const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'no horizontal overflow on a short-height paycalc').toBeLessThanOrEqual(1);
});

// ── B1 NAMED-SESSION ENFORCEMENT (flag ON) ────────────────────────────────────
// These run with the kill-switch flipped on (roster-data.js rewritten by enforceNamedSession)
// AND sign-in forced to fail (window.__E2E.failSignIn). They prove the per-page matrix:
// admin/settings re-show the login overlay even though a valid LOCAL session was seeded;
// operations/links redirect to admin; paycalc stays soft (calculator still renders). The
// default-off behaviour is covered by every other test in this file (which never flips the flag).

/** Flip the kill-switch on and force every sign-in to fail, then seed a valid local session. */
async function armEnforcementWithFailingSignIn(page, name = 'G. Miller') {
    await enforceNamedSession(page);
    await page.addInitScript(() => { window.__E2E = { failSignIn: true }; });
    await seedSession(page, name);
}

test('B1 flag ON: admin re-shows the login overlay when the named session cannot be established', async ({ page }) => {
    await armEnforcementWithFailingSignIn(page);
    await page.goto('/admin.html');
    // A valid local session was seeded, yet the overlay must appear because the member's OWN
    // Firebase session could not be confirmed (the silent claim-less-session case B1 closes).
    await expect(page.locator('#loginOverlay')).toBeVisible();
});

test('B1 flag ON: settings re-shows the login overlay when the named session cannot be established', async ({ page }) => {
    await armEnforcementWithFailingSignIn(page);
    await page.goto('/settings.html');
    await expect(page.locator('#loginOverlay')).toBeVisible();
});

test('B1 flag ON: operations clears the session and shows the in-place login on a failed named session', async ({ page }) => {
    await armEnforcementWithFailingSignIn(page);
    await page.goto('/operations.html');
    // B1 re-auth now shows the in-place login (clears the session, no redirect to admin).
    await expect(page.locator('#loginOverlay')).toBeVisible();
});

test('B1 flag ON: links clears the session and shows the in-place login on a failed named session', async ({ page }) => {
    await armEnforcementWithFailingSignIn(page);
    await page.goto('/links.html');
    // B1 re-auth now shows the in-place login (clears the session, no redirect to admin).
    await expect(page.locator('#loginOverlay')).toBeVisible();
});

test('B1 flag ON: paycalc stays SOFT — the calculator still renders, no redirect', async ({ page }) => {
    await armEnforcementWithFailingSignIn(page);
    // Suppress the one-time notices so nothing overlays the calculator.
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_pay_welcome_shown', '1');
        localStorage.setItem('myb_pc_ytd_notice_shown', '1');
        localStorage.setItem('myb_pc_ns_migrated', '1');
    });
    await page.goto('/paycalc.html');
    await expect(page).toHaveURL(/paycalc\.html$/);                       // NOT redirected away
    await expect(page.locator('#periodSelect option').first()).toBeAttached();  // calculator works
});

// HAPPY PATH — switch ON *and* sign-in SUCCEEDS (the provisioned, enabled state). Proves that
// once accounts exist and the flag is flipped, every page behaves completely normally — nothing
// is forced to re-login or redirected. Same fixture, real flag untouched (default sign-in resolves).

test('B1 flag ON + sign-in OK: admin loads normally, no forced re-login', async ({ page }) => {
    await enforceNamedSession(page);   // switch ON; no __E2E.failSignIn → sign-in resolves → named
    await page.addInitScript(() => localStorage.setItem('myb_email_check_done_G. Miller', '1'));
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await expect(page.locator('#loginOverlay')).toBeHidden();
    await expect(page.locator('#fieldMember')).toBeVisible();
});

test('B1 flag ON + sign-in OK: operations loads (not redirected)', async ({ page }) => {
    await enforceNamedSession(page);
    await page.addInitScript(() => localStorage.setItem('myb_email_check_done_G. Miller', '1'));
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await expect(page).toHaveURL(/operations\.html$/);
    await expect(page.locator('#huddleUploadCard')).toBeVisible();
});

test('B1 flag ON + sign-in OK: links loads for a designer (not redirected)', async ({ page }) => {
    await enforceNamedSession(page);
    await seedSession(page, 'G. Miller');   // G. Miller is a links designer
    await page.goto('/links.html');
    await expect(page).toHaveURL(/links\.html$/);
});

// ── IN-PLACE SIGN-IN (INPLACE_LOGIN flag ON) — Phase 9 ─────────────────────────
// With the flag ON, the init()-wrapped coordinators (operations/links/paycalc) initialise the page
// IN PLACE after a confirmed sign-in instead of window.location.reload(). The discriminator is a
// `window.__noReload` marker set AFTER load but BEFORE the click: a reload wipes window, so if the
// marker survives the sign-in the page did NOT reload. We also assert the overlay was torn down and
// a signed-in surface rendered, and the URL never changed.

/** Drive the real login overlay: find the grade that lists `fullName`, select it, type the surname
 *  password (mirrors normaliseSurname), submit. The fixture's default sign-in resolves. */
async function signInThroughOverlay(page, fullName) {
    await expect(page.locator('#loginOverlay')).toBeVisible();
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

test('in-place sign-in: operations initialises without a reload', async ({ page }) => {
    await enableInplaceLogin(page);
    await page.goto('/operations.html');           // not signed in → overlay
    await page.evaluate(() => { window.__noReload = 1; });   // a reload would wipe this
    await signInThroughOverlay(page, 'G. Miller');  // admin → passes the operations gate

    // Overlay torn down in place, signed-in surface present, URL unchanged, and NO reload happened.
    await expect(page.locator('#loginOverlay')).toHaveCount(0);
    await expect(page.locator('#huddleUploadCard')).toBeVisible();
    await expect(page).toHaveURL(/operations\.html$/);
    expect(await page.evaluate(() => window.__noReload), 'page must not have reloaded').toBe(1);
    // The login-to-usable timer was set at sign-in and CONSUMED (cleared) once the page became usable
    // (recordPageLatency on the authed page) — proving the marker round-trip (v14.92).
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('myb_perf_login_t0')),
        'login timer marker is consumed once the page is usable').toBeNull();
});

test('in-place sign-in: links initialises without a reload', async ({ page }) => {
    await enableInplaceLogin(page);
    await page.goto('/links.html');
    await page.evaluate(() => { window.__noReload = 1; });
    await signInThroughOverlay(page, 'G. Miller');  // designer → passes the links gate

    await expect(page.locator('#loginOverlay')).toHaveCount(0);
    await expect(page.locator('body.auth-ready')).toBeVisible();   // authorised body ran in place
    await expect(page).toHaveURL(/links\.html$/);
    expect(await page.evaluate(() => window.__noReload), 'page must not have reloaded').toBe(1);
});

test('in-place sign-in: paycalc initialises (period selector built) without a reload', async ({ page }) => {
    await enableInplaceLogin(page);
    // Suppress the one-time notices so nothing overlays the calculator after sign-in.
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_pay_welcome_shown', '1');
        localStorage.setItem('myb_pc_ytd_notice_shown', '1');
        localStorage.setItem('myb_pc_ns_migrated', '1');
    });
    await page.goto('/paycalc.html');
    await page.evaluate(() => { window.__noReload = 1; });
    await signInThroughOverlay(page, 'G. Miller');

    await expect(page.locator('#loginOverlay')).toHaveCount(0);
    await expect(page.locator('#periodSelect option').first()).toBeAttached();  // calculator built in place
    await expect(page).toHaveURL(/paycalc\.html$/);
    expect(await page.evaluate(() => window.__noReload), 'page must not have reloaded').toBe(1);
});

test('in-place sign-in: admin initialises (member selector + nav identity) without a reload', async ({ page }) => {
    await enableInplaceLogin(page);
    // Mark the work-email check as recently done so its modal isn't "due" and can't cover the page.
    await page.addInitScript(() => localStorage.setItem('myb_email_check_done_G. Miller', String(Date.now())));
    await page.goto('/admin.html');
    await page.evaluate(() => { window.__noReload = 1; });
    await signInThroughOverlay(page, 'G. Miller');

    await expect(page.locator('#loginOverlay')).toHaveCount(0);
    await expect(page.locator('#fieldMember')).toBeVisible();           // admin working surface rendered
    await expect(page.locator('body.auth-ready')).toBeVisible();        // initAuthorised ran in place
    // Nav was deferred + wired with the signed-in identity (footer member badge present).
    await page.locator('#navMenuBtn').click();
    await expect(page.locator('#navPanelAvatar')).toBeVisible();
    await expect(page).toHaveURL(/admin\.html$/);
    expect(await page.evaluate(() => window.__noReload), 'page must not have reloaded').toBe(1);
});

test('in-place sign-in: settings initialises (work-email card + nav identity) without a reload', async ({ page }) => {
    await enableInplaceLogin(page);
    await page.goto('/settings.html');
    await page.evaluate(() => { window.__noReload = 1; });
    await signInThroughOverlay(page, 'G. Miller');

    await expect(page.locator('#loginOverlay')).toHaveCount(0);
    // initApp() → initContactCard() → initCardCollapse sets aria-expanded on the Work Email header.
    await expect(page.locator('#contactToggleHeader')).toHaveAttribute('aria-expanded', 'false');
    await page.locator('#navMenuBtn').click();
    await expect(page.locator('#navPanelAvatar')).toBeVisible();        // nav wired with identity
    await expect(page).toHaveURL(/settings\.html$/);
    expect(await page.evaluate(() => window.__noReload), 'page must not have reloaded').toBe(1);
});

// ── ADMIN TOUCH LAYOUT — no horizontal blowout when a pill with hours is selected ──
// Regression: on TOUCH devices (pointer: coarse) the bulk-bar time inputs' intrinsic
// min-width (~180px each, unshrinkable without min-width: 0) stretched the whole page
// to ~585px inside a ~393px viewport the moment a pill with hours (Shift/RDW/Other)
// was selected — clipping the header, member bar, and every card at the right edge.
// Desktop never showed it (the coarse-pointer stylesheet block doesn't apply), which
// is why this must assert element widths on the Pixel-5 project, not desktop.
test('admin: selecting a pill with hours causes no horizontal blowout (touch layout)', async ({ page }) => {
    // 360px = the most common Android CSS width (1080 physical ÷ 3, e.g. Samsung) — the
    // width where the second-round residue (the nowrap bulk-time-group) actually clipped.
    await page.setViewportSize({ width: 360, height: 800 });
    await seedSession(page);
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });

    // The bulk path that reproduced the blowout: tick Mon–Fri, choose Other (a pill
    // with hours — reveals the bulk time inputs), apply (reveals per-row time inputs
    // and the Other sub-controls on five rows).
    await page.locator('#bulkSelMonFri').click();
    await page.locator('#bulkTypePills .pill-other').click();
    await page.locator('#bulkApplyBtn').click();
    await page.waitForTimeout(200);

    const m = await page.evaluate(() => {
        let max = 0, worst = '';
        document.querySelectorAll('body *').forEach(el => {
            const w = el.getBoundingClientRect().width;
            if (w > max) { max = w; worst = `${el.tagName}.${String(el.className).split(' ')[0]}`; }
        });
        return { max: Math.round(max), innerW: window.innerWidth, worst };
    });
    expect(m.max, `widest element ${m.worst} at ${m.max}px vs viewport ${m.innerW}px`)
        .toBeLessThanOrEqual(m.innerW + 2);
});
