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
 * @param {Array<{date?: string, value?: string}|null|undefined>} args.removed the cache rows being
 *   deleted, captured BEFORE the write — after it they are gone, and a receipt that cannot name what
 *   it removed is the half of the answer most worth having. An entry the cache could not resolve is
 *   passed through as null/undefined rather than filtered out by the caller: see below.
 * @param {string} args.memberName
 * @param {(dateISO: string) => string} args.formatDate display form, e.g. `13 Jul`
 * @param {(entry: {type: string, value: string}) => string} args.describe what a day now is, in the
 *   app's own words — injected because that vocabulary lives with the type table, not here
 * @param {string[]} [args.skipped] dates that were STAGED and deliberately not written — annual
 *   leave on a rest day the admin answered "rest day — free" (v23.88). Named in the lines, never
 *   counted as a change: nothing was written, and a save that quietly dropped a row would be the
 *   silent decision the swapped-day question exists to end.
 * @returns {{ summary: string, lines: string[] }} `summary` is the headline; `lines` is one per day,
 *   in date order. `lines` is empty only when nothing changed, which callers already guard against.
 */
export function buildSaveReceipt({ toSave, removed, memberName, formatDate, describe, skipped = [] }) {
    /** @type {Array<{ date: string, text: string }>} */
    const rows = [];

    toSave.forEach(e => {
        rows.push({ date: e.date, text: `${formatDate(e.date)} — ${describe(e)}` });
    });
    removed.forEach(r => {
        // "Removed" rather than the value it used to hold: what matters is that the day is back to
        // the base roster, and naming the old value invites reading it as the new one.
        //
        // AN UNRESOLVED REMOVAL IS STILL A REMOVAL (v21.38, review). The caller looks each deleted
        // id up in the cache, and a miss is possible — a staged delete can outlive a capped
        // collection read that trimmed the row. Dropping it would take the day off the list AND out
        // of the count, so a pure-deletion save could report "0 changes saved" over documents that
        // were genuinely deleted. It is named as unresolved instead: the receipt is allowed to say
        // it does not know which day, and is not allowed to say nothing happened.
        rows.push(r?.date
            ? { date: r.date, text: `${formatDate(r.date)} — removed` }
            : { date: '\uffff', text: 'A change was removed (its date could not be read)' });
    });

    // A DAY DELIBERATELY LEFT ALONE IS PART OF WHAT HAPPENED (v23.88). Annual leave on a rest day
    // the admin answered "rest day — free" is not written at all — it costs nothing and there is
    // nothing to record — and a save that quietly dropped a staged row would be the silent decision
    // this whole area exists to end. It is named, and it is NOT counted as a change.
    skipped.forEach(date => {
        rows.push({ date, text: `${formatDate(date)} — rest day, no leave recorded` });
    });

    rows.sort((a, b) => a.date.localeCompare(b.date));

    const changed = toSave.length + removed.length;
    // Every staged day resolved to a rest day: nothing was written, and the headline has to say so
    // rather than report "0 changes saved", which reads as a failure. Only when something WAS left
    // alone — an empty save with nothing skipped keeps the count it always had.
    const summary = (!changed && skipped.length)
        ? `Nothing to record for ${memberName}`
        : `${changed} ${changed === 1 ? 'change' : 'changes'} saved for ${memberName}`;
    return { summary, lines: rows.map(r => r.text) };
}
