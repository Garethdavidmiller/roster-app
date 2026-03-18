import { CONFIG, teamMembers, weeklyRoster, bilingualRoster, fixedRoster, cesRoster, dispatcherRoster, DAY_KEYS, DAY_NAMES, MONTH_ABB, getALEntitlement, RAMADAN_STARTS, EID_FITR_DATES, EID_ADHA_DATES, ISLAMIC_NEW_YEAR_DATES, MAWLID_DATES, HOLI_DATES, NAVRATRI_DATES, DUSSEHRA_DATES, DIWALI_DATES, RAKSHA_BANDHAN_DATES, CHINESE_NEW_YEAR_DATES, LANTERN_FESTIVAL_DATES, QINGMING_DATES, DRAGON_BOAT_DATES, MID_AUTUMN_DATES, JAMAICAN_ASH_WEDNESDAY_DATES, JAMAICAN_LABOUR_DAY_DATES, JAMAICAN_EMANCIPATION_DATES, JAMAICAN_INDEPENDENCE_DATES, JAMAICAN_HEROES_DAY_DATES, isSameDay, getBankHolidays, isBankHoliday, isChristmasDay, isEasterSunday, getPaydaysAndCutoffs, isPayday, isCutoffDate, ISLAMIC_LABELS, ISLAMIC_ICONS, HINDU_LABELS, HINDU_ICONS, CHINESE_LABELS, CHINESE_ICONS, JAMAICAN_LABELS, JAMAICAN_ICONS, CONGOLESE_MARTYRS_DATES, CONGOLESE_LIBERATION_DATES, CONGOLESE_HEROES_DATES, CONGOLESE_INDEPENDENCE_DATES, CONGOLESE_LABELS, CONGOLESE_ICONS, PORTUGUESE_CARNIVAL_DATES, PORTUGUESE_FREEDOM_DATES, PORTUGUESE_LABOUR_DATES, PORTUGUESE_PORTUGAL_DAY_DATES, PORTUGUESE_CORPUS_CHRISTI_DATES, PORTUGUESE_ASSUMPTION_DATES, PORTUGUESE_REPUBLIC_DATES, PORTUGUESE_RESTORATION_DATES, PORTUGUESE_IMMACULATE_DATES, PORTUGUESE_LABELS, PORTUGUESE_ICONS, SHIFT_TIME_REGEX, isChristmasRD, isEarlyShift, isNightShift, getShiftClass, getShiftBadge, getWeekNumberForDate, getRosterForMember, escapeHtml, formatISO, isSunday } from './roster-data.js?v=5.53';
import { db, collection, query, where, getDocs, getLatestHuddle } from './firebase-client.js?v=5.53';

// ============================================
// CEA ROSTER CALENDAR
// ============================================
// Performance Optimizations:
// - Member fetched once per render (not 31+ times)
// - Bank holidays cached per year
// - Pure functions for predictable behavior
// - CSS variables for instant theme changes
// ============================================

// CONFIG.APP_VERSION is now set in roster-data.js from the exported APP_VERSION constant.
// No manual version override needed here.

// ============================================
// FIREBASE — db imported from firebase-client.js
// Caches declared here so renderCalendar() always finds a Map — even on
// the first synchronous render before Firestore responds.
// ============================================

// Caches keyed "memberName|YYYY-MM-DD" and memberName respectively.
const rosterOverridesCache  = new Map();
const memberSettingsCache   = new Map();
const fetchedMonths         = new Set();
// Cache for getShiftTypesInMonth(). Key: "memberName|year|month".
// Cleared whenever fetchOverridesForRange() writes new data into rosterOverridesCache.
const shiftTypesMonthCache  = new Map();

// ============================================
// BANK HOLIDAYS / PAYDAY / DATE UTILITIES
// ============================================
// isSameDay, getBankHolidays, isBankHoliday, isChristmasDay, isEasterSunday,
// getPaydaysAndCutoffs, isPayday, isCutoffDate — all imported from roster-data.js.

const fullDayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                   'July', 'August', 'September', 'October', 'November', 'December'];

// ============================================
// DATA VALIDATION
// ============================================

// Validate roster data structure on load
const VALID_SHIFT_KEYWORDS = new Set(['RD', 'SPARE', 'RDW', 'AL', 'OFF']);

function validateRoster(roster, rosterName, expectedWeeks) {
    const errors = [];
    
    // Check all weeks exist
    for (let week = 1; week <= expectedWeeks; week++) {
        if (!roster[week]) {
            errors.push(`${rosterName}: Missing week ${week}`);
            continue;
        }
        
        // Check all days exist and have valid shift values
        DAY_KEYS.forEach(day => {
            if (roster[week][day] === undefined) {
                errors.push(`${rosterName}: Week ${week} missing day ${day}`);
            } else {
                const val = roster[week][day];
                if (!VALID_SHIFT_KEYWORDS.has(val) && !SHIFT_TIME_REGEX.test(val)) {
                    errors.push(`${rosterName}: Week ${week} ${day} has invalid shift value "${val}"`);
                }
            }
        });
    }
    
    return errors;
}

// Validate team members data
function validateTeamMembers() {
    const errors = [];
    
    if (!teamMembers || teamMembers.length === 0) {
        errors.push('No team members defined');
        return errors;
    }
    
    teamMembers.forEach((member, index) => {
        if (!member.name) {
            errors.push(`Team member at index ${index} has no name`);
        }
        if (!member.currentWeek || member.currentWeek < 1) {
            errors.push(`${member.name || `Index ${index}`}: Invalid currentWeek`);
        }
        if (!member.role) {
            errors.push(`${member.name || `Index ${index}`}: Missing role field (expected "CEA", "CES" etc.)`);
        }
        if (member.rosterType !== 'main' && member.rosterType !== 'bilingual' && member.rosterType !== 'fixed' && member.rosterType !== 'ces' && member.rosterType !== 'dispatcher') {
            errors.push(`${member.name || `Index ${index}`}: Unknown rosterType "${member.rosterType}" (expected "main", "bilingual", "fixed", "ces" or "dispatcher")`);
        }
        if (member.rosterType === 'bilingual' && member.currentWeek > CONFIG.BILINGUAL_ROSTER_WEEKS) {
            errors.push(`${member.name}: currentWeek ${member.currentWeek} exceeds bilingual roster weeks (${CONFIG.BILINGUAL_ROSTER_WEEKS})`);
        }
        if (member.rosterType === 'main' && member.currentWeek > CONFIG.MAIN_ROSTER_WEEKS) {
            errors.push(`${member.name}: currentWeek ${member.currentWeek} exceeds main roster weeks (${CONFIG.MAIN_ROSTER_WEEKS})`);
        }
        if (member.rosterType === 'ces' && member.currentWeek > CONFIG.CES_ROSTER_WEEKS) {
            errors.push(`${member.name}: currentWeek ${member.currentWeek} exceeds CES roster weeks (${CONFIG.CES_ROSTER_WEEKS})`);
        }
    });
    
    return errors;
}

// ============================================
// CALENDAR STATE
// ============================================

// Current date: Always evaluated fresh to handle app staying open past midnight
function getToday() { return new Date(); }

let currentDisplayMonth = getToday().getMonth();
let currentDisplayYear = getToday().getFullYear();

// Restore last-viewed month from localStorage (if valid and within app bounds)
(function restoreViewedMonth() {
    const m = parseInt(localStorage.getItem('myb_roster_month'), 10);
    const y = parseInt(localStorage.getItem('myb_roster_year'),  10);
    if (!isNaN(m) && !isNaN(y) && y >= CONFIG.MIN_YEAR && y <= CONFIG.MAX_YEAR && m >= 0 && m <= 11) {
        currentDisplayMonth = m;
        currentDisplayYear  = y;
    }
})();

// ============================================
// SWIPE GESTURE STATE
// ============================================
let swipeCooldown = false;

// ============================================
// MONTH NAVIGATION
// ============================================

// Central month navigation — all buttons, keyboard and swipe go through here.
// Ensures clamping logic lives in exactly one place.
function changeMonth(delta) {
    currentDisplayMonth += delta;
    if (currentDisplayMonth > 11) { currentDisplayMonth = 0; currentDisplayYear++; }
    if (currentDisplayMonth < 0)  { currentDisplayMonth = 11; currentDisplayYear--; }
    if (currentDisplayYear > CONFIG.MAX_YEAR) { currentDisplayYear = CONFIG.MAX_YEAR; currentDisplayMonth = 11; }
    if (currentDisplayYear < CONFIG.MIN_YEAR) { currentDisplayYear = CONFIG.MIN_YEAR; currentDisplayMonth = 0;  }
}

// Get selected team member index (default to G. Miller)
// Resolve DEFAULT_MEMBER_NAME to an index at runtime — safe against array reordering.
// Returns 0 as ultimate fallback if the name isn't found.
function getDefaultMemberIndex() {
    const idx = teamMembers.findIndex(m => m.name === CONFIG.DEFAULT_MEMBER_NAME && !m.hidden);
    return idx !== -1 ? idx : 0;
}

// Selection is stored by name (not index) so it survives array reordering.
function getSelectedMemberIndex() {
    const savedName = localStorage.getItem('myb_roster_selected_member');
    if (!savedName) return getDefaultMemberIndex();
    const idx = teamMembers.findIndex(m => m.name === savedName && !m.hidden);
    return idx !== -1 ? idx : getDefaultMemberIndex();
}

// Save selected team member by name
function saveSelectedMember(index) {
    if (index >= 0 && index < teamMembers.length) {
        localStorage.setItem('myb_roster_selected_member', teamMembers[index].name);
    }
}

