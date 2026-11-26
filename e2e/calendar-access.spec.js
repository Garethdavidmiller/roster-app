/**
 * calendar-access.spec.js — the Calendar's access gate, in a real browser.
 *
 * Only a member's own sign-in opens the Calendar. Until 23 Nov 2026 the shared staff PIN opened it
 * too, and this file was calendar-pin.spec.js; the PIN's card, unlock, Lock and `#staff-pin` went
 * with it (owner decision), and what is left of the PIN here is its END — a browser still holding a
 * PIN session is signed out on arrival and told why ("A LEFTOVER STAFF-PIN SESSION", below).
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
 *   · **that a leftover staff-PIN session is signed out, on the Calendar and on Trains, and the card
 *     says why.** The teardown is unit-tested; whether each page actually runs it is a wiring question.
 */
import { test, expect, isoDaysAgo, withKnownNewsletter, withServerNewsletter } from './fixtures.js';
import { NEWSLETTER_LATEST_KEY } from '../newsletter-recency.js';
import { seedMember, seedMemberSession, seedSession, signInThroughOverlay, collectFatalErrors, seedLegacyViewerSession, clearNoticeFlags, isTouchProject, recordFirstFrameText, firstFrameText } from './helpers.js';
import { STAFF_PIN_ENDED_NOTICE } from '../staff-pin-ended.js';
import { forcePasswordSet } from './fixtures.js';

// (Until v24.34 every test here pinned `CONFIG.CALENDAR_PIN_ACCESS` on, and four more proved the
// "switched OFF" Calendar. The switch was retired — the rules had long since stopped letting its
// anonymous session read anything — so the gate is the only Calendar there is.)

// ── Locked ──────────────────────────────────────────────────────────────────────────────────────

