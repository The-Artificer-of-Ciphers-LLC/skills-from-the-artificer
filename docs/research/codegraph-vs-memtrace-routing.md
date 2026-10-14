# CodeGraph-first routing for low-risk lookups, Memtrace for heavy hits, and a quota cooldown that tells agents when Memtrace returns

Date: 2026-10-13. Repo state: branch feat/opencode-guard-adapter at 9d9f1c0. Local versions: codegraph 1.6.2 (`codegraph --version`), `memtrace` binary not on PATH in this shell (no `memtrace --help` available; Memtrace facts come from its public docs).
Cite keys: `mt-plans` https://www.memtrace.io/docs/enterprise/plans ; `mt-search` https://www.memtrace.io/docs/features/search ; `mt-faq` https://www.memtrace.io/docs/help/faq ; `mt-tools` https://cdn.jsdelivr.net/gh/syncable-dev/memtrace-public@main/docs/tools.md ; `mt-cortex` https://cdn.jsdelivr.net/gh/syncable-dev/memtrace-public@main/docs/cortex.md ; `mt-readme` https://raw.githubusercontent.com/syncable-dev/memtrace-public/main/README.md ; `mt-priv` https://cdn.jsdelivr.net/gh/syncable-dev/memtrace-public@main/docs/privacy-and-telemetry.md ; `cg-readme` https://raw.githubusercontent.com/colbymchenry/codegraph/main/README.md (fetched 2026-10-13; the fetch tool reported approximate line numbers only, so section names are cited, not lines). Repo cites are `file:line` under `claude-guards/hooks/` unless prefixed. Extends `docs/research/circuit-breaker-auto-restart.md` sections 3-4 (not repeated).

## 1. Tool surfaces (exact)

### CodeGraph (local, SQLite, no quota)
- MCP, listed by default: one tool, `codegraph_explore`. `cg-readme` "MCP Tools": "Answers most questions in one call. It returns the relevant symbols' source grouped by file, the call paths between them, and a blast-radius summary." Naming a file or symbol in the query returns its line-numbered source.
- MCP, unlisted by default but functional, re-enabled via env `CODEGRAPH_MCP_TOOLS` (example in README: `explore,node,search,callers`): `codegraph_node`, `codegraph_search`, `codegraph_callers`, `codegraph_callees`, `codegraph_impact`, `codegraph_files`, `codegraph_status` (`cg-readme`, "MCP Tools"). In this session all of them are callable (verified earlier work: circuit-breaker doc section 4).
- Multi-project: `projectPath` argument, "A path that has no index returns clean guidance to use built-in tools instead" (`cg-readme`).
- CLI (verified with `~/.local/bin/codegraph --help` and each `<cmd> --help`, v1.6.2): `init, uninit, index, sync, status, query, explore, context, node, files, daemon, unlock, callers, callees, impact, affected, install, uninstall`. Flags that matter: `explore <query...> [-p path] [--max-files N]`; `node [name] [-f file] [--offset N] [--limit N] [--symbols-only] [-p path]` ("One symbol's source + caller/callee trail, or read a file with line numbers + dependents"); `query <search> [-k kind] [-l N] [-j]`; `callers|callees <symbol> [-f file] [-l N] [-j]`; `impact <symbol> [-f file] [-d depth(default 2)] [-j]`; `affected [files...]` ("Find test files affected by changed source files"); `context <task...> [-n max-nodes] [--no-code]`.
- Cost/quota: none stated. `cg-readme` "100% Local": "No data leaves your machine. No API keys. No external services. SQLite database only." It also documents anonymous telemetry (`codegraph telemetry [on|off]`, `CODEGRAPH_TELEMETRY`, `DO_NOT_TRACK=1`).
- Freshness: `cg-readme` "How auto-syncing works": native file watcher, 2000 ms default debounce (`CODEGRAPH_WATCH_DEBOUNCE_MS`); "Auto-sync is enabled by default"; responses for pending files carry a staleness warning telling the agent to read the file directly. Manual `codegraph sync` only if the watcher is disabled (`CODEGRAPH_NO_DAEMON=1`).
- Local index here: `codegraph status` -> 26 files, 655 nodes, 1,384 edges, node:sqlite backend (this repo is indexed; `.codegraph/` is untracked per git status).

