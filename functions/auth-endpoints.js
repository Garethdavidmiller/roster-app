/**
 * functions/auth-endpoints.js — the ACCOUNT-AND-CREDENTIAL domain of the Cloud Functions
 * (third cut of the index.js domain split; push.js v20.52, documents.js in the same pass as this).
 *
 * Owns: setupRosterAuth (provision accounts + claim tiers from the server-owned roster),
 * resetMemberPassword (the admin break-glass), requestPasswordReset (the public doorbell)
 * getSignInStats (the admin-only exact sign-in read) and getAccountSetupGaps (the
 * read-only provisioning audit). Everything ACCOUNT-shaped: who has
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
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
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
    summariseAccountGaps,
} = require('./roster-parse-helpers');
const { setupWebPush, sendTargetedPush, releasePushForOwner } = require('./push');
const { requireAdmin, readJsonBody } = require('./request-helpers');
const { mustReclaim, claimedByAnotherMember, unlinkOtherProviders } = require('./member-identity');

/**
 * Stamp `passwordStatus/{member}.resetAt`, the marker a device's SILENT sign-in is refused against
 * (AUTH_AND_SESSIONS.md 23). Every path that puts an account back on the surname default calls it
 * FIRST and stops if it throws (functions-core-2): the default is what a forgotten device signs itself
 * back in with, so a stamp failing after the reset let the very phone it was meant to sign out return.
 * A stamp for a reset that then fails costs one typed sign-in, which the admin asked for anyway.
 * @param {string} member
 * @returns {Promise<void>}
 */
async function stampResetAt(member) {
    await getFirestore().collection('passwordStatus').doc(member).set(
        { resetAt: FieldValue.serverTimestamp() }, { merge: true });
}
const { isViewerAccount } = require('./calendar-viewer-auth');
const rosterMembers = require('./roster-members.json');

/**
 * Build the account-domain endpoints. Called once from index.js with the shared infra.
 * @param {object} deps
 * @param {import('firebase-functions/params').SecretParam} deps.VAPID_PRIVATE_KEY
 * @param {string}   deps.VAPID_PUBLIC_KEY
 * @param {string}   deps.STAFF_SITE_URL
 * @param {string[]} deps.ADMIN_FUNCTION_ORIGINS
 * @param {number}   [deps.resetRequestAnswerFloorMs]  the test seam for RESET_REQUEST_ANSWER_FLOOR_MS;
 *                                                   index.js passes nothing, so production keeps it
 */
