import { test, expect, enforceNamedSession, enableInplaceLogin, forcePasswordSet } from './fixtures.js';
import { collectFatalErrors, seedSession, seedMember, pickFirstMemberAndPassword, DESKTOP_WIDTHS, armEnforcementWithFailingSignIn, signInThroughOverlay } from './helpers.js';

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

// ── B1 NAMED-SESSION ENFORCEMENT (flag ON) ────────────────────────────────────
// These run with the kill-switch flipped on (roster-data.js rewritten by enforceNamedSession)
// AND sign-in forced to fail (window.__E2E.failSignIn). They prove the per-page matrix:
// admin/settings re-show the login overlay even though a valid LOCAL session was seeded;
// operations/links redirect to admin; paycalc stays soft (calculator still renders). The
// default-off behaviour is covered by every other test in this file (which never flips the flag).


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
    // initApp() → initContactCard() → initCardCollapse sets aria-expanded on the toggle CONTROL —
    // the chevron, not the header (v17.50: the header is no longer role="button"). "true" — the card
    // defaults open on this 2-card page since v16.57.
    await expect(page.locator('#contactChevron')).toHaveAttribute('aria-expanded', 'true');
    await page.locator('#navMenuBtn').click();
    await expect(page.locator('#navPanelAvatar')).toBeVisible();        // nav wired with identity
    await expect(page).toHaveURL(/settings\.html$/);
    expect(await page.evaluate(() => window.__noReload), 'page must not have reloaded').toBe(1);
});

// ── FORCED SET-PASSWORD OVERLAY (PASSWORD_PLAN.md Phase 2, v18.92) ────────────────────────────
// The compel is a HARD BLOCK, so the tests that matter most are the ones proving it cannot become a
// lockout: it must not appear unless it can actually be satisfied, and it must not appear at all when
// the kill switch is off. `forcePasswordSet` opts in — the suite default is OFF (see fixtures.js).

