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
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await expect(page.locator('#loginOverlay')).toBeHidden();
    await expect(page.locator('#fieldMember')).toBeVisible();
});

test('B1 flag ON + sign-in OK: operations loads (not redirected)', async ({ page }) => {
    await enforceNamedSession(page);
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
// ALWAYS ON SCREEN since v20.48. It was revealed only after two credential failures, on the
// reasoning that the remedy for a mistype is to try again — true, but it made the member who KNOWS
// they have forgotten fail twice on purpose before the app would tell them how to ask. The gate is
// gone; what survives is the part that was right, now expressed as EMPHASIS rather than existence:
// two credential failures raise the link's weight, and a network/rate-limit failure never does,
// because a dropped connection is not a forgotten password.

test('reset request link: present from the moment the card opens, before any attempt', async ({ page }) => {
    await enforceNamedSession(page);
    await page.goto('/settings.html');
    await expect(page.locator('#loginOverlay')).toBeVisible();
    const btn = page.locator('#loginResetRequest');
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    // Below the primary action — the place a reader looks for it, and what lets it be permanent
    // without competing with Sign in.
    const link = await btn.boundingBox();
    const submit = await page.locator('#loginSubmit').boundingBox();
    expect(link.y, 'the reset link must sit BELOW the Sign in button').toBeGreaterThan(submit.y);
    // Quiet until there is a reason: the emphasis class is the whole difference from the old reveal.
    await expect(btn).not.toHaveClass(/login-reset-request--prompted/);
});

test('reset request link: two credential failures EMPHASISE it (it never appears or moves)', async ({ page }) => {
    await enforceNamedSession(page);
    await page.addInitScript(() => { window.__E2E = { failSignIn: true }; });   // → auth/invalid-credential
    await page.goto('/settings.html');
    const btn = page.locator('#loginResetRequest');

    await signInThroughOverlay(page, 'G. Miller');
    await expect(page.locator('#loginError')).toBeVisible();
    // Failure #1 IS the mistype case — still no emphasis, and still there.
    await expect(btn).toBeVisible();
    await expect(btn).not.toHaveClass(/login-reset-request--prompted/);
    // Baseline taken HERE, not before the first attempt: the error message appearing above the link
    // legitimately pushes it down the card. The claim under test is narrower — that the EMPHASIS
    // moves nothing — so the two measurements must differ only in the emphasis.
    const before = await btn.boundingBox();

    await page.locator('#loginPassword').fill('wrongagain');
    await page.locator('#loginSubmit').click();
    await expect(btn).toHaveClass(/login-reset-request--prompted/);
    // A control that relocates at the moment of frustration is harder to use, not easier.
    const after = await btn.boundingBox();
    expect(after.y, 'the link must not move when it is emphasised').toBeCloseTo(before.y, 0);
});

test('reset request link: a network/transient failure does NOT push the reset route', async ({ page }) => {
    // A reset fixes a forgotten password, not a dropped connection — pointing at one would waste the
    // admin's time and mislead the member about what is actually wrong. The link stays available
    // (it always is); what it must not do is present itself as the answer to this failure.
    await enforceNamedSession(page);
    await page.addInitScript(() => { window.__E2E = { hangSignIn: true }; });   // → timeout, not credential
    await page.goto('/settings.html');
    await signInThroughOverlay(page, 'G. Miller');
    await expect(page.locator('#loginError')).toBeVisible();
    await expect(page.locator('#loginResetRequest')).not.toHaveClass(/login-reset-request--prompted/);
});

test('reset request link: with no name chosen it asks for one rather than filing nothing', async ({ page }) => {
    // The click-time read of the dropdown is what makes an always-on link correct; this is its guard.
    await enforceNamedSession(page);
    /** @type {any[]} */
    const posted = [];
    await page.route('**/requestPasswordReset', route => {
        posted.push(JSON.parse(route.request().postData() || '{}'));
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });
    await page.goto('/settings.html');
    await page.locator('#loginResetRequest').click();
    await expect(page.locator('#loginResetStatus')).toContainText('Choose your name');
    expect(posted, 'nothing may be filed without a member').toEqual([]);
});

test('reset request link: files for the member currently named in the card', async ({ page }) => {
    // THE correctness property, and the one the v18.94 fix was about. Then, the link was REVEALED by
    // one member's failure but read the dropdown at click time, so failing as A, switching to B and
    // tapping filed for B — who never asked, and acting on it reset THEM. Now the link is tied to no
    // failure at all: it means "I am the person named above", so the dropdown IS the referent. The
    // property to hold is that switching identity cannot leave the previous member's state behind.
    await enforceNamedSession(page);
    await page.addInitScript(() => { window.__E2E = { failSignIn: true }; });
    /** @type {any[]} */
    const posted = [];
    await page.route('**/requestPasswordReset', route => {
        posted.push(JSON.parse(route.request().postData() || '{}'));
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });
    await page.goto('/settings.html');
    await failTwice(page, 'G. Miller');
    await expect(page.locator('#loginResetRequest')).toHaveClass(/login-reset-request--prompted/);

    // Switching member must drop the previous member's emphasis — otherwise the new one arrives at a
    // card that looks like THEY have already failed twice.
    await page.locator('#loginName').selectOption('L. Springer');
    await expect(page.locator('#loginResetRequest')).toBeVisible();
    await expect(page.locator('#loginResetRequest')).not.toHaveClass(/login-reset-request--prompted/);

    await page.locator('#loginResetRequest').click();
    await expect(page.locator('#loginResetStatus')).toContainText('Request sent');
    expect(posted).toEqual([{ member: 'L. Springer' }]);
});

test('reset request link: a sent request does not follow the next member', async ({ page }) => {
    // "Request sent" under a different name would tell someone their request is filed when it is not.
    await enforceNamedSession(page);
    await page.route('**/requestPasswordReset', route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
    await page.goto('/settings.html');
    await signInThroughOverlay(page, 'G. Miller', { submit: false });
    await page.locator('#loginResetRequest').click();
    await expect(page.locator('#loginResetStatus')).toContainText('Request sent');
    await expect(page.locator('#loginResetRequest')).toBeHidden();   // nothing more to do here

    await page.locator('#loginName').selectOption('L. Springer');
    const btn = page.locator('#loginResetRequest');
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    await expect(btn).toContainText('Ask the admin');               // not a dead "Sending…"
    await expect(page.locator('#loginResetStatus')).toBeEmpty();
});

test('reset request link: a failed send keeps the button and says so', async ({ page }) => {
    await enforceNamedSession(page);
    await page.route('**/requestPasswordReset', route => route.abort());
    await page.goto('/settings.html');
    await signInThroughOverlay(page, 'G. Miller', { submit: false });
    await page.locator('#loginResetRequest').click();
    await expect(page.locator('#loginResetStatus')).toContainText('contact the admin directly');
    await expect(page.locator('#loginResetRequest')).toBeVisible();
    await expect(page.locator('#loginResetRequest')).toBeEnabled();
    await expect(page.locator('#loginResetRequest')).toContainText('Ask the admin');
});

/** Fail sign-in twice for `name`, so the reset-request link is emphasised. */
async function failTwice(page, name) {
    await signInThroughOverlay(page, name);
    await expect(page.locator('#loginError')).toBeVisible();
    await page.locator('#loginPassword').fill('wrongagain');
    await page.locator('#loginSubmit').click();
    await expect(page.locator('#loginResetRequest')).toHaveClass(/login-reset-request--prompted/);
}

// ── The login overlay must look the SAME on every page (v18.95) ────────────────────────────
// login-overlay.js injects one card and shared.css styles it, so all five protected pages should
// render an identical sign-in. Nothing asserted that, and it broke immediately: a page-local
// `.login-pw-wrap { margin-bottom }` added for the Settings Password card also matched the login
// overlay's OWN password wrapper (same class, injected on every page), so settings.html's sign-in
// card silently grew 14px taller than the other five. Page CSS files are loaded per page, so this
// class of leak is invisible to any single-page test.
test('login overlay geometry is identical across every page that shows it', async ({ page }) => {
    const PAGES = ['/admin.html', '/settings.html', '/operations.html', '/links.html', '/paycalc.html'];
    /** Measure the parts a page stylesheet could plausibly reach into. */
    const measure = async (/** @type {string} */ url) => {
        await page.goto(url);
        await page.locator('#loginOverlay.visible').waitFor();
        return page.evaluate(() => {
            const pick = (/** @type {string} */ sel) => {
                const el = document.querySelector('#loginOverlay ' + sel);
                if (!el) return null;
                const cs = getComputedStyle(el);
                const r = el.getBoundingClientRect();
                return { w: Math.round(r.width), h: Math.round(r.height),
                         mb: cs.marginBottom, mt: cs.marginTop, pad: cs.padding };
            };
            return {
                card:    pick('#loginCard'),
                pwWrap:  pick('.login-pw-wrap'),
                pwInput: pick('#loginPassword'),
                submit:  pick('#loginSubmit'),
            };
        });
    };

    await page.setViewportSize({ width: 390, height: 900 });
    const baseline = await measure(PAGES[0]);
    expect(baseline.card, 'the login card should render on admin.html').toBeTruthy();
    for (const url of PAGES.slice(1)) {
        expect(await measure(url), `login overlay on ${url} differs from ${PAGES[0]}`).toEqual(baseline);
    }
});

// ── The INDETERMINATE password write (v18.97, external review) ─────────────────────────────────
// The defect: Promise.race stops WAITING but does not CANCEL, so a slow updatePassword could land a
// second after the overlay had said "Couldn't connect". The member then believes their old password
// still works — during a COMPULSORY migration, which is a lockout. The unit tests cover
// settleOrTimeout's shape; these cover what the member actually SEES, which is where the v18.92
// escape-hatch bug hid (a CSS rule made it visible from the start, invisible to code reading).
//
// SAVE_TIMEOUT_MS is 8s, so these deliberately wait it out rather than mock the clock — the point is
// the real path.
test('forced overlay: a write that outlives its deadline is reported as UNCONFIRMED, not failed', async ({ page }) => {
    test.setTimeout(45_000);
    await forcePasswordSet(page);
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true, hangPasswordWrite: true }; });
    await page.goto('/settings.html');
    await signInThroughOverlay(page, 'G. Miller');
    await page.locator('#pwForceOverlay.visible').waitFor({ timeout: 8000 });

    await page.locator('#pwfNew').fill('a-real-password-1');
    await page.locator('#pwfConfirm').fill('a-real-password-1');
    await page.locator('#pwfSave').click();

    const err = page.locator('#pwfError');
    await expect(err).toContainText('couldn’t confirm', { timeout: 15_000 });
    // The exact instruction that makes this safe under BOTH outcomes.
    await expect(err).toContainText('Keep the password you just entered');
    await expect(err).toBeVisible();
    // It must NOT claim failure — that is the whole defect.
    await expect(err).not.toContainText('Couldn’t connect');
    // No racing second write: a retry would re-authenticate with a password the late write may have
    // already replaced.
    await expect(page.locator('#pwfSave')).toBeDisabled();
    await expect(page.locator('#pwfSave')).toHaveText('Still saving…');
    // And a compulsory overlay must never hold someone on an outcome nobody can resolve.
    await expect(page.locator('#pwfEscape')).toBeVisible();
});

