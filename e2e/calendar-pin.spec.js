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
import { seedMember, seedMemberSession, seedSession, seedSessionOnce, stubPinExchange, enterPin, openPinCard, signInThroughOverlay, collectFatalErrors, seedViewerAccess, clearNoticeFlags } from './helpers.js';
import { disableCalendarPin, enableCalendarPin } from './fixtures.js';

// Every test here sets `CONFIG.CALENDAR_PIN_ACCESS` explicitly rather than inheriting it, and the
// value it ships with is deliberately NOT restated in this file — `roster-data.js` owns that, and
// a comment carrying a second copy is the defect this repo records most often. (This comment was
// one: it read "the shipped default is OFF … deployed dark" for the five weeks after the flag went
// live, i.e. it told a reader the Calendar was still open when the rules had already closed it.)
// The reasoning survives the value either way: these describe the configuration the FEATURE is
// for, so the suite must not quietly stop testing the card because a deployment flag moved.
// The four "switched OFF" tests below call disableCalendarPin, which writes the same map key, so
// the later call simply wins.
test.beforeEach(async ({ page }) => { await enableCalendarPin(page); });

// ── Locked ──────────────────────────────────────────────────────────────────────────────────────

test('a fresh browser gets the SIGN-IN card first, and NO roster data', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedMember(page);              // a member was chosen on this machine before — still locked
    await page.goto('/index.html');

    // ── THE FRONT DOOR IS SIGN-IN FIRST (v23.19, owner decision) ────────────────────────────────
    // Most people opening the app are staff with a password; the PIN is for the shared PC and for
    // visiting or agency staff, and is one tap behind. From v20.12 to v23.18 this asserted the PIN
    // field here.
    await expect(page.locator('#calendarLock')).toBeVisible();
    await expect(page.locator('#calendarLock #loginCard')).toBeVisible();
    // THE TRIGGER, NOT THE SELECT (v23.50). This read `#loginName` until v23.49 put the sign-in
    // pair through `enhanceSelect`, which leaves the native `<select>` as a 1px `aria-hidden`
    // value holder. Playwright still calls that VISIBLE — a non-empty box and no `visibility:
    // hidden` — so the assertion went on passing while proving nothing: the front door's name
    // control could have been entirely absent and this line would not have noticed. Every visible
    // pixel is the trigger, so that is what the reader sees and what this asserts.
    await expect(page.locator('#loginNameTrigger')).toBeVisible();
    await expect(page.locator('#calLockPin')).toHaveCount(0);
    await expect(page.locator('#loginAlternative')).toHaveText(/staff PIN/i);
    await expect(page.locator('#loginAlternativeHint')).toContainText(/agency/i);
    // Inline, not a modal: no dialog role, no scroll lock, and the drawer's burger is still there.
    await expect(page.locator('#loginOverlay')).not.toHaveAttribute('role', 'dialog');
    await expect(page.locator('body')).not.toHaveClass(/lb-open/);
    await expect(page.locator('#navMenuBtn')).toBeVisible();

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
    await expect(page.locator('#calendarLock #loginCard')).toBeVisible();
});

test('the staff PIN is one tap behind the sign-in card, and the way back is in place', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('#calendarLock #loginCard')).toBeVisible();
    await page.locator('#loginAlternative').click();
    // A swap in ONE slot: the PIN card is up, the sign-in card is gone — not covered, gone.
    await expect(page.locator('#calLockPin')).toBeVisible();
    await expect(page.locator('#loginCard')).toHaveCount(0);
    expect(await page.locator('#calendarLock').count()).toBe(1);
    await expect(page.locator('#calLockSignIn')).toHaveText(/sign in/i);
    await page.locator('#calLockSignIn').click();
    await expect(page.locator('#calendarLock #loginCard')).toBeVisible();
    await expect(page.locator('#calLockPin')).toHaveCount(0);
    expect(await page.locator('#calendarLock').count()).toBe(1);
});