### Memtrace (local graph + licensed metering)
- Installed as `npm install -g memtrace`; MCP entry point `memtrace mcp` (`mt-cortex`, "Configure one MCP server"); tool names appear to agents as `mcp__memtrace__<tool>` (`docs/README.md` "Important conventions").
- Tool catalogue (`mt-tools`):
  - Index mgmt: `list_indexed_repositories`, `index_directory`, `delete_repository`, `cleanup_stale_records`, `check_job_status`, `list_jobs`.
  - Discovery: `find_symbol` ("Exact / fuzzy lookup by symbol name. Sub-millisecond."), `find_code` ("Hybrid retrieval (BM25 + vector + graph + cross-encoder rerank)"), `get_symbol_context` (callers, callees, community, processes, recent changes), `get_source_window` (bounded span + context lines).
  - Impact: `get_impact` ("Blast radius of changing a symbol"), `find_dependency_path`, `analyze_relationships`.
  - Architecture: `list_communities`, `find_central_symbols`, `find_bridge_symbols`, `get_codebase_briefing`, `get_repository_stats`.
  - Time travel: `get_evolution` (modes recent, impact, novelty, directional, compound, overview), `get_timeline`, `get_changes_since`, `detect_changes`, `get_cochange_context`, `get_episode_replay`, `replay_history`, `cleanup_episodes`.
  - Cortex decision memory: `recall_decision`, `verify_intent`, `get_arc`, `why_is_this_here`, `governing_contracts`.
  - Processes: `list_processes`, `get_process_flow`. API topology: `find_api_endpoints`, `find_api_calls`, `get_api_topology`, `get_service_diagram`. Quality: `find_dead_code`, `calculate_cyclomatic_complexity`, `find_most_complex_functions`. Watch: `watch_directory`, `unwatch_directory`, `list_watched_paths`, `record_external_episode`.
  - `mt-readme` also lists `execute_cypher` and says "25+ MCP tools" and "Cross-service API topology"; `mt-readme` "Memtrace is in private beta" conflicts with the self-serve plans page (Unverified, see section 8).
- What "cortex" is: `mt-cortex`: "Cortex is Memtrace's local memory for decisions, bans, conventions, and governing documents. It is separate from the MemDB code graph." Rebuilding the code graph "does not rebuild Cortex". Tools are published by the normal `memtrace mcp` server; `mt-tools` says never configure a client to launch `memcortex-mcp` directly. Opt out with `MEMTRACE_CORTEX=off` (`mt-faq`).
- Fleet tools (`fleet_*`), `embed_diag`, `mem_diag`, directory trees and repo/job enumeration are not in the `mt-tools` catalogue fetched but are named in `mt-plans` as not billed.

## 2. Strengths and query-type coverage

| Query type | CodeGraph | Memtrace | Source |
|---|---|---|---|
| Exact symbol lookup | yes: `query`, `codegraph_search` | yes: `find_symbol` | `cg-readme`, `mt-tools` |
| Read a file/span with line numbers | yes: `node -f --offset --limit`, `explore` naming the file | yes: `get_source_window` (billable, `mt-search`) | `codegraph node --help`; `mt-search` |
| NL / concept search | `explore` (graph + text; semantic ranking not documented in the fetched README) | `find_code`: BM25 + vector + graph + rerank, indexes string literals and long-function sub-spans | `mt-tools`, env-var doc |
| Callers / callees | yes | yes: `get_symbol_context`, `analyze_relationships` | both |
| Impact / blast radius | `impact` (depth default 2), `affected` tests | `get_impact` (transitive, depth default 2), `find_dependency_path` | both |
| Cross-repo | `projectPath` per repo; no cross-repo edge claim in README | `get_api_topology`, `find_api_calls` ("including across-repo HTTP calls"), workspaces | `mt-tools` |
| Temporal / evolution | none | `get_evolution`, `get_timeline`, `get_changes_since`, `get_cochange_context`, `get_episode_replay` | `mt-tools` |
| Decision memory / provenance | none | Cortex: `recall_decision`, `why_is_this_here`, `governing_contracts` | `mt-cortex` |
| Architecture (communities, PageRank, bridges) | none documented | `list_communities`, `find_central_symbols`, `find_bridge_symbols`, `get_codebase_briefing` | `mt-tools` |
| Dead code / complexity | none documented | `find_dead_code`, `find_most_complex_functions` | `mt-tools` |
| Cost per call | zero, local | metered (section 3) | |

