// @ts-check
/**
 * dependency-pin-parity.test.mjs — a library the app loads TWICE must be the same version twice.
 * Run: node --test dependency-pin-parity.test.mjs   (part of `npm run test:hygiene`)
 *
 * Two libraries in this repo are pinned in more than one place, in files that cannot read one
 * another, and until the v24.28 review nothing made the copies agree:
 *
 *  - MAMMOTH converts a Word Huddle to HTML on BOTH sides of the network. `ingestHuddle`
 *    (functions/documents.js) converts the Power Automate upload with the npm package; the admin's
 *    manual upload converts in the browser with the jsdelivr build `huddle.js` injects. One
 *    document, two converters: a version gap means the same .docx renders differently depending
 *    on which door it came through, and a security fix applied to one side leaves the other open
 *    (1.12.2's prototype-pollution fix was exactly that shape). The CDN URL is also written in
 *    `generate-sri.mjs`, which computes the SRI hash — a URL bumped in huddle.js alone keeps the
 *    OLD hash, and the browser then refuses the script.
 *  - PDFJS-DIST reads the roster grid in the Cloud Function and in the root test/tooling tree.
 *    The root copy was a caret range while the function's was exact, so a fresh root install
 *    could test the geometry code against a pdf.js the deploy never runs.
 *
 * Reads source text and package manifests only — no install, no network. The lockfiles are
 * checked too: a manifest bumped without its lockfile installs the old version in CI (`npm ci`
 * refuses the mismatch outright), which is a red build rather than a silent one, but the message
 * here says which file was forgotten.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (/** @type {string} */ f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const json = (/** @type {string} */ f) => JSON.parse(read(f));

const ROOT_PKG = json('./package.json');
const FN_PKG   = json('./functions/package.json');
const ROOT_LOCK = json('./package-lock.json');
const FN_LOCK   = json('./functions/package-lock.json');

const EXACT = /^\d+\.\d+\.\d+$/;

/**
 * Every `mammoth@X.Y.Z/` CDN version written in a source file.
 * @param {string} f
 */
function cdnVersions(f) {
    return [...read(f).matchAll(/cdn\.jsdelivr\.net\/npm\/mammoth@([^/'"\s]+)\//g)].map(m => m[1]);
}

describe('mammoth — one converter version on both sides of the network', () => {
    const server = FN_PKG.dependencies?.mammoth;

    test('the Cloud Function pins mammoth exactly', () => {
        assert.match(String(server), EXACT,
            `functions/package.json mammoth is "${server}" — pin it exactly, or the two converters can drift on a fresh install`);
    });

    test('huddle.js loads the same mammoth version the Cloud Function runs', () => {
        const browser = cdnVersions('./huddle.js');
        assert.equal(browser.length, 1, `expected one mammoth CDN URL in huddle.js, found ${browser.length}`);
        assert.equal(browser[0], server,
            `huddle.js loads mammoth@${browser[0]} but functions/package.json runs ${server} — bump both, then run \`node generate-sri.mjs --apply\``);
    });

    test('generate-sri.mjs hashes the URL huddle.js actually loads', () => {
        const sri = cdnVersions('./generate-sri.mjs');
        assert.equal(sri.length, 1, `expected one mammoth CDN URL in generate-sri.mjs, found ${sri.length}`);
        assert.equal(sri[0], server,
            `generate-sri.mjs hashes mammoth@${sri[0]} but the app uses ${server} — the SRI in huddle.js is for the wrong file`);
    });

    test('the functions lockfile resolves the pinned version', () => {
        assert.equal(FN_LOCK.packages?.['node_modules/mammoth']?.version, server,
            'functions/package-lock.json is stale — run `npm install --package-lock-only` in functions/');
    });
});

describe('pdfjs-dist — the geometry reader is tested on the version it runs on', () => {
    const server = FN_PKG.dependencies?.['pdfjs-dist'];
    const root   = ROOT_PKG.devDependencies?.['pdfjs-dist'];

    test('both manifests pin pdfjs-dist exactly, to the same version', () => {
        assert.match(String(server), EXACT, `functions/package.json pdfjs-dist is "${server}" — pin it exactly`);
        assert.match(String(root), EXACT, `package.json pdfjs-dist is "${root}" — pin it exactly (a caret lets the root drift ahead)`);
        assert.equal(root, server, `package.json pins pdfjs-dist ${root}, functions/package.json ${server}`);
    });

    test('both lockfiles resolve that version', () => {
        assert.equal(ROOT_LOCK.packages?.['node_modules/pdfjs-dist']?.version, root, 'package-lock.json is stale for pdfjs-dist');
        assert.equal(FN_LOCK.packages?.['node_modules/pdfjs-dist']?.version, server, 'functions/package-lock.json is stale for pdfjs-dist');
    });
});
