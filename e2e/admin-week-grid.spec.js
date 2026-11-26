/**
 * admin-week-grid.spec.js — Admin (admin.html): the week grid — its time boxes, the Sunday and
 * Christmas rules, the bulk bar, its columns, the swipe and the week jump.
 *
 * Split by feature out of admin.spec.js on 25 Nov 2026, test for test and unchanged; what more than
 * one admin-*.spec.js file needs is in admin-helpers.js. admin.spec.js had itself been split out of
 * pages.spec.js on 3 Nov 2026; the tests that span pages, and the shared drawer, dialogs and sheets,
 * stay there.
 */
import { test, expect } from './fixtures.js';
import AxeBuilder from '@axe-core/playwright';
import { seedSession, clickInView } from './helpers.js';
import { SUNDAY_FORBIDDEN_TYPES, isRestShift } from '../override-utils.js';
import { teamMembers, getBaseShift, parseISODate, CONFIG } from '../roster-data.js';
import { formatDisplay } from '../admin-period-dates.js';
import { inventedCea, serveInventedMember, openAdminOnDecember } from './admin-helpers.js';

// ── THE WEEK GRID'S TIME BOXES, TYPED (admin-time-inputs.js, v24.64) ──────────────────────────
// Nothing drove these before: the formatting, the focus move and the blur check were wired in the
// editor and no spec typed into them. The keypad an iPhone shows for `inputmode="numeric"` has no
// colon, so if the formatter stops running a time cannot be entered from a phone at all.
test('admin: a week-grid time box formats as typed, moves on, and flags an impossible time', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-08-27T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    const row = page.locator('.day-row').filter({ has: page.locator('.type-pill-btn[data-type="shift"]:not([disabled])') }).first();
    await clickInView(row.locator('.type-pill-btn[data-type="shift"]'));
    const start = row.locator('.day-start');
    const end = row.locator('.day-end');
    await start.fill('');
    await start.pressSequentially('630');
    await expect(start, 'three digits whose first pair is not an hour read as a dropped zero').toHaveValue('06:30');
    await expect(end, 'a complete start moves on to the end').toBeFocused();
    await end.fill('');   // prefilled with the rostered finish, and the box holds five characters
    await end.pressSequentially('1975');
    await expect(end).toHaveValue('19:75');
    await start.focus();   // leave the box — the HH:MM check runs on blur
    await expect(end).toHaveClass(/\binput-error\b/);
    await expect(end).toHaveAttribute('aria-invalid', 'true');
    await end.fill('');
    await end.pressSequentially('1400');
    await expect(end).toHaveValue('14:00');
    await expect(end, 'typing again clears the error').not.toHaveAttribute('aria-invalid', 'true');
    // A MIDNIGHT FINISH TYPED AS 2400 (whole-app review, Oct 2026). The box reshaped "240" into
    // 02:40 — five characters, a full box — so the last 0 was never typed and 02:40 was saved. Typed
    // key by key, it now reads 24:00 and is refused; three digits are a dropped zero only once the
    // box is left.
    await end.fill('');
    await end.pressSequentially('2400');
    await expect(end).toHaveValue('24:00');
    await start.focus();
    await expect(end, 'midnight is written 00:00; 24:00 is refused, never saved as something else').toHaveClass(/\binput-error\b/);
    await end.fill('');
    await end.pressSequentially('240');
    await expect(end, 'still typing: it may yet be 2400').toHaveValue('24:0');
    await start.focus();
    await expect(end, 'left as three digits, it is a dropped zero').toHaveValue('02:40');
    await expect(end).not.toHaveClass(/\binput-error\b/);
    // AN EDIT IS NOT A NEW TIME TYPED SHORT (external review of v26.79): 22:30 with its last digit
    // deleted was settled as 02:23 when the box was left — a valid time, so it saved.
    await end.fill('');
    await end.pressSequentially('2230');
    await expect(end).toHaveValue('22:30');
    await end.press('Backspace');
    await expect(end).toHaveValue('22:3');
    await start.focus();
    await expect(end, 'what is left of 22:30 stays as it is').toHaveValue('22:3');
    await expect(end, 'and is refused like any unfinished time').toHaveClass(/\binput-error\b/);
    // Delete at the FRONT leaves what LOOKS like a whole time (external review of v26.87): the Links window took "2:30"
    // as 02:30. Every time box reads a box that is left one way (`readClockBox`, clock-input.js), so here as there it is
    // unfinished, and refused.
    await end.fill('22:30');
    await end.click();
    await end.press('Home');
    await end.press('Delete');
    await expect(end).toHaveValue('2:30');
    await start.focus();
    await expect(end, 'what is left of 22:30 is not 02:30').toHaveValue('2:30');
    await expect(end).toHaveClass(/\binput-error\b/);
});

// ── EVERY WAY OF EDITING ONE TIME (edit-sequence tests, 25 Nov 2026) ─────────────────────────────
// The 22:30 → 02:23 regression passed every test, because every test typed a time into an EMPTY box. An
// edit is a different sequence of input events — a deletion, an insertion into a full box, a selection
// replaced — and each must end as the time meant, or as an unfinished time the box refuses. Never as a
// different, valid time. Driven by real key presses, because the rule reads which kind of input it was.
test('admin: editing a week-grid time ends as the time meant or as unfinished — never as another time', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-08-27T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    const row = page.locator('.day-row').filter({ has: page.locator('.type-pill-btn[data-type="shift"]:not([disabled])') }).first();
    await clickInView(row.locator('.type-pill-btn[data-type="shift"]'));
    const start = row.locator('.day-start');
    const end = row.locator('.day-end');
    /** Put 22:30 in the finish box, typed, and leave the caret at its end. */
    const fresh = async () => { await end.fill(''); await end.pressSequentially('2230'); await expect(end).toHaveValue('22:30'); };
    const leave = () => start.focus();

    // A digit typed into a full box goes nowhere: the box holds five characters.
    await fresh();
    await end.press('End');
    await end.press('5');
    await leave();
    await expect(end, 'a key pressed in a full box changes nothing').toHaveValue('22:30');

    // A digit deleted from the MIDDLE leaves what is left of 22:30, which is no time.
    await fresh();
    await end.press('Home');
    await end.press('ArrowRight');
    await end.press('Backspace');
    await expect(end, 'the box keeps what is there: the colon does not move').toHaveValue('2:30');
    await leave();
    await expect(end, 'never read as a time with a zero dropped').toHaveValue('2:30');
    await expect(end).toHaveClass(/\binput-error\b/);

    // …and the digit typed in its place lands there (24-hour review, 25 Nov 2026): re-split as "23:0", the
    // caret jumped to the end and a 1 meant for 12:30 made 23:01, a valid time.
    await end.focus();
    await end.press('Home');
    await end.press('1');
    await leave();
    await expect(end, 'the edit finished where it was typed').toHaveValue('12:30');
    await expect(end).not.toHaveClass(/\binput-error\b/);

    // Typing over PART of the time is an edit too: the 30 selected and a 4 typed is what is left of 22:30,
    // never 02:24.
    await fresh();
    await end.press('End');
    await end.press('Shift+ArrowLeft');
    await end.press('Shift+ArrowLeft');
    await end.press('4');
    await leave();
    await expect(end, 'never 02:24').toHaveValue('22:4');
    await expect(end).toHaveClass(/\binput-error\b/);

    // The colon deleted: the same four digits, so the same time.
    await fresh();
    await end.press('Home');
    for (let i = 0; i < 3; i++) await end.press('ArrowRight');
    await end.press('Backspace');
    await leave();
    await expect(end, 'the colon is put back; the time is the same').toHaveValue('22:30');
    await expect(end).not.toHaveClass(/\binput-error\b/);

    // One digit selected and typed over: the time meant.
    await fresh();
    await end.press('End');
    await end.press('Shift+ArrowLeft');
    await end.press('5');
    await leave();
    await expect(end).toHaveValue('22:35');
    await expect(end).not.toHaveClass(/\binput-error\b/);

    // The last digit deleted and another typed: still the time meant.
    await fresh();
    await end.press('Backspace');
    await end.press('5');
    await leave();
    await expect(end).toHaveValue('22:35');

    // Everything selected and a new time typed short: a new time, so the shortcut applies.
    await fresh();
    await end.selectText();
    await end.pressSequentially('130');
    await leave();
    await expect(end, 'a new time typed short takes its zero').toHaveValue('01:30');
    await expect(end).not.toHaveClass(/\binput-error\b/);
});

