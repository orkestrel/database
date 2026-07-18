#!/bin/bash
# ============================================================================
# scripts/deps.sh — SessionStart hook: project dependencies ONLY
# ----------------------------------------------------------------------------
# Runs in every cloud environment (the setup script never sees the repo
# checkout; $CLAUDE_PROJECT_DIR here always points at the real one).
# SessionStart stdout is injected into Claude's context, so this script prints
# ONE meaningful line and sends the npm noise to /tmp/deps.log.
# ============================================================================

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR" || exit 0

if [ ! -f package.json ]; then
  exit 0
fi
if [ -d node_modules ]; then
  echo "deps.sh: dependencies already present (resumed session) — skipped."
  exit 0
fi

if [ -f package-lock.json ]; then
  if npm ci >/tmp/deps.log 2>&1; then
    echo "deps.sh: dependencies installed (npm ci)."
  else
    echo "deps.sh: npm ci FAILED — see /tmp/deps.log before building or testing."
  fi
else
  if npm install >/tmp/deps.log 2>&1; then
    echo "deps.sh: no package-lock.json — npm install succeeded. Commit a lockfile for reproducible installs."
  else
    echo "deps.sh: npm install FAILED — see /tmp/deps.log before building or testing."
  fi
fi
exit 0
