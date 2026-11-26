// @ts-check
/**
 * calendar-overrides.js — Firestore override cache for index.html.
 *
 * Owns: rosterOverridesCache, fetchedMonths, shiftTypesMonthCache,
 *   _initialFetchInProgress, monthKey, fetchOverridesForRange,
 *   ensureOverridesCached, getShiftTypesInMonth, the read ticket (`issueReadTicket`,
 *   `answerStillWanted` — the one rule for whether a read's answer is still wanted), and the record
 *   of the months this device has read whole (`_heldWhole`).
 * Does NOT own: rendering (calendar-app.js / calendar-renderer.js),
 *   member selection (calendar-member.js).
 * Edit here for: Firestore override query, cache invalidation, duplicate resolution.
 */

import { db, collection, query, where, getDocs, getDocsFromCache, COLLECTIONS } from './firebase-client.js';
import { isAccessFailure as _isAccessFailure } from './claim-retry.js';
import { getBaseShift, formatISO, isSunday } from './roster-data.js';
import { reconcileRangeIntoCache, collectOverrideRecords, isBeforeMemberStart, isOtherValue, isChristmasOrBoxingDay } from './override-utils.js';
import { isChristmasLeaveDay, resolveDayShift } from './christmas-leave.js';
import { noteKnowledge, noteCheckFailed, knowledgeOf, forget as forgetKnowledge } from './calendar-data-state.js';
import { hasCalendarAccess, grantNumber, setCalendarAccess, onCalendarAccess } from './calendar-access-state.js';
import { lsGet, lsSet } from './ls.js';

/** The error a month read answered by the OFFLINE CACHE is turned into. */
export const SERVED_FROM_CACHE = 'served-from-cache';

/** The error a read is turned into when its answer lands after the access it was issued under has
 *  gone or been replaced — see `fetchOverridesForRange`. A caller must STAND DOWN on it: it is
 *  neither a failure to report nor, above all, a success to record. */
export const READ_SUPERSEDED = 'read-superseded';

// Cache keyed "memberName|YYYY-MM-DD".
export const rosterOverridesCache = new Map();

// ── THE ACCESS GATE (CALENDAR_DATA.md 3) ────────────────────────────────────────────────────────
//
// Every read in this module refuses to run until Calendar access has been established. That is a
// SECOND gate — `calendar-app.js` does not even initialise the Calendar while locked — and the
// duplication is the point: the coordinator's gate is a property of the call ORDER, which any edit
// can quietly break with no test failing. This one is a refusal at the source.
//
// The read it exists for is `getDocsFromCache`. Firestore security rules are evaluated on the
// SERVER, so a local IndexedDB cache hit never consults them: a browser signed in yesterday still
// holds every override it saw — the annual leave and absence of fifty colleagues — and would paint
// it for the next person at a shared device with no network request to notice.
//
// Deliberately NOT wired to `calendarAccessReady`: importing the access module here would make the
// gate depend on the very promise a bypass would be trying to avoid, and add a Firebase-importing
// dependency to a module the tests load in Node.
//
// THE ANSWER IS NOT KEPT HERE. It is read, each time, from calendar-access-state.js: the ONE copy
// (CALENDAR_DATA.md 21), which imports nothing and loads shut. The grant number a read's ticket
// carries (a read refused under an EARLIER grant says nothing about the current one) lives there too.

// A GRANT IS A FRESH START, AND A SHUT FORGETS. Told by the state on every write, so both hold for
// every route that grants or loses access, with nothing for a route to remember.
onCalendarAccess(({ open }) => {
    // A GRANT is a fresh start (CALENDAR_DATA.md 4), because a re-grant follows a re-lock.
    // `fetchedMonths` is a "we already have this" claim: months claimed before access was lost would
    // still be claimed after it returns, every `ensureOverridesCached` would no-op, and — the shut below
    // having forgotten their knowledge — the re-unlocked Calendar would wait for ever. `_failureRepainted`
    // goes with it: a failure under the old session is not news the new one has heard. Harmless at
    // boot. EVERY grant, one over a Calendar already open included: the grant number has moved, so no
    // read still out can settle the months it claimed.
    if (open) { fetchedMonths.clear(); _settledAt.clear(); _failureRepainted.clear(); _monthOwner.clear(); _recheckOwed.clear(); }
    // A SHUT FORGETS WHAT EVERY MONTH WAS KNOWN TO BE, here, so every route that loses access forgets
    // (cal-data-6). Otherwise a month read under the old grant could be drawn as current after the
    // next grant — and stay current if the new grant's own read failed. Access loss is what `forget` is for.
    else forgetKnowledge();
});

