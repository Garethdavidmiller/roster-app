# RANGERS_ROVERS_PLAN.md — a Rangers & Rovers guide for Marylebone staff

*Planning document, opened August 2026. Not version-stamped; not a runtime asset. Companion to
`.claude/rules/guide-pages.md` (how guide pages are built) and `GUIDE_SOURCES.md` (how their claims
are governed).*

**Status: BUILT AND SHIPPED AS A DRAFT (v20.05).** The page exists, is wired into every contract in
§6, and states on its own face that it has not been verified. §1 is therefore no longer a reason to
wait — it is the description of the work that remains, and that work is verification, not building.
WP0–WP1 below are still owned by Gareth; WP2–WP5 are done.

---

## 1. The gating constraint — read this before anything else

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

## 2. The job to be done

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

## 3. The scoping decision that makes this guide usable

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

## 4. The content model

One card per product. Rows chosen to answer the checking question in the order it is asked:

| Row | Answers | Notes |
|---|---|---|
| **Area** | "does it cover where they are going?" | Named end stations on OUR route, not a region name. "Valid to Banbury and Kings Sutton" beats "the West Midlands" — the railcard guide's `rc-chiltern` block already proves this reads better |
| **Days** | "is today one of their days?" | 1 day · 3 in 7 · 7 consecutive · 8 in 15 — and for flexi products, **the box-dating rule** (below) |
| **When** | "is it too early?" | Reuse the railcard guide's colour stripe + `⊘` token exactly — green = any time, amber = morning restriction. Do **not** invent a new vocabulary |
| **On us?** | the whole point | Explicit yes/no/partial, never inferred from the Area row |

**The flexi-rover box-dating rule deserves its own treatment.** On a flexi product the holder writes
the date in the next box themselves before travelling. That makes it the one ranger/rover rule a
gateline can actually *enforce* — an undated box is the check — and it is the rule most likely to be
unknown to staff who have never handled one. It is a strong candidate for the page's single
`.gotcha`-style callout, in the way the railcard guide handles the minimum-fare mechanic.

### What the guide must NOT print: prices

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

## 5. Page and design system

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

## 6. What a fifth guide actually touches

Adding a guide is not "write a page". Seventeen places know how many guides there are, and most fail
loudly — which is the good case. Listed so the work is estimated honestly:

| # | File | What |
|---|---|---|
| 1 | `nav-panel.js` | `NAV_GUIDES` entry — icon, label, url, **`openId`** |
| 2 | `firestore.rules` | analytics counter id, in **two** places (the `hasOnly` allowlist and the per-id int check) |
| 3 | `firestore-contract-parity.test.mjs` | asserts `NAV_GUIDES` openIds match the rules list, both ways |
| 4 | `service-worker.js` | precache: `.html` + `.css` (+ `.js` if any) |
| 5 | `sw-asset-check.test.mjs` | asset-list parity, and the `noindex` meta contract |
| 6 | `csp-meta-parity.test.mjs` | the page's `<meta http-equiv="Content-Security-Policy">` must mirror the header |
| 7 | the page itself | `noindex` meta + `color-scheme: only light` meta |
| 8 | `e2e/axe.spec.js` | accessibility scan (blocking gate) |
| 9 | `e2e/csp.spec.js` | deployed-CSP proof |
| 10 | `e2e/calendar.spec.js` | each guide records its **own** open id, driven through the real drawer |
| 11 | `GUIDE_SOURCES.md` | a register row per high-risk claim |
| 12 | `guide-sources.test.mjs` | the two-way `data-guide-source` contract — a row with no block fails, and vice-versa |
| 13 | `guide-shell.css` | nothing to change, but confirm nothing new is needed |
| 14 | `guide-back.js` | already generic; confirm the new page is in scope |
| 15 | `e2e/visual.spec.js` + baselines | the four static guides are baselined; a fifth should be |
| 16 | `.claude/rules/guide-pages.md` | its `paths:` globs **and** its per-guide section |
| 17 | `CLAUDE.md` + `AI_MAP.md` | file structure, same-commit rule |

Every row above was checked against the code, not assumed: `firestore-contract-parity.test.mjs`
reads `NAV_GUIDES` and the rules allowlist and compares them **both ways**; `e2e/calendar.spec.js`
drives each guide's drawer link and asserts the id it records; each guide page carries three
`noindex`/`color-scheme` metas; and all four existing guides are visually baselined (two at
desktop 900, two at mobile 390 — pick the width that shows this page's densest state).

Note #10 and #12 specifically: the analytics open-id mapping has already produced a real defect class
(a substring match filed every Pay Calculator Guide open under the Staff Guide), and the register's
two-way contract is what stops a high-risk claim losing its source.

---

## 7. Work packages, in order

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

## 8. Open questions for the owner

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

## 9. Candidate products — UNVERIFIED, for WP1/WP2 to confirm or delete

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

### 9b. What the v20.08 external review changed — and the one lesson worth carrying

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

**The three reported products are named on the page and given no rules** (`#rr-reported`). That is
deliberate and is the whole distinction this plan is built on: a card states days, area, time bars
and break of journey, and each of those is a rule a passenger could be refused travel by — §1's
class A/B gate. A third party's summary is class C at best, and is precisely the sourcing behind the
v17.45 railcard errors. What IS supportable, and is also what a gateline needs, is: these exist, do
not refuse one. Writing them up is WP1 work once task #36 opens the sources:

| Reported | What it needs before it can become a card |
|---|---|
| **Thames Rover (7 Day)** | Area, whether our Marylebone corridor is in it, the time bar |
| **West Midlands Family Day Ranger** | Same as the Day Ranger already carded, plus the group composition rule |
| **Chiltern Friends & Family** | **Ours, if it exists** — so it needs the retail system, not just a national page. Highest priority of the three |

---

## 10. Won't-do

- **No prices** (§4).
- **No national completeness.** This is a Marylebone guide, not a catalogue. `railrover.org` and
  National Rail already do the catalogue and do it better.
- **No customer-facing framing.** Same as the railcard guide — staff-facing, at work, mid-transaction.
- **No content from memory or from search summaries**, however plausible. That is §1, and it is the
  only rule here that cannot be traded off.

---

## Sources consulted for this plan

All reached via web search only; none fetched directly (§1).

- [Ranger tickets and Rover tickets — National Rail](https://www.nationalrail.co.uk/tickets-railcards-and-offers/ticket-types/ranger-tickets-and-rover-tickets/)
- [What rail ranger/rover tickets are available? — Chiltern Railways support](https://support.chilternrailways.co.uk/hc/en-gb/articles/9800506732317-What-rail-ranger-rover-tickets-are-available)
- [West Midlands Day Ranger — National Rail](https://www.nationalrail.co.uk/tickets-railcards-offers/promotions/west-midlands-day-ranger/)
- [Heart of England Rover — National Rail](https://www.nationalrail.co.uk/ticket-types/tickets/he7/)
- [Freedom of Severn & Solent Rover — National Rail](https://www.nationalrail.co.uk/ticket-types/tickets/s37/)
- [Rangers & Rovers — West Midlands Railway](https://www.westmidlandsrailway.co.uk/tickets-discounts/ticket-types/rangers-rovers-train-tickets)
- [Rovers and Rangers — GWR](https://www.gwr.com/your-tickets/choosing-your-ticket/rangers-and-rovers)
- [GB Rail Rover Guide (third-party index)](http://www.railrover.org/)