// Populate team member dropdown
function populateTeamMemberDropdown() {
    const select = document.getElementById('teamMemberSelect');
    if (!select) return;
    
    // Clear any existing options
    select.innerHTML = '';
    
    // Get selected member index using dedicated helper
    const selectedIndex = getSelectedMemberIndex();
    
    // Build dropdown — flat list if only one role present, optgroup per role if multiple.
    // This means no visual change today (all CEA), but CES entries appear in their own
    // group automatically the moment the first CES member is added.
    const visibleMembers = teamMembers
        .map((member, index) => ({ member, index }))
        .filter(({ member }) => !member.hidden);

    const distinctRoles = [...new Set(visibleMembers.map(({ member }) => member.role || 'CEA'))];
    const useGroups = distinctRoles.length > 1;

    if (useGroups) {
        distinctRoles.forEach(role => {
            const group = document.createElement('optgroup');
            group.label = role;
            visibleMembers
                .filter(({ member }) => (member.role || 'CEA') === role)
                .forEach(({ member, index }) => {
                    const option = document.createElement('option');
                    option.value = index;
                    option.textContent = member.name;
                    if (index === selectedIndex) option.selected = true;
                    group.appendChild(option);
                });
            select.appendChild(group);
        });
    } else {
        // Single role — flat list, no group label shown
        visibleMembers.forEach(({ member, index }) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = member.name;
            if (index === selectedIndex) option.selected = true;
            select.appendChild(option);
        });
    }
}

// getWeekNumberForDate, isEarlyShift, isNightShift, getShiftClass, getShiftBadge — imported from roster-data.js

// Helper: Get current selected member
function getCurrentMember() {
    const selectedIndex = getSelectedMemberIndex();
    const member = teamMembers[selectedIndex];
    
    if (!member) {
        console.error(`Invalid team member index: ${selectedIndex}`);
        // Fallback to first team member
        return teamMembers[0] || { name: 'Unknown', currentWeek: 1, rosterType: 'main', role: 'CEA' };
    }
    
    return member;
}

// getRosterForMember — imported from roster-data.js

// Helper: Create calendar header HTML (pure function — takes explicit month/year, no global state)
function createCalendarHeader(firstWeekNum, lastWeekNum, weekPrefix, month, year) {
    // Fixed roster (empty weekPrefix) — no week number to display
    let weekDisplay = '';
    if (weekPrefix !== '') {
        if (firstWeekNum === lastWeekNum) {
            weekDisplay = `· ${weekPrefix} ${firstWeekNum}`;
        } else {
            // Build plural: append 's' to the last word of the prefix
            // "CEA Week" → "CEA Weeks", "BL Week" → "BL Weeks", "CES Week" → "CES Weeks", "Week" → "Weeks"
            const lastSpaceIdx = weekPrefix.lastIndexOf(' ');
            const pluralPrefix = lastSpaceIdx !== -1
                ? weekPrefix.slice(0, lastSpaceIdx + 1) + weekPrefix.slice(lastSpaceIdx + 1) + 's'
                : weekPrefix + 's';
            weekDisplay = `· ${pluralPrefix} ${firstWeekNum}-${lastWeekNum}`;
        }
    }
    return `
        <div class="month-year" role="button" tabindex="0" aria-label="Jump to month — currently ${monthNames[month]} ${year}">${monthNames[month]} ${year}</div>
        ${weekDisplay ? `<div class="week-info">${weekDisplay}</div>` : ''}
    `;
}

// escapeHtml — imported from roster-data.js

// Helper: Create day cell HTML (pure function)
// isWorkedDay — pre-calculated by caller (shift !== RD/SPARE/OFF) to avoid duplication.
// permanentShift ('early'|'late'|undefined) — overrides badge on worked days and suppresses time.
// note — optional Firestore override note; shown as small muted text below the shift time.
// rdwTime — actual shift time for RDW overrides (e.g. '08:00-16:30'), since shift='RDW' sentinel.
// ============================================
// FAITH CALENDAR HELPERS
// ============================================

// Combined label/icon maps covering Islamic and Hindu calendars.
// Chinese New Year uses CHINESE_NEW_YEAR_DATES (a Map) directly because
// the icon varies by year (zodiac animal) rather than being a fixed value.
const FAITH_LABELS = { ...ISLAMIC_LABELS, ...HINDU_LABELS, ...CHINESE_LABELS, ...JAMAICAN_LABELS, ...CONGOLESE_LABELS, ...PORTUGUESE_LABELS };
const FAITH_ICONS  = { ...ISLAMIC_ICONS,  ...HINDU_ICONS,  ...CHINESE_ICONS,  ...JAMAICAN_ICONS,  ...CONGOLESE_ICONS,  ...PORTUGUESE_ICONS  };

// Resolve which faith calendar the member has opted in to.
// Handles backward compat: old Firestore docs stored islamicMarkers:true.
function resolveFaithCalendar(settings) {
    if (!settings) return 'none';
    if (settings.faithCalendar) return settings.faithCalendar;
    return settings.islamicMarkers ? 'islamic' : 'none';
}

// Returns { icon, label } for the faith marker on this date, or null if none.
// Only returns a value if the member has opted in and the date matches.
// Chinese New Year uses the zodiac-animal icon from CHINESE_NEW_YEAR_DATES;
// all other calendars use the static FAITH_ICONS / FAITH_LABELS maps.
function getFaithMarker(dateStr, memberName) {
    const faithCalendar = resolveFaithCalendar(memberSettingsCache.get(memberName));
    if (faithCalendar === 'islamic') {
        if (RAMADAN_STARTS.has(dateStr))         return { icon: FAITH_ICONS['ramadan'],    label: FAITH_LABELS['ramadan']    };
        if (EID_FITR_DATES.has(dateStr))         return { icon: FAITH_ICONS['eid-fitr'],   label: FAITH_LABELS['eid-fitr']   };
        if (EID_ADHA_DATES.has(dateStr))         return { icon: FAITH_ICONS['eid-adha'],   label: FAITH_LABELS['eid-adha']   };
        if (ISLAMIC_NEW_YEAR_DATES.has(dateStr)) return { icon: FAITH_ICONS['islamic-ny'], label: FAITH_LABELS['islamic-ny'] };
        if (MAWLID_DATES.has(dateStr))           return { icon: FAITH_ICONS['mawlid'],     label: FAITH_LABELS['mawlid']     };
    }
    if (faithCalendar === 'hindu') {
        if (HOLI_DATES.has(dateStr))           return { icon: FAITH_ICONS['holi'],     label: FAITH_LABELS['holi']     };
        if (NAVRATRI_DATES.has(dateStr))       return { icon: FAITH_ICONS['navratri'],  label: FAITH_LABELS['navratri']  };
        if (DUSSEHRA_DATES.has(dateStr))       return { icon: FAITH_ICONS['dussehra'],  label: FAITH_LABELS['dussehra']  };
        if (DIWALI_DATES.has(dateStr))         return { icon: FAITH_ICONS['diwali'],    label: FAITH_LABELS['diwali']    };
        if (RAKSHA_BANDHAN_DATES.has(dateStr)) return { icon: FAITH_ICONS['raksha'],    label: FAITH_LABELS['raksha']    };
    }
    if (faithCalendar === 'chinese') {
        const cny = CHINESE_NEW_YEAR_DATES.get(dateStr);
        if (cny)                                 return { icon: cny.icon,                    label: cny.label                              };
        if (LANTERN_FESTIVAL_DATES.has(dateStr)) return { icon: FAITH_ICONS['lantern'],      label: FAITH_LABELS['lantern']      };
        if (QINGMING_DATES.has(dateStr))         return { icon: FAITH_ICONS['qingming'],     label: FAITH_LABELS['qingming']     };
        if (DRAGON_BOAT_DATES.has(dateStr))      return { icon: FAITH_ICONS['dragon-boat'],  label: FAITH_LABELS['dragon-boat']  };
        if (MID_AUTUMN_DATES.has(dateStr))       return { icon: FAITH_ICONS['mid-autumn'],   label: FAITH_LABELS['mid-autumn']   };
    }
    if (faithCalendar === 'jamaican') {
        if (JAMAICAN_ASH_WEDNESDAY_DATES.has(dateStr)) return { icon: FAITH_ICONS['ash-wednesday'], label: FAITH_LABELS['ash-wednesday'] };
        if (JAMAICAN_LABOUR_DAY_DATES.has(dateStr))    return { icon: FAITH_ICONS['labour-day'],    label: FAITH_LABELS['labour-day']    };
        if (JAMAICAN_EMANCIPATION_DATES.has(dateStr))  return { icon: FAITH_ICONS['emancipation'],  label: FAITH_LABELS['emancipation']  };
        if (JAMAICAN_INDEPENDENCE_DATES.has(dateStr))  return { icon: FAITH_ICONS['independence'],  label: FAITH_LABELS['independence']  };
        if (JAMAICAN_HEROES_DAY_DATES.has(dateStr))    return { icon: FAITH_ICONS['heroes-day'],    label: FAITH_LABELS['heroes-day']    };
    }
    if (faithCalendar === 'congolese') {
        if (CONGOLESE_MARTYRS_DATES.has(dateStr))      return { icon: FAITH_ICONS['drc-martyrs'],     label: FAITH_LABELS['drc-martyrs']     };
        if (CONGOLESE_LIBERATION_DATES.has(dateStr))   return { icon: FAITH_ICONS['drc-liberation'],  label: FAITH_LABELS['drc-liberation']  };
        if (CONGOLESE_HEROES_DATES.has(dateStr))       return { icon: FAITH_ICONS['drc-heroes'],      label: FAITH_LABELS['drc-heroes']      };
        if (CONGOLESE_INDEPENDENCE_DATES.has(dateStr)) return { icon: FAITH_ICONS['drc-independence'],label: FAITH_LABELS['drc-independence'] };
    }
    if (faithCalendar === 'portuguese') {
        if (PORTUGUESE_CARNIVAL_DATES.has(dateStr))       return { icon: FAITH_ICONS['pt-carnival'],    label: FAITH_LABELS['pt-carnival']    };
        if (PORTUGUESE_FREEDOM_DATES.has(dateStr))        return { icon: FAITH_ICONS['pt-freedom'],     label: FAITH_LABELS['pt-freedom']     };
        if (PORTUGUESE_LABOUR_DATES.has(dateStr))         return { icon: FAITH_ICONS['pt-labour'],      label: FAITH_LABELS['pt-labour']      };
        if (PORTUGUESE_PORTUGAL_DAY_DATES.has(dateStr))   return { icon: FAITH_ICONS['pt-portugal-day'],label: FAITH_LABELS['pt-portugal-day'] };
        if (PORTUGUESE_CORPUS_CHRISTI_DATES.has(dateStr)) return { icon: FAITH_ICONS['pt-corpus'],      label: FAITH_LABELS['pt-corpus']      };
        if (PORTUGUESE_ASSUMPTION_DATES.has(dateStr))     return { icon: FAITH_ICONS['pt-assumption'],  label: FAITH_LABELS['pt-assumption']  };
        if (PORTUGUESE_REPUBLIC_DATES.has(dateStr))       return { icon: FAITH_ICONS['pt-republic'],    label: FAITH_LABELS['pt-republic']    };
        if (PORTUGUESE_RESTORATION_DATES.has(dateStr))    return { icon: FAITH_ICONS['pt-restoration'], label: FAITH_LABELS['pt-restoration'] };
        if (PORTUGUESE_IMMACULATE_DATES.has(dateStr))     return { icon: FAITH_ICONS['pt-immaculate'],  label: FAITH_LABELS['pt-immaculate']  };
    }
    return null;
}

