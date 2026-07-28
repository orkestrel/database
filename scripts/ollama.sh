#!/bin/bash
# SessionStart loopback capability probe. Lifecycle stays user-owned and no
# caller-controlled endpoint is contacted or copied into model context.

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

if ! command -v ollama >/dev/null 2>&1; then
  echo "ollama.sh: loopback capability unavailable."
  exit 0
fi

if curl -sf --max-time 2 "http://127.0.0.1:11434/api/tags" >/dev/null 2>&1; then
  echo "ollama.sh: loopback capability ready; lifecycle remains user-owned."
else
  echo "ollama.sh: loopback capability unreachable; lifecycle remains user-owned."
fi

exit 0
