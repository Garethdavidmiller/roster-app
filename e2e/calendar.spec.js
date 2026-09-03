import { test, expect, enforceNamedSession, enableInplaceLogin, enableCalendarPin } from './fixtures.js';
import { collectFatalErrors, seedSession, seedMember, pickFirstMemberAndPassword, DESKTOP_WIDTHS, armEnforcementWithFailingSignIn, signInThroughOverlay, openGuideLink, seedViewerAccess, seedMemberSession } from './helpers.js';

// ── Calendar access (v20.12) ────────────────────────────────────────────────────────────────────
// Since v20.12 the Calendar opens only for a member session or the shared staff PIN, so a spec that
// simply loads index.html now gets the unlock card and none of the roster. Every test in this file
// is about what the Calendar DOES once it is open, not about the gate, so each page starts with a
// viewer session already in place — the state an unlocked shared office PC is in, and the closest
// match to what these tests were implicitly written against (roster on screen, `getSession()` null).
// The gate itself is covered end-to-end in calendar-pin.spec.js.
// A test that also seeds a member session still gets the member: the stub ranks them that way,
// exactly as `decideAccess` does.
// These set the PIN explicitly rather than inheriting `CONFIG.CALENDAR_PIN_ACCESS`, and seed a
// viewer session to satisfy it. Deliberate, and the value is NOT restated here — `roster-data.js`
// owns it, and a comment repeating it is the defect this repo names most often (this one did, and
// said "switched OFF … deployed dark" for the five weeks after the flag went live). A suite that
// INHERITS the flag silently changes what it covers on the day the flag moves, and the direction
// that costs something is a calendar suite falling back to the old open model with the gate
// untested.
test.beforeEach(async ({ page }) => { await enableCalendarPin(page); await seedViewerAccess(page); });


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

// ── The grid is withheld until the overrides are known (v20.40) ──────────────────────────────────
//
// The unit tests prove the DECISION; only a browser proves the WIRING — that a real page open with a
// slow or failed Firestore read actually withholds, rather than the fetch module recording a state
// nobody reads. The bug being guarded is precisely one nothing threw on: the base roster is drawn
// perfectly, and it is somebody else's day.

test('calendar: a month whose overrides have not arrived shows NO shifts', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedMember(page);
    // Hold every collection read open. This is the fresh-browser case: no local cache to paint from,
    // so before v20.40 the base roster went straight up while the read was still in flight.
    await page.addInitScript(() => { (window.__E2E = window.__E2E || {}).docsDelayMs = 30000; });
    await page.goto('/');

    await expect(page.locator('.calendar-pending')).toBeVisible();
    await expect(page.locator('.calendar-day')).toHaveCount(0);
    // The month label survives — the header is kept in every state so the sync chip has a mount point.
    await expect(page.locator('.month-year')).toBeVisible();
    // And the legend goes with the grid: it is a key to cells that are not there, derived from the
    // base roster, so leaving it up would announce this month's shift types while the panel beside it
    // says we do not know them.
    await expect(page.locator('.legend')).toBeHidden();
    expect(errors, 'Uncaught JS exceptions on index.html').toHaveLength(0);
});

test('calendar: a FAILED override read offers a retry, and still shows no shifts', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedMember(page);
    await page.addInitScript(() => { (window.__E2E = window.__E2E || {}).failGetDocs = true; });
    await page.goto('/');

    // The failed panel is a different panel from the wait one — it names the failure and carries the
    // action. A single "loading" state for both would leave a member waiting on something that has
    // already lost, which is the shape the old code had (base roster + a chip, indefinitely).
    await expect(page.locator('.calendar-pending--failed')).toBeVisible();
    await expect(page.locator('.calendar-pending-retry')).toBeVisible();
    await expect(page.locator('.calendar-day')).toHaveCount(0);
    expect(errors, 'Uncaught JS exceptions on index.html').toHaveLength(0);
});

test('calendar: the retry re-reads, and a grid appears when it succeeds', async ({ page }) => {
    await seedMember(page);
    await page.addInitScript(() => { (window.__E2E = window.__E2E || {}).failGetDocs = true; });
    await page.goto('/');
    await expect(page.locator('.calendar-pending-retry')).toBeVisible();

    // Let the next read succeed, then press the button the panel offered.
    await page.evaluate(() => { window.__E2E.failGetDocs = false; });
    await page.locator('.calendar-pending-retry').click();

    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await expect(page.locator('.calendar-pending')).toHaveCount(0);
    await expect(page.locator('.legend')).toBeVisible();
});

