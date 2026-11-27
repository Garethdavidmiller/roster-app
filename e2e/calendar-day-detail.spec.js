/**
 * calendar-day-detail.spec.js — the Calendar (index.html): the day-detail panel — what it says a day
 * is, what it changed from, its personal actions, and one Back out of it.
 *
 * Split by feature out of calendar.spec.js on 25 Nov 2026, test for test and unchanged; what more than
 * one calendar-*.spec.js file needs is in calendar-helpers.js. Every file keeps the old file's
 * `beforeEach`, so each test still starts signed in as a member. The Calendar's access gate is
 * calendar-access.spec.js.
 */
import { test, expect } from './fixtures.js';
import { teamMembers, getPatternShift } from '../roster-data.js';
import { collectFatalErrors, seedMember, seedCalendarMember, seedMemberSession, isTouchProject } from './helpers.js';

// ── Calendar access ─────────────────────────────────────────────────────────────────────────────
// The Calendar opens only for a signed-in member (since the staff PIN was retired, 23 Nov 2026; from
// v20.12 the PIN opened it too), so a spec that simply loads index.html gets the sign-in card and none
// of the roster. Every test in this file is about what the Calendar DOES once it is open, not about
// the gate, so each page starts signed in as a member with no calendar picked on this device
// (`seedCalendarMember`) — the member's own calendar. Until the PIN went it started on a PIN viewer,
// whose `getSession()` was null; the tests that existed only for that state (the first-run prompt,
// the station PC's Team View and bug report) went with it. The gate itself is calendar-access.spec.js.
test.beforeEach(async ({ page }) => { await seedCalendarMember(page); });

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
test('day detail: names the roster it was changed from, and opens at full size', async ({ page }) => {
    // UNGATED SINCE v23.59, and the note is kept because the reason it WAS gated is instructive: the
    // panel used to be the touch affordance alone, a desktop click opened nothing, and the first cut
    // of this test ran on both projects and failed on chromium for exactly that reason. The click
    // now opens the panel on every pointer type, so the gate would skip real coverage on two engines.
    // PINNED TO SEPTEMBER 2026 (1 Oct 2026): this fixture is written against September's base roster and a weekday 4th,
    // and it read the real clock — it went red on 1 Oct, when the month on screen became October (the 4th a Sunday,
    // where leave is never shown, and G. Miller's 3rd–6th no longer a cover week). A fixed mid-month day keeps it honest.
    await page.clock.setFixedTime(new Date('2026-09-16T09:00:00Z'));
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
    // one fact, and the arrow is not a word. Visually hidden TEXT, not an aria-label: a label on a
    // plain <div> names nothing, so a screen reader may skip it and read the fragments (17 Nov 2026).
    // Asserted on the accessibility tree itself, which is what a screen reader is given.
    await expect(change.locator('#dayDetailChangeSaid')).toHaveText(/^Base roster Spare day, changed to /);
    const said = (await change.locator('#dayDetailChangeSaid').textContent()) ?? '';
    expect(await change.ariaSnapshot(), 'the block is read as its parts as well as, or instead of, its one sentence')
        .toBe(`- text: ${said}`);

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

// THE CHANGE'S CAPTION READS ON THE GLASS (whole-app review, 10 Nov 2026). "Changed from base roster" is
// 10px white on the panel's see-through glass, and at 55% it measured 4.3–4.4:1 over the light calendar
// card: under the 4.5:1 its size needs, the one caption the Oct 2026 contrast pass left behind. axe rates
// text on a see-through sheet as incomplete, so this reads the ground the browser painted BESIDE the
// caption and composites the caption's own colour on it, as the browser does.
test('day detail: the "Changed from base roster" caption clears 4.5:1 on the glass over the calendar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.clock.setFixedTime(new Date('2026-09-16T09:00:00Z'));
    await seedMember(page);
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.docs = [3, 4].map(d => ({ id: 'ov' + d, memberName: 'G. Miller',
            date: `2026-09-0${d}`, type: 'shift', value: '07:00-16:00', note: '' }));
    });
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    const idx = await page.evaluate(() => [...document.querySelectorAll('.calendar-day:not(.other-month)')]
        .findIndex(c => /** @type {HTMLElement} */ (c).dataset.detailBase));
    expect(idx, 'premise: a changed day').toBeGreaterThan(-1);
    await page.locator('.calendar-day:not(.other-month)').nth(idx).click();
    await expect(page.locator('#dayDetailContent')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
    await expect(page.locator('#dayDetailLightbox')).toHaveCSS('opacity', '1');
    const caption = page.locator('#dayDetailChange .ddc-eyebrow');
    const box = /** @type {{x: number, y: number, width: number, height: number}} */ (await caption.boundingBox());
    const shot = (await page.screenshot({ clip: { x: box.x - 16, y: box.y, width: box.width + 32, height: box.height } })).toString('base64');
    const colour = await caption.evaluate(el => getComputedStyle(el).color);
    const lab = await page.context().newPage();
    const ratio = await lab.evaluate(async ([png, css]) => {
        const img = new Image();
        img.src = `data:image/png;base64,${png}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        // The ground: the outer 13px of the 16px margin each side of the caption, every row — glass, no glyph.
        /** @type {number[]} */ const xs = [];
        for (let k = 0; k < 13; k++) xs.push(k, c.width - 1 - k);
        let n = 0; const sum = [0, 0, 0];
        for (let y = 0; y < c.height; y++) for (const x of xs) {
            const k = 4 * (y * c.width + x);
            for (let i = 0; i < 3; i++) sum[i] += d[k + i];
            n++;
        }
        const ground = sum.map(v => v / n);
        const [r, gr, b, a = 1] = (css.match(/[\d.]+/g) || []).map(Number);
        const text = [r, gr, b].map((v, i) => v * a + ground[i] * (1 - a));
        const lum = (/** @type {number[]} */ rgb) => {
            const [R, G, B] = rgb.map(v => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
            return 0.2126 * R + 0.7152 * G + 0.0722 * B;
        };
        const [hi, lo] = [lum(text), lum(ground)].sort((p, q) => q - p);
        return (hi + 0.05) / (lo + 0.05);
    }, [shot, colour]);
    await lab.close();
    expect(ratio, `the caption measured ${ratio.toFixed(2)}:1 on its glass`).toBeGreaterThanOrEqual(4.5);
});

// A change WITHIN one shift kind — a time tweak, and probably the commonest change there is. The
// badge carries the kind, so both sides classify as Early and the pair drew `☀️ EARLY → ☀️ EARLY`:
// two identical pills either side of an arrow, reading as "nothing changed" directly under a
// headline saying it did. Found by looking at the render, not by reasoning about it. A timed pill
// shows its TIME; the kind is still carried by the colour, the emoji and the accessible label.
// THE TWO DAY-DETAIL TESTS BELOW SEED 2026 AND OPEN ON TODAY'S MONTH (test audit, 7 Nov 2026), so
// from 1 Jan 2027 they found no changed day in view and failed — measured with the whole suite's
// clock pinned to 4 Jan 2027. Neither is about the date, so both pin a 2026 one.
const OVERRIDES_2026_DAY = new Date('2026-11-04T09:00:00Z');

test('day detail: a same-KIND change still reads as a change', async ({ page }) => {
    await page.clock.setFixedTime(OVERRIDES_2026_DAY);
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
test('day detail: the date clears the close button at every phone width', async ({ page }) => {
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
    });
    // A clock after the month, so no day in it is Today; the link names the month (a stored one is kept
    // only half an hour — calendar-state.js).
    await page.clock.setFixedTime(new Date('2027-01-20T10:00:00Z'));
    await page.goto('/?date=2026-09-30');
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
test('day detail: the day markers carry the calendar\'s own icons', async ({ page }) => {
    await seedMember(page);
    await page.clock.setFixedTime(new Date('2027-01-20T10:00:00Z'));
    await page.goto('/?date=2026-12-25');
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

// WHOSE DAY (18 Nov 2026). The Calendar shows a colleague's days as readily as the reader's own, and on a
// phone the glass blurs the picker that names them, so the panel says whose day it is, as the leave panel
// says whose leave: under the date, clear of the ✕ the date clears, and in the dialog's name. A name picked
// later is the one the next panel names — the cells carry it, so a redraw must too. Names are read from the
// page, never written here.
test('day detail: says whose day it is, under the date and in the dialog\'s name', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.clock.setFixedTime(new Date('2026-09-16T09:00:00Z'));
    await seedMember(page);
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    const chosen = async () => ((await page.locator('#teamMemberSelect option:checked').textContent()) ?? '').trim();
    const first = await chosen();
    expect(first, 'premise: a member is chosen').not.toBe('');
    await page.locator('.calendar-day:not(.other-month)').first().click();
    await expect(page.locator('#dayDetailContent')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
    await expect(page.locator('#dayDetailWho'), 'the panel does not say whose day it is').toHaveText(first);
    await expect(page.locator('#dayDetailLightbox')).toHaveAttribute('aria-label', `Day details, ${first}`);
    const g = await page.evaluate(() => {
        const b = (/** @type {string} */ s) => { const r = /** @type {Element} */ (document.querySelector(s)).getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };
        return { week: b('#dayDetailWeek'), who: b('#dayDetailWho'), shift: b('#dayDetailShift'), close: b('#dayDetailClose') };
    });
    expect(g.who.t, 'the name sits under the date and its week').toBeGreaterThanOrEqual(g.week.b - 1);
    expect(g.shift.t, 'and above the shift').toBeGreaterThanOrEqual(g.who.b - 1);
    expect(g.who.l < g.close.r && g.who.r > g.close.l && g.who.t < g.close.b && g.who.b > g.close.t,
        'the name runs under the close button').toBe(false);

    await page.locator('#dayDetailClose').click();
    await expect(page.locator('#dayDetailLightbox')).not.toHaveClass(/visible/);
    await page.locator('#teamMemberSelect').selectOption({ index: 1 });
    const second = await chosen();
    expect(second, 'premise: another member is chosen').not.toBe(first);
    await page.locator('.calendar-day:not(.other-month)').first().click();
    await expect(page.locator('#dayDetailWho'), 'the panel named the member chosen before').toHaveText(second);
});

// 25 AND 26 DECEMBER (18 Nov 2026). A record that is not leave, on a Christmas day the member was due to
// work, changed the day FROM its Christmas leave, so the pair starts at 🏖️ AL — and the caption called that
// leave the "base roster", whose turn was the very one on the right. The caption and the spoken sentence
// now say it is the Christmas leave. A real member, so "due at work" is the real pattern; found by grade.
test('day detail: a Christmas day a record changed from its Christmas leave says so', async ({ page }) => {
    const XMAS = new Date(2026, 11, 25);
    const member = teamMembers.find(m => m.role === 'CEA' && !m.hidden && !m.startDate
        && !['RD', 'OFF', 'SPARE'].includes(getPatternShift(m, XMAS)));
    expect(member, 'premise: a CEA due at work on Christmas Day 2026').toBeTruthy();
    const times = getPatternShift(member, XMAS);
    await page.clock.setFixedTime(new Date('2026-12-10T09:00:00Z'));
    await seedMember(page, member.name);
    await page.addInitScript(([name, value]) => {
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.docs = [{ id: 'xmas', memberName: name, date: '2026-12-25', type: 'shift', value, note: '',
            source: 'manual', changedBy: 'X. Manager' }];
    }, [member.name, times]);
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.locator('.calendar-day:not(.other-month)').nth(24).click();
    await expect(page.locator('#dayDetailDate')).toHaveText(/25 December 2026/);
    await expect(page.locator('#dayDetailChangePair .ddc-badge').first(), 'premise: the pair starts at the leave').toContainText('AL');
    await expect(page.locator('#dayDetailChangeFrom')).toHaveText('Changed from Christmas leave');
    await expect(page.locator('#dayDetailChangeSaid')).toHaveText(/^Changed from Christmas leave to /);
});

// An UNCHANGED day is the state the redesign is really for: it was the one the panel rendered in
// monochrome, so the app's shift colour and glyph read as properties of "something happened"
// rather than of the shift. A plain Late turn and a plain Rest day were one grey card with
// different words on it.
test('day detail: an UNCHANGED day still leads with its own kind glyph', async ({ page }) => {
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

// ─── THE DAY PANEL'S TWO NEW LINES, AND THE NARROW-PHONE ACTION ROW (v22.89) ─────────────────────
//
// Both from an external review. The unit suites own the RULES — which members have a roster week,
// which knowledge state may confirm a day — and these own the WIRING, which is the half this repo
// has recorded losing: a perfect rule whose result is never written, or written into an element
// nothing shows.

test('day detail: states the roster week under the date', async ({ page }) => {
    await seedMember(page);
    // PINNED (1 Oct 2026): it opens the first day of the month on screen, and on 1 Oct WebKit placed the date's box
    // about 3px into the week line's — a sub-pixel layout difference with the month, not a visible overlap — where
    // every September run had passed. A fixed day keeps the geometry check about layout, not about the calendar.
    await page.clock.setFixedTime(new Date('2026-09-16T09:00:00Z'));
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

test('day detail: an unchanged day says so, a changed one shows the change instead', async ({ page }) => {
    await page.clock.setFixedTime(OVERRIDES_2026_DAY);   // see the note above the same-KIND test
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

test('day detail: a month before the member joined confirms nothing', async ({ page }) => {
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
    await page.goto('/?date=2026-04-01');   // a link that names the date opens its month
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
    expect(state.month, 'the month the link named must open').toContain('April 2026');
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

// ─── THE DAY PANEL'S HEADING BLOCK, AND THE LEAVE ACTION (v22.91) ────────────────────────────────

test('day detail: the roster week is bound to the date, not floating between it and the shift', async ({ page }) => {
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

// ── WHICH YEAR'S ALLOWANCE (v25.18) ─────────────────────────────────────────────────────────────
// A January leave day may come out of the previous year's allowance (leave-year.js). The renderer
// writes the year onto the cell and the panel says so; the leave panel's figures reach across New
// Year and say THAT too, or 2026's Booked would include a day nobody can see in 2026. Unit tests
// pin the rule and the words; only a browser proves the record reaches both panels.
test('day detail: a January leave day moved to last year\'s allowance says so, and the leave panel counts it there', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2027-01-11T09:00:00Z'));
    await seedMemberSession(page, 'G. Miller');
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        const day = (/** @type {string} */ date, /** @type {any} */ extra = {}) =>
            ({ id: 'al-' + date, memberName: 'G. Miller', date, type: 'annual_leave', value: 'AL', note: '', source: 'manual', ...extra });
        // 5 and 6 Jan 2027 are worked days on his line; the 5th comes out of 2026, the 6th its own year.
        w.__E2E.docs = [day('2027-01-05', { leaveYear: 2026 }), day('2027-01-06')];
    });
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();

    const cell = (/** @type {string} */ day) => page.locator(`.calendar-day:not(.other-month)[data-detail-day="${day}"]`);
    await expect(cell('Tuesday 5 January 2027')).toHaveAttribute('data-detail-shift-value', 'AL');
    await cell('Tuesday 5 January 2027').click();
    const line = page.locator('#dayDetailLeaveYear');
    await expect(line).toBeVisible();
    await expect(line).toHaveText('From the 2026 allowance');
    await page.locator('#dayDetailClose').click();
    // Its own year needs no saying — and absent means HIDDEN, not an empty line drawing its space.
    await cell('Wednesday 6 January 2027').click();
    await expect(line).toBeHidden();
    await expect(line).toHaveCSS('display', 'none');
    await page.locator('#dayDetailClose').click();

    // The leave panel opens on 2027: the 5th is not in 2027's figures, and a line says where it went.
    await page.locator('#alBtn').click();
    await expect(page.locator('#alLbYear')).toHaveText('2027');
    await expect(page.locator('#alLbCarry')).toHaveText('1 day in January comes out of 2026’s allowance.');
    await expect(page.locator('#alLbTaken')).toHaveText('1');      // the 6th, its own year's
    // …and 2026's figures include it, dated next year, with the line saying so.
    await page.locator('#alLbPrevYear').click();
    await expect(page.locator('#alLbYear')).toHaveText('2026');
    await expect(page.locator('#alLbCarry')).toHaveText('Includes 1 day in January 2027.');
    await expect(page.locator('#alLbTaken')).toHaveText('1');
});

test('day detail: an annual-leave day offers the leave dates, and no other day does', async ({ page }) => {
    // SIGNED IN, ON THEIR OWN CALENDAR — the only state the action is offered in since v23.04, and
    // it has to be seeded explicitly: this file's default is a VIEWER session (see its header), and
    // a PIN-unlocked machine now gets no personal actions at all. This test is about the AL rule,
    // so it needs the identity rule satisfied to reach it; the identity rule has its own test below.
    // `seedMemberSession`, not `seedSession` — `decideAccess` rule 1 wants a restored FIREBASE USER
    // as well as a local session, so a session alone leaves the access type `none` and the Calendar
    // never paints at all (measured, not assumed).
    // PINNED TO SEPTEMBER 2026 (1 Oct 2026): this fixture is written against September's base roster and a weekday 4th,
    // and it read the real clock — it went red on 1 Oct, when the month on screen became October (the 4th a Sunday,
    // where leave is never shown, and G. Miller's 3rd–6th no longer a cover week). A fixed mid-month day keeps it honest.
    await page.clock.setFixedTime(new Date('2026-09-16T09:00:00Z'));
    await seedMemberSession(page, 'G. Miller');
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
    // NO action: not leave, not a pay-marked day, and not worked with times ("Who’s on with me", 27 Nov
    // 2026). The row's own guard is about the day that has nothing to offer, so a payday or a worked
    // shift would prove the opposite of what the last block asks.
    const otherIdx = await page.evaluate(() => [...document.querySelectorAll('.calendar-day:not(.other-month)')]
        .findIndex(c => c.dataset.detailDay && c.dataset.detailShiftValue !== 'AL'
                        && !c.dataset.paydayIso && !c.dataset.cutoffIso && !c.dataset.detailWorkedTimes));
    expect(otherIdx, 'the fixture has no ordinary day left to check').toBeGreaterThan(-1);

    await page.locator('.calendar-day:not(.other-month)').nth(alIdx).click();
    const leave = page.locator('#dayDetailLeaveBtn');
    await expect(leave).toBeVisible();
    await expect(leave).toHaveText(/leave dates/i);
    // It must NAME its destination, and reach the list rather than the page it sits on — for the
    // YEAR of the day tapped, or leave in next January opens this year's list (whole-app review).
    const alYear = await page.locator('.calendar-day:not(.other-month)').nth(alIdx).getAttribute('data-detail-year');
    expect(alYear).toMatch(/^\d{4}$/);
    await expect(leave).toHaveAttribute('href', `admin.html?alYear=${alYear}#alBookedBox`);
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

// ─── A PERSONAL ACTION MUST BELONG TO SOMEBODY (v23.04) ─────────────────────────────────────────
//
// Reported by the owner, 6 Sep 2026. "Leave dates" opens Admin's record of YOUR leave and "Pay
// estimate" opens YOUR calculator, so on a colleague's calendar both silently change subject, and
// on a PIN-unlocked station PC neither has a subject at all.
//
// THE RULE IS UNIT-TESTED NEXT DOOR; THIS IS THE WIRING, which is the half that fails in practice —
// `personalActionsAllowed` is trivially right about every input it is HANDED, and the ways to get
// this wrong are not asking it, asking it once at init (the member selector changes under a page
// that is never reloaded), or handing it the session name as both arguments, which makes it
// tautologically true. Each of those leaves the unit suite green.

test('day detail: YOUR OWN pay-marked day still offers the pay estimate', async ({ page }) => {
    // THE DIRECTION THE GATE CAN BREAK SILENTLY, and until now the only one nothing watched. Every
    // other assertion on this button in this file expects it HIDDEN, so `personal` returning false
    // in the ordinary signed-in case — one wrong argument, one stale read of the member selector —
    // would take the pay route away from every member on every payday and leave the suite green.
    // Measured, not assumed: hardcoding the panel's pay branch to refuse passed all twelve
    // day-detail tests. A refusal test can only ever prove the gate CLOSES.
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();

    const payIdx = await page.evaluate(() => [...document.querySelectorAll('.calendar-day:not(.other-month)')]
        .findIndex(c => c.dataset.paydayIso || c.dataset.cutoffIso));
    expect(payIdx, 'the month has no pay-marked day to check').toBeGreaterThan(-1);
    await page.locator('.calendar-day:not(.other-month)').nth(payIdx).click();

    const pay = page.locator('#dayDetailPayBtn');
    await expect(pay).toBeVisible();
    // AND IT MUST ARRIVE. Visible is half the promise — the click closes the panel and calls
    // `navigateToPaycalc`, which is the same gate again and can refuse a second time with nothing
    // on screen to say so, so the button would simply shut the panel and do nothing.
    const target = await page.locator('.calendar-day:not(.other-month)').nth(payIdx)
        .evaluate(el => el.dataset.paydayIso || el.dataset.cutoffIso);
    expect(target, 'the cell carries no pay date to land on').toBeTruthy();
    await pay.click();
    await page.waitForURL(/paycalc\.html\?payday=\d{4}-\d{2}-\d{2}/);
});

test('day detail: a COLLEAGUE’s day offers neither personal action', async ({ page }) => {
    // Signed in as one member, looking at another — what the member selector is FOR, and the
    // reported case. The leave day is seeded against the member on SCREEN, so the panel has every
    // reason to offer the button except the one that matters.
    //
    // FULL `named` ACCESS FIRST, then the selection moved. The first cut seeded a bare session and
    // a different member, and PASSED — for the wrong reason: a session with no Firebase user leaves
    // the access type `none`, so the buttons were hidden by having no identity at all and the
    // colleague rule was never reached. Proven by mutation: comparing the session name with ITSELF
    // (a tautology that can never refuse) left that version green. A later `addInitScript` wins, so
    // this is a signed-in G. Miller genuinely looking at S. Silva.
    // PINNED TO SEPTEMBER 2026 (1 Oct 2026): this fixture is written against September's base roster and a weekday 4th,
    // and it read the real clock — it went red on 1 Oct, when the month on screen became October (the 4th a Sunday,
    // where leave is never shown, and G. Miller's 3rd–6th no longer a cover week). A fixed mid-month day keeps it honest.
    await page.clock.setFixedTime(new Date('2026-09-16T09:00:00Z'));
    await seedMemberSession(page, 'G. Miller');
    await page.addInitScript(() => localStorage.setItem('myb_roster_selected_member', 'S. Silva'));
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.docs = [];
        for (let m = 1; m <= 12; m++) {
            w.__E2E.docs.push({ id: 'al' + m, memberName: 'S. Silva',
                date: '2026-' + String(m).padStart(2, '0') + '-04',
                type: 'annual_leave', value: 'AL', note: '' });
        }
    });
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();

    const alIdx = await page.evaluate(() => [...document.querySelectorAll('.calendar-day:not(.other-month)')]
        .findIndex(c => c.dataset.detailShiftValue === 'AL'));
    expect(alIdx, 'the fixture no longer puts leave on the colleague’s month').toBeGreaterThan(-1);
    await page.locator('.calendar-day:not(.other-month)').nth(alIdx).click();
    // ABSENT, and absent MEANS hidden — `display: inline-flex` out-specifies the `hidden`
    // attribute, so a missing CSS rule renders a live button while every check believes it is gone.
    await expect(page.locator('#dayDetailLeaveBtn')).toBeHidden();
    await expect(page.locator('#dayDetailLeaveBtn')).toHaveCSS('display', 'none');
    await expect(page.locator('#dayDetailActions')).toHaveCSS('display', 'none');
    await page.locator('#dayDetailClose').click();

    // AND THE PAY BUTTON, which is gated on a pay-marked DATE and would otherwise be offered on a
    // day belonging to somebody else — the same defect reached by the other of the two routes.
    const payIdx = await page.evaluate(() => [...document.querySelectorAll('.calendar-day:not(.other-month)')]
        .findIndex(c => c.dataset.paydayIso || c.dataset.cutoffIso));
    expect(payIdx, 'the month has no pay-marked day to check').toBeGreaterThan(-1);
    await page.locator('.calendar-day:not(.other-month)').nth(payIdx).click();
    await expect(page.locator('#dayDetailPayBtn')).toBeHidden();
    // No PERSONAL action in the row. "Who’s on with <name>" may share it on a worked day: it is not
    // personal, and names the colleague whose shift it asks about (27 Nov 2026).
    await expect(page.locator('#dayDetailActions > :not([hidden]):not(#dayDetailTeamBtn)')).toHaveCount(0);
    const worked = await page.locator('.calendar-day:not(.other-month)').nth(payIdx).getAttribute('data-detail-worked-times');
    await expect(page.locator('#dayDetailActions')).toHaveCSS('display', worked ? 'flex' : 'none');
});

// ─── AND THE OTHER TWO ROUTES TO THE CALCULATOR (v23.07) ────────────────────────────────────────
//
// ─── THE PAY ROUTE, WHICH IS NOW ONE ROUTE ───────────────────────────────────────────────────────
//
// v23.04 gated the day panel's two buttons and left the routes AROUND the panel ungated: a desktop
// CLICK on a pay-marked cell and keyboard ENTER on one both called `navigateToPaycalc` directly, so
// the panel was tidy and a colleague's calendar — or a PIN-unlocked station PC — still jumped.
//
// v23.59 removed the first of those two. A click now opens the panel on every pointer type, so the
// only way a pointer reaches the calculator is `#dayDetailPayBtn`, which `personalActionsAllowed`
// already governs. These tests are therefore no longer about a desktop-only route and are no longer
// gated to one — they run wherever a click does, which is everywhere. What they still watch is the
// thing that has broken before: the button appearing, or not appearing, for the wrong person.
//
// ONE MUTATION IN THE KEYBOARD TEST PROVABLY CANNOT FAIL, and saying so is better than a test that
// pretends otherwise: making `navigateToPaycalc` return `true` after a REFUSAL is caught, but making
// it return `false` after a SUCCESSFUL jump changes nothing observable — `window.location` is
// already leaving the page, so the panel it would then open is torn down before it can be seen.

test('calendar: a click on a pay day opens the panel and offers no jump from a colleague’s month', async ({ page }) => {
    await seedMemberSession(page, 'G. Miller');
    await page.addInitScript(() => localStorage.setItem('myb_roster_selected_member', 'S. Silva'));
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();

    const payIdx = await page.evaluate(() => [...document.querySelectorAll('.calendar-day:not(.other-month)')]
        .findIndex(c => c.dataset.paydayIso || c.dataset.cutoffIso));
    expect(payIdx, 'the month has no pay-marked day to click').toBeGreaterThan(-1);
    await page.locator('.calendar-day:not(.other-month)').nth(payIdx).click();

    // The panel opens — the v23.59 behaviour, and the half a "does not navigate" assertion cannot
    // tell apart from a click that did nothing at all, which is what this used to be on desktop.
    await expect(page.locator('#dayDetailLightbox')).toBeVisible();
    await expect(page.locator('#dayDetailPayBtn'), 'a colleague’s pay day offers no jump').toBeHidden();
    // Asserted as the URL rather than "no navigation happened", because the failure this catches is
    // ARRIVING somewhere — paycalc would take it, show its own sign-in and look perfectly healthy,
    // which is the whole reason the jump was confusing rather than broken.
    expect(page.url(), 'a colleague’s pay day must not open YOUR calculator').not.toContain('paycalc');
});

test('calendar: a click on YOUR OWN pay day reaches the calculator through the panel', async ({ page }) => {
    // The other direction, and the one that would be silently lost by over-gating: the route has
    // worked since v10.17 and most members are looking at their own calendar every time. It is one
    // click deeper than it was on a desktop pointer, and it is the SAME depth a phone always had.
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();

    const payIdx = await page.evaluate(() => [...document.querySelectorAll('.calendar-day:not(.other-month)')]
        .findIndex(c => c.dataset.paydayIso || c.dataset.cutoffIso));
    expect(payIdx, 'the month has no pay-marked day to click').toBeGreaterThan(-1);
    await page.locator('.calendar-day:not(.other-month)').nth(payIdx).click();
    await expect(page.locator('#dayDetailLightbox')).toBeVisible();
    await page.locator('#dayDetailPayBtn').click();
    await page.waitForURL(/paycalc/, { timeout: 5000 });
    // `payday=` is the whole point of the route — the nav drawer's Pay pill already reaches the
    // calculator, but it cannot say WHICH period, so a jump that lost the date would look fine.
    expect(page.url()).toContain('payday=');
});

test('calendar: a refused Enter opens the day panel rather than doing nothing', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'Enter on a focused cell is the keyboard route');
    // THE DIRECTION A CARELESS FIX GETS WRONG, and the one route v23.59 deliberately left alone:
    // the keyboard still jumps straight to the calculator from a pay cell, because it has neither a
    // hover tooltip nor a visible button to aim at. Refusing the jump is right; refusing it and
    // returning would leave Enter dead on exactly those days. So the refusal has to HAND OVER.
    //
    // BOTH BRANCHES, SEPARATELY SELECTED, and that is not thoroughness for its own sake. The Enter
    // handler treats a PAYDAY and a CUT-OFF differently (a cut-off resolves to its own payday
    // first), so they are two code paths. The first cut of this test picked "the first pay-marked
    // day in the month" — which is the CUT-OFF, since it falls earlier in the period — so a
    // mutation that broke the payday branch outright sailed through it. Measured, not reasoned.
    await seedMemberSession(page, 'G. Miller');
    await page.addInitScript(() => localStorage.setItem('myb_roster_selected_member', 'S. Silva'));
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();

    for (const kind of ['paydayIso', 'cutoffIso']) {
        const idx = await page.evaluate((k) => [...document.querySelectorAll('.calendar-day:not(.other-month)')]
            .findIndex(c => c.dataset[k]), kind);
        expect(idx, `the month has no ${kind} day to focus`).toBeGreaterThan(-1);
        await page.locator('.calendar-day:not(.other-month)').nth(idx)
            .evaluate(el => /** @type {HTMLElement} */ (el).focus());
        await page.keyboard.press('Enter');
        await expect(page.locator('#dayDetailLightbox'), `${kind}: Enter must hand over to the panel`)
            .toBeVisible();
        expect(page.url(), `${kind}: and it must not have jumped`).not.toContain('paycalc');
        // …and the panel it opened carries no personal action either, on the same colleague's day.
        await expect(page.locator('#dayDetailPayBtn')).toBeHidden();
        await page.locator('#dayDetailClose').click();
        await expect(page.locator('#dayDetailLightbox')).toBeHidden();
    }
});

