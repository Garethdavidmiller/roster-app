# ROADMAP_HISTORY.md — what was built, removed, tried and rejected

*Split out of ROADMAP.md in August 2026 (at v19.97). Not version-stamped; not a runtime asset.*

**Why this file exists.** ROADMAP.md had grown to 924 lines, and roughly two-thirds of it was the
past: completed phases, shipped features, experiments that were reverted, closed audits, and
security phases that had landed. All of that is genuinely valuable — several entries below are the
only record of *why* something was removed, and two carry what it takes to bring one back — but mixed in
with future work it made the roadmap unable to answer the one question a roadmap is for: **what
should we build next, why, and what has to be true before we do it?**

So the history moved here, **verbatim**. Nothing was rewritten, condensed or dropped in the split;
the text below is the text that was in ROADMAP.md, in the order it appeared. Later corrections are
appended in place rather than replacing what they correct, because in this repo the wrong version of
a decision is often the more instructive half.

**What is still LIVE and belongs in ROADMAP.md, not here:** anything with a trigger, a blocker or a
decision still to make. If you find something below that has become live again, move it back rather
than duplicating it — two copies of a plan is the failure mode this split exists to end.

**Load-bearing entries — the ones worth knowing are here:**

| If you are about to… | Read |
|---|---|
| Re-propose lazy-loading modules for load speed | *Performance* — measured and rejected, with figures |
| Re-add the cultural calendar or profile avatar | *Removed features* — a restoration path for the calendar; for the avatar, the removal checklist to reverse |
| Re-propose FIP faceted filtering, a bottom nav bar, or a summary strip | *Tried and held back* |
| Design a password stage | *The original five-stage design* — superseded by PASSWORD_DESIGN.md, but the reasoning survives |
| Touch the override write-isolation rules | *Per-member override write isolation* — and SECURITY_RELEASE_PLAN.md → B2/B3 |
| Re-read the v10.94 outage, or how the API-key referrer allowlist broke sign-in | *The four v11 security tasks* — moved here from KNOWN_LIMITATIONS.md, which keeps task #1 because it still binds |

---


## Completed phases and everything shipped since

*(moved from ROADMAP.md lines 9–56)*

## Completed phases

### Phase 1 — Firestore read layer ✓
Owner manually enters shift overrides. App reads and overlays them on the base roster. No user logins required.

### Phase 2 — Staff self-service portal ✓
Individual staff log in and enter their own overrides. Admin (G. Miller) has elevated access.

**What was built:**
- admin.html — self-service portal for all staff plus admin tools
- Individual login per staff member (name + surname password)
- AL booking with entitlement tracking (32 days CEA incl. Fixed, 34 days CES, 22 + 1 lieu per worked BH for Dispatcher)
- Bulk override operations and override history
- Cultural calendar marker preference per member (Islamic, Hindu, Chinese, Jamaican, Congolese, Portuguese)
- Dispatcher and fixed roster types
- Firestore security rules — server-side validation of all writes

**Auth note:** The original plan specified Firebase Auth (Microsoft SSO or email/password). The implementation uses a simpler surname-based password with localStorage sessions. This was a deliberate divergence — no Chiltern IT dependency, no registration flow, works immediately for all staff. Firebase Auth has since been fully wired in (complete v7.94; named-session enforcement on since v14.98) — see CLAUDE.md → "Firebase Auth".

---

## Built since Phase 2

A changelog of shipped features. The **authoritative** record for each is the code + CLAUDE.md /
AI_MAP / the `.claude/rules/*` files pointed to below — this section is condensed to the durable
**design decisions**, the **"considered but NOT shipped"** notes, and the reverts that aren't captured
elsewhere. **Removed features (✗) keep their full revert/restoration spec below — that is the valuable
part.**

**Shipped ✓ (see the linked authoritative doc for live detail):**

