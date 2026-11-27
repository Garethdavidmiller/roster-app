// @ts-check
/**
 * auth-policy.js — the page-AUTHORISATION layer (AUTH_AND_SESSIONS.md → Architecture, Layer 2).
 *
 * Authentication ("who are you?") is `auth-state.js` (the store). This module answers the
 * SEPARATE question "is this identity allowed on this page?" via a declarative policy map
 * (`PAGE_POLICIES`) and a PURE decision function (`requirePageAuth`). `needsLogin`/`forbidden`
 * are decisions here, never identity states — the same `named` user is allowed on Admin but
 * forbidden on Operations.
 *
 * ── THE INVARIANT (read first) ────────────────────────────────────────────────────────────
 * This is CLIENT-side UX, NEVER the security boundary. The real boundary is Firestore Rules +
 * Cloud Functions claim checks (server-side). A decision here only chooses what the client
 * *renders* and *attempts*; it can never grant access the server would refuse. So the role
 * check below (does the member's NAME appear in CONFIG.ADMIN_NAMES / MANAGER_NAMES /
 * LINKS_DESIGNERS) is a UX optimisation, not enforcement.
 *
 * ── Reads hydrate optimistically; writes authorise strictly ───────────────────────────────
 * Phase 3 is PAGE-level (may the user be on this page / see privileged UI). The finer
 * read-vs-write distinction is an ACTION-level concern realised when coordinators consume this
 * (Phase 4+): the policy keys can later grow `page → page.action` WITHOUT changing the reducer,
 * because granularity lives entirely in this authz layer. Not built on day one.
 *
 * Pure: `requirePageAuth(snapshot, policy, roles)` has no I/O. The thin `rolesFor(member)` glue
 * (which reads CONFIG) and the `requirePage(snapshot, page)` convenience are the only impure bits.
 * WIRED IN (Phase 4–7): every protected coordinator calls `requirePage(...)` for its access gate, and
 * `guardNamedSession` (page-session.js) for the B1 enforcement decision — behaviour-preserving (CLIENT UX only; Firestore
 * Rules + Functions claim checks remain the real boundary).
 */
import { CONFIG, teamMembers, isOtherStaff } from './roster-data.js';

/** @typedef {import('./auth-state-core.js').AuthState} AuthState */
/** @typedef {{ requireNamed?: boolean, soft?: boolean, role?: string[]|null, otherStaff?: boolean }} PagePolicy */
/** @typedef {{ decision: 'allow'|'soft-allow'|'login'|'forbidden'|'pending', reason: string }} AuthDecision */

/** The possible decisions (for callers/tests to reference). */
export const DECISIONS = Object.freeze(['allow', 'soft-allow', 'login', 'forbidden', 'pending']);

/** Who may open the New link page — and, once it opens, the Links Selector: ONE list, so the two can never drift. */
const NEWLINK_ROLES = /** @type {string[]} */ (Object.freeze(['admin', 'newlinkPreview', 'newlinkAudience']));

/**
 * Per-page access policy — the single home for "what does this page require?". GROUNDED in the
 * coordinators' actual gates (v14.60):
 *  - operations: admin ONLY (non-admins, incl. managers, are redirected) → role ['admin'].
 *  - links: designer ONLY → role ['designer'].
 *  - admin / settings: ANY named user (staff get self-service; the admin/manager split gates
 *    ACTIONS, not page access) → role null.
 *  - paycalc: any identity, SOFT (a local-first calculator — never blocked).
 *  - calendar: no named session required at the PAGE level — the Calendar's own gate
 *    (calendar-access.js) decides, and only a member's sign-in opens it; an anonymous session grants
 *    nothing. guides: no auth.
 *
 * There is no `staffPin` flag any more: the shared staff PIN is retired (owner, 23 Nov 2026), and no page
 * admits it. Every page — the Calendar and Trains included — signs a leftover PIN session out on arrival
 * (session.js → `reconcileExpiredIdentity`), so it can never stand in for a member anywhere.
 *
 * `otherStaff: true` — an "Other Staff" login may open this page (owner, 23 Nov 2026). That grade is somebody
 * with no roster and no manager or admin rights who signs in under their own name and is shown the Calendar,
 * Trains and their own Settings — what the staff PIN used to show, plus Settings. Every
 * other NAMED page refuses them (`requirePageAuth`), the Pay Calculator included. The pill gate that hides the
 * rest from their drawer is `isNotOtherStaff` (`navGatesFor`), and nav-gates.test.mjs holds the two to one answer.
 * It is UX like the rest of this module: they hold a plain member login, so the rules treat them as a member
 * with no roster — which can read the roster, and write nothing of anybody else's.
 * @type {Record<string, PagePolicy>}
 */
