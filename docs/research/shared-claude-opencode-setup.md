# Sharing skills, global instructions, commands and hooks between Claude Code and opencode on one machine, by symlink

Date: 2026-10-13. Local versions: opencode 2.0.25 (`/opt/homebrew/Cellar/opencode/2.0.25`), Claude Code as installed on this machine.
Docs cites: Claude Code memory https://code.claude.com/docs/en/memory (`mem`), skills https://code.claude.com/docs/en/skills (`sk`), hooks https://code.claude.com/docs/en/hooks (`hk`); opencode rules https://opencode.ai/docs/rules/ (`oc-rules`), skills https://opencode.ai/docs/skills/ (`oc-skills`), plugins https://opencode.ai/docs/plugins/ (`oc-plug`), commands https://opencode.ai/docs/commands/ (`oc-cmd`). Source cites are GitHub `anomalyco/opencode` (the `sst/opencode` repo now resolves to it; `gh api repos/sst/opencode` returns `anomalyco/opencode`), read via the contents API: tag `v1.19.0` ("v1 source", latest tagged release, published 2026-10-11) and the `dev` branch ("dev source", the `packages/core` rewrite that the 2.x binary appears to come from). Repo cites are paths under `/Users/trekkie/projects/skills-from-the-artificer`. Nothing was installed or changed on the machine; the only file written is this one.

## 0. Recommendation in one screen

1. Instructions: make `~/.claude/CLAUDE.md` the single real file and replace `~/.config/opencode/AGENTS.md` (currently a byte-identical copy, `cmp` confirmed) with a symlink to it. Do not rely on opencode's fallback to `~/.claude/CLAUDE.md`: it exists in v1 source and docs, but I found no such fallback in the dev (2.x) source.
2. Skills: do nothing for the Claude side; opencode already scans `~/.claude/skills` and `~/.agents/skills`, following symlinks. Keep `~/.agents/skills/<name>` as the canonical layer (it already is: `~/.claude/skills/*` are symlinks to `../../.agents/skills/*`) and point this repo's skill folders into `~/.agents/skills/`.
3. Commands: symlink `commands/*.md` into both `~/.claude/commands/` and `~/.config/opencode/commands/`; keep frontmatter to the shared subset (`description` plus body with `$ARGUMENTS`).
4. Hooks: no shared hook config exists. Keep one set of guard scripts (the existing `claude-guards/hooks/*`) and add ONE opencode plugin adapter, symlinked into `~/.config/opencode/plugins/`, that translates `tool.execute.before` into the Claude PreToolUse stdin JSON, runs the same script, and throws on a deny. Port only PreToolUse-style guards; the Stop, SubagentStop, SessionStart and transcript-based guards have no documented opencode equivalent.
5. Housekeeping found on the way: `~/.config/opencode/opencode.json` has a plaintext bearer token in the `mcp.github.headers` block (value deliberately not reproduced here). Move it to an environment reference or secret store.

## 1. Global instructions

### 1.1 Where each tool reads them

| Tool | User-scope file | Project files | Cite |
|---|---|---|---|
| Claude Code | `~/.claude/CLAUDE.md` (also `~/.claude/rules/`) | `./CLAUDE.md`, `./.claude/CLAUDE.md`, `CLAUDE.local.md`; `AGENTS.md` only when no CLAUDE.md exists above the working dir | mem lines "Project instructions" table, "AGENTS.md" section |
| opencode | `~/.config/opencode/AGENTS.md` | `AGENTS.md`, walking up to the worktree root | oc-rules |

Claude Code does not read `~/.config/opencode/AGENTS.md` by itself. The memory page says `~/.claude/CLAUDE.md` is a user-scope file and "Don't count" toward the CLAUDE.md-or-AGENTS.md decision (mem, "When Claude Code reads AGENTS.md"). So the share has to be opencode pointing at, or linked to, the Claude file, or a Claude `@import` of the opencode file.

