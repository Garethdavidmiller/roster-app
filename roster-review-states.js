// @ts-check
/**
 * roster-review-states.js — what state every cell of the roster review is in, and whether it is
 * TICKED.
 *
 * Owns: `computeCellStates` — the classification (MATCH · DIFF · CONFLICT · COVERED ·
 *   REMOVE_IMPORT · UNREADABLE · GUARDED), the `chosen` default that decides what a Save writes,
 *   what one Save writes and says (`collectRosterWrites`, `reviewOutcome`), which answers survive
 *   a refused Save (`carryReviewAnswers`), and which of a person's days get a row (`personSummary`).
 *   The `UNKNOWN|` / `RDW|` review encodings are roster-cell-rules.js's, re-exported here for the renderer.
 * Does NOT own: the parse, the review table's DOM, the rows' markup beside `guardedRowHtml`
 *   (roster-review-rows.js), the entry control, or any write.
 * Edit here for: a new cell state, or a change to what is ticked by default.
 * Read first: `.claude/rules/roster-import.md` — the import's whole contract.
 *
 * ── WHY IT IS ITS OWN MODULE ───────────────────────────────────────────────────────────────────
 *
 * It is the RULE part of the roster review: no DOM, no state, Firebase-free, so it loads in Node with
 * no mocks. The existing suite still reaches it through `admin-roster-upload.js`'s re-export.
 *
 * ── THE FIVE THINGS AN EDIT CAN SILENTLY BREAK ─────────────────────────────────────────────────
 *
 * Each is argued beside the branch that implements it; this list exists so an editor knows to go
 * and read them.
 *
 *   1. THE DEFAULT IS NEVER "WRITE IT" where anything is in doubt. A drifted member's rows — and
 *      every row of a read the breaker has refused — start `chosen: false`; CONFLICT and UNREADABLE
 *      start `null`. Only DIFF and REMOVE_IMPORT are pre-ticked, and never on Christmas Day or Boxing
 *      Day, which the app's Christmas leave decides (owner, 10 Nov 2026; `isChristmasClosureDate`).
 *   2. THE ALIGNMENT VERDICT IS TAKEN ONCE, HERE, because `chosen` is decided here — reporting a
 *      drift under a banner while every change stays ticked is not refusing it.
 *   3. AN UNREADABLE CELL NEVER WRITES ITS SENTINEL, and every candidate reading offered as a pick
 *      goes through the same `normaliseCellValue` guards a parsed value does. Picking must not be
 *      a route to write something the parsed path would have refused — a Sunday AL, say.
 *   4. RDW-PARITY IS PART OF "COVERED", AND OF "MATCH". A stored `{type:'shift', '14:30-22:00'}` and
 *      an incoming `RDW|14:30-22:00` are equal on the bare time, so without the type check the
 *      overtime reclassification is dropped in silence — and a weekday RDW at the BASE shift's own
 *      hours is a change for the same reason. Sundays are excluded from both on purpose.
 *   5. A PREVIOUS IMPORT AND A MANUAL ENTRY ARE DIFFERENT THINGS. `isManual` picks the branch, and
 *      REMOVE_IMPORT exists so a row that now matches the base roster DELETES the stale import
 *      rather than writing a fresh base-matching override — which would mask a later base change.
 */

import { teamMembers, getBaseShift, isSunday, parseISODate } from './roster-data.js';
import { shouldReplaceOverride, isContractedWorkOverride, contractEvidence, isBeforeMemberStart } from './override-utils.js';
import { normaliseCellValue, RDW_PREFIX, isRdwEncoded, stripRdw, UNKNOWN_PREFIX, isUnknownEncoded, stripUnknown } from './roster-cell-rules.js';
import { assessRosterAlignment } from './roster-alignment.js';
import { isChristmasClosureDate } from './christmas-leave.js';

/** Why a Christmas Day or Boxing Day row starts unticked (owner, 10 Nov 2026) — the row's note. */
export const CHRISTMAS_NOTE = 'Not selected — the app’s Christmas leave decides 25 and 26 December.';

/** The `RDW|` / `UNKNOWN|` review encodings are defined ONCE, in roster-cell-rules.js, and re-exported
 *  here for the renderer and the tests that have always reached them through this module. */
export { RDW_PREFIX, isRdwEncoded, stripRdw, UNKNOWN_PREFIX, isUnknownEncoded, stripUnknown };

/**
 * Compute the state of every (member, date) cell in the review table.
 *
 * Returns a Map keyed by "memberName|date" with values:
 *   { state: 'MATCH'|'GUARDED'|'DIFF'|'CONFLICT'|'COVERED'|'REMOVE_IMPORT'|'UNREADABLE',
 *     parsedShift, baseShift, manualValue?, manualId?, chosen }
 *
 * State meanings:
 *   MATCH    — PDF matches base roster, no override → nothing to do
 *   GUARDED  — PDF said something the app's rules refuse to record on that day (leave or an
 *              absence on a base rest day or a rest Sunday; a training or meeting day on ANY
 *              Sunday, whatever is saved there — owner, 7 Nov 2026; anything but a rest day before
 *              the member's start date). Writes nothing unless a rest-day
 *              row is answered "swapped" (`guardedWrites`) — and it is shown and explained, because
 *              the app decided rather than agreed
 *   DIFF     — PDF differs from base roster, no manual override → propose change
 *   CONFLICT — A manually entered override exists that differs from the PDF → flag it
 *   COVERED  — A manual override exists and already matches the PDF → nothing to do
 *   REMOVE_IMPORT — the PDF matches the base roster again over a previous import → delete it
 *   UNREADABLE — the `UNKNOWN|` sentinel → written only once the admin answers it
 *
 * @param {any} parsedResult  - Response from parseRosterPDF
 * @param {Array<any>}  existingOverrides - Overrides already in Firestore for this week
 * @returns {Map<string, any>}
 */
