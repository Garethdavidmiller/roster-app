/**
 * pages.spec.js — the browser tests that span pages: the every-page sweeps (typeface, 16px
 * fields, tap targets, select options, boot placeholder, deep-linked headings, the usable mark,
 * service workers, card titles), the shared drawer and dialogs, the select sheet, the Huddle table,
 * and the large-text family that holds three pages to one layout rule.
 *
 * Until 3 Nov 2026 it also held every Admin, Links, Operations, Settings and guide test, in one
 * file of 10,599 lines. Those now live in admin.spec.js, links.spec.js,
 * operations.spec.js, settings.spec.js and guides.spec.js, moved test for test and unchanged.
 */
import { test, expect, forcePasswordSet } from './fixtures.js';
import { seedSession, seedMember, seedMemberSession, isTouchProject, scaleText, tooWide, waitForPageSettled, signInThroughOverlay,
    openRosterReview, stubUsageReads, stubPerfReads, clickInView } from './helpers.js';
import { teamMembers, CONFIG } from '../roster-data.js';
import { APP_PAGES as APP_PAGES_LIST } from '../scripts/app-pages.mjs';

test('a card title\'s emoji sits inside its title, on its first line, and a wrapped title hangs from it', async ({ page }) => {
    // The emoji is every card title's FIRST element (card-header-parity.test.mjs), and shared.css
    // lays a title holding nothing else as a flex row, so a title that wraps keeps its words in one
    // block BESIDE the emoji rather than running back under it, and `align-items: baseline` keeps the
    // emoji on the first line rather than floating between the two. Measured on every card page at
    // 360px, where real titles wrap ("Holiday Pay Premium (HPP)" among them):
    //   · the emoji lies inside its title's box. v25.15's lesson, from the owner's phone: a 28px tile
    //     with a -3px margin hung out of the h2 onto the hint line beneath, and a 1x screenshot read as
    //     "close". The tile went at v25.16; the rule that nothing hangs out of a title did not;
    //   · every line of a wrapped title starts at ONE x, to the right of the emoji;
    //   · the emoji's middle is inside the first line, not between the lines.
    // GEOMETRY, not a picture, for the reason above: these are a few pixels each, under any pixel
    // tolerance a baseline can afford, and a picture of the wrong answer looks nearly right.
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 360, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => { localStorage.setItem('myb_links_welcome_seen', '1'); });
    const EMOJI = '.card-header h2 > span[aria-hidden="true"]:first-child';
    let measured = 0, wrapped = 0;
    for (const p of APP_PAGES_LIST.filter(x => x.cards)) {
        await page.goto(p.url);
        // SETTLED, not slept (test audit, 7 Nov 2026): a 700ms sleep let a slow runner measure a
        // page whose cards were not laid out yet, skip every title, and pass it. See the helper.
        await waitForPageSettled(page);
        const found = await page.evaluate((sel) => [...document.querySelectorAll(sel)]
            .filter(e => e.getClientRects().length)          // rendered, not inside a hidden card
            .map(e => {
                const h2 = /** @type {HTMLElement} */ (e.parentElement);
                const er = e.getBoundingClientRect(), hr = h2.getBoundingClientRect();
                // The words' own line boxes: everything after the emoji, one rect per line.
                const range = document.createRange();
                range.setStartAfter(e);
                range.setEnd(h2, h2.childNodes.length);
                /** @type {Map<number, {left: number, top: number, bottom: number}>} */ const lines = new Map();
                for (const r of range.getClientRects()) {
                    if (r.width < 1) continue;
                    const k = Math.round(r.top);
                    const l = lines.get(k);
                    lines.set(k, l ? { ...l, left: Math.min(l.left, r.left) } : { left: r.left, top: r.top, bottom: r.bottom });
                }
                const ls = [...lines.values()].sort((x, y) => x.top - y.top);
                const mid = (er.top + er.bottom) / 2;
                return {
                    title: (h2.textContent || '').trim().slice(0, 40),
                    flex: getComputedStyle(h2).display === 'flex',
                    hangs: Math.round(Math.max(hr.top - er.top, er.bottom - hr.bottom) * 10) / 10,
                    lines: ls.length,
                    lefts: ls.map(x => Math.round(x.left * 10) / 10),
                    emojiRight: Math.round(er.right * 10) / 10,
                    onFirstLine: ls.length ? mid >= ls[0].top - 0.5 && mid <= ls[0].bottom + 0.5 : true,
                };
            }), EMOJI);
        // EACH page, not only the walk as a whole: every card page titles its cards, so a page
        // that yields none was measured before it was laid out — or the selector stopped matching.
        expect(found.length, `${p.url}: no card title was measured — this page proves nothing`).toBeGreaterThan(0);
        measured += found.length;
        const hanging = found.filter(f => f.hangs > 0.5);
        expect(hanging, `${p.url}: an emoji hangs outside its title by → ${hanging.map(b => `${b.title} (${b.hangs}px)`).join(' · ')}`).toEqual([]);
        for (const f of found.filter(x => x.flex && x.lines > 1)) {
            wrapped++;
            expect(Math.max(...f.lefts) - Math.min(...f.lefts), `${p.url}: "${f.title}" — its lines start at ${f.lefts.join(', ')}; a wrapped title hangs from its emoji, every line at one x`).toBeLessThanOrEqual(0.5);
            expect(Math.min(...f.lefts), `${p.url}: "${f.title}" — its words start left of the emoji's right edge`).toBeGreaterThanOrEqual(f.emojiRight - 0.5);
            expect(f.onFirstLine, `${p.url}: "${f.title}" — the emoji sits between the lines rather than on the first ('align-items: baseline' in shared.css)`).toBe(true);
        }
    }
    expect(measured, 'the walk must reach real card titles, or it proves nothing').toBeGreaterThan(20);
    expect(wrapped, 'no title wrapped at 360px, so the hanging checks never ran — "Holiday Pay Premium (HPP)" did when this was written').toBeGreaterThan(0);
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

// ── A DIALOG OPENED FROM ANOTHER DIALOG'S ANSWER STILL OWNS A BACK ENTRY ─────────────────────────
// Links chains them (`if (!await confirmDialog(…)) return; await promptDialog(…)` — New design,
// Duplicate). The confirm's close issues `history.back()`, whose popstate lands LATER; the prompt
// opened in between pushed its entry on top, so the traversal popped the PROMPT's entry and its
// echo was absorbed. The prompt stayed on screen with no entry, and Android Back left the page.
// Only a browser can show this — the race is between a microtask and a history traversal.
test('confirmDialog → promptDialog: Back closes the prompt and stays on the page', async ({ page }) => {
    await page.goto('/links.html');
    await page.evaluate(async () => {
        const { confirmDialog, promptDialog } = await import('/overlay.js');
        /** @type {any} */ (window).__chain = (async () => {
            if (!await confirmDialog({ message: 'Discard?' })) return 'declined';
            return promptDialog({ message: 'Name?' });
        })();
    });
    await expect(page.locator('.dialog-overlay.open .dialog-btn-confirm')).toBeVisible();
    // A DOM click. Signed out, the login overlay is up — the dialog opens above it now ("asked over a
    // higher layer", below), so a pointer would reach it too — and the handler under test is the same.
    await page.evaluate(() => /** @type {HTMLElement} */ (document.querySelector('.dialog-overlay.open .dialog-btn-confirm')).click());
    await expect(page.locator('.dialog-overlay.open .dialog-input')).toBeVisible();
    await page.waitForTimeout(600);   // every traversal has landed; what remains is the steady state

    await page.evaluate(() => history.back());
    await expect(page.locator('.dialog-overlay.open .dialog-input')).toBeHidden();
    await expect(page).toHaveURL(/links\.html/);
    expect(await page.evaluate(() => /** @type {any} */ (window).__chain), 'Back is a cancel').toBe(null);
});

// A DRAG THAT ENDS ON THE BACKDROP IS NOT A TAP ON IT (shared-ui-8). Selecting a prompt's pre-filled
// text with the mouse and letting go just outside the card makes a `click` on the overlay — the nearest
// element the press and the release share — and the backdrop rule took that for a tap: the prompt
// closed as Cancel and the typing was gone. A press AND release on the backdrop still closes it.
test('promptDialog: a text selection dragged out onto the backdrop does not close it; a backdrop tap does', async ({ page }) => {
    await seedMemberSession(page);
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible({ timeout: 20_000 });
    const openPrompt = () => page.evaluate(async () => {
        const { promptDialog } = await import('/overlay.js');
        /** @type {any} */ (window).__answer = promptDialog({ message: 'Rename this design', defaultValue: 'Balanced V6 — copy' });
    });
    await openPrompt();
    const input = page.locator('.dialog-overlay.open .dialog-input');
    await expect(input).toBeVisible();
    await expect.poll(() => page.locator('.dialog-overlay.open .dialog-lb-content').evaluate(el => getComputedStyle(el).transform),
        { timeout: 5000 }).toBe('matrix(1, 0, 0, 1, 0, 0)');   // the open's scale has landed
    const field = /** @type {{ x: number, y: number, width: number, height: number }} */ (await input.boundingBox());
    const card = /** @type {{ x: number, y: number, width: number, height: number }} */ (
        await page.locator('.dialog-overlay.open .dialog-lb-content').boundingBox());
    const y = field.y + field.height / 2;
    await page.mouse.move(field.x + field.width - 6, y);
    await page.mouse.down();
    await page.mouse.move(card.x - 24, y, { steps: 6 });   // out past the card's edge, onto the backdrop
    await page.mouse.up();
    await page.waitForTimeout(400);
    await expect(input, 'the prompt closed under a text selection').toBeVisible();

    await page.mouse.click(card.x - 24, y);                  // a real tap on the backdrop
    await expect(page.locator('.dialog-overlay.open')).toHaveCount(0);
    expect(await page.evaluate(() => /** @type {any} */ (window).__answer), 'a backdrop tap is still a Cancel').toBe(null);
});

// A DIALOG OPENS ON TOP OF WHATEVER IS SHOWING (routed from the pwa audit, 10 Nov 2026). Its layer was
// the lightbox base, but a notification tapped while a page holds unsaved work asks its question over
// whatever is up (sw-register.js) — the sign-in card a lost session mounted, or the picker sheet open on
// that card, both higher. The question painted BENEATH them while holding the keyboard: focus on "Open
// it", Tab trapped inside, Escape its own — so Enter answered a question nobody could see.
test.describe('confirmDialog: asked over a higher layer, it paints on top of it', () => {
    /** Ask the question a notification tap asks; true when its confirm button is what is painted at its
     *  own centre. @param {import('@playwright/test').Page} page */
    const askOnTop = async (page) => {
        await page.evaluate(async () => {
            const { confirmDialog } = await import('/overlay.js');
            /** @type {any} */ (window).__answer = confirmDialog({
                message: 'A notification asked to open another page, but this one has unsaved changes or a save still on its way. Open it anyway?',
                confirmLabel: 'Open it', danger: true,
            });
        });
        const dialog = page.locator('.dialog-overlay.open');
        await expect(dialog.locator('.dialog-btn-confirm'), 'the question holds the keyboard').toBeFocused();
        await expect.poll(() => dialog.locator('.dialog-lb-content').evaluate(el => getComputedStyle(el).transform),
            { timeout: 5000 }).toBe('matrix(1, 0, 0, 1, 0, 0)');   // the open's scale has landed
        return dialog.locator('.dialog-btn-confirm').evaluate(b => {
            const r = b.getBoundingClientRect();
            return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === b;
        });
    };
    const answer = (/** @type {import('@playwright/test').Page} */ page) => page.evaluate(() => /** @type {any} */ (window).__answer);

    test('over the sign-in card: on top, and a tap answers it', async ({ page }) => {
        await page.goto('/settings.html');
        await page.locator('#loginGradeTrigger').waitFor();
        await expect(page.locator('#loginOverlay')).toBeVisible();
        expect(await askOnTop(page), 'the question opened UNDER the sign-in card it was asked over').toBe(true);
        await page.locator('.dialog-overlay.open .dialog-btn-confirm').click();
        expect(await answer(page)).toBe(true);
        await expect(page.locator('.dialog-overlay')).toHaveCount(0);
        await expect(page.locator('#loginOverlay')).toBeVisible();
    });

    test('over the picker sheet the card opened: on top, and the sheet waits beneath it', async ({ page }) => {
        await page.goto('/settings.html');
        await page.locator('#loginGradeTrigger').waitFor();
        await page.locator('#loginGradeTrigger').click();
        const sheet = page.locator('.picker-sheet-overlay.open');
        await expect(sheet).toBeVisible();
        expect(await askOnTop(page), 'the question opened UNDER the picker sheet it was asked over').toBe(true);
        await page.locator('.dialog-overlay.open .dialog-btn-cancel').click();
        expect(await answer(page)).toBe(false);
        await expect(sheet, 'answering the question closed the sheet beneath it').toBeVisible();
        await page.keyboard.press('Escape');                // the sheet, the top again, is the next to go
        await expect(sheet).toBeHidden();
        await expect(page.locator('#loginOverlay')).toBeVisible();
    });
});

// Same race, from the drawer: the brand button closes the drawer (a `history.back()`) and opens
// About. About must open only once that traversal has landed, or it has no entry of its own.
// This pins the OUTCOME, not the mechanism: Chromium and WebKit here both land a same-document
// back() before a `setTimeout(0)`, so the old timer passes it too (measured with the mutation).
// The fix is `whenHistorySettled` because a timer only assumes that ordering.
test('drawer brand → About: Back closes About and stays on the page', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#navMenuBtn').click();
    await page.locator('#navPanelBrand').click();
    const about = page.locator('#iconLightbox.open');
    await expect(about).toBeVisible();
    await page.waitForTimeout(600);

    await page.evaluate(() => history.back());
    await expect(about).toBeHidden();
    await expect(page).toHaveURL(/admin\.html/);
});

