<!-- Part of /review-open-prs (commands/review-open-prs.md). Read this file in full when Phase B reaches this section. -->

### 3D. The Deterministic Review Pass (invoked by §3A.7 and §3B.7)
**[BLOCKING]** *No LLM in this path — AST detectors, a 315-rule multi-language YAML pack, and cross-module graph checks, all local. Its findings are evidence, not opinion, and they land in §8 as such.*

Steps 1–5 take the diff: call each one once per changed file with `diff: "@pr-block <repo path>"` (fidelity guard armed in §0.0), so every tool covers every changed file with its complete, verbatim block.

1. `mcp__memtrace__detect_changes` — scope the exact diff to affected symbols and their structural roles (community, process, blast radius). Run this first; the rest are diff-scoped and inherit its accuracy.
2. `mcp__memtrace__find_cross_module_issues` (`diff`, `repo_root`, `repo_id`) — import-not-found, caller signature drift, stale call sites after a rename, **removed-symbol-still-referenced (Critical)**, interface method drift. **Check `_graph_state` on the response** per §0.3: zero issues alongside a staleness note is not a clean verdict.
3. `mcp__memtrace__find_code_review_issues` — the combined surface (AST + YAML pack + cross-module) under one confidence/ranking policy. Required by name in §8.1. **Two defaults will silently under-report on a zero-tolerance review:**
   - `review_mode` defaults to **`strict`**, which keeps only benchmark-safe high-precision findings. Pass **`review_mode: "online"`** — it adds evidence-gated repo-convention and invariant-drift candidates, which is the mode built for live review rather than for a precision leaderboard.
   - `max_candidates` defaults to **20**. §8 is zero-tolerance down to nits, so a 20-item cap on a large diff hands you a truncated list that reads like a complete one. Raise it, and if you leave it capped, say so in the review body rather than implying the list is exhaustive.
4. `mcp__memtrace__find_yaml_rule_matches` — run the rule pack **directly**, in addition to step 3. Step 3 ranks and filters; this returns the raw hits. The pack covers CSPRNG misuse, SQL string concatenation, disabled TLS verification, unsafe deserialization, ORM N+1, and sync I/O inside async across TS/JS, Python, Go, Java, Ruby, C#, Rust, Swift, Kotlin, and Lua — the exact classes §3A.8/§3B.5 `/security-review` is responsible for, arriving here as deterministic evidence instead of a judgment call. Each rule carries a `prod | test | any` context and Memtrace judges test-vs-prod with a real per-language AST walk, not a path guess — so a hit inside a fixture is genuinely scoped, and a `prod`-context hit in a file that merely lives under `tests/` is genuinely a hit.
5. `mcp__memtrace__find_ast_review_issues` — **Python-only**; skip on a diff with no `.py` files rather than reporting it as clean.
6. **`mcp__memtrace__review_github_pr` — the product review engine, as a second independent pass.** It runs the same local detectors under Memtrace's own ranking policy against the PR fetched from GitHub, and it ranked #1 on a 50-PR offline benchmark (3-judge mean F1 0.7268, ~20% ahead of the next tool). Because it ranks independently of your step-3 call, disagreement between the two is itself signal.
   ```
   mcp__memtrace__review_github_pr(
     prUrl: "https://github.com/open-gsd/gsd-core/pull/<PR>",
     post: false,          # MANDATORY — see below
     repoRoot: "<abs path of the PR checkout>",
     repoId: "<indexed repo id>",
     graphMode: "strict",
     reviewMode: "online",
     minSeverity: "low",   # §8 is zero-tolerance; the "high" default hides nits
     maxComments: 30
   )
   ```
   - **`post: false` is non-negotiable in this directive.** §8 owns the single posted review, `require-memtrace-evidence.sh` gates its body, and §7 may yet close this PR as a competing loser. A second review posted by the Memtrace GitHub App would bypass the evidence gate, split the verdict across two authors, and survive the PR's closure. Fold its findings into the §8 body instead.
   - **Preconditions, and how they fail.** `--pr`/`prUrl` mode needs a `memtrace auth login` session to mint a short-lived GitHub App installation token, and the Memtrace Code Reviewer App installed on `open-gsd/gsd-core`. Missing auth or a missing installation returns an explicit error — report it and fall back to steps 1–5, which never contact GitHub at all. **Do not treat a `review_github_pr` that could not run as a clean pass.**
   - **It reads your working tree, not the PR head.** No clone or fetch of the PR branch happens: the engine reads the fetched diff plus the local checkout at `repoRoot`, and only *warns* when local HEAD differs from the PR's head SHA. §1.11 already left you on `gh pr checkout $PR`, which is what makes this correct — so if you ran this step from anywhere else, the result is against the wrong tree and must be discarded.
   - Privacy boundary, for the record: source code is never sent to Memtrace SaaS. The hosted service acts purely as the GitHub App token broker; diff analysis, graph lookup, and ranking all run locally.
