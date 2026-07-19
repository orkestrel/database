#!/bin/bash
# ============================================================================
# scripts/mirror.sh — mirror the shared orchestration set from a canonical
# repo to every @orkestrel repo under a root
# ----------------------------------------------------------------------------
# This script lives in EVERY @orkestrel repo (it propagates itself: the
# manifest includes scripts/*.sh). Deterministic, idempotent, dry-run by
# default. Run it from anywhere; it locates itself and its repo automatically.
#
#   ./scripts/mirror.sh                  dry-run; source = this host repo
#   ./scripts/mirror.sh --apply          write the changes, then verify
#   ./scripts/mirror.sh --source PATH    canonical set = PATH (a repo, or an unzipped repo/ bundle)
#   ./scripts/mirror.sh --root PATH      workspace to scan (default: this host repo's parent dir)
#   ./scripts/mirror.sh --prune          also delete target-only agents/scripts (true mirror)
#
# SHARED (propagated): CLAUDE.md, AGENTS.md, SCAFFOLD.md, .claude/settings.json,
#   .claude/agents/*.md, scripts/*.sh
# NEVER TOUCHED (per-package): src/, tests/, configs/, guides/ (governed by the
#   vendored-guide parity law), package.json, README.md, tsconfig/vite, dotfiles.
#
# A workspace with multiple roots (e.g. /home/user and /workspace) needs one
# run per root — pass --root explicitly for each.
#
# Review AGENTS.md / SCAFFOLD.md / CLAUDE.md line-diffs before --apply — a
# large diff in one repo may be genuine package-specific content, not drift
# to overwrite.
# ============================================================================
set -uo pipefail   # deliberately not -e: we handle failures and always print the full report

HOST_REPO="$(cd "$(dirname "$0")/.." && pwd)"

APPLY=0; PRUNE=0; ROOT="$(dirname "$HOST_REPO")"; SOURCE="$HOST_REPO"
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1;;
    --prune) PRUNE=1;;
    --source) SOURCE="${2:?--source needs a path}"; shift;;
    --root)   ROOT="${2:?--root needs a path}"; shift;;
    -h|--help) sed -n '2,26p' "$0"; exit 0;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
  shift
done

hash_of() { if [ -f "$1" ]; then sha256sum "$1" | awk '{print $1}'; else echo MISSING; fi; }

pkg_name() {
  local pj="$1"
  if command -v node >/dev/null 2>&1; then
    node -e 'try{process.stdout.write((require(process.argv[1]).name)||"")}catch(e){}' "$pj" 2>/dev/null
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("name",""))' "$pj" 2>/dev/null
  else
    grep -m1 '"name"' "$pj" | sed -E 's/.*"name"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/'
  fi
}

SOURCE="$(realpath "$SOURCE")"

