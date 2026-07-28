# AUTH_PLAN.md — full-app authentication (Track E)

*Not version-stamped; not a runtime asset. Companion to `SECURITY_RELEASE_PLAN.md` → Track E.*

**Which doc owns what.** `SECURITY_RELEASE_PLAN.md` is the *sequencing and risk* master across Tracks
A–E and keeps the phase list (E0…E6) in the order they may ship. **This file is authoritative for the
design**: what "behind authentication" can actually mean here, what is exposed today, how each phase is
built, the offline answer, and what to measure. Neither file restates the other's half — if they ever
disagree, that is a defect, and the v19.00 sweep found exactly that kind of drift once already
(Track E claimed the Level‑1 gate was "≈ zero cost" while `KNOWN_LIMITATIONS.md` correctly called it a
real breakage risk; the code sided with KNOWN_LIMITATIONS).

**How much to trust each part.** Written down because the phases are not equally worked out, and a plan
that reads uniformly confident invites someone to start at the wrong end:

| | Confidence |
|---|---|
| §1 framing, §2 current exposure, E0, E2 | **Verified against code.** Safe to act on. |
| E1 | **✓ SHIPPED v19.01.** |
| E3, the decision gate, §6 measurement | **Sound, unverified.** Design is right; numbers are missing. |
| §4 offline (E4) | Designed, but rests on **one unvalidated assumption** — see the warning there. |
| E5 | **Under-analysed.** The claim-tier work the B-track proved necessary has not been done for reads. |
| §5 documents (E6) | **A sketch.** The Office-viewer dependency invalidates the cheapest option. |

**Status: UNDECIDED past the gate.** **E0 shipped v19.00** (search engines excluded) and **E1 shipped
v19.01** (the cache-first, auth-aware client preparation) — both were deliberately chosen as the two
phases needing no decision. **E2 is the first phase that is a security boundary at all**, and nothing
from E2 onward is committed. The most likely trigger is external: if the app
becomes, or is assessed as, official Chiltern infrastructure, IT may require the roster data to sit
behind authentication rather than a public URL. Until then the deliberate public-calendar design stands.

---

## 1. What "behind authentication" can and cannot mean here

The single most important framing in this plan, because the phrase bundles three different problems and
only one of them is enforcement.

| Layer | Can it go behind auth? | Where the work is |
|---|---|---|
| **Data** — Firestore reads | **Yes, server-enforced.** The only real control. | E2 / E5 (rules) + E1 (client prep) |
| **Files** — Storage documents | **Not by any rules change.** They ride permanent bearer URLs. | E6 (delivery-model change) |
| **Shell** — HTML/CSS/JS | **No.** Static files on public hosting. A client gate is UX, never security. | E3 (UX only) |

Two consequences follow, and both are easy to get wrong:

- **A login overlay on the calendar buys nothing by itself.** `auth-policy.js` says so in its own header
  ("This is CLIENT-side UX, NEVER the security boundary"). Shipping E3 without E5 would look like the
  app is behind a login while every byte remains fetchable over REST.
- **"The entire app behind authentication" is not literally achievable** on Firebase Hosting static
  serving — the app shell is public by construction. What is achievable is *all data behind a named
  session*, plus a client gate so the UI matches. Say it that way to anyone asking for the guarantee.

---

## 2. What is actually exposed today (verified, v19.00)

Open reads (`allow read;` in `firestore.rules`): **`overrides`, `huddles`, `circulars`, `newsletters`**.
Everything else already requires auth, and most requires a claim.

- **`overrides`** carries `memberName` + `date` + `type` + `value` — so AL, absence, and shift changes
  for every member. This is personal data; absence especially. (The app never stores a *reason* — that
  is a deliberate GDPR decision recorded in CLAUDE.md — but "who was absent, and when" is readable.)
- **The three document collections** carry the download URLs for internal Chiltern operational
  documents.
- **`storageUrl` is a permanent tokenised bearer URL**, so the document *files* are not protected by
  rules at all — see §5.

