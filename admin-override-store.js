// @ts-check
/**
 * admin-override-store.js — WHAT ADMIN HAS, HOW IT GETS IT, AND WHAT IT SAYS WHILE GETTING IT.
 *
 * ── WHY IT LEFT THE COORDINATOR (v21.38) ────────────────────────────────────────────────────────
 *
 * `admin-overrides.js` reached its size cap and this was the coherent thing inside it: the override
 * cache, what the cache knows, the Firestore reads that fill it, and the states those reads put on
 * screen. Everything else in that file draws or edits a week; this is the only part that owns DATA.
 *
 * The split was forced by the ratchet rather than chosen, and that is the ratchet working — the file
 * was at its ceiling and the previous release's commit had already said the next substantive change
 * should split it rather than shave a comment off to fit.
 *
 * ── THE RENDERERS ARE INJECTED, AND THAT IS WHAT KEEPS IT ACYCLIC ───────────────────────────────
 *
 * A load finishes by repainting the table, the week grid and the AL/absence banners, all of which
 * live in `admin-overrides.js` and `admin-app.js`. Importing them back would be a cycle
 * (`import-graph.test.mjs` refuses one), so they arrive through `initOverrideStore`. The same shape
 * `initOverrides` already uses for its feedback callbacks.
 *
 * ── THREE THINGS HERE ARE EASY TO GET WRONG AND SILENT WHEN THEY ARE ────────────────────────────
 *
 *   · **The in-flight guard is keyed by the QUERY.** Sharing one flight across different queries
 *     means a member selected during another member's load is never fetched at all — no error, a
 *     week grid stuck on "Loading…", and a Saved Changes card stating they have none.
 *   · **A CAPPED collection read is not a complete one.** It covers the list, which carries a
 *     banner; it never covers a write. See `admin-override-coverage.js`.
 *   · **Waiting and stuck are different states.** Reporting a failed load as "Loading…" is the same
 *     class of false claim as showing an empty week — it just fails in the patient direction.
 *
 * Tested through `admin-overrides.test.mjs` (the write gates) and driven in a browser by
 * `e2e/admin.spec.js` (which query actually runs).
 */

import { db, collection, query, where, orderBy, limit, getDocs, getDoc, doc, runTransaction, writeBatch, whenOwnWritesSent, COLLECTIONS } from './firebase-client.js';
import { sessionReady } from './session.js';
import { manualOverrideId } from './override-id.js';
import { shouldReplaceOverride } from './override-utils.js';
import { sameOverrideRecord } from './override-compare.js';
import { emptyCoverage, withMember, withAll, hasAuthorityFor, coversEveryone, replaceMemberSlice, mergeCappedRead } from './admin-override-coverage.js';

/** @type {any[]} The cache itself. */
let _allOverrides = [];

// ── INJECTED RENDERERS ────────────────────────────────────────────────────────
/** @type {() => void} */            let _renderTable    = () => {};
/** @type {() => void} */            let _renderWeekGrid = () => {};
/** @type {() => boolean} */         let _hasStagedEdits = () => false;
/** @type {() => void} */            let _onAfterLoad    = () => {};

/**
 * @param {object} deps
 * @param {() => void} deps.renderTable
 * @param {() => void} deps.renderWeekGrid
 * @param {() => boolean} deps.hasStagedEdits
 * @param {() => void} deps.onAfterLoad  refreshes the AL/absence banners after a load
 * @returns {void}
 */
export function initOverrideStore({ renderTable, renderWeekGrid, hasStagedEdits, onAfterLoad }) {
    _renderTable    = renderTable;
    _renderWeekGrid = renderWeekGrid;
    _hasStagedEdits = hasStagedEdits;
    _onAfterLoad    = onAfterLoad;
}

// ── INITIAL-LOAD READINESS ────────────────────────────────────────────────────
// Resolves once the FIRST loadOverrides() has SETTLED (success OR failure). Consumers await this so
// they never act on an empty cold cache:
//   • The two WRITE functions (executeSave, recordRangeOverrides) gate INTERNALLY — a save/booking
//     fired before the initial read returns would build decisions from an empty `_allOverrides`:
//     recordRangeOverrides' ovByDate would be {} → the existing roster_import doc for a date isn't
//     deleted (duplicate overrides) and a not-yet-loaded worked Sunday could be erased by an RD
//     correction; executeSave's post-write cache mutation could be clobbered by the in-flight initial
//     snapshot resolving AFTERWARDS (the just-saved change vanishes from the list until reload).
//     Both disable the Save button synchronously before their first await, so the internal gate can't
//     open a double-tap window.
//   • The Change-a-Shift click handler (admin-app.js) gates too, for its PRE-write cache reads —
//     validateShiftRules (the ±1-day rest-gap check via getEffectiveShift) and the AL
//     over-entitlement check — which a cold cache would make wrong (a real <12h gap missed, or a valid
//     save wrongly blocked). It disables Save BEFORE the await (the v16.23 "disable before the first
//     await" invariant) so no double-tap window opens.
//   • The RANGE cards (AL and Absence) gate at the click: until `hasOverrideAuthorityFor(member)` they
//     refuse and say why (admin-range-booking.js, whole-app check, Nov 2026; admin-2-1), so their
//     pre-save reads — the over-entitlement warning, the swap answers, the "left alone" receipt lines —
//     are never built from a cold cache. They had been left ungated on two premises that stopped
//     holding: that the cache is long warm by then (since v21.38 every member switch starts a fresh,
//     staged load), and that a cold miss only SKIPS a warning (since v23.75 the swap answers too).
// Resolving on FAILURE too is deliberate — if the first read errored Firestore is unreachable and the
// write will fail its own commit anyway, better than hanging the Save button forever. loadOverrides()
// is called unconditionally in the AUTHORISED admin-init branch (not the not-signed-in/login branch,
// where sessionReady also never resolves and the login overlay covers the Save button), so a write
// path can't pend on this indefinitely. (v16.85) Every read now waits for `sessionReady` first (see
// `loadOverrides`), which that same branch resolves — and every write path awaits it anyway.
/** @type {(v?: any) => void} */
let _resolveOverridesReady = () => {};
const _overridesReady = new Promise(res => { _resolveOverridesReady = res; });

