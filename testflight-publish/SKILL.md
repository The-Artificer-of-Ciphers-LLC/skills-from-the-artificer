---
name: testflight-publish
description: >
  Orchestrates an end-to-end TestFlight release: pre-flight checks, archive, upload to App Store Connect,
  waiting for build processing, distributing to beta groups, setting What to Test notes, and verifying the
  build landed. Use when the user says "publish to TestFlight", "upload build", "ship it to testers",
  "push to TestFlight", "distribute build", or "check if the build landed". Requires the user's own
  App Store Connect API credentials (via environment variables) and build script or xcodebuild setup.
---

# TestFlight Publish

Chains the TestFlight pipeline into one flow: verify app state, prepare What to Test notes, build and upload, wait for processing, distribute to beta groups, then verify the result.

This skill contains no credentials or app identifiers. Everything app-specific comes from your environment or project config.

## Configuration (do this once)

Set these as environment variables (shell profile, CI secret store, or a git-ignored `.env`). Never commit them and never paste them into chat or notes.

| Variable | Meaning |
|----------|---------|
| `ASC_KEY_ID` | App Store Connect API key ID |
| `ASC_ISSUER_ID` | App Store Connect API issuer ID |
| `ASC_KEY_PATH` | Path to the API private key file (keep it outside the repo) |
| `BUNDLE_ID` | Your app's bundle identifier, `<your.bundle.id>` |
| `APP_ID` | Numeric App Store Connect app ID, `<APP_ID>` (resolve it in Phase 1 if unset) |

If any are missing, stop and ask the user to configure them. Do not guess values or search the machine for keys.

Also needed: a way to build and upload. Either your project's own build script (referred to below as "your build script"), the `asc` CLI (`asc publish`, see the `asc-release-flow` skill), or plain `xcodebuild archive` + `xcodebuild -exportArchive` (see `asc-xcode-build`).

## Procedure

### Phase 1: Pre-flight verification

1. Resolve the app: `asc apps list` filtered by `$BUNDLE_ID` (see `asc-id-resolver`), or the ASC MCP equivalent if connected. Capture the app ID as `$APP_ID`.
2. List beta groups for the app and the tester count per group (`asc-testflight-orchestration`). Keep calls lean; avoid fetching full metadata.
3. Read the current local build number from the project (for example `agvtool what-version`, or `CURRENT_PROJECT_VERSION` in the project file or xcconfig).
4. Run pre-flight checks: clean or intentionally dirty git tree, signing identity and provisioning profile valid, required tests pass, version and build number higher than the latest uploaded build.
5. Report: local version and build number, beta groups with tester counts, any warnings.
6. If the app is not found or no beta groups exist, STOP and report. Do not build.

### Phase 2: What to Test notes

1. If the user supplied notes, use them as-is.
2. Otherwise invoke the `testflight-release-notes` skill with the commits since the last tag:
   ```bash
   git log $(git describe --tags --abbrev=0 2>/dev/null || echo "HEAD~20")..HEAD --oneline
   ```
3. Show the final notes and wait for explicit approval before uploading.

### Phase 3: Archive and upload

Run your build script, or the equivalent generic steps:

```bash
# Option A: your project's build script (must itself read ASC_* from the environment)
./<your-build-script> --notes "<approved notes>"

# Option B: asc CLI
asc publish testflight --app "$APP_ID" --ipa <path/to/App.ipa> --group "<group name>"

# Option C: manual
xcodebuild archive -scheme <YourScheme> -archivePath build/App.xcarchive -destination 'generic/platform=iOS'
xcodebuild -exportArchive -archivePath build/App.xcarchive -exportOptionsPlist ExportOptions.plist -exportPath build/export
```

Check `asc publish --help` for the current flags; do not assume them from memory.

Execution: archives can take many minutes. Run in the background with a long timeout and watch the output. Any interactive confirmation prompt in your script must be bypassed with its non-interactive flag when running in the background.

Treat these outcomes as follows:
- Upload accepted but still processing: not a failure, continue to Phase 4.
- Archive failure: usually signing or a build error. Report the last error lines of the log.
- Upload failure: network or App Store Connect issue. Retry once, and check Apple's system status page.
- Increment the build number only after a successful upload, and commit that bump deliberately.

### Phase 4: Wait for processing and distribute

Can run standalone ("check if the build landed" skips Phases 1-3; resolve `$APP_ID` again first).

1. Find the newest build (`asc builds list` sorted by upload date) and poll its processing state until it is VALID. Processing typically takes 5-30 minutes, occasionally longer (`asc-build-lifecycle`).
2. Set the What to Test text on the build for the relevant locale.
3. Add the build to the intended beta groups. External groups may require a beta app review submission and export-compliance answers; report if that is pending.
4. Verify: build version and number, processing state, groups assigned, tester count per group.
5. If the build is not visible yet, say so and suggest checking again in a few minutes. After 30+ minutes, point the user to the App Store Connect dashboard.

### Phase 5: Summary

```
TESTFLIGHT PUBLISH SUMMARY

Build:      [version] ([build number])
Platforms:  [iOS, macOS, or both]
Status:     [processing / ready for testing / in beta review]

Beta Groups:
- [Group Name]: [N] testers

What to Test:
[first 2-3 lines of the notes]

Warnings:
- [issues, or "None"]
```

## Shortcuts the user may ask for

- "skip notes" / inline notes: skip the release-notes skill, use the provided text.
- "just build": skip Phase 1 verification.
- "check if the build landed": run only Phase 4.
- "run tests first": run the test suite before archiving.
- "dry run": print the plan and commands without executing.

## Rollback and recovery

A processed TestFlight build cannot be un-uploaded. To pull a bad build: expire it in App Store Connect (or `asc builds expire`), remove it from its groups, then upload a fixed build with a higher build number and fresh notes.

## Error handling

- API or MCP tools unavailable: fall back to the build script or xcodebuild only, say verification was skipped, and suggest checking the dashboard manually.
- Authentication errors (401/403): re-check `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_PATH` and the key's role. Never print the key contents.

## Related skills

| Skill | Relationship |
|-------|-------------|
| `testflight-release-notes` | Phase 2: generates What to Test text |
| `asc-release-flow` | Generic `asc publish` flow |
| `asc-testflight-orchestration` | Groups, testers, notes |
| `asc-build-lifecycle` | Processing status and build cleanup |
| `asc-xcode-build` | Archive and export commands |

This skill is for the publish action itself, not a readiness audit. For a significant release, run your own release-readiness checks first.
