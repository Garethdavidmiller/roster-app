// @ts-check
/**
 * trains-tips.js — CARD_TIPS for trains.html's `?` panels.
 *
 * Pure data, no DOM, in the shape `tips-lightbox.js` renders and `tips-content.test.mjs` pins.
 *
 * ── THE CAVEATS LIVE HERE, AND ONE OF THEM ALSO LIVES ON THE PAGE ───────────────────────────────
 *
 * The page's limits (no December stopping stations, a draft weekday plan, joined trains counted
 * once, Aylesbury's two routes) were a fifth card until v24.72. Every other page keeps that kind of
 * depth behind its cards' `?`, so they moved here — except "December times can still change", which
 * is the one a member must not miss before telling a passenger something, so it also stays in the
 * overview card's own text. Discovery may not depend on opening a panel.
 *
 * These go stale silently. When the timetable data or the page's rules change, read these.
 */

export const CARD_TIPS = {
    'overview': {
        title: '🗓️ New timetable',
        sections: [
            {
                items: [
                    { icon: '📅', html: 'Chiltern\'s new timetable starts on <strong>Sunday 13 December 2026</strong>. Until then the trains in this page\'s <strong>Now</strong> column are the ones running.' },
                    { icon: '🚆', html: 'The totals count every passenger train <strong>leaving Marylebone</strong> on that kind of day. Two trains coupled together count once, because they leave as one.' },
                    { icon: '⚠️', html: 'December times can still change before the 13th. Before you tell a customer, check the journey planner on the Chiltern Railways website.' },
                ],
            },
            {
                heading: 'Where these times come from',
                items: [
                    { icon: '📄', html: 'Now: Chiltern\'s public timetables, valid until 11 December 2026.' },
                    { icon: '📄', html: 'From 13 December: Chiltern\'s December 2026 Marylebone timetable plan. The weekend plans are final; the weekday plan is still a draft.' },
                ],
            },
        ],
    },

    'changes': {
        title: '🔔 What’s changing',
        sections: [
            {
                items: [
                    { icon: '📋', html: 'The biggest changes to trains <strong>leaving Marylebone</strong> on the day chosen above, one line per station, biggest first.' },
                    { icon: '👆', html: 'Tap a change to open that station and see everything about it.' },
                    { icon: '🟢', html: '<strong>More</strong> means more trains or a new direct service, <strong>Less</strong> fewer or none, <strong>Moved</strong> the same trains at different times.' },
                ],
            },
            {
                heading: 'Why the list is short for now',
                items: [
                    { icon: '⏳', html: 'December’s stops are not published yet, so only trains that end at a station can be compared — a line that ends <strong>counting only the trains that end there</strong> is one of those. More changes appear here once Chiltern publishes its December timetable.' },
                ],
            },
        ],
    },

    'stations': {
        title: '🚉 Stations',
        sections: [
            {
                items: [
                    { icon: '⌨️', html: 'Start typing a station, or tap one of the busiest. Short forms work too: <strong>Moor St</strong>, <strong>Gerrards X</strong>, <strong>Oxford Pkwy</strong>, <strong>Bham</strong>, or the three-letter code. The card answers in one sentence first, then the figures, today beside December.' },
                    { icon: '🔢', html: '<strong>Off-peak</strong> means 10:00 to 16:00. <strong>1 to 2</strong> trains an hour means some off-peak hours have one train and some have two.' },
                    { icon: '🕐', html: 'Every time is at <strong>Marylebone</strong> — when a train leaves, or gets in. <strong>Fastest journey</strong> is the one figure measured at the other station.' },
                    { icon: '↩️', html: '<strong>Coming back</strong> shows the trains from that station into Marylebone.' },
                    { icon: '🔁', html: '<strong>Train by train</strong> lists only the trains that change; the ones that stay the same are one tap further. A train counts as the same train when it leaves within 20 minutes of its old time. Beyond that it shows as removed, and the new one as a new train.' },
                ],
            },
            {
                heading: 'Good to know',
                items: [
                    { icon: '⏳', html: 'December’s stops are not published yet. Until they are, a station most trains run through compares only the <strong>trains that end there</strong>, and says so at the top of the card; where no train ends, the card says it is waiting.' },
                    { icon: '➡️', html: 'Some trains run on past where most of their line stops: <strong>Aylesbury Vale Parkway</strong> trains are Aylesbury trains via Amersham run on, and <strong>Birmingham Snow Hill</strong> and <strong>Stourbridge Junction</strong> trains are Moor Street trains run on.' },
                    { icon: '🗓️', html: 'A few weekday trains run at different times on <strong>Mondays and Fridays</strong>. Those are marked under the time.' },
                ],
            },
        ],
    },

    'pattern': {
        title: '🕰️ Every hour',
        sections: [
            {
                items: [
                    { icon: '🔂', html: 'Between 10:00 and 16:00 most hours repeat the same trains. Each column is one of them: <strong>:06</strong> at the top means it leaves Marylebone at 10:06, 11:06, 12:06 and so on.' },
                    { icon: '⚫', html: 'A dot means that train stops at that station. Read down a column to see where it goes; read across a row to see which trains a station gets.' },
                    { icon: '🧠', html: 'It is the one thing worth learning by heart: know it and you can answer most daytime questions without looking anything up.' },
                ],
            },
            {
                heading: 'From 13 December',
                items: [
                    { icon: '🟢', html: 'A green ring is a stop a train gains; a hollow red dot is one it loses.' },
                    { icon: '⏳', html: 'Until December’s stops are published, each December column shows only where that train ends.' },
                ],
            },
        ],
    },

    'lookup': {
        title: '🔎 Look up a time',
        sections: [
            {
                items: [
                    { icon: '⌨️', html: 'Type a time the way you would say it: <strong>17:15</strong>, <strong>1715</strong>, <strong>5.15pm</strong> or <strong>515pm</strong> all work. Without am or pm, <strong>515</strong> means 05:15.' },
                    { icon: '💬', html: 'If a train leaves at exactly that time today, the answer says what happens to it from 13 December.' },
                    { icon: '↔️', html: 'Underneath, every train leaving Marylebone within 15 minutes either side, today and from 13 December, for the day chosen above.' },
                ],
            },
        ],
    },
};
