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

// Regression guard (v17.62): with unsaved changes, a nav-drawer GUIDE link (target="_blank")
// must still open a new tab and leave the Links page (and its unsaved design) put — NOT get
// caught by the unsaved-changes guard and navigate the current tab away. The guard is only for
// same-tab navigation. Reproduces the bug the async-dialog conversion briefly introduced.
test('links: a guide link (new tab) is not caught by the unsaved-changes guard', async ({ page, context }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => localStorage.setItem('myb_links_beta_seen', '1'));
    await page.goto('/links.html');

    // Make the page dirty: apply the auto-generated pattern (targets seed from static roster data,
    // so this is deterministic in the hermetic env). Apply goes through the confirmDialog.
    await expect(page.locator('#generatorToggleHeader')).toBeVisible();
    await page.locator('#genApplyBtn').click();
    await page.locator('.dialog-overlay .dialog-btn-confirm').click();      // "Apply"
    await expect(page.locator('.dialog-overlay')).toHaveCount(0);
    await expect(page.locator('#linksSaveRow')).toBeVisible();              // design now loaded (unsaved)

    // Open the drawer and click a guide link (target="_blank").
    await page.locator('#navMenuBtn').click();
    const guide = page.locator('.nav-panel-link--guide').first();
    await expect(guide).toBeVisible();
    const popupPromise = context.waitForEvent('page');                     // the new tab
    await guide.click();
    const popup = await popupPromise;

    // No leave-prompt appeared, and THIS tab stayed on the Links page (unsaved work preserved).
    await expect(page.locator('.dialog-overlay')).toHaveCount(0);
    await expect(page).toHaveURL(/links\.html/);
    await popup.close();
});

// Regression guard: the auto-generate card holds a wide targets table (one row per shift
// slot, Mon–Fri / Sat / Sun columns + a spare row). On a narrow phone that table must scroll
// inside its own card, never stretch the page — a horizontal blowout clips the header and grid.
test('links: opening the auto-generator causes no horizontal page overflow (narrow phone)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });   // common Android CSS width
    await seedSession(page, 'G. Miller');                       // G. Miller is a Links designer
    await page.addInitScript(() => localStorage.setItem('myb_links_beta_seen', '1'));
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
    await expect(page.locator('#countryCount')).toContainText('of 25 countries');
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
