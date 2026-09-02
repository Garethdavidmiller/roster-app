import { test, expect, enforceNamedSession, enableInplaceLogin } from './fixtures.js';
import { collectFatalErrors, seedSession, seedMember, pickFirstMemberAndPassword, DESKTOP_WIDTHS, armEnforcementWithFailingSignIn, signInThroughOverlay, openRosterReview, openGuideLink, seedContractTargets, clickInView, clickDialogConfirm, stubPerfReads, seedMemberSession, ROSTER_REVIEW_DATES } from './helpers.js';
// The rotation length. Fixtures below build their patterns INSIDE the page (`addInitScript`), where
// a module import is not available, so those loops carry the literal 22 — and `links: the rotation
// length the in-page fixtures assume` ties it back to this constant. Without that tie a shrunk
// rotation would leave every fixture over-length: the grid ignores the surplus rows, so the specs
// would still pass while quietly testing the legacy-design path rather than the normal one.
import { ROTATING_LINES } from '../links-design.js';

// ── SETTINGS (settings.html) ──────────────────────────────────────────────

// ── SETTINGS AS A STATUS PAGE (v22.37, owner review) ────────────────────────────────────────────
//
// The RULES are unit-tested in settings-status.test.mjs and they are the easy half: `summarise` is
// trivially right about every state it is handed. What only a browser can answer is whether the
// four cards actually REPORT — a card that reads its data and forgets to say so leaves a summary
// that is permanently "Checking…", or worse, leaves a tick on a card nobody looked at.
//
// So these drive the real page in the states staff are actually in, and assert what is on screen.

/** Put Settings in a chosen state. The single-doc read serves both the work email and the password
 *  status, so one seed decides both — which is why `configured` is one flag, not two. */
async function openSettings(page, { configured = false, payKeys = 0, noPush = false } = {}) {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedMemberSession(page, 'G. Miller');
    await page.addInitScript(({ configured, payKeys, noPush }) => {
        for (let i = 0; i < payKeys; i++) localStorage.setItem(`myb_pc_gmiller_p${40 + i}`, '{}');
        const e = globalThis.__E2E || (globalThis.__E2E = {});
        if (configured) e.getDocData = {
            workEmail: 'g.miller@chilternrailways.co.uk',
            passwordSetAt: { toMillis: () => Date.parse('2026-08-01') },
        };
        if (noPush) {
            delete window.PushManager;
            Object.defineProperty(window, 'Notification', { value: undefined, configurable: true });
        }
    }, { configured, payKeys, noPush });
    await page.goto('/settings.html');
    await expect(page.locator('#settingsSummary')).toBeVisible();
}

const cardOpen = (page, id) => page.evaluate(
    id => document.getElementById(id)?.classList.contains('open'), id);

test('settings: a configured account collapses its cards and says so', async ({ page }) => {
    // The whole point of the change. A returning member used to meet four expanded forms including
    // a large password form they had already dealt with.
    await openSettings(page, { configured: true, payKeys: 3, noPush: true });
    await expect(page.locator('#settingsSummaryLine')).toHaveText('✓ You’re all set');
    await expect(page.locator('#settingsSummary')).toHaveAttribute('data-tone', 'all-set');
    for (const id of ['contactBody', 'passwordBody', 'notifBody', 'payDataBody']) {
        expect(await cardOpen(page, id), `${id} must stay collapsed when there is nothing to do`).toBe(false);
    }
    await expect(page.locator('#contactStatusChip')).toHaveText('✓ Saved');
    await expect(page.locator('#passwordStatusChip')).toHaveText('✓ Password set');
    // The collapsed card answers WHICH address without being opened.
    await expect(page.locator('#contactHint')).toHaveText('g.miller@chilternrailways.co.uk');
});

test('settings: a card that needs attention opens ITSELF, and is named at the top', async ({ page }) => {
    // The other direction — a summary that only ever reassures is worth nothing.
    await openSettings(page, { configured: false, noPush: true });
    await expect(page.locator('#settingsSummary')).toHaveAttribute('data-tone', 'todo');
    await expect(page.locator('#settingsSummaryItems li')).toHaveText([
        'Set your own password', 'Add your work email',
    ]);
    expect(await cardOpen(page, 'passwordBody'), 'the password card must open itself').toBe(true);
    expect(await cardOpen(page, 'contactBody'), 'and so must the work email card').toBe(true);
    // …but a card with nothing wrong is left alone even on a page that has to-dos.
    expect(await cardOpen(page, 'payDataBody')).toBe(false);
});

test('settings: a read that FAILED never reads as all set', async ({ page }) => {
    // The dangerous direction, and the one nothing on screen would otherwise contradict: a member
    // told "all set" over a password status nobody managed to read closes the page.
    await page.setViewportSize({ width: 390, height: 844 });
    await seedMemberSession(page, 'G. Miller');
    await page.addInitScript(() => { (globalThis.__E2E || (globalThis.__E2E = {})).failGetDoc = true; });
    await page.goto('/settings.html');
    await expect(page.locator('#settingsSummary')).toBeVisible();
    await expect(page.locator('#settingsSummaryLine')).not.toHaveText('✓ You’re all set');
    await expect(page.locator('#contactStatusChip')).toHaveText('Couldn’t check');
    expect(await cardOpen(page, 'contactBody'), 'an unreadable setting must be shown, not hidden').toBe(true);
});

test('settings: the password form is behind a door once there is nothing to fix', async ({ page }) => {
    await openSettings(page, { configured: true, noPush: true });
    await page.locator('#passwordChevron').click();          // open the card by hand
    await expect(page.locator('#pwSettled')).toBeVisible();
    await expect(page.locator('#pwCurrent')).toBeHidden();
    await page.locator('#pwChangeBtn').click();
    await expect(page.locator('#pwCurrent')).toBeVisible();
    await expect(page.locator('#pwSettled')).toBeHidden();
    // Where forgetting it actually stops you — it used to be in the `?` panel only.
    await expect(page.locator('.pw-forgot')).toContainText('Ask the admin');
});

test('settings: Show passwords reveals all THREE fields, not two', async ({ page }) => {
    // The old control sat beside New and silently also governed Confirm. Current — where a
    // mistyped password most often comes from — was never covered.
    await openSettings(page, { configured: false, noPush: true });
    const types = () => page.evaluate(() =>
        ['pwCurrent', 'pwNew', 'pwConfirm'].map(id => document.getElementById(id).type));
    expect(await types()).toEqual(['password', 'password', 'password']);
    await page.locator('#pwShowAll').check();
    expect(await types()).toEqual(['text', 'text', 'text']);
    await page.locator('#pwShowAll').uncheck();
    expect(await types()).toEqual(['password', 'password', 'password']);
});

test('settings: the pay data card counts what is actually on the device', async ({ page }) => {
    // "Saved on this device only" is a warning about nothing until it says how much.
    await openSettings(page, { configured: true, payKeys: 3, noPush: true });
    await expect(page.locator('#payDataStatusChip')).toHaveText('3 payslips');
    await expect(page.locator('#payDataInventory')).toContainText('3 payslips');
    await expect(page.locator('#payDataInventory')).toContainText('saved on this device');
});

test('settings: a shared device does not count a colleague’s payslips as yours', async ({ page }) => {
    // NOT hypothetical — staff share the station PC, and the pay data of everyone who has used it
    // is sitting in the same localStorage. The count is per-member because it is built from
    // `selectBackupKeys`, which filters to this member's prefix; handing `inventoryOf` the raw key
    // list instead slices every key by the prefix LENGTH, so a colleague whose slug happens to be
    // the same length has their payslips classified as this member's. Measured: 5 against 2.
    await page.setViewportSize({ width: 390, height: 844 });
    await seedMemberSession(page, 'G. Miller');
    await page.addInitScript(() => {
        for (const k of ['p43', 'p44']) localStorage.setItem('myb_pc_gmiller_' + k, '{}');
        // Same slug LENGTH as gmiller, which is what makes the unfiltered slice line up.
        for (const k of ['p60', 'p61', 'p62']) localStorage.setItem('myb_pc_smiller_' + k, '{}');
        const e = globalThis.__E2E || (globalThis.__E2E = {});
        e.getDocData = { workEmail: 'g.miller@chilternrailways.co.uk',
                         passwordSetAt: { toMillis: () => Date.parse('2026-08-01') } };
    });
    await page.goto('/settings.html');
    await expect(page.locator('#payDataStatusChip')).toHaveText('2 payslips');
});

test('settings: a device with no pay data says so, rather than saying nothing', async ({ page }) => {
    await openSettings(page, { configured: true, payKeys: 0, noPush: true });
    await expect(page.locator('#payDataInventory')).toHaveText('No pay calculator history saved yet');
    await expect(page.locator('#payDataStatusChip')).toHaveText('None saved');
});

test('settings: the install card exists only while there is an install to offer', async ({ page }) => {
    // It moved OUT of Notifications, where nobody would have looked for it. The whole card is
    // conditional — a permanent "✓ Installed" row would be one that never does anything again.
    await openSettings(page, { configured: true, noPush: true });
    await expect(page.locator('#deviceCard')).toBeHidden();
    await page.evaluate(() => {
        const e = new Event('beforeinstallprompt');
        e.prompt = () => { window.__promptFired = true; return Promise.resolve(); };
        window.dispatchEvent(e);
    });
    await expect(page.locator('#deviceCard')).toBeVisible();
    await page.locator('#installBtn').click();
    expect(await page.evaluate(() => window.__promptFired)).toBe(true);
    await expect(page.locator('#deviceCard')).toBeHidden();
});


// ── The boot placeholder (v20.80) ───────────────────────────────────────────────────────────────

for (const [label, url, appJs] of [
    ['admin', '/admin.html', 'admin'],
    ['operations', '/operations.html', 'operations'],
    ['links', '/links.html', 'links'],
]) {
    test(`${label}: a boot placeholder stands in for the blank page, and goes when the page is ready`, async ({ page }) => {
        // These three hide `.container` until `body.auth-ready`, and their HEADER is inside it — so
        // until the module graph has loaded and run there is nothing on the page at all, not even a
        // burger. Measured at 622ms locally on a fast disk with no network; on a phone it is seconds.
        //
        // Aborting the coordinator is how the window is held open: the placeholder's whole contract
        // is that it survives a page whose JS never arrives, which is exactly the case that has no
        // other way to say anything.
        await page.route(`**/${appJs}-app.js`, r => r.abort());
        await page.route(`**/${appJs}-boot.js`, r => r.abort());
        await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await expect(page.locator('#bootPlaceholder')).toBeVisible();
        await expect(page.locator('.container')).toBeHidden();
    });

    test(`${label}: the placeholder is gone once the page is signed in`, async ({ page }) => {
        // Pure CSS in both directions — no module has to remember to clear it, which is what makes
        // it safe to show on a page whose JS may never run.
        await seedSession(page);
        await page.goto(url);
        await expect(page.locator('.container')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#bootPlaceholder')).toBeHidden();
    });
}

test('settings: login overlay renders with JS-populated grade options', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.goto('/settings.html');

    await expect(page.locator('#loginOverlay')).toBeVisible();

    const gradeCount = await page.locator('#loginGrade option').count();
    expect(gradeCount, '#loginGrade should have JS-added grade options').toBeGreaterThan(1);

    expect(errors, 'Uncaught JS exceptions on settings.html').toHaveLength(0);
});

// Regression: the settings login fields must be STYLED (full-width, like admin), not raw browser
// controls. They fell back to defaults because the field CSS lived in admin.css's generic
// `select, input {}` rule, which settings.css doesn't have — fixed by styling `.login-field`
// fields in shared.css (v14.43). A raw <select> renders at its tiny intrinsic width (~120px);
// the styled one fills the card (~280px).
test('settings login fields are styled full-width, not raw browser defaults', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/settings.html');
    await expect(page.locator('#loginOverlay')).toBeVisible();
    const w = await page.locator('#loginGrade').evaluate(el => el.getBoundingClientRect().width);
    expect(w, 'settings login GRADE select should be full-width (styled), not a raw control').toBeGreaterThan(200);
});

test('settings (signed in): card "?" button opens the Tips lightbox, not the card', async ({ page }) => {
    // Regression guard for the per-card Tips wiring. The logged-out tests above
    // never run initApp(), so a break in the signed-in path (e.g. a throw before
    // initCardCollapse wires the Work Email header) would ship unnoticed —
    // clicking "?" would then fall through to the header and toggle the card
    // collapse instead of opening the tips. This test exercises that path.
    const errors = collectFatalErrors(page);

    // Seed a valid session so the page runs initApp() instead of the login overlay.
    await seedSession(page);
    await page.goto('/settings.html');

    // Proof that initApp() → initContactCard() → initCardCollapse() ran: the collapse helper sets
    // aria-expanded on the toggle CONTROL — the chevron, not the header (v17.50: the header is no
    // longer role="button", so it can't nest the Tips "?" button; the chevron is the focusable
    // toggle). "true" since the card DEFAULTS OPEN on this 2-card page (v16.57 UX). The static HTML
    // has no aria-expanded, so its presence proves the signed-in init wired the collapse — meaning
    // the "?" handler is in place and the click below cannot race the wiring.
    await expect(page.locator('#contactChevron')).toHaveAttribute('aria-expanded', 'true');

    // The Work Email card starts OPEN and the tips overlay starts hidden.
    await expect(page.locator('#tipsLightbox')).toBeHidden();
    await expect(page.locator('#contactBody')).toHaveClass(/\bopen\b/);

    await page.locator('.btn-card-tips[data-card="work-email"]').click();

    // The Tips lightbox must open with the right content …
    await expect(page.locator('#tipsLightbox')).toBeVisible();
    await expect(page.locator('#tipsLbTitle')).toHaveText('Work Email');
    // … and the "?" click MUST NOT have toggled the card (the reported bug symptom:
    // clicking "?" fell through to the header and collapsed the card). It stays open.
    await expect(page.locator('#contactBody')).toHaveClass(/\bopen\b/);

    expect(errors, 'Uncaught JS exceptions on signed-in settings.html').toHaveLength(0);
});

// ── OPERATIONS (operations.html) ──────────────────────────────────────────

test('operations: shows the in-place login when not signed in', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.goto('/operations.html');
    // No redirect any more (Option B) — the shared login overlay is injected in place.
    await expect(page).toHaveURL(/operations\.html/);
    await expect(page.locator('#loginOverlay')).toBeVisible();
    expect(errors, 'Uncaught JS exceptions triggering operations redirect').toHaveLength(0);
});

// Desktop layout contract: the wrapper-column grid (v14.35) must keep the three
// publishing cards in the narrow LEFT column and the width-hungry cards (roster +
// monitoring) in the wide RIGHT column — not auto-placed into mismatched positions.
for (const width of [1280, 1440]) {
    test(`operations desktop @${width}px: cards land in the right columns, no overflow`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await seedSession(page, 'G. Miller');   // admin — passes the operations guard
        await page.goto('/operations.html');
        await expect(page).toHaveURL(/operations\.html$/);   // admin was NOT redirected out
        await expect(page.locator('#huddleUploadCard')).toBeVisible();

        const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, 'no horizontal overflow on desktop').toBeLessThanOrEqual(1);

        // The two columns must not overlap horizontally: every left-column (publishing)
        // card's right edge sits left of every right-column (roster + monitoring) card's
        // left edge. Comparing the columns to EACH OTHER (not the viewport centre) is
        // robust to the centred max-width:1100 container + narrow-left/wide-right split.
        // An auto-placement regression (the v14.31 symptom) would break this separation.
        const leftIds  = ['#huddleUploadCard', '#circularUploadCard', '#newsletterUploadCard'];
        const rightIds = ['#rosterUploadCard', '#accountStatusCard', '#errorLogCard', '#usageCard', '#pageSpeedCard', '#authSetupCard'];
        const boxesOf = async ids => Promise.all(ids.map(id => page.locator(id).boundingBox()));
        const leftBoxes  = await boxesOf(leftIds);
        const rightBoxes = await boxesOf(rightIds);
        const leftColumnRight = Math.max(...leftBoxes.map(b => b.x + b.width));
        const rightColumnLeft = Math.min(...rightBoxes.map(b => b.x));
        expect(leftColumnRight, 'left column must sit entirely left of the right column')
            .toBeLessThanOrEqual(rightColumnLeft + 1);
        // And the right (wide) column should genuinely be wider than the left (narrow) one.
        const rightWidth = rightBoxes[0].width, leftWidth = leftBoxes[0].width;
        expect(rightWidth, 'roster column should be wider than the publishing column').toBeGreaterThan(leftWidth);
    });
}

// App speed card (Project 0): renders its plain-language summary without throwing. Firebase is
// stubbed (getDoc → empty), so getPerfStats yields no data and the card shows the "still building
// up" empty state — proving the read + perfVerdict + render path runs end-to-end.
test('operations: App speed card renders both sections + empty-state verdict (no throw)', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await expect(page.locator('#pageSpeedCard')).toBeVisible();
    // Two journeys: "Signing in" (login) + "Opening pages" (page-open), both empty on a stubbed read.
    await expect(page.locator('#pageSpeedContent')).toContainText('Signing in');
    await expect(page.locator('#pageSpeedContent')).toContainText('Opening pages');
    await expect(page.locator('#pageSpeedContent')).toContainText('No sign-ins recorded'); // login empty state (month-neutral copy, v16.22)
    await expect(page.locator('#pageSpeedContent')).toContainText('Not enough data yet');       // pages empty state
});

// ── "Why some are slower" (v20.19) ──────────────────────────────────────────────────────────────
// The card recorded connection, install mode and app version with every load and threw all three
// away at render time, so it could say the Calendar was the slowest page and nothing about why.
// The maths is unit-tested; only a browser proves the section is REACHED and populated — it hangs
// off `w.samples`, a field that did not previously survive `getPerfStats`, so a wiring slip here
// leaves every unit test green and the section simply absent.
test('operations: App speed breaks the busiest page down by connection, install mode and version', async ({ page }) => {
    await page.addInitScript(() => {
        // A shape with a finding in it: fine on 4G, bad on 3G, and one tiny group that must be
        // MARKED rather than presented as though it meant something.
        window.__E2E = { ...(window.__E2E || {}), getDocData: { samples: {
            '20_18|calendar|domReady|lt500ms|standalone|4g': 300,
            '20_18|calendar|domReady|over8s|standalone|3g': 80,
            '20_18|calendar|domReady|1-3s|browser|4g': 90,
            '20_18|calendar|domReady|over8s|browser|slow-2g': 3,
            // A second version, because a single-value dimension is suppressed by design (one row
            // is the page total restated). Also the realistic case: staff straggle on an old
            // release for days, and "is it worse since the last deploy" is the question that
            // dimension exists to answer.
            '20_9|calendar|domReady|1-3s|standalone|4g': 40,
            '20_18|paycalc|domReady|lt500ms|standalone|4g': 20,
        } } };
    });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    const speed = page.locator('#pageSpeedContent');
    await expect(speed).toContainText('Why some are slower');
    // The BUSIEST page, named — not a hardcoded id. Calendar (473) outranks paycalc (20).
    await expect(speed).toContainText('Calendar');
    // All three dimensions rendered, in plain English rather than raw tokens.
    await expect(speed).toContainText('By connection');
    await expect(speed).toContainText('By how it was opened');
    await expect(speed).toContainText('By app version');
    await expect(speed).toContainText('Installed app');
    await expect(speed).toContainText('3G-like');
    await expect(speed).toContainText('v20.18');
    // Newest first, and NUMERICALLY: a string sort would put v20.9 above v20.18 and send a
    // regression hunt to the wrong release.
    const versions = await speed.locator('.speed-row--why .speed-row-label').allTextContents();
    const vs = versions.filter(t => t.startsWith('v'));
    expect(vs[0]).toBe('v20.18');
    // Both seeded versions clear the roll-up threshold on their own, so they stay separate rows.
    expect(vs.some(t => t.includes('20.9'))).toBe(true);
    // The figure the card states is the complement of the headline — everything NOT within a
    // second — and since v20.21 it is its own column under an "over 1s" header, so the row reads
    // as a bare number rather than repeating three words it never changes.
    await expect(speed).toContainText('over 1s');
    const conn3g = speed.locator('.speed-row--why', { hasText: '3G-like' }).first();
    await expect(conn3g.locator('.speed-row-count')).toHaveText('100%');
    await expect(conn3g.locator('.speed-row-sub')).toHaveText('80');
    // And the honesty marker on the three-sample group, without which that row reads exactly as
    // confidently as the 380-sample one next to it.
    await expect(speed).toContainText('(few)');
});

// ── The THIRD milestone (v20.80) ────────────────────────────────────────────────────────────────
// `fcp` and `domReady` were labelled "First appears" and "Fully ready", and the v20.12 access gate
// made both stop describing what an admin reads them as: `fcp` is the splash painting, and DCL now
// fires while the Calendar is still blank. Measured — fcp 512ms, domReady 669ms, roster on screen
// 2630ms. `ready` is the milestone neither of them can be, and the point of testing it in a browser
// rather than in the pure suite is the LAYOUT: a third bar per page is a real grid change, and a
// column that collapses is invisible to every assertion about the data behind it.
test('operations: App speed shows THREE milestones, and a page with no ready data says so', async ({ page }) => {
    await page.addInitScript(() => {
        window.__E2E = { ...(window.__E2E || {}), getDocData: { samples: {
            // The Calendar reports all three. The gap between "code loaded" and "usable" is the
            // finding the metric exists for, so the fixture carries it: quick code, slow page.
            '20_80|calendar|fcp|lt500ms|standalone|4g': 200,
            '20_80|calendar|domReady|500ms-1s|standalone|4g': 200,
            '20_80|calendar|ready|1-3s|standalone|4g': 200,
            // Paycalc does not mark the milestone. Its cell must be EMPTY, not borrowed from
            // another bar — a filled-in figure would be a number nobody measured.
            '20_80|paycalc|fcp|lt500ms|standalone|4g': 30,
            '20_80|paycalc|domReady|lt500ms|standalone|4g': 30,
        } } };
    });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    const speed = page.locator('#pageSpeedContent');
    await expect(speed).toContainText('First appears');
    await expect(speed).toContainText('Code loaded');
    await expect(speed).toContainText('Usable');
    // The relabel matters as much as the new bar: "Fully ready" was the phrase that made domReady
    // read as the answer, and it now belongs to `ready` alone.
    await expect(speed).not.toContainText('Fully ready');
    // The verdict for `ready` is driven by ITS OWN samples — all in the 1–3s band, so it must not
    // report the quick verdict `domReady` earns.
    await expect(speed).toContainText(/usable quickly|waiting too long/i);

    // Three bars per page row, and the header names all three columns.
    const calRow = speed.locator('.speed-row--dual', { hasText: 'Calendar' }).first();
    await expect(calRow.locator('.speed-bar')).toHaveCount(3);
    // Pay calculator does not report the milestone: the cell holds a DASH, not an empty track. An
    // unfilled bar beside a filled one reads as 0%, which is a measurement and the wrong one.
    const payRow = speed.locator('.speed-row--dual', { hasText: 'Pay' }).first();
    await expect(payRow.locator('.speed-bar')).toHaveCount(2);
    await expect(payRow.locator('.speed-bar-none')).toHaveText('—');

    // The grid really is three columns — a collapsed one would still pass every count above.
    // OPEN the card first. It is collapsed by default, so every assertion above passes on markup
    // that is `display:none` — which is exactly how a collapsed column would go unnoticed.
    await page.locator('#pageSpeedToggleHeader').click();
    await expect(speed).toBeVisible();
    // Read the RESOLVED track widths off the children, not the declaration: a column that collapsed
    // to zero would still be declared, which is the failure this guards.
    const widths = await calRow.evaluate(el =>
        [...el.children].map(c => Math.round(c.getBoundingClientRect().width)));
    expect(widths.length).toBe(5);
    expect(widths.slice(1, 4).every(w => w > 30)).toBe(true);
});

// ── "By stage of start-up" (v20.33) ─────────────────────────────────────────────────────────────
// The boot phases exist because every explanation of the amber second was inference until now — and
// the last inference (installed vs browser cold start) was backwards until data arrived. The split
// maths is unit-tested; only a browser proves the block renders inside the why-section, leads it,
// states its OWN threshold (½s, not the load rows' 1s), and stays absent while no phase samples
// exist (every pre-v20.33 client).
test('operations: App speed shows where the wait goes, by boot stage', async ({ page }) => {
    await page.addInitScript(() => {
        window.__E2E = { ...(window.__E2E || {}), getDocData: { samples: {
            // The shape the instrumentation was built to expose: SW wake fine, the engine span
            // carrying the amber, the app's own code fine.
            '20_33|calendar|domReady|lt500ms|standalone|4g': 300,
            '20_33|calendar|domReady|1-3s|standalone|4g': 60,
            '20_33|calendar|swBoot|lt500ms|standalone|4g': 350,
            '20_33|calendar|swBoot|500ms-1s|standalone|4g': 10,
            '20_33|calendar|sdkLoad|lt500ms|standalone|4g': 216,
            '20_33|calendar|sdkLoad|500ms-1s|standalone|4g': 90,
            '20_33|calendar|sdkLoad|1-3s|standalone|4g': 54,
            '20_33|calendar|appBoot|lt500ms|standalone|4g': 340,
            '20_33|calendar|appBoot|500ms-1s|standalone|4g': 20,
        } } };
    });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    const speed = page.locator('#pageSpeedContent');
    await expect(speed).toContainText('By stage of start-up');
    // All three stages, in boot order, in the plain-language labels (never the metric ids).
    const labels = await speed.locator('.speed-row--why .speed-row-label').allTextContents();
    const stageIdx = ['Waking up', 'Loading code', 'Getting ready']
        .map(l => labels.findIndex(t => t.includes(l)));
    expect(stageIdx.every(i => i >= 0)).toBe(true);
    expect(stageIdx[0]).toBeLessThan(stageIdx[1]);
    expect(stageIdx[1]).toBeLessThan(stageIdx[2]);
    // The stages LEAD the section — the dimensional splits gesture at a cause, the stages name it.
    const dimIdx = labels.findIndex(t => t.includes('4G-like'));
    if (dimIdx >= 0) expect(stageIdx[2]).toBeLessThan(dimIdx);
    // The block states its own band. 40% of sdkLoad samples sit over ½s (144 of 360) — the row
    // must say 40% under an "over ½s" header, not borrow the load rows' 1s band (the v20.19 rule:
    // a number reporting the wrong band is trusted over the bar beside it).
    await expect(speed).toContainText('over ½s');
    const engine = speed.locator('.speed-row--why', { hasText: 'Loading code' }).first();
    await expect(engine.locator('.speed-row-count')).toHaveText('40%');
    await expect(engine.locator('.speed-row-sub')).toHaveText('360');
});

// The stages must stay ABSENT while nothing records them: every device on a pre-v20.33 build. An
// empty scaffold saying 0% would read as "boot is instant", which is not a finding, it is a gap.
test('operations: no boot-phase samples → no "By stage of start-up" block', async ({ page }) => {
    await page.addInitScript(() => {
        window.__E2E = { ...(window.__E2E || {}), getDocData: { samples: {
            '20_18|calendar|domReady|lt500ms|standalone|4g': 300,
            '20_18|calendar|domReady|1-3s|browser|4g': 90,
        } } };
    });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    const speed = page.locator('#pageSpeedContent');
    await expect(speed).toContainText('Why some are slower');
    await expect(speed).not.toContainText('By stage of start-up');
});

// Account-status email rows must not overflow the card on a narrow phone (merged card, v18.65).
// Regression guard for the original v14.35 bug class: a long-email row must ellipsise so the
// fixed-width Edit/Remove buttons stay on-screen instead of being clipped by overflow:hidden.
test('operations: Account-status email rows keep Edit/Remove on-screen at 375px (long emails ellipsise)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 760 });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await expect(page.locator('#accountStatusCard')).toBeVisible();

    // Inject a member block with a deliberately long email (Firestore is stubbed empty in e2e),
    // matching the merged initAccountStatus row markup, into the expanded card.
    const res = await page.evaluate(() => {
        const body = document.getElementById('accountStatusContent');
        const list = document.createElement('div'); list.className = 'acct-status-list';
        const row = document.createElement('div'); row.className = 'acct-row';
        const head = document.createElement('div'); head.className = 'acct-row-head';
        const nm = document.createElement('span'); nm.className = 'acct-name'; nm.textContent = 'C. Francisco-Charles';
        const pw = document.createElement('span'); pw.className = 'acct-pw'; pw.textContent = '🔑 Own password';
        const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'btn-acct-reset'; reset.textContent = 'Reset';
        head.append(nm, pw, reset);
        const emailLine = document.createElement('div'); emailLine.className = 'acct-row-email';
        const em = document.createElement('span'); em.className = 'acct-email'; em.textContent = '📧 csherrice.francisco-charles@chilternrailways.co.uk';
        const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'email-set-btn'; edit.textContent = 'Edit';
        const rem = document.createElement('button'); rem.type = 'button'; rem.className = 'email-set-btn email-set-btn--remove'; rem.textContent = 'Remove';
        emailLine.append(em, edit, rem);
        row.append(head, emailLine); list.appendChild(row);
        body.innerHTML = ''; body.appendChild(list);
        document.getElementById('accountStatusBody')?.classList.add('open');
        const cardRight = document.getElementById('accountStatusCard').getBoundingClientRect().right;
        return {
            removeRight: rem.getBoundingClientRect().right,
            cardRight,
            emailEllipsized: em.scrollWidth > em.clientWidth,
        };
    });
    // The Remove button (rightmost element of the email line) must sit within the card, not clipped.
    expect(res.removeRight, 'Remove button must be inside the card').toBeLessThanOrEqual(res.cardRight + 1);
    expect(res.emailEllipsized, 'a long email must ellipsise, not force the row wide').toBe(true);
    const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'no horizontal overflow').toBeLessThanOrEqual(1);
});

// ── LINKS (links.html) ────────────────────────────────────────────────────

test('links: shows the in-place login when not signed in', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.goto('/links.html');
    // No redirect any more (Option B) — the shared login overlay is injected in place.
    await expect(page).toHaveURL(/links\.html/);
    await expect(page.locator('#loginOverlay')).toBeVisible();
    expect(errors, 'Uncaught JS exceptions triggering links redirect').toHaveLength(0);
});

