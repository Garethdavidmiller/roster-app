/**
 * links.spec.js — Links (links.html): the design workspace — grid, generator, sets, window, compare, bin, shortlist.
 *
 * Split out of pages.spec.js on 3 Nov 2026, test for test and unchanged: the tests that span
 * pages, and the shared drawer, dialogs and sheets, stay there.
 */
import { test, expect, withLinksDesigners } from './fixtures.js';
import { collectFatalErrors, clearNoticeFlags, seedSession, openGuideLink, seedContractTargets, clickInView, clickDialogConfirm, designOptions, activeDesignName, openDesignSheet, openDesignPicker, sheetAction, switchToDesign, proposalOptions, isTouchProject, waitForReadsToLand } from './helpers.js';
// The rotation length. Fixtures below build their patterns INSIDE the page (`addInitScript`), where
// a module import is not available, so those loops carry the literal 22 — and `links: the rotation
// length the in-page fixtures assume` ties it back to this constant. Without that tie a shrunk
// rotation would leave every fixture over-length: the grid ignores the surplus rows, so the specs
// would still pass while quietly testing the legacy-design path rather than the normal one.
import { ROTATING_LINES } from '../links-design.js';
import { PROPOSALS } from '../links-proposals.js';
import { describeSetList } from '../links-target-sets.js';

/**
 * THE LINKS PAGE HAS FINISHED OPENING — waited for, not slept past (test audit, 7 Nov 2026).
 *
 * Ten tests here slept 600–700ms after `goto` before force-pressing Generate or reading a card, as a
 * stand-in for "the page is ready". It is ready when the two reads it makes on open have answered and
 * been drawn, because each one REPAINTS what a test is about to touch: a Generate that beats
 * `loadDesigns` has its design swept away when the list lands (it resets the working copy and
 * redraws the grid), and a check made before it can pass on the page's initial markup — the window
 * editor is `hidden` in the HTML, so "hidden: no design yet" was true before anything had loaded.
 * Each read leaves a mark only it writes:
 *  - the DESIGNS: the masthead names the open design — or "No design open" — and is empty until then;
 *  - the saved STAFFING SETUPS: their picker holds no option at all until that read answers, and at
 *    least one (a set, or "No staffing setups saved yet") from then on.
 * @param {import('@playwright/test').Page} page
 */
async function linksOpened(page) {
    await expect(activeDesignName(page), 'the design list never loaded').toHaveText(/\S/);
    await expect(page.locator('#genSetSelect option').first(), 'the saved staffing setups never loaded').toBeAttached();
}

// ── LINKS (links.html) ────────────────────────────────────────────────────

test('links: shows the in-place login when not signed in', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.goto('/links.html');
    // No redirect any more (Option B) — the shared login overlay is injected in place.
    await expect(page).toHaveURL(/links\.html/);
    await expect(page.locator('#loginOverlay')).toBeVisible();
    expect(errors, 'Uncaught JS exceptions triggering links redirect').toHaveLength(0);
});

// THE SET-PASSWORD MARKER IS SPENT AS THE PAGE OPENS. A sign-in leaves a one-shot marker, and the page
// that opens next spends it, so "set your own password" is asked after a SIGN-IN and never on an
// ordinary load (password-force.js: "consume BEFORE any await"). Links spent it only once the session
// had been confirmed, so a designer who left while that was still under way carried the marker to a
// later ordinary load, which then asked out of nowhere. The restore is held here, so the session is
// still being confirmed for the whole test.
test('links: a sign-in\'s set-password marker is spent as the page opens, not once the session is confirmed', async ({ page }) => {
    const { PW_FORCE_PENDING_PREFIX } = await import('../storage-keys.js');
    const marker = PW_FORCE_PENDING_PREFIX + 'G. Miller';
    await seedSession(page, 'G. Miller');
    await page.addInitScript((key) => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        localStorage.setItem(key, '1');
        const w = /** @type {any} */ (window);
        w.__E2E = Object.assign(w.__E2E || {}, { authRestoreDelayMs: 15_000 });
    }, marker);
    await page.goto('/links.html');
    await expect(page.locator('body.auth-ready')).toBeAttached();
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), marker),
        { message: 'spent while the session is still being confirmed', timeout: 2000 }).toBeNull();
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

// …and ANSWERED "Leave", the drawer's own handling runs (links-app-18). Links asked through an older
// guard of its own that then navigated by itself, so the guide opened without `?from=links.html` — its
// ← went to the Calendar — and the drawer's history entry stayed behind to swallow one press of Back.
test('links: a guide link answered "Leave" opens the guide knowing where it came from', async ({ page }) => {
    await seedContractTargets(page);
    await page.setViewportSize({ width: 1024, height: 800 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => localStorage.setItem('myb_links_welcome_seen', '1'));
    await page.goto('/links.html');
    await expect(page.locator('#generatorToggleHeader')).toBeVisible();
    await page.locator('#genApplyBtn').click();
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');   // "Apply" — now there is unsaved work
    await expect(page.locator('.dialog-overlay')).toHaveCount(0);
    await expect(page.locator('#linksSaveRow')).toBeVisible();
    const guide = await openGuideLink(page, 'Staff & Admin Guide');
    await guide.click();
    const dialog = page.locator('.dialog-overlay.visible');
    await expect(dialog).toContainText('unsaved changes');
    await dialog.getByRole('button', { name: 'Leave' }).click();
    await expect(page).toHaveURL(/from=links\.html/);
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
    // Both of the page's reads answered (test audit, 7 Nov 2026): each repaints the card being
    // measured, so a width read before them describes a page that is about to change.
    await linksOpened(page);

    // Ensure the generator body is expanded (it auto-opens in the empty state, but make it
    // deterministic regardless of stubbed-Firebase load order).
    const opened = await page.evaluate(() => document.getElementById('generatorBody')?.classList.contains('open'));
    if (!opened) await page.locator('#generatorChevron').click();
    await expect(page.locator('#generatorBody')).toHaveClass(/open/);

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
    await expect(designOptions(page)).toHaveCount(2);
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
        // ROTATING_LINES (26). Written out rather than imported: this runs inside the PAGE, where a
        // module import is not available. It is checked against the constant below.
        for (let i = 1; i <= 26; i++) {
            patterns[String(i)] = { sun: 'RD', mon: '06:20-14:20', tue: '06:20-14:20',
                wed: '06:20-14:20', thu: '14:00-22:00', fri: 'RD', sat: 'RD' };
        }
        const w = /** @type {any} */ (window);
        w.__E2E = w.__E2E || {};
        w.__E2E.docs = [{ id: 'd1', name: 'Design A', patterns,
            updatedAt: 1_750_000_000_000, updatedBy: 'S. Silva' }];
    });
    await page.goto('/links.html');
    await expect(designOptions(page)).toHaveCount(1);
}

test('links: deleting the design you are editing does not silently bin your unsaved work', async ({ page }) => {
    // RECENTLY DELETED HOLDS THE LAST *SAVED* VERSION (v22.56, external review). Deleting the design
    // you are editing therefore threw away every change since that save, and the dialog said nothing
    // — it described the document, which was accurate and not what the designer was about to lose.
    //
    // Every other path that can lose the working copy already asks: New design, switching design,
    // signing out, leaving the page. Delete was the one that did not, and the only one with no undo.
    await openLinksWithDesigns(page);
    await expect(designOptions(page)).toHaveCount(2);   // so the delete leaves one saved design to count

    // Paint a real shift over a rest day. RD onto RD is deliberately not a change (v19.38), so the
    // brush has to be one the cell does not already hold or the design never goes dirty.
    await page.locator('#brushBar .brush-chip').nth(2).click();
    await page.locator('.shift-cell-btn').first().click();
    await expect(page.locator('#linksSaveBtn')).toBeEnabled();

    await sheetAction(page, 'designDeleteBtn');
    const dialog = page.locator('.dialog-overlay');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('unsaved changes');
    await expect(dialog).toContainText('last saved version');
    await expect(dialog.locator('.dialog-btn-confirm')).toHaveText('Save, then delete');

    // Cancelling is safe: the design and the unsaved work both survive.
    await dialog.locator('.dialog-btn-cancel').click();
    await expect(page.locator('.dialog-overlay')).toHaveCount(0);
    await expect(designOptions(page)).toHaveCount(2);
    await expect(page.locator('#linksSaveBtn')).toBeEnabled();          // still dirty

    // Confirming saves first, so what lands in the bin is what was on screen.
    await sheetAction(page, 'designDeleteBtn');
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');
    await expect(designOptions(page)).toHaveCount(1);
    await expect(page.locator('#linksSaveBtn')).toBeDisabled();         // the save happened
});

test('links: duplicating a design with unsaved changes says where they will end up', async ({ page }) => {
    // THE LAST PATH THAT SWITCHED AWAY FROM A DIRTY DESIGN IN SILENCE (v22.62, external review).
    // New design, switching design, signing out and delete all confirm at this moment; duplicate
    // ended with `_activateDesign(d)` — exactly that moment — and said nothing. The designer was
    // moved to the copy while the original quietly went back to its last save.
    //
    // The wording is deliberately NOT the others' "changes will be lost": the copy is taken from
    // the LIVE patterns, so the work is carried into it. Both halves are asserted, because a
    // borrowed sentence here would frighten the reader about the wrong outcome.
    await openLinksWithDesigns(page);
    await page.locator('#brushBar .brush-chip').nth(2).click();
    await page.locator('.shift-cell-btn').first().click();
    await expect(page.locator('#linksSaveBtn')).toBeEnabled();          // dirty

    await sheetAction(page, 'dupDesignBtn');
    const dialog = page.locator('.dialog-overlay');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('go into the copy');
    await expect(dialog).toContainText('last save');
    await expect(dialog).not.toContainText('will be lost');

    // Cancelling leaves everything alone — no third design, still dirty, still on the original.
    await dialog.locator('.dialog-btn-cancel').click();
    await expect(page.locator('.dialog-overlay')).toHaveCount(0);
    await expect(designOptions(page)).toHaveCount(2);
    await expect(page.locator('#linksSaveBtn')).toBeEnabled();
});

// A SHORTLISTED PROPOSAL'S NAME is not a design's (links-design-6). The proposals sit in the same picker
// and the same Compare chips, where two of one name cannot be told apart. The import refused one; New,
// Save as…, Save a copy as… and Rename decide through one check, which now asks as well — in any case.
test('links: a design cannot take a shortlisted proposal\'s name, new or renamed', async ({ page }) => {
    await openLinksWithDesigns(page);
    const open = await activeDesignName(page).textContent();
    const taken = PROPOSALS[0].name.toUpperCase();
    const status = page.locator('#linksSaveStatus');
    const refusal = `There is already a shortlisted proposal called “${PROPOSALS[0].name}”`;

    await sheetAction(page, 'newDesignBtn');
    await page.locator('.dialog-overlay .dialog-input').fill(taken);
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');
    await expect(status).toContainText(refusal);
    await expect(designOptions(page), 'no design was made').toHaveCount(2);
    expect(await page.evaluate(() => (/** @type {any} */ (window).__E2E.setWrites || []).filter((/** @type {any} */ w) => w.added).length)).toBe(0);

    await sheetAction(page, 'designRenameMenuBtn');
    await page.locator('.dialog-overlay .dialog-input').fill(taken);
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');
    await expect(status).toContainText(refusal);
    await expect(activeDesignName(page), 'and the open design keeps its name').toHaveText(String(open));
});

test('links: a saved-set list that failed to load never says the account is empty', async ({ page }) => {
    // THE RULE IS UNIT-TESTED; THIS IS THE WIRING (v22.57, external review). `describeSetList` is
    // pinned in links-target-sets.test.mjs, and a perfect rule still renders nothing if the
    // coordinator never asks it. The defect was `catch { targetSets = []; }`, so a dropped
    // connection rendered the empty-account line — and because these are SHARED, that tells a
    // designer their colleagues' work is gone. It had shipped twice: v21.07 removed one cause and
    // left the failure mode, and v22.56 found the second cause producing the identical sentence.
    await page.setViewportSize({ width: 1024, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window);
        w.__E2E = w.__E2E || {};
        // Fail ONLY the set collection — the designs must still load, or the workspace renders its
        // empty state and the picker under test is never built.
        w.__E2E.failGetDocsByPath = { linkTargetSets: true };
        w.__E2E.docs = [{ id: 'd1', name: 'Design A', patterns: {}, updatedAt: 1_750_000_000_000, updatedBy: 'S. Silva' }];
    });
    await page.goto('/links.html');
    await page.locator('#generatorToggleHeader').click();

    const picker = page.locator('#genSetSelect');
    await expect(picker).toBeVisible();
    // ASSERTED AGAINST THE MODULE, NOT A SENTENCE (v22.66). This read `toContainText('not been
    // deleted')` and so held one phrasing in place: when the reassurance was corrected — the old
    // one made a claim about the SETS that a failed read cannot make — the wiring test failed for
    // a copy edit that was the point of the change. The property here is that the ERROR branch of
    // `describeSetList` is what reached the DOM; which words it chooses is that module's business,
    // and its own suite's.
    const failed = describeSetList('error', []);
    await expect(picker).not.toContainText(describeSetList('ok', []).placeholder ?? '\u0000');
    await expect(picker).toContainText(failed.placeholder ?? '');
    await expect(page.locator('#genSetHint')).toHaveText(failed.hint ?? '');
    await expect(page.locator('#genSetRetryBtn')).toBeVisible();

    // A list nobody has cannot be acted on.
    await expect(page.locator('#genSetLoadBtn')).toBeDisabled();
    await expect(page.locator('#genSetDeleteBtn')).toBeDisabled();
    // …but Save as new still works: it needs nothing from the list, and on a failed read it is the
    // only way to keep the table on screen.
    await expect(page.locator('#genSetSaveAsBtn')).toBeEnabled();
});

test('links: a first-time designer gets the orientation, and can always get it back', async ({ page }) => {
    // IT HAD STOPPED REACHING ANYBODY (v22.59, external review). The panel carries the three facts a
    // newcomer cannot get from the screen, and it was built as a one-time NOTICE with a 14-day
    // window — `isNoticeExpired` marks a notice seen WITHOUT showing it, so from 16 Aug 2026 a
    // first-ever visitor was flagged and shown nothing. Expiry is right for an announcement and
    // wrong for a mental model, so the two were split.
    //
    // Deliberately UN-seeding `myb_links_welcome_seen`, which every other Links spec sets and
    // `seedSession` has set too since the Playwright 1.63 upgrade: this one is about the designer who
    // has never opened the page. The clear is a later init script, so it runs after the seed.
    await page.setViewportSize({ width: 1024, height: 900 });
    await seedSession(page, 'G. Miller');
    await clearNoticeFlags(page, ['myb_links_welcome_seen']);
    await page.goto('/links.html');

    const panel = page.locator('#linksWelcomeLb');
    await expect(panel).toBeVisible();
    // The three facts, each one something a newcomer could otherwise get wrong.
    await expect(panel).toContainText('never the live roster');
    await expect(panel).toContainText('do not pass or fail');
    await expect(panel).toContainText('shared');
    // It is orientation, not news: a "Posted" date invites the reader to decide it is old.
    await expect(panel).not.toContainText('Posted');

    await panel.locator('#linksWelcomeClose').click();
    await expect(panel).not.toBeVisible();

    // …and it is reachable for ever after, which is what stops it being a pop-up nobody can re-open.
    // Driven through the REAL route (v22.83): the way back is a row in the About panel, so the test
    // opens the drawer, taps the brand, and taps the row — the wiring is three hops and each of them
    // has been the thing that broke. It is deliberately not a direct `#linksHowBtn` click: that
    // passed for three releases while the control itself sat in the wrong place.
    await page.locator('#navMenuBtn').click();
    await page.locator('#navPanelBrand').click();
    await expect(page.locator('#iconLightbox')).toBeVisible();
    // The row must be the SAME HEIGHT as the two anchors either side of it (v22.85). It is a <button>
    // among <a>s, and it rendered 2px taller for one release with identical padding, font-size and
    // line-height — the leading glyph was a text character Inter does not carry, and the fallback
    // font's line box is taller. Nothing throws and no axe rule fires; only comparing the boxes sees
    // it. Asserted on the rendered heights so any future glyph, tag or reset change is measured.
    const rowHeights = await page.evaluate(() =>
        [...document.querySelectorAll('#iconLightbox .lightbox-bug-link')]
            .filter(el => !el.hidden)
            .map(el => Math.round(el.getBoundingClientRect().height)));
    expect(rowHeights.length, 'the About panel lists the page rows').toBeGreaterThanOrEqual(2);
    expect(new Set(rowHeights).size, `About rows differ in height: ${rowHeights.join(', ')}px`).toBe(1);
    await page.locator('#linksHowBtn').click();
    // About must CLOSE rather than stack: two open overlays share one Escape, and the buried one
    // gets archived and flagged seen by somebody who never read it.
    await expect(page.locator('#iconLightbox')).not.toBeVisible();
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('never the live roster');
});

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

// A night duty that reached a design by import was offered on the bar as an "early" chip, one tap
// from painting more of them (whole-app review, Oct 2026). CEAs do not work nights, so the bar never
// offers one — the "both directions" relation above holds for every duty a CEA can work.
test('links: a night duty in a design is never offered as a paint chip', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const patterns = /** @type {any} */ ({});
        for (let i = 1; i <= 26; i++) {
            patterns[String(i)] = { sun: 'RD', mon: '06:20-14:20', tue: '06:20-14:20',
                wed: '06:20-14:20', thu: '14:00-22:00', fri: 'RD', sat: 'RD' };
        }
        patterns['3'].fri = '22:00-06:00';
        const w = /** @type {any} */ (window);
        w.__E2E = w.__E2E || {};
        w.__E2E.docs = [{ id: 'd1', name: 'Design A', patterns, updatedAt: 1_750_000_000_000, updatedBy: 'S. Silva' }];
    });
    await page.goto('/links.html');
    await expect(page.locator('#brushBar .brush-chip').first()).toBeVisible();
    await expect(page.locator('#brushBar .brush-chip[data-shift="06:20-14:20"]'), 'an ordinary duty still has its chip').toHaveCount(1);
    await expect(page.locator('#brushBar .brush-chip[data-shift="22:00-06:00"]')).toHaveCount(0);
});

