// @ts-check
/**
 * overtime-tips.js — CARD_TIPS for overtime.html's `?` panels.
 *
 * Pure data, no DOM. The shape is the one `tips-lightbox.js` renders and
 * `tips-content.test.mjs` pins — a `?` panel that throws because an entry was hand-added in the
 * old flat shape is a staff-reported production error, which is why that guard exists.
 *
 * The tips carry the two things the interface cannot say often enough without becoming noisy:
 * availability is not allocation, and no response is not "unavailable".
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
                    { icon: '⏰', html: 'There are two deadlines. Answer by the <strong>first</strong> one to be counted from the start of planning; the <strong>final</strong> one is when the form closes for good.' },
                    { icon: '✏️', html: 'You can change your answers as often as you like until the final deadline. Only your latest version counts.' },
                ],
            },
            {
                heading: 'What it does and does not do',
                items: [
                    { icon: '📋', html: 'This tells the roster team when you are <strong>available</strong>. It does not book overtime and does not guarantee any.' },
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
                items: [
                    { icon: '👀', html: 'This list shows every upcoming roster week <strong>whether or not a form exists</strong> — so a week nobody has opened is visible rather than silently absent.' },
                    { icon: '⚠️', html: '<strong>Missed</strong> means no form was ever opened, so nobody was asked and nobody is outstanding. It never means nobody was needed.' },
                    { icon: '🚫', html: 'Once a week\'s final deadline has passed it can no longer be created, and the row stays as <strong>Missed</strong> until that Saturday goes by.' },
                ],
            },
            {
                heading: 'Opening a week',
                items: [
                    { icon: '👁️', html: 'Create always <strong>previews first</strong> — the dates and how many people will be asked — before anything is written.' },
                    { icon: '🔁', html: 'If two people open the same week at once, only one form is created. The second simply opens it.' },
                ],
            },
        ],
    },

    'who-is-available': {
        title: '👥 Who is available',
        sections: [
            {
                items: [
                    { icon: '📊', html: '<strong>No response</strong> and <strong>not available</strong> are different answers. Someone with no form has told us nothing; someone who submitted an unavailable day has told us something.' },
                    { icon: '🕑', html: 'Availability reflects what staff submitted before the final cut-off. Confirm directly with the person before arranging short-notice cover.' },
                    { icon: '📅', html: 'The roster shown beside each person is their <strong>current</strong> one — which may have changed since they submitted.' },
                ],
            },
        ],
    },
};
