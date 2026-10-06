// =========================================================================
// KNX Datapoint Types (DPT) Registry & Value Formatter
// Based on KNX Standard 03_07_02 Datapoint Types v02.02.01 & knx_master.xml
// =========================================================================

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DptMeta {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub unit: &'static str,
    pub format: &'static str,
    pub is_float: bool,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub step: Option<f64>,
    pub category: &'static str,
}

pub static STANDARD_DPTS: &[DptMeta] = &[
    // --- DPT 1: 1-Bit Boolean ---
    DptMeta {
        id: "1.001",
        name: "DPT_Switch",
        description: "Schalten (Aus / Ein)",
        unit: "",
        format: "1-Bit (0=Aus, 1=Ein)",
        is_float: false,
        min: Some(0.0),
        max: Some(1.0),
        step: Some(1.0),
        category: "Beleuchtung / Schalten",
    },
    DptMeta {
        id: "1.002",
        name: "DPT_Bool",
        description: "Boolesch (Falsch / Wahr)",
        unit: "",
        format: "1-Bit (0=Falsch, 1=Wahr)",
        is_float: false,
        min: Some(0.0),
        max: Some(1.0),
        step: Some(1.0),
        category: "Logik",
    },
    DptMeta {
        id: "1.003",
        name: "DPT_Enable",
        description: "Freigabe (Gesperrt / Freigegeben)",
        unit: "",
        format: "1-Bit (0=Sperren, 1=Freigeben)",
        is_float: false,
        min: Some(0.0),
        max: Some(1.0),
        step: Some(1.0),
        category: "Sicherheit / Sperre",
    },
    DptMeta {
        id: "1.005",
        name: "DPT_Alarm",
        description: "Alarm (Kein Alarm / Alarm)",
        unit: "",
        format: "1-Bit (0=Kein Alarm, 1=Alarm)",
        is_float: false,
        min: Some(0.0),
        max: Some(1.0),
        step: Some(1.0),
        category: "Sicherheit / Alarm",
    },
    DptMeta {
        id: "1.008",
        name: "DPT_UpDown",
        description: "Auf / Ab (Fahrbefehl)",
        unit: "",
        format: "1-Bit (0=Auf, 1=Ab)",
        is_float: false,
        min: Some(0.0),
        max: Some(1.0),
        step: Some(1.0),
        category: "Sonnenschutz / Jalousie",
    },
    DptMeta {
        id: "1.009",
        name: "DPT_OpenClose",
        description: "Öffnen / Schließen",
        unit: "",
        format: "1-Bit (0=Öffnen, 1=Schließen)",
        is_float: false,
        min: Some(0.0),
        max: Some(1.0),
        step: Some(1.0),
        category: "Sonnenschutz / Fenster",
    },
    DptMeta {
        id: "1.010",
        name: "DPT_Start",
        description: "Start / Stop",
        unit: "",
        format: "1-Bit (0=Stop, 1=Start)",
        is_float: false,
        min: Some(0.0),
        max: Some(1.0),
        step: Some(1.0),
        category: "Sonnenschutz / Jalousie",
    },
    DptMeta {
        id: "1.018",
        name: "DPT_Occupancy",
        description: "Präsenz (Nicht belegt / Belegt)",
        unit: "",
        format: "1-Bit (0=Abwesend, 1=Anwesend)",
        is_float: false,
        min: Some(0.0),
        max: Some(1.0),
        step: Some(1.0),
        category: "Sensorik / Präsenz",
    },
    DptMeta {
        id: "1.019",
        name: "DPT_Window_Door",
        description: "Fenster / Türkontakt",
        unit: "",
        format: "1-Bit (0=Geschlossen, 1=Offen)",
        is_float: false,
        min: Some(0.0),
        max: Some(1.0),
        step: Some(1.0),
        category: "Sicherheit / Fenster",
    },

    // --- DPT 3: 4-Bit Controlled Step ---
    DptMeta {
        id: "3.007",
        name: "DPT_Control_Dimming",
        description: "Dimmen relativ (Schrittsteuerung)",
        unit: "",
        format: "4-Bit (Richtung + 3-Bit Schrittcode)",
        is_float: false,
        min: Some(0.0),
        max: Some(15.0),
        step: Some(1.0),
        category: "Beleuchtung / Dimmen",
    },
    DptMeta {
        id: "3.008",
        name: "DPT_Control_Blinds",
        description: "Lamellenverstellung relativ",
        unit: "",
        format: "4-Bit (Richtung + 3-Bit Schrittcode)",
        is_float: false,
        min: Some(0.0),
        max: Some(15.0),
        step: Some(1.0),
        category: "Sonnenschutz / Jalousie",
    },

    // --- DPT 5: 8-Bit Unsigned Integer ---
    DptMeta {
        id: "5.001",
        name: "DPT_Scaling",
        description: "Prozentwert (Helligkeit, Position)",
        unit: "%",
        format: "8-Bit vorzeichenlos (0..100 %, Schritt 1 %)",
        is_float: false,
        min: Some(0.0),
        max: Some(100.0),
        step: Some(1.0),
        category: "Beleuchtung / Dimmwert",
    },
    DptMeta {
        id: "5.003",
        name: "DPT_Angle",
        description: "Winkelgrad (Lamellenwinkel)",
        unit: "°",
        format: "8-Bit vorzeichenlos (0..360°)",
        is_float: false,
        min: Some(0.0),
        max: Some(360.0),
        step: Some(1.0),
        category: "Sonnenschutz / Jalousie",
    },
    DptMeta {
        id: "5.004",
        name: "DPT_Percent_U8",
        description: "Prozentwert (0..255 %)",
        unit: "%",
        format: "8-Bit vorzeichenlos (0..255 %)",
        is_float: false,
        min: Some(0.0),
        max: Some(255.0),
        step: Some(1.0),
        category: "Allgemein",
    },
    DptMeta {
        id: "5.010",
        name: "DPT_Value_1_Ucount",
        description: "Zählimpulse (8-Bit)",
        unit: "Impulse",
        format: "8-Bit vorzeichenlos (0..255)",
        is_float: false,
        min: Some(0.0),
        max: Some(255.0),
        step: Some(1.0),
        category: "Zähler",
    },

    // --- DPT 6: 8-Bit Signed Integer ---
    DptMeta {
        id: "6.001",
        name: "DPT_Percent_V8",
        description: "Prozentdifferenz (-128..127 %)",
        unit: "%",
        format: "8-Bit vorzeichenbehaftet (-128..127 %)",
        is_float: false,
        min: Some(-128.0),
        max: Some(127.0),
        step: Some(1.0),
        category: "Klima",
    },

    // --- DPT 7: 16-Bit Unsigned Integer (STRIKT GANZZAHLIG!) ---
    DptMeta {
        id: "7.001",
        name: "DPT_Value_2_Ucount",
        description: "Zählimpulse (16-Bit)",
        unit: "Impulse",
        format: "16-Bit vorzeichenlos (0..65535, Ganzzahl)",
        is_float: false,
        min: Some(0.0),
        max: Some(65535.0),
        step: Some(1.0),
        category: "Zähler",
    },
    DptMeta {
        id: "7.002",
        name: "DPT_TimePeriodMsec",
        description: "Zeitspanne in Millisekunden",
        unit: "ms",
        format: "16-Bit vorzeichenlos (0..65535 ms, Ganzzahl)",
        is_float: false,
        min: Some(0.0),
        max: Some(65535.0),
        step: Some(1.0),
        category: "Zeitsteuerung",
    },
    DptMeta {
        id: "7.003",
        name: "DPT_TimePeriod10MSec",
        description: "Zeitspanne in 10-Millisekunden-Schritten",
        unit: "cs",
        format: "16-Bit vorzeichenlos (0..655350 ms, Schritt 10 ms)",
        is_float: false,
        min: Some(0.0),
        max: Some(65535.0),
        step: Some(1.0),
        category: "Zeitsteuerung",
    },
    DptMeta {
        id: "7.004",
        name: "DPT_TimePeriod100MSec",
        description: "Zeitspanne in 100-Millisekunden-Schritten",
        unit: "ds",
        format: "16-Bit vorzeichenlos (0..6553500 ms, Schritt 100 ms)",
        is_float: false,
        min: Some(0.0),
        max: Some(65535.0),
        step: Some(1.0),
        category: "Zeitsteuerung",
    },
    DptMeta {
        id: "7.005",
        name: "DPT_TimePeriodSec",
        description: "Zeitspanne in Sekunden (Verfahrzeit / Laufzeit)",
        unit: "s",
        format: "16-Bit vorzeichenlos (0..65535 s, Ganzzahl, Auflösung 1 s)",
        is_float: false,
        min: Some(0.0),
        max: Some(65535.0),
        step: Some(1.0),
        category: "Zeitsteuerung / Fahrzeiten",
    },
    DptMeta {
        id: "7.006",
        name: "DPT_TimePeriodMin",
        description: "Zeitspanne in Minuten",
        unit: "min",
        format: "16-Bit vorzeichenlos (0..65535 min, Ganzzahl)",
        is_float: false,
        min: Some(0.0),
        max: Some(65535.0),
        step: Some(1.0),
        category: "Zeitsteuerung",
    },
    DptMeta {
        id: "7.007",
        name: "DPT_TimePeriodHrs",
        description: "Zeitspanne in Stunden",
        unit: "h",
        format: "16-Bit vorzeichenlos (0..65535 h, Ganzzahl)",
        is_float: false,
        min: Some(0.0),
        max: Some(65535.0),
        step: Some(1.0),
        category: "Zeitsteuerung",
    },
    DptMeta {
        id: "7.012",
        name: "DPT_UElCurrentmA",
        description: "Elektrischer Strom in Milliampere",
        unit: "mA",
        format: "16-Bit vorzeichenlos (0..65535 mA, Ganzzahl)",
        is_float: false,
        min: Some(0.0),
        max: Some(65535.0),
        step: Some(1.0),
        category: "Energie / Messung",
    },
    DptMeta {
        id: "7.013",
        name: "DPT_Brightness",
        description: "Helligkeit (16-Bit Lux)",
        unit: "Lux",
        format: "16-Bit vorzeichenlos (0..65535 Lux, Ganzzahl)",
        is_float: false,
        min: Some(0.0),
        max: Some(65535.0),
        step: Some(1.0),
        category: "Sensorik / Helligkeit",
    },
    DptMeta {
        id: "7.600",
        name: "DPT_Absolute_Colour_Temperature",
        description: "Farbtemperatur (Kelvin)",
        unit: "K",
        format: "16-Bit vorzeichenlos (Kelvin, z.B. 2700..6500 K)",
        is_float: false,
        min: Some(0.0),
        max: Some(65535.0),
        step: Some(1.0),
        category: "Beleuchtung / Tunable White",
    },

    // --- DPT 8: 16-Bit Signed Integer ---
    DptMeta {
        id: "8.001",
        name: "DPT_Value_2_Count",
        description: "Zählwert mit Vorzeichen (16-Bit)",
        unit: "Zähler",
        format: "16-Bit vorzeichenbehaftet (-32768..32767)",
        is_float: false,
        min: Some(-32768.0),
        max: Some(32767.0),
        step: Some(1.0),
        category: "Zähler",
    },
    DptMeta {
        id: "8.005",
        name: "DPT_DeltaTimeSec",
        description: "Zeitdifferenz in Sekunden",
        unit: "s",
        format: "16-Bit vorzeichenbehaftet (-32768..32767 s, Ganzzahl)",
        is_float: false,
        min: Some(-32768.0),
        max: Some(32767.0),
        step: Some(1.0),
        category: "Zeitsteuerung",
    },

    // --- DPT 9: 16-Bit KNX 2-Byte Float (GLEITKOMMAZAHLEN!) ---
    DptMeta {
        id: "9.001",
        name: "DPT_Value_Temp",
        description: "Temperatur (°C)",
        unit: "°C",
        format: "2-Byte KNX Gleitkomma (-273..+670760 °C, Auflösung 0.01 °C)",
        is_float: true,
        min: Some(-273.0),
        max: Some(670760.0),
        step: Some(0.1),
        category: "Klima / Heizung",
    },
    DptMeta {
        id: "9.002",
        name: "DPT_Value_Tempd",
        description: "Temperaturdifferenz (Kelvin)",
        unit: "K",
        format: "2-Byte KNX Gleitkomma (-670760..+670760 K)",
        is_float: true,
        min: Some(-670760.0),
        max: Some(670760.0),
        step: Some(0.1),
        category: "Klima / Heizung",
    },
    DptMeta {
        id: "9.004",
        name: "DPT_Value_Lux",
        description: "Beleuchtungsstärke (Lux)",
        unit: "Lux",
        format: "2-Byte KNX Gleitkomma (0..670760 Lux)",
        is_float: true,
        min: Some(0.0),
        max: Some(670760.0),
        step: Some(1.0),
        category: "Sensorik / Helligkeit",
    },
    DptMeta {
        id: "9.005",
        name: "DPT_Value_Wsp",
        description: "Windgeschwindigkeit (m/s)",
        unit: "m/s",
        format: "2-Byte KNX Gleitkomma (0..670760 m/s)",
        is_float: true,
        min: Some(0.0),
        max: Some(670760.0),
        step: Some(0.1),
        category: "Wetter / Wind",
    },
    DptMeta {
        id: "9.006",
        name: "DPT_Value_Pres",
        description: "Luftdruck (Pa)",
        unit: "Pa",
        format: "2-Byte KNX Gleitkomma (0..670760 Pa)",
        is_float: true,
        min: Some(0.0),
        max: Some(670760.0),
        step: Some(1.0),
        category: "Wetter / Luftdruck",
    },
    DptMeta {
        id: "9.007",
        name: "DPT_Value_Humidity",
        description: "Relative Luftfeuchte (%)",
        unit: "%",
        format: "2-Byte KNX Gleitkomma (0..100 %)",
        is_float: true,
        min: Some(0.0),
        max: Some(100.0),
        step: Some(0.5),
        category: "Klima / Feuchte",
    },
    DptMeta {
        id: "9.008",
        name: "DPT_Value_AirQuality",
        description: "Luftgüte / CO2 (ppm)",
        unit: "ppm",
        format: "2-Byte KNX Gleitkomma (0..670760 ppm)",
        is_float: true,
        min: Some(0.0),
        max: Some(670760.0),
        step: Some(1.0),
        category: "Klima / Luftgüte",
    },

    // --- DPT 12: 32-Bit Unsigned Integer ---
    DptMeta {
        id: "12.001",
        name: "DPT_Value_4_Ucount",
        description: "Zählimpulse (32-Bit)",
        unit: "Impulse",
        format: "32-Bit vorzeichenlos (0..4294967295)",
        is_float: false,
        min: Some(0.0),
        max: Some(4294967295.0),
        step: Some(1.0),
        category: "Zähler",
    },

    // --- DPT 13: 32-Bit Signed Integer ---
    DptMeta {
        id: "13.010",
        name: "DPT_ActiveEnergy",
        description: "Wirkenergie (Wh)",
        unit: "Wh",
        format: "32-Bit vorzeichenbehaftet (-2.1 Mrd .. +2.1 Mrd Wh)",
        is_float: false,
        min: None,
        max: None,
        step: Some(1.0),
        category: "Energie / Zähler",
    },
    DptMeta {
        id: "13.013",
        name: "DPT_ActiveEnergy_kWh",
        description: "Wirkenergie (kWh)",
        unit: "kWh",
        format: "32-Bit vorzeichenbehaftet (kWh)",
        is_float: false,
        min: None,
        max: None,
        step: Some(1.0),
        category: "Energie / Zähler",
    },

    // --- DPT 14: 32-Bit IEEE 754 Float ---
    DptMeta {
        id: "14.056",
        name: "DPT_Value_Power",
        description: "Elektrische Leistung (W)",
        unit: "W",
        format: "4-Byte IEEE Gleitkomma (W)",
        is_float: true,
        min: None,
        max: None,
        step: Some(0.1),
        category: "Energie / Leistung",
    },

    // --- DPT 17 / 18: Szenen ---
    DptMeta {
        id: "17.001",
        name: "DPT_SceneNumber",
        description: "Szenennummer (0..63)",
        unit: "",
        format: "8-Bit vorzeichenlos (0..63)",
        is_float: false,
        min: Some(0.0),
        max: Some(63.0),
        step: Some(1.0),
        category: "Szenen",
    },
    DptMeta {
        id: "18.001",
        name: "DPT_SceneControl",
        description: "Szenensteuerung (Abrufen / Lernen)",
        unit: "",
        format: "8-Bit (Bit 7: 0=Abrufen/1=Lernen, Bits 0..5: Szene 1..64)",
        is_float: false,
        min: Some(1.0),
        max: Some(64.0),
        step: Some(1.0),
        category: "Szenen",
    },

    // --- DPT 20: 8-Bit Enumeration ---
    DptMeta {
        id: "20.102",
        name: "DPT_HVACMode",
        description: "HVAC Betriebsmodus (0=Auto, 1=Komfort, 2=Standby, 3=Economy, 4=Schutz)",
        unit: "",
        format: "8-Bit Aufzählung (0..4)",
        is_float: false,
        min: Some(0.0),
        max: Some(4.0),
        step: Some(1.0),
        category: "Klima / Betriebsmodus",
    },

    // --- DPT 232: 3-Byte Colour RGB ---
    DptMeta {
        id: "232.600",
        name: "DPT_Colour_RGB",
        description: "RGB Farbwert (Rot, Grün, Blau)",
        unit: "RGB",
        format: "3-Byte (R 0..255, G 0..255, B 0..255)",
        is_float: false,
        min: Some(0.0),
        max: Some(16777215.0),
        step: Some(1.0),
        category: "Beleuchtung / Farbe",
    },
];

