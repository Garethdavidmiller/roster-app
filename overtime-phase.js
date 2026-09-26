// @ts-check
// overtime-phase.js — WHERE THE WEEK STANDS, in the member's terms, and the deadlines that decide it.
//
// ── WHY THIS IS ITS OWN MODULE ─────────────────────────────────────────────────────────────────
//
// Extracted from overtime-format.js at v23.84, which had reached its 1030-line ratchet for the
// second time in three releases (coordinator-ratchet.test.mjs). The ratchet offers EXTRACT, SPLIT or
// RAISE, and this repo's answer is the first unless there is an argument for the others; the
// argument for this seam is that the four functions here are ONE subject and the rest of that file
// is another. overtime-format.js formats ANSWERS — what a member said, how it reads on a chip, how
// old it is. This file formats TIME: which phase the week is in, what that phase is called (as a
// sentence, as a two-word chip, as a tone), and the two deadlines that define it. `deadlineLabel`
// comes with them because `deadlineLines` is built from it and a module that imports its own
// re-exporter is a cycle.
//
// Everything here is re-exported from overtime-format.js, so no call site and no test changed —
// the same move `isWorkingDate` made from admin-overrides.js into al-entitlement.js (v23.79).
//
// The reasoning each function carries is in its own header below and was moved, not rewritten:
// the v20.70 rule that these lines describe the member's position and never name a document they
// do not receive; the v20.86 finding that the deadline which mattered was the one not on screen;
// the v23.83 split of each date into a label and a value; and the v23.84 decision that a STATE is
// worn as a badge, not said as a sentence.

import { formatWeekdayDate, londonDate } from './date-format.js';

/**
 * A deadline instant, in London wall-clock words: "Tue 18 Aug · 12:00".
 *
 * Formatted through `Intl` in Europe/London rather than the device's own zone, so a phone left on
 * holiday time still shows staff the deadline the roster office means.
 * @param {number} ms
 */
export function deadlineLabel(ms) {
    if (!ms) return '';
    // `londonDate` converts the instant to its London calendar date, then the app's own composer
    // spells it: no comma to strip ("Tue, 18 Aug" reads as a stray separator beside the app's "·"
    // dividers) and no month-abbreviation to trim. This used to format through `Intl` and then
    // `.replace(/\bSept\b/, 'Sep')`, because en-GB abbreviates September to FOUR letters and every
    // other month to three, so a column of deadlines came out ragged — "Tue 25 Aug" above
    // "Tue 1 Sept". The composer reads MONTH_ABB, so the ragged month cannot come back.
    // The weekday still leads: a deadline staff act on is named by its day of the week first.
    const d = formatWeekdayDate(londonDate(ms));
    const t = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(ms));
    return `${d} · ${t}`;
}


/**
 * The phase a window is in at `nowMs` — the client twin of `phaseFor` in functions/overtime-core.js
 * (overtime-parity.test.mjs holds the two together).
 *
 * The reviewer's horizon rows are built from stored milestones and carry no `phase`; only the
 * member's own state does. So the workspace derives it here, from the deadlines and the corrected
 * clock, rather than reading a field the overview never sent — without it every week read as open.
 * @param {{ initialDeadlineAt: number, finalDeadlineAt: number }} win
 * @param {number} nowMs
 * @returns {'INITIAL_OPEN'|'FINAL_OPEN'|'CLOSED'}
 */
export function phaseAt(win, nowMs) {
    if (nowMs >= win.finalDeadlineAt) return 'CLOSED';
    if (nowMs >= win.initialDeadlineAt) return 'FINAL_OPEN';
    return 'INITIAL_OPEN';
}

