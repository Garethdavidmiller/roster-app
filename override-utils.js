// @ts-check
// Override priority, member-start, and shift-classification helpers.
// Shared by calendar-app.js, calendar-team-view.js, and the admin modules.

/**
 * Returns true if the shift is a non-working rest day (RD or OFF).
 * @param {string} shift
 * @returns {boolean}
 */
export function isRestShift(shift) {
    return shift === 'RD' || shift === 'OFF';
}

/**
 * The override types that put CONTRACTED work on a day — the ones that move a member's obligation
 * onto it, as opposed to the ones they volunteered for.
 *
 * ── WHY `rdw` IS DELIBERATELY ABSENT, AND WHY THAT IS THE WHOLE POINT ───────────────────────────
 *
 * `WORKED_OVERRIDE_TYPES` (admin-shift-types.js) answers a different question — "is somebody at
 * work that day?" — and for that, `rdw` and `shift` are the same. For ANNUAL LEAVE they are
 * opposites, and nothing in the app used to say so:
 *
 *   · `shift` on a base rest day is a SWAP. The member moved their contracted day onto it, so
 *     taking leave there spends a day of entitlement exactly like any other working day.
 *   · `rdw` on a base rest day is VOLUNTARY OVERTIME. The contract is unchanged; a member who
 *     then cannot work it has not taken leave, they have simply not done the overtime.
 *
 * Reusing `WORKED_OVERRIDE_TYPES` here would charge a member a day of annual leave for declining
 * overtime, which is why this is its own set rather than a filter over that one. The legacy pair
 * splits the same way: `swap`/`allocated` are contracted, `overtime` is not.
 */
export const CONTRACTED_WORK_TYPES = new Set([
    'shift', 'spare_shift', 'other',
    'allocated', 'swap',              // legacy, still in data — contracted, like `shift`
]);

/** Work a member VOLUNTEERED for. Declining it is not leave. (`overtime` is the legacy `rdw`.)
 *
 *  CONFIRMED BY THE OWNER, 26 Aug 2026 (VAL-AL-001, previously an inference). The operational
 *  answer is narrower than the rule: annual leave reaches a rest day ONLY where a member has
 *  SWAPPED working days and then books the swapped-in day off — which is `shift`, and is charged
 *  above. Agreeing RDW and later booking it as leave is not a thing the roster office records. So
 *  this branch guards a path that does not arise in practice, and is kept because the alternative
 *  is falling through to the base roster, which would charge a day for declining overtime. */
export const VOLUNTARY_WORK_TYPES = new Set(['rdw', 'overtime']);

/**
 * Was the member CONTRACTED to work the day this override describes?
 *
 * Answers from the override alone, so it is the one place the swap-vs-overtime distinction lives.
 * A rest-valued override (`correction`/RD — the other half of a swap) is not work whatever its
 * type, which is checked first because it is the stronger statement.
 *
 * @param {{type?:string, value?:string}|null|undefined} ov
 * @returns {boolean|null} true/false, or null when `ov` carries no usable information — the caller
 *          must then fall back to the base roster rather than treat "unknown" as "no".
 */
export function isContractedWorkOverride(ov) {
    if (!ov || !ov.type) return null;
    if (isRestShift(ov.value || '')) return false;          // a rest VALUE is not work whatever its type
    // A `correction` is classifiable by TYPE ALONE: its value is pinned to 'RD' by both TYPES'
    // fixedValue and the Firestore rules, so the type implies rest even when the value is absent —
    // which it always is when the override is being reconstructed from a `replacedType` (v21.56:
    // the first cut read a `replacedValue` that no write path has ever produced, so a swapped-OUT
    // day's AL was charged the moment the correction doc was destroyed).
    if (ov.type === 'correction') return false;
    if (CONTRACTED_WORK_TYPES.has(ov.type)) return true;
    if (VOLUNTARY_WORK_TYPES.has(ov.type)) return false;
    // `sick`, `annual_leave` and anything unrecognised describe an ABSENCE, not a contract. They
    // say nothing about whether the member was due to work, so they must answer "unknown" and let
    // the base roster decide. Returning false here would be the same bug in a new place: leave
    // recorded over an absence on an ordinary working day would silently stop costing a day.
    return null;
}