/// Normalizes any input DPT string (e.g. "DPST-7-5", "DPT-7", "7.005", "7") to standard format "7.005"
pub fn normalize_dpt(raw: &str) -> String {
    let clean = raw.trim();
    if clean.is_empty() {
        return "1.001".to_string();
    }
    if let Some(rest) = clean.strip_prefix("DPST-") {
        let parts: Vec<&str> = rest.split('-').collect();
        if parts.len() >= 2 {
            let main = parts[0].parse::<u32>().unwrap_or(1);
            let sub = parts[1].parse::<u32>().unwrap_or(1);
            return format!("{}.{:03}", main, sub);
        }
    } else if let Some(rest) = clean.strip_prefix("DPT-") {
        let main = rest.parse::<u32>().unwrap_or(1);
        return format!("{}.001", main);
    }

    if clean.contains('.') {
        clean.to_string()
    } else if let Ok(num) = clean.parse::<u32>() {
        format!("{}.001", num)
    } else {
        clean.to_string()
    }
}

/// Finds metadata for a given DPT string
pub fn lookup_dpt(dpt: &str) -> Option<&'static DptMeta> {
    let normalized = normalize_dpt(dpt);
    if let Some(meta) = STANDARD_DPTS.iter().find(|d| d.id == normalized) {
        return Some(meta);
    }

    // Fallback: match by main DPT prefix (e.g. "7." -> first DPT 7 meta)
    let main_prefix = normalized.split('.').next().unwrap_or("");
    STANDARD_DPTS.iter().find(|d| d.id.starts_with(&format!("{}.", main_prefix)))
}

