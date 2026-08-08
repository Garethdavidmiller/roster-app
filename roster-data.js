// @ts-check
// MYB Roster — Shared Data
// Single source of truth for roster configuration, team members, and shift patterns.
// ES module — import named exports into consuming files:
//   import { CONFIG, APP_VERSION, teamMembers, weeklyRoster, ... } from './roster-data.js';
//
// APP_VERSION is the single authoritative version number. Both HTML files read it at runtime
// via CONFIG.APP_VERSION (set below). Browser HTTP cache is handled by Cache-Control: no-cache
// headers in firebase.json — no ?v= query strings needed. Service worker cache is invalidated
// automatically by the CACHE_NAME in service-worker.js, which embeds APP_VERSION.

/** Single source of truth for the app version. Update this on every commit that touches app behaviour. */
export const APP_VERSION = '19.97';

// ============================================
// PERFORMANCE CACHES — declared early so they're out of TDZ before any
// function that uses them runs (formatISO is called during module load
// from date helpers during module load.
// ============================================
const _isoCache = new Map();
const _isoCacheMax = 64;

// ============================================
// CONFIGURATION
// ============================================

export const CONFIG = {
    MAIN_ROSTER_WEEKS:                20,
    BILINGUAL_ROSTER_WEEKS:           8,
    CES_ROSTER_WEEKS:                 10,
    DISPATCHER_ROSTER_WEEKS:          10,                                        // 10-week rotating cycle
    PAYDAY_INTERVAL_DAYS:             28,                                        // Every 4 weeks
    FIRST_PAYDAY:                     new Date(2026, 1, 13, 12, 0, 0),          // Feb 13, 2026
    MAIN_ROSTER_REFERENCE_DATE:       new Date(2026, 1, 8,  12, 0, 0),          // Feb 8, 2026 (G. Miller on Week 3)
    BILINGUAL_ROSTER_REFERENCE_DATE:  new Date(2026, 1, 15, 12, 0, 0),          // Feb 15, 2026 (D. Irvine on BL Week 3)
    CES_ROSTER_REFERENCE_DATE:        new Date(2026, 1, 15, 12, 0, 0),          // Feb 15, 2026 (F. Mohamed on CES Week 1)
    DISPATCHER_ROSTER_REFERENCE_DATE: new Date(2026, 1, 1,  12, 0, 0),          // Feb 1, 2026 (Minto on Week 1, all 10 consecutive)
    MIN_YEAR:                         2024,                                      // Earliest navigable year
    MAX_YEAR:                         2030,                                      // Latest navigable year — extend to 2032+ by end of 2028; update lunar calendar data first
    EARLY_START_THRESHOLD:            4,                                         // Shifts starting 04:00–10:59 are Early
    EARLY_SHIFT_THRESHOLD:            11,                                        // Shifts starting 11:00–20:59 are Late
    NIGHT_START_THRESHOLD:            21,                                        // Shifts starting 21:00–03:59 are Night
    DEFAULT_MEMBER_NAME:              'G. Miller',                               // Default selection in index.html
    ADMIN_NAMES:                      ['G. Miller'],                              // Names with elevated admin access (roster upload, huddle upload, auth setup) — add names here to grant full admin rights
    LINKS_DESIGNERS:                  ['G. Miller', 'S. Silva', 'M. Robson'],     // Names with access to the Links design workspace
    MANAGER_NAMES:                    ['S. Stewart', 'D. Watts', 'D. Harris', 'S. Gumbo', 'N. Bedingfield', 'H. Croft'], // Managers & clerks — can view/edit all staff data but cannot access master admin features (upload, auth setup)
    GRADE_ORDER:                      ['CEA', 'CES', 'Dispatcher', 'Management'], // Grade grouping order — single source for the login dropdown optgroups (login-overlay.js) AND the admin member-selector optgroups (admin-app.js), so the two can't drift
    WORK_EMAIL_DOMAIN:               'chilternrailways.co.uk',                   // Authoritative Chiltern work-email domain — single source for the auto-append + the staffContact domain validation (settings/operations/admin + firestore.rules)
    // Security release B1 kill-switch (SECURITY_RELEASE_PLAN.md → "Appendix: B1 detailed scope").
    // ENABLED (true, v14.42). The write pages (admin/operations/settings/links) require the
    //   member's OWN named Firebase session — no anonymous fallback and no browser-side account
    //   creation; paycalc stays soft (never blocks). Enabled after the owner confirmed every
    //   active account is provisioned (Operations → Set up accounts) and the account list matches
    //   current staff.
    // ⚠️ KILL-SWITCH / REVERT: set this back to `false` (a one-line deploy, no rules or data
    //   change) to instantly restore the pre-B1 behaviour — anonymous fallback + self-heal — if
    //   any staff member is unexpectedly bounced to re-login and cannot get back in.
    // ⚠️ TEMPORARILY DISABLED (v14.72) — staff reported freezing on the login overlay even when
    //   signed in (B1 re-login loop: a write page can't confirm the named session, clears it, and
    //   re-shows the overlay). Reverted to pre-B1 behaviour to restore access while the root cause is
    //   diagnosed. See SECURITY_RELEASE_PLAN.md → B1 kill-switch.
    // ✅ RE-ENABLED (v14.98) — the freeze root cause is FIXED: runNamedSignIn now commits the local
    //   session ONLY after auth resolves (v14.75), reinforced by the stale-auth generation guard
    //   (v14.87); and B1 was EXONERATED in diagnosis (the freeze persisted with B1 OFF, so B1 was
    //   never the cause). The KILL-SWITCH above still applies — set back to `false` to revert instantly.
    // ⚠️ NOW SAFETY-COUPLED WITH B3 STRICT RULES: with the no-name override-write escape removed
    //   (firestore.rules, B3 v16.29), only a named/admin/manager session can write overrides. That is
    //   safe ONLY because this flag is `true` — it disables the anonymous fallback + account self-heal
    //   in session.js, so no no-name session ever reaches an override write. If you flip this back to
    //   `false`, anonymous-fallback sessions would be silently DENIED override writes by the strict rule.
    ENFORCE_NAMED_SESSION:            true,
    // Phase 2 of PASSWORD_PLAN.md — compel un-migrated members to set their own password at their
    // NEXT SIGN-IN (password-force.js). This is the KILL SWITCH: set to `false` to stop compelling
    // instantly, with no other change. Everything else the feature needs (the Settings card, the
    // admin reset, `passwordStatus`) shipped at v18.63 and is unaffected by this flag.
    //
    // Why compelling is safe to switch on: the overlay only appears right after a confirmed sign-in,
    // only for a `named` identity, and only when `passwordStatus` says the member is still on the
    // surname default — and the calendar is NOT behind it, so a member who can't get past it can
    // still see their roster. It fails open both before showing (read failure / wrong identity) and
    // after (rate-limit / network → a "Continue for now" escape). See password-force.js's header.
    //
    // No forced sign-out is needed to drive this: sessions cap at 30 days absolute / 7 days idle, and
    // an expired session forces a real typed login, so coverage completes itself inside 30 days and
    // staggers by each member's own expiry rather than landing on everyone at once.
    FORCE_PASSWORD_SET:               true,
    // How long the calendar's `pw-own-2026` notice keeps showing on a device that has not yet seen
    // it, in days from its 6 Aug 2026 posting date (calendar-app.js). CONFIGURABLE ON PURPOSE
    // (v19.91, external review): `isNoticeExpired` marks a notice seen WITHOUT showing it, so on the
    // day this window closes the notice becomes dead code everywhere it had not already appeared.
    //
    // That is right for an announcement and WRONG here, because this notice's job does not end on a
    // date — it ends when the surname default is retired (SECURITY_RELEASE_PLAN → Track C5, gated on
    // ~90% migrated). Those two are not the same event, and nothing links them: if adoption is short
    // of the threshold in early November 2026 the only channel that reaches roster-only staff — the
    // people who never sign in anywhere, and so are exactly the un-migrated ones — disappears
    // silently, with the notice table still listing it as live.
    //
    // So the window is a BACKSTOP with a review date, not the plan. Extending it is a one-value
    // change here rather than an edit to page logic. **Review by 4 Nov 2026**: either retire the
    // notice because C5 has shipped, or raise this number and move the review date with it.
    PASSWORD_NOTICE_DAYS:             90,
    // The "ask the admin to reset my password" request queue (PASSWORD_PLAN.md — Phase 1 of the request
    // work). Kill switch for the LINK only: setting this to `false` hides it on the login overlay and
    // nobody can file a new request. It does NOT disable the endpoint (that is a functions deploy) or
    // hide the Operations card, so any requests already filed remain visible and actionable.
    PASSWORD_RESET_REQUESTS:          true,
    // B3 claim-refresh sweep (SECURITY_RELEASE_PLAN.md → B3). Bump this integer to force every
    // device to refresh its Firebase ID token ONCE on next app open — picking up newly-set custom
    // claims (e.g. the B2 `manager` claim) immediately instead of waiting for the ~hourly
    // auto-refresh. Gated per-device by localStorage `myb_claim_epoch`; a force-refresh is a no-op
    // when the token is already current, so bumping is harmless. Do NOT bump CLAIM_EPOCH casually —
    // each bump forces every device to re-refresh its ID token on next open; only bump when a new
    // custom-claim change genuinely needs to reach every active session before a rule relies on it.
    // Was DISABLED (0) alongside the B1 kill-switch (v14.72) while diagnosing the login freeze.
    //   ARMED (2) at v15.33 to run the B3 pre-cutover token sweep: managers were re-provisioned
    //   (Jul 2026), so this forces every active device to pick up its correct-tier claim on next
    //   open. Set to 2 — NOT 1 — because 1 already shipped once (v14.71) so some devices recorded
    //   `myb_claim_epoch=1`; only a value above every previously-shipped epoch re-sweeps them all.
    //   The sweep has SETTLED and the B3 STRICT override-isolation rule shipped (v16.29): the
    //   no-name/legacy escape is gone and overrides now require a matching `name`/admin/manager claim.
    //   See SECURITY_RELEASE_PLAN.md → B3.
    CLAIM_EPOCH:                      2,
    // In-place sign-in (ARCHITECTURE_PLAN.md → "Phase 9 — Remove the post-login reload"). When a
    // protected page's login overlay confirms a sign-in, OFF (false) = today's behaviour: the
    // overlay's onSuccess does `window.location.reload()` and the reloaded page re-runs init. ON
    // (true) = the page initialises in place — the coordinator's authorised body runs directly and
    // the overlay is torn down — no reload, no white flash, no second auth-restore.
    //
    // PER-PAGE (not a single global switch) so the rollout has a SMALL blast radius — turn it on for
    // ONE coordinator, watch it live for a few days, roll back just that page if needed. This is NOT
    // the B1 (ENFORCE_NAMED_SESSION) class of risk: INPLACE only changes what happens AFTER an already-
    // confirmed sign-in (render-in-place vs reload), the sign-in/session/identity are byte-for-byte the
    // same, and every in-place path falls back to `reload()` if it throws — so a bad page self-heals to
    // today's behaviour and can never lock anyone out. Recommended order: paycalc/operations first,
    // admin last (highest-traffic, most-wired). Each coordinator reads ONLY its own key.
    // ⚠️ KILL-SWITCH: set any key back to `false` to instantly restore that page's reload path.
    //   ROLLOUT COMPLETE: paycalc (v15.07), operations (v15.08), links (v15.09), admin (v15.16),
    //   settings (v15.17) — all five coordinators now in-place. Login confirmed stable (freeze fixed
    //   v14.75, B1 re-enabled v14.98). settings was last because it is the one page that inits its nav
    //   while UNSIGNED; its authorised body refreshes the nav identity after an in-place sign-in.
    //   The per-page kill-switch above still stands — set any key back to `false` to revert that page.
    INPLACE_LOGIN:                    { operations: true, links: true, paycalc: true, admin: true, settings: true },
    SUPPORT_EMAIL:                    'Gareth.Miller@chilternrailways.co.uk',     // Bug report destination — update here if the address ever changes
    APP_VERSION,                                                                   // Mirrors top-level APP_VERSION for backward compatibility with consuming files
};

