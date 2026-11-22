// @ts-check
// MYB Roster — Shared Data
// Single source of truth for roster configuration, team members, and shift patterns.
// ES module — import named exports into consuming files:
//   import { CONFIG, APP_VERSION, teamMembers, weeklyRoster, ... } from './roster-data.js';
//
// APP_VERSION is the single authoritative version number; pages import it directly (CONFIG no
// longer mirrors it — nothing read the copy). Browser HTTP cache is handled by Cache-Control: no-cache
// headers in firebase.json — no ?v= query strings needed. Service worker cache is invalidated
// automatically by the CACHE_NAME in service-worker.js, which embeds APP_VERSION.

/** Single source of truth for the app version. Update this on every commit that touches app behaviour. */
export const APP_VERSION = '26.54';

// ============================================
// PERFORMANCE CACHES — at the top, above everything that reads them: a `const` read before its own
// line has run throws (the temporal dead zone), so one declared beside formatISO would break any call
// reaching it while this module is still loading.
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
    MAX_YEAR:                         2030,                                      // Latest navigable year — extend to 2032+ by end of 2028: check SPECIAL_BANK_HOLIDAYS for the new years first, and run `npm run generate:roster-members` in the same commit. A Boxing Day worked in this year earns a day in the NEXT year's allowance, which no screen opens until this is raised; past 2032, see the payday note above getPaydaysAndCutoffs
    EARLY_START_THRESHOLD:            4,                                         // Shifts starting 04:00–10:59 are Early
    EARLY_SHIFT_THRESHOLD:            11,                                        // Shifts starting 11:00–20:59 are Late
    NIGHT_START_THRESHOLD:            21,                                        // Shifts starting 21:00–03:59 are Night
    DEFAULT_MEMBER_NAME:              'G. Miller',                               // Default selection in index.html
    ADMIN_NAMES:                      ['G. Miller'],                              // Names with elevated admin access (roster upload, huddle upload, auth setup) — add names here to grant full admin rights
    // Names with access to the Links design workspace. The owner alone since 9 Nov 2026 ("hide the link designer page
    // from everyone apart from me"): S. Silva and M. Robson came off, and keep nothing but what any member has. Their
    // saved designs stay. Regenerate (`npm run generate:roster-members`) with any change here, and run Operations →
    // Set up accounts after the deploy: the server's `linksDesigner` claim is what lets a design be SAVED.
    LINKS_DESIGNERS:                  ['G. Miller'],
    // Ordinary members invited into the restricted Overtime beta — they SUBMIT availability and
    // review nothing. Reviewing is the `admin`/`manager` claim and stays separate on purpose: this
    // list must never become a way to see colleagues' declarations. Add a name here AND run
    // `npm run generate:roster-members` in the same commit — `selectParticipants` reads the
    // generated server copy, never this one, so an un-regenerated list grants a page with no form
    // on it. Empties out at full launch, when the audience becomes every eligible member.
    // OVERTIME IS PAUSED (owner, Nov 2026: the manager who proposed it is away on a year's secondment).
    // This is the whole switch. `false` takes the pill off every menu, the admin's included, turns
    // overtime.html into a "paused" note, and — through the generated server copy, so run
    // `npm run generate:roster-members` in the same commit — leaves the five Overtime endpoints and
    // the daily creator unexported, so they answer 404. The retention purge keeps running, so the weeks
    // already made age out by themselves. The code and its tests stay live while it is off, which is
    // what keeps it ready: OVERTIME_AVAILABILITY.md → "Paused" is the way back.
    OVERTIME_ENABLED:                 false,
    // Who besides the admin could open the New link page while it was a PREVIEW (newlink-config.js → PHASE): S. Silva, the RMT
    // rep who leads the change (owner, 4 Nov 2026). Open since v25.60 to every colleague on a normal CEA contract and the
    // managers (auth-policy.js → `newlinkAudience`); this list keeps her in whatever the audience becomes. Page access only — the
    // page reads nothing from the server and shows only public files — so it needs no claim and no generated server copy.
    // auth-policy.js → `canOpenNewlink` reads it.
    NEWLINK_PREVIEW:                  ['S. Silva'],
    OVERTIME_BETA:                    /** @type {string[]} */ ([]),                           // CEA beta participants (none since 7 Oct 2026 — T. Bibi and J. Sumaili withdrawn, owner request) — availability only, no reviewer access
    MANAGER_NAMES:                    ['D. Watts', 'D. Harris', 'S. Gumbo', 'N. Bedingfield', 'H. Croft', 'N. Sobers', 'W. Cummings'], // Managers & clerks — can view/edit all staff data but cannot access master admin features (upload, auth setup)
    GRADE_ORDER:                      ['CEA', 'CES', 'Dispatcher', 'Management'], // Grade grouping order — single source for the login dropdown optgroups (login-overlay.js), the admin member-selector optgroups (admin-app.js) AND the Calendar's name picker (calendar-member.js), so they can't drift
    WORK_EMAIL_DOMAIN:               'chilternrailways.co.uk',                   // Authoritative Chiltern work-email domain — single source for the auto-append + the staffContact domain validation (settings/operations/admin + firestore.rules)
    // Phase 2 of PASSWORD_DESIGN.md — compel un-migrated members to set their own password at their
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
    // No forced sign-out is needed to drive this: sessions cap at 60 days absolute, and an expired
    // session forces a real typed login, so coverage completes itself inside 60 days and staggers by
    // each member's own expiry rather than landing on everyone at once. That window is a
    // CONSEQUENCE of `SESSION_MS`, not a policy here — it was 30 days until v20.47 doubled the
    // session, which halves the rollout speed and is the accepted cost of the longer session. (The
    // 7-day idle cutoff that used to shorten this for infrequent users was removed at v20.41 — it
    // made the rollout FASTER for exactly the people it inconvenienced most, which was never its
    // purpose.)
    FORCE_PASSWORD_SET:               true,
    // The "ask the admin to reset my password" request queue (PASSWORD_DESIGN.md — Phase 1 of the request
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
    //   RAISED to 3 at v24.27, the release in which the rules and endpoints begin REQUIRING the
    //   server-set `member` claim (stamped by Set up accounts at v24.24). The sweep runs on the next
    //   open that CONFIRMS a named session — `ensureNamedSession`, or the Calendar's named grant — and
    //   is fire-and-forget, so a read in that same instant may still carry the old token.
    CLAIM_EPOCH:                      3,
    SUPPORT_EMAIL:                    'Gareth.Miller@chilternrailways.co.uk',     // Bug report destination — update here if the address ever changes
};

