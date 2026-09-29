#!/usr/bin/env bash
# Test double for `gh`, shared by pr-claim-verifier.test.sh and gsd-merge-authority-guard.test.sh.
# Driven by env: FAKE_PR_JSON (file), FAKE_BEHIND (int), FAKE_REPO, FAKE_GH_FAIL=1.
[ "${FAKE_GH_FAIL:-0}" = 1 ] && { echo "gh: simulated failure" >&2; exit 1; }
case "$1 $2" in
  "pr view") cat "$FAKE_PR_JSON" ;;
  "repo set-default") echo "${FAKE_REPO:-owner/repo}" ;;
  "api "*)
    case "$2" in
      *compare*) echo "{\"behind_by\": ${FAKE_BEHIND:-0}}" ;;
      *rules/branches*) echo "[]" ;;
      *) exit 1 ;;
    esac ;;
  *) exit 1 ;;
esac
