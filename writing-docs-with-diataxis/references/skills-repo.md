# Diátaxis for a skills repository

A skills repo (one directory per skill, each with a `SKILL.md`) has two audiences: humans browsing and installing, and the model reading `SKILL.md`. Diátaxis governs the human-facing docs.

**Origin tags used below:** `[dx]` = stated by diataxis.fr (page named); `[compass]` = derived by applying the compass to this repo's content; `[sc]` = skill-creator guidance, not Diátaxis; `[judgment]` = this repo's own choice, unverified. Diátaxis "doesn't impose implementation constraints" (https://diataxis.fr/), so folder names and file layout are always `[judgment]`.

## Map the usual README sections

A typical skills README is one flat file (observed in one community repo; see `evidence.md`). Classification column is `[compass]`; the destination column is `[judgment]`. Split or link:

| Typical section | Quadrant | Where it belongs |
| --- | --- | --- |
| "What are skills / why host them" | Explanation | `docs/explanation/` page ("About skills"), one-paragraph pitch in README |
| Skills catalog table (name, what it does) | Reference | README table or `docs/reference/catalog.md`; one line per skill, same shape every row |
| SKILL.md frontmatter and layout spec | Reference | `docs/reference/skill-format.md` |
| `evals.json` schema | Reference | `docs/reference/evals.md` |
| "Install with the CLI" / "copy manually" | How-to | `docs/how-to/install-skills.md` (goal-titled, branches for global vs project) |
| Installing skills that ship agents or hooks | How-to | One how-to per variant, linked from the install page |
| "Create your own skill" | Tutorial (first skill) + How-to (specific tasks) | Tutorial: build one tiny skill end to end. How-tos: add an eval, add a hook, publish |
| "How skills work / why triggers matter" | Explanation | `docs/explanation/how-skills-trigger.md` |
| Design notes, research (`docs/research/`) | Explanation | Keep; link from the pages they justify |
| Per-skill hook/agent `README.md` | Mixed, usually how-to + reference | Install steps as how-to, config keys as reference; keep short |

Do not create these folders ahead of content [dx /how-to-use-diataxis/]. Create a page only when you move or write real material into it; a docs tree with some quadrants missing is fine [judgment].

## Where material tends to land  [judgment]

Diátaxis says to organise documentation around the four needs (https://diataxis.fr/) and that structure should form as pieces are improved (/how-to-use-diataxis/). It names no directory layout. This one is a suggestion.

```
README.md                 # pitch, catalog (reference), 3 quick links
docs/
  tutorials/              # write-your-first-skill.md
  how-to/                 # install-skills.md, add-evals.md, publish.md
  reference/              # skill-format.md, evals.md, catalog.md
  explanation/            # how-skills-trigger.md, why-laws-pack.md
```

README stays the front door [judgment]: what this is, the catalog table, and links by reader goal ("Install", "Write a skill", "Look something up", "Understand why"). Keep install commands in one place and link to them elsewhere so they do not drift (link instead of repeating is [dx /tutorials/, /how-to-guides/]; the drift rationale is [judgment]).

## Publishing checklist

For each page you publish:
- [ ] Exactly one quadrant [dx /map/]; how-to title is "How to <goal>" [dx /how-to-guides/]; explanation reads as "About <topic>" [dx /explanation/]; tutorial title states what will be built, e.g. "Let's create a simple game in Python" [dx /start-here/]; reference titles are not sourced, keep them plain and consistent [judgment]
- [ ] Tutorial steps were run start to finish and the final result matches the stated one [dx /tutorials/: "extensive testing and observation"]
- [ ] Commands are copy-pasteable and use real paths in this repo
- [ ] Reference rows have a consistent shape; nothing narrative [dx /reference/]
- [ ] Cross-links replace repeated explanation [dx /start-here/]
- [ ] Catalog entry per skill still matches its SKILL.md `description` [judgment]
- [ ] No empty placeholder pages [dx /how-to-use-diataxis/]

## Per-skill docs

- **`SKILL.md` frontmatter `description`**: the main trigger surface, read by the model. Write in terms of tasks and trigger words (what the user is trying to do, phrases they use), not features [one blog, metavert.io; low confidence], and say what it does *and* when to use it [sc]. A little pushy is fine, since skills tend to undertrigger [sc].
- **`SKILL.md` body**: instructions to the model. Do not turn it into a human tutorial [judgment]. Keep it under ~500 lines; move bulky detail to `references/` and say when to read it [sc].
- **Human docs for a skill** (when a skill ships hooks/agents): a short `README.md` with install how-to and a config reference table [compass]. Rationale goes in a linked explanation page, not between the install steps [dx /how-to-guides/: no explanation in how-tos].
- **Catalog one-liner**: derive from the description's first sentence [judgment]; keep it factual because a catalog is reference [compass, dx /reference/].

Evidence: a flat, mixed README is common among skill repos (one community repo was checked: What/Why, structure, catalog, how-to-use, create-your-own, format spec in one file). The "description in terms of tasks and trigger words" advice rests on one blog; the ">99% of SKILL.md files have smells" figure on one non-peer-reviewed preprint. See `evidence.md`.