test('a fresh browser gets the SIGN-IN card first, and NO roster data', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedMember(page);              // a member was chosen on this machine before — still locked
    await page.goto('/index.html');

    // ── THE FRONT DOOR IS A SIGN-IN, AND NOTHING ELSE (v23.19; the PIN retired 23 Nov 2026) ──────
    // From v20.12 to v23.18 this asserted the PIN field here, and until the PIN was retired a link to
    // it sat under the form. There is no other way in now.
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
    await expect(page.locator('#loginAlternative')).toHaveCount(0);
    await expect(page.locator('#loginNotice'), 'nobody held the PIN here, so nothing is said about it').toBeEmpty();
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

test('Escape on the front-door card does NOT leave the page', async ({ page }) => {
    // The modal overlay's Escape goes "back to the roster". Inline on the roster's own page that
    // would reload under a form somebody is typing into — so host mode installs no Escape.
    await page.goto('/index.html');
    await page.locator('#loginPassword').fill('abc');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await expect(page.locator('#loginPassword')).toHaveValue('abc');
});

/** Mark this page in memory: a reload loses the mark, so its survival proves none happened. */
async function markThisPage(page) { await page.evaluate(() => { /** @type {any} */ (window).__samePage = true; }); }
/** @returns {Promise<boolean>} whether the page marked by `markThisPage` is still the one loaded */
async function stillThisPage(page) { return page.evaluate(() => /** @type {any} */ (window).__samePage === true); }

test('signing in from the front door SAVES the session and lands on the roster — in place, with the member\'s menu', async ({ page }) => {
    // The whole point of the reorder: a member with a password gets in from the first screen, with
    // nothing to find. The real shared form, the real sign-in core, the stub's happy path; success
    // GRANTS IN PLACE (calendar-access.js → `finishSignIn`) through the boot's own grant — no second
    // code path, and since v26.40 no reload: the page the member typed on is the page they read.
    const errors = collectFatalErrors(page);
    await page.addInitScript(() => { window.__E2E = Object.assign(window.__E2E || {}, { signInEstablishes: true }); });
    await page.goto('/index.html');
    await expect(page.locator('#calendarLock #loginCard')).toBeVisible();
    await markThisPage(page);
    await signInThroughOverlay(page, 'G. Miller');
    await expect(page.locator('#calendarDisplay')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#calendarLock')).toHaveCount(0);
    const stored = await page.evaluate(() => localStorage.getItem('myb_admin_session'));
    expect(stored).toContain('G. Miller');
    expect(await stillThisPage(page), 'the sign-in reloaded the page').toBe(true);

    // What the reload used to rebuild: the menu, built at load for nobody, is now the member's…
    await page.locator('#navMenuBtn').click();
    await expect(page.locator('#navPanel')).toBeVisible();
    await expect(page.locator('#navPanelMember')).toHaveText('G. Miller');
    await expect(page.locator('#navSignOutBtn')).toBeVisible();
    await expect(page.locator('#navPanel .nav-panel-pill--operations')).toHaveCount(1);
    await expect(page.locator('#navPanel')).toHaveCount(1);
    await page.keyboard.press('Escape');
    // …and the name picker is built for them, on their own roster.
    await expect(page.locator('#teamMemberSelect')).toHaveValue(/\d+/);
    expect(await page.locator('#teamMemberSelect option:checked').textContent()).toContain('G. Miller');
    // …and Back to this page later is no reason to reload it: the Back guard (page-session.js) was
    // told the page is theirs now. The browser's own leave-and-restore pair, fired as it fires them.
    await page.evaluate(() => {
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await page.waitForTimeout(500);
    expect(await stillThisPage(page).catch(() => false), 'a restore of the member\'s own page was reloaded').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
});

test('the member\'s come-back card signs them in in place too, and the full-screen form goes', async ({ page }) => {
    // A session whose identity did not restore: the silent attempt fails, the come-back card offers
    // the full-screen form, and the typed sign-in succeeds. A restore landing under the form waits for
    // it (calendar-access.js → `watchForLateNamedIdentity`), and its success grants without a reload.
    await seedSession(page, 'G. Miller');
    await seedMember(page, 'G. Miller');
    await page.addInitScript(() => { window.__E2E = Object.assign(window.__E2E || {}, { failSignIn: true }); });
    await page.goto('/index.html');
    const signIn = page.locator('#calLockSubmit');
    await expect(signIn).toBeEnabled({ timeout: 20_000 });
    await markThisPage(page);
    // From here a sign-in succeeds, as a typed one does for a member who knows their password.
    await page.evaluate(() => { const e = /** @type {any} */ (window).__E2E; e.failSignIn = false; e.signInEstablishes = true; });
    await signIn.click();
    await expect(page.locator('#loginOverlay')).toBeVisible();
    await page.locator('#loginPassword').fill('miller');
    await page.locator('#loginSubmit').click();
    await expect(page.locator('#calendarDisplay')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#loginOverlay'), 'the form stayed over the Calendar its own sign-in opened').toHaveCount(0);
    await expect(page.locator('#calendarLock')).toHaveCount(0);
    expect(await stillThisPage(page), 'the sign-in reloaded the page').toBe(true);
});

test('a member whose access lapsed, then signs in, still RELOADS — the Calendar was built for the first grant', async ({ page }) => {
    // The fallback, kept on purpose (`finishSignIn`): a page granted once holds a Calendar built for that
    // grant, and the sign-in hands the member a fresh one rather than repainting the old. (Until the
    // staff PIN was retired this was a PIN viewer's lapse; a member's is the only one left.)
    await seedMemberSession(page, 'G. Miller');
    await page.addInitScript(() => { window.__E2E = Object.assign(window.__E2E || {}, { signInEstablishes: true }); });
    await page.goto('/index.html');
    await expect(page.locator('#calendarDisplay')).toBeVisible();
    await page.evaluate(async () => { (await import('./calendar-access.js')).handleAccessLost(); });
    await expect(page.locator('#calLockWho')).toContainText('G. Miller');
    await markThisPage(page);
    await page.locator('#calLockSubmit').click();
    await expect(page.locator('#loginPassword')).toBeVisible();
    await page.locator('#loginPassword').fill('miller');
    await page.locator('#loginSubmit').click();
    await expect.poll(() => stillThisPage(page).catch(() => false), { message: 'the page was not reloaded', timeout: 20_000 }).toBe(false);
    await expect(page.locator('#calendarDisplay')).toBeVisible({ timeout: 20_000 });
});
test('`#staff-pin` is an ordinary address now: the sign-in card, and nothing else', async ({ page }) => {
    // It was the PIN card's own route — a station PC's bookmark, and the way back from a page that
    // ended the PIN. Retired with the PIN (23 Nov 2026): a bookmark still carrying it must open the
    // front door like any other visit, with no PIN box, no link to one, and no line about it.
    const errors = collectFatalErrors(page);
    await page.goto('/index.html#staff-pin');
    await expect(page.locator('#calendarLock #loginCard')).toBeVisible();
    await expect(page.locator('#loginNameTrigger')).toBeVisible();
    await expect(page.locator('#calLockPin')).toHaveCount(0);
    await expect(page.locator('input[inputmode="numeric"]'), 'a PIN box by any other id').toHaveCount(0);
    await expect(page.locator('#loginAlternative')).toHaveCount(0);
    await expect(page.locator('#loginNotice'), 'nobody held the PIN in this browser').toBeEmpty();
    await expect(page.locator('#calendarDisplay')).toBeHidden();
    expect(errors, errors.join('\n')).toEqual([]);
});
test('the Calendar\'s own sign-in card offers no "Back to roster": the roster is this page', async ({ page }) => {
    // The retired PIN's button held this slot, so the form's default link never showed here. Without
    // it, "← Back to roster" pointed at the page it sat on and only reloaded the same card (found in
    // #1838's visual baselines). Other pages keep the link; the guard on that side is Admin's below.
    await page.goto('/index.html');
    await expect(page.locator('#calendarLock #loginCard')).toBeVisible();
    await expect(page.locator('#loginCard .login-back')).toBeHidden();
    await expect(page.getByText('Back to roster')).toBeHidden();
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

// ── THE DOCUMENTS ARE BEHIND THE GATE TOO (v23.17, owner decision 7 Sep 2026) ───────────────────
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
    await expect(page.locator('#huddleViewerBody')).toContainText('Sign in to read the Daily Huddle');
    await expect(page.locator('#huddleViewer')).toHaveClass(/open/);
    expect(await docReads(page), 'the tap itself issued nothing').toBe(before);
    // ABSOLUTE, not a delta: the first cut compared before/after the tap, and a listener attached
    // at page LOAD sat inside the baseline — the mutation that removed the guard passed. A locked
    // Calendar attaches no Huddle listener at any point, because the local cache would answer it.
    expect(await page.evaluate(() => (/** @type {any} */ (window).__E2E || {}).snapshotSubs || 0),
        'no Huddle listener may ever attach on a locked Calendar').toBe(0);
});

test('locked: a Circular deep link says what to do, and issues NO read', async ({ page }) => {
    await page.goto('/index.html#circular');
    await expect(page.locator('#calendarLock')).toBeVisible();
    await expect(page.locator('#docViewer')).toBeVisible();
    // PROMPTLY, not eventually: the viewer waits for the access decision before calling itself
    // locked, and the lock card being up means that decision is made. Left to the default timeout this
    // also passed on the viewer's own 8s fallback, i.e. with the decision never wired to it at all.
    await expect(page.locator('#docViewerBody')).toContainText('Sign in to read the Weekly Retail Circular', { timeout: 3000 });
    expect(await docReads(page), 'a locked Calendar read the Circular').toBe(0);
    // (Finishing the held link is the sign-in's job now: the next test. Until 23 Nov 2026 the staff
    // PIN finished it here too.)
});
// ── …AND BY A SIGN-IN (whole-app review, 10 Nov 2026) ───────────────────────────────────────────
// Both sign-ins on the locked Calendar used to end in a reload, and the tap had been consumed long
// before, so "Sign in to read it" was not true of a sign-in. Since v26.40 a sign-in on a
// never-granted page grants IN PLACE, and the grant opens the held tap; a sign-in that
// still reloads (`finishSignIn`'s fallback) carries it across (`pagehide`, calendar-doc-viewer.js and
// calendar-huddle-viewer.js). These two are the in-place half, and say so.
test('locked: a Circular deep link is FINISHED by a sign-in — in place', async ({ page }) => {
    await page.addInitScript(() => { window.__E2E = Object.assign(window.__E2E || {}, { signInEstablishes: true }); });
    await page.goto('/index.html#circular');
    await expect(page.locator('#calendarLock #loginCard')).toBeVisible();
    await expect(page.locator('#docViewerBody')).toContainText('Sign in to read the Weekly Retail Circular', { timeout: 3000 });
    await page.locator('#docViewerClose').click();
    await expect(page.locator('#docViewer')).toBeHidden();
    await markThisPage(page);
    await signInThroughOverlay(page, 'G. Miller');
    await expect(page.locator('#calendarDisplay')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#docViewerBody'), 'the member signed in, and the document they tapped for never came')
        .toContainText('No Weekly Retail Circular has been uploaded yet', { timeout: 10_000 });
    expect(await stillThisPage(page), 'finished by a reload, not in place').toBe(true);
});

test('locked: a Daily Huddle tap is FINISHED by a sign-in', async ({ page }) => {
    const stored = 'https://firebasestorage.googleapis.com/v0/b/myb-roster.appspot.com/o/huddles%2F2026-09-25.pdf?alt=media&token=e2e';
    await page.addInitScript((s) => {
        window.__E2E = Object.assign(window.__E2E || {}, { signInEstablishes: true,
            huddleDoc: { date: '2026-09-25', storageUrl: s, fileType: 'pdf' } });
    }, stored);
    await page.goto('/');
    await expect(page.locator('#calendarLock #loginCard')).toBeVisible();
    await page.locator('#navMenuBtn').click();
    await page.locator('#navPanel a[href="./#huddle"]').click();
    await expect(page.locator('#huddleViewerBody')).toContainText('Sign in to read the Daily Huddle');
    await page.locator('#huddleViewerClose').click();
    await expect(page.locator('#huddleViewer')).not.toHaveClass(/visible/);
    await markThisPage(page);
    await signInThroughOverlay(page, 'G. Miller');
    await expect(page.locator('#calendarDisplay')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#huddleOpenFileBtn'), 'the member signed in, and the Huddle they tapped for never came')
        .toBeVisible({ timeout: 10_000 });
    expect(await stillThisPage(page), 'finished by a reload, not in place').toBe(true);
});

// The Newsletter's ☰ button follows its latest issue (newsletter-recency.js, owner, 14 Nov 2026), and the
// Calendar asks for it as its documents open. Locked, they are shut: nothing is asked, and the menu offers
// what this device last knew — tapped, it is answered as the other two are.
test('locked: the Newsletter check asks nothing, and the menu offers what this device last knew', async ({ page }) => {
    await withKnownNewsletter(page, isoDaysAgo(3));
    await withServerNewsletter(page, isoDaysAgo(60));   // would hide it, were it asked
    await page.goto('/');
    await expect(page.locator('#calendarLock')).toBeVisible();
    await page.locator('#navMenuBtn').click();
    const row = page.locator('#navPanel .nav-panel-link--newsletter');
    await expect(row).toBeVisible();
    // ABSOLUTE: a locked Calendar reads nothing at all, so one read here is the check going through the lock.
    expect(await docReads(page), 'the locked Calendar asked for the Newsletter').toBe(0);
    expect(await page.evaluate((k) => localStorage.getItem(k), NEWSLETTER_LATEST_KEY)).toBe(isoDaysAgo(3));
    await row.click();
    await expect(page.locator('#navComingSoonLightbox')).toContainText('Sign in to read the Marylebone Newsletter.');
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
    await expect(page.locator('#navComingSoonLightbox')).toContainText('Sign in to read the Weekly Retail Circular.');
    // READ OUT, not only shown (lightbox review R1-7): focus goes to the ✕, so a screen reader heard the panel's name
    // and "Close, button", never why the tap was refused. The message is the dialog's description.
    await expect(page.locator('#navComingSoonLightbox')).toHaveAccessibleDescription(/Sign in to read the Weekly Retail Circular/);
    expect(await docReads(page)).toBe(before);
    expect(popups.length, 'no blank tab is opened for a read that will not happen').toBe(0);
});

test('a public guide loads with no member sign-in', async ({ page }) => {
    await page.goto('/railcard-guide.html');
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('#calendarLock')).toHaveCount(0);
});

// ── THE MENU CAN BE REBUILT FOR WHOEVER SIGNS IN ("sign-in without the reload", step 1) ───────────
// A sign-in on the locked Calendar now grants in place, so nothing reloads to rebuild the menu: without
// calendar-drawer.js's rebuild the member would get the locked visitor's — no name, no Sign out, no
// admin pills. The front-door test above proves the whole sign-in; this drives the rebuild on its own,
// through the page's OWN copy of the module (the import resolves to the instance the page wired).

test('the locked Calendar\'s menu, rebuilt in place after a sign-in, is the member\'s — once, and it still works', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.goto('/index.html');
    await expect(page.locator('#calendarLock #loginCard')).toBeVisible();

    // The premise: the menu was built for nobody.
    await page.locator('#navMenuBtn').click();
    await expect(page.locator('#navPanel')).toBeVisible();
    await expect(page.locator('#navSignOutBtn')).toHaveCount(0);
    await expect(page.locator('#navPanel .nav-panel-pill--operations')).toHaveCount(0);
    await page.locator('#navPanelClose').click();
    await expect(page.locator('#navPanel')).not.toHaveClass(/open/);

    // A sign-in saves the session; then the rebuild step 2 will call.
    const rebuilt = await page.evaluate(async () => {
        localStorage.setItem('myb_admin_session', JSON.stringify({ name: 'G. Miller', ver: 2, expiry: Date.now() + 86_400_000 }));
        const m = await import('./calendar-drawer.js');
        return m.rewireCalendarDrawer();
    });
    expect(rebuilt).toBe(true);

    await expect(page.locator('#navPanel')).toHaveCount(1);          // taken down first: never two drawers
    await expect(page.locator('#navMenuBtn')).toHaveCount(1);
    await page.locator('#navMenuBtn').click();                        // the fresh burger opens the fresh drawer
    await expect(page.locator('#navPanel')).toBeVisible();
    await expect(page.locator('#navPanelMember')).toHaveText('G. Miller');
    await expect(page.locator('#navPanelAvatar')).toHaveText('GM');
    await expect(page.locator('#navSignOutBtn')).toBeVisible();
    await expect(page.locator('#navPanel .nav-panel-pill--operations')).toHaveCount(1);
    await page.keyboard.press('Escape');                              // and it still closes
    await expect(page.locator('#navPanel')).not.toHaveClass(/open/);
    expect(errors, errors.join('\n')).toEqual([]);
});

// ── Access lost mid-session ─────────────────────────────────────────────────────────────────────

test('access lost mid-session: re-lock says why, on the member\'s own card, with the grid off screen', async ({ page }) => {
    // Revoked tokens look like this: every FRESH read comes back permission-denied. Until the staff PIN
    // was retired (23 Nov 2026) the PIN rotation sent every open station here and the same PIN card
    // re-unlocked in place; a member's way back is their own sign-in, which reloads (the test above).
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/index.html');
    await expect(page.locator('.calendar-day').first()).toBeVisible();

    // The boot window is already claimed, so navigate beyond it to force a fresh read.
    await page.evaluate(() => { (window.__E2E = window.__E2E || {}).failGetDocs = 'permission-denied'; });
    await page.locator('#nextMonth').click();
    await page.locator('#nextMonth').click();

    // Re-locked, and it says WHY — an expired session is not a network blip, and the generic
    // "couldn't update, try again" here would be a loop the member cannot win.
    await expect(page.locator('#calendarLock')).toBeVisible();
    await expect(page.locator('#calLockWho')).toContainText('G. Miller');
    await expect(page.locator('#calLockWhy')).toContainText(/expired/i);
    await expect(page.locator('#calendarDisplay')).toBeHidden();
    await expect(page.locator('#calLockPin')).toHaveCount(0);
});
// A RE-LOCK TAKES THE GRID OFF THE PAGE, NOT ONLY OUT OF SIGHT (18 Nov 2026). Before the first grant
// nothing is built; after one, a re-lock hid the workspace and left what the grant drew in
// #calendarDisplay — every day of the month, or every row of the Team View week, in the page behind
// the card, for a screen reader, a devtools pane or one CSS rule going missing. Emptied on the loss.
// Both surfaces, because Team View draws into the same element.
// ONE-SHOT, read as the card arrives: the loss empties the grid before the card goes up, and nothing
// redraws it while locked, so an auto-retrying assertion would add nothing but a way to pass late.
for (const surface of /** @type {const} */ (['month', 'Team View'])) {
    test(`a re-lock empties the ${surface} grid behind the card`, async ({ page }) => {
        await page.clock.setFixedTime(new Date('2026-09-16T09:00:00Z'));   // the first read: Aug–Oct
        await seedMemberSession(page, 'G. Miller');
        await page.goto('/index.html');
        await expect(page.locator('.calendar-day').first()).toBeVisible();
        if (surface === 'month') {
            await page.locator('#nextMonth').click();   // October: the first read's, so nothing is read
        } else {
            await page.locator('#teamViewBtn').click();
            for (let i = 0; i < 6; i++) await page.locator('#tvNextWeek').click();
            await expect(page.locator('#tvWeekJump'), 'premise: the last week the first read holds').toHaveText('25–31 Oct 2026');
        }
        // From here every read is refused, as revoked tokens are. One step on reaches November, which is read.
        await page.evaluate(() => { (window.__E2E = window.__E2E || {}).failGetDocs = 'permission-denied'; });
        await page.locator(surface === 'month' ? '#nextMonth' : '#tvNextWeek').click();
        await expect(page.locator('#calendarLock')).toBeVisible();
        expect(await page.locator('#calendarDisplay').evaluate(el => el.childElementCount),
            'what the grant drew stayed in the page behind the card').toBe(0);
    });
}

test('a day panel open when access is lost closes with it — it does not stay over the lock card (sign-in check, 11 Nov 2026)', async ({ page }) => {
    // The panel shows what only access may show, and until v25.77 the lock card went up UNDERNEATH it.
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/index.html');
    await page.locator('.calendar-day:not(.other-month)').first().click();
    await expect(page.locator('#dayDetailLightbox')).toHaveClass(/visible/);

    // The month arrows are behind the open panel, so the loss is delivered the way a refused read
    // delivers it: through the one call every route that loses access makes.
    await page.evaluate(async () => {
        const m = await import('./calendar-access.js');
        m.handleAccessLost();
    });
    await expect(page.locator('#calendarLock')).toBeVisible();
    await expect(page.locator('#dayDetailLightbox')).not.toHaveClass(/visible/);
});

test('the month picker open when access is lost closes with it, and cannot move the month behind the lock card (17 Nov 2026)', async ({ page }) => {
    // The day and leave panels closed on a lost grant; the month picker stayed open over the lock card,
    // and "Go to month" moved and PERSISTED the month behind it, so the member signed back in to a month
    // they had not chosen. The keyboard already refused there; the picker now does too.
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/index.html');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.locator('.month-year').click();
    await expect(page.locator('#monthJumpOverlay')).toHaveClass(/visible/);
    const stored = () => page.evaluate(() => localStorage.getItem('myb_roster_month'));
    const before = await stored();

    await page.evaluate(async () => {
        const m = await import('./calendar-access.js');
        m.handleAccessLost();
    });
    await expect(page.locator('#calendarLock')).toBeVisible();
    await expect(page.locator('#monthJumpOverlay'), 'the picker stayed open over the lock card').not.toHaveClass(/visible/);

    // A confirm that arrives anyway — a tap already on its way — moves nothing.
    await page.evaluate(() => {
        const sel = /** @type {HTMLSelectElement} */ (document.getElementById('monthJumpMonth'));
        sel.value = String((Number(sel.value) + 3) % 12);
        document.getElementById('monthJumpConfirm')?.click();
    });
    expect(await stored(), 'a month was moved and kept behind the lock card').toBe(before);
});

// ── ONE LOSS SHUTS BOTH GATES, BY EITHER ROUTE (Calendar step 2, v25.74) ─────────────────────────
// Whether access is held is kept once (calendar-access-state.js), and the roster reads and the three
// documents both ask it. Until v25.74 each kept a flag of its own and the page shut them one after
// the other, separately on each of the two routes that notice a loss. Walked on a real page, one
// route each, because only a page shows the coordinator handing BOTH routes to the one call — and
// the documents are how a browser can see a gate left open behind the card.
test('a re-lock by a MONTH read shuts the documents too — a Huddle tap behind the card reads nothing', async ({ page }) => {
    const stored = 'https://firebasestorage.googleapis.com/v0/b/myb-roster.appspot.com/o/huddles%2F2026-09-25.pdf?alt=media&token=e2e';
    await page.addInitScript((s) => {
        window.__E2E = Object.assign(window.__E2E || {}, { huddleDoc: { date: '2026-09-25', storageUrl: s, fileType: 'pdf' } });
    }, stored);
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/');   // '/', so the drawer's `./#huddle` is a hash change (see the locked Huddle test above)
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    const listeners = () => page.evaluate(() => (/** @type {any} */ (window).__E2E || {}).snapshotSubs || 0);
    await expect.poll(listeners, 'premise: the grant opened the documents, so the Huddle is listened for').toBe(1);

    await page.evaluate(() => { /** @type {any} */ (window).__E2E.failGetDocs = 'permission-denied'; });
    await page.locator('#nextMonth').click();
    await page.locator('#nextMonth').click();
    await expect(page.locator('#calendarLock')).toBeVisible();

    // Behind the card. Reads would SUCCEED again from here, so "nothing was read" is the gate's doing.
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.failGetDocs = false; });
    const before = await docReads(page);
    await page.locator('#navMenuBtn').click();
    await page.locator('#navPanel a[href="./#huddle"]').click();
    await expect(page.locator('#huddleViewerBody')).toContainText('Sign in to read the Daily Huddle');
    expect(await docReads(page), 'a re-locked Calendar read or listened for a document').toBe(before);
    expect(await listeners(), 'a re-locked Calendar attached a second Huddle listener').toBe(1);
});
// The other route: the FIRST LOAD's own read. A sign-in that was good a moment ago and a first read that
// is refused all the same — the tokens were revoked between the two — so the grant is
// lost before anything was drawn. This route calls the access layer DIRECTLY: nothing has shut the
// state for it, as calendar-overrides.js has for a month read, so it is the one that shows
// `handleAccessLost` shutting the state itself before its card goes up.
//
// (Until the staff PIN was retired this ran a second time ON A FIRST VISIT, no name chosen, where the
// first load is the only read — the case that could tell this route's wiring from its absence. A
// signed-in member always has a calendar to draw (their own), so that state is gone here; the route's
// wiring is held by calendar-access.test.mjs.)
test('the FIRST load\'s read refused: the Calendar re-locks, and the documents shut with it', async ({ page }) => {
    await seedMemberSession(page, 'G. Miller');
    await page.addInitScript(() => { window.__E2E = Object.assign(window.__E2E || {}, { failGetDocs: 'permission-denied' }); });
    await page.goto('/index.html');
    await expect(page.locator('#calLockWhy')).toContainText(/expired/i);
    await expect(page.locator('#calendarLock')).toBeVisible();
    await expect(page.locator('#calendarDisplay')).toBeHidden();

    // Behind the card, with reads working again: a Circular link is answered with what to do, and
    // issues nothing. Left open, the documents gate would read it here — from this device's saved
    // copy too, which no server rule is asked about.
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.failGetDocs = false; });
    const before = await docReads(page);
    await page.evaluate(() => { window.location.hash = '#circular'; });
    await expect(page.locator('#docViewerBody')).toContainText('Sign in to read the Weekly Retail Circular', { timeout: 3000 });
    expect(await docReads(page), 'a re-locked Calendar read a document').toBe(before);
});

// Whole-app review, Oct 2026: after a re-lock the grid is behind the card, and the arrow keys still
// moved — and persisted — the month there, so the next unlock opened on a different one.
test('re-locked mid-session: the keyboard does not move the month behind the card', async ({ page }) => {
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/index.html');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.evaluate(() => { (window.__E2E = window.__E2E || {}).failGetDocs = 'permission-denied'; });
    await page.locator('#nextMonth').click();
    await page.locator('#nextMonth').click();
    await expect(page.locator('#calendarLock')).toBeVisible();

    const viewed = () => page.evaluate(() => [localStorage.getItem('myb_roster_month'), localStorage.getItem('myb_roster_year')]);
    const before = await viewed();
    await page.evaluate(() => /** @type {HTMLElement|null} */ (document.activeElement)?.blur());   // off the card's button
    for (const key of ['ArrowRight', 'ArrowRight', 'ArrowLeft', 't']) await page.keyboard.press(key);
    expect(await viewed()).toEqual(before);
});

// A re-lock takes down what the grant put up (whole-app review, Nov 2026). The two offer strips and
// the swipe hint are shown with an INLINE `display`, which beats the browser's own `[hidden]`, so the
// `hidden` the gate sets (calendar-access.js) needs index.css's `!important` id rule to win: without
// it a strip stayed on screen above the sign-in card. Put up here exactly as their modules do, at a
// phone's width (from 1024px the strips do not show at all).
test('a re-lock takes the offer strips and the swipe hint down with the rest of the workspace', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 800 });
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/index.html');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    const ids = ['notifPrompt', 'installPrompt', 'swipeHint'];
    await page.evaluate((list) => {
        for (const id of list) /** @type {HTMLElement} */ (document.getElementById(id)).style.display = id === 'swipeHint' ? 'block' : 'flex';
    }, ids);
    for (const id of ids) await expect(page.locator(`#${id}`), `premise: #${id} is up`).toBeVisible();

    await page.evaluate(() => { (window.__E2E = window.__E2E || {}).failGetDocs = 'permission-denied'; });
    await page.locator('#nextMonth').click();
    await page.locator('#nextMonth').click();
    await expect(page.locator('#calendarLock')).toBeVisible();
    // ONE-SHOT, read as the card arrives: an auto-retrying toBeHidden() waited out the hint's own
    // fade timer and passed with its rule deleted (measured).
    const left = await page.evaluate((list) => list.filter((id) => {
        const el = /** @type {HTMLElement} */ (document.getElementById(id));
        return getComputedStyle(el).display !== 'none' || el.getBoundingClientRect().height > 0;
    }), ids);
    expect(left, 'left on screen above the sign-in card').toEqual([]);
});