/** @returns {boolean} whether override reads are currently permitted: this gate's name for the one
 *  answer. It has no write of its own to go with it — the access layer writes the state, and the one
 *  write made in this module is a refused read shutting as it notices (`ensureOverridesCached`). */
export function hasOverrideAccess() { return hasCalendarAccess(); }

/** Called when a read is refused because ACCESS has gone, rather than because the network is poor.
 *  Injected by the coordinator, because this module must not import the access layer it exists to
 *  back up. The SHUT needs nobody — it is the one write, made here before the call, and the
 *  documents' gate and the member's stored copy follow it. What is injected is the one thing this
 *  module cannot do: put the lock card on screen (calendar-access.js → `handleAccessLost`). */
/** @type {(() => void)|null} */
let _onAccessLost = null;

/** @param {(() => void)|null} fn */
export function setOverrideAccessLostHandler(fn) { _onAccessLost = fn; }


const fetchedMonths        = new Set();
// Month key → when its last server read settled (or, for the initial fetch's pre-claim, when it was
// claimed). What `releaseStaleMonths` measures age from — see there.
/** @type {Map<string, number>} */
const _settledAt = new Map();
// Months a failed check left drawn as a labelled saved copy — see `_oweIfSavedCopy`. `releaseStaleMonths`
// hands them back however recent the failure, so the label clears itself the next time the page comes
// into view with a connection.
/** @type {Set<string>} */
const _recheckOwed = new Set();
// Memoised getShiftTypesInMonth() results. Key: "memberName|year|month".
// Cleared whenever fetchOverridesForRange() writes new data into rosterOverridesCache.
const shiftTypesMonthCache = new Map();

// Guards against ensureOverridesCached() triggering a competing fetch while
// the initial 3-month load is already in flight. Set via setInitialFetchInProgress().
export let _initialFetchInProgress = false;

/** @param {boolean} v */
export function setInitialFetchInProgress(v) { _initialFetchInProgress = v; }

/**
 * Pre-claim a set of months as fetched before awaiting — used by the coordinator's
 * initial 3-month fetch IIFE to prevent redundant concurrent fetches.
 * @param {string[]} keys
 */
export function addFetchedMonths(keys) { const now = Date.now(); keys.forEach(k => { fetchedMonths.add(k); _settledAt.set(k, now); }); }

/**
 * Remove a month from the fetched set so it can be retried on the next render.
 * Also re-arms the failure repaint (see `_failureRepainted`) — this is the "start again" signal, and
 * a month that is being offered a fresh attempt must be allowed to report the outcome of it.
 * @param {string} key
 */
export function clearFetchedMonth(key) { fetchedMonths.delete(key); _settledAt.delete(key); _failureRepainted.delete(key); }

/**
 * Release every SETTLED month older than `maxAgeMs`, so the next render re-reads it
 * (CALENDAR_DATA.md 18).
 *
 * Otherwise a shared office PC, or an iPhone resumed from the background, shows the morning's roster
 * as current in the afternoon. The caller runs this when the page comes back into view, and on a slow
 * timer while it stays in view, and re-renders; a re-read that FAILS keeps the grid on screen as the
 * labelled saved copy, no longer as current (the catch in `ensureOverridesCached`). A month still IN
 * FLIGHT is left alone, and nothing is released while the initial fetch runs — it owns its months
 * until it settles.
 *
 * A month whose last check failed over a saved copy is handed back too, WHATEVER ITS AGE: nothing
 * renders when a phone is simply picked up again, and without this the "couldn't check for changes"
 * label stayed until somebody pressed Try again, long after the signal had returned.
 * @param {number} maxAgeMs
 * @param {number} [now]
 * @returns {string[]} the month keys the next render should read again
 */
export function releaseStaleMonths(maxAgeMs, now = Date.now()) {
    if (_initialFetchInProgress) return [];
    const released = [];
    for (const key of [...fetchedMonths]) {
        if (_monthWaiters.has(key)) continue;
        const at = _settledAt.get(key);
        if (at === undefined || now - at < maxAgeMs) continue;
        fetchedMonths.delete(key);
        _settledAt.delete(key);
        released.push(key);
    }
    // Claimed again since it failed (a retry is already out for it): that read will settle it.
    for (const key of _recheckOwed) if (!fetchedMonths.has(key)) released.push(key);
    _recheckOwed.clear();
    return released;
}

