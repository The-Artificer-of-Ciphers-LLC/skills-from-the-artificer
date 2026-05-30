---
name: cunninghams-law
description: Apply Cunningham's Law when someone wants to elicit information, feedback, or corrections from others—especially online. Trigger on phrases like "how do I get people to respond?", "nobody is answering my question", "I want to get feedback on this", or when someone is drafting a question for Stack Overflow, a forum, a team Slack, or a pull request. Also useful when discussing how to get a conversation started or surface hidden knowledge within a team. Cunningham's Law is a surprisingly powerful practical tool for anyone trying to learn or get unstuck.
---

# Cunningham's Law

> "The best way to get the right answer on the internet is not to ask a question; it's to post the wrong answer."
> — Ward Cunningham, ~1980 (attributed)

## The core idea

People are more motivated to correct a wrong statement than to answer an open question. An open question requires someone to do mental work from scratch. A wrong answer hands them something concrete to push against — and people love pushing against wrong things.

This is counterintuitive but reliably true. It works in forums, in Slack, in code reviews, in design reviews, and in meetings.

## Why it works

- Answering an open question requires generating content from nothing. That's cognitively expensive.
- Correcting a wrong answer requires only spotting the error and fixing it. That's easier and, frankly, more satisfying.
- There's a social element: correcting someone is a chance to demonstrate knowledge and be helpful simultaneously.
- The specificity of a wrong answer gives people a clear target. "Is X the right approach?" generates more engagement than "What approach should I take?"

## How to apply it in practice

**Getting answers in forums or Slack:**
Instead of: "Does anyone know how to configure Redis persistence?"
Try: "I'm pretty sure you configure Redis persistence by editing redis.conf and setting `appendonly no`, right?"
The people who know will correct you immediately — and you'll get a better answer.

**In code reviews and design docs:**
Post a draft with a specific (possibly wrong) implementation choice. People will engage much more energetically with a concrete proposal than with a blank page.

**Surfacing team knowledge:**
If you want to know whether your team has experience with a technology, state a mildly wrong opinion about it: "I don't think anyone here has worked with Kafka before, so we'd be starting from scratch." You'll quickly find out if that's true.

**Unsticking a meeting:**
If a discussion stalls, propose something specific — even a deliberately imperfect proposal — to give people something to react to. Blank-slate brainstorming is hard; critique is easy.

## Ethical notes

Use this tool responsibly. Posting deliberately false information on public forums can spread misinformation if nobody corrects it. The law works best in settings where you can trust that knowledgeable people will engage, and where the stakes of an uncorrected wrong answer are low.

## Key questions to surface

1. What concrete (possibly wrong) statement could I make to invite correction?
2. Is there a specific proposal I could draft — even a rough one — to give people something to react to?
3. Am I asking an open question when I could be proposing an answer?

