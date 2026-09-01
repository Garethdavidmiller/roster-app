// @ts-check
/**
 * links-concurrency.js — the PURE decisions behind the Links workspace's co-editing safety.
 *
 * Two designers can have links.html open at once. Everything that decides whether one of them is
 * about to overwrite the other lives here: no DOM, no Firebase, no timers — just the rules, so they
 * can be tested. `links-app.js` keeps the Firestore calls, the dialogs and the state.
 *
 * WHY THIS IS ITS OWN MODULE (v19.38). This logic has produced three separate bugs, every one of
 * them a silent overwrite of a colleague's work:
 *   · v16.19 — a rename wrote name-only, so a co-editor's baseline never moved and their next save
 *     reverted the rename with no prompt.
 *   · v16.23 — a rename advanced OUR baseline unconditionally, so if someone had saved in between,
 *     the next save skipped the conflict confirm entirely.
 *   · v17.18 — a failed post-save read-back left `loadedUpdatedAt = null` AND `baselineUnknown =
 *     false`, i.e. neither a known baseline nor a flag saying it was unknown, which disabled the
 *     guard completely.
 * Each was found by reasoning, fixed in prose, and pinned by nothing — because the rules were inline
 * in a 1,500-line coordinator with no seam. The failure mode is silent by nature: the loser of the
 * race sees a successful save and only discovers the loss when they reopen the design. That is
 * exactly the shape that needs tests rather than care.
 */

/**
 * Is the server's version different from the one we loaded — i.e. did someone else save while this
 * page was open?
 *
 * Two independent ways to detect it, because the timestamp is not always available:
 *
 *  1. TIMESTAMP MISMATCH — we know what `updatedAt` was when we loaded, the server has a different
 *     one. Definitive.
 *  2. UNKNOWN BASELINE + SOMEONE ELSE'S NAME — a previous read-back failed, so we have no baseline
 *     to compare. Falling back to "is the last writer someone other than me?" is weaker but far
 *     better than treating an unknown baseline as "no conflict", which is what disabled the guard
 *     at v17.18.
 *
 * ACCEPTED LIMIT: two devices signed in under the SAME display name never conflict-prompt on path 2
 * (`updatedBy` is equal, so it looks like our own write). Inherent to identifying editors by name;
 * path 1 still catches it whenever a baseline is known.
 *
 * @param {{updatedAt?: any, updatedBy?: string, revision?: any}|null|undefined} data - the server document's data
 * @param {boolean} exists - whether the server document exists
 * @param {{loadedRevision?: number|null, loadedUpdatedAt: number|null, baselineUnknown: boolean, currentUser: string|null}} state
 * @returns {{by: string, at: any, rev: number|null}|null} the conflict to confirm — `rev` names the
 *   exact version shown, so a forced overwrite consents to THAT one — or null when it is safe to write
 */
export function conflictOf(data, exists, { loadedRevision = null, loadedUpdatedAt, baselineUnknown, currentUser }) {
    const d = data || {};
    // A missing document is not a conflict — the delete/purge paths own that answer, and the
    // timestamp rules below already fell through to null for it. Stated rather than left implicit,
    // because the revision rule that follows would otherwise read "we hold 5, the server holds
    // nothing" as somebody's save.
    if (!exists) return null;

    // ── PATH 0: THE REVISION (v22.18) — exact, and the only one with no window in it ────────────
    //
    // `updatedAt` is a serverTimestamp, so a writer cannot know its own write's value without a
    // SEPARATE read afterwards — and a colleague's save can land in that gap, leaving us holding a
    // baseline that points at a revision whose CONTENT we never took in. Our next save then matches,
    // skips the confirm, and silently overwrites them. A counter computed INSIDE the transaction is
    // derived from the value that same transaction read, so there is nothing to lose.
    //
    // ABSENT ≠ PRESENT, deliberately, in both directions. A design nobody has saved since v22.18
    // has no revision; if we hold one and the server does not, an older client has written over it,
    // which is a change. If the server has one and we do not, we loaded before that save. Both are
    // conflicts, and both are the safe answer.
    const freshRev = typeof d.revision === 'number' ? d.revision : null;
    if (!baselineUnknown && (loadedRevision !== null || freshRev !== null)) {
        return freshRev === loadedRevision ? null : { by: d.updatedBy || 'Someone', at: d.updatedAt || null, rev: freshRev };
    }

    const freshTs = exists ? (d.updatedAt?.toMillis?.() ?? null) : null;
    const tsMismatch = loadedUpdatedAt !== null && freshTs !== null && freshTs !== loadedUpdatedAt;
    const unknownButOthers = baselineUnknown && freshTs !== null
        && !!d.updatedBy && d.updatedBy !== currentUser;
    return (tsMismatch || unknownButOthers)
        ? { by: d.updatedBy || 'Someone', at: d.updatedAt || null, rev: freshRev }
        : null;
}

