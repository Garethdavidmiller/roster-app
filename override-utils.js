// @ts-check
// Override priority, member-start, and shift-classification helpers.
// Shared by calendar-app.js, calendar-team-view.js, and the admin modules.
// Pure: no DOM, no Firestore. The Other-day grammar and `isRestShift` live in other-day.js and are
// re-exported here, so every importer reads them from this module.

import { isClockTime } from './clock-input.js';   // the entry control's boxes are text
import { isValidLeaveYear } from './leave-year.js';   // which year's allowance a January leave day is
import { isRestShift, OTHER_FLAVOURS, isOtherValue, parseOtherValue } from './other-day.js';
export { nextLeaveYear } from './leave-year.js';      // beside its sibling `nextReplacedType`: what a rewrite carries
export {
    isRestShift, OTHER_FLAVOURS, OTHER_RDW_DEFAULT_MINS, isOtherValue, parseOtherValue, composeOtherValue, resolveOtherPay,
} from './other-day.js';

/**
 * The override types that put CONTRACTED work on a day, as opposed to work the member volunteered for.
 *
 * `rdw` IS DELIBERATELY ABSENT. `WORKED_OVERRIDE_TYPES` (admin-shift-types.js) asks "is somebody at
 * work that day?", where `rdw` and `shift` are the same. For ANNUAL LEAVE they are opposites: `shift`
 * on a base rest day is a SWAP (leave there spends a day of entitlement); `rdw` there is VOLUNTARY
 * OVERTIME (declining it is not leave). Reusing that set would charge leave for declining overtime.
 * The retired type names split the same way — see `LEGACY_OVERRIDE_TYPES`.
 */
/** Retired override types: no record is of these TYPES since the 4 Nov 2026 conversion (DATA_MODEL.md). THE NAMES
 *  SURVIVE AS A HISTORIC `replacedType` on leave and absences recorded over those days, and decide whether that leave
 *  cost a day (`contractEvidence`), so the sets below still classify them and firestore.rules still accepts them.
 *  Dropping them would quietly move leave balances. override-utils.test.mjs holds both sets and the rules' list to
 *  this declaration. */
export const LEGACY_OVERRIDE_TYPES = Object.freeze(['allocated', 'overtime', 'swap']);

export const CONTRACTED_WORK_TYPES = new Set([
    'shift', 'spare_shift', 'other',  // the last two only on a ROSTERED day — isContractedWorkOverride
    'allocated', 'swap',              // retired — a historic `replacedType` only; contracted, like `shift`
]);

/** Work a member VOLUNTEERED for. Declining it is not leave. (`overtime` is the retired `rdw` — above.)
 *  Owner, 26 Aug 2026 (VAL-AL-001): leave reaches a rest day only over a SWAP. This branch is kept because
 *  falling through to the base roster would charge a day for declining overtime. */
export const VOLUNTARY_WORK_TYPES = new Set(['rdw', 'overtime']);

/**
 * Was the member CONTRACTED to work the day this override describes?
 *
 * Answers from the override, so it is the one place the swap-vs-overtime distinction lives.
 * A rest-valued override (`correction`/RD — the other half of a swap) is not work whatever its
 * type, which is checked first because it is the stronger statement.
 *
 * AN OTHER DAY OR A SPARE TURN ON A BASE REST DAY IS NOT CONTRACTED (owner, 10 Nov 2026: "Free, like plain
 * RDW"): there it is rest-day working (composeOtherValue forces the marker), so leave over it is free, as
 * over `rdw`. Only its TYPE survives leave, so the base roster is the witness: the leave paths pass it.
 *
 * @param {{type?:string, value?:string}|null|undefined} ov
 * @param {string} [baseShift] the day's base shift; without one (display suppression, `contractEvidence`,
 *        the swap question in al-swapped-days.js) both count. The leave paths and the roster review pass it
 * @returns {boolean|null} true/false, or null when `ov` carries no usable information — the caller
 *          must then fall back to the base roster rather than treat "unknown" as "no".
 */
export function isContractedWorkOverride(ov, baseShift) {
    if (!ov || !ov.type) return null;
    if (isRestShift(ov.value || '')) return false;          // a rest VALUE is not work whatever its type
    // A `correction` is classifiable by TYPE ALONE: its value is pinned to 'RD', and is absent when
    // reconstructed from a `replacedType` — reading a value there would charge a swapped-OUT day's AL.
    if (ov.type === 'correction') return false;
    if (CONTRACTED_WORK_TYPES.has(ov.type)) return !((ov.type === 'other' || ov.type === 'spare_shift') && isRestShift(baseShift ?? ''));
    if (VOLUNTARY_WORK_TYPES.has(ov.type)) return false;
    // `sick`, `annual_leave` and anything unrecognised describe an ABSENCE, not a contract, so they
    // answer "unknown" and the base roster decides. Returning false would make leave over an absence on
    // a working day silently stop costing a day.
    return null;
}

