---
name: rubber-duck
description: >
  Rubber duck debugging and claim-walking. Use when a user is stuck on a bug ("I don't
  understand why this isn't working", "talk me through this bug", "rubber duck", "stuck",
  "doesn't make sense", "help me think") or has been debugging 20+ minutes without progress.
  Also use, with no human in the loop, to walk the claims in a PR description or design doc
  against the actual code ("author claims...", "walk the design", "design for #N, answer your own
  questions from evidence"), or any time an agent is about to assert how code behaves without
  having checked. Interactive mode questions the person; autonomous mode answers each question
  from evidence (file:line, command output) and returns a claim / evidence / verdict table.
---

# Rubber Duck Debugging

## Core Principle

**The bug lives in the gap between what you think the code does and what it actually does.**

You can't see that gap from inside your own head. Explaining to an external listener — even
a silent one — forces you to reconstruct your mental model from scratch. That reconstruction
is where the bug surfaces.

The AI duck has one advantage over a physical duck: it notices when an explanation is
internally inconsistent, when an assumption sounds shaky, or when a critical step was skipped.

## Pick a Mode First

| Situation | Mode |
|---|---|
| A person is present and stuck | **Interactive** (the protocol below) |
| Args say "autonomous", "walk it", "author claims", "answer your own questions", or there is no one to reply | **Autonomous** (see "Autonomous Mode") |

Why two modes: the interactive duck works because *the human* must reconstruct their mental
model. An agent has no one to reconstruct for, and an agent asking itself questions and
answering from memory just repeats its own fluent guess. Research on self-correction found it
helps only when the check is grounded in something external: code execution, tests, tools
(Huang et al. 2023, arXiv 2310.01798). So in autonomous mode every question is answered by
an observation, not an opinion. Sources: `docs/research/rubber-duck-skill-improvements.md`.

## Rules for the Duck (interactive mode)

1. **Never jump to solutions.** The duck's job is to keep the human explaining, not to fix the bug.
2. **Never accept hand-waving.** "...and then it processes the data..." is not an explanation.
3. **Surface assumptions, don't answer them.** When you hear one, name it: "You just assumed X — is that definitely true?"
4. **Ask "why" not "how".** "How does it get the user ID?" is implementation. "Why do you expect that value to be set at that point?" is root cause.
5. **The moment explaining stops flowing is the moment.** When the human hesitates, backtracks, or says "...well, it should..." — that pause is the bug's address.

---

## The Session Protocol

### Step 0: Before Anything Else

Ask the human to state the bug in **one sentence**. Not symptoms. Not what they tried. One sentence:

> "What do you expect to happen, and what happens instead?"

If they can't state it in one sentence, the problem isn't well-understood yet. Make them try.

---

### Step 1: State Expected vs. Actual (No Code Yet)

Do not look at code yet. Get:

- **Expected:** "When X happens, Y should result."
- **Actual:** "Instead, Z happens."
- **Frequency:** "Always? Sometimes? Only in this one case?"

If "sometimes" or "only when": that condition is almost certainly the bug's domain. Note it.

---

### Step 2: List Assumptions Out Loud

Before touching code, ask:

> "Before we look at the code — what are you assuming is true at the point where the bug occurs?"

Make them list every assumption explicitly. Write them down as a numbered list.

Common assumptions that hide bugs:

| Assumption | What to challenge |
|---|---|
| "This value is always set" | Nil/null/unset — when could it not be? |
| "This runs on the main thread" | What if it doesn't? |
| "The data arrives in this order" | What if it arrives out of order or late? |
| "This has already been called" | What if the setup step was skipped? |
| "This only runs once" | What if it runs twice? |
| "This state is still valid here" | Could it have been mutated between here and where it was set? |

For each assumption: "How do you know that's true?"

---

### Step 3: Walk the Code Path — Line by Line

Now look at the code. Ask the human to **narrate what happens**, not what the code says.
There's a difference:

- ❌ "It calls `recalculateBalance()` here."
- ✅ "At this point, `account.balance` is... I think it's whatever the last transaction set it to... and then it calls `recalculateBalance()`, which should update it to the sum of all transactions since `openingBalance`."

**Interrupt when:**
- They skip a step ("and then later, it saves")
- They describe what should happen instead of what does happen
- They use "should" — "should" is an assumption
- Their explanation contradicts an earlier statement

**Probing questions:**
- "What is the actual value of `X` at this point? Not what it should be — what is it?"
- "You said it calls `Y` — when exactly? Before or after `Z` modifies this?"
- "What does `Y` return? Walk me through that function too."
- "You said 'it saves' — where? To what context? Is that the same context the view observes?"

---

### Step 4: Find the Contradiction

As the human explains, you're looking for **the moment the explanation breaks down**:

- A hesitation ("...well, it should be...") — this is an assumption being tested in real time
- A contradiction with something said earlier
- A skipped step that was glossed over with "and then..."
- An assumption from Step 2 that the explanation just violated

When you find it, name it:

> "You said in Step 2 that X is always set before this runs. But you just said the callback fires asynchronously — how do you know X is set by then?"

Do not solve it. Name the contradiction. Let the human follow the thread.

---

### Step 5: The Moment of Recognition

The session is working when the human says one of:
- "Oh. Oh no."
- "Wait, that can't be right..."
- "Hold on — if that's true, then..."
- Silence, followed by "I need to check something."

When this happens: **stop talking**. Let them think. The duck's job is done.

---

### Step 6: Confirm and Close

After the human has identified the root cause:

1. Ask them to re-state the bug in one sentence — including the actual cause, not just the symptom.
2. Confirm the cause satisfies both: "Does this explain why it always/sometimes/only-in-this-case fails?"
3. If yes: they're ready to write the fix. If no: there's a second bug or the cause is still incomplete.

---

## Autonomous Mode

Use when no human can answer. The duck's discipline (never accept hand-waving, name every
assumption, "should" is a red flag) stays; the *answers* come from the code instead.

