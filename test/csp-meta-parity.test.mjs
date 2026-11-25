// @ts-check
/**
 * csp-meta-parity.test.mjs (v17.63; the copies generated since 25 Nov 2026) — the RULE by which every served page's
 * <meta http-equiv="Content-Security-Policy"> follows the firebase.json CSP HEADER.
 *
 * WHY a meta CSP exists at all: the app is served from two origins — Firebase Hosting (primary,
 * which applies the firebase.json header) AND the GitHub Pages staff mirror
 * (garethdavidmiller.github.io/roster-app/). GitHub Pages CANNOT serve custom HTTP headers, so the
 * header CSP never reaches the mirror. A <meta http-equiv> CSP embedded in each page closes that gap:
 * it is enforced by the browser on BOTH origins and, being part of the HTML, travels through the SW
 * cache too. On Firebase the page then carries header + meta (identical → same enforcement); on the
 * mirror the meta is the only CSP.
 *
 * THE COPIES ARE WRITTEN, NOT KEPT. Until 25 Nov 2026 this file compared sixteen hand-kept <meta> tags
 * with the header and failed when one was forgotten. `npm run generate:copies`
 * (scripts/generate-copies.mjs → `csp-meta`) now writes every page's tag from the header, and
 * generated-copies.test.mjs fails when a committed page is not what it would write. What stays here
 * is the part that is a RULE rather than a copy, checked by an independent reading so that a bug in
 * the generator cannot pass for a current file: the meta is the header, directive for directive,
 * minus the few a <meta> cannot express — which must not appear in it, or a reader is misled into
 * thinking they apply on the mirror.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { headerCsp, metaCspFor, META_INCOMPATIBLE } from '../scripts/generate-copies.mjs';

// Tests live in test/ but address files from the repository root (moved 24 Nov 2026).
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (/** @type {string} */ f) => readFileSync(join(ROOT, f), 'utf8');

/** Parse a CSP string into a Map(directive → sorted-value-string), order-independent. */
function parseCsp(/** @type {string} */ csp) {
    const map = new Map();
    for (const part of csp.split(';').map(s => s.trim()).filter(Boolean)) {
        const [name, ...vals] = part.split(/\s+/);
        map.set(name.toLowerCase(), vals.slice().sort().join(' '));
    }
    return map;
}

const INCOMPATIBLE = new Set(META_INCOMPATIBLE);
const header = parseCsp(headerCsp(read));
const meta = parseCsp(metaCspFor(headerCsp(read)));

test('the header actually contains at least one meta-incompatible directive (else this guard is moot)', () => {
    // frame-ancestors 'none' is the real one today; if the header ever drops all of them this test
    // still passes (meta === header), it just flags that the exclusion set is now inert.
    const present = [...header.keys()].filter(k => INCOMPATIBLE.has(k));
    assert.ok(present.length >= 1, 'expected the header to carry frame-ancestors (or another meta-incompatible directive)');
});

test('the generated meta is the header minus the meta-incompatible directives, value for value', () => {
    for (const name of meta.keys())
        assert.ok(!INCOMPATIBLE.has(name), `the generated meta CSP contains "${name}", which a <meta> CSP cannot enforce`);
    for (const [name, val] of header) {
        if (INCOMPATIBLE.has(name)) continue;
        assert.ok(meta.has(name), `the generated meta CSP is missing "${name}" (present in the header)`);
        assert.equal(meta.get(name), val, `the generated meta CSP "${name}" = "${meta.get(name)}" but the header has "${val}"`);
    }
    for (const name of meta.keys())
        assert.ok(header.has(name), `the generated meta CSP has "${name}", absent from the header`);
});

test('the generator refuses a header value that would break out of the attribute', () => {
    assert.throws(() => metaCspFor(`default-src 'self'; script-src "x"`), /double quote/);
});