function buildAuthEndpoints({ VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, STAFF_SITE_URL, ADMIN_FUNCTION_ORIGINS,
    resetRequestAnswerFloorMs }) {

/**
 * POST /setupRosterAuth
 *
 * Creates Firebase Auth accounts for all active roster members and optionally
 * disables accounts for anyone who has left. Run any time membership changes —
 * it is idempotent: an existing, enabled account that already carries claims is
 * re-claimed as it stands, and one that does not (registered from outside, or
 * disabled as a leaver's) is reset to the member's default first.
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
 *   { created, skipped, reclaimed, disabled, failed: string[],
 *     orphanSweepFailed?: true,
 *     orphanDryRun?: true, orphansToDisable?: string[] }   // last two: dry-run preview only
 *   `reclaimed` names every member whose account this run put back on the surname default and
 *   signed out — an account registered from outside (taken back) or a disabled one re-enabled.
 *   The admin is the only person who can tell them, which is why they are named.
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

        // This re-provisions accounts, so a revoked admin's cached token is refused at once (requireAdmin).
        if (!(await requireAdmin(req, res))) return;

        // B4: only ACTION flags come from the body (the member and role lists are SERVER-OWNED, below).
        // parseSetupActionFlags reads them from rawBody too — v2 parses req.body only for a JSON
        // Content-Type — so no flag is silently dropped. Unit-tested in roster-parse-helpers.test.mjs.
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
        const reclaimed = [];
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
            let uid, justCreated = false;
            try {
                const user = await getAuth().createUser({ email, password, displayName: name });
                uid = user.uid;
                justCreated = true;
                created.push(name);
                console.log(`[setupRosterAuth] Created: ${email}`);
            } catch (err) {
                if (err.code === 'auth/email-already-exists') {
                    // Fetch UID so we can still (re)apply claims, and re-enable
                    // if the account was previously disabled (returning staff member).
                    let reclaiming = false, reEnabling = false;
                    try {
                        const existing = await getAuth().getUserByEmail(email);
                        // The shared PIN account with this email linked to it: never adopted (the next unlock rebuilds it).
                        if (isViewerAccount(existing)) {
                            failed.push(`${name} (${email} is linked to the shared Calendar PIN account — run this again after the next PIN unlock)`);
                            continue;
                        }
                        // An account whose claims belong to ANOTHER member is never adopted: stamping
                        // this name's claims on it would hand that member this one's identity and tier.
                        const other = claimedByAnotherMember(existing);
                        if (other) {
                            failed.push(`${name} (${email} holds an account claimed for "${other}" — check it in the Firebase console)`);
                            console.error(`[setupRosterAuth] ${email} holds an account claimed for another member — not adopted`);
                            continue;
                        }
                        uid = existing.uid;
                        if (mustReclaim(existing)) {
                            reclaiming = true;
                            // AN ACCOUNT THIS SERVER NEVER STAMPED (v24.24). Every account the server
                            // creates gets its claims in the same run, so one at a roster email with no
                            // server claim at all was registered from outside — the gap v24.23 left,
                            // where a stranger signs up a new starter's derived email before Set up
                            // accounts reaches it. Adopting it as found would hand that stranger the
                            // member's claims. So take it back first: the password becomes the one the
                            // member would have been given, the display name the roster's, and every
                            // session on it is revoked. Reported by name, so the admin can tell the
                            // member what their password now is. resetAt FIRST (stampResetAt): a failed
                            // stamp is a reclaim-failed with nothing touched.
                            await stampResetAt(name);
                            await getAuth().updateUser(uid, { password, displayName: name, disabled: false, ...unlinkOtherProviders(existing) });
                            await getAuth().revokeRefreshTokens(uid);
                            reclaimed.push(name);
                            console.warn(`[setupRosterAuth] Reclaimed an account with no server claims: ${email}`);
                        } else if (existing.disabled) {
                            reEnabling = true;
                            // A DISABLED ACCOUNT IS NEVER HANDED BACK AS IT WAS (lead-1, 10 Nov 2026):
                            // it is a leaver's, still on the password its holder chose, and whoever
                            // returns under the same initial and surname derives the same email. So it
                            // is reset as an admin reset is — stamp, surname default, sessions revoked,
                            // the previous holder's push records released — and ONLY THEN enabled. A
                            // failure leaves it disabled for the next run. Named in `reclaimed`.
                            await stampResetAt(name);
                            await getAuth().updateUser(uid, { password, displayName: name, ...unlinkOtherProviders(existing) });
                            await getAuth().revokeRefreshTokens(uid);
                            try {
                                const n = await releasePushForOwner(uid);
                                if (n) console.log(`[setupRosterAuth] Removed ${n} push record(s) left on a re-enabled account: ${email}`);
                            } catch (pushErr) {
                                console.warn(`[setupRosterAuth] Could not remove push records on a re-enabled account (${email}): ${pushErr.message}`);
                            }
                            await getAuth().updateUser(uid, { disabled: false });
                            reclaimed.push(name);
                            console.warn(`[setupRosterAuth] Re-enabled a disabled account on the default password, signed out: ${email}`);
                        } else {
                            skipped.push(name);
                        }
                    } catch (lookupErr) {
                        // Couldn't act on the account, so NO claims: `uid` is cleared (it was set
                        // before the failing call). Stamping after a failed take-back would give the
                        // outsider the member's claims, and the next run would adopt it for good.
                        uid = undefined;
                        const what = reclaiming ? 'reclaim-failed' : reEnabling ? 're-enable-failed' : 'lookup-failed';
                        failed.push(`${name} (${what}: ${lookupErr.message})`);
                        console.error(`[setupRosterAuth] ${what} for ${name}: ${lookupErr.message}`);
                    }
                } else {
                    const reason = err.code || err.message || 'unknown';
                    failed.push(`${name} (${reason})`);
                    console.error(`[setupRosterAuth] Failed for ${name}: ${reason}`);
                }
            }

            // Set the tier's claims on new and existing accounts alike. Every account gets `name` (the
            // rules' per-member isolation, B2); claimsForTier (unit-tested) owns the tiers — admin
            // outranks manager, linksDesigner is additive. setCustomUserClaims REPLACES all claims, so
            // a member removed from the admin/manager list loses the elevated claim on the next run.
            if (uid) {
                const claims = claimsForTier(name, { adminSet: adminMembers, managerSet: managerMembers, designerSet: designerMembers });
                try {
                    // A just-created account left claimless is one the NEXT run takes back (password
                    // reset + revoke, `mustReclaim`), so its first stamp gets one immediate retry.
                    await getAuth().setCustomUserClaims(uid, claims).catch((e) => {
                        if (!justCreated) throw e;
                        return getAuth().setCustomUserClaims(uid, claims);
                    });
                    const tier = (claims.admin ? 'admin+name' : claims.manager ? 'manager+name' : 'name') + (claims.linksDesigner ? '+designer' : '');
                    console.log(`[setupRosterAuth] Set ${tier} claim: ${email}`);
                } catch (claimErr) {
                    failed.push(`${name} (claim-failed: ${claimErr.message})`);
                    console.error(`[setupRosterAuth] Failed to set claim for ${name}: ${claimErr.message}`);
                }
            }
        }

        // Leavers — any @myb-roster.local account outside the validated active set built above. B4:
        // DRY-RUN by default. `removeOrphans` alone returns what WOULD be disabled (orphansToDisable);
        // `confirmOrphanRemoval` disables + REVOKES, so an open session stops being accepted within the
        // hour. Wrapped so a listUsers failure cannot 500 the request AFTER the loop above ran, and
        // throw away the report of what WAS provisioned (v16.23): a partial report + orphanSweepFailed.
        let orphanSweepFailed = false;
        const orphansToDisable = [];  // dry-run preview: labels that WOULD be disabled
        if (removeOrphans) {
            try {
                let pageToken;
                do {
                    const page = await getAuth().listUsers(1000, pageToken);
                    // computeOrphanLabels (unit-tested) owns the "which accounts are leaver orphans"
                    // filter (@myb-roster.local, not in activeEmails, not already disabled).
                    for (const { uid, label } of computeOrphanLabels(page.users, activeEmails)) {
                        if (!confirmOrphanRemoval) {
                            orphansToDisable.push(label);   // DRY RUN — preview only, disable nothing
                            continue;
                        }
                        try {
                            await getAuth().updateUser(uid, { disabled: true });
                            // Revoke so an already-issued ID token for this account is rejected on
                            // its next refresh (within the hour), not just future sign-ins. Best-effort.
                            try { await getAuth().revokeRefreshTokens(uid); } catch (_) { /* non-fatal */ }
                            // And stop the broadcasts (whole-app review, H4): a leaver who never ran
                            // Sign out keeps an owner-stamped push record, and every staff broadcast
                            // went on reaching their phone. Best-effort, like the revoke — the account
                            // is disabled either way, and that is what this row reports.
                            try {
                                const n = await releasePushForOwner(uid);
                                if (n) console.log(`[setupRosterAuth] Removed ${n} push record(s) for leaver: ${label}`);
                            } catch (pushErr) {
                                console.warn(`[setupRosterAuth] Could not remove push records for ${label}: ${pushErr.message}`);
                            }
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
            created, skipped, reclaimed, disabled, failed,
            ...(orphanSweepFailed ? { orphanSweepFailed: true } : {}),
            // Present only for a removeOrphans request WITHOUT confirm — the admin previews these,
            // then re-submits with confirmOrphanRemoval:true to actually disable them.
            ...(removeOrphans && !confirmOrphanRemoval ? { orphanDryRun: true, orphansToDisable } : {}),
        });
    }
);

