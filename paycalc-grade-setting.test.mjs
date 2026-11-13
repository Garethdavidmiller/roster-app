/**
 * paycalc-grade-setting.test.mjs — the grade setting LOADED and SAVED through its real entry points.
 * Run: node --experimental-test-module-mocks scripts/run-tests.mjs paycalc-grade-setting.test.mjs
 *
 * `loadGradeSetting` is where a device's saved grade meets the dated roster for the first time, and
 * it runs once: a wrong conversion is not re-asked, it is simply what every payslip is priced with
 * from then on. So it is driven here end to end — the real module, the real period table, the real
 * roster rows — against a stand-in page that records what was painted, by what a wrong answer
 * costs: a promoted member left on one grade for every payslip (the defect this release ends), or a
 * grade somebody chose by hand silently replaced by the roster's (the 10 Nov 2026 rule).
 */
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const _ls = new Map();
/** @type {{ name: string }|null} */
let _session = null;

mock.module('./firebase-client.js', {
    namedExports: {
        auth: {}, authReady: Promise.resolve(), onAuthStateChanged: () => () => {},
        signInWithEmailAndPassword: async () => {}, createUserWithEmailAndPassword: async () => {},
        signInAnonymously: async () => {}, signOut: async () => {}, db: null,
        collection: () => {}, query: () => {}, where: () => {},
        getDocs: async () => ({ forEach: () => {}, docs: [] }),
        COLLECTIONS: { overrides: 'overrides', clientErrors: 'clientErrors' },
        nameToEmail: (/** @type {string} */ n) => n + '@test', normaliseSurname: (/** @type {string} */ n) => n,
    },
});
mock.module('./session.js', {
    namedExports: {
        AUTH_KEY: 'myb_admin_session', SESSION_MS: 1,
        getSession: () => _session, saveSession: () => {}, clearSession: async () => {},
        ensureFirebaseSession: async () => {}, sessionReady: Promise.resolve(), resolveSession: () => {},
    },
});
mock.module('./ls.js', {
    namedExports: {
        lsGet: (/** @type {string} */ k) => (_ls.has(k) ? _ls.get(k) : null),
        lsSet: (/** @type {string} */ k, /** @type {any} */ v) => { _ls.set(k, String(v)); },
        lsDel: (/** @type {string} */ k) => { _ls.delete(k); }, lsKeys: () => [..._ls.keys()],
        lsSetVerified: (/** @type {string} */ k, /** @type {any} */ v) => { _ls.set(k, String(v)); return true; },
        lsMove: () => false,
    },
});
const _realRosterData = await import('./roster-data.js?real');
const { teamMembers } = await import('./roster-member-data.js');
mock.module('./roster-data.js', {
    namedExports: {
        teamMembers, APP_VERSION: '13.00',
        CONFIG: { ADMIN_NAMES: [], LINKS_DESIGNERS: [], MAX_YEAR: 2027, MIN_YEAR: 2025 },
        formatISO: _realRosterData.formatISO,
        parseSmartFloat: (/** @type {any} */ v) => parseFloat(String(v)),
        parseSmartFloatOrNull: _realRosterData.parseSmartFloatOrNull,
        gradeForRole: _realRosterData.gradeForRole,
    },
});
mock.module('./paycalc-roster-suggestions.js', {
    namedExports: { bhsForYear: () => [], getRosterSuggestion: async () => ({}), fetchOverridesForPeriod: async () => {} },
});

const { SK } = await import('./paycalc-migrations.js');
const P = await import('./paycalc-periods.js');
const G = await import('./paycalc-grade-setting.js');

