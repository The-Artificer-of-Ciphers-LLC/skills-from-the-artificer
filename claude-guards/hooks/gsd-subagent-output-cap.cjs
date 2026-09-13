#!/usr/bin/env node
// gsd-hook-version: 1.0.0
// gsd-subagent-output-cap.cjs — SubagentStop backstop for the return
// contract injected by gsd-agent-dispatch-guard.cjs.
//
// Some subagents ignore an injected prompt-level instruction (context
// pressure, a brief that overrides it, plain non-compliance). This hook
// catches that at the SubagentStop boundary: if the subagent's final
// message blows past a character cap, it is told — once — to re-send a
// compact version instead. It never inspects or enforces line counts (the
// dispatch-guard's contract is line-based; this backstop is a cheap,
// tier-agnostic character cap so it works even for subagents dispatched
// without the injected contract, e.g. named agents that pin their own
// prompt).
//
// One-shot per subagent: `decision: "block"` re-queues the subagent with
// `reason` as its next instruction, which means the subagent runs again and
// will emit ANOTHER SubagentStop. Without a per-agent_id flag file this
// would loop forever if the retry is still too long (or if the model just
// doesn't comply) — so a flag file is written on the first block and every
// subsequent stop for that same agent_id is let through unconditionally,
// oversized or not. Better to let one oversized report through than to wedge
// the subagent in a retry loop.
//
// stop_hook_active is Claude Code's own recursion signal: it is true when
// we are already inside a stop-hook-triggered continuation. Blocking again
// from inside that continuation risks compounding into exactly the kind of
// loop the one-shot flag also guards against, so it is checked first and
// unconditionally short-circuits to a no-op.
//
// Standalone by design (no sibling `require`) — see gsd-tier-guard.cjs for
// why hook scripts in this directory never require a sibling file.
//
// Fail-open contract: any unexpected error anywhere below results in a
// silent exit(0). A guard that can wedge SubagentStop on an internal bug is
// worse than a guard that occasionally misses a big response.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE_DIR = path.join(os.homedir(), '.claude', 'state', 'gsd-tier');
const AGENT_ID_RE = /^[A-Za-z0-9._-]+$/;
const DEFAULT_CAP = 6000;
const FLAG_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function resolveCap() {
  const raw = process.env.GSD_OUTPUT_CAP_CHARS;
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_CAP;
}

function flagPath(agentId) {
  return path.join(STATE_DIR, `stop-${agentId}.flag`);
}

// Best-effort prune of stale one-shot flags so this directory does not grow
// unbounded across long-lived sessions. Failures here must never affect the
// main decision — this is pure housekeeping.
function pruneOldFlags() {
  try {
    const entries = fs.readdirSync(STATE_DIR);
    const now = Date.now();
    for (const name of entries) {
      if (!name.startsWith('stop-') || !name.endsWith('.flag')) continue;
      const full = path.join(STATE_DIR, name);
      try {
        const st = fs.statSync(full);
        if (now - st.mtimeMs > FLAG_MAX_AGE_MS) fs.unlinkSync(full);
      } catch {
        // Single-entry stat/unlink failure — skip it, keep pruning the rest.
      }
    }
  } catch {
    // No state dir yet, or unreadable — nothing to prune.
  }
}

function emitBlock(length, cap) {
  let reason =
    'gsd-subagent-output-cap: your final response was ' + length + ' chars against a ' + cap +
    ' char cap. Re-send the final response only, under the cap: keep just conclusions and ' +
    'file:line references, drop file contents, diffs, restated brief, and narration. If the ' +
    'detail is genuinely needed, write it to a file and return the path plus a short abstract.';
  if (reason.length > 600) reason = reason.slice(0, 597) + '...';
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}

function main() {
  if (process.env.GSD_OUTPUT_CAP === 'off') return; // explicit escape hatch

  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch {
    return; // no stdin — nothing to guard
  }
  if (!raw || !raw.trim()) return;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return; // malformed payload — fail open
  }

  // We are already inside a stop-hook continuation — never re-block from
  // here, see module header.
  if (payload.stop_hook_active === true) return;

  const msg = payload.last_assistant_message;
  if (typeof msg !== 'string' || msg.length === 0) return;

  const cap = resolveCap();
  if (msg.length <= cap) return; // exactly cap is fine — only cap+1 triggers

  const agentId = payload.agent_id;
  if (typeof agentId !== 'string' || !AGENT_ID_RE.test(agentId)) return; // can't dedupe safely

  const flag = flagPath(agentId);
  if (fs.existsSync(flag)) return; // already retried once for this subagent — let it through

  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(flag, String(Date.now()));
  } catch {
    // If we can't persist the one-shot marker, don't block anyway — a block
    // we can't dedupe risks looping the subagent indefinitely.
    return;
  }

  pruneOldFlags();
  emitBlock(msg.length, cap);
}

try {
  main();
} catch {
  // Fail open unconditionally — see module header.
}
process.exit(0);
