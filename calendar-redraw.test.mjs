/**
 * calendar-redraw.test.mjs — when the Calendar page may draw, and what its next draw owes (Calendar step 3, v25.75).
 * Run: node scripts/run-tests.mjs calendar-redraw.test.mjs   (part of `npm run test:hygiene`)
 *
 * ── WHAT THIS FILE IS FOR ───────────────────────────────────────────────────────────────────────
 *
 * Until v25.75 the page's coordinator kept five reminders as five variables, with two timers between
 * them: whether the workspace had started, whether the boot had drawn its first surface, a repaint
 * held back for a swipe, a change of name held back for a swipe, and keyboard focus owed to the next
 * grid. Each was right, and none could be tested, because `calendar-app.js` cannot be loaded outside
 * a browser. They are one module now, with the clock handed in, so the four rules in its header are
 * each asserted here against a clock this file owns:
 *
 *   1. never while a gesture is live          — the v16.23 freeze
 *   2. one wait, and what is owed is settled together
 *   3. the surface is asked when the work runs — the v16.21 paint into Team View
 *   4. nothing is repainted before the workspace exists
 *
 * EVERY draw in this file is checked at the moment it happens: the Calendar stub fails the test if
 * it is called while the gesture is live or while Team View is on. So rules 1 and 3 are asserted by
 * every test that draws, not only by the ones named after them.
 *
 * The coordinator cannot be loaded here, so its wiring is pinned from the SOURCE at the foot, and
 * walked in a real browser by e2e/calendar.spec.js (the `redraw:` tests).
 *
 * Pure module: no DOM, no Firebase, no mocks.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRedrawScheduler, GESTURE_POLL_MS, START_STAGES } from './calendar-redraw.js';

const read = (/** @type {string} */ f) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');

/**
 * A page that records what it is asked to do, and a clock the test moves by hand.
 * @param {{ stage?: 'shell'|'workspace'|'surface' }} [opts]
 */
function page({ stage = 'workspace' } = {}) {
    const world = { gesture: false, team: false, picked: 'A', saved: 'A' };
    /** @type {string[]} */ const log = [];
    /** @type {{ at: number, fn: () => void, ms: number }[]} */ let timers = [];
    let now = 0;
    const redraw = createRedrawScheduler({
        gestureLive: () => world.gesture,
        teamViewOn: () => world.team,
        drawCalendar: () => {
            // Rules 1 and 3, checked on EVERY draw this file makes.
            assert.equal(world.gesture, false, 'the Calendar was drawn while a gesture was live');
            assert.equal(world.team, false, 'the Calendar was drawn into Team View');
            log.push(`calendar:${world.saved}`);
        },
        drawTeam: () => { log.push('team'); },
        saveName: () => { world.saved = world.picked; log.push(`save:${world.saved}`); },
        nameApplied: () => { log.push('applied'); },
        setTimer: (fn, ms) => { timers.push({ at: now + ms, fn, ms }); },
    });
    if (stage !== 'shell') redraw.reach(stage);
    return {
        redraw, world, log,
        /** How many polls are waiting to fire. */
        pending: () => timers.length,
        /** Move the clock on, firing what falls due in order — a timer armed by a timer included. */
        tick(/** @type {number} */ ms) {
            const until = now + ms;
            for (;;) {
                const due = timers.filter(t => t.at <= until).sort((a, b) => a.at - b.at)[0];
                if (!due) break;
                timers = timers.filter(t => t !== due);
                now = due.at;
                due.fn();
            }
            now = until;
        },
        draws: () => log.filter(l => l.startsWith('calendar:')).length,
    };
}

