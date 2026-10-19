---
description: Pi Automation — Bug Remediation Sweep. Steps through every open confirmed-bug issue in the assigned repository, runs each end-to-end (diagnosis → TDD → review → PR → merge), and continues until the issues queue is empty. Uses CodeGraph for surgical code discovery and blast radius, local model via codemode for analysis.
argument-hint: "[--repo owner/repo] [--base main|master|next] [--issue N] [--limit N] [--dry-run]"
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, codemode, AskUserQuestion, mcp__codegraph__codegraph_explore
---

# Pi Automation: Bug Remediation Sweep

> **RUNTIME PARAMETERS (tune before running):**
> - `REPO` = `gh repo view --json nameWithOwner -q .nameWithOwner` (default: current repo)
> - `BASE_BRANCH` = `main` or `next` (default: auto-detect from repo)
> - `LIMIT` = `100` (max issues to process per run)
> - `ISSUE` = single issue number (optional, for targeted fix)
> - `DRY_RUN` = `true` (preview only, no code changes)

## Objective

Sweep the tracker's confirmed-bug issues one at a time, running each through a complete
remediation loop: **diagnose → reproduce → test-driven fix → review → PR → merge**. Continue
until the issues queue is empty or no more `confirmed-bug` issues remain.

This is the pi-local-model adaptation of the Claude Code `/bug-fixer` directive. It uses
CodeGraph (via `mcp__codegraph__codegraph_explore`) for surgical code discovery, symbol
lookups, caller/callee chains, and blast-radius analysis — replacing the file-by-file
grep-and-read approach. The local model via `codemode` handles diagnosis reasoning and
review analysis.

