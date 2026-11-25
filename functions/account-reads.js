'use strict';

/**
 * functions/account-reads.js — the account domain's two admin READS: getSignInStats and
 * getAccountSetupGaps. Neither creates, changes or re-claims anything.
 *
 * SPLIT out of auth-endpoints.js (Nov 2026), which was at 743 of its 750-line cap with a third field
 * to add to one of these. The file did two jobs — the endpoints that CHANGE accounts (set-up, the
 * break-glass reset, the doorbell it builds) and the two that only LOOK — and the two that only look
 * share nothing with the others but the roster, the admin gate and the account list. auth-endpoints.js
 * still BUILDS these and returns them beside its own, so index.js and the deploy surface are untouched.
 *
 * `listAllUsers` is here because both reads page through every account, and so does setupRosterAuth's
 * leaver sweep; the loop was written out three times. It is exported for that sweep.
 *
 * `firebase-admin/auth` is required at CALL time, so a test's fake in `require.cache` is the one asked;
 * the server-owned roster is HANDED IN, for the same reason (auth-endpoints.test.mjs stands a stub
 * roster in front of the module that requires it).
 */

const { onRequest } = require('firebase-functions/v2/https');
const { nameToEmail } = require('./roster-parse-helpers');
const { resolveRosterAuthConfig, summariseSignIns, summariseAccountGaps } = require('./account-rules');
const { requireAdmin } = require('./request-helpers');
const { fieldsOf } = require('./caught');
const { REGION } = require('./region');

/**
 * Every account in the project. `listUsers` caps a page at 1000 and the roster is ~50, so this is one
 * page in practice — the loop is here so it stays correct if that ever stops being true.
 * @returns {Promise<import('firebase-admin/auth').UserRecord[]>}
 */
async function listAllUsers() {
    const { getAuth } = require('firebase-admin/auth');
    /** @type {import('firebase-admin/auth').UserRecord[]} */
    const users = [];
    /** @type {string|undefined} */
    let pageToken;
    do {
        const page = await getAuth().listUsers(1000, pageToken);
        users.push(...page.users);
        pageToken = page.pageToken;
    } while (pageToken);
    return users;
}

/**
 * Build the two read endpoints. Called once, by buildAuthEndpoints (auth-endpoints.js).
 * @param {{ ADMIN_FUNCTION_ORIGINS: string[], rosterMembers: any, now?: () => number }} deps
 */
