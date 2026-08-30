# Would splitting Firebase Auth from Firestore make a saved sign-in arrive sooner?

**No — and the measurement says what the real cause is instead.** Run before doing the work, which is
the point: `LATENCY_PLAN.md` Phase 3 proposed the split, its trigger had fired on two independent
readings, and its own caution said the split "may not buy the whole 52 points; the prove-it-on-one-page
step exists precisely to find out". This is that step, done as an experiment rather than as a
refactor of `firebase-client.js` — the module every page in the app imports.

**Not a CI gate, and it must never become one.** It measures the Firebase SDK's boot behaviour in a
real Chromium; that is not a signal this repo's build should fail on.

## The claim under test

The Calendar's start ladder puts 52% of `page start → Recognised` over one second — three times its
nearest rival, on 1,072 opens (`LATENCY_PLAN.md`, confirmation read 30 Aug 2026). `Recognised` is
`authBootstrap` resolving: Firebase Auth restoring a saved session, no typing.

Phase 3's reasoning was that `firebase-client.js` statically imports app, auth **and** Firestore, so
somebody who only needs an identity still pulls the database SDK — 705 kB against auth's 155 kB —
into the module graph ahead of it. And `initializeFirestore(persistentLocalCache)` runs in that
module body *before* `getAuth`, opening IndexedDB, which is the same store the auth restore reads
from. Bytes and contention, both plausible.

## Method

Two arms, differing in exactly one thing — whether the page's module graph contains Firestore.
Everything else (the calls, their order, the persistence ladder) mirrors `firebase-client.js`'s
module body and `authBootstrap`, and lives in one shared `arm.js` so the arms cannot drift.

Each arm signs in once, then measures N cold reloads *restoring* that session — the population the
ladder's `Recognised` rung actually measures. The number is `performance.now()` when `authBootstrap`
would resolve, i.e. from navigation start.

The SDK is served **locally**. That is deliberate and it is the conservative direction: it prices
parse, execute and IndexedDB contention while excluding the CDN fetch, and real devices serve the
SDK from the service worker's own cache (`myb-roster-sdk-v…`, cache-first since v16.10), which is
much closer to this than to a cold CDN. If the split is not worth doing on these numbers, adding
network back only argues the bytes half, which nobody disputes.

## Result — the split is worth 5–52 ms of a >1,000 ms problem

`authBootstrap` resolved, median of 7 reloads:

| CPU throttle | today (app+firestore+auth) | split (app+auth) | saving |
|---|---|---|---|
| 1× (desktop) | 38.3 ms | 33.7 ms | **4.6 ms** |
| 4× | 132.9 ms | 119.0 ms | **13.9 ms** |
| 6× | 229.0 ms | 176.8 ms | **52.2 ms** |

The saving is real and it scales with a slower CPU, which is what you would expect of a parse cost.
It is also the wrong order of magnitude. **The entire auth boot — everything Phase 3 could possibly
affect — is 229 ms on a 6×-throttled device.** The wall is over 1,000 ms on 52% of loads.

`initializeFirestore(persistentLocalCache)` itself costs **0.4 ms** synchronously: the cache is
opened lazily, so the IndexedDB-contention half of the theory is not happening at all.

## What it localised instead — one network round trip, unconditionally

Because the local cost is so small, the missing ~800 ms has to be network. It is, and it is a single
call:

> **Every boot makes exactly one auth request — `POST /identitytoolkit.googleapis.com/v1/accounts:lookup`
> — and `Recognised` waits for it.**

Counted directly (`arm-today.html`, one reload, one request). It is **not** conditional on the ID
token having expired: these reloads were seconds apart with a fresh token, and the call happened
anyway. Firebase validates the stored user against the server before emitting it, which is a
correctness feature — it is how a deleted or disabled account stops being restored.

Injecting latency into that one call moves the milestone almost exactly one-for-one:

| auth latency injected | `authBootstrap` resolved | split saving |
|---|---|---|
| 0 ms | 38.3 ms | 4.6 ms |
| 300 ms | **374.0 ms** | 22.5 ms |

+335.7 ms of milestone for +300 ms of latency. On a real mobile connection that round trip is the
wall, and no arrangement of the module graph shortens it.

## What follows

**Do not do Phase 3 as a latency fix.** The split may still be worth doing on architectural grounds —
a smaller graph for pages that only authenticate is a real thing — but it must not be sold as the
treatment for this ladder, and it should not be prioritised as one.

**The treatment is a design question with a security dimension, which is why this file stops here.**
Taking the round trip off the critical path means painting from the locally-stored identity before
the server has confirmed it — and `calendar-access.js` decides what a viewer may SEE from that
identity. An account disabled since the last load would be trusted for the length of one paint. That
is a trade for `CALENDAR_DATA.md` and `AUTH_AND_SESSIONS.md` to price, not a performance tweak.

## Running it

```bash
# 1. The real production SDK, fetched once (the harness imports it from ./sdk/).
mkdir -p sdk
for m in app auth firestore; do
  curl -sSL "https://www.gstatic.com/firebasejs/12.16.0/firebase-$m.js" -o "sdk/firebase-$m.js"
done
# The vendored auth/firestore bundles import firebase-app from the CDN by absolute URL; point them
# at their local sibling, or the page half-loads and nothing says why.
sed -i 's#from"https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js"#from"./firebase-app.js"#g' \
  sdk/firebase-auth.js sdk/firebase-firestore.js

# 2. Serve the harness and the Auth emulator.
npx http-server -p 8098 -s . &
npx firebase emulators:start --only auth --project split-proof &

# 3. Measure. RUNS, CPU and NET are all env vars.
node run.mjs                 # warm desktop
CPU=6 node run.mjs           # a mid-range Android
NET=300 node run.mjs         # 300 ms on every auth request
```

## Two ways this could have measured the wrong thing

- **A profile reused between runs caches the SDK and the sign-in**, so the second arm looks faster
  for a reason that has nothing to do with its graph. Every arm gets a fresh profile, deleted
  afterwards. (The first debugging pass hit exactly this from the opposite direction: a stale
  profile held a failed CDN fetch and the harness would not boot at all.)
- **Measuring a boot with nothing to restore.** A first emission of `null` resolves immediately and
  would report a beautiful number about nothing. Each run asserts `restored` and throws otherwise.
