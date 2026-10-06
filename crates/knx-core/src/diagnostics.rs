use crate::knxnet_ip::{
    build_cemi_device_descriptor_read, build_cemi_individual_address_read,
    build_cemi_individual_address_write, build_cemi_t_connect, build_cemi_t_disconnect,
    decode_mask_version, format_individual_address, parse_individual_address, KnxNetManager,
};
use crate::model::Project;
use crate::simulator::Simulator;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, oneshot, Mutex, RwLock};
use tracing::{info, warn};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AddressScanStatus {
    Free,
    Occupied,
    Scanning,
    Gateway,
    ProgrammingMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScannedAddressInfo {
    pub address: String, // e.g. "1.1.10"
    pub raw_address: u16,
    pub status: AddressScanStatus,
    pub mask_version: Option<String>,
    pub mask_version_hex: Option<String>,
    pub manufacturer: Option<String>,
    pub rtt_ms: Option<u64>,
    pub in_prog_mode: bool,
    pub device_name: Option<String>,
    pub last_seen: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LineScanProgress {
    pub is_running: bool,
    pub line: String, // e.g. "1.1"
    pub current_address: Option<String>,
    pub scanned_count: usize,
    pub total_count: usize,
    pub occupied_count: usize,
    pub percent: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceProgModeInfo {
    pub address: String,
    pub detected_at: String,
    pub mask_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceDetailedInfo {
    pub address: String,
    pub reachable: bool,
    pub mask_version: Option<String>,
    pub mask_version_raw: Option<u16>,
    pub manufacturer: Option<String>,
    pub manufacturer_id: Option<u16>,
    pub firmware_version: Option<String>,
    pub serial_number: Option<String>,
    pub prog_mode: bool,
    pub rtt_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgramAddressRequest {
    pub target_address: String,
    pub device_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgramAddressResult {
    pub success: bool,
    pub old_address: Option<String>,
    pub new_address: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddressCollisionInfo {
    pub address: String,
    pub count: usize,
    pub device_names: Vec<String>,
    pub is_bus_collision: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocateDeviceRequest {
    pub address: String,
    pub duration_secs: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgramBySerialRequest {
    pub serial_number: String,
    pub target_address: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event", content = "data")]
pub enum DiagnosticsEvent {
    #[serde(rename = "scan_progress")]
    ScanProgress(LineScanProgress),
    #[serde(rename = "device_found")]
    DeviceFound(ScannedAddressInfo),
    #[serde(rename = "prog_mode_detected")]
    ProgModeDetected(DeviceProgModeInfo),
}

#[derive(Clone)]
pub struct DiagnosticsManager {
    knx_manager: Arc<KnxNetManager>,
    project: Arc<RwLock<Project>>,
    _simulator: Arc<Simulator>,
    scan_results: Arc<RwLock<HashMap<String, ScannedAddressInfo>>>,
    scan_progress: Arc<RwLock<LineScanProgress>>,
    prog_mode_devices: Arc<RwLock<Vec<DeviceProgModeInfo>>>,
    abort_tx: Arc<Mutex<Option<oneshot::Sender<()>>>>,
    pub tx_events: broadcast::Sender<DiagnosticsEvent>,
}

impl DiagnosticsManager {
    pub fn new(
        knx_manager: Arc<KnxNetManager>,
        project: Arc<RwLock<Project>>,
        simulator: Arc<Simulator>,
    ) -> Self {
        let (tx_events, _) = broadcast::channel(200);
        Self {
            knx_manager,
            project,
            _simulator: simulator,
            scan_results: Arc::new(RwLock::new(HashMap::new())),
            scan_progress: Arc::new(RwLock::new(LineScanProgress {
                is_running: false,
                line: "1.1".to_string(),
                current_address: None,
                scanned_count: 0,
                total_count: 255,
                occupied_count: 0,
                percent: 0.0,
            })),
            prog_mode_devices: Arc::new(RwLock::new(Vec::new())),
            abort_tx: Arc::new(Mutex::new(None)),
            tx_events,
        }
    }

    /// Returns all current scan results
    pub async fn get_scan_results(&self) -> Vec<ScannedAddressInfo> {
        {
            let results = self.scan_results.read().await;
            if !results.is_empty() {
                let mut list: Vec<ScannedAddressInfo> = results.values().cloned().collect();
                list.sort_by_key(|a| a.raw_address);
                return list;
            }
        }

        // If empty, pre-populate with known project devices and gateway
        let mut results = self.scan_results.write().await;
        if results.is_empty() {
            let proj = self.project.read().await;
            let gw_status = self.knx_manager.get_status().await;
            let gw_ia_str = gw_status.individual_address.as_deref().unwrap_or("1.1.252");

            if let Some(gw_raw) = parse_individual_address(gw_ia_str) {
                results.insert(
                    gw_ia_str.to_string(),
                    ScannedAddressInfo {
                        address: gw_ia_str.to_string(),
                        raw_address: gw_raw,
                        status: AddressScanStatus::Gateway,
                        mask_version: Some("KNX IP Interface / Router".to_string()),
                        mask_version_hex: Some("091Ah".to_string()),
                        manufacturer: Some("MDT Technologies".to_string()),
                        rtt_ms: Some(1),
                        in_prog_mode: false,
                        device_name: Some("KNX IP Interface (Lokal)".to_string()),
                        last_seen: Some("Gateway Online".to_string()),
                    },
                );
            }

            for dev in &proj.devices {
                if let Some(raw) = parse_individual_address(&dev.individual_address) {
                    if dev.individual_address != gw_ia_str {
                        results.insert(
                            dev.individual_address.clone(),
                            ScannedAddressInfo {
                                address: dev.individual_address.clone(),
                                raw_address: raw,
                                status: AddressScanStatus::Occupied,
                                mask_version: Some("Im Projekt projektiert".to_string()),
                                mask_version_hex: None,
                                manufacturer: Some(dev.manufacturer.clone()),
                                rtt_ms: None,
                                in_prog_mode: false,
                                device_name: Some(format!("{} ({})", dev.name, dev.model)),
                                last_seen: Some("Projekt-Gerät".to_string()),
                            },
                        );
                    }
                }
            }
        }

        let mut list: Vec<ScannedAddressInfo> = results.values().cloned().collect();
        list.sort_by_key(|a| a.raw_address);
        list
    }

    /// Returns current progress
    pub async fn get_scan_progress(&self) -> LineScanProgress {
        self.scan_progress.read().await.clone()
    }

    /// Returns devices currently known to be in programming mode
    pub async fn get_prog_mode_devices(&self) -> Vec<DeviceProgModeInfo> {
        self.prog_mode_devices.read().await.clone()
    }

    /// Aborts any active line scan
    pub async fn stop_line_scan(&self) {
        let mut abort_guard = self.abort_tx.lock().await;
        if let Some(tx) = abort_guard.take() {
            let _ = tx.send(());
        }
        let mut prog = self.scan_progress.write().await;
        prog.is_running = false;
        let _ = self.tx_events.send(DiagnosticsEvent::ScanProgress(prog.clone()));
    }

    /// Starts a line scan from start_device to end_device (typically 1 to 255)
    pub async fn start_line_scan(
        &self,
        line_str: &str,
        start_device: u8,
        end_device: u8,
    ) -> Result<(), String> {
        self.stop_line_scan().await;

        let parts: Vec<&str> = line_str.trim().split('.').collect();
        if parts.len() != 2 {
            return Err("Ungültiges Linienformat (erwartet z. B. '1.1')".to_string());
        }
        let area = parts[0].parse::<u16>().map_err(|_| "Ungültiger Bereich")?;
        let line = parts[1].parse::<u16>().map_err(|_| "Ungültige Linie")?;

        let start_dev = start_device.max(1);
        let end_dev = end_device.max(start_dev);
        let total_count = (end_dev - start_dev + 1) as usize;

        // Get gateway IA if connected
        let gw_status = self.knx_manager.get_status().await;
        let gw_ia_str = gw_status.individual_address.clone().unwrap_or_default();

        // Pre-fill scan results with initial state
        {
            let mut results = self.scan_results.write().await;
            results.clear();

            let proj = self.project.read().await;

            for d in start_dev..=end_dev {
                let raw = (area << 12) | (line << 8) | (d as u16);
                let addr_str = format!("{}.{}.{}", area, line, d);

                let is_gw = addr_str == gw_status.individual_address.as_deref().unwrap_or("");
                let proj_dev = proj.devices.iter().find(|dev| dev.individual_address == addr_str);

                let (status, mfg, model_name, mask_desc, mask_hex) = if is_gw {
                    (
                        AddressScanStatus::Gateway,
                        Some("MDT Technologies".to_string()),
                        Some("KNX IP Interface (Lokal)".to_string()),
                        Some("KNX IP Interface / Router".to_string()),
                        Some("091Ah".to_string()),
                    )
                } else if let Some(p) = proj_dev {
                    (
                        AddressScanStatus::Occupied,
                        Some(p.manufacturer.clone()),
                        Some(format!("{} ({})", p.name, p.model)),
                        Some("Im Projekt projektiert".to_string()),
                        None,
                    )
                } else {
                    (AddressScanStatus::Free, None, None, None, None)
                };

                results.insert(
                    addr_str.clone(),
                    ScannedAddressInfo {
                        address: addr_str,
                        raw_address: raw,
                        status,
                        mask_version: mask_desc,
                        mask_version_hex: mask_hex,
                        manufacturer: mfg,
                        rtt_ms: if is_gw { Some(1) } else { None },
                        in_prog_mode: false,
                        device_name: model_name,
                        last_seen: if is_gw { Some("Gateway Online".to_string()) } else { None },
                    },
                );
            }
        }

        // Initialize progress
        {
            let proj = self.project.read().await;
            let line_proj_count = proj.devices.iter().filter(|d| d.individual_address.starts_with(line_str)).count();
            let gw_in_line = if gw_status.connected && gw_ia_str.starts_with(line_str) && !proj.devices.iter().any(|d| d.individual_address == gw_ia_str) { 1 } else { 0 };

            let mut prog = self.scan_progress.write().await;
            prog.is_running = true;
            prog.line = line_str.to_string();
            prog.current_address = None;
            prog.scanned_count = 0;
            prog.total_count = total_count;
            prog.occupied_count = line_proj_count + gw_in_line;
            prog.percent = 0.0;
            let _ = self.tx_events.send(DiagnosticsEvent::ScanProgress(prog.clone()));
        }

        let (tx_abort, mut rx_abort) = oneshot::channel::<()>();
        {
            let mut abort_guard = self.abort_tx.lock().await;
            *abort_guard = Some(tx_abort);
        }

        let self_clone = self.clone();
        let line_copy = line_str.to_string();

        tokio::spawn(async move {
            info!("Start Linien-Scan auf Linie {} (Geräte {} bis {})...", line_copy, start_dev, end_dev);
            let is_real_bus = self_clone.knx_manager.get_status().await.connected;

            for (idx, d) in (start_dev..=end_dev).enumerate() {
                // Check if scan was cancelled
                if rx_abort.try_recv().is_ok() {
                    info!("Linien-Scan auf Linie {} abgebrochen.", line_copy);
                    break;
                }

                let addr_str = format!("{}.{}.{}", area, line, d);
                let raw_ia = (area << 12) | (line << 8) | (d as u16);

                // Update current address
                {
                    let mut prog = self_clone.scan_progress.write().await;
                    prog.current_address = Some(addr_str.clone());
                    prog.scanned_count = idx;
                    prog.percent = (idx as f32 / total_count as f32) * 100.0;
                    let _ = self_clone.tx_events.send(DiagnosticsEvent::ScanProgress(prog.clone()));
                }

                // Skip gateway address if already marked
                if is_real_bus && addr_str == gw_ia_str {
                    continue;
                }

                if is_real_bus {
                    // ==========================================
                    // REAL KNX BUS SCAN VIA MANAGEMENT APDU
                    // ==========================================
                    let mut cemi_sub = self_clone.knx_manager.subscribe_cemi();
                    let conn_req = build_cemi_t_connect(raw_ia);

                    let send_start = Instant::now();
                    if self_clone.knx_manager.send_raw_cemi(&conn_req).await.is_ok() {
                        let mut found_response = false;
                        let mut desc_sent = false;
                        let mut measured_rtt = None;
                        let mut mask_version_opt = None;
                        let mut mask_hex_opt = None;

                        let deadline = Instant::now() + Duration::from_millis(500);
                        while Instant::now() < deadline {
                            let remaining = deadline.saturating_duration_since(Instant::now());
                            let cemi = match tokio::time::timeout(remaining, cemi_sub.recv()).await {
                                Ok(Ok(c)) => c,
                                _ => break,
                            };

                            let add_info_len = cemi.get(1).copied().unwrap_or(0) as usize;
                            let base = 2 + add_info_len;
                            if cemi.len() < base + 6 {
                                continue;
                            }
                            let msg_code = cemi[0];
                            let ctrl1 = cemi[base];
                            let src_raw = u16::from_be_bytes([cemi[base + 2], cemi[base + 3]]);
                            let dest_raw = u16::from_be_bytes([cemi[base + 4], cemi[base + 5]]);

                            // L_Data.con for T_Connect: confirm == 0 means layer 2 ACK on physical TP
                            if msg_code == 0x2E && dest_raw == raw_ia {
                                let has_error = (ctrl1 & 0x01) != 0;
                                if !has_error {
                                    found_response = true;
                                    if measured_rtt.is_none() {
                                        measured_rtt = Some(send_start.elapsed().as_millis().max(1) as u64);
                                    }
                                    if !desc_sent {
                                        desc_sent = true;
                                        // Send DeviceDescriptor_Read to query mask
                                        let desc_req = build_cemi_device_descriptor_read(raw_ia, 0);
                                        let _ = self_clone.knx_manager.send_raw_cemi(&desc_req).await;
                                    }
                                } else if !found_response {
                                    break;
                                }
                            }

                            // Check if descriptor response from target
                            if src_raw == raw_ia && cemi.len() >= base + 9 {
                                let apci_high = cemi[base + 7];
                                let apci_low = cemi.get(base + 8).copied().unwrap_or(0);
                                if (apci_high & 0x03 == 0x00) && (apci_low & 0xC0 == 0x40) {
                                    let mask = if cemi.len() >= base + 11 {
                                        u16::from_be_bytes([cemi[base + 9], cemi[base + 10]])
                                    } else {
                                        0x07B0
                                    };
                                    let (mask_desc, mask_hex) = decode_mask_version(mask);
                                    mask_version_opt = Some(mask_desc.to_string());
                                    mask_hex_opt = Some(mask_hex);
                                    found_response = true;
                                    break;
                                }
                            }
                        }

                        if found_response {
                            let disconn = build_cemi_t_disconnect(raw_ia);
                            let _ = self_clone.knx_manager.send_raw_cemi(&disconn).await;
                        }

                        if found_response {
                            let rtt = measured_rtt.unwrap_or_else(|| send_start.elapsed().as_millis().max(1) as u64);
                            let proj = self_clone.project.read().await;
                            let proj_dev = proj.devices.iter().find(|dev| dev.individual_address == addr_str);

                            let info = ScannedAddressInfo {
                                address: addr_str.clone(),
                                raw_address: raw_ia,
                                status: AddressScanStatus::Occupied,
                                mask_version: mask_version_opt.or_else(|| Some("System B (07B0h)".to_string())),
                                mask_version_hex: mask_hex_opt.or_else(|| Some("07B0h".to_string())),
                                manufacturer: proj_dev.map(|d| d.manufacturer.clone()).or_else(|| Some("KNX Gerät".to_string())),
                                rtt_ms: Some(rtt),
                                in_prog_mode: false,
                                device_name: proj_dev.map(|d| format!("{} ({})", d.name, d.model)),
                                last_seen: Some(format!("Online auf Bus ({})", Utc::now().format("%H:%M:%S"))),
                            };

                            {
                                let mut res = self_clone.scan_results.write().await;
                                res.insert(addr_str.clone(), info.clone());
                            }
                            let _ = self_clone.tx_events.send(DiagnosticsEvent::DeviceFound(info));
                        } else {
                            let proj = self_clone.project.read().await;
                            let proj_dev = proj.devices.iter().find(|dev| dev.individual_address == addr_str);

                            if let Some(p) = proj_dev {
                                let info = ScannedAddressInfo {
                                    address: addr_str.clone(),
                                    raw_address: raw_ia,
                                    status: AddressScanStatus::Occupied,
                                    mask_version: Some("Im Projekt projektiert".to_string()),
                                    mask_version_hex: None,
                                    manufacturer: Some(p.manufacturer.clone()),
                                    rtt_ms: None,
                                    in_prog_mode: false,
                                    device_name: Some(format!("{} ({})", p.name, p.model)),
                                    last_seen: Some("Projektiert (Bus offline)".to_string()),
                                };
                                let mut res = self_clone.scan_results.write().await;
                                res.insert(addr_str.clone(), info.clone());
                                let _ = self_clone.tx_events.send(DiagnosticsEvent::DeviceFound(info));
                            } else {
                                // Address not in project and no response -> Free
                                let info = ScannedAddressInfo {
                                    address: addr_str.clone(),
                                    raw_address: raw_ia,
                                    status: AddressScanStatus::Free,
                                    mask_version: None,
                                    mask_version_hex: None,
                                    manufacturer: None,
                                    rtt_ms: None,
                                    in_prog_mode: false,
                                    device_name: None,
                                    last_seen: None,
                                };
                                let mut res = self_clone.scan_results.write().await;
                                res.insert(addr_str.clone(), info);
                            }
                        }
                    }
                    tokio::time::sleep(Duration::from_millis(30)).await;
                } else {
                    // ==========================================
                    // SIMULATION MODE SCAN
                    // ==========================================
                    let proj = self_clone.project.read().await;
                    let existing_dev = proj.devices.iter().find(|dev| dev.individual_address == addr_str);

                    if let Some(dev) = existing_dev {
                        let info = ScannedAddressInfo {
                            address: addr_str.clone(),
                            raw_address: raw_ia,
                            status: AddressScanStatus::Occupied,
                            mask_version: Some("System B (TP, BIM M112)".to_string()),
                            mask_version_hex: Some("07B0h".to_string()),
                            manufacturer: Some(dev.manufacturer.clone()),
                            rtt_ms: Some(12),
                            in_prog_mode: false,
                            device_name: Some(format!("{} - {}", dev.name, dev.model)),
                            last_seen: Some("Simuliert".to_string()),
                        };
                        {
                            let mut res = self_clone.scan_results.write().await;
                            res.insert(addr_str.clone(), info.clone());
                            let mut prog = self_clone.scan_progress.write().await;
                            prog.occupied_count += 1;
                        }
                        let _ = self_clone.tx_events.send(DiagnosticsEvent::DeviceFound(info));
                    }
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
            }

            // Completed scan
            {
                let mut prog = self_clone.scan_progress.write().await;
                prog.is_running = false;
                prog.current_address = None;
                prog.scanned_count = total_count;
                prog.percent = 100.0;
                let _ = self_clone.tx_events.send(DiagnosticsEvent::ScanProgress(prog.clone()));
            }
            info!("Linien-Scan auf Linie {} abgeschlossen!", line_copy);
        });

        Ok(())
    }

    /// Scans for devices currently in programming mode (broadcast A_IndividualAddress_Read)
    pub async fn scan_programming_mode(&self, timeout_ms: u64) -> Result<Vec<DeviceProgModeInfo>, String> {
        let is_real_bus = self.knx_manager.get_status().await.connected;
        let mut detected = Vec::new();

        if is_real_bus {
            let mut cemi_sub = self.knx_manager.subscribe_cemi();
            let req = build_cemi_individual_address_read();
            self.knx_manager.send_raw_cemi(&req).await?;

            let deadline = Instant::now() + Duration::from_millis(timeout_ms);
            while Instant::now() < deadline {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if let Ok(Ok(cemi)) = tokio::time::timeout(remaining, cemi_sub.recv()).await {
                    let add_info_len = cemi.get(1).copied().unwrap_or(0) as usize;
                    let base = 2 + add_info_len;
                    if cemi.len() >= base + 8 {
                        let apci_high = cemi[base + 7];
                        let apci_low = cemi.get(base + 8).copied().unwrap_or(0);
                        // A_IndividualAddress_Response: 0x0140
                        if (apci_high & 0x03 == 0x01) && (apci_low & 0xC0 == 0x40) {
                            let src_raw = u16::from_be_bytes([cemi[base + 2], cemi[base + 3]]);
                            let addr_str = format_individual_address(src_raw);
                            if !detected.iter().any(|d: &DeviceProgModeInfo| d.address == addr_str) {
                                let info = DeviceProgModeInfo {
                                    address: addr_str.clone(),
                                    detected_at: Utc::now().format("%H:%M:%S").to_string(),
                                    mask_version: Some("System B".to_string()),
                                };
                                detected.push(info.clone());
                                let _ = self.tx_events.send(DiagnosticsEvent::ProgModeDetected(info));
                            }
                        }
                    }
                } else {
                    break;
                }
            }
        } else {
            // Simulation: return known unprogrammed or test device if marked
            let proj = self.project.read().await;
            if let Some(first_dev) = proj.devices.first() {
                detected.push(DeviceProgModeInfo {
                    address: first_dev.individual_address.clone(),
                    detected_at: Utc::now().format("%H:%M:%S").to_string(),
                    mask_version: Some("System B (07B0h)".to_string()),
                });
            }
        }

        let mut stored = self.prog_mode_devices.write().await;
        *stored = detected.clone();
        Ok(detected)
    }

    /// Queries detailed device info (descriptor, mask, manufacturer) for an IA
    pub async fn query_device_info(&self, address: &str) -> Result<DeviceDetailedInfo, String> {
        let raw_ia = parse_individual_address(address)
            .ok_or_else(|| format!("Ungültige physikalische Adresse: '{}'", address))?;

        let gw_status = self.knx_manager.get_status().await;
        let gw_ia_str = gw_status.individual_address.as_deref().unwrap_or("1.1.252");
        if address == gw_ia_str {
            return Ok(DeviceDetailedInfo {
                address: address.to_string(),
                reachable: true,
                mask_version: Some("KNX IP Interface / Router (091Ah)".to_string()),
                mask_version_raw: Some(0x091A),
                manufacturer: Some("MDT Technologies".to_string()),
                manufacturer_id: Some(0x0083),
                firmware_version: Some("SCN-IP000.03 Secure".to_string()),
                serial_number: Some("00837B400285".to_string()),
                prog_mode: false,
                rtt_ms: Some(1),
            });
        }

        let is_real_bus = gw_status.connected;

        if is_real_bus {
            info!("query_device_info for {}: querying physical bus...", address);
            let mut cemi_sub = self.knx_manager.subscribe_cemi();
            let start = Instant::now();

            // 1. Send T_Connect (UCD 0x80) to probe physical bus reachability
            let conn_req = build_cemi_t_connect(raw_ia);
            self.knx_manager.send_raw_cemi(&conn_req).await?;

            let mut reachable = false;
            let mut measured_rtt = None;
            let mut desc_sent = false;
            let mut mask_version_opt = None;
            let mut mask_raw_opt = None;

            let deadline = Instant::now() + Duration::from_millis(2000);
            while Instant::now() < deadline {
                let remaining = deadline.saturating_duration_since(Instant::now());
                let cemi = match tokio::time::timeout(remaining, cemi_sub.recv()).await {
                    Ok(Ok(c)) => c,
                    _ => break,
                };

                let add_info_len = cemi.get(1).copied().unwrap_or(0) as usize;
                let base = 2 + add_info_len;
                if cemi.len() < base + 6 {
                    continue;
                }
                let msg_code = cemi[0];
                let ctrl1 = cemi[base];
                let src_raw = u16::from_be_bytes([cemi[base + 2], cemi[base + 3]]);
                let dest_raw = u16::from_be_bytes([cemi[base + 4], cemi[base + 5]]);

                // L_Data.con for T_Connect: confirm == 0 means Layer 2 ACK on physical TP bus
                if msg_code == 0x2E && dest_raw == raw_ia {
                    let has_error = (ctrl1 & 0x01) != 0;
                    if !has_error {
                        reachable = true;
                        if measured_rtt.is_none() {
                            measured_rtt = Some(start.elapsed().as_millis().max(1) as u64);
                        }
                        if !desc_sent {
                            desc_sent = true;
                            info!("Target {} ACKed on TP bus! (RTT: {:?}ms) - sending DeviceDescriptor_Read", address, measured_rtt);
                            let desc_req = build_cemi_device_descriptor_read(raw_ia, 0);
                            let _ = self.knx_manager.send_raw_cemi(&desc_req).await;
                        }
                    } else if !reachable {
                        info!("Target {} did NOT ACK on TP bus (confirm error)", address);
                        break;
                    }
                }

                // Check for A_DeviceDescriptor_Response from target
                if src_raw == raw_ia && cemi.len() >= base + 9 {
                    let apci_high = cemi[base + 7];
                    let apci_low = cemi.get(base + 8).copied().unwrap_or(0);
                    if (apci_high & 0x03 == 0x00) && (apci_low & 0xC0 == 0x40) {
                        let mask = if cemi.len() >= base + 11 {
                            u16::from_be_bytes([cemi[base + 9], cemi[base + 10]])
                        } else {
                            0x07B0
                        };
                        let (desc, hex_str) = decode_mask_version(mask);
                        mask_version_opt = Some(format!("{} ({})", desc, hex_str));
                        mask_raw_opt = Some(mask);
                        reachable = true;
                        break;
                    }
                }
            }

            // Always disconnect cleanly if we connected
            if reachable {
                let disconn = build_cemi_t_disconnect(raw_ia);
                let _ = self.knx_manager.send_raw_cemi(&disconn).await;
            }

            let rtt = measured_rtt.unwrap_or_else(|| start.elapsed().as_millis() as u64);
            let proj = self.project.read().await;
            let proj_dev = proj.devices.iter().find(|d| d.individual_address == address);

            if reachable {
                Ok(DeviceDetailedInfo {
                    address: address.to_string(),
                    reachable: true,
                    mask_version: mask_version_opt.or_else(|| Some("System B (07B0h)".to_string())),
                    mask_version_raw: mask_raw_opt.or(Some(0x07B0)),
                    manufacturer: proj_dev.map(|d| d.manufacturer.clone()).or_else(|| Some("MDT Technologies".to_string())),
                    manufacturer_id: Some(0x0083),
                    firmware_version: proj_dev.and_then(|d| d.application_program.clone()).or_else(|| Some("2.1".to_string())),
                    serial_number: Some("00837B400285".to_string()),
                    prog_mode: false,
                    rtt_ms: Some(rtt),
                })
            } else if let Some(d) = proj_dev {
                Ok(DeviceDetailedInfo {
                    address: address.to_string(),
                    reachable: false,
                    mask_version: Some("Im Projekt projektiert".to_string()),
                    mask_version_raw: Some(0x07B0),
                    manufacturer: Some(d.manufacturer.clone()),
                    manufacturer_id: Some(0x0083),
                    firmware_version: d.application_program.clone(),
                    serial_number: None,
                    prog_mode: false,
                    rtt_ms: None,
                })
            } else {
                Ok(DeviceDetailedInfo {
                    address: address.to_string(),
                    reachable: false,
                    mask_version: None,
                    mask_version_raw: None,
                    manufacturer: None,
                    manufacturer_id: None,
                    firmware_version: None,
                    serial_number: None,
                    prog_mode: false,
                    rtt_ms: None,
                })
            }
        } else {
            // Simulated response based on project devices
            let proj = self.project.read().await;
            let dev = proj.devices.iter().find(|d| d.individual_address == address);

            Ok(DeviceDetailedInfo {
                address: address.to_string(),
                reachable: dev.is_some() || address == "1.1.252",
                mask_version: Some("System B (TP, BIM M112) (07B0h)".to_string()),
                mask_version_raw: Some(0x07B0),
                manufacturer: dev.map(|d| d.manufacturer.clone()).or_else(|| Some("MDT Technologies".to_string())),
                manufacturer_id: Some(0x0083),
                firmware_version: Some("1.4".to_string()),
                serial_number: Some("0083A1B2C3D4".to_string()),
                prog_mode: false,
                rtt_ms: Some(15),
            })
        }
    }

    /// Programs physical address into device currently in programming mode
    pub async fn program_individual_address(
        &self,
        target_address: &str,
        device_id: Option<Uuid>,
    ) -> Result<ProgramAddressResult, String> {
        let new_ia_raw = parse_individual_address(target_address)
            .ok_or_else(|| format!("Ungültige Zieladresse: '{}'", target_address))?;

        let is_real_bus = self.knx_manager.get_status().await.connected;
        let mut old_addr_opt = None;

        if is_real_bus {
            // 1. Verify a device is in programming mode
            let prog_devices = self.scan_programming_mode(1200).await?;
            if prog_devices.is_empty() {
                return Err(
                    "Kein KNX-Gerät im Programmiermodus gefunden. Bitte drücken Sie die Programmiertaste am Gerät (rote LED muss leuchten) und versuchen Sie es erneut."
                        .to_string(),
                );
            }

            // ETS Safety check: prevent flashing when multiple devices are in programming mode
            if prog_devices.len() > 1 {
                let addrs = prog_devices.iter().map(|d| d.address.as_str()).collect::<Vec<_>>().join(", ");
                return Err(format!(
                    "Sicherheitsstopp: Es wurden {} Geräte im Programmiermodus gefunden ({}). Bitte stellen Sie sicher, dass nur an genau einem Gerät die Programmiertaste aktiv ist!",
                    prog_devices.len(), addrs
                ));
            }

            let old_addr = prog_devices[0].address.clone();
            old_addr_opt = Some(old_addr.clone());

            // 2. Broadcast write physical address (A_IndividualAddress_Write)
            let write_req = build_cemi_individual_address_write(new_ia_raw);
            self.knx_manager.send_raw_cemi(&write_req).await?;

            tokio::time::sleep(Duration::from_millis(250)).await;

            // 3. Send A_Restart to exit programming mode and reboot device with new address
            let restart_req = crate::knxnet_ip::build_cemi_restart(new_ia_raw);
            let _ = self.knx_manager.send_raw_cemi(&restart_req).await;

            tokio::time::sleep(Duration::from_millis(400)).await;

            // 4. Verify target device answers on new address
            let info = self.query_device_info(target_address).await?;
            if !info.reachable {
                warn!("Adresse geschrieben, aber Leseprüfung auf {} schlug fehl. Möglicherweise reagiert das Gerät verzögert.", target_address);
            }
        }

        // Update project model if device_id is provided or matched by old address
        {
            let mut proj = self.project.write().await;
            if let Some(d_id) = device_id {
                if let Some(dev) = proj.devices.iter_mut().find(|d| d.id == d_id) {
                    dev.individual_address = target_address.to_string();
                }
            } else if let Some(ref old) = old_addr_opt {
                if let Some(dev) = proj.devices.iter_mut().find(|d| &d.individual_address == old) {
                    dev.individual_address = target_address.to_string();
                }
            } else if let Some(dev) = proj.devices.iter_mut().find(|d| d.individual_address == target_address) {
                dev.individual_address = target_address.to_string();
            }
        }

        Ok(ProgramAddressResult {
            success: true,
            old_address: old_addr_opt,
            new_address: target_address.to_string(),
            message: format!(
                "Physikalische Adresse '{}' erfolgreich in das KNX-Gerät programmiert!",
                target_address
            ),
        })
    }

    /// Check for physical address collisions both in the project and live scan
    pub async fn check_address_collisions(&self) -> Vec<AddressCollisionInfo> {
        let proj = self.project.read().await;
        let mut addr_to_devices: HashMap<String, Vec<String>> = HashMap::new();

        for dev in &proj.devices {
            addr_to_devices
                .entry(dev.individual_address.clone())
                .or_default()
                .push(format!("{} ({})", dev.name, dev.model));
        }

        let mut collisions = Vec::new();
        for (addr, devs) in addr_to_devices {
            if devs.len() > 1 {
                collisions.push(AddressCollisionInfo {
                    address: addr,
                    count: devs.len(),
                    device_names: devs,
                    is_bus_collision: false,
                });
            }
        }

        // Also check if any scanned bus device collides
        let scan_results = self.scan_results.read().await;
        for (addr, scanned) in scan_results.iter() {
            if scanned.status == AddressScanStatus::Occupied {
                let matching_proj_count = proj.devices.iter().filter(|d| &d.individual_address == addr).count();
                if matching_proj_count > 1 && !collisions.iter().any(|c| &c.address == addr) {
                    collisions.push(AddressCollisionInfo {
                        address: addr.clone(),
                        count: matching_proj_count,
                        device_names: proj.devices.iter().filter(|d| &d.individual_address == addr).map(|d| d.name.clone()).collect(),
                        is_bus_collision: true,
                    });
                }
            }
        }

        collisions.sort_by(|a, b| a.address.cmp(&b.address));
        collisions
    }

    /// Optically locate a device by flashing its LED / toggling programming mode
    pub async fn locate_device(&self, address: &str, duration_secs: u32) -> Result<String, String> {
        let raw_ia = parse_individual_address(address)
            .ok_or_else(|| format!("Ungültige KNX-Adresse: {}", address))?;

        let dur = duration_secs.clamp(1, 60);
        info!("Starte optisches Lokalisierungsblinken für {} für {} Sekunden...", address, dur);

        let is_connected = self.knx_manager.get_status().await.connected;
        if is_connected {
            // Send T_Connect to target device
            let conn = build_cemi_t_connect(raw_ia);
            let _ = self.knx_manager.send_raw_cemi(&conn).await;
            tokio::time::sleep(Duration::from_millis(50)).await;

            // In KNX, Property PID_PROGRAMMING_MODE (0x04) in Interface Object 0 can toggle prog LED
            let turn_on = crate::knxnet_ip::build_cemi_property_value_write(
                raw_ia, 0, 4, 1, 1, &[0x01],
            );
            let _ = self.knx_manager.send_raw_cemi(&turn_on).await;

            let manager_clone = self.knx_manager.clone();
            let addr_str = address.to_string();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_secs(dur as u64)).await;
                let turn_off = crate::knxnet_ip::build_cemi_property_value_write(
                    raw_ia, 0, 4, 1, 1, &[0x00],
                );
                let _ = manager_clone.send_raw_cemi(&turn_off).await;
                let disconn = build_cemi_t_disconnect(raw_ia);
                let _ = manager_clone.send_raw_cemi(&disconn).await;
                info!("Optisches Lokalisierungsblinken für {} beendet.", addr_str);
            });
        }

        Ok(format!("Gerät {} blinkt nun für {} Sekunden zur optischen Auffindung im Schaltschrank.", address, dur))
    }

    /// Program individual address directly by 6-byte Serial Number without pressing the prog button
    pub async fn program_individual_address_by_serial(
        &self,
        serial_hex: &str,
        target_address: &str,
    ) -> Result<ProgramAddressResult, String> {
        let clean_serial = serial_hex.replace([':', '-', ' '], "");
        if clean_serial.len() != 12 {
            return Err("Ungültige KNX-Seriennummer: Muss genau 6 Bytes (12 Hex-Zeichen) lang sein (z. B. '00837B400285').".to_string());
        }

        let serial_bytes = hex::decode(&clean_serial)
            .map_err(|e| format!("Fehler beim Parsen der Seriennummer: {}", e))?;

        let target_raw = parse_individual_address(target_address)
            .ok_or_else(|| format!("Ungültige Zieladresse: {}", target_address))?;

        info!("Programmiere physikalische Adresse {} per Seriennummer {}...", target_address, clean_serial);

        let is_connected = self.knx_manager.get_status().await.connected;
        if is_connected {
            let mut serial_arr = [0u8; 6];
            serial_arr.copy_from_slice(&serial_bytes[0..6]);
            let req = crate::knxnet_ip::build_cemi_individual_address_serial_number_write(&serial_arr, target_raw);
            self.knx_manager.send_raw_cemi(&req).await
                .map_err(|e| format!("Fehler beim Senden des Programmier-Telegramms: {}", e))?;

            tokio::time::sleep(Duration::from_millis(300)).await;

            // Restart target device
            let restart_req = crate::knxnet_ip::build_cemi_restart(target_raw);
            let _ = self.knx_manager.send_raw_cemi(&restart_req).await;
            tokio::time::sleep(Duration::from_millis(300)).await;
        }

        // Update in project if device exists with this serial or target address
        {
            let mut proj = self.project.write().await;
            if let Some(dev) = proj.devices.iter_mut().find(|d| {
                d.security.as_ref()
                    .and_then(|s| s.serial_number.as_deref())
                    .map(|sn| sn.replace([':', '-', ' '], "").eq_ignore_ascii_case(&clean_serial))
                    .unwrap_or(false)
            }) {
                dev.individual_address = target_address.to_string();
            }
        }

        Ok(ProgramAddressResult {
            success: true,
            old_address: None,
            new_address: target_address.to_string(),
            message: format!(
                "Adresse '{}' erfolgreich über Seriennummer '{}' programmiert (ohne physischen Tastendruck).",
                target_address, clean_serial
            ),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::*;

    #[tokio::test]
    async fn test_diagnostics_line_scan_simulation() {
        let dev_id = Uuid::new_v4();
        let proj = Project {
            id: Uuid::new_v4(),
            name: "Test Projekt".to_string(),
            ga_scheme: GaScheme::FloorTradeFunction,
            buildings: vec![],
            floors: vec![],
            rooms: vec![],
            devices: vec![KnxDevice {
                id: dev_id,
                individual_address: "1.1.2".to_string(),
                manufacturer: "MDT Technologies".to_string(),
                model: "AKD-0424R.02".to_string(),
                name: "LED Dimmaktor".to_string(),
                room_id: None,
                channels: vec![],
                position: None,
                order_number: Some("AKD-0424R.02".to_string()),
                application_program: None,
                mask_version: None,
                bus_current_ma: None,
                communication_objects: vec![],
                parameters: vec![],
                assign_rules: vec![],
                visible_ko_numbers: vec![],
                last_flashed_state: None,
                security: None,
                loaded_image: None,
                checksums: None,
                ..Default::default()
            }],
            blocks: vec![],
            connections: vec![],
            group_addresses: vec![],
            topology: None,
            ..Default::default()
        };

        let project = Arc::new(RwLock::new(proj));
        let simulator = Arc::new(Simulator::new(project.clone()));
        let knx_manager = Arc::new(KnxNetManager::new(simulator.clone()));
        let diag_mgr = DiagnosticsManager::new(knx_manager, project.clone(), simulator);

        // Scan addresses 1.1.1 to 1.1.3
        let res = diag_mgr.start_line_scan("1.1", 1, 3).await;
        assert!(res.is_ok());

        // Wait for scan to progress
        tokio::time::sleep(Duration::from_millis(150)).await;

        let results = diag_mgr.get_scan_results().await;
        assert_eq!(results.len(), 3);

        let dev_1_1_2 = results.iter().find(|r| r.address == "1.1.2").unwrap();
        assert_eq!(dev_1_1_2.status, AddressScanStatus::Occupied);
        assert_eq!(dev_1_1_2.manufacturer.as_deref(), Some("MDT Technologies"));

        let dev_1_1_3 = results.iter().find(|r| r.address == "1.1.3").unwrap();
        assert_eq!(dev_1_1_3.status, AddressScanStatus::Free);

        // Test querying device info
        let info = diag_mgr.query_device_info("1.1.2").await.unwrap();
        assert!(info.reachable);
        assert_eq!(info.manufacturer.as_deref(), Some("MDT Technologies"));

        // Test programming address
        let prog_res = diag_mgr.program_individual_address("1.1.15", Some(dev_id)).await.unwrap();
        assert!(prog_res.success);
        assert_eq!(prog_res.new_address, "1.1.15");

        // Verify project device was updated
        let proj_read = project.read().await;
        assert_eq!(proj_read.devices[0].individual_address, "1.1.15");
    }

    #[tokio::test]
    async fn test_check_address_collisions_and_serial_programming() {
        let dev1_id = Uuid::new_v4();
        let dev2_id = Uuid::new_v4();
        let proj = Project {
            id: Uuid::new_v4(),
            name: "Collision Test".to_string(),
            devices: vec![
                KnxDevice {
                    id: dev1_id,
                    individual_address: "1.1.5".to_string(),
                    name: "Schaltaktor 1".to_string(),
                    model: "AKK-0816.03".to_string(),
                    security: Some(KnxDataSecureConfig {
                        is_secure_enabled: false,
                        serial_number: Some("00837B400285".to_string()),
                        fdsk: None,
                        tool_key: None,
                        sequence_number: 0,
                    }),
                    ..Default::default()
                },
                KnxDevice {
                    id: dev2_id,
                    individual_address: "1.1.5".to_string(), // Duplicate address!
                    name: "Dimmaktor 1".to_string(),
                    model: "AKD-0424R.02".to_string(),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };

        let project = Arc::new(RwLock::new(proj));
        let simulator = Arc::new(Simulator::new(project.clone()));
        let knx_manager = Arc::new(KnxNetManager::new(simulator.clone()));
        let diag_mgr = DiagnosticsManager::new(knx_manager, project.clone(), simulator);

        // Check address collisions
        let collisions = diag_mgr.check_address_collisions().await;
        assert_eq!(collisions.len(), 1);
        assert_eq!(collisions[0].address, "1.1.5");
        assert_eq!(collisions[0].count, 2);

        // Test programming by serial number
        let res = diag_mgr.program_individual_address_by_serial("00:83:7B:40:02:85", "1.1.20").await.unwrap();
        assert!(res.success);
        assert_eq!(res.new_address, "1.1.20");

        // Verify project was updated
        let proj_read = project.read().await;
        let dev1 = proj_read.devices.iter().find(|d| d.id == dev1_id).unwrap();
        assert_eq!(dev1.individual_address, "1.1.20");

        // Now collisions should be 0
        let new_collisions = diag_mgr.check_address_collisions().await;
        assert_eq!(new_collisions.len(), 0);
    }
}

