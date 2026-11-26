#!/usr/bin/env node
// @ts-check
/**
 * generate-copies.mjs — `npm run generate:copies` — WRITE the facts this repo keeps in more than one
 * file, from the one place each is edited.
 *
 * ── WHY ────────────────────────────────────────────────────────────────────────────────────────
 *
 * The app has no build step (CLAUDE.md → "No bundler"), so a fact two files need is written in both,
 * and a "parity" test used to fail when somebody edited one and forgot the other. That catches the
 * drift after the fact and still leaves a human to make every copy by hand. Where a script can write
 * the second copy, it now does: the copy cannot drift, and there is one place to edit. This is the
 * pattern `npm run generate:roster-members` and `npm run generate:ai-map` already follow — the
 * output is COMMITTED, nothing runs at deploy or in the browser, and a test fails, naming this
 * command, when the committed output is not what this script would write now.
 *
 * ── WHAT IT WRITES, AND FROM WHERE ─────────────────────────────────────────────────────────────
 *
 * Each entry in COPIES below is one fact. Its function is handed `read(path)` — the file as it is
 * now — and returns every file it owns with its whole new content. Most own a REGION of a
 * hand-written file, and leave everything else in that file byte-for-byte alone.
 *
 *   csp-meta   every served page's <meta http-equiv="Content-Security-Policy">, from the
 *              Content-Security-Policy HEADER in firebase.json, minus the directives a <meta> CSP
 *              cannot carry. The GitHub Pages mirror serves no headers, so the <meta> is the only
 *              policy it applies (csp-meta-parity.test.mjs said why; now this file does).
 *
 *   module-preloads
 *              every app page's <link rel="modulepreload"> tags, between its GENERATED markers: the
 *              Firebase SDK modules firebase-client.js imports statically, at the version it pins
 *              (every page), then — for a page whose scripts/app-pages.mjs entry says `preloads` —
 *              its whole local static import graph. Without the hints the browser discovers modules
 *              in a waterfall, one level at a time (each page's comment above its preloads). They
 *              were hand-kept lists of up to ninety lines that sw-asset-check.test.mjs held to the graph.
 *
 *   sdk-version
 *              `FIREBASE_SDK_VERSION` in service-worker.js — the name of the worker's SDK cache — from
 *              the version firebase-client.js imports. A worker on the old name would warm the old
 *              SDK's files while every page imports the new one's.
 *
 *   sw-app-files
 *              `APP_FILES` in service-worker.js — every app page, the stylesheets it links, and every
 *              local module it can load: its static imports, its `import('./…')` calls and its
 *              <script src>, walked from each scripts/app-pages.mjs entry — minus what
 *              SUPPLEMENTARY_ASSETS lists (the guides' files and DOMPurify, warmed after the core).
 *              Both the network-first match set and the core precache spread it. The modules were
 *              two hand-kept lists until 25 Nov 2026, and every merge of two branches that each added
 *              one conflicted in them; the pages and their stylesheets joined on 26 Nov 2026. One file
 *              per line, sorted, so two such branches seldom touch the same line.
 *
 *   rules-page-ids
 *              the first line of `pvCountIds()` in firestore.rules — one analytics id per app page,
 *              each page's `id` in scripts/app-pages.mjs. A page missing there counted nothing, and
 *              the refused write was silent. The document and guide ids on the lines below it stay
 *              hand-written: firestore-contract-parity.test.mjs holds them to NAV_GUIDES and the openers.
 *
 *   guide-back
 *              `DESTINATIONS` in guide-back.js — the pages a guide's ← may return to, each page's file
 *              from scripts/app-pages.mjs and its name from the drawer (`pageName`, nav-destinations.js).
 *              Still a FIXED list in the file, because it is the allowlist that stops `?from=` naming
 *              somewhere else; written here, it can no longer fall a page behind, as it did Overtime.
 *   welcome-emails
 *              the four ready-made welcome emails in .claude/skills/new-starter/ (one per grade a
 *              colleague signs in under), below each one's own hand-written header, from the general
 *              template welcome-email.html with that grade's either/or choices made. Not served.
 *              welcome-email-parity.test.mjs holds the RULES the copies follow.
 *
 * ── RUNNING IT ─────────────────────────────────────────────────────────────────────────────────
 *
 *   npm run generate:copies     writes whatever is out of date, and names each file it wrote
 *
 * A changed SERVED file (an .html, .js or .css the app serves) still needs a version bump, exactly
 * as a hand edit would (CLAUDE.md → "Version bumping").
 *
 * Checked by generated-copies.test.mjs (CI) and by githooks/pre-commit (the commit, as staged).
 * Importing this module writes nothing; only running it as a script does.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { APP_PAGES, servedFiles } from './app-pages.mjs';
import { gradeForRole } from '../roster-data.js';
import { NAV_PAGES, pageName } from '../nav-destinations.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @typedef {(path: string) => string} Reader */
/** @typedef {Array<[file: string, content: string]>} Owned */