// A CUSTOM paint time is usually not on the bar (links-app-6): arming it lit nothing, so the next cell
// tapped was PAINTED where the designer meant to open it. And a refused time — no colon, a night start,
// a finish past midnight — closed the prompt exactly as Cancel did (links-app-7), in the paint bar and
// in the cell sheet alike, so a refusal could not be told from a slip.
test('links: a Custom… time gets its own lit chip, and a refused one says why', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.setViewportSize({ width: 1280, height: 900 });
    await openLinks(page);
    const status = page.locator('#linksSaveStatus');
    const custom = async (/** @type {string} */ typed) => {
        await page.locator('.dialog-overlay .dialog-input').fill(typed);
        await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');
        await expect(page.locator('.dialog-overlay')).toHaveCount(0);
    };

    await page.locator('#brushBar .brush-chip--custom').click();
    await custom('05:00-13:00');
    const chip = page.locator('#brushBar .brush-chip[data-shift="05:00-13:00"]');
    await expect(chip, 'armed AND shown armed').toHaveAttribute('aria-pressed', 'true');
    await expect(chip, 'focus is not dropped with the Custom… button the bar replaced').toBeFocused();
    await expect(status).toHaveText('');

    await page.locator('#brushBar .brush-chip--custom').click();
    await custom('22:00-06:00');
    await expect(status).toContainText('“22:00-06:00” wasn’t used');
    await expect(status).toContainText('04:00 and 20:59');
    await expect(chip, 'a refusal leaves the armed brush as it was').toHaveAttribute('aria-pressed', 'true');

    // The cell sheet's Custom… holds the same standard; Cancel stays silent.
    await page.keyboard.press('Escape');   // disarm, so a cell tap opens its sheet
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await page.evaluate(() => { const s = document.getElementById('linksSaveStatus'); if (s) s.textContent = ''; });
    await page.locator('tr[data-pos="2"] .shift-cell-btn').first().click();
    await page.locator('.picker-opt[data-value="__custom__"]').click();
    await custom('1400-2230');
    await expect(status).toContainText('“1400-2230” wasn’t used');
    await expect(page.locator('tr[data-pos="2"] .shift-cell-btn').first(), 'nothing applied').toHaveText('RD');
    await page.evaluate(() => { const s = document.getElementById('linksSaveStatus'); if (s) s.textContent = ''; });
    await page.locator('tr[data-pos="2"] .shift-cell-btn').first().click();
    await page.locator('.picker-opt[data-value="__custom__"]').click();
    await page.locator('.dialog-overlay .dialog-btn-cancel').click();
    await expect(page.locator('.dialog-overlay')).toHaveCount(0);
    await expect(status, 'a cancel explains nothing').toHaveText('');
    await page.locator('tr[data-pos="2"] .shift-cell-btn').first().click();
    await page.locator('.picker-opt[data-value="__custom__"]').click();
    await custom('');   // Set with nothing typed — the same as a cancel
    await expect(status, 'an empty Set explains nothing').toHaveText('');
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

// ── A CARD THAT FITS A SHEET MUST NOT STRADDLE TWO (v22.75) ──────────────────────────────────────
//
// Found by generating a real A4 landscape PDF, which is the only way to see it: on screen the page
// is one continuous column and nothing is wrong. The coverage card is 635px against 718px of
// printable height and was breaking anyway — the hour header and the SUNDAY row printed at the foot
// of the grid's sheet with MON–SAT overleaf, so a reader comparing days had Sunday on a different
// piece of paper. The checks card's triage block split between its heading and its own list, landing
// "4 definitions still to confirm" alone at the top of a sheet.
//
// Asserted through the CASCADE under print media rather than by scanning the stylesheet for the
// declaration: the failure this guards is the rule being overridden or dropped, and a source scan
// answers a different question. `emulateMedia` is what makes the print branch reachable at all.
test('links: the coverage card and the triage block are not split across printed sheets', async ({ page }) => {
    await openLinksWithDesign(page);
    await page.emulateMedia({ media: 'print' });
    const got = await page.evaluate(() => {
        const v = sel => { const el = document.querySelector(sel); if (!el) return 'MISSING';
            const c = getComputedStyle(el); return c.breakInside || c.pageBreakInside; };
        return { coverage: v('#coverageCard'), triage: v('.check-triage') };
    });
    expect(got.coverage, 'the coverage heat map may not break between its days').toBe('avoid');
    expect(got.triage, 'the triage heading may not be separated from its own list').toBe('avoid');
    // The grid card deliberately does NOT carry this — it is the sheet the masthead belongs to and
    // the whole rotation has to land on ONE sheet, which a rule that could push it to page 2 works
    // against. Pinned so the print fix above is not "helpfully" widened to it.
    const grid = await page.evaluate(() => {
        const c = getComputedStyle(document.querySelector('#linksGridCard'));
        return c.breakInside || c.pageBreakInside; });
    expect(grid, 'the grid card must stay free to start page 1 at the top').not.toBe('avoid');
    await page.emulateMedia({ media: 'screen' });
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
    // The heading counts clear and not applicable APART (whole-app review, Nov 2026: NOT-APPLICABLE
    // is not CLEAR), and the disclosure holds both, so its label is their sum.
    const meta = await page.locator('.check-section-head:has-text("Fatigue factors") .check-section-meta').textContent();
    const clear = Number((meta.match(/(\d+) clear/) || [])[1]);
    const notApplicable = Number((meta.match(/(\d+) not applicable/) || [])[1] ?? 0);
    const label = await page.locator('.check-quiet-label').textContent();
    expect(Number((label.match(/^(\d+)/) || [])[1]),
        'the heading counts and the disclosure label must describe the same set').toBe(clear + notApplicable);

    await page.locator('.check-quiet-summary').click();
    await expect.poll(() => rows.count()).toBeGreaterThan(collapsed);
});

// TODAY'S LINK, FOR COMPARISON (links-app-20). The sentence quotes two ORR factors' thresholds and used
// to TYPE them — "against FF11's 13", "against FF15's 4" — so a moved rule would have gone on being quoted
// at its old figure, beside a row stating the new one. Each figure is now read from that factor's own
// result: this test moves both thresholds in the served links-fatigue.js and reads the sentence. And the
// comparison is measured ONCE. It describes today's roster, a constant for the session, and was measured
// again on every paint for the same answer. It is the one call made at a length other than the design's
// own, so those calls are counted across three edits.
test('links: today\'s link quotes each factor\'s own threshold, and is measured once', async ({ page }) => {
    const EDITS = /** @type {[string, string][]} */ ([
        ["status: ff11 > 13 ? 'present' : 'clear', value: ff11, threshold: 13,",
            "status: ff11 > 13 ? 'present' : 'clear', value: ff11, threshold: 12,"],
        ["status: ff15 > 4 ? 'present' : 'clear', value: ff15, threshold: 4,",
            "status: ff15 > 4 ? 'present' : 'clear', value: ff15, threshold: 3,"],
        ['export function assessFatigue(patterns, lines = ROTATING_LINES) {',
            'export function assessFatigue(patterns, lines = ROTATING_LINES) {\n'
            + '    if (lines !== ROTATING_LINES) { const w = /** @type {any} */ (globalThis); w.__todayMeasured = (w.__todayMeasured || 0) + 1; }'],
    ]);
    // A missing anchor THROWS: a silent no-op would leave a green test that had stopped testing anything.
    await page.route('**/links-fatigue.js', async route => {
        const res = await route.fetch();
        let src = await res.text();
        for (const [from, to] of EDITS) {
            if (!src.includes(from)) throw new Error(`links: links-fatigue.js no longer contains "${from}" — re-point the test.`);
            src = src.replace(from, to);
        }
        await route.fulfill({ response: res, body: src, contentType: 'text/javascript' });
    });
    await openLinksWithDesign(page);
    const today = page.locator('#checksContent .check-row', { hasText: 'Today\'s link already features' });
    await expect(today, 'FF11 is quoted at its own threshold').toContainText('against FF11\'s 12.');
    await expect(today, '…and FF15 at its own').toContainText('against FF15\'s 3.');

    // Three edits, each one repainting the checks card.
    await page.locator('#brushBar .brush-chip[data-shift="06:20-14:20"]').click();
    for (const day of ['sun', 'fri', 'sat']) await gridCell(page, 1, day).click();
    await expect(page.locator('#linksSaveBtn')).toBeEnabled();
    await expect(today).toContainText('against FF11\'s 12.');
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__todayMeasured),
        'today\'s link is measured once for the session, not on every paint').toBe(1);
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
        await linksOpened(page);   // was a 600ms sleep (test audit, 7 Nov 2026) — see the helper
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

// THE LINE-ORDER NOTE STATES THE MINIMUM REST FROM THE CONSTANT (links-analysis-14's twin, routed here).
// The note is load-bearing copy — it names the two things no switch turns off — and it TYPED "12 hours".
// Both are 12 today, so the served links-design.js has the minimum moved, and the note must follow it.
test('links: the line-order note states the minimum rest the generator applies, not a typed figure', async ({ page }) => {
    const ANCHOR = 'export const MIN_REST_MINUTES = 12 * 60;';
    await page.route('**/links-design.js', async route => {
        const res = await route.fetch();
        const src = await res.text();
        if (!src.includes(ANCHOR)) throw new Error(`links: links-design.js no longer contains "${ANCHOR}" — re-point the test.`);
        await route.fulfill({ response: res, body: src.replace(ANCHOR, 'export const MIN_REST_MINUTES = 11 * 60;'), contentType: 'text/javascript' });
    });
    await openLinksWithDesign(page);
    await expect(page.locator('.gen-obj-note')).toContainText('no order is used that leaves less than 11 hours between a Saturday finish');
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
    await linksOpened(page);   // was a 600ms sleep (test audit, 7 Nov 2026) — see the helper
    await page.evaluate(() => { document.getElementById('generatorBody')?.classList.add('open'); });
    // Every switch, read from the page's own checkboxes rather than hardcoded — a new objective added without a
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

// ── TWO WAYS TO SAY NO (v23.33) ────────────────────────────────────────────────────────────────
// The masthead's own suite pins both rules against a fake DOM. What only a browser answers is the
// WIRING, and in both cases the wiring was the defect: the module could disable the sheet's Rename
// row for a year and never be handed it, and `render` could re-point the select perfectly while
// nothing called it on the path that needed it. Both shipped at v23.30 and both are silent.
test('links: an unsaved design disables Rename in BOTH places it is offered', async ({ page }) => {
    // A design straight out of the generator has no Firestore document yet, so it cannot be
    // renamed — that is the state, and it is where a designer meets this card most often.
    await seedContractTargets(page);
    await page.setViewportSize({ width: 1024, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => localStorage.setItem('myb_links_welcome_seen', '1'));
    await page.goto('/links.html');
    await expect(page.locator('#generatorToggleHeader')).toBeVisible();
    await page.locator('#genApplyBtn').click();
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');
    await expect(page.locator('#designStatusLong')).toHaveText(/Not saved/);
    await expect(page.locator('#designRenameBtn')).toBeDisabled();          // the pencil
    await openDesignSheet(page);
    await expect(page.locator('#designRenameMenuBtn')).toBeDisabled();      // and the sheet's row
});

test('links: declining an unsaved-changes switch leaves the picker on the design still open', async ({ page }) => {
    await openLinksWithDesigns(page);
    await switchToDesign(page, 'Design A');
    await expect(activeDesignName(page)).toHaveText('Design A');

    // Make it dirty through the generator, the one route that reliably edits an open design.
    await page.locator('#generatorToggleHeader').click();
    await page.locator('#genApplyBtn').click({ force: true });
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');
    await expect(page.locator('#designStatusLong')).toHaveText(/Unsaved/);

    // Pick the other design, then decline the warning.
    await switchToDesign(page, 'Design B');
    const dialog = page.locator('.dialog-overlay').last();
    await expect(dialog).toContainText('unsaved changes');
    await dialog.locator('.dialog-btn-cancel').click();
    await expect(page.locator('.dialog-overlay')).toHaveCount(0);

    // The heading was always right; the SELECT is what pointed at a design nobody opened (v23.33).
    // At v23.35 the select is gone — the picker is a sheet that holds no value — so the assertion
    // moved to the two things a reader can actually see: the face, and which row wears the tick.
    // Re-opening the sheet is the point: a cached selection would show up here and nowhere else.
    await expect(activeDesignName(page)).toHaveText('Design A');
    await openDesignPicker(page);
    const current = page.locator('#designPickList .picker-opt[aria-current="true"]');
    await expect(current).toHaveCount(1);
    await expect(current, 'the picker must name the design that is actually open').toContainText('Design A');
    await page.locator('#designPickerClose').click();
});

// The drawer released this device's push record BEFORE Links asked about unsaved work, so a member
// who chose to stay was still signed in on a device that no longer received their notices. The
// confirm now comes first; the resave throttle is the synchronous first thing a release clears.
test('links: cancelling "Sign out anyway?" keeps the session AND this device\'s push record', async ({ page }) => {
    await openLinksWithDesigns(page);
    await switchToDesign(page, 'Design A');
    await page.evaluate(() => localStorage.setItem('myb_push_resave_at', '12345'));
    await page.locator('#generatorToggleHeader').click();
    await page.locator('#genApplyBtn').click({ force: true });
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');
    await expect(page.locator('#designStatusLong')).toHaveText(/Unsaved/);

    await page.locator('#navMenuBtn').click();
    await page.locator('#navSignOutBtn').click();
    const dialog = page.locator('.dialog-overlay').last();
    await expect(dialog).toContainText('Sign out anyway?');
    await dialog.locator('.dialog-btn-cancel').click();
    await expect(page.locator('.dialog-overlay')).toHaveCount(0);
    await expect(page).toHaveURL(/links\.html/);
    expect(await page.evaluate(() => localStorage.getItem('myb_push_resave_at')),
        'a sign-out the member declined must not have released the push record').toBe('12345');
});

test('links: deleting a design writes a SOFT delete and leaves the document in place', async ({ page }) => {
    await openLinksWithDesigns(page);
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.setWrites = []; });

    // ✕ appears on the ACTIVE chip only.
    await sheetAction(page, 'designDeleteBtn');
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');
    await expect(designOptions(page)).toHaveCount(1);

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
    await openDesignSheet(page);
    await expect(page.locator('#designBinBtn')).toBeVisible();
    await expect(page.locator('#designBinBtn')).toHaveText(/Recently deleted \(1\)/);
});

// A RENAME OR A DELETE THAT FINDS THE DESIGN ALREADY GONE (links-design-5, and the delete's twin). The
// store now asks, inside its transaction, whether the design is still live; the page says what it found.
// A rename used to say "check your connection and try again", which no retry could answer; a delete
// filed the design in Recently deleted as OURS when a colleague had binned it, or filed a row for a
// design already removed for good. The server's view is `txDocs`: both designs binned, or both gone.
/** @param {import('@playwright/test').Page} page @param {'binned'|'gone'} how */
async function serverAlready(page, how) {
    await page.evaluate((h) => {
        const w = /** @type {any} */ (window);
        w.__E2E.txDocs = h === 'gone' ? []
            : w.__E2E.docs.map((/** @type {any} */ d) => ({ ...d, deletedAt: 1760000000000, deletedBy: 'S. Silva' }));
        w.__E2E.setWrites = [];
    }, how);
}
/** @param {import('@playwright/test').Page} page */
async function renameOpenDesignTo(page, name) {
    await sheetAction(page, 'designRenameMenuBtn');
    await page.locator('.dialog-overlay .dialog-input').fill(name);
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');
}

test('links: renaming a design a colleague deleted says so, and files it as THEIR delete', async ({ page }) => {
    await openLinksWithDesigns(page);
    const open = String(await activeDesignName(page).textContent());
    await serverAlready(page, 'binned');
    await renameOpenDesignTo(page, 'Renamed');
    const status = page.locator('#linksSaveStatus');
    await expect(status).toHaveText(`“${open}” was not renamed — S. Silva deleted it while it was open here. It is in Recently deleted.`);
    await expect(designOptions(page), 'out of the live list').toHaveCount(1);
    await sheetAction(page, 'designBinBtn');
    await expect(page.locator('#designBinList .bin-row')).toHaveCount(1);
    await expect(page.locator('#designBinList .bin-row')).toContainText(open);
    await expect(page.locator('.bin-row-meta').first()).toHaveText(/by S\. Silva/);
});

test('links: renaming a design removed for good says so, with nothing in the bin', async ({ page }) => {
    await openLinksWithDesigns(page);
    const open = String(await activeDesignName(page).textContent());
    await serverAlready(page, 'gone');
    await renameOpenDesignTo(page, 'Renamed');
    await expect(page.locator('#linksSaveStatus')).toHaveText(`“${open}” was not renamed — it was removed for good while it was open here.`);
    await expect(designOptions(page)).toHaveCount(1);
    await openDesignSheet(page);
    await expect(page.locator('#designBinBtn'), 'no bin row for a design that is gone').toBeHidden();
    expect(await page.evaluate(() => /** @type {any} */ (window).__E2E.setWrites), 'and nothing written').toEqual([]);
});

test('links: deleting a design a colleague already binned files THEIR delete, and says so', async ({ page }) => {
    await openLinksWithDesigns(page);
    const open = String(await activeDesignName(page).textContent());
    await serverAlready(page, 'binned');
    await sheetAction(page, 'designDeleteBtn');
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');
    await expect(page.locator('#linksSaveStatus')).toHaveText(`“${open}” is in Recently deleted — S. Silva had already deleted it.`);
    expect(await page.evaluate(() => /** @type {any} */ (window).__E2E.setWrites), 'nothing written over their delete').toEqual([]);
    await sheetAction(page, 'designBinBtn');
    await expect(page.locator('#designBinList .bin-row')).toHaveCount(1);
    await expect(page.locator('.bin-row-meta').first(), 'their delete, not one signed as ours').toHaveText(/by S\. Silva/);
});

test('links: deleting a design already removed for good adds no bin row, and says so', async ({ page }) => {
    await openLinksWithDesigns(page);
    const open = String(await activeDesignName(page).textContent());
    await serverAlready(page, 'gone');
    await sheetAction(page, 'designDeleteBtn');
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');
    await expect(page.locator('#linksSaveStatus')).toHaveText(`“${open}” had already been removed for good.`);
    await expect(designOptions(page)).toHaveCount(1);
    await openDesignSheet(page);
    await expect(page.locator('#designBinBtn'), 'no phantom row').toBeHidden();
});

test('links: a pasted design is checked before it can be saved, and saved as a NEW design', async ({ page }) => {
    // The RULES are unit-tested in links-import.test.mjs. What only a browser answers is the WIRING
    // of the two-step: that Save is unreachable until a check has passed, that a later edit takes it
    // away again, and — the one that matters — that what reaches Firestore is the parsed grid rather
    // than a summary line claiming it was.
    await openLinksWithDesigns(page);
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.setWrites = []; });
    await sheetAction(page, 'importDesignBtn');

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
    await page.locator('#linksImportCheck').click();

    // …BUT EDITING THE NAME DOES NOT (v22.62, external review P2). Nothing about the parse depends
    // on it — `saveImport` reads the field fresh — and this is the COMMON path, because the check
    // pre-fills the name from the paste and the reader then makes it their own. It used to discard
    // the parse and take Save away, and the block above could not see it: it filled the name BEFORE
    // checking, which is the one order in which the bug does not fire.
    await expect(page.locator('#linksImportSave')).toBeVisible();
    await page.locator('#linksImportName').fill('Martine — 2A / 2B');
    await expect(page.locator('#linksImportSave')).toBeVisible();
    await page.locator('#linksImportSave').click();

    // A THIRD design — the import never touches the one that was open.
    await expect(designOptions(page)).toHaveCount(3);
    await expect(activeDesignName(page)).toContainText('Martine');

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
    await sheetAction(page, 'designDeleteBtn');
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');
    await expect(designOptions(page)).toHaveCount(1);

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
    await sheetAction(page, 'designBinBtn');
    await expect(page.locator('#designBinList .bin-row')).toHaveCount(1);
    await page.locator('.bin-restore').click();

    await expect(designOptions(page)).toHaveCount(2);
    await expect(page.locator('#designBinList .bin-empty')).toBeVisible();
    // By NAME, not by count: a restore that resurrects an empty document would still make the
    // chip count go back to two.
    await expect(designOptions(page).filter({ hasText: 'Design A' })).toHaveCount(1);
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
    await openDesignSheet(page);
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
    await expect(designOptions(page)).toHaveCount(1);
    // BOTH deletions survive — the 40-day-old one as much as the 2-day-old one.
    await openDesignSheet(page);
    await expect(page.locator('#designBinBtn')).toHaveText(/Recently deleted \(2\)/);

    // The assertion that matters: load destroyed nothing. It is a negative, so it has to have had
    // the chance to happen — the bin count above is only rendered after the load settles.
    const deletes = await page.evaluate(() => /** @type {any} */ (window).__E2E.deletedPaths || []);
    expect(deletes, 'load must never permanently delete anything').toEqual([]);

    await page.locator('#designBinBtn').click();   // the sheet is already open from the count above
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
    await expect(designOptions(page)).toHaveCount(1);
    // The stale row still SHOWS in the bin — this device believes it was deleted, and correcting
    // that belief is a refresh problem, not a reason to destroy anything. Waiting on the button
    // also gives any (suspended) purge the chance to have run before the negative below is read.
    await openDesignSheet(page);
    await expect(page.locator('#designBinBtn')).toHaveText(/Recently deleted \(1\)/);
    const deletes = await page.evaluate(() => /** @type {any} */ (window).__E2E.deletedPaths || []);
    expect(deletes, 'a design the server says is live must never be destroyed by a load').toEqual([]);
});

// Zero live designs with a full bin is the state where restore matters most, and it is an ordinary
// one: the last saved design can be deleted (links-app-23), and Keep only the shortlist empties the
// list on purpose. The bin button lives inside the picker strip, so if that strip is keyed on live
// designs alone the only way back is invisible.
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
    await expect(designOptions(page)).toHaveCount(0);
    await openDesignSheet(page);
    await expect(page.locator('#designBinBtn')).toBeVisible();
    await page.locator('#designBinBtn').click();
    await expect(page.locator('.bin-row-name')).toHaveText('Only design');
    await page.locator('.bin-restore').click();
    await expect(activeDesignName(page)).toHaveText('Only design');
});

// THE LAST SAVED DESIGN CAN BE DELETED (links-app-23, the lead's decided default). Its row was greyed
// with no reason given, for a rule whose reason — an empty picker and a "no designs yet" page — no
// longer held: the picker always carries the shortlisted proposals, and Keep only the shortlist empties
// the saved list on purpose. Deleting the last one now does what that does: the first proposal opens.
test('links: the only saved design can be deleted — it goes to the bin and a proposal opens', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.docs = [{ id: 'd1', name: 'Only design', patterns: {}, updatedAt: 1_750_000_000_000, updatedBy: 'S. Silva' }];
    });
    await page.goto('/links.html');
    await expect(designOptions(page)).toHaveCount(1);
    await expect(page.locator('#designDeleteBtn'), 'the row is live').toBeEnabled();
    await sheetAction(page, 'designDeleteBtn');
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');
    await expect(page.locator('#linksSaveStatus')).toHaveText('“Only design” is in Recently deleted. No saved design is left, so a shortlisted proposal is open.');
    await expect(designOptions(page)).toHaveCount(0);
    await expect(activeDesignName(page)).toHaveText(PROPOSALS[0].name);
    await expect(page.locator('#designEyebrow')).toHaveText('Shortlisted proposal');
    await sheetAction(page, 'designBinBtn');
    await expect(page.locator('#designBinList .bin-row')).toHaveCount(1);
    await page.locator('.bin-restore').click();
    await expect(designOptions(page), 'and it comes back from the bin').toHaveCount(1);
    await expect(designOptions(page).first()).toContainText('Only design');
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
    await expect(designOptions(page)).toHaveCount(2);

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