export const PAGE_POLICIES = Object.freeze({
    calendar:   { requireNamed: false, otherStaff: true },
    guides:     { requireNamed: false },
    paycalc:    { requireNamed: true,  soft: true,  role: null },
    settings:   { requireNamed: true,  role: null, otherStaff: true },
    admin:      { requireNamed: true,  role: null },
    operations: { requireNamed: true,  role: ['admin'] },
    links:      { requireNamed: true,  role: ['designer'] },
    // Overtime during the restricted live beta: reviewers, plus invited beta PARTICIPANTS.
    // `manager` is a first-class role here rather than an also-ran — this is the first page in the
    // app whose PRIMARY audience is the manager rather than the admin. `overtimeBeta` is not a role
    // in the claim sense at all (v20.76): it names members the server intends to ASK, and without
    // it the first beta CEA would have been refused by this very policy while her form sat waiting
    // on the server. At full launch the whole role list drops away and this becomes a plain
    // named-user page, because participation — not a role — decides what is shown.
    overtime:   { requireNamed: true,  role: ['admin', 'manager', 'overtimeBeta'] },
    // Trains: every named member's since v24.81 (owner, 20 Oct 2026) — an admin preview from v24.71.
    // Public data, so the sign-in is the app's ordinary front door rather than a protection. (The station
    // PIN read it too from v24.84 until the PIN was retired, 23 Nov 2026.)
    trains:     { requireNamed: true,  role: null, otherStaff: true },
    // The new link (v25.06; the December link until v25.10): a preview of the admin's and the named previewers' until v25.60
    // (CONFIG.NEWLINK_PREVIEW: S. Silva, its contact, since v25.33). OPEN since v25.60 (owner, 9 Nov 2026: "send the new
    // links section live for everyone with a cea contract and the managers"): `newlinkAudience` — every colleague on a
    // normal CEA contract, and the managers. newlink-config.js → PHASE says 'open' — or 'decided', which follows
    // CHOSEN — with it, and newlink-config.test.mjs fails if the two part. Signed-in only (owner, 2 Nov 2026:
    // "No, signed-in only").
    newlink:    { requireNamed: true,  role: NEWLINK_ROLES },
    // The Links Selector (owner, 27 Nov 2026): a beta for the admin until CONFIG.LINKS_SELECTOR_OPEN, then exactly the New
    // link page's audience (owner: "Same as new link page"). Read once, here, so the page and `canOpenSelector` agree.
    selector:   { requireNamed: true,  role: CONFIG.LINKS_SELECTOR_OPEN === true ? NEWLINK_ROLES : ['admin'] },
});

/** @returns {AuthDecision} */
function decide(/** @type {AuthDecision['decision']} */ decision, /** @type {string} */ reason) {
    return Object.freeze({ decision, reason });
}

/**
 * PURE page-authorisation decision. Given the identity snapshot, a page policy, and the member's
 * role flags, return what the page should do. Never throws; defensive about missing inputs.
 *
 * @param {{ status?: string, member?: string|null }} snapshot - from getAuthSnapshot()
 * @param {PagePolicy} policy
 * @param {{ admin?: boolean, manager?: boolean, designer?: boolean, overtimeBeta?: boolean, newlinkPreview?: boolean, newlinkAudience?: boolean, otherStaff?: boolean }} [roles]
 * @returns {AuthDecision}
 */