export function computeCellStates(parsedResult, existingOverrides) {
    const states = new Map();
    // Candidate readings for cells the server's cross-check flagged. Absent on an older function
    // response — the rows are then skip-only.
    const choices = parsedResult.choices;

    // Build a quick lookup: "memberName|date" → best override doc.
    // Use shouldReplaceOverride so manual entries always beat roster imports,
    // and newer docs beat older ones within the same source class.
    const overrideMap = new Map();
    for (const o of existingOverrides) {
        const key = `${o.memberName}|${o.date}`;
        if (shouldReplaceOverride(overrideMap.get(key), o)) {
            overrideMap.set(key, o);
        }
    }
    // Every OTHER record of a day, beside the one the review shows — an older manual duplicate or an
    // older import copy would resurface over the new roster once the winner was replaced. The save
    // deletes them all.
    /** @param {string} key @returns {string[]} */
    const otherRecordIds = (key) => existingOverrides
        .filter(o => `${o.memberName}|${o.date}` === key && o.id !== overrideMap.get(key)?.id)
        .map(o => o.id);

    // The alignment verdict is taken ONCE, here (rule 2). Rules and reasoning: roster-alignment.js.
    const alignment = assessRosterAlignment(parsedResult);

    for (const entry of parsedResult.parsed) {
        // Only process names that exist in teamMembers (not hidden)
        const member = teamMembers.find(m => m.name === entry.memberName && !m.hidden);
        if (!member) continue;
        const drift = alignment.byMember.get(entry.memberName) || null;
        // A ROW NOBODY READ (a decided default): when every Monday-to-Saturday cell is a question, the
        // Sunday is one too — a blank Sunday must not pre-tick a rest day over a rostered or worked one.
        const unread = (/** @type {any} */ v) => !v || v === 'RDW' || isUnknownEncoded(v);
        const weekdays = parsedResult.dates.filter((/** @type {string} */ d) => !isSunday(d));
        const rowUnread = weekdays.length > 0 && weekdays.every((/** @type {string} */ d) => unread(entry.shifts?.[d]));

        for (const date of parsedResult.dates) {
            // A day the response does not carry is a QUESTION, not a rest day (the blank-cell rule).
            // Unreachable from today's server, which always sends all seven days.
            let parsedShift  = entry.shifts?.[date] || `${UNKNOWN_PREFIX}no value for this day in the read — check the PDF`;
            // Bare 'RDW' = the AI omitted the shift time. As a DIFF it would save
            // {type:'rdw', value:'RDW'}, which firestore.rules rejects, failing the WHOLE chunk —
            // so it is an UNREADABLE row instead, never written.
            if (parsedShift === 'RDW') parsedShift = 'UNKNOWN|RDW (no time on roster)';
            if (rowUnread && isSunday(date) && !isUnknownEncoded(parsedShift)) {
                const read = /** @type {Record<string, string>} */ ({ RD: 'rest day', OFF: 'rest day', SICK: 'Absent' })[parsedShift]
                    ?? (isRdwEncoded(parsedShift) ? `RDW ${stripRdw(parsedShift)}` : parsedShift);
                parsedShift = `${UNKNOWN_PREFIX}Sunday (${read}) — nothing else on this row was read; check the PDF`;
            }
            const baseShift    = getBaseShift(member, parseISODate(date));
            const key          = `${entry.memberName}|${date}`;
            const existing     = overrideMap.get(key);
            // CHRISTMAS DAY AND BOXING DAY ARE THE APP'S CHRISTMAS LEAVE'S TO DECIDE (owner, 10 Nov 2026):
            // nothing is pre-ticked and nothing is asked; a manager can still tick a day on purpose.
            const christmas    = isChristmasClosureDate(date);

            // A DAY BEFORE THE MEMBER STARTED IS NOT THEIRS TO RECORD. Anything the sheet printed there
            // is SHOWN, as a GUARDED row naming the reason, and writes nothing; a rest day with nothing
            // saved there is nothing to say (MATCH, not drawn).
            if (isBeforeMemberStart(member, parseISODate(date))) {
                const nothingToSay = (parsedShift === 'RD' || parsedShift === 'OFF') && !existing;
                states.set(key, {
                    state: nothingToSay ? 'MATCH' : 'GUARDED', guarded: 'before-start',
                    date, christmas, parsedShift, displayShift: parsedShift, baseShift,
                    manualValue: existing?.value ?? null, manualId: existing?.id ?? null,
                    manualType: existing?.type ?? null, manualReplacedType: existing?.replacedType ?? null,
                    manualLeaveYear: existing?.leaveYear ?? null, otherRecordIds: otherRecordIds(key),
                    chosen: null, drift, rosterBlocked: alignment.blocked,
                });
                continue;
            }

            // Unreadable PDF value (normaliseShift couldn't parse it — see UNKNOWN_PREFIX). Surface
            // it as an UNREADABLE row so a garbled real shift isn't silently dropped, but NEVER write
            // the sentinel: chosen stays null, and the save writes only what the admin answers in
            // place (`entered`) or a reading they pick (`options`) — rule 3.
            if (isUnknownEncoded(parsedShift)) {
                // …EXCEPT when the server told us which two readings disagreed: then the row offers
                // them as a pick. Each goes through the SAME normalisation as a parsed value (rule 3).
                // `chosen` stays null = skip, so the DEFAULT is still "write nothing".
                const cand = choices?.[key];
                // A BARE 'RDW' IS NOT A READING ANYTHING CAN WRITE (firestore.rules refuses it, above).
                // Beside a reading that carries a time it is "rest day worked, at that time"; with no
                // time anywhere it is dropped.
                const pairedTime = Array.isArray(cand)
                    ? cand.map(v => String(v).match(/\d{2}:\d{2}-\d{2}:\d{2}/)?.[0]).find(Boolean) ?? null
                    : null;
                const readings = Array.isArray(cand)
                    ? cand.map(v => (v === 'RDW' ? (pairedTime ? `${RDW_PREFIX}${pairedTime}` : null) : v))
                          .filter(v => v != null)
                    : [];
                const normalised = readings.map(v => normaliseCellValue(v, baseShift, date));
                // LEAVE OR AN ABSENCE ON A BASE REST DAY IS NOT A "REST" BUTTON: such a cell offers no
                // readings; the row shows both as the server wrote them, and the entry below asks the
                // swapped-day question if the answer is the absence.
                const restGuarded = normalised.some(o => o.guarded === 'rest-day');
                const opts = normalised
                    // A Sunday training or meeting day is not a reading anything may write (owner,
                    // 7 Nov 2026).
                    .filter(o => o.guarded !== 'sunday-other')
                    // Nor is a spare day on 25 or 26 December (owner, 19 Nov 2026), or an Other day there.
                    .filter(o => o.guarded !== 'christmas-spare' && o.guarded !== 'christmas-other')
                    // A pair that would WRITE the same thing is not a question worth asking. Compared
                    // on `display`, which is what the save writes (`value` strips the RDW marker).
                    .filter((o, i, all) => all.findIndex(x => x.display === o.display) === i);
                // …BUT TWO READINGS OF THE SAME HOURS ARE ONE ANSWER, so it is offered ("MEET
                // 10:00-14:00" beside "10:00-14:00" on a Sunday). A lone rest day is not offered:
                // written on a rostered Sunday it would take the shift away.
                const offered = !restGuarded && (opts.length > 1 || (readings.length > 1 && opts.length === 1 && opts[0].value !== 'RD'));
                states.set(key, {
                    state: 'UNREADABLE',
                    // The DATE is carried on the state, for the in-place entry's Sunday guard — never
                    // re-derived from the Map key at the call site.
                    date, christmas,
                    parsedShift, baseShift,
                    manualValue: existing?.value ?? null,
                    manualId:    existing?.id    ?? null,
                    otherRecordIds: otherRecordIds(key),
                    manualType:  existing?.type  ?? null,
                    manualReplacedType: existing?.replacedType ?? null,
                    manualLeaveYear: existing?.leaveYear ?? null,   // see replacedFromState
                    // Whether a MANUAL entry is at stake: a pick replaces whatever is stored, so the
                    // row shows a hand-recorded entry, as a CONFLICT row would.
                    isManual:    existing ? (existing.source !== 'roster_import') : false,
                    chosen:      null,
                    options:     offered ? opts : null,
                    /** What the admin typed in, once they have. `chosen === 'entered'`
                     *  selects it; until then it is a draft and writes nothing, exactly like an
                     *  unpicked reading. */
                    entered:     null,
                    /** The in-progress entry: which pill is down and what is in the time boxes.
                     *  Kept on the state rather than read back off the DOM so a re-render (a tick
                     *  elsewhere refreshes the whole list) cannot lose a half-typed shift. */
                    draft:       { type: null, from: '', to: '' },
                    // The read's verdict, as every other state carries it — the collector's hard gate
                    // must see an answered unreadable cell on a refused read.
                    drift,
                    rosterBlocked: alignment.blocked,
                });
                continue;
            }

            // Determine whether the existing override is manual or a previous import
            const isManual = existing
                ? (existing.source !== 'roster_import')   // no source field → treat as manual
                : false;

            // Per-cell normalisation — the Sunday + base-rest-day guards, and the RDW| display
            // marker — in normaliseCellValue, so a CHOSEN value goes through the identical guards (rule 3).
            const { value: normParsed, display: normDisplay, guarded: normGuarded } = normaliseCellValue(parsedShift, baseShift, date);
            let displayValue = normDisplay;
            let guarded = normGuarded;
            const normRest = /** @param {any} s */ s => (s === 'OFF' ? 'RD' : s);
            const normBase = normRest(baseShift);
            const isSun    = isSunday(date);   // still needed by the RDW-parity check below

            let state;
            // RDW-ness of the existing override vs the incoming value must MATCH for a timed value to
            // count as COVERED (rule 4). Sundays are EXCLUDED: a worked Sunday is stored as rdw but
            // arrives as a plain time, so requiring flag equality would false-CONFLICT every Sunday.
            const rdwMatches = isSun
                || !/^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(normParsed)
                || ((existing?.type === 'rdw') === isRdwEncoded(parsedShift));
            // …AND THE SAME HOLDS AGAINST THE BASE ROSTER: a base shift is never rest-day working, so a
            // weekday marked RDW at the base's own hours is a change. Sundays are exempt, as above.
            const matchesBase = normParsed === normBase && (isSun || !isRdwEncoded(parsedShift));
            // A spare week's 25 or 26 December is a REST DAY (owner, 19 Nov 2026), so a printed SPARE
            // there over an EARLIER IMPORT is read as a printed rest day is: the row offers to clear the
            // stale import (unticked, below). Over nothing or a hand-made record it stays GUARDED. An
            // Other day printed on either is held the same way (`christmas-other`).
            const christmasSpareGuarded = (guarded === 'christmas-spare' || guarded === 'christmas-other') && (!existing || isManual);
            if (guarded === 'sunday-other' || christmasSpareGuarded) {
                // A TRAINING OR MEETING DAY CANNOT BE ON A SUNDAY (owner, 7 Nov 2026), so a roster
                // saying one is not a change to make — over the base, a saved record or an earlier
                // import. NOR CAN 25 OR 26 DECEMBER BE A SPARE DAY (owner, 19 Nov 2026). (Over an
                // earlier IMPORT that one is a "Back to normal" row instead — above.)
                state = 'GUARDED';
            } else if (!existing || !isManual) {
                // No override, or only a previous import.
                if (existing && !isManual && normRest(existing.value) === normParsed && rdwMatches) {
                    state = 'COVERED';  // previous import already equals the PDF — nothing to re-approve
                } else if (matchesBase) {
                    // PDF now matches the base roster.
                    //  • No override to clean up → genuinely nothing to do (MATCH)…
                    //  • …UNLESS it only matches because a guard REWROTE it (an AL or absence on a base
                    //    rest day, anything on a Sunday): MATCH rows are not rendered, so the day would
                    //    vanish. GUARDED writes nothing either, but it SAYS so — the app may not answer
                    //    the swapped-day question in silence just because the fact arrived by PDF.
                    //  • A stale previous import still exists (and can't equal the PDF, or it would
                    //    be COVERED above) → REMOVE_IMPORT: delete the stale doc and write NOTHING
                    //    (rule 5) — a fresh base-matching override would MASK a later base change.
                    //  • …EXCEPT A REST DAY THE ROSTER MARKS AS LEAVE OR ABSENCE: that import is the
                    //    ANSWER to the swap question ("Swapped — record it"), not stale. The same import
                    //    again → COVERED; a different one → the question is asked again, never defaulted.
                    //  • On Christmas Day and Boxing Day nothing is asked, so a different import there
                    //    is a "Back to normal" row — unticked, as every row on those two days starts.
                    const leaveOnRest = guarded === 'rest-day' && (parsedShift === 'AL' || parsedShift === 'SICK');
                    if (existing && leaveOnRest && normRest(existing.value) === parsedShift) state = 'COVERED';
                    else if (existing && leaveOnRest && !christmas) state = 'GUARDED';
                    else state = existing ? 'REMOVE_IMPORT' : (guarded ? 'GUARDED' : 'MATCH');
                } else {
                    // PDF differs from base (a genuine change), OR a stale differing import must be
                    // replaced with a new value. Approving deletes the old import (replaceId) and
                    // writes the corrected value.
                    state = 'DIFF';
                }
            } else {
                // A HAND-RECORDED SWAP MAKES THE ROSTER'S LEAVE REAL: a shift recorded on a base rest
                // day says the member was contracted to work it, so leave or an absence the PDF marks
                // there is shown and written as the roster's own value, carrying the swap forward as
                // `replacedType` (nextReplacedType at the save). The day's BASE goes with the question:
                // an Other day or a Spare turn on a base rest day is not contracted work (owner: leave
                // over one is free, like plain RDW), so it is not a swap.
                const swappedIn = guarded === 'rest-day' && (parsedShift === 'AL' || parsedShift === 'SICK')
                    && isContractedWorkOverride(contractEvidence(existing), baseShift) === true;
                if (swappedIn) { displayValue = parsedShift; guarded = null; }
                const incoming = swappedIn ? parsedShift : normParsed;
                // A manual override exists — check if it already matches the PDF
                if (normRest(existing.value) === incoming && rdwMatches) {
                    state = 'COVERED';   // manual is already correct — nothing to do
                } else if (!swappedIn && (existing.value === 'SICK' || existing.value === 'AL') && normBase === 'RD' && normParsed === 'RD') {
                    // Absence OR annual leave on a base rest day AND the PDF also shows rest — not a
                    // real conflict; leave the manual override untouched (a CONFLICT's "Use new
                    // roster" would delete the AL). A worked shift in the PDF falls through to CONFLICT.
                    state = 'COVERED';
                } else {
                    state = 'CONFLICT';  // manual differs from PDF — flag it
                }
            }

            states.set(key, {
                state,
                /** Which guard rewrote the parsed value, or null — whatever the state (a Sunday AL on
                 *  a rostered Sunday is a DIFF that carries 'sunday'). A GUARDED row is worded from it. */
                guarded,
                parsedShift,
                // What the row DISPLAYS and SAVES as the incoming value. Keeps the RDW| marker
                // (see displayValue above); differs from parsedShift only where a value was
                // normalised to RD (Sunday AL/SICK/Other, or absence on a base rest day).
                displayShift: displayValue,
                baseShift,
                manualValue: existing?.value ?? null,
                // Carry the override TYPE so the review table can render the 💼 RDW badge: a saved
                // RDW's value is the bare time — the RDW-ness lives in `type`.
                manualType:  existing?.type  ?? null,
                manualReplacedType: existing?.replacedType ?? null,
                manualLeaveYear: existing?.leaveYear ?? null,   // see replacedFromState
                manualId:    existing?.id    ?? null,
                otherRecordIds: otherRecordIds(key),
                // FAIL CLOSED ON A SUSPECT ROW (rule 1): a member whose week looks a day out — or
                // anyone at all once the breaker has tripped — starts UNTICKED, so the default
                // action on a misread week stops being "save it". So does a Christmas day (above).
                chosen:      (drift || alignment.blocked) ? false
                    : ((state === 'DIFF' || state === 'REMOVE_IMPORT')
                        ? !christmas && guarded !== 'christmas-spare' && guarded !== 'christmas-other' : null),
                /** 25 or 26 December from 2026: unticked, asked nothing, and the row says why. */
                christmas,
                // 'chosen' for DIFF / REMOVE_IMPORT = true (approved) or false (skipped)
                // 'chosen' for CONFLICT = 'manual' (default) or 'pdf'
                /** 'left'/'right' when THIS member's row looks a day out; null otherwise. */
                drift,
                /** True on every cell of a read the circuit breaker has refused. Per-cell on
                 *  purpose: the save path reads cell states, so it cannot write past this. */
                rosterBlocked: alignment.blocked,
            });
        }
    }

    return states;
}

