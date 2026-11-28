// @lane unit
/**
 * usage-staff-pages.test.mjs — the Usage card lists every page open to staff, at 0 where nobody has opened it yet.
 * Run with: node scripts/run-tests.mjs test/usage-staff-pages.test.mjs
 *
 * Owner, 28 Nov 2026: "Links Selector should appear on the usage page on operations please." The card listed only a page
 * somebody had opened, and the admin's own opens are never counted, so a page that had just opened was absent — read as
 * "not counted" rather than "nobody yet". What a wrong answer costs: a page left off hides that it has had no visits; a
 * paused page or Operations listed would be a 0 that means nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { staffPageIds, withEveryStaffPage } = await import('../operations-reports.js');
const { NAV_PAGES } = await import('../nav-destinations.js');
const { CONFIG } = await import('../roster-data.js');

test('the Links Selector is listed while it is open to staff — and every other open page with it', () => {
    const ids = staffPageIds();
    assert.equal(CONFIG.LINKS_SELECTOR_OPEN, true, 'premise: the Links Selector is open today');
    assert.ok(ids.includes('selector'));
    for (const id of ['calendar', 'admin', 'paycalc', 'trains', 'newlink', 'settings']) assert.ok(ids.includes(id), `${id} is open to staff`);
});

test('never the admin\'s own page, nor a paused one, nor a beta that is still the admin\'s — each read from its switch', () => {
    const ids = staffPageIds();
    assert.ok(!ids.includes('operations'), 'Operations: every open is an admin\'s, never counted');
    const paused = { ...CONFIG, OVERTIME_ENABLED: false, LINK_DESIGNER_ENABLED: false, LINKS_SELECTOR_OPEN: false };
    const p = staffPageIds(paused);
    for (const id of ['overtime', 'links', 'selector']) assert.ok(!p.includes(id), `${id} is listed while it is switched off`);
    const open = staffPageIds({ ...CONFIG, OVERTIME_ENABLED: true, LINK_DESIGNER_ENABLED: true, LINKS_SELECTOR_OPEN: true });
    for (const id of ['overtime', 'links', 'selector']) assert.ok(open.includes(id), `${id} is left off when it is switched on`);
    // Every id is a real drawer page, so every row has its name and emoji (PAGE_META is read from NAV_PAGES).
    for (const id of open) assert.ok(NAV_PAGES.some(n => n.id === id));
});

test('counted pages keep their order; the rest follow at 0, in the drawer\'s order; nothing is listed twice', () => {
    const ids = ['calendar', 'admin', 'paycalc', 'trains', 'selector', 'settings'];
    const counted = [{ page: 'calendar', count: 40 }, { page: 'trains', count: 7 }, { page: 'huddle-unknown', count: 2 }];
    assert.deepEqual(withEveryStaffPage(counted, ids), [
        { page: 'calendar', count: 40 }, { page: 'trains', count: 7 }, { page: 'huddle-unknown', count: 2 },
        { page: 'admin', count: 0 }, { page: 'paycalc', count: 0 }, { page: 'selector', count: 0 }, { page: 'settings', count: 0 },
    ]);
    assert.deepEqual(withEveryStaffPage([], []), []);
});

test('the card applies it to THIS month only, through the one helper', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../operations-usage.js', import.meta.url), 'utf8');
    assert.match(src, /popActive === 'this' \? withEveryStaffPage\(viewed, staffPageIds\(\)\) : viewed/);
});
