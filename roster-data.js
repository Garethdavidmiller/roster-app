// MYB Roster — Shared Data
// Single source of truth for roster configuration, team members, and shift patterns.
// ES module — import named exports into consuming files:
//   import { CONFIG, APP_VERSION, teamMembers, weeklyRoster, ... } from './roster-data.js';
//
// APP_VERSION is the single authoritative version number. Both HTML files read it at runtime
// via CONFIG.APP_VERSION (set below). The only manual version step remaining is updating the
// import cache-busting query strings in index.html and admin.html when the version changes.

/** Single source of truth for the app version. Update this on every commit that touches app behaviour. */
export const APP_VERSION = '7.99';

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
    ADMIN_NAMES:                      ['G. Miller'],                              // Names with elevated admin access — add names here to grant admin rights
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
//   role           {string}  'CEA' | 'CES' | 'Dispatcher' — controls dropdown grouping
//   hidden         {boolean} Optional. true = vacancy/removed; excluded from dropdown, data preserved
//   permanentShift {string}  Optional. 'early' | 'late' — overrides badge colour on worked days,
//                            suppresses shift time. Remove to restore normal roster display.

export const teamMembers = [
    { name: 'L. Springer',             currentWeek: 1,  rosterType: 'main',       role: 'CEA' },
    { name: 'A. Hared',                currentWeek: 2,  rosterType: 'main',       role: 'CEA' },
    { name: 'G. Miller',               currentWeek: 3,  rosterType: 'main',       role: 'CEA' },
    { name: 'M. Robson',               currentWeek: 4,  rosterType: 'main',       role: 'CEA' },
    { name: 'C. Matthews',             currentWeek: 5,  rosterType: 'main',       role: 'CEA', hidden: true }, // Vacancy — hidden from dropdown
    { name: 'I. Cooper',               currentWeek: 6,  rosterType: 'main',       role: 'CEA' },
    { name: 'A. Panchal',              currentWeek: 7,  rosterType: 'main',       role: 'CEA' },
    { name: 'C. Francisco-Charles',    currentWeek: 8,  rosterType: 'main',       role: 'CEA' },
    { name: 'O. Mylla',                currentWeek: 9,  rosterType: 'main',       role: 'CEA' },
    { name: 'S. Boyle',                currentWeek: 10, rosterType: 'main',       role: 'CEA' },
    { name: 'L. Atrakimaviciene',      currentWeek: 11, rosterType: 'main',       role: 'CEA' },
    { name: 'J. Haque',                currentWeek: 12, rosterType: 'main',       role: 'CEA' },
    { name: 'R. Frimpong',             currentWeek: 13, rosterType: 'main',       role: 'CEA', hidden: true }, // Left — vacancy to be filled
    { name: 'N. Tuck',                 currentWeek: 14, rosterType: 'main',       role: 'CEA' },
    { name: 'R. Forrester-Blackstock', currentWeek: 15, rosterType: 'main',       role: 'CEA' },
    { name: 'S. Langley',              currentWeek: 16, rosterType: 'main',       role: 'CEA' },
    { name: 'S. Silva',                currentWeek: 17, rosterType: 'main',       role: 'CEA' },
    { name: 'J. Sumaili',              currentWeek: 18, rosterType: 'main',       role: 'CEA' },
    { name: 'T. Bibi',                 currentWeek: 19, rosterType: 'main',       role: 'CEA' },
    { name: 'T. Nsuala',               currentWeek: 20, rosterType: 'main',       role: 'CEA' },
    { name: 'D. Irvine',               currentWeek: 3,  rosterType: 'bilingual',  role: 'CEA' },
    { name: 'M. Okeke',                currentWeek: 4,  rosterType: 'bilingual',  role: 'CEA', startDate: new Date(2026, 3, 20), proRatedAL: { 2026: 23 } },
    { name: 'T. Gherbi',               currentWeek: 6,  rosterType: 'bilingual',  role: 'CEA' },
    { name: 'C. Reen',                 currentWeek: 1,  rosterType: 'fixed',      role: 'CEA' },  // Fixed Mon-Fri 12:00-19:00 (reasonable adjustments)

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
    { name: 'Vacant',                  currentWeek: 4,  rosterType: 'ces',        role: 'CES', hidden: true },
    { name: 'G. Rotaru',               currentWeek: 5,  rosterType: 'ces',        role: 'CES' },
    { name: 'L. Webster',              currentWeek: 6,  rosterType: 'ces',        role: 'CES' },
    { name: 'Z. Lewis',                currentWeek: 7,  rosterType: 'ces',        role: 'CES' },
    { name: 'M. Bowler',               currentWeek: 8,  rosterType: 'ces',        role: 'CES' },
    { name: 'W. Cummings',             currentWeek: 9,  rosterType: 'ces',        role: 'CES' },
    { name: 'S. Horsman',              currentWeek: 10, rosterType: 'ces',        role: 'CES' },
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
//   C. Reen        → 34 days (fixed roster / reasonable adjustments)
//   All CEAs       → 32 days  (main, bilingual, or any other CEA rosterType)

/**
 * Count how many UK bank holidays a dispatcher actually worked in a given year,
 * after applying Firestore overrides. Each worked bank holiday earns 1 day in lieu.
 *
 * @param {object} member   — teamMembers entry (must be a Dispatcher)
 * @param {number} year     — calendar year to check
 * @param {Array}  overrides — flat array of override objects { memberName, date, value, ... }
 * @returns {number}  count of bank holidays on which the member worked
 */
function countDispatcherBankHolidaysWorked(member, year, overrides) {
    const NON_WORKED = new Set(['RD', 'OFF', 'SPARE', 'AL', 'SICK']);
    const bankHolidays = getBankHolidays(year);

    // Build a quick date → value lookup for this member's overrides
    const overrideMap = new Map();
    for (const o of overrides) {
        if (o.memberName === member.name && o.date) {
            overrideMap.set(o.date, o.value);
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
            ? overrideMap.get(dateStr)
            : getBaseShift(member, bh);

        if (!NON_WORKED.has(shift)) lieuDays++;
    }
    return lieuDays;
}

/**
 * Annual leave entitlement for a staff member in a given year.
 * For Dispatchers the entitlement is dynamic: 22 base days plus one day in lieu
 * for every bank holiday on which they worked (after overrides). All other roles
 * return a fixed number regardless of year or overrides.
 *
 * @param {object} member    — teamMembers entry
 * @param {number} [year]    — calendar year; defaults to current year
 * @param {Array}  [overrides] — all override objects for this member; defaults to []
 * @returns {number}
 */
export function getALEntitlement(member, year = new Date().getFullYear(), overrides = []) {
    if (!member) return 32;
    if (member.role === 'Dispatcher') return 22 + countDispatcherBankHolidaysWorked(member, year, overrides);
    if (member.role === 'CES') return 34;
    if (member.rosterType === 'fixed') return 34; // C. Reen — reasonable adjustments
    // Pro-rated entitlement for members who joined part-way through the year
    if (member.proRatedAL && member.proRatedAL[year] !== undefined) return member.proRatedAL[year];
    return 32;
}

// ============================================
// ROSTER PATTERNS
// ============================================

// 20-week rotating roster pattern.
// SP weeks mean "Spare" — can be rostered ANY day, ANY shift during that week.
export const weeklyRoster = {
    1:  { sun: 'SPARE',       mon: 'SPARE',       tue: 'SPARE',       wed: 'SPARE',       thu: 'SPARE',       fri: 'SPARE',       sat: 'SPARE'       },
    2:  { sun: '14:30-23:25', mon: '15:15-23:55', tue: '15:15-23:55', wed: '15:15-23:55', thu: '15:15-23:55', fri: 'RD',          sat: 'RD'          },
    3:  { sun: 'RD',          mon: 'RD',          tue: '06:20-14:20', wed: '06:20-14:20', thu: '06:20-14:20', fri: '06:20-14:20', sat: '06:20-14:00' },
    4:  { sun: '07:15-15:45', mon: 'RD',          tue: '06:20-14:20', wed: '06:20-14:20', thu: 'RD',          fri: 'RD',          sat: '14:45-23:55' },
    5:  { sun: '14:30-23:25', mon: '14:00-22:30', tue: '14:00-22:30', wed: '14:00-22:30', thu: '14:00-22:30', fri: '15:15-23:55', sat: 'RD'          },
    6:  { sun: 'RD',          mon: '06:20-14:20', tue: '08:00-16:30', wed: '08:00-16:30', thu: '08:00-16:30', fri: '08:00-16:30', sat: 'RD'          },
    7:  { sun: 'SPARE',       mon: 'SPARE',       tue: 'SPARE',       wed: 'SPARE',       thu: 'SPARE',       fri: 'SPARE',       sat: 'SPARE'       },
    8:  { sun: '07:15-15:45', mon: '06:20-13:45', tue: 'RD',          wed: 'RD',          thu: '13:30-22:00', fri: '14:00-22:30', sat: '13:30-21:00' },
    9:  { sun: 'RD',          mon: '11:00-19:30', tue: '11:00-19:30', wed: '11:00-19:30', thu: '11:00-19:30', fri: '11:00-19:30', sat: 'RD'          },
    10: { sun: 'RD',          mon: 'RD',          tue: '15:15-23:55', wed: '15:15-23:55', thu: '15:15-23:55', fri: '15:15-23:55', sat: '14:45-23:55' },
    11: { sun: 'RD',          mon: '08:00-16:30', tue: '13:30-22:00', wed: 'RD',          thu: 'RD',          fri: '06:20-13:35', sat: '06:20-14:50' },
    12: { sun: 'SPARE',       mon: 'SPARE',       tue: 'SPARE',       wed: 'SPARE',       thu: 'SPARE',       fri: 'SPARE',       sat: 'SPARE'       },
    13: { sun: 'RD',          mon: 'RD',          tue: '14:00-22:30', wed: '14:00-22:30', thu: '14:00-22:30', fri: '14:00-22:30', sat: '14:30-22:00' },
    14: { sun: '14:30-23:25', mon: '14:00-22:30', tue: 'RD',          wed: 'RD',          thu: 'RD',          fri: '08:00-16:30', sat: '06:20-14:50' },
    15: { sun: '07:15-15:45', mon: '06:20-13:35', tue: '06:20-13:35', wed: '06:20-13:35', thu: '06:20-13:35', fri: 'RD',          sat: 'RD'          },
    16: { sun: 'RD',          mon: '08:00-16:30', tue: '08:00-16:30', wed: '08:00-16:30', thu: 'RD',          fri: 'RD',          sat: 'RD'          },
    17: { sun: 'SPARE',       mon: 'SPARE',       tue: 'SPARE',       wed: 'SPARE',       thu: 'SPARE',       fri: 'SPARE',       sat: 'SPARE'       },
    18: { sun: '13:00-21:00', mon: '15:15-23:55', tue: 'RD',          wed: 'RD',          thu: '06:20-14:20', fri: '06:20-14:20', sat: '06:20-14:50' },
    19: { sun: 'RD',          mon: 'RD',          tue: '06:20-13:45', wed: '06:20-13:45', thu: '06:20-13:45', fri: '06:20-13:45', sat: '12:00-20:00' },
    20: { sun: '08:30-16:30', mon: '06:20-14:20', tue: 'RD',          wed: 'RD',          thu: '08:00-16:30', fri: '13:30-22:00', sat: '14:30-22:00' },
};

// 8-week bilingual roster pattern
export const bilingualRoster = {
    1: { sun: 'SPARE',       mon: 'SPARE',       tue: 'SPARE',       wed: 'SPARE',       thu: 'SPARE',       fri: 'SPARE',       sat: 'SPARE'       },
    2: { sun: 'OFF',         mon: 'RD',          tue: 'RD',          wed: '15:00-23:30', thu: '15:00-23:30', fri: '15:00-23:30', sat: '14:25-23:55' },
    3: { sun: '15:25-23:25', mon: 'RD',          tue: 'RD',          wed: 'RD',          thu: '07:00-16:00', fri: '08:00-17:00', sat: '08:00-14:30' },
    4: { sun: 'OFF',         mon: '07:00-16:00', tue: '07:00-16:00', wed: '07:00-16:00', thu: 'RD',          fri: 'RD',          sat: '07:00-15:00' },
    5: { sun: 'OFF',         mon: '12:00-21:00', tue: '12:00-21:00', wed: '12:00-21:00', thu: '12:00-21:00', fri: '12:00-21:00', sat: 'RD'          },
    6: { sun: '07:55-15:55', mon: '15:00-23:30', tue: '15:00-23:30', wed: 'RD',          thu: '08:00-17:00', fri: '07:00-16:00', sat: '08:30-17:00' },
    7: { sun: 'OFF',         mon: '08:00-17:00', tue: '08:00-17:00', wed: '08:00-17:00', thu: 'RD',          fri: 'RD',          sat: 'RD'          },
    8: { sun: 'SPARE',       mon: 'SPARE',       tue: 'SPARE',       wed: 'SPARE',       thu: 'SPARE',       fri: 'SPARE',       sat: 'SPARE'       },
};

// Fixed roster — single repeating week, no rotation.
// Used for team members with reasonable adjustments or bespoke arrangements.
export const fixedRoster = {
    1: { sun: 'RD', mon: '12:00-19:00', tue: '12:00-19:00', wed: '12:00-19:00', thu: '12:00-19:00', fri: '12:00-19:00', sat: 'RD' },
};

// 10-week CES (Customer Experience Supervisor) roster — Marylebone.
// Weeks 4 and 9 are spare weeks with guaranteed Sunday working.
// Reference: F. Mohamed on Week 1 w/c 15 Feb 2026.
export const cesRoster = {
    1:  { sun: 'RD',          mon: 'RD',          tue: 'RD',          wed: '05:40-14:30', thu: '06:20-15:30', fri: '05:40-14:30', sat: '05:40-15:00' },
    2:  { sun: 'RD',          mon: '06:20-15:30', tue: '05:40-14:30', wed: '06:20-15:30', thu: '05:40-14:30', fri: 'RD',          sat: 'RD'          },
    3:  { sun: '07:15-15:30', mon: '05:40-14:30', tue: '06:20-15:30', wed: 'RD',          thu: 'RD',          fri: '06:20-15:30', sat: '06:20-15:00' },
    4:  { sun: 'SPARE',       mon: 'SPARE',       tue: 'SPARE',       wed: 'SPARE',       thu: 'SPARE',       fri: 'SPARE',       sat: 'RD'          },
    5:  { sun: '07:15-15:30', mon: 'SPARE',       tue: 'SPARE',       wed: 'SPARE',       thu: 'SPARE',       fri: 'RD',          sat: 'RD'          },
    6:  { sun: 'RD',          mon: 'RD',          tue: 'RD',          wed: '14:30-23:45', thu: '15:30-00:30', fri: '14:30-23:45', sat: '15:00-23:55' },
    7:  { sun: 'RD',          mon: '15:30-00:30', tue: '14:30-23:45', wed: '15:30-00:30', thu: '14:30-23:45', fri: 'RD',          sat: 'RD'          },
    8:  { sun: '15:30-23:45', mon: '14:30-23:45', tue: '15:30-00:30', wed: 'RD',          thu: 'RD',          fri: '15:30-01:30', sat: '15:00-00:30' },
    9:  { sun: 'SPARE',       mon: 'SPARE',       tue: 'SPARE',       wed: 'SPARE',       thu: 'SPARE',       fri: 'SPARE',       sat: 'RD'          },
    10: { sun: '15:30-00:30', mon: 'SPARE',       tue: 'SPARE',       wed: 'SPARE',       thu: 'SPARE',       fri: 'RD',          sat: 'RD'          },
};

// Dispatcher base roster — 10-week rotating cycle.
// Source: MYB Dispatch Base Roster PDF, week starting 01/02/26.
// Each person advances one row per week and wraps after row 10.
// Rows 2 and 7 are rest weeks (Mon-Sat RD). Row 7 has a rostered
// Sunday (uncontracted overtime — shown as worked, same as CEA/CES).
// Row 9 Mon-Fri: Dia SP (Spare diagram) — shown as SPARE, same rule as CES.
// Sunday and Saturday in row 9 have fixed times so are shown as worked shifts.
// Overnight shifts (e.g. 22:30-07:00) labelled by start day per Howard.
export const dispatcherRoster = {
    1:  { sun: '22:00-07:00', mon: '22:30-07:00', tue: '22:30-07:00', wed: '22:30-07:00', thu: '22:30-07:00', fri: '22:30-07:00', sat: '22:30-09:00' },
    2:  { sun: 'RD',          mon: 'RD',          tue: 'RD',          wed: 'RD',          thu: 'RD',          fri: 'RD',          sat: 'RD'          },
    3:  { sun: '15:00-22:00', mon: '14:00-20:30', tue: '14:00-20:30', wed: '14:00-20:30', thu: '14:00-20:30', fri: '14:00-20:30', sat: 'RD'          },
    4:  { sun: 'RD',          mon: '07:00-14:30', tue: '07:00-14:30', wed: '07:00-14:30', thu: '07:00-14:30', fri: '07:00-14:30', sat: '07:00-15:00' },
    5:  { sun: '09:00-15:00', mon: '14:30-22:30', tue: '14:30-22:30', wed: '14:30-22:30', thu: '14:30-22:30', fri: '14:30-22:30', sat: 'RD'          },
    6:  { sun: 'RD',          mon: '08:00-15:30', tue: '08:00-15:30', wed: '08:00-15:30', thu: '08:00-15:30', fri: '08:00-15:30', sat: '14:30-22:30' },
    7:  { sun: '15:30-22:30', mon: 'RD',          tue: 'RD',          wed: 'RD',          thu: 'RD',          fri: 'RD',          sat: 'RD'          },
    8:  { sun: 'RD',          mon: '06:45-14:15', tue: '06:45-14:15', wed: '06:45-14:15', thu: '06:45-14:15', fri: '06:45-14:15', sat: '07:30-15:30' },
    9:  { sun: '09:30-15:30', mon: 'SPARE',       tue: 'SPARE',       wed: 'SPARE',       thu: 'SPARE',       fri: 'SPARE',       sat: '15:00-23:00' },
    10: { sun: 'RD',          mon: '15:30-00:00', tue: '15:30-00:00', wed: '15:30-00:00', thu: '15:30-00:00', fri: '15:30-00:00', sat: 'RD'          },
};

// ============================================
// SHARED CONSTANTS
// ============================================

export const DAY_KEYS  = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTH_ABB = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Swipe gesture thresholds — shared by app.js and admin-app.js so tuning
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
function computeEaster(year) {
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

/**
 * Generate a Set of 'YYYY-MM-DD' strings for a fixed annual date (same MM-DD every year).
 * Automatically covers CONFIG.MIN_YEAR through CONFIG.MAX_YEAR + 1 — no manual updates needed.
 * @param {number} month  1-based (1 = January)
 * @param {number} day
 * @returns {Set<string>}
 */
function fixedAnnualDate(month, day) {
    const s  = new Set();
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    for (let y = CONFIG.MIN_YEAR; y <= CONFIG.MAX_YEAR + 1; y++) s.add(`${y}-${mm}-${dd}`);
    return s;
}

/**
 * Generate a Set of 'YYYY-MM-DD' strings by offsetting from Easter Sunday.
 * Automatically covers CONFIG.MIN_YEAR through CONFIG.MAX_YEAR + 1 — no manual updates needed.
 * @param {number} offsetDays  Positive = after Easter, negative = before Easter
 * @returns {Set<string>}
 */
function easterOffset(offsetDays) {
    const s = new Set();
    for (let y = CONFIG.MIN_YEAR; y <= CONFIG.MAX_YEAR + 1; y++) {
        const d = computeEaster(y);
        d.setDate(d.getDate() + offsetDays);
        s.add(d.toISOString().slice(0, 10));
    }
    return s;
}

/**
 * Generate a Set of 'YYYY-MM-DD' strings for the Nth occurrence of a weekday in a month.
 * Automatically covers CONFIG.MIN_YEAR through CONFIG.MAX_YEAR + 1 — no manual updates needed.
 * @param {number} weekday  0 = Sunday … 6 = Saturday
 * @param {number} n        1-based ordinal (1 = first, 3 = third …)
 * @param {number} month    0-based month (0 = January, 9 = October …)
 * @returns {Set<string>}
 */
function nthWeekdayOfMonth(weekday, n, month) {
    const s = new Set();
    for (let y = CONFIG.MIN_YEAR; y <= CONFIG.MAX_YEAR + 1; y++) {
        const first  = new Date(y, month, 1);
        const offset = (weekday - first.getDay() + 7) % 7;
        const date   = new Date(y, month, 1 + offset + (n - 1) * 7);
        s.add(date.toISOString().slice(0, 10));
    }
    return s;
}

// ============================================
// ISLAMIC CALENDAR DATES (Umm al-Qura)
// ============================================
// Verified March 2026. Review dates annually — they shift ~11 days earlier each year.
// Source: qppstudio.net / timeanddate.com / publicholidays.ae
// All dates carry a ±1 day margin vs actual moon-sighting confirmation.
//
// ⚠️  2030 quirk: the Islamic year is ~11 days shorter than the Gregorian year,
//     so 2030 contains TWO Ramadans (Jan 5 and Dec 26). Both are included.
//     The Dec 2030 Ramadan's Eid al-Fitr falls in January 2031 — also included.
//     The Dec 2030 Ramadan's Eid al-Adha falls in April 2031 — also included.
//
// To extend beyond 2030: subtract ~11 days from each date per year and verify
// against islamicfinder.org or the official Umm al-Qura calendar.

export const RAMADAN_STARTS = new Set([
    '2025-03-01',
    '2026-02-18',
    '2027-02-08',
    '2028-01-28',
    '2029-01-16',
    '2030-01-05',
    '2030-12-26', // second Ramadan in 2030
]);

export const EID_FITR_DATES = new Set([
    '2025-03-30',
    '2026-03-20',
    '2027-03-09',
    '2028-02-26',
    '2029-02-14',
    '2030-02-04',
    '2031-01-24', // Eid al-Fitr from the Dec 2030 Ramadan
]);

export const EID_ADHA_DATES = new Set([
    '2025-06-06',
    '2026-05-26',
    '2027-05-16',
    '2028-05-05',
    '2029-04-24',
    '2030-04-13',
    '2031-04-02', // Eid al-Adha from the Dec 2030 Ramadan (Islamic year 1452)
]);

// Islamic New Year (1 Muharram) — first day of the Hijri calendar year.
// Source: Umm al-Qura calendar (Saudi Arabia). ±1 day depending on moon-sighting.
// The Islamic year is ~354 days, so this date shifts ~10–11 days earlier each year.
export const ISLAMIC_NEW_YEAR_DATES = new Set([
    '2025-06-26',
    '2026-06-16',
    '2027-06-06',
    '2028-05-25',
    '2029-05-14',
    '2030-05-03',
    '2031-04-23',
]);

// Mawlid al-Nabi (12 Rabi' al-Awwal) — the Prophet Muhammad's birthday.
// Observed by most UK Muslim communities (South Asian, North African, West African,
// Turkish traditions). Not observed by Wahhabi/Salafi/Deobandi denominations.
// Source: Umm al-Qura calendar. ±1 day depending on moon-sighting.
export const MAWLID_DATES = new Set([
    '2025-09-04',
    '2026-08-25',
    '2027-08-15',
    '2028-08-03',
    '2029-07-24',
    '2030-07-13',
    '2031-07-02',
]);

// ============================================
// HINDU CALENDAR DATES (Hindu lunar calendar)
// ============================================
// Source: drikpanchang.com (London, United Kingdom timezone).
// All dates carry a ±1 day margin — actual dates may vary by region and
// moon-sighting. Review dates annually.
//
// 2025–2030 dates verified March 2026 against multiple Panchang sources.
// Holi 2029 corrected from 2029-03-30 to 2029-03-01; the earlier estimate
// was wrong — 2029 Adhik Maas is Adhik Chaitra (falls after Phalguna, so
// does not affect Holi). All other 2029–2030 estimates were confirmed correct.

// Holi (Rangwali Holi — Festival of Colours). Second day of the two-day festival.
export const HOLI_DATES = new Set([
    '2025-03-14',
    '2026-03-04',
    '2027-03-22',
    '2028-03-11',
    '2029-03-01', // Phalguna Purnima ~11 days before 2028. 2029 Adhik Maas is Adhik Chaitra
                  // (falls after Phalguna), so does not shift Holi. Some sources cite Mar 30
                  // in error — that would require Adhik Phalguna, which does not occur in 2029.
    '2030-03-20',
]);

// Sharad Navratri — first day of the nine-night festival of Durga.
export const NAVRATRI_DATES = new Set([
    '2025-09-22',
    '2026-10-11',
    '2027-09-30',
    '2028-09-19',
    '2029-10-07',
    '2030-09-27',
]);

// Dussehra (Vijayadashami) — tenth day of Navratri; victory of good over evil.
export const DUSSEHRA_DATES = new Set([
    '2025-10-02',
    '2026-10-20',
    '2027-10-09',
    '2028-09-27',
    '2029-10-16',
    '2030-10-06',
]);

// Diwali (Lakshmi Puja) — Festival of Lights. Main day of the five-day festival.
export const DIWALI_DATES = new Set([
    '2025-10-20',
    '2026-11-08',
    '2027-10-28',
    '2028-10-17',
    '2029-11-05',
    '2030-10-26',
]);

// Raksha Bandhan — brother-sister bond festival (full moon in Shravan).
export const RAKSHA_BANDHAN_DATES = new Set([
    '2025-08-09',
    '2026-08-28',
    '2027-08-17',
    '2028-08-05',
    '2029-08-23',
    '2030-08-13',
]);

// ============================================
// CHINESE / LUNAR NEW YEAR DATES
// ============================================
// Source: chinesenewyear.net / timeanddate.com (verified 2025–2030).
// Date = first day of the Chinese lunisolar new year (新年 / 春節).
// The zodiac animal changes each year; the emoji is shown as the cell marker.

export const CHINESE_NEW_YEAR_DATES = new Map([
    ['2025-01-29', { icon: '🐍', label: 'Lunar New Year — Year of the Snake' }],
    ['2026-02-17', { icon: '🐴', label: 'Lunar New Year — Year of the Horse' }],
    ['2027-02-06', { icon: '🐏', label: 'Lunar New Year — Year of the Goat' }],
    ['2028-01-26', { icon: '🐒', label: 'Lunar New Year — Year of the Monkey' }],
    ['2029-02-13', { icon: '🐓', label: 'Lunar New Year — Year of the Rooster' }],
    ['2030-02-03', { icon: '🐕', label: 'Lunar New Year — Year of the Dog' }],
]);

// Lantern Festival (元宵節) — 15th day of the 1st lunar month; marks the end of CNY.
// ±1 day — actual dates depend on the Chinese lunisolar calendar.
export const LANTERN_FESTIVAL_DATES = new Set([
    '2025-02-12',
    '2026-03-03',
    '2027-02-20',
    '2028-02-09',
    '2029-02-27',
    '2030-02-17',
]);

// Qingming / Tomb Sweeping Day (清明節) — a solar term, not lunisolar.
// Always falls on 4–5 April; no ±1 day caveat needed.
// Note: Qingming 2026 (Apr 5) coincides with Easter Sunday 2026 (Apr 5).
// Easter is a built-in marker shown to all users; a Chinese-calendar user will see
// both 🐣 and 🌿 stacked in the bottom-right corner of that cell — cosmetically fine.
export const QINGMING_DATES = new Set([
    '2025-04-04',
    '2026-04-05',
    '2027-04-05',
    '2028-04-04',
    '2029-04-04',
    '2030-04-05',
]);

// Dragon Boat Festival (端午節) — 5th day of the 5th lunar month.
// ±1 day — actual dates depend on the Chinese lunisolar calendar.
// Source: timeanddate.com / chinesecalendar.net (verified 2025–2030).
export const DRAGON_BOAT_DATES = new Set([
    '2025-05-31',
    '2026-06-19',
    '2027-06-09',
    '2028-05-28',
    '2029-06-16',
    '2030-06-05',
]);

// Mid-Autumn / Moon Festival (中秋節) — 15th day of the 8th lunar month.
// ±1 day — actual dates depend on the Chinese lunisolar calendar.
// Source: timeanddate.com / chinesecalendar.net (verified 2025–2030).
// Note: 2027 (Sep 16), 2029 (Sep 22), and 2030 (Sep 12) are one lunar month
// earlier than some informal sources — the astronomical 8th-month dates are used here.
export const MID_AUTUMN_DATES = new Set([
    '2025-10-06',
    '2026-09-25',
    '2027-09-16',
    '2028-10-03',
    '2029-09-22',
    '2030-09-12',
]);

// ============================================
// JAMAICAN PUBLIC HOLIDAYS — auto-computed
// ============================================
// Fixed-date and moveable holidays are generated automatically for the full
// CONFIG year range. No manual updates needed when MAX_YEAR is extended.

// Ash Wednesday — 46 days before Easter Sunday (moveable). Auto-computed.
export const JAMAICAN_ASH_WEDNESDAY_DATES = easterOffset(-46);

// National Labour Day — fixed on 23 May. Auto-computed.
export const JAMAICAN_LABOUR_DAY_DATES = fixedAnnualDate(5, 23);

// Emancipation Day — fixed on 1 August. Marks abolition of slavery (1 Aug 1838). Auto-computed.
export const JAMAICAN_EMANCIPATION_DATES = fixedAnnualDate(8, 1);

// Independence Day — fixed on 6 August. Marks independence from the UK (6 Aug 1962). Auto-computed.
export const JAMAICAN_INDEPENDENCE_DATES = fixedAnnualDate(8, 6);

// National Heroes Day — third Monday of October. Auto-computed.
export const JAMAICAN_HEROES_DAY_DATES = nthWeekdayOfMonth(1, 3, 9); // weekday=Mon, n=3rd, month=Oct

// ============================================
// CONGOLESE PUBLIC HOLIDAYS — auto-computed
// ============================================
// All Congolese public holidays fall on fixed calendar dates each year.
// Generated automatically for the full CONFIG year range.

// Martyrs' Day — 4 January. Commemorates protesters killed 4 Jan 1959 in Léopoldville. Auto-computed.
export const CONGOLESE_MARTYRS_DATES = fixedAnnualDate(1, 4);

// Liberation Day — 17 May. Marks end of Mobutu's rule in 1997. Auto-computed.
export const CONGOLESE_LIBERATION_DATES = fixedAnnualDate(5, 17);

// Heroes' Day — 1 June. Honours national heroes of the DRC. Auto-computed.
export const CONGOLESE_HEROES_DATES = fixedAnnualDate(6, 1);

// Independence Day — 30 June. Independence from Belgium (30 Jun 1960). Auto-computed.
export const CONGOLESE_INDEPENDENCE_DATES = fixedAnnualDate(6, 30);

// ============================================
// PORTUGUESE PUBLIC HOLIDAYS — auto-computed
// ============================================
// All mandatory national holidays not already covered by UK bank holidays,
// Good Friday, Christmas, or the app-wide Easter Sunday marker.
// Fixed-date and Easter-relative holidays are generated automatically.

// Carnival Tuesday — day before Ash Wednesday (Easter − 47 days). Auto-computed.
// Widely observed (schools close); technically "tolerância de ponto" not statutory.
export const PORTUGUESE_CARNIVAL_DATES = easterOffset(-47);

// Freedom Day (25 Abril) — fixed. Commemorates the Carnation Revolution (25 Apr 1974). Auto-computed.
export const PORTUGUESE_FREEDOM_DATES = fixedAnnualDate(4, 25);

// Labour Day (1 Maio) — fixed. Unlike UK's moveable May BH, Portugal's is always 1 May. Auto-computed.
export const PORTUGUESE_LABOUR_DATES = fixedAnnualDate(5, 1);

// Portugal Day (10 Junho) — fixed. Named for Luís de Camões (death anniversary). Auto-computed.
export const PORTUGUESE_PORTUGAL_DAY_DATES = fixedAnnualDate(6, 10);

// Corpus Christi — Thursday, 60 days after Easter. Restored April 2016. Auto-computed.
export const PORTUGUESE_CORPUS_CHRISTI_DATES = easterOffset(60);

// Assumption of Mary (15 Agosto) — fixed. Auto-computed.
export const PORTUGUESE_ASSUMPTION_DATES = fixedAnnualDate(8, 15);

// Republic Day (5 Outubro) — fixed. Proclamation of Portuguese Republic (5 Oct 1910). Auto-computed.
export const PORTUGUESE_REPUBLIC_DATES = fixedAnnualDate(10, 5);

// Restoration of Independence (1 Dezembro) — fixed. End of Spanish rule in 1640. Auto-computed.
export const PORTUGUESE_RESTORATION_DATES = fixedAnnualDate(12, 1);

// Immaculate Conception (8 Dezembro) — fixed. Major Catholic feast; schools close. Auto-computed.
export const PORTUGUESE_IMMACULATE_DATES = fixedAnnualDate(12, 8);

// ============================================
// DATE UTILITIES — shared by index.html and admin.html
// ============================================

// Compare two dates by calendar day only (ignores time component)
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
export const SPECIAL_BANK_HOLIDAYS = [
    // Add future one-off bank holidays here when announced by the government.
];

// Calculate all UK bank holidays for a given year (England & Wales).
// Delegates Easter to computeEaster() — no Computus code is duplicated here.
// Returns an array of Date objects.
// Only supports years within CONFIG.MIN_YEAR–CONFIG.MAX_YEAR; returns [] outside that range.
function calculateBankHolidays(year) {
    if (year < CONFIG.MIN_YEAR || year > CONFIG.MAX_YEAR) {
        console.warn(`calculateBankHolidays: year ${year} is outside supported range (${CONFIG.MIN_YEAR}–${CONFIG.MAX_YEAR}). Returning empty list.`);
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
    // Sat/Sun: both substitutes fall on Mon 27 and Tue 28
    // Fri: Christmas stays Fri 25, Boxing Day substitute Mon 28
    // Weekday: no substitutes needed
    const xmasDay = new Date(year, 11, 25).getDay();
    if (xmasDay === 6 || xmasDay === 0) {
        holidays.push(new Date(year, 11, 27));
        holidays.push(new Date(year, 11, 28));
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

// Cache and getter for bank holidays (calculated once per year)
const _bankHolidaysCache = new Map();
export function getBankHolidays(year) {
    if (!_bankHolidaysCache.has(year)) _bankHolidaysCache.set(year, calculateBankHolidays(year));
    return _bankHolidaysCache.get(year);
}

export function isBankHoliday(date) {
    return getBankHolidays(date.getFullYear()).some(h => isSameDay(h, date));
}

// Dec 25 only — used for 🎄 decoration
export function isChristmasDay(date) {
    return date.getMonth() === 11 && date.getDate() === 25;
}

// Easter Sunday (day before Easter Monday) — used for 🐣 decoration
export function isEasterSunday(date) {
    return getBankHolidays(date.getFullYear()).some(h => {
        if (h.getDay() !== 1 || h.getMonth() < 2 || h.getMonth() > 3) return false;
        const sun = new Date(h);
        sun.setDate(h.getDate() - 1);
        return isSameDay(date, sun);
    });
}

// Cache and calculator for paydays + cutoff dates
const _paydayCache = new Map();
export function getPaydaysAndCutoffs(year) {
    if (year < CONFIG.MIN_YEAR) return { paydays: [], cutoffs: [] };
    if (!_paydayCache.has(year)) {
        const paydays = [];
        const cutoffs = [];
        const msPerDay = 24 * 60 * 60 * 1000;
        const jan1 = new Date(year, 0, 1, 12, 0, 0);
        const daysSinceFirst   = Math.floor((jan1 - CONFIG.FIRST_PAYDAY) / msPerDay);
        const cyclesSinceFirst = Math.floor(daysSinceFirst / CONFIG.PAYDAY_INTERVAL_DAYS);
        let currentMs = CONFIG.FIRST_PAYDAY.getTime()
            + cyclesSinceFirst * CONFIG.PAYDAY_INTERVAL_DAYS * msPerDay;

        // Safety guard: if FIRST_PAYDAY is misconfigured, prevent an infinite loop.
        let advanceGuard = 0;
        while (new Date(currentMs).getFullYear() < year) {
            currentMs += CONFIG.PAYDAY_INTERVAL_DAYS * msPerDay;
            if (++advanceGuard > 1000) {
                console.warn('getPaydaysAndCutoffs: exceeded loop guard advancing to year', year, '— check FIRST_PAYDAY in CONFIG.');
                break;
            }
        }

        let cycleGuard = 0;
        while (new Date(currentMs).getFullYear() === year) {
            if (++cycleGuard > 100) {
                console.warn('getPaydaysAndCutoffs: exceeded cycle guard for year', year, '— check PAYDAY_INTERVAL_DAYS in CONFIG.');
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

export function isPayday(date) {
    return getPaydaysAndCutoffs(date.getFullYear()).paydays.some(p => isSameDay(p, date));
}

export function isCutoffDate(date) {
    return getPaydaysAndCutoffs(date.getFullYear()).cutoffs.some(c => isSameDay(c, date));
}

// ============================================
// FAITH CALENDAR DISPLAY DATA
// ============================================

export const ISLAMIC_LABELS = {
    'ramadan':      'Ramadan begins',
    'eid-fitr':     'Eid al-Fitr',
    'eid-adha':     'Eid al-Adha',
    'islamic-ny':   'Islamic New Year (Al-Hijra)',
    'mawlid':       'Mawlid al-Nabi',
};

export const ISLAMIC_ICONS = {
    'ramadan':      '🌙',
    'eid-fitr':     '☪️',
    'eid-adha':     '🕌',
    'islamic-ny':   '📅',
    'mawlid':       '🌹',
};

export const HINDU_LABELS = {
    'holi':     'Holi',
    'navratri': 'Navratri begins',
    'dussehra': 'Dussehra',
    'diwali':   'Diwali',
    'raksha':   'Raksha Bandhan',
};

export const HINDU_ICONS = {
    'holi':     '🎨',
    'navratri': '🕉️',
    'dussehra': '🏹',
    'diwali':   '🪔',
    'raksha':   '🪢',
};

// Chinese / Lunar New Year — the icon varies by year (zodiac animal).
// CHINESE_NEW_YEAR_DATES is a Map<dateStr, {icon, label}> so the icon is
// resolved at lookup time rather than being a fixed value here.
export const CHINESE_LABELS = {
    'chinese-new-year': 'Lunar New Year',
    'lantern':          'Lantern Festival (元宵節)',
    'qingming':         'Qingming / Tomb Sweeping Day (清明節)',
    'dragon-boat':      'Dragon Boat Festival (端午節)',
    'mid-autumn':       'Mid-Autumn Festival (中秋節)',
};

export const CHINESE_ICONS = {
    'chinese-new-year': '🧧', // Red envelope — generic fallback; actual marker uses zodiac animal
    'lantern':          '🏮',
    'qingming':         '🌿',
    'dragon-boat':      '🐲',
    'mid-autumn':       '🥮',
};

export const JAMAICAN_LABELS = {
    'ash-wednesday':  'Ash Wednesday',
    'labour-day':     'National Labour Day (Jamaica)',
    'emancipation':   'Emancipation Day',
    'independence':   'Independence Day (Jamaica)',
    'heroes-day':     'National Heroes Day',
};

export const JAMAICAN_ICONS = {
    'ash-wednesday':  '✝️',
    'labour-day':     '🔨',
    'emancipation':   '✊',
    'independence':   '🇯🇲',
    'heroes-day':     '🏅',
};

export const CONGOLESE_LABELS = {
    'drc-martyrs':     "Martyrs' Day",
    'drc-liberation':  'Liberation Day (DRC)',
    'drc-heroes':      "Heroes' Day (DRC)",
    'drc-independence':'Independence Day (DRC)',
};

export const CONGOLESE_ICONS = {
    'drc-martyrs':     '🕊️',
    'drc-liberation':  '✊',
    'drc-heroes':      '🏅',
    'drc-independence':'🇨🇩',
};

export const PORTUGUESE_LABELS = {
    'pt-carnival':     'Carnival Tuesday',
    'pt-freedom':      'Freedom Day (25 de Abril)',
    'pt-labour':       'Labour Day (Portugal)',
    'pt-portugal-day': 'Portugal Day',
    'pt-corpus':       'Corpus Christi',
    'pt-assumption':   'Assumption of Mary',
    'pt-republic':     'Republic Day (Portugal)',
    'pt-restoration':  'Restoration of Independence',
    'pt-immaculate':   'Immaculate Conception',
};

export const PORTUGUESE_ICONS = {
    'pt-carnival':     '🎭',
    'pt-freedom':      '🌹',
    'pt-labour':       '🛠️',
    'pt-portugal-day': '🇵🇹',
    'pt-corpus':       '⛪',
    'pt-assumption':   '🕊️',
    'pt-republic':     '🏛️',
    'pt-restoration':  '⚔️',
    'pt-immaculate':   '✨',
};

// ============================================
// FAITH BADGE LOOKUP — single source of truth for cultural calendar markers
// ============================================

/**
 * Returns the cultural calendar marker for a date, or null if none matches.
 * This is the canonical lookup — both app.js and getSpecialDayBadges use it
 * so adding a new calendar only requires updating this one function.
 *
 * @param {string} dateStr       YYYY-MM-DD
 * @param {string} faithCalendar 'none'|'islamic'|'hindu'|'chinese'|'jamaican'|'congolese'|'portuguese'
 * @returns {{ icon: string, label: string }|null}
 */
export function getFaithBadge(dateStr, faithCalendar) {
    if (faithCalendar === 'islamic') {
        if (RAMADAN_STARTS.has(dateStr))         return { icon: ISLAMIC_ICONS['ramadan'],    label: ISLAMIC_LABELS['ramadan']    };
        if (EID_FITR_DATES.has(dateStr))         return { icon: ISLAMIC_ICONS['eid-fitr'],   label: ISLAMIC_LABELS['eid-fitr']   };
        if (EID_ADHA_DATES.has(dateStr))         return { icon: ISLAMIC_ICONS['eid-adha'],   label: ISLAMIC_LABELS['eid-adha']   };
        if (ISLAMIC_NEW_YEAR_DATES.has(dateStr)) return { icon: ISLAMIC_ICONS['islamic-ny'], label: ISLAMIC_LABELS['islamic-ny'] };
        if (MAWLID_DATES.has(dateStr))           return { icon: ISLAMIC_ICONS['mawlid'],     label: ISLAMIC_LABELS['mawlid']     };
    }
    if (faithCalendar === 'hindu') {
        if (HOLI_DATES.has(dateStr))           return { icon: HINDU_ICONS['holi'],    label: HINDU_LABELS['holi']    };
        if (NAVRATRI_DATES.has(dateStr))       return { icon: HINDU_ICONS['navratri'], label: HINDU_LABELS['navratri'] };
        if (DUSSEHRA_DATES.has(dateStr))       return { icon: HINDU_ICONS['dussehra'], label: HINDU_LABELS['dussehra'] };
        if (DIWALI_DATES.has(dateStr))         return { icon: HINDU_ICONS['diwali'],   label: HINDU_LABELS['diwali']   };
        if (RAKSHA_BANDHAN_DATES.has(dateStr)) return { icon: HINDU_ICONS['raksha'],   label: HINDU_LABELS['raksha']   };
    }
    if (faithCalendar === 'chinese') {
        const cny = CHINESE_NEW_YEAR_DATES.get(dateStr);
        if (cny)                                 return { icon: cny.icon,                    label: cny.label                    };
        if (LANTERN_FESTIVAL_DATES.has(dateStr)) return { icon: CHINESE_ICONS['lantern'],     label: CHINESE_LABELS['lantern']     };
        if (QINGMING_DATES.has(dateStr))         return { icon: CHINESE_ICONS['qingming'],    label: CHINESE_LABELS['qingming']    };
        if (DRAGON_BOAT_DATES.has(dateStr))      return { icon: CHINESE_ICONS['dragon-boat'], label: CHINESE_LABELS['dragon-boat'] };
        if (MID_AUTUMN_DATES.has(dateStr))       return { icon: CHINESE_ICONS['mid-autumn'],  label: CHINESE_LABELS['mid-autumn']  };
    }
    if (faithCalendar === 'jamaican') {
        if (JAMAICAN_ASH_WEDNESDAY_DATES.has(dateStr)) return { icon: JAMAICAN_ICONS['ash-wednesday'], label: JAMAICAN_LABELS['ash-wednesday'] };
        if (JAMAICAN_LABOUR_DAY_DATES.has(dateStr))    return { icon: JAMAICAN_ICONS['labour-day'],    label: JAMAICAN_LABELS['labour-day']    };
        if (JAMAICAN_EMANCIPATION_DATES.has(dateStr))  return { icon: JAMAICAN_ICONS['emancipation'],  label: JAMAICAN_LABELS['emancipation']  };
        if (JAMAICAN_INDEPENDENCE_DATES.has(dateStr))  return { icon: JAMAICAN_ICONS['independence'],  label: JAMAICAN_LABELS['independence']  };
        if (JAMAICAN_HEROES_DAY_DATES.has(dateStr))    return { icon: JAMAICAN_ICONS['heroes-day'],    label: JAMAICAN_LABELS['heroes-day']    };
    }
    if (faithCalendar === 'congolese') {
        if (CONGOLESE_MARTYRS_DATES.has(dateStr))      return { icon: CONGOLESE_ICONS['drc-martyrs'],      label: CONGOLESE_LABELS['drc-martyrs']      };
        if (CONGOLESE_LIBERATION_DATES.has(dateStr))   return { icon: CONGOLESE_ICONS['drc-liberation'],   label: CONGOLESE_LABELS['drc-liberation']   };
        if (CONGOLESE_HEROES_DATES.has(dateStr))       return { icon: CONGOLESE_ICONS['drc-heroes'],       label: CONGOLESE_LABELS['drc-heroes']       };
        if (CONGOLESE_INDEPENDENCE_DATES.has(dateStr)) return { icon: CONGOLESE_ICONS['drc-independence'], label: CONGOLESE_LABELS['drc-independence']  };
    }
    if (faithCalendar === 'portuguese') {
        if (PORTUGUESE_CARNIVAL_DATES.has(dateStr))       return { icon: PORTUGUESE_ICONS['pt-carnival'],     label: PORTUGUESE_LABELS['pt-carnival']     };
        if (PORTUGUESE_FREEDOM_DATES.has(dateStr))        return { icon: PORTUGUESE_ICONS['pt-freedom'],      label: PORTUGUESE_LABELS['pt-freedom']      };
        if (PORTUGUESE_LABOUR_DATES.has(dateStr))         return { icon: PORTUGUESE_ICONS['pt-labour'],       label: PORTUGUESE_LABELS['pt-labour']       };
        if (PORTUGUESE_PORTUGAL_DAY_DATES.has(dateStr))   return { icon: PORTUGUESE_ICONS['pt-portugal-day'], label: PORTUGUESE_LABELS['pt-portugal-day']  };
        if (PORTUGUESE_CORPUS_CHRISTI_DATES.has(dateStr)) return { icon: PORTUGUESE_ICONS['pt-corpus'],       label: PORTUGUESE_LABELS['pt-corpus']       };
        if (PORTUGUESE_ASSUMPTION_DATES.has(dateStr))     return { icon: PORTUGUESE_ICONS['pt-assumption'],   label: PORTUGUESE_LABELS['pt-assumption']   };
        if (PORTUGUESE_REPUBLIC_DATES.has(dateStr))       return { icon: PORTUGUESE_ICONS['pt-republic'],     label: PORTUGUESE_LABELS['pt-republic']     };
        if (PORTUGUESE_RESTORATION_DATES.has(dateStr))    return { icon: PORTUGUESE_ICONS['pt-restoration'],  label: PORTUGUESE_LABELS['pt-restoration']  };
        if (PORTUGUESE_IMMACULATE_DATES.has(dateStr))     return { icon: PORTUGUESE_ICONS['pt-immaculate'],   label: PORTUGUESE_LABELS['pt-immaculate']   };
    }
    return null;
}

// ============================================
// SPECIAL DAY BADGES — used by admin.html day rows
// ============================================
// Returns an array of { icon, title } objects for the given date.
// Faith calendar lookup is delegated to getFaithBadge() — update that
// function (not this one) when adding new cultural calendars.

export function getSpecialDayBadges(date, dateStr, faithCalendar) {
    const badges = [];
    if (isBankHoliday(date))   badges.push({ icon: '⭐', title: 'Bank Holiday' });
    if (isCutoffDate(date))    badges.push({ icon: '✂️', title: 'Cut-off Date' });
    if (isPayday(date))        badges.push({ icon: '💷', title: 'Payday' });
    if (isChristmasDay(date))  badges.push({ icon: '🎄', title: 'Christmas Day' });
    if (isEasterSunday(date))  badges.push({ icon: '🐣', title: 'Easter Sunday' });
    const faithBadge = getFaithBadge(dateStr, faithCalendar);
    if (faithBadge) badges.push({ icon: faithBadge.icon, title: faithBadge.label });
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
                const shift = days[day];
                if (shift === undefined) {
                    console.error(`validateRosterPatterns: ${rosterName} week ${week} is missing day '${day}'`);
                    errors++;
                } else if (!VALID_KEYWORDS.has(shift) && !SHIFT_RE.test(shift)) {
                    console.error(`validateRosterPatterns: ${rosterName} week ${week} ${day} has invalid value '${shift}' — expected RD/OFF/SPARE/AL/RDW or HH:MM-HH:MM`);
                    errors++;
                }
            }
        }
    }

    if (errors === 0) {
        console.log('validateRosterPatterns: all patterns valid ✓');
    }
    return errors;
}

/**
 * Warn if any active cultural/faith calendar has no entries for the current year.
 * Missing entries silently remove all markers for that calendar — this warning surfaces the gap.
 * Only checks the primary Islamic calendar as a representative sample; extend as needed.
 */
export function warnIfCulturalCalendarMissingYear() {
    const year    = new Date().getFullYear();
    const yearStr = String(year);

    // Only the genuinely lunar/lunisolar datasets need manual updates each year.
    // Fixed-date, Easter-relative, and day-of-week-rule datasets are auto-computed
    // and will always have data — they are intentionally excluded from this check.
    const lunarCalendarDatasets = [
        // Islamic — shift ~11 days earlier each year; verify against islamicfinder.org
        { name: 'Islamic (Ramadan)',       dates: RAMADAN_STARTS },
        { name: 'Islamic (Eid al-Fitr)',   dates: EID_FITR_DATES },
        { name: 'Islamic (Eid al-Adha)',   dates: EID_ADHA_DATES },
        { name: 'Islamic (New Year)',      dates: ISLAMIC_NEW_YEAR_DATES },
        { name: 'Islamic (Mawlid)',        dates: MAWLID_DATES },
        // Hindu — verify against drikpanchang.com (London timezone)
        { name: 'Hindu (Holi)',            dates: HOLI_DATES },
        { name: 'Hindu (Navratri)',        dates: NAVRATRI_DATES },
        { name: 'Hindu (Dussehra)',        dates: DUSSEHRA_DATES },
        { name: 'Hindu (Diwali)',          dates: DIWALI_DATES },
        { name: 'Hindu (Raksha Bandhan)',  dates: RAKSHA_BANDHAN_DATES },
        // Chinese lunisolar — verify against chinesenewyear.net / timeanddate.com
        { name: 'Chinese (New Year)',      dates: CHINESE_NEW_YEAR_DATES },
        { name: 'Chinese (Lantern)',       dates: LANTERN_FESTIVAL_DATES },
        { name: 'Chinese (Qingming)',      dates: QINGMING_DATES },
        { name: 'Chinese (Dragon Boat)',   dates: DRAGON_BOAT_DATES },
        { name: 'Chinese (Mid-Autumn)',    dates: MID_AUTUMN_DATES },
    ];

    lunarCalendarDatasets.forEach(({ name, dates }) => {
        // Sets store 'YYYY-MM-DD' strings; Maps (CHINESE_NEW_YEAR_DATES) store date string keys
        const hasYear = dates instanceof Map
            ? [...dates.keys()].some(k => k.startsWith(yearStr))
            : [...dates].some(d => d.startsWith(yearStr));
        if (!hasYear) {
            console.warn(`warnIfCulturalCalendarMissingYear: no entries for ${year} in ${name}. Cultural markers will be missing for this year.`);
        }
    });
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
    if (!SHIFT_TIME_REGEX.test(timeStr)) {
        console.warn(`Unknown shift value: "${timeStr}" — rendered as other-day`);
        return 'other-day';
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
    if (!timeStr || timeStr === 'RD' || timeStr === 'OFF') return `<span class="shift-badge badge-rest"><span>🏠</span><span>Rest</span></span>`;
    if (timeStr === 'SPARE') return `<span class="shift-badge badge-spare"><span>📋</span><span>Spare</span></span>`;
    if (timeStr === 'RDW')   return `<span class="shift-badge badge-rdw"><span>💼</span><span>RDW</span></span>`;
    if (timeStr === 'AL')    return `<span class="shift-badge badge-al"><span>🏖️</span><span>AL</span></span>`;
    if (timeStr === 'SICK')  return `<span class="shift-badge badge-sick"><span>🪑</span><span>Absent</span></span>`;
    if (!SHIFT_TIME_REGEX.test(timeStr)) return `<span class="shift-badge badge-other"><span>❓</span><span>Unknown</span></span>`;
    if (isNightShift(timeStr)) return `<span class="shift-badge badge-night"><span>🦉</span><span>Night</span></span>`;
    return isEarlyShift(timeStr)
        ? `<span class="shift-badge badge-early"><span>☀️</span><span>Early</span></span>`
        : `<span class="shift-badge badge-late"><span>🌙</span><span>Late</span></span>`;
}

// ============================================
// ROSTER LOOKUP — shared by both HTML files
// ============================================

/**
 * Returns the roster week number (1-based, within the cycle) for a given date and member.
 * Each week runs Sunday–Saturday. Normalises to noon to avoid DST edge cases.
 * @param {Date} date
 * @param {Object} member  teamMembers entry
 * @returns {number}  Week number within the roster cycle
 */
export function getWeekNumberForDate(date, member) {
    if (!member) return 1; // safety fallback — should always be provided
    const rosterType = member.rosterType || 'main';
    if (rosterType === 'fixed') return 1; // single week, always repeats

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

    const weeksDiff = Math.floor(Math.round((sunday - referenceSunday) / (1000 * 60 * 60 * 24)) / 7);
    const w = member.currentWeek + weeksDiff;
    return ((w - 1) % cycleLength + cycleLength) % cycleLength + 1;
}

/**
 * Returns the full roster descriptor for a member.
 * Returns an object with: type, data (the roster map), cycleLength, weekPrefix.
 * admin.html's simple getRosterData can be replaced by `.data` on this result.
 * @param {Object} member  teamMembers entry
 * @returns {{ type: string, data: Object, cycleLength: number, weekPrefix: string }}
 */
export function getRosterForMember(member) {
    if (!member) {
        console.error('getRosterForMember called with null/undefined member');
        return { type: 'main', data: weeklyRoster, cycleLength: CONFIG.MAIN_ROSTER_WEEKS, weekPrefix: 'CEA Week' };
    }
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
 * @param {Object} member  teamMembers entry
 * @param {Date}   date
 * @returns {string}  Shift value e.g. "RD", "06:00-14:00"
 */
export function getBaseShift(member, date) {
    if (isChristmasRD(date)) return 'RD';
    // Members with a startDate show RD for all dates before they join
    if (member.startDate) {
        const s = member.startDate;
        const startMidnight = new Date(s.getFullYear(), s.getMonth(), s.getDate());
        const dateMidnight  = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        if (dateMidnight < startMidnight) return 'RD';
    }
    const weekNum = getWeekNumberForDate(date, member);
    const dayKey  = DAY_KEYS[date.getDay()];
    const data    = getRosterForMember(member).data;
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
        .replace(/"/g, '&quot;');
}

/**
 * Formats a Date object as a YYYY-MM-DD string using local time components.
 * Safer than toISOString().slice(0,10) which can return the previous day in
 * timezones behind UTC when the local time is near midnight.
 * @param {Date} d
 * @returns {string}  e.g. "2026-03-18"
 */
export function formatISO(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Returns true if the ISO date string falls on a Sunday.
 * Sundays are uncontracted for all staff — they never count as AL or sick days.
 * @param {string} dateStr  YYYY-MM-DD
 * @returns {boolean}
 */
export function isSunday(dateStr) {
    return new Date(dateStr + 'T12:00:00').getDay() === 0;
}

// Run validations immediately at module load
validateRosterPatterns();
warnIfCulturalCalendarMissingYear();