function createDayCell(date, shift, permanentShift, isWorkedDay, note = '', rdwTime = '', faithMarker = null) {
    let badge;
    if (isWorkedDay && permanentShift === 'late') {
        badge = '<span class="shift-badge badge-late">🌙<br>Late</span>';
    } else if (isWorkedDay && permanentShift === 'early') {
        badge = '<span class="shift-badge badge-early">☀️<br>Early</span>';
    } else {
        badge = getShiftBadge(shift);
    }
    const displayTime = shift === 'RDW' ? rdwTime : shift;
    // Insert a word-break opportunity after the hyphen so "06:20-14:20"
    // breaks as "06:20-" / "14:20" on narrow mobile cells, not mid-digit.
    const displayTimeHtml = displayTime ? displayTime.replace('-', '-<wbr>') : '';
    return `
        <div class="day-number">${date.getDate()}</div>
        ${badge}
        ${isWorkedDay && !permanentShift && displayTimeHtml ? `<div class="shift-time">${displayTimeHtml}</div>` : ''}
        ${faithMarker ? `<span class="day-faith" aria-label="${faithMarker.label}" title="${faithMarker.label}">${faithMarker.icon}</span>` : ''}
    `;
}

// ============================================
// SWIPE GESTURE DETECTION
// ============================================

// Swipe gesture thresholds — defined at module level so getSwipeDirection can reference them
const SWIPE_THRESHOLD    = 75;  // Minimum px to count as intentional swipe
const VELOCITY_THRESHOLD = 0.4; // px/ms — fast flick commits even below distance threshold

// Calculate swipe direction based on touch coordinates, distance and velocity.
// A gesture commits if it crosses SWIPE_THRESHOLD distance OR exceeds VELOCITY_THRESHOLD
// speed — a fast confident flick registers even if the finger didn't travel far.
function getSwipeDirection(startX, startY, endX, endY, elapsed) {
    const deltaX = endX - startX;
    const deltaY = endY - startY;

    // Calculate angle — swipe must be mostly horizontal (< 30° from horizontal axis)
    const angle = Math.abs(Math.atan2(deltaY, deltaX) * 180 / Math.PI);
    const isHorizontal = angle < 30 || angle > 150;
    if (!isHorizontal) return null;

    const distance = Math.abs(deltaX);
    const velocity = elapsed > 0 ? distance / elapsed : 0; // px/ms

    // Commit if distance threshold met OR velocity threshold met (fast flick)
    if (distance < SWIPE_THRESHOLD && velocity < VELOCITY_THRESHOLD) return null;

    return deltaX > 0 ? 'right' : 'left';
}

// ============================================
// CALENDAR RENDERING
// ============================================

// Builds and returns a fully populated calendar-container div.
// Accepts explicit month/year so callers never need to mutate global display state.
// Defaults to currentDisplayMonth/Year so existing callers (renderCalendar) are unchanged.
function buildCalendarContainer(month = currentDisplayMonth, year = currentDisplayYear) {
    const member = getCurrentMember();
    const roster = getRosterForMember(member);

    const today = getToday();
    const calendarContainer = document.createElement('div');
    calendarContainer.className = 'calendar-container';

    const firstDay = new Date(year, month, 1);
    const lastDay  = new Date(year, month + 1, 0);
    const firstWeekNum = getWeekNumberForDate(firstDay, member);
    const lastWeekNum  = getWeekNumberForDate(lastDay,  member);

    // Header
    const header = document.createElement('div');
    header.className = 'calendar-header';
    header.innerHTML = createCalendarHeader(firstWeekNum, lastWeekNum, roster.weekPrefix, month, year);
    calendarContainer.appendChild(header);

    // Grid
    const grid = document.createElement('div');
    grid.className = 'calendar-grid';

    DAY_NAMES.forEach(day => {
        const dayHeader = document.createElement('div');
        dayHeader.className = 'day-header';
        dayHeader.textContent = day;
        grid.appendChild(dayHeader);
    });

    const startDay = firstDay.getDay();
    const prevMonthLastDay = new Date(year, month, 0);
    for (let i = 0; i < startDay; i++) {
        const emptyDay = document.createElement('div');
        emptyDay.className = 'calendar-day other-month';
        emptyDay.setAttribute('aria-hidden', 'true');
        const dayNum = prevMonthLastDay.getDate() - startDay + i + 1;
        emptyDay.innerHTML = `<div class="day-number">${dayNum}</div>`;
        grid.appendChild(emptyDay);
    }

    const daysInMonth = lastDay.getDate();
    for (let day = 1; day <= daysInMonth; day++) {
        const currentDate = new Date(year, month, day);
        const weekNum = getWeekNumberForDate(currentDate, member);
        const dayKey  = DAY_KEYS[currentDate.getDay()];

        let shift = 'RD';
        if (roster.data[weekNum]) {
            shift = roster.data[weekNum][dayKey];
            if (shift === undefined) {
                console.warn(`Missing shift data: Week ${weekNum}, Day ${dayKey}`);
                shift = 'RD';
            }
        } else {
            console.warn(`Missing week ${weekNum} in ${roster.type} roster`);
        }

        // Christmas Day (Dec 25) and Boxing Day (Dec 26) are always Rest Days,
        // regardless of what the roster pattern says. Neither comes from annual leave.
        // Boxing Day can be overridden to RDW via Firestore in Phase 1 (overtime).
        if (isChristmasRD(currentDate)) shift = 'RD';

        // Firestore override — applied after the Christmas check so the base rule holds
        // for Dec 25, while Dec 26 (Boxing Day) can still become RDW for overtime.
        // Cache key: "memberName|YYYY-MM-DD" — pipe avoids ambiguity with names containing
        // spaces and dots. The cache is populated by the Firebase module script on load.
        let overrideNote = '';
        let rdwTime = '';
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        {
            const override = rosterOverridesCache.get(`${member.name}|${dateStr}`);
            if (override) {
                // RDW overrides carry a real shift time as their value, but must
                // render with the RDW colour scheme, not Early/Late/Night. Swap
                // the value for the 'RDW' sentinel so getShiftClass/Badge pick up
                // the correct pink styling. The actual time is preserved in rdwTime
                // so it can still be shown below the badge.
                if (override.type === 'rdw') {
                    rdwTime = override.value;
                    shift   = 'RDW';
                } else {
                    shift = override.value;
                }
                overrideNote = override.note;
            }
        }

        const isWorkedDay = shift !== 'RD' && shift !== 'SPARE' && shift !== 'OFF' && shift !== 'AL' && shift !== 'SICK';
        const shiftClass = isWorkedDay && member.permanentShift === 'late'  ? 'late-shift'
                         : isWorkedDay && member.permanentShift === 'early' ? 'early-shift'
                         : getShiftClass(shift);
        const dayCell = document.createElement('div');
        dayCell.className = `calendar-day ${shiftClass}`;

        const shiftLabel = shift === 'RD' || shift === 'OFF' ? 'Rest day'
            : shift === 'SPARE' ? 'Spare day'
            : shift === 'AL'    ? 'Annual leave'
            : shift === 'SICK'  ? 'Sick day'
            : shift === 'RDW'   ? 'Rest day worked'
            : member.permanentShift === 'late'  ? 'Late shift'
            : member.permanentShift === 'early' ? 'Early shift'
            : isEarlyShift(shift) ? `Early shift ${shift}`
            : `Late shift ${shift}`;
        const faithMarker = getFaithMarker(dateStr, member.name);

        const extras = [
            isSameDay(currentDate, today) ? 'Today' : '',
            isBankHoliday(currentDate) ? 'Bank holiday' : '',
            isChristmasDay(currentDate) ? 'Christmas Day' : '',
            isEasterSunday(currentDate) ? 'Easter Sunday' : '',
            isPayday(currentDate) ? 'Payday' : '',
            isCutoffDate(currentDate) ? 'Cut-off date' : '',
            faithMarker ? faithMarker.label : '',
        ].filter(Boolean).join(', ');
        dayCell.setAttribute('aria-label',
            `${fullDayNames[currentDate.getDay()]} ${currentDate.getDate()} ${monthNames[month]} ${year} — ${shiftLabel}${extras ? ' — ' + extras : ''}`
        );

        if (isSameDay(currentDate, today)) dayCell.classList.add('today');
        if (isBankHoliday(currentDate))    dayCell.classList.add('bank-holiday');
        if (isChristmasDay(currentDate))   dayCell.classList.add('christmas-day');
        if (isEasterSunday(currentDate))   dayCell.classList.add('easter-day');
        if (isPayday(currentDate))          dayCell.classList.add('payday');
        if (isCutoffDate(currentDate))      dayCell.classList.add('cutoff');

        dayCell.innerHTML = createDayCell(currentDate, shift, member.permanentShift, isWorkedDay, overrideNote, rdwTime, faithMarker);
        grid.appendChild(dayCell);
    }

    const totalCells = startDay + daysInMonth;
    const remainingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let i = 1; i <= remainingCells; i++) {
        const emptyDay = document.createElement('div');
        emptyDay.className = 'calendar-day other-month';
        emptyDay.setAttribute('aria-hidden', 'true');
        emptyDay.innerHTML = `<div class="day-number">${i}</div>`;
        grid.appendChild(emptyDay);
    }

    calendarContainer.appendChild(grid);
    return calendarContainer;
}