describe('start-up is a sequence: shell → workspace → surface', () => {
    test('a page that has only loaded is at `shell`', () => {
        const { redraw } = page({ stage: 'shell' });
        assert.equal(redraw.owed().stage, 'shell');
        assert.equal(redraw.reached('shell'), true);
        assert.equal(redraw.reached('workspace'), false);
        assert.equal(redraw.reached('surface'), false);
    });

    test('reaching a stage says so once, and only once', () => {
        const { redraw } = page({ stage: 'shell' });
        assert.equal(redraw.reach('workspace'), true);
        assert.equal(redraw.reached('workspace'), true);
        assert.equal(redraw.reached('surface'), false);
        assert.equal(redraw.reach('workspace'), false, 'a second first grant would rebuild the workspace');
        assert.equal(redraw.reach('surface'), true);
        assert.equal(redraw.reach('surface'), false);
    });

    test('forward only — a re-lock hides the workspace, it does not unbuild it', () => {
        const { redraw } = page({ stage: 'shell' });
        redraw.reach('surface');
        assert.equal(redraw.reach('workspace'), false);
        assert.equal(redraw.reach('shell'), false);
        assert.equal(redraw.owed().stage, 'surface');
    });

    test('a later stage means the earlier ones were reached', () => {
        const { redraw } = page({ stage: 'shell' });
        redraw.reach('surface');
        assert.equal(redraw.reached('workspace'), true);
        assert.equal(redraw.reached('shell'), true);
    });

    test('a stage nobody declared is a mistake, not a silent "no"', () => {
        const { redraw } = page({ stage: 'shell' });
        // @ts-expect-error — deliberately not a stage
        assert.throws(() => redraw.reach('ready'), /no start-up stage called "ready"/);
        // @ts-expect-error — deliberately not a stage
        assert.throws(() => redraw.reached('ready'), /no start-up stage called "ready"/);
    });

    test('the order is declared once, and cannot be edited from outside', () => {
        assert.deepEqual([...START_STAGES], ['shell', 'workspace', 'surface']);
        assert.equal(Object.isFrozen(START_STAGES), true);
    });
});

describe('rule 4 — nothing is repainted before the workspace exists', () => {
    for (const [label, set] of /** @type {[string, (w: any) => void][]} */ ([
        ['on the Calendar', () => {}],
        ['in Team View', w => { w.team = true; }],
        ['during a gesture', w => { w.gesture = true; }],
    ])) {
        test(`at \`shell\` a background repaint does nothing at all — ${label}`, () => {
            const p = page({ stage: 'shell' });
            set(p.world);
            assert.equal(p.redraw.repaint('date-turned'), 'too-early');
            assert.deepEqual(p.log, []);
            assert.equal(p.pending(), 0, 'and it left no poll behind to draw later');
            assert.deepEqual(p.redraw.owed().repaint, []);
        });
    }

    test('the same request the moment the workspace exists is honoured', () => {
        const p = page({ stage: 'shell' });
        assert.equal(p.redraw.repaint('access-returned'), 'too-early');
        p.redraw.reach('workspace');
        assert.equal(p.redraw.repaint('access-returned'), 'drawn');
        assert.equal(p.draws(), 1);
    });
});