// Whole-app review, Oct 2026: the one-time swipe hint started its 6s timer on a LOCKED Calendar, where
// it is hidden with the workspace, and marked itself seen — used up on nothing.
test('a first visit that begins locked does not use up the swipe hint', async ({ page }, info) => {
    test.skip(!isTouchProject(info), 'the hint is touch-only');
    test.setTimeout(30_000);
    await page.goto('/index.html');
    await expect(page.locator('#calendarLock')).toBeVisible();
    await page.waitForTimeout(6_500);
    expect(await page.evaluate(() => localStorage.getItem('myb_swipe_hint_seen'))).toBeNull();
});

// ── A member is not interrupted ─────────────────────────────────────────────────────────────────

test('a signed-in member never sees a lock card', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/index.html');
    await expect(page.locator('#calendarDisplay')).toBeVisible();
    await expect(page.locator('#calendarLock')).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('a member does not even FLASH a lock card', async ({ page }) => {
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

// ── A member is never left at a sign-in they do not need (v20.79) ───────────────────────────────
//
// The reported symptom was "the PIN occasionally comes up for people who are already signed in", and
// it is TWO faults sharing one screen. `decideAccess` needs a local session AND a restored Firebase
// identity; a member can be missing the second for two quite different reasons:
//
//   · the restore is merely SLOW and lands after `resolveAccess`'s bound (rare, and it was a cliff —
//     the decision was made once and never revisited, so a reload was the only way out); or
//   · the identity is GONE while the local session (60 days) is not — an IndexedDB read that fails
//     on iOS is the likelier route (KNOWN_LIMITATIONS → "One interaction to expect on iOS"; it is
//     not Safari's seven-day rule, which deletes both together). That one is not a race at all: it
//     fails every single load.
//
// Neither was reachable by a test until `authRestoreDelayMs` existed, because the Firebase stub
// handed every caller a user synchronously — no restore budget in the app had ever been exercised.

test('a member whose identity restores LATE is let in', async ({ page }) => {
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
    await expect(page.locator('#calendarLock')).toHaveCount(0);
});

test('an EVICTED identity signs the member back in silently, with no sign-in card', async ({ page }) => {
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
    await expect(page.locator('#calendarLock')).toHaveCount(0);
});

test('a MIGRATED member whose identity is gone is offered their own sign-in', async ({ page }) => {
    // The silent route only tries the surname, so a member who has chosen their own password cannot
    // be recovered without them. They get their OWN sign-in. (Until 23 Nov 2026 the staff PIN sat
    // under it, as a way out for the next person at a shared PC; it went with the PIN.)
    await seedSession(page, 'G. Miller');
    await seedMember(page, 'G. Miller');
    await page.addInitScript(() => { window.__E2E = Object.assign(window.__E2E || {}, { failSignIn: true }); });
    await page.goto('/index.html');

    await expect(page.locator('#calendarLock')).toBeVisible();
    await expect(page.locator('#calLockWho')).toContainText('G. Miller');
    await expect(page.locator('#calLockPin')).toHaveCount(0);
    await expect(page.locator('#calLockPinInstead'), 'the member card\'s way to the PIN went with it').toHaveCount(0);
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

// ── A LEFTOVER STAFF-PIN SESSION (the PIN retired, owner, 23 Nov 2026) ─────────────────────────────
//
// A browser that opened the Calendar with the PIN before it was retired can still hold its session —
// the shared `calendar-viewer` identity, kept in sessionStorage. Every page signs it out on arrival
// (session.js → `reconcileExpiredIdentity`, which no page asks to keep it any more), and the card says
// why in ONE line (staff-pin-ended.js). Silent, a station that used the code yesterday would meet a
// sign-in today with nothing to say what changed.

/** Whether this tab still holds the leftover PIN session (the stub keeps it in sessionStorage). */
const holdsViewer = (/** @type {import('@playwright/test').Page} */ page) =>
    page.evaluate(() => sessionStorage.getItem('__e2e_viewer'));

test('a leftover PIN session on the Calendar is signed out on load: the sign-in card, the retired line, and no PIN box', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedLegacyViewerSession(page);
    await seedMember(page);   // a calendar chosen on this machine before — no roster for it either
    await recordFirstFrameText(page, '#loginNotice');
    await page.goto('/index.html');

    await expect(page.locator('#calendarLock #loginCard')).toBeVisible();
    await expect(page.locator('#loginNotice')).toHaveText(STAFF_PIN_ENDED_NOTICE);
    // SIGNED OUT, not merely refused: the identity itself is gone, so no later page meets it.
    await expect.poll(() => holdsViewer(page), { message: 'the leftover PIN session survived the load' }).toBeNull();
    expect(await page.evaluate(() => /** @type {any} */ (window).__E2E.signOutCount || 0), 'the teardown never signed out').toBeGreaterThan(0);
    // Spoken, not only shown: the line arrived after the card was drawn (`speakAfterMount`).
    const atFirstFrame = await firstFrameText(page, '#loginNotice');
    expect(atFirstFrame.length, 'premise: the card\'s notice line was seen arriving').toBeGreaterThan(0);
    expect(atFirstFrame.filter(Boolean), 'the line was already in the card at its first frame, so it was never announced').toEqual([]);
    // Nothing of the PIN is left to type into or to tap.
    await expect(page.locator('#calLockPin')).toHaveCount(0);
    await expect(page.locator('input[inputmode="numeric"]'), 'a PIN box by any other id').toHaveCount(0);
    await expect(page.locator('#loginAlternative')).toHaveCount(0);
    await expect(page.locator('#calLockPinInstead')).toHaveCount(0);
    // …and no roster: the viewer it held used to open one.
    await expect(page.locator('#calendarDisplay')).toBeHidden();
    expect(await page.locator('#calendarDisplay').innerHTML()).toBe('');
    expect(await page.locator('#teamMemberSelect option').count()).toBe(0);
    // The drawer is a locked visitor's: no footer, so no End staff PIN and no bell.
    await page.locator('#navMenuBtn').click();
    await expect(page.locator('#navPanel')).toBeVisible();
    await expect(page.locator('.nav-panel-footer')).toBeHidden();
    await expect(page.locator('#navLockCalendarBtn')).toHaveCount(0);
    await page.keyboard.press('Escape');

    // A reload does not bring it back, and is not told twice: the session has gone.
    await page.reload();
    await expect(page.locator('#calendarLock #loginCard')).toBeVisible();
    await page.waitForTimeout(1000);   // the teardown lands in well under that when there is one
    await expect(page.locator('#loginNotice'), 'the line outlived the session it was about').toBeEmpty();
    expect(errors, errors.join('\n')).toEqual([]);
});

test('a leftover PIN session that restores LATE is still signed out — never granted', async ({ page }) => {
    // The late-identity watcher grants only a NAMED identity now (calendar-access.js); until the PIN
    // was retired it granted a late viewer too, which is the cliff this guards against coming back.
    // 7.5s: past the access decision's 6.5s budget (so the front door is already up when the session
    // lands, and the watcher hears it), inside the teardown's own 8s restore wait (so the teardown does
    // too). A restore later than THAT is not torn down on this load — it is still never granted, and
    // the next load's teardown takes it.
    test.setTimeout(60_000);
    await seedLegacyViewerSession(page);
    await page.addInitScript(() => { window.__E2E = Object.assign(window.__E2E || {}, { authRestoreDelayMs: 7500 }); });
    await page.goto('/index.html');
    await expect(page.locator('#calendarLock #loginCard')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#loginNotice')).toHaveText(STAFF_PIN_ENDED_NOTICE, { timeout: 15_000 });
    await expect.poll(() => holdsViewer(page)).toBeNull();
    await page.waitForTimeout(1000);   // a grant from the watcher would have landed by now
    await expect(page.locator('#calendarDisplay')).toBeHidden();
    await expect(page.locator('#calendarLock #loginCard')).toBeVisible();
});

test('a member who signs in on that card is not told about the PIN again', async ({ page }) => {
    // The line is old news once a member signs in on the page (`forgetStaffPinEnded`).
    await seedLegacyViewerSession(page);
    await page.addInitScript(() => { window.__E2E = Object.assign(window.__E2E || {}, { signInEstablishes: true }); });
    await page.goto('/index.html');
    await expect(page.locator('#loginNotice')).toHaveText(STAFF_PIN_ENDED_NOTICE);
    await signInThroughOverlay(page, 'G. Miller');
    await expect(page.locator('#calendarDisplay')).toBeVisible({ timeout: 20_000 });
    await page.evaluate(async () => { (await import('./calendar-access.js')).handleAccessLost(); });
    await expect(page.locator('#calLockWhy')).toContainText(/expired/i);
    await expect(page.getByText(STAFF_PIN_ENDED_NOTICE)).toHaveCount(0);
});

// The PROTECTED pages never admitted the PIN, and sign it out on arrival exactly as the Calendar now
// does — and say the same line. (Until 23 Nov 2026 they said the PIN only opened the Calendar and
// Trains, and their way back opened the PIN box.) Both ways back are covered, one per page: the link
// (Admin) and Escape (Pay), which follows wherever the link goes — to the roster's front door.
for (const [label, url, way] of [['Admin', '/admin.html', 'link'], ['Pay', '/paycalc.html', 'Escape']]) {
    test(`a leftover PIN session arriving at ${label} is signed out and told the PIN has been retired; the way back (${way}) is the roster`, async ({ page }) => {
        const errors = collectFatalErrors(page);
        await seedLegacyViewerSession(page);
        await recordFirstFrameText(page, '#loginNotice');
        await page.goto(url);
        await expect(page.locator('#loginOverlay')).toBeVisible();
        await expect(page.locator('#loginNotice')).toHaveText(STAFF_PIN_ENDED_NOTICE);
        const atFirstFrame = await firstFrameText(page, '#loginNotice');
        expect(atFirstFrame.length, 'premise: the card\'s notice line was seen arriving').toBeGreaterThan(0);
        expect(atFirstFrame.filter(Boolean), 'the notice was already in the card at its first frame, so it was never announced').toEqual([]);
        await expect.poll(() => holdsViewer(page), { message: 'the leftover PIN session survived the page' }).toBeNull();
        await expect(page.locator('#loginCard a.login-back')).toHaveAttribute('href', './');

        if (way === 'link') await page.locator('#loginCard a.login-back').click();
        else await page.locator('#loginPassword').press('Escape');
        await expect(page.locator('#calendarLock #loginCard')).toBeVisible();
        await expect(page.locator('#calLockPin')).toHaveCount(0);
        expect(errors, errors.join('\n')).toEqual([]);
    });
}

// PAUSED OVERTIME SAYS IT TOO (audit C1; AUTH_AND_SESSIONS 24 — the sign-out is never silent). Paused, the
// page signs the leftover session out like every page, but offers no sign-in, so it says the card's
// sentence itself, with the way back. Its own `overtimeEnabled` seam holds it paused whichever way the
// committed switch sits.
test('a leftover PIN session arriving at paused Overtime is told the PIN has been retired, with the way back to the roster', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), overtimeEnabled: false }; });
    await page.goto('/overtime.html');   // first, with no PIN session held: the guard on the other side
    await expect(page.locator('#otMineContent')).toContainText('Overtime availability is paused');
    await page.waitForTimeout(1000);     // the teardown that would fill it lands in well under that
    await expect(page.locator('#otMineContent [role="status"]')).toBeEmpty();

    await seedLegacyViewerSession(page);
    await recordFirstFrameText(page, '#otMineContent [role="status"]');
    await page.reload();
    await expect(page.locator('#otMineContent')).toContainText('Overtime availability is paused');
    const said = page.locator('#otMineContent [role="status"]');
    await expect(said).toContainText(STAFF_PIN_ENDED_NOTICE);
    // Spoken, not just shown: the region was drawn empty first (`speakAfterMount`, status-text.js).
    const atFirstFrame = await firstFrameText(page, '#otMineContent [role="status"]');
    expect(atFirstFrame.length, 'premise: the page\'s status region was seen arriving').toBeGreaterThan(0);
    expect(atFirstFrame.filter(Boolean), 'the line was already in the region at its first frame, so it was never announced').toEqual([]);
    await expect(said.locator('a')).toHaveAttribute('href', './');
    await said.locator('a').click();
    await expect(page.locator('#calendarLock #loginCard')).toBeVisible();
    expect(errors, errors.join('\n')).toEqual([]);
});

