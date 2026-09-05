/**
 * admin-deep-link.test.mjs — a deep link must arrive with the thing it NAMED already open.
 *
 * Organised by what each wrong answer costs, because they are not symmetrical:
 *
 *   · OPENING TOO LITTLE is the shipped defect and the silent one. The link scrolls to an element
 *     with no height and the member sees a page that did not move — a button that appears to do
 *     nothing, which is worse than no button. Nothing errors, and no behavioural assertion
 *     elsewhere can see it.
 *   · OPENING THE WRONG FOLD is what a guessed selector produces: the page moves, something opens,
 *     and it is not what was asked for. Louder, but it teaches a member to distrust the link.
 *   · THROWING is the one with history. A malformed hash fed to `querySelector` raises a
 *     SyntaxError, which on admin's in-place-login path is caught into a reload — and the bad hash
 *     survives that reload, so it loops. That is why the id is looked up, never selected.
 *
 * Runs against a fake document, which is the whole reason `resolveDeepLink` takes one: the rule is
 * a decision about elements, and a decision can be tested without a browser. Part of test:hygiene.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { resolveDeepLink, NESTED_DEEP_LINKS } from './admin-deep-link.js';

/**
 * The smallest document that can answer the two questions this module asks of one: find an element
 * by id, and walk from it to the card around it.
 * @param {Record<string, {card?: string, body?: Element|null, chevron?: Element|null, isCard?: boolean}>} spec
 */
function fakeDoc(spec) {
    /** @type {Record<string, any>} */
    const els = {};
    for (const [id, cfg] of Object.entries(spec)) {
        els[id] = {
            id,
            _cfg: cfg,
            closest(/** @type {string} */ sel) {
                if (sel !== '.card') return null;
                if (cfg.isCard) return els[id];
                return cfg.card ? els[cfg.card] : null;
            },
            querySelector(/** @type {string} */ sel) {
                if (sel === '.card-collapsible-body') return cfg.body ?? null;
                if (sel === '.collapse-chevron') return cfg.chevron ?? null;
                return null;
            },
        };
    }
    return /** @type {any} */ ({ getElementById: (/** @type {string} */ id) => els[id] || null, _els: els });
}

const CARD_BODY = { name: 'alBody' };
const CARD_CHEV = { name: 'alChevron' };

/** admin.html as this module sees it: the AL card, with the Recorded AL dates box inside it. */
const ADMIN = () => fakeDoc({
    'book-annual-leave': { isCard: true, body: CARD_BODY, chevron: CARD_CHEV },
    alBookedBox:         { card: 'book-annual-leave' },
    alBookedBody:        {},
    alBookedChevron:     {},
});

describe('opening too little — the link that appears to do nothing', () => {
    test('a nested target opens the CARD around it, not just what is inside it', () => {
        const doc = ADMIN();
        // The box itself holds no `.card-collapsible-body`, which is exactly why looking only
        // INSIDE the target found nothing and left the card folded over a hidden element.
        const plan = resolveDeepLink('#alBookedBox', doc);
        assert.ok(plan, 'the box is on the page; this must resolve');
        assert.deepEqual(plan.folds[0], { body: CARD_BODY, chevron: CARD_CHEV },
            'the containing card must be opened, or the target has no height to scroll to');
    });

    test('…and the box\'s OWN fold as well, or it lands on the thing it named, closed', () => {
        const doc = ADMIN();
        const plan = resolveDeepLink('#alBookedBox', doc);
        assert.equal(plan.folds.length, 2, 'two folds: the card, then the box');
        assert.equal(plan.folds[1].body, doc.getElementById('alBookedBody'));
        assert.equal(plan.folds[1].chevron, doc.getElementById('alBookedChevron'));
    });

    test('it scrolls to the CARD, because the box is hidden until its own render runs', () => {
        const doc = ADMIN();
        const plan = resolveDeepLink('#alBookedBox', doc);
        assert.equal(plan.scrollTo, doc.getElementById('book-annual-leave'),
            'the box carries `hidden` until an async render un-hides it — scrolling to it now ' +
            'aims at a zero-height element, and the card is on the page from the start');
    });
});

describe('opening the wrong thing — what a guessed selector would do', () => {
    test('a target with no nested entry gets exactly ONE fold', () => {
        const plan = resolveDeepLink('#book-annual-leave', ADMIN());
        assert.equal(plan.folds.length, 1, 'a card link must not open something else as well');
        assert.equal(plan.scrollTo.id, 'book-annual-leave', 'and it scrolls to itself');
    });

    test('an existing card deep link resolves to what it always did', () => {
        // The v22.91 change walks up to the containing card; for a link that NAMES a card that is
        // the target itself, so every pre-existing deep link is untouched. Pinned, because this is
        // the regression the change could have caused and nothing else would have reported it.
        const plan = resolveDeepLink('#book-annual-leave', ADMIN());
        assert.deepEqual(plan.folds, [{ body: CARD_BODY, chevron: CARD_CHEV }]);
    });

    test('the nested map names only ids that resolve to a body and a chevron', () => {
        for (const [id, entry] of Object.entries(NESTED_DEEP_LINKS)) {
            assert.ok(entry.body && entry.chevron, `${id} must name both halves of its fold`);
            assert.notEqual(entry.body, entry.chevron, `${id}: the body is not the chevron`);
        }
    });
});

describe('a hash that names nothing, or cannot be read', () => {
    test('a malformed hash is no target — never a throw', () => {
        // `%` alone makes decodeURIComponent throw. Fed to querySelector it would be a SyntaxError,
        // caught into a reload on the in-place-login path, with the bad hash surviving to loop.
        for (const bad of ['#%', '#%E0%A4%A', '#[', '#..']) {
            assert.doesNotThrow(() => resolveDeepLink(bad, ADMIN()), `${bad} must not throw`);
            assert.equal(resolveDeepLink(bad, ADMIN()), null, `${bad} names nothing`);
        }
    });

    test('an unknown id, an empty hash and no hash all resolve to nothing', () => {
        for (const none of ['#nosuchthing', '#', '']) {
            assert.equal(resolveDeepLink(none, ADMIN()), null, `"${none}" must resolve to null`);
        }
    });

    test('a hash works with or without its leading #', () => {
        assert.ok(resolveDeepLink('alBookedBox', ADMIN()), 'callers pass location.hash, but the ' +
            'leading # is punctuation and must not be part of the id');
    });

    test('no document is no answer rather than a crash', () => {
        assert.equal(resolveDeepLink('#alBookedBox', /** @type {any} */ (null)), null);
    });
});