// ── A stand-in page: just what the grade controls touch, recording what they paint ───────────────
const classes = () => {
    const s = new Set();
    return {
        add: (/** @type {string} */ x) => s.add(x), remove: (/** @type {string} */ x) => s.delete(x),
        contains: (/** @type {string} */ x) => s.has(x),
        toggle(/** @type {string} */ x, /** @type {boolean} [on] */ on) { (on === undefined ? !s.has(x) : on) ? s.add(x) : s.delete(x); return s.has(x); },
    };
};
/** @type {string|null} */ let focused = null;
const fakeEl = (/** @type {string} */ id) => {
    /** @type {any} */ const el = {
        id, hidden: false, dataset: {}, textContent: '', classList: classes(), style: {},
        /** @type {Record<string, Function[]>} */ listeners: {},
        addEventListener(/** @type {string} */ t, /** @type {Function} */ f) { (this.listeners[t] ||= []).push(f); },
        click() { for (const f of this.listeners.click || []) f({ target: this }); },
        focus() { focused = this.id; },
        appendChild(/** @type {any} */ c) { this.textContent += c.textContent ?? c.data ?? ''; return c; },
    };
    el.ownerDocument = { createElement: () => ({ setAttribute() {}, textContent: '' }), createTextNode: (/** @type {string} */ d) => ({ data: d }) };
    return el;
};
const fakeOption = (/** @type {string} */ value = '', /** @type {string} */ text = '') => ({ tagName: 'OPTION', value, textContent: text });
const fakeOptgroup = () => ({ tagName: 'OPTGROUP', label: '', /** @type {any[]} */ children: [],
    appendChild(/** @type {any} */ c) { this.children.push(c); return c; } });
const fakeSelect = (/** @type {string} */ id) => {
    /** @type {any} */ const sel = {
        id, tagName: 'SELECT', /** @type {any[]} */ children: [], _chosen: /** @type {any} */ (null), _cleared: false,
        get options() { return this.children.flatMap((/** @type {any} */ c) => c.tagName === 'OPTGROUP' ? c.children : [c]); },
        get selectedIndex() {
            const opts = this.options;
            if (this._chosen && opts.includes(this._chosen)) return opts.indexOf(this._chosen);
            return this._cleared || !opts.length ? -1 : 0;
        },
        get value() { const i = this.selectedIndex; return i === -1 ? '' : this.options[i].value; },
        set value(v) { this._chosen = this.options.find((/** @type {any} */ o) => o.value === String(v)) ?? null; this._cleared = !this._chosen; },
        set innerHTML(_v) { this.children = []; this._chosen = null; this._cleared = false; },
        get innerHTML() { return ''; },
        appendChild(/** @type {any} */ c) { this.children.push(c); this._cleared = false; return c; },
        insertBefore(/** @type {any} */ c, /** @type {any} */ ref) {
            const nodes = c.nodeType === 11 ? c.children.splice(0) : [c];
            const i = ref ? this.children.indexOf(ref) : -1;
            if (i === -1) this.children.push(...nodes); else this.children.splice(i, 0, ...nodes);
            this._cleared = false;
            return c;
        },
        querySelector: (/** @type {string} */ q) => (q === 'optgroup' ? (sel.children.find((/** @type {any} */ c) => c.tagName === 'OPTGROUP') ?? null) : null),
    };
    return sel;
};
/** @type {Record<string, any>} */ let page = {};
/** A fresh page, as a reload gives: the Grade box with its three choices, everything else blank. */
function openPage() {
    page = {};
    focused = null;
    /** @type {any} */ (globalThis).document = {
        getElementById: (/** @type {string} */ id) => (page[id] ??= fakeEl(id)),
        createElement: (/** @type {string} */ tag) => (tag === 'optgroup' ? fakeOptgroup() : fakeOption()),
        createDocumentFragment: () => ({ nodeType: 11, /** @type {any[]} */ children: [],
            appendChild(/** @type {any} */ c) { this.children.push(c); return c; } }),
    };
    page.gradeSelect = fakeSelect('gradeSelect');
    for (const v of ['roster', 'cea', 'ces']) page.gradeSelect.appendChild(fakeOption(v, v));
    page.gradeFrom = fakeSelect('gradeFrom');
    page.periodSelect = { value: '' };              // the payslip selector is not built yet
    for (const id of ['gradePrompt', 'gradeNote']) page[id] = Object.assign(fakeEl(id), { hidden: true });
    for (const id of ['gradePromptDone', 'gradeNoteDone']) page[id] = Object.assign(fakeEl(id), { hidden: true });
}
/** Open the calculator as `name` on `today`, with `stored` already on this device. */
function load(/** @type {string} */ name, /** @type {Record<string, string>} */ stored, /** @type {any} */ t, /** @type {Date} */ today) {
    t.mock.timers.enable({ apis: ['Date'], now: today });
    _ls.clear();
    for (const [k, v] of Object.entries(stored)) _ls.set(/** @type {any} */ (SK)[k], v);
    _session = { name };
    P.setEarliestVisiblePeriod(teamMembers.find(m => m.name === name));
    openPage();
    G.loadGradeSetting();
}
const PROMOTED = 'K. Jedlinski';
const STEADY_CES = 'F. Mohamed';
const NOV_13 = new Date(2026, 10, 13, 10);