/**
 * Display-suppression rule (CLAUDE.md "Sundays are non-contracted", layer 5) — SINGLE SOURCE for the
 * calendar renderer, Team Week View, and month legend so they can never disagree. True when an
 * override must NOT replace the base shift on the calendar: a `sick` override on a rest-day base OR
 * any Sunday, and `annual_leave` / Other-family (`other`) on any Sunday. (A worked Sunday is always
 * RDW, never AL/Absent; Sundays and rest days are non-contracted — such overrides are only ever
 * legacy/hand-written data.) `rdw`, `correction`, `spare_shift`, and plain `shift` are never suppressed.
 * Takes `sunday` as a boolean (not the date) so this module stays free of a roster-data import — that
 * would be a cycle, since roster-data imports from here. Callers pass `isSunday(dateStr)`.
 * @param {{type: string}} override
 * @param {string} baseShift  the member's base roster shift for that date
 * @param {boolean} sunday    whether the date is a Sunday
 * @returns {boolean} true → ignore the override, keep the base shift
 */
export function isOverrideDisplaySuppressed(override, baseShift, sunday) {
    switch (override.type) {
        case 'sick':         return isRestShift(baseShift) || sunday;
        case 'annual_leave': return sunday;
        case 'other':        return sunday;
        default:             return false;
    }
}

/**
 * Group a sorted, Sunday-excluded list of AL/absence dates into contiguous "periods" for the admin
 * booked-dates boxes, merging two dates into ONE period when every calendar day BETWEEN them is a
 * "rest gap" (a Sunday or a base rest day) — so e.g. a Fri + the following Mon reads as one period
 * across the weekend. Pure: the day-of-week / base-roster knowledge stays with the caller, which
 * supplies `isRestGap(dateStr)` and `addDay(dateStr)`. Extracted from admin-app.js `_renderBookedPeriods`
 * (v16.42) so this previously-untested merge logic is unit-testable.
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
    // Plain JS Date (v16.23): the write paths stamp cache-inserted docs with `createdAt: new Date()`.
    // Returning 0 for those made shouldReplaceOverride rank a JUST-SAVED override below a lingering
    // same-source duplicate with a real Firestore timestamp — the grid kept showing the stale value
    // until the next full reload.
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
 * layer + `shouldReplaceOverride` consume: the value plus note/type/source/createdAt with the
 * exact same defaults. Single source for every write into `rosterOverridesCache` — a divergence in
 * these defaults would produce subtle precedence bugs, since shouldReplaceOverride keys off
 * source/createdAt. (There is now exactly ONE writer, calendar-overrides.js: Team Week View's own
 * per-week fetch was removed at v18.76 and the clearShiftTypesCache() export at v18.84 depends on
 * that staying true. These comments still said "two writers" until v18.91 — a reader following them
 * would reasonably add a second, which is the precise failure both changes exist to prevent.)
 * @param {any} data - a Firestore override doc's `.data()`
 * @returns {{ value: any, note: string, type: string, source: any, createdAt: any }}
 */
export function toOverrideRecord(data) {
    return {
        value:     data.value,
        note:      data.note      || '',
        type:      data.type      || '',
        source:    data.source    || null,
        createdAt: data.createdAt || null,
        // Carried so the calendar cache holds the SAME shape of a doc as the admin cache (v21.56).
        // Nothing on the calendar reads it today (the AL lightbox does its own raw getDocs), but
        // two mirrors holding different shapes of one document is how a future consumer re-opens
        // the swapped-day bug silently — same key-presence convention as the write builders.
        ...(data.replacedType ? { replacedType: data.replacedType } : {}),
    };
}

/**
 * Collect validated override records from a Firestore range-query snapshot, ready for
 * `reconcileRangeIntoCache`. The SINGLE source for the required-field validation — it was once
 * copied into both the month fetch and Team View's own week fetch, so a change had to be made twice
 * or the two would silently diverge. The week fetch is gone (v18.76), leaving calendar-overrides.js
 * as the only feeder; this stays the one place the validation lives. Malformed docs (missing
 * memberName/date/value) are skipped; only the doc **id** is logged — never the doc body, which can
 * carry a member name / free-text note (the calendar path used to `console.error` the whole doc).
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
 * Firestore rules require (`memberName`, `date`, `type`, `value`, `note`, `source`, `createdAt`,
 * `changedBy`). Three save paths (executeSave + recordRangeOverrides in admin-overrides.js, and the
 * roster-import _saveOverrideBatches) each hand-built this inline: a new required rules field meant
 * editing all three, and a miss = a silent `permission-denied` on ONE path only. `createdAt` is
 * INJECTED (the caller passes `serverTimestamp()`) so this module stays Firebase-free. `note` defaults
 * to '' (the rules require it present). Extra fields on the input are dropped — the shape is enforced.
 * @param {{memberName:string, date:string, type:string, value:any, note?:string, source:string, changedBy:string, replacedType?:string|null}} f
 * @param {*} createdAt  a Firestore serverTimestamp() sentinel for the write
 * @returns {{memberName:string, date:string, type:string, value:any, note:string, source:string, createdAt:*, changedBy:string}}
 */