// A DIALOG OVER APP NOTICES ANSWERS ITS OWN CANCEL AND ITS OWN BACK (shared-ui-6). App Notices shares the
// drawer's history entry, and while it was open the drawer took EVERY popstate for its own: the echo of a
// dialog's Cancel closed App Notices underneath and stranded the drawer's entry, and a hardware Back
// closed App Notices while the dialog on top of it stayed. A dialog can arrive by itself — the app-update
// question, the unsaved-work offer — so this one is opened the way those are.
test('drawer: a dialog over App Notices answers its own Cancel and Back, and App Notices waits for its own', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    const notices = page.locator('#navNoticesLightbox');
    const dialog = page.locator('.dialog-overlay.open');
    const noticesThenDialog = async () => {
        await page.locator('#navMenuBtn').click();
        const toggle = page.locator('#navGuidesToggle');
        if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
        await page.locator('.nav-panel-link--notices').click();
        await expect(notices).toHaveClass(/\bopen\b/);
        await page.evaluate(async () => {
            const { confirmDialog } = await import('/overlay.js');
            /** @type {any} */ (window).__answer = confirmDialog({ message: 'A new version is ready. Reload now?' });
        });
        await expect(dialog).toBeVisible();
    };

    await noticesThenDialog();
    await dialog.locator('.dialog-btn-cancel').click();
    await expect(dialog).toBeHidden();
    await page.waitForTimeout(600);   // the dialog's Back echo has landed
    await expect(notices, 'the dialog\'s Cancel closed App Notices underneath').toHaveClass(/\bopen\b/);
    await page.evaluate(() => history.back());
    await expect(notices, 'App Notices still holds the drawer\'s entry, so Back closes it').not.toHaveClass(/\bopen\b/);
    await expect(page).toHaveURL(/admin\.html/);

    await noticesThenDialog();
    await page.evaluate(() => history.back());
    await expect(dialog, 'Back left the dialog on screen').toBeHidden();
    expect(await page.evaluate(() => /** @type {any} */ (window).__answer), 'Back is the dialog\'s Cancel').toBe(false);
    await expect(notices, 'and closed App Notices beneath it instead').toHaveClass(/\bopen\b/);
    await page.evaluate(() => history.back());
    await expect(notices).not.toHaveClass(/\bopen\b/);
    await expect(page).toHaveURL(/admin\.html/);
});

// ── THE DRAWER SAYS THERE IS MORE BELOW (desktop audit, Nov 2026) ───────────────────────────────
// On a laptop window (1366×625) an admin's drawer ended at "Marylebone Newsletter", with Reference —
// the guides, their search and App Notices — below the fold and nothing to say it was there. The body
// now wears the fade every scrolling lightbox wears, from the same watcher: there while more is below,
// gone at the end, gone when it all fits — and re-measured when the Reference fold opens or closes,
// which changes the content's height with no node added or removed.
test('drawer: the body fades at the fold only while there is more below it', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.setViewportSize({ width: 1366, height: 625 });
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#navMenuBtn').click();
    const body = page.locator('.nav-panel-body');
    await expect(body, 'Reference is below the fold and the body does not say so').toHaveClass(/\bhas-more\b/);
    expect(await body.evaluate(el => getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage),
        'the class is there but nothing draws the fade').toMatch(/linear-gradient/);
    await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect(body, 'scrolled to the end, there is nothing more below').not.toHaveClass(/\bhas-more\b/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#navPanel')).not.toHaveClass(/\bopen\b/);

    // A window where the body fits only with Reference folded: the fold alone moves the answer.
    await page.setViewportSize({ width: 1366, height: 800 });
    await page.locator('#navMenuBtn').click();
    const toggle = page.locator('#navGuidesToggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await body.evaluate(el => { el.scrollTop = 0; });   // the drawer keeps its scroll between opens
    await expect(body).toHaveClass(/\bhas-more\b/);
    await toggle.click();
    await expect(body, 'Reference folded away: it all fits, and the fade must go').not.toHaveClass(/\bhas-more\b/);
    await toggle.click();
    await expect(body, 'Reference open again: more below again').toHaveClass(/\bhas-more\b/);
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 1366, height: 1300 });
    await page.locator('#navMenuBtn').click();
    await expect(page.locator('#navPanel')).toHaveClass(/\bopen\b/);
    await page.waitForTimeout(100);   // two frames for the first measure
    await expect(body, 'a drawer that fits wears no fade').not.toHaveClass(/\bhas-more\b/);
});

// ── A PAGE'S FIELD RULES STAY ON THE PAGE (css-admin-ops-1 and -5, Nov 2026) ────────────────────────
// Admin and Operations style their fields BY ELEMENT, and those rules were unscoped, so they reached
// the shared surfaces every page hosts and out-ranked those surfaces' own rules. Focused, the drawer's
// guide search turned white under its white text — a search typed blind — and the drawer search had
// only ever been driven on the Calendar. Both rules are scoped to `.container` now; these two tests
// hold every card page to one drawer box and one sign-in screen.
test('drawer: the guide search box looks the same on every card page while it is typed in', async ({ page }) => {
    test.setTimeout(90_000);
    await seedSession(page, 'G. Miller');
    /** @type {Record<string, string>} */
    const looks = {};
    for (const p of APP_PAGES_LIST.filter(x => x.cards)) {
        await page.goto(p.url);
        await waitForPageSettled(page);
        await page.locator('#navMenuBtn').click();
        const input = page.locator('#navGuideSearchInput');
        await expect(input, `${p.file}: the drawer's search box`).toBeVisible();
        await input.click();
        await input.pressSequentially('rail');
        const look = await input.evaluate(el => {
            const c = getComputedStyle(el);
            return { text: c.color, fill: c.backgroundColor, ring: `${c.outlineColor} ${c.outlineStyle}` };
        });
        expect(look.text, `${p.file}: what is typed is drawn in the colour of the box it is typed into`).not.toBe(look.fill);
        looks[p.file] = JSON.stringify(look);
    }
    const [first, ...rest] = Object.entries(looks);
    for (const [file, look] of rest) expect(look, `${file}'s drawer search differs from ${first[0]}'s`).toBe(first[1]);
});

// …and the sign-in card's hidden username field (the password manager's) took the page's
// `input[type="text"] { width: 100% }` — 100% of the fixed overlay, from the card's middle — so the
// sign-in screen, and the set-password screen after it, could be dragged half a screen sideways. The
// overflow is inside a fixed overlay, so no document-width check could see it.
test('the sign-in and set-password screens never scroll sideways, on any page', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 375, height: 800 });
    const sideways = (/** @type {string} */ id) => page.locator(id).evaluate(el => el.scrollWidth - el.clientWidth);
    for (const p of APP_PAGES_LIST.filter(x => x.cards && (x.file !== 'overtime.html' || CONFIG.OVERTIME_ENABLED === true))) {
        await page.goto(p.url);
        await page.locator('#loginOverlay.visible').waitFor();
        expect(await sideways('#loginOverlay'), `${p.file}: the sign-in screen scrolls sideways`).toBeLessThanOrEqual(0);
    }
    await forcePasswordSet(page);
    for (const url of ['/admin.html', '/operations.html']) {
        await page.goto(url);
        await page.evaluate(() => localStorage.clear());   // the first page's sign-in must not carry over
        await page.goto(url);
        await signInThroughOverlay(page, 'G. Miller');
        await expect(page.locator('#pwForceOverlay')).toBeVisible();
        expect(await sideways('#pwForceOverlay'), `${url}: the set-password screen scrolls sideways`).toBeLessThanOrEqual(0);
    }
});

