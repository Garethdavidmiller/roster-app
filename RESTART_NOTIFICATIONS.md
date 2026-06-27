# Huddle Push Notifications — RE-ENABLED IN CODE (pending Functions deploy)

Notifications were paused on **16 June 2026**. At the time this was recorded as
"the staff GitHub Pages site was returning a 404." **That diagnosis was wrong.**

The real cause (found 27 June 2026): `STAFF_SITE_URL` in `functions/index.js` was set
to the bare origin `https://garethdavidmiller.github.io`, but the app is actually served
from the **`/roster-app` path** (`https://garethdavidmiller.github.io/roster-app/` — the
roster-app repo's own GitHub Pages site, built from `main`). The bare origin is a separate,
empty repo that 404s. So every notification tap navigated to that 404 page. The site itself
was never down.

**Fixed (27 June 2026):**
- `STAFF_SITE_URL` now includes the `/roster-app` path → taps land on the real app.
- `HUDDLE_PUSH_PAUSED` set back to `false`.

---

## ⚠️ This will NOT take effect until the Functions deploy succeeds

`deploy-functions.yml` is currently **failing**. The failure is NOT the service-account key
(Hosting deploys with the same key are green) — it is **missing IAM roles** on the service
account in `FIREBASE_SERVICE_ACCOUNT`. Grant these in Google Cloud Console → IAM for project
`myb-roster`, then re-run the workflow:

- `roles/cloudfunctions.admin`
- `roles/cloudbuild.builds.editor`
- `roles/artifactregistry.admin`
- `roles/iam.serviceAccountUser`
- `roles/storage.admin` (also fixes Circular/Newsletter uploads)

Until that deploy goes green, the old (paused, wrong-URL) function stays live in production.

---

## Verify after deploy

- [ ] `https://garethdavidmiller.github.io/roster-app/` loads past the splash to the calendar
      in a **fresh private browser window** (no cache, no service worker).
- [ ] `https://garethdavidmiller.github.io/roster-app/#huddle` opens the Huddle viewer directly.
- [ ] DevTools → Console shows no red errors (CSP, Firebase referrer block, missing module, 404).
- [ ] Upload a test Huddle via Operations → Huddle Upload, or check Firebase Console → Functions
      logs to confirm the next ingest logs `"Fan-out complete"` rather than
      `"HUDDLE_PUSH_PAUSED=true — skipping"`, and that a notification tap opens the app.

Once verified in production, **delete this file**.

---

## Context — defence-in-depth already in place (v12.81)

The service worker was hardened so that if the staff site ever returns a 404, the cached app
is served instead of GitHub's error page, then the Huddle viewer auto-opens. So even a wrong
or briefly-broken URL no longer strands staff on a 404 — but the right fix is still pointing
`STAFF_SITE_URL` at the real `/roster-app` path, which is now done.
