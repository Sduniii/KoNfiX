# ETS-Projekt-Export Signierung (ETS 5 & 6 Kompatibilität)

## Problem Statement
Wie können wir Nutzern von KoNfiX ermöglichen, ETS-konform signierte `.knxproj`-Dateien zu exportieren, sodass die ETS beim Import weder Integritäts- noch Quellsignatur-Fehler meldet, indem ein privater Signierschlüssel flexibel in den Systemeinstellungen oder direkt im Export-Dialog hinterlegt wird?

## Recommended Direction
Wir integrieren ein zweistufiges Signierungssystem in KoNfiX:
1. **Zentrale Konfiguration (`~/.konfix/settings.json`):**
   - Der Parameter `signing_key` wird in `StorageSettings` verankert und kann über Umgebungsvariablen (`KONFIX_SIGNING_KEY`), die REST-API sowie im UI (`StorageSettingsModal.tsx`) gepflegt werden.
   - Der Schlüssel kann als RSA-Private-Key (PEM / PKCS#8 oder Base64) eingegeben werden.
2. **Interaktiver Export-Workflow (`ExportKnxprojModal.tsx`):**
   - Das Export-Modal zeigt den aktuellen Signatur-Status an (z. B. "Signierschlüssel aktiv" vs. "Kein Schlüssel hinterlegt – Fallback auf Test-Signatur").
   - Nutzer können einen Schlüssel ad-hoc für einen Export eingeben und optional mit einer Checkbox *"Dauerhaft in Einstellungen speichern"* ablegen.
3. **Kryptographische Signatur-Generierung (`ets_export.rs`):**
   - Wenn ein Signierschlüssel vorhanden ist, wird die Projektdatei `{project_id}.zip` (bzw. die Projekt-XMLs) mit RSA-SHA256 digital signiert und als Base64-Signaturdatei `{project_id}.signature` in das Root-Verzeichnis des `.knxproj`-Archivs geschrieben.
   - Falls kein Schlüssel vorliegt, wird eine formatkonforme Fallback-Signatur eingesetzt und der Nutzer im UI transparent auf die Einschränkung hingewiesen.

## Key Assumptions to Validate
- [ ] **Signatur-Prüfung in ETS:** ETS akzeptiert die mit dem konfigurierten RSA-Private-Key signierte `{project_id}.signature`.
- [ ] **Schlüsselformat-Toleranz:** Der Signer akzeptiert gängige PEM-Formate (`BEGIN RSA PRIVATE KEY`, `BEGIN PRIVATE KEY`) sowie rohe Base64-/DER-Schlüssel.
- [ ] **Sicherheit:** Der private Schlüssel wird in `settings.json` geschützt und in UI-Formularen mit Passwort-Maskierung (Sichtbarkeits-Toggle) dargestellt.

## MVP Scope
- **Backend:**
  - `StorageSettings` in `crates/knx-core/src/storage.rs` um `signing_key: Option<String>` erweitern.
  - REST-Endpunkte `/api/storage/settings` und `/api/project/export/knxproj` um den Parameter `signing_key` erweitern.
  - In `crates/knx-core/src/ets_export.rs` Signierungs-Engine via RSA-SHA256 für `{project_id}.signature` implementieren.
- **Frontend:**
  - `StorageSettingsModal.tsx`: Neuer Bereich für ETS-Signaturschlüssel mit Maskierung und Tooltip.
  - `ExportKnxprojModal.tsx`: Signatur-Statusbadge, optionales Eingabefeld für Ad-hoc-Schlüssel und Option zum Speichern.
  - Typ-Definitionen in `apps/web/src/types/storage.ts` und API-Calls in `api.ts`.
- **Tests:**
  - Unit-Tests für `StorageSettings` mit `signing_key`.
  - Export-Test zur Verifikation der erzeugten `{project_id}.signature`.

## Not Doing (and Why)
- **Keine automatische Schlüsselerzeugung ohne Nutzerzertifikat:** Ein zufällig generierter RSA-Schlüssel wird von einer lizenzierten ETS ohne KNX-Trust-Chain nicht als offizielle ETS-Herstellerlizenz anerkannt; der Nutzer muss seinen eigenen Schlüssel hinterlegen können.
- **Kein Aushebeln von ETS-Lizenzprüfungen:** KoNfiX bietet saubere Schnittstellen zur Eingabe legitimer Keys, umgeht jedoch keine KNX-Sicherheitsarchitektur illegal.

## Open Questions
- Gibt es spezifische XML-DSIG Enveloping-Anforderungen für bestimmte ETS 6.2 Plugins, oder reicht die Standard-ETS-Struktur `{project_id}.signature` im ZIP-Root aus? (Standardmäßig verwendet ETS `{project_id}.signature` als 128/256-Byte-Base64).