- **Daily Huddle viewer** (v5.53–v6.95) — manual + Power-Automate/`ingestHuddle` upload, PDF+DOCX, push notifications. CLAUDE.md → "Huddle ingest". *(A Huddle history viewer was considered and dropped — the Huddle's value is same-day duties, not browsing.)*
- **Weekly Roster Upload** (v5.77–v5.91) — `parseRosterPDF` → Claude reads the PDF table → per-person review UI. CLAUDE.md → "Weekly Roster Upload". Durable decisions: direct PDF-to-Claude (pdf-parse destroys the table columns; Claude reads the visual layout); the `RDW|HH:MM-HH:MM` internal encoding; `source:'roster_import'` on saved overrides.
- **Payday calculator** (v6.50–v7.07) — `.claude/rules/paycalc.md`. Durable: **ONE** service worker for all pages (two SWs sharing one scope competed and wiped each other's caches).
- **Huddle push notifications** (v6.11) — Web Push via Functions; VAPID keys in Secret Manager; iOS needs Safari + installed-to-Home-Screen (confirmed reliable in daily use, v10.04). `.claude/rules/notifications.md`.
- **Huddle viewer reliability** (v8.97) — direct `window.open(storageUrl)` (dropped the Google Docs iframe + its lag), an `onSnapshot` live listener (`subscribeToLatestHuddle`), and `persistentLocalCache()` for instant cached display.
- **Pay-calc roster pre-fill** (v7.07; v8.93–v9.02) — per-category fill + confidence badges + day breakdown. **v9.02 reverted the swap/ambiguous suggestion buckets** (rest-day weekday overrides ignored again — the categorisation was wrong more often than right; now permanent — `.claude/rules/paycalc.md` "Conservatism policy").
- **Team Week View** (v8.22–v8.40) — CLAUDE.md → "Team Week View". Durable: Sun–Sat weeks (`getSunday`, Chiltern convention); the `fetchToken` stale-result discard on rapid week nav; admin-only gate dropped at v8.40 (all staff now).
- **Navigation overhaul** (v10.57–v10.71) — shared `nav-panel.js` slide-out drawer on all 6 pages; sign-out + 🔔/🔕 bell moved to the footer; header back buttons removed (return via the Calendar pill); headers → `1fr auto 1fr` centred branding. **Notification-tap PDF fix (v10.71):** a tap carries no user activation so `window.open` was pop-up-blocked — `_triggerAutoOpen()` renders an in-overlay "Open Huddle" button (the tap IS a gesture). OPERATIONS_REFERENCE.md → "Huddle notification tap behaviour".
- **Security hardening** (v10.72–74) — the v10.72 per-member write isolation was **reverted at v10.94 (production outage)**, later rebuilt as the permissive 3-tier rule (B2, v14.53) then made strict (B3, v16.29) — "The four v11 security tasks", task #2, below (moved here from KNOWN_LIMITATIONS.md on 7 Nov 2026). v10.73 back-pay-in-HPP was **superseded at v16.89** (it double-counted the award uplift — `.claude/rules/paycalc.md`). Plus `.gitignore`, an iOS scroll-lock `transitionend` fallback, and the May-2026 GCP API-key referrer restriction.
- **Railcard guide** (v10.30–v10.48) + **FIP guide** — `.claude/rules/guide-pages.md`, GUIDE_SOURCES.md. FIP country-finder (v17.64) + sticky section chip-bar (v17.66) + scrollspy (v17.68) shipped. **Four FIP v2 ideas deliberately NOT shipped:** per-card reliability badges (a "Confirmed" tier would over-promise against GUIDE_SOURCES' explicit "sampled, not certified" carrier posture); per-section review dates (already tracked per-row in the register — clutter on a staff reference); collapsible major sections (invasive, low value now the finder + chip-bar carry navigation); **faceted "filter by property" search — see "FIP faceted filtering" below.**
- **Cross-page / navy-chrome / typography consistency passes** (v11.64–v11.88) — CSS-only, no behaviour change; all resulting token/surface/motion/type rules live in `.claude/rules/css-tokens.md`.
- **Huddle DOCX flow rework** (v11.66) — Power Automate flow made DOCX-first (the old noon time-of-day condition meant afternoon emails always sent PDF even with a DOCX attached); the viewer's auto-open + manual-click branches unified (`if htmlContent render inline; else "Open Huddle" button`).
- **Pay reminder infrastructure fix** (v11.65) — the daily 08:00 reminder had **never fired**: the deploy SA lacked `roles/cloudscheduler.admin` (Firebase silently failed to create the Scheduler job every deploy) and a stale `us-central1` record blocked deploys; first live 27 Jun 2026.
- **CSS extraction + infra hardening** (v12.01–05) — page/guide CSS extracted to external files; DOMPurify self-hosted; security headers (HSTS/COOP/Permissions-Policy); pre-commit ESLint + single-SDK check. **v12.05 reverted** the v12.04 anonymous-auth requirement on calendar `overrides` reads (more complexity than value — anyone can mint an anonymous token as easily as the app; "Override data is publicly readable", below, is how that closed).
- **Links design workspace** (v12.06–v12.47) — `.claude/rules/links-design.md`. Durable decisions: patterns-only documents (decouples pattern design from assignment); a slot-based generator over an early/late binary (the station is staffed in **waves**, 28 distinct start times, distinct Sat/Sun); an hourly heat map over a per-type bar chart (shows the real on-duty shape/gaps); CEAs do not work nights (`normaliseCustomShift` rejects 21:00–03:59).
- **E2E smoke tests** (v12.65 → removed v12.75 → restored v13.95) — CLAUDE.md → `e2e/`. **The one principle to preserve — whatever E2E tool is ever chosen, keep the Firebase CDN-stub approach** (`e2e/fixtures.js`): every page's module graph statically imports the gstatic Firebase SDK, and in ES modules one failed static import aborts the whole graph — so a slow/blocked CDN on a CI runner fails every test in ways no timeout/retry can fix. Intercept `gstatic.com/firebasejs/**` and serve local no-op stubs; any tool with request interception can do it.
- **The sign-in audit's fixes** (v25.98, 13 Nov 2026) — `docs/AUTH_AND_SESSIONS.md`, `.claude/rules/notifications.md`, OPERATIONS_REFERENCE.md. Durable decisions: Operations → Reset asks about a **lost or stolen phone** (an unticked box): no notice, and every push record the account owns deleted — it still puts the password on the surname, so a "sign out everywhere, keep the password" action was named and **not built** (KNOWN_LIMITATIONS); a tier Set up accounts takes away is **revoked at once**; a member's held session is **never answered with the staff PIN at start-up**; a session's start is the **server's record** of the sign-in, not the device clock; the own-password calls **refuse another account**; a refused password write **puts the reset stamp back**, an unknown one keeps it; and a static gate holds **every rule that tests for a session to asking a claim**. Eight real-SDK journeys were added; one found Settings and the forced change misreading a just-set password as the surname, fixed in the same release.


---


## Calendar start latency — CLOSED 19 Sep 2026, moved 25 Sep 2026

Two ROADMAP entries whose questions were answered, moved here verbatim. **The service-worker
revalidation storm** was answered NO on 12 Sep 2026: full-sweep boots were over a second exactly as
often as every boot (78% against 78%), so the worker is real and costs the member nothing measurable
(`LATENCY.md` → THE FULL-MONTH READ → item 4). **Sign-in and Calendar start latency** closed with
`LATENCY.md` itself on 19 Sep 2026: Phase 1 shipped, Phase 2 closed on its own decision rule, Phase 3
was priced and declined, and the identity round trip it pointed at was answered by the fast path
(v22.97), which the closing read found rarely fires and which stays by owner decision (`DECISIONS.md`).
The entries below still say 'open' and 'the next reading will settle this'; that was true when they
were written. What settled them is in `LATENCY.md`.

#### Calendar start — the service-worker revalidation storm (NEW v22.90, MEASURED v22.92, READABLE v23.00)
**Status:** SECONDARY hypothesis (demoted 5 Sep 2026 on field evidence); mechanism and volume measured, cost now READABLE on the card — **the next App Speed visit can settle this** · **Owner:** Gareth — the treatment is an architecture decision · **Would change:** `service-worker.js` SWR branch

**The instrument was WRITE-ONLY from v22.94 until v23.00**, and that is worth recording rather than
quietly fixing: `swrCount` and `readyHeavySwr` were written on every Calendar load and read by
nothing — no summariser, no card row — so the measurement this entry rests on could not actually be
taken, while still costing a Firestore write per open. Found by external review of the release that
added it. The readout is now on the App Speed card ("What the app's background worker was doing"),
so **this entry is answerable at the next reading**: if the full-sweep boots are no slower than
`Shifts shown` overall, the worker is not what staff are waiting for and this closes.

**Demoted, and by the evidence rather than by losing interest.** The September App Speed read shows
installed-app and browser opens within about three points of each other on the code metric (~17% vs
~20% over a second), so there is no sign that the installed PWA — where the service worker actually
runs — is where the delay lives. The identity path has direct field evidence; this does not. It is
still worth the controlled test below, and it is no longer a candidate for the main cause.

**Raised by external review, 5 Sep 2026, and the mechanism is confirmed in code even though the
effect is not.** On a warm cache the SWR branch serves each managed JS/CSS file from Cache Storage
and then background-revalidates it — at most once per SW PROCESS lifetime, and an Android SW is
killed when idle, so "once per process" approximates "once per app launch". That is ~49 modules plus
CSS issuing background requests while the page is making the one request the member is waiting for.

**The step that makes it concrete, measured 5 Sep 2026:** Firebase Hosting serves the app's JS/CSS
with `Cache-Control: no-cache`. Those revalidations are therefore real conditional requests, not
silent browser-cache hits. The SWR branch's own comment already names the hazard — *"pure radio /
connection contention against the page's own Firestore traffic"* — which is why the per-request
version was replaced by the per-process one.

**The proposed treatment is cache-first WITHIN a version**, on the grounds that the mandatory bump
rule makes same-version content immutable. **One correction to that argument, because the honest
version is stronger:** a same-version deploy is not hypothetical — **v22.29 shipped twice**, and
`CLAUDE.md` records that this SWR pass is the ONLY thing that self-heals it. What makes cache-first
defensible now is not that the case cannot happen but that CI catches it first: the `version` job
("a runtime change must claim a version main has not") refuses a duplicate before it reaches main.

**THE VOLUME IS NOW MEASURED, 5 Sep 2026 — and it is the number the hypothesis needed.** Counted at
the server, not in the browser, against a local origin serving the same `Cache-Control: no-cache`
Firebase Hosting sends:

| Calendar open | Requests reaching the server |
|---|---|
| warm cache, **worker just woken** (`_revalidated` empty) | **55** — 53 of them JS/CSS |
| warm cache, worker already awake | **2** |

**53 extra requests on the first open after the service worker wakes**, and on Android the worker is
killed when idle, so that is not an edge case — it is close to every open. The mechanism is exactly
as the review described it, and the size is now a fact rather than an estimate.

**Read that as REQUESTS, not bytes, or it will be over-stated.** In production each one is a
conditional request that answers `304` with no body, so the cost is 53 round trips and their
share of the connection — not 53 downloads. That is the whole reason the figure alone does not
settle the case: 53 round trips are nothing on a desk and are not nothing on a phone radio
alongside the `accounts:lookup` the member is actually waiting for.

**This entry previously said the experiment could not be run from a session container. That was
wrong, and the correction is worth keeping** because it was wrong in the direction that stops work
happening: the proxy does block gstatic, but `e2e/fixtures.js` stubs the SDK at the network layer and
`playwright.offline.mjs` allows service workers, which is how `e2e/offline.spec.js` has been
exercising the real worker all along. The tooling to measure this was already in the repo.

**THE FIELD HALF IS NOW INSTRUMENTED (v22.94).** The 53 is a local measurement on one machine; what
real staff phones do was unknown, and that is the review's second suggested metric. The service
worker now answers a read-only `REVALIDATION_COUNT` message with the size of the set it already
keeps, and `perf-reporter.js` records two samples at `ready`: **`swrCount`** in the review's own
bands (0 / 1–10 / 11–30 / 31+), and **`readyHeavySwr`** — `ready` again, on the heavy band only, so
its distribution is directly comparable with `ready` overall. A COUNT and never a URL; a browser
that cannot answer records NOTHING rather than a zero, because "no revalidation happened" is the
finding under test.

**IT WAS INSTRUMENTED AND NOT READABLE FOR SIX RELEASES, AND THIS ENTRY SAID OTHERWISE (found
v23.00, closed v23.01).** From v22.94 it claimed the two samples "answer both halves of the review's
question". They could not answer anything: `perf-stats.js` carried `SWR_COUNT_BUCKETS`,
`bucketSwrCount` and `SWR_HEAVY_BUCKET` with no summariser over them, and `operations-speed.js`
mentioned neither metric — so every Calendar open paid a MessageChannel round trip, a bounded wait
and one or two Firestore increments onto a surface where nobody could read the result back.

The contrast with `readyUpdate` (v22.92) is why it went unnoticed for so long: that one shipped
writer, summariser, card row and e2e together and was answerable the day it landed. This was the
estate's named blind spot — the rule tested, the wiring not — arrived at from the other end: the
RECORDING had eleven unit cases and a live-worker e2e, and the READING did not exist at all.

**Of the three ways to close it — render it, stop writing it, or leave it accruing deliberately with
this paragraph as the record — the answer was to RENDER it, and v23.01 did.** `summariseSwrCounts`
and `summariseHeavySwrOpens` now feed the App Speed card's "What the app's background worker was
doing" block. Nothing was ever broken; it was a half-built instrument, and the half that was missing
was the half that was the point.

**A live worker confirms the local figure independently.** Driven through a real registered service
worker (`e2e/offline.spec.js`), the count reads **0 on a first install** — the precache warm-up
writes through `cache.put` and never touches the SWR branch — and **52 after a warm reload**, against
the 53 requests counted at the server. Two different instruments, one machine, the same number.

**What is still NOT measured, and it is the half that decides the case: what those 53 requests COST a
member.** They are free on localhost and are not free on a phone radio, and no emulation here would
be faithful enough to argue from. The reading wanted is the ladder's `authBoot`/`rosterLive`
milestones on a real device, with the storm and without.

**Do not ship a treatment on this reasoning alone.** Two candidates, and they are not equivalent:

  · **Cache-first within a version.** The review's proposal, on the grounds that the mandatory bump
    rule makes same-version content immutable. **One correction, because the honest version is
    stronger:** a same-version deploy is not hypothetical — **v22.29 shipped twice**, and `CLAUDE.md`
    records that this SWR pass is the ONLY thing that self-heals it. What makes cache-first
    defensible now is not that the case cannot happen but that CI catches it first: the `version` job
    refuses a duplicate before it reaches main. It also drops the self-heal entirely.
  · **Keep SWR, move WHEN it runs** — the same shape as v22.90's fix, and it keeps the self-heal.
    The revalidation currently fires the instant the cached copy is served, i.e. straight into the
    boot's critical path. Draining it after the page marks itself ready would cost the member
    nothing and still refresh every asset. It needs a timeout fallback, or a page that never reaches
    `ready` never revalidates.

Both touch behaviour that `CLAUDE.md` lists under *"never change without discussion"*, which is why
neither is in this release.


#### Sign-in and Calendar start latency
**Status:** Phase 1 shipped (v21.29–30) · **PHASE 3'S TRIGGER HAS FIRED** (confirmed 30 Aug 2026) · **Owner:** Gareth · **Plan:** `LATENCY.md`

The measurement landed before the work, deliberately, and it has now answered. **This entry belongs
under NOW rather than LATER the moment the work is scheduled** — it is left here only because
starting it is a decision nobody has taken yet, not because a trigger is still awaited.

Two readings a week apart (22 and 30 Aug 2026, the second on 2,226 Calendar opens) agree: the wall is
`page start → Recognised` at **52% over one second**, three times its nearest rival, and everything
downstream inherits it. The code is ready inside ½s and **21% of page opens still take over three
seconds to become usable** — everything a member waits for is after the code has loaded.

**Phase 3 was then measured before being built, and it is NOT the treatment** (30 Aug 2026,
`experiments/auth-firestore-split-proof/`). Splitting Firebase Auth from Firestore saves 4.6 ms on a
desktop and 52 ms at 6× CPU throttling, against a wall of over a second — the entire auth boot is
229 ms on a throttled device. **The wall is ONE network round trip**: every boot issues a single
`accounts:lookup` to validate the stored user, unconditionally, and `Recognised` waits for it;
injecting 300 ms of latency moved the milestone by 336 ms.

So the open item is no longer "do Phase 3". It is a **security trade** — whether the app may paint
from a locally-stored identity before the server has confirmed it — and it belongs to
`CALENDAR_DATA.md` and `AUTH_AND_SESSIONS.md`, not to a performance plan.

**Phase 2 is now the largest open item, and it was instrumented rather than started** (v21.99). Its
value rests entirely on how many loads reach a grid through the authoritative read rather than from
the local cache — a cache-served load cannot be helped by narrowing that read — and nothing measured
the split. The App Speed card now carries it, with the reading rule in the plan. **Phase 4 / the
bundler is measurably not the problem.**


## "Fill this year from calendar" — SHIPPED v22.06–v22.09, moved 9 Sep 2026

**Moved VERBATIM from ROADMAP.md, where it had sat under NEXT as "Possible · Trigger: owner
go-ahead" for thirty-four releases after it was built.** Found by the v23.40 0.10 documentation
sweep, which is what that sweep is for: a roadmap still offering a shipped feature as a decision
spends the owner's attention on a question already answered, and is the shape that gets a finished
thing re-proposed.

**All three of its open design questions were answered by the code that shipped**, which is the
clearest evidence it is done:

1. *Where the button lives* — beside the "Not entered yet: …" line, its own leaning. `paycalc-year-card.js`.
2. *Confirm or not* — no confirm, with a receipt that NAMES the dates, its own leaning again.
3. *Historic overrides* — answered more conservatively than the question allowed: rule 3 refuses a
   base-only fill into a period nobody is looking at, and names what it skipped, rather than
   accepting base-roster-only for old periods.

Every guard rail it set is enforced and unit-tested — `paycalc-fill-year.js` rules 1–4, with
`paycalc-fill-year.test.mjs` organised around what a bulk write can DESTROY. The entry as written:

### "Fill this year from calendar" — bulk roster pre-fill (paycalc)
**Status:** Possible · **Owner:** Gareth · **Trigger:** owner go-ahead on the three open design questions

One tap runs the roster-assist pre-fill across **every paid-but-empty payslip of the viewed tax
year**, instead of visiting each period individually. The multiplier for everything shipped around
it: the HPP hours estimate, the back-pay accrual and the "This tax year so far" summary all sharpen
directly with filled periods, and the v18.42 "Not entered yet: 10 Apr, 8 May" lines name exactly what
one tap would fix.

**Guard rails (already decided):**
- **Never overwrites** a period the member has entered — only paid-but-empty periods are touched
  (the same paid/empty test the "Not entered yet" lists use).
- Fills follow the existing **conservatism policy** (v9.02): premium categories only
  (Sat/Sun/BH/Boxing/RDW from base roster + overrides) — no inferred ambiguous categories, no
  standard weekday hours.
- Filled values are **marked as roster-suggested** (gold), exactly like the single-period pre-fill,
  so the member can see and correct what was assumed; the result card's 📅 "Hours from calendar"
  provenance chip (v18.44) then discloses it on each affected payslip.

**Design questions to settle with the owner before building (deliberately not decided):**
1. **Where the button lives** — leaning: beside the "Not entered yet: …" lines (HPP card and/or
   the year-so-far block), since they name what it fixes; alternative: the roster-hint bar.
2. **Confirm or not** — leaning NO confirm (it can't overwrite anything) with a clear receipt
   afterwards ("Filled 2 payslips from your calendar: 10 Apr, 8 May"); the alternative is a
   preview-first flow, which fights the one-tap point.
3. Whether the fill needs Firestore overrides for HISTORIC months (the override cache may not span
   the whole year client-side — check `fetchOverridesForPeriod` coverage) or base-roster-only is
   acceptable for old periods.

**Effort:** medium — the per-period suggestion engine (`getRosterSuggestion` /
`fetchOverridesForPeriod`) already exists; the work is the loop, the receipt UI, and the tests.

---

## Firestore had no backups at all — found 16 Sep 2026, ON and verified 19 Sep

**CLOSED in three days, and the shape of the finding is why it is kept.** It was not a code defect.
`RECOVERY_RUNBOOK.md` opened its preventative section with its own words — *"These are the
difference between 'restored in minutes' and 'gone'. None exist by default"* — and then documented
three things to switch on. **Nothing anywhere recorded whether any of them ever were.** Every later
reference in that runbook was conditional: *"if PITR is on"*, *"with PITR on"*.

So the restore playbooks were written against snapshots that might not be being taken, and the only
way to find out was for a person to run one command and remember the answer.

**The absence of a completion marker meant exactly what it looked like.** This repo DOES mark
completions when they happen (`CLAUDE.md`: *"A2 complete: the old SA JSON key and the
`FIREBASE_SERVICE_ACCOUNT` GitHub secret have both been deleted"*), which is what made the silence
worth acting on rather than assuming somebody had done it quietly.

**The answer now lives in a run rather than in somebody's memory.**
`.github/workflows/backup-check.yml` (19 Sep 2026, owner-authorised) asks weekly and on demand. It
is the only place the question CAN be answered from automation, because the standing deploy key was
deliberately deleted (`SECURITY_RELEASE_PLAN.md` → A2) and no GCP credential exists outside GitHub
Actions. It is READ-ONLY and never fixes: turning backups on has a cost attached and is the owner's
call, and a workflow that could enable them could also be the thing that quietly disables them.

**Both directions were observed on this project, which is what makes the green trustworthy:**

| | |
|---|---|
| first run, 19 Sep | `No backup schedules exist` · `Point-in-Time Recovery is OFF` — a definite absence, and the job went red |
| after the owner switched them on | **`Schedules: present · PITR: present`** — both reads succeeded |

The check deliberately goes red only on a definite absence of BOTH, and stays green on an unknown
(the deploy service account may not hold `datastore.backupSchedules.list`), because *"we cannot
see"* is a different finding from *"there are none"* and conflating them is how a check becomes
noise. Having returned both answers here, it is known to distinguish them rather than merely to
return green.

**What it did not close** — a backup is not a tested restore, and the portable GCS export is still
not set up. Both are in `KNOWN_LIMITATIONS.md`, stated as open.

---

## Rangers & Rovers guide — the plan, retired (2 Sep 2026)

**`RANGERS_ROVERS_PLAN.md` in full, moved here VERBATIM apart from two changes named in place:** §6
went to `.claude/rules/guide-pages.md` because it is a reusable checklist rather than history, and the
heading levels are demoted one so they nest under this section.

**Why it was retired.** The feature shipped at v20.05 and was rebuilt Marylebone-first at v20.37. Its
durable rules were already written out in `.claude/rules/guide-pages.md` — which *cited* this plan but
did not depend on it — and its evidence lives in `GUIDE_SOURCES.md` as fifteen `rr-*` rows plus
`VAL-GUIDE-001`. Nothing in the code, the tests or `doc-parity.test.mjs`'s `LIVE_DOCS` referenced it.
Meanwhile `ROADMAP.md` carried it under **NEXT — likely, but a trigger is required** with a status of
**SHIPPED**, which is the smell that prompted the retirement: the two unsettled source conflicts are
evidence questions, and an unresolved railway claim is not a feature waiting to be built.

**Where its subjects live now:** current design → `.claude/rules/guide-pages.md`; per-product
evidence and the two conflicts → `GUIDE_SOURCES.md`; the validation question → `VALIDATION_REGISTER.md`
(`VAL-GUIDE-001`); the "what a guide page touches" checklist → `.claude/rules/guide-pages.md`.

---

## RANGERS_ROVERS_PLAN.md — a Rangers & Rovers guide for Marylebone staff

*Planning document, opened August 2026. Not version-stamped; not a runtime asset. Companion to
`.claude/rules/guide-pages.md` (how guide pages are built) and `GUIDE_SOURCES.md` (how their claims
are governed).*

**Status: SHIPPED, AND SOURCE-CHECKED PER PRODUCT (v20.05 built; v20.10 checked).** The page exists
and is wired into every contract in §6. The owner has checked its products against the live National
Rail pages (Aug 2026) — see §9c — so the page is **no longer uniformly Draft**: most products are
`National`, and two carry the new `Conflict` class because National Rail's own pages disagree with
themselves. WP2–WP5 are done; what remains is settling those two conflicts through Chiltern/retail
guidance, and capturing four product-page URLs (§9c).

⚠️ **§1 below is the record of why the page shipped Draft, and it is still true about THIS
environment** — `nationalrail.co.uk` remains unreachable from here, so nothing on the page has been
read at source *by me*. What changed at v20.10 is the route, not the standard: the evidence came from
the owner. Read §1 as the constraint on automated verification, not as the current state of the page.

---

### 1. The gating constraint — read this before anything else

**Every substantive claim in this guide is a rule a passenger could be refused travel by.** Not some
of them: the whole page. "Valid after 09:00 Monday to Friday", "not valid on Chiltern beyond
Banbury", "the holder must date the next box before travelling" — each one, stated wrongly, either
puts a passenger through a gateline they should not pass or refuses one who should.

ROADMAP.md → Evidence class is unambiguous about what that requires:

> **Anything rendered to a manager as "must be met", or to staff as a rule they could be refused
> travel or pay by, requires A or B.** C and D may inform a tool; they may not be printed as a
> requirement.

So this guide is an **evidence-class-A page end to end** — sourced to National Rail, RDG, or the
operator's own published terms. There is no version of it that runs on recollection.

**And I cannot reach class-A sources from this environment.** The session's network policy blocks the
rail industry domains outright:

| Domain | Result |
|---|---|
| `www.nationalrail.co.uk` | `EGRESS_BLOCKED` |
| `support.chilternrailways.co.uk` | `EGRESS_BLOCKED` |

Web *search* still returns third-party summaries of those pages, and §9 uses them — but a summary of
an authoritative page is **not** the authoritative page. `GUIDE_SOURCES.md` already carries this exact
warning for the railcard and FIP rows, written after the same thing happened there:

> The July 2026 source review reached the official railcard subdomains and the RDG/RST FIP pages via
> **indexed/summarised T&C content**, not a live full-page fetch (those hosts blocked automated
> fetch). … before any **National** row is treated as counter-final, open its Source and lift the
> exact clause.

**This is the whole reason the plan stops here rather than proceeding to a draft.** The repo has
already shipped materially-wrong guide content once — the v17.45 railcard audit — and the register,
the classification system and the two-way `data-guide-source` contract all exist because of it.
Writing a Rangers & Rovers page from search summaries would reproduce that failure at a larger scale,
because unlike railcards there is no staff intuition to catch an error: nobody at the gateline knows
off-hand whether the Cotswolds & Malverns Rover is valid to Banbury.

**Two ways to unblock, and they are not equivalent:**

| | What it gives | Cost |
|---|---|---|
| **(a) Widen the environment's egress policy** to `nationalrail.co.uk`, `chilternrailways.co.uk` and the relevant operator domains | I can fetch, quote verbatim, and populate the register properly | An environment setting the owner controls (see the Claude Code on the web docs → environments) |
| **(b) Gareth supplies the source material** — the retail system's ranger/rover listing, or PDFs/screenshots of the National Rail product pages | Same evidence class, and adds the Chiltern-specific reality no public page states | Gareth's time, at a machine with retail access |

**(b) is needed regardless.** The single most valuable thing this guide can contain — *is it valid on
us, and between which stations* — is a retail/operator fact, not something the National Rail
consumer pages answer. Option (a) only removes my dependence on being handed the national half.

---

### 2. The job to be done

Judged the same way `.claude/rules/guide-pages.md` judges the railcard guide: *can a staff member
glance at this mid-transaction and get the right answer fast?*

There are **two** transactions, and they are different jobs:

| | Where | The question | Shape of the answer |
|---|---|---|---|
| **Selling** | ticket office | "They want three days around the West Midlands — what do I sell?" | browse by area, compare durations |
| **Checking** | gateline, platform | "They've handed me a Heart of England Rover. Is it valid, here, now?" | one product → yes/no + why |

**The checking job wins.** Three reasons, and they should survive any later redesign:

1. It is the mid-transaction glance the guide system is already designed around.
2. It is where the cost of being wrong lands on a passenger — a wrongly-refused rover is a complaint
   and a wrongly-accepted one is revenue loss and an awkward conversation later.
3. The retail system already does the selling job well; it does not help at a gateline, and neither
   does a phone with no signal on platform 3.

The selling job is served as a by-product (the same list, browsable) but never at the expense of the
checking job's scan speed.

---

### 3. The scoping decision that makes this guide usable

There are on the order of **90 Ranger and Rover products across Great Britain**. Almost none of them
are valid on Chiltern.

A page listing 90 products at a gateline is worse than no page: the staff member scrolls, does not
find the one in their hand, and cannot tell whether that means *not valid* or *not listed*. That
ambiguity is the failure mode — silence and absence look identical, which is the same trap
`links-fatigue.js` is written around.

**So the guide is scoped to what can actually be presented at a Chiltern gateline, and it leads with
the negative case.**

- **Tier 1 — valid on us.** The short list. Each gets a full card: area, days, time bar, and the
  Chiltern reading (which of our stations are in and out).
- **Tier 2 — commonly presented, NOT valid on us.** The near misses: products whose area map
  includes Birmingham or Oxford but which exclude Chiltern services, and products a customer might
  reasonably assume cover us. Each gets one line saying *no*, and what they need instead. **This tier
  is the point of the page** — it is the answer staff cannot get anywhere else quickly.
- **Everything else** is deliberately absent, and the page must say so in one sentence, so absence
  reads as "out of scope" rather than "not valid".

Tier 2 cannot be written from national sources. It is (b) in §1.

---

### 4. The content model

One card per product. Rows chosen to answer the checking question in the order it is asked:

| Row | Answers | Notes |
|---|---|---|
| **Area** | "does it cover where they are going?" | Named end stations on OUR route, not a region name. "Valid to Banbury and Kings Sutton" beats "the West Midlands" — the railcard guide's `rc-chiltern` block already proves this reads better |
| **Days** | "is today one of their days?" | 1 day · 3 in 7 · 7 consecutive · 8 in 15 — and for flexi products, **the box-dating rule** (below) |
| **When** | "is it too early?" | Reuse the railcard guide's colour stripe + `⊘` token exactly — green = any time, amber = morning restriction. Do **not** invent a new vocabulary |
| **On us?** | the whole point | Explicit yes/no/partial, never inferred from the Area row |

**Superseded at v20.37: "On us?" was the wrong question, and the page proved it.** One column
cannot hold the answer, because there are two questions and a product can split them: the **West
Midlands Day Ranger** names Chiltern as an operator — a true `On us? ✓ Yes` — and is *unusable at
Marylebone*, because its area stops at Leamington Spa. A staff member at this barrier read the ✓,
and the fact that undid it was four rows down inside the card.

So the model is now **two states per product, and neither is derivable from the other**:

| | Question | Attribute |
|---|---|---|
| **Marylebone** | can the person in front of me use this, here? | `data-myb-validity` |
| **Chiltern** | is it a real ticket on our network at all, and where? | `data-chiltern-validity` |

`✓ Area only` is the value that did not exist before and carries most of the page's worth: *yes, it
is ours; no, not from London*. The top-level sections ARE that pair — Valid at Marylebone → Valid on
Chiltern but not at Marylebone → Not valid on Chiltern at all — so the section heading answers
before any badge is read. Tier 1 / Tier 2 in §3 survive as the *scoping* rule; they are no longer
the page's shape.

Two further rules the same pass established, both recorded in `.claude/rules/guide-pages.md`:
**state a boundary, never an exhaustive station list** (the list is a claim about an intersection,
and only one side of it is sourceable from the product page), and **a rule that belongs to a class
does not sit on one card** (the Rover advance-sale limit was on the All Line Rover as though it were
that ticket's own).

**The flexi-rover box-dating rule deserves its own treatment.** On a flexi product the holder writes
the date in the next box themselves before travelling. That makes it the one ranger/rover rule a
gateline can actually *enforce* — an undated box is the check — and it is the rule most likely to be
unknown to staff who have never handled one. It is a strong candidate for the page's single
`.gotcha`-style callout, in the way the railcard guide handles the minimum-fare mechanic.

#### What the guide must NOT print: prices

Ranger and Rover fares are re-set annually (the 2026 figures carry an "as of 1 March 2026" stamp).
There are dozens of them, and they are three-way variable — adult / child / railcard.

A stale price on a staff-facing page is a **mis-sell**, and a page with thirty prices on it will be
stale within a year whatever the review cadence says. The retail system is authoritative and is
already open in front of the person selling.

**Decision: no prices.** State the *shape* (child half price, a third off with some railcards — where
class-A sourced) and point at the retail system for the number. This is deliberately stricter than the
railcard guide, which does print the £12/£13 minimum fares — the difference is that those are two
figures reviewed each spring, not thirty reviewed against thirty product pages.

---

### 5. Page and design system

`rangers-guide.html` — a **fifth guide page**, not a section of the railcard guide. Different product
family, different question, and `railcard-guide.html` is already 452 lines of deliberately glanceable
cards that a second family would dilute.

It inherits the shell wholesale — that is what the shell is for:

- `guide-shell.css` (sticky navy header, gold rule, `←` / `⤓ PDF`, print rules, palette tokens, Inter)
- its own `rangers-guide.css`, single-column 760px, matching `railcard-guide.css`'s conventions
- **no `shared.css`**, **no inline script or `onclick`** (CSP `script-src 'self'`)
- `guide-back.js` for the `?from=` back-arrow retarget
- `guide-print.js` for the PDF button — unless it needs a chip bar, in which case follow
  `railcard-guide.js`, which wires `#savePdfBtn` itself because it owns the chips

**Reuse, do not re-invent:** the colour stripe, the `⊘`/`£` tokens, the `.rc-chiltern` amber callout,
the three-layer `official` / `local` / `check` block for any rule that is really a local reading of a
national one. Every one of those is an answer this guide system has already paid for.

---

### 6. What a fifth guide actually touches

*Moved to `.claude/rules/guide-pages.md` → "What adding a guide page touches" when this plan
was retired (2 Sep 2026). It is a checklist for adding ANY guide, it was checked against the code
row by row, and a sixth guide would need it — so it is current rules, not history.*

---

### 7. Work packages, in order

**WP0 — unblock the evidence (§1).** Nothing downstream is safe without it. Either widen egress or
have Gareth supply the source material. *Owner: Gareth.*

**WP1 — the Chiltern answer.** For each candidate product: is it valid on Chiltern, and between which
stations? This is the irreplaceable content and it is a retail/operator question. Produces Tier 1 and
Tier 2. *Owner: Gareth, with retail access.* **Evidence class B or A required — not C.** An
owner-recollected validity boundary is exactly the class-C claim this repo now refuses to print as a
rule, and getting it wrong refuses a passenger travel.

**WP2 — the national half, verbatim.** For each Tier 1 product: area, durations, time bar, railcard
discounts, child rules, flexi box-dating. Lift exact clauses; populate `GUIDE_SOURCES.md` with a row
per claim, each anchored by `data-guide-source`. *Owner: me, once WP0 lands.*

**WP3 — build the page.** Shell, cards, colour stripe, callout, print. Follow §5. *Owner: me.*

**WP4 — wire the seventeen contracts (§6), gates, baselines, docs.** *Owner: me.*

**WP5 — a staff read-through before it ships.** Someone who works a gateline reads it and tries to
answer three real questions with it. The railcard guide's worst errors were fluent and plausible;
fluency is not the check.

---

### 8. Open questions for the owner

1. **Which products actually turn up at Marylebone?** The candidate list in §9 is inferred from
   Chiltern's route, not observed. If in practice it is only ever two or three, the guide gets smaller
   and better.
2. **Is this a real gap?** How often does a ranger/rover get presented, and what happens now — is it
   guesswork, a phone call, or does the gateline just wave them through? That answer changes whether
   Tier 2 or Tier 1 is the headline.
3. **Ticket office or gateline first?** §2 assumes gateline. Worth confirming.
4. **Does Chiltern publish its own list?** The support-site article found in §9 suggests yes. If it
   exists, it may be the class-A source for WP1 and shortcut the whole package.
5. **Prices in or out?** §4 says out. It is a defensible call either way and it is the owner's.

---

### 9. Candidate products — UNVERIFIED, for WP1/WP2 to confirm or delete

> ⚠ **This table is research scaffolding, not content.** Every row came from a web *search summary*
> of a page I could not fetch (§1). It is **evidence class D**. Nothing here may reach the guide
> without being re-sourced. It is recorded only so WP1 starts from a list rather than a blank page.

| Candidate | Why it might matter at Marylebone | To check |
|---|---|---|
| **All Line Rail Rover** | Valid everywhere by definition, so it *is* valid on us. Sold from any staffed station | 7/14-day durations; railcard discounts; child rate |
| **Heart of England Rover** | Area reported as West Midlands/Central England incl. Stratford, Oxford, Birmingham — overlaps our route | Whether Chiltern services are included; 3-in-7 vs 7-consecutive; the 09:00 Mon–Fri bar; the box-dating rule |
| **West Midlands Day Ranger** | Named on Chiltern's own support article per search results | Whether it covers our Birmingham stations; reported not valid before 09:00 Mon–Fri |
| **Shakespeare Explorer** | Stratford-upon-Avon; plausible for our Warwickshire stations | Existence and current name — search returned no detail |
| **Cotswolds & Malverns Rover** | Adjacent territory; may be presented in error | Almost certainly Tier 2 (a *no*), which is still worth a line |
| **Freedom of Severn & Solent Rover** | Reported area reaches Worcester/Malvern | Almost certainly Tier 2 |
| **Oxfordshire Day Ranger** | We serve Oxford via Bicester | Existence, area, and whether Chiltern's Oxford services are in it |

**General rules to confirm** (same caveat — all class D as recorded here):

- Ranger ≈ one day; Rover ≈ multiple. Common shapes: 3 consecutive, 3-in-7, 4-in-8, 7 consecutive,
  8-in-15, 14 days.
- A morning bar (≈09:00) Mon–Fri is common but **product-specific**; any time Sat/Sun/BH.
- Railcard discount (often a third) applies to many but **not all** — varies by product and operator.
- Buying with a **Two Together Railcard** was reported to impose an 09:30 Mon–Fri bar. If true this is
  a gateline-relevant interaction and needs its own register row.
- Children usually half price.
- Some include local bus travel; some have a First Class option.
- Flexi rovers: the holder **writes the date in the next box** for each day travelled.

**Useful non-authoritative index:** `railrover.org` maintains per-product pages and was the most
complete third-party listing found. Good for *finding* products; never a source for a claim.

#### 9c. v20.10 — the owner checked the sources, and the governance changed shape

§1 said the whole page had to be Draft because the official pages are unreachable from the build
environment. That was right about the *environment* and wrong to conclude from it that the page must
stay uniformly unverified: the constraint is on **this environment's reach**, not on whether the
evidence can be obtained. The owner checked the products against the live National Rail pages
(Aug 2026) and supplied the findings, which is class-A evidence arriving by a different route.

**What that revealed is that a page-wide banner cannot express what we now know.** Eight products
read cleanly; two came back with the source contradicting itself. Presented under one "Draft"
banner, those are indistinguishable — and the reader loses precisely the thing the banner was for.

So the register gained a **`Conflict`** class (checked, and the source will not settle it) and the
page gained a status per product. The two unresolved ones are unresolved for opposite-shaped
reasons, and neither is closer to being fixed by looking again:

- **Shakespeare Explorer** — National Rail's own page permits break of journey in its description
  and forbids it in the detailed outward/return conditions. One page, two answers.
- **Thames Rover 7 Day** — the current 7-Day promotion lists Chiltern (with Banbury and Bicester
  Village); the older TR3/TR7 formal page says GWR only. Two pages, two answers. **And the duration
  is load-bearing**: the 3-Day promotion lists GWR only, so a card headed "Thames Rover" would carry
  the 7-Day finding onto a product the current source says is not ours.

Three products moved from *named without rules* (§9b) to full cards: Thames Rover 7 Day, West
Midlands Family Day Ranger, and **Chiltern Friends & Family** — which turns out to be the most
gateline-relevant of the lot, being ours, and whose e-ticket deliberately does not open the barriers.

**Still outstanding:** the product-page URLs for Chiltern Friends & Family, the West Midlands Family
Day Ranger, and the two conflicting Thames pages. Their register rows cite the parent/landing page
and say so explicitly, rather than carrying a URL pattern-guessed from the others — a fabricated
citation in a source register is the exact failure the register exists to prevent, and it would look
more authoritative than the honest gap.

#### 9b. What the v20.08 external review changed — and the one lesson worth carrying

A review of the shipped page (Aug 2026) returned five corrections. Four were **over-claims**, and
every one was fixed by claiming less rather than by asserting something new: All Line Rover's area
("all of Great Britain" → the National Rail network, with the exclusions named), its purchase window
(a flat 3 days → 3 at a station, reported 5 via telesales/online), the Shakespeare break-of-journey
permission (→ unresolved; National Rail's own page contradicts itself), and the Cotswolds operator
list (→ unresolved; the refusal stands, the list stops being quoted). None needed a source I could
not reach, because **removing a claim needs no evidence**.

The fifth is the one that mattered most and is not about any product. The page said a ticket outside
its five "almost certainly" does not cover Chiltern — **a shortlist doing duty as a rule of
exclusion** — and the review named three more products reported to reach us. That framing produces
the worse of the two available failures: refusing a valid pass to a passenger who is right and
cannot argue it. §3's scoping decision (lead with the five, answer the rest by exclusion) is still
correct as *layout*; what was wrong was letting it become an *inference*. Not on the list now means
CHECK, and step 1 of "How to check one" routes there rather than to a no.

**The three reported products were named on the page and given no rules.** That was deliberate and is
the whole distinction this plan is built on: a card states days, area, time bars and break of
journey, and each of those is a rule a passenger could be refused travel by — §1's class A/B gate. A
third party's summary is class C at best, and is precisely the sourcing behind the v17.45 railcard
errors. What was supportable, and what a gateline needs, is: these exist, do not refuse one.

| Reported | What it needed before it could become a card | Status |
|---|---|---|
| **Thames Rover (7 Day)** | Area, whether our Marylebone corridor is in it, the time bar | **Carded v20.10.** Its own applicable-station list settles the area (Marylebone absent) and the time bar was read at source at v20.37; the operator question stays a recorded conflict |
| **West Midlands Family Day Ranger** | Same as the Day Ranger already carded, plus the group composition rule | **Carded v20.10**, and sourced to its OWN product page at v20.37 (`minAdultPassengers`/`minChildPassengers` give the 1–2 + 1–2 rule directly) |
| **Chiltern Friends & Family** | **Ours, if it exists** — so it needs the retail system, not just a national page. Highest priority of the three | **Carded v20.10.** It does exist and has a National Rail product page of its own; London Marylebone is in its applicable-station list, which is the direct evidence for its `MYB ✓` |

**All three are now full cards**, so `#rr-reported` no longer names them — what survives at that id is
the *rule* that made the list necessary: a product missing from this page is out of scope, not
invalid. Do not re-add a names-only list; a product either earns a card or is covered by that rule.

---

### 10. Won't-do

- **No prices** (§4).
- **No national completeness.** This is a Marylebone guide, not a catalogue. `railrover.org` and
  National Rail already do the catalogue and do it better.
- **No customer-facing framing.** Same as the railcard guide — staff-facing, at work, mid-transaction.
- **No content from memory or from search summaries**, however plausible. That is §1, and it is the
  only rule here that cannot be traded off.

---

### Sources consulted for this plan

All reached via web search only; none fetched directly (§1).

- [Ranger tickets and Rover tickets — National Rail](https://www.nationalrail.co.uk/tickets-railcards-and-offers/ticket-types/ranger-tickets-and-rover-tickets/)
- [What rail ranger/rover tickets are available? — Chiltern Railways support](https://support.chilternrailways.co.uk/hc/en-gb/articles/9800506732317-What-rail-ranger-rover-tickets-are-available)
- [West Midlands Day Ranger — National Rail](https://www.nationalrail.co.uk/tickets-railcards-offers/promotions/west-midlands-day-ranger/)
- [Heart of England Rover — National Rail](https://www.nationalrail.co.uk/ticket-types/tickets/he7/)
- [Freedom of Severn & Solent Rover — National Rail](https://www.nationalrail.co.uk/ticket-types/tickets/s37/)
- [Rangers & Rovers — West Midlands Railway](https://www.westmidlandsrailway.co.uk/tickets-discounts/ticket-types/rangers-rovers-train-tickets)
- [Rovers and Rangers — GWR](https://www.gwr.com/your-tickets/choosing-your-ticket/rangers-and-rovers)
- [GB Rail Rover Guide (third-party index)](http://www.railrover.org/)

---

## The roster review table was never accessibility-scanned, and four opacity dims made it unreadable (found 18 Sep 2026, fixed v24.00)

**What was wrong.** `e2e/axe.spec.js` scans one rendered state per page, and reaching the Operations
roster-upload review needs a PDF upload driven through to a parsed review — so in the whole life of
the a11y gate, the review table had never been in it. When it was finally scanned by hand on
18 Sep 2026 it had **8 `color-contrast` violations** in its default state, and the states one tap
away were worse. Same shape as the blind spot WebKit found in the About panel at v23.97:
**a surface the gate cannot reach is a surface with no gate**, and it looks identical to a passing
one.

**The first diagnosis was wrong, and the wrong fix was nearly shipped.** This entry originally
recorded the failures as the `.shift-badge` component's — white-ish text on pastel type colours —
and prescribed recolouring the badge or lightening its fill. Measured properly, **every badge clears
AA on its own**:

| | Early | AL | Late | Absent | Other | Spare | Unknown | Rest | Night |
|---|---|---|---|---|---|---|---|---|---|
| ratio | 4.65 | 5.17 | 5.75 | 6.19 | 6.80 | 8.20 | 8.63 | 13.77 | 17.06 |

Every reported failure came from an **ancestor `opacity`** — four of them, each fading a group of
rows or values, and axe composites them. That matters twice over. Recolouring `.shift-badge` would
have changed the Calendar, the admin week grid, Overtime and the guides, cost a full baseline
regeneration across the app — **and not fixed this**, because a fade over a new colour halves it
exactly as it halved the old one. And Early's 4.65 is the floor: a pair that clears by 0.15 cannot
survive being multiplied by anything under 1, so **opacity was never available as a lever here**, at
any value.

**What shipped instead (v24.00), in `operations.css`.** Each dim was replaced by the cue already
carrying its meaning beside it, at full strength:

| Dim | Was | Measured | Now says it with |
|---|---|---|---|
| `.roster-from-val` — the "was" value on every changed row | `opacity: .5` | 2.06–2.99:1 | it is already smaller than the "now" value |
| `.cv-dim` — the not-chosen option on a conflict row | `opacity: .5` | 2.23–2.26:1 | the strikethrough it already had |
| `.roster-change-row.is-skipped` — a row the admin set aside | `opacity: .4` | 1.76–2.32:1 | an empty tick, the sunken surface, a tag that drops its success green |
| `.roster-blocked` — every row of a refused read | `opacity: .78` | 3.26–4.11:1 | the sunken surface (affordances were already removed) |

The `.roster-blocked` comment had **already made this argument in the source** — "these rows are
exactly what the admin has been told to check against the PDF, so making the shift badges hard to
read is the opposite of the intent" — and had moved from `.62` to `.78` chasing it. It just never
got to the end of it, because nothing measured.

**And it is gated now.** `axe.spec.js` drives the real upload to a rendered review and scans four
states: default (which covers DIFF, CONFLICT and flagged rows together), one row skipped, the whole
member skipped, and a read refused by the alignment breaker — reached through three real geometry
refusals, not by adding the class. Each of the four dims was individually re-introduced with
`scripts/mutate.mjs` and each turned the gate red.

**The one dim deliberately left.** `.roster-blocked .roster-tick` keeps `opacity: .35`. A tick in a
refused section is a genuinely inactive control — clicks are returned early at the delegate — and an
inactive user-interface component is the one thing WCAG 1.4.3 exempts. A skipped row is not: its
content is what the admin re-reads before changing their mind, so it gets no exemption and was
fixed.

## Trains page — preview items shipped (v24.74–v24.80), moved 20 Oct 2026

Moved verbatim from ROADMAP.md → "Trains page — what comes after the preview", where they were
proposed with the v24.71 preview on 7 Oct 2026. Each is followed by where it lives now.

From **A. Before 13 December — teaching the change**:

- **The changes you'll be asked about most** — a short list ranked by how many trains a day each
  change touches, so nobody has to read every route to learn the important part.
  *Now:* What's changing, `headlineChanges` in `trains-stations.js` (v24.74; consequence first
  v24.78; one line per story v24.80).
- **First and last trains, before and after**, per destination. Late-turn staff need this most.
  *Now:* the station card's First and Last rows, each way (v24.74).
- **New and lost destinations called out on their own** (Bicester Village and Stratford-upon-Avon each
  gain a weekday departure; Gerrards Cross loses one) rather than left inside the lists.
  *Now:* a new or withdrawn direct service ranks above every other headline (v24.74). The example
  was written from the simplifier; read from the published books, Stratford-upon-Avon gains its
  09:31, Bicester Village gains two trains a day, and Gerrards Cross keeps its number of trains with
  twelve at different times.

From **Open questions for the owner**:

- December calling points — once Chiltern publishes the December timetable PDFs, the same tooling
  can read them, and "which stations does it stop at" can join the comparison.
  *Answered at v24.80:* Chiltern published the books, the same two scripts read them unchanged, and
  December now comes from them — every train with its stops (`docs/timetable-dec26/tooling/README.md`).

## Closed limitations, moved out of KNOWN_LIMITATIONS.md (2 Sep 2026)

From an external review of the Markdown estate. `KNOWN_LIMITATIONS.md` promises "intentional
constraints and deferred work", so every heading in it should read as **still true** — and about a
fifth of it did not. Twelve sections below were explicitly closed, fixed or superseded, and the
largest single one (the public-override-access section, 14,063 characters) described a boundary that
has been shut since 26 August.

**They were moved by JUDGEMENT, not by matching on "CLOSED" or "FIXED".** Two headings that read as
closed were deliberately KEPT, and one of them is the argument for reading rather than scanning:
`script-src`/`frame-src` must allow `apis.google.com` says "(fixed v17.82)" and is a standing
constraint — the CSP has to go on allowing those hosts, and the section documents a false pass where
a local `npm run test:csp` stays green while CI is red. Deleting it would have removed a live
warning. The other is the mixed-version cache window, "mitigated, not fully closed (accepted)",
which is a live accepted trade.

**The first of those two has since closed, and was moved here on 25 Oct 2026** (whole-app review,
I8). v24.65 stopped loading the Google-API iframe and the next release took `apis.google.com` and the
auth frame out of every policy, so its heading came to state the reverse of the live CSP while a
doc-parity exemption, argued on the now-false ground that the constraint was permanent, kept it in
place. It is the last section of this group.

Nothing below was rewritten. Where a durable lesson exists it already lives in the contract or the
module header that owns it — the staff-PIN invariants in `CALENDAR_DATA.md` and
`AUTH_AND_SESSIONS.md`, the AL rest-day rule in `al-entitlement.js`, the pension-timeline reasoning
in `paycalc-pension.js`, the `replacedType` field in `DATA_MODEL.md` — so this is the record of what
happened, not the authority on what is true.

---

### Override data is publicly readable — CLOSED 26 Aug 2026 (staff PIN access)
> ✅ **CLOSED.** Both brakes are off: `CONFIG.CALENDAR_PIN_ACCESS` has been `true` since v20.51, and
> the `allow read;` hold line on the `overrides` read rule was deleted at v21.78. Reads now require a
> `name` claim, `admin`, or the `calendarViewer` capability, and the SERVER refuses anything else —
> so the PIN card is protection now, not friction in front of an open collection. The exposure had
> stood since the app's first Firestore write.
>
> **Two things that did NOT change with it.** A device that unlocked before the tightening still
> holds every override it cached — Firestore evaluates rules server-side, so a local cache hit never
> reaches one, which is why `calendar-overrides.js` refuses those reads separately and why tightening
> the rule alone would have looked secure and leaked (measured: `experiments/firestore-offline-proof/`).
> And `CALENDAR_PIN_ACCESS: false` is **no longer a rollback** — the rollback is reverting the step-4
> rules push. Kept here rather than deleted because the entry records an exposure that was real for
> years, and the two caveats outlive the fix.
>
> **⛔ INCIDENT, 10 Aug 2026 — step 3 was taken and ROLLED BACK the same morning.** The flag went
> `true` at v20.46 and back to `false` at v20.50, roughly two hours later, because **a correct PIN
> could not unlock the Calendar**: `unlockCalendarViewer` returned 500 from its token-mint block, so
> a member entering the right code saw "Calendar couldn't be unlocked. Try again shortly." and no
> roster. The secret, the client, the throttle and CORS were all fine and all verified. The rollback
> itself behaved exactly as the runbook promised — one line, hosting only, rules untouched.
>
> **The pre-flight is what failed, and it is the part to change.** Step 2 was signed off on two live
> probes: `GET` → 405, and a deliberately WRONG PIN → 401. Both passed; both stop short of the only
> part of the endpoint that does any work. `getUser`/`createUser`, `setCustomUserClaims` and
> `createCustomToken` are reachable ONLY by a correct PIN, so the minting path — the point of the
> function — had never once run in production. CI cannot cover it either: `stubPinExchange` replaces
> the endpoint, rightly, because a test must not hold the secret. **A verification that deliberately
> avoids the success path has not verified the feature.** RECOVERY_RUNBOOK now carries a step 2b that
> says so.
>
> **Most likely cause — an IAM gap, not app code.** `admin.initializeApp()` uses Application Default
> Credentials; under ADC `createCustomToken` signs through the IAM Credentials API, which needs the
> Cloud Run runtime service account to hold `roles/iam.serviceAccountTokenCreator` **on itself**.
> Gen-2 does not grant that by default. The function logs the exact code:
> `[unlockCalendarViewer] token mint failed <code> <message>` — read that before assuming.
>
> **RESOLVED and CONFIRMED, 10 Aug 2026 (v20.51).** The owner granted
> `roles/iam.serviceAccountTokenCreator` to `532910998075-compute@developer.gserviceaccount.com` on
> itself and enabled `iamcredentials.googleapis.com`; the flag went back on and **step 2b passed** —
> a human holding the PIN unlocked the live Calendar and got their roster. The IAM gap was the cause.
> (The diagnosis was reached by inference rather than from the function log, and the by-hand test is
> what turned it into a fact. Had it failed, the log line was the next step and remains the right one
> for any future failure.)
>
> **The grant is a STANDING PREREQUISITE, not a repair that is now done.** It lives in GCP IAM, not
> in this repository, so no test can see it and no deploy re-applies it. It must be re-applied if the
> runtime service account changes, if the function is given its own service account, or if the
> project is rebuilt — see RECOVERY_RUNBOOK's project facts.
>
> **Runbook position: the whole sequence is COMPLETE.** Steps 1, 2, 2b and 3 landed by 10 Aug 2026;
> step 4 (deleting the `allow read;` hold line) shipped on **26 Aug 2026** and step 5 confirmed it in
> production the next morning — RECOVERY_RUNBOOK.md → "The Calendar PIN". The exposure statement
> below was deliberately present-tense while the rule was permissive, and was flipped to the past
> when step 4 shipped. The
> `CALENDAR_VIEWER_PIN` secret is set (owner, 9 Aug 2026) and confirmed present, non-empty and
> four-digit-shaped. The other activation blockers all remain closed: Lock Calendar fail-closed
> (v20.39), secret shape-validated (v20.39), Calendar data readiness (v20.40–41), throttle-store
> failure fail-closed (v20.45).
>
> Written this way on purpose. An entry that read "CLOSED at v20.12" while the rule was still
> permissive would have been worse than no entry: this is the one document someone checks to decide
> whether the roster is exposed, and it would have answered no when the answer was yes.
> **`firestore.rules` now says so, and the wording followed on 28 Aug 2026** — two days late, which
> is the other half of the same lesson. "Do not re-word until the rules say so" needs a matching
> "and re-word it the moment they do", or the entry answers wrongly in the opposite direction and
> does it for longer, because nothing prompts a re-read of a paragraph that has stopped being
> alarming.

The `overrides` collection — annual leave, absence and shift changes for every member — **was**
readable with no authentication at all: `allow read;`, so anyone who found the app URL could read
all of it. That stood from the app's first Firestore write until **26 Aug 2026**. Reads now require
**either** a real member `name` claim **or** the shared `calendarViewer` capability, minted
server-side by the `unlockCalendarViewer` Cloud Function in exchange for a four-digit staff PIN.

**Why it stayed open for so long, and what changed.** Requiring auth was tried at v12.04 using an
anonymous session and reverted at v12.05, correctly: an anonymous session is obtainable by anyone,
so it was complexity with no security. The real alternative — a full named login before viewing the
Calendar — was declined because it puts a name, a grade and a password in front of a thirty-second
glance, and staff at Marylebone take that glance on shared office PCs where signing into a corporate
Windows account gives them a fresh browser every time.

The staff PIN is the thing that was missing: a **server-validated** shared credential, low enough
friction for a shared PC and real enough to hang a security rule on. It is the whole reason this
entry can now be closed rather than restated.

**Be precise about what it is, because overstating it would be worse than the old note.** It is a
shared code, not individual authentication. Everyone at Marylebone has it, it cannot attribute an
action, it cannot be revoked for one person, and it will eventually be known outside the station.
What it buys is that the roster is no longer readable by the open internet, and that the reader must
at minimum be someone who has been told the code. It buys nothing else, and nothing in the app
claims otherwise.

**One residual defect was NOT deliberate, and is closed (found Aug 2026, fixed v21.21).** The
session-only lifetime — the property everything above leans on — held only until the first reload.
`authReady` applied the member persistence chain unconditionally at module init on every page, and
Firebase's `setPersistence` MIGRATES the current user between stores: one ordinary reload of an
unlocked Calendar moved the shared viewer out of sessionStorage into IndexedDB, where it survived
the browser closing, so the next person at a shared office PC got the roster with no PIN. Found by
line-by-line reading during a latency review, proven in a real Chromium against the Auth emulator
(`experiments/viewer-persistence-proof/` — both arms, with storage dumps), and fixed by making the
boot persistence decision viewer-aware. The fix **self-heals machines the old behaviour already
leaked into**: re-asserting session persistence migrates the viewer back out of IndexedDB, so it
dies at that browser's next close — no manual cleanup and no token-revocation sweep needed. Shape
pinned by `calendar-viewer-parity.test.mjs` Contract C; no unit or e2e test can observe the property
itself, because it only exists across a genuine browser exit.

**Residual limitations now that it is switched on, all deliberate:**
- **Rotation is manual.** Changing the PIN is a Secret Manager update (no client release —
  OPERATIONS_REFERENCE.md → "Rotating the Calendar PIN"). Existing viewer sessions survive a
  rotation until their browser closes unless the viewer account's refresh tokens are revoked.
- **A calendar-only member now has to unlock, or sign in.** Before this, a member who never signed
  in anywhere could use the Calendar indefinitely. Now they either sign in once (a 60-day session,
  and no PIN thereafter) or enter the PIN each browser session. On a personal phone signing in is
  clearly the better deal, and the `sign-in-2026` notice (v21.84–v23.23, retired) existed to say so — it replaced `pw-own-2026`, which nudged this same group towards a password when what they actually needed to hear was that signing in ends the code — but it
  IS a change for the largest group of users and should be expected in support questions.
- **Viewer sessions cannot subscribe to push**, by rule as well as by UI. Every office PC unlocking
  with the PIN signs in as the same uid, so a subscription written under it would be owned by an
  identity fifty people share.
- **Telemetry is quiet on a locked Calendar.** With no identity, the error reporter, the usage
  counter and the latency sampler cannot write — so a failing PIN exchange does NOT appear in the
  Operations Error Log. Diagnose one from the Cloud Function logs.
- **App Check is still the missing integrity control** for the write side (`KNOWN_LIMITATIONS.md` → "Firebase App Check — declined as an immediate action, RETAINED as Track D").

**Search engines** were excluded separately at v19.00 (`X-Robots-Tag: noindex` plus a mirrored
`<meta name="robots">`, with a `robots.txt` that deliberately permits crawling so the noindex can
be read). That closed the casual half of the exposure; this closes the deliberate half.

**Rollback**, if viewer authentication fails catastrophically in production: restore `allow read;`
on the `overrides` block and redeploy rules. That re-opens the data and restores availability, which
is the right order of preference — an unreadable Calendar is obvious, whereas a Calendar showing the
base roster without overrides shows somebody a shift they are not working. See RECOVERY_RUNBOOK.md.


**Re-reviewed July 2026 (A2 / F-SEC-2) — decision stands, and its PREMISE has since inverted
(corrected v21.63).** This paragraph told future reviewers "the calendar now *does* establish an
anonymous session (added v13.78), so an `allow read: if request.auth != null` gate would be
near-free". **That is no longer true and must not be acted on**: the Calendar's anonymous bootstrap
was REMOVED at v20.12, and `calendar-app.js` explicitly forbids restoring it ("Do not re-add it 'so
telemetry keeps working'"). `signInAnonymously` now runs on the Calendar only under the
`CONFIG.CALENDAR_PIN_ACCESS === false` rollback path, and that flag is on. *(Both retired v24.34 — the Calendar no longer calls `signInAnonymously` at all.)*

The conclusion survives the inversion, by a stronger route. An `auth != null` gate was declined
because its value is marginal — an anonymous token is as freely obtainable as the app obtains it,
so it blocks only a token-less REST read — and **now it would be actively wrong**: with no anonymous
bootstrap, `request.auth != null` would re-admit exactly the population v20.12 closed out
(`AUTH_AND_SESSIONS.md` invariant 9: *ask for a claim, never for a session*). The real gate is the
`name`/`calendarViewer` rule, which has been the ONLY rule on `overrides` reads since 26 Aug 2026.
Do not re-propose the anon-gate as a "quick win" — it never was one, and it is now the wrong shape.

**The "read strictly after its session resolves" risk — found v19.00, ADDRESSED v19.01–19.10 (E1).** The
paragraph above is right and `SECURITY_RELEASE_PLAN.md` → Track E was wrong to call the anon-gate
"≈ zero cost — already satisfied" (that text is now corrected). `calendarAuthReady`
(`calendar-app.js`) gated only *writes* — error reporter, usage counter, push renewal — while four read
paths took whatever auth state happened to exist: `calendar-initial-fetch.js` (the 3-month override
fetch), `calendar-huddle-viewer.js`, `calendar-doc-viewer.js`, and `nav-panel.js`'s Circular/Newsletter
open. Harmless under `allow read;`, but the moment reads require a session all four would race
`signInAnonymously` on a cold start — an empty calendar, or a notification tap that opens nothing.

**E1 shipped that preparation (v19.01), and the shape it settled on matters more than the fix.** The
calendar's load became **two-phase** — paint from the local Firestore cache with no network and no
auth, THEN the authoritative server read once a session exists — so requiring auth for reads can never
put a sign-in round-trip in front of data the device already holds. The three tap paths wait for auth
**with a deadline**. That last part was learned the hard way: v19.01 used a plain `await authReady` on
all of them, and v19.07/v19.08 had to bound every one after a review found the notification document
viewer could spin on "Loading…" indefinitely. The rule that came out of it, now recorded in
`AUTH_PLAN.md` → E1: **no user-facing path may await auth without a deadline, and every failure state
needs a control rather than only text — while the render path must not wait at all.** v19.10 completed
it by moving the failed-sync state out of the chip DOM, so first-run and Team View (which have no
`.calendar-header`) get a retry offered the moment one appears instead of never.

**What E1 did NOT do: it is not a security boundary.** It changes no rule and does not stop a direct
Firestore REST read. The first phase that was to be a boundary at all was **E2** (`request.auth != null`),
superseded by the staff PIN at v20.12 — see `AUTH_PLAN.md`.

---

### ~~AL booked over a REST DAY THAT WAS BEING WORKED spends a day that later counts as none~~ (found v21.46) — **FIXED at v21.55 (`replacedType`)**

Kept, struck through, because this section said "not being fixed now" for nine releases and then the
fix shipped — deleting it would leave the next reader of an old checkout or diff with half the story,
and the DIAGNOSIS below is still the reason the fix took the shape it did.

The problem, as found: for a member whose base shift on a date is a rest day, with a worked override
on that date, booking annual leave over it gave two different answers — the confirm bar counted the
day (`isWorkingDate` saw the override), every later count did not (`consumesEntitlement` saw only the
base rest day). The root cause was the data model, not either calculation: an override is one
document per member per date, so the moment AL replaces the worked override, **the evidence that the
day was going to be worked no longer existed**.

**The fix (v21.55–56) is exactly the data-model change this section once declined:** every override
write now stamps `replacedType` — the type of the document it replaced — via `nextReplacedType`
(`override-utils.js`), which inherits on a re-save and chains THROUGH absences, so swap → sick → AL
still remembers the `shift`. `consumesEntitlement` (`al-entitlement.js`) consults it through
`isContractedWorkOverride`: a replaced **contracted** shift (`shift`) charges a day, a replaced
voluntary **RDW deliberately does not**. Pre-v21.55 documents lack the field and fall back to the
base roster — the old behaviour, so no migration. What genuinely remains open is narrower and lives
in `KNOWN_LIMITATIONS.md` → "Deleting an AL doc destroys the swap evidence it carried" (under "Calendar / roster" since 7 Nov 2026): *deleting* the AL doc still destroys the swap evidence it carried,
because only the TYPE was preserved, never the time (see "Deleting an AL doc destroys the swap
evidence it carried", v21.56).

---

### 2026/27 pay rates — ✅ CONFIRMED AND SHIPPED (closed Aug 2026)

This entry said the 2026/27 rates were placeholders and that the UI showed a yellow
"rate unconfirmed" notice. **Both stopped being true and the entry was not updated.** The
3.6% RMT award was settled (informed Jul 2026) and is applied automatically from the
**28 Aug 2026 payslip**: `AWARD_RATES` in `paycalc-calc.js` carries CEA **£21.49** / CES
**£22.60** with the previous rates as `pre`, the `TAX_YEARS` 2026/27 row carries the
stepped London allowance (£286.10, `londonAllowFrom` 28 Aug 2026), and that row has **no
`rateUnconfirmed` flag** — so no notice renders. Periods paid before 28 Aug stay on the
2025/26 rates via `getRateForPeriod`.

**The recurring instruction this entry existed for is now in the code**, next to the thing it
governs — see the `NEXT award:` comment above `TAX_YEARS`: add the new tax year with
`rateUnconfirmed: true` until its payslip lands, then set `londonAllow`/`londonAllowPre`/
`londonAllowFrom` + `AWARD_RATES.rate` and drop the flag. Chiltern awards are typically not
decided until August, so expect to do that around then.

Left as a closed record rather than deleted, because "the rates are placeholders" is exactly the
kind of claim a future maintainer would act on.

---

### Back pay lump sum vs HPP (v10.73 — SUPERSEDED at v16.89)
The v10.73 fix fed `calcBackPay()`'s variable-pay portion (`_bpVarAmount`) into `calcHPP()`.
That coupling was later found to DOUBLE-COUNT the award uplift (calcHPP already prices the
whole year at the settled post-award rate) and was deliberately removed at v16.89 — the lump
no longer feeds HPP. Current rule: `.claude/rules/paycalc.md` → "The lump is deliberately NOT
added into the HPP estimate (v16.89)". See "The four v11 security tasks", item 3, below (moved here from `KNOWN_LIMITATIONS.md` on 7 Nov 2026), for the original payslip confirmation.

---

### ~~The Calendar can show the BASE roster before it knows about overrides~~ — CLOSED (flagged v20.39, fixed v20.40)

**Was:** the highest-value item outstanding — it could show a member a shift they were not working.

`_startCalendarWorkspace()` started the three-month override fetch and then called `renderCalendar()`
synchronously. The v19.01 two-phase load paints from the local Firestore cache first, so a returning
device was fine — but on a **fresh browser there is no cache**, phase 1 painted nothing, and the base
roster went up while the authoritative read was still in flight. `.calendar-fetching` shimmers the
cells, which reads as *loading*, not as *this may be wrong*: the shift times underneath stayed
legible. Someone on annual leave, absent, or moved to a different shift could see their old shift
presented as current. The case that mattered was the **failed** read, where the base roster stayed
indefinitely beside a "Couldn't update" chip — and `calendar-initial-fetch.js` said so in as many
words: *"Initial override fetch failed — base roster will be used"*. The same gap applied to a month
navigated outside the fetched window, and to Team View.

**Fixed by making the invariant explicit rather than by adding a delay.** *Cache absence is not
evidence that no override exists.* `calendar-data-state.js` holds a four-state model per month —
`unknown` / `cached` / `authoritative` / `error` — recorded by the two fetch paths and read by the two
renderers, and a month may only be drawn when a read has settled or the device holds cached data. The
withheld states draw a wait or failure panel in place of the grid, keeping `.calendar-header` (and so
the sync chip) in every state. Team View takes the WORST knowledge across the months its week
straddles. Both withheld failure states carry a "Try again".

**What is deliberately NOT withheld:** a `cached` month renders its grid with no added banner. Hiding
good data behind a spinner is its own failure, and a staleness banner would flash on every single app
open — phase 1 marks `cached` and phase 2 overrules it a moment later. The sync chip is the honest
running commentary there, and it already existed.

**Residual, accepted:** a device whose local Firestore cache is empty *because the member genuinely
has no overrides in the window* is indistinguishable from one with no cache at all, so it waits for
phase 2 rather than painting at once. That is the safe direction and the wait is the length of one
Firestore read.

---

### ~~Tax band model is approximate for 0T and K codes~~ — CLOSED (flagged v12.49, fixed since)

**Closed.** This described `computeTax()` deriving the basic-rate band as
`threshold − personal allowance`, which is right for ordinary `nL` codes and wrong for **0T** and
**K** codes — there HMRC applies the bands to *taxable pay*, so the old model made the 20% band a
full personal allowance too wide and under-taxed anyone on those codes who crossed into 40%.

`paycalc-calc.js` now handles both explicitly (`0T`/`S0T` take a zero allowance; `Kn` adds its
negative allowance to taxable pay; the band arithmetic works from taxable pay, not from the code's
own PA), and `paycalc.test.mjs` pins it — 0T, K500, the Welsh `C`-prefixed equivalents and the
month-1/cumulative paths all have cases.

**Recorded as closed rather than deleted** because the entry survived its own fix by several
releases and was still being read as a live defect at the v20.32 audit. That is the failure mode
this file has to guard against: an old finding is indistinguishable from a current one, so a stale
entry costs more here than a missing one.

---

### ~~The pension default assumed everybody is in the scheme~~ — CLOSED v21.64, then FIXED PROPERLY at v21.78

**First closed at v21.64.** A member who has withdrawn from the RPS could not set her pension to £0:
the zero held on the payslip she typed it into and reverted to the scheme rate on every other, because
four sites resolved "what should this payslip's pension be?" through `getPensionDefault()` and being
IN the scheme was assumed rather than asked. Her take-home was understated by the whole contribution,
and her tax and NI with it (the sacrifice comes off gross before both).

**That first fix was itself a money bug, and the entry said otherwise for four releases.** v21.64
shipped a single member-level boolean, `SK.pensionOptOut`, and this paragraph claimed it "changes the
DEFAULT and never a stored figure — payslips from when she WAS contributing keep their own amount".
It does not: `readFormData` stores `null` whenever a period's pension equals the period default (so
periods keep healing as the app learns real historic rates), and a timeless boolean made that default
£0 for **every payslip there has ever been**. Found by external review and reproduced — a 2025/26
payslip's deduction went £160.78 → £0.00 and its take-home rose **£115.92**.

**The shipped shape is a TIMELINE (v21.78).** `SK.pensionTimeline` records the changes,
`paycalc-pension.js` holds the rules, and `getPensionDefault(pObj)` asks `isPensionOptedOut(pObj)`
per period — so a member names the first payslip with no deduction and everything earlier is
untouched. A timeline rather than one date because auto-enrolment re-enrols opted-out staff about
every three years, so a rejoin is expected rather than hypothetical. Design: `.claude/rules/paycalc.md`
invariant 12 and the `paycalc-pension.js` header.

---

### ~~Pension default is frozen onto a period once it is touched~~ — CLOSED v18.43

**Closed (v18.43),** with the pension cut-overs this deferral prescribed as its trigger (the historic
`PENSION_STEPS` table — review item 8): `readFormData` now stores `null` when the pension field still
equals the period's default (default × pro-rate, 2dp, ±0.005 — mirroring `_hasCustomPension`), so a
merely-touched period keeps self-healing to default changes while a genuinely custom pension
persists. Periods frozen BEFORE v18.43 keep their stored value (indistinguishable from a deliberate
entry — the per-payslip pension design); re-saving them heals them. Original finding below for the record.

**Original finding:** Pension default is frozen onto a period once it is touched (defer to the next pension change)
`loadPeriodData` writes the period-appropriate pension default into `#pensionAmt` when a period
has no saved pension (`d.pension == null`), and `readFormData` then persists whatever is in the
field — so the first edit to that period saves the default as a concrete value, and the period no
longer "self-heals" to a *future* pension-default change (the self-heal the `loadPeriodData` comment
intends for pension rate cut-overs). **Impact today is zero**: there is only one pension value
(£147.36), so default == stored for every period and nothing can diverge. It becomes real only when
(a) a pension **cut-over** is configured in `getPensionDefault` (like the rate `pensionPre`/`pensionFrom`
pattern) *and* (b) a **future** period was edited before that cut-over — then that period shows the
old pension. **Fix belongs with the next pension-rate change** (that's when it matters and when it can
be tested against a real cut-over): make `readFormData` store `null` when the field still equals the
period's default — `Math.abs(fieldValue − getPensionDefault(period)×proRate) < 0.005`, mirroring the
existing `_hasCustomPension` check — so a pre-touched period self-heals while a genuinely-custom pension
is preserved. Do NOT fix speculatively now (unverifiable without a cut-over; risks the historical-accuracy
case). Surfaced by the v15.70 whole-page paycalc review (finding #6).

---

---

### ~~firebase-admin upgrade to v14 blocked on firebase-functions compatibility~~ — CLOSED v22.01

Shipped: `firebase-admin@13.10.0 → 14.3.0`, `firebase-functions@7.2.5 → 7.3.2`. The peer range that
blocked it (`^11 || ^12 || ^13`) widened to include `^14` in `firebase-functions@7.3.x`.

**What the bump actually was, because this entry understated it.** The old step 2 said to "audit
`admin.firestore.FieldValue.serverTimestamp()` usage in `functions/index.js`". The real scope was
**59 call sites across five modules** — v14 removes the namespaced API wholesale, so `admin.auth()`,
`admin.firestore()`, `admin.storage()` and `admin.firestore.FieldValue`/`.Timestamp` all cease to
exist; the root export is now app lifecycle (of which we use only `initializeApp`), credentials and
errors. Verified against the published `firebase-admin@14.3.0` tarball, not the release notes.

It was done as **two separately-verifiable commits, and that order is the lesson**: the modular
entry points (`firebase-admin/auth`, `firebase-admin/firestore`, `firebase-admin/storage`,
`firebase-admin/app`) already exist on v13, so every call site was migrated and the full 350-test
functions suite run GREEN before a single version moved. The version bump then changed no code and
had one job — proving the migration was complete.

Two things a future major will hit again:

- **The three endpoint harnesses inject their fakes by resolved path.** They stubbed
  `require.resolve('firebase-admin')`; after the migration nothing requires that path, so a fake
  left there would have been loaded by nobody and the whole suite would have run against the real
  SDK — passing or failing for reasons unconnected to the code. They now stub
  `firebase-admin/auth` and `firebase-admin/firestore`, and both were mutation-checked (remove the
  stub, or repoint it at the old root: 9 and 10 failures respectively).
- **v14 declares `engines: {"node": ">=22"}`.** The deployed runtime already is 22, and the PR-side
  `functions` job in `e2e.yml` has been on 22 since v21.82 — but `deploy-functions.yml` pins Node
  **20** for firebase-tools auth, so it would have installed a package it declares unsupported
  (npm's `engines` is advisory without `engine-strict`) and then exercised every handler on a Node
  the SDK does not support. That job now opens a Node 22 window around the functions install and
  tests and steps back to 20 for the deploy tool, satisfying both constraints in sequence rather
  than choosing between them. (Gone since v25.30: the workflow runs Node 24 throughout.)

The scoped `overrides: { "uuid": "^11.1.1" }` **is still needed** and was re-checked here, not
assumed: `@google-cloud/storage@7.22.0` still pulls `gaxios@6.7.1`, which declares `uuid ^9.0.1`.
`npm audit --omit=dev` in `functions/` is 0.

---

### E2E smoke tests — REMOVED v12.75, RESTORED v13.95 (no longer a limitation)

**Resolved v13.95.** Restored once Chromium became available pre-installed in the
dev environment (`/opt/pw-browsers`), giving back the local iteration loop whose
absence forced the v12.75 removal. The suite (`e2e/`, `npm run test:e2e`) runs in CI
and gates the hosting deploy; `@playwright/test` is pinned to `1.56.1` to match the
pre-installed browser revision. Full restoration notes: ROADMAP_HISTORY.md → "Completed phases and everything shipped since" (E2E smoke tests).
The original removal rationale is preserved below.

Playwright smoke tests were added to verify that each app page loads, the JS module graph
executes without error, and key UI elements render (member dropdown, calendar grid, login
overlays, auth redirects for operations and links). They were the only tests that caught
page-level wiring failures — a SyntaxError, a missing import, or a CSP violation that
breaks the module graph shows up as a blank page and passes all unit tests.

**Why they were removed:** The Playwright Chromium binary cannot be downloaded in the
current development environment (CDN blocked), so the suite cannot be run locally to
verify a fix before pushing. In CI, they were originally solving a real problem: the
Firebase SDK is loaded as a static ES module import from the `gstatic.com` CDN; if that
CDN is slow or blocked on the CI runner, the entire module graph fails to load and every
page test times out — no amount of retry or timeout increase helps a hard import failure.
The `e2e/fixtures.js` stub solved this elegantly (intercepting `https://www.gstatic.com/
firebasejs/**` at the network layer and serving no-op local stubs), but the inability to
run them locally made maintenance impractical. When the suite broke or needed updating,
there was no way to iterate on it without pushing to CI.

**To bring back:** When resuming this work, **ask Gareth to walk through the better
options before committing to Playwright again.** The key questions are:
- Can the Chromium binary be made available in the dev environment, or is Playwright
  the wrong tool for a no-bundler CDN-only codebase?
- Should E2E tests run in a real browser at all, or would jsdom-based unit tests for the
  DOM wiring layer (nav-panel, overlay, session) cover the same defects more cheaply?
- Puppeteer, Cypress, or a different Playwright setup (pre-installed system Chromium)
  might remove the binary-download friction.
- The Firebase CDN stub approach was sound — whatever tool is chosen should reuse that
  pattern or find an equivalent way to eliminate the CDN single point of failure.

See ROADMAP_HISTORY.md → "Completed phases and everything shipped since" (E2E smoke tests)
for the full history and the original test design.

---

### `window._mybSession` global replaced by `sessionReady` / `resolveSession()` ✓ (v13.74)
The `window._mybSession` global handshake was replaced at v13.74. `session.js` now exports:
- `sessionReady` — a `Promise<boolean>` that feature modules `await` before Firestore/Storage writes
- `resolveSession(result)` — called once by each page coordinator after `ensureFirebaseSession()`

Page coordinators (`admin-app.js`, `operations-app.js`, `settings-app.js`, `links-app.js`)
call `resolveSession()` at module scope. Feature modules (`huddle.js`, `admin-auth.js`,
`admin-roster-upload.js`) import `sessionReady` explicitly — a missing import produces
an ESLint `no-undef` error rather than a silent permissions failure.

**Residual:** `window._mybSession` is no longer set or read anywhere in the codebase. This
limitation entry is kept for history; the underlying issue is resolved.

---

---

### Fixed in v13.72 (now log `console.warn`)

| File | Location | Before | After |
|------|----------|--------|-------|
| `doc-retention.js:pruneOldDocs` (was `firebase-client.js:_pruneOldDocs`) | Individual Storage file delete inside prune loop | `.catch(() => {})` | `.catch(e => console.warn('[pruneOldDocs] ...', e))` |
| `firebase-client.js:uploadCircular` | Rollback Storage delete on Firestore write failure | `.catch(() => {})` | `.catch(e => console.warn('[uploadCircular] rollback ...', e))` |
| `firebase-client.js:uploadNewsletter` | Rollback Storage delete on Firestore write failure | `.catch(() => {})` | `.catch(e => console.warn('[uploadNewsletter] rollback ...', e))` |

### `script-src`/`frame-src` allowed Firebase Auth's Google-API iframe — `apis.google.com` (fixed v17.82; SUPERSEDED Oct 2026, moved here 25 Oct 2026)
> **Superseded.** Since v24.65 Auth is created with `initializeAuth` and no popup resolver, so the
> gapi script and the authDomain iframe are never loaded, and the next release took `apis.google.com`
> and the `firebaseapp.com` frame OUT of every policy (`frame-src 'self'`). `csp-hygiene.test.mjs` now
> refuses them and `e2e/csp.spec.js` ignores no beacon at all — a refusal of either URL means
> something has started loading that iframe again. The history below is kept because it explains
> why the hosts were there.

Firebase Auth (`firebase-auth.js`, loaded from gstatic) pulls in the Google API client
**`https://apis.google.com/js/api.js`** and opens an auth-helper iframe on the **authDomain**
(`myb-roster.firebaseapp.com`). `apis.google.com` is a **different domain** from the
`*.googleapis.com` `connect-src` wildcard, so it was never covered — the CI `csp` job failed on the
three app pages that initialise Auth with `Refused to load the script 'https://apis.google.com/js/api.js'`
(directive `script-src-elem`). It only surfaced on CI: behind the dev-container proxy `www.gstatic.com`
is tunnel-blocked, so the SDK never loads and never makes the call (the documented **false pass** — a
local `npm run test:csp` stays green while CI is red). Fix: `script-src` now includes
`https://apis.google.com`; `frame-src` (was `'none'`) now allows
`https://myb-roster.firebaseapp.com https://apis.google.com` for the auth iframe — the standard
Firebase-Auth-under-CSP requirement. **Second layer (v17.96):** once the gapi script could load, it
began pinging its own telemetry endpoint (`apis.google.com/js/gen_204`) — a `connect-src` violation
(the `*.googleapis.com` wildcard does NOT cover `apis.google.com`). `connect-src` now includes
`https://apis.google.com` too. Lesson: allowing a third-party script means allowing what it then
CONNECTS to — check the CI csp job after each layer, not just the first. Applied to the `firebase.json` header AND every served page's `<meta>` CSP
(csp-meta-parity), with `apis.google.com` added to `csp-hygiene.test.mjs`'s `DYNAMIC_HOSTS` (it's
requested by the gstatic SDK, not built in our source).

**Third layer — the beacons we deliberately keep blocked (v18.90).** Once the iframe was allowed to
load and connect, it started firing two fire-and-forget telemetry requests the app does not need:
`www.google.com/images/cleardot.gif` (a 1×1 tracking pixel) and `apis.google.com/js/gen_204`
(Google's logging beacon). These are **correctly refused** — `www.google.com` is in no directive, and
`apis.google.com` is allowed to CONNECT but not to serve images. The problem was the *test*, not the
policy: `e2e/csp.spec.js` asserted zero violations of any kind, so a deliberately-blocked third-party
beacon failed the run. Worse, it only failed *sometimes* — the beacons fire only if the iframe reaches
that state before the spec ends — which is why the `csp` job failed on three unrelated PRs in one day
(#1070/#1078/#1080) while the parallel run of the same commit passed. `IGNORED_BLOCKS` now names those
two URIs, gated by `BEACON_DIRECTIVES` so the waiver applies **only** to `img-src`/`connect-src`
refusals: if `apis.google.com` is ever refused for a `script-src` or `frame-src` load — the v17.82
outage — it still fails. (A live Chromium probe under the Hosting emulator confirmed the `gen_204`
beacon is refused by `img-src`, so the two directives named are the two that can legitimately fire.) **Do not widen the policy to make a beacon pass;** blocking third-party
telemetry is the intended behaviour.

---

## Closed limitations, moved out of KNOWN_LIMITATIONS.md (7 Nov 2026)

A second pass on the rule the group above was moved for: every heading in `KNOWN_LIMITATIONS.md`
should read as still true, and the file had again filled with finished work, and with the history
of the items that stay open. Moved here **verbatim**, by line range from the file as it stood at
v25.46 — whole sections where an item closed or its entry was mostly history, and the closed bullets
or dated paragraphs where an item stays open. Each live item keeps a short, present-tense entry in
`KNOWN_LIMITATIONS.md`, which also keeps stubs where other files cite a heading (task #1, "The
member claim", "Playwright's WebKit crashed").

Nothing below was rewritten, so it says what was true when it was written. Where a section reads
"open", or "the next reading will settle this", the live position is the `KNOWN_LIMITATIONS.md`
entry of the same name, or the contract or module header that entry names.

---

### Left open by the full check of 3 November 2026 (v25.20) — each an owner decision

The bug, regression and technical-debt check behind v25.20 fixed what was plainly broken. These it
left, each for a decision rather than a default:

- **Done the same day — High Contrast and the colour questions (v25.22).** Under Windows High
  Contrast a chosen control used to look like an unchosen one; one rule in shared.css now rings every
  chosen control in the theme's `Highlight`. Operations' hand-entry type pills wear Admin's type
  colours, the "Swapped / Rest day" answer is leave's teal in both places it is asked, and the date
  pickers and Trains' chosen timetable column took the page's colour — the last navy choices.
  `.claude/rules/css-tokens.md` → "The last navy choices took the page's colour".
- **Done the same day — CI and the deploy tool off Node 20.** `actions/cache` v6.1.0 (was v4.3.0)
  and `google-github-actions/auth` v3.0.0 (was v2.1.13) both run on Node 24, and firebase-tools runs
  on Node 22 in all three deploys (24 since v25.30, with the Functions runtime). Its Node 20 pin
  dated from a "Failed to authenticate" under the retired key file; if a deploy ever fails to
  authenticate, the comment at the top of `deploy-functions.yml` names the lines to set back to '22'.
- **CLAUDE.md came off its 125,000-character cap the same day (v25.23):** the retired notices' histories moved into the new-notice skill (120,880 characters then; 121,745 on 4 Nov 2026).
- **Weight**: `.git` is 1.4 GB. **The Links 26 pack zip is built on demand since 3 Nov 2026** (owner):
  each committed copy had added ~15 MB to the history, sixteen times; it is untracked now (`*.zip` was
  already ignored — it had been force-added) and `tooling/pack.py` says to run the script and send the
  file. The copies already committed stay in history; rewriting it was ruled out. `docs/links-24` is
  read by more than this line used to say: its proposal files are fixtures for
  `links-compare-analysis.test.mjs` AND `links-compare.test.mjs`, and the Links 26 tooling reuses its
  scripts. Its own 13 MB zip no longer changes, so it costs checkout size and nothing more. (The folder
  was removed on 7 Nov 2026; Known Limitations → Weight has where its files went.)
- **Size**: nine of the 28 modules in `coordinator-ratchet.test.mjs` sit exactly at their cap. The
  seven stylesheets over 900 lines are capped since v25.23 (`stylesheet-ratchet.test.mjs`, the same
  ratchet: `index.css` 3,861 lines and `shared.css` 3,852 on 3 Nov 2026). `e2e/pages.spec.js`
  was split by page on 3 Nov 2026: Admin, Links, Operations, Settings and the guides each have
  their own spec, and it keeps the tests that span pages.
- **Twins, settled the same day.** `isRest` and the window-row conversion are one copy each now
  (`links-design.js`; `rowMinutes` in `links-window.js`). Two stay apart on purpose: `withTimeout`
  (`login-overlay.js`, `password-force.js`) — login's copy ignores the error and the other's callers
  read its `myb/timeout` code, and sharing one would pull the Firebase module graph into the sign-in
  overlay's unit tests or need a new module, for six lines; and `adjustScrollOffsets`, one idea with a
  different target per guide (`railcard-guide.js`, `rangers-guide.js`), in classic scripts with no
  shared module. Colours written as `rgb()`/`rgba()` are now read by `css-hex-parity` too: pure white
  or black at any alpha is neutral (like the `white`/`black` keywords), and the 17 coloured ones the
  app sheets held — nearly all one navy shadow tint — are a ratchet that may only go down (8 in
  `index.css`, 6 in `links.css`, 3 in `shared.css`). The guide sheets keep their own palette guard.
- **Overtime stays paused** (owner, 3 Nov 2026). Its page, Cloud Functions and tests — about 19,000
  lines — are kept and keep running in CI, so it can be switched back on; removing it was offered and
  declined.

### A failed deploy is now announced — but the gate can still flake (Aug 2026)

**What happened.** The hosting deploy for v19.94 failed its own `npm run check` gate on **one unit
test out of 1254**, so the workflow exited before deploying. Staff stayed on v19.91 for about two
hours and nothing said so. It was noticed only because the owner compared the Firebase version
against the GitHub Pages mirror — which has no test gate at all and had gone straight to v19.94.

**It was a flake, and that is provable rather than assumed.** `e2e.yml`'s `unit` job and
`deploy-hosting.yml`'s test step run the *identical* `npm run check`. On the same commit the PR's
job passed and the deploy's failed. A re-run of the same code then went green. Locally it would not
reproduce in six runs of the unit suite, nor in three more of the six most timing-dependent suites
under eight CPU spinners.

**The failing test was not identified.** The job log is far too large to retrieve through the API
and its tail contains only passing lines. If this recurs, pull the log promptly — that is the one
chance to name it.

**Frequency:** 1 in the last 30 hosting deploys (746 all-time).

#### What the announcement covers, and what it does not

Fixed: the SILENCE. All three deploy workflows now open (or comment on) a `deploy-failure` GitHub
issue via `.github/actions/report-deploy-failure`. Read that action's header for why an issue rather
than email or push.

**And a second silent class, found the hard way (Aug 2026).** The reporter shipped as the deploy
job's own last step under `if: failure()`, with a comment claiming that covered "EVERY step above".
It did — and a step-level guard cannot run when NO step runs. On 14 Aug the rules deploy failed in
`Prepare all required actions` (codeload would not serve a pinned action), so the job died during
setup, every step including the reporter was skipped, and a failed production deploy sat unnoticed
until someone listed the workflow runs by hand. That is the exact outcome the reporter was built to
prevent, reached by a route it could not see. It is now a **separate job** — `needs: deploy` plus a
JOB-level `if: failure()` — which fires whatever kills the deploy, setup included, and it replaces
the in-job step rather than joining it (two reporters would comment twice on one issue). Enforced by
`workflow-hygiene.test.mjs`, which asserts the shape, because the triggering condition is an outage
and cannot be reproduced on demand — which is precisely why the gap survived review the first time.
The irreducible tail: the reporter job still needs `checkout` and the action itself, so an outage
broad enough to take those down takes the reporter with it. Nothing inside a workflow can report
that.

NOT fixed: the unit-test flake itself, and deliberately. An automatic retry would have hidden this
one, but it also hands a genuinely intermittent product bug a second chance to reach staff. The
`npm run check` half of the gate stays single-shot; the Playwright half has retried once in CI since
v23.45 (`playwright.config.mjs`), which reports a pass-on-retry as `flaky`. The notification tells you
to re-run when the failure is spurious.

**Two properties of the notification worth preserving.** It never fails the job — every command is
`|| echo "::warning::…"`, because it only runs when something has already gone wrong and must not
bury the real error under a second one. And repeated failures COMMENT on the open issue rather than
opening a second: a run of consecutive failures is one situation, and N issues is how a notification
channel teaches its reader to ignore it.

**A deploy failure does not fix itself.** `paths-ignore: '**/*.md'` means a documentation-only commit
will not retry it, so production can stay stale indefinitely until an unrelated change lands.

### The `webkit` job is intermittently red, and it is not a gate (measured Aug 2026, v21.40)

Branch CI has shown a red `webkit` job on most recent pushes while `unit`, `smoke`, `rules` and
`csp` were all green. **It is flake, and unlike the entry above this one is measured rather than
inferred**: `paycalc: backup → restore round trip survives the reload` failed **1 run in 6** locally,
same code, same machine, same command — and it failed on *desktop webkit* locally while CI failed it
on *mobile-safari*, which is a different project each time. Across two CI runs on one commit the
failing sets had **zero overlap**.

**Do not read a red `webkit` as a broken build, and do not read it as nothing either.** The right
check is the one that distinguishes them: compare the failing test NAMES between runs. Different
names ⇒ flake. The same test failing repeatedly ⇒ investigate it, because the engine difference is
exactly what this job exists to catch.

`webkit` is deliberately **not** in `deploy-hosting.yml` — the reasoning is in `e2e.yml`'s own header,
and it is the v19.94 lesson applied: a second engine in the deploy gate lets a WebKit-only flake keep
staff on a stale version. Merging with `webkit` red and the other four green is the designed
behaviour, not a shortcut.

**Both candidate fixes were applied the same day (v21.40), because a job that is usually red teaches
everyone to stop reading it.** The commonest offender — the paycalc backup→restore round trip — was a
genuine race in the TEST (a fixed 1200ms sleep betting on the card's own 800ms self-reload; the log
said so plainly: "Execution context was destroyed") and now waits for the navigation itself. The
residual tail — click timeouts on a slow runner, different tests each run — is covered by
`retries: process.env.CI ? 1 : 0` in `playwright.webkit.mjs` (the Chromium deploy-gate config has
carried the same line since v23.45): an engine difference is
deterministic and still fails both attempts, so the job stays red for exactly the thing it exists to
catch, while a one-off race is reported "flaky" instead of failing the run. If `webkit` goes red
NOW, take it seriously: the flake excuse has been spent.

### Two editors on one day: one record now, but the second is not WARNED (v24.48)

An external review (Oct 2026) reproduced two Admin defects, both fixed in v24.48:

- **A read from the offline cache was treated as complete.** `admin-override-store.js` now refuses
  one (`refuseCachedRead`): it is a failed load, with Retry, an "offline" message, and an automatic
  retry when the connection returns — never "this member has no saved changes".
- **Two editors saving one day left two records.** Every manual record now has one fixed id per
  member and date (`manualOverrideId`), so the second save lands on the first one's document.

**What remains, deliberately:** the second editor is not told the day changed underneath them —
**last SAVE wins**, exactly as when two people save one after the other. **A DELETE no longer does**
(Oct 2026 production review): with one id per day, a stale delete removed the colleague's newer
record, which a sequential deleter would have seen. Every override delete now re-reads what it is
about to remove and refuses, saying so, when it has changed (`assertDeletable`,
`admin-override-store.js`); an unconfirmable check refuses too, so deletes need the network. Warning them would need
every Admin save to run as a TRANSACTION that re-reads each day first; that would also make an
offline save FAIL rather than queue, and it rewrites the write path most of the e2e suite observes.
A decision, not an oversight — revisit if a lost edit is ever reported.

**Then revisited, without the cost (v25.90, owner, 12 Nov 2026).** Every Admin save of a day now
runs as one transaction that reads each day first and refuses, naming the days, when one no longer
holds what the page showed (`commitChecked`, `admin-override-store.js`). The offline cost was
avoided rather than paid: a save made offline — or whose check could not reach the server — is still
held on the device as a batch and sent unchecked, as before, so only a device that can ask the
server is warned. KNOWN_LIMITATIONS.md → "Two editors on one day" has what remains.

**Duplicates already in Firestore** from before v24.48 are cleared only when that day is next saved
or deleted from Admin — the week editor, a leave/absence range, or either Saved Changes delete (the
row ✕ and Delete selected joined at v24.49, after an external review found they removed only the
picked row and let the older copy resurface). Each path clears the MANUAL copies Admin has loaded
for that member and day; an import is never treated as a duplicate. On the capped All-staff list a
very old day may not be loaded, so selecting the member first is the complete route. None has been
counted; nothing in the app reports them.

### Development-tool advisories that only a downgrade would clear (v24.50)

An external review (5 Oct 2026) counted 32 `npm audit` entries in the ROOT tree — 1 critical, 17
high, 14 moderate. That tree is development tooling only (the Firebase CLI, the rules-test harness,
Playwright, ESLint); nothing in it is served to staff, and the Cloud Functions' production tree
(`functions/`, `npm audit --omit=dev`) reads zero. Two steps took it to **11 (7 high, 4 moderate)**:

- `npm audit fix` without `--force` — every update inside its declared range, including `tar`
  7.5.17 → 7.5.22 (GHSA-23hp-3jrh-7fpw, the one the review named) and the critical entry.
- An `overrides` entry in `package.json` raising `@grpc/grpc-js` under `@firebase/firestore` to
  `^1.14.5`. Firestore 4.17 pins `~1.9.0`, so this runs it on a version it does not declare —
  accepted because the only code that uses it is the rules-emulator suite, and that suite passes
  375/375 on it. **If `npm run test:rules` ever fails to CONNECT after a dependency change, remove
  that override first.** Drop it once Firestore's own range moves past 1.9.

**All 11 remaining sit under `firebase-tools`** (basic-ftp, braces/chokidar, uuid/gaxios,
@opentelemetry/core). `npm audit fix --force` would answer them by DOWNGRADING the CLI from 15.x to
14.x — the wrong direction, and the review said so too. They clear when the CLI updates its own
dependencies; re-run `npm audit` after each CLI bump.

**The tooling refresh, 3 Nov 2026 (v25.25): 37 → 21, none high or critical.** The root had drifted
back to 37 (1 critical, 12 high, 24 moderate). `firebase-tools` 15.32 → 15.34 and the same
`npm audit fix` without `--force` cleared the critical and every high. The 21 moderate left are the
same shape as before: inside the CLI (pubsub, opentelemetry, archiver, gaxios, glob, uuid, superstatic)
and inside ESLint's own packages, where npm's only offer is a downgrade to ESLint 4. The fix also
moved ESLint to 10.14, four days old, so it was set to 10.13 by hand: the update bot
(`.github/dependabot.yml`) waits two weeks after any release, and 10.14 will arrive through it.

**TypeScript 7 (v25.26, 4 Nov 2026): the update bot's first major version, taken with the two fixes
it needed.** TypeScript 7 is a rewrite of the compiler, and it refused two JSDoc spellings that 6
accepted, seven errors from two causes: a Closure-style function type (`function(number, any):
string` in `paycalc-app.js`, now `(r: number, mult: any) => string`) and a function named where a
type belongs (`ReturnType<import('./trains-stations.js').lastTrains>` in `trains-render.js`, now
`ReturnType<typeof import(…).lastTrains>`). Both are comments, so nothing runs differently; the
package files are the bot's own, taken unchanged, so its PR closes itself once this lands. Each of
its other major versions is still a decision of its own.

**The Cloud Functions' production tree no longer reads zero: 6 moderate.** All sit in one chain
inside Google's Firestore client (`@google-cloud/firestore-api` → `google-gax` → `gaxios` → `rimraf`
→ `glob`/`minimatch`), whose own version ranges do not admit the fixed releases, so
`npm audit fix` changes nothing. They are file-matching helpers that nothing staff send ever
reaches. Not forced with `overrides`: that would run Google's client on versions it does not
declare, for findings it cannot reach. They clear when `firebase-admin` takes a newer client;
re-run `npm audit --omit=dev --prefix functions` after each bump of it.

### The test matrix and the phones staff carry (v24.61)

The iOS 27 / iPhone 18 Pro audit (6 Oct 2026) found the test matrix a generation behind the fleet:
the two WebKit lanes ran as an iPhone 13 (390×844), and every iPhone Pro since the 15 — the 16 Pro,
the 17 Pro and the 18 Pro, which to a web page is the same device as the 17 Pro — is 402×874 at the
same density. Both lanes now run at that geometry (`IPHONE_PRO_VIEWPORT` in `playwright.webkit.mjs`,
shared by `playwright.visual-webkit.mjs`, and by the four visual tests that grow the viewport for a
tall surface — a 24-hour review found those still at 390 after the first pass); the six WebKit
baselines were regenerated and the full WebKit smoke suite re-run at the new width before this shipped.

**The Playwright upgrade: 1.56.1 → 1.63.0 (3 Nov 2026, owner: "Can you update the version of
playwright in the repo?"),** in a pull request whose only subject it is, as this paragraph asked. It
brings Chromium 1243 (Chromium 153), WebKit 2359 (Safari 26.6, against the 2215 that identified as
Safari 26.0) and an iPhone 17 Pro descriptor. The paragraph used to say why it waited; both reasons
moved:

- **The baselines came from CI's own render — and that is the lesson worth keeping.** They were
  first redrawn in the dev container, whose pre-installed Chromium is now 1243, the very build CI
  runs, on the same Ubuntu 24.04. All 51 still failed on CI. Same build, different machine: the
  container breaks some lines of Inter a word differently (it drew the App Speed card 17 px
  taller), so a matching version number did not make a matching render. They were redrawn instead
  from the actual screenshots in the pull request's own `visual-diffs` artifact, whose digest was
  checked. On CI, Chromium 153 left 17 of the 51 pixel-for-pixel as they were on 1194 (kept
  byte-for-byte) and moved the other 34 slightly: the blurred backdrop behind every overlay and
  lightbox (31% of the tips overlay's pixels, each by a little), glyph edges, the Team View's
  emoji. The largest were looked at; nothing moved but rendering. **When the lane on a pull request
  disagrees with a baseline drawn here, believe the lane** and take the artifact's actuals.
- **WebKit 2359 met the suite first in CI.** It is not pre-installed in the container (the session
  hook never runs `playwright install`), but `npx playwright install webkit` fetches it in about a
  minute, which is how the two findings below were reproduced and their fixes proven before a
  push. Its six baselines came from CI's render, as above. Under Safari 26.6 line heights moved by
  a pixel or two (the railcard guide's sections sit a few pixels higher, the day panel is 2 px
  taller); nothing else.
- **It found one real Admin defect.** With no member remembered on the device, an admin or manager
  opening Admin got no member and no week: the list's first entry is a disabled "— Select member
  —", and 2359 does not pass over it to the first real member, as Chromium does and 2215 did. Admin
  now chooses that member itself (`admin-app.js`, v25.24), which changes nothing wherever the engine
  already did. Whether an iPhone's Safari does the same is not known, since Playwright's WebKit is
  its own build; the fix covers it either way. Four Admin tests failed on it, on both WebKit
  projects. With the new line removed (`scripts/mutate.mjs`) two of them fail again on 2359, and
  with it they pass.
- **And one test race.** Under 2359 the Links first-visit panel opens late enough to cover the
  burger in Overtime's every-page sweep, which closed it only if it was already up. `seedSession`
  now suppresses it alongside the Calendar's notices, and the one spec about the panel re-enables it.
- **And two measurements the tests had to learn.** On the iPhone project, 2359 hands back a STALE
  computed style for the Pay Calculator's `body` (the browser's defaults) from load until something
  restyles it, while the page on screen is navy and in Inter. Nothing in the app reads that value,
  so the typeface sweep now forces a fresh computation before it reads, and still fails on a page
  with no body font (mutation-checked). And the WebKit config's budget per TEST is now 60s, not 30:
  its longest flows were already at 22–26s on 2215 and run 10–50% slower on 2359, which is
  Playwright's own wait before each click on this engine, not the app (a Trains tab's handler and
  the next paint take 30–170ms on WebKit, as on Chromium). The 15s budget per assertion is untouched
  (`playwright.webkit.mjs` says why).
- **And one the CI had to learn, after the merge (v25.25).** The step that installs WebKit's system
  libraries reads its package list out of Playwright's dry run, and 1.63 changed that output from the
  apt command to a simulated install. Unread, the script fell back to the plain command: one clock,
  no resume. That is a fallback by design, but it became the only path every WebKit job took, and a
  slow mirror then killed two jobs on the tooling refresh before a single test ran.
  `install-browser-deps/install.sh` now reads both shapes and runs `apt-get update` first (the dry run
  reads apt's lists now), and `workflow-hygiene.test.mjs` feeds the real parser each one.
- **And one more, the same night.** The slower engine took the iPhone project's second shard,
  where the Links flows all fall, to up to 24 minutes of tests against its 25-minute step budget. A
  Dependabot run was stopped at that budget with every test it had run passing. The iPhone project
  now runs in four shards and desktop WebKit stays at two. The measurement is beside the job in
  `e2e.yml`, and `workflow-hygiene.test.mjs` fails if a shard or a project is left out of the list.
- **And the Links specs got projects of their own (12 Nov 2026).** Nine days later desktop
  WebKit's second shard was stopped at the same 25-minute budget twice on one PR, every test
  passing, on runners about 1.5× slower than that evening's other branch; the iPhone's third shard,
  the one holding all of `links.spec.js`, ran 21.5 minutes. Playwright cuts by count in file order,
  so a fifth iPhone shard would not have helped: the Links flows, 11% of the iPhone tests and 28%
  of their time, stay together. Each device now runs as two projects, the Links specs and the rest,
  each cut on its own: nine jobs, the longest about 15 minutes on that slow runner. The measurement
  is beside the job in `e2e.yml`. Two traps came with it, and `playwright.webkit.mjs` explains
  both: the rest is chosen by a pattern rather than by its own ignore list, because a project's
  `testIgnore` would REPLACE the shared one; and the touch gates read the project's NAME, so the
  iPhone twin is `mobile-…` and in the touch list.
- **And the iPhone's Links project draws at 2x (12 Nov 2026, the same day).** A Links test took
  10.6 s at the median on the iPhone against 1.3 on Chromium, and the cost was not the page: most
  Links tests open a desktop-size window, which at the iPhone's 3x density WebKit drew at 6.5–11
  frames a second, and every click waits on frames. At 2x it draws about 40. Nothing in the Links
  code or specs reads the density, so the project now runs at 2x and everything else stays the
  iPhone's: 4.4 minutes locally instead of 8.7, the same 165 passed and 8 skipped. The one
  departure from "the density stays the descriptor's" is argued beside `LINKS_IPHONE_DPR` in
  `playwright.webkit.mjs`.
- **1.64.1 since 4 Nov 2026, ahead of the containers.** This upgrade stopped at 1.63.0 because that
  is what the dev container carries, so a local run there needs no browser workaround. The owner
  asked for the remaining upgrades the next morning, and the WebKit lane is the only place Safari
  meets the app before a release, so it moved on without waiting: 1.64.1 brings Chromium 156 and
  WebKit 27.2. None of 1.64's breaking changes reach this suite: no app code reads `window.screen`
  (now taken from the device descriptor), nothing uses an iframe, and no run passes
  `--update-snapshots=missing`. **Until a container carries 1.64's browsers, a local run needs the
  environment's remedy**, as it did in a container that carried 1.56.1's Chromium
  (`/opt/pw-browsers/chromium-1194`, measured 3 Nov 2026): launch Chromium with
  `executablePath: '/opt/pw-browsers/chromium'`. A scratch config that imports the project's and
  sets it, giving `testDir` and the web server's `cwd` as absolute paths, is enough, and nothing in
  the repo changes; 1.64.1 ran two specs that way, on both Chrome projects, on the container's 1.63 Chromium. WebKit takes
  `npx playwright install webkit`, about a minute. The full Chrome binary also asks for
  `/favicon.ico`, which neither origin serves; the live check's reachability probe runs in a tab of
  its own so that request is never counted against a page (`e2e/live.spec.js`). CI and the deploy
  gate install their own browsers and need none of this.
- **Chromium 153 raises one new browser error under test.** It abandons the declarative page-to-page
  view transition (`@view-transition` in `shared.css`) when a test navigates mid-transition —
  "Transition was aborted because of invalid state" — as Android Chrome 152 already did on real
  phones, and the Error Log already ignores it (`client-errors.js`). Four smoke tests that assert no
  uncaught errors met it on the first run. `collectFatalErrors` (`e2e/helpers.js`) now asks the same
  rule, `shouldReport`, so a test fails on exactly what the app would log.
- **The 17 Pro descriptor is not used.** A descriptor is a viewport, a density and a user-agent
  string; the WebKit lane keeps the 13's under its 402×874 override, because a swap would change only
  the user agent's iOS number, which the app never reads (`playwright.webkit.mjs`).

Landscape (874×402, 956×440) is NOT in the matrix either, on purpose: Playwright's Linux WebKit
reports every safe-area inset as zero, so a landscape baseline would prove nothing about the Dynamic
Island insets the audit's B11 added, and the smoke suite's layout assertions are written for
portrait. A real iPhone in landscape is on the device checklist in the audit, not in CI.

### Every browser job is pinned to Ubuntu 24.04 (30 Oct 2026, v25.01; Playwright no longer the reason since 3 Nov)

GitHub's `ubuntu-latest` became **Ubuntu 26.04** in the last week of October 2026, and Playwright 1.56.1 supported
nothing newer than 24.04. On the new image `npx playwright install-deps` prints "Cannot install dependencies for
ubuntu26.04-x64" and **exits 0**, so the libraries step passed, and every WebKit test then failed at browser launch
(408 of 409 in one shard) — while Chromium happened to launch, and both visual lanes, drawn on 24.04, reported drift.
The nine jobs that start a browser now say `runs-on: ubuntu-24.04` (e2e.yml's smoke, webkit, csp, visual and
visual-webkit; the deploy gate in deploy-hosting.yml; live-health, offline and warm-browser-cache); the reason is
written once, on e2e.yml's smoke job.

**Deferred:**
- **Playwright 1.63.0 supports 26.04** (the repo's since 3 Nov 2026), so what holds the nine now is the baselines:
  they are drawn on 24.04, in a dev container that is 24.04. Move all nine together, as their own change, with every
  Chromium and WebKit baseline redrawn on the new image — from CI's own render, since nothing here draws 26.04's.
  One job left on 24.04 would test a browser the others do not.
- `install-browser-deps` still reports success when Playwright declines to install. Its fallback `exec`s the plain
  command, whose exit status is 0 here; a check that the browser launches would name the failure at the step that
  caused it, rather than four hundred tests later. `workflow-hygiene.test.mjs` pins the fallback's shape, so that is a
  change to the test as well.

### Playwright's WebKit crashed when a page left after two history entries and a Back (Oct 2026, v24.97; not in 2359)

The WebKit that Playwright 1.56.1 ran (build 2215, "Safari 26.0") **crashed its web process**
on a cross-document navigation made after two `history.pushState` calls and a `history.back()`. It
crashed on `assign` and `replace` alike, on both WebKit projects, here and on CI. The page never
committed. Playwright reported *"waiting for … navigation to finish"* until the assertion timed out,
and *"Target crashed"* after that.

**It is the test browser, not the app.** A standalone script reproduces it with no app code and no
test runner, on any page served over HTTP, through `page.evaluate`:

```js
history.pushState({}, '');
history.pushState({}, '');
addEventListener('popstate', () => setTimeout(() => location.assign('/b'), 300), { once: true });
history.back();
```

Chromium navigates, and so does WebKit after one push and a back, or after two pushes with no back.
**Playwright 1.63's WebKit (build 2359, "Safari 26.6") navigates every time**, measured three runs
out of three. Safari on a phone is not believed to share it, but nobody has checked on a device. To
check: Admin → change a row → ☰ → Calendar → **Leave**.

**Why the app meets it.** It is the shape of any exit taken from a dialog opened over the drawer:
the drawer's history entry, the dialog's entry, then the dialog closing. v24.97's "Leave" (Admin
asking before a drawer link drops staged edits) is the first such exit with a test.

**What a test does about it.** Stop the navigation at the network with `route.fulfill({ status:
204 })`, which every browser treats as "stay on this page", and assert the request Leave made. Prove
the destination in a second test that gets there without the dialog. `admin: a drawer pill or the
logo asks before leaving staged edits` and the test after it in `e2e/admin.spec.js` do exactly
this. **Never skip such a test on WebKit**: it is the lane's only view of the dialog, the drawer and
the guard on Safari's engine.

**Re-run on 3 Nov 2026 under the repo's Playwright 1.63.0: WebKit 2359 navigates, three runs out of
three.** The test browser no longer has the fault, so this entry stays only for the device question
above. The Leave test keeps its stop at the network: it is correct on either build, and letting the

### The Security section's introduction, as it stood

> **Forward plan.** The security work in this section is sequenced, with per-phase risk and
> rollback, in **`SECURITY_RELEASE_PLAN.md`**. The entries below remain the authoritative
> *post-mortems and rationale*; that file is the *ordering* that keeps a fix from re-creating the
> v10.94 outage.
>
> **TWO items are still deferred. FOUR have shipped, and this paragraph listed all six as pending
> until 19 Sep 2026** (external review). That is worth naming rather than quietly correcting: the
> entries below are detailed and current, so a stale *introduction* is the most misleading kind of
> staleness — it tells a reader the section is a backlog when most of it is a changelog.
>
> | | |
> |---|---|
> | **Still deferred** | **App Check** (Track D — declined as immediate, retained; see its entry below) · **password retirement** (Track C5, gated on the migration reaching ≥90% — `MAINTENANCE_CALENDAR.md` → Trigger points) |
> | **Shipped** | **Per-member write isolation** — strict since v16.29; the permissive `!('name' in token)` escape is gone from `firestore.rules` · **Named-session separation** — the Calendar closed to anonymous on 26 Aug 2026; a read needs a `name` claim (with the server-stamped `member` claim that matches it, since v24.27) or the `calendarViewer` capability · **Workload Identity Federation** — all four workflows authenticate by short-lived OIDC; no `FIREBASE_SERVICE_ACCOUNT` key exists (Appendix A2) · **The firebase-admin bump** — `functions/package.json` is on `^14.3.0` |
>
> The shipped four are listed by what a reader can CHECK rather than by a version alone, because
> that is what stops this row going stale again: each claim above is one grep away from being
> falsified.

### From "The document FILES are protected by a bearer URL, not by auth" — the dated paragraphs

**WHICH url, as of v24.19, depends on one IAM grant.** The three opening surfaces now ask
`getDocumentUrl` for a **15-minute signed URL** and open that. Without
`roles/iam.serviceAccountTokenCreator` on the runtime service account every call answers 503 and
they fall back to the **permanent tokenised `storageUrl`** in the Firestore document — which is the
state described throughout the rest of this entry, and the state the app is in until that grant is
made. The fallback is deliberate: a member must be able to open the document either way.

**Correction (v24.23 audit): the grant is very probably already in place.** RECOVERY_RUNBOOK.md
records `serviceAccountTokenCreator` on the shared gen-2 runtime service account for
`unlockCalendarViewer` — the 10 Aug 2026 outage was its absence — and `getDocumentUrl` runs as the
same account. So signed URLs are expected to be LIVE, which is what made the lapsed-link defect
(fixed in v24.23: the url is now checked at the tap) a live one. Since v24.33 a signed url is also
used only when it names the same file the page is holding (`storagePath`): an upload landing between
the page's read and the signing falls back to the document's own stored url rather than opening a
different document. Confirm by opening a document and
looking for `storage.googleapis.com` rather than `firebasestorage` in the opened address. What still
remains is rotating the objects whose permanent URLs are already in circulation.

Consequence, stated plainly because no other doc says it: **tightening the Firestore read rules would
not put these documents behind authentication.** It would change who can *discover* a URL; anyone who
has ever held one — a forwarded link, browser history, a synced bookmark — keeps access until the
object is deleted, and revocation requires rewriting the object, not editing a rule.

**BUT NOT FOREVER, AND THE DOCUMENTS SAID FOREVER UNTIL 19 SEP 2026.** Both retention sweeps
DELETE the Storage object, which is what actually kills a bearer URL: **Huddles at 3 months**
(`pruneOldHuddles`, server-side in `functions/documents.js`), **Circulars and Newsletters at 6
months** (`pruneOldDocs`, browser-side in `doc-retention.js`). So a leaked URL is bounded by the
retention window, not unbounded — which materially lowers this finding's priority and was worth
getting right in both directions.

### `docs/AL_WORKBOOK.md` publishes named colleagues' leave figures (found 16 Sep 2026, deep review)

**Status: ACTED ON, 19 Sep 2026 (v24.15) — the per-person record no longer ships.** It had been
*"recorded, owner's decision"* since 16 Sep; an external review raised it again, the exposure was
re-measured and confirmed live (`200` on the Pages mirror, `404` on Firebase, whose ignore list
covers `docs/`), and the split was made rather than re-recorded.

**What moved and what stayed.** Section 12 — the reconciliation log, roughly fifty dated entries
naming colleagues against days taken, days remaining and one reason for absence — is now
`docs/AL_WORKBOOK.local.md`, gitignored. Everything else stayed: the method, the four cell states,
the workbook's own defects, and the worked examples, which keep every figure and now read
*"a member"*. The remaining names in the committed file are a workbook-spelling ↔ app-spelling
map carrying no figure at all, and both spellings are already public by the deliberate
classification in `AUTH_PLAN.md` §2.

**This entry used to quote the worked example verbatim, name included** — so the record of the
problem reproduced it, on the same mirror, for three days. That was found by the guard written in
the same change (`payroll-anonymity.test.mjs` now scans for a roster name beside a LEAVE BALANCE as
well as beside a payroll term), which also found two more: a leaver's final-leave arrangement in the
world-readable `roster-member-data.js`, and a name beside the word "sickness" in an illustrative
code comment. Both are fixed. A guard that finds three offences on its first run is the argument for
writing it.

**Two things this did NOT do.** The log is still in git HISTORY — exactly as the payslip fixture is,
two entries up — so this stops it being SERVED, not published; rewriting history is the owner's call
and has not been taken. And a fresh checkout no longer carries the log, so a session in a new
container starts without the accumulated reconciliation history: a real cost to the `/al-workbook`
workflow, accepted deliberately and reversible by un-ignoring the file.

Two things make it worth recording rather than assuming it is inside an existing decision:

- **The public classification was reasoned about SHIFT PATTERNS** — *"shift patterns are on the
  station's own printed rosters"* (`AUTH_PLAN.md` §2). A leave balance is not on a printed roster,
  and it is a different class of personal data about a third party.
- **`public-data-classification.test.mjs` still does not inspect `docs/`.** It covers
  `roster-data.js`, the other world-readable surface, and nothing about this change altered that.
  What DID change is that `docs/` is no longer unguarded: `payroll-anonymity.test.mjs` scans the
  whole tracked tree, Markdown included, for a roster name sitting beside a payroll term or a leave
  balance. **Know what that does and does not promise.** It catches this class — a NAME next to a
  FIGURE — which is the class that went wrong. It is not a classification guard: a new personal
  field in a doc that never names anybody passes it, and so does a name beside something neither
  vocabulary lists. The gap this bullet was written about is narrowed, not closed.

The document's VALUE is its rules — how a quota grid is read, where the app and the spreadsheet
legitimately disagree — not who the worked examples are about. **That anonymisation was done, in
this same change** (v24.15): every worked example keeps its figures and now reads *"a member"*, and
the §7 mismatch table lost its figures column. This paragraph previously said it had NOT been done
and left it as a judgement for the owner — true when it was written, and stale from the moment the
change landed. The judgement that remains the owner's is the one above: whether to rewrite git
history, which is what would remove the old copies.

### From "Admin/manager password is surname-derived (F-SEC-1)" — the shipped partial remediation, and the July status

**Partial remediation SHIPPED (v18.63) — PASSWORD_DESIGN.md Phase 0+1.** Every account (admin/manager
included) can now **set its own real secret** in Settings → Password; sign-in accepts the typed
password and only falls back to the surname while the account is still on the default. So the specific
"guessable admin/manager password" exposure is **closable today by the owner simply setting their own
password** — the targeted admin/manager fix scoped above is effectively subsumed by the general
capability (no special-case login branch needed). It is **not automatically closed**: the surname
default stays valid until each account sets a password, and the surname is not *retired* (C5) until the
≥90%-migrated gate. So treat this as "the fix is now available and one action away", not "resolved for
all accounts". Migration progress is visible in Operations → Account status.

**Status update (25 Jul 2026, owner-reported — not independently verified in-repo).** 2 accounts had
migrated in the first 24 hours, **one of them the owner's**. So the specific exposure this entry is
about — a guessable *master admin* password, the highest-value target in the app — **is closed in
practice**. What remains open is the **management accounts**, which can write any member's
AL/absence/shifts on behalf; a staff account, by contrast, can only write its own overrides (the B3
isolation rule holds), so its blast radius is one person's roster. Chasing those six needs no code —
it is six people opening Settings → Password, and it closes the large majority of what is left.
Verify against Operations → Account status rather than taking this paragraph's word for it.

### Huddle Firestore writes restricted to admin (v11.07)
`firestore.rules` now requires `request.auth.token.admin == true` for all browser
create/update/delete on the `huddles` collection. Prior to v11.07, any signed-in staff
member could alter huddle metadata (storageUrl, fileType, htmlContent) even though
Storage rules prevented them from uploading files. The two rules now match: both Storage
and Firestore require admin claim for huddle writes. Cloud Function writes via Admin SDK
bypass rules and are unaffected.

### A signed-in session lasts 60 days regardless of use (v20.41 + v20.47 — accepted trade)

Two owner decisions, one direction. At **v20.41** the 7-day inactivity cutoff was removed: `SESSION_MS`
(absolute, set once at sign-in) became the only clock, and the `IDLE_MS` constant, the `lastActivity`
timestamp and the write-back inside `getSession()` went with it rather than being left dormant. At
**v20.47** that clock was doubled, **30 days → 60**, on the same reasoning as the removal — the
absolute bound is not what protects an account (below), so its length is a UX dial.

**Existing sessions are not migrated, and no `SESSION_VER` bump was made.** `expiry` is stamped once
at sign-in, so a session created before v20.47 keeps its original 30-day date and picks up the longer
term at its next sign-in. Migrating them would mean writing on read — precisely the behaviour v20.41
removed — and bumping the version would sign every member out, which is the opposite of the intent.
So the change arrives gradually, per member, which is also how it should be reviewed.

**What it makes worse, and what reads FROM this number.** Two things downstream are derived from the
session length rather than owning their own clock, and both get further away as it grows:

- **The forced password migration** (`CONFIG.FORCE_PASSWORD_SET`, PASSWORD_DESIGN Track C) is driven by
  sign-ins, so full coverage now takes up to 60 days instead of 30 — the C5 exit metric converges
  half as fast.
- **Operations → Usage, "Accounts that have signed in — last 30 days"** used to be a slight
  *over*-count of active people, because a live session required a sign-in inside 30 days. **That
  inference is now dead and the error runs both ways**: someone can sign in once and use the app
  daily for two months without re-entering the window. The card's visible note already says only
  "counts sign-ins, not opens", which stays true; the reasoning beside `_appendSignInSection` states
  the new direction. Do not restore an active-people claim unless the window is derived from
  `SESSION_MS`.

The iOS ITP window below widens with it too — from about three weeks to about seven.

**What this does not change.** Every path that genuinely REVOKES access is immediate and was never
the idle clock's job: an explicit sign-out (`clearSession`, which signs Firebase out too), a disabled
or deleted Firebase account, revoked credentials, and the `CLAIM_EPOCH` sweep. The **Calendar
viewer** is untouched — it is not a member session, holds no `name` claim, and its persistence is
session-only, so it ends when the browser session does.

**What it does change, stated plainly.** A LEAVER whose device still holds a local session keeps the
signed-in *UI* for up to 60 days instead of up to 7. That was never the control it looked like: the
real remedy is Operations → Set up accounts → "Disable accounts for leavers", and once an account is
disabled the ID token stops refreshing (≤1 hour) and every authenticated read and write fails. The
Admin page independently blocks a signed-in name that is no longer a selectable roster member
(v16.21). So the exposure is bounded by the account disable, not by our localStorage timer — which
is why lengthening the timer is a UX change, not a security one.

**One interaction to expect on iOS, found while reviewing this change.** `decideAccess` grants
`named` only when a live local session is backed by a **restored Firebase identity** — both halves,
because either alone is a real failure (see `calendar-access-core.js`). iOS ITP evicts IndexedDB
after roughly **7 days** of no PWA use, which is where the Firebase identity lives. Until now the
7-day idle cutoff aged out at about the same moment, so the two expired together and the member
simply saw a login. With the cutoff gone, an iPhone user who does not open the app for a fortnight
can hold a valid local session with **no restorable identity** — a state that previously lasted
about a day, became up to three weeks at v20.41, and is up to **seven weeks** at v20.47 now the
session runs 60 days against ITP's unchanged 7.

Since v20.51 (`CONFIG.CALENDAR_PIN_ACCESS: true` — v20.46 released it, v20.50 rolled it back; the switch was retired v24.34) this is **live behaviour, not a future one**:
that member gets the member sign-in card ("This device needs to sign you in again…") instead of their
roster, despite being signed in — never the PIN. A silent re-sign-in is tried first, and one tap on
"Sign in" re-establishes the identity, so it is recoverable rather than a lockout — but it will
generate a support question, it will land on iPhone users specifically, and it is worth expecting
rather than diagnosing.

**Why removed rather than lengthened.** A policy left in place with no effect is the thing a later
reader "restores" on the assumption it was load-bearing. `session.test.mjs` pins the replacement
properties instead: a long-untouched session inside its window is still valid, a pre-v20.41 session
carrying the old field is accepted and the field ignored (no `SESSION_VER` bump, so nobody is signed
out by this change), a read leaves the stored session byte-identical, and a newly-written session
contains exactly `name`/`ver`/`expiry`.

### Firebase Auth session is re-established on page load (v10.93)
A returning user with a valid 60-day localStorage session skips the login click handler on
every subsequent open, which would leave `auth.currentUser` null and break all Firestore
writes. Fixed in v10.93 by `ensureFirebaseSession()`, which runs on page load whenever a
localStorage session exists (waits for `onAuthStateChanged` — at most 20s since v24.38 — and signs
in if none found). The client-side account self-heal and the anonymous fallback were removed at
v24.34: a failure now resolves to no session and a sign-in prompt. Full description and the "do not
remove this call" rule:
**CLAUDE.md → "Firebase Auth (complete — v7.94)"**.

### ⏰ The four v11 security tasks — current status

Originally pencilled in for v10.50, deferred to v11. Current status:
**#1 done** (with a critical allowlist caveat — see below) · **#2 SHIPPED strict at v16.29**
(was suspended after the v10.94 outage; rebuilt as B2 v14.53, hardened to strict B3 v16.29) ·
**#3 done** · **#4 done** (verified live 27 June 2026).

**1. Firebase web API key — restrict to HTTP referrers ✓ DONE (May 2026) ⚠️ SEE NOTE**
The key is visible in page source (normal for client-side Firebase). Without a GCP referrer
restriction it could theoretically be used to brute-force Firebase Auth from any origin.
**Applied manually in GCP Console:** APIs & Services → Credentials → Firebase web API key →
HTTP referrer restrictions set to `myb-roster.firebaseapp.com/*` and `myb-roster.web.app/*`.
Verified with curl: 403 for requests without a `Referer` header, 403 for a bad origin
(`evil.com`), 400 (reached Firebase — key accepted, credentials invalid as expected) for the
correct origin (`myb-roster.web.app`). Restriction is working correctly.

**⚠️ CRITICAL — all served domains must be in the allowlist (v10.95):**
In May 2026 the referrer restriction was found to be blocking **all** Firebase Auth calls
from `garethdavidmiller.github.io` — the domain staff actually use — because only the two
Firebase-issued domains were added to the allowlist, not the GitHub Pages / custom domain.
Every sign-in attempt threw `auth/requests-from-referer-...-are-blocked`, making every
Firestore write fail silently for all users.

**Fix:** In GCP Console → APIs & Services → Credentials → Firebase web API key, add every
domain the app is served from. Current allowlist must include:
- `myb-roster.firebaseapp.com/*`
- `myb-roster.web.app/*`
- `garethdavidmiller.github.io/*`

If you ever add a custom domain, add it here too — or ALL Firebase Auth and API calls
will silently fail for users on that domain, with no visible error in the app UI.

**2. Firestore security rules — member write isolation ✅ SHIPPED, strict (B2 v14.53 → B3 strict v16.29)**
> **Status update:** the original suspended isolation was reintroduced the *cautious* way as
> phase **B2** (`SECURITY_RELEASE_PLAN.md`), then hardened to the **strict B3 form at v16.29**.
> `overrides` create/update/delete now require
> `memberName() == memberName || admin || manager` (the bound name since v24.27 — a raw `token.name`
> comparison was its form until then) — the `!('name' in token)` no-name/legacy
> escape has been **removed**. The two v10.94 root causes were both fixed years ago (the `name` claim is
> set for everyone by `setupRosterAuth`; the page-load Firebase session is reliably established via
> `ensureFirebaseSession`, B1). B2 first avoided the original outage by (a) an interim `!('name' in token)`
> escape so no legacy/anonymous token was hard-rejected, and (b) adding the **`manager` tier** the original
> lacked — the managers edit staff data on behalf and would otherwise be locked out. B3 (v16.29) then
> dropped the escape and went strict, after the CLAIM_EPOCH=2 token sweep + manager re-provision; stale
> tokens self-heal via `writeWithClaimRetry`, so no mass sign-out was needed. Emulator-tested (tier matrix
> + delete + date bounding, all green). The historical post-mortem below is retained for context.

Originally implemented in v10.72 (`firestore.rules`). Per-member write isolation required
every write to carry a custom JWT claim (`request.auth.token.name` = memberName,
`request.auth.token.admin` = true for G. Miller), set server-side by `setupRosterAuth`.

**Why it was reverted (v10.94):** Two cascading bugs caused a full production outage:

1. **setupRosterAuth bug (v10.88 fixed):** The Cloud Function only ever set `{ admin: true }`
   for G. Miller — it never set the `name` claim for anyone. So every staff member's
   writes failed the isolation check, not just non-admins.

2. **Page-load Firebase Auth session bug (v10.93 fixed):** The Firebase Auth sign-in only
   ran inside the login click handler. A returning user with a valid 60-day localStorage
   session never hit that handler, so `auth.currentUser` was persistently null — breaking
   both the Firestore writes (no session at all) and the "Set up accounts" button needed to
   fix the claims. A classic deadlock.

With both bugs fixed, the claims path could technically work. However, it still requires
a multi-step manual recovery (Set up accounts → sign out/in → Set up accounts again →
all staff sign out/in). During an active outage, that fragility is unacceptable.

**Current state (v10.94):** Rules reverted to `request.auth != null` — any signed-in
staff member may write, matching the pre-v10.72 model that ran without incident for
months. Field validation (type whitelist, size limits, required keys) is still enforced
for data integrity.

**To re-introduce (RE-INTRODUCED as B2 v14.53, then shipped STRICT as B3 v16.29):**
- Confirm `setupRosterAuth` reliably sets `name` claims for all staff (v10.88 fixed this)
- Confirm page-load Firebase Auth session is reliably established (v10.93 fixed this)
- Re-add the per-member claim checks to `firestore.rules`
- Deploy rules and run "Set up accounts" to ensure all tokens carry the claim
- Test that every staff member can write their own overrides before deploying to prod

**3. HPP variable-pay split — which pay accrues the Holiday Pay Premium**
Only genuinely-VARIABLE pay accrues HPP: overtime, RDW, Sunday, Saturday, bank-holiday and
Boxing Day premiums. **Basic pay and London Allowance do NOT accrue HPP** — London is a fixed
allowance paid every period (including while on leave), so it needs no holiday premium.
**✓ Code now matches this rule (v17.23):** London was wrongly folded into the HPP base at
v16.90 and has been removed from `_varPayForPeriod`; the HPP estimate no longer includes it
(owner-confirmed; the annual HPP lump appears as its own payslip line, separate from London
Allowance). The per-category back-pay itemisation was confirmed from a period 32
(Oct 2025) payslip (each line carries a `(Back Pay)` suffix). (History: back pay's variable
portion was briefly added into HPP at v10.73, then removed at v16.89 as a double-count — see
"Back pay lump sum vs HPP" below.)

**4. Pay reminder push notification — ✓ DONE (verified live 27 June 2026)**
`sendPayReminderNotification` did not fire on 30 May 2026 because the Cloud Scheduler job
had never been created. Root causes (both fixed in May 2026):
- The `FIREBASE_SERVICE_ACCOUNT` lacked `roles/cloudscheduler.admin` — deployment failed
  silently trying to manage the scheduler job. (Historical: that SA JSON key + GitHub secret
  have since been **retired** — all deploys now use Workload Identity Federation; see
  SECURITY_RELEASE_PLAN.md → Appendix A2. The scheduler perms now attach to the WIF
  `github-deploy@` service account.)
- A stale `us-central1` deployment record blocked redeployment (the function had initially
  deployed to us-central1 before the region was set to `europe-west2`). Deleted manually
  from Firebase Console, then redeployed cleanly.
The Cloud Scheduler job `firebase-schedule-sendPayReminderNotification-europe-west2` now
exists. A force-run on 31 May confirmed the function executes and correctly skips on
non-cutoff days (`[payReminder] Not a cutoff date — skipping`).
**✓ Verified live on Saturday 27 June 2026** (cutoff for the 3 Jul payday): the reminder
push arrived on a real device. The full scheduled path — Cloud Scheduler trigger →
cutoff-date detection → fan-out — now works end to end. All four v11 security tasks are
now resolved (#1 done, #2 shipped strict v16.29, #3 done, #4 done).

### From "Deep-review residuals (July 2026)" — the select bullet as it stood, and the two items that closed

- **A native `<select>` has no deterministic height until you give it one** (found v22.93, fixed for
  the calendar's member select only). `line-height: normal` on a `<select>` resolves from the font
  the control is laid out with, and the calendar's measured **17px on most loads and 20px on some**
  — a 41px vs 44px control — on identical code, one browser, one container. Everything below it then
  sits 3px out. It surfaced as a visual-baseline flake that cried wolf on two unrelated pull
  requests (#1366, #1369), and the two committed baselines of the same control had been captured in
  DIFFERENT states, so they disagreed with each other.
  **The exact trigger is not pinned down.** A font-load race was the obvious candidate and was
  disproved: with the font blocked entirely the height did not change, and at the moment the
  screenshot is taken `document.fonts.check('16px Inter')` is true on the runs that fail as well as
  the ones that pass. What is established is the DEPENDENCY, and stating a line-height removes it.
  **This has since been DISSOLVED for almost every control it named, not fixed** (v23.33–v23.38,
  restated at the v23.40 sweep). The paragraph used to end "every other `<select>` in the app still
  has `line-height: normal` — admin's member pickers, paycalc's period selector, the operations
  dropdowns", and every one of those is now enhanced by `select-sheet.js`: the `<select>` is a 1px
  invisible value holder and the control a reader sees is a `<button>`, which has no `<select>`
  height behaviour to be non-deterministic about. Following the old text would have sent somebody
  to add `line-height` to controls that are not rendered.
  **What survives is the shape, and it applies to the selects that are native BY DECISION** —
  the month-jump pair, Overtime's disabled identity bar, Admin's two hidden member value holders
  and the Links generator's per-slot times (`select-sheet-parity.test.mjs` holds the list with each reason). None
  has been measured and none carries a tight visual baseline, so the same one-line fix is available
  and is still not worth moving pixels for. The general lesson is the one to keep: a native
  control's box is the platform's, and the app only stops depending on that by not using it.

- **~~A late-resolving sign-in can briefly strand a privileged Firebase identity~~ — CLOSED at
  v24.38.** A `signInWithEmailAndPassword` that resolves *after* an 8 s login timeout / `clearSession`
  used to leave `auth.currentUser` signed in until the next launch — Firebase sign-in is not
  cancellable mid-flight. `ensureFirebaseSession` (`session.js`) now signs such a request straight
  back out when a `clearSession()` was the last thing that happened; a newer sign-in attempt that
  superseded it is left alone. `reconcileExpiredIdentity()` stays as the page-load backstop.

- **~~Concurrent Huddle ingest can leave a stale notification deep-link~~ — no longer reachable.**
  Two Power-Automate runs for one date still send one push (the transaction closes the check-then-act
  race), but the push carries only `/#huddle` and the viewer opens whatever Huddle is current at the
  tap, so a deleted object cannot be what it links to. What remains is an OPEN viewer holding a link
  that has since been superseded.

### From "The App Speed card's "First appears" cannot mean the roster" — how the third milestone came about

That mattered more than it looks once the v20.12 access gate landed, because the OTHER milestone was
`domReady` and it drifted too: DOMContentLoaded is when the module scripts finish, and the access
decision is asynchronous, so it can fire while the Calendar is still blank. Measured with the auth
restore held at 2s — first paint 512ms, scripts done 669ms, **roster on screen 2630ms**. A card
reading "fully ready in 669ms" was describing a load that took four times that.

v20.80 added a third milestone, **Usable**, marked by the page itself when its own content is on
screen, and relabelled `domReady` to "Code loaded" so nothing claims to be the answer that is not.

### Two card-collapse systems (v18.87 aesthetic pass) — owner decision, not drift-by-accident

paycalc's six collapsible cards animate open (`.collapsible-body` + `.card-toggle-arrow`, a `max-height`
reveal) while admin/operations/settings/links use the shared `.card-collapsible-body` +
`.collapse-chevron`, which is `display: none/block` — instant. Same interaction, different feel
depending which page you're on. The v18.16 pass promoted paycalc's card HEADER to `shared.css` as
the canonical one but left the BODY behaviour per-page, which is how the split survived.

Left as-is because converging it is a design choice, not a bug fix, and both directions cost
something: making the other five animate inherits the `max-height` reveal's weakness (it eases
toward a fixed ceiling, so short cards finish early and the easing reads wrong), while making
paycalc instant removes a nicety staff already have on the page they use most. Worth an explicit
decision rather than a silent sweep. What WAS fixed at v18.87 is the drift inside paycalc's own
animation: height ran 0.4s against its own padding at 0.3s, so the last 100ms of every card opening
was height-only; all three now share `--dur-slower`.

**Two more from the v18.84 sweep — real code paths, deliberately NOT changed** (the fix costs more
risk than the defect):

- ~~**A retry can run a second authoritative reconciler over a month another fetch already owns.**~~
  **CLOSED at v20.44** — kept below as the record; an external review (Oct 2026) found this entry
  still reading as open. Every authoritative read now takes a sequence number when ISSUED and may
  reconcile only the months no newer read has written (`_monthOwner` in `calendar-overrides.js`;
  `CALENDAR_DATA.md` invariant 5), so the late, staler F1 below can no longer evict what F2 loaded.
  `calendar-overrides.test.mjs` drives exactly that interleaving.
  `doRetry` (`calendar-initial-fetch.js`) re-claims all three initial months and reconciles the whole
  range. Reachable only as: initial fetch fails → its catch releases the months → a render/swipe
  calls `ensureOverridesCached` for one of them (claiming it, fetch F1) → the user taps the retry
  chip (fetch F2). Both are authoritative for the overlapping month, so if F1 resolves later with a
  staler snapshot it can evict an override F2 just loaded — the class of bug removed from Team View
  at v18.76. Left as-is: the window is one Firestore round-trip inside a three-step failure sequence,
  the next fetch heals it, and the alternative (routing the retry through `ensureOverridesCached`)
  would rewrite a delicate chip state machine whose success/failure signalling depends on awaiting a
  single range fetch. Revisit only if it is ever seen in the wild.

### From "Firebase App Check — declined as an immediate action, RETAINED as Track D" — the reconciliation note, and "when to revisit" as it stood

> **⚠️ This section and `SECURITY_RELEASE_PLAN.md` → Track D read as contradicting each other, and
> were written in the SAME COMMIT** (`a7e8bbf`, 16 Jul 2026) — so neither superseded the other; the
> two framings were inconsistent from birth. "Declined" reads as closed; Track D reads as queued.
> **The reconciled position: App Check is NOT closed. It was declined as an immediate action and
> kept in the security plan as Track D, sequenced last.**
>
> The two are compatible once read that way, and Track D directly answers the objection below that
> caused the decline: **monitor-first** (D1 log-only, watch for legitimate-but-unattested traffic,
> register every domain and debug token, then enforce one product at a time) exists precisely
> because the silent-failure risk is real. The third objection stands unchanged in both places —
> App Check gates *which clients* connect, not *what an authenticated client may read*, so it would
> add nothing to the `overrides` read boundary, which has required a member or the PIN's
> `calendarViewer` capability since 26 Aug 2026 (`firestore.rules`).
>
> The Aug 2026 external review recommended App Check for the telemetry and reset-request paths,
> which is the same "defence-in-depth, sequenced last" position rather than a new argument.
> **`SECURITY_RELEASE_PLAN.md` → Track D is authoritative for whether and when.** What follows is
> the reasoning for the deferral, which is still the reasoning.

**When to revisit:** if the app is advertised more widely or becomes official Chiltern
infrastructure. Of the deferred security work, per-member write isolation (task #2 above) had
the higher real value and has now **SHIPPED strict at v16.29** (B3). Its old blocker — the
Firestore emulator test suite (ROADMAP_HISTORY.md → Maintainability roadmap, Phase 7) — was put **in place** (`firestore.rules.test.mjs`
+ `storage.rules.test.mjs`, run via `npm run test:rules`, gating `deploy-rules.yml`), letting the
rules change be tested before shipping. The old operational-fragility barrier (the multi-step claim
recovery that caused the v10.94 outage) was resolved by shipping after the CLAIM_EPOCH=2 sweep +
manager re-provision, with stale tokens self-healing via `writeWithClaimRetry` — so no mass sign-out
was needed.

### From "The installed PWA masks live-site breakage" — the June 2026 root cause

**Root cause of the June 2026 splash outage (fixed v12.34):** `firebase.json`'s
hosting `ignore` list contained `**/*.mjs` — intended to skip the `*.test.mjs`
test files, but it also dropped the **runtime** `purify.es.mjs` from every
Firebase deploy. The import is static (`index.html → calendar-app.js → calendar-huddle-viewer.js
→ import './purify.es.mjs'`), so the 404 broke the whole module graph and the
splash never cleared; it also failed the SW precache (`purify.es.mjs` is in
`CORE_ASSETS`). Fixed by narrowing the ignore to `**/*.test.mjs` + `generate-sri.mjs`.
**Lesson:** any deploy-ignore pattern must exclude *only* dev/test files — never
match a file the app imports at runtime. When adding a new runtime asset with a
test-like or tooling-like extension, confirm it is not caught by an `ignore`
glob in `firebase.json`.

### A blank weekday is safe only while the AI reports it as blank (v22.25) — residual, and it is the geometry programme's case

**What is fixed.** v22.19 established the domain rule from three real rosters — a blank cell is an
ANSWER on Sunday (the uncontracted column; its blank is how the sheet says "not working") and a
QUESTION every other day, because Mon–Sat unworked days are always stated explicitly (RD, AL, SC,
SN, OD, HA, ML, CL, NA). `buildSafeEntries` implements exactly that, and until v22.25 it was **dead
code**: the prompt told the model "a blank cell = RD" in three places, so an obedient model returned
an explicit `"RD"`, the key arrived present and non-empty, and the fail-closed branch never ran.
Reproduced through the real helpers — five physically blank weekdays became five explicit Rest Days
with nothing warning. Found by external review, 1 Sep 2026. The prompt now asks for a `BLANK` token
and forbids the model from interpreting it; `roster-prompt-parity.test.mjs` stops the instruction
coming back.

**What is NOT fixed.** The safety now rests on the model doing as it is told. If it writes `"RD"`
for a physically empty weekday anyway, nothing downstream can distinguish that from a printed RD,
and the day imports as a rest day.

**A cross-check on the column scan was built to close it, and refused.** The obvious hardening is to
ask the other pass: if the column scan saw an empty weekday where the row read printed a rest day,
flag it. It was implemented and the existing fixtures rejected it, correctly. One real CES row scans
as `['blank', '06:00-14:00', 'OFF', 'blank', '07:00-15:00', '-', 'blank']` against a row read of
`OFF` for every one of those days — the scan uses `blank`, `OFF` and `-` **interchangeably for the
same kind of cell, inside one row**. So a scan `blank` is not evidence the cell is physically empty,
and the rule would have flagged ordinary rest days across a whole CES roster. The test that caught
it is named for preventing exactly that flood.

**So the column scan cannot be the independent witness**, and neither can the row read or the Sunday
scan — all three are one model looking at one PDF in one call. The witness this needs is the PDF's
own text geometry, where cell occupancy is a physical fact the model cannot influence. Until that
lands the residual stands, bounded by the review table: every import is shown to an admin first.

**The geometry corpus test is now DONE (1 Sep 2026), and it moved one of the numbers.** 12 real
documents — 3 roster types × 3 week-endings, draft and final — extracted through
`experiments/roster-pdf-geometry`. Zero pages failed to carry the 9-column grid, including the
drafts, so the structural prerequisite for promoting geometry from witness to authority is met. The
domain figures, measured from the PDF's own text positions rather than from any model:

- **blank Sunday: 111 of 207 rows (54%)** — ordinary, as the rule assumes.
- **worked Sunday with no RDW marker: 80, against 1 with** — decisive confirmation that removing the
  v22.16 "unmarked Sunday must be RDW" rule at v22.19 was correct.
- **blank Mon–Sat: 49 cells in 1,242 (3.9%)** — and the DISTRIBUTION is the finding. CEA 1 in 678,
  Supervisors 0 in 240, **Dispatch 48 in 324 (15%) across four people** (S. Horsman 19, S Faure 18,
  P. Prashanthan 6, F. Mohamed 5).

The earlier single-week reading — "5 blank Mon–Sat cells, all one person" — was not wrong, it was
unrepresentative. **The consequence is a live one**: the v22.19 rule was dead code until v22.25 made
it reachable, so nobody has yet seen what it does at volume. On CEA and Supervisors it will send one
cell in 918 to review. On **Dispatch it will be roughly a dozen rows per import on a 14–16 row
roster**, because those four people appear on that sheet and work most of their week elsewhere —
which is precisely the case the rule exists for, since writing RD across them would overwrite what
their primary roster's import had just written. The rule is right; the friction is real and is
mitigated by the v22.17 in-place entry control, which lets each row be answered without leaving the
page — and by v22.50, which made that true in practice: until then, opening the control or picking a
type re-rendered the whole review and threw the reader back to the top, so a dozen rows meant a dozen
scrolls back down. **Worth watching on the first live Dispatch import** — if it proves tiresome, the question to
ask is whether a member whose row is blank Mon–Sat on a SECOND sheet should be skipped wholesale
rather than cell by cell. That is a product decision, not a bug.

**Do not rebuild the cross-check on the column scan.** The reasoning is repeated in
`applyColumnScanCrossCheck`'s own header, beside the code, so it is met by whoever tries.

**The geometry witness is now live (v22.31, `functions/roster-geometry.js`), and it closes PART of
this — say which part.** It refuses any AI day that lands in a physically EMPTY cell, which is the
blank-Sunday collapse in full: a duty slid into an empty Sunday is refused, the cell is UNREADABLE
and the row starts unticked. **It does not close the residual above.** An `RD` written for a
physically empty weekday is exactly the value an empty cell is consistent with, so occupancy cannot
refute it — distinguishing a printed RD from an empty cell from a printed duty means READING the
text, which is phase 3 of the ROADMAP's plan. Nor can the phase-1 witness see a shifted row whose week is fully
occupied (nothing empty to contradict); since v24.04/v24.12 the geometry path (phase 2) assigns days
by coordinate so such a row cannot shift, and `assessRosterAlignment` covers the legacy fallback path. Both limits are
stated in the module header and pinned by its tests rather than left to be discovered. **One case of
the first limit is closed on the geometry path** (whole-app review, Oct 2026): a cell the model reports
EMPTY while the grid holds text in it goes to the review naming that text
(`reviewBlankReadsOfFilledCells`, `functions/roster-prompt.js`) — before, a worked Sunday read that way
became a rest day and was never shown. A cell the model reads as `RD` when it prints a duty is still
phase 3.

### `firebase-tools` → `gaxios` dev-only advisory — no clean forward fix (F-DEP-1, reviewed v17.74)

> **Superseded as a count by "Development-tool advisories that only a downgrade would clear"**
> (v24.50, near the top of this file), which records what `npm audit fix` and the grpc-js override
> cleared and what is left. Since that pass the remaining entries sit under `firebase-tools` and, since v25.25, ESLint's own packages;
> before it, a second path ran through `@firebase/rules-unit-testing` (its Firestore's grpc-js pin),
> which this section never named. The reasoning below about `gaxios` is still current.

`npm audit` at the root reports a set of advisories that are **all dev-only**, reachable through
**`firebase-tools`** (root `devDependency`, `^15.34.2`, resolving to 15.34.2 in the lockfile). The original and still the
awkward one is a transitive `gaxios` in the **6.4.0 – 6.7.1** range.

**Do not trust a count written down here — run it.** This paragraph said "5 moderate, all one root
cause" from v17.74 until 28 Aug 2026, by which point the real figure was **16 (1 low, 10 moderate,
4 high, 1 critical)** across sixteen packages — `tar`, `brace-expansion`, `fast-uri`, `ip-address`,
`js-yaml`, `hono`, `undici` and others had joined, and "one root cause" had stopped being true. A
transitive dev tree moves on its own, so a number recorded in prose is stale from the day after it is
written.

**Impact: none in production.** `firebase-tools` is a **dev/CI-only** tool (Firebase emulators +
deploy) — it is **never bundled or served** to staff. The app ships no npm dependencies at all
(vanilla JS, no bundler); this advisory cannot reach a user.

**Why it is not "fixed" yet — the only npm fix is a *downgrade*.** The advisory is patched in
`gaxios@7.x`, but the latest `firebase-tools` of the time (15.24.0) still declared `gaxios@^6.7.0`, which
resolves *within* the vulnerable range. `npm audit fix` therefore offers only
`firebase-tools@14.23.0` — a **semver-major downgrade** that moves the toolchain backwards and is a
breaking change. That is a worse position than the current moderate dev-only advisory, so it is
**declined**.

**Why not force it with `overrides`.** A root `"overrides": { "gaxios": "^7.2.0" }` would clear the
audit, but `gaxios` 6→7 is a **major** API change and the 6.x copy is required by an intermediate
Google dependency that expects the 6.x API — forcing 7.x risks breaking the **deploy/emulator
toolchain** (which gates every rules/hosting deploy). Not worth that risk for a moderate dev-only
advisory. (Contrast the `uuid` override `functions/package.json` carried until v25.35, which was safe because
that pin stayed within a compatible range, and went once nothing depended on `uuid` at all.)

**When to close:** once `firebase-tools` widens its `gaxios` range to include `7.x` (or its
intermediate Google deps do). Re-check with `npm audit` / `npm outdated` periodically; bump
`firebase-tools` then and confirm `npm run test:rules` + a hosting-emulator run still pass.

### From "Links design workspace — accepted constraints" — the 24-line period, and three items since settled

- **SUPERSEDED at v24.47: the rotation is now 26 lines with 5 cover weeks** (owner, 1 Oct 2026; rules in `docs/links-26/RULES.md`). The entry below is the history of the 24-line period, kept for its evidence-class reasoning.
- **The rotation was 24 lines with 4 spare weeks, on evidence class C (v19.98, corrected v20.01/02).**
  The December 2026 link is the CEA/main roster widened from 20 and excludes the bilingual roster
  entirely — not its lines, not its shift times, not its work. All of it is **owner-relayed**
  (Aug 2026), with **no document behind it**; the length was given as 22 at v19.98 and corrected to
  24 at v20.01, and a fifth spare week was added at v20.01 and reverted at v20.02 once the finding
  that motivated it turned out to be a bug (below). That is class C on ROADMAP.md's
  scale — fine for building against, and not something to put in front of an assessing manager as a
  requirement. It is recorded here rather than left implicit because the number shapes every figure
  the tool produces, and "why 24?" is a question a proposal will be asked.

- **~~The docs say the panel covers "24 fatigue factors"; it renders 23~~ — SETTLED at v21.97, and
  the answer was NEITHER NUMBER.** The row said the right fix was "either a 24th factor that was
  never implemented, or a doc that has been saying 24 for no reason", and instructed a reader to
  check the source before changing either. That instruction was correct and unfollowable — the ORR
  site was blocked from this environment — until network egress opened in Aug 2026. The sheet
  (`good-practice-guidelines-fatigue-factors.pdf`, Dec 2021) carries **25 rows in six families**.
  **TWO were missing, not one**, both MRSF rows in the Cumulative family, and one of them matters:
  *"More than 7 consecutive 8h shifts"* is the tightest consecutive-working rule on the page and the
  one most likely to bite a link of eight-hour duties — FF11 allows 13 shifts between 48h breaks and
  this allows 7. The panel had been silent on it since v19.46. The other, *"More than 6 consecutive
  night or early shifts in a permanent pattern"*, is not applicable to a rotating link and now
  renders saying so rather than being absent. Both shipped at v21.97; the reasoning is in
  `links-fatigue.js`'s header. **The general lesson is worth more than the fix: a disagreement
  between two numbers is not settled by picking whichever is easier to change**, and for two years
  the easier one would have been wrong in both directions at once.

- **~~The seeded default trips FF11, and the spare count is why~~ — CAUSE FOUND AND FIXED (v20.02).**
  Recorded at v20.01 as a property of running 5 spare weeks. It was not: the **line-order optimiser
  was clustering the cover weeks**. `generateLink` spreads them evenly (gaps 5, 5, 5, 4, 5 at 24/5)
  and the reorder returned gaps 9, 3, 1, 7, 4 with two ADJACENT, which chain into one long run —
  taking FF11 from **9 to 14** on the generator's own output. The v20.01 measurement across lengths
  22–25 was measuring the bug, not the spare count. `spareSpread` is now charged unconditionally in
  `links-adjacency.js` — at weight **3000**, not the 500 it was first written at, which `variety`
  could still outbid (see `.claude/rules/links-design.md` → the spare spread). On the shipped default
  (24 lines, 4 spare) the cover weeks come back evenly spaced (gaps 6, 6, 6, 6), FF11 at **11** and
  the longest run at **8**.
  **The lesson worth keeping: the reorder can make a design worse than the one it was handed**, and
  before v20.02 nothing in it was watching for that. Every other term is a preference; this one
  protects a guarantee.

### From the same section — the breach that did not exist, and the 768px header fix

  **This section previously described a breach that did not exist.** Until v19.79 both run checks
  counted a spare week as SEVEN worked days, which fused the blocks either side of it: the main
  cycle reported 15 consecutive days and the bilingual 14, against true ceilings of 9 and 8 (9 and 9
  since v25.03, when a cover week's Sunday stopped being one of its four duties). The
  comment justifying it said over-reporting was "the safe direction for a fatigue check". It is not,
  once a number has a hard limit under it — a tool that cries breach on the roster people are
  actually working teaches its readers to discount the row, and the next design that genuinely does
  breach is hidden by that discount.

- **The GRID's header is fixed from 768px up** (v19.77) — it had been broken to 1024px, and the band
  between was costing the sticky header for nothing. Measured: the wrapper's content fits its box at
  768/834/900/1000 (684/684, 720/720, …), so `overflow-x: auto` was making it a scroll container with
  nothing to scroll, and `position: sticky` resolves against the nearest scroll container. That band
  includes **iPad portrait**, the device this workspace's own first-visit notice recommends. Moving
  the breakpoint to 768 fixed it with no nested scrolling, no desktop change, and no baseline moving.
  **Below 768 it stays broken, deliberately** — see the next entry.

### From the same section — the phone-headers entry as it stood

- **The generator and the grid lose their column headers on a PHONE** (measured v19.67, recorded
  here in the v19.70 sweep). Both tables sit in an `overflow-x: auto` wrapper below their breakpoint
  so the table can scroll inside the card — and per spec, when one overflow axis is not `visible`
  the other computes to `auto` too. The wrapper therefore becomes a vertical scroll container as
  tall as its own content, and a `position: sticky` header sticks to a box that never scrolls. The
  declaration is present and inert. **Do not "fix" it with `overflow-y: visible`** — that is the
  exact declaration the spec overrides, so it would read as correct and change nothing.
  Measured at 390×844: the grid is **43% off-screen horizontally** (592px of table in a 338px
  wrapper) with no LINE/SUN/MON header on screen for most of the scroll, so neither a label nor a
  countable column position tells you which day you are editing; the generator's SUN column and the
  footer totals clip the same way. The sticky save row takes **190px of a 727px viewport (26%)**
  and the brush bar **239px**. (That figure was **146px/17%** here until v22.81 and had been
  wrong for two releases — the strip grew to 224px as chips were added, and v22.79 took it back
  to 190px by packing them two-up. The v22.80 0.10 sweep re-stamped this file without catching
  it, which is the recurring lesson: a stamp says a document was visited, not that its
  measurements were re-taken.)
  **Accepted rather than fixed**, on three grounds: the workspace's own first-visit notice says
  *"Best used on a desktop or tablet; the grid is tight on a phone"*; a tablet at ≥768px
  gets the working desktop layout, so this is phone-only; and the plan explicitly defers redesigning
  the target table until package 4, so rebuilding it for mobile now means doing it twice. The real
  fix is a `max-height` and therefore a nested scrollbox around the primary creation path — a UX
  decision, not a tidy-up. Both facts are pinned by an e2e that runs at both widths.

### From the same section — Firefox keyboard editing, gone at v23.38

- ~~**Firefox keyboard editing commits early.**~~ **GONE at v23.38** (recorded at the v23.40
  sweep rather than deleted, because the reason it went is worth more than the entry was). Firefox
  fires `change` on every arrow-key press inside a focused `<select>`, so keyboard-only editing of
  a shift cell used to commit on the first arrow instead of on Enter. The cell editor no longer
  builds a focusable `<select>` at all: it creates a DETACHED one purely to parse its options and
  hands the groups to `openOptionSheet`, so there is nothing for an arrow key to change. **A
  platform quirk was designed out by a change made for an unrelated reason** — which is why this is
  a record rather than a fix to claim.

### From the same section — how the bin became permanent, and the superseded same-name item

  Automatic expiry was suspended at v19.86 (external review P2) because no client-side age check can
  defend against a device clock running more than 30 days FAST: every recent deletion then looks
  expired, the purge transaction re-checks with the same wrong local time and agrees, and a
  colleague's design is destroyed. It was then carried as a production exception for ten months, on
  the assumption a server-side sweep would eventually replace it.

  **It will not, and the reasoning is better than the plan it replaces.** A soft-deleted design is
  already invisible and restorable, storing it costs almost nothing, and the only thing an automatic
  purge adds is the power to destroy a designer's work unattended — the exact failure the bin exists
  to prevent. So the machinery that existed ONLY to serve the un-built sweep was DELETED at v24.10
  rather than left dormant: `SOFT_DELETE_RETENTION_DAYS`, `isPurgeable`, `purgeableIds`, `daysLeft`,
  the unwired `_purgeExpiredDeletions` and the store's `purgeIfExpired`. That is this repo's own
  rule, coined about that very constant — *a knob that drives nothing is the
  `SOFT_DELETE_RETENTION_DAYS` mistake*. Git has all of it if a Cloud Function sweep is ever wanted,
  and such a sweep would read SERVER time and would not have used the client store's method anyway.

  **The reason the dormant version was a real cost, not just untidiness:** the UI went on promising
  the expiry for ten more versions (fixed v19.96, external review P2). Suspending the purge left
  `deletedLabel` still appending "· removed for good in N days" to every row, and the delete confirm
  and the tips still saying 30 days — while the bin's own intro line, two inches above the rows,
  correctly read "Nothing is deleted automatically". One dialog, two mutually exclusive
  explanations. The behaviour was SAFER than the promise, so nothing was lost; what was damaged is
  the reason to believe the next thing the panel says. There is now no constant for a countdown to
  come back from, and `doc-parity.test.mjs` fails if one is re-added without re-pointing the guard.

- ~~**Two designs may carry the SAME NAME**~~ **SUPERSEDED v22.66** — `links-design-naming.js` now
  refuses a duplicate from the list you loaded. The residual race is the entry "Duplicate names are
  refused from the list you LOADED" above.

### From "Overtime Availability — accepted gaps" — four entries as they stood, one of them since wired

- **The SUNDAY-RELEASE REQUEST is recorded, and it is only ever a request.** Since v23.81 a member
  rostered to work a Sunday can tick "Ask to be taken off this Sunday" on that week's availability
  form (`overtime-sunday-release.js`), the reviewer's list flags it (`releaseRequestLine`), and the
  server stores it as `releaseRequested: true` on that day's answer (`REQUEST_DAY_FIELDS`). What it
  still does NOT do, deliberately: it writes no override, changes no roster and consumes no annual
  leave, and no surface words it as granted — `OVERTIME_AVAILABILITY.md` invariant 14. The roster
  team decides, outside the app, and the app records nothing about their decision. The server also
  checks no roster when accepting one (it has none; a request is a fact about what was asked and
  stays true if the shift later moves) — it checks the CALENDAR instead, and refuses the field on any
  day but a Sunday (v23.87). This bullet said "server-side only … nothing writes it, and no surface
  shows it" from v23.80 until v23.87, a release after both halves had shipped; the sequencing it
  described (rules first, form once the functions deploy was confirmed) is the backend-first rule,
  CLAUDE.md → "Workflows".

- **"Away for a rostered Sunday duty" is therefore a REQUEST in the app, not an absence.** Sundays
  are uncontracted for every grade, so annual leave and absence cannot be written on one
  (`SUNDAY_FORBIDDEN_TYPES`) — correct, and it is what stops a Sunday costing somebody a day they do
  not owe. The consequence was that a fact the depot's workbook has always been able to state — a
  free-text `N/A <name>` tag in the Sunday row, used on **52 of its 75 tagged Sundays**, every one a
  day the person was otherwise contracted — had no representation in the app. An external review
  (v23.78) proposed a new non-entitlement absence type; **the owner's answer was the request above**,
  which puts it where it is actually decided and invents no new kind of absence. Do NOT loosen the AL
  rule to close the remaining gap, which is that the DECISION is not recorded: once the roster team
  has taken somebody off, the calendar still shows the Sunday duty until the roster PDF for that week
  is imported or the shift is changed in Admin.

- **~~No reminders.~~ The MEMBER half shipped at v21.47; the reviewer half has not.** Two targeted
  push notices now go out on their own — *you have been asked* when a window starts asking somebody,
  and *answers due today* on the morning of the initial deadline to participants who have submitted
  nothing. Both are addressed to resolved member uids and never fan out. What has NOT changed is the
  reviewer's side: nothing tells a clerk who is outstanding, so the *Awaiting a form* list and the
  **No response** section are still the only answer to that question — which is still why they must
  never merge into "not available". Operating detail: OPERATIONS_REFERENCE.md → "Nobody is asked
  silently any more".

- **~~The page does not re-read state while it sits open.~~ WIRED at v20.78.** `visibilitychange`
  now resyncs against the server when `shouldResyncClock` says a deadline is near, one read at a
  time. Recorded here rather than deleted because the entry said the opposite for ten releases, and
  a limitation that has been fixed is a worse doc than one that was never written.

- **An open window's population can GROW — and only before its first deadline (v20.78, corrected
  v20.81).** Populations are still frozen against removal and against late addition, but automatic
  creation made "existing windows never change" mean "an invitation never takes effect": by the time
  anybody is invited, every week they could usefully answer already exists. So the nightly scheduler
  tops up windows that are still in `INITIAL_OPEN`.
  **Not every open window** — that was the v20.78 rule and it was half a deadline out (external
  review, Aug 2026). Somebody added between the two deadlines is reported as **No response** for a
  deadline that pre-dates their invitation, and the moment they submit `deriveHistory` labels them
  **submitted after the initial deadline**. Both describe a person who was asked and did not answer.
  The remedy is the phase, not a kinder label: they join from the next week whose first deadline is
  still ahead of them.

### Test coverage gaps
The suite is now broad (see `docs/FILE_INDEX.md` for the
full per-suite listing, which `doc-parity.test.mjs` keeps complete; nearly every pure module has a companion `.test.mjs`, the exceptions
being trivial data/formatter modules like `paycalc-help.js` and
`roster-cycle-data.js`). What matters here is what is **still not** covered:

**Closed v16.32–16.33:** the push-notification state machine + subscribe/unsubscribe flow
(`notif.test.mjs` — Push APIs stubbed on globalThis), the `setupRosterAuth` (B4) decision
logic (extracted to `functions/roster-parse-helpers.js` and unit-tested: `parseSetupActionFlags`,
`resolveRosterAuthConfig`, `claimsForTier`, `computeOrphanLabels`), and the `isSafeStorageUrl`
download-URL allowlist (extracted to `storage-utils.js` + `storage-utils.test.mjs`).

**Closed for Overtime v20.56, for account administration v21.83–85:** the Cloud Function HTTP
*handlers* end-to-end. `overtime-endpoints.test.mjs` executes the five Overtime handlers, and
`auth-endpoints.test.mjs` now executes `requestPasswordReset`, `resetMemberPassword` and
`setupRosterAuth` — each against a fake Firestore, a fake Auth and a recording push transport. That
is what the entry below said needed firebase-admin mocking; it turned out to need a fake, not a
mock. The lesson that produced it is worth keeping: a surface test proves the handlers were DEFINED,
not that any of them works, and the Calendar PIN outage was a mint path that had never once run in
production.

**Every handler is now covered.** The last two closed on 25 Sep 2026:
- ~~**`getSignInStats`**~~ — **CLOSED.** `auth-endpoints.test.mjs` drives it for real: the population
  is the server roster minus its admins, every page of accounts is read, the body carries four
  integers and no identity, nothing is written, a failure is a 500 rather than a count of zero, and
  it is admin-only. Five mutations, all caught (admins counted, every account counted, only the first
  page read, identities in the body, an error swallowed as zeros).
- ~~**The Documents domain**~~ — **CLOSED v22.02.** `documents-endpoints.test.mjs` executes
  `ingestHuddle`, the three `onDocumentCreated` triggers and the scheduled pay reminder against a
  fake Firestore, a fake Storage and a recording transport, organised by cost: a DOUBLE push (both
  halves of the guard — the atomic create-vs-resend transaction and the trigger's power-automate
  skip), a SILENT non-push, and a write that should not exist. Teeth-verified by six mutations.
  This entry said the DECISION to send was what remained untested; it is now the covered part.

**The coordinators have no unit tests, and that is mostly a DECISION rather than a gap** (restated
16 Sep 2026 — this entry previously read as an open item and understated what covers them). A
coordinator is what remains once the pure logic has been extracted out, so `calendar-app.js` and
`admin-app.js` are DOM-bound by construction and a unit harness for either would be a mock of the
whole page. Their decisive seams are wiring-tested instead, deliberately, in e2e — and the tests say
so in their own headers: `e2e/calendar.spec.js` (`day detail:` block) pins `personalActionsAllowed`
at its call site and records the mutation that justified it, and `e2e/admin.spec.js` does the same
for `_syncMemberFor`. **Do not read "only e2e covers it" as a shortfall here. That IS the wiring
test** the "rule tested, the wiring not" risk in CLAUDE.md asks for.

**One real hole sat inside that framing, and it is now closed** (16 Sep 2026). Three fire-and-forget
writers run once per page from its coordinator — `initErrorReporter`, `recordUsage` and
`recordPageLatency` — and every one writes to a collection whose rules require `request.auth != null`.
Called before an identity exists, each write is rejected in silence: **the error log looks healthy
because it is broken**, the Usage card under-reports, and the latency samples thin out. Nothing
raises, nothing renders differently, and nothing went red. Measured rather than argued: deleting
`initErrorReporter();` from `calendar-app.js` left the entire unit estate green, and every chromium
test in `e2e/calendar.spec.js` with it. e2e could never have seen it — the page renders identically either way.

That mattered more than an ordinary coverage gap because of what depends on it. `recordPageLatency`
is the wire every latency reading runs on, including `readyProvisional`, the measurement added at
v23.70 to separate the two readings of the fast path that the aggregate cannot (no longer written:
the fast path was retired on 26 Sep 2026, `DECISIONS.md`). That reading was
taken on 19 Sep 2026 (`LATENCY.md` → THE CLOSING READ) and the file is closed, but the wire stays in
use for the App Speed card. A regression there would not look like an error — it would look like a
thinner sample that still reads as data.

`page-contract-parity.test.mjs` now pins every page's coordinator (nine since the New link page): each calls all three, and each call
sits inside that page's declared auth barrier rather than at module scope. All seven were correctly
wired when the guard was written, so this closes no defect — it protects a rule that was obeyed
everywhere and checked nowhere. Verified by four mutations (a deleted call; a call kept but hoisted
out of the barrier; Overtime's chained `.finally()` site; paycalc's `afterAuth` indirection being
severed) plus one negative control confirming it stays quiet on paycalc's legitimate second call
site in `_showUnsupportedRole`.

**The Firestore read/write layer is now reachable, and its riskiest calls are tested** (25 Sep 2026).
`firebase-client.js` could not be loaded in Node at all — it imports the SDK from the gstatic CDN, Node
refuses an `https:` specifier, and `mock.module` resolves before it replaces. A resolve hook
(`test-fixtures/firebase-sdk/resolve-gstatic.mjs`) now answers those URLs with a recording fake, and
`firebase-client.test.mjs` drives the real module: push-subscription ownership, the member's own
documents and the one-retry claim refresh, the password change that must never be reported as failed,
re-authentication on a transient error, the admin endpoints' forced token refresh, the public reset
request's absent token, and the analytics writers. Twelve mutations, eleven caught; the survivor (the
signed-out guard on the document URL) is held again one layer down and says so in the test.

**The admin screens' reads followed on 26 Sep 2026** — `getClientErrors`, `getUsageStats`,
`getPerfStats`: the `limit(101)` that lets the Error Log say more than 100 are hidden, that the
retention sweep only ever deletes a RESOLVED record past 90 days, that the usage prune names its
field by `FieldPath` (a dotted day key throws synchronously in the real SDK and blanked the card
once), which month's document each window reads, and that no failed sweep or unreadable document
takes a card down. Nine mutations, all caught. The fake SDK now APPLIES `limit()` and refuses a
`where` operator it does not implement — it used to ignore the first and match everything on the
second, so a range query or a cap would have passed for the wrong reason. The upload engine is
tested through `documents-client.js`. Before adding new behaviour to `firebase-client.js`, add the
test with it.

### Error Log noise filters (v19.20)

Not every uncaught error is a fault in this app. Seven classes are suppressed before the Firestore
write, by the pure `shouldReport` in `client-errors.js`: the opaque cross-origin `Script error.`,
browser-extension URL schemes, `ResizeObserver loop`, the declarative view transition the browser
abandoned, a service-worker background-update failure **when accompanied by a network phrase**, and
**WebKit's IndexedDB teardown messages when they come from the SDK origin**, and a cross-origin script that is not one of the app's CDN origins.

The view-transition class carries **THREE Chromium wordings for one cause** (the second added v22.67,
from a live Android Chrome 152 report). `Skipping view transition …` is its own worded skip;
`Transition was aborted because of invalid state` is the DOMException it rejects the transition
promise with when the document stops being fully active mid-navigation — a tap through to another
page, the app switcher, a back gesture. The app never asked for the transition (`shared.css` opts
in declaratively with `@view-transition { navigation: auto }`), so there is no promise for it to
handle and the rejection lands here; the navigation it names completed correctly. The second is
matched IN FULL rather than on `Transition was aborted`, because this log's recorded failure
direction is the filter that is too broad — a rule written for the browser's navigation animation
must not swallow an overlay of ours that genuinely fails while aborting. The third (v23.03) is Chromium's
`Transition was skipped`, matched ANCHORED to the whole message so an app overlay's own "Transition
was skipped by …" still reaches the log.

That last one came from a staff report on an iPhone (iOS 18.7 / Safari 26.5, v19.19):

    Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing.
        getObjectStore@…/firebase-auth.js
        _withRetries@…/firebase-auth.js

Firebase Auth's `indexedDBLocalPersistence` POLLS its object store, because Safari's storage events
are unreliable across tabs. WebKit closes IndexedDB connections whenever it suspends or reclaims a
page — backgrounding the PWA, screen lock, the app switcher, memory pressure — so a poll landing in
that window throws from deep inside the SDK with no app frame on the stack. Firebase wraps the call
in `_withRetries` precisely because it expects this; when the retries are spent the rejection
escapes to our reporter. The identity is already restored by then, Firestore uses a SEPARATE
database (so calendar data is untouched), and the connection reopens on the next foreground. Harmless and self-healing — but it
recurs on every iPhone, and the Error Log is only worth reading if it is mostly signal.

**Scoped to the SDK origin deliberately.** The same phrases from our own origin would mean the
Firestore persistent cache is failing, which is a real fault worth seeing, so those still log. The
list is exact phrases, never a loose `Database` substring — a version conflict or a quota failure is
a genuine problem that happens to involve the same API call.

**Do not add a filter without a test on BOTH sides.** The failure directions are not symmetric: too
narrow leaves noise you can see and complain about, too broad silently swallows real errors and the
log looks healthy *because* it is broken. `error-reporter.test.mjs` pins each rule against the thing
it must suppress AND the neighbouring real error it must not.

### Whole-app audit — deferred findings (v17.54)

A max-effort adversarial audit (7 parallel subsystem reviews) found **no high/critical bugs** — the
app is well-hardened. Four low-severity defects were fixed in v17.54 (Cloud Functions header coercion;
links new-design concurrency-baseline invariant; calendar `renderCalendarWhenIdle` team-view guard;
`peekNotifState` keyless-subscription check). The findings below were **deliberately not fixed** —
they are latent, owner-territory, or within a documented tolerance. Each is real; none is urgent.

- **Payday/cutoff crossing a year boundary is filed under the wrong year (LATENT).**
  `getPaydaysAndCutoffs(year)` files a payday/cutoff under the unshifted payday's year, but a paired
  cutoff (or a bank-holiday-shifted payday) can fall in the previous December; `isPayday`/`isCutoffDate`
  then look it up under the date's own year and miss it. **Unreachable under `MAX_YEAR = 2030`** (verified
  zero misses 2026–2030) — first bites ~2034. **Fix when extending `MAX_YEAR`** (see Time-boxed
  maintenance above): key each entry under `formatISO(date).slice(0,4)`, or have `_get*Set(year)` also
  pull `year+1`'s first entry when its cutoff lands in `year`.
- **~~Sync-chip retry has no timeout (LOW UX)~~ — FIXED on 10 Nov 2026, in two parts.**
  `calendar-initial-fetch.js doRetry()` awaited the fetch with no time limit, so on a connection that
  neither resolved from cache nor rejected promptly the chip could strand on "↻ Retrying…" with no
  way to tap again. Left as-is here, raised again by the 10 Nov 2026 external review, and closed the
  same day: v25.69 gives "Retrying…" the first load's 10 s (`RETRY_TIMEOUT_MS`, the owner's decision)
  and then hands the control back as a failed read does; and cal-data-5 (v25.68) withdraws "Couldn't
  update" once the month on screen has been confirmed, which closed that review's second, smaller
  gap — a failed retry's message left above a month a later read had confirmed. The rule now lives
  in that module's header and `.claude/rules/calendar.md` → Sync chip state machine. Moved out of
  `KNOWN_LIMITATIONS.md` on 12 Nov 2026, two days late.
- **~~`nameToEmail` collision surface (LOW, theoretical)~~ — CLOSED on 12 Nov 2026, by a test.**
  Spellings that differ only in separators or case collapse to one account email (`"A. Mc Donald"`
  = `"A. McDonald"`), so a starter typed two ways would share a login with somebody already on the
  roster; Set up accounts refuses to hand one member's account to another, so the newcomer would
  have been left with none. `auth-identity.test.mjs` → "no two roster names share a login, leavers
  included" now fails `npm test` on any clash. The pay calculator's slug test had been catching most
  of them by accident, but its slug keeps the digits a login drops, so `'Q. Example'` and
  `'Q. Example2'` passed it — mutation showed both halves. The check is step 1 of `/new-starter`.
- **~~"Active accounts (30 days)" boundary undercount~~ — SUPERSEDED at v25.00.** The suppression
  rule it described (`shouldCountRolling`) was replaced by `rollingMove` (`usage-stats.js`), which
  keeps each member-device's one count on its latest active day; the card now reads "last 30 days".
- **~~A manually-entered Sunday worked shift is stored as `type:'shift'`, not `'rdw'`~~ — FIXED; the
  Shift pill is DISABLED on Sunday rows** (`admin-week-editor.js`, and layer 6 of the Sunday rule in
  CLAUDE.md). Struck through rather than deleted because this entry was wrong in a way worth naming:
  it called the gap "display-only", and the code comment that closed it says the opposite — a Sunday
  saved as `shift` rendered as an ordinary worked badge and **the pay calculator's Sunday-overtime
  pre-fill missed it, under-counting pay**. An entry that under-rates its own severity is how a real
  defect stays parked as an accepted limitation.
- **~~Roster-import save path has no equal-start/end guard~~ — CLOSED at v20.39, and this row outlived
  the fix by more than a hundred versions.** It said `_saveOverrideBatches` did not reject `s === e`
  while the two manual paths did. It does: the refusal is in `admin-roster-upload.js` (the "DEFENCE IN
  DEPTH: a zero-length worked range never reaches Firestore" block), logged and unwritten, with the parse-side reasoning in `functions/roster-parse-helpers.js` — a
  zero-length range reads as TWENTY-FOUR HOURS through the overnight wrap, and it reaches pay.
  Found by an external review reading the code against this file, which is the only way a stale
  "we don't do X" is ever caught: nothing fails when a limitation is fixed, so the entry simply sits
  here being believed.
- **~~Applying the *estimated* 2026/27 award rate overstates pre-award (Apr–Jul 2026) periods~~ —
  CLOSED, and it self-corrected exactly as written.** The entry said "no clean fix until the award
  lands"; the award landed, `londonAllowFrom` is set to 28 Aug 2026 on the 2026/27 row
  (`paycalc-calc.js`), and the `rateUnconfirmed` flag that gates the whole estimated-rate path is
  not set on the 2026/27 row — so the mechanism cannot fire (the flag is still read, for the next
  award year). It sat here contradicting the "2026/27 pay
  rates — ✅ CONFIRMED AND SHIPPED" section (now ROADMAP_HISTORY.md).

### The member claim — one optional console step remains

**What v24.23 closed.** Every member rule and endpoint used to believe `request.auth.token.name` on
sight. Firebase fills `name` from the account's DISPLAY NAME, which any session may set for itself,
and anonymous sign-in is enabled — so a stranger could sign in anonymously, call itself a member, and
read every override, read that member's work email and write their leave (proven in the emulator).
The shared PIN account was created with a display name, so every PIN session already carried a
`name`. v24.23 believes a `name` only on a PASSWORD sign-in whose email is the one that name derives
to; one account per email makes that the real member. `firestore.rules` (`isMember`) and
`functions/member-identity.js` apply it, and both are tested against every roster name.

**What it did not close, until v24.27 — and it was wider than this entry first said.** The binding asks whether
the email matches the name; it does not ask whether the name is ON THE ROSTER. So anybody can sign up
from the client at an address that derives from a name nobody has — `z.zzz@myb-roster.local`, display
name "Z. Zzz" — and that token passes `isMember()` in full: every member's overrides, the three
documents, the Links designs and signed document links, all past the PIN (proven in the emulator,
v24.24 review). This entry said the gap was "a new starter before Set up accounts runs", which
understated it: running Set up accounts promptly does nothing about an invented name. The second case
is the one first described — a real new starter's email registered before the server provisions it,
which Set up accounts would then have adopted. Both exist because client sign-up is enabled.

**The permanent fix, and where it stands** (backend-first, exactly as B3 was):

1. **SHIPPED v24.24 — the server stamps `member`.** `claimsForTier` now gives every provisioned
   account `member`, set to its roster name. It is a custom claim only: no display name, client call
   or sign-in method can produce it. In the same release **Set up accounts takes back an account it
   never stamped**: an existing account at a roster email carrying NO custom claim at all was not made
   by the server (only the Admin SDK or the console can set a claim), so its password is reset to the
   member's default, its display name to the roster's, every session on it revoked and `resetAt`
   stamped, before its claims are. Operations names it on a "Taken back" line so the admin can tell
   the member. **Any claim, not `name`**: the first cut keyed on `name` and would have reset an admin
   whose `{ admin: true }` was set by hand in the console, including the one pressing the button.
   **It fails closed**: a take-back whose reset or revoke fails stamps nothing and reports
   `reclaim-failed`, because stamping after a failed take-back would hand the outsider the claims
   and the next run would adopt the account for good.
2. **OWNER STEP — run Set up accounts once**, after the v24.24 functions deploy. Until it runs, the
   Staff Login Accounts audit lists every member as needing it (their claims lack `member`), which is
   the signal working, not a fault. Then wait an hour, so every live token has refreshed onto the new
   claim.
3. **SHIPPED v24.27 — require it.** `isMember` in `firestore.rules` and `memberNameFromClaims` in
   `functions/member-identity.js` believe a member only when `member == name`, on top of the v24.23
   email binding, and `CLAIM_EPOCH` rose to 3 so every device fetches a token carrying the claim on
   its next open that confirms a named session. (The sweep otherwise runs only inside
   `ensureNamedSession`, which the Calendar's named boot never calls, so until the Calendar's full
   named grant was made to run it too, a Calendar-only member waited out the hourly refresh, or met
   "Calendar access has expired", instead.) A
   self-registered account — at an invented name's address or a real member's —
   now carries nothing the rules or endpoints believe. Shipped after step 2, as it had to be: a
   token without `member` loses every member read and write.
4. **Client sign-up in the Firebase console — hygiene now, not a control.** After step 3 it grants
   nothing. The app no longer signs in anonymously anywhere (the last call, in `calendar-access.js`,
   went at v24.34 with the `CALENDAR_PIN_ACCESS` switch), so switching it off no longer risks the
   Calendar; a private-window check that the Calendar still loads afterwards remains cheap.

For a new starter, running "Set up accounts" promptly is still good practice, but it is no longer the
security control: an account registered at their email before that run is refused everywhere, and
the run takes it back.

---

## Closed limitations, moved out of KNOWN_LIMITATIONS.md (13 Nov 2026)

### An update could still land mid-way through the forced change — CLOSED v26.01

Recorded by the sign-in audit and closed the same day, once, in `sw-register.js` rather than page by
page, so no page's service-worker start-up changed. Every reload an update causes now waits while a
write no page started is on its way (`backgroundWritesInFlight`, `claim-retry.js`): the default path
(the Pay Calculator, Trains, New link), `reloadWhenNotBusy` whatever the page's own check says
(Overtime's knows only its form), `reloadWhileHidden` (the Calendar) and `reloadForUpdate` (Links,
once its question is answered) all wait for the next time the page is hidden with nothing on its
way, as `reloadWhenNotBusy` always had. `lazyImport` does not reload then either, leaving the tap to
its caller's fallback, and a notification tap finds such a page busy. Proven by the last block of
`sw-register.test.mjs`, which drives each path with a real write counted by `trackBackgroundWrite`;
each path's check was deleted in turn and its test failed. The entry as it stood:

> The forced change's password write, and the record that follows it, are counted as writes in flight
> (`trackBackgroundWrite`, claim-retry.js), so a release's reload waits for them on the pages whose busy
> check reads `writesInFlight` — Admin, Settings and Operations. The Calendar holds an update's reload
> while it is on screen anyway. The Pay Calculator, Trains, New link, Links and Overtime do not ask, so
> an update arriving in the second the write takes reloads them under it. The cost is small and
> self-correcting: the member is asked to choose a new password again at the next sign-in. Asking on
> every page means changing the service worker's start-up on all of them, which was not worth the risk.

### A revoked phone could save its push record again for up to an hour — CLOSED v26.01

Recorded at v25.98 as the second of two gaps under "A lost-phone reset still leaves two narrow gaps";
closed in the release after it by the fix the entry named. The `pushSubscriptions` create and update rule
now refuses a token whose sign-in (`auth_time`, kept across renewals) is older than the member's
`passwordStatus.resetAt` (`signedInSinceLastReset`, `firestore.rules`), which every reset, new account,
take-back and re-enable stamps before the password changes. `auth_time` counts whole seconds, so a
sign-in in the reset's own second is refused, the safe direction; the rule's comment says why that costs
nothing in practice. No client change: `notif.js` already treats a refused re-save as one to try again
on the next load. A LEAVER is not covered by it — the sweep stamps no `resetAt`, and a rule cannot see
`disabled` — so the sweep's own re-release (`disabledLeaverUids`) still covers that hour. Proven by eight
emulator cases in `firestore.rules.test.mjs`; deleting or loosening any part of the rule fails at least
one of them. The first gap, the surname, stays in KNOWN_LIMITATIONS.md: closing it is an owner decision.
The entry as it stood:

> - **A revoked phone can save its push record again for up to an hour.** A revocation takes effect
>   when the ID token next renews, and the push-record rule cannot see it, so a phone opened in that
>   hour can save its record again once its daily re-save is due. Nothing re-checks it later, as the
>   leaver sweep now does for leavers (`disabledLeaverUids`). A rule comparing the token's `auth_time`
>   with `resetAt` would close it. Not built.

### A PIN session in the same tab outranked a member's at start-up — CLOSED v25.98

Recorded at v25.77 under "A signed-in session lasts 60 days regardless of use"; closed by the
sign-in audit of 13 Nov 2026, which made the start-up decision answer a held member session with the
member's card (`decideAccess`, `calendar-access-core.js`) and made an unlock with a session held reload
instead of granting. The entry as it stood:

> **…and one case it does not yet handle (review, 11 Nov 2026 — not fixed, low priority).** If the
> same tab ALSO holds a staff-PIN session when the member's identity fails to restore, the start-up
> decision grants the viewer: it ranks a PIN session above a member session with no identity behind it.
> That member then reads the station's Calendar rather than their own, and a later loss of access shows
> them the PIN card. The late-restore path already refuses exactly this (`grantLateViewer`); the start-up
> path does not. It needs an identity failure and a PIN session in one tab, so it waits for a release
> that touches `decideAccess` anyway.

### A delete just after the signal returns could overtake this device's own queued save — CLOSED v25.95

Recorded at v25.94 and not reproduced; closed at v25.95 by the fix the entry named. Every checked
write — each Admin delete and save of a day, the leave-year move, and each part of the weekly roster
import that deletes — now waits for this device's queue to drain before its transaction reads the
server (`whenOwnWritesSent`, `firebase-client.js`; the rule and its reasoning are `ownWritesSent` in
`claim-retry.js`). A queue that has not drained within eight seconds ends the write as a
transaction that never reached the server does: a save that only writes is held as a batch BEHIND
the queue, so the two land in the order they were made, and a removal is refused, writing nothing.
Proven by `admin-override-store.test.mjs` block 8, the import's tests in
`admin-roster-upload.test.mjs`, and an Admin browser test that holds the queue
(`e2e/admin.spec.js`, "a delete waits for the saves this device has not sent yet"). The race itself
has still not been run against a real Firestore with the network cut mid-flow: the browser suite
models the queue rather than running it.

**v25.96: run against a real Firestore, and a second fault found.** The signed-in lane's "back
online" journey (`e2e/signed-in.spec.js`) saves a day of leave offline, reopens Admin once the
signal is back with the SDK's write stream held, deletes the day from Saved Changes, then lets the
save go. With the wait removed it reproduced the entry below exactly: "Deleted" while the save was
held, then the save landed and the day was back in the database. With the wait in place it showed
what the stubbed suite could not: the list had read the day while its save was still queued, and
the SDK hands such a record over with no stamp (a pending `serverTimestamp()` reads as null). So
once the wait let the save land, the delete compared a stampless copy with the server's, found the
stamps different and refused the member's OWN record: "Someone else has changed this since your
list loaded". Nothing was lost, but the message was false and the day stayed. A record read with
this device's own unsent write is now held as the page's own copy (`overrideFromSnapshot`,
`override-compare.js`), matched on its fields as a just-saved record already was — in Admin's two
list reads and the roster import's week read. The journey now passes, and fails with either fix
taken out.

**v25.97: the draft kept mid-save no longer offers back a save that landed.** The same real-SDK
journey found it: Admin closed while a save waited for signal keeps the staged rows as a draft (rightly
— in a second tab the save is held only in memory, and is lost with the page), and the next load asked
"Restore your unsaved changes?" about a save that had since landed; Restore then said the day had
"changed since", about the member's own save. The draft now carries what the save was sending
(`sendingDays`, held with the write lock in `admin-week-editor.js`), and the next load offers back only
rows whose day does not hold it (`unsavedWeekDraft`; `unsaved-draft.js` rule 6). The shaping is pure
(`sendingEntries`, `keptWeekDraft`), which kept Admin's two coordinators inside their size caps. Nothing else changed: the browser's own "Leave
site?" while a save waits stays, because in that second-tab case it is true. Proven by the journey,
which now reloads with its draft and fails if it is offered back, two Admin browser tests (landed: not
offered; never landed: offered and restored) and the unit tests of the rule.

**v25.97 also ran the Links fix (v25.96, below) on the real SDK.** A new signed-in journey signs in as
the designer, saves a change to a design with no signal, and renames the design once the signal is
back, while that save is held in the SDK's queue. With the wait taken out, real Firestore did exactly
what the stubbed test had modelled: the rename committed at once, then the queued save, a whole design
with its name, landed on top and put the old name back. With the wait in place the rename waits for
the save, and both reach the database. This run found no new fault; the journey fails if the wait goes.

**v25.97 also gave two placeholder lines a pattern that rests on bank holidays.** Two Dispatchers off
their rotating link for the time being are on a placeholder Monday-to-Friday line, 09:00–16:00, and do
not work bank holidays while on it (owner, 13 Nov 2026). The app had them on `fixedRoster[2]`, which has
those hours but works bank holidays. So every weekday bank holiday showed a shift, and the Dispatcher
allowance added a day in lieu for each one, all eight in 2027. They are now on `fixedRoster[4]`:
pattern 2's hours, with every bank holiday a rest day (`FIXED_PATTERNS_RESTING_ON_BANK_HOLIDAYS`, read in
`getPatternShift`, so the Calendar, the days in lieu and the Christmas rules agree). Their existing
entries were pointed at 4 rather than given new ones, so the bank holidays since each move were
redrawn too, as the rest days they were. Pattern 2 is untouched: others sit on it, and nobody has said
they rest on bank holidays.

**v26.01 moved a third placeholder line onto pattern 4.** A CEA off the main link since 28 Jun 2026 sat on
pattern 2 as well and does not work bank holidays either (owner, 13 Nov 2026). That entry now points at 4 in
the same way, which redrew Mon 31 Aug 2026 as the rest day it was. A CEA's leave is set by the contract,
not the line, so nothing else moved (`roster-data.test.mjs` pins both).

**v25.96: the Links workspace had the same race, and has the same wait.** Its design store queues
a save, a rename and a bin offline (rule 4), and every online one of those, a restore, a purge and
the automatic bin is a transaction. So just after the signal returned, a save wrote over the
server's older copy and the save queued offline then landed on top, older work over newer; a rename
was undone; and a design binned online came back, because a queued save carries no `deletedAt`.
Every transaction in the store now opens through `runTx`, which waits for the queue first (store
rule 5, `links-design-store.js`); one that has not drained in time fails as it would offline, so a
save, a rename or a bin queues behind the earlier writes and a restore, a purge or the automatic bin
is refused. Proven by `links-design-store.test.mjs` ("rule 5"), a source guard in
`links-concurrency.test.mjs` that no transaction opens outside `runTx`, and a Links browser test that
holds the queue (`e2e/links.spec.js`, "a delete waits for the saves this device has not sent yet").

The entry as it stood at v25.94, verbatim:

Every Admin delete — a Saved Changes ✕, Delete selected, a Recorded dates ✕, and the removals in a
week's save — is a transaction (`deleteIfUnchanged`, `commitChecked`; `admin-override-store.js`), and
a Firestore transaction reads the SERVER, never this device's queue of writes not yet sent. A save
made offline waits in that queue until the signal returns ("Two editors on one day", above), and a
read once the signal is back shows it as though saved. So in the moments after reconnecting, a delete
of a record still in the queue can run first: the server holds nothing there, which a delete counts
as already gone, so it reports "✓ Deleted" — and then the queued save lands and the record is back.

**What the admin would see:** "✓ Deleted", the row gone from Saved Changes, and the same record back
on the next read of that member (another member and back, All staff, or the page after five minutes
away) and on the Calendar. Nothing is written that the admin did not ask for; the delete simply did
not take, and deleting it again works, because the save has landed by then. **How to notice:** a day
deleted soon after the device came back online that reappears.

**Why it is recorded and not fixed:** it follows from the Firestore 13.1.0 semantics — a transaction
does not see pending writes — but it has NOT been reproduced: that needs a real browser against the
emulator with the network cut and restored mid-flow, which the stubbed e2e suite cannot express. The
window is narrow, from reconnecting until the queue is sent, normally about a second. The likely fix
is to wait for the device's pending writes (`waitForPendingWrites`) before any checked delete. Revisit
if a deleted day that came back is ever reported.

### `withTimeout`, kept as two copies on purpose — CLOSED v25.68

The first of "Two twins kept apart on purpose", under "Left open by the full check of 3 November
2026". The whole-app check of 10 Nov 2026 (v25.68) made it one copy: `login-overlay.js` imports
`withTimeout` from `password-force.js` (its comment there: the card's copy "differed only in the
error's code", and every page that loads the card statically already loads `password-force.js`), so
the sign-in card's deadline rejects with `myb/timeout` too. The entry went on saying otherwise until the
v26.00 review. The other twin, `fip-guide.js`'s chip-bar blocks, stays in KNOWN_LIMITATIONS.md. The
half that closed, as it stood:

> - **Two twins kept apart on purpose.** `withTimeout` (`login-overlay.js`, `password-force.js`):
>   login's copy ignores the error and the other's callers read its `myb/timeout` code, and sharing
>   one would pull the Firebase module graph into the sign-in overlay's unit tests or need a new
>   module, for six lines.

## Moved out of ROADMAP.md (7 Nov 2026)

Finished work and closed indexes, moved **verbatim** by line range from `ROADMAP.md` as it stood at
v25.46. The live entries keep what is still open: phase 3 of the roster import, the Trains ideas not
yet built, the next education subjects, and a WATCH row for the own-roster copy. The v23.01 review's
index and the print review had every row closed, or already routed to an entry of its own (the Links
generator), except two, and those two now live in entries of their own — `ytd_2627` in NOW, and the
move off the Pages mirror in the Address migration campaign.

---

### The split notes at the top of ROADMAP.md

> **Split at v19.97** (external review). This file was 924 lines, about two-thirds of it the past.
> The history moved out verbatim. If something below has become history, **move it — do not copy
> it**; two live copies of a plan is the drift that made the split necessary.
>
> **Split again on 8 Sep 2026**, on the same rule and for the same reason. It had grown back to 994
> lines and about a sixth of that was closed decisions — a "Decisions taken" section and two
> DECLINED features. Those answer *what did we already decide*, which is a different question with a
> different reader, and they moved to `DECISIONS.md` verbatim. What stayed is everything still OPEN,
> including the governance gate and the owner decisions in `NOW`.

### Roster import — let the PDF's own grid decide the day
**Status:** Phase 1 SHIPPED (v22.31) · **Phase 2 SHIPPED (v24.04; working since v24.12)** · phase 3 not started · **Owner:** Gareth · **Proof:** `experiments/roster-pdf-geometry/` · **Code:** `functions/roster-geometry.js`, `functions/roster-prompt.js`

The import's day-drift defence has a structural weakness the shipped fixes reduce but cannot close:
the row read, `sundayScan` and `columnScan` all come from ONE model call looking at ONE PDF, so when
the model collapses a blank Sunday cell, every cross-check agrees with the wrong answer. The
circuit breaker added alongside compares against the member's own base roster instead — the one
witness the PDF cannot influence — but that witness is deliberately WEAK, because a published roster
legitimately carries leave, absence, overtime and swaps on top of the rotation.

**A strong witness turns out to be in the file already.** Measured on a real roster: the table's
vertical rules are DRAWN, at nine fixed x positions repeated on every content page, and assigning
each text run by coordinate placed all 28 member rows × 7 days correctly — 13 physically empty
Sunday cells and 12 holding a timed duty. On the row that drifts, not one text object falls in the Sunday
column. The app is currently spending model intelligence rediscovering a grid the file encodes.

Three phases, in this order, and the first is the one that closes today's bug:

1. **A geometry WITNESS beside the AI result.** For each member, whether each physical cell holds
   any text. An AI day the physical cell cannot support is **refused, not weighed** — no
   probabilistic reasoning, no second opinion, no base-roster comparison. Deterministic, and it
   leaves the parser exactly as it is. **Measured on the sample: zero false refusals, and it
   refuses 13 of 28 simulated one-day shifts** — every member with a blank cell, and none of the 15
   whose week is fully worked, because a full row offers nothing for a shifted claim to contradict.
   That is enough to close the REPORTED bug (which is defined by a claim landing in an empty cell)
   and it is not a general day-drift detector; `assessRosterAlignment` stays alongside it.
2. **Geometry assigns the days**, and the model is handed already-separated cells. Monday can no
   longer become Sunday because nothing is left for it to decide — and this is where the fully-worked
   rows phase 1 cannot speak for are covered, by construction rather than by a check. **That is the
   argument for treating phase 1 as a step and not a destination.**
3. **Deterministic parsing first, model as fallback** for the genuinely unusual cell. Most cells in
   the sample are already mechanically readable (`RD`, `AL`, `SC`, `SP`, `06:20-14:20 CEA 1`,
   `06:20-18:20 RDW CEA 5`).

**Phase 1 is live (v22.31).** `functions/roster-geometry.js` runs in `parseRosterPDF` as the FINAL gate,
after every model-side repair: it reads the drawn rules and the text positions from the same bytes the
model was sent, and any AI day landing in a physically empty cell is refused — the cell becomes
UNREADABLE and the row is returned as `geometryRefused`, which `roster-alignment.js` folds into the
same verdict as a base-roster drift (row unticked; three refusals trip the breaker). It fails open at
every step and reports that it did (`geometry.status`) — **and until v22.40 nothing on the client read
that field**, so for nine versions the claim in this paragraph was true of the response and false of
the screen: a witness that did not run produced a review identical to one where the grid agreed with
every cell (found by external review). `geometryCopy` in `roster-alignment.js` now states `partial`
and `unavailable`, treating an absent field as did-not-run. It is worth remembering as the shape of
the mistake rather than the mistake itself: the rule was built, tested and documented, and the wire
from it to the person who needed it was never run.

v22.40 also **bounded the wait**: the extraction has the whole model call for free, but an optional
witness that never settled could hold a finished parse until the function's own 120s timeout, so
`awaitGeometryWithin` gives up and reports `unavailable` — which the review now shows. Tested through the real pdfjs on a hand-built PDF (`roster-geometry.test.mjs`), because
the repository holds no roster PDFs.

**Both gates were cleared before it shipped.** Roster TYPE at v22.19 (Supervisor and Dispatch carry the
identical grid); TIME on 1 Sep 2026 — 12 documents, three roster types × three week-endings, draft and
final, zero pages without the nine-column grid (the README). What that still does not establish is an
archive from before a system change, or a scanned sheet with no text layer: both read as "no grid" and
the witness stands aside, which is the right failure. The README also records what nobody predicted,
including a print footer that parses as a member row with `Page 1 of 3` in the Tuesday column — the
hazard geometry introduces in exchange for the one it removes, and the shipped module filters it two
ways because one was not enough.

**The dependency decision was taken with the release, and it is the owner's to reverse.** `pdfjs-dist`
(pinned `4.10.38`, the v4 line the experiment established; zero advisories on the deploy's own audit
gate) is now a dependency of `functions/` — server-side, so the no-bundler rule does not bear on it, but
"a few vetted libraries" is a discuss-first rule and this is the fourth. It was shipped rather than
held because the witness is the roadmap's own sequenced next step, and because declining it costs one
line: with the package absent the adapter returns `pdfjs-unavailable` and the import behaves exactly as
it did at v22.30.

**What phase 1 does not do, so phase 2 still has a job:** a member whose week is fully occupied has no
empty cell for a shifted claim to contradict, and an `RD` written into an occupied cell is not checked
(telling a printed RD from a printed duty means reading the text — phase 3).

**PHASE 2 SHIPPED at v24.04 AND COULD NOT SUCCEED UNTIL v24.12** — the coordinator still required the model to return `columnHeaders`, which `buildCellPrompt` deliberately never asks for, so every upload the grid COULD place was answered with *"The AI returned an unexpected format"*. The better the geometry read, the more certain the failure; a sheet the grid could not place fell back to the legacy path and worked, which is the wrong way round. It was invisible because the only end-to-end test hands the handler an unopenable PDF — so the geometry path had no execution anywhere, and the whole estate stayed green. **The three real rosters re-measured the case for phase 2:** Simulating a
one-day-left misread on every matched row of the CEA, Dispatch and Supervisor sheets for week ending
26/09/2026, the phase-1 witness refuses **19 of 47** — **23 of those 47 rows work all seven days**, so
60% of drifts pass it silently. Under phase 2 the grid ASSIGNS the day and the model is handed
already-separated cells, so those rows are covered by construction rather than by a check.
`.claude/rules/roster-import.md` holds the contract; `functions/roster-prompt.js` holds the reasoning,
including the two wiring defects the v24.05 bug check found in it and the one design cost that is
deliberate (a member legitimately absent from a week's sheet turns the geometry path off for that
upload, and the coordinator logs which path it took).

**PHASE 3 IS CLOSER THAN THIS ENTRY ASSUMED.** Measured over the same three rosters: **288 of 297
non-empty cells — 97% — are read by `normaliseShift` alone** once the duty-code line is dropped. The
nine that are not: `PIDD TRG` ×4 (not in the prompt's vocabulary; it reads as UNKNOWN) and `NA` ×3 (decided by
the day from v24.22, and read by `normaliseShift` itself as a rest day since v25.38), plus `Until 10:30` and `Medical`, which genuinely want a person. Phase 3 would make the
97% PROVABLE rather than probable — a deterministic parser is testable in a way a model call is not,
which is what would finally close the "we cannot show the model normalises well" caveat phase 2 ships
with. **`NA` IS ANSWERED, and it is no longer one of the nine** — twice, because the first answer was the
wrong fact. v24.20 heard "usually only falls on a Sunday as it is uncontracted" and made `NA` a
Sunday rest day and a Mon–Sat question. The owner corrected it on 24 Sep 2026 (v24.22): **`NA` means
not available and always means absent**, written Monday to Saturday and a clerical error on a Sunday;
**`NS` is the Sunday code**, not available on a Sunday. So `NA`/`N/A` is the app's Absent day
Mon–Sat and `RD` on a Sunday (a Sunday cannot hold an absence), `NS` is `RD` on Sunday and `SICK` on a
weekday (the owner's second answer that day: a weekday `NS` is also absent), and the prompt still
reports the code rather than deciding — every answer depends on the column. **And a third time (v25.38):** on 6 Nov 2026
the owner ruled that `NA` and `NS` "should be treated as rest days on the roster uploader", Sundays
included, so both are `RD` on every day and the day no longer matters. The deterministic read is 291 of 297 rather than 288 — `NA` never needed the
model. `PIDD TRG` ×4, `Until 10:30` and `Medical` are what remain, and the last two genuinely want a
person.

### The v23.01 external review — the decisions it leaves with the owner (6 Sep 2026)
**Status:** An INDEX, not a work item · **Why:** a broad review arrived with eleven follow-ups, nine
of which are decisions rather than code, and a list held only in a conversation is a list that gets
re-raised · **Owner:** Gareth · **Trigger:** none for most; three cannot be taken before a date ·
**Review:** ~~28 Sep 2026, when the two measurements become readable~~ **both are read** — the service-worker question on 12 Sep and the fast path on 19 Sep. What is left in the table below is owner decisions only

**Two of its findings were CODE, and both are closed.** The no-install test lane had stopped being
no-install — `touch-gate-parity.test.mjs` reached its list through `e2e/helpers.js`, which imports
`@playwright/test` — and nothing ran that lane, so only somebody working from a ZIP could ever have
found it, which is who did. Fixed, with the lane now gated in CI. The other was this file
contradicting itself about the service-worker metrics, fixed the same day.

**One was REFUSED, on evidence** (moot since 26 Sep 2026, when the paint was retired). The review flagged the provisional cached-roster paint as a
security compromise: its scope is a localStorage session name, which is editable. True, and the
consequence does not follow — `firestore.rules` grants `overrides` read to any `name` claim, not per
member, because Team Week View shows every colleague's shifts to any signed-in member by design. A
forged session name shows an attacker a SUBSET of what that device can already read legitimately, so
the incremental disclosure is zero. Invariant 13's *"nothing of anybody else's"* is a scope-of-paint
property, not a confidentiality boundary. **Recording it as an accepted compromise would put a false
threat model into a contract**, which is worse than leaving it alone.

**Three items were re-raised without knowing they had been decided or measured**, which is the main
reason this section exists — so the next review's re-raises cost a link rather than a rebuild.

| The decision | Where it lives |
|---|---|
| Did the cached-roster fast path actually work? | **ANSWERED 19 Sep 2026 — it RARELY FIRES**: one open in roughly 800 eligible, row one of the pre-registered table, so the identity diagnosis stands. Kept by owner decision the same day, then **RETIRED 26 Sep 2026** (it could not beat Auth start-up, and shipped two defects); replaced at v24.59 by the own-roster copy, which does not wait on Auth. `LATENCY.md` → THE CLOSING READ · `DECISIONS.md` → "The provisional paint" |
| Is the service-worker revalidation storm costing staff anything? | **ANSWERED — no**, 12 Sep 2026. A full sweep (31+ files) was running on 78% of Calendar opens, and the card's own test is whether those boots are slower: **Worker busy 78% over a second against Shifts shown 78%.** Identical. The storm is real and costs the member nothing measurable. `LATENCY.md` → THE FULL-MONTH READ → item 4 |
| Move staff off the Pages mirror onto `myb-roster.web.app` | **NEW — no home before this row.** `web.app` is already canonical and the notification target (v14.29); what is undecided is moving the staff who still open the mirror. A first step has shipped: the `install-app-2026` notice (v24.91) sends phone users on the mirror to install from `myb-roster.web.app`, moving their Pay data first. KNOWN_LIMITATIONS measures the mirror's 21% byte penalty; nothing recorded the decision that measurement prices. It is the one change with two payoffs — fewer bytes on every cold load, and headers and redirects reaching the half of the staff that has neither. The cost is operational, not technical: telling colleagues and reinstalling from the canonical URL (see Address migration campaign) |
| Pay Calculator progressive disclosure on phones | **ALREADY DECLINED**, 3 Sep 2026 — see DECISIONS.md → "Pay Calculator — "More pay tools" grouping on phones — DECLINED", which took the same proposal through four drafts and a measured prototype. The review restates the observation the prototype answered (the page is long on a phone) and brings no new evidence, so the recorded trigger stands: **a staff report about the tail of the page**, which does not exist. Do not add instrumentation to test it |
| Links generator — Recommended first, Advanced second | Already an entry below, unchanged by this review |
| A small WebKit visual smoke set | **DONE — v23.71, 12 Sep 2026.** Six baselines on mobile-safari, report-only in branch CI (`e2e/visual-webkit.spec.js`, `npm run test:visual:webkit`), under `e2e/visual-baselines/webkit/`. **Calendar mobile is the one this row named that was NOT taken**: its fractional 390/7 columns are exactly why the Chromium lane excludes the month grid, a second engine does not repair that, and a flaky baseline is worse than none — the Calendar is represented by the day panel instead, which is a fixed-width overlay. Measured rather than assumed: six consecutive runs green and a full `=all` regeneration byte-identical, so the tolerance is Chromium's 0.001 and not the looser one the config first claimed was needed. ~15s per run |
| Print visual baselines | **DONE — v23.71, 12 Sep 2026.** Owner answered the fact only they had: **Calendar and Team View, first page only.** `e2e/print-visual.spec.js` renders the REAL PDF and rasterises page 1 with poppler, so what is compared is a picture of paper — margins applied, content clipped at the sheet boundary. `emulateMedia` was refused: it applies the print stylesheet but does not PAGINATE, so it cannot see the page break this row is about. Admin was dropped from the candidate list on the app's own evidence — it has no print control at all. It earned its place immediately by disproving this section's own correction above. Page COUNT is asserted separately, which catches the 24-pages-printed-8 class without pixel-locking 24 sheets |
| A real-iPhone release checklist | **WRITTEN — v24.07, `docs/IPHONE_RELEASE_CHECKLIST.md`.** Four devices as this row decided, each carrying only the checks it alone can do. Its entry condition is the row's own argument turned into a rule: a line belongs there ONLY if no test here can run it, so anything Playwright, axe or a baseline could answer goes to CI instead. Running it is the owner's, and nobody else can do that either |
| Freeze Calendar and Team View aesthetics | **DECLINED for now (owner, 19 Sep 2026).** The review's argument was that the v22.83–v22.99 sequence shows one narrow-width fix cascading into the next, and it is a fair reading of this file's own record. What it does not survive is the evidence since: v23.95 found the Calendar's last week UNREACHABLE below ~825px of viewport height at every desktop width, and the layout fix then exposed two contrast failures the viewport lock had been hiding. A freeze whose exceptions are "a reproduced defect or an accessibility finding" would have permitted all of that anyway — so the policy would have bought nothing on the one sequence that mattered, while discouraging the look at the surface that found it. **Revisit if a change lands here that is polish and nothing else**; the ROADMAP is the wrong instrument for a rule the evidence keeps overruling |
| Remove the real payslip fixture from the public mirror | **DONE — v23.71, 12 Sep 2026 (owner decision).** The review called it the largest remaining privacy problem and a second review kept Privacy at 7.5 while every other dimension moved. Closed by a route AUTH_ARCHITECTURE's own options list did not contain: the file left the REPOSITORY (gitignored `payslip-actuals.local.js`), rather than being synthesised or waiting on the mirror's retirement — `firebase.json` could only ever speak for one origin, and a gitignore is the rule both obey. The cost is real and stated rather than glossed: on any checkout but the owner's the payslip regression does not run, and `paycalc.test.mjs` announces exactly which assertions those are instead of letting a loop over an absent fixture quietly register nothing. **History was deliberately not rewritten** — KNOWN_LIMITATIONS carries that as an open item with the only thing that would close it |
| `ytd_2627` when it lapses (~26 Nov) | **DECIDED 13 Nov 2026 (owner): it expires** — no re-post and no replacement. The seasonal job is the Year to Date line under the take-home figure (v25.47), which comes back on each new payslip until that month's figures are entered. Recorded in the `new-notice` skill's table |
| Is a Daily Huddle's TEXT confidential? | **DECIDED 7 Sep 2026 — yes: the Huddle, the Circular and the Newsletter are not visible without the PIN or a password.** Built in two releases: the client stops reading without access first (v23.17, `calendar-doc-access.js` — the local cache is why a rule alone could not do it), the rules closed the three collections' reads at v23.18. What this does NOT do is revoke bearer URLs already in circulation (ARCHITECTURE EXC-007; AUTH_PLAN §5 E6). Was: recorded only in a `storage.rules` comment until this row (v23.05, measured 6 Sep 2026). Until v23.18 `firestore.rules` granted `huddles` a bare `allow read;`, so the converted `htmlContent` DOCX ingest writes to the document was readable unauthenticated; that is what this decision closed |

**What the review did NOT find is worth as much as what it did.** It read the code, the startup
architecture, the responsive CSS, the committed baselines, the print rules, both engines' test
configuration and the accessibility protections, and produced one code defect — in the test estate,
not the app.

### The print review — what shipped, and the four it leaves open (7 Sep 2026)

An external review treated print as a separate product surface and went deep. Everything below was
then re-checked by RENDERING PDFs and reading the page box and the text back, which changed three of
its conclusions. **Shipped at v23.20:** the pay estimate keeps its settings on paper (a collapsed
card printed a heading over nothing); five surfaces stop composing for US Letter; the railcard guide
stops printing a website link; FIP and Links no longer depend on `beforeprint` firing (measured: 8
printed pages instead of 24 when it does not); Team View's landscape follows the VIEW rather than
which button reached the printer; and the Daily Huddle is not printed at all (owner, 7 Sep — it had
been silently clipping a 40-row day plan to 30). `e2e/print.spec.js` holds all of it.

**Corrections worth keeping, because the review is otherwise reliable and these are the rows not to
act on twice.** An auto-layout table treats a cell `max-width` as a hint, so the name column grows
past its 88px and most names fit — which is what that measurement showed.

**BUT THE CORRECTION ITSELF WAS WRONG, and v23.71 disproved it on sight.** It read "no cell over its
box, no ellipsis in either orientation", and the second half does not follow from the first. The
column grows to ~157px, which fits twenty characters and not twenty-three: `R. Forrester-Blackstock`
printed as `R. Forrester-Black…`. **The measurement could not see it** — with `overflow: hidden` and
`text-overflow: ellipsis` a cell reports `scrollWidth === clientWidth` while the compositor draws
the ellipsis, so the box test returns true on a truncated cell (measured: 157 === 157 on that exact
cell). It was found by rasterising the first sheet, which is the whole argument for the print
baselines below. On screen the ellipsis is right; on paper it is unrecoverable, so the print rules
now let the name wrap, guarded in the BLOCKING lane by `e2e/print.spec.js` rather than only by the
report-only visual job. And its `beforeprint` prescription, taken literally, introduces a bug:
prepare then runs twice on every desktop browser, and the second snapshot leaves the page
permanently expanded. Both fixes are idempotent for that reason.

**Four items were owner decisions. All four are now closed — three done, one refused on evidence.**

| Item | The decision |
|---|---|
| FIP's 27-page print | **CLOSED — done at v24.06.** Every country card carries its own `⤓ Print <country>` at the bottom of what you just read. Measured on the real PDF: 25 sheets → 1, the banner kept so the sheet says which guide it is from, the country NAMED (the full print then hid every `summary`; since 10 Nov 2026 it names every card too, because thirty country cards share one section label), and the whole guide back afterwards. A CSS state, never a DOM edit, so a cancelled print cannot leave the guide short of a country. The row's own "27 pages" was stale: 25 since v23.27, and 27 again since 10 Nov 2026, the cost of naming every card |
| FIP's page count | **CLOSED — already done at v23.27, before this table was written.** `details { break-inside: auto }` with `.card, .box, tr` still protected, and `details > summary { break-after: avoid }` so a country heading is never the last thing on a sheet. Measured at the time: 27 → 25 pages. Nothing further to decide |
| Print provenance | **CLOSED — done at v24.06**, and it was not the tidiness the row took it for. There was a defect underneath: `Intl` spells September "Sept" in en-GB and three letters everywhere else, measured on Node, Chromium and WebKit, so Links, the Pay Calculator, Settings and the Operations error log disagreed with the calendar beside them, on screen as well as on paper. One vocabulary in `date-format.js`, one `printedStamp` for all the printable surfaces — and there were FIVE, not four: this row missed the Pay Calculator |
| Continuation identity | **CLOSED — WON'T DO, on evidence. It cannot be built in Chromium without destroying content.** See below |

**Why the running footer is refused (v24.06).** It was built, and then rendered to real PDFs — all five
guides, 48 sheets — which is the only way to see any of this, because `emulateMedia` applies the
print stylesheet without paginating. `@page` margin boxes (`@bottom-center`) are the CSS written for
a running footer and Chromium implements none of them, so the only element that repeats per sheet is
`position: fixed`. Three measurements, each the opposite of what the design assumed:

- **It is clipped at the page-area boundary, so it cannot live in the margin.** At `bottom: -2mm` the
  text printed cut in half; at −3mm and beyond it vanished from four sheets outright.
- **Widening `@page`'s bottom margin to make a lane for it does nothing** — the element is positioned
  against the page area and moves up with it. Tried at 20mm across all five guides: identical page
  counts, and the clearance above it got *narrower*. `padding-top` does not move it either.
- **So it must sit inside the page area, where it competes with the text.** On FIP page 22 it printed
  directly across a sentence, leaving both it and "…NS withdrawing from Hoek van Holland in 2017"
  unreadable. In a reference guide that is worse than the problem it solves.

It also costs ZERO sheets, which this table expected to be the trade-off — it cannot claim vertical
space, which is precisely why it overlaps.

**A methodological note worth more than the feature.** A positional check over the PDF's text boxes
reported that same page as *1.7pt clear*. It was wrong, and wrong in the direction that would have
shipped the defect: the filter selecting "words above the footer" excluded exactly the words the
footer was sitting on top of. **The rendered image was the check that worked**, and the numbers
agreed with it only once it had disagreed with them first.

**If it is wanted anyway, the shape that would work** is an IN-FLOW marker on each country card
rather than a fixed page footer — in the flow, so it can never overlap. Measured coverage on FIP:
23 of 25 sheets. Not every sheet, and it changes how every card looks on paper, so it is an owner
decision rather than a follow-up.

**Not done and not recommended:** printing the whole Operations or Admin page, and a print-provenance
version stamp on the Calendar — its header already carries the app name, the member and the date,
which is the part that matters on a detached sheet.

### From "Trains page — what comes after the preview" — the parts since done, decided or reworded

`trains.html` shipped at v24.71 as an **admin-only preview** of "what's changing": a countdown, the
daily totals, every route's trains before and after with the change in words, the basic hour side
by side, and a time lookup. By v24.80 it was station-first — ranked changes in a colleague's words,
a card per station, the basic hour as a stopping-pattern grid — and both timetables came from
Chiltern's published books, every stop included. **At v24.81 it opened to every member** (owner,
20 Oct 2026; DECISIONS.md). The ideas below were proposed with it (7 Oct 2026)
and deliberately not built yet; the ones since built are in ROADMAP_HISTORY.md → "Trains page —
preview items shipped". They are recorded so the page grows toward a plan rather than by accretion.

**A. Before 13 December — teaching the change.** **Trigger:** ~~the owner opens the preview to staff~~
**met 20 Oct 2026 (v24.81)** — these are ready to pick up, in whatever order the owner chooses.

- **The page changes over by itself.** *Its words already do (v24.83): from 13 December the first
  column is "Until 12 Dec", the lookup answers from the running timetable, and it says when both
  timetables have ended.* Still an idea: "What's changing" becoming "What changed" for the first few
  weeks, then **Next out** becoming the front of the page with the change material retired to a tab.
  `timetablePhase` (trains-change.js) is where that switch goes.
- **Next out** — today's day type and the next six departures with a countdown ("in 4 min"), full
  destination name, and (if the owner agrees to publish them) train length and planned platform.
  Works offline, so it is useful on the gateline away from the boards.

- **It knows its dates** — a preview before 13 December, and it must say it has ended at the May
  2027 change rather than quietly show old times. **Done at v24.83** (`timetablePhase`,
  `DEC_VALID_UNTIL`), found by the 21 Oct 2026 deep review, which also found the page counting one
  weekday train twice, timing "Coming back" at Marylebone instead of where the passenger gets on,
  and its grid showing one hour's stops as every hour's.
- **Christmas and bank holidays differ** — special timetables over Christmas and New Year and on
  bank holidays. The page should say so, not show the normal pattern. Chiltern's December books do
  not help: they say nothing about Christmas or bank holidays (checked 20 Oct 2026). **Since v24.80
  the page says so for Christmas:** Chiltern's timetable page states more changes between 13
  December and 10 January, "including significant changes over the Christmas and New Year period",
  and the overview names that window until it ends (`FURTHER_CHANGES_UNTIL`). **Still open:** the
  actual festive times, which will have to come from Chiltern's Christmas publicity — no 2026 detail
  was published when checked, and last year's pattern is not evidence for this one — and the bank
  holidays inside the books' validity (Good Friday, Easter Monday, the early-May holiday).

- ~~Staff on the PIN.~~ **DECIDED 22 Oct 2026 — the station PIN reads the page (v24.84; DECISIONS.md,
  AUTH_AND_SESSIONS.md invariant 24).** "Your shift", if it is built, still needs a sign-in: it is a
  member's own roster, and the PIN is nobody.
- Its place in the drawer — second after Calendar was the suggestion. Today a member sees it after
  Pay (and Overtime, where they have it), before Settings.

### From "Dispatcher pay calculator support" — the back-pay validation note

> **Validating the back-pay accrual against the real 24 Oct 2025 payslip has MOVED** to
> `VALIDATION_REGISTER.md` (August 2026). It was never a feature: nothing gets built, a payslip gets read.
> Sitting here between a pre-fill feature and Dispatcher rate support, it read like work to schedule
> rather than a figure to confirm — which is exactly how validation debt goes unpaid.

### From "Plain-English education pass" — Subject 1, shipped v22.57

**Subject 1 — SHIPPED v22.57: Sunday vs Rest Day Working.** Chosen because it produced a real
wrong estimate rather than a hypothetical one: a member put worked Sundays in Rest Day Working
(1.25×) instead of Sunday Working (1.5×), about £43 light on an eight-hour day. **The app already
had the fact, stated perfectly** — the Pay Calculator Guide's "Sunday vs RDW" tip says exactly the
right thing — and it did not help, because a guide has to be OPENED and she was reading the form.
That is this whole entry's premise demonstrated instead of argued, and it settles what the pass
actually does: **carry the fact to the point of use; do not write it again somewhere new.** The
mechanism was the payslip itself — a worked Sunday prints as "RDW Sun 1.5", so somebody matching
payslip lines to boxes lands on Rest Day Working, whose own subtitle described what they did. Fixed
in both directions (the redirect the Saturday row always had, plus "rostered or not" on the Sunday
row), the payslip's misleading word named where the mistake is made, and the `?` panel given the
same sentence. Held by `paycalc-copy-parity.test.mjs`, which pins the distinction rather than the
wording. **Next subjects, in order of evidence: HPP and back pay** (both already carry the "nobody
told me this exists" shape) — but wait for a real report rather than picking one.

### From the WATCH table — `firebase-admin` v14

| Watch | Because | Where |
|---|---|---|
| ~~`firebase-admin` v14~~ | **DONE v22.01** — `14.3.0` + `firebase-functions` `7.3.2`. v14 removes the namespaced `admin.*` API, so 59 call sites moved to the modular entry points first (on v13, green) and the version bump changed no code. The `uuid` override now matches nothing: since v25.25 (`firebase-admin` 14.5) `@google-cloud/storage` is 8.4.0 and `functions/package-lock.json` holds no `uuid`; it was removed at v25.35 | `KNOWN_LIMITATIONS.md`, `SECURITY_RELEASE_PLAN.md` → A1 |

---

## Removed features — full restoration specs

*(moved from ROADMAP.md lines 58–118)*


### Cultural calendar overlay ✗ (v11.06–v13.22 → removed v13.23)

**Removed at v13.23.** A per-staff optional setting that overlaid cultural or religious date markers as small emoji icons on matching days in the calendar. Staff selected one calendar from: Islamic, Hindu, Chinese lunisolar, Jamaican, Congolese, or Portuguese. Chosen calendar stored in `memberSettings` Firestore collection as a `faithCalendar` field. The Settings page had a radio-group card; selected icons appeared in the bottom-right corner of matching calendar day cells (`.day-faith`); the legend gained a full cultural row.

**Why removed:**
- **Annual maintenance burden** — 15 lunar/lunisolar datasets (Islamic, Hindu, Chinese) needed manually updating each November/December from external sources. Jamaican, Congolese, and Portuguese were rule-based but the Islamic/Hindu/Chinese sets were hardcoded year-by-year arrays.
- **GDPR exposure** — `faithCalendar` is a religious preference, which is special-category personal data under UK GDPR Article 9. No right-to-erasure flow was ever implemented. Low practical risk on a closed team app, but a real compliance liability.
- **Low observed usage** — no staff had asked for it or were known to use it. Staff have dedicated calendar apps that do this better.

**What it looked like:**
- `roster-data.js`: ~300 lines of date datasets + `resolveFaithCalendar()` / `getFaithBadge()` lookup functions
- `calendar-app.js`: read `memberSettings` from Firestore on calendar render; injected `.day-faith` spans into day cells; rendered a full legend row
- `settings-app.js` + `settings.html`: radio-group card with disclaimer text
- `shared.css`: ~75 lines of `.faith-radio-*` / `.religious-*` / `.calendar-active-tag` styles
- `firestore.rules`: `memberSettings` collection with per-member write isolation

**To bring back:**
1. Restore the dataset `const`s and lookup functions in `roster-data.js` (Islamic, Hindu, Chinese needed for current year; Jamaican/Congolese/Portuguese are rule-based)
2. Re-add the `memberSettings` Firestore collection rules (`faithCalendar` field, owner-only write)
3. Re-add the `initCulturalCalendarCard()` function to `settings-app.js` and the radio-group HTML to `settings.html`
4. Re-add `.day-faith` rendering in `calendar-app.js` calendar render loop and legend
5. Re-add shared CSS in `shared.css`
6. Implement a proper right-to-erasure path for the stored `faithCalendar` before re-deploying (e.g. a "Remove cultural calendar data" button in Settings)
7. Consider whether annual update maintenance can be automated (e.g. a Cloud Function that fetches dates from a public Islamic calendar API rather than hardcoded arrays)

---

### Profile photo / avatar ✗ (v12.12–v12.21 → removed v12.22) — full spec preserved for future restoration

**Removed at v12.22.** Feature was present from v12.12 (photo upload, display) through v12.21 (interactive reposition editor v12.19). Removed because it was non-vital and the interactive canvas editor was disproportionate complexity for a 26px badge. The nav-panel footer now shows initials on a stable per-name colour instead (`avatarInitials`/`avatarHue` from `roster-data.js`, painted directly in `nav-panel.js`). Firebase data cleanup required: delete `memberAvatars` collection docs and `avatars/` Storage objects via Firebase Console (no Admin SDK in client-side code).

**To restore:** check out the v12.21 tree and reverse the removal checklist below — but do NOT delete `avatarInitials`/`avatarHue` from `roster-data.js`: that step was never applied, and the initials badge has used both since v12.22.

A member's optional profile photo — a circular badge in the nav-drawer footer (and the photo in the About panel), with an initials-on-colour fallback when no photo is set. Added v12.12; the **interactive reposition editor** (drag/pinch/zoom to frame the shot on a `<canvas>`) followed at v12.19.

**Status: explicitly non-vital.** It is a "nice to have" — staff's names become a photo in a menu. A decision may be taken later to remove it, or to simplify it back to what we had before the editor. This entry records that decision space and the exact revert path so it can be done cleanly.

**Honest assessment (deep review, v12.20):**
- The **display + storage + cross-device-sync layer is good, well-factored code** worth keeping regardless — the shared painter (`avatar.js`), the Storage-object + Firestore-pointer model (`firebase-client.js`), and the 3-layer sync (cache → Firestore refresh → live events).
- The **interactive editor is gold-plated for a non-vital feature.** It is ~350 of the feature's ~700 JS lines — canvas crop geometry, a Pointer-Events pinch/pan state machine, dpr-aware rendering, and a `ResizeObserver` refit. It is the highest-risk, hardest-to-maintain, untested part of the whole app, protecting a badge that renders at **26px**. At that size an off-centre face is invisible, so the precise reframing it buys is largely wasted, and it is the one chunk the owner cannot realistically debug unaided.

_(The "simplify instead of remove" options are moot — the feature was fully removed at v12.22. The checklist below is the historical REMOVAL record, applied at v12.22 except for `avatarInitials`/`avatarHue`, which stayed for the initials badge; restoring means reversing it.)_

**Full-revert checklist (back to no avatar feature at all):**
- **Delete files:** `avatar.js`, `settings-avatar.js`.
- **`firebase-client.js`:** delete the "Profile Avatars" block (`avatarStoragePath`, `uploadAvatar`, `deleteAvatar`, `fetchAvatarUrl`). Keep `_getStorageSdk` — shared with `uploadHuddle`.
- **`roster-data.js`:** delete `avatarInitials` + `avatarHue`.
- **`nav-panel.js`:** remove the avatar import line, `_avatarSettled` / `_avatarLiveBound` flags, `_paintLbAvatar`, the live-update listener block, and the avatar paint block; **restore the footer `👤` glyph** in place of `<span id="navPanelAvatar">` (the span replaced that glyph).
- **`settings-app.js`:** remove the `initAvatarCard` import + call (and its `initCardCollapse('profileToggleHeader'…)`).
- **`settings.html`:** remove the whole Profile card.
- **All 6 HTML pages:** remove the `<div id="lightboxAvatar" class="lightbox-avatar-badge">` line from each About lightbox (keep `<img id="lightboxAppIcon">`).
- **CSS:** `settings.css` Profile + editor block; `shared.css` `.lightbox-avatar-badge` and `.nav-panel-avatar` rules.
- **`service-worker.js`:** remove `avatar.js` + `settings-avatar.js` from both asset lists; **bump APP_VERSION** (else `sw-asset-check.test.mjs` fails).
- **Rules:** remove `match /avatars/{fileName}` (`storage.rules`) and `match /memberAvatars/{memberName}` (`firestore.rules`); needs a rules deploy to take effect.
- **Docs:** remove the `avatar.js` / `settings-avatar.js` rows and the "Profile photo / avatar" decision row + `memberAvatars` block from `CLAUDE.md`; the `settings-avatar.js` entry from `AI_MAP.md`; this ROADMAP entry. The pre-commit hook enforces CLAUDE.md + AI_MAP updates on module deletion.
- **Leftover data (not code):** existing `avatars/*.jpg` Storage objects and `memberAvatars/*` docs become orphaned (harmless; purge manually if desired).

**Footprint:** ~865 lines total (~700 JS), spread as: `settings-avatar.js` 504 · `firebase-client.js` ~86 · `avatar.js` 51 · `settings.css` ~108 · `nav-panel.js` ~60 · `shared.css` ~52 · `settings.html` ~42 · `roster-data.js` ~20 · rules ~38 · misc (6 HTML lines, SW, settings-app) ~14.

---

---


## Tried and held back — the UX experiments

*(moved from ROADMAP.md lines 120–225)*

## UX experiments — explored but held back

Ideas that were prototyped and reverted. Implementation notes preserved here so they can be restored quickly if the case for them changes.

### FIP faceted filtering ("which countries need a supplement?")
**Status:** WON'T-DO (assessed Jul 2026, v19.10). Raised by an external review as *"add stronger country/operator filtering to the FIP handbook"* — but **the search half of that ask already shipped at v17.64** and the reviewer could not see it: their browser was policy-blocked from loading any URL, so the page was assessed from source alone. Re-raise only with new evidence, not from a static read of `fip-guide.html`.

**What already exists (`fip-guide.js` → country finder).** A search box live-filters all 25 country cards **and** the A–Z jump chips against each card's full `textContent`, so an operator or train name finds its country. Placeholder: *"Search a country or operator — e.g. Spain, ÖBB, Railjet"*. Plus a "Popular from Marylebone" shortcut row, live result count, clear button, Escape-to-clear, a no-match message, print handling that un-hides filtered cards, and graceful degradation with JS off.

**What genuinely does not exist** is filtering by *property* rather than by name — *"which countries need a supplement?"*, *"where do my coupons work?"* Free text cannot answer those, measured across the 25 cards:

| search term | cards matched |
|---|---|
| `fip` | 25 / 25 |
| `coupon` | 22 / 25 |
| `ticket` | 22 / 25 |
| `Railjet` | 2 / 25 |
| `Liechtenstein` | 1 / 25 |

Proper nouns are sharp; the words staff would actually filter by are noise. **And worse than noise:** Ireland's card reads *"**No** high-speed supplements"*, so a search for `supplement` returns a country where **none applies**. Substring matching cannot distinguish presence from absence, and this is a money question.

**Why it is held back.** Doing it properly means tagging each card with structured attributes (`data-supplement="yes|no"`, `data-coupons`, …). **Every such tag is a factual assertion**, and under this repo's own governance every high-risk FIP claim needs a `GUIDE_SOURCES.md` row with a source and review date. The cost is therefore not the UI — it is ~50–75 new machine-readable claims to source and re-review annually, on the page where a wrong fact strands someone abroad or costs them at a barrier. Set against `.claude/rules/guide-pages.md`: *"fip-guide.html is a low-frequency educational reference — not a core workflow… Do not flag reference-page format as a design defect."*

**What would change the decision:** evidence that staff actually ask property questions of this page (the `guide-fip` open counter in the Operations Usage card is the only signal we collect, and it counts opens, not intent). If facets are ever built, tag a **small** set of genuinely decision-changing properties and register each in GUIDE_SOURCES — do not tag everything a card mentions.

### Bottom navigation bar
**Status:** Prototyped at v7.66, reverted — felt like clutter at current scale. Case reassessed v10.01 — not needed, navigation is complete without it. Navigation overhaul (v10.57–v10.71) added a slide-out nav panel that covers cross-page navigation, guide links, sign-out, and notifications — this need is now fully met. **Do not revisit.**

A fixed tab bar at the bottom of the screen on mobile with three items:
📅 Roster · 💷 Pay · 🔐 Admin

The active tab would be highlighted in gold; all three pages would share the same bar via shared.css.

**Why it was held back:**
Cross-page navigation is already complete without a universal nav bar:
- The calendar controls row has dedicated **Pay** and **Admin** buttons
- Both the pay calculator and admin pages have a **back button** that returns to the calendar
- PWA long-press shortcuts cover Calendar / Pay / Admin for installed users

Adding a persistent nav bar introduces two layout problems with no navigational payoff:
1. **Calendar screen real estate** — a fixed bottom bar on mobile takes ~50px from the calendar grid, which is the primary content staff use every day
2. **Sticky pay total conflict** — the pay calculator already has a fixed bar at the bottom showing the take-home total. Two competing fixed bars at the bottom of the same page is poor UX

**When to revisit:**
- If the controls row is simplified and loses the dedicated Pay/Admin buttons
- If a new page is added that doesn't fit the current hub-and-spoke pattern
- If the sticky pay total bar is removed or redesigned

**Note:** Team Week View (v8.22) is an in-page view within the calendar — it does not replace cross-page navigation between Calendar / Pay / Admin.

_(Implementation-notes restore-kit dropped — this is a "do not revisit" idea; recover from git history if the case ever changes.)_

### Glanceable summary strip
**Status:** Prototyped at v7.66, reverted — adds clutter above the calendar

A horizontal scrolling row of four white pill chips below the controls, shown only when logged in:

| Chip | Source | Notes |
|------|--------|-------|
| **Today** | Base roster + override cache | Offline-first; shows type or start time |
| **Next RD** | Base roster scan (90 days) | Override cache applied where available |
| **Leave left** | Firestore (async) | Shows "…" until loaded; fires once per member |
| **Payday** | `getPaydaysAndCutoffs()` | Offline; shows date + days remaining |

**Why it was held back:**
On a phone the calendar itself is the primary information — the strip adds a layer of noise between the controls and the calendar grid. The same information is already reachable (AL via the 🏖️ AL button; payday from the pay period strip; today's shift from the calendar cell itself).

**When to revisit:**
- If staff on longer shifts want a "what am I doing today?" glance without scrolling to find today's cell
- If the pay period strip is removed (the strip was partly redundant with it)
- Consider putting it *inside* the controls card as a collapsed/expandable panel rather than between controls and calendar

**Implementation notes (already written, can be restored):**
- HTML: four `<div class="sc">` chips in `<div id="summaryStrip">` after `#payPeriodStrip`
- CSS: `.summary-strip` (flex, overflow-x: auto), `.sc`, `.sc-label`, `.sc-val`
- JS: `updateSummaryStrip()` in calendar-app.js — called from `renderCalendar()`
- The AL query is de-duplicated via `_summaryALFetched` flag, reset in `clearMemberCaches()`
- All data sources are already imported — no new dependencies needed

### Full-bleed navy header (calendar page)
**✓ Shipped at v11.69** — see the "Navy header — unified chrome" bullet under "Cross-page / navy-chrome / typography consistency passes" above. Implemented as transparent/canvas chrome (not negative-margin full-bleed), unified across all six app pages (links joined at v12.07); the icon-on-navy blocker was resolved by the icon processing in the same session. (No longer a held-back experiment; the earlier full-bleed CSS restore-kit was dropped as dead once this shipped.)

### Calendar cell type hierarchy
**Status:** Built at v11.57, reverted — needs more consideration before shipping.

The calendar day cell has two competing elements: the `.day-number` (date) and the `.shift-badge` (shift type). At v11.57 the hierarchy was inverted so the shift badge reads as primary — the date quieter and supporting — on the theory that on any given day the shift type is what staff actually need to identify at a glance.

**What was built (v11.57):**
- `.day-number`: `font-size: 20px; font-weight: 700; color: var(--text-dark)` → `font-size: 14px; font-weight: 500; color: var(--text-mid)` — quieter, supporting role
- `.calendar-day:active .shift-badge`: `transform: scale(0.94)` → `transform: scale(var(--press-scale))` — wired to the unified press token so the reduced-motion override works correctly

**Why it was held back:**
- Needs broader review before committing — the date is also important context (particularly for spotting upcoming RDs and AL days across the month at a glance), and shrinking it significantly changes how the grid reads at the month level.
- The press-scale fix is a safe, independent change and could be shipped on its own.

**When to revisit:**
- Review the calendar grid in real daily use with both sizes side by side — compare scanning for a specific date vs identifying shift patterns across a week.
- If revisting: consider whether a middle position (e.g. 16px/600) is a better balance than the full step down to 14px/500.

**Implementation notes:** shrink `.day-number` to 14px/500/`--text-mid`. The independent press-scale
fix (`scale(0.94)` → `scale(var(--press-scale))`) is a clean no-visual-change tidy that lets the
`prefers-reduced-motion` override suppress the badge press too — shippable on its own. (Full CSS in
git if revisited.)

---


---


## Design audit — April 2026 (complete)

*(moved from ROADMAP.md lines 226–264)*

## Design audit — April 2026

Design review against a 10-point modernisation list. Already well-implemented: shadows (minimal, 10% opacity), 5-tier type scale (`--type-micro` → `--type-large`), motion tokens, WCAG AA colour contrast across all shift types, touch targets, safe-area padding, and reduced-motion support. Navigation was the one real gap — addressed by the nav panel overhaul (v10.57). **Shipped from this audit:** Pay result hierarchy (v7.67) — period line and hint text brightened from 72%/48% to 88%/62% opacity.

### Design — low-risk visual wins (planned June 2026) — ✅ COMPLETE (audited v16.30)

A short batch of **no/low-risk, additive-CSS** polish items. Reviewed v16.30: most were already
shipped incrementally; the batch is now closed. Higher-effort/higher-risk ideas (View Transitions on
the swipe carousel, `:has()` state refactors, container queries, an SVG icon set, dark mode) remain
deliberately **excluded** — tracked under Future capabilities / UX experiments.

1. **Tabular numerals on data** — ✅ **DONE** (shipped incrementally; verified v16.29).
   `font-variant-numeric: tabular-nums` is live on every intended surface: all Pay Calculator
   figures (`.net-amount`, `.sum-row .val`, `.b-val`, `.bp-val`, `.hpp-amount`, `.sticky-amount` in
   `paycalc.css`), calendar shift times (`index.css`, v14.54), and admin AL/date counts (`admin.css`).
2. **`text-wrap: balance` on headings, `text-wrap: pretty` on paragraphs** — ✅ **DONE.** Live on all
   6 app pages via `shared.css` (`:where(h1..h6){balance}` / `p{pretty}`), and extended to the four
   guide pages via `guide-shell.css` (v16.30 — they don't import `shared.css`).
3. **Display-heading typography** — ✅ **DONE / N-A.** Every genuinely-large heading already carries
   display-appropriate negative tracking (`.app-header h1` −0.3px, `.month-year` −0.5px, `.net-amount`
   −2px). The proposed fluid `clamp()` on `--type-xl` was **dropped**: that token is used in exactly one
   place (an operations heading), so a clamp buys nothing and would only add a shared-token risk.
4. **Motion completeness audit** — ✅ **DONE.** All keyframe animations (`todayPulse`, `sync-pulse`,
   `shimmer`, `pulse-confirm`, `spin` — and `beta-sheen`, until the Links beta chip it belonged to
   was removed at v19.50) already sit behind `prefers-reduced-motion`
   guards, plus the shared press-scale override. The optional global `scroll-behavior: smooth` was
   **skipped** (optional; changes scroll feel app-wide for marginal benefit).
5. **Focus-visible / tap-target audit** — ✅ **DONE (audit-led).** Focus: fully covered — a
   zero-specificity safety net in `shared.css` rings every button/link/`[role=button]`, on top of ~60
   explicit `:focus-visible` rules; guides carry their own. Tap targets: every primary and
   mobile-facing control meets the 44px minimum (explicit `min-height/width:44px` on lightbox close,
   burger, week-nav, range-picker, type-pills, help, guide buttons). The only sub-44px controls are
   niche **desktop-admin/designer** controls — the ✎/✕ chip buttons (`links.css`, 3 designers) and the
   `.roster-tick` (`operations.css`, admin) — where a proper 44px fix needs spacing/resizing (the ✎/✕
   sit adjacent, so equal 44px hit areas would overlap). That's a layout change this batch explicitly
   excludes, so they are **left as-is by design** (mouse-driven admin surfaces, not mobile thumbs).

---


---


## First-run onboarding (shipped v15.10–v15.12)

*(moved from ROADMAP.md lines 265–286)*

## First-run onboarding usability (from the UX + v15.07 reviews) — SHIPPED v15.10–v15.12

Small, high-value first-use fixes for a brand-new, non-technical staff member. All copy /
first-run-state changes — no data-model or auth change.

1. **First-run "choose your name" state (H1) — ✓ SHIPPED v15.11.** A fresh visitor (no saved member
   AND no session) previously saw the default member's roster with no cue it wasn't theirs. Now
   `isFirstRun()` (calendar-member.js) drives a "👋 Choose your name to see your shifts" prompt —
   guarded at the top of `renderCalendar()` so every render path (init, initial-fetch re-render, swipe)
   respects it; the dropdown leads with a "— Choose your name —" placeholder. Picking a name renders
   normally and is one-time. Distinct from the stale-member banner path.
2. **Sign-in password helper (H2) — ✓ SHIPPED v15.10.** A helper line under the login password field
   ("Initial password: your surname in lowercase, no spaces."), wired via `aria-describedby`. Shared
   overlay → all 5 protected pages. Not a secret (protection is rate-limiting + rules).
3. **Pay Calculator first-use reframe (M3) — ✓ SHIPPED v15.12 (copy refined v15.14).** The setup
   banner was reworded from "Enter your…" to "👋 Estimate your take-home — we've filled in the usual
   defaults; check your hourly rate and tax code, then tap **Save settings**; you can add your hours
   with **Fill from calendar**" (JS-set + static). The v15.14 pass named **Save settings** as the step
   that actually dismisses the banner (it writes the settings key; Fill-from-calendar does not).

---


---


## Pay-calculator items shipped out of the future list

*(moved from ROADMAP.md lines 314–338)*

### ✓ DONE (v17.16): student-loan payslip integration tests

Shipped as part of the statutory-deductions patch: Plan 1 was confirmed, and `paycalc.test.mjs` now
asserts `computeSL` against every clean `sl` value in `PAYSLIP_ACTUALS` (the regression that locks
the HMRC rounding method — the £214-vs-£213 P2 case). See `.claude/rules/paycalc.md` → Statutory
deductions.

---

### ~~Deferred: mid-year pension step for 2025/26~~ — SHIPPED v18.43

**Shipped (v18.43 — review item 8).** The "can't be read from the repo" blocker turned out to be
wrong: the per-payslip pension IS derivable from `PAYSLIP_ACTUALS` as
`pension ≈ basic (140 × era rate) + varPay − Taxable Pay` — the derivation self-validates by
reproducing both payslip-confirmed values (£160.78 Apr–Jul 2025, £154.77 from 29 Aug 2025) in the
right eras with a consistent reconstruction bias. The old two-value `pensionPre`/`pensionFrom` pair
was generalised to the **`PENSION_STEPS`** table in `paycalc-calc.js` (newest-first, null-from
floor; `getPensionForPeriod` walks it): £160.78 → **£156.29 on the 1 Aug 2025 payslip** (a
transitional value matching NEITHER era — DERIVED, not read; correct it from the real payslip's
`Smart RPS CR Scheme` line if ever checked) → £154.77 from 29 Aug 2025 → £147.36 from 8 May 2026.
Historic 2025/26 periods now default the right pension (the ~£6 take-home overstatement is gone),
and the year-so-far summary inherits the fix via `getPensionDefault`. The companion
KNOWN_LIMITATIONS deferral ("pension default is frozen onto a touched period") was closed in the
same change — `readFormData` stores `null` when the field still equals the period's default.
---

---


## Notification badge asset (done)

*(moved from ROADMAP.md lines 412–414)*

### Notification badge — monochrome silhouette asset — ✅ DONE
`icon-badge.png` (white-on-transparent, 96px) shipped, SW-precached, used by the push handler.
Rule ("never use `icon-192.png` as the badge") lives in `.claude/rules/notifications.md`. No further work.

---


## Password security — the original five-stage design

*(moved from ROADMAP.md lines 462–498)*

**Stage 1 — Work email registration ✓ (v12.68)**
Settings page → Work Email card. Staff enter their Chiltern work email. Saved to the new `staffContact` Firestore collection (owner-only write via `name` JWT claim; admin read-all). This is the data foundation all later stages build on. Work email only — no personal email (the company already holds the work address; no separate GDPR policy required for something Chiltern already processes).

**Stage 2 — Email verification**
Send a 6-digit time-limited code to the registered work email when the member taps "Verify" in the Work Email card. A Cloud Function (extend `setupRosterAuth` or add a new `verifyContactEmail` function) sends the email via Power Automate relay (already used for Huddle ingest) or Firebase Trigger Email, and marks `staffContact.verified = true` on correct code entry. **The client cannot set `verified` itself** — the flag must be server-set via Cloud Function to prevent self-verification without genuine email access.

*Decisions needed before building:* code expiry window (10 minutes is standard); retry/rate-limit policy; whether to allow email correction before verification (or require admin contact if the wrong address was saved).

**Stage 3 — Self-service password change (while logged in)** — ✅ SHIPPED v18.63 (Track C, decoupled from Stage 2)
A dedicated **Password card** in Settings (not gated on email verification — that decoupling is the "C-lite" change). Member enters their current password + new password twice → `reauthenticateWithPassword` + `setOwnPassword` (`updatePassword` + `savePasswordSetAt`) via Firebase Auth.

*Critical prerequisite — `ensureFirebaseSession` rework:* ✅ DONE v18.63. `credentialCandidatesFor(fullName, typed)` (`auth-identity.js`) builds an ordered candidate list (typed password first, surname fallback only while still on it) and `ensureFirebaseSession` tries each — so a member on a self-set password authenticates without landing on anonymous. *(Original problem, for context:)* The old implementation assumed `password = normaliseSurname(name)` and silently fell back to an anonymous session on failure. A member who has set a custom password will have `ensureFirebaseSession` try the surname, fail, and land on an anonymous session — they will appear not logged in to Firestore writes even though their localStorage session is valid. **Before Stage 3 ships**, `ensureFirebaseSession` must be updated to detect this case: catch `auth/wrong-password` / `auth/invalid-credential` specifically and surface a "Please sign in again" prompt rather than silently falling back to anonymous.

*Ordering:* Stage 4 (reset path) should ship before or alongside Stage 3 so a member who forgets their custom password has a self-service recovery route and does not have to contact admin.

**Stage 4 — Forgotten-password reset (self-service)**
Recovery flow without admin involvement: a "Forgot password?" link on the login screen → member selects their name → Cloud Function looks up `staffContact.workEmail` where `verified == true` → sends a one-time 6-digit code → member enters the code + chooses a new password → Cloud Function calls `admin.auth().updateUser(uid, { password })` via Firebase Admin SDK.

Code expires after 10 minutes; 3 failed attempts invalidate it (member must request a new code). The reset endpoint must be a Cloud Function — client-side `sendPasswordResetEmail` sends to the synthetic Firebase Auth email (`name@myb-roster.firebaseapp.com`), not the member's real work address.

**Admin break-glass:** ✅ SHIPPED v18.63. Operations page → **Account status** → **Reset** → the `resetMemberPassword` Cloud Function resets a member's password to the surname default (and revokes their refresh tokens by default). Always available regardless of verification status. Use when a member cannot access their work email or is locked out during rollout.

**Stage 5 — Retire the surname password**
Once Stages 2–4 are live and staff have had adequate time to migrate:
1. Show a persistent Settings banner to any member still on the surname-derived password, prompting a change.
2. Remove the surname-password seed from `setupRosterAuth` new-starter setup — new starters receive a temporary code via work email instead.
3. Remove the surname fallback from `ensureFirebaseSession`.

*This stage is irreversible* — once the surname fallback is removed, staff without a custom password can only recover via Stage 4 (or the admin break-glass reset). Do not ship Stage 5 until ≥90% of active accounts have set a custom password (monitor via the **`passwordStatus`** collection — a doc with `passwordSetAt >= resetAt` = migrated — vs active `teamMembers`; the Operations Account-status card already renders this count. The old `staffContact.verified` field was never built).

---

**Shared architecture notes (Stage 2 onward):**
- `staffContact` writes require the `name` JWT claim set by `setupRosterAuth`. Anonymous fallback sessions lack this claim — the Settings UI already shows a `permission-denied` error prompting sign-out and back in. This is intentional.
- All sensitive operations (send code, verify code, update password) must go through Cloud Functions with the Firebase Admin SDK. Never trust the client to set security-relevant fields (`verified`, `password`).
- Stages 3–5 require end-to-end testing on Android Chrome (primary platform) and iOS Safari standalone before shipping.


---


## Per-member override write isolation (shipped strict)

*(moved from ROADMAP.md lines 602–622)*

## Security project — per-member override write isolation

**Now SHIPPED (strict) and tracked in `SECURITY_RELEASE_PLAN.md` (phases B2/B3) — this section is a
pointer, not the live plan.** `overrides` writes require the member's own `name` claim (with
admin + manager bypass) so a signed-in member can only write their own overrides. Tried at v10.72,
**suspended at v10.94 after a production outage** (post-mortem: "The four v11 security tasks", task #2, below), then
rebuilt as the three-tier permissive rule **B2 (built v14.53)**, and made **strict (B3, shipped v16.29)** —
the legacy no-name escape branch has been removed, so overrides create/update/delete now require
`token.name == memberName || token.admin || token.manager`.

Two load-bearing facts that survive here so they aren't lost when reading the roadmap alone:
- **The admin/manager bypass is load-bearing, not optional.** Admin + managers write overrides for
  *other* members constantly (AL/sick on their behalf; every `source:'roster_import'` upload). The
  rule must keep `|| admin || manager` or roster upload and on-behalf booking break.
- **The one real rollout risk is cached tokens, not code.** A valid 30-day session carries a token
  minted before the claim existed; a strict rule would fail its writes until re-auth — essentially
  the v10.94 outage. B3 handled this with the permissive→strict `CLAIM_EPOCH` token-refresh sweep
  (`CONFIG.CLAIM_EPOCH = 2`), and stale tokens self-heal via `writeWithClaimRetry` on the write path.

Full staged plan and deploy runbook: **`SECURITY_RELEASE_PLAN.md` → B2/B3** (B3 strict cutover shipped v16.29).


---


## Deferred security/reliability backlog (v14.11 review)

*(moved from ROADMAP.md lines 625–710)*

## Deferred security/reliability backlog (from the v14.11 external review)

The v14.11 external security review confirmed the release-readiness blockers (fixed in v14.13:
ESLint gate, the `spare_shift`/`correction` rule-vs-app contract, and the Rules/Functions
workflows now run the canonical gate). The items below were assessed as **real but not
deployment blockers** and deliberately deferred. Captured here so they survive between sessions.
Roughly ordered by value-to-effort.

### Next maintenance release (bug-class) — ✓ SHIPPED (v14.23–v14.28)

All shipped with tests across v14.23–v14.28: push-subscription auth race (shared `calendarAuthReady`);
VAPID rotation (unsubscribe-before-subscribe); orphaned-Storage cleanup on repeat Huddle uploads;
paycalc namespace ownership prompt (no silent first-loader claim); Huddle download-URL validation
(`isSafeStorageUrl`, bucket-narrowed); overlapping Sunday-correction deletion (`computePeriodDeleteIds`);
tightened Firestore field schemas (overrides/push-sub/analytics); roster-parse empty-after-filter
check; file-signature (magic-byte) checks. Plus the v14.26 delta: `getSession()` expiry now signs
Firebase out too, pinned roster-transition tests, and the Calendar duplicate-retry-listener fix.

**Deferred sub-parts of the schema work:** the Chiltern work-email DOMAIN check on `staffContact`
(now **done, v14.97**) and the `storagePath` prefix check (low value, still open).

### Dedicated security release (the big authorisation project)

> **Master sequencing + risk doc: `SECURITY_RELEASE_PLAN.md`.** The items below are the
> *scope*; that file is the *order* — the dependency graph, the permissive→strict token-refresh
> migration that avoids re-creating the v10.94 outage, the hard "never enforce App Check during
> the isolation rollout" constraint, and the owner-decision checklist. Read it before starting
> any item here.

These are interlocking; most remain and should ship together, but the headline gap is now closed:
- **Per-member override + Links write isolation — ✓ DONE (v16.29).** The headline authorisation
  gap, closed: override isolation strict (B3) + Links designer-claim writes (H2) in the same
  release. Full history: the "Security project — per-member override write isolation" section
  above; live rule detail: SECURITY_RELEASE_PLAN.md B2/B3.
- **Separate named sessions from the anonymous public session** — ✓ **effectively SHIPPED via B1**
  (`ENFORCE_NAMED_SESSION = true`, v14.98). Anonymous auth is already confined to the public Calendar
  read bootstrap (`calendarAuthReady`); the four write pages (Admin/Operations/Links/Settings) already
  refuse the anonymous fallback and re-prompt a named login, and Pay stays soft (it writes no isolated
  data). B1.1 (v14.40) removed the anonymous fallback + self-heal from `ensureFirebaseSession` on the
  write path. **One dormant residual, deliberately held:** the `signInAnonymously` fallback branch and
  the `CONFIG.ENFORCE_NAMED_SESSION` flag still physically exist in `session.js` — the fallback is
  unreachable *while the flag is on*, so retiring both (and making named-only permanent) is pure dead-
  code removal, **not** a behaviour change. It is being left in place on purpose: the flag is the
  one-line, no-rules-deploy rollback for the whole B1/B2/B3 named-session + isolation release, and the
  release is still soaking. **Do it only after a few weeks of clean production running** and once
  self-service recovery (C4) reduces the value of an instant rollback. Retirement scope + checklist:
  SECURITY_RELEASE_PLAN.md → "B1 detailed scope" → "Deferred residual". *(Retired v24.34: the flag,
  the fallback and the self-heal are all gone.)*
- **Remove browser-side account creation** — ✓ **effectively DONE via B1.1** (v14.40):
  `ensureFirebaseSession` no longer self-creates a Firebase account with `createUserWithEmailAndPassword`
  on the write path. The provisioning prerequisite (every member has a server account before B1) is in
  place, and `/new-starter` marks "Set up accounts" mandatory. Same dormant residual as above — the
  self-heal `create` call sits alongside the anonymous fallback under the `ENFORCE_NAMED_SESSION` guard
  and is retired in the same cleanup.
- **Server-owned roster/role lists (B4)** — ✅ **SHIPPED v16.30.** `setupRosterAuth` reads the member
  + admin/manager/designer lists from `roster-members.json` (generated from `roster-data.js`,
  CI-locked) instead of the client payload, with dry-run orphan removal (preview → confirm), refresh-
  token revocation on disable, and fail-closed guards on an empty admin/members config.
- **Surname-password retirement** — the existing five-stage plan (verify work email → change →
  recovery → migrate → retire) under "Password security — the original five-stage design" (now
  `PASSWORD_DESIGN.md`); do not rush, since locking
  staff out of the core roster is a bigger operational risk than the present small-team model.

### Infrastructure phase

- **App Check (monitor-first)** — register live domains, configure CI/dev debug tokens, observe,
  then enforce Firestore → Storage → browser-called Functions. (Note: a separate "considered and
  declined" assessment for the *current* threat model is in KNOWN_LIMITATIONS.md; revisit if the app
  is advertised more widely or becomes official infrastructure.)
- **Workload Identity Federation** ✓ **DONE (A2, v14.93)** — all 3 deploy workflows authenticate via
  keyless GitHub OIDC/WIF; the long-lived `FIREBASE_SERVICE_ACCOUNT` JSON key + GitHub secret are
  both deleted. See SECURITY_RELEASE_PLAN.md → Appendix A2.
- **Header-capable staff hosting** — the GitHub Pages staff URL can't receive Firebase Hosting's
  security headers (CSP etc.); migrate to Firebase Hosting or a header-capable custom domain when
  auth is redesigned or the app is officially adopted.

### Documentation accuracy fixes ✓ (v14.37–v14.38)

Done: the `pushSubscriptions` delete posture and the bearer-URL read distinction (open Firestore
metadata read; Storage object reached via a tokenised URL that bypasses Storage rules) are stated
accurately in the docs + rule comments. **Since tightened (A5 / F-SEC-5, v17.76):** the delete rule is
now **per-owner** — an authenticated session may delete a subscription only if
`resource.data.owner == request.auth.uid` (or the legacy doc carries no `owner`), so merely knowing a
doc id no longer permits deletion. (This superseded the earlier "any authenticated identity that knows
the doc id" posture described above.)

---


---


## Usage analytics (shipped v14.14)

*(moved from ROADMAP.md lines 711–728)*

## Usage analytics ✓ (v14.14)

Anonymous usage visibility in the Operations page (📊 Usage card): active-account counts + page
popularity. Built first-party in Firestore — **not** Google/Firebase Analytics, which would breach
the `script-src 'self'` CSP and the no-third-party-CDN rule and ship data to Google. The full data
model (client-side dedup, no identity stored server-side, collection shape, module split) is
documented canonically in **CLAUDE.md → `analytics` collection** — this entry records the decisions,
not the model.

**Known limits (intentional):** counts are per account-device, so a multi-device user counts more
than once — it's a usage *trend*, not a precise headcount. Dedup trusts the client (App Check is the
eventual integrity backstop). Both are acceptable for the small-team, unadvertised threat model.

**Possible later:** per-month page-popularity history/trends; an all-time page total; a true
device-independent unique count (would require server-side identity — deliberately not done).

---


---


## Performance — the load-speed investigation

*(moved from ROADMAP.md lines 729–832)*

## Performance (load speed)

A deep, code-grounded performance pass (June 2026). **Measure cold loads with Lighthouse
mobile (throttled Slow-4G + 4× CPU) in a private window** before/after — the installed PWA
loads from the SW cache and hides the cold-load cost real first-time staff pay (same lesson as
"the installed PWA masks live-site breakage").

**Where we are (latency work current to v16.10) — two independent latency tracks:**
- **Cold page-load (this section):** Batches 1/3/4 shipped (preconnect, stale-while-revalidate JS/CSS,
  paycalc modulepreload). **Next:** the deferred lazy-Firebase pass below — but **only if** the
  App-speed data shows the Firebase SDK dominating paycalc's cold load; otherwise leave it.
- **Login latency (separate track):** the post-login `reload()` has been removed page-by-page
  (in-place login). **ROLLOUT COMPLETE — all five coordinators enabled: paycalc (v15.07), operations
  (v15.08), links (v15.09), admin (v15.16), settings (v15.17).** The per-page kill-switch in
  `CONFIG.INPLACE_LOGIN` still stands (set any key back to `false` to revert that page). Full plan:
  **AUTH_ARCHITECTURE.md → Phase 9**.

### Shipped

- **Batch 1 (v14.17) — preconnect + lazy DOMPurify + immutable icon caching.** All 6 app pages
  `preconnect` to `gstatic.com` (Firebase SDK) and `firestore.googleapis.com` (data) so DNS/TLS
  overlaps HTML parse. DOMPurify (~45 KB) is now dynamically imported only when a DOCX huddle's
  HTML is rendered (was static + modulepreloaded on every calendar load). PNG icons get immutable
  1-year caching. *Deliberately did NOT eager-`modulepreload` the Firebase SDK URLs — that would
  hard-code the SDK version into 6 HTML files with no test guard.*
- **Batch 3 (v14.18) — stale-while-revalidate for JS/CSS.** The SW was network-first for all app
  files, so every online load waited on ~30+ per-file round trips (cache was offline-only). JS/CSS
  are now served instantly from the version-pinned cache and refreshed in the background; HTML
  stayed network-first until v16.10 (see the v16.09–16.10 SW pass below). This was the biggest
  perceived-load win for the common case (returning installed-PWA staff).
- **Batch 4 (v14.94) — paycalc modulepreload (collapse the deepest waterfall).** `paycalc.html`
  declares its whole static import graph (~32 local modules **+ the 3 gstatic Firebase SDK URLs**)
  as `<link rel="modulepreload">` so the browser fetches everything in parallel from first HTML
  parse instead of discovering it file-by-file (paycalc has the deepest graph → the worst cold-load
  waterfall). `modulepreload` only fetches/compiles — no behaviour change. This is the one place
  Batch 1's "don't eager-preload the SDK URLs" caveat is reversed **because** it is now safe:
  `sw-asset-check.test.mjs` guards the list against the page's real transitive graph AND against the
  SDK version pinned in `firebase-client.js`, so it can't silently drift. **The two heaviest pages —
  paycalc AND the calendar (`index.html`) — now carry the FULL graph + SDK-URL preload** (~35 local
  modules + the 3 gstatic URLs each, both CI-locked); the four write pages deliberately have none
  (shallower graphs, less latency-critical) and rely on `preconnect` alone — `sw-asset-check.test.mjs`
  locks their zero-preload state too. There is **no plan to extend the preload further** — each
  page's SDK preload needs its own drift guard (the Batch 1 reason). **Let this settle** (watch the
  Operations App-speed data) before the deferred lazy-Firebase pass below. (Since superseded:
  links.html carries its full graph; the four write pages carry the three SDK preloads but no local
  ones.)

- **v16.09–v16.10 — service-worker deep pass (owner-approved architecture changes).** Navigation
  Preload, SWR-throttling, chunked warm-up, first-install double-load fix, redirect hygiene
  (v16.09); HTML joined JS/CSS as stale-while-revalidate and the gstatic Firebase SDK moved to a
  cache-first SDK-versioned cache (v16.10). The full current caching model is documented
  canonically in **CLAUDE.md → "Service worker caching"** — this entry is the shipped-batch record.
### Deferred — lazy-load the Firebase SDK off the calendar's first paint

**What:** `firebase-client.js` statically imports the 3 gstatic Firebase modules (firestore is the
single largest payload), and `calendar-app.js` reaches Firebase through *eight* static paths
(firebase-client, calendar-overrides, calendar-initial-fetch, calendar-huddle-viewer,
calendar-team-view, error-reporter, usage-reporter, **and nav-panel** — on every page). So the
calendar can't execute until the whole SDK downloads+parses, even though first paint only needs
local roster data. A true fix splits `calendar-overrides.js` (pure cache vs Firebase fetch — its
`rosterOverridesCache`/`getShiftTypesInMonth` are render-critical), makes `nav-panel.js`
lazy-import Firebase, and restructures the calendar init to paint first, then dynamically
`import()` the Firebase-dependent modules.

**Why deferred (not just unstarted):**
1. **Diminished benefit after Batches 1+3 (and further after v16.10).** Returning
   installed-PWA users now get app code instantly from the SWR cache, and the Firebase SDK
   is served cache-first from the SW's own `myb-roster-sdk-v*` cache (v16.10 — no longer
   just the evictable browser HTTP cache) — so they're already fast. Lazy Firebase mainly
   helps *first-time* loads, which are rare for staff who install once. Preconnect
   (Batch 1) already trims the cold-connection cost.
2. **High risk on the two most-used surfaces** (calendar + nav-panel), with subtle failure modes
   (overrides silently not loading, auth race, sync chip stuck).
3. **The automated gates can't validate it** — the e2e suite stubs Firebase at the network layer,
   so it would pass even if the deferred-Firebase timing were broken. It needs real-device
   cold-load + real-data verification.

**Decision:** only pursue if a cold-load Lighthouse profile shows the Firebase SDK dominating TTI
*and* it's worth a dedicated branch with real-device verification. Otherwise leave as-is.

> **Reviewers keep re-suggesting "lazy-import Firebase in `nav-panel.js`" as a standalone win —
> it is worth ZERO in isolation, do not do it on its own.** Every page that renders the nav drawer
> already pulls the Firebase SDK through other static imports (`calendar-app.js` reaches it via seven
> paths besides nav-panel; `admin`/`operations`/`links`/`settings` import `firebase-client.js`
> directly; `paycalc` via `session.js`). So deferring Firebase in nav-panel alone removes nothing from
> any page's module graph — it only converts the synchronous bell render (`notifSupported()`) and the
> circular/newsletter tap path to async-import paths, adding complexity + risk to the most fragile
> shared surface for no download saved. The nav-panel lazy-import is only meaningful **bundled with**
> the calendar-init restructure above (paint first, then `import()` the Firebase-dependent modules) —
> never as a lone change. (Evaluated and declined again in the v15.69 review.)

### Minor / not worth it now
- `paycalc.calculate()` runs on every keystroke (a few `lsGet`s per call; `getGrade` already
  cached) — a short rAF/debounce would smooth rapid typing on low-end phones. Marginal.
- Font is already optimal (one variable woff2, preloaded, `font-display: swap`, immutable).
- **Lazy-load the heavy Operations-page card imports** (`operations-app.js` and its Firebase/Functions
  paths). Reviewers periodically flag this, but `operations.html` is **admin-only** — effectively a
  single user (the developer) — and is opened rarely. Deferring its imports optimises a page almost
  no staff ever load, for real churn on a page whose init is already gated behind an access check.
  Not worth it; only reconsider if Operations ever becomes staff-facing. (Evaluated and declined in
  the v15.69 review.)
- Vite build step (bundle the ~52 modules, tree-shake Firebase) — the "nuclear option"; Batches
  1+3 capture most of the benefit without a build step. Stays deferred (see "Build tooling — Vite").

---


---


## Maintainability roadmap (v13.72)

*(moved from ROADMAP.md lines 833–898)*

## Maintainability roadmap (added v13.72)

A phased plan to make the codebase easier to maintain and extend without introducing a build system or framework. Each phase is self-contained and safe to defer. Phases are ordered by value-to-effort ratio.

**Phases 0–7 ✓ complete (v13.72–v13.86)** — the codebase-hygiene track, all shipped:
- **0 Safety net** — `npm run lint`/`check`; `import-graph.test.mjs` (circular-import detector);
  dead-CSS-token + Firestore-cross-reference tests in `sw-asset-check.test.mjs`; PR template.
- **1 Type hints** — `// @ts-check` on every root module; `COLLECTIONS` constant; roster-data
  integrity tests.
- **2 Session consolidation** — `sessionReady`/`resolveSession()` replace the `window._mybSession`
  global.
- **3 Decision comments** — `// Rule: see CLAUDE.md — "…"` at each surprising enforcement site
  (Christmas-RD ordering, manual-beats-import, the Sunday layers).
- **4 DOM-wiring tests** — `nav-panel.test.mjs`, `overlay.test.mjs`, `session.test.mjs`.
- **5 ESLint devDependency** — clean-checkout `npm run check`.
- **6 File-size refactor** — `calendar-app.js` 1,950→~670 and `paycalc-app.js` ~1,950→~1,270 via
  focused sub-modules (`calculate()` stays in the coordinator, passed as a callback to avoid cycles).
- **7 Firestore emulator suite** — `firestore.rules.test.mjs` + `storage.rules.test.mjs` (gated in
  `deploy-rules.yml`); the prerequisite for the password + write-isolation work.

### Phase 8 — Password security (Stages 2–5)

**Depends on Phase 7 (Firestore emulator) being in place first** — auth changes are high-risk
without it. Phase 7 is now done.

This phase is the canonical five-stage plan described in full under **"Password security — the
original five-stage design"** above (superseded by `PASSWORD_DESIGN.md`) — do not re-number the stages here. In brief:

- Stage 1 ✓ (v12.68): Work-email registration via `staffContact`.
- Stage 2: Email verification.
- Stage 3 ✓ (v18.63, Track C): Self-service password change (while logged in) — shipped decoupled from email.
- Stage 4: Forgotten-password reset — **admin break-glass shipped v18.63**; the *email-based* self-service half remains.
- Stage 5: Retire the surname-derived password.

Only the **email-based** routes (Stage 2, and Stage 4's self-service half) are parked pending the owner
setting up Power Automate (the email-delivery channel). The chosen-password core (Stage 3 + admin reset)
shipped without waiting on it — see the "C-lite" status note under the staged plan above.

**Note:** per-member Firestore write isolation (`request.auth.token.name == memberName`,
suspended at v10.94, rebuilt permissive at v14.53, now **strict and LIVE as of v16.29**) is a
**separate** security project — see "Security project — per-member override write isolation" above
and "The four v11 security tasks", task #2, below. It is *not* a stage of the password plan; earlier drafts of this
section conflated the two.

### Phase 9 — TypeScript zero-diagnostic baseline ✓ (9a–9c complete, June 2026)

Progressively hardened `tsc --noEmit` (via `// @ts-check` + `jsconfig.json`) from ~570 errors to
zero, enforced by the fail-closed `scripts/typecheck.mjs` CI gate:
- **9a** — `checkJs: true`; fixed all 57 non-DOM errors (the only suppressions are targeted
  `// @ts-ignore` on the Firebase CDN `import()` lines in `firebase-client.js`, unavoidable in a
  no-bundler setup).
- **9b** — all DOM `.value`/`.dataset`/etc. errors resolved with JSDoc `/** @type {HTMLXxxElement} */`
  casts (33 files); gate now enforces zero errors of any kind.
- **9c** — `strict: true`; null-safety guards + implicit-any annotations across 46 files; **no**
  `// @ts-ignore` — all explicit annotations or runtime-safe guards.
- **9d** (replace `any` casts with precise types) — **partially done (v16.29).** All DOM-element
  casts (`/** @type {any} */ (document.getElementById(…))` → precise `HTMLElement`/`HTMLButtonElement`)
  are converted (admin-roster-upload, calendar-al-lightbox, links-app), typecheck stays at zero errors.
  **Remaining ~180 `@type {any}` casts, deliberately not converted:** ~56 are genuinely dynamic and
  SHOULD stay `any` (Firestore `doc.data()`, caught errors, snapshots — no static type without generated
  Firestore types); the rest are object-shape params (period/member/override objects) that would want a
  shared `@typedef` (e.g. a `Period` type across the paycalc cluster) — a larger, higher-regression-risk
  refactor for marginal real-world safety, since strict null/DOM checking (9a–9c) already catches the
  bugs that matter. Do the `Period` typedef as its own focused pass if pursued; otherwise the current
  `any` on dynamic data is correct, not debt.


---


## Deferred backlog (v14.96 review)

*(moved from ROADMAP.md lines 899–924)*

## Deferred backlog (from the v14.96 external review)

A thorough external review of v14.96 confirmed no release blocker for current small-team use. Most
findings were already done (B1 re-enabled v14.98; App-speed admin-exclusion v14.95; B3 strict
override isolation shipped v16.29; B4 server-owned role lists shipped v16.30) or already sequenced
(the C-series password track, in-place login rollout, the app-perf caching pass). Quick wins (fail-closed uploads, stale auth-doc fixes, a
PAYSLIP_ACTUALS export guard, the primeAuth comment) shipped at v14.99. Two items were captured here — **both now resolved:**

### M8 — lazy-load heavy Cloud Function dependencies (cold-start) — ✅ SHIPPED

`functions/index.js` now lazy-`require`s all three heavy deps inside the paths that use them, each
tagged with an `M8:` comment: `mammoth` only for DOCX huddle conversion, `web-push` via a cached
`_webpush` accessor in the notification fan-out, and `@anthropic-ai/sdk` only in `parseRosterPDF`. No
top-level require of the three remains, so a function no longer pays their load cost when it doesn't
use them.

### L4 — paycalc collapsible fixed `max-height` — ✅ CHECKED, within cap (no fix needed)

`paycalc.css` gives open collapsible bodies a fixed `max-height` for the open/close animation.
**Checked (v16.29):** the tallest real content is well within the cap. The `.bd-body` back-pay
breakdown accrues at most one row per period in a single award tax year (≤ ~13 rows, capped at
`todaysPeriodNum()` and excluding the paid-in period) and the result breakdown is a fixed ~20-line
category list — ~550–800px against the 1400px cap; print already unclips it. So it does not clip at
realistic sizes, and `max-height:none` would break the animation. A finite cap is correct here; the
`paycalc.css` comment records the reasoning. Only revisit if a future breakdown could exceed the cap
(then prefer measure-height-and-drop-cap-after-`transitionend` over a bigger magic number).

---

## Calendar start — the identity round trip: the entry as it stood when the decision was taken (5 Sep 2026)

**Moved VERBATIM from ROADMAP.md at v22.97.** The owner answered **option 2** and it shipped in that
release; `CALENDAR_DATA.md` invariant 13 is the standing rule and `ROADMAP.md` carries the short live
entry. This is kept whole rather than summarised because it is the only place the reasoning exists —
the measurement, the offline finding that reframed what the "no" answer actually protects, and the
two couplings that stop either decision being taken as if the other did not exist. Anyone proposing
to WIDEN the boundary needs all of it, and none of it is reconstructable from the code.

### Calendar start — the identity round trip
**Status:** Blocked on an owner decision · **Owner:** Gareth · **Measured:** `LATENCY.md` · **Would change:** `CALENDAR_DATA.md` invariant 3

**FIELD-CONFIRMED ON LIVE DEVICES, 5 Sep 2026.** This was "extremely strong controlled experiment
plus historical field localisation" until the September App Speed read supplied the predicted
signature: `Recognised` moves with the connection grouping while `Getting ready` is 0% over half a
second in every group. Same populations, large difference at the network rung, none at the
code-loading one. `LATENCY.md` → "THE FIELD READ" carries the table and the one confound.

**And the number that makes this the decision rather than an option:** 454 of 462 attributed starts
were served from the device's OWN saved copy, and **78% of those still took over a second to put
shifts on screen**. The roster is already on the phone. It is waiting for permission to be shown.

**The measurement is finished and it names one thing.** Every Calendar boot issues a single
`accounts:lookup` so Firebase can validate the stored user before emitting it, and the access
decision waits for it — so the first shift a member sees is behind a network round trip on every
load. Injecting 300 ms of latency into that one call moved the milestone by 336 ms. It is not
conditional on the token having expired; it happens on every boot. Preconnect is already in place on
all seven pages, so the connection is warm and there is no easy win left in it.

**What removing it from the critical path would mean.** The Calendar would paint its CACHED
overrides on the strength of the local session, before the server has confirmed the account is still
live. That is `CALENDAR_DATA.md` invariant 3 — *no access, no override data, at source* — which
exists because the local Firestore cache serves reads the rules would deny
(`experiments/firestore-offline-proof/`, measured).

**The cost, stated as precisely as it can be.** A member whose account was disabled since their last
visit would see one paint of their own already-cached roster before the lookup returned and the app
corrected. Bounded three ways: it is **their own** data, **already on their device**, and it is
**one paint**. No new data is read — server-side rules still refuse every network read without the
claim, and that is untouched.

**Why it is still not obvious.** The whole point of the v20.12 access gate was that possession of a
device is not authorisation, and "they already have it cached" is the argument the gate was built to
refuse. The honest position is that this is a smaller version of the same question, not a different
one — which is exactly why it is a decision rather than an optimisation.

**Measured 31 Aug 2026: the check the wait buys is only enforced when the network is UP.** With the
auth endpoint unreachable, Firebase emits the stored user anyway (130 ms, restored — the offline arm
of `experiments/auth-firestore-split-proof/`). So an offline device — the installed app in a tunnel
— already trusts the stored identity under the SHIPPED behaviour, and a disabled account already
paints its cached roster there. The "no" answer therefore protects strictly less than it appears:
it enforces the check exactly and only on the loads where the wait is also longest.

**One reading first, and it is now available (`VAL-AUTH-006`).** The round-trip finding is an
emulator result; the field contribution is inferred. The signature it predicts is that `Recognised`
tracks connection quality far more strongly than `Getting ready` does — a network wall moves with the
network, a code-parse wall does not. **Operations → App Speed → "Does the connection slow the start?"**
puts the two side by side on the same bands. It was not readable until v22.28 (the card could split
only the whole-load figure), which is why this entry could sit here for weeks describing a check
nobody could run. If the signature is absent, the finding is wrong and this decision should wait.

**Two couplings, so neither decision is taken as if the other did not exist:**
- **Track E scales this decision's cost.** If E3 ever ships, every load runs the member restore, so
  the round-trip wait applies to the whole population rather than to signed-in members only. Decide
  this with that in view, or Track E quietly re-opens it.
- **`AUTH_PLAN.md` §4's grace mode is this same trust question at greater severity** — it
  contemplates trusting a stored identity for DAYS offline; the "no" here refuses to trust it for
  one paint online. The measured offline behaviour above says the app already sits nearer grace
  mode than the "no" answer assumes. An owner weighing this should read that section first.

**An independent external review reached the same conclusion (5 Sep 2026)** — same primary
bottleneck, same preferred answer, and it argues for option 3 on a ground worth recording: the app
already has the vocabulary. Staff understand a Calendar that shows a known state while it checks for
changes, so the existing quiet `Updating…` carries this with no new language and nothing alarming.

**Three answers are all reasonable**, and the engineering differs completely:
1. **No** — the gate holds; accept the round trip and close this. Then the ladder's `Recognised`
   row should be re-labelled as a floor rather than a target, so nobody re-opens it every quarter —
   and `LATENCY.md` closes, recording the second as the price of the security model.
2. **Yes, for a named member with a live local session only** — never for the shared PIN viewer,
   whose whole security model is that it holds no identity. The narrowest useful form.
3. **Yes, with a visible tell** — paint, and mark the grid as unconfirmed until the lookup lands.

**Option 3 is cheaper than it first reads, and that should be weighed before choosing** (deep
review, 30 Aug 2026). It is not a new design: the Calendar already ships the ENTIRE state it needs —
the `cached`/`stale` display state that draws a labelled last-known grid, and the sync chip that
says "Updating…" and withdraws on confirmation. Staff have been taught to read that state for
months. Identity taking the same two-phase shape as data would EXTEND shipped, tested machinery
rather than invent an "unconfirmed" state nobody has seen — which is a materially smaller cost than
"a design decision about a state most members would never see", the wording this entry carried
before. What it does NOT change: the security question itself is identical in options 2 and 3, and
the choice between them is about honesty on screen, not about safety.

**Do not start building any of them before the answer** — and before the answer, run the
field-confirmation check in `LATENCY.md` (does `Recognised` track connection quality the way a
network wall must?). The measurement is done; what is left is not a performance question.

---

## Calendar start — the identity round trip: the entry as it closed (moved 7 Nov 2026)

The short live entry the section above refers to ("`ROADMAP.md` carries the short live entry"),
moved **verbatim** once nothing in it was open: the fast path shipped at v22.97, was retired on
26 Sep 2026, and was replaced at v24.59 by the own-roster copy (`CALENDAR_DATA.md` 17;
`DECISIONS.md` → "The provisional paint" and "The own-roster copy"). What it said to read next —
whether a returning member's open now SHOWS a roster well inside a second — is a WATCH row in
`ROADMAP.md`.

### Calendar start — the identity round trip
**Status:** SHIPPED (v22.97), RETIRED 26 Sep 2026, REPLACED at v24.59 · **Decided by:** Gareth, 5 Sep 2026 · **Where it lives now:** `CALENDAR_DATA.md` invariant 17 (13, the paint's own, is retired)

The owner's answer was **option 2 — yes, for a named member with a live local session only**: a
returning member is shown their own already authorised cached roster while Firebase revalidates the
stored identity, instead of waiting for it. Never the shared PIN viewer, whose whole security model
is that it holds no identity.

**What it is WORTH is still not established (12 Sep 2026).** The field signature that justified the
decision is now confirmed on live devices and `VAL-AUTH-006` is closed — `Recognised` runs 48% / 68%
/ 91% over a second across the connection groups while `Getting ready` is 0% in every one of them.
But the fix's own prediction — that cache-served starts would stop waiting — **has not shown up**:
78% over a second before, 77% after, on 1,285 opens. That is not yet a falsification, because it
fits "the path rarely fires" exactly as well as "it fires and does not help", and those have
opposite consequences. `readyProvisional` (v23.70) separated them, and **the answer came on 19 Sep
2026: the path RARELY FIRES** — one open in roughly 800 eligible (`LATENCY.md` → THE CLOSING READ).
That is row one of the pre-registered table, so the identity diagnosis stands and `VAL-AUTH-006` stays
closed. The path was kept by owner decision the same day, then **RETIRED on 26 Sep 2026** once it
was shown to be wrong as well as rare — its cache read queues behind the very lookup it was meant to
overtake (`DECISIONS.md` → "The provisional paint"). **Its replacement SHIPPED at v24.59 (5 Oct 2026,
owner decision):** an app-owned copy of the member's own months in plain storage, painted labelled
before the lookup answers — the one shape that entry said could beat it (`CALENDAR_DATA.md` 17,
`calendar-snapshot.js`). **What to read next:** whether a returning member's open now SHOWS a roster
well inside a second. The App Speed card's milestones were built around the grant, so it measured the
copy only indirectly until v24.85 added a direct milestone (`rosterSnapshot` — "Own roster" on the card).

The whole entry as it stood when the decision was taken — the field confirmation, the offline
measurement, the two couplings and all three candidate answers — is in `ROADMAP_HISTORY.md`, moved
verbatim. It is worth keeping whole: the reasoning is what a future reader will need if the boundary
is ever widened, and none of it can be reconstructed from the code.

**What shipped is narrower than option 2 as written**, and the two extra refusals are the part to
know before touching it. The scope is ONE member, so a boot that was about to draw somebody else is
refused outright rather than narrowed: **Team View**, and a **stored selection naming a colleague**.
Both would otherwise paint a colleague's base roster with their leave and absence silently missing —
invariant 1's failure reached from a new direction. Those members boot exactly as they did before.

**What remains open, and it is small.** Option 3's *visible tell* was not adopted as such, and may
not be needed: phase 1 already notes the months `cached`, so the grid is drawn as a cached grid by
machinery staff have read for months, and phase 2 confirms it. Whether that is enough, or whether
the paint deserves to say so in its own words, is a question to answer from use rather than from
first principles. (The replacement answers it for itself: the own-roster copy is drawn `stale`, with
"Checking for changes…" — `CALENDAR_DATA.md` 17.) **Read `LATENCY.md` for what the change is worth before revisiting it** — the
closing read there is the evidence, and it found the path rarely fires.