/**
 * The override whose TYPE answers "was the member contracted to work this day?", given the one on it.
 *
 * Annual leave and an absence say nothing about the contract, so what they REPLACED — carried in
 * `replacedType` — is the evidence; any other override is its own. This is the unwrapping
 * `nextReplacedType` does when it WRITES, so readers and writer agree.
 * @param {{type?:string, value?:string, replacedType?:string|null}|null|undefined} ov
 * @returns {{type?:string, value?:string}|null} pass to `isContractedWorkOverride`
 */
export function contractEvidence(ov) {
    if (!ov || !ov.type) return null;
    if (ov.type === 'annual_leave') return ov.replacedType ? { type: ov.replacedType } : null;
    if (ov.replacedType && isContractedWorkOverride({ type: ov.type }) === null) return { type: ov.replacedType };
    return ov;
}

/**
 * Display-suppression rule (CLAUDE.md "Sundays are non-contracted", layer 5) — SINGLE SOURCE for the
 * calendar renderer, Team Week View, and month legend so they can never disagree. True when an
 * override must NOT replace the base shift on the calendar: a `sick` override on a rest-day base
 * (unless it replaced contracted work — a swapped-in day) OR any Sunday, and `annual_leave` / Other-family
 * (`other`) on any Sunday. A Sunday AL/Absent is legacy or hand-written data — every write path refuses
 * it. An absence on a rest-day base is not refused (the week grid and the Absence card can record one)
 * but is hidden all the same (`absenceHiddenDates`, al-swapped-days.js). `rdw`, `correction` and plain
 * `shift` are never suppressed; `spare_shift` and `other` only on 25 or 26 December, in any year: the two
 * days cannot be spare days (owner, 19 Nov 2026), so a legacy record there shows the day as it would be
 * without it (owner, 20 Nov 2026: "Fix").
 * Takes `sunday` and `christmasDay` as booleans (not the date) so this module needs no roster-data
 * import — that would be a cycle. Both are REQUIRED, so a caller that leaves one out fails the typecheck.
 * @param {{type: string, replacedType?: string|null}} override
 * @param {string} baseShift  the member's base roster shift for that date
 * @param {boolean} sunday    whether the date is a Sunday
 * @param {boolean} christmasDay  whether the date is 25 or 26 December (`isChristmasOrBoxingDay`)
 * @returns {boolean} true → ignore the override, keep the base shift
 */
export function isOverrideDisplaySuppressed(override, baseShift, sunday, christmasDay) {
    switch (override.type) {
        // A rest-day base hides an absence UNLESS it replaced contracted work — a swapped-in day,
        // whose only record is `replacedType`.
        case 'sick':         return sunday || (isRestShift(baseShift)
            && isContractedWorkOverride(override.replacedType ? { type: override.replacedType } : null) !== true);
        case 'annual_leave': return sunday;
        // An Other day on 25 or 26 December too (owner, 24 Nov 2026: "yes"), exactly as a Spare there.
        case 'other':        return sunday || christmasDay === true;
        case 'spare_shift':  return christmasDay === true;
        default:             return false;
    }
}

/**
 * Is `dateStr` 25 or 26 December, in ANY year? The display rule's `christmasDay` input — any year,
 * unlike Christmas leave (`isChristmasClosureDate`, from 2026), because the no-Spare rule is one Save
 * enforces in any year too (`checkDayRules`). Pure string test, so this module needs no date import.
 * @param {string} dateStr  "YYYY-MM-DD"
 * @returns {boolean}
 */
export function isChristmasOrBoxingDay(dateStr) {
    return /^\d{4}-12-2[56]$/.test(String(dateStr ?? ''));
}

/**
 * Group a sorted, Sunday-excluded list of AL/absence dates into contiguous "periods" for the admin
 * booked-dates boxes, merging two dates into ONE period when every calendar day BETWEEN them is a
 * "rest gap" (a Sunday or a base rest day) — so e.g. a Fri + the following Mon reads as one period
 * across the weekend. Pure: the day-of-week / base-roster knowledge stays with the caller, which
 * supplies `isRestGap(dateStr)` and `addDay(dateStr)`.
 * @param {string[]} dateList  sorted ascending "YYYY-MM-DD", already Sunday-filtered
 * @param {(dateStr: string) => boolean} isRestGap  true if the date is a skippable rest gap
 * @param {(dateStr: string) => string} addDay      the next calendar day after `dateStr`
 * @returns {{ start: string, end: string, count: number }[]}
 */
export function mergeBookedPeriods(dateList, isRestGap, addDay) {
    if (!dateList.length) return [];
    const periods = [];
    let periodStart = dateList[0];
    let periodEnd   = dateList[0];
    let count       = 1;
    for (let i = 1; i < dateList.length; i++) {
        const prev = dateList[i - 1];
        const curr = dateList[i];
        let gapAllRest = true;
        let cursor = addDay(prev);
        while (cursor < curr) {
            if (!isRestGap(cursor)) { gapAllRest = false; break; }
            cursor = addDay(cursor);
        }
        if (gapAllRest) {
            periodEnd = curr;
            count++;
        } else {
            periods.push({ start: periodStart, end: periodEnd, count });
            periodStart = curr;
            periodEnd   = curr;
            count       = 1;
        }
    }
    periods.push({ start: periodStart, end: periodEnd, count });
    return periods;
}