test('a visitor who never held the PIN is told nothing about it, and the way back is the roster', async ({ page }) => {
    // The guard on the line above's other side: a card that always said it would pass every test there.
    await page.goto('/admin.html');
    await expect(page.locator('#loginOverlay')).toBeVisible();
    // The teardown that would set the line waits for the boot restore; the leftover session's case
    // shows it in well under a second here, so two seconds of nothing is the answer, not a race.
    await page.waitForTimeout(2000);
    await expect(page.locator('#loginNotice')).toBeEmpty();
    await expect(page.locator('#loginCard a.login-back')).toHaveAttribute('href', './');
});

test("Admin's sign-in card says what Admin is for, and why you sign in as yourself — in Pay's words", async ({ page }) => {
    // The clause is shared on purpose: both pages keep things under a name, and are reached from one
    // menu (admin-app.js → ADMIN_SIGN_IN_ABOUT). If one card is reworded, this asks for the other to
    // follow. (Until 23 Nov 2026 it ended "— the staff PIN doesn’t open it".)
    const clause = 'under your own name, so you sign in as yourself.';
    for (const url of ['/admin.html', '/paycalc.html']) {
        await page.goto(url);
        await expect(page.locator('#loginAbout'), url).toContainText(clause);
        await expect(page.locator('#loginAbout'), url).not.toContainText('PIN');
    }
    await page.goto('/admin.html');
    await expect(page.locator('#loginAbout')).toContainText('Record your annual leave, absences and shift changes, so they show on the Calendar.');
    await expect(page.locator('#loginFootnote')).toHaveText('On a shared screen, sign out from the menu when you finish.');
});
// ── Accessibility + layout ──────────────────────────────────────────────────────────────────────

