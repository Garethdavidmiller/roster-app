/**
 * Static guard: every paycalc localStorage key stays compatible with per-member isolation AND with
 * the backup format. Run: node --test paycalc-key-parity.test.mjs   (part of `npm run test:hygiene`)
 *
 * WHY THIS EXISTS — the owner's question, Jul 2026: "the pay data function probably needs to be
 * checked every time a significant pay calculator change happens?" Yes — and a habit someone has to
 * remember is the weakest form of that, so it is a test instead.
 *
 * Both failure modes here are SILENT, which is what makes them worth a guard:
 *
 *   · A key built WITHOUT `pcPrefix()` is not namespaced, so on a shared device two members read
 *     each other's pay figures — the exact thing the v14.11 namespacing exists to prevent. It is
 *     also invisible to `selectBackupKeys`, so it never appears in a backup.
 *   · A key whose tail is not `[A-Za-z0-9_]+` fails `paycalc-transfer.js`'s KEY_RE and is dropped
 *     from every backup silently — the member is told "Restored", and that key simply is not there.
 *
 * Neither throws, neither logs, and neither shows up in any other test. Nothing else in the suite
 * looks at key SHAPE — `paycalc-transfer.test.mjs` tests the rules against keys it makes up itself,
 * which cannot notice a real key that stopped conforming.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DEVICE_KEYS, RETIRED_DEVICE_KEYS } from './paycalc-migrations.js';
import { TAX_YEARS } from './paycalc-calc.js';

/** The shape `paycalc-transfer.js` accepts. Kept as a literal, deliberately: importing the module's
 *  private KEY_RE is impossible, and a copy that DIVERGES is exactly what this test should catch. */
const KEY_RE = /^myb_pc_[A-Za-z0-9_]+$/;

const SOURCES = readdirSync('.').filter(f => f.endsWith('.js') && !f.endsWith('.test.mjs'));
const ALL_SRC = SOURCES.map(f => readFileSync(f, 'utf8')).join('\n');

describe('hardcoded myb_pc_ keys must be declared device-level', () => {
    test('every literal key in the app is in DEVICE_KEYS', () => {
        // A hardcoded literal is BY DEFINITION not namespaced. So it is either a genuine
        // device-level flag — which must be declared, so the backup excludes it and it cannot be
        // carried to a fresh device (importing `ns_migrated` would suppress the legacy-ownership
        // prompt on a device that needs it) — or it is member data with no per-member isolation,
        // which is a privacy bug on a shared device.
        const literals = [...ALL_SRC.matchAll(/'(myb_pc_[a-z0-9_]+)'/g)]
            .map(m => m[1])
            .filter(k => k !== 'myb_pc_');            // the bare prefix itself, in pcPrefix()
        const undeclared = [...new Set(literals)].filter(k => !DEVICE_KEYS.has(k)).sort();
        assert.deepEqual(undeclared, [],
            `These keys are hardcoded (so NOT per-member namespaced) but are not in DEVICE_KEYS:\n  `
            + undeclared.join('\n  ')
            + '\nEither build them with pcPrefix() so each member gets their own, or add them to '
            + 'DEVICE_KEYS if they genuinely describe the browser rather than the member.');
    });

    test('DEVICE_KEYS has no ghosts (RETIRED keys exempt — having no writer is the point)', () => {
        // A stale entry is harmless to behaviour but means the list has drifted from the code, and
        // this list is what the backup path trusts to decide what NOT to carry.
        //
        // RETIRED_DEVICE_KEYS are deliberately exempt. A retired key by definition has no writer left
        // — that is what retiring a feature means — but it still SITS on devices, so it must stay
        // classified as device-level. Demanding a writer for those is what made v19.36 delete
        // `myb_pc_pay_welcome_shown` outright and fire the pay-data ownership prompt at members with
        // no legacy data at all. The exemption is the fix; do not "tidy" it away.
        const ghosts = [...DEVICE_KEYS]
            .filter(k => !RETIRED_DEVICE_KEYS.has(k))
            .filter(k => !ALL_SRC.includes(`'${k}'`)).sort();
        assert.deepEqual(ghosts, [], `DEVICE_KEYS entries that appear nowhere in the source: ${ghosts.join(', ')}`);
    });

    test('a retired device key is still excluded from a backup', () => {
        // The other half of DEVICE_KEYS' job. Carrying a retired flag to a fresh device would
        // re-apply a decision made on the old one — the same reason `ns_migrated` is excluded.
        for (const k of RETIRED_DEVICE_KEYS) {
            assert.ok(DEVICE_KEYS.has(k), `${k} must remain in DEVICE_KEYS while it exists in the wild`);
        }
    });
});

describe('namespaced keys must survive a backup', () => {
    test('every pcPrefix()-built tail is KEY_RE-safe', () => {
        // Matches both `${pcPrefix()}tail` and the `const p = pcPrefix()` form used by _rebuildSK.
        // The capture runs to the end of the LITERAL segment — the closing quote/backtick, or the
        // start of the next `${…}` interpolation (`p${pNum}`, `hpp_est_${ty.label…}`). It must NOT
        // be written as `([A-Za-z0-9_]*)`: a capture class listing only the LEGAL characters can
        // never see an illegal one — given `${p}sl-paid-off` it captures `sl` and the assertion
        // passes, which is the whole contract silently doing nothing. (It did, first time round.)
        const tails = [...ALL_SRC.matchAll(/\$\{p(?:cPrefix\(\))?\}([^`'"$\n]*)/g)].map(m => m[1]);
        assert.ok(tails.length > 15, `expected to find the paycalc key builders, found ${tails.length}`);
        const bad = [...new Set(tails)].filter(t => t && !KEY_RE.test(`myb_pc_${t}x`)).sort();
        assert.deepEqual(bad, [],
            `These key tails would fail paycalc-transfer.js's KEY_RE and be dropped from every `
            + `backup silently:\n  ${bad.join('\n  ')}`);
    });

    test('a tail containing anything but letters, digits or _ is rejected', () => {
        // Pins the rule itself, so the test above cannot be weakened into a no-op.
        for (const bad of ['ytd-pay', 'ytd.pay', 'ytd pay', 'ytd/pay'])
            assert.equal(KEY_RE.test(`myb_pc_${bad}`), false, bad);
        for (const ok of ['p16', 'hpp_est_2026_27', 'sl_paid_off', 'snap_54'])
            assert.equal(KEY_RE.test(`myb_pc_${ok}`), true, ok);
    });
});

describe('per-tax-year keys — the annual-edit hazard', () => {
    test('every TAX_YEARS label survives the /→_ transform as a safe key segment', () => {
        // The one DYNAMIC key segment that is not a plain number. TAX_YEARS is hand-edited every
        // year (the docs say "add the following year with pre = this rate"), so a label like
        // "2027/28 (est)" or "2027-28" would silently break hpp_est_/bp_state_/ytd_pay_ for that
        // year — every backup would quietly omit it, and the member would be told "Restored".
        const bad = TAX_YEARS
            .map(ty => ({ label: ty.label, seg: ty.label.replace('/', '_') }))
            .filter(({ seg }) => !KEY_RE.test(`myb_pc_hpp_est_${seg}`))
            .map(({ label, seg }) => `${label} → ${seg}`);
        assert.deepEqual(bad, [],
            `These tax-year labels do not produce a valid key segment:\n  ${bad.join('\n  ')}\n`
            + 'Keep labels to the YYYY/YY form — only the single "/" is transformed.');
    });
});
