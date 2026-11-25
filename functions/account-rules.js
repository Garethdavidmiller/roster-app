'use strict';

/**
 * functions/account-rules.js — the ACCOUNT rules: which claims a member's account carries, which
 * accounts are leaver orphans, who is not properly set up, and how many accounts have signed in.
 * Pure: no Firebase, no secrets, no HTTP, so every judgement worth getting wrong is unit-tested
 * without the Admin SDK (the account block of roster-parse-helpers.test.mjs), and the handlers that
 * call them are driven for real in auth-endpoints.test.mjs and account-lifecycle.test.mjs.
 *
 * MOVED HERE WHOLE from roster-parse-helpers.js (25 Nov 2026), which had reached 1,386 of its
 * 1,400-line cap doing three jobs: the roster parse, these account rules, and the reset-request
 * queue's rules (now ./reset-request-rules.js). Nothing was rewritten in the move.
 *
 * WHY ITS IMPORTERS REQUIRE IT DIRECTLY, and roster-parse-helpers.js does not re-export it: these
 * rules derive an account's address with `nameToEmail`, which stays in roster-parse-helpers.js
 * (surname-parity.test.mjs reads that file's source for the one spelling of the surname rule), so a
 * re-export there would be a require cycle. Required by account-reads.js, auth-endpoints.js,
 * account-lifecycle.js and reset-request.js.
 *
 * `claimedByAnotherMember` is required at the top here. In the old home it had to be required
 * lazily, because member-identity.js requires roster-parse-helpers.js; this module is required by
 * neither, so no cycle forces that any more.
 */

const { nameToEmail } = require('./roster-parse-helpers');
const { claimedByAnotherMember } = require('./member-identity');
const { isViewerAccount } = require('./retired-viewer-account');
const { jsonBodyOf } = require('./request-helpers');

// ── setupRosterAuth — pure decision helpers (B4) ───────────────────────────────
// Extracted from the setupRosterAuth onRequest handler so the auth-provisioning logic (which uses
// the Firebase Admin SDK and cannot be exercised in the test sandbox) is unit-tested here. The
// handler calls each of these; keep them the single source so the handler and tests can't drift.

/**
 * Parse the ACTION flags from a setupRosterAuth request. Only `removeOrphans`/`confirmOrphanRemoval`
 * and the previewed uids are honoured (member/role lists are server-owned). The body is read by
 * `jsonBodyOf` (request-helpers.js), the one body reader every endpoint shares — a Buffer, a string,
 * rawBody, or JSON a form parser mangled all read alike (this read them its own way until Nov 2026).
 *
 * FAILS SAFE: a flag is on only for the boolean `true` — a string "true" or a 1 is off, as `lostDevice`
 * is on the reset — so nothing short of an exact request starts a sweep or confirms one. `confirmUids`
 * is the dry run's `orphanUids`, sent back with the confirm so the sweep disables only what the admin
 * read (`sweepAgainstPreview`, account-lifecycle.js): `null` when the field is ABSENT (a client older
 * than that), and a malformed one is an EMPTY list — disable nobody, never everybody.
 * @param {any} reqBody  req.body, in any shape the runtime hands over
 * @param {any} rawBody  req.rawBody (Buffer/string) — the raw request body
 * @returns {{ removeOrphans: boolean, confirmOrphanRemoval: boolean, confirmUids: string[]|null }}
 */
function parseSetupActionFlags(reqBody, rawBody) {
    const body = jsonBodyOf(reqBody, rawBody);
    const sent = body.confirmUids;
    const confirmUids = sent === undefined ? null : [...new Set((Array.isArray(sent) ? sent : [])
        .filter((u) => typeof u === 'string' && u !== '' && u.length <= 128))];
    return { removeOrphans: body.removeOrphans === true, confirmOrphanRemoval: body.confirmOrphanRemoval === true, confirmUids };
}

/**
 * Resolve the SERVER-OWNED member + role lists from roster-members.json and fail closed on a broken
 * config. Returns `{ error }` (a short code) when unusable — an empty active-members list, or an empty
 * admin list (which would strip the admin claim on the next run and lock admin provisioning out).
 * `processMembers` unions the role names into the member set so every role-holder is provisioned AND
 * lands in the never-orphan set (a leaver sweep can then never disable an admin/manager/designer).
 * @param {any} rosterMembers  the parsed roster-members.json
 * @returns {{ error: 'missing-active-members' } | { error: 'empty-admin' }
 *         | { error?: undefined, members: string[], admin: string[], manager: string[], designer: string[], processMembers: string[] }}
 *   One or the other, so a caller that has returned on `cfg.error` holds every list — the checker
 *   sees that, because both codes are non-empty and so truthy.
 */