// A SAVE WHOSE READ-BACK COMES BACK EMPTY STILL MOVES THE MASTHEAD'S TIME (Sep 2026 polish).
// Every queued offline save, and any save whose post-write read fails, returns no server stamp. The
// pill read only the stamp, so it went on saying the PREVIOUS save's date while the save row beside
// it said the new time — two save times on one screen. `recordSave` now records a display-only
// `savedAt` (the server stamp stays the concurrency baseline) and both surfaces read `lastSaveTime`.
// The unit tests pin the rule; this pins the WIRING — that `landed` records it and the header reads it.
test('links: after a save with no server stamp, the masthead and the save row show the same new time', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-07-15T09:00:00Z'));
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window);
        w.__E2E = w.__E2E || {};
        w.__E2E.docs = [{
            id: 'd1', name: 'Option A', updatedBy: 'S. Silva', revision: 1,
            updatedAt: Date.parse('2026-06-24T16:40:00Z'),   // an old save — a different DAY
            // Line 26 is drawn: a pre-October design drawn only on lines 1–24 is binned on load.
            patterns: { '1': { sun: 'RD', mon: '06:20-14:20', tue: '14:00-22:00', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' },
                        '26': { sun: 'RD', mon: 'RD', tue: 'RD', wed: '06:20-14:20', thu: 'RD', fri: 'RD', sat: 'RD' } },
        }];
    });
    await page.goto('/links.html');
    await expect(page.locator('#linksGridBodyRows tr')).toHaveCount(ROTATING_LINES);
    await expect(page.locator('#designStatusLong')).toHaveText(/^Saved 24 Jun at /);

    // Every single-document read now fails, so the post-save read-back returns no stamp.
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.failGetDoc = true; });
    await page.locator('#brushBar .brush-chip.type-early').first().click();
    await page.locator('tr[data-pos="2"] .shift-cell-btn').nth(1).click();
    await page.locator('#linksSaveBtnTop').click();
    await expect(page.locator('#linksSaveStatus')).toContainText('Saved');

    const pill = page.locator('#designStatusLong');
    await expect(pill, 'the pill must not keep the previous save’s date').toHaveText(/^Saved today at \d\d:\d\d$/);
    const pillTime = (await pill.textContent())?.match(/\d\d:\d\d/)?.[0];
    await expect(page.locator('#linksLastSaved')).toHaveText(`Last saved by G. Miller at ${pillTime}`);
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
        //
        // AND EVERY TAP NOW REACHES A CELL (desktop audit, Nov 2026). An edit used to REPLACE the
        // cell's button, so the buttons held below went dead after their first paint, and 13 of the
        // 20 taps clicked a button no longer in the page: this read ~3ms on seven paints and thirteen
        // nothings. A cell is repainted in place now, so all 20 paint, and the figure is the real one.
        // Best of three rounds: one round is at the mercy of whatever else the machine is running
        // (a second browser worker, measured at 2–3× here), which a device in a designer's hand is not.
        const chips = Array.from(document.querySelectorAll('#brushBar .brush-chip.type-early, #brushBar .brush-chip.type-late'));
        const btns  = Array.from(document.querySelectorAll('tr[data-pos="3"] .shift-cell-btn'));
        const rounds = [];
        for (let round = 0; round < 3; round++) {
            const t0 = performance.now();
            for (let i = 0; i < 20; i++) {
                /** @type {HTMLElement} */ (chips[i % 2]).click();          // re-arm (alternating value)
                /** @type {HTMLElement} */ (btns[i % btns.length]).click(); // paint
            }
            rounds.push((performance.now() - t0) / 20);
        }
        if (!btns.every(b => b.isConnected)) throw new Error('a tap reached a button no longer in the grid');
        return Math.min(...rounds);
    });
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
    // Was a 700ms sleep (test audit, 7 Nov 2026). The design list's arrival is also what restores
    // the remembered table (`refreshGenTargetsForDesign`), so a check before it reads the default.
    await linksOpened(page);
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

// A SPARE COUNT THAT LEAVES NO WORKING LINE is refused by name, and only a STORED table can carry one.
// Typing is clamped to the box's max, one line short of the rotation, so the refusal is reached from a
// remembered table (or a saved setup) with every row at 0 — any other count trips the over-capacity
// check first. The comment beside the message said it was "reachable by typing".
test('links memory: a remembered spare count that leaves no working line is refused by name, and typing cannot reach it', async ({ page }) => {
    await openLinksWithMemory(page, { slots: [{ time: '06:20-14:20', weekday: 0, sat: 0, sun: 0 }], spareLines: ROTATING_LINES });
    const error = page.locator('#genError');
    await page.locator('#genApplyBtn').click();
    await expect(error).toContainText(`${ROTATING_LINES} spare weeks leaves no working lines`);

    const box = page.locator('#genSpareLines');
    await box.fill(String(ROTATING_LINES));
    await box.dispatchEvent('input');
    await page.locator('#genApplyBtn').click();
    await expect(error, 'a typed count is clamped short of it').toContainText('Can\'t generate');
    await expect(error).not.toContainText('leaves no working lines');
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
    // M. Robson is not a designer on the real list since 9 Nov 2026 (the owner alone), so this seat is given one of its own.
    await withLinksDesigners(page, ['G. Miller', 'M. Robson']);
    await seedSession(page, 'M. Robson');
    await page.addInitScript((rows) => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window);
        w.__E2E = w.__E2E || {};
        w.__E2E.docsByPath = { linkTargetSets: rows };   // designs read falls back to (unset) docs
    }, TARGET_SET_ROWS);
    await page.goto('/links.html');
    await linksOpened(page);   // was a 700ms sleep (test audit, 7 Nov 2026) — see the helper
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
    await expect(page.locator('#genSpareLines')).toHaveValue('5');        // the shipped default — five cover weeks on 26 lines
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
    expect(written.spareLines).toBe(5);             // the untouched default table is what was saved
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
    await linksOpened(page);   // was a 700ms sleep (test audit, 7 Nov 2026) — see the helper
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
    await expect(page.locator('#genSetHint')).toContainText('Press Use setup');

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
    // The open design has work on it, so Apply ALWAYS asks. Wait for the question, never count it:
    // a count taken before the dialog existed skipped the confirm, the generator never ran, and the
    // reads below measured the old design (WebKit's slower dialog showed it — 48-hour review).
    await expect(page.locator('.dialog-overlay .dialog-btn-confirm')).toBeVisible();
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');
    // The generator's own completion signal, not the row count: the design open before it already
    // had every row, so the count was true BEFORE the generator ran, and the reads below could land
    // on the old design or mid-redraw (48-hour review, Nov 2026 — one intermittent red under load).
    await expect(page.locator('#genStatus')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#linksGridBodyRows tr')).toHaveCount(ROTATING_LINES);

    // Three cells on every line, no exceptions — the renderer indexes rows by position, so a short
    // list would silently shift every total one line up.
    await expect(page.locator('#linksGridBodyRows .tot-cell')).toHaveCount(ROTATING_LINES * 3);

    const row1 = page.locator('#linksGridBodyRows tr').first();
    const before = await row1.locator('.tot-cell').first().textContent();

    // The footer average must be the SAME figure the summary strip states. Two places computing a
    // design's hours separately is how they end up disagreeing; the footer reads `weeklyHours`,
    // which is what the strip and the Design-checks row already read. Both are re-read on every
    // poll, so the assertion is agreement — never a figure captured at one moment and chased.
    await expect.poll(async () => {
        const avg = String(await page.locator('#linksCoverageFoot .tot-avg-num').first().textContent()).trim();
        return avg !== '' && avg !== '—' && String(await page.locator('#linksSummary').textContent()).includes(avg);
    }, { message: 'the footer average appears in the summary strip' }).toBe(true);

    // Paint a rest day over line 1's Monday: its Mon–Sat total must fall.
    await clickInView(page.locator('#brushBar button', { hasText: 'RD' }).first());
    await clickInView(row1.locator('.shift-cell-btn').nth(1));
    await expect.poll(() => row1.locator('.tot-cell').first().textContent()).not.toBe(before);
});

test('links grid: a cover week with Sunday overtime counts that Sunday in its seven-day total', async ({ page }) => {
    // 48-hour review, Nov 2026. Since v25.03 a cover week's Sunday overtime is real hours on top of
    // its contracted week, and the footer average counts it — but the row printed the contracted week
    // in BOTH hour columns, so a line and the footer beneath it disagreed.
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const patterns = /** @type {any} */ ({});
        for (let i = 1; i <= 26; i++) {   // ROTATING_LINES, written out: this runs inside the page
            patterns[String(i)] = { sun: 'RD', mon: '06:20-14:20', tue: '06:20-14:20',
                wed: '06:20-14:20', thu: '14:00-22:00', fri: 'RD', sat: 'RD' };
        }
        patterns['1'] = { sun: '07:15-15:45', mon: 'SPARE', tue: 'SPARE', wed: 'SPARE',
            thu: 'SPARE', fri: 'SPARE', sat: 'SPARE' };
        const w = /** @type {any} */ (window);
        w.__E2E = w.__E2E || {};
        w.__E2E.docs = [{ id: 'd1', name: 'Design A', patterns,
            updatedAt: 1_750_000_000_000, updatedBy: 'S. Silva' }];
    });
    await page.goto('/links.html');
    const cells = page.locator('#linksGridBodyRows tr').first().locator('.tot-cell');
    await expect(cells).toHaveCount(3);
    await expect(cells.nth(0), 'Monday to Saturday: the contracted week').toHaveText('35h 00m');
    await expect(cells.nth(1), 'all seven days: the week plus its 8½-hour Sunday').toHaveText('43h 30m');
    // The explanation is ADDED to the figure, never put in its place (links-app-15): an author's name for
    // a cell replaces its content, so a reason alone hid the total from a screen reader.
    await expect(cells.nth(0)).toHaveAccessibleName('35h 00m. Cover week — counted as the contracted week; it carries no stored times');
    await expect(cells.nth(2)).toHaveAccessibleName('Not known. A cover week does not record which days it works');
});

// Two controls a screen reader met with no name, and a sheet that opened with focus left behind it
// (whole-app fix, Nov 2026). Each number box sits inside its tick box's <label>, which names only its
// FIRST control (links-app-14); the paint bar's label sat on a div with no role, where it names nothing
// (links-app-16); and ··· More asked to focus Save a copy as…, which is disabled on a proposal and on a
// design not yet saved, so focus stayed on the ··· button behind the dialog (links-app-17).
test('links: the line-order boxes and the paint bar are named, and ··· More opens on a row it can use', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.setViewportSize({ width: 1280, height: 900 });
    await openLinks(page);
    await page.locator('#generatorToggleHeader').click();
    await expect(page.locator('#objBlockTarget')).toHaveAccessibleName('Vary the shift type: at most this many weeks in a row');
    await expect(page.locator('#objMaxRunTarget')).toHaveAccessibleName('Most shifts in a row: at most this many days');
    await expect(page.locator('#objLongTarget')).toHaveAccessibleName('Long weekends: at least this many across the rotation');
    await expect(page.getByRole('group', { name: 'Paint mode: select a shift to paint cells' })).toBeVisible();

    // A shortlisted proposal open: Save a copy as… and Rename are disabled, and focus lands on a row it can use.
    await openDesignPicker(page);
    await proposalOptions(page).first().click();
    await expect(page.locator('#designEyebrow')).toHaveText('Shortlisted proposal');
    await page.locator('#designMoreBtn').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#designMoreLb.visible')).toBeVisible();
    await expect(page.locator('#dupDesignBtn')).toBeDisabled();
    const focused = page.locator('#designMoreContent .dm-menu-btn:focus');
    await expect(focused, 'focus is on a row of the sheet, not behind it').toHaveCount(1);
    await expect(focused).toBeEnabled();
});

// ── THE GRID ON A DESKTOP, BY MOUSE AND BY KEYBOARD (desktop audit, Nov 2026) ────────────────────
// A design with several kinds of cell on every line, so the row under test always carries more than
// one colour. Built here, where ROTATING_LINES can be imported, and handed to the page whole.
const MIXED_DESIGN = (() => {
    /** @type {Record<string, Record<string, string>>} */ const patterns = {};
    const cycle = ['06:20-14:20', '07:00-15:00', '11:00-19:30', '14:00-22:30', 'SPARE', 'RD', 'RD'];
    for (let i = 1; i <= ROTATING_LINES; i++) {
        /** @type {Record<string, string>} */ const row = {};
        ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].forEach((d, j) => {
            row[d] = (i % 4 === 0 && (j === 0 || j === 6)) ? 'RD' : cycle[(i + j) % cycle.length];
        });
        patterns[String(i)] = row;
    }
    return patterns;
})();

/** Open Links on MIXED_DESIGN at a desktop size. @param {import('@playwright/test').Page} page */
async function openMixedDesign(page, size = { width: 1366, height: 768 }) {
    await page.setViewportSize(size);
    await seedSession(page, 'G. Miller');
    await page.addInitScript(pats => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.docs = [{ id: 'd1', name: 'Option A', updatedBy: 'S. Silva', updatedAt: 1_750_000_000_000, patterns: pats }];
    }, MIXED_DESIGN);
    await page.goto('/links.html');
    await expect(page.locator('#linksGridBodyRows tr')).toHaveCount(ROTATING_LINES);
    await linksOpened(page);
}
/** Scroll line `pos` to the middle of the screen, clear of the sticky bar above and the save row below.
 *  @param {import('@playwright/test').Page} page @param {number} pos */
const centreLine = (page, pos) => page.evaluate(p => {
    const r = /** @type {Element} */ (document.querySelector(`#linksGridBodyRows tr[data-pos="${p}"]`));
    window.scrollBy(0, r.getBoundingClientRect().top - innerHeight / 2);
}, pos);
/** @param {import('@playwright/test').Page} page @param {number} pos @param {string} day */
const gridCell = (page, pos, day) => page.locator(`#linksGridBodyRows .shift-cell-btn[data-pos="${pos}"][data-day="${day}"]`);
/** Which grid cell holds focus, as "line/day" — or the tag of whatever else does. @param {import('@playwright/test').Page} page */
const focusedCell = page => page.evaluate(() => {
    const a = /** @type {HTMLElement|null} */ (document.activeElement);
    return a?.classList.contains('shift-cell-btn') && a.isConnected ? `${a.dataset.pos}/${a.dataset.day}` : String(a?.tagName);
});

test('links grid: the row under the pointer keeps its shift colours, and its ends and the cell are marked', async ({ page }, info) => {
    // Hovering a row turned every cell in it TRANSPARENT to tint the row, so the line you pointed at
    // lost the colours it is read by — and a cell painted with the mouse showed no colour at all until
    // the pointer left it. Only a fine pointer hovers.
    test.skip(isTouchProject(info), 'hover is a fine-pointer surface');
    await openMixedDesign(page);
    const row = page.locator('#linksGridBodyRows tr[data-pos="5"]');
    const read = () => row.evaluate(tr => ({
        fills: [...tr.querySelectorAll('.shift-cell-btn')].map(b => getComputedStyle(b).backgroundColor),
        rings: [...tr.querySelectorAll('.shift-cell-btn')].map(b => getComputedStyle(b).boxShadow),
        num: getComputedStyle(/** @type {Element} */ (tr.querySelector('.pos-num'))).backgroundColor,
        total: getComputedStyle(/** @type {Element} */ (tr.querySelector('.tot-cell'))).backgroundColor,
    }));
    await centreLine(page, 5);
    await page.mouse.move(1, 1);
    const before = await read();
    await gridCell(page, 5, 'mon').hover();
    const during = await read();
    expect(during.fills, 'every cell keeps its own shift colour under the pointer').toEqual(before.fills);
    expect(during.fills.some(f => f === 'rgba(0, 0, 0, 0)'), 'no cell goes transparent').toBe(false);
    expect(during.rings[1], 'the cell under the pointer wears the navy ring').toMatch(/inset/);
    expect(during.rings.filter((_, i) => i !== 1).every(r => r === 'none'), 'and only that cell').toBe(true);
    expect(during.num, 'the line number marks the row').not.toBe(before.num);
    expect(during.total, 'so do its totals').not.toBe(before.total);

    // Painting with the mouse: the cell shows its NEW colour while the pointer is still on it — the
    // same colour as an identical cell nobody is pointing at.
    await page.locator('#brushBar .brush-chip[data-shift="14:00-22:30"]').click();
    const target = gridCell(page, 5, 'mon');
    await target.click();
    await expect(target).toHaveText(/14:00\s+22:30/);
    const painted = await target.evaluate(b => getComputedStyle(b).backgroundColor);
    const elsewhere = await gridCell(page, 5, 'fri').evaluate(b => getComputedStyle(b).backgroundColor);   // 14:00–22:30 already
    expect(painted, 'a painted cell under the pointer wears its shift colour').toBe(elsewhere);
});

test('links grid: an edit from the keyboard leaves focus on the cell, by either route', async ({ page }) => {
    // Both routes replaced the cell's button with a new one, so focus — on the button Enter had just
    // pressed, or the one the sheet's close had handed it back to — fell to <body>, and the keyboard
    // user was back at the top of the page after every edit. The cell is now repainted in place.
    await openMixedDesign(page);

    // 1. The shift sheet: Enter opens it over the cell, Enter on an option picks.
    const sheetCell = gridCell(page, 12, 'wed');
    await sheetCell.focus();
    await page.keyboard.press('Enter');
    const rd = page.locator('.picker-opt[data-value="RD"]');
    await expect(rd).toBeVisible();
    // The sheet takes focus a frame after it opens (overlay.js); a keyboard user is inside it before
    // they choose, so this waits for that too rather than racing it.
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('.picker-sheet-overlay'))).toBe(true);
    await rd.focus();
    await page.keyboard.press('Enter');
    await expect(sheetCell).toHaveText('RD');
    await expect.poll(() => focusedCell(page), { message: 'focus fell out of the grid after a pick' }).toBe('12/wed');
    // …and a second Enter reaches the same cell: the sheet opens again, for it.
    await page.keyboard.press('Enter');
    await expect(page.locator('.picker-sheet-overlay')).toBeVisible();
    await expect(page.locator('.picker-sheet-overlay')).toContainText('Line 12 · Wed');
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('.picker-sheet-overlay'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('.picker-sheet-overlay')).toBeHidden();
    await expect.poll(() => focusedCell(page)).toBe('12/wed');

    // 2. Paint mode: a chip armed from the keyboard, Enter on a cell paints it.
    await page.locator('#brushBar .brush-chip[data-shift="RD"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#brushBar .brush-chip[data-shift="RD"]')).toHaveAttribute('aria-pressed', 'true');
    const paintCell = gridCell(page, 1, 'sun');
    await expect(paintCell).not.toHaveText('RD');
    await paintCell.focus();
    await page.keyboard.press('Enter');
    await expect(paintCell).toHaveText('RD');
    expect(await focusedCell(page), 'focus fell out of the grid after a paint').toBe('1/sun');
    // …and Enter still works from there: with the brush put down (Escape), it opens the sheet.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Enter');
    await expect(page.locator('.picker-sheet-overlay')).toContainText('Line 1 · Sun');
});