**The exposure being closed is outsider-with-URL, not colleague-to-colleague.** The member selector
already lets any staff member view any colleague's roster and leave, by design. Track E does not change
that and is not intended to.

**Be honest about the bar.** The Firebase project config ships in the client JS, so a determined reader
can replicate the anonymous sign-in. Level 1 raises the cost from "trivially public" to "must script an
anonymous session against our project". Only Level 2 (named) means "must be staff".

---

## 3. The phases

### E0 — exclude search engines ✓ SHIPPED v19.00
`X-Robots-Tag: noindex, nofollow` on Firebase Hosting + a mirrored `<meta name="robots">` in all ten
served pages, because GitHub Pages serves no headers and a `robots.txt` cannot reach the mirror (only
honoured at an origin root; the mirror lives under `/roster-app/`). `robots.txt` deliberately **permits**
crawling — a crawler blocked from fetching can never read the noindex, so `Disallow: /` would hide the
signal rather than the page. Guarded by `sw-asset-check.test.mjs`. Needed no decision and depends on
nothing below.

### E1 — make the calendar's reads auth-aware ✓ SHIPPED v19.01
**Ship as its own release, before any rules change.** `calendarAuthReady` (`calendar-app.js`) gates only
*writes* — error reporter, usage counter, push renewal. Four paths read with whatever auth state happens
to exist:

| Path | Reads |
|---|---|
| `calendar-initial-fetch.js` | the 3-month `overrides` fetch |
| `calendar-huddle-viewer.js` | the `#huddle` snapshot |
| `calendar-doc-viewer.js` | `#circular` / `#newsletter` (notification taps) |
| `nav-panel.js` | the drawer's Circular/Newsletter open |

Harmless under `allow read;`. The moment reads need a session, all four race `signInAnonymously` on a
cold start — an empty calendar, or a notification tap that opens nothing. This ships green under today's
rules, so it soaks alone and turns E2 from "a rules edit that might break notification taps" into "a
rules edit".

#### The design (settled after a pass over the four call sites)

**The four paths are not one problem — they split two ways, and only one is delicate.**

| | Paths | Why |
|---|---|---|
| **User-initiated** | huddle subscribe · doc viewer · nav-panel doc open | The user just tapped something and all three already show a pending state, so waiting is what they expect — but a **BOUNDED** wait (v19.07/19.08). A plain `await` was shipped here first and was wrong three times over; see the correction below. |
| **Render path** | the 3-month `overrides` fetch | The only one on the critical path to seeing your roster, and the only one that must work offline. A plain `await` here is the offline-first regression. |

So the risky work is **one** path, not four.

**A bare `await` on the render path is wrong.** `signInAnonymously` is a live round-trip with no client
timeout. Today `fetchOverridesForRange` fires immediately and Firestore serves from its persistent cache
on bad signal; gate it on auth and a returning device with flaky signal waits on the network for data it
already has. The obvious patch — bound the wait, then read anyway — is also wrong: under E2's rules the
unauthenticated read is denied, so a slow first visit shows a spurious "⚠ Couldn't update". That trades an
offline-first regression for a flakiness one, and needs a timeout constant with no basis to pick it.

**CORRECTION (v19.07–19.08) — "user-initiated" does not mean "may wait forever".** The first cut of
E1 used a plain `await authReady` on all three tap paths and on the retry, reasoning that a visible
pending state made waiting acceptable. It does not: a loading state tells you something is happening,
it does not make an unbounded wait **recoverable**. Three defects followed, found across two review
passes:

| Path | What a never-settling `authReady` did |
|---|---|
| `calendar-doc-viewer.js` | A notification tap sat on "Loading…" **forever** — the fetch never attempted, no failure ever announced to a screen reader. |
| `nav-panel.js` (operations/links) | Those pages leave `sessionReady` unresolved until sign-in, so a signed-out tap stalled the full 8s and failed — where before it opened instantly. |
| `doRetry` | The retry chip stuck on "Retrying…", disabled, with no handler — a dead end worse than the failure it was recovering from. |

