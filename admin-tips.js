// @ts-check
/**
 * admin-tips.js — CARD_TIPS for admin.html's `?` panels.
 *
 * Data, no DOM, in the shape `tips-lightbox.js` renders and `tips-content.test.mjs` pins — the split
 * Operations, Links, Overtime and Trains had already made. Content is not coordination, so it left
 * `admin-app.js`, which only hands it to `initTipsLightbox`. An item or section marked `adminOnly`
 * shows to the admin and managers (who pick members exactly as the admin does), `staffOnly` to a
 * self-service member. The Huddle, roster and staff-login tips are Operations' (operations-tips.js),
 * `notifications` is Settings'. `al-copy-parity.test.mjs` reads the Annual Leave entry from here.
 */

/** Tips content keyed by the `data-card` attribute on each `.btn-card-tips` button. */
export const CARD_TIPS = {
    'change-shift': {
        title: 'Change a Shift',
        sections: [
            { heading: 'One shift', items: [
                { icon: '1️⃣', html: 'Select a <strong>staff member</strong> and <strong>week</strong> at the top.', adminOnly: true },
                { icon: '1️⃣', html: 'Select the <strong>week</strong> at the top, using the arrows or the date picker.', staffOnly: true },
                // GOLD, the app's word for that colour — a reader compares it with the screen, and admin.css draws it.
                { icon: '2️⃣', html: 'Choose a type on any day. The row turns <strong>gold</strong>, with a gold edge, to show it is ready to save; select <strong>Save changes</strong> when you have finished.' },
                { icon: '☑️', html: 'A ticked day with no type yet has the gold edge only, and saves nothing until it has one.' },
                // Three of the six pills are off on a Sunday, and Other offers Spare alone there; Boxing Day has no Other pill
                // (admin-day-pills.js), so "any day" needs this. admin-day-pills.test.mjs holds these words to the row.
                { icon: '☀️', html: 'A <strong>Sunday</strong> offers only <strong>RDW</strong>, <strong>Rest Day</strong> and, under <strong>Other</strong>, <strong>Spare</strong>. Sundays are not contracted, so leave and absence cannot be recorded on one and a worked Sunday is always RDW. <strong>Christmas Day</strong> and <strong>Boxing Day</strong> can’t be a Spare turn, and Boxing Day can’t be an Other day either (training, meetings and the rest).' },
                { icon: '🎨', html: 'A row already carrying a change is <strong>cream</strong>. Saving over one replaces what was there, so check the cream rows before you save.' },
                // Owner, 10 Nov 2026: a tick chooses a day for Apply, and never removes anything.
                { icon: '🗑️', html: 'To remove a saved change, select its type again — the day reads <strong>⚠ Removing</strong> — then <strong>Save changes</strong>. A tick only chooses a day for <strong>Apply</strong>.' },
                // Both ways, for both pointers: a mouse cannot swipe.
                { icon: '↔️', html: 'Move between weeks with <strong>‹</strong> and <strong>›</strong>, or swipe the week sideways on a phone. <strong>📍 Today</strong> brings you back to this week.' },
            ]},
            { heading: 'Several days at once', items: [
                { icon: '1️⃣', html: 'Use <strong>Mon–Fri</strong>, <strong>Working days</strong> or <strong>All 7</strong> — or tick the days you want individually.' },
                { icon: '2️⃣', html: 'Pick a type, and add a start and end time if it needs one.' },
                // It names the type's full LABEL (admin-week-editor.js) — this said “AL”, which the button never reads.
                { icon: '3️⃣', html: 'Select the <strong>Apply</strong> button under the pills — once you have picked a type it names it, so it reads <em>Apply “Annual Leave” to ticked days</em> — then <strong>Save changes</strong>.' },
                { icon: 'ℹ️', html: 'Until a day is ticked and a type is chosen, <strong>Apply</strong> is greyed out, and the line under it says which is still missing.' },
                { icon: '🏖️', html: 'For a run of annual leave or absence, the two cards beside this one — below it on a phone — do a whole date range in one go — you do not have to tick days here.' },
            ]},
            { heading: 'What each type means', items: [
                { icon: '🏖️', html: '<strong>AL</strong> — annual leave. <strong>Absent</strong> — away for any reason; only the dates are saved, never the reason.' },
                { icon: '📅', html: '<strong>Shift</strong> — a confirmed working shift. Use it to confirm a spare week, change shift times, or record a swap with a colleague.' },
                { icon: '💼', html: '<strong>RDW</strong> — Rest Day Working. Use it when somebody works a full shift on their rest day.' },
                { icon: '✏️', html: '<strong>Rest Day</strong> — puts a working day back to a rest day.' },
                // All six flavours and Spare: a flavour left out of this list is one nobody knows exists.
                { icon: '🏷️', html: '<strong>Other</strong> — open the pill to choose: training, induction, assessment, team day, union, meeting, or <strong>Spare</strong> (on standby, shift not yet known).' },
                { icon: '⏱️', html: 'On an <strong>Other</strong> day that falls on a rest day, <strong>Rest day (RDW)</strong> is already ticked and cannot be unticked — it is automatic. On a day they were rostered to work, tick it yourself to pay the day as rest-day working. Add times if you know them; leave them blank and it pays as the day underneath, or eight hours on a rest day.' },
            ]},
        ],
    },
    'annual-leave': {
        title: 'Record Annual Leave',
        sections: [
            { items: [
                { icon: '🏖️', html: 'Choose the <strong>staff member at the top of the page</strong>, then a date range. Sundays never use a leave day. A <strong>rest day</strong> in the range is asked about rather than assumed — it only counts if the member had swapped a working day onto it.', adminOnly: true },
                { icon: '🏖️', html: 'Select a date range. Sundays never use a leave day. A <strong>rest day</strong> in the range is asked about rather than assumed — it only counts if you had swapped a working day onto it.', staffOnly: true },
                // The preview is a COUNT and a span, not a list of days: never invite a check of what is not on screen.
                { icon: '👀', html: 'Before you save you are told <strong>how many working days</strong> the range comes to and the dates it spans. Sundays are never in that count; a rest day is in it only where you have said it was a swapped working day. Check the number against what you meant to book.' },
                { icon: '⚠️', html: 'If the booking would take somebody past their entitlement for the year you are told, and asked to confirm. It does not stop you — sometimes that is the right answer.' },
                { icon: '🗓️', html: 'Leave in <strong>January</strong> comes out of that year’s allowance. When some is booked, a <strong>Which year’s allowance</strong> panel appears under the Record button, and a day can come out of the year before instead, while that year still has days left.' },
            ]},
        ],
    },
    'sick-days': {
        title: 'Record Absence',
        sections: [
            { heading: 'What to use it for', items: [
                { icon: '🗓️', html: '<strong>Any kind of absence</strong>, for any number of days.' },
                { icon: '👨‍👩‍👧', html: 'Sickness, a family or domestic emergency, caring for a relative — it is all the same entry here.' },
                { icon: '🪑', html: 'You never say why. Only the dates are saved; the reason is not recorded anywhere in the app.' },
            ]},
            { heading: 'Good to know', items: [
                { icon: '📅', html: 'Pick a start and end date. Rest days and Sundays inside the range are skipped automatically. Sundays are never recorded as absence — a rostered Sunday in the range is set as a rest day, and the preview names it.' },
                { icon: '👁️', html: 'An absence shows on the calendar as 🪑 <strong>Absent</strong> and everybody can see it, the same as annual leave. What they cannot see is why.' },
            ]},
        ],
    },
    'saved-changes': {
        title: 'Saved Changes',
        sections: [
            { heading: 'Viewing', items: [
                { icon: '🔍', html: 'The list follows the <strong>member selected at the top of the page</strong>. Select <strong>All staff</strong> above the table for everyone\'s changes, and the same button again to come back.', adminOnly: true },
                { icon: '🔍', html: 'This list shows your own saved changes only.', staffOnly: true },
                { icon: '📅', html: 'The <strong>month filter</strong> narrows it to one month. It starts on this month.', adminOnly: true },
                // Staff default to All months on purpose — see admin-saved-changes.js.
                { icon: '📅', html: 'The <strong>month filter</strong> narrows it to one month. It starts on <strong>All months</strong>, so leave you have booked for later in the year is not hidden behind it.', staffOnly: true },
            ]},
            { heading: 'Editing and deleting', items: [
                { icon: '✏️', html: 'Select <strong>✎</strong> (Edit) on a change to adjust its type or time, then <strong>Save changes</strong>.' },
                { icon: '🗑️', html: 'Select <strong>✕</strong> (Delete), then again to confirm. That day goes back to whatever the roster originally said.' },
            ]},
            { heading: 'Where a change came from', adminOnly: true, items: [
                { icon: '📋', html: 'Entries marked <strong>PDF upload</strong> came in from a roster PDF. A later upload of the same week replaces them — they arrive in the review already ticked rather than flagged for a decision, because the PDF is the source for those days.' },
                { icon: '✍️', html: 'Everything else was entered by hand. If a later upload disagrees with one of those, it is flagged for you to decide rather than replaced.' },
            ]},
        ],
    },
};
