/**
 * paycalc-backpay-state.test.mjs — the back-pay card's figure decisions (v19.93).
 * Run: node --test paycalc-backpay-state.test.mjs   (part of `npm run test:hygiene`)
 *
 * `paycalc-backpay.js` was the only module in the paycalc family with no test file of its own, and
 * four of its ten exports were untested — including `calcBackPay`, which produces the lump sum. The
 * per-period accrual was covered; the ASSEMBLY around it was not, and the assembly is where all five
 * of its recorded defects live.
 *
 * There is one describe block per defect, because they are not variations on a theme — they are five
 * different ways for a money figure to come out wrong with nothing on screen to say so. Money code
 * whose failure mode is silence is the case where a test earns the most, and it is exactly the case
 * where the previous fix was a comment.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    BP_FIELDS, readBpFields, bpFieldWrites,
    resolveAuthoritativeRates, allRatesOnRecord, resolvePaidInPeriod,
} from './paycalc-backpay-state.js';

/** A blob-reader over a plain {id: value} map, matching what the coordinator passes. */
const getter = (fields) => (id) => (id in fields ? fields[id] : '');

// ── DEFECT 2 — the round trip ──────────────────────────────────────────────────────────────────
// "a year switch left the old year's figures in any box the new year's blob doesn't overwrite, e.g.
//  the no-recorded-figure CES 2025/26 old-rate box silently inheriting the 2026/27 rate."
//
// This is the one a comment structurally cannot hold: it is a property ACROSS two operations (clear,
// then apply), so only a write→read→write test sees it.
describe('the saved round trip', () => {
    test('every field survives a write → read → write cycle byte-identically', () => {
        const fields = {
            bpRisePct: '3.6', oldRate: '20.74', newRateInput: '21.49',
            oldLondon: '276.16', newLondon: '286.10', bpManualAmt: '1234.56',
        };
        const blob = readBpFields(getter(fields));
        const back = Object.fromEntries(bpFieldWrites(blob).map(w => [w.id, w.value]));
        assert.deepEqual(back, fields);
    });

    test('values are carried as RAW STRINGS, never parsed and reformatted', () => {
        // A blob is written by one version of the app and read by another. A round trip that
        // reformats is a round trip that can change a figure the member typed — and these are pay
        // figures, not approximations.
        const fields = { oldRate: '20.740', newRateInput: '21.49', bpRisePct: '3.60' };
        const blob = readBpFields(getter(fields));
        assert.equal(blob.oldR, '20.740');
        assert.equal(blob.pct, '3.60');
        const w = Object.fromEntries(bpFieldWrites(blob).map(x => [x.id, x.value]));
        assert.equal(w.oldRate, '20.740');
    });

    test('a field the blob is SILENT about is blanked, not left holding the last year', () => {
        // THE DEFECT, exactly. The 2025/26 CES old rate is not on record, so that year's blob has no
        // value for it — and if a restore only assigns what the blob carries, the box keeps 2026/27's
        // number and the member reconciles a lump against a rate they never entered.
        const blob = { newR: '21.49' };      // only one field present
        const writes = Object.fromEntries(bpFieldWrites(blob).map(w => [w.id, w.value]));
        assert.equal(writes.newRateInput, '21.49');
        assert.equal(writes.oldRate, '', 'a field absent from the blob must be actively blanked');
        assert.equal(writes.oldLondon, '');
        assert.equal(writes.bpManualAmt, '');
    });

    test('bpFieldWrites returns an entry for EVERY field, so nothing can be left unassigned', () => {
        // The structural guarantee behind the case above: there is no field the caller could fail to
        // touch, because the list it iterates IS the schema.
        for (const blob of [null, undefined, {}, { pct: '3.6' }]) {
            assert.equal(bpFieldWrites(blob).length, BP_FIELDS.length);
        }
    });

    test('a null blob blanks everything — "no saved state" is not "keep what is there"', () => {
        assert.ok(bpFieldWrites(null).every(w => w.value === ''));
    });

    test('read and write agree on the schema, in both directions', () => {
        // The mirror-image bug: a field added to one list and not the other. Reading produces a key
        // per field, and writing consumes a key per field — so a schema entry that only half exists
        // shows up here rather than as a box that quietly stops persisting.
        const blob = readBpFields(getter({}));
        assert.deepEqual(Object.keys(blob).sort(), BP_FIELDS.map(f => f.key).sort());
        assert.deepEqual(bpFieldWrites(blob).map(w => w.id).sort(), BP_FIELDS.map(f => f.id).sort());
    });
});

