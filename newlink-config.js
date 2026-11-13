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
 * `PHASE` is the one switch. 'preview' (v25.06 to v25.59): the page was the admin's and the named previewers'
 * (CONFIG.NEWLINK_PREVIEW — S. Silva, who leads the change, since v25.33), and they saw exactly what colleagues would, with no
 * banner of its own (owner, 8 Nov 2026: "Remove the preview banner as it will be going live soon"). 'open' since v25.60
 * (owner, 9 Nov 2026: "send the new links section live for everyone with a cea contract and the managers"): the gate it
 * needed is auth-policy.js's `newlinkAudience` role — every colleague on a normal CEA contract, and the managers — read by
 * the `newlink` policy and, through `canOpenNewlink`, by the nav pill's `newlinkAudienceOnly`. The role is written there
 * rather than imported from here, because newlink-boundary.test.mjs keeps this file out of the roster pages' reach.
 * newlink-config.test.mjs holds the switch, the role and the pill to one story: past 'preview' exactly while the policy admits
 * the audience, and the role equal to `audienceNames()` and the managers for every name on the roster. 'decided' (owner,
 * 10 Nov 2026) is set by naming the chosen design in CHOSEN, and changes what the page SAYS, never who may read it.
 *
 * ── WHAT IT IS NOT ─────────────────────────────────────────────────────────────────────────────
 *
 * Not a ballot: nothing here collects a view, a vote or a name (owner: no voting, no stored feedback). Not a roster: the
 * page never mixes a proposal into the Calendar, Team Week, the day panel or the Pay Calculator, and newlink-boundary
 * .test.mjs fails if any of their modules imports the proposals. Not secret: this file is served to anyone, like every
 * module. It holds decisions, and names one person — CONTACT, with CONTACT_ROLE — on the owner's instruction (4 Nov 2026);
 * nothing a stranger should not read belongs here.
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
 * On the roster, and in every list that holds her identity (CONFIG.NEWLINK_PREVIEW), she stays S. Silva:
 * newlink-config.test.mjs holds this name to that member.
 */
export const CONTACT = 'Sara Silva';

/**
 * What CONTACT is, as the page words it beside the name: the RMT rep, who leads the change (owner, 4 Nov 2026). A change of
 * contact is a change of this line too.
 */
export const CONTACT_ROLE = 'the RMT rep';

/**
 * The design chosen for the new link, by its name on the page — 'Balanced V6', 'Level Crossing' or 'Middle Ground' — or null
 * while nothing is decided. THE ONE LINE THAT SWITCHES THE PAGE TO 'decided' (owner, 10 Nov 2026: "Add a 'decided' state"):
 * the status card then says which design has been chosen and when the link starts, and the page stops inviting views — no
 * "For discussion, not a decision", no "Have your say". A name that is not one of the three is refused (the page goes on as
 * though nothing were chosen) and newlink-config.test.mjs fails on it. Still null when the link's start (STARTS) comes, the
 * page stops inviting views anyway and says only that CONTACT will confirm the outcome — it never names a design itself.
 * @type {string|null}
 */
export const CHOSEN = null;

/** @typedef {'preview'|'open'|'decided'} Phase  'preview' until v25.59, 'open' since v25.60, 'decided' once CHOSEN is set */

/** @type {Phase} Where the page is in its life. 'decided' FOLLOWS from CHOSEN, so the two cannot disagree; the page is open to
 *  the same people in both (auth-policy.js `newlink`). Back to 'preview' would be an edit to this line. */
export const PHASE = CHOSEN ? 'decided' : 'open';

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
 * bilingual link from 8 to 21 Nov 2026 (the main link from 22 Nov), is on the new link (owner, 8 Nov 2026: "Keep her on
 * the new link"); K. Jedlinski, a CES from 22 Nov 2026, is not, which this list reads off the grade. No page lists them
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
 * Pages mirror serves the whole repository, so the page reads them from there on both addresses — in the app's PDF viewer
 * (pdf-viewer.js), which is why the CSP's connect-src names the mirror. Retiring the mirror breaks the pack — move the
 * files into a served folder first.
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