/**
 * Why a GUARDED row recorded nothing, in the admin's own words. Here, not in the coordinator, so it
 * can be unit-tested in Node.
 *
 * WORDING RULES: what the ROSTER said, then what the app DID; "Absent", never "sick" (GDPR); the
 * rest day stated as the REASON, not a verdict; and never read like an error — a rule has been
 * applied, and the row lets the admin decide whether it fits this day.
 *
 * @param {'sunday'|'sunday-other'|'rest-day'|'before-start'|'christmas-spare'|'christmas-other'|null} guard
 * @param {boolean} [asks] the row asks the swapped-day question
 * @param {boolean} [christmas] 25 or 26 December from 2026, which the app's Christmas leave decides
 * @returns {string}
 */
export function guardCopy(guard, asks = false, christmas = false) {
    // The row's own tag already says "Not recorded", so this is the REASON alone.
    if (guard === 'sunday') {
        return 'Sundays aren\u2019t contracted, so nothing is recorded on them.';
    }
    // Not "a rest day on the base roster": by pattern most of the roster is due at work on these two
    // days, and the app shows them on leave there without anything being recorded (owner, 10 Nov 2026).
    if (guard === 'rest-day' && christmas) {
        return 'The app’s Christmas leave decides 25 and 26 December, so nothing is recorded.';
    }
    // A day before the member's start date: the reason, whatever the roster printed.
    if (guard === 'before-start') {
        return 'Before this member\u2019s start date, so nothing is recorded.';
    }
    if (guard === 'christmas-spare') {
        // Owner, 19 Nov 2026: "Christmas days and Boxing days cannot be spare days even if they fall
        // in a usually spare week."
        return 'Christmas Day and Boxing Day can\u2019t be spare days, so nothing is recorded and the day stays as it is.';
    }
    if (guard === 'christmas-other') {
        // Owner, 21 Nov 2026: "There cannot be training or meeting on December 25th or 26th".
        return 'Training and meetings can\u2019t be on Christmas Day or Boxing Day, so nothing is recorded and the day stays as it is.';
    }
    if (guard === 'sunday-other') {
        // Owner, 7 Nov 2026. "Stays as it is" covers all three cases: a rest Sunday, a rostered
        // Sunday, and one that already holds a saved record.
        return 'Training and meetings can\u2019t be on a Sunday, so nothing is recorded and the day stays as it is.';
    }
    // 'rest-day' (and any future guard, which should add its own line rather than inherit this one).
    // Never point the admin at Change a Shift: there, a bare absence on a base rest day is HIDDEN.
    // The row asks the question itself (owner).
    return asks
        ? 'A rest day on the base roster. Was it a swapped working day? Only then is it recorded.'
        : 'A rest day on the base roster, so nothing is recorded.';
}