// ── EVERY CONTROL A PAGE STYLES IS SET IN INTER (css-admin-ops-9, Nov 2026) ───────────────────────────
// A <button> or an <input> does not inherit the page's font — the browser gives it the platform's — so
// each rule that styles one has to say `font-family: inherit`, and on Admin and Operations eighteen did
// not: "Upload Huddle", the review's ticks and choices, Reset, Set email, Mon–Fri, the month toggle were
// Arial on the station PC beside Inter. The baselines were drawn with the wrong font in them, and
// nothing read a control's font. This reads every control carrying a class the page's OWN stylesheet
// styles, with the surfaces that build controls on demand opened first.
test('every control Admin and Operations style is set in Inter', async ({ page }) => {
    test.setTimeout(90_000);
    const offInter = (/** @type {string} */ sheet) => page.evaluate((file) => {
        /** @type {Set<string>} */
        const own = new Set();
        /** @param {CSSRuleList} rules */
        const walk = (rules) => {
            for (const r of /** @type {any} */ (rules)) {
                if (r.selectorText) for (const m of r.selectorText.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) own.add(m[1]);
                if (r.cssRules) walk(r.cssRules);
            }
        };
        for (const s of document.styleSheets) if ((s.href || '').endsWith('/' + file)) walk(s.cssRules);
        const off = new Set();
        for (const el of document.querySelectorAll('button, input, select, textarea')) {
            if (el.matches('input[type="checkbox"], input[type="radio"], input[type="file"]')) continue;
            if (![...el.classList].some(c => own.has(c))) continue;
            if (!/^"?Inter\b/.test(getComputedStyle(el).fontFamily)) off.add(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`);
        }
        return { read: own.size, off: [...off] };
    }, sheet);

    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    const admin = await offInter('admin.css');
    expect(admin.read, 'premise: admin.css was read').toBeGreaterThan(100);
    expect(admin.off, 'Admin controls drawn in the platform font').toEqual([]);

    await stubUsageReads(page, {});
    await stubPerfReads(page, {});
    await openRosterReview(page);   // the review's ticks, choices and skip-all
    await page.evaluate(() => {
        for (const id of ['accountStatusBody', 'usageBody', 'pageSpeedBody']) document.getElementById(id)?.classList.add('open');
        for (const id of ['usageToggleHeader', 'pageSpeedToggleHeader']) document.getElementById(id)?.click();
    });
    await page.locator('.acct-row .email-set-btn').first().click();   // the email form, built on demand
    await expect(page.locator('.email-set-input')).toBeVisible();
    await expect(page.locator('.speed-toggle-btn').first(), 'premise: a month toggle is drawn').toBeAttached();
    const ops = await offInter('operations.css');
    expect(ops.read, 'premise: operations.css was read').toBeGreaterThan(100);
    expect(ops.off, 'Operations controls drawn in the platform font').toEqual([]);
});

// ── THE FIRST CARD SITS THE SAME DISTANCE UNDER THE HEADER ON EVERY PAGE (desktop audit, Nov 2026) ─
// From 768px Admin, Operations and Links set it 14px down (their grid's gap, the header's margin 0)
// and the other five 4px (the header's own margin) — so hopping pages, the content jumped 10px under
// a header that did not move. What is measured is what a reader sees: the first thing PAINTED below
// the header — a box with a fill, or words — not a wrapper's edge.
test('every card page puts its first card the same distance under the header, at 1366', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1366, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => { localStorage.setItem('myb_pc_ns_migrated', '1'); localStorage.setItem('myb_links_welcome_seen', '1'); });
    /** @type {Record<string, number>} */
    const gaps = {};
    for (const p of APP_PAGES_LIST.filter(x => x.cards)) {
        await page.goto(p.url);
        await waitForPageSettled(page);
        gaps[p.file] = await page.evaluate(() => {
            const header = /** @type {HTMLElement} */ (document.querySelector('.app-header'));
            const bottom = header.getBoundingClientRect().bottom;
            const painted = [...document.querySelectorAll('body *')].filter(el => {
                if (header.contains(el) || !(header.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
                const cs = getComputedStyle(el);
                if (cs.position === 'fixed' || cs.visibility === 'hidden' || !el.getClientRects().length) return false;
                const fill = !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor);
                const words = [...el.childNodes].some(n => n.nodeType === 3 && (n.textContent || '').trim());
                return fill || words;
            }).map(el => el.getBoundingClientRect().top);
            return Math.round(Math.min(...painted) - bottom);
        });
    }
    expect(new Set(Object.values(gaps)).size, `header → first card, by page: ${JSON.stringify(gaps)}`).toBe(1);
});

// ── THE ABOUT PANEL IS ONE DESIGN ON EVERY PAGE (desktop audit, Nov 2026) ───────────────────────
// It was assembled from mismatched parts: Print a 20px pill above 10px rows; Print before the links on
// the Calendar and after them on Pay; one centred tip over three edge-aligned keyboard rows, and tips
// that said "Tap" to a mouse. Measured on the rendered panels — the Calendar's (tips, Print, guide,
// bug) and Pay's (badge, Print, guide, bug).
test('About panel: one order, one corner, and the tips line up with the keyboard rows', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'the keyboard rows are a fine pointer\'s');
    await page.setViewportSize({ width: 1366, height: 900 });
    await seedMemberSession(page, 'G. Miller');
    await page.addInitScript(() => { localStorage.setItem('myb_pc_ns_migrated', '1'); localStorage.setItem('myb_pc_ytd_notice_2_shown', '1'); });
    /** Top-to-bottom order of the panel's actions, and each one's corner. */
    const layout = () => page.evaluate(() => [...document.querySelectorAll('#iconLightbox .lightbox-print-btn, #iconLightbox .lightbox-bug-link')]
        .filter(el => /** @type {HTMLElement} */ (el).getClientRects().length)
        .map(el => ({ kind: el.classList.contains('lightbox-print-btn') ? 'print' : el.id.toLowerCase().includes('bug') ? 'bug' : 'link',
                      top: el.getBoundingClientRect().top, radius: getComputedStyle(el).borderTopLeftRadius })));

    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.locator('.title-icon').first().click();
    await expect(page.locator('#iconLightbox')).toBeVisible();
    const cal = await layout();
    expect(cal.map(r => r.kind), 'the Calendar: Print, then the guide, then Report a bug').toEqual(['print', 'link', 'bug']);
    expect(new Set(cal.map(r => r.radius)), 'one corner for every action in the panel').toEqual(new Set(['12px']));
    const tips = await page.evaluate(() => {
        // Where the WORDS start — every line of them — not where the box does: a centred line in a
        // full-width box starts its box at the edge and its words in the middle.
        const left = (/** @type {Element|null} */ el) => {
            if (!el) return -1;
            const range = document.createRange();
            range.selectNodeContents(el);
            return Math.max(...[...range.getClientRects()].filter(r => r.width > 1).map(r => Math.round(r.left)));
        };
        const rows = [...document.querySelectorAll('#calendarTips .lightbox-tip')].filter(el => /** @type {HTMLElement} */ (el).getClientRects().length);
        return { title: left(document.querySelector('#calendarTips .lightbox-tips-title')), plain: left(rows.find(r => !r.classList.contains('keyboard-only'))?.firstElementChild ?? null),
                 keys: rows.filter(r => r.classList.contains('keyboard-only')).map(r => left(r.firstElementChild)) };
    });
    expect(tips.keys.length, 'premise: the keyboard rows show on a fine pointer').toBe(3);
    expect(new Set([tips.title, tips.plain, ...tips.keys]).size, `the tips start at one x: heading ${tips.title}, tip ${tips.plain}, keyboard rows ${tips.keys}`).toBe(1);
    // A tip every pointer reads names no one input — Team Week View's set included. A touch-only
    // tip may still say "Swipe".
    const said = await page.locator('#iconLightbox .lightbox-tip:not(.touch-only)').allTextContents();
    expect(said.length, 'premise: both tip sets, the month\'s and Team Week View\'s').toBeGreaterThan(5);
    expect(said.filter(t => /^\s*(Tap|Click)\b/.test(t)), 'a tip a mouse reads too says "Select", not "Tap"').toEqual([]);

    await page.goto('/paycalc.html');
    await expect(page.locator('#settingsCard')).toBeVisible();
    await page.locator('#navMenuBtn').click();
    await page.locator('#navPanelBrand').click();
    await expect(page.locator('#iconLightbox')).toBeVisible();
    const pay = await layout();
    expect(pay.map(r => r.kind), 'Pay: the same order as the Calendar').toEqual(['print', 'link', 'bug']);
    expect(new Set(pay.map(r => r.radius))).toEqual(new Set(['12px']));
    await expect(page.locator('#iconLightbox .lightbox-badge'), 'the drawer pill\'s emoji and name').toHaveText('💷 Pay');
});

// ── THE HEADER ANSWERS A MOUSE (desktop audit, Nov 2026) ─────────────────────────────────────────
// The burger had only a pressed state, and the sub-page logo — Back to calendar — no hover at all,
// while the Calendar's own logo grows on hover. Read off the rendered controls under a real mouse.
test('header: the burger and the sub-page logo answer a mouse', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'a hover is a fine pointer\'s');
    await seedSession(page, 'G. Miller');
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/settings.html');
    const burger = page.locator('#navMenuBtn');
    await expect(burger).toBeVisible();
    const raised = await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.backgroundColor = 'var(--on-navy-raised)';
        document.body.append(probe);
        const c = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return c;
    });
    await burger.hover();
    await expect.poll(() => burger.evaluate(el => getComputedStyle(el).backgroundColor), { message: 'the burger on hover' }).toBe(raised);
    const logo = page.locator('#appIcon');
    await logo.hover();
    await expect.poll(() => logo.evaluate(el => getComputedStyle(el).transform), { message: 'the logo grows on hover, as the Calendar\'s does' })
        .toBe('matrix(1.12, 0, 0, 1.12, 0, 0)');
});

// …AND UNDER REDUCED MOTION NOTHING IN THE SHARED CHROME SWINGS OR GROWS (whole-app review, Nov 2026). shared.css says
// motion is neutralised everywhere, and three still moved: the logo's hover grow, every card's chevron and the drawer's
// Reference arrow, each turning through 180° on its way to saying open or shut. The arrows still turn — that is the
// state — they just do not swing there; the grow, being only movement, goes.
test('header and cards: with reduced motion on, the logo does not grow and the arrows do not swing', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'a hover is a fine pointer\'s');
    await seedSession(page, 'G. Miller');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/settings.html');
    const logo = page.locator('#appIcon');
    await logo.hover();
    expect(await logo.evaluate(el => getComputedStyle(el).transform), 'the logo under a mouse').toBe('none');
    await page.locator('#navMenuBtn').click();
    const moving = await page.evaluate(() => [...document.querySelectorAll('.app-icon, .collapse-chevron, .nav-panel-guides-arrow')]
        .filter(el => getComputedStyle(el).transitionDuration.split(',').some(d => parseFloat(d) > 0))
        .map(el => el.id || el.className));
    expect(moving, 'still easing under reduced motion').toEqual([]);
    expect(await page.locator('.collapse-chevron').count(), 'premise: the page has card chevrons to check').toBeGreaterThan(0);
});

// ── KEYBOARD FOCUS ON THE NAVY SURFACES THE SHARED CODE DRAWS (desktop audit, Nov 2026) ──────────
// A ring is drawn only while a keyboard user is on the element, so no screenshot and no axe rule sees
// one. These had no focus rule of their own, so each fell to the app-wide fallback — the NAVY ring —
// on navy: the sub-page header logo, and on the solid navy sheet the About panel's ✕, Print, guide and
// bug rows, a notice's ✕, call to action and "Not now", and App Notices' ✕. Each is reached with a
// real Tab (so `:focus-visible` is the keyboard's) and its computed ring compared with the colour the
// token resolves to on the same page.

/** The colour a focus token resolves to on this page, read off a probe element.
 *  @param {import('@playwright/test').Page} page @param {string} token */