// Swipe helper — a real pointer drag across the grid. Left drag = next month, right = previous.
//
// It RETRIES until the month heading actually changes, and that is not defensive padding: a
// mouse-simulated gesture is swallowed perhaps one time in two, and which one moves with the settle
// delay. A fixed `waitForTimeout` therefore produces a test that fails on a different line each run
// and, worse, one that can pass while asserting a state the swipe never reached — which is exactly
// how the first version of this test passed against the bug it was written for.
async function swipeMonth(page, dir) {
    // `.first()`, because the carousel legitimately holds MORE THAN ONE month panel while a swipe
    // is in flight — that is what a carousel is. An unscoped `.month-year` is a strict-mode
    // violation the moment this helper is called during a transition, which under load is exactly
    // when it is called: the previous swipe's panels had not been torn down yet (v21.88).
    //
    // The retry loop below already tolerates a swallowed gesture; it could not tolerate the
    // locator itself throwing, so the failure surfaced as a hard error rather than a retry.
    //
    // ── THE RETRY USED TO OVER-ADVANCE THE CAROUSEL (v22.48) ──────────────────────────────────
    //
    // The retry budget below was 2000ms, and a real transition takes LONGER than that on a loaded
    // machine. So the helper called a gesture that was working "swallowed", swiped again, and moved
    // TWO months in one call. The test then swiped back one and landed a month further out than it
    // meant to — outside the boot window, where the grid is deliberately withheld — and failed on a
    // missing `.calendar-day` while the page sat on a spinner.
    //
    // MEASURED, not reasoned about. A heading-change recorder over 20 runs at `--workers=6`:
    //
    //     55994  [October|September|November]   transition starts
    //     59433  [November] days=0              settles — 3.4s, well past the 2000ms budget
    //     60805  == swipe 2 RETRY               helper gives up and swipes again
    //     64407  == swipe 2 returned            now on December, two months from where it began
    //
    // It surfaced on CI first: one WebKit shard, failing twice including the retry, and passing on
    // the identical commit ten minutes later. A loaded runner is simply another way to make the
    // transition outlast the budget.
    //
    // The budget is now 10s, and the asymmetry is the point: too SHORT silently corrupts the
    // navigation and fails somewhere else entirely, while too LONG only costs time on a gesture
    // that genuinely was swallowed — which is rare. Err long.
    //
    // `before` is also read from a SETTLED carousel now. Read mid-flight it can catch the outgoing
    // panel, which makes the exit condition satisfiable by a transition that was already running.
    // That was not the cause here (fixing it alone changed nothing — 4 failures in 30), but it is a
    // second way for this helper to answer about the wrong month, and it costs one wait.
    await page.waitForFunction(() => document.querySelectorAll('.month-year').length === 1,
        null, { timeout: 10000 });
    const before = await page.locator('.month-year').first().textContent();
    for (let attempt = 0; attempt < 4; attempt++) {
        const box = await page.locator('#calendarDisplay').boundingBox();
        const y = box.y + box.height / 2;
        const [from, to] = dir === 'next'
            ? [box.x + box.width - 20, box.x + 20]
            : [box.x + 20, box.x + box.width - 20];
        await page.mouse.move(from, y);
        await page.mouse.down();
        await page.mouse.move(to, y, { steps: 12 });
        await page.mouse.up();
        try {
            await page.waitForFunction(
                // querySelector already takes the first, so this matches the read above — and it
                // waits for the carousel to settle to ONE panel, so the next call starts clean.
                (b) => document.querySelectorAll('.month-year').length === 1
                    && document.querySelector('.month-year')?.textContent !== b,
                before, { timeout: 10000 });
            return;
        } catch { /* genuinely swallowed — nothing moved in ten seconds — try again */ }
    }
    throw new Error(`swipe ${dir} never committed (still on ${before})`);
}

test('calendar: the legend follows the grid across a SWIPE, in both directions', async ({ page }) => {
    // The regression this pins (v20.41). A swipe COMMIT calls updateLegend() but never
    // renderCalendar() — the incoming carousel panel simply becomes the live view — so a legend
    // decision made in renderCalendar was skipped on the navigation people use most.
    //
    // Getting teeth into this needs a swipe where the right answer CHANGES. The boot fetch covers
    // previous/current/next, so one swipe lands on a month that is already known and the legend is
    // correct either way — a first attempt at this test asserted exactly that and passed against the
    // bug. Two swipes reach OUTSIDE the boot window, and delaying reads only AFTER boot leaves that
    // month genuinely unknown while the months behind it stay good.
    await seedMember(page);
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await expect(page.locator('.legend')).toBeVisible();

    // From here on, any NEW month's read hangs. The boot window is already loaded.
    await page.evaluate(() => { (window.__E2E = window.__E2E || {}).docsDelayMs = 30000; });

    await swipeMonth(page, 'next');   // still inside the boot window — known
    await swipeMonth(page, 'next');   // outside it — unknown, so the grid is withheld

    await expect(page.locator('.calendar-pending')).toBeVisible();
    await expect(page.locator('.legend')).toBeHidden();

    // And back: a swipe onto a month that IS known must bring the legend with it. This is the
    // direction a member would report — a perfectly good grid with no colour key.
    await swipeMonth(page, 'prev');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await expect(page.locator('.legend')).toBeVisible();
});