// ── "APPLY TO TICKED DAYS" IS ONLY THE DAYS TICKED (owner, 10 Nov 2026) ─────────────────────────────
// A day already holding a saved change opened TICKED, so Apply re-typed it unasked — and the one way to
// leave it out, unticking, staged its deletion. A tick is now only ever the manager's own, and an untick
// never removes anything: a saved day goes back to what is saved.
test('admin: Apply changes only the days ticked — a saved day is left alone, and an untick never deletes it', async ({ page }) => {
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window);
        w.__E2E = { ...(w.__E2E || {}), docs: [{ id: 'ri-wed', memberName: 'G. Miller', date: '2026-12-09',
            type: 'shift', value: '10:00-18:00', note: '', source: 'roster_import' }] };
    });
    await openAdminOnDecember(page);
    const row  = (/** @type {string} */ d) => page.locator(`.day-row[data-date="${d}"]`);
    const box  = (/** @type {string} */ d) => row(d).locator('.day-cb');
    const pill = (/** @type {string} */ d, /** @type {string} */ t) => row(d).locator(`.type-pill-btn[data-type="${t}"]`);
    const badge = row('2026-12-09').locator('.overwrite-badge');
    await expect(pill('2026-12-09', 'shift'), 'premise: Wednesday shows its saved shift').toHaveAttribute('aria-pressed', 'true');
    await expect(box('2026-12-09'), 'a saved day is not a ticked day').not.toBeChecked();
    await expect(page.locator('#bulkSelCount')).toHaveText('');
    await box('2026-12-10').click();
    await box('2026-12-11').click();
    await expect(page.locator('#bulkSelCount')).toHaveText('2 days selected');
    await page.locator('#bulkTypePills .pill-annual_leave').click();
    await page.locator('#bulkApplyBtn').click();
    await expect(pill('2026-12-10', 'annual_leave')).toHaveAttribute('aria-pressed', 'true');
    await expect(pill('2026-12-11', 'annual_leave')).toHaveAttribute('aria-pressed', 'true');
    await expect(pill('2026-12-09', 'shift'), 'Wednesday keeps its shift').toHaveAttribute('aria-pressed', 'true');
    await expect(badge).toContainText('Saved');

    // Ticked on purpose it counts; unticked again it is only unticked.
    await box('2026-12-09').click();
    await expect(page.locator('#bulkSelCount')).toHaveText('3 days selected');
    await box('2026-12-09').click();
    await expect(badge, 'an untick is not a removal').toContainText('Saved');
    await expect(pill('2026-12-09', 'shift')).toHaveAttribute('aria-pressed', 'true');
    // An edit unticked goes back to what is saved, not to a removal.
    await pill('2026-12-09', 'rdw').click();
    await expect(badge).toContainText('Updating');
    await box('2026-12-09').click();
    await expect(badge).toContainText('Saved');
    await expect(pill('2026-12-09', 'shift')).toHaveAttribute('aria-pressed', 'true');

    await page.locator('#saveBtn').click();
    await expect(page.locator('#formFeedback')).toContainText('2 changes saved for G. Miller', { timeout: 10000 });
    const written = await page.evaluate(() => /** @type {any} */ (window).__E2E.batchWrites.map((/** @type {any} */ w) => `${w.date} ${w.type}`));
    expect(written, 'only the two days ticked').toEqual(['2026-12-10 annual_leave', '2026-12-11 annual_leave']);
    expect(await page.evaluate(() => /** @type {any} */ (window).__E2E.batchDeletes || []), 'and nothing deleted').toEqual([]);
});

// ── SUNDAY IS NOT A CONTRACTED DAY — LAYERS 1 AND 2, AS THE GRID ACTUALLY DRAWS THEM ────────────
//
// CLAUDE.md's Sunday rule has seven enforcement layers and says none of them is removable alone. Two
// of them live in `admin-week-editor.js` — the per-row pills a manager presses, and the bulk sweep
// that stages a whole week at once — and until now neither had a behavioural test in any lane. A
// mutation sweep replaced each guard's condition with `false` and everything stayed green.
//
// What already existed is a SOURCE pin (override-utils.test.mjs, "LAYER 1 disables a pill for every
// forbidden type"), which asserts the layer mentions a `.pill-<type>` for each forbidden type. That
// is real coverage of DRIFT — a fifth forbidden type not wired into the grid — and no coverage at
// all of the guard: the strings sit INSIDE the `if`, so they survive its condition being deleted.
// Only a rendered row can answer whether the pill is actually dead.
//
// NEITHER FAILURE IS LOUD, AND NEITHER LOSES THE SUNDAY. A staged Sunday row reaches the `#saveBtn`
// handler in admin-app.js — layer 6, which still answers for every forbidden type, so nothing wrong
// is written. (`executeSave` in admin-overrides.js, the writer underneath it, has no Sunday guard
// and does not need one; it never sees the row.) But layer 6 answers by pushing an error, and the
// save aborts the WHOLE batch on the first one. Measured with layer 2 removed: a seven-day AL sweep
// wrote NOTHING — zero batch writes, one row flagged, six legitimate days lost with it. So what a
// missing layer costs is never the Sunday; it is the rest of the week, and it arrives as a dead end
// at the end instead of a closed door at the start.
//
// Both read the list from override-utils.js rather than restating it (CLAUDE.md forbids a new call
// site restating the four types), so a fifth forbidden type joins these tests by being declared.

/** The dates of the rendered week, keyed by weekday. The grid always runs Sunday→Saturday, but the
 *  assertions name the day rather than an index so a failure says which day it meant. */
async function weekGridDates(page) {
    return page.evaluate(() => Object.fromEntries([
        ...[...document.querySelectorAll('.day-row')].map(r => {
            const iso = /** @type {HTMLElement} */ (r).dataset.date || '';
            return [['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(iso + 'T12:00:00').getDay()], iso];
        }),
        ['member', /** @type {HTMLSelectElement} */ (document.getElementById('fieldMember')).value],   // whose week it is
    ]));
}

test('admin: the Sunday row offers no pill for anything that cannot be recorded on a Sunday', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });

    const days = await weekGridDates(page);
    expect(days.sun, 'the week grid always draws a Sunday').toBeTruthy();
    const sunday  = page.locator(`.day-row[data-date="${days.sun}"]`);
    const weekday = page.locator(`.day-row[data-date="${days.wed}"]`);

    for (const type of SUNDAY_FORBIDDEN_TYPES) {
        // `other` is the one forbidden TYPE whose pill stays: the Other pill is also the door to Spare,
        // its own type, which a Sunday takes (owner, Nov 2026). Its Other-day chips are what is refused — below.
        if (type === 'other') continue;
        await expect(sunday.locator(`.pill-${type}`), `${type} must not be pressable on a Sunday`)
            .toBeDisabled();
        // A disabled button leaves the tab order, so the reason has to be in the accessible name —
        // it used to be a `title`, which no phone shows (v23.50). Asserted alongside the state it
        // explains: a grey pill nobody can ask about is the same dead end from the other side.
        await expect(sunday.locator(`.pill-${type}`)).toHaveAttribute('aria-label', /Sunday/);
        // The SAME pill on a weekday is live — so this is the Sunday rule biting, not a row that
        // failed to render or a member whose overrides never loaded.
        await expect(weekday.locator(`.pill-${type}`), `${type} is recordable on a weekday`).toBeEnabled();
    }
    // And the one thing that DOES belong on a Sunday is still offered. Sundays are uncontracted, so
    // Sunday work is overtime; a row where every pill were dead would pass the loop above while
    // making a genuinely payable shift unrecordable.
    await expect(sunday.locator('.pill-rdw')).toBeEnabled();
    // OTHER OFFERS SPARE ALONE ON A SUNDAY (admin-day-pills.js): every Other-day chip is dead and says
    // why, and Spare — the only choice — is pressed the moment Other is.
    await expect(sunday.locator('.pill-other')).toHaveAttribute('aria-label', 'Other — only Spare on Sundays');
    await sunday.locator('.day-cb').check();
    await sunday.locator('.pill-other').click();
    await expect(sunday.locator('.other-flavour-btn[data-flavour="SPARE"]')).toHaveAttribute('aria-pressed', 'true');
    const dead = sunday.locator('.other-flavour-btn:not([data-flavour="SPARE"])');
    expect(await dead.count(), 'every Other-day chip is drawn').toBeGreaterThan(0);
    for (const chip of await dead.all()) {
        await expect(chip).toBeDisabled();
        await expect(chip).toHaveAttribute('aria-label', /unavailable on Sundays$/);
    }
    await expect(sunday.locator('.sunday-note')).toContainText('but a Spare turn can');
});