test('links grid: a mouse stroke paints every cell it crosses, and a touch does not stroke', async ({ page }) => {
    // Press and drag painted NOTHING — the grid listened for `click` alone, and a click whose press
    // and release land on different cells goes to the row — while two comments said a drag-paint
    // existed. A stroke is now a mouse's: a finger on a phone scrolls the grid.
    await openMixedDesign(page);
    const chip = page.locator('#brushBar .brush-chip[data-shift="14:00-22:30"]');
    await chip.click();
    const cells = ['tue', 'wed', 'thu', 'fri'].map(d => gridCell(page, 11, d));
    await centreLine(page, 11);
    const a = await cells[0].boundingBox(), z = await cells[3].boundingBox();
    if (!a || !z) throw new Error('the cells have no box');
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(z.x + z.width / 2, z.y + z.height / 2, { steps: 12 });
    await page.mouse.up();
    for (const c of cells) await expect(c, 'every cell the stroke crossed is painted').toHaveText(/14:00\s+22:30/);
    await expect(page.locator('#linksSaveBtn')).toBeEnabled();
    await expect(chip, 'the brush stays armed for the next stroke').toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.picker-sheet-overlay'), 'the release opened nothing').toBeHidden();
    expect(await page.evaluate(() => String(window.getSelection())), 'and selected no text').toBe('');

    // A TOUCH stroke paints nothing: it is a scroll that happened to begin on a cell. (Synthetic
    // events, because the browser's own touch would scroll; the rule they reach is the same one.)
    const before = await gridCell(page, 13, 'mon').textContent();
    await gridCell(page, 13, 'mon').dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 9, button: 0, buttons: 1, isPrimary: true });
    await gridCell(page, 13, 'tue').dispatchEvent('pointerover', { pointerType: 'touch', pointerId: 9, buttons: 1, isPrimary: true });
    await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', pointerId: 9, bubbles: true })));
    await expect(gridCell(page, 13, 'mon')).toHaveText(String(before));
    await expect(gridCell(page, 13, 'tue')).not.toHaveText(/14:00\s+22:30/);
});

test('links grid: the grid is ONE Tab stop, and the arrow keys move inside it', async ({ page }) => {
    // Every cell was a Tab stop — the whole rotation times seven days — so reaching the next card
    // from the keyboard meant crossing the grid cell by cell.
    await openMixedDesign(page);
    const stops = page.locator('#linksGridBodyRows .shift-cell-btn:not([tabindex="-1"])');
    await expect(stops, 'one cell, and only one, is in the Tab order').toHaveCount(1);

    await page.locator('#brushBar .brush-chip--custom').focus();
    await page.keyboard.press('Tab');
    expect(await focusedCell(page), 'Tab enters the grid at its first cell').toBe('1/sun');
    await page.keyboard.press('Tab');
    expect(await focusedCell(page), 'and the next Tab leaves it').not.toMatch(/^\d+\//);

    await page.keyboard.press('Shift+Tab');
    expect(await focusedCell(page)).toBe('1/sun');
    for (const [key, at] of /** @type {const} */ ([
        ['ArrowRight', '1/mon'], ['ArrowDown', '2/mon'], ['End', '2/sat'], ['ArrowRight', '2/sat'],
        ['Home', '2/sun'], ['ArrowLeft', '2/sun'], ['ArrowUp', '1/sun'], ['ArrowUp', '1/sun'],
        ['Control+End', `${ROTATING_LINES}/sat`], ['ArrowDown', `${ROTATING_LINES}/sat`], ['Control+Home', '1/sun'],
        ['ArrowDown', '2/sun'], ['ArrowDown', '3/sun'], ['ArrowRight', '3/mon'],
    ])) {
        await page.keyboard.press(key);
        expect(await focusedCell(page), `${key} lands on ${at}`).toBe(at);
    }
    // The Tab stop moved with the arrows: out and back in returns to the cell last used.
    await expect(stops).toHaveCount(1);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    expect(await focusedCell(page), 'Shift+Tab comes back to the cell last used').toBe('3/mon');
    // And Enter there still opens that cell's sheet.
    await page.keyboard.press('Enter');
    await expect(page.locator('.picker-sheet-overlay')).toContainText('Line 3 · Mon');
});

test('links grid: the paint bar stays in reach over the lower lines, with the day header beneath it', async ({ page }, info) => {
    // At 1366×768 the bar had scrolled away by line 16, so every change of brush meant scrolling up.
    // Sticky from 768px on a fine pointer; a phone keeps it in flow.
    await openMixedDesign(page);
    await centreLine(page, 20);
    const m = await page.evaluate(() => {
        const bar = /** @type {Element} */ (document.getElementById('brushBar')).getBoundingClientRect();
        const th = /** @type {Element} */ (document.querySelector('#linksGridTable thead th')).getBoundingClientRect();
        return { scrolled: window.scrollY, barTop: bar.top, barBottom: bar.bottom, thTop: th.top,
            position: getComputedStyle(/** @type {Element} */ (document.getElementById('brushBar'))).position };
    });
    if (isTouchProject(info)) {
        expect(m.position, 'a phone keeps the bar in flow').toBe('static');
        return;
    }
    expect(m.scrolled, 'the page really is scrolled down the grid').toBeGreaterThan(500);
    expect(m.barTop, 'the bar is pinned to the top of the screen').toBeCloseTo(0, 0);
    // The header sits under the bar, tucked 1px beneath it — never over it, and never a gap the
    // rows show through.
    expect(m.thTop, 'the day header sits beneath the bar').toBeGreaterThanOrEqual(m.barBottom - 1.5);
    expect(m.thTop, 'with no gap between them').toBeLessThanOrEqual(m.barBottom);
    // And a chip can be pressed from there to paint line 20 without scrolling back up.
    await page.locator('#brushBar .brush-chip[data-shift="SPARE"]').click();
    await gridCell(page, 20, 'sun').click();
    await expect(gridCell(page, 20, 'sun')).toHaveText('SP');
});

test('links grid: at a desktop size the times read at 12px, and a phone keeps its 10px', async ({ page }, info) => {
    // 10px times in 94–114px cells were the smallest text on the page at 1366.
    await openMixedDesign(page);
    const sizes = await page.evaluate(() => ({
        cell: getComputedStyle(/** @type {Element} */ (document.querySelector('#linksGridBodyRows .shift-cell-btn'))).fontSize,
        chip: getComputedStyle(/** @type {Element} */ (document.querySelector('#brushBar .brush-chip'))).fontSize,
    }));
    const want = isTouchProject(info) ? '10px' : '12px';
    expect(sizes).toEqual({ cell: want, chip: want });
});

test('links checks: the two fatigue caveats hold to the 72-character reading measure on a desktop', async ({ page }, info) => {
    // Their sentences went straight into the row body, which the 72ch cap did not reach, so they ran
    // to 110 and 159 characters a line at 1366.
    test.skip(isTouchProject(info), 'the measure applies from 1024px');
    await openMixedDesign(page);
    const over = await page.evaluate(() => [...document.querySelectorAll('#checksContent .check-prose')].map(b => {
        const probe = document.createElement('span');
        probe.textContent = '0'.repeat(72);
        probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap';
        b.appendChild(probe);
        const measure = probe.getBoundingClientRect().width;
        probe.remove();
        return { width: b.getBoundingClientRect().width, measure };
    }));
    expect(over.length, 'both caveats render').toBe(2);
    for (const o of over) expect(o.width, 'a caveat runs past 72 characters a line').toBeLessThanOrEqual(o.measure + 1);
});

test('links: small desktop polish — an armed chip keeps its colour under the pointer, and a compare name is not cut short', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'hover and the desktop chip width are fine-pointer surfaces');
    await openMixedDesign(page);
    const chip = page.locator('#brushBar .brush-chip[data-shift="11:00-19:30"]');
    await chip.click();
    await chip.hover();
    expect(await chip.evaluate(c => getComputedStyle(c).filter), 'hover repainted the armed chip').toBe('none');

    await page.locator('#designMoreBtn').click();
    await page.getByRole('button', { name: /Compare with/ }).click();
    const names = page.locator('#compareChips .design-chip-name');
    await expect(names.first()).toBeVisible();
    const cut = await names.evaluateAll(els => els.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent));
    expect(cut, 'a compare chip name was cut short with room to spare').toEqual([]);
});

test('links generator: a slot time wears the app\'s closed face, and a disabled "Use setup" reads as disabled', async ({ page }, info) => {
    // Safari drew its own grey face over all fifteen slot selects (they set a fill and nothing else),
    // and a disabled "Use setup" kept its navy, 600-weight lead at 40% — stronger than the ENABLED
    // "+ Save as new…" beside it.
    await openMixedDesign(page);
    await page.evaluate(() => { document.getElementById('generatorBody')?.classList.add('open'); });
    const face = await page.locator('.gen-slot-time').first().evaluate(el => {
        const s = getComputedStyle(el);
        return { appearance: s.appearance, image: s.backgroundImage.startsWith('url('), right: s.paddingRight };
    });
    // With a mouse, the app's face; on a touch screen the platform's own, because at phone width the
    // chevron's padding cut the time short ("no select option is cut off at 360px" holds that half).
    if (isTouchProject(info)) expect(face.appearance, 'a touch screen keeps the platform face').not.toBe('none');
    else expect(face).toEqual({ appearance: 'none', image: true, right: '24px' });

    const load = page.locator('#genSetLoadBtn');
    await expect(load).toBeDisabled();
    const look = await page.evaluate(() => {
        const s = (/** @type {string} */ id) => getComputedStyle(/** @type {Element} */ (document.getElementById(id)));
        return { load: { border: s('genSetLoadBtn').borderTopColor, colour: s('genSetLoadBtn').color, weight: s('genSetLoadBtn').fontWeight },
            saveAs: { border: s('genSetSaveAsBtn').borderTopColor, colour: s('genSetSaveAsBtn').color, weight: s('genSetSaveAsBtn').fontWeight } };
    });
    expect(look.load, 'disabled, it wears the neutral edge and type of the row\'s other buttons').toEqual(look.saveAs);
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
    // spare-week box: the default's cover weeks have matched the roster's before (four, v21.01) and
    // may again, so the one number cannot be relied on to tell the tables apart, while the row
    // counts cannot converge (the designed table carries Saturday and Sunday shapes of its own).
    await page.setViewportSize({ width: 390, height: 1000 });
    await seedSession(page, 'G. Miller');
    await openLinks(page);
    await page.locator('#generatorToggleHeader').click();
    await expect(page.locator('#genSpareLines')).toHaveValue('5');   // the 26-line default: five cover weeks
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
    await linksOpened(page);   // was a 700ms sleep (test audit, 7 Nov 2026) — see the helper
    await page.evaluate(() => { document.getElementById('generatorBody')?.classList.add('open'); });
    await page.locator('#genApplyBtn').click({ force: true });
    await clickDialogConfirm(page);
    await expect(page.locator('#genError')).toHaveText('');
    await expect(page.locator('#linksGridBodyRows tr')).toHaveCount(ROTATING_LINES);
    // And the design it built pays the contract — the summary chip is where a designer reads that.
    await expect(page.locator('#linksSummary')).toContainText('35h');
});

// ── THE SHORTLIST, BUILT IN (v24.47; owner decision 3 Oct 2026; Balanced V6, Level Crossing and Middle Ground since v25.52) ──
// The unit tests pin the data and the masthead's words. What only the page can prove: the picker
// REACHES them, opening one is read-only in the ways that matter (no rename, no delete, a Save that
// makes a copy), and the copy that save writes is the proposal's own 26-line grid under a new name.
test('links: the shortlisted proposals open read-only, and saving one makes a named copy', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {}; w.__E2E.docs = [];
    });
    await page.goto('/links.html');
    // Nothing saved opens NOTHING — the empty state offers the shortlist rather than choosing.
    await expect(page.locator('#linksEmptyProposals')).toBeVisible();
    await page.locator('#linksEmptyProposals').click();
    await expect(page.locator('#designPickerLb.visible')).toBeVisible();
    await expect(proposalOptions(page)).toHaveCount(PROPOSALS.length);   // every shortlisted design, however many (three since v25.04)
    await expect(designOptions(page)).toHaveCount(0);
    await proposalOptions(page).filter({ hasText: 'Level Crossing' }).click();   // the middle of the three, A to Z

    await expect(activeDesignName(page)).toHaveText('Level Crossing — Dec 2026');
    await expect(page.locator('#designWhoRole')).toHaveText('LC-26-T10 · 32241e32');   // the printed sheet's ref
    await expect(page.locator('#designEyebrow')).toHaveText('Shortlisted proposal');
    await expect(page.locator('#linksGridBodyRows tr')).toHaveCount(ROTATING_LINES);
    await expect(page.locator('#linksSaveBtnTop')).toHaveText('Save a copy…');
    await openDesignSheet(page);
    await expect(page.locator('#designRenameMenuBtn')).toBeDisabled();
    await expect(page.locator('#designDeleteBtn')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.locator('#designMoreLb.visible')).toHaveCount(0);

    await page.locator('#linksSaveBtnTop').click();
    const input = page.locator('.dialog-overlay .dialog-input');
    await expect(input).toHaveValue('Level Crossing — copy');
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');
    await expect(page.locator('#designEyebrow')).toHaveText('Editing');
    await expect(activeDesignName(page)).toHaveText('Level Crossing — copy');

    const writes = await page.evaluate(() => /** @type {any} */ (window).__E2E.setWrites || []);
    const copy = writes.find((/** @type {any} */ w) => w.data?.name === 'Level Crossing — copy');
    expect(copy, 'the first save CREATES a design').toBeTruthy();
    expect(Object.keys(copy.data.patterns)).toHaveLength(ROTATING_LINES);
    expect(copy.data.patterns['1'].mon, 'the proposal\'s own grid — line 1 is a cover week').toBe('SPARE');
    expect(writes.some((/** @type {any} */ w) => String(w.path).includes('proposal')), 'a proposal id never reaches Firestore').toBe(false);
    // And the shortlist itself is untouched, still offered, still read-only.
    await openDesignPicker(page);
    await expect(proposalOptions(page)).toHaveCount(PROPOSALS.length);
    await expect(designOptions(page)).toHaveCount(1);
});

// A first save was keyed on the design OBJECT, and a window edit replaces the object — so editing the
// window mid-save re-enabled Save, and a second press created a second design (whole-app review).
test('links: a window edit during a first save does not re-arm Save for a second create', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {}; w.__E2E.docs = [];
    });
    await page.goto('/links.html');
    await page.locator('#linksEmptyProposals').click();
    await proposalOptions(page).filter({ hasText: 'Balanced V6' }).click();
    await expect(page.locator('#linksSaveBtnTop')).toHaveText('Save a copy…');

    await page.evaluate(() => { /** @type {any} */ (window).__E2E.addDocHold = true; });
    await page.locator('#linksSaveBtnTop').click();
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');
    await expect(page.locator('#linksSaveBtnTop')).toBeDisabled();

    await page.locator('#winMonSatStart').fill('05:00');
    await page.locator('#winMonSatStart').dispatchEvent('change');
    await expect(page.locator('#linksSaveBtnTop'), 'Save stays held while the first save is in flight').toBeDisabled();

    await page.evaluate(() => { const w = /** @type {any} */ (window); w.__E2E.addDocHold = false; w.__E2E.releaseAddDoc?.(); });
    await expect(page.locator('#designEyebrow')).toHaveText('Editing');
    const creates = await page.evaluate(() => (/** @type {any} */ (window).__E2E.setWrites || []).filter((/** @type {any} */ w) => w.added).length);
    expect(creates, 'exactly one design was created').toBe(1);
});

// Generate with a proposal open builds a NEW design, but the in-flight first save of the proposal's
// copy was not told: when it landed, the copy's new id was stamped on the generated design, whose
// next save then overwrote the copy (whole-app review, Oct 2026).
test('links: Generate during a proposal copy\'s first save leaves the generated design unsaved', async ({ page }) => {
    await seedContractTargets(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {}; w.__E2E.docs = [];
    });
    await page.goto('/links.html');
    await page.locator('#linksEmptyProposals').click();
    await proposalOptions(page).filter({ hasText: 'Balanced V6' }).click();
    await expect(page.locator('#linksSaveBtnTop')).toHaveText('Save a copy…');

    await page.evaluate(() => { /** @type {any} */ (window).__E2E.addDocHold = true; });
    await page.locator('#linksSaveBtnTop').click();
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');   // the name it is saved under
    await expect(page.locator('#linksSaveBtnTop')).toBeDisabled();

    await expect(page.locator('.dialog-overlay')).toHaveCount(0);            // the name prompt has gone

    await page.evaluate(() => { document.getElementById('generatorBody')?.classList.add('open'); });
    await page.locator('#genApplyBtn').click({ force: true });
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');
    await expect(page.locator('#linksSaveBtnTop'), 'premise: the copy is still being saved').toBeDisabled();

    await page.evaluate(() => { const w = /** @type {any} */ (window); w.__E2E.addDocHold = false; w.__E2E.releaseAddDoc?.(); });
    await expect.poll(() => page.evaluate(() =>
        (/** @type {any} */ (window).__E2E.setWrites || []).filter((/** @type {any} */ w) => w.added).length),
        'the copy was created').toBe(1);
    await expect(page.locator('#linksSaveBtnTop'), 'the generated design is still its own, unsaved').toHaveText('Save as…');
    await expect(page.locator('#designStatusLong')).toHaveText('Not saved yet');
});

// …AND THE OTHER ORDER (48-hour review, Nov 2026): the copy's first save lands while the Apply question
// is still OPEN — or during its close fade, which WebKit took long enough over to reach the test above.
// The proposal is then a saved design, and deciding after the question put the generated pattern OVER
// the copy, under a dialog that had said a new design opens. Released here with the question up, so
// every engine takes this order.
test('links: a copy\'s first save landing while the Apply question is open still opens a NEW design', async ({ page }) => {
    await seedContractTargets(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {}; w.__E2E.docs = [];
    });
    await page.goto('/links.html');
    await page.locator('#linksEmptyProposals').click();
    await proposalOptions(page).filter({ hasText: 'Balanced V6' }).click();
    await expect(page.locator('#linksSaveBtnTop')).toHaveText('Save a copy…');

    await page.evaluate(() => { /** @type {any} */ (window).__E2E.addDocHold = true; });
    await page.locator('#linksSaveBtnTop').click();
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');   // the name it is saved under
    await expect(page.locator('.dialog-overlay')).toHaveCount(0);

    await page.evaluate(() => { document.getElementById('generatorBody')?.classList.add('open'); });
    await page.locator('#genApplyBtn').click({ force: true });
    await expect(page.locator('.dialog-overlay .dialog-btn-confirm')).toBeVisible();
    await expect(page.locator('.dialog-overlay'), 'premise: what the question promises').toContainText('A new design opens');

    await page.evaluate(() => { const w = /** @type {any} */ (window); w.__E2E.addDocHold = false; w.__E2E.releaseAddDoc?.(); });
    await expect.poll(() => page.evaluate(() =>
        (/** @type {any} */ (window).__E2E.setWrites || []).filter((/** @type {any} */ w) => w.added).length),
        'the copy was created').toBe(1);
    await expect(page.locator('#linksSaveBtnTop'), 'premise: the copy is the saved design behind the question').toHaveText('Saved');

    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');
    await expect(page.locator('#linksSaveBtnTop'), 'a NEW design, as the question said — not the copy, edited').toHaveText('Save as…');
    await expect(page.locator('#designStatusLong')).toHaveText('Not saved yet');
});

// ── THE 24-LINE DESIGNS GO TO THE BIN (v24.47, owner) ───────────────────────────────────────────
// The rule is unit-tested (isPre26Design). What only the page can show: the designs move to the bin
// on open, the move is a SOFT delete written for real, a 26-line design and a blank one are left
// alone, and the designer is told — a move nobody pressed must never be silent.
test('links: designs drawn for 24 lines move to Recently deleted, and nothing else does', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const grid = (/** @type {number} */ n) => {
            const p = /** @type {any} */ ({});
            for (let i = 1; i <= n; i++) p[String(i)] = { sun: 'RD', mon: '06:20-14:20', tue: '06:20-14:20', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' };
            return p;
        };
        const OLD = 1_750_000_000_000;   // Jun 2025 — saved when the link was 24 lines
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.docs = [
            { id: 'old24', name: 'Old 24', patterns: grid(24), updatedAt: OLD, updatedBy: 'S. Silva' },
            { id: 'new26', name: 'New 26', patterns: grid(26), updatedAt: OLD, updatedBy: 'S. Silva' },
            { id: 'blank', name: 'Blank', patterns: {}, updatedAt: OLD, updatedBy: 'S. Silva' },
        ];
    });
    await page.goto('/links.html');
    await openDesignPicker(page);
    await expect(designOptions(page)).toHaveCount(2);
    await expect(designOptions(page).filter({ hasText: 'Old 24' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('#linksSaveStatus')).toContainText('1 design drawn for the 24-line link is in Recently deleted');

    await expect.poll(() => page.evaluate(() => (/** @type {any} */ (window).__E2E.setWrites || [])
        .filter((/** @type {any} */ w) => w.data && 'deletedAt' in w.data).map((/** @type {any} */ w) => [w.path, w.merge]))).toEqual([['linkDesigns/old24', true]]);
    const deletes = await page.evaluate(() => /** @type {any} */ (window).__E2E.deletedPaths || []);
    expect(deletes, 'a soft delete — restorable — never a hard one').toEqual([]);
    await openDesignSheet(page);
    await expect(page.locator('#designBinBtn')).toHaveText(/Recently deleted \(1\)/);
});

