# Evidence, confidence and audit log

Basis: (1) a 101-agent deep-research run (19 sources fetched, 70 claims extracted, top 25 adversarially verified 3 votes each; 23 confirmed, 2 refuted, 8 survived synthesis) and (2) the diataxis.fr pages read directly on 2026-10-17 (home, start-here, compass, map, tutorials, how-to-guides, reference, explanation, tutorials-how-to, reference-explanation, how-to-use-diataxis, application, foundations, quality, colophon). The pages are the authority for everything in `types.md`.

## Source keys (used in SKILL.md)
| Key | URL |
| --- | --- |
| Home | https://diataxis.fr/ |
| Start | https://diataxis.fr/start-here/ |
| Compass | https://diataxis.fr/compass/ |
| Map | https://diataxis.fr/map/ |
| Workflow | https://diataxis.fr/how-to-use-diataxis/ |
| Application | https://diataxis.fr/application/ |
| Tutorials | https://diataxis.fr/tutorials/ |
| How-to | https://diataxis.fr/how-to-guides/ |
| Reference | https://diataxis.fr/reference/ |
| Explanation | https://diataxis.fr/explanation/ |
| Tut-vs-how-to | https://diataxis.fr/tutorials-how-to/ |
| Ref-vs-expl | https://diataxis.fr/reference-explanation/ |
| Quality | https://diataxis.fr/quality/ |
| Colophon | https://diataxis.fr/colophon/ |

## Solid (primary source, read directly)
- Authorship; four needs and four forms; content, style and architecture (Home, Colophon).
- Compass table and two questions (Compass); the question each type answers and the lesson/recipe/description/discussion analogies (Map).
- Keep types distinct and link between them; blurring is a root cause of problems (Start, Map).
- Choose/assess/decide/do loop; guide-not-plan; no empty structures; structure forms from the inside (Workflow).
- Per-type principles, language patterns, naming (Tutorials, How-to, Reference, Explanation).
- Tutorial vs how-to is study vs work, not basic vs advanced (Tut-vs-how-to); reference vs explanation rules of thumb (Ref-vs-expl).
- Structuring docs around product features is rarely successful; reference architecture mirrors the product (Map, Reference, Quality).

## Weaker (use with care)
- Benefits (findability by goal, serving beginners and experts, preventing muddling) and "opinionated" caveat: one Oct 2023 practitioner blog (idratherbewriting.com). Medium.
- Flat mixed READMEs are common in skill repos: one community repo (github.com/ebal/AI-Skills). Medium; an observation, not a rule.
- "Write the description in terms of tasks and trigger words": one undated blog (metavert.io/how-to-write-a-SKILL.md). Low.
- ">99% of SKILL.md files contain a 'skill smell'": a July 2026 arXiv preprint (2607.01456), not peer reviewed, author-defined detector, unclear sample. Suggestive only.
- Older write-ups (e.g. Canonical's 2021-era post, agent-skill listings on skills.sh) may reflect Divio-era wording. The colophon says Procida still agrees with most of the earlier Divio-era presentation but has "several aspects that I now think I got wrong". Prefer diataxis.fr.

## Research-run refutations, explained
Two claims were refuted 0-3, both sourced to a Medium article: how-to guides "omit unnecessary explanation" and reference/explanation wording. The primary pages state the same substance (How-to: "no digression, explanation, teaching"; Reference: "Describe and only describe"), so the refutation concerned what that article said, not the rule. The run therefore did not confirm per-type rules; they are taken from the primary pages.

## Not Diátaxis (this repo's judgment or other guidance)
- Any directory layout. Diátaxis "doesn't impose implementation constraints" and names no layout (Home).
- SKILL.md authoring advice: skill-creator guidance and the blog above.
- Whether an agent-facing SKILL.md follows Diátaxis, and how types interact with progressive disclosure: not addressed by any source found.

## Audit log (assumptions checked against the pages, 2026-10-17)
Six of my first-draft assumptions were wrong or unsupported, so every section was re-sourced.
| # | Assumption | Finding | Fix |
| --- | --- | --- | --- |
| 1 | "Canonical names are fine in navigation" | No source. Only: compass terms are used flexibly; explanation may be called Discussion, Background, Conceptual guides, Topics | Replaced with the sourced naming rule |
| 2 | "Strong guideline, not a rigid bucket scheme" (from a blog) | Workflow page: Diátaxis "strongly prescribes a structure" yet you build it incrementally | Reworded to "prescribes a structure, formed from the inside" |
| 3 | Titles: "noun for reference, outcome for tutorial" | Unsourced. Sourced: "How to..." (how-to), "About..." (explanation), tutorial example "Let's create a simple game in Python" | Checklist re-tagged; reference naming marked judgment |
| 4 | "Research/Diátaxis says nothing about architecture" | Home: covers "architecture (how to organise it)"; Map: feature-based structure rarely works; no directory layout named | Added the architecture rules, kept layout as judgment |
| 5 | Quote "select the options and press Deploy" | Source: "select the appropriate options and press Deploy" | Corrected |
| 6 | Table implying tutorial = basic, how-to = advanced | Tut-vs-how-to: that is a named conflation; the axis is study vs work | Table rewritten with the source's rows; basic-vs-advanced note added |
Also corrected during the audit: a half-quoted compass sentence, and a paraphrase ("X is defined in...") that had been presented as a language pattern.

## Other sources
- https://canonical.com/blog/diataxis-a-new-foundation-for-canonical-documentation
- https://idratherbewriting.com/blog/what-is-diataxis-documentation-framework
- https://github.com/ebal/AI-Skills
- https://metavert.io/how-to-write-a-SKILL.md
- https://arxiv.org/abs/2607.01456