/**
 * Does this GUARDED row ask "was this a swapped working day?" (owner).
 *
 * The rest-day guard turns leave or an absence on a BASE rest day into nothing — right for a real
 * rest day, wrong for a SWAPPED week, which only the person reading the roster knows. So it is ASKED,
 * as booking leave on a rest day is, and never defaulted: unanswered, or "rest day", writes nothing.
 * Never on a Sunday (an absence can never be recorded there), never on a read the circuit
 * breaker has refused (nothing on it may be written), and never on Christmas Day or Boxing Day,
 * which the booking flows do not ask about either (al-swapped-days.js; owner, 10 Nov 2026).
 * @param {any} s a cell state
 * @returns {boolean}
 */
export function swapQuestionApplies(s) {
    return !!s && s.state === 'GUARDED' && s.guarded === 'rest-day' && !s.rosterBlocked && !s.christmas
        && (s.parsedShift === 'SICK' || s.parsedShift === 'AL');
}

/**
 * The value a GUARDED row writes — the roster's own absence or leave, and only when answered
 * "swapped" — or null. The save marks it as covering a swapped-in working day (`replacedType`).
 * @param {any} s a cell state
 * @returns {string|null}
 */
export function guardedWriteValue(s) {
    return swapQuestionApplies(s) && s.chosen === 'swapped' ? s.parsedShift : null;
}