test('Escape on the front-door card does NOT leave the page', async ({ page }) => {
    // The modal overlay's Escape goes "back to the roster". Inline on the roster's own page that
    // would reload under a form somebody is typing into — so host mode installs no Escape.
    await page.goto('/index.html');
    await page.locator('#loginPassword').fill('abc');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await expect(page.locator('#loginPassword')).toHaveValue('abc');
});

test('signing in from the front door SAVES the session and lands on the roster', async ({ page }) => {
    // The whole point of the reorder: a member with a password gets in from the first screen, with
    // nothing to find. The real shared form, the real sign-in core, the stub's happy path; success
    // reloads and the boot decision then answers `named` — no second code path.
    await page.addInitScript(() => { window.__E2E = Object.assign(window.__E2E || {}, { signInEstablishes: true }); });
    await page.goto('/index.html');
    await expect(page.locator('#calendarLock #loginCard')).toBeVisible();
    await signInThroughOverlay(page, 'G. Miller');
    await expect(page.locator('#calendarDisplay')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#calendarLock')).toHaveCount(0);
    const stored = await page.evaluate(() => localStorage.getItem('myb_admin_session'));
    expect(stored).toContain('G. Miller');
});

test('`#staff-pin` lands on the PIN card first, and the hash is consumed', async ({ page }) => {
    // The one direct route to the PIN card: what a "Use the staff PIN instead" sign-out reloads
    // with, and what a station PC can bookmark. It must not stay in the address bar.
    await page.goto('/index.html#staff-pin');
    await expect(page.locator('#calLockPin')).toBeVisible();
    await expect(page.locator('#loginCard')).toHaveCount(0);
    expect(new URL(page.url()).hash).toBe('');
});

test('the nav drawer and the guides stay reachable while locked', async ({ page }) => {
    // Locking the building to reach the noticeboard would be absurd: the guides, the Huddle and the
    // documents are deliberately outside the gate.
    await page.goto('/index.html');
    await expect(page.locator('#calendarLock #loginCard')).toBeVisible();
    await page.locator('#navMenuBtn').click();
    await expect(page.locator('#navPanel')).toBeVisible();
    await expect(page.locator('#navPanel')).toContainText('Railcard');
});

// ── THE DOCUMENTS ARE BEHIND THE PIN TOO (v23.17, owner decision 7 Sep 2026) ────────────────────
//
// The rules close the reads on the server; these prove the CLIENT refuses them at source, which is
// the half a rules test cannot see — the local Firestore cache answers without consulting a rule.
// `__E2E.docReads` counts every collection read the fixture receives, so "no read" is asserted,
// not inferred from a blank screen.

const docReads = (/** @type {import('@playwright/test').Page} */ page) =>
    page.evaluate(() => { const e = /** @type {any} */ (window).__E2E || {}; return (e.docReads || 0) + (e.snapshotSubs || 0); });

test('locked: a Daily Huddle tap says what to do, and issues NO read', async ({ page }) => {
    // '/', not '/index.html': the drawer link is `./#huddle`, which from '/' is a HASH CHANGE (the
    // route a notification tap and a real staff tap both take) and from '/index.html' would be a
    // full navigation to a different path.
    await page.goto('/');
    await expect(page.locator('#calendarLock')).toBeVisible();
    const before = await docReads(page);
    await page.locator('#navMenuBtn').click();
    await page.locator('#navPanel a[href="./#huddle"]').click();
    await expect(page.locator('#huddleViewerBody')).toContainText('Enter the staff PIN, or sign in, to read the Daily Huddle');
    await expect(page.locator('#huddleViewer')).toHaveClass(/open/);
    expect(await docReads(page), 'the tap itself issued nothing').toBe(before);
    // ABSOLUTE, not a delta: the first cut compared before/after the tap, and a listener attached
    // at page LOAD sat inside the baseline — the mutation that removed the guard passed. A locked
    // Calendar attaches no Huddle listener at any point, because the local cache would answer it.
    expect(await page.evaluate(() => (/** @type {any} */ (window).__E2E || {}).snapshotSubs || 0),
        'no Huddle listener may ever attach on a locked Calendar').toBe(0);
});

test('locked: a Circular deep link says what to do, issues NO read, and is FINISHED by the PIN', async ({ page }) => {
    await stubPinExchange(page);
    await page.goto('/index.html#circular');
    await expect(page.locator('#calendarLock')).toBeVisible();
    await expect(page.locator('#docViewer')).toBeVisible();
    await expect(page.locator('#docViewerBody')).toContainText('Enter the staff PIN, or sign in, to read the Weekly Retail Circular');
    const before = await docReads(page);
    // The message sits over the PIN card, so the reader closes it to type — and the held tap has to
    // survive that close, or a notification tap could never be finished by a PIN.
    await page.locator('#docViewerClose').click();
    await expect(page.locator('#docViewer')).toBeHidden();
    await enterPin(page, '1234');
    // The deep link survived the unlock: the read the lock held back now runs, and its result —
    // the fixture has no circular — is what replaces the message.
    await expect(page.locator('#docViewerBody')).toContainText('No Weekly Retail Circular has been uploaded yet', { timeout: 10000 });
    expect(await docReads(page), 'the held read ran once the PIN was in').toBeGreaterThan(before);
});

test('locked: the drawer refuses a Circular tap without opening a tab', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('#calendarLock')).toBeVisible();
    const before = await docReads(page);
    const popups = [];
    page.on('popup', p => popups.push(p));
    await page.locator('#navMenuBtn').click();
    await page.locator('#navPanel .nav-panel-link--circular').click();
    await expect(page.locator('#navComingSoonLightbox')).toBeVisible();
    await expect(page.locator('#navComingSoonLightbox')).toContainText('Enter the staff PIN on the Calendar, or sign in, to open this');
    await expect(page.locator('#navComingSoonLightbox')).toContainText('Weekly Retail Circular');
    expect(await docReads(page)).toBe(before);
    expect(popups.length, 'no blank tab is opened for a read that will not happen').toBe(0);
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

    await expect(page.locator('#calendarLock')).toBeVisible();
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
    await openPinCard(page);
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
    await openPinCard(page);
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
    await openPinCard(page);
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
    await expect(page.locator('#calendarLock')).toBeVisible();   // the front door again (sign-in first)
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

    // ── AND IT ALREADY KNOWS WHO THEY ARE (v23.58) ──────────────────────────────────────────────
    // The card's heading just said "Calendar · G. Miller". The form must not ask again: grade and
    // name pre-selected, and focus on the one field only they can fill. Asserted on the PICKER
    // FACES, not the hidden selects — a value set in code repaints nothing unless `input` is
    // dispatched (the v23.42 rule), and the face is what a member sees.
    await expect(page.locator('#loginName')).toHaveValue('G. Miller');
    await expect(page.locator('#loginNameTrigger')).toContainText('G. Miller');
    // The grade is read from the SELECT, not the trigger's text: the trigger also carries a hidden
    // width-sizer holding the widest option label, so its textContent reads "CEA— Select grade —".
    // The name trigger above already proves the right grade's list was populated; this pins that
    // the grade control itself holds a value rather than the placeholder.
    await expect(page.locator('#loginGrade')).not.toHaveValue('');
    await expect(page.locator('#loginGradeTrigger')).toHaveAttribute('aria-label', /Select your grade\. \S/);
    await expect(page.locator('#loginPassword')).toBeFocused();
});