describe('rule 1 — never while a gesture is live', () => {
    test('with no gesture a background repaint draws at once, and arms nothing', () => {
        const p = page();
        assert.equal(p.redraw.repaint('month-read'), 'drawn');
        assert.deepEqual(p.log, ['calendar:A']);
        assert.equal(p.pending(), 0);
    });

    test('during a gesture it is HELD: no draw, one poll, and the reason is kept', () => {
        const p = page();
        p.world.gesture = true;
        assert.equal(p.redraw.repaint('month-read'), 'held');
        assert.deepEqual(p.log, []);
        assert.equal(p.pending(), 1);
        assert.deepEqual(p.redraw.owed().repaint, ['month-read']);
    });

    test('a poll that finds the gesture still live waits on, however long the finger rests', () => {
        const p = page();
        p.world.gesture = true;
        p.redraw.repaint('first-load');
        p.tick(GESTURE_POLL_MS * 10);                       // ten polls, the finger still down
        assert.equal(p.draws(), 0);
        assert.equal(p.pending(), 1, 'still exactly one poll');
        p.world.gesture = false;
        p.tick(GESTURE_POLL_MS);
        assert.deepEqual(p.log, ['calendar:A']);
        assert.equal(p.pending(), 0);
        assert.deepEqual(p.redraw.owed().repaint, []);
    });

    test('a NEW gesture that begins before the next poll holds it again (the pre-intent dead zone)', () => {
        // The first gesture resolves and a second finger goes down inside the same 60ms. A poll that
        // remembered "the gesture ended" instead of ASKING would draw under the second finger.
        const p = page();
        p.world.gesture = true;
        p.redraw.repaint('month-read');
        p.tick(GESTURE_POLL_MS - 10);
        p.world.gesture = false;                              // the first gesture resolves…
        p.tick(5);
        p.world.gesture = true;                               // …and the next begins before the poll
        p.tick(GESTURE_POLL_MS);
        assert.equal(p.draws(), 0);
        p.world.gesture = false;
        p.tick(GESTURE_POLL_MS);
        assert.equal(p.draws(), 1);
    });

    test('a change of name during a gesture is held too, and then saved, drawn and finished in that order', () => {
        const p = page();
        p.world.gesture = true;
        p.world.picked = 'B';
        assert.equal(p.redraw.nameChanged(), 'held');
        assert.deepEqual(p.log, [], 'not even saved: saving first would let a repaint draw the new name mid-gesture');
        assert.equal(p.redraw.owed().name, true);
        p.world.gesture = false;
        p.tick(GESTURE_POLL_MS);
        assert.deepEqual(p.log, ['save:B', 'calendar:B', 'applied']);
        assert.equal(p.redraw.owed().name, false);
    });

    test('a held name change is never dropped, however many polls it waits through (v16.19)', () => {
        const p = page();
        p.world.gesture = true;
        p.world.picked = 'B';
        p.redraw.nameChanged();
        p.tick(GESTURE_POLL_MS * 25);
        assert.equal(p.redraw.owed().name, true);
        p.world.gesture = false;
        p.tick(GESTURE_POLL_MS);
        assert.equal(p.world.saved, 'B');
    });

    test('with no gesture a change of name is applied at once', () => {
        const p = page();
        p.world.picked = 'B';
        assert.equal(p.redraw.nameChanged(), 'applied');
        assert.deepEqual(p.log, ['save:B', 'calendar:B', 'applied']);
        assert.equal(p.pending(), 0);
    });
});