// The Links page replaced every native confirm()/prompt() with the in-app confirmDialog/
// promptDialog (overlay.js). Test those directly in a real browser: they build a .dialog-overlay
// on the createLightbox lifecycle and resolve a Promise. overlay.js imports no Firebase, so it
// loads standalone. Native confirm/prompt are overridden to throw — proving nothing falls back.
test('confirmDialog: renders an in-app dialog and resolves true/false (not native confirm)', async ({ page }) => {
    await page.goto('/links.html');
    const r = await page.evaluate(async () => {
        window.confirm = () => { throw new Error('native confirm() was called'); };
        const { confirmDialog } = await import('/overlay.js');
        const raf = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
        // The node is removed AFTER the close transition (~500ms), not synchronously — poll for it.
        const gone = async () => { for (let i = 0; i < 40 && document.querySelector('.dialog-overlay'); i++) await new Promise(r => setTimeout(r, 40)); return !document.querySelector('.dialog-overlay'); };

        // Confirm path
        const pYes = confirmDialog({ title: 'T', message: 'M', confirmLabel: 'Yes' });
        await raf();
        const overlay = document.querySelector('.dialog-overlay');
        const isDialog = overlay?.getAttribute('role') === 'alertdialog';
        const hasInput = !!overlay?.querySelector('.dialog-input');
        overlay?.querySelector('.dialog-btn-confirm')?.click();
        const yes = await pYes;
        const removedAfterConfirm = await gone();   // eventually cleaned out of the DOM

        // Cancel path — only after the first overlay is fully gone (removal is async now)
        const pNo = confirmDialog({ message: 'M2' });
        await raf();
        document.querySelector('.dialog-overlay .dialog-btn-cancel')?.click();
        const no = await pNo;

        return { present: !!overlay, isDialog, hasInput, yes, no, removedAfterConfirm };
    });
    expect(r.present, 'a .dialog-overlay appeared').toBe(true);
    expect(r.isDialog, 'confirm uses role=alertdialog').toBe(true);
    expect(r.hasInput, 'confirm has no text input').toBe(false);
    expect(r.yes, 'confirm button resolves true').toBe(true);
    expect(r.no, 'cancel button resolves false').toBe(false);
    expect(r.removedAfterConfirm, 'overlay removed from DOM after close').toBe(true);
});

test('promptDialog: resolves the typed value on confirm, null on cancel (not native prompt)', async ({ page }) => {
    await page.goto('/links.html');
    const r = await page.evaluate(async () => {
        window.prompt = () => { throw new Error('native prompt() was called'); };
        const { promptDialog } = await import('/overlay.js');
        const raf = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
        const gone = async () => { for (let i = 0; i < 40 && document.querySelector('.dialog-overlay'); i++) await new Promise(r => setTimeout(r, 40)); };

        // Typed + confirm
        const pVal = promptDialog({ title: 'Name', message: 'Name?', defaultValue: 'seed' });
        await raf();
        const input = document.querySelector('.dialog-overlay .dialog-input');
        const seeded = input?.value;
        input.value = 'Option A';
        document.querySelector('.dialog-overlay .dialog-btn-confirm')?.click();
        const val = await pVal;
        await gone();   // wait out the async removal before opening the next dialog

        // Cancel → null
        const pNull = promptDialog({ message: 'Again?' });
        await raf();
        document.querySelector('.dialog-overlay .dialog-btn-cancel')?.click();
        const cancelled = await pNull;

        return { seeded, val, cancelled };
    });
    expect(r.seeded, 'input pre-filled with defaultValue').toBe('seed');
    expect(r.val, 'confirm resolves the typed value').toBe('Option A');
    expect(r.cancelled, 'cancel resolves null').toBe(null);
});

// Guide links are SAME-TAB navigation since v18.81 (target="_blank" wrapped guides in Android's
// Chrome Custom Tab / iOS's in-app Safari from the installed PWA — the "extra header on every
// guide" staff report). So with unsaved changes a drawer guide link must now be CAUGHT by the
// links unsaved-changes guard exactly like a page pill: the leave-confirm appears; cancelling
// keeps the page and the unsaved design intact.
test('links: a guide link (same-tab) routes through the unsaved-changes guard', async ({ page }) => {
    // v20.98: the generator refuses targets that cannot pay the contracted week, and the
    // roster seed cannot at this rotation — so a spec that generates brings work with it.
    await seedContractTargets(page);
    await page.setViewportSize({ width: 1024, height: 800 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => localStorage.setItem('myb_links_welcome_seen', '1'));
    await page.goto('/links.html');

    // Make the page dirty: apply the auto-generated pattern (targets seed from static roster data,
    // so this is deterministic in the hermetic env). Apply goes through the confirmDialog.
    await expect(page.locator('#generatorToggleHeader')).toBeVisible();
    await page.locator('#genApplyBtn').click();
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');   // "Apply"
    await expect(page.locator('.dialog-overlay')).toHaveCount(0);
    await expect(page.locator('#linksSaveRow')).toBeVisible();              // design now loaded (unsaved)

    // Open the drawer, expand Reference (collapsed by default since v20.06), click a guide link
    // (same-tab since v18.81).
    const guide = await openGuideLink(page, 'Staff & Admin Guide');
    await expect(guide).toBeVisible();
    await guide.click();

    // The unsaved-changes leave-confirm appears; cancel → still on Links, unsaved work preserved.
    const dialog = page.locator('.dialog-overlay');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('unsaved changes');
    await dialog.locator('.dialog-btn-cancel').click();
    await expect(page.locator('.dialog-overlay')).toHaveCount(0);
    await expect(page).toHaveURL(/links\.html/);
    await expect(page.locator('#linksSaveRow')).toBeVisible();
});

// Regression guard: the auto-generate card holds a wide targets table (one row per shift
// slot, Mon–Fri / Sat / Sun columns + a spare row). On a narrow phone that table must scroll
// inside its own card, never stretch the page — a horizontal blowout clips the header and grid.
test('links: opening the auto-generator causes no horizontal page overflow (narrow phone)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });   // common Android CSS width
    await seedSession(page, 'G. Miller');                       // G. Miller is a Links designer
    await page.addInitScript(() => localStorage.setItem('myb_links_welcome_seen', '1'));
    await page.goto('/links.html');
    await expect(page.locator('#generatorToggleHeader')).toBeVisible();

    // Ensure the generator body is expanded (it auto-opens in the empty state, but make it
    // deterministic regardless of stubbed-Firebase load order).
    const opened = await page.evaluate(() => document.getElementById('generatorBody')?.classList.contains('open'));
    if (!opened) await page.locator('#generatorChevron').click();
    await expect(page.locator('#generatorBody')).toHaveClass(/open/);
    await page.waitForTimeout(150);

    const { scrollW, clientW } = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
    }));
    expect(scrollW, `page scrollWidth ${scrollW}px vs viewport ${clientW}px`).toBeLessThanOrEqual(clientW + 1);
});

// Extraction smoke (v17.70): the Coverage heat map + Design-checks panels are rendered by
// links-analysis.js. Apply a generated design and confirm both populate in a real browser — proving
// the extracted renderers + the getDesign() seam work end-to-end with an actual design.
test('links: the analysis panels render for a generated design', async ({ page }) => {
    // Since v20.98 the generator refuses targets that cannot pay the contracted week, and the
    // roster seed cannot at this rotation — see seedContractTargets.
    await seedContractTargets(page);
    await page.setViewportSize({ width: 1024, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => localStorage.setItem('myb_links_welcome_seen', '1'));
    await page.goto('/links.html');
    await expect(page.locator('#generatorToggleHeader')).toBeVisible();
    await page.locator('#genApplyBtn').click();
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');   // "Apply"
    await expect(page.locator('.dialog-overlay')).toHaveCount(0);
    await expect(page.locator('#coverageHeatmap .cov-heat')).toBeVisible();   // heat map table
    await expect(page.locator('#checksContent .check-rows')).toBeVisible();   // checks panel
});

// ── LINKS SOFT DELETE (v19.41) ────────────────────────────────────────────
// The rules are unit-tested in links-deletion.test.mjs; what only a real browser can prove is the
// WIRING — that the ✕ writes a soft delete rather than destroying the document, and that Restore
// puts the design back.
//
// The assertion that carries the weight is on the WRITE, not the UI. A hard delete and a soft
// delete BOTH remove the chip from the picker, so "the chip is gone" passes just as happily
// against the implementation this replaced. The payload is the only place the two differ.
async function openLinksWithDesigns(page) {
    await page.setViewportSize({ width: 1024, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window);
        w.__E2E = w.__E2E || {};
        w.__E2E.docs = [
            { id: 'd1', name: 'Design A', patterns: {}, updatedAt: 1_750_000_000_000, updatedBy: 'S. Silva' },
            { id: 'd2', name: 'Design B', patterns: {}, updatedAt: 1_750_000_000_000, updatedBy: 'S. Silva' },
        ];
    });
    await page.goto('/links.html');
    await expect(page.locator('.design-chip')).toHaveCount(2);
}

/**
 * The demand overlay (v19.56). The RULES are unit-tested in links-demand.test.mjs; what only a real
 * browser can prove is that the rows reach the DOM and that the boundary finding reaches the prose.
 *
 * The specific thing worth an e2e: the first implementation asked an HOURLY question of a
 * minute-level boundary, so Sunday's 23:25 finish counted the whole 23:00 hour as staffed and the
 * five movements after it vanished. Every unit test passed — one of them was written with a
 * synthetic whole-hour Sunday window. Naming the five here means the panel has to actually say them.
 */
async function openLinksWithDesign(page) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const patterns = /** @type {any} */ ({});
        // ROTATING_LINES (22). Written out rather than imported: this runs inside the PAGE, where a
        // module import is not available. It is checked against the constant below.
        for (let i = 1; i <= 24; i++) {
            patterns[String(i)] = { sun: 'RD', mon: '06:20-14:20', tue: '06:20-14:20',
                wed: '06:20-14:20', thu: '14:00-22:00', fri: 'RD', sat: 'RD' };
        }
        const w = /** @type {any} */ (window);
        w.__E2E = w.__E2E || {};
        w.__E2E.docs = [{ id: 'd1', name: 'Design A', patterns,
            updatedAt: 1_750_000_000_000, updatedBy: 'S. Silva' }];
    });
    await page.goto('/links.html');
    await expect(page.locator('.design-chip')).toHaveCount(1);
}

test('links: every paint chip is a shift the design actually contains', async ({ page }) => {
    // THE BAR OFFERED EIGHTEEN TIMES AND THE DESIGN CONTAINED NONE OF THEM (v21.14).
    //
    // From v12.09 the chips were built from the ROSTER's shift times, which was right while a new
    // design started from the roster seed. From v21.00 a new design starts from the DESIGNED
    // default instead, and four retunes since then walked the two lists apart one release at a
    // time. Measured at v21.13: 18 chips, 19 times in the design, overlap ZERO — on a bar the card
    // header calls the way to "fill cells quickly", above a grid where not one of its own times
    // could be painted.
    //
    // Nothing failed, because a bar full of plausible-looking chips is indistinguishable from a bar
    // that works — which is why the invariant is asserted as a RELATION between the two rather than
    // as a chip count or a list of times. A future default retune cannot re-open the gap without
    // failing here.
    await openLinksWithDesign(page);
    const r = await page.evaluate(() => {
        const chips = [...document.querySelectorAll('#brushBar .brush-chip')]
            .map(c => /** @type {HTMLElement} */ (c).dataset.shift)
            .filter(s => s && !['__custom__', 'RD', 'SPARE'].includes(s));
        const inDesign = new Set();
        for (const td of document.querySelectorAll('#linksGridBodyRows td')) {
            const t = (td.textContent || '').trim().replace(/\s+/g, '');
            if (/^\d{2}:\d{2}\d{2}:\d{2}$/.test(t)) inDesign.add(t.slice(0, 5) + '-' + t.slice(5));
        }
        return { chips, inDesign: [...inDesign] };
    });
    // Both directions. Chips that paint nothing in the design are the v21.13 defect; times in the
    // design with no chip are the same defect seen from the designer's side — they are the cells
    // you cannot fill from the bar.
    const design = new Set(r.inDesign);
    expect(r.chips.filter(c => !design.has(c)), 'chips painting a shift this design does not use').toEqual([]);
    expect(r.inDesign.filter(t => !r.chips.includes(t)), 'times in the design with no chip to paint them').toEqual([]);
    expect(r.chips.length).toBeGreaterThan(0);
});

test('links: the coverage card carries a demand row per day class, in the same table', async ({ page }) => {
    await openLinksWithDesign(page);

    // One tbody, inside the cover table — not a second table, which would give the comparison two
    // independent horizontal scrolls.
    await expect(page.locator('.cov-heat .cov-demand')).toHaveCount(1);
    await expect(page.locator('.cov-demand .dem-day')).toHaveText([
        /Trains per hour/, 'Mon–Fri', 'Sat', 'Sun',
    ]);

    // It must be PAINTED, not merely present — the v19.55 lesson (a probe read `el.hidden` while
    // the browser rendered the element anyway).
    const box = await page.locator('.cov-demand').boundingBox();
    expect(box.height, 'the demand rows must have real height').toBeGreaterThan(40);
    const filled = await page.locator('.dem-cell.dem-b5').first()
        .evaluate(el => getComputedStyle(el).backgroundColor);
    expect(filled, 'the busiest hour must carry the demand ramp, not the page background')
        .not.toBe('rgba(0, 0, 0, 0)');
});

test('links: the demand note names every movement past the staffed finish, to the minute', async ({ page }) => {
    await openLinksWithDesign(page);
    const note = await page.locator('.dem-note').textContent();

    // The five Sunday movements after the 23:25 finish — the live question in LINKS_DEC2026_PLAN.md,
    // and the exact thing an hour-resolution implementation reported as fully covered.
    for (const m of ['Sun 23:27 dep', 'Sun 23:35 arr', 'Sun 23:45 dep', 'Sun 23:51 arr', 'Sun 23:54 arr']) {
        expect(note, `the panel must name ${m}`).toContain(m);
    }
    // Stated, never scored: where the window sits is a business decision.
    expect(note).toContain('not scored');
    // And the provenance travels with the figures. This asserted the literal string
    // "December 2026 timetable (provisional)" until v19.76 — a STATE, not a contract, and it broke
    // the moment the owner confirmed the simplifiers as final. The same mistake had already been
    // made in `links-demand.test.mjs` and fixed there; this second copy was missed.
    //
    // What must hold whatever the status is: the note names the timetable, identifies the exact
    // FILES it was measured from, and says ECS is excluded — so a printed proposal can always be
    // traced back to the data behind it. "(provisional)" is allowed to come and go with the flag.
    expect(note).toContain('December 2026 timetable');
    expect(note, 'the exact source files must be identifiable').toContain('10 of 13');
    expect(note).toContain('ECS excluded');
});

test('links: an hour whose service is not fully staffed is marked on the demand row', async ({ page }) => {
    await openLinksWithDesign(page);
    // 06:04 / 06:11 / 06:16 run before the 06:20 opening, and 23:57 after the 23:55 finish — so the
    // first and last weekday columns are both marked. A whole-hour test sees neither.
    await expect(page.locator('.cov-demand .dem-shut')).toHaveCount(4);
});

test('links: the sticky summary bar carries a live reading of the analysis below', async ({ page }) => {
    // The grid card is ~1,400px tall and the analysis starts ~1,600px below the fold, so before
    // v19.57 the effect of an edit was invisible without scrolling two screens away and back.
    await openLinksWithDesign(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    const chips = page.locator('#linksSummary .sum-chip');
    // FOUR since v20.04 — hours a week joined lines-designed, service-covered and fatigue-factors.
    // The count alone is a weak sentinel (any four chips satisfy it), so the reading this bar exists
    // for is also asserted by CONTENT: the hours chip is the one figure here that appears nowhere
    // else above the fold, and a silent regression that dropped it would leave the count intact if
    // anything else were ever added.
    await expect(chips).toHaveCount(4);
    await expect(page.locator('#linksSummary .sum-chip', { hasText: /a week$/ })).toHaveCount(1);

    // It must be STICKY and PAINTED mid-grid, not merely present — the v19.55 lesson (a probe read
    // `el.hidden` while the browser rendered the element anyway).
    //
    // The scroll offset is DERIVED, not the magic 500 it used to be. Sticky pins only while the
    // card's BOTTOM is still below the viewport bottom, so a hardcoded offset silently stops asking
    // the question the moment the card gets shorter — which is what happened when the rotation went
    // 28 to 22 and the grid lost six rows (measured: card 1144px, so 500 already put its bottom at
    // 750, above the fold, and the bar was correctly unpinned). Landing 100px short of that boundary
    // asks it at whatever length the rotation happens to be.
    const geom = await page.evaluate(() => {
        const box = /** @type {HTMLElement} */ (document.getElementById('linksGridCard'))
            .getBoundingClientRect();
        const top = box.top + window.scrollY;
        const y = Math.round(top + box.height - window.innerHeight - 100);
        window.scrollTo(0, y);
        return { top, height: box.height, y };
    });
    // Two premises, both of which a shorter card could quietly break — and each would leave the
    // assertion below passing or failing for a reason that has nothing to do with stickiness.
    expect(geom.height, 'the card must be taller than the viewport, or sticky has nothing to do')
        .toBeGreaterThan(900);
    expect(geom.y, 'the scroll must land INSIDE the card, not above it').toBeGreaterThan(geom.top);
    const box = await page.locator('#linksSaveRow').boundingBox();
    expect(Math.round(box.y + box.height), 'the bar must sit at the viewport bottom while the grid is on screen')
        .toBe(900);

    // …and it must UPDATE. Painting rest days over worked cells has to move a figure.
    const before = await chips.allTextContents();
    await page.locator('.brush-chip').first().click();          // the RD brush
    // Paint until a figure MOVES, rather than a fixed 40 clicks. Same assertion, and the same worst
    // case, but it stops at the first cell that changes anything — which matters because under
    // WebKit the fixed loop measured 28s against this suite's 30s timeout and duly tipped over on a
    // loaded CI runner. A test spending 93% of its budget on setup is not passing with any margin.
    const cells = page.locator('.shift-cell-btn');
    for (let i = 0; i < 40; i++) {
        await clickInView(cells.nth(i));
        if ((await chips.allTextContents()).join('\u0000') !== before.join('\u0000')) break;
    }
    await expect.poll(() => chips.allTextContents()).not.toEqual(before);
});

test('links: the hard limit is its own section, above the advisory factors and never collapsed', async ({ page }) => {
    // 13 consecutive worked days is CHILTERN's roster limit, derived from the post-Clapham Hidden
    // standard (v19.96) — a company limit, not legislation and not a current industry-wide rule —
    // but it is still a HARD limit, so this row is a
    // different kind of statement from the 24 below it. The unit tests prove the RULE; what only a browser can prove is that the
    // separation actually survives into the DOM — that it is not tallied into the fatigue counts, not
    // wearing the advisory amber, and not hidden behind the quiet-rows disclosure when it passes.
    await openLinksWithDesign(page);

    const limitHead = page.locator('.check-section-head:has-text("Company limits")');
    const fatigueHead = page.locator('.check-section-head:has-text("Fatigue factors")');
    await expect(limitHead).toBeVisible();

    // Order: the hard limit comes first.
    const order = await page.evaluate(() => {
        const heads = [...document.querySelectorAll('.check-section-head')].map(h => h.textContent || '');
        return heads.findIndex(t => /Company limits/.test(t)) < heads.findIndex(t => /Fatigue factors/.test(t));
    });
    expect(order, 'the hard-limit section must render above the advisory factors').toBe(true);

    // Its count is its own — "within limits" / "N breached", never folded into "N present · N clear".
    await expect(limitHead.locator('.check-section-meta')).toHaveText(/within limits|breached|not yet assessable/);
    await expect(fatigueHead.locator('.check-section-meta')).toHaveText(/present/);

    // The row is VISIBLE while passing. Every advisory `clear` row is behind the disclosure at this
    // point; a hard-limit check that passes must not be, because the printed sheet goes to the
    // assessing manager and "checked and met" has to be on it.
    const limitRow = page.locator('#checksContent .check-row', { hasText: 'consecutive days worked' });
    await expect(limitRow).toBeVisible();

    // And it must not be wearing the advisory amber — that class is the fatigue half's, and a
    // hard-limit breach has its own red. On the seeded design it passes, so it is green.
    await expect(limitRow).not.toHaveClass(/check-warn-row/);
    await expect(limitRow).toHaveClass(/check-good/);
});

test('links: the fatigue panel collapses its "nothing to report" rows but still counts them', async ({ page }) => {
    await openLinksWithDesign(page);
    const rows = page.locator('#checksContent .check-row:visible');
    const collapsed = await rows.count();

    // The count stays in the always-visible heading — that is what stops the disclosure becoming
    // false assurance. And the two figures must AGREE: they did not at first (the heading said 17
    // while the label said 10, because the night-family rollup sat outside the disclosure).
    // Select the meta by the section it belongs to, never by position. This read `.first()` until
    // v19.80, when the hard-limits section landed above the fatigue one and quietly became "first" —
    // so the assertion compared the disclosure label against a hard-limit summary line and got NaN.
    const meta = await page.locator('.check-section-head:has-text("Fatigue factors") .check-section-meta').textContent();
    const clear = Number((meta.match(/(\d+) clear/) || [])[1]);
    const label = await page.locator('.check-quiet-label').textContent();
    expect(Number((label.match(/^(\d+)/) || [])[1]),
        'the heading count and the disclosure label must describe the same set').toBe(clear);

    await page.locator('.check-quiet-summary').click();
    await expect.poll(() => rows.count()).toBeGreaterThan(collapsed);
});

test('links: printing opens every collapsed disclosure, and closes it again afterwards', async ({ page }) => {
    // CSS cannot do this — Chromium hides a closed <details>'s content via an internal slot no author
    // rule reaches, so a `@media print` override still printed 13 of 24 rows (measured). The printed
    // sheet is what goes to the assessing manager; dropping 17 completed checks from it silently
    // would be the exact false-assurance failure the panel exists to prevent.
    await openLinksWithDesign(page);
    const rows = page.locator('#checksContent .check-row:visible');
    const onScreen = await rows.count();

    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    await expect.poll(() => rows.count()).toBeGreaterThan(onScreen);

    // Printing must not permanently expand something the designer collapsed on purpose.
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect.poll(() => rows.count()).toBe(onScreen);
});

test('links: the line-order switches change the design, and say what each one cost', async ({ page }) => {
    // v20.98: the generator refuses targets that cannot pay the contracted week, and the
    // roster seed cannot at this rotation — so a spec that generates brings work with it.
    await seedContractTargets(page);
    // Reordering lines is FREE with respect to coverage — permuting rows leaves each day's multiset
    // identical — so these four objectives compete only with each other. That is exactly why they are
    // switches with a stated price rather than one blended score, and why the status line has to name
    // the trade: a bare "generated" would let a designer assume everything improved.
    async function generate(page, off = []) {
        await page.setViewportSize({ width: 1280, height: 1400 });
        await seedSession(page, 'G. Miller');
        await page.addInitScript(() => {
            localStorage.setItem('myb_links_welcome_seen', '1');
            const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {}; w.__E2E.docs = [];
        });
        await page.goto('/links.html');
        await page.waitForTimeout(600);
        await page.evaluate(() => { document.getElementById('generatorBody')?.classList.add('open'); });
        for (const id of off) await page.locator('#' + id).uncheck();
        await page.locator('#genApplyBtn').click({ force: true });
        const ok = page.locator('.dialog-btn-confirm');
        if (await ok.count()) await ok.first().click();
        await expect(page.locator('#linksSaveStatus')).toContainText('Link generated');
        return (await page.locator('#linksSaveStatus').textContent()).trim();
    }

    // Switches ON: the reorder runs and reports before→after for each objective.
    const on = await generate(page);
    expect(on, 'the status line must state the trade, not just "generated"').toMatch(/week-to-week \d+→\d+ min/);
    expect(on).toMatch(/weekends off \d+→\d+/);
});

test('links: every line-order switch OFF leaves the generated order untouched', async ({ page }) => {
    // Re-sorting by an empty objective set would hand back a different design for no stated reason.
    // Since v20.98 the generator refuses targets that cannot pay the contracted week, and the
    // roster seed cannot at this rotation — see seedContractTargets.
    await seedContractTargets(page);
    await page.setViewportSize({ width: 1280, height: 1400 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {}; w.__E2E.docs = [];
    });
    await page.goto('/links.html');
    await page.waitForTimeout(600);
    await page.evaluate(() => { document.getElementById('generatorBody')?.classList.add('open'); });
    // Every switch, read from OBJECTIVES rather than hardcoded — a new objective added without a
    // line here would leave the reorder running and this test asserting "untouched" about a design
    // that had in fact been re-sorted. That is exactly what happened when `variety` arrived.
    const switches = await page.evaluate(() =>
        [...document.querySelectorAll('.gen-objectives input[type="checkbox"]')].map(el => el.id));
    expect(switches.length).toBeGreaterThan(4);
    for (const id of switches) await page.locator('#' + id).uncheck();
    await page.locator('#genApplyBtn').click({ force: true });
    await clickDialogConfirm(page);
    await expect(page.locator('#linksSaveStatus')).toContainText('Review and save when ready');
    // …and specifically NOT a before→after report, because nothing was reordered.
    await expect(page.locator('#linksSaveStatus')).not.toContainText('week-to-week');
});

test('links: deleting a design writes a SOFT delete and leaves the document in place', async ({ page }) => {
    await openLinksWithDesigns(page);
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.setWrites = []; });

    // ✕ appears on the ACTIVE chip only.
    await page.locator('.design-chip--active .design-chip-delete').click();
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');
    await expect(page.locator('.design-chip')).toHaveCount(1);

    const { writes, deletes } = await page.evaluate(() => ({
        writes:  /** @type {any} */ (window).__E2E.setWrites || [],
        deletes: /** @type {any} */ (window).__E2E.deletedPaths || [],
    }));
    const del = writes.find(w => w.data && w.data.deletedAt);
    expect(del, 'the delete must WRITE deletedAt, not destroy the document').toBeTruthy();
    expect(del.data.deletedBy).toBe('G. Miller');
    expect(del.merge, 'a merge write — a replace would push our copy of patterns over the server\'s').toBe(true);
    expect(deletes, 'nothing may be hard-deleted by the ✕ button').toHaveLength(0);

    // …and it is now offered back.
    await expect(page.locator('#designBinBtn')).toBeVisible();
    await expect(page.locator('#designBinBtn')).toHaveText(/Recently deleted \(1\)/);
});

test('links: a pasted design is checked before it can be saved, and saved as a NEW design', async ({ page }) => {
    // The RULES are unit-tested in links-import.test.mjs. What only a browser answers is the WIRING
    // of the two-step: that Save is unreachable until a check has passed, that a later edit takes it
    // away again, and — the one that matters — that what reaches Firestore is the parsed grid rather
    // than a summary line claiming it was.
    await openLinksWithDesigns(page);
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.setWrites = []; });
    await page.locator('#importDesignBtn').click();

    // Save is not offered on an unchecked paste, however good the paste is.
    await expect(page.locator('#linksImportSave')).toBeHidden();
    await page.locator('#linksImportText').fill(
        '1\t14:00-22:00\t11:00-19:30\t11:00-19:30\t11:00-19:30\t11:00-19:30\tRD\t11:00-19:00\t42');
    await expect(page.locator('#linksImportSave')).toBeHidden();

    // A good paste reports what WOULD be written, including the assumption it had to make.
    await page.locator('#linksImportText').fill(
        '1\tNA\t06:20-13:50\tRD\tRD\t06:20-13:50\t06:20-13:50\t06:20-14:20');
    await page.locator('#linksImportCheck').click();
    // The DUTY counts, not the "only 1 of 24 lines" warning — which contains the same phrase, so
    // asserting on the line count alone passed against a build whose summary said only "Ready."
    await expect(page.locator('#linksImportStatus')).toContainText('4 duties');
    await expect(page.locator('#linksImportStatus')).toContainText('NA');
    await expect(page.locator('#linksImportSave')).toBeVisible();

    // A REFUSAL AFTER A PASS TAKES SAVE BACK. Checked in this order deliberately: with a refusal
    // first the button had never been shown, so "it is hidden" passed against a build that never
    // hid it at all.
    await page.locator('#linksImportText').fill('1\tRD\tRD\tRD\tRD\tRD\tRD\tTBC');
    await page.locator('#linksImportCheck').click();
    await expect(page.locator('#linksImportStatus')).toContainText('Row 1, SAT');
    await expect(page.locator('#linksImportSave')).toBeHidden();

    // And reaching the hidden button anyway writes NOTHING. A control that is merely invisible is
    // still in the document, and the last-checked design is the one a stale parse would save.
    await page.locator('#linksImportSave').dispatchEvent('click');
    expect(await page.evaluate(() => (/** @type {any} */ (window).__E2E.setWrites || []).length))
        .toBe(0);

    // EDITING AFTER A CHECK TAKES SAVE AWAY. Without this the reader is shown one design and saves
    // the previous parse — the single outcome the two-step exists to prevent.
    await page.locator('#linksImportText').press('End');
    await page.locator('#linksImportText').type('\t');
    await expect(page.locator('#linksImportSave')).toBeHidden();

    await page.locator('#linksImportText').fill(
        '1\tNA\t06:20-13:50\tRD\tRD\t06:20-13:50\t06:20-13:50\t06:20-14:20');
    await page.locator('#linksImportName').fill('Martine — 2A / 2B');
    await page.locator('#linksImportCheck').click();
    await page.locator('#linksImportSave').click();

    // A THIRD design — the import never touches the one that was open.
    await expect(page.locator('.design-chip')).toHaveCount(3);
    await expect(page.locator('.design-chip--active')).toContainText('Martine');

    const writes = await page.evaluate(() => /** @type {any} */ (window).__E2E.setWrites || []);
    const added = writes.find(w => w.data && w.data.name === 'Martine — 2A / 2B');
    expect(added, 'the import must WRITE a design, not merely report one').toBeTruthy();
    // The parsed grid, not the paste: NA became a rest day and the times were canonicalised.
    expect(added.data.patterns['1']).toEqual({
        sun: 'RD', mon: '06:20-13:50', tue: 'RD', wed: 'RD',
        thu: '06:20-13:50', fri: '06:20-13:50', sat: '06:20-14:20',
    });
});

