// @ts-check
/**
 * operations-doc-links.test.mjs — what Operations → Document links SAYS, and what it SENDS
 * (operations-doc-links.js; the server is functions/doc-link-rotation.js, tested by
 * doc-link-rotation.test.mjs and documents-endpoints.test.mjs). Part of test:hygiene.
 *
 * Organised by the three ways this card could mislead the admin who presses it:
 *  - CLAIMING NOTHING CHANGED WHEN IT MAY HAVE. A run whose answer is lost may have finished, so
 *    "nothing was changed" is said only where it is known — the endpoint itself said so, or the
 *    request never left — never on a 503 the platform sent when an instance died halfway through
 *    the writes, and never on a timeout.
 *  - CLAIMING IT IS DONE WHEN IT IS NOT. A run that changed nothing and failed on a file must not
 *    lead with "Done.", and neither an answer this card cannot read nor a preview that could not
 *    check its files is shown as "nothing to replace".
 *  - ASKING FOR A RUN BY ACCIDENT. The body says `rotate: true` only when the caller passed `true`
 *    itself; anything else is a preview, as it is on the server.
 * The wiring — the confirm, the buttons, the request leaving the real page — is e2e/operations.spec.js.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
    ROTATE_LINKS_URL, requestLinkRotation, describePreview, describeResult, checkFailure, runFailure,
} from './operations-doc-links.js';
import { FETCH_TIMEOUT_CODE } from './fetch-timeout.js';

const { rotateDocumentLinks, downloadUrl } = createRequire(import.meta.url)('./functions/doc-link-rotation.js');

/** A report as the server sends one; `over` replaces fields. @param {Record<string, any>} [over] */
const report = (over = {}) => ({
    rotate: false, files: 0, linked: 0, unlinkedWithKey: 0, unlinkedWithoutKey: 0, held: 0,
    recordsMissingFile: 0, recordsUnreadable: 0, recordsWithoutLink: 0,
    rotated: 0, cleared: 0, changedDuringRun: 0, failed: [], ...over,
});

/** The error requestLinkRotation throws for an HTTP answer. @param {number} status @param {string} body */
const answered = (status, body) => new Error(`Server responded ${status}: ${body}`);

describe('requestLinkRotation — a run only when asked for in so many words', () => {
    /** A fetch that records what it was given and answers with `reply`. */
    function recordingFetch(reply = { ok: true, status: 200, json: async () => report(), text: async () => '' }) {
        /** @type {any[]} */
        const calls = [];
        /** @type {any} */
        const fetchFn = async (/** @type {any[]} */ ...args) => { calls.push(args); return reply; };
        return { calls, fetchFn };
    }

    test('rotate: true is sent only for true itself — a truthy look-alike asks for a preview', async () => {
        for (const [rotate, sent] of /** @type {[any, boolean][]} */ ([
            [true, true], [false, false], ['true', false], [1, false], [undefined, false], [{}, false],
        ])) {
            const { calls, fetchFn } = recordingFetch();
            await requestLinkRotation({ rotate, getToken: async () => 'tok', fetchFn });
            assert.deepEqual(JSON.parse(calls[0][1].body), { rotate: sent }, `rotate: ${JSON.stringify(rotate)}`);
        }
    });

    test('it POSTs to the endpoint as the signed-in admin, and waits past the server’s own 300 s', async () => {
        const { calls, fetchFn } = recordingFetch();
        await requestLinkRotation({ rotate: true, getToken: async () => 'id-token', fetchFn });
        const [url, init, timeoutMs] = calls[0];
        assert.equal(url, ROTATE_LINKS_URL);
        assert.equal(url, 'https://europe-west2-myb-roster.cloudfunctions.net/rotateDocumentLinks');
        assert.equal(init.method, 'POST');
        assert.equal(init.headers.Authorization, 'Bearer id-token');
        assert.equal(init.headers['Content-Type'], 'application/json');
        // Giving up first would report a run as unknown while the server was still finishing it.
        assert.ok(timeoutMs > 300_000, `the client gives up after ${timeoutMs} ms`);
    });

    test('an HTTP failure throws with its status and body, for the failure wording to read', async () => {
        const { fetchFn } = recordingFetch({ ok: false, status: 403, json: async () => ({}), text: async () => '{"error":"Forbidden — admin claim required"}' });
        await assert.rejects(
            requestLinkRotation({ rotate: false, getToken: async () => 'tok', fetchFn }),
            /^Error: Server responded 403: \{"error":"Forbidden — admin claim required"\}$/);
    });

    test('no token, no request', async () => {
        const { calls, fetchFn } = recordingFetch();
        await assert.rejects(requestLinkRotation({ rotate: true, getToken: async () => { throw new Error('Not signed in'); }, fetchFn }));
        assert.equal(calls.length, 0);
    });
});

