# skills-from-the-artificer

A collection of [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) skills, distributed as drop-in directories. Each top-level folder is a self-contained skill — install it with the `skills` CLI, or copy it into `~/.claude/skills/` and restart Claude Code.

## Skills

| Skill | What it does |
|---|---|
| [`skills-from-the-artificer/`](skills-from-the-artificer/) | **Meta dispatcher.** Given a change, fix, diff, design, or decision, classifies it and points you at the relevant law/principle skill(s) from the 24-law collection below. The entry point for "which laws apply here?" and the Bug Remediation Step 2 cross-reference. |
| [`cost-tier-routing/`](cost-tier-routing/) | Routes work to the cheapest model that can do it correctly — haiku for search/IO, sonnet for coding, opus for orchestration. Ships a skill **and** three model-pinned subagents. |
| [`cost-routing/`](cost-routing/) | Top-level dispatcher that classifies requests into scout / coder / architect tiers and ships dispatch templates + a PreToolUse warning hook. Companion form to `cost-tier-routing`. |
| [`rubber-duck/`](rubber-duck/) | Interactive rubber-duck debugging session. Forces you to reconstruct your mental model of the bug from scratch, which is where the bug usually surfaces. |
| [`test-first-bugfix/`](test-first-bugfix/) | Test-driven bug fixing — reproduce the bug as a failing test before you touch the fix. Catches "fixes" that don't actually fix anything and prevents regressions. |
| [`trust-but-verify/`](trust-but-verify/) | Re-validates every claim a subagent hands back against a primary source — the code, docs/ADRs, the memory dir, context7, or a language spec — before you act on it. Treats a report as a lead, not a fact: nothing is verified until a source was opened and quoted. |
| [`artifact-gates/`](artifact-gates/) | **Makes workflow steps enforceable.** A step that produces no artifact cannot be enforced, and will be skipped — so each blocking step writes a file, and the next action is denied until that file exists. Ships a config-driven PreToolUse hook, two example contracts, and a 69-case behavioral suite. Turns self-attestation ("I ran the review") and prose policy ("admin-merge only for a missing reviewer") into machine-checked preconditions. |
| [`ci-preflight/`](ci-preflight/) | Pre-push checklist that prevents CI whiplash — multiple red pushes that could have been caught locally. Guards against three anti-patterns: missing registration surfaces when adding new shipped files, skipping `npm test` before pushing, and guessing at cross-platform fixes instead of diagnosing the root cause. |
| [`gsd-core-hooks/`](gsd-core-hooks/) | **A full hook suite, lifted from a real project.** Fourteen `PreToolUse`/`PostToolUse` scripts, each closing one named, dated incident: a passing test-runner verdict bound to the exact commit sha before push, no local `node --test`, Memtrace evidence required on a PR approval, and guards against harness poll/timeout false-negatives (backgrounded dispatch, foreground poll-loop kills, self-matching `pgrep` waits). Backs the rules `commands/` states in prose. Not generic — see its `README.md` for what to adapt. |
| [`writing-docs-with-diataxis/`](writing-docs-with-diataxis/) | Write, restructure, or audit docs with the Diátaxis framework (tutorial / how-to / reference / explanation). Splits mixed READMEs by reader need and includes a mapping for documenting a skills repo. |

### Migrated from the Mac mini (Swift/iOS, App Store Connect, ADR coverage)

Some of these originate upstream (e.g. the `swiftui-*` and `asc-*` sets); they're collected here so one install covers every machine. The Dimillian/Skills set (`swiftui-ui-patterns`, `swiftui-liquid-glass`, `swiftui-performance-audit`, `ios-debugger-agent`, …) is deliberately not vendored — install it from [upstream](https://github.com/Dimillian/Skills).

