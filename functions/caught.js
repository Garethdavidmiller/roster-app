/**
 * caught.js — the fields a catch block reads off a thrown value, typed for what it really is.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 *
 * Under `strict` (functions/jsconfig.json) a caught value is `unknown`, which is the truth: JavaScript
 * lets anything be thrown, and the SDKs these handlers call throw Error objects carrying a `code`
 * (Firestore, Auth), a `status` (the Anthropic SDK) or a `statusCode` (web-push). Every catch here
 * read those fields straight off the value, which the checker rightly refuses on an `unknown`.
 *
 * The answer is ONE reading of them, not a cast in every catch: `fieldsOf(err).code` reads exactly
 * what `err.code` read for every OBJECT that can be thrown, and `undefined` for anything else. That
 * second half is the only place it can differ from the bare read, and only for a thrown `null` or
 * `undefined` — where `err.code` threw a TypeError out of the catch block and `err && err.code`
 * logged the `null` itself. No SDK called here throws either, so the difference is unreachable.
 *
 * Every field is `unknown` on purpose. A caller that BRANCHES on one compares it (`=== 'auth/…'`),
 * and one that does arithmetic with it narrows it first (`Number.isInteger`), so the checker still
 * sees each decision; only logging reads a field without either, and a template literal prints
 * whatever it is.
 *
 * Requires nothing, so any module may use it.
 */
'use strict';

/**
 * @typedef {object} CaughtFields
 * @property {unknown} [code]        Firestore and Auth errors (a gRPC number or an `auth/…` string)
 * @property {unknown} [message]     every Error
 * @property {unknown} [status]      the Anthropic SDK's HTTP status
 * @property {unknown} [statusCode]  web-push's HTTP status
 */

/**
 * The thrown value itself when it is an object (an Error, normally), else an empty view.
 * @param {unknown} err  whatever a `catch` received
 * @returns {CaughtFields}
 */
function fieldsOf(err) {
    return typeof err === 'object' && err !== null ? err : {};
}

module.exports = { fieldsOf };
