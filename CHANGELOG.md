# Changelog: KoNfiX — The Visual KNX Configurator

All notable changes, milestones, and feature additions to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and adheres to Calendar/Semantic Versioning (`YYYY.M.PATCH`).

---

## [2026.10.7] - 2026-10-13 (Language Dropdown Z-Index Fix, Barycentric Wire Auto-Layout & Edge UX Polish)

### Header & UI Layering Fixes (`Header.tsx`, `RightSidebar.tsx`, `LeftSidebar.tsx`)
- **Language & Project Dropdown Z-Index Fix:** Resolved a stacking context inversion where the language switcher (`[🇩🇪 DE ^]`) and project dropdowns disappeared behind the right inspector (`RightSidebar`) and left sidebar.
- **Header Elevation (`z-40`):** Elevated the top bar `<header>` to `z-40`, ensuring dropdowns reliably float above all canvases, toolbars, and desktop sidebars while remaining subordinate to full-screen modals (`z-50`).
- **Dismiss Backdrop Containing Block Fix:** Removed `backdrop-blur` from `<header>`. Per CSS specification, `backdrop-filter` creates a containing block for `fixed` descendants, which previously restricted the transparent click-outside backdrop to the 56px header height. The backdrop now spans the entire viewport.
- **Conditional Drawer Layering:** Scoped `z-40` on `RightSidebar` and `LeftSidebar` exclusively to mobile drawer mode (`isOpen: true`), leaving desktop sidebars in standard flex document flow (`z-auto`).
- **Typo Fix:** Corrected duplicate Tailwind breakpoint `xl:xl:w-84` to `xl:w-84` in `RightSidebar.tsx`.

### Flow Canvas Barycentric Auto-Layout (`FlowCanvas.tsx`)
- **Crossing-Free Wire Routing:** Implemented barycentric vertical node placement in the auto-layout engine. Upstream and downstream nodes align dynamically with connected terminal pins, generating clean, parallel, horizontal wire routes without overlapping crossings.
- **Deterministic Column Hierarchy:** Maintained primary column anchor for local sensors and sorted unplaced nodes predictably by individual address and name.

### Knx Wire Edge Ergonomics (`KnxWireEdge.tsx`)
- **Zero-Latency Badge Tracking:** Separated instantaneous geometry positioning (`0ms` transform) from smooth hover transitions, eliminating badge drag lag during canvas pans and node moves.
- **Center-Stable Corner-Pin Delete Button:** Converted the wire deletion button into a corner-pin badge (`top: -6px; right: -6px`), preserving the GA text's exact geometrical center during hover and selection.
- **24px Interactive Hit Area:** Added an invisible 24px wide stroke geometry (`knx-wire-group`) for effortless mouse clicks and hover detection on thin wires.

## [2026.10.6] - 2026-10-13 (Mobile Responsiveness, Wire Animation Toggle, db.konfix.sduni.de Catalog & Header Settings Shortcut)

### Mobile Responsiveness & Ergonomics (`MobileBottomNav.tsx`, `LeftSidebar.tsx`, `RightSidebar.tsx`, `Header.tsx`, `index.html`)
- **Native Mobile Bottom Navigation Bar:** Introduced a dedicated thumb-friendly bottom nav bar on smartphones (`< md`) for instant switching between *Logik*, *Topologie*, *Diagnose*, and *Hausplan* with iOS safe area support (`pb-[env(safe-area-inset-bottom)]`).
- **Responsive Slide-Over Drawers:** Converted `LeftSidebar` (Rooms/Blocks/Devices) and `RightSidebar` (Inspector/GAs) into touch-friendly slide-over drawers with backdrops on mobile (`< lg` and `< xl`), providing 100% viewport width for the visual canvas. Added quick toggle buttons (`PanelLeft`, `SlidersHorizontal`) in the header.
- **Header Collision Elimination:** Compacted workspace switcher in Zone 2 to icon-only buttons on tablets and laptops (`md` to `< xl`), shrinking width from 480px to 140px and preventing collisions.
- **Mobile Viewport Optimization:** Updated `viewport-fit=cover` and double-tap prevention in `index.html`.
- **Bounded Bus Monitor:** Restricted expanded bus monitor to `max-h-[50vh]` on small screens so canvas remains accessible.

