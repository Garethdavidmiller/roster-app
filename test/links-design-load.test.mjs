/**
 * links-design-load.test.mjs — what a read of the design collection MEANS (links-design-load.js).
 * Run: node scripts/run-tests.mjs test/links-design-load.test.mjs   (part of `npm run test:hygiene`)
 *
 * The module exists so that the page load and the list refresh read the collection by ONE rule and
 * keep the list in ONE order. So the suite pins the rules — including the two readers side by side,
 * through the sequences that went wrong before — and then, as christmas-leave.test.mjs does for its
 * own rule, that the coordinator keeps no second copy: no comparator of its own, and no split of the
 * documents beside the one it imports.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    splitDesignDocs, binOldOnLoad, binOldOnRefresh, readCannotAnswer, migratesLegacy, byDesignName, designToOpen, emptyStateFor,
} from '../links-design-load.js';
import { LEGACY_DOC_ID, LINK_26_FROM, PREVIOUS_LINK_LENGTH } from '../links-design-doc.js';
import { ROTATING_LINES } from '../links-design.js';

// Tests live in test/ but address files from the repository root (moved 24 Nov 2026).
const REPO_ROOT_URL = new URL('../', import.meta.url);

const ts = (/** @type {number} */ ms) => ({ toMillis: () => ms });
const BEFORE = LINK_26_FROM - 86_400_000, AFTER = LINK_26_FROM + 1;
/** n drawn lines, each worked Monday to Thursday. @param {number} n */
const lines = (n) => Object.fromEntries(Array.from({ length: n },
    (_, i) => [String(i + 1), { sun: 'RD', mon: '06:20-14:20', tue: '06:20-14:20', wed: '06:20-14:20', thu: '06:20-14:20', fri: 'RD', sat: 'RD' }]));

const ME = 'Designer A';
const LIVE   = { id: 'live', data: { name: 'Live one', patterns: lines(ROTATING_LINES), updatedAt: ts(AFTER), updatedBy: 'Designer B', revision: 3 } };
const BINNED = { id: 'gone', data: { name: 'Binned one', patterns: lines(ROTATING_LINES), deletedAt: ts(AFTER), deletedBy: 'Designer B' } };
/** Drawn for the old link length and last saved before the release: `isPre26Design`. */
const OLD    = { id: 'old',  data: { name: 'Old length', patterns: lines(PREVIOUS_LINK_LENGTH), updatedAt: ts(BEFORE), updatedBy: 'Designer B' } };
const LEGACY = { id: LEGACY_DOC_ID, data: { patterns: lines(PREVIOUS_LINK_LENGTH), updatedBy: 'Designer B' } };

const ids = (/** @type {Array<{id: string}>} */ xs) => xs.map(x => x.id);
const any = () => true;

describe('splitDesignDocs — one rule for both readers', () => {
    test('a live design is listed, a binned one is in the bin under whoever deleted it, and both keep their shape', () => {
        const s = splitDesignDocs([LIVE, BINNED], { binOld: any, currentUser: ME });
        assert.deepEqual(ids(s.named), ['live']);
        assert.equal(s.named[0].revision, 3, 'the concurrency identity comes with it (links-design-doc.js)');
        assert.ok(s.named[0].window, 'every shape carries its window');
        assert.deepEqual(s.binned.map((/** @type {any} */ b) => [b.id, b.deletedBy]), [['gone', 'Designer B']]);
        assert.ok(s.binned[0].patterns['1'], 'a binned design keeps its patterns, so a restore is a merge');
        assert.equal(s.legacyData, null);
        assert.deepEqual(s.toBin, []);
    });

    test('a delete still settling (deletedAt not yet resolved) is in the bin, not the list', () => {
        const s = splitDesignDocs([{ id: 'x', data: { name: 'Just binned', patterns: {}, deletedAt: null, deletedBy: ME } }], { binOld: any, currentUser: ME });
        assert.deepEqual(ids(s.binned), ['x']);
        assert.deepEqual(s.named, []);
    });

    test('an old-length design goes to the bin as the reader\'s own move, and is listed for that move', () => {
        const s = splitDesignDocs([OLD, LIVE], { binOld: any, currentUser: ME });
        assert.deepEqual(ids(s.named), ['live']);
        assert.deepEqual(s.binned.map((/** @type {any} */ b) => [b.id, b.deletedBy, b.deletedAt]), [['old', ME, null]]);
        assert.deepEqual(s.toBin, ['old']);
    });

    test('…and stays in the list wherever the reader may not show it in the bin', () => {
        const s = splitDesignDocs([OLD], { binOld: () => false, currentUser: ME });
        assert.deepEqual(ids(s.named), ['old']);
        assert.deepEqual(s.binned, []);
        assert.deepEqual(s.toBin, []);
    });

    test('the legacy grid is held aside and never listed; a nameless document is neither', () => {
        const s = splitDesignDocs([
            LEGACY,
            { id: 'nameless', data: { patterns: lines(1) } },
            { id: 'blank-name', data: { name: '   ', patterns: lines(1) } },
        ], { binOld: any, currentUser: ME });
        assert.equal(s.legacyData, LEGACY.data);
        assert.deepEqual([s.named, s.binned, s.toBin], [[], [], []]);
        const empty = splitDesignDocs([{ id: LEGACY_DOC_ID, data: {} }], { binOld: any, currentUser: ME });
        assert.equal(empty.legacyData, null, 'a legacy document with no grid has nothing to migrate');
    });
});

