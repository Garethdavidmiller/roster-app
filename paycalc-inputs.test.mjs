// Tests for paycalc-inputs.js — the DOM-pure form-field readers + live decimal hint extracted
// from paycalc-app.js (v18.60, review item 10). No module mocks: the helpers read a global
// `document`, so we install a minimal fake DOM. Part of test:hygiene.
import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { numVal, numValOr, intVal, hhmmDec, hmPair, clampMins, _decHintEl, decPreview, wireIosTap, decimalHoursText, commitFocusedField,
    paintTaxCodeWarning, hoursTextToHM } from './paycalc-inputs.js';

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

// A DECIMAL IN THE HOURS BOX, BEFORE BLUR (72-hour review). "7.5" is split into 7h 30m on blur,
// but every keystroke before that recalculates — and the read was parseInt, so the live estimate
// priced 7h, and an autosave while the field still held focus stored 7h. The read now mirrors the
// blur split exactly (the minutes box is REPLACED by the fraction, as the blur does), so what is
// priced, what is stored and what the member sees after blur are the same number.
test('hhmmDec / hmPair read a decimal hours value the way the blur split will', () => {
  installDom({ h: field('7.5'), m: field('') });
  assert.equal(hhmmDec('h', 'm'), 7.5, 'a typed 7.5 prices as 7.5 hours, not 7');
  assert.deepEqual(hmPair('h', 'm'), { h: 7, m: 30 });
  installDom({ h: field('7.5'), m: field('15') });
  assert.deepEqual(hmPair('h', 'm'), { h: 7, m: 30 }, 'the blur replaces the minutes — so does the read');
  installDom({ h: field('7.999'), m: field('') });
  assert.deepEqual(hmPair('h', 'm'), { h: 8, m: 0 }, 'a fraction that rounds to 60m carries');
  installDom({ h: field('-2.5'), m: field('') });
  assert.equal(hhmmDec('h', 'm'), 0, 'hours can never be negative');
  installDom({ h: field('8'), m: field('45') });
  assert.deepEqual(hmPair('h', 'm'), { h: 8, m: 45 }, 'no decimal → the two fields as typed');
});

