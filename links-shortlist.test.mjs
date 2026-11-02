/**
 * links-shortlist.test.mjs — making the shortlist the saved designs (v25.09).
 *
 * Run: node --test links-shortlist.test.mjs   (part of `npm run test:hygiene`)
 *
 * Three layers, because each can be right while the next is wrong: the RULES (`links-shortlist.js`
 * — what one press saves and moves, and when the built-in rows go), the TRANSACTION
 * (`links-design-store.js` `saveShortlist`, driven against a fake that has more than one document
 * and refuses a read after a write, as Firestore does), and the WIRING in the coordinator, which
 * only a static read can see from Node — the press lives in `links-design-library.js`, which imports
 * the browser's overlay, so pressing it for real is `e2e/links-shortlist.spec.js`.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    SHORTLIST_ID_PREFIX, LISTED_IN_DIALOG, shortlistDocId, isShortlistDocId, shortlistSaved, builtInProposals,
    canSaveShortlist, planShortlistSave, shortlistNames, shortlistSaveMessage, shortlistSavedLine,
} from './links-shortlist.js';
import { PROPOSALS, isProposalId } from './links-proposals.js';
import { createDesignStore } from './links-design-store.js';

const ME = 'G. Miller';
const older = [
    { id: 'a1', name: 'Closing Time — copy', updatedBy: ME },
    { id: 'b2', name: 'Option B', updatedBy: 'S. Silva' },
];

describe('the rules', () => {
    test('each shortlisted design has ONE fixed id, which is never a proposal id', () => {
        const ids = PROPOSALS.map(shortlistDocId);
        assert.deepEqual(ids, PROPOSALS.map(p => SHORTLIST_ID_PREFIX + p.code));
        assert.equal(new Set(ids).size, PROPOSALS.length);
        for (const id of ids) {
            assert.ok(isShortlistDocId(id));
            // A proposal id must never reach Firestore (links-proposals.js); this one is MEANT to.
            assert.ok(!isProposalId(id), `${id} reads as a built-in proposal id`);
        }
        assert.ok(!isShortlistDocId('proposal:ES-26-T5') && !isShortlistDocId('a1') && !isShortlistDocId(null));
    });

    test('the plan saves every shortlisted design cell for cell, and moves every live design', () => {
        const plan = planShortlistSave(older, []);
        assert.deepEqual(plan.seed.map(s => s.id), PROPOSALS.map(shortlistDocId));
        plan.seed.forEach((s, i) => {
            assert.equal(s.name, PROPOSALS[i].name);
            assert.deepEqual(s.patterns, PROPOSALS[i].patterns);
        });
        assert.deepEqual(plan.retire, [
            { id: 'a1', name: 'Closing Time — copy', updatedBy: ME },
            { id: 'b2', name: 'Option B', updatedBy: 'S. Silva' },
        ]);
    });

    test('once the shortlist is saved — live OR in the bin — a second press can do nothing', () => {
        const saved = [{ id: shortlistDocId(PROPOSALS[0]), name: 'Even Step — Dec 2026', updatedBy: ME }];
        assert.deepEqual(planShortlistSave([...older, ...saved], []), { seed: [], retire: [] });
        assert.deepEqual(planShortlistSave(older, saved), { seed: [], retire: [] }, 'a binned shortlist design still counts');
    });

    test('the built-in rows go once the shortlist is saved, and a BINNED one does not bring them back', () => {
        const built = ['x', 'y'];
        assert.deepEqual(builtInProposals(older, [], built), built);
        const one = { id: shortlistDocId(PROPOSALS[2]) };
        assert.deepEqual(builtInProposals([one], [], built), []);
        assert.deepEqual(builtInProposals([], [one], built), [], 'deleting Short Run must not put it back at the top of the list');
        assert.ok(shortlistSaved([], [one]) && !shortlistSaved(older, []));
    });

    test('the row is the admin\'s, once, and never on a failed load', () => {
        const base = { isAdmin: true, loadFailed: false, designs: older, bin: [] };
        assert.equal(canSaveShortlist(base), true);
        assert.equal(canSaveShortlist({ ...base, isAdmin: false }), false);
        assert.equal(canSaveShortlist({ ...base, loadFailed: true }), false, 'a failed load is not knowing, not "nothing saved"');
        assert.equal(canSaveShortlist({ ...base, bin: [{ id: shortlistDocId(PROPOSALS[1]) }] }), false);
    });

    test('the dialog names every design that moves and who last saved it', () => {
        const plan = planShortlistSave(older, []);
        const msg = shortlistSaveMessage(plan, { currentUser: ME, dirty: false });
        assert.match(msg, /^Even Step, In Step and Short Run become saved designs\./);
        assert.match(msg, /These 2 designs move to Recently deleted, where anyone can restore them:/);
        assert.match(msg, /• Closing Time — copy \(last saved by you\)/);
        assert.match(msg, /• Option B \(last saved by S\. Silva\)/);
        assert.doesNotMatch(msg, /unsaved/);
        assert.match(shortlistSaveMessage(plan, { currentUser: ME, dirty: true }), /Your unsaved changes to the open design will be lost\.$/);
        assert.match(shortlistSaveMessage(planShortlistSave([], []), { currentUser: ME, dirty: false }), /nothing moves to Recently deleted/);
    });

    test('a long list is cut at LISTED_IN_DIALOG and the rest are COUNTED, not dropped', () => {
        const many = Array.from({ length: LISTED_IN_DIALOG + 3 }, (_, i) => ({ id: `d${i}`, name: `D${i}`, updatedBy: 'M. Robson' }));
        const msg = shortlistSaveMessage(planShortlistSave(many, []), { currentUser: ME, dirty: false });
        assert.equal((msg.match(/^• D\d+/gm) || []).length, LISTED_IN_DIALOG);
        assert.match(msg, /^• and 3 more$/m);
        assert.match(msg, new RegExp(`These ${LISTED_IN_DIALOG + 3} designs move`));
    });

    test('the names lose their "— Dec 2026" tail, and the line counts what actually moved', () => {
        const seed = planShortlistSave([], []).seed;
        assert.equal(shortlistNames(seed), 'Even Step, In Step and Short Run');
        assert.equal(shortlistNames(seed.slice(0, 1)), 'Even Step');
        assert.equal(shortlistSavedLine(seed, 0), 'Even Step, In Step and Short Run are saved designs now.');
        assert.match(shortlistSavedLine(seed, 1), /The older design is in Recently deleted — restore from there if you still need it\.$/);
        assert.match(shortlistSavedLine(seed, 4), /The 4 older designs are in Recently deleted — restore from there if you still need one\.$/);
    });
});

/**
 * A Firestore fake with SEVERAL documents and Firestore's own ordering rule: a transaction that
 * reads after it has written throws. Writes are staged and applied only when the callback returns,
 * so a transaction that throws leaves nothing behind — as a real one does.
 * @param {Record<string, any>} initial @param {{ failTx?: boolean }} [o]
 */
