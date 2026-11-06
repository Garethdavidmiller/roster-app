#!/usr/bin/env bash
# The apt libraries a Playwright browser needs, installed in bounded attempts. action.yml says why
# this exists and why it is shaped this way; this file is the shape.
#
#   1. The package list comes from Playwright itself (`install-deps --dry-run`), so its list stays
#      the authority. If that output ever changes shape, fall back to the plain command, bounded.
#      It HAS changed shape once (Playwright 1.63, 3 Nov 2026), and the fallback is what every WebKit
#      job then ran: it works, but under one clock with no resume, so a slow mirror killed two jobs
#      before a single test. `parse_dry_run` reads both shapes, and workflow-hygiene feeds it both.
#   2. `apt-get update` (first, since the dry run reads apt's lists), then a DOWNLOAD-ONLY
#      `apt-get install`, each as root under its OWN
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

# The package list out of Playwright's dry run, which has printed two shapes. Up to 1.56: the apt
# command it would run (…--no-install-recommends pkg pkg"). From 1.63: it SIMULATES the install and
# prints "Missing system dependencies (N):" with one package per indented line, or "All system
# dependencies are installed." Prints the list on one line, "-" when nothing is missing, and nothing
# at all for a shape it does not know. `install.sh --parse` runs only this, on stdin.
parse_dry_run() {
    local dry pkgs
    dry=$(cat)
    if grep -qx 'All system dependencies are installed\.' <<<"$dry"; then echo "-"; return; fi
    pkgs=$(sed -n 's/.*--no-install-recommends \([^"]*\)".*/\1/p' <<<"$dry" | head -n 1)
    [ -n "$pkgs" ] || pkgs=$(sed -n '/^Missing system dependencies/,$ s/^  *\([^ ][^ ]*\) *$/\1/p' <<<"$dry" | paste -sd' ' -)
    printf '%s\n' "$pkgs"
}
if [ "${1:-}" = "--parse" ]; then parse_dry_run; exit 0; fi

# A STALLED MIRROR IS LEFT BEHIND, ONCE (6 Nov 2026). GitHub's Ubuntu images read their mirrors through
# `mirror+file:/etc/apt/apt-mirrors.txt`: the Azure mirror at priority 1, archive.ubuntu.com at 2,
# security.ubuntu.com at 3. apt moves to the next mirror only on an ERROR, so a mirror that TRICKLES is
# never left: that day runners spent all three 90 s attempts at about 70 KB/s on the Azure mirror while
# a sibling job fetched the same 114 MB from it in 14 s, and #1697, #1699 and #1700 each lost a WebKit
# job that way, twice running on #1700's mobile-safari 3/4. So after a cut-off the mirror apt tries
# first is dropped from the list, once, and the next attempt fetches from the one after it — but only
# while a mirror serving the whole archive remains (the security mirror serves only its own pocket).
# apt reads the list afresh on each run, and resumes a partial file from whichever mirror it asks.
# Prints the mirror it left, or nothing. `install.sh --leave-mirror FILE` runs only this, on FILE.
leave_stalled_mirror() {
    local f=$1 first rest
    [ -r "$f" ] || return 0
    first=$(awk -F'\t' '/^[a-z]+:\/\// { p = 1e9; for (i = 2; i <= NF; i++) if ($i ~ /^priority:/) p = substr($i, 10) + 0
        if (best == "" || p < bp) { best = $1; bp = p } } END { print best }' "$f")
    [ -n "$first" ] || return 0
    rest=$(awk -F'\t' -v drop="$first" '$1 != drop' "$f")
    grep -E '^[a-z]+://' <<<"$rest" | grep -vq 'security\.ubuntu\.com' || return 0
    if [ -w "$f" ]; then printf '%s\n' "$rest" > "$f"; else printf '%s\n' "$rest" | asroot tee "$f" >/dev/null; fi
    printf '%s\n' "$first"
}
if [ "${1:-}" = "--leave-mirror" ]; then leave_stalled_mirror "${2:?a mirror list file}"; exit 0; fi

# apt gives a DEAD connection 120 s by default and never retries it. 30 s and three retries; a SLOW
# connection is the attempts' job below.
printf 'Acquire::Retries "3";\nAcquire::http::Timeout "30";\nAcquire::https::Timeout "30";\n' \
    | asroot tee /etc/apt/apt.conf.d/99-ci-mirror-timeouts >/dev/null

# ── Bounded attempts: the clock runs as root, around apt itself ──────────────────────────────────
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
        # the first cut-off of the job leaves that mirror behind (leave_stalled_mirror, above)
        if [ "$rc" = 124 ] && [ -z "${MIRROR_LEFT:-}" ]; then
            MIRROR_LEFT=$(leave_stalled_mirror /etc/apt/apt-mirrors.txt)
            [ -n "$MIRROR_LEFT" ] && echo "::notice title=$label::left the mirror $MIRROR_LEFT after it stalled; the next attempt fetches from the next mirror on the runner's list"
        fi
        sleep 3
    done
    echo "::error title=$label failed $ATTEMPTS times::the apt mirror did not deliver in $ATTEMPTS attempts of ${secs}s each. That is the runner's mirror, not this branch: re-run the job."
    return 1
}

# ── 1. Fresh package lists, then the package list from Playwright ────────────────────────────────
# The update comes FIRST since Playwright 1.63: its dry run simulates the install against apt's own
# lists, so it is only as good as they are.
attempt "apt-get update" "$UPDATE_SECONDS" apt-get -q update || exit 1
dry=$(npx playwright install-deps --dry-run "$BROWSER" 2>/dev/null || true)
pkgs=$(printf '%s\n' "$dry" | parse_dry_run)
if [ "$pkgs" = "-" ]; then echo "install-browser-deps: Playwright reports every $BROWSER library already installed"; exit 0; fi
if [ -z "$pkgs" ] || ! [[ "$pkgs" =~ ^[A-Za-z0-9.+\ -]+$ ]]; then
    echo "::warning title=install-browser-deps::could not read the package list from 'npx playwright install-deps --dry-run $BROWSER' (Playwright changed its output?). Falling back to the plain command, bounded."
    # As ROOT, so the clock can kill what it started: the plain command spawns `sudo apt-get` itself,
    # and a timeout begun by the runner's user could not reach that root apt (23 Oct). Run as root,
    # Playwright calls apt directly, inside the timed process group.
    if [ "$(id -u)" = "0" ]; then exec timeout -k 10 "$(( ATTEMPT_SECONDS * ATTEMPTS ))" npx playwright install-deps "$BROWSER"; fi
    exec sudo -n env "PATH=$PATH" timeout -k 10 "$(( ATTEMPT_SECONDS * ATTEMPTS ))" npx playwright install-deps "$BROWSER"
fi
echo "install-browser-deps: $(printf '%s\n' "$pkgs" | wc -w) packages for $BROWSER, from Playwright's own list"

# ── 2. The download, bounded ─────────────────────────────────────────────────────────────────────
# shellcheck disable=SC2086
attempt "download $BROWSER's libraries" "$ATTEMPT_SECONDS" apt-get -q -y --no-install-recommends --download-only install $pkgs || exit 1

# ── 3. Install from the local cache ──────────────────────────────────────────────────────────────
# Every .deb is already in /var/cache/apt/archives, so this fetches nothing — and it runs under no
# timeout of its own, so dpkg is never interrupted; the calling step's limit is the backstop.
# shellcheck disable=SC2086
asroot apt-get -q -y --no-install-recommends install $pkgs
