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
import { collectFatalErrors, seedSession, seedMemberSession, seedMember, clearNoticeFlags, isTouchProject } from './helpers.js';

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
        // One real weekday (v24.83): 146 counted today's Mondays-and-Fridays 17:37 beside its 17:33 twin.
        await expect(page.locator('#trTotals')).toContainText('Weekdays 145 → 158');
        await expect(page.locator('[data-day="SX"]')).toHaveAttribute('aria-pressed', 'true');
        // Chiltern's books say nothing about Christmas, so the page says it cannot answer for it.
        await expect(page.locator('#trFestive')).toBeVisible();
        await expect(page.locator('#trFestive')).toContainText('Christmas and New Year are not on this page.');

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
        await expect(page.locator('#trStation .tr-verdict')).toHaveText('6 more trains a day: 47, was 41.');
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
        await expect(page.locator('#trStation .tr-verdict')).toHaveText('More trains in the daytime: usually 2 an hour, was 1 to 3.');
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
        // 16 since v24.83: a train that passes it now, or starts calling, is counted at the station.
        await expect(page.locator('#trStation .tr-verdict')).toHaveText('Same number of trains a day, but 16 are different — see Train by train below.');
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
        await expect(page.locator('#trStation .tr-verdict')).toHaveText('1 more train a day: 37, was 36.');
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
            .toHaveText('The 10:36 to Banbury: Will run to Birmingham Snow Hill. From 13 December it does not stop at Kings Sutton.');
        await page.locator('#trLookupInput').fill('1715');
        await expect(page.locator('#trLookupResult')).toContainText('on to Stourbridge');
        await page.locator('#trLookupInput').fill('5.15pm');
        await expect(page.locator('#trLookupResult .tr-answer').first()).toContainText('The 17:15 to Oxford');
        await page.locator('#trLookupInput').fill('1716');
        await expect(page.locator('#trLookupResult')).toContainText('No weekday train leaves at exactly 17:16 in today’s timetable.');
        await page.locator('#trLookupInput').fill('noon');
        await expect(page.locator('#trLookupResult')).toContainText('Type a time like 17:15');

        // The `?` panels are wired — the page's caveats live there.
        await page.locator('.btn-card-tips[data-card="changes"]').click();
        await expect(page.locator('#tipsLbTitle')).toHaveText('🔔 What’s changing');
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
            await expect(page.locator('#trFestive')).toContainText('Christmas and New Year are not on this page.');
            // And the fold still does its job: the first answer is on the first screen.
            const first = await page.locator('#trChanges .tr-head').first().evaluate(e => Math.round(e.getBoundingClientRect().top));
            expect(first, 'the first headline is still on the first screen').toBeLessThan(560);
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

    test('from 13 December the page turns: the old timetable by name, and the lookup answers from the new one (v24.83)', async ({ page }) => {
        // A Sunday after the change. Until v24.83 the columns still said "Now" of the stopped timetable
        // and "the 15:38" — December's Moor Street train — read "No train leaves at exactly 15:38 today".
        await page.clock.setFixedTime(new Date('2026-12-20T10:00:00Z'));
        await seedSession(page, 'C. Reen');
        await page.goto('/trains.html');
        await expect(page.locator('#trCountdown')).toHaveText('Now running');
        await expect(page.locator('#trLead')).toContainText('The timetable that ran until Saturday 12 December beside the new one');
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
        await expect(page.locator('#trCountdown')).toHaveText('Timetable ended');
        await expect(page.locator('#trOverviewBody')).toHaveClass(/\bopen\b/);
        await expect(page.locator('#trEnded')).toBeVisible();
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
        await expect(page.locator('#trStation')).toContainText('Leaf fall: until 10 January, trains to London on this line leave up to 3 minutes earlier than usual.');
        // The Mondays-and-Fridays 17:37 is the 17:33's twin, 4 minutes earlier — the card once said "No longer runs".
        await page.locator('[data-sdir="dep"]').click();
        await findStation(page, 'snowhill');
        await page.locator('#trStationInput').press('Enter');
        await page.locator('#trStation .tr-route-sum').click();
        const twin = page.locator('#trStation .tr-trains tbody tr', { hasText: 'Mon and Fri only' });
        await expect(twin).toContainText('17:37');
        await expect(twin).toContainText('4 mins earlier');
        await expect(page.locator('#trStation .tr-trains')).not.toContainText('No longer runs');
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
        // On a phone the lookup comes before the list and starts folded; opening it puts the cursor in the box.
        expect(await page.evaluate(() => {
            const lookup = document.getElementById('trLookupCard'), changes = document.getElementById('trChangesCard');
            return !!lookup && !!changes && !!(lookup.compareDocumentPosition(changes) & Node.DOCUMENT_POSITION_FOLLOWING);
        }), 'the lookup card precedes the changes card').toBe(true);
        await expect(page.locator('#trLookupBody')).not.toHaveClass(/\bopen\b/);
        const first = await page.locator('#trChanges .tr-head').first().evaluate(e => Math.round(e.getBoundingClientRect().top));
        // Until 10 January the Christmas line sits above the fold ON PURPOSE (v25.20): it is the one thing
        // on the card a member must not miss. So it is not counted against the budget, and is held instead
        // to being a short note, not a paragraph — everything else above the first answer still has to fit
        // in 500px. (Counted, it measured 512px on the phone project.) The note's own cap allows for the
        // renderer: 84px here (three lines), 105px on CI's runners (four), which set a 100px cap off.
        const christmas = await page.locator('#trFestive').evaluate(e => /** @type {HTMLElement} */ (e).hidden ? 0 : Math.round(e.getBoundingClientRect().height));
        expect(christmas, 'the Christmas line stays a short note, not a paragraph').toBeLessThan(130);
        expect(first - christmas, 'the first headline is on the first screen with room to spare (589px before v24.92)').toBeLessThan(500);
        await page.locator('#trLookupToggleHeader').click();
        await expect(page.locator('#trLookupInput')).toBeFocused();
        await page.keyboard.type('1715');
        await expect(page.locator('#trLookupResult .tr-answer').first()).toContainText('The 17:15 to Oxford');
        // A desktop has the room: the lookup is open in its own column.
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.reload();
        await expect(page.locator('#trChanges .tr-head').first()).toBeVisible();
        await expect(page.locator('#trLookupBody')).toHaveClass(/\bopen\b/);
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
        // …under the station just looked at, remembered as "Last time" (v24.94).
        await expect(page.locator('#trStationPicks .tr-picks-label')).toHaveText(['Last time', 'Busiest stations']);
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
            await page.locator('#trStation .tr-route-sum').click();
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

    test('the Calendar\'s one-time notice tells a member, and its link opens this page (v24.82)', async ({ page }) => {
        // The rest of the notice — every dismissal marks it done, it ends with 31 October (v24.86),
        // it is refused to the station PC — is pinned in calendar-notices.test.mjs. This is the half
        // only a browser can prove: it opens on the real Calendar, and its link is the right link.
        // (The seeders re-mark it done on every load, so the done flag cannot be read after the
        // link has navigated; the archive is the store nothing re-seeds.)
        const errors = collectFatalErrors(page);
        await page.clock.setFixedTime(new Date('2026-10-22T09:00:00Z'));
        await seedSession(page, 'C. Reen');
        await seedMemberSession(page, 'C. Reen');
        await seedMember(page, 'C. Reen');
        await clearNoticeFlags(page, ['myb_notice_timetable_2026_done']);
        await page.goto('/');
        const notice = page.locator('#timetableNoticeLb');
        await expect(notice).toHaveClass(/\bopen\b/, { timeout: 15_000 });
        await expect(notice).toContainText('A new timetable starts on 13 December');
        await expect(notice).toContainText(/☰\s+then\s+🚆\s+Trains/);    // non-breaking spaces keep each half together
        await page.locator('#timetableNoticeGo').click();
        await expect(page).toHaveURL(/trains\.html/);
        await expect(page.locator('#trChanges .tr-head').first()).toBeVisible();
        const archived = await page.evaluate(() =>
            JSON.parse(localStorage.getItem('myb_app_notices') || '[]').map((/** @type {{ id: string }} */ n) => n.id));
        expect(archived, 'kept in the drawer\'s App Notices once it has been shown').toContain('timetable-2026');
        expect(errors).toHaveLength(0);
    });

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
        await expect(page.locator('#trStationPicks .tr-picks-label').first()).toHaveText('Last time');
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
        await expect(result).toContainText('the same trains now and from 13 Dec');
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

    test('the desktop jump card: the busiest stations beside the changes list, on a wide screen only', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await page.clock.setFixedTime(new Date('2026-10-23T09:00:00Z'));
        await page.goto('/trains.html');
        const wide = (page.viewportSize()?.width ?? 0) >= 1024;
        const card = page.locator('#trJumpCard');
        if (!wide) { await expect(card).toBeHidden(); return; }
        await expect(card).toBeVisible();
        const first = page.locator('#trJumpPicks .tr-pick').first();
        const name = await first.textContent();
        await first.click();
        await expect(page.locator('[data-view="stations"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#trStationTitle')).toHaveText(name ?? '');
        await expect(page.locator('#trStation .tr-verdict')).toBeVisible();
    });

    test('the final week\'s Calendar notice opens from 6 December, and its link opens this page', async ({ page }) => {
        const errors = collectFatalErrors(page);
        await page.clock.setFixedTime(new Date('2026-12-07T09:00:00Z'));
        await seedSession(page, 'C. Reen');
        await seedMemberSession(page, 'C. Reen');
        await seedMember(page, 'C. Reen');
        await clearNoticeFlags(page);
        // The install notice is still live in December and would take the load; this device answered it.
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
