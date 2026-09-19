/**
 * doc-url-core.test.mjs — the rules behind the short-lived document URL.
 * Run with: node --test doc-url-core.test.mjs   (no mocks; part of test:hygiene)
 *
 * WHY THIS RUNS IN test:hygiene DESPITE LIVING UNDER functions/: `doc-url-core.js` requires
 * nothing, so it loads without `functions/node_modules` — the same reasoning as
 * `overtime-core.test.mjs`. An access rule is too load-bearing to be checked only in the Functions
 * deploy workflow, which fires AFTER a merge.
 *
 * ORGANISED BY WHAT A WRONG ANSWER COSTS:
 *   · too permissive  → this endpoint becomes a way to read a document the Firestore rules refuse,
 *                       which is the exact opposite of what it is for
 *   · caller-named    → a signing endpoint that signs what it is told is an arbitrary-read hole
 *   · window wrong    → too short and a real tap fails; too long and the bound is not a bound
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('./functions/doc-url-core.js');

const RULES = readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');

describe('who may be handed a URL — and it must MIRROR firestore.rules', () => {

    test('the three doors the rules open, and nothing else', () => {
        assert.equal(C.mayReceiveDocumentUrl({ name: 'G. Miller' }), true, 'a member name claim');
        assert.equal(C.mayReceiveDocumentUrl({ admin: true }), true, 'an admin');
        assert.equal(C.mayReceiveDocumentUrl({ calendarViewer: true }), true, 'the staff PIN capability');
        assert.equal(C.mayReceiveDocumentUrl({ manager: true }), false,
            'a manager claim alone is NOT a door in the rules — a manager also carries `name`, and '
            + 'that is what admits them. Granting on `manager` here would make this endpoint more '
            + 'permissive than the read it is standing in for.');
    });

    test('it fails CLOSED on every shape that is not exactly a claim', () => {
        for (const bad of [null, undefined, '', 'admin', 0, 42, [], { }, { name: '' }, { name: 123 }]) {
            assert.equal(C.mayReceiveDocumentUrl(/** @type {any} */ (bad)), false,
                `granted on ${JSON.stringify(bad)}`);
        }
    });

    test('a truthy-but-not-true claim grants nothing, because the rules compare == true', () => {
        for (const v of ['true', 1, 'yes', {}]) {
            assert.equal(C.mayReceiveDocumentUrl({ admin: /** @type {any} */ (v) }), false,
                `admin: ${JSON.stringify(v)} was honoured`);
            assert.equal(C.mayReceiveDocumentUrl({ calendarViewer: /** @type {any} */ (v) }), false,
                `calendarViewer: ${JSON.stringify(v)} was honoured`);
        }
    });

    // ── The parity that stops the two copies drifting ──────────────────────────────────────────
    // Two copies of an access rule is the shape this repo has been bitten by before, so the rule
    // text itself is read rather than remembered. If somebody tightens firestore.rules and forgets
    // this module, the endpoint would go on signing for a caller the rules now refuse — silently,
    // because nothing else compares them.
    test('every document collection still opens on exactly those three doors in firestore.rules', () => {
        for (const collection of ['huddles', 'circulars', 'newsletters']) {
            const m = RULES.match(new RegExp(`match /${collection}/\\{[^}]+\\} \\{([\\s\\S]*?)allow create`));
            assert.ok(m, `could not find the ${collection} block in firestore.rules`);
            const block = m[1].replace(/\/\/[^\n]*/g, '');   // comments explain; they do not grant
            const read = block.match(/allow read:([\s\S]*?);/);
            assert.ok(read, `${collection} has no allow read`);
            const text = read[1];
            assert.match(text, /'name' in request\.auth\.token/, `${collection}: the name door moved`);
            assert.match(text, /request\.auth\.token\.admin == true/, `${collection}: the admin door moved`);
            assert.match(text, /request\.auth\.token\.calendarViewer == true/, `${collection}: the PIN door moved`);
            assert.doesNotMatch(text, /manager/,
                `${collection}'s read rule has gained a manager door. doc-url-core.js refuses `
                + 'managers on purpose — update both together or they disagree.');
        }
    });
});

