#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=== KoNfiX — Native Desktop Application ==="

# Check bun availability
BUN_BIN="bun"
if ! command -v bun &> /dev/null; then
    if [ -f "$HOME/.bun/bin/bun" ]; then
        BUN_BIN="$HOME/.bun/bin/bun"
    fi
fi

# Ensure root dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "[1/3] Installing root dependencies..."
    "$BUN_BIN" install
fi

# Ensure frontend dependencies are installed
if [ ! -d "apps/web/node_modules" ]; then
    echo "[2/3] Installing Web Frontend dependencies..."
    (cd apps/web && "$BUN_BIN" install)
fi

# Ensure frontend is built for production fallback
if [ ! -d "apps/web/dist" ]; then
    echo "[3/3] Building Web Frontend assets..."
    "$BUN_BIN" run --cwd apps/web build
fi

echo "[✓] Launching KoNfiX Desktop Window..."
exec "$BUN_BIN" run tauri dev "$@"
