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
 * A read that FAILS is not a fourth answer — it is the absence of one — and it must not be treated
 * as permission to write. It resolved to `retry` until v21.96, on the reasoning that abandoning here
 * leaves Storage holding a file nothing points at. That reasoning was wrong in one direction and
 * right in the other, and the two costs are not comparable. An external audit walked the
 * interleaving it re-opens, which is the ORIGINAL race with a failed read standing in for the
 * ambiguity:
 *
 *     A commits, and sees deadline-exceeded.
 *     A's reconciliation read fails too.
 *     B — who can read — sees A's committed document, uploads its own, commits, and deletes A's
 *       now-superseded object.
 *     A retries blind, and points the live document back at a path B has already deleted.
 *
 * So the fourth answer is `ambiguous`: **do not write, and do not roll back either.** The upload is
 * reported to the admin as unconfirmed, and the Storage object is left where it is. That can leave
 * an orphan — a file nothing points at, costing storage and nothing else — and an orphan is the
 * cheaper of the two outcomes by a wide margin: the alternative is a live document staff can tap
 * that 404s, silently, until somebody uploads again. The admin retries when connectivity returns,
 * and that retry begins with a fresh authoritative pre-read rather than a stale assumption.
 *
 * The rule this makes true, which was not true before: **we write again only when we have PROVED
 * nobody superseded us.**
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
 * @returns {'committed'|'superseded'|'retry'|'ambiguous'}
 */
export function resolveUploadCommit({ ourPath, oldPath, livePath, readable }) {
    // No usable evidence. Uncertainty is not permission to write — see the note above. Checked
    // FIRST, because `livePath` under an unreadable state is not evidence of anything: it is
    // whatever the caller happened to be holding, and every other branch reads it.
    if (!readable) return 'ambiguous';
    if (livePath && livePath === ourPath) return 'committed';
    // A live path that is neither ours nor the one we started from belongs to somebody else's
    // upload. `oldPath` being null (no document when we began) is handled by the same test: any
    // live path in that case arrived after us.
    if (livePath && livePath !== oldPath) return 'superseded';
    // Either the document is gone, or it still holds exactly what it held before we started.
    return 'retry';
}
