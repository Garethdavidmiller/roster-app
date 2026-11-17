/**
 * links-queued-saves.test.mjs — which copy of a QUEUED Links save is kept, on which baseline, and whether
 * an answer still counts (links-queued-saves.js; v26.03). Organised by its rules.
 *
 * Run: node scripts/run-tests.mjs links-queued-saves.test.mjs   (part of `npm run test:hygiene`)
 *
 * What these protect is a designer's afternoon of work in a second tab, whose Firestore queue dies with
 * the page: every wrong answer below either throws that copy away while the server does not have it, or
 * restores it onto a baseline that lets it overwrite a colleague's save without asking.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createQueuedSaves, stillUnsaved, refusedMakeLine } from './links-queued-saves.js';

/** The version the designer's edits were made against — what the server is known to hold. */
const KNOWN = { loadedRevision: 4, loadedUpdatedAt: null, baselineUnknown: false };
/** What a queued save leaves as the page's baseline: nothing verified. */
const UNKNOWN = { loadedRevision: null, loadedUpdatedAt: null, baselineUnknown: true };
const copy = (/** @type {string} */ end) => ({ patterns: { 1: { mon: '06:20-14:20' } }, window: { monSat: { start: '06:20', end }, sun: { start: '07:15', end: '23:55' } } });

describe('rule 1 — an answer counts only for the design\'s LATEST save', () => {
    test('the answer to an earlier save does not clear a later one', () => {
        const q = createQueuedSaves();
        const first = q.next(), second = q.next();
        q.queued('d1', first, copy('14:20'), KNOWN);
        q.queued('d1', second, copy('14:40'), UNKNOWN);
        assert.equal(q.counts('d1', first), false, 'the first save\'s answer is superseded');
        assert.equal(q.counts('d1', second), true);
    });

    test('numbers only go up, so a later save is always the newer', () => {
        const q = createQueuedSaves();
        const a = q.next(), b = q.next();
        assert.ok(b > a);
    });

    test('a new design, a copy or an import counts only while no save of it is waiting', () => {
        const q = createQueuedSaves();
        assert.equal(q.counts('d9'), true, 'nothing waiting: its own answer clears the pill');
        q.queued('d9', q.next(), copy('14:20'), KNOWN);
        assert.equal(q.counts('d9'), false, 'a save made since is what the pill waits on');
    });
});

describe('rule 2 — the EARLIEST baseline still unconfirmed', () => {
    test('a second queued save keeps the baseline from before the first', () => {
        const q = createQueuedSaves();
        q.queued('d1', q.next(), copy('14:20'), KNOWN);
        q.queued('d1', q.next(), copy('14:40'), UNKNOWN);   // the page's baseline after the first: unknown
        assert.deepEqual(q.get('d1')?.baseline, KNOWN, 'the server may have neither, so it is known to hold only what came before both');
        assert.equal(q.get('d1')?.written.window.monSat.end, '14:40', '…while the copy is the latest work');
    });

    test('each design keeps its own', () => {
        const q = createQueuedSaves();
        const other = { loadedRevision: 9, loadedUpdatedAt: null, baselineUnknown: false };
        q.queued('d1', q.next(), copy('14:20'), KNOWN);
        q.queued('d2', q.next(), copy('14:20'), other);
        assert.deepEqual(q.get('d1')?.baseline, KNOWN);
        assert.deepEqual(q.get('d2')?.baseline, other);
    });
});

describe('rule 3 — a confirmed save answers for every earlier one', () => {
    test('an online save forgets the design\'s waiting save', () => {
        const q = createQueuedSaves();
        q.queued('d1', q.next(), copy('14:20'), KNOWN);
        q.confirmed('d1');
        assert.equal(q.get('d1'), null);
        assert.equal(q.newest(), null, 'nothing left to keep');
    });

    test('the server having the latest save forgets it too', () => {
        const q = createQueuedSaves();
        q.queued('d1', q.next(), copy('14:20'), KNOWN);
        q.acked('d1');
        assert.equal(q.get('d1'), null);
    });
});

describe('rule 4 — a REFUSED save stays, marked', () => {
    test('refused: still kept, with its copy and its baseline', () => {
        const q = createQueuedSaves();
        q.queued('d1', q.next(), copy('14:20'), KNOWN);
        const refused = q.refused('d1');
        assert.equal(refused?.failed, true);
        assert.equal(q.get('d1')?.failed, true, 'kept: the server does not have this work');
        assert.deepEqual(q.newest()?.save.baseline, KNOWN);
    });

    test('a refusal for a design with nothing waiting is nothing', () => {
        assert.equal(createQueuedSaves().refused('d1'), null);
    });

    test('a later save of a refused design starts clean', () => {
        const q = createQueuedSaves();
        q.queued('d1', q.next(), copy('14:20'), KNOWN);
        q.refused('d1');
        q.queued('d1', q.next(), copy('14:40'), UNKNOWN);
        assert.equal(q.get('d1')?.failed, undefined, 'its own answer is still to come');
        assert.deepEqual(q.get('d1')?.baseline, KNOWN, 'and still on the earliest baseline: the refused save never landed');
    });
});