/**
 * What a write over this row's saved record must carry forward from it — its type, what IT replaced,
 * and which year's allowance it came out of — or null when nothing is saved there. A write
 * is delete-then-set, so these are the only surviving record of what the day said. ONE builder for
 * every save site: five copies of the object literal are how a field reaches four of them.
 * @param {any} s a cell state
 * @returns {{type?: string, replacedType?: string|null, leaveYear?: number}|null}
 */
export function replacedFromState(s) {
    if (!s?.manualId) return null;
    return { type: s.manualType, replacedType: s.manualReplacedType,
             ...(Number.isInteger(s.manualLeaveYear) ? { leaveYear: s.manualLeaveYear } : {}) };
}

/**
 * What saving a GUARDED row writes (pure, so the save path is tested, not just the question).
 * "Swapped" records the roster's leave or absence, REPLACING any previous import on the
 * day; "rest day" writes nothing, except that a previous import there is REMOVED — the PDF now says
 * this is not a working day. Unanswered writes nothing at all.
 * @param {any} s a cell state @param {string} memberName @param {string} date
 * @returns {Array<{memberName: string, date: string, value: string|null, baseShift: string, swapped?: boolean, replaceId?: string, replacedFrom?: any, deleteOnly?: boolean}>}
 */
export function guardedWrites(s, memberName, date) {
    // ONE gate: the question's own (`swapQuestionApplies`), so a row can write only what it asked
    // about, and never on a read the breaker refused.
    if (!swapQuestionApplies(s)) return [];
    if (s.chosen === 'swapped') return [{ memberName, date, value: s.parsedShift, baseShift: s.baseShift, swapped: true,
        replaceId: s.manualId ?? undefined,
        replacedFrom: replacedFromState(s) }];
    if (s.manualId && s.chosen === 'free') {
        return [{ memberName, date, value: null, baseShift: s.baseShift, replaceId: s.manualId, deleteOnly: true }];
    }
    return [];
}

