/**
 * Unit tests for storage-utils.js — the pure Storage helpers extracted from firebase-client.js.
 * Run (no mocks): node --test storage-utils.test.mjs
 *
 * isSafeStorageUrl is a SECURITY control (the download-URL allowlist for the Huddle/Circular/
 * Newsletter open buttons), so its boundaries are worth exact coverage.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isSafeStorageUrl, isDocxUpload } from './storage-utils.js';

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
