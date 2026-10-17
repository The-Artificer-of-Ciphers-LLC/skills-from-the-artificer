---
name: writing-docs-with-diataxis
description: Write, restructure, or audit documentation using the Diátaxis framework (tutorial, how-to guide, reference, explanation). Use when writing or reorganising a README, docs site, or publishing docs for a repo or a collection of skills; when a doc page mixes teaching, instructions, specs and background; when someone asks "where should this go", "why is our README a mess", "write a getting-started", "document this skill/CLI/API", or mentions Diátaxis/Diataxis, docs structure, or docs IA, even if they never name the framework.
---

# writing-docs-with-diataxis

Every section below ends with `Source:` tags. Keys resolve to diataxis.fr pages in the list at the bottom; `evidence.md` says how strong each source is. Anything tagged `[repo judgment]` is not Diátaxis and must not be presented as such.

Diátaxis (Daniele Procida) solves problems of documentation content (what to write), style (how to write it) and architecture (how to organise it). It identifies four distinct user needs and four corresponding forms of documentation, and "crossing or blurring the boundaries ... is at the heart of a vast number of problems in documentation." Most doc problems are two needs smeared onto one page.
Source: [Home] [Start] [Map] [Colophon]

## 1. The compass: classify before you write or edit

Ask two questions of the content (or of what the reader needs):

1. **Action or cognition?** Does it inform what the user *does* (practical steps) or what they *know* (theoretical, propositional knowledge)?
2. **Acquisition or application?** Is the user at *study* or at *work*?

| If the content... | ...and serves the user's... | ...it is |
| --- | --- | --- |
| informs action | acquisition of skill | a **tutorial** (a lesson; learning-oriented) |
| informs action | application of skill | a **how-to guide** (a recipe; goal-oriented) |
| informs cognition | application of skill | **reference** (a description; information-oriented) |
| informs cognition | acquisition of skill | **explanation** (a discussion; understanding-oriented) |

Quick test by the question the reader is asking: tutorial "Can you teach me to...?", how-to "How do I...?", reference "What is...?", explanation "Why...?". Use the compass terms flexibly while finding bearings; apply it to a whole page or to a single sentence. Run it when you feel doubt, because "sometimes intuition provides an immediate answer that is also wrong."
Source: [Compass] [Map] [Start]

## 2. Write to the type (one-screen version)

Full principles, language patterns and checklists are in `references/types.md`; read the section for the type you are writing.

- **Tutorial** — a lesson in which the learner learns by doing something meaningful and achievable. Nearly all responsibility for success sits with the writer. State the destination ("In this tutorial we will..."), not "you will learn...". Visible result at every step; narrate what to expect; ruthlessly minimise explanation (a clause and a link); stay concrete; ignore options and alternatives; make it work for every reader every time and test it by watching people do it.
- **How-to guide** — directions for an already-competent user with a real goal ("how to configure reconnection back-off policies"). Defined by the user's task, not by what a tool can do. Action only: no teaching, no digression. Practical usability over completeness; it may fork ("If you want x, do y") and should prepare for the unexpected. Title "How to...".
- **Reference** — neutral, austere, authoritative description of the machinery, led by the product. Mirror the product's structure, use standard patterns, give short examples, state warnings. Describe and only describe: link out for instruction and explanation.
- **Explanation** — discussion that deepens understanding: context, why, history, alternatives, opinion and perspective allowed. Keep it bounded to a topic; imagine "About..." before the title. Do not let it absorb instruction or spec.
Source: [Tutorials] [How-to] [Reference] [Explanation]

## 3. Rules that matter in practice

