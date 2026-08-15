/**
 * Tests for admin-tasks.js — the Admin task-focus row.
 *
 * The pure half is small, and the two things worth pinning are both about the page being PREDICTABLE
 * rather than clever:
 *
 *   · the default never varies — not by role, not by what you did last. A page that opens somewhere
 *     different each time defeats the muscle memory that is the whole point of a fixed starting place.
 *   · a deep link and the chip row never disagree. `#book-annual-leave` has opened that card since
 *     the calendar's AL lightbox started linking to it; if the chips ignored the hash the page would
 *     show one answer and claim another.
 *
 * The DOM half (opening one card, collapsing the rest) is driven in a real browser by
 * e2e/pages.spec.js — it works by clicking the shared collapse control, and whether that control
 * exists and responds is exactly what a fake DOM would not tell us.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { ADMIN_TASKS, DEFAULT_TASK, taskForHash, initialTask } from './admin-tasks.js';

describe('the task list', () => {
    test('every task has a unique id and names a card', () => {
        const ids = ADMIN_TASKS.map(t => t.id);
        assert.equal(new Set(ids).size, ids.length, 'ids must be unique — they key the chips');
        for (const t of ADMIN_TASKS) {
            assert.ok(t.card, `${t.id} names no card to focus`);
            assert.ok(t.label, `${t.id} has no label`);
        }
    });

    test('a collapsible task declares BOTH its body and its chevron, or neither', () => {
        // The pair is what makes the "click the real control" approach work. One without the other
        // would silently skip the collapse — the card would dim and stay open, which reads as the
        // feature half-working rather than as a fault.
        for (const t of ADMIN_TASKS) {
            assert.equal(Boolean(t.body), Boolean(t.chevron),
                `${t.id} declares only half of its collapse pair`);
        }
    });

    test('the default task exists in the list', () => {
        assert.ok(ADMIN_TASKS.some(t => t.id === DEFAULT_TASK));
    });

    test('the default is Change a shift, and it is the FIRST chip', () => {
        // Both halves matter and they are separate claims: the default could be right while the row
        // opened with it in third place, which would look like a mistake every time.
        assert.equal(DEFAULT_TASK, 'shift');
        assert.equal(ADMIN_TASKS[0].id, 'shift');
    });

    test('no label uses a word the wording rules forbid', () => {
        // "Absent"/"absence" — never "sick" — in anything a staff member reads (CLAUDE.md; the
        // reason for absence is deliberately never stored). The card ids still say `sick`, which is
        // fine: they are code, not copy.
        for (const t of ADMIN_TASKS) {
            assert.doesNotMatch(t.label, /sick/i, `"${t.label}" uses a forbidden word`);
        }
    });
});

describe('what a page open lands on', () => {
    test('no hash means the default', () => {
        assert.equal(initialTask(''), DEFAULT_TASK);
        assert.equal(initialTask('#'), DEFAULT_TASK);
    });

    test('a hash naming a task card selects that task', () => {
        assert.equal(taskForHash('#book-annual-leave'), 'leave');
        assert.equal(taskForHash('book-annual-leave'), 'leave', 'with or without the #');
        assert.equal(initialTask('#book-annual-leave'), 'leave');
    });

    test('every card in the list is reachable by its own hash', () => {
        // A deep link exists for each of these; pinning them together stops one being renamed
        // without its link.
        for (const t of ADMIN_TASKS) {
            assert.equal(taskForHash('#' + t.card), t.id, `#${t.card} must select ${t.id}`);
        }
    });

    test('a hash naming something else falls back to the default rather than nothing', () => {
        // Admin's deep links are not all tasks — `#reset-requests`-style links target other cards.
        // Those must still land on a usable page, not a page with no task selected.
        assert.equal(taskForHash('#some-other-card'), null);
        assert.equal(initialTask('#some-other-card'), DEFAULT_TASK);
    });

    test('a malformed hash does not throw', () => {
        // The page already learned this once: `querySelector(location.hash)` threw on `#[`, and the
        // bad hash then survived the reload it was caught into and looped.
        for (const bad of ['#[', '#%', '#..', '#/']) {
            assert.equal(initialTask(bad), DEFAULT_TASK, `${bad} must be survivable`);
        }
        assert.equal(initialTask(undefined), DEFAULT_TASK);
    });
});
