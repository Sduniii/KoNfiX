# KoNfiX — Community & Foren-Post (v2026.10.6)

Dieses Dokument enthält die Veröffentlichungs- und Vorstellungsvorlage für Community-Foren (KNX-User-Forum, Home-Assistant, OpenKNX) im **BBCode-Format** sowie im **Markdown-Format**.

---

## 1. BBCode-Version (für Foren wie knx-user-forum.de)

```bbcode
Moin Leute,

ich hab die letzten Monate intensiv an einem Open-Source-Projekt gebastelt: [B]KoNfiX[/B] – ein visueller, lokaler KNX-Konfigurator (AGPLv3) mit Loxone-ähnlichem Workflow, aber ohne Cloud-Zwang und ohne teure ETS-Lizenz.

Das Projekt ist mittlerweile bei Version [B]v2026.10.6[/B] angekommen und hat sich von einer reinen Bastelei zu einer runden Gesamtlösung entwickelt.

[B]Wichtig vorab zum Thema Flashen & Sicherheit:[/B]
Die Programmier-Engine (Flashen von physikalischen Adressen, Gruppenadressen, differentielles Übertragen geänderter Parameter via Mask 07B0h / System B und KNX Data Secure auf TP) ist voll integriert. Trotzdem meine dringende Bitte: Testet Schreibvorgänge [B]zuerst auf Testbrettern oder mit DIY-Hardware (z.B. OpenKNX)[/B], bevor ihr an eure produktive Hauptverteilung geht. Wer nur den Bus analysieren oder Projekte planen will, kann das völlig gefahrlos tun – der Linien-Scan und der Bus-Monitor arbeiten rein passiv und schreiben nichts.

---

[B]Was das Tool macht / Die wichtigsten Features:[/B]

[LIST]
[*][B]Echte Native Desktop-App (Tauri v2):[/B]
Läuft als schlanke Standalone-App auf [B]Linux (.AppImage, .deb), Windows (.exe Setup) und macOS (.dmg)[/B]. Der Rust-Core läuft direkt im Hintergrund mit – braucht gerade mal ~35–45 MB RAM (kein ressourcenhungriger Electron- oder Node.js-Unterbau). Für Server- und Docker-Fans gibt es natürlich weiterhin Container und das Web-UI auf Port 8080.

[*][B]Visuelle Blueprint-Canvas & Auto-GA:[/B]
Geräte und Funktionsblöcke (Dimmer, Raffstores, Logikgatter, Szenenmischpult mit DPT 18.001, autonome NOAA-Astro-Sonnenschutzsteuerung ohne Cloud) frei platzieren. Einfach per Maus Leitungen zwischen Ein- und Ausgängen ziehen – die Gruppenadressen werden im Hintergrund vollautomatisch, kollisionsfrei und DPT-kompatibel geroutet. Signal-Portale verbinden Räume übersichtlich miteinander.

[*][B]100% ETS 6.2 Schema-23 Interoperabilität:[/B]
Voller, verlustfreier Roundtrip: Liest und exportiert native [ICODE].knxproj[/ICODE]-Archive nach offiziellem XML Schema 23 inklusive Directory-Manifest-Hashing und RSA-SHA1-Signierung ([ICODE]P-XXXX.signature[/ICODE]). Data-Secure-Schlüssel (FDSK, ToolKeys) und Original-Herstellerkataloge bleiben beim Im- und Export vollständig erhalten.

[*][B]Projekt-Diff & Selective Merge:[/B]
Zwei Projektstände (oder euer aktives Projekt gegen ein beliebiges Backup) auf 4 Ebenen vergleichen: Topologie, Gruppenadressen, Parameter und KO-Verknüpfungen. Änderungen lassen sich per Checkbox selektiv oder komplett synchronisieren.

[*][B]2D-CAD Hausplan (Grundriss):[/B]
Interaktiver Grundriss-Editor mit 90°-Wandsnapping, DIN-Aufschlagstüren, Fenstern, automatischer Raumflächenberechnung (m² per Shoelace-Formel) und platzierbaren Live-KNX-Widgets mit direktem Bus-Feedback.

[*][B]Hardware-Diagnose & Flashing-Assistent:[/B]
16x16 Linien-Scan-Matrix (1.1.1 bis 1.1.255), Erkennung des Programmiermodus, optischer Locator (Programmier-LED blinken lassen), Programmierung über 6-Byte Seriennummer ohne Tastendruck sowie Sicherheitsverriegelung gegen versehentlich gedrückte Tasten an mehreren Geräten.

[*][B]Bus-Monitor & TP-Buslast-Rekorder:[/B]
50.000 Telegramme Ringspeicher, Wildcard-Filter ([ICODE]1.1.*[/ICODE], [ICODE]4/0/*[/ICODE]), ETS XML- und CSV-Export und eine echte physikalische TP-Buslastberechnung (11 Bit/Byte + 50 Bit Inter-Frame-Pause bei 9600 Baud) mit Live-Tacho.

[*][B]KNX IP Secure & Live-Sniffer:[/B]
Direkte, verschlüsselte IP-Secure-Verbindung über TCP inklusive Keyring-Import ([ICODE].knxkeys[/ICODE]). Ein transparenter MitM-Sniffer liegt ebenfalls bei, falls man Gateways analysieren will.
[/LIST]

---

[B]Das KoNfiX-Ökosystem: Website & KoNfiX-Catalog[/B]

Neben dem eigentlichen Programm gibt es jetzt zwei zentrale Web-Anlaufstellen:

1. [B]Die Projekt-Website:[/B] [URL]https://konfix.sduni.de[/URL]
Hier findet ihr eine Übersicht über das Projekt, die Dokumentation, Architekturdetails und alle Download-Möglichkeiten.

2. [B]Der KoNfiX-Catalog (Online-Gerätedatenbank):[/B] [URL]https://db.konfix.sduni.de[/URL]
Ein offener, cloud-fähiger REST-Katalog für KNX-Geräte (quasi ein freier "ETS Online-Katalog"):
[LIST]
[*]Direkt in KoNfiX integriert: Geräte suchen und mit [B]1 Klick[/B] als natives Gerät ins eigene Projekt importieren – inklusive aller Kommunikationsobjekte und Parameter.
[*]Hersteller- & Community-Upload: Man kann rohe [ICODE].knxprod[/ICODE]-Dateien per Web-Upload oder REST-Schnittstelle hochladen. Das Backend entpackt die Archive automatisch, extrahiert Hersteller, Hardwaredaten und Applikationsprogramme und stellt sie bereit.
[*]Nativer zweisprachiger Support (DE/EN) für Parameter und KO-Beschriftungen.
[/LIST]

---

[B]Wie ihr gefahrlos testen könnt:[/B]
1. [B]Passiv mitlesen & planen:[/B] Linien-Scan, Bus-Monitor und Projektplanung nutzen (rein lesend bzw. offline – schreibt nichts auf den Bus).
2. [B]OpenKNX / DIY-Module:[/B] Ideal zum Testen der Flash-Engine – im Zweifelsfall flasht man einfach per USB neu.
3. [B]Testbrett / Reserve-Aktor:[/B] Sollte ein Schreibvorgang mal abbrechen, lässt sich das Gerät jederzeit über die offizielle ETS mit "Vollständig programmieren" wieder in den Originalzustand versetzen (Geräte gehen nicht kaputt).

KoNfiX flasht durch die differentielle Übertragung (nur geänderte Speicherbereiche) übrigens ausgesprochen flott.

[B]Was ich von euch brauche / Feedback gesucht:[/B]
[LIST]
[*]Wie verhält sich der Linien-Scan und das Flashen bei euren Herstellern (MDT, Gira, Theben, ABB, Weinzierl, etc.)?
[*]Gibt es bei bestimmten Geräten Timeouts oder Sonderlocken beim System B Ladevorgang?
[*]Funktioniert KNX Data Secure auf TP bei euren Geräten reibungslos?
[*]Wie gefällt euch der 1-Klick-Import aus dem Online-Katalog?
[/LIST]

[B]Downloads & Quellcode:[/B]
[LIST]
[*][B]Website & Doku:[/B] [URL]https://konfix.sduni.de[/URL]
[*][B]Online-Katalog:[/B] [URL]https://db.konfix.sduni.de[/URL]
[*][B]GitHub Releases (Desktop-Apps, Installer, Docker):[/B] [URL]https://github.com/Sduniii/KoNfiX/releases[/URL]
[/LIST]

[I]Einordnung zum Schluss:[/I] Ich habe KoNfiX ursprünglich für mich selbst gebaut, weil ich eine unabhängige, flüssige KNX-Lösung unter Linux ohne Windows-VM und ohne Lizenzkosten für mein Haus haben wollte. Den Zwang, dass am Ende eine 100% perfekte ETS-Dokumentation für einen gewerblichen Elektriker rausfallen muss, habe ich privat schlicht nicht. Ich teile das Projekt jetzt einfach, weil ich den technischen Austausch auf Code-Ebene spannend finde – wer mag, kann gerne testen, Feedback dalassen oder auf GitHub mitbasteln.

Grüße
```