## 3. Memtrace cost and quota model

- Plans (`mt-plans`, "Plans"): Community Free 1,000 graph queries/month "Then a server-set daily allowance (currently 50/day) instead of a hard stop"; Pro $9, 5,000/month; Pro+ $15, 20,000/month; Teams $29/seat, Unlimited. Plan ids `community`, `pro`, `pro_plus`, `teams`. `https://www.memtrace.io/plans` repeats "1,000 graph queries each month, then 50 per day", Pro "No daily throttle". The user's local transcript shows plan `pro_plus` with `monthlyLimit` 20000.
- What is metered (`mt-plans`, "What counts as a query"): a fixed server-synced list of billable MCP tools; "Community's billable list currently has exactly 37 entries"; it names `find_code`, `find_symbol`, `get_symbol_context`, `get_impact`, `analyze_relationships`, `get_evolution`, `get_timeline`, graph algorithms, quality/review, API topology. `mt-search` adds `get_source_window` and `get_style_fingerprint` as billable. Not billed: indexing, watching, `fleet_*`, diagnostics, "repo/job/worktree enumeration, directory trees, repository stats" (`mt-plans`; `list_indexed_repositories`, `get_repository_stats`, `get_directory_tree` per `mt-search`). Cortex: "Retrieval is credit-metered the same way other insight tools are" (`mt-faq`).
- Consequence: a bounded source read (`get_source_window`) and every symbol lookup cost one query each, so routing reads and lookups to Memtrace burns the quota fastest. This is the strongest evidence for the low-risk -> CodeGraph split.
- Hitting the limit (`mt-plans`, "Hitting the limit"): "Memtrace returns a structured quota error instead of the tool result - a machine-readable shape carrying an upgrade URL (memtrace.io/pricing)". The docs do NOT publish the field names, error code, or message text.
- Exact error observed locally (not in the docs; evidence from the installed binary strings and a real session transcript, recorded in `circuit-breaker-auto-restart.md` section 3): `{"error":"quota_exceeded","message":"Monthly query limit reached (21806). Upgrade at https://www.memtrace.io/pricing","quota":{"blocked":true,"dailyLimit":null,"dailyUsed":0,"effectiveMonthlyLimit":21806,"monthlyLimit":20000,"monthlyUsed":21841,"periodEnd":"2026-09-20T00:21:18.000Z","plan":"pro_plus","stressLevel":"blocked","throttleMode":false,"upgradeUrl":"https://www.memtrace.io/pricing","warnAtPct":80}}`. Binary strings (memtrace 1.2.8, `crates/memtrace-mcp/src/quota.rs`) also contain `Daily throttle active (`, `Daily query limit reached (`, `Monthly query limit reached (`. Transcript path: `~/.claude/projects/-Users-trekkie-projects-coincert/16f6699b-31c0-4755-ba76-8b2c81b52e0e.jsonl`. It arrived as a normal (non-error) MCP result, so PostToolUseFailure may not fire.
- Reset time: documented rules (`mt-plans`, "Resetting query credits"): "Monthly usage resets automatically when the account's next quota period begins. Community's daily usage resets at the next UTC day boundary while the account is in throttle mode." The reset instant is exposed to the client only through the observed `quota.periodEnd` ISO timestamp (local evidence, not documented). For Community daily throttle the docs give the next UTC midnight but no field name; whether `periodEnd` then means month end or day end is unverified.
- Out-of-band check without spending a query: `mt-search`: "For remaining query allowance, check the daemon's quota meter in the dashboard UI (backed by `GET /api/quota`)", daemon at `localhost:3030` (`mt-plans`; port `MEMTRACE_UI_PORT`, `environment-variables.md`). `memtrace status` "doesn't include plan or quota usage" (`mt-search`). `curl localhost:3030/api/quota` failed here (Memtrace daemon not running), so the response shape is Unverified.
- Heartbeat: usage is synced to the server by an "authenticated usage heartbeat" that "keeps license and quota state current" and cannot be disabled (`mt-priv`, section 3). Offline: licensed installs boot in degraded mode and "re-validates in the background every 5 minutes" (`mt-faq`). Other availability failures to distinguish from quota: "Authentication expired. Run `memtrace auth login`..." (binary string, local), HTTP 401/403 license rejection (`mt-faq`).
- Support exceptions: support can grant unlimited query access (`mt-plans`); no customer API rewrites counters.

