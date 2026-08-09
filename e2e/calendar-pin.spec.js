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
import { seedMember, seedMemberSession, stubPinExchange, enterPin, collectFatalErrors } from './helpers.js';
import { disableCalendarPin } from './fixtures.js';

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
    await expect(page.locator('#navNotifBell')).toHaveCount(1);
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
