# LATENCY_PLAN.md — sign-in and Calendar start

*Created August 2026 (at v21.30), external review. Not version-stamped; not a runtime asset.*

**This is no longer a programme of engineering. It is TWO OPEN ITEMS and a close-out rule** (deep
review, 30 Aug 2026). It began as four phases to do in measured order; the measuring is what ended
that. Phase 1 shipped. Phase 3 was priced at 4.6–52 ms against a wall of over a second and
**declined**. Phase 4's trigger did not fire. What remains is not work:

| Open item | What it is | Who / when |
|---|---|---|
| ~~**The identity round trip**~~ | **ANSWERED 5 Sep 2026 and SHIPPED (v22.97)** — see the section below | Gareth · done |
| **The Phase 2 reading** | A NUMBER — the card's "What put the shifts on screen" split, read against the rule in the Phase 2 section | ~end September 2026, one full month after v21.99 |

**The close-out changed shape when the identity question was answered YES** (see below). The path
this section anticipated — "no, the gate holds", and the plan closes recording the second as the
price of the security model — is not the one taken. What closes it now is a READING: the next App
Speed month has to show the `Recognised` → `Shifts shown` gap actually moving for the population the
fast path serves. **A shipped change is not a measured one**, and this plan's whole method has been
to refuse that substitution.

**The paragraph below is kept because its reasoning still holds for anything that comes after this.**
There is a likely path where the remaining answers come back small. In that world this plan
**CLOSES**, recording what is left to `Recognised` as the PRICE OF THE SECURITY MODEL — a cost that was chosen, not a problem nobody
solved. That is a success ending, not a failure: the alternative is a plan that can only end by
fading, which is the quiet stop the section at the bottom warns against. Do not go looking for a
Phase 5 to make the plan feel finished — twice this week, measuring first stopped confident work
worth five milliseconds, and a review that ended by inventing new work would be undoing its own
lesson. **No engineering left in this file plausibly moves the number.**

## A SECOND cost, and this plan was structurally blind to it (v22.90)

**Everything above measures ONE page load. Nothing above counts how many page loads a member is made
to do.** That gap is where a real contributor was hiding, and it is not a wall this document could
have found by reading its own card: a reload is recorded as one more ordinary sample, so a member
interrupted and rebooted appears in the data as two unremarkable loads.

**The mechanism.** A version bump renames the SW cache, the new worker `skipWaiting`s on install and
claims immediately, and `controllerchange` reloaded the page — on the Calendar, 500 ms later and with
no prompt. A member reading their roster watched it vanish and rebuild, paying a **second full boot,
including the `accounts:lookup` round trip this document spends its length on.**

**The frequency is the finding.** Measured on `origin/main` for the fourteen days to 5 Sep 2026:

| | |
|---|---|
| releases | **62 in 14 days** |
| busiest day | **17** |
| 4 of the last 5 days | 9 · 17 · 11 · 11 |

`registration.update()` runs hourly *and on every `visibilitychange` back to visible*, so bringing
the app to the foreground is itself an update check. At this cadence a member who opens the Calendar
several times a day will meet a reload regularly, and each one costs the full start over again.

**Fixed at v22.90, narrowly.** `deferWhileVisible` holds the reload until the page is hidden —
seconds away on a phone, and invisible when it happens. The update still lands, so the mixed-version
hazard the reload exists to close is not reopened; only its TIMING moved. Opt-in, and the Calendar is
the only caller: the pages that ask before reloading do so because a member may have unsaved work, and
deferring that question would greet them with a confirm on return.

**What is claimed, and what is not.** The mechanism and the cadence are measured — the reload is
asserted by `sw-register.test.mjs`, and the release counts come from the git log. The FIELD
contribution is not: the analytics are admin-only, so nobody has yet counted how many Calendar opens
were followed by a reload seconds later. **That number would settle how much of the complaint this
owns, and it is the natural next reading** — two `ready` samples from one device inside a few seconds
is the signature. Until it exists, treat this as a removed cost of unknown size rather than as the
explanation.

**It does not touch the identity decision.** The round trip is still the wall on a single load, and
`ROADMAP.md` still owns that call. What changed is that some members were paying it twice.

### The reading it named is now being taken (v22.92)

The paragraph above says the field contribution is unmeasured and names counting it as the next
reading. This is that instrument, and it is deliberately not the shape the paragraph guessed at.

**Not "two `ready` samples from one device inside a few seconds".** The analytics are counters, not
events — `perf_<YYYY-MM>` holds `version|page|metric|bucket|mode|conn → count` and no device
identity, deliberately, so there is nothing to correlate a pair against and adding one would trade
the privacy property for a statistic. The device that knows is the device it happened to, at the
moment it happened, so it says so: `sw-register.js` stamps a sessionStorage timestamp when it
commits a reload, and `perf-reporter.js` reads it back on the load that follows and records
`readyUpdate` beside the ordinary `ready`.