/**
 * Owe a re-check, on the next return to the page, to each of these months that is drawn as the
 * SAVED COPY — for the first load, whose failure releases its three months unread (cal-data-4). A
 * month with no copy is owed nothing; see `_oweIfSavedCopy`.
 * @param {string[]} keys
 */
export function oweRecheck(keys) { keys.forEach(_oweIfSavedCopy); }

/** A failed check owes a re-check where it left a saved copy on screen — the server's earlier answer,
 *  or this device's cache when the FIRST check failed (cal-data-4: a phone opened in a signal gap kept
 *  "Couldn't update" after the signal came back). A month with no copy is not: its failure panel and
 *  Try again are the recovery.
 *  @param {string} key */
function _oweIfSavedCopy(key) {
    if (_monthOwner.has(key) || knowledgeOf(key) === 'cached') _recheckOwed.add(key);
}

// ── The failed-month repaint, exactly once ─────────────────────────────────────────────────────
//
// A withheld grid has to move from "Checking this month" to the failure panel, so the catch below
// must repaint. Unguarded, that is a LOOP: `renderCalendar` calls `ensureOverridesCached` on every
// render, the catch releases the month for a retry, and the repaint IS a later render — fetch, fail,
// paint, fetch, fail, paint, against Firestore, for as long as the month is on screen.
//
// So the repaint is one-shot per claim. The month still gets exactly one automatic second attempt,
// and after that the recovery is the panel's "Try again", which goes through `clearFetchedMonth` and
// re-arms this. Releasing the month and suppressing the repaint are deliberately NOT the same flag:
// the first is about whether we may fetch again, the second about whether anyone still needs telling.
const _failureRepainted = new Set();

// Month key → the repaint callbacks waiting on its IN-FLIGHT read. Present only while a read that
// `ensureOverridesCached` started is outstanding; see that function for why every caller is kept.
/** @type {Map<string, Set<Function>>} */
const _monthWaiters = new Map();

// There is deliberately no public clearShiftTypesCache(): the only writers of rosterOverridesCache
// are this module's two reads, which both clear the memo (below). Team View used to write the cache
// itself; it goes through the shared month fetch so there is ONE authoritative reconciler per month
// (CALENDAR_DATA.md 6). If another writer is ever genuinely needed, clear shiftTypesMonthCache where
// you write the cache, or the month legend serves a stale type set (an AL cell with no AL legend item).

/**
 * @param {number} year
 * @param {number} month - 0-indexed
 * @returns {string}
 */
export function monthKey(year, month) {
    return `${year}-${String(month + 1).padStart(2, '0')}`;
}

// ── WHO OWNS A MONTH'S CACHE ENTRY (CALENDAR_DATA.md 5) ───────────────────────────────────────
//
// `reconcileRangeIntoCache` is AUTHORITATIVE for its range: it rebuilds each date's winner from the
// snapshot alone and EVICTS in-range keys the snapshot omits. That is exactly right for one read and
// wrong for two, because these reads overlap and settle out of order:
//
//     boot fetch A issued  ──────────────────────────────────────────────► lands (stale snapshot)
//         retry B issued ─────────────► lands (current)   cache correct
//                                                                          A evicts what B loaded
//
// The first load's ordering (calendar-initial-fetch.js → `standing`) stops the LATE one repainting,
// but the cache underneath would still silently regress. Ordering the RENDER without ordering the
// WRITE is half a fix. So every authoritative read takes a sequence number when it is ISSUED and,
// when it lands, may only reconcile the months no NEWER read has already written.
//
// PER MONTH, not per read, deliberately: a three-month boot fetch superseded for one month by a
// navigation read still holds the only data anybody has for the other two. Every caller reads a
// whole month or a run of whole months, and the slices partition the range, so slicing changes no
// eviction semantics: each part is authoritative over itself.
let _readSeq = 0;
/** monthKey → the sequence number of the authoritative read that last wrote it. */
const _monthOwner = new Map();

// ── THE READ TICKET: one rule for "is this answer still wanted?" (CALENDAR_DATA.md 20) ───────────
//
// A read takes time, and the Calendar can change while it is out: access lost, or lost and given
// back (a new grant), or a later read of the same month answered first. So every answer is asked,
// when it LANDS, whether it is still wanted. Twelve hand-written checks used to ask it, and each bug
// they produced was a check asking half the question.
//
// So every read takes a TICKET when it is ISSUED (`issueReadTicket`): the grant it was issued under,
// and its place in the order reads were issued in. Whatever later handles the outcome (a success, a
// failure, a time limit, a paint) asks `answerStillWanted` first. The ticket's place in the order
// serves the cache writes (WHO OWNS A MONTH'S CACHE ENTRY, above). The first load's chip adds one
// question of its own: whether a newer attempt has begun (calendar-initial-fetch.js → `standing`).