test('links: a deleted design can be restored from the bin', async ({ page }) => {
    await openLinksWithDesigns(page);
    await page.locator('.design-chip--active .design-chip-delete').click();
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');
    await expect(page.locator('.design-chip')).toHaveCount(1);

    await page.evaluate(() => { /** @type {any} */ (window).__E2E.setWrites = []; });
    // TELL THE STUB THE SERVER NOW AGREES THE DESIGN IS DELETED (v22.32). The fake applies no
    // writes to its seed, so after the soft delete above its transaction still hands back the
    // ORIGINAL live document — a state production cannot be in, and one the restore now reads
    // correctly as "already restored, write nothing". `txDocs` is the fixture's own mechanism for
    // "what the SERVER says", which is the thing a transaction is there to consult.
    //
    // Without this the test asserts a write that only happened because the harness had lost track
    // of the delete it had just made.
    await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        w.__E2E.txDocs = (w.__E2E.docs || []).map((/** @type {any} */ d) =>
            d.id === 'd1' ? { ...d, deletedAt: { seconds: 1 }, deletedBy: 'G. Miller' } : d);
    });
    await page.locator('#designBinBtn').click();
    await expect(page.locator('#designBinList .bin-row')).toHaveCount(1);
    await page.locator('.bin-restore').click();

    await expect(page.locator('.design-chip')).toHaveCount(2);
    await expect(page.locator('#designBinList .bin-empty')).toBeVisible();
    // By NAME, not by count: a restore that resurrects an empty document would still make the
    // chip count go back to two.
    await expect(page.locator('.design-chip-name').filter({ hasText: 'Design A' })).toHaveCount(1);
    // And the document must still have been there to restore. Without this the test passes against
    // a HARD delete — the bin list is rendered from memory, so the row and the Restore button both
    // appear either way, and only the absent document tells them apart. (Found by teeth-checking:
    // this case went green against the very implementation being replaced.)
    const hardDeletes = await page.evaluate(() => /** @type {any} */ (window).__E2E.deletedPaths || []);
    expect(hardDeletes, 'a restore is only real if the document was never destroyed').toHaveLength(0);
    const write = await page.evaluate(() =>
        (/** @type {any} */ (window).__E2E.setWrites || []).find(w => w.data && 'deletedAt' in w.data));
    // deleteField() is a sentinel object in the stub; what matters is that the restore CLEARS the
    // field rather than writing another value into it.
    expect(write?.data?.deletedAt?.__stub, 'restore must clear deletedAt with deleteField()').toBe('deleteField');
    expect(write?.data?.deletedBy?.__stub).toBe('deleteField');
});

test('links: the bin button is hidden when nothing has been deleted', async ({ page }) => {
    await openLinksWithDesigns(page);
    await expect(page.locator('#designBinBtn')).toBeHidden();
});

// AUTOMATIC PERMANENT DELETION IS SUSPENDED (v19.86, external review P2), so this test now pins the
// opposite of what it used to. `isPurgeable` fails closed on an unresolved or FUTURE `deletedAt`,
// but nothing can defend a client-side age check against a device clock running more than 30 days
// FAST: every recent deletion looks expired, the transaction re-checks with the same wrong local
// time and agrees, and a colleague's design is destroyed. The bin exists so a delete is
// recoverable, so a path that can silently empty it early defeats the feature it belongs to.
// Removal is now a deliberate act only. Re-enable expiry on SERVER time, never by restoring the
// call site.
test('links: nothing is purged automatically on load, however old the deletion', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const DAY = 86_400_000;
        const w = /** @type {any} */ (window);
        w.__E2E = w.__E2E || {};
        w.__E2E.docs = [
            { id: 'live', name: 'Design A', patterns: {}, updatedAt: Date.now() - DAY, updatedBy: 'S. Silva' },
            { id: 'old',  name: 'Long gone', patterns: {}, deletedAt: Date.now() - 40 * DAY, deletedBy: 'S. Silva' },
            { id: 'fresh', name: 'Just binned', patterns: {}, deletedAt: Date.now() - 2 * DAY, deletedBy: 'S. Silva' },
        ];
    });
    await page.goto('/links.html');
    await expect(page.locator('.design-chip')).toHaveCount(1);
    // BOTH deletions survive — the 40-day-old one as much as the 2-day-old one.
    await expect(page.locator('#designBinBtn')).toHaveText(/Recently deleted \(2\)/);

    // The assertion that matters: load destroyed nothing. It is a negative, so it has to have had
    // the chance to happen — the bin count above is only rendered after the load settles.
    const deletes = await page.evaluate(() => /** @type {any} */ (window).__E2E.deletedPaths || []);
    expect(deletes, 'load must never permanently delete anything').toEqual([]);

    await page.locator('#designBinBtn').click();
    await expect(page.locator('#designBinList .bin-row')).toHaveCount(2);
    // The AGE is still shown — suspending the purge must not also hide how old a deletion is,
    // because that age is now the only prompt to remove it by hand.
    await expect(page.locator('.bin-row-meta').first()).toHaveText(/Deleted .* by S\. Silva/);
});

// Same guarantee from the other direction, and it still matters with auto-purge suspended: a stale
// load can show a design as long-deleted that a colleague has since restored. Nothing on load may
// act on that. (The MANUAL "Remove for good" path re-reads inside a transaction for exactly this
// reason — v19.84 — so the two destructive routes are now both closed.)
test('links: a design restored elsewhere survives a load whose snapshot says expired', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const DAY = 86_400_000;
        const w = /** @type {any} */ (window);
        w.__E2E = w.__E2E || {};
        // What this device loaded (stale cache): "Shared" was deleted 40 days ago.
        w.__E2E.docs = [
            { id: 'live', name: 'Design A', patterns: {}, updatedAt: Date.now() - DAY, updatedBy: 'S. Silva' },
            { id: 'shared', name: 'Shared', patterns: {}, deletedAt: Date.now() - 40 * DAY, deletedBy: 'S. Silva' },
        ];
        // What the server actually holds: M. Robson restored it — no deletedAt at all.
        w.__E2E.txDocs = [
            { id: 'live', name: 'Design A', patterns: {}, updatedAt: Date.now() - DAY, updatedBy: 'S. Silva' },
            { id: 'shared', name: 'Shared', patterns: {}, updatedAt: Date.now(), updatedBy: 'M. Robson' },
        ];
    });
    await page.goto('/links.html');
    await expect(page.locator('.design-chip')).toHaveCount(1);
    // The stale row still SHOWS in the bin — this device believes it was deleted, and correcting
    // that belief is a refresh problem, not a reason to destroy anything. Waiting on the button
    // also gives any (suspended) purge the chance to have run before the negative below is read.
    await expect(page.locator('#designBinBtn')).toHaveText(/Recently deleted \(1\)/);
    const deletes = await page.evaluate(() => /** @type {any} */ (window).__E2E.deletedPaths || []);
    expect(deletes, 'a design the server says is live must never be destroyed by a load').toEqual([]);
});

// Zero live designs with a full bin is the state where restore matters most, and it is reachable
// even though this client refuses to delete the last live design (two designers deleting the last
// two at once; a device on an older build). The bin button lives inside the picker strip, so if
// that strip is keyed on live designs alone the only way back is invisible.
test('links: the bin is still reachable when every design has been deleted', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window);
        w.__E2E = w.__E2E || {};
        w.__E2E.docs = [
            { id: 'gone', name: 'Only design', patterns: {}, deletedAt: Date.now() - 86_400_000, deletedBy: 'S. Silva' },
        ];
    });
    await page.goto('/links.html');
    await expect(page.locator('.design-chip')).toHaveCount(0);
    await expect(page.locator('#designBinBtn')).toBeVisible();
    await page.locator('#designBinBtn').click();
    await expect(page.locator('.bin-row-name')).toHaveText('Only design');
    await page.locator('.bin-restore').click();
    await expect(page.locator('.design-chip-name')).toHaveText('Only design');
});

// Saving a design a colleague deleted while you had it open must NOT put it back. An overwrite
// there would be one designer undoing another's delete without ever being told a delete happened —
// and it would arrive dressed as an ordinary "someone else saved" conflict, whose Replace button
// reads like it only affects content.
test('links: saving a design deleted by someone else offers a fork, and does not resurrect it', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window);
        w.__E2E = w.__E2E || {};
        // Loaded live…
        w.__E2E.docs = [
            { id: 'd1', name: 'Design A', patterns: {}, updatedAt: Date.now() - 60_000, updatedBy: 'S. Silva' },
            { id: 'd2', name: 'Design B', patterns: {}, updatedAt: Date.now() - 60_000, updatedBy: 'S. Silva' },
        ];
        // …but by the time we save, M. Robson has binned the one we are editing.
        w.__E2E.txDocs = [
            { id: 'd1', name: 'Design A', patterns: {}, deletedAt: Date.now(), deletedBy: 'M. Robson' },
            { id: 'd2', name: 'Design B', patterns: {}, updatedAt: Date.now() - 60_000, updatedBy: 'S. Silva' },
        ];
    });
    await page.goto('/links.html');
    await expect(page.locator('.design-chip')).toHaveCount(2);

    // Edit the active design, then save. A real SHIFT brush, not the RD chip that leads the bar —
    // painting RD onto a rest day is correctly a no-op since v19.38 and would leave Save disabled.
    await page.locator('#brushBar .brush-chip.type-early').first().click();
    await page.locator('tr[data-pos="2"] .shift-cell-btn').nth(1).click();
    await expect(page.locator('#linksSaveBtn')).toBeEnabled();
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.setWrites = []; });
    await page.locator('#linksSaveBtn').click();

    // Named as a deletion, not as a content conflict.
    await expect(page.locator('.dialog-overlay')).toContainText('deleted this design');
    await expect(page.locator('.dialog-overlay')).toContainText('M. Robson');
    await page.locator('.dialog-overlay .dialog-btn-cancel').click();   // "Not now"

    const writes = await page.evaluate(() => /** @type {any} */ (window).__E2E.setWrites || []);
    expect(writes.filter(w => w.data && w.data.patterns),
        'declining must not write the patterns back over a deleted design').toHaveLength(0);
    await expect(page.locator('#linksSaveStatus')).toContainText('Not saved');
});

// ── ADMIN TOUCH LAYOUT — no horizontal blowout when a pill with hours is selected ──
// Regression: on TOUCH devices (pointer: coarse) the bulk-bar time inputs' intrinsic
// min-width (~180px each, unshrinkable without min-width: 0) stretched the whole page
// to ~585px inside a ~393px viewport the moment a pill with hours (Shift/RDW/Other)
// was selected — clipping the header, member bar, and every card at the right edge.
// Desktop never showed it (the coarse-pointer stylesheet block doesn't apply), which
// is why this must assert element widths on the Pixel-5 project, not desktop.
test('a tips panel with more below the fold says so, and stops saying it at the bottom', async ({ page }) => {
    // The fade is a MASK on a scroll container: it appears in no screenshot the suite takes (no
    // baseline captures a scrolling panel), it changes no text, and no behavioural test could
    // notice it. So the one thing that can go wrong silently — the class never being applied, or
    // never being cleared — is pinned here, in the suite that runs on every branch.
    //
    // Change a Shift is the right panel: at 390px it is ~1,100px of content in a 765px box, and it
    // is the panel a member is most likely to be reading when they need the part below the fold.
    await seedSession(page, 'G. Miller');
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/admin.html');
    await page.locator('.btn-card-tips').first().click();

    const panel = page.locator('#tipsLightboxContent');
    await expect(panel).toBeVisible();
    // PREMISE: this panel really does overflow. Without it the assertion below would pass happily
    // on a panel that fits, which is the same test passing for the opposite reason.
    await expect.poll(async () => panel.evaluate(el => el.scrollHeight - el.clientHeight),
        { message: 'premise: the Change a Shift tips panel overflows at 390px' })
        .toBeGreaterThan(2);
    await expect(panel).toHaveClass(/\bhas-more\b/);

    await panel.evaluate(el => { el.scrollTop = el.scrollHeight; });
    // And it goes once there is nothing more to read — a fade that never clears is a panel that
    // always claims to be hiding something.
    await expect(panel).not.toHaveClass(/\bhas-more\b/);
});

// ── THE SAVE RECEIPT (v21.38, external review) ──────────────────────────────────────────────────
//
// A count cannot answer "did I change the days I meant to?", and the commonest real mistake on this
// page — a right-shaped batch against the wrong days — produces a perfectly plausible count. Driven
// in a browser because the wording is unit-tested but the WIRING is not: whether the days a save
// actually staged reach the receipt is a different pass over the same state.
// ── THE AL COUNT ACTUALLY SEES THE OVERRIDES (v21.84) ───────────────────────────────────────────
//
// The behavioural half of the wiring audit's AL finding. Handing `countedAlDates`/`alPosition` an
// empty override map left 57 unit tests and 8 admin e2es green while a member's entitlement read as
// untouched — the rules are right, and the answer on screen is wrong, which is the shape this
// repo's rule-level tests cannot see.
//
// The banner is the honest target: it is the number a manager actually reads before booking, and it
// runs `alPosition` — a THIRD call site of this family, and one the static call-site guard in
// al-entitlement.test.mjs does not cover (that one pins `countedAlDates`). So this is not a
// duplicate of the guard; it is the part of the family nothing else watches.
//
// The contrast is drawn INSIDE the test — the same page loaded with and without the AL on record —
// because an absolute figure proves nothing here: a member with no leave booked and a member whose
// leave is invisible both read zero.
test('admin: the AL banner counts leave that is already on record', async ({ page }) => {
    const AL_DATES = [];
    for (let d = 1; d <= 28; d++) AL_DATES.push(`2026-06-${String(d).padStart(2, '0')}`);

    /**
     * Select the member the leave belongs to, then read the four banner figures.
     *
     * The selection is load-bearing: the Annual Leave card opens on the FIRST roster member, not on
     * whoever is signed in, and the override read is filtered by that name — so a test that seeds
     * one member's leave and reads another's banner watches a correct zero and proves nothing.
     */
    const readBanner = async () => {
        await page.locator('#fieldMember').selectOption('G. Miller');
        await page.waitForSelector('.day-row', { timeout: 10000 });
        await page.locator('#alToggleHeader').click();
        await expect(page.locator('#alBanner')).toBeVisible();
        return page.evaluate(() => ({
            taken:       Number(document.getElementById('alBannerTaken')?.textContent),
            booked:      Number(document.getElementById('alBannerBooked')?.textContent),
            remaining:   Number(document.getElementById('alBannerRemaining')?.textContent),
            entitlement: Number(document.getElementById('alBannerEntitlement')?.textContent),
        }));
    };

    // 1. NOTHING on record — the baseline this test is a contrast against.
    await page.clock.setFixedTime(new Date('2026-08-27T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    const clear = await readBanner();
    expect(clear.entitlement, 'a CEA has an entitlement to spend').toBeGreaterThan(0);
    expect(clear.taken, 'no leave on record means none taken').toBe(0);
    expect(clear.remaining).toBe(clear.entitlement);

    // 2. The SAME member, with June's leave on record.
    await page.clock.setFixedTime(new Date('2026-08-27T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    await page.addInitScript((dates) => {
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.docs = dates.map((date, i) => ({
            id: `al-${i}`, memberName: 'G. Miller', date,
            type: 'annual_leave', value: 'AL', note: '', source: 'manual',
        }));
    }, AL_DATES);
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    const booked = await readBanner();

    // June is in the past at the pinned date, so it lands in TAKEN rather than BOOKED.
    expect(booked.taken, 'the leave on record must reach the figure the manager reads').toBeGreaterThan(0);
    expect(booked.taken).toBeLessThanOrEqual(AL_DATES.length);
    expect(booked.entitlement).toBe(clear.entitlement);
    // The four figures have to describe one position, not three independent reads of it.
    expect(booked.remaining, 'remaining must account for what is taken and booked')
        .toBe(booked.entitlement - booked.taken - booked.booked);
});

test('admin: saving reports the DAYS it changed, not just how many', async ({ page }) => {
    // executeSave refuses without a Firebase user ("You've been signed out"), which is right — so
    // opt the stub in, the way every other spec that reaches a real write does.
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true }; });
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });

    // Stage several days through the real bulk path, then save.
    await page.locator('#bulkSelMonFri').click();
    await page.locator('#bulkTypePills .pill-annual_leave').click();
    await page.locator('#bulkApplyBtn').click();
    await page.locator('#saveBtn').click();

    const feedback = page.locator('#formFeedback');
    await expect(feedback).toContainText('changes saved for', { timeout: 10000 });

    // The receipt itself: folded, and naming one day per line when opened.
    const receipt = feedback.locator('.save-receipt');
    await expect(receipt).toBeVisible();
    await expect(receipt).not.toHaveAttribute('open', '');
    await receipt.locator('summary').click();
    const lines = receipt.locator('li');
    expect(await lines.count(), 'one line per changed day').toBeGreaterThan(1);
    // And the headline's count agrees with the list it folds — two passes over one state, which is
    // exactly where a summary and its detail drift apart.
    const headline = await feedback.textContent();
    const stated = Number((headline || '').match(/(\d+) changes? saved/)?.[1]);
    expect(await lines.count(), 'the headline must agree with its own receipt').toBe(stated);
});

// ── THE STAGED OVERRIDE LOAD (v21.38, external review) ──────────────────────────────────────────
//
// Admin used to read the newest few thousand documents of the whole collection on every open and
// filter them locally. It now reads the selected member, and the collection only when the All-staff
// view asks. The claim is entirely about WHICH QUERY RUNS, and that is invisible from the rendered
// table — both versions draw a correct-looking list. So these read `__E2E.whereCalls`, which the
// stub records for exactly this reason.
test('admin boot reads ONE member, not the whole overrides collection', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });

    // Asserted against the LIVE field rather than a hardcoded name: admin restores its own selected
    // member (saved, or the first in the list), which is not the session's member — an earlier draft
    // of this assumed it was and failed against perfectly correct code.
    const { wheres, selected } = await page.evaluate(() => ({
        wheres: (window.__E2E?.whereCalls || []).filter(w => w[0] === 'memberName'),
        selected: /** @type {HTMLSelectElement|null} */ (document.getElementById('fieldMember'))?.value,
    }));
    expect(wheres.length, 'the boot load must filter by memberName').toBeGreaterThan(0);
    expect(wheres[0], 'and by the member the page is actually showing')
        .toEqual(['memberName', '==', selected]);
});

test('admin: switching member fetches THAT member, and their week is not drawn as empty first',
    async ({ page }) => {
        // The silent-wrong-answer case. An unfetched member and a member with a clear week produce
        // the same empty slice, so painting the grid before their data lands would show seven
        // base-roster days and read as "nothing recorded for them".
        await seedSession(page, 'G. Miller');
        await page.goto('/admin.html');
        await page.waitForSelector('.day-row', { timeout: 10000 });

        const select = page.locator('#fieldMember');
        const other = await select.evaluate((el) => {
            const sel = /** @type {HTMLSelectElement} */ (el);
            const opt = [...sel.options].find(o => o.value && o.value !== sel.value);
            return opt ? opt.value : '';
        });
        expect(other, 'the roster needs a second selectable member for this test').not.toBe('');

        await select.selectOption(other);
        await expect.poll(async () => page.evaluate(() => (window.__E2E?.whereCalls || [])
            .filter(w => w[0] === 'memberName').map(w => w[2])),
        { message: 'selecting a member must fetch that member' }).toContain(other);
        // And the grid comes back: the loading state is a moment, not a dead end.
        await expect(page.locator('.day-row').first()).toBeVisible({ timeout: 10000 });
    });

test('admin: "All staff" fetches everyone rather than listing whoever happened to be loaded',
    async ({ page }) => {
        // A short list that looks complete is the failure the query-cap banner exists to prevent one
        // level up; rendering All staff from a per-member cache would be the same defect earlier.
        await seedSession(page, 'G. Miller');
        await page.goto('/admin.html');
        await page.waitForSelector('.day-row', { timeout: 10000 });

        // Saved Changes is a collapsible card and ships collapsed, so the toggle exists but is not
        // reachable until it is opened — the same route a manager takes.
        await page.locator('#overridesToggleHeader').click();
        const showAll = page.locator('#showAllOverridesBtn');
        await expect(showAll).toBeVisible();
        const before = await page.evaluate(() => window.__E2E?.docReads || 0);
        await showAll.click();

        await expect.poll(async () => page.evaluate(() => window.__E2E?.docReads || 0),
            { message: 'turning on All staff must run a collection read' })
            .toBeGreaterThan(before);
        await expect(showAll, 'and the toggle flips so it can be turned back off')
            .toHaveText('This member only');
    });

test('admin: the week-grid header and its rows share ONE column template, at every width', async ({ page }) => {
    // The header labels the rows; if the two grids resolve different tracks, the labels sit over
    // nothing in particular. They did. Both used `auto` for the base-roster column — and `auto` in
    // two separate grids sizes to each grid's OWN content, so "Base roster" (76.5px) and a badge
    // (110px) put the column 34px out of step. They shared a right edge, and only because both are
    // right-aligned; nothing made them agree. The 681–1023px layout was worse: its last `auto` was
    // 62px in the header and 194px in the rows, so the pills column was 132px wider in the header
    // than beneath it.
    //
    // Only a browser can see this — it is what the values RESOLVE to, not what the stylesheet says,
    // and the stylesheet said the same thing in both places. Every layout the page has is swept,
    // because the templates are declared in four separate blocks and it is the mid-range ones
    // nobody looks at.
    await seedSession(page);
    for (const width of [360, 390, 700, 800, 1023, 1024, 1280, 1440]) {
        await page.setViewportSize({ width, height: 1200 });
        await page.goto('/admin.html');
        await page.waitForSelector('.day-row', { timeout: 10000 });
        const m = await page.evaluate(() => {
            const h = document.querySelector('.week-grid-header');
            const r = document.querySelector('.day-row');
            const badge = r.querySelector('.col-base .shift-badge').getBoundingClientRect();
            const col = r.querySelector('.col-base').getBoundingClientRect();
            return {
                head: getComputedStyle(h).gridTemplateColumns,
                row:  getComputedStyle(r).gridTemplateColumns,
                badgeW: Math.round(badge.width), colW: Math.round(col.width),
                overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            };
        });
        expect(m.head, `@${width}px the header and rows must resolve the SAME tracks`).toBe(m.row);
        expect(m.badgeW, `@${width}px the badge must not exceed the column it sits in`)
            .toBeLessThanOrEqual(m.colW);
        expect(m.overflow, `@${width}px the page must not scroll sideways`).toBe(false);
    }
});

test('admin: every base-roster badge in a week shares one left edge', async ({ page }) => {
    // The badges are right-aligned, so a variable width gives a ragged LEFT edge down the column —
    // measured at three different values over one seven-row week (654 / 615 / 613 at 1280px),
    // because `REST` is short, a time is long, and 🦉 is wider than ☀️. One width fixes it by
    // construction; `tabular-nums` is what stops the TIMES varying among themselves.
    for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 1200 });
        await seedSession(page);
        await page.goto('/admin.html');
        await page.locator('#fieldMember').selectOption('L. Atrakimaviciene');
        await page.waitForSelector('.day-row', { timeout: 10000 });
        const lefts = await page.evaluate(() => [...new Set([...document.querySelectorAll('.day-row .col-base .shift-badge')]
            .map(b => Math.round(b.getBoundingClientRect().left)))]);
        expect(lefts, `@${width}px every badge starts at the same x — got ${lefts.join(', ')}`).toHaveLength(1);
    }
});

test('admin: the BASE ROSTER column shows the time, not just Early/Late', async ({ page }) => {
    // Owner report with a screenshot: "you can't see the default shift time as reference, only
    // early or late." The badge was the only thing on an untouched row, so the question an admin is
    // there to answer — what is this person rostered to work? — had no answer on screen.
    //
    // A WIRING test, deliberately. `getShiftBadge`'s option is unit-tested both ways; what only a
    // browser can show is that the week grid PASSES it, and that the time fits the row it lives in.
    await page.setViewportSize({ width: 390, height: 900 });
    await seedSession(page);
    await page.goto('/admin.html');
    await page.locator('#fieldMember').selectOption('L. Atrakimaviciene');
    await page.waitForSelector('.day-row', { timeout: 10000 });

    const worked = await page.evaluate(() => [...document.querySelectorAll('.day-row')]
        .map((r) => {
            const b = r.querySelector('.shift-badge');
            const rect = b.getBoundingClientRect();
            return { text: b.innerText.replace(/\s+/g, ' ').trim(), aria: b.getAttribute('aria-label'),
                     right: rect.right, rowRight: r.getBoundingClientRect().right,
                     h: rect.height, rowH: r.getBoundingClientRect().height };
        })
        .filter(x => /badge/.test('') === false));

    const timed = worked.filter(x => /\d{2}:\d{2}-\d{2}:\d{2}/.test(x.text));
    expect(timed.length, 'this member works most of the week — the fixture must contain worked days').toBeGreaterThan(2);
    for (const b of timed) {
        expect(b.aria, 'the classification moves into the accessible name, it is not dropped')
            .toMatch(/^(Early|Late|Night) shift, \d{2}:\d{2} to \d{2}:\d{2}$/);
        expect(b.right, 'the wider badge must stay inside its row').toBeLessThanOrEqual(b.rowRight);
        expect(b.h, 'and must not wrap onto a second line — that would add ~14px to all seven rows')
            .toBeLessThan(28);
    }
    // A non-worked day keeps its word: REST has no time, and "Rest" IS the information.
    expect(worked.some(x => /REST/i.test(x.text) && !x.aria), 'rest days are untouched').toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
        .toBe(true);
});

test('admin: selecting a pill with hours causes no horizontal blowout (touch layout)', async ({ page }) => {
    // 360px = the most common Android CSS width (1080 physical ÷ 3, e.g. Samsung) — the
    // width where the second-round residue (the nowrap bulk-time-group) actually clipped.
    await page.setViewportSize({ width: 360, height: 800 });
    await seedSession(page);
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });

    // The bulk path that reproduced the blowout: tick Mon–Fri, choose a bulk pill WITH
    // hours (reveals the nowrap bulk time inputs — the element that historically clipped),
    // apply (reveals per-row time inputs on five rows). 'Shift' rather than 'Other' since
    // v16.47 — Other is applied per-row, not in bulk (it needs a per-row flavour), so it is
    // no longer a bulk pill; any hours pill reproduces the same bulk-time-group layout.
    await page.locator('#bulkSelMonFri').click();
    await page.locator('#bulkTypePills .pill-shift').click();
    await page.locator('#bulkApplyBtn').click();
    // Also reveal the per-row "Other" sub-controls (flavour chips + optional times) on a
    // weekday row — the most width-hungry revealed control set, now reached only per-row.
    const otherPill = page.locator('.day-row .pill-other:not([disabled])').first();
    if (await otherPill.count()) await otherPill.click();
    await page.waitForTimeout(200);

    const m = await page.evaluate(() => {
        let max = 0, worst = '';
        document.querySelectorAll('body *').forEach(el => {
            const w = el.getBoundingClientRect().width;
            if (w > max) { max = w; worst = `${el.tagName}.${String(el.className).split(' ')[0]}`; }
        });
        return { max: Math.round(max), innerW: window.innerWidth, worst };
    });
    expect(m.max, `widest element ${m.worst} at ${m.max}px vs viewport ${m.innerW}px`)
        .toBeLessThanOrEqual(m.innerW + 2);
});

// ── FIP GUIDE (fip.html) — jump-to-open + malformed-hash safety ──────────────

test('fip: a country jump-link opens that country section (C1)', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.goto('/fip.html#country-fr');   // deep-link straight to France
    // fip.js opens the target <details> on load; without it the row stays collapsed.
    await expect(page.locator('#country-fr')).toHaveAttribute('open', '');
    // And an in-page jump (hashchange) opens another one.
    await page.locator('.country-jump a[href="#country-be"]').click();
    await expect(page.locator('#country-be')).toHaveAttribute('open', '');
    expect(errors, `fatal errors: ${errors.join('; ')}`).toEqual([]);
});

test('fip: a malformed hash does not throw (safeDecode)', async ({ page }) => {
    const errors = collectFatalErrors(page);
    // A lone "%" is an invalid percent-escape — decodeURIComponent would throw uncaught without the guard.
    await page.goto('/fip.html#%');
    // Page still renders (the jump bar exists) and nothing crashed.
    await expect(page.locator('.country-jump')).toBeVisible();
    expect(errors, `fatal errors: ${errors.join('; ')}`).toEqual([]);
});

// Country finder (v17.64): search filters the country cards + A–Z chips; clear + no-match + popular.
test('fip: the country finder filters cards, shows a no-match, and clears', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.goto('/fip.html');
    const search = page.locator('#countrySearch');
    await expect(search).toBeVisible();
    // On an empty field the clear ✕ and the count are hidden (regression guard: an author `display`
    // rule can silently override the `hidden` attribute).
    await expect(page.locator('#countryClear')).toBeHidden();
    await expect(page.locator('#countryCount')).toBeHidden();

    // Filter to Spain: Spain stays, an unrelated country (Norway) is hidden, count + clear appear.
    await search.fill('spain');
    await expect(page.locator('#country-es')).toBeVisible();
    await expect(page.locator('#country-no')).toBeHidden();
    // Counted from the DOM, never written down. The literal 25 outlived the guide by one release:
    // the v20.25 country pass took it to 32 and this assertion failed on correct behaviour.
    const totalCountries = await page.locator('[id^="country-"]').count();
    await expect(page.locator('#countryCount')).toContainText(`of ${totalCountries} countries`);
    await expect(page.locator('#countryClear')).toBeVisible();
    // The A–Z chip for a hidden country is hidden too (kept in lockstep with its card).
    await expect(page.locator('.country-jump a[href="#country-no"]')).toBeHidden();

    // Gibberish → no-match message; every card hidden.
    await search.fill('qwertyzzz');
    await expect(page.locator('#countryNoMatch')).toBeVisible();
    await expect(page.locator('#country-es')).toBeHidden();

    // Clear button resets everything.
    await page.locator('#countryClear').click();
    await expect(page.locator('#country-no')).toBeVisible();
    await expect(page.locator('#countryNoMatch')).toBeHidden();
    await expect(search).toHaveValue('');
    expect(errors, `fatal errors: ${errors.join('; ')}`).toEqual([]);
});

test('fip: the section chip-bar jumps to a section and marks it current', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.goto('/fip.html');
    const chip = page.locator('.chip-bar .chip[data-target="sec-mistakes"]');
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(page.locator('#sec-mistakes')).toBeInViewport();
    await expect(chip).toHaveAttribute('aria-current', 'true');
    // Clicking a different chip moves the current marker.
    const other = page.locator('.chip-bar .chip[data-target="sec-booking"]');
    await other.click();
    await expect(other).toHaveAttribute('aria-current', 'true');
    await expect(chip).not.toHaveAttribute('aria-current', 'true');
    expect(errors, `fatal errors: ${errors.join('; ')}`).toEqual([]);
});

