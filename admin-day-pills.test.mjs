// @ts-check
/**
 * admin-day-pills.test.mjs — which changes one week-grid day takes, at its pills.
 * Run: node scripts/run-tests.mjs admin-day-pills.test.mjs   (part of `npm run test:hygiene`)
 *
 * No mocks. A small fake row, drawn with the same pills (`PILL_TYPES`) and Other chips
 * (`OTHER_FLAVOURS` + Spare) the week grid draws, is handed to the REAL `restrictDayPills` and the
 * REAL row state (`_activateRow`, `prefillRow`, admin-week-row-state.js). The browser half — the row
 * as the page builds it, and a Sunday or Boxing Day Spare saved through it — is e2e/admin.spec.js.
 *
 * Organised by what a wrong answer costs:
 *   1. A CHANGE OFFERED THAT CANNOT BE SAVED, or saved where it must not be: leave, absence or a plain
 *      shift on a Sunday, an Other day on a Sunday or Boxing Day, anything before the start date.
 *   2. A CHANGE THE SAVES ALLOW, REFUSED AT THE PILL: Spare on a Sunday or Boxing Day (owner, Nov 2026)
 *      — the saves took one, and the grid's dead Other pill was the only route to it.
 *   3. A DISABLED CONTROL WITH NO REASON: the reason goes in each one's accessible name.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restrictDayPills } from './admin-day-pills.js';
import { _activateRow, prefillRow } from './admin-week-row-state.js';
import { PILL_TYPES, TYPES } from './admin-shift-types.js';
import { OTHER_FLAVOURS } from './override-utils.js';
import { CARD_TIPS } from './admin-tips.js';

// ── A fake row: flat children, and just enough of a selector engine for the row's own queries ─────
/** @param {string} sel @param {any} el @returns {boolean} */
function matches(sel, el) {
    for (const [, cls] of sel.matchAll(/\.([\w-]+)/g)) if (!el.classes.has(cls)) return false;
    for (const [, not, key, val] of sel.matchAll(/(:not\()?\[data-([\w-]+)="([^"]*)"\]/g)) {
        const has = el.dataset[key.replace(/-(\w)/g, (/** @type {string} */ _m, /** @type {string} */ c) => c.toUpperCase())] === val;
        if (not ? has : !has) return false;
    }
    return true;
}
/** @param {string[]} classes @param {Record<string, string>} [dataset] @param {string} [text] */
function el(classes, dataset = {}, text = '') {
    const node = {
        classes: new Set(classes), dataset: { ...dataset }, attrs: /** @type {Record<string, string>} */ ({}),
        disabled: false, checked: false, hidden: false, tabIndex: -1, value: '', textContent: text,
        classList: {
            add: (/** @type {string[]} */ ...c) => c.forEach(x => node.classes.add(x)),
            remove: (/** @type {string[]} */ ...c) => c.forEach(x => node.classes.delete(x)),
            toggle: (/** @type {string} */ c, /** @type {boolean|undefined} */ on) => ((on ?? !node.classes.has(c)) ? node.classes.add(c) : node.classes.delete(c)),
            contains: (/** @type {string} */ c) => node.classes.has(c),
        },
        setAttribute: (/** @type {string} */ k, /** @type {string} */ v) => { node.attrs[k] = v; },
        removeAttribute: (/** @type {string} */ k) => { delete node.attrs[k]; },
        getAttribute: (/** @type {string} */ k) => node.attrs[k] ?? null,
    };
    return node;
}
/** A day row with every pill and every Other chip on it, as `buildWeekGridInto` draws one. */
function drawRow() {
    const kids = [
        el(['day-cb']),
        ...PILL_TYPES.map(t => el(['type-pill-btn', `pill-${t}`], { type: t })),
        el(['other-opts']), el(['other-rdw-cb']), el(['day-start']), el(['day-end']), el(['col-al-swap']),
        ...Object.entries(OTHER_FLAVOURS).map(([k, f]) => el(['other-flavour-btn'], { flavour: k }, f.full)),
        el(['other-flavour-btn', 'other-flavour-spare'], { flavour: 'SPARE' }, '📋 Spare'),
    ];
    const row = el(['day-row'], { date: '2026-12-27' });
    Object.assign(row, {
        kids,
        querySelector: (/** @type {string} */ s) => kids.find(k => matches(s, k)) ?? null,
        querySelectorAll: (/** @type {string} */ s) => kids.filter(k => matches(s, k)),
    });
    return /** @type {any} */ (row);
}
const pill = (/** @type {any} */ row, /** @type {string} */ t) => row.querySelector(`.pill-${t}`);
const chips = (/** @type {any} */ row) => row.querySelectorAll('.other-flavour-btn');
const spare = (/** @type {any} */ row) => row.querySelector('.other-flavour-btn[data-flavour="SPARE"]');
const ordinary = { sunday: false, boxing: false, beforeStart: false };

describe('a Sunday: no leave, absence or plain shift, and Other offers Spare alone', () => {
    const row = drawRow();
    restrictDayPills(row, { ...ordinary, sunday: true });

    test('leave, absence and a plain shift are refused, each saying why (layer 1 of the Sunday rule)', () => {
        for (const t of ['annual_leave', 'sick', 'shift']) {
            assert.equal(pill(row, t).disabled, true, t);
            assert.match(pill(row, t).getAttribute('aria-label'), /Sunday/, t);
        }
    });

    test('RDW and Rest Day stay — Sunday work is overtime', () => {
        assert.equal(pill(row, 'rdw').disabled, false);
        assert.equal(pill(row, 'correction').disabled, false);
    });

    test('THE OTHER PILL STAYS ON, for Spare: every Other-family chip is off, and says why', () => {
        assert.equal(pill(row, 'other').disabled, false, 'the one route to a Spare must be open');
        assert.equal(pill(row, 'other').getAttribute('aria-label'), 'Other — only Spare on Sundays');
        assert.equal(spare(row).disabled, false);
        const family = chips(row).filter((/** @type {any} */ c) => c.dataset.flavour !== 'SPARE');
        assert.equal(family.length, Object.keys(OTHER_FLAVOURS).length, 'premise: every flavour drawn');
        for (const c of family) {
            assert.equal(c.disabled, true, c.dataset.flavour);
            assert.equal(c.getAttribute('aria-label'), `${c.textContent} — unavailable on Sundays`);
        }
        assert.equal(row.dataset.spareOnly, '1');
    });
});

describe('the words that say what a Sunday offers name what its row leaves on', () => {
    // The Change a Shift `?` tip and the Staff & Admin Guide each say it in a sentence, and both went on
    // saying "only RDW and Rest Day" after Spare joined them: nothing held the sentence to the row.
    const row = drawRow();
    restrictDayPills(row, { ...ordinary, sunday: true });
    const offered = [
        ...PILL_TYPES.filter(t => t !== 'other' && !pill(row, t).disabled).map(t => TYPES[t].pill),
        ...chips(row).filter((/** @type {any} */ c) => !c.disabled).map((/** @type {any} */ c) => c.textContent.replace(/^\P{L}+/u, '')),
    ];
    const refused = PILL_TYPES.filter(t => pill(row, t).disabled).map(t => TYPES[t].pill);
    const plain = (/** @type {string} */ html) => html.replace(/<[^>]+>/g, '').replace(/&mdash;/g, '—');
    const tipItem = CARD_TIPS['change-shift'].sections.flatMap(s => s.items).find(i => /Sunday<\/strong> offers only/.test(i.html));
    const guideBox = /<h2 id="sg-sundays">[^<]*<\/h2>\s*<div class="info">([\s\S]*?)<\/div>/
        .exec(readFileSync(new URL('./staff-guide.html', import.meta.url), 'utf8'));
    for (const [where, html] of /** @type {Array<[string, string|undefined]>} */ ([['the Change a Shift tip', tipItem?.html],
        ['the Staff & Admin Guide', guideBox?.[1]]])) {
        test(`${where}: "offers only" lists every choice the row leaves on, and none it turns off`, () => {
            assert.ok(html, `${where}: the sentence saying what a Sunday offers was not found`);
            assert.deepEqual(offered.sort(), ['RDW', 'Rest Day', 'Spare'], 'premise: what a Sunday row offers');
            // The list runs to the first full stop or dash: what follows it is what a Sunday refuses.
            const list = /offers only ([^.—]*)/.exec(plain(html))?.[1] ?? '';
            for (const word of offered) assert.match(list, new RegExp(`\\b${word}\\b`), `${where} leaves out ${word}`);
            for (const word of refused) assert.doesNotMatch(list, new RegExp(`\\b${word}\\b`), `${where} offers ${word}`);
        });
    }
});

describe('Boxing Day: every pill, and Other offers Spare alone', () => {
    const row = drawRow();
    restrictDayPills(row, { ...ordinary, boxing: true });

    test('leave, absence and shifts are not refused — the Sunday rule is not Boxing Day\'s', () => {
        for (const t of PILL_TYPES) assert.equal(pill(row, t).disabled, false, t);
    });

    test('Other is Spare alone, the chips saying it is Boxing Day', () => {
        assert.equal(pill(row, 'other').getAttribute('aria-label'), 'Other — only Spare on Boxing Day');
        assert.equal(spare(row).disabled, false);
        for (const c of chips(row).filter((/** @type {any} */ c) => c.dataset.flavour !== 'SPARE')) {
            assert.equal(c.disabled, true, c.dataset.flavour);
            assert.match(c.getAttribute('aria-label'), /unavailable on Boxing Day$/);
        }
    });
});

describe('before the start date: nothing at all', () => {
    test('every pill is off and says so — a Sunday before the start date too', () => {
        for (const sunday of [false, true]) {
            const row = drawRow();
            restrictDayPills(row, { sunday, boxing: false, beforeStart: true });
            for (const t of PILL_TYPES) {
                assert.equal(pill(row, t).disabled, true, t);
                assert.match(pill(row, t).getAttribute('aria-label'), /before the start date$/, t);
            }
        }
    });
});

describe('an ordinary day', () => {
    test('nothing is refused, and Other offers every chip', () => {
        const row = drawRow();
        restrictDayPills(row, ordinary);
        for (const t of PILL_TYPES) assert.equal(pill(row, t).disabled, false, t);
        for (const c of chips(row)) assert.equal(c.disabled, false, c.dataset.flavour);
        assert.equal(row.dataset.spareOnly, undefined);
    });
});

describe('choosing Other where Spare is the only choice (admin-week-row-state.js)', () => {
    const activate = (/** @type {any} */ row) => _activateRow(row, row.querySelector('.day-cb'), row.querySelectorAll('.type-pill-btn'),
        row.querySelector('.day-start'), row.querySelector('.day-end'), 'other');

    test('Spare is pressed at once, and the row is in Spare mode — no times, no RDW tick', () => {
        const row = drawRow();
        restrictDayPills(row, { ...ordinary, sunday: true });
        activate(row);
        assert.equal(spare(row).classList.contains('active'), true);
        assert.equal(spare(row).getAttribute('aria-pressed'), 'true');
        assert.equal(row.classList.contains('other-spare'), true);
    });

    test('CONTROL: on an ordinary day nothing is pressed for the manager — they choose', () => {
        const row = drawRow();
        restrictDayPills(row, ordinary);
        activate(row);
        assert.equal(row.querySelectorAll('.other-flavour-btn.active').length, 0);
        assert.equal(row.classList.contains('other-spare'), false);
    });

    test('a saved Spare on a Sunday is drawn as Other → Spare', () => {
        const row = drawRow();
        restrictDayPills(row, { ...ordinary, sunday: true });
        prefillRow(row, { id: 'x', type: 'spare_shift', value: 'SPARE' });
        assert.equal(pill(row, 'other').classList.contains('active'), true);
        assert.equal(spare(row).classList.contains('active'), true);
        assert.equal(row.classList.contains('other-spare'), true);
    });

    test('an older Other day saved on a Sunday is drawn as itself, not as a Spare', () => {
        // Activating Other there presses Spare first; the record's own flavour must replace it.
        const row = drawRow();
        restrictDayPills(row, { ...ordinary, sunday: true });
        prefillRow(row, { id: 'x', type: 'other', value: 'TRG' });
        assert.equal(row.querySelector('.other-flavour-btn[data-flavour="TRG"]').classList.contains('active'), true);
        assert.equal(spare(row).classList.contains('active'), false);
        assert.equal(row.classList.contains('other-spare'), false, 'its times and RDW tick are not hidden as a Spare\'s are');
    });
});

test('the week grid asks this module about every row, with the day\'s three facts', () => {
    // The wiring, not the rule: the grid's own fake DOM cannot see a disabled pill, so this reads the call.
    const src = readFileSync(new URL('./admin-week-editor.js', import.meta.url), 'utf8');
    assert.match(src, /restrictDayPills\(row, \{ sunday: isSunday\(dateISO\), boxing, beforeStart \}\);/);
    assert.match(src, /boxing = isBoxingDay\(dateISO\) && !isSunday\(dateISO\)/);
});
