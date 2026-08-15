// @ts-check
/**
 * admin-override-coverage.js — WHAT THE ADMIN OVERRIDE CACHE ACTUALLY KNOWS.
 *
 * ── WHY THIS EXISTS (v21.38, external review) ───────────────────────────────────────────────────
 *
 * Admin used to answer one question about its cache — "did the load succeed?" — because the load
 * fetched the whole collection, so success meant it held everything about everybody. It now fetches
 * the SELECTED MEMBER first and the rest only when somebody asks for it, which turns that one
 * boolean into a lie: the cache can be fully loaded and know nothing at all about the member on
 * screen.
 *
 * That distinction is the entire module. Every defect this page has recorded around the cache has
 * the same shape — a decision built from data that had not arrived, where the missing data looked
 * exactly like an absence of data:
 *
 *   · an existing `roster_import` document not deleted, because the map said the date was free →
 *     two overrides for one day
 *   · a worked Sunday erased by an RD correction, because the cache did not know it was worked
 *   · a real sub-12-hour rest gap missed, because the neighbouring day looked empty
 *
 * None of those throw. Each produces a page that looks right and a roster that is wrong, which is
 * why the answer is a COVERAGE record rather than a flag, and why the write gates ask about a
 * member rather than about the load.
 *
 * ── EMPTY IS NOT THE SAME AS UNKNOWN, AND THAT IS THE WHOLE POINT ───────────────────────────────
 *
 * A member we have loaded and who genuinely has no overrides, and a member we have never fetched,
 * both produce an empty slice of `_allOverrides`. Nothing downstream can tell them apart by looking
 * at the array — so the array is never asked. `hasAuthorityFor` is, and it is answered from what was
 * REQUESTED, not from what came back.
 *
 * ── WHY `all` IS A SEPARATE FLAG AND NOT "every member is in the set" ───────────────────────────
 *
 * They are different claims. Having fetched all fifty members one at a time is not the same as
 * having fetched the collection: a member added to the roster since, or a document written by the
 * roster importer under a name nobody has selected, belongs to the second and not the first. The
 * "All staff" view asks the second question, so it gets its own answer. Collapsing them would make
 * the all-staff list quietly short — the exact failure the no-silent-caps banner exists to prevent
 * one level up.
 *
 * ── WHY THE SCOPE IS A MEMBER AND NOT A DATE WINDOW ─────────────────────────────────────────────
 *
 * The load this exists to describe used to fetch the newest few thousand documents of the whole
 * collection on every Admin open and filter them locally. An admin opening the page to change one
 * shift for one person paid for thousands of rows about fifty colleagues before the page was usable,
 * against a cap the collection grows towards.
 *
 * The obvious narrowing is a date window — the current week, plus enough either side. It is the
 * wrong one. Every consumer a partial read can make WRONG is per-MEMBER and spans dates unpredictably:
 * the week grid, the ±1-day rest gap, the AL year's entitlement, the range writer's date map. A
 * window makes each of those a question about whether it happened to be wide enough, and the answer
 * is invisible when it is no. One member, every date, answers all of them completely.
 *
 * It is also cheaper to be safe here: `where('memberName','==',…)` is an equality on a single field,
 * so Firestore indexes it automatically and the change ships with no index deploy and none of the
 * ordering dance one would need.
 *
 * Pure — no DOM, no Firebase, no imports — so it loads in Node and is tested without mocks.
 * Tested by admin-override-coverage.test.mjs.
 */

/**
 * @typedef {object} Coverage
 * @property {boolean} all        The WHOLE collection has been read, completely.
 * @property {boolean} allPartial The collection was read but hit the query CAP, so the oldest
 *   documents are missing. Enough to list; NOT enough to decide a write. See `withAll`.
 * @property {string[]} members   Members individually read authoritatively, in insertion order.
 */

/** @returns {Coverage} A cache that knows nothing. The honest starting state. */
export function emptyCoverage() {
    return { all: false, allPartial: false, members: [] };
}

/**
 * Record that one member has been read authoritatively.
 * @param {Coverage} cov
 * @param {string} member
 * @returns {Coverage} a NEW coverage — never mutated in place, so a caller cannot widen the
 *   authority of a record it merely holds a reference to.
 */
export function withMember(cov, member) {
    if (!member) return cov;
    if (cov.members.includes(member)) return cov;
    return { ...cov, members: [...cov.members, member] };
}

/**
 * Record that the collection has been read.
 *
 * ── A CAPPED READ IS NOT A COMPLETE ONE (v21.38, external review) ───────────────────────────────
 *
 * The collection read is capped, and past that cap the OLDEST documents are simply not returned.
 * That is fine for the list — it carries a banner saying so — and it is not fine for a WRITE: an
 * override older than the cap would be invisible, so the range writer would miss an existing
 * `roster_import` document and write a duplicate, and an entitlement check would under-count a past
 * year's leave and skip its own warning. Both are exactly the failures this module exists to stop.
 *
 * So a capped read grants `allPartial`, which answers "may I list everybody?" and never "may I
 * decide about this member?". It also does not touch `members`: a member read individually — which
 * has no cap by design — stays authoritative.
 * @param {Coverage} cov
 * @param {{ complete?: boolean }} [opts] `complete: false` when the read hit its cap
 * @returns {Coverage}
 */
export function withAll(cov, { complete = true } = {}) {
    return complete
        ? { ...cov, all: true, allPartial: false }
        : { ...cov, allPartial: true };
}

/**
 * Forget everything. Used when a read FAILS in a way that leaves the cache unusable, and on sign-out.
 * @returns {Coverage}
 */
export function clearedCoverage() {
    return emptyCoverage();
}

/**
 * May a decision about this member be built from the cache?
 *
 * The question every write gate asks. Note it is false for an empty/absent member name: a decision
 * about nobody is not a decision we have the data for, and answering `true` there would open the
 * gate on exactly the path where the member field has not been populated yet.
 * @param {Coverage} cov
 * @param {string|null|undefined} member
 * @returns {boolean}
 */
export function hasAuthorityFor(cov, member) {
    // FULL COVERAGE ANSWERS EVERY QUESTION, including a malformed one — asking the member first
    // would make `all` not actually mean all, and would refuse a write on a page whose member field
    // simply had not been read yet even though the cache held the entire collection.
    if (cov.all) return true;
    if (!member) return false;
    return cov.members.includes(member);
}

/**
 * May a list claiming to show EVERY member be rendered from the cache?
 *
 * True for a CAPPED collection read as well as a complete one — the list has a banner for that, and
 * refusing to draw it would be worse than drawing it with its caveat. This is deliberately a
 * different question from `hasAuthorityFor`, which a capped read never satisfies.
 * @param {Coverage} cov
 * @returns {boolean}
 */
export function coversEveryone(cov) {
    return cov.all || cov.allPartial;
}

/**
 * Replace one member's slice of the cache with a freshly-read one.
 *
 * A replace, not a merge: the fresh read is authoritative for that member, so a document it does
 * NOT contain has been deleted and must go. Merging would resurrect it — the same reasoning as the
 * Calendar's authoritative range reconcile, and the same bug if it is got wrong.
 *
 * Every other member's documents are left exactly as they are, which is what makes the staged load
 * additive across members without either read invalidating the other.
 * @param {Array<{memberName?: string}>} docs the whole cache
 * @param {string} member
 * @param {Array<{memberName?: string}>} fresh that member's documents, as just read
 * @returns {Array<{memberName?: string}>} a new array
 */
export function replaceMemberSlice(docs, member, fresh) {
    return [...docs.filter(d => d.memberName !== member), ...fresh];
}