/**
 * Converts a Firestore Timestamp or plain {seconds} object to milliseconds.
 * Returns 0 for null/undefined or unrecognised shapes.
 * @param {any} ts
 * @returns {number}
 */
export function tsToMillis(ts) {
    if (!ts) return 0;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
    // Plain JS Date: cache-inserted docs carry `createdAt: new Date()`, and 0 here would rank a
    // JUST-SAVED override below a stale same-source duplicate with a real Firestore timestamp.
    if (ts instanceof Date) return ts.getTime();
    return 0;
}

/**
 * Returns true if `date` falls before the member's contracted start date.
 * Overrides should be suppressed before a member's start date — getBaseShift
 * already returns 'RD' for those dates; allowing an override would undo that.
 * Returns false if the member has no startDate.
 * Always call this helper — never inline the date comparison at a call site.
 * @param {any} member
 * @param {Date} date
 * @returns {boolean}
 */
export function isBeforeMemberStart(member, date) {
    if (!member.startDate) return false;
    const s = member.startDate;
    return date < new Date(s.getFullYear(), s.getMonth(), s.getDate());
}

/**
 * Normalise a raw Firestore override document into the cache record shape that the display
 * layer + `shouldReplaceOverride` consume. Single source for every write into `rosterOverridesCache`
 * — divergent defaults would produce precedence bugs, since shouldReplaceOverride keys off
 * source/createdAt. There is exactly ONE writer, calendar-overrides.js — do not add a second: its reads
 * clear the month legend's memo where they write, and a second authoritative reconciler racing them is
 * the Team View eviction bug (CALENDAR_DATA.md invariant 6).
 * @param {any} data - a Firestore override doc's `.data()`
 * @returns {{ value: any, note: string, type: string, source: any, createdAt: any, changedBy?: string }}
 */
export function toOverrideRecord(data) {
    return {
        value:     data.value,
        note:      data.note      || '',
        type:      data.type      || '',
        source:    data.source    || null,
        createdAt: data.createdAt || null,
        // The SAME shape as the admin cache: two mirrors of different shapes is how a consumer silently
        // misses a field. The day panel reads `changedBy` and `leaveYear` here.
        ...(data.replacedType ? { replacedType: data.replacedType } : {}),
        ...(data.changedBy ? { changedBy: data.changedBy } : {}),
        // Which year's allowance a January leave day comes out of, when it is the year before (leave-year.js).
        ...(Number.isInteger(data.leaveYear) ? { leaveYear: data.leaveYear } : {}),
    };
}

/**
 * Collect validated override records from a Firestore range-query snapshot, ready for
 * `reconcileRangeIntoCache`. The SINGLE source for the required-field validation. Malformed docs
 * (missing memberName/date/value) are skipped; only the doc **id** is logged — never the doc body,
 * which can carry a member name / free-text note.
 * @param {{ forEach: (cb: (doc: any) => void) => void }} snapshot - a Firestore QuerySnapshot
 * @returns {Array<{ memberName: string, date: string, record: ReturnType<typeof toOverrideRecord> }>}
 */
export function collectOverrideRecords(snapshot) {
    /** @type {Array<{ memberName: string, date: string, record: any }>} */
    const records = [];
    snapshot.forEach((/** @type {any} */ doc) => {
        const data = doc.data();
        if (!data.memberName || !data.date || !data.value) {
            console.error('[Firestore] Skipping malformed override document:', doc.id);
            return;
        }
        records.push({ memberName: data.memberName, date: data.date, record: toOverrideRecord(data) });
    });
    return records;
}

/**
 * Assemble an override's Firestore WRITE document — the SINGLE source for the exact field set the
 * Firestore rules require, for every save path (a field hand-built on one path is a silent
 * `permission-denied` on that path alone). `createdAt` is INJECTED (the caller passes
 * `serverTimestamp()`) so this module stays Firebase-free. Extra fields on `f` are dropped.
 *
 * `note` IS WRITE-ONLY AND ALWAYS '': nothing offers or displays it — free text about a named colleague
 * is a GDPR exposure — but `firestore.rules` requires `note is string`, so dropping it here alone would
 * permission-deny every write. Retiring it is three backend-first pushes, in this order only: (1) rules
 * drop `is string`/`size()`, keeping `note` in `hasOnly`; (2) the client stops writing it; (3) rules drop
 * it from `hasOnly` (docs/DATA_MODEL.md → overrides).
 *
 * `uploadId` comes ONLY from the third argument, never from `f`: the leave sheet Save's Undo trusts a
 * record carrying it as that Save's own write, which holds only while every other save drops it. Sent
 * unchecked: a bad id is the Save's fault, and dropping it would lose the Undo.
 * @param {{memberName:string, date:string, type:string, value:any, note?:string, source:string, changedBy:string, replacedType?:string|null, leaveYear?:number|null}} f
 * @param {*} createdAt  a Firestore serverTimestamp() sentinel for the write
 * @param {{ uploadId?: string|null }} [opts]  `uploadId`: the leave sheet Save's log id, from that Save alone
 * @returns {{memberName:string, date:string, type:string, value:any, note:string, source:string, createdAt:*, changedBy:string, uploadId?:string}}
 */