// ============================================
// ANNUAL LEAVE LIGHTBOX
// ============================================
(function() {
    const lb           = document.getElementById('alLightbox');
    const closeBtn     = document.getElementById('alLightboxClose');
    const takenEl      = document.getElementById('alLbTaken');
    const bookedEl     = document.getElementById('alLbBooked');
    const remEl        = document.getElementById('alLbRemaining');
    const entEl        = document.getElementById('alLbEntitlement');
    const yearEl       = document.getElementById('alLbYear');
    const breakdownEl  = document.getElementById('alLbBreakdown');

    function openALLightbox() {
        lb.classList.add('visible');
        requestAnimationFrame(() => lb.classList.add('open'));
        document.addEventListener('keydown', onKey);
        loadALStats();
    }

    function closeALLightbox() {
        lb.classList.remove('open');
        lb.addEventListener('transitionend', () => lb.classList.remove('visible'), { once: true });
        document.removeEventListener('keydown', onKey);
    }

    function onKey(e) { if (e.key === 'Escape') closeALLightbox(); }

    async function loadALStats() {
        const member  = getCurrentMember();
        const year    = currentDisplayYear;
        const yearStr = String(year);

        yearEl.textContent  = yearStr;
        takenEl.textContent = '…';
        bookedEl.textContent = '…';
        remEl.textContent   = '…';

        if (!member) {
            takenEl.textContent = bookedEl.textContent = remEl.textContent = entEl.textContent = '—';
            if (breakdownEl) breakdownEl.hidden = true;
            return;
        }

        entEl.textContent = '…';

        // today's date as YYYY-MM-DD for comparing AL dates
        const todayStr = formatISO(new Date());

        try {
            let taken = 0;
            let booked = 0;
            // Collect all overrides for this member so Dispatcher lieu days can be calculated
            const memberOverrides = [];
            if (db) {
                const snap = await getDocs(query(collection(db, 'overrides'), where('memberName', '==', member.name)));
                snap.forEach(d => {
                    const data = d.data();
                    memberOverrides.push(data);
                    // Sundays are uncontracted — don't count Sunday AL entries
                    if (data.type === 'annual_leave' && data.date && data.date.startsWith(yearStr) &&
                            !isSunday(data.date)) {
                        if (data.date <= todayStr) taken++; else booked++;
                    }
                });
            } else {
                rosterOverridesCache.forEach((val, key) => {
                    const [name, date] = key.split('|');
                    if (name !== member.name) return;
                    memberOverrides.push({ memberName: name, date, ...val });
                    // Sundays are uncontracted — don't count Sunday AL entries
                    if (val.type === 'annual_leave' && date.startsWith(yearStr) &&
                            !isSunday(date)) {
                        if (date <= todayStr) taken++; else booked++;
                    }
                });
            }
            const entitlement = getALEntitlement(member, year, memberOverrides);
            entEl.textContent = entitlement;
            const remaining = entitlement - taken - booked;
            takenEl.textContent  = taken;
            bookedEl.textContent = booked;
            remEl.textContent    = remaining;
            remEl.className      = 'al-lb-val' + (remaining <= 0 ? ' empty' : remaining <= 5 ? ' low' : '');
            // Dispatchers: explain the entitlement split (22 base + bank holiday lieu days)
            if (breakdownEl) {
                if (member.role === 'Dispatcher') {
                    const lieu = entitlement - 22;
                    breakdownEl.textContent = `22 base + ${lieu} BH lieu`;
                    breakdownEl.hidden = false;
                } else {
                    breakdownEl.hidden = true;
                }
            }
        } catch (e) {
            console.error('[AL lightbox] Failed:', e);
            takenEl.textContent = bookedEl.textContent = remEl.textContent = entEl.textContent = '—';
            if (breakdownEl) breakdownEl.hidden = true;
        }
    }

    window.closeALLightbox = closeALLightbox;

    document.getElementById('alBtn').addEventListener('click', openALLightbox);
    closeBtn.addEventListener('click', closeALLightbox);
    lb.addEventListener('click', e => { if (e.target === lb) closeALLightbox(); });
})();

/**
 * Returns a Set of shift-type strings that actually appear in the given month
 * for the given member, after applying roster pattern + Firestore overrides.
 * Used by updateLegend() to show/hide Spare, RDW, and AL legend items.
 *
 * Result is memoised in shiftTypesMonthCache keyed by "memberName|year|month".
 * The cache is cleared by fetchOverridesForRange() whenever fresh override data
 * arrives from Firestore, so stale results are never served.
 *
 * @param {Object} member - member object from teamMembers
 * @param {number} year
 * @param {number} month - 0-indexed JS month
 * @returns {Set<string>}
 */
function getShiftTypesInMonth(member, year, month) {
    const cacheKey = `${member.name}|${year}|${month}`;
    if (shiftTypesMonthCache.has(cacheKey)) return shiftTypesMonthCache.get(cacheKey);

    const types  = new Set();
    const roster = getRosterForMember(member);
    const days   = new Date(year, month + 1, 0).getDate(); // last day of month

    for (let day = 1; day <= days; day++) {
        const date    = new Date(year, month, day);
        const weekNum = getWeekNumberForDate(date, member);
        const dayKey  = DAY_KEYS[date.getDay()];
        let shift = (roster.data[weekNum]?.[dayKey]) ?? 'RD';

        if (isChristmasRD(date)) shift = 'RD';

        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        {
            const ov = rosterOverridesCache.get(`${member.name}|${dateStr}`);
            if (ov) shift = ov.type === 'rdw' ? 'RDW' : ov.value;
        }

        if (shift === 'SPARE') types.add('SPARE');
        else if (shift === 'RDW')  types.add('RDW');
        else if (shift === 'AL')   types.add('AL');
        else if (shift === 'SICK') types.add('SICK');
    }

    shiftTypesMonthCache.set(cacheKey, types);
    return types;
}