All four now wait a bounded moment and then read regardless: that succeeds under today's open rules
and, once reads require a session, fails into an existing retryable path. **The rule to carry into
E2/E5: no user-facing path may await auth without a deadline, and every failure state needs a
control, not just text.** The render path is the one place that must not wait at all — for the
opposite reason (the data is already cached).

**Instead: paint from cache immediately, refresh authoritatively once auth lands.**

1. **`reconcileRangeIntoCache` gains an `authoritative` flag.** Its eviction sweep (step 2 — drop in-range
   keys the snapshot omits) is already a separable loop. A **cache** snapshot is by definition a possibly
   stale subset, so it must merge additively and evict nothing. Skipping eviction is the whole change.
   **This is the load-bearing detail:** two authoritative reconcilers racing on one range is exactly the
   v18.76 Team View bug, where the staler snapshot wiped the grid back to base roster.
2. **A cache-only sibling to `fetchOverridesForRange`** using `getDocsFromCache` (available in the SDK,
   not currently imported into `firebase-client.js`). It never sets the error chip — a cache miss is
   normal, not a failure.
3. **`initInitialFetch` becomes two-phase:** fire the cache read immediately and paint; then
   `await calendarAuthReady` and run the existing authoritative server read.
4. **Generation guard** — reuse the existing `_fetchGen` supersession pattern so a slow cache read can
   never clobber a server read that already landed.
5. **The sync chip keeps tracking the server phase only.** The 800ms "↻ Updating your shifts…" still means
   "fetching fresh", which is still true.

**Two properties worth noting.** It needs **no timeout constant anywhere** — the objection that killed the
bounded-wait shape. And a cache-first paint is exactly what E4's grace mode needs, so that phase gets
part of its work done here.

**The three user-initiated paths, concretely:**

- **Huddle** — `await calendarAuthReady` before `startHuddleSubscription()`, and move the 8s safety
  timeout to *cover* the auth wait (start it on invocation, not on attach) so time-to-error is unchanged.
  Gating the attach also fixes a real E2/E5 hazard: an `onSnapshot` that hits `permission-denied` is
  **terminated**, not retried, and today only recovers on the next `visibilitychange` — useless to
  someone staring at a notification tap.
- **Doc viewer** — `await` inside `openDoc()` before the fetch; the existing loading state covers it.
- **nav-panel** — add `authReady` to the `initNavPanel({…})` options bag (default `Promise.resolve()`),
  each page passing its own: `calendarAuthReady` on the calendar, `sessionReady` on the five authenticated
  pages. Follows the existing per-page injection precedent (`isAdmin`, `onLogoClick`, `usageIdentity`).

**The guards (written first, both teeth-verified):**

- `calendar-initial-fetch.test.mjs` — inject an auth promise that **never resolves**; assert the cache
  read still goes out and paints. Teeth-verify by implementing the naive `await` and watching it fail.
- `override-utils.test.mjs` — additive mode evicts nothing; authoritative mode still does.

Both land in `npm test`, so CI gates them — unlike `e2e/offline.spec.js`, which is opt-in and stubs
Firebase at the network layer, so it could neither gate this nor observe real cache behaviour.

**Behaviour under today's rules is unchanged** — both reads succeed; the cache paint just arrives sooner.

### E2 — Level 1 rules: `request.auth != null`
On `overrides` + the three document collections, only after E1 has soaked. Blocks unauthenticated REST
scraping and casual URL sharing. ~6 of the 199 tests in `firestore.rules.test.mjs` flip (`anon can read`
→ `assertFails`, plus new authenticated-anon cases). Keep the Anonymous auth provider **enabled**.

### ⟨ DECISION GATE ⟩ — is Level 1 enough?
Binary, and it decides whether this is a day or several weeks.

- **Casual exposure** (indexing, a shared link, idle curiosity) → E0+E2 are sufficient. **Stop here.**
- **A motivated outsider** willing to script an anonymous sign-in → you need named-only (E5), and you
  buy the front-door cost that E3/E4 exist to manage.

Everything past this gate touches the app's front door, opened many times a day.

