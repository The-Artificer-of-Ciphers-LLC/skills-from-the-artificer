---
name: ci-preflight
description: Run before pushing any branch that adds shipped files, hooks, or platform-specific code. Prevents the CI-whiplash pattern — multiple red pushes that could have been caught locally.
---

# CI Preflight

> A green CI is not a reward for guessing correctly. It's the outcome of a local gate that already ran.

## The three CI-whiplash anti-patterns

This skill exists because these three failures happen repeatedly and all have the same root cause: pushing before checking.

---

### Anti-pattern 1: Missing registration surfaces

**What happens:** A new shipped file (hook, agent, command, module) passes unit tests but fails integration tests because it wasn't added to one of several whitelists/registries/inventories the repo maintains.

**Why it's hard:** These surfaces are spread across multiple files with no obvious connection — you find one and miss two others.

**Rule:** Before pushing any new file that ships to users, run a completeness search.

```bash
# Find every place "existing-hook.js" is referenced in the repo
grep -r "gsd-existing-hook" . --include="*.js" --include="*.cjs" --include="*.md" --include="*.json" -l
```

Use an existing sibling file as the probe: if `gsd-existing-hook.js` appears in N files, your new hook must appear in the same N files. Missing even one fails CI.

**In this repo, adding a new hook requires updating all of:**
- `hooks/managed-hooks-registry.cjs` — `MANAGED_HOOKS` array
- `scripts/build-hooks.js` — `HOOKS_TO_COPY` array
- `bin/install.js` — registration block with `fs.existsSync` guard
- `get-shit-done/bin/lib/installer-migration-report.cjs` — `BUNDLED_GSD_HOOK_FILES` Set
- `docs/INVENTORY.md` — headline count + table row
- `docs/INVENTORY-MANIFEST.json` — run `node scripts/gen-inventory-manifest.cjs --write`

**The pattern generalises:** every repo with drift-guard tests has its own set of registration surfaces. Find them before you write the first line.

---

### Anti-pattern 2: No local test run before pushing

**What happens:** Tests that would have caught the problem run in CI but not locally. Each failure costs a full CI round-trip (5–15 minutes) instead of a 30-second local run.

**Rule:** Run the repo's full test command before every push. Not a subset — the full suite.

```bash
npm test           # or whatever this repo uses
npm run lint       # catch lint errors before they hit CI
```

If the full suite is too slow for every push, run `npm test:affected` (or the repo's equivalent) — but know what it misses.

**Specific CI gates to run locally before pushing:**
```bash
npm run lint:changeset     # catches missing/malformed changeset
npm run lint:docs          # catches missing docs update
node scripts/gen-inventory-manifest.cjs  # verify manifest is current
node --test tests/inventory-counts.test.cjs tests/inventory-manifest-sync.test.cjs tests/bug-3628*
```

**When you add a new shipped surface, run the drift-guard tests explicitly** — they're fast and catch exactly the "I forgot to update the registry" error.

---

### Anti-pattern 3: Guessing at cross-platform fixes

**What happens:** A test fails on a platform you can't run locally (Windows). You form a hypothesis, push a fix, it fails again. Repeat 3 times.

**Why it's expensive:** Each guess costs a full 10-minute Windows CI run. Three guesses = 30 minutes of CI time and a messy commit history.

**Rule:** Diagnose before fixing. Understand exactly what the platform does differently before writing a single line of code.

**Diagnosis checklist for cross-platform path failures:**

1. **Read the failure message literally.** "Path inside worktree should pass. stderr: (empty)" means the hook is exiting 2 (blocking) when it should pass. The path comparison is producing false negatives, not false positives.

2. **Identify the data sources.** List every path-valued variable and its origin:
   - Test-constructed path (via `path.join`, `os.tmpdir`, `fs.realpathSync`)
   - Git-returned path (`git rev-parse --show-toplevel` output)
   - `path.resolve()` output
   - `fs.realpathSync()` output
   On Windows these can differ in: separator (`/` vs `\`), case (`Runner` vs `runner`), 8.3 short name vs long name.

3. **Find the mismatch.** On Windows, `os.tmpdir()` returns `C:\Users\RUNNER~1\AppData\Local\Temp` (8.3 short name). `fs.realpathSync` expands to the long name. `git --show-toplevel` returns whatever form the working tree was registered under. These three can all differ.

4. **Design for sameness, not normalisation.** The fix for "two path values that might not match" is usually to ensure they come from the **same source** rather than normalising disparate sources into a common form. In this PR: comparing two `git --show-toplevel` outputs (same binary, same format) worked; comparing `path.resolve` vs `realpathSync` didn't.

**The key insight:** Normalisation fights the platform. Sameness of origin avoids the fight entirely.

---

## Pre-push checklist

Run through this before every `git push` on a branch that changes shipped files:

```
[ ] npm test (or npm test:affected for large repos)
[ ] npm run lint
[ ] If adding a new shipped file:
    [ ] Grepped for an existing sibling to find all registration surfaces
    [ ] Added to every surface the sibling appears in
    [ ] Ran drift-guard tests directly: node --test tests/inventory-*.test.cjs tests/bug-*whitelist*.test.cjs
[ ] If writing cross-platform path code:
    [ ] Listed every path variable and its origin (test-constructed / git / path.resolve / realpathSync)
    [ ] Identified which sources can diverge on Windows (8.3 names, case, separators)
    [ ] Chosen "same source" over "normalise disparate sources"
[ ] No TODOs left in the diff that belong in CI
```

## Quick reference: common drift-guard test patterns in this repo

| Test file pattern | What it guards |
|---|---|
| `inventory-counts` | `docs/INVENTORY.md` headline numbers match filesystem counts |
| `inventory-manifest-sync` | `docs/INVENTORY-MANIFEST.json` matches filesystem |
| `bug-3628-bundled-hook-*` | `BUNDLED_GSD_HOOK_FILES` matches `hooks/` directory |
| `bug-1754-js-hook-guard` | Every `.js` hook has `fs.existsSync` guard in `install.js` |
| `managed-hooks` | `managed-hooks-registry.cjs` matches `hooks/` directory |

When you add a new hook, run all five before pushing.