// ============================================
// TEAM MEMBERS
// ============================================
//
// Member object shape:
//   name           {string}  Display name
//   currentWeek    {number}  Week number this member is on as of the reference date for their rosterType
//   rosterType     {string}  'main' | 'bilingual' | 'fixed' | 'ces' | 'dispatcher'
//   role           {string}  'CEA' | 'CES' | 'Dispatcher' | 'Management' — controls dropdown grouping
//   hidden         {boolean} Optional. true = vacancy/removed; excluded from dropdown, data preserved
//   managerOnly    {boolean} Optional. true = management/clerk login; hidden from staff selector; appears in login dropdown under "Management" group
//   permanentShift {string}  Optional. 'early' | 'late' — overrides badge colour on worked days,
//                            suppresses shift time. Remove to restore normal roster display.
//   rosterChanges  {Array}   Optional. Scheduled roster moves, e.g. a new starter on a
//                            temporary fixed pattern who later joins a rotating link.
//                            Each entry: { from: Date, rosterType, currentWeek }. From `from`
//                            (midnight, inclusive) onward the member follows that rosterType/
//                            currentWeek instead of the base fields. Must be sorted ascending
//                            by `from`; the latest entry whose `from` ≤ date wins. Resolved by
//                            resolveMemberRoster() — getBaseShift/getWeekNumberForDate apply it
//                            automatically, so no call site needs special handling.