/**
 * Is this answer a rest day on a day the base roster already rests? Then it is no record at all —
 * the collector writes nothing new there, and the entry control says so.
 * @param {any} value the value an answer would write @param {any} baseShift
 * @returns {boolean}
 */
export function restOverRest(value, baseShift) {
    return (value === 'RD' || value === 'OFF') && (baseShift === 'RD' || baseShift === 'OFF');
}

/**
 * Everything one Save of the roster review writes — pure, so it is pinned by tests. The coordinator
 * hands it the cell-state map and saves what comes back.
 *
 * Per state, and nothing else is written: a ticked DIFF, or a CONFLICT answered "Use new roster",
 * writes the value the row DISPLAYED (`displayShift`, Sunday/rest-day-normalised) — what the admin
 * approved is what lands, and a raw SICK on a base rest day cannot slip past the rest-day guard as
 * the absence the review had shown as "RD". A ticked REMOVE_IMPORT deletes the stale import and
 * writes nothing. An UNREADABLE row writes only once answered in place or one of its two readings
 * is picked; untouched, `chosen` stays null — and an answer of a rest day over a base rest day writes
 * nothing new, only clearing what the day held (`restOverRest`). A GUARDED row writes what
 * `guardedWrites` says.
 *
 * THE HARD GATE comes first: a cell from a read the circuit breaker refused writes
 * nothing, whatever `chosen` says. The tick handler already refuses to set `chosen` there, so from
 * today's UI this line is unreachable, and deleting it leaves the browser suite green; it is the one
 * that survives a future renderer, a "select all", or a Skip-all path that bypasses the tick.
 *
 * Every write also takes the day's OTHER records with it (`alsoDelete`, from `otherRecordIds`) — an
 * older manual duplicate outranks an import and would hide the write.
 * @param {Map<string, any>} cellStates `computeCellStates` output, keyed "memberName|date"
 * @returns {Array<{memberName: string, date: string, value: string|null, baseShift: string, replaceId?: string, alsoDelete: string[], deleteOnly?: boolean, swapped?: boolean, replacedFrom?: any}>}
 */
export function collectRosterWrites(cellStates) {
    /** @type {any[]} */ const toWrite = [];
    for (const [key, state] of cellStates) {
        const [memberName, date] = key.split('|');
        if (state.rosterBlocked) continue;
        if (state.state === 'DIFF' && state.chosen !== false) {
            toWrite.push({ memberName, date, value: state.displayShift ?? state.parsedShift, baseShift: state.baseShift, replaceId: state.manualId, replacedFrom: replacedFromState(state) });
        }
        if (state.state === 'REMOVE_IMPORT' && state.chosen !== false) {
            toWrite.push({ memberName, date, value: null, baseShift: state.baseShift, replaceId: state.manualId, deleteOnly: true });
        }
        const answer = state.state !== 'UNREADABLE' ? null
            : (state.chosen === 'entered' && state.entered) ? state.entered
            : (typeof state.chosen === 'number' && state.options?.[state.chosen]) || null;
        if (answer && restOverRest(answer.display, state.baseShift)) {
            // A REST DAY OVER A BASE REST DAY IS NO RECORD: written, it would mask a later base change
            // (rule 5), so what the day held before is cleared instead, if anything.
            if (state.manualId) toWrite.push({ memberName, date, value: null, baseShift: state.baseShift, replaceId: state.manualId, deleteOnly: true });
        } else if (answer) {
            // `swapped`: leave or an absence on a base rest day, answered "Swapped" in the entry control.
            toWrite.push({ memberName, date, value: answer.display, baseShift: state.baseShift, replaceId: state.manualId, swapped: !!answer.swapped, replacedFrom: replacedFromState(state) });
        }
        toWrite.push(...guardedWrites(state, memberName, date));
        if (state.state === 'CONFLICT' && state.chosen === 'pdf') {
            toWrite.push({ memberName, date, value: state.displayShift ?? state.parsedShift, baseShift: state.baseShift, replaceId: state.manualId, replacedFrom: replacedFromState(state) });
        }
    }
    for (const w of toWrite) w.alsoDelete = cellStates.get(`${w.memberName}|${w.date}`)?.otherRecordIds ?? [];
    return toWrite;
}

/**
 * What the review's summary and its Save button say — COUNTED FROM THE WRITES `collectRosterWrites`
 * RETURNS, so the button cannot promise one number while Save writes another.
 *
 * `answeredWithNothing` is the entry control's `entryLeftAsRest`, PASSED IN rather than imported:
 * that module imports this one, and the state machine must not import the widget
 * (roster-cell-rules.js header). An unreadable row answered "a rest day — nothing to record" writes
 * nothing and is not a cell nobody could read.
 * @param {Map<string, any>} cellStates
 * @param {(st: any) => boolean} [answeredWithNothing]
 * @returns {{ blocked: boolean, updates: number, clears: number, conflictsTotal: number,
 *             conflictsSwitched: number, unreadable: number, heldBack: number, christmasHeld: number,
 *             anySuspect: boolean }}
 */
