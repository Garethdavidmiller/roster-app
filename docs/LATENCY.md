# LATENCY.md — sign-in and Calendar start

*Not version-stamped; not a runtime asset. Renamed from `LATENCY_PLAN.md`. It holds the
measurements and the decision rules, kept for whoever reopens the question. Condensed on
25 Nov 2026: each reading keeps its figures and its verdict; the narrative around them is in git
(`git log -p -- docs/LATENCY.md`, full text at `28b217d0`). The headings are cited by name from code
and other documents, so keep them.*

**CLOSED 19 Sep 2026 — nothing open but one reading.** It began as four phases to do in measured
order, and the measuring ended it: Phase 1 shipped; Phase 2 closed on its own decision rule; Phase 3
was priced at 4.6–52 ms against a wall of over a second and **declined**; Phase 4's trigger never
fired. The wall is the one `accounts:lookup` round trip every boot makes, and what is left to
`Recognised` is recorded as the **price of the security model** — a cost that was chosen, not a
problem nobody solved. **Do not go looking for a Phase 5 to make the plan feel finished**: twice,
measuring first stopped confident work worth five milliseconds. And **a shipped change is not a
measured one**.

**The one reading left:** Signing in on the December card (THE NOVEMBER READ, last section).

**After the close, and none of it reopens the file:** the fast path was RETIRED (owner, 26 Sep —
THE CLOSING READ; `DECISIONS.md` → "The provisional paint"); the member's own stored roster, painted
before the grant, shipped on 5 Oct (`CALENDAR_DATA.md` 17); the App Speed card was trimmed and its
timings changed on 25 Oct (THE CARD WAS TRIMMED), so every reading here before November was taken
on an instrument that no longer exists; and the 14 Nov read closed the October check (THE NOVEMBER
READ).

Design detail lives beside the code — `perf-reporter.js` and `perf-stats.js` for what is measured,
`CALENDAR_DATA.md` for the invariants any change here must not break. This file holds the readings
and the decision rules.

## A SECOND cost, and this plan was structurally blind to it (v22.90)

Everything else here measures ONE page load; nothing counted how many loads a member is made to do.
A version bump renamed the SW cache and `controllerchange` reloaded the Calendar 500 ms later, with
no prompt — a second full boot, `accounts:lookup` included. At 62 releases in the 14 days to 5 Sep
2026 (17 on the busiest day), with `registration.update()` running hourly and on every return to
visible, a member met it regularly. **v22.90 holds the reload until the page is hidden**
(`deferWhileVisible`, Calendar only — the pages that ask first do so because of unsaved work). The
update still lands, so only its timing moved. `readyUpdate` (v22.92) counts the opens that followed
a release, stamped by the device it happened to, because the analytics hold counters and no device
identity. It measured about one open in seven (THE FULL-MONTH READ, item 5 — an undercount, per THE
CARD WAS TRIMMED). It does not touch the identity decision.

## What was already good, and why the obvious answers were refused

Already in place: SW caching, the SDK cache, `modulepreload` on the heaviest pages, 60-day sessions,
in-place sign-in, `primeAuth`, the Firestore local cache and the cache-before-server Calendar read.
The remaining gains need the critical path to CHANGE, not to be tuned. Refused outright:

| Refused | Why |
|---|---|
| **Render the base roster instantly, correct it when Firestore answers** | Override-unknown is not override-absent. It would look fast and reintroduce the exact defect `calendar-data-state.js` exists to prevent. **Latency must not buy a false roster.** Not the same question as painting CACHED overrides before the account is confirmed; neither may be cited to settle the other |
| **Extend the session past 60 days** | It reduces how OFTEN latency is felt without improving it, and lengthens the life of a stale local session |

## Phase 1 — SHIPPED (v21.29–v21.30)

One shared Firebase auth bootstrap (the Calendar's worst-case access decision went from two stacked
ceilings, 6.5 s + 6 s, to one 6.5 s budget); `markPageReady` means a real roster grid, not the
"Checking this month…" state; the local cache wins the first paint (a bounded 90 ms IndexedDB read);
and the start ladder — Recognised · Unlocked · Shifts shown · Confirmed (off the card since 25 Oct
2026). **The ladder is what made the rest decidable rather than arguable.**