export const teamMembers = [
    { name: 'L. Springer',             currentWeek: 1,  rosterType: 'main',       role: 'CEA' },
    { name: 'A. Hared',                currentWeek: 2,  rosterType: 'main',       role: 'CEA' },
    { name: 'G. Miller',               currentWeek: 3,  rosterType: 'main',       role: 'CEA' },
    { name: 'M. Robson',               currentWeek: 4,  rosterType: 'main',       role: 'CEA' },
    { name: 'J. Davies',               currentWeek: 5,  rosterType: 'main',       role: 'CEA', startDate: new Date(2026, 4, 5), proRatedAL: { 2026: 22 } },
    { name: 'I. Cooper',               currentWeek: 6,  rosterType: 'main',       role: 'CEA' },
    { name: 'A. Panchal',              currentWeek: 7,  rosterType: 'main',       role: 'CEA' },
    { name: 'C. Francisco-Charles',    currentWeek: 8,  rosterType: 'main',       role: 'CEA' },
    { name: 'O. Mylla',                currentWeek: 9,  rosterType: 'main',       role: 'CEA' },
    // Temporary move to fixed pattern 2 (09:00–16:00 Mon–Fri) from Sun 28 Jun 2026 via
    // rosterChanges — base stays main wk10 until then, so she only leaves the link from
    // 28 Jun (vacating wk10, the slot after O. Mylla — taken by new starter K. Jedlinski).
    // AL stays the standard CEA 32 (base rosterType 'main'). To revert: delete rosterChanges.
    { name: 'S. Boyle',                currentWeek: 10, rosterType: 'main',       role: 'CEA',
      rosterChanges: [{ from: new Date(2026, 5, 28), rosterType: 'fixed', currentWeek: 2 }] },
    { name: 'L. Atrakimaviciene',      currentWeek: 11, rosterType: 'main',       role: 'CEA' },
    { name: 'J. Haque',                currentWeek: 12, rosterType: 'main',       role: 'CEA' },
    { name: 'R. Frimpong',             currentWeek: 13, rosterType: 'main',       role: 'CEA', hidden: true },
    { name: 'M. Okeke',                currentWeek: 13, rosterType: 'main',       role: 'CEA', startDate: new Date(2026, 3, 20), proRatedAL: { 2026: 23 } },
    { name: 'N. Tuck',                 currentWeek: 14, rosterType: 'main',       role: 'CEA' },
    { name: 'R. Forrester-Blackstock', currentWeek: 15, rosterType: 'main',       role: 'CEA' },
    { name: 'S. Langley',              currentWeek: 16, rosterType: 'main',       role: 'CEA' },
    { name: 'S. Silva',                currentWeek: 17, rosterType: 'main',       role: 'CEA' },
    { name: 'J. Sumaili',              currentWeek: 18, rosterType: 'main',       role: 'CEA' },
    { name: 'T. Bibi',                 currentWeek: 19, rosterType: 'main',       role: 'CEA' },
    { name: 'T. Nsuala',               currentWeek: 20, rosterType: 'main',       role: 'CEA' },
    { name: 'D. Irvine',               currentWeek: 3,  rosterType: 'bilingual',  role: 'CEA' },
    { name: 'T. Gherbi',               currentWeek: 6,  rosterType: 'bilingual',  role: 'CEA' },
    { name: 'C. Reen',                 currentWeek: 1,  rosterType: 'fixed',      role: 'CEA' },
    // New starter (3 Jun 2026). Phase 1 (3–27 Jun): own fixed line — pattern 2 (09:00–16:00
    // Mon–Fri), the same line S. Boyle later moves to. Phase 2 (from Sun 28 Jun): joins the main
    // link on wk10 (the slot S. Boyle vacates, after O. Mylla) via rosterChanges. AL pro-rated
    // for 2026 (CEA 32 → ⌈212/365×32⌉ = 19 for a 3 Jun start); standard 32 from 2027.
    { name: 'K. Jedlinski',            currentWeek: 2,  rosterType: 'fixed',      role: 'CEA',
      startDate: new Date(2026, 5, 3), proRatedAL: { 2026: 19 },
      rosterChanges: [{ from: new Date(2026, 5, 28), rosterType: 'main', currentWeek: 10 }] },

    // Dispatchers — 10-week rotating cycle, reference week starting 01/02/26
    // currentWeek reflects each person's row in the base roster on that date
    { name: 'D. Minto',                currentWeek: 1,  rosterType: 'dispatcher', role: 'Dispatcher' },
    { name: 'A. Targanov',             currentWeek: 2,  rosterType: 'dispatcher', role: 'Dispatcher' },
    { name: 'S. Warman',               currentWeek: 3,  rosterType: 'dispatcher', role: 'Dispatcher' },
    { name: 'S. Faure',                currentWeek: 4,  rosterType: 'dispatcher', role: 'Dispatcher' },
    { name: 'L. Szpejer',              currentWeek: 5,  rosterType: 'dispatcher', role: 'Dispatcher' },
    { name: 'K. Porter',               currentWeek: 6,  rosterType: 'dispatcher', role: 'Dispatcher' },
    { name: 'A. Murray',               currentWeek: 7,  rosterType: 'dispatcher', role: 'Dispatcher' },
    { name: 'S. Clarke',               currentWeek: 8,  rosterType: 'dispatcher', role: 'Dispatcher' },
    { name: 'A. Atkins',               currentWeek: 9,  rosterType: 'dispatcher', role: 'Dispatcher' },
    { name: 'K. Yeboah',               currentWeek: 10, rosterType: 'dispatcher', role: 'Dispatcher' },

    // CES — Customer Experience Supervisors (reference: w/c 15 Feb 2026)
    { name: 'F. Mohamed',              currentWeek: 1,  rosterType: 'ces',        role: 'CES' },
    { name: 'P. Lloyd',                currentWeek: 2,  rosterType: 'ces',        role: 'CES' },
    { name: 'P. Prashanthan',          currentWeek: 3,  rosterType: 'ces',        role: 'CES' },
    // On the CES rotation from his 9 Jun 2026 start (currentWeek:5 anchors him from the
    // 15 Feb CES reference so July lands on week 5).
    // noProRate: pay and AL are full-year (CES 34) despite the mid-year startDate.
    { name: 'B. Khalil',               currentWeek: 5,  rosterType: 'ces',        role: 'CES', startDate: new Date(2026, 5, 9), noProRate: true },
    { name: 'G. Rotaru',               currentWeek: 5,  rosterType: 'ces',        role: 'CES' },
    { name: 'L. Webster',              currentWeek: 6,  rosterType: 'ces',        role: 'CES' },
    { name: 'Z. Lewis',                currentWeek: 7,  rosterType: 'ces',        role: 'CES' },
    { name: 'M. Bowler',               currentWeek: 8,  rosterType: 'ces',        role: 'CES' },
    { name: 'W. Cummings',             currentWeek: 9,  rosterType: 'ces',        role: 'CES' },
    { name: 'S. Horsman',              currentWeek: 10, rosterType: 'ces',        role: 'CES' },

    // Management & clerks — login-only accounts; no roster of their own; hidden from the staff selector.
    // They can view and edit all staff data via admin.html but cannot access upload or auth setup features.
    { name: 'S. Stewart', currentWeek: 1, rosterType: 'main', role: 'Management', hidden: true, managerOnly: true },
    { name: 'D. Watts',   currentWeek: 1, rosterType: 'main', role: 'Management', hidden: true, managerOnly: true },
    { name: 'D. Harris',  currentWeek: 1, rosterType: 'main', role: 'Management', hidden: true, managerOnly: true },
    { name: 'S. Gumbo',   currentWeek: 1, rosterType: 'main', role: 'Management', hidden: true, managerOnly: true },
    { name: 'N. Bedingfield', currentWeek: 1, rosterType: 'main', role: 'Management', hidden: true, managerOnly: true }, // started 15 Jun 2026; managerOnly has no roster, so no startDate/proRatedAL needed
    { name: 'H. Croft',   currentWeek: 1, rosterType: 'main', role: 'Management', hidden: true, managerOnly: true },
];

// ============================================
// ANNUAL LEAVE ENTITLEMENTS
// ============================================
//
// Entitlements by role (calendar year, resets 1 Jan):
//   CES            → 34 days
//   Dispatcher     → 22 days base + 1 day lieu per bank holiday actually worked that year.
//                    "Worked" means the resolved shift (base roster after Firestore overrides)
//                    is not RD, OFF, SPARE, AL, or SICK. SPARE does NOT count — only actual
//                    worked shifts (time-format shifts or RDW) earn a lieu day.
//   All CEAs       → 32 days  (main, bilingual, fixed, or any other CEA rosterType).
//                    C. Reen is a CEA on a fixed roster (NOT CEA-BL), so 32 — corrected Jun 2026;
//                    getALEntitlement returns 32 for every CEA incl. fixed. Pinned by roster-data.test.mjs.

/**
 * Count how many UK bank holidays a dispatcher actually worked in a given year,
 * after applying Firestore overrides. Each worked bank holiday earns 1 day in lieu.
 *
 * @param {any}    member   — teamMembers entry (must be a Dispatcher)
 * @param {number} year     — calendar year to check
 * @param {Array<any>}  overrides — flat array of override objects { memberName, date, value, ... }
 * @returns {number}  count of bank holidays on which the member worked
 */
function countDispatcherBankHolidaysWorked(member, year, overrides) {
    const bankHolidays = getBankHolidays(year);

    // Build a date → winning-override lookup for this member, applying shouldReplaceOverride
    // precedence (manual beats roster_import; within a class, newer createdAt wins). A plain
    // last-in-array-wins map let a stale roster_import shadow a manual RDW on a bank-holiday date,
    // miscounting the dispatcher's lieu-day entitlement depending on Firestore result order.
    const overrideMap = new Map();
    for (const o of overrides) {
        if (o.memberName === member.name && o.date) {
            if (shouldReplaceOverride(overrideMap.get(o.date), o)) overrideMap.set(o.date, o);
        }
    }

    let lieuDays = 0;
    for (const bh of bankHolidays) {
        // Use local-time date string to match Firestore override keys (YYYY-MM-DD)
        const y = bh.getFullYear();
        const m = String(bh.getMonth() + 1).padStart(2, '0');
        const d = String(bh.getDate()).padStart(2, '0');
        const dateStr = `${y}-${m}-${d}`;

        // Override takes precedence; fall back to base roster.
        // NOTE: getBaseShift applies isChristmasRD, so Dec 26 (Boxing Day) always returns
        // 'RD' from the base roster even when a dispatcher is scheduled to work. A lieu day
        // for Boxing Day is only counted when an RDW override is recorded for that date.
        const shift = overrideMap.has(dateStr)
            ? overrideMap.get(dateStr).value
            : getBaseShift(member, bh);

        if (isWorkedShift(shift)) lieuDays++;
    }
    return lieuDays;
}

