// @ts-check
/**
 * storage-keys.js — single source for the CROSS-FILE localStorage keys (v16.81 debt sweep).
 *
 * Only keys shared by more than one module live here. Per-module keys stay local to their
 * file (and the whole paycalc namespace is built by `pcPrefix()` in paycalc-migrations.js —
 * do NOT add those here). Offline-first + the iOS-safe `ls.js` wrappers mean a one-character
 * key typo silently loses staff data with no error, so every shared key having ONE spelling
 * is a real safety property, not just tidiness.
 *
 * Always read/write these via `lsGet`/`lsSet`/`lsDel` from ls.js — never `localStorage` directly.
 */

/** The member selected in the roster view — shared by the calendar member selector
 *  (calendar-member.js) and admin's member context bar (admin-app.js) so the two pages
 *  stay in sync when you hop between them. */
export const SELECTED_MEMBER = 'myb_roster_selected_member';

/** Legacy pre-v16.81 alias of SELECTED_MEMBER. No longer WRITTEN — kept only as a READ
 *  fallback in admin-app.js for one release so a device that had only the old key still
 *  restores its last member. Safe to delete once every active device has re-saved (≈ after
 *  the next 60-day session cycle). */
export const SELECTED_MEMBER_LEGACY = 'adminLastMember';

/** The month/year the calendar is currently viewing — persisted by calendar-state.js and
 *  seeded by admin so "open the calendar on the month I was editing" works. Both 0-indexed
 *  month + full year, stored as separate keys. */
export const VIEWED_MONTH = 'myb_roster_month';
export const VIEWED_YEAR  = 'myb_roster_year';

/** Prefix (+ member name) of the one-shot "a real sign-in just happened" marker that triggers the
 *  forced set-password overlay — PASSWORD_PLAN.md Phase 2. WRITTEN by login-overlay.js (the single
 *  point every protected page's sign-in passes through) and CONSUMED by password-force.js, so it is
 *  genuinely cross-file and belongs here rather than in either module. The marker is what keeps the
 *  overlay to real sign-ins only: without it the compel would ambush a member on an ordinary page
 *  load, which is the v14.77 "Fix 4" defect the work-email check's identical marker exists to stop. */
export const PW_FORCE_PENDING_PREFIX = 'myb_pw_force_pending_';

/*
 * `NOTICE_PW_OWN_DONE` lived here until v21.84, and its removal is the point rather than tidying.
 *
 * It was cross-file because `settings-app.js` reached across to retire a notice that lives on the
 * Calendar — the only page that can read `passwordStatus` silencing a notice on a page that cannot.
 * The replacement notice is addressed to the SIGNED-OUT (`calendar-access-core.js` →
 * `noticeAudienceAllows`), so it stops being shown the moment a member has a session, with nothing
 * to write and nothing for a second page to keep in step. The coupling went away rather than
 * getting a better home.
 *
 * Devices still hold the old `myb_notice_pw_own_2026_done` string. It is an inert orphan: nothing
 * reads it, and unlike the paycalc device flags (see RETIRED_DEVICE_KEYS) no code path
 * reclassifies an unknown notice key as anything.
 */
