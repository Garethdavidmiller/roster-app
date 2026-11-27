// @ts-check
/**
 * e2e/trains.spec.js — the Trains page, driven through the real coordinator (trains-app.js).
 *
 * trains-change.test.mjs proves the RULES on small tables. This proves the WIRING: that the page a
 * member opens actually renders those answers for the chosen day and direction, that the views and
 * lookup reach them, that the page turns with the date (13 December, and when December's books run
 * out), and that every member is offered it (v24.81). Opening the wrong view from a headline, or
 * summarising the wrong direction for Coming back, leaves every unit test green.
 */
import { test, expect } from './fixtures.js';
import { collectFatalErrors, seedSession, seedMemberSession, seedMember, clearNoticeFlags, isTouchProject, scaleText, pickFirstMemberAndPassword } from './helpers.js';
import { TIMETABLES, STATIONS } from '../trains-data.js';
import { busiestStations, matchStations } from '../trains-stations.js';

/**
 * Type into the station box. Under a chosen station the box and the chips have folded away (v24.92),
 * so "Change station" brings them back first.
 * @param {import('@playwright/test').Page} page @param {string} text
 */
async function findStation(page, text) {
    if (await page.locator('#trStationPicker').isHidden()) await page.locator('#trStationChange').click();
    await page.locator('#trStationInput').fill(text);
}

/** Open the lookup card where it starts collapsed — on a phone (v24.92). @param {import('@playwright/test').Page} page */
async function openLookup(page) {
    if (!(await page.locator('#trLookupBody').evaluate(e => e.classList.contains('open')))) await page.locator('#trLookupChevron').click();
}

