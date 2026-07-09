# B3 strict cutover — HELD patch (do NOT apply before the window)

> ✅ **SHIPPED (v16.29, ~Jul 2026). Both cutovers are now LIVE — this file is a historical record.**
> B3 (strict override isolation — no-name escape removed) and H2 (linkDesigns write requires the
> `linksDesigner` claim) were both applied to `firestore.rules` and deployed via `deploy-rules.yml`
> after re-provision + the CLAIM_EPOCH=2 sweep, with the writeWithClaimRetry self-heal live on both the
> override paths and (v16.29) the links-app.js writes. The patches below are what was applied; the
> current live rules are in `firestore.rules` (see its header changelog). Rollback for either is
> instant (re-add the removed escape / restore `allow read, write: if request.auth != null;`).
> Nothing below still needs applying.

> ⚠️ **(Original HELD note, pre-cutover — kept for context.)** The strict rule below is written as
> fenced text on purpose — it was NOT in `firestore.rules` while held. Merging to `main`
> runs `deploy-rules.yml` and ships `firestore.rules` **live**, so the actual rule edit +
> test rework had to be applied on a **fresh branch cut at window time**, verified by the
> emulator suite gate, then merged during the chosen low-traffic window — never before.
>
> This artifact is the exact, line-verified companion to **SECURITY_RELEASE_PLAN.md → B3**
> (read that first for the full rationale, risk register, and the CLAIM_EPOCH sweep). It was
> verified against `firestore.rules` and `firestore.rules.test.mjs` as of v15.32.
>
> **Dry-run re-verified at v16.28:** Change 1 (rules) and Change 2 (test rework) still apply
> cleanly against the current files — the `overrides` create/update + delete blocks matched the
> diff exactly, only the `!('name' in token)` escape was removed (manager bypass retained). The
> full `npm run test:rules` emulator suite passed **186/186** with the strict block in place,
> including the flipped no-name create/delete DENIED tests and the field-validation block moved
> from `staffDb()` → `namedDb('G. Miller')`. So the code side of Step 3 is proven current; the
> only thing gating deployment is the owner's re-auth window (Steps 1–2). Nothing was committed
> to `firestore.rules` on a mergeable branch — the dry-run lived on a local throwaway branch.

## Pre-window checklist (must all hold before applying)

- [x] `CONFIG.CLAIM_EPOCH == 2` already (token sweep armed v15.33), `ENFORCE_NAMED_SESSION == true`, in-place login settled.
- [ ] **Step 1 — Re-provision:** Operations → Set up accounts (sets `admin`/`manager`/`name` on every account). Idempotent.
- [x] **Step 2 — Token sweep ✓ DONE (v15.33):** `CONFIG.CLAIM_EPOCH` is already `2`, so devices force-refresh once on open. Do NOT bump again unless deliberately forcing a fresh sweep. At window time, confirm active devices have re-opened since v15.33 and force-sign-out stragglers.
- [ ] `CONFIG.MANAGER_NAMES` matches current staff (a stale manager token has `name` but not `manager`).
- [ ] The write-side `writeWithClaimRetry` net is live (v15.18) — a manager who misses the sweep self-heals on first write. Still do the sweep.

Only after the sweep window: cut a fresh branch, apply the two changes below, let CI's `test:rules` gate pass, merge, verify live in a **private window** (never your installed phone).