// ── EVERY WAY OUT OF A PANEL: ONE BACK RETURNS TO THE CALENDAR (lightbox review, 22 Nov 2026) ──────
// The New link notice's rule (above, 18 Nov 2026) for the leave panel's two links, the day panel's
// "Leave dates" and its Pay estimate. A plain link followed from inside an open panel stacked the next page
// on top of the panel's own history entry, which carries the Calendar's address: Back reloaded the Calendar
// on that entry, and the Back after it did nothing. The links now REPLACE the panel's entry
// (`followLinkOutOf`), and Pay estimate waits for the close's own Back before it jumps
// (`whenHistorySettled`). Playwright runs with the back/forward cache off, so Back always reloads here.
/**
 * From the page an exit opened: one Back lands on the Calendar on an entry no overlay holds, and the next
 * leaves it for the page the member came from.
 * @param {import('@playwright/test').Page} page @param {RegExp} landed
 */
async function oneBackReturnsToCalendar(page, landed) {
    await expect(page).toHaveURL(landed);
    await page.goBack();
    await expect(page).toHaveURL(/\/(index\.html)?$/);
    expect(await page.evaluate(() => history.state?.mybOverlay ?? null),
        'Back landed on the panel\'s own entry, whose next Back nothing answers').toBeNull();
    await page.goBack();
    await expect(page, 'one more Back leaves the Calendar').toHaveURL(/\/railcard-guide\.html$/);
}