/** @typedef {{ grant: number, seq: number }} ReadTicket */

/**
 * Take a ticket at the moment a read is issued (THE READ TICKET).
 * @returns {ReadTicket}
 */
export function issueReadTicket() { return { grant: grantNumber(), seq: ++_readSeq }; }

/**
 * Is the answer to the read holding this ticket still wanted? Only while the access it was issued
 * under is still the access held: the same grant, and not shut since. Never for a failure the read
 * itself reported as `READ_SUPERSEDED`.
 *
 * ONCE NO, ALWAYS NO. A shut is only undone by a new grant, and a new grant has a new number, so no
 * later moment can turn a no back into a yes. That is what lets a catch, a timer or a late paint ask
 * whenever it runs, and trust the answer.
 *
 * The "not shut since" half matters for failures: comparing the grant number alone recorded a read
 * that FAILED after access was shut, before anybody signed in again, against the locked Calendar —
 * which the next grant then drew first. A SUCCESS there is refused too (`fetchOverridesForRange`).
 * @param {ReadTicket} ticket
 * @param {unknown} [err]  the read's failure, when it failed
 * @returns {boolean}
 */
export function answerStillWanted(ticket, err) {
    return hasCalendarAccess() && ticket.grant === grantNumber()
        && /** @type {any} */ (err)?.code !== READ_SUPERSEDED;
}

// ── THE MONTHS THIS DEVICE HAS READ WHOLE (cal-data-3) ───────────────────────────────────────────
//
// An offline range read is answered from EVERY matching document the device's Firestore cache holds,
// whichever query fetched it. The leave panel, Admin and the Pay Calculator fill that cache one
// MEMBER at a time, so a month the Calendar never loaded could come back holding one member's rows
// and be drawn for everybody as a saved copy, a colleague's leave missing under "Saved copy". So a
// month is a saved copy only where the Calendar's own every-member read of it once landed here.
//
// In localStorage, because the case is an OFFLINE OPEN — a new page load — and beside the cache it
// describes (both per origin, cleared together). A device with NO record predates it, so the old rule
// (rows mean a copy) stands there until its first whole read lands — no device loses its saved copy
// to the change itself.
const WHOLE_MONTHS = 'myb_cal_whole_months';
/** How many months the record keeps, newest first — far beyond the few the Calendar reads at once. */
const WHOLE_MONTHS_KEPT = 48;

/** The record: null for a device that has none yet. @returns {Set<string>|null} */
function _wholeMonths() {
    const raw = lsGet(WHOLE_MONTHS);
    if (raw === null) return null;
    // A record that cannot be read names no month: the cautious answer, until the next read rewrites it.
    try { const a = JSON.parse(raw); return new Set(Array.isArray(a) ? a.filter(k => typeof k === 'string') : []); }
    catch { return new Set(); }
}

/** May this device's cache answer for every member's rows in this month? @param {string} key */
function _heldWhole(key) {
    const whole = _wholeMonths();
    return whole === null || whole.has(key);
}

/** Record the months a server read has just answered whole. @param {string[]} keys */
function _noteHeldWhole(keys) {
    if (!keys.length) return;
    const whole = _wholeMonths() ?? new Set();
    for (const key of keys) whole.add(key);
    lsSet(WHOLE_MONTHS, JSON.stringify([...whole].sort().reverse().slice(0, WHOLE_MONTHS_KEPT)));
}

/** Whether a slice covers its whole month — every caller reads whole months, but the record must
 *  never be told a month is held whole on the strength of part of it. @param {{key: string, from: string, to: string}} s */
function _wholeSlice({ key, from, to }) {
    const y = Number(key.slice(0, 4)), m = Number(key.slice(5, 7)) - 1;
    return from === formatISO(new Date(y, m, 1)) && to === formatISO(new Date(y, m + 1, 0));
}

/**
 * Split a date range into per-month slices, each clamped to the range.
 * Exported as a test seam; ISO dates compare correctly as strings, which is what the clamps rely on.
 * @param {string} startStr @param {string} endStr
 * @returns {{key: string, from: string, to: string}[]}
 */