const ringColourOf = (page, token) => page.evaluate((t) => {
    const probe = document.createElement('div');
    probe.style.outline = `var(${t})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).outlineColor;
    probe.remove();
    return colour;
}, token);

/** Press Tab until `selector` holds focus, then return its outline.
 *  @param {import('@playwright/test').Page} page @param {string} selector */
async function tabToRing(page, selector, presses = 10) {
    for (let i = 0; i < presses; i++) {
        await page.keyboard.press('Tab');
        const ring = await page.evaluate((sel) => {
            const el = document.activeElement;
            if (!el?.matches(sel)) return null;
            const cs = getComputedStyle(el);
            return { style: cs.outlineStyle, width: cs.outlineWidth, colour: cs.outlineColor };
        }, selector);
        if (ring) return ring;
    }
    throw new Error(`Tab never reached ${selector}`);
}

test('keyboard focus is visible on the navy surfaces the shared code draws', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    // Inside the new-timetable notice's life (21–31 Oct), so the Calendar puts one up to Tab through.
    await page.clock.setFixedTime(new Date('2026-10-22T09:00:00Z'));
    await seedMemberSession(page, 'G. Miller');
    await page.addInitScript(() => localStorage.setItem('myb_app_notices', JSON.stringify([
        { id: 'timetable-2026', title: 'A new timetable starts on 13 December', section: 'Trains', date: '21 Oct 2026', body: 'Some trains leave Marylebone at different times.', archivedAt: '2026-10-21T09:00:00.000Z' },
    ])));

    // The sub-page header logo — Back to calendar, on the navy header beside the burger.
    await page.goto('/settings.html');
    await expect(page.locator('#appIcon')).toBeVisible();
    const light = await ringColourOf(page, '--focus-outline-light');
    const gold = await ringColourOf(page, '--focus-outline-gold');
    const navy = await ringColourOf(page, '--focus-outline');
    expect(new Set([light, gold, navy]).size, 'premise: the three ring tokens are three colours').toBe(3);
    const logo = await tabToRing(page, '#appIcon');
    expect(logo, 'the header logo wears the light ring the burger beside it wears').toEqual({ style: 'solid', width: '2px', colour: light });
    // …and all of it is drawn: the brand clips its overflow (for the title's ellipsis), and a clip
    // cuts an outline like anything else — the ring reaches 4px past the logo (2px offset + 2px).
    const room = await page.evaluate(() => {
        const icon = /** @type {HTMLElement} */ (document.getElementById('appIcon')).getBoundingClientRect();
        const clip = /** @type {HTMLElement} */ (document.querySelector('.app-header-brand')).getBoundingClientRect();
        return { above: Math.round(icon.top - 4 - clip.top), below: Math.round(clip.bottom - icon.bottom - 4) };
    });
    expect(room.above, 'the brand\'s overflow clips the ring above the logo').toBeGreaterThanOrEqual(0);
    expect(room.below, 'the brand\'s overflow clips the ring below the logo').toBeGreaterThanOrEqual(0);

    // App Notices, from the drawer — its ✕ sits on the opaque navy sheet now.
    await page.locator('#navMenuBtn').click();
    const toggle = page.locator('#navGuidesToggle');
    if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
    await page.locator('.nav-panel-link--notices').click();
    await expect(page.locator('#navNoticesLightbox')).toBeVisible();
    expect(await tabToRing(page, '#navNoticesClose'), 'App Notices ✕').toEqual({ style: 'solid', width: '2px', colour: gold });
    await page.keyboard.press('Escape');
    await expect(page.locator('#navNoticesLightbox')).toBeHidden();

    // A one-time notice on the Calendar: its ✕, its call to action and "Not now".
    await page.addInitScript(() => localStorage.removeItem('myb_notice_timetable_2026_done'));
    await page.goto('/');
    await expect(page.locator('#timetableNoticeLb')).toHaveClass(/\bopen\b/, { timeout: 15_000 });
    for (const [sel, name] of [['#timetableNoticeClose', 'the notice ✕'], ['#timetableNoticeGo', 'the call to action'], ['#timetableNoticeLater', '"Not now"']]) {
        expect(await tabToRing(page, sel), name).toEqual({ style: 'solid', width: '2px', colour: gold });
    }
    await page.locator('#timetableNoticeLater').click();
    await expect(page.locator('#timetableNoticeLb')).toBeHidden();

    // The About panel — the Calendar's carries every row kind: ✕, Print, the guide and the bug report.
    await page.locator('.title-icon').first().click();
    await expect(page.locator('#iconLightbox')).toBeVisible();
    for (const [sel, name] of [['#iconLightboxClose', 'About ✕'], ['#lightboxPrintBtn', 'Print'],
                               ['#iconLightbox a[href^="./staff-guide.html"]', 'the guide row'], ['#bugReportLink', 'Report a bug']]) {
        expect(await tabToRing(page, sel), name).toEqual({ style: 'solid', width: '2px', colour: gold });
    }
});

// A LONG APP NOTICES ARCHIVE SCROLLS, AND THE KEYBOARD CAN SCROLL IT (v25.61). The list moves beneath a still
// ✕ and heading, and its only Tab stop was the ✕ — so a keyboard could not reach the list to scroll it, which axe
// names scrollable-region-focusable. It surfaced when the New link notice made the archive scan's eighth entry and
// the list outgrew the panel; a member's archive holds up to 50, and on a phone far fewer scroll. The static floor
// (focus-ring-parity) names the ring rule; this proves the keys reach the list, the ring is drawn, and it scrolls.
// It does NOT guard the list's tabindex: Chromium makes a scroller focusable by itself, so this passes here without
// one (measured) — WebKit does not. The tabindex's guard is axe.spec.js → "App Notices open over a light page".
test('App Notices: a long archive is reached and scrolled from the keyboard, with a ring you can see', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seedSession(page);
    await page.addInitScript(() => localStorage.setItem('myb_app_notices', JSON.stringify(
        Array.from({ length: 14 }, (_, i) => ({ id: `probe-${i}`, section: 'Pay', title: `Notice ${i + 1}`, date: '21 Oct 2026',
            body: 'A body long enough to take two lines in the panel, as a real notice does.',
            archivedAt: '2026-10-21T09:00:00.000Z' })))));
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#navMenuBtn').click();
    const toggle = page.locator('#navGuidesToggle');
    if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
    await page.locator('.nav-panel-link--notices').click();
    await expect(page.locator('#navNoticesLightbox')).toBeVisible();
    // The panel puts focus on its ✕ 60ms after opening; keys sent before that would race it, which no person can.
    await expect(page.locator('#navNoticesClose'), 'it opens with the ✕ focused').toBeFocused();
    const list = page.locator('#navNoticesList');
    expect(await list.evaluate(el => el.scrollHeight > el.clientHeight), 'premise: fourteen notices overflow the panel').toBe(true);
    const gold = await ringColourOf(page, '--focus-outline-gold');
    expect(await tabToRing(page, '#navNoticesList'), 'Tab reaches the list, ringed in the sheet\'s gold')
        .toEqual({ style: 'solid', width: '2px', colour: gold });
    await page.keyboard.press('End');
    await expect.poll(() => list.evaluate(el => el.scrollTop), 'End scrolls the focused list to its last notice').toBeGreaterThan(0);
    await page.keyboard.press('Tab');
    await expect(page.locator('#navNoticesClose'), 'and Tab goes round to the ✕ — the panel keeps focus').toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(list, 'Shift+Tab comes back to the list').toBeFocused();
});

// AN EMPTY ARCHIVE IS ITS MESSAGE AND NOTHING ELSE (whole-app review, Nov 2026). nav-panel.js hides the list when
// there is nothing archived, and `display: flex` beat the `hidden` attribute, so the list stayed: a 0px box that took
// the column's gap a second time and was still read out as an empty "Notices you've read" group. Playwright's own
// `toBeHidden()` cannot see this — a box 0px tall already counts as hidden — so the box and the role are asked.
test('App Notices: an empty archive shows its message, with no empty list left in the panel', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seedSession(page);
    await page.addInitScript(() => localStorage.removeItem('myb_app_notices'));
    await page.goto('/settings.html');
    await page.locator('#navMenuBtn').click();
    const toggle = page.locator('#navGuidesToggle');
    if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
    await page.locator('.nav-panel-link--notices').click();
    await expect(page.locator('#navNoticesLightbox')).toBeVisible();
    await expect(page.locator('#navNoticesEmpty'), 'the empty archive says so').toBeVisible();
    // Layout offsets, not client rects: the panel is still scaling in from 0.88, and a rect would read the gap short.
    const m = await page.evaluate(() => {
        const list = /** @type {HTMLElement} */ (document.getElementById('navNoticesList'));
        const panel = /** @type {HTMLElement} */ (document.getElementById('navNoticesContent'));
        const heading = /** @type {HTMLElement} */ (panel.querySelector(':scope > .nav-cs-title'));
        const message = /** @type {HTMLElement} */ (document.getElementById('navNoticesEmpty'));
        return { hidden: list.hidden, boxes: list.getClientRects().length, gap: parseFloat(getComputedStyle(panel).rowGap),
                 under: message.offsetTop - (heading.offsetTop + heading.offsetHeight) };
    });
    expect(m.hidden, 'premise: nav-panel.js hides the list of an empty archive').toBe(true);
    expect(m.boxes, 'the hidden list is still laid out').toBe(0);
    expect(Math.round(m.under), 'the message sits one gap under the heading, not two').toBe(m.gap);
    await expect(page.getByRole('group', { name: /Notices you.ve read on this device/ }),
        'an empty group is still offered to a screen reader').toHaveCount(0);
});

// …and the other half of the same rule: a list that is NOT hidden is still drawn, so the companion above can only ever
// take an empty archive's list away.
test('App Notices: an archive with a notice in it lists it', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await seedSession(page);
    await page.addInitScript(() => localStorage.setItem('myb_app_notices', JSON.stringify([{
        id: 'e2e-filled', title: 'A notice you have read', section: 'Calendar', date: '2026-11-01',
        body: 'Its words.', archivedAt: new Date().toISOString(),
    }])));
    await page.goto('/settings.html');
    await page.locator('#navMenuBtn').click();
    const toggle = page.locator('#navGuidesToggle');
    if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
    await page.locator('.nav-panel-link--notices').click();
    await expect(page.locator('#navNoticesLightbox')).toBeVisible();
    await expect(page.locator('#navNoticesList .notices-item'), 'the read notice is listed').toHaveCount(1);
    await expect(page.locator('#navNoticesList .notices-item-title')).toHaveText('A notice you have read');
    await expect(page.locator('#navNoticesList'), 'the list is drawn').toBeVisible();
    await expect(page.locator('#navNoticesEmpty'), 'no "nothing here" beside a notice').toBeHidden();
});

// A TIPS TITLE STAYS CLEAR OF ITS ✕ (whole-app review, Nov 2026). The picker sheet's head reserves room for its ✕ and
// the Tips panel's title did not: "🙋 Password Reset Requests" ran 8px under the glyph at 360px. Every line of the
// title is measured, because the ✕ sits beside the first and a wrapped second line still reaches its target.
test('Tips: a long panel title stays clear of the panel\'s ✕ on a small phone', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await seedSession(page, 'G. Miller');   // admin — Operations lets them in
    await page.goto('/operations.html');
    await page.locator('.btn-card-tips[data-card="reset-requests"]').click();
    await expect(page.locator('#tipsLbTitle')).toHaveText(/Password Reset Requests/);
    const m = await page.evaluate(() => {
        const range = document.createRange();
        range.selectNodeContents(/** @type {HTMLElement} */ (document.getElementById('tipsLbTitle')));
        const lines = [...range.getClientRects()];
        return { textRight: Math.max(...lines.map(r => r.right)), closeLeft: /** @type {HTMLElement} */ (document.getElementById('tipsLightboxClose')).getBoundingClientRect().left };
    });
    expect(m.textRight, `the title's text ends at ${m.textRight}, the ✕'s target starts at ${m.closeLeft}`).toBeLessThanOrEqual(m.closeLeft);
});

// A HIDDEN TOUCH-ONLY LINE STAYS HIDDEN ON A TOUCH SCREEN (whole-app review, Nov 2026). `.touch-only` shows itself on a
// coarse pointer with `display: revert`, which rolls back past the `hidden` attribute, so the Calendar's and Trains'
// swipe hints each needed a rule in their own page to stay hidden. The shared utility honours `hidden` itself now.
test.describe('touch-only on a touch screen', () => {
    test.use({ hasTouch: true });
    test('a touch-only line the code has hidden stays hidden, and one it has not shows', async ({ page }) => {
        await page.goto('/settings.html');
        expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), 'premise: a coarse pointer').toBe(true);
        const shown = await page.evaluate(() => [true, false].map(hidden => {
            const line = document.createElement('p');
            line.className = 'touch-only';
            line.hidden = hidden;
            line.textContent = 'Swipe the table sideways';
            document.body.append(line);
            return getComputedStyle(line).display;
        }));
        expect(shown, 'the hidden line, then the shown one').toEqual(['none', 'block']);
    });
});

// A LINK IN PROSE IS THE APP'S LINK (whole-app review, Nov 2026). Nothing styled a link in a Tips panel or in a
// card's explainer, so Trains' two journey-planner links were the browser's own blue, and purple once followed:
// the one in its Tips today, and the one in the line that says both timetables have ended, from 16 May 2027. Each
// is read in its own state, so each has its own clock.
test.describe('a link in a Tips panel or a card explainer', () => {
    const navy = (/** @type {import('@playwright/test').Page} */ page) => page.evaluate(() => {
        const probe = document.body.appendChild(document.createElement('span'));
        probe.style.color = 'var(--primary-blue)';
        const c = getComputedStyle(probe).color;
        probe.remove();
        return c;
    });
    const look = (/** @type {import('@playwright/test').Locator} */ link) => link.evaluate(a => {
        const s = getComputedStyle(a);
        return { colour: s.color, weight: s.fontWeight };
    });
    for (const { when, at, open, link } of [
        { when: 'in Trains\' Tips', at: '2026-11-10T09:00:00Z', open: '.btn-card-tips[data-card="overview"]', link: '#tipsLightboxContent a' },
        { when: 'once both timetables have ended', at: '2027-05-20T09:00:00Z', open: null, link: '#trEnded a' },
    ]) {
        test(`wears the app's navy, not the browser's blue — ${when}`, async ({ page }) => {
            await page.clock.setFixedTime(new Date(at));
            await seedSession(page, 'G. Miller');
            await page.goto('/trains.html');
            if (open) await page.locator(open).click();
            const a = page.locator(link, { hasText: 'the journey planner' });
            await expect(a).toBeVisible();
            expect(await look(a)).toEqual({ colour: await navy(page), weight: '600' });
        });
    }
});

// A SIGNED-OUT VISIT STILL TAKES AN UPDATE (whole-app review, Oct 2026). Pay, Trains and Overtime
// registered the service worker only after their sign-in gate, so a release landing while somebody
// sat on the sign-in screen left them working on the old release under the new worker. Operations
// and Links had the rule since v16.21; this asks it of every app page, so the next one cannot miss it.
test('every app page registers its service worker on a signed-out visit', async ({ page }) => {
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window); w.__swRegisters = 0;
        if (!navigator.serviceWorker) return;
        navigator.serviceWorker.getRegistration = async () => undefined;
        navigator.serviceWorker.register = () => { w.__swRegisters++; return new Promise(() => {}); };
    });
    for (const { file } of APP_PAGES_LIST) {
        await page.goto('/' + file);
        await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__swRegisters),
            { message: `${file} registered no service worker while signed out` }).toBe(1);
    }
});

// The two document guides have no JS to set a scroll margin (railcard/fip/rangers measure theirs),
// so a cross-guide search hit landed its heading UNDER the sticky header. guide-shell.css's static
// margin is what keeps it in view — at 375px and at 320px, where the subtitle wraps the header.
for (const [guide, id] of [['staff-guide', 'sg-sundays'], ['paycalc-guide', 'pg-pay-types']]) {
    for (const width of [320, 375]) {
        test(`${guide} @${width}px: a deep-linked heading lands below the sticky header`, async ({ page }) => {
            await page.setViewportSize({ width, height: 700 });
            await page.goto(`/${guide}.html#${id}`);
            await page.evaluate(() => document.fonts.ready);
            await page.evaluate((t) => document.getElementById(t)?.scrollIntoView(), id);
            await page.waitForTimeout(100);
            const m = await page.evaluate((t) => ({
                hdrBottom: /** @type {HTMLElement} */ (document.querySelector('.page-header')).getBoundingClientRect().bottom,
                top: /** @type {HTMLElement} */ (document.getElementById(t)).getBoundingClientRect().top,
            }), id);
            expect(m.top, `#${id} top ${m.top} vs header bottom ${m.hdrBottom}`).toBeGreaterThanOrEqual(m.hdrBottom);
        });
    }
}

