// @ts-check
/**
 * operations-attention.test.mjs — the pure decision behind the Needs-attention strip, organised by
 * the two ways an INDEX can lie about its cards:
 *
 *  - CLAIMING TOO LITTLE is the quiet failure: an exceptional state filtered out, understated
 *    ("100 unresolved" when the cap hid more), or silently dropped by a typo'd id — the admin
 *    reads "nothing needs doing" off the strip's absence, which is exactly the reading the
 *    disappear-when-clean design invites, so absence must be EARNED.
 *  - CLAIMING TOO MUCH is the noisy one: a zero rendered as an item, or an unreported card
 *    presented as clean/urgent — either teaches the admin to stop trusting the strip.
 *
 * The DOM half is thin and covered where only a browser can see it (e2e/pages.spec.js: real card
 * loads feeding the strip, the jump opening the real card). Part of test:hygiene.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAttentionItems, ATTENTION_CATALOGUE } from './operations-attention.js';

test('a zero count renders nothing, and an UNREPORTED card is absent — unknown is not clean', () => {
    assert.deepEqual(buildAttentionItems({}), []);
    assert.deepEqual(buildAttentionItems({ resets: { count: 0 }, errors: { count: 0 } }), []);
    // only one card has reported; the other must be neither claimed clean nor claimed urgent
    const items = buildAttentionItems({ resets: { count: 2 } });
    assert.deepEqual(items.map(i => i.id), ['resets']);
});

test('counts read in words, singular and plural, with the right jump target', () => {
    const one = buildAttentionItems({ resets: { count: 1 }, errors: { count: 1 } });
    assert.deepEqual(one.map(i => i.text), ['1 password reset waiting', '1 unresolved error']);
    const many = buildAttentionItems({ resets: { count: 3 }, errors: { count: 12 } });
    assert.deepEqual(many.map(i => i.text), ['3 password resets waiting', '12 unresolved errors']);
    assert.deepEqual(many.map(i => i.hash), ['#reset-requests', '#error-log']);
});

test('a truncated error backlog says 100+ in BOTH voices, never the capped number', () => {
    const [item] = buildAttentionItems({ errors: { count: 100, truncated: true } });
    assert.equal(item.text, '100+ unresolved errors');
    assert.equal(item.badge, '100+');
});

test('the two voices state one fact: the badge is the count the sentence speaks', () => {
    const [item] = buildAttentionItems({ resets: { count: 3 } });
    assert.equal(item.badge, '3');
    assert.equal(item.short, 'Password resets');
    assert.equal(item.text, '3 password resets waiting');
});

test('items keep catalogue order regardless of report order', () => {
    const items = buildAttentionItems({ errors: { count: 1 }, resets: { count: 1 } });
    assert.deepEqual(items.map(i => i.id), Object.keys(ATTENTION_CATALOGUE));
});

test('every catalogue entry carries what a row needs — a half-declared id cannot half-render', () => {
    for (const [id, entry] of Object.entries(ATTENTION_CATALOGUE)) {
        assert.ok(entry.emoji && entry.hash.startsWith('#'), id);
        assert.ok(entry.short, `${id}: pills need the short name`);
        assert.equal(typeof entry.label(2), 'string');
    }
});

// ── the DOM half, against a minimal fake document ───────────────────────────────────────────────
// Enough DOM for render(): createElement with append/textContent/setAttribute, and `hidden`.
function fakeDocument() {
    const el = (tag) => ({
        tag, children: /** @type {any[]} */ ([]), attrs: {}, className: '', hidden: false,
        _text: '',
        set textContent(v) { this._text = v; this.children = []; },
        get textContent() { return this._text + this.children.map(c => typeof c === 'string' ? c : c.textContent).join(''); },
        setAttribute(k, v) { this.attrs[k] = v; },
        getAttribute(k) { return this.attrs[k]; },
        append(...kids) { this.children.push(...kids); },
        addEventListener() {},
    });
    return { createElement: el, _el: el };
}

test('report(): an unknown id THROWS — a typo cannot report into the void', async (t) => {
    const doc = fakeDocument();
    const container = doc._el('section');
    globalThis.document = /** @type {any} */ (doc);
    t.after(() => { delete (/** @type {any} */ (globalThis)).document; });
    const { createAttentionStrip } = await import('./operations-attention.js');
    const strip = createAttentionStrip({ container: /** @type {any} */ (container) });
    assert.throws(() => strip.report('reset', 2), /unknown id/);          // singular typo of 'resets'
    // …and a KNOWN id renders, then a zero re-report hides the strip again
    strip.report('resets', 2);
    assert.equal(container.hidden, false);
    assert.match(container.textContent, /Password resets/);
    assert.match(container.textContent, /2/);
    strip.report('resets', 0);
    assert.equal(container.hidden, true, 'back to clean → back to absent');
});