for (const [label, sel, landed] of /** @type {const} */ ([
    ['Record leave', '#alLightboxContent .al-lb-link:not(#alLbViewLink)', /\/admin\.html#book-annual-leave$/],
    ['Leave dates', '#alLbViewLink', /\/admin\.html\?alYear=2026#alBookedBox$/],
])) {
    test(`calendar: the leave panel's "${label}" — one Back returns to the Calendar, and the next leaves it`, async ({ page }) => {
        const errors = collectFatalErrors(page);
        await page.clock.setFixedTime(new Date('2026-10-02T09:00:00Z'));
        await seedMemberSession(page, 'G. Miller');
        await page.goto('/railcard-guide.html');              // where the member came from
        await page.goto('/');
        await expect(page.locator('.calendar-day').first()).toBeVisible();
        await page.locator('#alBtn').click();
        await expect(page.locator(sel)).toBeVisible();
        await expect(page.locator(sel)).toHaveText(label);
        await page.locator(sel).click();
        await oneBackReturnsToCalendar(page, landed);
        expect(errors).toHaveLength(0);
    });
}

test('calendar: the day panel\'s "Leave dates" — one Back returns to the Calendar, and the next leaves it', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-09-16T09:00:00Z'));
    await seedMemberSession(page, 'G. Miller');
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.docs = [{ id: 'al9', memberName: 'G. Miller', date: '2026-09-04', type: 'annual_leave', value: 'AL', note: '' }];
    });
    await page.goto('/railcard-guide.html');
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    const alDay = page.locator('.calendar-day:not(.other-month)[data-detail-shift-value="AL"]').first();
    await expect(alDay, 'premise: the seeded leave day is drawn').toBeVisible();
    await alDay.click();
    await expect(page.locator('#dayDetailLeaveBtn')).toBeVisible();
    await page.locator('#dayDetailLeaveBtn').click();
    await oneBackReturnsToCalendar(page, /\/admin\.html\?alYear=2026#alBookedBox$/);
    expect(errors).toHaveLength(0);
});