function makeDb(initial, { failTx = false } = {}) {
    const docs = new Map(Object.entries(initial));
    /** @type {Array<{id: string, data: any, merge: boolean}>} */ const writes = [];
    const snap = (/** @type {string} */ id) => ({ exists: () => docs.has(id), data: () => docs.get(id) });
    const outside = async () => { throw new Error('saveShortlist wrote outside its transaction'); };
    const api = {
        db: {},
        doc: (/** @type {any} */ _db, /** @type {string} */ _col, /** @type {string} */ id) => ({ id }),
        getDoc: async (/** @type {any} */ ref) => snap(ref.id),
        setDoc: outside, addDoc: outside,
        getDocs: async () => ({ docs: [...docs].map(([id, d]) => ({ id, data: () => d })) }),
        runTransaction: async (/** @type {any} */ _db, /** @type {any} */ fn) => {
            if (failTx) throw Object.assign(new Error('client is offline'), { code: 'unavailable' });
            /** @type {typeof writes} */ const staged = [];
            await fn({
                get: async (/** @type {any} */ ref) => {
                    if (staged.length) throw new Error('Firestore transactions require all reads to be executed before all writes.');
                    return snap(ref.id);
                },
                set: (/** @type {any} */ ref, /** @type {any} */ data, /** @type {any} */ opts) => { staged.push({ id: ref.id, data, merge: !!opts?.merge }); },
            });
            for (const w of staged) {
                writes.push(w);
                docs.set(w.id, w.merge ? { ...(docs.get(w.id) || {}), ...w.data } : { ...w.data });
            }
        },
        serverTimestamp: () => ({ __serverTimestamp: true }),
        deleteField: () => ({ __deleteField: true }),
        designsCol: {},
        withClaimRetry: (/** @type {any} */ fn) => fn(),
        isOnline: () => true,
    };
    return { store: createDesignStore(/** @type {any} */ (api)), docs, writes };
}

const seeds = PROPOSALS.map(p => ({ id: shortlistDocId(p), payload: { name: p.name, patterns: p.patterns, window: null, updatedAt: { __serverTimestamp: true }, updatedBy: ME } }));
const live = (/** @type {string} */ name) => ({ name, patterns: {}, updatedAt: 1, updatedBy: 'S. Silva' });

