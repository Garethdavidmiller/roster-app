/**
 * calendar-viewer-parity.test.mjs — the staff-PIN feature's STATIC contracts, through its retirement.
 * Run: node scripts/run-tests.mjs test/calendar-viewer-parity.test.mjs   (part of `npm run test:hygiene`)
 *
 * ── THE PIN IS RETIRED (owner, 23 Nov 2026), IN THREE RELEASES ──────────────────────────────────
 *
 * Release 1 (client) took every PIN control out of the app (Contract D). Release 2 (server) deleted
 * the exchange, `unlockCalendarViewer`, its secret binding, and every grant the rules made to its
 * `calendarViewer` claim (Contracts A and B now pin that they STAY gone). What is left until the
 * cleanup release is the client's recognition of a leftover PIN session — its uid, claim and boot
 * plumbing, so a browser still holding one is torn down safely (Contract C) — and the server's
 * refusal to adopt the shared account (functions/retired-viewer-account.js), until the owner deletes it.
 *
 * ── CONTRACT A: the identity agrees across the boundary, and the rules grant it nothing ──────────
 *
 * The viewer uid and its claim are written down where the two halves cannot import each other:
 * `calendar-access-core.js` (browser ESM) and `functions/retired-viewer-account.js` (CommonJS — Cloud
 * Functions cannot import browser modules without a build step). They must still agree, or the client
 * would miss a leftover session the server refuses to adopt, or the reverse. `firestore.rules` used to
 * be the third copy; since the server release it must not mention the claim at all.
 *
 * ── CONTRACT B: the PIN itself never enters the repository, and its secret is bound nowhere ──────
 *
 * The value lived ONLY as the deployed `CALENDAR_VIEWER_PIN` secret, which the owner destroys after
 * the server release. This file cannot check for the value — writing it here would be the leak it is
 * meant to prevent — so it checks the SHAPES a leak would take: a client file naming the secret, a
 * comparison of any kind, a stored verifier — and, since the server release, a function binding it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { CALENDAR_VIEWER_UID, CALENDAR_VIEWER_CLAIM } from '../calendar-access-core.js';

// Tests live in test/ but address files from the repository root (moved 24 Nov 2026).
const REPO_ROOT_URL = new URL('../', import.meta.url);

const require = createRequire(REPO_ROOT_URL);
const read = (/** @type {string} */ f) => readFileSync(new URL(f, REPO_ROOT_URL), 'utf8');
/** Every Cloud Functions source file, by its path from the repository root. */
const functionFiles = readdirSync(new URL('./functions/', REPO_ROOT_URL))
    .filter(f => f.endsWith('.js')).map(f => `functions/${f}`);

