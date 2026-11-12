#!/usr/bin/env node
// @ts-check
/**
 * scripts/signed-in.mjs — `npm run test:signed-in`: the signed-in lane, from nothing to a result.
 *
 * The lane runs the app's REAL Firebase SDK against the Auth, Firestore and Functions emulators, under
 * the real security rules and the real Cloud Functions (e2e/signed-in-fixtures.js says why it exists).
 * This script is everything around the browser run, and it writes NOTHING into the checkout:
 *
 *   1. A THROWAWAY FIREBASE PROJECT FOLDER, in the system's temp directory. firebase.json lists no
 *      Auth or Functions emulator, and adding them there would be a release: firebase.json always
 *      deploys, and the version check counts it as served. The Firebase CLI takes its project folder
 *      from wherever its config file sits, and refuses a rules file or functions source outside that
 *      folder — so this one holds a firebase.json BUILT FROM the real one (emulatorConfig in
 *      e2e/signed-in-env.mjs), copies of the rules and indexes it names, and a functions/ folder of
 *      its own: the source files copied, the installed packages linked. The lane can only ever test
 *      what deploys.
 *   2. THE SECRETS, in that functions/ folder's `.secret.local` — the Functions emulator's own place
 *      for them, so nothing is asked of Secret Manager and nothing is written into the checkout. The
 *      names come from the functions' own defineSecret calls, so a new one needs no edit here. The
 *      staff PIN gets four RANDOM digits for this run, handed to the spec as E2E_VIEWER_PIN; the rest
 *      get a placeholder no journey reaches. The real PIN is never read, written or needed: it lives
 *      only in Secret Manager, which a `demo-` project cannot reach.
 *   3. NO PROXY for the emulator session. Everything the lane talks to is on this machine, and the
 *      Firebase CLI sends even its 127.0.0.1 calls through a proxy when one is set, NO_PROXY or not —
 *      the emulators then fail to start with "Unable to parse JSON" (measured in this repository's
 *      cloud sessions, which have one). The cost: behind a proxy, a FIRST run cannot download the
 *      Firestore emulator. Run `npx firebase setup:emulators:firestore` once with the proxy set; every
 *      run after finds it cached.
 *
 * Then `firebase emulators:exec` starts the three emulators and runs this script again INSIDE them
 * (the `--inside` half at the bottom), which makes the roster's accounts the way production does
 * (e2e/signed-in-setup.mjs) and then runs the Playwright command it was given. However that ends,
 * the emulators stop and the temp folder goes.
 *
 * The command is package.json's, in full — `test:signed-in` names e2e/playwright.signed-in.mjs there,
 * where a reader and the workflow checks both see which config the lane runs — and anything after it
 * passes straight through:
 *     npm run test:signed-in -- --project=mobile-chrome -g "first sign-in"
 */
import { spawn } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROJECT, emulatorConfig } from '../e2e/signed-in-env.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIREBASE_CLI = path.join(ROOT, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
const PLAYWRIGHT_CLI = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
const USAGE = 'usage: node scripts/signed-in.mjs playwright test --config=e2e/playwright.signed-in.mjs [options], or npm run test:signed-in';

/** The argument that marks the second, inner run — the one inside the emulator session. */
const INSIDE = '--inside';
/** How the outer run hands the Playwright command to the inner one: JSON in the environment, so no
 *  shell re-reads it on the way through `emulators:exec` (a `-g "two words"` stays one argument). */
const ARGS_VAR = 'SIGNED_IN_PLAYWRIGHT_ARGS';
/** The staff PIN's secret, which the lane must be able to set. */
const PIN_SECRET = 'CALENDAR_VIEWER_PIN';
const PROXY_VARS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'];

/**
 * Run a command to its end.
 * @param {string} command
 * @param {string[]} args
 * @param {import('node:child_process').SpawnOptions} [options]
 * @returns {Promise<number>} its exit code — 1 when a signal ended it
 */
function run(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: 'inherit', ...options });
        child.on('error', reject);
        child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    });
}

/** @param {string} message */
function die(message) {
    console.error(`signed-in lane: ${message}`);
    process.exit(1);
}

/**
 * Every secret the Cloud Functions declare, read from their own `defineSecret('NAME')` calls.
 * @param {string} [functionsDir]
 * @returns {string[]}
 */