// updateLegend — shows/hides conditional legend items:
//   Spare/RDW/AL — only when that shift type actually appears this month
//   Night        — only for Dispatcher roster members
//   🎄 Christmas — only in December
//   🐣 Easter    — only in the month Easter Sunday falls in
//   Faith events — only for opted-in calendar, only the months that event falls in
// Called inside renderCalendar() on every navigation.
function updateLegend() {
    const member = getCurrentMember();

    // Spare / RDW / AL — conditional on whether they appear this month
    const typesThisMonth = member
        ? getShiftTypesInMonth(member, currentDisplayYear, currentDisplayMonth)
        : new Set();
    const show = (id, visible) => { const el = document.getElementById(id); if (el) el.style.display = visible ? '' : 'none'; };
    show('legend-spare', typesThisMonth.has('SPARE'));
    show('legend-rdw',   typesThisMonth.has('RDW'));
    show('legend-al',    typesThisMonth.has('AL'));
    show('legend-sick',  typesThisMonth.has('SICK'));
    // Hide the whole row-2 if all four are absent
    const row2 = document.getElementById('legend-row-2');
    if (row2) row2.style.display = (typesThisMonth.has('SPARE') || typesThisMonth.has('RDW') || typesThisMonth.has('AL') || typesThisMonth.has('SICK')) ? '' : 'none';

    const isDispatcher = member && member.rosterType === 'dispatcher';
    const nightItem = document.getElementById('legend-night');
    if (nightItem) nightItem.style.display = isDispatcher ? '' : 'none';

    const christmasItem = document.getElementById('legend-christmas');
    if (christmasItem) christmasItem.style.display = currentDisplayMonth === 11 ? '' : 'none';

    // Easter Sunday can fall in March or April — check which month it's in this year
    const easterItem = document.getElementById('legend-easter');
    if (easterItem) {
        const holidays = getBankHolidays(currentDisplayYear);
        const easterMonday = holidays.find(h => h.getDay() === 1 && h.getMonth() >= 2 && h.getMonth() <= 3);
        let easterSunMonth = -1;
        if (easterMonday) {
            const easterSun = new Date(easterMonday);
            easterSun.setDate(easterMonday.getDate() - 1);
            easterSunMonth = easterSun.getMonth();
        }
        easterItem.style.display = currentDisplayMonth === easterSunMonth ? '' : 'none';
    }

    // Faith calendar legend — show each item only in the month that date falls in,
    // and only when the current member has opted in to that calendar.
    const faithCalendar = member ? resolveFaithCalendar(memberSettingsCache?.get(member.name)) : 'none';
    const y = currentDisplayYear;
    const m = currentDisplayMonth;

    function faithInMonth(dateSet, requiredCalendar) {
        if (faithCalendar !== requiredCalendar) return false;
        return [...dateSet].some(d => {
            const [dy, dm] = d.split('-').map(Number);
            return dy === y && (dm - 1) === m;
        });
    }

    const legendIds = {
        'legend-ramadan':        [RAMADAN_STARTS,                 'islamic'],
        'legend-eid-fitr':       [EID_FITR_DATES,                 'islamic'],
        'legend-eid-adha':       [EID_ADHA_DATES,                 'islamic'],
        'legend-islamic-ny':     [ISLAMIC_NEW_YEAR_DATES,         'islamic'],
        'legend-mawlid':         [MAWLID_DATES,                   'islamic'],
        'legend-holi':           [HOLI_DATES,                     'hindu'],
        'legend-navratri':       [NAVRATRI_DATES,                 'hindu'],
        'legend-dussehra':       [DUSSEHRA_DATES,                 'hindu'],
        'legend-diwali':         [DIWALI_DATES,                   'hindu'],
        'legend-raksha':         [RAKSHA_BANDHAN_DATES,           'hindu'],
        'legend-lantern':        [LANTERN_FESTIVAL_DATES,         'chinese'],
        'legend-qingming':       [QINGMING_DATES,                 'chinese'],
        'legend-dragon-boat':    [DRAGON_BOAT_DATES,              'chinese'],
        'legend-mid-autumn':     [MID_AUTUMN_DATES,               'chinese'],
        'legend-ash-wednesday':  [JAMAICAN_ASH_WEDNESDAY_DATES,   'jamaican'],
        'legend-labour-day':     [JAMAICAN_LABOUR_DAY_DATES,      'jamaican'],
        'legend-emancipation':   [JAMAICAN_EMANCIPATION_DATES,    'jamaican'],
        'legend-independence':   [JAMAICAN_INDEPENDENCE_DATES,    'jamaican'],
        'legend-heroes-day':     [JAMAICAN_HEROES_DAY_DATES,      'jamaican'],
        'legend-drc-martyrs':    [CONGOLESE_MARTYRS_DATES,        'congolese'],
        'legend-drc-liberation': [CONGOLESE_LIBERATION_DATES,     'congolese'],
        'legend-drc-heroes':     [CONGOLESE_HEROES_DATES,         'congolese'],
        'legend-drc-independence':[CONGOLESE_INDEPENDENCE_DATES,  'congolese'],
        'legend-pt-carnival':    [PORTUGUESE_CARNIVAL_DATES,      'portuguese'],
        'legend-pt-freedom':     [PORTUGUESE_FREEDOM_DATES,       'portuguese'],
        'legend-pt-labour':      [PORTUGUESE_LABOUR_DATES,        'portuguese'],
        'legend-pt-portugal-day':[PORTUGUESE_PORTUGAL_DAY_DATES,  'portuguese'],
        'legend-pt-corpus':      [PORTUGUESE_CORPUS_CHRISTI_DATES,'portuguese'],
        'legend-pt-assumption':  [PORTUGUESE_ASSUMPTION_DATES,    'portuguese'],
        'legend-pt-republic':    [PORTUGUESE_REPUBLIC_DATES,      'portuguese'],
        'legend-pt-restoration': [PORTUGUESE_RESTORATION_DATES,   'portuguese'],
        'legend-pt-immaculate':  [PORTUGUESE_IMMACULATE_DATES,    'portuguese'],
    };
    for (const [id, [dateSet, cal]] of Object.entries(legendIds)) {
        const el = document.getElementById(id);
        if (el) el.style.display = faithInMonth(dateSet, cal) ? '' : 'none';
    }

    // Show/hide the faith row container itself — visible only when at least one item inside it is shown.
    const faithRow = document.getElementById('legend-faith-row');
    if (faithRow) {
        const anyFaithVisible = [...faithRow.querySelectorAll('.legend-item')]
            .some(el => el.style.display !== 'none');
        faithRow.style.display = anyFaithVisible ? '' : 'none';
    }

    // Chinese New Year legend — use the zodiac icon for the matching year.
    const cnyEl   = document.getElementById('legend-cny');
    const cnyText = document.getElementById('legend-cny-text');
    if (cnyEl && cnyText) {
        let cnyVisible = false;
        if (faithCalendar === 'chinese') {
            for (const [dateStr, { icon, label }] of CHINESE_NEW_YEAR_DATES) {
                const [dy, dm] = dateStr.split('-').map(Number);
                if (dy === y && (dm - 1) === m) {
                    cnyText.textContent = `${icon} ${label}`;
                    cnyVisible = true;
                    break;
                }
            }
        }
        cnyEl.style.display = cnyVisible ? '' : 'none';
        // Re-check faith row visibility now that CNY item state is final.
        if (faithRow) {
            const anyFaithVisible = [...faithRow.querySelectorAll('.legend-item')]
                .some(el => el.style.display !== 'none');
            faithRow.style.display = anyFaithVisible ? '' : 'none';
        }
    }
}

// renderCalendar — used for all non-swipe navigation (buttons, keyboard, today).
// Sets data-member-name for print header then builds and inserts fresh container.
function renderCalendar() {
    try {
        const member = getCurrentMember();

        // Update legend for current member and month (Night, 🎄, 🥚 are conditional)
        updateLegend();

        // Set team member name on header for printing
        const headerElement = document.querySelector('.header');
        if (headerElement) headerElement.setAttribute('data-member-name', member.name);

        const calendarDisplay = document.getElementById('calendarDisplay');
        if (!calendarDisplay) throw new Error('Calendar display element not found');

        document.title = `MYB Roster — ${monthNames[currentDisplayMonth]} ${currentDisplayYear}`;

        // Persist so the user returns to the same month after closing the app
        localStorage.setItem('myb_roster_month', currentDisplayMonth);
        localStorage.setItem('myb_roster_year',  currentDisplayYear);

        const calendarContainer = buildCalendarContainer(); // uses defaults
        calendarDisplay.innerHTML = '';
        calendarDisplay.appendChild(calendarContainer);

        // Update Prev/Next buttons at year/month boundaries
        // aria-disabled signals the limit to screen readers; opacity gives visual feedback
        const atStart = currentDisplayYear === CONFIG.MIN_YEAR && currentDisplayMonth === 0;
        const atEnd   = currentDisplayYear === CONFIG.MAX_YEAR && currentDisplayMonth === 11;
        const prevBtn = document.getElementById('prevMonth');
        const nextBtn = document.getElementById('nextMonth');
        if (prevBtn) {
            prevBtn.setAttribute('aria-disabled', atStart ? 'true' : 'false');
            prevBtn.style.opacity = atStart ? '0.4' : '';
        }
        if (nextBtn) {
            nextBtn.setAttribute('aria-disabled', atEnd ? 'true' : 'false');
            nextBtn.style.opacity = atEnd ? '0.4' : '';
        }

        // Ensure Firestore overrides are cached for the displayed month.
        // No-op if already fetched; fires a background fetch and re-render if not
        // (e.g. when the user navigates beyond the initial 3-month window).
        ensureOverridesCached(currentDisplayYear, currentDisplayMonth);

    } catch (error) {
        console.error('Error rendering calendar:', error);
        const calendarDisplay = document.getElementById('calendarDisplay');
        if (calendarDisplay) {
            const errDiv = document.createElement('div');
            errDiv.className = 'calendar-error';
            errDiv.innerHTML = '<h2>⚠️ Calendar Error</h2><p>Unable to render calendar. Please refresh the page.</p>';
            const errMsg = document.createElement('p');
            errMsg.className = 'calendar-error-message';
            errMsg.textContent = `Error: ${error.message}`;
            errDiv.appendChild(errMsg);
            calendarDisplay.innerHTML = '';
            calendarDisplay.appendChild(errDiv);
        }
    }
}


// ============================================
// EVENT LISTENERS
// ============================================

document.getElementById('teamMemberSelect').addEventListener('change', (e) => {
    if (swipeCooldown) return; // Don't interrupt a swipe animation
    saveSelectedMember(parseInt(e.target.value, 10));
    updateLegend();
    renderCalendar();
    updateFaithHint();
    // Close AL lightbox if open — data would be stale for the new member
    if (typeof closeALLightbox === 'function') closeALLightbox();
});

function updateFaithHint() {
    const member = getCurrentMember();
    const hint = document.getElementById('faithHint');
    if (!hint) return;
    const cal = member ? resolveFaithCalendar(memberSettingsCache?.get(member.name)) : 'none';
    const CALENDAR_NAMES = {
        islamic:    '🌙 Islamic calendar',
        hindu:      '🪔 Hindu calendar',
        chinese:    '🧧 Chinese calendar',
        jamaican:   '🇯🇲 Jamaican calendar',
        congolese:  '🇨🇩 Congolese calendar',
        portuguese: '🇵🇹 Portuguese calendar',
    };
    if (cal !== 'none') {
        hint.textContent = (CALENDAR_NAMES[cal] || 'Cultural calendar') + ' markers active';
        hint.style.display = '';
    } else {
        hint.style.display = 'none';
    }
}

document.getElementById('prevMonth').addEventListener('click', () => {
    if (swipeCooldown) return; // Don't interrupt a swipe animation
    changeMonth(-1);
    renderCalendar();
    announceMonthChange();
});

// Briefly pulses the today cell - only called when navigating TO today
function pulseToday() {
    // Wait one frame for the DOM to settle after renderCalendar
    requestAnimationFrame(() => {
        const todayCell = document.querySelector('.calendar-day.today');
        if (!todayCell) return;
        // Remove class first in case it's already there, then re-add
        todayCell.classList.remove('today-pulse');
        void todayCell.offsetWidth; // Force reflow to restart animation
        todayCell.classList.add('today-pulse');
        todayCell.addEventListener('animationend', () => {
            todayCell.classList.remove('today-pulse');
        }, { once: true });
    });
}

// Announce the new month to screen readers via aria-live region.
// Using a live region avoids programmatic focus on the month title, which
// caused mobile browsers to disturb the flex layout of .calendar-header.
function announceMonthChange() {
    const announcer = document.getElementById('ariaAnnouncer');
    if (!announcer) return;
    // Clear first so repeated same-direction navigation always fires the announcement
    announcer.textContent = '';
    requestAnimationFrame(() => {
        announcer.textContent = `${monthNames[currentDisplayMonth]} ${currentDisplayYear}`;
    });
}

document.getElementById('todayBtn').addEventListener('click', () => {
    if (swipeCooldown) return; // Don't interrupt a swipe animation
    const now = getToday();
    currentDisplayMonth = now.getMonth();
    currentDisplayYear = now.getFullYear();
    renderCalendar();
    pulseToday();
    announceMonthChange();
});

document.getElementById('nextMonth').addEventListener('click', () => {
    if (swipeCooldown) return; // Don't interrupt a swipe animation
    changeMonth(1);
    renderCalendar();
    announceMonthChange();
});

document.getElementById('printBtn').addEventListener('click', () => {
    window.print();
});