test('calendar: a successful read renders the grid — the withholding is a gate, not a disablement', async ({ page }) => {
    await seedMember(page);
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await expect(page.locator('.calendar-pending')).toHaveCount(0);
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

// Guide links navigate in the SAME window (v18.81 — was target="_blank", which from the installed
// PWA wrapped every guide in Android's Chrome Custom Tab / iOS's in-app Safari chrome: the "extra
// header at the top of all the guides" staff report). Assert: no popup, the SAME tab lands on the
// guide (after the drawer-close + open-counter defer), and the guide's ← back returns to the app.
test('calendar: a drawer guide link navigates same-tab (no new tab / Custom Tab)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#teamMemberSelect option').first()).toBeAttached();
    const guide = await openGuideLink(page, 'Staff & Admin Guide');
    await expect(guide).toBeVisible();
    await expect(guide).not.toHaveAttribute('target', '_blank');
    let popupSeen = false;
    page.context().once('page', () => { popupSeen = true; });
    await guide.click();
    await page.waitForURL(/guide\.html/, { timeout: 4000 });     // same tab, after the ~120ms defer
    expect(popupSeen, 'no popup/new tab must open').toBe(false);
    await expect(page.locator('.page-header h1')).toContainText('Staff & Admin Guide');
    // The guide's ← must come back HERE (v18.84 — guide-back.js reads the ?from= hint). Opened from
    // the calendar it stays './', but the hint must be present for the pages where it matters.
    expect(page.url()).toContain('from=');
    await expect(page.locator('.btn-back')).toHaveAttribute('href', './');
});

// v18.84: a guide opened from a SUB-page must send you back to that page, not to the calendar. The
// guides' ← is hardcoded (guide/railcard/fip → './'), which was invisible while guides opened in a
// new tab but stranded you once v18.81 made them navigate in the same tab.
test('admin: a drawer guide link comes back to Admin, not the calendar', async ({ page }) => {
    await seedSession(page);
    await page.goto('/admin.html');
    const guide = await openGuideLink(page, 'Railcard Guide');
    await expect(guide).toBeVisible();
    await guide.click();
    await page.waitForURL(/railcard-guide\.html/, { timeout: 4000 });
    await expect(page.locator('.btn-back')).toHaveAttribute('href', './admin.html');
    await expect(page.locator('.btn-back')).toHaveAttribute('aria-label', 'Back to Admin');
    await page.locator('.btn-back').click();
    await page.waitForURL(/admin\.html/, { timeout: 4000 });
});

// ── Cross-guide search (v22.02) ──────────────────────────────────────────────────────────────
// The unit suites cover the matching rules and the index's truth; these cover what only a browser
// can — that the LAZY module actually loads on focus, that results really do ride nav-panel's
// delegated guide-link handler (counting/?from=/history come from there), and that the drawer's
// static list comes back when the query clears.

async function openGuideSearch(page) {
    await page.goto('/');
    await expect(page.locator('#teamMemberSelect option').first()).toBeAttached();
    await page.locator('#navMenuBtn').click();
    const input = page.locator('#navGuideSearchInput');
    await expect(input).toBeVisible();
    await input.click();     // first focus triggers the lazy import
    return input;
}

test('guide search: typing finds a railcard card, hides the static list, and clearing restores it', async ({ page }) => {
    const input = await openGuideSearch(page);
    await input.fill('gold card');
    const gold = page.locator('#navGuideSearchResults a[href*="railcard-guide.html#rc-gold"]');
    await expect(gold).toBeVisible();
    await expect(gold).toContainText('Annual Gold Card');
    await expect(gold).toContainText('Railcard Guide');
    await expect(page.locator('#navGuidesList')).toBeHidden();
    // …and the section that merely CONTAINS the card must not double the answer
    await expect(page.locator('#navGuideSearchResults a[href$="#rc-cards"]')).toHaveCount(0);
    await input.fill('');
    await expect(page.locator('#navGuidesList')).toBeVisible();
    await expect(page.locator('#navGuideSearchResults')).toBeHidden();
});