### E3 — named calendar, soft posture
Flip `PAGE_POLICIES.calendar` to `{ requireNamed: true }` in `auth-policy.js` (genuinely one line — the
policy layer is clean) and wire the shared `login-overlay.js`. Gate on `ENFORCE_NAMED_SESSION` in **soft**
posture and *measure* (§6) before hardening. Do not tighten rules in the same window.

Two things make this less of a leap than it sounds: the calendar already has session-gated affordances
(the pay-period strip, `calendar-app.js`), and `login-overlay.js` is proven on five pages. It also
*removes* an inconsistency — today the app has two contradictory onboarding stories, one where a new
starter picks a name from a dropdown and one where they sign in.

### E4 — offline grace mode (ships **with** E3, not after)
See §4. Without it, E3 is a genuine regression; with it, it is not.

### E5 — Level 2 rules: `token.name != null` + hard gate
Only after E3 soaks and the numbers say the wall is survivable. At this point `signInAnonymously` is dead
code and the **Anonymous provider can be disabled project-wide** — real hardening, and it settles the
"retire the anonymous fallback" residual in SECURITY_RELEASE_PLAN. Decide those two together.

> **⚠️ NOT YET ANALYSED — do not treat `token.name != null` as a one-line rule.** The B-track needed a
> whole permissive→strict migration and a `CLAIM_EPOCH` token sweep because claim tiers are subtle, and
> that was for **writes**, where `writeWithClaimRetry` self-heals a stale token. The equivalent analysis
> for **reads** has not been done. Two things already found by inspection, both of which E5 must answer:
>
> 1. **Reads have no claim-retry anywhere on the calendar or paycalc.** `withClaimRetry` wraps reads on
>    `operations-app.js`, but no calendar or paycalc read uses it. So a stale-claim read just fails,
>    where the equivalent write would recover. Either reads gain the retry before E5, or E5 must prove no
>    legitimate reader can hold a stale claim — the B-track's answer was a token sweep, not an assumption.
> 2. **paycalc's soft posture silently loses its calendar assist.** `paycalc-app.js` reads overrides via
>    `fetchOverridesForPeriod(p, session2.name)`, and that name is a **local** session value, not proof of
>    a Firebase named token. The page's policy is deliberately `soft` so the calculator keeps working when
>    auth does not. Under E5 that read is denied; `paycalc-roster-suggestions.js` catches it and falls back
>    to "base roster only", so it degrades rather than breaks — but it degrades **invisibly**, and it does
>    so for exactly the users the soft posture exists to protect. Decide deliberately whether that is
>    acceptable, and if it is, say so in the UI rather than letting the pre-fill quietly stop.
>
> Enumerate every override reader and the identity it actually holds at read time **before** writing the
> rule. That list does not exist yet.

### E6 — put the document FILES behind auth (independent; can start any time)
See §5. Does **not** depend on the calendar decision.

---

## 4. The offline answer (E4)

Track E originally called offline lockout "the sharpest consequence… a genuine regression to weigh". It
is softer than that, because **both halves are ours**:

- The 30-day/7-day expiry is *our* localStorage construct (`SESSION_MS` / `IDLE_MS` in `session.js`), not
  Firebase's. Firebase refresh tokens do not expire on that schedule.
- **Firestore rules are evaluated server-side.** The persistent local cache serves offline reads without
  consulting them. The roster is still on the device.

> **⚠️ The second bullet is an UNVALIDATED assumption, and this whole section rests on it.** It is how
> Firestore is documented to work, but it has never been demonstrated *in this app*, and E4 is what makes
> E3 acceptable rather than a regression. **Prove it before anyone relies on it**, with a throwaway
> experiment against the Firestore emulator: deny reads at the rules level, populate the persistent
> cache, go offline, and confirm a `getDocsFromCache` read still resolves — then reconnect and confirm
> what a live listener does. An hour's work that decides whether E3 is shippable.

So an offline member with a lapsed session would not be locked out by Firebase — they would be locked out
by *our own overlay*. That makes it a design problem, not a constraint.

**The design:**

1. Keep a **durable device marker** ("this device has previously held a valid named session"), separate
   from the expiring session blob. `reconcileExpiredIdentity()` currently signs the Firebase user out on
   expiry, so the marker cannot be inferred from auth state afterwards — it must be written deliberately.