### Header Cleanup & Wire Animation Toggle (`Header.tsx`, `FlowCanvas.tsx`, `App.tsx`)
- **Removed Misleading Simulation Button:** Removed the prominent `Simulation / Entwurf` header button which only toggled SVG dash animations on canvas wires.
- **Canvas Wire Animation Toggle:** Added a sleek energy bolt button (⚡ `Zap`) directly to `FlowCanvas`'s top-right toolbar alongside Minimap and FitView, with `localStorage` persistence (`konfix_wire_animated`).

### UI & Layout Polish (`Header.tsx`, `BusMonitor.tsx`, `RightSidebar.tsx`, `FlowCanvas.tsx`, `RoomTabBar.tsx`)
- **Responsive Workspace Switcher:** Replaced fragile absolute centering with native flex flow (`flex-1 min-w-0`), eliminating button collisions with toolbar actions at all viewport widths.
- **1-Click Settings Shortcut:** Added a dedicated gear button (`Settings` ⚙️) to the header's right toolbar next to the language switcher with smooth hover animation and tooltip.
- **Startup Bus Monitor State:** Minimized bus monitor by default (`isOpen: false`), granting 100% vertical canvas viewport on application launch, with all title badges and load gauges protected against multi-line text wrapping (`whitespace-nowrap shrink-0`).
- **Expanded Right Inspector:** Widened inspector panel (`w-80 xl:w-84`) and introduced 2-row card layout for Group Addresses (address & DPT pill on top, full name below) plus clean badge overview.
- **Cleaner Flow Canvas:** Removed React Flow watermark (`hideAttribution: true`), streamlined zoom and snap indicator into a compact status badge (`128px Raster · Fang 64px · 32%`), and made MiniMap collapsible via a new top-right toolbar toggle button.
- **Room Tab Protection:** Added `truncate max-w-[130px]` and tooltips to room tabs, preventing tab layout overflow on long room names.

### Online Catalog URL Update & Storage Migration (`db.konfix.sduni.de`)
- **New Catalog Database URL:** Updated the default online device catalog repository URL to `https://db.konfix.sduni.de`.
- **Automatic Settings Migration:** `StorageManager::new()` in `storage.rs` automatically detects legacy `https://konfix.sduni.de` entries in `~/.konfix/settings.json` and migrates them to the new endpoint on launch.
- **Dynamic Configuration:** Added `KONFIX_CATALOG_URL` environment variable support for runtime catalog overrides.
- **Frontend & Locales:** Synchronized `StorageSettingsModal`, `AddDeviceModal`, and German/English translation files (`de.ts`, `en.ts`).

## [2026.10.5] - 2026-10-13 (Native Desktop Application & Multi-Platform CI/CD Pipeline)

### Native Desktop Application (`src-tauri`, `konfix-desktop`, `wry`/`tao`)
- **Tauri v2 Desktop Architecture:** Integrated full native desktop support using Tauri v2. KoNfiX runs as a true OS-level standalone application utilizing native system webviews (WebKitGTK on Linux, WebView2 on Windows, WebKit on macOS), reducing memory consumption from ~200MB+ (Electron) down to ~35–45 MB RAM.
- **In-Process Tokio Core Engine:** The Rust backend (`knx-core`) executes directly within a background Tokio task in the desktop process. When the application window closes, the entire server shuts down cleanly with zero orphaned processes or locked ports (`8080`).
- **Native Window Ergonomics:** Standard 1440x900 resolution (minimum 1024x700), native window controls, and official high-resolution icon sets (`.icns`, `.ico`, 32px to 512px) generated from `favicon.svg`.
- **Intelligent Origin Detection:** Updated `apps/web` API client (`api.ts`) and WebSocket bus monitor (`useBusMonitor.ts`) to automatically detect whether the frontend runs inside a web browser or the Tauri desktop runtime (`tauri://localhost`, `http://tauri.localhost`), seamlessly routing to `http://127.0.0.1:8080`.

### 1-Click Launchers & Desktop Integration (`start-desktop.sh`, `konfix.desktop`)
- **Dedicated Desktop Runner (`start-desktop.sh`):** Added a 1-click bash runner that verifies dependencies, builds frontend assets if needed, and launches the desktop app.
- **Enhanced `start.sh`:** Added `--desktop` / `-d` flags to seamlessly launch in desktop mode.
- **Linux Application Menu (`konfix.desktop`):** Standard Freedesktop `.desktop` launcher for direct integration into application menus on Ubuntu, Debian, Arch, Fedora, and other Linux distributions.

