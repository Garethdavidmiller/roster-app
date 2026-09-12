/**
 * calendar-legend.test.mjs — A KEY TO A GRID THAT IS NOT THERE.
 * Run with: node --test calendar-legend.test.mjs
 *
 * ── ORGANISED BY WHAT A WRONG ANSWER COSTS ──────────────────────────────────────────────────────
 *
 * The legend answers two questions that look like one, and their failures are not the same size.
 *
 *   1. SPEAKING FOR A MONTH WE HAVE NOT GOT. The expensive direction, and the only one that says
 *      something untrue. The legend is derived from the BASE roster, so it can describe a month
 *      perfectly confidently while the grid beside it is withheld pending a read that has not
 *      landed. A reader then has a key, in the app's own voice, to shifts nobody has confirmed.
 *      `legendShown` exists for that, and `'stale'` is deliberately on the showing side of it: a
 *      cached month IS a grid, and a grid gets its key.
 *   2. A SYMBOL WITH NO EXPLANATION. Cheaper and visible: an item hidden while its symbol is on the
 *      grid leaves a member looking at a glyph the page declines to name. The opposite — a key for
 *      a symbol that is absent — costs a line of clutter and nothing else. So the item rules are
 *      pinned in the direction that matters: present ⇒ shown.
 *   3. STANDING DOWN IS NOT HIDING. Team View owns the legend element while it is active. Writing
 *      `none` and writing NOTHING look identical today, because Team View hides it anyway — which
 *      is precisely why a collapse of the two would pass every visual check and every behavioural
 *      one, and would only surface the day Team View wants a legend of its own.
 *
 * The Easter month is taken from the app's REAL `computeEaster`, not a literal, so the case tracks
 * whatever the app actually believes rather than asserting a date twice. March Easters (2024, 2027)
 * are exercised explicitly, because "Easter is in April" is the assumption this rule exists to
 * refuse and it is right about three years in four.
 *
 * Teeth-verified by six mutations.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { legendVisibility, legendShown } from './calendar-legend.js';
import { computeEaster } from './roster-data.js';

/** Every conditional item the legend owns, so a case can assert the whole shape. */
const ROW_TWO = ['legend-spare', 'legend-rdw', 'legend-al', 'legend-sick', 'legend-other'];

const at = (/** @type {any} */ over = {}) => legendVisibility({
    types: new Set(),
    isDispatcher: false,
    displayMonth: 0,
    easterMonth: 3,
    ...over,
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 1. SPEAKING FOR A MONTH WE HAVE NOT GOT
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe('speaking for a month we have not got', () => {
    test('a withheld month hides the legend', () => {
        // The defect this rule exists for: a base-roster key standing beside a panel that says we
        // do not yet know this month.
        assert.equal(legendShown('withhold', false), 'hide');
    });

    test('a CACHED month keeps its key — stale is not withheld', () => {
        // The careless fix in the other direction. A device holding good cached data is showing a
        // grid; stripping its key makes the app less useful for no gain in honesty.
        assert.equal(legendShown('stale', false), 'render');
    });

    test('an authoritative month renders', () => {
        assert.equal(legendShown('render', false), 'render');
    });

    test('anything the rule does not recognise HIDES', () => {
        // Fail-closed: a display verdict added later that nobody wired through here must not
        // default into speaking. Silence is recoverable; a confident wrong key is not.
        for (const v of ['', 'pending', 'loading', 'error', 'unknown']) {
            assert.equal(legendShown(v, false), 'hide', `${v} must not render`);
        }
    });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 2. A SYMBOL WITH NO EXPLANATION
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe('a symbol with no explanation', () => {
    test('each row-2 item shows exactly when its type is in the month', () => {
        const TYPE = { 'legend-spare': 'SPARE', 'legend-rdw': 'RDW', 'legend-al': 'AL', 'legend-sick': 'SICK', 'legend-other': 'OTHER' };
        for (const id of ROW_TWO) {
            const on = at({ types: new Set([TYPE[id]]) });
            assert.equal(on[id], true, `${id} must show when ${TYPE[id]} is present`);
            // And the others must NOT — otherwise "shows when present" passes on a rule that
            // shows everything.
            for (const other of ROW_TWO) {
                if (other !== id) assert.equal(on[other], false, `${other} must stay hidden`);
            }
        }
    });

    test('row 2 shows when ANY of its five does, and hides only when none do', () => {
        // Rule 1 in the module header: the row is their container. A sixth item added to the row
        // and not to this test would leave the row collapsed over a key that is present.
        assert.equal(at({ types: new Set() })['legend-row-2'], false);
        for (const t of ['SPARE', 'RDW', 'AL', 'SICK', 'OTHER']) {
            assert.equal(at({ types: new Set([t]) })['legend-row-2'], true, `${t} alone must open row 2`);
        }
    });

    test('nights are a Dispatcher key, and nobody else gets one', () => {
        assert.equal(at({ isDispatcher: true })['legend-night'], true);
        assert.equal(at({ isDispatcher: false })['legend-night'], false);
    });

    test('Christmas is December and only December', () => {
        for (let m = 0; m < 12; m++) {
            assert.equal(at({ displayMonth: m })['legend-christmas'], m === 11, `month ${m}`);
        }
    });

    test('Easter follows the YEAR, including the years it falls in March', () => {
        // Rule 2. Hardcoding April is right about three years in four, which is exactly why it
        // survives review — so the case is driven from the app's own computeEaster.
        for (const year of [2024, 2025, 2026, 2027, 2028]) {
            const easterMonth = computeEaster(year).getMonth();
            assert.equal(at({ displayMonth: easterMonth, easterMonth })['legend-easter'], true,
                `${year}: Easter month ${easterMonth} must show the key`);
            const otherMonth = easterMonth === 3 ? 2 : 3;
            assert.equal(at({ displayMonth: otherMonth, easterMonth })['legend-easter'], false,
                `${year}: month ${otherMonth} must not`);
        }
        // And the premise is real — at least one of those years is a MARCH Easter, or this case
        // is only ever testing April and the rule it guards is untested.
        const months = [2024, 2025, 2026, 2027, 2028].map(y => computeEaster(y).getMonth());
        assert.ok(months.includes(2), `no March Easter in the sample (${months.join(',')}) — widen it`);
    });

    test('no member means no month types, and the key stays quiet', () => {
        // `createLegend` passes an empty Set when there is no current member; nothing in row 2 may
        // appear on the strength of that.
        const on = at({ types: new Set() });
        for (const id of ROW_TWO) assert.equal(on[id], false, id);
        assert.equal(on['legend-row-2'], false);
    });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 3. STANDING DOWN IS NOT HIDING
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe('standing down is not hiding', () => {
    test('Team View gets stand-down whatever the month says', () => {
        for (const v of ['render', 'stale', 'withhold', 'anything']) {
            assert.equal(legendShown(v, true), 'stand-down', `${v} in Team View`);
        }
    });

    test('stand-down is a THIRD answer — it is not spelled the same as hide', () => {
        // The whole point. If these ever compare equal, `createLegend` starts writing `none` over
        // an element Team View owns, and nothing on screen changes until the day it matters.
        assert.notEqual(legendShown('withhold', true), legendShown('withhold', false));
        assert.notEqual(legendShown('render', true), legendShown('render', false));
    });
});