test('guide search: a provisional claim carries its evidence state INTO the result row', async ({ page }) => {
    const input = await openGuideSearch(page);
    await input.fill('thames rover');
    const thames = page.locator('#navGuideSearchResults a[href*="rangers-guide.html#rr-thames"]');
    await expect(thames).toBeVisible();
    await expect(thames.locator('.nav-gs-flag')).toContainText('Source conflict');
});

test('guide search: no matches says so, in words', async ({ page }) => {
    const input = await openGuideSearch(page);
    await input.fill('zzzqxv');
    await expect(page.locator('#navGuideSearchStatus')).toHaveText('No matches in the guides');
    await expect(page.locator('#navGuideSearchResults')).toBeHidden();
});

test('guide search: collapsing Reference takes the search box with it', async ({ page }) => {
    const input = await openGuideSearch(page);
    await expect(input).toBeVisible();
    await page.locator('#navGuidesToggle').click();
    await expect(input).toBeHidden();
    await page.locator('#navGuidesToggle').click();
    await expect(input).toBeVisible();
});

test('guide search: a result navigates same-tab with the ?from= hint and the section hash', async ({ page }) => {
    const input = await openGuideSearch(page);
    await input.fill('gold card');
    let popupSeen = false;
    page.context().once('page', () => { popupSeen = true; });
    await page.locator('#navGuideSearchResults a[href*="#rc-gold"]').click();
    await page.waitForURL(/railcard-guide\.html\?from=.*#rc-gold/, { timeout: 4000 });
    expect(popupSeen, 'no popup/new tab must open').toBe(false);
    // The hash landed on a real anchor — the card is on screen
    await expect(page.locator('#rc-gold')).toBeVisible();
});

// A crafted ?from= must never become the back arrow's destination — the guide checks it against an
// allowlist of the app's own pages and otherwise leaves the authored href alone.
test('guide: an off-allowlist ?from= leaves the back arrow untouched', async ({ page }) => {
    await page.goto('/railcard-guide.html?from=https://evil.example/x');
    await expect(page.locator('.btn-back')).toHaveAttribute('href', './');
    await page.goto('/railcard-guide.html?from=../../etc/passwd');
    await expect(page.locator('.btn-back')).toHaveAttribute('href', './');
});



// ── THE CALENDAR MUST PASS AN IDENTITY THE TELEMETRY CAN USE (v19.86, external review P2) ──
// `recordUsage`'s identity argument does three jobs: exclude the developer's own sessions, key the
// address counters, and — since v19.95 — key the active-account counts. The calendar passed
// `getSession()?.name`, right for the first and null for the others on an ordinary anonymous
// visitor, so those metrics never saw the population they exist to observe: calendar-only staff,
// who never sign in anywhere and are exactly the people an old installed PWA strands.
//
// This has to drive real page INIT. The unit tests call `recordUsage` directly with an identity
// handed to them, so they can prove the reporter's rules and can never notice the call site passing
// the wrong thing — which is precisely how this survived.
test('calendar: origin telemetry gets the selected member when nobody is signed in', async ({ page }) => {
    // Rewrite usage-reporter.js so recordUsage records its arguments. A missing anchor THROWS: a
    // silent no-op here would leave a green test that had stopped testing the wiring.
    const ANCHOR = 'export function recordUsage(page, identity = null) {';
    await page.route('**/usage-reporter.js', async route => {
        const res = await route.fetch();
        const src = await res.text();
        if (!src.includes(ANCHOR)) {
            throw new Error(`calendar: recordUsage anchor no longer matches — "${ANCHOR}". Re-point it.`);
        }
        const body = src.replace(ANCHOR, ANCHOR
            + '\n    (window.__E2E ||= {}).usageCalls = [...(window.__E2E.usageCalls || []), { page, identity }];');
        await route.fulfill({ response: res, body, contentType: 'text/javascript' });
    });

    // A returning, signed-OUT visitor: a member has been chosen, so this is not first run.
    await seedMember(page, 'S. Silva');
    await page.goto('/');
    await expect(page.locator('#calendarDisplay')).toBeVisible();

    await expect.poll(async () => (await page.evaluate(() => window.__E2E?.usageCalls?.length)) || 0)
        .toBeGreaterThan(0);
    const call = await page.evaluate(() => window.__E2E.usageCalls.find(c => c.page === 'calendar'));
    expect(call, 'the calendar must report a page view').toBeTruthy();
    expect(call.identity, 'the selected member is the dedup key for both the origin and account metrics')
        .toBe('S. Silva');
    // Since v19.95 that ONE identity also counts the visit as an active account. The spec used to
    // assert a second `member` argument was null here, documenting the gap: a member who only reads
    // the roster signs in nowhere, so "accounts active" excluded most of the staff.
});

test('calendar: a FIRST-RUN device reports no identity, so the default admin cannot exclude it', async ({ page }) => {
    // The guard that makes the fallback above safe. Before anyone picks a name the "selection" is
    // only CONFIG.DEFAULT_MEMBER_NAME — an admin — so keying on it unguarded would silently drop
    // every fresh visitor from the usage counts AND from the migration metric.
    const ANCHOR = 'export function recordUsage(page, identity = null) {';
    await page.route('**/usage-reporter.js', async route => {
        const res = await route.fetch();
        const src = await res.text();
        if (!src.includes(ANCHOR)) throw new Error(`calendar: recordUsage anchor no longer matches — "${ANCHOR}".`);
        await route.fulfill({
            response: res, contentType: 'text/javascript',
            body: src.replace(ANCHOR, ANCHOR
                + '\n    (window.__E2E ||= {}).usageCalls = [...(window.__E2E.usageCalls || []), { page, identity }];'),
        });
    });

    await page.goto('/');                       // no seeded member — first run
    await expect.poll(async () => (await page.evaluate(() => window.__E2E?.usageCalls?.length)) || 0)
        .toBeGreaterThan(0);
    const call = await page.evaluate(() => window.__E2E.usageCalls.find(c => c.page === 'calendar'));
    expect(call.identity, 'a first-run device must not be keyed on the default member').toBe(null);
});


// ── EACH GUIDE MUST COUNT AS ITSELF (v19.95) ─────────────────────────────────────────────────────
// The guides are static pages with no Firebase, so the drawer tap is the only place an open can be
// counted, and the id has to be chosen from the link that was clicked. Until v19.95 that was a
// substring test on the href covering two of the four guides — and the two added here are exactly
// the case it gets wrong: `'./paycalc-guide.html'.includes('guide.html')` is TRUE, and `guide.html`
// was the Staff Guide's own filename until the v22.47 rename.
//
// Nothing else can catch a mis-mapping. The unit tests hand `recordOpen` an id, the parity test
// proves the LISTS agree, and both stay green while every Pay Calculator Guide open is filed under
// the Staff Guide — two plausible-looking bars, one of them wrong, on a card nobody cross-checks.
// So this drives the real drawer and reads back what each tap actually emitted.
test('nav: each guide records its OWN open id', async ({ page }) => {
    const ANCHOR = 'export function recordOpen(itemId, identity = null) {';
    await page.route('**/usage-reporter.js', async route => {
        const res = await route.fetch();
        const src = await res.text();
        // A moved anchor THROWS rather than no-opping: a silent miss would leave a green test that
        // records nothing and therefore asserts nothing.
        if (!src.includes(ANCHOR)) throw new Error(`nav: recordOpen anchor no longer matches — "${ANCHOR}".`);
        await route.fulfill({
            response: res, contentType: 'text/javascript',
            // sessionStorage, NOT a window global: the tap navigates to the guide, so a global dies
            // with the document and every reading comes back empty — which reads as "the counter
            // never fired" whether or not it did. (It did, first time round.)
            body: src.replace(ANCHOR, ANCHOR
                + '\n    sessionStorage.setItem("__opens", (sessionStorage.getItem("__opens")||"") + itemId + ",");'
                + '\n    return;'),
        });
    });
    await seedMember(page, 'S. Silva');

    for (const [label, expected] of [
        ['Staff & Admin Guide',  'guide-staff'],
        ['Pay Calculator Guide', 'guide-paycalc'],
        ['Railcard Guide',       'guide-railcard'],
        ['FIP Travel Guide',     'guide-fip'],
        ['Rangers & Rovers',     'guide-rangers'],
    ]) {
        await page.goto('/');
        // Two taps since v20.06 — the guides live in the collapsed Reference section. Driven through
        // the real drawer rather than by URL, because the id being asserted is stamped onto the LINK
        // and read off the element; navigating directly would skip the only code path under test.
        await (await openGuideLink(page, label)).click();
        await page.waitForURL(/guide|fip|rangers/);
        const opens = await page.evaluate(() => {
            const v = sessionStorage.getItem('__opens') || '';
            sessionStorage.removeItem('__opens');
            return v.split(',').filter(Boolean);
        });
        expect(opens, `opening "${label}" must record exactly one open`).toHaveLength(1);
        expect(opens[0], `"${label}" recorded the wrong id`).toBe(expected);
    }
});

// ── THE SIGN-IN NOTICE, AND WHO IT IS FOR (v21.84) ──────────────────────────────────────────────
//
// Replaces the two `pw-own-2026` tests. That notice asked a member to set their own password;
// `password-force.js` now compels exactly that at the next sign-in, so what was left unsaid was the
// thing the staff PIN introduced: on a personal phone the code is re-entered every browser session,
// and signing in once ends it for 60 days.
//
// The audience is the whole design and both halves need a test. It must reach somebody with NO
// session — the skill template's `if (!getSession()) return` would hide it from everybody it is
// written for, which is the trap the old notice's tests existed to catch and which survives the
// rewrite. And it must NOT reach a signed-in member, who has already done the thing it asks; that
// half is new, and it is what removed the retirement write from settings-app.js.
test('calendar: the sign-in notice shows to somebody with no session', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedMember(page, 'S. Silva');                 // a chosen member, deliberately NO session
    await page.addInitScript(() => localStorage.removeItem('myb_notice_sign_in_2026_done'));
    await page.goto('/');
    await expect(page.locator('#signInNoticeLb.visible')).toBeVisible({ timeout: 8000 });

    // Archived on OPEN, not on close: the CTA navigates away, so `onClose` may never fire.
    const archived = await page.evaluate(() => localStorage.getItem('myb_app_notices') || '');
    expect(archived, 'must be in App Notices before the reader can navigate away').toContain('sign-in-2026');

    await page.locator('#signInNoticeLater').click();
    await expect(page.locator('#signInNoticeLb.visible')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('myb_notice_sign_in_2026_snooze')),
        'closing snoozes rather than dismissing for good').toBeTruthy();
});

