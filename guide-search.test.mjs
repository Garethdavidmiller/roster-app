// @ts-check
/**
 * guide-search.test.mjs — the pure cross-guide search rules, organised by what a wrong answer
 * COSTS at the gateline or in the mess room:
 *
 *  - LAUNDERED DOUBT is the dangerous direction: a provisional state the page declares (conflict /
 *    draft / unconfirmed) dropped or merged on the way to a result row, so a claim the guide
 *    itself refuses to certify reads like settled fact. Every evidence case pins the list
 *    VERBATIM — order, count, and content.
 *  - AN UNFINDABLE ANSWER is the quiet failure: the tokeniser folding differently than the index
 *    was built with, or AND-semantics refusing a query one keystroke early.
 *  - A DOUBLED ANSWER is the noisy one: a card and its own section both returned for one question.
 *
 * Runs in test:hygiene — no DOM, no mocks. The INDEX side is guide-index-parity.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokeniseText, searchGuideIndex } from './guide-search.js';

/** Small hand-built index — shapes mirror the generator's output exactly. */
const UNIT = (over) => ({ page: 'railcard-guide.html', id: 'x', t: 'X', tt: '', k: '', e: [], p: null, ...over });
const IDX = [
    UNIT({ id: 'rc-cards', t: 'The railcards', tt: 'the railcards', k: 'annual gold veterans network discount' }),
    UNIT({ id: 'rc-gold', t: 'Annual Gold Card', tt: 'annual gold card', k: 'season ticket discount first class', p: 'rc-cards' }),
    UNIT({ id: 'rc-network', t: 'Network Railcard', tt: 'network railcard', k: 'minimum fare morning', p: 'rc-cards' }),
    UNIT({ page: 'rangers-guide.html', id: 'rr-thames', t: 'Thames Rover — 7 Day', tt: 'thames rover day',
        k: 'reading oxford operator geography', e: ['conflict'], p: 'rr-elsewhere' }),
    UNIT({ page: 'rangers-guide.html', id: 'rr-elsewhere', t: 'Valid elsewhere', tt: 'valid elsewhere', k: 'thames rover reading oxford' }),
    UNIT({ page: 'fip.html', id: 'country-fr', t: '🇫🇷 France', tt: 'france', k: 'eurostar sncf paris coupon', e: ['draft', 'unconfirmed'] }),
];

test('tokeniser: case, punctuation and accents fold; short fragments drop; order and dedupe hold', () => {
    assert.deepEqual(tokeniseText('Thames Rover — 7 Day (Rover!)'), ['thames', 'rover', 'day']);
    assert.deepEqual(tokeniseText('Génève, café'), ['geneve', 'cafe']);
    assert.deepEqual(tokeniseText('a I x'), []);
    assert.deepEqual(tokeniseText(''), []);
    // @ts-expect-error non-string input is a caller bug the search box can still produce
    assert.deepEqual(tokeniseText(null), []);
});

test('every query token must match — one alien token refuses the unit (AND, not OR)', () => {
    assert.equal(searchGuideIndex(IDX, 'gold zzz').length, 0);
    assert.ok(searchGuideIndex(IDX, 'gold').some(r => r.id === 'rc-gold'));
});

test('the LAST token is a prefix — a mid-keystroke query already finds its answer', () => {
    assert.ok(searchGuideIndex(IDX, 'euro').some(r => r.id === 'country-fr'));
    // …but NON-last tokens are exact: "euro gold" must not treat "euro" as a prefix of anything
    assert.equal(searchGuideIndex(IDX, 'euro france').filter(r => r.id === 'country-fr').length, 0);
});

test('title hits outrank body hits', () => {
    const r = searchGuideIndex(IDX, 'network');
    assert.equal(r[0].id, 'rc-network');        // title match beats rc-cards' body mention
});

test('a card beats its own section: the parent row is dropped when both match', () => {
    const ids = searchGuideIndex(IDX, 'gold').map(r => r.id);
    assert.ok(ids.includes('rc-gold'));
    assert.ok(!ids.includes('rc-cards'), 'the section that merely contains the card must not double the answer');
});

test('parent suppression is per PAGE — a same-named id in another guide is not anybody\'s parent', () => {
    const idx = [
        UNIT({ id: 'shared', t: 'Gold section', tt: 'gold section' }),
        UNIT({ page: 'fip.html', id: 'card', t: 'Gold thing', tt: 'gold thing', p: 'shared' }),
    ];
    // fip's card names a parent id that exists in ANOTHER page; the railcard section must survive.
    assert.equal(searchGuideIndex(idx, 'gold').length, 2);
});

test('evidence passes through VERBATIM — never merged, never dropped, never reordered', () => {
    const thames = searchGuideIndex(IDX, 'thames rover').find(r => r.id === 'rr-thames');
    assert.deepEqual(thames?.evidence, ['conflict']);
    const fr = searchGuideIndex(IDX, 'france').find(r => r.id === 'country-fr');
    assert.deepEqual(fr?.evidence, ['draft', 'unconfirmed'], 'two states stay two states');
    // and a result mutation cannot reach back into the index
    fr?.evidence.push('tampered');
    assert.deepEqual(IDX[5].e, ['draft', 'unconfirmed']);
});

test('no tokens (empty, whitespace, all-short) → no results, no throw', () => {
    assert.deepEqual(searchGuideIndex(IDX, ''), []);
    assert.deepEqual(searchGuideIndex(IDX, '  ! '), []);
    assert.deepEqual(searchGuideIndex(/** @type {any} */ (null), 'gold'), []);
});

test('limit caps results after suppression, not before', () => {
    const many = Array.from({ length: 20 }, (_, i) => UNIT({ id: `u${i}`, t: `Gold ${i}`, tt: `gold u${i}x` }));
    assert.equal(searchGuideIndex(many, 'gold', { limit: 5 }).length, 5);
});
