// @ts-check
/**
 * roster-review-states.js — what state every cell of the roster review is in, and whether it is
 * TICKED.
 *
 * Owns: `computeCellStates` — the classification (MATCH · DIFF · CONFLICT · COVERED ·
 *   REMOVE_IMPORT · UNREADABLE), the `chosen` default that decides what a Save actually writes,
 *   and the `UNKNOWN|` / `RDW|` review encodings the renderer reads back.
 * Does NOT own: the parse, the review table's DOM, the entry control, or any write.
 * Edit here for: a new cell state, or a change to what is ticked by default.
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
 *      start `null`. Only DIFF and REMOVE_IMPORT are pre-ticked.
 *   2. THE ALIGNMENT VERDICT IS TAKEN ONCE, HERE, because `chosen` is decided here. It used to be
 *      computed at render time, under a banner, while every change stayed ticked — reporting is
 *      not refusing (v22.16).
 *   3. AN UNREADABLE CELL NEVER WRITES ITS SENTINEL, and every candidate reading offered as a pick
 *      goes through the same `normaliseCellValue` guards a parsed value does. Picking must not be
 *      a route to write something the parsed path would have refused — a Sunday AL, say.
 *   4. RDW-PARITY IS PART OF "COVERED". A stored `{type:'shift', '14:30-22:00'}` and an incoming
 *      `RDW|14:30-22:00` are equal on the bare time, so without the type check the overtime
 *      reclassification is dropped in silence. Sundays are excluded from that check on purpose.
 *   5. A PREVIOUS IMPORT AND A MANUAL ENTRY ARE DIFFERENT THINGS. `isManual` picks the branch, and
 *      REMOVE_IMPORT exists so a row that now matches the base roster DELETES the stale import
 *      rather than writing a fresh base-matching override — which would mask a later base change.
 */