test.describe('trains', () => {
    test('the admin sees what changes, opens a station from it, and the day drives every view', async ({ page }) => {
        const errors = collectFatalErrors(page);
        // A Wednesday, so the page opens on Weekdays.
        await page.clock.setFixedTime(new Date('2026-10-07T09:00:00Z'));
        await seedSession(page, 'G. Miller');
        await page.goto('/trains.html');

        await expect(page.locator('#trCountdown')).toHaveText('67 days to go');
        // One real weekday (v24.83): 146 counted today's Mondays-and-Fridays 17:37 beside its 17:33 twin. And
        // since the external review of 18 Nov 2026, each kind of weekday whose count differs has its own row.
        await expect(page.locator('#trTotals .tr-total')).toHaveText(['Mon and Fri 144 → 158 +14', 'Tue to Thu 145 → 158 +13', 'Saturdays 100 → 105 +5', 'Sundays 91 → 94 +3']);
        await expect(page.locator('[data-day="SX"]')).toHaveAttribute('aria-pressed', 'true');
        // Chiltern's books say nothing about Christmas, so the page says it cannot answer for it.
        await expect(page.locator('#trFestive')).toBeVisible();
        await expect(page.locator('#trFestive')).toContainText('Christmas and New Year times are not on this page.');

        // What's changing: sentences, biggest first, and a tap opens that station.
        const heads = page.locator('#trChanges .tr-head');
        await expect(heads.first()).toHaveText(/A new direct train to Stratford-upon-Avon, the 09:31/);
        // Both timetables come from Chiltern's books since v24.80: nothing says it is waiting for stops.
        await expect(page.locator('#trChanges')).not.toContainText('once Chiltern publishes');
        await expect(page.locator('#trPartial')).toBeHidden();
        // Snow Hill's extra trains are Moor Street's own, so they are one headline, not two.
        await expect(page.locator('#trChanges .tr-head', { hasText: 'Birmingham Moor Street' })).toContainText('go on to Snow Hill');
        await expect(page.locator('#trChanges .tr-head', { hasText: /^Birmingham Snow Hill/ })).toHaveCount(0);
        // And the Amersham line's new trains are Aylesbury's: one line names every station they call
        // at, and no other line repeats them, even with the whole list open.
        await page.locator('#trHeadsMore').click();
        const ays = page.locator('#trChanges .tr-head', { hasText: 'to Aylesbury' });
        await expect(ays).toContainText('they also stop at Amersham, Great Missenden, Wendover and Stoke Mandeville');
        await expect(ays).toContainText('5 of them also stop at Harrow-on-the-Hill');
        await expect(page.locator('#trChanges .tr-head', { hasText: /trains a day to (Amersham|Great Missenden|Harrow)/ })).toHaveCount(0);
        await ays.click();
        await expect(page.locator('[data-view="stations"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#trViewChanges')).toBeHidden();
        await expect(page.locator('#trStationTitle')).toHaveText('Aylesbury');
        // The answer, then the rest of what changed, a line each — the cost of the gain read with it.
        await expect(page.locator('#trStation .tr-verdict')).toHaveText('6 more trains a day: 47, was 41. First train earlier: 06:01, was 06:35. Fastest journey 2 minutes longer: 53 min, was 51.');
        await expect(page.locator('#trStation .tr-verdict-also')).toHaveText(['First train earlier: 06:01, was 06:35.', 'Fastest journey 2 minutes longer: 53 min, was 51.']);
        const daily = page.locator('#trStation .tr-st-table tbody tr', { hasText: 'Trains a day' });
        await expect(daily.locator('td').nth(0)).toHaveText('41');
        await expect(daily.locator('td').nth(1)).toHaveText('47');
        // Today two off-peak hours have one Aylesbury train; December fills them. An average of 2
        // hid that, so the typical hour is shown with its exception.
        const hourly = page.locator('#trStation .tr-st-table tbody tr', { hasText: 'Daytime, trains an hour' });
        await expect(hourly.locator('td').nth(0)).toHaveText('2 (1 in some hours)');
        await expect(hourly.locator('td').nth(1)).toHaveText('2');
        // The day is in the subtitle: the day tabs do not print (v24.83).
        await expect(page.locator('#trStationHint')).toHaveText('Weekdays · London Marylebone → Aylesbury');

        // Coming back rewords the card and recounts it for trains INTO Marylebone — timed where the
        // passenger gets on, Aylesbury, since v24.83: today the middle of the day has hours with one
        // train to London, December two every hour.
        await page.locator('[data-sdir="arr"]').click();
        await expect(page.locator('#trStationHint')).toHaveText('Weekdays · Aylesbury → London Marylebone');
        await expect(page.locator('#trStation')).toContainText('Daytime, leaves Aylesbury at');
        await expect(page.locator('#trStation .tr-verdict')).toHaveText('More trains in the daytime: usually 2 an hour, was 1 to 3. 5 more trains a day: 42, was 37. Fastest journey 3 minutes shorter: 55 min, was 58.');
        // Train by train: only the trains that change, the rest one tap away.
        await page.locator('#trStation .tr-route-sum').click();
        await expect(page.locator('#trStation .tr-trains tbody tr').first()).toBeVisible();
        await expect(page.locator('#trStation .tr-trains')).not.toContainText('No change');
        const changedRows = await page.locator('#trStation .tr-trains tbody tr').count();
        await page.locator('#trAllTrains').click();
        await expect(page.locator('#trStation .tr-route')).toHaveAttribute('open', '');
        await expect(page.locator('#trStation .tr-trains')).toContainText('No change');
        expect(await page.locator('#trStation .tr-trains tbody tr').count()).toBeGreaterThan(changedRows);
        await expect(page.locator('#trStation .tr-trains')).toContainText('from Aylesbury Vale');

        // With December's stops published, a station every train runs THROUGH is answered in full —
        // until v24.80 Beaconsfield said "December not known yet"…
        await page.locator('[data-sdir="dep"]').click();
        await findStation(page, 'beac');
        await page.locator('#trStationPicks .tr-pick', { hasText: 'Beaconsfield' }).click();
        // 16 since v24.83: a train that passes it now, or starts calling, is counted at the station. Since 18 Nov
        // 2026 the sentence names the days it is true of, and a Monday's and a Friday's count follows. 12 since the
        // Trains review (Nov 2026): a stop moved from one train to another is one of December's trains, not two.
        await expect(page.locator('#trStation .tr-verdict')).toHaveText('Tuesday to Thursday, same number of trains a day, but 12 are different — see Train by train below. '
            + 'Fastest journey 3 minutes shorter: 21 min, was 24. Mondays and Fridays, 1 more train a day: 53, was 52.');
        const bcfDaily = page.locator('#trStation .tr-st-table tbody tr', { hasText: 'Trains a day' });
        await expect(bcfDaily.locator('td').nth(0)).toHaveText('53 (Mon and Fri: 52)');
        await expect(bcfDaily.locator('td').nth(0).locator('.tr-days')).toBeVisible();
        await expect(page.locator('#trStation')).not.toContainText('not known yet');
        await expect(page.locator('#trStation .tr-route')).toHaveCount(1);
        // …and Oxford counts the train that runs on to Banbury too, where it could count only the
        // trains that end there — so the card no longer says it is about those.
        await findStation(page, 'gerrards x');
        await expect(page.locator('#trStationPicks .tr-pick')).toHaveText(['Gerrards Cross']);
        // Two names that match equally: Enter opens the busier station, not the first in the alphabet —
        // "Risborough" opened Monks Risborough (v24.89, the 48-hour review).
        await page.locator('#trStationInput').fill('risborough');
        await expect(page.locator('#trStationPicks .tr-pick')).toHaveText(['Princes Risborough', 'Monks Risborough']);
        await page.locator('#trStationInput').press('Enter');
        await expect(page.locator('#trStationTitle')).toHaveText('Princes Risborough');
        await findStation(page, 'oxf');
        await page.locator('#trStationPicks .tr-pick', { hasText: /^Oxford$/ }).click();
        await expect(page.locator('#trStation .tr-verdict')).toHaveText('1 more train a day: 37, was 36. Fastest journey 4 minutes shorter: 68 min, was 72.');
        await expect(page.locator('#trStation .tr-sub')).toHaveCount(0);
        await expect(page.locator('#trStation .tr-route')).toHaveCount(1);

        // The basic hour: today's stops as dots, and Saturdays' December hour gains a :32 to Birmingham.
        await page.locator('[data-view="grid"]').click();
        await page.locator('[data-grid="now"]').click();
        const ger = page.locator('#trPattern tbody tr', { hasText: 'Gerrards Cross' });
        await expect(ger.locator('.tr-dot')).toHaveCount(3);
        await page.locator('[data-day="SO"]').click();
        await page.locator('[data-grid="dec"]').click();
        await expect(page.locator('#trPattern thead')).toContainText(':32');
        // December's columns carry their real stops: the new :32 stops at Banbury beside the :02.
        await expect(page.locator('#trPattern tbody tr', { hasText: 'Banbury' }).locator('.tr-dot')).toHaveCount(2);
        await expect(page.locator('#trPattern .tr-grid-key')).toBeVisible();
        await expect(page.locator('#trPattern')).not.toContainText('not published yet');

        // The lookup answers the exact train in a sentence, for the day now chosen.
        await page.locator('[data-day="SX"]').click();
        await page.locator('[data-view="changes"]').click();
        await openLookup(page);
        await page.locator('#trLookupInput').fill('1036');
        await expect(page.locator('#trLookupResult .tr-answer').first())
            .toHaveText('The 10:36 to Banbury: Will run to Birmingham Snow Hill. From 13 December it no longer stops at Kings Sutton.');
        await page.locator('#trLookupInput').fill('1715');
        await expect(page.locator('#trLookupResult')).toContainText('on to Stourbridge');
        await page.locator('#trLookupInput').fill('5.15pm');
        await expect(page.locator('#trLookupResult .tr-answer').first()).toContainText('The 17:15 to Oxford');
        await page.locator('#trLookupInput').fill('1716');
        await expect(page.locator('#trLookupResult')).toContainText('No weekday train leaves at exactly 17:16 in the current timetable.');
        // A word that is no time is a station asked for since the two lookups became one box (Nov 2026): not
        // found, and the box says how to ask, a time among the ways. A time it cannot read still says how to type one.
        await page.locator('#trLookupInput').fill('noon');
        await expect(page.locator('#trLookupResult')).toContainText('No station matches “noon”.');
        await expect(page.locator('#trLookupResult')).toContainText('a time like 17:15, 1715 or 5.15pm');
        await page.locator('#trLookupInput').fill('5');
        await expect(page.locator('#trLookupResult')).toHaveText('Type a time like 17:15, 1715 or 5.15pm.');

        // The `?` panels are wired — the page's caveats live there.
        await page.locator('.btn-card-tips[data-card="changes"]').click();
        await expect(page.locator('#tipsLbTitle')).toHaveText('What’s changing');
        await expect(page.locator('#tipsLbBody')).toContainText('5 of them also stop at means only five of those trains call there');

        expect(errors).toHaveLength(0);
    });

    // A RETURN VISIT STILL SAYS IT (v25.20). The overview opens folded from the second visit (v24.92),
    // and the Christmas line sat inside the fold — so from v25.13, which took away the line beneath the
    // tabs that had said it, a member who had opened the page once was never told again. The tests above
    // were all first visits. Both halves of its life: before the change, and through the festive weeks.
    for (const [when, words] of [['2026-11-03T10:00:00Z', 'before the change'], ['2026-12-24T10:00:00Z', 'on Christmas Eve']]) {
        test(`a return visit still shows the Christmas line, with the overview folded — ${words}`, async ({ page }) => {
            await page.setViewportSize({ width: 390, height: 844 });
            await page.clock.setFixedTime(new Date(when));
            await seedSession(page, 'C. Reen');
            await page.addInitScript(() => localStorage.setItem('myb_trains_overview_seen', '1'));
            await page.goto('/trains.html');
            await expect(page.locator('#trChanges .tr-head').first()).toBeVisible();
            await expect(page.locator('#trOverviewBody')).not.toHaveClass(/\bopen\b/);
            await expect(page.locator('#trFestive')).toBeVisible();
            await expect(page.locator('#trFestive')).toBeInViewport();
            await expect(page.locator('#trFestive')).toContainText('Christmas and New Year times are not on this page.');
            // And the fold still does its job: Find a train's box comes next, on the first screen (owner, Nov 2026:
            // "once they're using the page at the gateline, the lookup should come first"), and the first headline
            // is still on the first screen beneath it. It was held under 560px before the box came above it.
            const top = (/** @type {string} */ sel) => page.locator(sel).first().evaluate(e => Math.round(e.getBoundingClientRect().top));
            expect(await top('#trLookupInput'), 'the box is on the first screen, under the Christmas line').toBeLessThan(400);
            expect(await top('#trLookupInput'), 'the Christmas line comes first').toBeGreaterThan(await top('#trFestive'));
            expect(await top('#trChanges .tr-head'), 'the first headline is still on the first screen').toBeLessThan(844 - 60);
        });
    }

    test('the Christmas note goes once Chiltern\'s further changes end, on 10 January', async ({ page }) => {
        await page.clock.setFixedTime(new Date('2027-01-11T09:00:00Z'));
        await seedSession(page, 'G. Miller');
        await page.goto('/trains.html');
        await expect(page.locator('#trCountdown')).toHaveText('Now running');
        // From the end of the festive changes the page opens on STATIONS (v24.94); the list is one tab away.
        await expect(page.locator('[data-view="stations"]')).toHaveAttribute('aria-pressed', 'true');
        await page.locator('[data-view="changes"]').click();
        await expect(page.locator('#trChanges .tr-head').first()).toBeVisible();
        await expect(page.locator('#trFestive')).toBeHidden();
    });

    // THE RAILWAY DAY RUNS TO 03:00 (whole-app review, Oct 2026). The books file the 00:01, 00:05 and
    // 00:10 departures under the evening before, and the page chose its day by the calendar — so for
    // the first minutes after midnight it answered from the wrong timetable. Local times, no "Z":
    // the page reads the browser's clock, and the browser and this file share a time zone.
    test('just after midnight the page stays on the evening\'s timetable', async ({ page }) => {
        await page.clock.setFixedTime(new Date('2026-10-24T00:05:00'));   // Saturday 00:05 — still Friday night
        await seedSession(page, 'G. Miller');
        await page.goto('/trains.html');
        await expect(page.locator('[data-day="SX"]'), 'Friday night\'s 00:05 to Banbury is a weekday train').toHaveAttribute('aria-pressed', 'true');
        await page.clock.setFixedTime(new Date('2026-10-26T00:05:00'));   // Monday 00:05 — still Sunday night
        await page.reload();
        await expect(page.locator('[data-day="SU"]')).toHaveAttribute('aria-pressed', 'true');
    });

    // THE COUNTDOWN NAMES THE CALENDAR DAY (whole-app check, Nov 2026). It counted railway days too, so 00:30 on
    // Sunday 13 December said "Starts tomorrow" — read as the Monday — and 01:00 on the Monday "Starts today". The
    // timetable answering is still the railway day's: Saturday night's trains at 00:30 on the Sunday. Local times.
    test('for three hours after midnight the countdown names the calendar day, and the trains stay the night\'s', async ({ page }) => {
        await page.clock.setFixedTime(new Date('2026-12-13T00:30:00'));   // Sunday 00:30 — still Saturday night
        await seedSession(page, 'A. Person');
        await page.goto('/trains.html');
        await expect(page.locator('#trCountdown')).toHaveText('Starts today');
        await expect(page.locator('[data-day="SO"]'), 'Saturday night\'s trains are the ones running').toHaveAttribute('aria-pressed', 'true');
        await page.clock.setFixedTime(new Date('2026-12-14T01:00:00'));   // Monday 01:00 — still Sunday night
        await page.reload();
        await expect(page.locator('#trCountdown')).toHaveText('Now running');
        await expect(page.locator('[data-day="SU"]')).toHaveAttribute('aria-pressed', 'true');
    });

    // …and a page left open in view turns its countdown at midnight: it asked only whether the RAILWAY day had turned.
    test('a page left open over midnight turns its countdown then, not at 03:00', async ({ page }) => {
        await page.clock.setFixedTime(new Date('2026-12-12T23:58:00'));   // Saturday night
        await seedSession(page, 'A. Person');
        await page.goto('/trains.html');
        await expect(page.locator('#trCountdown')).toHaveText('Starts tomorrow');
        await page.clock.setFixedTime(new Date('2026-12-13T00:30:00'));
        await page.clock.runFor(60_000);
        await expect(page.locator('#trCountdown')).toHaveText('Starts today');
    });

    test('from 13 December the page turns: the old timetable by name, and the lookup answers from the new one (v24.83)', async ({ page }) => {
        // A Sunday after the change. Until v24.83 the columns still said "Now" of the stopped timetable
        // and "the 15:38" — December's Moor Street train — read "No train leaves at exactly 15:38 today".
        await page.clock.setFixedTime(new Date('2026-12-20T10:00:00Z'));
        await seedSession(page, 'C. Reen');
        await page.goto('/trains.html');
        await expect(page.locator('#trCountdown')).toHaveText('Now running');
        await expect(page.locator('#trLead')).toContainText('This page compares the timetable that ran until Saturday 12 December with the new one');
        await expect(page.locator('[data-day="SU"]')).toHaveAttribute('aria-pressed', 'true');
        await openLookup(page);
        await page.locator('#trLookupInput').fill('15:38');
        await expect(page.locator('#trLookupResult .tr-answer')).toHaveText('The 15:38 to Birmingham Moor Street: New from 13 December.');
        await expect(page.locator('#trLookupResult .tr-near-head').first()).toHaveText('Until 12 Dec');
        await page.locator('[data-view="grid"]').click();
        await expect(page.locator('#trGridNow')).toHaveText('Until 12 Dec');
        await page.locator('[data-view="stations"]').click();
        await findStation(page, 'banbury');
        await page.locator('#trStationInput').press('Enter');
        await expect(page.locator('#trStation .tr-st-table thead')).toContainText('Until 12 Dec');
    });

    test('once December\'s books run out, the page says both timetables have ended (v24.83) — on a return visit too', async ({ page }) => {
        await page.clock.setFixedTime(new Date('2027-05-17T09:00:00Z'));
        await seedSession(page, 'C. Reen');
        // A device that has read the overview before: it would open folded, but its one message now is
        // that both timetables have ended, and that must be seen (v24.92).
        await page.addInitScript(() => localStorage.setItem('myb_trains_overview_seen', '1'));
        await page.goto('/trains.html');
        await expect(page.locator('#trCountdown')).toHaveText('Timetables ended');
        await expect(page.locator('#trOverviewBody')).toHaveClass(/\bopen\b/);
        await expect(page.locator('#trEnded')).toBeVisible();
        // The two cards that answer a question say so too, before their answer: they went on answering from the
        // ended books in the present tense (whole-app check, Nov 2026).
        const ended = 'These times come from timetables that have ended. Check the journey planner for today’s trains.';
        await expect(page.locator('[data-view="changes"]')).toHaveAttribute('aria-pressed', 'true');
        await openLookup(page);
        await page.locator('#trLookupInput').fill('17:15');
        await expect(page.locator('#trLookupResult > p').first()).toHaveText(ended);
        await expect(page.locator('#trLookupResult .tr-answer')).toContainText('The 17:15 to Oxford');
        await expect(page.locator('#trLookupResult a', { hasText: 'the journey planner' })).toHaveAttribute('rel', /noopener/);
        await page.locator('[data-view="stations"]').click();
        await findStation(page, 'banbury');
        await page.locator('#trStationInput').press('Enter');
        await expect(page.locator('#trStation > p').first()).toHaveText(ended);
        await expect(page.locator('#trStation .tr-verdict')).toBeVisible();
    });

    // ON A DESKTOP A STATION CARD'S NOTES STACK UNDER ITS FIGURES (whole-app check, Nov 2026). From 1024px the card is
    // two columns, and every note had the same grid cell, so coming back on the Amersham line the leaf-fall note was
    // drawn on top of the times note. And once both timetables have ended, the line saying so runs across the top.
    test('on a desktop a station card\'s notes stack under its figures, and the ended line runs across the top', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        const open = async (/** @type {string} */ when, /** @type {string} */ station, /** @type {'dep'|'arr'} */ dir) => {
            await page.clock.setFixedTime(new Date(when));
            await seedSession(page, 'A. Person');
            await page.goto('/trains.html');
            await page.locator('[data-view="stations"]').click();
            await findStation(page, station);
            await page.locator('#trStationInput').press('Enter');
            await page.locator(`[data-sdir="${dir}"]`).click();
            await expect(page.locator('#trStation .tr-verdict')).toBeVisible();
        };
        const boxes = (/** @type {string} */ sel) => page.locator(sel).evaluateAll(els => els.map(e => {
            const b = e.getBoundingClientRect();
            return { top: b.top, bottom: b.bottom, left: b.left, width: b.width, text: (e.textContent ?? '').trim().slice(0, 40) };
        }));
        await open('2026-11-20T09:00:00', 'amersham', 'arr');   // leaf fall runs until 10 January
        await expect(page.locator('#trStation .tr-note', { hasText: 'Leaf fall' })).toBeVisible();
        const left = await boxes('#trStation .tr-st-table, #trStation .tr-note');
        expect(left.length, 'premise: the figures and at least two notes').toBeGreaterThanOrEqual(3);
        for (let i = 1; i < left.length; i++) {
            expect(left[i].top, `"${left[i].text}" starts where "${left[i - 1].text}" is still drawn`).toBeGreaterThanOrEqual(left[i - 1].bottom - 0.5);
        }
        const [list] = await boxes('#trStation .tr-route');
        expect(list.left, 'premise: two columns — the train list beside the figures').toBeGreaterThan(left[0].left + left[0].width);
        await open('2027-05-17T09:00:00', 'banbury', 'dep');
        await expect(page.locator('#trStation > .tr-lead')).toContainText('These times come from timetables that have ended.');
        const [line] = await boxes('#trStation > .tr-lead');
        const [verdict] = await boxes('#trStation > .tr-verdict');
        expect(line.bottom, 'the ended line comes before the answer').toBeLessThanOrEqual(verdict.top + 0.5);
        expect(Math.abs(line.width - verdict.width), 'and runs across the card, as the answer does').toBeLessThanOrEqual(1);
    });

    test('a station card, coming back, as a member reads it: Amersham leaf fall, and the Monday-and-Friday Snow Hill train (v24.83)', async ({ page }) => {
        await page.clock.setFixedTime(new Date('2026-10-21T09:00:00Z'));
        await seedSession(page, 'C. Reen');
        await page.goto('/trains.html');
        await page.locator('[data-view="stations"]').click();
        await findStation(page, 'amersham');
        await page.locator('#trStationInput').press('Enter');
        await expect(page.locator('#trStationTitle')).toHaveText('Amersham');
        await expect(page.locator('#trStation')).not.toContainText('Leaf fall');
        await page.locator('[data-sdir="arr"]').click();
        await expect(page.locator('#trStation')).toContainText('Leaf fall: until 10 January, trains to London via Amersham leave up to 3 minutes earlier than usual');
        // The Mondays-and-Fridays 17:37 is the 17:33's twin, 4 minutes earlier — the card once said "No longer runs".
        await page.locator('[data-sdir="dep"]').click();
        await findStation(page, 'snowhill');
        await page.locator('#trStationInput').press('Enter');
        await page.locator('#trStation .tr-route-sum').click();
        const twin = page.locator('#trStation .tr-trains tbody tr', { hasText: 'Mon and Fri only' });
        await expect(twin).toContainText('17:37');
        await expect(twin).toContainText('4 mins earlier');
        await expect(page.locator('#trStation .tr-trains')).not.toContainText(/No longer runs|Will stop running/);
    });

    test('a headline opens its station going there; Back returns to the list; focus lands on the station\'s name (v24.83, v24.92)', async ({ page }) => {
        await page.clock.setFixedTime(new Date('2026-10-21T09:00:00Z'));
        await seedSession(page, 'C. Reen');
        await page.goto('/trains.html');
        // Leave the station view facing Coming back, then open a station from the list.
        await page.locator('[data-view="stations"]').click();
        await page.locator('#trStationPicks .tr-pick').first().click();
        await page.locator('[data-sdir="arr"]').click();
        await page.locator('[data-view="changes"]').click();
        await page.locator('#trChanges .tr-head', { hasText: 'to Aylesbury' }).click();
        await expect(page.locator('[data-sdir="dep"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#trStationTitle')).toBeFocused();
        // Android Back (and the browser's) returns to the list rather than leaving the page.
        await page.goBack();
        await expect(page).toHaveURL(/trains\.html/);
        await expect(page.locator('#trViewChanges')).toBeVisible();
        // A control redrawn under the keyboard keeps focus, so the next Tab does not restart at the
        // menu — and a chip, which folds away with the picker once pressed (v24.92), hands focus to
        // the station's name: the answer to what was pressed.
        await page.locator('[data-view="stations"]').click();
        await page.locator('#trStationChange').click();
        await expect(page.locator('#trStationInput')).toBeFocused();
        const pick = page.locator('#trStationPicks .tr-pick').nth(1);
        const name = await pick.innerText();
        await pick.focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#trStationTitle')).toBeFocused();
        await expect(page.locator('#trStationTitle')).toHaveText(name);
        await expect(page.locator('#trStationPicker')).toBeHidden();
        // The day tabs keep their own focus as before.
        await page.locator('[data-day="SO"]').focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('[data-day="SO"]')).toBeFocused();
    });

    test('the page opens on the answers (v24.92): the overview folds from the second visit, the lookup is first', async ({ page }) => {
        await page.setViewportSize({ width: 393, height: 727 });
        await page.clock.setFixedTime(new Date('2026-10-23T09:00:00Z'));
        await seedSession(page, 'C. Reen');
        await page.goto('/trains.html');
        // First visit: the overview is open and read.
        await expect(page.locator('#trOverviewBody')).toHaveClass(/\bopen\b/);
        await expect(page.locator('#trFestive')).toBeVisible();
        // No caveat line beneath the tabs, on any view (v25.13 — owner, 2 Nov 2026: "This is the confirmed
        // final timetable"). It said "December times can still change" from v24.92 to v25.12.
        await expect(page.locator('#trCaveat')).toHaveCount(0);
        for (const view of ['stations', 'grid', 'changes']) {
            await page.locator(`[data-view="${view}"]`).click();
            await expect(page.locator('body')).not.toContainText('can still change');
        }
        // The day row is labelled.
        await expect(page.locator('.tr-seg-label')).toHaveText('Day');
        // Second visit: the overview opens folded; its header still carries the countdown.
        await page.reload();
        await expect(page.locator('#trChanges .tr-head').first()).toBeVisible();
        await expect(page.locator('#trOverviewBody')).not.toHaveClass(/\bopen\b/);
        await expect(page.locator('#trOverviewChevron')).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('#trCountdown')).toHaveText('51 days to go');
        // FIND A TRAIN COMES FIRST (owner, Nov 2026: "once they're using the page at the gateline, the lookup should
        // come first"). Before the tabs and every view, OPEN on a phone too — until then it started folded there, so
        // the changes list was the first thing read.
        expect(await page.evaluate(() => {
            const lookup = document.getElementById('trLookupCard');
            return ['trControls', 'trChangesCard', 'trViewStations', 'trViewGrid'].every(id => {
                const other = document.getElementById(id);
                return !!lookup && !!other && !!(lookup.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING);
            }) && !lookup?.closest('.tr-view');
        }), 'the lookup card precedes the tabs and every view, and belongs to none of them').toBe(true);
        await expect(page.locator('#trLookupBody')).toHaveClass(/\bopen\b/);
        const box = await page.locator('#trLookupInput').evaluate(e => Math.round(e.getBoundingClientRect().bottom));
        // Until 10 January the Christmas line sits above the fold ON PURPOSE (v25.20): it is the one thing
        // on the card a member must not miss. So it is not counted against the budget, and is held instead
        // to being a short note, not a paragraph. The note's own cap allows for the renderer: 84px here (three
        // lines), 105px on CI's runners (four), which set a 100px cap off. The first headline was held under
        // 500px past it; the box comes first now, and its whole height is the budget (589px before v24.92).
        const christmas = await page.locator('#trFestive').evaluate(e => /** @type {HTMLElement} */ (e).hidden ? 0 : Math.round(e.getBoundingClientRect().height));
        expect(christmas, 'the Christmas line stays a short note, not a paragraph').toBeLessThan(130);
        expect(box - christmas, 'the box is on the first screen with room for its answer').toBeLessThan(320);
        // The first headline is still on the first screen, under the box.
        const first = await page.locator('#trChanges .tr-head').first().evaluate(e => Math.round(e.getBoundingClientRect().top));
        expect(first, 'the first headline is still on the first screen').toBeLessThan(727);
        // Folded and opened again by its header, the card puts the cursor in the box.
        await page.locator('#trLookupToggleHeader').click();
        await expect(page.locator('#trLookupBody')).not.toHaveClass(/\bopen\b/);
        await page.locator('#trLookupToggleHeader').click();
        await expect(page.locator('#trLookupInput')).toBeFocused();
        await page.keyboard.type('1715');
        await expect(page.locator('#trLookupResult .tr-answer').first()).toContainText('The 17:15 to Oxford');
        // A desktop: open too, above the changes list, which has the page's width to itself.
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.reload();
        await expect(page.locator('#trChanges .tr-head').first()).toBeVisible();
        await expect(page.locator('#trLookupBody')).toHaveClass(/\bopen\b/);
        const [lookupCard, changesCard] = await Promise.all(['#trLookupCard', '#trChangesCard'].map(s => page.locator(s).evaluate(e => e.getBoundingClientRect().toJSON())));
        expect(changesCard.top, 'the changes list is below the lookup').toBeGreaterThan(lookupCard.bottom);
        expect(Math.abs(changesCard.width - lookupCard.width), 'and as wide as it').toBeLessThanOrEqual(1);
    });

    test('a chosen station folds the picker away; Change station brings it back; the headlines read as lead, detail and a chip (v24.92)', async ({ page }) => {
        await page.clock.setFixedTime(new Date('2026-10-23T09:00:00Z'));
        await seedSession(page, 'C. Reen');
        await page.goto('/trains.html');
        const first = page.locator('#trChanges .tr-head').first();
        await expect(first.locator('.tr-chip')).toHaveText('New route');
        await expect(first.locator('.tr-head-lead')).toHaveText('A new direct train to Stratford-upon-Avon, the 09:31');
        await expect(first.locator('.tr-head-detail')).toHaveCount(0);
        const ays = page.locator('#trChanges .tr-head', { hasText: 'to Aylesbury' });
        await expect(ays.locator('.tr-chip')).toHaveText('+6 a day');
        await expect(ays.locator('.tr-head-lead')).toHaveText('6 more trains a day to Aylesbury');
        await expect(ays.locator('.tr-head-detail')).toContainText('47, was 41 · they also stop at Amersham');
        await ays.click();
        // The answer sits under the station's name: no search box or chips between them.
        await expect(page.locator('#trStationPicker')).toBeHidden();
        await expect(page.locator('#trStationChange')).toBeVisible();
        await expect(page.locator('#trStation .tr-verdict')).toBeVisible();
        await page.locator('#trStationChange').click();
        await expect(page.locator('#trStationPicker')).toBeVisible();
        await expect(page.locator('#trStationChange')).toBeHidden();
        await expect(page.locator('#trStationPicks .tr-pick[aria-pressed="true"]')).toHaveText('Aylesbury');
        await page.locator('#trStationInput').fill('banbury');
        await page.locator('#trStationInput').press('Enter');
        await expect(page.locator('#trStationTitle')).toHaveText('Banbury');
        await expect(page.locator('#trStationPicker')).toBeHidden();
        // Change station starts the search afresh: the busiest chips, not the last search's one match.
        await page.locator('#trStationChange').click();
        await expect(page.locator('#trStationInput')).toHaveValue('');
        // …under the station just looked at, remembered as "You looked at" (v24.94; "Last time" until the words review).
        await expect(page.locator('#trStationPicks .tr-picks-label')).toHaveText(['You looked at', 'Busiest stations']);
        // Coming back from Aylesbury, a shift the leaf-fall note explains is quiet text; the tally says how many.
        await page.locator('#trStationPicks .tr-pick', { hasText: 'Aylesbury' }).click();
        await page.locator('[data-sdir="arr"]').click();
        await page.locator('#trStation .tr-route-sum').click();
        await page.locator('#trAllTrains').click();
        const quiet = page.locator('#trStation .tr-trains tbody tr', { hasText: 'may be leaf fall' });
        expect(await quiet.count()).toBeGreaterThan(0);
        await expect(quiet.first().locator('.tr-chip')).toHaveClass(/tr-chip--same/);
        await expect(page.locator('#trStation .tr-route-what')).toContainText(/\d+ of them by 3 minutes or less, which may be leaf fall/);
    });

    test('where they stop: a column tap shows one train\'s stops, the lines are banded, and the heads follow the reader down (v24.92)', async ({ page }) => {
        await page.setViewportSize({ width: 393, height: 727 });
        await page.clock.setFixedTime(new Date('2026-10-23T09:00:00Z'));
        await seedSession(page, 'C. Reen');
        await page.goto('/trains.html');
        await expect(page.locator('[data-view="grid"]')).toHaveText(/Where they stop/);
        await page.locator('[data-view="grid"]').click();
        await expect(page.locator('#trPatternCard h2')).toHaveText(/Where they stop/);
        await expect(page.locator('#trPattern .tr-grid-band')).toHaveText(['Main line', 'Aylesbury via Amersham']);
        const rows = page.locator('#trPattern tbody tr:not(.tr-grid-band)');
        const all = await rows.count();
        await expect(page.locator('#trPattern .tr-grid-tip')).toContainText('Choose a time at the top');
        // The mirror: hidden while the real heads are on screen, shown once they have scrolled off —
        // drawn by its own module, served to the page with the one export the coordinator calls.
        // (Not the resource-timing buffer: the page loads more modules than its 250 entries hold.)
        expect(await page.evaluate(() => import('./trains-grid-mirror.js').then(m => typeof m.syncGridMirror)),
            'trains-grid-mirror.js is served and exports syncGridMirror').toBe('function');
        const stick = page.locator('#trPattern .tr-grid-stick');
        await expect(stick).toBeHidden();
        await page.locator('#trPattern .tr-grid tbody tr', { hasText: 'Banbury' }).scrollIntoViewIfNeeded();
        await page.evaluate(() => window.scrollBy(0, 120));
        await expect(stick).toBeVisible();
        await expect(stick).toContainText(':06');
        await expect(stick).toHaveAttribute('aria-hidden', 'true');
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect(stick).toBeHidden();
        // One train at a time.
        const oxford = page.locator('#trPattern .tr-grid-colbtn', { hasText: /^:06/ });
        await oxford.click();
        await expect(oxford).toHaveAttribute('aria-pressed', 'true');
        await expect(oxford).toBeFocused();
        await expect(page.locator('#trPattern .tr-grid-focus')).toContainText('Only where the :06 to Oxford stops.');
        expect(await rows.count()).toBeLessThan(all);
        await expect(page.locator('#trPattern tbody tr', { hasText: 'Beaconsfield' })).toBeVisible();
        await expect(page.locator('#trPattern tbody tr', { hasText: 'Banbury' })).toHaveCount(0);
        await expect(page.locator('#trPattern .tr-grid-band')).toHaveCount(0);
        // Every row left has the chosen train's dot — or a lost one.
        expect(await page.locator('#trPattern tbody tr:not(.tr-grid-origin) td.tr-col-on').evaluateAll(tds => tds.every(td => td.querySelector('.tr-dot')))).toBe(true);
        await page.locator('#trGridAll').click();
        expect(await rows.count()).toBe(all);
        await expect(page.locator('#trPattern .tr-grid-wrap')).toBeFocused();
        // A pressed head released: the same tap again.
        await oxford.click();
        await page.locator('#trPattern .tr-grid-colbtn[aria-pressed="true"]').click();
        expect(await rows.count()).toBe(all);
        // Another day lets the chosen column go.
        await oxford.click();
        await page.locator('[data-day="SO"]').click();
        await expect(page.locator('#trPattern .tr-grid-colbtn[aria-pressed="true"]')).toHaveCount(0);
    });

    // ── THE TWO DECEMBER CHANGES ARE TWO SHAPES (whole-app review, 10 Nov 2026) ──────────────────
    // "New stop" and "no longer stops" were a green ring and a red one of the same lightness, so with
    // red-green colour blindness, or on a black-and-white printer, the key showed two identical rings
    // for opposite meanings, and the grid's cells carry no words. Compared here as a greyscale printer
    // sees them: the INSIDES of the two rings must not be the same picture. At 4× so a 12px dot is
    // 48 pixels, sampled on one grid, because the two sit at different fractional offsets and a
    // pixel-by-pixel comparison of the raw captures compared misaligned images (measured).
    test.describe('the December dots', () => {
        test.use({ deviceScaleFactor: 4 });
        test('where they stop: "new stop" and "no longer stops" differ in shape, not only in colour', async ({ page }) => {
            await page.setViewportSize({ width: 393, height: 900 });
            await page.clock.setFixedTime(new Date('2026-10-23T09:00:00Z'));
            await seedSession(page, 'C. Reen');
            await page.goto('/trains.html');
            await page.locator('[data-view="grid"]').click();
            await page.locator('[data-grid="dec"]').click();
            const key = page.locator('#trPattern .tr-grid-key');
            await expect(key, 'premise: the December key names both changes').toContainText('no longer stops');
            const shot = async (/** @type {string} */ kind) => (await key.locator(`.tr-dot--${kind}`).screenshot()).toString('base64');
            const pair = [await shot('new'), await shot('lost')];
            // Decoded in a blank page, where a canvas has no stylesheet or CSP in its way.
            const lab = await page.context().newPage();
            const apart = await lab.evaluate(async ([a, b]) => {
                /** The middle 40% of a capture — inside any ring — in greyscale, on a 16×16 grid. */
                const inside = async (/** @type {string} */ png) => {
                    const img = new Image();
                    img.src = `data:image/png;base64,${png}`;
                    await img.decode();
                    const c = document.createElement('canvas');
                    c.width = img.width; c.height = img.height;
                    const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
                    g.drawImage(img, 0, 0);
                    const d = g.getImageData(0, 0, c.width, c.height).data;
                    const out = [];
                    for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) {
                        const x = Math.floor(c.width * (0.3 + 0.4 * (i + 0.5) / 16)), y = Math.floor(c.height * (0.3 + 0.4 * (j + 0.5) / 16));
                        const k = 4 * (y * c.width + x);
                        out.push(0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2]);
                    }
                    return out;
                };
                const [p, q] = [await inside(a), await inside(b)];
                return p.reduce((sum, v, i) => sum + Math.abs(v - q[i]), 0) / p.length;
            }, pair);
            await lab.close();
            // Measured in Chromium: 97.5 for the plus and the slash, 25 for the two plain rings they replaced.
            expect(apart, 'in greyscale the insides of the two symbols are nearly the same picture').toBeGreaterThan(60);
        });
    });

    // ── A PHONE'S COLUMN HEADS ARE AS TIGHT AS ITS CELLS (whole-app review, 10 Nov 2026) ───────────
    // The heads' phone padding sat in the ≤480px block ABOVE the base rule for the same selector, so it
    // lost on source order: every head kept the desktop's 6px a side, 42px across the weekday's seven
    // trains, and a 393px phone showed three whole trains before swiping where it shows four.
    for (const [width, side] of [[393, '3px'], [1280, '6px']]) {
        test(`where they stop: a column head is padded like the cells beneath it at ${width}px`, async ({ page }) => {
            await page.setViewportSize({ width, height: 900 });
            await page.clock.setFixedTime(new Date('2026-10-23T09:00:00Z'));
            await seedSession(page, 'C. Reen');
            await page.goto('/trains.html');
            await page.locator('[data-view="grid"]').click();
            await expect(page.locator('#trPattern .tr-grid-colbtn').first()).toBeVisible();
            const pad = await page.evaluate(() => ({
                head: getComputedStyle(/** @type {Element} */ (document.querySelector('#trPattern .tr-grid-colbtn'))).paddingLeft,
                cell: getComputedStyle(/** @type {Element} */ (document.querySelector('#trPattern tbody td'))).paddingLeft,
            }));
            expect(pad).toEqual({ head: side, cell: side });
        });
    }

    // The tallest column head is flush with the top of the grid's scroll box, and the box clips: a ring
    // drawn 2px OUTSIDE the button lost its whole top edge there (measured 4px above the box).
    test('where they stop: the focus ring on a column head is drawn whole', async ({ page }) => {
        await page.setViewportSize({ width: 393, height: 900 });
        await page.clock.setFixedTime(new Date('2026-10-23T09:00:00Z'));
        await seedSession(page, 'C. Reen');
        await page.goto('/trains.html');
        await page.locator('[data-view="grid"]').click();
        const heads = page.locator('#trPattern .tr-grid-colbtn');
        await expect(heads.first()).toBeVisible();
        const tallest = await heads.evaluateAll(bs => {
            const tops = bs.map(b => b.getBoundingClientRect().top);
            return tops.indexOf(Math.min(...tops));
        });
        await heads.nth(tallest).focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');            // a keyboard arrival, so :focus-visible draws the ring
        const g = await page.evaluate(() => {
            const el = /** @type {HTMLElement} */ (document.activeElement);
            const box = /** @type {Element} */ (document.querySelector('#trPattern .tr-grid-wrap')).getBoundingClientRect();
            const cs = getComputedStyle(el), r = el.getBoundingClientRect();
            const reach = parseFloat(cs.outlineOffset) + parseFloat(cs.outlineWidth);
            return { head: el.classList.contains('tr-grid-colbtn'), ringTop: r.top - reach, boxTop: box.top };
        });
        expect(g.head, 'premise: Tab landed on the column head').toBe(true);
        expect(g.ringTop, 'the ring\'s top edge is inside the scroll box that clips it').toBeGreaterThanOrEqual(g.boxTop - 0.5);
    });

    // A line's name heads its stations, so it must stay in view with them when the grid is scrolled sideways.
    // Its cell spans every column — the table's whole width — so only an element inside it can be pinned
    // (trains.css → .tr-grid-band-label). Read off the rendered text, whatever wraps it.
    test('where they stop: scrolled sideways, each line\'s name stays at the left with the station names', async ({ page }) => {
        await page.setViewportSize({ width: 393, height: 727 });
        await page.clock.setFixedTime(new Date('2026-10-23T09:00:00Z'));
        await seedSession(page, 'C. Reen');
        await page.goto('/trains.html');
        await page.locator('[data-view="grid"]').click();
        await expect(page.locator('#trPattern .tr-grid-band')).toHaveText(['Main line', 'Aylesbury via Amersham']);
        const g = await page.locator('#trPattern .tr-grid-wrap').evaluate(wrap => {
            wrap.scrollLeft = wrap.scrollWidth;   // as far as it goes: about 120px at this width
            return {
                scrolled: wrap.scrollLeft,
                boxLeft: wrap.getBoundingClientRect().left,
                labels: [...wrap.querySelectorAll('.tr-grid-band td')].map(td => {
                    const range = document.createRange();
                    range.selectNodeContents(td);
                    return { text: (td.textContent || '').trim(), left: range.getBoundingClientRect().left };
                }),
            };
        });
        expect(g.scrolled, 'premise: the grid scrolls sideways at a phone width').toBeGreaterThan(100);
        for (const l of g.labels) {
            expect(Math.abs(l.left - g.boxLeft), `"${l.text}" scrolled away with the dots (${l.left}px, the box starts at ${g.boxLeft}px)`).toBeLessThanOrEqual(1);
        }
    });

    // "A TAB is a button" (css-tokens.md → Corners): Overtime's and New link's tabs are 12px; every strip
    // here — the views, the days, a station's direction, the grid's timetable — was on the 16px card-like
    // corner. Read from every tab on the page, shown or not, against the token as this page resolves it.
    test('every tab on the page wears the button corner', async ({ page }) => {
        await seedSession(page, 'C. Reen');
        await page.goto('/trains.html');
        await expect(page.locator('.tr-tab').first()).toBeVisible();
        const g = await page.evaluate(() => {
            const probe = document.body.appendChild(document.createElement('div'));
            probe.style.borderTopLeftRadius = 'var(--radius-button)';
            const button = getComputedStyle(probe).borderTopLeftRadius;
            probe.remove();
            const tabs = [...document.querySelectorAll('.tr-tab')];
            return { button, count: tabs.length, off: tabs.map(t => getComputedStyle(t).borderTopLeftRadius).filter(r => r !== button) };
        });
        expect(g.count, 'premise: the four strips\' tabs are all found').toBeGreaterThanOrEqual(10);
        expect(g.off, `every tab is on --radius-button (${g.button})`).toEqual([]);
    });

    // And every show-more button (v26.24): the dashed reveal — "Show N more", "Show the N that stay the same" — was on
    // --radius-sm, 8px under the page's 12px tabs and buttons. The two that ACT rather than reveal, "Change station"
    // and the grid's "Show every station", are Overtime's small outlined pill by design, and are left out.
    test('every show-more button on the page wears the button corner too', async ({ page }) => {
        // A WEEKDAY, pinned (21 Nov 2026): the page opens on today's timetable, and a Saturday has five
        // big changes or fewer, so on a weekend there was no "Show N more" to measure and this failed.
        await page.clock.setFixedTime(new Date('2026-10-07T09:00:00Z'));
        await seedSession(page, 'C. Reen');
        await page.goto('/trains.html');
        await expect(page.locator('#trHeadsMore')).toBeVisible();
        const g = await page.evaluate(() => {
            const probe = document.body.appendChild(document.createElement('div'));
            probe.style.borderTopLeftRadius = 'var(--radius-button)';
            const button = getComputedStyle(probe).borderTopLeftRadius;
            probe.remove();
            const more = [...document.querySelectorAll('.tr-more')].filter(t => !t.matches('.tr-change-station, .tr-grid-focus .tr-more'));
            return { button, count: more.length, off: more.map(t => `${t.id}: ${getComputedStyle(t).borderTopLeftRadius}`).filter(r => !r.endsWith(` ${button}`)) };
        });
        expect(g.count, 'premise: the page has its show-more buttons').toBeGreaterThanOrEqual(1);
        expect(g.off, `every show-more button is on --radius-button (${g.button})`).toEqual([]);
    });

    // A hover tint gated on WIDTH alone stays on a touch tablet's tapped row — the browser keeps :hover
    // on whatever was last touched. Every other hover in these sheets waits for a mouse; the grid's row
    // tint did not. Read from the stylesheet the page actually parsed, so a new rule is held to it too.
    test('every hover tint in the stylesheet waits for a mouse', async ({ page }) => {
        await seedSession(page, 'C. Reen');
        await page.goto('/trains.html');
        await expect(page.locator('.tr-tab').first()).toBeVisible();
        const g = await page.evaluate(() => {
            const sheet = [...document.styleSheets].find(s => s.href?.endsWith('/trains.css'));
            /** @type {string[]} */ const ungated = [];
            let hovers = 0;
            const walk = (/** @type {CSSRuleList} */ rules, /** @type {string[]} */ gates) => {
                for (const r of rules) {
                    if (r instanceof CSSMediaRule) walk(r.cssRules, [...gates, r.media.mediaText]);
                    else if (r instanceof CSSStyleRule) {
                        if (!r.selectorText.includes(':hover')) continue;
                        hovers++;
                        if (!gates.some(m => /\(hover:\s*hover\)/.test(m))) ungated.push(`${gates.join(' · ') || 'no gate'} → ${r.selectorText}`);
                    } else if (r instanceof CSSGroupingRule) walk(r.cssRules, gates);
                }
            };
            if (sheet) walk(sheet.cssRules, []);
            return { found: !!sheet, hovers, ungated };
        });
        expect(g.found && g.hovers >= 5, `premise: trains.css and its hover rules are read (${g.hovers})`).toBe(true);
        expect(g.ungated, 'a hover tint not gated on (hover: hover)').toEqual([]);
    });

    // Every view at phone width, with the widest content each holds open. The basic-hour grid
    // scrolls inside its own box, and v24.74 shipped with its screen-reader words escaping that box
    // and stretching the PAGE to 444px on a 390px phone — the whole page scrolled sideways.
    for (const width of [360, 390]) {
        test(`no view scrolls the page sideways at ${width}px`, async ({ page }) => {
            await page.setViewportSize({ width, height: 800 });
            // A weekday, pinned: the page opens on the real day's timetable, and the headlines
            // follow it. "to Aylesbury" is a Monday-to-Friday headline — Saturday's list is
            // Birmingham, Haddenham and a later last train to Hatton, Sunday's Banbury and
            // Birmingham — so an unpinned clock failed this test the first time the deploy's smoke
            // run fell on a weekend (Sat 24 Oct 2026), seventeen days after it was written.
            await page.clock.setFixedTime(new Date('2026-10-21T09:00:00Z'));
            await seedSession(page, 'G. Miller');
            await page.goto('/trains.html');
            const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
            // A card clips what it cannot hold, so a table too wide for it never scrolls the page: it
            // loses its right-hand column instead. That was "What changes", in 451 of 648 station views
            // at 375px, with the line above green (v24.83). So measure the card's contents against its edge.
            const clipped = () => page.evaluate(() => {
                const edge = /** @type {HTMLElement} */ (document.getElementById('trStationsCard')).getBoundingClientRect().right;
                return Math.max(0, ...[...document.querySelectorAll('#trStation *')].map(e => e.getBoundingClientRect().right - edge));
            });
            await expect(page.locator('#trChanges .tr-head').first()).toBeVisible();
            await openLookup(page);
            await page.locator('#trLookupInput').fill('1036');
            await expect(page.locator('#trLookupResult .tr-answer').first()).toBeVisible();   // the answer waits for typing to pause
            expect(await overflow(), 'What’s changing').toBeLessThanOrEqual(1);
            await page.locator('#trChanges .tr-head', { hasText: 'to Aylesbury' }).click();
            await page.locator('#trStation .tr-route-sum').click();
            await page.locator('#trAllTrains').click();
            expect(await overflow(), 'a station, every train').toBeLessThanOrEqual(1);
            expect(await clipped(), 'a station, every train').toBeLessThanOrEqual(1);
            // Banbury coming back holds the widest of them: a London arrival under every time, and
            // "Same time, gets in 11 mins later".
            await findStation(page, 'banbury');
            await page.locator('#trStationInput').press('Enter');
            await page.locator('[data-sdir="arr"]').click();
            // "Train by train" is still open from Aylesbury — it stays as the member left it (`showTrains`).
            await expect(page.locator('#trStation .tr-route')).toHaveAttribute('open', '');
            await page.locator('#trAllTrains').click();
            await expect(page.locator('#trStation .tr-trains')).toContainText('Same time, gets in 11 mins later');
            expect(await clipped(), 'Banbury coming back, every train').toBeLessThanOrEqual(1);
            await page.locator('[data-view="grid"]').click();
            for (const mode of ['now', 'dec']) {
                await page.locator(`[data-grid="${mode}"]`).click();
                await expect(page.locator('#trPattern .tr-dot').first()).toBeVisible();
                expect(await overflow(), `basic hour, ${mode}`).toBeLessThanOrEqual(1);
            }
        });
    }

    test('every member is offered the pill, and the pill opens the page (live for everyone, v24.81)', async ({ page }) => {
        // C. Reen holds no role at all: what they get, every member gets. Until v24.81 the pill was
        // the admin's only and this same visit was sent back to the roster.
        await seedSession(page, 'C. Reen');
        await page.goto('/settings.html');
        await page.locator('#navMenuBtn').click();
        await page.locator('.nav-panel-pill--trains').click();
        await expect(page).toHaveURL(/trains\.html/);
        // The view tabs are on every view and in every phase; the changes headline is not — from 11 Jan 2027 the page opens on Stations (v24.96).
        await expect(page.locator('#trControls')).toBeVisible();
        await expect(page.locator('#loginOverlay')).toBeHidden();
    });
});