### 1.2 Does opencode fall back to `~/.claude/CLAUDE.md`?

Docs (oc-rules): global `~/.claude/CLAUDE.md` is "used only if `~/.config/opencode/AGENTS.md` does not exist"; project `CLAUDE.md` is used only if no `AGENTS.md` exists; "The first matching file wins in each category."

v1 source (`packages/opencode/src/session/instruction.ts` @ v1.19.0, lines 60-64 and 115-121):
```
const globalFiles = [ path.join(global.config, "AGENTS.md"),
  ...(!flags.disableClaudeCodePrompt ? [path.join(global.home, ".claude", "CLAUDE.md")] : []) ]
...
for (const file of globalFiles) { if (yield* fs.existsSafe(file)) { paths.add(path.resolve(file)); break } }
```
So confirmed in v1: AGENTS.md wins, CLAUDE.md is read only when AGENTS.md is absent, and exactly one global file is loaded (the `break`). The project-level walk is `AGENTS.md`, then `CLAUDE.md`, then deprecated `CONTEXT.md`, first hit wins (same file, lines 64-68, 122-133).

Dev source (`packages/core/src/config/plugin/instruction.ts` @ dev): the global candidate is only `join(global.config, "AGENTS.md")` and the project walk only joins `AGENTS.md`. A code search of `packages/core/src` for "CLAUDE.md" returned only a prompt text file (`plugin/command/initialize.txt`). So in the 2.x rewrite the CLAUDE.md fallback appears to be gone, or lives somewhere I did not read. I could not confirm which source tag built the installed 2.0.25 binary (see section 6). Consequence: an explicit `AGENTS.md` symlink is safe in both worlds; the implicit fallback is not.

### 1.3 Env flags that disable the fallback

From `packages/opencode/src/effect/runtime-flags.ts` @ v1.19.0 lines 21-29 and oc-rules:

| Variable | Effect |
|---|---|
| `OPENCODE_DISABLE_CLAUDE_CODE` | Disables all `.claude` support (prompt and skills) |
| `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT` | Disables only `~/.claude/CLAUDE.md` (and project `CLAUDE.md`) |
| `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS` | Disables only `.claude/skills` |
| `OPENCODE_DISABLE_EXTERNAL_SKILLS` | v1 source only (not on oc-skills): disables both `.claude` and `.agents` skill scanning |

An explicit `~/.config/opencode/AGENTS.md` symlink keeps working under all four, which is why it beats the fallback.

### 1.4 `@imports` and `instructions`

Claude Code: `@path/to/import` in CLAUDE.md, relative to the containing file, absolute paths allowed, recursion up to four hops, skipped inside code spans and fences (mem, "Import additional files"). User-scope files (`~/.claude/CLAUDE.md`) load imports without the approval dialog. Claude can also import an AGENTS.md ("Share one file with other coding tools" section, mem). One caveat: in desktop Cowork sessions, Claude "skips a `~/.claude/CLAUDE.md` that is itself a symlink or hard link" (mem, line about Cowork); Claude Code CLI is unaffected.

opencode `instructions` array in `opencode.json` (oc-rules): relative paths, globs (`packages/*/AGENTS.md`), and remote URLs (5 second fetch timeout); "All instruction files are combined with your `AGENTS.md` files." v1 source (instruction.ts lines 135-150): entries starting `~/` are expanded against home; absolute paths are globbed by basename within the dirname; relative ones are globbed upward from the project; `http(s)://` entries are fetched. So `"instructions": ["~/.claude/CLAUDE.md"]` WOULD work as a path, but it is additive to the AGENTS.md/fallback file, so with the fallback active (and no AGENTS.md) the same file would load twice. Prefer the symlink and leave `instructions` for extra shared files.

opencode has no `@import` syntax for AGENTS.md that I could find in the docs. A CLAUDE.md that uses `@path` imports will show those literal `@path` lines to opencode (it does not expand them), so keep the shared file free of imports, or inline the imported content.

