/**
 * status-text.test.mjs — the decorative-glyph rule, from both sides.
 *
 * Run: node --test status-text.test.mjs   (part of `npm run test:hygiene`)
 *
 * This is the ONLY thing that can see this module working. The change it makes is invisible to
 * every other kind of test in the repo by construction: rendering is unchanged so the visual
 * baselines are identical, `textContent` reads back the original string so the e2e assertions are
 * identical, and axe has no rule for "a decorative glyph that was not hidden" — that is a judgement
 * about meaning, which is exactly why the finding sat open in A11Y_FINDINGS.md rather than being
 * caught by the gate.
 *
 * Organised by the two ways it can be wrong, which cost different things:
 *   · **Too EAGER** — hiding a glyph that was carrying the meaning, so a screen-reader user is told
 *     less than a sighted one. Silent, and the direction that actually removes information.
 *   · **Too TIMID** — leaving the glyph announced, i.e. the original defect, which is noise rather
 *     than loss.
 * And one block for the property the whole migration rests on: that a converted call site reads
 * back identically, because if it does not, ~50 assertions elsewhere start failing for a reason
 * that has nothing to do with what they test.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { splitStatusGlyph, setStatus, STATUS_GLYPHS } from './status-text.js';

/** The smallest DOM these functions touch: createElement, createTextNode, appendChild, textContent. */
function makeEl() {
    const el = {
        childNodes: [],
        get textContent() { return this.childNodes.map((n) => n.textContent).join(''); },
        set textContent(v) { this.childNodes = v === '' ? [] : [{ textContent: String(v), attrs: {} }]; },
        appendChild(n) { this.childNodes.push(n); return n; },
        attrs: {},
        setAttribute(k, v) { this.attrs[k] = v; },
        getAttribute(k) { return this.attrs[k]; },
        ownerDocument: {
            createElement: () => makeEl(),
            createTextNode: (t) => ({ textContent: String(t), attrs: {} }),
        },
    };
    return el;
}

/** What a screen reader would read: everything not marked aria-hidden. */
const announced = (el) => el.childNodes
    .filter((n) => n.getAttribute?.('aria-hidden') !== 'true')
    .map((n) => n.textContent).join('');

describe('a decorative glyph is hidden, and only a decorative one', () => {
    test('a leading glyph plus a sentence is decoration', () => {
        const el = makeEl();
        setStatus(el, '✓ Settings saved');
        assert.equal(announced(el), ' Settings saved');
        assert.equal(el.childNodes[0].getAttribute('aria-hidden'), 'true');
    });

    test('every glyph in the vocabulary is recognised', () => {
        // A glyph added to STATUS_GLYPHS but never actually split would pass unnoticed: the call
        // site keeps working and the announcement keeps the glyph, i.e. the bug is the silence.
        for (const g of STATUS_GLYPHS) {
            assert.deepEqual(splitStatusGlyph(`${g} done`), { glyph: g, rest: 'done' }, `glyph ${g}`);
        }
    });

    test('no glyph is a prefix of a later one — the list stays longest-first', () => {
        // A STRUCTURAL guard, not a behavioural one, and deliberately so. Reversing the order
        // changes nothing observable today because the space rule below rejects the short match;
        // this asserts the invariant directly so it survives that rule being relaxed. Found by
        // mutation: the behavioural test alone passed with the list reversed.
        for (let i = 0; i < STATUS_GLYPHS.length; i++) {
            for (let j = i + 1; j < STATUS_GLYPHS.length; j++) {
                assert.ok(!STATUS_GLYPHS[j].startsWith(STATUS_GLYPHS[i]),
                    `${STATUS_GLYPHS[i]} (index ${i}) is a prefix of ${STATUS_GLYPHS[j]} (index ${j}) — put the longer one first`);
            }
        }
    });

    test('the emoji forms are split WHOLE, variation selector included', () => {
        // ⚠️ is two code points. Matching the bare ⚠ first would hide the visible half and leave
        // U+FE0F at the head of the announced string — invisible in every editor and every diff.
        const { glyph, rest } = splitStatusGlyph('⚠️ Pension exceeds gross pay');
        assert.equal(glyph, '⚠️');
        assert.equal(rest, 'Pension exceeds gross pay');
        assert.ok(!/️/.test(rest), 'no orphaned variation selector');
    });

    test('a glyph that is the whole message is left alone', () => {
        // `…` and a bare tick are used as the entire content of a cell or button while something
        // loads. Hiding that leaves an element announcing nothing at all.
        const el = makeEl();
        setStatus(el, '✓');
        assert.equal(announced(el), '✓');
        assert.deepEqual(splitStatusGlyph('✓'), { glyph: '', rest: '✓' });
    });

    test('a glyph running into a word is not decoration either', () => {
        assert.deepEqual(splitStatusGlyph('✓Saved'), { glyph: '', rest: '✓Saved' });
    });

    test('a message with no glyph is passed through untouched', () => {
        const el = makeEl();
        setStatus(el, 'Deleted 3 saved changes');
        assert.equal(announced(el), 'Deleted 3 saved changes');
        assert.equal(el.childNodes.length, 1, 'no span is added where there is nothing to hide');
    });

    test('a glyph in the MIDDLE is never touched', () => {
        // "Week 3 ✓ complete" is a sentence containing a tick, not a status prefix.
        assert.deepEqual(splitStatusGlyph('Week 3 ✓ complete'),
            { glyph: '', rest: 'Week 3 ✓ complete' });
    });
});

describe('a converted call site reads back exactly as before', () => {
    // The property the whole migration rests on. If this breaks, every converted call site and every
    // assertion that reads one start failing for a reason unrelated to what they test.
    for (const msg of [
        '✓ Settings saved',
        '⚠ No working days in that range — nothing to record.',
        '⚠️ Some roster details couldn\'t load — please tell the admin.',
        '✗ Copy failed',
        '↻ Updating your shifts…',
        'no glyph at all',
    ]) {
        test(JSON.stringify(msg), () => {
            const el = makeEl();
            setStatus(el, msg);
            assert.equal(el.textContent, msg);
        });
    }
});

describe('it never throws where the old assignment could not', () => {
    test('a missing element is a no-op', () => {
        // Several call sites write to an element that only exists on one page, and relied on the
        // caller's own `if (el)`. A helper that threw would turn a cosmetic absence into a fatal.
        assert.doesNotThrow(() => setStatus(null, '✓ ok'));
        assert.doesNotThrow(() => setStatus(undefined, '✓ ok'));
    });

    test('a non-string message is coerced, not crashed', () => {
        const el = makeEl();
        setStatus(el, /** @type {any} */ (42));
        assert.equal(el.textContent, '42');
    });
});
