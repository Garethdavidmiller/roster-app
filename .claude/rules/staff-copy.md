---
paths:
  - "*.html"
  - "*-words.js"
  - "*-tips.js"
  - "*-render.js"
  - "*-notices.js"
  - "paycalc-lightboxes.js"
  - "test/paycalc-copy-parity.test.mjs"
  - "functions/push-notices.js"
---
# Staff-facing words that teach — the owner's standard

Moved here from CLAUDE.md on 24 Nov 2026, word for word, to free room under its size cap: it binds every
surface a colleague reads, so it loads with the files that carry those words (pages, `*-words.js`,
`*-tips.js`, `*-render.js`, the notices). CLAUDE.md keeps the summary and the heading code cites
("Plain English that TEACHES"); the short wording conventions ("the admin" vs "your manager", the
canonical terms, the tone) stay there as one line each, because every session needs them. Their reasons,
as CLAUDE.md carried them until 25 Nov 2026, are the last section of this file.

**Plain English that TEACHES — write for the colleague who has never heard the term** (owner, 3 Sep 2026).
Many colleagues do not know what HPP is, how back pay works, or how to use a FIP card or coupon. The
app's job is to let them use and discover these things without asking anyone — and without being
overwhelmed. "For dummies" is the standard, not an insult. The rules, each learned the hard way:
- **Audience first.** Every staff-facing surface must work for someone who does not yet know the
  word. Expand a term on first sight within a surface (HPP → "Holiday Pay Premium"); never assume
  the abbreviation is understood because it is on the payslip.
- **Educate in place, at the point of use.** The guides are for depth; the row, card header or `?`
  panel is where the learning happens. The pattern that works is already in the app: *name → one
  sentence on what it is → where you see it in the real world* — "Paid once a year on a January
  payslip — look for the green note on that payslip"; "Shows as 'RDW Sun 1.5' on your payslip".
- **A collapsed header is a teaching surface, not unused space.** The title + hint of a collapsed
  card is persistent micro-documentation; ask what its collapsed state is communicating before
  hiding, grouping or shortening it. This nearly went wrong once: DECISIONS.md → "More pay tools …
  DECLINED", and `.claude/rules/paycalc.md` → invariant 16.
- **Discovery must not depend on data the member has not supplied yet.** A contextual prompt gated
  on a stored figure reaches only people who already know. Before relying on one, check the
  "new member, nothing entered" cohort still has a route — that cohort is who the education is for.
- **Not overwhelming means fewer DECISIONS at once, not fewer words or pixels.** Simplify by
  reducing what the reader must decide, and by sequencing; never by removing the explanation. Page
  height is not a UX metric. The question is where staff spend effort for little value.
- **Educational is not chatty.** The calm tone above still applies; one idea per line.
- **Test it on the reader, not the owner.** The check for a new surface is a colleague who does not
  know the term using it from the app alone. And score two things separately, because they are not
  the same: **usability** (can somebody who understands the subject work the screen?) and
  **learnability** (can somebody who does not yet understand it learn enough here to act correctly?).
  A colleague can be a fluent phone user and still have no idea how a FIP coupon works.