> **Sibling in this same window:** the **`linksDesigner` claim cutover (H2)** — same shape (add claim →
> re-provision → refresh → tighten `linkDesigns` write rule), and it reuses Step 1 (re-provision) and the
> token sweep here. Full apply-ready patch at the **bottom of this file** ("Sibling cutover — `linksDesigner`
> claim"). Do it alongside, or standalone in its own smaller window — but never tighten its rule before the
> designers hold the claim.

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

---

# Sibling cutover — `linksDesigner` claim (review H2)

> ⚠️ **HELD, same as above.** Nothing here is live. The `linkDesigns` rule in `firestore.rules`
> is still `allow read, write: if request.auth != null;`. This is a **claim cutover with the same
> shape as the B3 override cutover** (add a claim → re-provision → refresh tokens → tighten the
> rule), so it should ride the **same window** and reuse the same re-provision + token-sweep steps.
> Verified against `firestore.rules` / `functions/index.js` / `admin-auth.js` / `firestore.rules.test.mjs`
> as of v16.03.
>
> **Dry-run re-verified at v16.28:** all four changes (A functions, B client, C rules, D tests)
> still apply cleanly. One reconciliation vs this doc: the suite now already HAS a `linkDesigns`
> describe block (added since v16.03), whose `auth can write` test asserted `staffDb()` succeeds —
> under the strict rule that must FLIP to `assertFails`, so the block was REWORKED (not added fresh):
> a `designerDb()` helper + the full matrix (designer ✓, admin ✓, plain-named ✗, name-less ✗, anon ✗,
> authed read ✓). Full `npm run test:rules` passed **188/188**. `node --check` + typecheck + the 123
> functions tests stayed green. The dry-run lived on a local throwaway branch — nothing committed to
> a mergeable branch. **Deploy order still stands:** A+B (claim) must ship + re-provision + S. Silva
> re-auth BEFORE C+D (rule tighten), because the Links save/delete are raw writes with no self-heal.

**Why:** `linkDesigns` writes are gated only by the client redirect (`links-app.js` bounces anyone
not in `CONFIG.LINKS_DESIGNERS`). The server accepts a write from **any** authenticated session. This
closes that gap with a dedicated `linksDesigner` custom claim.

**Blast radius is tiny and one-sided.** `G. Miller` is `admin`, and the tightened rule allows
`admin` too — so the admin is **never** write-blocked. The only account at risk is **`S. Silva`**
(designer, not admin), **writes only**, until re-provisioned + re-authed. Reads stay open for
everyone (design patterns are non-sensitive internal data; keeping read open also avoids locking out
a designer whose token hasn't refreshed).

**⚠️ No write-side self-heal here.** Unlike overrides (`writeWithClaimRetry`, which force-refreshes a
stale token on the first `permission-denied` and retries), the links design save/delete in
`links-app.js` are **raw** `setDoc`/`deleteDoc`. So a designer with a pre-cutover token will NOT
self-heal — **`S. Silva` must sign out and back in** after re-provisioning. (Optional hardening, do
this FIRST if you want the seamless path: wrap the links save/delete in `writeWithClaimRetry`, then a
stale designer token self-heals like the override path and the manual re-auth is unnecessary.)

## Sequence (safe order — claim before rule)

1. **Apply Changes A + B (functions + client), merge → `deploy-functions.yml`.** Safe on its own —
   adding a claim locks nobody out; the rule still allows any auth at this point.
2. **Re-provision:** Operations → Set up accounts. It now sends `designerMembers` and sets
   `linksDesigner: true` on `G. Miller` + `S. Silva`. Idempotent; this is the SAME run as the B3
   Step-1 re-provision.
3. **Refresh tokens:** `S. Silva` signs out and back in (raw writes = no self-heal). `G. Miller`
   unaffected. If riding the B3 window, the `CLAIM_EPOCH == 2` sweep refreshes tokens on app open —
   but still confirm `S. Silva` has re-opened since, because her *write* needs the fresh claim.
4. **Apply Changes C + D (rules + tests), merge → `deploy-rules.yml`** (the `test:rules` gate must
   pass first). Only after step 3 is confirmed.

## Change A — `functions/index.js` (setupRosterAuth: set the claim)

`linksDesigner` is **orthogonal** to the admin/manager tier (an admin can also be a designer), so it
is an additive claim, not part of the `if/else` tier.

```diff
         const managerMembers = Array.isArray(body.managerMembers) ? new Set(body.managerMembers) : new Set();
+        // designerMembers: names that should receive the linksDesigner:true claim (H2). Orthogonal to
+        // admin/manager — a designer may be ordinary staff (e.g. S. Silva) or also an admin (G. Miller).
+        const designerMembers = Array.isArray(body.designerMembers) ? new Set(body.designerMembers) : new Set();
```
```diff
                 const isAdmin   = adminMembers.has(name);
                 const isManager = !isAdmin && managerMembers.has(name);
+                const isDesigner = designerMembers.has(name); // additive — not part of the admin/manager tier
                 const claims = { name };
                 if (isAdmin)        claims.admin   = true;
                 else if (isManager) claims.manager = true;
+                if (isDesigner)     claims.linksDesigner = true;
```
Update the `tier` log line if you want it to reflect the designer flag (cosmetic).

## Change B — `admin-auth.js` (send the designer list)

```diff
                     members:        ACTIVE_MEMBERS,
                     adminMembers:   CONFIG.ADMIN_NAMES,
                     managerMembers: CONFIG.MANAGER_NAMES,
+                    designerMembers: CONFIG.LINKS_DESIGNERS,
```

## Change C — `firestore.rules` (gate WRITE on the claim; keep READ open)

```diff
     match /linkDesigns/{document=**} {
-      // Link design workspace data — read/write restricted to authenticated users.
-      // ... (B2 "deliberately left open" note) ...
-      allow read, write: if request.auth != null;
+      // Reads stay open (design patterns are non-sensitive internal data; keeping read open also
+      // avoids locking out a designer whose token hasn't refreshed yet).
+      allow read: if request.auth != null;
+      // Writes require the linksDesigner claim (or admin, who outranks). setupRosterAuth sets
+      // linksDesigner for CONFIG.LINKS_DESIGNERS. Closes H2 — the client redirect was the only
+      // control before. See B3_STRICT_CUTOVER.HELD.md → Sibling cutover.
+      allow write: if request.auth != null &&
+        (request.auth.token.linksDesigner == true || request.auth.token.admin == true);
     }
```

## Change D — `firestore.rules.test.mjs` (REQUIRED — the suite is the deploy gate)

Add a `designerDb()` helper (mirrors `adminDb()`), then a `linkDesigns` describe block. The current
suite has NO `linkDesigns` tests, so this is all-new.

```js
// with the other context helpers (near adminDb / managerDb):
function designerDb() { return testEnv.authenticatedContext('uid_designer', { name: 'S. Silva', linksDesigner: true }).firestore(); }

describe('linkDesigns — designer-write enforcement (H2)', () => {
    const DESIGN = () => ({ name: 'Line 1', patterns: {}, updatedAt: TS(), updatedBy: 'S. Silva' });
    test('any authenticated user can READ (reads stay open)', async () => {
        await assertSucceeds(getDoc(doc(staffDb(), 'linkDesigns', uid())));
    });
    test('a designer can WRITE', async () => {
        await assertSucceeds(setDoc(doc(designerDb(), 'linkDesigns', uid()), DESIGN()));
    });
    test('an admin can WRITE (admin outranks)', async () => {
        await assertSucceeds(setDoc(doc(adminDb(), 'linkDesigns', uid()), DESIGN()));
    });
    test('a plain authenticated user (name only, no designer/admin) CANNOT WRITE', async () => {
        await assertFails(setDoc(doc(namedDb('J. Davies'), 'linkDesigns', uid()), DESIGN()));
    });
    test('an anonymous session CANNOT WRITE', async () => {
        await assertFails(setDoc(doc(anonDb(), 'linkDesigns', uid()), DESIGN()));
    });
});
```
(`TS()` = whatever the suite uses for a server-timestamp placeholder in write payloads; match the
existing override tests. Values aren't shape-validated by the rule, so `DESIGN()` only needs to be a
non-empty map.)

## Post-deploy verification (owner, private window)

- Sign in as **S. Silva** (after re-provision + re-auth): open Links, edit a design, Save → succeeds.
- Sign in as an **ordinary staff member** (e.g. via console, since the UI redirects): a `setDoc` to
  `linkDesigns` → **denied**. Reads still succeed.
- **G. Miller** (admin): Links save → succeeds (unaffected throughout).

## Rollback

Revert the `linkDesigns` block to `allow read, write: if request.auth != null;` and redeploy
(instant). The `linksDesigner` claim is harmless to leave set. No data migration either way.