// ============================================
// TEAM MEMBERS
// ============================================
//
// The table itself lives in `roster-member-data.js` and is RE-EXPORTED from here, so every
// consumer — the app, `scripts/generate-roster-members.mjs`, `public-data-classification.test.mjs`
// — goes on importing `teamMembers` from `roster-data.js` exactly as before.
//
// Split out at v23.31 because this file's size guard was measuring the wrong thing. The roster's
// people are the one part of it whose length tracks HEADCOUNT: the cap was last raised for a new
// starter (v23.26), whose own note says the file "will cross again on a future starter, and that
// is not drift". A guard that fails on hiring cannot also watch for complexity. The behaviour
// around the table stays here; only the rows moved, exactly as `roster-cycle-data.js` holds the
// week patterns that `getRosterForMember` reads.
import { teamMembers } from './roster-member-data.js';
export { teamMembers };

// ============================================
// ANNUAL LEAVE — the allowance is al-contract.js (the contract figure, by the grade that decides each
// year) and al-entitlement.js (the whole allowance, the one door). Only the worked-day test is here.
// ============================================

/**
 * Single source for the "is this shift a WORKED day?" predicate (CLAUDE.md: "`isWorkedShift`: false for
 * RD, OFF, SPARE, AL, SICK"). Returns false for the non-worked set — RD/OFF (rest), SPARE (standby),
 * AL (annual leave), SICK (absence) — true for everything else (incl. RDW and worked times). Shared
 * by the dispatcher lieu-day count (al-contract.js) and the calendar renderer so the two can never drift as
 * the leave/absence set grows.
 * @param {string} shift
 * @returns {boolean}
 */
export function isWorkedShift(shift) {
    return shift !== 'RD' && shift !== 'OFF' && shift !== 'SPARE' && shift !== 'AL' && shift !== 'SICK';
}

