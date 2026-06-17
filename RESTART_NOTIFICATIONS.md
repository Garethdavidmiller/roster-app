# Huddle Push Notifications — PAUSED

Notifications were paused on **16 June 2026** because the staff GitHub Pages site
(`garethdavidmiller.github.io`) was returning a 404, so every notification tap
landed staff on GitHub's error page instead of the Huddle viewer.

**Paused in:** `functions/index.js` — `const HUDDLE_PUSH_PAUSED = true`

---

## Before re-enabling — check these first

- [ ] `https://garethdavidmiller.github.io` loads past the splash to the calendar in a **fresh private browser window** (no cache, no service worker). This is the URL every notification tap goes to.
- [ ] `https://garethdavidmiller.github.io/#huddle` opens the Huddle viewer directly.
- [ ] DevTools → Console on the above shows no red errors (CSP failure, Firebase referrer block, missing module, 404).

If GitHub Pages is still broken, fix the deployment before re-enabling — see the deployment health check section in `CLAUDE.md` for the full diagnosis checklist.

---

## To re-enable

1. In `functions/index.js`, change line:
   ```js
   const HUDDLE_PUSH_PAUSED = true;
   ```
   to:
   ```js
   const HUDDLE_PUSH_PAUSED = false;
   ```

2. Commit and push to `main` — the `deploy-functions.yml` GitHub Actions workflow deploys the Cloud Function automatically on push to main.

3. Verify by uploading a test Huddle via Operations → Roster Upload (or check Firebase Console → Functions logs to confirm the next Power Automate ingest logs `"Fan-out complete"` rather than `"HUDDLE_PUSH_PAUSED=true — skipping"`).

4. Delete this file.

---

## Context — what was also fixed while notifications were paused (v12.81)

The service worker was hardened so that if the staff site ever returns a 404 again,
the cached app is served instead of GitHub's error page. So a notification tap
to a broken-but-cached site now loads the app and auto-opens the Huddle viewer.
This is a defence-in-depth measure — the right fix is still keeping the staff site
up, but it won't strand staff on a 404 page if there is a brief outage.
