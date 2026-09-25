/**
 * document-url.test.mjs — what a server answer MEANS for a member trying to open a document.
 * Run (no mocks): node --test document-url.test.mjs   (part of test:hygiene)
 *
 * WHY THIS FILE EXISTS. This rule lived in `firebase-client.js` for about an hour, where nothing
 * could have tested it: that module statically imports the Firebase SDK from the gstatic CDN, so
 * Node cannot load it. The coordinator ratchet refused the growth, and the extraction it forced is
 * what made these cases reachable at all.
 *
 * ORGANISED BY WHAT A WRONG ANSWER COSTS:
 *   · a refusal treated as fatal  → a member meets a dead button where yesterday they had a working
 *                                   document, and the most likely cause is our own missing IAM grant
 *   · a refusal treated as a url  → `undefined` reaches window.open
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { requestSignedDocumentUrl, DOCUMENT_URL_ENDPOINT, DOCUMENT_URL_TIMEOUT_MS } from './document-url.js';

const token = () => Promise.resolve('tok');

/**
 * A fake fetchWithTimeout.
 *
 * ⚠️ NOTE WHAT THE REFUSAL FIXTURES CARRY. They return a body holding a PERFECTLY GOOD url, and
 * that is deliberate: with an empty body, deleting the `if (!r.ok)` check entirely still yields
 * `undefined` from the destructure and still returns null, so every refusal test below passed
 * against code with no status check in it at all. A mutation caught exactly that. Making the body
 * plausible is what forces the STATUS to be the thing doing the work.
 */
// A COMPLETE good answer (v24.23: url + expiry + type) — so every refusal test below is refused by
// its STATUS, not by some missing field. The v24.19 mutation audit found exactly that trap.
const EXPIRES = Date.UTC(2026, 8, 25, 12, 15);
const LOOKS_FINE = { url: 'https://storage.googleapis.com/myb-roster.appspot.com/huddles/x.pdf?X-Goog-Expires=900', expiresAt: EXPIRES, fileType: 'pdf' };
const res = (status, body = LOOKS_FINE) => () => Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
});

describe('a good answer is used', () => {
    test('a 200 with a url returns it', async () => {
        const url = 'https://storage.googleapis.com/myb-roster.appspot.com/huddles/x.pdf?X-Goog-Expires=900';
        assert.deepEqual(await requestSignedDocumentUrl('huddle', token, res(200, { url, expiresAt: EXPIRES, fileType: 'docx' })),
            { url, expiresAt: EXPIRES, fileType: 'docx' },
            'the expiry and the SERVER\'s file type travel with the url (v24.23)');
    });

    test('a url with no readable expiry is not used — it could be lapsed and nothing could tell (v24.23)', async () => {
        for (const expiresAt of [undefined, null, 'soon', NaN, Infinity]) {
            assert.equal(await requestSignedDocumentUrl('huddle', token, res(200, { ...LOOKS_FINE, expiresAt })), null,
                `expiresAt=${String(expiresAt)} was accepted`);
        }
    });

    test('it sends the kind, a bearer token and JSON — or the server cannot answer', async () => {
        let seen = null;
        await requestSignedDocumentUrl('circular', token, (u, o, t) => {
            seen = { u, o, t };
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ url: 'x' }) });
        });
        assert.equal(seen.u, DOCUMENT_URL_ENDPOINT);
        assert.equal(seen.o.method, 'POST');
        assert.equal(seen.o.headers.Authorization, 'Bearer tok');
        assert.equal(seen.o.headers['Content-Type'], 'application/json',
            'without this header firebase-functions leaves req.body unparsed, and the server reads '
            + 'the kind as missing — the exact trap v24.17 fixed on the other side');
        assert.deepEqual(JSON.parse(seen.o.body), { kind: 'circular' });
        assert.equal(seen.t, DOCUMENT_URL_TIMEOUT_MS);
    });
});

describe('EVERY refusal falls back, because every one of them is ordinary', () => {

    test('503 — the IAM grant is missing, which is the state the app ships in', async () => {
        assert.equal(await requestSignedDocumentUrl('huddle', token, res(503)), null,
            'a 503 body carrying a url must still be refused — the STATUS is what decides');
    });

    test('403, 404, 401 and 500 all fall back too', async () => {
        for (const status of [401, 403, 404, 500, 502]) {
            assert.equal(await requestSignedDocumentUrl('huddle', token, res(status)), null,
                `${status} did not fall back`);
        }
    });

    test('a thrown fetch — offline, or the timeout — falls back rather than propagating', async () => {
        // An offline-first app must never turn a document into a dead button, and a caller that had
        // to try/catch this would be a caller that could forget to.
        for (const boom of [new Error('offline'), new DOMException('aborted', 'AbortError')]) {
            assert.equal(await requestSignedDocumentUrl('huddle', token, () => Promise.reject(boom)), null);
        }
    });

    test('a token that cannot be obtained falls back', async () => {
        assert.equal(await requestSignedDocumentUrl('huddle', () => Promise.reject(new Error('no token')), res(200, { url: 'x' })), null);
    });

    test('a 200 carrying no usable url is NOT a url', async () => {
        // The direction that reaches window.open with `undefined`.
        for (const body of [{}, { url: null }, { url: '' }, { url: 42 }, { url: {} }, null]) {
            assert.equal(await requestSignedDocumentUrl('huddle', token, res(200, body)), null,
                `${JSON.stringify(body)} was treated as a url`);
        }
    });

    test('a body that will not parse falls back', async () => {
        assert.equal(await requestSignedDocumentUrl('huddle', token, () => Promise.resolve({
            ok: true, status: 200, json: () => Promise.reject(new SyntaxError('not json')),
        })), null);
    });
});

describe('the window it asks for', () => {
    test('long enough to be worth asking, short enough not to stall an open', async () => {
        // Both directions: this sits between a tap and a document, with a working url already in
        // hand, so a long wait is worse than not asking at all.
        assert.ok(DOCUMENT_URL_TIMEOUT_MS >= 3_000, 'too short: a phone on poor signal would never get one');
        assert.ok(DOCUMENT_URL_TIMEOUT_MS <= 15_000, 'too long: the stored url is right there');
    });
});