/** @returns {Promise<void>} Resolves when the initial override load has settled (success or failure). */
export function whenOverridesReady() { return _overridesReady; }

// SUCCESS state, separate from the settled promise above (Finding #2, v16.97). `_overridesReady`
// resolves on FAILURE too (so the Save button never hangs on an unreachable Firestore), but a failed
// initial read leaves `_allOverrides` EMPTY — and the cache-reading write decisions (recordRangeOverrides'
// ovByDate, the click handler's validateShiftRules + AL entitlement) would then silently build from
// nothing: an existing roster_import doc wouldn't be deleted (duplicate overrides), a not-yet-loaded
// worked Sunday could be erased by an RD correction, a real <12h rest gap missed. So those paths ALSO
// check this flag and REFUSE to write on a never-successfully-loaded cache (with a clear "reload" message),
// rather than corrupt data. Set true by a successful loadOverrides OR an explicit setAllOverrides; once
// true it stays true (a later refresh failure leaves the last-good data intact — safe to keep writing).
//
// ── IT IS A COVERAGE RECORD, NOT A FLAG (v21.38, external review) ───────────────────────────────
//
// It was a boolean, and that was honest while the load fetched the entire collection: succeeding
// meant knowing everything about everybody. The load is now staged — the SELECTED MEMBER on the
// critical path, everyone else only when the All-staff view asks — so "the load succeeded" and "we
// know about this member" became different questions, and answering the second with the first would
// re-open every failure listed above on the one path least likely to be tested: a member selected
// before their slice has arrived.
//
// The rules live in `admin-override-coverage.js`, pure and tested, because an empty slice and an
// unfetched member are indistinguishable by looking at the data — which is exactly why the data is
// never the thing asked.
/** @type {import('./admin-override-coverage.js').Coverage} */
let _coverage = emptyCoverage();

/** @returns {boolean} True once the override cache has been authoritatively populated at least once.
 *  A TEST SEAM: nothing in the app asks it any more; a WRITE must ask `hasOverrideAuthorityFor`. */
export function isOverrideCacheLoaded() { return _coverage.all || _coverage.members.length > 0; }

/** @param {string|null|undefined} member @returns {boolean} May a decision about this member be
 *  built from the cache? The question every write gate asks. */
export function hasOverrideAuthorityFor(member) { return hasAuthorityFor(_coverage, member); }

// `hasAllStaffAuthority()` lived here too — a second export with a byte-identical body to
// `coversAllStaff()` below (v21.41). Two names for one question is how a reader ends up believing
// they mean different things: the comment in `admin-saved-changes.js` said this one "was written for
// exactly this and, until now, called from nowhere", while the line beneath it called the other.
// Both halves of that were true, which is the problem. One name, one answer.

// Saved-Changes list query cap. orderBy('date','desc') + this limit means the NEWEST 5000 overrides
// load; beyond that the oldest aren't fetched. `_overridesTruncated` records a cap hit so renderTable
// can tell the admin the list is partial rather than silently showing a subset (Finding #8, v16.99).
export const OVERRIDES_QUERY_CAP = 5000;
let _overridesTruncated = false;

// ── PUBLIC STATE ACCESSORS ────────────────────────────────────────────────────
export function getAllOverrides()    { return _allOverrides; }

/**
 * Replace the cache through a transform, WITHOUT touching what the cache claims to know.
 *
 * The one door for the post-write cache updates. They rearrange rows; they learn nothing — so
 * routing them through `setAllOverrides` (which asserts completeness) would make a save or a delete
 * silently grant authority over every member. That bug shipped once already in this release.
 * @param {(rows: any[]) => any[]} fn
 * @returns {void}
 */
export function mutateCache(fn) { _allOverrides = fn(_allOverrides); }

/** @returns {boolean} True when the collection has been read — capped or complete. The LIST's
 *  question, never a write's. */
export function coversAllStaff() { return coversEveryone(_coverage); }

/** @param {string} member @returns {boolean} Did this member's last load FAIL? */
export function loadFailedFor(member) { return _loadFailedFor.has(member); }

