import { test, expect, enforceNamedSession, enableInplaceLogin, enableCalendarPin } from './fixtures.js';
import { collectFatalErrors, seedSession, seedMember, pickFirstMemberAndPassword, DESKTOP_WIDTHS, armEnforcementWithFailingSignIn, signInThroughOverlay, openGuideLink, seedViewerAccess } from './helpers.js';

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


// ── The password notice must reach members who have NEVER signed in (v19.89) ─────────────────────
// That is its entire audience: `password-force.js` already compels anyone who signs in, so the only
// people a notice can add are the ones who never do. The skill's actionable-notice template opens
// with `if (!getSession()) return`, and copying that in — which looks like tidying, and would pass
// review — hides this notice from everybody it was written for while leaving it working for people
// who did not need it. Hence a test on the SIGNED-OUT case specifically.
test('calendar: the password notice shows to a member with no session', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedMember(page, 'S. Silva');                 // a chosen member, deliberately NO session
    await page.goto('/');
    await expect(page.locator('#pwNoticeLb.visible')).toBeVisible({ timeout: 8000 });

    // Archived on OPEN, not on close: the CTA navigates away, so `onClose` may never fire.
    const archived = await page.evaluate(() => localStorage.getItem('myb_app_notices') || '');
    expect(archived, 'must be in App Notices before the member can navigate away').toContain('pw-own-2026');

    await page.locator('#pwNoticeLater').click();
    await expect(page.locator('#pwNoticeLb.visible')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('myb_notice_pw_own_2026_snooze')),
        'closing snoozes rather than dismissing for good').toBeTruthy();
});

test('calendar: the password notice stays away once dismissed for good', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedMember(page, 'S. Silva');
    await page.addInitScript(() => localStorage.setItem('myb_notice_pw_own_2026_done', '1'));
    await page.goto('/');
    await expect(page.locator('#calendarDisplay')).toBeVisible();
    await page.waitForTimeout(2200);                    // past the 1500ms deferred open
    await expect(page.locator('#pwNoticeLb.visible')).toBeHidden();
});
