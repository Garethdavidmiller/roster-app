/**
 * Unit tests for the pure file-type gate in doc-upload.js — isPdfFile / isDocxFile. These guard every
 * Operations upload (Circular / Newsletter / Huddle): a regression that mis-classifies a file would
 * reject a valid upload or (worse) accept a wrong type past the client gate. They were untested.
 *
 * Run: node --experimental-test-module-mocks --test doc-upload.test.mjs
 * session.js / roster-data.js are mocked only so the module loads in Node (its Firebase transitive
 * import can't); the functions under test are pure and touch neither.
 */
import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';

mock.module('./session.js', { namedExports: { sessionReady: Promise.resolve() } });
mock.module('./roster-data.js', { namedExports: { formatISO: () => '2026-07-24' } });

const { isPdfFile, isDocxFile } = await import('./doc-upload.js');

/** File-like stub. */
const f = (/** @type {string} */ type, /** @type {string} */ name) => ({ type, name });
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('isPdfFile', () => {
    test('accepts by MIME type', () => {
        assert.equal(isPdfFile(f('application/pdf', 'huddle')), true);
    });
    test('accepts by .pdf extension even when the MIME is missing/wrong (some browsers)', () => {
        assert.equal(isPdfFile(f('', 'Daily Huddle.pdf')), true);
        assert.equal(isPdfFile(f('application/octet-stream', 'plan.PDF')), true, 'case-insensitive extension');
    });
    test('rejects a non-PDF', () => {
        assert.equal(isPdfFile(f(DOCX_MIME, 'circular.docx')), false);
        assert.equal(isPdfFile(f('image/png', 'scan.png')), false);
        assert.equal(isPdfFile(f('', 'notes.txt')), false);
    });
    test('does not accept a name that merely CONTAINS "pdf" (must END with .pdf)', () => {
        assert.equal(isPdfFile(f('', 'pdf-notes.docx')), false);
    });
});

describe('isDocxFile', () => {
    test('accepts by the Word MIME type', () => {
        assert.equal(isDocxFile(f(DOCX_MIME, 'circular')), true);
    });
    test('accepts by .docx extension when the MIME is missing', () => {
        assert.equal(isDocxFile(f('', 'Retail Circular.docx')), true);
        assert.equal(isDocxFile(f('application/octet-stream', 'news.DOCX')), true, 'case-insensitive extension');
    });
    test('rejects a PDF and other types', () => {
        assert.equal(isDocxFile(f('application/pdf', 'huddle.pdf')), false);
        assert.equal(isDocxFile(f('', 'old.doc')), false, 'legacy .doc is not .docx');
    });
});
