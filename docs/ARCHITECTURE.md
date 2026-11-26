# ARCHITECTURE.md — the index

*Not version-stamped; not a runtime asset.*

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
| **Arriving from outside** | `README.md` | What the app is, and which checks run with nothing installed — the front door, not a summary of this table |
| **Repository conventions** | `CLAUDE.md` | Version bumping, architecture decisions, wording conventions, change impact |
| **Module routing** | `AI_MAP.md` | What every module exports, and which file a task needs (what a module IS: `FILE_INDEX.md`) |
| **File routing** | `FILE_INDEX.md` | What every FILE is, one line each — the catalogue `CLAUDE.md` points to rather than carries |
| **Authentication & sessions** | `AUTH_AND_SESSIONS.md` | Session ↔ identity ↔ claim, the invariants across them, the client's auth architecture (the two pure layers, degraded state, reads vs writes), and the shipped design decisions behind the sign-in, the passwords, the claim tiers and the read closure |
| **Security work still to do** | `SECURITY_RELEASE_PLAN.md` | The canonical status of every security track, and the design and ORDER of the work not yet built — recovery codes, step-up, email recovery, App Check, the rest of Track E. Holds the one open decision about what retiring the surname should MEAN |
| **Calendar truth** | `CALENDAR_DATA.md` | What may be shown, and when — knowledge states, the access gate |
| **Overtime availability** | `OVERTIME_AVAILABILITY.md` | Participants, deadlines, revisions, retention, audience |
| **Pay calculator** | `.claude/rules/paycalc.md` · `PAYCALC_REFERENCE.md` | The rules file: the invariants, the payroll and design decisions, the payslip line names. The reference: the pay figures (their one home), the payroll mechanics, state, layout |
| **Links designer** | `.claude/rules/links-design.md` · `LINKS_REFERENCE.md` | The rules file: the invariants and the decisions. The reference: grid, generator, coverage, fatigue, concurrency in full |
| **Guide pages** | `.claude/rules/guide-pages.md` | The guides' shell, design principles, factual standards |
| **Firestore collections** | `docs/DATA_MODEL.md` | What every collection holds and what its fields mean. Access is summarised there and OWNED by `firestore.rules` |
| **CSS tokens & surfaces** | `.claude/rules/css-tokens.md` | Colour, type, spacing, focus, overlays |
| **Notifications** | `.claude/rules/notifications.md` | Push payload grammar and the single builder |
| **Roster data shape** | `.claude/rules/roster-data.md` | Member fields, `rosterChanges`, cycles (the AL entitlement rules stay in `CLAUDE.md`, because Admin, the Calendar and the Pay Calculator all read them) |
| **Calendar page** | `.claude/rules/calendar.md` | The Calendar's own area decisions: the month grid, the day panel, Team view, the sync chip |
| **Admin page** | `.claude/rules/admin.md` | Change a Shift, the type pills, leave on a rest day, the range picker |
| **Drawer, page chrome & overlays** | `.claude/rules/nav-drawer.md` | The nav drawer, the page header and logo, Android Back and the topmost-overlay rule |
| **Offline-first shell** | `.claude/rules/pwa.md` | The service worker's caching and update lifecycle, the manifest, Firestore's local cache |
| **Sign-in mechanics** | `.claude/rules/sessions.md` | Session re-establishment, write isolation and the claim tiers — the code side of `AUTH_AND_SESSIONS.md`'s invariants |
| **Roster PDF import** | `.claude/rules/roster-import.md` | The parse, the review states, and every defence against a week written onto the wrong days — the day-drift layers and why they are not three witnesses, the geometry gate, what a blank cell means |
| **Operations & ingest** | `OPERATIONS_REFERENCE.md` | Huddle ingest, roster upload, account conventions, the retired staff PIN's last steps |
| **Disaster recovery** | `RECOVERY_RUNBOOK.md` | Backups, rollback, incident playbooks, standing GCP prerequisites |
| **Running the app (the owner)** | `OWNER_GUIDE.md` | The plain-English routine: after a release, when a colleague reports a problem, the weekly, monthly and dated jobs, the owner-only tasks, and where each answer lives |
| **The depot AL workbook** | `AL_WORKBOOK.md` | The roster clerks' annual-leave quota spreadsheet — what its sheets are, how a person's figure is built, and where it and the app legitimately disagree. Not an app subject: an EXTERNAL source the owner reconciles against |

### The registers — one question each