export function requirePageAuth(snapshot, policy, roles = {}) {
    const status = (snapshot && snapshot.status) || 'initialising';
    const p = policy || {};

    // 1. Public page (calendar/guides) — no named session required. The SERVER still gates any
    //    data; this is page access only.
    if (!p.requireNamed) return decide('allow', 'public page');

    // 1b. An "Other Staff" login opens only the pages marked for it (`otherStaff` above): the Calendar, Trains and
    //     Settings. Asked BEFORE the soft rule, so the Pay Calculator refuses them too — it never prices a grade
    //     it has no rates for, and its own role card says so on the page (paycalc-role-card.js).
    if (status === 'named' && /** @type {any} */ (roles).otherStaff && !p.otherStaff) {
        return decide('forbidden', 'named Other Staff — not a page for that grade');
    }

    // 2. Soft page (paycalc) — a local-first tool that must NEVER be blocked by the IDENTITY'S STATE. Named →
    //    full access; anything else → soft-allow (works locally, cloud features degrade). Soft therefore never
    //    yields login or pending — and forbidden only for the grade refused above.
    if (p.soft) {
        return status === 'named'
            ? decide('allow', 'named (soft page, full access)')
            : decide('soft-allow', `soft page, identity=${status}`);
    }

    // 3. Hard, named-required page.
    switch (status) {
        case 'named': {
            if (!p.role || p.role.length === 0) return decide('allow', 'named, no role required');
            const ok = p.role.some(r => /** @type {any} */ (roles)[r]);
            return ok
                ? decide('allow', `named with required role [${p.role.join('|')}]`)
                : decide('forbidden', `named but lacks role [${p.role.join('|')}]`);
        }
        // Still establishing, or a transient blip. Decide NOTHING yet: `degraded` grants no
        // authority (the invariant) but is retryable, so it is "pending", not "login" — nothing is
        // cleared. `guardNamedSession` (page-session.js) asks ONCE: on `pending` it shows the sign-in
        // over the kept session and reloads if the member's own identity lands late.
        case 'initialising':
        case 'resolving':
        case 'degraded':
            return decide('pending', `identity ${status}`);
        // Terminal "no named session" → prompt sign-in. `anonymous` on a named-required page
        // means the named sign-in fell back/failed; `error` is non-recoverable (→ re-auth).
        case 'anonymous':
        case 'signedOut':
        case 'error':
        default:
            return decide('login', `no named session (${status})`);
    }
}

/**
 * Glue: derive a member's role flags from CONFIG (the role source of truth). Impure only in that
 * it reads CONFIG — deterministic and side-effect-free.
 * @param {string|null|undefined} member
 * @returns {{ admin: boolean, manager: boolean, designer: boolean, overtimeBeta: boolean, newlinkPreview: boolean, newlinkAudience: boolean, otherStaff: boolean }}
 */
export function rolesFor(member) {
    const m = member || null;
    return {
        // Not a claim: the "Other Staff" grade (owner, 23 Nov 2026) — a login with no roster and no rights beyond a
        // member's, read from the member's own row (roster-member-data.js → `otherStaff`). It TAKES pages away
        // rather than granting them: `requirePageAuth` refuses such a login every page not marked `otherStaff`.
        otherStaff: !!m && teamMembers.some(t => t.name === m && isOtherStaff(t)),
        // Not a claim either: who the New link page is for since it opened (v25.60, owner, 9 Nov 2026) — every colleague on
        // a normal CEA contract, and the managers. The CONTRACT, not the line, and never a CEA bilingual contract, whose
        // holders keep their own links (owner, 8 Nov 2026). Spelt out here rather than imported: newlink-config.js →
        // audienceNames() is the page's own copy, and newlink-boundary.test.mjs keeps the page's modules out of this one,
        // which every roster page loads. newlink-config.test.mjs holds the two to one answer for every name on the roster.
        newlinkAudience: !!m && (isNormalCeaContract(m) || (CONFIG.MANAGER_NAMES || []).includes(m)),
        // NOT a claim, unlike the three below — an invitation to submit one's own availability
        // during the restricted beta. It grants no read of anybody else's, which is why it is a
        // separate flag rather than a widening of `manager`.
        overtimeBeta: !!m && (CONFIG.OVERTIME_BETA || []).includes(m),
        // Not a claim either: who besides the admin may see the New link page while it is a preview.
        // The page reads nothing from the server, so there is nothing for a claim to protect.
        newlinkPreview: !!m && (CONFIG.NEWLINK_PREVIEW || []).includes(m),
        // All three CONFIG lists defensively defaulted so this fail-closed helper never throws if a
        // list were ever absent (uniform with MANAGER_NAMES, which was already guarded).
        admin:    !!m && (CONFIG.ADMIN_NAMES || []).includes(m),
        manager:  !!m && (CONFIG.MANAGER_NAMES || []).includes(m),
        // NOTE: the CLIENT role label is `designer`, but the SERVER custom claim set by
        // setupRosterAuth is `linksDesigner`. They differ ON PURPOSE — this UX layer derives the
        // flag from CONFIG.LINKS_DESIGNERS (not the token), so it stays correct without the claim.
        // Do NOT "fix" this by wiring the check to the `linksDesigner` claim name; server rules are
        // the real boundary, and the names are deliberately decoupled.
        designer: !!m && (CONFIG.LINKS_DESIGNERS || []).includes(m),
    };
}