test('fip: scrollspy marks the chip for the section scrolled into view', async ({ page }) => {
    await page.goto('/fip.html');
    // A mid-page section scrolled under the sticky stack becomes current.
    await page.evaluate(() => document.getElementById('sec-ferries').scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(350);
    await expect(page.locator('.chip[data-target="sec-ferries"]')).toHaveAttribute('aria-current', 'true');
    // At the very bottom, the last chip (Apply) wins even if its short section never reached the line.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(350);
    await expect(page.locator('.chip[data-target="sec-apply"]')).toHaveAttribute('aria-current', 'true');
    // Back at the top, the first chip (Overview) wins (covers the page-intro above section 1).
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(350);
    await expect(page.locator('.chip[data-target="sec-need"]')).toHaveAttribute('aria-current', 'true');
});

test('fip: a "popular" shortcut opens its country, clearing an active filter first', async ({ page }) => {
    await page.goto('/fip.html');
    // Filter so France is hidden, then tap the popular France shortcut: it must clear the filter,
    // reveal France, and open it.
    await page.locator('#countrySearch').fill('spain');
    await expect(page.locator('#country-fr')).toBeHidden();
    await page.locator('.cf-popular a[href="#country-fr"]').click();
    await expect(page.locator('#country-fr')).toBeVisible();
    await expect(page.locator('#country-fr')).toHaveAttribute('open', '');
    await expect(page.locator('#countrySearch')).toHaveValue('');
});

// ── FIP: the booking-reach table (v20.31–32) ───────────────────────────────────────────────────
//
// This is the only table on the guide, and it exists because "can I book this before I leave?" was
// the question the page could not answer. Two things about it can break WITHOUT anything throwing,
// which is why they are tested rather than eyeballed:
//
//   1. The country finder selects cards by `[id^="country-"]`. The table is a <details> sitting in
//      a different section, so it must be invisible to the filter — if a future id or selector
//      change swept it in, typing a country name would hide the table that answers the question
//      about that country. Nothing would error; the table would just vanish.
//
//   2. Below 560px the rows STACK, and each cell states its own column through a `data-label`
//      ::before. Before that, the international column clipped at the card edge with no scroll
//      affordance — so "Trains to Romania only" read as "Trai…", and a truncated answer looks like
//      a whole one. The stacked layout is a CSS media query over generated content: a static test
//      cannot see it and a unit test has no layout, so it takes a real browser at a real width.
test('fip: the booking-reach table answers per country, and the finder leaves it alone', async ({ page }) => {
    await page.goto('/fip.html');
    const table = page.locator('#booking-table');
    await table.evaluate(el => { el.open = true; });

    // Every country RST lists gets a row, and the three answer classes all render.
    await expect(table.locator('tbody tr')).toHaveCount(22);
    // Match on the ROW HEADER, not row text: several rows name another country in their
    // international column ("TER/IC to Belgium"), so `hasText` picks up three rows for Belgium.
    const rowFor = name => table.locator('tbody tr').filter({
        has: page.locator(`td[role="rowheader"]:text-is("${name}")`),
    });
    await expect(rowFor('Belgium').locator('td[data-label="Domestic"]'))
        .toContainText('75% is ticket offices only');
    await expect(rowFor('France').locator('td[data-label="Domestic"]'))
        .toContainText('SNCF Contact Centre');
    await expect(rowFor('Spain').locator('td[data-label="Domestic"]')).toHaveClass(/t-yes/);

    // A "no" must never be presented as a refusal of FIP — the caption carries that, and it is the
    // difference between "you cannot go" and "buy it when you arrive".
    await expect(table).toContainText('buy it at a ticket office when you get there');

    // The finder must not touch it: filter to one country and the table stays put.
    await page.locator('#countrySearch').fill('spain');
    await expect(page.locator('#country-fr')).toBeHidden();
    await expect(table).toBeVisible();
});

test('fip: the booking table stacks with labelled cells on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto('/fip.html');
    await page.locator('#booking-table').evaluate(el => { el.open = true; });

    // The stacked layout announces each column per cell. Read the generated content, because that
    // IS the header on this layout — the real <thead> is clipped away.
    const label = await page.locator('#booking-table tbody td[data-label]').first()
        .evaluate(el => getComputedStyle(el, '::before').content);
    expect(label).toContain('Domestic');

    // Rows must be blocks, not table-rows — that is what proves the media query applied.
    const display = await page.locator('#booking-table tbody tr').first()
        .evaluate(el => getComputedStyle(el).display);
    expect(display).toBe('block');

    // And nothing may clip: the answer text must fit inside its own cell at this width.
    const overflow = await page.locator('#booking-table tbody td[data-label]')
        .evaluateAll(tds => tds.filter(td => td.scrollWidth > td.clientWidth + 1).length);
    expect(overflow).toBe(0);

    // The page itself must not scroll sideways either.
    const bodyOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(bodyOverflow).toBeLessThanOrEqual(0);
});

// Every country and ferry card states when it was checked. guide-sources.test.mjs proves the line is
// PRESENT in the markup and that its date matches the register; this proves it is actually VISIBLE
// once the card is open — a static check cannot tell an evidence line from one a stylesheet hides.
test('fip: an opened country card shows its checked date', async ({ page }) => {
    await page.goto('/fip.html');
    await page.locator('#country-cz').evaluate(el => { el.open = true; });
    const line = page.locator('#country-cz .country-reviewed');
    await expect(line).toBeVisible();
    await expect(line).toContainText('Checked Aug 2026');
});

// ── OPERATIONS: Password Reset Requests card WITH ROWS (v18.94) ────────────────────────────────
// This card shipped at v18.93 rendered only at 1280px, and its row collapsed at 375px — the name
// column squeezed to 18px, names broke mid-word and the text painted over the remedy label. Nothing
// caught it: the page-level overflow guards stay clean (the overflow is inside a flex child), and
// there was no way to render an Operations card with DATA. Hence both: the seeding hook in
// fixtures.js, and this test at the documented primary width.
for (const width of [375, 1280]) {
    test(`operations reset-requests card renders correctly @${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.addInitScript(() => {
            window.__E2E = { docs: [
                { id: 'A. Hared',       requestedAt: Date.now() - 4 * 60_000,    count: 1, provisioned: true },
                { id: 'N. Bedingfield', requestedAt: Date.now() - 26 * 3600_000, count: 1, provisioned: false },
                { id: 'K. Jedlinski',   requestedAt: Date.now() - 90 * 60_000,   count: 4, provisioned: true },
            ] };
        });
        await seedSession(page, 'G. Miller');
        await page.goto('/operations.html');

        const rows = page.locator('.rr-row');
        await expect(rows).toHaveCount(3);
        // The card auto-opens when there is anything to action, and the chip counts it.
        await expect(page.locator('#resetRequestsCountChip')).toHaveText('3');
        await expect(page.locator('.rr-row').first()).toBeVisible();
        // An unprovisioned account needs Set up accounts, not Reset — different remedy, stated.
        await expect(page.locator('.rr-remedy--setup')).toHaveText(/Set up accounts/);
        await expect(page.locator('.rr-row', { hasText: 'K. Jedlinski' })).toContainText('asked 4 times');

        // No row may overflow its own box — the failure mode that shipped. Checked per flex child,
        // because the PAGE reports no overflow when a flex item overflows internally.
        const overflow = await page.locator('.rr-main').evaluateAll(
            els => els.map(el => el.scrollWidth - el.clientWidth));
        expect(overflow, `.rr-main overflow at ${width}px`).toEqual([0, 0, 0]);
        const pageOverflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(pageOverflow).toBeLessThanOrEqual(1);
    });
}

// ── OPERATIONS: the reset-request push deep link (v18.95) ──────────────────────────────────────
// The admin's notification opens operations.html#reset-requests. Operations has nine collapsed
// cards, so landing on the page alone would still leave them hunting for the one it was about.
test('operations #reset-requests deep link opens and scrolls to the queue card', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    // Deliberately seeded EMPTY: with rows the card auto-opens anyway, so an empty queue is the only
    // state that actually proves the deep link — not the auto-open — did the work. (A cleared queue
    // is a real arrival state: the admin taps a notification after already handling it elsewhere.)
    await page.addInitScript(() => { window.__E2E = { docs: [] }; });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html#reset-requests');

    const body = page.locator('#resetRequestsBody');
    await expect(body).toHaveClass(/\bopen\b/);
    // The chevron must AGREE with the class — opening by class alone leaves a screen reader told the
    // card is still collapsed (A11Y_FINDINGS.md v18.68).
    await expect(page.locator('#resetRequestsChevron')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#resetRequestsCard')).toBeInViewport();
});

test('operations deep link only ever opens — a repeat tap does not close the card', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(() => { window.__E2E = { docs: [] }; });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html#reset-requests');
    await expect(page.locator('#resetRequestsBody')).toHaveClass(/\bopen\b/);

    // Tapping the notification while Operations is ALREADY open re-navigates the existing client, so
    // only hashchange fires. A toggle here would close the card the admin was sent to look at.
    await page.evaluate(() => {
        location.hash = '';
        location.hash = '#reset-requests';
    });
    await expect(page.locator('#resetRequestsBody')).toHaveClass(/\bopen\b/);
});

test('operations without the hash leaves the queue card collapsed', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(() => { window.__E2E = { docs: [] }; });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await expect(page.locator('#resetRequestsContent')).toContainText('No outstanding requests');
    await expect(page.locator('#resetRequestsBody')).not.toHaveClass(/\bopen\b/);
});

// ── SETTINGS: Password card reveal toggle (v18.95) ─────────────────────────────────────────────
// The login overlay and the forced overlay both offer a reveal; this card asked for an 8+ character
// password TWICE with no way to see either, which is where a mistyped password comes from.
// REMOVED at v22.37: 'Show reveals BOTH new and confirm'. It pinned the OLD control — a `Show`
// button beside New that silently also governed Confirm — and its successor covers strictly more:
// 'Show passwords reveals all THREE fields, not two' asserts Current as well, which is where a
// mistyped password most often comes from and which the old control never reached.

test('settings: a member migrated on ANOTHER device is told so here', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    // The server says migrated; this device has never been told. `toMillis` because that is the
    // shape isPasswordMigrated reads — a plain Date would silently score 0 and pass for the wrong
    // reason, reporting un-migrated on a doc that says otherwise.
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = /** @type {any} */ (window).__E2E || {};
        /** @type {any} */ (window).__E2E.getDocData = { passwordSetAt: { toMillis: () => 1_760_000_000_000 } };
    });
    await page.goto('/settings.html');
    await expect(page.locator('#passwordStatusChip')).toHaveText(/password set/i);
});

test('settings: an UN-migrated member is told that instead', async ({ page }) => {
    // The mirror image. Default fixture `getDoc` resolves "does not exist", i.e. still on the
    // surname default — and saying "your own password" to somebody who has not set one would tell
    // them a security job is done when it is not.
    await seedSession(page, 'G. Miller');
    await page.goto('/settings.html');
    await expect(page.locator('#passwordStatusChip')).toHaveText(/using surname/i);
});

test('settings: the forced overlay\'s success updates the chip without a reload', async ({ page }) => {
    // password-force.js dispatches `myb:password-set` when it succeeds, which the card listens for
    // (v18.94). That path paints migrated OPTIMISTICALLY — the serverTimestamp has not resolved —
    // so the chip must move on the event alone.
    await seedSession(page, 'G. Miller');
    await page.goto('/settings.html');
    await expect(page.locator('#passwordStatusChip')).toHaveText(/using surname/i);

    await page.evaluate(() => document.dispatchEvent(new CustomEvent('myb:password-set')));
    await expect(page.locator('#passwordStatusChip')).toHaveText(/password set/i);
});

// REMOVED at v22.37: 'the typed value is not hidden under the Show button'. It measured that the
// New Password field reserved enough padding-right for the `Show` button overlaid on it — a real
// hazard, and one that cannot arise any more, because there is no overlaid button. The reveal is
// now a labelled checkbox BELOW the three fields ('Show passwords reveals all THREE fields' above),
// which is both the accessibility fix and the end of that whole class of collision.

// ── OPERATIONS: exact unique-account sign-in counts on the Usage card (v18.96) ──────────────────
// The counterpart to the device-deduped "active accounts" figure. It comes from a SECOND network
// call (a Cloud Function, not Firestore) appended to a card that already has its data, so the two
// things worth pinning are that it renders, and that its failure can never take the card with it.
for (const width of [375, 1280]) {
    test(`operations usage: sign-in counts render @${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1200 });
        await page.route('**/getSignInStats', route => route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({ total: 48, last7: 19, last30: 31, neverSignedIn: 6 }),
        }));
        await page.addInitScript(() => { window.__E2E = { authUser: true }; });
        await seedSession(page, 'G. Miller');
        await page.goto('/operations.html');

        const section = page.locator('.usage-signin');
        await expect(section).toContainText('Accounts that have signed in');
        await expect(section).toContainText('31');
        await expect(section).toContainText('19');
        await expect(section).toContainText('6');
        // "staff accounts", never "active accounts" — this card already uses "active" for the
        // device-deduped figure above, and two different numbers must not appear to measure one thing.
        await expect(section).toContainText('48 staff accounts');
        await expect(section).not.toContainText('48 active accounts');

        // No child may overflow its own box — the failure mode the reset-requests row shipped with,
        // which the page-level guard cannot see (the overflow is inside a flex child).
        const overflow = await section.locator('.usage-stat').evaluateAll(
            els => els.map(el => el.scrollWidth - el.clientWidth));
        expect(overflow, `.usage-stat overflow at ${width}px`).toEqual([0, 0, 0]);
        const pageOverflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(pageOverflow).toBeLessThanOrEqual(1);
    });
}

test('operations usage: a failed sign-in-stats call leaves the rest of the card intact', async ({ page }) => {
    // The whole point of appending it detached. A Cloud Function outage must cost the admin this one
    // section, not the page-popularity data and account trend that loaded perfectly well.
    await page.route('**/getSignInStats', route => route.abort());
    await page.addInitScript(() => { window.__E2E = { authUser: true }; });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');

    // The empty wrapper removes itself rather than leaving a stray divider rule.
    await expect(page.locator('.usage-signin')).toHaveCount(0);
    // ASSERTED STRUCTURALLY, NOT ON THE LABEL (v20.08). This read `toContainText('accounts this
    // month')` and broke when that block was renamed — the string was never the subject. `.usage-stats`
    // is emitted by exactly two blocks, the trend one and the sign-in one, so with `.usage-signin`
    // proven absent above, a count of 1 says precisely what this test is about: the section that
    // failed cost us that section and nothing else.
    await expect(page.locator('#usageContent .usage-stats')).toHaveCount(1);
    await expect(page.locator('#usageContent')).toContainText('Page popularity');
    // And no "Couldn't load usage" retry state — the card itself did not fail.
    await expect(page.locator('#usageContent')).not.toContainText('Couldn’t load usage');
});

test('operations usage: the section is absent (not broken) when there is no Firebase user', async ({ page }) => {
    // Default stub state — getSignInStats throws "Not signed in" before it ever fetches. Proves the
    // section degrades the same way whether the call fails or is never made.
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await expect(page.locator('#usageContent')).toContainText('Page popularity');
    await expect(page.locator('.usage-signin')).toHaveCount(0);
});

// ── Reset requests: a Clear during an in-flight load must not leave a ghost (v18.97) ────────────
// v18.94 stopped two Clears racing by DROPPING a refresh requested mid-load. That fixed the ordering
// but left a subtler ghost (external review): clear A → refresh A starts → clear B → refresh B is
// discarded → A's snapshot, taken before B was deleted, repaints B, and nothing is queued to correct
// it. The fixture delays reads so the interleaving is reproducible rather than a matter of luck, and
// deleteDoc now really removes the row so a ghost and a correctly-cleared row look different.
test('operations reset requests: clearing two rows quickly leaves neither behind', async ({ page }) => {
    await page.addInitScript(() => {
        window.__E2E = {
            docsDelayMs: 400,        // hold every read open long enough to overlap the second Clear
            docs: [
                { id: 'A. Hared',     requestedAt: Date.now() - 60_000, count: 1, provisioned: true },
                { id: 'K. Jedlinski', requestedAt: Date.now() - 90_000, count: 1, provisioned: true },
            ],
        };
    });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await expect(page.locator('.rr-row')).toHaveCount(2);

    // Two Clears in quick succession — the second lands while the first's refresh is still open.
    //
    // The FIRST is a real click, which is what proves the button is genuinely clickable. The SECOND
    // is dispatched in-page, and that is not a shortcut: the card re-renders while the delayed reads
    // land, so a driven click spends its budget on Playwright's actionability wait — "element is not
    // stable", then "detached from the DOM, retrying" — and on WebKit under CI load it never lands
    // at all, timing out at 30s having never exercised the concurrency this test exists for. Keyed
    // by `data-member` rather than by index, because after the first Clear the indices have moved.
    await page.locator('.btn-rr-clear[data-member="A. Hared"]').click();
    await page.evaluate(() => {
        /** @type {HTMLButtonElement|null} */
        (document.querySelector('.btn-rr-clear[data-member="K. Jedlinski"]'))?.click();
    });

    // Both deletes happened, so the card must end up empty. With the dropped-refresh behaviour the
    // second row survives as a ghost with no pending load to remove it.
    await expect(page.locator('#resetRequestsContent')).toContainText('No outstanding requests', { timeout: 10_000 });
    await expect(page.locator('.rr-row')).toHaveCount(0);
    // The chip must agree — a stale count over an empty list is the v18.94 lesson.
    await expect(page.locator('#resetRequestsCountChip')).toHaveText('');
});

test('settings (signed in): the Pay Calculator Data pointer card renders and links to the backup card', async ({ page }) => {
    // A POINTER, not a second copy of the controls — see paycalc-transfer-card.js.
    await seedSession(page);
    await page.goto('/settings.html');
    const card = page.locator('#payDataCard');
    await expect(card).toBeVisible();
    // The card starts COLLAPSED now (v22.37) — it has no wrong state to warn about, so it shows a
    // count and waits to be asked. Its link is behind that, which is the journey a member takes.
    await expect(card.locator('a[href*="paycalc.html#payTransferCard"]')).toBeHidden();
    await page.locator('#payDataChevron').click();
    await expect(card.locator('a[href*="paycalc.html#payTransferCard"]')).toBeVisible();
});

// ── Roster review: resolving a flagged cell (v19.32, CI-gated) ────────────────────────────────
// The visual baseline covers this table's COMPOSITION but is opt-in and not a CI gate, so the
// feature's WIRING is asserted here where every branch runs it. What only a real browser proves is
// that the pick reaches the save collector — the rules themselves are unit-tested in
// admin-roster-upload.test.mjs, and duplicating them here would be a second, weaker copy.
test('operations: a flagged roster cell can be resolved from the review table', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await seedSession(page, 'G. Miller');
    await openRosterReview(page);

    const saveBtn = page.locator('#rosterApplyBtn');
    // Three DIFF rows are pre-ticked. The two flagged rows start unresolved and must contribute
    // NOTHING — the pre-v19.32 behaviour is what you get by leaving them alone.
    await expect(saveBtn).toHaveText(/Save 3 changes/);
    await expect(page.locator('.roster-pick')).toHaveCount(3);   // 1 conflict + 2 flagged

    // A garbled cell has no readings to offer, so it stays a skip-only row — the picker must not
    // appear just because a cell was flagged.
    await expect(page.locator('.roster-change-row .act-read')).toHaveCount(1);

    // A flagged row sitting over a MANUAL entry must SHOW it (v19.37). Picking writes with
    // replaceId, so the manual entry is replaced — and this table's standing guarantee is that a
    // hand-recorded entry is never overwritten without the admin seeing it. The fixture puts a
    // manual AL under the Thursday row for exactly this.
    const overManual = page.locator('.roster-change-row')
        .filter({ has: page.locator('.roster-choice-btn[data-opt="0"]') })
        .filter({ hasText: 'Saved' });
    await expect(overManual, 'the flagged row over a manual entry names what it would replace').toHaveCount(1);
    await expect(overManual).toContainText('AL');

    // Picking a reading makes it a change to save…
    const flagged = page.locator('.roster-change-row').filter({ has: page.locator('.roster-choice-btn[data-opt="0"]') });
    await flagged.last().locator('.roster-choice-btn[data-opt="0"]').click();
    await expect(saveBtn).toHaveText(/Save 4 changes/);

    // …and Skip puts it back to writing nothing, so a mis-tap is always recoverable.
    await flagged.last().locator('.roster-choice-btn[data-opt="skip"]').click();
    await expect(saveBtn).toHaveText(/Save 3 changes/);

    // Then actually SAVE, and assert the picked value reaches the write. The counter above and the
    // save collector are two separate passes over the same state: asserting only the button text
    // left this with no teeth at all (breaking the collector kept every assertion green), and a
    // button promising N while N-1 are written is precisely the bug worth catching.
    await flagged.first().locator('.roster-choice-btn[data-opt="0"]').click();
    await expect(saveBtn).toHaveText(/Save 4 changes/);
    await saveBtn.click();
    await expect.poll(() => page.evaluate(() => (window.__E2E?.batchWrites || []).length)).toBe(4);
    const values = await page.evaluate(() => (window.__E2E?.batchWrites || []).map(w => w.value));
    // Thursday's first reading is RDW|14:30-22:00, which saves as the bare time with type 'rdw'.
    expect(values, 'the picked reading must be among the values written').toContain('14:30-22:00');
});

// "Skip all" must skip the row the admin was LEAST sure about (v21.94).
//
// `UNREADABLE` gained a writable `chosen` when the two-way pick shipped at v19.32; this handler
// predates it and branched only on DIFF/REMOVE_IMPORT/CONFLICT. So an admin who picked a reading and
// then pressed Skip all got a dimmed, `inert` section whose picked value was STILL WRITTEN by Save,
// with the chosen button keeping its highlight under the overlay.
//
// Driven through the real review table, because the bug was a missing branch in a delegated handler
// — there is no rule to unit-test, and the section state is inside a closure. The Save button's
// label is the observable consequence: with everything skipped it must offer nothing at all.
test('operations: Skip all also clears a resolved "couldn\'t read" pick', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await seedSession(page, 'G. Miller');
    await openRosterReview(page);

    const saveBtn = page.locator('#rosterApplyBtn');
    const flagged = page.locator('.roster-change-row').filter({ has: page.locator('.roster-choice-btn[data-opt="0"]') });
    await expect(saveBtn).toHaveText(/Save 3 changes/);

    // Resolve one flagged cell — now four things would be written.
    await flagged.first().locator('.roster-choice-btn[data-opt="0"]').click();
    await expect(saveBtn).toHaveText(/Save 4 changes/);

    // Skip all for that person. Every row in the section belongs to G. Miller, so nothing is left.
    await page.locator('.roster-skip-all-btn').first().click();
    await expect(saveBtn, 'the resolved flagged row was still going to be written').toHaveText(/Nothing to save/);
    await expect(saveBtn).toBeDisabled();

    // The row must SAY so too: back on Skip, back to "Couldn't read". A section that writes nothing
    // while a value still looks chosen is the same contradiction one layer down.
    await expect(flagged.first().locator('.roster-choice-btn--skip')).toHaveClass(/is-chosen/);
    await expect(flagged.first().locator('.roster-choice-btn[data-opt="0"]')).not.toHaveClass(/is-chosen/);

    // Restore brings the ticked rows back — and must NOT re-pick the flagged one. There is no safe
    // default for a cell nobody could read, which is why it starts on neither.
    await page.locator('.roster-skip-all-btn').first().click();
    await expect(saveBtn).toHaveText(/Save 3 changes/);
    await expect(flagged.first().locator('.roster-choice-btn[data-opt="0"]')).not.toHaveClass(/is-chosen/);
});

// Skip means "write nothing", so it must never wear the colour that means "this will be saved".
// Asserted on computed style rather than by screenshot: --text-mid (L45%) and --success-green
// (L48.5%) differ in HUE at near-equal luminance, and pixelmatch's delta is luminance-dominated, so
// the visual baseline provably cannot see this swap (verified in v19.34).
test('operations: the review table Skip button is not the success colour', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await seedSession(page, 'G. Miller');
    await openRosterReview(page);

    const flagged = page.locator('.roster-change-row').filter({ has: page.locator('.roster-choice-btn[data-opt="0"]') });
    await flagged.first().locator('.roster-choice-btn[data-opt="0"]').click();
    await page.waitForTimeout(300);   // the background transition must settle, or both read as
                                      // interpolated oklab() and a string compare is meaningless
    const [skipBg, valueBg] = await page.evaluate(() => [
        getComputedStyle(/** @type {Element} */ (document.querySelector('.roster-choice-btn--skip.is-chosen'))).backgroundColor,
        getComputedStyle(/** @type {Element} */ (document.querySelector('.roster-choice-btn[data-opt="0"].is-chosen'))).backgroundColor,
    ]);
    expect(skipBg, 'Skip must not wear the colour that means "this will be saved"').not.toBe(valueBg);
});


// ── Links workspace — behaviour, not just "the page rendered" (v19.38) ────────────────────────
// Until now the only links coverage was auth: does a designer get in, does a non-designer bounce.
// Nothing exercised what the page is FOR — paint a cell, save it, generate a link, compare designs
// — even though the dirty-flag web (beforeunload + capture-phase nav guard + sign-out + logo) and
// the co-edit concurrency guard are the most intricate code in the app. The RULES now live in
// links-design.js / links-concurrency.js and are unit-tested; these cover the WIRING.
async function openLinks(page) {
    await page.addInitScript(() => {
        // Suppress the first-visit notice. This helper did NOT do this until v19.51, and the suite
        // passed anyway — because the notice it needed to suppress had been EXPIRED since Jul 2026
        // and never opened. Posting a live one broke ten tests at once. Note which ten: every test
        // that CLICKS something. "a designer sees every line" kept passing with a modal over the
        // page, because text is readable behind an overlay — the same assert-text-vs-drive-the-UI
        // split that has hidden three separate defects this release. Seed it HERE, once, rather
        // than in each test.
        localStorage.setItem('myb_links_welcome_seen', '1');
        /** @type {any} */ (window).__E2E = /** @type {any} */ (window).__E2E || {};
        /** @type {any} */ (window).__E2E.docs = [{
            id: 'd1', name: 'Option A', updatedBy: 'S. Silva',
            // TWO distinct times, one early and one late (v21.14). It was a single Monday early,
            // and that was enough only while the paint bar was built from the ROSTER — since it is
            // built from the DESIGN, a one-time design correctly gets a one-chip bar, and the
            // rapid-tapping test needs two chips to alternate between (repainting the same value
            // short-circuits, so a single chip would measure nothing).
            patterns: { '1': { sun: 'RD', mon: '06:20-14:20', tue: '14:00-22:00', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' } },
        }];
    });
    await page.goto('/links.html');
    await expect(page.locator('#linksGridBodyRows tr')).toHaveCount(ROTATING_LINES);
}

test('links: a designer sees every rotating line and the saved design', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await seedSession(page, 'G. Miller');
    await openLinks(page);
    // Line 1 Monday carries the seeded shift; the rest of the rotation is undesigned.
    await expect(page.locator('tr[data-pos="1"] .shift-cell-btn').nth(1)).toContainText('06:20');
    await expect(page.locator('tr.row-unfilled')).toHaveCount(ROTATING_LINES - 1);
});

test('links: painting a cell marks the design dirty and enables Save', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await seedSession(page, 'G. Miller');
    await openLinks(page);

    const save = page.locator('#linksSaveBtn');
    await expect(save).toBeDisabled();                       // nothing changed yet

    // A real SHIFT chip, not the RD one that leads the bar — painting RD onto a rest day changes
    // nothing, and (since v19.38) correctly does not dirty the design.
    await page.locator('#brushBar .brush-chip.type-early').first().click();
    await page.locator('tr[data-pos="2"] .shift-cell-btn').nth(1).click();

    await expect(save).toBeEnabled();
    await expect(page.locator('tr[data-pos="2"]')).not.toHaveClass(/row-unfilled/);
});

test('links: painting a cell with the value it already has is not a change', async ({ page }) => {
    // Found by writing the test above: the RD chip leads the paint bar, so the obvious first move is
    // to paint RD onto a rest day — which changed nothing yet armed the whole unsaved-changes
    // apparatus (beforeunload, the "changes will be lost" confirm on every design switch and on
    // sign-out). One stray tap and the page believed there was work to lose (fixed v19.38).
    await page.setViewportSize({ width: 390, height: 900 });
    await seedSession(page, 'G. Miller');
    await openLinks(page);

    await page.locator('#brushBar .brush-chip.type-rd').first().click();   // the RD brush
    await page.locator('tr[data-pos="2"] .shift-cell-btn').nth(1).click(); // onto an existing RD

    await expect(page.locator('#linksSaveBtn')).toBeDisabled();
});

test('links: saving writes the patterns and clears the dirty state', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await seedSession(page, 'G. Miller');
    await openLinks(page);
    await page.locator('#brushBar .brush-chip.type-early').first().click();
    await page.locator('tr[data-pos="2"] .shift-cell-btn').nth(1).click();
    await page.locator('#linksSaveBtn').click();

    // The status line and the button are the user-visible contract; asserting only one of them
    // would pass on a save that reported success without disarming the dirty flag.
    await expect(page.locator('#linksSaveStatus')).toContainText('Saved');
    await expect(page.locator('#linksSaveBtn')).toBeDisabled();
});

test('links: the generator fills every line and names what it replaces', async ({ page }) => {
    // v20.98: the generator refuses targets that cannot pay the contracted week, and the
    // roster seed cannot at this rotation — so a spec that generates brings work with it.
    await seedContractTargets(page);
    await page.setViewportSize({ width: 390, height: 1000 });
    await seedSession(page, 'G. Miller');
    await openLinks(page);

    await page.locator('#generatorToggleHeader').click();
    await page.locator('#genApplyBtn').click();

    // The active design has content, so the confirm must say so rather than the generic wording —
    // Apply overwrites every line either way (v19.38).
    const dialog = page.locator('.lb-overlay.visible');
    await expect(dialog).toContainText('Option A');
    await expect(dialog).toContainText(new RegExp(`replaces all ${ROTATING_LINES} lines`, 'i'));
    await dialog.getByRole('button', { name: new RegExp(`Replace all ${ROTATING_LINES} lines`, 'i') }).click();

    await expect(page.locator('tr.row-unfilled')).toHaveCount(0);   // every line now designed
    await expect(page.locator('#linksSaveBtn')).toBeEnabled();
});

test('links: paint-mode analysis keeps up with rapid tapping', async ({ page }) => {
    // C7 was a SUSPICION — every cell tap re-runs the coverage maths, the hour-by-hour heat map and
    // the design checks, and paint mode is explicitly rapid tapping. Measured rather than assumed:
    // the maths is ~0.3ms in Node, and this puts a number on the DOM half in a real browser. A
    // debounce would add state and a stale-analysis failure mode, so it is only worth it if this
    // budget is actually threatened.
    await page.setViewportSize({ width: 390, height: 900 });
    await seedSession(page, 'G. Miller');
    await openLinks(page);

    // NOTE: no pre-armed brush here. Clicking an already-armed chip DISARMS it, so pre-arming made
    // the loop's first chip click turn painting OFF — the next cell tap then opened the edit
    // dropdown, replacing that button and quietly measuring the wrong thing. The loop arms its own.
    const cells = page.locator('tr[data-pos="3"] .shift-cell-btn');
    const perTap = await page.evaluate(async () => {
        // Alternate two brushes so every tap is a REAL change — since v19.38 repainting the same
        // value short-circuits, which would measure nothing.
        const chips = Array.from(document.querySelectorAll('#brushBar .brush-chip.type-early, #brushBar .brush-chip.type-late'));
        const btns  = Array.from(document.querySelectorAll('tr[data-pos="3"] .shift-cell-btn'));
        const t0 = performance.now();
        for (let i = 0; i < 20; i++) {
            /** @type {HTMLElement} */ (chips[i % 2]).click();          // re-arm (alternating value)
            /** @type {HTMLElement} */ (btns[i % btns.length]).click(); // paint
        }
        return (performance.now() - t0) / 20;
    });
    // eslint-disable-next-line no-console
    console.log(`[links] paint tap → full re-analysis: ${perTap.toFixed(2)} ms`);
    expect(await cells.count()).toBe(7);
    // One frame is 16.7ms. A tap costing more than that would drop frames while painting.
    expect(perTap, 'a paint tap must stay inside one frame').toBeLessThan(16);
});