function buildAccountReadEndpoints({ ADMIN_FUNCTION_ORIGINS, rosterMembers, now = Date.now }) {

/**
 * getSignInStats — how many DISTINCT accounts have actually signed in (admin-only, v18.96).
 *
 * WHY THIS EXISTS. The Operations Usage card's "active accounts" figure is deduped on the DEVICE
 * (localStorage flags in usage-reporter.js that never leave the phone), which is what keeps it
 * anonymous — the server only ever receives `increment(1)` and never learns WHO was active. The
 * price of that anonymity is that a member using a phone AND a laptop counts twice: it is a usage
 * TREND, not a headcount. Making it a true unique count would mean giving the server a per-account
 * handle, i.e. recording who opened the app and when — attendance-adjacent data in a workplace, and
 * a deliberate reversal of that design.
 *
 * This route avoids the trade entirely. **Firebase Auth already stores `lastSignInTime` per
 * account**, whether we look at it or not, so uniqueness is a property of the data rather than
 * something we have to enforce — and reading it adds no privacy surface that did not already exist.
 * Nothing is written, nothing is cached, and **no identity leaves this function**: the response is
 * four integers.
 *
 * WHAT IT DOES NOT MEASURE. Sign-ins, not activity. Sessions last 60 days (absolute — `SESSION_MS`
 * in session.js, 30 until v20.47), so most page opens are session RESTORES, not sign-ins — a member
 * can sign in once and use the app daily for two months. Two consequences, both stated on the card:
 *   · "Signed in within 30 days" is therefore NOT a count of active people, in either direction: it
 *     misses anyone whose one sign-in was 31–60 days ago and who has used the app every day since,
 *     and it includes anyone who signed in once and stopped. (While sessions lasted 30 days a live
 *     session required a sign-in inside the window, and this line called the figure a slight
 *     over-count; that stopped being true at v20.47.)
 *   · There is no history. `lastSignInTime` is only the LAST one, so month-over-month cannot be
 *     reconstructed retroactively; this figure is deliberately a snapshot, and it sits ALONGSIDE the
 *     existing trend rather than replacing it.
 *
 * The one genuinely actionable number here is `neverSignedIn`: accounts provisioned by Set up
 * accounts that have never been used — staff who quite possibly do not know the app exists.
 *
 * Auth: a fresh admin ID token as a Bearer header, `checkRevoked` — same shape as
 * resetMemberPassword. GET (it is a pure read), and CORS-restricted like the other admin functions.
 */
const getSignInStats = onRequest(
    { region: REGION, timeoutSeconds: 60, cors: ADMIN_FUNCTION_ORIGINS },
    async (req, res) => {
        if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

        if (!(await requireAdmin(req, res))) return;

        // An ALLOWLIST of the current roster, not a denylist of admins (v18.97, external review).
        // Excluding only admins counted every other enabled account in the project — a leaver whose
        // orphan sweep hasn't run, or one it failed on — inflating both the total and the
        // never-signed-in figure on a card that calls itself exact. Admins are excluded by being left
        // out here, mirroring recordUsage's write-time CONFIG.ADMIN_NAMES filter.
        // Derived from the SERVER-owned roster (roster-members.json), never a client payload.
        const cfg = resolveRosterAuthConfig(rosterMembers);
        if (cfg.error) { res.status(500).json({ error: 'Server roster config invalid' }); return; }

        try {
            // Inside the try (Nov 2026 review): `nameToEmail` throws on a roster entry that is not a
            // name, and outside it that was an unhandled throw — the platform's bare 500 in place of
            // this endpoint's own JSON answer, which the Usage card reads.
            const adminSet = new Set(cfg.admin);
            const allowedEmails = new Set(
                cfg.processMembers.filter(n => !adminSet.has(n)).map(n => nameToEmail(n).toLowerCase()));
            const stats = summariseSignIns(await listAllUsers(), now(), allowedEmails);
            console.log('[getSignInStats]', JSON.stringify(stats));
            res.json(stats);
            return;
        } catch (e) {
            console.error('[getSignInStats] failed', fieldsOf(e).code, e);
            res.status(500).json({ error: 'Could not read sign-in stats' });
            return;
        }
    }
);

/**
 * getAccountSetupGaps — who on the roster is not properly provisioned, and who has left but still is.
 * For a few days in Nov 2026 it also said whether the retired staff PIN's door was shut for everyone
 * (`pinLockout`); that field went with the PIN's endpoint in its server release. An Operations page
 * from before then reads its absence as UNKNOWN and shows nothing, which is the right answer now.
 *
 * WHY A SEPARATE ENDPOINT FROM getSignInStats. That one's whole contract, stated in its own header
 * and relied on by the Usage card's privacy note, is "four integers; no identity". This one has to
 * return NAMES — a count of gaps the admin cannot act on is worse than none — so folding it in
 * would quietly break the promise the other one makes. Two endpoints, two contracts, neither
 * apologising for the other.
 *
 * It is a PURE READ. Nothing is written, no account is touched, no claim is applied: pressing "Set
 * up accounts" is still the only thing that changes anything, and it is still idempotent. That
 * separation is deliberate — a check that silently repaired what it found would make the gap
 * invisible again, which is the state this feature exists to end.
 *
 * The comparison is against the SERVER-owned roster (`roster-members.json`), never a client
 * payload, exactly as setupRosterAuth resolves it — so what this reports missing is precisely what
 * that button would create. `summariseAccountGaps` (unit-tested) owns every judgement, including
 * the refusal when no roster account is visible at all.
 *
 * Auth: a fresh admin ID token as a Bearer header, `checkRevoked`. GET, CORS-restricted like the
 * other admin functions.
 */
const getAccountSetupGaps = onRequest(
    { region: REGION, timeoutSeconds: 60, cors: ADMIN_FUNCTION_ORIGINS },
    async (req, res) => {
        if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

        if (!(await requireAdmin(req, res))) return;

        const cfg = resolveRosterAuthConfig(rosterMembers);
        if (cfg.error) { res.status(500).json({ error: 'Server roster config invalid' }); return; }

        try {
            // Admins are INCLUDED here, unlike getSignInStats. There they are excluded because the
            // figure is about staff usage; here a second admin whose claim was never applied is
            // exactly the kind of gap being looked for.
            const gaps = summariseAccountGaps(await listAllUsers(), {
                processMembers: cfg.processMembers,
                adminSet:    new Set(cfg.admin),
                managerSet:  new Set(cfg.manager),
                designerSet: new Set(cfg.designer),
            });
            // Counts only in the log — the names are for the admin's screen, not the project's logs.
            console.log('[getAccountSetupGaps]', JSON.stringify({
                refused: gaps.refused || null, setUp: gaps.setUp.length, leavers: gaps.leavers.length,
            }));
            res.json(gaps);
            return;
        } catch (e) {
            console.error('[getAccountSetupGaps] failed', fieldsOf(e).code, e);
            res.status(500).json({ error: 'Could not read account setup state' });
            return;
        }
    }
);

    return { getSignInStats, getAccountSetupGaps };
}

module.exports = { buildAccountReadEndpoints, listAllUsers };
