'use strict';

/**
 * functions/doc-url-core.js — who may be handed a document URL, for which document, and for how
 * long. No Firebase, no HTTP, no clock of its own. Imported by `functions/documents.js`.
 *
 * ── WHY THIS EXISTS (v24.16, owner decision 19 Sep 2026) ────────────────────────────────────────
 *
 * The Huddle, the Weekly Retail Circular and the Marylebone Newsletter are opened through the
 * PERMANENT tokenised download URL saved in their Firestore document. That URL carries its own
 * access token and bypasses `storage.rules` entirely, so whoever has ever held one keeps the file
 * until retention deletes the object — 3 months for a Huddle, 6 for the other two — and a partial
 * prune failure orphans an object whose URL then lives for ever. `AUTH_PLAN.md` §5 (E6),
 * `ARCHITECTURE.md` EXC-007.
 *
 * Four routes were costed. Converting `.docx` to HTML was REFUSED by the owner: a Circular is a
 * designed document and flattening it through Mammoth would degrade what staff read. Requiring PDF
 * was refused too, on a fact only the owner had — **they arrive as `.docx`**, so that would be a
 * manual export on every weekly issue, for ever. What remains is to keep the Office viewer and make
 * the URL it is given SHORT-LIVED: the exposure goes from "until retention" to "the signing window",
 * and nothing a member sees or an admin does changes.
 *
 * ── THE THREE RULES, AND WHY EACH IS HERE RATHER THAN IN THE HANDLER ────────────────────────────
 *
 * 1. WHO. `mayReceiveDocumentUrl` is a MIRROR of `firestore.rules` for `huddles`, `circulars` and
 *    `newsletters`: a member `name` claim, `admin`, or the shared `calendarViewer` capability the
 *    staff PIN mints. It must never be more permissive than the rule — if it were, this endpoint
 *    would become a way to read a document the rules refuse, which is the opposite of its purpose.
 *    `doc-url-core.test.mjs` pins the two together by reading `firestore.rules` itself, because two
 *    copies of an access rule that drift are exactly how this repo has been bitten before.
 *
 * 2. WHICH. `resolveKind` answers from a FIXED allowlist and nothing else. The handler must never
 *    accept a storage path, a collection name or a document id from the caller: a signing endpoint
 *    that signs what it is told is an arbitrary-read hole into the whole bucket. The caller names a
 *    KIND ('huddle' | 'circular' | 'newsletter'); the server decides everything else.
 *
 * 3. HOW LONG. `signedUrlExpiry` is a deliberate compromise and the reasoning is the load-bearing
 *    part. The window must outlive the whole chain — mint, render the button, the member's tap, and
 *    then MICROSOFT's server-side fetch, because a `.docx` still opens through the Office Online
 *    viewer. Too short and a document that was open in front of somebody fails when they tap it;
 *    too long and the bound this whole change buys is weakened. Fifteen minutes is short enough to
 *    matter and long enough that no ordinary open can miss it.
 *
 * ── WHAT THIS DOES NOT DO, STATED SO NOBODY CLAIMS IT LATER ─────────────────────────────────────
 *
 * It does NOT remove Microsoft. A `.docx` still reaches the Office Online viewer, which still
 * fetches it server-side, and if Microsoft caches what it fetched then the signing window bounds
 * THIS app's leak and not their copy. That was understood and accepted when the option was chosen.
 * It also does nothing for URLs already in circulation: those stay live until the objects are
 * rotated or pruned.
 */

/**
 * The only documents this endpoint will ever sign for, and where each lives.
 *
 * A fixed map, not a template: the value of this endpoint is that the CALLER cannot name a path.
 * Adding a kind is a deliberate edit here, next to the reason the list is closed.
 */
const DOC_KINDS = Object.freeze({
    huddle:     { collection: 'huddles',     label: 'Huddle' },
    circular:   { collection: 'circulars',   label: 'Weekly Retail Circular' },
    newsletter: { collection: 'newsletters', label: 'Marylebone Newsletter' },
});

/**
 * How long a minted URL stays valid. See rule 3 in the header — this is sized against the Office
 * viewer's server-side fetch, not against how fast a person taps.
 */
const SIGNED_URL_TTL_MS = 15 * 60 * 1000;