test('admin: a bulk sweep of all seven days stages six — the Sunday is dropped, and it says so', async ({ page }) => {
    await seedSession(page, 'G. Miller');

    // Every forbidden type the bulk bar actually offers. `other` is applied per-row (it needs a
    // flavour the bar cannot host), so the bar is PILL_TYPES minus that one — read off the rendered
    // bar rather than listed here, for the same reason the loop below is.
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    const offered = await page.evaluate(types => types.filter(t => document.querySelector(`#bulkTypePills .pill-${t}`)),
        [...SUNDAY_FORBIDDEN_TYPES]);
    expect(offered.length, 'the bulk bar must offer at least one forbidden type, or this proves nothing')
        .toBeGreaterThan(0);

    for (const type of offered) {
        await page.goto('/admin.html');
        await page.waitForSelector('.day-row', { timeout: 10000 });
        const days = await weekGridDates(page);

        await page.locator('#bulkSelAll').click();
        await page.locator(`#bulkTypePills .pill-${type}`).click();
        await page.locator('#bulkApplyBtn').click();

        const staged = await page.evaluate(() => Object.fromEntries(
            [...document.querySelectorAll('.day-row')].map(r => {
                const el = /** @type {HTMLElement} */ (r);
                return [el.dataset.date, el.dataset.type || ''];
            })));
        expect(staged[days.sun], `${type} must not stage on a Sunday`).toBe('');
        // The other six DID take it — the sweep is being filtered, not broken. Without this, a
        // guard that skipped every row would pass the line above. Absent also leaves a REST day alone
        // (owner, 10 Nov 2026 — its own test below), so for Absent the six are the working ones.
        const who = teamMembers.find(m => m.name === days.member);
        for (const key of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat']) {
            const restLeft = type === 'sick' && isRestShift(getBaseShift(who, parseISODate(days[key])));
            expect(staged[days[key]], restLeft ? `${key} is a rest day, which Absent leaves alone`
                : `${key} is a contracted day and must take ${type}`).toBe(restLeft ? '' : type);
        }
        // "All 7 → 6 applied" is a surprise unless it is stated. This is the only place the manager
        // is told, and it is what stops the drop reading as a lost tap.
        await expect(page.locator('#formFeedback')).toContainText('Sunday skipped');
        // Each visit leaves the page CLEAN (iPhone audit, Nov 2026). Rows left staged when a page goes
        // are kept and offered back on the next load (unsaved-draft.js) — the next visit would open on
        // that question, which is not what this loop is about.
        await page.locator('#stagedDiscardBtn').click();
        await expect(page.locator('#saveBtn')).toBeDisabled();
        await expect(page.locator('#weekNavLabel'), 'the bar went from under the keyboard, which goes to the week').toBeFocused();
    }
});

// ── EACH TYPE PILL SAYS ITS FULL NAME, AND KEEPS ITS SHORT LABEL (review, Nov 2026) ───────────────────
// "RDW" was named by its letters alone, on both pill rows, and "Rest Day Working" was only in the ? tips. The
// labels stay short (AL stays AL, .claude/rules/admin.md); the name says the rest, leading with the label, so
// a voice user still says what they see — checked by axe's own containment rule (WCAG 2.5.3).
test('admin: the type pills say their full names to a screen reader, on the week grid and the bulk bar', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-10T09:00:00Z'));
    await seedSession(page);
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    const day = page.locator('.week-panel .day-row:has(.pill-annual_leave:not([disabled]))').first();
    await clickInView(day.locator('.day-cb'));   // a day's pills show once it is ticked
    for (const [where, scope] of /** @type {const} */ ([['the bulk bar', page.locator('#bulkTypePills')], ['a day of the week grid', day]])) {
        await expect(scope.locator('.pill-rdw'), `${where}: the label stays RDW`).toHaveText('RDW');
        await expect(scope.locator('.pill-rdw'), where).toHaveAccessibleName('RDW, Rest Day Working');
        await expect(scope.locator('.pill-annual_leave'), `${where}: AL stays AL`).toHaveText('AL');
        await expect(scope.locator('.pill-annual_leave'), where).toHaveAccessibleName('AL, Annual Leave');
        await expect(scope.locator('.pill-correction'), where).toHaveAccessibleName('Set as Rest Day');
        await expect(scope.locator('.pill-sick'), where).toHaveAccessibleName('Absent');
    }
    const mismatches = (await new AxeBuilder({ page }).include('#bulkTypePills').include('.week-panel .col-pills')
        .withRules(['label-content-name-mismatch']).analyze()).violations.flatMap(v => v.nodes.map(n => n.target.join(' ')));
    expect(mismatches, 'every pill\'s name holds the words it shows').toEqual([]);
});

// ── A BULK ABSENT LEAVES A REST DAY ALONE, AND NAMES IT (owner, 10 Nov 2026: "Skip rest days") ──────
// The Absence card and the roster import record no absence on a rest day. The bulk bar did — and the
// Calendar then hid it, while Admin's Recorded Absence dates listed and counted it.
test('admin: All 7 → Absent → Apply stages only the working days, and names the rest days it left alone', async ({ page }) => {
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true }; });
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('G. Miller');
    await page.locator('#fieldDate').evaluate((el) => {
        /** @type {HTMLInputElement} */ (el).value = '2027-01-11';
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#weekNavLabel')).toContainText('Jan 2027');
    for (const d of ['2027-01-13', '2027-01-14']) {
        await expect(page.locator(`.day-row[data-date="${d}"]`), `premise: ${d} is a rest day on this line`).toHaveAttribute('data-base-is-rd', '1');
        await page.locator(`.day-row[data-date="${d}"] .day-cb`).click();
    }
    await page.locator('#bulkTypePills .pill-sick').click();
    await expect(page.locator('#bulkApplyBtn'), 'only rest days ticked: nothing Absent could go on').toBeDisabled();
    await expect(page.locator('#bulkApplyHint')).toHaveText('An absence isn’t recorded on a rest day — tick a working day');
    await page.locator('#bulkSelAll').click();
    await page.locator('#bulkApplyBtn').click();
    const staged = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.day-row')]
        .map(r => [/** @type {HTMLElement} */ (r).dataset.date, /** @type {HTMLElement} */ (r).dataset.type || ''])));
    expect(staged).toEqual({ '2027-01-10': '', '2027-01-11': 'sick', '2027-01-12': 'sick', '2027-01-13': '',
        '2027-01-14': '', '2027-01-15': 'sick', '2027-01-16': 'sick' });
    await expect(page.locator('#formFeedback')).toContainText('Set 4 days — Sunday skipped (not a contracted day); '
        + '13 January 2027 and 14 January 2027 skipped: rest days on the base roster, so nothing is recorded.');
    // STAGED, NOT SAVED (whole-app check, Nov 2026): never the save's own toast, which covered the Unsaved bar.
    expect(await page.locator('#saveToast').getAttribute('class') ?? '', 'read at once: a toast fades by itself').not.toMatch(/\bvisible\b/);
    await expect(page.locator('#stagedBar')).toBeVisible();
    await page.locator('#saveBtn').click();
    await expect(page.locator('#formFeedback')).toContainText('4 changes saved for G. Miller', { timeout: 10000 });
    const written = await page.evaluate(() => /** @type {any} */ (window).__E2E.batchWrites.map((/** @type {any} */ w) => `${w.date} ${w.type}`));
    expect(written).toEqual(['2027-01-11 sick', '2027-01-12 sick', '2027-01-15 sick', '2027-01-16 sick']);
});

