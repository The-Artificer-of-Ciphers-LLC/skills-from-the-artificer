# Multi-locale screenshot capture

Companion to the `asc-shots-pipeline` skill: capturing the same plan across several locales, running
captures in parallel, and a full capture -> frame -> review -> upload example. Assumes the settings
file, plan and framing setup from `SKILL.md` already exist.

## Contents

- [Multi-locale capture (optional)](#multi-locale-capture-optional)
- [Parallel execution for speed](#parallel-execution-for-speed)
- [Full multi-locale pipeline example](#full-multi-locale-pipeline-example)

## Multi-locale capture (optional)

Do not use `xcrun simctl launch ... -e AppleLanguages` for localization.
`-e` is an environment variable pattern and does not reliably switch app language.

For this pipeline, use simulator-wide locale defaults per UDID. This works with
`asc screenshots capture`, which relaunches the app internally.

```bash
# Map each locale to a dedicated simulator UDID.
# (Create these simulators once with `xcrun simctl create`.)
declare -A LOCALE_UDID=(
  ["en-US"]="UDID_EN_US"
  ["de-DE"]="UDID_DE_DE"
  ["fr-FR"]="UDID_FR_FR"
  ["ja-JP"]="UDID_JA_JP"
)

set_simulator_locale() {
  local UDID="$1"
  local LOCALE="$2"            # e.g. de-DE
  local LANG="${LOCALE%%-*}"   # de
  local APPLE_LOCALE="${LOCALE/-/_}" # de_DE

  xcrun simctl boot "$UDID" || true
  xcrun simctl spawn "$UDID" defaults write NSGlobalDomain AppleLanguages -array "$LANG"
  xcrun simctl spawn "$UDID" defaults write NSGlobalDomain AppleLocale -string "$APPLE_LOCALE"
}

for LOCALE in "${!LOCALE_UDID[@]}"; do
  UDID="${LOCALE_UDID[$LOCALE]}"
  echo "Capturing $LOCALE on $UDID..."
  set_simulator_locale "$UDID" "$LOCALE"

  xcrun simctl terminate "$UDID" "com.example.app" || true
  asc screenshots capture \
    --bundle-id "com.example.app" \
    --name "home" \
    --udid "$UDID" \
    --output-dir "./screenshots/raw/$LOCALE" \
    --output json
done
```

If you launch manually (outside `asc screenshots capture`), use app launch arguments:

```bash
xcrun simctl launch "$UDID" "com.example.app" -AppleLanguages "(de)" -AppleLocale "de_DE"
```

## Parallel execution for speed

Run one locale per simulator UDID in parallel:

```bash
#!/bin/bash
# parallel-capture.sh

declare -A LOCALE_UDID=(
  ["en-US"]="UDID_EN_US"
  ["de-DE"]="UDID_DE_DE"
  ["fr-FR"]="UDID_FR_FR"
  ["ja-JP"]="UDID_JA_JP"
)

capture_locale() {
  local LOCALE="$1"
  local UDID="$2"
  local LANG="${LOCALE%%-*}"
  local APPLE_LOCALE="${LOCALE/-/_}"

  echo "Starting $LOCALE on $UDID"
  xcrun simctl boot "$UDID" || true
  xcrun simctl spawn "$UDID" defaults write NSGlobalDomain AppleLanguages -array "$LANG"
  xcrun simctl spawn "$UDID" defaults write NSGlobalDomain AppleLocale -string "$APPLE_LOCALE"
  xcrun simctl terminate "$UDID" "com.example.app" || true

  asc screenshots capture \
    --bundle-id "com.example.app" \
    --name "home" \
    --udid "$UDID" \
    --output-dir "./screenshots/raw/$LOCALE" \
    --output json

  echo "Completed $LOCALE"
}

for LOCALE in "${!LOCALE_UDID[@]}"; do
  capture_locale "$LOCALE" "${LOCALE_UDID[$LOCALE]}" &
done

wait
echo "All captures done. Now framing..."
```

Or use `xargs` with `locale:udid` pairs:

```bash
printf "%s\n" \
  "en-US:UDID_EN_US" \
  "de-DE:UDID_DE_DE" \
  "fr-FR:UDID_FR_FR" \
  "ja-JP:UDID_JA_JP" | xargs -P 4 -I {} bash -c '
    PAIR="{}"
    LOCALE="${PAIR%%:*}"
    UDID="${PAIR##*:}"
    LANG="${LOCALE%%-*}"
    APPLE_LOCALE="${LOCALE/-/_}"
    xcrun simctl boot "$UDID" || true
    xcrun simctl spawn "$UDID" defaults write NSGlobalDomain AppleLanguages -array "$LANG"
    xcrun simctl spawn "$UDID" defaults write NSGlobalDomain AppleLocale -string "$APPLE_LOCALE"
    xcrun simctl terminate "$UDID" "com.example.app" || true
    asc screenshots capture --bundle-id "com.example.app" --name "home" --udid "$UDID" --output-dir "./screenshots/raw/$LOCALE" --output json
  '
```

## Full multi-locale pipeline example

```bash
#!/bin/bash
# full-pipeline-multi-locale.sh

declare -A LOCALE_UDID=(
  ["en-US"]="UDID_EN_US"
  ["de-DE"]="UDID_DE_DE"
  ["fr-FR"]="UDID_FR_FR"
  ["es-ES"]="UDID_ES_ES"
  ["ja-JP"]="UDID_JA_JP"
)

DEVICE="iphone-air"
RAW_DIR="./screenshots/raw"
FRAMED_DIR="./screenshots/framed"

# Step 1: Parallel capture with per-simulator locale defaults
for LOCALE in "${!LOCALE_UDID[@]}"; do
  (
    UDID="${LOCALE_UDID[$LOCALE]}"
    LANG="${LOCALE%%-*}"
    APPLE_LOCALE="${LOCALE/-/_}"

    xcrun simctl boot "$UDID" || true
    xcrun simctl spawn "$UDID" defaults write NSGlobalDomain AppleLanguages -array "$LANG"
    xcrun simctl spawn "$UDID" defaults write NSGlobalDomain AppleLocale -string "$APPLE_LOCALE"
    xcrun simctl terminate "$UDID" "com.example.app" || true

    asc screenshots capture \
      --bundle-id "com.example.app" \
      --name "home" \
      --udid "$UDID" \
      --output-dir "$RAW_DIR/$LOCALE" \
      --output json
    echo "Captured $LOCALE"
  ) &
done
wait

# Step 2: Parallel framing
for LOCALE in "${!LOCALE_UDID[@]}"; do
  (
    asc screenshots frame \
      --input "$RAW_DIR/$LOCALE/home.png" \
      --output-dir "$FRAMED_DIR/$LOCALE" \
      --device "$DEVICE" \
      --output json
    echo "Framed $LOCALE"
  ) &
done
wait

# Step 3: Generate review (single run, aggregates all locales)
asc screenshots review-generate \
  --framed-dir "$FRAMED_DIR" \
  --output-dir "./screenshots/review"

# Step 4: Upload (run per locale if needed)
for LOCALE in "${!LOCALE_UDID[@]}"; do
  asc screenshots upload \
    --version-localization "LOC_ID_FOR_$LOCALE" \
    --path "$FRAMED_DIR/$LOCALE" \
    --device-type "IPHONE_65" \
    --output json
done
```