**What it can answer, once staff devices report.** `readyUpdate` is a strict SUBSET of `ready`,
written from the same bucket on the same code path, so the counts divide: the share of Calendar opens
that followed a release, and what those opens cost against every other open. Rendered on the App
Speed card as "Opens that followed a release".

**And the caveat that has to travel with it, because it inverts the obvious reading.** Since v22.90
the Calendar's update reload runs while the page is HIDDEN. So on the Calendar this measures a
BACKGROUNDED load — which is the right question now (did the deferred reload finish before the
member came back?) and is emphatically *not* the cost of the behaviour v22.90 removed. That cost is
now unmeasurable in the field, and honestly so: the only way to measure it would be to reinstate it.
What survives is the FREQUENCY, which is the half that sizes the complaint, and on the pages that
still reload in the foreground the duration means what it looks like.

---

Design detail lives beside the code, as ever — `perf-reporter.js` and `perf-stats.js` for what is
measured, `AI_MAP.md` for the ladder's exports, `CALENDAR_DATA.md` for the invariants any change
here must not break. This file holds the sequence, the readings and the decision rules.

---

## What was already good, and why the obvious answers were refused

The review's own framing, kept because it stops the next reader re-proposing them: service-worker
SWR caching, the SDK cache, `modulepreload` on the two heaviest pages, 60-day sessions, in-place
sign-in, `primeAuth`, the Firestore local cache and the cache-before-server Calendar read were all
already in place. The remaining gains need the critical path to CHANGE, not to be tuned.

Two things were considered and refused outright:

| Refused | Why |
|---|---|
| **Render the base roster instantly, correct it when Firestore answers** | Override-unknown is not override-absent. It would look fast and reintroduce the exact defect `calendar-data-state.js` exists to prevent. **Latency must not buy a false roster.** — And this refusal is NOT the open `ROADMAP.md` identity question, though they rhyme: that one paints CACHED overrides (real data, correctly labelled) before the server confirms the *account*; this one would paint the base roster while overrides are *unknown*. Refusing the second says nothing about the first, and neither may be cited to settle the other. |
| **Extend the session past 60 days** | It reduces how OFTEN latency is felt without improving it, and lengthens the life of a stale local session. Optimise the real path instead. |

---

## Phase 1 — SHIPPED (v21.29–v21.30)

| Change | Outcome |
|---|---|
| One shared Firebase auth bootstrap | Three `onAuthStateChanged` subscriptions with three bounds became one. The Calendar's worst-case access decision went from **two stacked ceilings (6.5s + 6s) to a single 6.5s budget** |
| `markPageReady` means a real roster grid | It was timing the withheld "Checking this month…" state — and doing so most often on the SLOWEST loads, so the figure was biased in the flattering direction and unreadable in either |
| The local cache wins the first paint | A bounded 90ms for phase 1's IndexedDB read, so a returning device stops painting a spinner over data milliseconds away |
| The start ladder | Four cumulative milestones — Recognised · Unlocked · Shifts shown · Confirmed — rendered as "How far the start gets" |

**The ladder is the deliverable that matters here**, because it is what makes the rest of this plan
decidable rather than arguable.

---

## The decision rule — read this before starting phase 2 or 3

The four milestones nest, so the biggest gap between adjacent rows names the phase to do next.
Compare rows; do not do arithmetic.

| The gap is between | What is slow | Do |
|---|---|---|
| page start → **Recognised** | restoring the saved sign-in | ~~Phase 3~~ — **measured and declined**; the gap is one auth round trip, and skipping it is the `ROADMAP.md` identity decision, not a build |
| Recognised → **Unlocked** | the access decision itself | re-read `calendar-access.js` |
| Unlocked → **Shifts shown** | reaching a roster at all | **Phase 2** (fetch less, sooner) — read "What put the shifts on screen" first |
| Shifts shown → **Confirmed** | the authoritative Firestore read | **Phase 2**, and its member/month narrowing especially |

The first row is struck through rather than deleted because the rule was FOLLOWED: the ladder named
Phase 3, the proof priced it, and the answer redirected the question. A table quietly rewritten to
the outcome would hide that the method worked.

**Wait for a full month before reading it.** The card's own `THIN_SAMPLE` rule governs these rows;
a week of data on a 50-person app can read 100% and mean nothing.

**One honest caveat:** the ladder measures the Calendar only, and only loads that reach each rung. A
member who never gets past the gate contributes no `Confirmed`, so that row's population is smaller
than the ones above it by construction — the same property the card already states about `ready`.

