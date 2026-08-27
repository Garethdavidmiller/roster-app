/**
 * calendar-pin.spec.js — the staff Calendar PIN, in a real browser.
 *
 * The unit tests own the RULES; this owns the things only a browser can answer. Three of them
 * genuinely cannot be checked anywhere else:
 *
 *   · **that no roster data is in the DOM while locked.** Every unit test can prove a function
 *     returned nothing; only a rendered page can prove the member dropdown is empty, the grid is
 *     empty and no shift text exists anywhere on it.
 *   · **that the splash comes down on the locked path.** The dismissal moved out of the deferred
 *     workspace precisely so a locked visitor is not left staring at a loading screen, and nothing
 *     short of a real page load exercises that ordering.
 *   · **that a viewer is still refused by the protected pages.** The policy is unit-tested; whether
 *     the pages actually consult it on a viewer session is a wiring question.
 */
import { test, expect } from './fixtures.js';
import { seedMember, seedMemberSession, seedSession, seedSessionOnce, stubPinExchange, enterPin, collectFatalErrors, seedViewerAccess, clearNoticeFlags } from './helpers.js';
import { disableCalendarPin, enableCalendarPin } from './fixtures.js';

// The shipped default is OFF while the feature is deployed dark (v20.17), so every test here that
// exercises the unlock card turns it on explicitly. That is the right way round: these describe the
// configuration the feature is FOR, and the flag's current value is a deployment decision rather
// than a product one — the suite should not quietly stop testing the card the day it ships dark.
// The four "switched OFF" tests below call disableCalendarPin, which writes the same map key, so
// the later call simply wins.
test.beforeEach(async ({ page }) => { await enableCalendarPin(page); });

// ── Locked ──────────────────────────────────────────────────────────────────────────────────────

test('a fresh browser gets the unlock card, and NO roster data', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedMember(page);              // a member was chosen on this machine before — still locked
    await page.goto('/index.html');

    await expect(page.locator('#calendarLock')).toBeVisible();
    await expect(page.locator('#calLockPin')).toBeVisible();

    // THE ASSERTION THIS FILE EXISTS FOR. Not "hidden" — ABSENT. The workspace is never built while
    // locked, so the grid has no children and the member dropdown has no options. A design that
    // rendered the Calendar and covered it would pass a visibility check and fail these.
    await expect(page.locator('#calendarDisplay')).toBeHidden();
    expect(await page.locator('#calendarDisplay').innerHTML()).toBe('');
    expect(await page.locator('#teamMemberSelect option').count()).toBe(0);
    await expect(page.locator('#calendarControls')).toBeHidden();
    await expect(page.locator('#calendarLegend')).toBeHidden();
    // No calendar cell anywhere in the document — the belt to the braces above. Asserted as a
    // COUNT of the elements the renderer creates, not as page text: the colour legend is static
    // markup in index.html, so a text search for "Rest" matches a page with no roster on it at all.
    expect(await page.locator('.day-cell, .calendar-day, .calendar-grid').count()).toBe(0);
    expect(errors).toEqual([]);
});

test('the splash comes down on the LOCKED path — no infinite loading screen', async ({ page }) => {
    await page.goto('/index.html');
    // The dismissal used to sit after the first render. Locked, that render never happens.
    await expect(page.locator('#splash')).toBeHidden({ timeout: 5000 });
    await expect(page.locator('#calLockPin')).toBeVisible();
});

test('the nav drawer and the guides stay reachable while locked', async ({ page }) => {
    // Locking the building to reach the noticeboard would be absurd: the guides, the Huddle and the
    // documents are deliberately outside the gate.
    await page.goto('/index.html');
    await expect(page.locator('#calLockPin')).toBeVisible();
    await page.locator('#navMenuBtn').click();
    await expect(page.locator('#navPanel')).toBeVisible();
    await expect(page.locator('#navPanel')).toContainText('Railcard');
});

test('a public guide loads with no PIN and no member sign-in', async ({ page }) => {
    await page.goto('/railcard-guide.html');
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('#calendarLock')).toHaveCount(0);
});

// ── Unlocking ───────────────────────────────────────────────────────────────────────────────────

