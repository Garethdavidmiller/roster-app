// @ts-check
/**
 * links-shortlist.js — "Keep only the shortlist": the admin's one-off clear-out of the OLDER saved
 * designs (v25.09, owner, 2 Nov 2026).
 *
 * ── WHAT THE OWNER ASKED FOR ───────────────────────────────────────────────────────────────────
 *
 * "Put the new shortlist proposals as the saved options in the links designer. Remove the older
 * ones." — and then, of the first version, which saved the three as ordinary editable designs:
 * "The shortlist should be read only." So the shortlist is NOT touched. Even Step, In Step and
 * Short Run stay exactly what they are — built in (`links-proposals.js`), read-only, at the top of
 * the picker, the owner's decision of 3 Oct 2026 — and what goes is everything that was saved
 * before them. The options left in the picker are the shortlist.
 *
 * ── WHY ONE DELIBERATE PRESS, AND NOT A MOVE ON PAGE OPEN ──────────────────────────────────────
 *
 * The 24-line designs went to the bin on page open (`isPre26Design`, 3 Oct), and that precedent
 * was looked at first. It does not carry over, for three reasons:
 *
 *  1. "Older" here means EVERY design saved before the shortlist was settled, whoever saved it —
 *     not a shape a rule can recognise. Automatically, it would run on the first device to open the
 *     page, and the bin would name that person as having deleted three people's work.
 *  2. Nobody but the owner can see which designs that is. One press, behind a dialog that LISTS
 *     them by name and by who last saved each, shows the person who asked exactly what will move
 *     before anything does — and lets them cancel.
 *  3. A move on open would act on every page load that meets an old design — the whole Links test
 *     suite included, which seeds old designs to test everything else.
 *
 * Nothing is destroyed: a moved design keeps its patterns in Recently deleted, and anyone can
 * restore it. A RESTORE stamps a new `updatedAt`, so a design brought back is no longer "older" and
 * is never offered again.
 *
 * ── WHAT "OLDER" MEANS ─────────────────────────────────────────────────────────────────────────
 *
 * **Last saved before `OLDER_BEFORE`** — the start of 2 Nov 2026, the day the owner asked. A FIXED
 * date, not "before this press": a design somebody saves after the release is new work, and must
 * never be swept up by a press made later. It is also what makes the row go away by itself — once
 * every older design has moved, nothing matches and the ··· More sheet stops offering it, with no
 * flag to store anywhere. A design whose save time cannot be read is left alone: not knowing is
 * not "older".
 *
 * Pure — no DOM, no Firebase. The move itself is the store's existing `binIfStill`, which asks
 * `isOlderDesign` again INSIDE its transaction, so a design a colleague saved after the dialog
 * opened is spared; the press is `links-design-library.js`.
 */

/** The start of 2 Nov 2026 (UTC): a design last saved before this is one of the "older ones". */
export const OLDER_BEFORE = Date.UTC(2026, 10, 2);

/** The most designs the confirm dialog names one by one; the rest are counted. */
export const LISTED_IN_DIALOG = 12;

/**
 * When a design was last saved, in ms — from a Firestore Timestamp, a Date or a number — or null.
 * @param {any} v
 */
function savedMs(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
    const ms = typeof v?.toMillis === 'function' ? v.toMillis() : null;
    return typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
}

/**
 * Is this one of the older designs — last saved before `OLDER_BEFORE`? Takes a design entry or a
 * raw Firestore document; an unreadable save time is NOT older.
 * @param {{ updatedAt?: any } | null | undefined} entry
 */
export function isOlderDesign(entry) {
    const ms = savedMs(entry?.updatedAt);
    return ms !== null && ms < OLDER_BEFORE;
}

/**
 * The live designs a press would move, in the order given.
 * @template {{ updatedAt?: any }} T
 * @param {T[]} designs
 * @returns {T[]}
 */
export function olderDesigns(designs) {
    return designs.filter(isOlderDesign);
}

/**
 * Is "Keep only the shortlist" offered? To the admin, while there is something older to move —
 * which is also why it disappears by itself once it has been used.
 * @param {{ isAdmin: boolean, designs: Array<{ updatedAt?: any }> }} o
 */
export function canKeepOnlyShortlist({ isAdmin, designs }) {
    return isAdmin && olderDesigns(designs).length > 0;
}

/**
 * The confirm dialog's message — that the shortlist stays as it is, every design that will move and
 * who last saved it, and the unsaved work that would be lost. `confirmDialog` keeps the line breaks.
 * @param {Array<{ name?: string, updatedBy?: string }>} older
 * @param {{ currentUser: string, dirty: boolean }} o
 */
export function keepOnlyShortlistMessage(older, { currentUser, dirty }) {
    const n = older.length;
    const who = (/** @type {{ updatedBy?: string }} */ d) => d.updatedBy === currentUser ? 'you' : d.updatedBy || 'nobody named';
    const rows = older.slice(0, LISTED_IN_DIALOG).map(d => `• ${(d.name || '').trim() || 'Untitled design'} (last saved by ${who(d)})`);
    if (n > LISTED_IN_DIALOG) rows.push(`• and ${n - LISTED_IN_DIALOG} more`);
    const parts = [
        'Even Step, In Step and Short Run stay in the list as they are now — built in and read-only.',
        `${n === 1 ? 'This older design moves' : `These ${n} older designs move`} to Recently deleted, where anyone can restore ${n === 1 ? 'it' : 'them'}:\n${rows.join('\n')}`,
    ];
    if (dirty) parts.push('Your unsaved changes to the open design will be lost.');
    return parts.join('\n\n');
}

/**
 * The status line once the moves have settled. `moved` is what the transactions actually moved —
 * a design a colleague saved or deleted meanwhile is not counted — and `failed` is what could not
 * be moved at all, so the reader knows to press again.
 * @param {number} moved @param {number} failed
 */
export function keptOnlyShortlistLine(moved, failed) {
    const done = moved
        ? `${moved === 1 ? 'The older design is' : `The ${moved} older designs are`} in Recently deleted, so the shortlist is what is left — restore from there if you still need ${moved === 1 ? 'it' : 'one'}.`
        : 'Nothing was moved — the older designs had already changed or gone.';
    if (!failed) return done;
    return `${moved ? done + ' ' : ''}${failed === 1 ? 'One design' : `${failed} designs`} could not be moved — check your connection and choose Keep only the shortlist again.`;
}