export function buildOverrideWrite(f, createdAt) {
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
        createdAt,
        changedBy:  f.changedBy,
    };
}

/**
 * Assemble the OPTIMISTIC in-memory cache record for a just-written override (the admin `_allOverrides`
 * mirror that avoids a Firestore round-trip). Same field set as the write MINUS `changedBy`, PLUS the
 * new doc `id`, and with a real `Date` for `createdAt` (so `tsToMillis` ranks a just-saved override
 * correctly — see the v16.23 fix). Single source so no write path can drift its mirror.
 * @param {string} id  the new Firestore doc id
 * @param {{memberName:string, date:string, type:string, value:any, note?:string, source:string, replacedType?:string|null}} f
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
        // Only when there IS one — the Firestore rules use hasOnly + `is string`, so writing the
        // key as null would be rejected outright rather than treated as absent.
        ...(f.replacedType ? { replacedType: f.replacedType } : {}),
        createdAt,
    };
}

/**
 * What `replacedType` a new override should carry, given the one it is about to delete.
 *
 * ── WHY THIS IS STORED AT ALL, WHEN THIS REPO PREFERS TO DERIVE ─────────────────────────────────
 *
 * A write is `batch.delete(existing)` then `batch.set(new)`, so recording annual leave on a day
 * DESTROYS the override that said what the day was. For a swapped-in day — a `shift` sitting on a
 * base rest day — that deleted doc was the only record that the member was contracted to work it,
 * and without it `consumesEntitlement` falls back to the base roster, sees a rest day, and charges
 * nothing. The member gets the leave free. Nothing anywhere else can recover the fact, which is
 * why it is stored rather than derived: it is a FACT being preserved, not a summary of one.
 *
 * ── THE INHERIT RULE IS THE PART THAT IS EASY TO GET WRONG ──────────────────────────────────────
 *
 * Re-saving the same booking is ordinary (an admin adjusts one day of a range and saves the lot),
 * and the second write replaces an AL doc with another AL doc. Recording `annual_leave` as what it
 * replaced would erase the original context on the second save — so the day would cost a day of
 * leave until somebody pressed Save twice, and then quietly stop. Same type in, same type out ⇒
 * carry the original forward.
 *
 * @param {{type?:string, replacedType?:string|null}|null|undefined} existing the doc being deleted
 * @param {string} newType the type being written
 * @returns {string|null}
 */