// …AND A WORKING DAY A SAVED CHANGE SET AS A REST DAY IS NOT CALLED "A REST DAY ON THE BASE ROSTER" (review,
// Nov 2026). Absent leaves it alone, rightly — it is a rest day now — but the line named the wrong reason.
test('admin: bulk Absent names a day a saved change set as a rest day for what it is', async ({ page }) => {
    // An invented member, and the first of their working weekdays from 11 Jan 2027.
    const who = inventedCea();
    await serveInventedMember(page, who);
    const iso = (/** @type {Date} */ d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let day = '';
    for (const d = new Date(2027, 0, 11, 12); !day; d.setDate(d.getDate() + 1)) {
        if (d.getDay() !== 0 && !isRestShift(getBaseShift(who, d))) day = iso(d);
    }
    await page.addInitScript((rows) => { /** @type {any} */ (window).__E2E = { ...(/** @type {any} */ (window).__E2E || {}), authUser: true, docs: rows }; },
        [{ id: 'set-rest', memberName: who.name, date: day, type: 'correction', value: 'RD', note: '', source: 'manual' }]);
    await seedSession(page);
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption(who.name);
    await page.locator('#fieldDate').evaluate((el, d) => {
        /** @type {HTMLInputElement} */ (el).value = d;
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }, day);
    await expect(page.locator(`.week-panel .day-row[data-date="${day}"]`), 'premise: the saved Rest Day is drawn on its row').toHaveClass(/has-override/);
    await page.locator('#bulkSelAll').click();
    await page.locator('#bulkTypePills .pill-sick').click();
    await page.locator('#bulkApplyBtn').click();
    await expect(page.locator('#formFeedback')).toContainText(`${formatDisplay(day)} skipped: set as a rest day by a saved change, so nothing is recorded`);
    await expect(page.locator('#formFeedback')).not.toContainText(`${formatDisplay(day)} skipped: a rest day on the base roster`);
});

// "WORKING DAYS" IS THE WORKING DAYS THE CARDS WRITE BY (whole-app check, Nov 2026). The button read a
// rest day the member had been swapped onto as a rest day, while `isWorkingDate` — the Annual Leave
// card's rule — calls it worked: Working days → AL left the swapped-in day out, the card charged it.
test('admin: Working days ticks a rest day with a swapped-in shift, and leaves a plain rest day and Sunday', async ({ page }) => {
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window);
        w.__E2E = { ...(w.__E2E || {}), docs: [{ id: 'swap-wed', memberName: 'G. Miller', date: '2027-01-13',
            type: 'shift', value: '09:00-17:00', note: '', source: 'manual' }] };
    });
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('G. Miller');
    await page.locator('#fieldDate').evaluate((el) => {
        /** @type {HTMLInputElement} */ (el).value = '2027-01-11';
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('.day-row[data-date="2027-01-13"] .type-pill-btn[data-type="shift"]'),
        'premise: the swap is on record').toHaveAttribute('aria-pressed', 'true');
    await page.locator('#bulkSelWorking').click();
    const ticked = await page.evaluate(() => [...document.querySelectorAll('.day-row')]
        .filter(r => /** @type {HTMLInputElement} */ (r.querySelector('.day-cb')).checked).map(r => /** @type {HTMLElement} */ (r).dataset.date));
    // Wed 13 is a base rest day worked by swap; Thu 14 a plain rest day; Sun 10 never.
    expect(ticked).toEqual(['2027-01-11', '2027-01-12', '2027-01-13', '2027-01-15', '2027-01-16']);
});

/** Admin on `member`'s week holding `iso`, signed in as G. Miller with a working Firebase user.
 *  @param {import('@playwright/test').Page} page @param {string} member @param {string} iso */
async function adminOnWeek(page, member, iso) {
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true }; });
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption(member);
    await page.locator('#fieldDate').evaluate((el, d) => {
        /** @type {HTMLInputElement} */ (el).value = d;
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }, iso);
    await expect(page.locator(`.day-row[data-date="${iso}"]`)).toBeVisible();
}

// BOXING DAY IS NEVER AN OTHER DAY (owner, Jul 2026 — CLAUDE.md, Shift types), refused the way a Sunday's
// is: at the pill, with the reason in the row, and at Save for a row that reaches it another way.
test('admin: Boxing Day takes no Other day — the chips say why, and Save refuses one', async ({ page }) => {
    await adminOnWeek(page, 'G. Miller', '2026-12-21');
    const boxing = page.locator('.day-row[data-date="2026-12-26"]');
    await boxing.locator('.day-cb').click();
    // No Spare turn either (owner, 19 Nov 2026), so nothing is left under Other and the pill is off.
    await expect(boxing.locator('.type-pill-btn[data-type="other"]')).toBeDisabled();
    await expect(boxing.locator('.type-pill-btn[data-type="other"]')).toHaveAttribute('aria-label', 'Other — unavailable on Boxing Day: no Other day or Spare turn');
    await expect(boxing.locator('.col-pills')).toContainText('Boxing Day can’t be an Other day — training, meetings and the rest — or a Spare turn');
    await expect(boxing.locator('.type-pill-btn[data-type="rdw"]'), 'work on Boxing Day is still recordable').toBeEnabled();
    const thu = page.locator('.day-row[data-date="2026-12-24"]');   // a working day, so the save has a batch
    await thu.locator('.day-cb').click();
    await thu.locator('.type-pill-btn[data-type="annual_leave"]').click();
    await boxing.evaluate((r) => {   // an Other day reaching Save by another route
        /** @type {HTMLElement} */ (r).dataset.type = 'other';
        r.querySelector('.other-flavour-btn[data-flavour="TRG"]')?.classList.add('active');
    });
    await page.locator('#saveBtn').click();
    await expect(page.locator('#formFeedback')).toContainText('26 December 2026: an "Other" day cannot be recorded on Boxing Day');
    expect(await page.evaluate(() => (/** @type {any} */ (window).__E2E.batchWrites || []).length), 'nothing written').toBe(0);
});

// CHRISTMAS LEAVE READS AL IN THE BASE ROSTER COLUMN, as it does on the Calendar (owner, 18 Nov 2026: "This
// doesn't make sense"). A member due at work on 25 and 26 December read Rest there — the station's closure,
// under every Christmas — beside a Calendar reading AL, and at phone width the row's note that reconciled
// the two is out of sight until the row is ticked. Only the badge changed: work there is still RDW, so the
// hint that says so names the closure, and bulk Absent names both days for what they are.
test('admin: Christmas leave reads AL in the Base roster column at phone width, and the hints name the closure', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await adminOnWeek(page, 'G. Miller', '2026-12-21');
    const row = (/** @type {string} */ d) => page.locator(`.day-row[data-date="${d}"]`);
    for (const d of ['2026-12-25', '2026-12-26']) {
        await expect(row(d).locator('.col-base .shift-badge'), `${d}: the leave the Calendar shows`).toHaveText(/AL$/);
        await expect(row(d).locator('.col-pills'), `premise: ${d}'s note is out of sight until the row is ticked`).toBeHidden();
    }
    await expect(row('2026-12-24').locator('.col-base .shift-badge'), 'an ordinary day keeps its own base shift').not.toHaveText(/AL$/);
    const xmas = row('2026-12-25');
    await xmas.locator('.day-cb').click();
    await xmas.locator('.type-pill-btn[data-type="shift"]').click();
    await expect(xmas.locator('.col-rd-hint')).toHaveText('The station is closed on Christmas Day — use RDW if this day was worked');
    await xmas.locator('.type-pill-btn[data-type="shift"]').click();   // un-pick it: the bulk bar below starts clean
    await page.locator('#bulkSelAll').click();
    await page.locator('#bulkTypePills .pill-sick').click();
    await page.locator('#bulkApplyBtn').click();
    await expect(page.locator('#formFeedback'))
        .toContainText(`${formatDisplay('2026-12-25')} and ${formatDisplay('2026-12-26')} skipped: the station is closed, so nothing is recorded`);
    await expect(page.locator('#formFeedback')).not.toContainText(new RegExp(`${formatDisplay('2026-12-25')}[^;]*on the base roster`));
});

