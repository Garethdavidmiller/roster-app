// @ts-check
/**
 * links-build-press.js — what the Links "Build the link" press SAYS and remembers: why a table was
 * refused, the question it asks before replacing a design, the line it reports, and which build of
 * these inputs this is. Pure: no DOM, no Firebase. Tested by links-build-press.test.mjs; the press
 * itself (the confirm, the held button, the scroll anchor) is the coordinator's, end to end in
 * e2e/links.spec.js.
 *
 * ── RULES AN EDIT CAN BREAK ─────────────────────────────────────────────────────────────────────
 *
 * 1. **Each refusal names its own remedy, and the two hours refusals are OPPOSITES** — a designer
 *    reading "add duties" under a surplus would make it worse — so they are never one message with
 *    a sign in it. `short-hours` and `over-hours` state the SIZE of the gap: the duty in the table
 *    against the working lines is arithmetic, and the number is the whole answer.
 * 2. **The refusal's hours average is the card's**, `assessTargetHours`'s `hoursPerLine` — a cover
 *    week as a full contracted week, over the whole rotation. A refusal quoting a different average
 *    from the row it refuses on behalf of would be two numbers for one fact, in the same second.
 * 3. **The line names the construction.** Settled weeks keep a line inside one wave of start times;
 *    the fallback walks it across the day. A designer not told which they got cannot account for it.
 * 4. **A target the build missed is said** (the run cap): a box naming a target the design silently
 *    misses is the phantom guarantee this generator shipped once.
 * 5. **Pressing again EXPLORES, and the numbering means the same design on every device.** Same
 *    inputs: the next attempt (the reorder is seeded on it, never the clock). Any change: attempt 0.
 *    An order already seen is said to be that design again — never renumbered — and the best so far
 *    on the ticked objectives is tracked, with how to get it back.
 * 6. **Lines past the rotation are kept** (`withSurplusLines`): a design saved at an older, longer
 *    length keeps them in Firestore, and the over-length notice promises they are kept and saved.
 */

import { CONTRACTED_HOURS_PER_WEEK, MIN_REST_MINUTES, hmFromHours } from './links-design.js';

/** What each day class is called in a sentence. */
const DAY_CLASS = /** @type {Record<string, string>} */ ({ weekday: 'Mon–Fri', sat: 'Saturday', sun: 'Sunday' });

/**
 * The day classes asking for more lines than the link has — duties plus cover weeks — or ''.
 * @param {Record<string, number>} totals  per day class, cover weeks included (`targets.totals()`)
 * @param {number} lines
 */
export function overCapacityLine(totals, lines) {
    const over = ['weekday', 'sat', 'sun'].filter(c => totals[c] > lines);
    if (!over.length) return '';
    const asks = over.map(c => `${DAY_CLASS[c]} needs ${totals[c]} lines`);
    return `Can't build the link — ${asks.join(', ')} (duties plus cover weeks) and the link has ${lines}. `
        + `Lower ${over.length === 1 ? `a ${DAY_CLASS[over[0]]} count` : 'those days’ counts'} or use fewer cover weeks.`;
}

/**
 * Why `generateLink` refused (rule 1).
 * @param {{ reason?: string|null, askedMinutes?: number|null, needMinutes?: number|null, shortRest?: number|null }} built
 * @param {{ lines: number, spareLines: number, hoursPerLine?: number|null }} ctx  `hoursPerLine` is `assessTargetHours`'s (rule 2)
 */
export function refusalLine(built, { lines, spareLines, hoursPerLine = null }) {
    const asked = built.askedMinutes ?? 0, need = built.needMinutes ?? 0;
    // A table with no Mon–Sat duty has no average: "0h 00m" would read as a finding about the targets.
    const gap = hoursPerLine === null
        ? `These targets hold no duty from Monday to Saturday, and the contract is ${CONTRACTED_HOURS_PER_WEEK}h a week.`
        : `These targets average ${hmFromHours(hoursPerLine)} a week across all ${lines} lines, and the contract is ${CONTRACTED_HOURS_PER_WEEK}h.`;
    switch (built.reason) {
        case 'short-hours':
            return `Can't build the link — ${gap} That is ${hmFromHours((need - asked) / 60)} a week of duty missing `
                + `across the rotation. Add duties, lengthen them, or use more cover weeks.`;
        case 'over-hours':
            return `Can't build the link — ${gap} That is ${hmFromHours((asked - need) / 60)} a week of duty more than `
                + `the rotation is paid for. Remove duties, shorten them, or use fewer cover weeks — the surplus `
                + `would be permanent overtime nobody has agreed to.`;
        // `cappedStarts` refuses when a week's duties leave the working lines under one rest day each.
        case 'no-rest':
            return `Can't build the link — these targets ask for more than six duties a week from each working line, `
                + `so not every line can have a rest day. Reduce a day's headcount, or use fewer cover weeks.`;
        // The one refusal whose remedy is a SHIFT TIME: no swap gives somebody the minimum rest.
        case 'short-rest':
            return `Can't build the link — one shift would follow another with only ${hmFromHours((built.shortRest ?? 0) / 60)} `
                + `rest, and the minimum is ${hmFromHours(MIN_REST_MINUTES / 60)}. No arrangement of these lines fixes it. `
                + `Move a late finish earlier or a following start later.`;
        // Not reachable by typing (the box stops a line short); a remembered table or a saved setup can.
        case 'bad-spare-lines':
            return `Can't build the link — ${spareLines} cover weeks leaves no working lines. `
                + `Cover weeks must be fewer than the ${lines} lines.`;
        default:
            return `Can't build the link — check every row has a valid time and whole-number targets.`;
    }
}

