// @ts-check
/**
 * storage-key-parity.test.mjs — a cross-file storage key has ONE spelling, and it is in
 * `storage-keys.js` (v23.46).
 *
 * `storage-keys.js` has stated its rule since v16.81 — *"Only keys shared by more than one module
 * live here … a one-character key typo silently loses staff data with no error, so every shared key
 * having ONE spelling is a real safety property, not just tidiness"* — and nothing checked it. Two
 * keys were in breach when this was written, both found by reading rather than by a failure:
 * `myb_team_view` was three bare literals in three modules, `myb_notif_prompt_done` four in two.
 * Neither had drifted. That is the whole problem with catching this by eye: the state a reviewer
 * sees is the state before the bug, and the bug is a rename in one file.
 *
 * **The failure is silent in both directions, and the second one is worse than lost data.**
 * `lsGet` on a key nobody writes returns `null`; `null === '1'` is `false`; so a drifted reader does
 * not throw, it answers NO. For `myb_team_view` one of those readers is `calendar-access.js`, which
 * REFUSES the provisional paint while Team View is on (CALENDAR_DATA.md invariant 13, because a
 * provisional grant is scoped to one member and Team View draws everybody). A rename in the writer
 * would leave that refusal silently not refusing.
 *
 * THREE CONTRACTS:
 *   1. a key literal in two or more source modules is declared in `storage-keys.js`
 *   2. a key `storage-keys.js` declares appears as a bare literal in no other module
 *   3. a key declared there is genuinely cross-file — it earns its place
 *
 * Contract 2 is not implied by contract 1: the half-migration (two modules import the constant, a
 * third keeps its literal) satisfies 1 and is exactly the state `myb_notif_prompt_done` was in.
 *
 * **SCOPE, and why the exclusions are deliberate rather than convenient.**
 *   · The paycalc namespace is exempt BY THE FILE'S OWN INSTRUCTION — every `myb_pc_…` key is built
 *     by `pcPrefix()` in paycalc-migrations.js, which is already a single source, and storage-keys.js
 *     says in as many words: *"do NOT add those here"*.
 *   · Tests and e2e specs are exempt, and this is the load-bearing exclusion. `calendar-access.test.mjs`
 *     hardcodes `'myb_team_view'`, and it SHOULD: a test that imported the constant would follow a
 *     rename and stay green through it, which is the drift it exists to catch. An independent
 *     restatement in a test is a pin, not a copy.
 *   · Comments are stripped first. Half the matches in this tree are prose ABOUT a key — including
 *     three that name a declared key correctly — and a guard that fired on them would acquire an
 *     exemption list and stop guarding, the failure mode `hosting-ignore-parity` and
 *     `app-name-parity` both record.
 *   · `functions/` is out of scope: no localStorage on a server.
 *
 * Part of `npm run test:hygiene`. Teeth-verified — see the guard-the-guard test at the foot.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const KEYS_FILE = 'storage-keys.js';

/** The app's own prefix. A key without it is not one of ours (`adminLastMember` is the one legacy
 *  exception, and it is reached through the declaration list rather than by scanning). */
const KEY_PATTERN = /myb_[a-z0-9_]*/g;

/** Built by `pcPrefix()` in paycalc-migrations.js — storage-keys.js excludes these by name. */
const NAMESPACED = 'myb_pc_';

/** Declared but read by ONE module, with the reason. Contract 3 asks for a reason, not for zero
 *  exceptions — a read-only legacy fallback is a real shape and refusing it would only move the
 *  key back to a bare literal, which is worse. */
const SINGLE_CONSUMER_OK = {
    SELECTED_MEMBER_LEGACY: 'pre-v16.81 alias, no longer written — a READ fallback in admin-app.js only',
};

/** Comments are documentation, not use. Both forms, and the `//` case guards the `://` in a URL. */
function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

function sourceModules() {
    return readdirSync('.')
        .filter(f => f.endsWith('.js') && !f.endsWith('.test.js') && f !== KEYS_FILE)
        .sort();
}

/** key → the modules whose CODE contains it. */
function literalsByKey(files = sourceModules()) {
    const found = new Map();
    for (const file of files) {
        const code = stripComments(readFileSync(file, 'utf8'));
        for (const [key] of code.matchAll(KEY_PATTERN)) {
            if (key.startsWith(NAMESPACED)) continue;
            if (!found.has(key)) found.set(key, new Set());
            found.get(key).add(file);
        }
    }
    return found;
}

