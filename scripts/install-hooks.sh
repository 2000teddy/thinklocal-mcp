#!/usr/bin/env bash
# Installs the pre-commit hook into the local .git/hooks directory.
# Run once after clone/checkout: bash scripts/install-hooks.sh
set -euo pipefail

HOOK_DIR="$(git rev-parse --git-dir)/hooks"
HOOK_FILE="$HOOK_DIR/pre-commit"

mkdir -p "$HOOK_DIR"

cat > "$HOOK_FILE" << 'HOOK'
#!/usr/bin/env bash
# thinklocal-mcp pre-commit hook
# Installed by scripts/install-hooks.sh
# Bypass with: git commit --no-verify (use sparingly!)
set -euo pipefail

CHANGED=$(git diff --cached --name-only)

# 1. If TypeScript code changed, CHANGES.md must be staged too
if echo "$CHANGED" | grep -qE '\.ts$'; then
  if ! echo "$CHANGED" | grep -q 'CHANGES.md'; then
    echo ""
    echo "╔══════════════════════════════════════════════════════════╗"
    echo "║  COMPLIANCE: Code changed but CHANGES.md not updated.   ║"
    echo "║  Please add a changelog entry before committing.        ║"
    echo "║  Bypass: git commit --no-verify (emergency only!)       ║"
    echo "╚══════════════════════════════════════════════════════════╝"
    echo ""
    exit 1
  fi
fi

# 2. If daemon source changed, COMPLIANCE-TABLE.md must be staged too
if echo "$CHANGED" | grep -qE 'packages/daemon/src/.*\.ts$'; then
  if ! echo "$CHANGED" | grep -q 'COMPLIANCE-TABLE.md'; then
    echo ""
    echo "╔══════════════════════════════════════════════════════════╗"
    echo "║  COMPLIANCE: Daemon code changed but COMPLIANCE-TABLE   ║"
    echo "║  not updated. Please add a compliance row.              ║"
    echo "║  Bypass: git commit --no-verify (emergency only!)       ║"
    echo "╚══════════════════════════════════════════════════════════╝"
    echo ""
    exit 1
  fi
fi

# All checks passed
HOOK

chmod +x "$HOOK_FILE"
echo "Pre-commit hook installed at $HOOK_FILE"
