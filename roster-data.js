// MYB Roster — Shared Data
// Single source of truth for roster configuration, team members, and shift patterns.
// ES module — import named exports into consuming files:
//   import { CONFIG, APP_VERSION, teamMembers, weeklyRoster, ... } from './roster-data.js';
//
// APP_VERSION is the single authoritative version number. Both HTML files read it at runtime
// via CONFIG.APP_VERSION (set below). The only manual version step remaining is updating the
// import cache-busting query strings in index.html and admin.html when the version changes.

/** Single source of truth for the app version. Update this on every commit that touches app behaviour. */
export const APP_VERSION = '4.90';

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
    MAX_YEAR:                         2030,                                      // Latest navigable year
    EARLY_START_THRESHOLD:            4,                                         // Shifts starting 04:00–10:59 are Early
    EARLY_SHIFT_THRESHOLD:            11,                                        // Shifts starting 11:00–20:59 are Late
    NIGHT_START_THRESHOLD:            21,                                        // Shifts starting 21:00–03:59 are Night
    DEFAULT_MEMBER_NAME:              'G. Miller',                               // Default selection in index.html
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
//   Dispatcher     → 34 days
//   C. Reen        → 34 days (fixed roster / reasonable adjustments)
//   All CEAs       → 32 days  (main, bilingual, or any other CEA rosterType)
//
// @param {object} member — a teamMembers entry
// @returns {number}
export function getALEntitlement(member) {
    if (!member) return 32;
    if (member.role === 'CES' || member.role === 'Dispatcher') return 34;
    if (member.rosterType === 'fixed') return 34; // C. Reen — reasonable adjustments
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
    4:  { sun: 'SPARE',       mon: 'SPARE',       tue: 'SPARE',       wed: 'SPARE',       thu: 'SPARE',       fri: 'SPARE',       sat: 'SPARE'       },
    5:  { sun: '07:15-15:30', mon: 'SPARE',       tue: 'SPARE',       wed: 'SPARE',       thu: 'SPARE',       fri: 'SPARE',       sat: 'SPARE'       },
    6:  { sun: 'RD',          mon: 'RD',          tue: 'RD',          wed: '14:30-23:45', thu: '15:30-00:30', fri: '14:30-23:45', sat: '15:00-23:55' },
    7:  { sun: 'RD',          mon: '15:30-00:30', tue: '14:30-23:45', wed: '15:30-00:30', thu: '14:30-23:45', fri: 'RD',          sat: 'RD'          },
    8:  { sun: '15:30-23:45', mon: '14:30-23:45', tue: '15:30-00:30', wed: 'RD',          thu: 'RD',          fri: '15:30-01:30', sat: '15:00-00:30' },
    9:  { sun: 'SPARE',       mon: 'SPARE',       tue: 'SPARE',       wed: 'SPARE',       thu: 'SPARE',       fri: 'SPARE',       sat: 'SPARE'       },
    10: { sun: '15:30-00:30', mon: 'SPARE',       tue: 'SPARE',       wed: 'SPARE',       thu: 'SPARE',       fri: 'SPARE',       sat: 'SPARE'       },
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
// Dates for 2029–2030 marked TODO have been inferred from adjacent years;
// verify against drikpanchang.com before those years go live.

// Holi (Rangwali Holi — Festival of Colours). Second day of the two-day festival.
export const HOLI_DATES = new Set([
    '2025-03-14',
    '2026-03-04',
    '2027-03-22',
    '2028-03-11',
    '2029-03-30', // TODO: verify against drikpanchang.com
    '2030-03-20', // TODO: verify against drikpanchang.com
]);

// Sharad Navratri — first day of the nine-night festival of Durga.
export const NAVRATRI_DATES = new Set([
    '2025-09-22',
    '2026-10-11',
    '2027-09-30',
    '2028-09-19',
    '2029-10-07', // TODO: verify against drikpanchang.com
    '2030-09-27', // TODO: verify against drikpanchang.com
]);

// Dussehra (Vijayadashami) — tenth day of Navratri; victory of good over evil.
export const DUSSEHRA_DATES = new Set([
    '2025-10-02',
    '2026-10-20',
    '2027-10-09',
    '2028-09-27',
    '2029-10-16', // TODO: verify against drikpanchang.com
    '2030-10-06', // TODO: verify against drikpanchang.com
]);

// Diwali (Lakshmi Puja) — Festival of Lights. Main day of the five-day festival.
export const DIWALI_DATES = new Set([
    '2025-10-20',
    '2026-11-08',
    '2027-10-28',
    '2028-10-17',
    '2029-11-05', // TODO: verify against drikpanchang.com
    '2030-10-26', // TODO: verify against drikpanchang.com
]);

// Raksha Bandhan — brother-sister bond festival (full moon in Shravan).
export const RAKSHA_BANDHAN_DATES = new Set([
    '2025-08-09',
    '2026-08-28',
    '2027-08-17',
    '2028-08-05',
    '2029-08-23', // TODO: verify against drikpanchang.com
    '2030-08-13', // TODO: verify against drikpanchang.com
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
// JAMAICAN PUBLIC HOLIDAYS — 2025–2031
// ============================================

// Ash Wednesday — 46 days before Easter Sunday (moveable).
// 2025-03-05, 2026-02-18, 2027-02-10, 2028-03-01, 2029-02-14, 2030-03-06, 2031-02-26
export const JAMAICAN_ASH_WEDNESDAY_DATES = new Set([
    '2025-03-05',
    '2026-02-18',
    '2027-02-10',
    '2028-03-01',
    '2029-02-14',
    '2030-03-06',
    '2031-02-26',
]);

// National Labour Day — fixed on 23 May each year.
export const JAMAICAN_LABOUR_DAY_DATES = new Set([
    '2025-05-23',
    '2026-05-23',
    '2027-05-23',
    '2028-05-23',
    '2029-05-23',
    '2030-05-23',
    '2031-05-23',
]);

// Emancipation Day — fixed on 1 August each year.
// Marks the abolition of slavery in the British Empire (1 August 1838).
export const JAMAICAN_EMANCIPATION_DATES = new Set([
    '2025-08-01',
    '2026-08-01',
    '2027-08-01',
    '2028-08-01',
    '2029-08-01',
    '2030-08-01',
    '2031-08-01',
]);

// Independence Day — fixed on 6 August each year.
// Marks Jamaica's independence from the United Kingdom (6 August 1962).
export const JAMAICAN_INDEPENDENCE_DATES = new Set([
    '2025-08-06',
    '2026-08-06',
    '2027-08-06',
    '2028-08-06',
    '2029-08-06',
    '2030-08-06',
    '2031-08-06',
]);

// National Heroes Day — third Monday of October (moveable).
// Dates calculated: 2025-10-20, 2026-10-19, 2027-10-18, 2028-10-16,
//                   2029-10-15, 2030-10-21, 2031-10-20
export const JAMAICAN_HEROES_DAY_DATES = new Set([
    '2025-10-20',
    '2026-10-19',
    '2027-10-18',
    '2028-10-16',
    '2029-10-15',
    '2030-10-21',
    '2031-10-20',
]);

// ============================================
// CONGOLESE PUBLIC HOLIDAYS — 2025–2031
// All dates are fixed each year.
// ============================================

// Martyrs' Day — fixed on 4 January each year.
// Commemorates the deaths of protesters killed on 4 January 1959 in Léopoldville (now Kinshasa).
export const CONGOLESE_MARTYRS_DATES = new Set([
    '2025-01-04',
    '2026-01-04',
    '2027-01-04',
    '2028-01-04',
    '2029-01-04',
    '2030-01-04',
    '2031-01-04',
]);

// Liberation Day — fixed on 17 May each year.
// Marks the capture of Kinshasa by AFDL forces in 1997, ending Mobutu's rule.
export const CONGOLESE_LIBERATION_DATES = new Set([
    '2025-05-17',
    '2026-05-17',
    '2027-05-17',
    '2028-05-17',
    '2029-05-17',
    '2030-05-17',
    '2031-05-17',
]);

// Heroes' Day — fixed on 1 June each year.
// Honours national heroes of the Democratic Republic of Congo.
export const CONGOLESE_HEROES_DATES = new Set([
    '2025-06-01',
    '2026-06-01',
    '2027-06-01',
    '2028-06-01',
    '2029-06-01',
    '2030-06-01',
    '2031-06-01',
]);

// Independence Day — fixed on 30 June each year.
// Marks independence from Belgium on 30 June 1960.
export const CONGOLESE_INDEPENDENCE_DATES = new Set([
    '2025-06-30',
    '2026-06-30',
    '2027-06-30',
    '2028-06-30',
    '2029-06-30',
    '2030-06-30',
    '2031-06-30',
]);

// ============================================
// PORTUGUESE PUBLIC HOLIDAYS — 2025–2031
// All mandatory national holidays that are not already covered by UK bank
// holidays (New Year, Good Friday, Christmas) or the app-wide Easter Sunday
// marker. Easter Sunday is marked for all members via isEasterSunday(), so
// it is intentionally excluded here to avoid a duplicate icon on that cell.
// ============================================

// Carnival Tuesday (Terça-feira de Carnaval) — day before Ash Wednesday.
// Widely observed (schools and public services close) but technically a
// discretionary "tolerância de ponto" rather than a statutory day off.
// Dates verified against confirmed Ash Wednesday dates for each year.
// 2025-03-04, 2026-02-17, 2027-02-09, 2028-02-29, 2029-02-13, 2030-03-05, 2031-02-25
export const PORTUGUESE_CARNIVAL_DATES = new Set([
    '2025-03-04',
    '2026-02-17',
    '2027-02-09',
    '2028-02-29',
    '2029-02-13',
    '2030-03-05',
    '2031-02-25',
]);

// Freedom Day (Dia da Liberdade) — fixed on 25 April each year.
// Commemorates the Carnation Revolution of 25 April 1974, which ended
// 48 years of authoritarian dictatorship. The symbol is a red carnation.
export const PORTUGUESE_FREEDOM_DATES = new Set([
    '2025-04-25',
    '2026-04-25',
    '2027-04-25',
    '2028-04-25',
    '2029-04-25',
    '2030-04-25',
    '2031-04-25',
]);

// Labour Day (Dia do Trabalho) — fixed on 1 May each year.
// Unlike the UK's moveable Early May Bank Holiday, Portugal's is always
// 1 May. They coincide only when 1 May falls on a Monday (e.g. 2028).
export const PORTUGUESE_LABOUR_DATES = new Set([
    '2025-05-01',
    '2026-05-01',
    '2027-05-01',
    '2028-05-01',
    '2029-05-01',
    '2030-05-01',
    '2031-05-01',
]);

// Portugal Day (Dia de Portugal, de Camões e das Comunidades Portuguesas)
// — fixed on 10 June each year. Named for Luís de Camões, the national
// poet, whose death anniversary falls on this date.
export const PORTUGUESE_PORTUGAL_DAY_DATES = new Set([
    '2025-06-10',
    '2026-06-10',
    '2027-06-10',
    '2028-06-10',
    '2029-06-10',
    '2030-06-10',
    '2031-06-10',
]);

// Corpus Christi (Corpo de Deus) — Thursday, exactly 60 days after Easter
// Sunday. Was suspended 2013–2016 during austerity; fully restored April 2016.
// Dates independently verified against Easter dates for each year:
// 2025-06-19, 2026-06-04, 2027-05-27, 2028-06-15, 2029-05-31, 2030-06-20, 2031-06-12
export const PORTUGUESE_CORPUS_CHRISTI_DATES = new Set([
    '2025-06-19',
    '2026-06-04',
    '2027-05-27',
    '2028-06-15',
    '2029-05-31',
    '2030-06-20',
    '2031-06-12',
]);

// Assumption of Mary (Assunção de Nossa Senhora) — fixed on 15 August each year.
export const PORTUGUESE_ASSUMPTION_DATES = new Set([
    '2025-08-15',
    '2026-08-15',
    '2027-08-15',
    '2028-08-15',
    '2029-08-15',
    '2030-08-15',
    '2031-08-15',
]);

// Republic Day (Implantação da República) — fixed on 5 October each year.
// Marks the proclamation of the Portuguese Republic on 5 October 1910.
// Suspended 2013–2016; restored April 2016.
export const PORTUGUESE_REPUBLIC_DATES = new Set([
    '2025-10-05',
    '2026-10-05',
    '2027-10-05',
    '2028-10-05',
    '2029-10-05',
    '2030-10-05',
    '2031-10-05',
]);

// Restoration of Independence (Restauração da Independência) — fixed on
// 1 December each year. Marks the end of 60 years of Spanish rule in 1640.
// Suspended 2013–2016; restored April 2016.
export const PORTUGUESE_RESTORATION_DATES = new Set([
    '2025-12-01',
    '2026-12-01',
    '2027-12-01',
    '2028-12-01',
    '2029-12-01',
    '2030-12-01',
    '2031-12-01',
]);

// Immaculate Conception (Imaculada Conceição) — fixed on 8 December each year.
// A major feast in Catholic Portugal; schools and businesses close.
export const PORTUGUESE_IMMACULATE_DATES = new Set([
    '2025-12-08',
    '2026-12-08',
    '2027-12-08',
    '2028-12-08',
    '2029-12-08',
    '2030-12-08',
    '2031-12-08',
]);

// ============================================
// DATE UTILITIES — shared by index.html and admin.html
// ============================================

// Compare two dates by calendar day only (ignores time component)
export function isSameDay(date1, date2) {
    return date1.getDate()     === date2.getDate()  &&
           date1.getMonth()    === date2.getMonth() &&
           date1.getFullYear() === date2.getFullYear();
}

// Calculate all UK bank holidays for a given year (England & Wales).
// Uses the Computus algorithm for Easter. Returns an array of Date objects.
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

    // Easter calculation (Computus algorithm)
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
    const easter = new Date(year, month, day);

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

    return holidays;
}

// Cache and getter for bank holidays (calculated once per year)
const _bankHolidaysCache = {};
export function getBankHolidays(year) {
    if (!_bankHolidaysCache[year]) _bankHolidaysCache[year] = calculateBankHolidays(year);
    return _bankHolidaysCache[year];
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
const _paydayCache = {};
export function getPaydaysAndCutoffs(year) {
    if (year < CONFIG.MIN_YEAR) return { paydays: [], cutoffs: [] };
    if (!_paydayCache[year]) {
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
        _paydayCache[year] = { paydays, cutoffs };
    }
    return _paydayCache[year];
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
// SPECIAL DAY BADGES — used by admin.html day rows
// ============================================
// Returns an array of { icon, title } objects for the given date.
// faithCalendar: 'none' | 'islamic' | 'hindu' | 'chinese' — the member's opted-in calendar.
// dateStr: ISO date string (YYYY-MM-DD) used for faith set lookups.

export function getSpecialDayBadges(date, dateStr, faithCalendar) {
    const badges = [];
    if (isBankHoliday(date))   badges.push({ icon: '⭐', title: 'Bank Holiday' });
    if (isCutoffDate(date))    badges.push({ icon: '✂️', title: 'Cut-off Date' });
    if (isPayday(date))        badges.push({ icon: '💷', title: 'Payday' });
    if (isChristmasDay(date))  badges.push({ icon: '🎄', title: 'Christmas Day' });
    if (isEasterSunday(date))  badges.push({ icon: '🐣', title: 'Easter Sunday' });
    if (faithCalendar === 'islamic') {
        if (RAMADAN_STARTS.has(dateStr))            badges.push({ icon: '🌙', title: 'Ramadan begins' });
        if (EID_FITR_DATES.has(dateStr))            badges.push({ icon: '☪️', title: 'Eid al-Fitr' });
        if (EID_ADHA_DATES.has(dateStr))            badges.push({ icon: '🕌', title: 'Eid al-Adha' });
        if (ISLAMIC_NEW_YEAR_DATES.has(dateStr))    badges.push({ icon: '📅', title: 'Islamic New Year (Al-Hijra)' });
        if (MAWLID_DATES.has(dateStr))              badges.push({ icon: '🌹', title: 'Mawlid al-Nabi' });
    }
    if (faithCalendar === 'hindu') {
        if (HOLI_DATES.has(dateStr))           badges.push({ icon: '🎨', title: 'Holi' });
        if (NAVRATRI_DATES.has(dateStr))       badges.push({ icon: '🕉️', title: 'Navratri begins' });
        if (DUSSEHRA_DATES.has(dateStr))       badges.push({ icon: '🏹', title: 'Dussehra' });
        if (DIWALI_DATES.has(dateStr))         badges.push({ icon: '🪔', title: 'Diwali' });
        if (RAKSHA_BANDHAN_DATES.has(dateStr)) badges.push({ icon: '🪢', title: 'Raksha Bandhan' });
    }
    if (faithCalendar === 'chinese') {
        const cny = CHINESE_NEW_YEAR_DATES.get(dateStr);
        if (cny)                                badges.push({ icon: cny.icon, title: cny.label });
        if (LANTERN_FESTIVAL_DATES.has(dateStr)) badges.push({ icon: '🏮', title: 'Lantern Festival (元宵節)' });
        if (QINGMING_DATES.has(dateStr))         badges.push({ icon: '🌿', title: 'Qingming / Tomb Sweeping Day (清明節)' });
        if (DRAGON_BOAT_DATES.has(dateStr))      badges.push({ icon: '🐲', title: 'Dragon Boat Festival (端午節)' });
        if (MID_AUTUMN_DATES.has(dateStr))       badges.push({ icon: '🥮', title: 'Mid-Autumn Festival (中秋節)' });
    }
    if (faithCalendar === 'jamaican') {
        if (JAMAICAN_ASH_WEDNESDAY_DATES.has(dateStr)) badges.push({ icon: '✝️', title: 'Ash Wednesday' });
        if (JAMAICAN_LABOUR_DAY_DATES.has(dateStr))    badges.push({ icon: '🔨', title: 'National Labour Day (Jamaica)' });
        if (JAMAICAN_EMANCIPATION_DATES.has(dateStr))  badges.push({ icon: '✊', title: 'Emancipation Day' });
        if (JAMAICAN_INDEPENDENCE_DATES.has(dateStr))  badges.push({ icon: '🇯🇲', title: 'Independence Day (Jamaica)' });
        if (JAMAICAN_HEROES_DAY_DATES.has(dateStr))    badges.push({ icon: '🏅', title: 'National Heroes Day' });
    }
    if (faithCalendar === 'congolese') {
        if (CONGOLESE_MARTYRS_DATES.has(dateStr))      badges.push({ icon: '🕊️', title: "Martyrs' Day" });
        if (CONGOLESE_LIBERATION_DATES.has(dateStr))   badges.push({ icon: '✊', title: 'Liberation Day (DRC)' });
        if (CONGOLESE_HEROES_DATES.has(dateStr))       badges.push({ icon: '🏅', title: "Heroes' Day (DRC)" });
        if (CONGOLESE_INDEPENDENCE_DATES.has(dateStr)) badges.push({ icon: '🇨🇩', title: 'Independence Day (DRC)' });
    }
    if (faithCalendar === 'portuguese') {
        if (PORTUGUESE_CARNIVAL_DATES.has(dateStr))      badges.push({ icon: '🎭', title: 'Carnival Tuesday' });
        if (PORTUGUESE_FREEDOM_DATES.has(dateStr))       badges.push({ icon: '🌹', title: 'Freedom Day (25 de Abril)' });
        if (PORTUGUESE_LABOUR_DATES.has(dateStr))        badges.push({ icon: '🛠️', title: 'Labour Day (Portugal)' });
        if (PORTUGUESE_PORTUGAL_DAY_DATES.has(dateStr))  badges.push({ icon: '🇵🇹', title: 'Portugal Day' });
        if (PORTUGUESE_CORPUS_CHRISTI_DATES.has(dateStr))badges.push({ icon: '⛪', title: 'Corpus Christi' });
        if (PORTUGUESE_ASSUMPTION_DATES.has(dateStr))    badges.push({ icon: '🕊️', title: 'Assumption of Mary' });
        if (PORTUGUESE_REPUBLIC_DATES.has(dateStr))      badges.push({ icon: '🏛️', title: 'Republic Day (Portugal)' });
        if (PORTUGUESE_RESTORATION_DATES.has(dateStr))   badges.push({ icon: '⚔️', title: 'Restoration of Independence' });
        if (PORTUGUESE_IMMACULATE_DATES.has(dateStr))    badges.push({ icon: '✨', title: 'Immaculate Conception' });
    }
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
    const year = new Date().getFullYear();
    const yearStr = String(year);

    const checks = [
        { name: 'Islamic (Eid al-Fitr)',      dates: EID_FITR_DATES },
        { name: 'Islamic (Eid al-Adha)',       dates: EID_ADHA_DATES },
        { name: 'Hindu (Diwali)',              dates: DIWALI_DATES },
        { name: 'Chinese (New Year)',          dates: CHINESE_NEW_YEAR_DATES },
        { name: 'Jamaican (Independence Day)', dates: JAMAICAN_INDEPENDENCE_DATES },
        { name: 'Congolese (Independence)',    dates: CONGOLESE_INDEPENDENCE_DATES },
        { name: 'Portuguese (Portugal Day)',   dates: PORTUGUESE_PORTUGAL_DAY_DATES },
    ];

    checks.forEach(({ name, dates }) => {
        // Sets store 'YYYY-MM-DD' strings; Maps store year number keys
        const hasYear = dates instanceof Map
            ? dates.has(year)
            : [...dates].some(d => d.startsWith(yearStr));
        if (!hasYear) {
            console.warn(`warnIfCulturalCalendarMissingYear: no entries for ${year} in ${name}. Cultural markers will be missing for this year.`);
        }
    });
}

// Run validations immediately at module load
validateRosterPatterns();
warnIfCulturalCalendarMissingYear();
