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

describe('pdfjs-dist — the copy the PDF viewer loads is the version the server runs', () => {
    // The in-app PDF viewer (pdf-viewer.js, v25.67) loads PDF.js from pdfjs/ — the legacy build, VENDORED, so no package
    // manager sees it. It is the same library the roster reader pins above, and the same rule holds: one version. Its
    // two files must also agree with EACH OTHER — PDF.js refuses a worker of another version outright, so a library
    // updated without its worker opens no file at all. Moving the pin above without re-vendoring fails here, by design:
    // `npm pack pdfjs-dist@<ver>`, copy legacy/build/pdf.min.mjs and pdf.worker.min.mjs into pdfjs/, then run the
    // viewer's e2e (e2e/newlink.spec.js) in both engines.
    const pinned = ROOT_PKG.devDependencies?.['pdfjs-dist'];
    const found = (/** @type {string} */ f, /** @type {RegExp} */ re) => [...new Set([...read(f).matchAll(re)].map(m => m[1]))];

    test('pdfjs/pdf.min.mjs is the pinned version', () => {
        const lib = found('./pdfjs/pdf.min.mjs', /apiVersion:"(\d+\.\d+\.\d+)"/g);
        assert.deepEqual(lib, [pinned], `pdfjs/pdf.min.mjs is PDF.js ${lib.join(', ') || '(no version found)'}, the pin is ${pinned}`);
    });

    test('pdfjs/pdf.worker.min.mjs is the same version — or the library refuses it', () => {
        const worker = found('./pdfjs/pdf.worker.min.mjs', /apiVersion:\w+\}=\w+,\w+="(\d+\.\d+\.\d+)"/g);
        assert.deepEqual(worker, [pinned],
            `pdfjs/pdf.worker.min.mjs is PDF.js ${worker.join(', ') || '(no version found — a new build may write it differently; read the file and adjust the pattern)'}, the pin is ${pinned}`);
    });
});

describe('firebase — the rules tests run the SDK the app loads', () => {
    // The app loads the Firebase web SDK from gstatic (firebase-client.js), which no package manager
    // sees; the rules tests drive the emulator with the npm `firebase` package, pinned exactly in
    // v25.34 so it would not drift to a release the app had not adopted. Dependabot's weekly bundle
    // was still free to move it (6 Nov 2026 review) and nothing compared the two, so the rules could
    // be proved against one SDK while staff ran another. dependabot.yml now leaves it alone, and this
    // fails the moment either copy moves without the other.
    const root = ROOT_PKG.devDependencies?.firebase;
    const gstatic = [...new Set([...read('./firebase-client.js').matchAll(/gstatic\.com\/firebasejs\/(\d+\.\d+\.\d+)\//g)].map(m => m[1]))];

    test('firebase-client.js loads ONE SDK version, and package.json pins the same one exactly', () => {
        assert.equal(gstatic.length, 1, `firebase-client.js loads ${gstatic.length} SDK versions (${gstatic.join(', ')})`);
        assert.match(String(root), EXACT, `package.json firebase is "${root}" — pin it exactly, or a fresh install tests the rules on a newer SDK`);
        assert.equal(root, gstatic[0],
            `package.json pins firebase ${root} but firebase-client.js loads ${gstatic[0]} — move both together (and FIREBASE_SDK_VERSION in service-worker.js)`);
    });

    test('the lockfile resolves that version', () => {
        assert.equal(ROOT_LOCK.packages?.['node_modules/firebase']?.version, root, 'package-lock.json is stale for firebase');
    });

    test('dependabot leaves it alone, as it does the other hand-moved pins', () => {
        assert.match(read('./.github/dependabot.yml'), /^\s*- dependency-name: "firebase"\s*$/m,
            '.github/dependabot.yml must ignore firebase: a bot bump would move the test SDK off the app\'s');
    });
});