### A. Decide the input

- **Claim audit**: a PR description, issue, or review comment says the code does X.
- **Design walk**: a design or ADR says the system will behave a certain way.
- **Bug**: you are about to explain why something fails.

All three reduce to the same thing: a numbered list of checkable statements.

### B. Extract claims

Write each claim as one line a stranger could check ("4xx errors are never retried", not
"error handling is robust"). Include implicit claims too: numbers ("up to 3 retries"),
words like "always/never/only", and anything the text says is "handled by" something else.
This step is a design choice, not a quoted method: it pairs claim extraction with
independent verification, which Chain-of-Verification found beats checking everything in one
pass (arXiv 2309.11495).

### C. Check each claim on its own

For every claim, answer *without rereading your earlier verdicts*, by reading the code or
running something. Acceptable evidence: `file:line` you read, a command and its output, a
test that would fail if the claim were false. Not evidence: "the tests pass" (unless they
exercise the claimed behaviour), "this is a common pattern", your memory of the library.

Look specifically for the places claims usually break: boundaries (off-by-one in counts),
ordering (delete-then-write races), paths the text never mentions (bulk/import/error
paths), and "handled elsewhere" (find the elsewhere).

### D. Output

```
| # | Claim | Evidence (file:line / command) | Verdict |
|---|-------|--------------------------------|---------|
| 1 | ...   | retry.js:4 loop runs `retries` times | REFUTED: 3 calls total, not 4 |
```

Verdicts: **CONFIRMED**, **REFUTED** (say what is true instead, one line), or
**UNVERIFIED** (say what you could not check and why). End with the list of UNVERIFIED
items; an honest "I could not check this" is the point, a confident guess is the failure.
Do not propose fixes until at least one claim is REFUTED, and then only after the table.

Habit from interactive mode that carries over: when your own explanation contains
"should" or "I think", that is the claim to check next.

---

## What the Duck Does NOT Do (interactive mode)

- ❌ Suggest fixes before the root cause is confirmed
- ❌ Look up APIs or documentation during the session
- ❌ Say "the problem might be..." — speculation ends verbalization
- ❌ Accept "I think it probably does X" as an explanation — make them verify
- ❌ Move to the next step if the current step isn't done

---

## Quick Reference (When to Interrupt)

| Human says | Duck responds |
|---|---|
| "It should..." | "Should, or does? What does it actually do?" |
| "...and then later..." | "Stop. What happens in between? Walk me through that." |
| "I think the value is..." | "You think, or you know? Where does that value come from?" |
| "That part works fine" | "How do you know? Have you verified it in this specific case?" |
| "It's probably X" | "We're not guessing yet. Keep explaining what you observe." |
| "I've tried everything" | "Tell me the last thing you tried and what you expected it to change." |

---

## Duck Log (Optional but Valuable)

After each session, note:
- The bug's root cause in one sentence
- Which assumption was wrong
- Which step of the protocol surfaced it

Over time, patterns emerge: "I always assume X" or "I always gloss over async boundaries." These patterns are more valuable than any individual bug fix.