test('the correct PIN unlocks the Calendar and the roster appears', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedMember(page);
    await stubPinExchange(page);
    await page.goto('/index.html');

    await expect(page.locator('#calLockPin')).toBeVisible();
    await enterPin(page, '1234');

    await expect(page.locator('#calendarLock')).toHaveCount(0);
    await expect(page.locator('#calendarDisplay')).toBeVisible();
    await expect(page.locator('#calendarControls')).toBeVisible();
    // The workspace really was BUILT, not merely revealed: the member dropdown is populated by
    // `populateTeamMemberDropdown`, which only runs inside the deferred start.
    expect(await page.locator('#teamMemberSelect option').count()).toBeGreaterThan(0);
    await expect(page.locator('.calendar-header')).toBeVisible();
    expect(errors).toEqual([]);
});

test('the submit button stays disabled until four digits are entered', async ({ page }) => {
    await page.goto('/index.html');
    const submit = page.locator('#calLockSubmit');
    await expect(submit).toBeDisabled();
    await page.locator('#calLockPin').fill('12');
    await expect(submit).toBeDisabled();
    await page.locator('#calLockPin').fill('1234');
    await expect(submit).toBeEnabled();
});

test('non-digits are stripped as they are typed', async ({ page }) => {
    // Typed, not `fill()`ed. `maxlength="4"` truncates a bulk fill to `1a2b` BEFORE the input
    // handler sees it, so a fill-based assertion would be testing maxlength and calling it the
    // digit filter. Typing is also what a member actually does.
    await page.goto('/index.html');
    await page.locator('#calLockPin').pressSequentially('1a2b3c4d');
    await expect(page.locator('#calLockPin')).toHaveValue('1234');
});

// ── Failure ─────────────────────────────────────────────────────────────────────────────────────

test('a WRONG PIN shows no roster data and keeps the card', async ({ page }) => {
    await seedMember(page);
    await stubPinExchange(page, { status: 401 });
    await page.goto('/index.html');
    await enterPin(page, '0000');

    await expect(page.locator('#calLockMsg')).toContainText(/not recognised/i);
    await expect(page.locator('#calendarLock')).toBeVisible();
    await expect(page.locator('#calendarDisplay')).toBeHidden();
    expect(await page.locator('#calendarDisplay').innerHTML()).toBe('');
    // The field is cleared on every attempt — a PIN left in a form field on a shared PC is readable
    // by whoever sits down next.
    await expect(page.locator('#calLockPin')).toHaveValue('');
});

test('a throttled attempt says something different from a wrong PIN', async ({ page }) => {
    await stubPinExchange(page, { status: 429 });
    await page.goto('/index.html');
    await enterPin(page, '1234');
    await expect(page.locator('#calLockMsg')).toContainText(/too many attempts/i);
    await expect(page.locator('#calLockMsg')).not.toContainText(/not recognised/i);
});

test('a transport failure is recoverable — the same card retries and succeeds', async ({ page }) => {
    await seedMember(page);
    await stubPinExchange(page, { abort: true });
    await page.goto('/index.html');
    await enterPin(page, '1234');
    await expect(page.locator('#calLockMsg')).toContainText(/connection/i);

    await page.unroute('**/unlockCalendarViewer');
    await stubPinExchange(page);
    await enterPin(page, '1234');
    await expect(page.locator('#calendarDisplay')).toBeVisible();
});

test('showing the card WARMS the exchange function while the member types', async ({ page }) => {
    // A cold start is the largest single number in the unlock chain, and the seconds spent typing
    // are exactly the seconds it takes — so the card fires one fire-and-forget GET on display
    // (v20.45). Asserted as a REQUEST, not a response: the warm-up ignores its answer by design.
    const warm = page.waitForRequest(r =>
        r.url().includes('unlockCalendarViewer') && r.method() === 'GET', { timeout: 5000 });
    await page.goto('/index.html');
    await expect(page.locator('#calLockPin')).toBeVisible();
    await warm;
});

