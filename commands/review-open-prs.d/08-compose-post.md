<!-- Part of /review-open-prs (commands/review-open-prs.md). Read this file in full when Phase B reaches this section. -->

### 8. Compose and post the GitHub review
**[BLOCKING]**
**ZERO-TOLERANCE APPROVAL POLICY:** Minor issues are NOT approvable. Every issue (including nits) MUST be fully resolved. Merge conflicts immediately block approval.

Structure: Summary → Classification & gate compliance → Functional checklist / Root-cause verdict → Blast radius (from `get_impact`) + risk tier (from §1.11b `find_central_symbols` / `find_bridge_symbols`) → Co-change completeness (from 4C) → **`### Memtrace Evidence`** → Findings by severity (Blocker/Major/Minor/Nit) → Verdict.

Deterministic findings (§3D) and judgment findings (`/code-review`, `/security-review`, the isolated adversarial pass) both land in the severity list, but **attribute each one to its source**. A `find_cross_module_issues` removed-symbol-still-referenced is a fact about the graph and is not negotiable in review discussion; a style or design objection is a judgment the contributor may reasonably push back on. Merging the two into one undifferentiated list is how a hard finding gets argued away.

Assemble the body by reading the `FILE:` paths returned by each spawned agent (per the Subagent Output Contract at the top of Phase B) — not from agent reply text.

#### 8.1 `### Memtrace Evidence` is MACHINE-ENFORCED — the post is DENIED without it
`.claude/hooks/require-memtrace-evidence.sh` is a PreToolUse Bash hook (wired in `.claude/settings.json`). It intercepts any command matching `gh pr review … --approve` or `--request-changes` and **denies the call** unless the body satisfies both:

1. Contains the literal heading **`### Memtrace Evidence`** — exactly three `#`, exact capitalization.
2. That section names **all four** required tools literally (`require-memtrace-evidence.sh:67`):
   `get_impact` · `get_symbol_context` · `recall_decision` · `find_code_review_issues`

Document the target and the finding for each. A heading with only three of the four is denied with *"missing evidence for these required tools"*.

`gh pr review --comment` is **exempt** from this gate — use the comment form for direction/mechanical-block notes (red CI, rebase-needed, pending-approval CI) where a full graph pass isn't warranted.

#### 8.2 Posting mechanics — `--body-file` must be a LITERAL, fully-expanded path
The hook reads the body by `sed`-extracting the path from the **raw command text** (`.tool_input.command`), never from shell-expanded argv. Anything requiring the shell to expand is invisible to it and denies with the misleading *"No body found"*:

- ✅ `--body-file /abs/path/review.md` — bare
- ✅ `--body-file "/abs/path/review.md"` and `'/abs/path/review.md'` — quoted forms are handled (`require-memtrace-evidence.sh:47-49`, quoted patterns run first)
- ❌ `--body-file "$BODY"` · `--body-file $(mktemp)` · `--body-file <(...)` — **never expand; always denied**

Write the body to the scratchpad, then paste the resulting absolute path literally into the command text:

```bash
gh pr review 2412 --request-changes --body-file /abs/path/to/scratchpad/pr-2412-review.md
```

#### 8.3 The tentative-approve gate — CI must already be green before you post `--approve`
If, after all of §§2–7, the finding list is genuinely empty (no Blocker/Major/Minor/Nit at all),
the verdict is **tentatively** Approve — but **do not post it yet**. An empty finding list from
static review, Memtrace, and the adversarial pass is not proof the commit builds and passes; it is
proof the *code review* found nothing, which is a different and weaker claim (see the #4599
incident above: a real defect existed that only the actual test run caught). Go to **§9** now:
release any queued/pending CI for this exact head SHA and poll it to real completion. Only after
that comes back either genuinely green, or red-but-proven-pure-base-drift (§9.4's attribution
method, applied *before* you post anything), do you return here and post `--approve`. If the CI run
surfaces a failure attributable to this PR's own diff, the tentative Approve is wrong: add that
failure as a Blocker finding, rewrite the verdict as `changes-requested`, and post that instead —
never post an approval for a commit whose CI you have not personally watched finish green.

If the tentative verdict already carries any finding (i.e. it was never going to be an Approve),
post the `changes-requested` review now, per the structure above. §9's CI release for that case
happens ONLY when every finding is a Nit; with any Blocker/Major/Minor finding, CI stays queued
(the fix push will trigger it, and releasing now would double the CI cost).

Post-review status updates:
1. Apply the appropriate GitHub label (`changes-requested` or `approved`).
2. Clear outdated review-status labels.
3. Apply the domain-area label.