## Workflow Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  START: Enumerate confirmed-bug issues                          │
│         ↓                                                       │
│  FOR EACH issue (until queue empty or --issue N):               │
│    -1. Refresh base branch from origin                          │
│     0. Read controlling files + issue context                   │
│     1. Create branch from refreshed base                        │
│     2. Diagnose root cause (CodeGraph + local model)            │
│     3. Write reproduction test (RED)                            │
│     4. Fix root cause, verify GREEN                             │
│     5. Run orthogonal reviews (local model)                     │
│     6. Open PR, watch CI, merge                                 │
│     7. Update queue state                                       │
│         ↓                                                       │
│  END: Report summary of fixes, skips, and needs-decision items  │
└─────────────────────────────────────────────────────────────────┘
```

## Autonomous Contract

**You run the loop end-to-end.** Standing authorization covers execution — diagnosis, TDD,
tests, push, PR, CI watch, merge. Do not stop to ask for approval on mechanical steps.

**Halt conditions (raise with user in chat):**
- A judgment call the issue leaves open (design alternative, behavior change)
- A merge conflict you cannot resolve
- CI failure that persists after root-cause fix attempts

**Everything else is execution, not judgment.** Write the artifact gate file and continue.

## Artifact Gates

Every blocking step writes a file. The next action is denied until it exists:

| Artifact | Written by | Blocks until it exists |
|---|---|---|
| `.gsd/bug/queue.json` | **Phase A** | `git checkout -b` for next issue |
| `.gsd/bug/<branch-slug>/00-run.json` | **Phase A** | *(arms branch — nothing gated before)* |
| `.gsd/bug/<branch-slug>/10-diagnosis.md` | **Step 3** | any `Edit`/`Write` to `src/**` |
| `.gsd/bug/<branch-slug>/50-test-matrix.md` | **Step 4** | any `Edit`/`Write` to `tests/**` |
| `.gsd/bug/<branch-slug>/60-review.json` | **Step 5** | `git push` |
| `.gsd/bug/<branch-slug>/80-ship.json` | **Step 7** | `gh pr merge` |

> **Note:** In pi, these gates are enforced by convention and your discipline, not by a
> hook. Write the files before proceeding — they are your audit trail and your memory.

---

## Phase A: Build the Work Queue

**[BLOCKING]** *Enumerate defects and prune already-in-flight work.*

### Step A1: Discover the repository

```bash
# Get repo info (or use --repo flag)
REPO="${REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)}"
BASE_BRANCH="${BASE_BRANCH:-$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null)}"
```

If `gh` is not authenticated or the repo cannot be detected, ask the user for:
- `owner/repo` (GitHub repository)
- `base_branch` (integration branch, usually `main`, `master`, or `next`)

### Step A2: Enumerate confirmed-bug issues

```bash
gh issue list --repo "$REPO" --label confirmed-bug --state open --json number,title,labels,assignees,url
```

Exclude issues also labeled `enhancement` or `feature` — this sweep fixes **defects only**.

If `--issue N` was passed, the queue is that single issue.

### Step A3: Prune already-fixed or in-flight issues

For each candidate, check:

1. **Already closed?** `gh issue view <N> --json state,stateReason,closedAt`
   - If CLOSED, mark as `closed` in queue and skip.

2. **Already fixed by merged PR?**
   ```bash
   git fetch origin "$BASE_BRANCH"
   git log origin/"$BASE_BRANCH" --oneline --grep="#<N>"
   ```
   - If a merged fix exists, mark as `closed` with the tracker's reason.

3. **Open PR already references it?**
   ```bash
   gh pr list --repo "$REPO" --search "is:open closes:#<N>" --json number,title
   ```
   - If an open PR exists, mark as `in_progress` with the PR number.

### Step A4: Build and write queue.json

```json
{
  "repo": "owner/repo",
  "base_branch": "main",
  "started_at": "2025-01-15T10:30:00Z",
  "issues": [
    {
      "issue": 123,
      "title": "Button crashes on click",
      "branch": null,
      "state": "queued",
      "pr": null,
      "reason": null,
      "decision": null
    }
  ]
}
```

States: `queued` | `in_progress` | `merged` | `needs-decision` | `skipped` | `closed`

A `needs-decision` entry must include:
```json
{
  "question": "Should we preserve backward compatibility or break the API?",
  "tried": "Attempted fix X, but it violates documented behavior Y",
  "if_answer_a": "Preserve compat: implement workaround Z",
  "if_answer_b": "Break API: document breaking change in PR"
}
```

**Write `.gsd/bug/queue.json` now.** `git checkout -b` for the next issue is denied until
the current issue reaches a terminal state.

### Step A5: Resume logic

If `.gsd/bug/queue.json` already exists, re-check each `queued` or `in_progress` entry:
- Re-query the tracker for current state
- Move any CLOSED issues to `closed` with tracker's reason/timestamp
- Continue only with live issues

---

## Phase B: Per-Issue Loop

Execute Steps -1 through 6 for each issue. Halt on `needs-decision`, surface the question,
continue with the next issue.

### Step -1: Refresh Base Branch

**[MANDATORY]** *Always start from the latest origin state before any work begins.*

```bash
# Fetch latest changes from all remotes
git fetch origin "$BASE_BRANCH"

# Reset local base branch to match origin (discard any stale local commits)
git checkout "$BASE_BRANCH"
git reset --hard "origin/$BASE_BRANCH"

# Verify clean state
git status --short
```

If the fetch fails (network issue, auth problem), halt and surface the error — do not proceed with stale code.

### Step 0: Context Initialization

1. **Read controlling files:**
   - `CONTRIBUTING.md` (full read)
   - `.github/PULL_REQUEST_TEMPLATE/fix.md` (the PR template — **MUST** be read and followed)
   - `CONTEXT.md` (grep for predicates touching the defect seam)
   - Any relevant ADRs in `docs/adr/`

2. **Read the issue fully:**
   ```bash
   gh issue view <N> --repo "$REPO" --json title,body,labels,comments
   ```
   - Fetch all comments and review threads for follow-ups
   - Check for inline review comments: `gh api --paginate repos/{owner}/{repo}/issues/<N>/comments`

3. **Capture acceptance criteria** as a Must-Have checklist from the issue body.
   Each item is a release blocker. If none defined, record the reproduction condition.

### Step 1: Branch Creation

```bash
# Create branch from the refreshed base (Step -1 ensured it's current)
BRANCH="fix/<N>-<slug>"  # e.g., fix/123-button-crash
git checkout -b "$BRANCH"
```

**Write `.gsd/bug/<branch-slug>/00-run.json`:**
```json
{
  "issue": 123,
  "branch": "fix/123-button-crash",
  "started": "2025-01-15T10:35:00Z"
}
```

Set this issue's `queue.json` state to `in_progress`.

### Step 2: Code Discovery via CodeGraph

**[BLOCKING]** *Establish structural context before any code interaction.*

1. **Locate the defect seam.** Use CodeGraph to find the relevant symbols:
   ```javascript
   // Find symbols related to the bug symptom
   const result = await tools.mcp__codegraph__codegraph_explore({
     query: `Find the code related to: ${issueTitle}. Show me the symbol definitions, their callers, and the execution path that leads to the reported error.`,
     projectPath: process.cwd()
   });
   ```

2. **Trace the failing path.** If the issue describes a flow ("X leads to Y error"):
   ```javascript
   const result = await tools.mcp__codegraph__codegraph_explore({
     query: `Trace the call path from ${entrySymbol} to ${errorSymbol}. Show me all intermediate steps, conditional branches, and where the failure occurs.`,
     projectPath: process.cwd()
   });
   ```

3. **Assess blast radius.** Before proposing a fix:
   ```javascript
   const result = await tools.mcp__codegraph__codegraph_explore({
     query: `What is the impact of changing ${symbolName}? Show me all callers, dependents, and related symbols that would be affected.`,
     projectPath: process.cwd()
   });
   ```

4. **Read source windows.** CodeGraph returns verbatim source with line numbers. For deeper context:
   ```bash
   # If CodeGraph points to a file but you need more context
   read path/to/file.ext  # Read the full file if needed
   ```

### Step 3: Root Cause Analysis (Local Model)

Use `codemode` to reason over the CodeGraph findings:

```javascript
// @options: {"max_output_tokens": 4000, "timeout_ms": 120000}
const codeGraphResults = /* results from Step 2 */;
const issueBody = /* issue title + body */;
const errorLogs = /* any stack traces or error output from reproduction */;

