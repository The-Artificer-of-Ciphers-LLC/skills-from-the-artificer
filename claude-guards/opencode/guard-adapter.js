// opencode adapter for the Claude Code PreToolUse guards in ../hooks.
// Maps opencode's tool.execute.before onto the Claude hook stdin contract, runs each guard,
// and throws on a deny so opencode blocks the call. Guards stay unchanged. Only PreToolUse-style
// guards that do not need Claude's transcript, Agent tool or Memtrace live here; Stop,
// SubagentStop, SessionStart and the denial breaker have no opencode equivalent.
import { spawnSync } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"

const HOOKS = join(homedir(), ".claude", "hooks")
const NAME = { bash: "Bash", edit: "Edit", write: "Write", multiedit: "MultiEdit", read: "Read", grep: "Grep", glob: "Glob" }
const SHELL = ["pre-pr-gate.sh", "gsd-test-clean-tree-guard.sh", "gsd-test-single-flight-guard.sh", "gsd-async-poll-guard.sh",
  "gsd-bench-pin-guard.sh", "gsd-pgrep-waiter-guard.sh", "gsd-foreground-poll-guard.sh", "block-local-node-test.sh",
  "gsd-test-viability-guard.sh", "worktree-fresh-base-guard.sh"]
const GUARDS = {
  Bash: ["zsh-guard.cjs", "measure-dont-infer-guard.cjs", "block-ci-rerun-guard.cjs", "no-defer-guard.js",
    "gsd-merge-authority-guard.cjs", "gsd-phase-gate.cjs", "artifact-gate.cjs", ...SHELL],
  Write: ["block-timeout-increase-guard.cjs", "worktree-guard.cjs", "gsd-phase-gate.cjs", "artifact-gate.cjs"],
  Edit: ["block-timeout-increase-guard.cjs", "worktree-guard.cjs", "gsd-phase-gate.cjs", "artifact-gate.cjs"],
  MultiEdit: ["block-timeout-increase-guard.cjs", "worktree-guard.cjs"],
}

function toClaudeInput(a = {}) {
  const o = { ...a }
  if (a.filePath !== undefined) o.file_path = a.filePath
  if (a.oldString !== undefined) o.old_string = a.oldString
  if (a.newString !== undefined) o.new_string = a.newString
  return o
}

function verdict(r) {
  if (r.status === 2) return (r.stderr || "blocked by guard").toString().trim()
  try {
    const j = JSON.parse(r.stdout.toString())
    const h = j.hookSpecificOutput || {}
    if (h.permissionDecision === "deny") return h.permissionDecisionReason || "blocked by guard"
    if (j.decision === "block") return j.reason || "blocked by guard"
  } catch {}
  return null
}

function runGuards(toolName, sessionID, directory, args) {
  const tool = NAME[String(toolName).toLowerCase()]
  for (const g of GUARDS[tool] || []) {
    const file = join(HOOKS, g)
    const cmd = g.endsWith(".sh") ? ["bash", [file]] : ["node", [file]]
    const r = spawnSync(cmd[0], cmd[1], {
      input: JSON.stringify({ hook_event_name: "PreToolUse", session_id: sessionID, cwd: directory,
        tool_name: tool, tool_input: toClaudeInput(args) }),
      timeout: 10000,
    })
    const why = verdict(r)
    if (why) throw new Error(`[${g}] ${why}`)
  }
}

// opencode v2 (Promise plugin API): a default definition with an id and a setup function.
// A throw in an "execute.before" hook rejects that one tool call.
export default {
  id: "claude-guard-adapter",
  setup: async (ctx) => {
    const directory = ctx?.location?.directory ?? process.cwd()
    await ctx.tool.hook("execute.before", (event) => {
      runGuards(event.tool, event.sessionID, directory, event.input)
    })
  },
}

// opencode v1 plugin shape, kept so the same file still loads there.
export const ClaudeGuardAdapter = async ({ directory }) => ({
  "tool.execute.before": async (input, output) => runGuards(input.tool, input.sessionID, directory, output.args),
})
