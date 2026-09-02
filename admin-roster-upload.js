// @ts-check
// MYB Roster — Weekly Roster Upload Pipeline
// Handles: file selection, Cloud Function call, AI-parsed shift review,
// conflict detection, and Firestore batch write.
// Called by operations-app.js via initRosterUpload().

import { teamMembers, MONTH_ABB, getShiftBadge, getBaseShift, escapeHtml, formatISO, isSunday, parseISODate } from './roster-data.js';
import { db, collection, query, where, getDocs, doc, writeBatch, serverTimestamp, writeWithClaimRetry, COLLECTIONS } from './firebase-client.js';
import { shouldReplaceOverride, parseOtherValue, buildOverrideWrite, nextReplacedType } from './override-utils.js';
import { entryControlHtml, patchEntryRow, commitEntry } from './roster-entry-control.js';
import { normaliseCellValue, shiftValueToOverrideType, isZeroLengthRange } from './roster-cell-rules.js';
// RE-EXPORTED, not re-implemented: all three moved to roster-cell-rules.js (v22.17/v22.18) and
// several call sites (and their tests) name this module. The alternative was a rename sweep across
// three test files for no behavioural gain.
export { normaliseCellValue, shiftValueToOverrideType, isZeroLengthRange };
import { setStatus } from './status-text.js';
import { assessRosterAlignment, driftCopy, stopCopy } from './roster-alignment.js';

const RDW_PREFIX   = 'RDW|';
const isRdwEncoded = /** @param {any} v */ v => typeof v === 'string' && v.startsWith(RDW_PREFIX);
const stripRdw     = /** @param {any} v */ v => v.slice(RDW_PREFIX.length);

// UNKNOWN|<raw> — a value the AI returned that normaliseShift (server) could not recognise as a
// shift. Surfaced in review as an UNREADABLE cell so a garbled real shift isn't silently dropped;
// never written to Firestore (see computeCellStates / the save path). Mirrors the RDW encoding.
const UNKNOWN_PREFIX   = 'UNKNOWN|';
const isUnknownEncoded = /** @param {any} v */ v => typeof v === 'string' && v.startsWith(UNKNOWN_PREFIX);
const stripUnknown     = /** @param {any} v */ v => v.slice(UNKNOWN_PREFIX.length);

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Badge HTML (+ raw time for worked shifts) for one shift value in the review table.
 * Pure and stateless, so it lives at module scope and is reused across renders
 * rather than being re-created inside renderReviewTable on every parse.
 * A worked shift on a Sunday renders as RDW — Sundays are uncontracted, so any
 * Sunday shift is by definition overtime.
 *
 * Exported for tests (v18.85) — it is pure, so its badge/time/unreadable branches are worth
 * pinning directly rather than only through the DOM-heavy review table that calls it.
 * @param {string} shiftStr
 * @param {string|null} date       ISO date — detects a Sunday worked shift
 * @returns {string} HTML
 */
export function shiftDisplay(shiftStr, date = null) {
    if (isUnknownEncoded(shiftStr)) {
        return `<span class="review-shift-unreadable">⚠ couldn't read “${escapeHtml(stripUnknown(shiftStr))}”</span>`;
    }
    if (isRdwEncoded(shiftStr)) {
        const time = stripRdw(shiftStr);
        return `${getShiftBadge('RDW')}<span class="review-shift-time">${escapeHtml(time)}</span>`;
    }
    // Other-family values: the badge alone hid the RDW marker — but TRG vs TRG RDW decides
    // between "nothing to pay" and the 8h RDW default, so the review must show it (and any times).
    const _o = parseOtherValue(shiftStr);
    if (_o && (_o.rdw || _o.time)) {
        const detail = [_o.rdw ? 'RDW' : '', _o.time ?? ''].filter(Boolean).join(' ');
        return `${getShiftBadge(shiftStr)}<span class="review-shift-time">${escapeHtml(detail)}</span>`;
    }
    const isTime = /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(shiftStr);
    const sundayWorked = isTime && date !== null && isSunday(date);
    const badge = getShiftBadge(sundayWorked ? 'RDW' : shiftStr);
    return isTime
        ? `${badge}<span class="review-shift-time">${escapeHtml(shiftStr)}</span>`
        : badge;
}

/**
 * Render a stored MANUAL override value for the review table, restoring the 💼 RDW badge when the
 * override's type is 'rdw'. A stored rdw override's value is the bare time ("14:30-22:00") — the
 * RDW-ness lives in `type`, not the value — so shiftDisplay(value) alone showed an ordinary
 * Early/Late badge, and the admin couldn't tell a saved RDW from a normal shift when resolving a
 * CONFLICT or reviewing a REMOVE_IMPORT. Re-encode as "RDW|<time>" so shiftDisplay picks the badge (v16.19).
 * Exported for tests (v18.85) — pure, like shiftDisplay which it delegates to.
 * @param {{manualValue: string|null, manualType?: string|null}} s
 * @returns {string} HTML
 */
export function manualShiftDisplay(s) {
    const v = s.manualValue;
    if (s.manualType === 'rdw' && v && /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(v)) {
        return shiftDisplay(`${RDW_PREFIX}${v}`);
    }
    return shiftDisplay(/** @type {string} */ (v));
}

/**
 * Write the reviewed roster changes to Firestore in chunked batches. Each chunk's batch is
 * built and committed INSIDE a `writeWithClaimRetry` thunk, so a freshly-provisioned or
 * claim-changed admin whose ID token is stale self-heals (permission-denied → force token
 * refresh → retry once), matching every other Admin write path. The batch is rebuilt on each
 * attempt because a `WriteBatch` cannot be reused after a failed commit. Exported for tests.
 *
 * @param {Array<{memberName: string, date: string, value: string|null, baseShift: string, replaceId?: string, deleteOnly?: boolean, replacedFrom?: {type?: string, replacedType?: string|null}|null}>} toWrite
 * @param {string} currentUser  Logged-in member name, written to `changedBy`.
 * @returns {Promise<void>}  Rejects (after one retry) if the write is genuinely denied.
 */
