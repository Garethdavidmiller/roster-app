// @ts-check
// MYB Roster — Team Member Data
// Pure data: the roster's PEOPLE — one entry per member, and nothing else. No logic, no imports.
// Re-exported by roster-data.js, which is where every consumer still reads `teamMembers` from.
//
// Its own file for the same reason roster-cycle-data.js is: this is the one table in the app whose
// length tracks HEADCOUNT rather than behaviour. A new starter is an entry here, a leaver is a flag
// here, and neither is a change to how anything works — so a size guard on roster-data.js was
// measuring the size of the station, and crossed on hiring rather than on complexity.
//
// ⚠️ WORLD-READABLE. This file is served from both origins with no session, no PIN and no token —
// see the classification argument on `teamMembers` in CLAUDE.md and AUTH_PLAN.md §2. A field added
// here is PUBLISHED the moment it ships; anything a stranger should not read belongs in Firestore
// behind a claim. `public-data-classification.test.mjs` fails on an unclassified field.

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
    { name: 'J. Davies',               currentWeek: 5,  rosterType: 'main',       role: 'CEA', startDate: new Date(2026, 4, 5), proRatedAL: { 2026: 20 } },
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
    // M. Okeke — 24, NOT the 23 a day-count gives: prior AGENCY service counts, so his startDate is
    // when he joined the payroll and not when entitlement began (owner, 6 Sep 2026). Agreed, not
    // derived — do not "correct" it back to the formula. Pinned in roster-data.test.mjs.
    { name: 'M. Okeke',                currentWeek: 13, rosterType: 'main',       role: 'CEA', startDate: new Date(2026, 3, 20), proRatedAL: { 2026: 24 } },
    { name: 'N. Tuck',                 currentWeek: 14, rosterType: 'main',       role: 'CEA' },
    { name: 'R. Forrester-Blackstock', currentWeek: 15, rosterType: 'main',       role: 'CEA' },
    { name: 'S. Langley',              currentWeek: 16, rosterType: 'main',       role: 'CEA' },
    { name: 'S. Silva',                currentWeek: 17, rosterType: 'main',       role: 'CEA' },
    { name: 'J. Sumaili',              currentWeek: 18, rosterType: 'main',       role: 'CEA' },
    { name: 'T. Bibi',                 currentWeek: 19, rosterType: 'main',       role: 'CEA' },
    { name: 'T. Nsuala',               currentWeek: 20, rosterType: 'main',       role: 'CEA' },
    { name: 'D. Irvine',               currentWeek: 3,  rosterType: 'bilingual',  role: 'CEA', bilingualContract: true },
    { name: 'T. Gherbi',               currentWeek: 6,  rosterType: 'bilingual',  role: 'CEA', bilingualContract: true },
    { name: 'C. Reen',                 currentWeek: 1,  rosterType: 'fixed',      role: 'CEA' },
    // New starter (3 Jun 2026). Phase 1 (3–27 Jun): own fixed line — pattern 2 (09:00–16:00
    // Mon–Fri), the same line S. Boyle later moves to. Phase 2 (from Sun 28 Jun): joins the main
    // link on wk10 (the slot S. Boyle vacates, after O. Mylla) via rosterChanges. AL pro-rated
    // for 2026 (CEA 32 → ⌈212/365×32⌉ = 19 for a 3 Jun start); standard 32 from 2027.
    { name: 'K. Jedlinski',            currentWeek: 2,  rosterType: 'fixed',      role: 'CEA',
      startDate: new Date(2026, 5, 3), proRatedAL: { 2026: 18 },
      rosterChanges: [{ from: new Date(2026, 5, 28), rosterType: 'main', currentWeek: 10 }] },

    // I. Melikian — started Mon 10 Aug 2026, in two phases. Phase 1 (to 12 Sep): initial training,
    // which is `fixedRoster[2]` (Mon–Fri 09:00–16:00) as the BASE roster rather than overrides — the
    // B. Toth pattern, and the 7-hour day is what makes the 35 hours the pay calculator reads.
    // Phase 2 (from Sun 13 Sep): the BILINGUAL link on line 3, one above T. Gherbi.
    // Two things here are easy to "correct" and must not be:
    //   · `currentWeek: 5` is REFERENCE-ANCHORED, not a line number — BL week 5 at the 15 Feb 2026
    //     bilingual reference Sunday is what resolves to line 3 on 13 Sep. Writing 3 shifts him two.
    //   · NO `bilingualContract` flag, deliberately: a CEA CONTRACT on a bilingual LINE is 32 days,
    //     not 34. That is the case the field's own comment describes.
    // `proRatedAL: 13` is TRANSCRIBED from the clerk's workbook (`New Marylebone Totals` → `AL
    // allowance`, read 8 Sep 2026). A day-count agrees here by luck; re-read the book, never recompute.
    { name: 'I. Melikian',             currentWeek: 2,  rosterType: 'fixed',      role: 'CEA',
      startDate: new Date(2026, 7, 10), proRatedAL: { 2026: 13 },
      rosterChanges: [{ from: new Date(2026, 8, 13), rosterType: 'bilingual', currentWeek: 5 }] },

    // Dispatchers — 10-week rotating cycle, reference week starting 01/02/26
    // currentWeek reflects each person's row in the base roster on that date
    { name: 'D. Minto',                currentWeek: 1,  rosterType: 'dispatcher', role: 'Dispatcher' },
    { name: 'A. Targanov',             currentWeek: 2,  rosterType: 'dispatcher', role: 'Dispatcher' },
    { name: 'S. Warman',               currentWeek: 3,  rosterType: 'dispatcher', role: 'Dispatcher' },
    // S. Faure — MATERNITY LEAVE from Mon 29 Jun 2026. She comes OFF the rotating link on that
    // date (B. Toth took line 4) and onto her own Mon–Fri row: `fixedRoster[2]`, 09:00–16:00, the
    // 35 contracted hours a week she is credited with, weekends RD. The base fields still describe
    // her BEFORE 29 Jun, so every shift she actually worked up to then still displays correctly.
    // The absence itself is override data (🪑 Absent, Mon–Fri) — this only decides what those
    // overrides sit on, and what her weekends read when they are absent.
    // NOTE she shares `fixedRoster[2]` with S. Boyle and K. Jedlinski: change those hours and you
    // change hers.
    { name: 'S. Faure',                currentWeek: 4,  rosterType: 'dispatcher', role: 'Dispatcher',
      rosterChanges: [{ from: new Date(2026, 5, 29), rosterType: 'fixed', currentWeek: 2 }] },
    { name: 'L. Szpejer',              currentWeek: 5,  rosterType: 'dispatcher', role: 'Dispatcher' },
    { name: 'K. Porter',               currentWeek: 6,  rosterType: 'dispatcher', role: 'Dispatcher' },
    { name: 'A. Murray',               currentWeek: 7,  rosterType: 'dispatcher', role: 'Dispatcher' },
    { name: 'S. Clarke',               currentWeek: 8,  rosterType: 'dispatcher', role: 'Dispatcher' },
    { name: 'A. Atkins',               currentWeek: 9,  rosterType: 'dispatcher', role: 'Dispatcher' },
    { name: 'K. Yeboah',               currentWeek: 10, rosterType: 'dispatcher', role: 'Dispatcher' },

    // B. Toth — started Mon 29 Jun 2026 on S. Faure's line (4), after THREE weeks of initial
    // training: Mon–Fri 09:00–16:00, nothing at weekends. That is exactly `fixedRoster[2]`, so the
    // training weeks are the BASE roster rather than fifteen overrides propping up a base that
    // would otherwise show turns he never worked — the calendar is right whether or not the
    // training days are ever recorded, and recording them only adds the 🏷️ Train badge on top.
    // He joins the link on Mon 20 Jul 2026. `currentWeek: 4` there is REFERENCE-ANCHORED (see
    // .claude/rules/roster-data.md) — the same value S. Faure carries, i.e. her line.
    // `proRatedAL` is 11 — TRANSCRIBED from the roster clerk's workbook, the authority for it (owner,
    // 6 Sep 2026); a day-count rounded up gives 12, which this file used to carry. It is FLAT and
    // suppresses the Dispatcher lieu calculation, so 2026's last three bank holidays earn none.
    { name: 'B. Toth',                 currentWeek: 2,  rosterType: 'fixed',      role: 'Dispatcher',
      startDate: new Date(2026, 5, 29), proRatedAL: { 2026: 11 },
      rosterChanges: [{ from: new Date(2026, 6, 20), rosterType: 'dispatcher', currentWeek: 4 }] },

    // CES — Customer Experience Supervisors (reference: w/c 15 Feb 2026)
    { name: 'F. Mohamed',              currentWeek: 1,  rosterType: 'ces',        role: 'CES' },
    { name: 'P. Lloyd',                currentWeek: 2,  rosterType: 'ces',        role: 'CES' },
    { name: 'P. Prashanthan',          currentWeek: 3,  rosterType: 'ces',        role: 'CES' },
    // On the CES rotation from his 9 Jun 2026 start (currentWeek:5 anchors him from the
    // 15 Feb CES reference so July lands on week 5).
    // noProRate: pay and AL are full-year (CES 34) despite the mid-year startDate.
    { name: 'B. Khalil',               currentWeek: 5,  rosterType: 'ces',        role: 'CES', startDate: new Date(2026, 5, 9), noProRate: true, hidden: true }, // left Sep 2026 — remaining days taken as AL; CES week-5 line is a vacancy. Row kept so his past shifts and overrides still resolve
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
    { name: 'N. Sobers',  currentWeek: 1, rosterType: 'main', role: 'Management', hidden: true, managerOnly: true },
];
