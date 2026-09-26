#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=== KoNfiX — Der visuelle KNX-Konfigurator ==="

# Check if frontend is built
if [ ! -d "apps/web/dist" ]; then
    echo "[1/2] Building Web Frontend..."
    cd apps/web
    if command -v bun &> /dev/null; then
        bun run build
    elif [ -f "$HOME/.bun/bin/bun" ]; then
        "$HOME/.bun/bin/bun" run build
    else
        npm run build
    fi
    cd "$DIR"
fi

echo "[2/2] Starting Rust Backend Core on http://localhost:8080 ..."
cd crates/knx-core
exec cargo run --release --bin konfix
