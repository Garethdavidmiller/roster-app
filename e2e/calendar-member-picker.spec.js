/**
 * calendar-member-picker.spec.js — the Calendar (index.html): the name picker and a member gone from
 * the list, and the iPhone audit's keyboard, focus and touch checks.
 *
 * Split by feature out of calendar.spec.js on 25 Nov 2026, test for test and unchanged; what more than
 * one calendar-*.spec.js file needs is in calendar-helpers.js. Every file keeps the old file's
 * `beforeEach`, so each test still starts signed in as a member. The Calendar's access gate is
 * calendar-access.spec.js.
 */
import { test, expect } from './fixtures.js';
import { seedSession, seedMember, seedCalendarMember, seedMemberSession } from './helpers.js';
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

/** Undo the default member for a test about the FRONT DOOR: no session, no identity. Register it after
 *  the beforeEach's seed (later init scripts run last). @param {import('@playwright/test').Page} page */
const signedOut = (page) => page.addInitScript(() => {
    localStorage.removeItem('myb_admin_session');
    window.__E2E = Object.assign(window.__E2E || {}, { authUser: false });
});

// ── THE NAME PICKER IS THE SAME WIDTH WHOEVER IS SELECTED (v23.39, owner report) ───────────────
//
// A `<select>` sizes to its WIDEST option, so the control never moved. The v23.33 trigger button
// sized to the name it was showing, so switching member resized the control and re-centred the
// whole row — `← Prev` and `Next →` sliding in and out under the reader's thumb. index.css called
// that "the change not a regression"; the owner's call is that consistency is the point.
//
// THE FILTER ON A LONG SHEET (v23.68). The RULES are unit-tested in select-sheet.test.mjs and none
// of them is repeated here; what only a browser answers is the wiring — that the box is rendered at
// all, that typing reaches the list, that a filtered row still sets the value the consumer reads,
// and that the box does NOT steal focus, which is the one property the review asked for by name and
// the one a unit test provably cannot see.
test('calendar: the name sheet offers a filter, and picking a filtered row still sets the member', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('#teamMemberSelectTrigger')).toBeVisible();

    const total = await page.locator('#teamMemberSelect option').count();
    expect(total, 'the roster picker must be long enough to earn a filter, or this proves nothing')
        .toBeGreaterThan(16);

    await page.locator('#teamMemberSelectTrigger').click();
    const box = page.locator('.picker-search-input');
    await expect(box).toBeVisible();

    // It opens as a BROWSABLE LIST. A keyboard rising over the list the sheet just opened is worse
    // than the scroll it saves, so nothing here may take focus — on any platform.
    //
    // Teeth-verified, and one mutation is recorded as INERT rather than counted: adding a
    // synchronous `input.focus()` beside `lb.open()` does NOT fail this, because `createLightbox`
    // sets its own initial focus immediately afterwards and takes it straight back. The mutation
    // that reproduces the real defect is a DEFERRED focus (`setTimeout(… , 0)`), and that one is
    // caught. Worth knowing before anyone "strengthens" this by moving the read earlier.
    expect(await page.evaluate(() => document.activeElement?.className || ''),
        'the search box took focus on open — on a phone that covers the list with a keyboard')
        .not.toContain('picker-search-input');

    // AND IT MUST BE 16px, or focusing it force-zooms the page on iOS Safari — the app's oldest
    // typography rule (css-tokens.md, v11.77). It shipped at 14px for one release with the comment
    // stating the rule sitting directly above the line that broke it, and NOTHING saw it: the
    // `@a11y` sweep in pages.spec.js walks `input, select, textarea` on a page AT REST, and this
    // input does not exist until a sheet with enough options is opened. The stylesheet is now
    // guarded statically by type-scale-parity.test.mjs, which laziness cannot dodge; this is the
    // WIRING half — that the rule actually reaches the element a member's thumb lands on.
    expect(await box.evaluate(el => parseFloat(getComputedStyle(el).fontSize)),
        'the picker search will force-zoom the page when focused on iOS')
        .toBeGreaterThanOrEqual(16);

    // The accessible NAME reads as a phrase, not as a concatenation. `Search ${title}` turned
    // "Choose a staff member" into "Search choose a staff member", which passes every a11y rule
    // and still sounds like a machine talking.
    const label = await box.getAttribute('aria-label');
    expect(label, 'the search box must be named').toBeTruthy();
    expect((label || '').toLowerCase(), 'the sheet title leaked into the search name verbatim')
        .not.toMatch(/search (choose|select|pick) /);
    // …and this sheet's title is a QUESTION, which welded into "Search whose roster are you reading?"
    // (whole-app check, Nov 2026): a question has no noun to keep.
    expect(label, 'the sheet\'s question was welded onto "Search"').not.toMatch(/\?|roster are you reading/i);
    // …and the page says what the list holds, so the box is not a bare "Search" (shared-ui-5).
    expect(label).toBe('Search names');

    const shownNow = () => page.locator('.picker-opt[data-value]').count();
    const before = await shownNow();
    expect(before).toBeGreaterThan(1);

    // A real name from the real roster, taken from the select rather than hardcoded, so a roster
    // edit moves the case instead of breaking it.
    const target = await page.evaluate(() => {
        const sel = /** @type {any} */ (document.getElementById('teamMemberSelect'));
        const opt = Array.from(sel.options).find((/** @type {any} */ o) => o.value && o.text.includes('.'));
        return { value: opt.value, text: opt.text.trim() };
    });
    const fragment = target.text.split('.').pop().trim().slice(0, 4);

    await box.fill(fragment);
    const after = await shownNow();
    expect(after, `typing "${fragment}" filtered nothing`).toBeLessThan(before);
    expect(after).toBeGreaterThan(0);
    await expect(page.locator('.picker-head span'), 'the subtitle must say how much is hidden')
        .toHaveText(new RegExp(`of ${total}`));

    // The pick still goes through the select, which is the contract every consumer relies on.
    await page.locator(`.picker-opt[data-value="${target.value}"]`).click();
    await expect(page.locator('#datePickerLightbox, .picker-sheet-overlay')).toBeHidden();
    expect(await page.locator('#teamMemberSelect').inputValue()).toBe(target.value);

    // A short sheet is better with no box at all — the review's own line.
    await page.locator('#teamMemberSelectTrigger').click();
    await expect(box).toBeVisible();                       // still long
    expect(await box.inputValue(), 'the filter must reset between opens').toBe('');
});

