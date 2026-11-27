/**
 * calendar-documents.spec.js — the Calendar (index.html): the Daily Huddle, the Weekly Retail Circular
 * and the Marylebone Newsletter — the buttons, the drawer, the viewers and their links.
 *
 * Split by feature out of calendar.spec.js on 25 Nov 2026, test for test and unchanged; what more than
 * one calendar-*.spec.js file needs is in calendar-helpers.js. Every file keeps the old file's
 * `beforeEach`, so each test still starts signed in as a member. The Calendar's access gate is
 * calendar-access.spec.js.
 */
import { test, expect, isoDaysAgo, withKnownNewsletter, withServerNewsletter } from './fixtures.js';
import { NEWSLETTER_LATEST_KEY } from '../newsletter-recency.js';
import { seedMember, seedCalendarMember, seedMemberSession, isTouchProject, clickInView, trackEndpointUse, endpointUse } from './helpers.js';

// ── Calendar access ─────────────────────────────────────────────────────────────────────────────
// The Calendar opens only for a signed-in member (since the staff PIN was retired, 23 Nov 2026; from
// v20.12 the PIN opened it too), so a spec that simply loads index.html gets the sign-in card and none
// of the roster. Every test in this file is about what the Calendar DOES once it is open, not about
// the gate, so each page starts signed in as a member with no calendar picked on this device
// (`seedCalendarMember`) — the member's own calendar. Until the PIN went it started on a PIN viewer,
// whose `getSession()` was null; the tests that existed only for that state (the first-run prompt,
// the station PC's Team View and bug report) went with it. The gate itself is calendar-access.spec.js.
test.beforeEach(async ({ page }) => { await seedCalendarMember(page); });

// THE DOCUMENT VIEWER'S TITLE SITS ON THE ✕ LINE (polish round 2) — the day panel's shape. It used to
// sit below the button, leaving a 50px band above it with nothing in it but the ✕. Two things to hold
// at once: vertically the title's first line shares the ✕'s band, and horizontally no glyph of it
// reaches the ✕'s 44px target — the longest name, "🗞️ Marylebone Newsletter", is the one to try.
// The widths are chosen, not sampled: the title only nears the ✕ where it JUST fits on one line, and
// that happens at a different width for each side padding (≈350px at 16px, ≈380 at 30, ≈402 at 40).
// At the widths either side of that it wraps or has room to spare, and any padding passes.
for (const width of [320, 350, 380, 402, 1280]) {
    test(`calendar: the Newsletter viewer's title shares the ✕ line and stays clear of it @${width}`, async ({ page }) => {
        await seedMember(page);
        await page.setViewportSize({ width, height: 800 });
        await page.goto('/index.html#newsletter');
        await expect(page.locator('#docViewer')).toBeVisible();
        await expect(page.locator('#docViewerTitle')).toContainText('Newsletter');
        const g = await page.evaluate(() => {
            const x = /** @type {HTMLElement} */ (document.getElementById('docViewerClose')).getBoundingClientRect();
            const t = /** @type {HTMLElement} */ (document.getElementById('docViewerTitle'));
            const range = document.createRange();
            range.selectNodeContents(t);
            const rects = [...range.getClientRects()].filter(r => r.width > 0);
            return {
                closeTop: x.top, closeBottom: x.bottom, closeLeft: x.left,
                firstMid: (rects[0].top + rects[0].bottom) / 2,
                textRight: Math.max(...rects.map(r => r.right)),
            };
        });
        expect(g.firstMid, 'the title\'s first line must sit within the ✕ band, not beneath it')
            .toBeGreaterThan(g.closeTop);
        expect(g.firstMid).toBeLessThan(g.closeBottom);
        expect(g.textRight, 'no part of the title may reach the ✕ touch target')
            .toBeLessThanOrEqual(g.closeLeft);
    });
}

// ── THE HUDDLE BUTTON WORKS THE MOMENT IT IS DRAWN (v24.23) ────────────────────────────────────────
//
// v24.19 drew "📄 Open Huddle" and only attached its click handler AFTER a short-lived link came back
// from the server — up to eight seconds on a cold function, longer on a weak signal — so a member who
// tapped straight away got a button that did nothing. The link request is HELD open here for the whole
// test, which is the case that broke: the tap must still open the Huddle, on the stored url, at once.
// A Daily Huddle tap with nothing to show used to do NOTHING — the hash handler opened only on a
// loaded Huddle — and stayed armed, so one arriving later opened over whatever the member was doing.
// ── LESS MOTION MEANS THE HUDDLE APPEARS, NOT SLIDES (whole-app review, 10 Nov 2026) ─────────────
// Every lightbox on this page opens without movement for a member who has asked for reduced motion;
// the Huddle viewer, its own full-screen panel, still slid up the screen's whole height. Sampled every
// frame from the tap, one-shot: its top edge must never leave the top of the screen. The first EIGHT frames
// it is visible in, not a fixed 400ms: WebKit delivers no frame for 250–400ms as the panel opens, so 400ms held
// one or two there (10 Nov 2026). Its first visible frame is where a slide shows: 720px down without the rule.
test('huddle: with reduced motion the viewer appears in place, and still closes', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true, huddleEmpty: true }; });
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    const tops = await page.evaluate(() => new Promise((resolve) => {
        const v = /** @type {HTMLElement} */ (document.getElementById('huddleViewer'));
        /** @type {number[]} */ const seen = [];
        const t0 = performance.now();
        const tick = () => {
            if (v.classList.contains('visible')) seen.push(Math.round(v.getBoundingClientRect().top));
            if (seen.length < 8 && performance.now() - t0 < 2000) requestAnimationFrame(tick); else resolve(seen);
        };
        location.hash = '#huddle';
        requestAnimationFrame(tick);
    }));
    expect(tops.length, 'premise: the viewer opened').toBeGreaterThan(3);
    expect(Math.max(...tops), 'the panel slid in from below').toBe(0);
    await page.locator('#huddleViewerClose').click();
    await expect(page.locator('#huddleViewer')).not.toHaveClass(/visible/);
});

