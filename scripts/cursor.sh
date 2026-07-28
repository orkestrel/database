#!/bin/bash
# SessionStart capability probe for the Cursor bench. External command output,
# model identifiers, and credentials never cross the hook-to-context boundary.

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

if ! command -v agent >/dev/null 2>&1; then
  echo "cursor.sh: bench unavailable; use an in-session research route."
  exit 0
fi

MODELS_LOG="$(mktemp /tmp/orkestrel-cursor-models.XXXXXX)" || exit 0
chmod 600 "$MODELS_LOG"
cleanup_cursor_log() {
  rm -f -- "$MODELS_LOG"
}
trap cleanup_cursor_log EXIT

models_ok=0
if agent models >"$MODELS_LOG" 2>&1; then
  models_ok=1
fi

valid_pin() {
  case "$1" in
    ''|-*|*[!A-Za-z0-9._-]*) return 1 ;;
  esac
  [ "${#1}" -le 128 ]
}

id_ok() {
  escaped="$(printf '%s' "$1" | sed 's/[][\.^$*+?(){}|]/\\&/g')"
  grep -Eq -- "${escaped}([^A-Za-z0-9._-]|$)" "$MODELS_LOG"
}

pins="pins ready"
if [ -z "${CURSOR_GROK_MODEL:-}" ]; then
  pins="pins missing"
elif ! valid_pin "$CURSOR_GROK_MODEL"; then
  pins="pins invalid"
elif [ "$models_ok" = "1" ]; then
  if ! id_ok "$CURSOR_GROK_MODEL"; then
    pins="pins unavailable"
  fi
else
  pins="pins unverified"
fi

if [ "$models_ok" = "1" ]; then
  auth="authentication reachable"
elif [ -z "${CURSOR_API_KEY:-}" ]; then
  auth="authentication unavailable"
else
  auth="authentication unverified"
fi

echo "cursor.sh: bench detected; ${auth}; ${pins}."
exit 0
