// @ts-check
// @lane hygiene
/**
 * csp-hygiene.test.mjs (v16.81) — keep firebase.json's CSP in step with what the app actually
 * loads. The installed PWA masks CSP breakage, and a stale directive is invisible until an outage:
 *   - a MISSING origin silently breaks the feature that needs it (the exact class as the v16.80
 *     `connect-src` gstatic fix, where the SW SDK warm-up was blocked);
 *   - a STALE origin (e.g. the `*.firebaseio.com` Realtime-DB entries removed at v16.80, never used)
 *     widens the policy for no reason and misleads the next reader about what the app talks to.
 *
 * This is a STATIC check (no browser) — it can't prove runtime enforcement, but it catches drift
 * in both directions against the code, which is where the historical incidents came from.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { APP_PAGES } from '../scripts/app-pages.mjs';

// Tests live in test/ but address files from the repository root (moved 24 Nov 2026).
const REPO_ROOT_URL = new URL('../', import.meta.url);

const ROOT = fileURLToPath(REPO_ROOT_URL);

/** Hosts the app contacts DYNAMICALLY (the URL is built at runtime, e.g. Storage download URLs
 *  from getDownloadURL()), so they never appear as a source literal. They are legitimate CSP
 *  entries even though the grep below can't find them — list them here so "no stale" doesn't
 *  false-positive. Keep this list tight: a host belongs here only if it's genuinely used but
 *  unfindable in source. */
const DYNAMIC_HOSTS = ['firebasestorage.googleapis.com'];
// apis.google.com and the myb-roster.firebaseapp.com frame left this list, and the policy, in Oct
// 2026: they were the popup/redirect helper's script and iframe, which `initializeAuth` without a
// popup resolver never loads (auth-init-parity.test.mjs pins that). The test below now REFUSES them.

test('the Google sign-in helper hosts stay out of the policy', () => {
    const csp = cspValue();
    assert.doesNotMatch(csp, /apis\.google\.com/, 'the popup helper script is never loaded — nothing to allow');
    assert.doesNotMatch(csp, /frame-src[^;]*firebaseapp\.com/, 'and nor is its iframe');
});

/** The runtime source files whose network calls the CSP must permit. */
// Every app page from scripts/app-pages.mjs (v24.52). The hand-kept copy listed six of the seven and
// never overtime.html, so that page's own network origins were never held to the CSP.
// newlink-config.js joined at v25.67: it holds PACK_BASE, the mirror address the in-app PDF viewer reads the pack from.
const APP_SOURCES = ['firebase-client.js', 'service-worker.js', 'huddle.js', 'notif.js', 'newlink-config.js', ...APP_PAGES.map(p => p.file)]
    .map(f => readFileSync(join(ROOT, f), 'utf8')).join('\n');

/** The same sources WITHOUT each page's mirrored `<meta>` CSP (test audit, 7 Nov 2026). That meta
 *  restates every origin the header names (csp-meta-parity.test.mjs keeps it so), so searching the
 *  pages with it left in found every CSP origin in the CSP itself and the stale check could never
 *  fail: removing huddle.js's only Mammoth URL left `cdn.jsdelivr.net` in both policies with both
 *  CSP suites green. The self-cancelling shape the must-cover test below fixed in itself at v18.31. */
