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
import { test, describe } from 'node:test';
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
        assert.deepEqual(g.map(x => x.label), ['Your designs', "M. Robson's designs", "S. Silva's designs"]);
        assert.equal(g[0].own, true);
        assert.equal(g[1].own, false);
    });
    test('inside a group the most recently saved design comes first', () => {
        const mine = groupDesigns(designs, ME)[0].designs.map(d => d.id);
        assert.deepEqual(mine, ['b', 'a']);
    });
    test('a design with no saver is still offered — under Other designs, last', () => {
        const g = groupDesigns([...designs, { id: 'x', name: 'Legacy', updatedAt: null }], ME);
        assert.equal(g.at(-1)?.label, 'Other designs');
        assert.equal(g.at(-1)?.designs[0].id, 'x');
        assert.equal(g.flatMap(x => x.designs).length, 5, 'nothing dropped');
    });
    test('a user with no designs of their own gets no empty "Your designs" group', () => {
        const g = groupDesigns(designs, 'Somebody Else');
        assert.ok(g.every(x => x.label !== 'Your designs'));
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
        listeners: /** @type {Record<string, Function[]>} */ ({}),
        addEventListener(/** @type {string} */ t, /** @type {Function} */ f) { (e.listeners[t] ||= []).push(f); },
        appendChild(/** @type {any} */ c) { e.children.push(c); return c; },
        rebuilds: 0,
    };
    Object.defineProperty(e, 'textContent', {
        get() { return e._text ?? ''; },
        set(v) { e._text = String(v); if (tag === 'select') { e.children = []; e.rebuilds += 1; } },
    });
    return e;
}

function harness() {
    const els = {
        select: el('select'), faceName: el(), eyebrow: el(), count: el(), masthead: el(),
        avatar: el(), whoName: el(), whoRole: el(), status: el(), statusLong: el(), statusShort: el(),
        saveButtons: [el('button'), el('button')], renameButtons: [el('button')], deleteButton: el('button'),
        sheetAvatar: el(), sheetName: el(), sheetSub: el(),
    };
    const calls = /** @type {string[]} */ ([]);
    globalThis.document = /** @type {any} */ ({ createElement: (/** @type {string} */ t) => el(t) });
    const h = createDesignHeader(/** @type {any} */ (els), { onSelect: id => calls.push(`select:${id}`), onRename: () => calls.push('rename') });
    return { els, h, calls };
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
        assert.equal(els.select.children[0]?.value, '', 'a placeholder option stands for the unsaved design');
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
    test('the select is grouped by designer and the active design is the selected option', () => {
        const { els, h } = harness();
        h.render({ designs: DESIGNS, activeId: 'c', design: { name: 'Proposal' }, dirty: false, currentUser: ME, now: NOW });
        assert.deepEqual(els.select.children.map((/** @type {any} */ g) => g.label), ['Your designs', "S. Silva's designs"]);
        assert.equal(els.select.value, 'c');
        const opt = els.select.children[1].children[0];
        assert.equal(opt.dataset.id, 'c');
        assert.match(opt.textContent, /^Proposal · 7 Sept$/);
    });
    test('RULE 4: a dirty flip does not rebuild the select; a new design does', () => {
        const { els, h } = harness();
        const base = { designs: DESIGNS, activeId: 'a', design: { name: 'Option A' }, currentUser: ME, now: NOW };
        h.render({ ...base, dirty: false });
        const after1 = els.select.rebuilds;
        h.render({ ...base, dirty: true });
        h.render({ ...base, dirty: true });
        assert.equal(els.select.rebuilds, after1, 'painting cells must not tear the option list down');
        h.render({ ...base, dirty: true, designs: [...DESIGNS, { id: 'z', name: 'New', updatedBy: ME, updatedAt: at(1) }] });
        assert.equal(els.select.rebuilds, after1 + 1);
    });
    test('a saving render freezes the button label rather than flipping it back to Save mid-write', () => {
        const { els, h } = harness();
        for (const b of els.saveButtons) b.textContent = 'Saving…';
        h.render({ designs: DESIGNS, activeId: 'a', design: { name: 'Option A' }, dirty: true, currentUser: ME, saving: true, now: NOW });
        for (const b of els.saveButtons) assert.equal(b.textContent, 'Saving…');
        assert.equal(els.status.className, 'dm-status dm-status--saving');
    });
    test('the wiring: choosing an option reports its id; the pencil reports a rename', () => {
        const { els, h, calls } = harness();
        h.render({ designs: DESIGNS, activeId: 'a', design: { name: 'Option A' }, dirty: false, currentUser: ME, now: NOW });
        els.select.value = 'c';
        for (const f of els.select.listeners.change) f();
        for (const f of els.renameButtons[0].listeners.click) f();
        assert.deepEqual(calls, ['select:c', 'rename']);
    });
});
