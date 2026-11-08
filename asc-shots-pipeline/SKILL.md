---
name: asc-shots-pipeline
description: Orchestrate iOS screenshot automation with xcodebuild/simctl for build-run, AXe for UI actions, JSON settings and plan files, Go-based framing (`asc screenshots frame`), and screenshot upload (`asc screenshots upload`). Use when users ask for automated screenshot capture, AXe-driven simulator flows, frame composition, or screenshot-to-upload pipelines.
---

# asc screenshots pipeline (xcodebuild -> AXe -> frame -> asc)

Use this skill for agent-driven screenshot workflows where the app is built and launched with Xcode CLI tools, UI is driven with AXe, and screenshots are uploaded with `asc`.

## Current scope
- Implemented now: build/run, AXe plan capture, frame composition, and upload.
- Device discovery is built-in via `asc screenshots list-frame-devices`.
- Local screenshot automation commands are experimental in asc cli.
- Framing is pinned to Koubou `0.13.0` for deterministic output.
- Feedback/issues: https://github.com/rudrankriyam/App-Store-Connect-CLI/issues/new/choose

## Defaults
- Settings file: `.asc/shots.settings.json`
- Capture plan: `.asc/screenshots.json`
- Raw screenshots dir: `./screenshots/raw`
- Framed screenshots dir: `./screenshots/framed`
- Default frame device: `iphone-air`

## Agent behavior
- Always confirm exact flags with `--help` before running commands.
- Re-check command paths with `asc screenshots --help` because screenshot commands are evolving quickly.
- Keep outputs deterministic: default to JSON for machine steps.
- Prefer `asc screenshots list-frame-devices --output json` before selecting a frame device.
- Ensure screenshot files exist before upload.
- Use explicit long flags (`--app`, `--output`, `--version-localization`, etc.).
- Treat screenshot-local automation as experimental and call it out in user-facing handoff notes.
- If framing fails with a version error, re-install pinned Koubou: `pip install koubou==0.13.0`.

## Pipeline checklist

- [ ] 1. `.asc/shots.settings.json` written; framing and upload toggles decided
- [ ] 2. App built, installed and launched on the target simulator
- [ ] 3. Screenshots captured from the plan; files present in the raw dir
- [ ] 4. Koubou 0.13.0 verified; screenshots framed (skip if `frame_enabled` is false)
- [ ] 5. Review generated and approved; uploaded; `asc screenshots list` confirms the set

## 1) Create settings JSON first

Create or update `.asc/shots.settings.json`:

```json
{
  "version": 1,
  "app": {
    "bundle_id": "com.example.app",
    "project": "MyApp.xcodeproj",
    "scheme": "MyApp",
    "simulator_udid": "booted"
  },
  "paths": {
    "plan": ".asc/screenshots.json",
    "raw_dir": "./screenshots/raw",
    "framed_dir": "./screenshots/framed"
  },
  "pipeline": {
    "frame_enabled": true,
    "upload_enabled": false
  },
  "upload": {
    "version_localization_id": "",
    "device_type": "IPHONE_65",
    "source_dir": "./screenshots/framed"
  }
}
```

If you intentionally skip framing, set:
- `"frame_enabled": false`
- `"upload.source_dir": "./screenshots/raw"`

## 2) Build and run app on simulator

Use Xcode CLI for build/install/launch:

```bash
xcrun simctl boot "$UDID" || true

xcodebuild \
  -project "MyApp.xcodeproj" \
  -scheme "MyApp" \
  -configuration Debug \
  -destination "platform=iOS Simulator,id=$UDID" \
  -derivedDataPath ".build/DerivedData" \
  build

xcrun simctl install "$UDID" ".build/DerivedData/Build/Products/Debug-iphonesimulator/MyApp.app"
xcrun simctl launch "$UDID" "com.example.app"
```

Use `xcodebuild -showBuildSettings` if the app bundle path differs from the default location.

## 3) Capture screenshots with AXe (or `asc screenshots run`)

Prefer plan-driven capture:

```bash
asc screenshots run --plan ".asc/screenshots.json" --udid "$UDID" --output json
```

Useful AXe primitives during plan authoring:

```bash
axe describe-ui --udid "$UDID"
axe tap --id "search_field" --udid "$UDID"
axe type "wwdc" --udid "$UDID"
axe screenshot --output "./screenshots/raw/home.png" --udid "$UDID"
```

Minimal `.asc/screenshots.json` example:

```json
{
  "version": 1,
  "app": {
    "bundle_id": "com.example.app",
    "udid": "booted",
    "output_dir": "./screenshots/raw"
  },
  "steps": [
    { "action": "launch" },
    { "action": "wait", "duration_ms": 800 },
    { "action": "screenshot", "name": "home" }
  ]
}
```

## 4) Frame screenshots with `asc screenshots frame`

asc cli pins framing to Koubou `0.13.0`.
Install and verify before running framing steps:

```bash
pip install koubou==0.13.0
kou --version  # expect 0.13.0
```

List supported frame device values first:

```bash
asc screenshots list-frame-devices --output json
```

Frame one screenshot (defaults to `iphone-air`):

```bash
asc screenshots frame \
  --input "./screenshots/raw/home.png" \
  --output-dir "./screenshots/framed" \
  --device "iphone-air" \
  --output json
```

Supported `--device` values:
- `iphone-air` (default)
- `iphone-17-pro`
- `iphone-17-pro-max`
- `iphone-16e`
- `iphone-17`

## 5) Upload screenshots with asc

Generate and review artifacts before upload:

```bash
asc screenshots review-generate --framed-dir "./screenshots/framed" --output-dir "./screenshots/review"
asc screenshots review-open --output-dir "./screenshots/review"
asc screenshots review-approve --all-ready --output-dir "./screenshots/review"
```

Upload from the configured source directory (default `./screenshots/framed` when framing is enabled):

```bash
asc screenshots upload \
  --version-localization "LOC_ID" \
  --path "./screenshots/framed" \
  --device-type "IPHONE_65" \
  --output json
```

List or validate before upload when needed:

```bash
asc screenshots sizes --output table
asc screenshots list --version-localization "LOC_ID" --output table
```

## 6) Multi-locale and parallel capture (optional)

For per-locale captures (one simulator UDID per locale, locale set through simulator defaults rather
than `-e AppleLanguages`), parallel capture scripts, and a full multi-locale pipeline example, see
[`references/multi-locale.md`](references/multi-locale.md).
