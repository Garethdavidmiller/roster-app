// @ts-check
/**
 * calendar-redraw.js — WHEN THE CALENDAR PAGE MAY DRAW, AND WHAT ITS NEXT DRAW OWES (Calendar step 3, v25.75).
 *
 * Owns: how far the page's start-up has got; the ONE wait for a swipe to finish, and the two things
 *   that wait behind it (a background repaint, a change of name in the picker); the keyboard focus
 *   a panel with no day cells owes the grid that follows it.
 * Does NOT own: drawing (calendar-app.js → `renderCalendar`, calendar-team-view.js), whether a
 *   gesture is live (calendar-swipe.js → `isSwipeGestureActive`), saving the chosen name
 *   (calendar-member.js), or what a month is known to be (calendar-data-state.js). It is handed the
 *   first three and decides only WHEN, and on WHICH surface.
 * Edit here for: a new thing that has to wait for the gesture, or a new start-up stage. It joins
 *   the one wait; it does not get a timer of its own.
 *
 * ── WHY ONE PLACE ───────────────────────────────────────────────────────────────────────────────
 *
 * Until v25.75 calendar-app.js kept five reminders, each a variable of its own with its own rules:
 * whether the workspace had started, whether the boot had drawn its first surface, a repaint held
 * back for a swipe (polled every 120ms), a name change held back for a swipe (polled every 60ms),
 * and focus owed to the next grid. Every one was right. What was fragile was that nothing said they
 * were the same kind of thing, so the next deferred job would have been a sixth variable and a
 * third timer — and two of the five already were one rule written twice.
 *
 * ── FOUR RULES, EACH ONE A LINE BELOW ───────────────────────────────────────────────────────────
 *
 *   1. NEVER WHILE A GESTURE IS LIVE. A Calendar draw replaces `#calendarDisplay`, and the swipe's
 *      three panels live in it: a draw that landed mid-gesture detached them, the commit then
 *      animated dead nodes, and the grid froze on the OLD month while the title, the legend and
 *      the saved month moved on (v16.23). So work that replaces the grid waits for the WHOLE
 *      gesture — pointerdown to resolution, and the commit's cooldown — and it asks again at every
 *      tick, because a new gesture can begin before the tick that follows the last one.
 *   2. ONE WAIT, AND WHAT IS OWED IS SETTLED TOGETHER. A name change and a held repaint are one
 *      draw, of the new name. With two independent timers the page drew twice, and for up to 60ms
 *      showed the old name's month under the new name in the picker. A name change is never
 *      dropped, only held: the picker has already moved, and a dropped change left it showing one
 *      name over another's roster for good (v16.19).
 *   3. THE SURFACE IS ASKED WHEN THE WORK RUNS, not when it was asked for. Team View can be opened
 *      while a draw is held; a Calendar draw then would paint the month into the display Team View
 *      is using (v16.21). The held draw is dropped — leaving Team View draws the Calendar afresh —
 *      and the name is still saved.
 *   4. NOTHING IS REPAINTED BEFORE THE WORKSPACE EXISTS. A background repaint asked for at stage
 *      `shell` has nothing to repaint: the first grant builds the workspace, and draws it.
 *
 * ── START-UP IS A SEQUENCE ──────────────────────────────────────────────────────────────────────
 *
 *   shell      the module has loaded: the header, the drawer, About, the document viewers and the
 *              lock slot are wired. A Calendar that stays locked stays here.
 *   workspace  the first grant: the workspace is being built (the name picker, the first
 *              three-month read, the first draw). From here a repaint has something to repaint.
 *   surface    the boot has drawn its first surface, the Calendar or Team View. From here the
 *              "usable" timing may measure what is on screen, and the swipe is wired.
 *
 * Forward only. A re-lock does not go back: the workspace is hidden then, not unbuilt, which is why
 * a re-grant repaints and the first grant builds.
 *
 * No imports, and no DOM: everything it acts on is handed in, so it loads in Node and its timing is
 * tested with a clock the test owns.
 */

/** How often a held job asks whether the gesture has finished. The shorter of the two periods this
 *  replaced: a name the member has just picked must not feel as if it did not take. */
export const GESTURE_POLL_MS = 60;

/** The start-up stages, in order. */
export const START_STAGES = Object.freeze(/** @type {const} */ (['shell', 'workspace', 'surface']));

/** @typedef {'shell'|'workspace'|'surface'} StartStage */
/** Why a background repaint was asked for. Kept while it is held, so what is owed can be read.
 *  @typedef {'first-load'|'month-read'|'date-turned'|'access-returned'} RepaintWhy */

