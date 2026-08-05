#!/usr/bin/env bash
# verify.sh — pre-commit / pre-release sanity check for shadowdark-extras.
# Run from module root. Exits non-zero if any BLOCKING check fails.
# WARNING checks surface tech debt but don't block commits.
#
# Flags:
#   --strict   Treat warnings as errors (use during security passes)
#
# Each grep pattern below was a real bug found in this codebase.
# When you find a new class of regression, add to BLOCKING.
# Pre-existing issues being tracked for cleanup go in WARNING.

set -e
strict=0
[[ "$1" == "--strict" ]] && strict=1
block_fail=0
warn_fail=0

scan_block() {
  local label="$1"
  local pattern="$2"
  shift 2
  if grep -nE "$pattern" "$@" 2>/dev/null; then
    echo "[BLOCK] $label"
    block_fail=1
  fi
}

scan_warn() {
  local label="$1"
  local pattern="$2"
  shift 2
  if grep -nE "$pattern" "$@" 2>/dev/null; then
    echo "[WARN]  $label"
    warn_fail=1
  fi
}

echo "=== node --check on .mjs files ==="
mjs_files=$(git ls-files 'scripts/*.mjs' 'scripts/**/*.mjs' 2>/dev/null || find scripts -name '*.mjs' -type f)
for f in $mjs_files; do
  if ! node --check "$f" 2>/dev/null; then
    echo "[BLOCK] syntax: $f"
    node --check "$f"
    block_fail=1
  fi
done

mjs_paths=( $mjs_files )

# Structural gates for the feature-reorganization track. These protect the one
# assumption that track rests on: script file paths may move freely because
# nothing depends on where a script lives. Each is blocking.
#
# `set -e` is active, so every gate runs under `if !` — a bare call would abort
# the script on the first failure and hide the remaining checks.
echo "=== BLOCKING — structural gates (feature-reorganization track) ==="

if ! node dev/tools/resolve-imports.mjs; then
  echo "[BLOCK] unresolved relative import(s)"
  block_fail=1
fi

if ! node dev/tools/script-path-guard.mjs; then
  echo "[BLOCK] absolute script path(s) in shipped runtime JS"
  block_fail=1
fi

# resolve-imports.mjs proves the target FILE exists; it never reads the target's
# export list. A wrong name in a renamed import clears every other static check
# and fails at load time in the browser.
if ! node dev/tools/named-export-gate.mjs; then
  echo "[BLOCK] import(s) name something the target module does not export"
  block_fail=1
fi

if ! node dev/tools/registration-snapshot.mjs; then
  echo "[BLOCK] hook/libWrapper/socket registration snapshot mismatch"
  block_fail=1
fi

if ! node dev/tools/api-export-snapshot.mjs; then
  echo "[BLOCK] public API export snapshot mismatch"
  block_fail=1
fi

if ! node dev/tools/settings-snapshot.mjs; then
  echo "[BLOCK] settings key/menu identity changed (stored in user worlds)"
  block_fail=1
fi

if ! node dev/tools/flag-snapshot.mjs; then
  echo "[BLOCK] document flag key identity changed (stored on user documents)"
  block_fail=1
fi

# The splits duplicate small constants into each extracted module on purpose, to
# keep them import-free leaves. prove-move compares declaration trees without
# resolving what they read, so it cannot see a duplicated constant drift.
if ! node dev/tools/const-drift.mjs; then
  echo "[BLOCK] duplicated constants disagree between modules"
  block_fail=1
fi

# Phase 3 gates. An extraction can leave a call pointing at a helper that stayed
# behind, or read a constant it never imported — valid syntax, resolvable
# imports, green snapshots, and a ReferenceError the first time the hook fires.
if ! node dev/tools/binding-gate.mjs; then
  echo "[BLOCK] new unbound identifier(s) — an extraction left a dangling reference"
  block_fail=1
fi

if ! node dev/tools/entry-state-inventory.mjs --check; then
  echo "[BLOCK] unclassified module-scope state in the composition root"
  block_fail=1
fi

# Phase 5.0.8: export-surface comparison. Every exported name at origin/main
# must still exist (directly or via re-export chain) at HEAD — catches a split
# deleting an exported name even when nothing imports it.
if ! node dev/tools/export-surface-compare.mjs; then
  echo "[BLOCK] export-surface regression(s) vs origin/main"
  block_fail=1
fi