return `## Diagnosis for Issue #${issueNumber}

### Root Cause
Based on CodeGraph analysis:
- **Location**: ${codeGraphResults.primarySymbolPath}:${codeGraphResults.lineNumber}
- **Symbol**: ${codeGraphResults.symbolName}
- **Mechanism**: ${localModel.analyzeRootCause(codeGraphResults, errorLogs)}

### Call Path to Failure
${codeGraphResults.callPath || localModel.traceCallPath(codeGraphResults)}

### Blast Radius
${codeGraphResults.blastRadius || 'Review required'} symbols affected

### Reproduction
${localModel.extractReproductionSteps(issueBody, errorLogs)}

### Suggested Fix Approach
${localModel.proposeFix(codeGraphResults, issueBody)}
`;
```

**Write `.gsd/bug/<branch-slug>/10-diagnosis.md`:**
```markdown
## Reproduction
[exact command + observed output from Step 4]

## Root Cause
[path/file.ext:LINE (symbolName)]
[Mechanism: what is actually wrong]

## Introduced By
[commit/episode + date from `git log -L`, or "long-standing"]

## Blast Radius
[symbols affected, dependent count — from CodeGraph]

## Must-Have Acceptance Checklist
- [ ] Item 1 from issue
- [ ] Item 2 from issue

## Laws That Apply
[if any Artificer laws apply, list them]

## Not-the-Bug / Negative Space
[what must keep working after fix — from CodeGraph blast radius]