// A move that FAILS leaves the design live on the server. Left in the bin, a Restore then met a
// design that was never deleted and said somebody else had restored it (whole-app review, Oct 2026).
test('links: a 24-line design whose move to the bin fails is shown live again', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const grid = (/** @type {number} */ n) => {
            const p = /** @type {any} */ ({});
            for (let i = 1; i <= n; i++) p[String(i)] = { sun: 'RD', mon: '06:20-14:20', tue: '06:20-14:20', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' };
            return p;
        };
        const OLD = 1_750_000_000_000;
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.txErrorCode = 'permission-denied';   // the move's transaction is refused
        w.__E2E.docs = [
            { id: 'old24', name: 'Old 24', patterns: grid(24), updatedAt: OLD, updatedBy: 'S. Silva' },
            { id: 'new26', name: 'New 26', patterns: grid(26), updatedAt: OLD, updatedBy: 'S. Silva' },
        ];
    });
    await page.goto('/links.html');
    await openDesignPicker(page);
    await expect(designOptions(page).filter({ hasText: 'Old 24' }), 'shown where the server has it').toHaveCount(1);
    await page.keyboard.press('Escape');
    await openDesignSheet(page);
    await expect(page.locator('#designBinBtn'), 'and not offered for a Restore it does not need').toBeHidden();
    await page.keyboard.press('Escape');
    // …and the line that announced the move stops claiming it (48-hour review, Nov 2026).
    await expect(page.locator('#linksSaveStatus')).toContainText('could not be moved to Recently deleted');
    await expect(page.locator('#linksSaveStatus')).not.toContainText('is in Recently deleted');
});

test('links: an only design whose move to the bin fails opens, rather than pointing at a bin it is not in', async ({ page }) => {
    // 48-hour review, Nov 2026. With every design a 24-line one nothing opens, and the empty page
    // says where they went — and it went on saying "Restore one from Recently deleted" after the move
    // FAILED, with the bin row hidden and the design back in the list. A load would have opened it.
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const p = /** @type {any} */ ({});
        for (let i = 1; i <= 24; i++) p[String(i)] = { sun: 'RD', mon: '06:20-14:20', tue: '06:20-14:20', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' };
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.txErrorCode = 'permission-denied';   // the move's transaction is refused
        w.__E2E.docs = [{ id: 'old24', name: 'Old 24', patterns: p, updatedAt: 1_750_000_000_000, updatedBy: 'S. Silva' }];
    });
    await page.goto('/links.html');
    await expect(page.locator('#linksGridBodyRows tr').first(), 'the design is open').toBeVisible();
    await expect(page.locator('#linksEmptyState')).toBeHidden();
    await expect(page.locator('#linksSaveStatus')).toContainText('could not be moved to Recently deleted');
});

test('links: when EVERY design was a 24-line one, the empty page says where they went', async ({ page }) => {
    // Release day: nearly every saved design is a 24-line one, so the list is empty — and the save
    // row that carries the status line is hidden with it. "No designs yet" alone reads as lost work.
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const p = /** @type {any} */ ({});
        for (let i = 1; i <= 24; i++) p[String(i)] = { sun: 'RD', mon: '06:20-14:20', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' };
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.docs = [{ id: 'a', name: 'Option A', patterns: p, updatedAt: 1_750_000_000_000, updatedBy: 'S. Silva' },
                        { id: 'b', name: 'Option B', patterns: p, updatedAt: 1_750_000_000_000, updatedBy: 'S. Silva' },
                        // The pre-v12 singleton is still in Firestore (nothing ever deleted it). With every
                        // design binned it used to be re-migrated as "Design 1" on every open (Oct 2026).
                        { id: 'combined-28', patterns: p, updatedAt: 1_700_000_000_000, updatedBy: 'G. Miller' }];
    });
    await page.goto('/links.html');
    await expect(page.locator('#linksEmptyState .links-empty-title')).toHaveText('Your 24-line designs are in Recently deleted');
    await expect(page.locator('#linksEmptyMsg')).toContainText('the 2 designs drawn for 24 moved there. Restore one from Recently deleted');
    // No month (links-app-12): the new link starts in January 2027, and the day is not set yet.
    await expect(page.locator('#linksEmptyMsg')).toContainText(`The link is now ${ROTATING_LINES} lines, so`);
    await expect(page.locator('#linksEmptyMsg')).not.toContainText('December');
    const created = await page.evaluate(() => (window.__E2E?.setWrites || []).filter(w => w.added));
    expect(created, 'the legacy grid was re-migrated into a new design').toEqual([]);
});

// ── Until the designs are in, nothing can make one (whole-app fix, Nov 2026 — links-app-1) ──────────
// The page is on screen from auth-ready and the designs land later — on a poor connection, many
// seconds later — REPLACING the working copy when they do. It used to say "No designs yet" with its
// three actions live in that window, and a design built or started then was swept away by the load,
// unasked, with the Save button reading "Saved". The read is HELD here, so the window is as wide as
// the test wants rather than the few milliseconds the hermetic stub normally gives it.
test('links: until the designs have loaded, nothing offers to make one the load would replace', async ({ page }) => {
    await seedContractTargets(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.docsHeld = true;
        w.__E2E.docs = [{ id: 'd1', name: 'Option A', updatedBy: 'S. Silva',
            patterns: { '1': { sun: 'RD', mon: '06:20-14:20', tue: '14:00-22:00', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' } } }];
    });
    await page.goto('/links.html');
    await expect(page.locator('#generatorToggleHeader')).toBeVisible();   // on screen: auth-ready has landed

    // It says it is loading, and offers nothing: no empty-state actions, and the masthead's two shut.
    await expect(page.locator('#linksEmptyState .links-empty-title')).toHaveText('Loading your designs…');
    await expect(page.locator('#linksEmptyGenerate')).toBeHidden();
    await expect(page.locator('#linksEmptyNew')).toBeHidden();
    await expect(page.locator('#linksEmptyRetry')).toBeHidden();
    await expect(page.locator('#designMoreBtn'), 'New, Import and the rest wait for the list').toBeDisabled();
    await expect(page.locator('#designPickerBtn')).toBeDisabled();
    // Build the link, reached by opening its card by hand, says to wait — and opens no dialog.
    await page.locator('#generatorToggleHeader').click();
    await page.locator('#genApplyBtn').click();
    await expect(page.locator('#genError')).toContainText('still loading');
    await expect(page.locator('.dialog-overlay')).toHaveCount(0);

    // The list lands: the saved design opens, untouched, and everything wakes.
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsHeld = false; });
    await expect(activeDesignName(page)).toHaveText('Option A');
    await expect(page.locator('#designMoreBtn')).toBeEnabled();
    await expect(page.locator('#designPickerBtn')).toBeEnabled();
    await expect(page.locator('#genError'), 'the "still loading" line goes with the wait').toHaveText('');
    await expect(page.locator('#linksSaveBtnTop'), 'nothing unsaved').toBeDisabled();
    await page.locator('#genApplyBtn').click();
    await expect(page.locator('.dialog-overlay'), 'Build the link now asks, as on any open design').toBeVisible();
});

// An answer served from the OFFLINE CACHE is what this device happened to keep — which can be
// nothing (links-app-5). With no live design in it the page cannot tell "you have none" from "this
// device never read them", so it is the failed state, with a way to try again; and the one-time
// migration of the legacy singleton waits for a server's word that the collection is empty, rather
// than queueing a second "Design 1" from whatever the cache held.
test('links: an offline answer with no design in it is "couldn\'t load", and Try again reads afresh', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const p = /** @type {any} */ ({});
        for (let i = 1; i <= 26; i++) p[String(i)] = { sun: 'RD', mon: '06:20-14:20', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' };
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.docsFromCache = true;   // the read is answered from this device's cache
        w.__E2E.docs = [{ id: 'combined-28', patterns: p, updatedAt: 1_700_000_000_000, updatedBy: 'G. Miller' }];
    });
    await page.goto('/links.html');
    await expect(page.locator('#linksEmptyState .links-empty-title')).toHaveText('Couldn’t load your designs');
    await expect(page.locator('#linksEmptyMsg')).toContainText('try again');
    await expect(page.locator('#linksEmptyNew'), 'no invitation to make a duplicate').toBeHidden();
    await expect(page.locator('#linksEmptyGenerate')).toBeHidden();
    await expect(page.locator('#linksEmptyRetry')).toBeVisible();
    const added = () => page.evaluate(() => (/** @type {any} */ (window).__E2E?.setWrites || []).filter((/** @type {any} */ w) => w.added).length);
    expect(await added(), 'the legacy grid was migrated from a cached read').toBe(0);

    // The server answers now: Try again reads it, and the one-time migration runs — once.
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsFromCache = false; });
    await page.locator('#linksEmptyRetry').click();
    await expect(activeDesignName(page)).toHaveText('Design 1');
    await expect(page.locator('#linksEmptyState')).toBeHidden();
    expect(await added()).toBe(1);
});

// A REFRESH starts no move to the bin, so it may claim none (whole-app fix, Nov 2026). An offline
// load moves nothing — the move is a transaction — and shows the old-length designs live. A list
// refresh after the connection returned put them in the bin all the same, with no move made, and a
// Restore of one then said that SOMEONE ELSE had restored it.
test('links: a refresh after an offline load does not show the old-length designs in the bin unmoved', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const p = /** @type {any} */ ({});
        for (let i = 1; i <= 24; i++) p[String(i)] = { sun: 'RD', mon: '06:20-14:20', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' };
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.docsFromCache = true;
        w.__E2E.docs = [{ id: 'old24', name: 'Old 24', patterns: p, updatedAt: 1_750_000_000_000, updatedBy: 'S. Silva' },
                        { id: 'gone', name: 'Binned X', patterns: p, updatedAt: 1_750_000_000_000, updatedBy: 'S. Silva',
                          deletedAt: 1_760_000_000_000, deletedBy: 'S. Silva' }];
    });
    await page.goto('/links.html');
    await expect(activeDesignName(page), 'an offline load shows it live, and moves nothing').toHaveText('Old 24');
    // Back online, a colleague has already restored the binned one: restoring it here REFRESHES the lists.
    await page.evaluate(() => {
        const e2e = /** @type {any} */ (window).__E2E;
        e2e.docsFromCache = false;
        e2e.txDocs = [{ id: 'gone', name: 'Binned X', patterns: {}, updatedAt: 1_780_000_000_000, updatedBy: 'S. Silva' }];
    });
    await sheetAction(page, 'designBinBtn');
    await page.locator('#designBinList .bin-restore').first().click();
    await expect(page.locator('#designBinStatus')).toContainText('already been restored');
    await expect(page.locator('#designBinList'), 'a refresh claimed a move nobody made').not.toContainText('Old 24');
    await expect(designOptions(page).filter({ hasText: 'Old 24' })).toHaveCount(1);
    const binned = await page.evaluate(() => (/** @type {any} */ (window).__E2E?.setWrites || []).filter((/** @type {any} */ w) => w.data?.deletedAt).length);
    expect(binned, 'nothing was moved to the bin').toBe(0);
});

// The one-time migration of the pre-v12 singleton created its design at revision 1 and kept the list
// entry without it, so the first save met a revision it did not hold: a false "this design changed"
// (whole-app review, Oct 2026). Dead in production — every real collection has held a design — but
// the next empty one would meet it.
test('links: the design migrated from the legacy singleton saves without a false conflict', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const p = /** @type {any} */ ({});
        for (let i = 1; i <= 26; i++) p[String(i)] = { sun: 'RD', mon: '06:20-14:20', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' };
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.docs = [{ id: 'combined-28', patterns: p, updatedAt: 1_700_000_000_000, updatedBy: 'G. Miller' },
                        // What the server holds once the migration's create lands: unnamed, so the
                        // load ignores it, and at revision 1 — the stub's create records, it does not store.
                        { id: 'e2e-added-1', patterns: p, revision: 1, updatedAt: 1_700_000_000_000, updatedBy: 'G. Miller' }];
    });
    await page.goto('/links.html');
    await expect(activeDesignName(page)).toHaveText('Design 1');
    await page.locator('#winMonSatStart').fill('06:00');
    await page.locator('#winMonSatStart').dispatchEvent('change');
    await page.locator('#linksSaveBtnTop').click();
    await expect(page.locator('#linksSaveStatus')).toContainText('Saved');
    await expect(page.locator('.dialog-overlay'), 'no conflict was asked about').toHaveCount(0);
});

test('links: the rotation length the in-page fixtures assume', () => {
    // The fixtures above build their patterns inside `addInitScript`, where a module import is not
    // available, so they loop to a literal. Tie it to the constant here or the whole Links e2e set
    // silently changes what it is testing when the rotation moves: a fixture LONGER than the
    // rotation exercises the legacy-design path (surplus rows, the over-length notice) while every
    // assertion still passes, and a fixture SHORTER leaves undesigned rows that the "every line
    // filled" checks would then be wrong about.
    expect(ROTATING_LINES).toBe(26);
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

// ── A repeat is admitted, never renumbered (whole-app fix, Nov 2026 — links-app-2) ──────────────────
// An attempt whose three seeded starts all fail the cover-spread and boundary-rest filters falls back
// to DESIGN 1's order (links-adjacency.js), and the status line compared each press only with the one
// before it: on the default table the third press was design 1's grid, cell for cell, under "Design 3
// … Design 2 scored better". So the property is checked over EVERY press, not pinned to the press that
// falls back today — which one does is the optimiser's business — and the switches-off half is the
// case that repeats on every press whatever the optimiser does.
test('links: a generated design that repeats an earlier one says which design it is', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {}; w.__E2E.docs = [];
    });
    await page.goto('/links.html');
    await linksOpened(page);
    const status = page.locator('#linksSaveStatus');
    /** Press Build, confirm, and wait for THIS press's line (every press after the first is numbered). */
    const press = async () => {
        const before = await status.textContent();
        await page.locator('#genApplyBtn').click();
        await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');
        await expect(page.locator('.dialog-overlay')).toHaveCount(0);
        await expect(status).not.toHaveText(before ?? '');
        return {
            grid: await page.evaluate(() => /** @type {HTMLElement} */ (document.getElementById('linksGridBodyRows')).innerText),
            said: await status.textContent() ?? '',
        };
    };
    /** Each press names the FIRST earlier design with its grid, and claims no repeat it does not have. */
    const checkPresses = (/** @type {Array<{grid: string, said: string}>} */ runs) => {
        runs.forEach((r, i) => {
            if (i === 0) return;
            expect(r.said, `press ${i + 1}`).toContain(`Design ${i + 1} — `);
            const first = runs.findIndex(x => x.grid === r.grid);
            if (first < i) expect(r.said, `press ${i + 1} is design ${first + 1}'s grid`).toContain(`Same arrangement as design ${first + 1} —`);
            else expect(r.said, `press ${i + 1} is a new grid`).not.toContain('Same arrangement');
        });
    };

    // The default table, every switch on: today the third press falls back to design 1.
    const onRuns = [];
    for (let i = 0; i < 4; i++) onRuns.push(await press());
    checkPresses(onRuns);

    // Every switch off: the order is left alone, so EVERY press is design 1 again — and says so, by
    // the first design that wore it, not by whichever came just before.
    for (const id of await page.evaluate(() => [...document.querySelectorAll('.gen-objectives input[type="checkbox"]')].map(el => el.id))) {
        await page.locator('#' + id).uncheck();
    }
    const offRuns = [];
    for (let i = 0; i < 3; i++) offRuns.push(await press());
    checkPresses(offRuns);
    expect(offRuns[2].said).toContain('Same arrangement as design 1 —');
});

// "Long weekends — at least 0" is a real answer (links-app-8). `parseInt(…) || 4` read it as 4, and
// with the same 4 in the fingerprint a changed box did not even restart the explore loop: the next
// press was "Design 2" of the OLD inputs. A figure under a box's minimum is raised to it, in the box too.
test('links: a zero in a line-order box is the figure used, not the default', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {}; w.__E2E.docs = [];
    });
    await page.goto('/links.html');
    await linksOpened(page);
    const status = page.locator('#linksSaveStatus');
    const build = async () => {
        await page.locator('#genApplyBtn').click();
        await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');
        await expect(page.locator('.dialog-overlay')).toHaveCount(0);
    };
    await build();
    await expect(status).toContainText('Generate again');
    await page.locator('#objLongTarget').fill('0');
    await page.locator('#objBlockTarget').fill('0');   // under its minimum of 1
    await build();
    await expect(status, 'new inputs start a new exploration, at design 1').toContainText('Generate again for a different line order');
    await expect(status).not.toContainText('Design 2');
    await expect(page.locator('#objLongTarget')).toHaveValue('0');
    await expect(page.locator('#objBlockTarget'), 'raised to the minimum it was built with').toHaveValue('1');
});

// The line-order search runs on the main thread for a fraction of a second on a desktop and several
// times that on a phone, and the page used to sit frozen with nothing on screen — long enough to tap
// again (links-app-21). It now says "Building the link…" and holds the button, and gives that a frame
// to PAINT before the search starts. Every state the status beside the button passes through is
// recorded: without the frame, "Building…" is replaced in the same task and never seen.
test('links: Build the link says it is building, and holds the button until it has', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {}; w.__E2E.docs = [];
    });
    await page.goto('/links.html');
    await linksOpened(page);
    await page.evaluate(() => {
        const st = /** @type {HTMLElement} */ (document.getElementById('genStatus'));
        const btn = /** @type {HTMLButtonElement} */ (document.getElementById('genApplyBtn'));
        const seen = /** @type {any[]} */ ([]);
        new MutationObserver(() => seen.push({ text: st.textContent, shown: !st.hidden, held: btn.disabled }))
            .observe(st, { childList: true, characterData: true, subtree: true, attributes: true });
        /** @type {any} */ (window).__genSeen = seen;
    });
    await page.locator('#genApplyBtn').click();
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');
    await expect(page.locator('#genStatus')).toContainText('Link generated');
    const seen = await page.evaluate(() => /** @type {any} */ (window).__genSeen);
    expect(seen.some((/** @type {any} */ s) => s.text === 'Building the link…' && s.shown && s.held),
        `"Building the link…" shown, with the button held — states seen: ${JSON.stringify(seen)}`).toBe(true);
    await expect(page.locator('#genApplyBtn'), 'and released once it has built').toBeEnabled();
});

