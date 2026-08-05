import { test, expect, enforceNamedSession, enableInplaceLogin } from './fixtures.js';
import { collectFatalErrors, seedSession, seedMember, pickFirstMemberAndPassword, DESKTOP_WIDTHS, armEnforcementWithFailingSignIn, signInThroughOverlay, openRosterReview } from './helpers.js';

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
    await page.setViewportSize({ width: 1024, height: 800 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => localStorage.setItem('myb_links_welcome_seen', '1'));
    await page.goto('/links.html');

    // Make the page dirty: apply the auto-generated pattern (targets seed from static roster data,
    // so this is deterministic in the hermetic env). Apply goes through the confirmDialog.
    await expect(page.locator('#generatorToggleHeader')).toBeVisible();
    await page.locator('#genApplyBtn').click();
    await page.locator('.dialog-overlay .dialog-btn-confirm').click();      // "Apply"
    await expect(page.locator('.dialog-overlay')).toHaveCount(0);
    await expect(page.locator('#linksSaveRow')).toBeVisible();              // design now loaded (unsaved)

    // Open the drawer and click a guide link (same-tab since v18.81).
    await page.locator('#navMenuBtn').click();
    const guide = page.locator('.nav-panel-link--guide').first();
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
    await page.setViewportSize({ width: 1024, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => localStorage.setItem('myb_links_welcome_seen', '1'));
    await page.goto('/links.html');
    await expect(page.locator('#generatorToggleHeader')).toBeVisible();
    await page.locator('#genApplyBtn').click();
    await page.locator('.dialog-overlay .dialog-btn-confirm').click();   // "Apply"
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
        for (let i = 1; i <= 28; i++) {
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
    await expect(chips).toHaveCount(3);

    // It must be STICKY and PAINTED mid-grid, not merely present — the v19.55 lesson (a probe read
    // `el.hidden` while the browser rendered the element anyway).
    await page.evaluate(() => window.scrollTo(0, 500));
    const box = await page.locator('#linksSaveRow').boundingBox();
    expect(Math.round(box.y + box.height), 'the bar must sit at the viewport bottom while the grid is on screen')
        .toBe(900);

    // …and it must UPDATE. Painting rest days over worked cells has to move a figure.
    const before = await chips.allTextContents();
    await page.locator('.brush-chip').first().click();          // the RD brush
    for (let i = 0; i < 40; i++) await page.locator('.shift-cell-btn').nth(i).click();
    await expect.poll(() => chips.allTextContents()).not.toEqual(before);
});

test('links: the fatigue panel collapses its "nothing to report" rows but still counts them', async ({ page }) => {
    await openLinksWithDesign(page);
    const rows = page.locator('#checksContent .check-row:visible');
    const collapsed = await rows.count();

    // The count stays in the always-visible heading — that is what stops the disclosure becoming
    // false assurance. And the two figures must AGREE: they did not at first (the heading said 17
    // while the label said 10, because the night-family rollup sat outside the disclosure).
    const meta = await page.locator('.check-section-meta').first().textContent();
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
    const ok = page.locator('.dialog-btn-confirm');
    if (await ok.count()) await ok.first().click();
    await expect(page.locator('#linksSaveStatus')).toContainText('Review and save when ready');
    // …and specifically NOT a before→after report, because nothing was reordered.
    await expect(page.locator('#linksSaveStatus')).not.toContainText('week-to-week');
});

test('links: deleting a design writes a SOFT delete and leaves the document in place', async ({ page }) => {
    await openLinksWithDesigns(page);
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.setWrites = []; });

    // ✕ appears on the ACTIVE chip only.
    await page.locator('.design-chip--active .design-chip-delete').click();
    await page.locator('.dialog-overlay .dialog-btn-confirm').click();
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

test('links: a deleted design can be restored from the bin', async ({ page }) => {
    await openLinksWithDesigns(page);
    await page.locator('.design-chip--active .design-chip-delete').click();
    await page.locator('.dialog-overlay .dialog-btn-confirm').click();
    await expect(page.locator('.design-chip')).toHaveCount(1);

    await page.evaluate(() => { /** @type {any} */ (window).__E2E.setWrites = []; });
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

// The purge is the ONLY destructive path left in the workspace, so it gets a test that watches
// both directions at once: the expired design must go, and the one still inside the window must
// survive the same sweep. A purge that took everything would pass a test that only checked the
// first half.
test('links: an expired deletion is purged on load and a recent one is not', async ({ page }) => {
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
    await expect(page.locator('#designBinBtn')).toHaveText(/Recently deleted \(1\)/);

    const deletes = await page.evaluate(() => /** @type {any} */ (window).__E2E.deletedPaths || []);
    expect(deletes).toEqual(['linkDesigns/old']);

    await page.locator('#designBinBtn').click();
    await expect(page.locator('#designBinList .bin-row')).toHaveCount(1);
    await expect(page.locator('.bin-row-name')).toHaveText('Just binned');
    await expect(page.locator('.bin-row-meta')).toHaveText(/Deleted 2 days ago by S. Silva/);
});

// The purge re-reads inside a transaction instead of trusting the load snapshot. This is the case
// that justifies it: Firestore runs with persistentLocalCache, so a load can be served from
// IndexedDB and be stale — showing a design as deleted-and-expired that a colleague has since
// restored. Deleting on the strength of that snapshot destroys a LIVE design, which is the exact
// outcome soft delete exists to prevent. Here the page loads the stale view and the server view
// (txDocs) says restored.
test('links: a design restored elsewhere is NOT purged, even if our snapshot says expired', async ({ page }) => {
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
    // Give the purge transaction time to resolve — the assertion is a NEGATIVE, so it has to be
    // possible for it to have happened by the time we look.
    await expect(page.locator('#designBinBtn')).toBeHidden();
    const deletes = await page.evaluate(() => /** @type {any} */ (window).__E2E.deletedPaths || []);
    expect(deletes, 'a design the server says is live must survive a stale-snapshot purge').toEqual([]);
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
test('settings password card: Show reveals BOTH new and confirm, and toggles back', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.goto('/settings.html');

    const toggle  = page.locator('#pwNewToggle');
    const newEl   = page.locator('#pwNew');
    const confirm = page.locator('#pwConfirm');
    await expect(newEl).toHaveAttribute('type', 'password');
    await expect(confirm).toHaveAttribute('type', 'password');

    await toggle.click();
    // Confirm flips too — checking the two against each other is the whole reason to reveal.
    await expect(newEl).toHaveAttribute('type', 'text');
    await expect(confirm).toHaveAttribute('type', 'text');
    await expect(toggle).toHaveText('Hide');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    await toggle.click();
    await expect(newEl).toHaveAttribute('type', 'password');
    await expect(confirm).toHaveAttribute('type', 'password');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
});

test('settings password card: the typed value is not hidden under the Show button', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.goto('/settings.html');
    // shared.css reserves the button's room via a `.login-field` selector this card does not match,
    // so without settings.css's own padding rule the text would run underneath "Show".
    const gap = await page.evaluate(() => {
        const input  = /** @type {HTMLElement} */ (document.getElementById('pwNew'));
        const button = /** @type {HTMLElement} */ (document.getElementById('pwNewToggle'));
        const pr = parseFloat(getComputedStyle(input).paddingRight);
        return { pr, btnW: button.getBoundingClientRect().width };
    });
    expect(gap.pr, 'padding-right must clear the Show button').toBeGreaterThanOrEqual(gap.btnW);
});

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

    await expect(page.locator('#usageContent')).toContainText('accounts this month');
    await expect(page.locator('#usageContent')).toContainText('Page popularity');
    // The empty wrapper removes itself rather than leaving a stray divider rule.
    await expect(page.locator('.usage-signin')).toHaveCount(0);
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
    const clears = page.locator('.btn-rr-clear');
    await clears.nth(0).click();
    await clears.nth(1).click();

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
        // that CLICKS something. "a designer sees all 28 lines" kept passing with a modal over the
        // page, because text is readable behind an overlay — the same assert-text-vs-drive-the-UI
        // split that has hidden three separate defects this release. Seed it HERE, once, rather
        // than in each test.
        localStorage.setItem('myb_links_welcome_seen', '1');
        /** @type {any} */ (window).__E2E = /** @type {any} */ (window).__E2E || {};
        /** @type {any} */ (window).__E2E.docs = [{
            id: 'd1', name: 'Option A', updatedBy: 'S. Silva',
            patterns: { '1': { sun: 'RD', mon: '06:20-14:20', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' } },
        }];
    });
    await page.goto('/links.html');
    await expect(page.locator('#linksGridBodyRows tr')).toHaveCount(28);
}

test('links: a designer sees all 28 lines and the saved design', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await seedSession(page, 'G. Miller');
    await openLinks(page);
    // Line 1 Monday carries the seeded shift; the rest of the rotation is undesigned.
    await expect(page.locator('tr[data-pos="1"] .shift-cell-btn').nth(1)).toContainText('06:20');
    await expect(page.locator('tr.row-unfilled')).toHaveCount(27);
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

test('links: the generator fills all 28 lines and names what it replaces', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1000 });
    await seedSession(page, 'G. Miller');
    await openLinks(page);

    await page.locator('#generatorToggleHeader').click();
    await page.locator('#genApplyBtn').click();

    // The active design has content, so the confirm must say so rather than the generic wording —
    // Apply overwrites all 28 lines either way (v19.38).
    const dialog = page.locator('.lb-overlay.visible');
    await expect(dialog).toContainText('Option A');
    await expect(dialog).toContainText(/replaces all 28 lines/i);
    await dialog.getByRole('button', { name: /Replace all 28 lines/i }).click();

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
    await expect(page.locator('#linksGridBodyRows tr')).toHaveCount(28);
    await page.locator('#generatorToggleHeader').click();
    await expect(page.locator('#genSpareLines')).toHaveValue('7');
});

