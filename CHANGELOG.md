# Changelog: KoNfiX — The Visual KNX Configurator

All notable changes, milestones, and feature additions to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and adheres to Calendar/Semantic Versioning (`YYYY.M.PATCH`).

---

## [2026.9.1] - 2026-09-26 (Initial Multi-Platform Release)

### Internationalization (i18n) & Multilingual Support
- **Full Bilingual Support (DE / EN):** Native, zero-dependency, reactive React context (`I18nContext.tsx`) with 100% type safety and standard KNX industry terminology.
- **Language Switcher:** Country flag selector (🇩🇪 DE / 🇬🇧 EN) in the header with persistent language preferences in `localStorage` (`konfix_language`) and browser language detection (`navigator.language`).
- **Comprehensive Translations:** All main workspaces, modals, device/function inspectors, topology managers, and diagnostics tools are fully translated.

### Visual Blueprint & Function Block Configuration
- **Canvas Logic:** Universal logic gates (AND, OR, XOR, NOT, NAND, NOR, RS-Flip-Flop), weekly timers, threshold switches with hysteresis, and staircase lighting.
- **Autonomous Shading & Astro Engine:** Mathematical solar calculation (azimuth/elevation based on NOAA algorithms) without any cloud dependency.
- **Physical Device Blocks on Canvas (`KnxDeviceBlockNode.tsx`):**
  - Blueprint hardware blocks with interactive communication object pins (inputs Cyan, outputs Amber/Emerald).
  - Channel and function filtering, plus live telegram testing directly from the block.
- **Auto-GA Routing:** Fully automated creation, naming, and linking of group addresses when drawing a connection wire between two pins (`auto_ga.rs`).
- **Room Portals (`RoomPortalNode.tsx`):** Visual jump connections for cross-room KNX lines with 1-click navigation into target rooms.
- **Signal Flow Simulation (`simulator.rs`):** Deterministic FIFO wire propagation with loop protection (max. 48 hops) and animated connection pulses.

### Topology, Line Couplers & Filter Tables
- **Area & Line Tree (`TopologyWorkspace.tsx`):** Full support for hierarchical KNX topologies (areas 1..15, lines 1.1..1.15) across TP, IP, and RF media.
- **8192-Byte Filter Table Engine (`topology.rs`):** Automatic calculation of optimal coupler bitmasks from project group addresses, supporting filter, route, and block coupler modes.
- **Binary Export:** 1-click download of the exact 8192-byte binary filter table (`.bin`) for flashing line couplers.

### Diagnostics & Real-Time Bus Monitor
- **255-Address Matrix (`DiagnosticsWorkspace.tsx`):** 16x16 line scanner detecting occupied physical addresses, round-trip times (RTT), and devices in programming mode.
- **Real-Time Bus Monitor (`BusMonitor.tsx`):** Live telegram streaming over WebSocket (`/ws/bus`), cEMI decoding, and manual telegram transmission.

### Hardware Catalog & SQLite Database
- **High-Performance SQLite Database (`catalog.db`):** Fast B-Tree indexed catalog for hundreds of thousands of KNX devices with auto-seeding on first launch from `database/catalog.sql`.
- **Native .knxprod Import (`knxprod.rs`):** XML parser for original manufacturer files (.knxprod / ZIP) extracting communication objects, parameters, and hierarchical `<Dynamic>` conditions.

### Security & Communication
- **KNX Data Secure on TP (`data_secure.rs`):** FDSK import, cryptographic tool key generation, and AES-128-CCM authenticated encryption at the management layer (ISO 22510).
- **KNXnet/IP Secure Gateway (`knx_secure.rs` & `knxnet_ip.rs`):** Robust TCP tunneling client with Diffie-Hellman key exchange, authenticated encryption, and automated session heartbeats.

### Differential Flashing & Job Manager
- **Change Detection (`programming.rs`):** Precise breakdown of dirty state with human-readable explanations for every modified parameter or KO association.
- **Sequential Flash Worker (`ProgrammingJobDrawer.tsx`):** Reliable bus programming queue with step-by-step verification and live logging.

### Model Context Protocol (MCP) & AI Integration
- **Native MCP Server (`tools/knx-mcp`):** 9 standardized KNX tools for Claude Desktop, Cursor, and Gemini CLI.
- **Semantic Group Address Resolution:** Natural language commands (e.g., *"Turn on the living room ceiling light"*) without manual entry of numeric addresses.

### Licensing & Multi-Platform Deployment
- **GNU AGPLv3:** Guaranteed long-term protection against commercial lock-in, ensuring software freedom for the community.
- **Containerization & Docker Deployment (`Dockerfile`, `compose.yaml`):** Production-ready multi-stage image (Bun frontend builder, Rust core compiler, Debian-slim runtime) with `/data` volume persistence and automated SQLite catalog seeding.
- **GitHub Actions Release Matrix (`.github/workflows/release.yml`):** Automated creation of standalone release packages for Linux x86_64, Linux ARM64 (Raspberry Pi), macOS Apple Silicon (M1–M4), macOS Intel, and Windows x86_64 on every git tag (`v*`).
