'use strict';

/**
 * functions/overtime-core.js — every RULE the Overtime feature has, and no I/O at all.
 *
 * No Firebase, no HTTP, no secrets, no clock of its own (every function that needs "now" is given
 * it). Imported by functions/overtime.js, which supplies the boundaries. Tested exhaustively by
 * overtime-core.test.mjs, because almost everything here is either a money-shaped fact (a deadline)
 * or a privacy-shaped fact (who was asked).
 *
 * ── WHAT THIS MODULE IS PROTECTING ──────────────────────────────────────────────────────────────
 *
 * 1. THE LONDON CLOCK. `londonNoonTimestamp` decides whether a submission was in time. Every
 *    deadline, phase and historical derivation stands on it, this repo has no date library and no
 *    build step, and the failure mode is silent and exactly one hour wide. It is the first thing in
 *    the file for that reason. Read its header before touching it.
 *
 * 2. FROZEN MILESTONES. `deriveMilestones` is called ONCE, at window creation, and its output is
 *    stored. Readers use the stored values. If the offsets below ever change, a 2026 window must
 *    keep the deadlines it actually ran under — which is why `POLICY_VERSION` is stamped alongside
 *    them, and why nothing here ever recomputes an existing window's dates.
 *
 * 3. WHO WAS ASKED. `selectParticipants` runs once, at creation, and its output is frozen. Response
 *    rates are only meaningful because of that: somebody who joined in October must never appear as
 *    a non-responder for August. Eligibility is the roster's own `!hidden && !managerOnly`, read
 *    from the generated server list — never a name comparison, and never the client's word. It
 *    binds every audience, so no audience can put a MANAGER in a population.
 *
 * 4. NO SILENT OVERWRITE. `decideSubmission` is the whole concurrency model — a declaration about
 *    somebody's own life must never be quietly replaced.
 *
 * 5. NO RESPONSE IS NOT UNAVAILABLE. Nothing in this module ever manufactures an answer. An absent
 *    submission is absent; `normaliseDays` refuses a partial week rather than filling the gaps.
 */

// ── The clock this module stands on ─────────────────────────────────────────────────────────────
//
// london-clock.js requires nothing itself, so this module still loads with no functions/node_modules
// and overtime-core.test.mjs runs in test:hygiene on every branch. Keep it that way.
const {
    londonOffsetMinutes,
    londonTimestamp,
    londonIsoDate,
    isValidIsoDate,
    isoDayOfWeek,
    addDays,
} = require('./london-clock');

// ── Policy ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Stamped onto every window at creation. Bump ONLY when the offsets or the deadline clock time
 * below change — and when you do, historical windows keep their stored milestones and their old
 * `policyVersion`, which is the entire point of storing both.
 */
const POLICY_VERSION = 1;

/** Day offsets from the week-ending Saturday. Negative = before it. */
const MILESTONE_OFFSETS = Object.freeze({
    weekStart:        -6,   // Sunday
    initialDeadline: -18,   // Tuesday, 12:00 London
    draftRoster:     -16,   // Thursday
    finalDeadline:   -11,   // Tuesday, 12:00 London
    finalRoster:      -9,   // Thursday
    retention:        91,   // 13 weeks after the week-ending Saturday
});

/** The local hour at which an availability deadline falls. */
const DEADLINE_HOUR_LONDON = 12;

/**
 * The local hour the daily create-the-missing-weeks job runs at.
 *
 * ⚠️ This must equal the hour in `autoCreateOvertimeWindows`'s cron (`'0 5 * * *'`, Europe/London):
 * the horizon needs to know when the job LAST ran to say whether a week is overdue. 05:00 exists
 * exactly once on every date of the year (the UK changes clocks at 01:00–02:00).
 */
const SCHEDULER_HOUR_LONDON = 5;

/**
 * How far ahead staff are asked to declare availability, counted in weeks they can ANSWER for.
 *
 * THIS IS THE PRODUCT DECISION; `PLANNING_WEEKS` BELOW IS ARITHMETIC. **Three (owner, Aug 2026 —
 * was six):** a declaration seven weeks out is far likelier to change, and the roster cycles for a
 * week finish well inside three. Raising it again is this one number. Everything else derives.
 */
const ANSWERABLE_WEEKS = 3;

/**
 * How many week rows the planning horizon covers, starting at THIS week's Saturday.
 *
 * WHY THE REQUIREMENT PLUS TWO: a window closes 11 days before its Saturday, so row 1 (this week)
 * is never answerable and row 2 only until this Tuesday 12:00. The FLOOR — the count just after
 * Tuesday noon — is rows minus two, asserted over a whole week in `overtime-core.test.mjs`: change
 * the milestone offsets and that test fails. Both rows are still SHOWN — a row past its deadline
 * unanswered is exactly what a reviewer needs to see.
 */
const PLANNING_WEEKS = ANSWERABLE_WEEKS + 2;

/**
 * A Firestore batched write caps at 500 operations, and window creation is 1 parent + N
 * participants in ONE batch (partial creation would leave a window whose frozen population is a
 * lie). Far above the current roster, but the guard fails loudly rather than silently splitting.
 */
const MAX_PARTICIPANTS_PER_WINDOW = 499;

// ── The hours this feature keeps ────────────────────────────────────────────────────────────────
//
// The timezone bridge itself lives in london-clock.js. What stays here is the CHOICE of hour:
// noon for a deadline, midnight for retention, 05:00 for the scheduler. Each is policy.

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The instant of 12:00 Europe/London on `isoDate` — the availability deadline clock. @param {string} isoDate @returns {number} */
function londonNoonTimestamp(isoDate) {
    return londonTimestamp(isoDate, DEADLINE_HOUR_LONDON);
}

