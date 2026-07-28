#!/bin/bash
# SessionStart capability probe for the Codex bench. External command output
# and route identifiers never cross the hook-to-context boundary.

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

if ! command -v codex >/dev/null 2>&1; then
  echo "codex.sh: bench unavailable."
  exit 0
fi

analyst_model="${CODEX_ANALYST_MODEL:-gpt-5.6-sol}"
analyst_effort="${CODEX_ANALYST_EFFORT:-high}"
implementer_model="${CODEX_IMPLEMENTER_MODEL:-gpt-5.6-sol}"
implementer_effort="${CODEX_IMPLEMENTER_EFFORT:-high}"

valid_model() {
  case "$1" in
    ''|*[!A-Za-z0-9._-]*) return 1 ;;
  esac
  [ "${#1}" -le 128 ]
}

valid_effort() {
  case "$1" in
    low|medium|high|xhigh|max|ultra) return 0 ;;
    *) return 1 ;;
  esac
}

if codex login status >/dev/null 2>&1; then
  auth="authentication ready"
  recovery=""
else
  auth="authentication unavailable"
  recovery='codex login --device-auth'
fi

if valid_model "$analyst_model" &&
  valid_model "$implementer_model" &&
  valid_effort "$analyst_effort" &&
  valid_effort "$implementer_effort"; then
  routes="routes configured"
else
  routes="routes invalid"
fi

echo "codex.sh: bench detected; ${auth}; ${routes}."
if [ -n "$recovery" ]; then
  echo "codex.sh: to recover, run \`${recovery}\`."
fi
exit 0
