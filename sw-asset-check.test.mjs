// Deployment-hygiene checks:
//  1. Every root JS module is referenced in service-worker.js — catches the
//     "added a new module but forgot to list it in the SW" mistake.
//  2. APP_VERSION matches in all 9 bump locations (8 files) — catches a
//     partial version bump, which would serve staff a stale cached asset.
//  3. AI_MAP.md is current to the latest 0.10 milestone — makes the
//     "update docs every 0.10 version" policy (CLAUDE.md) self-enforcing
//     instead of relying on someone remembering to do the sweep.
//  4. functions/roster-members.json matches active staff in roster-data.js —
//     catches the "added a member but forgot to re-run generate-roster-members.mjs" mistake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));

/** "12.61" → 1261, "12.6" → 1260. Lets us compare versions as integers. */
function toHundredths(v) {
    const [maj, min = '0'] = v.split('.');
    return parseInt(maj, 10) * 100 + parseInt(min.padEnd(2, '0').slice(0, 2), 10);
}

test('every root JS module is in BOTH the SW network-first list and a precache list', () => {
    const sw = readFileSync(join(ROOT, 'service-worker.js'), 'utf8');

    // All root .js files except the SW itself, dev config files, and test files.
    const SW_EXCLUDED = new Set(['service-worker.js', 'eslint.config.js']);
    const rootModules = readdirSync(ROOT).filter(
        f => f.endsWith('.js') && !SW_EXCLUDED.has(f) && !f.includes('.test.')
    );

    // Extract a named array-literal's contents from the SW source so we can check
    // membership of each list SEPARATELY. The old check only required a module to
    // appear *somewhere* in the file, so a module that was network-first but never
    // precached (or vice-versa) passed silently — exactly the half-listed-module gap.
    const arrayOf = (name) => {
        const m = sw.match(new RegExp(`const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
        return m ? m[1] : '';
    };
    const networkFirst = arrayOf('NETWORK_FIRST_FILES');
    // A module is "precached" if it is in CORE_ASSETS (core app) or SUPPLEMENTARY_ASSETS
    // (the guides, cached individually). Both are required to be offline-available.
    const precache     = arrayOf('CORE_ASSETS') + arrayOf('SUPPLEMENTARY_ASSETS');

    const inList = (list, f) =>
        list.includes(`'${f}'`)   || list.includes(`"${f}"`) ||
        list.includes(`'./${f}'`) || list.includes(`"./${f}"`);

    const missingNetworkFirst = rootModules.filter(f => !inList(networkFirst, f));
    const missingPrecache     = rootModules.filter(f => !inList(precache, f));

    assert.deepEqual(
        missingNetworkFirst, [],
        `Root JS modules missing from NETWORK_FIRST_FILES:\n  ${missingNetworkFirst.join('\n  ')}`
    );
    assert.deepEqual(
        missingPrecache, [],
        `Root JS modules missing from a precache list (CORE_ASSETS / SUPPLEMENTARY_ASSETS):\n  ${missingPrecache.join('\n  ')}`
    );
});

test('every root .html and .css file is precached (offline availability, non-JS assets)', () => {
    // The JS test above only covered .js modules — the precache existence check was `.js`-only, so a
    // new HTML page or stylesheet forgotten from the SW lists would silently lose offline availability
    // with green CI (cross-file review E1 / fragile-lists A-2). The guides live in SUPPLEMENTARY_ASSETS;
    // every other html/css lives in CORE_ASSETS. All root html/css are currently precached.
    //
    // IMPORTANT: the precache set is CORE_ASSETS + SUPPLEMENTARY_ASSETS ONLY — deliberately NOT
    // NETWORK_FIRST_FILES. The warm-up (warmCacheAndSweepOld) fetches CORE/SUPPLEMENTARY/FONT/ICON/SDK
    // but NEVER NETWORK_FIRST_FILES (which is purely the stale-while-revalidate MATCH set). A file
    // listed only in NETWORK_FIRST_FILES is served-from-cache-if-present but never PRECACHED, so it is
    // unavailable on a device that installs and goes offline before ever visiting it. Including
    // NETWORK_FIRST_FILES here (the pre-fix bug) made that regression pass CI. (Mirrors the JS test's
    // precache set above, which was already correct.)
    const sw = readFileSync(join(ROOT, 'service-worker.js'), 'utf8');
    const arrayOf = (name) => { const m = sw.match(new RegExp(`const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`)); return m ? m[1] : ''; };
    const precache = arrayOf('CORE_ASSETS') + arrayOf('SUPPLEMENTARY_ASSETS');
    const inList = (f) => precache.includes(`'${f}'`) || precache.includes(`"${f}"`) || precache.includes(`'./${f}'`) || precache.includes(`"./${f}"`);
    const assets  = readdirSync(ROOT).filter(f => (f.endsWith('.html') || f.endsWith('.css')) && !f.includes('.test.'));
    const missing = assets.filter(f => !inList(f));
    assert.deepEqual(missing, [], `Root HTML/CSS files not in a SW precache list (would lose offline availability):\n  ${missing.join('\n  ')}`);
});

test('purify.es.mjs is network-first AND precached (the .mjs runtime asset the .js/.css tests miss)', () => {
    // DOMPurify is vendored as purify.es.mjs — a .mjs, so the JS-module test (filters .endsWith('.js'))
    // and the HTML/CSS test both skip it, and the ghost-entry test only checks listed→exists (not the
    // reverse). So dropping it from a SW list would pass CI while breaking offline Huddle-DOCX
    // sanitising. Assert its membership explicitly. (Broadening the .js glob to .mjs is wrong — the
    // dev-only playwright.*.mjs / generate-sri.mjs are NOT runtime assets and must not be SW-listed.)
    const sw = readFileSync(join(ROOT, 'service-worker.js'), 'utf8');
    const arrayOf = (name) => { const m = sw.match(new RegExp(`const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`)); return m ? m[1] : ''; };
    const inList = (list, f) => list.includes(`'${f}'`) || list.includes(`"${f}"`) || list.includes(`'./${f}'`) || list.includes(`"./${f}"`);
    const F = 'purify.es.mjs';
    assert.ok(inList(arrayOf('NETWORK_FIRST_FILES'), F), 'purify.es.mjs must be in NETWORK_FIRST_FILES (served stale-while-revalidate)');
    assert.ok(inList(arrayOf('CORE_ASSETS') + arrayOf('SUPPLEMENTARY_ASSETS'), F), 'purify.es.mjs must be precached (offline DOCX sanitising)');
});

test('every NOTIFICATION_FEATURES hashPath page is in the SW SAFE_NOTIFICATION_PAGES allowlist', () => {
    // Cross-boundary seam (cross-file review E3): buildPushPayload (Cloud Function) sets each
    // notification's deep-link path from NOTIFICATION_FEATURES.hashPath; the SW re-bases the tap only
    // onto pages in SAFE_NOTIFICATION_PAGES. They live in different deploy units, so a feature
    // deep-linking to a NEW page forgotten from the allowlist silently falls back to the app root. This
    // asserts every hashPath's PAGE component is allowlisted. (The pay feature has no hashPath — its url
    // is passed at call time — so 'paycalc.html' is asserted explicitly.)
    const helpers = readFileSync(join(ROOT, 'functions', 'roster-parse-helpers.js'), 'utf8');
    const sw      = readFileSync(join(ROOT, 'service-worker.js'), 'utf8');
    const safe = (sw.match(/const SAFE_NOTIFICATION_PAGES\s*=\s*\[([^\]]*)\]/)?.[1] ?? '')
        .split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
    const hashPaths = [...helpers.matchAll(/hashPath:\s*'([^']+)'/g)].map(m => m[1]);
    const missing = hashPaths
        .map(hp => ({ hp, page: hp.split('#')[0].replace(/^\.?\//, '') }))   // '/#huddle' → '' ; '/x.html#y' → 'x.html'
        .filter(({ page }) => !safe.includes(page));
    assert.deepEqual(missing.map(x => `${x.hp} → page '${x.page}'`), [],
        'NOTIFICATION_FEATURES hashPaths whose page is not in SW SAFE_NOTIFICATION_PAGES');
    assert.ok(safe.includes('paycalc.html'), 'the pay reminder deep-links to paycalc.html — must stay in SAFE_NOTIFICATION_PAGES');

    // The hashPath scan above only covers features that DECLARE a default path. An event feature
    // passes its `url` at CALL time instead (pay, reset request), so its landing page was invisible
    // to this check — 'paycalc.html' was pinned by a hand-written line that had to be remembered for
    // each new feature, and a forgotten one fails SILENTLY (the SW drops an unlisted page and opens
    // the app root, so the notification appears to work). Scan the call sites too. (v18.95)
    // Across EVERY functions/*.js (v20.55) — the domain split moved the pay call site into
    // documents.js and the reset-request one into auth-endpoints.js, and a scan pinned to index.js
    // would have kept passing while covering neither.
    const fnFiles = readdirSync(join(ROOT, 'functions')).filter(f => f.endsWith('.js'));
    const callSiteUrls = fnFiles.flatMap(f => {
        const src = readFileSync(join(ROOT, 'functions', f), 'utf8');
        return [...src.matchAll(/url:\s*`\$\{STAFF_SITE_URL\}\/([^`]*)`/g)].map(m => ({ f, u: m[1] }));
    });
    assert.ok(callSiteUrls.length > 0, 'expected at least one ${STAFF_SITE_URL} notification url in functions/*.js');
    const missingCallSites = callSiteUrls
        .map(({ f, u }) => ({ f, u, page: u.split('#')[0].split('?')[0] }))
        .filter(({ page }) => !safe.includes(page));
    assert.deepEqual(missingCallSites.map(x => `functions/${x.f}: ${x.u} → page '${x.page}'`), [],
        'notification deep-link urls in functions/*.js whose page is not in SW SAFE_NOTIFICATION_PAGES');
});

test('the push notification names the BADGE asset, the ICON asset, and re-bases both onto SW scope', () => {
    // THE ONE APP SURFACE NOBODY CAN SEE FROM A TEST, AND THE ONE WITH NO GUARD ON IT.
    //
    // `.claude/rules/notifications.md` states two rules about `showNotification`'s image options, in
    // bold, with the reason beside each — and until this test nothing enforced either. Both fail the
    // same way: the push is delivered, the tap works, every suite stays green, and the notification
    // is simply WRONG on the phone. There is no console to read and no page to screenshot, because
    // the surface is drawn by the OS.
    //
    //   1 · THE BADGE MUST NOT BE THE APP ICON. Android masks the badge to a single colour in the
    //       status bar, so feeding it the full-colour `icon-192.png` produces a muddy blob. The rule
    //       reads "Never use icon-192.png as the badge"; `icon-badge.png` is the white-on-transparent
    //       silhouette that exists for it. The obvious "tidy-up" — one constant for both, since they
    //       are both the app's icon — is exactly the edit this refuses.
    //
    //   2 · BOTH MUST RESOLVE AGAINST `registration.scope`, NOT THE BARE ORIGIN. On the GitHub Pages
    //       install the app is served from `/roster-app/`, and the bare origin is a DIFFERENT, empty
    //       site that 404s. A root-relative `/icon-192.png` therefore resolves to nothing for the
    //       staff on the mirror — which is still where a large share of them open the app — and iOS
    //       falls back to a generic globe glyph in the Notification Centre. `scope` ends in '/'.
    //
    // WHAT THIS DOES NOT PROVE: that `icon-badge.png` is actually monochrome. Asserting that needs a
    // PNG decoder for one fact, which is the trade `pageCount` in print-visual.spec.js already
    // refuses. It proves the badge is a SEPARATE, PRECACHED asset from the app icon — which is the
    // documented failure, stated exactly.
    const sw = readFileSync(join(ROOT, 'service-worker.js'), 'utf8');

    // Comments FIRST. Both options are documented in-place with comments that themselves mention
    // `icon-192.png` (the badge's comment says what it must NOT be), so a scan of the raw source
    // reads the counter-example as the value and passes on code that is wrong.
    const code = sw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    const at = code.indexOf('showNotification(');
    assert.ok(at !== -1, 'showNotification( not found in service-worker.js — re-point this guard rather than deleting it');
    const opts = code.slice(at, at + 600);

    // Guard the guard: prove the window is the options object and not 600 characters of something
    // else, or every assertion below passes by finding nothing.
    assert.ok(/body:/.test(opts) && /tag/.test(opts),
        'the showNotification window does not look like the options object — the guard has slipped');

    const valueOf = (key) => opts.match(new RegExp(`${key}:\\s*\`([^\`]*)\``))?.[1];
    const icon  = valueOf('icon');
    const badge = valueOf('badge');
    assert.ok(icon,  'no `icon:` template literal in the showNotification options');
    assert.ok(badge, 'no `badge:` template literal in the showNotification options');

    assert.ok(badge.includes('icon-badge.png'),
        `the notification badge must be icon-badge.png, got '${badge}'. Android masks the badge to one `
        + 'colour in the status bar; the full-colour app icon becomes a muddy blob (notifications.md).');
    assert.ok(!badge.includes('icon-192'),
        'the badge is the APP ICON. notifications.md: "Never use icon-192.png as the badge" — it is '
        + 'masked to a single colour by Android and renders as a blob. Use icon-badge.png.');
    assert.ok(icon.includes('icon-192.png'),
        `the notification icon must be the app icon icon-192.png, got '${icon}'`);

    for (const [name, v] of [['icon', icon], ['badge', badge]]) {
        assert.ok(v.startsWith('${self.registration.scope}'),
            `notification ${name} is '${v}' — it must resolve against self.registration.scope, not the `
            + 'bare origin. On the /roster-app/ GitHub Pages install the bare origin is a different, '
            + 'empty site, so a root-relative path 404s for every member on the mirror.');
    }

    // Both must be PRECACHED, or the mirror and an offline device fetch them over a network that may
    // not be there — and a notification arrives at precisely the moment the app is NOT open.
    //
    // The corpus is DERIVED from the warm-up calls rather than from a list of array names typed here.
    // Naming them is how this check goes quietly blind: the icons are in ICON_ASSETS, not CORE_ASSETS
    // (this test asserted the wrong pair on its first run and failed, which is the only reason that is
    // written down rather than shipped), and an array dropping OUT of the warm-up is exactly the
    // regression worth catching — a hardcoded name would keep reading a list nothing precaches.
    const arrayOf = (n) => sw.match(new RegExp(`const ${n}\\s*=\\s*\\[([\\s\\S]*?)\\];`))?.[1] ?? '';
    // To the CALLBACK ARROW, not to the first comma: one warm-up call passes a spread of two arrays
    // (`[...FONT_ASSETS, ...ICON_ASSETS]`), and stopping at the first comma silently captured only
    // the first of them — so the icons this test is ABOUT were the one pair it could not see.
    const warmed = [...sw.matchAll(/fetchInBatches\(([\s\S]*?),\s*\w+\s*=>/g)]
        .flatMap(m => [...m[1].matchAll(/([A-Z_]+_ASSETS)/g)].map(x => x[1]));
    assert.ok(warmed.length >= 2,
        `only ${warmed.length} asset arrays found in the warm-up — the fetchInBatches scan has stopped matching`);
    const precache = warmed.map(arrayOf).join('\n');
    for (const f of ['icon-192.png', 'icon-badge.png']) {
        assert.ok(precache.includes(`"./${f}"`) || precache.includes(`'./${f}'`),
            `${f} is used by the push handler and must be precached — it is not in any array the `
            + `post-activation warm-up fetches (${[...new Set(warmed)].join(', ')})`);
    }

    // And they must be two different files on disk. A badge that is a copy of the app icon satisfies
    // every assertion above by NAME while producing the exact blob the rule exists to prevent.
    const bytes = (f) => readFileSync(join(ROOT, f));
    assert.ok(!bytes('icon-badge.png').equals(bytes('icon-192.png')),
        'icon-badge.png is byte-identical to icon-192.png — the badge is the app icon under another name');
});

test('firestore.rules staffContact work-email domain matches CONFIG.WORK_EMAIL_DOMAIN', () => {
    // The Chiltern work-email domain is duplicated: CONFIG.WORK_EMAIL_DOMAIN (roster-data.js, the client
    // isChilternWorkEmail check) AND the firestore.rules staffContact validation. The comment says "keep
    // in sync" but nothing enforced it (cross-file review E2). Assert the rule references the CONFIG value
    // (backslashes stripped, since the rule escapes the dots as `\\.`).
    const rd    = readFileSync(join(ROOT, 'roster-data.js'), 'utf8');
    const rules = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
    const m = rd.match(/WORK_EMAIL_DOMAIN:\s*'([^']+)'/);
    assert.ok(m, 'CONFIG.WORK_EMAIL_DOMAIN not found in roster-data.js');
    const domain = m[1];
    assert.ok(rules.replace(/\\/g, '').includes('@' + domain),
        `firestore.rules staffContact workEmail validation must match CONFIG.WORK_EMAIL_DOMAIN ('${domain}') — the two drifted.`);
});

test('the VAPID public key is identical in functions/index.js and notif.js', () => {
    // The 87-char VAPID public key is a hardcoded literal on BOTH sides of the push system:
    //   functions/index.js — passed to setVapidDetails(), so it SIGNS every push we send
    //   notif.js           — passed to pushManager.subscribe(), so it is what each device subscribes WITH
    // A subscription is only valid for the key it was created with, so if these two ever drift, every
    // send is rejected.
    //
    // Why this needs a test rather than a comment: the failure is SILENT AND PERMANENT. `fanOutPush`
    // deliberately deletes a subscription only on 410/404 — a 401 (which is exactly what a key mismatch
    // produces) is logged and the doc is KEPT, precisely so a VAPID misconfiguration cannot wipe the
    // whole collection (v16.15). So staff simply stop receiving Huddle notifications while
    // `pushSubscriptions` still looks healthy and nothing surfaces it.
    //
    // Worse, the client's own migration path cannot rescue it either: notif.js re-subscribes when
    // `VAPID_FINGERPRINT` (the first 12 chars of ITS OWN copy) changes — so a server-side-only edit
    // moves nothing on the devices. The two literals have to be equal, and only a check like this says so.
    const fnSrc    = readFileSync(join(ROOT, 'functions/index.js'), 'utf8');
    const notifSrc = readFileSync(join(ROOT, 'notif.js'), 'utf8');
    const grab = (/** @type {string} */ src, /** @type {string} */ where) => {
        const m = src.match(/VAPID_PUBLIC_KEY\s*=\s*'([^']+)'/);
        assert.ok(m, `VAPID_PUBLIC_KEY literal not found in ${where} — re-point this guard rather than deleting it`);
        return m[1];
    };
    const server = grab(fnSrc, 'functions/index.js');
    const client = grab(notifSrc, 'notif.js');
    assert.equal(client, server,
        'VAPID public key drift: functions/index.js signs pushes with one key while notif.js subscribes ' +
        'devices with another. Every send would 401, the subscriptions would NOT be cleaned up (401 is ' +
        'deliberately non-deleting), and notifications would stop with no error anywhere.');
    // A VAPID P-256 public key is 65 raw bytes → 87 base64url chars, no padding. A truncated or
    // re-wrapped key would still be "equal on both sides" and still break every send.
    assert.match(server, /^[A-Za-z0-9_-]{87}$/,
        `VAPID public key is not a valid 87-char base64url P-256 key (got ${server.length} chars)`);
});

