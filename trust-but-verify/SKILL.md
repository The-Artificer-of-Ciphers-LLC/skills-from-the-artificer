---
name: trust-but-verify
description: Use when you receive findings, a report, or any factual claims back from a subagent/Task before you act on them — re-validate every claim against a primary source (the code itself, the memory directory, CONTEXT.md, docs/ and docs/adr/, context7 library docs, package/API references, or a language spec) instead of trusting the agent's summary. Trigger automatically after any Task/subagent returns a result you're about to rely on, and whenever the user says "trust but verify", "verify these claims", "double-check what the agent found", "did it actually confirm that", or "where's the source for X". A subagent's report is a lead, not a fact. Nothing is verified until a source was opened and quoted; guessing, inferring, and "that looks right" are not verification.
---

# Trust but Verify

> A subagent's report is a **lead**, not a fact. You trust it enough to investigate — never enough to act on unread.

When you delegate work to a subagent, what comes back is a *claim about reality*, filtered through a model that summarized, paraphrased, and sometimes hallucinated. The agent may be right. It may be confidently wrong. You cannot tell which from the report alone — the wrong ones look exactly as fluent as the right ones.

This skill is the discipline of closing that gap: before you build on, repeat, or report any claim an agent handed you, you re-open the **primary source** and confirm the claim against it. Every claim. With a citation.

## The one rule everything else serves

**No claim is verified until you have opened a primary source that confirms it and can quote where.**

Two corollaries that do the real work:

- **Inference is not verification.** "That's how this library usually works", "the function name implies it returns null", "that lines up with what I'd expect" — these are guesses wearing a lab coat. They produce an `UNVERIFIED`, never a `VERIFIED`.
- **The agent's own words are not a source.** "The agent said the timeout is 30s" verifies nothing. The agent is the thing under audit. The source is the config file where `30s` is written.

If you cannot find a source, the honest verdict is `UNVERIFIED` — and you say so out loud. Silently dropping an unsourced claim is worse than flagging it, because a clean report reads as "all confirmed."

## The loop

For a returned report, work claim by claim:

1. **Atomize.** Break the report into discrete, individually-checkable assertions. "The retry logic is in `cleanup.ts`, runs 3 times, and was added in #493" is *three* claims (location, count, provenance), each with its own source and its own verdict. Bundled claims hide the false one inside the true ones.

2. **Classify → pick the source.** Each claim has a *type*, and each type has an authoritative source (see the ladder below). A claim about code is settled by the code, not by docs about the code. A claim about a library's behavior is settled by that library's docs or source, not by the codebase that calls it.

3. **Open the source and check.** Actually Read / Grep / query it. Confirm the claim matches — including the *specifics*. If the claim says line 42 and the source has it at line 88, that's not a pass with a footnote; the location claim is `CONTRADICTED` even if the underlying fact is true.

4. **Missing source? Re-dispatch, then judge.** If the obvious source doesn't settle it, run one targeted lookup before concluding (see [Re-dispatch](#re-dispatch-dont-give-up-on-the-first-miss)). Only after that returns empty does the claim become `UNVERIFIED`.

5. **Record a verdict with a citation.** Every row of the output names the exact source you opened.

6. **Act only on what survived.** Build on `VERIFIED` claims. Treat `CONTRADICTED` as the corrected truth. Treat `UNVERIFIED` as not-yet-true — surface it, don't silently rely on it.

## The source ladder

The skill lives or dies on this mapping. For each claim, the authoritative source is the thing that *defines* the fact — not a description of it. Match the claim type, go there, quote it.

| Claim is about… | Primary source (open this) | How to check |
|---|---|---|
| **Code structure / location** — "X is defined in Y at line N", "A calls B", "this file exports Z" | The code itself | `Read` the cited file; `Grep` for the symbol. Confirm file, symbol, *and* line. |
| **Code behavior** — "returns null on error", "throws on empty input", "the test passes" | The code, and for runtime claims, *actually run it* | Read the implementation/test. For "it passes / it works", run the test or command — don't trust "I ran it." |
| **Config / constants / flags** — "timeout is 30s", "the env var is `GSD_NOW_MS`", "default is true" | The file where the value is defined | `Grep` the literal; read the definition site, not a doc that mentions it. |
| **Project decisions / conventions** — "we decided to use X", "the convention is Y", "this was deprecated" | `CONTEXT.md`, `docs/adr/`, `AGENTS.md`, `docs/research/` | Read the relevant ADR or CONTEXT section. A decision with no record is `UNVERIFIED`, not "probably true." |
| **User preferences / prior context** — "the user prefers Z", "we agreed last session" | The memory directory (`.../memory/*.md`) | Read the memory file. Then **re-confirm any file/symbol it names still exists** — memory reflects when it was written, not now. |
| **Library / framework / API behavior** — "React's cleanup runs before the next effect", "this SDK method takes options", "fast-check runs 100 cases by default" | **context7** docs for that library; else the installed source in `node_modules`. **And** the project's own config/usage of it. | `resolve-library-id` → `query-docs`. Cite the library + the doc passage. Don't reason from memory of the API. If the claim is about how the library behaves *in this project*, the upstream default is only half the source — check whether the repo overrides it (a setup/config file, a global option, a wrapper) before you call the default "verified." |
| **Language semantics** — "in JS `==` coerces like this", "Python dicts preserve insertion order since 3.7" | The language reference / spec (via context7 or an authoritative doc) | Cite the spec/MDN passage. Your training memory of a language edge case is a lead, not a source. |
| **External facts / versions / current state** — "the latest version is N", "the API now returns 429" | The live source — `WebFetch`/`WebSearch`, the registry, the API itself | Hit the actual endpoint/registry. Cite the URL and what it returned. |