export async function _saveOverrideBatches(toWrite, currentUser) {
    // Firestore batches are capped at 500 ops. Each item can be a delete + a set (2 ops),
    // so chunk at 200 to stay well under the limit.
    const CHUNK = 200;
    let _committedChunks = 0;
    for (let i = 0; i < toWrite.length; i += CHUNK) {
        const chunk = toWrite.slice(i, i + CHUNK);
        try {
        await writeWithClaimRetry(async () => {
            const batch = writeBatch(db);
            for (const { memberName, date, value, baseShift, replaceId, deleteOnly, replacedFrom } of chunk) {
                if (deleteOnly) {
                    // REMOVE_IMPORT — delete the stale import doc and write nothing.
                    if (replaceId) batch.delete(doc(db, COLLECTIONS.overrides, replaceId));
                    continue;
                }
                // DEFENCE IN DEPTH: a zero-length worked range never reaches Firestore (v20.39).
                // `normaliseShift` refuses equal start/end on the server, and this is the second
                // lock on the same door — the audit's §24 asks for it here precisely because the
                // server is not the only way a value arrives: the review table's CONFLICT picker
                // lets an admin choose between two candidate readings, and a hand-edited cell goes
                // through this path too. Skipping is the safe failure: the day keeps whatever it
                // already had rather than gaining a shift the maths would read as 24 hours.
                if (typeof value === 'string' && isZeroLengthRange(/** @type {string} */ (value))) {
                    console.warn(`[roster-upload] Refused zero-length shift "${value}" for ${memberName} ${date} — not written`);
                    continue;
                }

                // Map shift value to override type — pass date so Sunday shifts are correctly
                // saved as 'rdw' and an explicit RDW| prefix is honoured. (value is a real string
                // here — deleteOnly items, the only ones with a null value, continued above.)
                const type = shiftValueToOverrideType(/** @type {string} */ (value), baseShift, date);
                // Strip the internal "RDW|" encoding before saving — Firestore stores the plain
                // time as the value (e.g. "14:30-22:00"), type field carries 'rdw'.
                let savedValue = isRdwEncoded(value) ? stripRdw(value) : value;
                // A 'correction' override always means "set as Rest Day" — its canonical value is
                // 'RD'. Normalise every source that maps to correction (bilingual 'OFF', plain 'RD',
                // or a Sunday AL/SICK) so firestore.rules doesn't reject a {correction, 'OFF'} write.
                if (type === 'correction') savedValue = 'RD';
                // Replace any existing override for this member/date in the same batch, so
                // "Use new roster" / a re-import doesn't leave a stale doc beside the new one.
                if (replaceId) batch.delete(doc(db, COLLECTIONS.overrides, replaceId));
                const ref = doc(collection(db, COLLECTIONS.overrides));
                // source: 'roster_import' marks this as auto-applied, not hand-entered. buildOverrideWrite
                // is the single source for the rules-required field set (shared with the two admin save paths).
                // The import deletes the doc it replaces like every other write path, so it must
                // preserve what that doc SAID the same way (v21.56) — without this, a re-import
                // resolving a DIFF/CONFLICT over a swapped-in day destroyed the only evidence the
                // member was contracted to work it, and leave booked there afterwards went free.
                batch.set(ref, buildOverrideWrite(
                    { memberName, date, type, value: savedValue, note: '', source: 'roster_import', changedBy: currentUser,
                      replacedType: nextReplacedType(replacedFrom, type) },
                    serverTimestamp()));
            }
            await batch.commit();
        });
        _committedChunks++;
        } catch (err) {
            // A chunk failed after earlier chunks committed → partial roster import is now in
            // Firestore. Tag the error so the caller can resync + warn rather than imply nothing
            // saved (v16.25). First-chunk failure committed nothing — no tag.
            if (_committedChunks > 0) /** @type {any} */ (err).partialCommit = true;
            throw err;
        }
    }
}

/**
 * Fetch all override documents for a specific set of dates from Firestore.
 * We only fetch dates in the roster week — no need to load the full cache.
 *
 * FAIL CLOSED (v16.25): a getDocs failure must NOT resolve to "no existing overrides". The whole
 * point of this read is to know about manual AL/absence/shift changes and prior imports before the
 * review table classifies rows — returning [] let the review mark rows safe while BLIND to that
 * data, so Save could silently overwrite/duplicate manual changes (the prior Tier-1 bug). On error
 * this throws a tagged `conflictReadFailed` error; the parse handler stops, shows a clear message,
 * and never renders an applyable review. Hoisted to module scope + exported for regression testing;
 * uses only module-scope Firebase imports (db/query/collection/where/getDocs/COLLECTIONS), no closure state.
 *
 * @param {string[]} dates - Array of YYYY-MM-DD strings (the 7 days of the week)
 * @returns {Promise<Array<any>>} Array of override objects { id, memberName, date, value, source, ... }
 */
export async function fetchOverridesForWeek(dates) {
    try {
        const q    = query(collection(db, COLLECTIONS.overrides), where('date', 'in', dates));
        const snap = await getDocs(q);
        return snap.docs.map(/** @param {any} d */ d => ({ id: d.id, ...d.data() }));
    } catch (err) {
        console.error('[RosterUpload] Could not fetch existing overrides:', err);
        const e = new Error('CONFLICT_READ_FAILED');
        /** @type {any} */ (e).conflictReadFailed = true;
        throw e;
    }
}

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

/**
 * Initialise the weekly roster upload pipeline.
 * Wires up all DOM event listeners for the Roster Upload card in admin.html.
 *
 * @param {object}   opts
 * @param {string}   opts.currentUser    - Logged-in member name (written to changedBy on saves)
 * @param {boolean}  opts.currentIsAdmin - Whether the user has admin rights
 * @param {string}   opts.parseUrl       - Cloud Function URL for parseRosterPDF
 * @param {Function} opts.getIdToken     - Async function returning the current user's Firebase ID token
 * @param {Function} opts.loadOverrides  - Refreshes the override cache and week grid after a save
 */