## Rejected Fixes
[alternatives considered and why not]
```

**Any `Edit`/`Write` to `src/**` is denied until this file exists.**

### Step 3: Reproduce the Defect

Run the reproduction. Capture exact command and observed output (RED evidence).

If reproduction genuinely fails, set issue to `needs-decision` with that finding.

### Step 4: Test-Driven Fix

1. **Write failing test first:**
   ```bash
   # Create test that reproduces the bug
   echo 'test("reproduces issue #<N>", async () => { ... })' > tests/...
   ```

2. **Commit the test:**
   ```bash
   git add tests/...
   git commit -m "test: reproduce issue #<N> - <brief description>"
   ```

3. **Run tests to confirm RED:**
   ```bash
   npm test -- --grep "reproduces issue #<N>"
   # Verify failure output
   ```

4. **Fix the root cause** in `src/**`.

5. **Run tests to confirm GREEN:**
   ```bash
   npm test -- --grep "reproduces issue #<N>"
   # Verify pass output
   ```

6. **Run full test suite:**
   ```bash
   npm test
   # Verify all tests pass
   ```

**Write `.gsd/bug/<branch-slug>/50-test-matrix.md`:**
```markdown
| # | Input class | Category | Expected | Test name | RED proven (sha) | Covered? |
|---|---|---|---|---|---|---|
| 1 | Bug reproduction | regression | fails before fix, passes after | <test-name> | <sha> | ✓ |
| 2 | Boundary case | boundary | passes | <test-name> | - | ✓ |
```

**Any `Edit`/`Write` to `tests/**` is denied until this file exists.**

### Step 5: Orthogonal Reviews (CodeGraph + Local Model)

Run two review passes. First use CodeGraph to understand the diff's impact, then local model for analysis.

**Pass 1: CodeGraph Impact Analysis**
```javascript
// Analyze what the diff touches
const changedFiles = /* files in git diff */;
const result = await tools.mcp__codegraph__codegraph_explore({
  query: `Review this diff for correctness issues. The changes are in: ${changedFiles.join(', ')}. Show me the callers and dependents of changed symbols, and identify any edge cases or breaking changes.`,
  projectPath: process.cwd()
});
```

**Pass 2: Correctness Review (Local Model)**
```javascript
// @options: {"max_output_tokens": 3000, "timeout_ms": 60000}
const diff = /* git diff output */;
const testResults = /* test output */;
const codeGraphImpact = /* results from Pass 1 */;

return `## Code Review: Issue #${issueNumber}

### Correctness
${localModel.reviewCorrectness(diff, testResults)}

### Edge Cases
${localModel.findEdgeCases(diff, codeGraphImpact)}

### Performance
${localModel.checkPerformance(diff)}

### Blast Radius Verification
Symbols affected: ${codeGraphImpact.symbolsAffected || 'See CodeGraph results'}
Callers changed: ${codeGraphImpact.callerChanges || 'None detected'}
`;
```

**Pass 3: Security Review (Local Model)**
```javascript
// @options: {"max_output_tokens": 3000, "timeout_ms": 60000}
const diff = /* git diff output */;