function resolveRosterAuthConfig(rosterMembers) {
    const members  = Array.isArray(rosterMembers && rosterMembers.activeMembers) ? rosterMembers.activeMembers : [];
    const roles    = (rosterMembers && rosterMembers.roles) || {};
    const admin    = Array.isArray(roles.admin)    ? roles.admin    : [];
    const manager  = Array.isArray(roles.manager)  ? roles.manager  : [];
    const designer = Array.isArray(roles.designer) ? roles.designer : [];
    if (members.length === 0) return { error: 'missing-active-members' };
    if (admin.length === 0)   return { error: 'empty-admin' };
    const processMembers = [...new Set([...members, ...admin, ...manager, ...designer])];
    return { members, admin, manager, designer, processMembers };
}

/**
 * The custom-claims object for one member. admin outranks manager (a member in both gets `admin`
 * only); `linksDesigner` is additive. Every account gets `name` AND `member` (v24.24), the roster name;
 * `member` is a custom claim no display name can produce — KNOWN_LIMITATIONS.md → "The member claim".
 * @param {string} name
 * @param {{ adminSet: Set<string>, managerSet: Set<string>, designerSet: Set<string> }} sets
 * @returns {Record<string, any>}
 */
function claimsForTier(name, { adminSet, managerSet, designerSet }) {
    const isAdmin    = adminSet.has(name);
    const isManager  = !isAdmin && managerSet.has(name);
    const isDesigner = designerSet.has(name);
    /** @type {Record<string, any>} */
    const claims = { name, member: name };
    if (isAdmin)        claims.admin = true;
    else if (isManager) claims.manager = true;
    if (isDesigner)     claims.linksDesigner = true;
    return claims;
}

/**
 * Count how many DISTINCT accounts have signed in inside each window (v18.96).
 *
 * The point of this metric: the Usage card's existing "active accounts" figure is deduped on the
 * DEVICE (localStorage flags that never leave the phone), so one member on a phone and a laptop
 * counts twice — a usage trend, not a headcount. This is the exact counterpart, and it is exact for
 * free: Firebase Auth already records `lastSignInTime` per account, so uniqueness is a property of
 * the data rather than something we have to enforce. **No identity is stored, transmitted or
 * returned** — only counts — so it adds no privacy surface over what Firebase already holds.
 *
 * PURE, because the handler around it uses the Admin SDK and can't run in the test sandbox. Every
 * judgement worth getting wrong lives here:
 *
 *  · **Only accounts on the CURRENT server-owned roster are counted** (`allowedEmails`, v18.97 —
 *    external review). Filtering merely on "not disabled" counted any enabled `@myb-roster.local`
 *    account still sitting in the project: a leaver whose orphan sweep hasn't been run or failed, or
 *    anything else created there. Those inflated `total` AND `neverSignedIn`, so a card headed "exact
 *    count" could quietly disagree with the roster. The allowlist makes the denominator mean what the
 *    card says it means. Admins are excluded simply by being left out of the list by the caller,
 *    matching recordUsage's write-time CONFIG.ADMIN_NAMES filter.
 *  · **Disabled accounts are ignored entirely**, including in the total. A leaver is not a
 *    provisioned account waiting to be used; counting them would permanently depress the ratio.
 *  · **A missing/unparseable `lastSignInTime` means never signed in**, never "signed in long ago".
 *    Firebase leaves it empty for an account created but never used, which is precisely the
 *    `neverSignedIn` population — the actionable one (provisioned staff who may not know the app
 *    exists). Treating a junk value as a sign-in would hide them.
 *  · **A FUTURE timestamp counts as recent**, not as an error. A clock skew must not make a real
 *    member vanish from the count.
 *
 * Windows are inclusive at the boundary (exactly 30 days ago counts as within 30 days) — the same
 * convention as shouldRecordResetRequest.
 *
 * @param {Array<{ email?: string, disabled?: boolean, metadata?: { lastSignInTime?: string|null } }>} users
 * @param {number} nowMs
 * @param {Set<string>} allowedEmails  lowercase emails of the CURRENT roster, admins already removed
 * @returns {{ total: number, last7: number, last30: number, neverSignedIn: number }}
 */