export function nextReplacedType(existing, newType) {
    if (!existing || !existing.type) return null;
    if (existing.type === newType) return existing.replacedType || null;
    // CHAIN THROUGH AN ABSENCE (v21.56, external sweep). A type change used to record
    // `existing.type` unconditionally — but when the doc being deleted is itself an absence
    // carrying a chain (swap → sick → AL is two routine operations), recording `sick` DISCARDS the
    // `shift` underneath it, and `sick` is precisely a type `isContractedWorkOverride` calls "no
    // information", so the re-derived day fell back to the base roster and the leave went free.
    // An absence carries no contract information of its own, so what IT replaced is the fact worth
    // keeping; an informative type (`shift`, `rdw`, `correction`…) IS the fact and still wins.
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
// Rule: see CLAUDE.md — "shouldReplaceOverride" precedence: manual beats import; within same source, newer wins.
export function shouldReplaceOverride(existing, incoming) {
    if (!existing) return true;
    const existingIsImport = (existing.source || '') === 'roster_import';
    const incomingIsImport = (incoming.source || '') === 'roster_import';
    if (existingIsImport && !incomingIsImport) return true;   // manual beats import
    if (!existingIsImport && incomingIsImport) return false;  // import can't beat manual
    return tsToMillis(incoming.createdAt) >= tsToMillis(existing.createdAt);
}

/**
 * Reconcile a Firestore date-range snapshot into the shared override cache AUTHORITATIVELY.
 *
 * A range query for [startStr, endStr] is the single source of truth for those dates, so the winner
 * for each in-range key must be rebuilt from the SNAPSHOT RECORDS ALONE (deduped by
 * `shouldReplaceOverride`), never merged against the possibly-stale existing cache. The old
 * per-doc merge kept a cached higher-priority record alive when the snapshot no longer contained it:
 *   • a MANUAL override deleted in Firestore, but a lower-priority IMPORT for the same date still
 *     exists — the incoming import can't out-rank the cached manual (shouldReplaceOverride → false),
 *     so the merge kept the deleted manual AND (because the key WAS seen) skipped the deletion pass;
 *   • a newer import deleted, leaving only an older import — the cached newer one likewise survived.
 * Rebuilding winners from the snapshot fixes both: whatever the snapshot says for a key wins, and any
 * in-range key the snapshot omits entirely is a genuine delete.
 *
 * The cache is mutated in place. Returns whether any in-range slot's DISPLAY changed (added, removed,
 * or type/value/note differs) so a caller can gate a re-render; metadata-only differences (a new
 * winner with the same visible shift) still update the cache but don't force a repaint.
 *
 * @param {Map<string, any>} cache     the shared rosterOverridesCache (mutated in place)
 * @param {Array<{ memberName: string, date: string, record: any }>} records  validated snapshot rows
 * **`authoritative: false` (v19.01)** — merge the snapshot in but evict NOTHING. Required for a read
 * whose snapshot is not the truth for the range: a LOCAL-CACHE read (`getDocsFromCache`) returns a
 * possibly-stale SUBSET, so treating an absent key as a delete would wipe live overrides. Only a server
 * range query may evict. Getting this wrong is not theoretical — two authoritative reconcilers racing on
 * one range is exactly the v18.76 Team View bug, where the later-resolving staler snapshot evicted
 * overrides the other fetch had just loaded and the grid fell back to the base roster.
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
        if (!existing
            || existing.type  !== record.type
            || existing.value !== record.value
            || existing.note  !== record.note) {
            displayChanged = true;
        }
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
 * Sunday (Fri/Sat before, Mon/Tue after). The Sunday itself never carries AL/sick, and the
 * immediately-adjacent Saturday is often a base rest day (so no leave override is written there
 * either) — a range that ENDS on the Sunday then has its nearest surviving leave on the Friday,
 * two days back. Checking only ±1 day therefore missed it and wrongly deleted the shared
 * correction, resurrecting the worked Sunday shift in the MIDDLE of a member's remaining leave.
 * (An earlier bug looked for an AL/sick record ON the Sunday — which never exists — and deleted
 * the correction every time.)
 *
 * @param {Array<{id:string,memberName:string,date:string,type:string,value:string}>} allOverrides
 * @param {{type:string, memberName:string, start:string, end:string}} range  type is 'annual_leave' | 'sick'; start/end inclusive YYYY-MM-DD
 * @returns {string[]} override document IDs to delete
 */
export function computePeriodDeleteIds(allOverrides, { type, memberName, start, end }) {
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
    // A surviving range covers the Sunday iff it has a leave override within 2 days either side
    // (±1 = Sat/Mon, ±2 = Fri/Tue for when the adjacent rest day carries no leave). Keep the shared
    // correction in that case; only delete it when nothing surviving spans the Sunday.
    // ACCEPTED TRADE-OFF: per-day override docs carry no booking-range identity, so this heuristic
    // can FALSE-KEEP — an unrelated 1-day absence at Sunday±2 preserves a correction whose booking
    // was fully deleted (calendar shows a stale RD on a worked Sunday until manually removed). We
    // bias toward keeping: the opposite error (deleting a correction an overlapping booking still
    // needs) resurrects a WORKED shift in the middle of someone's remaining leave, which is worse.
    const _spansSunday = (/** @type {string} */ sundayISO) =>
        [-2, -1, 1, 2].some(off => remainingLeaveDates.has(_shiftISODate(sundayISO, off)));
    const correctionIds = allOverrides
        .filter(o => inRange(o) && o.type === 'correction' && o.value === 'RD' && _isSundayISO(o.date) &&
            !_spansSunday(o.date))
        .map(o => o.id);
    return [...leaveIds, ...correctionIds];
}

// ── TRAINING / INDUCTION / ASSESSMENT (OTHER_PLAN.md) ──────────────────────
// One override type ('other') whose value uses a human-readable grammar that
// mirrors the roster's own language:
//
//   value := FLAVOUR [" RDW"] [" HH:MM-HH:MM"]
//   FLAVOUR := "TRG" | "IND" | "ASSESS" | "TEAM" | "UNION" | "MEET"
//
// Examples: 'TRG' · 'IND RDW' · 'ASSESS 08:00-16:00' · 'TRG RDW 08:00-16:00' · 'TEAM' · 'UNION' · 'MEET'.
// " RDW" marks an Other-family rest-day (explicitly written on the roster as "TRG RDW");
// the optional time range is the trainer's ACTUAL hours, entered manually by the
// admin (roster uploads never carry times). This module is the client-side single
// source for the grammar; a deliberate duplicate of the RECOGNITION grammar (the
// looser roster-word aliases) lives in functions/roster-parse-helpers.js —
// Cloud Functions are CommonJS and cannot import this module (same accepted
// pattern as normaliseSurname). If the grammar changes, update both.

/** Badge (short) and full display words per Other-family flavour. Badge word shows in the
 *  calendar-cell badge next to 🏷️; full word is used on tap (day detail / tooltip / aria).
 *  `hideBaseTime` (optional) suppresses the base-shift-time fallback in the hours slot — see below.
 *  @type {Record<string, { badge: string, full: string, hideBaseTime?: boolean }>} */
export const OTHER_FLAVOURS = {
    TRG:    { badge: 'Train',  full: 'Training'   },
    IND:    { badge: 'Ind',    full: 'Induction'  },
    ASSESS: { badge: 'Assess', full: 'Assessment' },
    TEAM:   { badge: 'Team',   full: 'Team Day'   },
    // `hideBaseTime`: Meetings + Union duties are "attend-an-event" days not tied to a rostered
    // shift time, so their calendar hours slot shows NO time (badge only) unless a time is actually
    // entered/on the roster. Training/Induction/Assessment/Team days happen DURING your shift, so
    // they keep showing the base shift time. Pay is unaffected either way — `resolveOtherPay` is
    // flavour-agnostic (all Other days pay as the day underneath; a rest-day RDW pays the 8h default
    // unless a time is given). Confirmed by Gareth Jul 2026.
    UNION:  { badge: 'Union',  full: 'Union',     hideBaseTime: true },
    MEET:   { badge: 'Meet',   full: 'Meeting',   hideBaseTime: true },
};

/** Default duration credited to an Other-family REST-DAY (e.g. TRG RDW) when no actual times are
 *  recorded: 8 hours, pre-filled into the pay calculator's RDW bucket for the member to
 *  correct to the real hours (confirmed by Gareth, Jul 2026). Single source — never inline 480. */
export const OTHER_RDW_DEFAULT_MINS = 480;

// Anchored full-string grammar. Time range is bounded HH:MM (00-23 / 00-59) so an
// impossible time can never ride in on an Other-family value.
//
// The flavour alternation is DERIVED from OTHER_FLAVOURS, not hand-written (v18.91). It used to be
// a literal `TRG|IND|ASSESS|TEAM|UNION|MEET` list, which meant the READER's accept-set and the
// WRITER's (composeOtherValue tests `hasOwnProperty(OTHER_FLAVOURS, …)`) were two lists that had to
// be kept in step by hand. Adding a flavour the way UNION and MEET were added — one OTHER_FLAVOURS
// entry, which is also what renders the admin flavour buttons — would have let the composer write a
// value this regex rejects: unparseable data, permanently, in Firestore. That is the exact drift the
// v18.85 extraction was meant to end, and it survived it. One source now feeds both halves.
const _OTHER_RE = new RegExp(
    `^(${Object.keys(OTHER_FLAVOURS).join('|')})( RDW)?( ([01]\\d|2[0-3]):[0-5]\\d-([01]\\d|2[0-3]):[0-5]\\d)?$`
);

/**
 * True when a stored override/shift value is an Other-family value (any flavour,
 * with or without the RDW marker and optional times).
 * @param {any} v
 * @returns {boolean}
 */
export function isOtherValue(v) {
    return typeof v === 'string' && _OTHER_RE.test(v);
}

/**
 * Parse an Other-family value into its parts, or null when it isn't one.
 * @param {any} v
 * @returns {{ flavour: 'TRG'|'IND'|'ASSESS'|'TEAM'|'UNION'|'MEET', rdw: boolean, time: string|null } | null}
 */
export function parseOtherValue(v) {
    if (typeof v !== 'string') return null;
    const m = v.match(_OTHER_RE);
    if (!m) return null;
    return {
        flavour: /** @type {'TRG'|'IND'|'ASSESS'|'TEAM'|'UNION'|'MEET'} */ (m[1]),
        rdw:     !!m[2],
        time:    m[3] ? m[3].trim() : null,
    };
}

/** Single HH:MM field, bounded 00-23 / 00-59. Mirrors TIME_RE in roster-data.js; kept local so
 *  this module stays import-free and unit-testable in plain Node. */
const _HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * COMPOSE an Other-family value — the writer half of the grammar `FLAVOUR[" RDW"][" HH:MM-HH:MM"]`,
 * living next to `parseOtherValue` (its reader) so the two can never drift apart (v18.85).
 *
 * Until now the parser was single-sourced and unit-tested here while the COMPOSER was written
 * inline in `admin-app.js`'s 1,700-line save handler with no test of its own — the wrong way round
 * for a format that gets persisted to Firestore and read back by three display paths and the pay
 * engine. A parse bug shows the wrong thing; a compose bug writes bad data permanently.
 *
 * Returns `{ value }` on success, or `{ error }` with a bare, staff-facing sentence (no date
 * prefix — the caller adds "Fri 3 Jul: " itself). Times are OPTIONAL: both blank means "use the
 * default hours", but a half-filled or malformed pair is an error, never a silent drop.
 *
 * SPARE is deliberately NOT handled here. It lives under the same Admin pill but is its own
 * override TYPE (`spare_shift` / 'SPARE'), not a value in this grammar — the caller routes it
 * before composing.
 *
 * @param {{ flavour?: string|null, rdwTicked?: boolean, baseIsRd?: boolean,
 *           start?: string, end?: string }} f
 *   `rdwTicked` is the row's RDW checkbox; `baseIsRd` is whether the day's BASE shift is a rest day
 *   (which FORCES the marker — see the caller's note: both display layers and the pay engine derive
 *   RDW-ness from a rest-day base anyway, so omitting it would make the stored value lie).
 * @returns {{ value: string, error?: undefined } | { error: string, value?: undefined }}
 */
export function composeOtherValue(f) {
    const flavour = (f && f.flavour) || '';
    // Force an explicit choice — no silent Training default (owner decision, v15.56): a manager
    // recording an induction who didn't tap a type would otherwise have it saved as Training.
    if (!Object.prototype.hasOwnProperty.call(OTHER_FLAVOURS, flavour)) {
        return { error: 'choose the type of Other day (Training, Induction, Assessment, Team Day, Union, Meeting or Spare)' };
    }
    const rdw = (f.rdwTicked || f.baseIsRd) ? ' RDW' : '';

    const s = (f.start || '').trim();
    const e = (f.end   || '').trim();
    let time = '';
    if (s || e) {
        if (!s || !e)                             return { error: 'fill in both times, or leave both blank to use the default hours' };
        if (!_HHMM_RE.test(s) || !_HHMM_RE.test(e)) return { error: 'times must be in HH:MM format (e.g. 07:00)' };
        // Equal start/end would validate as a 0h shift but PAY as 24h (the overnight wrap in the
        // duration maths) — reject at the only place these times are authored.
        if (s === e)                              return { error: 'start and end times are the same' };
        time = ` ${s}-${e}`;
    }
    return { value: `${flavour}${rdw}${time}` };
}

/**
 * Duration of an HH:MM-HH:MM range in minutes; overnight ranges wrap past midnight.
 * @param {string} time
 * @returns {number}
 */
function _shiftMins(time) {
    const [st, en] = time.split('-');
    const [sh, sm] = st.split(':').map(Number);
    const [eh, em] = en.split(':').map(Number);
    let mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins <= 0) mins += 24 * 60;
    return mins;
}

