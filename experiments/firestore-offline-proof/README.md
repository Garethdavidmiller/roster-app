# Does the local Firestore cache serve reads that the rules would deny?

A one-off experiment, kept rather than thrown away. AUTH_PLAN.md §4 asked for it by name and called
it "an hour's work that decides whether E3 is shippable"; this is that hour, with its result.

**It is not a CI gate and must never become one.** It tests *Firestore*, not this app — wiring it
into `npm test` would mean failing our build when Google changes their SDK, which is not a signal
anyone here can act on. It is here so the next person who doubts the answer can re-run it in ten
minutes instead of re-deriving it, and — more importantly — so they do not repeat the two mistakes
that made the first two runs report the opposite of the truth. Both are written up below.

## The claim

Firestore security rules are evaluated **server-side**, so the persistent local cache serves reads
without consulting them. Two consequences, opposite in sign, both following from one mechanism:

- **Availability (E4).** An offline member whose access has lapsed still has the roster on the
  device. This is what makes E3 a design problem rather than a regression.
- **Security.** Tightening the `overrides` read rule does **not** stop a browser that already
  cached the data. This is why `calendar-overrides.js` carries its own gate (`setOverrideAccess`)
  instead of relying on the rule, and why `firestore.rules` says so in a warning block.

## Running it

```bash
# 1. The real production SDK, fetched once (the harness imports it from ./sdk/).
mkdir -p sdk && for f in firebase-app.js firebase-firestore.js; do
  curl -sS -o sdk/$f "https://www.gstatic.com/firebasejs/12.16.0/$f"; done
# The firestore bundle imports the app bundle by absolute gstatic URL — point it at the local copy,
# so the run needs no network at all:
sed -i 's#https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js#./firebase-app.js#g' \
  sdk/firebase-firestore.js

# 2. Emulator + a static server for the harness.
npx firebase emulators:start --only firestore --project myb-roster-offline-proof
npx http-server . -p 8099 -a 127.0.0.1 -s

# 3. The two experiments.
node run.mjs                                  # same browser session (page reload)
SETTLE_MS=4000 FLUSH_MS=2000 node restart.mjs  # full browser restart, profile reused
```

Keep the SDK version in step 1 in step with `firebase-client.js`, or the experiment stops being
about the code that ships.

## The two ways this measured the wrong thing

**1. A DENY that did not deny.** The first `DENY` ruleset kept a catch-all
`match /{document=**} { allow read: if true; }` below the tightened `overrides` rule. Firestore
**ORs** every matching allow, so the catch-all silently re-granted the read: the server was still
readable, and every "the cache still works" result underneath it was measuring a permissive
database. This is precisely the `allow read;` hold-line trap that the production rules carry a
warning block about — reproduced by accident, which is its own small confirmation that the hold
really does neutralise the rule beneath it. `run.mjs` now asserts the server read comes back
`permission-denied` **before** believing anything else, and aborts if it does not.

**2. Reading before the new client owned the cache.** The persistent cache is leased to one primary
client. Closing the browser does not always release that lease cleanly, so a freshly-started client
has to time the old one out before it will serve the cache — and until it does,
`getDocsFromCache` returns **zero documents with no error at all**. Measured here, the takeover
happens between **2 and 3 seconds**; at 2s the cache reads empty, at 3s it reads in full.

That produced a completely wrong interim conclusion — "the cache does not survive a browser
restart", which would have made E4 unbuildable — and the thing that caught it was reading
Firestore's own IndexedDB **directly**, bypassing the SDK: the documents were plainly on disk
(`remoteDocumentsV14` holding all five) while the SDK's own read returned nothing. `restart.mjs`
keeps both that raw-disk dump and a plain-IndexedDB control, because between them they separate the
three explanations — profile did not persist, data was never written, client had not taken over —
that a bare zero cannot.

## Results

Emulator, real SDK 12.16.0, headless Chromium, five `overrides` documents cached under permissive
rules and then read back under the post-step-4 rule (which nothing in the harness can satisfy).

| State | Read | Outcome |
|---|---|---|
| rules allow, online | server | 5 documents |
| rules **deny**, online | server | `permission-denied` ← the control |
| rules **deny**, online | explicit cache read | **5 documents** |
| rules **deny**, online | `onSnapshot` | cached snapshot first, **then** `permission-denied` |
| rules **deny**, online | cache after that denied listen | **5 documents — no eviction** |
| rules **deny**, Firestore network off | explicit cache read | **5 documents** |
| rules **deny**, Firestore network off | default-source read | 5 documents (falls back to cache) |
| rules **deny**, transport offline | explicit cache read | **5 documents** |
| rules **deny**, **browser restarted** | explicit cache read | **5 documents** |
| rules **deny**, **browser restarted** | single document by id | found |
| rules **deny**, **browser restarted**, offline | explicit cache read | **5 documents** |

**The claim holds, in every configuration tested.** Cached override data outlives a page reload, a
full browser restart, a rules tightening and the loss of the network, in any combination.

Three details worth carrying forward:

- **A denied listen does not evict the cache.** Worth stating because some stores drop cached
  results when a subscription is refused; this one does not. So closing the read rule protects the
  data on devices that have *not* seen it, and does nothing about devices that have.
- **A default-source read is not a cache read.** Online-but-denied, plain `getDocs` returns
  `permission-denied`; it only falls back to the cache when the client believes it is offline. Only
  an explicit cache read serves data while online. The app's two-phase load already relies on
  exactly this distinction.
- **A live listener shows the roster and then fails.** Under denied rules it emits the cached
  snapshot before erroring — so a member sees their shifts and the update quietly stops, which is
  the "wrong rather than obviously broken" failure RECOVERY_RUNBOOK.md warns about, and is what the
  sync chip's "Couldn't update" exists to surface.

## What this does not settle

Everything here runs against the **Firestore emulator**. The mechanism under test — rules on the
server, cache on the client — is the same one production uses, and the SDK is the production build
at the pinned version, but an emulator-specific difference cannot be excluded from these runs alone.
Treat the result as strong evidence rather than proof of production behaviour, and say so wherever
it is relied on.

The lease-takeover delay is also environment-sensitive: 2–3 seconds in a headless container says
little about a cold PWA launch on a station Android. If a design ever depends on the cache being
readable *immediately* at startup, measure it on a real device rather than inheriting the number
above.