---

## First reading — 22 Aug 2026 (owner screenshots of the live card; PROVISIONAL, month incomplete)

Recorded against the decision rule above so the numbers and the verdict sit next to the rule that
produced them. **Read from the deployed Operations card, not from this repo** — the analytics are
admin-only, so screenshots are the record. **Superseded by the confirmation read below; kept because
the two together are the evidence that the verdict is stable rather than a single month's shape.**

**The boot stages exonerate the code.** Waking up 9% over ½s (989 opens) · Loading code 11%
(1,052) · Getting ready 0% (1,114). The SW, the module graph and the no-bundler trade are all fast
in the field — Phase 4's trigger did not fire.

**The ladder, cumulative (Calendar, 1,619 opens this month):**

| Rung | over 1s | jump | opens |
|---|---|---|---|
| page start → **Recognised** | 56% | **+56 ← the wall** | 494 |
| → Unlocked | 62% | +6 | 497 |
| → Shifts shown | 71% | +9 | 863 |
| → **Confirmed** | 100% | **+29** | 458 |

**Verdict per the rule: Phase 3 first** — the dominant gap is `page start → Recognised`, i.e.
restoring the saved sign-in, and everything downstream inherits it (the access decision and the
cache paint are cheap once identity exists). **Phase 2 second**, against the Confirmed row: the
authoritative three-months × all-members read finished inside a second on **zero** loads, which is
the plan's own prediction confirmed rather than news — it shapes the sync chip's lifetime, not what
the member feels.

Three cautions attached to the verdict:

- **Loading code is fast, so the Recognised delay is not parsing.** Some of it is Firebase's own
  restore work — IndexedDB read, token refresh over the network (4G-like loads run 18% over 1s vs
  11% not-reported, which smells of network). Phase 3 removes Firestore from auth's path but may
  not buy the whole 56 points; the prove-it-on-one-page step exists precisely to find out.
- **Row populations differ by construction** (the caveat above): viewer/PIN loads never reach
  Recognised, and Confirmed only counts loads that stayed open for it.
- **This ladder and the "asked for my password every time" complaints (Aug 2026) are very likely
  one phenomenon.** A restore tail slow enough to blow the 6.5s access budget puts the sign-in card
  up until `watchForLateNamedIdentity` withdraws it. Phase 3 is therefore also the treatment for
  the complaint's transient-flash arm.

---

## Confirmation read — 30 Aug 2026 (owner screenshot; the month effectively complete)

The read the section above deferred. August is 1½ days from ending and the Calendar sample has gone
from 1,619 opens to **2,226**; no row here can move materially in what is left, so this is recorded
as the confirmation rather than a second provisional. **The verdict is unchanged on 2× the sample,
which is the useful part** — a decision this size should not rest on one partial month.

**The boot stages exonerate the code — CONFIRMED.** Waking up 10% over ½s (1,513 opens) · Loading
code 12% (1,623) · Getting ready **0%** (1,738). Every figure is within a point of the provisional
on ~50% more data. **Phase 4's trigger did not fire, and the no-bundler trade is measured, not
argued.**

**The ladder, cumulative (Calendar, 2,226 opens):**

| Rung | over 1s | jump | opens | (22 Aug) |
|---|---|---|---|---|
| page start → **Recognised** | 52% | **+52 ← the wall** | 1,072 | 56% |
| → Unlocked | 58% | +6 | 1,086 | 62% |
| → Shifts shown | 75% | +17 | 1,493 | 71% |
| → **Confirmed** | 100% | +25 | 1,045 | 100% |

**Verdict per the rule: Phase 3 first, confirmed.** The dominant gap is still `page start →
Recognised` by a factor of three over its nearest rival, and the two rungs that moved (Shifts shown
+9→+17, Confirmed +29→+25) traded with each other without touching the wall.

**The sharpest single fact in this read is not in the ladder at all.** All three boot stages finish
inside ½s on ~90% of opens — *Getting ready* is 0% over ½s across 1,738 of them — and yet **21% of
page opens take over three seconds to become USABLE** (32% under 1s · 46% 1–3s, 1,695 opens). The
code is ready and the page is not. Everything a member waits for is therefore downstream of DCL, in
the identity restore and the access decision, which is precisely what Phase 3 addresses and is a
stronger statement of it than the ladder alone makes.

**Three things worth knowing before reading any dimension on this card:**