## 4. Defensible split (low-risk -> CodeGraph, heavy -> Memtrace)

Principle: CodeGraph is free and local, so it takes anything whose wrong answer is cheap to detect and whose answer is a lookup on the current tree. Memtrace is reserved for queries only it can answer, or where a miss is costly. Both are inferences from sections 2-3; the tool facts are cited, the threshold is a design choice.

| Query type | Route | Reason |
|---|---|---|
| Find symbol by exact name | CodeGraph `query` / `codegraph_search` | Memtrace `find_symbol` is billable; same answer |
| Read a file or line span | CodeGraph `node -f --offset --limit` | `get_source_window` is billable; the span already counts for the Read carve-out (`memtrace-first-guard.cjs:603`) |
| "Where/how does X work" | CodeGraph `explore` first; escalate to `find_code` if it returns nothing relevant | one free call before one billable call |
| Direct callers/callees, one symbol | CodeGraph `callers`/`callees`/`node` | same |
| Blast radius before an ordinary edit | CodeGraph `impact` + `affected` | free |
| Blast radius of a risky change (public API, shared util, central symbol) | Memtrace `get_impact` (+ `find_bridge_symbols`) | transitive graph with risk rating, a miss costs a regression |
| Git history, churn, "why did this change" | Memtrace `get_evolution`/`get_timeline`/`get_cochange_context` | CodeGraph has none |
| Decisions, bans, conventions | Memtrace Cortex `recall_decision` | CodeGraph has none |
| Cross-repo / API topology | Memtrace `get_api_topology`/`find_api_calls` | CodeGraph has none |
| PR review evidence | Memtrace set (impact, context, `recall_decision`, `find_code_review_issues`) | review is the heavy hit; fallback in section 5 |
| Dead code, complexity, communities | Memtrace | CodeGraph has none |
| Brand-new uncommitted symbols in a worktree | CodeGraph (watcher indexes the tree) or Memtrace `find_code` with `worktree` | the guard text says only `find_code` takes `worktree` (`memtrace-first-guard.cjs:1297`) |

## 5. Quota-aware fallback design

State file (already the path in code): `~/.claude/state/memtrace-quota.json`, override env `MEMTRACE_QUOTA_STATE` (`memtrace-quota-state.cjs:17-19`). Proposed schema (superset of the existing `{blocked, ts, until}` at `:50`):

`{"v":1,"blocked":true,"reason":"monthly|daily|auth|unreachable","ts":<ms>,"until":<ms>,"untilSource":"periodEnd|nextUtcMidnight|fallback","plan":"pro_plus","monthlyUsed":..,"monthlyLimit":..,"upgradeUrl":"..","probeAfter":<ms>,"probes":<n>}`