test('links: generator targets are remembered per design', async ({ page }) => {
    // The design was saved but the INPUTS that produced it were not — every load re-seeded from the
    // roster, so tuning was lost on reload (v19.38).
    await page.setViewportSize({ width: 390, height: 1000 });
    await seedSession(page, 'G. Miller');
    await openLinks(page);
    await page.locator('#generatorToggleHeader').click();

    // Spare is a count of whole LINES since v19.58 — a spare week is a full week on cover, not a
    // per-day slot, so the three per-day boxes became one.
    const spare = page.locator('#genSpareLines');
    await spare.fill('7');
    await spare.dispatchEvent('input');

    await page.reload();
    await expect(page.locator('#linksGridBodyRows tr')).toHaveCount(ROTATING_LINES);
    await page.locator('#generatorToggleHeader').click();
    await expect(page.locator('#genSpareLines')).toHaveValue('7');
});

// ── The stale remembered table (v21.05) ─────────────────────────────────────────────────────────
// The generator remembers each device's table and used to prefer that memory over the default
// forever. From v19.38 to v21.00 the default WAS the roster seed, so every older device kept
// showing July's table at 29h 53m while a fresh device showed the designed default at 35h 00m —
// which the owner read, reasonably, as "the new set doesn't average 35". A memory the app stored
// on its own is now superseded by content; a memory anybody EDITED is kept, with a note saying
// what it is.
const STALE_SEED_KEY = 'myb_links_gen_unsaved';
/** Exactly what buildRosterTargets() produced (and auto-stored) before v21.00 — July's table. */
const STALE_SEED = {
    slots: [
        { time: '06:20-13:35', weekday: 1, sat: 0, sun: 0 }, { time: '06:20-13:45', weekday: 1, sat: 0, sun: 0 },
        { time: '06:20-14:00', weekday: 0, sat: 1, sun: 0 }, { time: '06:20-14:20', weekday: 2, sat: 0, sun: 0 },
        { time: '06:20-14:50', weekday: 0, sat: 3, sun: 0 }, { time: '07:15-15:45', weekday: 0, sat: 0, sun: 3 },
        { time: '08:00-16:30', weekday: 2, sat: 0, sun: 0 }, { time: '08:30-16:30', weekday: 0, sat: 0, sun: 1 },
        { time: '11:00-19:30', weekday: 1, sat: 0, sun: 0 }, { time: '12:00-20:00', weekday: 0, sat: 1, sun: 0 },
        { time: '13:00-21:00', weekday: 0, sat: 0, sun: 1 }, { time: '13:30-21:00', weekday: 0, sat: 1, sun: 0 },
        { time: '13:30-22:00', weekday: 1, sat: 0, sun: 0 }, { time: '14:00-22:30', weekday: 2, sat: 0, sun: 0 },
        { time: '14:30-22:00', weekday: 0, sat: 2, sun: 0 }, { time: '14:30-23:25', weekday: 0, sat: 0, sun: 3 },
        { time: '14:45-23:55', weekday: 0, sat: 2, sun: 0 }, { time: '15:15-23:55', weekday: 2, sat: 0, sun: 0 },
    ],
    spareLines: 4,
};

async function openLinksWithMemory(page, remembered) {
    await page.setViewportSize({ width: 1280, height: 1200 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(([key, table]) => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {}; w.__E2E.docs = [];
        localStorage.setItem(key, JSON.stringify(table));
    }, [STALE_SEED_KEY, remembered]);
    await page.goto('/links.html');
    await page.waitForTimeout(700);
    await page.evaluate(() => { document.getElementById('generatorBody')?.classList.add('open'); });
}

test('links memory: a device holding an INTERMEDIATE default is retired by its version stamp', async ({ page }) => {
    // The route content comparison cannot cover, and the one the other two designers are on. Their
    // devices hold a default from v21.00–v21.05 — four defaults in as many days, none of them the
    // roster seed and none of them current — so a content check keeps every one of them. The stamp
    // says who wrote it and under which version, which settles it without a list of old tables.
    const stamped = JSON.parse(JSON.stringify(STALE_SEED));
    stamped.source = 'default';
    stamped.ver = '21.02';                       // any version that is not the running one
    await openLinksWithMemory(page, stamped);
    await expect(page.locator('#genHoursValue')).toHaveText('35h 00m each');
    await expect(page.locator('#genMemoryNote')).toBeHidden();
});

test('links memory: a stamped EDIT survives every version, which is the rule\'s one hard limit', async ({ page }) => {
    // The stamp must never become a licence to bin work. A table written under an ancient version
    // is kept for ever if it declares itself edited — that is the whole difference between the two
    // stamps, and it is the assertion that stops the widened rule eating somebody's tuning.
    const edited = JSON.parse(JSON.stringify(STALE_SEED));
    edited.source = 'edited';
    edited.ver = '19.38';
    await openLinksWithMemory(page, edited);
    await expect(page.locator('#genMemoryNote')).toBeVisible();
    await expect(page.locator('#genHoursNote')).toContainText('short in total');
});

test('links memory: a device still holding the OLD auto-seeded table gets the new default', async ({ page }) => {
    // The owner's exact state. Nobody wrote that table — the app stored it on its own — so it is
    // superseded by content, the memory is cleared, and the card reads 35h 00m like a fresh device.
    await openLinksWithMemory(page, STALE_SEED);
    await expect(page.locator('#genHoursValue')).toHaveText('35h 00m each');
    await expect(page.locator('#genHoursNote')).toContainText('on target');
    await expect(page.locator('#genMemoryNote')).toBeHidden();
});

test('links memory: a table somebody EDITED is kept, and the note says what it is', async ({ page }) => {
    // One touched count is the boundary: this is somebody's work, and the supersede rule must
    // never discard it — but a kept memory that differs from the default looks exactly like "the
    // new default is wrong", so the provenance note is what separates the two states.
    const edited = JSON.parse(JSON.stringify(STALE_SEED));
    edited.slots[0].weekday = 3;                                // one deliberate change
    await openLinksWithMemory(page, edited);
    await expect(page.locator('#genHoursNote')).toContainText('short in total');
    await expect(page.locator('#genMemoryNote')).toBeVisible();
    await expect(page.locator('#genMemoryNote')).toContainText('your device remembers');
    // Touching anything makes it the designer's table — the note stands down.
    const first = page.locator('.gen-slot-count').first();
    await first.fill('4');
    await first.dispatchEvent('input');
    await expect(page.locator('#genMemoryNote')).toBeHidden();
});

// ── Saved target sets (v21.04) ──────────────────────────────────────────────────────────────────
// The promise under test: others can load and change anyone's set, but overwriting belongs to its
// creator. The RULES enforce that server-side (firestore.rules.test.mjs covers it case for case);
// what only a browser can prove is the wiring — that the picker renders both owners' sets, that
// the Save button reflects whose set is selected, that Load actually reaches the table, and that
// Save-as-new writes a document owned as the signed-in designer.
const TARGET_SET_ROWS = [
    {
        id: 'ts-silva', name: 'Set A', createdBy: 'S. Silva', updatedBy: 'S. Silva',
        spareLines: 9,        // deliberately unlike the default's, so a successful Load is visible
        slots: [
            { time: '06:20-14:20', weekday: 2, sat: 1, sun: 0 },
            { time: '15:15-23:55', weekday: 1, sat: 1, sun: 0 },
        ],
        updatedAt: 1_750_000_000_000,
    },
    {
        id: 'ts-robson', name: 'Set B', createdBy: 'M. Robson', updatedBy: 'M. Robson',
        spareLines: 6,
        slots: [{ time: '07:00-15:20', weekday: 1, sat: 0, sun: 0 }],
        updatedAt: 1_750_000_000_000,
    },
];

// Signed in as M. ROBSON — a designer who is NOT the admin, deliberately. The first draft signed
// in as G. Miller and asserted Save was disabled on Silva's set… and it was enabled, correctly:
// G. Miller is the admin, and the admin can overwrite anyone's set (the same break-glass the
// design bin grants). An ownership feature has to be tested from a seat with no override.
async function openLinksWithTargetSets(page) {
    await page.setViewportSize({ width: 1024, height: 1000 });
    await seedSession(page, 'M. Robson');
    await page.addInitScript((rows) => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window);
        w.__E2E = w.__E2E || {};
        w.__E2E.docsByPath = { linkTargetSets: rows };   // designs read falls back to (unset) docs
    }, TARGET_SET_ROWS);
    await page.goto('/links.html');
    await page.waitForTimeout(700);
    await page.evaluate(() => { document.getElementById('generatorBody')?.classList.add('open'); });
}

test('links sets: the picker lists every designer\'s sets, and Save follows whose is selected', async ({ page }) => {
    await openLinksWithTargetSets(page);
    // Sorted by name: Set A (Silva) first, Set B (mine) second — attribution rendered with each.
    await expect(page.locator('#genSetSelect option')).toHaveCount(2);
    await expect(page.locator('#genSetSelect option').nth(0)).toHaveText('Set A — S. Silva');
    await expect(page.locator('#genSetSelect option').nth(1)).toHaveText('Set B — M. Robson');

    // Silva's set: Save disabled, and the hint says whose it is and what to do instead. The
    // disabled button is a courtesy (the rules are the protection) — but a button that LOOKS
    // enabled and then permission-denies would teach designers the feature is broken.
    await page.locator('#genSetSelect').selectOption('ts-silva');
    await expect(page.locator('#genSetSaveBtn')).toBeDisabled();
    await expect(page.locator('#genSetHint')).toContainText('saved by S. Silva');
    // …and says whose call it is. The advice about branching arrives when it is relevant — once the
    // set is loaded AND changed — rather than up front, over a table that is not hers yet (v21.08).
    await expect(page.locator('#genSetHint')).toContainText('Only they can overwrite it');

    // My own: Save offered.
    await page.locator('#genSetSelect').selectOption('ts-robson');
    await expect(page.locator('#genSetSaveBtn')).toBeEnabled();
    await expect(page.locator('#genSetHint')).toContainText('yours to change');
});

test('links sets: Load copies a colleague\'s set into the working table', async ({ page }) => {
    await openLinksWithTargetSets(page);
    await expect(page.locator('#genSpareLines')).toHaveValue('4');        // the shipped default
    await page.locator('#genSetSelect').selectOption('ts-silva');
    await page.locator('#genSetLoadBtn').click();
    await expect(page.locator('#genSpareLines')).toHaveValue('9');        // Silva's figure arrived
    await expect(page.locator('#genSlotRows tr')).toHaveCount(2);         // and her two rows
    // Loading is a COPY — the set itself is untouched, so nothing was written TO THE COLLECTION.
    // Filtered by path: the page's background analytics writes land in setWrites too, and counting
    // them made this assertion flake by timing (7 on one platform, 0 on the other).
    const writes = await page.evaluate(() => (/** @type {any} */ (window).__E2E.setWrites || [])
        .filter((/** @type {any} */ w) => String(w.path).includes('linkTargetSets')).length);
    expect(writes).toBe(0);
});

test('links sets: Save as new writes a set owned as the signed-in designer', async ({ page }) => {
    await openLinksWithTargetSets(page);
    await page.locator('#genSetSaveAsBtn').click();
    await page.locator('.dialog-input').fill('Weekend trial');
    await clickDialogConfirm(page);
    await expect.poll(() => page.evaluate(() =>
        (/** @type {any} */ (window).__E2E.setWrites || [])
            .filter((/** @type {any} */ w) => w.added && String(w.path).includes('linkTargetSets')).length
    )).toBe(1);
    const written = await page.evaluate(() =>
        (/** @type {any} */ (window).__E2E.setWrites || [])
            .find((/** @type {any} */ w) => w.added && String(w.path).includes('linkTargetSets')).data);
    expect(written.name).toBe('Weekend trial');
    expect(written.createdBy).toBe('M. Robson');    // ownership pinned to the writer — rules enforce it too
    expect(written.updatedBy).toBe('M. Robson');
    expect(Array.isArray(written.slots)).toBe(true);
    expect(written.spareLines).toBe(4);             // the untouched default table is what was saved
});

test('links sets: the admin is told the set is somebody else\'s, not that it is theirs', async ({ page }) => {
    // The v21.06 defect, and it needed the ADMIN'S seat to see: `canOverwriteTargetSet` answers
    // "may I write this?", the hint asked it and printed "yours to change. Others can load it but
    // not overwrite it" over a set S. Silva owns. Both halves wrong, and the second inverted — the
    // one person who CAN overwrite anyone's was being told nobody could overwrite theirs.
    await page.setViewportSize({ width: 1024, height: 1000 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript((rows) => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window);
        w.__E2E = w.__E2E || {};
        w.__E2E.docsByPath = { linkTargetSets: rows };
    }, TARGET_SET_ROWS);
    await page.goto('/links.html');
    await page.waitForTimeout(700);
    await page.evaluate(() => { document.getElementById('generatorBody')?.classList.add('open'); });

    await page.locator('#genSetSelect').selectOption('ts-silva');
    // Still writable — the admin override is real and the button must reflect it.
    await expect(page.locator('#genSetSaveBtn')).toBeEnabled();
    await expect(page.locator('#genSetHint')).toContainText('saved by S. Silva');
    await expect(page.locator('#genSetHint')).toContainText('as the admin');
    await expect(page.locator('#genSetHint')).not.toContainText('yours to change');
});

test('links generator: the hours row is the generator\'s OWN test, and follows a changed time', async ({ page }) => {
    // TWO defects in one row, both of which left the page stating something untrue about the one
    // question the card exists to answer.
    //
    //   1. The tick passed anything within half an hour, inherited from the Design-checks row where
    //      a tolerance is right. Here it is wrong: `generateLink` refuses on an EQUALITY, so a table
    //      a few minutes out wore a green "on target (35h)" and then met a red refusal.
    //   2. Changing a shift TIME did not recompute the row at all — only a changed COUNT did — so
    //      the figure sat at whatever it said before the edit. Stale, and green.
    await page.setViewportSize({ width: 1024, height: 1200 });
    await seedSession(page, 'G. Miller');
    await openLinks(page);
    await page.evaluate(() => { document.getElementById('generatorBody')?.classList.add('open'); });

    // The shipped default pays the contract exactly, so it starts on target.
    await expect(page.locator('#genHoursValue')).toHaveClass(/gen-hours-ok/);
    await expect(page.locator('#genHoursNote')).toContainText('on target');

    // Lengthen ONE duty and change nothing else. Under the old code this row did not move.
    const before = await page.locator('#genHoursValue').textContent();
    // The first row (a short early) becomes a closer — a real length change on a Mon–Fri row, so
    // the week moves by that difference five times over. Selected BY VALUE: a positional pick could
    // land on a duty of the same length and pass while proving nothing. The value has to be one the
    // CURRENT default proposes, or the option is absent and this fails as a timeout rather than as
    // an assertion (v21.10, when the table was retuned under it).
    await page.locator('#genSlotRows tr').first().locator('.gen-slot-time')
        .selectOption('15:45-23:55');
    await expect.poll(() => page.locator('#genHoursValue').textContent()).not.toBe(before);
    await expect(page.locator('#genHoursValue')).toHaveClass(/gen-hours-off/);
    // And it says what has to reach zero, in the unit that has to reach it.
    await expect(page.locator('#genHoursNote')).toContainText('in total');
    await expect(page.locator('#genHoursNote')).toContainText('Generate needs it exact');
});

test('links generator: a zero target recedes, and each day\'s block is separated', async ({ page }) => {
    // Two thirds of the cells in the default table are zeros. At full contrast in identical boxes
    // they compete with the numbers that mean something; dimmed, the shape of the table is legible.
    // Both are presentational, so only a browser can see them — and `is-zero` is toggled live on
    // typing, which is the part a static read of the render would miss.
    await page.setViewportSize({ width: 1024, height: 1200 });
    await seedSession(page, 'G. Miller');
    await openLinks(page);
    await page.evaluate(() => { document.getElementById('generatorBody')?.classList.add('open'); });

    const firstRow = page.locator('#genSlotRows tr').first();
    await expect(firstRow.locator('[data-class="weekday"]')).not.toHaveClass(/is-zero/);
    await expect(firstRow.locator('[data-class="sun"]')).toHaveClass(/is-zero/);

    // Typing a real target restores it immediately — no re-render, so no lost focus.
    await firstRow.locator('[data-class="sun"]').fill('2');
    await expect(firstRow.locator('[data-class="sun"]')).not.toHaveClass(/is-zero/);
    await firstRow.locator('[data-class="sun"]').fill('0');
    await expect(firstRow.locator('[data-class="sun"]')).toHaveClass(/is-zero/);

    // The default table is three blocks since v21.13 — the eleven turns Mon–Sat run alike, then
    // Saturday's own two, then Sunday's six — so it carries exactly two boundaries. The sizes are
    // the readable part: Saturday's block IS the whole of its difference from a weekday.
    await expect(page.locator('#genSlotRows tr.gen-slot-newblock')).toHaveCount(2);
});

test('links sets: a set can be deleted, and only by someone allowed to', async ({ page }) => {
    // The verb the feature shipped without (v21.08): `firestore.rules` has allowed the creator or
    // the admin to delete since v21.04, but nothing on the page could ask, so sets could only ever
    // accumulate. Driven as M. ROBSON — a designer with no override — because a delete button
    // tested from the admin's seat is enabled for everything and proves nothing about the rule.
    await openLinksWithTargetSets(page);
    const del = page.locator('#genSetDeleteBtn');

    await page.locator('#genSetSelect').selectOption('ts-silva');
    await expect(del).toBeDisabled();                      // Silva's — not mine to remove

    await page.locator('#genSetSelect').selectOption('ts-robson');
    await expect(del).toBeEnabled();
    await del.click();
    await clickDialogConfirm(page);

    // It left the collection, and it left the picker — the second is the part a designer sees.
    await expect.poll(() => page.evaluate(() =>
        (/** @type {any} */ (window).__E2E.deletedPaths || [])
            .filter((/** @type {string} */ p) => p.includes('linkTargetSets')).length)).toBe(1);
    await expect(page.locator('#genSetSelect option')).toHaveCount(1);
    await expect(page.locator('#genSetSelect option').nth(0)).toHaveText('Set A — S. Silva');
});

test('links sets: a set changed while the confirm sat open is not deleted', async ({ page }) => {
    // Consent names a VERSION, in the one Links surface that did not check (external review). The
    // set's other writer is the admin, and a confirm dialog is human think-time: the row the picker
    // is showing can be minutes old. A bare `deleteDoc` removes whatever is there NOW — including an
    // update made in that gap, which the person confirming never saw. There is no bin behind a set.
    await openLinksWithTargetSets(page);
    await page.locator('#genSetSelect').selectOption('ts-robson');

    // The SERVER moves on while the dialog is open: same set, newer revision.
    await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        w.__E2E.txDocs = (w.__E2E.docsByPath.linkTargetSets || []).map((/** @type {any} */ r) =>
            (r.id === 'ts-robson' ? { ...r, updatedAt: 1_760_000_000_000, updatedBy: 'G. Miller' } : r));
    });

    await page.locator('#genSetDeleteBtn').click();
    await clickDialogConfirm(page);

    await expect(page.locator('#genSetHint')).toContainText('changed by someone else');
    // The refusal is the assertion: nothing left the collection.
    expect(await page.evaluate(() => (/** @type {any} */ (window).__E2E.deletedPaths || [])
        .filter((/** @type {string} */ p) => p.includes('linkTargetSets')).length)).toBe(0);
});

test('links sets: the row says whether the table still matches the set', async ({ page }) => {
    // "Save changes" was a leap of faith before this: nothing said whether the table on screen WAS
    // the set, or your own work about to overwrite it. The state has to survive a single keystroke,
    // which is why it is asserted after an edit rather than only after a load.
    await openLinksWithTargetSets(page);
    await page.locator('#genSetSelect').selectOption('ts-robson');
    await expect(page.locator('#genSetHint')).toContainText('Press Load');

    await page.locator('#genSetLoadBtn').click();
    await expect(page.locator('#genSetHint')).toContainText('still matches it');

    await page.locator('#genSlotRows tr').first().locator('[data-class="weekday"]').fill('7');
    await expect(page.locator('#genSetHint')).toContainText('You have changed the table');
    await expect(page.locator('#genSetHint')).not.toContainText('still matches');
});

test('links sets: Load asks before it throws away a table you have changed', async ({ page }) => {
    // Designs have warned on every equivalent act since v16 — switching design, starting a new one,
    // signing out, closing the tab. The target table had no such guard and no undo, so a mis-tap on
    // Load (which sits right beside the dropdown) discarded an afternoon of tuning in silence.
    await openLinksWithTargetSets(page);
    const firstCount = page.locator('#genSlotRows tr').first().locator('[data-class="weekday"]');

    // Untouched table: no question asked — the common case stays one press.
    await page.locator('#genSetSelect').selectOption('ts-silva');
    await page.locator('#genSetLoadBtn').click();
    await expect(page.locator('#genSlotRows tr')).toHaveCount(2);

    // Now change it, and try to load the other set.
    await firstCount.fill('9');
    await page.locator('#genSetSelect').selectOption('ts-robson');
    await page.locator('#genSetLoadBtn').click();
    // Scoped by TEXT, not by class: the import lightbox carries a `.dialog-message` of its own, so a
    // bare class selector matches two elements and fails strict mode rather than the assertion.
    await expect(page.getByText('You have changed the table since loading it')).toBeVisible();
    await page.locator('.dialog-btn-cancel').click();
    await expect(firstCount).toHaveValue('9');                    // kept — cancel means cancel
    await expect(page.locator('#genSlotRows tr')).toHaveCount(2);

    // And confirming does replace it. Scoped to the OPEN overlay: a dismissed dialog's node is
    // removed 500ms after close, deliberately, so that it can fade — which means two `Replace`
    // buttons exist for half a second and a bare class selector picks neither.
    await page.locator('#genSetLoadBtn').click();
    await page.locator('.lb-overlay.open .dialog-btn-confirm').click();
    await expect(page.locator('#genSlotRows tr')).toHaveCount(1); // Robson's single-row set
});

test('links grid: each line carries its own totals, and they follow an edit', async ({ page }) => {
    // The maths is unit-tested (`lineTotals`); what only a browser answers is that the columns are
    // WIRED — that every row got its three cells, that the footer averages are the same figures the
    // rest of the page states, and that painting a cell moves the row it belongs to. That last one
    // is the fiddly path: the edit handler rewrites ONE row rather than re-rendering the tbody, so
    // a mistake there puts one line's hours against another line's cells and nothing looks broken.
    await page.setViewportSize({ width: 1280, height: 1000 });
    await seedSession(page, 'G. Miller');
    await openLinks(page);
    await page.evaluate(() => { document.getElementById('generatorBody')?.classList.add('open'); });
    await page.locator('#genApplyBtn').click();
    const ok = page.locator('.lb-overlay.open .dialog-btn-confirm');
    if (await ok.count()) await ok.first().click();
    await expect(page.locator('#linksGridBodyRows tr')).toHaveCount(ROTATING_LINES);

    // Three cells on every line, no exceptions — the renderer indexes rows by position, so a short
    // list would silently shift every total one line up.
    await expect(page.locator('#linksGridBodyRows .tot-cell')).toHaveCount(ROTATING_LINES * 3);

    const row1 = page.locator('#linksGridBodyRows tr').first();
    const before = await row1.locator('.tot-cell').first().textContent();

    // The footer average must be the SAME figure the summary strip states. Two places computing a
    // design's hours separately is how they end up disagreeing; the footer reads `weeklyHours`,
    // which is what the strip and the Design-checks row already read.
    const avg = await page.locator('#linksCoverageFoot .tot-avg-num').first().textContent();
    await expect(page.locator('#linksSummary')).toContainText(String(avg).trim());

    // Paint a rest day over line 1's Monday: its Mon–Sat total must fall.
    await clickInView(page.locator('#brushBar button', { hasText: 'RD' }).first());
    await clickInView(row1.locator('.shift-cell-btn').nth(1));
    await expect.poll(() => row1.locator('.tot-cell').first().textContent()).not.toBe(before);
});

test('links: the roster seed samples the whole MAIN cycle and nothing else', async ({ page }) => {
    // The seed has been wrong in both directions and the symptom was the same number either time.
    // v19.59: main's 20 weeks plus only the TWO bilingual weeks two bilingual members happen to sit
    // on — bilingual 1 and 8 are the SPARE ones and were never seen, so it read 4 against a then-true
    // 6. v19.98: the design excludes the bilingual roster entirely, so the MEASURED answer is main
    // 1/7/12/17 — 4 again, for a completely different reason. That coincidence is why the identity
    // and shift-time checks live in links-seed.test.mjs; this figure alone cannot tell them apart.
    //
    // FOUR, and the seed adds nothing to it. v20.01 briefly seeded five (`EXTRA_SPARE_WEEKS`) to
    // relieve an FF11 finding that turned out at v20.02 to be the line-order optimiser clustering the
    // cover weeks; cause fixed, uplift reverted (owner).
    //
    // Driven through the real "Load today's roster instead" button, because what only a browser can
    // prove is that the BUTTON reaches the seed and repaints the table.
    //
    // v21.00: the card no longer OPENS on the seed — it opens on the designed default. This walks
    // all three states so the two buttons are provably wired to two different tables; checking the
    // seed alone would pass just as happily if the default button were wired to the seed as well,
    // which is the mistake two buttons invite. The distinguishing signal is the ROW COUNT, not the
    // spare-week box: since v21.01 the default runs four cover weeks — the same figure the roster
    // measures — so the one number that used to tell the tables apart no longer can, while the row
    // counts cannot converge (the designed table carries Saturday and Sunday shapes of its own).
    await page.setViewportSize({ width: 390, height: 1000 });
    await seedSession(page, 'G. Miller');
    await openLinks(page);
    await page.locator('#generatorToggleHeader').click();
    await expect(page.locator('#genSpareLines')).toHaveValue('4');
    const defaultRows = await page.locator('#genSlotRows tr').count();   // the designed default
    await page.locator('#genSeedBtn').click();
    await expect(page.locator('#genSpareLines')).toHaveValue('4');       // today's roster measures 4 too
    const seedRows = await page.locator('#genSlotRows tr').count();
    expect(seedRows).toBeGreaterThan(0);
    expect(seedRows).not.toBe(defaultRows);                              // two buttons, two tables
    await page.locator('#genDefaultBtn').click();
    await expect(page.locator('#genSlotRows tr')).toHaveCount(defaultRows);   // and back
});

test('links: Generate works on a card nobody has touched', async ({ page }) => {
    // The whole reason the default changed (v21.00). The roster seed cannot pay a 24-line rotation,
    // and since v20.98 the generator refuses a table that misses the contracted week — so a designer
    // opening the workspace and pressing Generate met a refusal before typing anything.
    //
    // Asserted end to end rather than on the arithmetic, which links-default-targets.test.mjs
    // already pins: what only a browser answers is whether the table that reaches `generateLink` is
    // the one the module exports. Nothing else in the suite would notice — every other links spec
    // seeds its own targets first, precisely so it does not depend on what the default happens to be.
    await page.setViewportSize({ width: 1280, height: 1200 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {}; w.__E2E.docs = [];
    });
    await page.goto('/links.html');
    await page.waitForTimeout(700);
    await page.evaluate(() => { document.getElementById('generatorBody')?.classList.add('open'); });
    await page.locator('#genApplyBtn').click({ force: true });
    await clickDialogConfirm(page);
    await expect(page.locator('#genError')).toHaveText('');
    await expect(page.locator('#linksGridBodyRows tr')).toHaveCount(ROTATING_LINES);
    // And the design it built pays the contract — the summary chip is where a designer reads that.
    await expect(page.locator('#linksSummary')).toContainText('35h');
});

test('links: the rotation length the in-page fixtures assume', () => {
    // The fixtures above build their patterns inside `addInitScript`, where a module import is not
    // available, so they loop to a literal. Tie it to the constant here or the whole Links e2e set
    // silently changes what it is testing when the rotation moves: a fixture LONGER than the
    // rotation exercises the legacy-design path (surplus rows, the over-length notice) while every
    // assertion still passes, and a fixture SHORTER leaves undesigned rows that the "every line
    // filled" checks would then be wrong about.
    expect(ROTATING_LINES).toBe(24);
});

test('links: a design saved against a LONGER rotation says so', async ({ page }) => {
    // Every 28-line design saved before v19.98 is still in Firestore, and opening one looks entirely
    // normal: the grid loops to the rotation so lines 23-28 are simply not drawn, every panel reads
    // the same range, and the working copy deep-copies the whole patterns object so the next save
    // writes all 28 back. Assessed as one thing, stored as another, with no symptom.
    //
    // The data is deliberately left alone — trimming on load would destroy six lines of somebody's
    // work on a page visit — so the notice IS the whole mitigation. If it stops rendering there is
    // nothing else between a designer and a proposal that describes a link nobody is building.
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        /** @type {any} */ const pat = {};
        for (let i = 1; i <= 28; i++) pat[String(i)] = { sun: 'RD', mon: '06:20-14:20', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' };
        w.__E2E.docs = [{ id: 'd1', name: 'Old 28', patterns: pat, updatedAt: 1750000000000, updatedBy: 'S. Silva' }];
    });
    await page.goto('/links.html');

    const notice = page.locator('#linksOverLengthNotice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('28');
    await expect(notice).toContainText(String(ROTATING_LINES));
    // The grid still renders the CURRENT rotation — the notice explains the gap, it does not paper
    // over it by drawing rows the analysis does not count.
    await expect(page.locator('#linksGridBodyRows tr')).toHaveCount(ROTATING_LINES);
});

test('links: a design at the current length shows no such notice', async ({ page }) => {
    // The mirror image, and the one that matters more day to day: a permanently-visible caution on
    // every normal design would be read past within a week, which is the cry-wolf failure the
    // fatigue panel's own rules are written around.
    await seedSession(page, 'G. Miller');
    await openLinks(page);
    await expect(page.locator('#linksOverLengthNotice')).toBeHidden();
});

test('links: generating names the construction that produced the design', async ({ page }) => {
    // v20.98: the generator refuses targets that cannot pay the contracted week, and the
    // roster seed cannot at this rotation — so a spec that generates brings work with it.
    await seedContractTargets(page);
    // Two constructions live behind one button and they give visibly different designs — settled
    // weeks keep a line inside one wave, the fallback walks it across the whole day. A designer who
    // is not told which they got cannot account for the difference.
    await page.setViewportSize({ width: 900, height: 1000 });
    await seedSession(page, 'G. Miller');
    await openLinks(page);
    await page.locator('#generatorToggleHeader').click();
    await page.locator('#genApplyBtn').click();
    await clickDialogConfirm(page);
    await expect(page.locator('#linksSaveStatus')).toContainText(/settled weeks, \d+ waves?/);
});