test('huddle: a tap with no Huddle uploaded says so', async ({ page }) => {
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true, huddleEmpty: true }; });
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.evaluate(() => { location.hash = '#huddle'; });
    await expect(page.locator('#huddleViewerBody')).toContainText('No Daily Huddle has been uploaded yet');
    await page.locator('#huddleViewerClose').click();
    await expect(page.locator('#huddleViewer')).not.toHaveClass(/visible/);
});

// The day plan is a Tab stop, so a keyboard can scroll it, and it is the box that clips, so its ring is drawn
// inside it. One home for that: index.css (#huddleViewerBody:focus-visible) — the markup carried the same value as
// an inline style as well, which is two places to change and a style the page applied when nothing was focused.
test('huddle: the day plan\'s keyboard ring is drawn inside its box, from the stylesheet alone', async ({ page }) => {
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true, huddleEmpty: true }; });
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.evaluate(() => { location.hash = '#huddle'; });
    const body = page.locator('#huddleViewerBody');
    await expect(body).toContainText('No Daily Huddle has been uploaded yet');
    expect(await body.getAttribute('style'), 'the markup styles the box itself').toBeNull();
    await page.locator('#huddleViewerClose').focus();
    await page.keyboard.press('Tab');   // a keyboard arrival, so :focus-visible draws the ring
    const m = await body.evaluate(el => {
        const cs = getComputedStyle(el);
        return { focused: el === document.activeElement && el.matches(':focus-visible'), style: cs.outlineStyle, offset: cs.outlineOffset };
    });
    expect(m.focused, 'premise: Tab from the ✕ lands on the day plan').toBe(true);
    expect(m.style, 'a ring is drawn').not.toBe('none');
    expect(m.offset, 'inside the box that clips it').toBe('-2px');
});

// THE DRAWER TAKES ITS HISTORY ENTRY WITH IT (shared-ui-3; cal-docs-8, the drawer half). The Daily Huddle
// link is a hash on this page, and the drawer only FORGOT the entry it had pushed rather than popping it,
// so after reading the Huddle the first Back press landed on that entry: the same Calendar, nothing moved.
// With the viewer taking its own tap's entry back as well ("a tap leaves no dead Back press", below), ONE
// press after a Huddle opened from the drawer leaves the Calendar. Asserted where the member LANDS: a walk
// over the entries' states cannot see the entry it starts on, which is where the leftover now sits.
test('huddle: opened from the drawer and closed, one Back press leaves the Calendar', async ({ page }) => {
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true, huddleEmpty: true }; });
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/railcard-guide.html');
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.locator('#navMenuBtn').click();
    await page.locator('#navPanel a[href="./#huddle"]').click();
    await expect(page.locator('#huddleViewerBody')).toContainText('No Daily Huddle has been uploaded yet');
    const echoed = page.evaluate(() => new Promise(r => addEventListener('popstate', () => r(true), { once: true })));
    await page.locator('#huddleViewerClose').click();
    await echoed;                                            // the close's own Back has landed
    await page.evaluate(() => history.back());
    await expect(page, 'a Back press after the Huddle did nothing: it landed on the drawer\'s leftover entry')
        .toHaveURL(/railcard-guide\.html/);
});

// A NOTIFICATION TAPPED WITH THE DRAWER OPEN LEAVES NO DEAD BACK EITHER (18 Nov 2026). A tap is a hash navigation
// pushed ON TOP of the drawer's own entry. The drawer read its popstate as Back and closed, but its entry stayed
// beneath the tap's; the viewer took the tap's entry off, and once the viewer was closed one Back press landed on
// the drawer's leftover: the same Calendar, nothing moved. The tap is a hash change, as the tests above make it.
test('huddle: a notification tapped with the drawer open, then the viewer closed — one Back press leaves the Calendar', async ({ page }) => {
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true, huddleEmpty: true }; });
    await seedMemberSession(page);
    await page.goto('/railcard-guide.html');
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.locator('#navMenuBtn').click();
    await expect(page.locator('#navPanel')).toHaveClass(/\bopen\b/);
    await page.evaluate(() => { location.hash = '#huddle'; });   // the service worker's navigate of the open window
    await expect(page.locator('#huddleViewerBody')).toContainText('No Daily Huddle has been uploaded yet');
    await expect(page.locator('#navPanel'), 'the tap closes the drawer').not.toHaveClass(/\bopen\b/);
    await page.locator('#huddleViewerClose').click();
    await expect(page.locator('#huddleViewer')).not.toHaveClass(/visible/);
    await expect.poll(() => page.evaluate(() => history.state?.mybNavPanel ?? null),
        { message: 'the reader was left on the drawer\'s entry, where a Back press does nothing' }).toBeNull();
    await page.evaluate(() => history.back());
    await expect(page, 'one Back press leaves the Calendar').toHaveURL(/railcard-guide\.html/);
});