/**
 * The pay grade this app has CONFIRMED rates and contract terms for, given a member's role — or
 * null when it has none (v21.78).
 *
 * Written because the absence of a grade was indistinguishable from CEA. The calculator's grade was
 * '' for anybody the app never stored one for, and every consumer then fell back to `GRADES.cea`, so
 * a Dispatcher or a manager opening the calculator received a complete, plausible CEA estimate.
 * That is worse than an unsupported state: an unverified figure at least looks unverified, whereas
 * this one was somebody else's pay presented as theirs.
 *
 * Dispatcher pay is not modelled because the rates and contractual terms are not on record — see
 * `.claude/rules/paycalc.md`. Do not invent them, and do not extend this map to a role until a real
 * payslip has confirmed it.
 *
 * LIVES HERE, NOT IN paycalc-settings.js, SINCE v24.86. The Calendar's Year to Date notice asks the
 * same question the Pay Calculator asks before it shows a figure — "would this page work for you?"
 * — and must answer it the SAME way, so a member it sends there is never met by the refusal card.
 * Importing the answer from the paycalc family would have loaded that whole module graph onto the
 * Calendar to read three lines. paycalc-settings.js re-exports it, so its consumers are unchanged.
 *
 * @param {string|undefined|null} role @returns {'cea'|'ces'|null}
 */
export function gradeForRole(role) {
    if (role === 'CEA') return 'cea';
    if (role === 'CES') return 'ces';
    return null;
}

/**
 * Project a member's annual-leave total for ONE calendar year and return the over-entitlement
 * overage, or null when still within entitlement. SINGLE SOURCE for the over-cap warning shown by
 * both AL write paths — the Change-a-Shift week editor and the AL booking flow — which previously
 * computed this with subtly different data shapes and could drift. Its one caller is
 * `projectAlOverage` (admin-al-projection.js), which both paths use: the week editor's save through
 * admin-al-week-save.js, the booking flow through admin-al.js.
 *
 * That caller pre-filters Sundays (uncontracted) and each path's own exclusions into `existingALDates`:
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
        headline: `${name} will be ${over} day${over !== 1 ? 's' : ''} over their ${year} annual leave allowance`,
        detail:   `${projectedTotal} days used of ${entitlement} allowed in ${year}`,
    };
}

// ============================================
// ROSTER PATTERNS
// ============================================
// Shift cycle arrays live in roster-cycle-data.js (pure data, no logic).
// Imported here for getRosterForMember() and re-exported, so a module that already
// imports from roster-data.js (the Links workspace does) need not import both files.
import { weeklyRoster, bilingualRoster, fixedRoster, cesRoster, dispatcherRoster, FIXED_PATTERNS_RESTING_ON_BANK_HOLIDAYS } from './roster-cycle-data.js';
import { isOtherValue, parseOtherValue, OTHER_FLAVOURS } from './override-utils.js';
export { weeklyRoster, bilingualRoster, fixedRoster, cesRoster, dispatcherRoster, FIXED_PATTERNS_RESTING_ON_BANK_HOLIDAYS };

// ============================================
// SHARED CONSTANTS
// ============================================

const DAY_KEYS    = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** HH:MM 24-hour validator (00:00–23:59) — single source for admin time-input validation. */
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
// DAY_NAMES and MONTH_ABB live in `date-format.js` and are re-exported here (v24.06) — they are
// the app's date VOCABULARY, and they belong beside the composers that spell with them. Everything
// that already reads them from this module keeps working; nothing needs to change import.
// `MONTH_NAMES`, the FULL register, joined them on 22 Nov 2026, when `formatDayMonthYear` began to spell from it.
export { DAY_NAMES, MONTH_ABB, MONTH_NAMES } from './date-format.js';
export const TEAM_GRADES = ['CEA', 'CES', 'Dispatcher'];

// Swipe gesture thresholds — shared by calendar-app.js and admin-app.js so tuning
// in one place applies to both pages.
export const SWIPE_THRESHOLD = 75;   // Minimum px to count as an intentional swipe
export const SWIPE_VELOCITY  = 0.4;  // px/ms — fast flick commits even below distance threshold

