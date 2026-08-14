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
 *    binds every audience, so no audience can put a MANAGER in a population: they review by claim,
 *    and a manager in the snapshot is a permanent non-responder for nothing gained.
 *
 * 4. NO SILENT OVERWRITE. `decideSubmission` is the whole concurrency model. `links-concurrency.js`
 *    exists because the same class of bug shipped three times in the Links workspace, each one a
 *    colleague's work quietly replaced. Availability is smaller but it is somebody's declaration
 *    about their own life, and losing it is worse, not better.
 *
 * 5. NO RESPONSE IS NOT UNAVAILABLE. Nothing in this module ever manufactures an answer. An absent
 *    submission is absent; `normaliseDays` refuses a partial week rather than filling the gaps.
 */

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
 * ⚠️ This must equal the hour in `autoCreateOvertimeWindows`'s cron (`'0 5 * * *'`, Europe/London).
 * It is declared here because the horizon needs to know when the job LAST ran in order to say
 * whether a week it should already have created is overdue — and a horizon that guesses that hour
 * would either accuse a healthy schedule or excuse a broken one.
 *
 * 05:00 is safe from both pathologies `londonTimestamp` warns about: the UK moves its clocks at
 * 01:00–02:00 local, so 05:00 exists exactly once on every date of the year.
 */
const SCHEDULER_HOUR_LONDON = 5;

/**
 * How far ahead staff are asked to declare availability, counted in weeks they can ANSWER for.
 *
 * ── THIS IS THE PRODUCT DECISION; `PLANNING_WEEKS` BELOW IS ARITHMETIC ──────────────────────────
 *
 * **Three (owner, Aug 2026 — was six).** Six was the original requirement and the code met it, but
 * it meant somebody in mid-August declaring for a weekend in early October. An external review put
 * the objection well: a declaration seven weeks out is far likelier to change than one three weeks
 * out, so the extra reach cost both response burden and data quality without buying planning value —
 * the draft and final roster cycles for a week are finished well inside three weeks.
 *
 * Raising it again is this one number. Everything else derives.
 */
const ANSWERABLE_WEEKS = 3;

/**
 * How many week rows the planning horizon covers, starting at THIS week's Saturday.
 *
 * ── WHY IT IS THE REQUIREMENT PLUS TWO ──────────────────────────────────────────────────────────
 *
 * The rows are NOT the answerable count, because the first two are always behind or about to fall
 * behind their own deadline. A window closes 11 days before its Saturday, so:
 *
 *   row 1 (this week's Saturday)  final deadline was LAST Tuesday  → never answerable
 *   row 2 (next Saturday)         final deadline is THIS Tuesday   → answerable until Tue 12:00
 *
 * So the FLOOR — the count at the worst hour of the week, just after Tuesday noon — is rows minus
 * two, and the floor is what a requirement has to mean if it is to be true on a Wednesday as well as
 * a Sunday. That relation was found by measurement, not derivation, and it is asserted as a property
 * over a whole week in `overtime-core.test.mjs`: change the milestone offsets and that test fails
 * rather than the horizon quietly costing a week.
 *
 * Both rows are still SHOWN. The horizon is the only thing standing between the feature and a week
 * nobody created, and a row that has gone past its deadline unanswered is exactly what a reviewer
 * needs to see.
 */
const PLANNING_WEEKS = ANSWERABLE_WEEKS + 2;

/**
 * A Firestore batched write caps at 500 operations, and window creation is 1 parent + N
 * participants in ONE batch (partial creation would leave a window whose frozen population is a
 * lie). Far above the current roster, but the guard fails loudly rather than silently splitting.
 */
const MAX_PARTICIPANTS_PER_WINDOW = 499;

// ── The London clock ────────────────────────────────────────────────────────────────────────────

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The UTC offset Europe/London was on at a given instant, in minutes east of UTC (+0 GMT, +60 BST).
 *
 * Derived from `Intl`, never from month arithmetic: the UK's transition dates are "last Sunday in
 * March/October", which is exactly the kind of rule that gets hand-coded slightly wrong and then
 * fails twice a year. Formatting the instant in London and reading it back as though it were UTC
 * gives the offset directly, and the runtime's own tz database stays the authority.
 * @param {number} utcMs
 * @returns {number} minutes
 */