// …and from any OTHER page the link loads the Calendar, so the drawer's entry is REPLACED, as a page
// pill's is: Back from the Calendar lands where the member was before opening the drawer.
test('huddle: opened from another page\'s drawer, Back returns to that page past no drawer entry', async ({ page }) => {
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true, huddleEmpty: true }; });
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/settings.html');
    await expect(page.locator('#navMenuBtn[data-nav-panel-init]')).toBeAttached({ timeout: 15_000 });
    await page.evaluate(() => history.replaceState({ ...(history.state ?? {}), e2eBase: true }, ''));
    await page.locator('#navMenuBtn').click();
    await page.locator('#navPanel a[href="./#huddle"]').click();
    await expect(page.locator('#huddleViewerBody')).toContainText('No Daily Huddle has been uploaded yet', { timeout: 15_000 });
    await page.locator('#huddleViewerClose').click();
    await expect(page.locator('#huddleViewer')).not.toHaveClass(/visible/);
    for (let i = 0; i < 4 && !page.url().includes('/settings.html'); i++) await page.goBack();
    expect(page.url()).toContain('/settings.html');
    expect(await page.evaluate(() => history.state), 'Back landed on the drawer\'s leftover entry, not the page')
        .toEqual(expect.objectContaining({ e2eBase: true }));
});

test('huddle: a tap on a Huddle that could not be read offers Try again, which re-reads', async ({ page }) => {
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true, huddleError: true }; });
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.evaluate(() => { location.hash = '#huddle'; });
    await expect(page.locator('#huddleViewerBody')).toContainText("Couldn’t load the Daily Huddle");
    const subs = () => page.evaluate(() => /** @type {any} */ (window).__E2E?.snapshotSubs || 0);
    const before = await subs();
    await page.locator('#huddleRetryBtn').click();
    await expect.poll(subs).toBeGreaterThan(before);
    await expect(page.locator('#huddleViewerBody'), 'a retry that fails again says so again').toContainText("Couldn’t load the Daily Huddle");
});

// A COLD tap — the notification that opened the page — used to settle silently: the message needed
// the viewer already up, which a cold tap never has. It then stayed armed, so a later resubscribe
// opened the Huddle over whatever the member had moved on to.
test('huddle: a cold tap on a Huddle that could not be read is answered, and closing it disarms', async ({ page }) => {
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true, huddleError: true }; });
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/#huddle');
    await expect(page.locator('#huddleViewerBody')).toContainText("Couldn’t load the Daily Huddle", { timeout: 15_000 });
    await page.locator('#huddleViewerClose').click();
    await expect(page.locator('#huddleViewer')).not.toHaveClass(/visible/);
});

test('huddle: a cold tap with no Huddle uploaded says so, once the server has', async ({ page }) => {
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true, huddleEmpty: true }; });
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/#huddle');
    await expect(page.locator('#huddleViewerBody')).toContainText('No Daily Huddle has been uploaded yet', { timeout: 15_000 });
});

// ── THE SIGNED LINK MUST BE FOR THE FILE ON SCREEN (v24.33, external review of v24.32) ─────────────
// The server signs whatever is latest when IT looks; the page holds whatever was latest when Firestore
// was read. An upload between the two made them different files. The server now names the file it
// signed, and each surface passes the path of the document it holds — these pin that WIRING, which the
// storage-utils unit tests cannot see (deleting a caller's `storagePath:` leaves them all green).
const DOC_STORED = 'https://firebasestorage.googleapis.com/v0/b/myb-roster.appspot.com/o/x.pdf?alt=media&token=e2e';
const DOC_SIGNED = 'https://storage.googleapis.com/myb-roster.appspot.com/x.pdf?X-Goog-Expires=900';
const signedFor = (/** @type {string} */ storagePath) => JSON.stringify(
    { url: DOC_SIGNED, expiresAt: Date.now() + 10 * 60_000, fileType: 'pdf', storagePath });