/**
 * Staff-facing copy for a submission phase. Calm and factual — never a countdown.
 *
 * ── IT MAY NOT NAME A DOCUMENT THE MEMBER NEVER SEES ────────────────────────────────────────────
 *
 * This said "your answers go to the draft roster" and "the draft roster has been planned", and the
 * second one was read — correctly — as wrong. The DATES were right: for a week ending Sat 22 Aug the
 * draft is Thu 6 Aug and the final roster Thu 13 Aug, so on 11 Aug the draft genuinely had been
 * planned. The problem is that "the draft roster" is an internal artefact of the roster office. Staff
 * do not receive it. What they call "the roster" is the one that comes out on Thursday — the FINAL
 * one — so a line announcing that the roster has been planned, five days before they see anything,
 * reads as a straightforward untruth about the document they are waiting for.
 *
 * So these lines now describe the MEMBER'S OWN POSITION and name nothing they cannot see:
 *
 *   before the first deadline   answering now gets you counted from the start
 *   after it, before the final  you can still change it, and later is worse
 *
 * "Planning has started" is safe to say because that is the definition of the first deadline, not a
 * claim about any document. The lines beneath state the dates, so this one names none — and that
 * rule still holds after v20.86 added the second date: what it forbids is two lines naming the SAME
 * Tuesday, which is how a member stops reading either.
 * @param {string} phase
 */
export function phaseCopy(phase) {
    if (phase === 'INITIAL_OPEN') return 'Open — answer now to be included when this week is planned';
    if (phase === 'FINAL_OPEN')   return 'Still open — planning has started, so a change now may not fit';
    return 'Closed';
}

/**
 * The phase as a CHIP — two words at most (v23.84).
 *
 * ── STATE IS A BADGE, NOT A SENTENCE ────────────────────────────────────────────────────────────
 *
 * `phaseCopy` above is a sentence, and the form head rendered it as one: "Open — answer now to be
 * included when this week is planned", in the same 12px grey as the date span above it and the
 * deadlines below. Owner, from a phone (15 Sep 2026): "it looks wordy because of the design of the
 * top … perhaps it lacks the use of colour to break it up like admin." Admin never states a state
 * in prose; it wears one — the roster-state badge, the AL-left chip, the coloured left edge on a
 * horizon row. So the member's week now wears its phase the same way, and the reviewer's horizon
 * and the member's form describe one week with one visual grammar.
 *
 * The sentence is not lost. For INITIAL_OPEN its second half ("to be included when this week is
 * planned") is what the ANSWERS DUE label already names and what the ? panel already explains, so
 * the head no longer repeats it. For FINAL_OPEN the sentence IS a warning — a change now may not
 * fit — and a warning earns a line where a normal state does not: `deadlineLines` marks that one
 * `warn`, and the head renders only prose so marked. Asymmetric on purpose. Every member should not
 * read a paragraph about the ordinary case so that the exceptional one has somewhere to go.
 *
 * @param {string} phase
 * @returns {string}
 */
export function phaseChip(phase) {
    if (phase === 'INITIAL_OPEN') return 'Open';
    if (phase === 'FINAL_OPEN')   return 'Still open';
    return 'Closed';
}

/**
 * The phase as a TONE, in the horizon's vocabulary — `ok` / `warn` / `done` — so the member's week
 * band and the reviewer's week row colour the same state the same way. `bad` is deliberately not
 * reachable from a member's form: a missed week has no form to render.
 * @param {string} phase
 * @returns {'ok'|'warn'|'done'}
 */
export function phaseTone(phase) {
    if (phase === 'INITIAL_OPEN') return 'ok';
    if (phase === 'FINAL_OPEN')   return 'warn';
    return 'done';
}

