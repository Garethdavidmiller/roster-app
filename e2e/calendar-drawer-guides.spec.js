/**
 * calendar-drawer-guides.spec.js — the Calendar (index.html): the drawer, the guide links and the
 * guide search, the telemetry the Calendar sends, and the bug report.
 *
 * Split by feature out of calendar.spec.js on 25 Nov 2026, test for test and unchanged; what more than
 * one calendar-*.spec.js file needs is in calendar-helpers.js. Every file keeps the old file's
 * `beforeEach`, so each test still starts signed in as a member. The Calendar's access gate is
 * calendar-access.spec.js.
 */
import { test, expect } from './fixtures.js';
import { seedSession, seedMember, openGuideLink, seedCalendarMember, seedMemberSession } from './helpers.js';
import { openGuideSearch } from './calendar-helpers.js';

// ── Calendar access ─────────────────────────────────────────────────────────────────────────────
// The Calendar opens only for a signed-in member (since the staff PIN was retired, 23 Nov 2026; from
// v20.12 the PIN opened it too), so a spec that simply loads index.html gets the sign-in card and none
// of the roster. Every test in this file is about what the Calendar DOES once it is open, not about
// the gate, so each page starts signed in as a member with no calendar picked on this device
// (`seedCalendarMember`) — the member's own calendar. Until the PIN went it started on a PIN viewer,
// whose `getSession()` was null; the tests that existed only for that state (the first-run prompt,
// the station PC's Team View and bug report) went with it. The gate itself is calendar-access.spec.js.
test.beforeEach(async ({ page }) => { await seedCalendarMember(page); });

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
    await expect(page.locator('#navGuideSearchStatus')).toHaveText('No matches in the guides — try a different word');
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