return `## Security Review: Issue #${issueNumber}

### Injection Vectors
${localModel.checkInjection(diff)}

### Secret Handling
${localModel.checkSecrets(diff)}

### Path Traversal
${localModel.checkPathTraversal(diff)}

### Untrusted Data Sources
${localModel.checkUntrustedInputs(diff)}
`;
```

**Write `.gsd/bug/<branch-slug>/60-review.json`:**
```json
{
  "engines": [
    {
      "name": "correctness-review",
      "isolated": false,
      "findings": [
        { "severity": "blocker|major|minor", "summary": "...", "disposition": "fixed <sha>|not-a-defect: <proof>" }
      ]
    },
    {
      "name": "security-review",
      "isolated": false,
      "findings": []
    }
  ]
}
```

**`git push` is denied until this file exists.**

### Step 6: Acceptance Verification & Rebase

1. **Walk the Must-Have checklist** — every item covered by passing test or recorded evidence.
2. **Rebase onto base branch** (in case origin advanced while you were working):
   ```bash
   git fetch origin "$BASE_BRANCH"
   git rebase "origin/$BASE_BRANCH"
   ```
3. **Re-run tests after rebase** (sha changed, invalidates prior pass).
4. **Run lint:**
   ```bash
   npm run lint:ci
   # Check exit code, not output
   ```

### Step 7: PR & Merge

1. **Read the repo's fix.md template** (from `.github/PULL_REQUEST_TEMPLATE/fix.md`) — this is MANDATORY.

2. **Push and create PR:**
   ```bash
   git push origin "$BRANCH"
   gh pr create --repo "$REPO" --base "$BASE_BRANCH" --title "fix: <brief>" --body-file PR_BODY.md
   ```

3. **PR body MUST follow the repo's fix.md template exactly:**
   ```markdown
   ## Fix PR

   Fixes #<N>

   ## What was broken
   [One or two sentences. What was the incorrect behavior?]

   ## What this fix does
   [One or two sentences. How does this fix the broken behavior?]

   ## Root cause
   [Brief explanation of why the bug existed. Skip for trivial typo/doc fixes.]

   ## Testing

   ### How I verified the fix
   [Describe manual steps or point to the automated test that proves this is fixed.]

   ### Regression test added?
   - [ ] Yes — added a test that would have caught this bug
   - [ ] No — explain why: <!-- e.g., environment-specific, non-deterministic -->

   ### Platforms tested
   - [ ] macOS
   - [ ] Windows (including backslash path handling)
   - [ ] Linux
   - [ ] N/A (not platform-specific)

   ### Runtimes tested
   - [ ] Claude Code
   - [ ] Antigravity
   - [ ] OpenCode
   - [ ] Other: ___
   - [ ] N/A (not runtime-specific)

   ## Checklist
   - [ ] Issue linked above with `Fixes #NNN` — **PR will be auto-closed if missing**
   - [ ] Linked issue has the `confirmed-bug` label
   - [ ] Fix is scoped to the reported bug — no unrelated changes included
   - [ ] Regression test added (or explained why not)
   - [ ] All existing tests pass (`npm test`)
   - [ ] `.changeset/` fragment added if this is a user-facing fix (`npm run changeset -- --type Fixed --pr <NNN> --body "..."`) — or `no-changelog` label applied
   - [ ] No unnecessary dependencies added

   ## Breaking changes
   None
   ```

4. **Watch CI to completion:**
   ```bash
   gh pr checks <N> --repo "$REPO" --watch
   # Poll until no check is pending
   ```

5. **Fix any CI failures** — reproduce, fix root cause, re-run tests, push.

5. **Write `.gsd/bug/<branch-slug>/80-ship.json`:**
   ```json
   {
     "pr": 123,
     "checks": { "green": true, "failing": [] },
     "mergeable": "MERGEABLE",
     "verdict_sha": "<40-hex sha>",
     "merge": { "method": "squash", "admin": false, "admin_reason": null }
   }
   ```

6. **Merge:**
   ```bash
   gh pr merge <N> --repo "$REPO" --squash --delete-branch
   ```

7. **Confirm issue closed** (should auto-close via `Fixes #<N>`).

8. **Update queue.json** — set issue to `merged` with PR number.

---

## Phase C: Final Report

Report once, at the end, rendered from `.gsd/bug/queue.json`:

- Per issue: `#` · terminal state · PR number · merge state
- Every `needs-decision` entry restated as an open question for the user
- Defects fixed inline that were outside original scope
- Any true merge conflict you could not resolve
- Anything deliberately left out

---

## Guardrails

- **Never stop to ask about execution.** Standing authorization covers the mechanical loop.
- **Graph-first where available.** If CodeGraph/Memtrace are configured, use them for lookups.
  Otherwise, rely on grep/read and local model analysis.
- **`gsd-test` or equivalent.** Use the project's test runner. Gate on pass/fail for exact sha.
- **No waving off warnings. No deferrals.** Every defect found — in your fix, in pre-existing tests, in CI, anywhere — MUST be fixed. There is no "pre-existing", no "out of scope", no "I'll file an issue". If gsd-test reports failures, you fix them before merging. Period.
- **Zero tolerance for unmet gates.** A red gsd-test verdict is a hard block. Never substitute local tests, never claim "unrelated", never re-run away from a failure. Root-cause the mechanism and fix it.
- **Acceptance criteria are must-haves.** Unmet criterion → `needs-decision`.
- **Two orthogonal reviews, zero tolerance.** Findings at any severity block.
- **Merge authority.** Admin merge only for missing secondary reviewer, never for red CI or conflicts.
- **Halt the issue, never the queue.** One `needs-decision` gets raised; sweep continues.
- **Never write to a GitHub issue** (comments, labels, state changes) — only PR flow is authorized.
- **Branch naming:** `<prefix>/<n>-<slug>` (e.g., `fix/5497-pathspec-seed-flake`); `claude/` rejected.
- **Commit message:** Must follow Conventional Commits with issue reference: `fix(#N): description` (e.g., `fix(#5497): distinguish quoted messages from synopsis notation`).
- **PR title:** Must match the commit message format exactly: `fix(#N): description`.
- **One concern per PR.** Each issue gets its own branch and PR.