function londonOffsetMinutes(utcMs) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(new Date(utcMs));
    /** @type {Record<string,number>} */
    const f = {};
    for (const p of parts) if (p.type !== 'literal') f[p.type] = Number(p.value);
    // `h23` should never yield 24, but a runtime that does would silently shift the day.
    const hour = f.hour === 24 ? 0 : f.hour;
    const asIfUtc = Date.UTC(f.year, f.month - 1, f.day, hour, f.minute, f.second);
    return Math.round((asIfUtc - utcMs) / 60000);
}

/**
 * The epoch-ms instant of `hour:00:00` Europe/London on an ISO calendar date.
 *
 * ── WHY TWO PASSES, HONESTLY ────────────────────────────────────────────────────────────────────
 * For the only two hours this module actually uses — 00:00 and 12:00 — ONE pass is already correct
 * everywhere, including on both transition days, and mutation-testing confirms it (removing the
 * second pass leaves every noon and midnight assertion green). The reason is arithmetic: the guess
 * is at most |offset| = 1h from the answer, and the UK moves its clocks at 01:00–02:00 local, so
 * neither the guess nor the answer straddles a transition at those hours.
 *
 * The second pass is here for the NEXT hour somebody uses. It diverges only where local time is
 * pathological — 01:00 on spring-forward, which does not exist — and there it resolves forward
 * (01:00 → 02:00 BST) instead of backwards into the previous day. That is the conventional
 * resolution and the one a reader expects. It is one extra `Intl` read, it is pinned by
 * `overtime-core.test.mjs`, and it is what stops a future deadline time from shipping an hour out.
 *
 * ⚠️ 00:00 and 12:00 are both safe from the two pathologies of local-time arithmetic. **If you add
 * a third hour, decide first** what a non-existent time (spring gap) and a doubled time (autumn
 * overlap) should mean for a DEADLINE — "which 01:30 was I supposed to submit by" is not a question
 * to answer at the keyboard.
 * @param {string} isoDate "YYYY-MM-DD"
 * @param {number} hour    0–23; in production only 0 or 12 — see above
 * @returns {number} epoch ms
 */
function londonTimestamp(isoDate, hour) {
    const [y, m, d] = isoDate.split('-').map(Number);
    const guess = Date.UTC(y, m - 1, d, hour, 0, 0);
    const firstPass = guess - londonOffsetMinutes(guess) * 60000;
    return guess - londonOffsetMinutes(firstPass) * 60000;
}

/** The instant of 12:00 Europe/London on `isoDate` — the availability deadline clock. */
function londonNoonTimestamp(isoDate) {
    return londonTimestamp(isoDate, DEADLINE_HOUR_LONDON);
}

/**
 * The most recent daily-scheduler boundary at or before `nowMs`.
 *
 * The whole of B6 rests on this one instant. The horizon tells a reviewer a missing week "opens
 * automatically overnight", which is true right up until the overnight run fails — after which the
 * row keeps saying it, indefinitely, and the reassurance becomes the fault. Comparing what the run
 * at THIS instant was due to create against what actually exists turns a silent scheduler failure
 * into a visible one, with no new stored state and nothing for the job itself to remember to write.
 *
 * The previous day is reached with `addDays` on the CALENDAR date, never by subtracting 24 hours:
 * on a transition day the two differ by an hour, and 04:00 or 06:00 on the wrong side of the
 * boundary would move the answer by a whole run.
 * @param {number} nowMs
 * @returns {number} epoch ms
 */
function lastSchedulerRun(nowMs) {
    const today = londonIsoDate(nowMs);
    const todayRun = londonTimestamp(today, SCHEDULER_HOUR_LONDON);
    if (todayRun <= nowMs) return todayRun;
    return londonTimestamp(addDays(today, -1), SCHEDULER_HOUR_LONDON);
}

/** The instant of 00:00 Europe/London on `isoDate` — used as the retention expiry boundary. */
function londonMidnightTimestamp(isoDate) {
    return londonTimestamp(isoDate, 0);
}

/** The ISO calendar date in Europe/London at a given instant. */
function londonIsoDate(utcMs) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(utcMs));
    return parts;   // en-CA formats as YYYY-MM-DD
}