### Cross-Platform CI/CD Release Pipeline (`.github/workflows/desktop-release.yml`)
- **Automated Multi-Platform Packaging:** Added official `tauri-action` GitHub workflow triggering on release tags (`v*`) and manual workflow dispatch across `ubuntu-22.04`, `windows-latest`, and `macos-latest`.
- **Native Installer Outputs:**
  - **Linux:** Standalone portable `.AppImage` (runs on any Linux distribution without installation) and Debian/Ubuntu `.deb` packages.
  - **Windows:** Full NSIS Setup-Wizard `.exe` installer (supports CalVer 2026.x without MSI 255-major limitation).
  - **macOS:** Standard `.dmg` disk image and `.app` bundle.
- **CI Build Hardening (`ci.yml`):** Added Linux WebKitGTK and GTK development headers to automated CI workflows to guarantee workspace compilation on every commit and pull request.

### Monorepo Synchronization & Bumper Upgrades (`tools/bump-version.sh`)
- **Atomic Multi-Crate CalVer Bumping:** Upgraded `tools/bump-version.sh` to synchronize `crates/knx-core`, `src-tauri`, `tauri.conf.json`, `apps/web`, `server.rs`, `Cargo.lock`, and `CHANGELOG.md` in a single command.

## [2026.10.4] - 2026-10-12

### changed
- Bumb up version to 2026.10.4.

## [2026.10.3] - 2026-10-12 (Full Multilingual Parity: Dynamic Parameters & KOs, Complete UI Localization, Catalog YAML & Performance)

### Full UI & Parameter Internationalization (`i18n`, `knxprod.rs`, `RightSidebar.tsx`, `DeviceKoParamModal.tsx`)
- **Multilingual KNX Parameter & Object Model (`model.rs`, `types/knx.ts`):** Added `text_en` to `DeviceParameter` and `ParameterOption`, as well as `object_text_en` and `function_text_en` to `CommunicationObject` across backend Rust and frontend TypeScript models.
- **Two-Pass XML Catalog Parser (`knxprod.rs`):** Upgraded `.knxprod` parser to extract English (`en-US`) and German (`de-DE` / fallback) translation tables simultaneously from manufacturer XML files (`M-xxxx_A-xxxx.xml`). Parameter labels, enum dropdown options, and communication object texts are now populated with localized strings.
- **Dynamic Parameter & KO Display:** Components (`RightSidebar.tsx`, `DeviceKoParamModal.tsx`, `KnxDeviceBlockNode.tsx`) dynamically resolve labels based on the active UI language (`locale === 'en' ? item.text_en : item.text`), providing full English parity for device parameter configurations and canvas KO pins.
- **Comprehensive UI Localization:** Eliminated all hardcoded strings across Header, Sidebars, Bus Monitor, Canvas Nodes, Diagnostics, and Modals with 100% type-safe i18n dictionaries (`de.ts`, `en.ts`).

### Bus Monitor & Device Workflow Enhancements (`BusMonitor.tsx`, `LeftSidebar.tsx`, `RightSidebar.tsx`)
- **Refined REC Recording Controls (`BusMonitor.tsx`):** Clarified recording state indicator (REC badge with pulsing status) avoiding confusion with separate stop buttons, with explicit tooltips explaining ring-buffer logging versus live-only monitoring.
- **Unassigned Device Highlighting:** Devices without an individual address are highlighted with warning badges (`missingAddressBadge`, `-.-.-`) and animated alerts, offering a 1-click auto-addressing button assigning the next free address in line 1.1.

### Catalog YAML & Online Catalog Integration (`catalog_yaml.rs`, `AddDeviceModal.tsx`)
- **Native YAML Catalog Support:** Integrated high-performance parser for KoNfiX `.yaml` catalog definitions and SQLite database manager (`~/.konfix/catalog.db`).
- **Online Catalog Browser:** Instant search and 1-click import from remote catalog repository (`db.konfix.sduni.de`).

### Canvas Performance & Interaction
- **Smooth Drag & Pan Performance (`FlowCanvas.tsx`):** Eliminated lag and handle dragging drag-behind on canvas nodes through optimized render batching and throttling.

## [2026.10.2] - 2026-10-06 (ETS 6.2 Full Parity: Telegram Recorder, Project Diff/Merge, Hardware Wizard & Topology Integrity)

