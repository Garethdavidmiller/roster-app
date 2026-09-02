// @ts-check
/**
 * settings-status.js — IS THIS ACCOUNT AND THIS DEVICE SET UP, AND WHAT IS LEFT?
 *
 * Owns: what each Settings card's state MEANS — the chip it wears, whether it opens itself, and
 *   the one line at the top of the page that answers the question people actually arrive with.
 * Does NOT own: any read. Nothing here touches Firestore, localStorage, the Notification API or
 *   the DOM. Each card reports its own state as its own data lands.
 * Edit here for: a new card, a new state, or the words either wears.
 *
 * ── WHY IT RUNS NO READS ──────────────────────────────────────────────────────────────────────
 *
 * Same discipline as `operations-attention.js`, and for the same reason: an index that fetches its
 * own copy of the data can disagree with the card beside it, and then two things on one screen
 * state different facts about the same setting. The card owns the read; this owns the meaning.
 *
 * ── THE RULE THAT MAKES THE SUMMARY WORTH ANYTHING ────────────────────────────────────────────
 *
 * **Silence is not success.** Three of the four states arrive asynchronously — the work email and
 * the password status from Firestore, the notification permission from the browser — so at first
 * paint the page knows nothing, and a summary that says "You're all set" from an empty report set
 * would be reassuring, instant and wrong. It is the exact failure `operations-attention.js` was
 * written to avoid ("an unreported card is unknown, never zero"), arriving on a different page.
 *
 * So `unknown` is a state with a name, it OUTRANKS every answer, and while any card holds it the
 * summary says it is still checking. A failed read is `error`, which also never reads as OK: it
 * opens the card, because a member who cannot be told whether their password is set should be
 * looking at the form rather than at a tick.
 *
 * ── THE ORDER IS DECLARED, NOT OBSERVED ───────────────────────────────────────────────────────
 *
 * `CARD_ORDER` fixes the sequence of the to-do list. It would be easier to list them as they
 * report, and that would reorder the line between page loads depending on which network answer
 * came back first — a list that shuffles reads as a list that is describing something changing.
 *
 * Tested by settings-status.test.mjs.
 */

/**
 * @typedef {'ok'|'action'|'blocked'|'error'|'unknown'|'n/a'} CardState
 *   ok       — configured, nothing to do.
 *   action   — the member can fix this here, now.
 *   blocked  — the member cannot fix it here (notifications denied at the OS/browser level); it
 *              still needs saying, but "Turn on notifications" would be a lie about what happens.
 *   error    — the read failed. NOT ok, and not a to-do either: nothing was learnt.
 *   unknown  — not reported yet. Outranks everything.
 *   n/a      — this card cannot be in a good or bad state on this device (notifications are
 *              unsupported; pay data is informational). Excluded from the summary entirely.
 */

/**
 * The cards the summary speaks for, in the order their to-dos are listed.
 *
 * Password first: it is the security migration, and the one with a deadline behind it. Then the
 * work email, which is what makes a future self-service reset possible. Notifications last — a
 * missing notification is an inconvenience, not an account problem. `pay-data` is deliberately
 * ABSENT: it has no wrong state, so it can never be a to-do and can never delay "all set".
 */
export const CARD_ORDER = ['password', 'work-email', 'notifications'];

/** What each card's `action` state asks the member to DO. Imperative, and short enough to sit in a
 *  list of three on a 360px phone.
 *  @type {Record<string, string>} */
const TODO_LABEL = {
    'password':      'Set your own password',
    'work-email':    'Add your work email',
    'notifications': 'Turn on notifications',
};

/** What a `blocked` card says instead — the member cannot do the thing the to-do would name.
 *  @type {Record<string, string>} */
const BLOCKED_LABEL = {
    'notifications': 'Notifications are blocked on this phone',
};

/**
 * Does this state mean the card should open itself?
 *
 * Anything the member has to look at: a to-do, a block, or a read that failed. `unknown` does NOT
 * open — the page is still deciding, and a card that opens and then shuts again as the answer
 * lands is worse than one that opens once, late.
 *
 * @param {CardState} state
 * @returns {boolean}
 */
export function shouldOpen(state) {
    return state === 'action' || state === 'blocked' || state === 'error';
}

/**
 * The summary line for the top of the page.
 *
 * @param {Record<string, CardState>} states card id → state. A card missing from this map is
 *   `unknown`, which is the whole point: nothing has to remember to report "not yet".
 * @returns {{ tone: 'checking'|'all-set'|'todo'|'error', headline: string, items: string[] }}
 *   `items` names what is outstanding, in `CARD_ORDER`. Empty unless tone is 'todo'.
 */
export function summarise(states) {
    const at = /** @param {string} id */ id => states[id] ?? 'unknown';

    // Unknown outranks every other answer. Not "optimistically all set until proven otherwise":
    // the reassurance is the thing being got wrong, so it has to be the thing that waits.
    if (CARD_ORDER.some(id => at(id) === 'unknown')) {
        return { tone: 'checking', headline: 'Checking your settings…', items: [] };
    }

    const items = CARD_ORDER
        .filter(id => at(id) === 'action' || at(id) === 'blocked')
        .map(id => (at(id) === 'blocked' ? BLOCKED_LABEL[id] : TODO_LABEL[id]) || id);

    if (items.length) {
        return {
            tone: 'todo',
            headline: items.length === 1 ? '1 thing to finish' : `${items.length} things to finish`,
            items,
        };
    }

    // Everything reported, nothing outstanding — but a card whose read FAILED has not told us it is
    // fine, it has told us nothing. Saying "all set" over the top of that is the same lie as saying
    // it over silence, arriving one step later.
    if (CARD_ORDER.some(id => at(id) === 'error')) {
        return { tone: 'error', headline: 'Some settings could not be checked', items: [] };
    }

    return { tone: 'all-set', headline: '✓ You’re all set', items: [] };
}