// ── The families that carry a 30px COMMITMENT keep it (v22.65) ─────────────────────────────────
// The sweep above is the app's enforced floor: 24px, WCAG 2.2 SC 2.5.8 AA, applied everywhere.
// This is narrower and stricter, and it exists because 24 is a floor rather than a target.
//
// Two Links control families have a documented 30px commitment under a coarse pointer: the paint
// chips (v22.61, "the primary control on the page") and the design/saved-set action rows (v22.65).
// The second was left at 25px by the first pass — clearing the enforced floor by ONE PIXEL, in a
// row of identically sized neighbours, one of which is `Delete`: a destructive act on shared work
// with no bin behind a saved SET.
//
// A single pixel of margin is not a margin. Without this, restoring the old padding puts them back
// to 25px and the sweep above stays green, which is precisely how the first pass missed them.
// Probes with `elementFromPoint` for the reason the sweep's own header gives: several targets here
// are expanded by a pseudo-element and a box measurement cannot see it.
test('links: the 30px control families keep their target @a11y', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile-chrome', 'a thumb, not a mouse');
    await page.setViewportSize({ width: 360, height: 900 });   // the reported device width
    await seedContractTargets(page);
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => { localStorage.setItem('myb_links_welcome_seen', '1'); });
    await page.goto('/links.html');
    await expect(page.locator('#generatorToggleHeader')).toBeVisible();
    await page.locator('#genApplyBtn').click();
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');
    await expect(page.locator('#linksSaveRow')).toBeVisible();
    // The confirm is GONE, waited for rather than slept past (test audit, 7 Nov 2026 — this was a
    // 400ms wait). The probe below hit-tests with `elementFromPoint` and skips anything covered, so
    // a dialog still fading out over the page would turn every chip it covers into "unprobeable" and
    // pass. The dialog's node is removed once its close has landed (overlay.js).
    await expect(page.locator('.dialog-overlay')).toHaveCount(0);

    const small = await page.evaluate(async () => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const probe = (el) => {
            const b = el.getBoundingClientRect();
            const cx = Math.round(b.left + b.width / 2), cy = Math.round(b.top + b.height / 2);
            const owns = (x, y) => { const t = document.elementFromPoint(x, y); return !!t && (t === el || el.contains(t)); };
            if (!owns(cx, cy)) return null;
            let u = 0, d = 0, l = 0, r = 0;
            while (u < 50 && owns(cx, cy - u - 1)) u++;
            while (d < 50 && owns(cx, cy + d + 1)) d++;
            while (l < 80 && owns(cx - l - 1, cy)) l++;
            while (r < 80 && owns(cx + r + 1, cy)) r++;
            return { w: l + r + 1, h: u + d + 1 };
        };
        const out = [];
        for (const sel of ['.brush-chip', '.btn-design-new', '.btn-design-import',
                           '.btn-design-dup', '.btn-design-compare', '.btn-set']) {
            for (const el of document.querySelectorAll(sel)) {
                if (getComputedStyle(el).visibility === 'hidden') continue;
                const b0 = el.getBoundingClientRect();
                if (!b0.width || !b0.height) continue;
                el.scrollIntoView({ block: 'center', behavior: 'instant' });
                await sleep(30);
                const t = probe(el);
                // Unprobeable (covered or off-screen) is not a failure — the sweep above owns that
                // case, and reporting it here would be a false alarm in the guard, not a finding.
                if (t && (t.w < 30 || t.h < 30)) {
                    out.push(`${sel}[${(el.textContent || '').trim().slice(0, 12)}] = ${t.w}x${t.h}`);
                }
            }
        }
        return [...new Set(out)];
    });
    expect(small, 'these families carry a 30px commitment, not the 24px floor').toEqual([]);
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
    test.skip(!isTouchProject(info), 'needs a real coarse pointer');
    // 360, not the suite's usual 390 — that is the reported device (1080px at DPR 3), and it is the
    // 30px that decided this. The clause fits at 390 and fragments at 360.
    await page.setViewportSize({ width: 360, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => { localStorage.setItem('myb_links_welcome_seen', '1'); });
    await page.goto('/links.html');
    // Opened, then the card opened — no sleep after (test audit, 7 Nov 2026): `.open` is
    // `display: block`, so the clause is laid out the moment the class is on.
    await linksOpened(page);
    await page.evaluate(() => document.getElementById('generatorBody')?.classList.add('open'));

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
        for (let i = 1; i <= 26; i++) {
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

// ── "24-line" is one word to a reader (polish round 2) ──────────────────────────────────────────
// The empty state's sentence broke after the hyphen — "…start from an empty 24-" / "line grid." — at
// 320 and 390px. The count is stamped from ROTATING_LINES, so the phrase is kept whole by a span
// around the rendered count and "-line", not by a literal. One client rect per span = one line.
test('links: the empty state never splits the "N-line" phrase across lines', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {}; w.__E2E.docs = [];
    });
    for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/links.html');
        await expect(page.locator('#linksEmptyState')).toBeVisible();
        const phrase = page.locator('#linksEmptyMsg .links-nowrap');
        await expect(phrase).toHaveText(`${ROTATING_LINES}-line`);
        const lines = await phrase.evaluate(el => {
            const r = document.createRange();
            r.selectNodeContents(el);
            return new Set([...r.getClientRects()].filter(x => x.width > 0).map(x => Math.round(x.top))).size;
        });
        expect(lines, `at ${width}px "${ROTATING_LINES}-line" must sit on one line`).toBe(1);
    }
});

// ── The generator card has ONE left edge on desktop (v19.67)─────────────────────────────────────
// v19.66 centred `.generator-form` to split the 440px of dead space beside it, and left the intro
// prose where it was — so the card ended up with TWO left edges: the intro ran 122→778 while the
// table, objectives, action links and Generate button all ran 310→970. Nearly the same WIDTH
// (656 vs 660), 188px apart, which reads as a mistake rather than as hierarchy.
//
// A screenshot would not police this reliably: the baseline is a whole-card capture, and a
// re-baseline records whatever the alignment happens to be. Measuring the left edges does.
test('links: the generator card lines up on one left edge at desktop width', async ({ page }, info) => {
    // Both phone projects, not one: this skipped mobile-chrome and then RAN on mobile-safari,
    // which forced a 1280 viewport and measured the same desktop layout a second time. A
    // project gate should name the class of device, not one member of it.
    test.skip(isTouchProject(info), 'the shared column only applies at >=1024px');
    // v20.98: the generator refuses targets that cannot pay the contracted week, and the
    // roster seed cannot at this rotation — so a spec that generates brings work with it.
    await seedContractTargets(page);
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => { localStorage.setItem('myb_links_welcome_seen', '1'); });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/links.html');
    // Opened, then the card opened — no sleep after (test audit, 7 Nov 2026; see the helper).
    await linksOpened(page);
    await page.evaluate(() => document.getElementById('generatorBody')?.classList.add('open'));

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
    // EVERY touch project takes the phone branch (whole-app review, I10): this said 'mobile-chrome',
    // so under mobile-safari the test forced a desktop viewport and the phone assertion below never
    // once ran on Safari's engine — one engine, reading as covering touch.
    const phone = isTouchProject(info);
    await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1280, height: 900 });
    await page.goto('/links.html');
    // Opened, then the card opened — no sleep after (test audit, 7 Nov 2026; see the helper).
    await linksOpened(page);
    await page.evaluate(() => document.getElementById('generatorBody')?.classList.add('open'));

    const m = await page.evaluate(() => {
        const wrap = /** @type {Element} */ (document.querySelector('.gen-slot-table-wrap'));
        const th = /** @type {Element} */ (document.querySelector('.gen-slot-table thead th'));
        const w = getComputedStyle(wrap);
        return { pos: getComputedStyle(th).position, ox: w.overflowX, oy: w.overflowY };
    });
    expect(m.pos, 'the sticky declaration must be present at every width').toBe('sticky');

    if (phone) {
        // The wrapper scrolls horizontally, which forces the vertical axis too — this is WHY the
        // header cannot stick to the page here.
        expect(m.ox, 'the narrow wrapper scrolls the table horizontally').toBe('auto');
        expect(m.oy, 'and so becomes a vertical scroll container — the reason sticky is inert here').toBe('auto');
    } else {
        // Not a scroll container ⇒ the sticky offset is the page ⇒ the header actually sticks.
        expect(m.ox, 'at >=768px the wrapper must not be a scroll container, or sticky breaks').toBe('visible');
    }
});

// ── THE GRID CELL EDITOR OPENS THE APP'S OWN SHEET (v23.38) ───────────────────────────────────
//
// It used to replace the cell's button with a native `<select>`, focused on the next frame and
// restored on blur — so the popup a designer chose a shift from was the OS's, in the one card on
// this page where the app draws every other pixel. Nothing about the CLOSED cell changed, which is
// why only driving the open state can see it.
//
// The three assertions are the three things the swap-out used to do and no longer has to: the cell
// is never taken apart (its button survives the whole interaction), a dismissed sheet leaves the
// value alone (there was a `committed` flag and a blur guard for this), and a pick applies.
test('links: editing a grid cell uses the app sheet, and cancelling changes nothing',
    async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        /** @type {any} */ const pat = {};
        for (let i = 1; i <= 26; i++) {
            pat[String(i)] = { sun: 'RD', mon: '06:20-14:20', tue: '06:20-14:20', wed: 'RD',
                thu: '15:15-23:55', fri: '15:15-23:55', sat: 'RD' };
        }
        w.__E2E.docs = [{ id: 'd1', name: 'Option A', patterns: pat, updatedAt: 1750000000000, updatedBy: 'S. Silva' }];
    });
    await page.goto('/links.html');
    await expect(page.locator('#linksGridBodyRows tr')).toHaveCount(ROTATING_LINES);

    const cellBtn = page.locator('tr[data-pos="1"] .shift-cell-btn').first();
    await expect(cellBtn).toHaveText('RD');
    await cellBtn.click();

    // No native control anywhere — that is the change. And the cell's own button is still there.
    const sheet = page.locator('.picker-sheet-overlay');
    await expect(sheet).toBeVisible();
    expect(await page.locator('.shift-cell-select').count(),
        'the cell must not be swapped for a native select').toBe(0);
    await expect(cellBtn, 'the cell is not taken apart to be edited').toBeVisible();

    // The current value is marked, so the sheet says what the cell already holds.
    await expect(page.locator('.picker-opt[data-value="RD"]')).toHaveAttribute('aria-current', 'true');
    // And pointing at it keeps it marked (v25.20): the hover rule out-ranked the current row's tint, so
    // on a desktop the ticked row went grey under the pointer — the one row wearing the page's colour.
    const currentRow = page.locator('.picker-opt[data-value="RD"]');
    // A colour read mid-transition is an interpolation, not either end of it — so each read waits
    // for the row's own transitions to FINISH (the Web Animations API lists CSS transitions), where
    // these were two 250ms sleeps "past the row's fast background transition" (test audit, 7 Nov 2026).
    const settledBackground = () => currentRow.evaluate(async el => {
        await Promise.all(el.getAnimations().map(a => a.finished));
        return getComputedStyle(el).backgroundColor;
    });
    await page.mouse.move(1, 1);
    const tint = await settledBackground();
    expect(tint, 'the current row is tinted').not.toBe('rgba(0, 0, 0, 0)');
    await currentRow.hover();
    expect(await settledBackground(), 'hover keeps the tint').toBe(tint);

    // Dismissing changes nothing. The old editor needed a flag and a blur listener to guarantee
    // this; now it is true because nothing was destroyed in the first place.
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    // A pick is applied once the sheet's close has LANDED — the fade AND the echo of its own
    // `history.back()` (select-sheet.js → overlay.js). So wait for that landing, the moment a pick
    // would have been written, rather than 400ms "past the post-fade window" (test audit,
    // 7 Nov 2026): the sheet's history entry is gone only once the echo has arrived.
    await expect.poll(() => page.evaluate(() => !!history.state?.mybOverlay),
        { message: 'the sheet\'s close never landed' }).toBe(false);
    await expect(cellBtn).toHaveText('RD');

    // And a pick applies.
    await cellBtn.click();
    await page.locator('.picker-opt[data-value="SPARE"]').click();
    await expect(cellBtn).toHaveText('SP');
});