for (const [held, signed, expected] of [
    ['huddles/2026-09-25-a.pdf', 'huddles/2026-09-26-b.pdf', 'stored'],
    ['huddles/2026-09-25-a.pdf', 'huddles/2026-09-25-a.pdf', 'signed'],
]) {
    test(`huddle: a signed link for ${expected === 'stored' ? 'a DIFFERENT upload is passed over' : 'the same upload is used'}`, async ({ page }) => {
        await page.addInitScript(([stored, path]) => {
            window.__E2E = { ...(window.__E2E || {}), authUser: true,
                huddleDoc: { date: '2026-09-25', storageUrl: stored, fileType: 'pdf', storagePath: path } };
            /** @type {any} */ (window).__opened = [];
            window.open = /** @type {any} */ ((url) => { /** @type {any} */ (window).__opened.push(String(url)); return null; });
        }, [DOC_STORED, held]);
        await page.route('**/getDocumentUrl', route => route.fulfill({ contentType: 'application/json', body: signedFor(signed) }));
        await trackEndpointUse(page, 'getDocumentUrl');
        await seedMemberSession(page, 'G. Miller');
        await page.goto('/#huddle');
        const btn = page.locator('#huddleOpenFileBtn');
        await expect(btn).toBeVisible({ timeout: 15_000 });
        // THE MINTED LINK HAS LANDED ON THE BUTTON, waited for rather than slept past (test audit,
        // 7 Nov 2026). This was a 200ms sleep, and the 'stored' case could not fail with it: a tap
        // that beats the mint opens the stored url anyway (the test below shows an early tap does
        // exactly that), so on a slow runner it passed whether or not the same-file check worked.
        // The body read is counted a task after it resolves, and the viewer's `signed = minted` is
        // in the microtasks before that — so from here the click resolves against the signed link.
        await expect.poll(async () => (await endpointUse(page, 'getDocumentUrl')).bodiesRead,
            { message: 'the page never finished reading the signed link' }).toBeGreaterThan(0);
        await btn.click();
        await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__opened), { timeout: 3000 })
            .toEqual([expected === 'stored' ? DOC_STORED : DOC_SIGNED]);
    });

    test(`drawer Circular: a signed link for ${expected === 'stored' ? 'a DIFFERENT upload is passed over' : 'the same upload is used'}`, async ({ page }) => {
        await page.addInitScript(() => {
            window.__E2E = { ...(window.__E2E || {}), authUser: true };
            /** @type {any} */ (window).__opened = [];
            // The drawer opens a blank tab ON the gesture and sets its location once the url is known.
            window.open = /** @type {any} */ (() => ({ opener: null, close() {},
                location: { set href(v) { /** @type {any} */ (window).__opened.push(String(v)); } } }));
        });
        await page.route('**/getDocumentUrl', route => route.fulfill({ contentType: 'application/json',
            body: signedFor(signed.replace('huddles/', 'circulars/')) }));
        await seedMemberSession(page, 'G. Miller');
        await page.goto('/');
        await expect(page.locator('#calendarDisplay')).toBeVisible({ timeout: 15_000 });
        // Seeded only now: the "latest" query has no path, so it reads the shared rows — and so would
        // the Calendar's own reads if these were there from the start.
        await page.evaluate(([stored, path]) => {
            /** @type {any} */ (window).__E2E.docs = [{ id: '2026-09-25', date: '2026-09-25',
                storageUrl: stored, fileType: 'pdf', storagePath: path }];
        }, [DOC_STORED, held.replace('huddles/', 'circulars/')]);
        await page.locator('#navMenuBtn').click();
        await page.locator('#navPanel .nav-panel-link--circular').click();
        await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__opened), { timeout: 10_000 })
            .toEqual([expected === 'stored' ? DOC_STORED : DOC_SIGNED]);
    });
}

// ── NO TAB CAME BACK: THE APP STAYS AROUND THE DOCUMENT (v24.61, iOS audit B5) ─────────────────────
// In a home-screen app on iOS the drawer's blank `window.open` can return null. The old fallback
// navigated THIS page to the storage url — a bare PDF with no header, no drawer and no way back but
// the OS. Now the in-app viewer opens instead, whose Open button is a real tap on a real document.
test('drawer Circular: when no tab comes back, the in-app viewer opens and this page never leaves for the storage origin', async ({ page }) => {
    await page.addInitScript(() => {
        window.__E2E = { ...(window.__E2E || {}), authUser: true };
        window.open = /** @type {any} */ (() => null);
    });
    await page.route('**/getDocumentUrl', route => route.fulfill({ contentType: 'application/json', body: signedFor('circulars/2026-09-25-a.pdf') }));
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/');
    await expect(page.locator('#calendarDisplay')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(([stored, path]) => {
        /** @type {any} */ (window).__E2E.docs = [{ id: '2026-09-25', date: '2026-09-25', storageUrl: stored, fileType: 'pdf', storagePath: path }];
    }, [DOC_STORED, 'circulars/2026-09-25-a.pdf']);
    await page.locator('#navMenuBtn').click();
    await page.locator('#navPanel .nav-panel-link--circular').click();
    await expect(page.locator('#docViewer')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#docViewerBody').getByRole('button', { name: /Open/ })).toBeVisible({ timeout: 10_000 });
    expect(page.url(), 'the page is still the app').not.toContain('firebasestorage');
    await expect(page.locator('#navPanel')).not.toHaveClass(/open/);
});

// THE SAME HAND-OVER FROM ADMIN ASKS ABOUT UNSAVED WORK FIRST (v25.06, whole-app review). It left by
// `location.href`, which the drawer's unsaved-changes question does not watch — and on the iOS app,
// where no tab comes back, no unload prompt exists either: staged rows went without a word.
test('drawer Circular on Admin: when no tab comes back, staged edits are asked about before leaving', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-08-27T09:00:00Z'));
    await page.addInitScript(() => {
        window.__E2E = { ...(window.__E2E || {}), authUser: true };
        window.open = /** @type {any} */ (() => null);
    });
    await page.route('**/getDocumentUrl', route => route.fulfill({ contentType: 'application/json', body: signedFor('circulars/2026-09-25-a.pdf') }));
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    const row = page.locator('.day-row').filter({ has: page.locator('.type-pill-btn[data-type="shift"]:not([disabled])') }).first();
    await clickInView(row.locator('.type-pill-btn[data-type="shift"]'));
    await row.locator('.day-start').fill('06:00');
    await row.locator('.day-end').fill('14:00');
    await page.evaluate(([stored, path]) => {
        /** @type {any} */ (window).__E2E.docs = [{ id: '2026-09-25', date: '2026-09-25', storageUrl: stored, fileType: 'pdf', storagePath: path }];
    }, [DOC_STORED, 'circulars/2026-09-25-a.pdf']);
    await page.locator('#navMenuBtn').click();
    await page.locator('#navPanel .nav-panel-link--circular').click();
    await expect(page.getByText('Your unsaved changes on this page will be lost.', { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page, 'Cancel must keep the page').toHaveURL(/admin\.html/);
    await expect(row.locator('.day-start')).toHaveValue('06:00');
    // The question stops the click before the drawer's own handler, so the drawer is still OPEN — and
    // the link that carried the hand-off sits in it. It must not be ON SCREEN as an empty, focusable
    // row: the drawer link's own display beat [hidden] (48-hour review, Nov 2026).
    await expect(page.locator('#navPanel')).toHaveClass(/open/);
    await expect(page.locator('#navPanel a[data-doc-handoff]')).toHaveCount(1);
    await expect(page.locator('#navPanel a[data-doc-handoff]')).toBeHidden();
});

test('huddle: offline with nothing cached, a tap says it could not load — never "none uploaded"', async ({ page }) => {
    // 48-hour review: an empty answer from the local cache alone is what the SDK raises OFFLINE, and
    // the warm tap turned it into "No Daily Huddle has been uploaded yet" — a claim about the world
    // the device could not have checked.
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true, huddleEmpty: 'cache' }; });
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/');
    await expect(page.locator('#calendarDisplay')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(300);   // the cache-only snapshot has landed
    await page.evaluate(() => { location.hash = '#huddle'; });
    const body = page.locator('#huddleViewerBody');
    await expect(body).toContainText("Couldn’t load the Daily Huddle", { timeout: 10_000 });
    await expect(body).not.toContainText('No Daily Huddle has been uploaded yet');
});

test('circular: offline with nothing cached, the viewer and the drawer say they could not connect — never "none uploaded"', async ({ page }) => {
    // The Huddle's rule, which the one-shot Circular/Newsletter read never got (documents-client.js →
    // `latestIn`, whole-app review 10 Nov 2026): an empty answer from the cache alone is a read that failed.
    // The drawer half is the Newsletter's read, so the Calendar's check is given a recent issue to show
    // its button by; the device then goes offline with nothing of it cached.
    await withServerNewsletter(page, isoDaysAgo(3));
    await page.addInitScript(() => {
        window.__E2E = { ...(window.__E2E || {}), authUser: true };
        window.open = /** @type {any} */ (() => ({ opener: null, close() {}, location: {} }));
    });
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/');
    await expect(page.locator('#calendarDisplay')).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), NEWSLETTER_LATEST_KEY), { message: 'premise: the Calendar found the issue' })
        .toBe(isoDaysAgo(3));
    await page.evaluate(() => {   // offline from here, with nothing of the Newsletter cached
        const e2e = /** @type {any} */ (window).__E2E;
        e2e.docsFromCache = true; e2e.docsByQuery.newsletters = null;   // null: the stub's empty snapshot
    });
    await page.evaluate(() => { location.hash = '#circular'; });
    const body = page.locator('#docViewerBody');
    await expect(body).toContainText('Couldn’t load this document.', { timeout: 10_000 });
    await expect(body).not.toContainText('has been uploaded yet');
    await page.keyboard.press('Escape');
    await expect(page.locator('#docViewer')).not.toHaveClass(/visible/);
    await page.locator('#navMenuBtn').click();
    await page.locator('#navPanel .nav-panel-link--newsletter').click();
    await expect(page.locator('#navComingSoonLightbox')).toContainText('Couldn’t connect', { timeout: 10_000 });
    await expect(page.locator('#navComingSoonLightbox')).not.toContainText('has been uploaded yet');
});

