---
name: greenspuns-tenth-rule
description: Apply Greenspun's Tenth Rule when reviewing complex codebases that have grown their own configuration systems, rule engines, templating languages, scripting layers, or workflow DSLs. Trigger on phrases like "we built our own config language", "we have a custom rules engine", "this template system has gotten really complex", "we're basically reimplementing X ourselves", or any time a team has reinvented a programming language feature or general-purpose tool inside their application. This rule is a useful diagnostic for spotting accidental complexity.
---

# Greenspun's Tenth Rule

> "Any sufficiently complicated C or Fortran program contains an ad hoc, informally-specified, bug-ridden, slow implementation of half of Common Lisp."
> — Philip Greenspun

## The core idea

When a program grows complex enough, developers eventually need features that their current language or framework doesn't easily provide: dynamic dispatch, higher-order functions, user-configurable behavior, extensibility hooks. Rather than adopting a language or tool that has these features natively, they build them from scratch — usually badly, incompletely, and without realizing that's what they're doing.

The result is a half-implemented, poorly-documented programming language or runtime lurking inside a codebase that was never meant to host one.

## What this looks like in practice

- A configuration file format that has grown conditionals, loops, and variables → you've built a scripting language
- A "template engine" with logic, iteration, and state → you've built a programming language
- A rules engine with complex precedence and side effects → you've built an interpreter
- A workflow system with retries, timeouts, and branching → you've built a runtime
- A plugin system with dynamic loading and lifecycle hooks → you've built a module system

The key tell: these systems are always **informal** (undocumented), **incomplete** (missing features that users keep requesting), **buggy** (edge cases not handled), and **slow** (performance not considered in the original design).

## Why it happens

Engineers solve the immediate problem in front of them. The first version is simple and reasonable: "we just need a config flag." Then "the flag needs to be conditional." Then "we need to reuse this condition elsewhere." Then "we need a way to script this." Nobody decided to build a language — they just kept solving the next problem.

## What to do about it

**Recognize the pattern early.** When you find yourself adding "variables" or "conditionals" to a config file, stop and ask: are we building a language? If yes — do it on purpose, with proper tooling.

**Embrace an existing language or tool.** Lua, Python, JavaScript, YAML with a real schema validator, Jsonnet, Starlark, HCL — many languages were specifically designed to be embedded as scripting layers. They come with documentation, debuggers, and community knowledge.

**If you must build a DSL, build it intentionally.** Decide explicitly that you're building a language. Define it formally. Provide documentation and error messages. Think about the user experience of writing in it.

**Use the rule as a refactoring trigger.** If you discover a Greenspun situation in an existing codebase, that's a signal to extract, formalize, or replace the ad hoc system — not necessarily to add features to it.

## Key questions to surface

1. Does our configuration/template/rule system have features that feel like programming language features (conditionals, loops, variables)?
2. Is this system documented? Can new team members learn it from docs, or only by reading code?
3. Would adopting an existing scripting language (Lua, Python embedded, etc.) give us what we need, with less maintenance burden?
4. Are we repeatedly adding features to a system that was never designed to be this complex?