test.describe('trains — the eight improvements (v24.94)', () => {
    const PLANNER = /nationalrail\.co\.uk\/journey-planner/;

    // The first of the eight was a caveat line worded for the phase, with the planner as its link. It went
    // at v25.13 (owner, 2 Nov 2026: "This is the confirmed final timetable"), in EVERY phase — so each
    // phase below now checks the line is absent — and its planner link moved into the overview's ? panel.
    test('no caveat line in any phase; the first tab follows the phase; the planner is in the ? panel, and the ended note', async ({ page }) => {
        const caveat = page.locator('#trCaveat');
        await seedSession(page, 'G. Miller');
        await page.clock.setFixedTime(new Date('2026-10-23T09:00:00Z'));
        await page.goto('/trains.html');
        await expect(page.locator('#trChangesTab')).toHaveText('What’s changing');
        await expect(caveat).toHaveCount(0);
        await page.locator('.btn-card-tips[data-card="overview"]').click();
        const planner = page.locator('#tipsLightbox a', { hasText: 'the journey planner' });
        await expect(planner).toHaveAttribute('href', PLANNER);
        await expect(planner).toHaveAttribute('rel', /noopener/);
        await expect(page.locator('#tipsLightbox')).not.toContainText('can still change');
        // Running, through the festive changes: the warning is about Christmas, and the first tab is past tense.
        // (Each phase is a fresh navigation with the clock set first and the session re-seeded: the seeded
        // session expires by the real clock, so the page's guard clears it once the pinned date is past
        // it, and the next navigation would land on the sign-in — the page unrendered, not wrong.)
        await page.clock.setFixedTime(new Date('2026-12-20T10:00:00Z'));
        await seedSession(page, 'G. Miller');
        await page.goto('/trains.html');
        await expect(page.locator('#trChangesTab')).toHaveText('What changed');
        await expect(caveat).toHaveCount(0);
        await expect(page.locator('#trChangesTitle')).toHaveText('What changed');
        await expect(page.locator('[data-view="changes"]')).toHaveAttribute('aria-pressed', 'true');
        // Settled: not live running.
        await page.clock.setFixedTime(new Date('2027-01-11T09:00:00Z'));
        await seedSession(page, 'G. Miller');
        await page.goto('/trains.html');
        await expect(page.locator('#trControls')).toBeVisible();
        await expect(caveat).toHaveCount(0);
        // Ended.
        await page.clock.setFixedTime(new Date('2027-05-17T09:00:00Z'));
        await seedSession(page, 'G. Miller');
        await page.goto('/trains.html');
        await expect(caveat).toHaveCount(0);
        // The end still says so, with the planner — the overview's own note, the overview open again by then.
        await expect(page.locator('#trEnded')).toBeVisible();
        await expect(page.locator('#trEnded a')).toHaveAttribute('href', PLANNER);
    });

    // OPENED, not just present in the markup (whole-app review, Nov 2026). The test above this line
    // used to stop at the markup, so for three weeks nothing noticed the drawer logo had never opened
    // the panel: trains-app.js kept the OBJECT initAboutLightbox returns and called it as a function,
    // which threw — and the Trains tips send staff to exactly this panel for the live boards.
    test('the drawer logo opens the About panel, and the header logo goes home', async ({ page }) => {
        const errors = collectFatalErrors(page);
        await seedSession(page, 'G. Miller');
        await page.goto('/trains.html');
        await page.locator('#navMenuBtn').click();
        await page.locator('#navPanelBrand').click();
        await expect(page.locator('#iconLightbox.open')).toBeVisible();
        await expect(page.locator('#iconLightbox a[href*="nationalrail.co.uk/live-trains"]')).toBeVisible();
        await page.locator('#iconLightboxClose').click();
        await expect(page.locator('#iconLightbox.open')).toHaveCount(0);
        // The header logo is labelled "Back to calendar", and until v25.06 nothing wired it here.
        await expect(page.locator('#appIcon')).toHaveAttribute('role', 'button');
        await page.locator('#appIcon').click();
        await expect(page).not.toHaveURL(/trains\.html/);
        expect(errors, 'no uncaught error on the way').toEqual([]);
    });

    test('the About panel links to the live departure boards, in a new tab', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await page.goto('/trains.html');
        const live = page.locator('#iconLightbox a[href*="nationalrail.co.uk/live-trains"]');
        await expect(live).toHaveAttribute('target', '_blank');
        await expect(live).toHaveAttribute('rel', /noopener/);
        await expect(page.locator('#iconLightbox a[href*="chilternrailways.co.uk/live-train-times"]')).toHaveCount(1);
    });

    test('the station looked at last is remembered: first among the chips, and where the page opens once it opens on Stations', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await page.clock.setFixedTime(new Date('2026-10-23T09:00:00Z'));
        await page.goto('/trains.html');
        await page.locator('[data-view="stations"]').click();
        await expect(page.locator('#trStationPicks .tr-picks-label'), 'nothing remembered yet').toHaveText(['Busiest stations']);
        await findStation(page, 'beac');
        await page.locator('#trStationPicks .tr-pick', { hasText: 'Beaconsfield' }).click();
        await expect(page.locator('#trStationTitle')).toHaveText('Beaconsfield');
        expect(await page.evaluate(() => localStorage.getItem('myb_trains_station'))).toBe('BCF');
        await page.reload();
        await page.locator('[data-view="stations"]').click();
        await expect(page.locator('#trStationPicker')).toBeVisible();     // before the change the page still opens on the list
        await expect(page.locator('#trStationPicks .tr-picks-label').first()).toHaveText('You looked at');
        await expect(page.locator('#trStationPicks .tr-pick').first()).toHaveText('Beaconsfield');
        expect(await page.locator('#trStationPicks .tr-pick', { hasText: /^Beaconsfield$/ }).count(), 'offered once, not twice').toBe(1);
        // From 11 January the page opens on Stations — on the remembered station, with the picker folded.
        await page.clock.setFixedTime(new Date('2027-01-11T09:00:00Z'));
        await seedSession(page, 'G. Miller');       // the seeded session expires by the real clock (see the caveat test)
        await page.goto('/trains.html');
        await expect(page.locator('[data-view="stations"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#trStationTitle')).toHaveText('Beaconsfield');
        await expect(page.locator('#trStationPicker')).toBeHidden();
        await expect(page.locator('#trStationChange')).toBeVisible();
    });

    test('the lookup shows two identical near lists once, and marks a train only one timetable has', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await page.clock.setFixedTime(new Date('2026-10-23T09:00:00Z'));
        await page.goto('/trains.html');
        await openLookup(page);
        await page.locator('[data-day="SO"]').click();
        await page.locator('#trLookupInput').fill('1716');
        const result = page.locator('#trLookupResult');
        await expect(result).toContainText('the same trains in both timetables');
        await expect(result.locator('.tr-near-cols--one')).toHaveCount(1);
        await expect(result.locator('.tr-near-head')).toHaveCount(0);
        await page.locator('[data-day="SX"]').click();
        await page.locator('#trLookupInput').fill('1036');
        await expect(result.locator('.tr-near-head')).toHaveCount(2);
        expect(await result.locator('.tr-near-only').count(), 'the 10:36 differs between the two').toBeGreaterThan(0);
        await expect(result.locator('.tr-near-only .sr-only').first()).toHaveText(/only in this timetable/);
    });

    test('Last trains: every station\'s last train from Marylebone, now beside December, banded by line', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await page.clock.setFixedTime(new Date('2026-10-23T09:00:00Z'));
        await page.goto('/trains.html');
        await page.locator('[data-view="stations"]').click();
        await expect(page.locator('#trLastCard')).toBeVisible();
        await expect(page.locator('#trLastBody')).not.toHaveClass(/\bopen\b/);   // folded until asked
        await expect(page.locator('#trLastHint')).toHaveText('Weekdays: the last train from Marylebone to every station');
        await page.locator('#trLastChevron').click();
        const rows = page.locator('#trLast .tr-last tbody tr:not(.tr-last-band)');
        expect(await rows.count()).toBeGreaterThan(20);
        await expect(page.locator('#trLast .tr-last-band').first()).toHaveText('Main line');
        await expect(page.locator('#trLast .tr-last-band').nth(1)).toHaveText('Aylesbury via Amersham');
        const beaconsfield = rows.filter({ has: page.locator('th', { hasText: /^Beaconsfield$/ }) });
        await expect(beaconsfield).toContainText('00:10');
        await expect(beaconsfield.locator('.tr-chip')).toHaveCount(0);           // unchanged: a quiet row
        // The day tabs drive it: on Saturdays at least one station's last train moves, and says by how much.
        await page.locator('[data-day="SO"]').click();
        await expect(page.locator('#trLastHint')).toHaveText('Saturdays: the last train from Marylebone to every station');
        expect(await page.locator('#trLast .tr-chip--moved').count()).toBeGreaterThan(0);
        await expect(page.locator('#trLast .tr-chip--moved').first()).toHaveText(/^\d+ mins? (later|earlier)$/);
    });

    // The desktop's "Jump to a station" card is part of Find a train since the two lookups became one (Nov 2026):
    // its chips sit under the box, on a wide screen only, and still open a station's card in one click.
    test('the desktop jump chips: the busiest stations under the lookup box, on a wide screen only', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await page.clock.setFixedTime(new Date('2026-10-23T09:00:00Z'));
        await page.goto('/trains.html');
        const wide = (page.viewportSize()?.width ?? 0) >= 1024;
        const card = page.locator('#trJump');
        await expect(page.locator('#trLookupCard #trJumpPicks')).toHaveCount(1);
        if (!wide) { await expect(card).toBeHidden(); return; }
        await expect(card).toBeVisible();
        const first = page.locator('#trJumpPicks .tr-pick').first();
        const name = await first.textContent();
        await first.click();
        await expect(page.locator('[data-view="stations"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#trStationTitle')).toHaveText(name ?? '');
        await expect(page.locator('#trStation .tr-verdict')).toBeVisible();
    });

    test('the Calendar\'s timetable notice opens in its final week, and its link opens this page', async ({ page }) => {
        const errors = collectFatalErrors(page);
        await page.clock.setFixedTime(new Date('2026-12-07T09:00:00Z'));
        await seedSession(page, 'C. Reen');
        await seedMemberSession(page, 'C. Reen');
        await seedMember(page, 'C. Reen');
        await clearNoticeFlags(page);
        // The install notice is still live in December; this device answered it, so the timetable notice is the only one due.
        await page.addInitScript(() => localStorage.setItem('myb_notice_install_app_2026_done', '1'));
        await page.goto('/');
        const notice = page.locator('#timetableSoonNoticeLb');
        await expect(notice).toHaveClass(/\bopen\b/, { timeout: 15_000 });
        await expect(notice).toContainText('The new timetable starts on Sunday');
        await page.locator('#timetableSoonNoticeGo').click();
        await expect(page).toHaveURL(/trains\.html/);
        const archived = await page.evaluate(() =>
            JSON.parse(localStorage.getItem('myb_app_notices') || '[]').map((/** @type {{ id: string }} */ n) => n.id));
        expect(archived).toContain('timetable-soon-2026');
        expect(errors).toHaveLength(0);
    });

    // ── the 72-hour review (v24.96) ────────────────────────────────────────────────────────────

    test('a tab that sleeps over midnight wakes on today\'s kind of day, unless a day was chosen', async ({ page }) => {
        await page.clock.setFixedTime(new Date('2026-10-23T22:00:00Z'));   // a Friday evening
        await seedSession(page, 'G. Miller');
        await page.goto('/trains.html');
        await expect(page.locator('[data-day="SX"]')).toHaveAttribute('aria-pressed', 'true');
        const wake = async () => page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.clock.setFixedTime(new Date('2026-10-24T08:00:00Z'));   // Saturday morning, same tab
        await wake();
        await expect(page.locator('[data-day="SO"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#trChangesHint')).toContainText('Saturdays');
        // A chosen day is kept: pick Sundays, sleep into Monday, wake — still Sundays.
        await page.locator('[data-day="SU"]').click();
        await page.clock.setFixedTime(new Date('2026-10-26T08:00:00Z'));
        await wake();
        await expect(page.locator('[data-day="SU"]')).toHaveAttribute('aria-pressed', 'true');
    });

    test('a remembered station that is not in the table is ignored when the page would open on it', async ({ page }) => {
        await page.clock.setFixedTime(new Date('2027-01-12T09:00:00Z'));   // settled: the page opens on Stations
        await seedSession(page, 'G. Miller');
        await page.addInitScript(() => localStorage.setItem('myb_trains_station', 'XXX'));
        await page.goto('/trains.html');
        await expect(page.locator('[data-view="stations"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#trStationInput')).toBeVisible();        // the picker, not a card titled "XXX"
        await expect(page.locator('#trStation .tr-verdict')).toHaveCount(0);
        await expect(page.locator('#trStationTitle')).not.toContainText('XXX');
    });

    test('the other timetable lets a chosen column go', async ({ page }) => {
        await page.clock.setFixedTime(new Date('2026-10-21T09:00:00Z'));
        await seedSession(page, 'G. Miller');
        await page.goto('/trains.html');
        await page.locator('[data-view="grid"]').click();
        await page.locator('[data-grid="dec"]').click();
        await page.locator('#trPattern .tr-grid-colbtn').first().click();
        await expect(page.locator('#trPattern .tr-grid-colbtn[aria-pressed="true"]')).toHaveCount(1);
        await page.locator('[data-grid="now"]').click();
        await expect(page.locator('#trPattern .tr-grid-colbtn[aria-pressed="true"]')).toHaveCount(0);
    });
});