- Write (PostToolUse + PostToolUseFailure on `mcp__memtrace__.*`, already registered in `~/.claude/settings.json`, 2 hits for `memtrace-quota-watch`): detect via `error==="quota_exceeded"`, `quota.blocked===true`, or the message prefixes (`memtrace-quota-state.cjs:28-34`). `until` = parsed `quota.periodEnd` capped at 24 h (`:50`), else now+1 h (`:15`). Proposed changes: when `throttleMode:true` or message starts `Daily`, use next UTC midnight (documented rule `mt-plans`) rather than a month-end `periodEnd`; keep the 24 h cap off so a month-long block is not re-probed daily at cost... or keep the cap but make the re-probe free (below).
- Read: every guard that mentions Memtrace calls `isBlocked()` (`:58-63`): true only while `blocked && until > now`. Add `cooldownInfo()` returning `{until, minutesLeft, untilIso}` so messages can say "Memtrace is out of quota until 2026-10-14T00:00Z (about 9 h); use CodeGraph".
- Expiry and probe: after `until` the state auto-expires (current behavior: `isBlocked` false). Probe with a free call first: `GET http://localhost:<MEMTRACE_UI_PORT or 3030>/api/quota` (documented as the meter's backend; response shape Unverified, so the probe must treat any parse failure as "unknown, do one real call"). If unknown, the next Memtrace call is the probe; a failure re-writes the file with `probes+1` and exponential backoff (1 h, 2 h, 4 h, capped at the next `periodEnd`). A normal Memtrace answer clears the file (already done, `memtrace-quota-watch.cjs:35-37`).
- Stop retry storms: PreToolUse on `mcp__memtrace__.*` (new, matcher in settings): while `isBlocked()`, deny with the CodeGraph route plus the return time, except the billable-free tools (`list_indexed_repositories`, `get_repository_stats`, `get_directory_tree`) and except when `probeAfter <= now` (let exactly one call through, write `probeAfter = now+60 s` first to serialize concurrent agents). Today nothing prevents agents re-calling Memtrace (the watch only adds context after the call).
- Auth/offline are separate cooldowns (`reason`), shorter (5 min, matching the documented 5-minute revalidate, `mt-faq`).
- opencode: the adapter at `claude-guards/opencode/guard-adapter.js` runs the same scripts on `tool.execute.before`; PostToolUse equivalents are not covered by it (Unverified, not read for this note).

## 6. Local ground truth

Git history for the guards (`git log --oneline -- claude-guards/hooks`, top): 4060f2a breaker auto-restarts, reaper spares live worktrees (#30; added `memtrace-quota-state.cjs` and `memtrace-quota-watch.cjs`); 8c7d31a a `codegraph_node` file read counts as the read (#29); d8810d0 name the CodeGraph equivalent of each Memtrace tool (#28); fa75e37, f97efbc, 7fbce79, a64dcf4, 115b112, 883da75 (span-exact reads, subagent transcripts), 55848cc, abbb521, d4d6fed, 7f390b2 (point restricted subagents at the `mt` CLI), eb37b53, aa473a4, 0d5d909.

What exists:
- `memtrace-quota-state.cjs` (72 lines): shared state with `responseIsQuotaBlocked`, `periodEndOf`, `markBlocked`, `clearBlocked`, `isBlocked`, `CODEGRAPH_ROUTE`. `until` is the parsed `periodEnd` capped at 24 h, else a 1 h fallback (`:15`, `:44-52`). So a cooldown with a return time exists in the file, but the return time is never shown to the agent; `CODEGRAPH_ROUTE` (`:65-70`) says "until it resets" with no time.
- `memtrace-quota-watch.cjs` (40 lines): PostToolUse + PostToolUseFailure on `mcp__memtrace__.*`; marks blocked and emits `additionalContext` ("GUARD-BREAKER: ..."); clears on a normal response. Registered in `~/.claude/settings.json`. Not mentioned in `claude-guards/README.md` (grep for "quota" returns nothing there).
- `memtrace-first-guard.cjs` (1385 lines, header says 1.6.2/1.7.1): denies Read/Grep/Glob/Bash on indexed source; `denyOutput` (`:1284-1320`) prepends `quotaPrefix()` (`:1277-1282`) when blocked, then still says "Use Memtrace instead" (`:1292-1296`) and carries the full CodeGraph table (`CODEGRAPH_FALLBACK_TEXT`, `:1258-1274`). Carve-out: a Read is allowed for a span returned by `get_source_window` or by `codegraph_node` file mode (`:603-606`, `:649-700`, main at `:1347-1353`).
- `memtrace-capable-dispatch-guard.cjs` (86 lines): in `~/projects/gsd-core` only, denies sonnet-coder/haiku-scout/haiku-importer because they "have no Memtrace tools" (`:61-79`); text mentions CodeGraph CLI as an "if unavailable" fallback; never checks quota state.
- `gsd-core-hooks/hooks/require-memtrace-evidence.sh`: gate on `gh pr review --approve|--request-changes`; accepts `### CodeGraph Evidence` only with a line `Memtrace unavailable: <reason>` (`:71-74`) plus `codegraph impact` and `callers|callees|node` mentions (`:75-81`). It never reads the quota file; the "unavailable" claim is self-attested, as is any text mention of the commands.
- Tests: `guard-denial-breaker.test.sh:81-90` covers the quota watch (blocked -> context, state recorded, breaker routes, success clears). `memtrace-first-guard.test.sh` has zero quota/codegraph-quota cases (grep returned none). `memtrace-capable-dispatch-guard.test.sh` not checked for quota (guard has none). No test for `require-memtrace-evidence.sh` quota behavior was found in the file list.
- Note: the guard text cites `docs/research/codegraph-fallback-equivalents.md` (`memtrace-first-guard.cjs:1265`); that file is not in `docs/research/` on this branch (the directory contains four other files). Dangling reference.

## 7. Gaps against the goal

1. The first-guard forces Memtrace first for low-risk reads: any Read/Grep/Glob/Bash on indexed source is denied unless a prior `get_source_window` span exists (`:1347-1353`); the deny reason leads with "Use Memtrace instead" even for a plain `find_symbol`-class lookup (`:1292`). A CodeGraph `explore` or `query` call is not the "sanctioned first path"; only `codegraph_node` file-mode counts as a read proof. Net: reads cost Memtrace quota by default.
2. When quota is blocked the guard still denies a Read of source unless the agent first runs a CodeGraph file-mode read (works, but only via the message). No automatic allow.
3. Known gap (previous attempt): when Memtrace is unavailable AND the repo has no `.codegraph/` index, the guard still denies (it checks nothing about `.codegraph/`, and `isBlocked` only changes the message prefix, `:1277-1282`). It should allow the direct read with a one-line message ("no CodeGraph index and Memtrace unavailable; reading directly; run `codegraph init` if you want an index"). Condition to detect: `<toplevel>/.codegraph/` missing (and no index at the git common dir for worktrees) AND (`isBlocked()` OR no `mcp__memtrace__` tool in the session).
4. No PreToolUse deny on `mcp__memtrace__*` while blocked: agents can and do keep retrying (the watch only informs after the call).
5. The cooldown has `until` but the return time is not in any message, and the daily-throttle case is mis-timed (uses `periodEnd`, which for a daily block may be month-end; documented reset is next UTC day, `mt-plans`). `untilSource` is not recorded.
6. No free probe: expiry means "try again with a billable call". `GET /api/quota` could probe without spending a query (shape Unverified).
7. `require-memtrace-evidence.sh` never checks the marker; the "Memtrace unavailable:" line can be written without any real outage; no check that the CodeGraph commands were actually run. Also it demands `find_code_review_issues` and `recall_decision`, which have no CodeGraph equivalent; a legitimate quota outage passes only by a free-text waiver.
8. `memtrace-capable-dispatch-guard.cjs` denies the cheap agent types (haiku-scout etc.) even when Memtrace is blocked or when the task is a CodeGraph-only lookup; in a quota outage the right move is to allow them and brief them on the CodeGraph CLI.
9. Skills and commands still say Memtrace-first: `commands/*.md` mention Memtrace 104 times in total (grep count); `cost-routing`/`cost-tier-routing` skills and the `review-open-prs` command should carry the split in section 4.
10. `claude-guards/README.md` omits the quota hooks; `memtrace-first-guard.test.sh` lacks quota and no-index cases.
11. Dangling reference to `docs/research/codegraph-fallback-equivalents.md` (`memtrace-first-guard.cjs:1265`).

## 8. Unverified

- Exact quota error schema/text in official docs: `mt-plans` says only "structured quota error"; fields above come from one local transcript and binary strings of memtrace 1.2.8. Settle with: Memtrace source (`crates/memtrace-mcp/src/quota.rs`, cited in `mt-priv` only for `telemetry.rs`; the public repo may not ship it) or a captured response from a Community and a Pro account.
- Whether `quota.periodEnd` is the month end for monthly blocks and the next UTC day for Community throttle: settle by capturing a Community-throttled response (`"throttleMode":true`).
- `GET /api/quota` response fields: daemon was not running (curl exit 7). Settle with `memtrace start` then `curl localhost:3030/api/quota`.
- Whether MCP quota errors set `isError` on the MCP result: the one transcript lacks `is_error`; PostToolUseFailure firing is not guaranteed.
- Memtrace "Cortex" has no separate quota (`mt-plans`, "Cortex is universal") but how many credits a `recall_decision` costs is unstated.
- The full list of the 37 billable tools: only examples are published.
- CodeGraph: README line numbers (fetch tool gave none); whether `codegraph_explore` does semantic/NL ranking beyond name+text matching (README text fetched does not claim embeddings); cross-repo edges (none claimed); the 20 vs 34 language count is inconsistent within the README itself (immaterial here).
- Memtrace README says "private beta ... waitlist" while `https://www.memtrace.io/pricing` offers self-serve Community licenses; plan data above comes from the docs site, which is newer in tone, but the README could be stale.
- opencode adapter behavior for PostToolUse quota hooks was not read for this note.
- The `mt` CLI name mentioned in commit 7f390b2 was not checked against `memtrace --help` (binary absent from PATH).

## 9. Change list

1. `claude-guards/hooks/memtrace-quota-state.cjs`: add `reason`, `untilSource`, `plan`, `probeAfter`, `probes`, `upgradeUrl` to the state; parse Daily/`throttleMode` -> next UTC midnight; add `cooldownInfo()` and `probeDue()` (serialized with a pre-written `probeAfter`); put the ISO return time in `CODEGRAPH_ROUTE`; keep fail-open; add an optional free probe of `http://localhost:${MEMTRACE_UI_PORT:-3030}/api/quota` with strict parse-or-ignore.
2. `claude-guards/hooks/memtrace-quota-watch.cjs`: pass through the new fields; include the return time in `additionalContext`; also handle auth-expired/unreachable as a short separate cooldown.
3. New `claude-guards/hooks/memtrace-quota-gate.cjs` (PreToolUse, matcher `mcp__memtrace__.*`, register at user scope next to the watch): while blocked and `probeDue()` false, deny with the CodeGraph route and "back at <time>"; allow the unbilled tools and one probe after expiry. Plus a `.test.sh`.
4. `claude-guards/hooks/memtrace-first-guard.cjs`: (a) reorder the deny text to lead with CodeGraph for lookups/reads (low-risk) and name Memtrace only for history, decisions, cross-repo, risky impact; (b) when `isBlocked()` or no memtrace tools, accept any `codegraph explore|node|query` Bash/MCP call that names the file as the read proof, not only `codegraph_node` file mode; (c) no-index case (gap 3): if `.codegraph/` is absent for the toplevel/common dir AND Memtrace is blocked/unavailable, return allow with a visible message instead of deny; (d) bump header version, fix the dangling doc cite (`:1265`).
5. `claude-guards/hooks/memtrace-first-guard.test.sh`: add cases for blocked-state allow, no-index allow, blocked + indexed still routes to CodeGraph, return time present in text.
6. `claude-guards/hooks/memtrace-capable-dispatch-guard.cjs` (+ test): allow haiku/sonnet agent types when `isBlocked()`, and add the CodeGraph CLI brief plus the return time to the deny text otherwise.
7. `gsd-core-hooks/hooks/require-memtrace-evidence.sh` (+ test): replace the self-attested line with a check of `~/.claude/state/memtrace-quota.json` (`blocked && until>now`); accept `### CodeGraph Evidence` only when the marker is live (or the user waiver file exists), else deny with "Memtrace is not in cooldown; run the Memtrace tools"; print the return time; keep the equivalents check. Duplicate-free alternative: have this hook `node -e` require `memtrace-quota-state.cjs` from a shared path.
8. `claude-guards/README.md`: document the quota watch, gate, state file schema, env `MEMTRACE_QUOTA_STATE`, and the low-risk/heavy split table from section 4.
9. Skills/commands: `commands/review-open-prs.md`, `commands/bug-fixer.md`, `commands/feature-builder.md`, `commands/triage-review.md`: replace "Memtrace first" for lookups with the section 4 split; `cost-routing/SKILL.md` and `cost-tier-routing/SKILL.md`: add a routing row "code lookup -> CodeGraph, history/decisions/cross-repo -> Memtrace" and "if the quota marker is live, never call Memtrace".
10. `gsd-core-hooks/README.md`: note the evidence gate now reads the marker.
11. Optional: restore or create `docs/research/codegraph-fallback-equivalents.md`, or remove the reference.
