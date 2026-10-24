#!/usr/bin/env node
// gsd-hook-version: 1.0.0
// agent-register-guard.cjs — SubagentStop gate: a governed subagent may not
// finish until it has REGISTERED its result with Memtrace.
//
// Governed = its brief (first user message) contains the marker line
//     REGISTER-WITH-MEMTRACE: source_id=<id> [repo_id=<repo>]
// Any other subagent (Explore, Plan, ad-hoc) is not touched.
//
// "Registered" means the subagent's own transcript holds a call to
//     mcp__memtrace__record_external_episode
// whose input.source_id equals the marker's source_id and whose source_type
// starts with `agent_`, answered by a tool_result that is not an error and
// carries an episode_id. Read-back for verification:
//     mcp__memtrace__fleet_get_episode({ episode_id })   -> found: true + metadata
// (Verified 2026-10-24: get_evolution / get_changes_since do NOT list agent_
// episodes in this build, fleet_get_episode does.)
//
// The final message must also state the episode id, so the orchestrator can
// read the claim back instead of trusting prose: `Registered: <episode_id>`.
//
// Enforcement is `decision: "block"` (re-queues the subagent with `reason`).
// At most MAX_BLOCKS blocks per agent_id, then it is let through and the
// failure is logged as UNREGISTERED to ~/.claude/logs/agent-register-guard.jsonl
// (a guard that can wedge SubagentStop is worse than a visible miss).
// Fails OPEN on any internal error.
//
// Escape (human only, exported in the shell that launches Claude Code):
//   GSD_AGENT_REGISTER_OFF=1

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_BLOCKS = 2;
const TOOL = 'mcp__memtrace__record_external_episode';
const MARKER_RE = /REGISTER-WITH-MEMTRACE:\s*source_id=([A-Za-z0-9._:-]+)(?:\s+repo_id=([A-Za-z0-9._-]+))?/;
const AGENT_ID_RE = /^[A-Za-z0-9._-]+$/;
const STATE_DIR = path.join(os.homedir(), '.claude', 'state', 'gsd-agent-register');
const LOG_FILE = path.join(os.homedir(), '.claude', 'logs', 'agent-register-guard.jsonl');

function log(rec) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, JSON.stringify({ ts: new Date().toISOString(), ...rec }) + '\n');
  } catch { /* logging never affects the decision */ }
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('\n');
}

function readTranscript(file) {
  const rows = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* skip torn line */ }
  }
  return rows;
}

function findTranscript(payload) {
  if (typeof payload.agent_transcript_path === 'string' && fs.existsSync(payload.agent_transcript_path)) {
    return payload.agent_transcript_path;
  }
  const tp = payload.transcript_path;
  if (typeof tp === 'string' && typeof payload.agent_id === 'string' && AGENT_ID_RE.test(payload.agent_id)) {
    const p = path.join(path.dirname(tp), path.basename(tp, '.jsonl'), 'subagents', `agent-${payload.agent_id}.jsonl`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Analyse a transcript: the marker (if any) and the registration (if any). */
function analyse(rows) {
  let marker = null;
  for (const r of rows) {
    const role = r.type || r.message?.role;
    if (role !== 'user') continue;
    const m = MARKER_RE.exec(textOf(r.message?.content ?? r.content));
    if (m) { marker = { sourceId: m[1], repoId: m[2] || null }; }
    break; // only the first user message is the brief
  }
  if (!marker) return { marker: null };

  const calls = new Map(); // tool_use_id -> input
  const results = new Map(); // tool_use_id -> { isError, text }
  for (const r of rows) {
    const content = r.message?.content ?? r.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b?.type === 'tool_use' && b.name === TOOL) calls.set(b.id, b.input || {});
      if (b?.type === 'tool_result') results.set(b.tool_use_id, { isError: !!b.is_error, text: textOf(b.content) });
    }
  }
  let episodeId = null;
  for (const [id, input] of calls) {
    if (input.source_id !== marker.sourceId) continue;
    if (typeof input.source_type !== 'string' || !input.source_type.startsWith('agent_')) continue;
    if (marker.repoId && input.repo_id !== marker.repoId) continue;
    const res = results.get(id);
    if (!res || res.isError) continue;
    const e = /"episode_id"\s*:\s*"([0-9A-Za-z]{20,40})"/.exec(res.text) || /episode_id[^0-9A-Za-z]{1,6}([0-9A-Z]{20,40})/.exec(res.text);
    if (e) { episodeId = e[1]; break; }
  }
  return { marker, episodeId };
}

function blockCount(agentId) {
  try { return Number(fs.readFileSync(path.join(STATE_DIR, `${agentId}.count`), 'utf8')) || 0; } catch { return 0; }
}
function bumpBlock(agentId) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(path.join(STATE_DIR, `${agentId}.count`), String(blockCount(agentId) + 1));
  } catch { /* ignore */ }
}

function block(reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}

function main() {
  if (process.env.GSD_AGENT_REGISTER_OFF === '1') return;
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { return; }
  if (!raw.trim()) return;
  let payload;
  try { payload = JSON.parse(raw); } catch { return; }

  const agentId = payload.agent_id;
  if (typeof agentId !== 'string' || !AGENT_ID_RE.test(agentId)) return;
  const file = findTranscript(payload);
  if (!file) return; // cannot inspect: not governed as far as we can tell

  const { marker, episodeId } = analyse(readTranscript(file));
  if (!marker) return; // ungoverned subagent

  const last = typeof payload.last_assistant_message === 'string' ? payload.last_assistant_message : '';
  const stated = episodeId && last.includes(episodeId);
  if (episodeId && stated) {
    log({ event: 'registered', agent_id: agentId, source_id: marker.sourceId, episode_id: episodeId });
    return;
  }

  const n = blockCount(agentId);
  if (n >= MAX_BLOCKS) {
    log({ event: 'UNREGISTERED', agent_id: agentId, source_id: marker.sourceId, registered: !!episodeId, stated_in_message: !!stated, blocks: n });
    return; // let it through, visibly
  }
  bumpBlock(agentId);

  const repo = marker.repoId || '<repo_id from your brief>';
  const reason = episodeId
    ? `agent-register-guard: you registered episode ${episodeId} but your final message does not state it. ` +
      `Re-send your final report starting with the line "Registered: ${episodeId}".`
    : `agent-register-guard: this task requires registration with Memtrace before you finish, and your transcript has no ` +
      `successful ${TOOL} call for source_id "${marker.sourceId}". Do NOT report yet. Call ` +
      `mcp__memtrace__record_external_episode({ repo_id: "${repo}", source_type: "agent_<task-kind>", ` +
      `source_id: "${marker.sourceId}", metadata: { task, verdict, evidence: [<file:line / command / tool results you actually ran>], ` +
      `not_run: [<every check that failed or was skipped, with the error>] } }). Metadata must contain only what your tool ` +
      `calls returned. Then re-send your final report with the first line "Registered: <episode_id from the result>".`;
  block(reason.length > 900 ? reason.slice(0, 897) + '...' : reason);
}

try { main(); } catch { /* fail open */ }
process.exit(0);