/**
 * Single source for the "is this shift a WORKED day?" predicate (CLAUDE.md: "isWorkedDay: false for
 * RD, OFF, SPARE, AL, SICK"). Returns false for the non-worked set — RD/OFF (rest), SPARE (standby),
 * AL (annual leave), SICK (absence) — true for everything else (incl. RDW and worked times). Shared
 * by the dispatcher lieu-day count (above) and the calendar renderer so the two can never drift as
 * the leave/absence set grows.
 * @param {string} shift
 * @returns {boolean}
 */
export function isWorkedShift(shift) {
    return shift !== 'RD' && shift !== 'OFF' && shift !== 'SPARE' && shift !== 'AL' && shift !== 'SICK';
}

/**
 * Annual leave entitlement for a staff member in a given year.
 * For Dispatchers the entitlement is dynamic: 22 base days plus one day in lieu
 * for every bank holiday on which they worked (after overrides). All other roles
 * return a fixed number regardless of year or overrides.
 *
 * @param {any}    member    - teamMembers entry
 * @param {number} [year]    - calendar year; defaults to current year
 * @param {Array<any>}  [overrides] - all override objects for this member; defaults to []
 * @returns {number}
 */
export function getALEntitlement(member, year = new Date().getFullYear(), overrides = []) {
    if (!member) return 32;
    // Pro-rated entitlement takes priority for joiners, regardless of role
    if (member.proRatedAL && member.proRatedAL[year] !== undefined) return member.proRatedAL[year];
    if (member.role === 'Dispatcher') return 22 + countDispatcherBankHolidaysWorked(member, year, overrides);
    if (member.role === 'CES') return 34;
    // Every CEA — main, bilingual, or fixed (C. Reen, plus any temporary fixed line) — gets
    // the standard 32. There is no fixed-roster AL premium
    // (corrected June 2026: C. Reen is contractually CEA, not CEA-BL, so 32, not 34).
    return 32;
}

/**
 * Project a member's annual-leave total for ONE calendar year and return the over-entitlement
 * overage, or null when still within entitlement. SINGLE SOURCE for the over-cap warning shown by
 * both AL write paths — the Change-a-Shift week editor (admin-app.js) and the AL booking flow
 * (admin-al.js) — which previously computed this with subtly different data shapes and could drift.
 *
 * Each caller pre-filters Sundays (uncontracted) and its own exclusions into `existingALDates`:
 *  - the week editor excludes the dates this batch OVERWRITES or DELETES;
 *  - the booking flow passes ALL existing AL for the year.
 * A new date already present in `existingALDates` is never double-counted (re-booking a day that is
 * already AL doesn't consume a second entitlement day) — so both mechanisms reduce to the same maths.
 *
 * @param {{ name: string, year: string, existingALDates: Set<string>, newALDates: string[], entitlement: number }} p
 *   name → member display name; year → "YYYY"; newALDates → the AL dates being written this year.
 * @returns {{ over: number, projectedTotal: number, headline: string, detail: string } | null}
 *   null when within entitlement; otherwise the overage + the two ready-to-show confirm-bar strings.
 */
export function projectAnnualLeaveOverage({ name, year, existingALDates, newALDates, entitlement }) {
    const newCount = newALDates.filter(d => !existingALDates.has(d)).length;
    const projectedTotal = existingALDates.size + newCount;
    if (projectedTotal <= entitlement) return null;
    const over = projectedTotal - entitlement;
    return {
        over, projectedTotal,
        headline: `${name} will be ${over} day${over !== 1 ? 's' : ''} over their ${year} AL entitlement`,
        detail:   `${projectedTotal} days used of ${entitlement} allowed in ${year}`,
    };
}

// ============================================
// ROSTER PATTERNS
// ============================================
// Shift cycle arrays live in roster-cycle-data.js (pure data, no logic).
// Imported here for getRosterForMember() and re-exported so consumers
// (app.js etc.) can continue to import them from roster-data.js unchanged.
import { weeklyRoster, bilingualRoster, fixedRoster, cesRoster, dispatcherRoster } from './roster-cycle-data.js';
import { shouldReplaceOverride, isOtherValue, parseOtherValue, OTHER_FLAVOURS } from './override-utils.js';
export { weeklyRoster, bilingualRoster, fixedRoster, cesRoster, dispatcherRoster };

// ============================================
// SHARED CONSTANTS
// ============================================

const DAY_KEYS    = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** HH:MM 24-hour validator (00:00–23:59) — single source for admin time-input validation. */
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DAY_NAMES   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTH_ABB   = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const TEAM_GRADES = ['CEA', 'CES', 'Dispatcher'];

// Swipe gesture thresholds — shared by calendar-app.js and admin-app.js so tuning
// in one place applies to both pages.
export const SWIPE_THRESHOLD = 75;   // Minimum px to count as an intentional swipe
export const SWIPE_VELOCITY  = 0.4;  // px/ms — fast flick commits even below distance threshold

// ============================================
// CALENDAR DATE HELPERS
// ============================================
// These private helpers generate date Sets automatically for CONFIG.MIN_YEAR
// through CONFIG.MAX_YEAR + 1, so they never need manual updates.

/**
 * Easter Sunday for a given year, via the Computus algorithm.
 * Duplicates the logic in calculateBankHolidays but returns a standalone Date.
 * @param {number} year
 * @returns {Date}
 */
export function computeEaster(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
    const day   = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month, day);
}

// ============================================
// DATE UTILITIES — shared by index.html and admin.html
// ============================================

// Compare two dates by calendar day only (ignores time component)
/** @param {any} date1 @param {any} date2 */
export function isSameDay(date1, date2) {
    return date1.getDate()     === date2.getDate()  &&
           date1.getMonth()    === date2.getMonth() &&
           date1.getFullYear() === date2.getFullYear();
}

// ============================================
// SPECIAL (ONE-OFF) BANK HOLIDAYS
// ============================================
// For government-announced extra bank holidays (jubilees, coronations etc.)
// that fall outside the standard algorithm. Add entries here as they are
// announced. Format: { year: number, month: number (1-based), day: number }
//
// Historical examples (already past, kept for reference):
//   { year: 2022, month: 6, day: 3 }  — Platinum Jubilee extra BH
//   { year: 2023, month: 5, day: 8 }  — King's Coronation extra BH
//
// None currently scheduled for 2024–2030. Check gov.uk each autumn.
/** @type {Array<any>} */
const SPECIAL_BANK_HOLIDAYS = [
    // Add future one-off bank holidays here when announced by the government.
];

