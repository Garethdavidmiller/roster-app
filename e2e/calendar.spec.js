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
// The staff PIN is switched OFF in the shipped config while the feature is deployed dark
// (v20.17). Turn it on here so these keep covering the configuration the app is heading for,
// and seed a viewer session to satisfy it — otherwise every calendar test silently starts
// running against the old open model and the gate goes untested.
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
    const before = await page.locator('.month-year').textContent();
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
                (b) => document.querySelector('.month-year')?.textContent !== b,
                before, { timeout: 2000 });
            return;
        } catch { /* swallowed gesture — try again */ }
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
// the case it gets wrong, because `'./paycalc-guide.html'.includes('guide.html')` is TRUE.
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
     */
    const INK_TOLERANCE_PX = 3;
    await seedSession(page);
    await seedMember(page);
    await page.goto('/operations.html');   // a page whose pill is IN the row, so a current pill exists
    await page.locator('#navMenuBtn').click();
    await expect(page.locator('.nav-panel-pill').first()).toBeVisible();

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