export function reviewOutcome(cellStates, answeredWithNothing = () => false) {
    const all = [...cellStates.values()];
    const writes = collectRosterWrites(cellStates);
    const clears = writes.filter(w => w.deleteOnly).length;
    const conflicts = all.filter(st => st.state === 'CONFLICT');
    const answered = (/** @type {any} */ st) => (typeof st.chosen === 'number' && !!st.options?.[st.chosen])
        || (st.chosen === 'entered' && !!st.entered) || answeredWithNothing(st);
    return {
        blocked: all.some(st => st.rosterBlocked),
        updates: writes.length - clears,
        clears,
        conflictsTotal: conflicts.length,
        conflictsSwitched: conflicts.filter(st => st.chosen === 'pdf').length,
        unreadable: all.filter(st => st.state === 'UNREADABLE' && !answered(st)).length,
        // SAY WHAT IS BEING WITHHELD: a suspect member's unticked rows reach no count above. Only
        // rows STILL unticked: one the admin has checked and ticked is counted as a write.
        heldBack: all.filter(st => st.drift && (st.state === 'DIFF' || st.state === 'REMOVE_IMPORT') && st.chosen === false).length,
        // A Christmas day withheld for its own reason (owner, 10 Nov 2026) — counted once, so a
        // drifted row is never both "held back" and "not selected".
        christmasHeld: all.filter(st => st.christmas && !st.drift
            && (st.state === 'DIFF' || st.state === 'REMOVE_IMPORT') && st.chosen === false).length,
        anySuspect: all.some(st => st.drift),
    };
}

/**
 * The summary above the review list, as HTML — '' when there is nothing to say. Every value in it
 * is a count, so nothing here needs escaping.
 * @param {ReturnType<typeof reviewOutcome>} o
 * @returns {string}
 */
export function outcomeHtml(o) {
    const line = (/** @type {string} */ cls, /** @type {string} */ k, /** @type {number} */ n, /** @type {string} */ words) =>
        `<div class="ro-line ${cls}"><span class="ro-k">${k}</span><span><strong>${n}</strong> ${words}</span></div>`;
    const lines = [];
    if (o.updates > 0) lines.push(line('ro-up', '✓', o.updates, `shift${o.updates !== 1 ? 's' : ''} will be updated`));
    if (o.clears > 0) lines.push(line('ro-clear', '✓', o.clears, `old ${o.clears !== 1 ? 'entries' : 'entry'} will be cleared`));
    if (o.conflictsTotal > 0) {
        const kept = o.conflictsTotal - o.conflictsSwitched;
        const detail = o.conflictsSwitched > 0
            ? `${o.conflictsSwitched} switched to the new roster, ${kept} kept as you saved`
            : 'kept as you saved — change below if needed';
        lines.push(line('ro-choice', '?', o.conflictsTotal, `${o.conflictsTotal !== 1 ? 'days need' : 'day needs'} your choice — ${detail}`));
    }
    if (o.unreadable > 0) lines.push(line('ro-read', '⚠', o.unreadable, `cell${o.unreadable !== 1 ? 's' : ''} couldn't be read — nothing saved`));
    if (o.heldBack > 0) {
        lines.push(line('ro-read', '⚠', o.heldBack,
            `day${o.heldBack !== 1 ? 's' : ''} held back — the week may be a day out, so nothing there is selected`));
    }
    if (o.christmasHeld > 0) {
        lines.push(line('ro-read', '⚠', o.christmasHeld,
            `day${o.christmasHeld !== 1 ? 's' : ''} not selected — the app’s Christmas leave decides 25 and 26 December`));
    }
    if (!lines.length) return '';
    const hint = (o.updates > 0 || o.clears > 0)
        ? `<p class="ro-hint">Ticked rows will save — tap a ✓ to skip that row.${
            o.anySuspect ? ' Rows flagged as possibly a day out start unticked; tick only what you have checked against the PDF.' : ''}</p>`
        : '';
    return `<h4 class="ro-h">When you tap “Save changes”</h4>${lines.join('')}${hint}`;
}

/** The states that get a row in the review: a change, a question, or a day the app declined to record. */
const ROW_STATES = new Set(['DIFF', 'REMOVE_IMPORT', 'CONFLICT', 'UNREADABLE', 'GUARDED']);

/**
 * One person's section of the review: which of their days get a row, what the badge counts, and
 * whether Skip all is offered.
 *
 * THE BADGE COUNTS CHANGES; A GUARDED ROW IS A NOTICE: rendered so the day is not invisible, but
 * nothing about it is pending, so it is not counted.
 *
 * SKIP ALL IS OFFERED WHEREVER A ROW CAN WRITE — an answered rest-day question writes too, so a
 * person whose rows are all guarded keeps the way back to "unanswered, writes nothing".
 * @param {string} memberName
 * @param {string[]} dates the week's dates, in order
 * @param {Map<string, any>} cellStates keyed `member|date`
 * @returns {{ changedDates: string[], pendingCount: number, canWrite: boolean }}
 *   no `changedDates` means the person gets no section at all
 */
export function personSummary(memberName, dates, cellStates) {
    const stateOf = (/** @type {string} */ d) => cellStates.get(`${memberName}|${d}`);
    const changedDates = dates.filter(d => ROW_STATES.has(stateOf(d)?.state));
    const pendingCount = changedDates.filter(d => stateOf(d)?.state !== 'GUARDED').length;
    const canWrite = pendingCount > 0 || changedDates.some(d => {
        const s = stateOf(d);
        return s?.state === 'GUARDED' && swapQuestionApplies(s);
    });
    return { changedDates, pendingCount, canWrite };
}

/**
 * The inner HTML of a GUARDED review row. Pure, so the markup the admin answers is tested beside the
 * rule it asks about.
 *
 * THE TAG RIDES IN THE DAY LINE, AND WHAT THE ROSTER SAID GETS A LINE OF ITS OWN (the "Your choice"
 * card's shape) — a three-column row overlapped on a phone with large text.
 * @param {{ key: string, s: any, dayName: string, dateStr: string, badgeHtml: string,
 *           esc: (v: string) => string }} a
 * @returns {string}
 */
