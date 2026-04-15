---
name: rubber-duck
description: >
  Rubber duck debugging session. Use when the user is stuck on a bug and can't find the cause,
  says "I don't understand why this isn't working", "help me think through this", "talk me
  through this bug", or "rubber duck". Also use when a developer has been debugging for >20
  minutes without progress — the duck is most valuable before frustration distorts thinking.
  Triggers on: "stuck", "can't figure out", "doesn't make sense", "walk me through", "help me
  think", "rubber duck", "explain why".
---

# Rubber Duck Debugging

## Core Principle

**The bug lives in the gap between what you think the code does and what it actually does.**

You can't see that gap from inside your own head. Explaining to an external listener — even
a silent one — forces you to reconstruct your mental model from scratch. That reconstruction
is where the bug surfaces.

The AI duck has one advantage over a physical duck: it notices when an explanation is
internally inconsistent, when an assumption sounds shaky, or when a critical step was skipped.

## Rules for the Duck

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

## What the Duck Does NOT Do

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