// ── Calendar helpers (pure date arithmetic, no timezone) ────────────────────────────────────────

/**
 * True for a real "YYYY-MM-DD" that names a date which actually exists.
 * The round-trip is the point: `2026-02-30` parses happily and rolls into March otherwise.
 * @param {any} isoDate
 */
function isValidIsoDate(isoDate) {
    if (typeof isoDate !== 'string' || !ISO_DATE_RE.test(isoDate)) return false;
    const [y, m, d] = isoDate.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Day of week for an ISO date, 0=Sunday…6=Saturday. Timezone-free — it names a calendar date. */
function isoDayOfWeek(isoDate) {
    const [y, m, d] = isoDate.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** True when the ISO date is a Saturday — the only legal week-ending. */
function isSaturday(isoDate) {
    return isValidIsoDate(isoDate) && isoDayOfWeek(isoDate) === 6;
}

/** Shift an ISO date by whole days. Pure calendar arithmetic; DST cannot affect a date count. */
function addDays(isoDate, days) {
    const [y, m, d] = isoDate.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + days));
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** The seven Sunday→Saturday ISO dates of the roster week starting `weekStart`. */
function weekDates(weekStart) {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** The week-ending Saturday of the Sunday–Saturday week containing `isoDate` (itself, if Saturday). */
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

/** True when the window may still accept a submission or amendment. */
function isOpenPhase(phase) {
    return phase === 'INITIAL_OPEN' || phase === 'FINAL_OPEN';
}

/**
 * May a participant be withdrawn from — or restored to — this week, right now?
 *
 * ── WHY WITHDRAWAL EXISTS AT ALL ────────────────────────────────────────────────────────────────
 *
 * The population is frozen at creation, and that freeze is right: it is the only reason a response
 * rate means anything. But it has one consequence nobody chose — a member who LEAVES stays in every
 * open week as a permanent non-responder, and the reviewer chasing outstanding forms is chasing
 * somebody who no longer works here, every week, until the horizon rolls past them.
 *
 * Withdrawal is the narrow answer: the person stops being EXPECTED. Nothing is deleted — the
 * participant record and any submission they made stay exactly where they are, and the page states
 * who was withdrawn and by whom, because an exclusion nobody can see is worse than the problem.
 *
 * ── AND WHY A CLOSED WEEK REFUSES IT ────────────────────────────────────────────────────────────
 *
 * A closed week is a RECORD of what was known when the roster was planned from it. Somebody who was
 * employed, was asked, and did not answer is accurately recorded as exactly that, and editing it
 * afterwards changes a historical response rate to make a past week look tidier. The problem
 * withdrawal solves is a live one — a person being chased now — so the fix is bounded to weeks that
 * are still live. Expired weeks are refused for the same reason plus a stronger one: they are on
 * their way out of the system entirely.
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
 * May this withdrawal be UNDONE? (v21.26, external review of v21.22.)
 *
 * Restoring is not the mirror of withdrawing, and treating it as one produced a false record.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────────────────────────
 *
 * Withdraw somebody BEFORE the initial deadline; let the deadline pass; restore them. They are now
 * expected for a week whose first deadline they were never asked about — so the moment they submit,
 * `deriveHistory` finds nothing accepted before that deadline and marks them **submitted after
 * initial deadline**. That is a true statement about the data and a false one about the person, on
 * the one screen a reviewer uses to judge who is responsive.
 *
 * ── WHY THIS RULE AND NOT A LOOSER ONE ──────────────────────────────────────────────────────────
 *
 * The app ALREADY refuses to add a new participant after the initial deadline — `addMissingParticipants`
 * returns early unless the window is `INITIAL_OPEN`, so a newly eligible member joins from the
 * following week instead, precisely so that nobody is recorded as having missed a deadline they were
 * never asked about. Restoring was the one path that escaped the principle. This makes the two agree
 * rather than inventing a second policy for the same situation.
 *
 * It still allows the case worth allowing: a withdrawal made AFTER the initial deadline is an
 * ordinary undo — an accidental press, a leaver who turned out to be staying — and the person's
 * history across that deadline is untouched, so restoring them claims nothing false.
 *
 * ── AN UNREADABLE STAMP REFUSES ─────────────────────────────────────────────────────────────────
 *
 * `withdrawnAt` has been written beside the flag since the feature shipped, so a withdrawn record
 * without one should not exist. If one does, we cannot tell which side of the deadline it fell, and
 * the two ways of being wrong are not equal: refusing blocks an undo (visible, and the person simply
 * joins next week), while allowing re-creates the false "late" marker this rule exists to prevent.
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
 * A BOOLEAN field set only on withdrawal, never written `false` at creation — which is not a style
 * choice. Firestore's `where('x','==',null)` and `!=` both skip documents missing the field, so a
 * tri-state or a default-false would make every participant written before this feature invisible
 * to the count query, and `expected` would read 0 for every existing week. Counting the withdrawn
 * (usually none) and subtracting is correct for old and new documents alike.
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
 * The Manager planning horizon: this week's Saturday plus the following five.
 *
 * Every row appears whether or not a window exists — this list is the ONLY thing standing between
 * the feature and its one catastrophic silent failure, a week nobody created. Nothing appears
 * outstanding, no reminder can fire, and "no window" is indistinguishable from "no overtime needed".
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
 * ── IT IS THE `canCreate` RULE, NOT A SECOND ONE ────────────────────────────────────────────────
 *
 * Exactly the filter behind the Manager's Create button — same horizon, same `validateWeekEnding`.
 * That equivalence is the point rather than a convenience: if the job used its own idea of which
 * weeks are due, the button and the schedule would disagree, and the disagreement would show up as
 * a week that is silently never created by either — the failure this whole feature is arranged
 * around. Automation does precisely what the button offers, for every week it offers it.
 *
 * A week whose INITIAL deadline has passed but whose FINAL has not is still returned, because
 * `validateWeekEnding` allows it and the button offers it. Creating that week late is worth doing:
 * members can still declare before the final cut-off, and a late form beats no form. Only a week
 * past its final deadline is refused, since nobody could ever submit to it.
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
 * ── A CREATED WINDOW IS NOT AUTOMATICALLY AN OPEN ONE ───────────────────────────────────────────
 *
 * `created` used to be the only existing-window answer, and the horizon rendered it as "Form open"
 * for every week that had a document. The FIRST row is always the current week, whose final deadline
 * is eleven days behind it — so in production every reviewer, on every visit, was told the form was
 * open for a week that closed a week earlier and whose roster had already been published. Two rows
 * of six were routinely wrong, and always the same two.
 *
 * The phase is not extra information; it is the difference between "you can still chase people" and
 * "this is a record". Deciding it HERE, from the stored milestones and the server's clock, keeps it
 * out of the browser — a horizon that read a phone's clock would put a week either side of its
 * deadline depending on whose phone was reading it.
 * ── AND A WEEK THAT WILL OPEN IS NOT ONE THAT ALREADY SHOULD HAVE ───────────────────────────────
 *
 * `not-created` promises the reviewer that the schedule will handle it. That promise is only worth
 * making while it is still true. Once a run has come and gone without creating a week it was due to
 * create, the same row keeps offering the same reassurance — every day, for as long as the fault
 * lasts — and the horizon stops being the monitor over the scheduler and starts being its alibi.
 * `autoOverdue` is that distinction and nothing more; the caller decides it (see
 * `lastSchedulerRun`), because only the caller knows which weeks exist.
 *
 * @param {number} nowMs
 * @param {boolean} exists
 * @param {boolean} [autoOverdue] true when the last scheduled run was due to create this week and
 *   did not. Ignored unless the week is missing and still inside its initial deadline — past that
 *   the row is already reporting something worse.
 * @returns {'created'|'created-closed'|'not-created'|'not-created-overdue'|'not-created-initial-passed'|'missed'}
 */
function windowRowState(milestones, nowMs, exists, autoOverdue = false) {
    if (exists) return nowMs >= milestones.finalDeadlineAt ? 'created-closed' : 'created';
    if (nowMs < milestones.initialDeadlineAt) return autoOverdue ? 'not-created-overdue' : 'not-created';
    if (nowMs < milestones.finalDeadlineAt)   return 'not-created-initial-passed';
    return 'missed';
}

// ── Participants ────────────────────────────────────────────────────────────────────────────────

/** Window audience labels. Provenance and selector choice — NEVER an authorisation input. */
const AUDIENCES = Object.freeze(['restricted', 'all']);

/**
 * Is this generated member a participant for a week starting `weekStart`?
 *
 * The start-date rule is a deliberate PRODUCT decision, not an implementation detail: somebody
 * beginning employment mid-week is excluded from that whole Sunday–Saturday window and first
 * appears in the next one. Every participant answers all seven days, and asking a new starter to
 * declare availability for days before they were employed is incoherent. A four-day part week is
 * the alternative, and it would leak into counts, reminders and the seven-day schema everywhere.
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
 * ── TWO STAGES, AND THE ORDER IS THE POINT ──────────────────────────────────────────────────────
 *
 * Stage 1 — WHO COULD EVER BE ASKED. The roster's own flags: on this week (`startDate`), still here
 * (`!hidden`), and not a manager (`!managerOnly`). This binds EVERY audience, including ones not
 * written yet.
 *
 * Stage 2 — which of them THIS audience asks:
 *
 *   restricted   the admin, plus any ordinary member named in the beta list. A TESTING population:
 *                it started as the admin alone (the one person who cannot be harmed by a
 *                half-finished feature) and widens a name at a time, by invitation, so a real
 *                member's experience can be watched before every member has it.
 *   all          everybody stage 1 allows. The end state.
 *
 * A beta member is a PARTICIPANT and nothing else. Reviewing is the `admin`/`manager` claim, and
 * these two lists must not be allowed to converge: this one decides who is ASKED, and letting it
 * also decide who can LOOK would hand a colleague's declarations to whoever was invited to test.
 *
 * ── A MANAGER IS A REVIEWER AND NEVER A PARTICIPANT ─────────────────────────────────────────────
 *
 * That is why the flag test is stage 1 and not a clause repeated in each branch: it must not be
 * possible to write an audience that reaches a manager, and the restricted branch selects by
 * ENTITLEMENT, so a manager who also held the admin entitlement would otherwise slip through.
 *
 * The reason is not tidiness. Review rights come from the `manager` CLAIM, so a manager already
 * sees every week's answers without appearing in any of them — being in the population adds no
 * access and does add a record that they were expected to answer. Frozen means for ever: they read
 * as a non-responder for that week permanently, and it cannot be corrected afterwards.
 *
 * ── WHAT MOVED HERE FROM THE GENERATOR (v20.72), AND WHY IT IS STILL WORTH IT ────────────────────
 *
 * `!hidden && !managerOnly` used to run in `generate-roster-members.mjs`, so the list this function
 * received was already narrowed and the same rule was in force. The behaviour is unchanged; what
 * changed is that the rule is now READABLE — stated beside the audiences it binds, with the reason
 * attached, and tested against every audience in `AUDIENCES` rather than against the two that
 * happen to exist. A rule baked into a generated JSON file is a rule nobody can find, and the way
 * that surfaced was a genuine question — "open it to the managers for testing" — that the code
 * could not have answered without an edit in a file that does not look like policy.
 *
 * Widening the beta is still a one-word edit — `currentAudience()`.
 *
 * @param {Array<{name:string,grade?:string,rosterOrder?:number,startDate?:string|null,hidden?:boolean,managerOnly?:boolean}>} roster
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
            rosterOrder: Number.isInteger(m.rosterOrder) ? m.rosterOrder : 0,
        }))
        .sort((a, b) => a.rosterOrder - b.rosterOrder || a.memberName.localeCompare(b.memberName));
}

/**
 * Is `name` safe as a Firestore document path segment?
 *
 * Participant and submission documents are keyed by canonical member name for legibility, so a
 * name that cannot be a path segment corrupts a write rather than failing a lint. Applied to
 * GENERATED data, in CI — a future starter with an unusual name must break the build, not
 * production. Firestore's own rules: non-empty, no '/', not '.' or '..', no __reserved__ form,
 * at most 1500 bytes.
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
const AVAILABILITY_MODES = Object.freeze({
    unavailable:  Object.freeze([]),
    all_day:      Object.freeze([]),
    // ── LEGACY since v21.24. Still PARSED for ever; no longer OFFERED by any client ──────────────
    //
    // "Available for up to 12 hours" (v20.83, owner) answered a different question from every mode
    // beside it: the others say WHEN somebody can work, this one said HOW LONG. One mutually
    // exclusive control cannot carry two dimensions, so the two competed — on a rest day it
    // duplicated `all_day`, and on a worked day it gave a duration with no window, which a clerk
    // cannot build a duty from. Both were reported by external review of v21.22, and the owner
    // settled it by splitting the dimensions: willingness became `fullTwelve` below.
    //
    // IT MUST STAY IN THIS TABLE. Revisions are append-only and immutable, so answers stored under
    // this mode live for the length of their retention window and have to keep parsing and
    // rendering. Removing it would not tidy the schema; it would make existing records unreadable.
    twelve_hours: Object.freeze([]),
    before:       Object.freeze(['until']),
    after:        Object.freeze(['from']),
    before_after: Object.freeze(['until', 'from']),
    custom:       Object.freeze(['start', 'end', 'nextDay']),
});

/**
 * The one field that may accompany ANY available answer (v21.24, owner — the availability /
 * willingness split).
 *
 * ── WHY A FIELD AND NOT A MODE ──────────────────────────────────────────────────────────────────
 *
 * "When can you work" and "how long a day would you work" are independent questions, so they cannot
 * share a mutually exclusive control without one of them being lost. As a flag ALONGSIDE a window
 * both are expressible at once and nothing overlaps: "before and after my duty, and go long if it
 * helps" is one unambiguous statement — exactly what the old `twelve_hours` mode could not make.
 *
 * ── "UP TO", DELIBERATELY ───────────────────────────────────────────────────────────────────────
 *
 * As a mode competing with windows, "up to 12 hours" WAS the ambiguity: it admitted any duration
 * and named no window. As a flag beside a window it is precisely right — the member grants
 * PERMISSION to build a long duty rather than committing to a 12-hour turn. The window says where;
 * this says how far it may run.
 *
 * ── STORED ONLY WHEN TRUE ───────────────────────────────────────────────────────────────────────
 *
 * An unticked box is the ABSENCE of a declaration, not a declared "no" — the same reasoning that
 * makes a restored participant lose its `withdrawn` field rather than gain `withdrawn: false`. It
 * also keeps answers written before this field comparable with those written after: neither carries
 * the key, so nothing has to be migrated and no historical answer acquires an opinion it never gave.
 *
 * It is refused on `unavailable`, which is the one mode it cannot mean anything beside.
 */
const OPTIONAL_DAY_FIELDS = Object.freeze(['fullTwelve']);

/** @returns {{ok:true, day:object}|{ok:false, error:string}} */
function normaliseDay(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'day-not-object' };
    const mode = raw.mode;
    if (!Object.prototype.hasOwnProperty.call(AVAILABILITY_MODES, mode)) return { ok: false, error: 'bad-mode' };

    const fields = AVAILABILITY_MODES[mode];
    // Reject unknown keys rather than dropping them: a client sending a field this server does not
    // know about is a version mismatch, and silently discarding it would store an answer the member
    // did not give.
    const optional = mode === 'unavailable' ? [] : OPTIONAL_DAY_FIELDS;
    const extra = Object.keys(raw).filter(k => k !== 'mode' && !fields.includes(k) && !optional.includes(k));
    if (extra.length) return { ok: false, error: 'unknown-field' };

    /** @type {Record<string, any>} */
    const day = { mode };

    // The willingness flag. Type-checked like everything else, and written ONLY when true — see
    // OPTIONAL_DAY_FIELDS for why the false case is an absence rather than a stored opinion.
    if (raw.fullTwelve !== undefined) {
        if (typeof raw.fullTwelve !== 'boolean') return { ok: false, error: 'bad-full-twelve' };
        if (raw.fullTwelve) day.fullTwelve = true;
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
        // `nextDay` is not the member's opinion — it is a fact about the two times they gave. Taking
        // it on trust would let a client store 18:00–23:00 flagged as overnight, which reads as a
        // 29-hour availability window.
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
        out[date] = r.day;
    }
    return { ok: true, days: out };
}

/**
 * Semantic equality of two normalised weeks. Both sides come from `normaliseDays`, so key order is
 * already canonical and a stable stringify is a true comparison rather than an approximation.
 */
function daysEqual(a, b) {
    return stableStringify(a) === stableStringify(b);
}

function stableStringify(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
    return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

// ── Revisions and concurrency ───────────────────────────────────────────────────────────────────

/** Zero-padded revision document id, so the natural string order is the revision order. */
function revisionId(n) {
    return String(n).padStart(6, '0');
}

/**
 * What should a submit request DO? The whole concurrency model, as one pure decision.
 *
 * The three-way split matters because two of the outcomes look like failure and are not:
 *
 *   noop      the content already IS the stored content. This is the ordinary duplicate click, and
 *             it is also the retry after a timeout — which is why it succeeds EVEN WITH a stale
 *             `ifRevision`. The caller is trying to save what is already authoritative; refusing
 *             would tell somebody their availability was rejected when it is saved and correct.
 *   conflict  the content differs AND the caller's baseline is stale, so somebody else (or the
 *             caller's own earlier, successful, timed-out request) has written since. Never
 *             last-write-wins: the loser of a silent race believes they submitted.
 *   append    the ordinary genuine amendment.
 *
 * @param {{currentRevision:number, days:object}|null} head
 * @param {object} incomingDays already through `normaliseDays`
 * @param {number} ifRevision   0 for a first submission
 * @returns {{action:'create'|'append'|'noop'|'conflict', revision?:number, expected?:number}}
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

/**
 * Everything the Manager needs to know about how a submission moved, derived from the immutable
 * revisions rather than stored as flags.
 *
 * `changedSinceInitial` compares the initial-cut-off state with the CURRENT state, so a member who
 * changed something and changed it back is not flagged — the current answer is the one that was
 * planned against. The revision list still proves the intermediate change if it is ever needed.
 *
 * @param {Array<{revision:number, days:object, acceptedAt:number}>} revisions
 * @param {object|null} headDays
 * @param {number} initialDeadlineAt
 */
function deriveHistory(revisions, headDays, initialDeadlineAt) {
    const sorted = [...(revisions || [])].sort((a, b) => a.revision - b.revision);
    const before = sorted.filter(r => r.acceptedAt < initialDeadlineAt);
    const initialRevision = before.length ? before[before.length - 1] : null;
    const hasSubmission = sorted.length > 0;
    return {
        initialRevision,
        // A submission exists but nothing was accepted before the initial deadline — the clerk did
        // NOT have this person's availability when the draft was planned.
        lateInitial: hasSubmission && !initialRevision,
        changedSinceInitial: !!(initialRevision && headDays && !daysEqual(initialRevision.days, headDays)),
        dayChangedAt: dayChangedAt(sorted),
    };
}

/**
 * When each individual DATE's answer last changed (v21.26, external review of v21.22).
 *
 * A submission has ONE `updatedAt` for the whole form, and the reviewer's rows printed their age
 * from it — so somebody who answered all seven days a fortnight ago and edited only the Saturday
 * this morning had every day reported as declared today. Always in the FRESHER direction, which is
 * the one that costs something when a clerk is arranging short-notice cover.
 *
 * Derived rather than stored: the append-only revisions already hold every answer at every point,
 * so a stored copy would be a second version of a derivable truth, free to disagree with the
 * history it summarises. Same reasoning as `initialRevision` and `lateInitial` above.
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
 * @param {any} v
 */
function stableKeyOrder(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(stableKeyOrder);
    /** @type {Record<string, any>} */
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = stableKeyOrder(v[k]);
    return out;
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
    OPTIONAL_DAY_FIELDS,
    // clock
    londonOffsetMinutes,
    londonTimestamp,        // exported for the DST-pathology tests, not for production callers
    londonNoonTimestamp,
    londonMidnightTimestamp,
    londonIsoDate,
    // calendar
    isValidIsoDate,
    isoDayOfWeek,
    isSaturday,
    addDays,
    weekDates,
    weekEndingFor,
    // milestones + phases
    deriveMilestones,
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
    deriveHistory,
};