test('forced password overlay: blocks an un-migrated member right after sign-in', async ({ page }) => {
    await forcePasswordSet(page);
    await enableInplaceLogin(page);
    await page.goto('/settings.html');
    await signInThroughOverlay(page, 'G. Miller');
    const overlay = page.locator('#pwForceOverlay');
    await expect(overlay).toBeVisible();
    // Mandatory: none of the usual dismissal routes exist.
    await expect(page.locator('#pwForceOverlay .lb-close')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(overlay).toBeVisible();
    await page.locator('#pwForceOverlay').click({ position: { x: 4, y: 4 } });   // backdrop
    await expect(overlay).toBeVisible();
    // The escape hatch stays hidden until a failure the member can't type their way out of.
    await expect(page.locator('#pwfEscape')).toBeHidden();
});

test('forced password overlay: rejects a short or mismatched password and stays up', async ({ page }) => {
    await forcePasswordSet(page);
    await enableInplaceLogin(page);
    await page.goto('/settings.html');
    await signInThroughOverlay(page, 'G. Miller');
    await expect(page.locator('#pwForceOverlay')).toBeVisible();

    await page.locator('#pwfNew').fill('short');
    await page.locator('#pwfConfirm').fill('short');
    await page.locator('#pwfSave').click();
    await expect(page.locator('#pwfError')).toBeVisible();          // shared.css hides it without .visible
    await expect(page.locator('#pwfError')).toContainText('at least');
    await expect(page.locator('#pwForceOverlay')).toBeVisible();

    await page.locator('#pwfNew').fill('longenough1');
    await page.locator('#pwfConfirm').fill('longenough2');
    await page.locator('#pwfSave').click();
    await expect(page.locator('#pwfError')).toContainText('match');
    await expect(page.locator('#pwfError')).toBeVisible();
    await expect(page.locator('#pwForceOverlay')).toBeVisible();

    // The surname back is blocked too — otherwise "migrated ✓" would be a lie for that member.
    // 'Miller!!' is >= 8 chars AND normalises to exactly 'miller' — both conditions are needed to
    // reach the surname check (an earlier attempt used 'millermiller', which normalises to
    // 'millermiller' and is therefore a perfectly legal password).
    await page.locator('#pwfNew').fill('Miller!!');
    await page.locator('#pwfConfirm').fill('Miller!!');
    await page.locator('#pwfSave').click();
    await expect(page.locator('#pwfError')).toContainText('surname');
    await expect(page.locator('#pwfError')).toBeVisible();
});

// THE OTHER lockout guard. A mandatory overlay that fails to save is a trap unless it eventually
// offers a way out, so after repeated auth-layer failures an escape appears and genuinely closes it.
//
// The hermetic stub makes this easy to drive: `getAuth()` returns `{ currentUser: null }`, so
// setOwnPassword rejects with 'Not signed in' every time. That is also why the HAPPY path is not
// asserted here — a successful updatePassword is unreachable under the stub without making
// auth.currentUser mutable, which would change behaviour for every other spec (reconcileExpiredIdentity
// and friends all branch on it). The password RULES are unit-tested (auth-identity.test.mjs) and the
// write path is the same setOwnPassword the shipped Settings card uses.
test('forced password overlay: offers a way out after repeated save failures', async ({ page }) => {
    await forcePasswordSet(page);
    await enableInplaceLogin(page);
    await page.goto('/settings.html');
    await signInThroughOverlay(page, 'G. Miller');
    await expect(page.locator('#pwForceOverlay')).toBeVisible();

    for (let i = 0; i < 3; i++) {
        await page.locator('#pwfNew').fill('a-real-password-9');
        await page.locator('#pwfConfirm').fill('a-real-password-9');
        await page.locator('#pwfSave').click();
        await expect(page.locator('#pwfError')).toBeVisible();
    }
    const escape = page.locator('#pwfEscape');
    await expect(escape).toBeVisible();
    await escape.click();
    await expect(page.locator('#pwForceOverlay')).toBeHidden();
    await expect(page.locator('#contactCard')).toBeVisible();   // the page is usable again
});

test('forced password overlay: FAILS OPEN when the migration status cannot be read', async ({ page }) => {
    // The safety property. If getPasswordStatus fails we must NOT block — the member could not
    // complete the flow anyway, and a mandatory overlay they can't satisfy is a lockout. It simply
    // doesn't appear and tries again at their next sign-in.
    await forcePasswordSet(page);
    await enableInplaceLogin(page);
    await page.addInitScript(() => { window.__E2E = { failGetDoc: true }; });
    await page.goto('/settings.html');
    await signInThroughOverlay(page, 'G. Miller');
    await expect(page.locator('#contactCard')).toBeVisible();      // the page is usable
    await expect(page.locator('#pwForceOverlay')).toHaveCount(0);
});

test('forced password overlay: never appears while the kill switch is off', async ({ page }) => {
    // No forcePasswordSet() call → the suite default (FORCE_PASSWORD_SET: false). This is also what
    // keeps the rest of the suite unaffected by the feature.
    await enableInplaceLogin(page);
    await page.goto('/settings.html');
    await signInThroughOverlay(page, 'G. Miller');
    await expect(page.locator('#contactCard')).toBeVisible();
    await expect(page.locator('#pwForceOverlay')).toHaveCount(0);
});

// ── RESET REQUEST LINK (PASSWORD_PLAN.md — the request queue) ─────────────────────────────────
// The link is the only route a locked-out member has, and it must appear ONLY after a genuine
// credential failure — offering it up front invites a request from anyone who merely mistyped, and
// the remedy for a mistype is to try again.

test('reset request link: hidden until a credential failure, then revealed', async ({ page }) => {
    await enforceNamedSession(page);
    await page.addInitScript(() => { window.__E2E = { failSignIn: true }; });   // → auth/invalid-credential
    await page.goto('/settings.html');
    await expect(page.locator('#loginOverlay')).toBeVisible();
    await expect(page.locator('#loginResetRequest')).toBeHidden();

    await signInThroughOverlay(page, 'G. Miller');
    await expect(page.locator('#loginError')).toBeVisible();
    await expect(page.locator('#loginResetRequest')).toBeVisible();
});

test('reset request link: a network/transient failure does NOT offer a reset', async ({ page }) => {
    // A reset fixes a forgotten password, not a dropped connection — sending the admin a request for
    // one would waste their time and mislead the member about what is wrong.
    await enforceNamedSession(page);
    await page.addInitScript(() => { window.__E2E = { hangSignIn: true }; });   // → timeout, not credential
    await page.goto('/settings.html');
    await signInThroughOverlay(page, 'G. Miller');
    await expect(page.locator('#loginError')).toBeVisible();
    await expect(page.locator('#loginResetRequest')).toBeHidden();
});

test('reset request link: sending replaces the control with a confirmation', async ({ page }) => {
    await enforceNamedSession(page);
    await page.addInitScript(() => { window.__E2E = { failSignIn: true }; });
    // Stub the public endpoint — it is a real cross-origin POST with no auth token.
    await page.route('**/requestPasswordReset', route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
    await page.goto('/settings.html');
    await signInThroughOverlay(page, 'G. Miller');
    await page.locator('#loginResetRequest').click();
    await expect(page.locator('#loginResetStatus')).toContainText('Request sent');
    // No re-tappable button left: the request is recorded and there is nothing more to do here.
    await expect(page.locator('#loginResetRequest')).toBeHidden();
});

test('reset request link: a failed send keeps the button and says so', async ({ page }) => {
    await enforceNamedSession(page);
    await page.addInitScript(() => { window.__E2E = { failSignIn: true }; });
    await page.route('**/requestPasswordReset', route => route.abort());
    await page.goto('/settings.html');
    await signInThroughOverlay(page, 'G. Miller');
    await page.locator('#loginResetRequest').click();
    await expect(page.locator('#loginResetStatus')).toContainText('contact the admin directly');
    await expect(page.locator('#loginResetRequest')).toBeVisible();
    await expect(page.locator('#loginResetRequest')).toBeEnabled();
});
