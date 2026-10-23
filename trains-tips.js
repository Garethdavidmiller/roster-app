// @ts-check
/**
 * trains-tips.js — CARD_TIPS for trains.html's `?` panels.
 *
 * Data, no DOM, in the shape `tips-lightbox.js` renders and `tips-content.test.mjs` pins.
 *
 * ── THE CAVEATS LIVE HERE, AND ONE OF THEM ALSO LIVES ON THE PAGE ───────────────────────────────
 *
 * The page's limits were a fifth card until v24.72. Every other page keeps that kind of depth behind
 * its cards' `?`, so they moved here — except "December times can still change", which is the one a
 * member must not miss before telling a passenger something, so it also stays on the page itself:
 * one line beneath the tabs, on every view (v24.92 — it was in the overview card, which now opens
 * collapsed on a return visit). Discovery may not depend on opening a panel.
 *
 * ── NOTHING HERE IS TYPED TWICE ─────────────────────────────────────────────────────────────────
 *
 * Every date, window and threshold is read from where the page's own code reads it — the change
 * date, the books' validity, the daytime hours, the 20-minute "same train" rule, the lookup's 15
 * minutes (v24.83: each was written out by hand, and a change to any of them left these panels
 * saying the old one with every test green). What is left to go stale is the prose; when the
 * timetable data or the page's rules change, read it.
 */

import { CHANGE_DATE, FURTHER_CHANGES_UNTIL, DEC_VALID_UNTIL, LEAF_FALL } from './trains-data.js';
import { MAX_SHIFT_MIN, NEAR_WINDOW_MIN, dateWords } from './trains-change.js';
import { DAYTIME } from './trains-render.js';

// The strings below name only what is imported here — tips-content.test.mjs evaluates them with the
// real values, so a constant used without being imported fails there rather than reading "undefined".