test('a preset name NO grade lists falls through to the ordinary form — a convenience, never a gate', async ({ page }) => {
    // The preset finds the grade by asking each grade's own list whether it holds the name, so a
    // leaver, a hidden row or a misspelling cannot land the form in a state a member could not have
    // reached by hand. Driven directly, because no shipped card passes a name that is not on the
    // roster — which is exactly why this path would otherwise go unexercised.
    await seedMemberSession(page, 'G. Miller');   // a GRANTED calendar: nothing else is mounted in the slot
    // A LAST-USED GRADE is on record, deliberately. "Falls through to the ordinary form" has to
    // mean the whole ordinary form — including the grade the form remembers between sign-ins. The
    // first cut of this test had no saved grade, and a mutation that inverted the guard passed it:
    // a bad preset still produced an empty, disabled form, but it had silently thrown the saved
    // grade away on the way, and nothing here could see that.
    await page.addInitScript(() => { try { localStorage.setItem('myb_login_grade', 'CES'); } catch {} });
    await page.goto('/index.html');
    await expect(page.locator('#calendarDisplay')).toBeVisible();
    await expect(page.locator('#loginOverlay')).toHaveCount(0);   // or initLoginOverlay's idempotence would no-op
    await page.evaluate(async () => {
        const { initLoginOverlay } = await import('./login-overlay.js');
        initLoginOverlay({ pageLabel: 'a test', onSuccess() {}, presetName: 'Nobody Onthe-Roster' });
    });
    await expect(page.locator('#loginOverlay')).toBeVisible();
    await expect(page.locator('#loginGrade')).toHaveValue('CES', { timeout: 5_000 });   // the ordinary restore ran
    await expect(page.locator('#loginName')).toHaveValue('');                            // and nobody was picked
    await expect(page.locator('#loginName')).toBeEnabled();
    await expect(page.locator('#loginNameTrigger')).toContainText(/select your name/i);
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
    await expect(page.locator('#calendarLock')).toBeVisible({ timeout: 20_000 });
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
    await openPinCard(page);
    const pin = page.locator('#calLockPin');
    await pin.focus();
    await page.keyboard.type('1234');
    await page.keyboard.press('Enter');            // submit without ever reaching the button
    await expect(page.locator('#calendarDisplay')).toBeVisible();
});