// THE SHEET'S SEARCH BOX SAYS WHAT IT SEARCHES (whole-app fix, Nov 2026 — shared-ui-5, lead-5). The
// sheet's title is the CELL, "Line 1 · Sun", which names a place rather than the list, so the box was
// called "Search line 1 · sun" and then, by the shared rule for a title that is not plain words, just
// "Search". The coordinator knows what the list holds, and names the box itself.
test('links: the shift sheet\'s search box is called "Search shift times"', async ({ page }) => {
    await openWindowDesign(page);
    await page.locator('tr[data-pos="1"] .shift-cell-btn').first().click();
    const box = page.locator('.picker-sheet .picker-search-input');
    await expect(box, 'premise: the shift list is long enough to be given a search box').toBeVisible();
    await expect(box).toHaveAccessibleName('Search shift times');
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
        for (let i = 1; i <= 26; i++) {
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

    // Now dirty the design and print again. The cell editor opens the app's own sheet since
    // v23.38 — `__custom__` is excluded because picking it opens a prompt dialog rather than
    // setting a value, and `.is-current` because re-picking the open one is a no-op by design.
    await page.locator('tr[data-pos="1"] .shift-cell-btn').first().click();
    await page.locator('.picker-sheet .picker-opt[data-value]:not(.is-current)'
        + ':not([data-value="__custom__"])').first().click();
    // Wait for the edit to LAND, not merely for the sheet to shut — the pick is applied after the
    // overlay's fade. (`#printDesignName` cannot be polled for this: it is stamped by the
    // `beforeprint` handler, so it still holds the previous print's text until the button below.)
    await expect(page.locator('tr[data-pos="1"] .shift-cell-btn').first()).toHaveText('SP');
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
    expect(printed.gridH, 'the rotation must stay on ONE sheet').toBeLessThanOrEqual(718);
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
        // Blank the line first and wait for it to be WRITTEN, not read it straight after the
        // confirm: since the Sep 2026 review a dialog resolves once its close has landed, so the
        // generate runs a beat after the click, and a read taken at the click saw an empty line.
        await page.evaluate(() => { const s = document.getElementById('linksSaveStatus'); if (s) s.textContent = ''; });
        await page.locator('#genApplyBtn').click({ force: true });
        const ok = page.locator('.dialog-btn-confirm');
        if (await ok.count()) await ok.first().click();
        await expect(page.locator('#linksSaveStatus')).toContainText(/longest block/, { timeout: 10_000 });
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
        for (let i = 1; i <= 26; i++) pat[String(i)] = { sun: 'RD', mon: '06:20-14:20', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' };
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
    await sheetAction(page, 'designBinBtn');
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
        for (let i = 1; i <= 26; i++) pat[String(i)] = { sun: 'RD', mon: '06:20-14:20', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' };
        w.__E2E.docs = [
            { id: 'live', name: 'Option A', patterns: pat, updatedAt: 1750000000000, updatedBy: 'S. Silva' },
            // Deleted RECENTLY — a 30-day-old deletion is purged on load and the bin button never appears.
            { id: 'gone', name: 'Old idea', patterns: pat, updatedAt: 1750000000000, updatedBy: 'S. Silva',
              deletedAt: Date.now() - 2 * 86400000, deletedBy: 'S. Silva' },
        ];
    });
    await page.goto('/links.html');
    await expect(page.locator('#linksGridBodyRows tr')).toHaveCount(ROTATING_LINES);
    await sheetAction(page, 'designBinBtn');
    await expect(page.locator('#designBinLightbox.visible')).toBeVisible();
    await page.locator('#designBinList button:has-text("Remove for good")').first().click();
    await expect(page.locator('.lb-overlay.visible')).toHaveCount(2);

    await page.keyboard.press('Escape');
    // SETTLED, not slept (test audit, 7 Nov 2026 — this was a 600ms wait and ONE sample of
    // `.visible`). Two things make it deterministic. The confirm is waited for until it is gone: its
    // node is removed once its close has landed. And the bin is read by `.open`, which
    // `dismissOverlay` takes off the moment an overlay is asked to close — `.visible` lingers until
    // the fade ends, so a sample taken mid-fade of a bin that WAS wrongly closed read as open.
    await expect(page.locator('.dialog-overlay')).toHaveCount(0);
    const after = await page.evaluate(() => ({
        bin: !!document.querySelector('#designBinLightbox.visible.open'),
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
    for (let i = 1; i <= 26; i++) {
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

test('links window: a time typed without a colon is shaped into one, so a phone keypad can fill the box', async ({ page }) => {
    // A numeric keypad has no colon (v24.61, iOS audit). Before this, "1420" typed on an iPhone was
    // refused as not a time and the box reverted — the window could not be edited from a phone at all.
    await openWindowDesign(page);
    const before = await page.locator('.cov-heat-cell.heat-gap').count();
    const end = page.locator('#winMonSatEnd');
    await end.fill('');
    await end.pressSequentially('1420');
    await expect(end).toHaveValue('14:20');
    // Focus LEAVES the box, as a thumb's does — no synthetic `change`. A programmatic value set
    // resets WebKit's change baseline, so the commit has to run on blur too (24-hour review).
    await page.keyboard.press('Tab');
    await expect(end).toHaveValue('14:20');                            // accepted, not reverted
    await expect.poll(() => page.locator('.cov-heat-cell.heat-gap').count()).toBeLessThan(before);
    // Three digits whose first pair is no hour are settled when the box is LEFT, not as they are
    // typed: the box used to read "240" as 02:40 before the 0 of "2400" could arrive (whole-app
    // review, Oct 2026). The commit has to read the SETTLED form, or "24:5" is refused and reverted.
    const start = page.locator('#winMonSatStart');
    await start.fill('');
    await start.pressSequentially('245');
    await expect(start, 'still typing: it may yet be a four-digit time').toHaveValue('24:5');
    await page.keyboard.press('Tab');
    await expect(start, 'left as three digits, it is a dropped zero, and committed as one').toHaveValue('02:45');
});

test('links window: compare states BOTH windows and flags that they differ', async ({ page }) => {
    // Compare diffs CELLS, so without this two designs built to different spans would read as like
    // for like — the per-design window becoming a way to make an unfair comparison look fair.
    await openWindowDesign(page, [{
        id: 'b', name: 'Later Sunday', patterns: morningOnlyPatterns(), updatedAt: 1750000000000, updatedBy: 'S. Silva',
        window: { monSat: { start: '06:20', end: '23:55' }, sun: { start: '07:15', end: '23:55' } },
    }]);
    await sheetAction(page, 'compareBtn');
    await expect(page.locator('.compare-window').first()).toBeVisible();
    // Order-agnostic: designs sort by NAME, so which one lands in column A is not this test's
    // business — that BOTH windows are stated, and that the difference is called out, is.
    const heads = await page.locator('#compareHeadA, #compareHeadB').allTextContents();
    const joined = heads.join(' | ');
    expect(joined, 'the standard Sunday finish must be stated').toContain('Sun 07:15–23:25');
    expect(joined, 'the moved Sunday finish must be stated').toContain('Sun 07:15–23:55');
    expect(await page.locator('.compare-window--differs').count()).toBe(2);

    // The window editor stays usable in compare mode, so an edit must reach the comparison too —
    // v24.25 repainted only the coverage card, and the heads and analysis kept the old window.
    // Order-agnostic, like the heads above: move the ACTIVE design's Sunday finish to the other's.
    const sunEnd = page.locator('#winSunEnd');
    await sunEnd.fill((await sunEnd.inputValue()) === '23:55' ? '23:25' : '23:55');
    await sunEnd.dispatchEvent('change');
    await expect(page.locator('.compare-window--differs')).toHaveCount(0);
    await expect(page.locator('#compareAnalysis')).not.toContainText('staffed over different hours');
});

// ── Compare: only the lines that differ, and the two columns on the same day (v22.77) ───────────
//
// The unit suite owns the rules — which lines are marked, when the control is offered, what the
// strip claims while it is on. These are the two things only a browser answers: that pressing the
// button actually filters (the handler is attached to markup written by `innerHTML`, so nothing in
// Node can see it fire), and that scrolling one column moves the other, which is a layout fact
// about two independent `overflow-x` areas and has no representation outside a rendered page.

/** A design differing from `morningOnlyPatterns()` on exactly `n` lines. */
function partlyDifferentPatterns(n) {
    /** @type {any} */ const p = morningOnlyPatterns();
    for (let i = 1; i <= n; i++) p[String(i)] = { ...p[String(i)], mon: '12:00-19:00' };
    return p;
}

test('links compare: the filter hides the identical lines, and says so both ways', async ({ page }) => {
    await openWindowDesign(page, [{
        id: 'b', name: 'Nearly the same', patterns: partlyDifferentPatterns(3),
        updatedAt: 1750000000000, updatedBy: 'S. Silva',
    }]);
    await sheetAction(page, 'compareBtn');
    await expect(page.locator('#compareGridBodyRowsA tr')).toHaveCount(ROTATING_LINES);

    const btn = page.locator('#compareDiffOnlyBtn');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText(/Show only the 3 lines that differ/);
    await btn.click();

    // VISIBLE rows, not rendered rows — the filter is CSS over a complete grid, so a count of `tr`
    // would pass with the stylesheet deleted. Both columns, because a filter applied to one only
    // would put the two grids out of step row for row, which is worse than not filtering at all.
    await expect(page.locator('#compareGridBodyRowsA tr:visible')).toHaveCount(3);
    await expect(page.locator('#compareGridBodyRowsB tr:visible')).toHaveCount(3);
    await expect(page.locator('#compareGridBodyRowsA tr')).toHaveCount(ROTATING_LINES);

    // The claim that keeps the three visible rows from being read as the basis of the figures.
    await expect(page.locator('#compareSummary')).toContainText(`still cover all ${ROTATING_LINES} lines`);
    await expect(page.locator('.compare-filter-note')).toContainText(`${ROTATING_LINES - 3} identical lines hidden`);

    // ON is the page's colour, and it stays that colour UNDER THE POINTER that switched it on (v25.16).
    // `.btn-set`'s hover rule out-specified the pressed one, so the filter turned grey for as long as
    // the mouse stayed on it — on the desktop, the moment straight after every press. The pointer is
    // still on the button here: Playwright's click leaves it there, exactly as a hand would.
    const paint = () => btn.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)).then(() => {
        const probe = document.createElement('i');
        probe.style.background = 'var(--page-accent)';
        document.body.append(probe);
        const want = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return { got: getComputedStyle(el).backgroundColor, want, hovered: el.matches(':hover') };
    }));
    const on = await paint();
    expect(on.got, `the switched-on filter is ${on.got} under the pointer (hovered: ${on.hovered}); it must stay the page's colour, ${on.want}`).toBe(on.want);

    await btn.click();
    await expect(page.locator('#compareGridBodyRowsA tr:visible')).toHaveCount(ROTATING_LINES);
    await expect(page.locator('#compareSummary')).not.toContainText('still cover all');
});

test('links compare: the analysis of the difference renders with the two grids', async ({ page }) => {
    // The unit suites own what the analysis SAYS. This is the wiring: compare mode opened in a real
    // page reaches `renderAnalysis`, and the three groups arrive in the section the markup reserves.
    await openWindowDesign(page, [{
        id: 'b', name: 'Nearly the same', patterns: partlyDifferentPatterns(3),
        updatedAt: 1750000000000, updatedBy: 'S. Silva',
    }]);
    await sheetAction(page, 'compareBtn');
    const an = page.locator('#compareAnalysis');
    await expect(an.locator('.compare-an-head')).toHaveText([/^Against the service/, /^Company limits/, /^Fatigue factors/]);
    await expect(an).toBeVisible();
    await an.screenshot({ path: process.env.COMPARE_SHOT || 'test-results/compare-analysis.png' });
});

// Keep only the shortlist pressed IN COMPARE MODE, the open design staying (links-app-10). It reset compare
// and redrew the picker alone: both compare grids stayed on screen under a button reading "Compare with…",
// with no paint bar, and the main grid hidden by a body class nothing removed.
test('links compare: Keep only the shortlist ends compare mode and puts the grid back', async ({ page }) => {
    await openWindowDesign(page, [{
        id: 'fresh', name: 'Fresh start', patterns: partlyDifferentPatterns(3),
        updatedAt: 1_794_000_000_000, updatedBy: 'G. Miller',   // saved after the shortlist: it stays
    }]);
    await expect(activeDesignName(page)).toHaveText('Fresh start');
    await sheetAction(page, 'compareBtn');   // against "Morning heavy", saved long before
    await expect(page.locator('body')).toHaveClass(/links-compare-on/);
    await sheetAction(page, 'keepShortlistBtn');
    await clickDialogConfirm(page);
    await expect(page.locator('#linksSaveStatus')).toContainText('The older design is in Recently deleted');
    await expect(activeDesignName(page)).toHaveText('Fresh start');
    await expect(page.locator('body')).not.toHaveClass(/links-compare-on/);
    await expect(page.locator('#compareGridsWrap')).not.toHaveClass(/compare-mode-active/);
    await expect(page.locator('#linksGridWrapper'), 'the grid is back').toBeVisible();
    await expect(page.locator('#brushBar'), 'and the paint bar with it').toBeVisible();
    await expect(page.locator('#compareBtn')).toHaveAttribute('aria-pressed', 'false');
});

test('links compare: scrolling one column moves the other to the same day', async ({ page }) => {
    await openWindowDesign(page, [{
        id: 'b', name: 'Nearly the same', patterns: partlyDifferentPatterns(3),
        updatedAt: 1750000000000, updatedBy: 'S. Silva',
    }]);
    await sheetAction(page, 'compareBtn');
    await expect(page.locator('#compareGridBodyRowsA tr')).toHaveCount(ROTATING_LINES);

    const cols = page.locator('.compare-grid-scroll');
    await expect(cols).toHaveCount(2);
    // Narrow enough that the 560px-minimum tables genuinely overflow their columns — without real
    // overflow `scrollLeft` stays 0 and the assertion below would pass on a broken sync.
    await page.setViewportSize({ width: 1024, height: 1000 });
    const room = await cols.first().evaluate(el => el.scrollWidth - el.clientWidth);
    expect(room, 'the columns must actually overflow, or this test proves nothing').toBeGreaterThan(0);

    // WITHIN RANGE, deliberately. The first cut asked for 120px against 103px of travel, and the
    // browser clamped — so the assertion failed on a working sync, which is the kind of red that
    // gets a correct guard deleted. Half the available travel is reachable at any viewport.
    const mid = Math.round(room / 2);
    expect(mid).toBeGreaterThan(0);
    await cols.first().evaluate((el, x) => { el.scrollLeft = x; }, mid);
    await expect.poll(() => cols.nth(1).evaluate(el => el.scrollLeft)).toBe(mid);

    // And back the other way — a one-directional sync reads as working until you scroll the second
    // column, which is the one a designer reaches for when the first is already where they want it.
    //
    // THE FRAME IS NOT A SLEEP TO MAKE THIS PASS (v22.78). Both scrolls above are assignments and
    // nothing else: the browser delivers its own `scroll`, so this exercises the path the feature
    // actually runs on. The first cut hand-fired a synthetic `scroll` immediately after each
    // assignment, which put two events inside a single animation frame — the second landing inside
    // the guard the first had just armed. That is not something a user or a browser can do, and it
    // failed on WebKit while passing on Chromium, which reads exactly like an engine bug and is not
    // one: the pre-fix module passes this version. Two real gestures are always a frame apart, so
    // waiting one is the honest model. Teeth checked by deleting the sync — both directions go to 0.
    const quarter = Math.max(1, Math.round(room / 4));
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r(null))));
    await cols.nth(1).evaluate((el, x) => { el.scrollLeft = x; }, quarter);
    await expect.poll(() => cols.first().evaluate(el => el.scrollLeft)).toBe(quarter);
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

    await sheetAction(page, 'compareBtn');
    await expect(page.locator('.compare-window').first()).toBeVisible();
    await expect(who).toHaveCount(1);
    // It must name the ACTIVE design, not just any of them — a chip carrying the wrong name is
    // worse than no chip, because it attributes the figures to the design they do not describe.
    const active = (await activeDesignName(page).textContent() || '').trim();
    expect(active.length, 'no active design name to compare against').toBeGreaterThan(0);
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
    await sheetAction(page, 'designBinBtn');
    await expect(page.locator('#designBinLightbox.visible')).toBeVisible();
    await page.locator('#designBinList button:has-text("Restore")').first().click();
    await page.locator('#designBinClose').click();
    await switchToDesign(page, 'Binned early start');
    await expect(page.locator('#winMonSatStart')).toHaveValue('05:00');
    await expect(page.locator('#winMoved')).toBeVisible();
});

// ── Found by the Sep 2026 review — each is the WIRING of a rule the unit suites cannot see ───────
test('links review: a saved window survives switching away and back', async ({ page }) => {
    // The saved entry took the patterns and not the window, so switching back rebuilt the working
    // copy on the OLD window — and the next save wrote it over the one just saved.
    await openWindowDesign(page, [{ id: 'd2', name: 'Other', patterns: morningOnlyPatterns(),
        updatedAt: 1750000000000, updatedBy: 'S. Silva' }]);
    await page.locator('#winMonSatStart').fill('05:00');
    await page.locator('#winMonSatStart').dispatchEvent('change');
    await page.locator('#linksSaveBtn').click();
    await expect(page.locator('#linksSaveStatus')).toContainText('Saved');
    await switchToDesign(page, 'Other');
    await expect(activeDesignName(page)).toHaveText('Other');
    await switchToDesign(page, 'Morning heavy');
    await expect(activeDesignName(page)).toHaveText('Morning heavy');
    await expect(page.locator('#winMonSatStart')).toHaveValue('05:00');
});

test('links review: Import asks before it replaces unsaved work', async ({ page }) => {
    await openWindowDesign(page);
    await page.locator('#winMonSatEnd').fill('14:20');
    await page.locator('#winMonSatEnd').dispatchEvent('change');
    await sheetAction(page, 'importDesignBtn');
    const dialog = page.locator('.dialog-overlay');
    await expect(dialog).toContainText('unsaved changes');
    await dialog.locator('.dialog-btn-cancel').click();
    await expect(page.locator('#linksImportLb.visible')).toHaveCount(0);
    await expect(page.locator('#linksSaveBtn')).toBeEnabled();          // still dirty, still here
});

test('links review: a colleague\'s restore settled in the bin leaves your unsaved edits alone', async ({ page }) => {
    // It called loadDesigns, which rebuilt the working copy and cleared `dirty` — the edit gone,
    // and nothing said so.
    await openWindowDesign(page, [{ id: 'gone', name: 'Old idea', patterns: morningOnlyPatterns(),
        updatedAt: 1750000000000, updatedBy: 'S. Silva', deletedAt: Date.now() - 86400000, deletedBy: 'S. Silva' }]);
    await page.evaluate(() => {   // the server now holds it restored; this device's bin is stale
        const w = /** @type {any} */ (window);
        w.__E2E.txDocs = w.__E2E.docs.map((/** @type {any} */ d) => ({ ...d, deletedAt: undefined }));
    });
    await page.locator('#winMonSatEnd').fill('14:20');
    await page.locator('#winMonSatEnd').dispatchEvent('change');
    await sheetAction(page, 'designBinBtn');
    await page.locator('#designBinList button:has-text("Restore")').first().click();
    await expect(page.locator('#designBinStatus')).toContainText(/already been restored/i);
    await page.locator('#designBinClose').click();
    await expect(page.locator('#winMonSatEnd')).toHaveValue('14:20');
    await expect(page.locator('#linksSaveBtn')).toBeEnabled();
});

test('links review: a binned design cannot be restored under a name already in use', async ({ page }) => {
    await openWindowDesign(page, [{ id: 'gone', name: 'Morning heavy', patterns: morningOnlyPatterns(),
        updatedAt: 1750000000000, updatedBy: 'S. Silva', deletedAt: Date.now() - 86400000, deletedBy: 'S. Silva' }]);
    await sheetAction(page, 'designBinBtn');
    await page.locator('#designBinList button:has-text("Restore")').first().click();
    await expect(page.locator('#designBinStatus')).toContainText('already a design called');
    const writes = await page.evaluate(() => /** @type {any} */ (window).__E2E.setWrites || []);
    expect(writes, 'nothing was restored').toEqual([]);
});

test('links review: a design found deleted on save leaves the list, and the copy asks nothing more', async ({ page }) => {
    await openWindowDesign(page, [{ id: 'd2', name: 'Other', patterns: morningOnlyPatterns(),
        updatedAt: 1750000000000, updatedBy: 'S. Silva' }]);
    await page.evaluate(() => {   // S. Silva binned it while it was open here
        const w = /** @type {any} */ (window);
        w.__E2E.txDocs = w.__E2E.docs.map((/** @type {any} */ d) => d.id === 'd1'
            ? { ...d, deletedAt: Date.now(), deletedBy: 'S. Silva' } : d);
    });
    await page.locator('#winMonSatEnd').fill('14:20');
    await page.locator('#winMonSatEnd').dispatchEvent('change');
    await page.locator('#linksSaveBtn').click();
    const dialog = page.locator('.dialog-overlay');
    await expect(dialog).toContainText('deleted this design');
    await expect(designOptions(page)).toHaveCount(1);                 // out of the live list
    await dialog.locator('.dialog-btn-confirm').click();              // "Save mine as new"
    // Straight to the name — not "goes back to its last save" about a design that is in the bin.
    const next = page.locator('.dialog-overlay.visible');
    await expect(next).toContainText('Name for the duplicate');
    await expect(next).not.toContainText('last save');
});

test('links re-review: a save still in flight locks only ITS design, and a deletion it finds still leaves the list', async ({ page }) => {
    // Two defects with one shape — the page moved on while a write was in flight. The "saving" flag
    // was page-wide, so a write that could not finish locked every design's Save; and a save that
    // came back "deleted elsewhere" after a switch returned early and left the design in the picker.
    await openWindowDesign(page, [{ id: 'd2', name: 'Other', patterns: morningOnlyPatterns(),
        updatedAt: 1750000000000, updatedBy: 'S. Silva' }]);
    await page.evaluate(() => {   // S. Silva binned "Morning heavy"; the server is slow to say so
        const w = /** @type {any} */ (window);
        w.__E2E.txDocs = w.__E2E.docs.map((/** @type {any} */ d) => d.id === 'd1'
            ? { ...d, deletedAt: Date.now(), deletedBy: 'S. Silva' } : d);
        w.__E2E.txHold = true;   // the save stays in flight until the test releases it below
    });
    await page.locator('#winMonSatEnd').fill('14:20');
    await page.locator('#winMonSatEnd').dispatchEvent('change');
    await page.locator('#linksSaveBtn').click();
    await expect(page.locator('#linksSaveBtn')).toBeDisabled();          // this design: in flight
    await switchToDesign(page, 'Other');
    const leave = page.locator('.dialog-overlay.visible');                // leave the unsaved edit
    await expect(leave).toContainText('unsaved changes');
    await leave.locator('.dialog-btn-confirm').click();
    await expect(activeDesignName(page)).toHaveText('Other');
    await page.locator('#winMonSatEnd').fill('14:40');
    await page.locator('#winMonSatEnd').dispatchEvent('change');
    // A short timeout on purpose: a retrying assertion would otherwise wait out the first save.
    await expect(page.locator('#linksSaveBtn'), 'another design\'s Save is not locked by it').toBeEnabled({ timeout: 1500 });
    await page.evaluate(() => /** @type {any} */ (window).__E2E.releaseTx());   // now the first save lands
    await expect(page.locator('#linksSaveStatus')).toContainText('was deleted elsewhere', { timeout: 10000 });
    await expect(designOptions(page)).toHaveCount(1);                     // out of the live list anyway
    await expect(page.locator('.dialog-overlay.visible')).toHaveCount(0); // and no dialog about it
});

test('links re-review: an offline save says it is in this browser, not "✓ Saved"', async ({ page, context }) => {
    // The store queues the write and returns 'queued'; the page read that as a server-confirmed save.
    // And it promised an upload "when you're back online", which a page iOS has closed cannot make: the
    // queue goes up the next time Links is open in this browser with a connection (iPhone audit, Nov 2026).
    await openWindowDesign(page);
    await page.evaluate(() => {   // no server, and no cached copy to consult — so the store queues
        const w = /** @type {any} */ (window);
        w.__E2E.txErrorCode = 'unavailable';
        w.__E2E.failGetDoc = true;
    });
    await context.setOffline(true);
    await page.locator('#winMonSatEnd').fill('14:20');
    await page.locator('#winMonSatEnd').dispatchEvent('change');
    await page.locator('#linksSaveBtn').click();
    const status = page.locator('#linksSaveStatus');
    await expect(status).toHaveText('Saved in this browser — it uploads the next time Links is open here with a connection');
    await expect(status).not.toContainText('back online');
    await expect(status).not.toContainText('✓');
    await expect(status).not.toHaveClass(/\bok\b/);
    // The masthead's pill says it too, rather than "Saved today at …" off this device's clock (links-app-4).
    await expect(page.locator('#designStatusLong')).toHaveText('Saved in this browser');
    await context.setOffline(false);
});

// A DESIGN REMOVED FOR GOOD, SAVED OFFLINE (links-design-12). Offline, the store consults what this
// device holds before it queues a save. Plain getDoc rejects offline for a document the cache KNOWS was
// deleted exactly as for one it never held (measured against the real SDK), so the save was queued over
// a design a colleague had removed for good, and brought it back on sync. The page now hands the store
// getDocFromCache, which tells the two apart.
test('links: an offline save of a design this device knows was removed for good is not queued', async ({ page, context }) => {
    await openWindowDesign(page);
    await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        w.__E2E.txErrorCode = 'unavailable';   // no server
        w.__E2E.failGetDoc = true;             // and offline getDoc rejects, as the real one does
        w.__E2E.docCache = { d1: null };       // the cache recorded that the design was removed
    });
    await context.setOffline(true);
    await page.locator('#winMonSatEnd').fill('14:20');
    await page.locator('#winMonSatEnd').dispatchEvent('change');
    await page.locator('#linksSaveBtn').click();
    await expect(page.locator('.dialog-overlay.visible')).toContainText('removed this design for good');
    const written = await page.evaluate(() => (/** @type {any} */ (window).__E2E.setWrites || [])
        .filter((/** @type {any} */ w) => /\/d1$/.test(w.path)).length);
    expect(written, 'nothing is queued over the removed design').toBe(0);
    await context.setOffline(false);
});

// ── A design MADE while a write is in flight (whole-app fix, Nov 2026 — links-app-3) ─────────────────
// A create resolves only when the server answers. With the signal up but not answering, Save a copy
// as… and New blank design showed nothing, a second press passed the duplicate-name check (the first
// was not in the list yet) and made two, and the landing opened the new design over whatever had been
// done meanwhile, clearing `dirty` over it. The create is HELD here (addDocHold), as the slow server.
test('links: Save a copy as… says it is saving, makes one copy per press, and a late landing keeps later edits', async ({ page }) => {
    await openWindowDesign(page);
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.addDocHold = true; });
    const status = page.locator('#linksSaveStatus');
    await sheetAction(page, 'dupDesignBtn');
    await page.locator('.dialog-overlay .dialog-input').fill('Copy A');
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');
    await expect(status).toHaveText('Saving a copy as “Copy A”…');

    // A second press while it is in flight makes nothing more.
    await sheetAction(page, 'dupDesignBtn');
    await expect(status).toContainText('“Copy A” is still being created');
    await expect(page.locator('.dialog-overlay'), 'no second name prompt').toHaveCount(0);

    // The designer carries on, and edits the design in front of them.
    await page.locator('#winMonSatEnd').fill('22:00');
    await page.locator('#winMonSatEnd').dispatchEvent('change');
    await expect(page.locator('#linksSaveBtn')).toBeEnabled();

    // The copy lands: it joins the list, and does NOT open over the edit.
    await page.evaluate(() => /** @type {any} */ (window).__E2E.releaseAddDoc());
    await expect(status).toContainText('The copy “Copy A” is in the list');
    await expect(status).toContainText('edited meanwhile');
    await expect(activeDesignName(page)).toHaveText('Morning heavy');
    await expect(page.locator('#winMonSatEnd')).toHaveValue('22:00');
    await expect(page.locator('#linksSaveBtn'), 'the edit is still unsaved work').toBeEnabled();
    await expect(designOptions(page).filter({ hasText: 'Copy A' })).toHaveCount(1);
    const added = () => page.evaluate(() => (/** @type {any} */ (window).__E2E.setWrites || []).filter((/** @type {any} */ w) => w.added).length);
    expect(await added(), 'two presses, one copy').toBe(1);

    // And a New blank design that nothing interrupts opens when it lands, as it always did.
    await page.locator('#linksSaveBtn').click();
    await expect(status).toHaveText('✓ Saved');
    await page.evaluate(() => { /** @type {any} */ (window).__E2E._addDocGate = null; });   // hold the next create too
    await sheetAction(page, 'newDesignBtn');
    await page.locator('.dialog-overlay .dialog-input').fill('Option N');
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');
    await expect(status).toHaveText('Creating “Option N”…');
    await sheetAction(page, 'newDesignBtn');
    await expect(status).toContainText('“Option N” is still being created');
    await page.evaluate(() => /** @type {any} */ (window).__E2E.releaseAddDoc());
    await expect(activeDesignName(page)).toHaveText('Option N');
    expect(await added()).toBe(2);
});

// A DELETE THAT LANDS AFTER AN EDIT KEEPS THE EDIT (links-design's lead on deleteDesign). The soft delete
// is a transaction now (links-design-2's delete half), so the e2e can hold it with `txHold`, as a slow
// server does. The design goes to the bin as it was last SAVED, and what was changed while the delete was
// in flight stays on screen as an unsaved new design: the landing used to open the next design over it.
test('links: a delete that lands after an edit keeps the edit, as a new unsaved design', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('myb_links_active_design', 'd1'));
    await openWindowDesign(page, [{ id: 'd2', name: 'Other', patterns: {}, updatedAt: 1750000000000, updatedBy: 'S. Silva' }]);
    await expect(activeDesignName(page)).toHaveText('Morning heavy');
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.txHold = true; });   // the server is slow to answer
    await sheetAction(page, 'designDeleteBtn');
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');
    const status = page.locator('#linksSaveStatus');
    await expect(status).toHaveText('Deleting “Morning heavy”…');
    await page.locator('#winMonSatEnd').fill('14:20');   // the designer carries on
    await page.locator('#winMonSatEnd').dispatchEvent('change');
    await page.evaluate(() => /** @type {any} */ (window).__E2E.releaseTx());
    await expect(status).toContainText('“Morning heavy” is in Recently deleted. What you changed while it was being deleted is still here, not saved');
    await expect(activeDesignName(page), 'not the next design, opened over the edit').toHaveText('Untitled design');
    await expect(page.locator('#winMonSatEnd')).toHaveValue('14:20');
    await expect(page.locator('#linksSaveBtn'), 'still unsaved work').toBeEnabled();
});