// ── THE HEADINGS' COPY STAYS ON ITS COLUMNS THROUGH A RUBBER-BAND (7 Nov 2026, iPhone audit) ─────
//
// iOS reports a scrollLeft OUTSIDE the box's range while it bounces at either end of the grid —
// below 0 at the start, past the last column at the end — and the fixed copy of the heads
// (trains-grid-mirror.js) followed the raw figure off its columns. No desktop engine bounces, so
// the out-of-range figure is supplied by hand: the box's own `scrollLeft` is made to report it,
// and the real scroll listener and `place()` do the rest.
test.describe('trains — the heads copy is clamped to the grid', () => {
    test('a scroll reported past either end leaves the copy on the first or the last column', async ({ page }) => {
        await page.setViewportSize({ width: 393, height: 727 });
        await page.clock.setFixedTime(new Date('2026-10-23T09:00:00Z'));
        await seedSession(page, 'C. Reen');
        await page.goto('/trains.html');
        await page.locator('[data-view="grid"]').click();
        await expect(page.locator('#trPattern .tr-dot').first()).toBeVisible();
        const stick = page.locator('#trPattern .tr-grid-stick');
        await page.locator('#trPattern .tr-grid tbody tr', { hasText: 'Banbury' }).scrollIntoViewIfNeeded();
        await page.evaluate(() => window.scrollBy(0, 120));
        await expect(stick).toBeVisible();

        const max = await page.locator('#trPattern .tr-grid-wrap').evaluate(w => w.scrollWidth - w.clientWidth);
        expect(max, 'the grid fits its box at this width — there is nothing to scroll sideways').toBeGreaterThan(40);

        /** Make the box report `left` (null: its real value) and fire its scroll, as a bounce does.
         *  @param {number|null} left */
        const report = (left) => page.locator('#trPattern .tr-grid-wrap').evaluate((w, l) => {
            if (l === null) delete /** @type {any} */ (w).scrollLeft;
            else Object.defineProperty(w, 'scrollLeft', { configurable: true, get: () => l });
            w.dispatchEvent(new Event('scroll'));
        }, left);
        const slid = () => page.locator('#trPattern .tr-grid-stick-row').evaluate(r => /** @type {HTMLElement} */ (r).style.transform);

        // In range it follows the grid exactly. Each step below must CHANGE the value, so a poll can
        // never pass on a frame that has not been drawn yet.
        await page.locator('#trPattern .tr-grid-wrap').evaluate(w => { w.scrollLeft = 30; });
        await expect.poll(slid).toBe('translateX(-30px)');

        await report(-40);                       // the bounce at the start
        await expect.poll(slid, { message: 'the copy slid right, off the first column' }).toBe('translateX(0px)');

        await report(max + 40);                  // and at the end
        await expect.poll(slid, { message: 'the copy slid left, past the last column' }).toBe(`translateX(-${max}px)`);

        await report(null);                      // the bounce settles: back to following the grid
        await expect.poll(slid).toBe('translateX(-30px)');
    });
});