/**
 * Resolve how an Other-family day PAYS (OTHER_PLAN.md — the pay mapping, in one place).
 * Display deliberately does NOT use this — it shows the 🏷️ badge; only pay consumers
 * (paycalc-roster-suggestions.js) resolve an Other day to the day underneath it.
 *
 * Modes:
 *   'rdw'     — an Other-family rest-day: explicit " RDW" flag OR (belt-and-braces) the base
 *               is itself a rest day. mins = actual times when recorded, else the 8h
 *               default (OTHER_RDW_DEFAULT_MINS). All hours stay RDW — never split into OT.
 *   'timed'   — a rostered day with actual times recorded: classify like a shift
 *               override (the existing base-cap + excess→overtime split applies).
 *   'as-base' — a rostered day, no times: pay exactly as the base shift (the member is
 *               never paid less than their rostered shift, even if the Other day runs short).
 *
 * @param {{ flavour: string, rdw: boolean, time: string|null }} parsed  from parseOtherValue()
 * @param {string} baseValue  the member's base roster shift for that date
 * @returns {{ mode: 'rdw', mins: number } | { mode: 'timed', time: string } | { mode: 'as-base' }}
 */
export function resolveOtherPay(parsed, baseValue) {
    const rdw = parsed.rdw || isRestShift(baseValue);
    if (rdw) return { mode: 'rdw', mins: parsed.time ? _shiftMins(parsed.time) : OTHER_RDW_DEFAULT_MINS };
    if (parsed.time) return { mode: 'timed', time: parsed.time };
    return { mode: 'as-base' };
}