test('every served page carries the noindex meta, matching the X-Robots-Tag header', () => {
    // Same contract as the mirrored CSP (csp-meta-parity.test.mjs), applied to a second header: the
    // X-Robots-Tag in firebase.json only reaches Firebase Hosting, so the GitHub Pages staff mirror —
    // which cannot serve headers — would keep every page indexable if the meta were ever dropped or a
    // NEW page shipped without it. robots.txt cannot cover the mirror either (it is only honoured at an
    // ORIGIN root, and the mirror lives under /roster-app/), so this meta is that origin's ONLY signal.
    const header = readFileSync(join(ROOT, 'firebase.json'), 'utf8').match(
        /"key":\s*"X-Robots-Tag",\s*"value":\s*"([^"]+)"/);
    assert.ok(header, 'X-Robots-Tag header missing from firebase.json — the Firebase Hosting half of the contract');
    assert.match(header[1], /\bnoindex\b/, 'X-Robots-Tag must assert noindex');

    const pages   = readdirSync(ROOT).filter(f => f.endsWith('.html')).sort();
    assert.ok(pages.length >= 10, `expected the six app pages + four guides, found ${pages.length}`);
    const missing = pages.filter(f => !/<meta\s+name="robots"\s+content="[^"]*\bnoindex\b/
        .test(readFileSync(join(ROOT, f), 'utf8')));
    assert.deepEqual(missing, [],
        'served pages with no noindex meta — these stay indexable on the GitHub Pages mirror, which gets no headers');
});