/**
 * The most recent daily-scheduler boundary at or before `nowMs`.
 *
 * The horizon says a missing week "opens automatically overnight", which stays true only while the
 * overnight run works. Comparing what the run at THIS instant was due to create against what exists
 * turns a silent scheduler failure into a visible one, with no new stored state.
 *
 * The previous day is reached with `addDays` on the CALENDAR date, never by subtracting 24 hours:
 * on a clock-change day the two differ by an hour.
 * @param {number} nowMs
 * @returns {number} epoch ms
 */
function lastSchedulerRun(nowMs) {
    const today = londonIsoDate(nowMs);
    const todayRun = londonTimestamp(today, SCHEDULER_HOUR_LONDON);
    if (todayRun <= nowMs) return todayRun;
    return londonTimestamp(addDays(today, -1), SCHEDULER_HOUR_LONDON);
}

/** The instant of 00:00 Europe/London on `isoDate` — used as the retention expiry boundary. @param {string} isoDate @returns {number} */
function londonMidnightTimestamp(isoDate) {
    return londonTimestamp(isoDate, 0);
}

// ── Calendar helpers (pure date arithmetic, no timezone) ────────────────────────────────────────

/** True when the ISO date is a Saturday — the only legal week-ending. @param {unknown} isoDate @returns {boolean} */
function isSaturday(isoDate) {
    return typeof isoDate === 'string' && isValidIsoDate(isoDate) && isoDayOfWeek(isoDate) === 6;
}