describe('Contract A — one identity across the boundary, and the rules grant it nothing', () => {
    test('the server recognises the same uid the client tears down', () => {
        const fn = require('./functions/retired-viewer-account.js');
        assert.equal(fn.CALENDAR_VIEWER_UID, CALENDAR_VIEWER_UID,
            'the browser and the Cloud Functions disagree about which account the retired PIN signed into');
    });

    test('the server recognises the account by the same claim the client checks', () => {
        const { isViewerAccount } = require('./functions/retired-viewer-account.js');
        assert.equal(isViewerAccount({ uid: 'some-other-uid', customClaims: { [CALENDAR_VIEWER_CLAIM]: true } }), true,
            `the server no longer recognises an account carrying \`${CALENDAR_VIEWER_CLAIM}\` — Set up accounts could adopt it`);
        assert.equal(isViewerAccount({ uid: 'some-other-uid', customClaims: { name: 'A. Member' } }), false,
            'guard the guard: an ordinary account is not the viewer');
    });

    test('firestore.rules and storage.rules no longer read the claim anywhere (the server release)', () => {
        // Comments are stripped first, deliberately: both files' headers tell the claim's history, and
        // a guard tripped by prose is a guard people learn to ignore.
        for (const file of ['./firestore.rules', './storage.rules']) {
            const code = read(file).replace(/\/\/[^\n]*/g, '');
            assert.ok(!code.includes(CALENDAR_VIEWER_CLAIM) && !code.includes('isCalendarViewer'),
                `${file} reads \`${CALENDAR_VIEWER_CLAIM}\` again — a leftover PIN session would be granted something`);
        }
    });

    test('the overrides READ rule requires an identity — and the HOLD is declared in both places', () => {
        const rules = read('./firestore.rules').replace(/\/\/[^\n]*/g, '');
        const block = rules.slice(rules.indexOf('match /overrides/'), rules.indexOf('match /huddles/'));
        assert.ok(block.length > 200, 'could not locate the overrides block — this test is checking nothing');

        // ── THE HOLD, CHECKED STATICALLY (v20.16) ────────────────────────────────────────────
        //
        // A bare `allow read;` above the tightened rule held the collection public during the
        // deploy window (RECOVERY_RUNBOOK.md → "The Calendar PIN"). It is legitimate, and it is
        // also the single most dangerous line in that file — it makes the read rule a door that is
        // open, and it looks like documentation of a rule rather than a rule.
        //
        // So it is allowed only when firestore.rules.test.mjs DECLARES it. That file's constant is
        // what its own three read tests assert against, so declaring it there means the emulator
        // suite proves the hold is real; checking it from here means `npm test` — which runs with
        // no emulator, on every branch — fails the moment the two disagree in either direction.
        const held = /const OVERRIDES_READ_HELD_OPEN\s*=\s*true\b/
            .test(read('./test/firestore.rules.test.mjs'));
        const open = /allow read;/.test(block);
        assert.equal(open, held, open
            ? 'overrides read is public and nothing declares it'
            : 'firestore.rules.test.mjs still declares OVERRIDES_READ_HELD_OPEN = true, but the hold line is gone — its read tests now assert the wrong outcome');

        assert.match(block, /allow read: if request\.auth != null/,
            'the overrides read rule must require an authenticated identity');
        // isMember(), not a bare `'name' in token` (v24.23): Firebase copies a SELF-SET display name
        // into `name`, so the bare check admitted an anonymous session that named itself a member.
        assert.ok(block.includes('isMember()'), 'a real member would be denied override reads');
        assert.ok(!block.includes("'name' in request.auth.token"),
            'a bare name claim is a door again — any session can set its own display name');
    });

    test('the retired throttle store has no rule of its own — refused to every client by default', () => {
        // Its block (`allow read, write: if false`) went with its only writer in the server release.
        // An unmatched path refuses every client; a block that came back could only open it.
        const rules = read('./firestore.rules').replace(/\/\/[^\n]*/g, '');
        assert.ok(!rules.includes('match /viewerAttempts/'),
            'a viewerAttempts block is back — nothing writes it, and the owner purges it');
    });
});