describe('describePreview — what a run would touch, and only from an answer it can read', () => {
    test('an answer it cannot read is null — never "nothing to replace"', () => {
        for (const bad of [null, undefined, 'ok', {}, report({ rotate: true }), report({ linked: -1 }),
            report({ linked: 1.5 }), report({ files: '3' }), report({ failed: null }), { ...report(), linked: undefined },
            { ...report(), held: undefined }]) {
            assert.equal(describePreview(bad), null, JSON.stringify(bad));
        }
    });

    test('files in use and older files with a key are what a run replaces — and only they offer it', () => {
        const one = describePreview(report({ files: 1, linked: 1 }));
        assert.ok(one);
        assert.equal(one.canReplace, true);
        assert.match(one.lines[0], /^1 file is in use\. It gets a new link/);
        assert.match(one.lines.at(-1) ?? '', /^Nothing has changed yet\./);

        const many = describePreview(report({ files: 5, linked: 3, unlinkedWithKey: 2 }));
        assert.ok(many);
        assert.equal(many.canReplace, true);
        assert.match(many.lines[0], /^3 files are in use\. Each gets a new link/);
        assert.match(many.lines[1], /^2 older files are no longer used by the app\. Their links will simply stop working\./);

        const olderOnly = describePreview(report({ files: 1, unlinkedWithKey: 1 }));
        assert.equal(olderOnly?.canReplace, true, 'a forgotten file with a working link is worth replacing too');
    });

    test('nothing to replace says why — no files at all, or none with a link that works', () => {
        const empty = describePreview(report());
        assert.deepEqual(empty, { canReplace: false, lines: ['No Huddle, Circular or Newsletter files were found, so there is nothing to replace.'] });
        const dead = describePreview(report({ files: 2, unlinkedWithoutKey: 2 }));
        assert.equal(dead?.canReplace, false);
        assert.equal(dead?.lines[0], 'No file has a link that still works, so there is nothing to replace.');
        assert.ok(!dead?.lines.some(l => /Nothing has changed yet/.test(l)), 'no reassurance about a run that is not offered');
    });

    test('a file held by a link this cannot read is named, and never called "no link that works"', () => {
        const onlyHeld = describePreview(report({ files: 1, held: 1, recordsUnreadable: 1 }));
        assert.ok(onlyHeld);
        assert.equal(onlyHeld.canReplace, false);
        assert.equal(onlyHeld.lines[0], 'There is nothing this can safely replace.');
        assert.ok(onlyHeld.lines.includes('1 file is left as it is, old link and all: a document’s link this can’t read may open it.'));
        const some = describePreview(report({ files: 3, linked: 1, held: 2, recordsUnreadable: 2 }));
        assert.equal(some?.canReplace, true, 'a held file does not stop the others');
        assert.ok(some?.lines.includes('2 files are left as they are, old links and all: documents’ links this can’t read may open them.'));
    });

    test('records it will leave alone, and files it could not check, are named — not hidden', () => {
        const p = describePreview(report({ files: 3, linked: 1, recordsMissingFile: 2, recordsUnreadable: 1, failed: [{ path: 'huddles/x.pdf', step: 'read' }] }));
        assert.ok(p);
        assert.ok(p.lines.includes('2 documents point at files that are no longer there, so their links already don’t work.'));
        assert.ok(p.lines.includes('1 document has a link this can’t read. It will be left as it is.'));
        assert.ok(p.lines.includes('1 file couldn’t be checked.'));
    });

    test('files it could not check are never "nothing to replace" — it says so once, and asks for another check', () => {
        // An unchecked file is in no box, so with nothing else to offer the preview looked exactly like
        // one that found no working link — while every file it could not read may still have one.
        const failed = [{ path: 'huddles/a.pdf', step: 'read' }, { path: 'circulars/b.docx', step: 'read' }];
        for (const p of [describePreview(report({ files: 2, recordsUnreadable: 1, failed })),
            describePreview(report({ files: 3, held: 1, recordsUnreadable: 1, unlinkedTooNew: 1, failed }))]) {
            assert.ok(p);
            assert.equal(p.canReplace, false);
            assert.equal(p.lines[0], '2 files couldn’t be checked, so it isn’t known yet whether there is anything to replace. Check the links again in a minute.');
            assert.ok(!p.lines.some(l => /nothing to replace|nothing this can safely replace|link that still works/i.test(l)), p.lines.join(' / '));
            assert.equal(p.lines.filter(l => /couldn’t be checked/.test(l)).length, 1, p.lines.join(' / '));
        }
        assert.equal(describePreview(report({ files: 1, failed: [failed[0]] }))?.lines[0],
            '1 file couldn’t be checked, so it isn’t known yet whether there is anything to replace. Check the links again in a minute.');
    });

    test('unused files from the last day are named, left working and not offered — "nothing to replace YET"', () => {
        const only = describePreview(report({ files: 1, unlinkedTooNew: 1 }));
        assert.deepEqual(only, { canReplace: false, lines: [
            'There is nothing to replace yet.',
            '1 file from the last day isn’t used by the app, so its link is left working, in case an upload is still saving the document that uses it. Check again tomorrow to finish it.',
        ] });
        const mixed = describePreview(report({ files: 5, linked: 2, unlinkedWithKey: 1, unlinkedTooNew: 2 }));
        assert.equal(mixed?.canReplace, true);
        assert.ok(mixed?.lines.includes('2 files from the last day aren’t used by the app, so their links are left working, in case uploads are still saving the documents that use them. Check again tomorrow to finish them.'));
    });

    test('an older server’s report, without the newest count, still reads — a malformed one does not', () => {
        // Functions and Hosting deploy in parallel, so this card can meet a server that predates the count.
        const older = report({ files: 2, linked: 1, unlinkedWithKey: 1 });
        assert.ok(!('unlinkedTooNew' in older));
        assert.equal(describePreview(older)?.canReplace, true);
        assert.equal(describeResult({ ...older, rotate: true, rotated: 1, cleared: 1 })?.ok, true);
        for (const bad of [-1, 1.5, '1', null]) {
            assert.equal(describePreview(report({ files: 1, unlinkedTooNew: bad })), null, JSON.stringify(bad));
            assert.equal(describeResult(report({ rotate: true, unlinkedTooNew: bad })), null, JSON.stringify(bad));
        }
    });

    test('the server’s own preview, when no file’s keys could be read, is read as "couldn’t check" (the real module)', async () => {
        // Through the real rotation: a stored link it cannot read, carrying a key, makes it read every
        // file's keys — and every read fails.
        const B = 'myb-roster.appspot.com';
        const files = ['huddles/2026-11-12-a1.pdf', 'circulars/2026-11-06-b2.docx'];
        const bucket = { name: B, getFiles: async (/** @type {{ prefix: string }} */ { prefix }) => [files.filter(p => p.startsWith(prefix))
            .map(name => ({ name, getMetadata: async () => { throw new Error('read failed'); } }))] };
        /** @type {Record<string, any[]>} */
        const records = {
            huddles: [{ storageUrl: downloadUrl(B, files[0], 'old-h') }],
            circulars: [{ storageUrl: downloadUrl(B, files[1], 'old-c') }],
            newsletters: [{ storageUrl: 'https://example.com/n.pdf?token=zzz' }],
        };
        const db = { collection: (/** @type {string} */ name) => ({ get: async () => ({
            docs: (records[name] || []).map((d, i) => ({ ref: { path: `${name}/${i}` }, data: () => d })) }) }) };
        const said = describePreview(await rotateDocumentLinks({ bucket, db, newKey: () => 'k' }));
        assert.equal(said?.canReplace, false);
        assert.match(said?.lines[0] ?? '', /^2 files couldn’t be checked, so it isn’t known yet/);
    });
});