/**
 * resetMemberPassword — admin break-glass (PASSWORD_DESIGN.md §5). Stamps `passwordStatus/{member}.
 * resetAt` FIRST (Admin SDK, bypassing Firestore rules — no stamp, no reset: stampResetAt), then puts
 * ONE member's Firebase Auth password back to their surname default and signs their other devices
 * out; at their next sign-in the forced overlay (CONFIG.FORCE_PASSWORD_SET) has them choose their
 * own. The only ADMIN / server-side password-write path — self-service changes go through the client
 * `changeOwnPassword` (`updatePassword`) in firebase-client.js, which the server never sees.
 *
 * Admin-only (requireAdmin). Target must be a SERVER-OWNED provisioned account (roster-members.json),
 * never a raw client name.
 *
 * Body: { member: string }. A reset ALWAYS signs the other devices out. `revoke: false` belonged to
 * the Phase-2 migration nudge the forced overlay replaced; nothing sends it, and it is ignored.
 */
const resetMemberPassword = onRequest(
    // The VAPID secret is for the "your password was reset" push below: without it the key reads '' in production.
    { region: 'europe-west2', timeoutSeconds: 60, cors: ADMIN_FUNCTION_ORIGINS, secrets: [VAPID_PRIVATE_KEY] },
    async (req, res) => {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

        if (!(await requireAdmin(req, res))) return;   // a revoked admin's cached token must not reset accounts

        const body = readJsonBody(req);   // the member's name, in whatever shape the body arrived
        const member = typeof body.member === 'string' ? body.member.trim() : '';
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
            const user = await getAuth().getUserByEmail(email);
            // The shared Calendar PIN account can end up holding a roster email (any PIN holder can
            // link one). Setting up accounts already refuses to adopt it; a reset must not give it a
            // known password and revoke every PIN session either (v24.38).
            if (isViewerAccount(user)) {
                return res.status(409).json({ error: `${email} is linked to the shared Calendar PIN account — run this again after the next PIN unlock` });
            }
            // …and an account claimed for ANOTHER member is not this member's to reset (as Set up
            // accounts refuses to adopt it): it would put that member on this one's default.
            const other = claimedByAnotherMember(user);
            if (other) {
                return res.status(409).json({ error: `${email} holds an account claimed for "${other}" — check it in the Firebase console` });
            }
            // AN ACCOUNT THIS SERVER NEVER STAMPED is TAKEN BACK, not just re-passworded (v24.56, auth
            // review) — the same as setupRosterAuth does, for the same reason: it was registered from
            // outside, so its display name and any other sign-in method are the outsider's.
            const takeBack = mustReclaim(user);
            // A DISABLED account is refused (sign-in review, Nov 2026): a reset answered ok and left it
            // disabled, so the admin told the member to sign in to an account that could not be used.
            // Set up accounts is the remedy — it re-enables a roster member's account on this default.
            if (user.disabled && !takeBack) {
                return res.status(409).json({ error: `${member}'s account is disabled, so a reset would not let them in. Run Set up accounts: it re-enables the account on their surname default.` });
            }
            // THE STAMP FIRST, AND IT MUST LAND (functions-core-2). resetAt is what keeps the other
            // devices out once the password is the surname default (AUTH_AND_SESSIONS.md 23); stamped
            // after, a failed write let the lost phone straight back in. No stamp, nothing changes.
            try {
                await stampResetAt(member);
            } catch (stampErr) {
                console.error('[resetMemberPassword] resetAt stamp failed — nothing was changed for', member,
                              stampErr && stampErr.code, stampErr);
                return res.status(503).json({ error: 'Could not record the reset, so nothing was changed — try again' });
            }
            await getAuth().updateUser(user.uid, takeBack
                ? { password, displayName: member, disabled: false, ...unlinkOtherProviders(user) }
                : { password });
            // ── PAST THIS LINE THE CREDENTIAL HAS CHANGED, AND NOTHING MAY SAY OTHERWISE ─────────
            // (v21.86, external audit.) Revocation used to be a bare `await` inside the outer try,
            // so a failure there took the whole call to the generic 500. The admin was told the
            // reset failed about an account whose password was now the surname default; the
            // reasonable next move is to retry, or to tell the member their old password still
            // works. Neither is true.
            //
            // Each later stage is now attempted on its own and REPORTED on its own: once the
            // password mutation succeeds, this endpoint reports what happened, never "nothing did".
            let revoked = false;
            try {
                await getAuth().revokeRefreshTokens(user.uid);
                revoked = true;
            } catch (revokeErr) {
                // The one consequence worth naming: the member's OTHER devices may still hold
                // working sessions. That is a security-relevant partial state, so it is logged
                // as an error and returned to the admin rather than folded into a boolean.
                console.error('[resetMemberPassword] revoke failed (password WAS reset) for', member,
                              revokeErr && revokeErr.code, revokeErr);
            }
            // TELL THE MEMBER (v23.62, owner request). Until now the one person this is ABOUT was
            // the only person not told: their password had become the surname default and every
            // other device was signed out, and they learned both by failing to sign in. This
            // closes the loop on their OWN devices.
            //
            // `sendTargetedPush`, never `fanOutPush`, and the rule is the CONTENT's rather than a
            // convention: it names a person and says their credential changed.
            // `.claude/rules/notifications.md` poses the test as "would I be happy for all 50 staff
            // to read this?" — plainly not. The uid is the one ALREADY resolved above for the
            // password write, so unlike the reset-request notice there is no name→uid lookup that
            // could widen or miss the audience.
            //
            // A THIRD independently-reported stage, for the reason the two above it are: the
            // credential has already changed by this line, so a push failure must never report the
            // reset as failed. `notified` is what HAPPENED — `sendTargetedPush` returns how many
            // subscriptions ACCEPTED the message, and a member with no subscription is a legitimate
            // 0 rather than an error. It is the admin's cue to tell them another way.
            let notified = false;
            // NOT for a taken-back account (v24.57, review): the subscriptions it owns are the
            // OUTSIDER's devices, and the member never had any on it.
            if (!takeBack) try {
                setupWebPush(VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY);
                const accepted = await sendTargetedPush(
                    buildPushPayload({
                        feature: 'passwordReset',
                        // THE CREDENTIAL IS NEVER IN THE PAYLOAD. A push renders on a LOCK SCREEN,
                        // so naming the new password would show it to whoever picks the phone up —
                        // and this app's default is derived from a surname that is on the roster.
                        // What the member needs is that it changed and where to fix it.
                        body: 'The admin reset your password. Open Settings to choose your own.',
                        baseUrl: STAFF_SITE_URL,
                    }),
                    [user.uid],
                    '[resetMemberPassword]',
                );
                notified = accepted > 0;
            } catch (pushErr) {
                console.error('[resetMemberPassword] notify failed (password WAS reset) for', member,
                              pushErr && pushErr.code, pushErr);
            }
            // `revoked` is what HAPPENED. `stamped` is always true here (no reset proceeds without
            // its stamp) and stays in the answer because Operations still reads it.
            return res.json({
                ok: true, member, revoked, stamped: true, notified,
                ...(!revoked ? { revokeFailed: true } : {}),
                // The account still carries NO claim, so the member cannot use the app on it until
                // Set up accounts stamps one — Operations says so (v24.57).
                ...(takeBack ? { takenBack: true } : {}),
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
 * ONE OF THE APP'S TWO PUBLIC UNAUTHENTICATED ENDPOINTS (the other is `unlockCalendarViewer`, the
 * staff-PIN exchange), and deliberately so. A member who has forgotten their password cannot sign
 * in, so they have no Firebase identity — and nothing in the app signs in anonymously (the Calendar
 * stopped at v20.12, and the last path that could was retired at v24.34). So a direct Firestore
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
 *  · **The name must be on the server-owned roster** (`processMembers`: roster-members.json, B4). That also
 *    makes the name safe for the admin card to render: it came from OUR list, never the request body.
 *  · **No free text of any kind is stored.** An unauthenticated endpoint writing caller-controlled
 *    strings into an admin UI is an injection surface for no benefit.
 *  · **Throttled** per member (shouldRecordResetRequest) so repeat taps don't inflate the count.
 *  · **maxInstances** caps the cost of a flood. (The eventual real control is App Check — Track D.)
 *  · **No enumeration**: it answers the same way for any roster name whether or not an account exists,
 *    and the roster names are already public in the login dropdown, so nothing new is revealed.
 *  · **No "who is locked out" oracle**: a recorded request and a throttled repeat get the same body,
 *    and neither is answered before RESET_REQUEST_ANSWER_FLOOR_MS, so their timing matches too.
 *
 * Body: { member: string }. Always 200 for a valid roster name.
 */
const RESET_REQUEST_THROTTLE_MS = 10 * 60 * 1000;   // 10 minutes
// No answer to a valid name before this long after the request began (functions-core-4). A throttled
// repeat answered after two round trips and a recorded request after four to six plus a push, so the
// TIMING named who was locked out right now — what the identical body exists to hide. Sized above the
// recorded path's ordinary time AND one backoff of its two-attempt claim (3 s, review 11 Nov 2026: at
// 2 s a burst's retry showed). A push slow enough to pass it, or a large deliberate burst queued on
// the rows' locks, still shows — the price of not making a locked-out member wait longer (their screen
// reads "Sending…"), and every name such a burst probes is recorded where the admin sees it.
const RESET_REQUEST_ANSWER_FLOOR_MS = 3_000;
const answerFloorMs = Number.isFinite(resetRequestAnswerFloorMs) ? resetRequestAnswerFloorMs : RESET_REQUEST_ANSWER_FLOOR_MS;
// How long the admin notification may take before the endpoint gives up on it and answers the member
// anyway. Well inside the function's 30s timeout, leaving room for the record itself — the request is
// the product, the push is a courtesy, and the courtesy must never cost the product.
const ADMIN_NOTIFY_BUDGET_MS = 10_000;
// Each admin push's own bound, well inside that budget (functions-core-6): after the lookups, the
// transport's default 10 s meant a stalled push service always outlasted it.
const ADMIN_NOTIFY_SEND_TIMEOUT_MS = 5_000;
// One admin push per this window, however many DIFFERENT members file a request inside it. The
// per-member throttle above cannot bound a walk of the public roster; this can. Chosen to be long
// enough to absorb a scripted burst and short enough that a genuine second request later in a shift
// still rings. See shouldNotifyAdmin.
const ADMIN_NOTIFY_COALESCE_MS = 5 * 60 * 1000;   // 5 minutes
// How long one request's claim to be the sender holds the others back: the whole notify budget and a
// margin. A claim whose sender died is ignored after this, so a crash costs one window, not the queue.
const ADMIN_NOTIFY_CLAIM_MS = ADMIN_NOTIFY_BUDGET_MS + 5_000;

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
 * The headline states the queue DEPTH, so read `resetRequests` AFTER the write — inside the claim's
 * transaction, which is also what makes one push per burst hold (see the comment there). The
 * collection is bounded by the roster (doc id = member name), so this is a ~50-doc metadata read.
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
            const user = await getAuth().getUserByEmail(nameToEmail(name));
            if (user && user.uid) uids.push(user.uid);
        } catch (e) {
            console.warn('[requestPasswordReset] could not resolve admin uid for', name, e && e.code);
        }
    }
    if (uids.length === 0) return;   // sendTargetedPush would refuse anyway; skip the VAPID setup

    // ONE PUSH PER BURST, DECIDED BY A CLAIM TAKEN IN A TRANSACTION (sign-in review, Nov 2026). The
    // per-member throttle cannot bound a caller walking the public roster (v18.97), and read → send →
    // stamp let every request in a parallel burst read the rows before any push was stamped: fifty
    // names, fifty pushes. Now one transaction reads every row and marks THIS one as the sender unless
    // a push was ACCEPTED inside the window (`notifiedAt` — v21.85: a failed push must not silence the
    // next member) or another request is sending now (`notifyClaimedAt`). Transactions over the same
    // rows commit one at a time, so one request in a burst wins and the rest find its claim.
    //  · TWO attempts, not the SDK's five (review, 11 Nov 2026): each retry backs off 0.5–3.4 s, so a
    //    burst held recorded requests past the answer floor throttled ones met (RESET_REQUEST_ANSWER_FLOOR_MS).
    //  · A push that reached nobody is tried ONCE more, with the queue as it then stands: the requests
    //    that found its claim stood aside for it, and would otherwise wait for the next request.
    const rows = getFirestore().collection('resetRequests');
    const ms = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : NaN);
    for (let round = 0; round < 2; round++) {
        let pending = 1;
        try {
            const claimed = await getFirestore().runTransaction(async (tx) => {
                const snap = await tx.get(rows.select('notifiedAt', 'notifyClaimedAt'));
                pending = snap.size || 1;
                const others = snap.docs.filter(d => d.id !== member).map(d => d.data());
                const now = Date.now();
                if (!shouldNotifyAdmin(others.map(o => ms(o.notifiedAt)), now, ADMIN_NOTIFY_COALESCE_MS)) return false;
                // Held while |Δ| < life: a claim stamped a moment AHEAD of this clock still holds (unlike a
                // future `notifiedAt`), and one far ahead — a clock far out — cannot hold the queue for ever.
                if (others.some(o => Math.abs(now - ms(o.notifyClaimedAt)) < ADMIN_NOTIFY_CLAIM_MS)) return false;
                tx.update(rows.doc(member), { notifyClaimedAt: FieldValue.serverTimestamp() });
                return true;
            }, { maxAttempts: 2 });
            if (!claimed) {
                console.log('[requestPasswordReset] notification coalesced — another push covers it; pending:', pending);
                return;
            }
        } catch (e) {
            // ABORTED (10): the burst held these rows past the last retry, and one of its requests claimed.
            // NOT_FOUND (5): the admin cleared this row first. Stand aside for both. Anything else is a read
            // that failed: notify with a count of 1, as before — a possibly-low count still does its job.
            if (e && (e.code === 10 || e.code === 5)) {
                console.log('[requestPasswordReset] notification left to the burst for', member, e.code);
                return;
            }
            console.warn('[requestPasswordReset] coalescing read failed — notifying with 1', e && e.code);
            pending = 1;
        }
        let accepted = 0;
        try {
            // Inside (review, 11 Nov 2026): a VAPID key that will not load must still release the claim.
            setupWebPush(vapidPrivate, VAPID_PUBLIC_KEY);
            const { headline, body } = buildResetRequestNotice(member, pending);
            accepted = await sendTargetedPush(
                buildPushPayload({
                    feature: 'resetRequest',
                    headline,
                    body,
                    url: `${STAFF_SITE_URL}/operations.html#reset-requests`,
                }),
                uids,
                '[reset-request]',
                { timeoutMs: ADMIN_NOTIFY_SEND_TIMEOUT_MS },
            );
        } catch (e) {
            console.warn('[requestPasswordReset] the admin push failed for', member, e && e.message);
        }
        // Release the claim however the send ended, and record that the admin was REACHED only when a
        // subscription accepted the push, so the next member in the window rings the phone instead of
        // inheriting a silence. Wrapped: a lost write costs a duplicate notification at worst.
        // update(), never a merge-set (functions-core-6): this can run after the member was answered
        // and the admin has cleared the row, and a merge brought it back as a request nobody made.
        try {
            await rows.doc(member).update(accepted > 0
                ? { notifiedAt: FieldValue.serverTimestamp(), notifyClaimedAt: FieldValue.delete() }
                : { notifyClaimedAt: FieldValue.delete() });
        } catch (e) {
            console.warn('[requestPasswordReset] could not record the push for', member, e && e.code);
        }
        if (accepted > 0) return;
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
        // Measured from the top, so the floor covers every round trip either path makes.
        const answerNotBefore = Date.now() + answerFloorMs;
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        // The kill switch, server-side (v18.97). 503 rather than 404: it is honest about the endpoint
        // existing but being closed, and it does not change what an outsider can learn about the
        // roster. The client link is hidden separately by CONFIG.PASSWORD_RESET_REQUESTS.
        if (!RESET_REQUESTS_ENABLED) return res.status(503).json({ error: 'Reset requests are temporarily unavailable' });

        const body = readJsonBody(req);   // a Buffer body used to answer 400 "Missing member" (functions-core-8)
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
            const docRef = getFirestore().collection('resetRequests').doc(member);

            // Whether a Firebase account exists, and is enabled (sign-in review, Nov 2026), decides the
            // remedy the admin needs: Reset, or Set up accounts. The login overlay must not distinguish
            // these (it would leak which names are provisioned); the admin's own card has no such
            // constraint, and guessing wrong costs a round trip.
            //
            // A FAILURE HERE MUST NOT LOSE THE REQUEST (fix, v18.94). This used to rethrow anything that
            // wasn't `user-not-found`, so a transient Auth blip returned 500 and wrote nothing — trading
            // the whole doorbell for a nicety, at the one moment recovery matters. `provisioned` is now
            // CLEARED when it can't be determined (with `disabled`: an older row's answer must not stand in,
            // review 11 Nov 2026), and the card treats unknown as "check yourself".
            /** @type {boolean|null} */
            let provisioned = true;
            let disabled = false;
            try {
                disabled = !!(await getAuth().getUserByEmail(nameToEmail(member)))?.disabled;
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
            const recorded = await getFirestore().runTransaction(async tx => {
                const snap   = await tx.get(docRef);
                const stamp  = snap.exists ? snap.data().requestedAt : null;
                const lastMs = stamp && typeof stamp.toMillis === 'function' ? stamp.toMillis() : null;
                if (!shouldRecordResetRequest(lastMs, Date.now(), RESET_REQUEST_THROTTLE_MS)) return false;
                /** @type {any} */
                const data = {
                    memberName:  member,
                    requestedAt: FieldValue.serverTimestamp(),
                    count:       FieldValue.increment(1),
                };
                Object.assign(data, provisioned === null
                    ? { provisioned: FieldValue.delete(), disabled: FieldValue.delete() } : { provisioned, disabled });
                tx.set(docRef, data, { merge: true });
                return true;
            });

            console.log('[requestPasswordReset]', recorded ? 'recorded' : 'throttled', 'for', member,
                        'provisioned:', provisioned);

            // Tell the admin (Phase 2) — ONLY on a genuinely-recorded request: a throttled repeat is the
            // same person asking twice, and the throttle is the rate limit for the notification too.
            // It can NEVER fail the request: the doorbell is the row; the push is a courtesy on top, and
            // a push outage turned into a 500 would send the member away thinking nobody heard (v18.94).
            // TIME-BOXED, and that is the load-bearing part: the try/catch survives only a REJECTION,
            // and none of the notify path's network calls is guaranteed to settle. Unbounded, a hung push
            // service ate the function's 30s and Cloud Run answered an error to a member whose request
            // WAS recorded — the never-settles-is-not-a-rejection class v18.94 fixed in the forced
            // overlay. The race stops the WAITING, not the work, so each send has its own bound and the
            // stamp it ends with cannot re-create a cleared row (ADMIN_NOTIFY_SEND_TIMEOUT_MS, functions-core-6).
            if (recorded) {
                /** @type {ReturnType<typeof setTimeout>|undefined} */ let notifyTimer;
                try {
                    await Promise.race([
                        notifyAdminOfResetRequest(member, cfg.admin, VAPID_PRIVATE_KEY),
                        new Promise((_, rej) => {
                            notifyTimer = setTimeout(() => rej(new Error('notify timed out')), ADMIN_NOTIFY_BUDGET_MS);
                        }),
                    ]);
                } catch (e) {
                    console.warn('[requestPasswordReset] admin notify failed for', member, e && e.message);
                } finally {
                    // The race is settled; the losing timer must not run on for its full 10s after the answer
                    // has gone (test audit, 7 Nov 2026 — it held this file's suite open ten seconds a run).
                    clearTimeout(notifyTimer);
                }
            }
            // IDENTICAL body either way (fix, v18.94). `throttled: true` was the exact oracle: anyone could
            // poll the 50 public names and learn who is locked out RIGHT NOW — a ready-made pretext for a
            // "hi, it's IT about your password reset" call. The distinction stays in the log line, where
            // only the admin sees it. AND NO SOONER than the floor, or the timing says it instead
            // (RESET_REQUEST_ANSWER_FLOOR_MS, functions-core-4).
            const holdMs = answerNotBefore - Date.now();
            if (holdMs > 0) await new Promise((resolve) => setTimeout(resolve, holdMs));
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
    { region: 'europe-west2', timeoutSeconds: 60, cors: ADMIN_FUNCTION_ORIGINS },
    async (req, res) => {
        if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

        if (!(await requireAdmin(req, res))) return;

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
                const page = await getAuth().listUsers(1000, pageToken);
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
/**
 * getAccountSetupGaps — who on the roster is not properly provisioned, and who has left but still is.
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
    { region: 'europe-west2', timeoutSeconds: 60, cors: ADMIN_FUNCTION_ORIGINS },
    async (req, res) => {
        if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

        if (!(await requireAdmin(req, res))) return;

        const cfg = resolveRosterAuthConfig(rosterMembers);
        if (cfg.error) return res.status(500).json({ error: 'Server roster config invalid' });

        try {
            // Paginate exactly as setupRosterAuth's leaver sweep does; ~50 accounts is one page.
            const users = [];
            let pageToken;
            do {
                const page = await getAuth().listUsers(1000, pageToken);
                users.push(...page.users);
                pageToken = page.pageToken;
            } while (pageToken);

            // Admins are INCLUDED here, unlike getSignInStats. There they are excluded because the
            // figure is about staff usage; here a second admin whose claim was never applied is
            // exactly the kind of gap being looked for.
            const gaps = summariseAccountGaps(users, {
                processMembers: cfg.processMembers,
                adminSet:    new Set(cfg.admin),
                managerSet:  new Set(cfg.manager),
                designerSet: new Set(cfg.designer),
            });
            // Counts only in the log — the names are for the admin's screen, not the project's logs.
            console.log('[getAccountSetupGaps]', JSON.stringify({
                refused: gaps.refused || null, setUp: gaps.setUp.length, leavers: gaps.leavers.length,
            }));
            return res.json(gaps);
        } catch (e) {
            console.error('[getAccountSetupGaps] failed', e && e.code, e);
            return res.status(500).json({ error: 'Could not read account setup state' });
        }
    }
);

    return { setupRosterAuth, resetMemberPassword, requestPasswordReset, getSignInStats, getAccountSetupGaps };
}

module.exports = { buildAuthEndpoints };