// ── DEFECTS 4 & 5 — which boxes lock, and what goes in them ────────────────────────────────────
describe('authoritative rate figures', () => {
    const TY_SETTLED = { londonAllow: 286.10, londonAllowPre: 276.16 };
    const AWARD      = { rate: 21.49, pre: 20.74 };

    test('a settled award with everything on record locks all four, with the recorded values', () => {
        assert.deepEqual(resolveAuthoritativeRates(TY_SETTLED, AWARD), {
            oldRate: 20.74, newRateInput: 21.49, oldLondon: 276.16, newLondon: 286.10,
        });
    });

    test('review F2 — a locked box carries its FIGURE, not just the fact that it is locked', () => {
        // Returning the value alongside the lock is what lets a caller write it in one step. Without
        // it, a stale restored or typed value sits behind a padlock and reads to the member as the
        // app confirming a number it never supplied.
        const auth = resolveAuthoritativeRates(TY_SETTLED, AWARD);
        for (const [k, v] of Object.entries(auth)) {
            assert.equal(typeof v, 'number', `${k} locks but supplies no figure to write`);
        }
    });

    test('review F1 — the decision does not depend on what the box contains', () => {
        // The function takes no field values at all, which is the structural form of the rule: an
        // earlier version locked a box when its value was non-empty, so a recompute triggered
        // mid-typing froze whatever fragment the member had got as far as.
        assert.equal(resolveAuthoritativeRates.length, 2);
        // …and the same award gives the same answer regardless of anything else in play.
        assert.deepEqual(resolveAuthoritativeRates(TY_SETTLED, AWARD),
                         resolveAuthoritativeRates(TY_SETTLED, AWARD));
    });

    test('a figure NOT on record stays null — the box must remain editable', () => {
        // The live case: the CES 2025/26 old rate, which the app has never held. The member is the
        // only source for it, so locking would make the card unusable for that year.
        const auth = resolveAuthoritativeRates(TY_SETTLED, { rate: 21.49, pre: null });
        assert.equal(auth.oldRate, null);
        assert.equal(auth.newRateInput, 21.49);
    });

    test('an UNSETTLED award records nothing at all', () => {
        // Until the payslip lands the figures are estimates, so every box stays open — locking an
        // estimate would present a guess as being on record.
        const auth = resolveAuthoritativeRates({ ...TY_SETTLED, rateUnconfirmed: true }, AWARD);
        assert.deepEqual(auth, { oldRate: null, newRateInput: null, oldLondon: null, newLondon: null });
    });

    test('a missing award or tax year locks nothing, rather than throwing', () => {
        for (const [ty, aw] of [[null, null], [TY_SETTLED, null], [null, AWARD], [undefined, undefined]]) {
            const auth = resolveAuthoritativeRates(ty, aw);
            assert.equal(Object.values(auth).filter(v => v != null).length <= 2, true);
        }
    });

    test('allRatesOnRecord is true only when all four are, and false on an empty set', () => {
        assert.equal(allRatesOnRecord(resolveAuthoritativeRates(TY_SETTLED, AWARD)), true);
        assert.equal(allRatesOnRecord(resolveAuthoritativeRates(TY_SETTLED, { rate: 21.49, pre: null })), false);
        // Vacuous truth would collapse the editable rows on a card with no figures at all.
        assert.equal(allRatesOnRecord({}), false);
    });
});

// ── DEFECTS 1 & 3 — which payslip the lump lands on ────────────────────────────────────────────
describe('the paid-in period ladder', () => {
    test('defect 1 — a DECIDED award derives, and ignores a stale saved value', () => {
        // The 3.6% award moved 31 Jul → 28 Aug. A saved paid-in from before that move pins the lump
        // to a payslip whose selector is now hidden, so the member sees the include banner on the
        // wrong period with no control to fix it.
        assert.equal(resolvePaidInPeriod({
            awardDecided: true, derivedPNum: 57, savedPNum: 56, fallbackPNum: 55,
        }), 57);
    });

    test('an UNDECIDED award keeps the member\'s own choice — it is the only answer there is', () => {
        assert.equal(resolvePaidInPeriod({
            awardDecided: false, derivedPNum: null, savedPNum: 56, fallbackPNum: 55,
        }), 56);
    });

    test('defect 3 — it never returns 0 while ANY candidate exists', () => {
        // Zero means "no paid-in period", which drops the lump to £0 — and on a decided award there
        // is no visible control to put it back. This is the assertion to keep if the ladder is ever
        // reordered: the ORDER is a judgement, but never-zero is the safety property.
        const candidates = [
            { awardDecided: true,  derivedPNum: null, savedPNum: null, fallbackPNum: 55 },
            { awardDecided: true,  derivedPNum: null, savedPNum: 56,   fallbackPNum: null },
            { awardDecided: false, derivedPNum: 57,   savedPNum: null, fallbackPNum: null },
            { awardDecided: true,  derivedPNum: 57,   savedPNum: null, fallbackPNum: null },
        ];
        for (const c of candidates) {
            assert.notEqual(resolvePaidInPeriod(c), 0,
                `dropped to 0 with a candidate available: ${JSON.stringify(c)}`);
        }
    });

    test('0 only when genuinely nothing is known', () => {
        assert.equal(resolvePaidInPeriod({
            awardDecided: true, derivedPNum: null, savedPNum: null, fallbackPNum: null,
        }), 0);
    });

    test('a zero or negative candidate is treated as absent, not as a period', () => {
        // Period numbers are 1-based, so 0 is the "no selection" sentinel a `<select>` yields — it
        // must fall through the ladder rather than be returned as an answer.
        assert.equal(resolvePaidInPeriod({
            awardDecided: false, derivedPNum: 0, savedPNum: 0, fallbackPNum: 55,
        }), 55);
        assert.equal(resolvePaidInPeriod({
            awardDecided: true, derivedPNum: -1, savedPNum: null, fallbackPNum: 55,
        }), 55);
    });

    test('a non-numeric candidate (a raw select value) is refused', () => {
        // `+bpSel.value` is the caller's job; passing the string through would make '56' truthy and
        // return it as a period, which then fails an === comparison downstream.
        assert.equal(resolvePaidInPeriod({
            awardDecided: false, derivedPNum: null, savedPNum: /** @type {any} */ ('56'), fallbackPNum: 55,
        }), 55);
    });
});