- **The connection split is probably reading the PLATFORM, not the network.** Not-reported runs
  **10%** over 1s (1,163 opens) against 4G-like's **20%** (1,041) — i.e. the devices that report no
  connection class are the FASTER half. `NetworkInformation` is unimplemented in Safari, so
  "not reported" is largely iOS and "4G-like" largely Android. Treat the row as a device split
  until something distinguishes them. The provisional read drew the opposite inference from the
  same two rows ("smells of network"); on the fuller sample the gap widened rather than closed,
  which fits a platform explanation better than a signal one.
- **The installed app is SLOWER than a browser tab** — 16% over 1s (1,736 opens) against 11% (490).
  Counter-intuitive, and not yet explained. The likeliest reading is population rather than
  performance: an installed app belongs to somebody with a saved session to restore, while a
  browser tab is disproportionately a PIN unlock or a first visit, and neither of those runs the
  member chain that the wall lives in. **Do not act on this row** — it is a hypothesis with an
  obvious confound, and it would be settled by splitting `Recognised` by install mode rather than
  by changing anything.
- **Every by-version row is at or near the thin bar.** `THIN_SAMPLE` is 20; these rows carry 24–46
  opens each (two exceptions at 152 and 214). v21.91 reading 23% against v21.78's 4% is noise on
  ~30 samples, not a regression to hunt. The card withholds a verdict below 20 and does not shade
  it above; that is the reader's job here.

---

## THE FIELD READ — 5 September 2026

**The outstanding validation is closed: the identity round trip is confirmed on live staff devices.**
Until now this rested on a controlled experiment (+300 ms injected into `accounts:lookup` moved the
milestone +335.7 ms) and an August field localisation. The September App Speed card supplies the
signature the plan said to look for.

| Calendar milestone | over 1s | opens |
|---|---|---|
| Recognised | 60% | ~476 |
| Unlocked | 58% | ~477 |
| Shifts shown | 78% | ~472 |
| Confirmed | 98% | ~423 |

**The comparison that settles it** is `Recognised` against `Getting ready`, split by connection:
Recognised moves with the connection grouping (~60% on the 4G-like group, ~43% on "not reported")
while **Getting ready is 0% over half a second in every group**. Same populations, large difference
at the network-dependent rung, none at all at the code-loading one. That is exactly the pattern this
plan nominated as the test.

**One confound, stated rather than smoothed over:** "not reported" is disproportionately Safari/iOS,
because Safari does not expose `navigator.connection`. So 60% against 43% is not "Android's
connection is 17 points worse" — the browser mix differs too. It does not undo the comparison,
because the Getting-ready row is flat across the same split.

**What the ladder does NOT say.** Recognised is 60% and Shifts shown is 78%, so roughly eighteen
points appear after the member is identified. The milestones are cumulative over populations that
are not perfectly identical, so that is not "18% are delayed by X" — but it does mean identity is
not the whole of it. **`rosterCached` was added at v22.95 for exactly that gap**, and it is the next
reading.

**And a correction worth keeping: the app has not recently got slower.** Usable-within-a-second went
32% (end August) → 35% (September). Recognised went 52% → 60% while the code-loading figures stayed
flat. The complaint is real and the telemetry agrees with it, but nothing here supports reverting
recent Calendar work — which was the fear this whole investigation started from.

## Phase 2 — CLOSED on its own decision rule (5 Sep 2026)

**The rule below fires, and it fires clearly.** Of the starts that could be attributed, **454 came
from the device's saved copy and 8 from the server** — 98.3% cached. Phase 2 narrows the
authoritative read, which by this plan's own argument cannot move a cache-served first paint by a
millisecond. It would be a rewrite of the read path, carrying the Team View eviction trap, for a
population that is 1.7% of attributed opens.

**Read EARLY, and here is why that is defensible.** The plan named "~end September, one full month
after v21.99" and it is the 5th. The wait existed so nobody would read a confident PERCENTAGE off a
thin server arm — and that is not what is being read. The server arm is thin *because almost nobody
is in it*, and the quantity the rule keys on is its SHARE of the whole, over 462 attributed opens.
A month more data would have to change that share by a factor of twenty to flip the decision.

**It reopens if that share moves.** The reading is on the card permanently; if the cache-miss
population grows — a storage-eviction change, a large intake of new devices — this comes back.

**The other half of the same reading:** 78% of those cache-served starts still take over a second to
put shifts on screen. The roster is already on the phone. It is waiting for permission to be shown,
which is the identity decision in `ROADMAP.md`, not a data-path problem.

## Phase 2 — the Calendar data path

**Trigger:** the ladder shows the gap at Unlocked → Shifts shown, or Shifts shown → Confirmed.

Today the first authoritative read asks Firestore for **every member's overrides across three
months** before the displayed month can be called current. The ordinary member opening the Calendar
wants **one person's current month**. Those are very different workloads, and the composite index
`memberName` + `date` already exists.

