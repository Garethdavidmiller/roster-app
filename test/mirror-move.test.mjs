// @lane unit
/**
 * mirror-move.test.mjs — who gets the Pages mirror's line, where it links, and what it says.
 * Run: node scripts/run-tests.mjs test/mirror-move.test.mjs
 * The DOM journeys (the sign-in card, the strip under the header, a phone and the main address) are
 * e2e/mirror-move.spec.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mirrorLineDue, mainAddressFor, buildMirrorLine, MIRROR_HEAD, MIRROR_LEAD, MIRROR_TAIL, MIRROR_PAY, MIRROR_PAY_LINK } from '../mirror-move-words.js';

const REPO_ROOT_URL = new URL('../', import.meta.url);
const read = (/** @type {string} */ f) => readFileSync(new URL(f, REPO_ROOT_URL), 'utf8');

test('only a desktop browser at the mirror gets it', () => {
    const cases = [
        [{ mirror: true,  standalone: false, coarse: false }, true],
        [{ mirror: true,  standalone: false, coarse: true  }, false],   // a phone: the move notice says it
        [{ mirror: true,  standalone: true,  coarse: false }, false],   // the installed app
        [{ mirror: false, standalone: false, coarse: false }, false],   // the main address
    ];
    for (const [device, due] of /** @type {const} */ (cases)) assert.equal(mirrorLineDue(device), due, JSON.stringify(device));
});

test('the link is the same page at the main address, with its query and hash', () => {
    const at = (/** @type {string} */ pathname, search = '', hash = '') => mainAddressFor({ pathname, search, hash });
    assert.equal(at('/roster-app/'), 'https://myb-roster.web.app/');
    assert.equal(at('/roster-app/index.html'), 'https://myb-roster.web.app/');
    assert.equal(at('/roster-app/paycalc.html', '?payday=2026-12-11', '#x'), 'https://myb-roster.web.app/paycalc.html?payday=2026-12-11#x');
    assert.equal(at('/roster-app/', '', '#huddle'), 'https://myb-roster.web.app/#huddle');
});

test('only a page file name is carried, never a path', () => {
    const at = (/** @type {string} */ pathname) => mainAddressFor({ pathname, search: '', hash: '' });
    assert.equal(at('/roster-app/docs/x.pdf'), 'https://myb-roster.web.app/');
    assert.equal(at('/roster-app/..%2F..%2Fevil.html'), 'https://myb-roster.web.app/');
    assert.equal(at('//evil.example/a.html'), 'https://myb-roster.web.app/a.html');
    for (const p of ['/a/b.html', '/x', '/']) assert.ok(at(p).startsWith('https://myb-roster.web.app/'), p);
});

/** A document just big enough for `buildMirrorLine`, recording what it is given. */
function fakeDoc() {
    const el = (/** @type {string} */ tag) => {
        /** @type {any} */ const node = { tag, className: '', href: '', textContent: '', children: /** @type {any[]} */ ([]) };
        node.append = (/** @type {any[]} */ ...xs) => { node.children.push(...xs); };
        node.text = () => node.textContent || node.children.map((/** @type {any} */ c) => typeof c === 'string' ? c : c.text()).join('');
        return node;
    };
    return /** @type {any} */ ({ createElement: el });
}

test('the words: the news in bold, where it lives, and the pay sentence only on the Pay page', () => {
    const plain = /** @type {any} */ (buildMirrorLine(fakeDoc(), { className: 'login-mirror', href: 'https://myb-roster.web.app/' }));
    assert.equal(plain.tag, 'p');
    assert.equal(plain.text(), MIRROR_HEAD + ' ' + MIRROR_LEAD + 'myb-roster.web.app' + MIRROR_TAIL);
    const [head, , , link] = plain.children;
    assert.equal(head.tag, 'strong', 'the news leads, in bold');
    assert.equal(link.tag, 'a');
    assert.equal(link.href, 'https://myb-roster.web.app/');

    const pay = /** @type {any} */ (buildMirrorLine(fakeDoc(), { tag: 'div', className: 'mirror-move', pay: true, href: 'x' }));
    const more = pay.children.at(-1);
    assert.equal(more.className, 'mirror-move-pay');
    assert.equal(more.text(), MIRROR_PAY + MIRROR_PAY_LINK + '.');
    const cardLink = more.children.find((/** @type {any} */ c) => typeof c !== 'string');
    assert.equal(cardLink.href, '#payTransferCard', 'the link the first-run banner uses, which opens the card');
    assert.ok(!plain.text().includes('Pay Calculator'));
    for (const w of [MIRROR_HEAD, MIRROR_LEAD, MIRROR_TAIL, MIRROR_PAY]) assert.ok(!/!|'/.test(w), `calm, curly: ${w}`);
});

test('wired where every page starts, and on the sign-in card', () => {
    assert.match(read('page-start.js'), /showMirrorBanner\(\{ pay: spec\.page === 'paycalc' \}\)/);
    assert.match(read('calendar-app.js'), /^showMirrorBanner\(\);$/m);
    assert.match(read('login-overlay.js'), /mirrorCardLine\(document\)/);
    // The mirror is asked ONE way, notif.js's `onPagesMirror`, and the words come from this file's subject.
    const dom = read('mirror-move.js');
    assert.match(dom, /import \{ onPagesMirror, isStandalonePWA \} from '\.\/notif\.js';/);
    assert.match(dom, /from '\.\/mirror-move-words\.js';/);
    assert.doesNotMatch(dom, /github\\\.io/, 'no second copy of the mirror test');
});
