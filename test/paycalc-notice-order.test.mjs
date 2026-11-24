// @ts-nocheck
/**
 * paycalc-notice-order.test.mjs — the Pay page's notices open LAST, in their order, and only through
 * the safe opener: the Year to Date notice, then the Holiday Pay Premium notice (v26.22).
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

// Tests live in test/ but address files from the repository root (moved 24 Nov 2026).
const REPO_ROOT_URL = new URL('../', import.meta.url);

const read = (/** @type {string} */ p) => readFileSync(new URL(p, REPO_ROOT_URL), 'utf8');
const APP        = read('./paycalc-app.js');
const LIGHTBOXES = read('./paycalc-lightboxes.js');

describe('the Pay notices queue behind everything else on the page', () => {

    test('the opener is RETURNED, not called at init', () => {
        // Calling it inside initPaycalcLightboxes puts it back in front of the forced set-password
        // overlay, which is decided after an auth round-trip while that function runs synchronously.
        // That was the behaviour until v21.91 and it is the state a "why is this returned?" cleanup
        // would restore.
        assert.match(LIGHTBOXES, /const showYtdNotice = \(function \(\) \{/,
            'paycalc-lightboxes.js should build the YTD opener');
        assert.match(LIGHTBOXES, /const showHppNotice = \(function \(\) \{/,
            'paycalc-lightboxes.js should build the premium notice\'s opener');
        assert.match(LIGHTBOXES, /return \{ openAboutLightbox, showPayNotice \}/,
            'showPayNotice — the one opener for both — must be part of the returned handle set');

        const initBody = LIGHTBOXES.slice(
            LIGHTBOXES.indexOf('export function initPaycalcLightboxes'),
            LIGHTBOXES.indexOf('return { openAboutLightbox'));
        assert.ok(!/^\s*show(?:Ytd|Hpp|Pay)Notice\(\)/m.test(initBody),
            'initPaycalcLightboxes must not open a notice itself — that is the race it was moved out of');
    });

    test('the coordinator opens them only after initPasswordForce settles', () => {
        // `initPasswordForce` returns Promise<boolean> and its own JSDoc says the value exists for
        // "the next overlay that has to queue behind this one". This is that overlay. A bare
        // `initPasswordForce(name, {});` beside a bare `showPayNotice();` reads as equivalent and
        // is not — it restores the race.
        // Assert the CHAIN, not proximity. The first version of this matched
        // `initPasswordForce(...)` within 120 characters of the opener, which a bare
        // `initPasswordForce(name, {}); showYtdNotice();` satisfied perfectly — the exact
        // regression the contract exists to stop, passing the contract. Caught by mutation.
        // A regex over `.catch(() => {})` is a nested-paren trap — the second attempt at this
        // contract failed its own baseline for exactly that. Read the span between the two calls
        // instead: chained means no statement separator crosses it.
        const from = APP.indexOf('initPasswordForce(');
        const to   = APP.indexOf('showPayNotice()');
        assert.ok(from > -1 && to > from,
            'expected initPasswordForce to appear before showPayNotice in paycalc-app.js');
        const between = APP.slice(from, to);
        assert.ok(!between.includes(';'),
            'a `;` between initPasswordForce and showPayNotice means they are two statements, not a '
            + 'chain — the notices then race the overlay they are supposed to queue behind. Found:\n'
            + between.trim());
        assert.match(between, /\.(?:then|finally)\(/,
            'showPayNotice must hang off the initPasswordForce promise (.then/.finally)');

        // And nowhere else: a statement-level call is the same race by another route.
        const stray = [...APP.matchAll(/(^|[;{}])\s*showPayNotice\(\)/gm)];
        assert.deepEqual(stray.map(m => m[0].trim()), [],
            'showPayNotice must be invoked ONLY from that chain, never as a statement of its own');

        const calls = [...APP.matchAll(/showPayNotice\(\)/g)];
        assert.equal(calls.length, 1, 'showPayNotice should be invoked exactly once, from that chain');
        assert.ok(!/show(?:Ytd|Hpp)Notice/.test(APP),
            'the coordinator opens the notices through showPayNotice alone — one of them called on its own skips the order');
    });

    test('each opens through openNoticeIfClear, never a bare .open()', () => {
        // The v19.53 rule. A bare `.open()` on a stacked notice runs its onClose, so it is archived
        // and flagged permanently seen by somebody who never saw it — and NOT opening leaves it
        // unflagged, so it simply returns next load. No behavioural test in the suite catches this:
        // removing `openNoticeIfClear` here leaves the e2e green, because the `_ownerPending` guard
        // covers for it. Measured by mutation on 28 Aug 2026.
        assert.equal([...LIGHTBOXES.matchAll(/return \(\) => openNoticeIfClear\(notice\)/g)].length, 2,
            'both openers — the Year to Date notice and the premium notice — must go through openNoticeIfClear');
        assert.ok(!/\bnotice\.open\(\)/.test(LIGHTBOXES),
            'a bare notice.open() archives and flags a notice nobody saw');
    });
});

// ── THE HOLIDAY PAY PREMIUM NOTICE (hpp_2526, owner 16 Nov 2026 — v26.22) ───────────────────────────
// Second in the Pay sequence. These read the wiring, as the contracts above do, and each names the
// regression an editor would make. What only a browser proves — the order across real loads, the link
// landing, the route ending in a figure, the refusals — is `e2e/paycalc.spec.js` ("premium notice");
// its reader (`premiumStillToEstimate`) and its dates and link against the REAL payslip grid are
// `paycalc-hpp.test.mjs`, which can load that grid and this file cannot.
const HTML = read('./paycalc.html');
const HPP_IIFE = LIGHTBOXES.slice(LIGHTBOXES.indexOf('const showHppNotice = (function () {'),
    LIGHTBOXES.indexOf('})();', LIGHTBOXES.indexOf('const showHppNotice = (function () {')));
const HPP_MARKUP = HTML.slice(HTML.indexOf('<div id="noticeHppLightbox"'),
    HTML.indexOf('<!-- Shared-device data ownership prompt'));
/** A `const NAME = '…'` literal in the premium notice's IIFE. @param {string} name */
const hppConst = (name) => HPP_IIFE.match(new RegExp(`const ${name}\\s*=\\s*'([^']+)'`))?.[1];

describe('the Holiday Pay Premium notice comes second, and only to the member it is for', () => {

    test('the one opener asks the Year to Date notice first', () => {
        // `openNoticeIfClear` would leave the second unflagged if both were due, so the ORDER here is
        // which one a member sees first. Swapped, the premium notice could jump the queue on a load
        // where its own Year to Date check were ever loosened.
        assert.match(LIGHTBOXES, /const showPayNotice = \(\) => \{ showYtdNotice\(\); showHppNotice\(\); \};/,
            'showPayNotice must call the Year to Date opener, then the premium one');
    });

    test('it waits for the Year to Date notice, read as it is WIRED', () => {
        // Read once at wiring, before the lightbox exists, so it can never be due on the load the
        // Year to Date notice is answered — the Calendar's FOLLOWS rule. A check at OPEN time would
        // see the flag that notice's close had just set, and open the second straight after it.
        const follows = HPP_IIFE.indexOf('if (!lsGet(NOTICE_YTD_KEY)) return noop;');
        assert.ok(follows > -1, 'the premium notice must wait for NOTICE_YTD_KEY');
        assert.ok(follows < HPP_IIFE.indexOf('createLightbox('), 'and decide it before the lightbox is built');
        assert.ok(!/=>\s*\{?[^}]*NOTICE_YTD_KEY/.test(HPP_IIFE.slice(HPP_IIFE.indexOf('createLightbox('))),
            'never re-read at open time');
    });

    test('a link to a card, the ownership prompt, and a reader it is not for each keep it shut', () => {
        assert.match(HPP_IIFE, /if \(window\.location\.hash\) return noop;/,
            'any #fragment is a card a link opened: the notice must never cover it, and stays unflagged');
        assert.match(HPP_IIFE, /if \(_ownerPending\) return noop;/,
            'the data-ownership prompt goes first on its load');
        // Not theirs ('none') or already done ('done') keeps it shut — and UNFLAGGED. NOTICE_HPP_KEY is
        // the DEVICE's flag, so setting it for one member's answer would take the notice from the next
        // member signed in on that phone. e2e/paycalc.spec.js runs that shared phone.
        assert.match(HPP_IIFE, /if \(!ty \|\| premiumStillToEstimate\(ty\) !== 'open'\) return noop;/,
            'a member it is not for, or who has done it, is kept out by premiumStillToEstimate');
        const reader = HPP_IIFE.split('\n').find(l => l.includes('premiumStillToEstimate(ty)')) ?? '';
        assert.ok(!reader.includes('lsSet'), `a per-member answer must never set the device's flag: ${reader.trim()}`);
        assert.equal(hppConst('TAX_YEAR'), '2025/26', 'the year whose premium the January 2027 payslip carries');
    });

    test('it runs from its posting day to 8 January, and its expiry flags it unseen', () => {
        assert.equal(hppConst('NOTICE_DATE'), '16 Nov 2026');
        assert.match(HPP_IIFE, /const STARTS\s*=\s*new Date\(2026, 10, 16\);/,
            'STARTS is the posting day, local midnight — a clock set before it cannot raise the notice');
        assert.match(HPP_IIFE, /if \(Date\.now\(\) < STARTS\.getTime\(\)\) return noop;/);
        assert.equal(hppConst('LAST_DAY'), '8 Jan 2027', 'paycalc-hpp.test.mjs ties this to the January payslip\'s cut-off');
        assert.match(HPP_IIFE,
            /if \(isNoticeExpired\(LAST_DAY, 1\) && !lsGet\(NOTICE_HPP_KEY\)\) \{ lsSet\(NOTICE_HPP_KEY, '1'\); return noop; \}/,
            'offered the whole of its last day, and flagged unseen from the next midnight');
        assert.match(HPP_MARKUP, /<div class="notice-date">Posted 16 Nov 2026<\/div>/,
            'the markup posts it the day the code does');
    });

    test('every answer is final: the ✕, "Not now" and the link each set the flag', () => {
        // A one-off, like the Calendar's live notices. The link leaves the page, so a close that
        // never runs cannot be what flags it; and it is archived as it OPENS for the same reason.
        assert.match(HPP_IIFE, /onClose: markDone,/);
        // …and the link leaves by REPLACING the notice's history entry (overlay.js `followLinkOutOf`),
        // flagged first, for the click the browser follows itself (a new tab, a link to this page).
        assert.match(HPP_IIFE, /getElementById\('noticeHppGo'\)\?\.addEventListener\('click', e => \{\s*markDone\(\);\s*followLinkOutOf\(notice, /);
        assert.match(HPP_IIFE, /getElementById\('noticeHppLater'\)\?\.addEventListener\('click', \(\) => notice\.close\(\)\)/);
        assert.match(HPP_IIFE, /onOpen: \(\) => \{\s*archiveNotice\(\{\s*id:\s*'hpp_2526',/,
            'archived to App Notices as it opens, under its id');
        assert.match(HPP_IIFE, /section: 'Pay',/);
    });

    test('its words name the page\'s own controls, as the page names them', () => {
        // A member follows the notice by matching its words to the screen, so the labels it quotes
        // are the labels the page wears — a radio renamed, or a card retitled, strands them.
        const radio = HTML.match(/id="hppModeYtd" value="ytd"> <span class="hpp-mode-text">([^<]+)<\/span>/)?.[1];
        assert.ok(radio, 'premise: the rough-estimate radio is on the page');
        // Read as WORDS: &nbsp; keeps a date, and an emoji with its card's name, on one line on a phone.
        const WORDS = HPP_MARKUP.replace(/&nbsp;/g, ' ');
        assert.ok(WORDS.includes(`<strong>${radio}</strong>`), `the notice must quote the radio exactly: "${radio}"`);
        const ytdCard = HTML.match(/<h2><span aria-hidden="true">📊<\/span> ([^<]+)<\/h2>/)?.[1];
        const hppCard = HTML.match(/<h2><span aria-hidden="true">🏖️<\/span> ([^<(]+?)\s*(?:\(HPP\))?<\/h2>/)?.[1];
        assert.equal(ytdCard, 'Year to Date Figures');
        assert.equal(hppCard, 'Holiday Pay Premium');
        assert.ok(WORDS.includes(`<strong>📊 ${ytdCard}</strong>`), 'the Year to Date card, by its header');
        assert.ok(WORDS.includes(`<strong>🏖️ ${hppCard}</strong>`), 'the premium card, by its header');
        assert.ok(WORDS.includes('<strong>Taxable Pay</strong>'), 'the payslip line, by its exact name (paycalc.md)');
        // One title, three places: the dialog's name, its heading and its App Notices entry.
        const title = HPP_MARKUP.match(/<div class="lightbox-app-name">([^<]+)<\/div>/)?.[1];
        assert.ok(title);
        assert.ok(HPP_MARKUP.includes(`aria-label="${title}"`), 'the dialog is named by its title');
        assert.ok(HPP_IIFE.includes(`title:   '${title}'`), 'App Notices files it under the same title');
    });
});
