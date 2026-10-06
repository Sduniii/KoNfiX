use std::collections::{HashMap, VecDeque};
use std::time::Instant;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use crate::model::KnxTelegram;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RecorderState {
    Idle,
    Recording,
    Paused,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BusStatistics {
    pub total_telegrams: usize,
    pub telegrams_per_sec: f32,
    pub bus_load_percent: f32,
    pub write_count: usize,
    pub read_count: usize,
    pub response_count: usize,
    pub priority_system: usize,
    pub priority_alarm: usize,
    pub priority_normal: usize,
    pub priority_low: usize,
    pub top_senders: Vec<(String, usize)>,
    pub top_destinations: Vec<(String, usize)>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TelegramFilter {
    pub source: Option<String>,
    pub destination: Option<String>,
    pub telegram_type: Option<String>,
    pub dpt: Option<String>,
    pub search_text: Option<String>,
}

impl TelegramFilter {
    pub fn matches(&self, tlg: &KnxTelegram) -> bool {
        if let Some(ref s) = self.source {
            let s_lower = s.to_lowercase();
            if s_lower.ends_with('*') {
                let prefix = &s_lower[..s_lower.len() - 1];
                if !tlg.source.to_lowercase().starts_with(prefix) {
                    return false;
                }
            } else if !tlg.source.eq_ignore_ascii_case(s) {
                return false;
            }
        }

        if let Some(ref d) = self.destination {
            let d_lower = d.to_lowercase();
            if d_lower.ends_with('*') {
                let prefix = &d_lower[..d_lower.len() - 1];
                if !tlg.destination.to_lowercase().starts_with(prefix) {
                    return false;
                }
            } else if !tlg.destination.eq_ignore_ascii_case(d) {
                return false;
            }
        }

        if let Some(ref tt) = self.telegram_type {
            if !tlg.telegram_type.eq_ignore_ascii_case(tt) {
                return false;
            }
        }

        if let Some(ref dpt) = self.dpt {
            if !tlg.dpt.to_lowercase().contains(&dpt.to_lowercase()) {
                return false;
            }
        }

        if let Some(ref st) = self.search_text {
            let st_lower = st.to_lowercase();
            let matches_any = tlg.source.to_lowercase().contains(&st_lower)
                || tlg.destination.to_lowercase().contains(&st_lower)
                || tlg.value_formatted.to_lowercase().contains(&st_lower)
                || tlg.telegram_type.to_lowercase().contains(&st_lower);
            if !matches_any {
                return false;
            }
        }

        true
    }
}

/// TpFrameLoadCalculator
/// Reference: KNX System Specification Volume 3/2/1.
/// Standard KNX TP1 frame:
/// - Control field (1 octet)
/// - Source address (2 octets)
/// - Destination address (2 octets)
/// - Address type / Routing / Length (1 octet)
/// - TPCI / APCI / Data (N octets, min 2)
/// - Checksum (1 octet)
/// Minimum frame length: ~9 octets.
/// TP transmission: 1 start bit, 8 data bits, 1 even parity, 1 stop bit = 11 bits/octet.
/// Minimum sync pause between frames: 50 bit times.
/// Baud rate: 9600 bps.
pub struct TpFrameLoadCalculator {
    recent_frame_bits: VecDeque<(Instant, u32)>,
    window_duration_secs: f32,
}

impl TpFrameLoadCalculator {
    pub fn new(window_duration_secs: f32) -> Self {
        Self {
            recent_frame_bits: VecDeque::new(),
            window_duration_secs: window_duration_secs.max(1.0),
        }
    }

    pub fn record_frame(&mut self, payload_len: usize) {
        let total_octets = (7 + payload_len.max(2) + 1) as u32; // Header + Payload + FCS
        let bits = total_octets * 11 + 50; // TP framing + sync pause
        let now = Instant::now();
        self.recent_frame_bits.push_back((now, bits));
        self.prune(now);
    }

    fn prune(&mut self, now: Instant) {
        let cutoff = now - std::time::Duration::from_secs_f32(self.window_duration_secs);
        while let Some(&(time, _)) = self.recent_frame_bits.front() {
            if time < cutoff {
                self.recent_frame_bits.pop_front();
            } else {
                break;
            }
        }
    }

    pub fn calculate_load_percent(&mut self) -> f32 {
        let now = Instant::now();
        self.prune(now);
        let sum_bits: u32 = self.recent_frame_bits.iter().map(|(_, b)| *b).sum();
        let max_capacity_bits = 9600.0 * self.window_duration_secs;
        ((sum_bits as f32) / max_capacity_bits * 100.0).clamp(0.0, 100.0)
    }

    pub fn telegrams_per_sec(&mut self) -> f32 {
        let now = Instant::now();
        self.prune(now);
        (self.recent_frame_bits.len() as f32) / self.window_duration_secs
    }
}

pub struct TelegramRecorder {
    state: RecorderState,
    max_capacity: usize,
    buffer: VecDeque<KnxTelegram>,
    load_calculator: TpFrameLoadCalculator,
    start_time: Option<Instant>,
    // Statistics accumulators
    total_recorded: usize,
    write_count: usize,
    read_count: usize,
    response_count: usize,
    priority_system: usize,
    priority_alarm: usize,
    priority_normal: usize,
    priority_low: usize,
    sender_counts: HashMap<String, usize>,
    dest_counts: HashMap<String, usize>,
}

impl TelegramRecorder {
    pub fn new(max_capacity: usize) -> Self {
        Self {
            state: RecorderState::Recording,
            max_capacity: max_capacity.clamp(100, 100_000),
            buffer: VecDeque::with_capacity(1000),
            load_calculator: TpFrameLoadCalculator::new(2.0),
            start_time: Some(Instant::now()),
            total_recorded: 0,
            write_count: 0,
            read_count: 0,
            response_count: 0,
            priority_system: 0,
            priority_alarm: 0,
            priority_normal: 0,
            priority_low: 0,
            sender_counts: HashMap::new(),
            dest_counts: HashMap::new(),
        }
    }

    pub fn state(&self) -> RecorderState {
        self.state
    }

    pub fn start(&mut self) {
        self.state = RecorderState::Recording;
        if self.start_time.is_none() {
            self.start_time = Some(Instant::now());
        }
    }

    pub fn pause(&mut self) {
        if self.state == RecorderState::Recording {
            self.state = RecorderState::Paused;
        }
    }

    pub fn resume(&mut self) {
        if self.state == RecorderState::Paused {
            self.state = RecorderState::Recording;
        }
    }

    pub fn stop(&mut self) {
        self.state = RecorderState::Idle;
    }

    pub fn clear(&mut self) {
        self.buffer.clear();
        self.total_recorded = 0;
        self.write_count = 0;
        self.read_count = 0;
        self.response_count = 0;
        self.priority_system = 0;
        self.priority_alarm = 0;
        self.priority_normal = 0;
        self.priority_low = 0;
        self.sender_counts.clear();
        self.dest_counts.clear();
    }

    pub fn record(&mut self, telegram: KnxTelegram) {
        // Track load even when paused to reflect live TP physical bus
        self.load_calculator.record_frame(telegram.value_raw.len());

        if self.state != RecorderState::Recording {
            return;
        }

        self.total_recorded += 1;
        match telegram.telegram_type.as_str() {
            "Write" => self.write_count += 1,
            "Read" => self.read_count += 1,
            "Response" => self.response_count += 1,
            _ => self.write_count += 1,
        }

        if let Some(ref prio) = telegram.priority {
            match prio.to_lowercase().as_str() {
                "system" => self.priority_system += 1,
                "alarm" | "urgent" => self.priority_alarm += 1,
                "normal" => self.priority_normal += 1,
                "low" => self.priority_low += 1,
                _ => self.priority_normal += 1,
            }
        } else {
            self.priority_normal += 1;
        }

        *self.sender_counts.entry(telegram.source.clone()).or_insert(0) += 1;
        *self.dest_counts.entry(telegram.destination.clone()).or_insert(0) += 1;

        if self.buffer.len() >= self.max_capacity {
            self.buffer.pop_front();
        }
        self.buffer.push_back(telegram);
    }

    pub fn get_telegrams(&self, filter: Option<&TelegramFilter>, limit: usize) -> Vec<KnxTelegram> {
        let max_items = if limit == 0 { 500 } else { limit.min(10_000) };
        if let Some(f) = filter {
            self.buffer
                .iter()
                .rev()
                .filter(|t| f.matches(t))
                .take(max_items)
                .cloned()
                .collect()
        } else {
            self.buffer
                .iter()
                .rev()
                .take(max_items)
                .cloned()
                .collect()
        }
    }

    pub fn get_statistics(&mut self) -> BusStatistics {
        let bus_load = self.load_calculator.calculate_load_percent();
        let tlg_sec = self.load_calculator.telegrams_per_sec();

        // Top 5 senders
        let mut senders: Vec<(String, usize)> = self.sender_counts.clone().into_iter().collect();
        senders.sort_by(|a, b| b.1.cmp(&a.1));
        senders.truncate(5);

        // Top 5 destinations
        let mut dests: Vec<(String, usize)> = self.dest_counts.clone().into_iter().collect();
        dests.sort_by(|a, b| b.1.cmp(&a.1));
        dests.truncate(5);

        BusStatistics {
            total_telegrams: self.total_recorded,
            telegrams_per_sec: (tlg_sec * 10.0).round() / 10.0,
            bus_load_percent: (bus_load * 10.0).round() / 10.0,
            write_count: self.write_count,
            read_count: self.read_count,
            response_count: self.response_count,
            priority_system: self.priority_system,
            priority_alarm: self.priority_alarm,
            priority_normal: self.priority_normal,
            priority_low: self.priority_low,
            top_senders: senders,
            top_destinations: dests,
        }
    }

    /// Export recording in ETS Group Monitor CSV format
    pub fn export_csv(&self) -> String {
        let mut out = String::new();
        out.push_str("#;Zeit;Dienst;Flags;Prio;Quelladresse;Quellname;Zieladresse;Zielname;Rout;Typ;DPT;Nutzdaten\n");

        for (idx, tlg) in self.buffer.iter().enumerate() {
            let prio = tlg.priority.clone().unwrap_or_else(|| "Niedrig".to_string());
            let raw_hex = tlg.value_raw.iter().map(|b| format!("{:02X}", b)).collect::<Vec<_>>().join(" ");
            let line = format!(
                "{};{};{};{};{};{};{};{};{};{};{};{};{}\n",
                idx + 1,
                tlg.timestamp,
                match tlg.telegram_type.as_str() {
                    "Write" => "GroupValue_Write",
                    "Read" => "GroupValue_Read",
                    "Response" => "GroupValue_Response",
                    other => other,
                },
                "", // Flags
                prio,
                tlg.source,
                "", // Quellname
                tlg.destination,
                "", // Zielname
                "6", // Routing counter default
                "L_Data.ind",
                tlg.dpt,
                if tlg.value_formatted.is_empty() { raw_hex } else { format!("{} (${})", tlg.value_formatted, raw_hex) }
            );
            out.push_str(&line);
        }

        out
    }

    /// Export recording in standard ETS XML format (`<KNXMonitor>`)
    pub fn export_xml(&self) -> String {
        let mut out = String::new();
        out.push_str("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n");
        out.push_str("<KNXMonitor xmlns=\"http://knx.org/xml/telegrams/01\" Timestamp=\"");
        out.push_str(&Utc::now().to_rfc3339());
        out.push_str("\">\n");

        for (idx, tlg) in self.buffer.iter().enumerate() {
            let raw_hex = tlg.value_raw.iter().map(|b| format!("{:02X}", b)).collect::<Vec<_>>().join("");
            out.push_str(&format!(
                "  <Telegram SequenceNumber=\"{}\" Timestamp=\"{}\" Service=\"{}\" SourceAddress=\"{}\" DestinationAddress=\"{}\" DPT=\"{}\" RawData=\"{}\">\n    <Value>{}</Value>\n  </Telegram>\n",
                idx + 1,
                tlg.timestamp,
                tlg.telegram_type,
                tlg.source,
                tlg.destination,
                tlg.dpt,
                raw_hex,
                tlg.value_formatted
            ));
        }

        out.push_str("</KNXMonitor>\n");
        out
    }

    /// Import telegrams from standard ETS Group Monitor CSV log
    pub fn import_csv(csv_content: &str) -> Result<Vec<KnxTelegram>, String> {
        let mut telegrams = Vec::new();
        let lines = csv_content.lines();

        for line in lines {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with("Nr") {
                continue;
            }

            let parts: Vec<&str> = trimmed.split(';').collect();
            if parts.len() >= 8 {
                let timestamp = parts[1].trim().to_string();
                let svc_raw = parts[2].trim();
                let telegram_type = if svc_raw.contains("Write") {
                    "Write".to_string()
                } else if svc_raw.contains("Read") {
                    "Read".to_string()
                } else if svc_raw.contains("Response") {
                    "Response".to_string()
                } else {
                    "Write".to_string()
                };

                let prio = if parts.len() > 4 && !parts[4].trim().is_empty() {
                    Some(parts[4].trim().to_string())
                } else {
                    None
                };

                let source = parts[5].trim().to_string();
                let destination = parts[7].trim().to_string();
                let dpt = if parts.len() > 11 && !parts[11].trim().is_empty() {
                    parts[11].trim().to_string()
                } else {
                    "1.001".to_string()
                };

                let value_formatted = if parts.len() > 12 {
                    parts[12].trim().to_string()
                } else {
                    "".to_string()
                };

                telegrams.push(KnxTelegram {
                    id: Uuid::new_v4(),
                    timestamp,
                    source,
                    destination,
                    dpt,
                    value_raw: vec![],
                    value_formatted,
                    telegram_type,
                    priority: prio,
                    is_repeat: None,
                });
            }
        }

        if telegrams.is_empty() {
            return Err("Keine gültigen ETS-Telegrammzeilen in der CSV-Datei gefunden.".to_string());
        }

        Ok(telegrams)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_telegram_recorder_lifecycle_and_load_calc() {
        let mut recorder = TelegramRecorder::new(100);
        assert_eq!(recorder.state(), RecorderState::Recording);

        recorder.stop();
        assert_eq!(recorder.state(), RecorderState::Idle);

        recorder.start();
        assert_eq!(recorder.state(), RecorderState::Recording);

        let tlg1 = KnxTelegram {
            id: Uuid::new_v4(),
            timestamp: Utc::now().to_rfc3339(),
            source: "1.1.1".to_string(),
            destination: "2/0/0".to_string(),
            dpt: "1.001".to_string(),
            value_raw: vec![1],
            value_formatted: "1 (Ein)".to_string(),
            telegram_type: "Write".to_string(),
            priority: Some("Normal".to_string()),
            is_repeat: None,
        };

        let tlg2 = KnxTelegram {
            id: Uuid::new_v4(),
            timestamp: Utc::now().to_rfc3339(),
            source: "1.1.2".to_string(),
            destination: "2/0/0".to_string(),
            dpt: "1.001".to_string(),
            value_raw: vec![0],
            value_formatted: "0 (Aus)".to_string(),
            telegram_type: "Write".to_string(),
            priority: Some("Low".to_string()),
            is_repeat: None,
        };

        recorder.record(tlg1);
        recorder.record(tlg2);

        let stats = recorder.get_statistics();
        assert_eq!(stats.total_telegrams, 2);
        assert_eq!(stats.write_count, 2);
        assert_eq!(stats.top_destinations[0].0, "2/0/0");
        assert_eq!(stats.top_destinations[0].1, 2);

        let csv = recorder.export_csv();
        assert!(csv.contains("GroupValue_Write"));
        assert!(csv.contains("2/0/0"));

        let xml = recorder.export_xml();
        assert!(xml.contains("<KNXMonitor"));
        assert!(xml.contains("SourceAddress=\"1.1.1\""));

        let imported = TelegramRecorder::import_csv(&csv).expect("CSV Import should succeed");
        assert_eq!(imported.len(), 2);
        assert_eq!(imported[0].destination, "2/0/0");

        recorder.pause();
        assert_eq!(recorder.state(), RecorderState::Paused);
    }

    #[test]
    fn test_telegram_filter_wildcard_matching() {
        let filter = TelegramFilter {
            source: Some("1.1.*".to_string()),
            destination: Some("2/0/*".to_string()),
            telegram_type: Some("Write".to_string()),
            dpt: None,
            search_text: None,
        };

        let matching_tlg = KnxTelegram {
            id: Uuid::new_v4(),
            timestamp: Utc::now().to_rfc3339(),
            source: "1.1.15".to_string(),
            destination: "2/0/5".to_string(),
            dpt: "1.001".to_string(),
            value_raw: vec![1],
            value_formatted: "1".to_string(),
            telegram_type: "Write".to_string(),
            priority: None,
            is_repeat: None,
        };

        let non_matching_tlg = KnxTelegram {
            id: Uuid::new_v4(),
            timestamp: Utc::now().to_rfc3339(),
            source: "1.2.1".to_string(),
            destination: "2/0/5".to_string(),
            dpt: "1.001".to_string(),
            value_raw: vec![1],
            value_formatted: "1".to_string(),
            telegram_type: "Write".to_string(),
            priority: None,
            is_repeat: None,
        };

        assert!(filter.matches(&matching_tlg));
        assert!(!filter.matches(&non_matching_tlg));
    }
}
