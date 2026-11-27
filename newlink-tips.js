// @ts-check
/**
 * newlink-tips.js — CARD_TIPS for newlink.html's `?` panels (owner, 26 Nov 2026).
 *
 * Pure data, no DOM, in the shape `tips-lightbox.js` renders and `tips-content.test.mjs` pins. The page's cards
 * already teach in place (newlink-render.js: what a link is, the key above the weeks, the key under each table), so a
 * panel here answers the questions a colleague meeting the page cold asks NEXT — how do I read this, what does it
 * mean for me, what happens now — and never restates a figure: every figure on the page comes from the rotas
 * (`newlink-data.js`), and a copy here would be the one that went stale.
 *
 * ── RULES AN EDIT CAN BREAK ─────────────────────────────────────────────────────────────────────
 *
 * 1. **Nothing here says who decides, beyond who LEADS.** The change is led by `CONTACT`, `CONTACT_ROLE`, imported
 *    — never a name typed again — and the page makes no decision (`.claude/rules/link-designer.md`, the opening).
 * 2. **Nothing here has a tense.** The status line's words follow the date and the choice (`renderStatus`,
 *    newlink-render.js); a panel cannot, so it says only what stays true: the page decides nothing, and who leads.
 * 3. **The roster words link to the glossary by themselves**: a panel that says "Spare" or "RDW" ends with "What
 *    these words mean" (glossary.js), so no tip needs to define them again.
 */

import { CONTACT, CONTACT_ROLE } from './newlink-config.js';

export const CARD_TIPS = Object.freeze({
    status: {
        title: 'The new link: three proposals',
        sections: [
            { heading: 'What this page is', items: [
                { icon: '🔁', html: 'A <strong>link</strong> is the set of weeks everyone works through in turn, one week each, then on to the next. The new link replaces today’s for the people on the main CEA roster.' },
                { icon: '📋', html: 'The three proposals are shown A to Z, never ranked. Tap a name to see its weeks.' },
                // No invitation: the page stops inviting views once a design is chosen or the start has come (newlink-config.js →
                // CHOSEN), and a static panel cannot know which (regression review, 26 Nov 2026). "Have your say" invites, while it may.
                { icon: '💬', html: `This page decides nothing: it shows the proposals and what they would mean. ${CONTACT}, ${CONTACT_ROLE}, is leading the change.` },
            ] },
            { heading: 'Your own roster', items: [
                { icon: '🗓️', html: 'Nothing here changes your roster or your calendar. Until the new link starts, you work today’s.' },
            ] },
        ],
    },
    means: {
        title: 'What it means if you…',
        sections: [
            { items: [
                { icon: '👆', html: 'Pick the tile most like you. The table then puts today’s link beside the three proposals, for the things that matter to someone like you.' },
                { icon: '🟩', html: '<strong>Green</strong> marks the best of the three for you. It is not a recommendation: what matters most is yours to weigh.' },
                { icon: '📋', html: '“<strong>Up to</strong>” is when a cover week falls in the worst place: its four shifts land as badly as they can, and its Sunday is worked as overtime too.' },
            ] },
        ],
    },
    weeks: {
        title: 'The weeks',
        sections: [
            { items: [
                { icon: '➡️', html: 'Each row is one week. Next week you move to the row below, and from the last row back to the first.' },
                { icon: '🎨', html: 'The colours are in the key above the weeks: Early, Late and RD, a rest day.' },
                { icon: '📋', html: 'A <strong>cover week</strong> is a Spare week: four shifts between Monday and Saturday, set nearer the time, to cover leave and absence.' },
                { icon: '💼', html: 'A Sunday shift is overtime, worked as RDW, because Sundays are not part of the contract.' },
                { icon: '🔢', html: 'The weeks are numbered, not dated: who starts on which week is decided later.' },
            ] },
        ],
    },
});
