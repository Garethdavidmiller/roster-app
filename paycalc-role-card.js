// @ts-check
/**
 * paycalc-role-card.js — what the Pay Calculator says to somebody it will not price (v25.50).
 *
 * The calculator models CEA and CES pay and nothing else (`gradeForRole`, roster-data.js), and it
 * WITHHOLDS rather than captions for everybody else: its whole output is one confident £ figure, and
 * a member told "this may not apply" and handed one will use it (v21.78, paycalc.md invariant 13).
 * This module holds the WORDS of that refusal, because they differ by who is reading (owner,
 * 7 Nov 2026):
 *
 *   · A DISPATCHER is told their pay is not covered YET, and the real condition for adding it —
 *     confirmed Dispatcher rates — never a date. The app does not make undated promises in staff
 *     copy (CLAUDE.md → "account recovery", which lost its "coming soon"), and the blocker here is
 *     information the admin has to obtain, not code.
 *   · A MANAGER is told who it is for and why they might point their team at it. There is no
 *     "will be added" for them: managers are not in line for it, and saying so would be untrue.
 *   · A SESSION NAME THE ROSTER NO LONGER HOLDS (a leaver, a rename) is told what it is — not a role
 *     gap — and to ask the admin. That case keeps the wording it had.
 *
 * Every version but the last says what the calculator DOES, in one sentence, and links the guide:
 * the app's own order for a surface (CLAUDE.md → "The four things a surface owes a member" —
 * discover, understand, act, deep dive). A refusal that names a page and not what it is for teaches
 * nothing, and the page's own guide link is hidden on the refusal (paycalc.css → role-unsupported).
 *
 * It also holds the explanation on the page's SIGN-IN card (`PAYCALC_SIGN_IN_ABOUT`), for a visitor
 * with no named session: a member whose session lapsed, and the shared staff PIN. The PIN is a
 * barrier, not a sign-in, and carries no name (AUTH_AND_SESSIONS.md 7 and 18), so it cannot open a
 * page that keeps figures under one — and the card says so in those terms, never implying the PIN
 * signs anybody in. The PIN sentence is WORDED FOR EVERYONE rather than shown on detection: this page
 * signs the PIN out moments after it arrives (`reconcileExpiredIdentity`, by design — it does not admit
 * the PIN), so detecting it would mean racing that teardown on a card that is already up.
 */

/** The Pay Calculator Guide. A guide needs no sign-in (auth-policy.js → `guides`), so this link works
 *  for every reader of these cards, the staff PIN included. */
export const PAYCALC_GUIDE_URL = './paycalc-guide.html';

/** What the calculator does — one sentence, naming both grades in full on first sight (CLAUDE.md →
 *  "Plain English that TEACHES"). Third person: its reader is somebody it does NOT serve. */
const WHAT_IT_DOES =
    "It works out a Customer Experience Ambassador's or Supervisor's (CEA or CES) take-home pay from " +
    'the hours they work — Saturdays, Sundays, bank holidays, rest days worked and overtime — after ' +
    'tax, National Insurance and pension.';

/**
 * The refusal card's words for a member the calculator will not price.
 * `what` is null where the card should not explain the calculator (the not-on-the-roster case).
 * @param {string|null|undefined} role  the member's roster `role`; absent for a name the roster lacks
 * @returns {{ title: string, what: string|null, why: string }}
 */
export function unsupportedRoleCopy(role) {
    if (!role) {
        return {
            title: "Your name isn't on the current roster",
            what: null,
            why: "The Pay Calculator needs your roster entry to know your grade and to keep your pay data apart from anyone else's on this device. Ask the admin to check your name.",
        };
    }
    if (role === 'Dispatcher') {
        return {
            title: "The Pay Calculator doesn't cover Dispatcher pay yet",
            what: WHAT_IT_DOES,
            why: 'Dispatcher pay will be added once Dispatcher rates are confirmed. Until then any figure it gave you would be guessed — one that looks right and isn\'t.',
        };
    }
    if (role === 'Management') {
        return {
            title: 'The Pay Calculator is for CEAs and CESs',
            what: WHAT_IT_DOES,
            why: 'If someone in your team asks how their pay is worked out, this is where they can check it.',
        };
    }
    return {
        title: "The Pay Calculator isn't available for your role yet",
        what: WHAT_IT_DOES,
        why: "It only has confirmed rates for CEA and CES pay, and guessing others would give you a figure that looks right and isn't. If you'd like yours added, ask the admin.",
    };
}

/**
 * Fill the refusal card (`#unsupportedGradeBanner`, paycalc.html) for this member. The card's
 * showing and the calculator's hiding stay with the coordinator; this only writes the words.
 * Where the card has nothing to explain (`what` is null), the WHOLE "What it does" box goes —
 * its heading and its guide link with it — not just the sentence, or an empty box is left with a
 * heading over nothing.
 * @param {{ role?: string|null }|null|undefined} member
 * @param {Document} [doc]
 */
export function paintRoleCard(member, doc = document) {
    const copy = unsupportedRoleCopy(member?.role);
    const title = doc.getElementById('unsupportedGradeTitle');
    const what  = doc.getElementById('unsupportedGradeWhat');
    const why   = doc.getElementById('unsupportedGradeWhy');
    const about = doc.getElementById('unsupportedGradeAbout');
    if (title) title.textContent = copy.title;
    if (what) what.textContent = copy.what ?? '';
    if (about) about.hidden = !copy.what;
    if (why) why.textContent = copy.why;
}

/**
 * The explanation on the Pay Calculator's sign-in card (login-overlay.js → `about`): what it does,
 * who it is for, why it needs the reader's own sign-in, and the guide. The footnote is the advice for
 * a shared screen — figures stay in the browser they were typed into (the privacy note's own words).
 * @type {Readonly<{ lines: readonly string[], link: Readonly<{ href: string, label: string }>, footnote: string }>}
 */
export const PAYCALC_SIGN_IN_ABOUT = Object.freeze({
    lines: Object.freeze([
        'Works out your take-home pay from the hours you work, for Customer Experience Ambassadors and Supervisors (CEA and CES).',
        // "you sign in", the verb, and not "your sign-in", the noun: at the card's width the
        // hyphenated noun broke across two lines as "sign-" / "in".
        "It keeps your figures under your own name, so you sign in as yourself — the staff PIN doesn't open it.",
    ]),
    link: Object.freeze({ href: PAYCALC_GUIDE_URL, label: 'Read the Pay Calculator Guide →' }),
    footnote: 'On a shared screen, use your own phone instead — your figures stay in the browser you type them into.',
});