### Professional Bus Monitor & Telegram Recorder (`recorder.rs`, `BusMonitor.tsx`)
- **Configurable Telegram Ring Buffer (`recorder.rs`):** High-capacity in-memory ring buffer supporting up to 50,000 telegrams with full session controls (REC/PAUSE/STOP) and memory cleanup.
- **Physical TP Bus Load Calculation (`TpFrameLoadCalculator`):** Precise mathematical modeling following the KNX TP physical standard: 11 bits per octet (1 start, 8 data, 1 parity, 1 stop bit) + 50 bit inter-frame pause at 9,600 baud. Features real-time sliding-window bus load calculation (gauge with green-yellow-red thresholding) and peak load detection (`peak_bus_load_percent`).
- **Comprehensive Wildcard Filter Matrix (`TelegramFilter`):** Multi-criteria filtering supporting wildcards for source and destination addresses (e.g. `1.1.*`, `4/0/*`), telegram service types (`Write`, `Read`, `Response`), priorities (`System`, `Urgent`, `Normal`, `Low`), and datapoint types (DPTs).
- **Official ETS XML & CSV Format Support:** 100% interoperable export and import supporting ETS `<KNXMonitor>` XML format (`KNXMonitor.xsd`) and standard ETS semicolon-delimited CSV for offline trace inspection.

### Advanced Diagnostic Suite & Hardware Wizard (`diagnostics.rs`, `DiagnosticsWorkspace.tsx`)
- **Automated Physical Address Collision Detection:** Actively scans the project database and real-time bus scan responses to detect conflicting physical addresses, displaying an interactive alert banner with quick-jump to conflicts.
- **Optical Device Locator (LED Blinking):** Direct cEMI management trigger (`locate_device`) pulsing the device's programming LED for 5 seconds for rapid visual identification inside electrical distribution cabinets.
- **Programming Without Button Press via 6-Byte Serial Number:** Direct support for `A_IndividualAddress_SerialNumber_Write` allowing physical address assignment to hard-to-reach actuators using their factory 6-byte KNX serial number (e.g. `00:83:7B:40:02:85`).
- **Dual-Mode Address Flasher UI:** Integrated tabbed wizard in `DiagnosticsWorkspace.tsx` supporting traditional programming button detection (with multi-device safety interlock) and direct serial number provisioning.

### Project Comparison & Revision Diff (`project_compare.rs`, `ProjectCompareModal.tsx`)
- **Granular 4-Tier Hierarchical Diff:** Deep structural comparison between active project and arbitrary `.knxproj` files or historical snapshots across:
  1. *Topology & Devices:* Added, deleted, and modified devices.
  2. *Group Addresses:* Added, deleted, and modified GAs (name, DPT).
  3. *Parameters:* Per-device parameter value deviations.
  4. *Communication Objects:* Linked group address discrepancies on KO level.
- **Selective Merge Engine:** Interactive visual diff matrix with color badges (green/red/yellow) and granular checkboxes enabling selective or complete (`merge_all`) synchronization into the active project.
- **Central Menu Access:** Directly accessible from the main header dropdown under *"Projekt & ETS"* -> *"Projekt-Diff & Merge"*.

### Topology Integrity & Coupler Diagnostics (`topology.rs`, `TopologyWorkspace.tsx`)
- **Line Coupler Health & Cross-Line Filter Validation:** Analyzes coupler filter tables (`x.y.0`) and flags erroneously blocked cross-line group addresses (`blocked_cross_line_gas`) where devices communicate across coupler boundaries without proper pass-through rules.
- **Line Bandwidth & Load Estimation:** Live tabular breakdown of all project lines showing transmission medium (TP/IP), device count, KO density, and estimated bus load (Optimal, Normal, High).
- **Topologie-Integritäts-Score (0–100%):** Comprehensive health score dashboard evaluating area/line structure, isolated devices, and routing issues in `TopologyWorkspace.tsx`.

### Dynamic Tree & Visual KO Wiring (Phases 1–3 Parity)
- **Dynamic Parameter Tree & Quick-Jump (`DeviceKoParamModal.tsx`):** ETS-compliant `TrySelectFirst` page focus handling when conditions hide tabs, with interactive "Jump to parameter" navigation and green halo highlighting for condition-controlling parameters.
- **Visual KO-to-KO Auto-GA Wiring on Canvas (`auto_ga.rs`, `dpt.rs`):** Intelligent multi-schema group address allocation when dragging wires directly between device KO pins, with strict DPT size compatibility checks (`are_dpts_compatible`).
- **Safety Multi-Device Programming Interlock (`diagnostics.rs`):** Broadcast `A_IndividualAddress_Read` safety scan preventing accidental simultaneous address writes when multiple devices have their programming buttons active.


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