/**
 * Replace the ONE match of `re` in `src`, or throw saying which file has changed shape. A pattern
 * that matched nothing would leave the copy unwritten and the check green, so a miss is an error.
 * @param {string} src @param {RegExp} re @param {(m: RegExpMatchArray) => string} by @param {string} file @param {string} what
 */
function replaceOne(src, re, by, file, what) {
    const all = [...src.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))];
    if (all.length !== 1) {
        throw new Error(`${file}: expected ONE ${what}, found ${all.length} — generate-copies.mjs cannot place the copy`);
    }
    const m = all[0];
    const at = /** @type {number} */ (m.index);
    return src.slice(0, at) + by(m) + src.slice(at + m[0].length);
}

// ── csp-meta ────────────────────────────────────────────────────────────────────────────────────

/** Directives a <meta http-equiv="Content-Security-Policy"> cannot express: browsers ignore them
 *  there, so writing them would imply a protection the mirror does not get. */
export const META_INCOMPATIBLE = Object.freeze(['frame-ancestors', 'report-uri', 'report-to', 'sandbox']);

/** The firebase.json Content-Security-Policy header value. @param {Reader} read */
export function headerCsp(read) {
    const fb = JSON.parse(read('firebase.json'));
    for (const h of fb.hosting?.headers ?? [])
        for (const kv of h.headers ?? [])
            if (kv.key === 'Content-Security-Policy') return String(kv.value);
    throw new Error('firebase.json: no Content-Security-Policy header to copy');
}

/** The header with the meta-incompatible directives taken out, every other byte kept.
 *  @param {string} header */
export function metaCspFor(header) {
    if (header.includes('"')) throw new Error('firebase.json: the CSP header holds a double quote, which would end the <meta> attribute');
    return header.split(';').map(s => s.trim()).filter(Boolean)
        .filter(d => !META_INCOMPATIBLE.includes(d.split(/\s+/)[0].toLowerCase()))
        .map(d => `${d};`).join(' ');
}

const CSP_COMMENT = '<!-- CSP mirrors the firebase.json header so the GitHub Pages mirror (which cannot serve HTTP headers) '
    + 'gets the same policy, and the CSP travels with the HTML through the SW cache. GENERATED: edit the header in '
    + 'firebase.json and run npm run generate:copies, never this line. -->';