// Only a browser can see this: the DOM is identical at every width, so nothing but a measurement
// across several selections can tell a stable control from a moving one. Asserted on the ROW as
// well as the control, because the row re-centring is what a reader actually notices.
test('calendar: the name picker does not change width when the member changes', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('#teamMemberSelectTrigger')).toBeVisible();

    const measured = await page.evaluate(() => {
        const sel = /** @type {any} */ (document.getElementById('teamMemberSelect'));
        const btn = /** @type {any} */ (document.getElementById('teamMemberSelectTrigger'));
        const row = /** @type {any} */ (document.getElementById('navRow'));
        /** @type {{name: string, btn: number, prevLeft: number}[]} */
        const out = [];
        for (const o of Array.from(sel.options)) {
            const opt = /** @type {any} */ (o);
            if (!opt.value) continue;               // skip the "— Choose your name —" placeholder
            sel.value = opt.value;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            out.push({
                name: opt.textContent.trim(),
                btn: Math.round(btn.getBoundingClientRect().width),
                // HEIGHT as well as width. The sizer is an extra child of the button, and left in
                // normal flow it forms its own line box — a 64px two-line control instead of 44px,
                // measured. The one-cell grid is what collapses the two, so height is the
                // assertion that guards it; width alone passes either way.
                btnH: Math.round(btn.getBoundingClientRect().height),
                // Where the row's first control STARTS — the thing that visibly slid about.
                prevLeft: Math.round(row.firstElementChild.getBoundingClientRect().left),
            });
        }
        return out;
    });

    expect(measured.length, 'the picker should list the roster').toBeGreaterThan(5);
    const widths = [...new Set(measured.map(m => m.btn))];
    const lefts  = [...new Set(measured.map(m => m.prevLeft))];
    expect(widths, `the control resized across ${measured.length} members: `
        + measured.map(m => `${m.name}=${m.btn}px`).join(', ')).toHaveLength(1);
    expect(lefts, 'the month arrows moved as the member changed').toHaveLength(1);
    const heights = [...new Set(measured.map(m => m.btnH))];
    expect(heights, 'the control should be one stable line').toHaveLength(1);
    expect(heights[0], 'the hidden sizer must not push the control onto a second line')
        .toBeLessThan(56);
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
    // The picker is a list, on a phone a sheet: "the dropdown" named neither (18 Nov 2026).
    await expect(page.locator('#errorBanner')).toContainText('"Z. Nonexistent" is no longer in the roster');
    await expect(page.locator('#errorBanner')).toContainText('Choose a name from the list below.');
});

