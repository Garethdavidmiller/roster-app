// @ts-check
/**
 * function-url.js — the ONE address of the app's Cloud Functions, as the browser calls them.
 *
 * Owns: `FUNCTIONS_BASE` (the region and project the Functions are deployed to) and `functionUrl(name)`.
 * Does NOT own: what any endpoint does or how it is called — each caller keeps its own timeout, token
 *   and error handling (account-calls.js, admin-auth.js, document-url.js, firebase-client.js,
 *   operations-app.js, operations-doc-links.js, overtime-data.js).
 *
 * WHY ONE HOME (25 Nov 2026): the address was hand-written nine times, so a region move or a renamed
 * function meant finding every copy, and a missed one fails only when that button is pressed. Every
 * name passed here is checked against the deployed export list (`function-url-parity` in
 * test/functions-surface.test.mjs), so a function renamed on the server fails a test rather than a
 * member's tap. The server's half of the region is `REGION` in functions/region.js.
 *
 * Pure: no DOM, no Firebase, imports nothing.
 */

/** The deployed Functions' origin: region `europe-west2` (London), project `myb-roster`. */
export const FUNCTIONS_BASE = 'https://europe-west2-myb-roster.cloudfunctions.net';

/**
 * The HTTPS address of one deployed Cloud Function.
 * @param {string} name  the function's exported name in functions/index.js, e.g. `'getDocumentUrl'`
 * @returns {string}
 */
export function functionUrl(name) {
    return `${FUNCTIONS_BASE}/${name}`;
}
