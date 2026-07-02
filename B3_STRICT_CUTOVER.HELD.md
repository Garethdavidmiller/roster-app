# B3 strict cutover — HELD patch (do NOT apply before the window)

> ⚠️ **HELD. Nothing in this file is live.** The strict rule below is written as fenced
> text on purpose — it is NOT in `firestore.rules`, so it is not deployed. Merging to `main`
> runs `deploy-rules.yml` and ships `firestore.rules` **live**, so the actual rule edit +
> test rework must be applied on a **fresh branch cut at window time**, verified by the
> emulator suite gate, then merged during the chosen low-traffic window — never before.
>
> This artifact is the exact, line-verified companion to **SECURITY_RELEASE_PLAN.md → B3**
> (read that first for the full rationale, risk register, and the CLAIM_EPOCH sweep). It was
> verified against `firestore.rules` and `firestore.rules.test.mjs` as of v15.32.

## Pre-window checklist (must all hold before applying)

- [ ] `CONFIG.CLAIM_EPOCH == 0` currently, `ENFORCE_NAMED_SESSION == true`, in-place login settled.
- [ ] **Step 1 — Re-provision:** Operations → Set up accounts (sets `admin`/`manager`/`name` on every account). Idempotent.
- [ ] **Step 2 — Token sweep:** bump `CONFIG.CLAIM_EPOCH` `0 → 2`, deploy **hosting only** (a separate deploy from the rules). Wait a few days so active devices re-open and force-refresh once; force-sign-out stragglers.
- [ ] `CONFIG.MANAGER_NAMES` matches current staff (a stale manager token has `name` but not `manager`).
- [ ] The write-side `writeWithClaimRetry` net is live (v15.18) — a manager who misses the sweep self-heals on first write. Still do the sweep.

Only after the sweep window: cut a fresh branch, apply the two changes below, let CI's `test:rules` gate pass, merge, verify live in a **private window** (never your installed phone).

---

## Change 1 — `firestore.rules` (drop ONLY the no-name escape; KEEP manager)

Verified against the current `overrides` blocks. The `manager` bypass stays (managers write on-behalf daily); only `!('name' in request.auth.token)` is removed, from BOTH the create/update block and the delete block.

**create/update block:**
```diff
         (
           request.auth.token.name == request.resource.data.memberName ||
           request.auth.token.admin == true ||
-          request.auth.token.manager == true ||
-          !('name' in request.auth.token)
+          request.auth.token.manager == true
         );
```

**delete block:**
```diff
       allow delete: if request.auth != null && (
         request.auth.token.name == resource.data.memberName ||
         request.auth.token.admin == true ||
-        request.auth.token.manager == true ||
-        !('name' in request.auth.token)
+        request.auth.token.manager == true
       );
```

(Each hunk removes the `!('name' …)` line and the now-trailing `||` on the `manager` line — `manager` is retained, not removed.)

---

## Change 2 — `firestore.rules.test.mjs` (REQUIRED — the suite is the deploy gate)

Under strict, an authenticated context with **no `name` claim** (`staffDb()`) can no longer create/delete an override. Two edits:

### 2a. In the main `describe('overrides', …)` field-validation block ONLY — swap `staffDb()` → `namedDb('G. Miller')`

Every field-validation test in that block writes/deletes a `VALID_OVERRIDE()` whose `memberName` is `'G. Miller'`, using `staffDb()`. Under strict those all get DENIED by isolation, so:
- the `assertSucceeds` field tests break, and
- the `assertFails` field tests would pass for the **wrong reason** (isolation denial, not the field rule), masking a real regression.

Fix: within that describe block, replace `staffDb()` with `namedDb('G. Miller')` so isolation always passes and the field rule is what's under test. **Leave the `anonDb()` tests (anon read allowed, anon create denied) unchanged** — reads stay open and anon-denied is still correct under strict. Do NOT globally sed the file; scope the replace to that block.

### 2b. In the isolation block — flip the no-name escape and add a delete mirror

Rename `describe('overrides — B2 per-member isolation (permissive)', …)` → `'overrides — per-member isolation (STRICT, B3)'`, then:

Replace the permissive-escape CREATE test:
```js
    // BEFORE (permissive):
    test('a name-less (legacy) session is still permitted — permissive escape, removed in B3', async () => {
        await assertSucceeds(setDoc(doc(staffDb(), 'overrides', uid()), OWN('G. Miller')));
    });
    // AFTER (strict):
    test('a name-less (legacy) session is DENIED create (permissive escape removed)', async () => {
        await assertFails(setDoc(doc(staffDb(), 'overrides', uid()), OWN('G. Miller')));
    });
```

Add a delete mirror (the current suite has no no-name delete test, so strict needs one):
```js
    test('a name-less (legacy) session is DENIED delete (permissive escape removed)', async () => {
        const id = uid();
        await setDoc(doc(adminDb(), 'overrides', id), OWN('G. Miller'));
        await assertFails(deleteDoc(doc(staffDb(), 'overrides', id)));
    });
```

The block's other tests already assert the strict matrix and need no change: named-writes-own ✓, named-cannot-write-another ✗, admin/manager on-behalf ✓ (create + delete), named delete own ✓, named cannot delete another ✗.

---

## Post-deploy verification (owner, private window)

- staff writes own AL/absence ✓; staff cannot edit/delete another's ✗
- manager edits AND deletes another's ✓; manager still blocked from huddle/circular/newsletter/roster/auth ✗
- admin edits others' ✓; roster upload saves ✓

## Rollback

Re-add the two `!('name' in …)` escape lines to both blocks and redeploy (instant), or revert `overrides` to `request.auth != null`. No data migration either way.