export function _monthSlices(startStr, endStr) {
    const out = [];
    let y = Number(startStr.slice(0, 4));
    let m = Number(startStr.slice(5, 7)) - 1;
    const endY = Number(endStr.slice(0, 4));
    const endM = Number(endStr.slice(5, 7)) - 1;
    // Bounded by construction, but a malformed input must not spin: the app's widest real range is
    // three months, and nothing legitimate reaches even a fraction of this.
    for (let guard = 0; guard < 600 && (y < endY || (y === endY && m <= endM)); guard++) {
        const mStart = formatISO(new Date(y, m, 1));
        const mEnd   = formatISO(new Date(y, m + 1, 0));
        out.push({
            key:  monthKey(y, m),
            from: mStart > startStr ? mStart : startStr,
            to:   mEnd   < endStr   ? mEnd   : endStr,
        });
        if (++m > 11) { m = 0; y++; }
    }
    return out;
}

/**
 * Query Firestore for all override documents in a date range and populate the cache.
 * Documents with missing required fields are skipped and logged.
 * @param {string} startStr - 'YYYY-MM-DD' inclusive start
 * @param {string} endStr   - 'YYYY-MM-DD' inclusive end
 * @param {ReadTicket} [ticket] - the ticket the read is issued under (THE READ TICKET). Taken here, AT
 *   ISSUE, unless the caller took it a moment before for its own questions — `ensureOverridesCached`
 *   does, so its catch asks about the very read that failed. Never pass one taken earlier than that:
 *   the order reads were STARTED in is what the month writes go by.
 */
export async function fetchOverridesForRange(startStr, endStr, ticket = issueReadTicket()) {
    // (Throws `SERVED_FROM_CACHE` when the server did not answer — see the branch below.)
    // THROWS, where the cache read below returns false, deliberately: this is the AUTHORITATIVE read,
    // so a caller reaching it without access has a real ordering bug, and the sync chip's error path
    // is the visible, retryable place for it. Silently resolving would show the base roster as current.
    if (!hasCalendarAccess()) throw new Error('calendar-access-required');
    const q = query(
        collection(db, COLLECTIONS.overrides),
        where('date', '>=', startStr),
        where('date', '<=', endStr)
    );
    const snapshot = await getDocs(q);
    // THE ANSWER BELONGS TO THE GRANT THAT ASKED FOR IT (CALENDAR_DATA.md 20). The gate above is
    // checked when a read is ISSUED; access can be lost, or lost and granted again, before the answer
    // lands, and an earlier grant's answer must not be written into a locked Calendar or over a month
    // the new grant's own read has just FAILED for. THROWN, not returned, and before either branch
    // below — the cache-served one merges too — so no caller can go on to record a success.
    if (!answerStillWanted(ticket)) {
        throw Object.assign(new Error('Override read outlived the access it was issued under'), { code: READ_SUPERSEDED });
    }
    // ANSWERED BY THE CACHE, NOT THE SERVER (CALENDAR_DATA.md 16). With `persistentLocalCache`,
    // `getDocs` on a dead signal resolves from this device's cache — a possibly-stale SUBSET, possibly
    // empty — which, reconciled authoritatively, would EVICT leave the device held and mark the month
    // current. It is merged the way phase 1 merges (additively, never claiming the month), and then
    // THROWN, so the month is released for a retry and recorded as `cached` — the labelled last-known
    // grid — or `error` if it held nothing.
    if (snapshot.metadata?.fromCache) {
        const held = collectOverrideRecords(snapshot);
        let painted = false;
        for (const { key, from, to } of _monthSlices(startStr, endStr)) {
            if (_monthOwner.has(key)) continue;
            reconcileRangeIntoCache(rosterOverridesCache, held.filter(r => r.date >= from && r.date <= to), from, to, { authoritative: false });
            // A copy only where this device once held the month whole — see `_heldWhole`.
            painted = painted || (_heldWhole(key) && held.some(r => r.date >= from && r.date <= to));
        }
        if (painted) shiftTypesMonthCache.clear();
        throw Object.assign(new Error('Override read was served from the offline cache'), { code: SERVED_FROM_CACHE, painted });
    }
    if (snapshot.size >= 1900) console.warn('[Firestore] Override query returned', snapshot.size, 'docs — approaching practical limit. Consider archiving old overrides.');
    // Collect the validated snapshot rows (override-utils.collectOverrideRecords), then RECONCILE
    // authoritatively: the range query is the single source of truth for [startStr, endStr], so each
    // date's winner is rebuilt from THIS snapshot alone (reconcileRangeIntoCache), never merged against
    // the possibly-stale cache — a merge kept a deleted higher-priority manual alive when only a
    // lower-priority import remained. Dates outside the queried range are untouched.
    const records = collectOverrideRecords(snapshot);
    // Apply month by month, and only where this read is still the newest to have landed. Records are
    // sliced with the range because `reconcileRangeIntoCache` stores EVERY winner it is handed
    // regardless of the range it was told to evict over — passing the whole set per month would write
    // the other months' rows back under a month that may not own them.
    let wrote = false;
    const slices = _monthSlices(startStr, endStr);
    for (const { key, from, to } of slices) {
        if ((_monthOwner.get(key) || 0) > ticket.seq) continue;   // a read issued later already owns this month
        _monthOwner.set(key, ticket.seq);
        reconcileRangeIntoCache(rosterOverridesCache, records.filter(r => r.date >= from && r.date <= to), from, to);
        wrote = true;
    }
    // New override data may change which shift types appear in a month.
    if (wrote) shiftTypesMonthCache.clear();
    // The server answered for every member: this device's cache now holds these months whole.
    _noteHeldWhole(slices.filter(_wholeSlice).map(s => s.key));
}