describe('rule 2 — one wait, and what is owed is settled together', () => {
    test('the wait is one poll of 60ms, whatever is held behind it', () => {
        assert.equal(GESTURE_POLL_MS, 60);
        /** @type {number[]} */ const delays = [];
        const never = (/** @type {string} */ what) => () => assert.fail(`${what} while the gesture is live`);
        const redraw = createRedrawScheduler({
            gestureLive: () => true, teamViewOn: () => false, drawCalendar: never('the Calendar was drawn'),
            drawTeam: never('Team View was redrawn'), saveName: never('a name was saved'),
            nameApplied: never('a name was applied'), setTimer: (_fn, ms) => { delays.push(ms); },
        });
        redraw.reach('workspace');
        redraw.repaint('month-read');
        redraw.nameChanged();
        redraw.repaint('date-turned');
        assert.deepEqual(delays, [GESTURE_POLL_MS], 'three things held, ONE poll armed');
    });

    test('several repaints held in one gesture are one draw, and each reason is kept once', () => {
        const p = page();
        p.world.gesture = true;
        p.redraw.repaint('month-read');
        p.redraw.repaint('month-read');
        p.redraw.repaint('date-turned');
        p.redraw.repaint('first-load');
        assert.equal(p.pending(), 1);
        assert.deepEqual(p.redraw.owed().repaint, ['month-read', 'date-turned', 'first-load']);
        p.world.gesture = false;
        p.tick(GESTURE_POLL_MS);
        assert.deepEqual(p.log, ['calendar:A']);
    });

    test('a repaint and a change of name held together are ONE draw, of the new name', () => {
        // With two timers this was two draws, and for up to 60ms the old name's month sat under the
        // new name in the picker.
        const p = page();
        p.world.gesture = true;
        p.redraw.repaint('month-read');
        p.world.picked = 'B';
        p.redraw.nameChanged();
        assert.equal(p.pending(), 1);
        p.world.gesture = false;
        p.tick(GESTURE_POLL_MS * 5);
        assert.deepEqual(p.log, ['save:B', 'calendar:B', 'applied']);
    });

    test('…in whichever order the two arrived', () => {
        const p = page();
        p.world.gesture = true;
        p.world.picked = 'B';
        p.redraw.nameChanged();
        p.redraw.repaint('first-load');
        p.world.gesture = false;
        p.tick(GESTURE_POLL_MS * 5);
        assert.deepEqual(p.log, ['save:B', 'calendar:B', 'applied']);
    });

    test('two picks during the wait are one save, of the latest (the page reads the picker live)', () => {
        const p = page();
        p.world.gesture = true;
        p.world.picked = 'B';
        p.redraw.nameChanged();
        p.world.picked = 'C';
        p.redraw.nameChanged();
        assert.equal(p.pending(), 1, 'the second pick must not stack a second poll (v16.21)');
        p.world.gesture = false;
        p.tick(GESTURE_POLL_MS * 5);
        assert.deepEqual(p.log, ['save:C', 'calendar:C', 'applied']);
    });

    test('a repaint that arrives after the gesture, but before the poll, settles the held name with it', () => {
        const p = page();
        p.world.gesture = true;
        p.world.picked = 'B';
        p.redraw.nameChanged();
        p.world.gesture = false;                              // the gesture ends; the poll has not fired
        assert.equal(p.redraw.repaint('month-read'), 'drawn');
        assert.deepEqual(p.log, ['save:B', 'calendar:B', 'applied'], 'never the old name under the new one');
        p.tick(GESTURE_POLL_MS * 5);
        assert.equal(p.draws(), 1, 'and the poll that follows finds nothing left to do');
    });

    test('a change of name that arrives after the gesture, but before the poll, settles the held repaint with it', () => {
        const p = page();
        p.world.gesture = true;
        p.redraw.repaint('month-read');
        p.world.gesture = false;
        p.world.picked = 'B';
        assert.equal(p.redraw.nameChanged(), 'applied');
        p.tick(GESTURE_POLL_MS * 5);
        assert.deepEqual(p.log, ['save:B', 'calendar:B', 'applied']);
    });

    test('once settled, the next gesture gets a wait of its own', () => {
        const p = page();
        for (const name of ['B', 'C']) {
            p.world.gesture = true;
            p.world.picked = name;
            p.redraw.nameChanged();
            assert.equal(p.pending(), 1);
            p.world.gesture = false;
            p.tick(GESTURE_POLL_MS);
        }
        assert.deepEqual(p.log, ['save:B', 'calendar:B', 'applied', 'save:C', 'calendar:C', 'applied']);
        assert.equal(p.pending(), 0);
    });

    test('nothing held means nothing drawn: a poll with an empty hand is silent', () => {
        const p = page();
        p.world.gesture = true;
        p.redraw.repaint('month-read');
        p.world.gesture = false;
        p.redraw.repaint('month-read');                       // drawn directly; the earlier poll is still armed
        assert.equal(p.draws(), 1);
        p.tick(GESTURE_POLL_MS * 5);
        assert.equal(p.draws(), 1);
    });

    test('the DEFAULT clock: held, then drawn once the gesture has gone — and it polls, it does not spin', () => {
        // This ran on the real clock and counted 3–6 polls in ~210ms, which failed once on a loaded machine
        // (external review, Nov 2026). What it guards is the WIRING of the default timer, so the global
        // setTimeout the default calls is recorded instead, and the timers are fired by hand: every wait is
        // armed with the poll interval — never 0, which would spin on the phone's main thread mid-swipe —
        // one at a time, and the draw comes on the first poll after the gesture ends. Synchronous, so
        // nothing else can run while the global is replaced.
        /** @type {{ fn: () => void, ms: number }[]} */ const armed = [];
        const realSetTimeout = globalThis.setTimeout;
        let live = true, draws = 0;
        globalThis.setTimeout = /** @type {any} */ ((/** @type {() => void} */ fn, /** @type {number} */ ms) => { armed.push({ fn, ms }); return armed.length; });
        try {
            const redraw = createRedrawScheduler({
                gestureLive: () => live, teamViewOn: () => false,
                drawCalendar: () => { assert.equal(live, false, 'the Calendar was drawn while a gesture was live'); draws++; },
                drawTeam: () => {}, saveName: () => {}, nameApplied: () => {},
            });
            redraw.reach('workspace');
            assert.equal(redraw.repaint('month-read'), 'held');
            for (let i = 0; i < 3; i++) {
                assert.equal(armed.length, i + 1, 'exactly one wait is armed at a time');
                assert.equal(armed[i].ms, GESTURE_POLL_MS, 'a wait armed without the poll delay is a spin');
                armed[i].fn();                                   // a poll while the gesture is still live re-arms
            }
            assert.equal(draws, 0, 'drawn while the gesture was live');
            live = false;
            armed[3].fn();
            assert.equal(draws, 1, 'drawn on the first poll after the gesture ended');
            assert.equal(armed.length, 4, 'and nothing is armed once it has drawn');
        } finally {
            globalThis.setTimeout = realSetTimeout;
        }
    });
});

