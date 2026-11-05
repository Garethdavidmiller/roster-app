/**
 * links-shortlist.test.mjs — "Keep only the shortlist" (v25.09).
 *
 * Run: node --test links-shortlist.test.mjs   (part of `npm run test:hygiene`)
 *
 * Three layers, because each can be right while the next is wrong: the RULES (`links-shortlist.js`
 * — what counts as an older design, and when the row is offered), the MOVE (the store's existing
 * `binIfStill` asked with `isOlderDesign`, against a fake whose server copy can change under the
 * dialog), and the WIRING, which only a static read can see from Node — the press lives in
 * `links-design-library.js`, which imports the browser's overlay, so pressing it for real is
 * `e2e/links-shortlist.spec.js`.
 *
 * And one thing that must NOT happen, pinned here because the first version of this feature did it:
 * the shortlist is read-only (owner, 2 Nov 2026), so nothing here may save a copy of it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    OLDER_BEFORE, LISTED_IN_DIALOG, isOlderDesign, olderDesigns, canKeepOnlyShortlist,
    keepOnlyShortlistMessage, keptOnlyShortlistLine,
} from './links-shortlist.js';
import { createDesignStore } from './links-design-store.js';

const ME = 'G. Miller';
const ts = (/** @type {number} */ ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const BEFORE = OLDER_BEFORE - 1, AFTER = OLDER_BEFORE;

describe('the rules', () => {
    test('older means last saved BEFORE the start of 2 Nov 2026 — the day the owner asked', () => {
        assert.equal(OLDER_BEFORE, Date.UTC(2026, 10, 2));
        assert.equal(isOlderDesign({ updatedAt: ts(BEFORE) }), true);
        assert.equal(isOlderDesign({ updatedAt: ts(AFTER) }), false, 'saved that day or later is new work');
        assert.equal(isOlderDesign({ updatedAt: BEFORE }), true, 'a millisecond figure reads the same as a Timestamp');
        assert.equal(isOlderDesign({ updatedAt: new Date(BEFORE) }), true);
    });

    test('a save time that cannot be read is NOT older — not knowing is not "older"', () => {
        for (const updatedAt of [undefined, null, {}, 'yesterday', NaN, { toMillis: () => NaN }]) {
            assert.equal(isOlderDesign({ updatedAt }), false, String(updatedAt));
        }
        assert.equal(isOlderDesign(null), false);
    });

    test('the row is the admin\'s, and only while something older is left — so it goes away by itself', () => {
        const older = [{ updatedAt: ts(BEFORE) }], newer = [{ updatedAt: ts(AFTER) }];
        assert.equal(canKeepOnlyShortlist({ isAdmin: true, designs: [...older, ...newer] }), true);
        assert.equal(canKeepOnlyShortlist({ isAdmin: false, designs: older }), false);
        assert.equal(canKeepOnlyShortlist({ isAdmin: true, designs: newer }), false, 'nothing older: nothing to offer');
        assert.equal(canKeepOnlyShortlist({ isAdmin: true, designs: [] }), false, 'a failed load lists nothing, so offers nothing');
        assert.deepEqual(olderDesigns([...newer, ...older]), older);
    });

    test('the dialog says the shortlist stays, and names every design that moves and who last saved it', () => {
        const msg = keepOnlyShortlistMessage([
            { name: 'Closing Time — copy', updatedBy: ME },
            { name: 'Option B', updatedBy: 'S. Silva' },
        ], { currentUser: ME, dirty: false });
        assert.match(msg, /^Common Ground, Even Step and Short Run stay in the list as they are now — built in and read-only\./);
        assert.match(msg, /These 2 older designs move to Recently deleted, where anyone can restore them:/);
        assert.match(msg, /• Closing Time — copy \(last saved by you\)/);
        assert.match(msg, /• Option B \(last saved by S\. Silva\)/);
        assert.doesNotMatch(msg, /unsaved/);
        assert.match(keepOnlyShortlistMessage([{ name: 'A', updatedBy: ME }], { currentUser: ME, dirty: true }), /This older design moves[\s\S]*Your unsaved changes to the open design will be lost\.$/);
    });

    test('a long list is cut at LISTED_IN_DIALOG and the rest are COUNTED, not dropped', () => {
        const many = Array.from({ length: LISTED_IN_DIALOG + 3 }, (_, i) => ({ name: `D${i}`, updatedBy: 'M. Robson' }));
        const msg = keepOnlyShortlistMessage(many, { currentUser: ME, dirty: false });
        assert.equal((msg.match(/^• D\d+/gm) || []).length, LISTED_IN_DIALOG);
        assert.match(msg, /^• and 3 more$/m);
        assert.match(msg, new RegExp(`These ${LISTED_IN_DIALOG + 3} older designs move`));
    });

    test('the line counts what actually moved, and says when something could not be', () => {
        assert.match(keptOnlyShortlistLine(1, 0), /^The older design is in Recently deleted, so the shortlist is what is left — restore from there if you still need it\.$/);
        assert.match(keptOnlyShortlistLine(4, 0), /^The 4 older designs are in Recently deleted/);
        assert.match(keptOnlyShortlistLine(0, 0), /Nothing was moved/);
        assert.match(keptOnlyShortlistLine(3, 1), /^The 3 older designs are .* One design could not be moved — check your connection and choose Keep only the shortlist again\.$/);
        assert.match(keptOnlyShortlistLine(0, 2), /^2 designs could not be moved/);
    });
});