/** The seven Sunday→Saturday ISO dates of the roster week starting `weekStart`. @param {string} weekStart @returns {string[]} */
function weekDates(weekStart) {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** The week-ending Saturday of the Sunday–Saturday week containing `isoDate` (itself, if Saturday). @param {string} isoDate @returns {string} */
function weekEndingFor(isoDate) {
    return addDays(isoDate, 6 - isoDayOfWeek(isoDate));
}

// ── Milestones ──────────────────────────────────────────────────────────────────────────────────

/**
 * The full frozen timetable for a week-ending Saturday.
 *
 * Called once, at creation. The result is STORED and every later reader uses the stored values —
 * see the module header, point 2. Deadlines are instants (epoch ms); roster dates are calendar
 * dates, because "the draft roster comes out on Thursday" has no clock time.
 * @param {string} weekEnding a Saturday, "YYYY-MM-DD"
 */
function deriveMilestones(weekEnding) {
    const o = MILESTONE_OFFSETS;
    return {
        weekEnding,
        weekStart:        addDays(weekEnding, o.weekStart),
        initialDeadlineAt: londonNoonTimestamp(addDays(weekEnding, o.initialDeadline)),
        draftRosterDate:  addDays(weekEnding, o.draftRoster),
        finalDeadlineAt:  londonNoonTimestamp(addDays(weekEnding, o.finalDeadline)),
        finalRosterDate:  addDays(weekEnding, o.finalRoster),
        retentionUntil:   londonMidnightTimestamp(addDays(weekEnding, o.retention)),
        policyVersion:    POLICY_VERSION,
    };
}

/** A window's STORED milestones as plain numbers — how every reader gets an existing window's
 *  timetable, never `deriveMilestones` (point 2 above; invariant 7). @param {any} data */
function storedMilestones(data) {
    return {
        weekEnding:        data.weekEnding,
        weekStart:         data.weekStart,
        initialDeadlineAt: toMillis(data.initialDeadlineAt),
        draftRosterDate:   data.draftRosterDate,
        finalDeadlineAt:   toMillis(data.finalDeadlineAt),
        finalRosterDate:   data.finalRosterDate,
        retentionUntil:    toMillis(data.retentionUntil),
        policyVersion:     data.policyVersion,
    };
}

/** A stored instant (a Timestamp, epoch ms or a Date) as epoch ms, else 0 — read through its
 *  `toMillis`, so this module still needs no Firebase. @param {any} v @returns {number} */
function toMillis(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return v;
    if (typeof v.toMillis === 'function') return v.toMillis();
    return v instanceof Date ? v.getTime() : 0;
}

/** @typedef {'INITIAL_OPEN'|'FINAL_OPEN'|'CLOSED'} Phase */

/**
 * Which of the three phases a window is in at `nowMs`.
 *
 * The boundary is `>=`, deliberately and in both places: a request that arrives at exactly 12:00:00
 * belongs to the LATER phase. Half-open intervals are the only way three phases can tile time with
 * no instant belonging to two of them or to none.
 * @param {{initialDeadlineAt:number, finalDeadlineAt:number}} milestones
 * @param {number} nowMs
 * @returns {Phase}
 */
function phaseFor(milestones, nowMs) {
    if (nowMs >= milestones.finalDeadlineAt) return 'CLOSED';
    if (nowMs >= milestones.initialDeadlineAt) return 'FINAL_OPEN';
    return 'INITIAL_OPEN';
}

/** True when the window may still accept a submission or amendment. @param {string} phase @returns {boolean} */
function isOpenPhase(phase) {
    return phase === 'INITIAL_OPEN' || phase === 'FINAL_OPEN';
}

/**
 * May a participant be withdrawn from — or restored to — this week, right now?
 *
 * WHY WITHDRAWAL EXISTS: the frozen population means a member who LEAVES stays in every open week
 * as a permanent non-responder. Withdrawal stops the person being EXPECTED; nothing is deleted, and
 * the page states who was withdrawn and by whom — an exclusion nobody can see is worse.
 *
 * WHY A CLOSED WEEK REFUSES IT: a closed week is a RECORD of what was known when the roster was
 * planned; editing it afterwards would tidy a historical response rate. Expired weeks are refused too.
 *
 * @param {{initialDeadlineAt:number, finalDeadlineAt:number, retentionUntil:number}} milestones
 * @param {number} nowMs
 * @returns {{ ok:boolean, error?:string }} `error` is a stable machine code, not display copy
 */
function canChangeParticipation(milestones, nowMs) {
    if (!milestones) return { ok: false, error: 'no-window' };
    if (milestones.retentionUntil <= nowMs) return { ok: false, error: 'expired' };
    if (!isOpenPhase(phaseFor(milestones, nowMs))) return { ok: false, error: 'closed' };
    return { ok: true };
}

/**
 * May this withdrawal be UNDONE? Restoring is not the mirror of withdrawing.
 *
 * Withdrawn BEFORE the initial deadline and restored after it, a member would be marked **submitted
 * after initial deadline** for a deadline they were never asked about. So this follows the rule
 * `addMissingParticipants` already keeps (no new participant after the initial deadline). A
 * withdrawal made AFTER the initial deadline is an ordinary undo and claims nothing false.
 *
 * AN UNREADABLE STAMP REFUSES: without `withdrawnAt` we cannot tell which side of the deadline it
 * fell; refusing blocks an undo (visible), allowing re-creates the false "late" marker.
 *
 * @param {{initialDeadlineAt:number, finalDeadlineAt:number, retentionUntil:number}} milestones
 * @param {number|null|undefined} withdrawnAtMs when they were stood down, epoch ms
 * @param {number} nowMs
 * @returns {{ ok:boolean, error?:string }} `error` is a stable machine code, not display copy
 */
function canRestoreParticipant(milestones, withdrawnAtMs, nowMs) {
    const base = canChangeParticipation(milestones, nowMs);
    if (!base.ok) return base;
    // Before the initial deadline nothing has been decided yet, so a restore claims nothing.
    if (nowMs <= milestones.initialDeadlineAt) return { ok: true };
    if (!Number.isFinite(withdrawnAtMs)) return { ok: false, error: 'restore-window-passed' };
    return /** @type {number} */ (withdrawnAtMs) > milestones.initialDeadlineAt
        ? { ok: true }
        : { ok: false, error: 'restore-window-passed' };
}

/**
 * Is this frozen participant record withdrawn?
 *
 * A BOOLEAN field set only on withdrawal, never written `false` at creation: Firestore's `==`/`!=`
 * skip documents missing the field, so a default-false would hide every older participant from the
 * count query. Counting the withdrawn and subtracting is correct for old and new documents alike.
 *
 * ⚠️ The reviewer's browser reads participants DIRECTLY from Firestore, so this rule also exists in
 * `overtime-format.js`. Keep them the same shape.
 * @param {any} participant
 */
function isWithdrawn(participant) {
    return !!participant && participant.withdrawn === true;
}

/**
 * May a window be created for this week-ending, right now?
 *
 * @param {string} weekEnding
 * @param {{ nowMs:number, maxRosterYear:number }} ctx
 * @returns {{ ok:boolean, error?:string }} `error` is a stable machine code, not display copy
 */
function validateWeekEnding(weekEnding, { nowMs, maxRosterYear }) {
    if (!isValidIsoDate(weekEnding)) return { ok: false, error: 'invalid-date' };
    if (!isSaturday(weekEnding))     return { ok: false, error: 'not-saturday' };
    if (Number(weekEnding.slice(0, 4)) > maxRosterYear) return { ok: false, error: 'beyond-horizon' };
    // Creating a window whose final deadline has gone would produce a form nobody could ever submit
    // to — an empty week that looks like apathy rather than a mistake.
    if (nowMs >= deriveMilestones(weekEnding).finalDeadlineAt) return { ok: false, error: 'final-deadline-passed' };
    return { ok: true };
}

/**
 * The Manager planning horizon: `PLANNING_WEEKS` week-ending Saturdays, starting with this week's.
 *
 * Every row appears whether or not a window exists — this list is the ONLY guard against the
 * feature's one catastrophic silent failure, a week nobody created, which otherwise looks exactly
 * like "no overtime needed".
 * @param {number} nowMs
 * @returns {string[]} week-ending Saturdays, ascending
 */
function planningWeekEndings(nowMs) {
    const first = weekEndingFor(londonIsoDate(nowMs));
    return Array.from({ length: PLANNING_WEEKS }, (_, i) => addDays(first, i * 7));
}

/**
 * Which horizon weeks have no window yet AND could still legitimately be created.
 *
 * The scheduler's whole decision, as a pure function of the clock and the week ids that exist.
 *
 * IT IS THE `canCreate` RULE, NOT A SECOND ONE: exactly the filter behind the Manager's Create
 * button (same horizon, same `validateWeekEnding`), or the two would disagree and a week could be
 * silently created by neither. A week past its INITIAL deadline but not its FINAL is still returned —
 * a late form beats no form.
 *
 * @param {number} nowMs
 * @param {Iterable<string>} existingWeekEndings week ids already in Firestore
 * @param {{ maxRosterYear: number }} ctx
 * @returns {string[]} week-ending Saturdays to create, ascending
 */
function weeksNeedingWindows(nowMs, existingWeekEndings, { maxRosterYear }) {
    const have = new Set(existingWeekEndings || []);
    return planningWeekEndings(nowMs)
        .filter(w => !have.has(w))
        .filter(w => validateWeekEnding(w, { nowMs, maxRosterYear }).ok);
}

/**
 * What the Manager row for one planning week should say.
 *
 * `missed` deliberately persists until the week-ending Saturday has passed rather than vanishing at
 * the deadline: a row that disappears the moment it becomes un-actionable hides the very omission
 * this horizon exists to surface.
 *
 * A CREATED WINDOW IS NOT AUTOMATICALLY AN OPEN ONE: the first row is always a week already closed
 * (`created-closed`). The phase is decided HERE, from the stored milestones and the server's clock,
 * never a phone's.
 *
 * A WEEK THAT WILL OPEN IS NOT ONE THAT ALREADY SHOULD HAVE: once a run has passed without creating
 * a week it was due to, `not-created`'s reassurance becomes the scheduler's alibi. `autoOverdue` is
 * that distinction; the caller decides it (see `lastSchedulerRun`).
 *
 * A week ending after the roster's last year can never be created (`beyond-horizon`), so
 * `beyondRoster` gives it its own state at every phase — its cause, a CONFIG year nobody raised.
 *
 * @param {{ initialDeadlineAt: number, finalDeadlineAt: number }} milestones  the week's (`milestonesFor`)
 * @param {number} nowMs
 * @param {boolean} exists
 * @param {boolean} [autoOverdue] true when the last scheduled run was due to create this week and
 *   did not. Ignored unless the week is missing and still inside its initial deadline — past that
 *   the row is already reporting something worse.
 * @param {boolean} [beyondRoster] true when the week ends after the roster's last year
 * @returns {'created'|'created-closed'|'not-created'|'not-created-overdue'|'not-created-initial-passed'|'missed'|'not-created-beyond-roster'}
 */
function windowRowState(milestones, nowMs, exists, autoOverdue = false, beyondRoster = false) {
    if (exists) return nowMs >= milestones.finalDeadlineAt ? 'created-closed' : 'created';
    if (beyondRoster) return 'not-created-beyond-roster';
    if (nowMs < milestones.initialDeadlineAt) return autoOverdue ? 'not-created-overdue' : 'not-created';
    if (nowMs < milestones.finalDeadlineAt)   return 'not-created-initial-passed';
    return 'missed';
}

// ── Participants ────────────────────────────────────────────────────────────────────────────────

/** A member of the GENERATED Overtime roster (`overtimeRoster`). @typedef {{name:string,grade?:string,rosterOrder?:number,startDate?:string|null,hidden?:boolean,managerOnly?:boolean}} OvertimeRosterRow */
/** Window audience labels. Provenance and selector choice — NEVER an authorisation input. */
const AUDIENCES = Object.freeze(['restricted', 'all']);

/**
 * Is this generated member a participant for a week starting `weekStart`?
 *
 * The start-date rule is a deliberate PRODUCT decision: somebody starting mid-week is excluded from
 * that whole Sunday–Saturday window and first appears in the next one. Every participant answers all
 * seven days; a part week would leak into counts, reminders and the seven-day schema everywhere.
 * @param {{ name?: unknown, startDate?: string|null }|null|undefined} member  a generated roster row
 * @param {string} weekStart @returns {boolean}
 */
function isEligibleForWeek(member, weekStart) {
    if (!member || typeof member.name !== 'string' || !member.name) return false;
    return !member.startDate || member.startDate <= weekStart;
}

/**
 * Freeze the participant population for a window.
 *
 * `roster` is the GENERATED server list (`overtimeRoster`) — WHO EXISTS, carrying each member's
 * `hidden` and `managerOnly` flags. It is never a client payload.
 *
 * TWO STAGES, AND THE ORDER IS THE POINT.
 *
 * Stage 1 — WHO COULD EVER BE ASKED. The roster's own flags: on this week (`startDate`), still here
 * (`!hidden`), and not a manager (`!managerOnly`). This binds EVERY audience, including ones not
 * written yet.
 *
 * Stage 2 — which of them THIS audience asks:
 *
 *   restricted   the admin, plus any ordinary member named in the beta list — a TESTING population
 *                that widens a name at a time, by invitation.
 *   all          everybody stage 1 allows. The end state.
 *
 * A beta member is a PARTICIPANT and nothing else. Reviewing is the `admin`/`manager` claim, and
 * these two lists must not be allowed to converge: letting this one also decide who can LOOK would
 * hand a colleague's declarations to whoever was invited to test.
 *
 * A MANAGER IS A REVIEWER AND NEVER A PARTICIPANT — which is why the flag test is stage 1, not a
 * clause in each branch (the restricted branch selects by ENTITLEMENT, so a manager holding the admin
 * entitlement would otherwise slip through). A manager already sees every answer by claim; in the
 * frozen population they would read as a non-responder permanently. Tested against every audience
 * in `AUDIENCES`.
 *
 * Widening the beta is a one-word edit — `currentAudience()`.
 *
 * @param {OvertimeRosterRow[]} roster
 * @param {{ weekStart:string, audience:string, adminNames?:string[], betaNames?:string[] }} ctx
 * @returns {Array<{memberName:string, grade:string, rosterOrder:number}>}
 */
function selectParticipants(roster, { weekStart, audience, adminNames = [], betaNames = [] }) {
    const eligible = (roster || [])
        .filter(m => isEligibleForWeek(m, weekStart))
        .filter(m => !m.hidden && !m.managerOnly);
    const chosen = audience === 'restricted'
        // Both lists come from the server-owned generated roster, never from a name written here —
        // so inviting somebody is one edit in CONFIG plus a regenerate, and this code never moves.
        ? eligible.filter(m => adminNames.includes(m.name) || betaNames.includes(m.name))
        : eligible;
    return chosen
        .map(m => ({
            memberName:  m.name,
            grade:       m.grade || '',
            rosterOrder: typeof m.rosterOrder === 'number' && Number.isInteger(m.rosterOrder) ? m.rosterOrder : 0,
        }))
        .sort((a, b) => a.rosterOrder - b.rosterOrder || a.memberName.localeCompare(b.memberName));
}

/**
 * Is `name` safe as a Firestore document path segment?
 *
 * Participant and submission documents are keyed by member name, so a name that cannot be a path
 * segment would corrupt a write. Applied to GENERATED data, in CI — an unusual name must break the
 * build, not production. Firestore's rules: non-empty, no '/', not '.' or '..', no __reserved__ form,
 * at most 1500 bytes. @param {unknown} name @returns {boolean}
 */
function isSafeDocId(name) {
    if (typeof name !== 'string' || name.length === 0) return false;
    if (name.includes('/')) return false;
    if (name === '.' || name === '..') return false;
    if (/^__.*__$/.test(name)) return false;
    return Buffer.byteLength(name, 'utf8') <= 1500;
}

// ── Availability schema ─────────────────────────────────────────────────────────────────────────

/**
 * The stored shape of one day's answer. This is SCHEMA — it is written into immutable revisions
 * from the first beta release, so it is a contract, not a suggestion.
 *
 * Every mode stores CONCRETE clock boundaries. "Available after my shift" is never stored as a
 * reference to the roster: the roster can change afterwards, and a member's declaration must remain
 * what they actually said rather than silently re-pointing at a different time.
 */
/** Each mode and the fields it takes. @type {Readonly<Record<string, readonly string[]>>} */
const AVAILABILITY_MODES = Object.freeze({
    unavailable:  Object.freeze([]),
    all_day:      Object.freeze([]),
    // LEGACY: still PARSED for ever; no longer OFFERED by any client. "Up to 12 hours" said HOW LONG
    // where every other mode says WHEN, so the owner split the dimensions: it became `fullTwelve`.
    // IT MUST STAY IN THIS TABLE: revisions are immutable, so answers stored under it must keep
    // parsing and rendering until they expire.
    twelve_hours: Object.freeze([]),
    before:       Object.freeze(['until']),
    after:        Object.freeze(['from']),
    before_after: Object.freeze(['until', 'from']),
    custom:       Object.freeze(['start', 'end', 'nextDay']),
});

/**
 * The one field that may accompany ANY available answer (owner — the availability / willingness
 * split).
 *
 * A FIELD, NOT A MODE: "when can you work" and "how long a day would you work" are independent, so
 * they cannot share one exclusive control. "UP TO", deliberately: beside a window it grants
 * PERMISSION to build a long duty rather than committing to a 12-hour turn.
 *
 * STORED ONLY WHEN TRUE: an unticked box is the ABSENCE of a declaration, not a declared "no", so
 * older answers stay comparable and no historical answer acquires an opinion it never gave.
 *
 * It is refused on `unavailable`, which is the one mode it cannot mean anything beside.
 */
const OPTIONAL_DAY_FIELDS = Object.freeze(['fullTwelve']);

/**
 * ASK TO BE TAKEN OFF A ROSTERED SUNDAY (owner) — the one field that may accompany ANY answer,
 * including `unavailable`.
 *
 * Every other field is about OVERTIME; this one is about CONTRACTED work — a rostered Sunday the
 * member would like to be released from. The two are independent, so it is a field beside the
 * answer, not a mode.
 *
 * **It is a REQUEST and nothing more** (OVERTIME_AVAILABILITY.md invariant 14). It changes no roster,
 * writes no override, and consumes no annual leave; Sundays stay uncontracted for leave
 * (`SUNDAY_FORBIDDEN_TYPES`, override-utils.js). The roster team decides. The owner chose this over
 * inventing a new kind of absence: the member ASKS through the form they already fill in that week.
 *
 * ALLOWED ON EVERY MODE, UNLIKE `fullTwelve`: a member unavailable all week is exactly somebody who
 * may need to come off a Sunday. STORED ONLY WHEN TRUE, for the same reason as `fullTwelve`.
 */
const REQUEST_DAY_FIELDS = Object.freeze(['releaseRequested']);

/** @param {any} raw  a day of the client's JSON, which this validates @returns {{ok:true, day:Record<string, unknown>}|{ok:false, error:string}} */
function normaliseDay(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'day-not-object' };
    const mode = raw.mode;
    if (!Object.prototype.hasOwnProperty.call(AVAILABILITY_MODES, mode)) return { ok: false, error: 'bad-mode' };

    const fields = AVAILABILITY_MODES[mode];
    // Reject unknown keys rather than dropping them: a client sending a field this server does not
    // know about is a version mismatch, and silently discarding it would store an answer the member
    // did not give.
    const optional = mode === 'unavailable' ? [] : OPTIONAL_DAY_FIELDS;
    // `REQUEST_DAY_FIELDS` is allowed on every mode — see its own block for why it is not `optional`.
    const allowed = [...optional, ...REQUEST_DAY_FIELDS];
    const extra = Object.keys(raw).filter(k => k !== 'mode' && !fields.includes(k) && !allowed.includes(k));
    if (extra.length) return { ok: false, error: 'unknown-field' };

    /** @type {Record<string, any>} */
    const day = { mode };

    // The willingness flag. Type-checked like everything else, and written ONLY when true — see
    // OPTIONAL_DAY_FIELDS for why the false case is an absence rather than a stored opinion.
    if (raw.fullTwelve !== undefined) {
        if (typeof raw.fullTwelve !== 'boolean') return { ok: false, error: 'bad-full-twelve' };
        if (raw.fullTwelve) day.fullTwelve = true;
    }

    // The Sunday release request. Written only when true, and NOT validated against the roster — the
    // server has none, and a request is a fact about what was asked. See REQUEST_DAY_FIELDS.
    if (raw.releaseRequested !== undefined) {
        if (typeof raw.releaseRequested !== 'boolean') return { ok: false, error: 'bad-release-requested' };
        if (raw.releaseRequested) day.releaseRequested = true;
    }
    for (const f of fields) {
        const v = raw[f];
        if (f === 'nextDay') {
            if (typeof v !== 'boolean') return { ok: false, error: 'bad-next-day' };
            day[f] = v;
        } else {
            if (typeof v !== 'string' || !HHMM_RE.test(v)) return { ok: false, error: 'bad-time' };
            day[f] = v;
        }
    }

    if (mode === 'before_after' && day.until > day.from) {
        // "Available before 15:00 and after 07:00" covers the whole day twice over; it is a
        // transposed pair, not an answer, and storing it would show a nonsense range to the clerk.
        return { ok: false, error: 'before-after-inverted' };
    }
    if (mode === 'custom') {
        if (day.start === day.end) return { ok: false, error: 'custom-zero-length' };
        // `nextDay` is a fact about the two times given, not trusted from the client — 18:00–23:00
        // flagged overnight would read as a 29-hour window.
        if (day.nextDay !== (day.end < day.start)) return { ok: false, error: 'next-day-mismatch' };
    }
    return { ok: true, day };
}