describe('which old-length designs a read may show in the bin', () => {
    test('the load: every one on a server answer, except a move that has already failed', () => {
        const binOld = binOldOnLoad(false, new Set(['failed']));
        assert.equal(binOld('old'), true);
        assert.equal(binOld('failed'), false, 'a failed move left it live on the server, so it is shown live');
    });

    test('…and none on a cached answer, which moves nothing and so may claim nothing moved', () => {
        assert.equal(binOldOnLoad(true, new Set())('old'), false);
    });

    test('the refresh: only a move this page started', () => {
        const binOld = binOldOnRefresh(new Set(['moving']));
        assert.equal(binOld('moving'), true);
        assert.equal(binOld('old'), false, 'a refresh starts no move, so it may claim none');
    });

    test('the two readers in sequence agree about every design', () => {
        const docs = [LIVE, OLD];   // the split keeps document order; the load sorts afterwards
        // An offline load moves nothing, and a refresh after it must not claim a move either (whole-app fix,
        // Nov 2026: it showed the old design in the bin, and restoring it blamed someone else).
        const offline = splitDesignDocs(docs, { binOld: binOldOnLoad(true, new Set()), currentUser: ME });
        assert.deepEqual([ids(offline.named), offline.toBin], [['live', 'old'], []]);
        const after = splitDesignDocs(docs, { binOld: binOldOnRefresh(new Set()), currentUser: ME });
        assert.deepEqual(ids(after.named), ['live', 'old']);
        // A server load shows it in the bin and starts its move; a refresh while the move is out agrees.
        const online = splitDesignDocs(docs, { binOld: binOldOnLoad(false, new Set()), currentUser: ME });
        assert.deepEqual([ids(online.binned), online.toBin], [['old'], ['old']]);
        const during = splitDesignDocs(docs, { binOld: binOldOnRefresh(new Set(['old'])), currentUser: ME });
        assert.deepEqual(ids(during.binned), ['old']);
        // The move fails: it is no longer started, it is failed — and both readers show it live again.
        const failed = new Set(['old']), started = new Set();
        assert.deepEqual(ids(splitDesignDocs(docs, { binOld: binOldOnRefresh(started), currentUser: ME }).named), ['live', 'old']);
        assert.deepEqual(ids(splitDesignDocs(docs, { binOld: binOldOnLoad(false, failed), currentUser: ME }).named), ['live', 'old']);
    });
});

describe('whether a read can answer, and the legacy migration', () => {
    test('a cached answer with no live design cannot tell "none" from "never read", so the load fails', () => {
        assert.equal(readCannotAnswer(true, { named: [] }), true);
        assert.equal(readCannotAnswer(true, { named: [LIVE] }), false, 'a cached answer that holds designs is shown — stale, but real');
        assert.equal(readCannotAnswer(false, { named: [] }), false, 'the server\'s word that there are none is an answer');
    });

    test('the legacy grid migrates only into a collection that has never held a design, live or binned', () => {
        assert.equal(migratesLegacy({ named: [], binned: [], legacyData: LEGACY.data }), true);
        assert.equal(migratesLegacy({ named: [LIVE], binned: [], legacyData: LEGACY.data }), false);
        assert.equal(migratesLegacy({ named: [], binned: [BINNED], legacyData: LEGACY.data }), false);
        assert.equal(migratesLegacy({ named: [], binned: [], legacyData: null }), false);
    });

    test('…so binning every old-length design does not bring "Design 1" back (Oct 2026)', () => {
        const s = splitDesignDocs([LEGACY, OLD], { binOld: binOldOnLoad(false, new Set()), currentUser: ME });
        assert.deepEqual(s.named, [], 'no live design is left');
        assert.equal(migratesLegacy(s), false, 'and the collection has still held one');
    });
});

describe('the list order, and which design opens', () => {
    test('one order, by name as a reader sorts it — a capital letter does not jump the queue', () => {
        // Character codes would put every capital first: Alpha, Charlie, alpha two, beta.
        const names = ['beta', 'Alpha', 'Charlie', 'alpha two'].map(name => ({ name })).sort(byDesignName).map(d => d.name);
        assert.deepEqual(names, ['Alpha', 'alpha two', 'beta', 'Charlie']);
    });

    test('the design open last visit reopens — a saved one or a proposal — else the first saved one', () => {
        const saved = [{ id: 'a' }, { id: 'b' }], proposals = [{ id: 'proposal-x' }];
        assert.equal(designToOpen(saved, proposals, 'b')?.id, 'b');
        assert.equal(designToOpen(saved, proposals, 'proposal-x')?.id, 'proposal-x');
        assert.equal(designToOpen(saved, proposals, 'deleted-since')?.id, 'a');
        assert.equal(designToOpen(saved, proposals, null)?.id, 'a');
    });

    test('nothing saved and nothing remembered opens NOTHING — the shortlist is offered, never chosen for you', () => {
        const proposals = [{ id: 'proposal-x' }];
        assert.equal(designToOpen([], proposals, null), null);
        assert.equal(designToOpen([], proposals, 'deleted-since'), null);
        assert.equal(designToOpen([], proposals, 'proposal-x')?.id, 'proposal-x', 'a proposal open last time reopens');
    });
});