test('access lost mid-session: re-lock says why, the SAME PIN card re-unlocks, and the grid repaints', async ({ page }) => {
    // The PIN-rotation path, end to end — the ordinary one, not a corner: rotating the PIN revokes
    // the viewer's tokens, so every open viewer hits this on its next read. Three prior defects live
    // on this exact path (the one-shot gate v20.41, the claimed months v20.41, the missing repaint
    // v20.45), and no e2e walked it until now — each was found by reading, which is the wrong way
    // round for the path every rotation exercises.
    await seedMember(page);
    await stubPinExchange(page);
    await page.goto('/index.html');
    await enterPin(page, '1234');
    await expect(page.locator('.calendar-day').first()).toBeVisible();

    // Every FRESH read now comes back permission-denied — what revoked tokens look like. The boot
    // window is already claimed, so navigate beyond it to force one.
    await page.evaluate(() => { (window.__E2E = window.__E2E || {}).failGetDocs = 'permission-denied'; });
    await page.locator('#nextMonth').click();
    await page.locator('#nextMonth').click();

    // Re-locked, and it says WHY — an expired session is not a network blip, and the generic
    // "couldn't update, tap to retry" here would be a loop the member cannot win.
    await expect(page.locator('#calendarLock')).toBeVisible();
    await expect(page.locator('#calLockMsg')).toContainText(/expired/i);
    await expect(page.locator('#calendarDisplay')).toBeHidden();

    // The new PIN works — and the grid comes back WITHOUT any further navigation. The workspace is
    // un-hidden exactly as the re-lock left it and nothing else asks for a render, so before the
    // v20.45 repaint this showed the pre-lock grid frozen until the member happened to swipe.
    await page.evaluate(() => { window.__E2E.failGetDocs = false; });
    await enterPin(page, '1234');
    await expect(page.locator('#calendarDisplay')).toBeVisible();
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await expect(page.locator('#calendarLock')).toHaveCount(0);
});

test('a token WITHOUT the viewer claim leaves the Calendar locked', async ({ page }) => {
    // The quietest failure there is: sign-in succeeds, so a naive implementation renders a Calendar
    // whose every read is then denied — unlocked-looking and empty, with no error anywhere.
    await page.addInitScript(() => { window.__E2E = Object.assign(window.__E2E || {}, { viewerClaimMissing: true }); });
    await stubPinExchange(page);
    await page.goto('/index.html');
    await enterPin(page, '1234');
    await expect(page.locator('#calendarLock')).toBeVisible();
    await expect(page.locator('#calendarDisplay')).toBeHidden();
});

// ── Session lifetime ────────────────────────────────────────────────────────────────────────────

test('a reload within the same browser session stays unlocked', async ({ page }) => {
    await seedMember(page);
    await stubPinExchange(page);
    await page.goto('/index.html');
    await enterPin(page, '1234');
    await expect(page.locator('#calendarDisplay')).toBeVisible();

    await page.reload();
    await expect(page.locator('#calendarDisplay')).toBeVisible();
    await expect(page.locator('#calendarLock')).toHaveCount(0);
});

test('when the browser SESSION ends, the PIN is required again', async ({ page }) => {
    // What "session-only persistence" means, at browser level: the viewer identity lives exactly as
    // long as the browser session and no longer. A PC left signed into a Windows account must not
    // carry the roster into the next person's day.
    //
    // Modelled by clearing sessionStorage and reloading rather than by opening a second context.
    // A fresh context would not carry this suite's Firebase stub route, so the page would fail to
    // load its module graph and show no card — passing for a reason that has nothing to do with
    // persistence. Clearing the session store is the same event the real Firebase SDK observes.
    await seedMember(page);
    await stubPinExchange(page);
    await page.goto('/index.html');
    await enterPin(page, '1234');
    await expect(page.locator('#calendarDisplay')).toBeVisible();

    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await expect(page.locator('#calLockPin')).toBeVisible();
    await expect(page.locator('#calendarDisplay')).toBeHidden();
    expect(await page.locator('#calendarDisplay').innerHTML()).toBe('');
});

// ── A member is not interrupted ─────────────────────────────────────────────────────────────────