// ── Pressing Generate again explores (v20.07) ────────────────────────────────────────────────────
// The reorder was flatly deterministic, so a second press returned the identical design and said
// nothing — the owner's report. The engine's attempt behaviour is unit-tested in
// links-adjacency.test.mjs; what only a real browser can prove is the WIRING: that the second press
// actually advances the counter (the fingerprint has to read the same inputs both times), and that
// the status line names the variant rather than repeating the first press's text. Without this, a
// broken fingerprint silently pins every press to attempt 0 — which is exactly the bug being fixed,
// wearing the new code.
test('links: pressing Generate again produces a different, named design', async ({ page }) => {
    // Since v20.98 the generator refuses targets that cannot pay the contracted week, and the
    // roster seed cannot at this rotation — see seedContractTargets.
    await seedContractTargets(page);
    await seedSession(page, 'G. Miller');
    await openLinks(page);
    await page.locator('#generatorToggleHeader').click();

    const gen = async () => {
        await page.locator('#genApplyBtn').click();
        const ok = page.locator('.dialog-btn-confirm');
        if (await ok.count()) await ok.first().click();
        await expect(page.locator('.dialog-overlay')).toHaveCount(0);
    };
    const gridText = () => page.evaluate(() =>
        /** @type {HTMLElement} */ (document.getElementById('linksGridBodyRows')).innerText);

    await gen();
    await expect(page.locator('#linksSaveStatus')).toContainText('Generate again');
    const first = await gridText();

    await gen();
    await expect(page.locator('#linksSaveStatus')).toContainText('Design 2');
    // The grid itself must change — a status line claiming "Design 2" over an identical grid is the
    // tool pretending to explore. (Attempt 1 differs from attempt 0 on the live seed; pinned by the
    // unit distinctness test, so this is not a flaky coincidence.)
    expect(await gridText()).not.toBe(first);
});

/**
 * Every served app page, for the two COMPUTED-STYLE sweeps below.
 *
 * Shared because both are cascade checks that a static test cannot make, and because this exact
 * list — written out twice, by hand — is what let `overtime.html` escape the 16px scan entirely.
 */
const APP_URLS = ['/', '/admin.html', '/paycalc.html', '/operations.html', '/settings.html',
    '/links.html', '/overtime.html'];

// ── Every page renders in the app's typeface (v20.63) ────────────────────────────────────────────
//
// `shared.css` declares the `@font-face` and the `--font-sans` token but applies neither: each
// page's own stylesheet sets its `body` font-family. `overtime.css` had no `body` rule at all, so
// that page rendered in Times New Roman — the content, the shared header, the badge and the nav
// drawer alike, since they all live in that document's body. It was reported as "the whole app has
// changed font", which from that page is exactly what it looks like.
//
// Nothing could have caught it. The typeface is not a token violation (no wrong value was used),
// not an accessibility failure, and not a behavioural one; it is an absence, and absence is what
// static CSS tests are worst at. So it is measured, in a browser, on every page.
test('every page renders in Inter, not a browser default', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => { localStorage.setItem('myb_links_welcome_seen', '1'); });
    /** @type {string[]} */
    const wrong = [];
    for (const url of APP_URLS) {
        await page.goto(url);
        // `body` carries it for the page; `h1` is checked too because the header is shared chrome —
        // if it ever stopped inheriting, every page's masthead would go serif at once.
        const seen = await page.evaluate(() => ({
            body: getComputedStyle(document.body).fontFamily,
            h1: document.querySelector('h1') ? getComputedStyle(document.querySelector('h1')).fontFamily : 'Inter',
        }));
        if (!/^Inter\b/.test(seen.body)) wrong.push(`${url} body → ${seen.body}`);
        if (!/^Inter\b/.test(seen.h1))   wrong.push(`${url} h1 → ${seen.h1}`);
    }
    expect(wrong, 'pages not rendering in the app typeface').toEqual([]);
});

// ── No focusable field may sit under 16px on a touch device (v19.61) ─────────────────────────────
// iOS force-zooms the page when you focus a field smaller than 16px, and the app has said "never go
// below 16px on a focusable field" in css-tokens.md since v11.77 — with NOTHING enforcing it.
//
// It had already failed twice. `links.css` carried a `@media (pointer: coarse)` block setting the
// generator's inputs to 16px, with the right comment about iOS, and it did nothing: the base rule is
// declared ~230 lines LATER at equal specificity, so source order handed the win to 13px. Its
// neighbour in that same block worked, purely because ITS base rule happened to sit earlier — and
// nothing in the code said so. `paycalc.css`'s paste textarea was 12px with no guard at all.
//
// A static CSS test could not catch either: both are cascade outcomes, not text. This measures the
// COMPUTED size on a real coarse-pointer device, which is the only thing that answers the question.
//
// IT RUNS ON WEBKIT TOO (v22.12). The rule exists because of iOS, and it was gated to mobile-chrome
// alone — so the guard for an iOS behaviour never once ran on the iOS engine, while mobile-safari sat
// in CI as a full job. Verified passing on both BEFORE the gate was widened, so this records a
// coverage gap rather than fixing a defect. The 24px tap-target test below stays mobile-chrome-only:
// it is WCAG 2.2 and engine-neutral, so it has no equivalent reason to cross.
test('no focusable field falls below 16px on a touch device @a11y', async ({ page }, info) => {
    test.skip(!['mobile-chrome','mobile-safari'].includes(info.project.name), 'needs a real coarse pointer');
    await page.setViewportSize({ width: 390, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => { localStorage.setItem('myb_links_welcome_seen', '1'); });

    for (const url of APP_URLS) {
        await page.goto(url);
        await page.waitForTimeout(700);
        // Open every collapsible, or the fields inside a closed card are never measured.
        await page.evaluate(() => document.querySelectorAll('.card-collapsible-body')
            .forEach(el => el.classList.add('open')));
        await page.waitForTimeout(250);
        const bad = await page.evaluate(async () => {
            // A member's name is DATA, not copy — see the header. Derived from the roster so it
            // follows a new starter instead of going stale.
            let names = new Set();
            try {
                const rd = await import('./roster-data.js');
                names = new Set((rd.teamMembers || []).map(/** @param {any} m */ m => m.name));
            } catch { /* page without the module graph — check every option */ }
            const out = [];
            document.querySelectorAll('input, select, textarea').forEach(el => {
                const t = /** @type {any} */ (el).type;
                // Checkboxes and radios carry no text; a file input opens the OS picker rather than a
                // keyboard, so none of them can trigger the focus zoom this guards.
                if (t === 'checkbox' || t === 'radio' || t === 'hidden' || t === 'file') return;
                const r = el.getBoundingClientRect();
                if (!r.width || !r.height) return;
                const fs = parseFloat(getComputedStyle(el).fontSize);
                if (fs < 16) out.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} = ${fs}px`);
            });
            return [...new Set(out)];
        });
        expect(bad, `${url} has fields that will zoom the page on iOS`).toEqual([]);
    }
});

// ── Every control has a tap target, and the DRAWN box is not it (v21.53) ────────────────────────
// The sibling of the sweep above, and found the same way: by measuring rather than reading.
//
// The app's collapse chevron — the way you open and close every card on five pages — had a real tap
// region of 6×15px. Its neighbour 5px away, the Tips `?`, has carried a 44px `::before` since it was
// written, so the pattern existed and one control simply never got it.
//
// This must probe with `elementFromPoint`, NOT `getBoundingClientRect`. A box measurement calls the
// `?` a 20px failure (it is not — the pseudo-element makes it 44) and would have sent someone off to
// "fix" a control that was already right, while an invisible expander is exactly what it cannot see.
// Probing outward from the centre reports what a thumb actually finds.
//
// 24px is WCAG 2.2 SC 2.5.8 (Target Size Minimum, AA). Genuinely inline links inside a sentence are
// exempt under that rule and are excluded here; a standalone control in an empty state is not one.
test('no control has a tap target under 24px @a11y', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile-chrome', 'a thumb, not a mouse');
    await page.setViewportSize({ width: 390, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => { localStorage.setItem('myb_links_welcome_seen', '1'); });

    for (const url of APP_URLS) {
        await page.goto(url);
        await page.waitForTimeout(700);
        await page.evaluate(() => document.querySelectorAll('.card-collapsible-body')
            .forEach(el => el.classList.add('open')));
        await page.waitForTimeout(250);
        const bad = await page.evaluate(() => {
            const reach = (el, dx, dy) => {
                const r = el.getBoundingClientRect();
                const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
                let n = 0;
                for (let i = 1; i <= 26; i++) {
                    const x = cx + dx * i, y = cy + dy * i;
                    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) break;
                    const hit = document.elementFromPoint(x, y);
                    if (!hit || (hit !== el && !el.contains(hit))) break;
                    n = i;
                }
                return n;
            };
            const out = [];
            document.querySelectorAll('button, select, [role=button]').forEach(el => {
                const r = el.getBoundingClientRect();
                if (!r.width || !r.height) return;
                if (getComputedStyle(el).visibility === 'hidden') return;
                // Must be fully on screen to probe outward from, or the walk stops at the edge and
                // reports a false failure for a control that is merely scrolled out of view.
                if (r.top < 26 || r.top > innerHeight - 26) return;
                const w = reach(el, -1, 0) + reach(el, 1, 0) + 1;
                const h = reach(el, 0, -1) + reach(el, 0, 1) + 1;
                if (w < 24 || h < 24) {
                    out.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} = ${w}x${h}`);
                }
            });
            return [...new Set(out)];
        });
        expect(bad, `${url} has controls too small to tap reliably`).toEqual([]);
    }
});

// ── The generator's numeric clauses stay in one piece on a phone (v19.65) ───────────────────────
// Two of the five line-order objectives carry an inline number — "at most [3] weeks", "at least [4]
// of 28". They were three loose flex children in a ~190px column, and on a COARSE pointer the box is
// 56×40 (the iOS-zoom + touch-target floor, which is not negotiable), so the row overflowed by ~8px
// and wrapped: "at most" on one line, then "[3]" and "weeks the same" — the tail landing flush under
// the lead-in, where it read as a separate statement rather than the end of the sentence. That is
// what the staff screenshot showed.
//
// This belongs on mobile-chrome and NOWHERE ELSE. The visual suite is a single fine-pointer project
// where the same box is 52×28 and the clause fits regardless — measured: deleting the fix leaves
// every visual test green. A screenshot could not police it anyway, since re-baselining just records
// whatever it wrapped to.
test('links: a numeric objective clause does not come apart on a phone', async ({ page }, info) => {
    test.skip(!['mobile-chrome','mobile-safari'].includes(info.project.name), 'needs a real coarse pointer');
    // 360, not the suite's usual 390 — that is the reported device (1080px at DPR 3), and it is the
    // 30px that decided this. The clause fits at 390 and fragments at 360.
    await page.setViewportSize({ width: 360, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => { localStorage.setItem('myb_links_welcome_seen', '1'); });
    await page.goto('/links.html');
    await page.evaluate(() => document.getElementById('generatorBody')?.classList.add('open'));
    await page.waitForTimeout(250);

    // Measured on the RENDERED RESULT, not on the mechanism that produces it. The obvious version of
    // this test — "the `.gen-obj-numctl` wrapper is no taller than its own input" — is dead code:
    // the wrapper is an `inline-flex` inside a `flex-wrap: wrap` parent, so the parent always wraps
    // ahead of it and the group can never come apart while it exists. Measured at 390, 360 and 300,
    // with the long copy and with the grouping disabled: green every time. It would only ever have
    // caught the wrapper being DELETED, and it would have reported that as a count mismatch.
    //
    // So compare the two things the bug actually separated: the number box, and the words after it.
    // Same line ⇒ one phrase. Different lines ⇒ the tail is orphaned under the lead-in, which is the
    // reported render. This holds whatever the fix is implemented with.
    const clause = await page.evaluate(() => [...document.querySelectorAll('.gen-obj-num input')].map((input) => {
        // The next thing that RENDERS — skipping comments, which occupy no space but do occupy
        // `nextSibling`. A markup comment placed between the input and its tail made this probe
        // measure an empty range and report the clause as broken when it was not (v19.98).
        let after = input.nextSibling;
        while (after && after.nodeType === Node.COMMENT_NODE) after = after.nextSibling;
        const r = document.createRange();
        r.selectNodeContents(/** @type {Node} */ (after));
        return { input: input.getBoundingClientRect(), tail: r.getBoundingClientRect(), text: after?.textContent };
    }));
    // THREE since v20.02 (the run cap joined variety and long weekends). Asserted as a count rather
    // than a floor so that adding a fourth numeric objective lands HERE — the loop below is the only
    // thing checking that a number and the words qualifying it stay on one line at 360px, and a new
    // one arriving unchecked is exactly how the v19.65 fragmentation shipped.
    expect(clause.length, 'every numeric objective clause must be measured').toBe(3);
    for (const c of clause) {
        expect(c.text?.trim(), 'the number is followed by the words it qualifies').toBeTruthy();
        // Vertical centres within half a line of each other = the same line.
        const gap = Math.abs((c.tail.top + c.tail.bottom) / 2 - (c.input.top + c.input.bottom) / 2);
        expect(gap, `"${c.text?.trim()}" must sit beside its number, not on the line below`)
            .toBeLessThan(10);
    }
});

// ── The grid keeps its day headers from 768px up (v19.77) ───────────────────────────────────────
// The wrapper is `overflow-x: auto` below its breakpoint so the 592px table can scroll inside a
// narrow card — but `overflow-x: auto` makes it a SCROLL CONTAINER whether or not anything
// overflows, and `position: sticky` resolves against the nearest one. With the breakpoint at 1024
// the header was therefore inert from 768 to 1023 while scrolling NOTHING: measured, the content
// fits its box at 768 (684/684), 834 (720/720) and 1000 (876/876).
//
// That band is iPad portrait, which is the device this workspace's own first-visit notice
// recommends — so it is worth a test rather than a comment. Neither project's default viewport
// lands in it, which is exactly why nothing caught it.
test('links: the grid day-headers stick from 768px up, where the table already fits', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        /** @type {any} */ const pat = {};
        for (let i = 1; i <= 24; i++) {
            pat[String(i)] = { sun: 'RD', mon: '06:20-14:20', tue: '06:20-14:20', wed: '06:20-14:20',
                thu: '06:20-14:20', fri: '06:20-14:20', sat: 'RD' };
        }
        w.__E2E.docs = [{ id: 'd1', name: 'A', patterns: pat, updatedAt: 1750000000000, updatedBy: 'S. Silva' }];
    });

    for (const width of [768, 834, 1024]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/links.html');
        await expect(page.locator('#linksGridBodyRows tr')).toHaveCount(ROTATING_LINES);
        const m = await page.evaluate(() => {
            const wrap = /** @type {Element} */ (document.querySelector('.links-grid-wrapper'));
            const th = /** @type {Element} */ (document.querySelector('.links-grid thead th'));
            const before = th.getBoundingClientRect().top;
            window.scrollTo(0, 400);
            const after = th.getBoundingClientRect().top;
            window.scrollTo(0, 0);
            return {
                overflowX: getComputedStyle(wrap).overflowX,
                fits: wrap.scrollWidth <= wrap.clientWidth + 1,
                movedWithPage: Math.abs((before - after) - 400) < 5,
            };
        });
        // The premise: at these widths there is nothing to scroll horizontally, so making the
        // wrapper a scroll container buys nothing and costs the header.
        expect(m.fits, `at ${width}px the table should already fit its wrapper`).toBe(true);
        expect(m.overflowX, `at ${width}px the wrapper must not be a scroll container`).toBe('visible');
        expect(m.movedWithPage, `at ${width}px the day header must STICK, not scroll away`).toBe(false);
    }
});

// ── Opening a card in code must move the chevron and the ARIA with it (v19.70) ──────────────────
// `initCardCollapse` only syncs `aria-expanded` on a real click, so anything that opens a card
// programmatically has to do it by hand. `renderGrid`'s auto-expand did; the v19.66 empty-state
// button did not — it added `.open` to the body and left the chevron pointing collapsed with
// `aria-expanded="false"` over an open card.
//
// It stayed invisible because on the default path `renderGrid` has usually opened the generator
// already, so the button's own open is a no-op. You only see it by COLLAPSING the card first,
// which is what this test does. Both sites now share `_openGenerator`.
test('links: the empty-state button opens the generator with its chevron and ARIA in step', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {}; w.__E2E.docs = [];
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/links.html');
    await expect(page.locator('#linksEmptyGenerate')).toBeVisible();

    // Collapse it by hand — the state in which the button's own open actually does something.
    await page.locator('#generatorChevron').click();
    await expect(page.locator('#generatorBody')).not.toHaveClass(/open/);

    await page.locator('#linksEmptyGenerate').click();
    await expect(page.locator('#generatorBody')).toHaveClass(/open/);
    // The two that drifted. A body open behind a collapsed chevron is a visual contradiction; the
    // ARIA is the half a sighted reviewer would never catch.
    await expect(page.locator('#generatorChevron')).toHaveClass(/open/);
    await expect(page.locator('#generatorChevron')).toHaveAttribute('aria-expanded', 'true');
});

// ── The generator card has ONE left edge on desktop (v19.67) ─────────────────────────────────────
// v19.66 centred `.generator-form` to split the 440px of dead space beside it, and left the intro
// prose where it was — so the card ended up with TWO left edges: the intro ran 122→778 while the
// table, objectives, action links and Generate button all ran 310→970. Nearly the same WIDTH
// (656 vs 660), 188px apart, which reads as a mistake rather than as hierarchy.
//
// A screenshot would not police this reliably: the baseline is a whole-card capture, and a
// re-baseline records whatever the alignment happens to be. Measuring the left edges does.
test('links: the generator card lines up on one left edge at desktop width', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile-chrome', 'the shared column only applies at >=1024px');
    // v20.98: the generator refuses targets that cannot pay the contracted week, and the
    // roster seed cannot at this rotation — so a spec that generates brings work with it.
    await seedContractTargets(page);
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => { localStorage.setItem('myb_links_welcome_seen', '1'); });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/links.html');
    await page.evaluate(() => document.getElementById('generatorBody')?.classList.add('open'));
    await page.waitForTimeout(250);

    const edges = await page.evaluate(() => {
        /** @type {Record<string, number>} */
        const out = {};
        for (const [name, sel] of [
            ['intro', '#generatorCard .links-desc'], ['table', '.gen-slot-table'],
            ['objectives', '.gen-objectives'], ['actions', '.gen-actions'], ['generate', '#genApplyBtn'],
        ]) {
            const el = document.querySelector(sel);
            if (el) out[name] = Math.round(el.getBoundingClientRect().left);
        }
        return out;
    });
    const names = Object.keys(edges);
    expect(names.length, 'every part of the generator must be measurable').toBe(5);
    const [first, ...rest] = names;
    for (const n of rest) {
        expect(Math.abs(edges[n] - edges[first]),
            `"${n}" starts at ${edges[n]} but "${first}" starts at ${edges[first]} — the card has two left edges`)
            .toBeLessThanOrEqual(1);
    }
});

// ── A sticky header is only sticky against the right scroll container (v19.66) ───────────────────
// The generator's `thead th` carries `position: sticky`, and at ≥768px it works: the wrapper is
// `overflow-x: visible`, so the sticky offset is the page. Below 768px the wrapper sets
// `overflow-x: auto` to scroll the 443px table inside a 306px card — and per spec, when one
// overflow axis is not `visible` the other computes to `auto`. So the wrapper becomes a vertical
// scroll container as tall as its own content, and the header sticks to a box that never scrolls
// vertically. It reads as correct in the stylesheet and does nothing.
//
// This test does not demand it work on mobile — that needs a `max-height` and a nested scrollbox
// around the primary creation path, which is a UX decision nobody has taken. It pins the two facts
// that make the situation legible, so the boundary cannot be claimed away: the declaration is
// there, and the mobile wrapper really is a scroll container in BOTH axes. If someone later makes
// it work on a phone, the second assertion is what will fail and send them to the note in
// links.css rather than letting them assume it had been working all along.
test('links: the generator header is sticky on desktop, and provably not on mobile', async ({ page }, info) => {
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => { localStorage.setItem('myb_links_welcome_seen', '1'); });
    await page.setViewportSize(info.project.name === 'mobile-chrome' ? { width: 390, height: 844 } : { width: 1280, height: 900 });
    await page.goto('/links.html');
    await page.evaluate(() => document.getElementById('generatorBody')?.classList.add('open'));
    await page.waitForTimeout(250);

    const m = await page.evaluate(() => {
        const wrap = /** @type {Element} */ (document.querySelector('.gen-slot-table-wrap'));
        const th = /** @type {Element} */ (document.querySelector('.gen-slot-table thead th'));
        const w = getComputedStyle(wrap);
        return { pos: getComputedStyle(th).position, ox: w.overflowX, oy: w.overflowY };
    });
    expect(m.pos, 'the sticky declaration must be present at every width').toBe('sticky');

    if (info.project.name === 'mobile-chrome') {
        // The wrapper scrolls horizontally, which forces the vertical axis too — this is WHY the
        // header cannot stick to the page here.
        expect(m.ox, 'the narrow wrapper scrolls the table horizontally').toBe('auto');
        expect(m.oy, 'and so becomes a vertical scroll container — the reason sticky is inert here').toBe('auto');
    } else {
        // Not a scroll container ⇒ the sticky offset is the page ⇒ the header actually sticks.
        expect(m.ox, 'at >=768px the wrapper must not be a scroll container, or sticky breaks').toBe('visible');
    }
});

test('links: the print button prints, and a work-in-progress sheet says so', async ({ page }) => {
    // The print CSS and the beforeprint/afterprint machinery have existed since v12.37; until v19.62
    // the only way to reach them was the browser menu, which an installed PWA often does not expose.
    //
    // The half worth testing hardest is the MASTHEAD. It states provenance ("Last saved by X") from
    // the SAVED Firestore doc, while the grid prints the LIVE in-memory patterns — so printing with
    // unsaved edits produced a sheet showing your changes under somebody else's name. That sheet
    // goes to the assessing manager.
    await page.setViewportSize({ width: 1280, height: 1000 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        /** @type {any} */ const pat = {};
        for (let i = 1; i <= 24; i++) {
            pat[String(i)] = { sun: 'RD', mon: '06:20-14:20', tue: '06:20-14:20', wed: 'RD',
                thu: '15:15-23:55', fri: '15:15-23:55', sat: 'RD' };
        }
        w.__E2E.docs = [{ id: 'd1', name: 'Option A', patterns: pat, updatedAt: 1750000000000, updatedBy: 'S. Silva' }];
        // A real print dialog would hang headless Chromium. Stub it, but still fire `beforeprint` —
        // the masthead stamp and the open-every-`details` handler hang off that event, so a stub
        // that skipped it would test the button and none of the behaviour behind it.
        w.__printed = 0;
        window.print = () => { w.__printed++; window.dispatchEvent(new Event('beforeprint')); };
    });
    await page.goto('/links.html');
    await expect(page.locator('#linksGridBodyRows tr')).toHaveCount(ROTATING_LINES);

    const btn = page.locator('#linksPrintBtn');
    await expect(btn).toBeVisible();
    await btn.click();
    expect(await page.evaluate(() => /** @type {any} */ (window).__printed)).toBe(1);

    const clean = await page.locator('#printDesignName').innerText();
    expect(clean).toContain('Last saved by S. Silva');
    expect(clean, 'a saved design must not claim unsaved changes').not.toContain('unsaved changes');

    // Now dirty the design and print again.
    await page.locator('tr[data-pos="1"] .shift-cell-btn').first().click();
    await page.locator('.shift-cell-select').selectOption({ index: 2 });
    await btn.click();
    expect(await page.locator('#printDesignName').innerText(),
        'a sheet printed mid-edit must say so, or it misattributes the design')
        .toContain('includes unsaved changes');

    // The button is chrome, not content — it must not appear on the paper, and the grid must still
    // fit the one sheet the whole print layout is built around (718px printable, A4 landscape).
    await page.emulateMedia({ media: 'print' });
    const printed = await page.evaluate(() => ({
        row: getComputedStyle(/** @type {any} */ (document.getElementById('linksSaveRow'))).display,
        gridH: Math.round(/** @type {any} */ (document.getElementById('linksGridCard')).getBoundingClientRect().height),
    }));
    expect(printed.row).toBe('none');
    expect(printed.gridH, 'the 28-line rotation must stay on ONE sheet').toBeLessThanOrEqual(718);
});

test('links: the variety switch is what keeps you off one shift type for months', async ({ page }) => {
    // v20.98: the generator refuses targets that cannot pay the contracted week, and the
    // roster seed cannot at this rotation — so a spec that generates brings work with it.
    await seedContractTargets(page);
    // v19.59 settled each week and then laid the shift waves out in contiguous blocks, so moving one
    // line a week gave 11 straight weeks of mornings and 11 of afternoons — "a bit excessive and
    // would be unpopular" (owner). `gentle` made it worse rather than better, because the smallest
    // possible week-to-week step is no step at all: minimising it IS a block.
    //
    // The maths is unit-tested; what only a browser can prove is that the checkbox reaches
    // `reorderLines`. Read from the status line, which reports the before→after either way.
    await page.setViewportSize({ width: 1280, height: 1400 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {}; w.__E2E.docs = [];
    });
    await page.goto('/links.html');
    // No designs seeded, so the grid is empty until the first generate — wait on the generator.
    await expect(page.locator('#genApplyBtn')).toBeAttached();
    await page.evaluate(() => { document.getElementById('generatorBody')?.classList.add('open'); });

    const blockAfter = async () => {
        await page.locator('#genApplyBtn').click({ force: true });
        const ok = page.locator('.dialog-btn-confirm');
        if (await ok.count()) await ok.first().click();
        const txt = await page.locator('#linksSaveStatus').innerText();
        const m = txt.match(/longest block (\d+)→(\d+) weeks/);
        if (!m) throw new Error(`status did not report the block: ${txt}`);
        return { before: Number(m[1]), after: Number(m[2]) };
    };

    const on = await blockAfter();
    expect(on.before, 'the raw generated design blocks badly — that is what the switch is for')
        .toBeGreaterThan(on.after);
    expect(on.after, 'with variety on, no longer than the live roster runs').toBeLessThanOrEqual(3);

    await page.locator('#objVariety').uncheck();
    const off = await blockAfter();
    expect(off.after, `variety off should block worse than ${on.after}`).toBeGreaterThan(on.after);
});

test('links: a target table stored BEFORE the spare-week change is still read', async ({ page }) => {
    // The reload test above can only ever exercise the shape the CURRENT code writes, so it cannot
    // see a stored blob written by an older version — and that is precisely how this broke: v19.58
    // started writing `spareLines` while the validator still demanded the per-day `spare` object,
    // so every remembered table was rejected in favour of the roster seed. Silently: the fallback
    // is a plausible-looking table, nothing throws, and the designer just finds their tuning gone.
    // The migration reads the LARGEST of the three days — 5 here, not weekday's 2 — because that is
    // the day that needed the most cover, so no capacity is lost in the move.
    await page.setViewportSize({ width: 390, height: 1000 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        // Keyed on the design that `openLinks` makes active — targets are remembered per design.
        localStorage.setItem('myb_links_gen_d1', JSON.stringify({
            slots: [{ time: '06:20-14:20', weekday: 6, sat: 4, sun: 3 }],
            spare: { weekday: 2, sat: 5, sun: 1 },
        }));
    });
    await openLinks(page);
    await page.locator('#generatorToggleHeader').click();
    await expect(page.locator('#genSpareLines')).toHaveValue('5');
    await expect(page.locator('#genSlotRows tr')).toHaveCount(1);
});

// ── Escape closes only the TOPMOST overlay (v19.53) ───────────────────────────────────────────
// Every open overlay attaches its own document-level keydown listener, so one Escape used to close
// them all. With two one-time NOTICES up that meant a single keypress archived and permanently
// flagged the one buried underneath, for someone who never saw it.
//
// ── "REMOVE FOR GOOD" MUST NOT DESTROY A DESIGN SOMEBODY RESTORED (v19.87) ──────────────────────
// The last item on the external review's missing-test list. v19.84 made the manual purge
// transactional, and the rules now require `deletedAt` for a hard delete — but both of those are
// the SERVER half. Nothing exercised the client path: transaction sees the design is live, throws
// `design-restored`, the bin says so, and nothing is deleted. Deleting the `isDeleted` check from
// the transaction leaves every rules test green, because those assert what the RULES permit and
// this design is legitimately deletable the moment its `deletedAt` is written.
//
// The race, staged exactly as it happens: A opened the bin (so A's `docs` show "Old idea" deleted),
// B restored it in the meantime (so the server view, `txDocs`, has no `deletedAt`), and A presses
// the button on a row that is now stale.
test('links: Remove for good spares a design another designer has restored', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        /** @type {any} */ const pat = {};
        for (let i = 1; i <= 24; i++) pat[String(i)] = { sun: 'RD', mon: '06:20-14:20', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' };
        const base = { patterns: pat, updatedAt: 1750000000000, updatedBy: 'S. Silva' };
        // What THIS device loaded when the bin was opened.
        w.__E2E.docs = [
            { id: 'live', name: 'Option A', ...base },
            { id: 'gone', name: 'Old idea', ...base, deletedAt: Date.now() - 2 * 86400000, deletedBy: 'S. Silva' },
        ];
        // What the server actually holds now: M. Robson restored it — no deletedAt at all.
        w.__E2E.txDocs = [
            { id: 'live', name: 'Option A', ...base },
            { id: 'gone', name: 'Old idea', ...base, updatedBy: 'M. Robson' },
        ];
    });
    await page.goto('/links.html');
    await expect(page.locator('#linksGridBodyRows tr')).toHaveCount(ROTATING_LINES);
    await page.locator('#designBinBtn').click();
    await page.locator('#designBinList button:has-text("Remove for good")').first().click();
    await page.locator('.lb-overlay.visible .dialog-btn-confirm').last().click();

    // It says what actually happened — not "couldn't remove", which would invite a retry against a
    // design somebody deliberately rescued.
    await expect(page.locator('#designBinStatus')).toContainText(/restored by someone else/i);

    const deletes = await page.evaluate(() => /** @type {any} */ (window).__E2E.deletedPaths || []);
    expect(deletes, 'a restored design must survive a stale Remove for good').toEqual([]);
});