export function buildOverrideWrite(f, createdAt, { uploadId = null } = {}) {
    return {
        memberName: f.memberName,
        date:       f.date,
        type:       f.type,
        value:      f.value,
        note:       f.note ?? '',
        source:     f.source,
        // Only when there IS one — the Firestore rules use hasOnly + `is string`, so writing the
        // key as null would be rejected outright rather than treated as absent.
        ...(f.replacedType ? { replacedType: f.replacedType } : {}),
        // Only one the rules accept (January leave, the year before) — anything else would refuse the write.
        ...(isValidLeaveYear(f.date, f.leaveYear) && f.type === 'annual_leave' ? { leaveYear: f.leaveYear } : {}),
        createdAt,
        changedBy:  f.changedBy,
        ...(uploadId ? { uploadId } : {}),
    };
}

/**
 * Assemble the OPTIMISTIC in-memory cache record for a just-written override (the admin `_allOverrides`
 * mirror that avoids a Firestore round-trip). Same field set as the write MINUS `changedBy`, PLUS the
 * new doc `id`, and a real `Date` for `createdAt` (so `tsToMillis` ranks a just-saved override
 * correctly). Single source so no write path can drift its mirror.
 * @param {string} id  the new Firestore doc id
 * @param {{memberName:string, date:string, type:string, value:any, note?:string, source:string, replacedType?:string|null, leaveYear?:number|null}} f
 * @param {Date} createdAt  `new Date()` — the optimistic local timestamp
 * @returns {{id:string, memberName:string, date:string, type:string, value:any, note:string, source:string, createdAt:Date}}
 */
export function buildOverrideCacheRecord(id, f, createdAt) {
    return {
        id,
        memberName: f.memberName,
        date:       f.date,
        type:       f.type,
        value:      f.value,
        note:       f.note ?? '',
        source:     f.source,
        // The same tests as the write, so the mirror can never hold a choice the server refused.
        ...(f.replacedType ? { replacedType: f.replacedType } : {}),
        ...(isValidLeaveYear(f.date, f.leaveYear) && f.type === 'annual_leave' ? { leaveYear: f.leaveYear } : {}),
        createdAt,
    };
}

/**
 * What `replacedType` a new override should carry, given the one it is about to delete.
 *
 * STORED, NOT DERIVED: a write is `batch.delete(existing)` then `batch.set(new)`, so recording leave
 * DESTROYS the override that said what the day was. For a swapped-in day (a `shift` on a base rest
 * day) that doc was the only record of the contract; without it `consumesEntitlement` sees a rest day
 * and the leave goes free. It is a FACT being preserved.
 *
 * THE INHERIT RULE: re-saving a booking replaces an AL doc with another AL doc. Recording
 * `annual_leave` as what it replaced would erase the original on the second save. Same type in, same
 * type out ⇒ carry the original forward.
 *
 * @param {{type?:string, replacedType?:string|null}|null|undefined} existing the doc being deleted
 * @param {string} newType the type being written
 * @returns {string|null}
 */
export function nextReplacedType(existing, newType) {
    if (!existing || !existing.type) return null;
    if (existing.type === newType) return existing.replacedType || null;
    // CHAIN THROUGH AN ABSENCE (swap → sick → AL): recording `sick` would discard the `shift`
    // underneath and the leave would go free. An absence carries no contract information, so what IT
    // replaced is kept; an informative type (`shift`, `rdw`, `correction`…) IS the fact and still wins.
    if (existing.replacedType && isContractedWorkOverride({ type: existing.type }) === null) {
        return existing.replacedType;
    }
    return existing.type;
}

/**
 * Returns true if `incoming` should replace `existing` in the override cache.
 *
 * Priority rules (highest first):
 *   1. Manual overrides (source !== 'roster_import') always beat roster_import.
 *   2. Among entries of equal source-class, the newer createdAt wins.
 *
 * This ensures a human-entered correction survives a roster re-upload, and
 * that if two imports exist for the same date the most recent one is used.
 *
 * @param {any} existing
 * @param {any} incoming
 * @returns {boolean}
 */
export function shouldReplaceOverride(existing, incoming) {
    if (!existing) return true;
    const existingIsImport = (existing.source || '') === 'roster_import';
    const incomingIsImport = (incoming.source || '') === 'roster_import';
    if (existingIsImport && !incomingIsImport) return true;   // manual beats import
    if (!existingIsImport && incomingIsImport) return false;  // import can't beat manual
    return tsToMillis(incoming.createdAt) >= tsToMillis(existing.createdAt);
}

