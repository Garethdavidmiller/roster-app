'use strict';

/**
 * functions/overtime.js — the OVERTIME AVAILABILITY domain: four endpoints and the Firestore
 * orchestration behind them. Every RULE lives next door in overtime-core.js, unit-tested with no
 * emulator; this module is the boundary — auth, transactions, batches, HTTP.
 *
 * Factory, for the reasons in documents.js's header: index.js stays the composition root, the
 * shared literals keep one guarded home, and the deps argument is the seam a future Node test
 * drives a fake admin SDK through.
 *
 * ── THE FOUR ENDPOINTS, AND WHY THERE ARE FOUR ─────────────────────────────────────────────────
 *
 *   createOvertimeWindow        reviewer. `dryRun: true` previews; false commits. ONE endpoint on
 *                               purpose — a separate preview would be a second code path claiming
 *                               to predict this one, and preview drift is exactly what that
 *                               arrangement produces.
 *   getOvertimeManagerOverview  reviewer. Six planning weeks WHETHER OR NOT a window exists. This
 *                               is the guard against the feature's one catastrophic silent
 *                               failure: nobody creates a window, so nobody is outstanding, no
 *                               reminder can fire, and an empty page is indistinguishable from
 *                               "no overtime needed this week".
 *   getMyOvertimeState          the member's ONLY read path. Firestore rules give ordinary members
 *                               nothing, deliberately, so this endpoint is where participation is
 *                               resolved — and it is also where `serverNow` comes from, because a
 *                               device clock must never decide what a member is shown.
 *   submitOvertimeAvailability  the only mutation A MEMBER makes. Transactional, revision-aware,
 *                               idempotent.
 *   purgeExpiredOvertimeWindows scheduled. The only irreversible thing here, so it ships DISARMED
 *                               and reports what it would remove until somebody reads a run.
 *   withdrawOvertimeParticipant reviewer. Stops a week EXPECTING one person — a leaver otherwise
 *                               stays a permanent non-responder in every open week. A flag, never
 *                               a delete: it changes what is expected, not what happened.
 *
 * ── IDENTITY IS THE TOKEN, NEVER THE BODY ──────────────────────────────────────────────────────
 * Every endpoint verifies with `checkRevoked: true` and takes the member from `decoded.name` — the
 * claim `setupRosterAuth` sets from the server-owned roster. A body-supplied member name would be
 * an impersonation path, and Master Admin must not have one either: oversight is not permission to
 * submit somebody else's declaration about their own life.
 *
 * ── RETENTION IS ENFORCED HERE, NOT IN THE RULES ───────────────────────────────────────────────
 * Both read endpoints omit windows past `retentionUntil`, so behaviour never depends on when the
 * purge last ran. It is deliberately not a Firestore rule: rules are not filters (one expired
 * document would fail a Manager's whole query rather than drop a row), and the only client reader
 * is the reviewer, who is entitled to the data anyway.
 */

const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
const OT = require('./overtime-core');
const { setupWebPush, sendTargetedPush } = require('./push');
const { nameToEmail, buildPushPayload } = require('./roster-parse-helpers');

/** Collection root. One name, used everywhere, so a typo cannot create a parallel universe. */
const WINDOWS = 'overtimeWindows';

/**
 * Build the Overtime endpoints. Called once from index.js with the shared infra.
 * @param {object} deps
 * @param {string[]} deps.ADMIN_FUNCTION_ORIGINS  CORS allowlist (defence in depth; the real control
 *   is the ID token + claim check inside each handler)
 * @param {{ overtimeRoster: Array<object>, maxRosterYear: number, overtimeBeta?: string[], roles: { admin: string[], manager: string[] } }} deps.rosterMembers
 *   the GENERATED server roster — never a client payload
 * @param {any} [deps.VAPID_PRIVATE_KEY] Web Push secret — absent in tests, where `notify` is
 *   injected instead; absent AND uninjected, sends become logged no-ops (never a throw)
 * @param {string} [deps.VAPID_PUBLIC_KEY]
 * @param {string} [deps.STAFF_SITE_URL] origin for the notification deep link
 * @param {{ sendPush?: Function, uidForName?: Function }} [deps.notify] test seam — the two
 *   halves the fakes need to observe: what was sent, and to whom
 */