/**
 * Validate and canonicalise a whole week's answers.
 *
 * Exactly the seven dates of the window, no more and no fewer. A partial week is REFUSED rather
 * than completed — an unanswered day is unknown, and the one thing this feature must never do is
 * invent an answer on somebody's behalf (invariant: no response is not "unavailable").
 *
 * @param {any} days
 * @param {string[]} expectedDates the window's seven Sunday→Saturday dates
 * @returns {{ok:true, days:object}|{ok:false, error:string, date?:string}}
 */
function normaliseDays(days, expectedDates) {
    if (!days || typeof days !== 'object' || Array.isArray(days)) return { ok: false, error: 'days-not-object' };
    const got = Object.keys(days);
    if (got.length !== expectedDates.length) return { ok: false, error: 'wrong-day-count' };
    /** @type {Record<string, any>} */
    const out = {};
    for (const date of expectedDates) {                 // iterate the EXPECTED order → canonical output
        if (!Object.prototype.hasOwnProperty.call(days, date)) return { ok: false, error: 'missing-day', date };
        const r = normaliseDay(days[date]);
        if (!r.ok) return { ok: false, error: r.error, date };
        // The release request is about a SUNDAY duty and nothing else. The server checks the
        // calendar, never the roster: a request on any other date is a client it does not recognise,
        // and would put "Asked to come off this Sunday" under a Monday on the reviewer's screen.
        if (r.day.releaseRequested === true && isoDayOfWeek(date) !== 0) {
            return { ok: false, error: 'release-not-sunday', date };
        }
        out[date] = r.day;
    }
    return { ok: true, days: out };
}

