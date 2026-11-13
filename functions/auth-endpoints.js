/**
 * functions/auth-endpoints.js — the ACCOUNT-AND-CREDENTIAL domain of the Cloud Functions
 * (third cut of the index.js domain split; push.js v20.52, documents.js in the same pass as this).
 *
 * Owns: setupRosterAuth (provision accounts + claim tiers from the server-owned roster),
 * resetMemberPassword (the admin break-glass), getSignInStats (the admin-only exact sign-in read)
 * and getAccountSetupGaps (the read-only provisioning audit); and it BUILDS requestPasswordReset (the
 * public doorbell, ./reset-request.js) and returns it with them. Everything ACCOUNT-shaped: who has
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
 * (resolveRosterAuthConfig, claimsForTier, computeOrphanLabels, summariseAccountGaps,
 * summariseSignIns), member-identity.js and account-lifecycle.js (passwordWriteRefused,
 * unwrittenResetAnswer, elevatedClaimsLost, disabledLeaverUids), and are unit-tested there —
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
    summariseSignIns,
    summariseAccountGaps,
} = require('./roster-parse-helpers');
const { setupWebPush, sendTargetedPush, releasePushForOwner } = require('./push');
const { requireAdmin, readJsonBody } = require('./request-helpers');
const { mustReclaim, claimedByAnotherMember, unlinkOtherProviders } = require('./member-identity');
const { buildResetRequestEndpoint } = require('./reset-request');
const { passwordWriteRefused, unwrittenResetAnswer, elevatedClaimsLost, disabledLeaverUids } = require('./account-lifecycle');

/**
 * Stamp `passwordStatus/{member}.resetAt`, the marker a device's SILENT sign-in is refused against
 * (AUTH_AND_SESSIONS.md 23). Every path that puts an account back on the surname default calls it
 * FIRST and stops if it throws (functions-core-2): the default is what a forgotten device signs itself
 * back in with, so a stamp failing after the reset let the very phone it was meant to sign out return.
 * A stamp for a reset that then fails costs one typed sign-in, which the admin asked for anyway.
 * `remember` (the admin reset) first reads the stamp being replaced, so a REFUSED password write can
 * put it back (`restoreResetAt`, sign-in audit E1); the write's time pins that restore to this stamp.
 * @param {string} member
 * @param {{ remember?: boolean }} [opts]
 * @returns {Promise<{ previous: any, writeTime: any }>}  `previous` undefined when there was none or not asked
 */
async function stampResetAt(member, { remember = false } = {}) {
    const ref = getFirestore().collection('passwordStatus').doc(member);
    const previous = remember ? (await ref.get()).get('resetAt') : undefined;
    const { writeTime } = await ref.set({ resetAt: FieldValue.serverTimestamp() }, { merge: true });
    return { previous, writeTime };
}
/**
 * Put back the `resetAt` a REFUSED password write was stamped over — or remove the field, where there was
 * none — but only while the document is exactly as that stamp left it (`lastUpdateTime`): a second reset,
 * or a password set since, keeps the newer state, a stale stamp being the safe direction.
 * @param {string} member  @param {{ previous: any, writeTime: any }} stamp  stampResetAt's answer
 */
