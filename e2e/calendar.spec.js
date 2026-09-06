import { test, expect, enforceNamedSession, enableInplaceLogin, enableCalendarPin } from './fixtures.js';
import { collectFatalErrors, seedSession, seedMember, pickFirstMemberAndPassword, DESKTOP_WIDTHS, armEnforcementWithFailingSignIn, signInThroughOverlay, openGuideLink, seedViewerAccess, seedMemberSession, isTouchProject } from './helpers.js';

// ── Calendar access (v20.12) ────────────────────────────────────────────────────────────────────
// Since v20.12 the Calendar opens only for a member session or the shared staff PIN, so a spec that
// simply loads index.html now gets the unlock card and none of the roster. Every test in this file
// is about what the Calendar DOES once it is open, not about the gate, so each page starts with a
// viewer session already in place — the state an unlocked shared office PC is in, and the closest
// match to what these tests were implicitly written against (roster on screen, `getSession()` null).
// The gate itself is covered end-to-end in calendar-pin.spec.js.
// A test that also seeds a member session still gets the member: the stub ranks them that way,
// exactly as `decideAccess` does.
// These set the PIN explicitly rather than inheriting `CONFIG.CALENDAR_PIN_ACCESS`, and seed a
// viewer session to satisfy it. Deliberate, and the value is NOT restated here — `roster-data.js`
// owns it, and a comment repeating it is the defect this repo names most often (this one did, and
// said "switched OFF … deployed dark" for the five weeks after the flag went live). A suite that
// INHERITS the flag silently changes what it covers on the day the flag moves, and the direction
// that costs something is a calendar suite falling back to the old open model with the gate
// untested.
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

// ── THE DAY PANEL SAYS WHAT THE ROSTER WAS CHANGED FROM (v22.64) ────────────────────────────────
//
// Reported from a phone: the panel read "Early shift 07:00-16:00" on a day whose base roster was a
// SPARE week, and nothing on it said so. The renderer's decision is unit-tested; only a browser
// proves the WIRING — that the dataset the renderer writes actually reaches the panel, which is a
// separate pass over the same state and the shape three defects took this month.
//
// It also pins the ENTRY ANIMATION, because the same panel was found frozen at 85%: an id-level
// `transform` out-specified `.lb-overlay.open .lb-content { scale(1) }`, so it never grew to full
// size. Nothing could see that — every element was present and readable, so no behavioural
// assertion and no axe rule fired, and the visual baselines had been generated with it.
test('day detail: names the roster it was changed from, and opens at full size', async ({ page }, info) => {
    // The panel is the TOUCH affordance — a desktop pointer reads the same content from the hover
    // tooltip, and a click there never opens it. Mobile-only, and stated rather than assumed: the
    // first cut ran on both and failed on chromium for exactly that reason.
    test.skip(!isTouchProject(info), 'the day panel is the touch route; desktop hovers');
    await seedMember(page);
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        const rows = [];
        for (let m = 1; m <= 12; m++) for (const d of [3, 4, 5, 6]) {
            rows.push({ id: 'ov' + m + d, memberName: 'G. Miller',
                date: '2026-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'),
                type: 'shift', value: '07:00-16:00', note: '' });
        }
        w.__E2E.docs = rows;
    });
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();

    const idx = await page.evaluate(() => [...document.querySelectorAll('.calendar-day:not(.other-month)')]
        .findIndex(c => c.dataset.detailBase));
    expect(idx, 'no cell carried a base-roster line — the fixture no longer overrides a changed day')
        .toBeGreaterThan(-1);
    await page.locator('.calendar-day:not(.other-month)').nth(idx).click();

    // THE CHANGE IS A COLOURED PAIR (v22.69): the badges the member already reads in the grid,
    // in the order it happened. Asserted by COLOUR CLASS, because the colour is the point — a
    // spare week is a different KIND of week, not a different time, and that is what the pair
    // makes visible at a glance.
    const change = page.locator('#dayDetailChange');
    await expect(change).toBeVisible();
    await expect(change.locator('.ddc-badge.badge-spare')).toBeVisible();
    await expect(change.locator('.ddc-badge.badge-early')).toBeVisible();
    // A TIMED pill shows its TIME, not its kind. Without that a time tweak — early to early —
    // draws two identical pills either side of an arrow and reads as "nothing changed".
    const pills = await change.locator('.ddc-badge').allTextContents();
    expect(new Set(pills).size, `both pills read the same: ${pills.join(' / ')}`).toBe(pills.length);
    // One sentence for a screen reader — the badges read individually would be three fragments of
    // one fact, and the arrow is not a word.
    await expect(change).toHaveAttribute('aria-label', /^Base roster Spare day, changed to /);

    // Full size, not the 85% fossil. The transform is the only observable: the text renders either
    // way, which is exactly why this went unnoticed.
    //
    // POLLED, NEVER A FIXED SLEEP (v22.93). `createLightbox` adds `.open` inside a
    // `requestAnimationFrame`, and WebKit throttles rAF hard on a page it is not painting — so on a
    // loaded CI shard the frame can arrive well after any sleep you pick, leaving the panel at its
    // resting `scale(0.88)` with nothing wrong. That is what a 600ms `waitForTimeout` here did:
    // mobile-safari failed on the first attempt AND the retry, and passed outright on the next run.
    // This file already carries the lesson further down — a fixed wait fails on a different line
    // each run — and this assertion was the one place still ignoring it.
    //
    // It keeps every tooth. A panel genuinely pinned by an id-level `transform` never reaches 1, so
    // this still fails, just at the end of the timeout instead of at 600ms.
    await expect(page.locator('#dayDetailContent'),
        'the panel never scaled up — an id-level transform is beating the shared .open rule')
        .toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
});

