# Does the Calendar viewer really die with the browser session?

It did not — one ordinary page reload was enough to make it permanent. Found during the Aug 2026
sign-in/calendar latency review, by reading `authReady` line by line; fixed in `firebase-client.js`
in the same release. Kept, like `firestore-offline-proof/`, so the answer can be re-run in minutes
rather than re-derived — and because the defect is invisible to every other test this repo has: unit
tests mock the SDK, the e2e suite stubs it, and only a real browser that genuinely EXITS between two
sessions can observe where an identity is persisted.

**Not a CI gate, and it must never become one** — it tests the Firebase SDK's storage behaviour in a
real Chromium, which is not a signal this repo's build should fail on.

## The claim under test

`calendar-access.js` signs the shared staff viewer in under `browserSessionPersistence`, "so it dies
with the browser session — which is the entire reason a shared office PC is safe to unlock". The
assumption everywhere downstream is that the ONLY way that changes is a member sign-in, which runs
through `shedCalendarViewer` (sign the viewer out first, then restore the member chain).

The assumption missed a third party: **boot itself**. `authReady` in `firebase-client.js` runs the
member persistence chain — `setPersistence(auth, indexedDBLocalPersistence)` — at module init on
EVERY page load, and the SDK's `setPersistence` MIGRATES the current user between stores
(`AuthImpl.setPersistence`: get current user → remove from old store → write into new). So the first
reload of an unlocked Calendar lifted the viewer out of sessionStorage into IndexedDB, where it
survives the browser closing. The next person at the PC got the roster without the PIN.

## Running it

```bash
# 1. The real production SDK, fetched once (the harness imports it from ./sdk/).
mkdir -p sdk && for f in firebase-app.js firebase-auth.js; do
  curl -sS -o sdk/$f "https://www.gstatic.com/firebasejs/12.16.0/$f"; done
sed -i 's#https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js#./firebase-app.js#g' \
  sdk/firebase-auth.js

# 2. Auth emulator (this directory's firebase.json declares it) + a static server.
npx firebase emulators:start --only auth --project viewer-proof
npx http-server . -p 8099 -a 127.0.0.1 -s

# 3. Both arms. Each runs a control (unlock → close browser) and a test
#    (unlock → ONE reload → close browser), then reopens the same profile.
BOOT=appBoot   node run.mjs   # the pre-fix boot shape
BOOT=fixedBoot node run.mjs   # the shipped fix
```

Keep the SDK version in step 1 in step with `firebase-client.js`.

## Results (Chromium, SDK 12.16.0, Auth emulator, persistent profile)

| Arm | After unlock | After one reload | After browser restart |
|---|---|---|---|
| pre-fix, control (no reload) | viewer in `sessionStorage` | — | signed out ✓ |
| **pre-fix, test (one reload)** | viewer in `sessionStorage` | **moved into IndexedDB** | **still signed in ✗** |
| fixed, control | viewer in `sessionStorage` | — | signed out ✓ |
| fixed, test | viewer in `sessionStorage` | back in `sessionStorage` | signed out ✓ |

The storage dumps are the load-bearing part: in the pre-fix test arm, `sessionStorage` is EMPTY
after the reload and `firebaseLocalStorageDb` holds the auth user — the migration is visible in the
bytes, not inferred from behaviour.

## The fix, and its self-healing property

`authReady` now resolves the restored user FIRST — free, because `setPersistence` already queues
behind the SDK's initialization and that initialization IS the restore — and only then chooses:
the shared viewer (`isViewerUser`, the same predicate `session.js` imports) re-asserts session-only
persistence; everyone else gets the member chain exactly as before.

Re-asserting is a no-op when the viewer is already in sessionStorage — and a **migration back out of
IndexedDB** when it is not. That second case is the office PCs the old behaviour already leaked
into: on their next page load the viewer moves back to sessionStorage, and dies at the next browser
close. No manual cleanup, no token revocation sweep.

`shedCalendarViewer` (the member-sign-in transition) is untouched and still the only path that swaps
a viewer for a member.

## What this does not settle

The emulator stands in for the Auth backend, but the property under test — which STORE holds the
persisted user — is client-side SDK behaviour and does not touch the wire after sign-in. The
harness's `fixedBoot` mirrors `firebase-client.js`'s `authReady` rather than importing it (that
module pulls the whole SDK graph); if the boot chain changes shape, update the mirror or the run
answers a stale question. `calendar-viewer-parity.test.mjs` carries a static contract pointing here.
