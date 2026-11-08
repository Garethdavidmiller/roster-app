// @ts-check
/**
 * newlink-config.js — the new link page's settings, set by hand (newlink.html).
 *
 * The page presents the three shortlisted 26-week proposals to the colleagues who will work the new link. Everything it
 * SAYS about the proposals is generated (newlink-data.js, from the pack's own tooling); everything here is a DECISION, one
 * line each, so a decision can change without the page being touched. All of them are the owner's, 2 Nov 2026, and who
 * leads the change is the owner's of 4 Nov 2026 (CONTACT_ROLE).
 *
 * ── WHO IS IN CHARGE ───────────────────────────────────────────────────────────────────────────
 *
 * S. Silva, as the RMT rep, leads the roster change. The admin built the page and the tooling, and is in charge of neither
 * the change nor the choice (owner, 4 Nov 2026). Nothing the page says may suggest otherwise: no line names the admin as
 * deciding, recommending or collecting views. "Have your say" says who leads the change AND NO MORE: how the choice is made
 * is left deliberately vague, on the page as in the pack (owner: "It is deliberately vague"). The process is recorded in
 * LINKS_DEC2026_PLAN.md's dashboard, not in anything colleagues read. newlink-config.test.mjs and e2e/newlink.spec.js hold
 * the wording to both.
 *
 * ── THE LIFECYCLE ──────────────────────────────────────────────────────────────────────────────
 *
 * `PHASE` is the one switch. 'preview' is the only value built: the page is the admin's and the named previewers'
 * (CONFIG.NEWLINK_PREVIEW — S. Silva, who leads the change, since v25.33), read by auth-policy.js `newlink` and the nav pill's
 * `newlinkAudienceOnly` through `canOpenNewlink`, and they see exactly what colleagues will, with no banner of its own
 * (owner, 8 Nov 2026: "Remove the preview banner as it will be going live soon"). Opening it needs a gate of its own first: a role for AUDIENCE in auth-policy.js and a matching pill
 * flag in nav-panel.js, which page-contract-parity requires to move together. newlink-config.test.mjs refuses any other
 * phase until that gate exists, so the switch cannot be flipped to a page nobody can reach.
 *
 * ── WHAT IT IS NOT ─────────────────────────────────────────────────────────────────────────────
 *
 * Not a ballot: nothing here collects a view, a vote or a name (owner: no voting, no stored feedback). Not a roster: the
 * page never mixes a proposal into the Calendar, Team Week, the day panel or the Pay Calculator, and newlink-boundary
 * .test.mjs fails if any of their modules imports the proposals. Not secret: this file is served to anyone, like every
 * module — it holds decisions and no personal data.
 */
import { teamMembers } from './roster-data.js';

/**
 * When the new link starts: 'YYYY-MM' while only the month is known, 'YYYY-MM-DD' once the day is set. NOT the timetable's
 * date: the new timetable starts in December and the link follows (owner, 2 Nov 2026: "Whilst the new timetable will start
 * in December, the new cea link design will be from January 1st"); and the day is not known (owner, 8 Nov 2026: "Needs to
 * be changed everywhere that the new link will start in January 2027. We don't now know exactly what day"). Until then
 * today's link carries on, and the page says so. The pack's own copy is docs/links-26/tooling/link.mjs → LINK_STARTS,
 * held to this one by newlink-config.test.mjs: change both together when the day is set.
 */
export const STARTS = '2027-01';

/**
 * When the new TIMETABLE starts, 'YYYY-MM-DD' — the day the status line's "comes first, in December" becomes "started in
 * December" (test audit, 7 Nov 2026: the line had no date logic at all). The Trains page owns this date, as `CHANGE_DATE`
 * in trains-data.js; this copy keeps the whole timetable out of this page, and newlink-config.test.mjs fails if the two
 * ever differ.
 */
export const TIMETABLE_STARTS = '2026-12-13';

/**
 * Who colleagues go to about the new link (owner, 2 Nov 2026: "Sara Silva (S. Silva) is the primary contact for it not me"),
 * named in full (owner, 8 Nov 2026: "Where it says tell S. Silva. Can you make that Sara Silva"). Every line that names a
 * person is built from this one, here and in the pack's read-me and presentations (pack.py and the deck builders read it).
 * On the roster, and in every list that holds her identity (CONFIG.NEWLINK_PREVIEW, CONFIG.LINKS_DESIGNERS), she stays
 * S. Silva: newlink-config.test.mjs holds this name to that member.
 */
export const CONTACT = 'Sara Silva';

/**
 * What CONTACT is, as the page words it beside the name: the RMT rep, who leads the change (owner, 4 Nov 2026). A change of
 * contact is a change of this line too.
 */
export const CONTACT_ROLE = 'the RMT rep';

/** @typedef {'preview'} Phase  'preview' alone until the audience gate exists (see the header) */

/** @type {Phase} Where the page is in its life. */
export const PHASE = 'preview';

/**
 * The last day for views, 'YYYY-MM-DD' — or null, which the page words as "a date to be agreed" (owner: "Not set yet").
 * @type {string|null}
 */
export const CLOSES = null;

/**
 * Who the page is for once it opens: the 26 colleagues on the new link (owner: "The exact 26 on the new link"). Not
 * decided yet ("Decide later"), so null stands for everyone on a normal CEA contract today — the people the new link is
 * for. NOT a CEA bilingual contract, which keeps its own links (owner, 8 Nov 2026: "This link will only apply to people
 * with the normal CEA contract and NOT the bilingual contract who will still have their own links"). It is the CONTRACT,
 * `bilingualContract`, as the leave allowance reads it, not the line: M. Campbell, on a normal CEA contract and on the
 * bilingual link from 8 Nov 2026, is on the new link (owner, 8 Nov 2026: "Keep her on the new link"). No page lists them
 * since the preview banner went (8 Nov 2026); newlink-config.test.mjs holds the list to the roster. Set it to the 26 names,
 * spelt as `teamMembers` spells them.
 * @type {ReadonlyArray<string>|null}
 */
export const AUDIENCE = null;

/** The page's audience, as names: AUDIENCE, or everyone on a normal CEA contract while it is null. @returns {string[]} */
export function audienceNames() {
    if (AUDIENCE) return [...AUDIENCE];
    return teamMembers.filter(m => m.role === 'CEA' && !m.bilingualContract && !m.hidden && !m.managerOnly).map(m => m.name);
}

/**
 * Where the pack's PDFs are served. Firebase Hosting serves nothing under docs/ (firebase.json `ignore`); the GitHub
 * Pages mirror serves the whole repository, so the page links there from both addresses. Retiring the mirror breaks
 * these links — move the files into a served folder first.
 */
export const PACK_BASE = 'https://garethdavidmiller.github.io/roster-app/docs/links-26/';

/**
 * "Have your say", in the reader's order: what to do, who leads the change, what the page does not do. DRAFTED from the
 * colleague presentations' last slide ("Tell us what worries you, even if it is small — your feedback goes to the managers
 * with the proposal") and CORRECTED by the owner on 4 Nov 2026: it said the managers decide which link is used, which was
 * not so. It now says who leads the change and no more — how the choice is made is deliberately left unsaid (the header,
 * WHO IS IN CHARGE).
 */
export const HAVE_YOUR_SAY = Object.freeze([
    `Tell ${CONTACT} or your manager what worries you about any of the three, even if it is small.`,
    `${CONTACT}, ${CONTACT_ROLE}, is leading the change.`,
    'There is nothing to fill in here: this page does not collect views or votes.',
]);