/**
 * Is this caller allowed a URL at all?
 *
 * MIRRORS `firestore.rules` for the three document collections. Three doors, and `request.auth !=
 * null` is implied here by having a decoded token at all.
 *
 * Fails closed on anything that is not exactly what it expects: a missing token, a null, a string
 * where an object belongs. `admin` and `calendarViewer` are compared with `=== true` rather than
 * truthiness, matching the rules' `== true`, so a claim of `"yes"` or `1` grants nothing.
 *
 * @param {any} claims decoded ID-token claims
 * @returns {boolean}
 */
function mayReceiveDocumentUrl(claims) {
    if (!claims || typeof claims !== 'object') return false;
    if (typeof claims.name === 'string' && claims.name.length > 0) return true;
    if (claims.admin === true) return true;
    if (claims.calendarViewer === true) return true;
    return false;
}

/**
 * Resolve a caller-supplied kind to a server-owned collection, or refuse.
 *
 * Deliberately strict: an exact match against the allowlist, on a string, after trimming and
 * lowercasing — and nothing clever. No prefix matching, no fallback, no "if it looks like a
 * collection name". The refusal carries no detail about why, because the caller does not need to
 * learn the shape of the allowlist by probing it.
 *
 * @param {any} raw
 * @returns {{ ok: true, kind: string, collection: string, label: string } | { ok: false }}
 */
function resolveKind(raw) {
    if (typeof raw !== 'string') return { ok: false };
    const kind = raw.trim().toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(DOC_KINDS, kind)) return { ok: false };
    const entry = DOC_KINDS[kind];
    return { ok: true, kind, collection: entry.collection, label: entry.label };
}

/**
 * Pull the requested kind out of a request body, whatever shape it arrived in.
 *
 * ── WHY THIS IS NOT JUST `body.kind` ────────────────────────────────────────────────────────────
 *
 * firebase-functions v2 parses `req.body` into an object ONLY when the caller sent
 * `Content-Type: application/json`. Without it the body arrives as a Buffer or a string, and
 * `body.kind` is `undefined` — which `resolveKind` then correctly refuses as "unknown kind".
 *
 * That refusal is the problem: the kind was fine, and the caller is told the one thing that is not
 * true. `setupRosterAuth` carries a comment about this same trap and hands its raw-body fallback to
 * `parseSetupActionFlags`; this is the same fix in the same shape. Found by a 48-hour review of
 * v24.16 (19 Sep 2026) before any client depended on it — probed, not assumed: a Buffer body
 * answered 400 "Unknown document kind" with a valid `huddle` inside it.
 *
 * Malformed JSON is NOT an error here. It yields `undefined`, `resolveKind` refuses it, and the
 * caller gets the same 400 as any other unusable kind — there is nothing a caller could do
 * differently on being told which of the two it was.
 *
 * @param {any} body  req.body, in any of the shapes the runtime may hand over
 * @returns {any} the raw kind value, for `resolveKind` to accept or refuse
 */
function kindFromBody(body) {
    if (body && typeof body === 'object' && !Buffer.isBuffer(body)) return body.kind;
    const text = Buffer.isBuffer(body) ? body.toString('utf8') : (typeof body === 'string' ? body : '');
    if (!text) return undefined;
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' ? parsed.kind : undefined;
    } catch (_) {
        return undefined;
    }
}

/**
 * The expiry instant for a URL minted at `nowMs`.
 *
 * Takes the clock rather than reading one, so the window can be tested at its boundaries without
 * waiting fifteen minutes — the same discipline `overtime-core.js` uses for every deadline.
 *
 * @param {number} nowMs
 * @returns {number} epoch ms
 */
function signedUrlExpiry(nowMs) {
    return nowMs + SIGNED_URL_TTL_MS;
}

/**
 * Is a storage path one this endpoint is willing to sign?
 *
 * The path comes from the SERVER's own Firestore read, never from the caller, so this is a
 * belt-and-braces check on our own data rather than input validation. It still earns its place: a
 * malformed or absent `storagePath` on a document must fail closed with a clear refusal rather than
 * reach the signing call and produce whatever that does with `undefined`.
 *
 * @param {any} path
 * @returns {boolean}
 */
function isSignablePath(path) {
    return typeof path === 'string'
        && path.length > 0
        && !path.startsWith('/')
        && !path.includes('..');
}

module.exports = {
    DOC_KINDS,
    kindFromBody,
    SIGNED_URL_TTL_MS,
    mayReceiveDocumentUrl,
    resolveKind,
    signedUrlExpiry,
    isSignablePath,
};
