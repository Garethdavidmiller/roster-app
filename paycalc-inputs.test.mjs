// Tests for paycalc-inputs.js — the DOM-pure form-field readers + live decimal hint extracted
// from paycalc-app.js (v18.60, review item 10). No module mocks: the helpers read a global
// `document`, so we install a minimal fake DOM. Part of test:hygiene.
import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { numVal, numValOr, intVal, hhmmDec, clampMins, _decHintEl, decPreview, wireIosTap } from './paycalc-inputs.js';

// ── Minimal fake DOM ───────────────────────────────────────────────────────────
class FakeEl {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.value = '';
    this.className = '';
    this.hidden = false;
    this.textContent = '';
    this._attrs = {};
    this.children = [];
    this.parentElement = null;
  }
  setAttribute(k, v) { this._attrs[k] = v; }
  appendChild(c) { c.parentElement = this; this.children.push(c); return c; }
  _hasClass(sel) { return ('.' + this.className) === sel || this.className.split(' ').map(c => '.' + c).includes(sel); }
  closest(sel) { let n = this; while (n) { if (n._hasClass(sel)) return n; n = n.parentElement; } return null; }
  querySelector(sel) { return this.children.find(c => c._hasClass(sel)) || null; }
}

/** Install a fresh fake document; `byId` maps id → FakeEl. Returns a createElement spy count via el.tagName. */
function installDom(byId = {}) {
  global.document = {
    getElementById: (id) => byId[id] ?? null,
    createElement: (tag) => new FakeEl(tag),
  };
  return byId;
}

function field(value) { const e = new FakeEl('input'); e.value = value; return e; }

// ── numVal ──────────────────────────────────────────────────────────────────────
test('numVal parses a plain number, and smart-hyphen / missing element cases', () => {
  installDom({ a: field('12.5'), neg: field('−5') /* minus sign */ });
  assert.equal(numVal('a'), 12.5);
  assert.equal(numVal('neg'), -5);          // parseSmartFloat normalises the unicode minus
  assert.equal(numVal('missing'), 0);       // absent element → '' → 0
});

// ── numValOr ────────────────────────────────────────────────────────────────────
test('numValOr returns the fallback for empty / unparseable, the number otherwise', () => {
  installDom({ pay: field('21758.94'), junk: field('.'), blank: field('   ') });
  assert.equal(numValOr('pay', null), 21758.94);
  assert.equal(numValOr('junk', null), null);   // lone "." is not a number → fallback, NOT 0
  assert.equal(numValOr('blank', null), null);
  assert.equal(numValOr('missing', 7), 7);
});

// ── intVal (floors at 0, integers only) ──────────────────────────────────────────
test('intVal floors negatives to 0 and truncates to an integer', () => {
  installDom({ h: field('8'), frac: field('7.9'), neg: field('-5'), junk: field('abc') });
  assert.equal(intVal('h'), 8);
  assert.equal(intVal('frac'), 7);   // parseInt truncates
  assert.equal(intVal('neg'), 0);    // Math.max(0, …) floor
  assert.equal(intVal('junk'), 0);
});

// ── hhmmDec (hours + minutes → decimal) ──────────────────────────────────────────
test('hhmmDec combines the hrs and mins fields into decimal hours', () => {
  installDom({ h: field('7'), m: field('30') });
  assert.equal(hhmmDec('h', 'm'), 7.5);
  installDom({ h: field('8'), m: field('0') });
  assert.equal(hhmmDec('h', 'm'), 8);
});

// ── clampMins (rewrites only when out of range) ──────────────────────────────────
test('clampMins clamps an out-of-range minute to 59 and leaves valid/typed values alone', () => {
  const els = installDom({ over: field('75'), ok: field('30'), typed: field('05'), empty: field('') });
  clampMins('over');  assert.equal(els.over.value, '59');   // clamped
  clampMins('ok');    assert.equal(els.ok.value, '30');     // unchanged
  clampMins('typed'); assert.equal(els.typed.value, '05');  // valid → NOT rewritten (preserves "05")
  clampMins('empty'); assert.equal(els.empty.value, '');    // NaN → no rewrite
  clampMins('missing');                                     // absent → no throw
});