describe('rule 3 — the surface is asked when the work runs', () => {
    test('in Team View a background repaint redraws the WEEK, at once, and holds nothing', () => {
        const p = page();
        p.world.team = true;
        assert.equal(p.redraw.repaint('month-read'), 'team');
        assert.deepEqual(p.log, ['team']);
        assert.deepEqual(p.redraw.owed().repaint, []);
        assert.equal(p.pending(), 0);
    });

    test('…during a swipe\'s cooldown too: nothing swipes on Team View, and its redraw keeps focus and scroll', () => {
        const p = page();
        p.world.team = true;
        p.world.gesture = true;
        assert.equal(p.redraw.repaint('first-load'), 'team');
        assert.deepEqual(p.log, ['team']);
        assert.equal(p.pending(), 0);
    });

    test('a Calendar repaint held while Team View is OPENED is dropped, not painted into it (v16.21)', () => {
        const p = page();
        p.world.gesture = true;
        p.redraw.repaint('month-read');
        p.world.team = true;                                  // Team View opened during the wait
        p.world.gesture = false;
        p.tick(GESTURE_POLL_MS * 5);
        assert.deepEqual(p.log, [], 'entering Team View drew it; leaving it draws the Calendar afresh');
        assert.deepEqual(p.redraw.owed().repaint, [], 'and nothing is left owed to fire later');
    });

    test('a name held while Team View is opened is still SAVED, and the Calendar is still not drawn', () => {
        const p = page();
        p.world.gesture = true;
        p.world.picked = 'B';
        p.redraw.nameChanged();
        p.world.team = true;
        p.world.gesture = false;
        p.tick(GESTURE_POLL_MS * 5);
        assert.deepEqual(p.log, ['save:B', 'applied']);
        assert.equal(p.world.saved, 'B');
    });

    test('a change of name made in Team View is saved at once and draws no Calendar', () => {
        const p = page();
        p.world.team = true;
        p.world.picked = 'B';
        assert.equal(p.redraw.nameChanged(), 'applied');
        assert.deepEqual(p.log, ['save:B', 'applied']);
    });

    test('asked at the time in BOTH directions: Team View opened and left again before the poll still draws', () => {
        const p = page();
        p.world.gesture = true;
        p.redraw.repaint('month-read');
        p.world.team = true;
        p.tick(GESTURE_POLL_MS);                              // still mid-gesture: waits on
        p.world.team = false;
        p.world.gesture = false;
        p.tick(GESTURE_POLL_MS);
        assert.deepEqual(p.log, ['calendar:A']);
    });

    test('a repaint that lands in Team View does not settle a name held for the Calendar', () => {
        // The week is redrawn; the name waits for its gesture like anything else that is held.
        const p = page();
        p.world.gesture = true;
        p.world.picked = 'B';
        p.redraw.nameChanged();
        p.world.team = true;
        assert.equal(p.redraw.repaint('month-read'), 'team');
        assert.deepEqual(p.log, ['team']);
        assert.equal(p.redraw.owed().name, true);
        p.world.gesture = false;
        p.tick(GESTURE_POLL_MS);
        assert.deepEqual(p.log, ['team', 'save:B', 'applied']);
    });
});