document.getElementById('adminBtn').addEventListener('click', () => {
    const today = getToday();
    const isCurrentMonth = currentDisplayMonth === today.getMonth() && currentDisplayYear === today.getFullYear();
    const targetDate = isCurrentMonth ? today : new Date(currentDisplayYear, currentDisplayMonth, 1);
    const yyyy = String(targetDate.getFullYear()).padStart(4, '0');
    const mm   = String(targetDate.getMonth() + 1).padStart(2, '0');
    const dd   = String(targetDate.getDate()).padStart(2, '0');
    location.href = `admin.html?date=${yyyy}-${mm}-${dd}`;
});

// Modules are always deferred — the DOM is fully parsed before this code runs.
// No DOMContentLoaded wrapper needed; initialize directly.
try {
        // Validate roster data now that DOM is ready and errorBanner element exists
        const allErrors = [
            ...validateRoster(weeklyRoster,   'Main Roster',      CONFIG.MAIN_ROSTER_WEEKS),
            ...validateRoster(bilingualRoster, 'Bilingual Roster', CONFIG.BILINGUAL_ROSTER_WEEKS),
            ...validateRoster(cesRoster,        'CES Roster',        CONFIG.CES_ROSTER_WEEKS),
            ...validateRoster(dispatcherRoster, 'Dispatcher Roster', CONFIG.DISPATCHER_ROSTER_WEEKS),
            ...validateRoster(fixedRoster,     'Fixed Roster',     1),
            ...validateTeamMembers()
        ];
        if (allErrors.length > 0) {
            console.error('⚠️ ROSTER DATA VALIDATION ERRORS:');
            allErrors.forEach(error => console.error('  - ' + error));
            const banner = document.getElementById('errorBanner');
            if (banner) {
                banner.textContent = '⚠️ Roster data issue: ' + allErrors.join(' | ');
                banner.classList.add('visible');
            }
        }

        populateTeamMemberDropdown();
        updateLegend();
        renderCalendar();
        updateFaithHint();

        // Dismiss splash screen after first render
        // Small timeout ensures the calendar is painted before fading
        const splash = document.getElementById('splash');
        if (splash) {
            setTimeout(() => {
                splash.classList.add('hidden');
                // Remove from DOM after transition to free memory
                splash.addEventListener('transitionend', () => splash.remove(), { once: true });
            }, 300);
        }

        // Handle manifest shortcuts — ?shortcut=today jumps to current month
        if (new URLSearchParams(window.location.search).get('shortcut') === 'today') {
            const now = getToday();
            currentDisplayMonth = now.getMonth();
            currentDisplayYear = now.getFullYear();
            renderCalendar();
            pulseToday();
        }
        
        // ============================================
        // SETUP SWIPE/DRAG GESTURES (Touch + Mouse + Trackpad)
        // ============================================
        // Uses the Pointer Events API — a single unified API for mouse, touch
        // and stylus. Works identically on mobile (finger swipe) and desktop
        // (click-drag or trackpad swipe). setPointerCapture() on pointerdown
        // ensures events keep firing even if the pointer leaves the element.
        // ============================================
        const calendarDisplay = document.getElementById('calendarDisplay');

        if (calendarDisplay) {
            // Respect prefers-reduced-motion — instant transitions for users who need it
            const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            const TRANSITION             = prefersReducedMotion ? 'none' : 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
            const TRANSITION_DURATION_MS = prefersReducedMotion ? 0 : 350; // Must match the duration in TRANSITION above
            let prevPanel = null;
            let nextPanel = null;
            let isListening = false;     // True from pointerdown until gesture is resolved (tap or completed swipe)
            let isDragging = false;      // True only after horizontal intent is confirmed in pointermove
            let touchStartX = 0;
            let touchStartY = 0;
            let touchStartTime = 0;
            let gestureW = 0;            // Cached display width — measured once horizontal intent confirmed, reused throughout gesture
            let gestureCurrentPanel = null; // Cached current panel — queried once on pointerdown, reused throughout gesture

            // Returns true if swiping in the given direction would actually change the month.
            // At the year boundaries, swiping toward the blocked side should always snap back.
            function canNavigate(direction) {
                if (direction === 'prev') {
                    return !(currentDisplayYear === CONFIG.MIN_YEAR && currentDisplayMonth === 0);
                }
                if (direction === 'next') {
                    return !(currentDisplayYear === CONFIG.MAX_YEAR && currentDisplayMonth === 11);
                }
                return true;
            }

            // Build a panel for an adjacent month using explicit month/year params —
            // no global state mutation, no risk of corruption if an exception is thrown.
            function buildAdjacentPanel(monthDelta) {
                let m = currentDisplayMonth + monthDelta;
                let y = currentDisplayYear;
                if (m > 11) { m = 0;  y++; }
                if (m < 0)  { m = 11; y--; }
                // Clamp to valid range
                if (y > CONFIG.MAX_YEAR) { y = CONFIG.MAX_YEAR; m = 11; }
                if (y < CONFIG.MIN_YEAR) { y = CONFIG.MIN_YEAR; m = 0;  }
                return buildCalendarContainer(m, y);
            }

            // Position a panel off-screen without transition.
            // Static layout (position/top/left/width) is in the .carousel-panel CSS class.
            // gestureW is cached on touchstart — no layout recalculation needed here.
            function parkPanel(panel, side) {
                panel.classList.add('carousel-panel');
                panel.style.transition = 'none';
                panel.style.transform  = `translateX(${side === 'right' ? gestureW : -gestureW}px)`;
                panel.style.willChange = 'transform';
            }

            // Remove pre-built panels cleanly from DOM
            function discardPanels() {
                if (prevPanel && prevPanel.parentNode) prevPanel.remove();
                if (nextPanel && nextPanel.parentNode) nextPanel.remove();
                prevPanel = null;
                nextPanel = null;
            }

            let hapticFired = false;

            // pointerdown — record start position only. No pointer capture, no panel building yet.
            // Pointer Events unifies mouse, touch and stylus into one API. We defer setPointerCapture
            // to pointermove (once horizontal intent is confirmed) because capturing immediately on
            // pointerdown causes iOS Safari to mis-classify the gesture and suppress pointermove
            // events — the same approach used in admin.html where swipe works reliably on iOS.
            calendarDisplay.addEventListener('pointerdown', (e) => {
                if (!e.isPrimary || swipeCooldown) return;

                gestureCurrentPanel = document.querySelector('.calendar-container:not(.carousel-panel)');
                if (!gestureCurrentPanel) return;

                // Prime the Vibration API on the first real user gesture.
                // Chrome Android requires a user activation before navigator.vibrate() works.
                if (navigator.vibrate) navigator.vibrate(0);

                touchStartX    = e.clientX;
                touchStartY    = e.clientY;
                touchStartTime = Date.now();
                isListening    = true;
                isDragging     = false;
                hapticFired    = false;
            });

            // pointermove — confirm direction before committing to swipe.
            // On the first move past the dead zone we decide: vertical → abandon and let the
            // browser scroll; horizontal → capture the pointer, build adjacent panels, and start
            // dragging. Deferring setPointerCapture to this point (rather than pointerdown) is the
            // key fix for iOS Safari, which is stricter than Android about gesture arbitration.
            calendarDisplay.addEventListener('pointermove', (e) => {
                if (!e.isPrimary || !isListening) return;

                const deltaX = e.clientX - touchStartX;
                const deltaY = e.clientY - touchStartY;

                if (!isDragging) {
                    // Dead zone — ignore tiny jitter
                    if (Math.abs(deltaX) <= 5 && Math.abs(deltaY) <= 5) return;

                    if (Math.abs(deltaY) >= Math.abs(deltaX)) {
                        // Vertical intent — abandon; let the browser handle scrolling
                        isListening = false;
                        gestureCurrentPanel = null;
                        return;
                    }

                    // Horizontal intent confirmed — commit to swipe gesture
                    // Cache width once — ceil() rounds up sub-pixel values so adjacent panels
                    // overlap by at least 1px, eliminating the sub-pixel rendering seam.
                    gestureW = Math.ceil(calendarDisplay.getBoundingClientRect().width);
                    calendarDisplay.setPointerCapture(e.pointerId);
                    gestureCurrentPanel.style.transition = 'none';
                    gestureCurrentPanel.style.willChange = 'transform';

                    try {
                        if (canNavigate('prev')) {
                            prevPanel = buildAdjacentPanel(-1);
                            parkPanel(prevPanel, 'left');
                            calendarDisplay.appendChild(prevPanel);
                        }
                        if (canNavigate('next')) {
                            nextPanel = buildAdjacentPanel(1);
                            parkPanel(nextPanel, 'right');
                            calendarDisplay.appendChild(nextPanel);
                        }
                        swipeCooldown = true;
                        isDragging    = true;
                    } catch (err) {
                        console.error('Failed to build adjacent panels:', err);
                        discardPanels();
                        isListening = false;
                        isDragging  = false;
                        gestureCurrentPanel.style.transition = '';
                        gestureCurrentPanel.style.willChange = '';
                        gestureCurrentPanel = null;
                        return;
                    }
                }

                if (!gestureCurrentPanel) return;

                const RESISTANCE = 0.3;
                const atPrevBoundary = deltaX > 0 && !prevPanel;
                const atNextBoundary = deltaX < 0 && !nextPanel;
                const effectiveDeltaX = (atPrevBoundary || atNextBoundary)
                    ? deltaX * RESISTANCE
                    : deltaX;

                gestureCurrentPanel.style.transform = `translateX(${effectiveDeltaX}px)`;
                if (prevPanel) prevPanel.style.transform = `translateX(${-gestureW + effectiveDeltaX}px)`;
                if (nextPanel) nextPanel.style.transform = `translateX(${gestureW  + effectiveDeltaX}px)`;

                if (!hapticFired && !atPrevBoundary && !atNextBoundary && Math.abs(deltaX) >= SWIPE_THRESHOLD) {
                    if (navigator.vibrate) navigator.vibrate(30);
                    hapticFired = true;
                }
            });

            // pointerup — replaces touchend
            calendarDisplay.addEventListener('pointerup', (e) => {
                if (!e.isPrimary || !isListening) return;
                isListening = false;

                if (!isDragging) {
                    // Pointer went down and up without confirmed horizontal drag — was a tap.
                    // Buttons and day cells handle their own click events; nothing to do here.
                    gestureCurrentPanel = null;
                    return;
                }
                isDragging = false;

                // Release pointer capture now gesture is complete
                try { calendarDisplay.releasePointerCapture(e.pointerId); } catch (_) {}

                const current = gestureCurrentPanel;
                if (!current) { discardPanels(); return; }

                const direction = getSwipeDirection(touchStartX, touchStartY, e.clientX, e.clientY, Date.now() - touchStartTime);
                const w = gestureW;

                if (direction) {
                    if (!hapticFired && navigator.vibrate) navigator.vibrate(30);

                    const incomingPanel = direction === 'left' ? nextPanel : prevPanel;
                    const discardPanel  = direction === 'left' ? prevPanel : nextPanel;

                    if (!incomingPanel) {
                        discardPanels();
                        current.style.transition = 'none';
                        current.style.transform  = '';
                        current.style.willChange = '';
                        swipeCooldown = false;
                        console.warn('Swipe commit: incomingPanel was null, aborting without state change');
                        return;
                    }

                    changeMonth(direction === 'left' ? 1 : -1);
                    document.title = `MYB Roster — ${monthNames[currentDisplayMonth]} ${currentDisplayYear}`;
                    updateLegend();
                    updateFaithHint();

                    current.style.transition       = TRANSITION;
                    current.style.transform        = `translateX(${direction === 'left' ? -w : w}px)`;
                    incomingPanel.style.transition = TRANSITION;
                    incomingPanel.style.transform  = 'translateX(0)';

                    if (discardPanel && discardPanel.parentNode) discardPanel.remove();

                    function restoreIncoming() {
                        incomingPanel.classList.remove('carousel-panel');
                        incomingPanel.style.transition = '';
                        incomingPanel.style.transform  = '';
                        incomingPanel.style.willChange = '';
                        if (current.parentNode) current.remove();
                        prevPanel = null;
                        nextPanel = null;
                        gestureCurrentPanel = null;
                        swipeCooldown = false;
                    }

                    const safetyTimer = setTimeout(restoreIncoming, TRANSITION_DURATION_MS + 50);
                    incomingPanel.addEventListener('transitionend', () => {
                        clearTimeout(safetyTimer);
                        restoreIncoming();
                    }, { once: true });

                } else {
                    current.style.transition = TRANSITION;
                    current.style.transform  = 'translateX(0)';
                    current.style.willChange = '';
                    if (prevPanel) { prevPanel.style.transition = TRANSITION; prevPanel.style.transform = `translateX(${-w}px)`; }
                    if (nextPanel) { nextPanel.style.transition = TRANSITION; nextPanel.style.transform = `translateX(${w}px)`;  }
                    setTimeout(() => {
                        discardPanels();
                        gestureCurrentPanel = null;
                        swipeCooldown = false;
                    }, TRANSITION_DURATION_MS + 50);
                }
            });

            // pointercancel — fires when OS interrupts the gesture (call, notification, rotate)
            calendarDisplay.addEventListener('pointercancel', (e) => {
                if (!e.isPrimary || !isListening) return;
                isListening   = false;
                isDragging    = false;
                swipeCooldown = false;

                // Release pointer capture on cancel
                try { calendarDisplay.releasePointerCapture(e.pointerId); } catch (_) {}

                if (gestureCurrentPanel) {
                    gestureCurrentPanel.style.transition = 'none';
                    gestureCurrentPanel.style.transform  = '';
                    gestureCurrentPanel.style.willChange = '';
                    gestureCurrentPanel = null;
                }
                discardPanels();
            });

            // Prevent context menu on long-press (Android) or right-click (desktop)
            calendarDisplay.addEventListener('contextmenu', (e) => e.preventDefault());

        }

        // ============================================
        // ICON LIGHTBOX / ABOUT PANEL
        // ============================================
        // Shows app name, version, and live SW update status.
        // Update detection works by watching the SW registration:
        //   - registration.waiting  → a new SW has installed and is waiting
        //   - updatefound event     → a new SW has started installing
        // When a waiting SW is found, the "Update now" button appears.
        // Pressing it sends SKIP_WAITING to the waiting SW, which activates
        // it immediately. The page then reloads to run the new version.
        (function() {
            const lightbox     = document.getElementById('iconLightbox');
            const titleIcon    = document.querySelector('.title-icon');
            const versionEl    = document.getElementById('lightboxVersion');
            const statusEl     = document.getElementById('lightboxUpdateStatus');
            const updateBtn    = document.getElementById('lightboxUpdateBtn');
            const closeBtn     = document.getElementById('iconLightboxClose');
            const contentCard  = document.getElementById('iconLightboxContent');
            const bugLink      = document.getElementById('bugReportLink');

            if (!lightbox || !titleIcon) return;

            // Populate version from CONFIG
            if (versionEl) versionEl.textContent = CONFIG.APP_VERSION;

            // ---- Update status management ----

            let swRegistration = null; // Holds the SW registration once available

            function showUpToDate() {
                if (!statusEl) return;
                statusEl.textContent   = '✓ Up to date';
                statusEl.className     = 'lightbox-status up-to-date';
                if (updateBtn) updateBtn.style.display = 'none';
            }

            function showUpdateAvailable() {
                if (!statusEl) return;
                statusEl.textContent   = 'Update available';
                statusEl.className     = 'lightbox-status update-available';
                if (updateBtn) updateBtn.style.display = 'block';
            }

            function showChecking() {
                if (!statusEl) return;
                statusEl.textContent   = 'Checking…';
                statusEl.className     = 'lightbox-status checking';
                if (updateBtn) updateBtn.style.display = 'none';
            }

            // Check the current SW registration state and update the UI accordingly.
            // Called once when the lightbox opens and whenever the SW state changes.
            function checkUpdateStatus() {
                if (!swRegistration) {
                    showUpToDate();
                    return;
                }
                if (swRegistration.waiting) {
                    showUpdateAvailable();
                } else {
                    showUpToDate();
                }
            }

            // Watch for SW registration changes — runs once after DOMContentLoaded
            // so we have a registration reference before the lightbox is ever opened.
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.ready.then(registration => {
                    swRegistration = registration;

                    // A new SW finished installing and is now waiting
                    if (registration.waiting) showUpdateAvailable();

                    // A new SW starts downloading (will move to waiting on completion)
                    registration.addEventListener('updatefound', () => {
                        const newWorker = registration.installing;
                        if (!newWorker) return;
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                // New SW installed alongside the active one — update available
                                showUpdateAvailable();
                            }
                        });
                    });

                    // Periodically check for updates (every 60 mins)
                    // — catches cases where the app is left open for a long time
                    setInterval(() => registration.update(), 60 * 60 * 1000);
                });
            }

            // ---- Update button ----
            // Sends SKIP_WAITING to the waiting SW, which activates it immediately.
            // The SW's activate handler calls clients.claim(), taking control of this tab.
            // We then reload to run the new version.
            if (updateBtn) {
                updateBtn.addEventListener('click', (e) => {
                    e.stopPropagation(); // Don't close lightbox

                    updateBtn.textContent  = 'Updating…';
                    updateBtn.disabled     = true;

                    if (swRegistration && swRegistration.waiting) {
                        // Normal case: new SW installed and waiting — tell it to activate
                        swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
                        navigator.serviceWorker.addEventListener('controllerchange', () => {
                            window.location.reload();
                        }, { once: true });
                    } else {
                        // SW already auto-activated via skipWaiting() on install —
                        // the new version is in control; just reload to run it.
                        window.location.reload();
                    }
                });
            }

            // ---- Open / close ----

            function openLightbox() {
                checkUpdateStatus(); // Refresh status every time it opens
                if (bugLink) {
                    const member   = getCurrentMember();
                    const name     = member ? member.name : 'Not selected';
                    const date     = new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
                    const ua       = navigator.userAgent;
                    const body     = `Please describe the bug:\n\n\n\n— Auto-filled —\nApp: MYB Roster v${CONFIG.APP_VERSION}\nUser: ${name}\nDate: ${date}\nBrowser: ${ua}`;
                    bugLink.href   = `mailto:Gareth.Miller@chilternrailways.co.uk?subject=${encodeURIComponent(`Bug Report — MYB Roster v${CONFIG.APP_VERSION}`)}&body=${encodeURIComponent(body)}`;
                }
                lightbox.classList.add('visible');
                requestAnimationFrame(() => lightbox.classList.add('open'));
                document.addEventListener('keydown', onKeyDown);
            }

            function closeLightbox() {
                lightbox.classList.remove('open');
                lightbox.addEventListener('transitionend', () => {
                    lightbox.classList.remove('visible');
                }, { once: true });
                document.removeEventListener('keydown', onKeyDown);
            }

            function onKeyDown(e) {
                if (e.key === 'Escape') closeLightbox();
            }

            titleIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                openLightbox();
            });

            // Tap the dark overlay or ✕ to close
            lightbox.addEventListener('click', closeLightbox);

            // Tapping the content card itself does NOT close (prevents accidental close)
            if (contentCard) contentCard.addEventListener('click', e => e.stopPropagation());
            if (closeBtn)    closeBtn.addEventListener('click',    closeLightbox);
            // Bug link opens mail app — stopPropagation prevents the overlay click handler closing the lightbox
            if (bugLink)     bugLink.addEventListener('click',     e => e.stopPropagation());
        })();

        // ============================================
        // MONTH/YEAR JUMP PICKER
        // ============================================
        (function() {
            const overlay    = document.getElementById('monthJumpOverlay');
            const card       = document.getElementById('monthJumpCard');
            const selMonth   = document.getElementById('monthJumpMonth');
            const selYear    = document.getElementById('monthJumpYear');
            const btnConfirm = document.getElementById('monthJumpConfirm');
            const btnCancel  = document.getElementById('monthJumpCancel');
            if (!overlay) return;

            // Populate year select once (2024–2030)
            for (let y = CONFIG.MIN_YEAR; y <= CONFIG.MAX_YEAR; y++) {
                const opt = document.createElement('option');
                opt.value = y; opt.textContent = y;
                selYear.appendChild(opt);
            }
            // Populate month select once
            monthNames.forEach((name, i) => {
                const opt = document.createElement('option');
                opt.value = i; opt.textContent = name;
                selMonth.appendChild(opt);
            });

            function openPicker() {
                selMonth.value = currentDisplayMonth;
                selYear.value  = currentDisplayYear;
                overlay.classList.add('visible');
                requestAnimationFrame(() => overlay.classList.add('open'));
            }

            function closePicker() {
                overlay.classList.remove('open');
                overlay.addEventListener('transitionend', () => overlay.classList.remove('visible'), { once: true });
            }

            // Delegated click: any .month-year element (rebuilt on each render)
            document.getElementById('calendarDisplay').addEventListener('click', e => {
                if (e.target.closest('.month-year')) openPicker();
            });
            document.getElementById('calendarDisplay').addEventListener('keydown', e => {
                if (e.target.closest('.month-year') && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault(); openPicker();
                }
            });

            btnConfirm.addEventListener('click', () => {
                currentDisplayMonth = parseInt(selMonth.value, 10);
                currentDisplayYear  = parseInt(selYear.value, 10);
                closePicker();
                renderCalendar();
                announceMonthChange();
            });

            btnCancel.addEventListener('click', closePicker);
            overlay.addEventListener('click', closePicker);
            card.addEventListener('click', e => e.stopPropagation());

            document.addEventListener('keydown', e => {
                if (e.key === 'Escape' && overlay.classList.contains('open')) closePicker();
            });
        })();

        // ============================================
        // KEYBOARD SHORTCUTS (Desktop)
        // ============================================
        document.addEventListener('keydown', (e) => {
            // Don't fire if user is typing in an input
            if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
            if (swipeCooldown) return; // Don't interrupt a swipe animation
            if (e.key === 'ArrowLeft')  { changeMonth(-1); renderCalendar(); announceMonthChange(); }
            if (e.key === 'ArrowRight') { changeMonth(1);  renderCalendar(); announceMonthChange(); }
            if (e.key === 't' || e.key === 'T') { const now = getToday(); currentDisplayMonth = now.getMonth(); currentDisplayYear = now.getFullYear(); renderCalendar(); pulseToday(); announceMonthChange(); }
            if (e.key === 'p' || e.key === 'P') { window.print(); }
        });

} catch (error) {
    console.error('Initialization error:', error);
    // Always hide the splash — an error banner is more useful than an infinite loading screen
    const splashEl = document.getElementById('splash');
    if (splashEl) splashEl.remove();
    const banner = document.getElementById('errorBanner');
    if (banner) {
        banner.textContent = '⚠️ Failed to initialise calendar. Please refresh. Error: ' + error.message;
        banner.classList.add('visible');
    }
}