1. Fetch the **displayed month** first, rather than previous/current/next together.
2. Background-prefetch the adjacent months once the first grid is up.
3. Then the stronger form: **selected member + displayed month**, on the existing index.
4. Load whole-team data only when Team View needs it.

**The constraint this must not break:** the first grid still may not be presented as current until
its own overrides are authoritative. Narrowing WHAT is fetched is legitimate; narrowing what is
KNOWN before rendering is not. `CALENDAR_DATA.md` invariants 1, 2 and 6.

**And Team View is the trap.** Its fetcher was unified into the shared month machinery at v18.76
precisely because a second authoritative reconciler racing the first evicted overrides the initial
fetch had just loaded. Any per-member narrowing has to keep that single-reconciler property.

### Do not start it until the card answers ONE question (instrumented v21.99)

Phase 3 was the nominated treatment until it was measured, and it was worth 4.6 ms. The same
discipline applies here, and the question is narrower than it looks.

**`Shifts shown` fires on whichever render first puts a real grid up**, and on a device with a warm
cache that is PHASE ONE — no network at all. Narrowing the authoritative read cannot move that load
by a millisecond. On a cache MISS it is phase two, the three-month whole-team query, which the card
says has never once finished inside a second. So Phase 2's entire value is the size of the
cache-miss population, and nothing measured it: the ladder carried connection, install mode and
version, but not what served the grid.

It does now. `markPageReady` takes a source, derived from the display state the Calendar already
computes (`render` means the read landed, `stale` means the cache did), and the App Speed card
renders **"What put the shifts on screen"** directly beneath the ladder rung it splits.

**The reading rule:**

| From the server | Do |
|---|---|
| a small share of opens | **close Phase 2.** It would be a rewrite of the read path, with the Team View eviction trap above, for a population that mostly does not exist |
| a substantial share, and slow | **do Phase 2**, narrowest form first — displayed month before adjacent months, then selected member |

**Wait a full month before reading it**, and mind two things. The two rows do NOT sum to `Shifts
shown` — a page that cannot tell its source reports `ready` alone — so they are shares of the
attributed population, not of the whole. And `THIN_SAMPLE` governs them like every other row on the
card: the cache-miss arm is the smaller by construction, so it is the one that will read as thin
first, and a confident percentage from thirty opens is what this card's own v21.16 pass existed to
stop.

---

## Phase 3 — split Firebase Auth from Firestore

**Trigger:** the ladder shows the gap before Recognised, i.e. cold sign-in and cold Calendar start
are dominated by getting an identity.

> **THE TRIGGER FIRED, THE PROOF WAS RUN, AND THE ANSWER IS NO — do not do this as a latency fix**
> (30 Aug 2026, `experiments/auth-firestore-split-proof/`). The trigger had fired twice on
> independent data, and the prove-it-on-ONE-page step was there because nothing had established how
> much of the 52-point wall Firestore's presence in the auth graph actually owns. It owns almost
> none of it.
>
> | CPU throttle | today (app+firestore+auth) | split (app+auth) | saving |
> |---|---|---|---|
> | 1× | 38.3 ms | 33.7 ms | **4.6 ms** |
> | 4× | 132.9 ms | 119.0 ms | **13.9 ms** |
> | 6× | 229.0 ms | 176.8 ms | **52.2 ms** |
>
> The saving is real, scales with a slower CPU as a parse cost should, and is the wrong order of
> magnitude: **the entire auth boot is 229 ms on a 6×-throttled device**, against a wall of over a
> second on 52% of loads. `initializeFirestore(persistentLocalCache)` costs **0.4 ms** synchronously
> — the cache opens lazily, so the IndexedDB-contention half of the theory is not happening at all.
>
> **The split may still be worth doing on architectural grounds. It may not be sold as the treatment
> for this ladder.** That is the distinction the measurement bought, and it was bought before
> refactoring the module every page in the app imports.

`firebase-client.js` statically imports app, auth **and** Firestore, so somebody who only needs to
sign in still pulls the database SDK into the module graph. Authentication does not require
Firestore.

- `firebase-app` (init) · `firebase-auth-client` (auth, persistence, `authBootstrap`) ·
  `firebase-firestore-client` (db and query helpers).
- `session.js` then depends on auth only.
- Prove it on ONE protected page before rolling it out. Most staff authenticate every 60 days, so
  the Calendar matters more than the login journey — sequence accordingly.

**Cost side, measured and recorded so the next person is not guessing:** the Calendar's critical
path is ~782 KB of unminified JS across 40 modules plus ~214 KB of render-blocking CSS, and under 6×
CPU throttling reaching `myb-sdk-ready` takes 682 ms. See CLAUDE.md → *When a build step earns its
keep*, which this phase does **not** by itself trigger.

