/**
 * doc-upload.js — the pure file-type gate (isPdfFile / isDocxFile), and the CARD itself, driven.
 *
 * The file-type gate guards every Operations upload (Circular / Newsletter / Huddle): a regression
 * that mis-classifies a file would reject a valid upload or (worse) accept a wrong type past the
 * client gate.
 *
 * The card (whole-app review, 10 Nov 2026) is driven through a small fake DOM, and where what the
 * admin is TOLD depends on the upload engine, through the REAL `documents-client.js` with fakes only
 * at the Firebase boundary — "the rule tested, the wiring not" is how a card came to say "Upload
 * failed" about a document the engine had just judged may be live.
 *
 * Run: node --experimental-test-module-mocks scripts/run-tests.mjs doc-upload.test.mjs
 * session.js / roster-data.js are mocked only so the module loads in Node (its Firebase transitive
 * import can't); claim-retry.js, date-format.js, documents-client.js and upload-commit.js are real.
 */
import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

mock.module('./session.js', { namedExports: { sessionReady: Promise.resolve() } });
mock.module('./roster-data.js', { namedExports: {
    formatISO: () => '2026-11-10',
    // roster-data.js's own shape: local noon, so no zone or clock change can move the day.
    parseISODate: (/** @type {string} */ iso) => new Date(iso + 'T12:00:00'),
} });

const { isPdfFile, isDocxFile, initDocUploadCard } = await import('./doc-upload.js');
const claim = await import('./claim-retry.js');
const { buildDocumentClient } = await import('./documents-client.js');
const { resolveUploadCommit } = await import('./upload-commit.js');

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

// ── The card, driven ────────────────────────────────────────────────────────────────────────────

/**
 * A stand-in element: what the card reads and writes, and its listeners, which `fire` runs and
 * awaits. A file input's `value = ''` clears its files, as a browser's does. It does NOT model a
 * disabled control refusing events — a test that fires one is asking what the HANDLER does.
 * @param {string} id
 */
function el(id) {
    /** @type {Record<string, Function[]>} */ const listeners = {};
    const classes = new Set();
    /** @type {any[]} */ let files = [];
    let value = '';
    return {
        id, max: '', textContent: '', className: '', disabled: false, /** @type {Record<string,string>} */ dataset: {},
        get files() { return files; }, set files(v) { files = v; },
        get value() { return value; }, set value(v) { value = v; if (v === '') files = []; },
        classList: { add: (/** @type {string} */ c) => classes.add(c), remove: (/** @type {string} */ c) => classes.delete(c), contains: (/** @type {string} */ c) => classes.has(c) },
        addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { (listeners[t] ||= []).push(fn); },
        dispatchEvent: (/** @type {Event} */ e) => { for (const fn of listeners[e.type] || []) fn(e); return true; },
        fire: (/** @type {string} */ t) => Promise.all((listeners[t] || []).map(fn => fn({ type: t }))),
    };
}

/**
 * Wire one card into a fresh fake page and return its elements.
 * @param {Record<string, any>} cfg  overrides for the card's config — `uploadFn` at least
 */
function card(cfg) {
    const els = { date: el('date'), file: el('file'), label: el('label'), btn: el('btn'), feedback: el('feedback') };
    /** @type {Record<string, any>} */ const byId = { d: els.date, f: els.file, l: els.label, b: els.btn, fb: els.feedback };
    /** @type {any} */ (globalThis).document = {
        getElementById: (/** @type {string} */ id) => byId[id] ?? null,
        // The exact question Operations' busy check asks (operations-app.js `_opsBusy`).
        querySelector: (/** @type {string} */ sel) => (sel === '[data-uploading]' && els.btn.dataset.uploading ? els.btn : null),
    };
    initDocUploadCard({
        dateId: 'd', fileId: 'f', fileLabelId: 'l', uploadBtnId: 'b', feedbackId: 'fb',
        currentUser: 'Admin', btnLabel: 'Upload Huddle', logPrefix: 'Huddle',
        successMsg: (/** @type {string} */ date) => `Huddle uploaded for ${date} — staff will see it on the main app`,
        ...cfg,
    });
    return els;
}

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31]);
/** A picked PDF, readable as the upload engine reads one. @param {string} name */
const pdf = name => ({ name, type: 'application/pdf', size: PDF.length,
    slice: (/** @type {number} */ a, /** @type {number} */ b) => ({ arrayBuffer: async () => PDF.slice(a, b).buffer }),
    arrayBuffer: async () => PDF.buffer });

/** Choose a file the way the picker does. @param {ReturnType<typeof card>} els @param {any} file */
const pick = (els, file) => { els.file.files = [file]; return els.file.fire('change'); };
const tick = () => new Promise(r => setTimeout(r, 0));