test('the card does not overflow at 360px, nor sprawl at 1440px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/index.html');
    await expect(page.locator('#calendarLock')).toBeVisible();
    const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    await page.setViewportSize({ width: 1440, height: 900 });
    // Compact on purpose — a wide centred panel is what a corporate login portal looks like.
    const w = await page.locator('#calendarLock #loginCard').evaluate(el => el.getBoundingClientRect().width);
    expect(w).toBeLessThanOrEqual(440);
});

// ── Regressions found by the v20.15 bug sweep ───────────────────────────────────────────────────

test('the nav drawer shows NO footer while the Calendar is locked', async ({ page }) => {
    // v20.12 widened the footer condition so the staff PIN's End button had somewhere to live, and a
    // locked visitor got an empty footer bar with a blank member name, and a NOTIFICATION BELL — a
    // control the push rules would refuse, offered. The PIN's button went with the PIN (23 Nov 2026);
    // the footer stays a signed-in member's.
    await page.goto('/index.html');
    await expect(page.locator('#calendarLock')).toBeVisible();
    await page.locator('#navMenuBtn').click();
    await expect(page.locator('#navPanel')).toBeVisible();
    await expect(page.locator('.nav-panel-footer')).toBeHidden();
    await expect(page.locator('#navNotifBell')).toHaveCount(0);
});

// ONE TAB NEVER LEAVES THE DRAWER FROM ITS SEARCH BOX (18 Nov 2026). The drawer's Tab trap counted links and buttons
// and not the guide search box, so here — a drawer with no footer — a search that matched nothing made the box the
// last stop Tab could reach, and one Tab from it walked out of the drawer onto the locked page behind.
test('locked: with the guide search matching nothing, Tab from its box stays in the drawer', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('#calendarLock')).toBeVisible();
    await page.locator('#navMenuBtn').click();
    await expect(page.locator('#navPanel')).toBeVisible();
    await expect(page.locator('.nav-panel-footer'), 'premise: a locked visitor\'s drawer has no footer').toBeHidden();
    const input = page.locator('#navGuideSearchInput');
    await input.click();                                         // the first focus loads the search
    await input.fill('zzzqxv');
    await expect(page.locator('#navGuideSearchStatus')).toHaveText('No matches in the guides — try a different word');
    await input.press('Tab');
    expect(await page.evaluate(() => !!document.getElementById('navPanel')?.contains(document.activeElement)),
        'one Tab from the box left the drawer').toBe(true);
    await page.keyboard.press('Shift+Tab');
    await expect(input, 'and Shift+Tab comes back round to it').toBeFocused();
});

