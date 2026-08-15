# ARCHITECTURE.md — the index

*Created August 2026 (at v21.38), external review. Not version-stamped; not a runtime asset.*

**Read this first, and read nothing else until you know which document you need.** This file holds no
design and no history. It answers three questions and stops:

1. Which document is **authoritative** for the thing I am about to change?
2. What is **actually deployed** right now, where that differs from what the documents describe?
3. What do the status words in those documents **mean**?

If you are looking for how something works, this file has failed unless it has already sent you
somewhere else.

---

## 1 · Where authority lives

One subject, one authoritative document. Everything else about that subject **links here, or links to
the owner** — it does not restate it. That rule is the whole reason this file exists: every
documentation defect this repo has recorded is the same shape, a fact written down twice and then
changed once.

| Subject | Authority | What it owns |
|---|---|---|
| **Repository conventions** | `CLAUDE.md` | Version bumping, the file tree, architecture decisions, wording conventions, change impact |
| **Module routing** | `AI_MAP.md` | What every module is and what it exports |
| **Authentication & sessions** | `AUTH_AND_SESSIONS.md` | Session ↔ identity ↔ claim, and the invariants across them |
| **Calendar truth** | `CALENDAR_DATA.md` | What may be shown, and when — knowledge states, the access gate |
| **Overtime availability** | `OVERTIME_AVAILABILITY.md` | Participants, deadlines, revisions, retention, audience |
| **Pay calculator** | `.claude/rules/paycalc.md` | Rates, payroll rules, state, layout |
| **Links designer** | `.claude/rules/links-design.md` | Grid, generator, coverage, fatigue, concurrency |
| **Guide pages** | `.claude/rules/guide-pages.md` | The five guides' shell, design principles, factual standards |
| **CSS tokens & surfaces** | `.claude/rules/css-tokens.md` | Colour, type, spacing, focus, overlays |
| **Notifications** | `.claude/rules/notifications.md` | Push payload grammar and the single builder |
| **Roster data shape** | `.claude/rules/roster-data.md` | Member fields, cycles, entitlement |
| **Operations & ingest** | `OPERATIONS_REFERENCE.md` | Huddle ingest, roster upload, account conventions, PIN rotation |
| **Disaster recovery** | `RECOVERY_RUNBOOK.md` | Backups, rollback, incident playbooks, standing GCP prerequisites |

### The registers — three questions, three files

| Register | Question | ID space |
|---|---|---|
| `VALIDATION_REGISTER.md` | What does the app **already assert** on evidence nobody has checked? | `VAL-*` |
| `MAINTENANCE_CALENDAR.md` | What must happen **by a date**, whether or not anyone plans it? | — (dated rows) |
| `ROADMAP.md` | What might we **build**? | — |
| `GUIDE_SOURCES.md` | The same discipline as `VALIDATION_REGISTER`, applied to the guides' claims | per-row ids |
| **§3 below** | Where does **deployed** differ from **documented target**? | `EXC-*` |

`VAL-*` and `EXC-*` are deliberately **separate ID spaces**, because they are separate questions.
A `VAL` row is *built, and the assumption under it is unproven*. An `EXC` row is *built, proven, and
deliberately not switched on yet*. Collapsing them into one register would lose exactly the
distinction §4 exists to sharpen.

### Plans, and why none of them are archived

Plans describe how something was built. Once it is built the contract above outranks the plan — but
in this repo **the plans are cited from code**, by name and by phase number, so moving them breaks
live anchors:

| Plan | State | Why it stays where it is |
|---|---|---|
| `SECURITY_RELEASE_PLAN.md` | **Live** | Carries the canonical track-status table for every security track |
| `AUTH_PLAN.md` | **Live** (Track E undecided) | Owns the design; status lives in the plan above |
| `PASSWORD_PLAN.md` | **Live** (C2, C5 pending) | Same split |
| `ARCHITECTURE_PLAN.md` | Track 1 complete | Code comments cite it by phase number |
| `OTHER_PLAN.md` | Shipped | Code comments cite "OTHER_PLAN.md decision N" |
| `LOGIN_INCIDENT.md` | Resolved | `CLAUDE.md` sends you here before touching login |
| `LATENCY_PLAN.md` | Phase 1 shipped | Holds the decision rule for phases 2–3 |
| `LINKS_DEC2026_PLAN.md` | Live | Holds the links modules' release history |
| `RANGERS_ROVERS_PLAN.md` | Shipped, 2 open claims | The open claims are `VAL` rows |
| `ROADMAP_HISTORY.md` | Historical | **The archive.** Everything `ROADMAP.md` used to say about the past |
| `A11Y_FINDINGS.md` | Live baseline | The axe triage the gate is measured against |

**So the archive already exists and is called `ROADMAP_HISTORY.md`.** If a plan above genuinely dies,
move its content there — do not create a second archive.

---

## 2 · What depends on what

```
                    roster-data.js  ── the roster, the config flags, APP_VERSION
                          │
      ┌───────────────────┼───────────────────┬──────────────────┐
      │                   │                   │                  │
  session.js         override-utils.js   firebase-client.js   ls.js
  auth-state.js      (effective shift)   (db + every helper)
  auth-policy.js           │                   │
      │                    │                   │
      └──────────┬─────────┴─────────┬─────────┘
                 │                   │
        the six protected pages   the Calendar
        admin · operations ·      index.html
        settings · paycalc ·      (+ its access gate)
        links · overtime
```

