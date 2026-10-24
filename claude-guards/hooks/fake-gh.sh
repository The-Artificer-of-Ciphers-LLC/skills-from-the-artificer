#!/usr/bin/env bash
# Test double for `gh`, shared by pr-claim-verifier.test.sh and gsd-merge-authority-guard.test.sh.
# Driven by env: FAKE_PR_JSON (file), FAKE_BEHIND (int), FAKE_REPO, FAKE_GH_FAIL=1,
# FAKE_QUEUE=1 (active merge_queue rule on the base branch), FAKE_RULES_FAIL=1 (rules endpoint errors).
[ "${FAKE_GH_FAIL:-0}" = 1 ] && { echo "gh: simulated failure" >&2; exit 1; }
case "$1 $2" in
  "pr view") cat "$FAKE_PR_JSON" ;;
  "repo set-default") echo "${FAKE_REPO:-owner/repo}" ;;
  "api "*)
    case "$2" in
      *compare*) echo "{\"behind_by\": ${FAKE_BEHIND:-0}}" ;;
      *rules/branches*)
        [ "${FAKE_RULES_FAIL:-0}" = 1 ] && { echo "gh: rules unavailable" >&2; exit 1; }
        if [ "${FAKE_QUEUE:-0}" = 1 ]; then echo '[{"type":"merge_queue","parameters":{"merge_method":"SQUASH"}}]'; else echo "[]"; fi ;;
      *) exit 1 ;;
    esac ;;
  *) exit 1 ;;
esac
