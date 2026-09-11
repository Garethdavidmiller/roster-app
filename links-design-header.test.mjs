// @ts-check
/**
 * links-design-header.test.mjs — the design masthead, organised by what a wrong answer COSTS.
 *
 * The expensive direction is a masthead that LIES about state: "Saved" over a design with edits the
 * server never saw, or a saved-looking label on a design that has no document at all. Both are
 * silent — nothing throws, the grid looks the same — and the designer closes the page. The cheap
 * direction is nagging: an amber pill over a clean design costs attention and nothing else.
 *
 * The render half runs against a two-line fake DOM, because everything worth checking about it is
 * what the markup SAYS and whether the select was rebuilt when it need not have been (rule 4 in the
 * module header — a rebuild mid-paint on Android closes an open picker).
 */
import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
    groupDesigns, saveButtonLabel, statusCopy, whoCopy, proposeNewDesignName, toDate, createDesignHeader,
} from './links-design-header.js';

const ME = 'G. Miller';
const at = (/** @type {number} */ ms) => ({ toDate: () => new Date(ms) });
const NOW = new Date(2026, 8, 8, 14, 32);   // Tue 8 Sep 2026 14:32 local

describe('grouping — your own first, others alphabetical, newest first inside a group', () => {
    const designs = [
        { id: 'c', name: 'Dec 26 proposal v3', updatedBy: 'S. Silva', updatedAt: at(3_000) },
        { id: 'a', name: 'Option A',           updatedBy: ME,         updatedAt: at(2_000) },
        { id: 'd', name: 'Trial',              updatedBy: 'M. Robson', updatedAt: at(9_000) },
        { id: 'b', name: 'Option B',           updatedBy: ME,         updatedAt: at(5_000) },
    ];
    test('the current user leads, whatever the alphabet says', () => {
        const g = groupDesigns(designs, ME);
        assert.deepEqual(g.map(x => x.label),
            ['Last saved by you', 'Last saved by M. Robson', 'Last saved by S. Silva']);
        assert.equal(g[0].own, true);
        assert.equal(g[1].own, false);
    });
    test('inside a group the most recently saved design comes first', () => {
        const mine = groupDesigns(designs, ME)[0].designs.map(d => d.id);
        assert.deepEqual(mine, ['b', 'a']);
    });
    test('a design with no saver is still offered — under the not-recorded group, last', () => {
        const g = groupDesigns([...designs, { id: 'x', name: 'Legacy', updatedAt: null }], ME);
        assert.equal(g.at(-1)?.label, 'Last saver not recorded');
        assert.equal(g.at(-1)?.designs[0].id, 'x');
        assert.equal(g.flatMap(x => x.designs).length, 5, 'nothing dropped');
    });
    test('a user who has saved nothing gets no empty "Last saved by you" group', () => {
        const g = groupDesigns(designs, 'Somebody Else');
        assert.ok(g.every(x => x.label !== 'Last saved by you'));
    });

    // The labels above are strings and could be reworded; THIS is the rule behind them, and it is
    // the one an edit can silently break. The grouping key is `updatedBy` — last saver — so a
    // heading that claims OWNERSHIP is false the moment a colleague saves your design, and it says
    // so about a design you are looking at, in a workspace where designs are shared. Pinned as a
    // property of every label rather than as three more literals.
    test('no group heading claims OWNERSHIP — the key is last-saver, so only that may be stated', () => {
        for (const who of [ME, 'S. Silva', 'Somebody Else']) {
            for (const { label } of groupDesigns([...designs, { id: 'x', name: 'Legacy' }], who)) {
                assert.doesNotMatch(label, /^Your\b/,  `"${label}" claims the reader owns these`);
                assert.doesNotMatch(label, /'s designs$/, `"${label}" claims somebody else owns these`);
            }
        }
    });

    test('a design you created MOVES when a colleague saves it — and the heading is still true', () => {
        // The known wobble, stated as a test rather than only in the header: same design, same
        // reader, different last saver. It is not a defect, so nothing here asserts it stays put —
        // what is asserted is that the heading describes SAVING, which survives the move.
        const mine  = groupDesigns([{ id: 'd', name: 'Option A', updatedBy: ME }], ME);
        const after = groupDesigns([{ id: 'd', name: 'Option A', updatedBy: 'S. Silva' }], ME);
        assert.equal(mine[0].label,  'Last saved by you');
        assert.equal(after[0].label, 'Last saved by S. Silva');
        assert.equal(mine[0].own,  true);
        assert.equal(after[0].own, false);
    });
});

describe('the Save button says what pressing it will do', () => {
    test('a design with no document yet: Save as…, because the press will ASK for a name', () => {
        assert.equal(saveButtonLabel({ saved: false, dirty: true }), 'Save as…');
        assert.equal(saveButtonLabel({ saved: false, dirty: false }), 'Save as…');
    });
    test('a saved design: Save while dirty, Saved when clean', () => {
        assert.equal(saveButtonLabel({ saved: true, dirty: true }), 'Save');
        assert.equal(saveButtonLabel({ saved: true, dirty: false }), 'Saved');
    });
});

describe('the status pill — lying about saved state is the expensive direction', () => {
    test('unsaved edits are never reported as saved, whatever the timestamp says', () => {
        const s = statusCopy({ saved: true, dirty: true, updatedAt: at(NOW.getTime()), now: NOW });
        assert.equal(s.tone, 'dirty');
        assert.ok(!/saved/i.test(s.long) || /unsaved/i.test(s.long), s.long);
        assert.equal(s.short, 'Unsaved');
    });
    test('a design with no document is "not saved", not "saved" and not "unsaved changes"', () => {
        const s = statusCopy({ saved: false, dirty: true, now: NOW });
        assert.equal(s.tone, 'new');
        assert.equal(s.long, 'Not saved yet');
    });
    test('saving overrides everything else while it is in flight', () => {
        assert.equal(statusCopy({ saved: true, dirty: true, saving: true }).tone, 'saving');
    });
    test('a save today states the time; an older one the date and time; another year names the year', () => {
        assert.equal(statusCopy({ saved: true, dirty: false, updatedAt: at(NOW.getTime()), now: NOW }).long, 'Saved today at 14:32');
        assert.equal(statusCopy({ saved: true, dirty: false, updatedAt: at(NOW.getTime()), now: NOW }).short, 'Saved 14:32');
        const earlier = statusCopy({ saved: true, dirty: false, updatedAt: at(new Date(2026, 8, 3, 9, 5).getTime()), now: NOW });
        assert.equal(earlier.long, 'Saved 3 Sept at 09:05');
        assert.equal(earlier.short, 'Saved 3 Sept');
        const lastYear = statusCopy({ saved: true, dirty: false, updatedAt: at(new Date(2025, 8, 3, 9, 5).getTime()), now: NOW });
        assert.match(lastYear.long, /2025/);
    });
    test('a saved design whose timestamp has not resolved yet still says Saved, with no invented time', () => {
        const s = statusCopy({ saved: true, dirty: false, updatedAt: null, now: NOW });
        assert.equal(s.long, 'Saved');
    });
});

describe('who the badge names', () => {
    test('an unsaved design is attributed to whoever is about to save it', () => {
        assert.deepEqual(whoCopy({ saved: false, updatedBy: 'S. Silva', currentUser: ME }), { name: ME, role: 'Will be saved by you' });
    });
    test('a saved design names its last saver, and says "you" when that is the reader', () => {
        assert.deepEqual(whoCopy({ saved: true, updatedBy: ME, currentUser: ME }), { name: ME, role: 'Last saved by you' });
        assert.deepEqual(whoCopy({ saved: true, updatedBy: 'S. Silva', currentUser: ME }), { name: 'S. Silva', role: 'Last saved by' });
    });
});

describe('the pre-filled first-save name', () => {
    test('names the designer and the day', () => {
        assert.equal(proposeNewDesignName(ME, [], NOW), 'G. Miller · 8 Sept');
    });
    test('steps past a clash rather than proposing a name the check will refuse', () => {
        const existing = [{ id: '1', name: 'G. Miller · 8 Sept' }, { id: '2', name: 'g. miller · 8 sept 2' }];
        assert.equal(proposeNewDesignName(ME, existing, NOW), 'G. Miller · 8 Sept 3');
    });
});

describe('toDate accepts every shape a timestamp arrives in', () => {
    test('Timestamp-like, Date, epoch ms; nothing for junk', () => {
        assert.equal(toDate(at(1_000))?.getTime(), 1_000);
        assert.equal(toDate(new Date(2_000))?.getTime(), 2_000);
        assert.equal(toDate(3_000)?.getTime(), 3_000);
        assert.equal(toDate(null), null);
        assert.equal(toDate('yesterday'), null);
        assert.equal(toDate(new Date('nope')), null);
    });
});

// ─── the render, against a fake DOM ────────────────────────────────────────────────────────────

/** Just enough element for the renderer: text, classList, dataset, style, disabled, children. */
function el(tag = 'div') {
    /** @type {any} */
    const e = {
        tagName: tag.toUpperCase(), textContent: '', disabled: false, hidden: false, value: '', selected: false,
        style: {}, dataset: {}, children: /** @type {any[]} */ ([]), className: '', label: '',
        _classes: new Set(),
        classList: {
            toggle(/** @type {string} */ c, /** @type {boolean} */ on) { on ? e._classes.add(c) : e._classes.delete(c); },
            contains(/** @type {string} */ c) { return e._classes.has(c); },
        },
        attrs: /** @type {Record<string, string>} */ ({}),
        parent: /** @type {any} */ (null),
        listeners: /** @type {Record<string, Function[]>} */ ({}),
        addEventListener(/** @type {string} */ t, /** @type {Function} */ f) { (e.listeners[t] ||= []).push(f); },
        appendChild(/** @type {any} */ c) { c.parent = e; e.children.push(c); return c; },
        append(/** @type {any[]} */ ...cs) { for (const c of cs) e.appendChild(c); },
        setAttribute(/** @type {string} */ k, /** @type {string} */ v) { e.attrs[k] = String(v); },
        getAttribute(/** @type {string} */ k) { return e.attrs[k] ?? null; },
        /** Only the one selector the delegated handler uses — enough, and it fails loudly on any other. */
        closest(/** @type {string} */ sel) {
            assert.equal(sel, '.picker-opt[data-id]', 'the harness models only the picker row selector');
            for (let n = e; n; n = n.parent) if (String(n.className).includes('picker-opt') && n.dataset?.id) return n;
            return null;
        },
        rebuilds: 0,
    };
    Object.defineProperty(e, 'textContent', {
        get() { return e._text ?? ''; },
        // Clearing textContent removes children, as it does in a real DOM — which is exactly how
        // both the select (before v23.32) and the picker list are emptied before a rebuild.
        set(v) { e._text = String(v); if (e.children.length || v === '') { e.children = []; e.rebuilds += 1; } },
    });
    return e;
}

/** The visible name of a built picker row, and its meta line. */
const rowName = (/** @type {any} */ row) => row.children[0].children[0].textContent;
/** Every built row in the picker list, group headings and the inert unsaved row included. */
const allRows = (/** @type {any} */ list) => {
    const out = /** @type {any[]} */ ([]);
    const walk = (/** @type {any} */ n) => {
        if (String(n.className).split(' ').includes('picker-opt')) { out.push(n); return; }
        for (const c of n.children || []) walk(c);
    };
    for (const c of list.children) walk(c);
    return out;
};
const tickedRows = (/** @type {any} */ list) => allRows(list).filter(r => r.attrs?.['aria-current'] === 'true');
const rowMeta = (/** @type {any} */ row) => row.children[0].children[1].textContent;

function harness() {
    const els = {
        pickList: el(), pickerSub: el(), pickerButton: el('button'),
        faceName: el(), eyebrow: el(), count: el(), masthead: el(),
        avatar: el(), whoName: el(), whoRole: el(), status: el(), statusLong: el(), statusShort: el(),
        saveButtons: [el('button'), el('button')], renameButtons: [el('button')],
        renameMenuButton: el('button'), deleteButton: el('button'),
        sheetAvatar: el(), sheetName: el(), sheetSub: el(),
    };
    const calls = /** @type {string[]} */ ([]);
    globalThis.document = /** @type {any} */ ({ createElement: (/** @type {string} */ t) => el(t) });
    // Two fake lightboxes, injected exactly as the coordinator injects createLightbox. Without them
    // the module's OWN wiring — which control opens which sheet — is untestable, and that is not a
    // hypothetical gap: `pickerButton` was read from the wrong argument when the sheet first shipped
    // and every unit test here still passed, because none of them pressed the face.
    const opened = /** @type {string[]} */ ([]);
    const lb = (/** @type {string} */ tag) => ({ open: () => opened.push(`open:${tag}`), close: () => opened.push(`close:${tag}`) });
    const extra = {
        moreButton: el('button'),
        sheet:  { overlay: el(), content: el(), create: () => lb('more') },
        picker: { overlay: el(), content: el(), create: () => lb('picker') },
    };
    const h = createDesignHeader(/** @type {any} */ (els), { onSelect: id => calls.push(`select:${id}`), onRename: () => calls.push('rename') }, /** @type {any} */ (extra));
    return { els, h, calls, extra, opened };
}
const DESIGNS = [
    { id: 'a', name: 'Option A', updatedBy: ME, updatedAt: at(NOW.getTime()) },
    { id: 'c', name: 'Proposal', updatedBy: 'S. Silva', updatedAt: at(NOW.getTime() - 86_400_000) },
];

describe('render — what the masthead SAYS', () => {
    test('a saved, clean design: its name, its saver, Saved, both Save buttons disabled and labelled Saved', () => {
        const { els, h } = harness();
        h.render({ designs: DESIGNS, activeId: 'a', design: { name: 'Option A' }, dirty: false, currentUser: ME, now: NOW });
        assert.equal(els.faceName.textContent, 'Option A');
        assert.equal(els.whoName.textContent, ME);
        assert.equal(els.whoRole.textContent, 'Last saved by you');
        assert.equal(els.status.className, 'dm-status dm-status--saved');
        assert.equal(els.statusLong.textContent, 'Saved today at 14:32');
        for (const b of els.saveButtons) { assert.equal(b.textContent, 'Saved'); assert.equal(b.disabled, true); }
        assert.equal(els.deleteButton.disabled, false);
        assert.equal(els.count.textContent, '2 saved');
        // The face is aria-hidden, so the BUTTON has to carry the name a <select> announced for free.
        assert.match(els.pickerButton.attrs['aria-label'], /Option A/);
    });
    test('a design fresh from the generator: Untitled, Not saved yet, Save as… ENABLED, rename and delete disabled', () => {
        const { els, h } = harness();
        h.render({ designs: DESIGNS, activeId: null, design: { name: '' }, dirty: true, currentUser: ME, now: NOW });
        assert.equal(els.faceName.textContent, 'Untitled design');
        assert.equal(els.eyebrow.textContent, 'New design');
        assert.ok(els.masthead.classList.contains('is-unnamed'));
        assert.equal(els.status.className, 'dm-status dm-status--new');
        for (const b of els.saveButtons) { assert.equal(b.textContent, 'Save as…'); assert.equal(b.disabled, false); }
        assert.equal(els.renameButtons[0].disabled, true);
        assert.equal(els.deleteButton.disabled, true);
        assert.equal(els.pickList.children[0].className, 'picker-opt is-current');
        assert.equal(els.pickList.children[0].disabled, true, 'the unsaved row has no id to select by, so it is inert');
        assert.equal(rowName(els.pickList.children[0]), 'Untitled design');
    });
    test('the last design cannot be deleted while the bin rule says so, and the row states why through disabled', () => {
        const { els, h } = harness();
        h.render({ designs: DESIGNS.slice(0, 1), activeId: 'a', design: { name: 'Option A' }, dirty: false, currentUser: ME, canDelete: false, now: NOW });
        assert.equal(els.deleteButton.disabled, true);
    });
    test('no design open: the face says so, the status is hidden, Save is disabled', () => {
        const { els, h } = harness();
        h.render({ designs: [], activeId: null, design: null, dirty: false, currentUser: ME, now: NOW });
        assert.equal(els.faceName.textContent, 'No design open');
        assert.equal(els.status.hidden, true);
        for (const b of els.saveButtons) assert.equal(b.disabled, true);
        assert.ok(els.masthead.classList.contains('is-empty'));
    });
    test('the picker list is grouped by designer, and the open design is the one marked current', () => {
        const { els, h } = harness();
        h.render({ designs: DESIGNS, activeId: 'c', design: { name: 'Proposal' }, dirty: false, currentUser: ME, now: NOW });
        assert.deepEqual(els.pickList.children.map((/** @type {any} */ g) => g.attrs['aria-label']),
            ['Last saved by you', 'Last saved by S. Silva']);
        const row = els.pickList.children[1].children[1];   // [0] is the group's own label
        assert.equal(row.dataset.id, 'c');
        assert.equal(rowName(row), 'Proposal');
        assert.equal(rowMeta(row), 'Saved 7 Sept');
        assert.equal(row.attrs['aria-current'], 'true');
        assert.equal(row.children[1].textContent, '✓', 'the tick is a second signal beside the tint — never colour alone');
        // and the one that is NOT open carries neither marker
        const other = els.pickList.children[0].children[1];
        assert.equal(other.attrs['aria-current'], undefined);
        assert.equal(other.children[1].textContent, '');
        assert.equal(els.pickerSub.textContent, '2 saved designs');
    });
    test('RULE 4: a dirty flip does not rebuild the picker list; a new design does', () => {
        const { els, h } = harness();
        const base = { designs: DESIGNS, activeId: 'a', design: { name: 'Option A' }, currentUser: ME, now: NOW };
        h.render({ ...base, dirty: false });
        const after1 = els.pickList.rebuilds;
        h.render({ ...base, dirty: true });
        h.render({ ...base, dirty: true });
        assert.equal(els.pickList.rebuilds, after1, 'painting cells must not tear the rows out from under a reader');
        h.render({ ...base, dirty: true, designs: [...DESIGNS, { id: 'z', name: 'New', updatedBy: ME, updatedAt: at(1) }] });
        assert.equal(els.pickList.rebuilds, after1 + 1);
    });
    test('a saving render freezes the button label rather than flipping it back to Save mid-write', () => {
        const { els, h } = harness();
        for (const b of els.saveButtons) b.textContent = 'Saving…';
        h.render({ designs: DESIGNS, activeId: 'a', design: { name: 'Option A' }, dirty: true, currentUser: ME, saving: true, now: NOW });
        for (const b of els.saveButtons) assert.equal(b.textContent, 'Saving…');
        assert.equal(els.status.className, 'dm-status dm-status--saving');
    });
    test('the wiring: a tap anywhere inside a row reports THAT row\'s id; the pencil reports a rename', () => {
        const { els, h, calls } = harness();
        h.render({ designs: DESIGNS, activeId: 'a', design: { name: 'Option A' }, dirty: false, currentUser: ME, now: NOW });
        // The handler is delegated to the list, so the event target is whatever was under the
        // finger — here the name INSIDE the row, which is what a real tap almost always hits.
        const row = els.pickList.children[1].children[1];
        // The selection waits out the sheet's fade, so the clock has to move for it to land.
        mock.timers.enable({ apis: ['setTimeout'] });
        try {
            for (const f of els.pickList.listeners.click) f({ target: row.children[0].children[0] });
            assert.deepEqual(calls, [], 'nothing is selected until the sheet has gone');
            mock.timers.tick(600);
        } finally { mock.timers.reset(); }
        for (const f of els.renameButtons[0].listeners.click) f();
        assert.deepEqual(calls, ['select:c', 'rename']);
    });
    test('the wiring: the FACE opens the picker and ··· opens the More sheet — each its own', () => {
        const { els, extra, opened } = harness();
        for (const f of els.pickerButton.listeners.click || []) f();
        assert.deepEqual(opened, ['open:picker'], 'the heading face is the picker\'s only trigger');
        for (const f of extra.moreButton.listeners.click || []) f();
        assert.deepEqual(opened, ['open:picker', 'open:more']);
    });
    test('choosing a row closes the picker BEFORE the coordinator loads the design', () => {
        const { els, h, opened } = harness();
        h.render({ designs: DESIGNS, activeId: 'a', design: { name: 'Option A' }, dirty: false, currentUser: ME, now: NOW });
        const row = els.pickList.children[1].children[1];
        for (const f of els.pickList.listeners.click) f({ target: row });
        // A dialog opened during the close races overlay.js's own history.back(), so the close comes
        // first and the selection follows it — never the other way round.
        assert.deepEqual(opened, ['close:picker']);
    });
    test('a tap on a group heading, or on the inert unsaved row, selects nothing', () => {
        const { els, h, calls } = harness();
        h.render({ designs: DESIGNS, activeId: null, design: { name: '' }, dirty: true, currentUser: ME, now: NOW });
        mock.timers.enable({ apis: ['setTimeout'] });
        try {
            for (const f of els.pickList.listeners.click) f({ target: els.pickList.children[1].children[0] });
            for (const f of els.pickList.listeners.click) f({ target: els.pickList.children[0] });
            mock.timers.tick(600);
        } finally { mock.timers.reset(); }
        assert.deepEqual(calls, []);
    });
});

// ─── v23.33: TWO WAYS TO SAY NO, AND BOTH WERE WRONG ───────────────────────────────────────────
//
// Both defects below were found in a browser, not by reading, and both are the same shape: a
// control that CONTRADICTS the one beside it. Neither throws, neither shows in a screenshot, and
// the reader's conclusion in each case is that the app is broken.
describe('a control offered twice is disabled in both places', () => {
    test('an unsaved design disables the pencil AND the sheet Rename row', () => {
        const { els, h } = harness();
        h.render({ designs: DESIGNS, activeId: null, design: { name: '' }, dirty: true, currentUser: ME, now: NOW });
        assert.equal(els.renameButtons[0].disabled, true, 'the pencil (always was)');
        assert.equal(els.renameMenuButton.disabled, true,
            'the sheet row too — it shipped live from v23.30, and pressing it closed the sheet and did nothing');
    });
    test('a saved design enables both', () => {
        const { els, h } = harness();
        h.render({ designs: DESIGNS, activeId: 'a', design: { name: 'Option A' }, dirty: false, currentUser: ME, now: NOW });
        assert.equal(els.renameButtons[0].disabled, false);
        assert.equal(els.renameMenuButton.disabled, false);
    });
});

describe('the picker always names the design that is actually OPEN', () => {
    // THE v23.33 DEFECT, AND WHY ITS TEST CHANGED SHAPE AT v23.35. A `<select>` HOLDS a value, and
    // `change` moved it the instant a reader picked — so when the coordinator then asked "discard
    // unsaved changes?" and they answered no, the picker was left naming a design nobody had
    // opened. The fix was to re-point the select on every render, and these two cases pinned it.
    //
    // The sheet holds no value at all: it reports an id, closes, and every visible thing — the
    // face, the ticked row — is rendered from `design`/`activeId`. So the assertion is no longer
    // "the control was put back" but "the control never left", which is the stronger property and
    // the reason the whole class is gone. Kept because a future picker that caches a selection
    // would reintroduce it, and this is where that would be caught.
    test('a render after a declined switch still names the OPEN design, not the picked one', () => {
        const { els, h } = harness();
        h.render({ designs: DESIGNS, activeId: 'a', design: { name: 'Option A' }, dirty: false, currentUser: ME, now: NOW });
        // The reader picked Proposal and the switch was declined: the coordinator re-renders with
        // the design that is still open, and nothing anywhere holds the id they touched.
        h.render({ designs: DESIGNS, activeId: 'a', design: { name: 'Option A' }, dirty: true, currentUser: ME, now: NOW });
        assert.equal(els.faceName.textContent, 'Option A', 'the face may never name a design nobody opened');
        const ticked = tickedRows(els.pickList);
        assert.equal(ticked.length, 1, 'exactly one row is ever marked current');
        assert.equal(ticked[0].dataset.id, 'a');
    });
    test('with an UNSAVED design open, the current row is the inert one — never a saved id', () => {
        const { els, h } = harness();
        h.render({ designs: DESIGNS, activeId: null, design: { name: '' }, dirty: true, currentUser: ME, now: NOW });
        const ticked = tickedRows(els.pickList);
        assert.equal(ticked.length, 1);
        assert.equal(ticked[0].dataset.id, undefined, 'an unsaved design has no id, so no saved row may wear the tick');
    });
});

describe('the source stays TEXT', () => {
    // v23.30 wrote the no-designer sentinel as a literal NUL byte. It worked — and made the file
    // BINARY to git, so the module landed showing `Bin 0 -> 17180 bytes` and every later change to
    // it would have shown no diff at all on a pull request. A module whose diffs cannot be read is
    // where a silent change lives.
    test('no control character is written literally into the module', async () => {
        const src = await (await import('node:fs/promises')).readFile('./links-design-header.js', 'utf8');
        const bad = [...src].filter(c => c.charCodeAt(0) < 9 || (c.charCodeAt(0) > 13 && c.charCodeAt(0) < 32));
        assert.deepEqual(bad, [], 'write it as an escape (\\u0000), never as the byte');
    });
    test('…and the sentinel still groups a design with no updatedBy under the not-recorded label', () => {
        assert.equal(groupDesigns([{ id: 'x', name: 'N' }], ME)[0].label, 'Last saver not recorded');
    });
});