/** The declarations, as `{ constant, key }`. */
function declaredKeys() {
    const src = readFileSync(KEYS_FILE, 'utf8');
    return [...src.matchAll(/export const (\w+)\s*=\s*'([^']+)'/g)]
        .map(m => ({ constant: m[1], key: m[2] }));
}

test('a storage key used by two or more modules is declared in storage-keys.js', () => {
    const declared = new Set(declaredKeys().map(d => d.key));
    const shared = [...literalsByKey()]
        .filter(([key, files]) => files.size > 1 && !declared.has(key))
        .map(([key, files]) => `  ${key} — ${[...files].sort().join(', ')}`);

    assert.deepEqual(shared, [],
        'these keys are spelled out in more than one module and declared nowhere.\n' +
        'Move each to storage-keys.js and import it — a rename in one writer is silent:\n' +
        shared.join('\n'));
});

test('a key storage-keys.js declares is written out longhand nowhere else', () => {
    const offenders = [];
    const files = sourceModules();
    for (const { constant, key } of declaredKeys()) {
        for (const file of files) {
            if (stripComments(readFileSync(file, 'utf8')).includes(key)) {
                offenders.push(`  ${file} spells out '${key}' — import ${constant} from ./storage-keys.js`);
            }
        }
    }
    assert.deepEqual(offenders, [],
        'a declared key is ALSO a bare literal, which is the half-migration:\n' + offenders.join('\n'));
});

test('every key in storage-keys.js is genuinely cross-file', () => {
    const files = sourceModules();
    const stranded = [];
    for (const { constant } of declaredKeys()) {
        if (constant in SINGLE_CONSUMER_OK) continue;
        const users = files.filter(f => new RegExp(`\\b${constant}\\b`).test(readFileSync(f, 'utf8')));
        if (users.length < 2) {
            stranded.push(`  ${constant} — read by ${users.length === 0 ? 'nothing' : users[0]}`);
        }
    }
    assert.deepEqual(stranded, [],
        'storage-keys.js holds only keys shared by more than one module. These are not:\n' +
        stranded.join('\n') +
        '\nEither move the key back into its one module, or name it in SINGLE_CONSUMER_OK with why.');
});

// ── guard the guard ──────────────────────────────────────────────────────────
//
// The two defects this was written for are FIXED, so the contracts above pass on a tree that has
// nothing to find — which is the state in which a guard with no teeth is indistinguishable from a
// guard that works. So the fixtures reconstruct both, and the same functions must reject them.
//
// Its first cut did not: `stripComments` ran on the SCANNED file but the fixtures were passed as
// raw strings, so a fixture reproducing a comment mention would have been caught while the real
// defect (code) went through the same path untested. The fixtures now go through the real reader,
// against files written to a temp directory, for the reason CLAUDE.md gives under "the rule tested,
// the wiring not" — a perfect helper called with the wrong argument.

test('the guard catches the two defects that motivated it — guard the guard', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const dir = mkdtempSync(join(tmpdir(), 'storage-key-parity-'));
    const write = (name, body) => { writeFileSync(join(dir, name), body); return join(dir, name); };

    // The real v23.45 state of myb_team_view: three modules, three literals, no declaration.
    const teamView = [
        write('a.js', `export const x = lsGet('myb_team_view') === '1';`),
        write('b.js', `lsSet('myb_team_view', on ? '1' : '');`),
        write('c.js', `const t = lsGet('myb_team_view');`),
    ];
    const found = literalsByKey(teamView);
    assert.equal(found.get('myb_team_view')?.size, 3,
        'the reader no longer sees a key repeated across three modules — contract 1 has no teeth');

    // The half-migration: two modules import the constant, one keeps the literal. Contract 1 is
    // satisfied here (the key IS declared), which is why contract 2 exists.
    const half = [write('d.js', `import { NOTIF_PROMPT_DONE } from './storage-keys.js';`),
                  write('e.js', `lsSet('myb_notif_prompt_done', '1');`)];
    const stillBare = half.filter(f => stripComments(readFileSync(f, 'utf8')).includes('myb_notif_prompt_done'));
    assert.deepEqual(stillBare.map(f => f.endsWith('e.js')), [true],
        'a declared key left as a bare literal in one module is no longer seen — contract 2 has no teeth');

    // And the exclusions do exclude: a comment naming a key, and the paycalc namespace.
    const excluded = [write('f.js', `// myb_team_view is read at boot\nconst k = \`\${pcPrefix()}myb_pc_rate\`;`)];
    assert.deepEqual([...literalsByKey(excluded).keys()], [],
        'the guard now fires on prose or on the paycalc namespace — it will acquire exemptions and stop guarding');
});
