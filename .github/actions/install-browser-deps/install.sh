#!/usr/bin/env bash
# The apt libraries a Playwright browser needs, installed in bounded attempts. action.yml says why
# this exists and why it is shaped this way; this file is the shape.
#
#   1. The package list comes from Playwright itself (`install-deps --dry-run`), so its list stays
#      the authority. If that output ever changes shape, fall back to the plain command, bounded.
#   2. `apt-get update`, then a DOWNLOAD-ONLY `apt-get install`, each as root under its OWN
#      `timeout`: root signals root, so a cut-off attempt leaves no apt behind holding the lock —
#      the failure the first retry (23 Oct 2026) died of. Only downloads are bounded, so no dpkg is
#      ever interrupted, and apt resumes the partial files on the next attempt.
#   3. The install itself runs from the local cache, with nothing left to fetch and nothing to stall.
set -uo pipefail

BROWSER="${BROWSER:?BROWSER is required (chromium or webkit)}"
ATTEMPTS="${ATTEMPTS:-3}"
ATTEMPT_SECONDS="${ATTEMPT_SECONDS:-90}"    # one download attempt
UPDATE_SECONDS="${UPDATE_SECONDS:-30}"      # one `apt-get update` attempt (1–7 s on a healthy mirror)

case "$BROWSER" in
    chromium|webkit) ;;
    *) echo "::error title=install-browser-deps::unknown browser '$BROWSER' (chromium or webkit)"; exit 2 ;;
esac

# Root already (a container, or a self-hosted runner) needs no sudo; a GitHub runner has it passwordless.
if [ "$(id -u)" = "0" ]; then asroot() { "$@"; }; else asroot() { sudo -n "$@"; }; fi

# ── 1. The package list, from Playwright ─────────────────────────────────────────────────────────
dry=$(npx playwright install-deps --dry-run "$BROWSER" 2>/dev/null || true)
pkgs=$(printf '%s\n' "$dry" | sed -n 's/.*--no-install-recommends \([^"]*\)".*/\1/p' | head -n 1)
if [ -z "$pkgs" ] || ! [[ "$pkgs" =~ ^[A-Za-z0-9.+\ -]+$ ]]; then
    echo "::warning title=install-browser-deps::could not read the package list from 'npx playwright install-deps --dry-run $BROWSER' (Playwright changed its output?). Falling back to the plain command, bounded."
    # As ROOT, so the clock can kill what it started: the plain command spawns `sudo apt-get` itself,
    # and a timeout begun by the runner's user could not reach that root apt (23 Oct). Run as root,
    # Playwright calls apt directly, inside the timed process group.
    if [ "$(id -u)" = "0" ]; then exec timeout -k 10 "$(( ATTEMPT_SECONDS * ATTEMPTS ))" npx playwright install-deps "$BROWSER"; fi
    exec sudo -n env "PATH=$PATH" timeout -k 10 "$(( ATTEMPT_SECONDS * ATTEMPTS ))" npx playwright install-deps "$BROWSER"
fi
echo "install-browser-deps: $(printf '%s\n' "$pkgs" | wc -w) packages for $BROWSER, from Playwright's own list"

# apt gives a DEAD connection 120 s by default and never retries it. 30 s and three retries; a SLOW
# connection is the attempts' job below.
printf 'Acquire::Retries "3";\nAcquire::http::Timeout "30";\nAcquire::https::Timeout "30";\n' \
    | asroot tee /etc/apt/apt.conf.d/99-ci-mirror-timeouts >/dev/null

# ── 2. Bounded attempts: the clock runs as root, around apt itself ───────────────────────────────
# attempt <label> <seconds> <command...>: up to $ATTEMPTS tries, each cut off at <seconds>. Exit 124
# is the cut-off. Nothing is deleted between tries: apt keeps and resumes partial downloads.
attempt() {
    local label=$1 secs=$2 i start rc why
    shift 2
    for (( i = 1; i <= ATTEMPTS; i++ )); do
        start=$(date +%s)
        asroot timeout -k 5 "$secs" "$@" && { echo "$label: done on attempt $i in $(( $(date +%s) - start ))s"; return 0; }
        rc=$?
        why="exit $rc after $(( $(date +%s) - start ))s"
        [ "$rc" = 124 ] && why="cut off at ${secs}s — the mirror stalled"
        echo "::warning title=$label: attempt $i of $ATTEMPTS failed::$why. Partial downloads are kept and resume on the next attempt."
        sleep 3
    done
    echo "::error title=$label failed $ATTEMPTS times::the apt mirror did not deliver in $ATTEMPTS attempts of ${secs}s each. That is the runner's mirror, not this branch: re-run the job."
    return 1
}

# shellcheck disable=SC2086  # $pkgs is a validated, space-separated list — splitting is the point
attempt "apt-get update" "$UPDATE_SECONDS" apt-get -q update || exit 1
# shellcheck disable=SC2086
attempt "download $BROWSER's libraries" "$ATTEMPT_SECONDS" apt-get -q -y --no-install-recommends --download-only install $pkgs || exit 1

# ── 3. Install from the local cache ──────────────────────────────────────────────────────────────
# Every .deb is already in /var/cache/apt/archives, so this fetches nothing — and it runs under no
# timeout of its own, so dpkg is never interrupted; the calling step's limit is the backstop.
# shellcheck disable=SC2086
asroot apt-get -q -y --no-install-recommends install $pkgs