// ── THE DRAWER NAMES THE RIGHT CAUSE (v23.41) ──────────────────────────────────────────────────
// `isAccessFailure` is unit-tested next door; this is the WIRING, and the wiring is where it was
// wrong. Every rejection used to become "check your signal" — true enough while the three document
// collections were open, and false from v23.18, when reading one began to require a claim.
//
// Both directions run, because a classifier that says "signed out" to somebody genuinely offline
// has only moved the wrong sentence. Measured on Settings, which has no `canReadDocuments` gate —
// the Calendar answers earlier and better, and is covered in calendar-pin.spec.js.
test('drawer: a REFUSED document read blames the session, not the signal', async ({ page }) => {
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = { authUser: true, docs: [], failGetDocs: 'permission-denied' };
    });
    await seedSession(page, 'G. Miller');
    await page.goto('/settings.html');
    await page.evaluate(() => document.getElementById('navMenuBtn')?.click());
    // Clicked through `evaluate`, not `locator.click`: on a phone viewport the drawer's document
    // links sit below the fold inside a scroll container, and even `force: true` refuses an element
    // outside the viewport. What is under test is the handler's CHOICE OF WORDS, not the tap.
    await page.locator('.nav-panel-link--circular').waitFor();
    await page.evaluate(() => /** @type {HTMLElement} */ (document.querySelector('.nav-panel-link--circular'))?.click());
    await expect(page.locator('#navComingSoonBody')).toHaveText(/signed out/i, { timeout: 12_000 });
    await expect(page.locator('#navComingSoonBody')).not.toHaveText(/signal/i);
});

test('drawer: a NETWORK failure still blames the network', async ({ page }) => {
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = { authUser: true, docs: [], failGetDocs: true };
    });
    await seedSession(page, 'G. Miller');
    await page.goto('/settings.html');
    await page.evaluate(() => document.getElementById('navMenuBtn')?.click());
    // Clicked through `evaluate`, not `locator.click`: on a phone viewport the drawer's document
    // links sit below the fold inside a scroll container, and even `force: true` refuses an element
    // outside the viewport. What is under test is the handler's CHOICE OF WORDS, not the tap.
    await page.locator('.nav-panel-link--circular').waitFor();
    await page.evaluate(() => /** @type {HTMLElement} */ (document.querySelector('.nav-panel-link--circular'))?.click());
    await expect(page.locator('#navComingSoonBody')).toHaveText(/signal/i, { timeout: 12_000 });
});

/**
 * Every served app page, for the two COMPUTED-STYLE sweeps below.
 *
 * Shared because both are cascade checks that a static test cannot make, and because this exact
 * list — written out twice, by hand — is what let `overtime.html` escape the 16px scan entirely.
 * It is now READ from scripts/app-pages.mjs (v25.21): the hand-written seven had gone on to miss
 * `trains.html` and `newlink.html` the same way, which no suite could see.
 */
const APP_URLS = APP_PAGES_LIST.map(p => p.url);

/**
 * THE PER-PAGE FLOOR for the computed-style sweeps below (test audit, 7 Nov 2026).
 *
 * Each sweep skips an element with no box. That is right for a field inside a closed dialog and wrong
 * for a page measured before it was laid out — and from inside the sweep the two look the same, so a
 * page could pass having measured nothing. Each page therefore also counts the elements of the kind
 * it HOLDS, and how many of them had a box: a page that holds some and measured none fails.
 *
 * The drawer and the header are left out of both counts because they are on every page — the
 * drawer's guide-search box alone would otherwise meet the floor on a page that had drawn nothing of
 * its own. So is anything the page hides ON PURPOSE, which has no box by design: a closed dialog's
 * contents, a `[hidden]` block, and anything under a `display: none` of the page's own (the paused
 * Overtime page hides its cards' header actions that way). The one `display: none` that is NOT on
 * purpose is `.container`'s: Admin, Operations and Links hide the whole page under it until
 * `body.auth-ready` (shared.css), and a page in that state is exactly the one that was not laid out.
 * @param {import('@playwright/test').Page} page @param {string} selector
 * @returns {Promise<{ held: number, withBox: number }>}
 */
