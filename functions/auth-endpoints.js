/**
 * functions/auth-endpoints.js — the ACCOUNT-AND-CREDENTIAL domain of the Cloud Functions
 * (third cut of the index.js domain split; push.js v20.52, documents.js in the same pass as this).
 *
 * Owns: setupRosterAuth (provision accounts + claim tiers from the server-owned roster),
 * resetMemberPassword (the admin break-glass), requestPasswordReset (the public doorbell)
 * and getSignInStats (the admin-only exact sign-in read). Everything ACCOUNT-shaped: who has
 * a login, what tier it carries, and how a locked-out member reaches the admin.
 *
 * NOT here, deliberately: unlockCalendarViewer. It is account-ADJACENT but it stays in
 * index.js — calendar-viewer-parity.test.mjs pins its handler source there (the secret
 * binding, the no-log rule), and it is the endpoint most recently stabilised in production
 * (the v20.50 outage); moving it buys nothing and costs the pin.
 *
 * Factory rather than plain module for the reasons documented at the top of documents.js:
 * index.js stays the composition root, the static guards keep one home for the shared
 * literals, and the deps seam is what a future Node test drives fake boundaries through.
 * The pure DECISIONS in these endpoints already live in roster-parse-helpers.js
 * (resolveRosterAuthConfig, claimsForTier, computeOrphanLabels, shouldRecordResetRequest,
 * shouldNotifyAdmin, buildResetRequestNotice, summariseSignIns) and are unit-tested there —
 * this module is the ORCHESTRATION around them.
 *
 * Deploy surface: index.js re-exports the returned handlers under the SAME names, so
 * `firebase deploy` sees an unchanged function list.
 */

const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const {
    nameToEmail,
    nameToPassword,
    buildPushPayload,
    parseSetupActionFlags,
    resolveRosterAuthConfig,
    claimsForTier,
    computeOrphanLabels,
    shouldRecordResetRequest,
    buildResetRequestNotice,
    shouldNotifyAdmin,
    summariseSignIns,
} = require('./roster-parse-helpers');
const { setupWebPush, sendTargetedPush } = require('./push');
const rosterMembers = require('./roster-members.json');

/**
 * Build the account-domain endpoints. Called once from index.js with the shared infra.
 * @param {object} deps
 * @param {import('firebase-functions/params').SecretParam} deps.VAPID_PRIVATE_KEY
 * @param {string}   deps.VAPID_PUBLIC_KEY
 * @param {string}   deps.STAFF_SITE_URL
 * @param {string[]} deps.ADMIN_FUNCTION_ORIGINS
 */