export function guardedRowHtml({ key, s, dayName, dateStr, badgeHtml, esc }) {
    const asks = swapQuestionApplies(s);
    const recording = guardedWriteValue(s) !== null;
    // WHAT IS SAVED NOW, AND WHAT THE ANSWER DOES TO IT: "Rest day — leave it" DELETES an old import
    // (guardedWrites → deleteOnly), and leaving the row unanswered keeps it — so both are shown.
    const held = s.manualId && s.manualValue != null ? String(s.manualValue) : null;
    const clearing = !recording && !!held && s.chosen === 'free';
    const btn = (/** @type {string} */ v, /** @type {boolean} */ on, /** @type {string} */ label) =>
        `<button type="button" class="roster-choice-btn${on ? ' is-chosen' : ''}" data-key="${esc(key)}" data-swap="${v}" aria-pressed="${on}">${label}</button>`;
    return `
        <div class="roster-cb-day">
            <div class="roster-chg-day"><span class="roster-day-abbr">${dayName}</span><span class="roster-day-date">${dateStr}</span></div>
            <span class="roster-act ${recording ? 'act-update' : clearing ? 'act-clear' : 'act-none'}">${recording ? 'Will record' : clearing ? 'Will clear' : held ? 'Kept as saved' : 'Not recorded'}</span>
        </div>
        <div class="roster-guard-said"><span class="roster-guard-lab">Roster</span><span class="roster-guard-val${recording ? ' is-recorded' : ''}">${badgeHtml}</span></div>
        ${held ? `<div class="roster-guard-said roster-guard-held"><span class="roster-guard-lab">Saved now</span><span class="roster-guard-val">${esc(held === 'SICK' ? 'Absent' : held)}</span></div>` : ''}
        <p class="roster-guard-note">${guardCopy(s.guarded, asks, !!s.christmas)}</p>
        ${asks ? `<div class="roster-pick roster-guard-pick" role="group" aria-label="Was this a swapped working day?">
            ${btn('yes', s.chosen === 'swapped', 'Swapped \u2014 record it')}${btn('no', s.chosen === 'free', 'Rest day \u2014 leave it')}
        </div>` : ''}`;
}


/**
 * The action tag's STYLE on an UNREADABLE row: `act-read` until the admin has answered it,
 * `act-choice` once something WILL be written (owner-approved). Both unreadable row shapes look alike
 * while unanswered. PRESENTATION ONLY — it reads `chosen`, never decides it.
 *
 * @param {{ chosen?: any, entered?: any, options?: any[] }|null|undefined} s an UNREADABLE cell state
 * @returns {'act-read'|'act-choice'}
 */
export function unreadableTagClass(s) {
    const picked  = typeof s?.chosen === 'number' && !!s.options?.[s.chosen];
    const entered = s?.chosen === 'entered' && !!s.entered;
    return picked || entered ? 'act-choice' : 'act-read';
}

/** The fields a review row's CONTROLS write — the admin's answers. Every other field on a row is
 *  `computeCellStates`'s, so a fresh read recomputes it. */
const ANSWER_FIELDS = /** @type {const} */ (['chosen', 'preSkip', 'entered', 'draft']);

/** One computed row as text, its keys in a fixed order, so two rows compare whatever order they were
 *  built in. Every value a row holds is plain data (strings, numbers, nulls, arrays, small objects).
 *  @param {any} v @returns {string} */
function rowText(v) {
    if (Array.isArray(v)) return `[${v.map(rowText).join(',')}]`;
    if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${rowText(v[k])}`).join(',')}}`;
    return JSON.stringify(v) ?? 'undefined';
}

/**
 * The admin's answers, carried onto the review redrawn after a refused Save.
 *
 * A refused Save (`saveRosterWrites`, roster-import-save.js) re-reads the week and recomputes every
 * row; recomputed alone, every row would go back to its DEFAULT, and a second Save would write a row
 * the admin had deliberately left out. So a row keeps its answers when the fresh read gives it
 * EXACTLY what the first read gave it — every field `computeCellStates` set, compared whole (the
 * conservative choice) — and only a row that changed starts again from its default.
 *
 * SKIP ALL IS A PERSON'S, not a row's: the page draws it, and pressing it again is the one way that
 * also skips a row that changed under a skipped person. So it is handed back rather than carried: the
 * rows of each skipped person get the ticks they had before the skip (`preSkip` — what Restore puts
 * back), and the page presses Skip all again once the review is drawn. A CONFLICT, GUARDED or
 * UNREADABLE row needs nothing undone: Skip all left it answering nothing, and pressing it again does
 * the same.
 *
 * @param {Map<string, any>} answered  the review as the admin left it
 * @param {Map<string, any>} before    `computeCellStates` on what that review LOADED — its defaults
 * @param {Map<string, any>} fresh     `computeCellStates` on the week read again; answers are copied INTO it
 * @param {string[]} [skipped]         the people whose section was skipped
 * @returns {{ states: Map<string, any>, changed: string[] }}  `changed`: the rows started again from their default
 */
export function carryReviewAnswers(answered, before, fresh, skipped = []) {
    const skippedPeople = new Set(skipped);
    /** @type {string[]} */
    const changed = [];
    for (const [key, row] of fresh) {
        const was = answered.get(key), base = before.get(key);
        if (!was || !base) continue;
        if (rowText(base) !== rowText(row)) { changed.push(key); continue; }
        for (const field of ANSWER_FIELDS) if (field in was) row[field] = was[field];
        if (skippedPeople.has(key.slice(0, key.lastIndexOf('|'))) && (row.state === 'DIFF' || row.state === 'REMOVE_IMPORT')) {
            row.chosen = was.preSkip ?? true;
        }
    }
    return { states: fresh, changed };
}