/**
 * Semantic equality of two normalised weeks. Both sides come from `normaliseDays`, so key order is
 * already canonical and a stable stringify is a true comparison rather than an approximation.
 * @param {unknown} a @param {unknown} b @returns {boolean}
 */
function daysEqual(a, b) {
    return stableStringify(a) === stableStringify(b);
}

/** JSON with every object's keys sorted. @param {unknown} v @returns {string} */
function stableStringify(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
    // A plain object here (the two checks above); the checker cannot index `object`, so it is named as one.
    const o = /** @type {Record<string, unknown>} */ (v);
    return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}

// ── Revisions and concurrency ───────────────────────────────────────────────────────────────────

/** Zero-padded revision document id, so the natural string order is the revision order. @param {number} n @returns {string} */
function revisionId(n) {
    return String(n).padStart(6, '0');
}

/**
 * What should a submit request DO? The whole concurrency model, as one pure decision.
 *
 * The three-way split matters because two of the outcomes look like failure and are not:
 *
 *   noop      the content already IS the stored content — a duplicate click or the retry after a
 *             timeout — so it succeeds EVEN WITH a stale `ifRevision`; refusing would report a
 *             saved, correct answer as rejected.
 *   conflict  the content differs AND the caller's baseline is stale. Never last-write-wins: the
 *             loser of a silent race believes they submitted.
 *   append    the ordinary genuine amendment.
 *
 * @param {{currentRevision:number, days:object}|null} head
 * @param {object} incomingDays already through `normaliseDays`
 * @param {number} ifRevision   0 for a first submission
 * @returns {{action:'create'|'append'|'noop', revision:number} | {action:'conflict', expected:number}}
 */