function summariseSignIns(users, nowMs, allowedEmails) {
    const DAY = 24 * 60 * 60 * 1000;
    const out = { total: 0, last7: 0, last30: 0, neverSignedIn: 0 };
    // An empty/absent allowlist counts NOTHING rather than everything: this is a reporting figure, and
    // a zero that is visibly wrong is safer than a plausible number built from an unknown population.
    for (const u of Array.isArray(users) ? users : []) {
        if (!u || u.disabled) continue;                       // leavers are not provisioned accounts
        const email = typeof u.email === 'string' ? u.email.toLowerCase() : '';
        if (!email || !allowedEmails || !allowedEmails.has(email)) continue;
        out.total++;
        const raw = u.metadata && u.metadata.lastSignInTime;
        const ms  = raw ? Date.parse(raw) : NaN;
        if (!Number.isFinite(ms)) { out.neverSignedIn++; continue; }
        const age = nowMs - ms;                                // negative (future clock) → counts as recent
        if (age <= 30 * DAY) out.last30++;
        if (age <= 7  * DAY) out.last7++;
    }
    return out;
}

/**
 * Which Firebase Auth accounts are leaver ORPHANS: a `@myb-roster.local` account not in the active
 * set, not disabled, and never the retired staff PIN's shared account (a leftover PIN session can
 * link an email to it, and deleting it is the owner's step — ./retired-viewer-account.js). Pure; the
 * handler previews or disables+revokes them.
 * @template {{ uid?: string, email?: string, displayName?: string, disabled?: boolean }} User
 * @param {User[]} users  a real UserRecord always has a uid, and the answer keeps that
 * @param {Set<string>} activeEmails  emails of currently-provisioned members (never disabled)
 * @returns {Array<{ uid: User['uid'], label: string }>}
 */
function computeOrphanLabels(users, activeEmails) {
    const out = [];
    for (const user of users || []) {
        if (user && user.email && !isViewerAccount(user) &&
            user.email.endsWith('@myb-roster.local') &&
            !activeEmails.has(user.email) &&
            !user.disabled) {
            // Its display name only when the ADDRESS was made from it: the holder can set any name,
            // and a leaver renamed after a current member was listed as that member (functions-core lead).
            // `shown` is the display name exactly when it is a string, so `own` implies it is that name.
            const shown = typeof user.displayName === 'string' ? user.displayName : '';
            const own = shown.trim() !== ''
                && nameToEmail(shown.trim()).toLowerCase() === user.email.toLowerCase();
            out.push({ uid: user.uid, label: own ? shown : user.email });
        }
    }
    return out;
}

const MANAGED_CLAIMS = ['name', 'member', 'admin', 'manager', 'linksDesigner'];

