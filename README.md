# Marylebone Roster

A staff roster app for Chiltern Railways' Marylebone station: shifts, annual leave, overtime
availability, a pay estimator, and the daily operational documents. It is an offline-first
Progressive Web App — **vanilla JavaScript with no framework and no build step** — served as static
files, with Firebase (Auth, Firestore, Storage, Cloud Functions) behind it.

There is no `dist/`, no bundler and no transpile step: what is in the repository is what runs in the
browser. That is a deliberate trade, and the conditions under which it would be revisited are
written down in `CLAUDE.md` → "When a build step earns its keep".

## Reviewing this repository without installing anything

**The test suite runs on nothing but a Node binary.** From a bare checkout or an unzipped archive,
with no `node_modules` anywhere:

```
npm test                        # the default suite: hygiene + parse + unit
node scripts/test-nodeps.mjs    # every suite that needs no install, and it prints how many
```

Both print their own totals, so this page does not restate a number that would go stale. The second
command also names the suites it is skipping and why. Neither needs npm to have installed anything;
`node scripts/test-nodeps.mjs` does not need npm at all.

This is worth saying plainly because external reviewers have repeatedly reported the estate as
unverified after an install failed in their sandbox. Almost none of it depends on an install.

### What genuinely needs an install, and what each lane buys

| Lane | Command | Needs |
|---|---|---|
| Cloud Functions handlers | `npm run test:functions` | `cd functions && npm ci` — these `require()` the real Firebase Admin SDK, and the roster-geometry suite drives the real PDF parser |
| Security rules | `npm run test:rules` | the Firebase emulator binary, plus a root `npm ci` |
| Lint, typecheck, browser tests | `npm run lint` · `npm run typecheck` · `npm run test:e2e` | a root `npm ci` |

With a root install, `npm run check` is the full pre-push gate: lint, typecheck, then `npm test`.

### Do not substitute `npx tsc`

`npm run typecheck` runs the TypeScript version this project pins, against `jsconfig.json`. If that
compiler is not installed the command now **refuses and says so** rather than reaching for `npx`.

That refusal replaced a fallback, because the fallback was actively misleading: on a tree with no
`node_modules` it resolved an unpinned compiler and reported missing-module errors for
devDependencies that were never installed. Those look like application defects in a report and are
not. A reviewer was right to discount them; the repository should not have produced them.

What the typecheck actually covers — and the two areas `jsconfig.json` deliberately excludes — is
recorded, with the measurements behind that decision, in `typecheck-scope.test.mjs`.

### There are no secrets in this tree

The repository is public and holds no credentials. Deploys authenticate through Workload Identity
Federation rather than a stored key; the Firebase API key is referrer-restricted; the shared
Calendar PIN lives only in Secret Manager, and `calendar-viewer-parity.test.mjs` fails the build if
it ever appears in the source, tests or documentation.

## Where to read next

| Document | What it is |
|---|---|
| `docs/ARCHITECTURE.md` | **the index** — which document is authoritative for each subject, and where what is deployed differs from what is documented. Start here |
| `CLAUDE.md` | the working manual: file tree, architecture decisions, data model, conventions |
| `docs/AI_MAP.md` | every module and its exports |
| `docs/OPERATIONS_REFERENCE.md` | how the app is run day to day |
| `docs/KNOWN_LIMITATIONS.md` | what is wrong or deferred, and why |
| `docs/RECOVERY_RUNBOOK.md` | backup, rollback and incident playbooks |

Feature behaviour is stated as numbered invariants in `docs/CALENDAR_DATA.md`, `docs/AUTH_AND_SESSIONS.md`,
`docs/OVERTIME_AVAILABILITY.md` and the rule files under `.claude/rules/`. Design reasoning lives in each
module's own header, next to the code it constrains, rather than being copied into these documents.