// SPARE ON A SUNDAY (owner, Nov 2026). The save always took one, but the grid had turned the whole Other
// pill off, and Spare lives behind it. Now Other offers Spare alone. CHRISTMAS DAY AND BOXING DAY CANNOT
// BE SPARE DAYS (owner, 19 Nov 2026), NOR OTHER DAYS (21 Nov 2026): the pill is off there, and Save
// refuses one that arrives another way.
test('admin: a Spare turn can be recorded on a Sunday, never on Christmas Day or Boxing Day', async ({ page }) => {
    await adminOnWeek(page, 'G. Miller', '2026-12-21');   // Sunday 20 Dec to Saturday 26 Dec 2026
    const sunday = page.locator('.day-row[data-date="2026-12-20"]');
    await sunday.locator('.day-cb').check();
    await sunday.locator('.pill-other').click();
    await expect(sunday.locator('.other-flavour-btn[data-flavour="SPARE"]'), 'Spare, the only choice, is pressed')
        .toHaveAttribute('aria-pressed', 'true');
    await expect(sunday.locator('.time-note'), 'a Spare takes no times').toBeVisible();
    await page.locator('#saveBtn').click();
    await expect(page.locator('#formFeedback')).toContainText('1 change saved for G. Miller', { timeout: 10000 });
    const written = await page.evaluate(() => /** @type {any} */ (window).__E2E.batchWrites.map((/** @type {any} */ w) => `${w.date} ${w.type} ${w.value}`));
    expect(written).toEqual(['2026-12-20 spare_shift SPARE']);

    const xmas = page.locator('.day-row[data-date="2026-12-25"]');
    await expect(xmas.locator('.other-flavour-btn[data-flavour="SPARE"]')).toBeDisabled();
    await expect(xmas.locator('.other-flavour-btn[data-flavour="SPARE"]')).toHaveAttribute('aria-label', '📋 Spare — unavailable on Christmas Day');   // as Boxing Day's chips: the chip's own text
    // …nor an Other day (owner, 21 Nov 2026: "There cannot be training or meeting on December 25th or 26th").
    await expect(xmas.locator('.pill-other')).toBeDisabled();
    await expect(xmas.locator('.pill-other')).toHaveAttribute('aria-label', 'Other — unavailable on Christmas Day: no Other day or Spare turn');
    await expect(xmas.locator('.other-flavour-btn[data-flavour="TRG"]')).toBeDisabled();
    await expect(xmas.locator('.col-pills')).toContainText('Christmas Day can’t be an Other day — training, meetings and the rest — or a Spare turn');
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.batchWrites = []; });
    const thu = page.locator('.day-row[data-date="2026-12-24"]');   // a working day, so the save has a batch
    await thu.locator('.day-cb').click();
    await thu.locator('.type-pill-btn[data-type="annual_leave"]').click();
    await xmas.locator('.day-cb').check();
    await xmas.evaluate((r) => {   // a Spare turn reaching Save by another route
        /** @type {HTMLElement} */ (r).dataset.type = 'other';
        r.querySelector('.other-flavour-btn[data-flavour="SPARE"]')?.classList.add('active');
    });
    await page.locator('#saveBtn').click();
    await expect(page.locator('#formFeedback')).toContainText('25 December 2026: a Spare turn cannot be recorded on Christmas Day');
    expect(await page.evaluate(() => (/** @type {any} */ (window).__E2E.batchWrites || []).length), 'nothing written').toBe(0);
    await xmas.evaluate((r) => {   // …and a Training day by the same route (owner, 21 Nov 2026)
        r.querySelector('.other-flavour-btn[data-flavour="SPARE"]')?.classList.remove('active');
        r.querySelector('.other-flavour-btn[data-flavour="TRG"]')?.classList.add('active');
    });
    await page.locator('#saveBtn').click();
    await expect(page.locator('#formFeedback')).toContainText('25 December 2026: an "Other" day cannot be recorded on Christmas Day');
    expect(await page.evaluate(() => (/** @type {any} */ (window).__E2E.batchWrites || []).length), 'nothing written').toBe(0);
});

// …AND ONE SAVED THERE BEFORE SAVE REFUSED IT CAN STILL BE TAKEN AWAY (owner, 20 Nov 2026: "Fix"). It sat
// under an Other pill Boxing Day has off, so selecting it again — how every saved day is removed — did
// nothing. The pill is on for that one act, and the save deletes the record.
test('admin: a Spare saved on Boxing Day before it was refused is removed by selecting Other again', async ({ page }) => {
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window);
        w.__E2E = { ...(w.__E2E || {}), docs: [{ id: 'm_2026-12-26_G.%20Miller', memberName: 'G. Miller', date: '2026-12-26',
            type: 'spare_shift', value: 'SPARE', note: '', source: 'roster_import', changedBy: 'G. Miller' }] };
    });
    await adminOnWeek(page, 'G. Miller', '2026-12-21');
    const boxing = page.locator('.day-row[data-date="2026-12-26"]');
    const other = boxing.locator('.pill-other');
    await expect(other, 'the saved Spare is drawn under Other').toHaveAttribute('aria-pressed', 'true');
    await expect(other).toBeEnabled();
    await expect(boxing.locator('.col-pills'), 'the row says the Calendar does not show it, and how it goes')
        .toContainText('an old Spare entry is saved here but doesn’t show on the Calendar — select Other to remove it');
    await expect(boxing.locator('.other-flavour-btn[data-flavour="TRG"]'), 'the pill offers removal, never a new Other day').toBeDisabled();
    await other.click();
    await expect(boxing, 'selecting it again clears the row').not.toHaveAttribute('data-type', /./);
    await expect(other, 'and Boxing Day still takes no Other day').toBeDisabled();
    await page.locator('#saveBtn').click();
    await expect(page.locator('#formFeedback')).toContainText('G. Miller', { timeout: 10000 });
    const deleted = await page.evaluate(() => (/** @type {any} */ (window).__E2E.batchDeletes || []).map((/** @type {string} */ p) => p.split('/').pop()));
    expect(deleted).toEqual(['m_2026-12-26_G.%20Miller']);
    expect(await page.evaluate(() => (/** @type {any} */ (window).__E2E.batchWrites || []).length), 'nothing written in its place').toBe(0);
});

// …AND AN OTHER DAY SAVED THERE BEFORE IS SAID THE SAME WAY (owner, 25 Nov 2026). The Calendar draws Boxing Day as
// leave over it, and the row said "on annual leave that is never counted — nothing to record" beside an active Other pill.
test('admin: an Other day saved on Boxing Day before it was refused says it does not show, and how it goes', async ({ page }) => {
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window);
        w.__E2E = { ...(w.__E2E || {}), docs: [{ id: 'm_2026-12-26_G.%20Miller', memberName: 'G. Miller', date: '2026-12-26',
            type: 'other', value: 'TRG RDW', note: '', source: 'manual', changedBy: 'G. Miller' }] };
    });
    await adminOnWeek(page, 'G. Miller', '2026-12-21');
    const boxing = page.locator('.day-row[data-date="2026-12-26"]');
    await expect(boxing.locator('.pill-other'), 'the saved Other day is drawn under Other').toHaveAttribute('aria-pressed', 'true');
    await expect(boxing.locator('.col-pills'))
        .toContainText('an old Other day entry is saved here but doesn’t show on the Calendar — select Other to remove it');
    await expect(boxing.locator('.col-pills')).not.toContainText('nothing to record');
});

// A DAY BEFORE A MEMBER'S START DATE TAKES NO CHANGE (whole-app check, Nov 2026; decided default). The
// Calendar, its legend and Team Week never show one (`isBeforeMemberStart`), so a change saved there was
// accepted, receipted and then invisible for ever.
test('admin: a day before the start date takes no change — the pills say why, Apply skips it, and Save refuses it', async ({ page }) => {
    await adminOnWeek(page, 'K. Jedlinski', '2026-06-01');   // starts Wed 3 Jun 2026
    const mon = page.locator('.day-row[data-date="2026-06-01"]');
    await mon.locator('.day-cb').click();
    for (const t of ['annual_leave', 'shift', 'rdw', 'sick', 'correction', 'other']) {
        await expect(mon.locator(`.type-pill-btn[data-type="${t}"]`), `${t} before the start date`).toBeDisabled();
    }
    await expect(mon.locator('.col-pills')).toContainText('Before the start date (3 June 2026)');
    await expect(page.locator('.day-row[data-date="2026-06-03"] .type-pill-btn[data-type="shift"]'), 'the start date itself is a working day').toBeEnabled();

    await page.locator('#bulkSelMonFri').click();
    await page.locator('#bulkTypePills .pill-correction').click();
    await page.locator('#bulkApplyBtn').click();
    await expect(page.locator('#formFeedback')).toContainText('Set 3 days — 1 June 2026 and 2 June 2026 skipped: before the start date, so nothing is recorded.');
    await expect(mon).not.toHaveAttribute('data-type', /./);

    await mon.evaluate((r) => { /** @type {HTMLElement} */ (r).dataset.type = 'correction'; });   // reaching Save another way
    await page.locator('#saveBtn').click();
    await expect(page.locator('#formFeedback')).toContainText('1 June 2026: before the start date, so a change here would never show on the Calendar');
    expect(await page.evaluate(() => (/** @type {any} */ (window).__E2E.batchWrites || []).length), 'nothing written').toBe(0);
});

