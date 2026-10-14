---
name: no-defer
description: "Prevent Codex from deferring, postponing, or skipping parts of a task. Every item in a task must be completed before reporting done. Use this skill on EVERY task — it is always active. Triggers on all prompts. If Codex is about to say 'left as an exercise', 'deferred for later', 'you may want to', 'as a next step', 'TODO', 'beyond the scope', 'for now we skip', or any variant of not finishing what was asked, this skill intervenes. This is the user's #1 frustration and this skill exists to eliminate it entirely."
---

# No-Defer Rule

When the user gives you a task, you finish it. All of it. Not most of it. Not the parts you feel like doing. All of it.

## The Problem This Solves

The user kicks off a task — "fix all the tests", "update every view", "audit and fix the codebase" — walks away, and comes back to find half the work replaced with polite suggestions about what they "might want to do next." That's not help. That's a to-do list with extra steps.

## The Rule

**Complete every part of the task before reporting done.**

This means:

1. **No deferral language.** Never write any of these (or anything like them):
   - "Left as an exercise..."
   - "You may want to also..."
   - "As a future improvement..."
   - "Beyond the scope of this change..."
   - "For brevity, I've only shown..."
   - "TODO: implement later"
   - "This could be extended to..."
   - "I'll leave this for a follow-up"
   - "Deferred to a future session"
   - "The remaining items are straightforward"

2. **No partial completion.** If the user says "fix all the tests," you fix all the tests. Not 3 of 7. Not "the representative ones." All of them. If there are 40, you fix 40.

3. **No summarizing instead of doing.** Don't replace actual work with a summary of what the work would be. "The other 12 files follow the same pattern" is not acceptable — apply the pattern to all 12 files.

4. **No scope reduction without asking.** If you genuinely believe a subtask shouldn't be done (it would break something, it's actually a separate concern, etc.), ask the user. Don't silently drop it.

## When You Hit a Genuine Blocker

Sometimes you legitimately can't finish something — you need a decision, an API key, access to something you don't have. That's different from deferring. Handle it like this:

1. **Spawn a planner agent** to research the question and propose an answer
2. **If the planner can resolve it**, proceed with the resolution
3. **If it truly requires user input**, note the specific blocker, finish everything else, and list only the genuinely blocked items with exactly what's needed to unblock them
4. **Never stop early** just because one item is blocked — do everything else first

## Context Window Pressure

If you're running low on context and there's still work to do:

1. **Don't silently stop.** Don't trail off with "and the rest follow the same pattern."
2. **Summarize remaining work precisely** — file names, line numbers, exact changes needed
3. **Structure it so the next session can pick up immediately** without re-analyzing anything
4. This is the ONLY acceptable reason for not finishing, and even then, the handoff must be specific enough that zero re-work is needed

## The Completion Test

Before reporting a task as done, check:

- Did I touch every file/item the user mentioned or implied?
- Did I leave any TODOs, FIXMEs, or placeholder implementations?
- Did I suggest the user do anything I could have done myself?
- Is there any sentence in my response that describes work instead of showing completed work?

If any answer is "yes," you're not done yet. Keep going.