/** @returns {boolean} Did the last collection read hit the query cap? */
export function isTruncated() { return _overridesTruncated; }
/** @param {any[]} arr */
export function setAllOverrides(arr) {
    _allOverrides = arr;
    // A TEST SEAM: nothing in the app calls it — the delete paths drop rows through `removeFromCache`
    // (v21.38). Setting the cache to a known state is itself a "ready" signal, which is what lets the
    // write-path unit tests seed the cache this way and still pass the whenOverridesReady() gate. (v16.85)
    // AN ASSERTION OF COMPLETENESS, so it grants FULL coverage (Finding #2). Use it only when the
    // array genuinely is the whole cache — seeding a test, or replacing everything. To DROP rows,
    // use `removeFromCache`: a delete learns nothing and must not widen what the cache claims.
    _coverage = withAll(_coverage);
    _resolveOverridesReady();
}

/** Is this cached row a MANUAL record of this member's date? @param {any} o @param {string} m @param {string} d */
const _isManualOn = (o, m, d) => o.memberName === m && o.date === d && (o.source || '') !== 'roster_import';

/**
 * The documents a MANUAL write of this member's date replaces (v24.48): whatever won the day — an
 * import, say — and every manual record of it, a pre-v24.48 duplicate included; never the fixed id
 * the write itself lands on (`manualOverrideId`), which it overwrites rather than deletes.
 * @param {string} memberName @param {string} date @param {string|null|undefined} winnerId @returns {string[]}
 */
export function idsReplacedBy(memberName, date, winnerId) {
    const ids = new Set([winnerId, ..._allOverrides.filter(o => _isManualOn(o, memberName, date)).map(o => o.id)]);
    ids.delete(manualOverrideId(memberName, date));
    return [...ids].filter(Boolean);
}

/**
 * Ids being DELETED, widened by the manual duplicates each one OUTRANKS — the copies that would
 * resurface the moment it went (v24.48). Only those: until v24.53 this took every manual record of
 * the day, so deleting the stale copy also deleted the one on screen, under a receipt that called it
 * "older". Precedence is `shouldReplaceOverride`, the same rule that decides what the day shows. An
 * import is deleted alone: it is not a duplicate of anything.
 * @param {Iterable<string>} ids @returns {Set<string>}
 */
export function withManualDuplicates(ids) {
    /** `r` beats `o` STRICTLY. On an exact tie `shouldReplaceOverride` says yes both ways, and a
     *  delete of either copy took both (v24.57, review) — so a tie goes to the larger id, one way. */
    const _outranks = (/** @type {any} */ r, /** @type {any} */ o) =>
        shouldReplaceOverride(o, r) && (!shouldReplaceOverride(r, o) || String(r.id) > String(o.id));
    const out = new Set(ids);
    for (const id of [...out]) {
        const r = _allOverrides.find(o => o.id === id);
        if (!r || (r.source || '') === 'roster_import') continue;
        _allOverrides.filter(o => o.id !== r.id && _isManualOn(o, r.memberName, r.date) && _outranks(r, o))
            .forEach(o => out.add(o.id));
    }
    return out;
}

/**
 * What a delete of `picked` removes, as chunks of at most `size` ids that NEVER SPLIT A DAY (v25.89,
 * review): each picked row travels with the older copies it outranks (`withManualDuplicates`). A
 * delete that stops part way — a colleague's edit refusing a later chunk — must not take a row and
 * leave its older copy behind to resurface as the day's value, under a count that called it deleted.
 * @param {string[]} picked @param {number} size @returns {string[][]}
 */
export function deleteChunks(picked, size) {
    const seen = new Set();
    /** @type {string[][]} */
    const chunks = [];
    for (const id of picked) {
        const day = [...withManualDuplicates([id])].filter(x => !seen.has(x));
        day.forEach(x => seen.add(x));
        const last = chunks.at(-1);
        if (!day.length) continue;
        if (last && last.length + day.length <= size) last.push(...day); else chunks.push(day);
    }
    return chunks;
}

/**
 * Drop deleted rows from the cache WITHOUT widening what the cache claims to know.
 *
 * The distinction `setAllOverrides` cannot make (v21.38). That one is an assertion of completeness —
 * "this array is the whole cache" — and it grants full coverage. A delete is the opposite operation:
 * it removes data and learns nothing. Routing a delete through the assertion made the cache claim it
 * held every member the moment anybody deleted a booking, so the next "All staff" view would have
 * rendered from one member's slice and called it everybody.
 * @param {Set<string>|string[]} ids Firestore document IDs that no longer exist
 * @returns {void}
 */
export function removeFromCache(ids) {
    const set = ids instanceof Set ? ids : new Set(ids);
    _allOverrides = _allOverrides.filter(o => !set.has(o.id));
}


// ── ONE LOAD AT A TIME, BUT NEVER THE WRONG ONE (v21.38, hardened after review) ─────────────────
//
// The first cut kept a single in-flight promise and returned it to any caller. That is right for a
// RETRY of the same query — two snapshots resolving out of order would let the older win, the
// eviction bug the Calendar had to fix in `_monthOwner` — and it was wrong the moment `opts` began
// naming WHICH query. A second member selected during the first member's load got that load's
// promise, so their slice was never fetched and never would be: the week grid sat on "Loading this
// member's saved changes…" for ever with no error, while Saved Changes stated they had none.
//
// So the guard is keyed by the query. Same key → share the flight. DIFFERENT key → CHAIN behind it,
// which both guarantees the query runs and keeps the writes ordered, so a collection read can never
// land on top of a member read it started before.
/** @type {Promise<void>|null} */
let _loadInFlight = null;
/** @type {string|null} */
let _loadInFlightKey = null;

