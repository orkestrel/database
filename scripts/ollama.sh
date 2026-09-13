#!/usr/bin/env bash
set -euo pipefail

MAX_SECONDS=590
CLEANUP_SECONDS=5
OPERATION_SECONDS=$((MAX_SECONDS - CLEANUP_SECONDS - 1))
STARTED_SECONDS=$SECONDS
STARTUP_SECONDS=60
INSTALLER_URL='https://ollama.com/install.sh'

launched_pid=
installer_path=

fail() {
	printf 'ollama.sh: %s\n' "$1" >&2
	exit 1
}

remaining_seconds() {
	local remaining=$((OPERATION_SECONDS - (SECONDS - STARTED_SECONDS)))
	if ((remaining < 1)); then
		printf '0\n'
	else
		printf '%s\n' "$remaining"
	fi
}

terminate_group() {
	local pid=$1
	local deadline=$((SECONDS + CLEANUP_SECONDS))
	kill -TERM -- "-$pid" >/dev/null 2>&1 || true
	while kill -0 -- "-$pid" >/dev/null 2>&1; do
		if ((SECONDS >= deadline)); then
			kill -KILL -- "-$pid" >/dev/null 2>&1 || true
			break
		fi
		sleep 1
	done
	wait "$pid" >/dev/null 2>&1 || true
}

cleanup() {
	local status=$1
	if [[ -n "$installer_path" && -f "$installer_path" ]]; then
		rm -f -- "$installer_path"
	fi
	if ((status != 0)) && [[ -n "$launched_pid" ]]; then
		terminate_group "$launched_pid"
	fi
	exit "$status"
}