/**
 * Every line a member's form head carries about time, in order.
 *
 * ── THE DEADLINE THAT MATTERS WAS THE ONE NOT ON SCREEN ─────────────────────────────────────────
 *
 * A window has two deadlines and they are eleven and eighteen days out, a week apart. Until v20.86
 * the form printed the FINAL one — "Closes Tue 25 Aug · 12:00" — and left the first to be inferred
 * from "answer now to be included when this week is planned". So the only date on the page was the
 * later one, and a member reading it would reasonably conclude they had until then.
 *
 * They do, technically: a submission at the final deadline is accepted. But it arrives after the
 * week has been planned, which is the whole distinction the two deadlines exist to draw, and the
 * page was quietly pointing at the wrong one. An answer that is accepted and too late to be used is
 * the worst outcome this feature can produce — everyone believes it worked.
 *
 * Both dates now show, in the order they arrive, with the live one first. After the first deadline
 * the same line stays and turns past-tense rather than vanishing: "answers were due" tells a member
 * where they stand, where dropping the line would leave them thinking they had never missed
 * anything. Neither line is a countdown, and neither names a document (see phaseCopy).
 *
 * @param {string} phase
 * @param {number} initialDeadlineAt
 * @param {number} finalDeadlineAt
 * ── A DATE NEEDS A NAME BESIDE IT, NOT A SENTENCE AROUND IT (v23.83) ────────────────────────────
 *
 * Reported from a phone: "this section is not good at all. Where is the clarity." The card head was
 * eight lines of near-identical grey text — week title, date span, a phase sentence, two deadlines,
 * a standing 12-hour rule, a question, a button — before the member reached the first day. The one
 * fact they came for was bold in the middle of that stack, which makes the bolding read as
 * arbitrary rather than as emphasis.
 *
 * So each line now carries its own `label` and `value` as well as the `text` it always had. The
 * renderer sets the label as a micro eyebrow above the value, which is the app's existing idiom for
 * a named figure (`.field-eyebrow`), and gets hierarchy from structure rather than from weight.
 * NOTHING IS REWORDED: `text` is still exactly `label + ' ' + value`, so every rule pinned against
 * it — both dates present, one `lead`, "were due" once it has passed, "Closed" on a closed week,
 * and the v20.70 no-named-document rule — holds unchanged, and the split is additive.
 *
 * The phase sentence keeps no label, because it is a sentence rather than a named value. It is
 * rendered BELOW the dates now instead of above them: it explains the deadline, so it reads as a
 * caption to one rather than as another fact competing with it.
 *
 * A form that OPENED after its first deadline (a week created late) names only the live one: "Answers
 * were due" a date that passed before the form existed tells the member they missed something they
 * were never asked. `openedAt` absent (an older server) keeps the two-deadline head.
 *
 * @param {string} phase
 * @param {number} initialDeadlineAt
 * @param {number} finalDeadlineAt
 * @param {number|null} [openedAt] when the form was created, if the server said
 * @returns {{ text: string, lead: boolean, label?: string, value?: string, warn?: boolean }[]} `lead` marks the date
 *   that is still to come — the one the member can still act on, which is the ONLY one worth
 *   emphasising. A line with no `label` is prose; one with a label is a named date.
 */
export function deadlineLines(phase, initialDeadlineAt, finalDeadlineAt, openedAt = null) {
    // One place builds all three, so `text` can never drift from the label and value it is made of.
    const dated = (/** @type {string} */ label, /** @type {number} */ at, /** @type {boolean} */ lead) => {
        const value = deadlineLabel(at);
        return { text: `${label} ${value}`, label, value, lead };
    };
    if (phase === 'CLOSED') {
        return [dated('Closed', finalDeadlineAt, false)];
    }
    // `warn` on the FINAL_OPEN sentence only: it is the one that is a warning rather than a
    // description, and the head renders prose only when it carries this flag (see phaseChip).
    if (phase === 'FINAL_OPEN' && openedAt && openedAt >= initialDeadlineAt) {
        return [
            dated('Answer by', finalDeadlineAt, true),
            { text: 'This form opened after the first deadline, so planning has already started.',
                lead: false, warn: true },
        ];
    }
    if (phase === 'FINAL_OPEN') {
        return [
            dated('Answers were due', initialDeadlineAt, false),
            dated('Changes close', finalDeadlineAt, true),
            { text: phaseCopy(phase), lead: false, warn: true },
        ];
    }
    return [
        dated('Answers due', initialDeadlineAt, true),
        dated('Changes close', finalDeadlineAt, false),
        { text: phaseCopy(phase), lead: false },
    ];
}