/** Which members' last load FAILED. A failure is not the same as "not fetched yet" — one is waiting
 *  and one is stuck — and the surfaces that report them have to say different things. */
const _loadFailedFor = new Set();

/** @returns {Promise<void>} settles when any in-flight load has finished. Awaited by the write paths
 *  so a wholesale collection read cannot resolve on top of a just-committed cache mutation. */
export function whenLoadSettled() { return _loadInFlight ?? Promise.resolve(); }

/**
 * Load override documents into `_allOverrides`, then render the table, week grid and banners.
 *
 * STAGED: the selected member on the critical path, everyone else only when the All-staff view asks.
 * Why one member is the right scope — and why a date window is not — is argued in
 * `admin-override-coverage.js`, which owns the concept.
 *
 * `everyone` defaults to whatever the cache already claims, so once an admin has opened All staff,
 * later resyncs keep the list whole rather than silently narrowing it under them.
 *
 * NO READ BEFORE THE SESSION (whole-app check, Nov 2026). The page calls this the moment it boots,
 * and on an iPhone that is often BEFORE it is signed in: Firebase can restore no user behind a valid
 * local session, so the page signs in silently (`ensureFirebaseSession`), and Firestore holds a read
 * only until Auth has STARTED, not until that sign-in lands. The read went out with no credential,
 * the rules refused it, and nothing read again — "Couldn't load" on a page whose session was fine.
 * After boot `sessionReady` has long resolved, so this costs a later read nothing.
 * @param {{ everyone?: boolean, member?: string }} [opts]
 * @returns {Promise<void>}
 */
export async function loadOverrides(opts = {}) {
    const fieldMember = /** @type {HTMLSelectElement|null} */ (document.getElementById('fieldMember'));
    const everyone = opts.everyone ?? coversEveryone(_coverage);
    const member   = opts.member ?? fieldMember?.value ?? '';
    const key      = everyone ? '*' : member;
    if (_loadInFlight && _loadInFlightKey === key) return _loadInFlight;
    const prev = _loadInFlight;
    const run = (prev ? prev.catch(() => {}) : Promise.resolve())
        .then(() => sessionReady)
        .then(() => _loadOverridesInner({ everyone, member }))
        .finally(() => { if (_loadInFlight === run) { _loadInFlight = null; _loadInFlightKey = null; } });
    _loadInFlight    = run;
    _loadInFlightKey = key;
    return run;
}

/** The error code a read served from the OFFLINE CACHE is turned into. */
const CACHED_READ = 'served-from-cache';

/**
 * A read the SERVER did not answer is not a load (v24.48, external review).
 *
 * Firestore runs here with `persistentLocalCache`, so on a dead signal `getDocs` does not fail — it
 * resolves from this device's cache, which holds only what this device happened to read before, and
 * can be EMPTY. Granting coverage from that told Admin "this member has no saved changes" and let a
 * save go ahead on it: a booking it cannot see is a booking it does not delete, and a leave balance
 * worked out from a partial list is too generous by exactly the days it is missing.
 *
 * So it is a FAILED load, through the failure path every surface already handles — the week grid's
 * failed state, Retry, and the save refusal — and not cached rows shown as though complete. Nothing
 * in Admin can tell a whole cache from a partial one, which is the whole problem.
 * @param {any} snap
 */
function refuseCachedRead(snap) {
    if (snap?.metadata?.fromCache) throw Object.assign(new Error('Overrides read was served from the offline cache'), { code: CACHED_READ });
}

// ── A DELETE MAY NOT DESTROY A NEWER EDIT (Oct 2026 production review; ONE transaction, v25.89) ───
// Admin's cache is read once and never refreshes on its own, and since v24.48 a manual record has
// ONE id per member and day. So a manager deleting a row they saw this morning deleted the document
// a colleague had since rewritten under that same id — silently, with a receipt saying "Deleted AL
// day". So every delete compares what it removes with what this page showed, and refuses on any
// difference. A delete was the first write checked this way, because it cannot see what it removes;
// since v25.90 an ordinary save is checked too whenever the server can be asked (`commitChecked`, below).
//
// THE COMPARISON AND THE DELETE ARE ONE TRANSACTION (v25.89, external review, Nov 2026). They were a
// re-read and then a separate batch, and a colleague's edit landing in the milliseconds between the
// two was deleted anyway — reproduced. Inside a transaction Firestore re-runs the comparison whenever
// a document it read changes before the commit, so the two can no longer be separated. And the
// comparison is now the whole record (`sameOverrideRecord`), not three fields of it. The price is the
// network: a transaction is never held on the device, so a delete needs a connection — as the
// separate re-read already did.

/** What a delete refused because the day changed underneath it says. TRUE only of one transaction:
 *  a bulk delete that refuses after some of its chunks has its own words (admin-saved-changes.js). */
export const CHANGED_ELSEWHERE_LINE = 'Someone else has changed this since your list loaded, so nothing was deleted. Reload the page to see the latest, then try again.';
/** What a delete refused because the check could not reach the server says. */
export const UNCHECKED_DELETE_LINE = "Couldn't check for newer changes, so nothing was deleted. Reconnect and try again.";