// ── THE SWIPE LINE IS FOR A GRID THAT SCROLLS (8 Nov 2026) ───────────────────────────────────────────
//
// The line hid from 700px wide, so below that it told a reader to swipe a grid that fitted — measured
// at 600 and 699px, 10 of the 12 day-and-timetable grids fitted and every one showed it — and above
// 700px it was right only because no day's grid is wider. It now shows only while the grid scrolls
// sideways (overflow-hint.js): measured as the grid is drawn, and again when the box changes size,
// with no redraw. An iPhone SE is 375px wide upright and 667px on its side, inside that band.
test.describe('trains — the swipe line is for a grid that scrolls', () => {
    test('upright, the grid scrolls and the line says so; on its side it fits and the line goes; and back', async ({ page }, info) => {
        test.skip(!isTouchProject(info), 'the line is touch-only UI');
        await page.setViewportSize({ width: 375, height: 667 });
        await page.clock.setFixedTime(new Date('2026-10-07T09:00:00Z'));    // a Wednesday: Weekdays
        await seedSession(page, 'G. Miller');
        await page.goto('/trains.html');
        await page.locator('[data-view="grid"]').click();
        await expect(page.locator('#trPattern .tr-dot').first()).toBeVisible();
        const wrap = page.locator('#trPattern .tr-grid-wrap');
        const swipe = page.locator('#trPattern .tr-grid-swipe');
        const overflows = () => wrap.evaluate(w => w.scrollWidth > w.clientWidth + 1);

        expect(await overflows(), 'premise: upright, the weekday grid is wider than the screen').toBe(true);
        await expect(swipe, 'a grid that scrolls is not explained').toBeVisible();

        await page.setViewportSize({ width: 667, height: 375 });            // the same grid, turned
        await expect.poll(overflows, { message: 'premise: on its side, the grid fits' }).toBe(false);
        await expect(swipe, 'turned in place, the grid stopped scrolling and the line stayed').toBeHidden();

        await page.locator('[data-day="SO"]').click();                      // a fresh draw, on its side
        await expect(page.locator('[data-day="SO"]')).toHaveAttribute('aria-pressed', 'true');
        expect(await overflows(), 'premise: drawn on its side, Saturdays fit').toBe(false);
        await expect(swipe, 'a grid drawn to fit was offered a swipe').toBeHidden();

        await page.setViewportSize({ width: 375, height: 667 });            // and upright again
        await expect.poll(overflows, { message: 'premise: upright, it scrolls again' }).toBe(true);
        await expect(swipe, 'upright again, the grid scrolls and the line did not come back').toBeVisible();

        // Paper cannot be swiped: printed, the line goes, as Team view's does.
        await page.emulateMedia({ media: 'print' });
        await expect(swipe, 'the printout told its reader to swipe the paper').toBeHidden();
        await page.emulateMedia({ media: null });
    });

    test('a mouse is not told to swipe, however narrow the window', async ({ page }, info) => {
        test.skip(isTouchProject(info), 'the line is touch-only UI: a fine pointer never sees it');
        await page.setViewportSize({ width: 390, height: 844 });
        await page.clock.setFixedTime(new Date('2026-10-07T09:00:00Z'));
        await seedSession(page, 'G. Miller');
        await page.goto('/trains.html');
        await page.locator('[data-view="grid"]').click();
        await expect(page.locator('#trPattern .tr-dot').first()).toBeVisible();
        expect(await page.locator('#trPattern .tr-grid-wrap').evaluate(w => w.scrollWidth > w.clientWidth + 1),
            'premise: the grid scrolls').toBe(true);
        await expect(page.locator('#trPattern .tr-grid-swipe')).toBeHidden();
    });
});

// ── THE iPHONE KEYBOARD AND TOUCH (iPhone audit, 7 Nov 2026) ─────────────────────────────────────────