/**
 * The REAL upload engine with a fake Firestore and Storage behind it. `fail(n)` names the error the
 * n-th write (plain or transactional) ends with; `deleted` is what happened to the files.
 * @param {{ fail?: (n: number) => string|null, guardCommit?: (p: Promise<any>) => Promise<any> }} [opts]
 */
function engine(opts = {}) {
    const store = new Map();
    /** @type {string[]} */ const deleted = [];
    /** @type {string[]} */ const uploaded = [];
    let writes = 0;
    const read = (/** @type {any} */ r) => { const v = store.get(r._key); return { exists: () => v !== undefined, data: () => v }; };
    const write = () => { writes++; const code = opts.fail?.(writes); if (code) throw Object.assign(new Error('boom'), { code }); };
    const client = buildDocumentClient({
        db: {}, collections: { huddles: 'huddles', circulars: 'circulars', newsletters: 'newsletters' },
        fs: {
            doc: (/** @type {any} */ _db, /** @type {string} */ c, /** @type {string} */ d) => ({ _key: `${c}/${d}` }),
            getDoc: async (/** @type {any} */ r) => read(r),
            getDocFromServer: async (/** @type {any} */ r) => read(r),   // a refused write is read back from it
            setDoc: async (/** @type {any} */ r, /** @type {any} */ data) => { write(); store.set(r._key, data); },
            runTransaction: async (/** @type {any} */ _db, /** @type {Function} */ fn) => {
                /** @type {any[]} */ const staged = [];
                await fn({ get: async (/** @type {any} */ r) => read(r), set: (/** @type {any} */ r, /** @type {any} */ d) => staged.push([r._key, d]) });
                write();
                for (const [k, d] of staged) store.set(k, d);
            },
            collection: () => ({}), query: () => ({}), where: () => ({}), orderBy: () => ({}), limit: () => ({}),
            getDocs: async () => ({ empty: true, docs: [] }), onSnapshot: () => () => {}, serverTimestamp: () => 'TS',
        },
        getStorageSdk: async () => ({
            storage: {}, ref: (/** @type {any} */ _s, /** @type {string} */ path) => ({ path }),
            uploadBytes: async (/** @type {any} */ r) => { uploaded.push(r.path); },
            getDownloadURL: async (/** @type {any} */ r) => `https://example.invalid/${r.path}`,
            deleteObject: async (/** @type {any} */ r) => { deleted.push(r.path); },
        }),
        uploadBytesWithClaimRetry: (/** @type {Function} */ up, /** @type {any} */ r, /** @type {any} */ f, /** @type {any} */ m) => up(r, f, m),
        utils: {
            isDocxUpload: () => false, uploadMimeType: () => 'application/pdf',
            legacyDocPath: (/** @type {string} */ c, /** @type {string} */ d, /** @type {string} */ t) => `${c}/${d}.${t || 'pdf'}`,
            versionedDocPath: (/** @type {string} */ c, /** @type {string} */ d, /** @type {string} */ id, /** @type {string} */ t) => `${c}/${d}-${id}.${t}`,
        },
        resolveUploadCommit, pruneOldDocs: async () => {}, sleep: async () => {},
        ...(opts.guardCommit ? { guardCommit: opts.guardCommit } : {}),
    });
    return { client, store, deleted, uploaded };
}

describe('one upload at a time, per card (cal-docs-4, whole-app review 10 Nov 2026)', () => {
    // The admin picks the wrong Circular, presses Upload, notices, and picks the right one. The card
    // used to come back to life at that pick, so a second upload for the same date ran beside the
    // first; whichever COMMITTED last became the live document, both said "uploaded", and the first
    // to finish dropped `data-uploading` while the other still ran.

    beforeEach(() => claim._resetUnconfirmedWrites());

    /** Start an upload that does not finish until `release()`. */
    async function inFlight() {
        /** @type {Function[]} */ const pending = [];
        let calls = 0;
        const els = card({ uploadFn: () => { calls++; return new Promise(r => pending.push(r)); } });
        await pick(els, pdf('wrong.pdf'));
        const first = els.btn.fire('click');
        await tick();
        return { els, calls: () => calls, release: async () => { pending.forEach(r => r('url')); await first; } };
    }

    test('the file picker is shut while an upload is in flight, and open again once it has its answer', async () => {
        const u = await inFlight();
        assert.equal(u.els.file.disabled, true, 'a new file cannot be picked mid-upload');
        await u.release();
        assert.equal(u.els.file.disabled, false, 'and the picker is back once the upload has answered');
    });

    test('a pick that reaches the card mid-upload changes nothing — Upload stays shut, the label keeps the file in flight', async () => {
        const u = await inFlight();
        assert.equal(u.els.btn.disabled, true);
        await pick(u.els, pdf('right.pdf'));
        assert.equal(u.els.btn.disabled, true, 'the re-pick did not bring Upload back for a second upload');
        assert.equal(u.els.label.textContent, 'wrong.pdf', 'the label still names the file being uploaded');
        await u.release();
    });

    test('a press that reaches the handler mid-upload starts no second upload, and the card stays busy until the one answer', async () => {
        const u = await inFlight();
        const second = u.els.btn.fire('click');
        await tick();
        assert.equal(u.calls(), 1, 'exactly one upload ran');
        assert.ok(document.querySelector('[data-uploading]'), 'Operations still sees an upload in flight');
        await u.release();
        await second;
        assert.equal(document.querySelector('[data-uploading]'), null, 'and stops seeing one when it has answered');
        assert.equal(u.els.feedback.textContent, 'Huddle uploaded for 10 Nov 2026 — staff will see it on the main app');
    });
});