## The decision rule — read this before starting phase 2 or 3

*The ladder this rule reads left the card on 25 Oct 2026; a reopened question rebuilds it first.*
The milestones nest, so the biggest gap between adjacent rows names the phase. Compare rows; do not
do arithmetic. **Wait for a full month** (`THIN_SAMPLE` governs every row), and remember a member
who never passes the gate contributes no `Confirmed`.

| The gap is between | What is slow | Do |
|---|---|---|
| page start → **Recognised** | restoring the saved sign-in | ~~Phase 3~~ — **measured and declined**; the gap is one auth round trip (left struck through because the rule was FOLLOWED) |
| Recognised → **Unlocked** | the access decision itself | re-read `calendar-access.js` |
| Unlocked → **Shifts shown** | reaching a roster at all | **Phase 2** |
| Shifts shown → **Confirmed** | the authoritative Firestore read | **Phase 2**, its member/month narrowing especially |

## First reading — 22 Aug 2026 (owner screenshots of the live card; PROVISIONAL, month incomplete)

Boot stages exonerate the code: Waking up 9% over ½ s · Loading code 11% · Getting ready 0%. The
ladder (Calendar, 1,619 opens, % over 1 s): Recognised **56%** (the wall) · Unlocked 62% · Shifts
shown 71% · Confirmed 100%. Verdict: Phase 3 first, Phase 2 second. **The restore tail and the
"asked for my password every time" complaints (Aug 2026) are very likely one phenomenon**: a restore
slow enough to blow the 6.5 s access budget put the sign-in card up until
`watchForLateNamedIdentity` withdrew it — routine, not an edge case.

## Confirmation read — 30 Aug 2026 (owner screenshot; the month effectively complete)

2,226 opens; the verdict unchanged on twice the sample: Recognised **52%** · Unlocked 58% · Shifts
shown 75% · Confirmed 100%, and all three boot stages inside ½ s on ~90% of opens — yet **21% of
opens took over three seconds to become usable**. The code is ready and the page is not. Two cautions
that still apply to any dimension: the connection split reads the PLATFORM as much as the network
(Safari reports no connection class, so "not reported" is largely iOS); and the installed app read
slower than a tab, most likely a population effect (an installed app restores a session; a tab was
disproportionately a PIN unlock) — **do not act on that row**.

## THE FIELD READ — 5 September 2026

The identity round trip is confirmed on live staff devices (~476 opens): `Recognised` moves with the
connection group (~60% on 4G-like, ~43% not reported) while **Getting ready is 0% over ½ s in every
group** — the signature this plan nominated. About eighteen points appear after the member is
identified (Recognised 60% → Shifts shown 78%), which is why `rosterCached` was added (v22.95). And
the app had not recently got slower: Usable within a second went 32% → 35%.

## THE FULL-MONTH READ — 12 September 2026

1,285 opens; boot stages still exonerating (Getting ready 0%).

1. **VAL-AUTH-006 is CLOSED.** Recognised over 1 s: 91% 3G-like (22) · 68% 4G-like (644) · 48% not
   reported (584), with Getting ready 0% in all three. The flat row disposes of the platform confound.
2. **`rosterCached` answers the eighteen points: it is STORAGE, not the gate** — Unlocked 62% → Roster
   found 77% → Shifts shown 78%. (Different populations; read the shape, not a subtraction.)
3. **Phase 2 stays closed** — 1,270 opens from the saved copy against 21 from the server (98.4%).
4. **The service worker is NOT what staff are waiting for** — a full sweep ran on 78% of opens, and
   Worker busy read 78% over 1 s against Shifts shown's 78%. (The worker no longer re-fetches a file
   it holds since the Oct 2026 production review.)
5. **Releases interrupt 14% of opens** (176 of 1,285) — on the Calendar a load running while HIDDEN.
6. **The fast path's verdict was withheld**: the aggregate could not tell "rarely fires" from "fires
   and buys nothing", so `readyProvisional` (v23.70) was built to count how often it took, with the
   reading rule fixed before the number arrived.

## THE CLOSING READ — 19 September 2026. The fast path RARELY FIRES, and this file is DONE