test('the header logo — the installed app\'s way back — opens no image menu when held', async ({ page }) => {
    // On a sub-page the logo is the only Back an iPhone home-screen app has, and holding it opened
    // iOS's image menu (Save to Photos, Copy, Share). `user-select` is read off the element in both
    // engines. `-webkit-touch-callout` is iOS's own property — neither test engine parses it, so the
    // computed style cannot carry it — and is read from the stylesheet the page actually loaded.
    await seedSession(page, 'G. Miller');
    await page.goto('/trains.html');
    const logo = page.locator('#appIcon');
    await expect(logo).toBeVisible();
    expect(await logo.evaluate(el => getComputedStyle(el).userSelect), 'holding the logo starts a text selection')
        .toBe('none');
    const rule = await page.evaluate(async () => {
        const css = await (await fetch('./shared.css')).text();
        return css.replace(/\/\*[\s\S]*?\*\//g, '').match(/\.app-header img,\s*\.app-icon\s*\{([^}]*)\}/)?.[1] ?? '';
    });
    expect(rule, 'the header-logo rule was not found in shared.css, so this checks nothing').not.toBe('');
    expect(rule, 'holding the logo opens iOS\'s image menu').toMatch(/-webkit-touch-callout:\s*none/);
});

test('the station and time boxes keep what is typed into them', async ({ page }) => {
    // iOS autocorrects the word before a space unless the field says not to: a half-typed station
    // became a dictionary word, and its matches with it. Enter opens the first match, so the key says Go.
    // The static scan (select-sheet-parity.test.mjs, contract 14) holds every search box; this is the
    // markup the page actually serves.
    await seedSession(page, 'G. Miller');
    await page.goto('/trains.html');
    const station = page.locator('#trStationInput');
    await expect(station).toHaveAttribute('autocorrect', 'off');
    await expect(station).toHaveAttribute('autocapitalize', 'none');
    await expect(station).toHaveAttribute('enterkeyhint', 'go');
    await expect(page.locator('#trLookupInput')).toHaveAttribute('autocorrect', 'off');
});

// ── ON A DESKTOP (desktop audit, Nov 2026) ───────────────────────────────────────────────────────────

test('a changes row and a column head say they can be pressed under a mouse, and the chosen column keeps its look', async ({ page }, info) => {
    // Both are buttons, and both looked the same pointed at as not. Hover is a fine-pointer surface.
    test.skip(isTouchProject(info), 'hover is a fine-pointer surface');
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.clock.setFixedTime(new Date('2026-10-21T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    await page.goto('/trains.html');
    const row = page.locator('.tr-head').first();
    await expect(row).toBeVisible();
    const look = () => row.evaluate(b => [getComputedStyle(b).borderTopColor,
        getComputedStyle(/** @type {Element} */ (b.querySelector('.tr-head-go'))).color].join(' | '));
    await page.mouse.move(1, 1);
    const idle = await look();
    await row.hover();
    expect(await look(), 'a changes row looks the same pointed at').not.toBe(idle);

    await page.locator('[data-view="grid"]').click();
    const heads = page.locator('#trPattern thead th.tr-grid-colhead');
    await expect(heads.first()).toBeVisible();
    const fill = (/** @type {import('@playwright/test').Locator} */ th) => th.evaluate(el => [getComputedStyle(el).backgroundColor, getComputedStyle(el).boxShadow].join(' | '));
    await page.mouse.move(1, 1);
    const idleHead = await fill(heads.nth(1));
    await heads.nth(1).hover();
    expect(await fill(heads.nth(1)), 'a column head looks the same pointed at').not.toBe(idleHead);
    // Chosen, a column keeps the look its choice gave it, pointer or no pointer.
    await heads.nth(1).locator('.tr-grid-colbtn').click();
    await expect(heads.nth(1)).toHaveClass(/tr-col-on/);
    await page.mouse.move(1, 1);
    const chosen = await fill(heads.nth(1));
    await heads.nth(1).hover();
    expect(await fill(heads.nth(1)), 'hover repainted the chosen column').toBe(chosen);
});

test('the trains-a-day box reaches the right-hand edge the blocks around it share on a desktop', async ({ page }) => {
    // Held to a phone's 340px, it stopped 64px short of its 404px column.
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.clock.setFixedTime(new Date('2026-10-21T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    await page.goto('/trains.html');
    await expect(page.locator('#trTotals .tr-totals-days')).toBeVisible();
    const edge = await page.evaluate(() => ({
        box: /** @type {Element} */ (document.querySelector('#trTotals .tr-totals-days')).getBoundingClientRect().right,
        column: /** @type {Element} */ (document.querySelector('.tr-ov-side')).getBoundingClientRect().right,
    }));
    expect(Math.abs(edge.box - edge.column), `box ends at ${edge.box}, its column at ${edge.column}`).toBeLessThanOrEqual(1);
});

// THE DAYS A FIGURE IS TRUE OF (external review, 18 Nov 2026). The totals give each kind of weekday whose
// count differs its own row, and a card says what the other days have — a line under its answer, small print
// beside a figure. Named short ("Mon and Fri") in the totals because "Mondays and Fridays" needs 125px and
// pushed the counts out of their column on a 320px phone (measured): each row and cell is held to its box here,
// at a phone's narrowest and with a phone's larger text. The text is enlarged ONCE per page load: `scaleText`
// multiplies whatever size an element already has, so a second call on the same page compounds.
test('the weekday rows, a card\'s other-day lines and its small print stay inside their boxes on a phone, with larger text too', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-21T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    /** Text that leaves the box it is laid out in, for each element `sel` matches. @param {string} sel */
    const spills = (sel) => page.locator(sel).evaluateAll(els => els.flatMap((box) => {
        const rects = [], walk = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
            if (!n.textContent?.trim() || n.parentElement?.closest('.sr-only')) continue;
            const r = document.createRange(); r.selectNodeContents(n); rects.push(...r.getClientRects());
        }
        const b = box.getBoundingClientRect();
        const out = Math.max(0, ...rects.map(r => Math.max(b.left - r.left, r.right - b.right)));
        return out > 1 ? [`"${box.textContent?.trim()}" leaves its box by ${out.toFixed(1)}px`] : [];
    }));
    /** In each totals row, the day, its figures and the change never drawn over one another — side by side, or the
     *  day above its figures where the text is too large for one line (trains.css, "A phone's larger text"). */
    const overlaps = () => page.locator('#trTotals .tr-total').evaluateAll(rows => rows.flatMap((row) => {
        const boxes = ['.tr-total-day', '.tr-total-n', '.tr-delta'].map(c => row.querySelector(c)?.getBoundingClientRect()).filter(b => !!b);
        const meet = (/** @type {DOMRect} */ a, /** @type {DOMRect} */ b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5
            && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
        const bad = boxes.some((a, i) => boxes.slice(i + 1).some(b => meet(/** @type {DOMRect} */ (a), /** @type {DOMRect} */ (b))));
        // …and the figures and their change are read together, on one line, whichever layout the row has.
        const [, n, delta] = boxes;
        const apart = n && delta && Math.abs(n.top + n.height / 2 - (delta.top + delta.height / 2)) > 3;
        return bad ? [`"${row.textContent?.trim()}" runs into itself`] : apart ? [`"${row.textContent?.trim()}": its change is not beside its figures`] : [];
    }));
    for (const [width, k] of [[320, 1], [320, 1.3], [375, 1.3]]) {
        const at = `at ${width}px${k === 1 ? '' : ` with the text ${k} times larger`}`;
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/trains.html');
        // The overview folds away after a first visit; open it, so the rows measured are rows drawn.
        if (!(await page.locator('#trOverviewBody').evaluate(e => e.classList.contains('open')))) await page.locator('#trOverviewChevron').click();
        await expect(page.locator('#trTotals .tr-total')).toHaveCount(4);
        await expect(page.locator('#trTotals .tr-total').last()).toBeVisible();
        if (k !== 1) await scaleText(page, k);
        expect(await spills('#trTotals .tr-total-day, #trTotals .tr-total-n, #trTotals .tr-delta'), `${at}: the totals`).toEqual([]);
        expect(await overlaps(), `${at}: the totals`).toEqual([]);
        for (const [name, dir] of [['Princes Risborough', 'dep'], ['Beaconsfield', 'arr']]) {
            await page.goto('/trains.html');
            await page.locator('[data-view="stations"]').click();
            await findStation(page, name.toLowerCase());
            await page.locator('#trStationPicks .tr-pick', { hasText: name }).first().click();
            await page.locator(`[data-sdir="${dir}"]`).click();
            await expect(page.locator('#trStation .tr-verdict-also')).toBeVisible();
            await expect(page.locator('#trStation .tr-st-table .tr-days')).toHaveCount(dir === 'arr' ? 2 : 1);
            if (k !== 1) await scaleText(page, k);
            expect(await spills('#trStation .tr-verdict, #trStation .tr-st-table td'), `${at}: ${name}`).toEqual([]);
            const [also] = await page.locator('#trStation .tr-verdict-also').evaluateAll(els => els.map(e => e.getBoundingClientRect().top - /** @type {Element} */ (e.parentElement).getBoundingClientRect().top));
            expect(also, `${at}: ${name}'s other-day line sits under the answer, inside its box`).toBeGreaterThan(10);
        }
    }
});

// A PHONE'S LARGER TEXT (18 Nov 2026). Android's text size scales every font and leaves the screen as wide as
// it was. At 1.3 times on a 320px phone the Day control ran 23px off the screen on every view, so the page
// scrolled sideways; at 1.5 times it was 62px, and 22px on a 360px phone; the train list's heads and the two
// weekday totals ran past their boxes too. trains.css fixes each with a container query in em ("is this box
// narrow for its text?"), which no width query can ask — this holds every one of them, in each engine. Widths
// are read against the LAYOUT viewport (clientWidth): an emulated phone zooms out to fit a page that is too
// wide, which makes innerWidth grow with the overflow and hides it. Measured and NOT held: 1.75 times on a
// 320px phone and 2 times below 412px, where the train list itself would need another layout.
test('no view of the page runs off a phone\'s screen with larger text', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-21T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    /** Anything past the screen's edge, or past the edge of a box that clips it — never inside a frame that scrolls. */
    const cutOff = () => page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const clipper = (/** @type {Element} */ e) => {
            for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
                const o = getComputedStyle(p).overflowX;
                if (o === 'auto' || o === 'scroll') return null;
                if (o === 'hidden' || o === 'clip') return p;
            }
            return null;
        };
        const bad = [];
        for (const e of document.querySelectorAll('main *')) {
            if (!e.getClientRects().length || e.closest('.sr-only')) continue;
            const r = e.getBoundingClientRect();
            const box = clipper(e);
            if (!box && getComputedStyle(e).position !== 'fixed' && r.right > vw + 1) bad.push(`"${(e.textContent || '').trim().slice(0, 30)}" runs ${Math.round(r.right - vw)}px off the screen`);
            else if (box && r.right > box.getBoundingClientRect().right + 1) bad.push(`"${(e.textContent || '').trim().slice(0, 30)}" is cut off by ${Math.round(r.right - box.getBoundingClientRect().right)}px`);
        }
        return [...new Set(bad)].slice(0, 5);
    });
    const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    /** @param {number} width @param {number} k @param {'changes'|'stations'} view */
    const open = async (width, k, view) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/trains.html');
        if (view === 'changes') {
            if (!(await page.locator('#trOverviewBody').evaluate(e => e.classList.contains('open')))) await page.locator('#trOverviewChevron').click();
            await expect(page.locator('#trTotals .tr-total').last()).toBeVisible();
        } else {
            await page.locator('[data-view="stations"]').click();
            await findStation(page, 'beaconsfield');
            await page.locator('#trStationPicks .tr-pick', { hasText: 'Beaconsfield' }).first().click();
            await page.locator('[data-sdir="arr"]').click();
            await page.locator('#trStation .tr-route-sum').click();
            await expect(page.locator('#trStation .tr-trains tbody tr').first()).toBeVisible();
        }
        if (k !== 1) await scaleText(page, k);
    };
    // Premise, so a pass cannot come from somewhere else: the Day label is there at the normal size, and the
    // container query takes it away at 1.3 times on a 320px phone — in this engine.
    await open(320, 1, 'changes');
    await expect(page.locator('.tr-seg-label')).toBeVisible();
    await open(320, 1.3, 'changes');
    await expect(page.locator('.tr-seg-label')).toBeHidden();
    for (const [width, k] of [[320, 1.3], [320, 1.5], [360, 1.5], [412, 1.75]]) {
        for (const view of /** @type {const} */ (['changes', 'stations'])) {
            await open(width, k, view);
            const at = `${view} at ${width}px with the text ${k} times larger`;
            expect(await cutOff(), at).toEqual([]);
            expect(await sideways(), `${at}: the page scrolls sideways`).toBe(0);
        }
    }
    // The Day control's steps, each held: at 1.5 times on a 320px phone its segments tighten and stay on ONE line
    // (the wrap below is for when even that cannot fit), and at 2 times they wrap inside the track rather than
    // run off the screen.
    const dayTabs = () => page.locator('.tr-tabs--seg .tr-tab').evaluateAll(tabs => tabs.map(t => {
        const r = t.getBoundingClientRect();
        return { top: Math.round(r.top), right: r.right, vw: document.documentElement.clientWidth };
    }));
    await open(320, 1.5, 'changes');
    expect(new Set((await dayTabs()).map(t => t.top)).size, 'the Day segments at 1.5 times on a 320px phone: one line').toBe(1);
    await open(320, 2, 'changes');
    expect((await dayTabs()).filter(t => t.right > t.vw + 1), 'the Day segments at 2 times on a 320px phone: on the screen').toEqual([]);
    // At 1.75 times on a 320px phone the train list is past help, but a station's figures are not: a figure's
    // label may break inside a word ("Beaconsfield") rather than push the table off the card.
    await open(320, 1.75, 'stations');
    expect(await page.locator('#trStation .tr-st-table').evaluate(t => t.getBoundingClientRect().right - /** @type {Element} */ (t.closest('.card')).getBoundingClientRect().right),
        'the figures at 1.75 times on a 320px phone').toBeLessThanOrEqual(1);
});

// ── THE WHOLE-APP FIX (Nov 2026) ─────────────────────────────────────────────────────────────────────
// What only the page can show: that the coordinator hands each rule the right timetable, the right phase
// and the right names. The rules themselves are trains-stations.test.mjs's and trains-change.test.mjs's.
test.describe('trains — the page turns as a whole', () => {
    // From 13 December only the tab and the card's title turned: the section, its ? and its chevron, and the
    // ? panel's own title, went on saying "What’s changing" to a screen reader and under the tab.
    test('every name the changes view goes by turns with it at the change', async ({ page }) => {
        for (const [when, words] of [['2026-11-16T10:00:00Z', 'What’s changing'], ['2026-12-20T10:00:00Z', 'What changed']]) {
            await page.clock.setFixedTime(new Date(when));
            await seedSession(page, 'G. Miller');
            await page.goto('/trains.html');
            await expect(page.locator('#trChangesTab')).toHaveText(words);
            await expect(page.locator('#trViewChanges'), 'the section').toHaveAttribute('aria-label', words);
            await expect(page.locator('#trChangesTips'), 'its ?').toHaveAttribute('aria-label', `Tips for ${words.toLowerCase()}`);
            await expect(page.locator('#trChangesChevron'), 'its chevron').toHaveAttribute('aria-label', `Toggle ${words}`);
            await page.locator('#trChangesTips').click();
            await expect(page.locator('#tipsLbTitle'), 'the ? panel').toHaveText(words);
        }
        // and the Last trains card's chips are headed for a screen reader in the same tense
        await page.locator('#tipsLightboxClose').click();
        await page.locator('[data-view="stations"]').click();
        await expect(page.locator('#trLast .tr-last thead')).toContainText('What changed');
    });

    // The chips and the order of equal matches were counted on the first timetable for good, so from
    // 13 December they described the one that had stopped (busiest stations, and "bi" + Enter).
    test('the busiest stations, and the order of equal matches, are counted on the timetable running', async ({ page }) => {
        const names = (/** @type {string[]} */ codes) => codes.map(c => STATIONS[c]);
        const first = (/** @type {'now'|'dec'} */ side) => STATIONS[matchStations(STATIONS, 'bi', 6, busiestStations(TIMETABLES[side].SX.dep, Infinity))[0]];
        expect(first('now'), 'premise: the two timetables order "bi" differently').not.toBe(first('dec'));
        expect(busiestStations(TIMETABLES.now.SX.dep), 'premise: and their busiest weekday stations').not.toEqual(busiestStations(TIMETABLES.dec.SX.dep));
        for (const [when, side] of /** @type {[string, 'now'|'dec'][]} */ ([['2026-11-16T09:00:00Z', 'now'], ['2027-01-11T09:00:00Z', 'dec']])) {
            await page.clock.setFixedTime(new Date(when));      // two Mondays: before the change, and once it has settled
            await seedSession(page, 'G. Miller');
            await page.goto('/trains.html');
            await page.locator('[data-view="stations"]').click();
            await expect(page.locator('#trStationPicks .tr-pick'), `${side}: the chips`).toHaveText(names(busiestStations(TIMETABLES[side].SX.dep)));
            await page.locator('#trStationInput').fill('bi');
            await expect(page.locator('#trStationPicks .tr-pick').first(), `${side}: Enter opens`).toHaveText(first(side));
            await page.locator('[data-view="changes"]').click();
            await expect(page.locator('#trJumpPicks .tr-pick'), `${side}: the desktop's jump card`).toHaveText(names(busiestStations(TIMETABLES[side].SX.dep)));
        }
    });

    // A press redrew the view and not the overview, so a tab in view across 03:00 showed two dates at once.
    // Local times, no "Z": the page reads the browser's clock, and the browser and this file share a time zone.
    test('a press after 03:00 on the day of the change turns the overview with the view, and the day with them', async ({ page }) => {
        await page.clock.setFixedTime(new Date('2026-12-13T02:30:00'));   // still Saturday's railway day
        await seedSession(page, 'G. Miller');
        await page.goto('/trains.html');
        // The countdown names the calendar day, so on the Sunday it says "today" from midnight; this expected
        // "Starts tomorrow", the defect (it read as the Monday). The overview's own words still turn at 03:00.
        await expect(page.locator('#trCountdown')).toHaveText('Starts today');
        await expect(page.locator('#trLead')).toContainText('This page compares today’s timetable with the new one');
        await expect(page.locator('[data-day="SO"]')).toHaveAttribute('aria-pressed', 'true');
        await page.clock.setFixedTime(new Date('2026-12-13T03:30:00'));   // the change has come; the tab never slept
        await page.locator('[data-view="grid"]').click();
        await expect(page.locator('#trCountdown')).toHaveText('Starts today');
        await expect(page.locator('#trLead')).toContainText('This page compares the timetable that ran until Saturday 12 December');
        await expect(page.locator('#trGridNow'), 'the grid\'s first timetable is named for what it now is').toHaveText('Until 12 Dec');
        await expect(page.locator('[data-day="SU"]'), 'the day turned too: no day tab was pressed').toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#trPatternHint')).toContainText('Sundays');
    });

    // A PAGE LEFT IN VIEW TURNS BY ITSELF (whole-app check, Nov 2026). The page redrew only on a press, a
    // Back or the tab coming back into view, so a station computer's tab — never hidden — kept Saturday's
    // trains into Sunday morning: the lookup answered from them, and the countdown and day tab stayed put.
    // `runFor` is the page's own minute passing; Date stays where `setFixedTime` puts it.
    // The countdown is not among what turns at 03:00 any more: it names the calendar day, so at 02:30 on the Sunday
    // it already says "Starts today" — this test once expected "Starts tomorrow" there, which is the defect (it read
    // as the Monday). It turns at midnight instead ("a page left open over midnight turns its countdown then").
    test('a page left in view turns at 03:00 by itself: the day and the words with it', async ({ page }) => {
        await page.clock.setFixedTime(new Date('2026-12-13T02:30:00'));   // still Saturday's railway day
        await seedSession(page, 'A. Person');   // an invented member: the page admits any named session
        await page.goto('/trains.html');
        await expect(page.locator('#trCountdown'), 'the calendar day is the day of the change').toHaveText('Starts today');
        await expect(page.locator('[data-day="SO"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#trLead')).toContainText('This page compares today’s timetable with the new one');
        await page.clock.setFixedTime(new Date('2026-12-13T03:30:00'));   // the change has come; nothing pressed, never hidden
        await page.clock.runFor(60_000);
        await expect(page.locator('#trCountdown')).toHaveText('Starts today');
        await expect(page.locator('[data-day="SU"]'), 'the day turned without a press').toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#trChangesHint')).toContainText('Sundays');
        await expect(page.locator('#trLead')).toContainText('This page compares the timetable that ran until Saturday 12 December');
    });

    test('a time typed just after 03:00 is answered for the new day, before the page\'s minute comes round', async ({ page }) => {
        // A December train that runs on Sundays and not Saturdays: asked on Saturday's tab, it has no answer.
        const sat = new Set(TIMETABLES.dec.SO.dep.map(r => r[0]));
        const sunday = /** @type {string} */ (TIMETABLES.dec.SU.dep.map(r => r[0]).find(t => t >= '07:00' && !sat.has(t)));
        expect(sunday, 'premise: some December Sunday train has no Saturday twin').toBeTruthy();
        await page.clock.setFixedTime(new Date('2026-12-13T02:50:00'));
        await seedSession(page, 'A. Person');
        await page.goto('/trains.html');
        await expect(page.locator('[data-day="SO"]')).toHaveAttribute('aria-pressed', 'true');
        await openLookup(page);
        await page.clock.setFixedTime(new Date('2026-12-13T03:05:00'));
        await page.locator('#trLookupInput').fill(sunday);
        await expect(page.locator('#trLookupResult .tr-answer')).toContainText(`The ${sunday} to`);
        await expect(page.locator('#trLookupResult')).not.toContainText('No Saturday train');
        await expect(page.locator('[data-day="SU"]')).toHaveAttribute('aria-pressed', 'true');
    });

    // The overview opened on the ended message only when the page STARTED after the books ran out; a page
    // open across that night kept the card folded with the message inside it.
    test('a page left open past the end of December\'s books opens its overview on the message', async ({ page }) => {
        await page.clock.setFixedTime(new Date('2027-05-15T22:00:00'));   // the books' last day
        await seedSession(page, 'A. Person');
        await page.addInitScript(() => localStorage.setItem('myb_trains_overview_seen', '1'));
        await page.goto('/trains.html');
        await expect(page.locator('#trOverviewBody')).not.toHaveClass(/\bopen\b/);
        await expect(page.locator('#trEnded')).toBeHidden();
        await page.clock.setFixedTime(new Date('2027-05-16T03:30:00'));
        await page.clock.runFor(60_000);
        await expect(page.locator('#trCountdown')).toHaveText('Timetables ended');
        await expect(page.locator('#trOverviewBody')).toHaveClass(/\bopen\b/);
        await expect(page.locator('#trEnded')).toBeVisible();
    });

    // The ? panels were built once, at import: the Christmas and leaf-fall lines read in the present tense
    // from 11 January to May. They are read as each panel opens now, so they go when the page's notes go.
    test('the overview ? panel drops the lines about weeks that have ended, on a page left open across them', async ({ page }) => {
        await page.clock.setFixedTime(new Date('2027-01-10T20:00:00'));
        await seedSession(page, 'A. Person');
        await page.goto('/trains.html');
        const tips = page.locator('.btn-card-tips[data-card="overview"]');
        await tips.click();
        await expect(page.locator('#tipsLbBody')).toContainText('Christmas and New Year times are not on this page.');
        await expect(page.locator('#tipsLbBody')).toContainText('leaf-fall');
        await page.locator('#tipsLightboxClose').click();
        await expect(page.locator('#tipsLightbox')).toBeHidden();
        await page.clock.setFixedTime(new Date('2027-01-11T03:30:00'));
        await tips.click();
        await expect(page.locator('#tipsLbBody')).toContainText('Chiltern’s public timetables');
        await expect(page.locator('#tipsLbBody')).not.toContainText('Christmas');
        await expect(page.locator('#tipsLbBody')).not.toContainText('leaf-fall');
        await page.locator('#tipsLightboxClose').click();
        await page.clock.runFor(60_000);
        await expect(page.locator('#trFestive'), 'and the page\'s own Christmas line went with them').toBeHidden();
    });

    // THE TEARDOWN IS BOUNDED (72-hour check, 24 Nov 2026). While Trains asked `holdsStaffPin` it raced the
    // check against the access budget; the PIN's removal awaited the teardown outright, and the teardown
    // first awaits `authReady`, which never settles when the auth store is wedged. The card never came.
    test('a signed-out visit still gets the sign-in card when the auth layer never finishes starting', async ({ page }) => {
        test.setTimeout(60_000);
        await page.addInitScript(() => { window.__E2E = Object.assign(window.__E2E || {}, { authRestoreDelayMs: 120_000, authStartHangs: true }); });
        await page.goto('/trains.html');
        await expect(page.locator('#loginOverlay')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('#loginName')).toBeAttached();
    });

    test('a visitor who never held the PIN is told nothing about it', async ({ page }) => {
        await page.goto('/trains.html');
        await expect(page.locator('#loginOverlay')).toBeVisible();
        await page.waitForTimeout(1500);   // a teardown's line would be there well before this
        await expect(page.locator('#loginNotice')).toBeEmpty();
    });
});