/**
 * The cached rows whose server copy is no longer the record this page showed — or that the server
 * cannot vouch for. A row the server no longer holds is not a difference: it is already gone.
 * A PRE-CHECK, outside any transaction, so what it approves can still change before a delete lands:
 * the bulk delete runs it first so that a list several chunks long is refused whole rather than part
 * deleted, and each chunk is then checked again inside its own transaction (`deleteIfUnchanged`).
 * @param {Array<{id: string}>} rows
 * @returns {Promise<Array<any>>}
 */
export async function findChangedSince(rows) {
    /** @type {any[]} */
    const changed = [];
    for (let i = 0; i < rows.length; i += 20) {
        const part = rows.slice(i, i + 20);
        const snaps = await Promise.all(part.map(r => getDoc(doc(db, COLLECTIONS.overrides, r.id))));
        snaps.forEach((/** @type {any} */ snap, /** @type {number} */ j) => {
            refuseCachedRead(snap);
            if (!snap.exists()) return;
            const now = /** @type {any} */ (snap.data()), was = part[j];
            if (!sameOverrideRecord(was, now)) changed.push({ ...was, now });
        });
    }
    return changed;
}

/**
 * Null when the rows may be deleted; otherwise the line to show the person who asked. Each item is
 * either the ROW the page showed (best: captured before any reload) or an id, looked up in the
 * cache. An id the cache cannot resolve is skipped — there is nothing shown to compare against.
 * @param {Iterable<string|{id: string}>} items
 * @returns {Promise<string|null>}
 */
export async function staleDeleteVerdict(items) {
    const byId = new Map(_allOverrides.map(o => [o.id, o]));
    const rows = [...items].map(x => (typeof x === 'string' ? byId.get(x) : x)).filter(Boolean);
    try {
        return (await findChangedSince(/** @type {any[]} */ (rows))).length ? CHANGED_ELSEWHERE_LINE : null;
    } catch {
        return UNCHECKED_DELETE_LINE;
    }
}

/** The code a refused delete or rewrite throws with; its `line` is what to show. */
export const DELETE_REFUSED = 'overrides/delete-refused';

/**
 * The rows as this page shows them NOW, for `ids` — called at the moment the person acts, before any
 * await a load could land in, so the comparison is with what they SAW rather than with whatever a
 * later read put in the cache. An id the cache does not hold stays an id.
 * @param {Iterable<string>} ids @returns {Array<string|any>}
 */
export function asShown(ids) {
    const byId = new Map(_allOverrides.map(o => [o.id, o]));
    return [...ids].map(id => byId.get(id) ?? id);
}

/**
 * Commit `write`'s writes in ONE transaction that first re-reads every document they delete or
 * overwrite, and REFUSES — writing nothing, `DELETE_REFUSED` with `line` — unless each is still what
 * this page holds for it (v25.89). `items` are those documents: a ROW as the page showed it (best —
 * `asShown`), or an id, looked up in the cache now. On the server each must be:
 *  - for a row: the same record (`sameOverrideRecord`), or gone — a document already deleted is no
 *    difference — unless its id is in `mustExist`, for a rewrite that depends on it being there;
 *  - for an id the cache does not hold: nothing at all, because a record there is one this page
 *    never showed anybody.
 * Every read comes before any write, as Firestore requires; and when a document read here changes
 * before the commit, Firestore runs the whole function again, so a colleague's edit landing after the
 * read meets the comparison on the re-run instead of slipping under it.
 *
 * ITS OWN WRITE IS NOT A COLLEAGUE'S (v25.89, review). Firestore also re-runs the function after a
 * commit whose ANSWER was lost (`unavailable`, `deadline-exceeded`), and the commit may have landed:
 * the re-run then reads this call's own write. A delete meets nothing there, which is no difference;
 * a REWRITE meets a record that is no longer the one the page showed, and would say "nothing was
 * saved" about a save that was made. `alreadyDone(latest)` answers that: when it holds, the server
 * already says what this commit would, so nothing is written and nothing refused — `done` says so.
 *
 * An id in `mustBeAbsent` (v25.90) must hold NOTHING on the server, whatever the cache holds under it
 * now: the fixed id of a day whose row showed no record there, where a colleague's save of the same
 * day lands — and a read since can have put it in the cache, which would then expect it. A row given
 * for the same id still wins. `line` may be a function of the DATES that changed, to name them.
 *
 * THIS DEVICE'S OWN UNSENT SAVES GO FIRST (v25.95; a KNOWN_LIMITATIONS entry at v25.94). A save made
 * offline waits in the device's queue and shows as saved, but the transaction reads the SERVER. Just
 * after the signal returned, a delete of such a record found nothing, said "Deleted", and the queued
 * save then put the record back. So the transaction starts only once the queue has drained
 * (`whenOwnWritesSent`, claim-retry.js → `ownWritesSent`); one that has not drained in time ends as a
 * transaction that never reached the server does, `unavailable` — `commitChecked` then holds a save
 * that only writes BEHIND the queue, and a removal is refused, writing nothing.
 * @param {Iterable<string|{id: string}>} items
 * @param {(tx: any, latest: Map<string, any>) => void} write  adds the writes to `tx`; `latest` is each
 *        id's server data (or null) as this attempt read it — called again on every re-run
 * @param {{ mustExist?: Iterable<string>, mustBeAbsent?: Iterable<string>, line?: string|((dates: string[]) => string),
 *           alreadyDone?: ((latest: Map<string, any>) => boolean)|null }} [opts]
 * @returns {Promise<{ done: boolean, latest: Map<string, any> }>} `done`: nothing written, as nothing
 *          needed to be; `latest`: the server's copies as the attempt that finished read them
 */