async function restoreResetAt(member, { previous, writeTime }) {
    await getFirestore().collection('passwordStatus').doc(member).update(
        { resetAt: previous === undefined ? FieldValue.delete() : previous }, { lastUpdateTime: writeTime });
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
 *   { created, skipped, reclaimed, disabled, failed, demoted: string[],
 *     orphanSweepFailed?: true,
 *     orphanDryRun?: true, orphansToDisable?: string[] }   // last two: dry-run preview only
 *   `reclaimed` names every member whose account this run put back on the surname default and
 *   signed out — an account registered from outside (taken back) or a disabled one re-enabled.
 *   The admin is the only person who can tell them, which is why they are named. `demoted` names
 *   every member this run took admin, manager or linksDesigner from, each signed out of every device.
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
        const demoted  = [];   // lost admin, manager or linksDesigner this run, and signed out (account-lifecycle.js)
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
            // A NEW ACCOUNT IS STAMPED FIRST too (sign-in audit E3), as a take-back and a re-enable are: one
            // deleted in the console and made again inherited an old passwordSetAt — shown "Own", no forced
            // change, an old device's silent sign-in let back in. Only an account the list does NOT hold is
            // stamped (a stamp on an existing one would sign its member out); no answer, or no stamp, and
            // nothing is created for that name.
            let exists;
            try { exists = (await getAuth().getUsers([{ email }])).users.length > 0; } catch (lookupErr) {
                failed.push(`${name} (lookup-failed: ${lookupErr.message})`);
                console.error(`[setupRosterAuth] lookup-failed for ${name}: ${lookupErr.message}`);
                continue;
            }
            if (!exists) try { await stampResetAt(name); } catch (stampErr) {
                failed.push(`${name} (stamp-failed: ${stampErr.message} — no account was created)`);
                console.error(`[setupRosterAuth] resetAt stamp failed, so ${email} was not created: ${stampErr.message}`);
                continue;
            }
            let uid, justCreated = false, previousClaims = null;
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
                            previousClaims = existing.customClaims;   // what the stamp below may take away
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
                let lost = [];
                try {
                    // A just-created account left claimless is one the NEXT run takes back (password
                    // reset + revoke, `mustReclaim`), so its first stamp gets one immediate retry.
                    await getAuth().setCustomUserClaims(uid, claims).catch((e) => {
                        if (!justCreated) throw e;
                        return getAuth().setCustomUserClaims(uid, claims);
                    });
                    const tier = (claims.admin ? 'admin+name' : claims.manager ? 'manager+name' : 'name') + (claims.linksDesigner ? '+designer' : '');
                    console.log(`[setupRosterAuth] Set ${tier} claim: ${email}`);
                    lost = elevatedClaimsLost(previousClaims, claims);   // only once the new claims are on
                } catch (claimErr) {
                    failed.push(`${name} (claim-failed: ${claimErr.message})`);
                    console.error(`[setupRosterAuth] Failed to set claim for ${name}: ${claimErr.message}`);
                }
                // A TIER TAKEN AWAY STOPS AT ONCE (sign-in audit D3): its sessions are revoked, so the old
                // tier's cached token is refused by every checkRevoked endpoint now, not when it renews.
                if (lost.length) try {
                    await getAuth().revokeRefreshTokens(uid);
                    demoted.push(name);
                    console.warn(`[setupRosterAuth] ${email} lost ${lost.join(' and ')} — signed out of every device`);
                } catch (revokeErr) {
                    failed.push(`${name} (lost ${lost.join(' and ')} but could not be signed out, so the old access lasts until their sign-in renews: ${revokeErr.message})`);
                    console.error(`[setupRosterAuth] revoke after a lost tier failed for ${name}: ${revokeErr.message}`);
                }
            }
        }

        // Leavers — any @myb-roster.local account outside the validated active set built above. B4:
        // DRY-RUN by default. `removeOrphans` alone returns what WOULD be disabled (orphansToDisable);
        // `confirmOrphanRemoval` disables + REVOKES, so an open session stops being accepted within the
        // hour. Wrapped so a listUsers failure cannot 500 the request AFTER the loop above ran, and
        // throw away the report of what WAS provisioned (v16.23): a partial report + orphanSweepFailed.
        let orphanSweepFailed = false, disabledLeaverPushRemoved = 0;
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
                    // And the leavers ALREADY disabled (sign-in audit D2): a phone with a token still valid
                    // after the sweep can save its push record again. Every confirmed run releases them —
                    // idempotent, never listed as newly disabled, and never the PIN account (account-lifecycle.js).
                    if (confirmOrphanRemoval) for (const uid of disabledLeaverUids(page.users, activeEmails)) {
                        try { disabledLeaverPushRemoved += await releasePushForOwner(uid); } catch (pushErr) {
                            console.warn(`[setupRosterAuth] Could not remove push records of a disabled leaver: ${pushErr.message}`);
                        }
                    }
                    pageToken = page.pageToken;
                } while (pageToken);
            } catch (err) {
                orphanSweepFailed = true;
                console.error(`[setupRosterAuth] Leaver sweep failed (accounts above were still processed): ${err.message}`);
            }
            if (confirmOrphanRemoval) console.log(`[setupRosterAuth] Removed ${disabledLeaverPushRemoved} push record(s) of leavers already disabled`);
        }

        res.json({
            created, skipped, reclaimed, disabled, failed, demoted,
            ...(orphanSweepFailed ? { orphanSweepFailed: true } : {}),
            // Present only for a removeOrphans request WITHOUT confirm — the admin previews these,
            // then re-submits with confirmOrphanRemoval:true to actually disable them.
            ...(removeOrphans && !confirmOrphanRemoval ? { orphanDryRun: true, orphansToDisable } : {}),
            ...(removeOrphans && confirmOrphanRemoval ? { disabledLeaverPushRemoved } : {}),
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
 * Body: { member: string, lostDevice?: true }. A reset ALWAYS signs the other devices out. `revoke: false`
 * belonged to the Phase-2 migration nudge the forced overlay replaced; nothing sends it, and it is ignored.
 * `lostDevice: true` — strictly the boolean — is the reset for a LOST OR STOLEN PHONE (the stage below).
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
        const lostDevice = body.lostDevice === true;   // strictly the boolean — anything else is an ordinary reset

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
            let stamp;
            try {
                stamp = await stampResetAt(member, { remember: true });
            } catch (stampErr) {
                console.error('[resetMemberPassword] resetAt stamp failed — nothing was changed for', member,
                              stampErr && stampErr.code, stampErr);
                return res.status(503).json({ error: 'Could not record the reset, so nothing was changed — try again' });
            }
            // A PASSWORD WRITE THAT THROWS (sign-in audit E1) was either REFUSED — nothing changed, so the
            // stamp goes back — or its outcome is UNKNOWN, and the stamp stays: account-lifecycle.js.
            try {
                await getAuth().updateUser(user.uid, takeBack
                    ? { password, displayName: member, disabled: false, ...unlinkOtherProviders(user) }
                    : { password });
            } catch (writeErr) {
                let restored = false;
                if (passwordWriteRefused(writeErr)) try { await restoreResetAt(member, stamp); restored = true; } catch (restoreErr) {
                    console.error('[resetMemberPassword] the refused reset stays stamped for', member, restoreErr && restoreErr.code, restoreErr);
                }
                console.error('[resetMemberPassword] password write failed for', member, writeErr && writeErr.code, { restored }, writeErr);
                const { status, error } = unwrittenResetAnswer(member, writeErr, { restored });
                return res.status(status).json({ error });
            }
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
            // OUTSIDER's devices, and the member never had any on it. Nor for a lost phone (below).
            if (!takeBack && !lostDevice) try {
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
            // A LOST OR STOLEN PHONE (sign-in audit D1, Nov 2026). The notice above would land on THAT
            // phone's lock screen, and its push record would go on receiving every notice addressed to
            // this member. So no notice, and every record the account owns is deleted, taken-back or not;
            // the member's own devices save theirs again at their next signed-in Calendar load. A FOURTH
            // stage, reported on its own: the credential has changed, so it can never fail the reset.
            let pushReleased = null;
            if (lostDevice) try { pushReleased = await releasePushForOwner(user.uid); } catch (releaseErr) {
                console.error('[resetMemberPassword] push release failed (password WAS reset) for', member,
                              releaseErr && releaseErr.code, releaseErr);
            }
            // `revoked` is what HAPPENED. `stamped` is always true here (no reset proceeds without
            // its stamp) and stays in the answer because Operations still reads it.
            return res.json({
                ok: true, member, revoked, stamped: true, notified,
                ...(!revoked ? { revokeFailed: true } : {}),
                // The account still carries NO claim, so the member cannot use the app on it until
                // Set up accounts stamps one — Operations says so (v24.57).
                ...(takeBack ? { takenBack: true } : {}),
                ...(lostDevice ? { lostDevice: true, ...(pushReleased === null ? { pushReleaseFailed: true } : { pushReleased }) } : {}),
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

// requestPasswordReset — the public doorbell a locked-out member rings — is built by ./reset-request.js,
// which holds its reasoning. Its SERVER-SIDE kill switch stays here, where the break-glass notes say it is
// (v18.97, external review). CONFIG.PASSWORD_RESET_REQUESTS hides the client LINK; it does nothing to the
// endpoint, which is public and callable directly — so during an incident there was no way to actually
// close this door short of deleting the function. Flip to false and deploy functions to reject every
// caller. Kept a constant rather than a Firestore flag on purpose: an incident switch must not depend
// on a read that the incident might be affecting.
const RESET_REQUESTS_ENABLED = true;
const { requestPasswordReset } = buildResetRequestEndpoint({ VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, STAFF_SITE_URL,
    ADMIN_FUNCTION_ORIGINS, enabled: RESET_REQUESTS_ENABLED, resetRequestAnswerFloorMs });

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