---

## What the wall actually is — ONE auth round trip (measured 30 Aug 2026)

The Phase 3 proof is a negative result with a positive half. Because the local cost turned out to be
so small, the missing ~800 ms has to be network — and it is, and it is a single call:

> **Every boot makes exactly one auth request — `POST /identitytoolkit.googleapis.com/v1/accounts:lookup`
> — and `Recognised` waits for it.**

Counted directly, one reload, one request. It is **not** conditional on the ID token having expired:
the measured reloads were seconds apart with a fresh token and the call happened anyway. Firebase
validates the stored user against the server before emitting it, which is a correctness feature —
it is how a deleted or disabled account stops being restored on the next load.

Injecting latency into that one call moves the milestone almost one-for-one — +335.7 ms of
`authBootstrap` for +300 ms of latency. On a real mobile connection that round trip **is** the wall,
and no arrangement of the module graph shortens it.

### THE ANSWER — 5 September 2026, and what shipped (v22.97)

**The owner's ruling: yes, a returning member may see their own already authorised cached roster**
while the lookup completes. `ROADMAP.md`'s option 2 — a named member with a live local session, never
the shared PIN viewer. The standing rule is `CALENDAR_DATA.md` invariant 13; the argument and the
policy cost are in `calendar-access-core.js` → `decideProvisionalAccess`, and the whole pre-decision
entry is preserved verbatim in `ROADMAP_HISTORY.md`.

**What shipped is narrower than the ruling, by two refusals discovered while building it.** The paint
is scoped to ONE member, so a boot that was about to draw somebody else is refused rather than
narrowed: Team View, and a stored selection naming a colleague. Both would have painted a colleague's
base roster with their leave and absence silently missing — invariant 1's failure arriving from a
direction the readiness model cannot see. Those members boot exactly as before.

**What it is worth is NOT YET MEASURED, and must not be assumed.** The prediction is specific and
therefore falsifiable: `Recognised` should stop gating `Shifts shown` for cache-served starts, so the
78%-over-a-second figure for those starts should fall while `Getting ready` is unchanged. Read it in
Operations → App Speed at the end of the first full month. **If it does not move, the diagnosis was
wrong and this is the evidence** — the fast path removes the wait from the critical path by
construction, so no movement means the wall was somewhere else after all.

### Why there is no Phase 5 written here yet

The obvious treatment is to stop waiting: paint from the locally-stored identity and let the lookup
confirm in the background. **That is a security trade, not a performance tweak**, and it is not this
document's to make. `calendar-access.js` decides what a viewer may SEE from the restored identity,
so an account disabled since the last load would be trusted for the length of one paint. The
question belongs to `CALENDAR_DATA.md` and `AUTH_AND_SESSIONS.md`, and it should be answered before
anything is built. **It WAS written up as a decision with the cost priced and three defensible
answers, and it was answered on 5 Sep 2026** — option 2, shipped v22.97; see "THE ANSWER" above. The
write-up is preserved in `ROADMAP_HISTORY.md`, and both contracts now carry the rule rather than the
question (`CALENDAR_DATA.md` 13, `AUTH_AND_SESSIONS.md` 17).

What can be said without that decision: the app already knows how to do this shape safely for DATA
— the Calendar's two-phase load paints from the local cache and then reconciles authoritatively
(E1, `calendar-initial-fetch.js`). Whether identity may take the same shape is exactly the harder
question, because data can be wrong and re-render, and access cannot.

**The measurement also retires a suspicion.** The 22 Aug reading guessed the delay "smells of
network" from the 4G-versus-not-reported split, and the 30 Aug reading argued that split is probably
reading the platform instead. Both were reasoning from a dimension that cannot separate them. This
is the direct answer: it is network, it is one call, and it is on every load.

**One honest caveat, and the check that closes it (deep review, 30 Aug; `VAL-AUTH-006`).** The
round-trip finding rests on an emulator with injected latency — rigorous, and the FIELD contribution is inferred rather
than observed. Before the identity decision is taken either way, confirm it on real devices with the
signature it predicts: **if the wall is the lookup, `Recognised` should track connection quality far
more strongly than `Getting ready` does** — a slow network moves a network wall and barely moves a
parse one. The card already carries both rows and the connection split; the comparison is a reading,
not a build. If the signature is absent, the finding is wrong and the decision should wait.

**And one of the two pre-decision questions is already answered (31 Aug 2026): the check is only
enforced when the network is up.** The offline arm of the same experiment shows Firebase emits the
stored user anyway when the lookup cannot run — so an offline device already trusts the stored
identity under shipped behaviour, and the "no — keep waiting" answer protects strictly less than it
appears. The remaining open reading is the field signature above.