---

## 2. Markdown-Version (für GitHub Discussions, Reddit, Blog)

```markdown
Moin Leute,

ich hab die letzten Monate intensiv an einem Open-Source-Projekt gebastelt: **KoNfiX** – ein visueller, lokaler KNX-Konfigurator (AGPLv3) mit Loxone-ähnlichem Workflow, aber ohne Cloud-Zwang und ohne teure ETS-Lizenz.

Das Projekt ist mittlerweile bei Version **v2026.10.6** angekommen und hat sich von einer reinen Bastelei zu einer runden Gesamtlösung entwickelt.

### Wichtig vorab zum Thema Flashen & Sicherheit:
Die Programmier-Engine (Flashen von physikalischen Adressen, Gruppenadressen, differentielles Übertragen geänderter Parameter via Mask 07B0h / System B und KNX Data Secure auf TP) ist voll integriert. Trotzdem meine dringende Bitte: Testet Schreibvorgänge **zuerst auf Testbrettern oder mit DIY-Hardware (z.B. OpenKNX)**, bevor ihr an eure produktive Hauptverteilung geht. Wer nur den Bus analysieren oder Projekte planen will, kann das völlig gefahrlos tun – der Linien-Scan und der Bus-Monitor arbeiten rein passiv und schreiben nichts.

---

### Was das Tool macht / Die wichtigsten Features:

- **Echte Native Desktop-App (Tauri v2):**  
  Läuft als schlanke Standalone-App auf **Linux (.AppImage, .deb), Windows (.exe Setup) und macOS (.dmg)**. Der Rust-Core läuft direkt im Hintergrund mit – braucht gerade mal ~35–45 MB RAM (kein ressourcenhungriger Electron- oder Node.js-Unterbau). Für Server- und Docker-Fans gibt es natürlich weiterhin Container und das Web-UI auf Port 8080.
- **Visuelle Blueprint-Canvas & Auto-GA:**  
  Geräte und Funktionsblöcke (Dimmer, Raffstores, Logikgatter, Szenenmischpult mit DPT 18.001, autonome NOAA-Astro-Sonnenschutzsteuerung ohne Cloud) frei platzieren. Einfach per Maus Leitungen zwischen Ein- und Ausgängen ziehen – die Gruppenadressen werden im Hintergrund vollautomatisch, kollisionsfrei und DPT-kompatibel geroutet. Signal-Portale verbinden Räume übersichtlich miteinander.
- **100% ETS 6.2 Schema-23 Interoperabilität:**  
  Voller, verlustfreier Roundtrip: Liest und exportiert native `.knxproj`-Archive nach offiziellem XML Schema 23 inklusive Directory-Manifest-Hashing und RSA-SHA1-Signierung (`P-XXXX.signature`). Data-Secure-Schlüssel (FDSK, ToolKeys) und Original-Herstellerkataloge bleiben beim Im- und Export vollständig erhalten.
- **Projekt-Diff & Selective Merge:**  
  Zwei Projektstände (oder euer aktives Projekt gegen ein beliebiges Backup) auf 4 Ebenen vergleichen: Topologie, Gruppenadressen, Parameter und KO-Verknüpfungen. Änderungen lassen sich per Checkbox selektiv oder komplett synchronisieren.
- **2D-CAD Hausplan (Grundriss):**  
  Interaktiver Grundriss-Editor mit 90°-Wandsnapping, DIN-Aufschlagstüren, Fenstern, automatischer Raumflächenberechnung (m² per Shoelace-Formel) und platzierbaren Live-KNX-Widgets mit direktem Bus-Feedback.
- **Hardware-Diagnose & Flashing-Assistent:**  
  16x16 Linien-Scan-Matrix (1.1.1 bis 1.1.255), Erkennung des Programmiermodus, optischer Locator (Programmier-LED blinken lassen), Programmierung über 6-Byte Seriennummer ohne Tastendruck sowie Sicherheitsverriegelung gegen versehentlich gedrückte Tasten an mehreren Geräten.
- **Bus-Monitor & TP-Buslast-Rekorder:**  
  50.000 Telegramme Ringspeicher, Wildcard-Filter (`1.1.*`, `4/0/*`), ETS XML- und CSV-Export und eine echte physikalische TP-Buslastberechnung (11 Bit/Byte + 50 Bit Inter-Frame-Pause bei 9600 Baud) mit Live-Tacho.
- **KNX IP Secure & Live-Sniffer:**  
  Direkte, verschlüsselte IP-Secure-Verbindung über TCP inklusive Keyring-Import (`.knxkeys`). Ein transparenter MitM-Sniffer liegt ebenfalls bei, falls man Gateways analysieren will.

---

### Das KoNfiX-Ökosystem: Website & KoNfiX-Catalog

Neben dem eigentlichen Programm gibt es jetzt zwei zentrale Web-Anlaufstellen:

1. **Die Projekt-Website:** [https://konfix.sduni.de](https://konfix.sduni.de)  
   Hier findet ihr eine Übersicht über das Projekt, die Dokumentation, Architekturdetails und alle Download-Möglichkeiten.
2. **Der KoNfiX-Catalog (Online-Gerätedatenbank):** [https://db.konfix.sduni.de](https://db.konfix.sduni.de)  
   Ein offener, cloud-fähiger REST-Katalog für KNX-Geräte (quasi ein freier "ETS Online-Katalog"):
   - Direkt in KoNfiX integriert: Geräte suchen und mit **1 Klick** als natives Gerät ins eigene Projekt importieren – inklusive aller Kommunikationsobjekte und Parameter.
   - Hersteller- & Community-Upload: Man kann rohe `.knxprod`-Dateien per Web-Upload oder REST-Schnittstelle hochladen. Das Backend entpackt die Archive automatisch, extrahiert Hersteller, Hardwaredaten und Applikationsprogramme und stellt sie bereit.
   - Nativer zweisprachiger Support (DE/EN) für Parameter und KO-Beschriftungen.

---

### Wie ihr gefahrlos testen könnt:
1. **Passiv mitlesen & planen:** Linien-Scan, Bus-Monitor und Projektplanung nutzen (rein lesend bzw. offline – schreibt nichts auf den Bus).
2. **OpenKNX / DIY-Module:** Ideal zum Testen der Flash-Engine – im Zweifelsfall flasht man einfach per USB neu.
3. **Testbrett / Reserve-Aktor:** Sollte ein Schreibvorgang mal abbrechen, lässt sich das Gerät jederzeit über die offizielle ETS mit "Vollständig programmieren" wieder in den Originalzustand versetzen (Geräte gehen nicht kaputt).

KoNfiX flasht durch die differentielle Übertragung (nur geänderte Speicherbereiche) übrigens ausgesprochen flott.

### Was ich von euch brauche / Feedback gesucht:
- Wie verhält sich der Linien-Scan und das Flashen bei euren Herstellern (MDT, Gira, Theben, ABB, Weinzierl, etc.)?
- Gibt es bei bestimmten Geräten Timeouts oder Sonderlocken beim System B Ladevorgang?
- Funktioniert KNX Data Secure auf TP bei euren Geräten reibungslos?
- Wie gefällt euch der 1-Klick-Import aus dem Online-Katalog?

### Downloads & Quellcode:
- **Website & Doku:** [https://konfix.sduni.de](https://konfix.sduni.de)
- **Online-Katalog:** [https://db.konfix.sduni.de](https://db.konfix.sduni.de)
- **GitHub Releases (Desktop-Apps, Installer, Docker):** [https://github.com/Sduniii/KoNfiX/releases](https://github.com/Sduniii/KoNfiX/releases)

*Einordnung zum Schluss:* Ich habe KoNfiX ursprünglich für mich selbst gebaut, weil ich eine unabhängige, flüssige KNX-Lösung unter Linux ohne Windows-VM und ohne Lizenzkosten für mein Haus haben wollte. Den Zwang, dass am Ende eine 100% perfekte ETS-Dokumentation für einen gewerblichen Elektriker rausfallen muss, habe ich privat schlicht nicht. Ich teile das Projekt jetzt einfach, weil ich den technischen Austausch auf Code-Ebene spannend finde – wer mag, kann gerne testen, Feedback dalassen oder auf GitHub mitbasteln.

Grüße
```