/**
 * summariseAccountGaps — which active members are NOT properly set up, and which leavers still are.
 *
 * WHY THIS EXISTS. Provisioning is the one part of onboarding and offboarding that leaves no trace
 * when it is skipped. A member added to `roster-data.js` whose "Set up accounts" run never happened
 * appears everywhere the app looks — the calendar dropdown, the team view, the Account status table
 * — and is indistinguishable from a working account until they try to sign in. A new manager whose
 * claim was never applied is worse: they sign in, the pages open, and every write on somebody
 * else's behalf permission-denies. And a leaver whose disable step was skipped simply keeps a
 * working login. None of the three fails anything; all three are found by somebody complaining.
 *
 * GROUPED BY REMEDY, NOT BY CAUSE: every "can't work properly" state has ONE fix — press Set up
 * accounts — so they are one group, and a leaver still enabled, needing a confirmed action, is its
 * own. Within it `unstamped` (NO claim at all) is told apart from `claims`, because that press TAKES
 * such an account BACK (`mustReclaim`: surname default, signed out, other ways in removed) — not a fix.
 * And two the press REFUSES (review D3, Nov 2026), so they are not `claims` either, whose remedy is the
 * press: `viewer-linked` — the retired staff PIN's shared account holds the address (`isViewerAccount`) — and
 * `other-member` — the account's claims name somebody else (`claimedByAnotherMember`). Asked in the
 * button's own order, so the audit names the reason Set up accounts will give.
 *
 * IT REFUSES RATHER THAN CRIES WOLF. If not one `@myb-roster.local` account is visible, the
 * account list did not arrive — an empty page from a transient failure, a wrong project — and
 * every active member would otherwise read as unprovisioned. That is a false alarm at maximum
 * volume, which is the one failure an exceptions index cannot survive, so this answers
 * `refused: 'no-accounts-visible'` and reports nothing at all. Nothing is a worse answer than
 * everything here: an absent item reads as unknown, and a full-volume wrong one gets the whole
 * strip ignored.
 *
 * ONLY THE CLAIMS THIS APP SETS ARE COMPARED (`MANAGED_CLAIMS`: `name`, `member`, `admin`, `manager`,
 * `linksDesigner`). An exact object comparison would report a gap for any claim added later by
 * anything else, and a false alarm on a provisioning index teaches the admin to skip it.
 *
 * PURE — the handler around it uses the Admin SDK and cannot run in the test sandbox, and every
 * judgement worth getting wrong is here. Tested in roster-parse-helpers.test.mjs (the account block).
 *
 * @param {Array<{ uid?: string, email?: string, displayName?: string, disabled?: boolean, customClaims?: Record<string, any>|null }>} users
 *        every Firebase Auth user (all pages of listUsers)
 * @param {{ processMembers: string[], adminSet: Set<string>, managerSet: Set<string>, designerSet: Set<string> }} cfg
 *        the SERVER-owned roster, exactly as setupRosterAuth resolves it
 * @returns {{ refused?: string, setUp: Array<{ name: string, why: 'no-account'|'viewer-linked'|'other-member'|'disabled'|'unstamped'|'claims' }>, leavers: string[] }}
 */
function summariseAccountGaps(users, { processMembers, adminSet, managerSet, designerSet }) {
    const list = Array.isArray(users) ? users : [];
    /** @type {Map<string, {uid?: string, email?: string, disabled?: boolean, customClaims?: Record<string, any>|null}>} */
    const byEmail = new Map();
    for (const u of list) {
        const email = u && typeof u.email === 'string' ? u.email.toLowerCase() : '';
        if (!email.endsWith('@myb-roster.local')) continue;
        byEmail.set(email, u);
    }
    // The refusal. Not `list.length === 0` — a project holding only non-roster accounts is the same
    // "we cannot see the roster's accounts" situation and must not report the whole roster as missing either.
    if (byEmail.size === 0) return { refused: 'no-accounts-visible', setUp: [], leavers: [] };

    /** @type {Array<{name: string, why: 'no-account'|'viewer-linked'|'other-member'|'disabled'|'unstamped'|'claims'}>} */
    const setUp = [];
    /** @type {Set<string>} */
    const activeEmails = new Set();
    for (const name of processMembers || []) {
        const email = nameToEmail(name).toLowerCase();
        activeEmails.add(email);
        const user = byEmail.get(email);
        if (!user)         { setUp.push({ name, why: 'no-account' }); continue; }
        if (isViewerAccount(user)) { setUp.push({ name, why: 'viewer-linked' }); continue; }
        if (claimedByAnotherMember(user)) { setUp.push({ name, why: 'other-member' }); continue; }
        const actual = user.customClaims || {};   // no claim at all is `mustReclaim`'s test, asked in the button's order
        if (!Object.keys(actual).length) { setUp.push({ name, why: 'unstamped' }); continue; }
        if (user.disabled) { setUp.push({ name, why: 'disabled' });   continue; }
        const expected = claimsForTier(name, { adminSet, managerSet, designerSet });
        for (const key of MANAGED_CLAIMS) {
            // `undefined` vs absent must compare equal — setCustomUserClaims stores neither.
            if ((expected[key] ?? null) !== (actual[key] ?? null)) {
                setUp.push({ name, why: 'claims' });
                break;
            }
        }
    }

    // The leaving half. computeOrphanLabels already owns "which accounts are leaver orphans" for the
    // disable sweep; asking it here rather than restating the filter is what stops the preview and
    // this index ever disagreeing about who is still enabled.
    const leavers = computeOrphanLabels(list, activeEmails).map(o => o.label);
    return { setUp, leavers };
}

module.exports = {
    parseSetupActionFlags,
    resolveRosterAuthConfig,
    claimsForTier,
    summariseSignIns,
    computeOrphanLabels,
    MANAGED_CLAIMS,
    summariseAccountGaps,
};
