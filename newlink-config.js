// @ts-check
/**
 * newlink-config.js — the new link page's settings, set by hand (newlink.html).
 *
 * The page presents the three shortlisted 26-week proposals to the colleagues who will work the new link. Everything it
 * SAYS about the proposals is generated (newlink-data.js, from the pack's own tooling); everything here is a DECISION, one
 * line each, so a decision can change without the page being touched. All of them are the owner's, 2 Nov 2026.
 *
 * ── THE LIFECYCLE ──────────────────────────────────────────────────────────────────────────────
 *
 * `PHASE` is the one switch. 'preview' is the only value built: the page is the admin's alone (auth-policy.js `newlink`
 * is admin-only and its nav pill `adminOnly`), and it wears a banner saying so — under which the admin sees exactly what
 * colleagues will. Opening it needs a gate of its own first: a role for AUDIENCE in auth-policy.js and a matching pill
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
 * When the new link starts, 'YYYY-MM-DD'. NOT the timetable's date: the new timetable starts in December and the link
 * follows on 1 January (owner, 2 Nov 2026: "Whilst the new timetable will start in December, the new cea link design
 * will be from January 1st"). Until then today's link carries on, and the page says so.
 */
export const STARTS = '2027-01-01';

/**
 * Who colleagues go to about the new link, spelt as `teamMembers` spells them (owner, 2 Nov 2026: "Sara Silva (S. Silva)
 * is the primary contact for it not me"). Every line that names a person is built from this one.
 */
export const CONTACT = 'S. Silva';

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
 * decided yet ("Decide later"), so null stands for every CEA on the roster today — the people a CEA link is for — and the
 * preview lists them, so the admin can check who it would reach. Set it to the 26 names, spelt as `teamMembers` spells them.
 * @type {ReadonlyArray<string>|null}
 */
export const AUDIENCE = null;

/** The page's audience, as names: AUDIENCE, or every CEA on the roster while it is null. @returns {string[]} */
export function audienceNames() {
    if (AUDIENCE) return [...AUDIENCE];
    return teamMembers.filter(m => m.role === 'CEA' && !m.hidden && !m.managerOnly).map(m => m.name);
}

/**
 * Where the pack's PDFs are served. Firebase Hosting serves nothing under docs/ (firebase.json `ignore`); the GitHub
 * Pages mirror serves the whole repository, so the page links there from both addresses. Retiring the mirror breaks
 * these links — move the files into a served folder first.
 */
export const PACK_BASE = 'https://garethdavidmiller.github.io/roster-app/docs/links-26/';

/**
 * "Have your say", in the reader's order: what to do, where it goes and who decides, what the page does not do. DRAFTED from
 * the colleague presentations' last slide ("Tell us what worries you, even if it is small — your feedback goes to the
 * managers with the proposal") for the owner to correct. Who decides is said HERE, beside the views it answers — it sat in
 * the faint last line under the cards until the review of 2 Nov 2026.
 */
export const HAVE_YOUR_SAY = Object.freeze([
    `Tell ${CONTACT} or your manager what worries you about any of the three, even if it is small.`,
    'Your views go to the managers with the proposals, and the managers decide which link is used.',
    'There is nothing to fill in here: this page does not collect views or votes.',
]);