/**
 * What a write's read-back tells us about the NEXT save's baseline.
 *
 * The rule that matters: a read-back that FAILED, or returned no timestamp, must leave the baseline
 * flagged UNKNOWN — never merely null. `loadedUpdatedAt = null` on its own reads as "there is no
 * baseline to compare", which `conflictOf` treats as safe. Pairing it with `baselineUnknown = true`
 * is what keeps the weaker name-based check alive (v17.18).
 *
 * @param {number|null|undefined} millis - the read-back's updatedAt in millis, or null/undefined
 * @param {boolean} [ok=true] - false when the read-back itself threw
 * @returns {{loadedRevision: number|null, loadedUpdatedAt: number|null, baselineUnknown: boolean}}
 */
export function baselineAfterWrite(millis, ok = true) {
    const ts = ok ? (millis ?? null) : null;
    return { loadedRevision: null, loadedUpdatedAt: ts, baselineUnknown: ts === null };
}

/**
 * The baseline after a write whose REVISION we know exactly (v22.18).
 *
 * This is the whole point of the counter: a transaction that read revision N and wrote N+1 knows
 * it wrote N+1, with no read-back and therefore no window for a colleague's save to be mistaken
 * for our own. `baselineAfterWrite` above stays for the two paths that genuinely cannot know —
 * a queued offline write, and a read-back that failed.
 *
 * `loadedUpdatedAt: null` here is NOT the v17.18 shape it resembles. That bug was a baseline that
 * knew nothing while claiming to be known; this one knows the revision, which `conflictOf` checks
 * first. The pairing is only dangerous when there is nothing else to compare.
 *
 * @param {number} revision the revision this write COMMITTED
 * @returns {{loadedRevision: number, loadedUpdatedAt: number|null, baselineUnknown: boolean}}
 */
export function baselineAfterCommit(revision) {
    return { loadedRevision: revision, loadedUpdatedAt: null, baselineUnknown: false };
}

/**
 * The baseline for a design we have just SELECTED — read from the list, not written (v22.18).
 *
 * The third arming case, and it needed saying once rather than at both call sites. A loaded entry
 * carries the revision the read returned, so the baseline is exact and `baselineUnknown` is false —
 * even when `updatedAt` is an unresolved `serverTimestamp()`, which is what our own recent write
 * reads back as on this device. Without the revision there is nothing new to know, so it falls
 * through to `baselineAfterWrite`'s rules, unchanged.
 *
 * @param {{revision?: any, updatedAt?: any}|null|undefined} entry the design row being selected
 * @returns {{loadedRevision: number|null, loadedUpdatedAt: number|null, baselineUnknown: boolean}}
 */
export function baselineFromEntry(entry) {
    const ts = entry?.updatedAt?.toMillis?.() ?? null;
    if (typeof entry?.revision === 'number') {
        return { loadedRevision: entry.revision, loadedUpdatedAt: ts, baselineUnknown: false };
    }
    return baselineAfterWrite(ts);
}

/**
 * The revision a write should COMMIT, given what the transaction just read.
 *
 * Monotonic from whatever is there, so a design that predates the field starts at 1 and one that
 * has been saved before goes up by one. Never trusts a non-number — a corrupt value must not be
 * able to freeze the counter or send it backwards, which would make every later comparison agree
 * when it should not.
 *
 * @param {any} serverData the document data read INSIDE the transaction
 * @returns {number}
 */
export function nextRevision(serverData) {
    const r = serverData?.revision;
    return (typeof r === 'number' && Number.isFinite(r) && r >= 1) ? Math.floor(r) + 1 : 1;
}

/**
 * May a rename advance our local concurrency baseline to its own write?
 *
 * A rename bumps `updatedAt`, so it looks like a save to everyone else — which means it MUST bump
 * our baseline too, or a co-editor's next save silently reverts it (v16.19). But advancing blindly
 * is the opposite bug (v16.23): if someone saved between our load and our rename, moving our
 * baseline forward to our own write makes the next `conflictOf` see a match and skip the confirm,
 * overwriting their patterns with our stale copy.
 *
 * So: advance ONLY when the document we are about to rename is still exactly the one we loaded.
 * An unreadable pre-read (offline) counts as "cannot confirm" → do not advance; the next save then
 * prompts, which is the safe direction.
 *
 * @param {number|null} preTs - the doc's updatedAt (millis) read immediately BEFORE the rename write
 * @param {number|null} ourBaseline - the baseline we hold for that doc
 * @param {boolean} [preReadOk=true] - false when the pre-read threw
 * @returns {boolean}
 */
export function canAdvanceBaseline(preTs, ourBaseline, preReadOk = true) {
    if (!preReadOk) return false;
    return preTs === ourBaseline;
}