| Skill | What it does |
|---|---|
| [`adr-phase-coverage/`](adr-phase-coverage/) | Use when a user needs to turn a design doc, ADR, RFC, or spec into a phased implementation plan — or verify that an existing phase… |
| [`apple-on-device-ai/`](apple-on-device-ai/) | Integrate on-device AI using Foundation Models framework, Core ML, and open-source LLM runtimes on Apple Silicon. Covers Foundation Models… |
| [`asc-app-create-ui/`](asc-app-create-ui/) | Create a new App Store Connect app record via browser automation. Use when there is no public API for app creation and you need an agent to… |
| [`asc-build-lifecycle/`](asc-build-lifecycle/) | Track build processing, find latest builds, and clean up old builds with asc. Use when managing build retention or waiting on processing. |
| [`asc-cli-usage/`](asc-cli-usage/) | Guidance for using asc cli in this repo (flags, output formats, pagination, auth, and discovery). Use when asked to run or design asc… |
| [`asc-crash-triage/`](asc-crash-triage/) | Triage TestFlight crashes, beta feedback, and performance diagnostics using asc. Use when the user asks about TF crashes, TestFlight crash… |
| [`asc-id-resolver/`](asc-id-resolver/) | Resolve App Store Connect IDs (apps, builds, versions, groups, testers) from human-friendly names using asc. Use when commands require IDs. |
| [`asc-localize-metadata/`](asc-localize-metadata/) | Automatically translate and sync App Store metadata (description, keywords, what's new, subtitle) to multiple languages using LLM… |
| [`asc-metadata-sync/`](asc-metadata-sync/) | Sync and validate App Store metadata and localizations with asc, including legacy metadata format migration. Use when updating metadata or… |
| [`asc-notarization/`](asc-notarization/) | Archive, export, and notarize macOS apps using xcodebuild and asc. Use when you need to prepare a macOS app for distribution outside the… |
| [`asc-ppp-pricing/`](asc-ppp-pricing/) | Set territory-specific pricing for subscriptions and in-app purchases using current asc setup, pricing summary, price import, and price… |
| [`asc-release-flow/`](asc-release-flow/) | End-to-end release workflows for TestFlight and App Store using asc publish, builds, versions, and submit commands. Use when asked to… |
| [`asc-revenuecat-catalog-sync/`](asc-revenuecat-catalog-sync/) | Reconcile App Store Connect subscriptions and in-app purchases with RevenueCat products, entitlements, offerings, and packages using asc… |
| [`asc-shots-pipeline/`](asc-shots-pipeline/) | Orchestrate iOS screenshot automation with xcodebuild/simctl for build-run, AXe for UI actions, JSON settings and plan files, Go-based… |
| [`asc-signing-setup/`](asc-signing-setup/) | Set up bundle IDs, capabilities, signing certificates, and provisioning profiles with the asc cli. Use when onboarding a new app or… |
| [`asc-submission-health/`](asc-submission-health/) | Preflight App Store submissions, submit builds, and monitor review status with asc. Use when shipping or troubleshooting review submissions. |
| [`asc-subscription-localization/`](asc-subscription-localization/) | Bulk-localize subscription and in-app purchase display names across all App Store locales using asc. Use when you want to fill in… |
| [`asc-testflight-orchestration/`](asc-testflight-orchestration/) | Orchestrate TestFlight distribution, groups, testers, and What to Test notes using asc. Use when rolling out betas. |
| [`asc-wall-submit/`](asc-wall-submit/) | Submit or update a Wall of Apps entry in the App-Store-Connect-CLI repository using the existing generate-and-PR flow. Use when the user… |
| [`asc-workflow/`](asc-workflow/) | Define, validate, and run repo-local multi-step automations with `asc workflow` and `.asc/workflow.json`. Use when migrating from lane… |
| [`asc-xcode-build/`](asc-xcode-build/) | Build, archive, and export iOS/macOS apps with xcodebuild before uploading to App Store Connect. Use when you need to create an IPA or PKG… |
| [`developing-ios-apps/`](developing-ios-apps/) | Develops iOS/macOS applications with XcodeGen, SwiftUI, and SPM. Handles Apple Developer signing, notarization, and CI/CD pipelines.… |
| [`ios-accessibility/`](ios-accessibility/) | Implements, reviews, or improves accessibility in iOS/macOS apps with SwiftUI, UIKit, and AppKit. Use when adding VoiceOver, Voice Control,… |
| [`mobile-ios-design/`](mobile-ios-design/) | Master iOS Human Interface Guidelines and SwiftUI patterns for building native iOS apps. Use when designing iOS interfaces, implementing… |
| [`swift-concurrency/`](swift-concurrency/) | Diagnose Swift Concurrency issues, refactor callback-based code to async/await, and guide Swift 6 migration when working with tasks,… |
| [`swift-mcp-server-generator/`](swift-mcp-server-generator/) | Generate a complete Model Context Protocol server project in Swift using the official MCP Swift SDK package. |
| [`swift-testing-expert/`](swift-testing-expert/) | Expert guidance for Swift Testing: test structure, #expect/#require macros, traits and tags, parameterized tests, test plans, parallel… |
| [`swiftdata/`](swiftdata/) | Implement, review, or improve data persistence using SwiftData. Use when defining @Model classes with @Attribute, @Relationship,… |
| [`swiftui-expert-skill/`](swiftui-expert-skill/) | Use when writing, reviewing, or refactoring SwiftUI code for iOS or macOS, including state management, view composition, performance,… |
| [`swiftui-pro/`](swiftui-pro/) | Comprehensively reviews SwiftUI code for best practices on modern APIs, maintainability, and performance. Use when reading, writing, or… |
| [`xcodebuildmcp-cli/`](xcodebuildmcp-cli/) | Official skill for the XcodeBuildMCP CLI. Use when doing iOS/macOS/watchOS/tvOS/visionOS work (build, test, run, debug, log, UI automation). |
| [`test-orphan-guard/`](test-orphan-guard/) | Reaps orphaned test-runner processes left behind by agent test runs; ships a guarded test wrapper, a Stop-hook entry, and shell integration. |
| [`no-defer/`](no-defer/) | Prevents an agent from deferring, postponing, or skipping parts of a task — every item must be completed before reporting done. |
| [`swift-agents/`](swift-agents/) | **Swift agent team (fork of [Techopolis/swift-agents](https://github.com/Techopolis/swift-agents), MIT).** `swift-lead` orchestrator plus 15 specialist subagents (concurrency, SwiftUI, SwiftData, StoreKit, accessibility, on-device AI, …) and a hook that delegates Swift tasks to the lead. Installs to `~/.claude/agents/`, not `skills/`; see its README. Upstream last updated March 2026; maintained here. Fork: [The-Artificer-of-Ciphers-LLC/swift-agents](https://github.com/The-Artificer-of-Ciphers-LLC/swift-agents). |

### Debugging, release and money-handling workflow (generalized from a production iOS project)

| Skill | What it does |
|---|---|
| [`fix-regression-guard/`](fix-regression-guard/) | Mandatory regression analysis before committing a bug fix. Use before any fix commit, after any change to a guard, condition, ownership check, or… |
| [`post-fix-trace/`](post-fix-trace/) | Second-pass regression trace after a bug fix, to catch what the fix itself broke. Use after completing a fix from your debug workflow (trace-based… |
| [`debug-test-capture/`](debug-test-capture/) | Turns a finished debug session into permanent regression tests. Use right after a bug fix is verified or committed: after a post-fix regression trace… |
| [`trace-fix/`](trace-fix/) | Evidence-gated debugging protocol for iOS/macOS and Swift apps: trace the execution path, locate the exact divergence, prove the root cause, and only… |
| [`work-journal/`](work-journal/) | Record and recall per-branch session decisions across sessions and agent worktrees using an append-only local markdown journal. Use at the end of… |
| [`testflight-publish/`](testflight-publish/) | Orchestrates an end-to-end TestFlight release: pre-flight checks, archive, upload to App Store Connect, waiting for build processing, distributing to… |
| [`testflight-release-notes/`](testflight-release-notes/) | Writes tester-facing TestFlight "What to Test" notes and App Store "What's New" release notes from raw developer input such as a git log since the… |
| [`money-boundary-judgment/`](money-boundary-judgment/) | How to cross an API that forces Double (framework parameters, chart plot values, any Double-only library) without breaking a "Decimal for money"… |
| [`ios-simulator-boot-health/`](ios-simulator-boot-health/) | Diagnose and handle iOS simulator boot failures ("PosterBoard status -5", no healthy simulator, a shard that ran no tests) on a shared Mac: what the failure is, safe vs unsafe `simctl` commands, and judging a test run by its log and xcresult instead of an exit status. Written for Coincert's `scripts/test-ios.sh`; adapt the UDIDs and env vars. |

## Not a skill

| Directory | What it is |
|---|---|
| [`claude-guards/`](claude-guards/) | **Personal guard hooks, version-controlled.** Thirteen `PreToolUse`/`SessionStart`/`Stop`/`SubagentStop` scripts kept here and symlinked into `~/.claude/hooks/`, so the canonical copy is in git rather than only on one machine. Registered at user scope, so they apply across every project: Memtrace-first code discovery, model-tier routing, no-defer enforcement, worktree discipline, CI-rerun blocking. Three ship regression suites (199 / 49 / 66 cases). Not packaged, no `SKILL.md`, not installable with the `skills` CLI — read it as a worked example of hook scoping, not as a drop-in. |

Distinct from [`gsd-core-hooks/`](gsd-core-hooks/), which is a packaged skill documenting *one
project's* suite. `claude-guards/` is cross-project policy.

## Commands

[`commands/`](commands/) holds workflow directives as Claude Code **slash commands** —
`/feature-builder`, `/bug-fixer`, `/triage-review`, `/review-open-prs`. These replace the former
`directives/` folder: same procedures, now invocable rather than pasted, with frontmatter declaring
the tools each may touch.

```bash
cp commands/*.md ~/.claude/commands/
```

They are written against one project's toolchain (its test runner, label vocabulary, and controlling
files) and are a starting shape rather than a drop-in — see [`commands/README.md`](commands/README.md)
for what to adapt. Three of them depend on [`artifact-gates/`](artifact-gates/) for enforcement;
without that hook their artifact contracts are just prose. [`gsd-core-hooks/`](gsd-core-hooks/) ships
the fuller suite these commands were originally run against — test-verdict gating, no-local-test,
Memtrace-first — as a reference for what "machine-enforced" looked like in the source project.

### Laws of software (24 reference skills)

A pack of software-engineering laws, each loaded as an on-demand reference skill. Every law is its own top-level directory:

[`choose-boring-technology/`](choose-boring-technology/) ·
[`conways-law/`](conways-law/) ·
[`cunninghams-law/`](cunninghams-law/) ·
[`doerrs-law/`](doerrs-law/) ·
[`fitts-law/`](fitts-law/) ·
[`galls-law/`](galls-law/) ·
[`goodharts-law/`](goodharts-law/) ·
[`greenspuns-tenth-rule/`](greenspuns-tenth-rule/) ·
[`hofstadters-law/`](hofstadters-law/) ·
[`hyrums-law/`](hyrums-law/) ·
[`kerckhoffs-principle/`](kerckhoffs-principle/) ·
[`kernighans-law/`](kernighans-law/) ·
[`knuths-optimization-principle/`](knuths-optimization-principle/) ·
[`lady-lovelaces-objection/`](lady-lovelaces-objection/) ·
[`leaky-abstractions/`](leaky-abstractions/) ·
[`linuss-law/`](linuss-law/) ·
[`moores-law/`](moores-law/) ·
[`norvigs-law/`](norvigs-law/) ·
[`parkinsons-law/`](parkinsons-law/) ·
[`peter-principle/`](peter-principle/) ·
[`postels-law/`](postels-law/) ·
[`shirky-principle/`](shirky-principle/) ·
[`wirths-law/`](wirths-law/) ·
[`zawinskis-law/`](zawinskis-law/)

## Install (recommended: the `skills` CLI)

The [`skills`](https://skills.sh/) CLI discovers each top-level skill and installs it for you. Add `-g` to install globally (user-level, into `~/.claude/skills/`) instead of into the current project.

```bash
# install everything
npx skills add The-Artificer-of-Ciphers-LLC/skills-from-the-artificer --all -g

# or choose interactively
npx skills add The-Artificer-of-Ciphers-LLC/skills-from-the-artificer -g

# or install specific skills
npx skills add The-Artificer-of-Ciphers-LLC/skills-from-the-artificer -g --skill conways-law,rubber-duck
```

## Install (manual)

Each skill is also a `cp -r` away:

```bash
# pick the ones you want
cp -r rubber-duck ~/.claude/skills/
cp -r test-first-bugfix ~/.claude/skills/
cp -r conways-law ~/.claude/skills/

# or grab every law at once
cp -r *-law *-principle *-rule *-objection *-technology *-abstractions ~/.claude/skills/
```

Restart Claude Code. The skill discovery scan runs at session start.

## Install (skills that ship agents too)

`cost-tier-routing/` is unusual — it includes companion subagents that have to land in `~/.claude/agents/`, not `~/.claude/skills/`. Its `README.md` documents the two-step install. The skill alone is inert without the agents because the `model:` pin lives in the agent files.

```bash
cd cost-tier-routing
mkdir -p ~/.claude/skills/cost-tier-routing ~/.claude/agents
cp SKILL.md ~/.claude/skills/cost-tier-routing/
cp agents/*.md ~/.claude/agents/
```

## Install (skills that ship hooks too)

`cost-routing/`, `artifact-gates/`, and `gsd-core-hooks/` include hooks that must land in
`~/.claude/hooks/` **and** be registered under `PreToolUse`/`PostToolUse` in `settings.json`. Each
has a `README.md` with the exact snippet.

An unregistered hook — or one registered with a path your Claude Code version does not expand —
fails open **silently**, and that looks exactly like a hook that is working and has nothing to
complain about. `artifact-gates/` ships `test/gate-test.sh` so you can prove the engine works before
trusting it; confirm the wiring separately by triggering a gate on purpose.

## How skills work

A skill is a directory containing a `SKILL.md` with YAML frontmatter — `name` and `description` — followed by the prose Claude Code reads when the skill triggers. The description is the trigger surface: Claude scans loaded skill descriptions against the current task and invokes a skill via the `Skill` tool when the description matches. Skills can ship supporting files (eval suites, reference scripts, sub-skills) alongside `SKILL.md`.

See the [Claude Code skills docs](https://docs.claude.com/en/docs/claude-code/skills) for the canonical reference.

## Evals

Some skills include an `evals/evals.json` file with prompts and expected behaviors. These are consumed by the `skill-creator` workflow to benchmark whether a skill triggers correctly and produces the expected routing decisions. The format is intentionally minimal:

```json
{
  "skill_name": "<name>",
  "evals": [
    {
      "id": 0,
      "prompt": "<user prompt that should trigger the skill>",
      "expected_output": "<what Claude should do, prose>",
      "files": []
    }
  ]
}
```

## Contributing a skill

1. Create a top-level directory named after the skill (kebab-case).
2. Drop in a `SKILL.md` with the frontmatter `name:` and `description:` fields, followed by the body Claude should read.
3. Optionally add `evals/evals.json` with trigger prompts and expected behaviors.
4. Optionally add a per-skill `README.md` documenting anything unusual about the install (e.g. companion agents).
5. PR.

## License

Skills in this repo are MIT-licensed unless a skill's own directory says otherwise.
