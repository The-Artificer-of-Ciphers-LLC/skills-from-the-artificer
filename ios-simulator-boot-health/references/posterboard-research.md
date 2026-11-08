# PosterBoard boot rejection research (2026-10-26)
## Local evidence (VERIFIED)
- Xcode 27.1 (27A9275), macOS 27.0.1 (26A434), only runtime iOS 27.0 (24A434) + watchOS 27.0. Disk 2.3Ti free. CoreSimulator Devices 15G, 15 devices. Load1 12-20 at boot (quiet.txt), up 5d19h.
- 6 PosterBoard-*.ips in ~/Library/Logs/DiagnosticReports: 10-25 13:00, 10-25 17:01, 10-26 02:33, 03:12, 03:46, 10:41. All EXC_BREAKPOINT/SIGTRAP, parent launchd_sim, coalition = sim UDIDs (4DE38443, 85330DFD x3, 5CEF7C7B).
- 5 of 6 (all but 10-25 17:01) crash in +[NSURL(PosterFoundation) pf_posterPathInstanceURLForVersionsURL:version:].cold.1 <- PBFPosterModelStoreCoordinator _accessQueue_configureFileSystemForNewContents:atPath:error: <- addNewVersionWithContents/stageNewVersionWithContents <- PBFPosterExtensionDataStore _stateLock_ingestReloadedDescriptors... (10:41 report) or PBFPosterRoleCoordinator _ingestIncomingPosterConfiguration (03:46). .cold = failure/assert path: a precondition inside PosterBoard while ingesting a poster (wallpaper) version into its model store at first boot. Same fault address 0x1f856cc80 in different runs -> deterministic code path, not random/memory. 17:01 one: BSXPCServiceConnectionProxy invokeMethod (XPC callout trap).
- Report 10:41:08 procLaunch 10:41:02, captured 10:41:06 -> died 4 s after launch; vmSummary tiny (no memory pressure in the process). No jetsam, no dyld, no codesign signal in the reports.
- Wrapper: /tmp/coincert-results-ios-0c3760cf-83794-1793025480-diag/settle.txt: load1=12.99 at boot, baseline PosterBoard pid=-, REJECT at +7s status -5. repair.txt: wrapper then diagnosed, shut down and erased 85330DFD.
- simctl-diagnose-85330DFD folder is EMPTY (0 files); simctl-diagnose.log exists. ~/Library/Logs/CoreSimulator/<UDID>/ does not exist for either UDID; CoreSimulator.log has no PosterBoard lines. Nothing about launchd_sim throttling found.
- `status -5`: scripts/lib/ios-diag.sh:165-187 reads `xcrun simctl spawn <UDID> launchctl list`, column 2 of com.apple.PosterBoard (line 174). launchctl shows last exit status; negative = killed by that signal; -5 = SIGTRAP, matching the .ips. Any non-zero status rejects (174, 209-210). Pid "-" with baseline is tolerated (183-185).
- So the check is NOT too strict: it reports a genuine PosterBoard crash that macOS itself logs as a crash report. Slack: window and baseline do not tolerate a single launchd respawn that may succeed (a retried PosterBoard may run); load only shifts timing.
## Correlation
- Load: failures at 02:33/03:12/03:46 (overnight) and 10:41 (load1 13) - not proven load related; crash is a deterministic assert. Disk and memory are not implicated. Stale store: LIKELY (the assert is in poster model-store filesystem setup; erase sometimes cures) but UNVERIFIED - the device data dir was already erased at 10:41:12, so no stale Library to inspect.
## Web (no authoritative source for this crash found)
- ANECDOTAL/SEMI: https://developer.apple.com/forums/thread/806908 and /806225 (Apple forum, Nov 2025, iOS 26.1 sim: MercuryPosterExtension crash loop, ReportCrash high CPU; Apple DTS asked for simctl diagnose; one reply says 26.1.1 fixed, another says still in 26.2 beta; setting a wallpaper reported to help some). Not the same symbol.
- https://developer.apple.com/forums/thread/851886 (Xcode 27.1 iPhone Duo "Data Migration Failed" on bootstatus; FB25221101) - related first-boot data failure, different device.
- https://developer.apple.com/forums/thread/811259 (iOS 26.x launchd_sim could not bind to session) - different failure.
- https://developer.apple.com/forums/thread/711121 (2022 PosterBoard quit, old beta) - irrelevant to 27.
- CircleCI discuss.circleci.com/t/xcode-26-rc/54066 : iOS 26 sim hangs ~10%, workaround force shutdown+reboot after 60s. ANECDOTAL.
- Nothing found in Xcode 26/27 release notes for pf_posterPathInstanceURL; I did not open release notes pages (UNVERIFIED either way). Nothing authoritative.
## Pasted advice, item by item
1. Erase all / erase device: partially supported (our own repair.txt erase sometimes works; matches forum "wallpaper/data" lead, ANECDOTAL). `simctl erase all` UNSAFE here: it errors/refuses on booted devices but would wipe iPhone 18 Pro/17e state once shut down by others; use `xcrun simctl erase <UDID>` on the shut-down test device only.
2. Kill CoreSimulatorService / Simulator: no source ties it to this crash; UNSAFE - kills other sessions' booted sims (18 Pro 28D8B2DE, 17e 70BA6F3F) and their tests. Do not.
3. Switch runtime: NOT possible - only iOS 27.0 installed. Downloading another runtime is a no-action item unless owner wants it.
4. Cold boot: valid and cheap; wrapper already boots from Shutdown. No Apple doc says paused state matters.
Verdict: advice is generic, not authoritative, not specific to this crash.
## Recommendations (ranked)
1. Scoped erase + one retry already exists (repair); make it retry once more before failing and keep it UDID-scoped. Benefit high (matches observed cure), risk low. Edit: scripts/lib/ios-diag.sh settle reject path / repair loop.
2. Treat a PosterBoard respawn as soft: on status -5, wait up to ~20s for launchctl pid to reappear with status 0 and then require stability, instead of immediate reject at ios-diag.sh:208-210. LIKELY helps only if PosterBoard recovers after the crash (UNVERIFIED; check later pid in a failed run).
3. Boot with `simctl bootstatus <UDID> -b` after boot (waits for data migration, would expose status 3 like thread 851886). Low risk.
4. Serialize boots: wait on a lock file so only one session boots at a time (quiet-load gate already exists, thresh 13.5). Low benefit for a deterministic assert.
5. Golden clone: erase+boot one device once, set a wallpaper, shut down, `simctl clone` per run. Benefit LIKELY (avoids first-boot poster ingestion), UNVERIFIED; moderate effort.
6. Capture evidence on failure: simctl diagnose folder was empty; copy the matching ~/Library/Logs/DiagnosticReports/PosterBoard-*.ips next to settle.txt (ios-diag.sh:146-158 already finds it) and file Feedback with the .ips (suggest FB with symbol pf_posterPathInstanceURLForVersionsURL).
No documented Apple setting to disable lock screen/wallpaper work found.