/**
 * Paint from the LOCAL Firestore cache — no network. This is phase 1 of the calendar's two-phase
 * initial load (AUTH_AND_SESSIONS.md → "The two-phase load (E1)"): it puts no sign-in round trip of its own in front of data the
 * device already holds — though it cannot beat the stored user's `accounts:lookup`, behind which
 * Firestore holds every operation (CALENDAR_DATA.md 10).
 *
 * **It is not "no auth".** Firestore rules are evaluated on the SERVER, so a cache hit never
 * consults them. The read is gated on Calendar access (THE ACCESS GATE, above): the rules stop the
 * NETWORK read, and that check stops this one. Phase 1 still runs before any network read of its
 * own; it runs after the access DECISION, which waits for Firebase to confirm the stored sign-in.
 *
 * **Merged additively — never authoritative.** A cache snapshot is a possibly-stale SUBSET, so an
 * absent key is not a delete. Only the server read (`fetchOverridesForRange`) may evict. See the
 * `authoritative` note on `reconcileRangeIntoCache`.
 *
 * Never throws: a cache miss (first visit, evicted IndexedDB) is the normal empty state, not a
 * failure, and must never reach the sync chip's error path.
 *
 * **Which months it knows is reported PER MONTH.** The boolean answers for the whole range, and the
 * boot window is three months, so one month with rows must not mark all three `cached`.
 * `monthsWithRows`, when passed, receives the key of each month whose slice held at least one cached
 * row AND that this device once held whole (`_heldWhole`), and only those may be called known.
 *
 * @param {string} startStr - 'YYYY-MM-DD' inclusive start
 * @param {string} endStr   - 'YYYY-MM-DD' inclusive end
 * @param {string[]} [monthsWithRows] - filled with the month keys that had cached rows
 * @returns {Promise<boolean>} true if the cache produced anything that changed the display
 */
export async function fetchOverridesForRangeFromCache(startStr, endStr, monthsWithRows) {
    // THE ONE THAT MATTERS. A cache hit never reaches a security rule, so this line — not
    // firestore.rules — is what stops yesterday's overrides painting before today's sign-in. Returns
    // false (paints nothing) rather than throwing, because "no access yet" is indistinguishable to
    // every caller from "no cache yet", which is already this function's normal empty state.
    if (!hasCalendarAccess()) return false;
    const ticket = issueReadTicket();
    try {
        const q = query(
            collection(db, COLLECTIONS.overrides),
            where('date', '>=', startStr),
            where('date', '<=', endStr)
        );
        const snapshot = await getDocsFromCache(q);
        // …AND ASKED AGAIN WHEN THE ANSWER LANDS. The line above guards the moment the read is issued;
        // a Calendar locked before the cache answers must not have yesterday's rows written into it.
        if (!answerStillWanted(ticket)) return false;
        if (snapshot.empty) return false;
        const records = collectOverrideRecords(snapshot);
        // Skip any month a SERVER read has already written. `reconcileRangeIntoCache` ranks records
        // only against each OTHER, never against what is cached, so a local snapshot landing late could
        // overwrite a fresher server record with an older one.
        //
        // It checks ownership without CLAIMING it, and that asymmetry is the point: an authoritative
        // read issued earlier but still in flight must not find its month taken by a non-authoritative
        // one, or the eviction pass — the only thing that removes a deleted override — would be skipped.
        let changed = false;
        for (const { key, from, to } of _monthSlices(startStr, endStr)) {
            if (_monthOwner.has(key)) continue;
            const slice = records.filter(r => r.date >= from && r.date <= to);
            if (slice.length && _heldWhole(key)) monthsWithRows?.push(key);   // see `_heldWhole`
            if (reconcileRangeIntoCache(rosterOverridesCache, slice, from, to,
                    { authoritative: false })) changed = true;
        }
        if (changed) shiftTypesMonthCache.clear();
        return changed;
    } catch {
        return false;   // no cache yet / storage unavailable — phase 2 does the real work
    }
}