test('a signed-in member never sees the PIN card', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/index.html');
    await expect(page.locator('#calendarDisplay')).toBeVisible();
    await expect(page.locator('#calendarLock')).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('a member does not even FLASH the PIN card', async ({ page }) => {
    // The workspace is hidden synchronously and the decision is asynchronous, so the risk is the
    // other way round: the lock card appearing for a frame before the decision lands. Sampling from
    // the very first paint is the only way to see it.
    await seedMemberSession(page, 'G. Miller');
    await page.addInitScript(() => {
        window.__sawLock = false;
        const check = () => {
            if (document.getElementById('calendarLock')) window.__sawLock = true;
            requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
    });
    await page.goto('/index.html');
    await expect(page.locator('#calendarDisplay')).toBeVisible();
    expect(await page.evaluate(() => window.__sawLock)).toBe(false);
});

// ── A member is never sent to the PIN (v20.79) ──────────────────────────────────────────────────
//
// The reported symptom was "the PIN occasionally comes up for people who are already signed in", and
// it is TWO faults sharing one screen. `decideAccess` needs a local session AND a restored Firebase
// identity; a member can be missing the second for two quite different reasons:
//
//   · the restore is merely SLOW and lands after `resolveAccess`'s bound (rare, and it was a cliff —
//     the decision was made once and never revisited, so a reload was the only way out); or
//   · the identity is GONE — iOS evicts IndexedDB after ~7 days of not opening the PWA, while the
//     local session runs for 60 days. That one is not a race at all: it fails every single load.
//
// Neither was reachable by a test until `authRestoreDelayMs` existed, because the Firebase stub
// handed every caller a user synchronously — no restore budget in the app had ever been exercised.

test('a member whose identity restores LATE is let in, and is never asked for a PIN', async ({ page }) => {
    // 15s is past every bound on the path (the 6.5s reconcile race, then the 6s first-emission
    // budget), so the boot decision genuinely resolves `none` with a valid member session held.
    // Before v20.79 that was terminal for the page load.
    test.setTimeout(60_000);
    await seedSession(page, 'G. Miller');
    await seedMember(page, 'G. Miller');
    await page.addInitScript(() => {
        window.__E2E = Object.assign(window.__E2E || {}, { authUser: true, authRestoreDelayMs: 15_000 });
    });
    await page.goto('/index.html');

    await expect(page.locator('#calendarDisplay')).toBeVisible({ timeout: 30_000 });
    // The PIN field never existed. Not "was dismissed" — a member must never be shown a shared code
    // as the way back into their own roster.
    await expect(page.locator('#calLockPin')).toHaveCount(0);
});

test('an EVICTED identity signs the member back in silently, with no PIN card', async ({ page }) => {
    // The deterministic case: session intact, Firebase identity gone. For anyone still on the surname
    // default `ensureNamedSession` re-establishes it with nothing typed, which is what makes this
    // recoverable without asking them for anything at all.
    await seedSession(page, 'G. Miller');
    await seedMember(page, 'G. Miller');
    await page.addInitScript(() => {
        window.__E2E = Object.assign(window.__E2E || {}, { signInEstablishes: true });
    });
    await page.goto('/index.html');

    await expect(page.locator('#calendarDisplay')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#calLockPin')).toHaveCount(0);
});

test('a MIGRATED member whose identity is gone is offered sign-in, with the PIN behind a link', async ({ page }) => {
    // The silent route only tries the surname, so a member who has chosen their own password cannot
    // be recovered without them. They get their OWN sign-in — not a shared code — and the PIN stays
    // reachable underneath, because a session left behind on a shared PC is a real situation.
    await seedSession(page, 'G. Miller');
    await seedMember(page, 'G. Miller');
    await page.addInitScript(() => { window.__E2E = Object.assign(window.__E2E || {}, { failSignIn: true }); });
    await page.goto('/index.html');

    await expect(page.locator('#calendarLock')).toBeVisible();
    await expect(page.locator('#calLockWho')).toContainText('G. Miller');
    await expect(page.locator('#calLockPin')).toHaveCount(0);
    const signIn = page.locator('#calLockSubmit');
    await expect(signIn).toBeEnabled({ timeout: 20_000 });
    await expect(signIn).toHaveText(/sign in/i);

    // The real overlay, not a second sign-in written for this card.
    await signIn.click();
    await expect(page.locator('#loginOverlay')).toBeVisible();
});

test('the member card falls back to the staff PIN by SIGNING OUT first', async ({ page }) => {
    // ── WHAT THIS PINS, AND WHY IT CHANGED AT v21.23 ────────────────────────────────────────────
    //
    // "Use the staff PIN instead" used to swap one card for another and leave everything else
    // alone. But `calendar-app.js` builds the nav drawer at module scope from the local session,
    // before access is decided — so the next person at a shared PC unlocked with the staff PIN onto
    // a Calendar whose drawer still named the previous member and still showed the page pills their
    // permissions earned. It now clears the session and reloads.
    //
    // The seed is ONE-SHOT (`seedSessionOnce`) because the ordinary `seedSession` re-runs on every
    // navigation, so it wrote the session back after the reload and this test failed against
    // behaviour that was working. That is what it did for four releases — see the helper's header.
    await seedSessionOnce(page, 'G. Miller');
    await seedMember(page, 'G. Miller');
    await page.addInitScript(() => { window.__E2E = Object.assign(window.__E2E || {}, { failSignIn: true }); });
    await stubPinExchange(page);
    await page.goto('/index.html');

    await expect(page.locator('#calLockPinInstead')).toBeVisible();
    await page.locator('#calLockPinInstead').click();

    // The PIN card arrives via a RELOAD, not a repaint — so the wait is for the reloaded page.
    await expect(page.locator('#calLockPin')).toBeVisible({ timeout: 20_000 });

    // THE PRIVACY PROPERTY, which the old test did not check at all: the previous member's identity
    // is gone, not merely covered over. Asserted on the stored session rather than the pixels,
    // because every consumer — the drawer's name, its Sign out button, its permission pills — is
    // seeded from this one value at module scope.
    assert_cleared: {
        const stored = await page.evaluate(() => localStorage.getItem('myb_admin_session'));
        expect(stored, 'the previous member\'s session survived the switch to the staff PIN').toBeNull();
    }
    await expect(page.locator('#calLockWho')).toHaveCount(0);

    await enterPin(page, '1234');
    await expect(page.locator('#calendarDisplay')).toBeVisible();
});

// ── The page says something while it decides (v20.80) ───────────────────────────────────────────

test('a slow decision shows a SKELETON, not a blank page — and no roster data in it', async ({ page }) => {
    // What only a browser can answer: that the splash really has gone by then, and that the thing
    // standing in its place is on screen rather than merely in the DOM. The unit test owns the
    // timing rules; this owns "is the member looking at something".
    await seedMember(page);
    await page.addInitScript(() => {
        window.__E2E = Object.assign(window.__E2E || {}, { authRestoreDelayMs: 4000 });
    });
    await page.goto('/index.html');

    await expect(page.locator('#calendarBooting')).toBeVisible({ timeout: 6000 });
    // The splash is already down — which is the whole reason this is needed.
    await expect(page.locator('#splash')).toBeHidden();
    // Still no roster. The skeleton is drawn before anyone knows this browser may see one.
    expect(await page.locator('.day-cell, .calendar-day, .calendar-grid').count()).toBe(0);
    await expect(page.locator('#calendarDisplay')).toBeHidden();

    // And it goes when the decision lands.
    await expect(page.locator('#calLockPin')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#calendarBooting')).toHaveCount(0);
});

test('a normal boot never shows the skeleton at all', async ({ page }) => {
    // The cost side. A member whose Calendar opens promptly must not see scenery flash first.
    await seedMemberSession(page, 'G. Miller');
    await page.addInitScript(() => {
        window.__sawSkeleton = false;
        const check = () => {
            if (document.getElementById('calendarBooting')) window.__sawSkeleton = true;
            requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
    });
    await page.goto('/index.html');
    await expect(page.locator('#calendarDisplay')).toBeVisible();
    expect(await page.evaluate(() => window.__sawSkeleton)).toBe(false);
});

// ── Privilege isolation ─────────────────────────────────────────────────────────────────────────

for (const [label, url] of [['Admin', '/admin.html'], ['Settings', '/settings.html']]) {
    test(`a viewer navigating to ${label} still has to sign in as a member`, async ({ page }) => {
        // The viewer holds a Firebase identity, so a page that merely checked "is anyone signed in?"
        // would let it through. These pages check for a MEMBER, and this proves they still do.
        await stubPinExchange(page);
        await page.goto('/index.html');
        await enterPin(page, '1234');
        await expect(page.locator('#calendarDisplay')).toBeVisible();

        await page.goto(url);
        await expect(page.locator('#loginOverlay')).toBeVisible();
    });
}

test('Lock Calendar appears for a viewer and not for a member', async ({ page }) => {
    await stubPinExchange(page);
    await page.goto('/index.html');
    await enterPin(page, '1234');
    await page.locator('#navMenuBtn').click();
    await expect(page.locator('#navLockCalendarBtn')).toBeVisible();
});

test('Lock Calendar is hidden from a signed-in member', async ({ page }) => {
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/index.html');
    await expect(page.locator('#calendarDisplay')).toBeVisible();
    await page.locator('#navMenuBtn').click();
    await expect(page.locator('#navPanel')).toBeVisible();
    await expect(page.locator('#navLockCalendarBtn')).toBeHidden();
});

// ── Accessibility + layout ──────────────────────────────────────────────────────────────────────

test('the unlock card is operable by keyboard alone', async ({ page }) => {
    await seedMember(page);
    await stubPinExchange(page);
    await page.goto('/index.html');
    const pin = page.locator('#calLockPin');
    await pin.focus();
    await page.keyboard.type('1234');
    await page.keyboard.press('Enter');            // submit without ever reaching the button
    await expect(page.locator('#calendarDisplay')).toBeVisible();
});

test('the PIN field is labelled, and large enough not to trigger iOS focus zoom', async ({ page }) => {
    await page.goto('/index.html');
    const label = page.locator('label[for="calLockPin"]');
    await expect(label).toBeVisible();
    // iOS Safari zooms the whole page when a focused field is under 16px. On the app's front door
    // that lands a first-time user in a half-scrolled layout.
    const size = await page.locator('#calLockPin').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(16);
});

test('the card does not overflow at 360px, nor sprawl at 1440px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/index.html');
    await expect(page.locator('#calendarLock')).toBeVisible();
    const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    await page.setViewportSize({ width: 1440, height: 900 });
    const w = await page.locator('.cal-lock-card').evaluate(el => el.getBoundingClientRect().width);
    // Compact on purpose — a wide centred panel is what a corporate login portal looks like.
    expect(w).toBeLessThanOrEqual(440);
});

// ── Regressions found by the v20.15 bug sweep ───────────────────────────────────────────────────

test('the nav drawer shows NO footer while the Calendar is locked', async ({ page }) => {
    // v20.12 widened the footer condition from `onSignOut` to `(onSignOut || onLockCalendar)` so the
    // viewer's Lock Calendar button had somewhere to live — and the calendar always passes the
    // latter, so a locked visitor got an empty footer bar with a blank member name, and a
    // NOTIFICATION BELL. The bell is documented as signed-in only, and a viewer tapping it would be
    // denied by the v20.12 push-subscription rule: a control that cannot succeed, offered.
    await page.goto('/index.html');
    await expect(page.locator('#calLockPin')).toBeVisible();
    await page.locator('#navMenuBtn').click();
    await expect(page.locator('#navPanel')).toBeVisible();
    await expect(page.locator('.nav-panel-footer')).toBeHidden();
    await expect(page.locator('#navNotifBell')).toHaveCount(0);
});

test('a VIEWER gets the footer for Lock Calendar — but still no bell', async ({ page }) => {
    await stubPinExchange(page);
    await seedMember(page);
    await page.goto('/index.html');
    await enterPin(page, '1234');
    await expect(page.locator('#calendarDisplay')).toBeVisible();
    await page.locator('#navMenuBtn').click();
    await expect(page.locator('.nav-panel-footer')).toBeVisible();
    await expect(page.locator('#navLockCalendarBtn')).toBeVisible();
    await expect(page.locator('#navPanelMember')).toHaveText('Staff PIN access');
    // Every office PC unlocking with the PIN shares one uid, so a subscription written under it is
    // owned by fifty people. The rules deny it; the UI must not offer it either.
    await expect(page.locator('#navNotifBell')).toHaveCount(0);
});

test('a signed-in member keeps the full footer — name, bell and sign out', async ({ page }) => {
    // Guard the guard. Both assertions above are absences, and a footer that never rendered for
    // anybody would satisfy them.
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/index.html');
    await expect(page.locator('#calendarDisplay')).toBeVisible();
    await page.locator('#navMenuBtn').click();
    await expect(page.locator('.nav-panel-footer')).toBeVisible();
    await expect(page.locator('#navPanelMember')).toHaveText('G. Miller');
    await expect(page.locator('#navSignOutBtn')).toBeVisible();

    // ── THE BELL FOLLOWS THE BROWSER'S CAPABILITY, NOT THIS TEST'S EXPECTATIONS (v21.28) ────────
    //
    // This asserted `toHaveCount(1)` unconditionally, which is a CHROMIUM assumption: `notifSupported`
    // hides the bell where Web Push does not exist, and Safari is exactly that case. Adding WebKit
    // coverage found it on the first run — the app was right and the test was provincial.
    //
    // Asked of the PAGE rather than branched on the project name, because the question is what this
    // browser can actually do. A per-browser branch would go stale the day Safari ships Web Push in
    // this context, and would go stale silently.
    const pushCapable = await page.evaluate(() =>
        'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window);
    await expect(page.locator('#navNotifBell')).toHaveCount(pushCapable ? 1 : 0);
    // Either way the footer is INTACT — which is what this test is guarding. A missing bell is a
    // capability the browser lacks; a missing name or sign-out would be a broken footer.
    await expect(page.locator('.nav-panel-footer')).toBeVisible();
});

// ── The on/off switch (v20.16) ──────────────────────────────────────────────────────────────────
//
// The feature ships DARK: merged, deployed and running, but invisible to staff until one line is
// flipped. These prove the "off" state is genuinely the pre-v20.12 Calendar and not a half-disabled
// version of the new one — which is the failure that would only be discovered by staff.

test('switched OFF: a visitor with nothing gets the Calendar, exactly as before', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await disableCalendarPin(page);
    await seedMember(page);
    await page.goto('/index.html');

    await expect(page.locator('#calendarDisplay')).toBeVisible();
    await expect(page.locator('#calendarLock')).toHaveCount(0);
    await expect(page.locator('#calendarControls')).toBeVisible();
    await expect(page.locator('#calendarLegend')).toBeVisible();
    // Built, not merely revealed.
    expect(await page.locator('#teamMemberSelect option').count()).toBeGreaterThan(0);
    expect(errors).toEqual([]);
});

test('switched OFF: the FIRST-RUN prompt still works for a brand-new device', async ({ page }) => {
    // No seeded member at all — the state a new starter opens the app in. Under the old model this
    // is the "choose your name" prompt, and it must survive the switch untouched.
    await disableCalendarPin(page);
    await page.goto('/index.html');
    await expect(page.locator('#calendarDisplay')).toBeVisible();
    await expect(page.locator('#calendarLock')).toHaveCount(0);
});

test('switched OFF: no Lock Calendar, and no empty footer', async ({ page }) => {
    // `open` is not viewer mode. Offering "Lock Calendar" when there is no lock would be a control
    // that does nothing.
    await disableCalendarPin(page);
    await seedMember(page);
    await page.goto('/index.html');
    await expect(page.locator('#calendarDisplay')).toBeVisible();
    await page.locator('#navMenuBtn').click();
    await expect(page.locator('#navPanel')).toBeVisible();
    await expect(page.locator('#navLockCalendarBtn')).toBeHidden();
});

test('switched OFF: a signed-in member is unaffected', async ({ page }) => {
    await disableCalendarPin(page);
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/index.html');
    await expect(page.locator('#calendarDisplay')).toBeVisible();
    await page.locator('#navMenuBtn').click();
    await expect(page.locator('#navPanelMember')).toHaveText('G. Miller');
    await expect(page.locator('#navSignOutBtn')).toBeVisible();
});

// ── WHO THE NOTICES ARE ADDRESSED TO (v21.81) ───────────────────────────────────────────────────
//
// Reported by the owner the day the PIN went live: the one-time notices were opening on the station
// PC. They waited on `calendarAccessReady`, which is the moment access is GRANTED and says nothing
// about whose it is — so a notice asking the reader to check their own payslips were entered
// correctly appeared on a machine that is deliberately unattributable and holds nobody's payslips.
//
// The rule is unit-tested in calendar-access-core.test.mjs. What is tested HERE is the wiring, and
// only a browser can answer it: whether a real page open on a viewer session actually withholds the
// notice, and — the half that is easy to get backwards — whether the notice written FOR people who
// have not signed in still opens on exactly that session.
test.describe('one-time notices and the PIN unlock', () => {
    // Before the back-pay notice's hard 27 Aug 23:00 cutoff, or it silently retires and these would
    // pass by testing nothing. Pinned rather than removed with the notice: what is under test is the
    // audience gate, and the next members-only notice inherits it.
    const BEFORE_CUTOFF = new Date('2026-08-24T09:00:00Z');
    // The notices open 1500ms after access is granted. Proving an ABSENCE means waiting past that,
    // and the first test below is what makes this number credible rather than hopeful: it shows a
    // permitted notice is already on screen by then, on the same session, through the same path.
    const PAST_THE_DEFER = 2500;

    // ONE flag per test, deliberately. With both notices live only one can be on screen —
    // `openNoticeIfClear`, v19.53 — so a test that clears both and asserts the members-only notice
    // is absent passes whether the gate refused it or it merely lost the race to the other one.
    // That is not a hypothetical: it is what the first version of this block did, and a mutation
    // declaring the back-pay notice `'everyone'` — the exact reported bug — sailed through it.
    test('a PIN unlock still gets the notice written FOR people who have not signed in', async ({ page }) => {
        const errors = collectFatalErrors(page);
        await page.clock.setFixedTime(BEFORE_CUTOFF);
        await seedViewerAccess(page);
        await seedMember(page);            // a chosen member is a DISPLAY choice, not a session
        await clearNoticeFlags(page, ['myb_notice_pw_own_2026_done']);
        await page.goto('/');
        await expect(page.locator('.month-year')).toBeVisible();
        await expect(page.locator('#pwNoticeLb'), "'everyone' must survive the audience default").toHaveClass(/open/);
        // ...and it reaches the drawer's App Notices list, which is where a member who closed it
        // goes to read it again. The audience decides BOTH surfaces, not just the lightbox.
        await expect.poll(async () => page.evaluate(() =>
            JSON.parse(localStorage.getItem('myb_app_notices') || '[]').map(n => n.id)))
            .toContain('pw-own-2026');
        expect(errors, 'Uncaught JS exceptions on a viewer calendar').toHaveLength(0);
    });

    test('...and NOT the one that asks about your own payslips', async ({ page }) => {
        const errors = collectFatalErrors(page);
        await page.clock.setFixedTime(BEFORE_CUTOFF);
        await seedViewerAccess(page);
        await seedMember(page);
        await clearNoticeFlags(page, ['myb_notice_backpay_2026_done']);
        await page.goto('/');
        await expect(page.locator('.month-year')).toBeVisible();
        await page.waitForTimeout(PAST_THE_DEFER);
        await expect(page.locator('#bpNoticeLb')).not.toHaveClass(/open/);
        // ...and NOT flagged seen, or it would never arrive on the day that device signs in.
        const flagged = await page.evaluate(() => localStorage.getItem('myb_notice_backpay_2026_done'));
        expect(flagged, 'a suppressed notice must be left untouched, not marked seen').toBeNull();

        // ...and NOT in the ARCHIVE either, which is the half the report was actually about: the
        // drawer's "App Notices" list is this store, so a notice kept off the screen but written
        // here would still be sitting in a menu on the station PC. It is archived in `onOpen`, so
        // not opening covers it — but that is a consequence of the wiring rather than a rule
        // anybody stated, and it is one refactor away from not being true.
        const archived = await page.evaluate(() =>
            JSON.parse(localStorage.getItem('myb_app_notices') || '[]').map(n => n.id));
        expect(archived, 'a notice the station was not addressed by must not reach its drawer')
            .not.toContain('backpay-2026');
        expect(errors, 'Uncaught JS exceptions on a viewer calendar').toHaveLength(0);
    });

    test('a signed-in member on the same device does get it', async ({ page }) => {
        const errors = collectFatalErrors(page);
        await page.clock.setFixedTime(BEFORE_CUTOFF);
        await seedSession(page);
        await seedMemberSession(page);
        await seedMember(page);
        await clearNoticeFlags(page, ['myb_notice_backpay_2026_done']);
        await page.goto('/');
        await expect(page.locator('.month-year')).toBeVisible();
        await expect(page.locator('#bpNoticeLb'), 'the same notice the station PC was refused').toHaveClass(/open/);
        expect(errors, 'Uncaught JS exceptions on a member calendar').toHaveLength(0);
    });
});
