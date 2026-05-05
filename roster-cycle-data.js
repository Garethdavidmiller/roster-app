// MYB Roster — Shift Cycle Data
// Pure data: the week-by-week shift patterns for each roster type.
// No logic, no imports. Referenced by getRosterForMember() in roster-data.js.
// Update this file when Chiltern issues a new base roster PDF.

// 20-week rotating roster pattern (CEA — main).
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

// 8-week bilingual roster pattern (CEA — bilingual).
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