/** @param {Reader} read @returns {Owned} */
function cspMeta(read) {
    const meta = metaCspFor(headerCsp(read));
    return servedFiles().map(file => {
        const src = read(file);
        const count = (src.match(/http-equiv=["']Content-Security-Policy["']/gi) || []).length;
        if (count !== 1) throw new Error(`${file}: carries ${count} CSP <meta> tags, not one`);
        // The comment line above the tag is part of the copy: it is what tells an editor not to edit.
        const out = replaceOne(src,
            /^([ \t]*)<!-- CSP mirrors the firebase\.json header[^\n]*-->\n([ \t]*)<meta http-equiv="Content-Security-Policy" content="[^"]*">/m,
            m => `${m[1]}${CSP_COMMENT}\n${m[2]}<meta http-equiv="Content-Security-Policy" content="${meta}">`,
            file, 'CSP comment line followed by its <meta> tag');
        return /** @type {[string, string]} */ ([file, out]);
    });
}

// ── module-preloads and sdk-version ─────────────────────────────────────────────────────────────

/**
 * The ONE Firebase SDK version firebase-client.js imports, and the SDK modules it imports STATICALLY
 * (`from '…'`). A dynamic `import('…')` — firebase-storage, lazy on purpose — has no `from`, so it is
 * never preloaded. Sorted, so the tags do not move when an import line does.
 * @param {Reader} read @returns {{ version: string, modules: string[] }}
 */
export function firebaseSdk(read) {
    const client = read('firebase-client.js');
    const versions = [...new Set([...client.matchAll(/gstatic\.com\/firebasejs\/([\d.]+)\//g)].map(m => m[1]))];
    if (versions.length !== 1) throw new Error(`firebase-client.js imports ${versions.length} Firebase SDK versions (${versions.join(', ')}), not one`);
    const modules = [...new Set([...client.matchAll(/\bfrom\s*['"]https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/(firebase-[a-z]+)\.js['"]/g)].map(m => m[1]))].sort();
    if (!modules.length) throw new Error('firebase-client.js imports no Firebase SDK module statically — the reading is wrong');
    return { version: versions[0], modules };
}

/**
 * The transitive set of LOCAL (`./`) static module deps reachable from `entry`, the entry included.
 * Comments are stripped first: a path written in a JSDoc ("re-exported from './foo.js'") would
 * otherwise add a phantom module. `://` is kept so a URL is not mangled. A file that cannot be read
 * is a module that does not exist, and the page's own import of it fails louder than this would.
 * @param {Reader} read @param {string} entry @returns {Set<string>}
 */
export function staticLocalGraph(read, entry) {
    const seen = new Set();
    /** @param {string} file */
    const walk = (file) => {
        if (seen.has(file)) return;
        seen.add(file);
        let src;
        try { src = read(file); } catch { return; }
        src = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
        const deps = [
            ...[...src.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map(m => m[1]),       // import … from / export … from, multi-line too
            ...[...src.matchAll(/^\s*import\s*["']([^"']+)["']/gm)].map(m => m[1]),  // side-effect imports
        ];
        for (const p of deps) if (p.startsWith('./')) walk(p.slice(2));
    };
    walk(entry);
    return seen;
}

/** The local modules a page preloads: its graph from the module the HTML loads, minus a boot shim
 *  (the script tag itself, already being fetched), `.js` only. Sorted.
 *  @param {Reader} read @param {import('./app-pages.mjs').AppPage} page */
export function localPreloads(read, page) {
    const graph = staticLocalGraph(read, page.boot ?? page.coordinator);
    if (page.boot) graph.delete(page.boot);
    return [...graph].filter(f => f.endsWith('.js')).sort();
}

const PRELOADS_BEGIN = '<!-- GENERATED module preloads: npm run generate:copies writes every line down to the END marker, '
    + 'from firebase-client.js and this page\'s imports. Never edit them by hand. -->';
const PRELOADS_END = '<!-- END GENERATED module preloads -->';

/** @param {Reader} read @returns {Owned} */
function modulePreloads(read) {
    const { version, modules } = firebaseSdk(read);
    const sdk = modules.map(m => `<link rel="modulepreload" href="https://www.gstatic.com/firebasejs/${version}/${m}.js" crossorigin>`);
    return APP_PAGES.map(page => {
        const tags = [...sdk, ...(page.preloads ? localPreloads(read, page).map(f => `<link rel="modulepreload" href="./${f}">`) : [])];
        const out = replaceOne(read(page.file),
            /^([ \t]*)<!-- GENERATED module preloads[^\n]*-->\n[\s\S]*?^[ \t]*<!-- END GENERATED module preloads -->/m,
            m => [PRELOADS_BEGIN, ...tags, PRELOADS_END].map(l => m[1] + l).join('\n'),
            page.file, 'GENERATED module preloads region');
        // A hint outside the markers is a hand-kept list again, checked by nothing.
        const all = (out.match(/rel="modulepreload"/g) || []).length;
        if (all !== tags.length) {
            throw new Error(`${page.file}: ${all - tags.length} <link rel="modulepreload"> outside its GENERATED region — `
                + 'delete it, or set `preloads` on the page in scripts/app-pages.mjs');
        }
        return /** @type {[string, string]} */ ([page.file, out]);
    });
}

/** @param {Reader} read @returns {Owned} */
function sdkVersion(read) {
    const { version } = firebaseSdk(read);
    const out = replaceOne(read('service-worker.js'), /^const FIREBASE_SDK_VERSION = '[^']*';[^\n]*$/m,
        () => `const FIREBASE_SDK_VERSION = '${version}'; // GENERATED from firebase-client.js by npm run generate:copies`,
        'service-worker.js', 'FIREBASE_SDK_VERSION declaration');
    return [['service-worker.js', out]];
}

// ── sw-app-files ────────────────────────────────────────────────────────────────────────────────

/** The LIVE body of `const <name> = [ … ];` in the worker, comments removed. @param {string} sw @param {string} name */
function workerArray(sw, name) {
    const m = new RegExp(`const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`).exec(sw);
    if (!m) throw new Error(`service-worker.js has no \`const ${name} = [ … ];\` — the reading is wrong`);
    return m[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Every local module an app page can load, sorted: the static graph (`staticLocalGraph`) widened to
 * `import('./…')` calls and to the page's own <script src>. A computed `import(url)` cannot be read —
 * PDF.js's folder and the Firebase Storage SDK are the two, and neither is an app module.
 * @param {Reader} read @returns {string[]}
 */
export function appModules(read) {
    const seen = new Set();
    /** @param {string} file */
    const walk = (file) => {
        if (seen.has(file)) return;
        let src;
        try { src = read(file); } catch { return; }
        seen.add(file);
        src = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
        const deps = [
            ...[...src.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map(m => m[1]),
            ...[...src.matchAll(/^\s*import\s*["']([^"']+)["']/gm)].map(m => m[1]),
            ...[...src.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map(m => m[1]),
        ];
        for (const p of deps) if (p.startsWith('./') && /\.m?js$/.test(p)) walk(p.slice(2));
    };
    for (const page of APP_PAGES) {
        walk(page.coordinator);
        if (page.boot) walk(page.boot);
        for (const m of read(page.file).matchAll(/<script[^>]*\bsrc="\.\/([^"]+\.m?js)"/g)) walk(m[1]);
    }
    return [...seen].sort();
}

/**
 * Every app page, the stylesheets it links and every local module it can load, sorted.
 * @param {Reader} read @returns {string[]}
 */
export function appFiles(read) {
    const files = new Set(appModules(read));
    for (const page of APP_PAGES) {
        files.add(page.file);
        for (const m of read(page.file).matchAll(/<link rel="stylesheet" href="(?:\.\/)?([^"]+\.css)"/g)) files.add(m[1]);
    }
    return [...files].sort();
}

const SW_FILES_BEGIN = '// GENERATED app files: npm run generate:copies writes every line down to the END marker, from each '
    + 'app page, its stylesheets and its imports (scripts/app-pages.mjs). Never edit them by hand.';
const SW_FILES_END = '// END GENERATED app files';

/** @param {Reader} read @returns {Owned} */
function swAppFiles(read) {
    const sw = read('service-worker.js');
    const later = new Set([...workerArray(sw, 'SUPPLEMENTARY_ASSETS').matchAll(/["']\.\/([^"']+)["']/g)].map(m => m[1]));
    const files = appFiles(read).filter(f => !later.has(f));
    const out = replaceOne(sw,
        /^\/\/ GENERATED app (?:modules|files)[^\n]*\n[\s\S]*?^\/\/ END GENERATED app (?:modules|files)$/m,
        () => [SW_FILES_BEGIN, 'const APP_FILES = [', ...files.map(f => `    '${f}',`), '];', SW_FILES_END].join('\n'),
        'service-worker.js', 'GENERATED app files region');
    return [['service-worker.js', out]];
}

// ── rules-page-ids ──────────────────────────────────────────────────────────────────────────────

/** @param {Reader} read @returns {Owned} */
function rulesPageIds(read) {
    const rules = read('firestore.rules');
    const out = replaceOne(rules, /(function pvCountIds\(\) \{\n\s*return \[)[^\n]*\n/,
        (m) => `${m[1]}${APP_PAGES.map(p => `'${p.id}'`).join(', ')},\n`,
        'firestore.rules', 'the first line of pvCountIds()');
    return [['firestore.rules', out]];
}

// ── guide-back ──────────────────────────────────────────────────────────────────────────────────

/**
 * The back arrow's words for one page: "Back to <name>" — the Calendar lower-case, as the guides have
 * always called it ("Back to calendar").
 * @param {string} id @returns {string}
 */
export function backLabel(id) {
    const nav = NAV_PAGES.find(p => p.id === id);
    if (!nav) throw new Error(`guide-back: app page '${id}' has no NAV_PAGES entry to take its name from`);
    return `Back to ${id === 'calendar' ? 'calendar' : pageName(nav)}`;
}

/** @param {Reader} read @returns {Owned} */
function guideBack(read) {
    const src = read('guide-back.js');
    const rows = APP_PAGES.map(p => `        ${`'${p.file}':`.padEnd(18)} { href: ${`'.${p.url === '/' ? '/' : p.url}',`.padEnd(20)} label: '${backLabel(p.id)}' },`);
    const out = replaceOne(src, /(var DESTINATIONS = \{\n)[\s\S]*?(\n {4}\};)/,
        (m) => `${m[1]}${rows.join('\n')}${m[2]}`, 'guide-back.js', 'DESTINATIONS');
    return [['guide-back.js', out]];
}

// ── welcome-emails ──────────────────────────────────────────────────────────────────────────────

/** Where the welcome emails live: the general template and its ready-made copies. */
export const WELCOME_DIR = '.claude/skills/new-starter/';
export const WELCOME_TEMPLATE = 'welcome-email.html';
/** Each ready-made copy, and the grade it is for: the label the sign-in list shows. */
export const WELCOME_COPIES = Object.freeze({
    'welcome-email-cea.html':         'CEA',
    'welcome-email-ces.html':         'CES',
    'welcome-email-dispatcher.html':  'Dispatcher',
    'welcome-email-other-staff.html': 'Other Staff',
});
/** The grade whose login has no roster of its own (roster-member-data.js → `otherStaff`). */
export const OTHER_STAFF = 'Other Staff';

/**
 * Replace the ONE match of `re`, or throw saying the general template has changed shape, which is a
 * change to this script as much as to the template.
 * @param {string} html @param {RegExp} re @param {string} by @param {string} what
 */
function templateOnce(html, re, by, what) {
    const found = html.match(new RegExp(re.source, 'g')) || [];
    if (found.length !== 1) {
        throw new Error(`${WELCOME_TEMPLATE} should have ONE ${what} in the form generate-copies.mjs reads, and has `
            + `${found.length}. If its either/or blocks were reworked, update chooseWelcomeEmail to match.`);
    }
    return html.replace(re, by);
}

/**
 * The general template with one grade's choices made: the opening for somebody already working at
 * Marylebone, the grade, What it does, and the Pay Calculator section the app says that grade gets
 * — none at all for Other Staff, whose menu has no calculator. Which section a grade gets is
 * `gradeForRole` (roster-data.js), the question the Pay Calculator asks before it shows a figure, so
 * the day Dispatcher rates are added the Dispatcher email stops telling them to ignore it.
 * Comments are left in: welcomeBody takes out the template's own.
 * @param {string} template @param {string} grade @param {(role: string) => unknown} gradeForRole
 */
export function chooseWelcomeEmail(template, grade, gradeForRole) {
    let html = template;
    const other = grade === OTHER_STAFF;
    // The opening: the new starter's paragraph goes (everything from its marker to the next one's),
    // and the chosen one, written inside a comment, comes out of it; the third goes whole.
    html = templateOnce(html, /<!-- OPENING A — NEW STARTER -->[\s\S]*?(?=<!-- OPENING B — EXISTING STAFF)/, '',
        'OPENING A (new starter) block');
    html = templateOnce(html, /<!-- OPENING B — EXISTING STAFF\s*([\s\S]*?)\s*-->/, other ? '' : '$1',
        'OPENING B (existing staff) block');
    html = templateOnce(html, /<!-- OPENING C — OTHER STAFF[^\n]*\s*([\s\S]*?)\s*-->/, other ? '$1' : '',
        'OPENING C (Other Staff) block');
    // What it does: a member's own roster (A, written live), or the station's (B, inside a comment).
    if (other) {
        html = templateOnce(html, /<!-- WHAT IT DOES A — WITH A ROSTER[\s\S]*?(?=<!-- WHAT IT DOES B — OTHER STAFF)/, '',
            'WHAT IT DOES A (with a roster) block');
        html = templateOnce(html, /<!-- WHAT IT DOES B — OTHER STAFF[^\n]*\s*([\s\S]*?)\s*-->/, '$1',
            'WHAT IT DOES B (Other Staff) block');
        // Section 4, heading and both variants: the Pay Calculator is not in their menu.
        html = templateOnce(html, /<!-- ── 4\. PAY CALCULATOR[\s\S]*?(?=<!-- ── SIGN OFF)/, '',
            'section 4 (the Pay Calculator), heading to sign-off');
        return html.replaceAll('{{GRADE}}', grade);
    }
    html = templateOnce(html, /<!-- WHAT IT DOES B — OTHER STAFF[\s\S]*?-->/, '',
        'WHAT IT DOES B (Other Staff) block');
    if (gradeForRole(grade)) {
        html = templateOnce(html, /<!-- VARIANT B — DISPATCHER[\s\S]*?-->/, '',
            'Pay Calculator VARIANT B (it will not work for you) block');
    } else {
        html = templateOnce(html, /<!-- VARIANT A — CEA and CES -->[\s\S]*?(?=<!-- VARIANT B — DISPATCHER)/, '',
            'Pay Calculator VARIANT A (it works for you) block');
        html = templateOnce(html, /<!-- VARIANT B — DISPATCHER\s*([\s\S]*?)\s*-->/, '$1',
            'Pay Calculator VARIANT B (it will not work for you) block');
    }
    return html.replaceAll('{{GRADE}}', grade);
}

/**
 * What a ready-made copy carries below its own header: the chosen email, with the template's header
 * and its either/or signposts ("KEEP ONE, DELETE THE OTHERS", the A/B/C markers) taken out — a
 * sender of a ready-made copy has nothing to choose — and the blank lines a removed block leaves
 * closed up. Section headings, the Outlook wrapper and the password-box note stay.
 * @param {string} template @param {string} grade @param {(role: string) => unknown} gradeForRole
 */
export function welcomeBody(template, grade, gradeForRole) {
    return chooseWelcomeEmail(template, grade, gradeForRole)
        .replace(/^<!--[\s\S]*?-->\n/, '')                                      // the template's own header
        .replace(/^[ \t]*<!-- ══[\s\S]*?-->[ \t]*\n/gm, '')                    // KEEP ONE, DELETE THE OTHER(S)
        .replace(/^[ \t]*<!-- (?:OPENING|WHAT IT DOES|VARIANT) [A-C] —[^\n]*-->[ \t]*\n/gm, '')
        .replace(/\n(?:[ \t]*\n){2,}/g, '\n\n');                               // one blank line at most
}

const WELCOME_MARK = (/** @type {string} */ grade) => `<!-- GENERATED below this line by npm run generate:copies from `
    + `${WELCOME_TEMPLATE}, with the ${grade} choices made. Edit the wording there, never here. -->`;

/** @param {Reader} read @returns {Owned} */
function welcomeEmails(read) {
    const template = read(WELCOME_DIR + WELCOME_TEMPLATE);
    return Object.entries(WELCOME_COPIES).map(([name, grade]) => {
        const file = WELCOME_DIR + name;
        const src = read(file);
        // The copy's own header is hand-written (who it is for, and why it exists): everything above
        // the GENERATED line, or — the first time — the file's first comment.
        const at = src.indexOf('\n<!-- GENERATED below this line by npm run generate:copies');
        const header = at >= 0 ? src.slice(0, at + 1) : (src.match(/^<!--[\s\S]*?-->\n/) || [''])[0];
        if (!header) throw new Error(`${file}: no header comment above the email — generate-copies.mjs keeps each copy's own`);
        return /** @type {[string, string]} */ ([file, header + WELCOME_MARK(grade) + '\n' + welcomeBody(template, grade, gradeForRole)]);
    });
}

// ── the list ────────────────────────────────────────────────────────────────────────────────────

/** Every generated fact: its name, and the function that writes it. */
export const COPIES = Object.freeze(/** @type {Array<[string, (read: Reader) => Owned]>} */ ([
    ['csp-meta', cspMeta],
    ['module-preloads', modulePreloads],
    ['sdk-version', sdkVersion],
    ['sw-app-files', swAppFiles],
    ['rules-page-ids', rulesPageIds],
    ['guide-back', guideBack],
    ['welcome-emails', welcomeEmails],
]));

/**
 * Every file this script owns, ONCE, with the content it would write now. The copies run in order,
 * and each reads the files as the ones before it left them: a page carries both its CSP <meta> and
 * its preloads, and building each from the file on disk would let the second undo the first.
 * @param {Reader} read  the file at a repository-relative path, as it is now
 * @returns {Array<{ copy: string, file: string, content: string }>}  `copy` names every fact in the file
 */
export function buildCopies(read) {
    /** @type {Map<string, { copies: string[], content: string }>} */
    const out = new Map();
    const current = (/** @type {string} */ p) => out.get(p)?.content ?? read(p);
    for (const [copy, fn] of COPIES) {
        for (const [file, content] of fn(current)) {
            out.set(file, { copies: [...(out.get(file)?.copies ?? []), copy], content });
        }
    }
    return [...out].map(([file, { copies, content }]) => ({ copy: copies.join(' + '), file, content }));
}

/** The line where two texts first differ, for a failure message. @param {string} have @param {string} want */
export function firstDifference(have, want) {
    const a = have.split('\n'), b = want.split('\n');
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    // A generated line can be long (a whole CSP), so show it from just before the first differing column.
    const x = a[i] ?? '', y = b[i] ?? '';
    let c = 0;
    while (c < x.length && c < y.length && x[c] === y[c]) c++;
    const from = Math.max(0, c - 60);
    const clip = (/** @type {string|undefined} */ s) => (s === undefined ? '(end of file)'
        : (from ? '…' : '') + s.slice(from, from + 140) + (s.length > from + 140 ? '…' : ''));
    return `line ${i + 1}, column ${c + 1}\n    committed: ${clip(a[i])}\n    generated: ${clip(b[i])}`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const read = (/** @type {string} */ p) => readFileSync(join(ROOT, p), 'utf8');
    const written = [];
    for (const { copy, file, content } of buildCopies(read)) {
        if (read(file) === content) continue;
        writeFileSync(join(ROOT, file), content);
        written.push(`  ${file}  (${copy})`);
    }
    console.log(written.length ? `Written:\n${written.join('\n')}` : 'Every generated copy is already current.');
}
