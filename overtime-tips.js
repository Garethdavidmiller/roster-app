// @ts-check
/**
 * overtime-tips.js — CARD_TIPS for overtime.html's `?` panels.
 *
 * Pure data, no DOM. The shape is the one `tips-lightbox.js` renders and
 * `tips-content.test.mjs` pins — a `?` panel that throws because an entry was hand-added in the
 * old flat shape is a staff-reported production error, which is why that guard exists.
 *
 * ── ONE PANEL PER AUDIENCE, AND THEY ANSWER DIFFERENT QUESTIONS ─────────────────────────────────
 *
 * `my-availability` is written to a member filling a form: what it is for, how to fill it, what
 * happens afterwards. The other two are written to a reviewer running the week — `upcoming-weeks`
 * about how weeks come into existence, `who-is-available` about reading one. They are not the same
 * facts phrased differently, and a fact belonging to one should not be duplicated into the other: a
 * member does not need to know how the scheduler works, and a reviewer is not filling in a form.
 *
 * The two things the interface itself cannot say often enough without becoming noisy still lead
 * their panels: availability is not allocation, and no response is not "unavailable".
 *
 * ── THESE GO STALE SILENTLY, WHICH IS WHY THEY ARE SWEPT WITH THE FEATURE ───────────────────────
 *
 * Two proofs, both found in the v20.90 sweep. The reviewer's panel had said "the roster shown
 * beside each person is their current one" since v20.59 — describing something that was not
 * rendered until v20.87, twenty-eight releases later. And `upcoming-weeks` described manual
 * creation as the way a week gets opened, with no mention that weeks have opened themselves every
 * morning since v20.61 — so a reviewer reading it would learn exactly the habit the scheduler was
 * built to remove, and would read the row that says "Opens automatically overnight" as a fault.
 *
 * Neither could fail a test: help text is prose, and prose about a feature is only checked by
 * somebody who knows the feature. So when you change behaviour on this page, read these.
 */