// A SESSION WHOSE ACCOUNT HAS GONE GETS NO BELL (v25.06, whole-app review). The footer is there (the
// session is), but a subscription write would be refused by the rules — the tap used to subscribe the
// browser, fail, and flip the bell back to off with no word to say why.
test('a session whose account has gone keeps its footer — but gets no bell', async ({ page }) => {
    await seedSession(page, 'G. Miller');           // the local session only: no Firebase identity
    await page.goto('/index.html');
    await expect(page.locator('#calLockWho')).toContainText('G. Miller');   // the member card: auth has settled
    await page.locator('#navMenuBtn').click();
    await expect(page.locator('#navSignOutBtn')).toBeVisible();
    const pushCapable = await page.evaluate(() => 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window);
    test.skip(!pushCapable, 'no Web Push in this browser, so no bell either way');
    await expect(page.locator('#navNotifBell')).toBeHidden();
});

for (const pageUrl of ['/index.html', '/paycalc.html']) {
    test(`a slow sign-in restore hides the bell only until the restore lands (${pageUrl}, 48-hour review)`, async ({ page }) => {
        // The bell asks for the account after a 3s wait for the boot restore. A restore still running
        // then is not an account gone — but it read as one, and the bell stayed hidden until the drawer
        // was next opened, on exactly the poor signal where restores run long.
        await seedMemberSession(page, 'G. Miller');
        await page.addInitScript(() => { window.__E2E = Object.assign(window.__E2E || {}, { authRestoreDelayMs: 5000 }); });
        await page.goto(pageUrl);
        const pushCapable = await page.evaluate(() => 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window);
        test.skip(!pushCapable, 'no Web Push in this browser, so no bell either way');
        await page.locator('#navMenuBtn').click();          // early — the restore is still running
        // Past the bell's 3s check AND the 5s restore. Asserting at once passes on the broken code too:
        // the bell is drawn before its check runs, and the check is what hid it.
        await page.waitForTimeout(6500);
        await expect(page.locator('#navNotifBell')).toBeVisible();
    });
}

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
    if (pushCapable) await expect(page.locator('#navNotifBell'), 'a member with an account gets a working bell').toBeVisible();
    // Either way the footer is INTACT — which is what this test is guarding. A missing bell is a
    // capability the browser lacks; a missing name or sign-out would be a broken footer.
    await expect(page.locator('.nav-panel-footer')).toBeVisible();
});

// ── WHO THE NOTICES ARE ADDRESSED TO (v21.81) ───────────────────────────────────────────────────
//
// The one-time notices are members-only (calendar-access-core.js → `noticeAudienceAllows`, unit-tested
// there). Until the staff PIN was retired (23 Nov 2026) this block also proved a PIN-unlocked station
// was REFUSED a members' notice — the reported bug that made the audience gate. No unlock but a
// member's is left, so that half has no subject and went with the PIN; this is the wiring half: a
// member's real page does open one.
test.describe('one-time notices reach a signed-in member', () => {
    // Inside the timetable notice's FINAL WEEK (6–12 Dec 2026), where it has no second condition (the
    // install and New link notices it otherwise waits behind), or it silently retires and this would
    // pass by testing nothing.
    const IN_FINAL_WEEK = new Date('2026-12-07T09:00:00Z');

    test('a signed-in member gets a members\' notice', async ({ page }) => {
        const errors = collectFatalErrors(page);
        await page.clock.setFixedTime(IN_FINAL_WEEK);
        await seedSession(page);
        await seedMemberSession(page);
        await seedMember(page);
        await clearNoticeFlags(page, ['myb_notice_timetable_soon_2026_done']);
        await page.goto('/');
        await expect(page.locator('.month-year')).toBeVisible();
        await expect(page.locator('#timetableSoonNoticeLb')).toHaveClass(/open/);
        expect(errors, 'Uncaught JS exceptions on a member calendar').toHaveLength(0);
    });
});

// ── A SLOW IDENTITY RESTORE: NOTHING BEFORE IT, EVERYTHING AFTER IT ──────────────────────────────
//
// From v22.97 a returning member's own cached roster was painted WHILE their stored identity was
// revalidated (the "provisional paint"). It was retired on 26 Sep 2026 by owner decision —
// DECISIONS.md → "The provisional paint": the cache read it needed queues behind the same Auth
// start-up it was meant to overtake. What these pin now is the plain shape that replaced it, on a
// rendered page, because that is where its two defects would show: nothing roster-shaped before the
// confirmation, and after it a Calendar with every control live and the member-only steps run.
//
// `authRestoreDelayMs` is the lever: it holds the persisted-user restore open, which is the
// `accounts:lookup` wait. 5s is load-bearing — long enough to observe the wait, and inside
// `resolveAccess`'s own bound, so this exercises "slow" and not "timed out, then watcher".

