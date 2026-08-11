// @ts-check
/**
 * csp-meta-parity.test.mjs (v17.63) — keep every served HTML page's <meta http-equiv=
 * "Content-Security-Policy"> in lockstep with the firebase.json CSP HEADER.
 *
 * WHY a meta CSP exists at all: the app is served from two origins — Firebase Hosting (primary,
 * which applies the firebase.json header) AND the GitHub Pages staff mirror
 * (garethdavidmiller.github.io/roster-app/). GitHub Pages CANNOT serve custom HTTP headers, so the
 * header CSP never reaches the mirror. A <meta http-equiv> CSP embedded in each page closes that gap:
 * it is enforced by the browser on BOTH origins and, being part of the HTML, travels through the SW
 * cache too. On Firebase the page then carries header + meta (identical → same enforcement); on the
 * mirror the meta is the only CSP.
 *
 * This test fails the build if any page's meta drifts from the header — the same anti-drift discipline
 * csp-hygiene.test.mjs applies to the header itself. A <meta> CSP cannot express a few directives
 * (browsers ignore them there), so those are excluded from the expected meta and must NOT appear in it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));

// Directives a <meta http-equiv="CSP"> cannot express — browsers ignore them when delivered via meta.
// Kept out of the expected meta; asserted absent so no one is misled into thinking they apply there.
const META_INCOMPATIBLE = new Set(['frame-ancestors', 'report-uri', 'report-to', 'sandbox']);

const SERVED_HTML = ['index.html', 'admin.html', 'paycalc.html', 'operations.html', 'settings.html',
    'links.html', 'overtime.html', 'guide.html', 'paycalc-guide.html', 'railcard-guide.html', 'fip.html'];

/** Parse a CSP string into a Map(directive → sorted-value-string), order-independent. */
function parseCsp(csp) {
    const map = new Map();
    for (const part of csp.split(';').map(s => s.trim()).filter(Boolean)) {
        const [name, ...vals] = part.split(/\s+/);
        map.set(name.toLowerCase(), vals.slice().sort().join(' '));
    }
    return map;
}

/** The firebase.json CSP header value. */
function headerCsp() {
    const fb = JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8'));
    for (const h of fb.hosting?.headers ?? [])
        for (const kv of h.headers ?? [])
            if (kv.key === 'Content-Security-Policy') return kv.value;
    throw new Error('Content-Security-Policy header not found in firebase.json');
}

/** Extract the meta CSP content from an HTML file (null if absent). */
function metaCsp(html) {
    // The content attribute is double-quoted and its value contains single quotes ('self'), so the
    // delimiter class must exclude only the double quote (not both) or it truncates at the first 'self'.
    const m = html.match(/<meta\s+http-equiv=["']Content-Security-Policy["']\s+content="([^"]+)"/i);
    return m ? m[1] : null;
}

const header = parseCsp(headerCsp());
// Expected meta = the header minus the meta-incompatible directives.
const expectedMeta = new Map([...header].filter(([name]) => !META_INCOMPATIBLE.has(name)));

test('the header actually contains at least one meta-incompatible directive (else this guard is moot)', () => {
    // frame-ancestors 'none' is the real one today; if the header ever drops all of them this test
    // still passes (expectedMeta === header), it just flags that the exclusion set is now inert.
    const present = [...header.keys()].filter(k => META_INCOMPATIBLE.has(k));
    assert.ok(present.length >= 1, 'expected the header to carry frame-ancestors (or another meta-incompatible directive)');
});

for (const file of SERVED_HTML) {
    test(`${file}: meta CSP mirrors the header (minus meta-incompatible directives)`, () => {
        const html = readFileSync(join(ROOT, file), 'utf8');
        const raw = metaCsp(html);
        assert.ok(raw, `${file} must carry a <meta http-equiv="Content-Security-Policy"> (GitHub Pages parity)`);
        const meta = parseCsp(raw);

        // No meta-incompatible directive should be present (they'd be silently ignored → misleading).
        for (const name of meta.keys())
            assert.ok(!META_INCOMPATIBLE.has(name),
                `${file}: meta CSP contains "${name}", which a <meta> CSP cannot enforce — remove it`);

        // Every expected directive present with the exact same value…
        for (const [name, val] of expectedMeta) {
            assert.ok(meta.has(name), `${file}: meta CSP is missing "${name}" (present in the header)`);
            assert.equal(meta.get(name), val,
                `${file}: meta CSP "${name}" = "${meta.get(name)}" but the header has "${val}"`);
        }
        // …and no EXTRA directive beyond what the header defines.
        for (const name of meta.keys())
            assert.ok(expectedMeta.has(name), `${file}: meta CSP has "${name}", absent from the header`);
    });
}