// ── _decHintEl (lazy hint element under the hrs:mins pair) ────────────────────────
test('_decHintEl finds/creates the hint only when asked, and returns null on missing markup', () => {
  const wrap = new FakeEl('div'); wrap.className = 'hhmm-wrap';
  const col = new FakeEl('div'); col.appendChild(wrap);   // wrap.parentElement = col
  const h = field('7.5'); wrap.appendChild(h);            // h.closest('.hhmm-wrap') = wrap
  installDom({ h });

  assert.equal(_decHintEl('h', false), null);             // make=false and none exists → null
  const created = _decHintEl('h', true);                  // make=true → creates + appends to col
  assert.ok(created);
  assert.equal(created.className, 'hhmm-dec-hint');
  assert.equal(col.children.includes(created), true);
  assert.equal(_decHintEl('h', false), created);          // second call finds the same one

  installDom({ lone: field('7.5') });                     // no .hhmm-wrap ancestor
  assert.equal(_decHintEl('lone', true), null);
});

// ── decPreview (live "= 7h 30m" while typing a decimal) ──────────────────────────
test('decPreview writes the hh/mm hint for a decimal and hides it for a whole number', () => {
  const wrap = new FakeEl('div'); wrap.className = 'hhmm-wrap';
  const col = new FakeEl('div'); col.appendChild(wrap);
  const h = field('7.5'); wrap.appendChild(h);
  installDom({ h });

  decPreview('h');
  const hint = col.querySelector('.hhmm-dec-hint');
  assert.ok(hint);
  assert.equal(hint.textContent, '= 7h 30m');
  assert.equal(hint.hidden, false);

  h.value = '8';           // no decimal point → hint hidden
  decPreview('h');
  assert.equal(hint.hidden, true);
});

// ── wireIosTap (v21.66) ──────────────────────────────────────────────────────────────────────────
//
// Organised by the two ways this wiring can be wrong, both of which shipped or nearly shipped:
// the tap NOT firing (the original iOS defect — click cancelled by the keyboard dismissal, so
// "Replace with calendar values" silently did nothing), and firing when it MUST NOT — twice for
// one tap (touchend + the synthesised click), or on a scroll flick that happens to end on a
// full-width destructive button. A suite asserting only "the action runs" would pass on exactly
// the unguarded touchend implementation these guards exist to prevent.
describe('wireIosTap — guarded touch/click wiring', () => {
    /** Minimal event-capable element. */
    function fakeEl() {
        const listeners = {};
        return {
            addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
            fire: (type, e) => (listeners[type] ?? []).forEach(fn => fn(e)),
        };
    }
    const touch = (x, y) => ({ clientX: x, clientY: y });
    const touchEv = (...touches) => ({ touches, preventDefault: mock.fn() });

    test('a mouse click fires the action exactly once, with the event', () => {
        const el = fakeEl();
        const calls = [];
        wireIosTap(/** @type {any} */ (el), e => calls.push(e));
        const ev = { type: 'click' };
        el.fire('click', ev);
        assert.equal(calls.length, 1);
        assert.equal(calls[0], ev);
    });

    test('a clean tap fires ONCE from touchend, suppresses the synthesised click, and swallows one anyway sent', () => {
        const el = fakeEl();
        let calls = 0;
        wireIosTap(/** @type {any} */ (el), () => { calls++; });
        el.fire('touchstart', touchEv(touch(10, 10)));
        const end = touchEv();
        el.fire('touchend', end);
        assert.equal(calls, 1, 'touchend runs the action — the path iOS cannot cancel');
        assert.equal(end.preventDefault.mock.callCount(), 1, 'the synthesised click is suppressed at source');
        el.fire('click', {});   // a browser that synthesises one anyway
        assert.equal(calls, 1, 'the synthesised click must not run the action a second time');
        el.fire('click', {});   // a LATER real click (new gesture) must still work
        assert.equal(calls, 2);
    });

    test('a scroll flick that ends on the element does NOT fire — destructive buttons are wide', () => {
        const el = fakeEl();
        let calls = 0;
        wireIosTap(/** @type {any} */ (el), () => { calls++; });
        el.fire('touchstart', touchEv(touch(10, 100)));
        el.fire('touchmove', touchEv(touch(10, 60)));   // 40px — a scroll, not a tap
        el.fire('touchend', touchEv());
        assert.equal(calls, 0);
    });

    test('finger jitter within the slop still counts as a tap', () => {
        const el = fakeEl();
        let calls = 0;
        wireIosTap(/** @type {any} */ (el), () => { calls++; });
        el.fire('touchstart', touchEv(touch(10, 100)));
        el.fire('touchmove', touchEv(touch(14, 95)));   // 5px — nobody's finger is a stylus
        el.fire('touchend', touchEv());
        assert.equal(calls, 1);
    });

    test('a multi-finger gesture is never a tap', () => {
        const el = fakeEl();
        let calls = 0;
        wireIosTap(/** @type {any} */ (el), () => { calls++; });
        el.fire('touchstart', touchEv(touch(10, 10), touch(50, 50)));
        el.fire('touchend', touchEv());
        assert.equal(calls, 0);
    });
});