export async function commitIfUnchanged(items, write, { mustExist = [], mustBeAbsent = [], line = CHANGED_ELSEWHERE_LINE, alreadyDone = null } = {}) {
    const byId = new Map(_allOverrides.map(o => [o.id, o]));
    /** @type {Map<string, any>} the record shown for each id, or null for "nothing shown here" */
    const expected = new Map();
    const fromRow = new Set();
    for (const x of items) {
        const id = typeof x === 'string' ? x : x.id;
        if (typeof x !== 'string') { expected.set(id, x); fromRow.add(id); }   // a row as shown always wins
        else if (!expected.has(id)) expected.set(id, byId.get(id) ?? null);
    }
    for (const id of mustBeAbsent) if (!fromRow.has(id)) expected.set(id, null);
    const required = new Set(mustExist);
    let done = false;
    /** @type {Map<string, any>} */
    let latest = new Map();
    if (!(await whenOwnWritesSent())) {
        throw Object.assign(new Error('this device still has saves it has not sent'), { code: 'unavailable', unsent: true });
    }
    await runTransaction(db, async (/** @type {any} */ tx) => {
        const ids = [...expected.keys()];
        const snaps = await Promise.all(ids.map(id => tx.get(doc(db, COLLECTIONS.overrides, id))));
        latest = new Map(ids.map((id, i) => [id, snaps[i].exists() ? snaps[i].data() : null]));
        done = false;
        const changed = ids.filter(id => {
            const now = latest.get(id), was = expected.get(id);
            return was === null ? now !== null : now === null ? required.has(id) : !sameOverrideRecord(was, now);
        });
        if (changed.length) {
            if (alreadyDone?.(latest)) { done = true; return; }
            const dates = [...new Set(changed.map(id => expected.get(id)?.date ?? latest.get(id)?.date).filter(Boolean))].sort();
            const text = typeof line === 'function' ? line(dates) : line;
            throw Object.assign(new Error(text), { code: DELETE_REFUSED, line: text, dates });
        }
        write(tx, latest);
    });
    return { done, latest };
}

/**
 * Delete `items` only if each is still what this page showed — ONE transaction, so all of them or
 * none. The one delete every Admin surface makes (Saved Changes, a booked period, the bulk delete's
 * chunks); the week-grid save, which deletes and writes in one commit, calls `commitIfUnchanged`.
 * @param {Iterable<string|{id: string}>} items rows as shown (`asShown`), or ids
 * @returns {Promise<void>}
 */
export async function deleteIfUnchanged(items) {
    const list = [...items];
    await commitIfUnchanged(list, (tx) => {
        for (const x of list) tx.delete(doc(db, COLLECTIONS.overrides, typeof x === 'string' ? x : x.id));
    });
}

// ── AN ORDINARY SAVE IS CHECKED TOO, WHENEVER THE SERVER CAN BE ASKED (v25.90) ────────────────────
// Until v25.90 only a save that DELETED was checked, so when two managers saved one day the later
// save stood and nobody told its author the day had changed under them ("Two editors on one day",
// KNOWN_LIMITATIONS.md). Now every Admin save of a day — the week grid's and a leave or absence
// range's — commits through `commitChecked`: ONLINE, in one transaction that refuses, writing
// nothing, unless each day it writes still holds what this page showed; OFFLINE, as a batch held on
// the device and sent when the signal returns, unchecked, as every save was before. Offline-first is
// the older promise, and a device that cannot reach the server cannot ask it anything.
//
// What a day must still hold is what its caller SHOWED (`shownFor`): the record the day was drawn
// from, still there and unchanged — and nothing at the day's fixed id (override-id.js), where a
// colleague's save of the same day lands, unless that record is the one shown.
//
// "Online" is a guess until the server answers: `navigator.onLine` is true on a phone with full bars
// and no data. So a transaction that ends without reaching the server — Firestore has tried five
// times over about eight seconds by then — is taken as offline and the save is held instead. A last
// attempt whose commit landed with its answer lost is then written again: the same records at the
// same fixed ids, which changes nothing but their timestamp. The same is true when this device's
// earlier saves have not reached the server in time (v25.95, `commitIfUnchanged`): the held batch
// joins the queue behind them, so they land in the order they were made.

/** How a transaction ends when it never reached the server. */
const NO_SERVER = new Set(['unavailable', 'deadline-exceeded']);

/**
 * Commit an ordinary save of days (v25.90): checked in ONE transaction when the server can be
 * reached, held on the device as a batch when it cannot. `write` adds the save to either — every
 * `set` a day's record at its fixed id, every `delete` a copy it replaces or a day it removes — and
 * is first run against a recorder, so the check knows each document the save touches from the save
 * itself, and recognises the save's own records after a lost answer (`commitIfUnchanged`).
 * @param {(w: any) => void} write
 * @param {{ shownFor: (memberName: string, date: string) => any, removed?: Iterable<string|{id: string}>,
 *           line: string|((dates: string[]) => string), holdOffline?: boolean }} opts  `shownFor`: the record
 *        the page showed for a day this save writes, or null; `removed`: the days it removes, as
 *        `commitIfUnchanged` takes them; `holdOffline: false` for a save that removes any — with no
 *        server such a save is refused, writing nothing, as a removal has been since v25.89; never held unchecked
 * @returns {Promise<{ checked: boolean, done: boolean }>} `checked` false: held unchecked, offline;
 *          `done`: the server already held exactly this save, so nothing was written
 */