// A desk keyboard can type a clock time into the hours box, and parseInt stopped at the colon: "7:30"
// was priced and saved as 7h while the box went on reading 7:30 (whole-app review, Nov 2026).
test('an hours box holding a clock time reads as hours and minutes — priced, previewed and split alike', () => {
  for (const [typed, want] of [['7:30', { h: 7, m: 30 }], [' 7:30 ', { h: 7, m: 30 }], ['7:5', { h: 7, m: 5 }],
                               [':30', { h: 0, m: 30 }], ['7:', { h: 7, m: 0 }], ['7:75', { h: 7, m: 59 }]]) {
    assert.deepEqual(hoursTextToHM(typed), want, JSON.stringify(typed));
  }
  for (const typed of ['', '7', ':', 'abc']) assert.equal(hoursTextToHM(typed), null, `${JSON.stringify(typed)} is not more than whole hours`);
  assert.deepEqual(hoursTextToHM('7.5'), { h: 7, m: 30 }, 'the decimal reading is the same reader');
  assert.deepEqual(hoursTextToHM('7,5'), { h: 7, m: 30 }, 'and the decimal comma');
  installDom({ h: field('7:30'), m: field('15') });
  assert.deepEqual(hmPair('h', 'm'), { h: 7, m: 30 }, 'the minutes box is replaced, as the blur split will');
  assert.equal(hhmmDec('h', 'm'), 7.5);
  const hint = new FakeEl('div');
  const col = new FakeEl('div'); const wrap = new FakeEl('div'); wrap.className = 'hhmm-wrap';
  const h = field('7:30'); col.appendChild(wrap); wrap.appendChild(h); col.appendChild(hint); hint.className = 'hhmm-dec-hint';
  installDom({ h });
  decPreview('h');
  assert.equal(hint.textContent, '= 7h 30m', 'the live preview shows it before the split');
  assert.equal(hint.hidden, false);
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

// A DECIMAL COMMA (whole-app review, Oct 2026). A phone set to a decimal-comma region offers "," on
// the decimal keypad, and "7,5" priced 7h — the preview and the blur split looked for "." only.
test('a decimal COMMA in an hours box is read as the point, by the read and by the preview', () => {
  installDom({ h: field('7,5'), m: field('') });
  assert.deepEqual(hmPair('h', 'm'), { h: 7, m: 30 });
  assert.equal(hhmmDec('h', 'm'), 7.5);
  const wrap = new FakeEl('div'); wrap.className = 'hhmm-wrap';
  const col = new FakeEl('div'); col.appendChild(wrap);
  const h = field('7,5'); wrap.appendChild(h);
  installDom({ h });
  decPreview('h');
  assert.equal(col.querySelector('.hhmm-dec-hint')?.textContent, '= 7h 30m');
});

// ── decimalHoursText (the Decimal Hours Converter card) ──────────────────────────
// The iPhone audit (7 Nov 2026): the converter was the one figure box still reading with a bare
// parseFloat, so "7,5" from a decimal-comma keypad answered "7 hrs" — half an hour short, on the card
// whose whole job is the conversion. Its blank and unreadable answers are pinned too, because the
// comma-aware parser that floors to 0 would have turned both into "0 mins".
describe('decimalHoursText — the converter card reads what the member typed', () => {
  test('a decimal COMMA is the decimal point, as it is in every other box', () => {
    assert.equal(decimalHoursText('7,5'), '7 hrs 30 mins');
    assert.equal(decimalHoursText('0,25'), '15 mins');
    assert.equal(decimalHoursText('7.5'), '7 hrs 30 mins', 'the point, as before');
  });
  test('the three shapes of the answer, singular and plural', () => {
    assert.equal(decimalHoursText('8'), '8 hrs');
    assert.equal(decimalHoursText('1'), '1 hr');
    assert.equal(decimalHoursText('0.5'), '30 mins');
    assert.equal(decimalHoursText('1.0167'), '1 hr 1 min');
    assert.equal(decimalHoursText('7.999'), '8 hrs', 'a fraction that rounds to 60 minutes carries');
  });
  test('nothing usable answers "–", never a made-up "0 mins"', () => {
    assert.equal(decimalHoursText(''), '–');
    assert.equal(decimalHoursText('   '), '–');
    assert.equal(decimalHoursText('abc'), '–');
    assert.equal(decimalHoursText('-2'), '–', 'hours are never negative');
    assert.equal(decimalHoursText('0'), '0 mins', 'a typed zero is still an answer');
  });
  test('a clock time is already hours and minutes, and a half-read number answers nothing', () => {
    // The parser stops at the first character it cannot use: "7:30" answered "7 hrs" and "1e3"
    // answered "1000 hrs" (whole-app check, 10 Nov 2026).
    assert.equal(decimalHoursText('7:30'), '7 hrs 30 mins');
    assert.equal(decimalHoursText(':45'), '45 mins');
    assert.equal(decimalHoursText('7:05'), '7 hrs 5 mins');
    assert.equal(decimalHoursText('7:75'), '–', 'no clock reads 75 minutes');
    assert.equal(decimalHoursText('1e3'), '–', 'not "1000 hrs"');
    assert.equal(decimalHoursText('7.5h'), '–');
    assert.equal(decimalHoursText('.5'), '30 mins', 'a leading point is still a number');
    assert.equal(decimalHoursText(' 7.5 '), '7 hrs 30 mins', 'spaces around it are not');
  });
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

    // THE BRANCH THE IMPLEMENTATION WAS WRITTEN FOR, AND THE ONE NOTHING TESTED (v21.78, external
    // review). `preventDefault()` exists precisely because the synthesised click often never
    // arrives — and the old duplicate guard was a boolean that only that click could clear. When it
    // did not arrive the flag stayed set for ever, and the next genuine activation (a mouse click,
    // or Enter on a hybrid device) was swallowed once, silently. Every existing case above fires
    // the synthetic click, so they all passed on the defect.
    test('a touch with NO synthetic click does not swallow the next genuine click', () => {
        mock.timers.enable({ apis: ['Date'] });
        try {
            const el = fakeEl();
            let calls = 0;
            wireIosTap(/** @type {any} */ (el), () => { calls++; });
            el.fire('touchstart', touchEv(touch(10, 10)));
            el.fire('touchend', touchEv());
            assert.equal(calls, 1);
            // No click follows — iOS cancelled it, which is the whole reason this helper exists.
            mock.timers.tick(5000);
            el.fire('click', {});
            assert.equal(calls, 2, 'a later real click must always work');
        } finally { mock.timers.reset(); }
    });

    test('the echo of a tap is still suppressed when it does arrive', () => {
        mock.timers.enable({ apis: ['Date'] });
        try {
            const el = fakeEl();
            let calls = 0;
            wireIosTap(/** @type {any} */ (el), () => { calls++; });
            el.fire('touchstart', touchEv(touch(10, 10)));
            el.fire('touchend', touchEv());
            mock.timers.tick(120);          // a synthesised click trails its touch closely
            el.fire('click', {});
            assert.equal(calls, 1, 'one tap is one action');
        } finally { mock.timers.reset(); }
    });

    // A THIRD way to be wrong, found in the v21.77 regression check: firing when the control is
    // DISABLED. The browser suppresses `click` on a disabled button, which is why every other
    // control on the page can trust `disabled` — it does not suppress touch events, so the
    // touchend route added for iOS walked straight past it. The result would have been a
    // greyed-out button that works on a phone and not on a desktop.
    test('a disabled control does not act — on either path', () => {
        const el = fakeEl();
        let calls = 0;
        wireIosTap(/** @type {any} */ (el), () => { calls++; });
        el.disabled = true;
        el.fire('touchstart', touchEv(touch(10, 10)));
        el.fire('touchend', touchEv());
        assert.equal(calls, 0, 'touchend must respect disabled, since the browser will not');
        el.fire('click', {});
        assert.equal(calls, 0);
        // Checked at EVENT time, not wiring time: consumers toggle `disabled` while the page runs.
        el.disabled = false;
        el.fire('touchstart', touchEv(touch(10, 10)));
        el.fire('touchend', touchEv());
        assert.equal(calls, 1, 're-enabling must restore the control without re-wiring it');
    });

    test('aria-disabled is honoured too — not every inert control is a <button>', () => {
        const el = fakeEl();
        el.getAttribute = (/** @type {string} */ n) => (n === 'aria-disabled' ? 'true' : null);
        let calls = 0;
        wireIosTap(/** @type {any} */ (el), () => { calls++; });
        el.fire('touchstart', touchEv(touch(10, 10)));
        el.fire('touchend', touchEv());
        el.fire('click', {});
        assert.equal(calls, 0);
    });

    test('a multi-finger gesture is never a tap', () => {
        const el = fakeEl();
        let calls = 0;
        wireIosTap(/** @type {any} */ (el), () => { calls++; });
        el.fire('touchstart', touchEv(touch(10, 10), touch(50, 50)));
        el.fire('touchend', touchEv());
        assert.equal(calls, 0);
    });

    // releaseFocus (the iPhone audit, 7 Nov 2026). The preventDefault() that stops the duplicate
    // click also cancels the tap's move of focus, so on the touch path the field being typed in kept
    // it — and the prior-year Holiday Pay Premium, which commits only on `change`, committed AFTER the
    // arrow had moved the page to another tax year. The ORDER is the property: blur, then act.
    test('releaseFocus: the touch path lets go of the field BEFORE it acts', () => {
        const order = [];
        global.document = /** @type {any} */ ({ activeElement: { tagName: 'INPUT', blur: () => order.push('blur') } });
        const el = fakeEl();
        wireIosTap(/** @type {any} */ (el), () => order.push('action'), { releaseFocus: true });
        el.fire('touchstart', touchEv(touch(10, 10)));
        el.fire('touchend', touchEv());
        assert.deepEqual(order, ['blur', 'action'], 'a field that commits on leaving must commit where it was typed');
    });

    test('without it, the field keeps the focus — the ± sign button, whose box is still being typed in', () => {
        let blurred = 0;
        global.document = /** @type {any} */ ({ activeElement: { tagName: 'INPUT', blur: () => { blurred++; } } });
        const el = fakeEl();
        let calls = 0;
        wireIosTap(/** @type {any} */ (el), () => { calls++; });
        el.fire('touchstart', touchEv(touch(10, 10)));
        el.fire('touchend', touchEv());
        assert.equal(calls, 1);
        assert.equal(blurred, 0);
    });

    test('a click needs no releasing: the browser has already moved the focus', () => {
        let blurred = 0;
        global.document = /** @type {any} */ ({ activeElement: { tagName: 'INPUT', blur: () => { blurred++; } } });
        const el = fakeEl();
        let calls = 0;
        wireIosTap(/** @type {any} */ (el), () => { calls++; }, { releaseFocus: true });
        el.fire('click', {});
        assert.equal(calls, 1);
        assert.equal(blurred, 0);
    });
});

// ── commitFocusedField (the iPhone audit, 7 Nov 2026) ─────────────────────────────────────────────
describe('commitFocusedField — let go of the field in hand, and only a field', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
        test(`a focused ${tagName} is blurred, so what it commits on leaving commits now`, () => {
            let blurred = 0;
            global.document = /** @type {any} */ ({ activeElement: { tagName, blur: () => { blurred++; } } });
            commitFocusedField();
            assert.equal(blurred, 1);
        });
    }
    test('a focused button or bar keeps its focus — there is nothing in it to commit', () => {
        let blurred = 0;
        for (const tagName of ['BUTTON', 'DIV', 'BODY']) {
            global.document = /** @type {any} */ ({ activeElement: { tagName, blur: () => { blurred++; } } });
            commitFocusedField();
        }
        assert.equal(blurred, 0);
    });
    test('nothing focused is not an error', () => {
        global.document = /** @type {any} */ ({ activeElement: null });
        assert.doesNotThrow(() => commitFocusedField());
    });
});