/**
 * @param {object} deps
 * @param {() => boolean} deps.gestureLive   calendar-swipe.js → `isSwipeGestureActive`
 * @param {() => boolean} deps.teamViewOn    is Team View the surface on screen?
 * @param {() => void} deps.drawCalendar     draw the month (it replaces the grid)
 * @param {() => void} deps.drawTeam         redraw Team View's week from what is held
 * @param {() => void} deps.saveName         save the picker's CURRENT selection. Read live by the
 *   page, so a second pick during the wait is the one saved.
 * @param {() => void} deps.nameApplied      runs last, once the new name is saved and drawn
 * @param {(fn: () => void, ms: number) => any} [deps.setTimer]  the clock; a test hands in its own
 */
export function createRedrawScheduler({ gestureLive, teamViewOn, drawCalendar, drawTeam, saveName, nameApplied,
                                        setTimer = (fn, ms) => setTimeout(fn, ms) }) {
    let stage = 0;
    /** The background repaints of the Calendar that are held, by reason. @type {Set<RepaintWhy>} */
    const held = new Set();
    let nameHeld = false;
    let waiting = false;      // ONE poll, however much is held (rule 2)
    let focusOwed = false;

    /** @param {StartStage} name @returns {number} */
    const indexOf = (name) => {
        const i = START_STAGES.indexOf(name);
        if (i < 0) throw new Error(`calendar-redraw: no start-up stage called "${name}"`);
        return i;
    };

    /** Everything that is owed, in one go (rule 2), on the surface that is live NOW (rule 3). */
    function settle() {
        const name = nameHeld, repaint = held.size > 0;
        nameHeld = false;
        held.clear();
        if (name) saveName();                                       // saved whichever surface is on screen
        if ((name || repaint) && !teamViewOn()) drawCalendar();     // ONE draw for both; none into Team View
        if (name) nameApplied();
    }

    /** Ask again in a moment. A tick that finds a gesture live — the same one, or a new one — waits on. */
    function wait() {
        if (waiting) return;
        waiting = true;
        setTimer(() => { waiting = false; if (gestureLive()) wait(); else settle(); }, GESTURE_POLL_MS);
    }

    return {
        /**
         * Move start-up on to `name`. Forward only: reaching a stage already passed changes nothing.
         * @param {StartStage} name
         * @returns {boolean} whether this call moved it
         */
        reach(name) {
            const i = indexOf(name);
            if (i <= stage) return false;
            stage = i;
            return true;
        },

        /** @param {StartStage} name @returns {boolean} whether start-up has got at least this far */
        reached(name) { return stage >= indexOf(name); },

        /**
         * A BACKGROUND repaint of whichever surface is live: a read has landed, the date has turned,
         * access has come back. Nobody pressed anything, so it may not interrupt a gesture (rule 1).
         * Team View is redrawn at once — no gesture runs on it, and its redraw keeps focus and scroll.
         * @param {RepaintWhy} why
         * @returns {'too-early'|'team'|'drawn'|'held'}
         */
        repaint(why) {
            if (stage < indexOf('workspace')) return 'too-early';   // rule 4
            if (teamViewOn()) { drawTeam(); return 'team'; }
            held.add(why);
            if (gestureLive()) { wait(); return 'held'; }
            settle();
            return 'drawn';
        },

        /**
         * The picker's selection changed. Applied now, or as soon as the gesture has finished.
         * @returns {'applied'|'held'}
         */
        nameChanged() {
            nameHeld = true;
            if (gestureLive()) { wait(); return 'held'; }
            settle();
            return 'applied';
        },

        /**
         * KEYBOARD FOCUS ACROSS A DRAW. Replacing the grid drops focus to <body>, after which the
         * page's arrow keys change the MONTH instead of the day. So a draw that replaces a focused
         * day cell gives focus to the new grid's anchor cell — and when the new panel has no day
         * cells ("Checking this month", the failure panel) the focus is OWED to the grid that follows
         * it (10 Nov 2026), as long as it is still nowhere: a reader who has since moved it to a
         * control keeps it there.
         *
         * Asked BEFORE the grid is replaced, with where focus is now.
         * @param {{ onCell: boolean, nowhere: boolean }} at  on a day cell · on <body> or nothing
         * @returns {boolean} whether the grid about to be drawn should take focus
         */
        focusWanted({ onCell, nowhere }) { return onCell || (focusOwed && nowhere); },

        /**
         * Told AFTER the draw: what `focusWanted` answered, and whether a cell was there to take it.
         * @param {boolean} wanted @param {boolean} given
         */
        focusSettled(wanted, given) { focusOwed = wanted && !given; },

        /** What the next draw owes — for a reader, and for the tests.
         *  @returns {{ name: boolean, repaint: RepaintWhy[], focus: boolean, stage: StartStage }} */
        owed() { return { name: nameHeld, repaint: [...held], focus: focusOwed, stage: START_STAGES[stage] }; },
    };
}