// This drives a REAL nested pair — the Recently-deleted bin with its "Remove for good" confirm on
// top — because `overlay-history.test.mjs` tests the RULE (`_isTopOverlay`) and cannot see the
// wiring: deleting the guard from `onKey` leaves every one of those unit tests green and only this
// test red. Teeth-verified exactly that way.
test('links: Escape closes the confirm on top, not the bin underneath it', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        /** @type {any} */ const pat = {};
        for (let i = 1; i <= 24; i++) pat[String(i)] = { sun: 'RD', mon: '06:20-14:20', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' };
        w.__E2E.docs = [
            { id: 'live', name: 'Option A', patterns: pat, updatedAt: 1750000000000, updatedBy: 'S. Silva' },
            // Deleted RECENTLY — a 30-day-old deletion is purged on load and the bin button never appears.
            { id: 'gone', name: 'Old idea', patterns: pat, updatedAt: 1750000000000, updatedBy: 'S. Silva',
              deletedAt: Date.now() - 2 * 86400000, deletedBy: 'S. Silva' },
        ];
    });
    await page.goto('/links.html');
    await expect(page.locator('#linksGridBodyRows tr')).toHaveCount(ROTATING_LINES);
    await page.locator('#designBinBtn').click();
    await expect(page.locator('#designBinLightbox.visible')).toBeVisible();
    await page.locator('#designBinList button:has-text("Remove for good")').first().click();
    await expect(page.locator('.lb-overlay.visible')).toHaveCount(2);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => ({
        bin: !!document.querySelector('#designBinLightbox.visible'),
        open: document.querySelectorAll('.lb-overlay.visible').length,
        locked: document.body.classList.contains('lb-open'),
    }));
    expect(after.open, 'one Escape closes one overlay').toBe(1);
    expect(after.bin, 'the bin must survive an Escape aimed at the confirm above it').toBe(true);
    expect(after.locked, 'scroll stays locked while the bin is still open').toBe(true);
});

// ── The staffed operating window (v19.54, LINKS_DEC2026_PLAN package 1) ───────────────────────
// The heat map used to derive its own span from the design — first worked hour to last — and
// flagged a gap only strictly BETWEEN them. So missing cover at either END of the day was
// invisible: the span shrank to fit and those hours left the table. These drive the real page
// against a design where everybody finishes at 14:20 while the station stays open to 23:55.
const WINDOW_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
function morningOnlyPatterns() {
    /** @type {any} */ const p = {};
    for (let i = 1; i <= 24; i++) {
        p[String(i)] = {};
        WINDOW_DAYS.forEach(d => { p[String(i)][d] = d === 'sun' ? 'RD' : '06:20-14:20'; });
    }
    return p;
}
async function openWindowDesign(page, extraDocs = []) {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(([patterns, extra]) => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.docs = [{ id: 'd1', name: 'Morning heavy', patterns, updatedAt: 1750000000000, updatedBy: 'S. Silva' }, ...extra];
    }, [morningOnlyPatterns(), extraDocs]);
    await page.goto('/links.html');
    await expect(page.locator('#linksGridBodyRows tr')).toHaveCount(ROTATING_LINES);
}

test('links window: an unstaffed evening is flagged, where the old span hid it', async ({ page }) => {
    await openWindowDesign(page);
    // Every hour from 15:00 to 23:00, six days — open, nobody on. Previously ZERO gaps rendered.
    await expect(page.locator('.cov-heat-cell.heat-gap').first()).toBeVisible();
    const gaps = await page.locator('.cov-heat-cell.heat-gap').count();
    expect(gaps, 'the evening the station is open and unstaffed must be flagged').toBeGreaterThan(50);
    await expect(page.locator('#winMonSatStart')).toHaveValue('06:20');
    await expect(page.locator('#winMonSatEnd')).toHaveValue('23:55');
    // Sunday opens at 07:15, so its 06:00 column is CLOSED, not a hole.
    expect(await page.locator('.cov-heat-cell.heat-closed').count()).toBeGreaterThan(0);
});

test('links window: editing it changes the gaps and marks the design dirty', async ({ page }) => {
    await openWindowDesign(page);
    const before = await page.locator('.cov-heat-cell.heat-gap').count();
    await page.locator('#winMonSatEnd').fill('14:20');
    await page.locator('#winMonSatEnd').dispatchEvent('change');
    await expect.poll(() => page.locator('.cov-heat-cell.heat-gap').count()).toBeLessThan(before);
    // The window is part of the PROPOSAL, not a view preference — it must save with everything else.
    await expect(page.locator('#linksSaveBtn')).toBeEnabled();
});

test('links window: an invalid finish is refused, never coerced', async ({ page }) => {
    await openWindowDesign(page);
    await page.locator('#winMonSatEnd').fill('05:00');            // before the 06:20 start
    await page.locator('#winMonSatEnd').dispatchEvent('change');
    // Coercing would hand the designer a window they did not choose and then print it as theirs.
    await expect(page.locator('#winMonSatEnd')).toHaveValue('23:55');
    await expect(page.locator('#winStatus')).toContainText('after its start');
});

test('links window: compare states BOTH windows and flags that they differ', async ({ page }) => {
    // Compare diffs CELLS, so without this two designs built to different spans would read as like
    // for like — the per-design window becoming a way to make an unfair comparison look fair.
    await openWindowDesign(page, [{
        id: 'b', name: 'Later Sunday', patterns: morningOnlyPatterns(), updatedAt: 1750000000000, updatedBy: 'S. Silva',
        window: { monSat: { start: '06:20', end: '23:55' }, sun: { start: '07:15', end: '23:55' } },
    }]);
    await page.locator('button:has-text("Compare")').first().click();
    await expect(page.locator('.compare-window').first()).toBeVisible();
    // Order-agnostic: designs sort by NAME, so which one lands in column A is not this test's
    // business — that BOTH windows are stated, and that the difference is called out, is.
    const heads = await page.locator('#compareHeadA, #compareHeadB').allTextContents();
    const joined = heads.join(' | ');
    expect(joined, 'the standard Sunday finish must be stated').toContain('Sun 07:15–23:25');
    expect(joined, 'the moved Sunday finish must be stated').toContain('Sun 07:15–23:55');
    expect(await page.locator('.compare-window--differs').count()).toBe(2);
});

test('links: the summary strip names WHICH design it describes, but only in compare mode', async ({ page }) => {
    // Every figure in the strip comes from the ACTIVE design. With two grids on screen an
    // unlabelled "24 lines designed · All service covered · N fatigue factors" reads as a verdict on
    // the COMPARISON, which is the one thing it is not.
    //
    // Both halves are asserted, and the second is the one that keeps this honest: labelling the
    // ordinary single-design view too would be noise, and a chip that is always there says nothing.
    await openWindowDesign(page, [{
        id: 'b', name: 'Later Sunday', patterns: morningOnlyPatterns(),
        updatedAt: 1750000000000, updatedBy: 'S. Silva',
    }]);

    const who = page.locator('#linksSummary .sum-chip--who');
    await expect(who, 'the ordinary view names no design — there is only one on screen').toHaveCount(0);

    await page.locator('button:has-text("Compare")').first().click();
    await expect(page.locator('.compare-window').first()).toBeVisible();
    await expect(who).toHaveCount(1);
    // It must name the ACTIVE design, not just any of them — a chip carrying the wrong name is
    // worse than no chip, because it attributes the figures to the design they do not describe.
    const active = (await page.locator('.design-chip--active').first().textContent() || '').trim();
    expect(active.length, 'no active design chip to compare against').toBeGreaterThan(0);
    expect(active).toContain((await who.textContent() || '').trim());
});

test('links window: the printed sheet states the window it was designed to', async ({ page }) => {
    // A circulated sheet is read away from the app; without this a proposal built to a moved
    // Sunday finish is indistinguishable from one built to the standard hours.
    await openWindowDesign(page);
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('#printDesignName')).toContainText('Staffed window: Mon–Sat 06:20–23:55');
});

test('links window: a RESTORED design keeps the window it was designed to', async ({ page }) => {
    // The bin carried patterns but not the window, so a restore handed back a design wearing the
    // app default — and the next save would have written that default straight over the moved
    // boundary the design was actually built to. Same class as the v19.41 restore bugs.
    await openWindowDesign(page, [{
        id: 'gone', name: 'Binned early start', patterns: morningOnlyPatterns(),
        updatedAt: 1750000000000, updatedBy: 'S. Silva',
        deletedAt: Date.now() - 2 * 86400000, deletedBy: 'S. Silva',
        window: { monSat: { start: '05:00', end: '23:55' }, sun: { start: '07:15', end: '23:55' } },
    }]);
    await page.locator('#designBinBtn').click();
    await expect(page.locator('#designBinLightbox.visible')).toBeVisible();
    await page.locator('#designBinList button:has-text("Restore")').first().click();
    await page.locator('#designBinClose').click();
    await page.locator('.design-chip-name:has-text("Binned early start")').click();
    await expect(page.locator('#winMonSatStart')).toHaveValue('05:00');
    await expect(page.locator('#winMoved')).toBeVisible();
});

// ── The generate feedback is visible from the BUTTON, and the button stays put (v20.54) ──────────
// Two measured failures, one press. The status line lives in the grid card's sticky save row, a
// full card above the Generate button — after a real press-and-confirm it sat 448px above the
// viewport at 1280×900 and 569px at 390×844, so the whole v20.07 explore-loop voice (design
// numbering, best-so-far, how to get a variant back) was invisible from the one place it is read;
// `aria-live` meant screen readers were the only audience actually getting it. And on the FIRST
// generate the grid card above grows ~1,500px, inserting content ABOVE the scroll position — the
// viewport kept its scrollY and stranded the presser in the middle of an unexplained grid, button
// and feedback both off-screen. This drives the real flow at a realistic viewport height and
// asserts both: the mirror is on screen, and the button has not moved out from under the finger.
test('links generator: pressing Generate leaves the button under your finger and the result beside it', async ({ page }) => {
    // Since v20.98 the generator refuses targets that cannot pay the contracted week, and the
    // roster seed cannot at this rotation — see seedContractTargets.
    await seedContractTargets(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {}; w.__E2E.docs = [];
    });
    await page.goto('/links.html');
    await page.waitForTimeout(700);
    await page.evaluate(() => { document.getElementById('generatorBody')?.classList.add('open'); });
    await page.locator('#genApplyBtn').scrollIntoViewIfNeeded();

    const before = await page.evaluate(() =>
        Math.round(/** @type {HTMLElement} */ (document.getElementById('genApplyBtn')).getBoundingClientRect().top));
    await page.locator('#genApplyBtn').click();
    await clickDialogConfirm(page);

    // The button did not move — the first-generate reflow (empty state → 24-row grid above this
    // card) is compensated, so pressing again to explore needs no re-scroll.
    //
    // POLLED, NOT SAMPLED AT A FIXED DELAY (v21.34). This was `waitForTimeout(700)` followed by one
    // measurement, which raced the app's own sequence rather than waiting for it: the confirm
    // dialog holds `body.lb-open` until its transitionend (500ms fallback), and only then does the
    // re-anchor loop start scrolling. 700ms is enough on an idle machine and not on a loaded CI
    // runner — it failed there on both WebKit projects at once, reporting 944px and 1109px, i.e.
    // "the re-anchor had not run yet". The assertion is unchanged; it now waits for the property
    // instead of guessing when it will hold, and still fails if the app never re-anchors.
    await expect.poll(async () => page.evaluate((b) =>
        Math.abs(Math.round(/** @type {HTMLElement} */ (document.getElementById('genApplyBtn')).getBoundingClientRect().top) - b), before
    ), { message: 'the Generate button must stay where it was pressed', timeout: 10_000 })
        .toBeLessThanOrEqual(2);

    // The mirror carries the SAME text as the canonical status, and it is actually on screen.
    const status = await page.locator('#linksSaveStatus').textContent();
    await expect(page.locator('#genStatus')).toHaveText(status ?? '');
    expect((status ?? '').length, 'premise: the status has content to mirror').toBeGreaterThan(20);
    const inView = await page.evaluate(() => {
        const r = /** @type {HTMLElement} */ (document.getElementById('genStatus')).getBoundingClientRect();
        return r.bottom > 0 && r.top < innerHeight && r.height > 0;
    });
    expect(inView, 'the feedback must be visible from where the pressing happens').toBe(true);

    // A failed press clears the mirror — a stale success line under a fresh red error would read
    // as describing the press that just failed.
    await page.evaluate(() => {
        const first = /** @type {HTMLInputElement|null} */ (document.querySelector('#genSlotRows .gen-slot-count'));
        if (first) { first.value = '99'; first.dispatchEvent(new Event('input', { bubbles: true })); }
    });
    await page.locator('#genApplyBtn').click();
    await expect(page.locator('#genError')).not.toHaveText('');
    await expect(page.locator('#genStatus')).toBeHidden();
});

test('links window: generating the FIRST design reveals the window editor', async ({ page }) => {
    // v20.98: the generator refuses targets that cannot pay the contracted week, and the
    // roster seed cannot at this rotation — so a spec that generates brings work with it. FOUR
    // spare weeks, not the helper's default five, because the assertion at the bottom is about the
    // seeded figure surviving to the grid — and it can only assert that if the spec chose it.
    await seedContractTargets(page, { spareLines: 4 });
    // The generator is the only way to create a design. It refreshes the heat map through
    // renderGrid, but the editor was a separate call it did not make — so a designer's very first
    // link had no visible window control until they reloaded. Both now go through one function.
    await page.setViewportSize({ width: 1280, height: 1200 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {}; w.__E2E.docs = [];
    });
    await page.goto('/links.html');
    await page.waitForTimeout(700);
    await expect(page.locator('#windowEditor')).toBeHidden();      // no design yet
    await page.evaluate(() => { document.getElementById('generatorBody')?.classList.add('open'); });
    await page.locator('#genApplyBtn').click({ force: true });
    await clickDialogConfirm(page);
    await expect(page.locator('#windowEditor')).toBeVisible();
    // The sticky summary is the third thing this one call has to refresh (v19.57). "The generator
    // forgot to refresh X" has now been a bug twice — the window editor at v19.55, and this would
    // have been the same shape — so every artefact `renderCoverageCard` owns is pinned here rather
    // than trusted to a reviewer noticing the call site grew a third responsibility.
    await expect(page.locator('#linksSummary .sum-chip')).toHaveCount(4);   // 4 since v20.04 (hours a week)
    await expect(page.locator('.cov-demand')).toBeVisible();

    // SPARE IS A WHOLE WEEK (v19.58, owner). A spare line is spare on all seven days — you are cover,
    // you work four days of it, and you can be put on any range of shifts. The previous per-day model
    // produced the right daily SP HEADCOUNT while scattering those days across different people,
    // which is a shape the real roster has never had; the correct total is exactly why it went
    // unnoticed. Asserted on the rendered grid, because that is where the distribution is visible.
    const spareDays = await page.evaluate(() => [...document.querySelectorAll('#linksGridBodyRows tr')]
        .map(r => [...r.querySelectorAll('.shift-cell-btn')].filter(b => b.textContent.trim() === 'SP').length));
    expect(spareDays.every(n => n === 0 || n === 7),
        `every line is spare all week or not at all — got ${spareDays.join(',')}`).toBe(true);
    // FOUR — the figure this spec's own targets asked for, above. Line IDENTITY and the exclusion
    // of bilingual-only shift times belong to the roster seed and are pinned in links-seed.test.mjs
    // rather than here. What THIS assertion is for is the DISTRIBUTION above — that the count
    // survives the whole targets → generate → render path with every spare line still WHOLE, which
    // is the v19.58 per-day model's failure and is invisible to a unit test of the seed.
    expect(spareDays.filter(n => n === 7).length,
        'the seeded spare weeks must survive to the rendered grid').toBe(4);
});

// ── THE "USABLE" MILESTONE ACTUALLY FIRES (v21.71) ───────────────────────────────────────────────
//
// page-contract-parity asserts every coordinator CALLS markPageReady and imports it. That is a
// static check, and a call sitting in a branch nothing reaches would satisfy it while recording
// nothing — which is precisely the state paycalc and settings were in before v21.71 (no call at
// all), and the reason the App Speed card's "usable" figure covered five pages while reading as
// though it covered seven.
//
// NOTE for anyone extending this: do NOT add `page.clock.setFixedTime` here. Playwright's clock
// stub suppresses `performance.mark`, so the marks list comes back empty and this test fails on a
// perfectly working app — measured while writing it.
for (const [pageFile, ready] of [['paycalc.html', '#periodSelect'], ['settings.html', 'h2']]) {
    test(`${pageFile} stamps the page-usable mark at run time`, async ({ page }) => {
        await seedSession(page);
        await seedMember(page);
        await page.goto('/' + pageFile);
        await expect(page.locator(ready).first()).toBeVisible();
        await expect.poll(
            () => page.evaluate(() => performance.getEntriesByName('myb-page-ready').length),
            { message: `${pageFile} never stamped myb-page-ready — App Speed "usable" is blind here` },
        ).toBeGreaterThan(0);
    });
}

// ── Needs attention strip (v22.03) ───────────────────────────────────────────────────────────
// The unit suite owns the arithmetic; these cover what only a browser can — that the REAL card
// loads feed the strip (a severed report call leaves every unit test green), that clean means
// ABSENT, and that an item genuinely opens the card it names.
//
// The reset rows ride the fixtures' per-path seam (getResetRequests is a plain collection read);
// the client errors ride the shared e2e.docs (getClientErrors is query-wrapped, and the stub
// serves queries from the shared array — both of its queries see the same rows, so an exact
// on-screen error count is the stub's artefact, not the app's: assert presence, not arithmetic).

test('operations: a clean page has NO attention strip — absence is the all-clear', async ({ page }) => {
    await seedSession(page);
    await page.goto('/operations.html');
    await expect(page.locator('#accountStatusCard')).toBeVisible();
    await expect(page.locator('#attentionStrip')).toBeHidden();
});

test('operations: outstanding resets and errors surface in the strip, and an item opens its card', async ({ page }) => {
    await seedSession(page);
    await page.addInitScript(() => {
        window.__E2E = Object.assign(window.__E2E || {}, {
            docsByPath: { resetRequests: [
                { id: 'S. Silva', memberName: 'S. Silva', requestedAt: Date.now() - 3600e3, count: 2, provisioned: true },
                { id: 'M. Robson', memberName: 'M. Robson', requestedAt: Date.now() - 60e3, count: 1, provisioned: true },
            ] },
            docs: [
                { id: 'err1', memberName: 'G. Miller', page: 'admin.html', message: 'boom', stack: '', appVersion: 'x', userAgent: 'ua', timestamp: Date.now(), resolved: false },
            ],
        });
    });
    await page.goto('/operations.html');
    const strip = page.locator('#attentionStrip');
    await expect(strip).toBeVisible();
    await expect(strip).toContainText('Needs attention');
    // The full sentence is the ACCESSIBLE NAME; the visible pill is the card-header echo.
    await expect(strip.getByRole('link', { name: '2 password resets waiting' })).toBeVisible();
    await expect(strip.locator('a[href="#reset-requests"] .attn-count')).toHaveText('2');
    await expect(strip.getByRole('link', { name: /unresolved error/ })).toBeVisible();

    // The jump: the error-log card is collapsed by default; the strip item must open it.
    await expect(page.locator('#errorLogBody')).not.toHaveClass(/open/);
    await page.locator('#attentionStrip a[href="#error-log"]').click();
    await expect(page.locator('#errorLogBody')).toHaveClass(/open/);
    // …and a REPEAT tap after the admin closes the card still works (same hash, no hashchange).
    await page.locator('#errorLogToggleHeader').click();
    await expect(page.locator('#errorLogBody')).not.toHaveClass(/open/);
    await page.locator('#attentionStrip a[href="#error-log"]').click();
    await expect(page.locator('#errorLogBody')).toHaveClass(/open/);
});

test('operations: resets alone show one item, and the strip never renders a zero', async ({ page }) => {
    await seedSession(page);
    await page.addInitScript(() => {
        window.__E2E = Object.assign(window.__E2E || {}, {
            docsByPath: { resetRequests: [
                { id: 'S. Silva', memberName: 'S. Silva', requestedAt: Date.now(), count: 1, provisioned: true },
            ] },
        });
    });
    await page.goto('/operations.html');
    const strip = page.locator('#attentionStrip');
    await expect(strip).toBeVisible();
    await expect(strip.getByRole('link', { name: '1 password reset waiting' })).toBeVisible();
    await expect(strip.locator('a[href="#error-log"]')).toHaveCount(0);
});

test('operations: no account-status name is truncated at phone width', async ({ page }) => {
    /*
     * The NAME is what identifies a row on a 51-row list, and at 375px it was the element being
     * cut — "C. Francisco-C…", "R. Forrester-Bla…", "L. Atrakimavici…" — while a chip reading the
     * same fifteen characters ("Surname default") on every unmigrated row kept its full width
     * (v21.72). Truncating the one unique thing to make room for the one identical thing is
     * exactly backwards, and no behavioural test could see it: every assertion about this card
     * passed throughout, because the DOM text was always complete. Only the pixels were wrong.
     *
     * `scrollWidth > clientWidth` is the ellipsis itself, asked of the real rendered row.
     */
    await page.setViewportSize({ width: 375, height: 2000 });
    await seedSession(page);
    await seedMember(page);
    await page.goto('/operations.html');
    await expect(page.locator('#accountStatusCard')).toBeVisible({ timeout: 10000 });
    await page.evaluate(() => /** @type {HTMLElement|null} */ (
        document.querySelector('#accountStatusCard .card-header-toggle'))?.click());
    await expect(page.locator('.acct-name').first()).toBeVisible();
    const clipped = await page.evaluate(() => [...document.querySelectorAll('.acct-name')]
        .filter(el => el.scrollWidth > el.clientWidth + 1)
        .map(el => el.textContent));
    expect(clipped, 'account names clipped at 375px — the row cannot be identified').toEqual([]);
});

/**
 * THE PAGE BADGE SHORTENS ON A PHONE, AND THE POINT IS PROPORTION, NOT OVERFLOW.
 *
 * v22.23 spelled this badge "Operations" in full on every width. Nothing overflowed, nothing
 * collided, and no test failed — which is precisely why it shipped: the check that was run asked
 * whether it FITS. It does. Measured on a phone it rendered 104px against a 126px "Marylebone
 * Roster", so the section label was 83% the width of the app's own name and read as loud as it,
 * which is what the owner reported from a real handset.
 *
 * So this asserts the CONTRACT (which form renders on which side of the 768px desktop-header line)
 * rather than a ratio threshold, because a threshold is a number nobody can defend. The ratio is
 * recorded in the failure message instead, so a regression says how bad it got.
 */
test('operations: the page badge is short on a phone and full on desktop, and never crowds the title', async ({ page }) => {
    const read = async (w) => {
        await page.setViewportSize({ width: w, height: 800 });
        await seedSession(page, 'G. Miller');
        await page.goto('/operations.html');
        await page.locator('#opsBadge').waitFor({ state: 'visible' });
        return page.evaluate(() => {
            const badge = document.getElementById('opsBadge');
            const h1 = document.querySelector('.app-header-brand h1');
            const hdr = document.querySelector('.app-header');
            const bb = badge.getBoundingClientRect(), tb = h1.getBoundingClientRect(), hb = hdr.getBoundingClientRect();
            return {
                text: badge.innerText.replace(/\s+/g, ' ').trim(),
                bw: Math.round(bb.width), tw: Math.round(tb.width),
                over: Math.round(bb.right) > Math.round(hb.right) + 1,
                coll: Math.round(tb.right) > Math.round(bb.left),
                doc: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            };
        });
    };

    // Below the 768px desktop-header line: the short form, and it must stay a modest fraction of
    // the title. 0.42 measured; 0.6 is the line at which it starts reading as a competing heading.
    for (const w of [320, 360, 390, 412, 767]) {
        const r = await read(w);
        expect(r.text, `@${w}px the badge should read "Ops", not the full word`).toMatch(/^🔧\s*OPS$/i);
        expect(r.over || r.coll || r.doc, `@${w}px the header overflowed or collided`).toBe(false);
        expect(r.bw / r.tw, `@${w}px badge ${r.bw}px vs title ${r.tw}px — it is crowding the app name`).toBeLessThan(0.6);
    }

    // At and above it there is room to spare, and the full word is clearer.
    for (const w of [768, 1280]) {
        const r = await read(w);
        expect(r.text, `@${w}px the badge should read "Operations" in full`).toMatch(/^🔧\s*OPERATIONS$/i);
        expect(r.over || r.coll || r.doc, `@${w}px the header overflowed or collided`).toBe(false);
    }
});

test('operations: no App Speed row label is truncated at phone width', async ({ page }) => {
    /*
     * The same fault as the account-status one above, on the card that had just gained a block.
     * Found by SCREENSHOTTING it (v22.00) rather than by any assertion: two rows read "From the
     * save…" and "Pay calcul…" at 390px, and one of them was the label naming the whole distinction
     * the new block exists to draw. Every behavioural test passed throughout, because the DOM text
     * was complete and only the pixels were wrong — which is exactly what the account-status guard
     * says about its own defect, so the card that learned the lesson was not the card that needed it.
     *
     * Both label kinds are checked. `.speed-row-name` is deliberately the ellipsising element (the
     * "(few)" marker beside it must never be the part that goes), so measuring it is measuring the
     * thing that can actually be lost.
     */
    // SEEDED, because an empty card is not a passing truncation test — it is no test. The fixture is
    // the visual baseline's own, shared through helpers.js so the guard and the picture cannot end
    // up describing two different cards.
    await stubPerfReads(page);
    await page.setViewportSize({ width: 390, height: 2400 });
    await seedSession(page);
    await seedMember(page);
    await page.goto('/operations.html');
    await expect(page.locator('#pageSpeedCard')).toBeVisible({ timeout: 10000 });
    await page.evaluate(() => {
        const b = document.getElementById('pageSpeedBody');
        if (b && !b.classList.contains('open')) document.getElementById('pageSpeedToggleHeader')?.click();
    });
    await expect(page.locator('#pageSpeedCard')).toContainText('What put the shifts on screen');
    const names = page.locator('#pageSpeedCard .speed-row-name');
    expect(await names.count(), 'the fixture did not reach the card — nothing is being measured')
        .toBeGreaterThan(8);
    const clipped = await page.evaluate(() => [...document.querySelectorAll('#pageSpeedCard .speed-row-name')]
        .filter(el => el.scrollWidth > el.clientWidth + 1)
        .map(el => el.textContent));
    expect(clipped, 'App Speed labels clipped at 390px — the row cannot be read').toEqual([]);
});