// ── THE WORDS REVIEW (Nov 2026): the lookup and the cards through the real page ───────────────────────────────
test.describe('trains: the words review', () => {
    // "5 pm" passes through "5 ", which is no time: the box put up "Type a time like…" between the two answers, and
    // the polite live region read it out. The answer stands while the a.m. or p.m. is still to come — and a tail begun
    // is a time (24-hour check, 22 Nov 2026): kept as pending, "5.15p" left the 05:15 answer up beneath it.
    test('typing a p.m. keeps the answer on screen until it is begun, answers it then, and never shows the hint', async ({ page }) => {
        const errors = collectFatalErrors(page);
        await seedSession(page, 'G. Miller');
        await page.clock.setFixedTime(new Date('2026-11-18T09:00:00Z'));
        await page.goto('/trains.html');
        await openLookup(page);
        const input = page.locator('#trLookupInput'), result = page.locator('#trLookupResult');
        const first = result.locator('.tr-answer').first();
        await input.fill('5.15');
        await expect(result).toContainText('05:15');
        const held = await result.innerHTML();
        // A space, as the box receives it — one input event with the value it leaves: the p.m. is still to come.
        await input.fill('5.15 ');
        await page.waitForTimeout(400);   // past any debounce: what stands is what the box decided
        expect(await result.innerHTML(), '"5.15 " changed the answer').toBe(held);
        // Each way of beginning the tail is a time, answered as one: never the 05:15 answer under it.
        for (const value of ['5.15p', '5.15 p', '515p', '5.15pm']) {
            await input.fill(value);
            await expect(first, `"${value}"`).toContainText('The 17:15 to');
            await expect(result).not.toContainText('Type a time like');
        }
        await input.fill('515a');
        await expect(result).toContainText('05:15');
        await expect(result).not.toContainText('The 17:15 to');
        // A day pressed while the p.m. is pending answers for that day, not the kept one.
        await input.fill('5 ');
        await page.locator('[data-day="SO"]').click();
        await expect(result).toContainText('Type a time like');
        expect(errors, errors.join('\n')).toEqual([]);
    });

    test('the lookup says what a train at that time is in the other timetable, and what the bar beside a train means', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await page.clock.setFixedTime(new Date('2026-11-18T09:00:00Z'));
        await page.goto('/trains.html');
        await openLookup(page);
        const result = page.locator('#trLookupResult');
        await page.locator('#trLookupInput').fill('0931');
        await expect(result.locator('.tr-lead').first()).toHaveText('No weekday train leaves at exactly 09:31 in the current timetable. From 13 December the 09:31 is a new train to Stratford-upon-Avon.');
        await expect(result.locator('.tr-near-only').first()).toBeVisible();
        await expect(result.locator('.tr-note')).toHaveText('A bar at the left marks a train in only one of the two lists: a new train, one that stops running, or one whose time or destination is different.');
        await page.locator('#trLookupInput').fill('1637');
        await expect(result.locator('.tr-answer')).toContainText('The 16:37 to Stourbridge Junction: 4 mins later (16:41), will end at Birmingham Moor Street.');
    });

    test('the overview says what changed ON the day, and a station whose trains all keep their times lists them in one tap', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await page.clock.setFixedTime(new Date('2026-11-18T09:00:00Z'));
        await page.goto('/trains.html');
        await expect(page.locator('#trOverviewHint')).toHaveText('What changes at Marylebone from 13 December');
        await page.locator('[data-view="stations"]').click();
        await findStation(page, 'little kimble');
        await page.locator('#trStationInput').press('Enter');
        await page.locator('#trStation .tr-route-sum').click();
        await expect(page.locator('#trStation .tr-route-what')).toContainText('All 4 stay the same');
        await expect(page.locator('#trStation .tr-trains tbody tr')).toHaveCount(4);
        await expect(page.locator('#trAllTrains')).toHaveCount(0);
        await page.clock.setFixedTime(new Date('2026-12-20T09:00:00Z'));
        await page.reload();
        await expect(page.locator('#trOverviewHint')).toHaveText('What changed at Marylebone on 13 December');
    });
});

// ── THE WIRING, AFTER THE TRAINS REVIEW (22 Nov 2026) ─────────────────────────────────────────────────────────────
// Each of these was a line of trains-app.js (or trains-grid-mirror.js) that no test reached: deleting or inverting it
// left the whole suite green. Each test below was checked by mutating that line (scripts/mutate.mjs).
test.describe('trains — Back, the station card and the boxes, wired', () => {
    /** Open the page as an invented member, on a Wednesday before the change. @param {import('@playwright/test').Page} page */
    const open = async (page) => {
        await page.clock.setFixedTime(new Date('2026-10-21T09:00:00Z'));
        await seedSession(page, 'A. Person');
        await page.goto('/trains.html');
        await expect(page.locator('#trChanges .tr-head').first()).toBeVisible();
    };
    /** Open a station from the changes list: the press that gives it a Back entry. @param {import('@playwright/test').Page} page */
    const fromList = async (page) => {
        await page.locator('[data-view="changes"]').click();
        await page.locator('#trChanges .tr-head', { hasText: 'to Aylesbury' }).click();
        await expect(page.locator('#trStationTitle')).toHaveText('Aylesbury');
    };

    test('closing a ? panel leaves the view where it was — over a station opened from the list too; Back then returns to the list', async ({ page }) => {
        await open(page);
        // Stations by its tab: no entry of its own, so the ✕ lands on the page's first entry, which is not the list's either.
        await page.locator('[data-view="stations"]').click();
        await page.locator('.btn-card-tips[data-card="stations"]').click();
        await expect(page.locator('#tipsLightbox')).toBeVisible();
        await page.locator('#tipsLightboxClose').click();
        await expect(page.locator('#tipsLightbox')).toBeHidden();
        await page.waitForFunction(() => !history.state);
        await expect(page.locator('#trViewStations'), 'the ✕ over Stations opened by its tab went to the list').toBeVisible();
        await fromList(page);
        await page.locator('.btn-card-tips[data-card="stations"]').click();
        await expect(page.locator('#tipsLightbox')).toBeVisible();
        await page.locator('#tipsLightboxClose').click();
        await expect(page.locator('#tipsLightbox')).toBeHidden();
        // The ✕ pops the panel's own entry, landing on the station's: once history is back there, its popstate has run.
        await page.waitForFunction(() => history.state?.trains === 'station');
        await expect(page.locator('#trViewStations')).toBeVisible();
        await expect(page.locator('#trViewChanges')).toBeHidden();
        await page.goBack();
        await expect(page.locator('#trViewChanges')).toBeVisible();
    });

    test('Back, Forward and a second station from the list: Forward redraws the station, and one Back returns to the list', async ({ page }) => {
        await open(page);
        await fromList(page);
        await page.goBack();
        await expect(page.locator('#trViewChanges')).toBeVisible();
        await page.goForward();
        await expect(page.locator('#trViewStations'), 'Forward lands on the station\'s entry, so the station is drawn').toBeVisible();
        await expect(page.locator('#trStationTitle')).toHaveText('Aylesbury');
        await page.locator('[data-view="changes"]').click();
        await expect(page.locator('#trViewChanges')).toBeVisible();
        await page.locator('#trChanges .tr-head').nth(2).click();
        await expect(page.locator('#trViewStations')).toBeVisible();
        await page.goBack();
        await expect(page.locator('#trViewChanges'), 'one Back returns to the list').toBeVisible();
        await expect(page).toHaveURL(/trains\.html/);
    });

    test('a redraw that changes nothing writes nothing: the station card is the same nodes, and "Train by train" stays open', async ({ page }) => {
        await open(page);
        await fromList(page);
        await page.locator('#trStation .tr-route-sum').click();
        await expect(page.locator('#trStation .tr-route')).toHaveAttribute('open', '');
        // What the tab coming back into view does (trains-app.js): the whole page is drawn again. The first draw after
        // the list was opened writes it as open (`showTrains`); the one after that has nothing new to write.
        const redraw = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await redraw();
        await page.locator('#trStation .tr-verdict').evaluate(n => { /** @type {any} */ (n).__kept = true; });
        await redraw();
        await expect(page.locator('#trStationHint')).toHaveText('Weekdays · London Marylebone → Aylesbury');
        expect(await page.locator('#trStation .tr-verdict').evaluate(n => /** @type {any} */ (n).__kept === true),
            'the unchanged card was written again — a live region would read it all out again').toBe(true);
        await expect(page.locator('#trStation .tr-route')).toHaveAttribute('open', '');
    });

    test('"Train by train" stays as it was left when the direction, the day or the station changes', async ({ page }) => {
        await open(page);
        await fromList(page);
        const list = page.locator('#trStation .tr-route');
        await page.locator('#trStation .tr-route-sum').click();
        await expect(list).toHaveAttribute('open', '');
        await page.locator('[data-sdir="arr"]').click();
        await expect(page.locator('#trStationHint')).toHaveText('Weekdays · Aylesbury → London Marylebone');
        await expect(list, 'open after Coming back').toHaveAttribute('open', '');
        await page.locator('[data-day="SO"]').click();
        await expect(page.locator('#trStationHint')).toHaveText('Saturdays · Aylesbury → London Marylebone');
        await expect(list, 'open after Saturdays').toHaveAttribute('open', '');
        await page.locator('#trStationChange').click();
        await page.locator('#trStationInput').fill('amersham');
        await page.locator('#trStationInput').press('Enter');
        await expect(page.locator('#trStationTitle')).toHaveText('Amersham');
        await expect(list, 'open for the next station').toHaveAttribute('open', '');
        // …and closed stays closed.
        await page.locator('#trStation .tr-route-sum').click();
        await expect(list).not.toHaveAttribute('open', '');
        await page.locator('[data-sdir="dep"]').click();
        await expect(page.locator('#trStationHint')).toHaveText('Saturdays · London Marylebone → Amersham');
        await expect(list, 'closed after Going there').not.toHaveAttribute('open', '');
    });

    test('Enter in an empty station box opens nothing; with a name typed, the first match', async ({ page }) => {
        await open(page);
        await page.locator('[data-view="stations"]').click();
        await expect(page.locator('#trStationPicks .tr-pick').first()).toBeVisible();
        await page.locator('#trStationInput').focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#trStationTitle'), 'Enter in an empty box opened the first chip').toHaveText('Stations');
        await expect(page.locator('#trStationPicker')).toBeVisible();
        await page.locator('#trStationInput').fill('   ');
        await page.keyboard.press('Enter');
        await expect(page.locator('#trStationTitle'), 'nor do spaces alone').toHaveText('Stations');
        await page.locator('#trStationInput').fill('amer');
        await page.keyboard.press('Enter');
        await expect(page.locator('#trStationTitle')).toHaveText('Amersham');
    });

    test('a screen reader is told one short line per press, and the cards themselves are not read out', async ({ page }) => {
        // The line is trains-status.js's (`statusLine`, `matchesLine`), made of the words already on screen.
        await open(page);
        const status = page.locator('#trStatus');
        await expect(status).toHaveAttribute('role', 'status');
        for (const id of ['#trChanges', '#trStation']) await expect(page.locator(id)).not.toHaveAttribute('aria-live', /./);
        await expect(status, 'opening the page is not a change, and says nothing').toHaveText('');
        await page.locator('[data-day="SO"]').click();
        await expect(status).toHaveText('Saturdays, trains leaving Marylebone — biggest change first');
        await page.locator('[data-day="SX"]').click();
        await expect(status).toHaveText('Weekdays, trains leaving Marylebone — biggest change first');
        await fromList(page);
        await expect(status).toHaveText('Weekdays, London Marylebone to Aylesbury. 6 more trains a day: 47, was 41.');
        await page.locator('[data-sdir="arr"]').click();
        await expect(status).toHaveText(/^Weekdays, Aylesbury to London Marylebone\. \S/);
        await page.locator('#trStationChange').click();
        await page.locator('#trStationInput').pressSequentially('chal');
        await expect(status).toHaveText('1 station to choose from: Chalfont & Latimer');
        await page.locator('#trStationInput').fill('zzz');
        await expect(status).toHaveText('No station matches that.');
        await page.locator('[data-view="grid"]').click();
        await page.locator('#trPattern [data-col="0"]').click();
        await expect(status).toHaveText(/^Only where the :\d\d to .+ stops\.$/);
    });

    test('a tab chosen inside the typing pause keeps its own line: the match count is never said over it', async ({ page }) => {
        // The Stations view is hidden, not its picker, when another tab is chosen, so the count the pause still owed
        // replaced the new tab's line (external review of v26.55).
        await open(page);
        const status = page.locator('#trStatus');
        await page.locator('[data-view="stations"]').click();
        await page.locator('#trStationInput').fill('chal');
        await page.locator('[data-view="changes"]').click();
        await page.evaluate(() => new Promise(r => setTimeout(r, 600)));   // past the pause
        await expect(status).not.toHaveText(/to choose from/);
    });

    test('a station chosen inside the typing pause keeps its card\'s line: the match count is never said over it', async ({ page }) => {
        // The count is said once typing in the station box pauses (300 ms). Enter straight after typing opened the card,
        // whose line was said, and then the count replaced it: "1 station to choose from: Amersham" (24-hour check).
        await open(page);
        const status = page.locator('#trStatus');
        await page.locator('[data-view="stations"]').click();
        await page.locator('#trStationInput').fill('amer');
        await page.locator('#trStationInput').press('Enter');
        await expect(page.locator('#trStationTitle')).toHaveText('Amersham');
        const line = /^Weekdays, London Marylebone to Amersham\. \S/;
        await expect(status).toHaveText(line);
        await page.evaluate(() => new Promise(r => setTimeout(r, 600)));   // past the pause
        await expect(status).toHaveText(line);
        // And a chip tapped inside the pause, the same.
        await page.locator('#trStationChange').click();
        await page.locator('#trStationInput').fill('chal');
        await page.locator('#trStationPicks button[data-station]').first().click();
        await expect(page.locator('#trStationTitle')).toHaveText('Chalfont & Latimer');
        await page.evaluate(() => new Promise(r => setTimeout(r, 600)));
        await expect(status).toHaveText(/^Weekdays, London Marylebone to Chalfont & Latimer\. \S/);
    });

    test('the time lookup answers once typing pauses: "5.15pm", typed, never shows 05:15', async ({ page }) => {
        await open(page);
        await openLookup(page);
        // Every answer the box is given, in order, as it is written.
        await page.locator('#trLookupResult').evaluate((box) => {
            /** @type {any} */ (window).__answers = [];
            new MutationObserver(() => /** @type {any} */ (window).__answers.push(box.textContent)).observe(box, { childList: true, subtree: true });
        });
        await page.locator('#trLookupInput').pressSequentially('5.15pm', { delay: 60 });
        await expect(page.locator('#trLookupResult .tr-answer').first()).toContainText('The 17:15 to Oxford');
        const answers = await page.evaluate(() => /** @type {any} */ (window).__answers);
        expect(answers.filter((/** @type {string} */ a) => a.includes('05:15')), 'a half-typed time was answered on the way').toEqual([]);
        // Enter answers at once, without waiting for the pause: read in the same task as the key, before any timer can run.
        await page.locator('#trLookupInput').fill('1716');
        const atEnter = await page.evaluate(() => {
            /** @type {HTMLElement} */ (document.getElementById('trLookupInput')).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            return /** @type {HTMLElement} */ (document.getElementById('trLookupResult')).textContent;
        });
        expect(atEnter, 'Enter waited for the pause').toContain('17:16');
    });

    test('the column heads kept in view are no wider than the grid when the grid does not fill its box', async ({ page }) => {
        await page.setViewportSize({ width: 727, height: 700 });
        await open(page);
        await page.locator('[data-view="grid"]').click();
        await page.locator('[data-day="SU"]').click();
        const table = page.locator('#trPattern .tr-grid');
        const t = /** @type {{ x: number, y: number, width: number, height: number }} */ (await table.boundingBox());
        const w = /** @type {{ x: number, y: number, width: number, height: number }} */ (await page.locator('#trPattern .tr-grid-wrap').boundingBox());
        expect(t.width, 'premise: at this width the grid is narrower than its box').toBeLessThan(w.width - 20);
        await page.evaluate((y) => window.scrollTo(0, window.scrollY + y), t.y + 300);
        const stick = page.locator('.tr-grid-stick');
        await expect(stick).toBeVisible();
        const s = /** @type {{ x: number, y: number, width: number, height: number }} */ (await stick.boundingBox());
        const now = /** @type {{ x: number, y: number, width: number, height: number }} */ (await table.boundingBox());
        expect(s.x + s.width, 'the heads run on past the last column').toBeLessThanOrEqual(now.x + now.width + 1);
    });

    test('signed in on the page itself, a Back to it is not reloaded for the member who signed in', async ({ page }) => {
        await page.clock.setFixedTime(new Date('2026-10-21T09:00:00Z'));
        await page.goto('/trains.html');
        await page.locator('#loginOverlay').waitFor({ state: 'visible' });
        const { pw } = await pickFirstMemberAndPassword(page);
        await page.locator('#loginPassword').fill(pw);
        await page.locator('#loginSubmit').click();
        await expect(page.locator('#loginOverlay')).toBeHidden();
        await expect(page.locator('#trChanges .tr-head').first()).toBeVisible();
        const reloaded = page.waitForEvent('framenavigated', { predicate: f => f === page.mainFrame(), timeout: 3_000 })
            .then(() => true, () => false);
        // Left and restored from the back/forward cache, by the same member: the page is theirs, and is shown.
        await page.evaluate(() => {
            window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
            window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        }).catch(() => {});
        expect(await reloaded, 'the page reloaded for the member it was just signed in for').toBe(false);
    });
});

