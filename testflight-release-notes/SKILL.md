---
name: testflight-release-notes
description: >
  Writes tester-facing TestFlight "What to Test" notes and App Store "What's New" release notes from raw
  developer input such as a git log since the last tag, commit list, issue titles, or rough bullets. Filters
  out internal noise and keeps only user-impacting changes, in plain text with tone and length rules. Use
  when the user asks for "what to test notes", "TestFlight notes", "beta notes", "release notes", "App Store
  release notes", or "what's new" text.
---

# TestFlight Release Notes

Produces the text testers see when they tap "What to Test" in TestFlight, and (with the length and tone tweaks below) the App Store "What's New" text. Input is whatever the developer has: git log, bullets, issue titles, or almost nothing.

## Method

1. Collect changes. If the user gave none, gather commits since the last tag (or a ref they name):
   ```bash
   git log $(git describe --tags --abbrev=0 2>/dev/null || echo "HEAD~20")..HEAD --oneline
   ```
2. Filter to user-impacting changes only (see below).
3. Translate each into what the person using the app experiences.
4. Group into sections, apply tone and length rules, output plain text.

## Filtering

Skip internal noise testers never see or feel:
- Dependency updates and lockfile changes
- Version and build number bumps
- Merge commits
- CI/CD changes
- Refactors with no visible effect
- Work behind feature flags (unless the flag is being enabled)
- Documentation and test-only changes

Keep anything that changes how the app looks, feels, or behaves.

## Output format

Plain text only. TestFlight renders text literally, so no markdown (`**`, `##`, `*`, links).
- Section headers in ALL CAPS
- List items start with "- "
- Blank line between sections
- Only include sections that have content

Length: TestFlight's limit is 4,000 characters for What to Test. If over, keep the most impactful changes. For App Store "What's New", aim for a short paragraph or a handful of bullets (hard limit 4,000 characters, but shorter is better) and drop the WHAT TO TEST and KNOWN ISSUES sections, which belong to beta builds only.

## Section order

1. Build line: "Build [number]" only if the developer provided one. Never guess a number.
2. WHAT'S NEW: brand-new features or capabilities.
3. IMPROVEMENTS: existing things that work or look better.
4. BUG FIXES: describe the symptom, not the cause ("Fixed a crash when opening the settings screen", not "Fixed nil unwrap in SettingsViewModel").
5. KNOWN ISSUES: only if the developer mentioned them. Do not invent.
6. WHAT TO TEST: only if the developer asked testers to focus somewhere. Be specific ("Create a new item and check the total updates immediately", not "Test items").

## Tone

Friendly, direct developer-to-early-user voice. Present tense ("The app now shows..."). Specific over vague.

Do: translate jargon into experience; name the screen or flow affected.
Don't: corporate speak ("We are pleased to announce"), internal jargon ("refactored the sync pipeline"), vague filler ("various improvements"), or heavy exclamation marks.

## Sparse input

For input like "minor fixes", write the most useful notes possible without inventing specifics, then add one blank-line-separated tip at the end: "Tip: Sharing specific changes (even rough notes) helps testers know what to focus on and catches more bugs." Skip the tip when the input was reasonably detailed.

## Example

Input:
```
a1b2c3d fix: crash when deleting an item in a list
d4e5f6g feat: add rollover toggle in settings
h7i8j9k chore: bump version
l0m1n2o fix: sync dropping notes field
p3q4r5s refactor: extract list view model
t6u7v8w feat: progress bar on dashboard
x9y0z1a ci: update pipeline config
f5g6h7i docs: update API documentation
```

Output (build 12 supplied by the developer):
```
Build 12

WHAT'S NEW
- Rollover is here. Turn it on in Settings to carry unused amounts into the next period
- Goals now show a progress bar on the dashboard so you can see how close you are at a glance

BUG FIXES
- Fixed a crash that could happen when deleting an item from a list
- Notes now sync correctly between devices
```

Filtered out: version bump, refactor, CI, and docs commits. The sync fix was reworded from an internal cause to what a tester notices.