test('no select option is cut off at 360px', async ({ page }) => {
    /*
     * A NATIVE SELECT TRUNCATES SILENTLY, AND THE USUAL PROBE CANNOT SEE IT.
     *
     * Reported from a staff screenshot (v22.10): the student-loan cutover control read
     * "No — still deducted from my pays" on a 360px phone. The source says "…from my payslip" —
     * the option was being cut mid-word into something that still reads as words, so it looked
     * like deliberate (if ungrammatical) copy rather than a rendering fault.
     *
     * The two truncation guards above ask `scrollWidth > clientWidth`, which IS the ellipsis on an
     * ordinary element. Measured on this select while the bug was live: scrollWidth 304,
     * clientWidth 304, naive check says "not clipped" — because the option text is painted by the
     * control, not laid out as overflowing content. So the shape that catches a clipped table cell
     * is structurally blind here, and this needs its own probe: render the option's text in a span
     * at the control's own font and compare against its usable width.
     *
     * 360, not the suite's usual 390 — that is the reported device (1080px at DPR 3), and it is
     * the 30px that decided this one: the offending label needed 276px, which fits the 294px a
     * 390px phone gives and not the 264px a 360px phone does. The same 30px decided the links
     * objective-clause bug above.
     *
     * Deliberately NOT gated to one project, and font metrics differ per engine — which is the
     * whole point. It found a second offender on mobile-chrome that desktop Chromium could not see
     * (the links generator's `Custom time…`, clipped only because the coarse-pointer rule correctly
     * raises that select to 16px to stop iOS zooming), and a third on WebKit alone.
     *
     * IT CHECKS COPY, NOT DATA. That third one is `#fieldMember` on admin showing
     * "R. Forrester-Blackstock" — the longest name on the roster — over by TWO pixels in WebKit and
     * fitting in Chromium. A person's name cannot be shortened, and `.member-context-bar select`
     * shrinks on purpose (see the comment on its `min-width: 0`), so the only fixes would be to
     * redesign the bar or to shave a gap to satisfy a test — and the next long surname breaks it
     * again either way. So option text that IS a member name is skipped, and the skip is derived
     * from `teamMembers` rather than an id allowlist: a hand-kept list of "selects full of names"
     * is the thing that goes stale, whereas this follows the roster. What remains covered is every
     * label the app AUTHORS, which is where both real defects were.
     */
    await page.setViewportSize({ width: 360, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
        localStorage.setItem('myb_links_welcome_seen', '1');
    });
    const offenders = [];
    for (const url of APP_URLS) {
        await page.goto(url);
        await page.waitForTimeout(1100);
        await page.evaluate(() => {
            document.querySelectorAll('.card-collapsible-body').forEach(el => el.classList.add('open'));
            // Pick a loan plan — the real user action that reveals the cutover select.
            const sl = /** @type {HTMLSelectElement|null} */ (document.getElementById('studentLoan'));
            if (sl) { sl.value = 'plan2'; sl.dispatchEvent(new Event('change', { bubbles: true })); }
        });
        await page.waitForTimeout(400);
        const bad = await page.evaluate(async () => {
            // A member's name is DATA, not copy — see the header. Derived from the roster so it
            // follows a new starter instead of going stale.
            let names = new Set();
            try {
                const rd = await import('./roster-data.js');
                names = new Set((rd.teamMembers || []).map(/** @param {any} m */ m => m.name));
            } catch { /* page without the module graph — check every option */ }
            const out = [];
            document.querySelectorAll('select').forEach(el => {
                const box = el.getBoundingClientRect();
                if (!box.width || /** @type {HTMLElement} */ (el).offsetParent === null) return;
                const cs = getComputedStyle(el);
                const usable = box.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
                const probe = document.createElement('span');
                probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${cs.font};letter-spacing:${cs.letterSpacing}`;
                document.body.appendChild(probe);
                for (const o of el.options) {
                    const label = (o.textContent || '').trim();
                    if (names.has(label)) continue;   // a person's name, not authored copy
                    probe.textContent = o.textContent;
                    // 1px of tolerance for sub-pixel text measurement, nothing more.
                    if (probe.getBoundingClientRect().width > usable + 1) {
                        out.push(`${el.id || '(no id)'}: "${label}"`);
                    }
                }
                probe.remove();
            });
            return out;
        });
        offenders.push(...bad.map(b => `${url} → ${b}`));
    }
    expect(offenders, 'select options cut off at 360px — a native select cuts mid-word, silently').toEqual([]);
});


// ── ADMIN WEEK SWIPE ────────────────────────────────────────────────────────────────────────────
//
// Written BEFORE extracting the gesture into its own module (v21.89), because it had no
// behavioural coverage at all: 165 lines of pointer capture, transitions and timers driving a
// navigation staff use daily on a phone, and nothing that would notice if a refactor broke it.
//
// It is also the one surface with a documented history of being broken by a plausible change —
// CLAUDE.md carries two standing rules about it (Pointer Events not Touch Events; pointer capture
// on the grid, not the clip) — so "read it carefully" is exactly the assurance that has failed
// here before.
//
// The drag is a real pointer sequence rather than a synthetic event: the whole mechanism is the
// lazy capture that only starts once horizontal intent is confirmed, and dispatching a single
// event skips the thing under test.
async function dragWeek(page, dir) {
    // WAIT FOR THE PREVIOUS GESTURE TO SETTLE FIRST. A commit sets a cooldown that is released
    // only when the carousel animation finishes, so a second drag issued the moment the DATE
    // changes is correctly ignored — the date is written before the animation, deliberately, so
    // the label cannot lag the grid. The first version of this test dragged straight back and
    // read that as a broken swipe; it is the double-commit guard doing its job.
    //
    // The observable end of the gesture is the carousel panels being torn down in `restore()`.
    await page.waitForFunction(
        () => document.querySelectorAll('.week-carousel-panel').length === 0,
        null, { timeout: 5000 });
    // SCROLL IT INTO VIEW FIRST, then take a y inside BOTH the grid and the viewport. The grid is
    // 559px tall and starts 594px down a 727px-tall phone viewport, so its midpoint is off-screen —
    // `page.mouse` works in viewport coordinates, so the original midpoint drag was dispatched below
    // the window and hit nothing. It passed on desktop only because that layout happens to fit.
    await page.locator('#weekGrid').scrollIntoViewIfNeeded();
    const box = await page.locator('#weekGrid').boundingBox();
    const vh  = page.viewportSize().height;
    const top = Math.max(box.y, 0);
    const bot = Math.min(box.y + box.height, vh);
    const y   = (top + bot) / 2;
    expect(y, 'the drag must start inside the viewport').toBeGreaterThan(0);
    expect(y, 'the drag must start inside the viewport').toBeLessThan(vh);
    // Start well clear of the left edge — the handler deliberately ignores the first 24px so it
    // does not fight the iOS system back-swipe.
    const [from, to] = dir === 'next'
        ? [box.x + box.width - 30, box.x + 40]
        : [box.x + 40, box.x + box.width - 30];
    await page.mouse.move(from, y);
    await page.mouse.down();
    // Enough steps to clear the intent threshold and register velocity; a single jump reads as a
    // tap with a large delta and is correctly ignored.
    await page.mouse.move(to, y, { steps: 14 });
    await page.mouse.up();
}

test('admin: swiping the week grid moves a week, in both directions', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });

    const dateField = page.locator('#fieldDate');
    const start = await dateField.inputValue();
    expect(start, 'the grid should open on a week').toBeTruthy();

    await dragWeek(page, 'next');
    await expect
        .poll(() => dateField.inputValue(), { timeout: 5000 })
        .not.toBe(start);
    const forward = await dateField.inputValue();
    // Exactly one week, not two: the carousel commits a single panel per gesture, and a
    // double-commit is the failure a cooldown exists to prevent.
    expect(Math.round((Date.parse(forward) - Date.parse(start)) / 86400000)).toBe(7);

    await dragWeek(page, 'prev');
    await expect.poll(() => dateField.inputValue(), { timeout: 5000 }).toBe(start);
});

test('admin: the week label follows the swipe, so the grid and its heading agree', async ({ page }) => {
    // The label is written on COMMIT, before the animation, precisely so it cannot lag the grid.
    // A heading naming one week above a grid showing another is the misreading this prevents.
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });

    const label = page.locator('#weekNavLabel');
    const before = await label.textContent();
    await dragWeek(page, 'next');
    await expect.poll(() => label.textContent(), { timeout: 5000 }).not.toBe(before);

    // And it agrees with the date field, which is the state everything else reads.
    //
    // AGREEMENT MEANS THE SAME WEEK, NOT THE SAME DAY. The label names the week's two BOUNDARY days
    // (Sunday–Saturday, `updateWeekNavLabel`), while `#fieldDate` holds a day INSIDE that week — so
    // asserting the label contains the field's own day-of-month is true only on the 2 days in 7
    // where they coincide. The first version of this test did exactly that, passed on the day it
    // was written, and failed the next morning against unchanged code.
    //
    // Derive the boundaries here and assert both. This checks the property the test is named for
    // without re-implementing the formatter's month-collapsing rule, which is the label's business.
    const iso = await page.locator('#fieldDate').inputValue();
    const inWeek = new Date(iso + 'T00:00:00');
    const sunday = new Date(inWeek);
    sunday.setDate(inWeek.getDate() - inWeek.getDay());
    const saturday = new Date(sunday);
    saturday.setDate(sunday.getDate() + 6);

    const text = await label.textContent();
    expect(text, `the heading should name the week containing ${iso}`)
        .toContain(String(sunday.getDate()));
    expect(text, `the heading should name the week containing ${iso}`)
        .toContain(String(saturday.getDate()));
});

test('admin: the week arrows and the swipe move the same state', async ({ page }) => {
    // The buttons live inside the gesture's own closure so they share its cooldown. Extracting the
    // gesture must not leave them wired to a different notion of "which week".
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });

    const dateField = page.locator('#fieldDate');
    const start = await dateField.inputValue();
    await page.locator('#nextWeekBtn').click();
    await expect.poll(() => dateField.inputValue(), { timeout: 5000 }).not.toBe(start);
    const afterBtn = await dateField.inputValue();

    await dragWeek(page, 'prev');
    await expect.poll(() => dateField.inputValue(), { timeout: 5000 }).toBe(start);
    expect(Math.round((Date.parse(afterBtn) - Date.parse(start)) / 86400000)).toBe(7);
});


// ── A SHIFTED READ IS REFUSED, IN A REAL BROWSER (v22.16, external review) ─────────────────────
//
// The rules are unit-tested in admin-roster-upload.test.mjs. What only a browser can answer is
// whether the WIRING holds: that the refusal reaches the screen, that the Save button stops
// offering to save, and — the one that matters — that pressing it writes NOTHING. The batch mock
// records every `set()` payload (`window.__E2E.batchWrites`), so this asserts on what was actually
// written rather than on a summary line claiming a count. Those are two separate passes over the
// same state, and asserting the counter alone has no teeth: that lesson is already recorded in
// this file for the roster review picker.
test('operations: a roster read that looks a day out is refused, and writes nothing', async ({ page }) => {
    // The fixture is built from the REAL detector against the REAL roster, not hard-coded names
    // that go stale the next time somebody joins. That is possible because the alignment rules left
    // the coordinator at v22.16 — `roster-alignment.js` imports no Firebase, so it loads in Node,
    // where `admin-roster-upload.js` cannot (it reaches the gstatic SDK).
    const { teamMembers, getBaseShift } = await import('../roster-data.js');
    const { detectShiftedRow } = await import('../roster-alignment.js');
    const DATES = ['2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08'];
    const rowFor = (/** @type {any} */ m, /** @type {number} */ off) => Object.fromEntries(DATES.map(d => {
        const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + off);
        return [d, getBaseShift(m, x)];
    }));
    // Members the detector can actually SEE drifting — it is deliberately conservative, and a
    // member whose pattern looks the same on adjacent days stays silent by design.
    const drifted = teamMembers
        .filter(/** @param {any} m */ m => !m.hidden && !m.managerOnly && m.rosterType === 'main'
            && detectShiftedRow(m, rowFor(m, 1), DATES) === 'left')
        .slice(0, 3)
        .map(/** @param {any} m */ m => ({ memberName: m.name, shifts: rowFor(m, 1) }));
    expect(drifted.length, 'fixture needs three detectably-drifted members').toBe(3);

    await seedSession(page, 'G. Miller');

    await openRosterReview(page, {
        weekEnding: '2026-08-08', rosterType: 'cea', dates: DATES,
        crossCheck: 'complete', missingMembers: [], choices: {},
        parsed: drifted,
    });

    // The refusal is stated, and names who.
    const stop = page.locator('.roster-alignment-stop');
    await expect(stop).toBeVisible();
    await expect(stop).toContainText('has not been saved');
    await expect(stop).toContainText(drifted[0].memberName);

    // Nothing is ticked, and the Save button is GONE rather than relabelled — a disabled control
    // reading "Read the roster again" put the instruction on the one thing that could not carry it
    // out, while the button that can sat underneath as the quiet secondary.
    await expect(page.locator('.roster-tick:not(.off)')).toHaveCount(0);
    await expect(page.locator('#rosterApplyBtn')).toBeHidden();
    const remedy = page.locator('#rosterCancelBtn');
    await expect(remedy).toBeVisible();
    await expect(remedy).toHaveText('Read the roster again');
    await expect(remedy).toHaveClass(/roster-cancel-btn--primary/);

    // No per-row escape hatch: a tick on a refused read does nothing at all.
    const firstTick = page.locator('.roster-tick').first();
    await firstTick.click();
    await expect(page.locator('.roster-tick:not(.off)')).toHaveCount(0);

    // THE HARD GATE, ISOLATED. Everything above is satisfied by `chosen: false` alone — deleting
    // the `rosterBlocked` guard in the save loop left this test green, which is how it was found.
    // So this case forces the state a future renderer (or a stray handler) could produce: every
    // row ticked, the button enabled, the click pressed. The write is what is asserted, not the
    // label, because the batch mock records payloads and a summary count is a separate pass.
    await page.evaluate(() => {
        document.querySelectorAll('.roster-tick').forEach(t => /** @type {HTMLElement} */ (t).click());
        const b = /** @type {HTMLButtonElement} */ (document.getElementById('rosterApplyBtn'));
        if (b) { b.disabled = false; b.click(); }
    });
    await page.waitForTimeout(500);
    const writes = await page.evaluate(() => (/** @type {any} */ (window).__E2E?.batchWrites || []).length);
    expect(writes, 'a refused read must write nothing even if every row is forced on').toBe(0);
});

test('operations: the review offers the original PDF to check against', async ({ page }) => {
    // Every message this release adds ends in "check it against the PDF". Until v22.16 the file had
    // effectively left the workflow once the parse returned, so failing closed asked the admin to
    // consult something they could no longer reach.
    await seedSession(page, 'G. Miller');
    await openRosterReview(page);
    const view = page.locator('.roster-view-pdf');
    await expect(view).toBeVisible();
    await expect(view).toContainText('roster.pdf');
});


// ── ANSWERING AN UNREADABLE CELL IN PLACE (v22.17) ────────────────────────────────────────────
//
// The composition rule is unit-tested in override-utils.test.mjs. What only a browser answers is
// whether the control REACHES the write — and that is the whole point of the feature, because the
// thing it replaces was a dead end that sent the admin to another page with a name and a date to
// remember. The batch mock records payloads, so these assert on what was WRITTEN.
test('operations: an unreadable cell can be answered in the review, and the entry is written', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await openRosterReview(page);

    const row = page.locator('.roster-change-row', { hasText: 'XZ9 GARBLED' });
    await row.locator('.roster-choice-btn--enter').click();
    await row.locator('.roster-entry-pill', { hasText: 'Shift' }).click();

    // An INCOMPLETE entry writes nothing and says so — the dangerous direction is a half-typed
    // time becoming a shift, because a half-typed time still looks like a time.
    await row.locator('.roster-entry-time[data-part="from"]').fill('06:00');
    await expect(row.locator('.roster-entry-hint')).toContainText('Enter both times');
    await expect(page.locator('#rosterApplyBtn')).toHaveText(/Save 3 changes/);

    await row.locator('.roster-entry-time[data-part="to"]').fill('14:00');
    await expect(row.locator('.roster-entry-hint')).toContainText('will be saved');
    // The row itself must stop saying "couldn't read — check the paper roster" while the summary
    // above counts it: the two used to disagree on screen, because the keystroke path patches the
    // row rather than re-rendering it (a re-render would destroy the field being typed into).
    await expect(row.locator('.roster-act')).toHaveText('Your entry');
    await expect(page.locator('#rosterApplyBtn')).toHaveText(/Save 4 changes/);

    await page.locator('#rosterApplyBtn').click();
    await page.waitForTimeout(700);
    const written = await page.evaluate(() =>
        (/** @type {any} */ (window).__E2E?.batchWrites || []).filter(/** @param {any} w */ w => w.date === '2026-08-05'));
    expect(written.length, 'the entered day must be written exactly once').toBe(1);
    expect(written[0].value).toBe('06:00-14:00');
    expect(written[0].type).toBe('shift');
    expect(written[0].source).toBe('roster_import');
});

test('operations: an entered RDW is written as RDW, not as an ordinary shift', async ({ page }) => {
    // ADDED AFTER A SURVIVING MUTATION. Dropping the `RDW|` marker from `manualCellValue` left the
    // suite green, because the case above only ever enters a Shift. The marker is what makes
    // `shiftValueToOverrideType` write `rdw`, and the day is a WEDNESDAY on purpose: on a Sunday a
    // plain time is promoted to rdw anyway, so a Sunday case would pass with the marker gone and
    // prove nothing. This is money — a rest day worked is paid at a different rate.
    await seedSession(page, 'G. Miller');
    await openRosterReview(page);
    const row = page.locator('.roster-change-row', { hasText: 'XZ9 GARBLED' });
    await row.locator('.roster-choice-btn--enter').click();
    await row.locator('.roster-entry-pill', { hasText: /^RDW$/ }).click();
    await row.locator('.roster-entry-time[data-part="from"]').fill('09:00');
    await row.locator('.roster-entry-time[data-part="to"]').fill('17:00');
    await page.locator('#rosterApplyBtn').click();
    await page.waitForTimeout(700);
    const written = await page.evaluate(() =>
        (/** @type {any} */ (window).__E2E?.batchWrites || []).filter(/** @param {any} w */ w => w.date === '2026-08-05'));
    expect(written.length).toBe(1);
    expect(written[0].type, 'a rest day worked must not be saved as an ordinary shift').toBe('rdw');
    // The stored value is the bare time — the RDW-ness lives in `type`, as it does everywhere else.
    expect(written[0].value).toBe('09:00-17:00');
});

test('operations: the entry control never offers a type Sunday forbids', async ({ page }) => {
    // Sunday is uncontracted, so AL, Absent and a plain Shift may never be written to one — six
    // numbered enforcement layers say so, and this control consults that list rather than keeping
    // a seventh copy. RDW is the type that BELONGS on a Sunday and must stay available.
    await seedSession(page, 'G. Miller');
    await openRosterReview(page, {
        weekEnding: '2026-08-08', rosterType: 'cea', dates: ROSTER_REVIEW_DATES,
        crossCheck: 'complete', missingMembers: [], choices: {},
        parsed: [{ memberName: 'G. Miller', shifts: { '2026-08-02': 'UNKNOWN|SMUDGE' } }],
    });
    const row = page.locator('.roster-change-row', { hasText: 'SMUDGE' });
    await row.locator('.roster-choice-btn--enter').click();
    for (const label of ['AL', 'Absent', 'Shift']) {
        await expect(row.locator('.roster-entry-pill', { hasText: new RegExp(`^${label}$`) }))
            .toBeDisabled();
    }
    await expect(row.locator('.roster-entry-pill', { hasText: /^RDW$/ })).toBeEnabled();
    await expect(row.locator('.roster-entry-pill', { hasText: /^Rest Day$/ })).toBeEnabled();
});

// ── THE HUDDLE TABLE MUST NOT DRAG THE WHOLE PAGE SIDEWAYS (v22.27) ────────────────────────────
//
// Reported from two staff screenshots on a 412px phone. The Huddle gained a fifth column
// (Shift · Call Sign · Early · Middle · Late) and stopped fitting. `#huddleViewerBody` was the only
// scroll container, so reading the Late column scrolled the entire document: the date heading slid
// off ("Wednesday 2nd September 2026" showing as "nd September 2026") and the Shift and Call Sign
// columns — the ones that say whose row you are on — went with it. Nothing errored. It was simply
// unusable, which is the hardest kind of fault to be told about.
//
// This drives the REAL `wrapTables` against the REAL index.css. A unit test of the wrapper would
// pass on markup that still scrolled the page, because the fix is mostly CSS; and a visual baseline
// cannot see it, because the defect only appears once a finger has scrolled.
//
// `white-space: nowrap` is injected to force the case. The shipped `overflow-wrap: anywhere` lets
// most Huddles shrink to fit, and a test that relied on real content overflowing would stop testing
// anything the day the Huddle got one column narrower.
// ── A ROWSPAN MAKES `td:first-child` THE WRONG COLUMN (v22.31; pinned properly v22.33) ─────────
//
// Reported from a phone: in the Gate line block the reminder note had C17 and C18 drawn on top of
// it. The job cell there spans three rows, so those rows have no cell of their own in column 1 and
// `td:first-child` — the selector that pinned the job column — resolved to the CALL SIGN instead.
// Two cells, one place.
//
// v22.31 met that by refusing to pin any table containing a rowspan. v22.33 computes the real grid
// (`firstColumnMask`) and marks only true column-1 cells, so the feature works on the shape it was
// written for. The unit suite proves the WALK; only a browser can prove the marking reaches the
// right cells and that they do not overlap once scrolled — which is the failure that was reported.
//
// The fixture is the reported table, merged cell and all. A rectangular one cannot fail this test:
// it is the single shape where "first cell written" and "column 1" agree, which is exactly why the
// original synthetic fixture missed the defect.
test('huddle: a rowspan pins the job cell only, and the call signs stay in their own column', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto('/index.html');

    const r = await page.evaluate(async () => {
        const { wrapTables } = await import('./calendar-huddle-viewer.js');
        const body = document.getElementById('huddleViewerBody');
        document.getElementById('huddleViewer').classList.add('visible', 'open');

        // Real content lengths, not placeholders: the fixture has to be genuinely wider than a
        // 412px panel or there is no scroll and sticky positioning does nothing.
        body.innerHTML = '<table><thead>'
            + '<tr><th>Shift</th><th>Call Sign</th><th>Early</th><th>Middle</th><th>Late</th></tr>'
            + '</thead><tbody>'
            + '<tr><td rowspan="3">Gate line Reminder Hourly SCU rota please</td>'
            +   '<td>C16</td><td>06.20-13.45 Orient</td><td>12.00-16.00 Charlie</td><td>13.30-22.00 Jawad XS</td></tr>'
            + '<tr><td>C17</td><td>06.20-13.45 Junior</td><td></td><td>14.00-22.30 Tahira/Iskander(training) XS</td></tr>'
            + '<tr><td>C18</td><td>07.00-16.00 Sam</td><td></td><td>15.15-23.55 Michael Iskander XS</td></tr>'
            + '</tbody></table>';
        wrapTables(body);

        const wrap = body.querySelector('.huddle-table-wrap');
        const cellAt = (row, i) => body.querySelectorAll('tbody tr')[row].cells[i];
        const left = el => Math.round(el.getBoundingClientRect().left);
        const gate = cellAt(0, 0), c17 = cellAt(1, 0), c18 = cellAt(2, 0);

        const at0 = { gate: left(gate), c17: left(c17), c18: left(c18) };

        // Scroll it: sticky positioning does nothing at offset 0, so an unscrolled table cannot
        // show the defect — the reported screenshot is of a table someone had swiped.
        wrap.scrollLeft = wrap.scrollWidth;
        await new Promise(requestAnimationFrame);
        const atEnd = { gate: left(gate), c17: left(c17), c18: left(c18) };

        return {
            classed: [...body.querySelectorAll('.huddle-shift-col')].map(c => c.textContent.trim().slice(0, 9)),
            sticky:  [...body.querySelectorAll('th, td')].filter(c => getComputedStyle(c).position === 'sticky')
                        .map(c => c.textContent.trim().slice(0, 9)),
            at0, atEnd,
            scrolled: wrap.scrollLeft > 0,
            bodyScroll: body.scrollWidth <= body.clientWidth + 1,
        };
    });

    expect(r.scrolled, 'the fixture must actually be wider than the panel, or nothing is proven').toBe(true);
    // The marking: the job cell, and nothing else. A call sign in this list is the reported bug.
    // The header's "Shift" cell is column 1 too, and belongs here — the column it labels is the
    // one being pinned, so a heading that scrolled away from its own column would be the same
    // defect in the other direction.
    expect(r.classed, 'only cells genuinely in column 1 may be marked').toEqual(['Shift', 'Gate line']);
    expect(r.sticky, 'and only those may be sticky once scrolled').toEqual(['Shift', 'Gate line']);
    // The geometry, stated as the thing that actually distinguishes correct from the screenshot.
    // A pinned cell is one that does NOT move when the table scrolls — that is the whole mechanism,
    // and in the defect C17 and C18 were pinned, so they stayed at the left edge on top of the job
    // cell. Asserting they sit to the right of it would be asking for the impossible instead: a
    // sticky column is opaque and everything behind it slides underneath, which is correct.
    // Within a pixel, not exactly: `left: 0` is measured against the wrapper's padding box and the
    // collapsed 1px table border lands the pinned cell one pixel off its unscrolled position. The
    // scale is what carries the meaning — the job cell moves ~1px, the call signs move tens.
    expect(Math.abs(r.atEnd.gate - r.at0.gate),
        'the job cell is pinned, so scrolling must not move it').toBeLessThanOrEqual(2);
    expect(r.atEnd.c17, 'C17 must SCROLL — it was pinned over the job cell, which is the defect')
        .toBeLessThan(r.at0.c17 - 20);
    expect(r.atEnd.c18, 'and so must C18').toBeLessThan(r.at0.c18 - 20);
    expect(r.at0.c17, 'unscrolled, C17 starts to the right of the job cell it shares a row with')
        .toBeGreaterThan(r.at0.gate);
    // And the original v22.27 defect must stay fixed: the table scrolls, the document does not.
    expect(r.bodyScroll, 'the viewer body itself must not be the thing scrolling sideways').toBe(true);
});

// The other direction: a plain rectangular Huddle must still pin its job column. Without this, a
// "fix" that marked nothing at all would pass every assertion above.
test('huddle: a plain table still pins its job column', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto('/index.html');
    const sticky = await page.evaluate(async () => {
        const { wrapTables } = await import('./calendar-huddle-viewer.js');
        const body = document.getElementById('huddleViewerBody');
        document.getElementById('huddleViewer').classList.add('visible', 'open');
        body.innerHTML = '<table><tbody>'
            + '<tr><td>Station Manager</td><td>C3</td><td>06.30-15.30 Nicol</td><td></td><td>14.00-23.00 Darren</td></tr>'
            + '<tr><td>Booking Office</td><td>C23</td><td>06.20-14.20 XS Naomi</td><td>12.00-16.00 Charlie</td>'
            +   '<td>14.00-22.30 Tahira/Iskander(training) XS</td></tr>'
            + '</tbody></table>';
        wrapTables(body);
        return [...body.querySelectorAll('td')]
            .filter(td => getComputedStyle(td).position === 'sticky')
            .map(td => td.textContent.trim());
    });
    expect(sticky).toEqual(['Station Manager', 'Booking Office']);
});

test('huddle: a table too wide to fit scrolls itself, not the page', async ({ page }) => {
    // Its OWN viewport, not the project's: at 1280 the table fits and there is nothing to measure,
    // so on the desktop project this would pass while testing nothing. 412 is the reported device.
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto('/index.html');
    // ── NO addStyleTag HERE, AND THAT IS THE POINT (v22.29) ────────────────────────────────────
    // This test used to inject `white-space: nowrap; overflow-wrap: normal` before measuring, to
    // force the table wide enough to have something to scroll. That override cancelled
    // `overflow-wrap: anywhere` — the shipped rule that WAS the defect — so the harness measured a
    // page whose broken CSS it had just disabled, and every assertion below passed while the real
    // Huddle crushed "Call Sign" into four stacked letters on a phone.
    //
    // A test may not switch off the rule it is testing. The fixture is a real Huddle instead, and
    // it is wide enough on its own: five columns of times and names come to ~429px against a ~380px
    // panel at this width, so the scroll it asserts is the scroll a member actually gets.

    const geom = await page.evaluate(async () => {
        const { wrapTables } = await import('./calendar-huddle-viewer.js');
        const body = document.getElementById('huddleViewerBody');
        const viewer = document.getElementById('huddleViewer');
        viewer.classList.add('visible', 'open');          // the panel must be laid out to measure it
        const row = (c) => `<tr>${c.map(x => `<td>${x}</td>`).join('')}</tr>`;
        body.innerHTML = '<h1>Wednesday 2nd September 2026</h1><table>'
            + '<tr><th>Shift</th><th>Call Sign</th><th>Early</th><th>Middle</th><th>Late</th></tr>'
            + row(['Station Manager', 'C3', '06.30-15.30 Nicol', '', '14.00-23.00 Darren'])
            + row(['Booking Office', 'C23', '06.20-14.20 XS Naomi', '12.00-16.00 Charlie',
                   '14.00-22.30 Tahira/Iskander(training) XS'])
            + '</table>';
        wrapTables(body);
        wrapTables(body);                                  // idempotent: reopen re-renders the memo
        const wrap = body.querySelector('.huddle-table-wrap');
        body.scrollLeft = 99999;
        if (wrap) wrap.scrollLeft = 99999;                 // scroll right, as a reader must
        const firstCell = body.querySelector('table tr:nth-child(2) td');
        return {
            wrappers: body.querySelectorAll('.huddle-table-wrap').length,
            bodyScrollsX: body.scrollWidth - body.clientWidth,
            tableScrollsX: wrap ? wrap.scrollWidth - wrap.clientWidth : 0,
            headingLeft: Math.round(document.querySelector('#huddleViewerBody h1').getBoundingClientRect().left),
            firstColLeft: Math.round(firstCell.getBoundingClientRect().left),
            firstColText: firstCell.textContent.trim(),
            // Lines in the tallest header, from its own line-height — no magic pixel constant.
            headerLines: (() => {
                const th = [...body.querySelectorAll('th')]
                    .sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
                const lh = parseFloat(getComputedStyle(th).lineHeight) || 16;
                const pad = parseFloat(getComputedStyle(th).paddingTop)
                          + parseFloat(getComputedStyle(th).paddingBottom);
                return Math.round((th.getBoundingClientRect().height - pad) / lh);
            })(),
        };
    });

    expect(geom.wrappers, 'wrapTables must be idempotent — the viewer re-renders memoised HTML')
        .toBe(1);
    // The REPORTED SYMPTOM first, so a failure names what a member actually saw rather than the
    // mechanism underneath it. A header broken mid-word stacks into fragments: "Call Sign" came
    // back as Cal/l/Sig/n, and "Information Controller" as Informatio/n Controller. Two words may
    // legitimately take two lines; four fragments is the defect.
    expect(geom.headerLines,
        'a header broken mid-word stacks into fragments — "Call Sign" as Cal/l/Sig/n was the report')
        .toBeLessThanOrEqual(2);
    expect(geom.tableScrollsX, 'the table itself must be the thing that scrolls').toBeGreaterThan(0);
    expect(geom.bodyScrollsX,
        'the document must NOT scroll sideways — that is what took the date heading off screen')
        .toBe(0);
    expect(geom.headingLeft,
        'the date heading must stay put while the table is scrolled').toBeGreaterThanOrEqual(0);
    expect(geom.firstColText).toBe('Station Manager');
    expect(geom.firstColLeft,
        'the first column is sticky — a scrolled row without it is times belonging to nobody')
        .toBeGreaterThanOrEqual(0);

    // AND THAT PRODUCTION ACTUALLY CALLS IT. Everything above drives `wrapTables` directly, so it
    // proves the function and the CSS and says nothing about the wiring — teeth-verification found
    // exactly that: deleting the call from `showInlineHuddle` left every assertion above green.
    // The render path cannot be driven from here (it is a closure inside `initHuddleViewer`, fed by
    // a Firestore snapshot), so this is a source check, which is the honest thing to admit rather
    // than to dress up. Anchored on the ASSIGNMENT and the very next statement — matching mere
    // proximity is how the paycalc notice-order guard first let a regression through.
    const wired = await page.evaluate(async () => {
        const src = await (await fetch('./calendar-huddle-viewer.js')).text();
        return /body\.innerHTML = _sanitisedHtml;\s*\n\s*wrapTables\(body\);/.test(src);
    });
    expect(wired,
        'showInlineHuddle must call wrapTables immediately after writing the sanitised HTML — '
        + 'without it the tables render unwrapped and the page scrolls sideways again').toBe(true);
});

// ── The one comparison LATENCY_PLAN.md's open decision is gated on (v22.28) ──────────────────────
//
// The plan called it "a reading, not a build", and it was not readable: every dimensional split on
// this card ran against `domReady`, so the milestone the plan's own evidence names as the wall
// (`Recognised`) could not be split by connection at all. This drives the real card against samples
// with the signature in them — `Recognised` spread across connection classes, `Getting ready` flat —
// and asserts BOTH groups render, because one alone is a row of percentages with nothing to read
// them against.
test('operations: App speed can split Recognised by connection, beside Getting ready', async ({ page }) => {
    await page.addInitScript(() => {
        window.__E2E = { ...(window.__E2E || {}), getDocData: { samples: {
            // Recognised: fine on the fast class, bad on the slow one — a network wall's signature.
            '22_28|calendar|authBoot|lt500ms|standalone|4g':   400,
            '22_28|calendar|authBoot|over8s|standalone|3g':    120,
            // Getting ready: the SAME connection classes, and flat across them. This is the half
            // that makes the block a comparison rather than an observation.
            '22_28|calendar|appBoot|lt500ms|standalone|4g':    400,
            '22_28|calendar|appBoot|lt500ms|standalone|3g':    120,
            // Enough domReady for the Calendar to be the busiest page the block renders for.
            '22_28|calendar|domReady|lt500ms|standalone|4g':   400,
            '22_28|calendar|domReady|1-3s|standalone|3g':      120,
        } } };
    });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    const speed = page.locator('#pageSpeedContent');
    await expect(speed).toContainText('Does the connection slow the start?');
    await expect(speed).toContainText('Recognised');
    await expect(speed).toContainText('Getting ready');
    // The generic connection block must name its own figure now that three blocks split by conn —
    // an unlabelled third one reads as a third milestone.
    await expect(speed).toContainText('By connection — whole load');

    // …and the two groups must say DIFFERENT things, or the block has rendered one metric twice.
    // Reading the "over 1s" figures directly is what separates "both headings appeared" from "the
    // metric argument actually reached summarisePerfBy" — the whole defect being fixed.
    const pcts = await speed.evaluate(() => {
        const label = [...document.querySelectorAll('.speed-dim-label')]
            .find(el => el.textContent === 'Recognised');
        const readGroup = (el) => [...el.nextElementSibling.querySelectorAll('.speed-row--why')]
            .map(r => r.querySelector('.speed-row-count')?.textContent).filter(Boolean);
        const authRows = readGroup(label);
        const appLabel = [...document.querySelectorAll('.speed-dim-label')]
            .find(el => el.textContent === 'Getting ready');
        return { authRows, appRows: readGroup(appLabel) };
    });
    // Recognised spreads (one class slow, one fast); Getting ready is flat at 0% on both.
    expect(pcts.authRows.sort()).toEqual(['0%', '100%']);
    expect(pcts.appRows).toEqual(['0%', '0%']);
});