/**
 * The question asked before a build replaces what is on screen. A proposal is not replaced — the
 * build opens a NEW design beside it — so it has its own words; the lossy sentence is said only when
 * something unsaved would go.
 * @param {{ lines: number, name: string, proposal: boolean, dirty: boolean, hasWork: boolean }} s
 * @returns {{ title: string, message: string, confirmLabel: string, danger: boolean }}
 */
export function buildConfirm({ lines, name, proposal, dirty, hasWork }) {
    const message = proposal
        ? `A new design opens with the built pattern. “${name}” stays in the shortlist${dirty ? ' — your unsaved changes to it will be lost' : ''}.`
        : hasWork
            ? `This replaces all ${lines} lines of “${name || 'this design'}” on screen with the built pattern. `
              + `The saved version stays as it is until you press Save.${dirty ? ' Your unsaved changes will be lost.' : ''}`
            : `Build the pattern into all ${lines} lines?`;
    return { title: 'Build the link', message, confirmLabel: 'Build', danger: proposal ? dirty : hasWork };
}

/**
 * The built patterns, with any lines past the rotation the design already held carried over (rule 6).
 * @param {Record<string, any>} built @param {Record<string, any>|null|undefined} previous @param {number} lines
 */
export function withSurplusLines(built, previous, lines) {
    const surplus = Object.entries(previous ?? {}).filter(([k]) => Number(k) > lines);
    return surplus.length ? { ...built, ...Object.fromEntries(surplus) } : built;
}

/**
 * Which build of these inputs this is (rule 5). One per page life: reloading and pressing k times
 * replays the same k designs.
 */
export function createBuildCounter() {
    let fingerprint = '';
    let attempt = 0;
    /** @type {{c: number, n: number}|null} */ let best = null;
    /** order → the first design that wore it. @type {Map<string, number>} */ const seen = new Map();
    return {
        /** The attempt for these inputs: the next one if they are unchanged, else 0. @param {string} fp */
        next(fp) {
            if (fp === fingerprint) attempt += 1;
            else { attempt = 0; best = null; seen.clear(); }
            fingerprint = fp;
            return attempt;
        },
        /**
         * What this build says about the exploring: the order it made and its cost on the ticked objectives.
         * @param {string} orderKey @param {number} c
         */
        explore(orderKey, c) {
            const sameAs = seen.get(orderKey);
            if (sameAs === undefined) seen.set(orderKey, attempt + 1);
            if (attempt === 0) { best = { c, n: 1 }; return ' Press Build again for a different line order — same cover, different arrangement.'; }
            if (sameAs !== undefined) return ` Same arrangement as design ${sameAs} — press Build again to keep exploring.`;
            if (!best || c < best.c) { best = { c, n: attempt + 1 }; return ' The best arrangement so far on the ticked objectives.'; }
            return ` Design ${best.n} scored better on the ticked objectives — close and reopen Links, then press Build the link `
                + `${best.n} time${best.n === 1 ? '' : 's'} to get it back.`;
        },
    };
}

/**
 * The line a build reports, in the generator card's own words for each figure (rules 3 and 4).
 * @param {{ mode?: string|null, waves?: number }} built
 * @param {{ changed: boolean, before: any, after: any }} ord  from `reorderLines`
 * @param {{ attempt: number, maxRunOn: boolean, maxRunTarget: number, explore: string }} s
 */
export function builtStatusLine(built, ord, { attempt, maxRunOn, maxRunTarget, explore }) {
    const how = built.mode === 'settled'
        ? `Link built — each line kept to one wave of similar start times (${built.waves} wave${built.waves === 1 ? '' : 's'})`
        : 'Link built — lines move across the whole day (the targets would not fit one wave per line)';
    const b = ord.before, a = ord.after;
    const moved = ord.changed
        ? ` — same shift type in a row ${b.longestBlock} → ${a.longestBlock} weeks, shifts in a row ${b.longestRun} → ${a.longestRun}, `
          // In hours and minutes, as the FF18 row states the same move (whole-app review, 24 Nov 2026).
          + `average week-to-week move ${hmFromHours(b.gentleMean / 60)} → ${hmFromHours(a.gentleMean / 60)}, full weekends off ${b.weekends} → ${a.weekends}, `
          + `long weekends ${b.longWeekends} → ${a.longWeekends}.`
        : '. Review and save when ready.';
    const missed = maxRunOn && ord.changed && a.longestRun > maxRunTarget
        ? ` Shifts in a row came down only to ${a.longestRun} (target ${maxRunTarget}) without giving up more elsewhere — `
          + `turn other objectives off to push it further.`
        : '';
    return `${attempt > 0 ? `Design ${attempt + 1} — ` : ''}${how}${moved}${missed}${explore}`;
}
