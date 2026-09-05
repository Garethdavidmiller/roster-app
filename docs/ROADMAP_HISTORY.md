# ROADMAP_HISTORY.md — what was built, removed, tried and rejected

*Split out of ROADMAP.md in August 2026 (at v19.97). Not version-stamped; not a runtime asset.*

**Why this file exists.** ROADMAP.md had grown to 924 lines, and roughly two-thirds of it was the
past: completed phases, shipped features, experiments that were reverted, closed audits, and
security phases that had landed. All of that is genuinely valuable — several entries below are the
only record of *why* something was removed, and two carry full restoration checklists — but mixed in
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
| Re-add the cultural calendar or profile avatar | *Removed features* — both carry full restoration specs |
| Re-propose FIP faceted filtering, a bottom nav bar, or a summary strip | *Tried and held back* |
| Design a password stage | *The original five-stage design* — superseded by PASSWORD_PLAN.md, but the reasoning survives |
| Touch the override write-isolation rules | *Per-member override write isolation* — and SECURITY_RELEASE_PLAN.md → B2/B3 |

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
- **Security hardening** (v10.72–74) — the v10.72 per-member write isolation was **reverted at v10.94 (production outage)**, later rebuilt as the permissive 3-tier rule (B2, v14.53) then made strict (B3, v16.29) — KNOWN_LIMITATIONS task #2. v10.73 back-pay-in-HPP was **superseded at v16.89** (it double-counted the award uplift — `.claude/rules/paycalc.md`). Plus `.gitignore`, an iOS scroll-lock `transitionend` fallback, and the May-2026 GCP API-key referrer restriction.
- **Railcard guide** (v10.30–v10.48) + **FIP guide** — `.claude/rules/guide-pages.md`, GUIDE_SOURCES.md. FIP country-finder (v17.64) + sticky section chip-bar (v17.66) + scrollspy (v17.68) shipped. **Four FIP v2 ideas deliberately NOT shipped:** per-card reliability badges (a "Confirmed" tier would over-promise against GUIDE_SOURCES' explicit "sampled, not certified" carrier posture); per-section review dates (already tracked per-row in the register — clutter on a staff reference); collapsible major sections (invasive, low value now the finder + chip-bar carry navigation); **faceted "filter by property" search — see "FIP faceted filtering" below.**
- **Cross-page / navy-chrome / typography consistency passes** (v11.64–v11.88) — CSS-only, no behaviour change; all resulting token/surface/motion/type rules live in `.claude/rules/css-tokens.md`.
- **Huddle DOCX flow rework** (v11.66) — Power Automate flow made DOCX-first (the old noon time-of-day condition meant afternoon emails always sent PDF even with a DOCX attached); the viewer's auto-open + manual-click branches unified (`if htmlContent render inline; else "Open Huddle" button`).
- **Pay reminder infrastructure fix** (v11.65) — the daily 08:00 reminder had **never fired**: the deploy SA lacked `roles/cloudscheduler.admin` (Firebase silently failed to create the Scheduler job every deploy) and a stale `us-central1` record blocked deploys; first live 27 Jun 2026.
- **CSS extraction + infra hardening** (v12.01–05) — page/guide CSS extracted to external files; DOMPurify self-hosted; security headers (HSTS/COOP/Permissions-Policy); pre-commit ESLint + single-SDK check. **v12.05 reverted** the v12.04 anonymous-auth requirement on calendar `overrides` reads (more complexity than value — anyone can mint an anonymous token as easily as the app; KNOWN_LIMITATIONS → "Override data is publicly readable").
- **Links design workspace** (v12.06–v12.47) — `.claude/rules/links-design.md`. Durable decisions: patterns-only documents (decouples pattern design from assignment); a slot-based generator over an early/late binary (the station is staffed in **waves**, 28 distinct start times, distinct Sat/Sun); an hourly heat map over a per-type bar chart (shows the real on-duty shape/gaps); CEAs do not work nights (`normaliseCustomShift` rejects 21:00–03:59).
- **E2E smoke tests** (v12.65 → removed v12.75 → restored v13.95) — CLAUDE.md → `e2e/`. **The one principle to preserve — whatever E2E tool is ever chosen, keep the Firebase CDN-stub approach** (`e2e/fixtures.js`): every page's module graph statically imports the gstatic Firebase SDK, and in ES modules one failed static import aborts the whole graph — so a slow/blocked CDN on a CI runner fails every test in ways no timeout/retry can fix. Intercept `gstatic.com/firebasejs/**` and serve local no-op stubs; any tool with request interception can do it.


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
  clearly the better deal, and the `sign-in-2026` notice (v21.84) exists to say so — it replaced `pw-own-2026`, which nudged this same group towards a password when what they actually needed to hear was that signing in ends the code — but it
  IS a change for the largest group of users and should be expected in support questions.
- **Viewer sessions cannot subscribe to push**, by rule as well as by UI. Every office PC unlocking
  with the PIN signs in as the same uid, so a subscription written under it would be owned by an
  identity fifty people share.
- **Telemetry is quiet on a locked Calendar.** With no identity, the error reporter, the usage
  counter and the latency sampler cannot write — so a failing PIN exchange does NOT appear in the
  Operations Error Log. Diagnose one from the Cloud Function logs.
- **App Check is still the missing integrity control** for the write side (below, task #4).

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
`CONFIG.CALENDAR_PIN_ACCESS === false` rollback path, and that flag is on.

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
Firestore REST read. The first phase that is a boundary at all is **E2** (`request.auth != null`),
which remains undecided — see `AUTH_PLAN.md`.

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
in the Overtime/AL section below: *deleting* the AL doc still destroys the swap evidence it carried,
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
added into the HPP estimate (v16.89)". See task #3 above for the original payslip confirmation.

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
  than choosing between them.

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

---

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

**To restore:** see "Restoration path" section below.

A member's optional profile photo — a circular badge in the nav-drawer footer (and the photo in the About panel), with an initials-on-colour fallback when no photo is set. Added v12.12; the **interactive reposition editor** (drag/pinch/zoom to frame the shot on a `<canvas>`) followed at v12.19.

**Status: explicitly non-vital.** It is a "nice to have" — staff's names become a photo in a menu. A decision may be taken later to remove it, or to simplify it back to what we had before the editor. This entry records that decision space and the exact revert path so it can be done cleanly.

**Honest assessment (deep review, v12.20):**
- The **display + storage + cross-device-sync layer is good, well-factored code** worth keeping regardless — the shared painter (`avatar.js`), the Storage-object + Firestore-pointer model (`firebase-client.js`), and the 3-layer sync (cache → Firestore refresh → live events).
- The **interactive editor is gold-plated for a non-vital feature.** It is ~350 of the feature's ~700 JS lines — canvas crop geometry, a Pointer-Events pinch/pan state machine, dpr-aware rendering, and a `ResizeObserver` refit. It is the highest-risk, hardest-to-maintain, untested part of the whole app, protecting a badge that renders at **26px**. At that size an off-centre face is invisible, so the precise reframing it buys is largely wasted, and it is the one chunk the owner cannot realistically debug unaided.

_(The "simplify instead of remove" options are moot — the feature was fully removed at v12.22. The full-revert checklist below is the live record for a clean restoration.)_

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
asserts `computeSL` against every clean `sl` value in `MILLER_ACTUALS` (the regression that locks
the HMRC rounding method — the £214-vs-£213 P2 case). See `.claude/rules/paycalc.md` → Statutory
deductions.

---

### ~~Deferred: mid-year pension step for 2025/26~~ — SHIPPED v18.43

**Shipped (v18.43 — review item 8).** The "can't be read from the repo" blocker turned out to be
wrong: the per-payslip pension IS derivable from `MILLER_ACTUALS` as
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
**suspended at v10.94 after a production outage** (post-mortem: KNOWN_LIMITATIONS.md task #2), then
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
  SECURITY_RELEASE_PLAN.md → "B1 detailed scope" → "Deferred residual".
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
  recovery → migrate → retire) under "Password security improvements"; do not rush, since locking
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
  **ARCHITECTURE_PLAN.md → Phase 9**.

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
  Operations App-speed data) before the deferred lazy-Firebase pass below.

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

This phase is the canonical five-stage plan described in full under **"Password security
improvements — staged plan"** above — do not re-number the stages here. In brief:

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
and KNOWN_LIMITATIONS.md task #2. It is *not* a stage of the password plan; earlier drafts of this
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
MILLER_ACTUALS export guard, the primeAuth comment) shipped at v14.99. Two items were captured here — **both now resolved:**

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