describe('Contract B — the PIN is not in the repository', () => {
    /** Everything served to a browser. `functions/` is excluded: that is where the secret is
     *  legitimately READ (never stored), which is the whole design. */
    const clientFiles = readdirSync(new URL('.', REPO_ROOT_URL))
        .filter(f => /\.(js|mjs|html|css)$/.test(f))
        .filter(f => !f.includes('.test.'));

    /**
     * The same files PLUS the test suites (v21.27).
     *
     * ── WHY THIS EXISTS: THE EXCLUSION ABOVE IS WHERE A LEAK ACTUALLY LANDED ────────────────────
     *
     * `clientFiles` skips `*.test.*` because a test may legitimately name the parameter while
     * exercising the shape rule. That exemption was reasonable and it was also the blind spot: the
     * live PIN reached the repository inside `calendar-viewer-auth.test.mjs` (deleted with the PIN's
     * server release), as a set of malformed
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
    const testFiles = readdirSync(new URL('./test/', REPO_ROOT_URL))
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
            const src = read('./test/' + f);
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
    // places. What protects the secret instead: the verifier scan above covers test files, and the
    // value itself must be DESTROYED — removing it from the working tree leaves it in git history,
    // which is why the PIN was rotated then and its secret is destroyed now.

    test('no Cloud Function exchanges a PIN or binds its secret any more (the server release)', () => {
        // A function that bound CALENDAR_VIEWER_PIN would make every Functions deploy resolve a secret
        // the owner has destroyed — failing the WHOLE deploy — and one that exported the exchange
        // would bring the PIN back for whoever found the URL. Comments may tell the history.
        /** @type {string[]} */
        const offenders = [];
        for (const f of functionFiles) {
            const code = read('./' + f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s;{}(),])\/\/[^\n]*/g, '$1');
            if (code.includes('CALENDAR_VIEWER_PIN')) offenders.push(`${f} — names the secret`);
            if (/exports\.unlockCalendarViewer|unlockCalendarViewer\s*[:=]/.test(code)) offenders.push(`${f} — defines the exchange`);
        }
        assert.deepEqual(offenders, [], 'the staff PIN is back on the server:\n  ' + offenders.join('\n  '));
    });

    test('the documentation tells the owner to DESTROY the secret', () => {
        // The secret outlives the code that read it until somebody removes it, and a secret nothing
        // reads is a secret nobody rotates. The instruction has to be where the owner will look.
        assert.match(read('./docs/OPERATIONS_REFERENCE.md'), /functions:secrets:destroy CALENDAR_VIEWER_PIN/,
            'no doc tells the owner how to destroy the retired PIN\'s secret');
    });

    test('no repository file contains a bare four-digit PIN assignment for this feature', () => {
        // Deliberately narrow: it looks for an ASSIGNMENT of a four-digit literal to something
        // PIN-named, which is what an accidental commit would look like. A broad "no four-digit
        // numbers anywhere" scan would fire on years, pixel values and version strings, and a guard
        // that cries wolf acquires an exemption list, which is how a guard stops guarding.
        /** @type {string[]} */
        const offenders = [];
        const all = [...clientFiles, ...functionFiles];
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
    test('the boot initializer consults isViewerUser before applying persistence', () => {
        const src = read('./firebase-client.js').replace(/\/\/[^\n]*/g, '');
        assert.match(src, /import \{ isViewerUser \} from '\.\/calendar-access-core\.js'/,
            'firebase-client.js no longer imports the ONE viewer predicate — a second local copy '
            + 'would be a second place a bypass could be introduced');
        // `authBootstrap` since v21.29 (it was `authReady`, which now derives from it). The name
        // moved because the boot restore gained a second consumer; the PROPERTY did not move, so
        // this contract follows the initializer rather than the old export.
        const at = src.indexOf('export const authBootstrap');
        assert.ok(at > -1, 'the boot initializer was not found — this contract is checking nothing');
        // The initializer is the async IIFE the export is assigned; take a bounded slice of it.
        const body = src.slice(at, at + 900);
        assert.ok(body.includes('isViewerUser('),
            'the boot applies persistence without asking whether the restored user is the shared '
            + 'viewer — the exact shape that migrated it into IndexedDB (see the experiment)');
        assert.ok(body.includes('browserSessionPersistence'),
            'the boot has no session-persistence branch for the viewer — a restored viewer must '
            + 'KEEP session-only persistence, or re-assert it to migrate back out of IndexedDB');
        // The 8s emission bound is not the end of the restore. Past it the user is still being
        // restored, and the member chain's setPersistence — queued behind that same restore — then
        // MIGRATES whoever arrives, the shared viewer included (reproduced against the SDK's browser
        // build with a slow accounts:lookup, Sep 2026). So a timed-out answer must be re-asked
        // after Auth has initialised, BEFORE the viewer question is put to it.
        const ready = body.indexOf('authStateReady(');
        assert.ok(ready > -1 && ready < body.indexOf('isViewerUser('),
            'a boot whose first auth emission timed out decides persistence without waiting for '
            + 'the restore — a viewer restored after the bound is migrated into IndexedDB');
    });

    test('authReady is DERIVED — boot persistence is decided in exactly one place', () => {
        // Added with the v21.29 bootstrap split, because that split is precisely how a SECOND
        // persistence path gets introduced: `authReady` and `authBootstrap` both look like
        // reasonable places to set it, and a copy in the second one would be viewer-unaware while
        // every test above kept passing against the first.
        const src = read('./firebase-client.js').replace(/\/\/[^\n]*/g, '');
        const line = src.split('\n').find(l => l.includes('export const authReady'));
        assert.ok(line, 'authReady not found');
        assert.match(line, /authBootstrap/,
            'authReady no longer derives from authBootstrap — if it computes persistence itself '
            + 'there are two boot paths, and only one of them is covered by the contract above');
        // TWO legitimate places since the staff PIN left the client (23 Nov 2026 — `setViewerPersistence`,
        // the unlock's own switch, went with it), and naming them is the point — a bare count would be
        // satisfied by swapping one for another. The member chain's own last-resort fallback is one of
        // them, which is easy to forget: it lands a MEMBER on session persistence when neither IndexedDB
        // nor localStorage could be established, and that is a degraded member session, not a viewer.
        const setters = (src.match(/setPersistence\(auth, browserSessionPersistence\)/g) || []).length;
        assert.equal(setters, 2, `boot session-persistence is set in ${setters} places, not 2. The `
            + 'two are: the member chain\'s last-resort fallback (_setMemberPersistence) and the '
            + 'viewer branch of authBootstrap. A THIRD is the thing this guards — the shared viewer '
            + 'must not acquire a second, viewer-unaware boot path, nor the client a way to mint one.');
    });
});