const ownElements = (page, selector) => page.evaluate((sel) => {
    /** @param {Element} el */
    const hiddenOnPurpose = (el) => {
        if (el.closest('#navPanel, .nav-panel, header, [hidden], .lb-overlay, .dialog-overlay, [role="dialog"]')) return true;
        for (let p = /** @type {Element|null} */ (el); p && p !== document.body; p = p.parentElement) {
            if (p.matches('.container')) continue;
            if (getComputedStyle(p).display === 'none') return true;
        }
        return false;
    };
    const own = [...document.querySelectorAll(sel)].filter(el => !hiddenOnPurpose(el));
    return {
        held: own.length,
        withBox: own.filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length,
    };
}, selector);
/** The text-entry fields the 16px sweep measures — everything but the kinds it skips by type. */
const TEXT_FIELDS = 'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"]), select, textarea';

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
        //
        // A FRESH COMPUTATION, NEVER A CACHED ONE (3 Nov 2026, the Playwright 1.63 upgrade). WebKit
        // 2359 under the iPhone profile hands back a STALE computed style for the Pay Calculator's
        // body: the browser's defaults (`-webkit-standard`, no background, 16px), on every load, while
        // the page on screen is navy and in Inter — a screenshot taken at that instant shows it, with
        // JavaScript off the reading is right, and it comes right by itself ~1.8s later, the moment
        // the sticky bar first writes a class to body. Nothing in the app reads that value. A
        // throwaway custom property set inline forces WebKit to compute body afresh (four loads out
        // of four; a made-up CLASS does not, because no rule names it). It cannot supply a typeface
        // the stylesheet does not, so a page with no body font still fails here — mutation-checked.
        const seen = await page.evaluate(() => {
            document.body.style.setProperty('--e2e-restyle', '1');
            const found = {
                body: getComputedStyle(document.body).fontFamily,
                h1: document.querySelector('h1') ? getComputedStyle(/** @type {Element} */ (document.querySelector('h1'))).fontFamily : 'Inter',
            };
            document.body.style.removeProperty('--e2e-restyle');
            if (!document.body.getAttribute('style')) document.body.removeAttribute('style');
            return found;
        });
        if (!/^Inter\b/.test(seen.body)) wrong.push(`${url} body → ${seen.body}`);
        if (!/^Inter\b/.test(seen.h1))   wrong.push(`${url} h1 → ${seen.h1}`);
    }
    expect(wrong, 'pages not rendering in the app typeface').toEqual([]);
});

// ── …AND SO DOES EVERY CONTROL ON IT (whole-app review, Nov 2026) ──────────────────────────────────────
// A form control does not inherit the page's typeface: the browser gives `button`, `input`, `select` and
// `textarea` a font of their own, so every control without a `font-family` rule of its own was drawn in
// Arial — the burger on all nine pages, Pay's hours fields and its Clear and ± buttons, the date picker's
// arrows, the prompt dialog's field, the FIP finder's clear ✕. Asked of every control a page holds, shown
// or not, and of the two that are built only when opened. A box that names a face on purpose (the
// monospace paste boxes) is not a browser default, and is the one face allowed besides Inter.
test('every control on every page and guide is set in Inter, not the browser\'s control font', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => { localStorage.setItem('myb_links_welcome_seen', '1'); });
    const census = () => page.evaluate(() => [...document.querySelectorAll('button, input, select, textarea')]
        .filter(el => !['checkbox', 'radio', 'hidden'].includes(el.getAttribute('type') ?? ''))
        .map(el => ({ el, face: getComputedStyle(el).fontFamily }))
        .filter(({ face }) => !/^"?Inter\b/.test(face) && !/^ui-monospace\b/.test(face))
        .map(({ el, face }) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} → ${face.split(',')[0]}`));
    /** @type {string[]} */
    const wrong = [];
    const GUIDES = ['staff-guide', 'paycalc-guide', 'railcard-guide', 'rangers-guide', 'fip-guide'].map(g => `/${g}.html`);
    for (const url of [...APP_URLS, ...GUIDES]) {
        await page.goto(url);
        if (APP_URLS.includes(url)) await waitForPageSettled(page);
        wrong.push(...(await census()).map(c => `${url} ${c}`));
    }
    // Built on demand: the date picker (Admin's week label opens it) and the prompt dialog.
    await page.goto('/admin.html');
    await waitForPageSettled(page);
    await page.locator('#weekNavLabel').click();
    await expect(page.locator('.dp-content')).toBeVisible();
    wrong.push(...(await census()).map(c => `the date picker ${c}`));
    await page.goto('/links.html');
    await page.evaluate(async () => {
        const { promptDialog } = await import('/overlay.js');
        promptDialog({ title: 'Name', message: 'Name?', defaultValue: 'seed' });
    });
    await expect(page.locator('.dialog-overlay .dialog-input')).toBeVisible();
    wrong.push(...(await census()).map(c => `the prompt dialog ${c}`));
    expect(wrong, 'controls in the browser\'s own font').toEqual([]);
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
    test.skip(!isTouchProject(info), 'needs a real coarse pointer');
    await page.setViewportSize({ width: 390, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => { localStorage.setItem('myb_links_welcome_seen', '1'); });

    for (const url of APP_URLS) {
        await page.goto(url);
        // SETTLED, not slept (test audit, 7 Nov 2026) — see waitForPageSettled.
        await waitForPageSettled(page);
        // Open every collapsible, or the fields inside a closed card are never measured. No wait
        // after it: `.open` is `display: block` (shared.css), so the fields have their boxes the
        // moment the class is on — nothing animates, and nothing is drawn on open.
        await page.evaluate(() => document.querySelectorAll('.card-collapsible-body')
            .forEach(el => el.classList.add('open')));
        const own = await ownElements(page, TEXT_FIELDS);
        expect(own.held === 0 || own.withBox > 0,
            `${url} holds ${own.held} fields of its own and none had a box — the page was not laid out, so this proves nothing`).toBe(true);
        const bad = await page.evaluate(async () => {
            // A member's name is DATA, not copy — see the header. Derived from the roster so it
            // follows a new starter instead of going stale.
            let names = new Set();
            try {
                const rd = await import('./roster-data.js');
                names = new Set((rd.teamMembers || []).map(/** @param {any} m */ m => m.name));
            } catch { /* page without the module graph — check every option */ }
            // AND THE DISCLOSURES THAT ARE NOT CARDS (the iPhone audit, 7 Nov 2026). The Pay
            // Calculator's "Unusual deductions or corrections" (`.hours-extra`, `display: none` until
            // `.open`) and its payslip check (`#checkActualWrap`, `#actualMoreWrap`, `[hidden]` until
            // the payslip is in hand and the disclosure is pressed) hold fields this sweep never
            // measured, because a field with no box is skipped — and `#otherAdj` sat in one at
            // 13.33px, zooming the page on every iPhone that focused it. Revealed HERE, in the same
            // task as the measuring: calculate() re-hides the payslip check on every run, and an await
            // between the two would give it the chance.
            document.querySelectorAll('.hours-extra').forEach(el => el.classList.add('open'));
            for (const id of ['checkActualWrap', 'actualMoreWrap']) {
                const wrap = document.getElementById(id);
                if (wrap) wrap.hidden = false;
            }
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

// ── EVERY FIELD WEARS THE FIELD RING WHEN FOCUSED (whole-app check, 10 Nov 2026) ─────────────────
// css-tokens.md: "Every focusable field carries `--focus-ring`, including inputs inside modals." No
// test held that sentence for the page's own fields, and the sign-in fields and the picker's search box
// wore the ring only on Admin and Operations, borrowed from those pages' field rules (those two are
// pinned by e2e/auth.spec.js → "a focused sign-in field, and the picker's search box, wear the field
// ring on every page"). A static reading cannot answer it — a page rule that sets only the outline
// correctly leaves the glow to a wider one — so the focused field's COMPUTED shadow is read, on every
// page, with every card opened as a reader opens it.
// One field is left out by name, the drawer's guide search. The drawer stays shut through the sweep, so
// the box cannot take focus (a shut drawer is `visibility: hidden`, and the sweep reports a field it
// could not focus); opened, it is the one field that does not wear the ring, by decision — on the navy
// drawer it wears the gold outline drawn for a dark surface (shared.css).
const RING_EXEMPT = { '.nav-gs-input': 'shut, it cannot take focus; open, it wears the gold outline drawn for the navy drawer, not the light-surface glow' };
test('every focusable field wears the field ring when focused @a11y', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'a keyboard');
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        localStorage.setItem('myb_pc_ns_migrated', '1');
    });
    for (const url of APP_URLS) {
        await page.goto(url);
        await waitForPageSettled(page);
        if (url === '/paycalc.html') {
            // Pay's payslip check is on screen only for a payslip that can be in hand, and calculate()
            // re-hides it on every run for one that cannot — focusing the fields above it runs one — so
            // forcing it open (the 16px sweep can, measuring in one task) would hide it again mid-sweep.
            // A PAID payslip instead, as a member checking one has, and the two disclosures that are not
            // cards opened by their own buttons.
            await page.locator('#periodSelect').selectOption({ index: 1 });
            await expect(page.locator('#checkActualWrap')).toBeVisible();
            for (const btn of ['#hoursShowMore', '#actualMoreBtn']) {
                const b = page.locator(btn);
                if (await b.getAttribute('aria-expanded') !== 'true') await clickInView(b);
                await expect(b).toHaveAttribute('aria-expanded', 'true');
            }
        }
        // Opened through each card's own control (Pay's are `.content-card`s with an arrow), so a body
        // that is hidden by more than its class is open too, and its fields can take focus.
        for (const id of await page.locator('.card-collapsible-body, .collapsible-body').evaluateAll(els => els.map(e => e.id))) {
            const body = page.locator(`#${id}`);
            if (await body.evaluate(el => el.classList.contains('open'))) continue;
            await body.evaluate(el => {
                const card = el.closest('.card, .content-card');
                /** @type {HTMLElement|null|undefined} */ (card?.querySelector('.card-toggle-arrow') ?? card?.querySelector('.card-header-toggle'))?.click();
            });
        }
        // The ring is drawn on `:focus-visible`, and a script's focus() answers it the way the last
        // interaction did: after Pay's clicks above, a focused BUTTON (every `.fieldpick` trigger) is a
        // mouse user's and shows nothing. One Tab makes this a keyboard user's sweep — the reader the
        // ring is for.
        await page.keyboard.press('Tab');
        const own = await ownElements(page, TEXT_FIELDS);
        const seen = await page.evaluate(async (exempt) => {
            const probe = document.body.appendChild(document.createElement('div'));
            probe.style.boxShadow = 'var(--focus-ring)';
            const ring = getComputedStyle(probe).boxShadow;
            probe.remove();
            const fields = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('input, select, textarea, .fieldpick')]).filter(el => {
                const t = /** @type {any} */ (el).type;
                return !['checkbox', 'radio', 'hidden', 'file'].includes(t) && el.getClientRects().length
                    && !(/** @type {any} */ (el).disabled) && el.tabIndex >= 0
                    && getComputedStyle(el).pointerEvents !== 'none'          // an enhanced select's value holder
                    && !Object.keys(exempt).some(sel => el.matches(sel));
            });
            const bad = [];
            for (const el of fields) {
                el.focus();
                const name = `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : '.' + String(el.className).split(' ')[0]}`;
                if (document.activeElement !== el) { bad.push(`${name}: could not be focused, so it was not measured`); continue; }
                await Promise.all(el.getAnimations().map(a => a.finished.catch(() => {})));
                if (!getComputedStyle(el).boxShadow.includes(ring)) bad.push(`${name}: no --focus-ring`);
                el.blur();
            }
            return { measured: fields.length, bad };
        }, RING_EXEMPT);
        expect(own.held === 0 || seen.measured > 0,
            `${url} holds ${own.held} fields of its own and none was focused — the page was not laid out, so this proves nothing`).toBe(true);
        expect(seen.bad, `${url}: focused fields without the field ring`).toEqual([]);
    }
});

