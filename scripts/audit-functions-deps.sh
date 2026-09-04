#!/usr/bin/env bash
#
# Audit the Cloud Functions' PRODUCTION dependencies, and — the whole point of this file —
# distinguish "npm audit found a high-severity advisory" from "npm audit could not run at all".
#
# `npm audit` exits non-zero for BOTH, so `npm audit --audit-level=high` cannot tell them apart.
# On 4 Sep 2026 npm's audit endpoint returned 503 for about twenty minutes: the deploy job spent
# seven of them retrying, exited 1, and the Functions deploy was SKIPPED with nothing whatsoever
# wrong with the code. An unknown had been laundered into a finding.
#
# The verdict therefore comes from the REPORT, not the exit code. A real report always carries
# `metadata.vulnerabilities`; the failure shape is `{"message": ..., "error": {...}}` and does not.
#
# WHAT AN UNKNOWN MEANS DEPENDS ON WHO IS ASKING, which is why it is a parameter and not a
# constant, and why both callers set it explicitly:
#
#   AUDIT_UNKNOWN_IS_FAILURE=1  the WEEKLY monitor (functions-audit.yml). Its entire job is to
#                               check once a week; a week where it silently did not run must not
#                               look like a clean week. Fail, and say plainly that it did not run.
#   AUDIT_UNKNOWN_IS_FAILURE=0  the DEPLOY gate (deploy-functions.yml). Blocking a release on npm's
#                               uptime — including an emergency fix — costs more than it buys, and
#                               dependencies only move when functions/package-lock.json does, so a
#                               skipped audit on a release that changed no dependency adds no
#                               exposure. Warn loudly; the next deploy and the Monday run re-check.
#
# In BOTH cases the message says the check DID NOT RUN, so a red job is never mistaken for a
# finding, and a green one never implies the dependencies were cleared.
#
# A genuine high or critical advisory fails in both roles. That is not configurable.

set -uo pipefail

if [ -z "${AUDIT_UNKNOWN_IS_FAILURE:-}" ]; then
    echo "::error::audit-functions-deps.sh: AUDIT_UNKNOWN_IS_FAILURE must be set to 0 or 1 by the caller." >&2
    echo "  A default here would silently pick a policy for a caller that never considered it." >&2
    exit 2
fi

cd "$(dirname "$0")/../functions" || { echo "::error::cannot enter functions/" >&2; exit 2; }

report=$(npm audit --omit=dev --json 2>/dev/null || true)

if [ -z "$report" ] || ! printf '%s' "$report" | jq -e 'has("metadata")' >/dev/null 2>&1; then
    reason=$(printf '%s' "$report" | jq -r '.message // .error.detail // .error.summary // empty' 2>/dev/null)
    [ -n "$reason" ] || reason='npm audit produced no usable report'
    detail="${reason} — the production dependencies were NOT checked."
    if [ "$AUDIT_UNKNOWN_IS_FAILURE" = "1" ]; then
        echo "::error title=Dependency audit did NOT run::${detail} This is the weekly check, so it has not happened this week — re-run it once npm is reachable."
        exit 1
    fi
    echo "::warning title=Dependency audit did NOT run::${detail} The deploy continued. Dependencies are unchanged unless functions/package-lock.json moved in this release; the next deploy and the weekly audit re-check."
    exit 0
fi

crit=$(printf '%s' "$report" | jq -r '.metadata.vulnerabilities.critical // 0')
high=$(printf '%s' "$report" | jq -r '.metadata.vulnerabilities.high // 0')
echo "audit ran — critical=${crit} high=${high}"

if [ "$crit" -gt 0 ] || [ "$high" -gt 0 ]; then
    printf '%s' "$report" \
        | jq -r '.vulnerabilities // {} | to_entries[]
                 | select(.value.severity == "high" or .value.severity == "critical")
                 | "  \(.value.severity)\t\(.key)"' 2>/dev/null || true
    echo "::error title=High-severity dependency vulnerability::npm audit found ${crit} critical and ${high} high advisories in the Cloud Functions' production dependencies."
    exit 1
fi