describe('describeResult — "Done." only for what was done', () => {
    test('an answer it cannot read is null, and so is a preview’s', () => {
        for (const bad of [null, {}, report(), report({ rotate: true, rotated: -1 }), report({ rotate: true, failed: 'x' })]) {
            assert.equal(describeResult(bad), null, JSON.stringify(bad));
        }
    });

    test('new links and switched-off links are reported, and a clean run is ok', () => {
        const r = describeResult(report({ rotate: true, rotated: 4, cleared: 1 }));
        assert.deepEqual(r, { ok: true, lines: [
            'Done. 4 files have new links, so old copies of their links no longer work.',
            '1 unused file had its link switched off.',
        ] });
        const clearedOnly = describeResult(report({ rotate: true, cleared: 2 }));
        assert.equal(clearedOnly?.lines[0], 'Done. 2 unused files had their links switched off.');
    });

    test('a file left unchanged makes the run not ok, says its old link still works, and asks for another press', () => {
        const r = describeResult(report({ rotate: true, rotated: 2, failed: [{ path: 'huddles/a.pdf', step: 'contract' }] }));
        assert.ok(r);
        assert.equal(r.ok, false);
        assert.equal(r.lines.at(-1), '1 file couldn’t be changed, and its old link still works. Press Replace the links again — it’s safe to run again.');
    });

    test('a run that changed nothing and failed does not begin "Done."', () => {
        const r = describeResult(report({ rotate: true, failed: [{ path: 'a', step: 'expand' }, { path: 'b', step: 'migrate' }] }));
        assert.ok(r);
        assert.equal(r.ok, false);
        assert.ok(!r.lines.some(l => l.startsWith('Done.')), r.lines.join(' / '));
        assert.match(r.lines[0], /^2 files couldn’t be changed, and their old links still work\./);
    });

    test('a run names the unused files from the last day it left working — not a failure, and not "nothing"', () => {
        assert.deepEqual(describeResult(report({ rotate: true, rotated: 3, unlinkedTooNew: 1 })), { ok: true, lines: [
            'Done. 3 files have new links, so old copies of their links no longer work.',
            '1 file from the last day isn’t used by the app, so its link was left working, in case an upload is still saving the document that uses it. Check again tomorrow to finish it.',
        ] });
        assert.deepEqual(describeResult(report({ rotate: true, unlinkedTooNew: 2 })), { ok: true, lines: [
            '2 files from the last day aren’t used by the app, so their links were left working, in case uploads are still saving the documents that use them. Check again tomorrow to finish them.',
        ] });
    });

    test('a file that changed mid-run is said plainly, with what to do — and is not a failure', () => {
        const r = describeResult(report({ rotate: true, rotated: 1, changedDuringRun: 1 }));
        assert.equal(r?.ok, true);
        assert.ok(r?.lines.includes('1 file changed while this ran — a new upload, perhaps — so it was left alone. Check the links again to finish it.'));
        const held = describeResult(report({ rotate: true, rotated: 1, held: 1 }));
        assert.ok(held?.lines.includes('1 file is left as it is, old link and all: a document’s link this can’t read may open it.'),
            'a run must not let the admin believe a held file was replaced');
        assert.deepEqual(describeResult(report({ rotate: true })), { ok: true, lines: ['Nothing needed changing.'] });
    });
});