afterEach(() => { P.setEarliestVisiblePeriod(null); _session = null; });

describe('a grade saved before grades had dates is converted once, on load', () => {
    test('the promoted row: a saved CEA is one the roster gives, so the roster takes over, dates and all', (t) => {
        load(PROMOTED, { grade: 'cea' }, t, NOV_13);
        assert.equal(_ls.get(SK.grade), 'roster');
        assert.equal(_ls.has(SK.gradeFrom), false);
        assert.deepEqual(G.getGradeSetting(), { grade: 'roster', from: 0 });
        assert.equal(page.gradeSelect.value, 'roster');
        assert.equal(page.gradeFromField.classList.contains('hidden'), true, 'the roster needs no "from which payslip?"');
        assert.equal(page.gradeRosterLine.textContent, 'The roster lists you as CEA until 21 Nov 2026, then CES from 22 Nov 2026.');
        assert.equal(page.gradeRosterLine.hidden, false);
        assert.equal(page.gradePrompt.hidden, true, 'with the roster deciding there is nothing to ask');
    });

    test('a grade the member KEPT over the roster\'s stays theirs, from the first payslip they can see', (t) => {
        load(PROMOTED, { grade: 'cea', gradeKept: 'ces' }, t, NOV_13);
        const first = String(P.visiblePeriods()[0].num);
        assert.equal(_ls.get(SK.grade), 'cea');
        assert.equal(_ls.get(SK.gradeFrom), first);
        assert.equal(page.gradeSelect.value, 'cea');
        assert.equal(page.gradeFromField.classList.contains('hidden'), false);
        assert.equal(page.gradeFrom.value, first, 'the payslip on record, shown');
    });

    test('a grade the roster never gives the member stays, and is asked about as it always was', (t) => {
        load(STEADY_CES, { grade: 'cea' }, t, NOV_13);
        assert.equal(_ls.get(SK.grade), 'cea');
        assert.equal(_ls.get(SK.gradeFrom), String(P.visiblePeriods()[0].num));
        assert.equal(page.gradeRosterLine.textContent, 'The roster lists you as CES.');
        assert.equal(page.gradePrompt.hidden, false);
        assert.equal(page.gradePromptText.textContent,
            'The roster lists you as CES (Customer Experience Supervisor), but this calculator is using CEA rates.');
    });

    test('nothing saved is the roster\'s, and is written down as the roster', (t) => {
        load(STEADY_CES, {}, t, NOV_13);
        assert.equal(_ls.get(SK.grade), 'roster');
        assert.equal(page.gradeSelect.value, 'roster');
        assert.equal(page.gradePrompt.hidden, true);
    });

    test('a setting already in the new shape is never converted again', (t) => {
        load(PROMOTED, { grade: 'ces', gradeFrom: '60' }, t, NOV_13);
        assert.equal(_ls.get(SK.grade), 'ces');
        assert.equal(_ls.get(SK.gradeFrom), '60');
        assert.deepEqual(G.getGradeSetting(), { grade: 'ces', from: 60 });
        assert.equal(page.gradeFrom.value, '60');
    });
});

