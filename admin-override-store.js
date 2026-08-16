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
 * `e2e/pages.spec.js` (which query actually runs).
 */

import { db, collection, query, where, orderBy, limit, getDocs, COLLECTIONS } from './firebase-client.js';
import { emptyCoverage, withMember, withAll, hasAuthorityFor, coversEveryone, replaceMemberSlice } from './admin-override-coverage.js';

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
// The ONE deliberately-ungated read is the AL RANGE-booking over-entitlement WARNING
// (admin-al.js checkEntitlement, via admin-range-booking's preSave): gating it safely is
// disproportionately risky (its confirm bar re-triggers the same Save button via
// triggerConfirmedALSave → click, so disabling it there would break the confirm→save flow), and a
// cold miss only SKIPS a warning — the write itself is still correct (recordRangeOverrides self-gates)
// and by the time an admin has built a range booking the cache is long warm.
// Resolving on FAILURE too is deliberate — if the first read errored Firestore is unreachable and the
// write will fail its own commit anyway, better than hanging the Save button forever. loadOverrides()
// is called unconditionally in the AUTHORISED admin-init branch (not the not-signed-in/login branch,
// where sessionReady also never resolves and the login overlay covers the Save button), so a write
// path can't pend on this indefinitely. (v16.85)
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
 *  Kept as the page-wide "has anything loaded" signal; a WRITE must ask `hasOverrideAuthorityFor`. */
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
    // Explicitly setting the cache to a known state is itself a "ready" signal: the caller is
    // asserting `_allOverrides` is now authoritative. In production this only runs post-load (the
    // delete-path cache mutations in admin-app), so readiness is already resolved; it also lets the
    // write-path unit tests, which seed the cache via setAllOverrides() rather than loadOverrides(),
    // satisfy the whenOverridesReady() gate. (v16.85)
    // AN ASSERTION OF COMPLETENESS, so it grants FULL coverage (Finding #2). Use it only when the
    // array genuinely is the whole cache — seeding a test, or replacing everything. To DROP rows,
    // use `removeFromCache`: a delete learns nothing and must not widen what the cache claims.
    _coverage = withAll(_coverage);
    _resolveOverridesReady();
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
        .then(() => _loadOverridesInner({ everyone, member }))
        .finally(() => { if (_loadInFlight === run) { _loadInFlight = null; _loadInFlightKey = null; } });
    _loadInFlight    = run;
    _loadInFlightKey = key;
    return run;
}

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
            _allOverrides = rows;
            // A CAPPED read covers the LIST, never a write — see admin-override-coverage.js.
            _coverage = withAll(_coverage, { complete: !_overridesTruncated });
        } else {
            // ONE MEMBER, EVERY DATE. No cap and no truncation flag: a single member cannot approach
            // the collection cap, so the partial-list banner would be claiming something untrue.
            const snap = await getDocs(query(collection(db, COLLECTIONS.overrides), where('memberName', '==', member)));
            /** @type {any[]} */ const fresh = [];
            snap.forEach(/** @param {any} d */ d => fresh.push({ id: d.id, ...d.data() }));
            // A replace, not a merge — the read is authoritative for this member, so a document it
            // does not contain has been deleted and must not survive in the cache.
            _allOverrides = replaceMemberSlice(_allOverrides, member, fresh);
            _coverage = withMember(_coverage, member);
            _loadFailedFor.delete(member);
        }
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
        // card that ships collapsed. Repaint it into its own failed state (v21.38, review).
        _renderWeekGrid();
        if (tableBody) {
            // RETRY, NOT RELOAD (v21.38, external review). The refusal to render a list we could not
            // read is right and stays; throwing away the whole page to fix one failed query was not.
            // A reload re-runs sign-in, the SW handshake and every other card on the page to recover
            // from something that is usually one dropped request — and it discards any staged edits
            // in the week grid, which is a worse outcome than the error it is recovering from.
            tableBody.innerHTML = '<div class="override-state">Couldn\'t load saved changes.<br><span class="reload-link" id="retryLoadLink" role="button" tabindex="0">↻ Retry</span></div>';
            const retry = document.getElementById('retryLoadLink');
            // No captured opts: after a member switch the stale ones would re-fetch the member the
            // admin has already left. Re-resolve from the page at the moment Retry is pressed.
            const again = () => { loadOverrides(everyone ? { everyone: true } : {}); };
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