// A NEW DESIGN THE SERVER DOES NOT ANSWER (links-design-2's create half). Online — the browser says so —
// with a server that never replies, New blank design said "Creating …" until the signal came back,
// while the designer went on working. The store now names the document first and gives the create as
// long as a slow save gets, then calls it queued: the design opens, saved in this browser. The page's
// clock is a fake one here, so the bound itself is what is waited for, not eight real seconds.
test('links: a new design the server does not answer opens, saved in this browser, instead of "Creating…" for ever', async ({ page }) => {
    const { SLOW_SAVE_MS } = await import('../slow-save.js');
    await page.clock.install();
    await openWindowDesign(page);
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.addDocHold = true; });   // the server never answers
    await sheetAction(page, 'newDesignBtn');
    await page.locator('.dialog-overlay .dialog-input').fill('Option N');
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');
    const status = page.locator('#linksSaveStatus');
    await expect(status).toHaveText('Creating “Option N”…');
    await page.clock.fastForward(SLOW_SAVE_MS);
    await expect(status).toHaveText('Saved in this browser — it uploads the next time Links is open here with a connection');
    await expect(activeDesignName(page)).toHaveText('Option N');
    await expect(page.locator('#designStatusLong')).toHaveText('Saved in this browser');
    const made = await page.evaluate(() => (/** @type {any} */ (window).__E2E.setWrites || []).filter((/** @type {any} */ w) => w.added));
    expect(made.map((/** @type {any} */ w) => w.path), 'one create, named before it was written').toEqual([expect.stringMatching(/^linkDesigns\/e2e-added-\d+$/)]);
});

// A copy made OFFLINE is only in this browser's queue (links-app-4). It used to open as plain "Saved",
// with nothing to say the server does not have it yet — unlike a Save in the same state.
test('links: a copy made offline says it is saved in this browser, not "Saved"', async ({ page, context }) => {
    await openWindowDesign(page);
    await context.setOffline(true);
    await sheetAction(page, 'dupDesignBtn');
    await page.locator('.dialog-overlay .dialog-input').fill('Offline copy');
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');
    const status = page.locator('#linksSaveStatus');
    await expect(status).toHaveText('Saved in this browser — it uploads the next time Links is open here with a connection');
    await expect(status).not.toHaveClass(/\bok\b/);
    // …and so does the masthead's pill, where it said "Saved" (links-app-4).
    await expect(activeDesignName(page)).toHaveText('Offline copy');
    await expect(page.locator('#designStatus')).toHaveClass(/dm-status--queued/);
    await expect(page.locator('#designStatusLong')).toHaveText('Saved in this browser');
    await expect(page.locator('#designStatusShort')).toHaveText('Saved here');
    await context.setOffline(false);
});

// AN IMPORT MADE OFFLINE is only in this browser's queue too. Its line said so (links-design-8), and the
// masthead's pill still said "Saved", as though a colleague could already open it: the coordinator keeps
// the queued designs for the pill, and the import panel never told it about one.
test('links: an import made offline says it is saved in this browser, in the pill as well as the line', async ({ page, context }) => {
    await openWindowDesign(page);
    await context.setOffline(true);
    await sheetAction(page, 'importDesignBtn');
    await page.locator('#linksImportText').fill('1\tNA\t06:20-13:50\tRD\tRD\t06:20-13:50\t06:20-13:50\t06:20-14:20');
    await page.locator('#linksImportCheck').click();
    await page.locator('#linksImportName').fill('Offline import');
    await page.locator('#linksImportSave').click();
    await expect(page.locator('#linksSaveStatus')).toContainText('Saved in this browser — it uploads the next time Links is open here with a connection');
    await expect(activeDesignName(page)).toHaveText('Offline import');
    await expect(page.locator('#designStatusLong')).toHaveText('Saved in this browser');
    await expect(page.locator('#designStatusShort')).toHaveText('Saved here');
    await expect(page.locator('#designStatus')).toHaveClass(/dm-status--queued/);
    await context.setOffline(false);
});

// A row stays tappable through its sheet's fade, and each tap closes the sheet and runs the row after
// the fade — so a DOUBLE TAP ran it twice (links-app-11): Compare on and straight back off, two Rename
// prompts, and on a picker row two "unsaved changes" questions stacked.
test('links: a double tap on a ··· More row runs it once, and on a picker row asks once', async ({ page }) => {
    await openLinksWithDesigns(page);
    await openDesignSheet(page);
    await page.locator('#compareBtn').dblclick();
    await expect(page.locator('#compareBtn'), 'compare is ON — not on and straight back off').toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('body')).toHaveClass(/links-compare-on/);
    await page.waitForTimeout(700);   // the second tap's run would land 500ms after it; prove it did not
    await expect(page.locator('#compareBtn')).toHaveAttribute('aria-pressed', 'true');
    await sheetAction(page, 'compareBtn');   // the sheet re-arms on the next opening
    await expect(page.locator('#compareBtn')).toHaveAttribute('aria-pressed', 'false');

    await openDesignSheet(page);
    await page.locator('#designRenameMenuBtn').dblclick();
    await expect(page.locator('.dialog-overlay')).toHaveCount(1);
    await page.waitForTimeout(700);
    await expect(page.locator('.dialog-overlay'), 'one Rename prompt').toHaveCount(1);
    await page.locator('.dialog-overlay .dialog-btn-cancel').click();
    await expect(page.locator('.dialog-overlay')).toHaveCount(0);

    // A picker row, with unsaved work: one question.
    await page.locator('#brushBar .brush-chip').nth(2).click();
    await page.locator('.shift-cell-btn').first().click();
    await expect(page.locator('#linksSaveBtn')).toBeEnabled();
    await openDesignPicker(page);
    await designOptions(page).filter({ hasText: 'Design B' }).dblclick();
    await expect(page.locator('.dialog-overlay')).toHaveCount(1);
    await page.waitForTimeout(700);
    await expect(page.locator('.dialog-overlay'), 'one switch question').toHaveCount(1);
});

test('links re-review: declining to replace your OWN other version is not worded as "theirs"', async ({ page }) => {
    await openWindowDesign(page);
    await page.evaluate(() => {   // this design was saved since, under this member's own name
        const w = /** @type {any} */ (window);
        w.__E2E.txDocs = w.__E2E.docs.map((/** @type {any} */ d) => d.id === 'd1'
            ? { ...d, updatedAt: 1760000000000, updatedBy: 'G. Miller', revision: 7 } : d);
    });
    await page.locator('#winMonSatEnd').fill('14:20');
    await page.locator('#winMonSatEnd').dispatchEvent('change');
    await page.locator('#linksSaveBtn').click();
    const dialog = page.locator('.dialog-overlay.visible');
    await expect(dialog).toContainText('This design changed');
    await dialog.locator('.dialog-btn-cancel').click();
    await expect(dialog).toContainText('Keep your version too?');
    await expect(dialog).toContainText('That version stays as it is');
    await expect(dialog).not.toContainText('Their');
});

// THE CONFLICT QUESTION STATES ITS TIME ON THE APP'S ONE CLOCK FACE. It was a bare
// toLocaleTimeString('en-GB', …), which leaves the hour cycle to the locale data; where that falls back
// to 12-hour it read "at 08:53 am" beside a save row on the 24-hour clock. `formatClock` pins 24-hour.
// The fallback is SIMULATED: any call that leaves the hour cycle unset is answered in 12-hour.
test('links: the "this design changed" question states its time on the 24-hour clock', async ({ page }) => {
    await page.addInitScript(() => {
        const native = Date.prototype.toLocaleTimeString;
        Object.defineProperty(Date.prototype, 'toLocaleTimeString', {
            configurable: true, writable: true,
            value(/** @type {any} */ locales, /** @type {any} */ options) {
                const unset = options && options.hourCycle === undefined && options.hour12 === undefined;
                return native.call(this, locales, unset ? { ...options, hourCycle: 'h12' } : options);
            },
        });
    });
    await openWindowDesign(page);
    await page.evaluate(() => {   // this design was saved since, under this member's own name
        const w = /** @type {any} */ (window);
        w.__E2E.txDocs = w.__E2E.docs.map((/** @type {any} */ d) => d.id === 'd1'
            ? { ...d, updatedAt: 1760000000000, updatedBy: 'G. Miller', revision: 7 } : d);
    });
    await page.locator('#winMonSatEnd').fill('14:20');
    await page.locator('#winMonSatEnd').dispatchEvent('change');
    await page.locator('#linksSaveBtn').click();
    const dialog = page.locator('.dialog-overlay.visible');
    await expect(dialog).toContainText('This design changed');
    const clock = await page.evaluate(() => new Date(1760000000000)
        .toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
    await expect(dialog).toContainText(`was saved at ${clock} after you opened this page`);
});

// ── UNSAVED WORK OUTLIVES THE PAGE (iPhone audit, Nov 2026) ─────────────────────────────────────
// The grid and the window lived only in memory, and iOS discards a hidden page without asking. The
// working copy is now kept whenever the page is hidden and offered on the next load (unsaved-draft.js)
// — with the baseline it was edited against, so a colleague's save since still meets the conflict
// question instead of being overwritten by a copy nobody has looked at again.
/** Hide or show the page the way iOS does: the state changes, then the event fires.
 *  @param {import('@playwright/test').Page} page @param {'hidden'|'visible'} state */
async function setVisibility(page, state) {
    await page.evaluate((s) => {
        Object.defineProperty(document, 'visibilityState', { value: s, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
    }, state);
}
/** Reload past the browser's own "Leave site?", which unsaved work arms on a desktop engine.
 *  @param {import('@playwright/test').Page} page */
async function reloadPastLeaveSite(page) {
    const accept = (/** @type {import('@playwright/test').Dialog} */ d) => d.accept().catch(() => {});
    page.on('dialog', accept);
    await page.reload();
    page.off('dialog', accept);
}
const LINKS_DRAFT = 'myb_draft_links_G.%20Miller';

/** Move the Mon–Sat finish on "Morning heavy", hide the page, and return the time the offer names.
 *  @param {import('@playwright/test').Page} page */
async function editWindowAndHide(page) {
    await page.clock.setFixedTime(new Date('2026-11-07T14:20:00Z'));
    await openWindowDesign(page);
    await page.locator('#winMonSatEnd').fill('14:20');
    await page.locator('#winMonSatEnd').dispatchEvent('change');
    await expect(page.locator('#linksSaveBtn')).toBeEnabled();
    await setVisibility(page, 'hidden');
    const kept = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), LINKS_DRAFT);
    expect(kept?.scope, 'hidden while unsaved: the design is kept').toEqual({ design: 'd1' });
    expect(kept?.data?.window?.monSat?.end).toBe('14:20');
    expect(kept?.data?.baseline, '…with the version it was edited against')
        .toEqual({ loadedRevision: null, loadedUpdatedAt: 1750000000000, baselineUnknown: false });
    return page.evaluate(() => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
}

test('links: unsaved work kept when the page was hidden is offered on the next load — and a colleague\'s save since still asks', async ({ page }) => {
    const clock = await editWindowAndHide(page);
    // S. Silva saves "Morning heavy" while this phone has Links in the background. The reload reads HER
    // version, so only the baseline the draft kept can tell the next save what it would overwrite.
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window);
        w.__E2E.docs = w.__E2E.docs.map((/** @type {any} */ d) => (d.id === 'd1'
            ? { ...d, revision: 7, updatedAt: 1760000000000, updatedBy: 'S. Silva' } : d));
    });
    await reloadPastLeaveSite(page);
    const offer = page.locator('.dialog-overlay.visible');
    await expect(offer).toContainText(`Restore your unsaved changes from ${clock}?`);
    await expect(page.locator('#winMonSatEnd'), 'nothing is put back before the answer').toHaveValue('23:55');
    await offer.getByRole('button', { name: 'Restore' }).click();
    await expect(page.locator('#winMonSatEnd')).toHaveValue('14:20');
    await expect(page.locator('#linksSaveBtn'), 'back as UNSAVED work').toBeEnabled();
    expect(await page.evaluate((k) => localStorage.getItem(k), LINKS_DRAFT), 'cleared once it is the page\'s work again').toBeNull();
    await page.locator('#linksSaveBtn').click();
    const dialog = page.locator('.dialog-overlay.visible');
    await expect(dialog).toContainText('Someone else saved');
    await expect(dialog).toContainText('S. Silva saved a different version');
});

test('links: Discard deletes the kept work and leaves the saved design as it was', async ({ page }) => {
    const clock = await editWindowAndHide(page);
    await reloadPastLeaveSite(page);
    const offer = page.locator('.dialog-overlay.visible');
    await expect(offer).toContainText(`Restore your unsaved changes from ${clock}?`);
    await offer.getByRole('button', { name: 'Discard' }).click();
    await expect(page.locator('.dialog-overlay')).toHaveCount(0);
    await expect(page.locator('#winMonSatEnd')).toHaveValue('23:55');
    await expect(page.locator('#linksSaveBtn'), 'nothing unsaved').toBeDisabled();
    expect(await page.evaluate((k) => localStorage.getItem(k), LINKS_DRAFT)).toBeNull();
});

// A draft of a design that was NEVER saved comes back as a new design (links-app-9). That path set the
// ids and nothing else, so the sticky row went on reading "Last saved by S. Silva …" — the design the
// load had opened a moment before — and the generator went on showing THAT design's remembered table.
test('links: a never-saved draft restored as a new design names no saver, and shows its own targets', async ({ page }) => {
    await seedContractTargets(page, { designIds: ['unsaved'] });   // the table a new design builds from: 5 cover weeks
    await page.addInitScript(() => {
        // Morning heavy's own remembered table, with a cover week more, so the two can be told apart.
        localStorage.setItem('myb_links_gen_d1', JSON.stringify({ slots: [{ time: '06:20-14:20', weekday: 6, sat: 4, sun: 0 }], spareLines: 6 }));
    });
    await openWindowDesign(page);
    await expect(page.locator('#linksLastSaved')).toContainText('Last saved by S. Silva');
    // A shortlisted proposal open, Build makes a NEW design beside it — one nobody has saved.
    await openDesignPicker(page);
    await proposalOptions(page).first().click();
    await expect(page.locator('#designEyebrow')).toHaveText('Shortlisted proposal');
    await page.evaluate(() => { document.getElementById('generatorBody')?.classList.add('open'); });
    await page.locator('#genApplyBtn').click();
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');
    await expect(page.locator('#designEyebrow')).toHaveText('New design');
    await setVisibility(page, 'hidden');   // kept, as a design with no id
    await reloadPastLeaveSite(page);

    // The load opens Morning heavy first — its line, its table — and then offers the draft.
    const offer = page.locator('.dialog-overlay.visible');
    await expect(offer).toContainText('Restore your unsaved changes');
    await expect(page.locator('#genSpareLines')).toHaveValue('6');
    await offer.getByRole('button', { name: 'Restore' }).click();
    await expect(page.locator('#designEyebrow')).toHaveText('New design');
    await expect(page.locator('#linksLastSaved'), 'no "Last saved by" on a design nobody has saved').toHaveText('');
    await expect(page.locator('#genSpareLines'), 'the new design\'s own targets').toHaveValue('5');
});

test('links: another designer signing in on the same phone is offered nothing', async ({ page }) => {
    // Two designers on one phone: the real list has been the owner alone since 9 Nov 2026, so the test brings its own.
    await withLinksDesigners(page, ['G. Miller', 'S. Silva']);
    await editWindowAndHide(page);
    await seedSession(page, 'S. Silva');   // a later init script: this reload is S. Silva's
    await reloadPastLeaveSite(page);
    await linksOpened(page);
    await waitForReadsToLand(page);
    await expect(page.locator('.dialog-overlay'), 'never across members').toHaveCount(0);
    await expect(page.locator('#winMonSatEnd')).toHaveValue('23:55');
    expect(await page.evaluate((k) => localStorage.getItem(k), LINKS_DRAFT), 'G. Miller\'s copy is left for G. Miller').not.toBeNull();
});

test('links memory: a stamped SEED is a designer\'s choice and survives a release', async ({ page }) => {
    // Only a stamped DEFAULT is one the app stored on its own; the retirement rule took the seed too.
    const seeded = JSON.parse(JSON.stringify(STALE_SEED));
    seeded.source = 'seed';
    seeded.ver = '21.02';
    await openLinksWithMemory(page, seeded);
    await expect(page.locator('#genMemoryNote')).toBeVisible();
    await expect(page.locator('#genHoursNote')).toContainText('short in total');
});

test('links memory: targets tuned before the first save follow the design it becomes', async ({ page }) => {
    await seedContractTargets(page, { designIds: ['unsaved'] });
    await page.setViewportSize({ width: 1024, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => localStorage.setItem('myb_links_welcome_seen', '1'));
    await page.goto('/links.html');
    await page.locator('#genApplyBtn').click();
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');   // "Apply"
    await expect(page.locator('.dialog-overlay')).toHaveCount(0);
    await page.locator('#linksSaveBtn').click();
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');   // the pre-filled name
    await expect(page.locator('#linksSaveStatus')).toContainText('Saved');
    const ls = await page.evaluate(() => {
        const id = localStorage.getItem('myb_links_active_design');
        return { id, mine: localStorage.getItem('myb_links_gen_' + id), unsaved: localStorage.getItem('myb_links_gen_unsaved') };
    });
    expect(ls.id).toMatch(/^e2e-added-/);
    expect(ls.mine, 'the tuned table is stored under the new design').toContain('"spareLines":5');
    expect(ls.unsaved || '', 'and no longer under the unsaved key').toBe('');
});

test('links memory: a table saved as a set keeps naming that set after a reload', async ({ page }) => {
    await openLinksWithTargetSets(page);
    await page.locator('#genSetSaveAsBtn').click();
    await page.locator('.dialog-input').fill('Weekend trial');
    await clickDialogConfirm(page);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('myb_links_gen_unsaved') || ''))
        .toContain('"setName":"Weekend trial"');
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
    // Was a 700ms sleep (test audit, 7 Nov 2026). The button's position is measured next, and the
    // design list's arrival repaints the grid card above it — see the helper.
    await linksOpened(page);
    await page.evaluate(() => { document.getElementById('generatorBody')?.classList.add('open'); });
    await page.locator('#genApplyBtn').scrollIntoViewIfNeeded();

    const before = await page.evaluate(() =>
        Math.round(/** @type {HTMLElement} */ (document.getElementById('genApplyBtn')).getBoundingClientRect().top));
    await page.locator('#genApplyBtn').click();
    await clickDialogConfirm(page);
    // Wait for the design to exist before measuring anything: a dialog resolves after its close
    // lands, so a check taken at the click would see the pre-generate page — a button that "did
    // not move" because nothing had happened yet, and an empty status to mirror.
    await expect(page.locator('#genStatus')).toBeVisible({ timeout: 10_000 });

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
    // OPENED FIRST (test audit, 7 Nov 2026). This read the editor straight after a 700ms sleep, and
    // `#windowEditor` is `hidden` in the HTML — so "hidden: no design yet" held before the page had
    // loaded anything, and a page that SHOWED the editor with no design (the v19.55 defect) could
    // pass on a slow runner. After the design list has loaded and been painted, it is a real answer.
    await linksOpened(page);
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

// ── THE iPHONE KEYBOARD (iPhone audit, 7 Nov 2026) ──────────────────────────────────────────────────

// iOS raises its keyboard only for a focus made SYNCHRONOUSLY inside the tap. "+ Save as new…" opens
// its name prompt inside the click, and `createLightbox` used to focus the box a frame later, outside
// it — so the caret blinked in a field with no keyboard to type with. The click and the read are one
// `evaluate`, so what is focused when the click handler returns is exactly what the keyboard got.
test('links sets: the name prompt focuses its box inside the tap that opened it', async ({ page }) => {
    await openLinksWithTargetSets(page);
    const inTheTap = await page.evaluate(() => {
        document.getElementById('genSetSaveAsBtn')?.click();
        return document.activeElement?.classList.contains('dialog-input') ?? false;
    });
    expect(inTheTap, 'the prompt\'s box was focused a frame later — on an iPhone no keyboard comes up').toBe(true);
    await expect(page.locator('.dialog-overlay .dialog-input')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('.dialog-overlay')).toHaveCount(0);
});

// A `type="number"` box opens the numbers-AND-PUNCTUATION keyboard on an iPhone; `inputmode="numeric"`
// is the digit pad. Asserted on the rendered table, every count in it, with the type and its range
// kept — the attribute is ADDED to the number box, it does not replace it.
test('links: every target count in the generator table asks for the digit pad', async ({ page }) => {
    await openLinksWithTargetSets(page);
    const counts = await page.locator('#genSlotRows .gen-slot-count').evaluateAll(els => els.map(el => ({
        mode: el.getAttribute('inputmode'), type: el.getAttribute('type'),
        min: el.getAttribute('min'), max: el.getAttribute('max'),
    })));
    expect(counts.length, 'the table rendered no counts, so this proves nothing').toBeGreaterThan(0);
    for (const c of counts) {
        expect(c.mode, 'a count opens the numbers-and-punctuation keyboard on an iPhone').toBe('numeric');
        expect(c.type).toBe('number');
        expect(c.min).toBe('0');
        expect(c.max).toMatch(/^\d+$/);
    }
});