describe('the one-time note: a change of grade on the roster needs nothing doing', () => {
    test('it is said once, with the day, and OK remembers it on this device', (t) => {
        load(PROMOTED, { grade: 'roster' }, t, NOV_13);
        assert.equal(page.gradeNote.hidden, false);
        assert.equal(page.gradeNoteText.textContent,
            'Your grade on the roster changes from CEA to CES on Sun 22 Nov 2026. Each payslip is priced at the '
            + 'grade you held while you worked it, so there is nothing for you to change.');
        page.gradeNoteOk.click();
        assert.equal(_ls.get(SK.gradeNote), '2026-11-22');
        assert.equal(page.gradeNoteDone.hidden, false);
        assert.equal(page.gradeNoteDone.textContent, "✓ Your grade's dates are in Your Settings, under Grade.");
        assert.equal(focused, 'gradeNoteDone', 'the button pressed is gone, so focus goes to what happened');
        assert.equal(page.gradeNoteText.hidden, true);

        openPage();
        G.loadGradeSetting();
        assert.equal(page.gradeNote.hidden, true, 'said once: a reload does not say it again');
    });

    test('after the day it says the grade changed', (t) => {
        load(PROMOTED, { grade: 'roster' }, t, new Date(2026, 11, 20, 10));
        assert.match(page.gradeNoteText.textContent, /^Your grade on the roster changed from CEA to CES on Sun 22 Nov 2026\./);
    });

    test('a grade chosen by hand is the grade prompt\'s business, not the note\'s', (t) => {
        load(PROMOTED, { grade: 'cea', gradeFrom: '50' }, t, NOV_13);
        assert.equal(page.gradeNote.hidden, true);
    });

    test('nothing is said to a member whose grade never changed', (t) => {
        load(STEADY_CES, { grade: 'roster' }, t, NOV_13);
        assert.equal(page.gradeNote.hidden, true);
    });

    test('nothing is said to a member the page does not price — the manager row, refused before anything', (t) => {
        load('W. Cummings', { grade: 'roster' }, t, NOV_13);
        assert.equal(page.gradeNote.hidden, true);
    });
});

describe('saving the setting from the Grade box', () => {
    beforeEach(() => { _session = { name: STEADY_CES }; });

    test('a grade chosen by hand is stored with the payslip it starts from', (t) => {
        load(STEADY_CES, { grade: 'roster' }, t, NOV_13);
        page.gradeSelect.value = 'cea';
        page.gradeFrom.value = '58';
        G.saveGradeSetting(58);
        assert.equal(_ls.get(SK.grade), 'cea');
        assert.equal(_ls.get(SK.gradeFrom), '58');
        assert.deepEqual(G.getGradeSetting(), { grade: 'cea', from: 58 }, 'the cache follows the save');
        assert.equal(page.gradeFromField.classList.contains('hidden'), false);
    });

    test('From the roster forgets the payslip a chosen grade started from', (t) => {
        load(STEADY_CES, { grade: 'cea', gradeFrom: '58' }, t, NOV_13);
        page.gradeSelect.value = 'roster';
        G.saveGradeSetting(58);
        assert.equal(_ls.get(SK.grade), 'roster');
        assert.equal(_ls.has(SK.gradeFrom), false);
        assert.equal(page.gradeFromField.classList.contains('hidden'), true);
    });

    test('a "from which payslip?" with nothing chosen never overwrites the record (paycalc-3-8)', (t) => {
        load(STEADY_CES, { grade: 'cea', gradeFrom: '55' }, t, NOV_13);
        page.gradeFrom.value = '999';              // no option carries it: the select shows nothing
        assert.equal(page.gradeFrom.selectedIndex, -1, 'premise: nothing chosen');
        G.saveGradeSetting(58);
        assert.equal(_ls.get(SK.gradeFrom), '55');
    });

    test('a grade chosen while the payslip box holds nothing starts at the payslip on screen, never the first', (t) => {
        // The box is built with the payslip on screen chosen, so this is the fallback for one that
        // holds nothing. Stored with no payslip at all, the grade would read as chosen from the very
        // first one — and re-price every payslip the member has had, which is what dated grades stop.
        load(STEADY_CES, { grade: 'roster' }, t, NOV_13);
        page.gradeSelect.value = 'cea';
        page.gradeFrom.value = '999';              // no option carries it: the select shows nothing
        assert.equal(page.gradeFrom.selectedIndex, -1, 'premise: nothing chosen');
        G.saveGradeSetting(58);
        assert.equal(_ls.get(SK.gradeFrom), '58');
        assert.deepEqual(G.getGradeSetting(), { grade: 'cea', from: 58 });
    });

    test('a save may hide the grade prompt, never raise it', (t) => {
        load(STEADY_CES, { grade: 'roster' }, t, NOV_13);
        assert.equal(page.gradePrompt.hidden, true);
        page.gradeSelect.value = 'cea';           // disagrees with the roster's CES …
        G.saveGradeSetting(58);
        assert.equal(page.gradePrompt.hidden, true, '… but the member has just answered the question themselves');
    });
});