# --- sanity guard: the source must itself be an @orkestrel/* repo ----------
if [ ! -f "$SOURCE/package.json" ] || [[ "$(pkg_name "$SOURCE/package.json")" != @orkestrel/* ]]; then
  echo "ERROR: source $SOURCE is not an @orkestrel/* repo (no package.json, or wrong package name)." >&2
  echo "Pass --source PATH to a valid @orkestrel repo, or run this script from within one." >&2
  exit 2
fi

# --- discover @orkestrel repo roots (skip node_modules/.git/dist) ------------
mapfile -d '' -t PKG_JSONS < <(find "$ROOT" \
  -type d \( -name node_modules -o -name .git -o -name dist \) -prune -o \
  -type f -name package.json -print0 2>/dev/null)

declare -A REPO_NAME   # realpath -> @orkestrel/name
for pj in "${PKG_JSONS[@]-}"; do
  [ -n "$pj" ] || continue
  name="$(pkg_name "$pj")"
  case "$name" in
    @orkestrel/*) REPO_NAME["$(realpath "$(dirname "$pj")")"]="$name";;
  esac
done

if [ "${#REPO_NAME[@]}" -eq 0 ]; then
  echo "ERROR: no @orkestrel/* repos found under $ROOT." >&2
  echo "Run this from the workspace root that holds the repos, or pass --root PATH." >&2
  exit 2
fi

# --- build the manifest from what the source actually has --------------------
declare -a MANIFEST=()
for f in CLAUDE.md AGENTS.md SCAFFOLD.md .claude/settings.json; do
  if [ -f "$SOURCE/$f" ]; then MANIFEST+=("$f"); else echo "WARN: source missing $f — not propagating it." >&2; fi
done
for f in "$SOURCE"/.claude/agents/*.md; do [ -e "$f" ] && MANIFEST+=(".claude/agents/$(basename "$f")"); done
for f in "$SOURCE"/scripts/*.sh;        do [ -e "$f" ] && MANIFEST+=("scripts/$(basename "$f")"); done

if [ "${#MANIFEST[@]}" -eq 0 ]; then
  echo "ERROR: source $SOURCE has none of the expected orchestration files." >&2
  exit 2
fi

is_doc() { case "$1" in CLAUDE.md|AGENTS.md|SCAFFOLD.md) return 0;; *) return 1;; esac; }

TARGETS=${#REPO_NAME[@]}
if [ -n "${REPO_NAME[$SOURCE]-}" ]; then TARGETS=$((TARGETS - 1)); fi
echo "Source (canonical): $SOURCE  [${REPO_NAME[$SOURCE]-external to --root}]"
echo "Mode: $([ $APPLY -eq 1 ] && echo APPLY || echo 'DRY-RUN (no writes)')$([ $PRUNE -eq 1 ] && echo ' +PRUNE')"
echo "Manifest: ${#MANIFEST[@]} files -> $TARGETS target repo(s)"
echo "============================================================================"

targets_changed=0; files_written=0; files_pruned=0; verify_fail=0

for dir in $(printf '%s\n' "${!REPO_NAME[@]}" | sort); do
  [ "$dir" = "$SOURCE" ] && continue
  name="${REPO_NAME[$dir]}"
  declare -a NEW=() CHG=() EXTRA=()

  for rel in "${MANIFEST[@]}"; do
    s="$(hash_of "$SOURCE/$rel")"; t="$(hash_of "$dir/$rel")"
    if [ "$t" = MISSING ]; then NEW+=("$rel")
    elif [ "$s" != "$t" ]; then
      if is_doc "$rel"; then
        n="$(diff <(cat "$SOURCE/$rel") <(cat "$dir/$rel") 2>/dev/null | grep -cE '^[<>]')"
        CHG+=("$rel ($n lines differ)")
      else CHG+=("$rel"); fi
    fi
  done

  # target-only agents/scripts = drift
  for f in "$dir"/.claude/agents/*.md "$dir"/scripts/*.sh; do
    [ -e "$f" ] || continue
    sub="${f#$dir/}"
    [ -f "$SOURCE/$sub" ] || EXTRA+=("$sub")
  done

  if [ "${#NEW[@]}" -eq 0 ] && [ "${#CHG[@]}" -eq 0 ] && [ "${#EXTRA[@]}" -eq 0 ]; then
    printf '  = %-24s in sync\n' "$name"
  else
    targets_changed=$((targets_changed+1))
    printf '  ~ %-24s %s\n' "$name" "$dir"
    for x in "${NEW[@]-}";   do [ -n "$x" ] && printf '      + %s (new)\n' "$x"; done
    for x in "${CHG[@]-}";   do [ -n "$x" ] && printf '      ~ %s\n' "$x"; done
    for x in "${EXTRA[@]-}"; do [ -n "$x" ] && printf '      %s %s (target-only%s)\n' "$([ $PRUNE -eq 1 ] && echo '-' || echo '!')" "$x" "$([ $PRUNE -eq 1 ] && echo ', will delete' || echo ', use --prune to remove')"; done
  fi

  if [ $APPLY -eq 1 ]; then
    for rel in "${NEW[@]-}" "${CHG[@]-}"; do
      rel="${rel%% (*}"; [ -n "$rel" ] || continue
      mkdir -p "$dir/$(dirname "$rel")"
      cp "$SOURCE/$rel" "$dir/$rel"
      case "$rel" in scripts/*.sh) chmod +x "$dir/$rel";; esac
      files_written=$((files_written+1))
    done
    if [ $PRUNE -eq 1 ]; then
      for x in "${EXTRA[@]-}"; do [ -n "$x" ] && rm -f "$dir/$x" && files_pruned=$((files_pruned+1)); done
    fi
    # verify
    for rel in "${MANIFEST[@]}"; do
      [ "$(hash_of "$SOURCE/$rel")" = "$(hash_of "$dir/$rel")" ] || { echo "      VERIFY FAIL: $rel" >&2; verify_fail=$((verify_fail+1)); }
    done
  fi
  unset NEW CHG EXTRA
done

echo "============================================================================"
if [ $APPLY -eq 1 ]; then
  echo "Applied: $files_written file(s) written, $files_pruned pruned, across $targets_changed repo(s)."
  if [ $verify_fail -eq 0 ]; then echo "Verify: PASS — every target matches canonical."; else echo "Verify: FAIL — $verify_fail mismatch(es)."; exit 1; fi
else
  echo "Dry-run: $targets_changed repo(s) would change. Re-run with --apply to write."
  echo "Review AGENTS.md / SCAFFOLD.md / CLAUDE.md line-diffs above before applying — a large"
  echo "diff in one repo may be genuine package-specific content, not drift to overwrite."
fi