**The four things a surface owes a member, in order.** This is not an imported UX model — it is the
app's own best pattern, named. Every Hours row already does all four:
**Discover** it exists (*"Rest Day Working"*) → **Understand** it in one sentence (*"Came in on a
rest day as extra work — a Saturday off included"*) → **Act** (*"Shows as 'RDW 1.25' on your
payslip"*) → **Deep dive** on demand (the card body, the `?` panel, the guide).
**Progressive disclosure may hide the fourth. It may never hide the first.** That single line is what
separates good hiding (*"Holiday Pay Premium — paid once a year on a January payslip"* with the
calculation fields collapsed beneath it) from bad (*"More pay tools ▾"*, where the member cannot know
a premium is in there).

**One question decides any hiding proposal: *what knowledge disappears if this is hidden?*** If the
answer is "none, it is depth" — hide it. If a member could stop knowing the thing exists, do not.

**Searchability is not discoverability.** The cross-guide search is genuinely good and does not solve
this: a member who has never heard of an International Coupon cannot search for one, and a member who
does not know they receive a Holiday Pay Premium cannot search "HPP". Orientation, headings and
signposting come first; search serves the member who already knows what they are looking for. Do not
answer a discovery gap with "it is findable".

**Challenge both extremes.** *"This is too complicated, hide it"* and *"the information is technically
present somewhere, so discovery is solved"* are the same failure from opposite ends, and this app has
now produced one of each. Neither is good enough, because there is frequently **nobody to ask**: a
colleague on a late turn wondering about January's payslip has no manager, no colleague and no
helpdesk at 22:00. The app is the source. See ROADMAP.md → "Plain-English education pass".

---

## The wording conventions, with their reasons

Applies to **all user-visible copy** (cards, hints, tips, lightboxes, error banners, notifications) — not to code identifiers, data values, or comments.

**"the admin" vs "your manager" — who a staff member is told to contact:**
- **App / account matters → "the admin".** Anything about the app itself or a staff member's account: password reset, who can read a saved work email, a technical failure (roster won't display, a Huddle link is broken, data won't load). The admin (developer/app owner) fixes these.
- **Work / operational matters → "your manager".** Anything about the roster as work: booking annual leave, recording absence, shift changes, general rota queries. The manager owns these.
- Rationale: staff can't fix app faults by asking a line manager, and the admin isn't the right contact for an AL request. Matching the contact to the problem is the whole point. When in doubt, ask: *"is this a broken-app problem or a work problem?"*
- Note on data access: only the **owner + admin** can read a `staffContact` work email (Firestore rules) — a manager cannot — so "only you and the admin can see this email" is the factually correct phrasing, not "your manager".

**Canonical terms (use these exact forms in visible copy):**
- **"Change a Shift"** — never "override", "Recording a Shift Change", or "shift override" (the word "override" stays in code/data only).
- **"Absent" / "record an absence"** — never "sick"/"sickness" in UI copy (the reason is never stored — GDPR). The internal data value `SICK` and ids are fine.
- **"Year to Date"** — always spelled out, never bare "YTD". The two payslip figures are exactly **"Taxable Pay"** and **"Tax Paid"** (never "Gross Pay" for the YTD figure). See `.claude/rules/paycalc.md` → payslip line names.
- **"Fill from calendar" / "From your calendar" / "Replace with calendar values"** — the paycalc pre-fill reads the *calendar* function, not the base roster; do not reword to "roster".
- **"account recovery"** is the term for what a saved work email is FOR (owner decision; it replaced "self-service password reset (in a future update)", which was accurate and read like a product roadmap). It separates the two questions a member actually has. **Why you are giving us this:** "Save your Chiltern work email for account recovery." **What works today:** "Self-service recovery isn't available yet. For now, ask the admin if you forget your password." Never "coming soon". The future email route is SECURITY_RELEASE_PLAN.md track C2. A password *reset* exists **today** via the admin (Operations → Account status → Reset), and staff can set their own password (Settings → Password), so do NOT say a password reset is flatly "not available" — only the *email self-service* route is future. Present-day recovery copy is "To reset a password today, contact the admin."
- **App name "Marylebone Roster"** — the on-screen name everywhere (incl. bug-report `appLabel` as "Marylebone Roster — <Page>"). **Never "MYB" for the APP or one of its tools** — not "MYB Roster", not "MYB Pay Calculator", not "MYB member". As the app name it survives only in the iOS home-screen `apple-mobile-web-app-title` meta, the manifest's `short_name` (exempt by key in `app-name-parity.test.mjs`) and comments.
  **But MYB as the STATION CODE is correct and stays** — it is Marylebone's three-letter code, staff use it daily, and the guides carry "Chiltern Railways · MYB Station" and "MYB mornings" correctly. The test is what the letters NAME: the station, fine; the software, never. Enforced by `app-name-parity.test.mjs`.
- **Documents:** "Daily Huddle" (proper noun), "Weekly Retail Circular", "Marylebone Newsletter".
- **Never name an internal document in staff-facing copy.** "The draft roster has been planned" was date-accurate and still read as untrue, because the draft is the roster office's own artefact and "the roster" to staff means the one released on the Thursday. Describe the reader's own position instead. The **reviewer's** surfaces and OPERATIONS_REFERENCE may name it freely; it is their document. Pinned by `overtime-format.test.mjs`.
- **Tone:** calm and factual — no exclamation marks, no marketing voice (mirrors `.claude/rules/notifications.md`).
