## Summary

<!-- One or two sentences on what this changes and why. -->

## Test plan

<!-- What did you test, and how? -->

---

## Cloud-backed feature checklist

*Tick each item or mark N/A. Skip the whole block for documentation-only PRs.*

### Firestore / Storage
- [ ] New collection documented in `docs/DATA_MODEL.md` (fields, access rules, auto-prune if applicable)
- [ ] Security rules added/updated in `firestore.rules` and `storage.rules`
- [ ] Helper functions for new collection exported from `firebase-client.js` and listed in `AI_MAP.md`

### Service worker
- [ ] New JS modules added to both asset lists in `service-worker.js`, and to the `modulepreload` list of every page that imports them (`sw-asset-check.test.mjs` names a missing one)
- [ ] Runtime version updated with `npm run bump <version>` (2 runtime locations); `sw-asset-check.test.mjs` parity passes

### Error handling
- [ ] No new silent `catch(() => {})` — use `catch(e => console.warn(...))` for fire-and-forget paths
- [ ] `initErrorReporter()` called on any new page module — never bare: only once the page holds a signed-in identity (CLAUDE.md → `initErrorReporter()` call pattern)

### Tests
- [ ] `npm test` passes
- [ ] New logic has a unit test, or the gap is noted in `KNOWN_LIMITATIONS.md`

### Documentation
- [ ] A new module is listed in `docs/FILE_INDEX.md` and `docs/AI_MAP.md` (the pre-commit hook enforces both); an architecture decision is recorded in `CLAUDE.md`
- [ ] `AI_MAP.md` updated if any module's exports changed (pre-commit hook enforces this)
- [ ] `OPERATIONS_REFERENCE.md` updated if a new admin workflow was added
- [ ] All 5 doc version stamps current to the latest 0.10 milestone

### Deployment
- [ ] `firebase.json` CSP / cache rules checked if new asset types were added
- [ ] Live URL verified in a private browser window (not the installed PWA)