// Calculate all UK bank holidays for a given year (England & Wales).
// Delegates Easter to computeEaster() — no Computus code is duplicated here.
// Returns an array of Date objects.
// Only supports years within CONFIG.MIN_YEAR–CONFIG.MAX_YEAR; returns [] outside that range.
/** @param {any} year */
function calculateBankHolidays(year) {
    if (year < CONFIG.MIN_YEAR || year > CONFIG.MAX_YEAR) {
        console.warn(`[roster-data] calculateBankHolidays: year ${year} is outside supported range (${CONFIG.MIN_YEAR}–${CONFIG.MAX_YEAR}). Returning empty list.`);
        return [];
    }
    const holidays = [];

    // New Year's Day (or substitute if weekend)
    let newYear = new Date(year, 0, 1);
    if      (newYear.getDay() === 0) holidays.push(new Date(year, 0, 2)); // Sun → Mon
    else if (newYear.getDay() === 6) holidays.push(new Date(year, 0, 3)); // Sat → Mon
    else                             holidays.push(newYear);

    // Easter — delegated to computeEaster() to avoid duplicating the Computus algorithm
    const easter = computeEaster(year);

    // Good Friday (2 days before Easter Sunday)
    const goodFriday = new Date(easter);
    goodFriday.setDate(easter.getDate() - 2);
    holidays.push(goodFriday);

    // Easter Monday (1 day after Easter Sunday)
    const easterMonday = new Date(easter);
    easterMonday.setDate(easter.getDate() + 1);
    holidays.push(easterMonday);

    // Early May Bank Holiday (first Monday in May)
    const mayFirst    = new Date(year, 4, 1);
    const mayFirstDay = mayFirst.getDay();
    holidays.push(new Date(year, 4, 1 + (mayFirstDay === 0 ? 1 : mayFirstDay === 1 ? 0 : 8 - mayFirstDay)));

    // Spring Bank Holiday (last Monday in May)
    const mayLast    = new Date(year, 5, 0);
    const mayDaysBack = (mayLast.getDay() + 6) % 7;
    holidays.push(new Date(year, 4, mayLast.getDate() - mayDaysBack));

    // Summer Bank Holiday (last Monday in August)
    const augLast    = new Date(year, 8, 0);
    const augDaysBack = (augLast.getDay() + 6) % 7;
    holidays.push(new Date(year, 7, augLast.getDate() - augDaysBack));

    // Christmas Day and Boxing Day (with weekend substitutes)
    // Sat 25: Christmas sub → Mon 27, Boxing Day (Sun 26) sub → Tue 28  ⇒ {27, 28}
    // Sun 25: Boxing Day is Mon 26 (a bank holiday in its own right, no sub),
    //         Christmas sub → Tue 27                                     ⇒ {26, 27}
    //   (NOT {27,28} — lumping Sunday into the Saturday branch dropped the real Dec 26
    //    BH and invented a spurious Dec 28. Latent until Dec 25 is a Sunday — first in
    //    2033, past today's MAX_YEAR — but a live trap when the range extends.)
    // Fri 25: Christmas stays Fri 25, Boxing Day (Sat 26) sub → Mon 28
    // Other weekday: Dec 25 + Dec 26, no substitutes needed
    const xmasDay = new Date(year, 11, 25).getDay();
    if (xmasDay === 6) {          // Saturday
        holidays.push(new Date(year, 11, 27));
        holidays.push(new Date(year, 11, 28));
    } else if (xmasDay === 0) {   // Sunday
        holidays.push(new Date(year, 11, 26));
        holidays.push(new Date(year, 11, 27));
    } else if (xmasDay === 5) {
        holidays.push(new Date(year, 11, 25));
        holidays.push(new Date(year, 11, 28));
    } else {
        holidays.push(new Date(year, 11, 25));
        holidays.push(new Date(year, 11, 26));
    }

    // One-off government-announced bank holidays (jubilees, coronations, etc.)
    SPECIAL_BANK_HOLIDAYS
        .filter(bh => bh.year === year)
        .forEach(bh => holidays.push(new Date(year, bh.month - 1, bh.day)));

    return holidays;
}

// Cache and getter for bank holidays (calculated once per year).
// _bhSetCache also stores a Set<isoString> for O(1) membership checks — hot path in calendar render.
const _bankHolidaysCache = new Map();
const _bhSetCache = new Map();
const _easterSundaySetCache = new Map();
/** @param {any} year */
export function getBankHolidays(year) {
    if (!_bankHolidaysCache.has(year)) _bankHolidaysCache.set(year, calculateBankHolidays(year));
    return _bankHolidaysCache.get(year);
}

/** @param {any} year */
function _getBhSet(year) {
    if (!_bhSetCache.has(year)) {
        _bhSetCache.set(year, new Set(getBankHolidays(year).map(formatISO)));
    }
    return _bhSetCache.get(year);
}

/** @param {any} year */
function _getEasterSundaySet(year) {
    if (!_easterSundaySetCache.has(year)) {
        // Take Easter Sunday straight from computeEaster() — the same Computus source
        // getBankHolidays() uses. The old approach inferred it by finding a Mon bank
        // holiday in Mar/Apr and subtracting a day, which would misread a future one-off
        // Mon bank holiday in that window as Easter Monday and mark a false Easter Sunday.
        _easterSundaySetCache.set(year, new Set([formatISO(computeEaster(year))]));
    }
    return _easterSundaySetCache.get(year);
}

/** @param {any} date */
export function isBankHoliday(date) {
    return _getBhSet(date.getFullYear()).has(formatISO(date));
}

// Dec 25 only — used for 🎄 decoration
/** @param {any} date */
export function isChristmasDay(date) {
    return date.getMonth() === 11 && date.getDate() === 25;
}

// Easter Sunday (day before Easter Monday) — used for 🐣 decoration
/** @param {any} date */
export function isEasterSunday(date) {
    return _getEasterSundaySet(date.getFullYear()).has(formatISO(date));
}

// Cache and calculator for paydays + cutoff dates.
// _paydaySetCache / _cutoffSetCache store Sets of ISO strings for O(1) lookup.
const _paydayCache = new Map();
const _paydaySetCache = new Map();
const _cutoffSetCache = new Map();
/** @param {any} year */
export function getPaydaysAndCutoffs(year) {
    if (year < CONFIG.MIN_YEAR) return { paydays: [], cutoffs: [] };
    if (!_paydayCache.has(year)) {
        const paydays = [];
        const cutoffs = [];
        const msPerDay = 24 * 60 * 60 * 1000;
        const jan1 = new Date(year, 0, 1, 12, 0, 0);
        const daysSinceFirst   = Math.floor((+jan1 - +CONFIG.FIRST_PAYDAY) / msPerDay);
        const cyclesSinceFirst = Math.floor(daysSinceFirst / CONFIG.PAYDAY_INTERVAL_DAYS);
        let currentMs = CONFIG.FIRST_PAYDAY.getTime()
            + cyclesSinceFirst * CONFIG.PAYDAY_INTERVAL_DAYS * msPerDay;

        // Safety guard: if FIRST_PAYDAY is misconfigured, prevent an infinite loop.
        let advanceGuard = 0;
        while (new Date(currentMs).getFullYear() < year) {
            currentMs += CONFIG.PAYDAY_INTERVAL_DAYS * msPerDay;
            if (++advanceGuard > 1000) {
                console.warn('[roster-data] getPaydaysAndCutoffs: exceeded loop guard advancing to year', year, '— check FIRST_PAYDAY in CONFIG.');
                break;
            }
        }

        let cycleGuard = 0;
        while (new Date(currentMs).getFullYear() === year) {
            if (++cycleGuard > 100) {
                console.warn('[roster-data] getPaydaysAndCutoffs: exceeded cycle guard for year', year, '— check PAYDAY_INTERVAL_DAYS in CONFIG.');
                break;
            }
            const raw = new Date(currentMs);
            let payday = new Date(raw.getFullYear(), raw.getMonth(), raw.getDate(), 12, 0, 0);
            while (isBankHoliday(payday)) payday.setDate(payday.getDate() - 1);
            paydays.push(payday);

            // Cutoff = most recent Saturday before payday
            const cutoff = new Date(payday);
            const daysBackToSaturday = [1, 2, 3, 4, 5, 6, 0];
            cutoff.setDate(payday.getDate() - daysBackToSaturday[payday.getDay()]);
            cutoffs.push(cutoff);

            currentMs += CONFIG.PAYDAY_INTERVAL_DAYS * msPerDay;
        }
        _paydayCache.set(year, { paydays, cutoffs });
    }
    return _paydayCache.get(year);
}

/** @param {any} year */
function _getPaydaySet(year) {
    if (!_paydaySetCache.has(year)) {
        _paydaySetCache.set(year, new Set(getPaydaysAndCutoffs(year).paydays.map(formatISO)));
    }
    return _paydaySetCache.get(year);
}

/** @param {any} year */
function _getCutoffSet(year) {
    if (!_cutoffSetCache.has(year)) {
        _cutoffSetCache.set(year, new Set(getPaydaysAndCutoffs(year).cutoffs.map(formatISO)));
    }
    return _cutoffSetCache.get(year);
}

/**
 * The ISO payday paired with a given cutoff ISO date, or null if not found.
 * Paydays shift backwards over bank holidays so the cutoff→payday gap isn't constant —
 * always pair by index, never a fixed offset.
 * @param {string} cutoffIso "YYYY-MM-DD"
 * @returns {string|null}
 */