/**
 * Is this member a reviewer for Overtime Availability — i.e. manager or admin?
 *
 * ONE declaration, because the nav drawer's Overtime pill is gated on it and the drawer is
 * initialised by SEVEN different coordinators. It shipped with the predicate written in exactly one
 * of them, so the pill appeared only on the Overtime page itself — the one page you are already on
 * — and the feature was reachable solely by typing its URL. Seven copies of
 * `ADMIN_NAMES.includes(x) || MANAGER_NAMES.includes(x)` would have been the same bug waiting for
 * the eighth page.
 *
 * CLIENT UX only, like everything else here. The page gates itself and every endpoint re-checks the
 * claim; this decides whether a destination is offered, never whether it is permitted.
 * @param {string|null|undefined} member
 */
export function isOvertimeReviewer(member) {
    const r = rolesFor(member);
    return r.admin || r.manager;
}

/**
 * May this member REACH the Overtime page at all — as a reviewer, or as an invited beta
 * participant with a form of their own?
 *
 * Two audiences, one destination, and the distinction is the point (v20.76). Reviewing is the
 * `admin`/`manager` claim; PARTICIPATING is `CONFIG.OVERTIME_BETA`, an invitation to fill in your
 * own availability and nothing more. The first beta CEA exposed that the page had only ever had
 * the reviewer answer: the pill was `overtimeReviewerOnly` and the page policy demanded an
 * admin/manager role, so a member the server had every intention of asking would have found no
 * link in the drawer and a "not open to everyone yet" panel if she typed the URL.
 *
 * Keep the two predicates separate rather than widening `isOvertimeReviewer`. Everything that
 * decides whether somebody may SEE COLLEAGUES' declarations reads that one, and a beta invitation
 * must never drift into meaning that.
 * @param {string|null|undefined} member
 */
export function canOpenOvertime(member) {
    return overtimeEnabled() && (isOvertimeReviewer(member) || rolesFor(member).overtimeBeta);
}

/**
 * Is this member, by the roster, on a normal CEA contract — the colleagues the new link is for? A current member (not a
 * leaver, not a manager's row) whose role is CEA and whose contract is not the bilingual one.
 * @param {string} member
 */
function isNormalCeaContract(member) {
    return teamMembers.some(t => t.name === member && t.role === 'CEA' && !t.bilingualContract && !t.hidden && !t.managerOnly);
}
/**
 * May this member open the New link page — the admin, a named previewer (CONFIG.NEWLINK_PREVIEW), or, since it opened
 * (v25.60), a colleague on a normal CEA contract or a manager?
 *
 * ONE declaration, like `canOpenOvertime`, for the same reason: every page draws the drawer, and the
 * pill must be offered from all of them (page-contract-parity fails a page that does not pass it). It
 * says the same as `PAGE_POLICIES.newlink`, which newlink-config.test.mjs holds it to for every name
 * on the roster. UX only, like everything here.
 * @param {string|null|undefined} member
 */
export function canOpenNewlink(member) {
    const r = rolesFor(member);
    return r.admin || r.newlinkPreview || r.newlinkAudience;
}

/**
 * May this member open the Links Selector? The admin during its beta; from `CONFIG.LINKS_SELECTOR_OPEN`, whoever may open
 * the New link page. Read from `PAGE_POLICIES.selector` itself, and nav-gates.test.mjs holds the two together. UX only.
 * @param {string|null|undefined} member
 */
export function canOpenSelector(member) {
    // Asked of the policy's own role list, so the pill cannot read the switch one way and the page the other.
    const r = /** @type {Record<string, boolean>} */ (rolesFor(member));
    return (PAGE_POLICIES.selector.role || []).some(role => r[role] === true);
}

/**
 * The drawer's pill gates for this member — the five `initNavPanel` options `PILL_GATES`
 * (nav-destinations.js) reads. EVERY page spreads this rather than building its own: ten pages built
 * the four by hand in four styles, which is how one page once passed `canOpenOvertime: !!member` and
 * drew the paused Overtime pill for every member. One answer, here, beside the page policy it must
 * agree with — `nav-gates.test.mjs` holds the pills it draws to what `requirePage` admits, for every
 * member and both directions. `null` (signed out) gets every gate false but `isNotOtherStaff`. UX only.
 * @param {string|null|undefined} member
 * @returns {{ isAdmin: boolean, isLinksDesigner: boolean, canOpenOvertime: boolean, canOpenNewlink: boolean, canOpenSelector: boolean, isNotOtherStaff: boolean }}
 */