| Register | Question | ID space |
|---|---|---|
| `VALIDATION_REGISTER.md` | What does the app **already assert** on evidence nobody has checked? | `VAL-*` |
| `MAINTENANCE_CALENDAR.md` | What must happen **by a date**, whether or not anyone plans it? | — (dated rows) |
| `ROADMAP.md` | What might we **build**? | — |
| `GUIDE_SOURCES.md` | The same discipline as `VALIDATION_REGISTER`, applied to the guides' claims | per-row ids |
| `KNOWN_LIMITATIONS.md` | What is **true of the app and not going to change soon** — accepted constraints, platform facts, deferred fixes, and the things a reader will otherwise re-discover | — |
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
| `SECURITY_RELEASE_PLAN.md` | **Live** (C2, C5 pending; C6, F and D proposed; Track E undecided) | The canonical track-status table, and ONLY the open work: what ships moves to `AUTH_AND_SESSIONS.md`. The admin reset is INTERIM — superseded in design by C6. **C5's second route is an OPEN owner decision** and must not be actioned as though it were settled. Absorbed `AUTH_PLAN.md`, `PASSWORD_DESIGN.md` and `CREDENTIAL_LIFECYCLE.md` (26 Nov 2026; the shipped design went to `AUTH_AND_SESSIONS.md`) |
| `OTHER_DAYS.md` | Shipped | Code comments cite "OTHER_DAYS.md decision N" |
| `LATENCY.md` | **CLOSED 19 Sep 2026 — nothing open.** The wall is the `accounts:lookup` round trip. The fast path built against it rarely fired, and was retired on 26 Sep 2026 and replaced by the own-roster copy (`CALENDAR_DATA.md` 17); Phase 2 closed on its own rule; Phase 3 measured and declined; Phase 4's trigger unfired. The App Speed card that carried its instruments was trimmed on 25 Oct 2026 | Holds the readings, the decision rules, and THE CLOSING READ of 19 Sep 2026 |
| `BRASS_PLAN.md` | **Gated on owner answers** | The Part 2 payslip questions decide the design; nothing ships before them |
| `DECISIONS.md` | Historical | **The closed decisions.** Features declined, and choices recorded so they are not re-argued |
| `A11Y_BASELINE.md` | Live baseline | The axe triage the gate is measured against |
| `ANDROID_RELEASE_CHECKLIST.md` | Release pass | The Android checks no test here can run — run by hand: a Chrome tab, the installed app, Samsung Internet, the largest text |
| `IPHONE_RELEASE_CHECKLIST.md` | Release pass | The iOS checks no test here can run — run by hand, on four real devices |

**There is no archive document, and there should not be one: git is the archive.** If a plan above
genuinely dies, move each decision in it that still binds to `DECISIONS.md` or the area rule file it
binds, then delete the plan, naming the last commit that held it. `ROADMAP_HISTORY.md`, the archive
this repo kept until 25 Nov 2026, went that way: its last text is `git show 28b217d0:docs/ROADMAP_HISTORY.md`.
So did `LINKS_DEC2026_PLAN.md` and `AL_UPLOADER_PLAN.md` on 26 Nov 2026, their work shipped: their decisions
are `DECISIONS.md` → "The new CEA link" and "The annual leave uploader", what is open is `ROADMAP.md`, and
their last text is `git show 16386f9b:docs/<name>`.

---

## 2 · What depends on what

```
                    roster-data.js  ── the roster, the config flags, APP_VERSION
                          │
      ┌───────────────────┼───────────────────┬──────────────────┐
      │                   │                   │                  │
  session.js         override-utils.js   firebase-client.js   ls.js
  login-overlay.js   (effective shift)   (db + every helper)
  auth-policy.js           │                   │
      │                    │                   │
      └──────────┬─────────┴─────────┬─────────┘
                 │                   │
        the eight sign-in pages   the Calendar
        admin · operations ·      index.html
        settings · paycalc ·      (+ its access gate)
        links · overtime ·
        trains · newlink
```

A reading map, not the import graph — `ls.js` imports nothing, `override-utils.js` imports only two
leaf modules (`clock-input.js`, `leave-year.js`), and `roster-data.js` itself imports `override-utils.js`.

Three edits reach further than they look, and each has a row in `CLAUDE.md` → *Change impact*:
`resolveEffectiveShift` (every surface that shows a shift), the auth modules (all eight sign-in
pages at once, and the Calendar), and `firestore.rules` (client and server together).

---

## 3 · Current production exceptions

**Deployed behaviour that differs from the target the documents describe.** Every row is verified
against source, carries a closure condition, and is `TEMPORARY` by definition — a row with no route to
closure is not an exception, it is the design, and belongs in a contract instead.

**When this table is empty, the documented architecture and the deployed architecture have
converged.** That is the only thing it is for.

**A closed row is DELETED, not struck through** — and its ID goes with it, since every citation
elsewhere must resolve to a live row (`doc-parity.test.mjs`). A closed row's history is in the commit
log. A table that keeps its dead rows stops answering the one question it exists for, which is what
is true right now.