describe('rule 5 — one slot: the NEWEST unconfirmed save is kept', () => {
    test('the newest by number, whichever design', () => {
        const q = createQueuedSaves();
        q.queued('d1', q.next(), copy('14:20'), KNOWN);
        q.queued('d2', q.next(), copy('15:00'), KNOWN);
        assert.equal(q.newest()?.id, 'd2');
        q.queued('d1', q.next(), copy('14:40'), UNKNOWN);   // saved again: d1 is newest now, though first in the map
        assert.equal(q.newest()?.id, 'd1');
        q.acked('d1');
        assert.equal(q.newest()?.id, 'd2', 'once it lands, the next newest is kept');
    });

    test('none waiting: nothing to keep', () => {
        assert.equal(createQueuedSaves().newest(), null);
    });
});

describe('rule 6 — a kept copy its design now holds exactly is not unsaved', () => {
    const kept = { data: { ...copy('14:20'), baseline: KNOWN } };

    test('the design holds it: nothing unsaved', () => {
        assert.equal(stillUnsaved(kept, copy('14:20')), null);
    });

    test('compared CANONICALLY: a time typed without its leading zero, and a stored window missing, are the same design', () => {
        const loose = { patterns: { 1: { mon: '6:20-14:20' } }, window: copy('14:20').window };
        assert.equal(stillUnsaved(kept, loose), null);
        const defaultWindowKept = { data: { patterns: copy('').patterns, window: null } };
        assert.equal(stillUnsaved(defaultWindowKept, { patterns: copy('').patterns }), null, 'no window on either side is the default on both');
    });

    test('the design holds something else: the whole draft is still unsaved', () => {
        assert.equal(stillUnsaved(kept, copy('23:55')), kept.data);
        assert.equal(stillUnsaved(kept, { ...copy('14:20'), patterns: { 1: { mon: 'RD' } } }), kept.data);
    });

    test('a design no longer in the list: all of it is unsaved', () => {
        assert.equal(stillUnsaved(kept, undefined), kept.data);
        assert.equal(stillUnsaved(kept, null), kept.data);
    });
});

describe('rule 7 — a refused write that would have MADE the design made nothing', () => {
    test('a refused create: the server never made it', () => {
        const q = createQueuedSaves();
        assert.equal(q.heard('d1', 'failed', true), true);
        assert.equal(q.neverMade('d1'), true);
        assert.equal(q.neverMade('d2'), false, 'per design');
    });

    test('a refused save of a design the server holds made nothing NEW: it still exists', () => {
        const q = createQueuedSaves();
        assert.equal(q.heard('d1', 'failed', false), false);
        assert.equal(q.neverMade('d1'), false);
    });

    test('the mark outlives the answer of a save queued behind the create, which lands on nothing too', () => {
        const q = createQueuedSaves();
        q.heard('d1', 'failed', true);
        assert.equal(q.heard('d1', 'failed', false), true, 'refused behind it');
        assert.equal(q.heard('d1', 'held', false), true, 'held is no answer at all');
        assert.equal(q.neverMade('d1'), true);
    });

    test('any write the server confirms made it', () => {
        const q = createQueuedSaves();
        q.heard('d1', 'failed', true);
        assert.equal(q.heard('d1', 'acked', true), false, 'its next create, made');
        assert.equal(q.neverMade('d1'), false);
        q.heard('d2', 'failed', true);
        assert.equal(q.heard('d2', 'acked', false), false, 'any confirmed write names a document that exists');
    });

    test('no id is never "never made"', () => {
        assert.equal(createQueuedSaves().neverMade(null), false);
    });

    test('what the page says: open, it is unsaved again and one Save as… away; closed, it is gone from the list', () => {
        const open = refusedMakeLine('Q. Example draft', true);
        assert.match(open, /^Not saved — the server refused “Q\. Example draft”, so nobody else has it\./);
        assert.match(open, /press Save as… to save it again\. If that is refused too, contact the admin\.$/);
        const closed = refusedMakeLine('Q. Example draft', false);
        assert.match(closed, /^“Q\. Example draft” was not saved — the server refused it, so it is no longer in the list\./);
        assert.match(closed, /contact the admin\.$/);
        for (const line of [open, closed]) {
            assert.doesNotMatch(line, /removed|deleted|for good|!/, 'never made is not removed, and the tone stays calm');
        }
    });

    test('a design with no name yet is still said', () => {
        assert.match(refusedMakeLine('', true), /the server refused this new design,/);
        assert.match(refusedMakeLine('   ', false), /^A new design was not saved/);
    });
});