/// Formats a raw KNX cEMI byte payload according to its DPT
pub fn format_dpt_value(dpt: &str, payload: &[u8]) -> (String, String) {
    let norm = normalize_dpt(dpt);

    if norm.starts_with("1.") {
        let val = payload.first().copied().unwrap_or(0) & 0x01;
        let text = if norm == "1.008" {
            if val == 0 { "Auf (0)".to_string() } else { "Ab (1)".to_string() }
        } else if norm == "1.010" {
            if val == 0 { "Stop (0)".to_string() } else { "Start (1)".to_string() }
        } else if norm == "1.009" {
            if val == 0 { "Öffnen (0)".to_string() } else { "Schließen (1)".to_string() }
        } else {
            if val == 1 { "EIN (1)".to_string() } else { "AUS (0)".to_string() }
        };
        return (norm, text);
    }

    if norm.starts_with("5.") && !payload.is_empty() {
        let raw = payload[0];
        if norm == "5.001" {
            let pct = (raw as f64 * 100.0 / 255.0).round() as u8;
            return (norm, format!("{} %", pct));
        } else if norm == "5.003" {
            let angle = (raw as f64 * 360.0 / 255.0).round() as u16;
            return (norm, format!("{} °", angle));
        } else {
            return (norm, format!("{}", raw));
        }
    }

    if norm.starts_with("7.") && payload.len() >= 2 {
        let val = u16::from_be_bytes([payload[0], payload[1]]);
        let unit = lookup_dpt(&norm).map(|m| m.unit).unwrap_or("");
        if unit.is_empty() {
            return (norm, format!("{}", val));
        } else {
            return (norm, format!("{} {}", val, unit));
        }
    }

    if norm.starts_with("8.") && payload.len() >= 2 {
        let val = i16::from_be_bytes([payload[0], payload[1]]);
        let unit = lookup_dpt(&norm).map(|m| m.unit).unwrap_or("");
        if unit.is_empty() {
            return (norm, format!("{}", val));
        } else {
            return (norm, format!("{} {}", val, unit));
        }
    }

    if norm.starts_with("9.") && payload.len() >= 2 {
        let temp = crate::knxnet_ip::decode_knx_float2([payload[0], payload[1]]);
        let unit = lookup_dpt(&norm).map(|m| m.unit).unwrap_or("°C");
        return (norm, format!("{:.1} {}", temp, unit));
    }

    if norm.starts_with("14.") && payload.len() >= 4 {
        let val = f32::from_be_bytes([payload[0], payload[1], payload[2], payload[3]]);
        let unit = lookup_dpt(&norm).map(|m| m.unit).unwrap_or("");
        return (norm, format!("{:.2} {}", val, unit));
    }

    if norm.starts_with("18.") && !payload.is_empty() {
        let byte = payload[0];
        let learn = (byte & 0x80) != 0;
        let scn = (byte & 0x3F) + 1;
        return (norm, format!("Szene {} ({})", scn, if learn { "Lernen" } else { "Abrufen" }));
    }

    if norm.starts_with("20.102") && !payload.is_empty() {
        let text = match payload[0] {
            0 => "Auto",
            1 => "Komfort",
            2 => "Standby",
            3 => "Economy",
            4 => "Gebäudeschutz",
            _ => "Unbekannt",
        };
        return (norm, text.to_string());
    }

    // Default hex representation
    let hex = payload.iter().map(|b| format!("{:02X}", b)).collect::<Vec<_>>().join(" ");
    (norm, hex)
}