describe('the transaction (links-design-store.js saveShortlist)', () => {
    test('creates each design at revision 1, and SOFT-deletes the listed ones by merge', async () => {
        const { store, docs, writes } = makeDb({ a1: live('A'), b2: live('B') });
        const res = await store.saveShortlist({ seeds, retire: ['a1', 'b2'], by: ME });
        assert.equal(res.status, 'saved');
        assert.deepEqual(res.status === 'saved' && res.moved, ['a1', 'b2']);
        for (const s of seeds) {
            const w = writes.find(x => x.id === s.id);
            assert.ok(w && !w.merge, `${s.id} is created, not merged`);
            assert.equal(w.data.revision, 1);
            assert.deepEqual(w.data.patterns, s.payload.patterns);
        }
        for (const id of ['a1', 'b2']) {
            const w = writes.find(x => x.id === id);
            assert.ok(w?.merge, `${id} must be a MERGE — a replace would lose its patterns`);
            assert.deepEqual(Object.keys(w.data).sort(), ['deletedAt', 'deletedBy']);
            assert.equal(w.data.deletedBy, ME);
            assert.equal(docs.get(id).name, id === 'a1' ? 'A' : 'B', 'the design keeps its name and patterns in the bin');
        }
        assert.equal(res.status === 'saved' && res.created.length, seeds.length);
        assert.ok(res.status === 'saved' && res.created.every(c => c.baseline.loadedRevision === 1 && !c.baseline.baselineUnknown));
    });

    test('if ANY shortlist id is already taken it writes NOTHING — two presses cannot make two Even Steps', async () => {
        const { store, writes } = makeDb({ a1: live('A'), [seeds[1].id]: live('In Step — Dec 2026') });
        const res = await store.saveShortlist({ seeds, retire: ['a1'], by: ME });
        assert.equal(res.status, 'already-saved');
        assert.deepEqual(writes, []);
    });

    test('a listed design that has gone, or is already binned, is skipped — never written to', async () => {
        const { store, docs, writes } = makeDb({ a1: { ...live('A'), deletedAt: 5, deletedBy: 'M. Robson' } });
        const res = await store.saveShortlist({ seeds, retire: ['a1', 'gone'], by: ME });
        assert.deepEqual(res.status === 'saved' && res.moved, []);
        assert.ok(!writes.some(w => w.id === 'a1' || w.id === 'gone'));
        assert.ok(!docs.has('gone'), 'a merge onto a removed design would have created a nameless one');
        assert.equal(docs.get('a1').deletedBy, 'M. Robson', 'the colleague who binned it is still the one named');
    });

    test('a failed transaction (offline) leaves the collection exactly as it was', async () => {
        const { store, docs, writes } = makeDb({ a1: live('A') }, { failTx: true });
        await assert.rejects(store.saveShortlist({ seeds, retire: ['a1'], by: ME }));
        assert.deepEqual(writes, []);
        assert.deepEqual([...docs.keys()], ['a1']);
    });
});

describe('the wiring (links-app.js, links-design-library.js, links.html)', () => {
    const app = readFileSync(new URL('./links-app.js', import.meta.url), 'utf8');
    const lib = readFileSync(new URL('./links-design-library.js', import.meta.url), 'utf8');
    const html = readFileSync(new URL('./links.html', import.meta.url), 'utf8');

    test('nothing reads the built-in list except through _builtIns(), so a saved shortlist is never listed twice', () => {
        // Two uses: the definition, and the helper that filters it.
        assert.equal((app.match(/PROPOSAL_ENTRIES/g) || []).length, 2, 'a new read of PROPOSAL_ENTRIES would list the shortlist twice once it is saved');
        assert.match(app, /const _builtIns = \(\) => builtInProposals\(designs, _bin\(\), PROPOSAL_ENTRIES\);/);
        assert.match(app, /proposals: _builtIns\(\)/, 'the picker');
        assert.match(app, /getDesigns: \(\) => \[\.\.\.designs, \.\.\._builtIns\(\)\]/, 'compare');
    });

    test('the row is wired to the library, gated by the same rule that shows it, and starts hidden', () => {
        assert.match(app, /\[\$\('saveShortlistBtn'\), \(\) => library\?\.saveShortlist\(\)\]/);
        assert.match(app, /getElementById\('saveShortlistBtn'\)\?\.style\.setProperty\('display', library\?\.shortlistOffered\(\) \? '' : 'none'\)/);
        assert.match(lib, /const shortlistOffered = \(\) => !shortlistSaving && canSaveShortlist\(\{ isAdmin: ctx\.isAdmin, loadFailed: ctx\.loadFailed\(\), designs: ctx\.getDesigns\(\), bin \}\);/);
        assert.match(lib, /async function saveShortlist\(\) \{\n\s+if \(!shortlistOffered\(\)\) return;/, 'the press re-asks the rule, not just the row');
        assert.match(html, /<button class="dm-menu-btn" id="saveShortlistBtn" type="button" style="display:none">/);
    });
});