// A change WITHIN one shift kind — a time tweak, and probably the commonest change there is. The
// badge carries the kind, so both sides classify as Early and the pair drew `☀️ EARLY → ☀️ EARLY`:
// two identical pills either side of an arrow, reading as "nothing changed" directly under a
// headline saying it did. Found by looking at the render, not by reasoning about it. A timed pill
// shows its TIME; the kind is still carried by the colour, the emoji and the accessible label.
test('day detail: a same-KIND change still reads as a change', async ({ page }, info) => {
    test.skip(!isTouchProject(info), 'the day panel is the touch route; desktop hovers');
    await seedMember(page);
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        const rows = [];
        for (let m = 1; m <= 12; m++) for (let d = 1; d <= 28; d++) {
            rows.push({ id: `t${m}_${d}`, memberName: 'G. Miller',
                date: `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
                type: 'shift', value: '06:30-15:00', note: '', source: 'manual', changedBy: 'S. Silva' });
        }
        w.__E2E.docs = rows;
    });
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();

    // A cell whose BASE is itself an early shift, so both sides of the pair are the same kind.
    const idx = await page.evaluate(() => [...document.querySelectorAll('.calendar-day:not(.other-month)')]
        .findIndex(c => (c.dataset.detailBaseShift || '').match(/^0[4-9]:|^10:/)));
    expect(idx, 'no same-kind change in view — the fixture no longer covers an early base')
        .toBeGreaterThan(-1);
    await page.locator('.calendar-day:not(.other-month)').nth(idx).click();

    const pills = await page.locator('#dayDetailChangePair .ddc-badge').allTextContents();
    expect(pills.length).toBe(2);
    expect(new Set(pills).size,
        `both pills read "${pills[0]}" — a time change is invisible, and the pair says nothing `
        + 'changed under a headline that says it did').toBe(2);
});

// ── THE PANEL'S GEOMETRY AND ITS MARKER VOCABULARY (v22.70) ──────────────────────────────────────
//
// Both of these are things a behavioural assertion provably cannot see, and both had shipped wrong.
//
// The CLOSE BUTTON is a 44x44 touch target at `top/right: 14px`, so it occupies 14-58px down the
// panel's right edge — and the date line sits at the panel's own 30px top padding, squarely inside
// that band. With 18px of side padding "Friday 18 December 2026" ran under the ✕. Every element was
// present, visible, labelled and readable; nothing threw, no axe rule fires on two overlapping
// boxes, and the panel had no pixel baseline. So the guard has to be the MEASUREMENT.
//
// The DAY MARKERS are the second: the panel is where a member goes to ask what the ⭐ on a cell
// means, and it answered in a comma-joined sentence with no ⭐ in it. Asserted against the ICONS,
// because the labels were always right — it is the vocabulary that was missing.
test('day detail: the date clears the close button at every phone width', async ({ page }, info) => {
    test.skip(!isTouchProject(info), 'the day panel is the touch route; desktop hovers');
    // THE CASE HAS TO BE ONE THAT CAN BITE, and the first version of this test was not: at 320px
    // the longest date wraps and clears the button on the broken CSS as well as the fixed CSS, so
    // the mutation passed. Measured across 320/360/390/412 on "Wednesday 30 September 2026" — the
    // longest date the app renders — the gap at the old 18px padding is exactly ZERO at 360, 390
    // and 412, and comfortable at 320. So 390 is where the overlap is, and 390 is what this uses.
    await page.setViewportSize({ width: 390, height: 844 });
    await seedMember(page);
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        // 30 September 2026 — the longest date, carrying an RDW change so the whole panel is up.
        w.__E2E.docs = [{ id: 'x', memberName: 'G. Miller', date: '2026-09-30',
            type: 'rdw', value: '09:00-17:00', note: '', source: 'manual', changedBy: 'S. Silva' }];
        localStorage.setItem('myb_roster_year', '2026');
        localStorage.setItem('myb_roster_month', '8');
    });
    // The month is only restored when it is not in the FUTURE, so the clock has to be past it.
    await page.clock.setFixedTime(new Date('2027-01-20T10:00:00Z'));
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.locator('.calendar-day:not(.other-month)').nth(29).click();
    await expect(page.locator('#dayDetailContent')).toBeVisible();
    // Wait for the panel to have finished GROWING before measuring anything in it, and wait for it
    // by asking rather than by sleeping — same reason as the assertion above. It matters more here
    // than it looks: a panel still at `scale(0.88)` is measurably SMALLER, so an overlap check run
    // against it passes for the wrong reason. A wrong-way-round pass is worse than a flake, because
    // nothing reports it.
    await expect(page.locator('#dayDetailContent'))
        .toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');

    // NO OVERLAP — measured against the RENDERED TEXT, not the element box. The date line is
    // `width: 100%` and clears the ✕ with padding, so its BOX legitimately reaches under the
    // button while its glyphs do not; asserting on the box would fail on correct CSS and tell the
    // next person the fix was wrong. A Range over the contents gives what the reader actually sees.
    const [date, close] = await page.evaluate(() => {
        const el = document.querySelector('#dayDetailDate');
        const rg = document.createRange(); rg.selectNodeContents(el);
        const box = b => ({ l: b.left, r: b.right, t: b.top, b: b.bottom });
        return [box(rg.getBoundingClientRect()),
                box(document.querySelector('#dayDetailClose').getBoundingClientRect())];
    });
    const overlaps = date.l < close.r && date.r > close.l && date.t < close.b && date.b > close.t;
    expect(overlaps,
        `the date (${Math.round(date.l)}-${Math.round(date.r)}) runs under the close button `
        + `(${Math.round(close.l)}-${Math.round(close.r)}) — the ✕ is a 44px target and the date `
        + 'has to clear it on BOTH sides, because the line is centred').toBe(false);

    // THE SHIFT LEADS WITH ITS OWN KIND GLYPH, and the TIME is atomic — a browser will break at
    // the hyphen inside 09:00-17:00 given a chance, which is not a worse line break but a number
    // that stops reading as a number.
    await expect(page.locator('#dayDetailShiftGlyph')).toHaveText('💼');
    await expect(page.locator('#dayDetailShiftTime')).toHaveText('09:00-17:00');
    const timeLines = await page.locator('#dayDetailShiftTime')
        .evaluate(el => el.getClientRects().length);
    expect(timeLines, 'the shift time was broken across two lines').toBe(1);
});

// The markers are their own test because the two concerns want different DATES: the clearance case
// needs the longest date the app renders, and the marker case needs a date that actually carries
// markers. Folding them into one test meant one of the two ran on a fixture that could not fail it.
test('day detail: the day markers carry the calendar\'s own icons', async ({ page }, info) => {
    test.skip(!isTouchProject(info), 'the day panel is the touch route; desktop hovers');
    await seedMember(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_roster_year', '2026');
        localStorage.setItem('myb_roster_month', '11');
    });
    await page.clock.setFixedTime(new Date('2027-01-20T10:00:00Z'));
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    // 25 December 2026 — Christmas Day AND a bank holiday, so the row carries two chips.
    await page.locator('.calendar-day:not(.other-month)').nth(24).click();
    await expect(page.locator('#dayDetailContent')).toBeVisible();

    // THE CALENDAR'S OWN MARKERS, not a second vocabulary invented for the panel. index.css
    // declares these as cell `::before`/`::after` content, and this panel is where a member goes
    // to ask what the ⭐ on a cell means — it used to answer in a sentence with no ⭐ in it.
    // Asserted on the ICONS: the labels were always right, the vocabulary was what was missing.
    await expect(page.locator('#dayDetailExtras .ddm-chip')).toHaveCount(2);
    const icons = await page.locator('#dayDetailExtras .ddm-icon').allTextContents();
    expect(icons, 'the chips lost the cell icons they exist to explain').toEqual(['🎄', '⭐']);
});

// An UNCHANGED day is the state the redesign is really for: it was the one the panel rendered in
// monochrome, so the app's shift colour and glyph read as properties of "something happened"
// rather than of the shift. A plain Late turn and a plain Rest day were one grey card with
// different words on it.
test('day detail: an UNCHANGED day still leads with its own kind glyph', async ({ page }, info) => {
    test.skip(!isTouchProject(info), 'the day panel is the touch route; desktop hovers');
    await seedMember(page);
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    // A cell with no override at all — nothing is seeded, so every day is its base roster.
    const idx = await page.evaluate(() => [...document.querySelectorAll('.calendar-day:not(.other-month)')]
        .findIndex(c => !c.dataset.detailBase && c.dataset.detailShiftValue));
    expect(idx, 'no unchanged day in view').toBeGreaterThan(-1);
    await page.locator('.calendar-day:not(.other-month)').nth(idx).click();
    await expect(page.locator('#dayDetailContent')).toBeVisible();

    await expect(page.locator('#dayDetailChange')).toBeHidden();
    const glyph = await page.locator('#dayDetailShiftGlyph').textContent();
    expect(glyph, 'an unchanged day drew no kind glyph — the panel is monochrome again').toBeTruthy();
    // The SAME glyph the cell wears, from the one badge authority.
    const cellEmoji = await page.locator('.calendar-day:not(.other-month)').nth(idx)
        .evaluate(c => (c.querySelector('.shift-badge')?.textContent || '').trim().charAt(0));
    if (cellEmoji) expect(glyph.startsWith(cellEmoji),
        `panel "${glyph}" vs cell "${cellEmoji}" — the panel and the cell disagree about the kind`)
        .toBe(true);
});

// ── The grid is withheld until the overrides are known (v20.40) ──────────────────────────────────
//
// The unit tests prove the DECISION; only a browser proves the WIRING — that a real page open with a
// slow or failed Firestore read actually withholds, rather than the fetch module recording a state
// nobody reads. The bug being guarded is precisely one nothing threw on: the base roster is drawn
// perfectly, and it is somebody else's day.

test('calendar: a month whose overrides have not arrived shows NO shifts', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedMember(page);
    // Hold every collection read open. This is the fresh-browser case: no local cache to paint from,
    // so before v20.40 the base roster went straight up while the read was still in flight.
    await page.addInitScript(() => { (window.__E2E = window.__E2E || {}).docsDelayMs = 30000; });
    await page.goto('/');

    await expect(page.locator('.calendar-pending')).toBeVisible();
    await expect(page.locator('.calendar-day')).toHaveCount(0);
    // The month label survives — the header is kept in every state so the sync chip has a mount point.
    await expect(page.locator('.month-year')).toBeVisible();
    // And the legend goes with the grid: it is a key to cells that are not there, derived from the
    // base roster, so leaving it up would announce this month's shift types while the panel beside it
    // says we do not know them.
    await expect(page.locator('.legend')).toBeHidden();
    expect(errors, 'Uncaught JS exceptions on index.html').toHaveLength(0);
});

test('calendar: a FAILED override read offers a retry, and still shows no shifts', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedMember(page);
    await page.addInitScript(() => { (window.__E2E = window.__E2E || {}).failGetDocs = true; });
    await page.goto('/');

    // The failed panel is a different panel from the wait one — it names the failure and carries the
    // action. A single "loading" state for both would leave a member waiting on something that has
    // already lost, which is the shape the old code had (base roster + a chip, indefinitely).
    await expect(page.locator('.calendar-pending--failed')).toBeVisible();
    await expect(page.locator('.calendar-pending-retry')).toBeVisible();
    await expect(page.locator('.calendar-day')).toHaveCount(0);
    expect(errors, 'Uncaught JS exceptions on index.html').toHaveLength(0);
});

test('calendar: the retry re-reads, and a grid appears when it succeeds', async ({ page }) => {
    await seedMember(page);
    await page.addInitScript(() => { (window.__E2E = window.__E2E || {}).failGetDocs = true; });
    await page.goto('/');
    await expect(page.locator('.calendar-pending-retry')).toBeVisible();

    // Let the next read succeed, then press the button the panel offered.
    await page.evaluate(() => { window.__E2E.failGetDocs = false; });
    await page.locator('.calendar-pending-retry').click();

    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await expect(page.locator('.calendar-pending')).toHaveCount(0);
    await expect(page.locator('.legend')).toBeVisible();
});

// Swipe helper — a real pointer drag across the grid. Left drag = next month, right = previous.
//
// It RETRIES until the month heading actually changes, and that is not defensive padding: a
// mouse-simulated gesture is swallowed perhaps one time in two, and which one moves with the settle
// delay. A fixed `waitForTimeout` therefore produces a test that fails on a different line each run
// and, worse, one that can pass while asserting a state the swipe never reached — which is exactly
// how the first version of this test passed against the bug it was written for.
async function swipeMonth(page, dir) {
    // `.first()`, because the carousel legitimately holds MORE THAN ONE month panel while a swipe
    // is in flight — that is what a carousel is. An unscoped `.month-year` is a strict-mode
    // violation the moment this helper is called during a transition, which under load is exactly
    // when it is called: the previous swipe's panels had not been torn down yet (v21.88).
    //
    // The retry loop below already tolerates a swallowed gesture; it could not tolerate the
    // locator itself throwing, so the failure surfaced as a hard error rather than a retry.
    //
    // ── THE RETRY USED TO OVER-ADVANCE THE CAROUSEL (v22.48) ──────────────────────────────────
    //
    // The retry budget below was 2000ms, and a real transition takes LONGER than that on a loaded
    // machine. So the helper called a gesture that was working "swallowed", swiped again, and moved
    // TWO months in one call. The test then swiped back one and landed a month further out than it
    // meant to — outside the boot window, where the grid is deliberately withheld — and failed on a
    // missing `.calendar-day` while the page sat on a spinner.
    //
    // MEASURED, not reasoned about. A heading-change recorder over 20 runs at `--workers=6`:
    //
    //     55994  [October|September|November]   transition starts
    //     59433  [November] days=0              settles — 3.4s, well past the 2000ms budget
    //     60805  == swipe 2 RETRY               helper gives up and swipes again
    //     64407  == swipe 2 returned            now on December, two months from where it began
    //
    // It surfaced on CI first: one WebKit shard, failing twice including the retry, and passing on
    // the identical commit ten minutes later. A loaded runner is simply another way to make the
    // transition outlast the budget.
    //
    // The budget is now 10s, and the asymmetry is the point: too SHORT silently corrupts the
    // navigation and fails somewhere else entirely, while too LONG only costs time on a gesture
    // that genuinely was swallowed — which is rare. Err long.
    //
    // `before` is also read from a SETTLED carousel now. Read mid-flight it can catch the outgoing
    // panel, which makes the exit condition satisfiable by a transition that was already running.
    // That was not the cause here (fixing it alone changed nothing — 4 failures in 30), but it is a
    // second way for this helper to answer about the wrong month, and it costs one wait.
    await page.waitForFunction(() => document.querySelectorAll('.month-year').length === 1,
        null, { timeout: 10000 });
    const before = await page.locator('.month-year').first().textContent();
    for (let attempt = 0; attempt < 4; attempt++) {
        const box = await page.locator('#calendarDisplay').boundingBox();
        const y = box.y + box.height / 2;
        const [from, to] = dir === 'next'
            ? [box.x + box.width - 20, box.x + 20]
            : [box.x + 20, box.x + box.width - 20];
        await page.mouse.move(from, y);
        await page.mouse.down();
        await page.mouse.move(to, y, { steps: 12 });
        await page.mouse.up();
        try {
            await page.waitForFunction(
                // querySelector already takes the first, so this matches the read above — and it
                // waits for the carousel to settle to ONE panel, so the next call starts clean.
                (b) => document.querySelectorAll('.month-year').length === 1
                    && document.querySelector('.month-year')?.textContent !== b,
                before, { timeout: 10000 });
            return;
        } catch { /* genuinely swallowed — nothing moved in ten seconds — try again */ }
    }
    throw new Error(`swipe ${dir} never committed (still on ${before})`);
}

test('calendar: the legend follows the grid across a SWIPE, in both directions', async ({ page }) => {
    // The regression this pins (v20.41). A swipe COMMIT calls updateLegend() but never
    // renderCalendar() — the incoming carousel panel simply becomes the live view — so a legend
    // decision made in renderCalendar was skipped on the navigation people use most.
    //
    // Getting teeth into this needs a swipe where the right answer CHANGES. The boot fetch covers
    // previous/current/next, so one swipe lands on a month that is already known and the legend is
    // correct either way — a first attempt at this test asserted exactly that and passed against the
    // bug. Two swipes reach OUTSIDE the boot window, and delaying reads only AFTER boot leaves that
    // month genuinely unknown while the months behind it stay good.
    await seedMember(page);
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await expect(page.locator('.legend')).toBeVisible();

    // From here on, any NEW month's read hangs. The boot window is already loaded.
    await page.evaluate(() => { (window.__E2E = window.__E2E || {}).docsDelayMs = 30000; });

    await swipeMonth(page, 'next');   // still inside the boot window — known
    await swipeMonth(page, 'next');   // outside it — unknown, so the grid is withheld

    await expect(page.locator('.calendar-pending')).toBeVisible();
    await expect(page.locator('.legend')).toBeHidden();

    // And back: a swipe onto a month that IS known must bring the legend with it. This is the
    // direction a member would report — a perfectly good grid with no colour key.
    await swipeMonth(page, 'prev');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await expect(page.locator('.legend')).toBeVisible();
});

test('calendar: a successful read renders the grid — the withholding is a gate, not a disablement', async ({ page }) => {
    await seedMember(page);
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await expect(page.locator('.calendar-pending')).toHaveCount(0);
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

// ── Cross-guide search (v22.02) ──────────────────────────────────────────────────────────────
// The unit suites cover the matching rules and the index's truth; these cover what only a browser
// can — that the LAZY module actually loads on focus, that results really do ride nav-panel's
// delegated guide-link handler (counting/?from=/history come from there), and that the drawer's
// static list comes back when the query clears.

async function openGuideSearch(page) {
    await page.goto('/');
    await expect(page.locator('#teamMemberSelect option').first()).toBeAttached();
    await page.locator('#navMenuBtn').click();
    const input = page.locator('#navGuideSearchInput');
    await expect(input).toBeVisible();
    await input.click();     // first focus triggers the lazy import
    return input;
}

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
    await expect(page.locator('#navGuideSearchStatus')).toHaveText('No matches in the guides');
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
// the case it gets wrong: `'./paycalc-guide.html'.includes('guide.html')` is TRUE, and `guide.html`
// was the Staff Guide's own filename until the v22.47 rename.
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

// ── THE SIGN-IN NOTICE, AND WHO IT IS FOR (v21.84) ──────────────────────────────────────────────
//
// Replaces the two `pw-own-2026` tests. That notice asked a member to set their own password;
// `password-force.js` now compels exactly that at the next sign-in, so what was left unsaid was the
// thing the staff PIN introduced: on a personal phone the code is re-entered every browser session,
// and signing in once ends it for 60 days.
//
// The audience is the whole design and both halves need a test. It must reach somebody with NO
// session — the skill template's `if (!getSession()) return` would hide it from everybody it is
// written for, which is the trap the old notice's tests existed to catch and which survives the
// rewrite. And it must NOT reach a signed-in member, who has already done the thing it asks; that
// half is new, and it is what removed the retirement write from settings-app.js.
test('calendar: the sign-in notice shows to somebody with no session', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedMember(page, 'S. Silva');                 // a chosen member, deliberately NO session
    await page.addInitScript(() => localStorage.removeItem('myb_notice_sign_in_2026_done'));
    await page.goto('/');
    await expect(page.locator('#signInNoticeLb.visible')).toBeVisible({ timeout: 8000 });

    // Archived on OPEN, not on close: the CTA navigates away, so `onClose` may never fire.
    const archived = await page.evaluate(() => localStorage.getItem('myb_app_notices') || '');
    expect(archived, 'must be in App Notices before the reader can navigate away').toContain('sign-in-2026');

    await page.locator('#signInNoticeLater').click();
    await expect(page.locator('#signInNoticeLb.visible')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('myb_notice_sign_in_2026_snooze')),
        'closing snoozes rather than dismissing for good').toBeTruthy();
});

test('calendar: the sign-in notice stays away from a member who has signed in', async ({ page }) => {
    // No done-flag involved: the audience check answers this on every load, which is why signing in
    // needs no write anywhere to silence it.
    //
    // `seedMemberSession` as WELL as `seedSession`, and that is not belt-and-braces: `decideAccess`
    // requires a local session AND a restored named Firebase identity, so a session alone leaves
    // this file's viewer seed in charge and the notice correctly shows. The distinction is the same
    // one the iOS-ITP case turns on, so it is worth a test getting it right rather than around.
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSession(page, 'S. Silva');
    await seedMemberSession(page, 'S. Silva');
    await seedMember(page, 'S. Silva');
    await page.addInitScript(() => localStorage.removeItem('myb_notice_sign_in_2026_done'));
    await page.goto('/');
    await expect(page.locator('#calendarDisplay')).toBeVisible();
    await page.waitForTimeout(2200);                    // past the 1500ms deferred open
    await expect(page.locator('#signInNoticeLb.visible')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('myb_notice_sign_in_2026_done')),
        'a notice refused by audience is left unflagged, not marked seen').toBeNull();
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

// ── The install strip, and the one thing about it a unit test cannot see (v22.28) ────────────────
//
// The rules in `install-prompt.js` are small enough to look obviously right; the WIRING is where
// this feature can fail, and it fails silently in both directions. So these drive the real page.
//
// The precedence rule is the one worth the most care, and the naive version of this test is
// VACUOUS: headless Chromium has no push service, so `notifSupported()` is false and `#notifPrompt`
// never shows — an assertion that it is hidden would pass with the suppression line deleted. The
// test therefore puts the notification strip on screen FIRST and asserts the install strip takes it
// down, which is the line executing rather than the situation happening not to arise.

/** Put the page in the state the strip is designed for, then fire the browser's install event. */
async function armInstall(page, { showNotif = false, width = 390 } = {}) {
    await page.setViewportSize({ width, height: 800 });   // the strip is mobile-only — see below
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/');
    await page.waitForSelector('#calendarDisplay table, #calendarDisplay .calendar-container', { timeout: 15_000 });
    if (showNotif) await page.evaluate(() => { document.getElementById('notifPrompt').style.display = 'flex'; });
    await page.evaluate(() => {
        const e = new Event('beforeinstallprompt');
        /** @type {any} */ (e).prompt = () => { /** @type {any} */ (window).__promptFired = true; return Promise.resolve(); };
        window.dispatchEvent(e);
    });
    await expect(page.locator('#installPrompt')).toBeVisible();
}

test('install strip: it offers a real Install button once the browser says it can', async ({ page }) => {
    await armInstall(page);
    await expect(page.locator('#installPromptAction')).toBeVisible();
    // The manual iOS steps are the OTHER branch and must not be showing beside a working button.
    await expect(page.locator('#installPromptSteps')).toBeHidden();
});

test('install strip: it takes the notification ask off screen WITHOUT marking it done', async ({ page }) => {
    await armInstall(page, { showNotif: true });
    await expect(page.locator('#notifPrompt')).toBeHidden();
    // The whole point of hiding rather than dismissing: the notification ask returns next visit.
    // Trading one prompt for the other is not what "one at a time" means.
    expect(await page.evaluate(() => localStorage.getItem('myb_notif_prompt_done'))).toBeNull();
});

test('install strip: pressing Install fires the browser prompt and does not come back', async ({ page }) => {
    await armInstall(page);
    await page.locator('#installPromptAction').click();
    expect(await page.evaluate(() => /** @type {any} */ (window).__promptFired)).toBe(true);
    await expect(page.locator('#installPrompt')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('myb_install_prompt_done'))).toBe('1');
});

// ── AN UNREADABLE `--prompt-available` FAILS CLOSED (v22.32, external review) ───────────────────
//
// `canBeSeen` read `!== '0'` first, which meant an UNREADABLE property ('' from a browser with no
// custom-property support) counted as "yes": we would capture `beforeinstallprompt`, suppressing
// the browser's own install promotion, while the strip stayed CSS-hidden. No offer from anyone —
// the one outcome the width check exists to prevent.
//
// No shipping browser does this (Chromium supports both), so the mutation is invisible in a normal
// run and no ordinary test can have teeth on it. Removing the property is what makes the branch
// reachable, and the assertion is on `defaultPrevented`: failing closed means we never registered,
// so the browser keeps its own offer.
test('install strip: an unreadable width flag leaves the browser its own offer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await seedMemberSession(page, 'G. Miller');
    // Serve the stylesheet with the declaration REMOVED, so the property is undefined from the
    // first paint. Injecting a style after load is too late: the module reads the flag as it runs.
    await page.route('**/index.css', async route => {
        const res = await route.fetch();
        const css = (await res.text()).replace('--prompt-available: 1;', '');
        await route.fulfill({ response: res, body: css, headers: { ...res.headers(), 'content-type': 'text/css' } });
    });
    await page.goto('/');
    await page.waitForSelector('#calendarDisplay table, #calendarDisplay .calendar-container', { timeout: 15_000 });
    const prevented = await page.evaluate(() => {
        const e = new Event('beforeinstallprompt', { cancelable: true });
        /** @type {any} */ (e).prompt = () => Promise.resolve();
        window.dispatchEvent(e);
        return e.defaultPrevented;
    });
    expect(prevented,
        'an unreadable flag must NOT be read as "yes" — capturing here suppresses the browser\'s '
        + 'own offer while our strip stays hidden').toBe(false);
    await expect(page.locator('#installPrompt')).toBeHidden();
});

test('install strip: the shared PIN station is never invited to install', async ({ page }) => {
    // A PIN unlock is a STATION, not a person — nobody should be putting the staff roster onto the
    // mess-room PC, and there would be no one able to take it off again.
    await page.setViewportSize({ width: 390, height: 800 });
    await seedViewerAccess(page);
    await seedMember(page);            // a chosen member is a DISPLAY choice, not a session
    await page.goto('/');
    await expect(page.locator('.month-year')).toBeVisible();
    await page.evaluate(() => {
        const e = new Event('beforeinstallprompt');
        /** @type {any} */ (e).prompt = () => Promise.resolve();
        window.dispatchEvent(e);
    });
    await page.waitForTimeout(600);
    await expect(page.locator('#installPrompt')).toBeHidden();
});

test('install strip: on desktop it leaves the browser its OWN install offer', async ({ page }) => {
    // The strip is hidden at desktop widths, so capturing `beforeinstallprompt` there would suppress
    // Chrome's omnibox promotion and put nothing in its place. The observable half of that rule is
    // that the event is NOT preventDefault()ed — which is why this asserts on the event, not the DOM.
    await armInstall(page, { width: 1280 }).catch(() => { /* the strip never shows; that is the point */ });
    const prevented = await page.evaluate(() => {
        const e = new Event('beforeinstallprompt', { cancelable: true });
        /** @type {any} */ (e).prompt = () => Promise.resolve();
        window.dispatchEvent(e);
        return e.defaultPrevented;
    });
    expect(prevented).toBe(false);
    await expect(page.locator('#installPrompt')).toBeHidden();
});

// ─── 360px: THE WIDTH NOTHING RENDERED ────────────────────────────────────────────────────────
// A staff report from a 360px Samsung A-series, v22.62: the quick-action row — 📍 · Team · AL ·
// Admin · Pay — measured 366px against 322px of usable width, so it overflowed by 6px at the
// DEFAULT font size, and `justify-content: center` pushed it off both edges where `overflow-x:
// clip` cut it. Newer phones are 412px and never showed it.
//
// The reason it shipped is the interesting part, and it is a coverage hole rather than a coding
// mistake: the mobile e2e project is Pixel 5 at 393px, the visual baselines are 390px, and the row
// first fits at 384px. Every automated eye sat just above the threshold, on the one width band that
// is by far the commonest on Android. So this asserts the width itself.
//
// It checks the RENDERED GEOMETRY, not the CSS: a fix expressed as wrapping, as tighter spacing or
// as shorter labels should all pass, and only "a member can see the buttons" is being pinned.
// The FONT-SCALED cases are not padding: they are what proves the WRAP is load-bearing. Teeth-check
// on the first cut of this guard — deleting the wrap and restoring `flex-shrink: 0` left all three
// default-size cases GREEN, because the tighter spacing alone fits five buttons at 14px. The wrap
// only earns its keep once Chrome's text scaling grows them, which is the setting an older phone is
// most likely to have turned up. `--type-body` is a fixed px, so scaling `html { font-size }` would
// have measured nothing (it did, in the first attempt to reproduce this bug) — the override has to
// hit the buttons themselves.
for (const [width, fontPx] of [[320, 14], [360, 14], [375, 14], [360, 18], [360, 22], [412, 20]]) {
    test(`calendar: the quick-action row stays on screen at ${width}px / ${fontPx}px text`, async ({ page }) => {
        await seedMember(page);
        await seedMemberSession(page);
        await page.setViewportSize({ width, height: 740 });
        await page.goto('/');
        await page.waitForSelector('.control-group--actions', { state: 'attached' });
        if (fontPx !== 14) {
            await page.addStyleTag({ content:
                `.controls select, .controls button { font-size: ${fontPx}px !important; }` });
        }
        await page.waitForTimeout(400);

        const geo = await page.evaluate((vw) => {
            const group = document.querySelector('.control-group--actions');
            const buttons = [...group.querySelectorAll('button')];
            const r = group.getBoundingClientRect();
            return {
                left: r.left, right: r.right,
                offscreen: buttons
                    .map(b => ({ label: b.textContent.trim(), r: b.getBoundingClientRect() }))
                    .filter(b => b.r.left < -0.5 || b.r.right > vw + 0.5)
                    .map(b => b.label),
                smallest: Math.min(...buttons.map(b => b.getBoundingClientRect().width)),
                shortest: Math.min(...buttons.map(b => b.getBoundingClientRect().height)),
                count: buttons.length,
                // Grouped by rendered TOP, so this reads the wrap the browser actually performed
                // rather than the DOM order or any CSS the fix happens to be expressed in.
                lines: [...new Set(buttons.map(b => Math.round(b.getBoundingClientRect().top)))]
                    .sort((a, b) => a - b)
                    .map(top => buttons
                        .filter(b => Math.round(b.getBoundingClientRect().top) === top)
                        .map(b => b.textContent.trim())),
            };
        }, width);

        expect(geo.count).toBe(5);
        expect(geo.offscreen, `clipped at ${width}px/${fontPx}px: ${geo.offscreen.join(', ')}`).toEqual([]);
        expect(geo.left).toBeGreaterThanOrEqual(-0.5);
        expect(geo.right).toBeLessThanOrEqual(width + 0.5);
        // Wrapping must not be bought with an untappable control. 24px is WCAG 2.5.8 AA; v22.61 set
        // a 30px floor for coarse pointers on the Links chips and the same standard applies here.
        expect(geo.smallest).toBeGreaterThanOrEqual(30);
        expect(geo.shortest).toBeGreaterThanOrEqual(30);

        // AND THE SHAPE OF THE WRAP, which is the half this guard was missing (v22.83). Everything
        // above passed on the 4 + 1 wrap the owner then reported from the same 360px Samsung: a
        // lone centred "💷 Pay" under four buttons, reading as a fault rather than as a second
        // line, and 95px of a phone that had none to spare. Nothing was off screen, so "not
        // clipped" was true and the row still looked broken.
        //
        // Either the five fit on ONE line, or they break 3 + 2 — never 4 + 1, never 2 + 3. The
        // exact split is asserted rather than a softer "no line has one button", because that
        // weaker rule is also satisfied by 1 + 4, which is the same widow at the other end.
        expect(geo.lines.length, `${width}px/${fontPx}px wrapped onto ${geo.lines.length} lines`)
            .toBeLessThanOrEqual(2);
        expect(geo.lines.map(l => l.length), `${width}px/${fontPx}px: ${JSON.stringify(geo.lines)}`)
            .toEqual(geo.lines.length === 1 ? [5] : [3, 2]);
    });
}

// ─── THE ROW ABOVE IT, AND THE ONE THING NO OVERFLOW CHECK CAN SEE ───────────────────────────────
// v22.63 fixed the quick-action row and nobody re-measured the nav row directly above it. At 320px
// it was 334px into 300px, so `← Prev` and `Next →` each hung 14px off an edge and were cut by the
// body's `overflow-x: clip`. Letting the member-select group shrink fixed that and introduced a
// WORSE failure for one release: the group shrank, the select kept its 200px `max-width`, and the
// dropdown painted straight OVER both arrows — 19px at 320, 21px at 360/18px, 35px at 360/22px.
//
// That is the case this block exists for. An overflow assertion cannot see it: nothing leaves the
// viewport, the page does not scroll, every element is present and "visible", and the arrows are
// still hit-testable underneath. Only comparing the boxes to each other says anything is wrong.
// So this asserts SEPARATION, not containment — and on the rendered geometry, so any fix passes.
for (const [width, fontPx] of [[320, 14], [360, 14], [360, 18], [360, 22], [390, 14], [412, 20]]) {
    test(`calendar: the month arrows and the member select never overlap at ${width}px / ${fontPx}px text`, async ({ page }) => {
        await seedMember(page);
        await seedMemberSession(page);
        await page.setViewportSize({ width, height: 780 });
        await page.goto('/');
        await page.waitForSelector('#teamMemberSelect', { state: 'attached' });
        if (fontPx !== 14) {
            await page.addStyleTag({ content:
                `.controls select, .controls button { font-size: ${fontPx}px !important; }` });
        }
        await page.waitForTimeout(300);

        const geo = await page.evaluate((vw) => {
            const box = (sel) => {
                const r = document.querySelector(sel).getBoundingClientRect();
                return { left: r.left, right: r.right };
            };
            const sel = box('#teamMemberSelect');
            return {
                gapLeft:  sel.left - box('#prevMonth').right,
                gapRight: box('#nextMonth').left - sel.right,
                offscreen: [...document.querySelectorAll('.controls button, .controls select')]
                    .filter(e => { const r = e.getBoundingClientRect(); return r.left < -0.5 || r.right > vw + 0.5; })
                    .map(e => e.id || e.textContent.trim()),
                pageOverflow: document.documentElement.scrollWidth - vw,
            };
        }, width);

        expect(geo.offscreen, `cut off at ${width}px/${fontPx}px: ${geo.offscreen.join(', ')}`).toEqual([]);
        expect(geo.pageOverflow, `the page scrolls sideways at ${width}px/${fontPx}px`).toBeLessThanOrEqual(0);
        // A positive gap both sides. Zero would mean touching, negative means one is painted over
        // the other — which is what shipped, and what looks tappable while being covered.
        expect(geo.gapLeft, `the select overlaps ← Prev by ${-geo.gapLeft}px`).toBeGreaterThan(0);
        expect(geo.gapRight, `the select overlaps Next → by ${-geo.gapRight}px`).toBeGreaterThan(0);
    });
}

// ─── THE TEAM VIEW'S WEEK LABEL MUST NOT SIT ON ITS ARROWS ───────────────────────────────────────
// Reported from a 412px phone: the full-month label ("30 August – 5 September 2026") measured 245px
// against a centre column of 167–237px, so it wrapped and — because the centre is `flex: 1` — its
// painted box ran flush against both arrows at ZERO px. On screen "2026" sat against "← Prev".
// The label is now the short form the Admin week grid already uses, and the row carries a gap, so
// the worst case is a tidy two lines rather than a collision.
for (const [width, fontPx] of [[320, 14], [360, 14], [390, 14], [412, 14], [412, 20]]) {
    test(`calendar: the team week label clears its arrows at ${width}px / ${fontPx}px text`, async ({ page }) => {
        await seedMember(page);
        await seedMemberSession(page);
        await page.setViewportSize({ width, height: 820 });
        await page.goto('/');
        await page.waitForSelector('.control-group--actions', { state: 'attached' });
        if (fontPx !== 14) {
            await page.addStyleTag({ content:
                `.controls select, .controls button, .team-week-text, .tv-week-nav { font-size: ${fontPx}px !important; }` });
        }
        await page.locator('#teamViewBtn').click();
        await page.waitForSelector('.team-week-text');
        await page.waitForTimeout(400);

        const geo = await page.evaluate(() => {
            const b = (sel) => { const r = document.querySelector(sel).getBoundingClientRect();
                return { left: r.left, right: r.right }; };
            const label = b('.team-week-text');
            return {
                gapLeft:  label.left - b('#tvPrevWeek').right,
                gapRight: b('#tvNextWeek').left - label.right,
                text: document.querySelector('.team-week-text').textContent.trim(),
            };
        });

        expect(geo.gapLeft, `the week label touches ← Prev (${geo.gapLeft}px)`).toBeGreaterThanOrEqual(4);
        expect(geo.gapRight, `the week label touches Next → (${geo.gapRight}px)`).toBeGreaterThanOrEqual(4);
        // The SHORT form is what keeps it on one line at the widths staff actually use. Asserted on
        // the rendered text so a revert to full month names fails here rather than on a screenshot.
        expect(geo.text, 'the week label went back to full month names').not.toMatch(/January|February|August|September|November|December/);
    });
}

// ─── COMPACT UNDER TEXT SCALING (v22.87, owner decision) ─────────────────────────────────────────
// Android's text size scales every font and leaves the viewport alone, so at 412px the five-button
// row wrapped to 3 + 2 the moment its buttons reached 15px ("Largest"). The owner did not want two
// rows. text-scale.js measures the scale at boot and stamps <html>; the stylesheet tightens the row
// only then. A headless browser has no OS text size, so the scale is STATED through the test seam
// and the fonts scaled to match — the two halves of what a real phone does at once.
// Three things pinned: the default and "Large" rows are untouched (no stamp); at "Largest" and
// above the five stay on ONE line — 412px to 1.75×, 360px to 1.5× — with the icons gone and the
// words kept; and the wrap is still there beneath it all: at a scale compact cannot absorb, the
// row wraps 3 + 2 rather than clipping.
for (const [width, scale, expectRows] of [[412, 1.0, 1], [412, 1.15, 1], [412, 1.3, 1], [412, 1.5, 1], [412, 1.75, 1], [360, 1.3, 1], [360, 1.5, 1], [360, 2.0, 2]]) {
    test(`calendar: the action row at ${width}px under ${scale}× text is ${expectRows} row${expectRows > 1 ? 's' : ''}, nothing cut off`, async ({ page }) => {
        await seedMember(page);
        await seedMemberSession(page);
        await page.addInitScript((sc) => { const w = /** @type {any} */ (window); w.__E2E = Object.assign(w.__E2E || {}, { textScale: sc }); }, scale);
        await page.setViewportSize({ width, height: 820 });
        await page.goto('/');
        await page.waitForSelector('.control-group--actions');
        if (scale !== 1) {
            // Scale the fonts the way the OS would — the seam only tells the page what the scale IS.
            await page.addStyleTag({ content:
                `.controls select, .controls button { font-size: ${Math.round(12 * scale * 10) / 10}px !important; }` });
        }
        await page.waitForTimeout(300);
        const geo = await page.evaluate((vw) => {
            const btns = [...document.querySelectorAll('.control-group--actions button')];
            // Lines, not distinct rounded tops: `align-items: center` puts a shorter button a pixel
            // below a taller one on the SAME line, and an exact-top count read that as two rows.
            const lineCount = (els) => els.map(b => b.getBoundingClientRect().top).sort((a, b) => a - b)
                .reduce((lines, t) => (lines.length && t - lines[lines.length - 1] < 8 ? lines : lines.concat(t)), []).length;
            const rows = lineCount(btns);
            const cut = btns.filter(b => { const r = b.getBoundingClientRect(); return r.left < -0.5 || r.right > vw + 0.5; }).length;
            const pad = getComputedStyle(btns[1]).paddingLeft;
            const icons = [...document.querySelectorAll('.control-group--actions .btn-ico')];
            return { rows, cut, pad, stamp: document.documentElement.getAttribute('data-text-scale'),
                     iconsShown: icons.filter(i => i.getBoundingClientRect().width > 0).length,
                     // innerText, not textContent: a hidden icon span is still in textContent.
                     words: btns.slice(1).map(b => b.innerText.trim()) };
        }, width);
        expect(geo.cut, 'no button off the edge').toBe(0);
        expect(geo.rows, `expected ${expectRows} row(s), got ${geo.rows} (padding ${geo.pad}, stamp ${geo.stamp})`).toBe(expectRows);
        if (scale < 1.2) {
            expect(geo.stamp, 'below the threshold the action row is NOT compact (the heading tier may be stamped)').not.toBe('compact');
            expect(geo.pad, 'below the threshold the buttons keep their own padding, not the compact 8px').not.toBe('8px');
            expect(geo.iconsShown, 'below the threshold every icon is drawn').toBe(4);
        } else {
            expect(geo.stamp, 'at and above the threshold the page is stamped compact').toBe('compact');
            expect(geo.iconsShown, 'compact drops the four decorative icons').toBe(0);
            expect(geo.words, 'and keeps every word').toEqual(['Team', 'AL', 'Admin', 'Pay']);
            // The toggle rewrites the Team button; the icon must stay a hidden span through it.
            await page.locator('#teamViewBtn').click();
            await page.waitForSelector('.team-week-text');
            await page.waitForTimeout(300);   // the nav row hides and the actions row moves; measure after, not during
            const after = await page.evaluate(() => ({
                iconsShown: [...document.querySelectorAll('.control-group--actions .btn-ico')].filter(i => i.getBoundingClientRect().width > 0).length,
                word: document.getElementById('teamViewBtn').innerText.trim(),
                rows: [...document.querySelectorAll('.control-group--actions button')].map(b => b.getBoundingClientRect().top).sort((a, b) => a - b)
                    .reduce((lines, t) => (lines.length && t - lines[lines.length - 1] < 8 ? lines : lines.concat(t)), []).length,
            }));
            expect(after.iconsShown, 'after toggling to Team View the icons are still hidden').toBe(0);
            expect(after.word).toBe('Month');
            expect(after.rows, 'and the row is still as many lines as before').toBe(expectRows);
        }
    });
}

// ─── ON A WIDE SCREEN THE TEAM VIEW BAR IS A CLUSTER, NOT A FULL-WIDTH ROW (v22.86) ─────────────
// At 1280px the two arrows sat at the far edges of a 1040px card, 400px from the label they move,
// while the month view directly above keeps Prev · name · Next as one compact centred group. Both
// rows are capped to the same width, so the ? stays in line with the arrow beneath it.
// Pinned because the first cut of the cap sat in a 900–1023px tablet block and applied on no
// desktop at all — a static rule that reads correctly and reaches nothing.
for (const width of [768, 1024, 1280, 1440]) {
    test(`calendar: the team view bar is one centred cluster at ${width}px, both rows the same width`, async ({ page }) => {
        await seedMember(page);
        await seedMemberSession(page);
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/');
        await page.waitForSelector('.calendar-day');
        await page.locator('#teamViewBtn').click();
        await page.waitForSelector('.team-week-text');
        await page.locator('#tvNextWeek').click();   // browsing away, the fuller state
        await page.waitForTimeout(300);
        const geo = await page.evaluate(() => {
            const r = (s) => document.querySelector(s).getBoundingClientRect();
            const row = r('.team-week-row'), tabs = r('.grade-tabs-row'), card = r('.team-view-container');
            return { rowW: Math.round(row.width), tabsW: Math.round(tabs.width), cardW: Math.round(card.width),
                     centred: Math.abs((row.left + row.right) / 2 - (card.left + card.right) / 2) < 2,
                     helpRight: Math.round(r('#teamHelpBtn').right), nextRight: Math.round(r('#tvNextWeek').right) };
        });
        expect(geo.rowW, 'the week row is capped').toBeLessThanOrEqual(640);
        expect(geo.rowW, 'the cap is narrower than the card, or it is not a cluster').toBeLessThan(geo.cardW);
        expect(geo.tabsW, 'both rows take the same cap').toBe(geo.rowW);
        expect(geo.centred, 'the cluster is centred in the card').toBe(true);
        expect(Math.abs(geo.helpRight - geo.nextRight), 'the ? lines up over Next →').toBeLessThanOrEqual(2);
    });
}

// ─── THE MONTH HEADING ROW IS ONE LINE, AND THE MONTH NAME NEVER SPLITS (v22.86 → v22.87) ────────
// "September 2026" is the longest heading the year produces. v22.86 stopped it splitting as
// "September / 2026▾" by wrapping the row — and on the owner's phone that put the week note on a
// second line where it had always shared the first. So the row is made cheaper instead (a smaller
// note, no dot, a tighter gap, and a smaller base under text scaling), and this pins the OUTCOME:
// one line at the default size from 360px up (a 320px phone has 294px for a 318px row, so there
// the note sits beneath even at the default), one line at "Large" on 360px and at "Largest" on
// 412px, and beyond that the note beneath the heading whole — never the heading split.
// Scaled the way a phone scales: the heading and the note together, and the tier stated through
// the seam, since a headless browser has no OS text size.
for (const [width, scale, oneLine] of [[320, 1.0, false], [360, 1.0, true], [390, 1.0, true], [412, 1.0, true],
                                       [360, 1.15, true], [412, 1.15, true], [412, 1.3, true],
                                       [360, 1.3, false], [412, 1.5, false]]) {
    test(`calendar: the month heading row at ${width}px under ${scale}× text is ${oneLine ? 'one line' : 'the note beneath'}, and the month never splits`, async ({ page }) => {
        await seedMember(page);
        await seedMemberSession(page);
        await page.clock.setFixedTime(new Date('2026-09-03T10:00:00Z'));
        await page.addInitScript((sc) => { const w = /** @type {any} */ (window); w.__E2E = Object.assign(w.__E2E || {}, { textScale: sc }); }, scale);
        await page.setViewportSize({ width, height: 820 });
        await page.goto('/');
        await page.waitForSelector('.calendar-day');
        if (scale !== 1) {
            // Scale what the stylesheet resolved (the tier is already stamped), as the OS would:
            // read each base size first, then set the scaled size explicitly.
            const base = await page.evaluate(() => ({
                h: parseFloat(getComputedStyle(/** @type {Element} */ (document.querySelector('.month-year'))).fontSize),
                n: parseFloat(getComputedStyle(/** @type {Element} */ (document.querySelector('.week-info'))).fontSize),
            }));
            await page.addStyleTag({ content:
                `.month-year { font-size: ${(base.h * scale).toFixed(2)}px !important; } .week-info { font-size: ${(base.n * scale).toFixed(2)}px !important; }` });
        }
        await page.waitForTimeout(250);
        const geo = await page.evaluate(() => {
            const h = document.querySelector('.month-year'), n = document.querySelector('.week-info');
            const rh = h.getBoundingClientRect(), rn = n.getBoundingClientRect();
            const fs = parseFloat(getComputedStyle(h).fontSize);
            return { headingLines: rh.height / (fs * 1.3), sameLine: Math.abs(rn.top - rh.top) < rh.height * 0.6 && rn.left >= rh.right - 1,
                     beneath: rn.top >= rh.bottom - 1, noteLines: rn.height / (parseFloat(getComputedStyle(n).fontSize) * 1.3),
                     headingPx: fs, dot: getComputedStyle(n.firstElementChild || n, '::before').content };
        });
        expect(geo.headingLines, `the month name split (${geo.headingLines.toFixed(2)} lines at ${geo.headingPx}px)`).toBeLessThan(1.5);
        expect(geo.noteLines, 'the note never breaks mid-phrase').toBeLessThan(1.5);
        expect(geo.dot === 'none' || geo.dot === 'normal', 'no separator dot').toBe(true);
        if (oneLine) expect(geo.sameLine, 'the note shares the heading\'s line').toBe(true);
        else expect(geo.beneath, 'past what the row can hold, the note sits beneath the heading, whole').toBe(true);
    });
}

// ─── THE WEEK ROW: THE DATE, THEN THE WORDS (v22.85 → v22.88) ───────────────────────────────────
// v22.85 said the current week with a gold rule under the date and put the way back in a glyph-only
// ↩ beside the grade tabs — tidy, and two things a colleague had to decode. Reversed on review: the
// centre is now a designed two-line stack on EVERY week — the date, then "This week" (a state) or
// "↩ Back to this week" (an action) — with the arrows aligned to the date line, so nothing floats
// and nothing moves between weeks. Pinned: both lines present in both states, the second beneath the
// first, the action only while away and it works, the date line level with the arrows, and the
// words themselves — because the words are the point.
for (const [width, scale] of [[320, 1.0], [412, 1.3], [412, 1.6], [1280, 1.0]]) {
    test(`calendar: the team week row is the date over its words, arrows level with the date, at ${width}px / ${scale}× text`, async ({ page }) => {
        await seedMember(page);
        await seedMemberSession(page);
        await page.clock.setFixedTime(new Date('2026-09-03T10:00:00Z'));   // a cross-month week: the longest label
        await page.setViewportSize({ width, height: 820 });
        await page.goto('/');
        await page.waitForSelector('.control-group--actions', { state: 'attached' });
        await page.locator('#teamViewBtn').click();
        await page.waitForSelector('.team-week-text');
        if (scale !== 1) {
            // Scale the way the OS does — every size by the same factor — so the date line's em-based
            // height and the arrows' font-based height move together, as they do on a phone.
            const base = await page.evaluate(() => Object.fromEntries(['.team-week-text', '.tv-week-nav', '.tv-week-status', '.grade-tab']
                .map(sel => [sel, parseFloat(getComputedStyle(/** @type {Element} */ (document.querySelector(sel))).fontSize)])));
            await page.addStyleTag({ content: Object.entries(base).map(([sel, px]) => `${sel} { font-size: ${(px * scale).toFixed(2)}px !important; }`).join(' ') });
        }
        await page.waitForTimeout(300);

        const state = () => page.evaluate(() => {
            const r = (el) => el.getBoundingClientRect();
            const label = /** @type {HTMLElement} */ (document.querySelector('.team-week-text'));
            const status = /** @type {HTMLElement|null} */ (document.querySelector('.tv-week-status'));
            const prev = r(document.querySelector('#tvPrevWeek'));
            const lb = r(label);
            return {
                words: status ? status.innerText.trim() : null,
                isButton: status ? status.tagName === 'BUTTON' && status.id === 'tvToday' : null,
                beneath: status ? r(status).top >= lb.bottom - 1 : null,
                // The date line is level with the arrows: the arrow box sits inside the label's first line box.
                level: prev.top >= lb.top - 1 && prev.bottom <= lb.top + lb.height + 1,
                jumpBesideTabs: !!document.querySelector('.grade-tabs-row #tvToday'),
            };
        });

        const here = await state();
        expect(here.words, 'on the current week the second line says so').toBe('This week');
        expect(here.isButton, 'and it is a statement, not a control').toBe(false);
        expect(here.beneath, 'the words sit beneath the date').toBe(true);
        expect(here.level, 'the arrows are level with the date line').toBe(true);
        expect(here.jumpBesideTabs, 'nothing beside the grade tabs').toBe(false);

        await page.locator('#tvNextWeek').click();
        await page.waitForTimeout(300);
        const away = await state();
        expect(away.words, 'browsing away, the second line is the way back, in words').toBe('↩ Back to this week');
        expect(away.isButton, 'and it is a real button').toBe(true);
        expect(away.beneath).toBe(true);
        expect(away.level).toBe(true);
        await expect.poll(() => page.locator('#ariaAnnouncer').textContent()).toMatch(/^Week of \d/);
        expect(await page.locator('#ariaAnnouncer').textContent()).not.toMatch(/this week/);

        await page.locator('#tvToday').click();
        await page.waitForTimeout(300);
        expect((await state()).words, 'the words bring you back').toBe('This week');
        await expect.poll(() => page.locator('#ariaAnnouncer').textContent()).toMatch(/this week/);
    });
}

// The abbreviation above is a WIDTH decision. The screen-reader announcement has no width, so it
// keeps the full month — a spoken "Jul" would be a regression bought for a column it does not sit
// in. Asserted on the live region's text, which nothing visual can see.
test('calendar: the team week is ANNOUNCED with the full month name, not the on-screen short form', async ({ page }) => {
    await seedMember(page);
    await seedMemberSession(page);
    await page.setViewportSize({ width: 390, height: 820 });
    await page.goto('/');
    await page.waitForSelector('.control-group--actions', { state: 'attached' });
    await page.locator('#teamViewBtn').click();
    await page.waitForSelector('.team-week-text');
    await page.locator('#tvNextWeek').click();
    await expect.poll(() => page.locator('#ariaAnnouncer').textContent()).toMatch(/^Week of \d/);
    const spoken = await page.locator('#ariaAnnouncer').textContent();
    expect(spoken, `announced "${spoken}"`).toMatch(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/);
    expect(spoken, `announced the short form: "${spoken}"`).not.toMatch(/\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/);
});

// ─── THE DAY PANEL'S TWO NEW LINES, AND THE NARROW-PHONE ACTION ROW (v22.89) ─────────────────────
//
// Both from an external review. The unit suites own the RULES — which members have a roster week,
// which knowledge state may confirm a day — and these own the WIRING, which is the half this repo
// has recorded losing: a perfect rule whose result is never written, or written into an element
// nothing shows.

test('day detail: states the roster week under the date', async ({ page }, info) => {
    test.skip(!isTouchProject(info), 'the day panel is the touch route; desktop hovers');
    await seedMember(page);
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.locator('.calendar-day:not(.other-month)').first().click();

    const week = page.locator('#dayDetailWeek');
    await expect(week).toBeVisible();
    // The member's OWN words, not a hardcoded "CEA": the seeded member is on the main rotation, and
    // a fixed-line member must get no row at all (weekContext, unit-tested against the real table).
    await expect(week).toHaveText(/^[A-Za-z]+ Week \d+$/);

    // Under the date, above the shift — it is context FOR the date, not a third headline.
    const box = async (sel) => await page.locator(sel).boundingBox();
    const [date, wk, shift] = await Promise.all(
        ['#dayDetailDate', '#dayDetailWeek', '#dayDetailShift'].map(box));
    expect(wk.y, 'the week sits below the date').toBeGreaterThanOrEqual(date.y + date.height - 2);
    expect(shift.y, 'and above the shift').toBeGreaterThanOrEqual(wk.y + wk.height - 2);
});

test('day detail: an unchanged day says so, a changed one shows the change instead', async ({ page }, info) => {
    test.skip(!isTouchProject(info), 'the day panel is the touch route; desktop hovers');
    await seedMember(page);
    // One override, so the same month holds both states and neither can pass by the fixture alone.
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.docs = [];
        for (let m = 1; m <= 12; m++) {
            w.__E2E.docs.push({ id: 'ovc' + m, memberName: 'G. Miller',
                date: '2026-' + String(m).padStart(2, '0') + '-04',
                type: 'shift', value: '07:00-16:00', note: '' });
        }
    });
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();

    const changedIdx = await page.evaluate(() => [...document.querySelectorAll('.calendar-day:not(.other-month)')]
        .findIndex(c => c.dataset.detailBaseShift));
    expect(changedIdx, 'the fixture no longer overrides a day in this month').toBeGreaterThan(-1);
    const plainIdx = await page.evaluate(() => [...document.querySelectorAll('.calendar-day:not(.other-month)')]
        .findIndex(c => c.dataset.detailDay && !c.dataset.detailBaseShift));
    expect(plainIdx, 'no unchanged day in this month').toBeGreaterThan(-1);

    // THE CHANGED DAY: the change, and never the confirmation — they are one slot.
    await page.locator('.calendar-day:not(.other-month)').nth(changedIdx).click();
    await expect(page.locator('#dayDetailChange')).toBeVisible();
    await expect(page.locator('#dayDetailAsRostered')).toBeHidden();
    await page.locator('#dayDetailClose').click();
    await expect(page.locator('#dayDetailChange')).toBeHidden();

    // THE UNCHANGED DAY: the confirmation, in the same place, and in words.
    await page.locator('.calendar-day:not(.other-month)').nth(plainIdx).click();
    const rostered = page.locator('#dayDetailAsRostered');
    await expect(rostered).toBeVisible();
    await expect(rostered).toHaveText(/as rostered/i);
    await expect(page.locator('#dayDetailChange')).toBeHidden();

    // `hidden` must actually hide, and `display: flex` out-specifies the attribute — the trap
    // page-visibility-parity guards statically and this one can see for real.
    await expect(page.locator('#dayDetailChange')).toHaveCSS('display', 'none');
});

test('day detail: a month before the member joined confirms nothing', async ({ page }, info) => {
    test.skip(!isTouchProject(info), 'the day panel is the touch route; desktop hovers');
    // THE FOURTH WAY "As rostered" CAN BE UNEARNED, and the only one that is not about knowledge
    // (v22.93). J. Davies starts 5 May 2026, so April 2026 is entirely before their roster begins:
    // `getBaseShift` suppresses every shift to a rest day, base and effective therefore match, and
    // the day lands in the unchanged branch on a month whose read has settled — the one state
    // allowed to speak. The panel confirmed a rest day nobody was ever rostered for.
    //
    // Reachable by pressing Prev, which is exactly what a new starter does. Driven through the REAL
    // roster table rather than a fixture, because the rule is about a member's own `startDate` and a
    // fixture would only prove the branch, not that any member reaches it.
    await seedMember(page, 'J. Davies');
    await seedMemberSession(page, 'J. Davies');
    await page.addInitScript(() => {
        // calendar-state.js restores a PAST month from these; a future one is refused.
        localStorage.setItem('myb_roster_month', '3');    // April, 0-indexed
        localStorage.setItem('myb_roster_year',  '2026');
    });
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();

    const state = await page.evaluate(() => {
        const cells = [...document.querySelectorAll('.calendar-day:not(.other-month)')]
            .filter(c => c.dataset.detailDay);
        return {
            month:    document.querySelector('.month-year')?.textContent?.trim(),
            grid:     document.querySelector('.calendar-grid')?.parentElement?.dataset.overrideState,
            n:        cells.length,
            claiming: cells.filter(c => c.dataset.detailAsRostered).length,
        };
    });
    expect(state.month, 'the persisted month must have been restored').toContain('April 2026');
    expect(state.n, 'precondition: the grid rendered its days').toBeGreaterThan(0);
    expect(state.claiming,
        'every day in this month is before J. Davies started, so none of them is a roster the app ' +
        'can confirm — the rest days shown are suppression, not rostered rest days').toBe(0);

    // And the panel is correspondingly silent, rather than the flag being written and ignored.
    await page.locator('.calendar-day:not(.other-month)').first().click();
    await expect(page.locator('#dayDetailAsRostered')).toBeHidden();
    // The WEEK still shows: the month header states it too, and `weekContext` exists so the two
    // surfaces cannot disagree about who has a rotating week. Silencing one and not the other would
    // be the drift that function was written to prevent.
    await expect(page.locator('#dayDetailWeek')).toBeVisible();
});

// The five action buttons on a phone NARROWER than the app's 360px design width. Android's
// "Display size" setting shrinks the CSS viewport where the separate font-size setting does not, so
// an older Samsung on a larger one reports ~320-333px — and at the DEFAULT text size the row needed
// 319px against 294px and wrapped to two. Text scale could never have caught it: this is the other
// axis. Measured plain, no seam and no font simulation.
for (const width of [320, 333, 360]) {
    test(`calendar: the action row is one line at ${width}px with no text scaling`, async ({ page }) => {
        await seedMember(page);
        await seedMemberSession(page);
        await page.setViewportSize({ width, height: 820 });
        await page.goto('/');
        await page.waitForSelector('.control-group--actions button');
        await page.waitForTimeout(250);
        const geo = await page.evaluate((vw) => {
            const btns = [...document.querySelectorAll('.control-group--actions button')];
            const lines = btns.map(b => b.getBoundingClientRect().top).sort((a, b) => a - b)
                .reduce((L, t) => (L.length && t - L[L.length - 1] < 8 ? L : L.concat(t)), []).length;
            return { lines, cut: btns.filter(b => { const q = b.getBoundingClientRect();
                        return q.left < -0.5 || q.right > vw + 0.5; }).length,
                     stamp: document.documentElement.getAttribute('data-text-scale'),
                     icons: [...document.querySelectorAll('.control-group--actions .btn-ico')]
                        .filter(i => i.getBoundingClientRect().width > 0).length,
                     // innerText, not textContent: a hidden icon span is still in textContent.
                     // The leading emoji is stripped so one assertion covers both sides of the
                     // breakpoint — the WORD is what must survive, with or without its icon.
                     words: btns.slice(1).map(b => b.innerText.replace(/^[^A-Za-z]+/, '').trim()) };
        }, width);
        expect(geo.stamp, 'no text scaling here — this is purely a width case').toBeNull();
        expect(geo.cut, 'no button off the edge').toBe(0);
        expect(geo.lines, `expected one line at ${width}px, got ${geo.lines}`).toBe(1);
        expect(geo.words, 'the WORDS are the content and never go, at any width')
            .toEqual(['Team', 'AL', 'Admin', 'Pay']);
        // Below the design width the four decorative icons are what pays for the single line;
        // at 360 and above they stay.
        expect(geo.icons, width < 360 ? 'icons drop below 360px' : 'icons stay from 360px')
            .toBe(width < 360 ? 0 : 4);
    });
}

// ─── THE DAY PANEL'S HEADING BLOCK, AND THE LEAVE ACTION (v22.91) ────────────────────────────────

test('day detail: the roster week is bound to the date, not floating between it and the shift', async ({ page }, info) => {
    test.skip(!isTouchProject(info), 'the day panel is the touch route; desktop hovers');
    await seedMember(page);
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.locator('.calendar-day:not(.other-month)').first().click();
    await expect(page.locator('#dayDetailWeek')).toBeVisible();

    const g = await page.evaluate(() => {
        const b = (/** @type {string} */ s) => document.querySelector(s).getBoundingClientRect();
        const date = b('#dayDetailDate'), week = b('#dayDetailWeek'), shift = b('.day-detail-shift');
        return { toDate: Math.round(week.top - (date.top + date.height)),
                 toShift: Math.round(shift.top - (week.top + week.height)),
                 dateFs: parseFloat(getComputedStyle(document.querySelector('#dayDetailDate')).fontSize),
                 weekFs: parseFloat(getComputedStyle(document.querySelector('#dayDetailWeek')).fontSize) };
    });
    // The defect this fixes was EQUIDISTANCE — 9px from the date it belongs to and 8px from the
    // shift it does not, so it read as a floating third line. The numbers are not pinned, only the
    // relationship, which is the thing that carries the meaning.
    expect(g.toDate, `week sits ${g.toDate}px under the date and ${g.toShift}px above the shift`)
        .toBeLessThan(g.toShift);
    // And a real type step, so the two are a heading and its caption rather than two greys.
    expect(g.weekFs, 'the week must be visibly smaller than the date').toBeLessThan(g.dateFs);
});

test('day detail: an annual-leave day offers the leave dates, and no other day does', async ({ page }, info) => {
    test.skip(!isTouchProject(info), 'the day panel is the touch route; desktop hovers');
    await seedMember(page);
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.docs = [];
        for (let m = 1; m <= 12; m++) {
            w.__E2E.docs.push({ id: 'al' + m, memberName: 'G. Miller',
                date: '2026-' + String(m).padStart(2, '0') + '-04',
                type: 'annual_leave', value: 'AL', note: '' });
        }
    });
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();

    const alIdx = await page.evaluate(() => [...document.querySelectorAll('.calendar-day:not(.other-month)')]
        .findIndex(c => c.dataset.detailShiftValue === 'AL'));
    expect(alIdx, 'the fixture no longer puts leave in this month').toBeGreaterThan(-1);
    // NEITHER action: not leave, and not a pay-marked day. The row's own guard is about the day
    // that has nothing to offer, so a payday would prove the opposite of what the last block asks.
    const otherIdx = await page.evaluate(() => [...document.querySelectorAll('.calendar-day:not(.other-month)')]
        .findIndex(c => c.dataset.detailDay && c.dataset.detailShiftValue !== 'AL'
                        && !c.dataset.paydayIso && !c.dataset.cutoffIso));
    expect(otherIdx, 'the fixture has no ordinary day left to check').toBeGreaterThan(-1);

    await page.locator('.calendar-day:not(.other-month)').nth(alIdx).click();
    const leave = page.locator('#dayDetailLeaveBtn');
    await expect(leave).toBeVisible();
    await expect(leave).toHaveText(/leave dates/i);
    // It must NAME its destination, and reach the list rather than the page it sits on.
    await expect(leave).toHaveAttribute('href', /admin\.html#alBookedBox/);
    // THE ROW IS A ROW (v22.98). Stacked, the pair was the tallest group on the panel; the label
    // shortening is what let them share a line, so a reverted label silently reverts the layout.
    await expect(page.locator('#dayDetailActions')).toHaveCSS('display', 'flex');
    await page.locator('#dayDetailClose').click();

    // Every other day: absent, and absent MEANS hidden — `display: inline-flex` out-specifies the
    // `hidden` attribute, which on an action would offer a member a route that does not apply.
    await page.locator('.calendar-day:not(.other-month)').nth(otherIdx).click();
    await expect(leave).toBeHidden();
    await expect(leave).toHaveCSS('display', 'none');
    // AND THE ROW GOES WITH THEM. A container that outlives its children draws 12px of margin
    // under a panel with no actions — on the COMMON day, to serve the one-a-year pair. Nothing on
    // screen says "there is an empty box here", which is why it is asserted rather than eyeballed.
    await expect(page.locator('#dayDetailActions')).toHaveCSS('display', 'none');
});

