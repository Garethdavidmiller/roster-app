// @ts-check
/**
 * roster-review-states.js — what state every cell of the roster review is in, and whether it is
 * TICKED.
 *
 * Owns: `computeCellStates` — the classification (MATCH · DIFF · CONFLICT · COVERED ·
 *   REMOVE_IMPORT · UNREADABLE · GUARDED), the `chosen` default that decides what a Save writes,
 *   and the `UNKNOWN|` / `RDW|` review encodings the renderer reads back.
 * Does NOT own: the parse, the review table's DOM, the entry control, or any write.
 * Edit here for: a new cell state, or a change to what is ticked by default.
 * Read first: `.claude/rules/roster-import.md` — the import's whole contract.
 *
 * ── WHY IT IS ITS OWN MODULE (v23.52) ──────────────────────────────────────────────────────────
 *
 * `admin-roster-upload.js` reached its ratchet cap with no headroom at all, and this was the one
 * part of it that is a RULE rather than coordination: it touches no DOM, holds no state, and every
 * answer it gives is a decision that would be WRONG if it were wrong. Everything left in that file
 * reads the page, calls a Cloud Function, or paints — which is what a coordinator is for.
 *
 * It is also Firebase-free, so it loads in Node with no mocks. The existing suite still reaches it
 * through `admin-roster-upload.js`'s re-export (the same reason that file already re-exports the
 * three `roster-cell-rules.js` names): moving the assertions is a separate change, and a test block
 * relocated in the same commit as the code under it can lose a case with nothing to say so.
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
 *   2. THE ALIGNMENT VERDICT IS TAKEN ONCE, HERE, because `chosen` is decided here. It used to be
 *      computed at render time, under a banner, while every change stayed ticked — reporting is
 *      not refusing (v22.16).
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
import { shouldReplaceOverride, isContractedWorkOverride, contractEvidence } from './override-utils.js';
import { normaliseCellValue } from './roster-cell-rules.js';
import { assessRosterAlignment } from './roster-alignment.js';
import { isChristmasClosureDate } from './christmas-leave.js';

/** Why a Christmas Day or Boxing Day row starts unticked (owner, 10 Nov 2026) — the row's note. */
export const CHRISTMAS_NOTE = 'Not selected — the app’s Christmas leave decides 25 and 26 December.';

/** The review's internal marker for "this worked time is rest-day working". The value SAVED to
 *  Firestore is the bare time — the RDW-ness lives in the override's `type` — so this prefix
 *  exists only between the parse and the save. `admin-roster-upload.js` imports both predicates
 *  back rather than keeping a second copy. */
export const RDW_PREFIX     = 'RDW|';
export const isRdwEncoded   = /** @param {any} v */ v => typeof v === 'string' && v.startsWith(RDW_PREFIX);
export const stripRdw       = /** @param {any} v */ v => v.slice(RDW_PREFIX.length);

/** UNKNOWN|<raw> — a value the AI returned that `normaliseShift` (server) could not recognise as a
 *  shift. Surfaced in review as an UNREADABLE cell so a garbled real shift isn't silently dropped;
 *  never written to Firestore (see rule 3 above, and the save path). Mirrors the RDW encoding. */
