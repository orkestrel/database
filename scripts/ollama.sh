#!/bin/bash
# ============================================================================
# scripts/ollama.sh — SessionStart hook: Ollama ONLY
# ----------------------------------------------------------------------------
# One job: bring the local-model daemon up for this session, healthy.
# Project dependencies live in scripts/deps.sh; the Cursor bench check lives in
# scripts/cursor.sh. All three are registered in .claude/settings.json and run
# IN PARALLEL at session start, so the daemon boots while npm installs.
#
#   0. Guards -- the orchestration set (hooks included) is mirrored
#      byte-identical across every @orkestrel repo, and this repo serves
#      several cloud environments: exit quietly in any repo that isn't
#      @orkestrel/ollama, and wherever the ollama binary isn't installed.
#   1. Starts `ollama serve`  -- the environment cache snapshots FILES, not
#      running processes, so the daemon must be restarted every session.
#   2. Self-heals a known container defect -- this container class advertises
#      AMX CPU flags but blocks AMX tile-state permissions at the kernel /
#      seccomp level. Ollama's dynamic CPU-backend loader picks its only
#      AMX-capable variant (libggml-cpu-sapphirerapids.so) on such hosts, and
#      llama-server then segfaults on every model load. A cheap chat probe
#      after the daemon comes up doubles as session warmup AND a canary for
#      this failure; if it fires, we disable that .so and restart the daemon
#      so the loader falls back to the next-best AVX-512 variant.
#
# SessionStart stdout is injected into Claude's context: keep stdout to terse
# status lines (they tell Claude what this environment offers); diagnostics go
# to stderr / /tmp/ollama.log. No `set -e`: a self-heal misfire should not
# stop Ollama from coming up.
# ============================================================================

# Run only in cloud sessions. Locally you manage your own Ollama, so skip.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# --- 0. Guards ---------------------------------------------------------------
# The daemon only serves the ollama package; every other @orkestrel repo
# carries this script as part of the mirrored hook set and must skip silently.
PKG_JSON="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}/package.json"
if ! grep -Eq '"name"[[:space:]]*:[[:space:]]*"@orkestrel/ollama"' "$PKG_JSON" 2>/dev/null; then
  exit 0
fi
if ! command -v ollama >/dev/null 2>&1; then
  echo "ollama.sh: ollama not installed in this environment — no local model daemon."
  exit 0
fi

# Match the locations used by the setup script / environment variables.
export OLLAMA_MODELS="${OLLAMA_MODELS:-/opt/ollama/models}"
export OLLAMA_HOST="${OLLAMA_HOST:-127.0.0.1:11434}"

# Your Copilot workflow set OLLAMA_ORIGINS="*" so browser page contexts could
# call the API cross-origin. That was mainly a Playwright concern, so it is off
# here. Uncomment if anything still hits Ollama from a browser:
# export OLLAMA_ORIGINS="*"

# --- 1. Start the daemon ----------------------------------------------------
if ! curl -sf "http://${OLLAMA_HOST}/api/tags" >/dev/null 2>&1; then
  nohup ollama serve >/tmp/ollama.log 2>&1 &
fi

ollama_ready=0
for i in $(seq 1 30); do
  if curl -sf "http://${OLLAMA_HOST}/api/tags" >/dev/null 2>&1; then
    echo "Ollama ready on ${OLLAMA_HOST}"
    ollama_ready=1
    break
  fi
  sleep 1
done

if [ "$ollama_ready" != "1" ]; then
  # Don't fail the session if the daemon is slow; Claude can retry mid-session.
  echo "Warning: Ollama did not report ready within 30s (see /tmp/ollama.log)" >&2
  exit 0
fi

# --- 2. Self-heal the AMX/XTILE-blocked-container defect --------------------
# See header note 2. A minimal chat call against whatever model is already
# installed both warms that model for the session AND tells us whether this
# container hit the AMX-tile-permission wall. If it did, disable the
# AMX-only CPU backend variant and restart the daemon so the loader falls
# back to AVX-512, then re-probe once to confirm the fix landed.
sapphirerapids_so="/usr/local/lib/ollama/libggml-cpu-sapphirerapids.so"

probe_model() {
  curl -sf "http://${OLLAMA_HOST}/api/tags" 2>/dev/null \
    | grep -o '"name":"[^"]*"' \
    | head -n 1 \
    | sed -e 's/"name":"//' -e 's/"$//'
}

probe_chat() {
  model="$1"
  curl -s --max-time 120 "http://${OLLAMA_HOST}/api/chat" \
    -d "{\"model\":\"${model}\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"stream\":false,\"think\":false,\"keep_alive\":\"30m\",\"options\":{\"num_predict\":1}}"
}

model="$(probe_model)"
if [ -z "$model" ]; then
  # No model installed yet -- nothing to warm or probe against.
  echo "ollama.sh: no installed model found, skipping warmup probe." >&2
  exit 0
fi

probe_response="$(probe_chat "$model")"

if echo "$probe_response" | grep -qi 'segmentation fault\|llama-server process has terminated'; then
  echo "ollama.sh: detected llama-server crash on model warmup (likely the AMX/XTILE-blocked-container defect)." >&2
  if [ -f "$sapphirerapids_so" ]; then
    echo "ollama.sh: disabling AMX-only CPU backend variant so the loader falls back to AVX-512." >&2
    if mv "$sapphirerapids_so" "${sapphirerapids_so}.disabled" 2>/dev/null; then
      echo "ollama.sh: restarting Ollama daemon to pick up the backend change." >&2
      ollama_pid="$(pgrep -x ollama | head -n 1)"
      if [ -n "$ollama_pid" ]; then
        kill "$ollama_pid" 2>/dev/null
        # Wait for the old process to actually exit before relaunching, so the
        # new daemon can't race the dying one for the port and the readiness
        # poll below can't be satisfied by the dying daemon.
        for i in $(seq 1 10); do
          if ! kill -0 "$ollama_pid" 2>/dev/null; then
            break
          fi
          sleep 0.5
        done
      fi
      nohup ollama serve >/tmp/ollama.log 2>&1 &

      restarted_ready=0
      for i in $(seq 1 30); do
        if curl -sf "http://${OLLAMA_HOST}/api/tags" >/dev/null 2>&1; then
          restarted_ready=1
          break
        fi
        sleep 1
      done

      if [ "$restarted_ready" = "1" ]; then
        retry_response="$(probe_chat "$model")"
        if echo "$retry_response" | grep -qi 'segmentation fault\|llama-server process has terminated'; then
          echo "ollama.sh: self-heal restart complete, but the retry probe still failed. See /tmp/ollama.log." >&2
        else
          echo "ollama.sh: self-heal succeeded -- model warm (${model}) after AVX-512 fallback."
        fi
      else
        echo "ollama.sh: daemon did not report ready after self-heal restart (see /tmp/ollama.log)." >&2
      fi
    else
      echo "ollama.sh: warning -- could not rename ${sapphirerapids_so} (permissions?). Leaving daemon as-is." >&2
    fi
  else
    echo "ollama.sh: warning -- AMX-only CPU backend not found at expected path; cannot self-heal automatically." >&2
  fi
elif echo "$probe_response" | grep -q '"message"\|"content"\|"done":true'; then
  echo "ollama.sh: model warm (${model}) -- warmup probe succeeded."
else
  echo "ollama.sh: warning -- warmup probe returned an unexpected response (not a segfault, but no message/done payload either):" >&2
  echo "ollama.sh: ${probe_response}" | head -c 500 >&2
  echo "" >&2
  echo "ollama.sh: leaving daemon as-is." >&2
fi

exit 0