test('guide search: re-expanding Reference does not bring the full list back UNDER the results', async ({ page }) => {
    // The filter is applied by hiding the static list; the Reference toggle used to set
    // `hidden = false` unconditionally on expand, so collapsing and re-opening the section left the
    // reader looking at the five results AND all six static rows — the query still in the box, and
    // visibly ignored. Both halves are asserted: an ACTIVE query keeps the list hidden, and an empty
    // one must still bring it back, or the fix would simply have broken the section the other way.
    const input = await openGuideSearch(page);
    await input.fill('gold card');
    await expect(page.locator('#navGuidesList')).toBeHidden();
    await page.locator('#navGuidesToggle').click();   // collapse
    await page.locator('#navGuidesToggle').click();   // re-expand
    await expect(page.locator('#navGuideSearchResults')).toBeVisible();
    await expect(page.locator('#navGuidesList')).toBeHidden();
    await expect(input).toHaveValue('gold card');

    await input.fill('');
    await page.locator('#navGuidesToggle').click();
    await page.locator('#navGuidesToggle').click();
    await expect(page.locator('#navGuidesList')).toBeVisible();
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
/** Rewrite usage-reporter.js so recordUsage records its arguments. A missing anchor THROWS: a silent
 *  no-op here would leave a green test that had stopped testing the wiring. @param {import('@playwright/test').Page} page */
async function recordUsageCalls(page) {
    const ANCHOR = 'export function recordUsage(page, signedIn = null, selected = null) {';
    await page.route('**/usage-reporter.js', async route => {
        const res = await route.fetch();
        const src = await res.text();
        if (!src.includes(ANCHOR)) {
            throw new Error(`calendar: recordUsage anchor no longer matches — "${ANCHOR}". Re-point it.`);
        }
        const body = src.replace(ANCHOR, ANCHOR
            + '\n    (window.__E2E ||= {}).usageCalls = [...(window.__E2E.usageCalls || []), { page, signedIn, selected }];');
        await route.fulfill({ response: res, body, contentType: 'text/javascript' });
    });
}

test('calendar: origin telemetry gets the member signed in and, apart, the calendar shown', async ({ page }) => {
    // TWO ARGUMENTS SINCE v25.00. The selection is the dedup key for the origin and account metrics,
    // and it is passed SECOND, where it can never exclude; the identity that excludes is the session.
    // (Until the staff PIN was retired a signed-out station PC sent `signedIn: null` here; only a
    // member opens the Calendar now, so the two tests of that case went with it.)
    await recordUsageCalls(page);
    await seedMember(page, 'S. Silva');   // the beforeEach's member, looking at a colleague's calendar
    await page.goto('/');
    await expect(page.locator('#calendarDisplay')).toBeVisible();
    await expect.poll(async () => (await page.evaluate(() => window.__E2E?.usageCalls?.length)) || 0)
        .toBeGreaterThan(0);
    const call = await page.evaluate(() => window.__E2E.usageCalls.find(c => c.page === 'calendar'));
    expect(call).toEqual({ page: 'calendar', signedIn: 'G. Miller', selected: 'S. Silva' });
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
    const ANCHOR = 'export function recordOpen(itemId, signedIn = null) {';
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
        ['Rangers & Rovers Guide', 'guide-rangers'],
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

test('about: a bug report says whether it came from the installed app, and asks an iPhone for its iOS', async ({ page }) => {
    // From iOS 26 the user agent says 18_7 whatever the phone runs, and it reads the same in the
    // installed app and in Safari — so a report from an iPhone could say neither. Both stubbed, so
    // the answer does not depend on which engine runs this.
    await seedMember(page);
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true });
        Object.defineProperty(navigator, 'userAgent', { configurable: true,
            get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' });
    });
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.locator('.title-icon').first().click();
    await expect(page.locator('#iconLightbox')).toHaveClass(/open/);
    const body = await page.locator('#bugReportLink').evaluate(a =>
        new URL(/** @type {HTMLAnchorElement} */ (a).href).searchParams.get('body') || '');
    expect(body).toContain('Installed app: yes');
    const ask = body.indexOf('iOS version (Settings → General → About):');
    expect(ask, 'an iPhone report does not ask for the iOS version').toBeGreaterThan(-1);
    expect(ask, 'the line to fill in is buried in the auto-filled block').toBeLessThan(body.indexOf('— Auto-filled —'));
});

test('about: a bug report from a desktop browser says it was not the installed app, and asks nothing', async ({ page }) => {
    await seedMember(page);
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => undefined });
        Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => 0 });
        Object.defineProperty(navigator, 'userAgent', { configurable: true,
            get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' });
    });
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.locator('.title-icon').first().click();
    await expect(page.locator('#iconLightbox')).toHaveClass(/open/);
    const body = await page.locator('#bugReportLink').evaluate(a =>
        new URL(/** @type {HTMLAnchorElement} */ (a).href).searchParams.get('body') || '');
    expect(body).toContain('Installed app: no');
    expect(body).not.toContain('iOS version');
    expect(body).toContain('Browser: Mozilla/5.0 (Windows NT 10.0');
});

// THE BUG REPORT SAYS WHO SENT IT (18 Nov 2026). Its "User:" line named the member whose calendar was on
// screen — a colleague's as often as not — where every other page names the signed-in member. It names
// the reporter now, and the calendar shown is a line of its own. Names are read
// from the page or invented, never taken from the roster.
/** The bug report's body, as the About panel's link carries it. @param {import('@playwright/test').Page} page */
async function bugReportBody(page) {
    await page.locator('.title-icon').first().click();
    await expect(page.locator('#iconLightbox')).toHaveClass(/open/);
    return page.locator('#bugReportLink').evaluate(a => new URL(/** @type {HTMLAnchorElement} */ (a).href).searchParams.get('body') || '');
}

test('about: the Calendar\'s bug report names the member signed in, and whose calendar was shown, apart', async ({ page }) => {
    // Signed in under an invented name, which is not on the roster, so the Calendar shows somebody
    // else's calendar: the two lines must name two different people.
    await seedMemberSession(page, 'A. Person');
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    const shown = ((await page.locator('#teamMemberSelect option:checked').textContent()) ?? '').trim();
    expect(shown, 'premise: the calendar on screen is not the reporter\'s').not.toBe('A. Person');
    const lines = (await bugReportBody(page)).split('\n');
    expect(lines, 'the report named the calendar on screen as its sender').toContain('User: A. Person');
    expect(lines).toContain(`Calendar shown: ${shown}`);
});