test('links: the roster seed covers all 28 real lines, not a 22-line sample', async ({ page }) => {
    // The seed used to read the main 20 weeks plus only the TWO bilingual weeks the two bilingual
    // members happen to sit on, and then apply that to a 28-line design. Bilingual weeks 1 and 8 are
    // the SPARE ones and were never sampled, so the default came back as 4 spare lines where the
    // roster the design represents has SIX — main 1/7/12/17 plus bilingual 1/8. Two whole lines of
    // standby cover missing by default, from a number nobody had reason to re-check.
    //
    // Driven through the real "Reset targets from current roster" button: the seed lives in the
    // coordinator, so a unit test would have to re-derive it and would then be checking its own copy.
    await page.setViewportSize({ width: 390, height: 1000 });
    await seedSession(page, 'G. Miller');
    await openLinks(page);
    await page.locator('#generatorToggleHeader').click();
    await page.locator('#genSeedBtn').click();
    await expect(page.locator('#genSpareLines')).toHaveValue('6');
});

test('links: generating names the construction that produced the design', async ({ page }) => {
    // Two constructions live behind one button and they give visibly different designs — settled
    // weeks keep a line inside one wave, the fallback walks it across the whole day. A designer who
    // is not told which they got cannot account for the difference.
    await page.setViewportSize({ width: 900, height: 1000 });
    await seedSession(page, 'G. Miller');
    await openLinks(page);
    await page.locator('#generatorToggleHeader').click();
    await page.locator('#genApplyBtn').click();
    await page.locator('.dialog-btn-confirm').click();
    await expect(page.locator('#linksSaveStatus')).toContainText(/settled weeks, \d+ waves?/);
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
test('no focusable field falls below 16px on a touch device @a11y', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile-chrome', 'needs a real coarse pointer');
    await page.setViewportSize({ width: 390, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => { localStorage.setItem('myb_links_welcome_seen', '1'); });

    for (const url of ['/', '/admin.html', '/paycalc.html', '/operations.html', '/settings.html', '/links.html']) {
        await page.goto(url);
        await page.waitForTimeout(700);
        // Open every collapsible, or the fields inside a closed card are never measured.
        await page.evaluate(() => document.querySelectorAll('.card-collapsible-body')
            .forEach(el => el.classList.add('open')));
        await page.waitForTimeout(250);
        const bad = await page.evaluate(() => {
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
    test.skip(info.project.name !== 'mobile-chrome', 'needs a real coarse pointer');
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
        const after = input.nextSibling;
        const r = document.createRange();
        r.selectNodeContents(/** @type {Node} */ (after));
        return { input: input.getBoundingClientRect(), tail: r.getBoundingClientRect(), text: after?.textContent };
    }));
    expect(clause.length, 'two objectives carry a numeric clause').toBe(2);
    for (const c of clause) {
        expect(c.text?.trim(), 'the number is followed by the words it qualifies').toBeTruthy();
        // Vertical centres within half a line of each other = the same line.
        const gap = Math.abs((c.tail.top + c.tail.bottom) / 2 - (c.input.top + c.input.bottom) / 2);
        expect(gap, `"${c.text?.trim()}" must sit beside its number, not on the line below`)
            .toBeLessThan(10);
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
        for (let i = 1; i <= 28; i++) {
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
    await expect(page.locator('#linksGridBodyRows tr')).toHaveCount(28);

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
        for (let i = 1; i <= 28; i++) pat[String(i)] = { sun: 'RD', mon: '06:20-14:20', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' };
        w.__E2E.docs = [
            { id: 'live', name: 'Option A', patterns: pat, updatedAt: 1750000000000, updatedBy: 'S. Silva' },
            // Deleted RECENTLY — a 30-day-old deletion is purged on load and the bin button never appears.
            { id: 'gone', name: 'Old idea', patterns: pat, updatedAt: 1750000000000, updatedBy: 'S. Silva',
              deletedAt: Date.now() - 2 * 86400000, deletedBy: 'S. Silva' },
        ];
    });
    await page.goto('/links.html');
    await expect(page.locator('#linksGridBodyRows tr')).toHaveCount(28);
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
    for (let i = 1; i <= 28; i++) {
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
    await expect(page.locator('#linksGridBodyRows tr')).toHaveCount(28);
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

test('links window: generating the FIRST design reveals the window editor', async ({ page }) => {
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
    const ok = page.locator('.dialog-btn-confirm');
    if (await ok.count()) await ok.first().click();
    await expect(page.locator('#windowEditor')).toBeVisible();
    // The sticky summary is the third thing this one call has to refresh (v19.57). "The generator
    // forgot to refresh X" has now been a bug twice — the window editor at v19.55, and this would
    // have been the same shape — so every artefact `renderCoverageCard` owns is pinned here rather
    // than trusted to a reviewer noticing the call site grew a third responsibility.
    await expect(page.locator('#linksSummary .sum-chip')).toHaveCount(3);
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
    // SIX, not four (v19.59). The seed used to sample the main 20 weeks plus only the two bilingual
    // weeks the two bilingual members sit on — and bilingual 1 and 8, the spare ones, were never
    // among them. The real combined roster is main 1/7/12/17 plus bilingual 1/8.
    expect(spareDays.filter(n => n === 7).length,
        'the roster seed has six spare weeks — main 1/7/12/17 and bilingual 1/8').toBe(6);
});
