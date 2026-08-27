// @ts-check
/**
 * upload-commit.js — what to do after a document upload's Firestore write fails AMBIGUOUSLY.
 *
 * ── THE SITUATION ───────────────────────────────────────────────────────────────────────────────
 *
 * Uploading a Huddle, Circular or Newsletter is two systems in sequence: a versioned object goes
 * into Storage, then one date-keyed Firestore document is written to point at it. Firestore can
 * raise `deadline-exceeded` or `unavailable` AFTER the server has committed — that is ordinary
 * distributed-systems behaviour, not a fault — so the client cannot tell from the error whether its
 * write landed.
 *
 * The old answer was to retry, on the reasoning that a date-keyed `setDoc` is idempotent. It is
 * idempotent against ITSELF and against nobody else, and this document has more than one writer:
 * two admins, two tabs, a phone and a desk. An external audit walked the interleaving:
 *
 *     A commits, and sees deadline-exceeded.
 *     B reads A's file, uploads its own, commits, and deletes A's now-superseded object.
 *     A retries — and points the live document back at a Storage path B has already deleted.
 *
 * Nothing errors. The document simply 404s when a member taps it, which is precisely the outcome
 * the versioned-path scheme was introduced to make impossible.
 *
 * ── WHY THIS IS A MODULE AND NOT A BRANCH ───────────────────────────────────────────────────────
 *
 * It is a RULE, and `firebase-client.js` cannot be loaded in Node — it imports the Firebase SDK
 * from gstatic — so a rule left inline there can only ever be reasoned about. The coordinator
 * ratchet asked the same question and gave the same answer.
 *
 * The rule is: **resolve the ambiguity by READING, and act only on what the read says.** The three
 * answers are genuinely distinguishable, which is what makes this safe rather than a guess:
 *
 *   · the live path is OURS          → our first write committed. Stop; writing again is a no-op
 *                                      at best and a lost race at worst.
 *   · the live path is UNCHANGED     → nothing of ours committed. Re-issue.
 *   · the live path is SOMETHING ELSE → another upload superseded us. Never overwrite it.
 *
 * A read that FAILS is not a fourth answer — it is the absence of one — and it resolves to `retry`,
 * deliberately: the alternative is abandoning an upload whose metadata may never have been written,
 * leaving Storage holding a file nothing points at. The same outage that produced the ambiguity is
 * the likeliest reason the read failed, so this errs towards the document existing.
 */

/**
 * @typedef {object} CommitSituation
 * @property {string} ourPath        the Storage path THIS upload wrote
 * @property {string|null} oldPath   the path the document held before we started (null if none)
 * @property {string|null} livePath  the path it holds now (null if the document does not exist)
 * @property {boolean} readable      false when the post-failure read itself failed
 */

/**
 * Decide what an ambiguous commit means.
 *
 * @param {CommitSituation} situation
 * @returns {'committed'|'superseded'|'retry'}
 */
export function resolveUploadCommit({ ourPath, oldPath, livePath, readable }) {
    // No usable evidence — see the note above. Retry rather than abandon.
    if (!readable) return 'retry';
    if (livePath && livePath === ourPath) return 'committed';
    // A live path that is neither ours nor the one we started from belongs to somebody else's
    // upload. `oldPath` being null (no document when we began) is handled by the same test: any
    // live path in that case arrived after us.
    if (livePath && livePath !== oldPath) return 'superseded';
    // Either the document is gone, or it still holds exactly what it held before we started.
    return 'retry';
}