// THE SIGNED-IN MEMBER'S OWN NAME (18 Nov 2026): a row hidden after a move into management, say, while the
// member is still signed in with it saved. The line is said to them, not about them in quotes. An invented
// name stands in for theirs: it is on no roster, which is how a hidden row looks to the picker.
test('calendar: a member whose own name has left the list is told so in their own words', async ({ page }) => {
    await seedMemberSession(page, 'A. Person');
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    const shown = ((await page.locator('#teamMemberSelect option:checked').textContent()) ?? '').trim();
    await expect(page.locator('#errorBanner'))
        .toContainText(`Your name is no longer in the roster — showing ${shown}'s calendar. Choose a name from the list below.`);
    await expect(page.locator('#errorBanner')).not.toContainText('"A. Person"');
});

test('calendar: the removed-member line sits beside the banner\'s warning, and its timer takes only itself away (17 Nov 2026)', async ({ page }) => {
    // The banner is shared with the start-up roster check, whose warning stays until a reload. The
    // removed-member line REPLACED it, and its 30-second timer then hid the banner — warning and all.
    // A warning already in the banner stands in for the check's (the roster cannot be made to fail it).
    await page.clock.install({ time: new Date(2026, 8, 16, 9, 0, 0) });
    await page.addInitScript(() => {
        localStorage.setItem('myb_roster_selected_member', 'Z. Nonexistent');
        // As the banner is parsed — before any module runs, as the check's own warning comes first.
        const seen = new MutationObserver(() => {
            const b = document.getElementById('errorBanner');
            if (!b) return;
            seen.disconnect();
            b.textContent = 'Roster check warning';
            b.classList.add('visible');
        });
        seen.observe(document, { childList: true, subtree: true });
    });
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    const banner = page.locator('#errorBanner');
    await expect(banner).toContainText('no longer in the roster');
    await expect(banner, 'the removed-member line replaced the warning already there').toContainText('Roster check warning');
    await page.clock.fastForward('00:31');
    await expect(banner).not.toContainText('no longer in the roster');
    await expect(banner, 'the 30-second timer hid the warning with its own line').toBeVisible();
    await expect(banner).toContainText('Roster check warning');
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

// ── THE iPHONE KEYBOARD, FOCUS AND TOUCH (iPhone audit, 7 Nov 2026) ─────────────────────────────────
//
// The ‹ › arrows above the iPhone keyboard move focus to the previous or next text field in the
// DOCUMENT, and fire no key event, so a Tab trap never sees them. A programmatic `focus()` on an
// element behind the dialog is that move, minus the keyboard: what has to happen next is the same.
// The rules are unit-tested in overlay.test.mjs; this is the wiring — the real `createLightbox`, the
// real About panel, the real dialog module and the real sign-in card, in the order a page meets them.

/** Which surface holds focus now, by the overlay it sits in. @param {import('@playwright/test').Page} page */
const focusIsIn = (page) => page.evaluate(() => {
    const a = document.activeElement;
    if (a?.closest('.dialog-overlay')) return 'dialog';
    if (a?.closest('#loginOverlay')) return 'sign-in';
    if (a?.closest('#iconLightbox')) return 'about';
    return a?.id || a?.tagName || 'nothing';
});

test('overlay: focus that lands behind an open dialog comes back to it — and only the topmost one pulls', async ({ page }) => {
    await seedMember(page);
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.locator('.title-icon').first().click();   // the Calendar's header logo opens About
    await expect(page.locator('#iconLightbox')).toHaveClass(/open/);

    await page.evaluate(() => document.getElementById('prevMonth')?.focus());
    expect(await focusIsIn(page), 'focus stayed on the page behind About').toBe('about');

    // A dialog OVER About: it owns focus now, and About — buried — must not drag it back underneath.
    await page.evaluate(async () => {
        const { confirmDialog } = await import('./overlay.js');
        void confirmDialog({ message: 'A dialog over the About panel' });
    });
    await expect(page.locator('.dialog-overlay')).toHaveClass(/open/);
    await page.evaluate(() => document.getElementById('iconLightboxClose')?.focus());
    expect(await focusIsIn(page), 'focus went into the panel UNDER the dialog').toBe('dialog');
    await page.evaluate(() => document.getElementById('prevMonth')?.focus());
    expect(await focusIsIn(page)).toBe('dialog');

    // Escape closes the dialog alone, and About is the top again — guarding its own focus once more.
    await page.keyboard.press('Escape');
    await expect(page.locator('.dialog-overlay')).toHaveCount(0);
    await expect(page.locator('#iconLightbox')).toHaveClass(/open/);
    await page.evaluate(() => document.getElementById('prevMonth')?.focus());
    expect(await focusIsIn(page)).toBe('about');
});

test('overlay: a sign-in card mounted over an open dialog keeps the focus it takes', async ({ page }) => {
    // The case a focus guard must NOT win. `#loginOverlay` is not on the overlay stack — a session
    // lost mid-visit mounts it over whatever was open (page-session.js) — so the dialog underneath
    // still believes it is the top. Pulling focus back would leave the member unable to type their
    // password: the guard stands down for a modal surface painted above it.
    await seedMember(page);
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.locator('.title-icon').first().click();
    await expect(page.locator('#iconLightbox')).toHaveClass(/open/);
    await expect(page.locator('#loginOverlay')).toHaveCount(0);   // or initLoginOverlay's idempotence no-ops
    await page.evaluate(async () => {
        const { initLoginOverlay } = await import('./login-overlay.js');
        initLoginOverlay({ pageLabel: 'a test', onSuccess() {} });
    });
    await expect(page.locator('#loginOverlay')).toBeVisible();
    expect(await focusIsIn(page), 'the dialog under the sign-in card took its focus back').toBe('sign-in');
    await page.evaluate(() => document.getElementById('loginPassword')?.focus());
    expect(await focusIsIn(page)).toBe('sign-in');
});

/** Wait for an element's running transitions and animations to end — the sheets open with a scale. */
const settledBox = (/** @type {import('@playwright/test').Locator} */ loc) => loc.evaluate(async el => {
    await Promise.all(el.getAnimations({ subtree: true }).map(a => a.finished.catch(() => {})));
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, viewport: window.innerHeight };
});

test('picker: a sheet with a search box sits at the top and stays there as the list shrinks', async ({ page }) => {
    // Centred, every keystroke that shortened the list re-centred the panel, sliding the box and its
    // matches DOWN — towards the iPhone keyboard, which covers the bottom of the page without resizing
    // it. Measured on the real name sheet, before and after a filter.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('#teamMemberSelectTrigger')).toBeVisible();
    await page.locator('#teamMemberSelectTrigger').click();
    const box = page.locator('.picker-search-input');
    await expect(box).toBeVisible();
    const panel = page.locator('.picker-sheet');
    const before = await settledBox(panel);
    expect(before.top, 'the sheet with a search box opened centred, not at the top').toBeLessThanOrEqual(24);

    const name = await page.evaluate(() => {
        const sel = /** @type {any} */ (document.getElementById('teamMemberSelect'));
        return Array.from(sel.options).map((/** @type {any} */ o) => o.text.trim()).find(t => t.includes('.')) || '';
    });
    await box.fill(name.split('.').pop().trim().slice(0, 4));
    const after = await settledBox(panel);
    expect(Math.abs(after.top - before.top), 'the panel moved as the list shrank').toBeLessThanOrEqual(1);
    expect(after.bottom, 'premise: the filter shortened the panel').toBeLessThan(before.bottom);

    // The keyboard's Search key puts the keyboard away: the box lets go, focus stays in the sheet.
    await box.press('Enter');
    await expect(box).not.toBeFocused();
    expect(await page.evaluate(() => !!document.activeElement?.closest('.picker-sheet')),
        'Enter dropped focus out of the sheet').toBe(true);
    await expect(page.locator('.picker-sheet-overlay')).toHaveClass(/open/);   // still open, still filtered
});

test('guide search: while searching, the results sit under the box — and the drawer comes back', async ({ page }) => {
    // ~500px of page pills and Latest sat above the box, so at 390×844 its results began below the
    // fold — under the iPhone keyboard. While a query is active those step aside.
    await page.setViewportSize({ width: 390, height: 844 });
    const input = await openGuideSearch(page);
    const pills = page.locator('#navPanel .nav-panel-pills');
    const latest = page.locator('#navPanel .nav-panel-section').first();
    await expect(pills).toBeVisible();
    await expect(latest).toBeVisible();
    // Where the box sits in the drawer's CONTENT, not on the screen: focusing it scrolls the drawer by however much
    // lies below it, so its screen position at rest moved whenever a Reference row was added (v26.89, the glossary).
    const boxTopAtRest = await input.evaluate(el => el.getBoundingClientRect().top + (el.closest('.nav-panel-body')?.scrollTop ?? 0));

    await input.fill('gold card');
    const first = page.locator('#navGuideSearchResults a').first();
    await expect(first).toBeVisible();
    await expect(pills).toBeHidden();
    await expect(latest).toBeHidden();
    await expect(page.locator('#navGuidesToggle'), 'the box keeps its own section heading').toBeVisible();
    const geometry = await page.evaluate(() => ({
        box: /** @type {HTMLElement} */ (document.getElementById('navGuideSearchInput')).getBoundingClientRect().top,
        result: /** @type {HTMLElement} */ (document.querySelector('#navGuideSearchResults a')).getBoundingClientRect().top,
    }));
    expect(boxTopAtRest, 'premise: at rest the box sits well down the drawer').toBeGreaterThan(300);
    expect(geometry.box, 'the box did not come up to the top of the drawer').toBeLessThan(200);
    expect(geometry.result, 'the first result is not just under the box').toBeLessThan(geometry.box + 100);

    // The keyboard's Search key puts the keyboard away, and leaves the results where they are.
    await input.press('Enter');
    await expect(input).not.toBeFocused();
    await expect(first).toBeVisible();

    // Clearing the query brings the drawer's map back…
    await input.fill('');
    await expect(pills).toBeVisible();
    await expect(latest).toBeVisible();
    // …and so does closing the drawer with a query still in the box.
    await input.fill('gold card');
    await expect(pills).toBeHidden();
    await page.locator('#navPanelClose').click();
    await page.locator('#navMenuBtn').click();
    await expect(pills).toBeVisible();
    await expect(latest).toBeVisible();
    await expect(input).toHaveValue('');
});

test('sign-in card: picking your name focuses the password box inside the tap', async ({ page }) => {
    // The sheet sets the name only once its close has landed, long after the tap, and iOS raises its
    // keyboard only for a focus made synchronously inside it — so an iPhone got a caret and no
    // keyboard. The tap and the read are one `evaluate`. The Calendar's front door is the card inline.
    await signedOut(page);   // the front door: undo the file's default member
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('#loginGradeTrigger')).toBeVisible();
    await page.locator('#loginGradeTrigger').click();
    const sheet = page.locator('.picker-sheet-overlay');
    await expect(sheet).toHaveClass(/open/);
    // A short sheet has no search box, and stays centred.
    await expect(sheet).not.toHaveClass(/picker-sheet-overlay--search/);
    await page.locator('.picker-sheet .picker-opt[data-value]:not([data-value=""])').first().click();
    await expect(sheet).not.toHaveClass(/open/);
    await expect(page.locator('#loginNameTrigger')).toBeEnabled();
    await page.locator('#loginNameTrigger').click();
    await expect(sheet).toHaveClass(/open/);

    const tap = await page.evaluate(() => {
        const row = /** @type {HTMLElement} */ (document.querySelector('.picker-sheet .picker-opt[data-value]:not([data-value=""])'));
        row.click();
        const focused = document.activeElement?.id;
        // The member starts typing before the pick has landed (the sheet is still fading): that is
        // THEIR password for THIS name, and the name's own `change` must not wipe it when it arrives.
        /** @type {HTMLInputElement} */ (document.getElementById('loginPassword')).value = 'typed-in-time';
        return { focused, name: row.dataset.value };
    });
    expect(tap.focused, 'the password box was not focused inside the tap').toBe('loginPassword');
    await expect(page.locator('#loginName')).toHaveValue(/** @type {string} */ (tap.name));   // the pick landed
    await expect(page.locator('#loginPassword')).toHaveValue('typed-in-time');
    await expect(page.locator('#loginPassword')).toBeFocused();
});

test('member card: "Sign in →" opens the form with the password box focused inside the tap', async ({ page }) => {
    // A member whose identity has gone is offered their own sign-in, which lands on the password box.
    // It used to `await` the form's module first, so the focus came after the tap and no keyboard rose.
    // The card now fetches the form while the member reads it, and a tap that finds it opens it at once.
    await seedSession(page, 'G. Miller');
    await seedMember(page, 'G. Miller');
    await page.addInitScript(() => { window.__E2E = Object.assign(window.__E2E || {}, { authUser: false, failSignIn: true }); });
    await page.goto('/');
    await expect(page.locator('#calLockWho')).toContainText('G. Miller');
    await expect(page.locator('#calLockSubmit')).toBeEnabled({ timeout: 20_000 });
    // Wait for the card's own fetch of the form to land — the module, then one task for its `then`.
    await page.evaluate(async () => { await import('./login-overlay.js'); await new Promise(r => setTimeout(r, 0)); });
    const focused = await page.evaluate(() => {
        document.getElementById('calLockSubmit')?.click();
        return document.activeElement?.id;
    });
    expect(focused, 'the form opened a step after the tap — on an iPhone, no keyboard').toBe('loginPassword');
    await expect(page.locator('#loginOverlay')).toBeVisible();
});
