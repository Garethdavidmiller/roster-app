/**
 * calendar-viewer-parity.test.mjs — the staff-PIN feature's two STATIC contracts.
 * Run: node --test calendar-viewer-parity.test.mjs   (part of `npm run test:hygiene`)
 *
 * ── CONTRACT A: the identity agrees across three languages ──────────────────────────────────────
 *
 * The viewer uid and its claim are written down in three places that cannot import each other:
 * `calendar-access-core.js` (browser ESM), `functions/calendar-viewer-auth.js` (CommonJS — Cloud
 * Functions cannot import browser modules without a build step) and `firestore.rules` (its own
 * language, which imports nothing at all). This is the same boundary `surname-parity.test.mjs`
 * exists for, and the failure mode is worse here: a drifted uid mints a token the rules do not
 * recognise, so the PIN is accepted, the sign-in succeeds, and every override read is then denied.
 * The member sees an unlocked Calendar with no shifts on it and no error anywhere.
 *
 * ── CONTRACT B: the PIN itself never enters the repository ──────────────────────────────────────
 *
 * The value lives ONLY as the deployed `CALENDAR_VIEWER_PIN` secret. This file cannot check for the
 * value — writing it here would be the leak it is meant to prevent — so it checks the SHAPES a leak
 * would take: a client file naming the secret, a client-side comparison of any kind, or a stored
 * verifier the browser could test offline. A four-digit space is small enough that a hash shipped
 * to the browser is not a protection, it is a ten-thousand-iteration loop.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { CALENDAR_VIEWER_UID, CALENDAR_VIEWER_CLAIM, PIN_LENGTH } from './calendar-access-core.js';

const require = createRequire(import.meta.url);
const read = (/** @type {string} */ f) => readFileSync(new URL(f, import.meta.url), 'utf8');