/// Formats a JSON value (bool, number, string) according to its DPT for telegrams/logs
pub fn format_dpt_json_value(dpt: &str, value: &serde_json::Value) -> String {
    let norm = normalize_dpt(dpt);
    if norm.starts_with("1.") {
        let is_on = match value {
            serde_json::Value::Bool(b) => *b,
            serde_json::Value::Number(n) => n.as_i64().unwrap_or(0) != 0,
            _ => false,
        };
        if norm == "1.008" {
            if is_on { "Ab (1)".to_string() } else { "Auf (0)".to_string() }
        } else if norm == "1.010" {
            if is_on { "Start (1)".to_string() } else { "Stop (0)".to_string() }
        } else if norm == "1.009" {
            if is_on { "Schließen (1)".to_string() } else { "Öffnen (0)".to_string() }
        } else {
            if is_on { "EIN (1)".to_string() } else { "AUS (0)".to_string() }
        }
    } else if norm.starts_with("5.") {
        let n = value.as_f64().unwrap_or(0.0);
        if norm == "5.001" {
            format!("{} %", n.round() as i64)
        } else if norm == "5.003" {
            format!("{} °", n.round() as i64)
        } else {
            format!("{}", n.round() as i64)
        }
    } else if norm.starts_with("7.") || norm.starts_with("8.") {
        let n = value.as_f64().unwrap_or(0.0);
        let unit = lookup_dpt(&norm).map(|m| m.unit).unwrap_or("");
        if unit.is_empty() {
            format!("{}", n.round() as i64)
        } else {
            format!("{} {}", n.round() as i64, unit)
        }
    } else if norm.starts_with("9.") || norm.starts_with("14.") {
        let n = value.as_f64().unwrap_or(0.0);
        let unit = lookup_dpt(&norm).map(|m| m.unit).unwrap_or("");
        if unit.is_empty() {
            format!("{:.1}", n)
        } else {
            format!("{:.1} {}", n, unit)
        }
    } else if norm.starts_with("18.") {
        let n = value.as_u64().unwrap_or(1);
        format!("Szene {} (DPT 18.001)", n)
    } else {
        match value {
            serde_json::Value::String(s) => s.clone(),
            _ => value.to_string(),
        }
    }
}