/**
 * Ensure overrides for a given month are in the cache.
 * No-op if already fetched. Fires a background fetch and calls renderFn() when it SETTLES — on
 * success, and (once per claim) on failure too: a failed month withholds the grid, so nothing
 * repainting would leave it on "Checking this month" for ever.
 * EVERY caller is called back, not only the one that started the read: a caller arriving while the
 * month is in flight joins it (`_monthWaiters`) — a member switch or a Team View opened mid-flight
 * waits on the same every-member read. The renderFn decides what to repaint; it must not assume the
 * screen is still the one that asked.
 * @param {number} year
 * @param {number} month - 0-indexed
 * @param {Function} [renderFn]
 */
export async function ensureOverridesCached(year, month, renderFn) {
    // Month navigation and the Team Week View both arrive here, so the gate covers them too — and
    // it returns BEFORE claiming the month, or a navigation made while locked would mark the month
    // fetched and the real read after unlocking would be skipped for the rest of the session.
    // INSURANCE, and said so because no test fails without it: the read below is refused as it is
    // issued, its failure stands down (THE READ TICKET), and a grant clears every claim. Kept as the
    // one layer that depends on neither.
    if (!hasCalendarAccess()) return;
    const key = monthKey(year, month);
    if (fetchedMonths.has(key)) {
        // In flight: join it. Settled (or pre-claimed by the initial fetch, which repaints itself):
        // there is no waiter set, and nothing to wait for.
        if (renderFn) _monthWaiters.get(key)?.add(renderFn);
        return;
    }
    fetchedMonths.add(key);
    _recheckOwed.delete(key);   // this read IS the re-check
    // The read's ticket (THE READ TICKET), taken as it is issued and handed to it, so the catch below
    // asks about the very read that failed.
    const ticket = issueReadTicket();
    // Which server answer this device held for the month when this read was issued (0: none). If it
    // is still the same one when the read fails, nothing newer has landed — see the catch.
    const ownerAtIssue = _monthOwner.get(key) || 0;
    /** @type {Set<Function>} */
    const waiters = new Set(renderFn ? [renderFn] : []);
    _monthWaiters.set(key, waiters);
    // Only this read's own set — a re-grant can start a newer read of the month under it.
    const settle = () => { if (_monthWaiters.get(key) === waiters) _monthWaiters.delete(key); };
    try {
        const startStr = formatISO(new Date(year, month, 1));
        const endStr   = formatISO(new Date(year, month + 1, 0));
        await fetchOverridesForRange(startStr, endStr, ticket);
        // The month is now KNOWN. Recorded here because this is the one place that can tell a settled
        // server read from a cache hit — and those two are not the same claim.
        noteKnowledge(key, 'authoritative');
        _settledAt.set(key, Date.now());
    } catch (err) {
        settle();
        // No longer wanted (THE READ TICKET): nothing is recorded against a Calendar locked since,
        // and the grant that holds the Calendar now reads the month for itself.
        if (!answerStillWanted(ticket, err)) return;
        const knownBefore = knowledgeOf(key);   // whether this failure changes it decides the repaint, below
        fetchedMonths.delete(key);  // Allow retry on next navigation
        if (_monthOwner.has(key)) {
            // THIS DEVICE HOLDS THE SERVER'S EARLIER ANSWER, AND THE RE-CHECK FAILED (CALENDAR_DATA.md
            // 18). The grid stays — real data beats none — but as the labelled saved copy, never current.
            //
            // ONLY WHERE THIS FAILURE IS THE NEWEST NEWS. If another read's answer landed for the month
            // while this one was out, a slow, superseded failure must not un-confirm it — the ordering
            // `_monthOwner` keeps for writes, applied to the claim.
            if ((_monthOwner.get(key) || 0) === ownerAtIssue) noteCheckFailed(key);
            // A month forgotten for a retry ("Try again") comes back as the saved copy too, not as
            // the failure panel: pressing the button must not cost the member the grid they had.
            noteKnowledge(key, 'cached');
        } else {
            // A cache-served read that held this month's records is the labelled last-known grid, not a
            // failure; anything else is `error` — actionable, earning a Retry where `unknown` waits.
            noteKnowledge(key, /** @type {any} */ (err)?.code === SERVED_FROM_CACHE && /** @type {any} */ (err).painted ? 'cached' : 'error');
        }
        // ACCESS GONE, not a network blip. Without this a revoked or disabled account (a password
        // reset revokes every device's tokens) would render the month from the base roster on its next
        // navigation — a shift they are not working, with nothing saying so. The initial fetch has the
        // same recovery (calendar-initial-fetch.js); month navigation and Team View come through HERE.
        if (_onAccessLost && _isAccessFailure(err)) {
            setCalendarAccess(false);   // shut before anything can repaint from the cache: the ONE write, so the documents shut with it, and what we knew is forgotten
            try { _onAccessLost(); } catch (e) { console.error('[Calendar] access-lost handler failed', e); }
            return;
        }
        _oweIfSavedCopy(key);   // a saved copy: ask again when the page comes back
        console.error('[Firestore] Failed to fetch overrides for', key, err);
        // Tell the caller to repaint, so a withheld grid can show its failure panel. Once per claim —
        // see `_failureRepainted` for the loop this guards — AND WHENEVER THIS FAILURE CHANGED WHAT THE
        // MONTH IS KNOWN TO BE (found by calendar-sequences.test.mjs): a slow superseded failure could
        // spend the one repaint, so the real failure after it took "current" away and could not say so.
        // That cannot become the loop: between two successes a month's knowledge can change only a few
        // times (unknown → error → cached, or authoritative → cached).
        if (knowledgeOf(key) !== knownBefore || !_failureRepainted.has(key)) { _failureRepainted.add(key); _repaintWaiters(waiters); }
        return;
    }
    settle();
    _failureRepainted.delete(key);   // succeeded — a future failure of this month is news again
    // The render is deliberately OUTSIDE the try. The fetch succeeded and the cache holds the data;
    // a callback throwing mid-DOM-rebuild must not be logged as a fetch failure or un-mark the month.
    // A render fault is the caller's to handle, and since several callers can wait on one read, it
    // must not cost the others their repaint.
    _repaintWaiters(waiters);
}