// The before-start line is the row's own explanation, as the Sunday and Christmas lines are, so it is set
// as they are: on its own line under the pills, in the same quiet type. It shipped with no rule at all.
test('admin: the before-start line is set like the Sunday line in the same week', async ({ page }) => {
    await adminOnWeek(page, 'K. Jedlinski', '2026-06-01');   // starts Wed 3 Jun 2026
    const look = (/** @type {import('@playwright/test').Locator} */ el) => el.evaluate(n => {
        const s = getComputedStyle(n);
        return { flexBasis: s.flexBasis, fontSize: s.fontSize, fontWeight: s.fontWeight, color: s.color, marginTop: s.marginTop };
    });
    const sunday = await look(page.locator('.day-row:visible .sunday-note').first());
    expect(await look(page.locator('.day-row[data-date="2026-06-01"] .start-note'))).toEqual(sunday);
});

// …AND THE LEAVE CARD'S TWIN (whole-app check, 10 Nov 2026). Before the start date the base roster reads
// as rest, so a range across it asked "Swapped — counts / Rest day — free" about days the member had not
// joined for, and "Swapped" wrote leave the Calendar never shows and the allowance counted.
test('admin: a leave range across a start date asks nothing about the days before it, and writes none', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-06-01T09:00:00Z'));
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true }; });
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('K. Jedlinski');   // starts Wed 3 Jun 2026
    await page.locator('#alToggleHeader').click();
    await page.locator('#alRpGrid .rp-day[data-iso="2026-06-01"]').click();
    await page.locator('#alRpGrid .rp-day[data-iso="2026-06-05"]').click();
    const preview = page.locator('#alPreview');
    await expect(preview).toContainText('3 days');
    await expect(preview.locator('.swapday-row'), 'a question about a day before the start date').toHaveCount(0);
    await clickInView(page.locator('#alSaveBtn'));
    await expect(page.locator('#alFeedback')).toContainText('Recorded');
    const written = await page.evaluate(() => (/** @type {any} */ (window).__E2E.batchWrites || []).map((/** @type {any} */ w) => w.date).sort());
    expect(written).toEqual(['2026-06-03', '2026-06-04', '2026-06-05']);
});

// …and the preview says what those days are. It counted them among "rest days skipped" — a day before somebody
// started is not a rest day, and is told apart from the real ones in the same range (Sat 6 answered free, Sun 7).
test('admin: the leave preview names the days before the start date as such, not as rest days', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-06-01T09:00:00Z'));
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true }; });
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('K. Jedlinski');   // starts Wed 3 Jun 2026; Sat 6 and Sun 7 are rest days
    await page.locator('#alToggleHeader').click();
    await page.locator('#alRpGrid .rp-day[data-iso="2026-06-01"]').click();
    await page.locator('#alRpGrid .rp-day[data-iso="2026-06-07"]').click();
    const preview = page.locator('#alPreview');
    await clickInView(preview.locator('.swapday-row[data-date="2026-06-06"] .swapday-opt[data-answer="no"]'));
    await expect(preview).toContainText('3 days of Annual Leave');
    await expect(preview).toContainText('2 rest days skipped');
    await expect(preview).toContainText('2 days skipped before the start date');
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
                badgeGap: Math.round(r.getBoundingClientRect().right - badge.right),
                overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
                // An UNTOUCHED row (no tick, no type): its pills must not show, and it must not be
                // three lines of wrapped pills tall.
                rowH: Math.round(r.getBoundingClientRect().height),
                pillsShown: getComputedStyle(r.querySelector('.col-pills')).display !== 'none',
            };
        });
        // EVERY layout is stacked now (≤680px, and 681px up with no upper bound — polish round 2
        // moved the start from 1024px), so the base-roster badge is the row's last column and sits
        // against the right edge. Until the polish pass a ≥1400px block restated a five-column
        // template over the stacked placement: both grids still agreed (the assertion below passed)
        // while the badge sat mid-row at 1440 with a dead band beside it.
        expect(m.badgeGap, `@${width}px the base-roster badge must sit against the row's right edge`)
            .toBeLessThan(20);
        // The 681–1023px band used the five-column template until polish round 2: the time track
        // reserved ~194px on every row, so six pills wrapped onto three lines, showed on untouched
        // rows, and each row measured 132px at 800px. Stacked, an untouched row is its phone height.
        expect(m.pillsShown, `@${width}px an untouched row shows no type pills`).toBe(false);
        expect(m.rowH, `@${width}px an untouched row is one line of content, not three of pills`)
            .toBeLessThan(90);
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
    //
    // The member is a FIXED-roster one for the reason given on the base-roster-time test below, and
    // for a second reason that only bites here: on a week where every badge is identical this
    // assertion PASSES TRIVIALLY — one left edge, because there is only one badge width to have an
    // edge. That is the worse half of the same clock dependence, because a green test proving
    // nothing is indistinguishable from a green test proving something. The distinct-text
    // precondition is what stops it, and it is the assertion to keep if this ever gets rewritten.
    for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 1200 });
        await seedSession(page);
        await page.goto('/admin.html');
        await page.locator('#fieldMember').selectOption('C. Reen');
        await page.waitForSelector('.day-row', { timeout: 10000 });
        const badges = await page.evaluate(() => [...document.querySelectorAll('.day-row .col-base .shift-badge')]
            .map(b => ({ left: Math.round(b.getBoundingClientRect().left),
                         text: (b.textContent || '').replace(/\s+/g, ' ').trim() })));
        const texts = [...new Set(badges.map(b => b.text))];
        expect(texts.length,
            `@${width}px the week must hold badges of DIFFERENT widths, or one left edge is free — got ${texts.join(' | ')}`)
            .toBeGreaterThan(1);
        const lefts = [...new Set(badges.map(b => b.left))];
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
    //
    // THE MEMBER IS ON A FIXED LINE ON PURPOSE — DO NOT SWAP IT BACK FOR A ROTATING ONE (v22.97).
    // This used to read whatever week the real clock happened to land on, for a member on the
    // 20-week main roster — and FOUR of those twenty weeks are entirely SPARE. So the precondition
    // below was true four weeks in five and false the fifth, with nothing anywhere saying so: on
    // 6 Sep 2026 the rotation reached one and the suite went red on every engine at once, with no
    // code change behind it, which is indistinguishable from a real regression until you look.
    // `C. Reen` is `rosterType: 'fixed'` with no `rosterChanges` and no `startDate`, so their week
    // is the same seven days for ever — five 12:00-19:00 and two rest days. That is what lets the
    // count below be EXACT rather than a floor, and a floor is what hid the problem: `> 2` also
    // passes on the week that has three.
    //
    // AND THE WEEK IS AN ORDINARY ONE (test audit, 7 Nov 2026). The grid opens on today's week, and in
    // Christmas week one of those five days is 25 or 26 December, which the line is not rostered to
    // work — so from 21 to 27 Dec 2026 the count read 4, and every Christmas week after. Pinned to a
    // week with no bank holiday in it.
    await page.clock.setFixedTime(new Date('2026-11-03T09:00:00Z'));
    await page.setViewportSize({ width: 390, height: 900 });
    await seedSession(page);
    await page.goto('/admin.html');
    await page.locator('#fieldMember').selectOption('C. Reen');
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
    expect(timed.length, 'C. Reen works Mon–Fri on a fixed line — five timed days, every week')
        .toBe(5);
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