export function paydayForCutoff(cutoffIso) {
    const { paydays, cutoffs } = getPaydaysAndCutoffs(Number(cutoffIso.slice(0, 4)));
    const idx = cutoffs.findIndex((/** @type {Date} */ c) => formatISO(c) === cutoffIso);
    return idx !== -1 ? formatISO(paydays[idx]) : null;
}

/** @param {any} date */
export function isPayday(date) {
    return _getPaydaySet(date.getFullYear()).has(formatISO(date));
}

/** @param {any} date */
export function isCutoffDate(date) {
    return _getCutoffSet(date.getFullYear()).has(formatISO(date));
}


// ============================================
// SPECIAL DAY BADGES — used by admin.html day rows
// ============================================
// Returns an array of { icon, title } objects for the given date.

/** @param {any} date @param {any} _dateStr */
export function getSpecialDayBadges(date, _dateStr) {
    const badges = [];
    if (isBankHoliday(date))   badges.push({ icon: '⭐', title: 'Bank Holiday' });
    if (isCutoffDate(date))    badges.push({ icon: '✂️', title: 'Cut-off Date' });
    if (isPayday(date))        badges.push({ icon: '💷', title: 'Payday' });
    if (isChristmasDay(date))  badges.push({ icon: '🎄', title: 'Christmas Day' });
    if (isEasterSunday(date))  badges.push({ icon: '🐣', title: 'Easter Sunday' });
    return badges;
}

// ============================================
// ROSTER PATTERN VALIDATION
// ============================================

/**
 * Validate all shift strings in every roster pattern object.
 * Valid values: 'RD', 'OFF', 'SPARE', 'AL', 'RDW', or 'HH:MM-HH:MM'.
 * Logs a console.error for every invalid entry so problems are caught at load time.
 * Called once automatically when the module loads.
 */
export function validateRosterPatterns() {
    const SHIFT_RE = /^\d{2}:\d{2}-\d{2}:\d{2}$/;
    const VALID_KEYWORDS = new Set(['RD', 'OFF', 'SPARE', 'AL', 'RDW']);
    const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const rosters = { weeklyRoster, bilingualRoster, fixedRoster, cesRoster, dispatcherRoster };
    let errors = 0;

    for (const [rosterName, roster] of Object.entries(rosters)) {
        for (const [week, days] of Object.entries(roster)) {
            for (const day of DAYS) {
                const shift = /** @type {Record<string, any>} */ (days)[day];
                if (shift === undefined) {
                    console.error(`[roster-data] validateRosterPatterns: ${rosterName} week ${week} is missing day '${day}'`);
                    errors++;
                } else if (!VALID_KEYWORDS.has(shift) && !SHIFT_RE.test(shift)) {
                    console.error(`[roster-data] validateRosterPatterns: ${rosterName} week ${week} ${day} has invalid value '${shift}' — expected RD/OFF/SPARE/AL/RDW or HH:MM-HH:MM`);
                    errors++;
                }
            }
        }
    }

    // (v16.80: dropped the "all patterns valid ✓" success console.log — dev-time noise that
    // shipped to every consumer of this validator; the returned error count carries the signal.)
    return errors;
}

// ============================================
// SHIFT CLASSIFICATION — shared by both HTML files
// ============================================

/**
 * Compiled once. Matches "HH:MM-HH:MM" shift time strings.
 * Used by isEarlyShift, isNightShift, getShiftClass, getShiftBadge.
 */