test('calendar: the day panel\'s Pay estimate — one Back returns to the Calendar, and the next leaves it', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-10-02T09:00:00Z'));
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/railcard-guide.html');
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    const payDay = page.locator('.calendar-day:not(.other-month)[data-payday-iso]').first();
    await expect(payDay, 'premise: the month has a payday').toBeVisible();
    await payDay.click();
    await expect(page.locator('#dayDetailPayBtn')).toBeVisible();
    await page.locator('#dayDetailPayBtn').click();
    await oneBackReturnsToCalendar(page, /\/paycalc\.html\?payday=\d{4}-\d{2}-\d{2}$/);
    expect(errors).toHaveLength(0);
});

// ── A TALL PANEL ON A PHONE ON ITS SIDE (7 Nov 2026, iPhone audit) ──────────────────────────────
//
// The day panel and the leave panel had no height cap, and `.lb-content` scrolls only once
// something caps it. The overlay centres its panel, so on a phone in landscape — 375 to 402px of
// height — a tall panel ran off the top and the bottom together, the ✕ that closes it with it.
// MEASURED, because every element is present and readable either way: nothing behavioural fails,
// and the visual baselines are portrait.
//
// Each case is one that CAN fail. The leave panel with a Christmas line (measured 426px of content)
// is taller than either screen at the default text size. The tallest day panel at the default size
// is Christmas Day's, and at 318px it FITS a 375px screen — so it is also read under 1.3× text, the
// way an Android phone set to large text draws it, where it does not. And the cap brought its own
// failure, which is why "nothing squashed" is asserted beside "on screen": a capped flex column
// shrinks a child whose flex minimum is zero before it scrolls, and the leave panel's figures were
// cut to a 13px strip with the panel still not scrolling.
for (const [width, height] of [[667, 375], [874, 402]]) {
    test(`day detail and the leave panel fit a phone held sideways, ✕ and all, at ${width}×${height}`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.clock.setFixedTime(new Date('2026-12-10T09:00:00Z'));
        await seedMemberSession(page, 'G. Miller');
        await page.addInitScript(() => {
            const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
            // A worked Boxing Day, so the leave panel carries its lieu-day breakdown as well.
            w.__E2E.docs = [{ id: 'bx', memberName: 'G. Miller', date: '2026-12-26', type: 'rdw',
                value: '13:30-21:00', note: '', source: 'manual' }];
        });
        await page.goto('/');
        await expect(page.locator('.calendar-day').first()).toBeVisible();

        /** Every used font size in a panel × k, read before any is written so none compounds.
         *  @param {string} sel @param {number} k */
        const scaleTextIn = (sel, k) => page.evaluate(([s, mult]) => {
            const els = /** @type {HTMLElement[]} */ ([...document.querySelectorAll(`${s}, ${s} *`)]);
            const px = els.map(e => parseFloat(getComputedStyle(e).fontSize));
            els.forEach((e, i) => { if (px[i]) e.style.fontSize = `${px[i] * Number(mult)}px`; });
        }, [sel, String(k)]);

        /** The panel and its ✕ are on screen, no zone is squashed, and its last row scrolls into view.
         *  @param {string} panel @param {string} close @param {string} what */
        const fitsTheScreen = async (panel, close, what) => {
            const g = await page.evaluate(([p, c]) => {
                const el = /** @type {HTMLElement} */ (document.querySelector(p));
                const zones = [...el.children].filter(k => {
                    const cs = getComputedStyle(k);
                    return cs.display !== 'none' && cs.position !== 'absolute';   // the ✕ is out of flow
                });
                const box = (/** @type {Element} */ e) => e.getBoundingClientRect();
                // SQUASHED = shorter under the cap than without it. Not scrollHeight against
                // clientHeight: a glyph that hangs below its line overflows its zone by a pixel or two
                // at any height, and that is not the cap's doing.
                const capped = zones.map(z => box(z).height);
                el.style.maxHeight = 'none';
                const free = zones.map(z => box(z).height);
                el.style.maxHeight = '';
                const out = { panel: box(el), close: box(/** @type {Element} */ (document.querySelector(c))), vh: innerHeight,
                    squashed: zones.filter((z, i) => capped[i] < free[i] - 0.5).map(z => `${z.id || z.className} ${capped[zones.indexOf(z)]}/${free[zones.indexOf(z)]}px`),
                    lastBottom: 0, panelBottom: 0 };
                el.scrollTop = el.scrollHeight;               // as far down as the member can scroll it
                out.lastBottom = box(zones[zones.length - 1]).bottom;
                out.panelBottom = box(el).bottom;
                el.scrollTop = 0;
                return out;
            }, [panel, close]);
            expect(g.panel.top, `${what}: the top of the panel is above the screen`).toBeGreaterThanOrEqual(0);
            expect(g.panel.bottom, `${what}: the bottom of the panel is below the screen`).toBeLessThanOrEqual(g.vh);
            expect(g.close.top, `${what}: the ✕ is off the top of the screen`).toBeGreaterThanOrEqual(0);
            expect(g.close.bottom, `${what}: the ✕ is off the screen`).toBeLessThanOrEqual(g.vh);
            expect(g.squashed, `${what}: squashed to fit instead of scrolling`).toEqual([]);
            expect(g.lastBottom, `${what}: the last row cannot be scrolled into view`).toBeLessThanOrEqual(g.panelBottom + 1);
        };

        // ── The day panel: Christmas Day, due at work, so leave never counted ──
        const christmas = page.locator('.calendar-day:not(.other-month)[data-detail-day="Friday 25 December 2026"]');
        const dayPanel = page.locator('#dayDetailContent');
        await christmas.click();
        await expect(page.locator('#dayDetailChristmas')).toBeVisible();
        await expect(dayPanel).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
        await fitsTheScreen('#dayDetailContent', '#dayDetailClose', 'the day panel');
        await scaleTextIn('#dayDetailContent', 1.3);
        await fitsTheScreen('#dayDetailContent', '#dayDetailClose', 'the day panel under 1.3× text');
        await page.locator('#dayDetailClose').click();
        await expect(page.locator('#dayDetailLightbox')).not.toHaveClass(/open/);

        // ── The leave panel, carrying the Christmas line ──
        await page.locator('#alBtn').click();
        await expect(page.locator('#alLbChristmas')).toBeVisible();
        await expect(page.locator('#alLightboxContent')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
        await fitsTheScreen('#alLightboxContent', '#alLightboxClose', 'the leave panel');
        // And the ✕ closes it — reachable is the point.
        await page.locator('#alLightboxClose').click();
        await expect(page.locator('#alLightbox')).not.toHaveClass(/open/);
    });
}