export async function commitChecked(write, { shownFor, removed = [], line, holdOffline = true }) {
    if (!holdOffline || globalThis.navigator?.onLine !== false) {
        /** @type {Map<string, any>} */ const sets = new Map();
        /** @type {Set<string>} */ const deletes = new Set();
        write({ set: (/** @type {any} */ ref, /** @type {any} */ data) => sets.set(ref.id, data),
            delete: (/** @type {any} */ ref) => deletes.add(ref.id) });
        /** @type {Array<string|any>} */ const items = [...removed, ...deletes];
        /** @type {string[]} */ const mustExist = [];
        /** @type {string[]} */ const mustBeAbsent = [];
        for (const [id, data] of sets) {
            const shown = shownFor(data.memberName, data.date) ?? null;
            if (shown?.id) { items.push(shown); mustExist.push(shown.id); }
            if (shown?.id !== id) { items.push(id); mustBeAbsent.push(id); }
        }
        // The server already holds this save: every record as written (bar its stamp, which only the
        // server knows) and every deleted copy gone. Never true of an empty save — an empty `every`
        // would call a refusal done.
        const stamp = new Date();
        const alreadyDone = (/** @type {Map<string, any>} */ latest) => sets.size > 0
            && [...sets].every(([id, data]) => sameOverrideRecord({ ...data, createdAt: stamp }, latest.get(id)))
            && [...deletes].every(id => latest.get(id) == null);
        try {
            const { done } = await commitIfUnchanged(items, write, { mustExist, mustBeAbsent, line, alreadyDone });
            return { checked: true, done };
        } catch (err) {
            if (!holdOffline || !NO_SERVER.has(/** @type {any} */ (err)?.code)) throw err;
        }
    }
    const batch = writeBatch(db);
    write(batch);
    await batch.commit();
    return { checked: false, done: false };
}

// ── MOVING A DAY BETWEEN ALLOWANCES REWRITES IT AS LEAVE, SO IT CHECKS FIRST (v25.18) ────────────
// The choice of which year's allowance a January leave day comes out of (leave-year.js) is saved as
// a fresh annual-leave record for the day. On a page loaded this morning that would RESURRECT leave
// cancelled on another device since, or write leave over a shift a manager has just given — a stale
// page creating a day off nobody booked. So the save goes through `commitIfUnchanged`
// (admin-leave-year-save.js): the record shown must still be there and unchanged, and the fixed
// manual id it lands on must hold nothing this page has not loaded. One transaction since v25.89: it
// was a re-read and then a separate batch, and a shift saved between the two was turned back into
// leave (external review, Nov 2026).

/** What a refused choice says when the day has changed since the page loaded. */
export const LEAVE_YEAR_CHANGED_LINE = 'This day has changed since the page loaded, so nothing was saved. Reload the page to see the latest, then try again.';