/** A worked-shift "HH:MM-HH:MM" range (the DISPLAY form — 1-or-2-digit hours, no anchoring;
 *  matches the renderer's historical inline regex, deliberately looser than roster-data's TIME_RE). */
const SHIFT_RANGE_RE = /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/;
// Worked override types whose TIMED value on a Sunday must display as RDW (never a plain shift) —
// see resolveEffectiveShift. `rdw` already resolves to RDW; `spare_shift` is a badge, not a time.
const SUNDAY_RDW_DISPLAY_TYPES = new Set(['shift', 'allocated', 'overtime', 'swap']);

/**
 * Resolve a Firestore override onto a base shift into ONE canonical display descriptor.
 *
 * This is the single source for the "apply override onto base shift" ladder that used to be
 * re-implemented in three places (calendar renderer, Team Week View, month legend). Those
 * copies drifted once already — the missing Sunday-AL suppression in Team view (fixed v16.37
 * by extracting `isOverrideDisplaySuppressed`). This extracts the whole ladder (v16.48) so the
 * three consumers render from one resolution and can never disagree again. Pure — no DOM, no
 * Firestore, no roster lookup; the caller passes the already-fetched override and base shift
 * (and must pass `null` for a before-member-start / absent override, exactly as before).
 *
 * @param {any}     override  The override for this member+date, or null/undefined.
 * @param {string}  baseShift The base shift from getBaseShift (Christmas/startDate already applied).
 * @param {boolean} sunday    isSunday(dateStr) — Sundays are non-contracted (suppression input).
 * @returns {{ shift: string, rdwTime: string, derivedRdw: boolean, note: string }}
 *   shift      canonical effective shift: `baseShift` when there is no override or it is
 *              suppressed; `'RDW'` for an rdw override; the raw Other grammar value for a
 *              parseable `other`; otherwise `override.value` (AL→'AL', SICK→'SICK',
 *              correction→'RD', spare_shift→'SPARE', legacy types via their value).
 *   rdwTime    rdw override → `override.value`; parseable Other → its hours-slot string
 *              (actual time → 'RDW' → the base shift's own time → ''); '' otherwise.
 *   derivedRdw parseable Other day only: true when RDW via the explicit flag OR a rest-day base.
 *   note       `override.note` (or '') when an override applied; '' otherwise.
 */