// ── CONTRACT D: NO CLIENT FILE ASKS FOR, SHAPES OR EXCHANGES A PIN (owner, 23 Nov 2026) ─────────────
//
// The staff PIN is retired from the app, and since the server release the exchange is gone too
// (Contract B). These shapes are what bringing it back to the client would take. `functions/` is the
// server's and is scanned by Contract B.
describe('Contract D — the client no longer has a PIN', () => {
    const served = readdirSync(new URL('.', REPO_ROOT_URL))
        .filter(f => /\.(js|mjs|html)$/.test(f)).filter(f => !f.includes('.test.'));
    /** A served file with its comments taken out: the history may name what went, the code may not.
     *  Block comments, whole-line `//` comments, a trailing `// …` after code, and HTML comments. */
    const code = (/** @type {string} */ f) => read('./' + f).replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[\s;{}(),])\/\/[^\n]*/g, '$1').replace(/<!--[\s\S]*?-->/g, '');

    test('no served file calls the exchange, mints a viewer session or switches to its persistence', () => {
        const banned = ['unlockCalendarViewer', 'signInWithCustomToken', 'setViewerPersistence',
            'preserveCalendarViewer', 'holdsStaffPin', 'unlockWithPin', 'lockCalendar', 'calLockPin'];
        /** @type {string[]} */
        const offenders = [];
        for (const f of served) {
            const src = code(f);
            for (const word of banned) if (src.includes(word)) offenders.push(`${f} — ${word}`);
        }
        assert.deepEqual(offenders, [], 'the staff PIN is back in the client:\n  ' + offenders.join('\n  '));
    });

    test('no screen offers the PIN: its links, its card and its menu button are gone from every served file', () => {
        // Words a reader would see. Code comments may still tell the history; these are the strings
        // that were controls or copy.
        const banned = ['Use the staff PIN instead', 'Sign out and use the staff PIN', 'End staff PIN</',
            'Unlock Calendar', 'enter the staff PIN', 'Enter the staff PIN', 'Staff PIN access'];
        /** @type {string[]} */
        const offenders = [];
        for (const f of served) {
            const src = code(f);
            for (const word of banned) if (src.includes(word)) offenders.push(`${f} — "${word}"`);
        }
        assert.deepEqual(offenders, [], 'a screen still offers the staff PIN:\n  ' + offenders.join('\n  '));
    });
});