2,161 opens: **"Opens that did not wait for the sign-in check — 1"**, of roughly 800 eligible (only
devices at v23.70 or later could report it; 1-in-2,161 would claim a precision the instrument lacks).
Row one of the pre-registered table: the September reading was diluted, **the identity finding
stands**, and `VAL-AUTH-006` is not reopened. Every other row re-confirmed: Getting ready 0% (2,213);
Worker busy 76% against Shifts shown 77%; Recognised 73% 4G · 88% 3G · 47% not reported; 98.7% of
grids from the cache; 14% of opens after a release. The red headline (Usable 34% under a second, 22%
over three) is the ladder's last rung, not the app being slow.

**CORRECTION, 26 Sep 2026 (external review) — a MECHANICAL reason, measured.** The Firestore SDK holds
every operation, cache reads included, until Firebase Auth has initialised, and for a stored user
initialisation IS the `accounts:lookup` round trip (real SDK, lookup delayed 2 s: the cache read
settled at ~2,011 ms; at ~7 ms with Auth absent). So the provisional paint could only rarely beat the
confirmation, whatever its eligibility, and no reordering of the Calendar's own reads can step round
the lookup. The diagnosis is unchanged.

**The close.** No further Calendar start-up change — not a refusal-reason counter (the forbidden
Phase 5: widening eligibility is an ACCESS decision, `CALENDAR_DATA.md` 13), not a preload, split or
retune. **The owner decided on 26 Sep 2026 to RETIRE the fast path**: it buys ~nothing and had just
shipped two defects. A named boot waits for the lookup again, as before v22.97. The other option, an
app-owned snapshot of the member's own roster that does not queue behind Auth (with a second door to
keep per member, cleared on sign-out and never read under a viewer), was then built as well on
5 Oct 2026 (`CALENDAR_DATA.md` 17, `calendar-snapshot.js`). Record: `DECISIONS.md` → "The provisional
paint".

## THE SEPTEMBER MONTH-END READ — 3 October 2026. Nothing reopens; one thing to watch

3,448 Calendar opens re-confirm every verdict: Usable 32% within 1 s, 23% over 3 s; Getting ready 1%;
Recognised 63% (78% 4G · 90% 3G · 51% not reported, Getting ready 0% in each); 99.0% of grids from
the cache; Worker busy 78% against Shifts shown 78%; 14% of opens after a release. The one thing to
watch — versions v24.29–v24.40 reading ~31% over 1 s against ~19% for v24.17–v24.28 — was suspected
to be the release pace, not a regression (small rows; a version live for a day carries far more
reload opens), and was closed as exactly that in THE NOVEMBER READ.

## THE CARD WAS TRIMMED, AND THE TIMINGS CHANGED — 25 October 2026 (v24.98)

A review of the App Speed card (owner request) found time in its figures that was nobody waiting.
**From v24.98 a sample is time somebody spent waiting** (`perf-reporter.js`): a load nobody watched
records nothing (the hidden release reload was about one Calendar open in seven); typing is not load
time (a sign-in has its own figure); the wait after a release is timed from the member coming back;
and `Usable` is stamped after the frame that shows the page. **So figures from v24.98 read faster for
reasons that are measurement, not the app**, and **the "14% of opens follow a release" readings above
were an undercount**. The "By app version" rows those reads called "whole load" were code loading
(`domReady`); the card's version split now runs on Usable.

The boot stages, the start ladder, the saved-copy/server split, the fast-path row and the worker's
file count left the card, writes and all; the connection class is still on every sample's key.
Months up to October 2026 still hold their samples, unread. **A reopened question rebuilds its
instrument, writes and card block in one release** — the decision and its trigger are in
`DECISIONS.md`.

## THE NOVEMBER READ — 14 November 2026 (half a month). The October check closes; nothing reopens

The first read wholly on the trimmed card; it cannot be set beside September's. First appears and
Code loaded: 80% and 79% under 1 s. Usable, all pages: 41% under 1 s, 12% over 3 s (the Calendar is
1,233 of 1,567 opens; the wall is still `accounts:lookup`). Own roster over 1 s: 22% (`CALENDAR_DATA.md`
17). After a release, until usable, over 1 s: 10%. Installed app 69% against a tab's 89% over 1 s.
Signing in: 8% under 1 s · 64% 1–3 s · 28% over 3 s, on 25 sign-ins.

