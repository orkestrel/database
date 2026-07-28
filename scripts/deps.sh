#!/bin/bash
# ============================================================================
# scripts/deps.sh — SessionStart hook: reproducible project dependencies
# ----------------------------------------------------------------------------
# Runs only in Claude Code's remote environment. The lockfile digest marker
# prevents a resumed session from treating stale node_modules as a valid
# installation after package-lock.json changes.
# ============================================================================

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR" || exit 0

if [ ! -f package.json ]; then
  exit 0
fi

LOCK_MARKER="node_modules/.orkestrel-lock.sha256"
DEPS_LOG="$(mktemp /tmp/orkestrel-deps.XXXXXX)" || {
  echo "deps.sh: could not create a private dependency log — skipped."
  exit 0
}
chmod 600 "$DEPS_LOG"

cleanup_deps_log() {
  rm -f -- "$DEPS_LOG"
}

trap cleanup_deps_log EXIT

if [ -f package-lock.json ]; then
  LOCK_HASH="$(node -e "process.stdout.write(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync('package-lock.json')).digest('hex'))" 2>"$DEPS_LOG")"

  if [ -n "$LOCK_HASH" ] &&
    [ -d node_modules ] &&
    [ -f "$LOCK_MARKER" ] &&
    [ "$(tr -d '\r\n' <"$LOCK_MARKER")" = "$LOCK_HASH" ]; then
    echo "deps.sh: dependencies match package-lock.json — skipped."
    exit 0
  fi

  if npm ci --ignore-scripts >"$DEPS_LOG" 2>&1; then
    if [ -n "$LOCK_HASH" ]; then
      printf '%s\n' "$LOCK_HASH" >"$LOCK_MARKER"
    fi
    echo "deps.sh: dependencies installed from package-lock.json (npm ci)."
  else
    echo "deps.sh: npm ci failed; dependency installation remains incomplete."
  fi
else
  echo "deps.sh: no package-lock.json — automatic installation refused; commit a lockfile."
fi

exit 0
