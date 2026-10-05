# Changelog: KoNfiX — The Visual KNX Configurator

All notable changes, milestones, and feature additions to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and adheres to Calendar/Semantic Versioning (`YYYY.M.PATCH`).

---

## [2026.10.1] - 2026-10-05 (Official ETS 6.2 XML Schema 23 Parity, Directory Manifest RSA Signing & Hardware ID Resolution)

### 100% Official ETS 6.2 XML Schema 23 & Master Data Parity
- **Official ETS Schema & Master XML Extraction (`docs/schemas/`):** Integrated official ETS 6.2 XML Schema definitions (`knx_project_23.xsd`, `knx_project_22.xsd`, `knx_project_21.xsd`, `knx_project_20.xsd`) and `knx_master.xml`.
- **Root XML Header Harmonization (`ets_export.rs`):** Aligned root XML header attributes (`CreatedBy="ETS6"`, `ToolVersion="6.2.7302.0"`) with ETS 6.2.2 specifications to ensure strict validation compliance in ETS6 project extractors.
- **Automated Schema Validation:** Exported projects validated against official `knx_project_23.xsd` via `xmllint` with 0 validation errors.

### Compliant Directory Manifest Signing (`P-XXXX.signature`) & Key Management
- **Directory Manifest Generation (`ets_export.rs`):** Generates compliant project directory manifests (`P-XXXX.signature`) hashing all files in the project folder with SHA-256 relative path references.
- **RSA PKCS#1 v1.5 with SHA-1 Signing:** Implemented compliant `SignedXml` RSA-SHA1 signing for ETS project archives (`XmlDsigRSASHA1Url`).
- **Flexible Custom Signing Key Configuration (`storage.rs`, `server.rs`, `StorageSettingsModal.tsx`):** Users can configure a custom RSA private key PEM file via UI settings (`StorageSettingsModal`), environment variable (`KONFIX_SIGNING_KEY`), or `~/.konfix/settings.json`.
- **Non-Blocking UI Export Guidance (`ExportKnxprojModal.tsx`):** Displays a clear, non-blocking informational notice when exporting without a configured private key, allowing export to proceed seamlessly with native unsigned status.

### Hardware Catalog Index & Schema ID Validation Fix
- **Elimination of `ID 'M-0083_H-1' is not a valid Id ID` (`knxprod.rs`, `ets_export.rs`, `ets_import.rs`):** Resolved ETS6 XML schema validation failure caused by non-standard fallback hardware IDs.
- **HardwareCatalogIndex Resolution:** Replaced synthetic hardware references (`H-1`) with official 3-segment hardware identifiers (`H-<SerialNumber>-<VersionNumber>`) derived directly from manufacturer `.knxprod` catalog metadata.

### Security Hardening, Test Portability & Key Redaction
- **Complete Manifest Hashing (`ets_export.rs`):** Hashes all project files under `{project_id}/` (including baggages/assets) into the directory manifest before signing with RSA PKCS#1 v1.5 SHA-1.
- **Timing Side-Channel Protection (`data_secure.rs`, `knx_secure.rs`):** Upgraded KNX Data Secure and KNX IP Secure MAC verification to constant-time comparison via `subtle::ConstantTimeEq`.
- **Zip-Slip & Decompression-Bomb Defenses (`ets_export.rs`, `ets_import.rs`):** Enforces `enclosed_name()` path sanitization on imported/exported ZIP entries and limits decompression streams to 64 MB per file.
- **Settings Permissions & Key Redaction (`storage.rs`, `server.rs`, `StorageSettingsModal.tsx`):** Enforces `0600` permissions on `~/.konfix/settings.json`, masks private keys as `"configured"` in GET API responses, and provides a 1-click removal button in the UI.
- **Hermetic Roundtrip Tests (`tests/test_roundtrip.rs`):** Tests autonomously generate ephemeral in-memory RSA keys and write to `temp_dir()`, ensuring 100% CI/CD independence from host environment state.


## [2026.10.0] - 2026-10-02 (ETS 6.2 Schema 23 Export Fix, i18n Localization, Security Hardening, Code Simplification & Performance)

### 100% ETS 6.2 XML Schema 23 Export & Roundtrip Fix
- **Lossless ETS Project Roundtrip (`ets_export.rs`, `ets_import.rs`):** Preserves original ETS project identifiers (`ets_project_id`, `ets_guid`, `ets_last_used_puid`), project traces, and history metadata.
- **KNX Data Secure Device Certificates:** Automatically generates and preserves `<DeviceCertificates>` (`SerialNumber`, `FDSK`) in `project.xml`, ensuring exported `.knxproj` archives open seamlessly in official ETS 6.2 without losing Data Secure keys or commissioning state.
- **Dynamic Topology & Line Mapping:** Correctly maps devices to their respective ETS areas and lines (`P-XXXX-0_L-X-X`), preventing topology orphan errors upon ETS import.
- **Automated Roundtrip Integration Tests (`tests/test_roundtrip.rs`):** Verified via full import, re-export, and byte/XML structure comparison against real-world ETS projects (`Marienthal`).

