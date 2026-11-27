// @lane hygiene
/**
 * calendar-viewer-parity.test.mjs — the retired staff PIN stays retired: its STATIC contracts.
 * Run: node scripts/run-tests.mjs test/calendar-viewer-parity.test.mjs   (part of `npm run test:hygiene`)
 *
 * ── THE PIN IS RETIRED (owner, 23 Nov 2026), IN THREE RELEASES ──────────────────────────────────
 *
 * Release 1 (client) took every PIN control out of the app (Contract D). Release 2 (server) deleted
 * the exchange, `unlockCalendarViewer`, its secret binding, and every grant the rules made to its
 * `calendarViewer` claim. The owner then deleted the `calendar-viewer` account, destroyed the secret
 * and purged `viewerAttempts` (26 Nov 2026), and release 3 (cleanup, 27 Nov 2026) removed the last
 * of the transition code: the client's recognition and teardown of a leftover PIN session and the
 * server's refusal to adopt the shared account. Every contract here now pins that they STAY gone.
 *
 * ── CONTRACT A: the rules grant the retired claim nothing ───────────────────────────────────────
 *
 * ── CONTRACT B: the PIN itself never enters the repository, and its secret is bound nowhere ──────
 *
 * The value lived ONLY as the deployed `CALENDAR_VIEWER_PIN` secret, now destroyed. This file cannot
 * check for the value — writing it here would be the leak it is meant to prevent — so it checks the
 * SHAPES a leak would take: a client file naming the secret, a comparison of any kind, a stored
 * verifier, a function binding it.
 *
 * ── CONTRACT C: boot sets persistence one way, for a member ─────────────────────────────────────
 *
 * ── CONTRACT D: nothing asks for, shapes, mints or recognises a PIN session ─────────────────────
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

/** The retired PIN viewer's claim, written here rather than imported: nothing in the app names it now. */
const CALENDAR_VIEWER_CLAIM = 'calendarViewer';

// Tests live in test/ but address files from the repository root (moved 24 Nov 2026).
const REPO_ROOT_URL = new URL('../', import.meta.url);

const read = (/** @type {string} */ f) => readFileSync(new URL(f, REPO_ROOT_URL), 'utf8');
/** Every Cloud Functions source file, by its path from the repository root. */
const functionFiles = readdirSync(new URL('./functions/', REPO_ROOT_URL))
    .filter(f => f.endsWith('.js')).map(f => `functions/${f}`);

describe('Contract A — the rules grant the retired claim nothing', () => {
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
        // deploy window (RECOVERY_RUNBOOK.md → "The staff PIN (retired)"). It is legitimate, and it is
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

// ── CONTRACT C: boot sets persistence ONE way, for a member (cleanup release, 27 Nov 2026) ─────────
//
// Until release 3 the boot asked whether the restored user was the shared viewer and, if so, kept it
// on session-only persistence: `setPersistence` MIGRATES the current user between stores, and an
// unconditional member chain once lifted a restored viewer into IndexedDB (experiments/
// viewer-persistence-proof/). With the account deleted no viewer can be restored, so the branch went.
// What stays pinned is that boot persistence is decided in exactly one place, and that nothing has
// grown a second, session-only path beside the member chain's own last resort.
describe('Contract C — boot persistence is decided once, for a member', () => {
    test('authReady is DERIVED from the one boot initializer', () => {
        const src = read('./firebase-client.js').replace(/\/\/[^\n]*/g, '');
        const line = src.split('\n').find(l => l.includes('export const authReady'));
        assert.ok(line, 'authReady not found');
        assert.match(line, /authBootstrap/,
            'authReady no longer derives from authBootstrap — if it computes persistence itself '
            + 'there are two boot paths');
    });

    test('session-only persistence is set in ONE place: the member chain\'s last resort', () => {
        const src = read('./firebase-client.js').replace(/\/\/[^\n]*/g, '');
        const setters = (src.match(/setPersistence\(auth, browserSessionPersistence\)/g) || []).length;
        assert.equal(setters, 1, `session persistence is set in ${setters} places, not 1. The one is `
            + 'the member chain\'s fallback (_setMemberPersistence), for a browser where neither IndexedDB '
            + 'nor localStorage could be established. A second is a second boot path.');
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
        // The second line is release 3's (27 Nov 2026): the leftover session's recognition and teardown.
        const banned = ['unlockCalendarViewer', 'signInWithCustomToken', 'setViewerPersistence',
            'preserveCalendarViewer', 'holdsStaffPin', 'unlockWithPin', 'lockCalendar', 'calLockPin',
            'isViewerUser', 'CALENDAR_VIEWER_UID', 'shedCalendarViewer', 'letViewerWritesGo', 'staff-pin-ended', 'viewer-shed'];
        /** @type {string[]} */
        const offenders = [];
        for (const f of served) {
            const src = code(f);
            for (const word of banned) if (src.includes(word)) offenders.push(`${f} — ${word}`);
        }
        assert.deepEqual(offenders, [], 'the staff PIN is back in the client:\n  ' + offenders.join('\n  '));
    });

    test('the server no longer recognises the shared account either (release 3)', () => {
        // With the account deleted there is nothing to refuse to adopt. A guard that came back would
        // be a check against an account that cannot exist, kept by nobody.
        /** @type {string[]} */
        const offenders = [];
        for (const f of functionFiles) {
            const src = read('./' + f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s;{}(),])\/\/[^\n]*/g, '$1');
            for (const word of ['isViewerAccount', 'retired-viewer-account', 'viewer-linked']) if (src.includes(word)) offenders.push(`${f} — ${word}`);
        }
        assert.deepEqual(offenders, [], 'the retired viewer account is recognised again:\n  ' + offenders.join('\n  '));
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