/**
 * Ids being DELETED, widened by the MANUAL copies of the same member's day that each one OUTRANKS:
 * older duplicates from before the fixed per-day ids, which would otherwise surface the moment the
 * record above them went. Only those — deleting a stale copy must never take the one on screen with
 * it — and an exact tie goes to the larger id, one way. An import is deleted alone. Pure; shared by
 * `withManualDuplicates` (admin-override-store.js) and `periodDelete` (admin-booked-periods.js).
 * @param {any[]} rows every record the caller holds
 * @param {Iterable<string>} ids the records being deleted
 * @returns {Set<string>} `ids` and every copy they outrank
 */
export function withOutrankedManualCopies(rows, ids) {
    const manual = (/** @type {any} */ o) => (o.source || '') !== 'roster_import';
    const outranks = (/** @type {any} */ r, /** @type {any} */ o) =>
        shouldReplaceOverride(o, r) && (!shouldReplaceOverride(r, o) || String(r.id) > String(o.id));
    const out = new Set(ids);
    for (const id of [...out]) {
        const r = rows.find(o => o.id === id);
        if (!r || !manual(r)) continue;
        rows.filter(o => o.id !== r.id && o.memberName === r.memberName && o.date === r.date && manual(o) && outranks(r, o))
            .forEach(o => out.add(o.id));
    }
    return out;
}

/**
 * Reconcile a Firestore date-range snapshot into the shared override cache AUTHORITATIVELY.
 *
 * A range query for [startStr, endStr] is the single source of truth for those dates, so the winner
 * for each in-range key must be rebuilt from the SNAPSHOT RECORDS ALONE (deduped by
 * `shouldReplaceOverride`), never merged against the possibly-stale cache: a per-doc merge keeps a
 * deleted higher-priority record alive (a deleted manual override over a surviving import). Any
 * in-range key the snapshot omits is a genuine delete.
 *
 * The cache is mutated in place. Returns whether any in-range slot's DISPLAY changed (added, removed,
 * or type/value/note differs) so a caller can gate a re-render; metadata-only differences (a new
 * winner with the same visible shift) still update the cache but don't force a repaint.
 *
 * **`authoritative: false`** — merge the snapshot in but evict NOTHING. Required for a read whose
 * snapshot is not the truth for the range: a LOCAL-CACHE read (`getDocsFromCache`) returns a
 * possibly-stale SUBSET, so treating an absent key as a delete would wipe live overrides. Only a server
 * range query may evict.
 *
 * @param {Map<string, any>} cache     the shared rosterOverridesCache (mutated in place)
 * @param {Array<{ memberName: string, date: string, record: any }>} records  validated snapshot rows
 * @param {string} startStr  'YYYY-MM-DD' inclusive range start
 * @param {string} endStr    'YYYY-MM-DD' inclusive range end
 * @param {{ authoritative?: boolean }} [opts]  authoritative:false → additive merge, no eviction
 * @returns {boolean} true if any in-range cache slot's display changed
 */
export function reconcileRangeIntoCache(cache, records, startStr, endStr, opts = {}) {
    const authoritative = opts.authoritative !== false;   // default true — the server-read behaviour
    // 1. Fresh authoritative winners for this range, from the snapshot alone.
    const winners = new Map();
    for (const { memberName, date, record } of records) {
        const key = `${memberName}|${date}`;
        if (shouldReplaceOverride(winners.get(key), record)) winners.set(key, record);
    }
    let displayChanged = false;
    // 2. Evict in-range cache keys the snapshot no longer covers (deleted in Firestore).
    //    Skipped for a non-authoritative (cache) snapshot — see the note above.
    for (const key of authoritative ? [...cache.keys()] : []) {
        const dateStr = key.slice(key.indexOf('|') + 1);
        if (dateStr >= startStr && dateStr <= endStr && !winners.has(key)) {
            cache.delete(key);
            displayChanged = true;
        }
    }
    // 3. Store each fresh winner (always — so its metadata is authoritative), flagging visible changes.
    for (const [key, record] of winners) {
        const existing = cache.get(key);
        // "DISPLAY" MUST TRACK WHAT IS ACTUALLY DISPLAYED: a field a display path reads but this list
        // misses leaves the screen stale. ADD A FIELD HERE whenever a display path starts reading it.
        // `note` stays: always '', it can only cause a spurious repaint, which is free.
        const shown = ['type', 'value', 'note', 'source', 'changedBy', 'leaveYear', 'replacedType'];
        if (!existing || shown.some(f => existing[f] !== record[f])) displayChanged = true;
        cache.set(key, record);
    }
    return displayChanged;
}

/** True when a "YYYY-MM-DD" date string falls on a Sunday (UTC-safe, no timezone drift).
 * @param {string} dateStr */
function _isSundayISO(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0;
}

/** Shift a "YYYY-MM-DD" date string by ±N days, returning "YYYY-MM-DD" (UTC-safe).
 * @param {string} dateStr
 * @param {number} deltaDays */