/**
 * THE PRE-EXISTING FAILURES THE v23.35 WIDENING FOUND, RECORDED RATHER THAN HIDDEN.
 *
 * Widening a guard finds things. Two of the eight were on Settings and are fixed in the same
 * commit; the other six are on three pages this pass did not review, and guessing at a CSS fix for
 * a control whose layout nobody has looked at is how a regression ships. So they are a BASELINE,
 * in the shape `coordinator-ratchet.test.mjs` already uses: a debt that is visible in code, that
 * cannot grow, and that has to be deleted the moment it is paid.
 *
 * It is NOT an exemption list. The list may not gain an entry — anything new fails — and an entry
 * that stops firing fails too, so a fix cannot be made and left unrecorded. The two this comment
 * named as the ones to pay first are PAID (the Pay Calculator polish pass): `#clearBtn` — "Clear all
 * entries", destructive, 16px tall — and the two paycalc checkboxes that decide money (pension
 * membership, a postgraduate loan). The ticks are now wrapped by their row's `<label>`, and the small
 * text controls carry the `.help-btn` invisible hit area under a coarse pointer; five paycalc entries
 * came off this list in the same commit, as the ratchet requires.
 *
 * `.disclaimer-toggle` is the one that may turn out not to be a defect at all: "More ▼" sits
 * INLINE at the end of a sentence, which is the case WCAG 2.2 SC 2.5.8 exempts. That is a judgement
 * about its context rather than its size, and it belongs with whoever reviews that card.
 *
 * @type {Record<string, Record<string, string>>}
 */