export const SHIFT_TIME_REGEX = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]-([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;

/**
 * Returns true if the date is Christmas Day (25 Dec) or Boxing Day (26 Dec).
 * Both are automatically Rest Days regardless of what the roster pattern says.
 * Boxing Day can still be overridden to RDW via Firestore for overtime.
 * IMPORTANT: isChristmasRD must be applied before any Firestore override logic.
 * @param {Date} date
 * @returns {boolean}
 */
export function isChristmasRD(date) {
    return date.getMonth() === 11 && (date.getDate() === 25 || date.getDate() === 26);
}

/**
 * Returns true for shifts starting 04:00–10:59 (Early classification).
 * @param {string} timeStr  e.g. "06:00-14:00"
 * @returns {boolean}
 */
export function isEarlyShift(timeStr) {
    if (!SHIFT_TIME_REGEX.test(timeStr)) return false;
    const hour = parseInt(timeStr.split(':')[0], 10);
    return hour >= CONFIG.EARLY_START_THRESHOLD && hour < CONFIG.EARLY_SHIFT_THRESHOLD;
}

/**
 * Returns true for shifts starting 21:00–03:59 (Night classification).
 * @param {string} timeStr  e.g. "21:30-05:30"
 * @returns {boolean}
 */
export function isNightShift(timeStr) {
    if (!SHIFT_TIME_REGEX.test(timeStr)) return false;
    const hour = parseInt(timeStr.split(':')[0], 10);
    return hour >= CONFIG.NIGHT_START_THRESHOLD || hour < CONFIG.EARLY_START_THRESHOLD;
}

/**
 * Classify a worked shift as 'early' | 'late' | 'night' for display.
 * A member's permanentShift always wins over the time-based classification.
 * Shared by the calendar day cells and the Team Week View so both render
 * the same kind for the same shift.
 * @param {string} timeStr  Shift value (e.g. "06:00-14:00")
 * @param {any} [member] Team member — permanentShift is honoured if set
 * @returns {'early'|'late'|'night'}
 */
export function getShiftKind(timeStr, member) {
    if (member?.permanentShift === 'early' || member?.permanentShift === 'late') {
        return member.permanentShift;
    }
    if (isNightShift(timeStr)) return 'night';
    return isEarlyShift(timeStr) ? 'early' : 'late';
}

/**
 * Returns a CSS class name for a shift value.
 * Used to apply day-cell background colours in both HTML files.
 * @param {string} timeStr  Shift value (e.g. "RD", "06:00-14:00")
 * @returns {string}  CSS class name
 */
export function getShiftClass(timeStr) {
    if (timeStr === 'RD' || timeStr === 'OFF') return 'rest-day';
    if (timeStr === 'SPARE') return 'spare-day';
    if (timeStr === 'RDW')   return 'rdw-day';
    if (timeStr === 'AL')    return 'al-day';
    if (timeStr === 'SICK')  return 'sick-day';
    // The Other family — Training / Induction / Assessment (OTHER_PLAN.md) — one leaf-green class
    // for every grammar form ('TRG', 'IND RDW', 'ASSESS 08:00-16:00', ...).
    if (isOtherValue(timeStr)) return 'other-day';
    if (!SHIFT_TIME_REGEX.test(timeStr)) {
        console.warn(`[roster-data] Unknown shift value: "${timeStr}" — rendered as unknown-day`);
        return 'unknown-day';
    }
    if (isNightShift(timeStr)) return 'night-shift';
    return isEarlyShift(timeStr) ? 'early-shift' : 'late-shift';
}

/**
 * Returns an HTML shift badge `<span>` for a shift value.
 * Icon and label are wrapped in separate child `<span>` elements so the
 * layout direction (stacked vs inline) is controlled purely by CSS on the
 * parent .shift-badge — no <br> in flex context needed.
 * @param {string} timeStr  Shift value (e.g. "RD", "06:00-14:00")
 * @returns {string}  HTML string (safe — no user data interpolated)
 */
export function getShiftBadge(timeStr) {
    if (!timeStr || timeStr === 'RD' || timeStr === 'OFF') return `<span class="shift-badge badge-rest"><span aria-hidden="true">🏠</span><span>Rest</span></span>`;
    if (timeStr === 'SPARE') return `<span class="shift-badge badge-spare"><span aria-hidden="true">📋</span><span>Spare</span></span>`;
    if (timeStr === 'RDW')   return `<span class="shift-badge badge-rdw" title="Rest day worked — extra shift on your rostered day off"><span aria-hidden="true">💼</span><span>RDW</span></span>`;
    if (timeStr === 'AL')    return `<span class="shift-badge badge-al"><span aria-hidden="true">🏖️</span><span>AL</span></span>`;
    if (timeStr === 'SICK')  return `<span class="shift-badge badge-sick"><span aria-hidden="true">🪑</span><span>Absent</span></span>`;
    // Other family — 🏷️ + the SHORT flavour word (Train/Ind/Assess); the FULL word
    // (Training/Induction/Assessment) is shown on tap via the day-detail label instead.
    const _trg = parseOtherValue(timeStr);
    if (_trg) return `<span class="shift-badge badge-other"><span aria-hidden="true">🏷️</span><span>${OTHER_FLAVOURS[_trg.flavour].badge}</span></span>`;
    if (!SHIFT_TIME_REGEX.test(timeStr)) return `<span class="shift-badge badge-unknown"><span aria-hidden="true">❓</span><span>Unknown</span></span>`;
    if (isNightShift(timeStr)) return `<span class="shift-badge badge-night"><span aria-hidden="true">🦉</span><span>Night</span></span>`;
    return isEarlyShift(timeStr)
        ? `<span class="shift-badge badge-early"><span aria-hidden="true">☀️</span><span>Early</span></span>`
        : `<span class="shift-badge badge-late"><span aria-hidden="true">🌙</span><span>Late</span></span>`;
}

// ============================================
// ROSTER LOOKUP — shared by both HTML files
// ============================================

/**
 * Resolves a member's effective roster fields (rosterType, currentWeek) for a
 * given date, applying any scheduled `rosterChanges`. Returns the member
 * unchanged when there are no changes or none apply yet; otherwise returns a
 * shallow copy with the matching change's rosterType/currentWeek overlaid.
 * The latest change whose `from` (midnight, inclusive) ≤ date wins, so the
 * `rosterChanges` array must be sorted ascending by `from`.
 * @param {any} member  teamMembers entry
 * @param {Date}   date
 * @returns {any}  member, or a copy with effective roster fields
 */
export function resolveMemberRoster(member, date) {
    if (!member || !member.rosterChanges || !member.rosterChanges.length) return member;
    const dateMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    // Order-independent: pick the change with the LATEST `from` that is ≤ date, not the
    // last-iterated match. The ascending-sort invariant is still documented, but relying on it
    // meant an out-of-order array (easy to author wrong with 2+ entries) resolved to the wrong
    // rosterType/currentWeek silently; this makes the result correct regardless of order (v16.19).
    let eff = member;
    let bestFrom = null;
    for (const change of member.rosterChanges) {
        const f = change.from;
        const fromMidnight = new Date(f.getFullYear(), f.getMonth(), f.getDate());
        if (dateMidnight >= fromMidnight && (bestFrom === null || fromMidnight > bestFrom)) {
            eff = { ...member, rosterType: change.rosterType, currentWeek: change.currentWeek };
            bestFrom = fromMidnight;
        }
    }
    return eff;
}

/**
 * Returns the roster week number (1-based, within the cycle) for a given date and member.
 * Each week runs Sunday–Saturday. Normalises to noon to avoid DST edge cases.
 * @param {Date} date
 * @param {any} member  teamMembers entry
 * @returns {number}  Week number within the roster cycle
 */
export function getWeekNumberForDate(date, member) {
    if (!member) return 1; // safety fallback — should always be provided
    member = resolveMemberRoster(member, date);
    const rosterType = member.rosterType || 'main';
    // Fixed rosters don't rotate — a member sits on one constant pattern, selected by their
    // currentWeek (fixedRoster[currentWeek]). currentWeek 1 = C. Reen, 2 = S. Boyle, etc.
    if (rosterType === 'fixed') return member.currentWeek || 1;

    const cycleLength = rosterType === 'bilingual'   ? CONFIG.BILINGUAL_ROSTER_WEEKS
                      : rosterType === 'ces'         ? CONFIG.CES_ROSTER_WEEKS
                      : rosterType === 'dispatcher'  ? CONFIG.DISPATCHER_ROSTER_WEEKS
                      : CONFIG.MAIN_ROSTER_WEEKS;

    const referenceSunday = rosterType === 'bilingual'  ? CONFIG.BILINGUAL_ROSTER_REFERENCE_DATE
                          : rosterType === 'ces'        ? CONFIG.CES_ROSTER_REFERENCE_DATE
                          : rosterType === 'dispatcher' ? CONFIG.DISPATCHER_ROSTER_REFERENCE_DATE
                          : CONFIG.MAIN_ROSTER_REFERENCE_DATE;

    // Normalise to noon to avoid DST issues
    const noon = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
    const sunday = new Date(noon);
    sunday.setDate(noon.getDate() - noon.getDay());

    const weeksDiff = Math.floor(Math.round((+sunday - +referenceSunday) / (1000 * 60 * 60 * 24)) / 7);
    const w = member.currentWeek + weeksDiff;
    return ((w - 1) % cycleLength + cycleLength) % cycleLength + 1;
}

/**
 * Returns the full roster descriptor for a member.
 * Returns an object with: type, data (the roster map), cycleLength, weekPrefix.
 * admin.html's simple getRosterData can be replaced by `.data` on this result.
 * @param {any} member  teamMembers entry
 * @param {Date}   [date]  Optional — when supplied, applies any scheduled
 *                         `rosterChanges` so the descriptor matches that date.
 * @returns {{ type: string, data: any, cycleLength: number, weekPrefix: string }}
 */
export function getRosterForMember(member, date) {
    if (!member) {
        console.error('[roster-data] getRosterForMember called with null/undefined member');
        return { type: 'main', data: weeklyRoster, cycleLength: CONFIG.MAIN_ROSTER_WEEKS, weekPrefix: 'CEA Week' };
    }
    if (date) member = resolveMemberRoster(member, date);
    const t = member.rosterType || 'main';
    if (t === 'fixed')      return { type: 'fixed',      data: fixedRoster,      cycleLength: 1,                           weekPrefix: '' };
    if (t === 'ces')        return { type: 'ces',        data: cesRoster,        cycleLength: CONFIG.CES_ROSTER_WEEKS,      weekPrefix: 'CES Week' };
    if (t === 'dispatcher') return { type: 'dispatcher', data: dispatcherRoster, cycleLength: CONFIG.DISPATCHER_ROSTER_WEEKS, weekPrefix: 'Dispatch Week' };
    if (t === 'bilingual')  return { type: 'bilingual',  data: bilingualRoster,  cycleLength: CONFIG.BILINGUAL_ROSTER_WEEKS,  weekPrefix: 'BL Week' };
    return { type: 'main', data: weeklyRoster, cycleLength: CONFIG.MAIN_ROSTER_WEEKS, weekPrefix: 'CEA Week' };
}

/**
 * Returns the base roster shift for a member on a given date, before any Firestore overrides.
 * Applies the Christmas/Boxing Day RD rule before the roster lookup.
 * @param {any} member  teamMembers entry
 * @param {Date}   date
 * @returns {string}  Shift value e.g. "RD", "06:00-14:00"
 */
export function getBaseShift(member, date) {
    if (!member) return 'RD'; // guard: sibling helpers (getWeekNumberForDate etc.) all guard !member; be consistent
    if (isChristmasRD(date)) return 'RD'; // Rule: see CLAUDE.md — "isChristmasRD() applied before Firestore overrides"
    // Members with a startDate show RD for all dates before they join
    if (member.startDate) {
        const s = member.startDate;
        const startMidnight = new Date(s.getFullYear(), s.getMonth(), s.getDate());
        const dateMidnight  = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        if (dateMidnight < startMidnight) return 'RD';
    }
    const weekNum = getWeekNumberForDate(date, member);
    const dayKey  = DAY_KEYS[date.getDay()];
    const data    = getRosterForMember(member, date).data;
    return (data[weekNum] && data[weekNum][dayKey]) || 'RD';
}

// ============================================
// SECURITY UTILITIES — shared by both HTML files
// ============================================

/**
 * Escapes special HTML characters to prevent XSS injection.
 * Use on all Firestore-sourced strings before inserting into innerHTML.
 * Handles null/undefined safely (returns '').
 * @param {string|null|undefined} str
 * @returns {string}
 */
export function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');   // also escape ' — defence-in-depth for any single-quoted attribute interpolation
}

/**
 * Parse a numeric field value, first normalising the iOS smart hyphens/minus
 * signs and curly quotes that keyboards can insert — without this, parseFloat
 * silently returns NaN on otherwise-valid user input. Returns 0 for empty or
 * unparseable input. Single source for paycalc-app.js numVal() and the HPP rate
 * read in paycalc-hpp.js (which must agree with calculate()'s rate).
 * @param {string|null|undefined} v - Raw field value.
 * @returns {number}
 */
export function parseSmartFloat(v) {
    if (!v) return 0;
    return parseFloat(_cleanNumericString(v)) || 0;
}

/** Shared numeric-input cleaning: smart hyphens/minus → '-', curly quotes normalised, thousands
 *  commas and £ signs stripped (a payslip figure pasted verbatim as "£23,456.78" must parse —
 *  parseFloat stops at the first comma, silently turning "23,456.78" into 23, badly corrupting
 *  YTD-based cumulative PAYE). @param {any} v */
function _cleanNumericString(v) {
    return String(v)
        .replace(/[‐-―−−]/g, '-')
        .replace(/[‘’]/g, "'")
        .replace(/[,£]/g, '')
        .trim();
}

/**
 * parseSmartFloat, but DISTINGUISHES "unusable" from zero: empty/missing input OR a non-empty
 * value that cannot be parsed returns null instead of 0. parseSmartFloat's `|| 0` floor makes it
 * impossible for callers to tell floored garbage from a real £0 — which mattered badly for the
 * Year-to-Date fields: an unparseable remnant (a lone "." or "-" left mid-edit and autosaved)
 * coerced to £0 Taxable-Pay-to-date, silently flipping computeTax into cumulative mode and
 * collapsing Income Tax to £0.00 (take-home overstated by hundreds of pounds). Signed money
 * fields read THIS and treat null as "not provided".
 * @param {string|null|undefined} v - Raw field value.
 * @returns {number|null}
 */
export function parseSmartFloatOrNull(v) {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    const n = parseFloat(_cleanNumericString(v));
    return Number.isFinite(n) ? n : null;
}

/**
 * Derive up-to-two-letter initials from a member display name, for the
 * initials badge shown beside their name in the nav-panel footer.
 * "G. Miller" → "GM"; "C. Francisco-Charles" → "CF"; single-word names → first
 * letter only. Used by nav-panel.js (footer badge).
 * @param {string} name
 * @returns {string} 1–2 uppercase letters, or "?" if none can be derived
 */
export function avatarInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    const first = parts[0]?.[0] ?? '';
    const last  = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (first + last).toUpperCase().replace(/[^A-Z]/g, '') || '?';
}

