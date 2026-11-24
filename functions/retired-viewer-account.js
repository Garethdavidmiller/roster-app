'use strict';

/**
 * functions/retired-viewer-account.js — the retired staff PIN's shared account, recognised so that
 * nothing on the server adopts it. CommonJS, pure, and nothing from functions/node_modules.
 *
 * ── WHY THIS OUTLIVES THE PIN'S ENDPOINT ────────────────────────────────────────────────────────
 *
 * The shared staff PIN was retired on 23 Nov 2026 (DECISIONS.md → "The staff PIN retired"), and the
 * server release deleted everything that let it in: `unlockCalendarViewer`, its throttle and its
 * lockout notice (calendar-viewer-auth.js and pin-lockout.js went with it), the rules' grant and the
 * viewer door in `getDocumentUrl`. What it could NOT delete is the account itself, uid
 * `calendar-viewer` — that is the owner's manual step, done in the Firebase console after the
 * release deploys (OPERATIONS_REFERENCE.md → "The staff PIN (retired)", step 1).
 *
 * Until then the account exists, and a session on it may still be open on some device: a refresh
 * token outlives the endpoint that minted it. Any such holder can link an email and password to the
 * account, and an email under `@myb-roster.local` would put it in front of Set up accounts, the
 * leaver sweep, a reset, the audit and the targeted notices — each of which could adopt it as a
 * member, give it a known password or disable it. So those five keep asking `isViewerAccount` and
 * refuse it. The rules no longer grant its claim anything, so this is not access control; it keeps
 * a stray account out of the server's own bookkeeping.
 *
 * DELETE IN THE CLEANUP RELEASE, with the client's transition code, once the account is gone: no
 * account then answers to the uid or carries the claim.
 */

/** The shared viewer's uid. Must match `CALENDAR_VIEWER_UID` in calendar-access-core.js, which the
 *  client keeps until the cleanup release to recognise a leftover session — asserted by
 *  calendar-viewer-parity.test.mjs, across the ESM/CommonJS boundary this repo cannot bridge without
 *  a build step. */
const CALENDAR_VIEWER_UID = 'calendar-viewer';

/**
 * Is this Auth account the retired shared viewer — by uid, or by carrying the viewer claim? Set up
 * accounts, the leaver sweep, a reset, the audit and the targeted notices must never adopt, stamp,
 * reset, disable or address it, whatever email somebody linked to it.
 * @param {{ uid?: string, customClaims?: Record<string, any>|null }|null|undefined} record
 * @returns {boolean}
 */
function isViewerAccount(record) {
    if (!record || typeof record !== 'object') return false;
    return record.uid === CALENDAR_VIEWER_UID || !!(record.customClaims && record.customClaims.calendarViewer === true);
}

module.exports = { CALENDAR_VIEWER_UID, isViewerAccount };