function buildOvertimeEndpoints({ ADMIN_FUNCTION_ORIGINS, rosterMembers, purgeArmed = false,
    VAPID_PRIVATE_KEY = null, VAPID_PUBLIC_KEY = '', STAFF_SITE_URL = '', notify = null }) {

    // ── Push plumbing (v21.47) — TARGETED ONLY, and a courtesy at every step ────────────────────
    //
    // Availability is deadline-driven and nothing used to nudge anyone: a member who did not
    // happen to open the app before Tuesday noon became a permanent "No response". Two notices fix
    // that — "you have been asked" when a member joins a window's population, and a reminder on
    // the initial deadline's morning to participants who have said nothing at all.
    //
    // Every send is `sendTargetedPush` to resolved member uids; there is deliberately NO broadcast
    // branch (during the beta a fan-out would ping ~50 staff about a restricted beta, and at full
    // launch targeted-to-participants IS everyone eligible, so reach scales itself). The uid is
    // resolved from the member's account email — the SAME derivation `setupRosterAuth` provisions
    // accounts with, so the two cannot disagree — and a member with no account, or no subscribed
    // device, is silently skipped: fail closed, per member. A push can never fail the write it
    // announces; every path here is wrapped so the worst outcome is a log line.
    const send = (notify && notify.sendPush) || (VAPID_PRIVATE_KEY
        ? (payload, uids, tag) => {
            setupWebPush(VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY);
            return sendTargetedPush(payload, uids, tag);
        }
        : async (_payload, _uids, tag) => { console.warn(`${tag} push not configured — nothing sent`); return 0; });
    const uidForName = (notify && notify.uidForName) || (async (name) => {
        try { return (await admin.auth().getUserByEmail(nameToEmail(name))).uid; }
        catch { return null; }   // no account (or lookup hiccup) → this member is skipped, never guessed
    });

    /**
     * Tell newly-asked members they have a form — ONE notice per member per run, however many
     * weeks they were just added to. The tag replaces on the lock screen but each send still
     * buzzes, and five buzzes in five seconds about one page is not this app's register. The body
     * names each member's SOONEST new deadline — the one that can be missed.
     * @param {Array<{ milestones: any, names: string[] }>} entries
     */
    async function notifyAsked(entries) {
        try {
            /** @type {Map<string, any>} member → milestones of their earliest newly-asked week */
            const soonest = new Map();
            for (const e of entries || []) {
                if (!e || !e.milestones || !Array.isArray(e.names)) continue;
                for (const name of e.names) {
                    const cur = soonest.get(name);
                    if (!cur || e.milestones.initialDeadlineAt < cur.initialDeadlineAt) soonest.set(name, e.milestones);
                }
            }
            if (!soonest.size) return;
            /** @type {Map<string, { milestones: any, names: string[] }>} one send per shared soonest week */
            const groups = new Map();
            for (const [name, m] of soonest) {
                const g = groups.get(m.weekEnding) || { milestones: m, names: [] };
                g.names.push(name);
                groups.set(m.weekEnding, g);
            }
            for (const g of groups.values()) {
                const uids = (await Promise.all(g.names.map(uidForName))).filter(Boolean);
                if (!uids.length) {
                    console.log(`[overtimeAsked] ${g.milestones.weekEnding} — no resolvable targets among ${g.names.length} member(s)`);
                    continue;
                }
                const n = OT.askedNotice(g.milestones);
                const payload = buildPushPayload({
                    feature: 'overtime', headline: n.headline, body: n.body,
                    url: `${STAFF_SITE_URL}/overtime.html`,
                });
                await send(payload, uids, `[overtimeAsked ${g.milestones.weekEnding}]`);
            }
        } catch (err) {
            // The write this announces has already committed; the notice is a courtesy on top.
            console.error('[overtimeAsked] send failed (window unaffected):', err);
        }
    }

    /**
     * The deadline-morning reminder — participants of an INITIAL_OPEN window who have submitted
     * NOTHING, on the morning their answers are due (the 05:00 run; `reminderDue` selects the one
     * morning within 24h of the noon deadline). Somebody who answered has nothing to be reminded
     * of, and a withdrawn participant is no longer asked.
     *
     * `reminderSentAt` is stamped after the attempt whatever the send count — it protects the one
     * morning against a re-run, and once noon passes the phase moves and the question is closed.
     * @param {number} nowMs
     */
    async function sendInitialDeadlineReminders(nowMs) {
        let snap;
        try {
            snap = await db().collection(WINDOWS).get();
        } catch (err) {
            console.error('[overtimeReminder] could not list windows — standing down:', err);
            return;
        }
        for (const d of snap.docs) {
            const data = d.data();
            const milestones = storedMilestones(data);
            if (!OT.reminderDue(milestones, toMillis(data.reminderSentAt), nowMs)) continue;
            try {
                const [pSnap, sSnap] = await Promise.all([
                    d.ref.collection('participants').get(),
                    d.ref.collection('submissions').select().get(),
                ]);
                const submitted = new Set(sSnap.docs.map(s => s.id));
                const names = pSnap.docs
                    .filter(p => !OT.isWithdrawn(p.data()) && !submitted.has(p.id))
                    .map(p => p.id);
                const uids = (await Promise.all(names.map(uidForName))).filter(Boolean);
                if (uids.length) {
                    const n = OT.reminderNotice(milestones);
                    const payload = buildPushPayload({
                        feature: 'overtime', headline: n.headline, body: n.body,
                        url: `${STAFF_SITE_URL}/overtime.html`,
                    });
                    await send(payload, uids, `[overtimeReminder ${d.id}]`);
                }
                await d.ref.update({ reminderSentAt: admin.firestore.FieldValue.serverTimestamp() });
                console.log(`[overtimeReminder] ${d.id} — ${names.length} unanswered, ${uids.length} resolvable target(s)`);
            } catch (err) {
                // One bad week must not abandon the rest; an unstamped week retries tomorrow only
                // if its deadline is still ahead, which is exactly the right behaviour.
                console.error(`[overtimeReminder] ${d.id} failed:`, err);
            }
        }
    }

    /**
     * Is the retention purge allowed to DELETE, or only to report what it would delete?
     *
     * ── WHY IT SHIPS DISARMED ───────────────────────────────────────────────────────────────────
     *
     * `purgeExpiredOvertimeWindows` is the only irreversible thing this feature does, it runs
     * unattended, and the first time it has anything to do will be months after it was written — by
     * which point nobody is watching for it. A dry run is how the walk gets exercised against real
     * documents while its mistakes are still only log lines. Read one run's log, confirm the weeks
     * and the counts are the ones you expect, then arm it in `index.js`.
     *
     * It gates ONE statement, exactly as `dryRun` does in `createOvertimeWindow`: the selection, the
     * ordering and the counting are the same code either way, so what the log described is what the
     * armed run does rather than a prediction of it.
     *
     * A dependency rather than a constant here for the same reason as everything else in this
     * argument list — the literal belongs in the composition root, and a test can drive both sides
     * of the branch without editing source.
     */
    const PURGE_ARMED = purgeArmed === true;

    const db = () => admin.firestore();

    // ── Shared boundary helpers ─────────────────────────────────────────────────────────────────

    /**
     * Verify the caller and return their canonical identity, or answer the request and return null.
     *
     * `checkRevoked: true` is mandatory rather than preferred: a disabled or signed-out account's
     * cached token stays cryptographically valid for up to an hour, and this endpoint set writes a
     * person's own availability record. Matches setupRosterAuth / resetMemberPassword.
     *
     * @returns {Promise<{name:string, uid:string, admin:boolean, manager:boolean}|null>}
     */
    async function authenticate(req, res) {
        if (req.method !== 'POST') {
            res.status(405).json({ error: 'Method not allowed' });
            return null;
        }
        const bearer = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
        let decoded;
        try {
            decoded = await admin.auth().verifyIdToken(bearer, true);
        } catch (_) {
            res.status(401).json({ error: 'Unauthorised' });
            return null;
        }
        // The Calendar viewer holds `calendarViewer` and nothing else — no name, no roles — so it
        // falls out here with every other identity that is not a member. Named explicitly in the
        // test suite rather than left to follow from the absence of a name claim.
        if (typeof decoded.name !== 'string' || !decoded.name) {
            res.status(403).json({ error: 'Forbidden — a member identity is required' });
            return null;
        }
        return {
            name:    decoded.name,
            uid:     decoded.uid,
            admin:   decoded.admin === true,
            manager: decoded.manager === true,
        };
    }

    /** Reviewer = manager or admin. The only privileged role this feature has. */
    function isReviewer(who) {
        return !!who && (who.admin || who.manager);
    }

    /** Reviewer-only guard, applied after `authenticate`. */
    function requireReviewer(who, res) {
        if (isReviewer(who)) return true;
        res.status(403).json({ error: 'Forbidden — reviewer access required' });
        return false;
    }

    /** The window document's stored milestones, as the plain numbers the core works in. */
    function storedMilestones(data) {
        return {
            weekEnding:        data.weekEnding,
            weekStart:         data.weekStart,
            initialDeadlineAt: toMillis(data.initialDeadlineAt),
            draftRosterDate:   data.draftRosterDate,
            finalDeadlineAt:   toMillis(data.finalDeadlineAt),
            finalRosterDate:   data.finalRosterDate,
            retentionUntil:    toMillis(data.retentionUntil),
            policyVersion:     data.policyVersion,
        };
    }

    /** Firestore Timestamp | number | Date → epoch ms. */
    function toMillis(v) {
        if (v == null) return 0;
        if (typeof v === 'number') return v;
        if (typeof v.toMillis === 'function') return v.toMillis();
        if (v instanceof Date) return v.getTime();
        return 0;
    }

    /** Milliseconds → Firestore Timestamp, for anything stored as an instant. */
    function ts(ms) {
        return admin.firestore.Timestamp.fromMillis(ms);
    }

    // ── createOvertimeWindow ────────────────────────────────────────────────────────────────────

    /**
     * Preview or create a weekly window. Reviewer only.
     *
     * Body: `{ weekEnding: 'YYYY-MM-DD', dryRun?: boolean }`
     *
     * The SAME code authenticates, validates, derives the timetable and selects participants
     * whichever way `dryRun` falls — only the final write is conditional. That is the whole reason
     * there is no separate preview endpoint: a preview computed by different code is a prediction,
     * and a prediction can be wrong.
     *
     * The audience is NOT a client choice. It is release policy, resolved server-side, so a Manager
     * can see what will happen without being able to decide it.
     */
    const createOvertimeWindow = onRequest(
        // The VAPID secret rides along when configured (the asked notice sends from this handler);
        // conditional so the tests, which inject `notify` fakes, need no SecretParam at all.
        { region: 'europe-west2', timeoutSeconds: 60, cors: ADMIN_FUNCTION_ORIGINS,
            ...(VAPID_PRIVATE_KEY ? { secrets: [VAPID_PRIVATE_KEY] } : {}) },
        async (req, res) => {
            const who = await authenticate(req, res);
            if (!who) return;
            if (!requireReviewer(who, res)) return;

            const body = req.body || {};
            const weekEnding = typeof body.weekEnding === 'string' ? body.weekEnding : '';

            const r = await createWindow(weekEnding, {
                nowMs:  Date.now(),
                dryRun: body.dryRun === true,
                byName: who.name,
                byUid:  who.uid,
            });

            // Tell whoever was just asked, BEFORE responding — Cloud Functions may freeze the
            // instance after the response, so fire-and-forget here can silently never fire.
            // `notifyAsked` cannot throw, so the write's success is never held hostage to a push.
            if (r.asked) await notifyAsked([r.asked]);

            switch (r.outcome) {
                case 'invalid':         return res.status(400).json({ error: r.error });
                case 'no-participants': return res.status(409).json({ error: 'no-participants' });
                case 'too-many':        return res.status(507).json({ error: 'too-many-participants' });
                case 'preview':         return res.json({ ok: true, dryRun: true, window: r.window });
                case 'existed':         return res.json({ ok: true, existed: true, window: r.window,
                    added: r.added || [] });
                default:                return res.json({ ok: true, created: true, window: r.window });
            }
        });

    /**
     * Create (or preview) ONE window. No HTTP in it — the caller maps the outcome.
     *
     * Extracted at v20.61 so the scheduled job and the Manager's button run the SAME code. A second
     * creation path would be free to drift from this one, and a drifted scheduler is the worst
     * shape this feature has: it would keep reporting success while producing windows the manual
     * path would have produced differently — or not producing them at all, which is the silent
     * failure the whole design is arranged around.
     *
     * @param {string} weekEnding
     * @param {{ nowMs:number, dryRun?:boolean, byName:string, byUid:string|null }} ctx
     * @returns {Promise<{outcome:string, error?:string, window?:object, count?:number}>}
     */
    async function createWindow(weekEnding, { nowMs, dryRun = false, byName, byUid }) {
        const check = OT.validateWeekEnding(weekEnding, {
            nowMs, maxRosterYear: rosterMembers.maxRosterYear,
        });
        if (!check.ok) return { outcome: 'invalid', error: check.error };

        const milestones = OT.deriveMilestones(weekEnding);
        const audience = currentAudience();
        const participants = OT.selectParticipants(rosterMembers.overtimeRoster, {
            weekStart: milestones.weekStart,
            audience,
            // The server-owned admin list, plus the invited beta members. `manager` is deliberately
            // NOT passed: no audience makes a manager a participant, so handing one over would only
            // invite a future edit to use it. Review rights come from the claim, not the population.
            adminNames: (rosterMembers.roles && rosterMembers.roles.admin) || [],
            betaNames:  rosterMembers.overtimeBeta || [],
        });

        if (participants.length === 0) {
            // A window nobody is in can never receive a submission, and its counts read
            // "0 of 0 received" — which looks like a completed week rather than an empty one.
            // The realistic cause is a misconfigured audience (the restricted selector with no
            // admin entitlement, which fails closed by design), so failing loudly here is what
            // turns that into something a reviewer can act on.
            console.error(`[createOvertimeWindow] ${weekEnding} selected NO participants (audience=${audience})`);
            return { outcome: 'no-participants' };
        }

        if (participants.length > OT.MAX_PARTICIPANTS_PER_WINDOW) {
            // Fail loudly rather than splitting the batch. A window created across two batches
            // can half-exist, and a half-frozen participant population is not a smaller truth —
            // it is a false one, which then reports colleagues as non-responders forever.
            console.error(`[createOvertimeWindow] ${participants.length} participants exceeds the single-batch bound`);
            return { outcome: 'too-many', count: participants.length };
        }

        const preview = {
            ...milestones,
            audience,
            participants: participants.map(p => ({ memberName: p.memberName, grade: p.grade })),
            expectedCount: participants.length,
        };
        if (dryRun) return { outcome: 'preview', window: preview };

        const ref = db().collection(WINDOWS).doc(weekEnding);
        const existing = await ref.get();
        if (existing.exists) {
            // Two reviewers pressing Create at once, one pressing it twice, or the scheduler
            // meeting a week somebody just made by hand. The deterministic id already makes a
            // duplicate impossible; this makes the SECOND caller's experience "here is the window"
            // rather than an error — and it never REWRITES the frozen participant snapshot.
            //
            // It does, since v20.78, top it up: see `addMissingParticipants`. Add-only, open weeks
            // only, so the freeze still holds everywhere it protects anything.
            const added = await addMissingParticipants(ref, existing.data(), nowMs);
            return {
                outcome: 'existed',
                added,
                // Who was newly asked, for the caller to notify — the top-up's additions only.
                asked: added.length ? { milestones: storedMilestones(existing.data()), names: added } : null,
                window: { ...storedMilestones(existing.data()), audience: existing.data().audience },
            };
        }

        const batch = db().batch();
        batch.set(ref, {
            weekEnding:        milestones.weekEnding,
            weekStart:         milestones.weekStart,
            initialDeadlineAt: ts(milestones.initialDeadlineAt),
            draftRosterDate:   milestones.draftRosterDate,
            finalDeadlineAt:   ts(milestones.finalDeadlineAt),
            finalRosterDate:   milestones.finalRosterDate,
            retentionUntil:    ts(milestones.retentionUntil),
            policyVersion:     milestones.policyVersion,
            audience,
            createdAt:         admin.firestore.FieldValue.serverTimestamp(),
            createdByName:     byName,
            createdByUid:      byUid,
        });
        for (const p of participants) {
            batch.set(ref.collection('participants').doc(p.memberName), {
                memberName:  p.memberName,
                uid:         null,        // resolved lazily on first submission; see the header
                grade:       p.grade,
                rosterOrder: p.rosterOrder,
                createdAt:   admin.firestore.FieldValue.serverTimestamp(),
            });
        }
        await batch.commit();
        console.log(`[createOvertimeWindow] ${weekEnding} · ${audience} · ${participants.length} participants · by ${byName}`);
        return {
            outcome: 'created', window: preview,
            // Every participant was just asked; the caller decides when to say so (the scheduler
            // accumulates across weeks so one member gets ONE notice, not one per window).
            asked: { milestones, names: participants.map(p => p.memberName) },
        };
    }

    /**
     * The audience that a week's population WOULD have, computed now.
     * @param {string} weekStart
     */
    function audienceFor(weekStart) {
        return OT.selectParticipants(rosterMembers.overtimeRoster, {
            weekStart,
            audience:   currentAudience(),
            adminNames: (rosterMembers.roles && rosterMembers.roles.admin) || [],
            betaNames:  rosterMembers.overtimeBeta || [],
        });
    }

    /**
     * Top an OPEN window's frozen population up to the current audience. Add-only.
     *
     * ── WHY THE FREEZE NEEDED AN EXCEPTION, AND WHY THIS IS THE RIGHT ONE ───────────────────────
     *
     * Populations are frozen at creation so nobody is recorded as a non-responder for a week they
     * were never asked about. That is right, and it is untouched here.
     *
     * What it did NOT anticipate is automatic creation. The scheduler keeps the whole horizon made in
     * advance, so by the time anybody is invited, EVERY week they could usefully answer already
     * exists — and "existing windows are untouched" quietly became "an audience change never
     * takes effect". Reported live: a member added to the beta was told "no forms are open for
     * you" while the admin's were open, and her first form would have been a week in October.
     * At full launch the same arithmetic strands the whole roster for the length of the horizon.
     *
     * The rule that resolves it without weakening the freeze: **you may join a window whose FIRST
     * deadline you can still meet.** Not merely one you can still submit to — that was the v20.78
     * rule and it was half a deadline out (external review, Aug 2026).
     *
     * ── WHY `INITIAL_OPEN` AND NOT `isOpenPhase` ────────────────────────────────────────────────
     *
     * A window has two deadlines, and the first one is the one every judgement is measured against.
     * `deriveHistory` asks "was anything accepted before `initialDeadlineAt`?" and calls a
     * submission `lateInitial` when the answer is no. Add somebody during FINAL_OPEN and both
     * answers about them are false in the same direction:
     *
     *   · before they submit they sit under **No response** for a deadline that pre-dates their
     *     invitation — the exact manufactured non-responder the freeze exists to prevent, arriving
     *     through the door the freeze's own exception opened; and
     *   · the moment they submit they are labelled **Submitted after the initial deadline**, which
     *     reads as a person who was asked and did not answer in time. They were never asked.
     *
     * Neither is a display bug that a nicer label would fix. The data itself would be wrong, and it
     * is the data a clerk uses to decide who is reliable. The alternative — stamp an `invitedAt` on
     * the participant and teach every history rule to measure from it — is a second set of
     * late-submission semantics for a case that costs nothing to avoid: the person simply joins
     * from the next week whose initial deadline is still ahead of them. A slightly later start
     * beats a permanently inaccurate record.
     *
     * A CLOSED window was already refused and still is. Nobody is ever REMOVED, at any phase: a
     * population only grows.
     *
     * @returns {Promise<string[]>} the names added, for the caller to report
     */
    async function addMissingParticipants(ref, data, nowMs) {
        const milestones = storedMilestones(data);
        if (milestones.retentionUntil <= nowMs) return [];
        if (OT.phaseFor(milestones, nowMs) !== 'INITIAL_OPEN') return [];

        const want = audienceFor(milestones.weekStart);
        // Ids only — the existing documents are not needed to know who is already in.
        const have = new Set((await ref.collection('participants').select().get()).docs.map(d => d.id));
        const missing = want.filter(p => !have.has(p.memberName));
        if (!missing.length) return [];

        // The same single-batch bound as creation, for the same reason: a half-written population
        // is not a smaller truth, it is a false one. Here the whole population is `have + missing`.
        if (have.size + missing.length > OT.MAX_PARTICIPANTS_PER_WINDOW) {
            console.error(`[addMissingParticipants] ${data.weekEnding} would exceed the batch bound`);
            return [];
        }

        const batch = db().batch();
        for (const p of missing) {
            batch.set(ref.collection('participants').doc(p.memberName), {
                memberName:  p.memberName,
                uid:         null,
                grade:       p.grade,
                rosterOrder: p.rosterOrder,
                createdAt:   admin.firestore.FieldValue.serverTimestamp(),
            });
        }
        await batch.commit();
        console.log(`[addMissingParticipants] ${data.weekEnding} + ${missing.length}: ${missing.map(p => p.memberName).join(', ')}`);
        return missing.map(p => p.memberName);
    }

    // ── withdrawOvertimeParticipant ─────────────────────────────────────────────────────────────

    /**
     * Stop expecting an answer from one person for one week — or put them back. Reviewer only.
     *
     * Body: `{ weekEnding: 'YYYY-MM-DD', memberName: string, withdrawn: boolean }`
     *
     * ── IT IS A FLAG, NEVER A DELETE ────────────────────────────────────────────────────────────
     *
     * The participant document stays, and so does any submission and every revision beneath it.
     * That is not caution about data loss; it is the same rule the rest of this feature runs on.
     * A submission is somebody's declaration about their own life, and removing the record of it
     * because they later left is a quieter version of the silent overwrite `decideSubmission`
     * exists to prevent. Withdrawal changes what the week EXPECTS; it does not edit what happened.
     *
     * Restoring is the same call with `withdrawn: false`, and it removes the three fields rather
     * than writing `withdrawn: false` — see `OT.isWithdrawn` for why a written false would be
     * worse than useless here.
     *
     * The window's phase is checked from the STORED milestones, like everything else: a week that
     * has closed is a record, and this endpoint refuses to edit one.
     */
    const withdrawOvertimeParticipant = onRequest(
        { region: 'europe-west2', timeoutSeconds: 60, cors: ADMIN_FUNCTION_ORIGINS },
        async (req, res) => {
            const who = await authenticate(req, res);
            if (!who) return;
            if (!requireReviewer(who, res)) return;

            const body = req.body || {};
            const weekEnding = typeof body.weekEnding === 'string' ? body.weekEnding : '';
            const memberName = typeof body.memberName === 'string' ? body.memberName.trim() : '';
            const withdrawn = body.withdrawn === true;
            // The id shape is checked before it is used as a path segment, not after: `weekEnding`
            // and `memberName` are both document ids here, and an unvalidated one reaches Firestore
            // as a path rather than as data.
            if (!OT.isSaturday(weekEnding) || !memberName || !OT.isSafeDocId(memberName)) {
                return res.status(400).json({ error: 'invalid-request' });
            }

            const ref = db().collection(WINDOWS).doc(weekEnding);
            const snap = await ref.get();
            if (!snap.exists) return res.status(404).json({ error: 'no-window' });

            const nowMs = Date.now();
            const allowed = OT.canChangeParticipation(storedMilestones(snap.data()), nowMs);
            if (!allowed.ok) return res.status(409).json({ error: allowed.error });

            const pRef = ref.collection('participants').doc(memberName);
            const pSnap = await pRef.get();
            if (!pSnap.exists) return res.status(404).json({ error: 'not-a-participant' });

            // RESTORING is not the mirror of withdrawing (v21.26). Putting somebody back into a week
            // whose initial deadline has already passed, when they were stood down BEFORE it, makes
            // the app report them as having submitted late to a deadline they were never asked
            // about. The rule and the reasoning live in overtime-core.js; the check is here because
            // only this endpoint has the stored stamp to test.
            if (!withdrawn) {
                const restorable = OT.canRestoreParticipant(
                    storedMilestones(snap.data()), toMillis(pSnap.data().withdrawnAt), nowMs);
                if (!restorable.ok) return res.status(409).json({ error: restorable.error });
            }

            const del = admin.firestore.FieldValue.delete();
            await pRef.update(withdrawn
                ? {
                    withdrawn:   true,
                    withdrawnAt: admin.firestore.FieldValue.serverTimestamp(),
                    withdrawnBy: who.name,
                }
                : { withdrawn: del, withdrawnAt: del, withdrawnBy: del });

            console.log(`[withdrawOvertimeParticipant] ${weekEnding} · ${memberName} · `
                + `${withdrawn ? 'withdrawn' : 'restored'} by ${who.name}`);
            return res.json({ ok: true, weekEnding, memberName, withdrawn, serverNow: nowMs });
        });

    // ── autoCreateOvertimeWindows (scheduled) ───────────────────────────────────────────────────

    /** How a window created by the schedule signs itself, wherever a creator name is shown. */
    const SCHEDULER_NAME = 'Automatic';

    /**
     * Create every horizon week that has no window yet. Daily, 05:00 Europe/London.
     *
     * ── WHY THIS EXISTS, HAVING BEEN DEFERRED ───────────────────────────────────────────────────
     *
     * The original specification deferred automatic creation and said the beta would show whether
     * manual creation was sufficient. The owner settled it earlier: overtime is needed EVERY week,
     * so a window is needed every week, and a person pressing a button fifty-two times a year to
     * approve a computation they cannot influence is not a control — it is a way to forget.
     *
     * The Manager horizon does not go away and is not now redundant. It changes job: it was the
     * safety net under a human, and it becomes the MONITOR over this function. That works because
     * it is computed from the CALENDAR rather than from Firestore, so a week this job failed to
     * create still appears, still says "Not created", and still offers the button. A silent
     * scheduler failure is therefore visible in exactly the place it was always visible.
     *
     * ── DAILY, NOT WEEKLY ───────────────────────────────────────────────────────────────────────
     *
     * A weekly job that misses its run loses a whole week — and the window it should have made may
     * pass its deadline before the next run. Daily is self-healing: any missed day is corrected
     * within twenty-four hours, and because the work is idempotent (deterministic ids, and the
     * `existed` branch above) the other six runs a week cost one collection read each.
     */
    const autoCreateOvertimeWindows = onSchedule(
        { schedule: '0 5 * * *', timeZone: 'Europe/London', region: 'europe-west2',
            ...(VAPID_PRIVATE_KEY ? { secrets: [VAPID_PRIVATE_KEY] } : {}) },
        async () => {
            const nowMs = Date.now();
            let existing;
            try {
                // Ids only — the documents are not needed to know which weeks exist.
                const snap = await db().collection(WINDOWS).select().get();
                existing = snap.docs.map(d => d.id);
            } catch (err) {
                // Do NOT proceed on a failed read. Treating it as "nothing exists" would try to
                // create every horizon week, and while the `existed` branch would refuse each one,
                // relying on a downstream guard to undo a wrong premise is how a bad day becomes a
                // bad week. The horizon still shows anything missed, and tomorrow's run retries.
                console.error('[autoCreateOvertimeWindows] could not list existing windows — standing down:', err);
                return;
            }

            const due = OT.weeksNeedingWindows(nowMs, existing, {
                maxRosterYear: rosterMembers.maxRosterYear,
            });

            // ── THE TOP-UP IS NOT PART OF THE CREATE LOOP, AND MUST NOT RETURN WITH IT ──────────
            //
            // This used to `return` here when nothing was due (v21.20, external review), which is
            // the NORMAL state: the whole six-week horizon is pre-created, so on almost every day
            // there is no window to make. The top-up therefore ran only on the one day a week a new
            // week entered the horizon — and adding a beta tester on any other day left them
            // without a form on every already-open week until then, which is the exact gap this
            // job's own comment says it exists to close.
            //
            // The two halves answer different questions ("does this week exist?" versus "is
            // everybody in it?"), both are idempotent, and both are cheap. So creation is now
            // conditional and the top-up is unconditional.
            const made = [];
            const failed = [];
            /** Everyone newly asked this run — created weeks AND top-up additions — so one member
             *  gets ONE notice however many windows this run put them into. */
            const asked = [];
            for (const weekEnding of due) {
                try {
                    const r = await createWindow(weekEnding, {
                        nowMs, byName: SCHEDULER_NAME, byUid: null,
                    });
                    if (r.asked) asked.push(r.asked);
                    if (r.outcome === 'created') made.push(weekEnding);
                    else if (r.outcome !== 'existed') failed.push(`${weekEnding}:${r.outcome}`);
                } catch (err) {
                    // One bad week must not abandon the rest — they are independent, and the next
                    // week along is often perfectly creatable.
                    failed.push(`${weekEnding}:threw`);
                    console.error(`[autoCreateOvertimeWindows] ${weekEnding} failed:`, err);
                }
            }
            // Say what was NOT done as well as what was. A run that reports only its successes
            // reads as a complete run, which is the same lie a silently-truncated list tells.
            console.log(`[autoCreateOvertimeWindows] due ${due.length} · created ${made.length}`
                + `${made.length ? ` (${made.join(', ')})` : ''}`
                + `${failed.length ? ` · NOT created ${failed.join(', ')}` : ''}`);

            // Then top up every OPEN week to the current audience. This is what makes an audience
            // change take effect at all: the whole horizon is pre-created, so without it
            // an invitation reaches only weeks that do not exist yet. Daily and idempotent — a run
            // with nothing to add costs one id-only read per open week.
            asked.push(...await topUpOpenWindows(nowMs));

            // One accumulated notice per newly-asked member, then the deadline-morning reminder.
            // Both are courtesies over writes that have already committed; neither can throw.
            await notifyAsked(asked);
            await sendInitialDeadlineReminders(nowMs);
        });

    /**
     * Add anybody newly in the audience to every OPEN window. Separate from the create loop so a
     * failure in one cannot abandon the other — they answer different questions.
     * @param {number} nowMs
     */
    async function topUpOpenWindows(nowMs) {
        let snap;
        try {
            snap = await db().collection(WINDOWS).get();
        } catch (err) {
            console.error('[topUpOpenWindows] could not list windows — standing down:', err);
            return [];
        }
        const summary = [];
        /** @type {Array<{ milestones: any, names: string[] }>} who was newly asked, per window */
        const asked = [];
        for (const d of snap.docs) {
            try {
                const added = await addMissingParticipants(d.ref, d.data(), nowMs);
                if (added.length) {
                    summary.push(`${d.id}+${added.length}`);
                    asked.push({ milestones: storedMilestones(d.data()), names: added });
                }
            } catch (err) {
                // One bad week must not abandon the rest; tomorrow's run retries this one.
                console.error(`[topUpOpenWindows] ${d.id} failed:`, err);
            }
        }
        console.log(`[topUpOpenWindows] ${summary.length ? summary.join(', ') : 'nothing to add'}`);
        return asked;
    }

    /**
     * The participant-selection policy currently in force. Server-owned release control, not an
     * operational choice — a Manager sees what will happen and cannot change it.
     *
     * Widening the beta is a one-word edit HERE plus a deploy; existing windows are untouched,
     * because their populations were frozen at creation. A pilot rung slots in as a third value.
     */
    function currentAudience() {
        return 'restricted';
    }

    // ── purgeExpiredOvertimeWindows (scheduled) ─────────────────────────────────────────────────

    /**
     * How many expired windows one run will clear. Not a safety valve — a bound.
     *
     * The backlog is at most one window per week, so a handful per run keeps up with any realistic
     * arrears while keeping a single invocation small enough to finish. Whatever it does not reach
     * is LOGGED rather than silently left: a run that reports only what it did reads as a complete
     * run, which is the same lie a silently truncated list tells.
     */
    const MAX_PURGE_WINDOWS_PER_RUN = 5;

    /**
     * Delete windows past their retention. Daily, 04:00 Europe/London — an hour before the creator,
     * so the two never contend and the day's log reads in the order things happened.
     *
     * ── FIRESTORE DOES NOT CASCADE, WHICH IS THE WHOLE REASON THIS IS NOT ONE LINE ──────────────
     *
     * Deleting a document does NOT delete its subcollections. A window parent removed on its own
     * leaves every participant, submission and revision beneath it — present, billable, and no
     * longer reachable from any collection listing the app performs. That is worse than not purging
     * at all: the data survives while the system reports it as gone.
     *
     * So it descends: revisions → submission heads → participants → the parent, and the parent goes
     * LAST. An interrupted run therefore leaves a window that is still expired, still invisible to
     * both read endpoints, and still selected by tomorrow's run. The only cost of failing halfway
     * is doing it again.
     *
     * Retention itself is enforced in the read endpoints, not here — so nothing anyone sees has
     * ever depended on when this last ran, and arming it changes no behaviour at all.
     */
    const purgeExpiredOvertimeWindows = onSchedule(
        { schedule: '0 4 * * *', timeZone: 'Europe/London', region: 'europe-west2' },
        async () => {
            const nowMs = Date.now();
            let snap;
            try {
                snap = await db().collection(WINDOWS).get();
            } catch (err) {
                console.error('[purgeExpiredOvertimeWindows] could not list windows — standing down:', err);
                return;
            }

            const expired = snap.docs
                .filter(d => toMillis(d.data().retentionUntil) > 0
                    && toMillis(d.data().retentionUntil) <= nowMs)
                .sort((a, b) => (a.id < b.id ? -1 : 1));   // oldest first
            if (!expired.length) {
                console.log(`[purgeExpiredOvertimeWindows] nothing expired${PURGE_ARMED ? '' : ' (dry run)'}`);
                return;
            }
            const take = expired.slice(0, MAX_PURGE_WINDOWS_PER_RUN);
            const left = expired.length - take.length;

            for (const doc of take) {
                try {
                    const counts = await purgeWindow(doc.ref);
                    console.log(`[purgeExpiredOvertimeWindows] ${doc.id}: `
                        + `${counts.revisions} revisions, ${counts.submissions} submissions, `
                        + `${counts.participants} participants, 1 window`
                        + `${PURGE_ARMED ? ' — DELETED' : ' — would delete (dry run)'}`);
                } catch (err) {
                    // One bad week must not abandon the rest, and it must not be reported as done.
                    console.error(`[purgeExpiredOvertimeWindows] ${doc.id} failed:`, err);
                }
            }
            if (left) {
                console.log(`[purgeExpiredOvertimeWindows] ${left} more expired `
                    + `${left === 1 ? 'window' : 'windows'} left for the next run`);
            }
        });

    /**
     * Walk one window bottom-up, counting everything and deleting it only when armed.
     *
     * The counts are returned rather than logged here so the dry run and the armed run report the
     * identical figures from the identical traversal — a separate "estimate" pass would be a second
     * piece of code claiming to describe this one.
     * @param {any} ref the window document
     * @returns {Promise<{revisions:number, submissions:number, participants:number}>}
     */
    async function purgeWindow(ref) {
        const counts = { revisions: 0, submissions: 0, participants: 0 };
        /** @type {any[]} */
        const doomed = [];

        const subs = await ref.collection('submissions').get();
        for (const sub of subs.docs) {
            const revs = await sub.ref.collection('revisions').select().get();
            counts.revisions += revs.size;
            for (const r of revs.docs) doomed.push(r.ref);
        }
        counts.submissions = subs.size;
        for (const sub of subs.docs) doomed.push(sub.ref);

        const parts = await ref.collection('participants').select().get();
        counts.participants = parts.size;
        for (const p of parts.docs) doomed.push(p.ref);

        // The parent goes LAST, and only after every child is queued in front of it. Order is the
        // one property that matters here: reverse it and an interruption orphans the tree.
        doomed.push(ref);

        if (PURGE_ARMED) {
            // Batched, because a per-document delete of a full window is ~100 sequential round
            // trips. Chunked well under the 500-operation cap; a partial commit is harmless, since
            // whatever survives is still expired and still selected tomorrow.
            for (let i = 0; i < doomed.length; i += 400) {
                const batch = db().batch();
                for (const d of doomed.slice(i, i + 400)) batch.delete(d);
                await batch.commit();
            }
        }
        return counts;
    }

    // ── getOvertimeManagerOverview ──────────────────────────────────────────────────────────────

    /**
     * The Manager planning horizon plus the retained window list. Reviewer only.
     *
     * Returns the horizon's week rows computed from the CALENDAR, not from Firestore, then marks which of
     * them have windows. That order is the point: a list built from existing documents can only
     * ever show what exists, and the thing worth seeing is what does not.
     */
    const getOvertimeManagerOverview = onRequest(
        { region: 'europe-west2', timeoutSeconds: 60, cors: ADMIN_FUNCTION_ORIGINS },
        async (req, res) => {
            const who = await authenticate(req, res);
            if (!who) return;
            if (!requireReviewer(who, res)) return;

            const nowMs = Date.now();
            const weekEndings = OT.planningWeekEndings(nowMs);

            const snap = await db().collection(WINDOWS).get();
            /** @type {Map<string, any>} */
            const byWeek = new Map();
            for (const d of snap.docs) byWeek.set(d.id, d.data());

            // Which weeks the LAST scheduled run was due to create. Anything still missing from that
            // list is a run that did not do its job — the one fault this horizon exists to catch and
            // the one it was, until now, actively concealing: a missing week says "opens
            // automatically overnight", and it keeps saying it every day after the overnight that
            // never came. Re-running the scheduler's own decision function at its own last boundary
            // is what makes this an observation rather than a guess, and it needs nothing stored.
            const overdue = new Set(OT.weeksNeedingWindows(
                OT.lastSchedulerRun(nowMs), byWeek.keys(),
                { maxRosterYear: rosterMembers.maxRosterYear }));

            // Counts for every existing week are fetched in PARALLEL. Awaited inside the loop they
            // were six sequential pairs of round trips, which is the difference between a page that
            // opens and a page that hesitates — for data that has no ordering between weeks at all.
            const countsByWeek = new Map(await Promise.all(
                weekEndings.filter(w => byWeek.has(w))
                    .map(async (w) => /** @type {[string, any]} */ ([w, await windowCounts(w)]))));

            const planningWeeks = [];
            for (const weekEnding of weekEndings) {
                const doc = byWeek.get(weekEnding);
                // A row's milestones come from the STORED window when one exists, and only from a
                // fresh derivation when it does not. A created window keeps the timetable it ran
                // under even if the policy has since changed.
                const milestones = doc ? storedMilestones(doc) : OT.deriveMilestones(weekEnding);
                const counts = countsByWeek.get(weekEnding) || null;
                // How many people pressing "Add N" would ACTUALLY add — one number with one
                // meaning, not two for the client to subtract.
                //
                // ── THE OFFER AND THE ACTION MUST COUNT THE SAME POPULATION (v21.15) ────────────
                //
                // This used to send `audienceCount` (the size of the current audience) and let the
                // client subtract `expected`. Those count different things: `expected` is net of
                // withdrawals, and `addMissingParticipants` compares the audience against EVERY
                // participant document, withdrawn included — because a withdrawn member already has
                // one and must not be re-added by a top-up.
                //
                // So the moment a reviewer used "Stop asking" — the entire point of the withdrawal
                // feature — the row began offering "Add 1" for somebody who was already there.
                // Pressing it returned nothing to add, reported "Nobody new to add", re-rendered,
                // and offered "Add 1" again. Permanently, on every load, for as long as the week
                // stayed in INITIAL_OPEN. That is the same never-clearing button v20.81 fixed
                // below, arriving through a different door: the withdrawal feature changed what
                // `expected` MEANS without changing what it was being compared against.
                //
                // Subtracting the raw participant count is exact whenever the audience only grows,
                // which is the case this button exists for. Its one inexactness is somebody who
                // LEAVES the audience while keeping their document, which masks that many genuinely
                // new people from the manual shortcut — bounded, because the nightly job runs
                // `addMissingParticipants` on every open week regardless, so the worst outcome is
                // that the shortcut is unavailable for a night rather than that somebody is never
                // asked. The old behaviour's worst outcome was a control that never worked.
                //
                // ── `INITIAL_OPEN`, NOT `isOpenPhase` — THIS FIGURE IS AN OFFER ─────────────────
                //
                // The horizon row turns a shortfall into an "Add N" button, so the condition here
                // has to be the condition `addMissingParticipants` actually acts on, and v20.81
                // narrowed that to INITIAL_OPEN alone (its header argues why: somebody added during
                // FINAL_OPEN is recorded as a non-responder to a deadline that pre-dates their
                // invitation, then labelled a late submitter). This kept saying `isOpenPhase`, so a
                // FINAL_OPEN week whose audience had grown offered a button that called the
                // endpoint, was refused by the phase check, reported "Nobody new to add" and then
                // rendered itself again unchanged — permanently, since nothing about the week
                // changes until it closes. Exactly one horizon week is in FINAL_OPEN at any moment,
                // so this fired on the first invitation issued after v20.81.
                //
                // A week that cannot grow reports `null`, which the client already reads as "no
                // offer" — the same answer a CLOSED week has always given.
                const canGrow = OT.phaseFor(milestones, nowMs) === 'INITIAL_OPEN';
                const canAdd = doc && canGrow
                    ? Math.max(0, audienceFor(milestones.weekStart).length
                        - (counts ? counts.participantCount : 0))
                    : null;
                planningWeeks.push({
                    ...milestones,
                    exists: !!doc,
                    state: OT.windowRowState(milestones, nowMs, !!doc, overdue.has(weekEnding)),
                    audience: doc ? doc.audience : null,
                    canAdd,
                    canCreate: !doc && OT.validateWeekEnding(weekEnding, {
                        nowMs, maxRosterYear: rosterMembers.maxRosterYear,
                    }).ok,
                    // `participantCount` deliberately does NOT go over the wire. It exists so the
                    // line above can compare like with like, and shipping it would put the raw
                    // population back within reach of a client doing exactly the subtraction that
                    // produced the phantom "Add 1".
                    ...(counts ? { expected: counts.expected, received: counts.received,
                        noResponse: counts.noResponse } : {}),
                });
            }

            // Retained history: every non-expired window, newest first. Expired ones are omitted
            // here rather than left to the purge, so what a Manager sees never depends on when a
            // scheduled job last ran.
            const retained = snap.docs
                .map(d => ({ ...storedMilestones(d.data()), audience: d.data().audience }))
                .filter(w => w.retentionUntil > nowMs)
                .sort((a, b) => (a.weekEnding < b.weekEnding ? 1 : -1));

            return res.json({ ok: true, serverNow: nowMs, planningWeeks, retained });
        });

    /** Expected / received / no-response for a window, DERIVED from the two subcollections. */
    async function windowCounts(weekEnding) {
        const ref = db().collection(WINDOWS).doc(weekEnding);
        // COUNT aggregations, not document reads (v20.75). This function wants two integers and
        // was fetching every document to get them: at the full audience that is ~90 reads per
        // horizon week, ~540 per overview load, for numbers Firestore will compute server-side at
        // one aggregation read each. Same derivation, same source of truth — the participant
        // collection IS the expected population; no stored expectedCount exists anywhere, because
        // a cached copy of a size is a second answer that can disagree with it.
        //
        // The WITHDRAWN are counted separately and subtracted rather than filtered out of the first
        // aggregation, because a `where` clause skips documents that are missing the field
        // entirely — so every participant written before withdrawal existed would vanish from the
        // count and `expected` would read 0 for every current week. Subtracting is right for old
        // and new documents alike, and in the normal case the third aggregation returns 0.
        const [participants, submissions, withdrawn] = await Promise.all([
            ref.collection('participants').count().get(),
            ref.collection('submissions').count().get(),
            ref.collection('participants').where('withdrawn', '==', true).count().get(),
        ]);
        const gone = withdrawn.data().count;
        const expected = participants.data().count - gone;
        // A withdrawn member may already have submitted, and their answer must not keep inflating
        // `received` after they stop being expected — `received > expected` would render as a
        // negative no-response count, which is the shape of a number nobody trusts again. Their ids
        // are read only when there ARE any, so the ordinary week pays nothing for this.
        let received = submissions.data().count;
        if (gone > 0) {
            const goneNames = (await ref.collection('participants')
                .where('withdrawn', '==', true).select().get()).docs.map(d => d.id);
            const subs = await Promise.all(goneNames.map(n =>
                ref.collection('submissions').doc(n).get()));
            received -= subs.filter(d => d.exists).length;
        }
        return {
            expected,
            received,
            noResponse: expected - received,
            // The RAW population — everybody who holds a participant document, withdrawn included.
            // `expected` is deliberately net of withdrawals, so it is the wrong thing to compare an
            // audience size against; see `canAdd` in the horizon loop for what that cost.
            participantCount: participants.data().count,
        };
    }

    // ── getMyOvertimeState ──────────────────────────────────────────────────────────────────────

    /**
     * The member's whole world: server time, and the windows they are actually a participant in.
     *
     * A REVIEWER who is not a participant correctly receives `{ serverNow, windows: [] }`. That is
     * not a bug and must not be "fixed" by treating manager status as participation — managers
     * review, they do not submit. Their data comes from the overview endpoint and Firestore.
     *
     * Participation is resolved by checking the participant path in each unexpired window rather
     * than by a collection-group query. At thirteen weeks of retention plus a short horizon that is
     * a couple of dozen point reads, and it keeps the feature free of a custom index — which in
     * turn keeps the first release free of the deploy-ordering dance an index requires.
     */
    const getMyOvertimeState = onRequest(
        { region: 'europe-west2', timeoutSeconds: 60, cors: ADMIN_FUNCTION_ORIGINS },
        async (req, res) => {
            const who = await authenticate(req, res);
            if (!who) return;

            const nowMs = Date.now();
            const snap = await db().collection(WINDOWS).get();
            const live = snap.docs.filter(d => toMillis(d.data().retentionUntil) > nowMs);

            // Every window is probed in PARALLEL. Sequentially this was up to nineteen round trips
            // (thirteen weeks of retention plus the horizon) before the member saw anything, for
            // reads that have no dependency on each other. Two per window, both issued at once.
            const probed = await Promise.all(live.map(async (d) => {
                const ref = d.ref;
                const [participant, head] = await Promise.all([
                    ref.collection('participants').doc(who.name).get(),
                    ref.collection('submissions').doc(who.name).get(),
                ]);
                // NOT ASKED, OR NO LONGER ASKED — the same answer to the member, and it has to be,
                // or "Stop asking" means one thing to the reviewer and another to the person
                // (v21.20, external review). The reviewer's workspace has excluded the withdrawn
                // from its counts and panels since v20.95 while this line let them keep the form,
                // fill it in and receive "✓ Availability submitted" — two contradictory truths
                // about the same week, which is the failure the rest of this feature is built to
                // avoid.
                //
                // The window DISAPPEARS rather than going read-only. That is a deliberate choice
                // between two defensible ones: a read-only week would preserve sight of what they
                // had already said, but withdrawal means a leaver or a move to Management, so the
                // honest state is that this week is not theirs. `Ask again` restores the document
                // and the window returns with their submission intact — nothing is deleted.
                if (!participant.exists || OT.isWithdrawn(participant.data())) return null;
                const milestones = storedMilestones(d.data());
                return {
                    ...milestones,
                    audience: d.data().audience,
                    phase: OT.phaseFor(milestones, nowMs),
                    participant: {
                        grade:       participant.data().grade,
                        rosterOrder: participant.data().rosterOrder,
                    },
                    submission: head.exists ? publicHead(head.data()) : null,
                };
            }));
            const windows = probed.filter(Boolean);
            windows.sort((a, b) => (a.weekEnding < b.weekEnding ? -1 : 1));
            return res.json({ ok: true, serverNow: nowMs, windows });
        });

    /** The submission head as a member may see it — their own content and nothing about anyone else. */
    function publicHead(data) {
        return {
            currentRevision:   data.currentRevision,
            days:              data.days,
            firstAcceptedAt:   toMillis(data.firstAcceptedAt),
            updatedAt:         toMillis(data.updatedAt),
            lastMutationId:    data.lastMutationId || null,
            schemaVersion:     data.schemaVersion,
        };
    }

    // ── submitOvertimeAvailability ──────────────────────────────────────────────────────────────

    /** Bound on the client-supplied correlation id — opaque to us, but not unbounded. */
    const MUTATION_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

    /** The stored schema version of a submission written today. */
    const SCHEMA_VERSION = 1;

    /**
     * Accept (or knowingly decline) one member's availability for one window.
     *
     * Body: `{ weekEnding, days, ifRevision, clientMutationId }`
     *
     * Everything decided in ONE transaction, because the head and the revision it names must never
     * disagree — a head pointing at a revision that does not exist would make the audit trail a
     * fiction. The decision itself is `decideSubmission` in overtime-core, unit-tested without an
     * emulator; this function only performs it.
     */
    const submitOvertimeAvailability = onRequest(
        { region: 'europe-west2', timeoutSeconds: 60, cors: ADMIN_FUNCTION_ORIGINS },
        async (req, res) => {
            const who = await authenticate(req, res);
            if (!who) return;

            const body = req.body || {};
            const weekEnding = typeof body.weekEnding === 'string' ? body.weekEnding : '';
            const ifRevision = Number.isInteger(body.ifRevision) ? body.ifRevision : -1;
            const mutationId = typeof body.clientMutationId === 'string' ? body.clientMutationId : '';

            if (!OT.isValidIsoDate(weekEnding)) return res.status(400).json({ error: 'invalid-week' });
            if (ifRevision < 0)                  return res.status(400).json({ error: 'missing-if-revision' });
            if (!MUTATION_ID_RE.test(mutationId)) return res.status(400).json({ error: 'invalid-mutation-id' });

            const windowRef = db().collection(WINDOWS).doc(weekEnding);
            const windowSnap = await windowRef.get();
            if (!windowSnap.exists) return res.status(404).json({ error: 'no-window' });

            const milestones = storedMilestones(windowSnap.data());
            const nowMs = Date.now();

            // Retention first: an expired window is gone as far as the application is concerned,
            // whether or not the purge has reached it.
            if (milestones.retentionUntil <= nowMs) return res.status(404).json({ error: 'no-window' });

            // SERVER time decides, and it decides here — not from anything the client sent, and not
            // from the phase the client believed it was in when it rendered the form.
            const phase = OT.phaseFor(milestones, nowMs);
            if (!OT.isOpenPhase(phase)) {
                return res.status(409).json({ error: 'closed', phase, serverNow: nowMs });
            }

            const participantRef = windowRef.collection('participants').doc(who.name);
            const participant = await participantRef.get();
            // Participation is the authorisation. A member who was not asked cannot submit, and
            // neither can an admin on somebody else's behalf: the only name in play is the token's.
            if (!participant.exists) return res.status(403).json({ error: 'not-a-participant' });
            // A SEPARATE code from `not-a-participant`, because they are different situations and
            // the member's form says different things about them: one was never asked, the other
            // was and has been stood down. Refusing here is the half that matters — hiding the
            // window above is a courtesy, and a client that still holds the page (opened before the
            // withdrawal, or restored from the back/forward cache) must not be able to write.
            if (OT.isWithdrawn(participant.data())) return res.status(403).json({ error: 'withdrawn' });

            const normalised = OT.normaliseDays(body.days, OT.weekDates(milestones.weekStart));
            if (!normalised.ok) {
                return res.status(400).json({ error: normalised.error, date: normalised.date || null });
            }

            const headRef = windowRef.collection('submissions').doc(who.name);
            let outcome;
            try {
                outcome = await db().runTransaction(async (tx) => {
                    const headSnap = await tx.get(headRef);
                    const head = headSnap.exists
                        ? { currentRevision: headSnap.data().currentRevision, days: headSnap.data().days }
                        : null;
                    const decision = OT.decideSubmission(head, normalised.days, ifRevision);

                    if (decision.action === 'conflict') {
                        return {
                            conflict: true,
                            currentRevision: decision.expected,
                            days: head ? head.days : null,
                            updatedAt: headSnap.exists ? toMillis(headSnap.data().updatedAt) : 0,
                            // The client compares this against the mutation id of its own timed-out
                            // attempt. When they match, the "newer version" it is being warned about
                            // is its own earlier, successful submission — a completely different
                            // message from "somebody else changed this".
                            lastMutationId: headSnap.exists ? (headSnap.data().lastMutationId || null) : null,
                        };
                    }

                    if (decision.action === 'noop') {
                        // The ordinary duplicate click, and the retry after a timeout. Content is
                        // already authoritative, so no revision is created and `updatedAt` — which
                        // means "when the content last changed" — is left alone. But the mutation id
                        // IS recorded: without it a client whose retry response was ALSO lost could
                        // never confirm a submission that is saved and correct.
                        tx.update(headRef, {
                            lastMutationId:    mutationId,
                            lastMutationSeenAt: admin.firestore.FieldValue.serverTimestamp(),
                        });
                        return { revision: decision.revision, noop: true };
                    }

                    const revision = decision.revision;
                    const acceptedAt = admin.firestore.FieldValue.serverTimestamp();
                    tx.set(headRef.collection('revisions').doc(OT.revisionId(revision)), {
                        weekEnding,
                        memberName: who.name,
                        uid:        who.uid,
                        revision,
                        days:       normalised.days,
                        acceptedAt,
                        mutationId,
                        schemaVersion: SCHEMA_VERSION,
                    });
                    const headWrite = {
                        memberName:      who.name,
                        uid:             who.uid,
                        currentRevision: revision,
                        days:            normalised.days,
                        updatedAt:       acceptedAt,
                        lastMutationId:  mutationId,
                        lastMutationSeenAt: acceptedAt,
                        schemaVersion:   SCHEMA_VERSION,
                    };
                    if (decision.action === 'create') headWrite.firstAcceptedAt = acceptedAt;
                    tx.set(headRef, headWrite, { merge: true });
                    return { revision, created: decision.action === 'create' };
                });
            } catch (err) {
                console.error(`[submitOvertimeAvailability] transaction failed for ${who.name} ${weekEnding}:`, err);
                return res.status(500).json({ error: 'write-failed' });
            }

            if (outcome.conflict) {
                return res.status(409).json({
                    error: 'revision-conflict',
                    currentRevision: outcome.currentRevision,
                    days:            outcome.days,
                    updatedAt:       outcome.updatedAt,
                    lastMutationId:  outcome.lastMutationId,
                    serverNow:       nowMs,
                });
            }
            // Stamp the participant's uid on first contact. It is the recovery route if a member is
            // ever renamed, since the documents are name-keyed — see OVERTIME_AVAILABILITY.md.
            if (!participant.data().uid) {
                await participantRef.update({ uid: who.uid }).catch(() => { /* best effort */ });
            }
            return res.json({
                ok: true,
                revision:  outcome.revision,
                noop:      !!outcome.noop,
                created:   !!outcome.created,
                phase,
                serverNow: nowMs,
            });
        });

    return {
        createOvertimeWindow,
        autoCreateOvertimeWindows,
        getOvertimeManagerOverview,
        getMyOvertimeState,
        submitOvertimeAvailability,
        withdrawOvertimeParticipant,
        purgeExpiredOvertimeWindows,
    };
}

module.exports = { buildOvertimeEndpoints };