describe('keyboard focus across a draw', () => {
    const onCell = { onCell: true, nowhere: false };
    const nowhere = { onCell: false, nowhere: true };
    const onAControl = { onCell: false, nowhere: false };

    test('a focused day cell is handed to the grid that replaces it', () => {
        const { redraw } = page();
        assert.equal(redraw.focusWanted(onCell), true);
        redraw.focusSettled(true, true);
        assert.equal(redraw.owed().focus, false);
    });

    test('focus that was never in the grid is never taken into it', () => {
        const { redraw } = page();
        assert.equal(redraw.focusWanted(nowhere), false);
        assert.equal(redraw.focusWanted(onAControl), false);
    });

    test('a panel with no day cells OWES the focus to the grid that follows it (10 Nov 2026)', () => {
        const { redraw } = page();
        // PageDown onto a month still loading: the cell had focus, "Checking this month" has no cell.
        assert.equal(redraw.focusWanted(onCell), true);
        redraw.focusSettled(true, false);
        assert.equal(redraw.owed().focus, true);
        // The read lands and the grid is drawn: focus fell to <body> in between.
        assert.equal(redraw.focusWanted(nowhere), true);
        redraw.focusSettled(true, true);
        assert.equal(redraw.owed().focus, false);
        // Paid once: the draw after that takes nothing.
        assert.equal(redraw.focusWanted(nowhere), false);
    });

    test('the debt survives two panels in a row — checking, then "couldn\'t check"', () => {
        const { redraw } = page();
        redraw.focusSettled(redraw.focusWanted(onCell), false);
        const second = redraw.focusWanted(nowhere);
        assert.equal(second, true);
        redraw.focusSettled(second, false);
        assert.equal(redraw.owed().focus, true);
        assert.equal(redraw.focusWanted(nowhere), true);
    });

    test('a reader who has moved to a control keeps their place, and the debt is written off', () => {
        const { redraw } = page();
        redraw.focusSettled(redraw.focusWanted(onCell), false);
        const wanted = redraw.focusWanted(onAControl);        // they tabbed to Next while it loaded
        assert.equal(wanted, false);
        redraw.focusSettled(wanted, false);
        assert.equal(redraw.owed().focus, false);
        assert.equal(redraw.focusWanted(nowhere), false, 'a later draw must not pull them back');
    });

    test('the debt is the grid\'s alone: holding and settling a repaint leaves it as it was', () => {
        const p = page();
        p.redraw.focusSettled(p.redraw.focusWanted(onCell), false);
        p.world.gesture = true;
        p.redraw.repaint('month-read');
        p.world.gesture = false;
        p.tick(GESTURE_POLL_MS);
        assert.equal(p.redraw.owed().focus, true);
    });
});

describe('what is owed can be read, and is a copy', () => {
    test('a snapshot, not a handle on the state', () => {
        const p = page();
        p.world.gesture = true;
        p.redraw.repaint('month-read');
        const owed = p.redraw.owed();
        owed.repaint.push('date-turned');
        owed.name = true;
        assert.deepEqual(p.redraw.owed(), { name: false, repaint: ['month-read'], focus: false, stage: 'workspace' });
    });
});