test('the PIN field is labelled, and large enough not to trigger iOS focus zoom', async ({ page }) => {
    await page.goto('/index.html');
    await openPinCard(page);
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
    // Both cards this slot can hold — the sign-in card is up first; the PIN card wears the same recipe.
    const w = await page.locator('#calendarLock #loginCard').evaluate(el => el.getBoundingClientRect().width);
    expect(w).toBeLessThanOrEqual(440);
    await openPinCard(page);
    const w2 = await page.locator('.cal-lock-card').evaluate(el => el.getBoundingClientRect().width);
    // Compact on purpose — a wide centred panel is what a corporate login portal looks like.
    expect(w2).toBeLessThanOrEqual(440);
});

// ── Regressions found by the v20.15 bug sweep ───────────────────────────────────────────────────

test('the nav drawer shows NO footer while the Calendar is locked', async ({ page }) => {
    // v20.12 widened the footer condition from `onSignOut` to `(onSignOut || onLockCalendar)` so the
    // viewer's Lock Calendar button had somewhere to live — and the calendar always passes the
    // latter, so a locked visitor got an empty footer bar with a blank member name, and a
    // NOTIFICATION BELL. The bell is documented as signed-in only, and a viewer tapping it would be
    // denied by the v20.12 push-subscription rule: a control that cannot succeed, offered.
    await page.goto('/index.html');
    await expect(page.locator('#calendarLock')).toBeVisible();
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
// only a browser can answer it: whether a real page open on a viewer session actually withholds a
// notice it is not addressed by, and whether the same notice reaches the member it IS for.
//
// ── ONE DIRECTION LOST ITS SUBJECT AT v23.23, AND SAYING SO IS THE POINT ────────────────────────
// The other half — a `'signed-out'` notice REACHING a PIN unlock — was carried by `sign-in-2026`,
// which was retired by owner decision (the Calendar's front door became a sign-in at v23.19, so the
// notice re-offered a choice its reader had just declined). No live notice declares that audience
// now, so that direction has nothing to exercise it and the test went with the notice rather than
// being faked against one that cannot open. What still holds the line meanwhile is static, in
// calendar-notices.test.mjs: `_openWhenAudienceAllows` must FORWARD its declared audience to the
// rule rather than hardcode one, which is the shape a members-only regression would take.
// **The next `'signed-out'` notice restores this test** — `.claude/skills/new-notice/` says so.
test.describe('one-time notices and the PIN unlock', () => {
    // Inside the leave-reminder notice's life (posted 8 Sep 2026, 90-day expiry), or it silently
    // retires and these would pass by testing nothing. Pinned rather than removed with the notice:
    // what is under test is the audience gate, and the next members-only notice inherits it.
    const BEFORE_CUTOFF = new Date('2026-09-10T09:00:00Z');
    // The notices open 1500ms after access is granted. Proving an ABSENCE means waiting past that,
    // and the first test below is what makes this number credible rather than hopeful: it shows a
    // permitted notice is already on screen by then, on the same session, through the same path.
    const PAST_THE_DEFER = 2500;

    // ONE flag per test, deliberately, and keep it that way as notices come and go. Only one notice
    // can be on screen at a time — `openNoticeIfClear`, v19.53 — so a test that clears every flag
    // and asserts the members-only notice is absent passes whether the gate refused it or it merely
    // lost the race to another one. That is not a hypothetical: it is what the first version of
    // this block did, and a mutation declaring the members-only notice `'everyone'` — the exact
    // reported bug — sailed through it.
    test('...and NOT the one about your own annual leave', async ({ page }) => {
        const errors = collectFatalErrors(page);
        await page.clock.setFixedTime(BEFORE_CUTOFF);
        await seedViewerAccess(page);
        await seedMember(page);
        await clearNoticeFlags(page, ['myb_notice_al_booking_2026_done']);
        await page.goto('/');
        await expect(page.locator('.month-year')).toBeVisible();
        await page.waitForTimeout(PAST_THE_DEFER);
        await expect(page.locator('#alNoticeLb')).not.toHaveClass(/open/);
        // ...and NOT flagged seen, or it would never arrive on the day that device signs in.
        const flagged = await page.evaluate(() => localStorage.getItem('myb_notice_al_booking_2026_done'));
        expect(flagged, 'a suppressed notice must be left untouched, not marked seen').toBeNull();

        // ...and NOT in the ARCHIVE either, which is the half the report was actually about: the
        // drawer's "App Notices" list is this store, so a notice kept off the screen but written
        // here would still be sitting in a menu on the station PC. It is archived in `onOpen`, so
        // not opening covers it — but that is a consequence of the wiring rather than a rule
        // anybody stated, and it is one refactor away from not being true.
        const archived = await page.evaluate(() =>
            JSON.parse(localStorage.getItem('myb_app_notices') || '[]').map(n => n.id));
        expect(archived, 'a notice the station was not addressed by must not reach its drawer')
            .not.toContain('al-booking-2026');
        expect(errors, 'Uncaught JS exceptions on a viewer calendar').toHaveLength(0);
    });

    test('a signed-in member on the same device does get it', async ({ page }) => {
        const errors = collectFatalErrors(page);
        await page.clock.setFixedTime(BEFORE_CUTOFF);
        await seedSession(page);
        await seedMemberSession(page);
        await seedMember(page);
        await clearNoticeFlags(page, ['myb_notice_al_booking_2026_done']);
        await page.goto('/');
        await expect(page.locator('.month-year')).toBeVisible();
        await expect(page.locator('#alNoticeLb'), 'the same notice the station PC was refused').toHaveClass(/open/);
        expect(errors, 'Uncaught JS exceptions on a member calendar').toHaveLength(0);
    });
});

// ── THE PROVISIONAL PAINT (v22.97) ──────────────────────────────────────────────────────────────
//
// A returning member sees the roster this device already holds for them WHILE their stored identity
// is revalidated, instead of after. The decision is pure and pinned in `calendar-access-core`; the
// grant/revoke wiring is pinned in `calendar-access.test.mjs`. What neither can answer is the pair
// of properties that only exist on a rendered page, and both are the failure this feature could
// plausibly ship with:
//
//   · that the grid is genuinely UP while the round trip is still open. Every unit assertion can
//     say a callback fired; only a browser can say a member is looking at their shifts.
//   · that the two cross-member controls come BACK. They are disabled for the length of the paint,
//     so the way this breaks in production is not a leak — it is a Team View button that is dead
//     for the rest of the session, on a page where nothing throws and nothing is logged.
//
// `authRestoreDelayMs` is the lever: it holds the persisted-user restore open, which is exactly the
// `accounts:lookup` wait the fast path exists to skip.

test('a returning member sees their roster WHILE the identity is still being confirmed', async ({ page }) => {
    test.setTimeout(60_000);
    await seedSession(page, 'G. Miller');
    await seedMember(page, 'G. Miller');
    // 5s: comfortably longer than the paint, and comfortably INSIDE `resolveAccess`'s own bound, so
    // this exercises provisional → confirmed and nothing else. The first cut used 8s, which tripped
    // that bound — the decision resolved `none`, the paint was REVOKED (re-enabling the controls),
    // and the late-restore watcher granted afterwards. Every assertion still passed, and the last
    // one passed on the revoke rather than on the grant: a mutation pinning the controls disabled
    // for ever sailed through it. The delay is load-bearing, not padding.
    await page.addInitScript(() => {
        window.__E2E = Object.assign(window.__E2E || {}, { authUser: true, authRestoreDelayMs: 5000 });
    });
    await page.goto('/index.html');

    // Well inside the restore: before v22.97 this window held a splash, then a lock decision.
    await expect(page.locator('#calendarDisplay')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('#calLockPin')).toHaveCount(0);
    // Scoped, so the controls that would put somebody else on screen are shut for the duration.
    await expect(page.locator('#teamViewBtn')).toBeDisabled();
    await expect(page.locator('#teamMemberSelect')).toBeDisabled();

    // …and they come back when the identity confirms. This is the assertion that would fail on a
    // shipped grant bug — a Team View button dead for the rest of the session, nothing thrown and
    // nothing logged. Re-checked after a settle, because "enabled at some instant" is satisfied by
    // a transient and this must be the resting state.
    await expect(page.locator('#teamViewBtn')).toBeEnabled({ timeout: 20_000 });
    await page.waitForTimeout(500);
    await expect(page.locator('#teamViewBtn')).toBeEnabled();
    await expect(page.locator('#teamMemberSelect')).toBeEnabled();
});

test('a TEAM VIEW member is not painted early, and their team grid still restores', async ({ page }) => {
    // The precondition, end to end: the whole team cannot be drawn from a one-member scope, so this
    // boot is simply not eligible. The delay is what makes the refusal OBSERVABLE — without it the
    // paint and the confirmation land together and the test passes whether the rule exists or not.
    test.setTimeout(60_000);
    await seedSession(page, 'G. Miller');
    await seedMember(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_team_view', '1');
        window.__E2E = Object.assign(window.__E2E || {}, { authUser: true, authRestoreDelayMs: 5000 });
    });
    await page.goto('/index.html');

    // Nothing is painted while the identity is in flight — this member waits, as they always did.
    await page.waitForTimeout(2000);
    await expect(page.locator('.team-week-text')).toHaveCount(0);
    await expect(page.locator('#calendarDisplay')).toBeHidden();

    // Refusing costs the fast path and nothing else: the team grid arrives on confirmation.
    await expect(page.locator('.team-week-text')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#teamViewBtn')).toBeEnabled();
});