const APP_SOURCES_WITHOUT_CSP = APP_SOURCES
    .replace(/<meta\s[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');

/** Extract the CSP header value from firebase.json. */
function cspValue() {
    const fb = JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8'));
    for (const h of fb.hosting?.headers ?? [])
        for (const kv of h.headers ?? [])
            if (kv.key === 'Content-Security-Policy') return kv.value;
    throw new Error('Content-Security-Policy header not found in firebase.json');
}

// ── SCRIPT-SRC NAMES THE FOLDERS THE APP LOADS FROM, NEVER A WHOLE CDN (review, 17 Nov 2026) ──────
// The policy allowed all of https://www.gstatic.com and https://cdn.jsdelivr.net. Both serve far more
// than the app's two libraries — jsdelivr any npm package or GitHub file, gstatic other Google
// products' scripts — so one HTML injection anywhere (a single unescaped string into innerHTML) could
// add an <iframe srcdoc>, which inherits the policy, and run a script from either. Measured in
// Chromium with the header and with the <meta> copy: it ran under the whole-host policy, and under the
// folder-narrowed one it was not even fetched, while the Firebase SDK's module chain and the
// SRI-pinned Mammoth still loaded. A source with a path ending in `/` allows that folder alone (a
// browser matches the host only after a redirect, which neither library's address makes).
// dependency-pin-parity.test.mjs holds the Mammoth folder's version to huddle.js's.
test('script-src allows remote scripts from named folders only, never a whole host', () => {
    const scriptSrc = (/(?:^|;)\s*script-src\s([^;]*)/.exec(cspValue()) ?? [])[1] ?? '';
    const remote = scriptSrc.trim().split(/\s+/).filter(s => /^(?:https?:|\*|\w+:\/\/)/.test(s) || s.includes('.'));
    assert.ok(remote.length >= 2, `expected the Firebase SDK and Mammoth folders in script-src, found: ${scriptSrc}`);
    const wholeHost = remote.filter(s => !/^https:\/\/[a-z0-9.-]+\/\S+\/$/.test(s));
    assert.deepEqual(wholeHost, [],
        `script-src allows ${wholeHost.join(', ')} — a whole host (or a source without a folder path). Name the folder the `
        + 'app loads from, ending in "/" (https://www.gstatic.com/firebasejs/, https://cdn.jsdelivr.net/npm/mammoth@<version>/)');
    assert.ok(remote.includes('https://www.gstatic.com/firebasejs/'), 'the Firebase SDK folder is missing from script-src');
});

test('every remote origin in the CSP is actually referenced by app code (no stale directives)', () => {
    const csp = cspValue();
    // All concrete https/wss hosts named in the CSP (ignores 'self'/'none'/data:/scheme-only).
    const origins = [...csp.matchAll(/(?:https|wss):\/\/[^\s;]+/g)].map(m => m[0]);
    // A CSP host may be a wildcard (https://*.googleapis.com); reduce to the registrable suffix so
    // we can look for it in code that names a concrete sub-host (firestore.googleapis.com, etc.).
    const suffixOf = (o) => o.replace(/^(?:https|wss):\/\//, '').replace(/^\*\./, '');
    // The strip must have found the policy on every page, or the search below is back to reading it.
    const metas = (APP_SOURCES.match(/<meta\s[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi) ?? []).length;
    assert.equal(metas, APP_PAGES.length,
        'expected one <meta> CSP per app page to strip before searching — one is written differently, '
        + 'and the stale check would find its origins in the policy itself');
    const stale = origins.filter(o => {
        const h = suffixOf(o);
        return !APP_SOURCES_WITHOUT_CSP.includes(h) && !DYNAMIC_HOSTS.includes(h);
    });
    assert.deepEqual(
        stale, [],
        `CSP names origins that NO app source references — stale directives (remove them):\n  ${stale.join('\n  ')}`
    );
});

test('every remote origin the app loads is permitted by the CSP', () => {
    const csp = cspValue();
    // The concrete cross-origin hosts the app is KNOWN to contact. Each must be covered by a CSP
    // directive (either verbatim or via a *.suffix wildcard). Add a host here when the app starts
    // talking to it — the test then forces the matching CSP entry.
    const REQUIRED = [
        'www.gstatic.com',                 // Firebase SDK modules (script-src + SW connect-src)
        'cdn.jsdelivr.net',                // Mammoth (script-src)
        'firestore.googleapis.com',        // Firestore
        'identitytoolkit.googleapis.com',  // Auth
        'securetoken.googleapis.com',      // Auth token refresh
        'firebasestorage.googleapis.com',  // Storage downloads
        'europe-west2-myb-roster.cloudfunctions.net', // Cloud Functions
        'garethdavidmiller.github.io',     // the New link pack's PDFs, fetched by the in-app viewer (pdf-viewer.js)
    ];
    const covered = (host) =>
        csp.includes(`//${host}`) ||                             // verbatim
        csp.includes(`//*.${host.replace(/^[^.]+\./, '')}`);     // *.suffix wildcard
    // REQUIRED is, by definition, the set of hosts the app IS known to contact — so every one must
    // be covered UNCONDITIONALLY. A former `APP_SOURCES.includes(h) &&` guard here was self-neutering
    // (v18.31 fix): the `*.googleapis.com` hosts (Auth/Firestore/Storage) never appear as literals in
    // the JS that reaches them — the Firebase SDK builds those URLs internally — they show up in
    // APP_SOURCES ONLY because each page's mirrored <meta> CSP echoes the header. That made
    // `APP_SOURCES.includes(h)` ≈ `covered(h)`, so `includes(h) && !covered(h)` could never be true
    // for precisely the hosts whose omission silently breaks sign-in. Dropping the gate makes this a
    // real must-cover allowlist: remove a host from BOTH CSPs and the test now fails (as it should).
    const missing = REQUIRED.filter(h => !covered(h));
    assert.deepEqual(
        missing, [],
        `App contacts these hosts but the CSP does not permit them (sign-ins/loads will silently fail):\n  ${missing.join('\n  ')}`
    );
});