// ── THE PAGE'S WIRING, PINNED FROM THE SOURCE ───────────────────────────────────────────────────
// calendar-app.js cannot be loaded here (it is the page). What these pin is that the page hands the
// decisions over and keeps none of its own; that they WORK in a browser is e2e/calendar.spec.js.
describe('calendar-app.js hands the decisions over, and keeps none', () => {
    const app = read('calendar-app.js');
    const code = app.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

    test('the page asks whether a gesture is live in ONE place: the hand-over to the scheduler', () => {
        // A new deferred job with a timer of its own has to ask this question to be safe — which is
        // exactly the sixth variable and third timer the module exists to prevent. It joins the wait.
        const uses = code.match(/\bisSwipeGestureActive\b/g) ?? [];
        assert.equal(uses.length, 2, 'expected the import and `gestureLive: isSwipeGestureActive` only');
        assert.match(code, /gestureLive:\s*isSwipeGestureActive\b/);
    });

    test('every reason the page gives is one the scheduler declares, and every declared reason has a caller', () => {
        const declared = read('calendar-redraw.js').match(/@typedef \{([^}]+)\} RepaintWhy/)?.[1]
            .split('|').map(s => s.trim().replace(/'/g, '')).sort();
        const given = [...new Set([...code.matchAll(/redraw\.repaint\('([^']+)'\)/g)].map(m => m[1]))].sort();
        assert.deepEqual(declared, ['access-returned', 'date-turned', 'first-load', 'month-read']);
        assert.deepEqual(given, declared);
    });

    test('a month read repaints through ONE function, so several waits on a month repaint once', () => {
        // `ensureOverridesCached` keeps its waiters by identity. An inline arrow at any of these three
        // would be a new waiter on every render, and a month read would repaint once per render.
        assert.match(code, /function _repaintAfterMonthRead\(\) \{ redraw\.repaint\('month-read'\); \}/);
        assert.match(code, /ensureOverridesCached\(getDisplayYear\(\), getDisplayMonth\(\), _repaintAfterMonthRead\)/);
        assert.match(code, /onMonthRead: _repaintAfterMonthRead,/);
        assert.match(code, /renderCalendar: _repaintAfterMonthRead,/);
    });

    test('the first load repaints through the scheduler on both surfaces', () => {
        assert.match(code, /function _repaintAfterFirstLoad\(\) \{ redraw\.repaint\('first-load'\); _markReadyIfGridShown\(\); \}/);
        assert.match(code, /renderCalendar: _repaintAfterFirstLoad,/);
        assert.match(code, /renderTeamView: _repaintAfterFirstLoad,/);
    });

    test('the name picker, the date turning and a returning grant each go through it', () => {
        assert.match(code, /addEventListener\('change', \(\) => \{ redraw\.nameChanged\(\); \}\)/);
        assert.match(code, /if \(hasOverrideAccess\(\)\) redraw\.repaint\('date-turned'\);/);
        assert.match(code, /else redraw\.repaint\('access-returned'\);/);
    });

    test('start-up moves on in two places, and the page reads the stage where it used a flag', () => {
        assert.equal((code.match(/redraw\.reach\(/g) ?? []).length, 2);
        assert.match(code, /onGranted: \(\) => \{\s*redraw\.reach\('workspace'\);/);
        assert.match(code, /redraw\.reach\('surface'\);[^\n]*\n\s*_markReadyIfGridShown\(\);/);
        assert.match(code, /if \(!redraw\.reached\('workspace'\)\) return;/);
        assert.match(code, /if \(!redraw\.reached\('surface'\)\) return;/);
    });

    test('the focus debt is asked before the grid is replaced, and settled after', () => {
        const ask = code.indexOf('redraw.focusWanted(');
        const wipe = code.indexOf("calendarDisplay.innerHTML = ''", ask);
        const settle = code.indexOf('redraw.focusSettled(_wantsFocus, !!_anchor)', wipe);
        assert.ok(ask > 0 && wipe > ask && settle > wipe, 'focusWanted → replace the grid → focusSettled');
    });
});
