#!/usr/bin/env bash
# Behavioral suite for gsd-test-single-flight-guard.sh (bench-scoped conflicts). `ps` is faked.
#   bash gsd-core-hooks/hooks/gsd-test-single-flight-guard.test.sh
set -uo pipefail
cd "$(dirname "$0")" || exit 1
HOOK=$PWD/gsd-test-single-flight-guard.sh
D=$(mktemp -d); trap 'rm -rf "$D"' EXIT
mkdir -p "$D/bin" "$D/.config/gsd-test" "$D/repo"
git -C "$D/repo" init -q
GD=$(git -C "$D/repo" rev-parse --absolute-git-dir)
printf '[[benches]]\nname = "holodeck"\n[[benches]]\nname = "plex2"\n' > "$D/.config/gsd-test/config.toml"
printf '#!/usr/bin/env bash\ncat "$FAKE_PS"\n' > "$D/bin/ps"; chmod +x "$D/bin/ps"
N=0; F=0
pass() { N=$((N+1)); echo "PASS  $1"; }
fail() { N=$((N+1)); F=$((F+1)); echo "FAIL  $1 -> $2"; }
A=$(printf 'a%.0s' {1..40}); B=$(printf 'b%.0s' {1..40})
reset() { rm -rf "$GD/gsd-inflight"; mkdir -p "$GD/gsd-inflight"; : > "$D/ps.txt"; }
live() { # sha [extra args...] -- fake a live driver process + an EMPTY marker
  local sha="$1"; shift
  printf 'node /x/gsd-verify-and-record.cjs --head %s --base next %s\n' "$sha" "$*" >> "$D/ps.txt"
  : > "$GD/gsd-inflight/$sha"
}
run() { # command
  OUT=$( export HOME="$D" PATH="$D/bin:$PATH" FAKE_PS="$D/ps.txt"
         python3 -c 'import json,sys;print(json.dumps({"tool_input":{"command":sys.argv[1]},"cwd":sys.argv[2]}))' "$1" "$D/repo" | bash "$HOOK" )
}
denied() { printf '%s' "$OUT" | grep -Eq '"permissionDecision": *"deny"'; }
req() { echo "gsd-test --head $B --base next $*"; }

reset; live "$A" --bench holodeck; run "$(req --bench plex2)"
[ -z "$OUT" ] && pass "other sha on holodeck (empty marker), request plex2: allowed" || fail "disjoint" "$OUT"
reset; live "$A" --bench holodeck; run "$(req --bench holodeck)"
denied && pass "same bench holodeck: denied" || fail "same bench" "$OUT"
reset; live "$A"; run "$(req --bench plex2)"
denied && pass "in-flight process has no --bench (wildcard): denied" || fail "wildcard" "$OUT"
reset; live "$A" --bench=plex2,holodeck; run "$(req --bench holodeck)"
denied && pass "--bench=plex2,holodeck parsed: holodeck overlaps, denied" || fail "eq-comma" "$OUT"
reset; live "$A" --bench=holodeck; run "$(req --bench=plex2)"
[ -z "$OUT" ] && pass "--bench=holodeck vs request --bench=plex2: allowed" || fail "eq disjoint" "$OUT"
reset; live "$A" --bench holodeck --bench plex2; run "$(req --bench plex2)"
denied && pass "repeated --bench flags unioned: plex2 overlaps, denied" || fail "union" "$OUT"
reset; live "$B" --bench plex2; run "$(req --bench plex2)"
denied && pass "same sha double launch: denied" || fail "same sha" "$OUT"
reset; live "$B" --bench holodeck; run "$(req --bench plex2)"
denied && pass "same sha on a different bench: still denied" || fail "same sha other bench" "$OUT"
reset; run "$(req --bench plex2)"
[ -z "$OUT" ] && [ -f "$GD/gsd-inflight/$B" ] && pass "no in-flight run: allowed and marker written" || fail "idle" "$OUT"
reset; printf 'plex2\n' > "$GD/gsd-inflight/$A"; run "$(req --bench plex2)"
[ -z "$OUT" ] && [ ! -e "$GD/gsd-inflight/$A" ] && pass "dead marker pruned, launch allowed" || fail "dead" "$OUT"

echo "$((N-F))/$N passed"
[ "$F" -eq 0 ]