export function resolveEffectiveShift(override, baseShift, sunday) {
    if (!override || isOverrideDisplaySuppressed(override, baseShift, sunday)) {
        return { shift: baseShift, rdwTime: '', derivedRdw: false, note: '' };
    }
    const note = override.note || '';
    if (override.type === 'rdw') {
        return { shift: 'RDW', rdwTime: override.value, derivedRdw: false, note };
    }
    // A worked Sunday is ALWAYS Rest Day Working, never a plain shift — Sundays are non-contracted
    // for every grade. New creation is blocked at every write path (the admin Sunday Shift-pill
    // guard + bulk skip + roster-upload time→rdw promotion, v18.73), but a legacy / hand-written
    // worked-type doc (shift or the legacy allocated/overtime/swap) sitting on a Sunday must still
    // DISPLAY as 💼 RDW, not an Early/Late badge — matching the creation invariant and the pay
    // engine (which already prices any worked Sunday at 1.5× via its own dow===0 branch). A
    // timed value is treated exactly like an `rdw` override; a non-time value falls through.
    if (sunday && SUNDAY_RDW_DISPLAY_TYPES.has(override.type) && SHIFT_RANGE_RE.test(override.value || '')) {
        return { shift: 'RDW', rdwTime: override.value, derivedRdw: true, note };
    }
    const parsedOther = override.type === 'other' ? parseOtherValue(override.value) : null;
    if (parsedOther) {
        const derivedRdw = parsedOther.rdw || isRestShift(baseShift);
        // Hours slot: admin-entered/roster actual times → 'RDW' (a rest-day Other, no times) → the
        // base shift's own time (a rostered-day Other that happens DURING your shift) → '' (badge
        // only). Meetings + Union duties (hideBaseTime) skip the base-time fallback — they're
        // attend-an-event days, so they show the badge alone unless a time was actually entered.
        const showsBaseTime = !OTHER_FLAVOURS[parsedOther.flavour]?.hideBaseTime;
        const rdwTime = parsedOther.time ?? (derivedRdw ? 'RDW'
            : (showsBaseTime && SHIFT_RANGE_RE.test(baseShift) ? baseShift : ''));
        return { shift: override.value, rdwTime, derivedRdw, note };
    }
    return { shift: override.value, rdwTime: '', derivedRdw: false, note };
}

