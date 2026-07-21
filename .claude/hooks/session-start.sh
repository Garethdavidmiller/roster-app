#!/bin/bash
# SessionStart hook — Claude Code on the web only.
# The remote container starts from a bare clone with no node_modules, which blocks
# ESLint, typecheck, the Playwright e2e/visual suites (and ad-hoc page screenshots),
# the Firebase rules/hosting emulators, and the functions tests. Installing here makes
# every npm script in CLAUDE.md runnable from the first turn.
set -euo pipefail

# Local checkouts manage their own dependencies — only run in the remote environment.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Root dev dependencies (eslint, typescript, @playwright/test, firebase-tools, http-server).
# npm install (not ci) so the cached container state makes re-runs near-instant.
# NOTE: Chromium is pre-installed at /opt/pw-browsers and the env sets
# PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 — never run "playwright install" here.
npm install --no-audit --no-fund

# Cloud Functions dev dependencies (npm run test:functions).
npm install --no-audit --no-fund --prefix functions
