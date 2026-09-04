import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DESIGN_NAME, nameKey, nameConflict, checkName, proposeCopyName } from './links-design-naming.js';

// Organised by what a wrong answer COSTS, not by function — the two directions are not symmetrical.
//
// ACCEPTING an ambiguous name is silent and it damages somebody else's work: two rows read "Option
// A", and Compare, Delete and Load all act on the one you POINT AT. You point by reading. The
// designer who loses work is not the one who typed the name, and nothing on screen ever said so.
//
// REFUSING a name that was fine is loud and recoverable — you are told, and you type another one.
// Its only real cost is refusing a rename that changes nothing but capitalisation, which is why
// `exceptId` has its own case here.

describe('an ambiguous name is refused — the direction that costs somebody else their work', () => {
    const existing = [{ id: 'a', name: 'Option A' }, { id: 'b', name: 'Option B' }];

    test('the same name, exactly', () => {
        const r = checkName('Option A', { existing });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'duplicate');
    });

    test('the same name to a READER — case and spacing are not distinctions in a dropdown', () => {
        for (const typed of ['option a', 'OPTION A', 'Option  A', '  Option A  ', 'oPtIoN a']) {
            assert.equal(checkName(typed, { existing }).ok, false,
                `"${typed}" was accepted alongside "Option A". A person choosing from a list cannot `
                + 'tell these apart, and Delete acts on whichever they picked.');
        }
    });

    test('the refusal NAMES the existing one, so it can be checked against the list', () => {
        const r = checkName('option a', { existing });
        assert.match(r.message ?? '', /Option A/,
            'a bare "name already used" invites the designer to assume they mis-clicked; quoting the '
            + 'existing name is what makes the refusal verifiable');
    });

    test('setups get the same rule, in their own words', () => {
        const r = checkName('Winter cover', { existing: [{ id: 's1', name: 'winter cover' }], noun: 'staffing setup' });
        assert.equal(r.ok, false);
        assert.match(r.message ?? '', /staffing setup/,
            'the noun is a parameter so one rule serves both lists — a second copy would drift');
    });
});

describe('a name that is fine is accepted — the direction that costs trust', () => {
    const existing = [{ id: 'a', name: 'Option A' }];

    test('a genuinely new name', () => {
        assert.equal(checkName('Option C', { existing }).ok, true);
    });

    test('RENAMING an entry to a variant of its OWN name', () => {
        // Without `exceptId` this refuses, and the refusal is absurd: correcting your own design's
        // capitalisation is told it collides with itself.
        assert.equal(checkName('option a', { existing, exceptId: 'a' }).ok, true);
        assert.equal(checkName('Option A ', { existing, exceptId: 'a' }).ok, true);
    });

    test('an entry still collides with a DIFFERENT one while renaming', () => {
        const two = [{ id: 'a', name: 'Option A' }, { id: 'b', name: 'Option B' }];
        assert.equal(checkName('option b', { existing: two, exceptId: 'a' }).ok, false,
            'exceptId must exempt only the row being renamed, not disable the rule');
    });

    test('an empty list refuses nothing', () => {
        assert.equal(checkName('Anything', { existing: [] }).ok, true);
        assert.equal(checkName('Anything').ok, true);
    });
});

describe('the two bounds that were already enforced stay enforced', () => {
    test('empty and whitespace-only are refused before anything else', () => {
        for (const n of ['', '   ', '\t', null, undefined]) {
            const r = checkName(/** @type {any} */ (n), { existing: [] });
            assert.equal(r.ok, false);
            assert.equal(r.reason, 'empty', `"${n}" should be refused as empty, not as something else`);
        }
    });

    test('over the Firestore rule\'s 100-character bound', () => {
        const r = checkName('x'.repeat(MAX_DESIGN_NAME + 1), { existing: [] });
        assert.equal(r.reason, 'too-long',
            'the rule rejects it server-side; unchecked it lands in a silent catch and the create '
            + 'appears to do nothing at all');
        assert.equal(checkName('x'.repeat(MAX_DESIGN_NAME), { existing: [] }).ok, true, 'exactly 100 is legal');
    });

    test('length is measured on the TRIMMED name, because that is what is saved', () => {
        assert.equal(checkName('  ' + 'x'.repeat(MAX_DESIGN_NAME) + '  ', { existing: [] }).ok, true);
    });
});

describe('proposeCopyName — the one flow where a new name is the point', () => {
    test('unnumbered first, because that is what a person writes', () => {
        assert.equal(proposeCopyName('Option A', [{ id: 'a', name: 'Option A' }]), 'Option A copy');
    });

    test('numbers only once it has to, and keeps counting', () => {
        const ex = [{ id: 'a', name: 'Option A' }, { id: 'b', name: 'Option A copy' }];
        assert.equal(proposeCopyName('Option A', ex), 'Option A copy 2');
        assert.equal(proposeCopyName('Option A', [...ex, { id: 'c', name: 'Option A copy 2' }]), 'Option A copy 3');
    });

    test('what it proposes is a name checkName would ACCEPT — or the pre-fill is a trap', () => {
        const ex = [{ id: 'a', name: 'Option A' }, { id: 'b', name: 'Option A copy' }];
        const proposed = proposeCopyName('Option A', ex);
        assert.equal(checkName(proposed, { existing: ex }).ok, true,
            'the Duplicate dialog pre-fills this; a pre-filled name that is then refused on Enter '
            + 'is worse than no suggestion');
    });

    test('it never proposes something over the length bound', () => {
        assert.ok(proposeCopyName('y'.repeat(MAX_DESIGN_NAME), []).length <= MAX_DESIGN_NAME);
    });

    test('a blank base still yields a usable name', () => {
        assert.equal(proposeCopyName('', []), 'Design copy');
        assert.equal(proposeCopyName('   ', []), 'Design copy');
    });
});

describe('nameKey / nameConflict — the comparison the two rules share', () => {
    test('the key folds exactly what a reader folds, and nothing else', () => {
        assert.equal(nameKey('  Option   A '), 'option a');
        assert.notEqual(nameKey('Option A'), nameKey('OptionA'),
            'removing spaces entirely would merge two names a reader CAN tell apart');
    });

    test('a blank name conflicts with nothing — empty is its own refusal', () => {
        assert.equal(nameConflict('   ', [{ id: 'a', name: 'Option A' }]), null);
    });

    test('it survives a malformed row rather than throwing', () => {
        const rows = /** @type {any} */ ([null, undefined, {}, { id: 'x' }, { id: 'y', name: 'Option A' }]);
        assert.equal(nameConflict('Option A', rows)?.id, 'y');
    });
});