function buildAuthEndpoints({ VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, STAFF_SITE_URL, ADMIN_FUNCTION_ORIGINS }) {


/**
 * POST /setupRosterAuth
 *
 * Creates Firebase Auth accounts for all active roster members and optionally
 * disables accounts for anyone who has left. Run any time membership changes —
 * it is fully idempotent (existing accounts are skipped).
 *
 * B4: the member + role (admin/manager/linksDesigner) lists are SERVER-OWNED — read from
 * roster-members.json (generated from roster-data.js by generate-roster-members.mjs), NOT the
 * request body. The client no longer sends them, so a tampered payload cannot self-promote a
 * claim tier or create/keep a rogue account. The function fails closed if the server config is
 * missing activeMembers or has an empty admin list (which would lock admin provisioning out).
 *
 * Body (JSON) — ACTION flags only:
 *   {
 *     "removeOrphans": true,          // optional — preview which leaver accounts WOULD be disabled
 *     "confirmOrphanRemoval": true    // optional — actually disable them (dry-run without it)
 *   }
 *
 * removeOrphans: scans all @myb-roster.local accounts not in the server active set. WITHOUT
 * confirmOrphanRemoval it is a DRY RUN — returns `orphansToDisable` (a preview) and disables
 * nothing. WITH confirmOrphanRemoval it disables them AND revokes their refresh tokens. Disabled
 * accounts cannot sign in; they are not deleted (use the Firebase Console to delete permanently).
 *
 * Auth: Authorization: Bearer <Firebase ID token with admin custom claim>
 *
 * Response:
 *   { created, skipped, disabled, failed: string[],
 *     orphanSweepFailed?: true,
 *     orphanDryRun?: true, orphansToDisable?: string[] }   // last two: dry-run preview only
 */
const setupRosterAuth = onRequest(
    {
        region:        'europe-west2',
        timeoutSeconds: 120,
        cors:          ADMIN_FUNCTION_ORIGINS,
    },
    async (req, res) => {
        if (req.method !== 'POST') {
            return res.status(405).json({ error: 'Method not allowed' });
        }

        const bearer = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
        let decodedAuth;
        try {
            // checkRevoked=true: this function re-provisions accounts, so a revoked/disabled admin's
            // still-cached token must be rejected immediately, not honoured for up to ~1h (v17.42).
            decodedAuth = await admin.auth().verifyIdToken(bearer, true);
        } catch (_) {
            return res.status(401).json({ error: 'Unauthorised' });
        }
        if (decodedAuth.admin !== true) {   // strict, matching parseRosterPDF — fail closed on any non-true claim
            return res.status(403).json({ error: 'Forbidden — admin claim required' });
        }

        // firebase-functions v2 auto-parses req.body only when Content-Type: application/json
        // is sent. Fall back to rawBody so callers that omit the header still work, and so
        // admin claims are never silently skipped due to an unparsed body.
        // B4: only ACTION flags are honoured from the request body (member + role lists are
        // SERVER-OWNED below). parseSetupActionFlags owns the raw-body fallback (a non-JSON
        // Content-Type would otherwise drop the flags). Unit-tested in roster-parse-helpers.test.mjs.
        const { removeOrphans, confirmOrphanRemoval } = parseSetupActionFlags(req.body, req.rawBody);

        // ── Server-owned member + role lists (B4) ────────────────────────────────────────────────
        // Read from roster-members.json (generated from roster-data.js), NOT the client payload, so a
        // tampered request cannot self-promote a claim tier or create/keep a rogue account. resolve...
        // fails closed on a broken config and unions the role names into `processMembers` so a leaver
        // sweep can never disable an admin/manager/designer. Unit-tested in roster-parse-helpers.test.mjs.
        const cfg = resolveRosterAuthConfig(rosterMembers);
        if (cfg.error === 'missing-active-members') {
            return res.status(500).json({ error: 'Server roster config missing activeMembers — run `npm run generate:roster-members`' });
        }
        if (cfg.error === 'empty-admin') {
            return res.status(500).json({ error: 'Server roster config has no admin — refusing to run (would lock out admin)' });
        }
        const processMembers = cfg.processMembers;
        const adminMembers    = new Set(cfg.admin);
        const managerMembers  = new Set(cfg.manager);
        const designerMembers = new Set(cfg.designer);
        const created  = [];
        const skipped  = [];
        const disabled = [];
        const failed   = [];
        // Emails of members whose name+email derivation succeeded — the authoritative
        // "active" set for orphan removal. Built here (not re-derived from the raw,
        // unvalidated `members` array later) so a single bad entry can't throw during
        // orphan removal and abort it.
        const activeEmails = new Set();
        // Maps a derived login email → the first member string that produced it, so two entries that
        // normalise to the SAME email (a typo/duplicate in the roster list — e.g. 'G. Miller' vs a
        // stray 'G . Miller') can be detected. setCustomUserClaims REPLACES all claims, so processing
        // the second colliding entry would wipe the first's tier (an admin could silently lose admin).
        const seenEmails = new Map();

        // Create accounts for all current members, then (re)apply custom claims.
        for (const name of processMembers) {
            if (typeof name !== 'string' || !name.trim()) {
                failed.push(String(name));
                console.error(`[setupRosterAuth] Skipping invalid member entry: ${JSON.stringify(name)}`);
                continue;
            }
            let email, password;
            try {
                email    = nameToEmail(name);
                password = nameToPassword(name);
            } catch (err) {
                failed.push(`${name} (invalid: ${err.message})`);
                console.error(`[setupRosterAuth] Name derivation failed for "${name}": ${err.message}`);
                continue;
            }
            // Reject a collision: keep the FIRST occurrence's account + claims intact and surface the
            // duplicate as a failure rather than silently overwriting (which could strip admin/manager).
            if (seenEmails.has(email)) {
                failed.push(`${name} (duplicate login ${email}, already used by "${seenEmails.get(email)}" — fix the roster list)`);
                console.error(`[setupRosterAuth] Email collision: "${name}" derives ${email}, already claimed by "${seenEmails.get(email)}"`);
                continue;
            }
            seenEmails.set(email, name);
            // Derivation succeeded — this is an active member; never orphan-disable it.
            activeEmails.add(email);
            let uid;
            try {
                const user = await admin.auth().createUser({ email, password, displayName: name });
                uid = user.uid;
                created.push(name);
                console.log(`[setupRosterAuth] Created: ${email}`);
            } catch (err) {
                if (err.code === 'auth/email-already-exists') {
                    // Fetch UID so we can still (re)apply claims, and re-enable
                    // if the account was previously disabled (returning staff member).
                    try {
                        const existing = await admin.auth().getUserByEmail(email);
                        uid = existing.uid;
                        if (existing.disabled) {
                            await admin.auth().updateUser(uid, { disabled: false });
                            console.log(`[setupRosterAuth] Re-enabled returning member: ${email}`);
                        }
                        skipped.push(name);
                    } catch (lookupErr) {
                        // Lookup/re-enable failed: the account exists but we couldn't act on
                        // it, so claims won't be applied. Report it as a real failure, not a
                        // benign skip, so the result reflects what actually happened.
                        failed.push(`${name} (lookup-failed: ${lookupErr.message})`);
                        console.error(`[setupRosterAuth] Lookup/re-enable failed for ${name}: ${lookupErr.message}`);
                    }
                } else {
                    const reason = err.code || err.message || 'unknown';
                    failed.push(`${name} (${reason})`);
                    console.error(`[setupRosterAuth] Failed for ${name}: ${reason}`);
                }
            }

            // Set or clear the admin/manager custom claim — applies to both new and existing
            // accounts. Also sets the name claim for all members — required by Firestore rules
            // for staffContact owner-isolation and override per-member isolation (B2).
            // setCustomUserClaims REPLACES all claims, so a demoted member (removed from the
            // admin/manager list) automatically loses the elevated claim on the next run.
            // admin outranks manager: an admin is never also given manager (admin already
            // satisfies every rule the manager claim would).
            if (uid) {
                // claimsForTier (unit-tested) owns the tier logic: admin outranks manager, linksDesigner
                // is additive, every account gets `name`. setCustomUserClaims REPLACES all claims, so a
                // demoted member loses the elevated claim on the next run.
                const claims = claimsForTier(name, { adminSet: adminMembers, managerSet: managerMembers, designerSet: designerMembers });
                try {
                    await admin.auth().setCustomUserClaims(uid, claims);
                    const tier = (claims.admin ? 'admin+name' : claims.manager ? 'manager+name' : 'name') + (claims.linksDesigner ? '+designer' : '');
                    console.log(`[setupRosterAuth] Set ${tier} claim: ${email}`);
                } catch (claimErr) {
                    failed.push(`${name} (claim-failed: ${claimErr.message})`);
                    console.error(`[setupRosterAuth] Failed to set claim for ${name}: ${claimErr.message}`);
                }
            }
        }

        // Disable accounts for leavers — anyone with @myb-roster.local not in the
        // validated active set (built during the main loop above). Wrapped so a transient
        // listUsers failure can't 500 the whole request AFTER the account-creation loop
        // already ran — that discarded the populated created/skipped/failed report and left
        // the admin unable to tell which accounts WERE provisioned (v16.23). Re-running is
        // idempotent, so a partial report + orphanSweepFailed flag beats a raw failure.
        // Leaver handling (B4: DRY-RUN by default; disables only with an explicit confirm). An orphan
        // is any @myb-roster.local account not in the server active set. `removeOrphans` alone returns
        // the list that WOULD be disabled (orphansToDisable) for the admin to review; a second call with
        // `confirmOrphanRemoval` then disables + REVOKES refresh tokens (so a disabled account's existing
        // session stops being accepted for writes within the hour, not just blocked from re-signing-in).
        let orphanSweepFailed = false;
        const orphansToDisable = [];  // dry-run preview: labels that WOULD be disabled
        if (removeOrphans) {
            try {
                let pageToken;
                do {
                    const page = await admin.auth().listUsers(1000, pageToken);
                    // computeOrphanLabels (unit-tested) owns the "which accounts are leaver orphans"
                    // filter (@myb-roster.local, not in activeEmails, not already disabled).
                    for (const { uid, label } of computeOrphanLabels(page.users, activeEmails)) {
                        if (!confirmOrphanRemoval) {
                            orphansToDisable.push(label);   // DRY RUN — preview only, disable nothing
                            continue;
                        }
                        try {
                            await admin.auth().updateUser(uid, { disabled: true });
                            // Revoke so an already-issued ID token for this account is rejected on
                            // its next refresh (within the hour), not just future sign-ins. Best-effort.
                            try { await admin.auth().revokeRefreshTokens(uid); } catch (_) { /* non-fatal */ }
                            disabled.push(label);
                            console.log(`[setupRosterAuth] Disabled + revoked leaver: ${label}`);
                        } catch (err) {
                            failed.push(label);
                            console.error(`[setupRosterAuth] Failed to disable ${label}: ${err.message}`);
                        }
                    }
                    pageToken = page.pageToken;
                } while (pageToken);
            } catch (err) {
                orphanSweepFailed = true;
                console.error(`[setupRosterAuth] Leaver sweep failed (accounts above were still processed): ${err.message}`);
            }
        }

        res.json({
            created, skipped, disabled, failed,
            ...(orphanSweepFailed ? { orphanSweepFailed: true } : {}),
            // Present only for a removeOrphans request WITHOUT confirm — the admin previews these,
            // then re-submits with confirmOrphanRemoval:true to actually disable them.
            ...(removeOrphans && !confirmOrphanRemoval ? { orphanDryRun: true, orphansToDisable } : {}),
        });
    }
);

/**
 * resetMemberPassword — admin break-glass (PASSWORD_PLAN.md §5). Resets ONE member's Firebase Auth
 * password back to their surname default and stamps `passwordStatus/{member}.resetAt` (Admin SDK,
 * bypassing Firestore rules) so the account is flagged as surname-default again (the Settings nudge
 * then prompts them to choose a new one — there is no forced overlay yet; that is Phase 2). This is
 * the only ADMIN / server-side password-write path — self-service changes go through the client
 * `setOwnPassword` (`updatePassword`) in firebase-client.js, which the server never sees.
 *
 * Admin-only — the same guard as setupRosterAuth (verifyIdToken(checkRevoked) + admin claim). Target
 * must be a SERVER-OWNED provisioned account (roster-members.json), never a raw client name.
 *
 * Body: { member: string, revoke?: boolean }. `revoke` (default true) signs the member out of their
 * OTHER devices — true for a real reset; false for a Phase-2 migration nudge (leave working sessions).
 */
const resetMemberPassword = onRequest(
    { region: 'europe-west2', timeoutSeconds: 60, cors: ADMIN_FUNCTION_ORIGINS },
    async (req, res) => {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

        const bearer = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
        let decodedAuth;
        try {
            // checkRevoked=true — a disabled/revoked admin's still-cached token must not reset accounts.
            decodedAuth = await admin.auth().verifyIdToken(bearer, true);
        } catch (_) {
            return res.status(401).json({ error: 'Unauthorised' });
        }
        if (decodedAuth.admin !== true) {   // strict — fail closed on any non-true claim
            return res.status(403).json({ error: 'Forbidden — admin claim required' });
        }

        // Body (raw-body fallback like setupRosterAuth): member name + optional revoke.
        let body = req.body;
        if (!body || typeof body !== 'object') {
            try { body = JSON.parse((req.rawBody || '').toString() || '{}'); } catch (_) { body = {}; }
        }
        const member = typeof body.member === 'string' ? body.member.trim() : '';
        const revoke = body.revoke !== false;   // default true
        if (!member) return res.status(400).json({ error: 'Missing member' });

        // Target must be a server-owned provisioned account (B4) — never trust a raw client name.
        const cfg = resolveRosterAuthConfig(rosterMembers);
        if (cfg.error) return res.status(500).json({ error: 'Server roster config invalid — run `npm run generate:roster-members`' });
        if (!cfg.processMembers.includes(member)) {
            return res.status(404).json({ error: `Unknown member "${member}" — run Set up accounts first` });
        }

        try {
            // Derive inside the try: nameToPassword throws for an unusable (e.g. single-token) name,
            // and outside the try that surfaced as an ungraceful 500 with no JSON body. All current
            // members are "X. Surname", so this is latent hardening, matching setupRosterAuth.
            const email    = nameToEmail(member);
            const password = nameToPassword(member);   // surname default (reuses the parity-guarded helper)
            const user = await admin.auth().getUserByEmail(email);
            await admin.auth().updateUser(user.uid, { password });
            // ── PAST THIS LINE THE CREDENTIAL HAS CHANGED, AND NOTHING MAY SAY OTHERWISE ─────────
            // (v21.86, external audit.) Revocation used to be a bare `await` inside the outer try,
            // so a failure there took the whole call to the generic 500 — skipping the resetAt
            // stamp on the way. The admin was told the reset failed about an account whose password
            // was now the surname default; the reasonable next move is to retry, or to tell the
            // member their old password still works. Neither is true.
            //
            // Each later stage is now attempted on its own and REPORTED on its own. The rule this
            // encodes is the one the stamp already followed and revocation did not: once the
            // password mutation succeeds, this endpoint reports what happened, never "nothing did".
            let revoked = false;
            if (revoke) {
                try {
                    await admin.auth().revokeRefreshTokens(user.uid);
                    revoked = true;
                } catch (revokeErr) {
                    // The one consequence worth naming: the member's OTHER devices may still hold
                    // working sessions. That is a security-relevant partial state, so it is logged
                    // as an error and returned to the admin rather than folded into a boolean.
                    console.error('[resetMemberPassword] revoke failed (password WAS reset) for', member,
                                  revokeErr && revokeErr.code, revokeErr);
                }
            }
            // Stamp resetAt so the member is prompted to set a new password. merge preserves any
            // existing passwordSetAt (whose staleness vs this resetAt is what marks them un-migrated).
            // The password is ALREADY changed + sessions revoked by this point, so a failure of only
            // this Firestore stamp must NOT report the reset as failed (the old 500 told the admin
            // "nothing changed" when the account was in fact reset). Surface it as a partial success:
            // the reset stands, but the "un-migrated" flag couldn't be written, so the member won't be
            // nudged to re-set until a re-run. A retry heals the stamp (the reset is idempotent).
            let stamped = true;
            try {
                await admin.firestore().collection('passwordStatus').doc(member).set(
                    { resetAt: admin.firestore.FieldValue.serverTimestamp() },
                    { merge: true },
                );
            } catch (stampErr) {
                stamped = false;
                console.error('[resetMemberPassword] resetAt stamp failed (password WAS reset) for', member, stampErr && stampErr.code, stampErr);
            }
            // `revoked` is now what HAPPENED, not what was asked for. A caller reading the old
            // field saw the REQUEST echoed back, which is the same value on the failure path.
            return res.json({
                ok: true, member, revoked, stamped,
                ...(revoke && !revoked ? { revokeFailed: true } : {}),
            });
        } catch (e) {
            if (e && e.code === 'auth/user-not-found') {
                return res.status(404).json({ error: `No Firebase account for "${member}" — run Set up accounts first` });
            }
            console.error('[resetMemberPassword] failed for', member, e && e.code, e);
            return res.status(500).json({ error: 'Reset failed' });
        }
    }
);

/**
 * requestPasswordReset — a locked-out member asks the admin to reset their password.
 *
 * THE APP'S ONLY PUBLIC UNAUTHENTICATED ENDPOINT, and deliberately so. A member who has forgotten
 * their password cannot sign in, so they have no Firebase identity — and `signInAnonymously` runs only
 * on the calendar (calendar-app.js), never on a protected page's login overlay. So a direct Firestore
 * write is impossible for exactly the person who needs this. The alternatives were to establish a new
 * anonymous session on the protected pages (an explicit anti-goal in SECURITY_RELEASE_PLAN.md, and new
 * auth behaviour beside the login path — the area with this app's worst outage history) or to open a
 * client-writable collection. A server endpoint beats both: Firestore rules stay fully CLOSED to
 * clients (`allow write: if false` on resetRequests — only this function's Admin SDK writes), and every
 * validation is server-side and unbypassable.
 *
 * It records a request and NOTHING ELSE. It never resets a password: an unauthenticated caller who
 * could force any member back to the guessable surname default would undo exactly what v18.92 shipped,
 * and with token revocation would also boot them off their devices. The admin performs the reset from
 * Operations → Account status. The human in the loop IS the authentication — this is a doorbell, not a
 * recovery mechanism.
 *
 * How the abuse surface is bounded:
 *  · **The doc ID is the member name**, so the collection can never exceed the roster. Flooding is
 *    impossible BY CONSTRUCTION, not by rate limiting — the worst case is one stale row per member.
 *  · **The name must be in the server-owned `activeMembers` list** (roster-members.json, B4). That also
 *    makes the name safe for the admin card to render: it came from OUR list, never the request body.
 *  · **No free text of any kind is stored.** An unauthenticated endpoint writing caller-controlled
 *    strings into an admin UI is an injection surface for no benefit.
 *  · **Throttled** per member (shouldRecordResetRequest) so repeat taps don't inflate the count.
 *  · **maxInstances** caps the cost of a flood. (The eventual real control is App Check — Track D.)
 *  · **No enumeration**: it answers the same way for any roster name whether or not an account exists,
 *    and the roster names are already public in the login dropdown, so nothing new is revealed.
 *
 * Body: { member: string }. Always 200 for a valid roster name.
 */
const RESET_REQUEST_THROTTLE_MS = 10 * 60 * 1000;   // 10 minutes
// How long the admin notification may take before the endpoint gives up on it and answers the member
// anyway. Well inside the function's 30s timeout, leaving room for the record itself — the request is
// the product, the push is a courtesy, and the courtesy must never cost the product.
const ADMIN_NOTIFY_BUDGET_MS = 10_000;
// One admin push per this window, however many DIFFERENT members file a request inside it. The
// per-member throttle above cannot bound a walk of the public roster; this can. Chosen to be long
// enough to absorb a scripted burst and short enough that a genuine second request later in a shift
// still rings. See shouldNotifyAdmin.
const ADMIN_NOTIFY_COALESCE_MS = 5 * 60 * 1000;   // 5 minutes

// SERVER-SIDE kill switch (v18.97, external review). CONFIG.PASSWORD_RESET_REQUESTS hides the client
// LINK; it does nothing to the endpoint, which is public and callable directly — so during an
// incident there was no way to actually close this door short of deleting the function. Flip to false
// and deploy functions to reject every caller. Kept a constant rather than a Firestore flag on
// purpose: an incident switch must not depend on a read that the incident might be affecting.
const RESET_REQUESTS_ENABLED = true;

/**
 * Push the "someone asked for a password reset" notice to the ADMIN's devices only (Phase 2).
 *
 * Two lookups, both of which fail closed rather than widening the audience:
 *  · admin name → Firebase Auth uid (`getUserByEmail` on the synthetic account address). A name that
 *    can't be resolved is simply dropped from the target list — an unresolvable admin must not become
 *    "send to everyone".
 *  · uid → their own push subscriptions (sendTargetedPush).
 *
 * The headline states the queue DEPTH, so read `resetRequests` AFTER the write. `.select('notifiedAt')`
 * fetches document ids plus that one field — the collection is bounded by the roster (doc id = member
 * name), so this is a ~50-doc metadata read, not a scan. If the count read fails, fall back to 1: a
 * notification naming the member with a possibly-low count still does its job, where no notification
 * does not.
 *
 * @param {string} member                  who asked (from the server-owned roster)
 * @param {string[]} adminNames            roster-members.json roles.admin
 * @param {import('firebase-functions/params').SecretParam} vapidPrivate
 * @returns {Promise<void>}
 */
async function notifyAdminOfResetRequest(member, adminNames, vapidPrivate) {
    const uids = [];
    for (const name of adminNames || []) {
        try {
            const user = await admin.auth().getUserByEmail(nameToEmail(name));
            if (user && user.uid) uids.push(user.uid);
        } catch (e) {
            console.warn('[requestPasswordReset] could not resolve admin uid for', name, e && e.code);
        }
    }
    if (uids.length === 0) return;   // sendTargetedPush would refuse anyway; skip the VAPID setup

    // One read serves both the queue depth AND the coalescing decision. `notifiedAt` is the only
    // field fetched — still a metadata-scale read over a collection bounded by the roster.
    let pending = 1;
    /** @type {Array<number|null>} notifiedAt of every row EXCEPT this member's */
    let otherStamps = [];
    try {
        const snap = await admin.firestore().collection('resetRequests').select('notifiedAt').get();
        pending = snap.size || 1;
        otherStamps = snap.docs
            .filter(d => d.id !== member)
            .map(d => {
                const t = d.data().notifiedAt;
                return t && typeof t.toMillis === 'function' ? t.toMillis() : null;
            });
    } catch (e) {
        console.warn('[requestPasswordReset] pending count failed — notifying with 1', e && e.code);
    }

    // GLOBAL coalescing (v18.97, external review). The per-member throttle bounds one person; it does
    // nothing about a caller walking the public roster and filing one request per name, which used to
    // produce one push each. Fifty buzzes is both the nuisance and the reason a real request would
    // then be ignored. One push per window, carrying the queue depth, says more with less.
    //
    // The window is measured from other rows' `notifiedAt` — pushes that were actually accepted —
    // not their `requestedAt`. v21.85 (external review): the old criterion let a FAILED first push
    // silence a second member's real request for the rest of the window. See shouldNotifyAdmin.
    if (!shouldNotifyAdmin(otherStamps, Date.now(), ADMIN_NOTIFY_COALESCE_MS)) {
        console.log('[requestPasswordReset] notification coalesced — a push was accepted inside the window; pending:', pending);
        return;
    }

    setupWebPush(vapidPrivate, VAPID_PUBLIC_KEY);
    const { headline, body } = buildResetRequestNotice(member, pending);
    const accepted = await sendTargetedPush(
        buildPushPayload({
            feature: 'resetRequest',
            headline,
            body,
            url: `${STAFF_SITE_URL}/operations.html#reset-requests`,
        }),
        uids,
        '[reset-request]',
    );

    // Record that the admin was REACHED, which is what the next request's coalescing decision needs
    // to know. Nothing is stamped when no subscription accepted the message, so the next member in
    // the window rings the phone instead of inheriting a silence. Wrapped: failing to write the
    // stamp only costs a duplicate notification later, and the push has already gone.
    if (accepted > 0) {
        try {
            await admin.firestore().collection('resetRequests').doc(member).set(
                { notifiedAt: admin.firestore.FieldValue.serverTimestamp() },
                { merge: true },
            );
        } catch (e) {
            console.warn('[requestPasswordReset] could not stamp notifiedAt for', member, e && e.code);
        }
    } else {
        console.warn('[requestPasswordReset] nothing accepted the push for', member, '— not stamping notifiedAt');
    }
}

const requestPasswordReset = onRequest(
    {
        region: 'europe-west2', timeoutSeconds: 30, cors: ADMIN_FUNCTION_ORIGINS, maxInstances: 3,
        // Needed for the admin notification (Phase 2). Recording the request does not depend on it —
        // a missing/rotated key degrades to "the row is there, the phone stays quiet".
        secrets: [VAPID_PRIVATE_KEY],
    },
    async (req, res) => {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        // The kill switch, server-side (v18.97). 503 rather than 404: it is honest about the endpoint
        // existing but being closed, and it does not change what an outsider can learn about the
        // roster. The client link is hidden separately by CONFIG.PASSWORD_RESET_REQUESTS.
        if (!RESET_REQUESTS_ENABLED) return res.status(503).json({ error: 'Reset requests are temporarily unavailable' });

        let body = req.body;
        if (!body || typeof body !== 'object') {
            try { body = JSON.parse((req.rawBody || '').toString() || '{}'); } catch (_) { body = {}; }
        }
        const member = typeof body.member === 'string' ? body.member.trim() : '';
        if (!member) return res.status(400).json({ error: 'Missing member' });

        const cfg = resolveRosterAuthConfig(rosterMembers);
        if (cfg.error) return res.status(500).json({ error: 'Server roster config invalid' });
        // Unknown name → 404 with a generic message. The roster IS public (login dropdown), so this
        // reveals nothing; it just stops junk names creating rows.
        if (!cfg.processMembers.includes(member)) {
            return res.status(404).json({ error: 'Unknown member' });
        }

        try {
            const docRef = admin.firestore().collection('resetRequests').doc(member);

            // Whether a Firebase account exists at all decides which remedy the admin needs: Reset, or
            // run Set up accounts first. The login overlay must not distinguish these (it would leak
            // which names are provisioned); the admin's own card has no such constraint, and guessing
            // wrong costs a round trip.
            //
            // A FAILURE HERE MUST NOT LOSE THE REQUEST (fix, v18.94). This used to rethrow anything that
            // wasn't `user-not-found`, so a transient Auth blip returned 500 and wrote nothing — trading
            // the whole doorbell for a nicety, at the one moment recovery matters. `provisioned` is now
            // left UNSET when it can't be determined, and the card treats unknown as "check yourself".
            /** @type {boolean|null} */
            let provisioned = true;
            try {
                await admin.auth().getUserByEmail(nameToEmail(member));
            } catch (e) {
                if (e && e.code === 'auth/user-not-found') provisioned = false;
                else {
                    provisioned = null;
                    console.warn('[requestPasswordReset] provisioned lookup failed for', member, e && e.code);
                }
            }

            // TRANSACTION, not read-then-write (fix, v18.94). The old sequential get→set let every
            // request already in flight read a stale timestamp and write: 40 concurrent taps recorded 40
            // and drove `count` to 40 inside the window the throttle exists to collapse to 1 — which
            // also means N writes/second to ONE document, past Firestore's ~1/s sustained guidance. The
            // count is what the admin reads as "how stuck is this person", so it has to mean something.
            const recorded = await admin.firestore().runTransaction(async tx => {
                const snap   = await tx.get(docRef);
                const stamp  = snap.exists ? snap.data().requestedAt : null;
                const lastMs = stamp && typeof stamp.toMillis === 'function' ? stamp.toMillis() : null;
                if (!shouldRecordResetRequest(lastMs, Date.now(), RESET_REQUEST_THROTTLE_MS)) return false;
                /** @type {any} */
                const data = {
                    memberName:  member,
                    requestedAt: admin.firestore.FieldValue.serverTimestamp(),
                    count:       admin.firestore.FieldValue.increment(1),
                };
                if (provisioned !== null) data.provisioned = provisioned;
                tx.set(docRef, data, { merge: true });
                return true;
            });

            console.log('[requestPasswordReset]', recorded ? 'recorded' : 'throttled', 'for', member,
                        'provisioned:', provisioned);

            // Tell the admin (Phase 2). ONLY on a genuinely-recorded request: a throttled repeat tap is
            // the same person asking twice, and re-notifying would let anyone with the URL ring the
            // admin's phone at will — the throttle is the rate limit for the notification too.
            //
            // Wrapped so it can NEVER fail the request. The doorbell is the row in Firestore; the push
            // is a courtesy on top. A push outage that turned into a 500 here would lose the request
            // itself and send the member away thinking nobody heard them — the precise failure v18.94
            // fixed one line above, and it must not reappear via a different route.
            //
            // TIME-BOXED, and that is the load-bearing part. The try/catch below only survives a
            // REJECTION; the notify path makes up to four network calls (admin uid lookup, count
            // read, then the pushes) and none of them is guaranteed to settle. Without a bound, a
            // hung push service eats the function's 30s budget and Cloud Run kills the request —
            // returning an error to a member whose request WAS successfully recorded, telling them
            // nobody heard them when the doorbell had already rung. Exactly the never-settles-is-
            // not-a-rejection class v18.94 fixed in the forced overlay; it must not come back here.
            if (recorded) {
                try {
                    await Promise.race([
                        notifyAdminOfResetRequest(member, cfg.admin, VAPID_PRIVATE_KEY),
                        new Promise((_, rej) =>
                            setTimeout(() => rej(new Error('notify timed out')), ADMIN_NOTIFY_BUDGET_MS)),
                    ]);
                } catch (e) {
                    console.warn('[requestPasswordReset] admin notify failed for', member, e && e.message);
                }
            }
            // IDENTICAL body either way (fix, v18.94). Returning `throttled: true` was the exact oracle
            // the comment beside it warned against: anyone could poll the 50 public names and learn who
            // is locked out RIGHT NOW — a ready-made pretext for a "hi, it's IT about your password
            // reset" call, aimed at the people most likely to fall for it. The distinction stays in the
            // log line, where only the admin can see it.
            return res.json({ ok: true });
        } catch (e) {
            console.error('[requestPasswordReset] failed for', member, e && e.code, e);
            return res.status(500).json({ error: 'Could not record the request' });
        }
    }
);

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
 * WHAT IT DOES NOT MEASURE. Sign-ins, not activity. Sessions last 30 days (absolute)
 * (session.js), so most page opens are session RESTORES, not sign-ins — a member can sign in once
 * and use the app daily for a month. Two consequences, both stated on the card rather than hidden:
 *   · Because a live session REQUIRES a sign-in inside 30 days, "signed in within 30 days" is a
 *     slight OVER-count of active people — it includes anyone who signed in once and stopped.
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
    { region: 'europe-west2', timeoutSeconds: 60, cors: ADMIN_FUNCTION_ORIGINS },
    async (req, res) => {
        if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

        const bearer = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
        let decodedAuth;
        try {
            decodedAuth = await admin.auth().verifyIdToken(bearer, true);
        } catch (_) {
            return res.status(401).json({ error: 'Unauthorised' });
        }
        if (decodedAuth.admin !== true) {   // strict — fail closed on any non-true claim
            return res.status(403).json({ error: 'Forbidden — admin claim required' });
        }

        // An ALLOWLIST of the current roster, not a denylist of admins (v18.97, external review).
        // Excluding only admins counted every other enabled account in the project — a leaver whose
        // orphan sweep hasn't run, or one it failed on — inflating both the total and the
        // never-signed-in figure on a card that calls itself exact. Admins are excluded by being left
        // out here, mirroring recordUsage's write-time CONFIG.ADMIN_NAMES filter.
        // Derived from the SERVER-owned roster (roster-members.json), never a client payload.
        const cfg = resolveRosterAuthConfig(rosterMembers);
        if (cfg.error) return res.status(500).json({ error: 'Server roster config invalid' });
        const adminSet = new Set(cfg.admin);
        const allowedEmails = new Set(
            cfg.processMembers.filter(n => !adminSet.has(n)).map(n => nameToEmail(n).toLowerCase()));

        try {
            // Paginate: listUsers caps at 1000 per page. The roster is ~50, so this is one page in
            // practice — the loop is here so it stays correct if that ever stops being true.
            const users = [];
            let pageToken;
            do {
                const page = await admin.auth().listUsers(1000, pageToken);
                users.push(...page.users);
                pageToken = page.pageToken;
            } while (pageToken);

            const stats = summariseSignIns(users, Date.now(), allowedEmails);
            console.log('[getSignInStats]', JSON.stringify(stats));
            return res.json(stats);
        } catch (e) {
            console.error('[getSignInStats] failed', e && e.code, e);
            return res.status(500).json({ error: 'Could not read sign-in stats' });
        }
    }
);
    return { setupRosterAuth, resetMemberPassword, requestPasswordReset, getSignInStats };
}

module.exports = { buildAuthEndpoints };