/**
 * Derive a stable background colour for a member's initials avatar from their
 * name, so the same person always gets the same colour. Returns an oklch()
 * string (consistent with the app's colour system) at a fixed lightness/chroma
 * that keeps white initials legible (WCAG AA) across the hue wheel.
 * @param {string} name
 * @returns {string} CSS oklch() colour
 */
export function avatarHue(name) {
    let h = 0;
    for (let i = 0; i < (name?.length ?? 0); i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    return `oklch(52% 0.12 ${h}deg)`;
}

/**
 * Validate an email address. Requires a non-whitespace local part, an @ sign, a domain
 * with at least one dot, and a TLD of two or more characters.
 * Used by settings-app.js and operations-app.js — single authoritative validator.
 * @param {string} v
 * @returns {boolean}
 */
export function isValidEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

/**
 * True if `v` is a valid Chiltern WORK email — a valid address whose domain is exactly
 * `CONFIG.WORK_EMAIL_DOMAIN` (case-insensitive on the domain). The "@" anchor rejects look-alikes
 * (`x@evil-chilternrailways.co.uk`) and subdomains (`x@sub.chilternrailways.co.uk`). Mirrors the
 * staffContact write rule in firestore.rules — keep the two in sync. Single authoritative validator
 * for the work-email save paths (settings-app / operations-app / admin-app).
 * @param {string} v
 * @returns {boolean}
 */
export function isChilternWorkEmail(v) {
    if (typeof v !== 'string') return false;
    const e = v.trim();
    return isValidEmail(e) && e.toLowerCase().endsWith('@' + CONFIG.WORK_EMAIL_DOMAIN);
}

/**
 * Formats a Date object as a YYYY-MM-DD string using local time components.
 * Safer than toISOString().slice(0,10) which can return the previous day in
 * timezones behind UTC when the local time is near midnight.
 * @param {Date} d
 * @returns {string}  e.g. "2026-03-18"
 */
// Small LRU on date.getTime() — formatISO is called per-cell during calendar render and in
// tight loops by isBankHoliday/isPayday/isCutoffDate. Most invocations within a render share
// the same Date instances, so a tiny cache hits often without ever growing memory.
// _isoCache declared near the top of the file to avoid TDZ during module load.
export function formatISO(d) {
    const k = d.getTime();
    const cached = _isoCache.get(k);
    if (cached) return cached;
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (_isoCache.size >= _isoCacheMax) _isoCache.delete(_isoCache.keys().next().value);
    _isoCache.set(k, iso);
    return iso;
}

/**
 * Parse a "YYYY-MM-DD" string to a Date at LOCAL NOON — the read-side inverse of formatISO().
 * The noon anchor (not midnight) avoids the DST/BST off-by-one where `new Date("YYYY-MM-DD")`
 * (parsed as UTC midnight) becomes the PREVIOUS day in timezones behind UTC. Always use this instead
 * of inlining `new Date(str + 'T12:00:00')` at a call site, so the noon convention can't be forgotten
 * (which is exactly how a one-day drift creeps in). Pairs with formatISO() (the write direction).
 * @param {string} dateStr  "YYYY-MM-DD"
 * @returns {Date}
 */
export function parseISODate(dateStr) {
    return new Date(dateStr + 'T12:00:00');
}

/**
 * Returns true if the ISO date string falls on a Sunday.
 * Sundays are uncontracted for all staff — they never count as AL or sick days.
 * @param {string} dateStr  YYYY-MM-DD
 * @returns {boolean}
 */
export function isSunday(dateStr) {
    return parseISODate(dateStr).getDay() === 0;
}

// Run validations immediately at module load.
// Production: skip the per-cell regex scan (49 weeks × 7 days × 5 rosters) to speed up first paint.
// Dev/debug: opt-in via localhost or ?debug=1 query string.
if (typeof location !== 'undefined' &&
    (location.hostname === 'localhost' || location.hostname === '127.0.0.1' ||
     location.search.includes('debug'))) {
    validateRosterPatterns();
}

// G. Miller's real payslip actuals (MILLER_ACTUALS) were moved OUT of this served
// module at v14.68 → test-fixtures/miller-actuals.js (privacy; Track 2 / Option A).
// They are now a test-only fixture (excluded from Firebase Hosting). Do not re-add
// real pay figures to any served file.
/**
 * Returns non-hidden teamMembers for a login grade dropdown.
 * Centralises the member-filtering logic shared by all login overlays.
 * @param {string} grade - 'CEA' | 'CES' | 'Dispatcher' | 'Management'
 * @returns {Array<Object>}
 */
export function getMembersForGrade(grade) {
    if (!grade) return [];
    // ⚠️ Management deliberately does NOT filter on `hidden`: every ACTIVE manager row carries
    // `hidden: true` as the standing convention (belt-and-braces with managerOnly to keep them out
    // of the calendar member selector) — so `!m.hidden` here would empty the Management login group,
    // locking every manager out AND letting "Disable accounts for leavers" disable all six manager
    // accounts (they'd vanish from ACTIVE_MEMBERS). A manager/clerk LEAVER is offboarded by removing
    // their row from teamMembers (and from CONFIG.MANAGER_NAMES) — not by `hidden: true`.
    if (grade === 'Management') return teamMembers.filter(m => m.managerOnly);
    return teamMembers.filter(m => m.role === grade && !m.hidden && !m.managerOnly);
}

