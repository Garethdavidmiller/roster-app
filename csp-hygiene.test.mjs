// @ts-check
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

const ROOT = dirname(fileURLToPath(import.meta.url));

/** Hosts the app contacts DYNAMICALLY (the URL is built at runtime, e.g. Storage download URLs
 *  from getDownloadURL()), so they never appear as a source literal. They are legitimate CSP
 *  entries even though the grep below can't find them — list them here so "no stale" doesn't
 *  false-positive. Keep this list tight: a host belongs here only if it's genuinely used but
 *  unfindable in source. */
const DYNAMIC_HOSTS = ['firebasestorage.googleapis.com'];

/** The runtime source files whose network calls the CSP must permit. */
const APP_SOURCES = ['firebase-client.js', 'service-worker.js', 'huddle.js', 'notif.js', 'index.html',
    'paycalc.html', 'admin.html', 'operations.html', 'settings.html', 'links.html']
    .map(f => readFileSync(join(ROOT, f), 'utf8')).join('\n');

/** Extract the CSP header value from firebase.json. */
function cspValue() {
    const fb = JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8'));
    for (const h of fb.hosting?.headers ?? [])
        for (const kv of h.headers ?? [])
            if (kv.key === 'Content-Security-Policy') return kv.value;
    throw new Error('Content-Security-Policy header not found in firebase.json');
}

test('every remote origin in the CSP is actually referenced by app code (no stale directives)', () => {
    const csp = cspValue();
    // All concrete https/wss hosts named in the CSP (ignores 'self'/'none'/data:/scheme-only).
    const origins = [...csp.matchAll(/(?:https|wss):\/\/[^\s;]+/g)].map(m => m[0]);
    // A CSP host may be a wildcard (https://*.googleapis.com); reduce to the registrable suffix so
    // we can look for it in code that names a concrete sub-host (firestore.googleapis.com, etc.).
    const suffixOf = (o) => o.replace(/^(?:https|wss):\/\//, '').replace(/^\*\./, '');
    const stale = origins.filter(o => {
        const h = suffixOf(o);
        return !APP_SOURCES.includes(h) && !DYNAMIC_HOSTS.includes(h);
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
    ];
    const covered = (host) =>
        csp.includes(`//${host}`) ||                             // verbatim
        csp.includes(`//*.${host.replace(/^[^.]+\./, '')}`);     // *.suffix wildcard
    const missing = REQUIRED.filter(h => APP_SOURCES.includes(h) && !covered(h));
    assert.deepEqual(
        missing, [],
        `App contacts these hosts but the CSP does not permit them (sign-ins/loads will silently fail):\n  ${missing.join('\n  ')}`
    );
});