/** @param {{ everyone: boolean, member: string }} opts @returns {Promise<void>} */
async function _loadOverridesInner(opts) {
    const member = opts.member ?? '';
    const everyone = opts.everyone ?? false;
    const tableBody = document.getElementById('overrideTableBody');
    const listCount = document.getElementById('listCount');
    const fieldMember = /** @type {HTMLSelectElement|null} */ (document.getElementById('fieldMember'));
    // Nobody selected and not asking for everyone: there is no query to run, and pretending to have
    // loaded would grant authority over a member we never read.
    if (!everyone && !member) { _resolveOverridesReady(); return; }
    // Shimmer skeleton (v16.73) — three placeholder rows shaped like the cards being fetched.
    // role="status" + visually-hidden text keeps it announced for screen readers.
    if (tableBody) tableBody.innerHTML =
        '<div role="status"><span class="visually-hidden">Loading saved changes…</span></div>'
        + '<div class="skeleton-row" aria-hidden="true"></div>'.repeat(3);
    try {
        if (everyone) {
            // Fetch CAP+1 (orderBy date DESC) so "genuinely more than CAP exist" is distinguishable from
            // "exactly CAP" — the +1 row only returns in the former case (mirrors getClientErrors' limit+1
            // truncation probe, so the banner never false-alarms at exactly CAP).
            const snap = await getDocs(query(collection(db, COLLECTIONS.overrides), orderBy('date', 'desc'), limit(OVERRIDES_QUERY_CAP + 1)));
            refuseCachedRead(snap);
            /** @type {any[]} */ const rows = [];
            snap.forEach(/** @param {any} d */ d => rows.push({ id: d.id, ...d.data() }));
            // More than CAP means the OLDEST overrides beyond it aren't shown — surface that rather than
            // silently showing a partial list (no-silent-caps). Trim the probe row so the list is exactly the
            // CAP newest; editing recent dates is unaffected, only very old bookings are omitted. (Finding #8)
            _overridesTruncated = snap.size > OVERRIDES_QUERY_CAP;
            if (_overridesTruncated) {
                rows.length = OVERRIDES_QUERY_CAP;   // drop the +1 probe row (already date-desc sorted)
                console.warn(`[Admin] Override query hit the ${OVERRIDES_QUERY_CAP}-doc cap — oldest overrides not loaded. Consider archiving old overrides.`);
            }
            // Capped: keep what individually-read members hold from beyond the cap (review A12).
            _allOverrides = _overridesTruncated ? mergeCappedRead(_allOverrides, rows, _coverage.members) : rows;
            // A CAPPED read covers the LIST, never a write — see admin-override-coverage.js.
            _coverage = withAll(_coverage, { complete: !_overridesTruncated });
            // So a member on screen whom only an earlier COMPLETE read covered has just lost cover, with no
            // read of their own coming: their week sat on "Loading…" for ever. Queue one (whole-app check, Nov 2026).
            const onScreen = fieldMember?.value;
            if (onScreen && !hasAuthorityFor(_coverage, onScreen)) loadOverrides({ everyone: false, member: onScreen });
        } else {
            // ONE MEMBER, EVERY DATE. No cap and no truncation flag: a single member cannot approach
            // the collection cap, so the partial-list banner would be claiming something untrue.
            const snap = await getDocs(query(collection(db, COLLECTIONS.overrides), where('memberName', '==', member)));
            refuseCachedRead(snap);
            /** @type {any[]} */ const fresh = [];
            snap.forEach(/** @param {any} d */ d => fresh.push({ id: d.id, ...d.data() }));
            // A replace, not a merge — the read is authoritative for this member, so a document it
            // does not contain has been deleted and must not survive in the cache.
            _allOverrides = replaceMemberSlice(_allOverrides, member, fresh);
            _coverage = withMember(_coverage, member);
            _loadFailedFor.delete(member);
        }
        // NEWEST FIRST, WHICHEVER READ FILLED IT (whole-app check, Nov 2026; admin-2-3). The member read has no
        // `orderBy`, so the list came in document-id order — no date order at all — until a save sorted it.
        _allOverrides.sort((a, b) => String(b.date).localeCompare(String(a.date)));
        _renderTable();
        const fieldDate = /** @type {HTMLInputElement|null} */ (document.getElementById('fieldDate'));
        // Do NOT re-render over staged edits: on a slow first load the admin can already have
        // rendered the grid (from the empty cache) and selected pills — an unconditional
        // renderWeekGrid() here rebuilt every row and silently discarded them, while
        // userMadeChanges stayed true (blocking the week swipe + a phantom beforeunload warning).
        // The cache is updated either way; edits re-sync on the next save/navigation (v16.69).
        if (fieldMember?.value && fieldDate?.value && !_hasStagedEdits()) _renderWeekGrid();
        _onAfterLoad();
    } catch (err) {
        console.error('[Admin] Load failed:', err);
        if (!everyone && member) _loadFailedFor.add(member);
        // The week grid is the DEFAULT focused card, so it is where the admin is looking — and it
        // was saying "Loading…" over a load that had already stopped, with the only retry inside a
        // card that ships collapsed. Repaint it into its own failed state (v21.38, review) — unless
        // edits are staged: those rows belong to a member already loaded, and a failed refresh must
        // not wipe them (review A10).
        if (!_hasStagedEdits()) _renderWeekGrid();
        if (tableBody) {
            // RETRY, NOT RELOAD (v21.38, external review). The refusal to render a list we could not
            // read is right and stays; throwing away the whole page to fix one failed query was not.
            // A reload re-runs sign-in, the SW handshake and every other card on the page to recover
            // from something that is usually one dropped request — and it discards any staged edits
            // in the week grid, which is a worse outcome than the error it is recovering from.
            const offline = /** @type {any} */ (err)?.code === CACHED_READ;
            tableBody.innerHTML = `<div class="override-state">${offline
                ? 'You\'re offline — saved changes can\'t be checked until you reconnect.'
                : 'Couldn\'t load saved changes.'}<br><span class="reload-link" id="retryLoadLink" role="button" tabindex="0">↻ Retry</span></div>`;
            const retry = document.getElementById('retryLoadLink');
            // No captured member: after a member switch it would re-fetch the member the admin has
            // already left. Re-resolve from the page at the moment Retry is pressed. But a failed
            // MEMBER read retries as a member read: left to the default, a session that had made a
            // capped "All staff" read re-read the capped collection, which never covers the member,
            // so Retry redrew the same failure for ever (whole-app check, Nov 2026).
            const again = () => { loadOverrides({ everyone }); };
            // Back online, it tries again by itself — the offline case is the one with a known cure.
            if (offline) window.addEventListener('online', again, { once: true });
            retry?.addEventListener('click', again);
            retry?.addEventListener('keydown', /** @param {KeyboardEvent} e */ e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); again(); }
            });
        }
        if (listCount) listCount.textContent = 'Error';
    } finally {
        // Signal write paths that the initial cache read has settled (idempotent — later
        // loadOverrides() calls after saves/resyncs re-resolve the already-resolved promise, a no-op).
        _resolveOverridesReady();
    }
}

/**
 * Ensure the cache holds this member authoritatively, fetching if it does not.
 *
 * The member-change path's entry point. A no-op — and importantly a SYNCHRONOUSLY-resolved one —
 * when the member is already covered, so switching back to somebody already loaded costs nothing
 * and does not flash a loading state.
 * @param {string} member
 * @returns {Promise<void>}
 */
export async function ensureMemberLoaded(member) {
    if (hasAuthorityFor(_coverage, member)) return;
    await loadOverrides({ everyone: false, member });
}

