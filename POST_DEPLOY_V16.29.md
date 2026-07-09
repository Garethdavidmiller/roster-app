# v16.29 security cutover — post-deploy verification checklist

One-time checklist for the **B3 strict override isolation** + **H2 linkDesigns write
enforcement** cutover (both shipped at v16.29). This is the "did production actually end up
in the right state?" companion to the code changes — the Rules being correct in the repo is
necessary but not sufficient; the live Firebase project (deployed function + provisioned
claims + refreshed tokens) must also be right. Full rationale/runbook:
`SECURITY_RELEASE_PLAN.md` and `B3_STRICT_CUTOVER.HELD.md` (historical record).

> **Why this matters:** `writeWithClaimRetry` self-heals a stale token only when the claim
> **already exists server-side**. It cannot help if `setupRosterAuth` has not yet SET the claim.
> So the deploy order is load-bearing: function first → re-provision → then the strict Rule.

## Deploy prerequisites (do in this order)

- [ ] The updated `setupRosterAuth` Cloud Function is deployed (it sets `linksDesigner` from
      `CONFIG.LINKS_DESIGNERS`, alongside `admin`/`manager`/`name`).
- [ ] **Set up accounts** (Operations → Staff Login Accounts) was run **after** that function
      deploy — so the accounts actually carry the current claims.
- [ ] `G. Miller` and `S. Silva` (the current `CONFIG.LINKS_DESIGNERS`) have `linksDesigner: true`.
- [ ] Managers have `manager: true`; admins have `admin: true`.
- [ ] The `test:rules` emulator suite passed in CI **before** the strict Rules deploy
      (`deploy-rules.yml` gates on it).
- [ ] Rules deployed (`deploy-rules.yml` green) — strict overrides + `linkDesigns` write gate live.

## Token refresh

- [ ] The `CLAIM_EPOCH == 2` sweep has propagated (devices force-refresh on next app open) and/or
      stragglers self-heal on first write via `writeWithClaimRetry`. No mass sign-out is required.
      (A 30+-day-dormant user is re-prompted to sign in — the login mints a fresh token, so they are
      the safest case, not a risk.)

## Live verification (private window — NOT your installed phone)

Override isolation (B3):
- [ ] A normal member can write **their own** override (AL / absence / shift). ✅ succeeds
- [ ] A normal member cannot write **another member's** override. ✅ denied
- [ ] A **manager** can write/delete **another member's** override (on-behalf). ✅ succeeds
- [ ] An **admin** can write others' overrides; a **roster upload** saves. ✅ succeeds

Links designer enforcement (H2):
- [ ] A **designer** (`S. Silva`, after re-provision) can create / rename / save / delete a Link
      design. ✅ succeeds (a pre-cutover token self-heals on the first write — no manual sign-out)
- [ ] A **non-designer** signed-in member cannot write `linkDesigns`. ✅ denied
      (they cannot reach it via the UI either — the `links-app.js` redirect — but the server now
      enforces it independently). Reads still succeed.
- [ ] `G. Miller` (admin) can save a Link design throughout (admin outranks). ✅ succeeds

## Rollback (either is instant, no data migration)

- **B3:** re-add the `!('name' in request.auth.token)` line to the `overrides` create/update AND
  delete blocks, redeploy rules.
- **H2:** restore `allow read, write: if request.auth != null;` on the `linkDesigns` block,
  redeploy rules.

## Do NOT

- Do **not** bump `CONFIG.CLAIM_EPOCH` casually — each bump forces **every** device to re-refresh
  its token on next open. It is `2` and should stay `2` unless a future claim change genuinely needs
  a fresh sweep.
- Do **not** re-apply the B3 or H2 patches — they are already live. Treat
  `B3_STRICT_CUTOVER.HELD.md` as a historical record, not a to-do.