// ── THE NEWSLETTER'S ☰ BUTTON FOLLOWS ITS LATEST ISSUE (owner, 14 Nov 2026) ─────────────────────────────
// It shows while the latest issue is under six weeks old, and comes back with the next upload
// (newsletter-recency.js). The Calendar asks as its documents open; every page's drawer reads the answer
// this device keeps, again at every open. A device that has never asked offers no issue. Each test sets
// the state it is about: the answer the device holds, or the issue the server has.
const STORED_KEY = NEWSLETTER_LATEST_KEY;
const drawerDocs = (/** @type {import('@playwright/test').Page} */ page) => page.locator('#navPanel .nav-panel-links').first().locator('.nav-panel-link');
const newsletterRow = (/** @type {import('@playwright/test').Page} */ page) => page.locator('#navPanel .nav-panel-link--newsletter');
/** The open drawer's Latest list, read off the screen: with the Newsletter last, or without it. Named in
 *  full both ways, so "hidden" cannot pass on a drawer that has not opened yet (nothing in it is visible). */
const expectLatestDocs = (/** @type {import('@playwright/test').Page} */ page, /** @type {boolean} */ withNewsletter) =>
    expect(drawerDocs(page).filter({ visible: true })).toHaveText(withNewsletter
        ? [/Daily Huddle/, /Weekly Retail Circular/, /Marylebone Newsletter/]
        : [/Daily Huddle/, /Weekly Retail Circular/]);

test('newsletter: a device that has never asked offers no issue, and keeps the other two documents', async ({ page }) => {
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true }; });
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/admin.html');   // a page that does not ask
    await page.locator('#navMenuBtn').click();
    await expect(page.locator('#navPanel .nav-panel-link--circular')).toBeVisible();
    await expect(page.locator('#navPanel a.nav-panel-link[href="./#huddle"]')).toBeVisible();
    await expectLatestDocs(page, false);
});

for (const [label, issue, shown] of /** @type {[string, string, boolean][]} */ ([
    ['an issue three days old', isoDaysAgo(3), true],
    ['an issue 41 days old', isoDaysAgo(41), true],
    ['an issue six weeks old to the day', isoDaysAgo(42), false],
    ['none uploaded', '', false],
])) {
    test(`newsletter: ${label} this device knows of — ${shown ? 'on the ☰ menu, last of the three' : 'not on the ☰ menu'}`, async ({ page }) => {
        await withKnownNewsletter(page, issue);
        await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true }; });
        await seedMemberSession(page, 'G. Miller');
        await page.goto('/admin.html');
        // Drawn that way before it is ever opened, too: the row's own `hidden`, not only the open's refresh.
        await expect(newsletterRow(page).locator('xpath=..'), 'the row as first drawn').toHaveJSProperty('hidden', !shown);
        await page.locator('#navMenuBtn').click();
        await expectLatestDocs(page, shown);
    });
}