export function initRosterUpload({ currentUser, currentIsAdmin, parseUrl, getIdToken, loadOverrides }) {
    if (!currentIsAdmin) return;

    const esc = escapeHtml;  // local alias

    const card           = document.getElementById('rosterUploadCard');
    const rosterTypeEl   = /** @type {HTMLSelectElement|null} */ (document.getElementById('rosterType'));
    const weekEndingEl   = /** @type {HTMLInputElement|null} */ (document.getElementById('rosterWeekEnding'));
    const fileInput      = /** @type {HTMLInputElement|null} */ (document.getElementById('rosterFileInput'));
    const fileNameEl     = /** @type {HTMLElement} */ (document.getElementById('rosterFileName'));
    const parseBtn       = /** @type {HTMLButtonElement|null} */ (document.getElementById('rosterParseBtn'));
    const parseFeedback  = /** @type {HTMLElement} */ (document.getElementById('rosterParseFeedback'));
    const reviewSection  = /** @type {HTMLElement} */ (document.getElementById('rosterReviewSection'));
    const outcomeEl      = /** @type {HTMLElement} */ (document.getElementById('rosterOutcome'));
    const reviewLabel    = /** @type {HTMLElement} */ (document.getElementById('rosterReviewLabel'));
    let   changeList     = /** @type {HTMLElement} */ (document.getElementById('rosterChangeList'));
    const applyBtn       = /** @type {HTMLButtonElement} */ (document.getElementById('rosterApplyBtn'));
    const cancelBtn      = /** @type {HTMLButtonElement} */ (document.getElementById('rosterCancelBtn'));
    const applyFeedback  = /** @type {HTMLElement} */ (document.getElementById('rosterApplyFeedback'));

    if (!card || !rosterTypeEl || !weekEndingEl || !fileInput || !parseBtn) return;

    // Reveal the card for admin users
    card.style.display = '';

    // In-memory store for the parsed result and computed cell states.
    // Cleared when "Start over" is clicked.
    /** @type {any} */ let _parsedResult = null;      // response from parseRosterPDF Cloud Function
    /** @type {any} */ let _cellStates   = null;      // computed Map: "memberName|date" → { state, parsedShift, manualValue, manualId, chosen }

    // Default week ending to the next Saturday (roster PDFs always end on a Saturday).
    // If today is already Saturday, jump to the one after so we default to the upcoming week.
    {
        const today = new Date();
        const day   = today.getDay(); // 0=Sun … 6=Sat
        const daysUntilNextSaturday = day === 6 ? 7 : 6 - day;
        const nextSaturday = new Date(today);
        nextSaturday.setDate(today.getDate() + daysUntilNextSaturday);
        weekEndingEl.value = formatISO(nextSaturday);
    }

    // ---- Snap any non-Saturday selection to the nearest Saturday ----
    // HTML date inputs have no built-in day-of-week restriction, so we enforce
    // it here: if the user picks a date that isn't a Saturday, we move it forward
    // to the next Saturday automatically.
    weekEndingEl.addEventListener('change', () => {
        if (!weekEndingEl.value) return;
        const picked = parseISODate(weekEndingEl.value);
        const day    = picked.getDay(); // 0=Sun … 6=Sat
        if (day !== 6) {
            const daysToSaturday = day === 0 ? 6 : 6 - day;
            picked.setDate(picked.getDate() + daysToSaturday);
            weekEndingEl.value = formatISO(picked);
        }
    });

    // ---- Show chosen filename and enable parse button ----
    fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        parseFeedback.textContent = '';
        parseFeedback.className   = 'huddle-feedback';
        if (!file) {
            fileNameEl.classList.remove('visible');
            parseBtn.disabled = true;
            return;
        }
        if (!file.name.toLowerCase().endsWith('.pdf')) {
            fileNameEl.classList.remove('visible');
            parseBtn.disabled         = true;
            parseFeedback.textContent = 'Please choose a PDF file';
            parseFeedback.className   = 'huddle-feedback huddle-feedback--err';
            fileInput.value           = '';
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            fileNameEl.classList.remove('visible');
            parseBtn.disabled         = true;
            parseFeedback.textContent = 'File too large — maximum 10 MB';
            parseFeedback.className   = 'huddle-feedback huddle-feedback--err';
            fileInput.value           = '';
            return;
        }
        fileNameEl.textContent = file.name;
        fileNameEl.classList.add('visible');
        parseBtn.disabled      = false;
    });

    // ---- "Read Roster" button ----
    parseBtn.addEventListener('click', async () => {
        const file       = fileInput.files?.[0];
        const weekEnding = weekEndingEl.value;
        const rosterType = rosterTypeEl.value;

        if (!file || !weekEnding) return;

        // Reset UI + lock the form so a mid-parse change to the roster type, week,
        // or file can't silently mismatch the in-flight request (which captured the
        // originals above).
        parseFeedback.textContent = '';
        parseFeedback.className   = 'huddle-feedback';
        reviewSection.classList.remove('visible');
        parseBtn.disabled         = true;
        parseBtn.textContent        = 'Reading…';
        rosterTypeEl.disabled       = true;
        weekEndingEl.disabled       = true;
        fileInput.disabled          = true;

        try {
            // Convert file to base64 — same technique as ingestHuddle
            const base64 = await fileToBase64(file);

            // Call the Cloud Function
            parseFeedback.textContent = 'Reading the PDF — this takes about 15 seconds…';
            // A moving indicator alongside the (changing) status text — a 15–90s wait with only
            // static text reads as "stuck", and reloading throws away the whole parse. Removed in
            // the finally so it never lingers; CSS drops the motion under reduced-motion (B1).
            parseFeedback.className   = 'huddle-feedback huddle-feedback--working';

            const idToken = await getIdToken();
            // iOS Safari aborts uncontrolled fetches at around 60s — explicit
            // AbortController gives us a known 90s window and a typed AbortError.
            const abortCtrl  = new AbortController();
            const abortTimer = setTimeout(() => abortCtrl.abort(), 90_000);
            let response;
            try {
                response = await fetch(parseUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization':  `Bearer ${idToken}`,
                        'Content-Type':   'text/plain',
                        'X-Week-Ending':  weekEnding,
                        'X-Roster-Type':  rosterType,
                    },
                    body: base64,
                    signal: abortCtrl.signal,
                });
            } finally {
                clearTimeout(abortTimer);
            }

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || `Server error (${response.status})`);
            }

            _parsedResult = await response.json();
            parseFeedback.textContent = '';

            // Fetch existing overrides for this week from Firestore so we can detect conflicts
            parseFeedback.textContent = 'Checking for existing schedule changes…';
            const existingOverrides = await fetchOverridesForWeek(_parsedResult.dates);
            parseFeedback.textContent = '';

            // Compute cell states and render the review table
            _cellStates = computeCellStates(_parsedResult, existingOverrides);
            renderReviewTable(_parsedResult, _cellStates);

        } catch (err) {
            console.error('[RosterUpload] Parse failed:', err);
            const _err = /** @type {any} */ (err);
            if (_err.conflictReadFailed) {
                // The PDF parsed fine, but the existing-overrides SAFETY read failed — fail closed:
                // wipe any stale review state so an earlier parse's table can't be applied against
                // this now-unverified upload, and keep the review hidden (v16.25).
                _cellStates = null;
                reviewSection.classList.remove('visible');
                parseFeedback.textContent = "Couldn't check your existing saved changes, so the roster was not applied. Check your connection and try again.";
                parseFeedback.className   = 'huddle-feedback huddle-feedback--err';
            } else {
                let userMsg;
                if (_err.name === 'AbortError' || (_err.name === 'TypeError' && _err.message.includes('Load failed'))) {
                    userMsg = 'Parsing took longer than expected. The PDF may be large — please try again, or check your connection.';
                } else if (_err instanceof TypeError && _err.message === 'Failed to fetch') {
                    userMsg = "Couldn't reach the server — check your internet connection or try again later.";
                } else {
                    userMsg = 'Unexpected error — please try again or contact support.';
                }
                parseFeedback.textContent = `Couldn't read the roster: ${userMsg}`;
                parseFeedback.className   = 'huddle-feedback huddle-feedback--err';
            }
        } finally {
            // Always stop the working indicator — success clears the text, the error paths swap in
            // the --err class, but the spinner must never outlive the attempt on any path (B1).
            parseFeedback.classList.remove('huddle-feedback--working');
            parseBtn.disabled     = false;
            parseBtn.textContent  = 'Read roster';
            rosterTypeEl.disabled = false;
            weekEndingEl.disabled = false;
            fileInput.disabled    = false;
        }
    });

    // ---- "Start over" button ----
    cancelBtn.addEventListener('click', () => {
        reviewSection.classList.remove('visible');
        _parsedResult = null;
        _cellStates   = null;
        fileInput.value           = '';
        fileNameEl.classList.remove('visible');
        parseBtn.disabled         = true;
        applyFeedback.textContent = '';
        applyFeedback.className   = 'huddle-feedback';
    });

    // ---- "Save changes" button ----
    applyBtn.addEventListener('click', async () => {
        if (!_parsedResult || !_cellStates) return;

        // Collect all DIFF cells that are ticked (approved) + any CONFLICT cells
        // where the admin chose "Use PDF"
        const toWrite = [];

        for (const [key, state] of _cellStates) {
            const [memberName, date] = key.split('|');

            // THE HARD GATE (v22.16) — defence in depth beneath the inert ticks, and the reason
            // it is pinned statically rather than behaviourally (admin-roster-upload.test.mjs).
            if (state.rosterBlocked) continue;

            if (state.state === 'DIFF' && state.chosen !== false) {
                // Write the value the row DISPLAYED (displayShift — Sunday/rest-day-normalised):
                // what the admin approved is what gets written. manualId = any existing override
                // doc, to be replaced. (There is no per-cell edit UI — the review is approve/skip.)
                toWrite.push({ memberName, date, value: state.displayShift ?? state.parsedShift, baseShift: state.baseShift, replaceId: state.manualId, replacedFrom: state.manualId ? { type: state.manualType, replacedType: state.manualReplacedType } : null });
            }
            if (state.state === 'REMOVE_IMPORT' && state.chosen !== false) {
                // A stale previous import whose day now matches base — delete it, write nothing
                // (a fresh base-matching override would be redundant and mask future base changes).
                toWrite.push({ memberName, date, value: null, baseShift: state.baseShift, replaceId: state.manualId, deleteOnly: true });
            }
            if (state.state === 'UNREADABLE' && state.chosen === 'entered' && state.entered) {
                // The admin answered the unreadable cell in place (v22.17). Writes the same shape a
                // picked reading does, and the value has been through the identical guards.
                toWrite.push({ memberName, date, value: state.entered.display, baseShift: state.baseShift, replaceId: state.manualId, replacedFrom: state.manualId ? { type: state.manualType, replacedType: state.manualReplacedType } : null });
            }
            if (state.state === 'UNREADABLE' && typeof state.chosen === 'number' && state.options?.[state.chosen]) {
                // The admin resolved a two-way "couldn't read" by picking one of the two readings
                // (v19.32). Writes the option's DISPLAY value — already through normaliseCellValue,
                // so it carries the same Sunday / base-rest-day guards and the RDW| marker as any
                // parsed value. Untouched rows keep chosen === null and are still never written.
                toWrite.push({ memberName, date, value: state.options[state.chosen].display, baseShift: state.baseShift, replaceId: state.manualId, replacedFrom: state.manualId ? { type: state.manualType, replacedType: state.manualReplacedType } : null });
            }
            if (state.state === 'CONFLICT' && state.chosen === 'pdf') {
                // Admin chose PDF over the existing manual entry — replace it, don't leave both
                // docs for the same date. Write the row's DISPLAYED (normalised) value: a raw
                // SICK on a base rest day would otherwise bypass the restSafe guard here and
                // land as a rest-day absence doc the review had shown as "RD".
                toWrite.push({ memberName, date, value: state.displayShift ?? state.parsedShift, baseShift: state.baseShift, replaceId: state.manualId, replacedFrom: state.manualId ? { type: state.manualType, replacedType: state.manualReplacedType } : null });
            }
        }

        if (toWrite.length === 0) {
            applyFeedback.textContent = 'Nothing to save — all changes are either skipped or already up to date.';
            applyFeedback.className   = 'huddle-feedback';
            return;
        }

        applyBtn.disabled    = true;
        applyBtn.textContent = `Saving ${toWrite.length} change${toWrite.length !== 1 ? 's' : ''}…`;
        applyFeedback.textContent = '';

        try {
            await _saveOverrideBatches(toWrite, currentUser);

            // Update the in-memory override cache so the week grid and table refresh
            // without a round-trip to Firestore.  We don't know the new doc IDs but
            // loadOverrides() will re-fetch cleanly.
            await loadOverrides();

            applyFeedback.textContent = `Done — ${toWrite.length} change${toWrite.length !== 1 ? 's' : ''} applied to the roster.`;
            applyFeedback.className   = 'huddle-feedback huddle-feedback--ok';

            // Clear the review table so it can't be applied twice
            reviewSection.classList.remove('visible');
            _parsedResult = null;
            _cellStates   = null;
            fileInput.value = '';
            fileNameEl.classList.remove('visible');
            parseBtn.disabled = true;

        } catch (err) {
            console.error('[RosterUpload] Apply failed:', err);
            const _applyErr = /** @type {any} */ (err);
            if (_applyErr?.partialCommit) {
                // Earlier chunks committed before the failure — partial import is live in Firestore.
                // Resync the Saved-changes list and CLOSE the review (its remaining rows are now
                // ambiguous against the partially-applied state; a fresh re-upload re-reads truth
                // via the v16.25 fail-closed conflict-read) (v16.25).
                try { await loadOverrides(); } catch { /* best-effort */ }
                reviewSection.classList.remove('visible');
                _parsedResult = null;
                _cellStates   = null;
                applyFeedback.textContent = "The connection dropped part-way — some of the roster may already be saved. The saved changes list has been refreshed; re-read the roster to check before applying again.";
                applyFeedback.className   = 'huddle-feedback huddle-feedback--err';
                applyBtn.disabled    = true;
                applyBtn.textContent = 'Save changes';
                return;
            }
            const detail = _applyErr?.code === 'permission-denied'
                ? 'your session may have expired. Try signing out and back in.'
                : (_applyErr?.message || 'Unknown error — check the browser console.');
            applyFeedback.textContent = `Couldn't save — ${detail}`;
            applyFeedback.className   = 'huddle-feedback huddle-feedback--err';
            applyBtn.disabled    = false;
            applyBtn.textContent = 'Save changes';
        }
    });

    // ------------------------------------------------------------------
    // HELPERS
    // ------------------------------------------------------------------

    /**
     * Read a File object and return its contents as a base64 string.
     * @param {File} file
     * @returns {Promise<string>}
     */
    function fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload  = () => {
                // result is "data:application/pdf;base64,AAAA…" — strip the prefix
                const base64 = /** @type {string} */ (reader.result).split(',')[1];
                resolve(base64);
            };
            reader.onerror = () => reject(new Error('Could not read the file'));
            reader.readAsDataURL(file);
        });
    }

    /**
     * Render the post-parse review UI as a list of per-person cards.
     * Only people with at least one DIFF or CONFLICT are shown.
     * Uses event delegation on changeList so no listener accumulation on re-render.
     *
     * @param {any} parsedResult
     * @param {Map<string, any>}    cellStates
     */
    function renderReviewTable(parsedResult, cellStates) {
        const { dates, parsed, weekEnding } = parsedResult;

        // Recompute what pressing "Save changes" will actually do, and refresh BOTH the Save
        // button (label carries the running count + disables when nothing will be written) and
        // the plain-language outcome summary above the list. Presentation only — the state
        // machine (computeCellStates) and the `chosen` model are unchanged.
        function refreshOutcome() {
            // A refused read has no outcome to summarise (v22.16): "Save 41 changes" beside
            // "nothing has been selected" is what makes a safety gate read as a suggestion.
            if ([...cellStates.values()].some(st => st.rosterBlocked)) {
                // The Save button is REMOVED, not relabelled (v22.16 polish). Leaving it in place
                // reading "Read the roster again" put an instruction on a dead control while the
                // button that actually does that — "Upload a different file" — sat underneath it
                // as the quiet secondary. A disabled control telling you what to do is the worst
                // of both: it looks like the way forward and it is not.
                applyBtn.hidden = true;
                applyBtn.disabled = true;
                cancelBtn?.classList.add('roster-cancel-btn--primary');
                if (cancelBtn) cancelBtn.textContent = 'Read the roster again';
                outcomeEl.hidden = true;
                outcomeEl.innerHTML = '';
                return;
            }
            applyBtn.hidden = false;
            cancelBtn?.classList.remove('roster-cancel-btn--primary');
            if (cancelBtn) cancelBtn.textContent = 'Upload a different file';
            let updates = 0, clears = 0, conflictsTotal = 0, conflictsSwitched = 0, unreadable = 0;
            for (const st of cellStates.values()) {
                if      (st.state === 'DIFF')          { if (st.chosen !== false) updates++; }
                else if (st.state === 'REMOVE_IMPORT') { if (st.chosen !== false) clears++; }
                else if (st.state === 'CONFLICT')      { conflictsTotal++; if (st.chosen === 'pdf') { conflictsSwitched++; updates++; } }
                else if (st.state === 'UNREADABLE')    {
                    // A resolved one is an update, not an outstanding "couldn't read" — otherwise the
                    // banner keeps reporting a problem the admin has just fixed.
                    if (typeof st.chosen === 'number' && st.options?.[st.chosen]) updates++;
                    else if (st.chosen === 'entered' && st.entered) updates++;
                    else unreadable++;
                }
            }
            const writes = updates + clears;
            applyBtn.disabled    = writes === 0;
            applyBtn.textContent = writes === 0 ? 'Nothing to save' : `Save ${writes} change${writes !== 1 ? 's' : ''}`;

            const lines = [];
            if (updates > 0)
                lines.push(`<div class="ro-line ro-up"><span class="ro-k">✓</span><span><strong>${updates}</strong> shift${updates !== 1 ? 's' : ''} will be updated</span></div>`);
            if (clears > 0)
                lines.push(`<div class="ro-line ro-clear"><span class="ro-k">✓</span><span><strong>${clears}</strong> old ${clears !== 1 ? 'entries' : 'entry'} will be cleared</span></div>`);
            if (conflictsTotal > 0) {
                const kept   = conflictsTotal - conflictsSwitched;
                const detail = conflictsSwitched > 0
                    ? `${conflictsSwitched} switched to the new roster, ${kept} kept as you saved`
                    : 'kept as you saved — change below if needed';
                lines.push(`<div class="ro-line ro-choice"><span class="ro-k">?</span><span><strong>${conflictsTotal}</strong> ${conflictsTotal !== 1 ? 'days need' : 'day needs'} your choice — ${detail}</span></div>`);
            }
            if (unreadable > 0)
                lines.push(`<div class="ro-line ro-read"><span class="ro-k">⚠</span><span><strong>${unreadable}</strong> cell${unreadable !== 1 ? 's' : ''} couldn't be read — nothing saved</span></div>`);

            // SAY WHAT IS BEING WITHHELD (v22.16 polish). A suspect member's rows are unticked, so
            // they contribute to no count above — and the summary went silent about the one thing
            // that had changed. A withheld row is an outcome; "nothing will happen to these" is
            // exactly what the admin needs to read before they scroll past them.
            const heldBack = [...cellStates.values()].filter(st =>
                st.drift && (st.state === 'DIFF' || st.state === 'REMOVE_IMPORT')).length;
            if (heldBack > 0)
                lines.push(`<div class="ro-line ro-read"><span class="ro-k">⚠</span><span><strong>${heldBack}</strong> `
                    + `day${heldBack !== 1 ? 's' : ''} held back — the week may be a day out, so nothing there is selected</span></div>`);

            if (lines.length === 0) { outcomeEl.hidden = true; outcomeEl.innerHTML = ''; return; }
            outcomeEl.hidden = false;
            const anySuspect = [...cellStates.values()].some(st => st.drift);
            const hint = (updates > 0 || clears > 0)
                ? `<p class="ro-hint">Ticked rows will save — tap a ✓ to skip that row.${
                    anySuspect ? ' Rows flagged as possibly a day out start unticked; tick only what you have checked against the PDF.' : ''}</p>`
                : '';
            outcomeEl.innerHTML = `<h4 class="ro-h">When you tap “Save changes”</h4>${lines.join('')}${hint}`;
        }

        // ---- Cross-check confidence note (v16.70) ----
        // The server's column cross-check FAILS OPEN when the AI omits columnScan — sensible for
        // availability, but the reduced confidence must not be invisible to the admin. Only shown
        // when the (new) field is present and not 'complete', so an older deployed Function stays
        // silent rather than false-alarming.
        changeList.innerHTML = '';

        // ---- "View the original roster" (v22.16) ----
        // Failing closed is only fair if the admin can go and look: every message this release adds
        // ends in "check it against the PDF", and the file had left the workflow the moment the
        // parse returned. The object URL is built at CLICK time (a real gesture, so never
        // pop-up-blocked) and revoked on a timer, like the pay-data download.
        const pdfFile = fileInput?.files?.[0];
        if (pdfFile) {
            const view = document.createElement('button');
            view.type = 'button';
            view.className = 'roster-view-pdf';
            view.textContent = `📄 View the original roster (${pdfFile.name})`;
            view.addEventListener('click', () => {
                const url = URL.createObjectURL(pdfFile);
                window.open(url, '_blank', 'noopener');
                setTimeout(() => URL.revokeObjectURL(url), 60_000);
            });
            changeList.appendChild(view);
        }

        if (parsedResult.crossCheck && parsedResult.crossCheck !== 'complete') {
            const ccNote = document.createElement('div');
            ccNote.className = 'roster-crosscheck-note';
            ccNote.setAttribute('role', 'status');
            // NEVER NAME THE MECHANISM (v22.23, external review). This said "the independent column
            // check", which was wrong twice: it is implementation language nobody using the uploader
            // should have to learn, AND — established against three real rosters — that check is not
            // independent at all. It is a second reading by the same model of the same PDF in the
            // same call, so it agrees with the row read precisely when the row read is wrong.
            // Describe what the ADMIN must do, and let OPERATIONS_REFERENCE hold the mechanism.
            setStatus(ccNote, parsedResult.crossCheck === 'unavailable'
                ? '⚠ These days couldn\'t be double-checked automatically — compare each one with the PDF before saving, or read the roster again.'
                : '⚠ Some days couldn\'t be double-checked automatically — compare those days with the PDF before saving.');
            changeList.appendChild(ccNote);
        }
        // ---- Missing-member note (Finding #3) ----
        // The server flags any roster member of this type it never found a row for. A dropped row is
        // invisible in the list below (the person just isn't shown), so surface the names explicitly.
        // Advisory — could be a genuine absence (leaver/starter/other page). Guarded on the (new) field
        // so an older deployed Function stays silent rather than false-alarming.
        if (Array.isArray(parsedResult.missingMembers) && parsedResult.missingMembers.length) {
            const mmNote = document.createElement('div');
            mmNote.className = 'roster-crosscheck-note';
            mmNote.setAttribute('role', 'status');
            const names = parsedResult.missingMembers.map(/** @param {string} n */ n => esc(n)).join(', ');
            mmNote.innerHTML = `<span aria-hidden="true">⚠</span> <strong>Not found in this read:</strong> ${names}. If they should be on this roster, check the PDF — the read may have skipped a row — or read the roster again.`;
            changeList.appendChild(mmNote);
        }
        // ---- THE CIRCUIT BREAKER (v22.16) ---- Why several same-direction drifts mean a parser
        // failure rather than a coincidence of rotas: roster-alignment.js.
        const alignment = assessRosterAlignment(parsedResult);
        if (alignment.blocked) {
            const stop = document.createElement('div');
            stop.className = 'roster-alignment-stop';
            stop.setAttribute('role', 'alert');
            // NAME THEM, BUT CAP THE LIST. On a fifteen-person roster this can be eight names, and a
            // banner that runs to four lines of names buries the sentence that matters.
            const shown = alignment.suspects.slice(0, 4).map(/** @param {string} n */ n => esc(n)).join(', ');
            const more  = alignment.suspects.length - 4;
            const who   = more > 0 ? `${shown} and ${more} more` : shown;
            // Words live beside the verdict (roster-alignment.js): a geometry refusal has no direction.
            stop.innerHTML = stopCopy(alignment, who);
            changeList.appendChild(stop);
        }

        // ---- Build per-person sections ----
        let sectionsShown = 0;

        for (const entry of parsed) {
            const member = teamMembers.find(m => m.name === entry.memberName && !m.hidden);
            if (!member) continue;

            const changedDates = dates.filter(/** @param {any} d */ d => {
                const s = cellStates.get(`${entry.memberName}|${d}`);
                return s && (s.state === 'DIFF' || s.state === 'REMOVE_IMPORT' || s.state === 'CONFLICT' || s.state === 'UNREADABLE');
            });
            if (changedDates.length === 0) continue;

            const section = document.createElement('div');
            section.className = 'roster-person-section' + (alignment.blocked ? ' roster-blocked' : '');
            section.dataset.member = entry.memberName;

            // Person header
            section.innerHTML = `
                <div class="roster-person-header">
                    <span class="roster-person-name">${esc(entry.memberName)}</span>
                    <span class="roster-change-badge">${changedDates.length}</span>
                    <button class="roster-skip-all-btn" data-member="${esc(entry.memberName)}" aria-pressed="false">Skip all</button>
                </div>`;

            // Day-drift: the one check that does NOT come from the model (roster-alignment.js).
            // WARN-ONLY until v22.16; the rows now start unticked — computeCellStates owns that
            // decision, this states it.
            const drift = alignment.byMember.get(entry.memberName) || null;
            if (drift && !alignment.blocked) {
                section.classList.add('roster-person-suspect');
                const warn = document.createElement('div');
                warn.className = 'roster-shift-warning';
                warn.setAttribute('role', 'alert');
                warn.innerHTML = driftCopy(drift, esc(entry.memberName));
                section.appendChild(warn);
            }

            // One row per changed day
            for (const date of changedDates) {
                const key = `${entry.memberName}|${date}`;
                const s   = cellStates.get(key);
                const dt  = parseISODate(date);
                const dayName = DAY_NAMES[dt.getDay()];
                const dateStr = `${dt.getDate()} ${MONTH_ABB[dt.getMonth()]}`;

                const row = document.createElement('div');
                row.className  = `roster-change-row${s.state === 'CONFLICT' ? ' roster-change-conflict' : ''}`;
                row.dataset.key = key;

                if (s.state === 'DIFF') {
                    const approved = s.chosen !== false;
                    if (!approved) row.classList.add('is-skipped');
                    row.innerHTML = `
                        <button type="button" class="roster-tick${approved ? '' : ' off'}" data-key="${esc(key)}" aria-pressed="${approved}" aria-label="Save this change">${approved ? '✓' : ''}</button>
                        <div class="roster-chg-day">
                            <span class="roster-day-abbr">${dayName}</span>
                            <span class="roster-day-date">${dateStr}</span>
                        </div>
                        <div class="roster-chg-vals">
                            <span class="roster-from-val">${shiftDisplay(s.baseShift)}</span>
                            <span class="roster-arrow">→</span>
                            <span class="roster-to-val">${shiftDisplay(s.displayShift ?? s.parsedShift, date)}</span>
                        </div>
                        <span class="roster-act act-update">Update</span>`;
                } else if (s.state === 'REMOVE_IMPORT') {
                    // A stale previous PDF import whose day now matches the base roster. Approving
                    // DELETES the stale override (writes nothing) so it can't mask a future base change.
                    // from = the currently-saved import value, to = the base it now matches.
                    const approved = s.chosen !== false;
                    if (!approved) row.classList.add('is-skipped');
                    row.innerHTML = `
                        <button type="button" class="roster-tick${approved ? '' : ' off'}" data-key="${esc(key)}" aria-pressed="${approved}" aria-label="Clear this old entry">${approved ? '✓' : ''}</button>
                        <div class="roster-chg-day">
                            <span class="roster-day-abbr">${dayName}</span>
                            <span class="roster-day-date">${dateStr}</span>
                        </div>
                        <div class="roster-chg-vals">
                            <span class="roster-from-val">${manualShiftDisplay(s)}</span>
                            <span class="roster-arrow">→</span>
                            <span class="roster-to-val">${shiftDisplay(s.baseShift, date)}</span>
                            <span class="roster-remove-note">no longer on the roster</span>
                        </div>
                        <span class="roster-act act-clear">Clear old</span>`;
                } else if (s.state === 'UNREADABLE' && s.options) {
                    // The two reads disagreed and we know BOTH readings — offer them rather than a
                    // dead end (owner, Jul 2026: "there is no way to choose the correct option from
                    // the results screen"). Same control as a CONFLICT row, with one difference that
                    // matters: there is no safe default here, so it starts on NEITHER. `chosen` stays
                    // null until the admin picks, and null still writes nothing — the pre-v19.32
                    // behaviour is exactly what you get by leaving it alone.
                    const picked = typeof s.chosen === 'number' ? s.chosen : -1;
                    if (picked < 0) row.classList.add('roster-change-unreadable');
                    row.innerHTML = `
                        <div class="roster-choicebox">
                            <div class="roster-cb-day">
                                <div class="roster-chg-day">
                                    <span class="roster-day-abbr">${dayName}</span>
                                    <span class="roster-day-date">${dateStr}</span>
                                </div>
                                <span class="roster-act act-choice">${picked < 0 && s.chosen !== 'entered' ? "Couldn't read" : 'Your choice'}</span>
                            </div>
                            ${s.isManual && s.manualValue ? `<div class="roster-cb-opt">
                                <span class="roster-cb-lab">Saved</span>
                                <span class="roster-cv-manual">${manualShiftDisplay(s)}</span>
                            </div>` : ''}
                            <div class="roster-pick" role="group" aria-label="Choose the correct value">
                                ${s.options.map(/** @param {any} o @param {number} i */ (o, i) => `<button type="button" class="roster-choice-btn ${picked === i ? 'is-chosen' : ''}" data-key="${esc(key)}" data-opt="${i}" aria-pressed="${picked === i}">${shiftDisplay(o.display, date)}</button>`).join('')}
                                <button type="button" class="roster-choice-btn roster-choice-btn--skip ${picked < 0 && s.chosen !== 'entered' ? 'is-chosen' : ''}" data-key="${esc(key)}" data-opt="skip" aria-pressed="${picked < 0 && s.chosen !== 'entered'}">Skip</button>
                                <button type="button" class="roster-choice-btn roster-choice-btn--enter ${s.chosen === 'entered' ? 'is-chosen' : ''}${s.draft?.open ? ' is-open' : ''}" data-key="${esc(key)}" data-opt="enter" aria-pressed="${s.chosen === 'entered'}">Neither — enter it</button>
                            </div>
                            ${s.draft?.open ? entryControlHtml(key, s, date) : ''}
                        </div>`;
                } else if (s.state === 'UNREADABLE') {
                    // Skip-only: the PDF cell couldn't be parsed. No tick and no write — just surfaces
                    // the unreadable value so it isn't silently lost. The admin fixes the PDF and
                    // re-uploads, or records the shift via Change a Shift.
                    row.classList.add('roster-change-unreadable', 'roster-change-row--stacked');
                    // The head keeps the ordinary day/value pairing side by side; the ROW becomes a
                    // column so the entry control sits underneath at full width. Without the wrapper
                    // the row's own flex made the pills a ~90px vertical column (measured — the
                    // layout reads fine in the source, which is why this needed a screenshot).
                    row.innerHTML = `
                        <div class="roster-unread-head">
                            <div class="roster-chg-day">
                                <span class="roster-day-abbr">${dayName}</span>
                                <span class="roster-day-date">${dateStr}</span>
                            </div>
                            <span class="roster-act ${s.chosen === 'entered' && s.entered ? 'act-choice' : 'act-read'}">${s.chosen === 'entered' && s.entered ? 'Your entry' : "Couldn't read"}</span>
                            <div class="roster-chg-vals">
                                ${shiftDisplay(s.parsedShift)}
                                <span class="roster-remove-note">${s.chosen === 'entered' && s.entered
                                    ? '\u2713 you entered the shift below'
                                    : 'check the paper roster, or enter it below'}</span>
                            </div>
                        </div>
                        <button type="button" class="roster-choice-btn roster-choice-btn--enter ${s.chosen === 'entered' ? 'is-chosen' : ''}${s.draft?.open ? ' is-open' : ''}" data-key="${esc(key)}" data-opt="enter" aria-pressed="${s.chosen === 'entered'}">${s.chosen === 'entered' && s.entered ? 'Entered — change it' : 'Enter the shift'}</button>
                        ${s.draft?.open ? entryControlHtml(key, s, date) : ''}`;
                } else {
                    // CONFLICT — you already recorded something that differs from the new roster.
                    // Defaults to keeping yours (chosen='manual', writes nothing); "Use new roster"
                    // switches to chosen='pdf'. Plain labels replace the old Manual/PDF jargon; the
                    // data-pick values are unchanged so the save path is identical.
                    const usesPDF = s.chosen === 'pdf';
                    row.innerHTML = `
                        <div class="roster-choicebox">
                            <div class="roster-cb-day">
                                <div class="roster-chg-day">
                                    <span class="roster-day-abbr">${dayName}</span>
                                    <span class="roster-day-date">${dateStr}</span>
                                </div>
                                <span class="roster-act act-choice">Your choice</span>
                            </div>
                            <div class="roster-cb-opt">
                                <span class="roster-cb-lab">Saved</span>
                                <span class="roster-cv-manual${usesPDF ? ' cv-dim' : ''}">${manualShiftDisplay(s)}</span>
                            </div>
                            <div class="roster-cb-opt">
                                <span class="roster-cb-lab">New roster</span>
                                <span class="roster-cv-pdf${usesPDF ? '' : ' cv-dim'}">${shiftDisplay(s.displayShift ?? s.parsedShift, date)}</span>
                            </div>
                            <div class="roster-pick" role="group" aria-label="Resolve conflict">
                                <button type="button" class="roster-choice-btn ${!usesPDF ? 'is-chosen' : ''}" data-key="${esc(key)}" data-pick="manual" aria-pressed="${!usesPDF}">Keep saved</button>
                                <button type="button" class="roster-choice-btn ${usesPDF ? 'is-chosen' : ''}" data-key="${esc(key)}" data-pick="pdf" aria-pressed="${usesPDF}">Use new roster</button>
                            </div>
                        </div>`;
                }
                section.appendChild(row);
            }

            changeList.appendChild(section);
            sectionsShown++;
        }

        // ---- Event delegation (replace old listener to avoid accumulation) ----
        const newList = /** @type {any} */ (changeList.cloneNode(true));
        /** @type {any} */ (changeList.parentNode).replaceChild(newList, changeList);
        changeList = newList;

        changeList.addEventListener('click', /** @param {any} e */ e => {
            const target = /** @type {Element} */ (e.target);
            // Save / skip toggle on a change row's tick (DIFF + REMOVE_IMPORT)
            const tickBtn = /** @type {HTMLElement|null} */ (target.closest('.roster-tick'));
            if (tickBtn) {
                const s = cellStates.get(tickBtn.dataset.key ?? '');
                if (!s) return;
                // A refused read has NO per-row override (v22.16) — a live tick is exactly the
                // escape hatch the breaker exists to close.
                if (s.rosterBlocked) return;
                s.chosen = !s.chosen;
                const approved = s.chosen !== false;
                tickBtn.classList.toggle('off', !approved);
                tickBtn.setAttribute('aria-pressed', String(approved));
                tickBtn.textContent = approved ? '✓' : '';
                /** @type {any} */ (tickBtn.closest('.roster-change-row')).classList.toggle('is-skipped', !approved);
                refreshOutcome();
                return;
            }

            // A refused read has no per-row anything: conflict choices and Skip-all are as inert as
            // the ticks. Placed here rather than in each branch so a control added later inherits it.
            if (target.closest('.roster-blocked')) return;

            // Skip all / Restore for a person — applies to DIFF/REMOVE and CONFLICT rows alike
            const skipAllBtn = /** @type {HTMLElement|null} */ (target.closest('.roster-skip-all-btn'));
            if (skipAllBtn) {
                const memberName = skipAllBtn.dataset.member ?? '';
                const sec = changeList.querySelector(`.roster-person-section[data-member="${CSS.escape(memberName)}"]`);
                if (!sec) return;
                const nowSkipped = !sec.classList.contains('section-skipped');
                sec.classList.toggle('section-skipped', nowSkipped);
                skipAllBtn.textContent = nowSkipped ? 'Restore' : 'Skip all';
                skipAllBtn.setAttribute('aria-pressed', String(nowSkipped));
                sec.querySelectorAll('.roster-change-row').forEach(/** @param {any} rowEl */ rowEl => {
                    const rowHtml = /** @type {HTMLElement} */ (rowEl);
                    const s = cellStates.get(rowHtml.dataset.key ?? '');
                    if (!s) return;
                    // inert removes the row's controls from the tab order while skipped,
                    // so they aren't keyboard-focusable behind the dimmed overlay.
                    rowHtml.inert = nowSkipped;
                    if (s.state === 'DIFF' || s.state === 'REMOVE_IMPORT') {
                        s.chosen = !nowSkipped;
                        const tick = rowEl.querySelector('.roster-tick');
                        if (tick) {
                            tick.classList.toggle('off', nowSkipped);
                            tick.setAttribute('aria-pressed', String(!nowSkipped));
                            tick.textContent = nowSkipped ? '' : '✓';
                        }
                        rowEl.classList.toggle('is-skipped', nowSkipped);
                    } else if (s.state === 'CONFLICT') {
                        // Skipping cancels any "use new roster" choice (keep yours = nothing written).
                        s.chosen = 'manual';
                        rowEl.querySelectorAll('.roster-choice-btn').forEach(/** @param {any} b */ b => {
                            const bHtml = /** @type {HTMLElement} */ (b);
                            const on = bHtml.dataset.pick === 'manual';
                            b.classList.toggle('is-chosen', on);
                            b.setAttribute('aria-pressed', String(on));
                        });
                        const mPill = rowEl.querySelector('.roster-cv-manual');
                        const pPill = rowEl.querySelector('.roster-cv-pdf');
                        if (mPill) mPill.classList.remove('cv-dim');
                        if (pPill) pPill.classList.add('cv-dim');
                    } else if (s.state === 'UNREADABLE' && s.options) {
                        // SKIP ALL MUST SKIP THE ROW THE ADMIN WAS LEAST SURE ABOUT (v21.94).
                        //
                        // This branch did not exist. UNREADABLE gained a writable `chosen` at
                        // v19.32 (the two-way pick); Skip all predates it and was never extended —
                        // so an admin who picked a reading and then pressed Skip all got a dimmed,
                        // `inert` section whose picked value was still WRITTEN by Save, with the
                        // chosen button keeping its highlight under the overlay.
                        //
                        // `null` is the state's own "writes nothing" value, which is what an
                        // untouched row already holds. Restoring (un-skipping) deliberately does
                        // NOT re-pick: there is no safe default here, which is the whole reason
                        // the row starts on neither.
                        if (nowSkipped) {
                            s.chosen = null;
                            rowEl.querySelectorAll('.roster-choice-btn').forEach(/** @param {any} b */ b => {
                                const on = /** @type {HTMLElement} */ (b).dataset.opt === 'skip';
                                b.classList.toggle('is-chosen', on);
                                b.setAttribute('aria-pressed', String(on));
                            });
                            rowEl.classList.add('roster-change-unreadable');
                            const act = rowEl.querySelector('.act-choice');
                            if (act) act.textContent = "Couldn't read";
                        }
                    }
                });
                refreshOutcome();
                return;
            }

            // ---- The in-place entry for an unreadable cell (v22.17) ----
            // Every change here re-renders the whole table rather than patching the row in place.
            // The row's shape depends on the pill (times appear only for Shift/RDW), so a patch
            // would have to rebuild it anyway — and the draft lives on the state, so a full render
            // cannot lose a half-typed time the way reading values back off the DOM could.
            const entryPill = /** @type {HTMLElement|null} */ (target.closest('.roster-entry-pill'));
            if (entryPill) {
                const s = cellStates.get(entryPill.dataset.key ?? '');
                if (!s) return;
                const t = entryPill.dataset.entryType ?? '';
                s.draft = { ...s.draft, open: true, type: s.draft?.type === t ? null : t };
                commitEntry(s);
                renderReviewTable(parsedResult, cellStates);
                return;
            }

            // Keep yours / Use new roster choice on CONFLICT rows
            const choiceBtn = /** @type {HTMLElement|null} */ (target.closest('.roster-choice-btn'));
            if (choiceBtn) {
                const s = cellStates.get(choiceBtn.dataset.key ?? '');
                if (!s) return;

                // UNREADABLE rows use the same control with `data-opt` (an index, or 'skip') rather
                // than `data-pick` — a picked reading, or back to writing nothing.
                if (choiceBtn.dataset.opt !== undefined) {
                    const raw = choiceBtn.dataset.opt;
                    if (raw === 'enter') {
                        // Toggling the editor SHUT does not discard the entry — a re-render would
                        // then wipe a value the admin had already committed, which is the one thing
                        // a disclosure must never do. Only Skip un-chooses.
                        s.draft = { ...(s.draft || { type: null, from: '', to: '' }), open: !s.draft?.open };
                        renderReviewTable(parsedResult, cellStates);
                        return;
                    }
                    s.chosen = raw === 'skip' ? null : Number(raw);
                    if (raw === 'skip') { s.entered = null; s.draft = { type: null, from: '', to: '', open: false }; }
                    const box = /** @type {any} */ (choiceBtn.closest('.roster-pick'));
                    box.querySelectorAll('.roster-choice-btn').forEach(/** @param {any} b */ b => {
                        const on = b.dataset.opt === raw;
                        b.classList.toggle('is-chosen', on);
                        b.setAttribute('aria-pressed', String(on));
                    });
                    const rowEl = /** @type {any} */ (choiceBtn.closest('.roster-change-row'));
                    rowEl.classList.toggle('roster-change-unreadable', s.chosen === null);
                    const act = rowEl.querySelector('.act-choice');
                    if (act) act.textContent = s.chosen === null ? "Couldn't read" : 'Your choice';
                    refreshOutcome();
                    return;
                }

                s.chosen = choiceBtn.dataset.pick;
                const usesPDF = s.chosen === 'pdf';
                /** @type {any} */ (choiceBtn.closest('.roster-pick')).querySelectorAll('.roster-choice-btn').forEach(/** @param {any} b */ b => {
                    const bHtml = /** @type {HTMLElement} */ (b);
                    const on = bHtml.dataset.pick === s.chosen;
                    b.classList.toggle('is-chosen', on);
                    b.setAttribute('aria-pressed', String(on));
                });
                // Dim the value that will NOT be written.
                const row    = /** @type {any} */ (choiceBtn.closest('.roster-change-row'));
                const mPill  = row.querySelector('.roster-cv-manual');
                const pPill  = row.querySelector('.roster-cv-pdf');
                if (mPill) mPill.classList.toggle('cv-dim', usesPDF);
                if (pPill) pPill.classList.toggle('cv-dim', !usesPDF);
                refreshOutcome();
            }
        });

        // A time box changes the draft on every keystroke, not on blur: an admin who types a time
        // and presses Save without leaving the field would otherwise save nothing, with the value
        // visibly on screen. `input` also fires for the native picker.
        changeList.addEventListener('input', /** @param {any} e */ e => {
            const el = /** @type {HTMLInputElement} */ (e.target);
            if (!el.classList?.contains('roster-entry-time')) return;
            const s = cellStates.get(el.dataset.key ?? '');
            if (!s) return;
            s.draft = { ...s.draft, [el.dataset.part === 'to' ? 'to' : 'from']: el.value };
            commitEntry(s);
            // PATCH THE ROW, do not re-render it. A full render on every keystroke would destroy the
            // input the admin is typing into. But leaving the row alone was worse than it looked:
            // the head still read "Not saved · couldn't read — check the paper roster" while the
            // summary above had already counted the entry, so the screen contradicted itself.
            patchEntryRow(el.closest('.roster-change-row'), s.chosen === 'entered' && !!s.entered);
            refreshOutcome();
        });

        // ---- Empty state ----
        if (sectionsShown === 0) {
            changeList.innerHTML = `<div class="roster-no-changes"><span aria-hidden="true">✓</span> The roster matches what's already saved — no changes needed.</div>`;
        }
        refreshOutcome();   // fills the outcome summary + sets the Save button label/disabled state

        // ---- Week-ending heading (the counts now live in the outcome summary above the list) ----
        const weekEndDate = parseISODate(weekEnding);
        const formatted   = weekEndDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
        reviewLabel.textContent = `Week ending ${formatted}`;

        reviewSection.classList.add('visible');
        applyFeedback.textContent = '';
        applyFeedback.className   = 'huddle-feedback';

        // Move focus to the summary so screen-reader users are told the review is
        // ready after the ~15s parse, and the section scrolls into view.
        reviewLabel.tabIndex = -1;
        reviewLabel.focus();
    }

    // Card collapse is wired centrally in operations-app.js via initCardCollapse.
}