describe('what the admin is told is what the engine decided (cal-docs-12, cal-docs-18, AUTH_AND_SESSIONS 22)', () => {

    beforeEach(() => claim._resetUnconfirmedWrites());

    test('cal-docs-18: the success line spells the date as app copy does, never the ISO key', async (t) => {
        t.mock.method(console, 'warn', () => {});
        const e = engine();
        const els = card({ uploadFn: (/** @type {string} */ d, /** @type {any} */ f, /** @type {string} */ u) => e.client.uploadCircular(d, f, u),
            successMsg: (/** @type {string} */ date) => `Circular uploaded for ${date} — staff can open it from ☰ → Weekly Retail Circular` });
        await pick(els, pdf('circular.pdf'));
        await els.btn.fire('click');
        assert.equal(els.feedback.textContent, 'Circular uploaded for 10 Nov 2026 — staff can open it from ☰ → Weekly Retail Circular');
        assert.ok(e.store.get('circulars/2026-11-10'), 'and it was filed under the ISO key, as before');
    });

    test('cal-docs-12: a retry that ends on a retriable code is "couldn\'t confirm", never "failed — try again" — and the file is kept', async (t) => {
        t.mock.method(console, 'warn', () => {});
        t.mock.method(console, 'error', () => {});
        // First write `deadline-exceeded` (may have landed), the read says it did not, and the
        // compare-and-set retry then ends `unavailable`. The engine keeps the file because the
        // document may name it — so the card must not call it a failure.
        const e = engine({ fail: n => (n === 1 ? 'deadline-exceeded' : 'unavailable') });
        const els = card({ uploadFn: (/** @type {string} */ d, /** @type {any} */ f, /** @type {string} */ u) => e.client.uploadCircular(d, f, u) });
        await pick(els, pdf('circular.pdf'));
        await els.btn.fire('click');
        assert.equal(els.feedback.textContent,
            "Couldn't confirm this saved — the connection dropped mid-save. Reload to see whether it's there, and upload again if it isn't.");
        assert.deepEqual(e.deleted, [], 'the file the document may name is kept');
    });

    test('signed out mid-upload: told to sign in again, counted by the page\'s gate, and the next upload is refused before it starts', async (t) => {
        t.mock.method(console, 'warn', () => {});
        t.mock.method(console, 'error', () => {});
        let runs = 0;
        const e = engine({ guardCommit: () => Promise.reject(Object.assign(new Error('gone'), { code: claim.SIGNED_OUT_CODE })) });
        const els = card({ whereToCheck: '☰ → Daily Huddle',
            uploadFn: (/** @type {string} */ d, /** @type {any} */ f, /** @type {string} */ u) => { runs++; return e.client.uploadHuddle(d, f, u); } });
        await pick(els, pdf('huddle.pdf'));
        await els.btn.fire('click');
        assert.equal(els.feedback.textContent,
            'You were signed out before this upload was confirmed. Sign in again, then check ☰ → Daily Huddle.',
            'a sign-out is worded as one — not as a dropped connection');
        assert.deepEqual(e.deleted, [], 'the file is kept: the write is held for that account and may yet land');
        // What keeps Operations from reloading under it once the button is back (`_opsBusy`).
        assert.equal(document.querySelector('[data-uploading]'), null, 'the button has come back…');
        assert.equal(claim.hasUnconfirmedWrite(), true, '…and the page still knows a write is unconfirmed');
        // The next upload on this page is refused BEFORE it starts, in the app's one sentence for it.
        await pick(els, pdf('huddle-again.pdf'));
        await els.btn.fire('click');
        assert.equal(runs, 1, 'no second upload ran');
        assert.equal(els.feedback.textContent, claim.UNCONFIRMED_LINE);
    });

    test('without a named place to look, the sign-out line still says what to do', async (t) => {
        t.mock.method(console, 'error', () => {});
        const els = card({ uploadFn: async () => { throw Object.assign(new Error('gone'), { code: claim.SIGNED_OUT_CODE }); } });
        await pick(els, pdf('newsletter.pdf'));
        await els.btn.fire('click');
        assert.equal(els.feedback.textContent, 'You were signed out before this upload was confirmed. Sign in again, then check whether it saved.');
    });
});
