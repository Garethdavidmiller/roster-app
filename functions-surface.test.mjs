/**
 * functions-surface.test.mjs — the deploy surface of functions/index.js, pinned.
 * Run with: npm run test:functions   (not part of `npm test` — it loads firebase-admin and
 * firebase-functions from functions/node_modules, which the plain unit environment may not have).
 *
 * WHY. Firebase discovers Cloud Functions from index.js's EXPORTS: a re-export dropped during a
 * refactor does not fail any parse or unit check — it DELETES the function on the next deploy,
 * and the first sign is a staff-facing 404 (or a silent stop, for a scheduled function nobody
 * calls). The v20.55 domain split moved nine of the eleven endpoints into ./documents.js and
 * ./auth-endpoints.js behind factory builders, so the wiring in index.js is now the only thing
 * standing between "refactored" and "undeployed" — exactly the class of seam this repo pins
 * statically (the push.js destructure check in sw-asset-check.test.mjs is the same idea one
 * level down).
 *
 * The list below is the deploy contract as of the split. Adding an endpoint should extend it —
 * that is a conscious act. Removing one should fail here first, in CI, rather than in production.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// The nineteen deployed functions. Order-insensitive; names are what `firebase deploy` sees.
const DEPLOY_SURFACE = [
    'ingestHuddle',
    // v24.16 — the short-lived document URL (owner decision, AUTH_PLAN.md E6). A DEPLOYED function,
    // so it belongs in this list deliberately rather than by accident, which is what this guard is
    // for. It needs an IAM grant to work: see functions/documents.js's header.
    'getDocumentUrl',
    'onHuddleCreated',
    'onCircularCreated',
    'onNewsletterCreated',
    'sendPayReminderNotification',
    'parseRosterPDF',
    'setupRosterAuth',
    'resetMemberPassword',
    'requestPasswordReset',
    'getSignInStats',
    'getAccountSetupGaps',
    'unlockCalendarViewer',
    // Overtime Availability (v20.56). Two of these fail SILENTLY if they are ever lost in a
    // refactor, which is why they are called out rather than just listed:
    // getOvertimeManagerOverview is the ONLY thing that shows a week nobody created, so its
    // absence looks like "no overtime needed" rather than like a missing function; and
    // autoCreateOvertimeWindows (v20.61) is a SCHEDULED job, so nothing user-facing calls it —
    // losing it means windows quietly stop being made, which the horizon would then report as a
    // human forgetting.
    'createOvertimeWindow',
    'autoCreateOvertimeWindows',
    'getOvertimeManagerOverview',
    'getMyOvertimeState',
    'submitOvertimeAvailability',
    'withdrawOvertimeParticipant',
    'purgeExpiredOvertimeWindows',
];

test('functions/index.js exports exactly the deployed function surface', () => {
    // FUNCTIONS_EMULATOR silences the SDK's production-credential probing at load; the module's
    // top level only DEFINES endpoints (no network), so a plain require is safe and fast.
    process.env.FUNCTIONS_EMULATOR = 'true';
    const index = require('./functions/index.js');
    const got = Object.keys(index).sort();
    assert.deepEqual(got, [...DEPLOY_SURFACE].sort(),
        'functions/index.js exports drifted from the deploy contract. A missing name here is a ' +
        'function DELETED on the next deploy; an extra one is a new deployment nobody reviewed. ' +
        'If the change is intentional, update DEPLOY_SURFACE in the same commit.');
});

test('every exported endpoint is a defined function value, not undefined wiring', () => {
    // Object.assign(exports, buildX(deps)) with a builder that returned undefined for a key would
    // still put the KEY on exports — the name check above would pass while the deploy broke.
    const index = require('./functions/index.js');
    for (const name of DEPLOY_SURFACE) {
        assert.ok(index[name], `exports.${name} is ${String(index[name])} — the factory wiring lost it`);
    }
});

// ── EVERY HANDLER THAT CAN PUSH DECLARES THE VAPID SECRET (Sep 2026 review) ─────────────────────
//
// A Cloud Function only sees a Secret Manager value if the secret is in its own `secrets` option;
// without it `VAPID_PRIVATE_KEY.value()` is '' in production, `setupWebPush` throws, and the handler's
// best-effort push catch swallows it. So a handler can ship with the push wired, tested with a mocked
// transport, and never send one — which is how `resetMemberPassword`'s "your password was reset"
// notice went out from v23.62 to nobody. The handler that reaches `setupWebPush` is found FROM THE
// SOURCE (through any same-file helper, to a fixpoint), and the secret is read from the deploy
// metadata the SDK attaches — the thing `firebase deploy` actually reads.
test('every handler that reaches setupWebPush declares the VAPID_PRIVATE_KEY secret', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    process.env.FUNCTIONS_EMULATOR = 'true';
    const index = require('./functions/index.js');
    // A definition starts at the head of a line indented 0 or 4 (a builder's handlers sit at 4), and
    // runs to the next head indented no deeper than itself — so a column-0 helper keeps the
    // statements its own body declares at 4.
    const HEAD = /^( {0,4})(?:exports\.(\w+)\s*=|const (\w+)\s*=|(?:async )?function (\w+)\s*\()/gm;
    const pushers = [];
    for (const f of readdirSync(new URL('./functions/', import.meta.url)).filter(n => n.endsWith('.js'))) {
        const src = readFileSync(new URL(`./functions/${f}`, import.meta.url), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
        const heads = [...src.matchAll(HEAD)];
        const defs = heads.map((m, i) => {
            const end = heads.slice(i + 1).find(n => n[1].length <= m[1].length);
            return { name: m[2] || m[3] || m[4], body: src.slice(m.index, end ? end.index : src.length) };
        });
        const reaching = new Set(['setupWebPush']);
        const calls = (/** @type {string} */ body) => [...reaching].some(n => new RegExp(`(?<![\\w.$])${n}\\(`).test(body));
        for (let grew = true; grew;) {
            grew = false;
            for (const d of defs) if (!reaching.has(d.name) && calls(d.body)) { reaching.add(d.name); grew = true; }
        }
        for (const d of defs) {
            if (/=\s*on(?:Request|Schedule|Document\w+)\(/.test(d.body.slice(0, 120)) && calls(d.body)) pushers.push(d.name);
        }
    }
    assert.ok(pushers.length >= 8, `found only ${pushers.length} pushing handlers — the scan is checking nothing: ${pushers}`);
    for (const name of pushers) {
        assert.ok(index[name], `${name} reaches setupWebPush but is not an exported function`);
        const keys = ((index[name].__endpoint || {}).secretEnvironmentVariables || []).map((/** @type {any} */ s) => s.key);
        assert.ok(keys.includes('VAPID_PRIVATE_KEY'),
            `${name} can send a push but does not declare secrets: [VAPID_PRIVATE_KEY] — in production the key reads as '' and every push it sends fails inside a best-effort catch`);
    }
});
