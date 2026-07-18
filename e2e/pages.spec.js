import { test, expect, enforceNamedSession, enableInplaceLogin } from './fixtures.js';
import { collectFatalErrors, seedSession, seedMember, pickFirstMemberAndPassword, DESKTOP_WIDTHS, armEnforcementWithFailingSignIn, signInThroughOverlay } from './helpers.js';

// ── SETTINGS (settings.html) ──────────────────────────────────────────────

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

    // Proof that initApp() → initContactCard() → initCardCollapse() ran: the
    // collapse helper sets aria-expanded on the Work Email header synchronously
    // (to "true" since the card now DEFAULTS OPEN on this 2-card page, v16.57 UX).
    // The static HTML has no aria-expanded attribute, so its presence proves the
    // signed-in init wired the header — meaning the "?" handler is in place and
    // the click below cannot race the wiring.
    await expect(page.locator('#contactToggleHeader')).toHaveAttribute('aria-expanded', 'true');

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
        // Suppress the one-time work-email overlay so it doesn't cover the cards.
        await page.addInitScript(() => localStorage.setItem('myb_email_check_done_G. Miller', '1'));
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
        const rightIds = ['#rosterUploadCard', '#workEmailCard', '#errorLogCard', '#usageCard', '#pageSpeedCard', '#authSetupCard'];
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
    await page.addInitScript(() => localStorage.setItem('myb_email_check_done_G. Miller', String(Date.now())));
    await page.goto('/operations.html');
    await expect(page.locator('#pageSpeedCard')).toBeVisible();
    // Two journeys: "Signing in" (login) + "Opening pages" (page-open), both empty on a stubbed read.
    await expect(page.locator('#pageSpeedContent')).toContainText('Signing in');
    await expect(page.locator('#pageSpeedContent')).toContainText('Opening pages');
    await expect(page.locator('#pageSpeedContent')).toContainText('No sign-ins recorded'); // login empty state (month-neutral copy, v16.22)
    await expect(page.locator('#pageSpeedContent')).toContainText('Not enough data yet');       // pages empty state
});

// Work Email Progress rows must not overflow the card on a narrow phone. The bug
// (v14.35): each row is a flex item inside the --added flex COLUMN, which inherited
// flex-wrap:wrap, so a long-email row sized to its content (~388px) and overflowed
// the ~291px list — the card's overflow:hidden then clipped the Remove button.
test('operations: Work Email rows keep Edit/Remove on-screen at 375px (long emails ellipsise)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 760 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => localStorage.setItem('myb_email_check_done_G. Miller', '1'));
    await page.goto('/operations.html');
    await expect(page.locator('#workEmailCard')).toBeVisible();

    // Inject a row with a deliberately long email (Firestore is stubbed empty in e2e),
    // matching operations-app.js's row markup, into the expanded card.
    const res = await page.evaluate(() => {
        const body = document.getElementById('emailStatusContent');
        const row = document.createElement('div'); row.className = 'email-added-row';
        const chip = document.createElement('span'); chip.className = 'email-count-chip email-count-chip--added';
        const nm = document.createElement('span'); nm.className = 'email-chip-name'; nm.textContent = 'C. Francisco-Charles';
        const em = document.createElement('span'); em.className = 'email-chip-email'; em.textContent = 'csherrice.francisco-charles@chilternrailways.co.uk';
        chip.append(nm, em);
        const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'email-set-btn'; edit.textContent = 'Edit';
        const rem = document.createElement('button'); rem.type = 'button'; rem.className = 'email-set-btn email-set-btn--remove'; rem.textContent = 'Remove';
        row.append(chip, edit, rem);
        const list = document.createElement('div'); list.className = 'email-count-list email-count-list--added';
        list.appendChild(row); body.innerHTML = ''; body.appendChild(list);
        document.getElementById('workEmailBody')?.classList.add('open');
        const cardRight = document.getElementById('workEmailCard').getBoundingClientRect().right;
        return {
            removeRight: rem.getBoundingClientRect().right,
            cardRight,
            emailEllipsized: em.scrollWidth > em.clientWidth,
        };
    });
    // The Remove button (rightmost element) must sit within the card, not clipped.
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

// ── ADMIN TOUCH LAYOUT — no horizontal blowout when a pill with hours is selected ──
// Regression: on TOUCH devices (pointer: coarse) the bulk-bar time inputs' intrinsic
// min-width (~180px each, unshrinkable without min-width: 0) stretched the whole page
// to ~585px inside a ~393px viewport the moment a pill with hours (Shift/RDW/Other)
// was selected — clipping the header, member bar, and every card at the right edge.
// Desktop never showed it (the coarse-pointer stylesheet block doesn't apply), which
// is why this must assert element widths on the Pixel-5 project, not desktop.
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