describe('the empty grid card: what it says, and which states may offer to make a design', () => {
    const LOADING = { title: 'Loading your designs…', msg: 'One moment.' };
    const read = (/** @type {Record<string, any>} */ o = {}) =>
        emptyStateFor({ listLoading: false, loadFailed: false, binnedOnLoad: 0, binSize: 0, loading: LOADING, ...o });

    test('LOADING says the markup\'s own words and offers nothing — a design made now would be replaced', () => {
        const e = read({ listLoading: true, loadFailed: true, binnedOnLoad: 2, binSize: 2 });
        assert.equal(e.state, 'loading', 'loading outranks every other state');
        assert.equal(e.title, LOADING.title);
        assert.equal(e.msg, LOADING.msg);
        assert.equal(e.offers, false);
        assert.equal(e.retry, false);
    });

    test('a FAILURE is never "No designs yet": no offer to make one, and Try again', () => {
        const e = read({ loadFailed: true, binnedOnLoad: 1, binSize: 1 });
        assert.equal(e.state, 'failed');
        assert.equal(e.title, 'Couldn’t load your designs');
        assert.match(e.msg, /Nothing has been lost/);
        assert.equal(e.offers, false);
        assert.equal(e.retry, true, 'an installed app has no reload button');
    });

    test('old-length designs moved this load: says where they went, counted, and offers', () => {
        const one = read({ binnedOnLoad: 1, binSize: 3 });
        assert.equal(one.state, 'binned');
        assert.equal(one.title, `Your ${PREVIOUS_LINK_LENGTH}-line designs are in Recently deleted`);
        assert.match(one.msg, new RegExp(`now ${ROTATING_LINES} lines, so the design drawn for ${PREVIOUS_LINK_LENGTH} moved there`));
        assert.match(read({ binnedOnLoad: 2, binSize: 2 }).msg, /so the 2 designs drawn for/);
        assert.equal(one.offers, true);
        assert.equal(one.retry, false);
        // a bin since emptied (restored or removed for good) is not where they are any more
        assert.equal(read({ binnedOnLoad: 2, binSize: 0 }).state, 'empty');
    });

    test('nothing saved: "No designs yet", the rotation\'s length stated, and the offers', () => {
        const e = read();
        assert.equal(e.state, 'empty');
        assert.equal(e.title, 'No designs yet');
        assert.ok(e.msg.includes(`${ROTATING_LINES}-line</span> grid`));
        assert.equal(e.offers, true);
        assert.equal(e.retry, false);
    });
});

describe('the coordinator keeps no second copy', () => {
    // Static, as christmas-leave.test.mjs's "no module but al-entitlement.js" is: the failure is a page that loads, lists
    // and sorts plausibly, and disagrees with itself only on the paths a second copy took. Comments are stripped first.
    const src = readFileSync(new URL('./links-app.js', REPO_ROOT_URL), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    /** One function of init(), up to the next declaration at its depth. @param {string} name */
    const body = (name) => {
        const at = src.search(new RegExp(`\\n {4}(?:async )?function ${name}\\(`));
        assert.ok(at >= 0, `links-app.js no longer has ${name} — update this guard to the reader that replaced it`);
        const next = src.slice(at + 1).search(/\n {4}(?:async )?function /);
        return src.slice(at, next < 0 ? undefined : at + 1 + next);
    };

    test('both readers split the collection through splitDesignDocs, each with its own bin rule', () => {
        assert.ok(/splitDesignDocs\([\s\S]*binOldOnLoad\(/.test(body('loadDesigns')),
            'loadDesigns must split its read with splitDesignDocs and binOldOnLoad (links-design-load.js)');
        assert.ok(/splitDesignDocs\([\s\S]*binOldOnRefresh\(/.test(body('_refreshLists')),
            '_refreshLists must split its read with splitDesignDocs and binOldOnRefresh (links-design-load.js)');
    });

    test('no comparator, and no split of the documents, written in the coordinator', () => {
        /** The coordinator's lines that match — named, so a failure points at them. @param {RegExp} re */
        const lines = (re) => src.split('\n').filter(l => re.test(l)).map(l => l.trim());
        assert.deepEqual(lines(/localeCompare\(/), [], 'sort designs with byDesignName (links-design-load.js)');
        assert.deepEqual(lines(/\bisDeleted\(|\bLEGACY_DOC_ID\b/), [], 'split a read with splitDesignDocs (links-design-load.js)');
    });
});