// ── paintTaxCodeWarning (whole-app review, Nov 2026) ──────────────────────────────────────────────
// A code computeTax does not recognise is priced on the standard 1257L allowance; until this, only the
// "Check against your payslip" line said so. The box now says it too — and not while it is being
// typed in, when every code is briefly unrecognised ("1257" on the way to "1257L").
describe('paintTaxCodeWarning — an unrecognised tax code said under the box it was typed in', () => {
    /** A node with just enough of the DOM for the painter and setStatus. */
    class Node {
        constructor(tag = 'div') {
            this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null; this._attrs = {};
            this.id = ''; this.className = ''; this._text = ''; this.ownerDocument = global.document;
            const cls = new Set();
            this.classList = { toggle: (c, on) => { if (on) cls.add(c); else cls.delete(c); }, contains: c => cls.has(c) };
        }
        get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
        set textContent(v) { this._text = String(v); this.children = []; }
        setAttribute(k, v) { this._attrs[k] = String(v); }
        getAttribute(k) { return this._attrs[k] ?? null; }
        appendChild(c) { c.parentElement = this; this.children.push(c); return c; }
        append(c) { this.appendChild(c); }
        closest(sel) { let n = this; while (n) { if (sel === '.field' && n.className === 'field') return n; n = n.parentElement; } return null; }
    }
    /** The Settings field: a `.field` holding the box. @param {boolean} focused */
    function settingsField(focused) {
        const nodes = /** @type {Record<string, any>} */ ({});
        global.document = /** @type {any} */ ({
            getElementById: (/** @type {string} */ id) => nodes[id] ?? null,
            createElement: (/** @type {string} */ t) => { const n = new Node(t); n.ownerDocument = global.document; return n; },
            createTextNode: (/** @type {string} */ s) => ({ textContent: s }),
        });
        const wrap = new Node('div'); wrap.className = 'field';
        const input = new Node('input'); input.id = 'taxCode'; wrap.appendChild(input);
        nodes.taxCode = input;
        const realAppend = wrap.appendChild.bind(wrap);
        wrap.appendChild = (/** @type {any} */ c) => { if (c.id) nodes[c.id] = c; return realAppend(c); };
        /** @type {any} */ (global.document).activeElement = focused ? input : null;
        return { wrap, input, warn: () => nodes.taxCodeWarn ?? null };
    }

    test('an unrecognised code, the box left: the warning is built, shown, and names the box', () => {
        const f = settingsField(false);
        paintTaxCodeWarning({ code: 'OT', recognised: false });
        const w = f.warn();
        assert.ok(w, 'the warning is built on first need');
        assert.equal(w.parentElement, f.wrap, 'under the box, in its field');
        assert.equal(w.classList.contains('show'), true);
        assert.match(w.textContent, /doesn't recognise this tax code/);
        assert.match(w.textContent, /standard 1257L allowance/);
        assert.match(w.textContent, /zero, not the letter O/, 'the commonest slip is named');
        assert.equal(w.children[0].getAttribute('aria-hidden'), 'true', 'the ⚠ is kept out of the announcement');
        assert.equal(f.input.getAttribute('aria-describedby'), 'taxCodeWarn', 'a screen reader hears it on the box');
    });

    test('held back while the box has focus — every code is briefly unrecognised as it is typed', () => {
        const f = settingsField(true);
        paintTaxCodeWarning({ code: '1257', recognised: false });
        assert.equal(f.warn(), null, 'nothing is built while typing');
        /** @type {any} */ (global.document).activeElement = null;   // the box is left
        paintTaxCodeWarning({ code: '1257', recognised: false });
        assert.equal(f.warn()?.classList.contains('show'), true);
        assert.match(f.warn().textContent, /ends in a letter/, 'a code of numbers alone is told what is missing');
        /** @type {any} */ (global.document).activeElement = f.input;   // back in the box to fix it
        paintTaxCodeWarning({ code: '1257', recognised: false });
        assert.equal(f.warn().classList.contains('show'), false);
        assert.equal(f.warn().textContent, '');
    });

    test('a recognised code shows nothing, and clears a warning already there', () => {
        const f = settingsField(false);
        paintTaxCodeWarning({ code: '1257L', recognised: true });
        assert.equal(f.warn(), null, 'nothing to say, nothing built');
        paintTaxCodeWarning({ code: 'OT', recognised: false });
        paintTaxCodeWarning({ code: '0T', recognised: true });
        assert.equal(f.warn().classList.contains('show'), false);
        assert.equal(f.warn().textContent, '');
    });

    test('no Tax Code box on the page is not an error', () => {
        global.document = /** @type {any} */ ({ getElementById: () => null, activeElement: null });
        assert.doesNotThrow(() => paintTaxCodeWarning({ code: 'OT', recognised: false }));
    });
});
