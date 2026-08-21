---
description: Run the GSD test suite on Mac, Linux Docker, and Windows Docker (if configured), then compare results.
allowed-tools: Bash(gsd-test-both:*), Bash(gsd-test:*), Bash(gsd-test-local:*), Bash(gsd-test-windows:*), Bash(jq:*), Bash(cat:*), Bash(head:*), Bash(tail:*)
---

Run the project's tests on all configured platforms (Mac local + Linux Docker + Windows Docker)
and analyze the diff.

## Steps

1. Run `gsd-test-both`. It launches `gsd-test-local`, `gsd-test`, and (if configured)
   `gsd-test-windows` in parallel, writes JSON Lines results to per-invocation files in
   `/tmp/`, then prints a comparison summary. Windows is skipped with a notice if
   `~/.config/gsd-test/windows-hosts` is empty.

2. Read the JSON Lines files. Parse and categorize failures into:
   - **All fail** (real bugs — same failure on every platform)
   - **Mac-only fail** (passes on Docker platforms — Mac-specific issue)
   - **Linux-only fail** (passes on Mac + Windows — Linux/container-specific issue)
   - **Windows-only fail** (passes on Mac + Linux — Windows-specific issue)
   - **Missing on one platform** (test discovery differs)

3. Summarize for me:
   - Counts per category
   - For each failure type, list up to 10 with file + test name + first
     line of the error message

4. If anything is platform-specific, call those out as the most interesting findings.

5. If `gsd-test-both` exited non-zero, surface the stderr tails it printed.

## Useful jq one-liners

    # All failures on Linux:
    jq -c 'select((.type=="test:fail") or (.type=="test_event" and .kind=="fail")) | {file: (.data.file // .file), name: (.data.name // .name)}' /tmp/gsd-test-docker-*.jsonl

    # Test names grouped by file (most-broken files first):
    jq -r 'select((.type=="test:fail") or (.type=="test_event" and .kind=="fail")) | (.data.file // .file)' /tmp/gsd-test-docker-*.jsonl | sort | uniq -c | sort -rn