test('calendar: the sign-in notice stays away from a member who has signed in', async ({ page }) => {
    // No done-flag involved: the audience check answers this on every load, which is why signing in
    // needs no write anywhere to silence it.
    //
    // `seedMemberSession` as WELL as `seedSession`, and that is not belt-and-braces: `decideAccess`
    // requires a local session AND a restored named Firebase identity, so a session alone leaves
    // this file's viewer seed in charge and the notice correctly shows. The distinction is the same
    // one the iOS-ITP case turns on, so it is worth a test getting it right rather than around.
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSession(page, 'S. Silva');
    await seedMemberSession(page, 'S. Silva');
    await seedMember(page, 'S. Silva');
    await page.addInitScript(() => localStorage.removeItem('myb_notice_sign_in_2026_done'));
    await page.goto('/');
    await expect(page.locator('#calendarDisplay')).toBeVisible();
    await page.waitForTimeout(2200);                    // past the 1500ms deferred open
    await expect(page.locator('#signInNoticeLb.visible')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('myb_notice_sign_in_2026_done')),
        'a notice refused by audience is left unflagged, not marked seen').toBeNull();
});

test('nav drawer: every pill label starts on the same x, including the current page', async ({ page }) => {
    /*
     * The pill rule's own comment states the intent: "left alignment puts every pill's text on the
     * SAME x as the Today rows underneath, so the whole drawer reads down one edge." The
     * "you are here" dot broke it (v21.74). As an ordinary `::before` in a flex pill it is a flex
     * ITEM — it took the 8px gap plus a 6px margin and pushed the emoji and label 19px right,
     * measured. Only on the current page's pill, so the drawer looked different on every page and
     * the same on none, and no assertion in the suite could see it: the DOM was identical either
     * way, and the dot is exactly the sort of 8px detail a screenshot review skims past.
     *
     * Measured through a Range over the pill's own text node — the padding box never moved, so a
     * bounding-rect check on the pill would pass on the broken layout.
     *
     * RELATIVE TO EACH PILL, AND WITH A TOLERANCE (v21.82). This compared absolute x across pills
     * and was exactly equal on Chromium, so it read as a clean assertion — but it failed
     * intermittently on Mobile Safari, and the same commit passed one run and failed the next.
     * The reported numbers say why: the whole drawer was still SLIDING (left −184 then −163 on the
     * retry), so the rects were being read mid-transition at fractional offsets, and a Range rect
     * measures GLYPH INK rather than the text origin — the 📅 in the Calendar pill reported 2px
     * left of every other pill's emoji, on both attempts, while all the others agreed exactly.
     *
     * Both problems disappear by asking the question the bug actually poses: how far into ITS OWN
     * pill does each label start? That is immune to where the drawer has slid to, and the defect
     * it guards moved a label 19px — so a 3px tolerance for emoji ink leaves it every tooth it had.
     *
     * MEASURED ONCE THINGS HAVE STOPPED MOVING (v21.88). The relative measurement removed the
     * slide, but not the other half: a Range reads GLYPH INK, and glyph ink depends on which font
     * is actually resolved at that instant. Under load — the full two-project run, not this test
     * alone — 📅 came back 4px in against everyone else's 16 and the spread crossed the tolerance.
     *
     * The outlier is what identifies it: the page under test is operations.html, so the CURRENT
     * pill is Ops. If the "you are here" dot were misaligning anything it would be that one. It was
     * Calendar, which is not current and whose only distinguishing feature is its emoji — i.e. the
     * measurement, not the layout. Padding is static CSS and cannot vary between runs.
     *
     * So wait for the fonts to resolve and for the drawer to stop moving, and keep the tolerance
     * where it is. Raising it to swallow the reading would have spent the guard's remaining teeth
     * on a problem that was never in the app.
     */
    const INK_TOLERANCE_PX = 3;
    await seedSession(page);
    await seedMember(page);
    await page.goto('/operations.html');   // a page whose pill is IN the row, so a current pill exists
    await page.locator('#navMenuBtn').click();
    await expect(page.locator('.nav-panel-pill').first()).toBeVisible();
    // Fonts first: an unresolved webfont measures a fallback's ink, not Inter's.
    await page.evaluate(() => document.fonts.ready);
    // Then the slide. `transitionend` is unreliable here (this repo documents iOS suppressing it on
    // a backgrounded tab), so settle on the observable thing instead: the drawer's own position,
    // unchanged across two consecutive frames.
    await page.waitForFunction(() => {
        const panel = document.querySelector('.nav-panel');
        if (!panel) return false;
        const now = panel.getBoundingClientRect().left;
        const prev = window.__navLeft;
        window.__navLeft = now;
        return prev !== undefined && Math.abs(now - prev) < 0.5;
    }, null, { timeout: 5000, polling: 'raf' });

    const xs = await page.evaluate(() => [...document.querySelectorAll('.nav-panel-pill')].map(p => {
        const tn = [...p.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
        if (!tn) return null;
        const r = document.createRange();
        r.selectNodeContents(tn);
        return {
            label: p.textContent.trim().slice(0, 14),
            inset: Math.round(r.getBoundingClientRect().left - p.getBoundingClientRect().left),
        };
    }).filter(Boolean));

    expect(xs.length, 'no pills found — the drawer did not render').toBeGreaterThan(3);
    // Exactly one current pill, or the test is measuring a row with nothing to misalign.
    expect(await page.locator('.nav-panel-pill--current').count()).toBe(1);
    const insets = xs.map(p => p.inset);
    const spread = Math.max(...insets) - Math.min(...insets);
    expect(spread, `pill labels start at different x: ${JSON.stringify(xs)}`).toBeLessThanOrEqual(INK_TOLERANCE_PX);
});

// ── The install strip, and the one thing about it a unit test cannot see (v22.28) ────────────────
//
// The rules in `install-prompt.js` are small enough to look obviously right; the WIRING is where
// this feature can fail, and it fails silently in both directions. So these drive the real page.
//
// The precedence rule is the one worth the most care, and the naive version of this test is
// VACUOUS: headless Chromium has no push service, so `notifSupported()` is false and `#notifPrompt`
// never shows — an assertion that it is hidden would pass with the suppression line deleted. The
// test therefore puts the notification strip on screen FIRST and asserts the install strip takes it
// down, which is the line executing rather than the situation happening not to arise.

/** Put the page in the state the strip is designed for, then fire the browser's install event. */
async function armInstall(page, { showNotif = false, width = 390 } = {}) {
    await page.setViewportSize({ width, height: 800 });   // the strip is mobile-only — see below
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/');
    await page.waitForSelector('#calendarDisplay table, #calendarDisplay .calendar-container', { timeout: 15_000 });
    if (showNotif) await page.evaluate(() => { document.getElementById('notifPrompt').style.display = 'flex'; });
    await page.evaluate(() => {
        const e = new Event('beforeinstallprompt');
        /** @type {any} */ (e).prompt = () => { /** @type {any} */ (window).__promptFired = true; return Promise.resolve(); };
        window.dispatchEvent(e);
    });
    await expect(page.locator('#installPrompt')).toBeVisible();
}

test('install strip: it offers a real Install button once the browser says it can', async ({ page }) => {
    await armInstall(page);
    await expect(page.locator('#installPromptAction')).toBeVisible();
    // The manual iOS steps are the OTHER branch and must not be showing beside a working button.
    await expect(page.locator('#installPromptSteps')).toBeHidden();
});

test('install strip: it takes the notification ask off screen WITHOUT marking it done', async ({ page }) => {
    await armInstall(page, { showNotif: true });
    await expect(page.locator('#notifPrompt')).toBeHidden();
    // The whole point of hiding rather than dismissing: the notification ask returns next visit.
    // Trading one prompt for the other is not what "one at a time" means.
    expect(await page.evaluate(() => localStorage.getItem('myb_notif_prompt_done'))).toBeNull();
});

test('install strip: pressing Install fires the browser prompt and does not come back', async ({ page }) => {
    await armInstall(page);
    await page.locator('#installPromptAction').click();
    expect(await page.evaluate(() => /** @type {any} */ (window).__promptFired)).toBe(true);
    await expect(page.locator('#installPrompt')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('myb_install_prompt_done'))).toBe('1');
});

