# ==========================================
# Stage 1: Build Web Frontend
# ==========================================
FROM oven/bun:1-alpine AS frontend-builder
WORKDIR /app/apps/web

COPY apps/web/package.json apps/web/bun.lock* ./
RUN bun install --frozen-lockfile || bun install

COPY apps/web ./
RUN bun run build

# ==========================================
# Stage 2: Build Rust Backend Core
# ==========================================
FROM rust:1-bookworm AS backend-builder
WORKDIR /app

# Cache dependency builds
COPY Cargo.toml Cargo.lock ./
COPY crates/knx-core/Cargo.toml crates/knx-core/

RUN mkdir -p crates/knx-core/src && \
    echo "pub fn dummy() {}" > crates/knx-core/src/lib.rs && \
    echo "fn main() {}" > crates/knx-core/src/main.rs && \
    cargo build --release -p knx-core && \
    rm -rf crates/knx-core/src target/release/deps/knx* target/release/deps/konfix* target/release/.fingerprint/knx* target/release/.fingerprint/konfix*

COPY crates/knx-core crates/knx-core
RUN cargo build --release -p knx-core

# ==========================================
# Stage 3: Minimal Production Runtime
# ==========================================
FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy compiled backend binaries (KoNfiX core & KNX sniffer)
COPY --from=backend-builder /app/target/release/konfix /app/konfix
COPY --from=backend-builder /app/target/release/knx_sniffer /app/knx_sniffer

# Copy pre-built frontend to /app/dist (matched by Axum ServeDir fallback)
COPY --from=frontend-builder /app/apps/web/dist /app/dist

# Copy SQLite catalog seed dump
COPY database /app/database

# Default configuration environment variables
ENV PORT=8080
ENV KONFIX_DATA_DIR=/data
ENV RUST_LOG=knx_core=info,tower_http=info

# Persistent data directory for projects, views & catalog.db
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8080

ENTRYPOINT ["/app/konfix"]