const KNOWN_SMALL = {
    '/admin.html': {
        'input#day-cb-<date>.day-cb[]': '22x22 — the per-day tick in the week grid. Since Oct 2026 the day name and date beside it are its <label>, so the row has a full-height target and this box is no longer the only one. App-drawn since v23.50, same size',
    },
    '/operations.html': {
        'button.auth-gap-retry[Retry]': '34x18 — the retry on a failed account-status read',
    },
};

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
//
// ── WIDENED THREE WAYS AT v23.35, AFTER IT MISSED TWO CONTROLS ON SETTINGS ─────────────────────
//
// Each miss had its own cause, and none of them was the rule being wrong:
//
//   1. IT ONLY EVER SAW THE FIRST SCREENFUL. The probe skips anything outside the viewport, for a
//      good reason (the outward walk stops at the screen edge and reports a false 1x1) — but the
//      sweep never SCROLLED, so on a page taller than 900px everything below the fold was simply
//      unmeasured. Settings is 1,672px with its cards open and the "Show passwords" checkbox sits
//      at y=990. Half of most pages in this list was outside this guard.
//   2. IT NEVER LOOKED AT A CHECKBOX. The selector was `button, select, [role=button]`. A checkbox
//      is a control with a tap target like any other, and the app has several.
//   3. IT WALKED A PAGE STATE WHERE ONE OF THE CONTROLS DOES NOT EXIST. "Remove saved email"
//      renders only once an email IS saved, and this seeded no `getDocData` — so the button was
//      `display: none` every time. Exactly the Links empty-state lesson of v22.61, arriving on a
//      different page: a guard that walks every page has to reach each page's real working state.
//
// A CHECKBOX IS MEASURED AT ITS LABEL, when a label wraps it. That is not a softening — it is what
// the app has already decided, in `links.css`: the `.gen-obj` boxes are 20px "because the ROW is
// the touch target: clicking a label toggles it, and the row clears 44px". Measuring the 20px box
// would fail a control that is comfortably operable. What that bargain requires is that the row
// ACTUALLY clears 44px, which is the half Settings was missing — its `.pw-show-row` had no height
// of its own, so the label rescued nothing.
//
// A `<summary>` IS A CONTROL TOO (whole-app check, 10 Nov 2026): it is the button that opens its
// `<details>`, and the selector never named it, so no fold in the app was measured. The walk reaches
// the Links check card's quiet fold; the others — Trains' "Train by train", Links' compare fold,
// Admin's save receipt, Operations' stack trace — appear only after a choice, a save or an error
// that this walk does not make.
test('no control has a tap target under 24px @a11y', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile-chrome', 'a thumb, not a mouse');
    // It walks every control on several pages, so it needs ~32s on an idle runner — right on the
    // 30s default, where every loaded run timed it out before an assertion was reached. A longer
    // budget, not a weaker check: every page and every control is still measured.
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => { localStorage.setItem('myb_links_welcome_seen', '1'); });
    // A DESIGN, because links.html with none renders the EMPTY state — no grid, no brush bar, no
    // chips — so this gate was measuring a page with almost none of its own controls on it and
    // passing. The paint chips it could not see measured 30x22, 27x20 and 53x22 (v22.61), and they
    // are the primary control on the page: you arm one and paint the grid with it, which on a phone
    // is the whole interaction. A guard that walks every page has to reach each page's real
    // working state, or "no page has a small target" means "no page I could see".
    await page.addInitScript(() => {
        const p = /** @type {Record<string, any>} */ ({});
        for (let i = 1; i <= 26; i++) {
            p[String(i)] = { sun: 'RD', mon: '06:20-14:20', tue: '06:20-14:20', wed: '06:20-14:20',
                thu: '14:00-22:00', fri: 'RD', sat: 'RD' };
        }
        const w = /** @type {any} */ (window);
        w.__E2E = w.__E2E || {};
        w.__E2E.docs = [{ id: 'd1', name: 'Design A', patterns: p,
            updatedAt: 1_750_000_000_000, updatedBy: 'S. Silva' }];
        // A SAVED WORK EMAIL, and deliberately no `passwordSetAt` beside it. Settings' single-doc
        // read serves both cards, so this one seed puts the page in the state where BOTH of the
        // controls this guard used to miss are on screen: "Remove saved email" exists only once an
        // address is saved, and the password form (which holds "Show passwords") is open only while
        // the account is still on the surname default.
        w.__E2E.getDocData = { workEmail: 'g.miller@chilternrailways.co.uk' };
    });

    for (const url of APP_URLS) {
        await page.goto(url);
        // SETTLED, not slept (test audit, 7 Nov 2026) — and for Links that includes the seeded
        // design having loaded, which is the state this walk exists to reach (see above).
        await waitForPageSettled(page);
        // No wait after opening: `.open` is `display: block`, nothing animates (the 16px sweep above).
        await page.evaluate(() => document.querySelectorAll('.card-collapsible-body')
            .forEach(el => el.classList.add('open')));
        const own = await ownElements(page, 'button, select, summary, [role=button], input[type=checkbox], input[type=radio]');
        expect(own.held === 0 || own.withBox > 0,
            `${url} holds ${own.held} controls of its own and none had a box — the page was not laid out, so this proves nothing`).toBe(true);
        const scan = () => page.evaluate(() => {
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
            /** Is something STICKY or FIXED sitting over `el`'s centre at this scroll position? */
            const coveredBySticky = (el) => {
                const r = el.getBoundingClientRect();
                const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                if (!hit || hit === el || el.contains(hit)) return false;
                for (let p = hit; p; p = p.parentElement) {
                    if (p.contains(el)) return false;          // an ancestor of el, not an overlay
                    const pos = getComputedStyle(p).position;
                    if (pos === 'sticky' || pos === 'fixed') return true;
                }
                return false;
            };
            /** Is `el` scrolled outside any ancestor that clips its overflow? */
            const clippedByScroller = (el) => {
                const r = el.getBoundingClientRect();
                for (let p = el.parentElement; p; p = p.parentElement) {
                    const st = getComputedStyle(p);
                    if (!/auto|scroll|hidden/.test(st.overflowX + ' ' + st.overflowY)) continue;
                    const pr = p.getBoundingClientRect();
                    // 1px of tolerance: sub-pixel layout puts a flush edge a fraction over.
                    if (r.left < pr.left - 1 || r.right > pr.right + 1
                        || r.top < pr.top - 1 || r.bottom > pr.bottom + 1) return true;
                }
                return false;
            };
            const out = [];
            // A checkbox/radio wrapped in a LABEL is measured at the label: clicking the label
            // toggles the box, so the label IS the target. `.gen-obj` on links.html is the app's
            // decided case (20px boxes in a 44px row) and this is what makes that bargain legible
            // to the guard rather than an exemption from it. An UNWRAPPED box is measured itself.
            const target = (el) => (/^(checkbox|radio)$/.test(el.type)
                && el.closest('label')) || el;
            document.querySelectorAll(
                'button, select, summary, [role=button], input[type=checkbox], input[type=radio]'
            ).forEach(node => {
                const el = target(node);
                const r = el.getBoundingClientRect();
                if (!r.width || !r.height) return;
                if (getComputedStyle(el).visibility === 'hidden') return;
                // A CONTROL THAT CANNOT RECEIVE A POINTER IS NOT A TAP TARGET (v23.36). The
                // enhanced selects behind `select-sheet.js` are 1x1, `opacity: 0`,
                // `pointer-events: none` value holders sitting under a real trigger — the reader
                // taps the trigger, which IS measured here. They are not `visibility: hidden`
                // (Playwright's `selectOption` needs a rendered box), so the check above cannot
                // see them, and the guard reported `select#fieldMember = 1x1` on admin.html.
                //
                // Tested by `pointer-events` rather than by the class, deliberately: the property
                // IS the definition of "cannot be tapped", so this skips exactly the elements the
                // guard has nothing to say about, and a control that acquires
                // `pointer-events: none` by accident is a different and worse bug than a small
                // one — this guard was never the thing that would catch it.
                if (getComputedStyle(el).pointerEvents === 'none') return;
                // Must be fully on screen to probe outward from, or the walk stops at the edge and
                // reports a false failure for a control that is merely scrolled out of view.
                if (r.top < 26 || r.top > innerHeight - 26) return;
                // …and the same for a control its own SCROLL CONTAINER has clipped, which the
                // viewport test above cannot see (v22.37). The generator's slot table is wider
                // than the card at 390px and scrolls inside its wrapper, so the ✕ that removes a
                // shift row sat at left 371 of a 390 viewport: `elementFromPoint` at its centre
                // returns the page behind it and the probe reports 1x1, for a control that
                // measures 30x44 and reaches a full 30x44 the moment its table is scrolled across
                // — measured both ways. Nothing about that button had changed; shortening the
                // prose above the table moved it up into the vertical band this guard does check.
                //
                // Tested by CLIPPING and not by nearness to the screen edge, which was the first
                // fix and was too blunt: at 390px a left-aligned control sits at about x=24, so
                // `r.left < 26` skipped it, and a deliberately shrunken "+ Add another shift"
                // then sailed through this test. A guard that hides the failure it was widened
                // for is worse than the false positive it was meant to remove.
                if (clippedByScroller(el)) return;
                // …and the same for a control a STICKY overlay is sitting on top of right now
                // (v22.61). links.html's Save row is `position: sticky; bottom: 0` INSIDE the grid
                // card, so while the card is mid-viewport it covers whichever grid rows happen to
                // be at the bottom — 25 of 168 on the first paint. Those cells are 61x43 and fully
                // tappable; scroll on and the bar moves off them, and at the card's end it settles
                // into flow BELOW the grid, so no cell is permanently under it. Measuring them
                // where the bar happens to be is measuring the scroll position, not the control.
                //
                // Deliberately NARROW: it skips only when the covering element is itself sticky or
                // fixed. A control genuinely buried under a static element still fails, which is
                // the failure this guard exists for — and a control permanently under a sticky bar
                // would be missed, so if that is ever the bug, this is the line that hid it.
                if (coveredBySticky(el)) return;
                const w = reach(el, -1, 0) + reach(el, 1, 0) + 1;
                const h = reach(el, 0, -1) + reach(el, 0, 1) + 1;
                // EVERY reading, not only the small ones (v24.48, external audit T2). The sweep below
                // keeps each control's BEST reading across scroll positions, and that only works if
                // a good reading reaches it: filtering here meant a control measured 1x1 once (a
                // transient overlap) and 53x53 later could never recover. The threshold is applied
                // to the best reading, below.
                // A date inside an id is normalised, so one exemption covers every day's control.
                const id = el.id ? '#' + el.id.replace(/\d{4}-\d{2}-\d{2}/, '<date>') : '';
                out.push(`${el.tagName.toLowerCase()}${id}${el.className ? '.' + String(el.className).split(' ')[0] : ''}[${(el.textContent||'').trim().slice(0,12)}] = ${w}x${h}`);
            });
            return [...new Set(out)];
        });

        // WALK THE WHOLE PAGE, not the first screenful. A control is only measurable while it is
        // on screen — the outward probe stops at the viewport edge — so the sweep has to bring
        // each one into view rather than skip it. Everything under y=900 was unmeasured before
        // this, which on Settings is more than half the page.
        //
        // A control seen at several scroll positions keeps its BEST reading: near a screen edge
        // the walk is cut short by the edge itself, and reporting that as the target would be
        // measuring the scroll position rather than the control — the same mistake the sticky-bar
        // exemption above exists to avoid.
        const best = new Map();
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        for (let y = 0; y < height; y += 400) {
            await page.evaluate((y) => window.scrollTo(0, y), y);
            await page.waitForTimeout(120);
            for (const line of await scan()) {
                const key = line.split(' = ')[0];
                const [w, h] = line.split(' = ')[1].split('x').map(Number);
                const prev = best.get(key);
                if (!prev || w * h > prev.w * prev.h) best.set(key, { w, h, line });
            }
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        const small = [...best.values()].filter(v => v.w < 24 || v.h < 24).map(v => v.line);
        const known = KNOWN_SMALL[url] || {};
        const bad = small.filter(line => !(line.split(' = ')[0] in known));
        expect(bad, `${url} has controls too small to tap reliably`).toEqual([]);
        // THE RATCHET'S TEETH: a baseline entry that no longer fires has been fixed, and must be
        // deleted here in the same commit. Without this the list would quietly become a permanent
        // exemption rather than a debt — which is the failure mode the whole guard is about.
        const seen = new Set(small.map(l => l.split(' = ')[0]));
        expect(Object.keys(known).filter(k => !seen.has(k)),
            `${url}: these are no longer small — remove them from KNOWN_SMALL`).toEqual([]);
    }
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
    let selectsMeasured = 0;
    for (const url of APP_URLS) {
        await page.goto(url);
        // SETTLED, not slept (test audit, 7 Nov 2026) — see waitForPageSettled.
        await waitForPageSettled(page);
        await page.evaluate(() => {
            document.querySelectorAll('.card-collapsible-body').forEach(el => el.classList.add('open'));
            // Pick a loan plan — the real user action that reveals the cutover select.
            const sl = /** @type {HTMLSelectElement|null} */ (document.getElementById('studentLoan'));
            if (sl) { sl.value = 'plan2'; sl.dispatchEvent(new Event('change', { bubbles: true })); }
        });
        // The reveal, ASSERTED rather than slept past (it was a 400ms wait): the change handler
        // recalculates synchronously, and `calculate()` is what un-hides the cutover field.
        if (url === '/paycalc.html') await expect(page.locator('#slPaidOffField')).not.toHaveClass(/\bhidden\b/);
        // Only a NATIVE select can cut its own option text — an enhanced one is skipped below.
        const own = await ownElements(page, 'select:not(.fieldpick-native)');
        expect(own.held === 0 || own.withBox > 0,
            `${url} holds ${own.held} native selects and none had a box — the page was not laid out, so this proves nothing`).toBe(true);
        selectsMeasured += own.withBox;
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
                // An ENHANCED select has no native popup to cut anything off (v23.35): it is the
                // 1px value holder behind a `select-sheet.js` trigger, and its options are rendered
                // as `.picker-opt` rows that WRAP. Measuring option text against a 1px box reports
                // every option as clipped, which is the opposite of what this guard is about.
                if (el.classList.contains('fieldpick-native')) return;
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
    // Most pages hold no native select at all since v23.33 (select-sheet.js), so the floor here is
    // the walk's: something must have been measured somewhere, or the guard is watching nothing.
    expect(selectsMeasured, 'no native select was measured on any page — this guard is watching nothing').toBeGreaterThan(0);
    expect(offenders, 'select options cut off at 360px — a native select cuts mid-word, silently').toEqual([]);
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

// ── THE PAGE MAY NOT BE SHAVED DOWN ITS RIGHT EDGE (v23.28, owner report) ───────────────────────
//
// Reported as: switch staff member on Admin and the whole screen loses its right edge — the ADMIN
// badge, the week-nav ›, the "All 7" button, the Base roster column. Correct on the first name you
// arrive with; only managers and admin can see it, because only they can change the select.
//
// The cause is one level above where it looks. `.container` is a grid, and a track with no declared
// size takes an automatic minimum of MIN-CONTENT — so one child that refuses to shrink widens the
// TRACK, every sibling in it (header, member bar, every card) stretches to that width, and
// `overflow-x: clip` on the container then cuts them all off at the viewport. The page never
// scrolls, which is why it reads as a shave rather than as overflow.
//
// TWO THINGS MADE IT INVISIBLE HERE for as long as it shipped:
//   · At the default text size everything fits, so the track's minimum never bites.
//   · Android's font/display scaling multiplies the USED font-size of every element and leaves the
//     viewport ALONE — so no width query, and no narrower Playwright viewport, can reach the state.
//     (That is the same blind spot `text-scale.js` exists for on the Calendar; Admin has no such
//     handling, so this test has to create the condition itself.) Shrinking the viewport instead
//     would be a different layout, because media queries would fire that do not fire on the phone.
// `scaleText` therefore does what the platform does: freeze each element's computed size and
// multiply it. 1.3 is one notch above the ~1.11 measured off the owner's screenshot.
//
// It only appears AFTER a member is picked because that is when the week grid first paints real
// shifts, and "14:30-23:25" at scaled text is the child that will not shrink.
// (`scaleText` and `tooWide` live in e2e/helpers.js: Admin's own tests use them too.)


// ── AND THE SAME GRID SITS UNDER TWO MORE PAGES (v23.31) ───────────────────────────────────────
// `links.css` and `operations.css` declared `.container` exactly as `admin.css` did before the fix:
// a grid with no `grid-template-columns` and no `min-width: 0` on its children, plus the same
// `overflow-x: clip`. The mechanism is a property of THAT CSS, not of Admin — so both pages carry
// the same fix, and these two tests are what established they needed it.
//
// THE SCALE IS 1.6, NOT THE 1.3 ABOVE, AND THAT IS THE MEASUREMENT. Both pages fit at 1.3 — which
// is why the shipped Admin report did not obviously extend to them, and why a test written at 1.3
// would pass with the fix reverted and guard nothing. At 1.6 both go, header and every card shaved
// by an identical amount: the track-widening signature, not a single wide child.
//
// 1.6 is a device state, not a stress test. Android's **Font size** and **Display size** are two
// separate settings and they MULTIPLY — 1.3 × 1.3 = 1.69 — so a phone set large on both is past
// this. Admin needs less because its week grid holds a chip that cannot shrink at all; these two
// pages are dense tables that can, so they take a harder push to reach the same state.
test('operations: large text does not shave the page @layout', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/operations.html');
    await expect(page.locator('#pageSpeedCard')).toBeVisible();   // the page has really painted

    expect(await tooWide(page), 'premise: operations fits at default text size').toEqual([]);
    await scaleText(page, 1.6);
    expect(await tooWide(page),
        'no card may widen the container track past the viewport').toEqual([]);
});

test('links: large text does not shave the page @layout', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => localStorage.setItem('myb_links_welcome_seen', '1'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/links.html');
    await expect(page.locator('#generatorToggleHeader')).toBeVisible();

    expect(await tooWide(page), 'premise: links fits at default text size').toEqual([]);
    await scaleText(page, 1.6);
    expect(await tooWide(page),
        'no card may widen the container track past the viewport').toEqual([]);
});

test('admin: switching member at large text does not shave the page @layout', async ({ page }) => {
    await seedSession(page, 'G. Miller');          // admin — the only identities that can switch
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin.html');
    await expect(page.locator('#fieldMember')).toBeEnabled();

    // PREMISE: at the default text size this page fits, before and after the switch. Without it a
    // green result would not distinguish "the fix works" from "the fixture never overflowed".
    expect(await tooWide(page), 'premise: admin fits at default text size').toEqual([]);

    await scaleText(page, 1.3);
    expect(await tooWide(page), 'premise: it still fits at large text BEFORE a member is chosen')
        .toEqual([]);

    await page.locator('#fieldMember').selectOption('M. Robson');
    await expect(page.locator('.day-row')).toHaveCount(7);     // the week grid has really painted
    await scaleText(page, 1.3);                                // the switch re-rendered it

    expect(await tooWide(page),
        'the container track must not be widened past the viewport by the week grid').toEqual([]);
});

test('select-sheet: a hidden select gets a hidden trigger, and revealing it reveals the trigger', async ({ page }) => {
    // The RULE behind the defect above, driven through the real module rather than through Admin —
    // so it keeps holding for whatever select is hidden next. Refusing outright would be the wrong
    // guard (a page may legitimately hide a field and reveal it later), so the contract is that the
    // trigger mirrors the select: that is what makes the fix safe as well as correct.
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });

    const states = await page.evaluate(async () => {
        const { enhanceSelect } = await import('./select-sheet.js');
        const sel = document.createElement('select');
        sel.id = 'probeHiddenSelect';
        sel.hidden = true;
        sel.innerHTML = '<option value="a">Alpha</option><option value="b">Beta</option>';
        document.body.appendChild(sel);
        enhanceSelect(sel, { title: 'Probe' });
        const trig = () => /** @type {any} */ (document.getElementById('probeHiddenSelectTrigger'));
        // What the reader SEES, not the property. `.hidden` was true all along while the trigger's
        // `display: grid` beat the UA `[hidden]` rule and drew it anyway — a probe of the property
        // passed over a control that was on screen.
        const shown = () => { const t = trig(); return !!t && getComputedStyle(t).display !== 'none' && t.getBoundingClientRect().height > 0; };
        const whileHidden = shown();
        sel.hidden = false;                       // a later reveal must reach the trigger
        await new Promise(r => setTimeout(r, 50)); // the MutationObserver is async
        const afterReveal = shown();
        sel.remove(); trig()?.remove();
        return { whileHidden, afterReveal };
    });
    expect(states.whileHidden, 'a hidden select must not produce a visible control').toBe(false);
    expect(states.afterReveal, 'revealing the select must reveal its trigger').toBe(true);
});