### The October check, closed: it was the release pace

No November version stayed live a week (99 versions in 14 days). Code loaded, the measure that raised
it, read 21% over 1 s — back near the ~19% band now release reloads are not counted. Usable by version
(33 rows, v25.00–v26.08) shows no step that stays. What cannot be shown — whether v24.29–v24.40 cost
anything on the Usable timing — is recorded rather than worked round.

### Signing in: red, and two of its waits were the app's own

Few sign-ins happen (60-day sessions), so each is four points of the figure. Two waits were the app's:
a first password attempt that could not succeed when the typed surname differed from the stored
default (**v26.12 tries the default first**, `AUTH_AND_SESSIONS.md` → "The gated dual-attempt"); and the Calendar's reload
after a sign-in, which repeated the lookup (**gone from v26.40** for a sign-in on a Calendar not yet
granted — the in-place grant in `calendar-access.js`). The December card is the first to include it,
and **it counts fewer sign-ins, not at random**: a sample is kept only when the page stayed on screen
from the moment it LOADED (`_watched`, `perf-reporter.js`), so a member who switched apps to find their
password gives none. Compare December's count with November's before its colour (review, 20 Nov 2026).

**Read Signing in again on the December card**, the first full month with v26.12.

## Phase 2 — CLOSED on its own decision rule (5 Sep 2026)

**Trigger:** the gap at Unlocked → Shifts shown, or Shifts shown → Confirmed. The first authoritative
read asks for every member's overrides across three months; a member wants one person's month. The
narrowing, in order: the displayed month first, adjacent months in the background, then selected
member + displayed month on the existing `memberName` + `date` index, whole-team data only for Team
View. **Constraints it must keep:** the first grid may not be presented as current until its own
overrides are authoritative (`CALENDAR_DATA.md` 1, 2, 6) — narrowing what is FETCHED is legitimate,
narrowing what is KNOWN is not; and **Team View is the trap**: its fetcher was unified at v18.76
because a second authoritative reconciler evicted overrides the first had loaded.

**Closed** because the rule fired clearly: 454 attributed starts came from the saved copy and 8 from
the server (98.3%; 98.4% on 2.8× the sample on 12 Sep). Narrowing the authoritative read cannot move
a cache-served first paint, so it would be a rewrite carrying the Team View trap for 1.7% of opens.
Read early, defensibly: the rule keys on the server arm's SHARE, which a month more would have to
change twentyfold. **It reopens if that share moves** (a storage-eviction change, a large intake of new
devices) — and the reading left the card on 25 Oct 2026, so it is rebuilt first. The other half of the
reading: 78% of cache-served starts still took over a second, waiting for permission, not data.

## Phase 3 — split Firebase Auth from Firestore

**Trigger:** the gap before Recognised. It fired twice; **the proof was run and the answer is no — do
not do this as a latency fix** (30 Aug 2026, `experiments/auth-firestore-split-proof/`):

| CPU throttle | today (app+firestore+auth) | split (app+auth) | saving |
|---|---|---|---|
| 1× | 38.3 ms | 33.7 ms | **4.6 ms** |
| 4× | 132.9 ms | 119.0 ms | **13.9 ms** |
| 6× | 229.0 ms | 176.8 ms | **52.2 ms** |

The whole auth boot is 229 ms at 6× against a wall of over a second, and
`initializeFirestore(persistentLocalCache)` costs 0.4 ms (the cache opens lazily). **The split may
still be worth doing on architectural grounds; it may not be sold as the treatment for this ladder.**
The shape, if it is ever done: `firebase-app` · `firebase-auth-client` · `firebase-firestore-client`,
`session.js` on auth only, proved on ONE page first. **Cost side, measured:** the Calendar's critical
path is ~782 KB of unminified JS across 40 modules plus ~214 KB of render-blocking CSS, and under 6×
CPU throttling `myb-sdk-ready` takes 682 ms — an input to CLAUDE.md → *When a build step earns its
keep*, not by itself a trigger.

## What the wall actually is — ONE auth round trip (measured 30 Aug 2026)

