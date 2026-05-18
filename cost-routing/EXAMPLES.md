# Worked Classifications

Fifteen request → tier mappings, including the boundary cases that trip up the classifier.

## Clear scout

| Request                                                     | Tier  | Why                                                  |
| ----------------------------------------------------------- | ----- | ---------------------------------------------------- |
| "Where is `ParseRequest` defined?"                          | scout | Pure symbol lookup. `grep` + return path.            |
| "List all `*.test.ts` files under `src/`."                  | scout | `glob` + return list.                                |
| "How many lines is `STATE.md`?"                             | scout | `wc -l`, one number back.                            |
| "Read `package.json` and tell me the test script."          | scout | One file, one field. Even though it's a single Read. |

## Clear coder

| Request                                                          | Tier  | Why                                                            |
| ---------------------------------------------------------------- | ----- | -------------------------------------------------------------- |
| "Add a test for `formatDate` covering DST transitions."          | coder | Known file, known fn, known behavior. Sonnet writes the test.  |
| "Rename `getUserId` → `getActorId` repo-wide."                   | coder | Mechanical refactor at known locations.                        |
| "Extract the retry logic in `client.ts` into its own helper."    | coder | Bounded, the design is settled, sonnet executes.               |
| "Convert this CSV to the JSON schema we use for fixtures."       | coder | Use `haiku-importer` actually — but coder-tier work, not opus. |

## Clear architect

| Request                                                              | Tier      | Why                                                                              |
| -------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------- |
| "Should we use Redux or Zustand for the new dashboard?"              | architect | Tradeoff analysis. No file to read tells you the answer.                         |
| "Draft an ADR for moving auth into a separate service."              | architect | Synthesis + recommendation. Opus tier.                                           |
| "Why does our test suite take 12 minutes? Investigate."              | architect | Ambiguous root cause; needs hypothesis + plan. (Then route the *probe* to scout.) |

## Boundary cases (the ones that get misclassified)

### "Find all callers of `legacyAuth` and report which ones still need migration."

**Scout.** It's a multi-file search with a fixed report shape. The "still need migration" check is grep-able if you can describe the marker — push that into the scout brief.

### "Refactor `auth.ts` to drop the legacy fallback."

Looks like **coder**, but check first: do you know what "the legacy fallback" is exactly? If yes → coder. If you're guessing → architect first (1 sentence: what is the fallback, what replaces it), THEN coder with a precise brief.

### "Something's wrong with checkout. Customers are getting double-charged."

**Architect first.** This is "investigate ambiguous bug" — opus designs the diagnosis. Then route the actual probes (logs, code paths) to scout, and the fix to coder. **Never** start by reading 20 files on opus.

### "Add error handling to the upload endpoint."

**Architect.** "Add error handling" is under-specified — handle WHAT errors, return WHICH responses, retry or no? One-sentence design clarification, then route to coder.

---

## Installing the hook

The PreToolUse hook lives at `~/.claude/skills/cost-routing/hooks/pre-tool-use-cost-check.sh`. Register it by merging this block into `~/.claude/settings.json` (do not overwrite — preserve any existing hooks):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Read|Grep|Glob",
        "hooks": [
          {
            "type": "command",
            "command": "$HOME/.claude/skills/cost-routing/hooks/pre-tool-use-cost-check.sh"
          }
        ]
      }
    ]
  }
}
```

Make the hook executable:

```bash
chmod +x ~/.claude/skills/cost-routing/hooks/pre-tool-use-cost-check.sh
```

Verify it fires by running any Read in a fresh Claude Code session — you should see a `cost-routing:` warning on stderr.

## Tuning the hook

| Goal                                           | How                                                   |
| ---------------------------------------------- | ----------------------------------------------------- |
| Hard-block top-level Read / Grep / Glob        | Export `COST_ROUTING_BLOCK=1` in your shell rc        |
| Silence the warning for a legit single Read    | Export `COST_ROUTING_BYPASS=1` for that session only  |
| Disable entirely                               | Remove the matcher entry from `~/.claude/settings.json` |