// ── AN UNREADABLE `--prompt-available` FAILS CLOSED (v22.32, external review) ───────────────────
//
// `canBeSeen` read `!== '0'` first, which meant an UNREADABLE property ('' from a browser with no
// custom-property support) counted as "yes": we would capture `beforeinstallprompt`, suppressing
// the browser's own install promotion, while the strip stayed CSS-hidden. No offer from anyone —
// the one outcome the width check exists to prevent.
//
// No shipping browser does this (Chromium supports both), so the mutation is invisible in a normal
// run and no ordinary test can have teeth on it. Removing the property is what makes the branch
// reachable, and the assertion is on `defaultPrevented`: failing closed means we never registered,
// so the browser keeps its own offer.
test('install strip: an unreadable width flag leaves the browser its own offer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await seedMemberSession(page, 'G. Miller');
    // Serve the stylesheet with the declaration REMOVED, so the property is undefined from the
    // first paint. Injecting a style after load is too late: the module reads the flag as it runs.
    await page.route('**/index.css', async route => {
        const res = await route.fetch();
        const css = (await res.text()).replace('--prompt-available: 1;', '');
        await route.fulfill({ response: res, body: css, headers: { ...res.headers(), 'content-type': 'text/css' } });
    });
    await page.goto('/');
    await page.waitForSelector('#calendarDisplay table, #calendarDisplay .calendar-container', { timeout: 15_000 });
    const prevented = await page.evaluate(() => {
        const e = new Event('beforeinstallprompt', { cancelable: true });
        /** @type {any} */ (e).prompt = () => Promise.resolve();
        window.dispatchEvent(e);
        return e.defaultPrevented;
    });
    expect(prevented,
        'an unreadable flag must NOT be read as "yes" — capturing here suppresses the browser\'s '
        + 'own offer while our strip stays hidden').toBe(false);
    await expect(page.locator('#installPrompt')).toBeHidden();
});