// ============================================
// FIRESTORE HELPER FUNCTIONS
// ============================================

/**
 * Format a Date as 'YYYY-MM-DD' for Firestore range queries.
 * @param {Date} date
 * @returns {string}
 */
function formatDateStr(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * Generate a month key string (e.g. '2026-03') for the fetchedMonths Set.
 * @param {number} year
 * @param {number} month - 0-indexed JS month
 * @returns {string}
 */
function monthKey(year, month) {
    return `${year}-${String(month + 1).padStart(2, '0')}`;
}

/**
 * Query Firestore for all override documents in a date range and populate the cache.
 * Documents with missing required fields are skipped and logged.
 * @param {string} startStr - 'YYYY-MM-DD' inclusive start
 * @param {string} endStr   - 'YYYY-MM-DD' inclusive end
 */
async function fetchOverridesForRange(startStr, endStr) {
    const q = query(
        collection(db, 'overrides'),
        where('date', '>=', startStr),
        where('date', '<=', endStr)
    );
    const snapshot = await getDocs(q);
    console.log(`[Firestore] fetchOverridesForRange ${startStr}→${endStr}: ${snapshot.size} doc(s)`);
    snapshot.forEach(doc => {
        const data = doc.data();
        console.log('[Firestore] override doc:', JSON.stringify({ id: doc.id, memberName: data.memberName, date: data.date, type: data.type, value: data.value }));
        if (!data.memberName || !data.date || !data.value) {
            console.error('[Firestore] Skipping malformed override document:', doc.id, data);
            return;
        }
        const key = `${data.memberName}|${data.date}`;
        rosterOverridesCache.set(key, {
            value: data.value,
            note:  data.note || '',
            type:  data.type  || ''
        });
    });
    // New override data may change which shift types appear in a month,
    // so invalidate the getShiftTypesInMonth() memo cache.
    shiftTypesMonthCache.clear();
}

/**
 * Ensure overrides for a given month are in the cache.
 * Called by renderCalendar() on every navigation — no-op if already fetched,
 * fires a background fetch and re-render if not.
 * @param {number} year
 * @param {number} month - 0-indexed JS month
 */
async function ensureOverridesCached(year, month) {
    const key = monthKey(year, month);
    if (fetchedMonths.has(key)) return;  // Already fetched — nothing to do

    // Mark before awaiting to prevent concurrent duplicate fetches
    // if renderCalendar() fires twice in quick succession for the same month.
    fetchedMonths.add(key);

    try {
        const startStr = formatDateStr(new Date(year, month, 1));
        const endStr   = formatDateStr(new Date(year, month + 1, 0));
        await fetchOverridesForRange(startStr, endStr);
        // Re-render so the newly fetched overrides are visible immediately.
        renderCalendar();
    } catch (err) {
        fetchedMonths.delete(key);  // Allow retry on next navigation
        console.error('[Firestore] Failed to fetch overrides for', key, err);
    }
}

// ============================================
// INITIAL 3-MONTH FETCH
// Fetches previous, current, and next month in a single Firestore query.
// Pre-fills the cache for all three swipe positions so there is no visible
// delay when the user swipes left or right on first open.
// ============================================
(async () => {
    const now  = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    // Mark all three months as fetched before awaiting — prevents
    // ensureOverridesCached() from issuing redundant per-month fetches
    // if renderCalendar() fires while the initial query is in flight.
    fetchedMonths.add(monthKey(prev.getFullYear(), prev.getMonth()));
    fetchedMonths.add(monthKey(now.getFullYear(),  now.getMonth()));
    fetchedMonths.add(monthKey(next.getFullYear(), next.getMonth()));

    // Show a "Syncing…" chip after 800 ms if Firestore hasn't responded yet.
    // Injected into .calendar-header so it sits next to the month/year heading.
    // Also adds .calendar-fetching to the calendar container to trigger skeleton shimmer.
    // Both are removed immediately when data arrives or the fetch fails.
    let syncChip = null;
    const calGrid = document.getElementById('calendarDisplay');
    const loadingTimer = setTimeout(() => {
        const header = document.querySelector('.calendar-header');
        if (header) {
            syncChip = document.createElement('span');
            syncChip.className = 'sync-chip';
            syncChip.setAttribute('aria-live', 'polite');
            syncChip.textContent = '↻ Syncing…';
            header.appendChild(syncChip);
        }
        if (calGrid) calGrid.classList.add('calendar-fetching');
    }, 800);

    try {
        const startStr = formatDateStr(new Date(prev.getFullYear(), prev.getMonth(), 1));
        const endStr   = formatDateStr(new Date(next.getFullYear(), next.getMonth() + 1, 0));

        // Fetch overrides and member settings in parallel
        const [, settingsSnap] = await Promise.all([
            fetchOverridesForRange(startStr, endStr),
            getDocs(collection(db, 'memberSettings')).catch(e => {
                console.warn('[Firestore] memberSettings fetch failed:', e); return null;
            }),
        ]);

        if (settingsSnap) {
            settingsSnap.forEach(doc => {
                memberSettingsCache.set(doc.id, doc.data());
            });
        }

        // Overlay localStorage values set by admin.html on this device.
        // localStorage is same-origin so always readable here, and is
        // the authoritative store until Firestore rules allow memberSettings writes.
        teamMembers.forEach(m => {
            const local = localStorage.getItem(`faithCalendar_${m.name}`);
            if (local) {
                const existing = memberSettingsCache.get(m.name) || {};
                memberSettingsCache.set(m.name, { ...existing, faithCalendar: local });
            }
        });

        renderCalendar();
        updateFaithHint();
    } catch (err) {
        console.error('[Firestore] Initial override fetch failed — base roster will be used', err);
    } finally {
        clearTimeout(loadingTimer);
        if (syncChip) syncChip.remove();
        if (calGrid) calGrid.classList.remove('calendar-fetching');
    }
})();

// Register service worker for PWA functionality
// ============================================
// PRINT HEADER — stamp timestamp before printing
// ============================================
window.addEventListener('beforeprint', () => {
    const now    = new Date().toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });
    const header = document.querySelector('.header');
    if (header) header.setAttribute('data-print-date', `Printed: ${now}`);
});

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js')
            .then(registration => {
                console.log('Service Worker registered successfully:', registration.scope);
            })
            .catch(error => {
                console.log('Service Worker registration failed:', error);
            });
    });
}

// ============================================
// TODAY'S HUDDLE BANNER
// ============================================
// Checks Firestore for a Huddle PDF uploaded for today's date.
// If one exists, reveals the banner and wires up the open button.
// Degrades silently — banner stays hidden if Firestore is unavailable.
(async function initHuddleButton() {
    const btn = document.getElementById('huddleBtn');
    if (!btn) return;
    try {
        const huddle = await getLatestHuddle();
        if (huddle) {
            btn.addEventListener('click', () => window.open(huddle.storageUrl, '_blank', 'noopener'));
        } else {
            // No huddle uploaded yet — keep button visible but disabled
            btn.disabled = true;
        }
    } catch (err) {
        // Silently degrade — disable the button rather than hiding it
        btn.disabled = true;
        console.warn('[Huddle] Could not fetch latest huddle:', err);
    }
})();