export function navGatesFor(member) {
    const r = rolesFor(member);
    return {
        isAdmin:         r.admin,
        isLinksDesigner: r.designer && linkDesignerEnabled(),   // paused, the pill leaves every menu (the switch, below)
        canOpenOvertime: canOpenOvertime(member),
        canOpenNewlink:  canOpenNewlink(member),
        canOpenSelector: canOpenSelector(member),
        // TRUE for nobody signed in, deliberately: their drawer keeps every ungated pill
        // (nav-gates.test.mjs says why). Only an Other Staff login loses Admin and Pay (`otherStaffHidden`).
        isNotOtherStaff: !r.otherStaff,
    };
}

/**
 * Is Overtime switched on at all? `CONFIG.OVERTIME_ENABLED` (paused, owner, Nov 2026).
 *
 * The ONE reading of the switch on the client: `canOpenOvertime` consults it, so the pill leaves
 * every menu, and overtime.html consults it before its own gate, so the page says it is paused —
 * to everyone, the admin included, signed in or not. Like the rest of this module it is UX: while
 * paused the server does not deploy the Overtime endpoints at all (functions/index.js exports only the
 * retention purge, from the generated copy of the same switch), so every call answers 404.
 *
 * `__E2E.overtimeEnabled` is a TEST SEAM, the same shape as text-scale.js's: the browser suites set
 * it so they go on driving the real page while it is paused for everyone else — which is what keeps
 * the feature ready to return. Nothing in production sets __E2E, and setting it by hand switches on
 * only a page whose every call the server refuses.
 * @returns {boolean}
 */
export function overtimeEnabled() {
    const seam = /** @type {any} */ (globalThis).__E2E?.overtimeEnabled;
    return typeof seam === 'boolean' ? seam : CONFIG.OVERTIME_ENABLED === true;
}

/**
 * Is the Link Designer switched on at all? `CONFIG.LINK_DESIGNER_ENABLED` (paused, owner, 27 Nov 2026).
 *
 * The Overtime pause's shape, and for the same reasons: the ONE reading of the switch on the client. `navGatesFor`
 * consults it, so the pill leaves every menu, and link-designer.html consults it before its own gate, so the page says
 * it is paused, to everyone, the admin included, signed in or not. Paused, never deleted: every saved design and target
 * set stays in Firestore, untouched, and the rules still admit a designer, so switching it back on loses nothing.
 *
 * `__E2E.linkDesignerEnabled` is a TEST SEAM, `overtimeEnabled`'s: a suite that cannot rewrite roster-data.js (the
 * signed-in lane) sets it to go on driving the real page. Nothing in production sets __E2E.
 * @returns {boolean}
 */
export function linkDesignerEnabled() {
    const seam = /** @type {any} */ (globalThis).__E2E?.linkDesignerEnabled;
    return typeof seam === 'boolean' ? seam : CONFIG.LINK_DESIGNER_ENABLED === true;
}

/**
 * Convenience for coordinators: look up the page's policy + the member's roles and decide.
 * Fails CLOSED on an unknown page name (strictest sensible default — named admin required) so a
 * misconfiguration can never accidentally grant access.
 * @param {{ status?: string, member?: string|null }} snapshot
 * @param {string} pageName
 * @returns {AuthDecision}
 */
export function requirePage(snapshot, pageName) {
    // An OWN-property lookup, never a bare index: that would also match Object.prototype members
    // ('toString', 'constructor', …), returning a truthy FUNCTION as the "policy" — requirePageAuth
    // would then see requireNamed undefined and ALLOW it as a public page, inverting the fail-closed
    // guarantee for exactly the misconfiguration class this guard exists for (v16.23).
    // `hasOwnProperty.call` dates from when iPhones below iOS 15.4, which lack `Object.hasOwn`, were
    // still served; the floor is 16.4 now, so either would do, and this one is left as it is.
    const policy = Object.prototype.hasOwnProperty.call(PAGE_POLICIES, pageName) ? PAGE_POLICIES[pageName] : null;
    const roles  = rolesFor(snapshot && snapshot.member);
    if (!policy) {
        console.error(`[auth-policy] unknown page "${pageName}" — failing closed (named admin required)`);
        return requirePageAuth(snapshot, { requireNamed: true, role: ['admin'] }, roles);
    }
    return requirePageAuth(snapshot, policy, roles);
}