When a claim spans two types (a code fact *and* a library fact), it needs a source for each part.

## The three verdicts

- **`VERIFIED`** — you opened a source, it confirms the claim including specifics, and you cite where. This is the only verdict that lets you act on the claim as fact.
- **`CONTRADICTED`** — you opened a source and it says something *different*. Record what the source actually says; that corrected fact is now the truth you carry forward.
- **`UNVERIFIED`** — no source settled it, including after a re-dispatch. Not "false" — *unestablished*. You must surface it; never let it pass as confirmed.

There is deliberately no "probably true" verdict. The whole point is to refuse the comfortable middle where inference masquerades as confirmation.

## Re-dispatch: don't give up on the first miss

`UNVERIFIED` is a real outcome, but reach it honestly. If the first source you check doesn't settle a claim, run **one** targeted follow-up before concluding — the agent may have been right but pointed you to the wrong place:

- Wrong location for a code fact → `Grep` the symbol across the repo (or dispatch a focused search agent) to find where it really lives.
- Library/API behavior you can't find → `resolve-library-id` + `query-docs` on context7 for that exact library.
- A decision you can't locate → search `docs/adr/` and `CONTEXT.md` for the topic.

If the re-dispatch surfaces the source, verdict accordingly (often `CONTRADICTED` on the specifics). If it comes back empty, *now* it's `UNVERIFIED` — and you've earned that verdict instead of assumed it.

## Output: the verdict table

Lead with the table so the audit is scannable. One row per atomized claim:

```
## Verification — <what the agent was asked to find>

| # | Claim | Verdict | Source (opened) | Note |
|---|-------|---------|-----------------|------|
| 1 | retry logic lives in `cleanup.ts:88` | VERIFIED | tests/.../cleanup.ts:88 | matches exactly |
| 2 | it retries 3 times | CONTRADICTED | tests/.../cleanup.ts:91 — `maxRetries = 5` | agent said 3, source says 5 |
| 3 | added in PR #493 | UNVERIFIED | `git log`/blame inconclusive; re-dispatch found no link | provenance unconfirmed |

**Safe to act on:** claims 1. **Corrected:** claim 2 → retries 5×. **Open:** claim 3 — provenance unverified.
```

The closing line matters: it tells the reader (and future-you) exactly which claims earned the right to be built on, which were corrected, and which are still hanging. Never end with just the table and let the caller guess.

## Anti-patterns that quietly defeat this

- **Laundering plausibility into a verdict.** "This matches how the codebase usually does it" → that's pattern-matching, which is inference. `UNVERIFIED`.
- **Citing the agent as the source.** The agent is the audit subject. Its confidence is not evidence.
- **Passing the gist, failing the specifics.** The fact is roughly right but the line number, count, or flag name is wrong. Specifics are where the bugs hide — `CONTRADICTED` on the wrong specific.
- **Trusting stale memory.** A memory file or an old CONTEXT entry can name a function that's since been renamed or deleted. Re-confirm against today's code before treating it as `VERIFIED`.
- **Silent drops.** Removing an unsourced claim so the report looks clean. If you drop, you say what and why. The default is to flag, not to hide.
- **Stopping at the doc when the question is the code.** Docs describe intent; code is what runs. For a behavior claim, the code wins over any doc that disagrees.
- **Verifying the upstream default and stopping.** A library's documented default is not how it behaves once *this* project has configured it. "The default is 100" can be true upstream and wrong here because a setup file sets it to 200. For any "how does it behave in our setup" claim, confirm the repo's actual configuration, not just the vendor docs.

## Calibrate the effort

Verify the claims you're about to *act on or repeat*, in proportion to the cost of being wrong. A claim that decides an edit, a deletion, an API call, or something you'll tell the user deserves a fully-opened source. A passing aside that changes nothing doesn't need a forensic trail — but if you're unsure whether a claim is load-bearing, treat it as if it is. The failure mode this skill exists to prevent is acting on a fluent, confident, wrong report — so when in doubt, open the source.