---

## Pi-Specific Notes

### CodeGraph Integration
CodeGraph is the primary code discovery engine. Use `mcp__codegraph__codegraph_explore`
for:
- **Symbol lookup**: "Find the implementation of `validateInput`"
- **Call chains**: "How does `handleSubmit` reach the API call?"
- **Blast radius**: "What breaks if I change `UserModel`?"
- **Source windows**: Get verbatim source with line numbers for any symbol

The tool returns: entry points, related symbols, code snippets grouped by file,
call paths between symbols (including dynamic-dispatch hops), and a blast-radius summary.

### Local Model Usage
This directive uses `codemode` to invoke the local model for:
- Root cause analysis reasoning (Step 2)
- Test matrix design (Step 4)
- Orthogonal code review passes (Step 5)

The local model handles reasoning and decision logic; CodeGraph + pi's tools handle
code discovery and execution.

### Tool Split
| Need | Tool |
|---|---|
| Symbol lookup, callers/callees, blast radius | `mcp__codegraph__codegraph_explore` |
| Source code reading | `Read` (for files not covered by CodeGraph) |
| Root cause analysis, review reasoning | `codemode` + local model |
| Test execution | Project's native test runner (`npm test`, etc.) |
| Git operations, PR management | `Bash` (git, gh commands) |

### When CodeGraph Is Unavailable
If the MCP server is disconnected or returns an error:
1. Say so explicitly — do not silently fall back
2. Use `Bash` (git log, grep) + `Read` as fallback
3. Note the degradation in the run log

---

## Install

To use this directive in pi:

```bash
# Symlink to pi's commands directory (if supported)
ln -sfn "$PWD/pi-tools/automation/bug-fixer.md" ~/.pi/commands/

# Or copy for local fork
cp pi-tools/automation/bug-fixer.md ~/.pi/commands/
```

Restart pi. The command appears as `/bug-fixer`.

---

## Adaptation Notes

This is a pi-local-model adaptation. Key differences from the Claude Code original:

1. **CodeGraph for code discovery** — uses `mcp__codegraph__codegraph_explore` for surgical
   symbol lookup, call chains, and blast radius. Replaces Memtrace's graph tools.
2. **codemode for analysis** — local model runs diagnosis and review via JavaScript scripts
3. **Native test runner** — uses project's existing test infrastructure (not `gsd-test`)
4. **Convention-based gates** — artifact files are audit trail, not hook-enforced
5. **Single-agent sweep** — no multi-agent fleet coordination; sequential issue processing

Keep the defensive prose (incidents, "never" rules) — they trace to real failures.
Replace project-specific details (test runner commands, branch names, label vocabulary)
with your repo's conventions.

### CodeGraph vs Memtrace Mapping

| Memtrace Tool | CodeGraph Equivalent |
|---|---|
| `find_code` / `find_symbol` | `codegraph_explore` with symbol name in query |
| `get_symbol_context` | `codegraph_explore` with "show callers and callees" |
| `get_impact` / `preflight_check` | `codegraph_explore` with "impact of changing X" |
| `get_timeline` / `get_evolution` | `git log -L` + `git blame` (CodeGraph doesn't track history) |
| `recall_decision` / Cortex | Not available — use grep for ADRs, docs |
| `find_dead_code` | `codegraph_explore` with "find symbols with no callers" |
| `find_cross_module_issues` | `codegraph_explore` with "find stale references" |