test('install strip: the shared PIN station is never invited to install', async ({ page }) => {
    // A PIN unlock is a STATION, not a person — nobody should be putting the staff roster onto the
    // mess-room PC, and there would be no one able to take it off again.
    await page.setViewportSize({ width: 390, height: 800 });
    await seedViewerAccess(page);
    await seedMember(page);            // a chosen member is a DISPLAY choice, not a session
    await page.goto('/');
    await expect(page.locator('.month-year')).toBeVisible();
    await page.evaluate(() => {
        const e = new Event('beforeinstallprompt');
        /** @type {any} */ (e).prompt = () => Promise.resolve();
        window.dispatchEvent(e);
    });
    await page.waitForTimeout(600);
    await expect(page.locator('#installPrompt')).toBeHidden();
});

test('install strip: on desktop it leaves the browser its OWN install offer', async ({ page }) => {
    // The strip is hidden at desktop widths, so capturing `beforeinstallprompt` there would suppress
    // Chrome's omnibox promotion and put nothing in its place. The observable half of that rule is
    // that the event is NOT preventDefault()ed — which is why this asserts on the event, not the DOM.
    await armInstall(page, { width: 1280 }).catch(() => { /* the strip never shows; that is the point */ });
    const prevented = await page.evaluate(() => {
        const e = new Event('beforeinstallprompt', { cancelable: true });
        /** @type {any} */ (e).prompt = () => Promise.resolve();
        window.dispatchEvent(e);
        return e.defaultPrevented;
    });
    expect(prevented).toBe(false);
    await expect(page.locator('#installPrompt')).toBeHidden();
});