// ─── THE SAVED-COPY LADDER RUNG (v22.95) ────────────────────────────────────────────────────────
//
// `rosterCached` splits the gap the 5 Sep 2026 field read exposed — Unlocked 58% over a second,
// Shifts shown 78%, and nothing in between to say where the eighteen points went.
//
// IT IS HERE BECAUSE THE UNIT SUITES CANNOT SEE IT. The mark is made by the coordinator, from a
// `.then()` on the initial fetch's `cacheSettled`; the reporter suite pins what a MARKED boot
// records and the stats suite pins where the rung sits, and a mutation removing the `if (painted)`
// guard left all of them green. This is the only lane that runs the real wiring.
//
// The rule it protects is the honesty one: a device with no saved copy has no moment at which its
// saved copy became available. Marked anyway, first-visit boots would enter a distribution about
// how quickly storage answers — the figure that exists to price a change for people who DO have a
// cache would then be measuring people who do not.
const CACHED_MARK = 'myb-roster-cached';

test('calendar: a cache HIT stamps the saved-copy milestone', async ({ page }) => {
    await seedSession(page);
    await seedMember(page);
    // One override in the visible window is enough — phase 1 paints and records `cached` knowledge.
    await page.addInitScript(() => {
        const d = new Date();
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-15`;
        window.__E2E = Object.assign(window.__E2E || {}, {
            authUser: true,
            cacheDocs: [{ id: 'x', memberName: 'G. Miller', date: iso, type: 'rdw', value: '09:00-17:00' }],
        });
    });
    await page.goto('/index.html');
    await expect(page.locator('.calendar-day').first()).toBeVisible({ timeout: 20000 });
    await expect.poll(
        () => page.evaluate((m) => performance.getEntriesByName(m).length, CACHED_MARK),
        { message: 'a cache hit must stamp the saved-copy rung', timeout: 15000 },
    ).toBeGreaterThan(0);
});

test('calendar: a cache MISS stamps NOTHING — it has no such moment', async ({ page }) => {
    await seedSession(page);
    await seedMember(page);
    // No cacheDocs ⇒ the stub resolves an EMPTY snapshot, which is a real first-visit device.
    await page.addInitScript(() => {
        window.__E2E = Object.assign(window.__E2E || {}, { authUser: true });
    });
    await page.goto('/index.html');
    await expect(page.locator('.calendar-day').first()).toBeVisible({ timeout: 20000 });
    // The grid is up and the boot has run its course, so the mark would exist by now if it were
    // made unconditionally — which is exactly the mutation this catches.
    await expect.poll(
        () => page.evaluate(() => performance.getEntriesByName('myb-page-ready').length),
        { message: 'the boot must actually have finished before asserting an absence', timeout: 15000 },
    ).toBeGreaterThan(0);
    const marks = await page.evaluate((m) => performance.getEntriesByName(m).length, CACHED_MARK);
    expect(marks, 'a boot with no saved copy must not be given a time').toBe(0);
});