function _shiftISODate(dateStr, deltaDays) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + deltaDays)).toISOString().slice(0, 10);
}

/**
 * Decide which override document IDs to delete when removing one AL/sick range,
 * correctly scoping the Sunday RD-correction deletes so an overlapping range's shared
 * Sunday correction is not stripped.
 *
 * A range spanning a Sunday writes the leave type on the working days and a
 * `correction`/`RD` on the Sunday (Sundays are non-contracted, so AL/sick is never
 * written on a Sunday). Two ranges — same OR different type — that overlap the same
 * worked Sunday share ONE correction doc. When deleting one range, that correction must
 * be kept if a REMAINING AL/sick override still spans the Sunday.
 *
 * "Still spans" is detected by a remaining leave override within TWO days either side of the
 * Sunday: the adjacent Saturday is often a rest day with no leave written, so ±1 day alone would
 * delete the shared correction and resurrect the worked Sunday in the MIDDLE of remaining leave.
 *
 * THE EDGE SUNDAY. The Recorded-dates list never shows a Sunday, so a booking that ENDS (or starts)
 * on one is listed short of it. The Sunday straight after `end` or before `start`, reached only
 * through rest days (`isRestGap`; without it only the adjacent Sunday counts), is treated as part of
 * the range for its correction, under the same "still spanned?" protection.
 *
 * …BUT ONLY A CORRECTION THAT BOOKING WROTE. A manager's own "Rest Day" on an edge Sunday is not the
 * booking's to delete. The proof is the timestamp: `recordRangeOverrides` commits the leave days and
 * their Sunday corrections in one batch, whose `serverTimestamp()`s resolve to one instant. An edge
 * correction whose `createdAt` equals a deleted leave day's is that booking's; any other is kept (the
 * safe direction). INTERIOR Sundays go with the period.
 *
 * @param {Array<{id:string,memberName:string,date:string,type:string,value:string,createdAt?:any}>} allOverrides
 * @param {{type:string, memberName:string, start:string, end:string,
 *          isRestGap?: (dateStr: string) => boolean}} range  type is 'annual_leave' | 'sick'; start/end
 *        inclusive YYYY-MM-DD; `isRestGap` true for a base rest day the booking could have skipped
 * @returns {string[]} override document IDs to delete
 */
export function computePeriodDeleteIds(allOverrides, { type, memberName, start, end, isRestGap = () => false }) {
    const inRange = (/** @type {any} */ o) => o.memberName === memberName && o.date >= start && o.date <= end;
    // Leave-type day overrides inside the range — always removed.
    const leaveIds = new Set(allOverrides.filter(o => inRange(o) && o.type === type).map(o => o.id));
    // Dates of AL/sick overrides (either type) that SURVIVE this delete.
    const remainingLeaveDates = new Set(
        allOverrides
            .filter(o => o.memberName === memberName &&
                (o.type === 'annual_leave' || o.type === 'sick') && !leaveIds.has(o.id))
            .map(o => o.date)
    );
    // A surviving range covers the Sunday iff it has a leave override within 2 days either side.
    // ACCEPTED TRADE-OFF: docs carry no booking identity, so this can FALSE-KEEP (an unrelated absence
    // at Sunday±2 keeps a stale RD). Biased toward keeping: the opposite error resurrects a WORKED
    // shift in the middle of someone's remaining leave, which is worse.
    const _spansSunday = (/** @type {string} */ sundayISO) =>
        [-2, -1, 1, 2].some(off => remainingLeaveDates.has(_shiftISODate(sundayISO, off)));
    /** The first Sunday stepping `dir` from `from`, if only rest days lie between. @param {string} from @param {number} dir */
    const edgeSunday = (from, dir) => {
        let d = _shiftISODate(from, dir);
        for (let i = 0; i < 6 && !_isSundayISO(d); i++, d = _shiftISODate(d, dir)) if (!isRestGap(d)) return null;
        return _isSundayISO(d) ? d : null;
    };
    const edges = new Set([edgeSunday(end, 1), edgeSunday(start, -1)].filter(Boolean));
    const bookedAt = new Set(allOverrides.filter(o => leaveIds.has(o.id)).map(o => tsToMillis(o.createdAt)).filter(Boolean));
    const sameBooking = (/** @type {any} */ o) => edges.has(o.date) && bookedAt.has(tsToMillis(o.createdAt));
    const correctionIds = allOverrides
        .filter(o => o.memberName === memberName && (inRange(o) || sameBooking(o)) &&
            o.type === 'correction' && o.value === 'RD' && _isSundayISO(o.date) &&
            !_spansSunday(o.date))
        .map(o => o.id);
    return [...leaveIds, ...correctionIds];
}

/** A worked-shift "HH:MM-HH:MM" range (the DISPLAY form — 1-or-2-digit hours, no anchoring;
 *  matches the renderer's historical inline regex, deliberately looser than roster-data's TIME_RE). */