// ============================================
// CALENDAR DATE HELPERS
// ============================================
// Bank holidays, paydays and cut-offs are computed for a year on first use and cached — none is typed in.

/**
 * Easter Sunday for a given year, via the Computus algorithm — the one copy of it: calculateBankHolidays
 * and isEasterSunday both read this.
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
// None currently scheduled for 2024–2030. The gov.uk check is a yearly row in MAINTENANCE_CALENDAR.md.
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
// A year's list holds the paydays that FALL in it, each with its cut-off — and from payday 6 Jan 2034
// that cut-off is in the year BEFORE (31 Dec 2033), where isCutoffDate and paydayForCutoff, which look
// only in the date's own year, cannot see it. Beyond MAX_YEAR, so left alone and pinned by
// roster-data.test.mjs, which fails the day MAX_YEAR reaches 2033 (review, 16 Nov 2026).
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
    // WORDED EXACTLY AS `dayMarkers` WORDS THEM (calendar-renderer.js). These are the same five
    // markers on two surfaces, and both pairs had drifted: the Calendar said "Bank holiday" and
    // "Cut-off date" while this said "Bank Holiday" and "Cut-off Date". Sentence case is right for
    // a common noun and is what the member-facing surface already used. NOT the payslip's
    // "Bank Holiday Rostered" — that is a line name and is exact.
    if (isBankHoliday(date))   badges.push({ icon: '⭐', title: 'Bank holiday' });
    if (isCutoffDate(date))    badges.push({ icon: '✂️', title: 'Cut-off date' });
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
 * Valid values: 'RD', 'OFF', 'SPARE', a real 'HH:MM-HH:MM' whose ends differ, and — Monday to Saturday
 * only — a BARE Other-family flavour such as 'TRG' (v25.40: `fixedRoster[3]`, a starter's training weeks).
 * Not 'AL' or 'RDW': they happen TO a day, as overrides, and RDW in a pattern is shown and never paid
 * (whole-app review, 10 Nov 2026 — as were '24:00-08:00', drawn ❓, and '06:20-06:20', a 24-hour turn).
 *
 * WHY ONLY BARE, AND NEVER ON A SUNDAY. The Other family was an OVERRIDE grammar until v25.40, and
 * two of its parts only work when an override carries them. A TIME rides in `resolveEffectiveShift`'s
 * `rdwTime` side channel, which only the override ladder fills — so a pattern's 'TRG 09:00-16:00'
 * would draw the badge with no time in the cell while the day panel printed one. An 'RDW' marker
 * is read by the pay engine only from an override, so a pattern's 'TRG RDW' would be shown as rest
 * day working and paid as nothing. And an Other day can never be a Sunday (OTHER_DAYS.md, Jul 2026).
 * A bare flavour on a weekday has none of those problems: it is drawn as the badge alone, which is
 * exactly what it means — a training day whose hours nobody has rostered.
 *
 * Logs a console.error for every invalid entry so problems are caught at load time.
 * Called once automatically when the module loads (on localhost and with ?debug).
 * @param {Record<string, Record<string, Record<string, string>>>} [rosters] the patterns to check —
 *   every roster type by default; a test passes its own rather than editing the shipped data.
 * @returns {number} how many cells failed
 */