Three edits reach further than they look, and each has a row in `CLAUDE.md` → *Change impact*:
`resolveEffectiveShift` (every surface that shows a shift), the three auth modules (all six protected
pages at once), and `firestore.rules` (client and server together).

---

## 3 · Current production exceptions

**Deployed behaviour that differs from the target the documents describe.** Every row is verified
against source, carries a closure condition, and is `TEMPORARY` by definition — a row with no route to
closure is not an exception, it is the design, and belongs in a contract instead.

**When this table is empty, the documented architecture and the deployed architecture have
converged.** That is the only thing it is for.

| ID | Exception | Where | Closes when |
|---|---|---|---|
| **EXC-001** | **`overrides` is still publicly readable.** The `name`-claim rule is written, tested and deployed — but an `allow read;` line sits above it and Firestore permissions are additive, so the permissive line wins. The client-side gate shipped first deliberately, so a rules tightening cannot strand a device mid-rollout. | `firestore.rules` → `overrides` | The PIN has had a real soak and the hold line is deleted in its own push — `RECOVERY_RUNBOOK.md` → "The Calendar PIN" step 4 |
| **EXC-002** | **The Overtime retention purge is disarmed.** It runs daily, walks every expired window and logs what it would delete. It deletes nothing. Expired data therefore persists, contrary to what the retention design says happens to it. | `functions/index.js` (`purgeArmed: false`) | One logged run is read after **21 Nov 2026** — `MAINTENANCE_CALENDAR.md`, and `VAL-OT-001` |
| **EXC-003** | **Overtime is a restricted beta.** Reviewing is open to admin/manager; participating is limited to a named list. The audience ladder is server-owned, so widening it is a one-word edit plus `npm run generate:roster-members`. | `CONFIG.OVERTIME_BETA` · `functions/roster-members.json` | Full launch — both lists drop away and participation alone decides |
| **EXC-004** | **The Links bin never empties.** Soft-deleted designs are hidden and restorable; automatic expiry was suspended at v19.86 because no client-side age check survives a fast device clock. The retention constant is dormant and no surface promises a countdown. | `links-deletion.js` (`SOFT_DELETE_RETENTION_DAYS`) | A server-side purge is built, or the bin is accepted as permanent — `KNOWN_LIMITATIONS.md` |
| **EXC-005** | **The surname default is still a valid password.** Members who have set their own have a real secret; everyone else can still sign in with their surname, and an admin reset returns an account to it. | `auth-identity.js` (`credentialCandidatesFor`) | Track C5 — gated on ≥90% migrated **and** on Track E. Irreversible |
| **EXC-006** | **Two origins serve the app.** `myb-roster.web.app` is canonical and is the notification target; the GitHub Pages mirror stays alive for staff who installed from it. The per-address counters exist to measure exactly this. | `firebase.json` · Pages settings | The mirror is retired — watch `analytics/origins` |

---

## 4 · Status vocabulary

Four words, used consistently across every document. Anything else — *held*, *pending*, *open*,
*later*, *future* — should be read as an invitation to work out which of these four it is, and to
correct it.

| Label | Means | Where it lives |
|---|---|---|
| **CURRENT** | How the app works today. The default: an unlabelled statement in a contract is CURRENT. | Contracts |
| **TEMPORARY** | Deliberately transitional. Built, proven, not switched on — or switched on ahead of the thing that will replace it. | §3 above, as an `EXC-*` row |
| **VALIDATION** | Built and shipped, but a real-world assumption under it has never been checked. The app is already telling staff something on this evidence. | `VALIDATION_REGISTER.md`, as a `VAL-*` row |
| **DEFERRED** | Deliberately not built. A decision, not a backlog item. | `ROADMAP.md` · a contract's "Deliberately not built" section |

**The distinction that matters most is TEMPORARY vs VALIDATION**, because they fail in opposite
directions. A TEMPORARY is a known gap between deployed and intended — the risk is that a reader
believes the intended state is live. A VALIDATION is a state everyone believes is correct — the risk
is that it is quietly wrong and nothing will say so. Neither is a to-do item, and putting either in
`ROADMAP.md` is how the back-pay row spent months filed between two features.

---

## 5 · The shape a feature contract should take

`CALENDAR_DATA.md` and `AUTH_AND_SESSIONS.md` are the reference shape. In order:

1. **Authority header** — this document is authoritative for X; link here rather than restating.
2. **Invariants** — numbered, each routing to the module header that argues it.
3. **Architecture** — the states, and what each is for.
4. **Security / data ownership** — who may read and write what.
5. **Known temporary exceptions** — pointing at an `EXC-*` row, never re-explaining it.
6. **Operational lifecycle** — how it is run, deployed, retained.
7. **Deliberately not built** — the DEFERRED list.
8. **Links to the registers** — the `VAL-*` rows that touch this feature.

**No implementation diary, and no superseded behaviour, in the same document.** A contract that
records what something used to do is a contract a reader can follow into the past — and they will,
because the stale passage is usually the one nearest the end. Release history belongs in git; the
reasoning behind a rule belongs in the module header beside the code.

**Record the trap, not just the rule.** Where something exists because of a non-obvious failure, one
sentence naming the mechanism is worth more than paragraphs of description, because it is what stops
a future cleanup undoing it. The model:

> `setPersistence` migrates the *currently authenticated user* between stores — so a restored Calendar
> viewer must be signed out **before** the member chain runs, or it lands in IndexedDB and survives
> the browser closing.

That sentence is why the fix cannot be tidied away. "Sign out first" alone is not.
