---
name: ios-simulator-boot-health
description: Diagnose and handle iOS simulator boot failures on the shared Mac when running scripts/test-ios.sh - "PosterBoard status -5", exit 77 (no healthy simulator), settle-gate REJECT, a shard that ran no tests. Use before re-running, erasing or shutting down any simulator, and when judging whether a test run actually passed.
---

# iOS simulator boot health (shared Mac)

This Mac is shared with other sessions. Only two simulators are ours: **iPhone 17** (`85330DFD-25C3-402F-A529-36CA09154BC1`) and **iPhone 18 Pro Max** (`5CEF7C7B-7E33-40F7-B5D8-4736CD14222F`). iPhone 18 Pro and iPhone 17e belong to another session; iPhone Air is avoided. Rotate between ours per run (memory `rotate-ios-simulators`).

## What the failure is

`PosterBoard status -5` in `<results>-diag/settle.txt` is the wrapper reading `launchctl list` column 2 for `com.apple.PosterBoard` inside the simulator (`scripts/lib/ios-diag.sh`, `coincert_diag_settle_sample`). Negative status = killed by that signal; -5 = SIGTRAP. It is a real crash, not an over-strict check: macOS wrote `PosterBoard-*.ips` for it (6 reports 10-25..10-26, 5 in `+[NSURL(PosterFoundation) pf_posterPathInstanceURLForVersionsURL:version:]`, an assert while ingesting a poster version at first boot). On 2026-11-27 a second Mac hit the same SIGTRAP (`EXC_BREAKPOINT` in `pf_posterPathInstanceURLForVersionsURL:version:].cold.1`) at first boot on two different iPhone simulators, so it is not specific to one machine. No jetsam, memory or disk signal. Cause is unconfirmed (stale poster store is likely, unverified). Full evidence: `references/posterboard-research.md`.

## Run it this way

```
COINCERT_SIM_PINNED_ERASE=1 COINCERT_SIM_UDID=<ours> COINCERT_SIM_NAME=<name> \
COINCERT_DERIVED_DATA=/private/tmp/claude-501/derived-X scripts/test-ios.sh ...
```

- Optional for pinned runs: `COINCERT_SIM_NO_RECREATE=1` forbids the delete + create path in `ios-repair.sh`; a device rejected again after a recent erase is left as it is, so the pin stays valid. Local runs do not set it, so local behavior is unchanged.
- The remote runner (`scripts/remote-ios-tests.sh`, runs on a remote Mac) launches iOS runs with `COINCERT_SIM_PINNED_ERASE=1` and `COINCERT_SIM_NO_RECREATE=1`: a pinned simulator that fails the boot health/settle check is erased (that UDID only) and booted once more; it is never deleted or recreated, so the runner's fixed UDID rotation stays valid.
- One `test-ios.sh` at a time; never edit source while one builds.
- With `COINCERT_SIM_PINNED_ERASE=1` a pinned device gets **two** boot attempts (`coincert_sim_try_budget`): reject -> scoped `simctl erase <that UDID>` -> one retry. Without it a pinned device gets one attempt and is not erased.
- On a rejection the diag folder now holds the matching `PosterBoard-*.ips` and `poster-watch` lines in `settle.txt` (PosterBoard pid/status for ~20 s after the reject; `COINCERT_SIM_POSTER_WATCH=0` to skip). These observe only; the device is still rejected.

## Judge a run only by its log and xcresult

Never by a background task's exit status (a command ending in `echo` exits 0 after a failed boot). A run passed only if: the `Test run with N tests ... passed` line is present, there is one `TEST EXECUTE SUCCEEDED`, no relaunch lines, console count = xcresult total, and every skip is explained. Four whole-shard attempts once ran no tests and looked fine from the exit status.

## Safe / unsafe

Safe: `simctl shutdown|erase <one UDID>` on a device this run booted; reading `~/Library/Logs/DiagnosticReports`; `simctl diagnose --udid`.
Never: `simctl erase all`, `killall Simulator`, `killall com.apple.CoreSimulator.CoreSimulatorService` (kills other sessions' booted sims); touching a simulator this run did not boot. Clean up (shut down, erase if it will not boot) only the devices our run used.

## Open items

- Whether PosterBoard recovers after the SIGTRAP is **unverified**; the reject was deliberately not softened. Read the `poster-watch` lines of the next real failure before changing the gate (research rec. 2).
- Not done: golden `simctl clone` (rec. 5, unverified benefit), boot lock (rec. 4, low benefit). `bootstatus -b` is already used.
- Apple Feedback is still to be filed with the `.ips` (symbol `pf_posterPathInstanceURLForVersionsURL`).
- Pinned + recently-erased device takes the recreate path in `ios-repair.sh`, which deletes the pinned device and invalidates the pin. `COINCERT_SIM_NO_RECREATE=1` guards it (set by the remote runner); local runs still take the recreate path unless they set it.
