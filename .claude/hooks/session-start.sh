#!/bin/bash
# SessionStart hook — Claude Code on the web only.
# The remote container starts from a bare clone with no node_modules, which blocks
# ESLint, typecheck, the Playwright e2e/visual suites (and ad-hoc page screenshots),
# the Firebase rules/hosting emulators, and the functions tests. Installing here makes
# every npm script in CLAUDE.md runnable from the first turn.
set -euo pipefail

cd "$CLAUDE_PROJECT_DIR"

# ── THE PRE-COMMIT HOOK, INSTALLED (v22.48) ───────────────────────────────────────────────────
#
# This runs BEFORE the remote-only check below, deliberately: it is the one step that matters just
# as much on a local checkout. `githooks/pre-commit` is checked in and CLAUDE.md calls it the
# enforced development workflow, but git does not run a hook out of a tracked directory unless
# somebody sets `core.hooksPath` — and nothing did. Not CI, which installs no hooks; not the remote
# container, which starts from a bare clone every time.
#
# The cost of that was measured at v22.47: the documentation move broke the hook in four places and
# every commit for a whole release was made straight past it, because the only environment doing the
# committing had never installed it. The parity test now stops the paths rotting; this stops the
# hook being absent in the first place.
#
# Repo-local (`.git/config`), idempotent, reversible with `git config --unset core.hooksPath`, and
# it announces itself rather than changing a developer's setup in silence. It must never abort the
# session, hence the guard — a session that will not start is a worse outcome than an uninstalled
# hook.
if [ "$(git config core.hooksPath 2>/dev/null || true)" != "githooks" ]; then
  if git config core.hooksPath githooks 2>/dev/null; then
    echo "Installed the pre-commit hook (core.hooksPath=githooks). Undo: git config --unset core.hooksPath"
  else
    echo "WARNING: could not set core.hooksPath — commits will not run githooks/pre-commit." >&2
  fi
fi

# Local checkouts manage their own dependencies — only the DEPENDENCY install below is
# remote-only.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Root dev dependencies (eslint, typescript, @playwright/test, firebase-tools, http-server).
# npm install (not ci) so the cached container state makes re-runs near-instant.
# NOTE: Chromium is pre-installed at /opt/pw-browsers and the env sets
# PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 — never run "playwright install" here.
npm install --no-audit --no-fund

# Cloud Functions dev dependencies (npm run test:functions).
npm install --no-audit --no-fund --prefix functions
