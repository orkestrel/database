#!/bin/bash
# ============================================================================
# scripts/cursor.sh — SessionStart hook: Cursor bench ONLY
# ----------------------------------------------------------------------------
# The Cursor CLI has no daemon to launch: `agent` is invoked on demand by the
# composer/grok dispatchers. This hook SENSES the bench at session start and
# announces the result into Claude's context (SessionStart stdout).
#
# AUTH SENSING — evidence-based, in order of authority:
#   1. `agent status` exits 0 even when it prints "Not logged in" — its exit
#      code proves nothing, and under CURSOR_API_KEY auth "Not logged in" is
#      COSMETIC on headless hosts (status reflects interactive login only;
#      key auth here is verified end-to-end and works regardless).
#   2. The per-session functional signal is `agent models`: reachable + pins
#      present on the account ⇒ the bench is usable. A live dispatch remains
#      the final arbiter; only USER API keys work (admin/org keys fail at
#      dispatch time).
# NEVER prints CURSOR_API_KEY. Always exits 0 — problems are announcements,
# not session blockers.
# ============================================================================

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

if ! command -v agent >/dev/null 2>&1; then
  echo "cursor.sh: bench dark — Cursor CLI not installed in this environment; route external-bench units to their Claude counterparts."
  exit 0
fi

# --- evidence gathering ------------------------------------------------------
agent status >/tmp/cursor-status.log 2>&1 || true
status_line="$(head -n 1 /tmp/cursor-status.log 2>/dev/null)"

models_ok=0
if agent models >/tmp/cursor-models.log 2>&1; then
  models_ok=1
fi

# Exact-token match so a pin can't false-positive on a longer variant
# (e.g. pin "composer-2.5" must not be satisfied by "composer-2.5-fast").
id_ok() {
  esc="$(printf '%s' "$1" | sed 's/[][\.^$*+?(){}|]/\\&/g')"
  grep -Eq "${esc}([^A-Za-z0-9._-]|$)" /tmp/cursor-models.log
}

# --- pins verdict ------------------------------------------------------------
pins="pins ok (composer=${CURSOR_COMPOSER_MODEL:-}, grok=${CURSOR_GROK_MODEL:-})"
if [ -z "${CURSOR_COMPOSER_MODEL:-}" ] || [ -z "${CURSOR_GROK_MODEL:-}" ]; then
  pins="PINS MISSING — run \`agent models\` and record CURSOR_COMPOSER_MODEL / CURSOR_GROK_MODEL in the environment variables"
elif [ "$models_ok" = "1" ]; then
  for id in "$CURSOR_COMPOSER_MODEL" "$CURSOR_GROK_MODEL"; do
    if ! id_ok "$id"; then
      pins="PIN NOT FOUND on this account: ${id} — re-run \`agent models\` and update the environment variable"
      break
    fi
  done
else
  pins="pins set (composer=${CURSOR_COMPOSER_MODEL}, grok=${CURSOR_GROK_MODEL}) — unvalidated (\`agent models\` unreachable)"
fi

# --- auth verdict: functional evidence over status text ----------------------
if [ -s /tmp/cursor-status.log ] && ! grep -qi "not logged in" /tmp/cursor-status.log; then
  auth="interactive login present (${status_line})"
elif [ -z "${CURSOR_API_KEY:-}" ]; then
  auth="AUTH DARK — no interactive login and no CURSOR_API_KEY set; add a USER API key in the environment settings"
elif [ "$models_ok" = "1" ]; then
  auth="key-auth reachable (status 'Not logged in' is cosmetic under key auth)"
else
  auth="key-auth UNVERIFIED — \`agent models\` unreachable (auth or network; see /tmp/cursor-models.log); if dispatches auth-fail, confirm the key is a USER API key, not admin"
fi

echo "cursor.sh: bench lit — $(agent --version 2>/dev/null | head -n 1); ${auth}; ${pins}."
exit 0
