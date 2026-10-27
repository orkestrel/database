#!/bin/bash
# ============================================================================
# scripts/browsers.sh — SessionStart hook: Playwright browsers for the pinned playwright-core
# ----------------------------------------------------------------------------
# Runs only in Claude Code's remote environment. The container pre-installs one
# Chromium build under PLAYWRIGHT_BROWSERS_PATH; when the lockfile pins a
# playwright-core whose browsers.json names another build, every browser project
# fails at launch. Playwright's own installer resolves the store, skips a build
# whose completion marker exists, and downloads the rest, so this hook runs it
# and reports what it did. It runs after scripts/deps.sh in the same SessionStart
# command, because matching hooks run in parallel and the installer arrives with
# node_modules.
# ============================================================================

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR" || exit 0

CLI="node_modules/playwright/cli.js"
if [ ! -f "$CLI" ]; then
  echo "browsers.sh: playwright is not installed — skipped."
  exit 0
fi

if ! TEMPORARY="$(node -p 'require("node:os").tmpdir()')" || [ -z "$TEMPORARY" ]; then
  echo "browsers.sh: could not read the temporary directory — skipped."
  exit 0
fi

BROWSERS_LOG="$(mktemp -p "$TEMPORARY" orkestrel-browsers.XXXXXX)" || {
  echo "browsers.sh: could not create a private install log — skipped."
  exit 0
}
chmod 600 "$BROWSERS_LOG"

cleanup_browsers_log() {
  rm -f -- "$BROWSERS_LOG"
}

trap cleanup_browsers_log EXIT

if node "$CLI" install chromium >"$BROWSERS_LOG" 2>&1; then
  if grep -q 'downloaded to' "$BROWSERS_LOG"; then
    echo "browsers.sh: installed the Chromium builds playwright-core pins."
  else
    echo "browsers.sh: Playwright browsers match playwright-core — skipped."
  fi
else
  echo "browsers.sh: playwright install failed; browser projects remain unlaunchable in this session."
fi

exit 0