export const CARD_TIPS = {
    'my-availability': {
        title: '📝 My availability',
        sections: [
            {
                items: [
                    { icon: '🗓️', html: 'Each form covers one <strong>roster week</strong>, Sunday to Saturday, and is named by the Saturday it ends on.' },
                    // Deliberately does NOT mention the draft roster. It is an internal document of
                    // the roster office that staff never receive, and "the roster" to them means the
                    // one that comes out on the Thursday — so naming it here described a thing they
                    // could not see, in a word that means something else to them.
                    { icon: '⏰', html: 'Two deadlines, both shown on the form. Answer by the <strong>first</strong> to be counted from the start of planning; the <strong>second</strong> is when the form closes for good.' },
                    { icon: '✏️', html: 'You can change your answers as often as you like until the final deadline. Only your latest version counts.' },
                ],
            },
            {
                heading: 'Filling it in',
                items: [
                    { icon: '✅', html: 'All seven days need an answer before you can submit. The button tells you how many are left.' },
                    { icon: '🕐', html: 'The choices offered come from what you are rostered that day. <strong>Custom times</strong> is there for anything they do not cover.' },
                    // The rule was always how the app behaved and was stated nowhere, so an
                    // ordinary overnight entry looked self-contradictory (Friday 22:00–02:00 beside
                    // Saturday "not available"). Owner, Aug 2026.
                    { icon: '🌙', html: 'Each day\'s answer is about a duty <strong>starting that day</strong>. So availability that runs past midnight belongs to the day it starts on — you do not answer for it again the next morning.' },
                    { icon: '🔄', html: 'If your shift changes after you have answered, the form says so on that day. What you said still stands until you change it yourself.' },
                ],
            },
            {
                heading: 'What it does and does not do',
                items: [
                    { icon: '📋', html: 'This tells the roster team when you are <strong>available</strong>. It does not book overtime and does not guarantee any.' },
                    { icon: '⏱️', html: '<strong>Up to 12 hours</strong> means your whole day may run to twelve hours, including anything you are already rostered — not twelve hours on top. It is not offered where the day already reaches that.' },
                    { icon: '🧾', html: 'A submitted form says so at the top, with when you last changed it. That line is still there when you come back to it.' },
                    { icon: '✅', html: 'The <strong>released roster</strong> is the only place that shows overtime you have actually been given.' },
                    { icon: '🔒', html: 'Managers and the admin can see what you submit. Forms are kept for around 13 weeks and then deleted.' },
                ],
            },
        ],
    },

    'upcoming-weeks': {
        title: '🗓️ Upcoming weeks',
        sections: [
            {
                heading: 'How weeks get opened',
                items: [
                    // THE correction of the v20.90 sweep — see the module header.
                    { icon: '🌙', html: 'Weeks open <strong>by themselves</strong>, early each morning. You do not have to create them, and a week you have not touched is not a week nobody was asked about.' },
                    { icon: '⚡', html: '<strong>Open now</strong> is the shortcut for when you want a week open immediately rather than tomorrow. It is not a job to remember.' },
                    { icon: '👀', html: 'The list is built from the <strong>calendar</strong>, not from the forms that exist — so a week nobody has opened still appears, rather than being silently absent.' },
                    { icon: '🔁', html: 'If two people open the same week at once, only one form is created. The second simply opens it.' },
                ],
            },
            {
                heading: 'When something is missing',
                items: [
                    { icon: '#️⃣', html: 'The count beside the card title is what is <strong>missing</strong> — “2 without a form” — not how many weeks are listed. “All created” means there is nothing to do here.' },
                    { icon: '⚠️', html: '<strong>Missed</strong> means no form was ever opened, so nobody was asked and nobody is outstanding. It never means nobody was needed.' },
                    { icon: '🚫', html: 'Once a week\'s final deadline has passed it can no longer be opened, and the row stays as <strong>Missed</strong> until that Saturday goes by.' },
                ],
            },
            {
                heading: 'Adding somebody after a week is open',
                items: [
                    { icon: '➕', html: '<strong>Add</strong> appears when more people are now eligible than the week was opened with — usually because somebody has just been invited.' },
                    { icon: '📅', html: 'It is offered only while the <strong>first deadline is still ahead</strong>. After that they join from the next week instead, so nobody is recorded as having missed a deadline they were never asked about.' },
                    { icon: '📁', html: '<strong>Previous weeks</strong> lists the weeks that have already run and are still kept — around 13 weeks — so you can look back at what was available when a decision was made.' },
                ],
            },
        ],
    },

    'who-is-available': {
        title: '👥 Who is available',
        sections: [
            {
                heading: 'Reading the week',
                items: [
                    { icon: '📊', html: '<strong>No response</strong> and <strong>not available</strong> are different answers. Someone with no form has told us nothing; someone who submitted an unavailable day has told us something.' },
                    // The counts went neutral at v20.87 — the app cannot judge adequacy, so this
                    // panel must not let a number be read as a verdict either.
                    { icon: '🔢', html: 'The number on each day is how many people offered <strong>some</strong> availability. It does not say whether that covers the shift you are short of — four people free before 07:00 do not fill a late turn.' },
                    { icon: '📅', html: 'The roster shown beside each person is their <strong>current</strong> one, which may have changed since they submitted.' },
                    // Stated on BOTH sides, because it is the reviewer who would otherwise
                    // misread a pair of answers as a contradiction and ring somebody to resolve it.
                    { icon: '🌙', html: 'An answer covers a duty <strong>starting that day</strong>. Someone available 22:00–02:00 on the Friday is offering Friday night — a Saturday “not available” beside it is not a contradiction.' },
                ],
            },
            {
                heading: 'Narrowing it down',
                items: [
                    { icon: '🏷️', html: 'The <strong>grade</strong> chips filter everything — the day panels, the counts, who is awaiting a form, and the printed sheet. A gap in the CEA line is not filled by an available CES.' },
                    { icon: '👥', html: 'They appear only when the week holds <strong>more than one grade</strong>. A single-grade week has nothing to filter, so the chips stay away.' },
                    { icon: '📆', html: 'Tap a day to see only that day. Your grade choice follows you between weeks; the day does not, because its dates belong to the week you were looking at.' },
                ],
            },
            {
                heading: 'What the markers mean',
                items: [
                    { icon: '🕐', html: '<strong>Submitted after initial deadline</strong> — nothing was received from that person until planning had already started.' },
                    { icon: '✏️', html: '<strong>Changed after initial deadline</strong> shows what that day used to say. It appears only on days that actually moved, so wherever you see it, something changed there.' },
                    { icon: '🔄', html: '<strong>Roster changed since this answer</strong> is the opposite: they have not changed their mind — their shift has moved under an answer that was tied to it.' },
                ],
            },
            {
                heading: 'Before you act on it',
                items: [
                    { icon: '🕑', html: 'Availability reflects what staff submitted before the final cut-off. Confirm directly with the person before arranging short-notice cover.' },
                    { icon: '🖨️', html: 'Printing gives you the <strong>whole week</strong> whichever day you are viewing, keeps whichever grade you have chosen, and is stamped with the moment it was read.' },
                ],
            },
        ],
    },
};