describe('WHICH document — the caller never names a path', () => {

    test('the three kinds resolve to their server-owned collections', () => {
        assert.deepEqual(C.resolveKind('huddle'), { ok: true, kind: 'huddle', collection: 'huddles', label: 'Huddle' });
        assert.equal(C.resolveKind('circular').collection, 'circulars');
        assert.equal(C.resolveKind('newsletter').collection, 'newsletters');
    });

    test('case and surrounding space are forgiven; anything else is refused', () => {
        assert.equal(C.resolveKind('  HUDDLE  ').ok, true);
        for (const bad of ['huddles', 'circulars/2026-01-01', '../secrets', 'roster', '',
            'hudd', 'huddle;', null, undefined, 7, {}, ['huddle']]) {
            assert.equal(C.resolveKind(/** @type {any} */ (bad)).ok, false,
                `${JSON.stringify(bad)} resolved to something signable`);
        }
    });

    test('a refusal says nothing about the allowlist', () => {
        assert.deepEqual(Object.keys(C.resolveKind('nope')), ['ok'],
            'the refusal carries detail a caller could probe the allowlist with');
    });

    test('the allowlist is frozen — a kind cannot be added at runtime', () => {
        assert.throws(() => { /** @type {any} */ (C.DOC_KINDS).roster = { collection: 'roster' }; },
            'DOC_KINDS is mutable, so a compromised require could widen what this endpoint signs');
    });
});

describe('the body arrives in three shapes, and only one of them is an object', () => {

    // firebase-functions v2 parses req.body ONLY on Content-Type: application/json. Without it the
    // body is a Buffer or a string and `body.kind` is undefined — which resolveKind then refuses as
    // "unknown kind", telling the caller the one thing that is NOT true. Found by review of v24.16
    // before any client depended on it, and probed rather than assumed.
    test('a parsed object, a Buffer and a string all yield the same kind', () => {
        assert.equal(C.kindFromBody({ kind: 'huddle' }), 'huddle');
        assert.equal(C.kindFromBody(Buffer.from('{"kind":"huddle"}')), 'huddle');
        assert.equal(C.kindFromBody('{"kind":"huddle"}'), 'huddle');
    });

    test('nothing usable yields undefined, which resolveKind refuses as it always did', () => {
        for (const bad of [undefined, null, '', Buffer.alloc(0), '{not json', '[]', '"huddle"', 7]) {
            const k = C.kindFromBody(/** @type {any} */ (bad));
            assert.equal(C.resolveKind(k).ok, false, `${JSON.stringify(bad)} produced a signable kind`);
        }
    });

    test('malformed JSON is not a special case — it is just an unusable kind', () => {
        // Deliberate: there is nothing a caller could do differently on being told which of the two
        // it was, and a distinct error would leak how the body is parsed.
        assert.equal(C.kindFromBody('{"kind":'), undefined);
    });

    test('a body naming something outside the allowlist is still refused whatever its shape', () => {
        for (const shape of [{ kind: '../secrets' }, Buffer.from('{"kind":"huddles"}'), '{"kind":"roster"}']) {
            assert.equal(C.resolveKind(C.kindFromBody(/** @type {any} */ (shape))).ok, false,
                'the raw-body fallback widened what this endpoint will sign');
        }
    });
});

describe('HOW LONG — the window has to outlive Microsoft, not the tap', () => {

    test('fifteen minutes, from the clock it is given', () => {
        assert.equal(C.SIGNED_URL_TTL_MS, 15 * 60 * 1000);
        assert.equal(C.signedUrlExpiry(1_000_000), 1_000_000 + C.SIGNED_URL_TTL_MS);
    });

    test('long enough to be useful and short enough to be a bound', () => {
        // Both directions, because each failure is real and they pull opposite ways. A one-minute
        // window would expire between the viewer rendering its button and a member tapping it; a
        // day-long one would not meaningfully improve on "until retention".
        assert.ok(C.SIGNED_URL_TTL_MS >= 5 * 60 * 1000,
            'too short: the chain is mint -> render -> tap -> Microsoft fetches server-side');
        assert.ok(C.SIGNED_URL_TTL_MS <= 60 * 60 * 1000,
            'too long: the whole point of the change is to bound the window');
    });
});

describe('the path is checked even though the server supplies it', () => {

    test('an ordinary storage path signs', () => {
        assert.equal(C.isSignablePath('huddles/2026-09-19-huddle.pdf'), true);
    });

    test('absent, malformed or escaping paths fail CLOSED rather than reaching the signer', () => {
        for (const bad of [undefined, null, '', 7, {}, '/huddles/x.pdf', 'huddles/../secrets/x']) {
            assert.equal(C.isSignablePath(/** @type {any} */ (bad)), false,
                `${JSON.stringify(bad)} would have been signed`);
        }
    });
});