const SHIFT_RANGE_RE = /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/;
// Worked override types whose TIMED value on a Sunday must display as RDW — see resolveEffectiveShift.
const SUNDAY_RDW_DISPLAY_TYPES = new Set(['shift']);

/**
 * Resolve a Firestore override onto a base shift into ONE canonical display descriptor.
 *
 * The single source for the "apply override onto base shift" ladder, so the calendar renderer,
 * Team Week View and month legend can never disagree. Pure; the caller passes the already-fetched
 * override and base shift (and must pass `null` for a before-member-start / absent override).
 *
 * @param {any}     override  The override for this member+date, or null/undefined.
 * @param {string}  baseShift The base shift from getBaseShift (Christmas/startDate already applied).
 * @param {boolean} sunday    isSunday(dateStr) — Sundays are non-contracted (suppression input).
 * @param {boolean} christmasDay  isChristmasOrBoxingDay(dateStr) — no Spare there (suppression input).
 * @returns {{ shift: string, rdwTime: string, derivedRdw: boolean }}
 *   shift      canonical effective shift: `baseShift` when there is no override or it is
 *              suppressed; `'RDW'` for an rdw override; the raw Other grammar value for a
 *              parseable `other`; otherwise `override.value` (AL→'AL', SICK→'SICK',
 *              correction→'RD', spare_shift→'SPARE').
 *   rdwTime    rdw override → `override.value`; parseable Other → its hours-slot string
 *              (actual time → 'RDW' → the base shift's own time → ''); '' otherwise.
 *   derivedRdw true when the day is rest-day working by DERIVATION, not an `rdw` override: a parseable
 *              Other day with the flag or a rest-day base, or a timed `shift` on a Sunday. Read for Other days.
 */
export function resolveEffectiveShift(override, baseShift, sunday, christmasDay) {
    if (!override || isOverrideDisplaySuppressed(override, baseShift, sunday, christmasDay)) {
        return { shift: baseShift, rdwTime: '', derivedRdw: false };
    }
    if (override.type === 'rdw') {
        return { shift: 'RDW', rdwTime: override.value, derivedRdw: false };
    }
    // A worked Sunday is ALWAYS Rest Day Working. A legacy `shift` doc on a Sunday must still DISPLAY
    // as 💼 RDW, matching the pay engine (any worked Sunday pays 1.5×); a non-time value falls through.
    if (sunday && SUNDAY_RDW_DISPLAY_TYPES.has(override.type) && SHIFT_RANGE_RE.test(override.value || '')) {
        return { shift: 'RDW', rdwTime: override.value, derivedRdw: true };
    }
    const parsedOther = override.type === 'other' ? parseOtherValue(override.value) : null;
    if (parsedOther) {
        const derivedRdw = parsedOther.rdw || isRestShift(baseShift);
        // Hours slot: actual times → 'RDW' (a rest-day Other) → the base shift's own time → '' (badge
        // only). `hideBaseTime` flavours (Meetings, Union) skip the base-time fallback: attend-an-event days.
        const showsBaseTime = !OTHER_FLAVOURS[parsedOther.flavour]?.hideBaseTime;
        const rdwTime = parsedOther.time ?? (derivedRdw ? 'RDW'
            : (showsBaseTime && SHIFT_RANGE_RE.test(baseShift) ? baseShift : ''));
        return { shift: override.value, rdwTime, derivedRdw };
    }
    return { shift: override.value, rdwTime: '', derivedRdw: false };
}

/**
 * THE TIME A DAY'S HOURS SLOT HOLDS — the one reading of `resolveEffectiveShift`'s answer that the
 * Calendar cell prints under its badge (`dayCellParts`) and "Who's on with me" counts (`workedTimes`,
 * team-overlap.js), so the two cannot disagree. Rest Day Working and an Other day carry it in `rdwTime`,
 * because their `shift` is a sentinel ('RDW', 'TRG', 'TRG RDW'): an Other day with no time of its own on
 * a working day carries the BASE shift's time there. Every other day is its own value. Unfiltered: it may
 * be 'RDW' (a rest-day Other with no time), '' or a non-time value — the caller decides what it shows.
 * @param {string} shift  the resolved `shift`
 * @param {string} [rdwTime]  the resolved `rdwTime`
 * @returns {string}
 */
export function hoursSlotTime(shift, rdwTime = '') {
    return (shift === 'RDW' || isOtherValue(shift)) ? (rdwTime || '') : shift;
}

