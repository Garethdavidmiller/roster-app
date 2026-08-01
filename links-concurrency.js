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
 * @param {{updatedAt?: any, updatedBy?: string}|null|undefined} data - the server document's data
 * @param {boolean} exists - whether the server document exists
 * @param {{loadedUpdatedAt: number|null, baselineUnknown: boolean, currentUser: string|null}} state
 * @returns {{by: string, at: any}|null} the conflict to confirm, or null when it is safe to write
 */
export function conflictOf(data, exists, { loadedUpdatedAt, baselineUnknown, currentUser }) {
    const d = data || {};
    const freshTs = exists ? (d.updatedAt?.toMillis?.() ?? null) : null;
    const tsMismatch = loadedUpdatedAt !== null && freshTs !== null && freshTs !== loadedUpdatedAt;
    const unknownButOthers = baselineUnknown && freshTs !== null
        && !!d.updatedBy && d.updatedBy !== currentUser;
    return (tsMismatch || unknownButOthers)
        ? { by: d.updatedBy || 'Someone', at: d.updatedAt || null }
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
 * @returns {{loadedUpdatedAt: number|null, baselineUnknown: boolean}}
 */
export function baselineAfterWrite(millis, ok = true) {
    const ts = ok ? (millis ?? null) : null;
    return { loadedUpdatedAt: ts, baselineUnknown: ts === null };
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