export function declaredSecrets(functionsDir = path.join(ROOT, 'functions')) {
    const names = new Set();
    for (const file of readdirSync(functionsDir).filter((f) => f.endsWith('.js'))) {
        const src = readFileSync(path.join(functionsDir, file), 'utf8');
        for (const m of src.matchAll(/defineSecret\(\s*['"]([A-Z0-9_]+)['"]\s*\)/g)) names.add(m[1]);
    }
    return [...names].sort();
}

/**
 * Build the throwaway project folder (header, points 1 and 2).
 * @param {Record<string, string>} secrets  each declared secret's value for this run
 * @returns {{ dir: string, links: string[] }}  the folder, and every link made inside it
 */
function buildProjectFolder(secrets) {
    const config = emulatorConfig(JSON.parse(readFileSync(path.join(ROOT, 'firebase.json'), 'utf8')));
    if (Array.isArray(config.functions) || Array.isArray(config.storage) || Array.isArray(config.firestore)) {
        die('firebase.json now lists more than one functions codebase, bucket or database; teach buildProjectFolder about it');
    }
    const dir = mkdtempSync(path.join(tmpdir(), 'myb-signed-in-'));
    /** @type {string[]} */
    const links = [];
    // The rules and the indexes are COPIED: each is read once, when its emulator starts.
    for (const rel of [config.firestore?.rules, config.firestore?.indexes, config.storage?.rules].filter(Boolean)) {
        mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        copyFileSync(path.join(ROOT, rel), path.join(dir, rel));
    }
    // The functions get a folder of their own, so the secrets file can sit beside them. Each FILE is
    // copied (the source is flat and read at start-up); each FOLDER — node_modules, the installed
    // packages — is LINKED. 'junction' is the kind of link Windows allows without administrator
    // rights; elsewhere the type is ignored.
    const source = path.join(ROOT, config.functions.source);
    const functionsDir = path.join(dir, config.functions.source);
    mkdirSync(functionsDir, { recursive: true });
    for (const entry of readdirSync(source, { withFileTypes: true })) {
        const from = path.join(source, entry.name);
        const to = path.join(functionsDir, entry.name);
        if (entry.isFile()) copyFileSync(from, to);
        else { symlinkSync(realpathSync(from), to, 'junction'); links.push(to); }
    }
    writeFileSync(path.join(functionsDir, '.secret.local'),
        Object.entries(secrets).map(([name, value]) => `${name}=${value}\n`).join(''));
    writeFileSync(path.join(dir, 'firebase.json'), `${JSON.stringify(config, null, 2)}\n`);
    return { dir, links };
}

/**
 * Remove the project folder — every LINK first, one at a time, so nothing can ever recurse through
 * one into the real packages. If a link will not go, the folder is left where it is and named.
 * @param {{ dir: string, links: string[] }} folder
 */
function removeProjectFolder({ dir, links }) {
    for (const link of links) {
        try {
            try { unlinkSync(link); } catch { rmdirSync(link); }   // a Windows junction goes as a directory
        } catch (err) {
            console.error(`signed-in lane: left ${dir} in place — a link inside it would not come away (${/** @type {Error} */ (err).message})`);
            return;
        }
    }
    rmSync(dir, { recursive: true, force: true });
}

/** The outer run: the folder, the secrets, the emulators, and everything put away after. */
async function outer() {
    const command = process.argv.slice(2);
    if (command[0] !== 'playwright') die(USAGE);
    if (!existsSync(FIREBASE_CLI) || !existsSync(PLAYWRIGHT_CLI)) die('the root packages are not installed — run `npm ci` first');
    if (!existsSync(path.join(ROOT, 'functions', 'node_modules'))) {
        die('the Cloud Functions\' packages are not installed, and the Functions emulator cannot load them — run `npm ci --prefix functions` first');
    }
    const secrets = declaredSecrets();
    if (!secrets.includes(PIN_SECRET)) die(`the functions no longer declare ${PIN_SECRET}; the staff PIN journey in e2e/signed-in.spec.js needs the new name`);

    const pin = String(randomInt(0, 10_000)).padStart(4, '0');
    const env = { ...process.env, E2E_VIEWER_PIN: pin, [ARGS_VAR]: JSON.stringify(command.slice(1)) };
    for (const name of PROXY_VARS) delete env[name];

    const folder = buildProjectFolder(Object.fromEntries(
        secrets.map((name) => [name, name === PIN_SECRET ? pin : 'e2e-placeholder-not-a-secret'])));
    // Ctrl-C reaches the emulators too, and they shut down on it; this process waits for them and
    // then tidies up, rather than leaving first. It also remembers the signal, because the Firebase
    // CLI exits 0 after that clean shutdown (measured), and an interrupted run must never read as a
    // pass to whatever comes next — `npm run test:signed-in && git push`, say.
    /** @type {NodeJS.Signals | null} */
    let interrupted = null;
    const note = (/** @type {NodeJS.Signals} */ signal) => { interrupted ??= signal; };
    process.on('SIGINT', note);
    process.on('SIGTERM', note);
    try {
        const code = await run(process.execPath, [
            FIREBASE_CLI, '--config', path.join(folder.dir, 'firebase.json'), '--project', PROJECT,
            'emulators:exec', '--only', 'auth,firestore,functions',
            `node scripts/signed-in.mjs ${INSIDE}`,
        ], { cwd: ROOT, env });
        // The shell's convention: 128 + the signal's number (130 for Ctrl-C, 143 for SIGTERM).
        process.exitCode = interrupted ? 128 + os.constants.signals[interrupted] : code;
    } finally {
        removeProjectFolder(folder);
    }
}

/** The inner run, inside the emulator session: the accounts, then the Playwright command. */
async function inner() {
    const { default: provisionAccounts } = await import('../e2e/signed-in-setup.mjs');
    await provisionAccounts();
    const args = JSON.parse(process.env[ARGS_VAR] || '[]');
    process.exitCode = await run(process.execPath, [PLAYWRIGHT_CLI, ...args], { cwd: ROOT });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await (process.argv[2] === INSIDE ? inner() : outer());
}