// ── WHAT MAY NOT BE RECORDED ON A SUNDAY ───────────────────────────────────────────────
//
// Sundays are not contracted for any grade here, so annual leave, an absence and an "Other" day
// cannot apply to one — and a worked Sunday is always RDW (overtime), never a plain shift.
//
// Enforced at SEVERAL points on purpose (defence in depth — a failure writes leave against a day
// nobody was contracted to work), but the POLICY is declared once, here.
//
// The write paths CONSULT this declaration (`isForbiddenOnSunday`, `sundaySafeValue`) — the bulk
// apply (admin-bulk-apply.js, admin-bulk-bar.js), the leave sheet (al-leave-plan.js) and the
// roster import with its entry control (roster-cell-rules.js, roster-entry-control.js). Two keep a
// bespoke copy for a reason, and are pinned to this list by override-utils.test.mjs instead — a
// fifth forbidden type added here fails those tests rather than being silently writable:
//
//   · the week-grid PILLS (`admin-day-pills.js`) carry per-pill wording, which one shared message
//     would make vaguer.
//   · the single-row SAVE (`collectWeekRows`, admin-week-collect.js): a plain `shift` is PROMOTED to
//     `rdw`, an "Other" day is refused unless its flavour is Spare, leave and absence are refused.
//
// NOT wired to this list: `isOverrideDisplaySuppressed`, which asks what may be SHOWN, not WRITTEN —
// a legacy Sunday `shift` is still displayed, because hiding a day somebody worked is the worse error.
//
// TWO VOCABULARIES, DELIBERATELY NOT COLLAPSED: the admin surfaces reason in override TYPE ids; the
// roster import in parsed VALUES. Forcing one on the other means translating at the point of use —
// which is where a translation gets skipped.

/** Override TYPES that may never be written to a Sunday. `rdw` is deliberately absent: Sunday work
 *  is overtime, so RDW is the one thing that BELONGS there. @type {readonly string[]} */
export const SUNDAY_FORBIDDEN_TYPES = Object.freeze(['annual_leave', 'sick', 'other', 'shift']);

/** @param {string} type an override type id @returns {boolean} */
export function isForbiddenOnSunday(type) { return SUNDAY_FORBIDDEN_TYPES.includes(type); }

/**
 * Compose the parsed-roster VALUE a chosen override TYPE plus optional times amounts to.
 *
 * The roster review answers an unreadable cell in place: the admin picks a type and this turns it
 * into the parsed-value alphabet, so the entry goes through `normaliseCellValue` and every guard an
 * ordinary parsed value gets — the translation above, written once. Null when the type needs times and
 * has no usable pair.
 *
 * `other` is deliberately NOT handled here: a second partial implementation of its grammar is where a
 * wrong value would come from, so the entry control uses `composeOtherValue` (roster-entry-control.js).
 *
 * @param {string} type an override type id (`PILL_TYPES` vocabulary)
 * @param {string} [from] `HH:MM`
 * @param {string} [to] `HH:MM`
 * @returns {string|null} a parsed-roster value, or null when the entry is incomplete/unsupported
 */
export function manualCellValue(type, from = '', to = '') {
    if (type === 'correction')   return 'RD';
    if (type === 'annual_leave') return 'AL';
    if (type === 'sick')         return 'SICK';
    if (type === 'spare_shift')  return 'SPARE';
    if (type !== 'shift' && type !== 'rdw') return null;   // incl. `other` — see above
    // A REAL clock time: the boxes are text, so nothing rejects `29:00`. `24:00` is refused too — a
    // midnight finish is `00:00`, and an overnight range is end < start.
    if (!isClockTime(from) || !isClockTime(to)) return null;
    const range = `${from}-${to}`;
    return type === 'rdw' ? `RDW|${range}` : range;
}

/** Parsed roster VALUES that cannot stand on a Sunday, and what they become instead — unchanged when fine. The
 *  import NORMALISES rather than refusing: rejecting the week over one cell would lose the other six. An Other day
 *  printed WITH times keeps them — Sunday work, not rest (roster-import.md). @param {string} value @returns {string} */
export function sundaySafeValue(value) {
    return value === 'AL' || value === 'SICK' ? 'RD' : isOtherValue(value) ? (parseOtherValue(value)?.time || 'RD') : value;
}

/**
 * Split an ordered list of override writes into batches Firestore will accept — its hard cap is 500
 * writes a batch. Counted in WRITES, not items (one item can be a set plus several deletes), and
 * closed at `max` (450: the import's headroom). An item
 * `keepWithPrevious` names never STARTS a batch while the hard cap still holds: a Sunday correction
 * must share the server stamp of the leave beside it, which is how deleting the period later knows
 * the edge Sunday was the booking's (`computePeriodDeleteIds`). Order kept, every item once. Pure.
 * @template T
 * @param {T[]} items
 * @param {(item: T) => number} writesFor
 * @param {{ max?: number, keepWithPrevious?: (item: T) => boolean }} [opts]
 * @returns {T[][]}
 */
export function chunkByWrites(items, writesFor, { max = 450, keepWithPrevious = () => false } = {}) {
    const HARD_CAP = 500;
    /** @type {T[][]} */ const chunks = [];
    /** @type {T[]} */ let cur = [];
    let writes = 0;
    for (const item of items) {
        const n = writesFor(item);
        const full = writes + n > max && !(keepWithPrevious(item) && writes + n <= HARD_CAP);
        if (cur.length && full) { chunks.push(cur); cur = []; writes = 0; }
        cur.push(item); writes += n;
    }
    if (cur.length) chunks.push(cur);
    return chunks;
}