/**
 * A one-document Firestore fake with a real transaction's property that matters here: the callback
 * reads what the SERVER holds now, which may not be what the dialog was built from.
 * @param {any} initial
 */
function makeDb(initial) {
    let doc = initial;
    /** @type {any[]} */ const writes = [];
    const outside = async () => { throw new Error('the move wrote outside its transaction'); };
    const api = {
        db: {}, doc: () => ({ id: 'd1' }), getDoc: async () => ({ exists: () => !!doc, data: () => doc }),
        setDoc: outside, addDoc: outside, getDocs: async () => ({ docs: [] }),
        runTransaction: async (/** @type {any} */ _db, /** @type {any} */ fn) => fn({
            get: async () => ({ exists: () => !!doc, data: () => doc }),
            set: (/** @type {any} */ _ref, /** @type {any} */ data, /** @type {any} */ opts) => { writes.push({ data, merge: !!opts?.merge }); doc = { ...doc, ...data }; },
        }),
        serverTimestamp: () => ({ __serverTimestamp: true }), deleteField: () => ({}),
        designsCol: {}, withClaimRetry: (/** @type {any} */ fn) => fn(), isOnline: () => true,
    };
    return { store: createDesignStore(/** @type {any} */ (api)), writes, now: () => doc };
}

describe('the move (the store\'s binIfStill, asked with isOlderDesign)', () => {
    test('an older design is SOFT-deleted by merge — it keeps its name and patterns for a restore', async () => {
        const { store, writes, now } = makeDb({ name: 'Option B', patterns: { '1': { mon: '06:20-14:20' } }, updatedAt: ts(BEFORE), updatedBy: 'S. Silva' });
        assert.equal(await store.binIfStill('d1', ME, isOlderDesign), 'moved');
        assert.equal(writes.length, 1);
        assert.ok(writes[0].merge, 'a replace would lose the patterns');
        assert.deepEqual(Object.keys(writes[0].data).sort(), ['deletedAt', 'deletedBy']);
        assert.equal(now().deletedBy, ME);
        assert.equal(now().name, 'Option B');
    });

    test('a design a colleague SAVED after the dialog opened is spared — the rule is asked again in the transaction', async () => {
        const { store, writes } = makeDb({ name: 'Option B', patterns: {}, updatedAt: ts(AFTER), updatedBy: 'S. Silva' });
        assert.equal(await store.binIfStill('d1', ME, isOlderDesign), 'skipped');
        assert.deepEqual(writes, []);
    });
});

describe('the wiring (links-design-library.js, links-app.js, links.html)', () => {
    const lib = readFileSync(new URL('./links-design-library.js', import.meta.url), 'utf8');
    const app = readFileSync(new URL('./links-app.js', import.meta.url), 'utf8');
    const html = readFileSync(new URL('./links.html', import.meta.url), 'utf8');

    test('each move goes through binIfStill with the same rule that listed it', () => {
        assert.match(lib, /ctx\.store\.binIfStill\(d\.id, ctx\.currentUser, isOlderDesign\)/);
        assert.match(lib, /const keepOffered = \(\) => !keeping && canKeepOnlyShortlist\(\{ isAdmin, designs: ctx\.getDesigns\(\) \}\);/);
        assert.match(lib, /async function keepOnlyShortlist\(\) \{\n\s+if \(!keepOffered\(\)\) return;/, 'the press re-asks the rule, not only the row');
    });

    test('the shortlist stays READ-ONLY: nothing in the press creates a design', () => {
        const press = lib.slice(lib.indexOf('// ── Keep only the shortlist'), lib.indexOf('initDesignBin();'));
        assert.ok(press.length > 500, 'the press block was not found — this test is checking nothing');
        assert.doesNotMatch(press, /store\.(create|save)\b|docPayload|addDesign/, 'saving a copy of the shortlist is what the owner said no to');
    });

    test('the row is wired in the library, starts hidden, and the coordinator lends ONE hook', () => {
        assert.match(lib, /getElementById\('designMoreBtn'\)\?\.addEventListener\('click', \(\) => \{ if \(keepRow\) keepRow\.style\.display = keepOffered\(\) \? '' : 'none'; \}\);/);
        assert.match(lib, /keepRow\?\.addEventListener\('click', \(\) => \{ const h = ctx\.getHeader\(\); if \(h\) h\.viaSheet\(keepOnlyShortlist\); else keepOnlyShortlist\(\); \}\);/);
        assert.match(html, /<button class="dm-menu-btn" id="keepShortlistBtn" type="button" style="display:none">/);
        assert.match(app, /removeDesigns: \(\/\*\* @type \{Set<string>\} \*\/ ids\) => \{ designs = designs\.filter\(d => !ids\.has\(d\.id\)\); compare\.resetCompare\(\); if \(ids\.has\(activeDesignId\)\) _activateDesign\(designs\[0\] \?\? PROPOSAL_ENTRIES\[0\]\); else renderDesignPicker\(\); \},/);
    });
});