import { teamMembers, getBaseShift, isSunday, parseISODate } from './roster-data.js';
import { shouldReplaceOverride } from './override-utils.js';
import { normaliseCellValue } from './roster-cell-rules.js';
import { assessRosterAlignment } from './roster-alignment.js';

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
 *   { state: 'MATCH'|'DIFF'|'CONFLICT'|'COVERED', parsedShift, baseShift,
 *     manualValue?, manualId?, chosen }
 *
 * State meanings:
 *   MATCH    — PDF matches base roster, no override → nothing to do
 *   DIFF     — PDF differs from base roster, no manual override → propose change
 *   CONFLICT — A manually entered override exists that differs from the PDF → flag it
 *   COVERED  — A manual override exists and already matches the PDF → nothing to do
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

    // The alignment verdict is taken ONCE, here, because `chosen` is decided here — it used to be
    // computed at render time under a banner while every change stayed ticked. Rules and reasoning:
    // roster-alignment.js.
    const alignment = assessRosterAlignment(parsedResult);

    for (const entry of parsedResult.parsed) {
        // Only process names that exist in teamMembers (not hidden)
        const member = teamMembers.find(m => m.name === entry.memberName && !m.hidden);
        if (!member) continue;
        const drift = alignment.byMember.get(entry.memberName) || null;

        for (const date of parsedResult.dates) {
            let parsedShift  = entry.shifts?.[date] || 'RD';
            // Bare 'RDW' = the AI omitted the shift time. The server passes it through so the
            // review can flag it, but there is NO edit affordance and it previously classified
            // as a default-ticked DIFF whose save produced {type:'rdw', value:'RDW'} — which
            // firestore.rules rejects (rdw requires HH:MM-HH:MM), failing the WHOLE ≤200-row
            // chunk as permission-denied with a misleading "session may have expired" error.
            // Route it to the skip-only UNREADABLE row instead — never written (v16.23).
            if (parsedShift === 'RDW') parsedShift = 'UNKNOWN|RDW (no time on roster)';
            const baseShift    = getBaseShift(member, parseISODate(date));
            const key          = `${entry.memberName}|${date}`;
            const existing     = overrideMap.get(key);

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
                const opts = Array.isArray(cand)
                    ? cand.map(v => normaliseCellValue(v, baseShift, date))
                          // A pair that normalises to the same thing is not a question worth asking
                          // (e.g. AL vs RD on a Sunday — both become RD).
                          .filter((o, i, all) => all.findIndex(x => x.value === o.value) === i)
                    : [];
                states.set(key, {
                    state: 'UNREADABLE',
                    // The DATE is carried on the state (v22.17). The in-place entry has to apply the
                    // Sunday guard, and deriving the date by splitting the Map key at the call site
                    // would be a second place that knows the key's shape.
                    date,
                    parsedShift, baseShift,
                    manualValue: existing?.value ?? null,
                    manualId:    existing?.id    ?? null,
                    manualType:  existing?.type  ?? null,
                    manualReplacedType: existing?.replacedType ?? null,
                    // Whether a MANUAL entry is at stake (v19.37). Picking a reading writes with
                    // replaceId, so it replaces whatever is stored — routine for a previous import,
                    // but for a hand-recorded entry it is the one thing this table otherwise
                    // guarantees never happens silently: a READABLE PDF value in the same situation
                    // becomes a CONFLICT row that shows "Saved: X" and asks. The flagged row shows it
                    // too, so the choice is made knowing what it costs.
                    isManual:    existing ? (existing.source !== 'roster_import') : false,
                    chosen:      null,
                    options:     opts.length > 1 ? opts : null,
                    /** What the admin typed in, once they have (v22.17). `chosen === 'entered'`
                     *  selects it; until then it is a draft and writes nothing, exactly like an
                     *  unpicked reading. */
                    entered:     null,
                    /** The in-progress entry: which pill is down and what is in the time boxes.
                     *  Kept on the state rather than read back off the DOM so a re-render (a tick
                     *  elsewhere refreshes the whole list) cannot lose a half-typed shift. */
                    draft:       { type: null, from: '', to: '' },
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
            const { value: normParsed, display: displayValue } = normaliseCellValue(parsedShift, baseShift, date);
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
            if (!existing || !isManual) {
                // No override, or only a previous import.
                if (existing && !isManual && normRest(existing.value) === normParsed && rdwMatches) {
                    state = 'COVERED';  // previous import already equals the PDF — nothing to re-approve
                } else if (normParsed === normBase) {
                    // PDF now matches the base roster.
                    //  • No override to clean up → genuinely nothing to do (MATCH).
                    //  • A stale previous import still exists (and can't equal the PDF, or it would
                    //    be COVERED above) → REMOVE_IMPORT: delete the stale doc and write NOTHING.
                    //    Writing a fresh base-matching override (the old DIFF behaviour) was
                    //    redundant AND would MASK a later base-roster change (an override always
                    //    beats the base), so a "matches base today" row silently kept the old value.
                    state = existing ? 'REMOVE_IMPORT' : 'MATCH';
                } else {
                    // PDF differs from base (a genuine change), OR a stale differing import must be
                    // replaced with a new value. Approving deletes the old import (replaceId) and
                    // writes the corrected value.
                    state = 'DIFF';
                }
            } else {
                // A manual override exists — check if it already matches the PDF
                if (normRest(existing.value) === normParsed && rdwMatches) {
                    state = 'COVERED';   // manual is already correct — nothing to do
                } else if ((existing.value === 'SICK' || existing.value === 'AL') && normBase === 'RD' && normParsed === 'RD') {
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
                manualId:    existing?.id    ?? null,
                // FAIL CLOSED ON A SUSPECT ROW (v22.16): a member whose week looks a day out — or
                // anyone at all once the breaker has tripped — starts UNTICKED, so the default
                // action on a misread week stops being "save it".
                chosen:      (drift || alignment.blocked) ? false
                    : ((state === 'DIFF' || state === 'REMOVE_IMPORT') ? true : null),
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
