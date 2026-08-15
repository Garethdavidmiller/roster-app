// @ts-check
/**
 * admin-save-receipt.js — what a save actually did, said day by day.
 *
 * ── WHY (v21.38, external review) ───────────────────────────────────────────────────────────────
 *
 * A save reported `2 added, 1 removed for G. Miller`. That is a count, and the question a manager
 * has the instant after pressing Save is not "how many?" — it is **"did I change the days I meant
 * to?"** A count cannot answer it. The commonest real mistake on this page is a right-shaped batch
 * against the wrong days: a bulk apply that caught a Sunday, a week grid left on last week, a row
 * ticked and forgotten. All of those produce a perfectly plausible count.
 *
 * The data is already known before the batch commits, so the receipt costs nothing to produce and
 * needs no read-back.
 *
 * ── IT NAMES THE DAYS, NOT THE RECORDS ──────────────────────────────────────────────────────────
 *
 * One line per DATE, in date order, saying what that day now is. Not one line per document, and not
 * grouped by kind: a manager checks a receipt against their intention, and their intention was
 * "Monday to Thursday off" — a list ordered by anything other than the calendar makes them do the
 * sorting.
 *
 * A REMOVED day says so explicitly rather than being omitted. An absence in a receipt is not
 * readable as a change; it is readable as the receipt being short.
 *
 * Pure — no DOM, no Firebase. Tested by admin-save-receipt.test.mjs.
 */

/**
 * Build the receipt for one save.
 *
 * @param {object} args
 * @param {Array<{date: string, type: string, value: string, existingId?: string}>} args.toSave
 * @param {Array<{date: string, value?: string}>} args.removed the cache rows being deleted, captured
 *   BEFORE the write — after it they are gone, and a receipt that cannot name what it removed is the
 *   half of the answer most worth having
 * @param {string} args.memberName
 * @param {(dateISO: string) => string} args.formatDate display form, e.g. `13 Jul`
 * @param {(entry: {type: string, value: string}) => string} args.describe what a day now is, in the
 *   app's own words — injected because that vocabulary lives with the type table, not here
 * @returns {{ summary: string, lines: string[] }} `summary` is the headline; `lines` is one per day,
 *   in date order. `lines` is empty only when nothing changed, which callers already guard against.
 */
export function buildSaveReceipt({ toSave, removed, memberName, formatDate, describe }) {
    /** @type {Array<{ date: string, text: string }>} */
    const rows = [];

    toSave.forEach(e => {
        rows.push({ date: e.date, text: `${formatDate(e.date)} — ${describe(e)}` });
    });
    removed.forEach(r => {
        // "Removed" rather than the value it used to hold: what matters is that the day is back to
        // the base roster, and naming the old value invites reading it as the new one.
        rows.push({ date: r.date, text: `${formatDate(r.date)} — removed` });
    });

    rows.sort((a, b) => a.date.localeCompare(b.date));

    const changed = toSave.length + removed.length;
    const summary = `${changed} ${changed === 1 ? 'change' : 'changes'} saved for ${memberName}`;
    return { summary, lines: rows.map(r => r.text) };
}