2. On launch: session expired **and** `navigator.onLine === false` **and** marker present → render the
   cached roster **read-only** with a calm banner ("Showing your saved roster — sign in when you're back
   online"), instead of the login overlay.
3. **Read via `getDocsFromCache` explicitly in grace mode.** A live listener would try to re-attach on
   reconnect and surface `permission-denied` under Level 2 rules, blanking a roster the member was
   reading a second earlier.
4. The moment connectivity returns, require the real login.

**Why this costs nothing against the threat being defended.** Grace mode only helps someone holding a
device that was already signed in — the device-theft threat model, not outsider-with-URL. It is no weaker
than today's behaviour, where a cached roster always renders.

**The other three front-door consequences**, for completeness: notification deep-links must survive the
login flow (a `#huddle` tap on a lapsed session lands on a login screen); first-run onboarding becomes
"sign in" rather than "pick your name"; and the document viewers currently rely on open reads *because*
the calendar had no session, so E5 couples them to login working on every path.

---

## 5. The documents are the gap nobody asks about (E6)

`storage.rules` gates direct Storage SDK reads, but staff never read documents that way — they open the
permanent tokenised `storageUrl` saved in the Firestore doc, which carries its own access token and
**bypasses the rules entirely**. `storage.rules` says so itself: *"Don't store confidential files here
unless that delivery model changes."*

**Therefore: no phase in E1–E5 puts these documents behind authentication.** Those phases change who can
*discover* a URL. Anyone who has ever held one — a forwarded link, browser history, a synced bookmark —
keeps access indefinitely, and revocation means rewriting the object, not editing a rule.

Worth stating plainly when prioritising: **the change everyone reaches for first (a login on the
calendar) protects the personal data and leaves the company-confidential documents exactly as they are.**

### E6 is a sketch, not yet a plan — the Office viewer blocks the obvious route

**A third party already fetches these documents by URL.** Word circulars and newsletters open through
`officeViewerUrl` (`storage-utils.js`), which hands the storage URL to **Microsoft's Office Online
viewer**, and Microsoft fetches the document **server-side**. Two consequences that reframe E6:

- **Authenticated `getBlob` — the cheapest option — would break `.docx` viewing outright.** Microsoft
  cannot fetch an auth-gated URL. Any design that removes public fetchability must replace the Word
  rendering path at the same time, not as a follow-up. That is a UX change (Word documents currently
  render with images instead of downloading — the v16.45 fix), not a plumbing change.
- **"The documents are behind authentication" cannot be claimed while this path exists**, whatever the
  rules say. That is true *today* and independent of Track E; it belongs in any conversation with IT
  about where the data goes.

So the options are narrower than they first look:

| Option | Verdict |
|---|---|
| Authenticated `getBlob` | **Breaks Word viewing.** Only viable bundled with a replacement renderer (or accepting download-instead-of-render for `.docx`). |
| Short-lived signed URLs from an authenticated Function | Plausible — but the window must be long enough for Microsoft to fetch, and the document still reaches Microsoft. Narrows exposure from *forever* to *the signing window*; does not remove the third party. |
| Convert `.docx` → HTML at upload (as the Huddle already does via Mammoth) | Removes the Microsoft dependency entirely and makes `getBlob` viable. Biggest change, best end state. Worth costing before assuming signed URLs are the answer. |
| Accept it | Fine, but as a recorded decision rather than an accident. |

Whichever is chosen, **existing tokens must be rotated** — old URLs stay live until the objects are
rewritten. **Cost this properly before scheduling E6**; the estimate implied by "swap the delivery model"
was written before the Office-viewer dependency was noticed.

---

## 6. What to measure

### Before the gate — using data that already exists

Do this *first*: the decision does not have to wait for E3 telemetry. **`getSignInStats.neverSignedIn`
(shipped v18.96) already counts provisioned accounts that have never signed in** — a decent proxy for the
pure-roster-viewer population, which is precisely who E3 would wall and who Track C5 cannot reach. If
that number is small, the front-door cost is small and the gate is easier. If it is large, E3 is a much
bigger behaviour change than "add a login" and the E4 grace mode carries more weight.

Caveats, so the number is read honestly: it measures **sign-ins, not activity**, there is no history
(only the last sign-in is stored), and it cannot see someone who uses the calendar without an account at
all. It bounds the question rather than answering it — but it bounds it today, for free.

### During E3 (soft)

Shipping the soft posture blind means guessing at the hard cutover. `perf-reporter.js` already records
`loginTotal`; add anonymous counters (no identity, same model as the existing analytics) for:

- launches that hit the wall
- launches resolved by an existing session
- grace-mode activations
- login failures at the wall

Two weeks turns "is a login wall on the home screen acceptable?" from an opinion into a number.

---

## 7. Owner decisions

| Decision | Blocks | Notes |
|---|---|---|
| **Which bar — casual, or motivated outsider?** | the gate after E2 | The one answer that decides day-vs-weeks. May be dictated by IT. |
| Is a login wall on the home screen acceptable? | E3 | The calendar is opened many times a day. |
| Is grace mode (§4) an acceptable answer to offline? | E4 | If not, the alternative is longer sessions, not "accept the lockout". |
| Member selector vs identity | E3 | Default to your own roster, or keep a free selector with login as a pure gate? UX, not security. |
| Analytics identity guarantee | E3 | Keep the calendar identity-free, or make it an active-account surface? |
| Anonymous provider fate | E5 | Disable project-wide, or keep as a Level-1 tier? |
| Retire the GitHub Pages mirror? | asserting "behind auth" | See §8. |
| Do E6 at all, and which delivery model? | E6 | Independent of everything above. |

---

## 8. Dependencies and anti-goals

**Track E is the missing precondition for Track C5.** The forced password-set (v18.92) only reaches people
who sign in somewhere; `PASSWORD_PLAN.md` records that a pure roster-viewer is never compelled. So the
≥90% migration metric gating retirement of the surname default **cannot converge** without E3/E5. If
finishing the password work matters, that is an argument for Track E with nothing to do with IT.

**The GitHub Pages mirror is a second public front door.** Level 2 rules protect the data on both origins
(same Firebase project), so it is not a hole. But if the driver is "roster data must not sit on a public
URL", a second public origin that cannot serve headers undercuts the claim. Retiring it is likely a
prerequisite for *asserting* the app is behind auth, separate from *being* behind auth.

**Anti-goals — do not:**

- **Do not** ship E3 (client gate) as if it were security. Without E5 the data is unchanged.
- **Do not** bundle E1 into E2. The read-await must soak on its own; that is the whole point of splitting
  them.
- **Do not** flip in one step. E0 → E1 → E2 → ⟨gate⟩ → E3+E4 → E5, reusing the staged posture the B-track
  proved.
- **Do not** treat E6 as part of the rules work. Different failure domain, different fix, independent
  schedule.
- **Do not** verify any of this from an installed phone. Always a **fresh private window with a cold
  cache** — the installed PWA launches from the service-worker cache and will happily hide a broken live
  site (CLAUDE.md → "Deployment health check").
- **Starting E2 consciously REVERSES a documented anti-goal** (the calendar's deliberate anonymous read
  surface, SECURITY_RELEASE_PLAN → "What NOT to do"). Re-stamp that entry when it happens — do not
  violate it silently.

---

## 9. Verification checklist (per phase)

- [ ] Fresh **private window**, cold cache — not an installed PWA.
- [ ] Notification tap on a cold start opens the Huddle (E1/E2/E5 all touch this path).
- [ ] Drawer → Circular and Newsletter still open in one tap.
- [ ] Aeroplane mode with a valid session: cached roster renders (E4).
- [ ] Aeroplane mode with an expired session: grace mode, not a login wall (E4).
- [ ] `npm run test:rules` — the rules behave as written.
- [ ] `npm test` — `firestore-contract-parity.test.mjs` still passes (the client↔rules lists).
- [ ] Rollback rehearsed: every phase is a flag flip or a rules revert, no data migration.