### 1.5 Local state

- `~/.claude/CLAUDE.md` (806 bytes) and `~/.config/opencode/AGENTS.md` (806 bytes) are byte-identical regular files; both are just the CodeGraph block. Two copies that will drift.
- `~/.claude/commands` and `~/.claude/hooks` do not exist (see 3.4).

## 2. Skills and commands

### 2.1 Locations

| | Claude Code (sk) | opencode (oc-skills; v1 source skill/index.ts) |
|---|---|---|
| Global | `~/.claude/skills/<name>/SKILL.md` | `~/.config/opencode/skills/`, `~/.claude/skills/`, `~/.agents/skills/` |
| Project | `.claude/skills/` (and nested `<subdir>/.claude/skills/`) | `.opencode/skills/`, `.claude/skills/`, `.agents/skills/`, walked up to the git root |
| Extra | plugins, `--add-dir` | `skills.paths` (supports `~/`) and `skills.urls` in `opencode.json` (v1 source lines 205-228) |
| `~/.agents/skills` | Not read (the sk table lists no such path) | Read |

Note the asymmetry: opencode reads `~/.agents/skills`, Claude Code does not. That is why the existing layout (real folders in `~/.agents/skills`, per-skill symlinks in `~/.claude/skills`) is the right direction.

### 2.2 Symlinks

- Claude Code: "A `<skill-name>` entry in the enterprise, personal, or project location can be a symlink to a directory elsewhere on disk ... If several locations point to the same target, the skill loads once" (sk, "Symlinks"). Per-skill symlinks are supported; a symlinked `skills/` parent directory is not mentioned, so use per-skill links as the machine already does.
- opencode: the page oc-skills is silent. Source: v1 `Glob.scan(pattern, { ..., symlink: true, dot })` (skill/index.ts lines 150-155) and dev `scan("{*.md,**/SKILL.md}", { ..., symlink: true })` (`packages/core/src/config/plugin/compatibility.ts`). The `symlink: true` option is passed in both; I take it to mean symlinks are followed but did not read the glob implementation, so that is listed as unverified in section 6. The empirical check is trivial (`opencode` then ask it to list skills), and this machine's `~/.claude/skills` is already all symlinks.

### 2.3 Frontmatter differences

