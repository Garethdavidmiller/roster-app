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
import { collectFatalErrors, seedSession, seedMemberSession, seedMember, clearNoticeFlags } from './helpers.js';

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
        await expect(page.locator('#trTotals')).toContainText('weekdays 145 → 158');
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

    test('the Christmas note goes once Chiltern\'s further changes end, on 10 January', async ({ page }) => {
        await page.clock.setFixedTime(new Date('2027-01-11T09:00:00Z'));
        await seedSession(page, 'G. Miller');
        await page.goto('/trains.html');
        await expect(page.locator('#trCountdown')).toHaveText('Now running');
        await expect(page.locator('#trChanges .tr-head').first()).toBeVisible();
        await expect(page.locator('#trFestive')).toBeHidden();
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

    test('the page opens on the answers (v24.92): the overview folds from the second visit, the caveat stays, the lookup is first', async ({ page }) => {
        await page.setViewportSize({ width: 393, height: 727 });
        await page.clock.setFixedTime(new Date('2026-10-23T09:00:00Z'));
        await seedSession(page, 'C. Reen');
        await page.goto('/trains.html');
        // First visit: the overview is open and read.
        await expect(page.locator('#trOverviewBody')).toHaveClass(/\bopen\b/);
        await expect(page.locator('#trFestive')).toBeVisible();
        // The caveat is beneath the tabs, not in the card, and on every view.
        const caveat = page.locator('#trCaveat');
        await expect(caveat).toHaveText(/December times can still change\. Check Chiltern’s journey planner before you tell a customer\./);
        await expect(page.locator('#trOverviewCard')).not.toContainText('before you tell a customer');
        for (const view of ['stations', 'grid', 'changes']) {
            await page.locator(`[data-view="${view}"]`).click();
            await expect(caveat).toBeVisible();
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
        expect(first, 'the first headline is on the first screen with room to spare (589px before v24.92)').toBeLessThan(500);
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
        await expect(page.locator('#trStationPicks .tr-picks-label')).toHaveText('Busiest stations');
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
        await expect(page.locator('#trPattern .tr-grid-tip')).toContainText('Tap a time at the top');
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

    // Every view at phone width, with the widest content each holds open. The basic-hour grid
    // scrolls inside its own box, and v24.74 shipped with its screen-reader words escaping that box
    // and stretching the PAGE to 444px on a 390px phone — the whole page scrolled sideways.
    for (const width of [360, 390]) {
        test(`no view scrolls the page sideways at ${width}px`, async ({ page }) => {
            await page.setViewportSize({ width, height: 800 });
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
        await expect(page.locator('#trChanges .tr-head').first()).toBeVisible();
        await expect(page.locator('#loginOverlay')).toBeHidden();
    });
});