function decideSubmission(head, incomingDays, ifRevision) {
    if (!head) {
        // No submission yet. A caller claiming a baseline is running against state that does not
        // exist — most likely their submission was deleted, or they are pointed at another window.
        if (ifRevision !== 0) return { action: 'conflict', expected: 0 };
        return { action: 'create', revision: 1 };
    }
    if (daysEqual(head.days, incomingDays)) return { action: 'noop', revision: head.currentRevision };
    if (ifRevision !== head.currentRevision) return { action: 'conflict', expected: head.currentRevision };
    return { action: 'append', revision: head.currentRevision + 1 };
}

/** The submission head as its member may see it — their own content, nothing about anyone else.
 *  @param {any} data */
function publicHead(data) {
    return {
        currentRevision:   data.currentRevision,
        days:              data.days,
        firstAcceptedAt:   toMillis(data.firstAcceptedAt),
        updatedAt:         toMillis(data.updatedAt),
        lastMutationId:    data.lastMutationId || null,
        schemaVersion:     data.schemaVersion,
    };
}

/**
 * Everything the Manager needs to know about how a submission moved, derived from the immutable
 * revisions rather than stored as flags.
 *
 * `changedSinceInitial` compares the initial-cut-off state with the CURRENT state, so a member who
 * changed something and changed it back is not flagged — the current answer is the one that was
 * planned against. The revision list still proves the intermediate change if it is ever needed.
 *
 * A form that OPENED at or after the initial deadline (a week created late — a supported recovery)
 * has no initial boundary: nobody could answer before it existed, so nothing is late against it.
 *
 * @param {Array<{revision:number, days:object, acceptedAt:number}>} revisions
 * @param {object|null} headDays
 * @param {number} initialDeadlineAt
 * @param {number} [openedAt] when the window was created; 0/absent = unknown, and the rule applies
 */