export function validateRosterPatterns(rosters = { weeklyRoster, bilingualRoster, fixedRoster, cesRoster, dispatcherRoster }) {
    const isRange = (/** @type {string} */ v) => { const [s, e, more] = String(v).split('-'); return more === undefined && TIME_RE.test(s) && TIME_RE.test(e ?? '') && s !== e; };
    const VALID_KEYWORDS = new Set(['RD', 'OFF', 'SPARE']);
    const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const isBareFlavour = (/** @type {string} */ v) => Object.prototype.hasOwnProperty.call(OTHER_FLAVOURS, v);
    let errors = 0;

    for (const [rosterName, roster] of Object.entries(rosters)) {
        for (const [week, days] of Object.entries(roster)) {
            for (const day of DAYS) {
                const shift = /** @type {Record<string, any>} */ (days)[day];
                if (shift === undefined) {
                    console.error(`[roster-data] validateRosterPatterns: ${rosterName} week ${week} is missing day '${day}'`);
                    errors++;
                } else if (isOtherValue(shift) && day === 'sun') {
                    console.error(`[roster-data] validateRosterPatterns: ${rosterName} week ${week} sun has '${shift}' — an Other day (Training, Induction, …) can never be on a Sunday`);
                    errors++;
                } else if (!VALID_KEYWORDS.has(shift) && !isRange(shift) && !isBareFlavour(shift)) {
                    console.error(`[roster-data] validateRosterPatterns: ${rosterName} week ${week} ${day} has invalid value '${shift}' — expected RD/OFF/SPARE, a real HH:MM-HH:MM whose ends differ, or a bare Other flavour (TRG, IND, …) with no RDW marker and no times`);
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

// Christmas LEAVE — who is on leave on these two days, never counted, and the Boxing Day day in lieu
// — is built on top of this rule in christmas-leave.js (v25.37), which also says why it is not here.

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
    // The Other family — Training / Induction / Assessment (OTHER_DAYS.md) — one leaf-green class
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
 * A shift's BADGE, broken into its parts: the colour class, the emoji, and the word.
 *
 * `getShiftBadge` builds its HTML from this, and so does the calendar's day-detail panel — which
 * needs the same colour and emoji but constructs real elements with `textContent`, because writing
 * markup out of a `data-` attribute is the one shape of this that becomes an injection surface.
 * Two builders would eventually give the same shift two different colours on the same screen.
 *
 * @param {string} timeStr
 * @param {any} [member]  A member whose `permanentShift` forces the kind of every worked, timed shift,
 *   as `getShiftKind` and the Calendar's cells already honour it; the day panel passes it so it cannot
 *   call a day another kind than the cell it opened from. Omitted, the time decides, as before.
 * @returns {{cls: string, emoji: string, word: string, title?: string, timed?: boolean}}
 */
export function shiftBadgeParts(timeStr, member) {
    if (!timeStr || timeStr === 'RD' || timeStr === 'OFF') return { cls: 'badge-rest',  emoji: '🏠', word: 'Rest' };
    if (timeStr === 'SPARE') return { cls: 'badge-spare', emoji: '📋', word: 'Spare' };
    if (timeStr === 'RDW')   return { cls: 'badge-rdw',   emoji: '💼', word: 'RDW',
        title: 'Rest Day Working — extra shift on your rostered day off' };
    if (timeStr === 'AL')    return { cls: 'badge-al',    emoji: '🏖️', word: 'AL' };
    if (timeStr === 'SICK')  return { cls: 'badge-sick',  emoji: '🪑', word: 'Absent' };
    // Other family — 🏷️ + the SHORT flavour word (Train/Ind/Assess); the FULL word
    // (Training/Induction/Assessment) is shown on tap via the day-detail label instead.
    const _trg = parseOtherValue(timeStr);
    if (_trg) return { cls: 'badge-other', emoji: '🏷️', word: OTHER_FLAVOURS[_trg.flavour].badge };
    if (!SHIFT_TIME_REGEX.test(timeStr)) return { cls: 'badge-unknown', emoji: '❓', word: 'Unknown' };
    // `timed` = this badge's word is a CLASSIFICATION of a time, so a caller may trade the word
    // for the time itself. Declared here rather than re-derived from the class by each consumer.
    // The kind is `getShiftKind`'s, so a member's `permanentShift` wins here exactly as it does there.
    const kind = getShiftKind(timeStr, member);
    if (kind === 'night') return { cls: 'badge-night', emoji: '🦉', word: 'Night', timed: true };
    return kind === 'early'
        ? { cls: 'badge-early', emoji: '☀️', word: 'Early', timed: true }
        : { cls: 'badge-late',  emoji: '🌙', word: 'Late',  timed: true };
}

/**
 * Returns an HTML shift badge `<span>` for a shift value.
 * Icon and label are wrapped in separate child `<span>` elements so the
 * layout direction (stacked vs inline) is controlled purely by CSS on the
 * parent .shift-badge — no <br> in flex context needed.
 * @param {string} timeStr  Shift value (e.g. "RD", "06:00-14:00")
 * @param {{showTime?: boolean}} [opts]  `showTime` renders a WORKED shift's badge as the time
 *   (`☀️ 06:20-14:20`) rather than its classification (`☀️ Early`), keeping the word in the
 *   accessible name. Added v22.21 for Admin's Change-a-Shift week grid, where the badge was the
 *   only thing on the row and "EARLY" does not tell you what the person is rostered to work —
 *   which is precisely the question you are answering when you decide whether to change it.
 *   Non-worked values (Rest, AL, Spare, Absent, the Other family) ignore it: they have no time,
 *   and their word IS the information.
 * @returns {string}  HTML string (safe — no user data interpolated)
 */
export function getShiftBadge(timeStr, opts = {}) {
    const { cls, emoji, word, title, timed } = shiftBadgeParts(timeStr);
    // `showTime` puts the TIME in the badge instead of the word, and names the word in the
    // accessible label so nothing is lost. Admin's week grid asks for it; the calendar does not,
    // because a calendar cell prints the time beside the badge already and repeating it would eat
    // the cell. Default false, so every existing caller renders byte-identically. Only a TIMED
    // shift has a word to trade away — the fixed kinds ignore the option, exactly as before.
    // `title` from shiftBadgeParts is the EXPLANATION — the day panel reads it and says it in
    // words. It is no longer put on the badge as a tooltip (v23.50): an OS tooltip is a hover
    // surface, and no phone has ever shown one.
    void title;
    const attr = (opts.showTime && timed) ? ` aria-label="${word} shift, ${timeStr.replace('-', ' to ')}"`
        : '';
    const body = (opts.showTime && timed) ? timeStr : word;
    return `<span class="shift-badge ${cls}"${attr}><span aria-hidden="true">${emoji}</span><span>${body}</span></span>`;
}

// ============================================
// ROSTER LOOKUP — shared by both HTML files
// ============================================

/**
 * Resolves a member's effective roster fields (rosterType, currentWeek) for a
 * given date, applying any scheduled `rosterChanges`. Returns the member
 * unchanged when there are no changes or none apply yet; otherwise returns a
 * shallow copy with the matching change's rosterType/currentWeek overlaid.
 * The change with the latest `from` (midnight, inclusive) ≤ date wins, whatever
 * the array's order (v16.19); the ascending sort is still the authoring rule,
 * checked by roster-data.test.mjs and validateTeamMembers (calendar-member.js).
 * A change's `currentWeek` is REFERENCE-ANCHORED, like the base one
 * (.claude/rules/roster-data.md). Only the roster moves: `role` does not.
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
    // currentWeek (fixedRoster[currentWeek]). Who sits on which is roster-member-data.js, and only there.
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
    return getPatternShift(member, date);
}

/**
 * What the member's ROSTER PATTERN says for a date: `getBaseShift` WITHOUT the Christmas rule.
 *
 * Split out (v25.37) because Christmas leave needs the one fact `getBaseShift` deliberately hides —
 * whether the member was due at work on 25 or 26 December before the station closed. It is the
 * same lookup, not a copy of it: start-date suppression and any scheduled roster change apply
 * exactly as they do for every other date, and `getBaseShift` is now the Christmas rule on top of
 * this. **Use `getBaseShift` for everything else**; this answers "what was the pattern", which is a
 * question only the Christmas rules ask. A bank holiday on a pattern that rests on them is RD here.
 * @param {any} member  teamMembers entry
 * @param {Date}   date
 * @returns {string}  Shift value e.g. "RD", "SPARE", "06:00-14:00"
 */
export function getPatternShift(member, date) {
    if (!member) return 'RD';
    // Members with a startDate show RD for all dates before they join
    if (member.startDate) {
        const s = member.startDate;
        const startMidnight = new Date(s.getFullYear(), s.getMonth(), s.getDate());
        const dateMidnight  = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        if (dateMidnight < startMidnight) return 'RD';
    }
    const weekNum = getWeekNumberForDate(date, member);
    const { type, data } = getRosterForMember(member, date);
    if (type === 'fixed' && FIXED_PATTERNS_RESTING_ON_BANK_HOLIDAYS.includes(weekNum) && isBankHoliday(date)) return 'RD';   // roster-cycle-data.js
    return (data[weekNum] && data[weekNum][DAY_KEYS[date.getDay()]]) || 'RD';
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

/** Shared numeric-input cleaning: smart hyphens/minus → '-', curly quotes normalised; £ signs, thousands
 *  commas and EVERY space stripped — parseFloat stops at the first comma or space, so "23,456.78" read as
 *  23, a phone's "3105. 40" as £3,105 and "3 105.40" as £3 (15 Nov 2026), each corrupting a Year to Date
 *  Tax Paid. `\s` also covers the no-break, narrow and thin spaces a paste brings. @param {any} v */
function _cleanNumericString(v) {
    const s = String(v)
        .replace(/[‐-―−−]/g, '-')
        .replace(/[‘’]/g, "'")
        .replace(/£/g, '')
        .replace(/\s+/g, '');
    // ONE comma, with only digits after it, is a thousands separator only where it sits like one: a
    // leading group of one to three digits not starting with 0, then exactly three ("1,234", "21,758").
    // Anything else is a DECIMAL comma. A phone set to a decimal-comma region offers "," on the decimal
    // keypad: stripping it turned "21758,94" into £2,175,894 (whole-app review, Oct 2026), and ",5" —
    // the comma twin of ".5" — into 5 hours, and "7,5833" into 75,833 (10 Nov 2026). Dots before a
    // decimal comma are then the thousands separators ("1.234,56").
    const one = /^(-?)([\d.]*),(\d+)$/.exec(s);
    if (one && !(one[3].length === 3 && /^[1-9]\d{0,2}$/.test(one[2]))) {
        return `${one[1]}${one[2].replace(/\./g, '')}.${one[3]}`;
    }
    return s.replace(/,/g, '');
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
 * The LOCAL PART of a work email — what a member actually types when the field shows
 * `@chilternrailways.co.uk` beside it.
 *
 * It strips ONLY our own domain, and that restriction is the whole point. Stripping any
 * `@…` would turn `g.miller@gmail.com` into `g.miller`, which the save path would then
 * complete back into a Chiltern address the member never gave us — silently changing
 * somebody's address into a plausible wrong one. A foreign domain must stay visible so
 * `isChilternWorkEmail` can refuse it and the member can see why.
 * @param {string} v  a full address, or a local part already
 * @returns {string}
 */
export function workEmailLocalPart(v) {
    if (typeof v !== 'string') return '';
    const e = v.trim();
    const suffix = '@' + CONFIG.WORK_EMAIL_DOMAIN;
    return e.toLowerCase().endsWith(suffix) ? e.slice(0, -suffix.length) : e;
}

/**
 * The inverse: the full address to SAVE, from whatever is in the field.
 *
 * Idempotent on our own domain (so it is safe to call on a value autofill already
 * completed), and it never rewrites a foreign domain onto ours — same reason as above.
 * @param {string} v  a local part, or a full address already
 * @returns {string}  '' when there is nothing to save
 */
export function workEmailFrom(v) {
    if (typeof v !== 'string') return '';
    const e = v.trim();
    if (!e) return '';
    return e.includes('@') ? e : e + '@' + CONFIG.WORK_EMAIL_DOMAIN;
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
// Production: skip the scan of every cell of every pattern, to speed up first paint.
// Dev/debug: opt-in via localhost or ?debug=1 query string.
if (typeof location !== 'undefined' &&
    (location.hostname === 'localhost' || location.hostname === '127.0.0.1' ||
     location.search.includes('debug'))) {
    validateRosterPatterns();
}

// The real payslip actuals were moved OUT of this served
// module at v14.68 → a hosting-excluded fixture (privacy; Track 2 / Option A), and out of the
// repository entirely at v23.71 — the Pages mirror serves the repo root, so an ignore list could
// not express the decision for both origins. It is now the gitignored
// test-fixtures/payslip-actuals.local.js; see test-fixtures/payslip-actuals.example.js.
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
    // locking every manager out AND letting "Disable accounts for leavers" disable every manager
    // account (they'd vanish from `activeMembers` in functions/roster-members.json, which
    // generate-roster-members.mjs builds from this function). A manager/clerk LEAVER is offboarded by removing
    // their row from teamMembers (and from CONFIG.MANAGER_NAMES) — not by `hidden: true`.
    if (grade === 'Management') return teamMembers.filter(m => m.managerOnly);
    return teamMembers.filter(m => m.role === grade && !m.hidden && !m.managerOnly);
}