for (const [label, issue, shown] of /** @type {[string, string, boolean][]} */ ([
    ['a recent issue', isoDaysAgo(5), true],
    ['an issue six weeks old', isoDaysAgo(50), false],
    ['no issue at all', '', false],
])) {
    test(`newsletter: the Calendar asks as its documents open, and every page follows its answer — ${label}`, async ({ page }) => {
        // The device starts by knowing of an OLD issue, so a recent answer has to come from the read.
        await page.addInitScript(([k, v]) => { if (localStorage.getItem(k) === null) localStorage.setItem(k, v); }, [STORED_KEY, isoDaysAgo(90)]);
        await withServerNewsletter(page, issue);
        await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true }; });
        await seedMemberSession(page, 'G. Miller');
        await page.goto('/');
        await expect(page.locator('#calendarDisplay')).toBeVisible({ timeout: 15_000 });
        await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), STORED_KEY), { message: 'the Calendar did not keep the answer' })
            .toBe(issue);
        await page.locator('#navMenuBtn').click();
        await expectLatestDocs(page, shown);
        // …and a page that does not ask reads what the Calendar kept.
        await page.goto('/admin.html');
        await page.locator('#navMenuBtn').click();
        await expectLatestDocs(page, shown);
    });
}

// THE DATE BESIDE EACH DOCUMENT (owner, 27 Nov 2026): what the Calendar last heard, so a member can tell
// before opening whether it is the one they have read. A date the device has never heard is left out.
test('documents: the ☰ menu dates each latest document, and leaves out a date it does not know', async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 10, 27, 12, 0, 0) });
    await withKnownNewsletter(page, '2026-11-02');
    await page.addInitScript(() => { try { localStorage.setItem('myb_huddle_latest', '2026-11-28'); } catch { /* none */ } });
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true }; });
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/admin.html');   // a page that does not ask
    await page.locator('#navMenuBtn').click();
    await expect(page.locator('#navPanel a.nav-panel-link[href="./#huddle"] .nav-doc-date')).toHaveText('for Sat 28 Nov');
    await expect(newsletterRow(page).locator('.nav-doc-date')).toHaveText('Mon 2 Nov');
    await expect(page.locator('#navPanel .nav-panel-link--circular .nav-doc-date'), 'never heard: no date').toBeHidden();
    await expect(page.locator('#navPanel .nav-panel-link--circular')).toHaveText(/^\S+\s*Weekly Retail Circular$/);
});

// A HUDDLE THAT ARRIVES AFTER MIDDAY IS TOMORROW'S (owner, 27 Nov 2026): the flow files it under the day its email
// arrived, so the evening's Huddle is on file a day early. Through the real listener, the real record and the menu.
for (const [arrived, expected] of /** @type {const} */ ([['19:05', 'for Sat 28 Nov'], ['07:40', 'for Fri 27 Nov']])) {
    test(`documents: a Huddle that arrived at ${arrived} is named ${expected} in the ☰ menu`, async ({ page }) => {
        const [h, m] = arrived.split(':').map(Number);
        await page.clock.install({ time: new Date(Date.UTC(2026, 10, 27, 20, 0)) });
        await calendarWithHuddle(page, { date: '2026-11-27', storageUrl: 'https://firebasestorage.googleapis.com/v0/b/myb-roster.appspot.com/o/huddles%2F2026-11-27.pdf?alt=media&token=e2e',
            fileType: 'pdf', uploadedAt: Date.UTC(2026, 10, 27, h, m) });
        await seedMemberSession(page, 'G. Miller');
        await page.goto('/');
        await page.locator('#navMenuBtn').click();
        await expect(page.locator('#navPanel a.nav-panel-link[href="./#huddle"] .nav-doc-date')).toHaveText(expected);
    });
}

test('newsletter: an issue that turns six weeks old with the page open leaves the ☰ menu at the next open', async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 10, 14, 12, 0, 0) });
    await withKnownNewsletter(page, '2026-10-04');   // 41 days before 14 Nov
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true }; });
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.locator('#navMenuBtn').click();
    await expect(newsletterRow(page)).toBeVisible();
    await page.locator('#navPanelClose').click();
    await expect(page.locator('#navPanel')).not.toHaveClass(/open/);
    await page.clock.fastForward('24:00:00');   // 15 Nov: six weeks to the day
    await page.locator('#navMenuBtn').click();
    await expectLatestDocs(page, false);
});

test('newsletter: off the ☰ menu, a notification\'s #newsletter still opens the latest issue', async ({ page }) => {
    await withServerNewsletter(page, isoDaysAgo(60));
    await seedMember(page);
    await page.goto('/index.html#newsletter');
    await expect(page.locator('#docViewer')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#docViewerTitle')).toContainText('Marylebone Newsletter');
});

test('huddle: the Open button works immediately, while the short-lived link is still pending', async ({ page }) => {
    const STORED = 'https://firebasestorage.googleapis.com/v0/b/myb-roster.appspot.com/o/huddles%2F2026-09-25.pdf?alt=media&token=e2e';
    await page.addInitScript((stored) => {
        window.__E2E = { ...(window.__E2E || {}), authUser: true,
            huddleDoc: { date: '2026-09-25', storageUrl: stored, fileType: 'pdf' } };
        /** @type {any} */ (window).__opened = [];
        window.open = /** @type {any} */ ((url) => { /** @type {any} */ (window).__opened.push(String(url)); return null; });
    }, STORED);
    // The link request never answers — the slow signal, frozen.
    await page.route('**/getDocumentUrl', () => new Promise(() => {}));
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/#huddle');
    const btn = page.locator('#huddleOpenFileBtn');
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await btn.click();
    await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__opened), { timeout: 3000 })
        .toEqual([STORED]);
});