# Phase 5.0 gates — permanent lint enforcement (5.0.7).
# `npm run lint` (eslint 9 flat config, scripts/**/*.mjs) is error-level
# blocking: 0 errors / 4,760 warnings is the recorded 5.0.5+5.0.6 baseline.
# Warnings are deliberately non-blocking (not warning-clean yet; see plan
# 5.0.7). The unused-import gate is --strict: removable unused imports
# block, docOnly findings (referenced in comments/strings) stay
# informational per the plan's decision-table recommendation.
echo "=== BLOCKING — lint (Phase 5.0.7) ==="

if ! npm run lint --silent; then
  echo "[BLOCK] eslint error-level findings (see baseline note)"
  block_fail=1
fi

if ! node dev/tools/unused-imports.mjs --strict; then
  echo "[BLOCK] removable unused import(s) (docOnly findings are informational)"
  block_fail=1
fi

echo "=== BLOCKING — regressions of previously fixed bugs ==="

# Socketlib auth: handler context is { socketdata: { userId } }, not { senderId }.
scan_block "this.senderId (socketlib gives this.socketdata.userId)" \
  'this\.senderId' "${mjs_paths[@]}"

# Async global leakage between hook handlers (v6.10.15 fix).
scan_block "window._lastPlacedTemplateId (use let-scoped local in same fn)" \
  'window\._lastPlacedTemplateId' "${mjs_paths[@]}"

# Roll.safeEval sandbox exposes bare math fns; Math.* inside arg breaks.
scan_block "Math.* inside Roll.safeEval string arg (v6.10.15 fix)" \
  'Roll\.safeEval\([^)]*Math\.(floor|ceil|round|min|max|abs|PI|sqrt)' "${mjs_paths[@]}"

# Legacy v13 chat render hook. v14 fires renderChatMessageHTML.
scan_block 'Hooks.on("renderChatMessage" (use renderChatMessageHTML in v14)' \
  'Hooks\.on\("renderChatMessage"[^H]' "${mjs_paths[@]}"

# Global DOM monkeypatch — replaced with scoped hook in v6.10.15.
scan_block "Element.prototype.querySelector = (global monkeypatch)" \
  'Element\.prototype\.querySelector\s*=' "${mjs_paths[@]}"

# Heuristic Region pairing — v14 binds template.id === region.id (v6.10.16 fix).
scan_block "existingRegionIds snapshot (use parent.regions.get(template.id))" \
  'existingRegionIds\s*=' "${mjs_paths[@]}"

# Async prepareActorData hook — removed in v6.10.15.
scan_block "prepareActorData hook (use updateActor/renderActorSheet/createItem)" \
  'Hooks\.on\("prepareActorData"' "${mjs_paths[@]}"

# Region delete hook duplication — removed in v6.10.16.
scan_block 'Hooks.on("deleteRegion" (cascade already fires deleteMeasuredTemplate)' \
  'Hooks\.on\("deleteRegion"\s*,\s*\([^)]*\)\s*=>\s*_onDeleteTemplate' "${mjs_paths[@]}"

# Context menu v13 properties.
scan_block "context menu name:/condition: (use label:/visible: in v14)" \
  'menuItems\.push\(\s*\{\s*name:|menuItems\.push\(\s*\{\s*[^}]*condition:' "${mjs_paths[@]}"

echo "=== WARNING — pre-existing tech debt (use --strict to block) ==="

# Raw eval() — pre-existing in TMFXFilterEditor. Should migrate to scoped evaluator.
scan_warn "raw eval( — use Roll.safeEval for formulas, new Function for scoped" \
  '^[^/]*[^.]eval\(' "${mjs_paths[@]}"

# Unescaped img.src — pre-existing in macro/carousing/formation files. XSS surface.
scan_warn "raw src=\${...img/image} — wrap in foundry.utils.escapeHTML for XSS safety" \
  'src="\$\{[A-Za-z_$][A-Za-z0-9_$]*\.(img|image)\}"' "${mjs_paths[@]}"

echo "=== pack runtime state ==="
if [ -f packs/pack-sdxeffects/LOCK ]; then
  recent_log=$(find packs/pack-sdxeffects -name '*.log' -mmin -1 2>/dev/null | head -1)
  if [ -n "$recent_log" ]; then
    echo "[WARN]  pack-sdxeffects log recently modified ($recent_log). Foundry may be running — close world before committing pack changes."
    warn_fail=1
  fi
fi

echo
if [ $block_fail -ne 0 ]; then
  echo "verify: FAIL (blocking)"
  exit 1
fi
if [ $strict -eq 1 ] && [ $warn_fail -ne 0 ]; then
  echo "verify: FAIL (strict mode — warnings treated as errors)"
  exit 1
fi
if [ $warn_fail -ne 0 ]; then
  echo "verify: OK with warnings"
  exit 0
fi
echo "verify: OK"
