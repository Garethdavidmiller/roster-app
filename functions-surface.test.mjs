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

// The eighteen deployed functions. Order-insensitive; names are what `firebase deploy` sees.
const DEPLOY_SURFACE = [
    'ingestHuddle',
    'onHuddleCreated',
    'onCircularCreated',
    'onNewsletterCreated',
    'sendPayReminderNotification',
    'parseRosterPDF',
    'setupRosterAuth',
    'resetMemberPassword',
    'requestPasswordReset',
    'getSignInStats',
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