### Seamless i18n Localization & Elimination of Raw Keys
- **Elimination of Raw Literal Translation Keys:** Completely resolved all unformatted translation key paths displayed in the UI (`rooms.title`, `sidebar.blocks`, `sidebar.devices`, `rooms.buildingHierarchy`, `common.devices`).
- **Localization of Previously Hardcoded Strings:**
  - `RoomTabBar.tsx`: Central overview (`rooms.centralOverview`), New room (`rooms.newRoom`), tooltips, and confirmation/cancel actions.
  - `FlowCanvas.tsx`: Auto-layout button (`canvas.autoLayout`), dynamic zoom/snap indicator (`canvas.gridPattern`, `canvas.snap`), and fit-view tooltips.
  - `RightSidebar.tsx`: Project overview (`inspector.projectOverview`), Project Inspector header (`inspector.projectInspector`), GA routing scheme label, security status, GA manager button, and live active group address count badge (`inspector.activeGasCount`).
  - `BusMonitor.tsx`: Dynamic table headers (`Time`, `Source (IA)`, `Destination (GA)`, `Assigned Name / Trade`, `DPT`, `Type`, `Value`, `Test`), filter search input placeholder, pause/resume button status, clear log button, and telegram count statistics.
- **100% Type & Locale Parity:** Strict synchronization across `types.ts`, `locales/de.ts`, and `locales/en.ts` with automated parity validation (306 keys in each locale, 0 missing keys).

### Security & Hardening (STRIDE & OWASP Top 10)
- **Restrictive CORS Policy (`server.rs`):** Strict loopback interface binding (`localhost`, `127.0.0.1`, `[::1]`) and configurable `KONFIX_ALLOWED_ORIGINS` to prevent unauthorized cross-origin tampering or CSRF telegrams.
- **HTTP Security Headers (`server.rs`):** Global defense-in-depth middleware (`X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, `Content-Security-Policy`).
- **Path Traversal & OS Root Protection (`storage.rs`):** Strict sanitization via `sanitize_project_name` (blocking `..`, control characters, path separators) and hard blocking of operating system root directories (`/`, `/etc`, `C:\Windows`).
- **Zip-Bomb Prevention (`knxprod.rs`, `ets_import.rs`):** Bounded decompression (`take(64 MB)`) protects backend services against denial-of-service via malicious archive compression ratios.
- **Differentiated Axum Payload Limits (`server.rs`):** 8 MB global payload limit, with 128 MB reserved exclusively for dedicated archive import endpoints.

### Frontend Code Simplification & Refactoring
- **Function Block Factory Extraction (`blockFactory.ts`):** Extracted the ~450-line block generation logic from `App.tsx` into a dedicated, unit-testable factory module (-422 lines in `App.tsx`, -23% reduction).
- **Hook Optimization (`FlowCanvas.tsx`):** Pruned unused `useMemo` dependencies to eliminate redundant canvas re-renders.
- **Error Handling:** Consolidated fallback synchronization on connection interruption.

### Performance Optimization & Bundle Splitting
- **Initial Main Bundle Slimming:** Reduced initial JavaScript bundle size from **1,101 kB** down to **292 kB** (-73.5% / -813 kB).
- **On-Demand Lazy Loading:** Dynamic code-splitting for computation-heavy views and modals (`jsqr`, `TopologyWorkspace`, `DiagnosticsWorkspace`, `DeviceKoParamModal`, `AddDeviceModal`, `SceneMixerModal`).
- **Vendor Chunking:** Isolated, long-term cached browser vendor chunks for React/ReactDOM, Lucide icons, and xyflow.

## [2026.9.3] - 2026-09-29

### Changed
- Maintenance and version bump to 2026.9.3.

## [2026.9.2] - 2026-09-29 (Non-Destructive Flash Verification & Live QR-Code Commissioning)

### Non-Destructive Flash Verification & Dry-Run Mode
- **100% Read-Only Safety Guarantee (`programming.rs`):** Point-to-Point diagnostic & memory read workflow (`A_PropertyValue_Read`, `A_Memory_Read`) querying System B GAT (Obj 1), AT (Obj 3), and Parameter segments (Obj 4) without writing a single byte or rebooting devices. Eliminates all risk of corrupting actuator memory.
- **Bitwise & Semantic Diff Analysis:** Computes exact byte differences between live physical actuator memory and target KoNfiX engineering state, categorizing modified parameters (e.g. blind drive times, dimming speeds, threshold values).
- **Offline / Simulation Fallback:** Automatic diff verification against project `loaded_image` baseline when gateway is disconnected or during automated testing.
- **Interactive Audit Inspector (`ProgrammingJobDrawer.tsx`):** Expandable Hex and Parameter diff table with safe-to-flash assessment, safety scoring, and 1-click execution ("Jetzt übertragen").
- **Inspector Quick Action (`RightSidebar.tsx`):** Dedicated "Trockenlauf / Prüfen (Dry-Run)" button alongside the smart flash split-button.

### Live Webcam & Smartphone QR-Code Scanner for KNX Data Secure
- **Hardware-Accelerated Viewfinder (`KnxQrScanner.tsx`):** Real-time camera stream supporting mobile back cameras (`facingMode: 'environment'`), Mac Continuity Camera, and desktop webcams with animated scanning reticle, camera switcher, and photo upload fallback.
- **Automated KNX Certificate Parsing (`knxQrParser.ts`):** Decodes official KNX QR standard strings (`KNX:S:<serial>;F:<fdsk>`), raw hex strings, and extracts MAC-formatted serial numbers (`00:83:7B:40:02:85`) and 32-character FDSKs.
- **1-Click Secure Commissioning (`DeviceSecurityModal.tsx`):** Auto-fills device hardware ID and factory key while immediately toggling KNX Data Secure encryption on TP.

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