**Moved VERBATIM from ROADMAP.md at v22.96.** The owner answered **option 2** and it shipped in that
release; `CALENDAR_DATA.md` invariant 13 is the standing rule and `ROADMAP.md` carries the short live
entry. This is kept whole rather than summarised because it is the only place the reasoning exists —
the measurement, the offline finding that reframed what the "no" answer actually protects, and the
two couplings that stop either decision being taken as if the other did not exist. Anyone proposing
to WIDEN the boundary needs all of it, and none of it is reconstructable from the code.

### Calendar start — the identity round trip
**Status:** Blocked on an owner decision · **Owner:** Gareth · **Measured:** `LATENCY_PLAN.md` · **Would change:** `CALENDAR_DATA.md` invariant 3

**FIELD-CONFIRMED ON LIVE DEVICES, 5 Sep 2026.** This was "extremely strong controlled experiment
plus historical field localisation" until the September App Speed read supplied the predicted
signature: `Recognised` moves with the connection grouping while `Getting ready` is 0% over half a
second in every group. Same populations, large difference at the network rung, none at the
code-loading one. `LATENCY_PLAN.md` → "THE FIELD READ" carries the table and the one confound.

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
   and `LATENCY_PLAN.md` closes, recording the second as the price of the security model.
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
field-confirmation check in `LATENCY_PLAN.md` (does `Recognised` track connection quality the way a
network wall must?). The measurement is done; what is left is not a performance question.