// ── THE HUDDLE VIEWER IN THE BROWSER (whole-app review, 10 Nov 2026) ──────────────────────────────
// What only a real browser shows: the history a tap leaves, what is drawn on top of what, the real
// sanitiser, and the keyboard. calendar-huddle-viewer.test.mjs drives the module's own seams.
const HUDDLE_PDF = 'https://firebasestorage.googleapis.com/v0/b/myb-roster.appspot.com/o/huddles%2F2026-09-25.pdf?alt=media&token=e2e';
/** A member's Calendar with a Huddle to deliver. @param {import('@playwright/test').Page} page @param {Record<string, any>} [doc] */
async function calendarWithHuddle(page, doc = {}) {
    await page.addInitScript((d) => {
        window.__E2E = { ...(window.__E2E || {}), authUser: true, huddleDoc: d };
        /** @type {any} */ (window).__opened = [];
        window.open = /** @type {any} */ ((url) => { /** @type {any} */ (window).__opened.push(String(url)); return null; });
    }, { date: '2026-09-25', storageUrl: HUDDLE_PDF, fileType: 'pdf', ...doc });
    await seedMemberSession(page, 'G. Miller');
}

test('huddle: a tap leaves no dead Back press behind it', async ({ page }) => {
    // The tap's own history entry was REWRITTEN into a second copy of the page, so after reading the
    // Huddle it took two Back presses to leave the Calendar (measured). One is right.
    await calendarWithHuddle(page);
    await page.goto('/railcard-guide.html');
    await page.goto('/');
    await expect(page.locator('#calendarDisplay')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => { location.hash = '#huddle'; });
    await expect(page.locator('#huddleOpenFileBtn')).toBeVisible({ timeout: 15_000 });
    const echoed = page.evaluate(() => new Promise(r => addEventListener('popstate', () => r(true), { once: true })));
    await page.locator('#huddleViewerClose').click();
    await echoed;                                            // the close's own Back has landed
    await page.evaluate(() => history.back());
    await expect(page, 'a Back press after the Huddle did nothing').toHaveURL(/railcard-guide\.html/);
});

/** Wait for the two viewers' own transitions to end — a viewer still sliding in is not where it will
 *  be, so what lies under a point is not settled until then. @param {import('@playwright/test').Page} page */
const viewersSettled = (page) => page.waitForFunction(() => document.getAnimations()
    .filter(a => /** @type {any} */ (a.effect)?.target?.closest?.('#huddleViewer, #docViewer'))
    .every(a => a.playState !== 'running'));

test('huddle: a Circular tap while the Huddle is open opens OVER it, takes the keyboard, and closes back to the Huddle', async ({ page }) => {
    // A tap is not a Back press: the Huddle stays where it was, the document is drawn above it (it is
    // an ordinary lightbox, in the band below the full-bleed Huddle) and Escape goes to what is seen.
    // `open`, not `visible`: a close takes `open` away at once and keeps `visible` through its fade.
    await calendarWithHuddle(page);
    await page.goto('/');
    await expect(page.locator('#calendarDisplay')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => { location.hash = '#huddle'; });
    await expect(page.locator('#huddleOpenFileBtn')).toBeVisible({ timeout: 15_000 });
    await viewersSettled(page);
    await page.evaluate(() => { location.hash = '#circular'; });
    await expect(page.locator('#docViewer')).toHaveClass(/\bopen\b/);
    await expect(page.locator('#docViewerBody')).toContainText('No Weekly Retail Circular has been uploaded yet');
    await viewersSettled(page);
    await expect(page.locator('#huddleViewer'), 'the tap closed the Huddle it was made over').toHaveClass(/\bopen\b/);
    expect(await page.evaluate(() => {
        const at = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
        return at?.closest('#docViewer') ? 'doc' : at?.closest('#huddleViewer') ? 'huddle' : at?.tagName;
    }), 'the document viewer was drawn underneath the Huddle').toBe('doc');
    await page.keyboard.press('Escape');
    await expect(page.locator('#docViewer')).not.toHaveClass(/visible/);
    await expect(page.locator('#huddleViewer'), 'Escape went to the viewer underneath').toHaveClass(/\bopen\b/);
});

test('huddle: a second Huddle tap while it is open keeps it on screen', async ({ page }) => {
    // The tap's popstate was read as Back: it closed the viewer, the tap re-opened it inside the
    // close's fade, and the fade's end hid it — "open", invisible, the page scroll-locked behind it.
    await calendarWithHuddle(page);
    await page.goto('/');
    await expect(page.locator('#calendarDisplay')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => { location.hash = '#huddle'; });
    await expect(page.locator('#huddleOpenFileBtn')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => { location.hash = '#huddle'; });
    await page.waitForTimeout(800);                          // past the 500ms fade and its fallback
    await expect(page.locator('#huddleViewer')).toHaveClass(/visible/);
    await expect(page.locator('#huddleOpenFileBtn')).toBeVisible();
});