### The field check was NOT readable, and now is (v22.28)

The paragraph above said the comparison "is a reading, not a build". **That was wrong, and it was
gating an owner decision with a mid-October deadline.** Every dimensional split on the App Speed card
ran against a hardcoded `domReady`, so the only milestone anybody could split by connection was the
one this document's own evidence exonerates — *Getting ready*, 0% over ½s across 1,738 opens. The
rung the wall lives in could not be split at all.

Nothing new is measured. `mode` and `conn` have been written onto every ladder sample since v21.30,
so this is a **read of data already collected** — the check can be made against August and September
rather than starting a fresh month's wait. The card now carries **"Does the connection slow the
start?"**: *Recognised* by connection and *Getting ready* by connection, one under the other, on the
same bands, with the reading rule stated between them. It renders both groups or neither — one alone
is a column of percentages with nothing to read it against.

**How to read it, and what each answer does:**

| Reading | Means | Then |
|---|---|---|
| *Recognised* spreads across connection classes, *Getting ready* stays flat | the round-trip finding has its predicted field signature | the identity decision is ready to take on the evidence — `ROADMAP.md` |
| both spread | something upstream of both is slow, and the round trip is not the whole story | do not take the decision on this evidence; find the common cause first |
| neither spreads | the emulator finding does not reproduce in the field | **the finding is wrong.** Say so here and leave the gate alone |

Note the second row honestly: `conn` is `navigator.connection.effectiveType`, which the 30 Aug read
argues is probably splitting PLATFORM rather than network (Safari does not implement it). That
confound weakens a positive reading and does not rescue a negative one — if *Recognised* and *Getting
ready* differ across the same two groups, whatever the groups really are, the difference is between
the two milestones and not between the populations.

---

## Two things this plan is NOT going to do, and why (v22.28)

Recorded so the next reader — or the next review — finds the answer instead of re-deriving it. Both
were proposed in good faith; both fail the plan's own test, which is *would the number change a
decision that is currently open?*

**Percentiles (median / P75 / P95) — NO, and they are not derivable from what is stored.** Samples
are recorded as counts in five coarse bands (`PERF_BUCKETS`: under 500ms · to 1s · to 3s · to 8s ·
over). The median of this app's Calendar start falls inside the **1–3s** band, which is two seconds
wide; interpolating a point estimate inside it assumes a uniform distribution that load times
certainly do not have, and would produce exactly the confident-but-unfounded figure the card's v21.16
pass existed to remove. Finer bands would work and are a WRITE-side change — new key components, and
a step in the series that makes either side incomparable, like the v19.95 usage change.

But the deciding argument is not feasibility. **The bucket edges already answer the threshold
questions exactly** — what share is worse than ½s, 1s, 3s, 8s, with no interpolation at all — and
every open question here is threshold-shaped: the Phase 2 rule turns on a SHARE of cache-miss loads,
and the identity decision is a security trade that a median does not move. A before/after on the
identity change compares like with like on the same statistic. A percentile would be interesting and
would change nothing.

**Cold/warm start classification — NO, mostly present and it thins every row.** `swBoot` already
measures the service worker waking, `mode` splits installed from browser, and "What put the shifts on
screen" is the cache/server split for the data. A further dimension multiplies the key space, and the
by-version rows are already at 24–46 opens against a `THIN_SAMPLE` of 20.

---

## Phase 4 — only if the measurement still says so

Reducing the Calendar's critical `modulepreload` graph, and the bundler question.

**The bundler already has a home and a trigger — `ROADMAP.md` → Build tooling.** It is not restated
here. The one thing to add: the app does not have a general too-much-JavaScript problem (execution
measured at ~18ms), so the case only becomes compelling if the ladder shows the remaining tail in
the fetch/parse phase after phases 2 and 3 have landed.

---

## What would make this file wrong — and how it CLOSES

This section predates the readings and asked a question they have now half-answered: the rows did
not come back uniformly quick, but the slow one led to a decision rather than a build. So the live
version of the question is the close-out in the header, restated here so the two ends of the file
agree: **the plan closes when the identity decision is taken AND the Phase 2 reading is acted on**,
whichever way both go. If both answers are "no build", close it as a success — the second to
`Recognised` becomes the recorded price of the security model, the `Recognised` row is re-labelled a
floor, and this file stops being a plan and becomes the record of why. A plan that was measured and
settled is more useful to the next reader than one that quietly stopped — and also more useful than
one kept alive by inventing a Phase 5.

## Links workspace — measured 24 Aug 2026

