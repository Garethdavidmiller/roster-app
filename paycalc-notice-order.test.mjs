// @ts-nocheck
/**
 * paycalc-notice-order.test.mjs — the YTD notice opens LAST, and only through the safe opener.
 *
 * Three contracts, all static, and the reason they are static is worth stating rather than
 * apologising for. The rule they protect is about the ORDER two overlays reach the screen, and one
 * of those overlays — the forced set-password block — cannot be made to appear in the e2e suite:
 * `password-force.js` reads `passwordStatus` and fails open, and the hermetic Firebase stub cannot
 * produce the un-migrated `named` state that makes it show. Measured, not assumed (a probe on
 * 28 Aug 2026 got `pwForce: false` with every marker set). So the behavioural route is closed and
 * these read the wiring instead.
 *
 * That is a weaker test than driving the browser, and it is stronger than the alternative, which is
 * nothing. Each contract below is mutation-verified, and each names the regression a future editor
 * would actually make — every one of them looks like a tidy-up.
 *
 * The ownership-prompt half of the ordering IS covered behaviourally, in
 * `e2e/paycalc.spec.js` → "the data-ownership prompt opens for legacy data, and alone".
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (/** @type {string} */ p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const APP        = read('./paycalc-app.js');
const LIGHTBOXES = read('./paycalc-lightboxes.js');

describe('the YTD notice queues behind everything else on the page', () => {

    test('the opener is RETURNED, not called at init', () => {
        // Calling it inside initPaycalcLightboxes puts it back in front of the forced set-password
        // overlay, which is decided after an auth round-trip while that function runs synchronously.
        // That was the behaviour until v21.91 and it is the state a "why is this returned?" cleanup
        // would restore.
        assert.match(LIGHTBOXES, /const showYtdNotice = \(function \(\) \{/,
            'paycalc-lightboxes.js should build the YTD opener and hand it back');
        assert.match(LIGHTBOXES, /return \{ openAboutLightbox, showYtdNotice \}/,
            'showYtdNotice must be part of the returned handle set');

        const initBody = LIGHTBOXES.slice(
            LIGHTBOXES.indexOf('export function initPaycalcLightboxes'),
            LIGHTBOXES.indexOf('return { openAboutLightbox'));
        assert.ok(!/^\s*showYtdNotice\(\)/m.test(initBody),
            'initPaycalcLightboxes must not open the notice itself — that is the race it was moved out of');
    });

    test('the coordinator opens it only after initPasswordForce settles', () => {
        // `initPasswordForce` returns Promise<boolean> and its own JSDoc says the value exists for
        // "the next overlay that has to queue behind this one". This is that overlay. A bare
        // `initPasswordForce(name, {});` beside a bare `showYtdNotice();` reads as equivalent and
        // is not — it restores the race.
        // Assert the CHAIN, not proximity. The first version of this matched
        // `initPasswordForce(...)` within 120 characters of `showYtdNotice()`, which a bare
        // `initPasswordForce(name, {}); showYtdNotice();` satisfies perfectly — the exact
        // regression the contract exists to stop, passing the contract. Caught by mutation.
        // A regex over `.catch(() => {})` is a nested-paren trap — the second attempt at this
        // contract failed its own baseline for exactly that. Read the span between the two calls
        // instead: chained means no statement separator crosses it.
        const from = APP.indexOf('initPasswordForce(');
        const to   = APP.indexOf('showYtdNotice()');
        assert.ok(from > -1 && to > from,
            'expected initPasswordForce to appear before showYtdNotice in paycalc-app.js');
        const between = APP.slice(from, to);
        assert.ok(!between.includes(';'),
            'a `;` between initPasswordForce and showYtdNotice means they are two statements, not a '
            + 'chain — the notice then races the overlay it is supposed to queue behind. Found:\n'
            + between.trim());
        assert.match(between, /\.(?:then|finally)\(/,
            'showYtdNotice must hang off the initPasswordForce promise (.then/.finally)');

        // And nowhere else: a statement-level call is the same race by another route.
        const stray = [...APP.matchAll(/(^|[;{}])\s*showYtdNotice\(\)/gm)];
        assert.deepEqual(stray.map(m => m[0].trim()), [],
            'showYtdNotice must be invoked ONLY from that chain, never as a statement of its own');

        const calls = [...APP.matchAll(/showYtdNotice\(\)/g)];
        assert.equal(calls.length, 1, 'showYtdNotice should be invoked exactly once, from that chain');
    });

    test('it opens through openNoticeIfClear, never a bare .open()', () => {
        // The v19.53 rule. A bare `.open()` on a stacked notice runs its onClose, so it is archived
        // and flagged permanently seen by somebody who never saw it — and NOT opening leaves it
        // unflagged, so it simply returns next load. No behavioural test in the suite catches this:
        // removing `openNoticeIfClear` here leaves the e2e green, because the `_ownerPending` guard
        // covers for it. Measured by mutation on 28 Aug 2026.
        assert.match(LIGHTBOXES, /return \(\) => openNoticeIfClear\(notice\)/,
            'the YTD opener must go through openNoticeIfClear');
        assert.ok(!/\bnotice\.open\(\)/.test(LIGHTBOXES),
            'a bare notice.open() archives and flags a notice nobody saw');
    });
});
