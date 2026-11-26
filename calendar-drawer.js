// @ts-check
/**
 * calendar-drawer.js — the Calendar's menu (the shared drawer), built for whoever is signed in
 * WHEN IT IS BUILT, and able to be built again.
 *
 * ── WHY THIS IS ITS OWN MODULE ───────────────────────────────────────────────────────────────────
 *
 * The drawer is set up as the page loads, BEFORE access is decided, so that a locked visitor still
 * has it (the guides, the documents, About). Everything in it that depends on who is signed in — the
 * page pills a member may open, the name and initials in its footer, Sign out, the bell, and which
 * opens the usage counters leave out — is fixed at that moment by `initNavPanel`. Until v26.40 that
 * did not matter: a member who signed in on the Calendar reloaded it, and the reload built the drawer
 * again for them.
 *
 * Signing in WITHOUT the reload (v26.40, `finishSignIn` in calendar-access.js)
 * needs a way to rebuild it in place. The rest of the app already has one: `resetNavPanel()` then `initNavPanel()`
 * again, which the Overtime page uses after its own in-place sign-in and `page-session.js` uses when
 * a session is lost. This module gives the Calendar the same pair:
 *
 *   · `calendarDrawerOptions(session, deps)` — PURE: which drawer this session gets. Tested without a
 *     browser.
 *   · `wireCalendarDrawer(deps)` — builds it for the session saved now. The page calls it once, at
 *     load, exactly where it used to call `initNavPanel` itself.
 *   · `rewireCalendarDrawer()` — takes the drawer down and builds it again for the session saved
 *     NOW, with the same page hooks. Its one caller is the page's `onSignedInInPlace`, which
 *     calendar-access.js's `finishSignIn` runs when a sign-in on a lock card is granted without a
 *     reload.
 *
 * Who is signed in is read from the SAVED SESSION, never from the name chosen in the picker: on the
 * station PC the picker is whichever row was chosen last, and the drawer's identity is also the
 * usage counters' admin exclusion (usage-reporter.js has the reasoning). With no session saved,
 * the drawer has no name, no Sign out and no admin pills ("End staff PIN" went with the PIN, 23 Nov 2026).
 */

import { initNavPanel, resetNavPanel } from './nav-panel.js';
import { getSession } from './session.js';
import { navGatesFor } from './auth-policy.js';   // pill gating only — never a boundary

/**
 * The page hooks the drawer is wired to. They do not depend on who is signed in, so a rebuild reuses
 * them unchanged.
 * @typedef {object} CalendarDrawerDeps
 * @property {Promise<any>} authReady   the AUTH promise, not the access one: it gates the Circular and
 *                                      Newsletter open counters, which are Firestore writes (v20.22)
 * @property {() => void} onLogoClick   opens the Calendar's About panel
 * @property {() => void} onSignOut     the page's sign-out (`signOutAndLeave`)
 * @property {() => boolean} canReadDocuments  may the drawer's two document links read? (v23.17)
 */

/**
 * The drawer a session gets. Pure: the same session and hooks always give the same options.
 * @param {{ name?: string }|null|undefined} session  the SAVED session, or none (locked)
 * @param {CalendarDrawerDeps} deps
 * @returns {Parameters<typeof initNavPanel>[0]}
 */
export function calendarDrawerOptions(session, deps) {
    const name = session?.name || null;
    return {
        authReady: deps.authReady,
        currentPage: 'calendar',
        // Also the drawer's open-counter exclusion identity: the SESSION only, never the selected
        // member (v25.00) — see the module header.
        memberName: name,
        ...navGatesFor(name),   // the pill gates (auth-policy.js); all false with no session
        onLogoClick: deps.onLogoClick,
        // No session, no Sign out: the drawer then renders no member footer at all.
        onSignOut: name ? () => deps.onSignOut() : null,
        canReadDocuments: deps.canReadDocuments,
    };
}

/** The hooks the drawer was last wired with, so a rebuild needs nothing passed in. @type {CalendarDrawerDeps|null} */
let _deps = null;

/**
 * Build the drawer for the session saved now. Called once, at load.
 * @param {CalendarDrawerDeps} deps
 */
export function wireCalendarDrawer(deps) {
    _deps = deps;
    initNavPanel(calendarDrawerOptions(getSession(), deps));
    gateQuickButtons(getSession()?.name || null);
}

/**
 * The Calendar's own ways into Admin and Pay follow the drawer's pills, from the same gate (polish review,
 * 26 Nov 2026): an Other Staff login is refused both pages, and was offered the 📝 Admin and 💷 Pay pair, and the
 * leave panel's "Record leave", that the drawer did not offer it. The PAIR goes as one (its wrapper is one flex item,
 * and an empty one left the row off centre). With no session they stay, as each page asks for a sign-in itself. Not a
 * boundary: the pages refuse in place whatever is drawn here.
 * @param {string|null} name  the SAVED session's name
 * @param {{ getElementById: (id: string) => any }|null} [doc]  null where there is no page (a Node caller)
 */
export function gateQuickButtons(name, doc = (typeof document === 'undefined' ? null : document)) {
    if (!doc) return;
    const refused = !!name && !navGatesFor(name).isNotOtherStaff;
    const pair = doc.getElementById('adminBtn')?.closest?.('.control-group--pair') ?? doc.getElementById('adminBtn');
    if (pair) pair.hidden = refused;
    const payBtn = doc.getElementById('payBtn');
    if (payBtn && !pair?.contains?.(payBtn)) payBtn.hidden = refused;
    const record = doc.getElementById('alLbRecordLink');
    if (record) record.hidden = refused;
}

/**
 * Take the drawer down and build it again for the session saved NOW — after a sign-in that did not
 * reload the page (calendar-access.js → `finishSignIn`). `resetNavPanel` closes an open drawer, its two lightboxes and their history entry
 * first, so this is safe whatever is open. Does nothing before `wireCalendarDrawer` has run.
 * @returns {boolean} whether a drawer was rebuilt
 */
export function rewireCalendarDrawer() {
    if (!_deps) return false;
    resetNavPanel();
    initNavPanel(calendarDrawerOptions(getSession(), _deps));
    gateQuickButtons(getSession()?.name || null);
    return true;
}