test('huddle: a tap before the Huddle has answered says "Loading…", and an answer that never comes is told', async ({ page }) => {
    // No Huddle seeded: the fixture's listener never answers. The tap drew NOTHING, and the 8-second
    // "safety timeout" tested for a state the Calendar never held by then.
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true }; });
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/');
    await expect(page.locator('#calendarDisplay')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => { location.hash = '#huddle'; });
    await expect(page.locator('#huddleViewerBody')).toContainText('Loading…');
    await expect(page.locator('#huddleViewerBody')).toContainText("Couldn’t load the Daily Huddle", { timeout: 12_000 });
});

test('huddle: drawn through the REAL sanitiser — no data- or aria- attribute, no picture, and the picture is named with the route to the file', async ({ page }) => {
    await calendarWithHuddle(page, {
        fileType: 'docx', storagePath: 'huddles/2026-09-25-a.docx',
        htmlContent: '<p data-action="x" aria-label="y" id="z" class="c">Plan for the day</p>'
            + '<p><img src="data:image/png;base64,iVBORw0KGgo=" alt="Gate plan"></p>'
            + '<table><tr><td data-k="1" aria-hidden="true" colspan="2">Gate</td></tr></table>',
    });
    await page.goto('/');
    await expect(page.locator('#calendarDisplay')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => { location.hash = '#huddle'; });
    const body = page.locator('#huddleViewerBody');
    await expect(body).toContainText('Plan for the day', { timeout: 15_000 });
    const attrs = await page.evaluate(() => [...document.querySelectorAll('#huddleViewerBody p, #huddleViewerBody td')]
        .flatMap(el => [...el.attributes].map(a => a.name)));
    expect(attrs.filter(n => /^(data-|aria-)|^id$/.test(n)), 'the sanitiser passed attributes its comment says it refuses').toEqual([]);
    expect(attrs, 'the structural table attribute is kept').toContain('colspan');
    await expect(body.locator('img')).toHaveCount(0);
    await expect(body).toContainText('This Huddle has pictures that aren’t shown here.');
    await page.locator('#huddleOpenOriginalBtn').click();
    // A Word file opens through the Office Online viewer, which shows its pictures (storage-utils.js).
    await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__opened), { timeout: 3000 })
        .toEqual([expect.stringContaining(encodeURIComponent(HUDDLE_PDF))]);
});

test('huddle: a long plan scrolls from the keyboard — the body is a Tab stop inside the viewer', async ({ page }) => {
    await calendarWithHuddle(page, {
        fileType: 'docx', storagePath: 'huddles/2026-09-25-a.docx',
        htmlContent: Array.from({ length: 80 }, (_, i) => `<p>Line ${i + 1} of the plan</p>`).join(''),
    });
    await page.goto('/');
    await expect(page.locator('#calendarDisplay')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => { location.hash = '#huddle'; });
    await expect(page.locator('#huddleViewerBody')).toContainText('Line 80 of the plan', { timeout: 15_000 });
    await expect(page.locator('#huddleViewerClose')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#huddleViewerBody'), 'Tab stayed on ✕, the only stop').toBeFocused();
    await page.keyboard.press('PageDown');
    await expect.poll(() => page.locator('#huddleViewerBody').evaluate(el => el.scrollTop), { message: 'the plan did not scroll' })
        .toBeGreaterThan(0);
});

// ON A LAPTOP THE HUDDLE SITS IN THE APP'S BAND (laptop polish, 13 Nov 2026). The viewer is full-bleed,
// and at 1536px its prose ran 1504px across and its table stretched to match, a three-column day plan
// with 900px of air in the middle column. The table now takes the band every other page has, centred,
// and a paragraph the app's reading measure from the same left edge; a phone keeps its own edges.
test('huddle: on a wide laptop the plan sits in the app\'s band, its prose at a reading measure', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'a laptop window');
    await page.setViewportSize({ width: 1536, height: 735 });
    await calendarWithHuddle(page, {
        fileType: 'docx', storagePath: 'huddles/2026-09-25-a.docx',
        htmlContent: '<h2>Safety</h2><p>' + 'Keep the gateline staffed until the last arrival tonight. '.repeat(6) + '</p>'
            + '<table><tr><th>Time</th><th>What</th><th>Who</th></tr><tr><td>07:30</td><td>Gateline briefing</td><td>Earlies</td></tr></table>',
    });
    await page.goto('/');
    await expect(page.locator('#calendarDisplay')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => { location.hash = '#huddle'; });
    await expect(page.locator('#huddleViewerBody table')).toBeVisible({ timeout: 15_000 });
    const g = await page.evaluate(() => {
        const body = /** @type {HTMLElement} */ (document.getElementById('huddleViewerBody'));
        const box = (/** @type {string} */ s) => /** @type {Element} */ (body.querySelector(s)).getBoundingClientRect();
        const p = /** @type {HTMLElement} */ (body.querySelector(':scope > p'));
        const lines = Math.round(p.getBoundingClientRect().height / parseFloat(getComputedStyle(p).lineHeight));
        return { inner: body.clientWidth, band: parseFloat(getComputedStyle(body).getPropertyValue('--content-max-width')),
            table: box('table'), p: box(':scope > p'), perLine: (p.textContent || '').length / lines };
    });
    expect(Math.round(g.table.width), 'the table takes the app\'s band').toBe(g.band);
    expect(Math.abs(g.table.left - (g.inner - g.table.right)), 'the band is centred in the window').toBeLessThanOrEqual(1);
    expect(Math.round(g.p.left), 'prose and table share one left edge').toBe(Math.round(g.table.left));
    expect(g.perLine, `the prose runs ${Math.round(g.perLine)} characters to a line`).toBeLessThanOrEqual(95);
});