// ── WHAT MAY NOT BE RECORDED ON A SUNDAY (v21.32) ───────────────────────────────────────────────
//
// Sundays are not contracted for any grade here, so annual leave, an absence and an "Other" day
// cannot apply to one — and a worked Sunday is always RDW (overtime), never a plain shift.
//
// The rule is enforced at SEVERAL points on purpose and that stays. Defence in depth is right for a
// rule whose failure writes leave against a day nobody was contracted to work. What was wrong is
// that each site STATED the policy itself, in its own vocabulary, with `// Rule: see CLAUDE.md`
// comments pointing at prose because there was no code to point at. They agreed — checked site by
// site — but nothing made them agree, and the next site would have had to re-derive it.
//
// Two sites now CONSULT this declaration: the bulk bar (`isForbiddenOnSunday`) and the roster import
// (`sundaySafeValue`). Two keep a bespoke copy for a reason, and are pinned to this list by
// override-utils.test.mjs instead — a fifth forbidden type added here fails those tests rather than
// being silently writable:
//
//   · the week-grid PILLS (`admin-overrides.js`) carry per-pill wording — "Annual leave cannot be
//     recorded on a Sunday…" — and one shared message would be vaguer than any of them.
//   · the single-row SAVE (`admin-app.js`) does three different things with the four types: a plain
//     `shift` is PROMOTED to `rdw` rather than refused, an "Other" day is refused unless its flavour
//     is Spare (v18.91), and leave and absence are refused outright. That is not drift — it is what
//     each type should do — but it means the site cannot be a loop over this list.
//
// NOT the same question, and deliberately not wired to this list: `isOverrideDisplaySuppressed` at
// the top of this file. It asks what may be SHOWN, not what may be WRITTEN, and its answer is a
// deliberate subset — a legacy Sunday `shift` is still displayed, because hiding a day somebody
// actually worked is the worse error.
//
// TWO VOCABULARIES, DELIBERATELY NOT COLLAPSED. The admin surfaces reason in override TYPE ids
// (what a pill writes); the roster import reasons in parsed VALUES (what a PDF cell said). They are
// different alphabets for the same policy, and forcing one on the other would mean translating at
// the point of use — which is where a translation gets skipped.

/** Override TYPES that may never be written to a Sunday. `rdw` is deliberately absent: Sunday work
 *  is overtime, so RDW is the one thing that BELONGS there. @type {readonly string[]} */
export const SUNDAY_FORBIDDEN_TYPES = Object.freeze(['annual_leave', 'sick', 'other', 'shift']);

/** @param {string} type an override type id @returns {boolean} */
export function isForbiddenOnSunday(type) { return SUNDAY_FORBIDDEN_TYPES.includes(type); }

/**
 * Compose the parsed-roster VALUE a chosen override TYPE plus optional times amounts to (v22.17).
 *
 * The roster review needs this because an unreadable cell can now be answered in place rather than
 * being a dead end that sends the admin to another page with a name and a date to remember. The
 * admin picks a type — the same pill vocabulary as Change a Shift — and this turns that back into
 * the parsed-value alphabet the review already speaks, so the entry goes through `normaliseCellValue`
 * and every guard an ordinary parsed value gets. It is the TRANSLATION the note above warns about
 * being skipped at the point of use, written once, here, beside both vocabularies.
 *
 * Returns null when the type needs times and does not have a usable pair — the caller then has
 * nothing to write, which is the right answer for a half-filled entry.
 *
 * `other` is deliberately NOT supported: its grammar is `FLAVOUR[" RDW"][" HH:MM-HH:MM"]`, composed
 * from a flavour chip, a rest-day tick and optional times that only the week editor offers. A second
 * partial implementation of that grammar is exactly where a wrong value would come from, so the
 * review says so and points at Change a Shift instead.
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
    const t = /** @param {string} v */ v => /^\d{2}:\d{2}$/.test(v);
    if (!t(from) || !t(to)) return null;
    const range = `${from}-${to}`;
    return type === 'rdw' ? `RDW|${range}` : range;
}


/** Parsed roster VALUES that cannot stand on a Sunday, and what they become instead.
 *  Returns the value unchanged when it is fine, so a caller can use it unconditionally.
 *  The import NORMALISES rather than refusing — a PDF is a statement about the past, and rejecting
 *  the whole week over one cell would lose the other six. @param {string} value @returns {string} */
export function sundaySafeValue(value) {
    return (value === 'AL' || value === 'SICK' || isOtherValue(value)) ? 'RD' : value;
}