- **Keep the types distinct; link between them.** A tutorial needing a concept gets one sentence and a link ("We're using HTTPS because it's more secure" plus a link); a how-to needing every option links to reference. Source: [Tutorials] [Start]
- **The commonest conflation is tutorial vs how-to.** They differ by study vs work, not by basic vs advanced: a tutorial can present something complex, a how-to can cover something basic. Tutorial = contrived, single path, no surprises, safe to restart. How-to = real world, forks and branches, prepares for the unexpected. Source: [Tut-vs-how-to]
- **Reference vs explanation:** if it is a list or table of facts, probably reference; if you would read it away from the work, probably explanation. Examples in reference tempt expansion into explanation; keep them illustrative. Source: [Ref-vs-expl]
- **Do not organise around product features.** Structuring docs around features "is rarely successful"; organise around the four needs. Reference mirrors the structure of the product. Source: [Map] [Reference]
- **Guide, not plan.** Diátaxis prescribes a structure, yet you do not build it first: no empty `tutorials/ how-to/ reference/ explanation/` skeletons ("Don't do that. It's horrible."). The structure forms "from the inside" as pieces are improved. Source: [Workflow]
- **Naming:** how-to titles say exactly what they show ("How to integrate application performance monitoring", not "Application performance monitoring"). Explanation titles read as "About...", and the section can be called Discussion, Background, Conceptual guides or Topics. Source: [How-to] [Explanation]
- **Readers do not move in order.** A user may enter anywhere and their need changes moment to moment, so each page must stand as its type. Source: [Map]

## 4. Applying it to existing docs: the loop

1. **Choose** something small: whatever is in front of you. Do not hunt for problems.
2. **Assess** it, ideally a paragraph or sentence: what user need does it serve, how well, what could be added, moved, removed or changed, do its language and logic fit this mode?
3. **Decide** the single next action that gives an immediate improvement.
4. **Do** it, count it complete (publish or commit), loop.

Publish each small step immediately; do not batch into a big reorganisation or tear down and restart. Documentation is never finished but can always be complete. Applying Diátaxis also exposes lapses: reference that mirrors the code makes gaps visible, and moving explanation out of a tutorial can reveal a step the reader had to guess. Do not wait to understand it all before starting.
Source: [Workflow] [Quality] [Application]

## 5. Common failures to check for

- A page mixing tutorial, philosophy, parameter listing and troubleshooting (typical flat README). [Start] [Map]
- A "tutorial" that is really a how-to, or a how-to that tries to teach. [Tut-vs-how-to]
- A tutorial loaded with explanation, choices or alternatives, or one that does not reliably work. [Tutorials]
- A how-to defined by what a tool does ("select the appropriate options and press Deploy") instead of a user goal, or titled "Application performance monitoring"-style. [How-to]
- Reference with instruction, opinion or digressions; auto-generated reference treated as all the documentation needed. [Reference]
- Explanation scattered in small parcels through other sections, or explanation that absorbed instructions and specs. [Explanation]

## 6. Documenting a skills repository

Read `references/skills-repo.md` for this repo or any collection of agent skills. Its README-section-to-quadrant mapping applies the compass; its layout and `SKILL.md` rules are labelled by origin ([diataxis.fr], [skill-creator], or [repo judgment]).

## Workflow when asked to "document X" or "fix the docs"

1. Read what exists; list each section/page with its quadrant (a quick table), using the compass rather than intuition.
2. Name mixed pages and unmet needs. Do not create empty pages for missing quadrants.
3. Run the loop (section 4) on the highest-value piece first; make real edits, not just a plan.
4. For each moved or new piece, check: single type, language and title fit the type, links replace repeated explanation.
5. Report what changed and what remains, ranked.

## Sources (diataxis.fr, fetched 2026-10-17)

- [Home] https://diataxis.fr/ · [Start] /start-here/ · [Compass] /compass/ · [Map] /map/ · [Workflow] /how-to-use-diataxis/ · [Application] /application/
- [Tutorials] /tutorials/ · [How-to] /how-to-guides/ · [Reference] /reference/ · [Explanation] /explanation/
- [Tut-vs-how-to] /tutorials-how-to/ · [Ref-vs-expl] /reference-explanation/ · [Quality] /quality/ · [Colophon] /colophon/