> **Every boot makes exactly one auth request — `POST /identitytoolkit.googleapis.com/v1/accounts:lookup`
> — and `Recognised` waits for it.**

It is not conditional on the ID token having expired: Firebase validates the stored user against the
server before emitting it, which is how a deleted or disabled account stops being restored. +300 ms
injected into that call moved `authBootstrap` +335.7 ms. On a real mobile connection that round trip
**is** the wall, and no arrangement of the module graph shortens it. **When offline, Firebase emits the
stored user anyway** (31 Aug 2026), so an offline device already trusts the stored identity.

### THE ANSWER — 5 September 2026, and what shipped (v22.97)

**The owner's ruling: a returning member may see their own already authorised cached roster while the
lookup completes** — a named member with a live local session, never the shared PIN viewer. It shipped
narrower than the ruling: Team View and a stored selection naming a colleague were refused, because
both would have painted a colleague's base roster with their leave and absence silently missing. It was
measured worth almost nothing (THE CLOSING READ) and retired on 26 Sep 2026. Stopping the wait
altogether is a **security trade, not a performance tweak** — `calendar-access.js` decides what a viewer
may SEE from the restored identity — so it belongs to `CALENDAR_DATA.md` (13, retired; 17, its
replacement) and `AUTH_AND_SESSIONS.md` 17, not to this file.

## Two things this plan is NOT going to do, and why (v22.28)

Both fail the plan's own test: *would the number change a decision that is open?*

- **Percentiles (median / P75 / P95) — NO.** Samples are counts in five coarse bands (`PERF_BUCKETS`),
  the median falls inside the two-second-wide 1–3 s band, and interpolating assumes a distribution
  load times do not have. Finer bands are a write-side change that breaks the series. And the bucket
  edges already answer every threshold-shaped question here exactly.
- **Cold/warm start classification — NO.** It was mostly present already (`mode` is on every sample),
  and a further dimension thins rows that already sit near `THIN_SAMPLE`.

## Phase 4 — only if the measurement still says so

Reducing the Calendar's `modulepreload` graph, and the bundler question, which has its home and
trigger in `DECISIONS.md` → "No build step". Execution measured at ~18 ms: there is no general
too-much-JavaScript problem. Its trigger never fired.

## How it closed

The rule, written before the readings: the plan closes when the identity decision is taken AND the
Phase 2 reading is acted on, either way — and if both are "no build", it closes as a success, with the
second to `Recognised` recorded as the price of the security model. Both happened by 19 Sep 2026.

## Links workspace — measured 24 Aug 2026

On a throttled phone (4× CPU, 40 ms RTT, 4 Mbps): 46 modules (~1.1 MB), grid visible ~3.5 s, 8–9
discovery rounds, transfer ≈ 2.2 s. **Shipped (v21.75): `modulepreload`**, CI-checked against the real
graph — discovery down to 1–2 rounds, ~100 ms off DOMContentLoaded. **Not shipped: lazy-loading the
interaction-only modules** — most of the first 122 KB estimate is on the boot path, and the deferrable
~53 KB (`links-import.js`, `links-adjacency.js`, ~100 ms cold only) would make `checkImport()` async on
a trust boundary whose design is "refuse rather than half-load". A poor trade. Playwright blocks the
service worker, so these are first-visit figures.

## The four pages without preload hints — measured 26 Aug 2026

The Firebase SDK sits five module levels down, and on admin, operations, settings and overtime (no
`modulepreload`) it did not start downloading until 1.4–2.4 s, against ~85 ms elsewhere. An A/B on
admin: three gstatic preload tags brought the SDK start to 86 ms and DOMContentLoaded down by ~1.7 s;
preloading the whole local graph (44 tags) added only ~60 ms more on the HTTP/1.1 test server.
**So v21.76 is three fixed tags, not forty-four** — they name immutable URLs and cannot fall behind a
graph, and the local list is exactly the hand-maintained cost the build-step threshold is about. Every
page already preloads the font and preconnects to gstatic, Firestore, identitytoolkit and securetoken.
Noted, not acted on: `perf-stats.js` reaches every page through `analytics-client.js` for read-side
code only Operations runs (~24 KB on six pages, SW-cached after the first visit).