Asked whether the links designer could be made faster. Measured before changing anything, on a
throttled phone (4× CPU, 40ms RTT, 4 Mbps):

| | |
|---|---|
| Modules in the static graph | **46** (~1.1 MB) — the largest of the seven pages |
| Grid visible | ~3.5 s |
| Module discovery rounds | **8–9** — the graph is four levels deep, and each level costs a round trip |
| Transfer share | ~1.1 MB at 4 Mbps ≈ **2.2 s**, the dominant cost |

**Shipped (v21.75): `modulepreload`.** Collapses discovery to 1–2 rounds and saves ~100 ms of
DOMContentLoaded, repeatable across three runs on the real page. Cheap, no behaviour change, and
the list is CI-checked against the real graph rather than hand-maintained.

**NOT shipped: lazy-loading the interaction-only modules.** The first estimate was 122 KB and it
was wrong — checked against the code, most of that set is on the boot path: the generator
populates its target table during `initGenerator()`, `loadTargetSets()` runs at init, compare
wires its handlers in the init body, and `isDeleted` runs inside `loadDesigns()`. The genuinely
deferrable remainder is **~53 KB** (`links-import.js`, `links-adjacency.js`) ≈ 100 ms on a cold
load only, and it costs making two synchronous paths async — one of them `checkImport()`, which
sits on a documented trust boundary whose whole design is "refuse rather than half-load". Adding
a module-fetch failure mode there buys ~100 ms for three designers on first visit. Deferred as a
poor trade, recorded here so it is not re-derived from scratch.

**What was NOT measured:** the warm service-worker path. These figures come from Playwright, which
blocks the SW, so they describe a first visit or the load after a version bump — the case that
matters most given release frequency, but not the steady state. A returning designer with a warm
cache is faster than 3.5 s by an amount nobody has measured.

## The four pages without preload hints — measured 26 Aug 2026

Asked for a latency review of the rest of the app. Measured every page's static graph, then the
runtime under 4× CPU / 40 ms RTT / 4 Mbps, then a controlled three-arm A/B against generated copies.

**The finding.** ES modules are discovered in a waterfall — parse a file, *then* fetch its imports —
and the Firebase SDK sits five levels down (`page → *-boot.js → *-app.js → … → firebase-client.js →
gstatic`). On the four pages that carried no `modulepreload` at all, the SDK did not start
downloading until:

| Page | SDK download begins |
|---|---|
| admin | 1 807 ms |
| operations | 1 563 ms |
| settings | 1 402 ms |
| overtime | 2 363 ms |

against **~85 ms** on index/paycalc/links. `preconnect` was already on all seven pages, so DNS and
TLS were warm — the connection was sitting idle waiting to be told what to ask for.

**The A/B (admin, three repeats each, ±20 ms reproducible):**

| Arm | SDK starts | DOMContentLoaded | Discovery rounds |
|---|---|---|---|
| unchanged | 1 807 ms | 14 290 ms | 10–11 |
| **3 gstatic tags only** | **86 ms** | **12 626 ms** | 10 |
| full local graph (44 tags) | 84 ms | 12 567 ms | 1 |

Two results, and the second is why v21.76 is three tags and not forty-four:

1. **DOMContentLoaded tracks the SDK one-for-one.** In every arm DCL landed within milliseconds of
   the SDK finishing, and the delta held identically at 1× and 4× CPU — so this is a discovery
   problem, not a compute one. (The ~12.5 s floor is the harness's stubbed SDK; it cancels between
   arms.)
2. **Preloading the local graph adds ~60 ms on top.** It collapses 10 discovery rounds to 1, which
   looks dramatic, but the last local module still landed at the same 2.6 s: the test server is
   HTTP/1.1, so the requests queue instead of waterfalling. Real Hosting is HTTP/2 and would do
   better than that by an amount **not measured here** — which is the point. Three fixed tags name
   one immutable URL each and cannot fall behind a graph; a local list is the hand-maintained cost
   the build-step threshold in CLAUDE.md is about. The measured evidence did not justify paying it.

**Also checked and already right:** every page preloads `inter-latin.woff2` with `font-display:
swap`, and every page preconnects to gstatic, Firestore, identitytoolkit and securetoken.

**Noted, not acted on:** `firebase-client.js` statically imports `summarisePerf` from
`perf-stats.js`, so all seven pages carry that module (~32 KB raw) for read-side code only the
Operations App Speed card runs. Splitting the write side out would save ~24 KB on six pages — real,
but SW-cached after the first visit, and small beside the 1.7 s above.

**Same caveat as the links section:** Playwright blocks the service worker, so these are first-visit
or post-version-bump numbers, not the steady state.
