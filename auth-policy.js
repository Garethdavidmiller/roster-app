// @ts-check
/**
 * auth-policy.js — the page-AUTHORISATION layer (ARCHITECTURE_PLAN.md Track 1, Phase 3).
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
 * WIRED IN (Phase 4–7): operations/links/admin/settings/paycalc coordinators call `requirePage(...)`
 * for their access gate and B1 enforcement decision — behaviour-preserving (CLIENT UX only; Firestore
 * Rules + Functions claim checks remain the real boundary).
 */
import { CONFIG } from './roster-data.js';

/** @typedef {import('./auth-state-core.js').AuthState} AuthState */
/** @typedef {{ requireNamed?: boolean, anonymousOk?: boolean, soft?: boolean, role?: string[]|null }} PagePolicy */
/** @typedef {{ decision: 'allow'|'soft-allow'|'login'|'forbidden'|'pending', reason: string }} AuthDecision */

/** The possible decisions (for callers/tests to reference). */
export const DECISIONS = Object.freeze(['allow', 'soft-allow', 'login', 'forbidden', 'pending']);

/**
 * Per-page access policy — the single home for "what does this page require?". GROUNDED in the
 * coordinators' actual gates (v14.60):
 *  - operations: admin ONLY (non-admins, incl. managers, are redirected) → role ['admin'].
 *  - links: designer ONLY → role ['designer'].
 *  - admin / settings: ANY named user (staff get self-service; the admin/manager split gates
 *    ACTIONS, not page access) → role null.
 *  - paycalc: any identity, SOFT (a local-first calculator — never blocked).
 *  - calendar: public, anonymous reads allowed. guides: no auth.
 * @type {Record<string, PagePolicy>}
 */
export const PAGE_POLICIES = Object.freeze({
    calendar:   { requireNamed: false, anonymousOk: true },
    guides:     { requireNamed: false },
    paycalc:    { requireNamed: true,  soft: true,  role: null },
    settings:   { requireNamed: true,  role: null },
    admin:      { requireNamed: true,  role: null },
    operations: { requireNamed: true,  role: ['admin'] },
    links:      { requireNamed: true,  role: ['designer'] },
    // Overtime during the restricted live beta: reviewers only. `manager` is a first-class role
    // here rather than an also-ran — this is the first page in the app whose PRIMARY audience is
    // the manager rather than the admin. At full launch the role list drops away and the policy
    // becomes a plain named-user page, because participation (not a role) decides what is shown.
    overtime:   { requireNamed: true,  role: ['admin', 'manager'] },
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
 * @param {{ admin?: boolean, manager?: boolean, designer?: boolean }} [roles]
 * @returns {AuthDecision}
 */
export function requirePageAuth(snapshot, policy, roles = {}) {
    const status = (snapshot && snapshot.status) || 'initialising';
    const p = policy || {};

    // 1. Public page (calendar/guides) — no named session required. The SERVER still gates any
    //    data; this is page access only.
    if (!p.requireNamed) return decide('allow', 'public page');

    // 2. Soft page (paycalc) — a local-first tool that must NEVER be blocked. Named → full
    //    access; anything else → soft-allow (works locally, cloud features degrade). Soft can
    //    therefore never yield login/forbidden/pending.
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
        // authority (the invariant) but is retryable, so it is "pending", not "login" — the
        // coordinator shows a loading/reconnecting state and re-decides on the next snapshot.
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
 * @returns {{ admin: boolean, manager: boolean, designer: boolean }}
 */
export function rolesFor(member) {
    const m = member || null;
    return {
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
 * Convenience for coordinators: look up the page's policy + the member's roles and decide.
 * Fails CLOSED on an unknown page name (strictest sensible default — named admin required) so a
 * misconfiguration can never accidentally grant access.
 * @param {{ status?: string, member?: string|null }} snapshot
 * @param {string} pageName
 * @returns {AuthDecision}
 */
export function requirePage(snapshot, pageName) {
    // Object.hasOwn: a bare index would also match Object.prototype members ('toString',
    // 'constructor', …), returning a truthy FUNCTION as the "policy" — requirePageAuth would then
    // see requireNamed undefined and ALLOW it as a public page, inverting the fail-closed
    // guarantee for exactly the misconfiguration class this guard exists for (v16.23).
    // hasOwnProperty.call (not Object.hasOwn, which is Safari 15.4+) so page auth doesn't hard-throw
    // on an iPhone stuck below iOS 15.4 — same anti-prototype-match intent (a bare index would match
    // 'toString'/'constructor' etc.), just a wider-supported call.
    const policy = Object.prototype.hasOwnProperty.call(PAGE_POLICIES, pageName) ? PAGE_POLICIES[pageName] : null;
    const roles  = rolesFor(snapshot && snapshot.member);
    if (!policy) {
        console.error(`[auth-policy] unknown page "${pageName}" — failing closed (named admin required)`);
        return requirePageAuth(snapshot, { requireNamed: true, role: ['admin'] }, roles);
    }
    return requirePageAuth(snapshot, policy, roles);
}
