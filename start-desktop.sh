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

# Ensure frontend dependencies are installed
if [ ! -d "apps/web/node_modules" ]; then
    echo "[1/3] Installing Web Frontend dependencies..."
    cd apps/web && "$BUN_BIN" install && cd "$DIR"
fi

# Ensure frontend is built for production fallback
if [ ! -d "apps/web/dist" ]; then
    echo "[2/3] Building Web Frontend assets..."
    cd apps/web && "$BUN_BIN" run build && cd "$DIR"
fi

echo "[3/3] Launching KoNfiX Desktop Window..."
cd apps/web && exec "$BUN_BIN" run tauri dev