test('admin: on a phone the bulk-bar pills share the chips\' left edge, and so do the per-row pills', async ({ page }) => {
    // Polish round 2. The bulk bar is a 1 → 2 → 3 sequence whose step-1 chips start at the content
    // edge; the step-2 pills were centred, so their first row started ~39px in and a wrapped pill sat
    // alone mid-card. The per-row pills were centred on phones (v22.22) until the Nov 2026 polish
    // pass put them on the same left edge (`.col-pills` in admin.css) — both halves are asserted.
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSession(page);
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await expect(page.locator('#bulkBar')).toBeVisible();
    // Measured against the step's own left edge (its label), not the chips: whether the chips wrap
    // under "1 Tick days" or sit beside it depends on the engine's text metrics, and the pills wrap
    // under "2 Choose type" on every phone. Left-aligned, the first pill starts at that edge.
    const m = await page.evaluate(() => {
        const edge = document.querySelectorAll('.bulk-step-label')[1].getBoundingClientRect();
        const group = document.getElementById('bulkTypePills').getBoundingClientRect();
        const pill = document.querySelector('#bulkTypePills .type-pill-btn').getBoundingClientRect();
        return { edge: Math.round(edge.left), groupLeft: Math.round(group.left), pillLeft: Math.round(pill.left) };
    });
    expect(m.groupLeft, 'at 390px the pills wrap onto their own line under the step label').toBe(m.edge);
    expect(m.pillLeft, 'the first bulk pill starts at the step\'s left edge, not centred').toBe(m.edge);

    await page.locator('.week-panel .day-row .day-cb').first().check();
    const rowPills = page.locator('.week-panel .day-row.selected .col-pills').first();
    await expect(rowPills).toBeVisible();
    // Asked of the GEOMETRY, not the computed value (24 Nov 2026): Chromium 158 reports `justify-content: flex-start`
    // as "flow-start", the same layout under another name. Left-aligned, the first pill starts straight after the
    // row's "Type" label (its ::before, its margin and the row's gap); centred, it would start further in.
    const row = await rowPills.evaluate(el => {
        const cs = getComputedStyle(el);
        const before = getComputedStyle(el, '::before');
        const first = /** @type {Element} */ (el.querySelector('.type-pill-btn')).getBoundingClientRect();
        const contentLeft = el.getBoundingClientRect().left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
        const label = before.content === 'none' ? 0 : parseFloat(before.width) + parseFloat(before.marginLeft) + parseFloat(before.marginRight)
            + (parseFloat(cs.columnGap) || 0);
        return { pill: Math.round(first.left), expected: Math.round(contentLeft + label), justify: cs.justifyContent };
    });
    expect(Math.abs(row.pill - row.expected), `the per-row pills are left-aligned on a phone, as the bulk bar's are — ${JSON.stringify(row)}`)
        .toBeLessThanOrEqual(1);
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
    // Not a Sunday row: there Other offers Spare alone, which hides the times (admin-day-pills.js).
    const otherPill = page.locator('.day-row:not([data-spare-only="1"]) .pill-other:not([disabled])').first();
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

// The Other submenu opens only on demand, so the all-pages tap-target gate (which scans pages as they
// load) never measured it — and its flavour chips and RDW tick were ~20px tall on a phone.
test('admin: the Other submenu\'s chips and tick clear the 24px tap floor on touch @a11y', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile-chrome', 'a thumb, not a mouse');
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSession(page);
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    // Not a Sunday row: Other presses Spare there, which hides the RDW tick measured below.
    const row = page.locator('.day-row:not([data-spare-only="1"])').filter({ has: page.locator('.pill-other:not([disabled])') }).first();
    // A row's pills are offered once its day is ticked.
    await row.locator('.day-cb').check();
    await row.locator('.pill-other').click();
    const targets = row.locator('.other-opts .other-flavour-btn, .other-opts .other-rdw-label');
    await expect(targets.first()).toBeVisible();
    const heights = await targets.evaluateAll(els => els.map(e => [e.textContent.trim(), e.getBoundingClientRect().height]));
    expect(heights.length).toBeGreaterThan(1);
    for (const [label, h] of heights) expect(h, `"${label}" is ${h}px tall`).toBeGreaterThanOrEqual(24);
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

// Whole-app review, Oct 2026: a SWIPE brings in a panel built fresh with nothing ticked, and the bulk
// bar went on saying "5 days selected" about boxes that were no longer on screen. The arrows were
// always right — they redraw through renderWeekGrid, which recounts; the swipe settles without it.
test('admin: swiping to another week clears the bulk bar\'s "days selected" count', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#bulkSelMonFri').click();
    await expect(page.locator('#bulkSelCount')).toHaveText(/days? selected/);
    const start = await page.locator('#fieldDate').inputValue();
    await dragWeek(page, 'next');
    await expect.poll(() => page.locator('#fieldDate').inputValue(), { timeout: 5000 }).not.toBe(start);
    await page.waitForFunction(() => document.querySelectorAll('.week-carousel-panel').length === 0, null, { timeout: 5000 });
    await expect(page.locator('#weekGrid .day-cb:checked')).toHaveCount(0);
    await expect(page.locator('#bulkSelCount')).toHaveText('');
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

/** Where `dragWeek` drags the grid towards the next week, without dragging it. @param {import('@playwright/test').Page} page */
async function weekDragPoints(page) {
    await page.locator('#weekGrid').scrollIntoViewIfNeeded();
    const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (await page.locator('#weekGrid').boundingBox());
    const vh = /** @type {{ height: number }} */ (page.viewportSize()).height;
    return { from: box.x + box.width - 30, to: box.x + 40, y: (Math.max(box.y, 0) + Math.min(box.y + box.height, vh)) / 2 };
}

// A READ LANDING DURING A SWIPE (whole-app check, Nov 2026). A load finishing mid-gesture redraws the grid for
// the week the date still names; the swipe then committed anyway, so the heading and the date moved on while
// the rows stayed on the old week. Landing between the press and the drag left TWO weeks in the grid.
test('admin: a read landing during a week swipe leaves one week, the one the date names', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    for (const when of ['before the drag starts', 'mid-drag']) {
        await page.waitForFunction(() => document.querySelectorAll('.week-carousel-panel').length === 0, null, { timeout: 5000 });
        const start = await page.locator('#fieldDate').inputValue();
        // A background read held open — the return-to-page refresh or a Retry, as the store runs it.
        await page.evaluate(async () => {
            const w = /** @type {any} */ (window);
            w.__E2E.docsHeld = true;
            const m = await import('./admin-overrides.js');
            w.__landed = m.loadOverrides({ everyone: false, member: 'G. Miller' });
        });
        const land = () => page.evaluate(async () => { const w = /** @type {any} */ (window); w.__E2E.docsHeld = false; await w.__landed; });
        const { from, to, y } = await weekDragPoints(page);
        await page.mouse.move(from, y);
        await page.mouse.down();
        if (when === 'before the drag starts') await land();
        await page.mouse.move((from + to) / 2, y, { steps: 7 });
        if (when === 'before the drag starts') {
            expect(await page.locator('#weekGrid .week-panel:not(.week-carousel-panel)').evaluate(p => /** @type {HTMLElement} */ (p).style.transform),
                'the week on screen follows the drag, not the one the read replaced').not.toBe('');
        }
        if (when === 'mid-drag') await land();
        await page.mouse.move(to, y, { steps: 7 });
        await page.mouse.up();
        await expect.poll(() => page.locator('#fieldDate').inputValue(), { message: when }).not.toBe(start);
        const iso = await page.locator('#fieldDate').inputValue();
        expect(Math.round((Date.parse(iso) - Date.parse(start)) / 86400000), when).toBe(7);
        await expect.poll(() => page.locator('#weekGrid .day-row').evaluateAll(rs => rs.map(r => r.getAttribute('data-date'))),
            { message: `${when}: the rows are the week the date names` }).toContain(iso);
        await expect(page.locator('#weekGrid .week-panel'), `${when}: one week in the grid`).toHaveCount(1);
    }
});

// THE CONFIGURED YEARS ARE THE EDGE OF THE WEEK GRID (whole-app check, Nov 2026). The arrows, the swipe and
// `?date=` walked on past CONFIG.MAX_YEAR, into weeks with no bank holiday marked where nothing saved could be
// opened on the Calendar; and a `?date=` of 30 February emptied the field, so ‹ › then made NaN-NaN-NaN of it.
test('admin: the week grid stops at the configured years, and a ?date= that is not a real day opens today', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-08-27T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html?date=2026-02-30');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await expect(page.locator('#fieldDate'), 'not a real day: today').toHaveValue('2026-08-27');
    await page.locator('#nextWeekBtn').click();
    await expect(page.locator('#fieldDate'), 'and the arrows work from it').toHaveValue('2026-09-03');

    const [min, max] = await page.evaluate(async () => { const { CONFIG } = await import('./roster-data.js'); return [CONFIG.MIN_YEAR, CONFIG.MAX_YEAR]; });
    expect(await page.locator('#fieldDate').evaluate(el => [/** @type {HTMLInputElement} */ (el).min, /** @type {HTMLInputElement} */ (el).max]),
        'the date picker greys out the days past them').toEqual([`${min}-01-01`, `${max}-12-31`]);
    await page.goto(`/admin.html?date=${max}-12-24`);
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#nextWeekBtn').click();
    await expect(page.locator('#fieldDate')).toHaveValue(`${max}-12-31`);
    await expect(page.locator('#nextWeekBtn'), 'no arrow into the year after').toBeDisabled();
    await expect(page.locator('#prevWeekBtn')).toBeEnabled();
    // And the step itself is refused, should an arrow's state ever be stale.
    await page.locator('#nextWeekBtn').evaluate(b => { /** @type {HTMLButtonElement} */ (b).disabled = false; });
    await page.locator('#nextWeekBtn').click();
    await expect(page.locator('#fieldDate'), 'nor a stale arrow').toHaveValue(`${max}-12-31`);
    await dragWeek(page, 'next');
    await page.waitForFunction(() => document.querySelectorAll('.week-carousel-panel').length === 0, null, { timeout: 5000 });
    await expect(page.locator('#fieldDate'), 'nor a swipe').toHaveValue(`${max}-12-31`);
    await page.locator('#prevWeekBtn').click();
    await expect(page.locator('#fieldDate')).toHaveValue(`${max}-12-24`);
    await expect(page.locator('#nextWeekBtn')).toBeEnabled();
});

// A MOUSE SWIPES WITH ITS MAIN BUTTON, AND ONLY WHILE IT IS HELD (whole-app check, Nov 2026). A right-click opens
// the menu on the press and a Mac never hands the page its release, and a press released outside the grid is
// never heard either; the grid stayed armed, and the next bare movement over it slid the week under the cursor.
test('admin: only the main mouse button, held, drags the week — and a pointer that has gone is not an error', async ({ page }) => {
    /** @type {string[]} */ const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    const start = await page.locator('#fieldDate').inputValue();
    const unmoved = async (/** @type {string} */ what) => {
        expect(await page.evaluate(() => document.querySelectorAll('.week-carousel-panel').length), `${what}: no week built to slide in`).toBe(0);
        expect(await page.locator('#weekGrid .week-panel').evaluate(p => /** @type {HTMLElement} */ (p).style.transform), `${what}: the week has not moved`).toBe('');
    };
    /** @param {string} type @param {Record<string, number>} o */
    const fire = (type, o) => page.locator('#weekGrid').evaluate((g, a) => g.dispatchEvent(new PointerEvent(a.type,
        { bubbles: true, isPrimary: true, pointerType: 'mouse', ...a.o })), { type, o });
    let { from, to, y } = await weekDragPoints(page);

    // A drag with the RIGHT button held.
    await page.mouse.move(from, y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(to, y, { steps: 14 });
    await unmoved('a right-button drag');
    await page.mouse.up({ button: 'right' });

    // A main-button press whose release the grid never heard, then a bare movement over it.
    ({ from, to, y } = await weekDragPoints(page));
    await page.mouse.move(from, y);
    await page.locator('#weekGrid').evaluate((g, a) => g.dispatchEvent(new PointerEvent('pointerdown',
        { bubbles: true, isPrimary: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: a.from, clientY: a.y })), { from, y });
    await page.mouse.move(to, y, { steps: 14 });   // no button held
    await unmoved('a press released elsewhere');

    // A press released OFF the grid, and then a drag begun elsewhere carried in with the button held: the
    // grid still took it as the old press's swipe (the document hears that release; the grid did not).
    ({ from, to, y } = await weekDragPoints(page));
    const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (await page.locator('#weekGrid').boundingBox());
    await page.mouse.move(from, y);
    await page.mouse.down();
    await page.mouse.move(from, box.y - 20);                 // straight off the grid, unseen by it
    await page.mouse.up();
    await page.mouse.move(box.x + box.width / 2, box.y - 20);
    await page.mouse.down();                                   // a new press, NOT on the grid
    await page.mouse.move(to, y, { steps: 14 });               // carried in, button held
    await unmoved('a drag begun off the grid');
    await page.mouse.up();

    // A pointer the browser no longer knows: capturing it throws, which must end the gesture, not escape it.
    await fire('pointerdown', { pointerId: 99, button: 0, buttons: 1, clientX: from, clientY: y });
    await fire('pointermove', { pointerId: 99, button: -1, buttons: 1, clientX: to, clientY: y });
    await unmoved('a pointer that has gone');
    expect(errors, 'no uncaught error').toEqual([]);
    await expect(page.locator('#fieldDate')).toHaveValue(start);
});

// ── THE WEEK JUMP OPENS THE APP'S OWN CALENDAR (v23.38) ───────────────────────────────────────
//
// The rules are unit-tested (date-picker.test.mjs covers `monthCells`). What only a browser can
// answer is whether the label is WIRED to the picker at all — and that is the whole change, because
// until v23.38 tapping this label opened the OS date picker through an invisible `<input
// type="date">` laid over it. Both surfaces look identical in a screenshot of the closed control.
//
// It also proves the picker's CSS reaches this page. It lived in operations.css until this release
// and Admin does not load that file, so every rule would have silently not applied and the calendar
// would have rendered as bare buttons — the exact fault the module exists to fix. Asserting the
// panel has a real painted box is what sees that; `toBeVisible` would not.
test('admin: tapping the week label opens the app calendar, and picking a day moves the week',
    async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });

    const before = await page.locator('#fieldDate').inputValue();
    await page.locator('#weekNavLabel').click();

    const panel = page.locator('.dp-content');
    await expect(panel).toBeVisible();
    // The picker is styled here, not just present. An unstyled .dp-content is transparent and
    // padless, which is what a missing stylesheet looks like.
    const paint = await panel.evaluate(el => {
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, pad: parseFloat(cs.paddingTop) };
    });
    expect(paint.bg, 'the picker panel should have a painted surface')
        .not.toBe('rgba(0, 0, 0, 0)');
    expect(paint.pad, 'the picker panel should carry its own padding').toBeGreaterThan(8);

    // Pick a day that is not the one already selected, so the assertion cannot pass by standing
    // still. Every visible cell is in the month `#fieldDate` already sits in.
    const day = page.locator('.dp-day:not(.dp-off):not(.dp-sel)').first();
    const iso = await day.getAttribute('data-iso');
    await day.click();

    await expect(panel).toBeHidden();
    await expect.poll(() => page.locator('#fieldDate').inputValue(), { timeout: 5000 }).toBe(iso);
    expect(iso).not.toBe(before);

    // And the rest of the page followed: the label names the week containing the picked day. That
    // is the `change` event the OS picker used to fire, still reaching the same listeners.
    const picked = new Date(iso + 'T00:00:00');
    const sunday = new Date(picked);
    sunday.setDate(picked.getDate() - picked.getDay());
    const saturday = new Date(sunday);
    saturday.setDate(sunday.getDate() + 6);
    const text = await page.locator('#weekNavLabel').textContent();
    expect(text, `the heading should name the week containing ${iso}`)
        .toContain(String(sunday.getDate()));
    expect(text, `the heading should name the week containing ${iso}`)
        .toContain(String(saturday.getDate()));
});