export const CARD_TIPS = {
    'overview': {
        title: '🗓️ New timetable',
        sections: [
            {
                items: [
                    { icon: '📅', html: `Chiltern's new timetable starts on <strong>${dateWords(CHANGE_DATE, 0, { weekday: true })}</strong>. Until then the trains in this page's first column are the ones running; from then, the second.` },
                    { icon: '🚆', html: 'The totals count every passenger train <strong>leaving Marylebone</strong> on that kind of day. Two trains coupled together count once, because they leave as one.' },
                    { icon: '🗓️', html: 'A few of today\'s weekday trains run only on <strong>Mondays and Fridays</strong>, or only <strong>Tuesday to Thursday</strong>. Weekday counts are for a Tuesday to Thursday; the trains themselves are listed with their days.' },
                    { icon: '⚠️', html: 'December times can still change. Before you tell a customer, check the journey planner on the Chiltern Railways website.' },
                    { icon: '🎄', html: `<strong>Christmas and New Year are not on this page.</strong> Chiltern says it will change times again between ${dateWords(CHANGE_DATE)} and ${dateWords(FURTHER_CHANGES_UNTIL)}, with big changes over Christmas and New Year, and Amersham-line times may change during those weeks too. For those dates, check the journey planner nearer the time.` },
                ],
            },
            {
                heading: 'Where these times come from',
                items: [
                    { icon: '📄', html: `First column: Chiltern's public timetables, valid until ${dateWords(CHANGE_DATE, -1, { weekday: true })}.` },
                    { icon: '📄', html: `From ${dateWords(CHANGE_DATE)}: Chiltern's new public timetables, valid until ${dateWords(DEC_VALID_UNTIL, 0, { weekday: true })} ${DEC_VALID_UNTIL.slice(0, 4)}.` },
                    { icon: '🍂', html: `Today's Amersham-line timetable is Chiltern's <strong>leaf-fall</strong> one: until ${dateWords(LEAF_FALL.until)}, trains to London on that line leave up to ${LEAF_FALL.minutes} minutes earlier than usual. The new timetable does not include that, so small differences coming back on that line may be leaf fall.` },
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
                    { icon: '👆', html: 'Tap a change to open that station and see everything about it — including every train a few minutes earlier or later, which this list leaves out.' },
                    { icon: '🟢', html: '<strong>More trains</strong> means more trains or a new direct service, <strong>Fewer trains</strong> fewer or none, <strong>Times move</strong> the same trains at different times.' },
                    { icon: '☀️', html: `<strong>Daytime</strong> means ${DAYTIME}. It is not a fare: off-peak tickets have their own times.` },
                ],
            },
            {
                heading: 'One line per story',
                items: [
                    { icon: '🔗', html: 'When the same trains are added, or taken away, at several stations, that is one line, named by where the trains go. <strong>They also stop at</strong> lists the other stations they call at; <strong>5 of them also stop at</strong> means only five of those trains call there.' },
                ],
            },
        ],
    },

    'stations': {
        title: '🚉 Stations',
        sections: [
            {
                items: [
                    { icon: '⌨️', html: 'Start typing a station, or tap one of the busiest. Short forms work too: <strong>Moor St</strong>, <strong>Gerrards X</strong>, <strong>Oxford Pkwy</strong>, <strong>Bham</strong>, <strong>Gt Missenden</strong>, or the three-letter code. Press Enter to open the first match. The card answers in one sentence first, then the figures, today beside December.' },
                    { icon: '🔢', html: `<strong>Daytime</strong> means ${DAYTIME}. <strong>2 (1 in some hours)</strong> trains an hour means most daytime hours have two trains, and some have only one; <strong>1 to 3</strong> means no one number is true of most hours.` },
                    { icon: '🕐', html: '<strong>Going there</strong>, every time is when the train leaves <strong>Marylebone</strong>. <strong>Coming back</strong>, it is when the train leaves the station on the card, with the time it gets into Marylebone underneath.' },
                    { icon: '🔁', html: `<strong>Train by train</strong> lists only the trains that change; the ones that stay the same are one tap further. A train counts as the same train when it leaves within ${MAX_SHIFT_MIN} minutes of its old time. Beyond that it shows as removed, and the new one as a new train.` },
                    { icon: '🚏', html: '<strong>No longer stops here</strong> is a train that still runs but passes this station; <strong>Will stop here</strong> is one that already ran and now calls here too. A train that no longer comes this far says where it now ends — or, coming back, where it starts.' },
                ],
            },
            {
                heading: 'Good to know',
                items: [
                    { icon: '➡️', html: 'Some trains run on past where most of their line stops: <strong>Aylesbury Vale Parkway</strong> trains are Aylesbury trains via Amersham run on, and <strong>Birmingham Snow Hill</strong> and <strong>Stourbridge Junction</strong> trains are Moor Street trains run on.' },
                    { icon: '🗓️', html: 'A few weekday trains run at different times on <strong>Mondays and Fridays</strong>. Those are marked under the time.' },
                ],
            },
        ],
    },

    'pattern': {
        title: '🕰️ Where they stop',
        sections: [
            {
                items: [
                    { icon: '🔂', html: `Between ${DAYTIME} most hours repeat the same trains. Each column is one of them: <strong>:06</strong> at the top means it leaves Marylebone at 10:06, 11:06, 12:06 and so on.` },
                    { icon: '⚫', html: 'A dot means that train stops at that station every hour; a <strong>half dot</strong> means only in some hours. <strong>4 of 6 hours</strong> under a time means it does not run every hour.' },
                    { icon: '👆', html: 'Tap a time at the top to show only the stations that train stops at. Tap it again, or <strong>Show every station</strong>, for the whole picture. The rows are in two groups, the main line and the Aylesbury line via Amersham, as Chiltern’s two timetable books divide them.' },
                    { icon: '🧠', html: 'It is the one thing worth learning by heart: know it and you can answer most daytime questions without looking anything up.' },
                ],
            },
            {
                heading: `From ${dateWords(CHANGE_DATE)}`,
                items: [
                    { icon: '🟢', html: 'A green ring is a stop a train gains; a hollow red dot is one it loses.' },
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
                    { icon: '💬', html: `If a train leaves at exactly that time on the day chosen above, the answer says what happens to it from ${dateWords(CHANGE_DATE)} — and, once the new timetable has started, what it used to be.` },
                    { icon: '↔️', html: `Underneath, every train leaving Marylebone within ${NEAR_WINDOW_MIN} minutes either side, in both timetables, for the day chosen above.` },
                ],
            },
        ],
    },
};