test.describe('trains — the totals and the header, measured', () => {
    test('on a desktop each day\'s change sits beside its figure, and the changes line up', async ({ page }) => {
        await page.setViewportSize({ width: 1366, height: 900 });
        await page.clock.setFixedTime(new Date('2026-10-21T09:00:00Z'));
        await seedSession(page, 'A. Person');
        await page.goto('/trains.html');
        await expect(page.locator('#trTotals .tr-totals-days')).toBeVisible();
        const rows = await page.locator('#trTotals .tr-total').evaluateAll(lis => lis.map(li => {
            const n = /** @type {Element} */ (li.querySelector('.tr-total-n')).getBoundingClientRect();
            const chip = li.querySelector('.tr-delta')?.getBoundingClientRect();
            return { gap: chip ? Math.round(chip.left - n.right) : null, chipLeft: chip ? Math.round(chip.left) : null };
        }));
        const chips = rows.filter(r => r.gap !== null);
        expect(chips.length, 'premise: the days carry a change').toBeGreaterThan(1);
        for (const r of chips) expect(/** @type {number} */ (r.gap), 'a change chip far from its figure').toBeLessThanOrEqual(40);
        expect(new Set(chips.map(r => r.chipLeft)).size, `the change chips line up: ${JSON.stringify(rows)}`).toBe(1);
    });

    test('on a touch screen the two small pills are drawn small, and still take a thumb', async ({ page }, info) => {
        test.skip(!isTouchProject(info), 'a coarse pointer is what sizes them');
        await page.clock.setFixedTime(new Date('2026-10-21T09:00:00Z'));
        await seedSession(page, 'A. Person');
        await page.goto('/trains.html');
        await page.locator('[data-view="stations"]').click();
        await page.locator('#trStationInput').fill('amersham');
        await page.locator('#trStationInput').press('Enter');
        await page.locator('[data-view="grid"]').click();
        await page.locator('#trPattern [data-col="0"]').click();
        for (const [name, sel, view] of [['Change station', '#trStationChange', 'stations'], ['Show every station', '#trGridAll', 'grid']]) {
            await page.locator(`[data-view="${view}"]`).click();
            const pill = page.locator(sel);
            await expect(pill).toBeVisible();
            const b = /** @type {{ x: number, y: number, width: number, height: number }} */ (await pill.boundingBox());
            expect(b.height, `${name}: drawn as a capsule twice the height of its words`).toBeLessThanOrEqual(38);
            // 44px of target: a touch 3.5px above or below the pill's drawn edge still lands on it.
            const lands = await page.evaluate(({ b, sel }) => [b.y - 3.5, b.y + b.height + 3.5].every(y =>
                !!document.elementFromPoint(b.x + b.width / 2, y)?.closest(sel)), { b, sel });
            expect(lands, `${name}: a thumb just off its edge misses it`).toBe(true);
        }
    });

    test('on a 320px phone the app\'s name keeps clear of the page badge', async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 640 });
        await page.clock.setFixedTime(new Date('2026-10-21T09:00:00Z'));
        await seedSession(page, 'A. Person');
        await page.goto('/trains.html');
        await expect(page.locator('#trainsBadge')).toBeVisible();
        const look = await page.evaluate(() => {
            const h1 = /** @type {HTMLElement} */ (document.querySelector('.app-header h1'));
            // The words' own width, to a fraction of a pixel: an ellipsis is drawn for the smallest overflow.
            const words = document.createRange();
            words.selectNodeContents(h1);
            return { gap: /** @type {Element} */ (document.getElementById('trainsBadge')).getBoundingClientRect().left - h1.getBoundingClientRect().right,
                     whole: words.getBoundingClientRect().width <= h1.getBoundingClientRect().width + 0.01 };
        });
        expect(look.gap, 'the name runs up against the badge').toBeGreaterThanOrEqual(6);
        expect(look.whole, 'beside Trains\' badge the name still fits whole').toBe(true);
    });
});

// ── FIND A TRAIN (owner, Nov 2026): "bring the existing time and station lookups together" ───────────────────────
// trains-journey.test.mjs proves the answers on the real tables; this proves the WIRING — that the box a colleague
// types into reaches them for the day chosen and the clock, that the chips under an answer do what they say, and
// that the answer fits a phone. Local times, no "Z": the page reads the browser's clock, in this file's time zone.
test.describe('trains — Find a train', () => {
    /** @param {import('@playwright/test').Page} page @param {string} when */
    const open = async (page, when) => {
        await page.clock.setFixedTime(new Date(when));
        await seedSession(page, 'G. Miller');
        await page.goto('/trains.html');
        await expect(page.locator('#trLookupInput')).toBeVisible();
    };
    /** Type into the box and press Enter, which answers at once. @param {import('@playwright/test').Page} page @param {string} text */
    const ask = async (page, text) => {
        await page.locator('#trLookupInput').fill(text);
        await page.locator('#trLookupInput').press('Enter');
    };

    test('"Aylesbury, after 17:15": the first train, its route and the next two, the timetable and "Scheduled", stops on tap', async ({ page }) => {
        const errors = collectFatalErrors(page);
        await open(page, '2026-11-27T12:00:00');   // Friday 27 November
        const result = page.locator('#trLookupResult');
        await expect(result).toHaveAttribute('aria-live', 'polite');
        await ask(page, 'Aylesbury, after 17:15');
        await expect(result.locator('.tr-jr-meta')).toHaveText('Friday 27 November·Timetable until Saturday 12 DecemberScheduled');
        await expect(result.locator('.tr-jr-ask')).toHaveText('First train to Aylesbury after 17:15');
        const first = result.locator('.tr-jr-first');
        await expect(first.locator('.tr-jr-line')).toHaveText('17:30 to Aylesbury Vale Parkway, via Amersham');
        await expect(first.locator('.tr-jr-arr')).toHaveText('Gets to Aylesbury at 18:21');
        await expect(result.locator('.tr-jr-list > li .tr-jr-line')).toHaveText(['17:41 to Aylesbury, via Amersham', '17:59 to Aylesbury Vale Parkway, via Amersham']);
        // Where it stops, on tap — and the station asked about stands out in words, not weight alone.
        const stops = first.locator('.tr-jr-stops');
        await expect(stops.locator('.tr-jr-stoplist')).toBeHidden();
        await stops.locator('summary').click();
        await expect(stops.locator('.tr-jr-stoplist li').first()).toHaveText('17:30 London Marylebone');
        await expect(stops.locator('.tr-jr-here')).toHaveText('18:21 Aylesbury, the station asked about');
        // The same question, typed as people say it, gets the same answer.
        await ask(page, 'aylesbury 5.15pm');
        await expect(first.locator('.tr-jr-line')).toHaveText('17:30 to Aylesbury Vale Parkway, via Amersham');
        // A station only one route reaches is not given one.
        await ask(page, 'gerrards x after 17:15');
        await expect(result.locator('.tr-jr-ask')).toHaveText('First train to Gerrards Cross after 17:15');
        await expect(first.locator('.tr-jr-line')).not.toContainText('via');
        // A time alone is still "what happens to the 17:15?", both timetables side by side.
        await ask(page, '17:15');
        await expect(result.locator('.tr-answer').first()).toContainText('The 17:15 to Oxford');
        await expect(result.locator('.tr-near-head')).toHaveCount(2);
        expect(errors, errors.join('\n')).toEqual([]);
    });

    test('with no time, it is the next train from the page\'s clock — and it moves on as the minute turns', async ({ page }) => {
        await open(page, '2026-11-27T17:25:00');
        await ask(page, 'High Wycombe');
        const result = page.locator('#trLookupResult');
        await expect(result.locator('.tr-jr-ask')).toHaveText('Next train to High Wycombe');
        await ask(page, 'Aylesbury');
        await expect(result.locator('.tr-jr-first .tr-jr-time')).toHaveText('17:30');
        // The 17:30 leaves; nobody presses anything, and the tab is never hidden.
        await page.clock.setFixedTime(new Date('2026-11-27T17:35:00'));
        await page.clock.runFor(60_000);
        await expect(result.locator('.tr-jr-first .tr-jr-time')).toHaveText('17:41');
    });

    test('the day tabs choose the date: Saturdays, on a Friday, is tomorrow\'s first train', async ({ page }) => {
        await open(page, '2026-11-27T12:00:00');
        await ask(page, 'Aylesbury');
        await page.locator('[data-day="SO"]').click();
        const result = page.locator('#trLookupResult');
        await expect(result.locator('.tr-jr-meta')).toContainText('Saturday 28 November');
        await expect(result.locator('.tr-jr-ask')).toHaveText('First train to Aylesbury');
    });

    test('past the last train it says so, and gives the first one tomorrow — from the new timetable across the change', async ({ page }) => {
        await open(page, '2026-12-13T00:30:00');   // still Saturday 12 December's railway day
        await ask(page, 'Beaconsfield');
        const result = page.locator('#trLookupResult');
        await expect(result.locator('.tr-answer').first()).toHaveText('No more trains to Beaconsfield today.');
        await expect(result.locator('.tr-jr-ask')).toHaveText('First train tomorrow');
        await expect(result.locator('.tr-jr-meta').nth(1)).toHaveText('Sunday 13 December·Timetable from Sunday 13 DecemberScheduled');
        await expect(result.locator('.tr-jr-first .tr-jr-time')).toHaveText('07:42');
    });

    test('on 13 December the new timetable answers: its new Sunday 15:38 to Birmingham Moor Street', async ({ page }) => {
        await open(page, '2026-12-13T15:00:00');
        await ask(page, 'moor st after 15:30');
        const result = page.locator('#trLookupResult');
        await expect(result.locator('.tr-jr-meta')).toHaveText('Sunday 13 December·Timetable from Sunday 13 DecemberScheduled');
        await expect(result.locator('.tr-jr-first .tr-jr-line')).toHaveText('15:38 to Birmingham Moor Street');
    });

    test('a station it cannot find is said, with the closest to choose from; a chip puts its station in the box, keeping the time', async ({ page }) => {
        await open(page, '2026-11-27T12:00:00');
        const box = page.locator('#trLookupInput'), result = page.locator('#trLookupResult');
        await ask(page, 'aylsbury after 17:15');
        await expect(result.locator('.tr-lead').first()).toHaveText('No station matches “aylsbury”.');
        await result.locator('[data-journey="AYS"]').click();
        await expect(box).toHaveValue('Aylesbury, after 17:15');
        await expect(box).toBeFocused();
        await expect(result.locator('.tr-jr-first .tr-jr-time')).toHaveText('17:30');
        // The other matches of a station found are offered too: "Or did you mean".
        await result.locator('.tr-jr-others [data-journey="AVP"]').click();
        await expect(box).toHaveValue('Aylesbury Vale Parkway, after 17:15');
        await expect(result.locator('.tr-jr-ask')).toHaveText('First train to Aylesbury Vale Parkway after 17:15');
    });

    test('"All trains to and from" opens the station\'s card, as Jump to a station did, and Back returns', async ({ page }) => {
        await open(page, '2026-11-27T12:00:00');
        await ask(page, 'Aylesbury, after 17:15');
        await page.locator('#trLookupResult .tr-jr-card').click();
        await expect(page.locator('[data-view="stations"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#trStationTitle')).toHaveText('Aylesbury');
        await expect(page.locator('#trStationTitle')).toBeFocused();
        // The box and its answer stay, above the view.
        await expect(page.locator('#trLookupResult .tr-jr-first')).toBeVisible();
        await page.goBack();
        await expect(page.locator('[data-view="changes"]')).toHaveAttribute('aria-pressed', 'true');
    });

    for (const width of [320, 390]) {
        test(`an answer, its stops open, fits a ${width}px phone`, async ({ page }) => {
            await page.setViewportSize({ width, height: 800 });
            await open(page, '2026-11-29T12:00:00');   // a Sunday: both routes, the longest lines
            await ask(page, 'Haddenham & Thame Parkway, after 17:45');
            await expect(page.locator('#trLookupResult .tr-jr-first')).toBeVisible();
            for (const s of await page.locator('#trLookupResult summary').all()) await s.click();
            const over = await page.evaluate(() => {
                const edge = /** @type {HTMLElement} */ (document.getElementById('trLookupCard')).getBoundingClientRect().right;
                return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                    card: Math.max(0, ...[...document.querySelectorAll('#trLookupCard *')].map(e => e.getBoundingClientRect().right - edge)) };
            });
            expect(over.page, 'the page scrolls sideways').toBeLessThanOrEqual(1);
            expect(over.card, 'something runs past the card').toBeLessThanOrEqual(1);
        });
    }
});