test('every SW-listed asset actually exists on disk (no ghost entries)', () => {
    // The membership check above is one-directional: it proves every module is LISTED, but not
    // that every LISTED path exists. A file rename that leaves a stale entry makes the warm-up
    // fetch 404 → allOk stays false → the __precache-complete marker is never written → old-version
    // caches are NEVER swept and the warm-up retries on every SW wake, silently and forever.
    // This closes that gap by asserting the reverse direction. (v16.81 debt sweep.)
    const sw = readFileSync(join(ROOT, 'service-worker.js'), 'utf8');
    const arrayOf = (name) => {
        const m = sw.match(new RegExp(`const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
        return m ? m[1] : '';
    };
    const LISTS = ['NETWORK_FIRST_FILES', 'CORE_ASSETS', 'SUPPLEMENTARY_ASSETS', 'FONT_ASSETS', 'ICON_ASSETS'];
    const ghosts = [];
    for (const name of LISTS) {
        const body = arrayOf(name);
        // Every quoted string literal in the array body.
        for (const m of body.matchAll(/['"]([^'"]+)['"]/g)) {
            const raw = m[1];
            if (raw.startsWith('http')) continue;          // CDN/gstatic URLs — not local files
            const rel = raw.replace(/^\.\//, '');           // strip leading ./
            if (!existsSync(join(ROOT, rel))) ghosts.push(`${name}: ${raw}`);
        }
    }
    assert.deepEqual(
        ghosts, [],
        `SW asset lists reference files that don't exist on disk (a ghost entry disables cache sweeping):\n  ${ghosts.join('\n  ')}`
    );
});

test('APP_VERSION matches in the 2 runtime bump locations', () => {
    // roster-data.js is the authoritative source (per CLAUDE.md); the SW const names the
    // cache. The old 7 pure-comment stamps (SW line 1 + six HTML line-2) were dropped in the
    // v16.81 debt sweep — they had no runtime effect and only added per-commit diff noise.
    const rosterData = readFileSync(join(ROOT, 'roster-data.js'), 'utf8');
    const match = rosterData.match(/export const APP_VERSION = '([\d.]+)'/);
    assert.ok(match, "APP_VERSION declaration not found in roster-data.js");
    const version = match[1];

    const sw = readFileSync(join(ROOT, 'service-worker.js'), 'utf8');
    assert.ok(
        sw.includes(`APP_VERSION = '${version}'`),
        `service-worker.js APP_VERSION const is not '${version}'`
    );
});

// The cross-version cache fallback must prefer the NEWEST older cache, not the arbitrary
// oldest one caches.match() returns (v16.86 mixed-version mitigation). Guards against an
// accidental revert of the two hot fallback paths (JS/CSS cold miss + doc serveFallback) back
// to a bare any-version caches.match(event.request), which would re-widen the version skew.
test('service-worker.js cross-version fallback uses matchNewestManagedCache, not oldest-first caches.match', () => {
    const sw = readFileSync(join(ROOT, 'service-worker.js'), 'utf8');
    assert.ok(sw.includes('function matchNewestManagedCache'),
        'matchNewestManagedCache helper is missing');
    // The two primary fallbacks must route through the newest-older selector.
    assert.ok(sw.includes('matchNewestManagedCache(event.request)'),
        'the JS/CSS cold-cache fallback should use matchNewestManagedCache(event.request)');
    assert.ok(sw.includes('matchNewestManagedCache(event.request, { ignoreSearch: true })'),
        'the doc serveFallback should use matchNewestManagedCache(event.request, { ignoreSearch: true })');
    // The oldest-first any-version lookups those replaced must be gone from the primary paths
    // (the deep broken-storage .catch backstops may still use a plain caches.match — those are
    // hit only on wedged Cache Storage, so they are intentionally left out of scope).
    assert.ok(!sw.includes('caches.match(event.request, { ignoreSearch: true })'),
        'the doc fallback still has a bare oldest-first caches.match(event.request, { ignoreSearch: true })');
});

// Every .md doc that carries a version stamp must be current to the latest 0.10
// milestone. CLAUDE.md uses a "Current app version `X.YZ`" line; the others use a
// "Last updated: … vX.YZ" header. The policy (CLAUDE.md) is that ALL the docs are
// swept every 0.10 version — this test enforces that for all of them, not just one.
const DOC_STAMPS = [
    // CLAUDE.md states the MILESTONE, not the current version — its row is labelled
    // "Documentation milestone" for that reason. It used to say "Current app version" and carry the
    // exact figure, which rotted on every release (23.23 while the app shipped 23.24, 23.25, 23.26)
    // because bumping a doc row is not part of shipping. The guard only ever required the milestone.
    { file: 'CLAUDE.md',               re: /Documentation milestone[^`]*`(\d+\.\d+)`/, label: '"Documentation milestone" line' },
    { file: 'docs/AI_MAP.md',               re: /Last updated:[^\n]*?v(\d+\.\d+)/,       label: '"Last updated" header' },
    { file: 'docs/OPERATIONS_REFERENCE.md', re: /Last updated:[^\n]*?v(\d+\.\d+)/,       label: '"Last updated" header' },
    { file: 'docs/KNOWN_LIMITATIONS.md',    re: /Last updated:[^\n]*?v(\d+\.\d+)/,       label: '"Last updated" header' },
    { file: 'docs/ROADMAP.md',              re: /Last updated:[^\n]*?v(\d+\.\d+)/,       label: '"Last updated" header' },
];

test('every versioned .md doc is current to the latest 0.10 milestone', () => {
    const rosterData = readFileSync(join(ROOT, 'roster-data.js'), 'utf8');
    const appMatch = rosterData.match(/export const APP_VERSION = '([\d.]+)'/);
    assert.ok(appMatch, 'APP_VERSION declaration not found in roster-data.js');

    // Docs are refreshed at every 0.10 boundary, so each stamp must be at least
    // the most recent 0.10 milestone at or below APP_VERSION (the app version
    // floored to the nearest 0.10). Fails the moment a bump crosses a 0.10 line
    // without the doc sweep — turning the prose policy into an executable tripwire.
    const milestone = Math.floor(toHundredths(appMatch[1]) / 10) * 10;
    const milestoneStr = `v${(milestone / 100).toFixed(2)}`;

    const stale = [];
    for (const { file, re, label } of DOC_STAMPS) {
        const src = readFileSync(join(ROOT, file), 'utf8');
        const m = src.match(re);
        assert.ok(m, `${file}: ${label} (version stamp) not found`);
        if (toHundredths(m[1]) < milestone) stale.push(`${file} (v${m[1]})`);
    }

    assert.deepEqual(
        stale, [],
        `These docs are behind the ${milestoneStr} 0.10 checkpoint (APP_VERSION v${appMatch[1]}). `
        + `Review each, apply any needed updates, then bump its version stamp:\n  ${stale.join('\n  ')}`
    );
});

test('every functions module only destructures symbols functions/push.js actually exports', () => {
    // The push TRANSPORT moved out of index.js at v20.52. A CommonJS require resolves at RUNTIME, so
    // a renamed or dropped export does not fail the build, the unit tests or the parse check — it
    // fails when the function first runs, which for a push sender means a notification silently not
    // being sent. Cheap to check statically; expensive to notice any other way.
    //
    // Scans EVERY functions/*.js (v20.55 — was index.js only). The domain split moved the require
    // sites into documents.js and auth-endpoints.js; a guard pinned to the old home would have gone
    // quietly vacuous, which is the exact failure mode it exists to catch in the code.
    const push = readFileSync(join(ROOT, 'functions', 'push.js'), 'utf8');
    const exp  = push.match(/module\.exports\s*=\s*\{([^}]+)\}/);
    assert.ok(exp, 'functions/push.js has no module.exports object literal');
    const exported = new Set(exp[1].split(',').map(s => s.trim().split(':')[0].trim()).filter(Boolean));

    const requireSites = [];
    for (const f of readdirSync(join(ROOT, 'functions')).filter(f => f.endsWith('.js') && f !== 'push.js')) {
        const src = readFileSync(join(ROOT, 'functions', f), 'utf8');
        const req = src.match(/const\s*\{([^}]+)\}\s*=\s*require\('\.\/push'\)/);
        if (!req) continue;
        const wanted = req[1].split(',').map(s => s.trim()).filter(Boolean);
        assert.ok(wanted.length > 0, `${f} destructured nothing from ./push`);
        requireSites.push(f);
        const missing = wanted.filter(w => !exported.has(w));
        assert.deepEqual(missing, [],
            `functions/${f} requires these from ./push but push.js does not export them: ${missing.join(', ')}`);
    }
    assert.ok(requireSites.length > 0,
        'no functions module requires ./push any more — if the transport was folded back in, delete this test');
});

test('functions/roster-members.json matches active staff in roster-data.js', async () => {
    // Dynamic import so we get the live teamMembers array without module mocks.
    const { teamMembers, CONFIG, getMembersForGrade } = await import('./roster-data.js');
    const json = JSON.parse(readFileSync(join(ROOT, 'functions', 'roster-members.json'), 'utf8'));

    const expected = {
        cea:        teamMembers.filter(m => m.role === 'CEA'        && !m.hidden && !m.managerOnly).map(m => m.name).sort(),
        ces:        teamMembers.filter(m => m.role === 'CES'        && !m.hidden && !m.managerOnly).map(m => m.name).sort(),
        dispatcher: teamMembers.filter(m => m.role === 'Dispatcher' && !m.hidden && !m.managerOnly).map(m => m.name).sort(),
    };

    for (const grade of ['cea', 'ces', 'dispatcher']) {
        assert.deepEqual(
            [...(json[grade] ?? [])].sort(), expected[grade],
            `functions/roster-members.json ${grade} list is out of sync with roster-data.js.\n`
            + `Run: npm run generate:roster-members`
        );
    }

    // B4: the server-owned member + role lists that setupRosterAuth trusts must match roster-data.js
    // EXACTLY — drift could disable a real account or leave a claim tier client-editable. activeMembers
    // mirrors admin-auth.js's ACTIVE_MEMBERS (the same four getMembersForGrade calls, order preserved).
    const expectedActive = [
        ...getMembersForGrade('CEA'), ...getMembersForGrade('CES'),
        ...getMembersForGrade('Dispatcher'), ...getMembersForGrade('Management'),
    ].map(m => m.name);
    assert.deepEqual(
        json.activeMembers, expectedActive,
        'functions/roster-members.json activeMembers is out of sync with roster-data.js.\nRun: npm run generate:roster-members'
    );
    assert.deepEqual(json.roles?.admin,    CONFIG.ADMIN_NAMES,     'roster-members.json roles.admin != CONFIG.ADMIN_NAMES — run npm run generate:roster-members');
    assert.deepEqual(json.roles?.manager,  CONFIG.MANAGER_NAMES,   'roster-members.json roles.manager != CONFIG.MANAGER_NAMES — run npm run generate:roster-members');
    assert.deepEqual(json.roles?.designer, CONFIG.LINKS_DESIGNERS, 'roster-members.json roles.designer != CONFIG.LINKS_DESIGNERS — run npm run generate:roster-members');
    // A non-empty admin list is load-bearing: setupRosterAuth fails closed on an empty one, but catch
    // it here too so a bad edit never even deploys.
    assert.ok(Array.isArray(json.roles?.admin) && json.roles.admin.length > 0, 'roster-members.json roles.admin must be non-empty (admin lockout guard)');
});

test('no unused CSS custom properties defined in :root', () => {
    const cssFiles = readdirSync(ROOT).filter(f => f.endsWith('.css'));
    const cssText = Object.fromEntries(cssFiles.map(f => [f, readFileSync(join(ROOT, f), 'utf8')]));

    // A token is only "used" if var(--token) appears in a stylesheet that is LINKED TOGETHER
    // with the defining file on some page. Checking one concatenated blob (the pre-v17.58
    // behaviour) let a dead guide-local token hide behind a SAME-NAMED token in another file
    // (the guides deliberately run their own palettes, so names like --green/--light/--bg
    // repeat across them). Link groups mirror the pages' actual <link> sets:
    const APP_GROUP = ['shared.css', 'index.css', 'admin.css', 'paycalc.css',
        'operations.css', 'settings.css', 'links.css'];
    const LINK_GROUPS = [
        APP_GROUP,
        ['guide-shell.css', 'guide-doc.css', 'staff-guide.css'],
        ['guide-shell.css', 'guide-doc.css', 'paycalc-guide.css'],
        ['guide-shell.css', 'railcard-guide.css'],
        ['guide-shell.css', 'fip-guide.css'],
    ];
    // Any css file not named in a group (a future addition) falls back to the app group,
    // so a brand-new stylesheet can never silently dodge the check.
    const groupsFor = (file) => {
        const gs = LINK_GROUPS.filter(g => g.includes(file));
        return gs.length ? gs : [APP_GROUP.concat(file)];
    };

    // Walk :root { } blocks PER FILE and collect (file, token) definitions.
    // :root bodies never contain nested { } (they are flat property lists).
    /** @type {Array<{file: string, token: string}>} */
    const defined = [];
    for (const f of cssFiles) {
        const css = cssText[f];
        let idx = 0;
        while (idx < css.length) {
            const rootPos = css.indexOf(':root', idx);
            if (rootPos === -1) break;
            const openBrace = css.indexOf('{', rootPos);
            if (openBrace === -1) break;
            const closeBrace = css.indexOf('}', openBrace);
            if (closeBrace === -1) break;
            const block = css.slice(openBrace + 1, closeBrace);
            const propRe = /(--[\w-]+)\s*:/g;
            let m;
            while ((m = propRe.exec(block)) !== null) defined.push({ file: f, token: m[1] });
            idx = closeBrace + 1;
        }
    }

    // Tokens intentionally defined but not yet referenced via var() in CSS.
    // Each entry below is a known gap — document the reason so future reviewers
    // know these are decisions, not accidents. Fix by either using the token or
    // deleting it; do not grow this list without a documented reason.
    const ALLOWED_DEAD_TOKENS = new Set([
        // The three-surface model names --surface-canvas as the body background alias
        // for --primary-blue. All 6 page CSS files currently use var(--primary-blue)
        // directly. Align in a future pass by replacing body background references.
        '--surface-canvas',
        // Reserved type-scale step above --type-large (18px). No component needs it yet.
        '--type-xl',
        // Mid-range navy reference colour; no component uses it yet.
        '--navy-mid',
        // Night-shift coverage colour in links.css palette. No night column in current
        // links workspace UI — kept for consistency with the other --cov-* tokens.
        '--cov-night',
        // Hover variants for raspberry and indigo UI elements. No interactive
        // raspberry/indigo elements exist yet.
        '--raspberry-hover',
        '--indigo-hover',
        // Reserved for a row-selection UI pattern; not yet implemented.
        '--row-selected-bg',
    ]);

    // Every (file, token) definition must appear in a var() call within a stylesheet it is
    // actually linked with. Same-named tokens in unlinked files no longer count as usage.
    const dead = defined
        .filter(({ file, token }) => {
            if (ALLOWED_DEAD_TOKENS.has(token)) return false;
            const linked = new Set(groupsFor(file).flat());
            return ![...linked].some(f => cssText[f] && cssText[f].includes(`var(${token})`));
        })
        .map(({ file, token }) => `${token} (${file})`);
    assert.deepEqual(
        dead, [],
        `CSS custom properties defined in :root but never referenced via var() in any linked stylesheet:\n  ${dead.join('\n  ')}`
    );
});

test('Firestore collections in firebase-client.js all have firestore.rules entries', () => {
    const client = readFileSync(join(ROOT, 'firebase-client.js'), 'utf8');
    const rules  = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');

    // Collection names from the COLLECTIONS constant object exported by firebase-client.js.
    // The code uses COLLECTIONS.name rather than bare string literals, so we parse the
    // object declaration instead of looking for collection(db, 'literal') calls.
    const clientCollections = new Set();
    const collectionsBlock = client.match(/export const COLLECTIONS\s*=\s*\{([^}]+)\}/);
    if (collectionsBlock) {
        const valueRe = /:\s*'(\w+)'/g;
        let m;
        while ((m = valueRe.exec(collectionsBlock[1])) !== null) clientCollections.add(m[1]);
    }

    // Sanity: the regex must have found at least one collection.
    // If COLLECTIONS is refactored, update the regex above rather than silently passing.
    assert.ok(
        clientCollections.size > 0,
        'Firestore collections test found zero collections — check the COLLECTIONS regex in sw-asset-check.test.mjs'
    );

    // Explicit match blocks from rules: match /name/{...}
    const ruleCollections = new Set();
    const rulesRe = /match\s+\/(\w+)\s*\/\{/g;
    let m;
    while ((m = rulesRe.exec(rules)) !== null) ruleCollections.add(m[1]);

    // 'databases' is the Firestore path root, not a collection name.
    const FIRESTORE_PATH_SEGMENTS = new Set(['databases']);
    const missing = [...clientCollections]
        .filter(c => !FIRESTORE_PATH_SEGMENTS.has(c) && !ruleCollections.has(c));

    assert.deepEqual(
        missing, [],
        `Collections in COLLECTIONS constant but missing from firestore.rules:\n  ${missing.join('\n  ')}`
    );
});

// ──────────────────────────────────────────────────────────────────────────────
// paycalc.html <link rel="modulepreload"> hints must stay in sync with paycalc's
// real static import graph. The preloads collapse the module-fetch waterfall (see
// the comment block in paycalc.html); if an import is added/removed and the hints
// aren't updated, the speed-up silently regresses for that module — and a stale
// gstatic Firebase version would preload the wrong SDK file. This guards both.
// ──────────────────────────────────────────────────────────────────────────────

/** Resolve the transitive set of LOCAL (./) static module deps reachable from `entry`. */
function staticLocalGraph(entry) {
    const seen = new Set();
    const walk = (file) => {
        if (seen.has(file)) return;
        seen.add(file);
        let src;
        try { src = readFileSync(join(ROOT, file), 'utf8'); } catch { return; }
        // Strip comments first. The `from '...'` scan below matches that substring
        // anywhere, so a module path written inside a JSDoc/usage comment (e.g.
        // "// re-exported from './foo.js'") would otherwise inject a PHANTOM module and
        // make the walker recurse into an unrelated subtree — a spurious CI failure.
        // Preserve "://" so import URLs like https://… are not mangled.
        src = src
            .replace(/\/\*[\s\S]*?\*\//g, '')        // block comments
            .replace(/(^|[^:])\/\/[^\n]*/g, '$1');   // line comments (but not the // in a URL)
        const deps = [];
        let m;
        // "... from './path'" — covers single-line AND multiline import/export blocks
        const fromRe = /\bfrom\s*["']([^"']+)["']/g;
        while ((m = fromRe.exec(src))) deps.push(m[1]);
        // side-effect imports: import './path'
        const sideRe = /^\s*import\s*["']([^"']+)["']/gm;
        while ((m = sideRe.exec(src))) deps.push(m[1]);
        for (const p of deps) {
            if (!p.startsWith('./')) continue;   // ignore gstatic + bare specifiers
            walk(p.slice(2));
        }
    };
    walk(entry);
    return seen;
}

/** The gstatic Firebase SDK modules firebase-client.js imports STATICALLY (excludes dynamic
 *  import() like firebase-storage, which is intentionally lazy and must NOT be preloaded). These
 *  are exactly the SDK modules a page's <head> must modulepreload to flatten the load waterfall. */
function requiredGstaticModules() {
    const client = readFileSync(join(ROOT, 'firebase-client.js'), 'utf8');
    // `from '…'` = a static import; a dynamic `import('…')` has no `from`, so it's excluded.
    return [...client.matchAll(/\bfrom\s*['"]https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/(firebase-[a-z]+)\.js['"]/g)]
        .map(x => x[1]);
}

/** Pages that declare modulepreload hints, the entry each one's graph starts from, and whether the
 *  page preloads that entry too. links.html joined at v21.75 — as the workspace grew it overtook
 *  paycalc as the deepest graph in the app, which is the only reason the other pages go without.
 *  index.html is here as well, and its list is the WHOLE graph, not a hand-picked subset: this
 *  comment said otherwise for a long while, beside a separate index-only test that checked it
 *  exhaustively all along (folded into this table at the v24.28 review). Its entry, calendar-app.js,
 *  is a plain module script rather than a *-boot.js shim, so the page preloads it as well. */
const PRELOAD_PAGES = /** @type {const} */ ([
    ['paycalc.html', 'paycalc-boot.js', false],
    ['links.html',   'links-boot.js',   false],
    ['index.html',   'calendar-app.js', true],
]);

for (const [page, entry, preloadsEntry] of PRELOAD_PAGES) {
    test(`${page} modulepreload hints match its real transitive module graph`, () => {
        const html = readFileSync(join(ROOT, page), 'utf8');

        // The local module graph the page actually loads (a boot shim handles itself).
        const graph = staticLocalGraph(entry);
        if (!preloadsEntry) graph.delete(entry);
        const expected = [...graph].filter(f => f.endsWith('.js')).sort();

        // The local modules the page declares as preloads.
        const preloaded = [...html.matchAll(/<link rel="modulepreload" href="\.\/([^"]+)"/g)]
            .map(x => x[1]).sort();

        const missing = expected.filter(f => !preloaded.includes(f));
        const stale   = preloaded.filter(f => !expected.includes(f));
        assert.deepEqual(
            { missing, stale }, { missing: [], stale: [] },
            `${page} modulepreload list is out of sync with ${entry}'s static graph.\n` +
            `  Add a <link rel="modulepreload"> for: ${missing.join(', ') || '(none)'}\n` +
            `  Remove the stale preload for:        ${stale.join(', ') || '(none)'}`
        );
    });
}

/** Every served APP page (the guides load no modules and no SDK). Read from the filesystem
 *  rather than listed, so a page added later joins these checks by existing — the same reason
 *  page-contract-parity.test.mjs enumerates rather than lists. */
const GUIDE_PAGES = new Set([
    'staff-guide.html', 'paycalc-guide.html', 'railcard-guide.html', 'fip-guide.html', 'rangers-guide.html',
]);
/** Served pages that are only a redirect to a renamed one — no scripts, so no SDK to preload.
 *  Why they exist, and the contract they DO owe: page-contract-parity.test.mjs → LEGACY_REDIRECTS. */
const LEGACY_REDIRECTS = new Set(['guide.html', 'fip.html']);
const APP_PAGES = readdirSync(ROOT)
    .filter(f => f.endsWith('.html') && !GUIDE_PAGES.has(f) && !LEGACY_REDIRECTS.has(f))
    .sort();

/** The ONE pinned SDK version firebase-client.js imports. */
function pinnedSdkVersion() {
    const client = readFileSync(join(ROOT, 'firebase-client.js'), 'utf8');
    const versions = new Set(
        [...client.matchAll(/gstatic\.com\/firebasejs\/([\d.]+)\//g)].map(x => x[1])
    );
    assert.equal(versions.size, 1, `firebase-client.js references multiple SDK versions: ${[...versions].join(', ')}`);
    return [...versions][0];
}

// ── EVERY app page must preload the Firebase SDK (v21.76) ──────────────────────────────────────
//
// This was checked per page, by three near-identical copies covering index/paycalc/links, so the
// four pages that carry SDK hints alone would have joined none of them — a page can now only opt
// out of the check by not existing. The measurement that made the hints mandatory: modules are
// discovered in a WATERFALL, the SDK sits five levels down, and a page without the hint does not
// START fetching it for 1.4-2.4s. Nothing on the page can finish before the SDK does, so
// DOMContentLoaded moves with it, one for one.
for (const page of APP_PAGES) {
  test(`${page} preloads the gstatic Firebase SDK at the version firebase-client.js pins`, () => {
    const version = pinnedSdkVersion();
    const html = readFileSync(join(ROOT, page), 'utf8');
    const preloadedSdk = [...html.matchAll(
        /<link rel="modulepreload" href="https:\/\/www\.gstatic\.com\/firebasejs\/([\d.]+)\/(firebase-[a-z]+)\.js" crossorigin>/g
    )];

    for (const [, v, mod] of preloadedSdk) {
        assert.equal(v, version, `${page} preloads ${mod} at ${v} but firebase-client.js uses ${version}`);
    }
    const preloadedMods = new Set(preloadedSdk.map(x => x[2]));
    for (const mod of requiredGstaticModules()) {
        assert.ok(preloadedMods.has(mod),
            `${page} is missing a modulepreload for ${mod}.js (firebase-client.js imports it statically). ` +
            `Without it the SDK is not discovered until the module chain reaches firebase-client.js.`);
    }
  });
}

// The pages that deliberately carry no LOCAL preload list — asserted so a stray or hand-written one
// fails CI rather than rotting unnoticed, and so the claim in CLAUDE.md stays true. The three fixed
// gstatic tags above are a different thing and are REQUIRED on every page: they name one immutable
// URL each and cannot fall behind the graph, which is the whole objection to a local list.
//
// links.html LEFT this list at v21.75. The original reasoning was that only the deepest graphs
// earn the hints, and links was assumed shallow; it is now the deepest of the seven (46 modules,
// ~1.1 MB), and measured on a throttled phone it was spending 8-9 sequential discovery rounds
// getting there. It is in PRELOAD_PAGES above instead, where the exhaustive graph check applies —
// which is the important half: an unguarded hand-maintained list is worse than none, because it
// silently stops covering the module it was written for.
test('admin/operations/settings/overtime.html carry NO local modulepreload hints (per CLAUDE.md)', () => {
    for (const page of ['admin.html', 'operations.html', 'settings.html', 'overtime.html']) {
        const html = readFileSync(join(ROOT, page), 'utf8');
        const local = [...html.matchAll(/<link rel="modulepreload" href="\.\/([^"]+)"/g)].map(x => x[1]);
        assert.deepEqual(local, [],
            `${page} has ${local.length} LOCAL <link rel="modulepreload"> hint(s): ${local.join(', ')}. ` +
            `CLAUDE.md says these pages deliberately carry none. ` +
            `Either remove them, or add the page to PRELOAD_PAGES so its list is checked against the real graph.`);
    }
});

test('service-worker.js FIREBASE_SDK_VERSION matches the SDK version firebase-client.js imports', () => {
    // The SW serves the gstatic SDK cache-first from an SDK-versioned cache (v16.10).
    // A firebase-client.js SDK bump without the matching SW constant bump would leave the
    // SW caching (and warming) the OLD version's URLs while pages import the new ones —
    // the new SDK would silently lose its offline guarantee.
    const sw     = readFileSync(join(ROOT, 'service-worker.js'), 'utf8');
    const client = readFileSync(join(ROOT, 'firebase-client.js'), 'utf8');
    const swVer  = sw.match(/const FIREBASE_SDK_VERSION = '([\d.]+)'/)?.[1];
    assert.ok(swVer, 'FIREBASE_SDK_VERSION constant missing from service-worker.js');
    const clientVers = new Set(
        [...client.matchAll(/gstatic\.com\/firebasejs\/([\d.]+)\//g)].map(x => x[1])
    );
    assert.equal(clientVers.size, 1, `firebase-client.js references multiple SDK versions: ${[...clientVers].join(', ')}`);
    assert.equal([...clientVers][0], swVer,
        `firebase-client.js imports SDK ${[...clientVers][0]} but service-worker.js FIREBASE_SDK_VERSION is ${swVer} — bump both together`);
});

// ──────────────────────────────────────────────────────────────────────────────
// Privacy guard: real payslip figures (the payslip actuals must live ONLY in the test
// fixture (the gitignored test-fixtures/payslip-actuals.local.js), never
// exported from served production JS. Moved out of roster-data.js at v14.68; this
// asserts it can't creep back in.
// ──────────────────────────────────────────────────────────────────────────────
test('roster-data.js does not export the payslip actuals (they stay in the test fixture)', () => {
    const src = readFileSync(join(ROOT, 'roster-data.js'), 'utf8');
    // ANY `*_ACTUALS` EXPORT, not one spelling (v23.96). What this guard defends against is a
    // REVERT — somebody restoring the pre-v23.71 block out of git history, which carries the export
    // name used then, off a colleague's surname. Matching only the current name would have let that
    // through, so the rename would have quietly disarmed the guard. Naming the old spelling here
    // would work and would also put that surname back into public source beside the words "payslip
    // figures", which is the thing being removed. A wildcard closes both: it catches the old name,
    // any future one, and spells none of them.
    const NAMES = String.raw`[A-Z][A-Z0-9_]*_ACTUALS`;
    const exportsDecl = new RegExp(String.raw`export\s+(?:const|let|var|function)\s+${NAMES}\b`).test(src);
    const exportsList = new RegExp(String.raw`export\s*\{[^}]*\b${NAMES}\b[^}]*\}`).test(src);
    assert.ok(
        !exportsDecl && !exportsList,
        'Real payslip figures must NOT be exported from roster-data.js — they belong only in the ' +
        'gitignored test-fixtures/payslip-actuals.local.js, never in served production JS.',
    );
});

// THE GITIGNORE IS THE PROTECTION NOW, SO THE GITIGNORE IS WHAT HAS TO BE GUARDED (v23.71).
//
// `firebase.json`'s `test-fixtures/**` exclusion governs Firebase Hosting and cannot express a
// decision for the GitHub Pages mirror, which publishes the repository root with no ignore list —
// so while the payslip fixture was committed it was served there, measured at HTTP 200 against a
// 404 on the canonical origin. Keeping the bytes out of the repository is the only rule BOTH
// origins obey, and a deleted line in `.gitignore` would silently re-open it the next time
// somebody ran `git add -A` on a machine that has the file.
//
// This cannot see whether a real fixture exists (it does not, on any checkout but the owner's).
// What it can assert is that the rule protecting it is still written down.
test('.gitignore still excludes the real payslip fixture', () => {
    const gi = readFileSync(join(ROOT, '.gitignore'), 'utf8');
    assert.ok(/^\*\.local\.js\s*$/m.test(gi),
        'the `*.local.js` rule is gone from .gitignore. It is what keeps real payslip figures out of\n'
        + 'the repository — and therefore off the GitHub Pages mirror, which serves the repo root and\n'
        + 'obeys no ignore list. Restore it before committing anything from test-fixtures/.');
    assert.ok(!existsSync(join(ROOT, 'test-fixtures', 'payslip-actuals.js')),
        'test-fixtures/payslip-actuals.js is back. The real payslip figures left the tree at v23.71;\n'
        + 'the local copy belongs at test-fixtures/payslip-actuals.local.js, which is gitignored.');
});
