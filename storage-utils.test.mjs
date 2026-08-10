/**
 * Unit tests for storage-utils.js — the pure Storage helpers extracted from firebase-client.js.
 * Run (no mocks): node --test storage-utils.test.mjs
 *
 * isSafeStorageUrl is a SECURITY control (the download-URL allowlist for the Huddle/Circular/
 * Newsletter open buttons), so its boundaries are worth exact coverage.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isSafeStorageUrl, isDocxUpload, officeViewerUrl, sixMonthCutoffISO, legacyDocPath, versionedDocPath, uploadMimeType } from './storage-utils.js';

describe('isSafeStorageUrl', () => {
    test('accepts a Firebase download URL under this project bucket', () => {
        assert.equal(isSafeStorageUrl('https://firebasestorage.googleapis.com/v0/b/myb-roster.firebasestorage.app/o/huddles%2F2026-06-25.pdf?alt=media&token=abc'), true);
        assert.equal(isSafeStorageUrl('https://firebasestorage.googleapis.com/v0/b/myb-roster.appspot.com/o/circulars%2Fx.pdf?alt=media'), true);
    });
    test('accepts a GCS storage.googleapis.com URL under this project bucket', () => {
        assert.equal(isSafeStorageUrl('https://storage.googleapis.com/myb-roster.firebasestorage.app/huddles/x.pdf'), true);
        assert.equal(isSafeStorageUrl('https://storage.googleapis.com/myb-roster.appspot.com/x.pdf'), true);
    });
    test('rejects http (non-TLS)', () => {
        assert.equal(isSafeStorageUrl('http://firebasestorage.googleapis.com/v0/b/myb-roster.firebasestorage.app/o/x.pdf'), false);
    });
    test('rejects a Firebase Storage URL for a DIFFERENT bucket', () => {
        assert.equal(isSafeStorageUrl('https://firebasestorage.googleapis.com/v0/b/other-project.appspot.com/o/x.pdf?alt=media'), false);
    });
    test('rejects a look-alike bucket that shares our prefix (the trailing-slash anchor)', () => {
        // 'myb-rosterX' would match a bare '/myb-roster' prefix — the anchored '/myb-roster.../' must not.
        assert.equal(isSafeStorageUrl('https://storage.googleapis.com/myb-roster.firebasestorage.app.evil.com/x.pdf'), false);
        assert.equal(isSafeStorageUrl('https://storage.googleapis.com/myb-rosterX-hacker/x.pdf'), false);
        assert.equal(isSafeStorageUrl('https://firebasestorage.googleapis.com/v0/b/myb-roster.appspot.com.evil/o/x.pdf'), false);
    });
    test('rejects an unrelated https host entirely', () => {
        assert.equal(isSafeStorageUrl('https://evil.example.com/myb-roster.appspot.com/x.pdf'), false);
        assert.equal(isSafeStorageUrl('https://google.com'), false);
    });
    test('rejects a bucket in the QUERY or fragment rather than the path', () => {
        assert.equal(isSafeStorageUrl('https://evil.com/x?b=/v0/b/myb-roster.appspot.com/'), false);
        assert.equal(isSafeStorageUrl('https://storage.googleapis.com/evil/x#/myb-roster.appspot.com/'), false);
    });
    test('rejects non-string / empty / malformed input', () => {
        assert.equal(isSafeStorageUrl(null), false);
        assert.equal(isSafeStorageUrl(undefined), false);
        assert.equal(isSafeStorageUrl(''), false);
        assert.equal(isSafeStorageUrl(42), false);
        assert.equal(isSafeStorageUrl('not a url'), false);
        assert.equal(isSafeStorageUrl('javascript:alert(1)'), false);
    });
});

describe('isDocxUpload', () => {
    const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    test('true for a .docx extension (any case)', () => {
        assert.equal(isDocxUpload({ name: 'circular.docx', type: '' }), true);
        assert.equal(isDocxUpload({ name: 'Circular.DOCX', type: '' }), true);
    });
    test('true for the docx MIME even when the name lacks the extension (cloud/Android picker)', () => {
        assert.equal(isDocxUpload({ name: 'document', type: DOCX_MIME }), true);
    });
    test('false for a PDF (neither extension nor MIME matches)', () => {
        assert.equal(isDocxUpload({ name: 'circular.pdf', type: 'application/pdf' }), false);
    });
    test('false for a name that only CONTAINS "docx" mid-string', () => {
        assert.equal(isDocxUpload({ name: 'my.docx.pdf', type: 'application/pdf' }), false);
    });
    test('false for application/zip (we intentionally do NOT broaden to zip — would accept xlsx/pptx)', () => {
        assert.equal(isDocxUpload({ name: 'sheet', type: 'application/zip' }), false);
    });
});

describe('officeViewerUrl', () => {
    const SRC = 'https://firebasestorage.googleapis.com/v0/b/myb-roster.firebasestorage.app/o/circulars%2F2026-06-25-abc.docx?alt=media&token=xyz';
    test('wraps the URL in the Office Online full-page viewer (view.aspx)', () => {
        const out = officeViewerUrl(SRC);
        assert.equal(out.startsWith('https://view.officeapps.live.com/op/view.aspx?src='), true);
    });
    test('percent-encodes the source URL so its query string cannot leak into the viewer query', () => {
        const out = officeViewerUrl(SRC);
        // The whole source (incl. its ?alt=media&token=xyz) must be a single encoded src value —
        // no bare '&' or '?' from the source may appear after the src= parameter.
        const encoded = out.slice('https://view.officeapps.live.com/op/view.aspx?src='.length);
        assert.equal(encoded, encodeURIComponent(SRC));
        assert.equal(decodeURIComponent(encoded), SRC);
        assert.equal(encoded.includes('&'), false);
    });
});

describe('sixMonthCutoffISO', () => {
    test('a mid-month date subtracts exactly six months', () => {
        assert.equal(sixMonthCutoffISO(new Date(2026, 6, 15)), '2026-01-15'); // 15 Jul → 15 Jan
    });
    test('crosses the year boundary when the month underflows', () => {
        assert.equal(sixMonthCutoffISO(new Date(2026, 2, 10)), '2025-09-10'); // 10 Mar → 10 Sep (prev year)
    });
    test('clamps a month-end day the target month does not have (the whole point)', () => {
        // 31 Aug − 6 months = "31 Feb", which JS would roll forward to 3 Mar and delete docs
        // ~5 months 29 days old. Clamp to 28 Feb instead.
        assert.equal(sixMonthCutoffISO(new Date(2026, 7, 31)), '2026-02-28'); // 31 Aug → 28 Feb
        // 31 Oct − 6 months = "31 Apr" (April has 30 days) → clamp to 30 Apr.
        assert.equal(sixMonthCutoffISO(new Date(2026, 9, 31)), '2026-04-30'); // 31 Oct → 30 Apr
    });
    test('leap-year February clamps to the 29th', () => {
        assert.equal(sixMonthCutoffISO(new Date(2028, 7, 31)), '2028-02-29'); // 2028 is a leap year
    });
    test('zero-pads single-digit month and day', () => {
        assert.equal(sixMonthCutoffISO(new Date(2026, 8, 5)), '2026-03-05'); // 5 Sep → 05 Mar
    });
});

describe('legacyDocPath — the pre-v13.99 fixed path, ONE rule for both deciders', () => {
    // The two call sites that decide which OLD Storage object to delete (the upload engine's
    // cleanup and the 6-month prune) each hand-wrote this fallback until v20.55 — one with
    // `?? 'pdf'`, one with `|| 'pdf'`, which disagree exactly on a doc carrying `fileType: ''`.
    // A drift here never errors: it orphans a file, or deletes the wrong one.
    test('honours the legacy doc’s own fileType', () => {
        assert.equal(legacyDocPath('circulars', '2026-06-27', 'docx'), 'circulars/2026-06-27.docx');
    });
    test('defaults to pdf when fileType is missing — DOCX support postdates storagePath', () => {
        assert.equal(legacyDocPath('newsletters', '2026-06-27', undefined), 'newsletters/2026-06-27.pdf');
    });
    test('an empty-string fileType falls back to pdf, never "date.." (the ??-vs-|| divergence)', () => {
        assert.equal(legacyDocPath('circulars', '2026-06-27', ''), 'circulars/2026-06-27.pdf');
    });
});

describe('versionedDocPath — the v13.99 upload path', () => {
    test('shape: {collection}/{date}-{uploadId}.{ext}', () => {
        assert.equal(versionedDocPath('huddles', '2026-06-25', 'lv9kab12', 'pdf'),
            'huddles/2026-06-25-lv9kab12.pdf');
    });
    test('starts with the {collection}/{date} prefix the server-side huddle prune sweeps by', () => {
        // pruneOldHuddles (functions/documents.js) reclaims a date's objects with a
        // `huddles/<date>` prefix listing — versioned AND legacy paths must both sit under it,
        // or a pruned date leaves its file behind forever.
        const date = '2026-06-25';
        for (const p of [versionedDocPath('huddles', date, 'abc123', 'docx'),
                         legacyDocPath('huddles', date, 'pdf')]) {
            assert.ok(p.startsWith(`huddles/${date}`), `${p} escapes the prune prefix`);
        }
    });
});

describe('uploadMimeType — the explicit Content-Type map', () => {
    test('docx gets the Word MIME (Android may report application/zip)', () => {
        assert.equal(uploadMimeType('docx'),
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    });
    test('pdf gets application/pdf', () => {
        assert.equal(uploadMimeType('pdf'), 'application/pdf');
    });
});
