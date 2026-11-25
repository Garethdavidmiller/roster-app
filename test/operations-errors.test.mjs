// @ts-check
// @lane unit
/**
 * operations-errors.js — the Error Log card: two reads that overlap paint only the NEWEST.
 *
 * A notification tap, the retry button and the refresh after "Resolve all shown" each start a read,
 * and nothing stopped an older one landing last and repainting the card, its header chip and the
 * Needs-attention strip with entries since resolved (whole-app review, 24 Nov 2026).
 *
 * Driven through a small fake DOM, with the Firebase boundary mocked: the read is a promise the test
 * resolves by hand, in the order it chooses.
 *
 * Run: node --experimental-test-module-mocks scripts/run-tests.mjs test/operations-errors.test.mjs
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

/** @type {Array<{ resolve: (v: any) => void, reject: (e: any) => void }>} */
const reads = [];
mock.module('../session.js', { namedExports: { sessionReady: Promise.resolve() } });
mock.module('../firebase-client.js', { namedExports: {
    withClaimRetry: (/** @type {() => any} */ fn) => fn(),
    getClientErrors: () => new Promise((resolve, reject) => { reads.push({ resolve, reject }); }),
    resolveClientError: async () => {},
} });
mock.module('../operations-reports.js', { namedExports: {
    _cardLoadError: (/** @type {any} */ content, /** @type {string} */ message) => {
        content.innerHTML = '';
        content.appendChild(Object.assign(fakeEl('p'), { textContent: message }));
    },
    _relativeTime: () => 'just now',
} });
mock.module('../slow-save.js', { namedExports: { withSlowSaveNotice: (/** @type {any} */ p) => p } });

/** A stand-in element: enough of the DOM for the card to render into. @param {string} tag */
function fakeEl(tag) {
    /** @type {any} */
    const el = {
        tagName: tag.toUpperCase(), children: /** @type {any[]} */ ([]), attrs: /** @type {Record<string,string>} */ ({}),
        className: '', textContent: '', disabled: false,
        set innerHTML(/** @type {string} */ _v) { el.children = []; },
        appendChild(/** @type {any} */ c) { el.children.push(c); return c; },
        append(/** @type {any[]} */ ...cs) { el.children.push(...cs); },
        setAttribute(/** @type {string} */ k, /** @type {string} */ v) { el.attrs[k] = String(v); },
        removeAttribute(/** @type {string} */ k) { delete el.attrs[k]; },
        addEventListener() {},
        querySelector() { return null; },
        remove() {},
        classList: { add() {}, remove() {} },
    };
    return el;
}
/** Every text in a subtree, flattened. @param {any} el @returns {string[]} */
const texts = (el) => [el.textContent, ...el.children.flatMap(texts)].filter(Boolean);

const content = fakeEl('div');
const chip = fakeEl('span');
/** @type {any} */ (globalThis).document = {
    getElementById: (/** @type {string} */ id) => ({ errorLogContent: content, errorLogCountChip: chip })[id] ?? null,
    createElement: fakeEl,
};
/** @type {any} */ (globalThis).window = { addEventListener() {} };

const { initErrorLog } = await import('../operations-errors.js');

const flush = () => new Promise((r) => setTimeout(r, 0));
const entry = (/** @type {string} */ id, /** @type {string} */ message) => ({ id, message, resolved: false, memberName: 'A. Member', page: 'admin.html' });

test('an older read that lands LAST does not repaint over the newer one', async () => {
    /** @type {number[]} */ const strip = [];
    const opts = { onAttention: (/** @type {number} */ n) => { strip.push(n); }, onWithdraw: () => { strip.push(-1); } };
    const older = initErrorLog(opts);
    await flush();
    const newer = initErrorLog(opts);
    await flush();
    assert.equal(reads.length, 2, 'both reads started');
    reads[1].resolve({ errors: [entry('b', 'the newer read')] });
    await newer;
    reads[0].resolve({ errors: [entry('a', 'stale one'), entry('c', 'stale two'), entry('d', 'stale three')] });
    await older;
    const shown = texts(content).join(' | ');
    assert.ok(shown.includes('the newer read'), shown);
    assert.ok(!shown.includes('stale'), `the older snapshot repainted the card: ${shown}`);
    assert.equal(chip.textContent, '1', 'the header chip carries the newer count');
    assert.deepEqual(strip, [1], 'the strip was told only by the newest read');
});

test('an older read that FAILS last does not wipe the newer card or withdraw its count', async () => {
    reads.length = 0;
    /** @type {number[]} */ const strip = [];
    const opts = { onAttention: (/** @type {number} */ n) => { strip.push(n); }, onWithdraw: () => { strip.push(-1); } };
    const older = initErrorLog(opts);
    await flush();
    const newer = initErrorLog(opts);
    await flush();
    reads[1].resolve({ errors: [entry('b', 'fresh entry'), entry('e', 'another fresh entry')] });
    await newer;
    reads[0].reject(new Error('offline'));
    await older;
    assert.ok(texts(content).join(' | ').includes('fresh entry'));
    assert.equal(chip.textContent, '2');
    assert.deepEqual(strip, [2]);
});