export const UNKNOWN_PREFIX   = 'UNKNOWN|';
export const isUnknownEncoded = /** @param {any} v */ v => typeof v === 'string' && v.startsWith(UNKNOWN_PREFIX);
export const stripUnknown     = /** @param {any} v */ v => v.slice(UNKNOWN_PREFIX.length);

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
 *              Sunday, whatever is saved there — owner, 7 Nov 2026). Writes nothing unless a rest-day
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
    // Candidate readings for cells the server's cross-check flagged (v19.32). Absent on an older
    // function response — the rows then behave exactly as before (skip-only).
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
    // Every OTHER record of a day, beside the one the review shows (whole-app review, Oct 2026). A
    // pre-v24.48 duplicate the winner outranks still outranks an import, so a write that replaced only
    // the winner left it to resurface over the new roster: "Use new roster" did not take. And an older
    // IMPORT copy — two devices importing one week, or a save pressed twice — resurfaced the same way
    // the day the newer one was replaced or cleared (whole-app fix, Nov 2026). The save deletes them all.
    /** @param {string} key @returns {string[]} */
    const otherRecordIds = (key) => existingOverrides
        .filter(o => `${o.memberName}|${o.date}` === key && o.id !== overrideMap.get(key)?.id)
        .map(o => o.id);

    // The alignment verdict is taken ONCE, here, because `chosen` is decided here — it used to be
    // computed at render time under a banner while every change stayed ticked. Rules and reasoning:
    // roster-alignment.js.
    const alignment = assessRosterAlignment(parsedResult);

    for (const entry of parsedResult.parsed) {
        // Only process names that exist in teamMembers (not hidden)
        const member = teamMembers.find(m => m.name === entry.memberName && !m.hidden);
        if (!member) continue;
        const drift = alignment.byMember.get(entry.memberName) || null;
        // A ROW NOBODY READ (decided default, whole-app fix, Nov 2026). When every Monday-to-Saturday
        // cell is a question, the Sunday is one too: a blank Sunday reads as a rest day, so for the
        // member printed on a second sheet who works most of the week elsewhere it was a pre-ticked
        // "Update → Rest" over a rostered Sunday, or a ticked "Clear old" over recorded Sunday work.
        const unread = (/** @type {any} */ v) => !v || v === 'RDW' || isUnknownEncoded(v);
        const weekdays = parsedResult.dates.filter((/** @type {string} */ d) => !isSunday(d));
        const rowUnread = weekdays.length > 0 && weekdays.every((/** @type {string} */ d) => unread(entry.shifts?.[d]));

        for (const date of parsedResult.dates) {
            // A day the response does not carry is a QUESTION, not a rest day (whole-app fix, Nov
            // 2026): 'RD' here was a pre-ticked rest day over a worked base day, against the blank-cell
            // rule. Unreachable from today's server, which always sends all seven days.
            let parsedShift  = entry.shifts?.[date] || `${UNKNOWN_PREFIX}no value for this day in the read — check the PDF`;
            // Bare 'RDW' = the AI omitted the shift time. The server passes it through so the
            // review can flag it, but there is NO edit affordance and it previously classified
            // as a default-ticked DIFF whose save produced {type:'rdw', value:'RDW'} — which
            // firestore.rules rejects (rdw requires HH:MM-HH:MM), failing the WHOLE ≤200-row
            // chunk as permission-denied with a misleading "session may have expired" error.
            // Route it to the skip-only UNREADABLE row instead — never written (v16.23).
            if (parsedShift === 'RDW') parsedShift = 'UNKNOWN|RDW (no time on roster)';
            if (rowUnread && isSunday(date) && !isUnknownEncoded(parsedShift)) {
                const read = /** @type {Record<string, string>} */ ({ RD: 'rest day', OFF: 'rest day', SICK: 'Absent' })[parsedShift]
                    ?? (isRdwEncoded(parsedShift) ? `RDW ${stripRdw(parsedShift)}` : parsedShift);
                parsedShift = `${UNKNOWN_PREFIX}Sunday (${read}) — nothing else on this row was read; check the PDF`;
            }
            const baseShift    = getBaseShift(member, parseISODate(date));
            const key          = `${entry.memberName}|${date}`;
            const existing     = overrideMap.get(key);
            // CHRISTMAS DAY AND BOXING DAY ARE THE APP'S CHRISTMAS LEAVE'S TO DECIDE (owner, 10 Nov 2026).
            // The base makes both a rest day for everybody, so a pattern shift printed there was a
            // pre-ticked DIFF — saved, it put the member at work and added the Boxing Day lieu day —
            // and leave there asked the swapped-day question of a day nobody is rostered to work.
            // Nothing is pre-ticked and nothing is asked; a manager can still tick a day on purpose.
            const christmas    = isChristmasClosureDate(date);

            // Unreadable PDF value (normaliseShift couldn't parse it — see UNKNOWN_PREFIX). Surface
            // it as a skip-only UNREADABLE row so a garbled real shift isn't silently dropped, but
            // NEVER write the sentinel: chosen stays null and the save path only writes DIFF/CONFLICT.
            // The admin fixes the source PDF and re-uploads, or records the shift manually.
            if (isUnknownEncoded(parsedShift)) {
                // …EXCEPT when the server told us which two readings disagreed (v19.32). Then the row
                // can offer them as a pick instead of being a dead end that sends the admin off to
                // Change a Shift. Each candidate is put through the SAME normalisation an ordinary
                // parsed value gets (Sunday AL/absence → RD, absence-or-AL on a base rest day → RD,
                // the RDW| display marker) — picking must not be a way to write a value the guards
                // would have rejected on the parsed path. `chosen` stays null = skip, so the DEFAULT
                // is still "write nothing"; a pick is always a deliberate act.
                const cand = choices?.[key];
                // A BARE 'RDW' IS NOT A READING ANYTHING CAN WRITE (whole-app review, Oct 2026). The
                // parsed path has refused it since v16.23 (above), but as one of two readings it was
                // offered, and picking it built {type:'rdw', value:'RDW'}, which firestore.rules
                // refuses — failing the whole save batch with a misleading message. Beside a reading
                // that carries a time, it is "rest day worked, at that time"; with no time anywhere,
                // there is nothing to offer and it is dropped.
                const pairedTime = Array.isArray(cand)
                    ? cand.map(v => String(v).match(/\d{2}:\d{2}-\d{2}:\d{2}/)?.[0]).find(Boolean) ?? null
                    : null;
                const readings = Array.isArray(cand)
                    ? cand.map(v => (v === 'RDW' ? (pairedTime ? `${RDW_PREFIX}${pairedTime}` : null) : v))
                          .filter(v => v != null)
                    : [];
                const normalised = readings.map(v => normaliseCellValue(v, baseShift, date));
                // LEAVE OR AN ABSENCE ON A BASE REST DAY IS NOT A "REST" BUTTON (whole-app fix, Nov 2026).
                // The rest-day guard rewrites it to RD, so a pick offered it as plain "Rest", named the
                // absence nowhere, and never asked the swapped-day question every other route asks. Such
                // a cell offers no readings: the row shows both as the server wrote them ("Absent or
                // 06:00-14:00?"), and the entry below asks the question if the answer is the absence.
                const restGuarded = normalised.some(o => o.guarded === 'rest-day');
                const opts = normalised
                    // A Sunday training or meeting day is not a reading anything may write (owner,
                    // 7 Nov 2026) — offered, it would have been a "Rest" button over a Sunday.
                    .filter(o => o.guarded !== 'sunday-other')
                    // A pair that would WRITE the same thing is not a question worth asking (AL vs RD
                    // on a Sunday — both become RD). Compared on `display`, which is what the save
                    // writes: `value` strips the RDW marker, so "RDW at 14:30" and a 14:30 shift — two
                    // different writes, rest day worked against ordinary turn — used to collapse.
                    .filter((o, i, all) => all.findIndex(x => x.display === o.display) === i);
                // …BUT TWO READINGS OF THE SAME HOURS ARE ONE ANSWER, so it is offered (7 Nov 2026
                // review). A Sunday's "MEET 10:00-14:00" and "10:00-14:00" both write Sunday work at
                // those hours, and collapsing them left a row with nothing to pick. A lone rest day is
                // still not offered: written on a rostered Sunday it would take the shift away.
                const offered = !restGuarded && (opts.length > 1 || (readings.length > 1 && opts.length === 1 && opts[0].value !== 'RD'));
                states.set(key, {
                    state: 'UNREADABLE',
                    // The DATE is carried on the state (v22.17). The in-place entry has to apply the
                    // Sunday guard, and deriving the date by splitting the Map key at the call site
                    // would be a second place that knows the key's shape.
                    date, christmas,
                    parsedShift, baseShift,
                    manualValue: existing?.value ?? null,
                    manualId:    existing?.id    ?? null,
                    otherRecordIds: otherRecordIds(key),
                    manualType:  existing?.type  ?? null,
                    manualReplacedType: existing?.replacedType ?? null,
                    manualLeaveYear: existing?.leaveYear ?? null,   // see replacedFromState (v25.18)
                    // Whether a MANUAL entry is at stake (v19.37). Picking a reading writes with
                    // replaceId, so it replaces whatever is stored — routine for a previous import,
                    // but for a hand-recorded entry it is the one thing this table otherwise
                    // guarantees never happens silently: a READABLE PDF value in the same situation
                    // becomes a CONFLICT row that shows "Saved: X" and asks. The flagged row shows it
                    // too, so the choice is made knowing what it costs.
                    isManual:    existing ? (existing.source !== 'roster_import') : false,
                    chosen:      null,
                    options:     offered ? opts : null,
                    /** What the admin typed in, once they have (v22.17). `chosen === 'entered'`
                     *  selects it; until then it is a draft and writes nothing, exactly like an
                     *  unpicked reading. */
                    entered:     null,
                    /** The in-progress entry: which pill is down and what is in the time boxes.
                     *  Kept on the state rather than read back off the DOM so a re-render (a tick
                     *  elsewhere refreshes the whole list) cannot lose a half-typed shift. */
                    draft:       { type: null, from: '', to: '' },
                    // The read's verdict, as every other state carries it (whole-app fix, Nov 2026):
                    // without `rosterBlocked` here the collector's hard gate could not see an
                    // answered unreadable cell on a refused read, and it was written.
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
            // marker. Extracted to normaliseCellValue (v19.32) so the review table's new "pick a
            // reading" control puts a CHOSEN value through the identical guards; a second copy is
            // how a picked Sunday AL would quietly become writable when the parsed path forbids it.
            const { value: normParsed, display: normDisplay, guarded: normGuarded } = normaliseCellValue(parsedShift, baseShift, date);
            let displayValue = normDisplay;
            let guarded = normGuarded;
            const normRest = /** @param {any} s */ s => (s === 'OFF' ? 'RD' : s);
            const normBase = normRest(baseShift);
            const isSun    = isSunday(date);   // still needed by the RDW-parity check below

            let state;
            // RDW-ness of the existing override vs the incoming value must MATCH for a timed
            // value to count as COVERED (v16.23): stored {type:'shift', 14:30-22:00} vs an
            // incoming RDW|14:30-22:00 compared equal on the bare time and the shift→RDW
            // reclassification (overtime pay) was silently dropped — and the reverse stuck as
            // COVERED too. Sundays are EXCLUDED from the type check: a worked Sunday is stored
            // as type rdw but arrives as a plain time (the save path promotes it), so requiring
            // flag equality there would false-CONFLICT every Sunday on every re-upload.
            const rdwMatches = isSun
                || !/^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(normParsed)
                || ((existing?.type === 'rdw') === isRdwEncoded(parsedShift));
            // …AND THE SAME HOLDS AGAINST THE BASE ROSTER (whole-app fix, Nov 2026). A base shift is
            // never rest-day working, so a weekday marked RDW at the base's own hours (a swapped week
            // whose moved rest day is worked on the usual turn) is a change: compared on the bare time
            // it was a MATCH — not shown, not saved — and the RDW marker went in silence, from the
            // Calendar and from the Pay Calculator's RDW suggestion. Sundays are exempt, as above.
            const matchesBase = normParsed === normBase && (isSun || !isRdwEncoded(parsedShift));
            if (guarded === 'sunday-other') {
                // A TRAINING OR MEETING DAY CANNOT BE ON A SUNDAY (owner, 7 Nov 2026), so a roster
                // saying one is not a change to make: not over the base, not over a saved record, not
                // over an earlier import. The rewritten RD used to be compared with the base, and on a
                // ROSTERED Sunday it was a ticked DIFF that turned a worked day into rest.
                state = 'GUARDED';
            } else if (!existing || !isManual) {
                // No override, or only a previous import.
                if (existing && !isManual && normRest(existing.value) === normParsed && rdwMatches) {
                    state = 'COVERED';  // previous import already equals the PDF — nothing to re-approve
                } else if (matchesBase) {
                    // PDF now matches the base roster.
                    //  • No override to clean up → genuinely nothing to do (MATCH)…
                    //  • …UNLESS it only matches because a guard REWROTE it (v23.97). An AL or an
                    //    absence on a base rest day, or anything on a Sunday, is normalised to RD
                    //    before this comparison — so `RD === RD` and the cell was classified MATCH,
                    //    a state whose own definition is "PDF matches base roster, nothing to do".
                    //    The PDF said leave. The base says rest. Those do not match, and MATCH rows
                    //    are not rendered at all, so the day vanished from the review entirely.
                    //
                    //    GUARDED writes nothing either — the overpay guard is right and is
                    //    untouched — but it SAYS so. The app asks a manager whether a rest day was
                    //    swapped when they book leave by hand (v23.75, "never defaulted"); it may
                    //    not answer the identical question in silence just because the same fact
                    //    arrived by PDF.
                    //  • A stale previous import still exists (and can't equal the PDF, or it would
                    //    be COVERED above) → REMOVE_IMPORT: delete the stale doc and write NOTHING.
                    //    Writing a fresh base-matching override (the old DIFF behaviour) was
                    //    redundant AND would MASK a later base-roster change (an override always
                    //    beats the base), so a "matches base today" row silently kept the old value.
                    //    REMOVE_IMPORT already renders a row, so it needs no guarded variant.
                    //  • …EXCEPT A REST DAY THE ROSTER MARKS AS LEAVE OR ABSENCE (Oct 2026 production
                    //    review). That previous import is not stale: it is the ANSWER to the swap
                    //    question, written when an admin said "Swapped — record it". Classing it as
                    //    REMOVE_IMPORT (ticked) deleted confirmed leave on the next upload of the
                    //    very same PDF. The same import again → COVERED. A different import there
                    //    (say, an old shift) → the question is asked again, and the answer replaces
                    //    or removes it — never a default.
                    //  • On Christmas Day and Boxing Day nothing is asked, so a different import there
                    //    is a "Clear old" row — unticked, as every row on those two days starts.
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
                // A HAND-RECORDED SWAP MAKES THE ROSTER'S LEAVE REAL (whole-app review, Oct 2026). The
                // rest-day guard reads the BASE roster, but a manager who recorded a shift on a base rest
                // day has said the member was contracted to work it — so leave or an absence the PDF
                // marks there costs a day and must be shown as what the PDF said. Rewriting it to RD
                // showed "New roster: Rest", hid the leave entirely, and "Use new roster" then deleted
                // the swap and recorded a rest day. Written as the roster's own value, it carries the
                // swap forward as `replacedType` (nextReplacedType at the save) and so displays.
                const swappedIn = guarded === 'rest-day' && (parsedShift === 'AL' || parsedShift === 'SICK')
                    && isContractedWorkOverride(contractEvidence(existing)) === true;
                if (swappedIn) { displayValue = parsedShift; guarded = null; }
                const incoming = swappedIn ? parsedShift : normParsed;
                // A manual override exists — check if it already matches the PDF
                if (normRest(existing.value) === incoming && rdwMatches) {
                    state = 'COVERED';   // manual is already correct — nothing to do
                } else if (!swappedIn && (existing.value === 'SICK' || existing.value === 'AL') && normBase === 'RD' && normParsed === 'RD') {
                    // Absence OR annual leave on a base rest day AND the PDF also shows rest —
                    // not a real conflict; leave the manual override untouched. AL joined SICK
                    // here in lockstep with the restSafe AL→RD normalisation (v16.19): without
                    // it, a manual AL on a base-rest weekday + a re-uploaded AL classified as
                    // CONFLICT, and "Use new roster" then wrote correction/RD, DELETING the AL.
                    // If the PDF instead shows a worked shift (an RDW on the rest day), fall
                    // through to CONFLICT so the genuine shift isn't dropped.
                    state = 'COVERED';
                } else {
                    state = 'CONFLICT';  // manual differs from PDF — flag it
                }
            }

            states.set(key, {
                state,
                /** Which guard rewrote the parsed value, or null. Only ever set on a GUARDED row;
                 *  the renderer words the row from it. */
                guarded,
                parsedShift,
                // What the row DISPLAYS and SAVES as the incoming value. Keeps the RDW| marker
                // (see displayValue above); differs from parsedShift only where a value was
                // normalised to RD (Sunday AL/SICK/Other, or absence on a base rest day).
                displayShift: displayValue,
                baseShift,
                manualValue: existing?.value ?? null,
                // Carry the override TYPE so the review table can render the 💼 RDW badge for a
                // saved rest-day-worked override: its stored value is the bare time ("14:30-22:00")
                // — the RDW-ness lives in `type`, not the value — so shiftDisplay(value) alone
                // showed an ordinary Early/Late badge and the admin couldn't tell RDW from a
                // normal shift when resolving a CONFLICT (v16.19).
                manualType:  existing?.type  ?? null,
                manualReplacedType: existing?.replacedType ?? null,
                manualLeaveYear: existing?.leaveYear ?? null,   // see replacedFromState (v25.18)
                manualId:    existing?.id    ?? null,
                otherRecordIds: otherRecordIds(key),
                // FAIL CLOSED ON A SUSPECT ROW (v22.16): a member whose week looks a day out — or
                // anyone at all once the breaker has tripped — starts UNTICKED, so the default
                // action on a misread week stops being "save it". So does a Christmas day (above).
                chosen:      (drift || alignment.blocked) ? false
                    : ((state === 'DIFF' || state === 'REMOVE_IMPORT') ? !christmas : null),
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
 * Why a GUARDED row recorded nothing, in the admin's own words (v23.97).
 *
 * HERE RATHER THAN IN THE COORDINATOR because `admin-roster-upload.js` imports Firebase from a
 * CDN URL, so Node cannot load it and nothing in it can be unit-tested. This is pure wording about
 * a review state, which is what this module is for.
 *
 * WORDING RULES THIS HAS TO OBEY, and each is a documented app convention rather than a preference:
 * the reader is told what the ROSTER said and what the app DID, in that order, because the surprise
 * is the second half; "Absent" is the staff-facing word and "sick" never appears (the reason for an
 * absence is not stored — GDPR); and it states the rest day as the REASON rather than as a verdict
 * on whether the member was right, because the app does not know. The one thing it must not do is
 * read like an error: nothing has gone wrong, a rule has been applied, and the row exists so the
 * admin can decide whether that rule fits this particular day.
 *
 * @param {'sunday'|'sunday-other'|'rest-day'|null} guard
 * @param {boolean} [asks] the row asks the swapped-day question
 * @param {boolean} [christmas] 25 or 26 December from 2026, which the app's Christmas leave decides
 * @returns {string}
 */
export function guardCopy(guard, asks = false, christmas = false) {
    // The row's own tag already says "Not recorded", so this is the REASON alone (v24.41) — it used
    // to end "— not recorded" too, and the row said it twice.
    if (guard === 'sunday') {
        return 'Sundays aren\u2019t contracted, so nothing is recorded on them.';
    }
    // Not "a rest day on the base roster": by pattern most of the roster is due at work on these two
    // days, and the app shows them on leave there without anything being recorded (owner, 10 Nov 2026).
    if (guard === 'rest-day' && christmas) {
        return 'The app’s Christmas leave decides 25 and 26 December, so nothing is recorded.';
    }
    if (guard === 'sunday-other') {
        // Owner, 7 Nov 2026. "Stays as it is" covers all three cases: a rest Sunday, a rostered
        // Sunday, and one that already holds a saved record.
        return 'Training and meetings can\u2019t be on a Sunday, so nothing is recorded and the day stays as it is.';
    }
    // 'rest-day' (and any future guard, which should add its own line rather than inherit this one).
    // v24.41 sent the admin to Change a Shift, which was wrong: there, an absence on a base rest day
    // is HIDDEN unless the day is first recorded as a swapped-in shift, so it took two saves in order
    // and a bare Absent vanished. The row now asks the question itself (v24.42, owner).
    return asks
        ? 'A rest day on the base roster. Was it a swapped working day? Only then is it recorded.'
        : 'A rest day on the base roster, so nothing is recorded.';
}

/**
 * Does this GUARDED row ask "was this a swapped working day?" (v24.42, owner).
 *
 * The rest-day guard turns leave or an absence on a BASE rest day into nothing, so nobody is paid an
 * absence, or charged leave, for a day they were never due at work. That is right for a real rest
 * day and wrong for a SWAPPED week, where the published roster moved the member's working day onto
 * it — which only the person reading the roster knows. So it is ASKED, exactly as booking leave on a
 * rest day is (v23.75), and never defaulted: unanswered, or answered "rest day", writes nothing.
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
 * and which year's allowance it came out of (v25.18) — or null when nothing is saved there. A write
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
 * What saving a GUARDED row writes (Oct 2026 review — pure so the save path is tested, not just the
 * question). "Swapped" records the roster's leave or absence, REPLACING any previous import on the
 * day; "rest day" writes nothing, except that a previous import there is REMOVED — the PDF now says
 * this is not a working day. Unanswered writes nothing at all.
 * @param {any} s a cell state @param {string} memberName @param {string} date
 * @returns {Array<{memberName: string, date: string, value: string|null, baseShift: string, swapped?: boolean, replaceId?: string, replacedFrom?: any, deleteOnly?: boolean}>}
 */
export function guardedWrites(s, memberName, date) {
    if (!s || s.state !== 'GUARDED' || s.rosterBlocked) return [];
    const value = guardedWriteValue(s);
    if (value) return [{ memberName, date, value, baseShift: s.baseShift, swapped: true,
        replaceId: s.manualId ?? undefined,
        replacedFrom: replacedFromState(s) }];
    if (s.manualId && s.chosen === 'free' && swapQuestionApplies(s)) {
        return [{ memberName, date, value: null, baseShift: s.baseShift, replaceId: s.manualId, deleteOnly: true }];
    }
    return [];
}

/**
 * Is this answer a rest day on a day the base roster already rests? Then it is no record at all —
 * the collector writes nothing new there, and the entry control says so (whole-app fix, Nov 2026).
 * @param {any} value the value an answer would write @param {any} baseShift
 * @returns {boolean}
 */
export function restOverRest(value, baseShift) {
    return (value === 'RD' || value === 'OFF') && (baseShift === 'RD' || baseShift === 'OFF');
}

/**
 * Everything one Save of the roster review writes (test audit, 7 Nov 2026 — it was inline in the
 * coordinator's click handler, which imports Firebase from a CDN, so the only way to pin it was to
 * read its source). The coordinator hands it the cell-state map and saves what comes back.
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
 * THE HARD GATE (v22.16) comes first: a cell from a read the circuit breaker refused writes
 * nothing, whatever `chosen` says. The tick handler already refuses to set `chosen` there, so from
 * today's UI this line is unreachable, and deleting it leaves the browser suite green; it is the one
 * that survives a future renderer, a "select all", or a Skip-all path that bypasses the tick.
 *
 * Every write also takes the day's OTHER records with it (`alsoDelete`, from `otherRecordIds`) — a
 * pre-v24.48 manual duplicate outranks an import, so leaving one hides the write, and an older import
 * copy comes back the day the newer one is replaced or cleared.
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
            // A REST DAY OVER A BASE REST DAY IS NO RECORD (whole-app fix, Nov 2026). Written, it was a
            // redundant correction that would mask a later change to the base roster — what
            // REMOVE_IMPORT exists to avoid — so what the day held before is cleared instead, if anything.
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
 * What the review's summary and its Save button say (whole-app fix, Nov 2026).
 *
 * COUNTED FROM THE WRITES `collectRosterWrites` RETURNS, so the button cannot promise one number
 * while Save writes another. It was a second pass over the same state in the coordinator, kept in
 * step with the collector only by a browser test asserting what was written.
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
        // SAY WHAT IS BEING WITHHELD (v22.16 polish): a suspect member's rows are unticked, so they
        // reach no count above, and the summary went silent about the one thing that had changed.
        // Only rows STILL unticked: one the admin has checked and ticked is counted as a write.
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

/**
 * The inner HTML of a GUARDED review row (v24.41 layout; v24.42 question). Pure, so the markup the
 * admin answers is tested beside the rule it asks about.
 *
 * THE TAG RIDES IN THE DAY LINE, AND WHAT THE ROSTER SAID GETS A LINE OF ITS OWN (v24.90). It was a
 * three-column row — day · "Roster" + badge · tag — and on a phone with large text the badge was
 * wider than its column and drew over the tag, which read "IOT RECORDED" (owner's screenshot). This
 * is the "Your choice" card's shape: the day and its tag, then each labelled value on its own line.
 * @param {{ key: string, s: any, dayName: string, dateStr: string, badgeHtml: string,
 *           esc: (v: string) => string }} a
 * @returns {string}
 */
export function guardedRowHtml({ key, s, dayName, dateStr, badgeHtml, esc }) {
    const asks = swapQuestionApplies(s);
    const recording = guardedWriteValue(s) !== null;
    // WHAT IS SAVED NOW, AND WHAT THE ANSWER DOES TO IT (same-day bug check). Since an old import
    // under a guarded day stopped being a ticked "Clear old", this row was the only place it showed —
    // and it did not: "Rest day — leave it" DELETES it (guardedWrites → deleteOnly) under a tag that
    // still said "Not recorded", and leaving the row unanswered keeps it. The admin is now shown both.
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
 * `act-choice` once they have (polish round 2, owner-approved).
 *
 * Both unreadable row shapes wear the same "Couldn't read" chip while nobody has answered — the
 * garbled cell with nothing to offer and the unclear cell offering two readings. The second used to
 * wear the decision style (`act-choice`) from the start, so two rows saying the identical words
 * looked like two different problems. The row becomes a decision the moment something WILL be
 * written: a picked reading, or a completed entry. PRESENTATION ONLY — it reads `chosen`, it never
 * decides it, and nothing here reaches the save.
 *
 * @param {{ chosen?: any, entered?: any, options?: any[] }|null|undefined} s an UNREADABLE cell state
 * @returns {'act-read'|'act-choice'}
 */
export function unreadableTagClass(s) {
    const picked  = typeof s?.chosen === 'number' && !!s.options?.[s.chosen];
    const entered = s?.chosen === 'entered' && !!s.entered;
    return picked || entered ? 'act-choice' : 'act-read';
}