describe('runFailure — "nothing was changed" only where the endpoint said so', () => {
    const UNKNOWN = /^It isn’t known whether it finished\. Press Replace the links again to make sure — running it twice is safe\.$/;

    test('a refusal is an answer, and the run never started', () => {
        assert.equal(runFailure(answered(403, '{"error":"Forbidden — admin claim required"}')),
            'Couldn’t replace the links: Forbidden — admin claim required. Nothing was changed.');
        assert.equal(runFailure(answered(401, '{"error":"Unauthorised"}')),
            'Couldn’t replace the links: Unauthorised. Nothing was changed.');
    });

    test('the endpoint’s own 503 says nothing changed; the platform’s 503 proves nothing', () => {
        assert.equal(runFailure(answered(503, JSON.stringify({ error: 'Couldn’t read the documents, so nothing was changed', changed: false }))),
            'Couldn’t read the documents, so nothing was changed. Try again in a minute.');
        // An instance that died halfway through the writes answers 503 too — with the platform's page.
        assert.match(runFailure(answered(503, '<html><body>Service Unavailable</body></html>')), UNKNOWN);
        assert.match(runFailure(answered(503, '{"error":"Service Unavailable"}')), UNKNOWN, 'JSON without changed: false');
        assert.match(runFailure(answered(503, '{"changed":"false"}')), UNKNOWN, 'only the boolean counts');
    });

    test('a timeout, a lost connection or any other 5xx is unknown — never failed, never done', () => {
        const timedOut = Object.assign(new Error('Request timed out after 310s'), { code: FETCH_TIMEOUT_CODE });
        for (const err of [timedOut, new TypeError('Failed to fetch'), answered(500, 'oops'),
            answered(504, 'upstream request timeout'), answered(408, '{"error":"Request Timeout"}')]) {
            const said = runFailure(err);
            assert.match(said, UNKNOWN, String(err.message));
            assert.doesNotMatch(said, /nothing was changed/i);
        }
    });

    test('a request that never left — no sign-in token — changed nothing, and says so rather than "isn’t known"', async () => {
        // Through requestLinkRotation itself, so the answer is about the error it really throws.
        /** @type {any[]} */
        const calls = [];
        /** @type {any} */
        const fetchFn = async (/** @type {any[]} */ ...args) => { calls.push(args); return { ok: true, json: async () => report() }; };
        const err = await requestLinkRotation({ rotate: true, getToken: async () => { throw new Error('Not signed in'); }, fetchFn })
            .then(() => null, (/** @type {any} */ e) => e);
        assert.equal(calls.length, 0, 'a request left');
        assert.equal(runFailure(err),
            'Couldn’t replace the links: the request was never sent, so nothing was changed. Check your connection and try again.');
        assert.equal(checkFailure(err), 'Couldn’t check the links — check your connection and try again.');
        // A request that DID leave and then failed may have finished: still unknown.
        assert.match(runFailure(new TypeError('Failed to fetch')), UNKNOWN);
    });

    test('a check that fails changes nothing either way, so it only says what to do', () => {
        assert.equal(checkFailure(answered(403, '{"error":"Forbidden — admin claim required"}')),
            'Couldn’t check the links: Forbidden — admin claim required');
        assert.equal(checkFailure(new TypeError('Failed to fetch')),
            'Couldn’t check the links — check your connection and try again.');
    });

    test('a platform page is not read out as a reason — its status is', () => {
        const page = answered(404, '<html><head><title>404 Page not found</title></head><body>Not Found</body></html>');
        assert.equal(checkFailure(page), 'Couldn’t check the links: the server answered 404');
        assert.equal(runFailure(page), 'Couldn’t replace the links: the server answered 404. Nothing was changed.');
    });
});