/** Call every waiter of a settled month read; one that throws is logged, not allowed to stop the rest.
 *  @param {Set<Function>} waiters */
function _repaintWaiters(waiters) {
    for (const fn of waiters) {
        try { fn(); } catch (e) { console.error('[Calendar] repaint after a month read failed', e); }
    }
}

/**
 * Returns a Set of shift-type strings that actually appear in the given month
 * for the given member, after applying roster pattern + Firestore overrides.
 * Used by updateLegend() to show/hide Spare, RDW, AL, and Absent legend items.
 * Result is memoised; cache cleared by fetchOverridesForRange() on new data.
 * @param {any} member
 * @param {number} year
 * @param {number} month - 0-indexed
 * @param {Map<string, any>|null} [snapshot]  the member's stored copy of the month, where the grid draws it
 * @returns {Set<string>}
 */
export function getShiftTypesInMonth(member, year, month, snapshot = null) {
    const cacheKey = `${member.name}|${year}|${month}`;
    // A month drawn from the member's STORED COPY (`snapshot`, day → record) is read from it, exactly
    // as the renderer reads it, and kept out of the cache: the copy is not what the server said, and
    // the live answer must not inherit it.
    if (!snapshot && shiftTypesMonthCache.has(cacheKey)) return shiftTypesMonthCache.get(cacheKey);

    const types = new Set();
    const days  = new Date(year, month + 1, 0).getDate();

    for (let day = 1; day <= days; day++) {
        const date      = new Date(year, month, day);
        const baseShift = getBaseShift(member, date);
        const dateStr   = formatISO(date);
        const ov = isBeforeMemberStart(member, date) ? null
            : snapshot ? snapshot.get(dateStr) ?? null : rosterOverridesCache.get(`${member.name}|${dateStr}`);
        // Same shared override→effective-shift ladder as the calendar renderer + Team view, so the
        // legend can never drift from them — e.g. it can't light 'AL' from a legacy Sunday AL override
        // (Sundays are non-contracted, CLAUDE.md layer 5).
        const { shift } = resolveDayShift(ov, baseShift, isSunday(dateStr), isChristmasLeaveDay(member, date), isChristmasOrBoxingDay(dateStr));
        if (shift === 'SPARE') types.add('SPARE');
        else if (shift === 'RDW')  types.add('RDW');
        else if (shift === 'AL')   types.add('AL');
        else if (shift === 'SICK') types.add('SICK');
        else if (isOtherValue(shift)) types.add('OTHER');
    }

    if (!snapshot) shiftTypesMonthCache.set(cacheKey, types);
    return types;
}
