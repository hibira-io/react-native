#!/usr/bin/env bash
# Runs inside the emulator step: installs the release APK and drives it with
# backend.mjs, against soketi first and then ws.hibira.io when its secrets are
# set. Leaves logcat and a screenshot in e2e/android/out.
set -uo pipefail
cd "$(dirname "$0")/../.."
out=e2e/android/out
mkdir -p "$out"
adb install -r e2e/android/android/app/build/outputs/apk/release/app-release.apk || exit 1
adb logcat -c

status=0
node e2e/android/backend.mjs local || status=1
adb exec-out screencap -p > "$out/local.png"
if [ -n "${HIBIRA_E2E_KEY:-}" ]; then
  node e2e/android/backend.mjs hibira || status=1
  adb exec-out screencap -p > "$out/hibira.png"
else
  echo "ws.hibira.io run skipped: HIBIRA_E2E_APP_ID, HIBIRA_E2E_KEY and HIBIRA_E2E_SECRET are not set"
fi
adb logcat -d > "$out/logcat.txt"
exit $status