function deriveHistory(revisions, headDays, initialDeadlineAt, openedAt = 0) {
    const sorted = [...(revisions || [])].sort((a, b) => a.revision - b.revision);
    const applies = !(openedAt >= initialDeadlineAt);
    const before = applies ? sorted.filter(r => r.acceptedAt < initialDeadlineAt) : [];
    const initialRevision = before.length ? before[before.length - 1] : null;
    const hasSubmission = sorted.length > 0;
    return {
        initialRevision,
        // A submission exists but nothing was accepted before the initial deadline — the clerk did
        // NOT have this person's availability when the draft was planned.
        lateInitial: applies && hasSubmission && !initialRevision,
        changedSinceInitial: !!(initialRevision && headDays && !daysEqual(initialRevision.days, headDays)),
        dayChangedAt: dayChangedAt(sorted),
    };
}

/**
 * When each individual DATE's answer last changed — the form's one `updatedAt` would report every
 * day as fresh when only one was edited. Derived from the append-only revisions rather than stored,
 * so it cannot disagree with the history it summarises.
 *
 * ⚠️ THE CLIENT HAS ITS OWN COPY, in `overtime-format.js` — the Manager view is the only thing that
 * renders this, and it cannot import a CommonJS module. `overtime-parity.test.mjs` compares the two
 * by behaviour.
 * @param {any[]} sortedRevisions revisions in ascending `revision` order
 * @returns {Record<string, number>} date → epoch ms
 */
function dayChangedAt(sortedRevisions) {
    /** @type {Record<string, number>} */
    const changedAt = {};
    /** @type {Record<string, string>} */
    const seen = {};
    for (const r of sortedRevisions) {
        const days = r && r.days;
        if (!days || typeof days !== 'object') continue;
        for (const date of Object.keys(days)) {
            const shape = JSON.stringify(stableKeyOrder(days[date]));
            if (seen[date] === shape) continue;
            seen[date] = shape;
            changedAt[date] = r.acceptedAt;
        }
    }
    return changedAt;
}

/**
 * A value with every object's keys sorted, so `JSON.stringify` becomes an order-independent
 * comparison — the CommonJS counterpart of the client's `stableStringify`.
 * @param {any} v @returns {unknown}
 */
function stableKeyOrder(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(stableKeyOrder);
    /** @type {Record<string, any>} */
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = stableKeyOrder(v[k]);
    return out;
}

// ── Push notices ────────────────────────────────────────────────────────────────────────────────
//
// Without a nudge, a member who did not open the app that week becomes a permanent "No response".
// These are the WORDS and the WHEN; the sending (uids, subscriptions, the targeted-only rule) lives
// in functions/overtime.js and push.js. Pure, so the boundaries are testable in test:hygiene.

/**
 * How far ahead of the initial deadline the reminder fires.
 *
 * The daily run is 05:00 London and the deadline is 12:00 London, so a 24-hour lookahead selects
 * exactly ONE run — the deadline's own morning. A window keeps the rule pure: no timezone read.
 */
const REMINDER_LOOKAHEAD_MS = 24 * 60 * 60 * 1000;

/**
 * Should THIS window's initial-deadline reminder go out now?
 *
 * `reminderSentAtMs` is the idempotency stamp (0 when never claimed): the scheduler CLAIMS it in a
 * transaction before it sends (functions/overtime.js) — written after, two overlapping runs would
 * both read "unsent" and both send — so a re-run the same morning sends nothing. Once the deadline
 * passes the phase moves and this is false for ever: the stamp only has to protect the one morning.
 *
 * @param {{ initialDeadlineAt: number, retentionUntil: number, weekStart: string,
 *           finalDeadlineAt: number }} milestones
 * @param {number} reminderSentAtMs
 * @param {number} nowMs
 * @returns {boolean}
 */
function reminderDue(milestones, reminderSentAtMs, nowMs) {
    if (reminderSentAtMs > 0) return false;
    if (milestones.retentionUntil <= nowMs) return false;
    if (phaseFor(milestones, nowMs) !== 'INITIAL_OPEN') return false;
    return (milestones.initialDeadlineAt - nowMs) <= REMINDER_LOOKAHEAD_MS;
}

/**
 * A deadline as staff-facing words, in LONDON time — "Tue 18 Aug · 12:00".
 *
 * The client's `deadlineLabel` (overtime-phase.js) formats in London time too, so a page and a push
 * name the same deadline; this is the server's own copy because functions/ cannot import a browser
 * module. A push is composed on a server in UTC, so London is stated, never the server's clock.
 * @param {number} ms @returns {string}
 */
function londonDeadlineLabel(ms) {
    const d = new Date(ms);
    // The MONTH from our own list, never Intl's short month: Node's en-GB data spells September
    // "Sept", where the client says "Sep".
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'numeric',
    }).formatToParts(d).map(p => [p.type, p.value]));
    const time = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(d);
    return `${parts.weekday} ${Number(parts.day)} ${MONTH_ABB_EN[Number(parts.month) - 1]} · ${time}`;
}