// THE WEEK JUMP IS A WEEK PICKER (polish round 2). Admin's week runs Sunday–Saturday, and its picker
// laid the month out Monday-first and highlighted one day — so the week a tap would open was never
// what the grid showed. `week: true` makes it Sunday-first and bands the week. Other date fields keep
// the Monday-first single-day grid: Operations' is checked here too, from the same shared overlay.
test('admin: "Jump to a week" is Sunday-first and bands the week; other date pickers are unchanged',
    async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-16T09:00:00Z'));   // Wed 16 Sep 2026
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#weekNavLabel').click();
    await expect(page.locator('.dp-content')).toBeVisible();

    expect((await page.locator('.dp-dow').allInnerTexts()).join(''), 'Sunday is the first column')
        .toBe('SMTWTFS');
    // The chosen week is banded: exactly its seven days, Sun 13 – Sat 19 Sep.
    const band = await page.locator('.dp-day.dp-inweek').evaluateAll(els => els.map(e => e.getAttribute('data-iso')));
    expect(band).toEqual(['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19']);
    // …and drawn as a band, one ROW of the grid: all seven share a top edge, Sunday leftmost.
    const tops = await page.locator('.dp-day.dp-inweek').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(tops).size, 'the week is one row').toBe(1);

    // Hovering another day bands THAT day's week.
    await page.locator('.dp-day[data-iso="2026-09-23"]').hover();
    const hovered = await page.locator('.dp-day.dp-hoverweek').evaluateAll(els => els.map(e => e.getAttribute('data-iso')));
    expect(hovered).toEqual(['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26']);
    await page.keyboard.press('Escape');

    // The shared overlay without the option: Operations' date fields keep Monday-first, single-day.
    await page.addInitScript(() => { /** @type {any} */ (window).__E2E = { authUser: true, docs: [] }; });
    await page.goto('/operations.html');
    await page.evaluate(() => document.getElementById('circularUploadBody')?.classList.add('open'));
    const trigger = page.locator('#circularUploadBody .date-trigger');
    await expect(trigger).toBeVisible({ timeout: 10000 });
    await trigger.click();
    await expect(page.locator('.dp-content')).toBeVisible();
    expect((await page.locator('.dp-dow').allInnerTexts()).join('')).toBe('MTWTFSS');
    await expect(page.locator('.dp-day.dp-inweek')).toHaveCount(0);
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