/// Checks if two DPT strings are compatible (e.g. "1.001" and "1.002", or "5.001" and "5.004", or either is empty/generic)
/// Modeled after ETS LinkGroupAddressDatapointQuestion & MismatchingObjectSize
pub fn are_dpts_compatible(dpt_a: &str, dpt_b: &str) -> bool {
    let clean_a = dpt_a.trim()
        .trim_start_matches("DPST-")
        .trim_start_matches("DPST_")
        .trim_start_matches("DPST")
        .trim_start_matches("DPT-")
        .trim_start_matches("DPT_")
        .trim_start_matches("DPT");
    let clean_b = dpt_b.trim()
        .trim_start_matches("DPST-")
        .trim_start_matches("DPST_")
        .trim_start_matches("DPST")
        .trim_start_matches("DPT-")
        .trim_start_matches("DPT_")
        .trim_start_matches("DPT");

    if clean_a.is_empty() || clean_b.is_empty() || clean_a == "var" || clean_b == "var" {
        return true;
    }

    let main_a = clean_a.split(|c| c == '.' || c == '-').next().unwrap_or(clean_a);
    let main_b = clean_b.split(|c| c == '.' || c == '-').next().unwrap_or(clean_b);

    main_a == main_b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dpt_lookup_seconds() {
        let meta = lookup_dpt("7.005").expect("Must find 7.005");
        assert_eq!(meta.name, "DPT_TimePeriodSec");
        assert_eq!(meta.unit, "s");
        assert_eq!(meta.is_float, false);
        assert_eq!(meta.step, Some(1.0));
        assert_eq!(meta.min, Some(0.0));
        assert_eq!(meta.max, Some(65535.0));
    }

    #[test]
    fn test_dpt_lookup_temperature() {
        let meta = lookup_dpt("9.001").expect("Must find 9.001");
        assert_eq!(meta.name, "DPT_Value_Temp");
        assert_eq!(meta.unit, "°C");
        assert_eq!(meta.is_float, true);
    }

    #[test]
    fn test_format_dpt_value_seconds() {
        // 28 seconds (0x001C)
        let (dpt, formatted) = format_dpt_value("7.005", &[0x00, 0x1C]);
        assert_eq!(dpt, "7.005");
        assert_eq!(formatted, "28 s");
    }

    #[test]
    fn test_format_dpt_value_temperature() {
        let raw = crate::knxnet_ip::encode_knx_float2(21.5);
        let (dpt, formatted) = format_dpt_value("9.001", &raw);
        assert_eq!(dpt, "9.001");
        assert_eq!(formatted, "21.5 °C");
    }

    #[test]
    fn test_are_dpts_compatible() {
        assert!(are_dpts_compatible("1.001", "1.002"));
        assert!(are_dpts_compatible("DPST-1-1", "1.001"));
        assert!(are_dpts_compatible("5.001", "5.004"));
        assert!(are_dpts_compatible("", "1.001"));
        assert!(!are_dpts_compatible("1.001", "9.001"));
        assert!(!are_dpts_compatible("1.001", "5.001"));
    }
}
