# KNX Configurator — Web Frontend (`apps/web`)

Modernes Web-Frontend für den KNX Configurator, gebaut mit **React 19**, **TypeScript**, **Tailwind CSS**, **React Flow** und **Vite**.

---

## 3 Haupt-Arbeitsbereiche (Workspaces)

Die Navigation im Header erlaubt das Umschalten zwischen drei spezialisierten Arbeitsbereichen:

1. **Projekt & Canvas (`FlowCanvas.tsx`):**
   - Loxone-Style Flow-Canvas zur visuellen Programmierung.
   - Blueprint-Hardwareblöcke (`KnxDeviceBlockNode.tsx`) mit interaktiven KO-Pins.
   - Intelligente Funktionsblöcke (Licht, Jalousie, Astro, Szenen, Logik, Timer, Schwellwert).
   - Studio-Lichtmischpult (`SceneMixerModal.tsx`) mit DJ-Fadern und VU-Metern.
2. **Topologie & Filter (`TopologyWorkspace.tsx`):**
   - Baumansicht aller KNX-Bereiche (0..15) und Linien (0..15).
   - Berechnung und Anzeige der 8192-Byte binären Linienkoppler-Filtertabelle.
   - Umschaltung der Koppler-Modi (*Filtern*, *Durchleiten*, *Sperren*).
   - Manuelle Freigabe-Overrides und `.bin`-Dateiexport.
   - Verschieben von physischen Geräten zwischen Linien.
3. **ETS Diagnose & Adressierung (`DiagnosticsWorkspace.tsx`):**
   - 255-Adressen-Matrix (16x16) mit RTT-Latenzen und Maskenversionen.
   - Programmiermodus-Scanner für `A_IndividualAddress_Read`-Broadcasts.
   - Adress-Flasher (`A_IndividualAddress_Write`) direkt im Browser.

---

## Entwickler-Befehle

```bash
# Abhängigkeiten installieren
npm install

# Lokalen Vite Dev-Server starten (Port 5173 mit Hot-Module-Reloading)
npm run dev

# TypeScript Typecheck & Produktions-Build erstellen
npm run build

# Produktions-Build lokal vorab testen
npm run preview
```

Der Vite-Dev-Server leitet alle REST-Aufrufe (`/api/*`) und WebSocket-Telegramme (`/ws/bus`) automatisch an das Rust-Backend auf `http://localhost:8080` weiter.