test('a returning member sees NO roster while the identity is confirmed — then the grid, every control live', async ({ page }) => {
    test.setTimeout(60_000);
    await seedSession(page, 'G. Miller');
    await seedMember(page, 'G. Miller');
    await page.addInitScript(() => {
        window.__E2E = Object.assign(window.__E2E || {}, { authUser: true, authRestoreDelayMs: 5000 });
    });
    await page.goto('/index.html');

    // Inside the restore: the workspace stays hidden. Before 26 Sep 2026 this window held the paint.
    await page.waitForTimeout(2000);
    await expect(page.locator('#calendarDisplay')).toBeHidden();
    await expect(page.locator('#calLockPin')).toHaveCount(0);

    await expect(page.locator('#calendarDisplay')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#teamViewBtn')).toBeEnabled();
    await expect(page.locator('#teamMemberSelect')).toBeEnabled();
});

// ── THE MEMBER'S OWN STORED ROSTER, WHILE THE IDENTITY IS CONFIRMED (v24.59) ──────────────────────
//
// The app-owned copy DECISIONS.md named as the only shape that can beat the sign-in round trip
// (calendar-snapshot.js). Pinned on a rendered page because every rule that matters is about what is
// ON SCREEN, and for whom: shown at once and labelled, for the signed-in member only, never to a locked visitor,
// replaced by the live grid on the grant, and written by a settled live read.
const SNAPSHOT_KEY = 'myb_cal_snapshot';
// THE REAL MONTH, NOT A PINNED CLOCK: `authRestoreDelayMs` waits on Date.now() advancing, so a fixed
// clock never lets the identity restore. A weekday is chosen because leave is never shown on a Sunday.
const _now = new Date();
const SNAP_MONTH = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}`;
const SNAP_DAY = [2, 3, 4, 5, 6, 7, 8].find(d => new Date(_now.getFullYear(), _now.getMonth(), d).getDay() !== 0) ?? 2;
const SNAP_DATE = `${SNAP_MONTH}-${String(SNAP_DAY).padStart(2, '0')}`;
/** @param {import('@playwright/test').Page} page @param {string} member @param {Record<string, any>} days */
const seedSnapshot = (page, member, days) => page.addInitScript(([key, m, d, mk]) => {
    if (sessionStorage.getItem('__e2e_snapshot_seeded')) return;   // once: a reload must see what the app wrote
    sessionStorage.setItem('__e2e_snapshot_seeded', '1');
    localStorage.setItem(key, JSON.stringify({ v: 1, member: m, months: { [mk]: { savedAt: Date.now(), days: d } } }));
}, [SNAPSHOT_KEY, member, days, SNAP_MONTH]);
const readSnapshotKey = (/** @type {import('@playwright/test').Page} */ page) =>
    page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), SNAPSHOT_KEY);

test('the member\'s own stored roster shows AT ONCE, labelled, while the identity is confirmed — then the live grid', async ({ page }) => {
    test.setTimeout(60_000);
    await seedSession(page, 'G. Miller');
    await seedMember(page, 'G. Miller');
    await seedSnapshot(page, 'G. Miller', { [SNAP_DATE]: { type: 'annual_leave', value: 'AL' } });
    await page.addInitScript(() => {
        window.__E2E = Object.assign(window.__E2E || {}, { authUser: true, authRestoreDelayMs: 5000 });
    });
    await page.goto('/index.html');

    // Inside the restore: the COPY, not the workspace — and it says what it is.
    const snap = page.locator('#calendarSnapshot');
    await expect(snap).toBeVisible({ timeout: 2000 });
    await expect(snap.locator('.calendar-snapshot-note')).toHaveText('Checking for changes…');
    await expect(snap.locator('.calendar-day:not(.other-month)').nth(SNAP_DAY - 1)).toContainText('AL');
    await expect(page.locator('#calendarDisplay')).toBeHidden();

    // The grant replaces it with the live Calendar.
    await expect(page.locator('#calendarDisplay')).toBeVisible({ timeout: 20_000 });
    await expect(snap).toHaveCount(0);
    await expect(page.locator('#teamMemberSelect')).toBeEnabled();
});

// Whole-app review, Oct 2026: the copy painted before the grant has real day cells, and the page's
// keyboard handler acted on them — PageDown rendered (and persisted) a month behind the lock card,
// and Enter opened a day panel, with no access granted.
test('the stored copy before the grant is read, never used — PageDown and Enter do nothing', async ({ page }) => {
    test.setTimeout(60_000);
    await seedSession(page, 'G. Miller');
    await seedMember(page, 'G. Miller');
    await seedSnapshot(page, 'G. Miller', { [SNAP_DATE]: { type: 'annual_leave', value: 'AL' } });
    await page.addInitScript(() => {
        window.__E2E = Object.assign(window.__E2E || {}, { authUser: true, authRestoreDelayMs: 8000 });
    });
    await page.goto('/index.html');
    const snap = page.locator('#calendarSnapshot');
    await expect(snap).toBeVisible({ timeout: 2000 });
    const month = () => page.evaluate(() => localStorage.getItem('myb_roster_month'));
    const before = await month();
    await snap.locator('.calendar-day[tabindex="0"]').focus();
    await page.keyboard.press('PageDown');
    await page.keyboard.press('Enter');
    await expect(page.locator('#calendarDisplay .calendar-grid'), 'nothing rendered behind the card').toHaveCount(0);
    await expect(page.locator('.lb-overlay.visible'), 'no day panel before the grant').toHaveCount(0);
    expect(await month(), 'the month was not moved').toBe(before);
});

// The legend follows the grid: a loading month the stored copy is drawn for after the grant IS a
// grid on screen, and it lost its key (whole-app review, Oct 2026).
test('a month drawn from the stored copy after the grant keeps its legend', async ({ page }) => {
    test.setTimeout(60_000);
    await seedSession(page, 'G. Miller');
    await seedMember(page, 'G. Miller');
    await seedSnapshot(page, 'G. Miller', { [SNAP_DATE]: { type: 'annual_leave', value: 'AL' } });
    await page.addInitScript(() => {
        window.__E2E = Object.assign(window.__E2E || {}, { authUser: true, docsDelayMs: 30_000 });
    });
    await page.goto('/index.html');
    await expect(page.locator('#calendarDisplay .calendar-snapshot-note')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.legend')).toBeVisible();
    // …with the keys the copy's days need: the stored 🏖️ day shows, so Annual Leave is in the key —
    // it was read from the live cache, which a loading month does not have yet (48-hour review).
    await expect(page.locator('#legend-al')).toBeVisible();
});

test('a stored copy for SOMEBODY ELSE is never shown, and is deleted', async ({ page }) => {
    test.setTimeout(60_000);
    await seedSession(page, 'G. Miller');
    await seedMember(page, 'G. Miller');
    await seedSnapshot(page, 'S. Boyle', { [SNAP_DATE]: { type: 'annual_leave', value: 'AL' } });
    await page.addInitScript(() => {
        window.__E2E = Object.assign(window.__E2E || {}, { authUser: true, authRestoreDelayMs: 3000 });
    });
    await page.goto('/index.html');
    await page.waitForTimeout(1000);
    await expect(page.locator('#calendarSnapshot')).toHaveCount(0);
    await expect(page.locator('#calendarDisplay')).toBeVisible({ timeout: 20_000 });
    expect((await readSnapshotKey(page))?.member ?? null, 'S. Boyle\'s copy must be gone').not.toBe('S. Boyle');
});

test('a settled live read WRITES the copy — the member\'s own rows only', async ({ page }) => {
    test.setTimeout(60_000);
    await seedSession(page, 'G. Miller');
    await seedMember(page, 'G. Miller');
    await page.addInitScript((date) => {
        const w = /** @type {any} */ (window); w.__E2E = Object.assign(w.__E2E || {}, { authUser: true });
        w.__E2E.docs = [
            { id: 'a', memberName: 'G. Miller', date, type: 'annual_leave', value: 'AL', note: '', source: 'manual' },
            { id: 'b', memberName: 'S. Boyle',  date, type: 'annual_leave', value: 'AL', note: '', source: 'manual' },
        ];
    }, SNAP_DATE);
    await page.goto('/index.html');
    await expect(page.locator('#calendarDisplay .calendar-day').first()).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await readSnapshotKey(page))?.months?.[SNAP_MONTH]?.days ?? null, { timeout: 10_000 })
        .toEqual({ [SNAP_DATE]: { type: 'annual_leave', value: 'AL', source: 'manual' } });
    expect((await readSnapshotKey(page)).member).toBe('G. Miller');
});

test('a browser with no member session never shows a stored copy — the front door, and nothing roster-shaped', async ({ page }) => {
    // Until 23 Nov 2026 this was the staff PIN's half (a PIN unlock deleted a member's copy). A copy left
    // on a shared machine by somebody signed out is for nobody now: the front door does not paint it.
    test.setTimeout(60_000);
    await seedSnapshot(page, 'G. Miller', { [SNAP_DATE]: { type: 'annual_leave', value: 'AL' } });
    await page.goto('/index.html');
    await expect(page.locator('#calendarLock #loginCard')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#calendarSnapshot')).toHaveCount(0);
    expect(await page.locator('.calendar-day').count()).toBe(0);
});
// A Calendar that has LOST access keeps no copy (v24.59). Since v25.74 that is not a line in each of
// the two access-lost handlers: the page listens for the one access state shutting, so the copy goes
// by whichever route the loss was noticed (calendar-app.js → ACCESS LOST, BY WHICHEVER ROUTE).
test('a member who loses access mid-session keeps NO stored copy — and is offered their own sign-in', async ({ page }) => {
    test.setTimeout(60_000);
    await seedSession(page, 'G. Miller');
    await seedMember(page, 'G. Miller');
    await page.addInitScript((date) => {
        const w = /** @type {any} */ (window); w.__E2E = Object.assign(w.__E2E || {}, { authUser: true });
        w.__E2E.docs = [{ id: 'a', memberName: 'G. Miller', date, type: 'annual_leave', value: 'AL', note: '', source: 'manual' }];
    }, SNAP_DATE);
    await page.goto('/index.html');
    await expect(page.locator('#calendarDisplay .calendar-day').first()).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await readSnapshotKey(page))?.member ?? null, { timeout: 10_000, message: 'premise: there is a copy to lose' })
        .toBe('G. Miller');

    await page.evaluate(() => { /** @type {any} */ (window).__E2E.failGetDocs = 'permission-denied'; });
    await page.locator('#nextMonth').click();
    await page.locator('#nextMonth').click();
    await expect(page.locator('#calLockWhy')).toContainText('Calendar access has expired. Sign in again to carry on.');
    // ONE-SHOT, read as the card arrives: the copy goes inside the write that shuts the state, which
    // is before the card. A retrying assertion would also pass on a copy deleted later, by anything.
    expect(await readSnapshotKey(page), 'the copy outlived the access it was saved under').toBeNull();
});

// …AND WHEN THE SESSION ITSELF HAS GONE, THE FRONT DOOR SAYS WHY — ALOUD (17 Nov 2026). With no session
// left to name, the way back in is the sign-in card, carrying the reason (`handleAccessLost` →
// `showSignInPanel(why)`). That line was written on the line after the card was mounted: the same task,
// so the live region arrived with its words already in it and a screen reader said nothing. It now waits
// for the card to be drawn (`speakAfterMount`, status-text.js); `toHaveText` alone cannot see the
// difference, which is why the first frame is read.
test('a member whose session has gone when access lapses gets the sign-in card with the reason — announced, not only shown', async ({ page }) => {
    test.setTimeout(60_000);
    await seedSession(page, 'G. Miller');
    await seedMember(page, 'G. Miller');
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window); w.__E2E = Object.assign(w.__E2E || {}, { authUser: true });
    });
    await recordFirstFrameText(page, '#loginNotice');
    await page.goto('/index.html');
    await expect(page.locator('#calendarDisplay .calendar-day').first()).toBeVisible({ timeout: 20_000 });
    expect(await firstFrameText(page, '#loginNotice'), 'premise: no notice line before access is lost').toEqual([]);

    await page.evaluate(() => {
        localStorage.removeItem('myb_admin_session');   // the session has gone: no member card to offer
        /** @type {any} */ (window).__E2E.failGetDocs = 'permission-denied';
    });
    await page.locator('#nextMonth').click();
    await page.locator('#nextMonth').click();
    await expect(page.locator('#loginNotice')).toHaveText('Calendar access has expired. Sign in again to carry on.');
    await expect(page.locator('#calLockWhy'), 'premise: the front door, not the member\'s own card').toHaveCount(0);
    const atFirstFrame = await firstFrameText(page, '#loginNotice');
    expect(atFirstFrame.length, 'premise: the card\'s notice line was seen arriving').toBeGreaterThan(0);
    expect(atFirstFrame.filter(Boolean), 'the reason was already in the card at its first frame, so it was never announced').toEqual([]);
});

// THE SET-PASSWORD STEP RUNS ON THE ONE GRANT. It hangs off the one-shot `onGranted`, which now
// fires once, with `named` already readable — under the provisional paint that hook was spent while
// access was still `none`, and after a Calendar sign-in the step never ran. Only a page shows the
// coordinator actually reaching it after a slow restore.
test('the forced set-password step runs after a slow identity restore', async ({ page }) => {
    test.setTimeout(60_000);
    await forcePasswordSet(page);
    await seedSession(page, 'G. Miller');
    await seedMember(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_pw_force_pending_G. Miller', '1');   // a fresh sign-in's marker
        window.__E2E = Object.assign(window.__E2E || {}, { authUser: true, authRestoreDelayMs: 5000 });
    });
    await page.goto('/index.html');
    await expect(page.locator('#pwForceOverlay')).toBeVisible({ timeout: 20_000 });
});

// …AND AFTER A SIGN-IN THAT DOES NOT RELOAD (v26.40). The reload used to be what ran it: the sign-in
// wrote the marker, the reload's boot read it. Granted in place, the first grant reads it instead — so
// nothing may grant before the sign-in has finished and written it (calendar-access.js, `finishSignIn`).
test('the forced set-password step runs after a front-door sign-in, with no reload', async ({ page }) => {
    await forcePasswordSet(page);
    await page.addInitScript(() => { window.__E2E = Object.assign(window.__E2E || {}, { signInEstablishes: true }); });
    await page.goto('/index.html');
    await expect(page.locator('#calendarLock #loginCard')).toBeVisible();
    await markThisPage(page);
    await signInThroughOverlay(page, 'G. Miller');
    await expect(page.locator('#pwForceOverlay')).toBeVisible({ timeout: 20_000 });
    expect(await stillThisPage(page), 'the step ran on a reload, not in place').toBe(true);
});

// …AND WHEN THE ANSWER LANDS AFTER THE APP HAS ENDED THE ATTEMPT (review, 24 Nov 2026). On the come-back
// card, a sign-in the app gave up on at 30 seconds can still land; Firebase tells the late-identity watcher
// first, which grants at once — nothing is in flight any more — before the card's own late path writes
// anything. The marker is written as the attempt starts (login-overlay.js), so the first grant finds it.
// The card's own attempt never answers here (`hangSignIn`): only the watcher can open the page.
test('the forced set-password step runs when a typed sign-in the app ended lands late on the come-back card', async ({ page }) => {
    test.setTimeout(60_000);
    await forcePasswordSet(page);
    await seedSession(page, 'G. Miller');
    await seedMember(page, 'G. Miller');
    await page.addInitScript(() => { window.__E2E = Object.assign(window.__E2E || {}, { failSignIn: true }); });
    await page.goto('/index.html');
    const signIn = page.locator('#calLockSubmit');
    await expect(signIn).toBeEnabled({ timeout: 20_000 });
    await signIn.click();
    await expect(page.locator('#loginOverlay')).toBeVisible();
    await page.locator('#loginPassword').fill('miller');
    await page.clock.install();   // the 30-second give-up is the card's own timer, set at the press
    await page.evaluate(() => { const e = /** @type {any} */ (window).__E2E; e.failSignIn = false; e.hangSignIn = true; });
    await page.locator('#loginSubmit').click();
    await page.clock.runFor(31_000);
    await page.clock.resume();
    await expect(page.locator('#loginError'), 'premise: the app ended the attempt and said so').toHaveText(/^Couldn’t complete sign-in/);
    await expect(page.locator('#pwForceOverlay')).toHaveCount(0);
    // The answer lands: Firebase announces the member — their own account, so it carries their email —
    // to every listener.
    await page.evaluate(() => {
        const e = /** @type {any} */ (window).__E2E;
        e.hangSignIn = false;
        e.authUserEmail = 'g.miller@myb-roster.local';
        e.restoreAuth();
    });
    await expect(page.locator('#pwForceOverlay'), 'the late sign-in opened the Calendar without the set-password step').toBeVisible({ timeout: 20_000 });
});

// THE CLAIM SWEEP RUNS ON A CALENDAR BOOT TOO. `refreshClaimsIfStale` lived only inside
// `ensureNamedSession`, which the Calendar's named boot never calls — so a device whose token predated
// a claim change carried it into the override read and met the rules as "access has expired".
test('a named Calendar boot runs the claim-epoch sweep', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await seedMember(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.removeItem('myb_claim_epoch');
        window.__E2E = Object.assign(window.__E2E || {}, { authUser: true });
    });
    await page.goto('/index.html');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('myb_claim_epoch')), { timeout: 10_000 })
        .not.toBeNull();
});

// `readyProvisional` IS NOT WRITTEN ANY MORE. The Speed card divides its total by `ready`'s, so a
// stray write would report a fast path that no longer exists. A NON-ADMIN member, deliberately:
// `recordPageLatency` drops a developer load entirely, so `G. Miller` would pass on an empty list.
test('a cached, slow-restoring open writes `ready` — and no `readyProvisional`', async ({ page }) => {
    test.setTimeout(60_000);
    await seedSession(page, 'S. Silva');
    await seedMember(page, 'S. Silva');
    await page.addInitScript(() => {
        const d = new Date();
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-15`;
        window.__E2E = Object.assign(window.__E2E || {}, {
            authUser: true,
            authRestoreDelayMs: 5000,
            cacheDocs: [{ id: 'x', memberName: 'S. Silva', date: iso, type: 'rdw', value: '09:00-17:00' }],
        });
    });
    await page.goto('/index.html');
    const sampleKeys = async () => page.evaluate(() => (window.__E2E?.setWrites || [])
        .filter(w => String(w.path || '').includes('perf_'))
        .flatMap(w => Object.keys((w.data && w.data.samples) || {})));
    await expect.poll(async () => (await sampleKeys()).some(k => k.includes('|ready|')), { timeout: 25_000 }).toBe(true);
    expect((await sampleKeys()).filter(k => k.includes('|readyProvisional|'))).toEqual([]);
    // No stored copy was seeded, so none was painted — and an open that showed none must not be timed
    // as though it had (v24.85). The test below is the other half.
    expect((await sampleKeys()).filter(k => k.includes('|rosterSnapshot|'))).toEqual([]);
});