| Field | Claude Code (sk) | opencode (oc-skills) |
|---|---|---|
| `name` | optional, defaults to directory name | required; must equal directory name; `^[a-z0-9]+(-[a-z0-9]+)*$`, 1-64 chars |
| `description` | recommended | required, 1-1024 chars |
| `license`, `compatibility`, `metadata` | informational | accepted |
| Claude-only: `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, `disallowed-tools`, `model`, `effort`, `context`, `agent`, `hooks`, `paths`, `shell` | honored | Not documented. Whether unknown keys are ignored or reject the skill was not confirmed |
| opencode-only: `metadata.opencode/slash`, `metadata.opencode/autoinvoke` | ignored (it is plain `metadata`) | slash exposes the skill as a `/name` command; autoinvoke `"false"` hides it from auto selection |

Practical rule for shared skills: always set `name` equal to the directory name and a `description`, use lowercase-hyphen names (every top-level folder in this repo already does), and treat Claude-only keys as safe only after a smoke test (section 6). `${CLAUDE_SKILL_DIR}` and `$ARGUMENTS`-style substitutions are Claude body features; opencode will pass them through as literal text.

Duplicate names: oc-skills' checklist requires a "unique name across all locations". Because `~/.claude/skills/x` and `~/.agents/skills/x` are the same skill reachable by two paths in opencode's scan, expect either a harmless dedupe or a duplicate warning; how it resolves was not confirmed. If it warns, set `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1` so opencode reads only `~/.agents/skills` (the canonical layer), which loses nothing here.

### 2.4 Slash commands

| | Claude Code | opencode |
|---|---|---|
| Location | `~/.claude/commands/*.md`, `.claude/commands/`; legacy, still works, "accept the same frontmatter" as skills except `name` and `paths`; subdirectories become `dir:name` (sk "Relation to .claude/commands") | `~/.config/opencode/commands/`, `.opencode/commands/` (oc-cmd); dev source scans `{command,commands}/**/*.md` with `symlink: true` (`config/plugin/command.ts`) |
| Frontmatter | skill frontmatter (`description`, `allowed-tools`, `argument-hint`, `model` ...) | `description`, `agent`, `model`, `subtask`; body is the template |
| Args | `$ARGUMENTS`, `$N` | `$ARGUMENTS`, `$1 $2 ...` |
| Injection | `` !`cmd` `` | `` !`cmd` `` and `@file` |
| Reads the other's dir? | n/a | oc-cmd does not mention `~/.claude/commands`; treat as not read |

So one `.md` file can serve both if it uses only `description` plus a body with `$ARGUMENTS`. This repo's `commands/*.md` carry tool-list frontmatter ("All but `review-open-prs.md` carry frontmatter declaring the tools they may touch", `commands/README.md`); opencode ignores or may mis-handle unknown keys (unverified). Alternative with verified documentation: make them skills with `metadata: { "opencode/slash": "true" }`, which exposes `/name` in opencode and still works in Claude (a skill creates `/name` as well, sk).

## 3. Hooks

### 3.1 Claude Code

Settings-file hooks (`~/.claude/settings.json`, project `.claude/settings.json`, `settings.local.json`, plugin `hooks/hooks.json`, skill and subagent frontmatter) (hk, "Settings file locations"). Events include `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PostToolBatch`, `Stop`, `SubagentStop`, `PreCompact`, `Notification`, `FileChanged`, and many more (hk, event list). Command hooks receive JSON on stdin: common `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`; PreToolUse adds `tool_name`, `tool_input`, `tool_use_id`. Exit 0 with JSON stdout applies the fields; exit 2 is a blocking error and on PreToolUse stderr is the reason; any other code is non-blocking. Deny form: exit 0 and `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}`. Matchers: bare names or `A|B`, otherwise unanchored JS regex; MCP tools are `mcp__server__tool` (all hk). Stop-style continuation semantics (block, `stop_hook_active`, 8-continuation cap) are covered in `docs/research/circuit-breaker-auto-restart.md`.

### 3.2 opencode

Hooks are JS/TS plugins, not config entries (oc-plug): auto-loaded from `~/.config/opencode/plugins/` and `.opencode/plugins/`, plus npm packages in the `plugin` array of `opencode.json`. v1 source loads `{plugin,plugins}/*.{ts,js}` (`packages/opencode/src/config/plugin.ts` @ v1.19.0, line 21), so the singular `plugin/` directory also works. Load order: global config, project config, global dir, project dir; all hooks run in sequence. Shape:

```js
export const MyPlugin = async ({ project, client, $, directory, worktree }) => ({
  "tool.execute.before": async (input, output) => { /* input.tool, output.args */ },
})
```
`$` is Bun's shell helper. Events (oc-plug) include `tool.execute.before`, `tool.execute.after`, `shell.env`, `session.created`, `session.idle`, `session.error`, `session.compacted`, `message.updated`, `permission.asked`, `permission.replied`, `file.edited`, `command.executed`, `tui.*`. v1 types (`packages/plugin/src/index.ts` @ v1.19.0): `tool.execute.before(input: {tool, sessionID, callID}, output: {args})` and `tool.execute.after(input: {tool, sessionID, callID, args}, output: {title, output, ...})`.

Blocking a call: the oc-plug page does not state the rule but its own `.env` example throws `new Error("Do not read .env files")` inside `tool.execute.before`; that is the only documented deny mechanism. There is no exit-code protocol, no `ask` or `defer`, and I found no documented way to rewrite arguments other than mutating `output.args` (unverified that mutation is honored).

### 3.3 Is a shared hook model feasible?

Partly. Same idea, different transport:

| Concern | Claude Code | opencode | Shareable? |
|---|---|---|---|
| Pre-tool guard | PreToolUse command, JSON stdin, exit 2 or deny JSON | `tool.execute.before` JS, throw | Yes, via an adapter |
| Tool names | `Bash`, `Read`, `Edit`, `Write`, `Grep`, `Glob`, `Agent`, `mcp__s__t` | lowercase `bash`, `read`, `edit`, `write`, ... (the oc-plug example tests `input.tool === "read"`); MCP naming unverified | Needs a name map |
| Arg names | `tool_input.command`, `file_path` | `args.command`, `args.filePath` (oc-plug example) | Needs a field map |
| Post-tool | PostToolUse | `tool.execute.after` | Yes, feedback-only |
| Session start | SessionStart (can inject context, run scripts) | `session.created` event | Side effects yes, context injection not documented |
| Stop-block continuation | Stop / SubagentStop `decision:block` | `session.idle` is an observation event; no documented "force continue" | No |
| Prompt submit | UserPromptSubmit | `tui.prompt.append` (TUI only), no documented equivalent | No |
| Transcript access | `transcript_path` file | none documented | No |
| Subagent scoping | `agent_id`, SubagentStop | unverified whether plugin hooks fire inside subagent sessions | Unknown |

Recommended design: a single Node/shell guard core stays in this repo (as today), plus a thin adapter per tool.

- Claude adapter: none; `settings.json` points straight at the script (as today).
- opencode adapter: one plugin file, e.g. `claude-guards/opencode/guard-adapter.js`, symlinked into `~/.config/opencode/plugins/`. On `tool.execute.before` it builds `{hook_event_name:"PreToolUse", session_id, cwd: directory, tool_name: map(input.tool), tool_input: mapArgs(output.args)}`, spawns each registered guard (`node guard.cjs`), pipes the JSON to stdin, and if the child exits 2 or prints `permissionDecision:"deny"`, throws `new Error(reason)`. Guards then need no change at all, and the deny text a model sees stays identical.

Untested sketch, for shape only:
```js
import { spawnSync } from "node:child_process"
const GUARDS = [`${process.env.HOME}/.claude/hooks/zsh-guard.cjs`]       // same files Claude runs
const NAME = { bash: "Bash", read: "Read", edit: "Edit", write: "Write", grep: "Grep", glob: "Glob" }
export const Guards = async ({ directory }) => ({
  "tool.execute.before": async (input, output) => {
    const a = output.args ?? {}
    const payload = JSON.stringify({ hook_event_name: "PreToolUse", session_id: input.sessionID, cwd: directory,
      tool_name: NAME[input.tool] ?? input.tool, tool_input: { ...a, file_path: a.filePath ?? a.file_path } })
    for (const g of GUARDS) {
      const r = spawnSync("node", [g], { input: payload, encoding: "utf8" })
      let reason = r.status === 2 ? r.stderr : ""
      try { const j = JSON.parse(r.stdout || "{}"); if (j.hookSpecificOutput?.permissionDecision === "deny") reason = j.hookSpecificOutput.permissionDecisionReason } catch {}
      if (reason) throw new Error(reason)
    }
  },
})
```
Gaps to be honest about: (a) in-process JS spawning a process per tool call adds latency; (b) fail-open on adapter errors is the safer default; (c) Claude-specific env vars (`CLAUDE_PROJECT_DIR`, `CLAUDE_CODE_*`) are absent under opencode, so guards that read them need a default.

### 3.4 Local state and which guards are Claude-specific

- `~/.claude/settings.json` hooks section currently holds exactly one entry: `UserPromptSubmit` running `codegraph prompt-hook`. That is a Claude-only event with no opencode equivalent. `~/.claude/hooks/` does not exist on this machine, so the guards described in `claude-guards/README.md` are not currently installed or registered here (the README says they are symlinked into `~/.claude/hooks/` and registered at user scope; that has not been done on this checkout of the machine).
- Classification below is from `grep` for `transcript_path`, `SubagentStop`, `CLAUDE_`, `Agent`/`mcp__ccd` and hook output shape across `claude-guards/hooks/`; each file still needs a read before porting.

| Guard (claude-guards/hooks) | Event | Portable to opencode? |
|---|---|---|
| `zsh-guard.cjs` (Bash text analysis) | PreToolUse Bash | Yes, pure command-string check |
| `block-ci-rerun-guard.cjs`, `measure-dont-infer-guard.cjs` | PreToolUse Bash | Likely yes (reads command only; verify) |
| `worktree-guard.cjs` | PreToolUse Write/Edit | Likely yes; needs the file-path field map |
| `no-defer-guard.js` | PreToolUse Bash + `mcp__ccd_session__spawn_task` | Bash half yes; the matcher names a Claude desktop tool that does not exist in opencode |
| `block-timeout-increase-guard.cjs`, `tier-guard.cjs` | PreToolUse Write/Edit | Partly; both reference `CLAUDE_`/transcript state, so no until reviewed |
| `memtrace-first-guard.cjs`, `memtrace-quota-watch.cjs`, `memtrace-capable-dispatch-guard.cjs` | PreToolUse + Claude tool names | Claude-specific (names Memtrace/CodeGraph tool mappings, transcript) |
| `agent-dispatch-guard.cjs` | PreToolUse `Agent` | Claude-specific (Claude's Agent tool) |
| `guard-denial-breaker.cjs`, `guard-restart-stop.cjs`, `guard-trip-lib.cjs` | PreToolUse + Stop | Claude-specific (Stop-block continuation, `stop_hook_active`) |
| `run-incomplete-guard.cjs`, `subagent-output-cap.cjs` | Stop / SubagentStop | Claude-specific |
| `pr-claim-verifier.cjs` | uses transcript | Claude-specific |
| `session-model.cjs`, `worktree-reap.sh`, `gsd-claudemd-symlink.sh` | SessionStart / PostToolUse Bash | `worktree-reap.sh` is plain bash and could run from `session.created` plus `tool.execute.after`; the other two are Claude/GSD-specific |
| `gsd-core-hooks/hooks/*` | various | One project's workflow suite (README says "documenting one project's suite"); treat as Claude-specific, port individually if wanted |

## 4. Recommended symlink layout

Canonical sources and what links to them:

```
~/.claude/CLAUDE.md                          real file (canonical; keep free of @imports)
~/.config/opencode/AGENTS.md  -> ~/.claude/CLAUDE.md      # replaces the identical copy

~/.agents/skills/<name>/                     real folders (canonical, already 39 there)
~/.claude/skills/<name>       -> ../../.agents/skills/<name>   # already in place (28 links)
(opencode reads ~/.agents/skills directly; no extra links)

/Users/trekkie/projects/skills-from-the-artificer/<skill>/   # repo folders with SKILL.md (33 detected)
~/.agents/skills/<skill>      -> /Users/trekkie/projects/skills-from-the-artificer/<skill>

/Users/trekkie/projects/skills-from-the-artificer/commands/*.md
~/.claude/commands/<n>.md            -> repo commands/<n>.md      # documented in commands/README.md
~/.config/opencode/commands/<n>.md   -> repo commands/<n>.md

/Users/trekkie/projects/skills-from-the-artificer/claude-guards/hooks/*   # guards
~/.claude/hooks/<n>           -> repo claude-guards/hooks/<n>     # as claude-guards/README.md describes
~/.config/opencode/plugins/guard-adapter.js -> repo claude-guards/opencode/guard-adapter.js   # new file, not yet written
```

Commands to run (not executed; review first):
```bash
ln -sfn ~/.claude/CLAUDE.md ~/.config/opencode/AGENTS.md          # replaces the copy
mkdir -p ~/.claude/commands ~/.config/opencode/commands
for f in "$PWD"/commands/*.md; do [ "$(basename "$f")" = README.md ] && continue
  ln -sfn "$f" ~/.claude/commands/; ln -sfn "$f" ~/.config/opencode/commands/; done
for d in "$PWD"/*/; do [ -f "$d/SKILL.md" ] && ln -sfn "${d%/}" ~/.agents/skills/"$(basename "$d")"; done
# then the per-skill ~/.claude/skills links the same way, so Claude Code sees them:
for d in "$PWD"/*/; do [ -f "$d/SKILL.md" ] && ln -sfn ../../.agents/skills/"$(basename "$d")" ~/.claude/skills/"$(basename "$d")"; done
```
Notes: `ln -sfn` onto an existing real file replaces it, so back up `AGENTS.md` first (it is identical to CLAUDE.md, so nothing is lost). Skill folders whose name does not match their `name:` frontmatter will fail opencode's name rule; check with a grep before linking. If opencode warns on duplicate skill names, add `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1` to the shell profile.

## 5. Why not the alternatives

- opencode `instructions: ["~/.claude/CLAUDE.md"]` instead of a symlink: works in v1 source (`~/` expansion, instruction.ts lines 135-150) but double-loads whenever the fallback is also active, and relies on the config key surviving 2.x (not checked).
- Claude `@~/.config/opencode/AGENTS.md` import instead: supported (user-scope imports load without a dialog, mem), but then CLAUDE.md is no longer the thing opencode shares, and Cowork sessions skip out-of-tree imports in user files. Equivalent in effect; the symlink has fewer moving parts.
- `~/.config/opencode/skills` symlinked to `~/.claude/skills`: unnecessary, opencode already reads `~/.claude/skills` and `~/.agents/skills`.
- Copying anything: the repo's own convention (`claude-guards/README.md`, `commands/README.md`) is symlink-from-repo; this keeps it.

## 6. Unverified

- Which source line the installed binary (2.0.25) was built from. Latest GitHub release is `v1.19.0`; `dev` contains a `packages/core` rewrite whose instruction plugin reads only `AGENTS.md`. I read v1.19.0 for fallbacks, flags and `instructions`, and dev for skills/commands. Behavior on 2.0.25 is unconfirmed; run `opencode` with a probe line in each file to settle it.
- Whether the `~/.claude/CLAUDE.md` fallback and the `OPENCODE_DISABLE_CLAUDE_CODE*` flags still exist in 2.x (dev source shows only `compatibility.claude`/`compatibility.agents` roots for skills, no flag read in what I looked at).
- Whether opencode follows symlinked skill directories in practice: source passes `symlink: true` to its glob scan (v1 and dev) but I did not read the glob implementation, and oc-skills is silent.
- How opencode treats Claude-only SKILL.md and command frontmatter keys (ignore vs error), and how it handles two paths to the same skill (dedupe vs duplicate warning).
- Whether v1-style `tool.execute.before` plugins still load unchanged on 2.x: dev has a new Effect plugin API (`packages/plugin/src/effect/README.md`) and the docs page still shows the old shape. Smoke-test one trivial plugin before building on it.
- That throwing in `tool.execute.before` is the intended deny path (only evidenced by the docs example, not stated as a rule), and whether it also applies to subagent sessions, MCP tools, or the `bash` tool run via user `!` shell.
- Exact opencode tool names and argument keys beyond the doc example (`read`, `filePath`); the map in 3.3 is inferred.
- Whether opencode honors mutation of `output.args` for argument rewriting.
- Whether `OPENCODE_DISABLE_EXTERNAL_SKILLS` is exposed in 2.x; it is not on oc-skills.
- The guard portability column in 3.4 is a grep-level classification, not a per-file read.
- Claude Code version on this machine was not queried; features cited from the docs (for example `onFailure: "block"` needing v2.1.295, AGENTS.md reading needing v2.1.277) may not all be present locally.
