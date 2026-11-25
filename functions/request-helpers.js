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
 * Requires nothing installed at load time — `firebase-admin/auth` is required inside `requireAdmin`,
 * and `./caught` requires nothing — so the pure readers stay loadable where no install exists
 * (doc-url-core.js runs in test:hygiene).
 */

const { fieldsOf } = require('./caught');

/**
 * A JSON request body as an object, whatever shape the runtime handed it over in, or `{}`.
 *
 * firebase-functions parses `req.body` into an object only for `Content-Type: application/json`.
 * Otherwise it is a Buffer, a string, an empty object or absent, with the bytes in `req.rawBody`.
 * Malformed JSON, an array or a scalar is `{}`: there is nothing a caller could do differently on
 * being told which, and every field read from the result is checked by its own reader.
 *
 * One object is NOT the body: JSON sent as `application/x-www-form-urlencoded` is parsed into a single
 * key holding the whole JSON text with an empty value (`{ '{"a":true}': '' }`). That shape is read
 * from the bytes instead — setupRosterAuth's flag reader did this alone until it was rebuilt on this
 * one (Nov 2026), so its leaver sweep and every other endpoint now read such a body the same way.
 * @param {any} body     `req.body`
 * @param {any} [rawBody] `req.rawBody`
 * @returns {Record<string, any>}
 */
function jsonBodyOf(body, rawBody) {
    if (body && typeof body === 'object' && !Buffer.isBuffer(body) && !Array.isArray(body)
        && Object.keys(body).length && !isFormParsedJson(body)) return body;
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

/** A form parser's reading of a JSON text: one key that opens like JSON, with an empty value.
 *  @param {Record<string, any>} body @returns {boolean} */
function isFormParsedJson(body) {
    const keys = Object.keys(body);
    return keys.length === 1 && /^\s*[{[]/.test(keys[0]) && body[keys[0]] === '';
}

/** `jsonBodyOf` for a request. @param {any} req @returns {Record<string, any>} */
const readJsonBody = (req) => jsonBodyOf(req && req.body, req && req.rawBody);

/**
 * One request header as text, or `''` when it is absent. Node joins a repeated custom header into one
 * comma-separated string — only `set-cookie` arrives as an array — so the array its type allows is
 * never met on the headers read with this; were it met, it reads as no header rather than throwing.
 * @param {{ headers: import('http').IncomingHttpHeaders }} req
 * @param {string} name  lower-case, as Node stores them
 * @returns {string}
 */
function headerText(req, name) {
    const value = req.headers[name];
    return typeof value === 'string' ? value : '';
}

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
        if (logTag) console.warn(`[${logTag}] Token verification failed:`, fieldsOf(err).message);
        res.status(401).json({ error: 'Unauthorised' });
        return null;
    }
    if (!decoded || decoded.admin !== true) {
        res.status(403).json({ error: 'Forbidden — admin claim required' });
        return null;
    }
    return decoded;
}

/**
 * Read the raw base64 plain-text request body (bypasses the JSON body-size limit), capped at
 * `maxBytes` so an oversized upload is rejected before it is decoded (decoding the whole thing
 * could OOM the 512 MiB instance). On v2 the body usually arrives pre-buffered as `req.rawBody`,
 * checked by length; the streaming branch covers a runtime that hands over no rawBody, and stops
 * reading at the cap. Shared by ingestHuddle and
 * parseRosterPDF (extracted v16.39 — the block was byte-identical bar the log tag; moved here from
 * index.js in Nov 2026, with the cap handed in, since index.js names the cap beside the others).
 * On any failure it sends the HTTP error response itself and returns null; otherwise the trimmed
 * text. The caller does its own whitespace-strip / charset-validate / decode.
 * @param {any} req
 * @param {any} res
 * @param {string} logTag  console prefix (the calling function's name)
 * @param {number} maxBytes  the most the body may hold
 * @returns {Promise<string|null>} trimmed body, or null if a response was already sent
 */
async function readRawBody(req, res, logTag, maxBytes) {
    try {
        if (req.rawBody) {
            if (req.rawBody.length > maxBytes) {
                res.status(413).json({ error: 'File exceeds the size limit' });
                return null;
            }
            return req.rawBody.toString('utf8').trim();
        }
        /** @type {Buffer[]} */ const chunks = [];
        let total = 0;
        await new Promise((resolve, reject) => {
            req.on('data', (/** @type {Buffer} */ chunk) => {
                total += chunk.length;
                if (total > maxBytes) {
                    req.destroy();
                    reject(new Error('BODY_TOO_LARGE'));
                    return;
                }
                chunks.push(chunk);
            });
            req.on('end', resolve);
            req.on('error', reject);
        });
        return Buffer.concat(chunks).toString('utf8').trim();
    } catch (err) {
        if (err && /** @type {any} */ (err).message === 'BODY_TOO_LARGE') {
            res.status(413).json({ error: 'File exceeds the size limit' });
            return null;
        }
        console.error(`[${logTag}] Failed to read body:`, err && /** @type {any} */ (err).message);
        res.status(400).json({ error: 'Could not read request body' });
        return null;
    }
}

module.exports = { jsonBodyOf, readJsonBody, headerText, bearerToken, requireAdmin, readRawBody };