| ID | Exception | Where | Closes when |
|---|---|---|---|
| **EXC-003** | **Overtime is paused** (owner, Nov 2026). Built, proven and switched off: no pill for anyone, the admin included; the page says it is paused; only the retention purge is deployed, so no week is made and nobody is asked. It returns as the restricted beta it was — reviewing for admin/manager, participating for the admin plus `CONFIG.OVERTIME_BETA` (currently empty). | `CONFIG.OVERTIME_ENABLED` · `functions/roster-members.json` (`overtimeEnabled`) · `functions/index.js` | The owner switches it back on (`OVERTIME_AVAILABILITY.md` → Paused) — then the beta's own closure, full launch, applies |
| **EXC-005** | **The surname default is still a valid password.** Members who have set their own have a real secret; everyone else can still sign in with their surname, and an admin reset returns an account to it. | `auth-identity.js` (`credentialCandidatesFor`) | Track C5 — gated on ≥90% migrated **and** on Track E. Irreversible |
| **EXC-006** | **Two origins serve the app.** `myb-roster.web.app` is canonical and is the notification target; the GitHub Pages mirror is still where the MAJORITY of staff open it (owner, Sep 2026 — a gradual changeover, not a rump). It serves **no redirects and no HTTP headers**, so anything relying on either reaches the smaller half: the `<meta>` CSP and the `guide.html`/`fip.html` redirect stubs both exist for that reason. The per-address counters measure the changeover. | `firebase.json` · Pages settings | The mirror is retired — watch `analytics/origins` |
| **EXC-007** | **Document bearer URLs already in circulation stay live.** The Huddle, Circular and Newsletter are behind a sign-in in the app, and their Firestore reads are closed; but each file is stored with a permanent tokenised Storage URL that bypasses rules, so anyone who obtained one before (browser history, a forwarded link, Microsoft's Office viewer cache) can still open that file. New readers cannot discover a URL; old holders keep theirs. | `storage.rules` header · AUTH_AND_SESSIONS.md → "The document files (E6)" | **The existing objects are rotated.** The Office viewer STAYS — the owner refused both routes that would have removed it (AUTH_AND_SESSIONS.md → "The document files (E6)", DECIDED 19 Sep 2026), so the closure condition is that the URL handed to that viewer is short-lived, not that `.docx` delivery is replaced. The short-lived URL is built on both sides: `getDocumentUrl`, which the nav drawer, `calendar-doc-viewer.js` and `calendar-huddle-viewer.js` all call, falling back to the stored URL only if the server refuses. **Two things keep this row open.** Rotation — the only step that reaches an object already orphaned by a partial prune — is BUILT (Operations → Document links, `rotateDocumentLinks`, 12 Nov 2026) and has not yet been RUN; and the stored permanent link stays as the FALLBACK when a short-lived one cannot be fetched (owner, 7 Oct 2026 — DECISIONS.md), so a reader offline or meeting a 503 is still handed a link that does not expire |
| **EXC-009** | **The retired staff PIN's account and its teardown are still deployed.** No screen asks for the PIN since the client release of 23 Nov 2026, and since the server release the PIN opens nothing at all: `unlockCalendarViewer` is deleted, and the rules and `getDocumentUrl` grant the `calendarViewer` claim nothing. What remains is the shared `calendar-viewer` account (a session left open on it is refused everywhere, but lives until the account goes), its `CALENDAR_VIEWER_PIN` secret and `viewerAttempts` store, the server's refusal to adopt that account, and the client code that signs a leftover PIN session out. | the Auth account `calendar-viewer` · `functions/retired-viewer-account.js` · `viewer-shed.js` | **The owner's manual steps are done** (OPERATIONS_REFERENCE.md → "The staff PIN (retired)" → "After the server release") — then the cleanup release removes the transition code and the account guard, and this row is deleted. DECISIONS.md → "The staff PIN retired" |
| **EXC-008** | **`main` requires no checks before a merge.** A pull request can merge with its CI red, or before its CI has finished. Each deploy runs its own tests before it releases anything, and since 10 November 2026 the Pages mirror is published only after a passing Hosting run (`deploy-mirror.yml`). What a merge can still skip is what only the pull request's CI checks, the version bump and the WebKit lane among them; a missed bump leaves every device on its cached files. | GitHub → Settings → Rules | The owner requires the core CI checks on `main` (OPERATIONS_REFERENCE.md → "The Pages mirror", step 1) |

---

## 4 · Status vocabulary

Four words, used consistently across every document. Anything else — *held*, *pending*, *open*,
*later*, *future* — should be read as an invitation to work out which of these four it is, and to
correct it.

**One field keeps a key of its own: a `ROADMAP.md` entry's Status.** These four say how the *app*
stands; that field says where a *plan* stands, in the roadmap's own key (`ROADMAP.md` → How to read
an entry), and `doc-parity.test.mjs` holds every entry to it. A word outside that key is the same
invitation, answered from the key.

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
> viewer (the retired staff PIN's) must be signed out **before** the member chain runs, or it lands in IndexedDB and survives
> the browser closing.

That sentence is why the fix cannot be tidied away. "Sign out first" alone is not.
