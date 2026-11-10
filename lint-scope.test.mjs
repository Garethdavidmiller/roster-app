// lint-scope.test.mjs — each file is linted in the environment it actually RUNS in.
//
// For the Cloud Functions and the service worker the lint lane is the only mechanical check (neither
// is type-checked), and it was looser than the places the code runs: every file inherited the
// browser's globals, so `status`, `name`, `event` or `document` in a Function linted clean and
// failed in production as a ReferenceError; the worker was linted at `ecmaVersion: 'latest'` while
// the app is held to 2022, so syntax an older supported iPhone cannot parse passed; and the five
// classic page scripts were linted as modules, so an `import` in one passed and was a SyntaxError
// on the page (whole-app check, 10 November 2026). This lints probe snippets through ESLint's own
// API against the real eslint.config.js. Part of test:hygiene; skips where ESLint is not installed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

/** Every page script loaded by a plain `<script src>` — no `type`, so a classic script — read from the pages. */
const CLASSIC = [...new Set(readdirSync(ROOT).filter(f => f.endsWith('.html'))
    .flatMap(f => [...readFileSync(`${ROOT}${f}`, 'utf8').matchAll(/<script\b(?![^>]*\btype=)[^>]*\bsrc="\.\/([^"/]+\.js)"/g)]
        .map(m => m[1])))].sort();
/** @type {any} */
let eslint = null;
try {
    const { ESLint } = await import('eslint');
    eslint = new ESLint({ cwd: ROOT });
} catch { /* not installed: every test below skips, saying so */ }
const skip = eslint ? false : 'eslint is not installed here (npm install) — the lint scope was not checked';

/** Lint `code` as though it were the file at `path`; return its messages. */
async function lint(/** @type {string} */ path, /** @type {string} */ code) {
    const [result] = await eslint.lintText(code, { filePath: `${ROOT}${path}` });
    return /** @type {{ ruleId: string | null, message: string, fatal?: boolean }[]} */ (result.messages);
}
const undefinedNames = (/** @type {any[]} */ msgs) =>
    msgs.filter(m => m.ruleId === 'no-undef').map(m => /'([^']+)'/.exec(m.message)?.[1]).sort();

// Page globals that Node does not define (`localStorage` is not one: Node has an experimental one).
const BROWSER_ONLY = ['document', 'name', 'status', 'window'];
const USES_THEM = `export const probe = () => [${BROWSER_ONLY.join(', ')}];\n`;

test('a browser-only global is UNDEFINED where the code never runs in a page', { skip }, async () => {
    for (const path of ['functions/zz-lint-probe.js', 'scripts/zz-lint-probe.mjs', 'generate-sri.mjs', 'eslint.config.js']) {
        const code = path.startsWith('functions/') ? USES_THEM.replace('export const probe =', 'module.exports =') : USES_THEM;
        assert.deepEqual(undefinedNames(await lint(path, code)), BROWSER_ONLY,
            `${path}: a browser global linted clean in code that runs in Node`);
    }
    const worker = await lint('service-worker.js', 'self.probe = () => [document, localStorage];\n');
    assert.deepEqual(undefinedNames(worker), ['document', 'localStorage'], 'the worker has a worker\'s globals, not a page\'s');
});

test('…and still DEFINED in the app\'s own modules and in the tests', { skip }, async () => {
    assert.deepEqual(undefinedNames(await lint('zz-lint-probe.js', USES_THEM)), [], 'an app module lost the browser globals');
    const t = await lint('zz-lint-probe.test.mjs', 'export const probe = () => [document, process.env];\n');
    assert.deepEqual(undefinedNames(t), [], 'a test lost its node + browser globals');
});

test('the service worker is held to the app\'s ES2022, not to whatever is newest', { skip }, async () => {
    // The ES2024 `v` flag (Safari 17). Syntax cannot be feature-detected: on an iPhone that cannot
    // parse it, the new worker never installs and the phone stops taking updates.
    const msgs = await lint('service-worker.js', 'self.re = /[\\p{L}--[a-z]]/v;\n');
    assert.ok(msgs.some(m => m.fatal), 'a regex with the ES2024 v flag parsed in the worker');
});

test('every classic page script is linted as a SCRIPT: an import in one is an error', { skip }, async () => {
    // Read from the pages, so a sixth classic script fails here until eslint.config.js lists it.
    assert.ok(CLASSIC.length >= 5 && CLASSIC.includes('guide-back.js'), `the page scan found only ${CLASSIC.join(', ')}`);
    const code = "import { lsGet } from './ls.js';\nlsGet('x');\n";
    for (const path of CLASSIC) {
        assert.ok((await lint(path, code)).some(m => m.fatal),
            `${path} is loaded by a plain <script>, yet an import linted clean — add it to CLASSIC_SCRIPTS in eslint.config.js`);
    }
    assert.ok(!(await lint('zz-lint-probe.js', code)).some(m => m.fatal), 'and an app MODULE may still import');
});