test('forced overlay: a LATE SUCCESS finishes the flow instead of stranding the member', async ({ page }) => {
    test.setTimeout(45_000);
    await forcePasswordSet(page);
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true, hangPasswordWrite: true }; });
    await page.goto('/settings.html');
    await signInThroughOverlay(page, 'G. Miller');
    await page.locator('#pwForceOverlay.visible').waitFor({ timeout: 8000 });

    await page.locator('#pwfNew').fill('a-real-password-1');
    await page.locator('#pwfConfirm').fill('a-real-password-1');
    await page.locator('#pwfSave').click();
    await expect(page.locator('#pwfError')).toContainText('couldn’t confirm', { timeout: 15_000 });

    // The write lands after all. The overlay must close — the compel IS satisfied — rather than
    // leaving a member staring at an unresolved state for a password that now works.
    await page.evaluate(() => window.__E2E_releasePasswordWrite(true));
    await expect(page.locator('#pwForceOverlay')).toBeHidden({ timeout: 10_000 });
});

test('forced overlay: a LATE FAILURE re-enables retry with the real error', async ({ page }) => {
    test.setTimeout(45_000);
    await forcePasswordSet(page);
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true, hangPasswordWrite: true }; });
    await page.goto('/settings.html');
    await signInThroughOverlay(page, 'G. Miller');
    await page.locator('#pwForceOverlay.visible').waitFor({ timeout: 8000 });

    await page.locator('#pwfNew').fill('a-real-password-1');
    await page.locator('#pwfConfirm').fill('a-real-password-1');
    await page.locator('#pwfSave').click();
    await expect(page.locator('#pwfError')).toContainText('couldn’t confirm', { timeout: 15_000 });

    // It genuinely failed. NOW a retry is safe, so the button must come back.
    await page.evaluate(() => window.__E2E_releasePasswordWrite(false));
    await expect(page.locator('#pwfError')).toContainText('wasn’t updated', { timeout: 10_000 });
    await expect(page.locator('#pwfSave')).toBeEnabled();
    await expect(page.locator('#pwfSave')).toHaveText('Set password →');
});
