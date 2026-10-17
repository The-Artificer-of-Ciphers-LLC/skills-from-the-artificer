# Per-type principles (from diataxis.fr)

Source pages (all https://diataxis.fr): /tutorials/, /how-to-guides/, /reference/, /explanation/, /tutorials-how-to/, /reference-explanation/, /map/, /compass/. Each section names its page. Quotes are verbatim; anything not in quotes is a close paraphrase of that page.

Contents: Tutorials · How-to guides · Reference · Explanation · Tutorial vs how-to · Checklists

## Tutorials  (/tutorials/)

A tutorial is "an experience that takes place under the guidance of a tutor" and is "always learning-oriented". Its purpose "is not to help the user get something done, but to help them learn." The learner learns by doing; what they do is not necessarily what they learn.

The exercise must be: meaningful (sense of achievement), successful (completable), logical (the path makes sense), usefully complete (meets every action, concept and tool they need).

Principles:
- **Don't try to teach.** Give the learner things to do; resist teaching by telling. Temptations to avoid: abstraction, generalisation, explanation, choices, information.
- **Show where they are going**, e.g. "In this tutorial we will create and deploy...". Not "you will learn...", which is presumptuous.
- **Deliver visible results early and often.** Every step produces a comprehensible result, however small.
- **Maintain a narrative of the expected.** "You will notice that ..."; show actual or exact expected output; flag likely signs of going wrong; warn of surprising actions (long logs).
- **Point out what the learner should notice**, in passing, to close loops of learning.
- **Target the feeling of doing**: tie purpose and action together.
- **Encourage and permit repetition**: make steps repeatable where possible.
- **Ruthlessly minimise explanation.** "We're using HTTPS because it's more secure" plus a link is enough.
- **Focus on the concrete**: from particular action to particular result; patterns emerge from examples.
- **Ignore options and alternatives.**
- **Aspire to perfect reliability.** The tutor is "required to be present, but condemned to be absent". It must work for every user, every time. Flaws are found only by observing real users do it.

Language: "We ..." (first-person plural); "In this tutorial, we will ..."; "First, do x. Now, do y."; "The output should look something like ..."; "Notice that ... Let's check ..."; closing line that mildly admires what was achieved.

Cost warning: tutorials are hard to maintain; changes cascade through the whole journey when the product changes.

## How-to guides  (/how-to-guides/)

"Directions that guide the reader through a problem or towards a result." Goal-oriented; help the user "get something done, correctly and safely".

- **Addressed to problems, not machinery.** Defined by what someone needs to get done, not operations a tool can perform. "How to build a web application" is too open-ended; "how to configure reconnection back-off policies" is a goal. Do not write what a competent user already knows ("turn the tap clockwise").
- **Characteristics:** focused on tasks or problems; assume the user knows what they want; action and only action; no digression, explanation or teaching. If explanation or reference matters, link to it.
- **Address real-world complexity:** adaptable to variations; may fork and overlap; may rely on user judgement. A how-to is not merely a linear procedure; "actions" include thinking and judgement.
- **Omit the unnecessary:** practical usability over completeness. Unlike a tutorial it need not be end to end; it starts and ends somewhere meaningful.
- **Logical sequence and flow:** order by necessity or by what sets up the user's environment/thinking; avoid context-switching; mind pace and rhythm.
- **Naming:** good "How to integrate application performance monitoring"; bad "Integrating ..."; very bad "Application performance monitoring".

Language: "This guide shows you how to ..."; "If you want x, do y. To achieve w, do z."; "Refer to the x reference guide for a full list of options."

## Reference  (/reference/)

"Technical descriptions of the machinery and how to operate it." Information-oriented. Led by the product, not by user needs. "One hardly reads reference material; one consults it."

- **Describe and only describe.** Austere, neutral, objective, factual. Resist explaining, instructing, discussing, opining; link to how-tos, explanation, tutorials instead.
- **Adopt standard patterns.** Consistency lets people use it; put things where readers expect, in formats they know.
- **Respect the structure of the machinery.** Documentation structure mirrors the product's, like a map and territory (without forcing an unnatural structure).
- **Provide examples** that illustrate without explaining.
- It may describe how something works or the correct way to use it, but not show how to perform tasks.
- Auto-generated reference keeps accuracy to the code, but "too many software developers think that auto-generated reference material is all the documentation required."

Language: state facts about the machinery and its behaviour (the page's example: "Django's default logging configuration inherits Python's defaults"); "Sub-commands are: a, b, c"; list options, flags, limitations, error messages; "You must use a. You must not apply b unless c." for warnings.

## Explanation  (/explanation/)

"A discursive treatment of a subject, that permits reflection." Understanding-oriented; higher and wider view than other types; answers "Can you tell me about ...?" Less urgent than the others, not less important.

- **Make connections**, even outside the immediate topic.
- **Provide context:** design decisions, historical reasons, technical constraints, implications, examples.
- **Talk about the subject:** bigger picture, history, choices/alternatives/possibilities, why.
- **Admit opinion and perspective;** weigh alternatives and counter-examples.
- **Keep it closely bounded.** It tends to absorb instruction and technical description; those belong elsewhere.
- Scope is open-ended, so a real or imagined "why" question helps draw lines.
- Titles read as "About ..." (About user authentication). Alternative section names: Discussion, Background, Conceptual guides, Topics.

Language: "The reason for x is because historically, y ..."; "W is better than z, because ..."; "Some users prefer w (because z). This can be a good approach, but ...".

## Tutorial vs how-to  (/tutorials-how-to/)

Both are practical, ordered sequences, which is why they get confused. "The single most common conflation made in software product documentation." The needs differ:

| | Tutorial | How-to guide |
| --- | --- | --- |
| User is at | study | work |
| Purpose | help the pupil acquire basic competence; a learning experience | help the already-competent user perform a task correctly |
| Path | managed, a single line, no choices or alternatives | forks and branches ("If this, then that") |
| Setting | contrived learning environment; eliminates the unexpected | the real world; prepares the user for the unexpected |
| Safety | must be safe: always possible to go back and start again | cannot promise safety; often one chance to get it right |
| Responsibility | the teacher's | the user's |
| Detail | explicit about basics (where to type, how long to wait); concrete and particular | relies on implicit knowledge; general, since cases differ |

**It is not basic vs advanced.** "a tutorial can present something complex or advanced. And, a how-to guide can cover something that's basic or well-known. The difference between the two lies in the need they serve: the user's study, or their work." A recipe is not a substitute for a cooking lesson, and someone who expected a recipe but is given a lesson "will be disappointed and annoyed" (/how-to-guides/).

## Reference vs explanation  (/reference-explanation/)

Both hold theoretical knowledge with no steps; the split is again work vs study. Rules of thumb: boring and unmemorable, or lists and tables of things, probably reference; something you could imagine reading in the bath, or an answer to "Can you tell me more about <topic>?", probably explanation. The real test: would someone turn to this while actually getting something done, or after stepping away from the work? Reference that expands with examples tends to slide into explanation; that hurts both.

## The four types at a glance  (/map/)

| | Tutorials | How-to guides | Reference | Explanation |
| --- | --- | --- | --- | --- |
| what they do | introduce, educate, lead | guide | state, describe, inform | explain, clarify, discuss |
| answers the question | "Can you teach me to...?" | "How do I...?" | "What is...?" | "Why...?" |
| oriented to | learning | goals | information | understanding |
| form | a lesson | a series of steps | dry description | discursive explanation |
| analogy | teaching a child to cook | a recipe in a cookery book | information on a food packet | an article on culinary social history |

## Checklists

Tutorial: states destination without "you will learn"; each step has a visible result; expected output shown; explanation reduced to a clause and a link; no options; run end to end by someone who is not the author.

How-to: title starts "How to" and names a user goal; assumes competence; no teaching; conditionals where reality forks; links out for options and rationale.

Reference: every entry has the same shape; nothing narrative; structure mirrors the product; examples are illustrative; warnings present where needed.

Explanation: bounded by a topic or "why" question; contains reasons, context and alternatives; no step lists or option tables.