// THE MOMENT A MEMBER FIRST SEES THEIR SHIFTS IS TIMED (v24.85). "Shifts shown" is the grid after the
// sign-in check; the stored copy is on screen before any of it, and until this had no time of its own,
// so the App Speed card could not say whether it helped. A NON-ADMIN member, as above.
test('painting the member\'s stored copy writes a `rosterSnapshot` sample', async ({ page }) => {
    test.setTimeout(60_000);
    await seedSession(page, 'S. Silva');
    await seedMember(page, 'S. Silva');
    await seedSnapshot(page, 'S. Silva', { [SNAP_DATE]: { type: 'annual_leave', value: 'AL' } });
    await page.addInitScript(() => {
        window.__E2E = Object.assign(window.__E2E || {}, { authUser: true, authRestoreDelayMs: 3000 });
    });
    await page.goto('/index.html');
    await expect(page.locator('#calendarSnapshot')).toBeVisible({ timeout: 2000 });
    const sampleKeys = async () => page.evaluate(() => (window.__E2E?.setWrites || [])
        .filter(w => String(w.path || '').includes('perf_'))
        .flatMap(w => Object.keys((w.data && w.data.samples) || {})));
    await expect.poll(async () => (await sampleKeys()).some(k => k.includes('|calendar|rosterSnapshot|')), { timeout: 25_000 }).toBe(true);
});

test('a TEAM VIEW member waits for the confirmation too, and their team grid still restores', async ({ page }) => {
    test.setTimeout(60_000);
    await seedSession(page, 'G. Miller');
    await seedMember(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_team_view', '1');
        window.__E2E = Object.assign(window.__E2E || {}, { authUser: true, authRestoreDelayMs: 5000 });
    });
    await page.goto('/index.html');

    // Nothing is painted while the identity is in flight.
    await page.waitForTimeout(2000);
    await expect(page.locator('.team-week-text')).toHaveCount(0);
    await expect(page.locator('#calendarDisplay')).toBeHidden();

    // The team grid arrives on confirmation.
    await expect(page.locator('.team-week-text')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#teamViewBtn')).toBeEnabled();
});

// ── A LOST PHONE STAYS OUT AFTER AN ADMIN RESET (Oct 2026 bug check) ────────────────────────────
// v24.65 refused the silent surname sign-in AFTER signing in, by which time the SDK had announced the
// user and the late-identity watcher here had already granted the Calendar. The reset is now asked
// about BEFORE any sign-in (probeResetAtMs). These drive the real page: a held session whose Firebase
// identity is gone, the stub ready to sign in, and the server's answer about the last reset.
/** @param {import('@playwright/test').Page} page @param {number} resetAgoMs  0 = never reset */
async function heldSessionWithReset(page, resetAgoMs) {
    await page.addInitScript(() => {
        const DAY = 86_400_000;
        localStorage.setItem('myb_admin_session', JSON.stringify({
            name: 'G. Miller', ver: 2, expiry: Date.now() + 30 * DAY, createdAt: Date.now() - 10 * DAY,
        }));
        localStorage.setItem('myb_roster_selected_member', 'G. Miller');
        localStorage.setItem('myb_notice_timetable_2026_done', '1');
        localStorage.setItem('myb_notice_ytd_figures_2026_done', '1');
        localStorage.setItem('myb_notice_install_app_2026_done', '1');
        localStorage.setItem('myb_notice_timetable_soon_2026_done', '1');   // 16 Nov – 12 Dec 2026 (v24.96; v26.21)
        localStorage.setItem('myb_notice_newlink_vote_2026_done', '1');   // the New link vote notice, 26 Nov – 5 Dec 2026 (v26.90)
        window.__E2E = Object.assign(window.__E2E || {}, { signInEstablishes: true });
    });
    await page.route('https://firestore.googleapis.com/**/documents/passwordStatus/**', route => route.fulfill(resetAgoMs
        ? { status: 200, contentType: 'application/json',
            body: JSON.stringify({ fields: { resetAt: { timestampValue: new Date(Date.now() - resetAgoMs).toISOString() } } }) }
        : { status: 404, contentType: 'application/json', body: '{}' }));
}

test('a phone whose session predates the last reset is NOT let in — no sign-in, session ended', async ({ page }) => {
    await heldSessionWithReset(page, 86_400_000);   // reset yesterday; this session is ten days old
    await page.goto('/index.html');
    await expect(page.locator('#calendarLock')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1500);   // long enough for any late grant to have landed
    await expect(page.locator('#calendarDisplay')).toBeHidden();
    expect(await page.evaluate(() => /** @type {any} */ (window).__E2E.authUser), 'the app never signed in').toBeFalsy();
    expect(await page.evaluate(() => localStorage.getItem('myb_admin_session')), 'the local session is ended').toBeNull();
});

test('the same held session with NO reset since is let in silently, as before', async ({ page }) => {
    await heldSessionWithReset(page, 0);
    await page.goto('/index.html');
    await expect(page.locator('#calendarDisplay')).toBeVisible({ timeout: 20_000 });
});