/**
 * The "you have been asked" notice — sent when a member joins a window's population, whether at
 * creation or by the nightly top-up. Event grammar (headline — urgency; body carries the action),
 * calm register, inside the design language's budgets (title ≤ ~40 with the emoji, body ≤ ~80) so
 * `buildPushPayload` never has to clip it — asserted in overtime-core.test.mjs, because a clipped
 * deadline is worse than none.
 *
 * ONE notice per member per run, however many weeks they were just added to — each send buzzes.
 * The body names the SOONEST deadline, which is the one that can be missed.
 *
 * THE DEADLINE NAMED MUST BE ONE THAT IS STILL AHEAD: a window created after its initial deadline
 * is supported, so past that deadline the body names the final one.
 *
 * @param {{ initialDeadlineAt: number, finalDeadlineAt: number }} soonest milestones of the
 *        earliest newly-asked week
 * @param {number} nowMs the server's clock at send time
 * @returns {{ headline: string, body: string }}
 */
function askedNotice(soonest, nowMs) {
    const deadline = (typeof nowMs === 'number' && nowMs >= soonest.initialDeadlineAt)
        ? soonest.finalDeadlineAt
        : soonest.initialDeadlineAt;
    return {
        headline: 'Overtime — availability form open',
        body: `Tell the roster team when you can work. Answer by ${londonDeadlineLabel(deadline)}.`,
    };
}

/**
 * The deadline-morning reminder — sent ONLY to participants with no submission at all. Somebody
 * who answered has nothing to be reminded of, and "you have not answered" to a person who has is
 * the kind of wrong this feature's record exists to prevent.
 * @param {{ weekEnding: string, initialDeadlineAt: number }} milestones
 * @returns {{ headline: string, body: string }}
 */
function reminderNotice(milestones) {
    // "12:00", from the same label the asked notice uses, so the two can never state different times.
    const time = londonDeadlineLabel(milestones.initialDeadlineAt).split('·')[1].trim();
    // The week-ending Saturday from the ISO parts directly — a doc id, not a moment in time, so no
    // Date and no timezone can shift it.
    const [, m, d] = milestones.weekEnding.split('-').map(Number);
    return {
        headline: 'Overtime — answers due today',
        // "DUE", NEVER "CLOSES": noon is the INITIAL deadline, after which the form is still open
        // (FINAL_OPEN). "Closes" would tell somebody who missed noon there is no point answering.
        // "Initial" carries the distinction inside the 80-character budget.
        body: `Initial answers for week ending Sat ${d} ${MONTH_ABB_EN[m - 1]} are due by ${time} today.`,
    };
}

/** en-GB short months for the reminder body — a Date-free render of an ISO doc id. */
const MONTH_ABB_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Is the retention purge armed to DELETE, or still only reporting what it would?
 *
 * A DATE (owner, 19 Sep 2026), and deliberately NOT 21 Nov, when the first window expires: arming
 * that morning would delete it before any run had ever logged it. Ten days later leaves ten daily
 * runs naming real windows and deleting nothing — the log the evidence gate always wanted.
 *
 * Fails CLOSED, and must be asked **per invocation, never at module load** — a warm instance
 * outlives the date. OVERTIME_AVAILABILITY.md → Retention has the rest.
 * @param {number} [nowMs] injected so this is testable without a clock
 * @returns {boolean}
 */
const PURGE_ARMS_AT = Date.UTC(2026, 11, 1);   // 1 Dec 2026 — ten days of real dry runs first
function purgeArmedAt(nowMs = Date.now()) {
    return Number.isFinite(nowMs) && nowMs >= PURGE_ARMS_AT;
}

module.exports = {
    // policy
    POLICY_VERSION,
    MILESTONE_OFFSETS,
    DEADLINE_HOUR_LONDON,
    SCHEDULER_HOUR_LONDON,
    lastSchedulerRun,
    ANSWERABLE_WEEKS,
    PLANNING_WEEKS,
    MAX_PARTICIPANTS_PER_WINDOW,
    AUDIENCES,
    AVAILABILITY_MODES,
    REQUEST_DAY_FIELDS,
    OPTIONAL_DAY_FIELDS,
    // clock — the first two and londonIsoDate are RE-EXPORTS of london-clock.js, and must stay
    // re-exports: re-DECLARING one here would leave two clocks in the process and nothing to say so.
    // `london-clock.test.mjs` asserts identity rather than presence, for exactly that reason.
    londonOffsetMinutes,
    londonTimestamp,        // exported for the DST-pathology tests, not for production callers
    londonNoonTimestamp,    // ours: noon is the deadline hour this depot chose
    londonMidnightTimestamp,// ours: the retention boundary
    londonIsoDate,
    // calendar — the first three are re-exports; the last three encode the Sunday→Saturday ROSTER
    // week, which is this railway's shape rather than the calendar's, and so stay here.
    isValidIsoDate,
    isoDayOfWeek,
    addDays,
    isSaturday,
    weekDates,
    weekEndingFor,
    // milestones + phases
    deriveMilestones,
    storedMilestones,
    toMillis,
    phaseFor,
    isOpenPhase,
    canChangeParticipation,
    canRestoreParticipant,
    isWithdrawn,
    validateWeekEnding,
    planningWeekEndings,
    weeksNeedingWindows,
    windowRowState,
    // participants
    isEligibleForWeek,
    selectParticipants,
    isSafeDocId,
    // availability
    normaliseDay,
    normaliseDays,
    daysEqual,
    // revisions
    revisionId,
    decideSubmission,
    publicHead,
    deriveHistory,
    // push notices
    REMINDER_LOOKAHEAD_MS,
    reminderDue,
    londonDeadlineLabel,
    askedNotice,
    reminderNotice,
    // retention
    PURGE_ARMS_AT,
    purgeArmedAt,
};
