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
 *   submitOvertimeAvailability  the only mutation. Transactional, revision-aware, idempotent.
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
const admin = require('firebase-admin');
const OT = require('./overtime-core');

/** Collection root. One name, used everywhere, so a typo cannot create a parallel universe. */
const WINDOWS = 'overtimeWindows';

/**
 * Build the Overtime endpoints. Called once from index.js with the shared infra.
 * @param {object} deps
 * @param {string[]} deps.ADMIN_FUNCTION_ORIGINS  CORS allowlist (defence in depth; the real control
 *   is the ID token + claim check inside each handler)
 * @param {{ overtimeEligibleMembers: Array<object>, maxRosterYear: number, roles: { admin: string[] } }} deps.rosterMembers
 *   the GENERATED server roster — never a client payload
 */
function buildOvertimeEndpoints({ ADMIN_FUNCTION_ORIGINS, rosterMembers }) {

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
        { region: 'europe-west2', timeoutSeconds: 60, cors: ADMIN_FUNCTION_ORIGINS },
        async (req, res) => {
            const who = await authenticate(req, res);
            if (!who) return;
            if (!requireReviewer(who, res)) return;

            const body = req.body || {};
            const weekEnding = typeof body.weekEnding === 'string' ? body.weekEnding : '';
            const dryRun = body.dryRun === true;

            const nowMs = Date.now();
            const check = OT.validateWeekEnding(weekEnding, {
                nowMs, maxRosterYear: rosterMembers.maxRosterYear,
            });
            if (!check.ok) return res.status(400).json({ error: check.error });

            const milestones = OT.deriveMilestones(weekEnding);
            const audience = currentAudience();
            const participants = OT.selectParticipants(rosterMembers.overtimeEligibleMembers, {
                weekStart: milestones.weekStart,
                audience,
                adminNames: (rosterMembers.roles && rosterMembers.roles.admin) || [],
            });

            if (participants.length > OT.MAX_PARTICIPANTS_PER_WINDOW) {
                // Fail loudly rather than splitting the batch. A window created across two batches
                // can half-exist, and a half-frozen participant population is not a smaller truth —
                // it is a false one, which then reports colleagues as non-responders forever.
                console.error(`[createOvertimeWindow] ${participants.length} participants exceeds the single-batch bound`);
                return res.status(507).json({ error: 'too-many-participants' });
            }

            const preview = {
                ...milestones,
                initialDeadlineAt: milestones.initialDeadlineAt,
                finalDeadlineAt:   milestones.finalDeadlineAt,
                retentionUntil:    milestones.retentionUntil,
                audience,
                participants: participants.map(p => ({ memberName: p.memberName, grade: p.grade })),
                expectedCount: participants.length,
            };
            if (dryRun) return res.json({ ok: true, dryRun: true, window: preview });

            const ref = db().collection(WINDOWS).doc(weekEnding);
            const existing = await ref.get();
            if (existing.exists) {
                // Two reviewers pressing Create at once, or one pressing it twice. The deterministic
                // id already makes a duplicate impossible; this makes the SECOND caller's experience
                // "here is the window" rather than an error — and, critically, never rewrites the
                // frozen participant snapshot that the first caller established.
                return res.json({ ok: true, existed: true, window: { ...storedMilestones(existing.data()), audience: existing.data().audience } });
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
                createdByName:     who.name,
                createdByUid:      who.uid,
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
            console.log(`[createOvertimeWindow] ${weekEnding} · ${audience} · ${participants.length} participants · by ${who.name}`);
            return res.json({ ok: true, created: true, window: preview });
        });

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

    // ── getOvertimeManagerOverview ──────────────────────────────────────────────────────────────

    /**
     * The Manager planning horizon plus the retained window list. Reviewer only.
     *
     * Returns six week rows computed from the CALENDAR, not from Firestore, then marks which of
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

            const planningWeeks = [];
            for (const weekEnding of weekEndings) {
                const doc = byWeek.get(weekEnding);
                // A row's milestones come from the STORED window when one exists, and only from a
                // fresh derivation when it does not. A created window keeps the timetable it ran
                // under even if the policy has since changed.
                const milestones = doc ? storedMilestones(doc) : OT.deriveMilestones(weekEnding);
                const counts = doc ? await windowCounts(weekEnding) : null;
                planningWeeks.push({
                    ...milestones,
                    exists: !!doc,
                    state: OT.windowRowState(milestones, nowMs, !!doc),
                    audience: doc ? doc.audience : null,
                    canCreate: !doc && OT.validateWeekEnding(weekEnding, {
                        nowMs, maxRosterYear: rosterMembers.maxRosterYear,
                    }).ok,
                    ...(counts || {}),
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
        const [participants, submissions] = await Promise.all([
            ref.collection('participants').get(),
            ref.collection('submissions').get(),
        ]);
        // No stored expectedCount anywhere: the participant collection IS the expected population,
        // and a cached copy of its size is a second answer that can disagree with it.
        return {
            expected:   participants.size,
            received:   submissions.size,
            noResponse: participants.size - submissions.size,
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

            const windows = [];
            for (const d of live) {
                const ref = d.ref;
                const participant = await ref.collection('participants').doc(who.name).get();
                if (!participant.exists) continue;          // not asked → not their window
                const head = await ref.collection('submissions').doc(who.name).get();
                const milestones = storedMilestones(d.data());
                windows.push({
                    ...milestones,
                    audience: d.data().audience,
                    phase: OT.phaseFor(milestones, nowMs),
                    participant: {
                        grade:       participant.data().grade,
                        rosterOrder: participant.data().rosterOrder,
                    },
                    submission: head.exists ? publicHead(head.data()) : null,
                });
            }
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
        getOvertimeManagerOverview,
        getMyOvertimeState,
        submitOvertimeAvailability,
    };
}

module.exports = { buildOvertimeEndpoints };