describe('Contract A — one identity, three languages', () => {
    test('the Cloud Function helper agrees on the viewer uid', () => {
        const fn = require('./functions/calendar-viewer-auth.js');
        assert.equal(fn.CALENDAR_VIEWER_UID, CALENDAR_VIEWER_UID,
            'the browser and the Cloud Function disagree about which account the PIN signs into');
        assert.equal(fn.PIN_LENGTH, PIN_LENGTH);
    });

    test('the Cloud Function mints exactly the claim the client verifies', () => {
        const fn = require('./functions/calendar-viewer-auth.js');
        assert.equal(fn.viewerClaims()[CALENDAR_VIEWER_CLAIM], true,
            'the minted token would not carry the claim calendar-access.js checks for');
    });

    test('firestore.rules reads the SAME claim, on the overrides collection', () => {
        const rules = read('./firestore.rules');
        // Comments are stripped first, deliberately: this file's own header discusses the claim at
        // length, and a guard satisfied by prose is not a guard.
        const code = rules.replace(/\/\/[^\n]*/g, '');
        assert.ok(code.includes(`request.auth.token.${CALENDAR_VIEWER_CLAIM}`),
            `firestore.rules never reads \`${CALENDAR_VIEWER_CLAIM}\` — the minted token would grant nothing`);
    });

    test('the overrides READ rule requires an identity — and the HOLD is declared in both places', () => {
        const rules = read('./firestore.rules').replace(/\/\/[^\n]*/g, '');
        const block = rules.slice(rules.indexOf('match /overrides/'), rules.indexOf('match /huddles/'));
        assert.ok(block.length > 200, 'could not locate the overrides block — this test is checking nothing');

        // ── THE HOLD, CHECKED STATICALLY (v20.16) ────────────────────────────────────────────
        //
        // A bare `allow read;` above the tightened rule holds the collection public during the
        // deploy window (RECOVERY_RUNBOOK.md → "The Calendar PIN"). It is legitimate, and it is
        // also the single most dangerous line in this file — it makes the staff PIN guard a door
        // that is open, and it looks like documentation of a rule rather than a rule.
        //
        // So it is allowed only when firestore.rules.test.mjs DECLARES it. That file's constant is
        // what its own three read tests assert against, so declaring it there means the emulator
        // suite proves the hold is real; checking it from here means `npm test` — which runs with
        // no emulator, on every branch — fails the moment the two disagree in either direction.
        // Removing the hold is therefore two edits that must land together, and forgetting either
        // one is loud rather than silent.
        const held = /const OVERRIDES_READ_HELD_OPEN\s*=\s*true\b/
            .test(read('./firestore.rules.test.mjs'));
        const open = /allow read;/.test(block);
        assert.equal(open, held, open
            ? 'overrides read is public and nothing declares it — the staff PIN would be guarding a door that is open'
            : 'firestore.rules.test.mjs still declares OVERRIDES_READ_HELD_OPEN = true, but the hold line is gone — its read tests now assert the wrong outcome');

        assert.match(block, /allow read: if request\.auth != null/,
            'the overrides read rule must require an authenticated identity');
        assert.ok(block.includes(`request.auth.token.${CALENDAR_VIEWER_CLAIM} == true`),
            'the viewer capability is not accepted for override reads — the PIN would unlock nothing');
        assert.ok(block.includes("'name' in request.auth.token"),
            'a real member would be denied override reads');
    });

    test('the viewer is NOT granted a write anywhere in the rules', () => {
        // Scoped to write verbs specifically. A `calendarViewer` mentioned in an `allow create` /
        // `update` / `delete` would be a capability escalation, whichever collection it appeared in.
        const rules = read('./firestore.rules').replace(/\/\/[^\n]*/g, '');
        // Split on `allow` so each permission clause is examined on its own.
        const clauses = rules.split(/\ballow\s+/).slice(1);
        for (const c of clauses) {
            const verbs = c.slice(0, c.indexOf(':'));
            if (!/create|update|write|delete/.test(verbs)) continue;
            const body = c.slice(c.indexOf(':'), c.indexOf(';') + 1);
            if (!body.includes(CALENDAR_VIEWER_CLAIM)) continue;
            // The ONE legal appearance in a write clause is a DENIAL (`!= true`).
            assert.match(body, new RegExp(`${CALENDAR_VIEWER_CLAIM}\\s*!=\\s*true`),
                `a write clause (allow ${verbs.trim()}) grants something to the viewer:\n${body}`);
        }
    });

    test('the throttle store is closed to every client', () => {
        const rules = read('./firestore.rules').replace(/\/\/[^\n]*/g, '');
        const i = rules.indexOf('match /viewerAttempts/');
        assert.ok(i > -1, 'the viewerAttempts block is missing — the throttle state would be client-visible');
        // Slice from the block's OPENING brace, not from `indexOf('{', i)` — that finds the `{` of
        // the `{sourceKey}` wildcard in the match path, and the block would come back as one line.
        const open  = rules.indexOf('{', rules.indexOf('}', i));
        const block = rules.slice(open, rules.indexOf('}', open) + 1);
        assert.match(block, /allow read, write: if false;/,
            'a client that can READ this paces itself under the limit; one that can WRITE it clears its own count');
    });
});

