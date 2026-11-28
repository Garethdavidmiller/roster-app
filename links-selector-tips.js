// @ts-check
/**
 * links-selector-tips.js — CARD_TIPS for links-selector.html's one `?` panel: what the page is and how to read it
 * (owner, 28 Nov 2026: "There is nothing on Links Selector to say what it is and how to use it").
 *
 * Pure data, no DOM, in the shape `tips-lightbox.js` renders and `tips-content.test.mjs` pins. The SAME panel is the
 * first-visit orientation (links-selector-app.js opens it once, by itself), so a colleague meets these words before they
 * have to find a button — and the words have one home, not a notice's copy beside the panel's.
 *
 * ── RULES AN EDIT CAN BREAK ─────────────────────────────────────────────────────────────────────
 *
 * 1. **The order is the one a newcomer needs** (staff-copy.md: discover → understand → act → deep dive): what it is and
 *    is not, how to use it, what the grid shows, and where to go next. Never lead with a gesture.
 * 2. **No date, length or count is typed** — not even how many proposals there are: the start comes from `startDate()` and the line count from `ROTATING_LINES`, so a
 *    moved start date or a new proposal length cannot leave a stale sentence here.
 * 3. **The cover-week and Sunday lines are the day panel's own words**, and the New CEA Link page's — held by
 *    links-selector-core.test.mjs, which reads this file too. The Christmas line is the day panel's rule, said for both
 *    days at once rather than for the one day the panel shows.
 * 4. **No link out of the panel.** A link out of a lightbox must go through `followLinkOutOf` (CLAUDE.md), which the
 *    shared panel does not offer; the New CEA Link page is named, and About carries its link.
 */

import { ROTATING_LINES } from './link-designer-design.js';
import { startDate } from './links-selector-core.js';
import { formatDayMonthYear, DAY_NAMES_FULL } from './date-format.js';

const START = startDate();
const START_WORDS = `${DAY_NAMES_FULL[START.getDay()]} ${formatDayMonthYear(START)}`;

export const CARD_TIPS = Object.freeze({
    selector: {
        title: 'How to read the Links Selector',
        sections: [
            { heading: 'What it is', items: [
                { icon: '🗓️', html: 'A <strong>proposal</strong> for the new CEA link, drawn on dates the way the Calendar draws your roster, so you can see what your months would look like.' },
                { icon: '🔁', html: 'A <strong>link</strong> is the set of weeks everyone works through in turn. Each week of it is a <strong>line</strong>: a line here is a week on the New CEA Link page, and a LINE on the printed proposal sheets.' },
                { icon: '🛡️', html: '<strong>A proposal, not your roster.</strong> Your own roster carries on as it is, and nothing you choose here is saved anywhere but this device.' },
            ] },
            { heading: 'How to use it', items: [
                { icon: '1️⃣', html: 'Choose a <strong>proposal</strong> at the top.' },
                { icon: '2️⃣', html: `Choose the <strong>line</strong> you’d be on in its first week, from ${START_WORDS} (date not final). Who starts on which line is decided later, so try a few.` },
                { icon: '⬇️', html: `Each Sunday you move down one line, and after line ${ROTATING_LINES} comes line 1. Swipe, or use ← Prev and Next →, to see the months after.` },
                { icon: '👆', html: 'Select a day to see its shift, its line and what it means. The 🚩 button goes back to the month the link starts.' },
                { icon: '🔗', html: 'The address keeps your choice, so you can send a colleague exactly what you see.' },
            ] },
            { heading: 'What the days show', items: [
                { icon: '⬜', html: 'Days before the link starts are blank: today’s link still runs then.' },
                { icon: '📋', html: 'A <strong>cover week</strong> shows as Spare: four shifts between Monday and Saturday, set nearer the time, to cover leave and absence.' },
                { icon: '💼', html: 'Sunday shifts are overtime.' },
                { icon: '🎄', html: 'On Christmas Day and Boxing Day, a day you’d be due at work is annual leave that does not come off the allowance.' },
                { icon: '🚫', html: 'No leave, absence or changed shift is shown: a proposal has none.' },
            ] },
            { heading: 'To compare them', items: [
                { icon: '⚖️', html: 'The New CEA Link page sets the proposals side by side, in words and figures. It is in the menu, and linked from About.' },
            ] },
        ],
    },
});
