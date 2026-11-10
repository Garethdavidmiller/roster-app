'use strict';

/**
 * functions/request-helpers.js — the request plumbing every endpoint used to write out for itself.
 *
 * ── WHY ONE COPY (functions-core-8, whole-app check 10 Nov 2026) ───────────────────────────────
 *
 * The JSON body reader was written out five times and the admin gate five, and the copies drifted.
 * `kindFromBody` (doc-url-core.js) records a body arriving as a Buffer being wrongly refused and
 * fixes it; the three inline readers kept the fault, so the same `{ member }` posted to
 * requestPasswordReset answered 200 as an object or a string and 400 "Missing member" as a Buffer —
 * and a right PIN in a Buffer body was charged as a wrong one. parseRosterPDF alone accepted only a
 * case-exact "Bearer ". The cost was never today's caller (the app's pages send application/json);
 * it was the next handler, copied from whichever copy was nearest.
 *
 * Requires nothing at load time — `firebase-admin/auth` is required inside `requireAdmin` — so the
 * pure readers stay loadable where no install exists (doc-url-core.js runs in test:hygiene).
 */

/**
 * A JSON request body as an object, whatever shape the runtime handed it over in, or `{}`.
 *
 * firebase-functions parses `req.body` into an object only for `Content-Type: application/json`.
 * Otherwise it is a Buffer, a string, an empty object or absent, with the bytes in `req.rawBody`.
 * Malformed JSON, an array or a scalar is `{}`: there is nothing a caller could do differently on
 * being told which, and every field read from the result is checked by its own reader.
 * @param {any} body     `req.body`
 * @param {any} [rawBody] `req.rawBody`
 * @returns {Record<string, any>}
 */
function jsonBodyOf(body, rawBody) {
    if (body && typeof body === 'object' && !Buffer.isBuffer(body) && Object.keys(body).length) return body;
    const source = Buffer.isBuffer(body) || (typeof body === 'string' && body) ? body : rawBody;
    const text = Buffer.isBuffer(source) ? source.toString('utf8') : (typeof source === 'string' ? source : '');
    if (!text.trim()) return {};
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
        return {};
    }
}

/** `jsonBodyOf` for a request. @param {any} req @returns {Record<string, any>} */
const readJsonBody = (req) => jsonBodyOf(req && req.body, req && req.rawBody);

/**
 * The token in an `Authorization: Bearer …` header — the scheme matched in any case — or `''`.
 * @param {any} req
 * @returns {string}
 */
function bearerToken(req) {
    const header = (req && req.headers && req.headers['authorization']) || '';
    return String(header).replace(/^Bearer\s+/i, '').trim();
}

/**
 * The gate every admin endpoint asks first. No token is refused before anything is verified. A token
 * is verified WITH `checkRevoked` — a disabled or revoked admin's cached token must be refused at
 * once, not honoured for up to an hour (v17.42) — and must carry `admin === true`, strictly, so any
 * other value fails closed. Answers 401/403 itself and returns null; otherwise the decoded token.
 * @param {any} req
 * @param {any} res
 * @param {string} [logTag]  logged on a refused token, as parseRosterPDF always did
 * @returns {Promise<Record<string, any>|null>}
 */
async function requireAdmin(req, res, logTag) {
    const token = bearerToken(req);
    if (!token) {
        res.status(401).json({ error: 'Unauthorised' });
        return null;
    }
    const { getAuth } = require('firebase-admin/auth');
    let decoded;
    try {
        decoded = await getAuth().verifyIdToken(token, true);
    } catch (err) {
        if (logTag) console.warn(`[${logTag}] Token verification failed:`, err && err.message);
        res.status(401).json({ error: 'Unauthorised' });
        return null;
    }
    if (!decoded || decoded.admin !== true) {
        res.status(403).json({ error: 'Forbidden — admin claim required' });
        return null;
    }
    return decoded;
}

module.exports = { jsonBodyOf, readJsonBody, bearerToken, requireAdmin };