describe('Contract B — the PIN is not in the repository', () => {
    /** Everything served to a browser. `functions/` is excluded: that is where the secret is
     *  legitimately READ (never stored), which is the whole design. */
    const clientFiles = readdirSync(new URL('.', import.meta.url))
        .filter(f => /\.(js|mjs|html|css)$/.test(f))
        .filter(f => !f.includes('.test.'));

    /**
     * The same files PLUS the test suites (v21.27).
     *
     * ── WHY THIS EXISTS: THE EXCLUSION ABOVE IS WHERE A LEAK ACTUALLY LANDED ────────────────────
     *
     * `clientFiles` skips `*.test.*` because a test may legitimately name the parameter while
     * exercising the shape rule. That exemption was reasonable and it was also the blind spot: the
     * live PIN reached the repository inside `calendar-viewer-auth.test.mjs`, as a set of malformed
     * fixtures written as near-misses of it — a truncation, a spaced form, and it with a trailing
     * keystroke. Each is individually harmless and together they reconstruct the secret, and the
     * one guard built to prevent exactly this was not looking at the file.
     *
     * This file still CANNOT check for the value — writing it here would be the leak. What it can
     * do is stop a test becoming a verifier or a comparison, which is the shape a deliberate leak
     * takes, and keep the exemption to the one thing it was for.
     */
    // THIS FILE IS EXCLUDED FROM ITS OWN SCAN: it necessarily contains every banned pattern,
    // because listing them is what it does. A guard that flags itself reports nothing useful and
    // trains the next reader to ignore it.
    const SELF = 'calendar-viewer-parity.test.mjs';
    const testFiles = readdirSync(new URL('.', import.meta.url))
        .filter(f => /\.test\.mjs$/.test(f)).filter(f => f !== SELF);

    test('no client file names the secret parameter', () => {
        // The browser has no business knowing the secret's NAME either: the only way a client could
        // use it is by having its value, and a reference is the first step of putting one there.
        const offenders = clientFiles.filter(f => read('./' + f).includes('CALENDAR_VIEWER_PIN'));
        assert.deepEqual(offenders, [],
            'these client files reference the server secret:\n  ' + offenders.join('\n  '));
    });

    test('no client file holds a comparable PIN verifier', () => {
        // The shapes a leak would take. A hash is called out explicitly because it FEELS safe and is
        // not: four digits is 10,000 candidates, so a hash in the bundle is an offline brute force
        // that needs no network and leaves no trace in any log.
        const banned = [
            /EXPECTED_PIN/i,
            /PIN_HASH/i,
            /CORRECT_PIN/i,
            /VALID_PIN\b/i,
            // A literal comparison against the field's value — `pin === '1234'` in any spelling.
            /\bpin\s*={2,3}\s*['"][0-9]{3,}['"]/i,
            /['"][0-9]{4}['"]\s*={2,3}\s*\w*pin/i,
        ];
        /** @type {string[]} */
        const offenders = [];
        for (const f of clientFiles) {
            const src = read('./' + f);
            for (const re of banned) if (re.test(src)) offenders.push(`${f} — matched ${re}`);
        }
        assert.deepEqual(offenders, [],
            'a client-side PIN check turns a 10,000-space secret into an offline brute force:\n  '
            + offenders.join('\n  '));
    });

    test('and NO TEST FILE holds one either (v21.27)', () => {
        // The exemption above is for naming the parameter, nothing more. A test that stores a
        // verifier, a hash or a literal comparison is the same leak as a client that does, and it
        // is the file class the live PIN actually reached.
        const banned = [/EXPECTED_PIN/i, /PIN_HASH/i, /CORRECT_PIN/i, /VALID_PIN\b/i];
        /** @type {string[]} */
        const offenders = [];
        for (const f of testFiles) {
            const src = read('./' + f);
            for (const re of banned) if (re.test(src)) offenders.push(`${f} — matched ${re}`);
        }
        assert.deepEqual(offenders, [], 'a test file holds a PIN verifier:\n  ' + offenders.join('\n  '));
    });

    // ── A GUARD THAT WAS TRIED AND DELIBERATELY NOT SHIPPED (v21.27) ────────────────────────────
    //
    // The leak this file failed to catch was three malformed fixtures — a truncation, a spaced form
    // and a trailing-keystroke form — that together reconstructed the live PIN. The obvious guard is
    // to flag a CLUSTER of digit fixtures sharing a stem, and it was written and run.
    //
    // It cannot be made precise. A suite that reuses ONE obviously-fake PIN throughout (which is
    // good practice, and what this repo does) clusters on its stem exactly as a real one written
    // three ways does: the measured counts here were 13 and 18 for entirely innocent fixtures. The
    // only way to separate them is to know the real value, which is the thing that must not be here.
    //
    // So it was dropped rather than exempted. A guard with an exemption list for its false positives
    // is one people learn to silence, and this repo has that lesson written down in three other
    // places. What protects the secret instead: the verifier scan above now covers test files, the
    // fixtures in calendar-viewer-auth.test.mjs carry a comment saying why they are invented, and
    // the value itself must be ROTATED — removing it from the working tree leaves it in git history.

    test('the client sends the PIN to the server and does nothing else with it', () => {
        const src = read('./calendar-access.js');
        assert.ok(src.includes('unlockCalendarViewer'), 'the client no longer calls the exchange endpoint');
        // No storage of the entered value, in any of the app's storage wrappers or the raw APIs.
        for (const sink of ['lsSet(', 'localStorage.setItem', 'sessionStorage.setItem']) {
            const idx = src.indexOf(sink);
            assert.equal(idx, -1, `calendar-access.js writes to ${sink} — the PIN must never be stored`);
        }
    });

    test('the Cloud Function READS the secret and never logs or returns it', () => {
        const src = read('./functions/index.js');
        const i = src.indexOf('exports.unlockCalendarViewer');
        assert.ok(i > -1, 'the unlockCalendarViewer function is missing');
        const fn = src.slice(i);
        assert.ok(fn.includes('CALENDAR_VIEWER_PIN.value()'), 'the handler does not read the secret parameter');
        assert.ok(src.includes("defineSecret('CALENDAR_VIEWER_PIN')"),
            'the secret must be bound with defineSecret, not read from the environment');
        assert.ok(/secrets:\s*\[CALENDAR_VIEWER_PIN\]/.test(fn),
            'the function declaration does not BIND the secret — .value() would be empty at runtime');
        // Nothing that could carry the candidate into a log line or a response body.
        for (const line of fn.split('\n')) {
            if (!/console\.(log|warn|error)|res\.json|res\.send/.test(line)) continue;
            assert.doesNotMatch(line, /\bsupplied\b|\bbody\.pin\b|\breq\.body\b/,
                `this line could put the submitted PIN into a log or a response:\n${line.trim()}`);
        }
    });

    test('the documentation tells the developer to set it INTERACTIVELY', () => {
        // A doc that records the value is the same leak as a source file that does. The instruction
        // has to exist somewhere a future maintainer will look before deploying.
        const docs = ['./OPERATIONS_REFERENCE.md', './CLAUDE.md'].map(read).join('\n');
        assert.match(docs, /functions:secrets:set CALENDAR_VIEWER_PIN/,
            'no doc explains how to set the PIN without committing it');
    });

    test('no repository file contains a bare four-digit PIN assignment for this feature', () => {
        // Deliberately narrow: it looks for an ASSIGNMENT of a four-digit literal to something
        // PIN-named, which is what an accidental commit would look like. A broad "no four-digit
        // numbers anywhere" scan would fire on years, pixel values and version strings, and a guard
        // that cries wolf acquires an exemption list, which is how a guard stops guarding.
        /** @type {string[]} */
        const offenders = [];
        const all = [...clientFiles, 'functions/index.js', 'functions/calendar-viewer-auth.js'];
        for (const f of all) {
            const src = read('./' + f);
            const re = /\b\w*[Pp][Ii][Nn]\w*\s*[:=]\s*['"`]?[0-9]{4}['"`]?/g;
            for (const m of src.matchAll(re)) {
                // `PIN_LENGTH = 4` and friends are single digits; this only matches four.
                offenders.push(`${f}: ${m[0]}`);
            }
        }
        assert.deepEqual(offenders, [],
            'a four-digit PIN value looks to be committed:\n  ' + offenders.join('\n  '));
    });
});

// ── CONTRACT C: boot may not promote the viewer into long-lived persistence ─────────────────────
//
// `setPersistence` MIGRATES the current user between stores, and `authReady` runs at module init on
// every page — so an unconditional member chain there lifts a restored viewer out of sessionStorage
// into IndexedDB, where it survives the browser closing. That happened: one ordinary reload of an
// unlocked Calendar made the shared viewer permanent on that machine, and the next person at the PC
// got the roster with no PIN. Measured in a real Chromium against the Auth emulator —
// experiments/viewer-persistence-proof/ has the harness, both arms, and the storage dumps.
//
// No unit or e2e test can see this: unit suites mock the SDK, the e2e stubs it, and the property
// only exists across a genuine browser exit. So the executable proof lives in the experiment, and
// this contract pins the SHAPE of the fix — the boot initializer consults `isViewerUser` before any
// persistence is applied. A shape check is weaker than a behaviour check and is what is available;
// if it fails, re-run the experiment before deciding the new shape is safe.
describe('Contract C — boot persistence is viewer-aware', () => {
    test('firebase-client consults isViewerUser inside the authReady initializer', () => {
        const src = read('./firebase-client.js').replace(/\/\/[^\n]*/g, '');
        assert.match(src, /import \{ isViewerUser \} from '\.\/calendar-access-core\.js'/,
            'firebase-client.js no longer imports the ONE viewer predicate — a second local copy '
            + 'would be a second place a bypass could be introduced');
        const at = src.indexOf('export const authReady');
        assert.ok(at > -1, 'authReady not found — this contract is checking nothing');
        // The initializer is the async IIFE the export is assigned; take a bounded slice of it.
        const body = src.slice(at, at + 900);
        assert.ok(body.includes('isViewerUser('),
            'authReady applies persistence without asking whether the restored user is the shared '
            + 'viewer — the exact shape that migrated it into IndexedDB (see the experiment)');
        assert.ok(body.includes('browserSessionPersistence'),
            'authReady has no session-persistence branch for the viewer — a restored viewer must '
            + 'KEEP session-only persistence, or re-assert it to migrate back out of IndexedDB');
    });
});