normalize_host() {
	OLLAMA_INPUT="$1" "$node_path" -e '
const { isIP } = require("node:net")
const raw = process.env.OLLAMA_INPUT
if (raw === undefined || raw.length === 0) process.exit(1)
let url
try {
	url = new URL(/^https?:\/\//iu.test(raw) ? raw : `http://${raw}`)
} catch {
	process.exit(1)
}
if (
	(url.protocol !== "http:" && url.protocol !== "https:") ||
	url.username !== "" ||
	url.password !== "" ||
	url.pathname !== "/" ||
	url.search !== "" ||
	url.hash !== "" ||
	url.hostname === ""
) process.exit(1)
const hostname =
	url.hostname.startsWith("[") && url.hostname.endsWith("]")
		? url.hostname.slice(1, -1)
		: url.hostname
const family = isIP(hostname)
const loopback =
	hostname === "localhost" ||
	(family === 4 && hostname.split(".")[0] === "127") ||
	(family === 6 && hostname === "::1")
process.stdout.write(`${url.origin}\n${loopback ? "true" : "false"}`)
'
}

build_payload() {
	OLLAMA_MODEL_VALUE="$model" "$node_path" -e '
const model = process.env.OLLAMA_MODEL_VALUE
if (model === undefined || model.length === 0) process.exit(1)
let body
switch (process.argv[1]) {
	case "show":
		body = { model }
		break
	case "pull":
		body = { model, stream: false }
		break
	case "chat":
		body = {
			model,
			messages: [{ role: "user", content: "hi" }],
			stream: false,
			think: false,
			keep_alive: "30m",
			options: { num_predict: 1 },
		}
		break
	default:
		process.exit(1)
}
process.stdout.write(JSON.stringify(body))
' "$1"
}

validate_response() {
	"$node_path" -e '
const { readFileSync } = require("node:fs")
let body
try {
	body = JSON.parse(readFileSync(0, "utf8"))
} catch {
	process.exit(1)
}
if (body === null || typeof body !== "object" || Array.isArray(body)) process.exit(1)
if (process.argv[1] === "pull") process.exit(body.status === "success" ? 0 : 1)
if (process.argv[1] === "chat") process.exit(body.done === true ? 0 : 1)
process.exit(1)
' "$1"
}

probe_version() {
	local allowance=$1
	local status
	if ! status=$(curl --silent --max-time "$allowance" --output /dev/null \
		--write-out '%{http_code}' "$normalized_host/api/version" 2>/dev/null); then
		return 1
	fi
	[[ "$status" =~ ^2[0-9][0-9]$ ]]
}

trap 'cleanup $?' EXIT

if ! command -v node >/dev/null 2>&1; then
	printf 'ollama.sh: node is required for URL and JSON handling\n' >&2
	exit 127
fi
if ! command -v curl >/dev/null 2>&1; then
	printf 'ollama.sh: curl is required for Ollama setup\n' >&2
	exit 127
fi

node_path=$(command -v node)
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
project_root=$(cd -- "$script_dir/.." && pwd -P)
tmp_dir="$project_root/tmp"
mkdir -p -- "$tmp_dir"

if [[ ${OLLAMA_HOST+x} == x ]]; then
	host_input=$OLLAMA_HOST
else
	host_input='http://127.0.0.1:11434'
fi
if [[ ${OLLAMA_MODEL+x} == x ]]; then
	model=$OLLAMA_MODEL
else
	model='qwen3.5:2b-q4_K_M'
fi
if [[ -z "$model" ]]; then
	fail 'OLLAMA_MODEL must not be empty'
fi

if ! host_data=$(normalize_host "$host_input"); then
	fail 'OLLAMA_HOST must be an HTTP origin without credentials, path, query, or fragment'
fi
if [[ "$host_data" != *$'\n'* ]]; then
	fail 'OLLAMA_HOST normalization returned no endpoint classification'
fi
normalized_host=${host_data%%$'\n'*}
loopback=${host_data#*$'\n'}

ready=false
if probe_version 2; then
	ready=true
fi

if [[ "$ready" != true ]]; then
	if [[ "$loopback" != true || "$normalized_host" != http://* ]]; then
		fail 'the configured endpoint is unreachable; local startup is limited to HTTP loopback'
	fi

	if ! command -v ollama >/dev/null 2>&1; then
		if [[ ${CLAUDE_CODE_REMOTE:-} != true && ${CI:-} != true ]]; then
			printf 'ollama.sh: ollama is required to start an unreachable loopback endpoint\n' >&2
			exit 127
		fi
		if [[ $(uname -s) != Linux ]]; then
			fail 'automatic Ollama installation is supported only on Linux'
		fi
		if ! command -v timeout >/dev/null 2>&1; then
			printf 'ollama.sh: timeout is required to bound automatic installation\n' >&2
			exit 127
		fi
		if ! command -v mktemp >/dev/null 2>&1; then
			printf 'ollama.sh: mktemp is required for automatic installation\n' >&2
			exit 127
		fi
		installer_path=$(mktemp "$tmp_dir/ollama-install.XXXXXX.sh")
		remaining=$(remaining_seconds)
		if ((remaining == 0)); then
			fail 'the setup deadline expired before installation'
		fi
		if ! curl --fail --silent --show-error --location \
			--proto '=https' --proto-redir '=https' --max-time "$remaining" \
			--output "$installer_path" "$INSTALLER_URL"; then
			fail 'the official Ollama installer download failed'
		fi
		if [[ ! -s "$installer_path" ]]; then
			fail 'the official Ollama installer download was empty'
		fi
		remaining=$(remaining_seconds)
		if ((remaining == 0)); then
			fail 'the setup deadline expired before installation'
		fi
		if ! timeout --signal=TERM --kill-after=5s "${remaining}s" sh "$installer_path"; then
			fail 'the official Ollama installer did not complete within the setup deadline'
		fi
		ollama_path=$(command -v ollama || true)
		if [[ -z "$ollama_path" || ! -f "$ollama_path" || ! -x "$ollama_path" ]]; then
			fail 'the official Ollama installer completed without an executable in PATH'
		fi
		remaining=$(remaining_seconds)
		if ((remaining == 0)); then
			fail 'the setup deadline expired after installation'
		fi
		probe_allowance=2
		if ((remaining < probe_allowance)); then probe_allowance=$remaining; fi
		if probe_version "$probe_allowance"; then
			ready=true
		fi
	fi

	if [[ "$ready" != true ]]; then
		host_kernel=$(uname -s)
		if [[ "$host_kernel" == MINGW* || "$host_kernel" == MSYS* || "$host_kernel" == CYGWIN* ]]; then
			fail 'starting Ollama from Git Bash is unsupported because failure cleanup cannot terminate its Windows process tree safely'
		fi
		if ! command -v setsid >/dev/null 2>&1; then
			fail 'setsid is required to own an Ollama daemon process group for failure cleanup'
		fi
		ollama_path=$(command -v ollama)
		log_path="$tmp_dir/ollama-service.log"
		OLLAMA_HOST="$normalized_host" setsid "$ollama_path" serve </dev/null >>"$log_path" 2>&1 &
		launched_pid=$!
		startup_started=$SECONDS
		while true; do
			remaining=$(remaining_seconds)
			startup_remaining=$((STARTUP_SECONDS - (SECONDS - startup_started)))
			if ((remaining == 0 || startup_remaining <= 0)); then
				fail 'Ollama did not become ready within the startup deadline; see tmp/ollama-service.log'
			fi
			probe_allowance=2
			if ((remaining < probe_allowance)); then probe_allowance=$remaining; fi
			if ((startup_remaining < probe_allowance)); then probe_allowance=$startup_remaining; fi
			if probe_version "$probe_allowance"; then
				ready=true
				break
			fi
			sleep 1
		done
	fi
fi

show_payload=$(build_payload show) || fail 'failed to serialize the model request'
remaining=$(remaining_seconds)
if ((remaining == 0)); then fail 'the setup deadline expired before model inspection'; fi
if ! show_status=$(curl --silent --show-error --max-time "$remaining" \
	--output /dev/null --write-out '%{http_code}' \
	--header 'Content-Type: application/json' --data-binary "$show_payload" \
	"$normalized_host/api/show"); then
	fail 'the model inspection request failed'
fi

if [[ "$show_status" == 404 ]]; then
	pull_payload=$(build_payload pull) || fail 'failed to serialize the pull request'
	remaining=$(remaining_seconds)
	if ((remaining == 0)); then fail 'the setup deadline expired before model pull'; fi
	if ! pull_wire=$(curl --silent --show-error --max-time "$remaining" \
		--write-out $'\n%{http_code}' \
		--header 'Content-Type: application/json' --data-binary "$pull_payload" \
		"$normalized_host/api/pull"); then
		fail 'the model pull request failed'
	fi
	if [[ "$pull_wire" != *$'\n'* ]]; then
		fail 'the model pull response carried no HTTP status'
	fi
	pull_status=${pull_wire##*$'\n'}
	pull_response=${pull_wire%$'\n'*}
	if [[ ! "$pull_status" =~ ^2[0-9][0-9]$ ]]; then
		fail 'the model pull request returned an unsuccessful HTTP status'
	fi
	if ! printf '%s' "$pull_response" | validate_response pull; then
		fail 'the model pull response did not report completion'
	fi
elif [[ ! "$show_status" =~ ^2[0-9][0-9]$ ]]; then
	fail 'the model inspection request failed without reporting absence'
fi

chat_payload=$(build_payload chat) || fail 'failed to serialize the warm request'
remaining=$(remaining_seconds)
if ((remaining == 0)); then fail 'the setup deadline expired before model warmup'; fi
if ! chat_wire=$(curl --silent --show-error --max-time "$remaining" \
	--write-out $'\n%{http_code}' \
	--header 'Content-Type: application/json' --data-binary "$chat_payload" \
	"$normalized_host/api/chat"); then
	fail 'the model warm request failed'
fi
if [[ "$chat_wire" != *$'\n'* ]]; then
	fail 'the model warm response carried no HTTP status'
fi
chat_status=${chat_wire##*$'\n'}
chat_response=${chat_wire%$'\n'*}
if [[ ! "$chat_status" =~ ^2[0-9][0-9]$ ]]; then
	fail 'the model warm request returned an unsuccessful HTTP status'
fi
if ! printf '%s' "$chat_response" | validate_response chat; then
	fail 'the model warm response did not report completion'
fi

printf 'ollama.sh: Ollama is ready\n'
