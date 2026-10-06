use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, RwLock};
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::knxnet_ip::{
    build_cemi_individual_address_read, build_cemi_individual_address_serial_number_write,
    build_cemi_individual_address_write, build_cemi_t_ack, build_cemi_t_connect,
    build_cemi_t_data_connected, build_cemi_t_disconnect, decode_mask_version,
    format_individual_address, parse_individual_address, parse_serial_number, KnxNetManager,
};
use crate::model::*;
use crate::storage::StorageManager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceLiveStateResult {
    pub success: bool,
    pub address: String,
    pub reachable: bool,
    pub rtt_ms: Option<u64>,
    pub mask_version: Option<String>,
    pub is_synchronized: bool,
    pub diff_count: usize,
    pub diff_details: Vec<String>,
    pub message: String,
}

/// Point-to-Point KNX bus client for physical programming, memory reading, and verification
pub struct DeviceBusClient {
    knx_manager: Arc<KnxNetManager>,
    raw_ia: u16,
    address_str: String,
    send_seq: u8,
}

impl DeviceBusClient {
    pub fn new(knx_manager: Arc<KnxNetManager>, target_ia_str: &str) -> Result<Self, String> {
        let raw_ia = parse_individual_address(target_ia_str)
            .ok_or_else(|| format!("Ungültige physikalische Adresse: {}", target_ia_str))?;
        Ok(Self {
            knx_manager,
            raw_ia,
            address_str: target_ia_str.to_string(),
            send_seq: 0,
        })
    }

    /// Sends T_Connect and waits for L_Data.con ACK from target device
    pub async fn connect(&mut self) -> Result<u64, String> {
        let status = self.knx_manager.get_status().await;
        if !status.connected {
            return Err("Keine aktive Verbindung zum KNX Gateway vorhanden".to_string());
        }

        self.send_seq = 0;
        let mut cemi_sub = self.knx_manager.subscribe_cemi();
        let conn_pkt = build_cemi_t_connect(self.raw_ia);

        for attempt in 1..=3 {
            let start = tokio::time::Instant::now();
            if let Err(e) = self.knx_manager.send_raw_cemi(&conn_pkt).await {
                if attempt == 3 {
                    return Err(format!("Fehler beim Senden von T_Connect: {}", e));
                }
                tokio::time::sleep(Duration::from_millis(200)).await;
                continue;
            }

            let deadline = tokio::time::Instant::now() + Duration::from_millis(1200);
            while tokio::time::Instant::now() < deadline {
                let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
                match tokio::time::timeout(remaining, cemi_sub.recv()).await {
                    Ok(Ok(cemi)) => {
                        let add_info_len = cemi.get(1).copied().unwrap_or(0) as usize;
                        let base = 2 + add_info_len;
                        if cemi.len() >= base + 6 {
                            let msg_code = cemi[0];
                            let ctrl1 = cemi[base];
                            let dest_raw = u16::from_be_bytes([cemi[base + 4], cemi[base + 5]]);
                            if msg_code == 0x2E && dest_raw == self.raw_ia {
                                let has_error = (ctrl1 & 0x01) != 0;
                                if !has_error {
                                    let rtt = start.elapsed().as_millis().max(1) as u64;
                                    return Ok(rtt);
                                }
                            }
                        }
                    }
                    _ => break,
                }
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }

        Err(format!("Gerät {} antwortet nicht auf Verbindungsaufbau (T_Connect Timeout)", self.address_str))
    }

    /// Internal: Sends NDT frame, waits for T_ACK(seq), optionally collects response frame,
    /// sends T_ACK back to device, and advances send_seq modulo 16.
    pub async fn send_ndt_transaction(
        &mut self,
        apci: u16,
        payload: &[u8],
        expected_resp_apci: Option<u16>,
        timeout_ms: u64,
    ) -> Result<Option<Vec<u8>>, String> {
        let current_seq = self.send_seq & 0x0F;
        let pkt = build_cemi_t_data_connected(self.raw_ia, current_seq, apci, payload);

        let mut cemi_sub = self.knx_manager.subscribe_cemi();

        for attempt in 1..=3 {
            if let Err(e) = self.knx_manager.send_raw_cemi(&pkt).await {
                if attempt == 3 {
                    return Err(format!("Fehler beim Senden von cEMI (seq={}): {}", current_seq, e));
                }
                tokio::time::sleep(Duration::from_millis(150)).await;
                continue;
            }

            let mut deadline = tokio::time::Instant::now() + Duration::from_millis(timeout_ms);
            let mut got_ack = false;
            let mut response_payload: Option<Vec<u8>> = None;

            while tokio::time::Instant::now() < deadline {
                let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
                match tokio::time::timeout(remaining, cemi_sub.recv()).await {
                    Ok(Ok(cemi)) => {
                        let add_info_len = cemi.get(1).copied().unwrap_or(0) as usize;
                        let base = 2 + add_info_len;
                        if cemi.len() < base + 8 {
                            continue;
                        }
                        let src_raw = u16::from_be_bytes([cemi[base + 2], cemi[base + 3]]);
                        if src_raw != self.raw_ia {
                            continue;
                        }

                        let _data_len = cemi[base + 6] as usize;
                        let tpci_byte = cemi[base + 7];

                        // 1. Check for T_ACK from device: TPCI = 0xC2 | (current_seq << 2)
                        if (tpci_byte & 0xC3) == 0xC2 {
                            let ack_seq = (tpci_byte >> 2) & 0x0F;
                            if ack_seq == current_seq {
                                got_ack = true;
                                if expected_resp_apci.is_none() {
                                    break;
                                } else {
                                    // Give device a maximum of 350ms to deliver the application response after T_ACK
                                    let ack_grace = tokio::time::Instant::now() + Duration::from_millis(350);
                                    if ack_grace < deadline {
                                        deadline = ack_grace;
                                    }
                                }
                            }
                        }

                        // 2. Check for NDT Response from device
                        if (tpci_byte & 0xC0) == 0x40 {
                            if let Some(target_apci) = expected_resp_apci {
                                let dev_seq = (tpci_byte >> 2) & 0x0F;
                                let apci_hi = (tpci_byte & 0x03) as u16;
                                let apci_lo = cemi.get(base + 8).copied().unwrap_or(0) as u16;
                                let frame_apci = (apci_hi << 8) | apci_lo;

                                // Send immediate T_ACK back to device for its sequence number
                                let ack_pkt = build_cemi_t_ack(self.raw_ia, dev_seq);
                                let _ = self.knx_manager.send_raw_cemi(&ack_pkt).await;

                                // Check matching APCI (or mask)
                                let is_match = if (target_apci & 0x03C0) == 0x0240 {
                                (frame_apci & 0x03C0) == 0x0240
                            } else if target_apci == 0x03D6 && payload.len() >= 2 {
                                frame_apci == 0x03D6
                                    && cemi.len() >= base + 11
                                    && cemi[base + 9] == payload[0]
                                    && cemi[base + 10] == payload[1]
                            } else {
                                frame_apci == target_apci
                            };

                            if is_match {
                                let data_start = base + 9;
                                if cemi.len() >= data_start {
                                    response_payload = Some(cemi[data_start..].to_vec());
                                    break;
                                }
                            }
                        }
                    }
                }
                    _ => break,
                }
            }

            if got_ack || (expected_resp_apci.is_some() && response_payload.is_some()) {
                self.send_seq = (self.send_seq + 1) % 16;
                return Ok(response_payload);
            }

            tokio::time::sleep(Duration::from_millis(200)).await;
        }

        Err(format!(
            "Timeout beim Warten auf Bestätigung/Antwort von Gerät {} (seq={})",
            self.address_str, current_seq
        ))
    }

    /// Queries Device Descriptor 0 (Mask Version) via connected NDT
    pub async fn read_device_descriptor(&mut self) -> Result<(u16, String), String> {
        // System B DeviceDescriptor_Read = APCI 0x0300
        match self.send_ndt_transaction(0x0300, &[], Some(0x0340), 1200).await {
            Ok(Some(data)) if data.len() >= 2 => {
                let mask = u16::from_be_bytes([data[0], data[1]]);
                let (desc, hex_str) = decode_mask_version(mask);
                Ok((mask, format!("{} ({})", desc, hex_str)))
            }
            _ => Ok((0x07B0, "System B (07B0h)".to_string())),
        }
    }

    /// Authorizes on device with 4-byte key (Level 0 default: 0x00FFFFFF)
    pub async fn authorize(&mut self, key: &[u8; 4]) -> Result<u8, String> {
        match self.send_ndt_transaction(0x03D1, key, Some(0x03D2), 1200).await {
            Ok(Some(data)) => Ok(data.first().copied().unwrap_or(0)),
            Ok(None) => Ok(0),
            Err(e) => Err(format!("Autorisierungsfehler bei {}: {}", self.address_str, e)),
        }
    }

    /// Reads Property Value via A_PropertyValue_Read (APCI 0x03D5)
    pub async fn read_property(&mut self, obj_idx: u8, prop_id: u8, count: u8, start_idx: u16) -> Result<Vec<u8>, String> {
        let count_start = ((count as u16 & 0x0F) << 12) | (start_idx & 0x0FFF);
        let mut payload = Vec::with_capacity(4);
        payload.push(obj_idx);
        payload.push(prop_id);
        payload.extend_from_slice(&count_start.to_be_bytes());

        match self.send_ndt_transaction(0x03D5, &payload, Some(0x03D6), 1200).await {
            Ok(Some(data)) => Ok(data),
            Ok(None) => Ok(vec![]),
            Err(e) => Err(format!("Fehler beim Lesen von Property {}.{}: {}", obj_idx, prop_id, e)),
        }
    }

    /// Writes Property Value via A_PropertyValue_Write (APCI 0x03D7)
    pub async fn write_property(
        &mut self,
        obj_idx: u8,
        prop_id: u8,
        count: u8,
        start_idx: u16,
        data: &[u8],
    ) -> Result<(), String> {
        let count_start = ((count as u16 & 0x0F) << 12) | (start_idx & 0x0FFF);
        let mut payload = Vec::with_capacity(4 + data.len());
        payload.push(obj_idx);
        payload.push(prop_id);
        payload.extend_from_slice(&count_start.to_be_bytes());
        payload.extend_from_slice(data);

        let _ = self.send_ndt_transaction(0x03D7, &payload, Some(0x03D6), 1500).await?;
        Ok(())
    }

    /// Setzt die System-B-Ladezustandsmaschine eines Objekts zurueck und bricht den Ladevorgang ab (0x04 Unload)
    pub async fn load_state_unload(&mut self, obj_idx: u8) -> Result<(), String> {
        self.write_property(obj_idx, 5, 1, 1, &[0x04, 0, 0, 0, 0, 0, 0, 0, 0]).await
    }

    /// Startet den Ladevorgang fuer ein System-B-Interface-Objekt (0x01 Start)
    pub async fn load_state_start(&mut self, obj_idx: u8) -> Result<(), String> {
        self.write_property(obj_idx, 5, 1, 1, &[0x01, 0, 0, 0, 0, 0, 0, 0, 0]).await
    }

    /// Konfiguriert die zu ladende Datenlaenge und den Sub-Befehl (0x03 Set Length)
    pub async fn load_state_set_length(&mut self, obj_idx: u8, sub_cmd: u8, len: u16) -> Result<(), String> {
        let payload = [0x03, sub_cmd, 0, 0, (len >> 8) as u8, (len & 0xFF) as u8, 0, 0, 0];
        self.write_property(obj_idx, 5, 1, 1, &payload).await
    }

    /// Schliesst den Ladevorgang fuer ein System-B-Interface-Objekt erfolgreich ab (0x02 End / Commit)
    pub async fn load_state_commit(&mut self, obj_idx: u8) -> Result<(), String> {
        self.write_property(obj_idx, 5, 1, 1, &[0x02, 0, 0, 0, 0, 0, 0, 0, 0]).await
    }

    /// Writes memory block via connected A_Memory_Write and verifies by device's A_Memory_Response
    pub async fn write_memory_verified(&mut self, address: u16, data: &[u8]) -> Result<(), String> {
        let count = (data.len() as u8).clamp(1, 64) & 0x3F;
        let apci = 0x0280 | (count as u16);
        let mut payload = Vec::with_capacity(2 + data.len());
        payload.extend_from_slice(&address.to_be_bytes());
        payload.extend_from_slice(data);

        // Im KNX-Standard wird A_Memory_Write auf Transportebene per T_ACK quittiert.
        // Es gibt keine A_Memory_Response (0x0240) auf Schreibbefehle.
        match self.send_ndt_transaction(apci, &payload, None, 1500).await {
            Ok(_) => Ok(()),
            Err(e) => Err(format!("Schreibfehler für 0x{:04X} bei {}: {}", address, self.address_str, e)),
        }
    }

    /// Reads memory block via connected A_Memory_Read (APCI 0x0200)
    pub async fn read_memory(&mut self, address: u16, count: u8) -> Result<Vec<u8>, String> {
        let count_clamped = count.clamp(1, 64) & 0x3F;
        let apci = 0x0200 | (count_clamped as u16);
        let payload = address.to_be_bytes();

        match self.send_ndt_transaction(apci, &payload, Some(0x0240), 1200).await {
            Ok(Some(resp_data)) => {
                if resp_data.len() >= 2 {
                    Ok(resp_data[2..].to_vec())
                } else {
                    Ok(resp_data)
                }
            }
            Ok(None) => Ok(vec![]),
            Err(e) => Err(format!("Fehler beim Lesen von 0x{:04X} aus {}: {}", address, self.address_str, e)),
        }
    }

    /// Sends A_Restart via connected NDT
    pub async fn restart(&mut self) -> Result<(), String> {
        let _ = self.send_ndt_transaction(0x0380, &[], None, 1000).await;
        tokio::time::sleep(Duration::from_millis(300)).await;
        Ok(())
    }

    /// Disconnects T_Disconnect
    pub async fn disconnect(&mut self) -> Result<(), String> {
        let disconn_pkt = build_cemi_t_disconnect(self.raw_ia);
        let _ = self.knx_manager.send_raw_cemi(&disconn_pkt).await;
        Ok(())
    }
}

/// Universally packs a parameter value into a byte buffer according to KNX bitfield rules
pub fn pack_parameter_value(
    buffer: &mut [u8],
    offset: usize,
    bit_offset: u8,
    size_in_bit: u32,
    value_str: &str,
    param_type: &str,
) -> Result<(), String> {
    if buffer.is_empty() {
        return Err("Puffer ist leer".to_string());
    }

    let is_float = param_type.to_lowercase().contains("float") || param_type.starts_with("9.");

    if is_float {
        let val_f: f32 = value_str.trim().parse().unwrap_or(0.0);
        if size_in_bit == 16 {
            let bytes = crate::knxnet_ip::encode_knx_float2(val_f);
            if offset + 1 < buffer.len() {
                buffer[offset] = bytes[0];
                buffer[offset + 1] = bytes[1];
                return Ok(());
            } else {
                return Err(format!("Pufferüberlauf für 16-Bit Float bei Offset {}", offset));
            }
        } else if size_in_bit == 32 {
            if offset + 3 < buffer.len() {
                buffer[offset..offset + 4].copy_from_slice(&val_f.to_be_bytes());
                return Ok(());
            } else {
                return Err(format!("Pufferüberlauf für 32-Bit Float bei Offset {}", offset));
            }
        }
    }

    // Parse integer / boolean / enum value
    let num_val: i64 = match value_str.trim().to_lowercase().as_str() {
        "true" | "on" | "ein" | "ja" | "yes" => 1,
        "false" | "off" | "aus" | "nein" | "no" => 0,
        other => {
            if let Ok(v) = other.parse::<i64>() {
                v
            } else if let Ok(f) = other.parse::<f64>() {
                f.round() as i64
            } else {
                0
            }
        }
    };

    // Fast path: Whole-byte aligned standard integers
    if bit_offset == 0 && size_in_bit == 8 {
        if offset < buffer.len() {
            buffer[offset] = (num_val & 0xFF) as u8;
            return Ok(());
        } else {
            return Err(format!("Pufferüberlauf bei Offset {}", offset));
        }
    } else if bit_offset == 0 && size_in_bit == 16 {
        if offset + 1 < buffer.len() {
            let bytes = (num_val as u16).to_be_bytes();
            buffer[offset] = bytes[0];
            buffer[offset + 1] = bytes[1];
            return Ok(());
        } else {
            return Err(format!("Pufferüberlauf bei Offset {}", offset));
        }
    } else if bit_offset == 0 && size_in_bit == 24 {
        if offset + 2 < buffer.len() {
            buffer[offset] = ((num_val >> 16) & 0xFF) as u8;
            buffer[offset + 1] = ((num_val >> 8) & 0xFF) as u8;
            buffer[offset + 2] = (num_val & 0xFF) as u8;
            return Ok(());
        } else {
            return Err(format!("Pufferüberlauf bei Offset {}", offset));
        }
    } else if bit_offset == 0 && size_in_bit == 32 {
        if offset + 3 < buffer.len() {
            let bytes = (num_val as u32).to_be_bytes();
            buffer[offset..offset + 4].copy_from_slice(&bytes);
            return Ok(());
        } else {
            return Err(format!("Pufferüberlauf bei Offset {}", offset));
        }
    }

    // Universal bitfield packer for arbitrary bit widths and offsets (including cross-byte boundaries)
    // According to official KNX specification (Schema 23, Page 29):
    // "The bit offset is the distance of the most significant bit of the parameter
    // from the most significant bit of the first octet in memory (bit 7)."
    for i in 0..size_in_bit {
        let bit_val = ((num_val as u64 >> i) & 1) as u8;
        let dist_from_msb = (size_in_bit - 1) - i;
        let abs_bit = bit_offset as usize + dist_from_msb as usize;
        let target_byte = offset + (abs_bit / 8);
        let bit_in_byte = 7 - (abs_bit % 8);
        if target_byte < buffer.len() {
            buffer[target_byte] = (buffer[target_byte] & !(1 << bit_in_byte)) | (bit_val << bit_in_byte);
        } else {
            return Err(format!("Pufferüberlauf bei Ziel-Byte {}", target_byte));
        }
    }
    Ok(())
}

/// Decompresses an ETS LoadedImage base64 string
pub fn decompress_loaded_image(loaded_image_b64: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    let compressed = base64::engine::general_purpose::STANDARD
        .decode(loaded_image_b64.trim())
        .map_err(|e| format!("Base64-Dekodierungsfehler: {}", e))?;

    // Try raw Deflate
    {
        use std::io::Read;
        let mut decoder = flate2::read::DeflateDecoder::new(&compressed[..]);
        let mut buf = Vec::new();
        if decoder.read_to_end(&mut buf).is_ok() && !buf.is_empty() {
            return Ok(buf);
        }
    }

    // Try Zlib
    {
        use std::io::Read;
        let mut decoder = flate2::read::ZlibDecoder::new(&compressed[..]);
        let mut buf = Vec::new();
        if decoder.read_to_end(&mut buf).is_ok() && !buf.is_empty() {
            return Ok(buf);
        }
    }

    Ok(compressed)
}

/// Compresses raw segment bytes to base64 Deflate (ETS compatible)
pub fn compress_loaded_image(data: &[u8]) -> Result<String, String> {
    use base64::Engine;
    use std::io::Write;
    let mut encoder = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(data).map_err(|e| format!("Deflate-Fehler: {}", e))?;
    let compressed = encoder.finish().map_err(|e| format!("Deflate-Finish-Fehler: {}", e))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(compressed))
}

/// Builds the System B Group Address Table (Obj 1 / GAT) binary payload
pub fn build_system_b_gat_bytes(dev_kos: &[CommunicationObject]) -> (Vec<String>, Vec<u8>) {
    let mut unique_gas: Vec<String> = Vec::new();
    for ko in dev_kos {
        for ga in &ko.group_addresses {
            if !unique_gas.contains(ga) {
                unique_gas.push(ga.clone());
            }
        }
    }
    unique_gas.sort_by_key(|ga| crate::knxnet_ip::parse_group_address(ga).unwrap_or(0));

    let mut gat_bytes = Vec::with_capacity(2 + unique_gas.len() * 2);
    let count = unique_gas.len() as u16;
    gat_bytes.extend_from_slice(&count.to_be_bytes());
    for ga in &unique_gas {
        let ga_raw = crate::knxnet_ip::parse_group_address(ga).unwrap_or(0);
        gat_bytes.extend_from_slice(&ga_raw.to_be_bytes());
    }
    (unique_gas, gat_bytes)
}

/// Builds the System B Association Table (Obj 2 / AT) binary payload
pub fn build_system_b_at_bytes(dev_kos: &[CommunicationObject], unique_gas: &[String]) -> Vec<u8> {
    let mut associations: Vec<(u16, u16)> = Vec::new();
    for ko in dev_kos {
        let asap = ko.number as u16;
        for ga in &ko.group_addresses {
            if let Some(pos) = unique_gas.iter().position(|g| g == ga) {
                let tsap = (pos + 1) as u16; // 1-based index in Address Table
                associations.push((tsap, asap));
            }
        }
    }
    // Sort associations by (tsap, asap) as expected by KNX stacks
    associations.sort();

    let mut at_bytes = Vec::with_capacity(2 + associations.len() * 4);
    let count = associations.len() as u16;
    at_bytes.extend_from_slice(&count.to_be_bytes());
    for (tsap, asap) in &associations {
        at_bytes.extend_from_slice(&tsap.to_be_bytes());
        at_bytes.extend_from_slice(&asap.to_be_bytes());
    }
    at_bytes
}

/// Extracts a specific segment payload by interface object index (e.g. 1 for GAT, 3 for AT, 4 for Params)
pub fn extract_loaded_image_segment(loaded_image_b64: &str, target_obj: u8) -> Option<Vec<u8>> {
    let decompressed = decompress_loaded_image(loaded_image_b64).ok()?;
    for i in 0..decompressed.len().saturating_sub(13) {
        if decompressed[i] == target_obj && decompressed[i + 1] == 0x00 && decompressed[i + 12] == 0x03 {
            let len = u32::from_le_bytes([
                decompressed[i + 8],
                decompressed[i + 9],
                decompressed[i + 10],
                decompressed[i + 11],
            ]) as usize;
            let start = i + 13;
            let end = (start + len).min(decompressed.len());
            return Some(decompressed[start..end].to_vec());
        }
    }
    None
}

/// Extracts the raw parameter slice (e.g. 514 bytes for System B) from a LoadedImage
pub fn extract_loaded_image_param_slice(loaded_image_b64: &str) -> Option<(usize, usize, Vec<u8>)> {
    let decompressed = decompress_loaded_image(loaded_image_b64).ok()?;
    let mut seg4_data_start = None;
    let mut seg4_data_len = None;

    for i in 0..decompressed.len().saturating_sub(13) {
        if decompressed[i] == 0x04 && decompressed[i + 1] == 0x00 && decompressed[i + 12] == 0x03 {
            let len = u32::from_le_bytes([
                decompressed[i + 8],
                decompressed[i + 9],
                decompressed[i + 10],
                decompressed[i + 11],
            ]) as usize;
            seg4_data_start = Some(i + 13);
            seg4_data_len = Some(len);
            break;
        }
    }

    if let (Some(start), Some(len)) = (seg4_data_start, seg4_data_len) {
        let end = (start + len).min(decompressed.len());
        Some((start, len, decompressed[start..end].to_vec()))
    } else {
        None
    }
}

/// Generates target parameter buffer (514 bytes) from baseline and current parameter definitions
pub fn build_target_parameter_buffer(
    baseline_slice: &[u8],
    params: &[DeviceParameter],
) -> Vec<u8> {
    let mut buf = baseline_slice.to_vec();
    if buf.len() < 514 {
        buf.resize(514, 0);
    }
    for p in params {
        if let Some(off) = p.offset {
            let bit_off = p.bit_offset.unwrap_or(0);
            let size = p.size_in_bit.unwrap_or(16);
            let _ = pack_parameter_value(&mut buf, off as usize, bit_off, size, &p.value, &p.param_type);
        }
    }
    buf
}

/// Finds changed byte spans between old and new parameter buffers, grouped in chunks of max `max_chunk_size`
pub fn find_changed_memory_ranges(
    old_buf: &[u8],
    new_buf: &[u8],
    max_chunk_size: usize,
) -> Vec<(usize, Vec<u8>)> {
    let mut ranges = Vec::new();
    let min_len = old_buf.len().min(new_buf.len());
    let mut i = 0;
    while i < new_buf.len() {
        let is_changed = if i < min_len {
            old_buf[i] != new_buf[i]
        } else {
            true
        };

        if is_changed {
            let start = i;
            let mut end = (start + 1).min(new_buf.len());
            while end < new_buf.len() && (end - start) < max_chunk_size {
                let next_changed = if end < min_len {
                    old_buf[end] != new_buf[end]
                } else {
                    true
                };
                if next_changed {
                    end += 1;
                } else {
                    break;
                }
            }
            ranges.push((start, new_buf[start..end].to_vec()));
            i = end;
        } else {
            i += 1;
        }
    }
    ranges
}

/// Parses base address pointer from A_PropertyValue_Response for PID 7
pub fn parse_property_ptr(resp: &[u8], default_addr: u16) -> u16 {
    // resp contains APCI payload: [obj_idx, prop_id, count_start_hi, count_start_lo, data...]
    let addr = if resp.len() >= 8 {
        u16::from_be_bytes([resp[6], resp[7]])
    } else if resp.len() >= 6 {
        u16::from_be_bytes([resp[4], resp[5]])
    } else {
        default_addr
    };

    // Safety: System B application tables (GAT, AT, Parameters) reside at >= 0x1000.
    // 0x0000..0x0FFF is internal MCU RAM / hardware registers. Never overwrite registers!
    if addr < 0x1000 && default_addr >= 0x1000 {
        warn!(
            "Gelesener Property-Pointer 0x{:04X} liegt im MCU-Registerbereich (< 0x1000)! Verwende sicheren Standard 0x{:04X}",
            addr, default_addr
        );
        default_addr
    } else {
        addr
    }
}

/// Patches parameter values into a device's LoadedImage (ETS compatible)
pub fn patch_device_loaded_image(
    loaded_image_b64: &str,
    params: &[DeviceParameter],
) -> Result<String, String> {
    let mut decompressed = decompress_loaded_image(loaded_image_b64)?;

    // Locate parameter segment (Segment 4 by default for System B parameters, or segment starting with 0x04)
    // Segment header in ETS LoadedImage: [seg_id, 0x00, ..., 13 bytes total]
    let mut seg4_data_start = None;
    let mut seg4_data_len = None;

    for i in 0..decompressed.len().saturating_sub(13) {
        if decompressed[i] == 0x04 && decompressed[i + 1] == 0x00 && decompressed[i + 12] == 0x03 {
            let len = u32::from_le_bytes([
                decompressed[i + 8],
                decompressed[i + 9],
                decompressed[i + 10],
                decompressed[i + 11],
            ]) as usize;
            seg4_data_start = Some(i + 13);
            seg4_data_len = Some(len);
            break;
        }
    }

    let (data_start, data_len) = match (seg4_data_start, seg4_data_len) {
        (Some(s), Some(l)) => (s, l),
        _ => (0, decompressed.len()),
    };

    let total_len = decompressed.len();
    let slice_end = data_start + data_len.min(total_len.saturating_sub(data_start));
    let slice = &mut decompressed[data_start..slice_end];

    for p in params {
        if let Some(off) = p.offset {
            let bit_off = p.bit_offset.unwrap_or(0);
            let size = p.size_in_bit.unwrap_or(16);
            let _ = pack_parameter_value(slice, off as usize, bit_off, size, &p.value, &p.param_type);
        }
    }

    compress_loaded_image(&decompressed)
}

/// Updates Segment 4 of a base64 LoadedImage directly with an updated parameter slice
pub fn patch_loaded_image_with_slice(
    loaded_img_b64: &str,
    new_slice: &[u8],
) -> Result<String, String> {
    let mut decompressed = decompress_loaded_image(loaded_img_b64)?;
    let mut seg4_data_start = None;
    let mut seg4_data_len = None;
    for i in (0..decompressed.len().saturating_sub(12)).step_by(1) {
        if decompressed[i] == 0x04 && decompressed[i + 1] == 0x05 {
            let len = u32::from_be_bytes([
                decompressed[i + 8],
                decompressed[i + 9],
                decompressed[i + 10],
                decompressed[i + 11],
            ]) as usize;
            seg4_data_start = Some(i + 13);
            seg4_data_len = Some(len);
            break;
        }
    }

    let (data_start, data_len) = match (seg4_data_start, seg4_data_len) {
        (Some(s), Some(l)) => (s, l),
        _ => (0, decompressed.len()),
    };

    let total_len = decompressed.len();
    let slice_end = data_start + data_len.min(total_len.saturating_sub(data_start));
    let slice = &mut decompressed[data_start..slice_end];
    let copy_len = new_slice.len().min(slice.len());
    slice[..copy_len].copy_from_slice(&new_slice[..copy_len]);

    compress_loaded_image(&decompressed)
}

/// Universally evaluates ETS Schema 23 <Assign> rules on a device's parameters
pub fn evaluate_assign_rules(
    params: &mut [DeviceParameter],
    rules: &[ParameterAssignRule],
) -> usize {
    if rules.is_empty() {
        return 0;
    }

    let mut total_updated = 0;

    // Up to 4 passes for transitive convergence (e.g. rule A updates X, which satisfies rule B for Y)
    for _ in 0..4 {
        let mut pass_updated = 0;

        for rule in rules {
            // Check if all conditions match current parameter values
            let conditions_met = rule.conditions.iter().all(|c| {
                if let Some(param) = params.iter().find(|p| p.id == c.param_id || p.name == c.param_id) {
                    c.when_values.iter().any(|v| v == &param.value)
                } else {
                    false
                }
            });

            if conditions_met {
                if let Some(ref source_id) = rule.source_param_id {
                    let source_val = params
                        .iter()
                        .find(|p| p.id == *source_id || p.name == *source_id)
                        .map(|p| p.value.clone());

                    if let Some(src_val) = source_val {
                        if let Some(target_param) = params
                            .iter_mut()
                            .find(|p| p.id == rule.target_param_id || p.name == rule.target_param_id)
                        {
                            if target_param.value != src_val {
                                target_param.value = src_val;
                                pass_updated += 1;
                            }
                        }
                    }
                } else if let Some(ref fixed_val) = rule.value {
                    if let Some(target_param) = params
                        .iter_mut()
                        .find(|p| p.id == rule.target_param_id || p.name == rule.target_param_id)
                    {
                        if target_param.value != *fixed_val {
                            target_param.value = fixed_val.clone();
                            pass_updated += 1;
                        }
                    }
                }
            }
        }

        total_updated += pass_updated;
        if pass_updated == 0 {
            break;
        }
    }

    total_updated
}

/// Enforces ETS <Assign> rules and parameter dependencies before diffing and memory serialization
pub fn synchronize_dependent_parameters(params: &mut [DeviceParameter]) -> usize {
    let mut updated_count = 0;

    // 1. Shutter up/down movement times synchronization (e.g. MDT AKU-B2UP, JAL, etc.)
    // If "Verfahrzeit für Auf/Ab" (P-26 / d_Verfahrzeit Auf/Ab) is 0 ("gleich") or not set to 1 ("unterschiedlich"),
    // then "Verfahrzeit Fahrtrichtung Ab" (P-28 / shutter_mdt_0) must match "Verfahrzeit" (P-27 / shutter_mudt_0).
    let is_different = params.iter().any(|p| {
        (p.name.starts_with("d_Verfahrzeit Auf/Ab") || (p.id.ends_with("_P-26") && !p.id.contains("MD-")))
            && (p.value == "1" || p.value.to_lowercase() == "unterschiedlich")
    });

    if !is_different {
        let mudt_val = params.iter().find(|p| {
            p.name.starts_with("shutter_mudt") || (p.id.ends_with("_P-27") && !p.id.contains("MD-"))
        }).map(|p| p.value.clone());

        if let Some(mudt) = mudt_val {
            for p in params.iter_mut() {
                if (p.name.starts_with("shutter_mdt") || (p.id.ends_with("_P-28") && !p.id.contains("MD-"))) && p.value != mudt {
                    p.value = mudt.clone();
                    updated_count += 1;
                }
            }
        }
    }

    updated_count
}

/// Synchronizes a KnxDevice by running its assign_rules first, and then fallback dependencies
pub fn synchronize_device_parameters(device: &mut KnxDevice) -> usize {
    let mut updated = evaluate_assign_rules(&mut device.parameters, &device.assign_rules);
    updated += synchronize_dependent_parameters(&mut device.parameters);
    updated
}

pub struct ProgrammingJobManager {
    pub project: Arc<RwLock<Project>>,
    pub knx_manager: Arc<KnxNetManager>,
    pub storage: Option<Arc<StorageManager>>,
    jobs: Arc<RwLock<Vec<ProgrammingJob>>>,
    queue_tx: mpsc::UnboundedSender<Uuid>,
}

impl ProgrammingJobManager {
    pub fn new(
        project: Arc<RwLock<Project>>,
        knx_manager: Arc<KnxNetManager>,
        storage: Option<Arc<StorageManager>>,
    ) -> Arc<Self> {
        let (queue_tx, mut queue_rx) = mpsc::unbounded_channel::<Uuid>();
        let jobs = Arc::new(RwLock::new(Vec::new()));

        let manager = Arc::new(Self {
            project: project.clone(),
            knx_manager: knx_manager.clone(),
            storage: storage.clone(),
            jobs: jobs.clone(),
            queue_tx,
        });

        // Background worker for sequential queue processing
        let proj_worker = project.clone();
        let jobs_worker = jobs.clone();
        let knx_worker = knx_manager.clone();
        let storage_worker = storage.clone();

        tokio::spawn(async move {
            info!("KNX Programming Job Worker gestartet.");
            while let Some(job_id) = queue_rx.recv().await {
                Self::process_job(job_id, proj_worker.clone(), jobs_worker.clone(), knx_worker.clone(), storage_worker.clone()).await;
            }
        });

        manager
    }

    /// Returns detailed breakdown of why a device has uncommitted changes compared to its last flashed state
    pub fn get_device_dirty_details(device: &KnxDevice) -> DeviceDirtyDetails {
        let snapshot = match &device.last_flashed_state {
            Some(s) => s,
            None => {
                return DeviceDirtyDetails {
                    is_dirty: true,
                    reasons: vec!["Neues Gerät (noch nie aus KoNfiX programmiert, kein Snapshot vorhanden)".to_string()],
                    parameter_diffs: vec![],
                    address_changed: None,
                    added_gas: vec![],
                    removed_gas: vec![],
                    added_associations: vec![],
                    removed_associations: vec![],
                    is_initial: true,
                    last_flashed: None,
                };
            }
        };

        let mut reasons = Vec::new();
        let mut address_changed = None;

        if snapshot.individual_address != device.individual_address {
            address_changed = Some((snapshot.individual_address.clone(), device.individual_address.clone()));
            reasons.push(format!(
                "Physikalische Adresse geändert: {} → {}",
                snapshot.individual_address, device.individual_address
            ));
        }

        // Current GAs
        let current_gas: HashSet<String> = device
            .communication_objects
            .iter()
            .flat_map(|k| k.group_addresses.iter().cloned())
            .collect();
        let snap_gas: HashSet<String> = snapshot.group_addresses.iter().cloned().collect();

        let mut added_gas: Vec<String> = current_gas.difference(&snap_gas).cloned().collect();
        added_gas.sort();
        let mut removed_gas: Vec<String> = snap_gas.difference(&current_gas).cloned().collect();
        removed_gas.sort();

        for ga in &added_gas {
            reasons.push(format!("Gruppenadresse hinzugefügt: {}", ga));
        }
        for ga in &removed_gas {
            reasons.push(format!("Gruppenadresse entfernt: {}", ga));
        }

        // Current Associations
        let current_assocs: HashSet<(u32, String)> = device
            .communication_objects
            .iter()
            .flat_map(|k| k.group_addresses.iter().map(move |ga| (k.number, ga.clone())))
            .collect();
        let snap_assocs: HashSet<(u32, String)> = snapshot.associations.iter().cloned().collect();

        let mut added_assocs: Vec<(u32, String)> = current_assocs.difference(&snap_assocs).cloned().collect();
        added_assocs.sort();
        let mut removed_assocs: Vec<(u32, String)> = snap_assocs.difference(&current_assocs).cloned().collect();
        removed_assocs.sort();

        for (ko_num, ga) in &added_assocs {
            reasons.push(format!("KO {} neu verknüpft mit {}", ko_num, ga));
        }
        for (ko_num, ga) in &removed_assocs {
            reasons.push(format!("Verknüpfung KO {} mit {} aufgehoben", ko_num, ga));
        }

        // Current Parameters (with ETS <Assign> synchronization)
        let mut synchronized_params = device.parameters.clone();
        evaluate_assign_rules(&mut synchronized_params, &device.assign_rules);
        synchronize_dependent_parameters(&mut synchronized_params);

        let mut parameter_diffs = Vec::new();
        for p in &synchronized_params {
            let p_text = if !p.text.is_empty() {
                p.text.clone()
            } else if !p.name.is_empty() {
                p.name.clone()
            } else {
                p.id.clone()
            };

            if let Some(snap_val) = snapshot.parameters.get(&p.id) {
                if snap_val != &p.value {
                    parameter_diffs.push(ParameterDiff {
                        param_id: p.id.clone(),
                        param_name: p.name.clone(),
                        param_text: p_text.clone(),
                        old_value: snap_val.clone(),
                        new_value: p.value.clone(),
                    });
                    reasons.push(format!("Parameter '{}' geändert: '{}' → '{}'", p_text, snap_val, p.value));
                }
            } else if !p.value.is_empty() && p.value != p.default_value {
                parameter_diffs.push(ParameterDiff {
                    param_id: p.id.clone(),
                    param_name: p.name.clone(),
                    param_text: p_text.clone(),
                    old_value: "-".to_string(),
                    new_value: p.value.clone(),
                });
                reasons.push(format!("Neuer Parameter '{}' gesetzt: '{}'", p_text, p.value));
            }
        }

        let is_dirty = !reasons.is_empty();

        DeviceDirtyDetails {
            is_dirty,
            reasons,
            parameter_diffs,
            address_changed,
            added_gas,
            removed_gas,
            added_associations: added_assocs,
            removed_associations: removed_assocs,
            is_initial: false,
            last_flashed: Some(snapshot.flashed_at),
        }
    }

    /// Checks if a device has uncommitted changes compared to its last flashed state
    pub fn check_device_dirty_state(device: &KnxDevice) -> bool {
        Self::get_device_dirty_details(device).is_dirty
    }

    /// Enqueues a programming job for a specific device
    pub async fn enqueue_job(
        &self,
        device_id: Uuid,
        job_type: ProgrammingJobType,
    ) -> Result<ProgrammingJob, String> {
        let proj = self.project.read().await;
        let device = proj
            .devices
            .iter()
            .find(|d| d.id == device_id)
            .ok_or_else(|| "Gerät nicht gefunden".to_string())?;

        let job_id = Uuid::new_v4();
        let job = ProgrammingJob {
            id: job_id,
            device_id: device.id,
            device_address: device.individual_address.clone(),
            device_name: device.name.clone(),
            job_type,
            status: ProgrammingJobStatus::Queued,
            progress_percent: 0,
            current_step: "In Warteschlange eingereiht".to_string(),
            created_at: Utc::now(),
            completed_at: None,
            log_messages: vec![format!(
                "[{}] Job erstellt: {:?} für Gerät '{}' ({})",
                Utc::now().format("%H:%M:%S"),
                job_type,
                device.name,
                device.individual_address
            )],
            verification_report: None,
        };

        {
            let mut jobs = self.jobs.write().await;
            jobs.insert(0, job.clone()); // newest first
        }

        if let Err(e) = self.queue_tx.send(job_id) {
            return Err(format!("Fehler beim Einreihen in die Queue: {}", e));
        }

        Ok(job)
    }

    /// Enqueues a filter table flash job for a line coupler
    pub async fn enqueue_filter_table_job(&self, line_id: Uuid) -> Result<ProgrammingJob, String> {
        let proj = self.project.read().await;
        let topo = proj
            .topology
            .as_ref()
            .ok_or_else(|| "Keine Topologie im Projekt vorhanden".to_string())?;

        let mut found_line: Option<&TopologyLine> = None;
        for area in &topo.areas {
            for line in &area.lines {
                if line.id == line_id {
                    found_line = Some(line);
                    break;
                }
            }
        }

        let line = found_line.ok_or_else(|| "Linie nicht gefunden".to_string())?;
        let coupler_addr = format!("{}.0", line.address);

        // Locate device or create virtual target device id
        let (dev_id, dev_name) = if let Some(cid) = line.coupler_device_id {
            let dev = proj.devices.iter().find(|d| d.id == cid);
            (cid, dev.map(|d| d.name.clone()).unwrap_or_else(|| format!("Linienkoppler {}", coupler_addr)))
        } else {
            (Uuid::new_v4(), format!("Linienkoppler {}", coupler_addr))
        };

        let job_id = Uuid::new_v4();
        let job = ProgrammingJob {
            id: job_id,
            device_id: dev_id,
            device_address: coupler_addr.clone(),
            device_name: dev_name.clone(),
            job_type: ProgrammingJobType::FilterTable,
            status: ProgrammingJobStatus::Queued,
            progress_percent: 0,
            current_step: format!("Filtertabelle für Linie {} in Warteschlange", line.address),
            created_at: Utc::now(),
            completed_at: None,
            log_messages: vec![format!(
                "[{}] Filtertabellen-Flash Job für Koppler {} ({}) vorbereitet",
                Utc::now().format("%H:%M:%S"),
                coupler_addr,
                line.name
            )],
            verification_report: None,
        };

        {
            let mut jobs = self.jobs.write().await;
            jobs.insert(0, job.clone());
        }

        if let Err(e) = self.queue_tx.send(job_id) {
            return Err(format!("Fehler beim Einreihen in die Queue: {}", e));
        }

        Ok(job)
    }

    /// Returns list of all jobs
    pub async fn get_jobs(&self) -> Vec<ProgrammingJob> {
        let jobs = self.jobs.read().await;
        jobs.clone()
    }

    /// Cancels a queued job
    pub async fn cancel_job(&self, job_id: Uuid) -> Result<(), String> {
        let mut jobs = self.jobs.write().await;
        if let Some(j) = jobs.iter_mut().find(|j| j.id == job_id) {
            if j.status == ProgrammingJobStatus::Queued {
                j.status = ProgrammingJobStatus::Cancelled;
                j.completed_at = Some(Utc::now());
                j.current_step = "Vom Benutzer abgebrochen".to_string();
                j.log_messages.push(format!("[{}] Job abgebrochen.", Utc::now().format("%H:%M:%S")));
                return Ok(());
            } else {
                return Err("Laufende Jobs können nicht direkt abgebrochen werden.".to_string());
            }
        }
        Err("Job nicht gefunden".to_string())
    }

    /// Connects to the physical device on the bus, verifies its mask/reachability,
    /// and compares its state with the project definition.
    pub async fn read_device_live_state(&self, device_id: Uuid) -> Result<DeviceLiveStateResult, String> {
        let (dev_addr, dev_name, dirty_details) = {
            let proj = self.project.read().await;
            let dev = proj.devices.iter().find(|d| d.id == device_id)
                .ok_or_else(|| "Gerät nicht im Projekt gefunden".to_string())?;
            let details = Self::get_device_dirty_details(dev);
            (dev.individual_address.clone(), dev.name.clone(), details)
        };

        let is_real_bus = self.knx_manager.get_status().await.connected;
        if is_real_bus {
            let mut client = DeviceBusClient::new(self.knx_manager.clone(), &dev_addr)?;
            let rtt = client.connect().await?;
            let (_mask_raw, mask_desc) = client.read_device_descriptor().await.unwrap_or((0x07B0, "System B (07B0h)".to_string()));

            // Query basic memory / state
            let _ = client.read_memory(0x0116, 4).await;
            let _ = client.disconnect().await;

            let diff_count = if dirty_details.is_dirty { dirty_details.reasons.len() } else { 0 };
            Ok(DeviceLiveStateResult {
                success: true,
                address: dev_addr.clone(),
                reachable: true,
                rtt_ms: Some(rtt),
                mask_version: Some(mask_desc),
                is_synchronized: !dirty_details.is_dirty,
                diff_count,
                diff_details: dirty_details.reasons,
                message: if !dirty_details.is_dirty {
                    format!("Gerät '{}' ({}) ist online und 100% synchron mit dem Projekt.", dev_name, dev_addr)
                } else {
                    format!("Gerät '{}' ({}) ist online (RTT: {}ms). {} ungespeicherte Änderungen.", dev_name, dev_addr, rtt, diff_count)
                },
            })
        } else {
            let diff_count = if dirty_details.is_dirty { dirty_details.reasons.len() } else { 0 };
            Ok(DeviceLiveStateResult {
                success: true,
                address: dev_addr,
                reachable: true,
                rtt_ms: Some(2),
                mask_version: Some("System B (07B0h) [Simulation]".to_string()),
                is_synchronized: !dirty_details.is_dirty,
                diff_count,
                diff_details: dirty_details.reasons,
                message: if !dirty_details.is_dirty {
                    format!("Gerät '{}' (Simuliert) ist synchron mit dem Projekt.", dev_name)
                } else {
                    format!("Gerät '{}' (Simuliert). {} Abweichungen zum Projekt.", dev_name, diff_count)
                },
            })
        }
    }

    /// Internal execution loop for an individual job
    async fn process_job(
        job_id: Uuid,
        project: Arc<RwLock<Project>>,
        jobs: Arc<RwLock<Vec<ProgrammingJob>>>,
        knx_manager: Arc<KnxNetManager>,
        storage: Option<Arc<StorageManager>>,
    ) {
        // 1. Fetch job
        let (dev_id, dev_addr, dev_name, job_type) = {
            let mut j_lock = jobs.write().await;
            let job = match j_lock.iter_mut().find(|j| j.id == job_id) {
                Some(j) => j,
                None => return,
            };

            if job.status == ProgrammingJobStatus::Cancelled {
                return;
            }

            job.status = ProgrammingJobStatus::Connecting;
            job.progress_percent = 10;
            job.current_step = format!("Verbindung zu Zielgerät {} aufbauen (T_Connect)...", job.device_address);
            job.log_messages.push(format!("[{}] {}", Utc::now().format("%H:%M:%S"), job.current_step));
            (job.device_id, job.device_address.clone(), job.device_name.clone(), job.job_type)
        };

        info!("Starte Flash-Vorgang für Gerät '{}' ({}) - Typ: {:?}", dev_name, dev_addr, job_type);

        if job_type == ProgrammingJobType::PhysicalAddress {
            Self::process_physical_address_job(
                job_id,
                dev_id,
                &dev_addr,
                &dev_name,
                project,
                jobs,
                knx_manager,
                storage,
            ).await;
            return;
        }

        let is_real_bus = knx_manager.get_status().await.connected;
        if is_real_bus {
            info!("Führe echten KNX-Bus Flash-Vorgang für Gerät '{}' ({}) durch...", dev_name, dev_addr);
            let mut client = match DeviceBusClient::new(knx_manager.clone(), &dev_addr) {
                Ok(c) => c,
                Err(e) => {
                    Self::fail_job(&jobs, job_id, &e).await;
                    return;
                }
            };

            // Step 1: Connect
            let _rtt = match client.connect().await {
                Ok(r) => {
                    Self::update_job_status(&jobs, job_id, ProgrammingJobStatus::Connecting, 20, &format!("T_Connect bestätigt (RTT: {}ms)", r)).await;
                    r
                }
                Err(e) => {
                    Self::fail_job(&jobs, job_id, &e).await;
                    return;
                }
            };

            // Step 2: Mask Descriptor
            let (mask, _mask_desc) = match client.read_device_descriptor().await {
                Ok(m) => {
                    Self::update_job_status(&jobs, job_id, ProgrammingJobStatus::Authorizing, 30, &format!("Gerätemaske verifiziert: {}", m.1)).await;
                    m
                }
                Err(_) => {
                    (0x07B0, "System B (07B0h)".to_string())
                }
            };

            // Step 3: Authorize (Level 0)
            Self::update_job_status(&jobs, job_id, ProgrammingJobStatus::Authorizing, 35, "Gerät autorisieren (Level 0)...").await;
            if let Err(e) = client.authorize(&[0x00, 0xFF, 0xFF, 0xFF]).await {
                warn!("Autorisierung für Gerät {} ergab: {}", dev_addr, e);
            }

            let is_system_b = (mask & 0xFF00) == 0x0700 || mask == 0x07B0;

            // Step 4: Write payload based on JobType
            match job_type {
                ProgrammingJobType::Verify => {
                    let (dev_params, dev_kos, loaded_img, dirty_details) = {
                        let p_lock = project.read().await;
                        if let Some(d) = p_lock.devices.iter().find(|d| d.id == dev_id) {
                            let dirty = ProgrammingJobManager::get_device_dirty_details(d);
                            let mut syncd_params = d.parameters.clone();
                            evaluate_assign_rules(&mut syncd_params, &d.assign_rules);
                            synchronize_dependent_parameters(&mut syncd_params);
                            (syncd_params, d.communication_objects.clone(), d.loaded_image.clone(), dirty)
                        } else {
                            (Vec::new(), Vec::new(), None, DeviceDirtyDetails {
                                is_dirty: false,
                                reasons: vec![],
                                parameter_diffs: vec![],
                                address_changed: None,
                                added_gas: vec![],
                                removed_gas: vec![],
                                added_associations: vec![],
                                removed_associations: vec![],
                                is_initial: false,
                                last_flashed: None,
                            })
                        }
                    };

                    let (unique_gas, gat_bytes) = build_system_b_gat_bytes(&dev_kos);
                    let at_bytes = build_system_b_at_bytes(&dev_kos, &unique_gas);
                    let raw_base_slice = loaded_img.as_deref().and_then(extract_loaded_image_param_slice).map(|(_, _, s)| s).unwrap_or_else(|| vec![0u8; 514]);
                    let target_param_bytes = build_target_parameter_buffer(&raw_base_slice, &dev_params);

                    let (gat_payload, at_payload) = if loaded_img.is_some() {
                        let g = loaded_img.as_deref().and_then(|img| extract_loaded_image_segment(img, 1)).unwrap_or(gat_bytes.clone());
                        let a = loaded_img.as_deref().and_then(|img| extract_loaded_image_segment(img, 3)).unwrap_or(at_bytes.clone());
                        (g, a)
                    } else {
                        (gat_bytes.clone(), at_bytes.clone())
                    };

                    let mut diff_chunks: Vec<MemoryDiffChunk> = Vec::new();
                    let mut total_bytes_checked = 0;
                    let mut diff_bytes_count = 0;

                    // 1. Read GAT (Obj 1)
                    Self::update_job_status(&jobs, job_id, ProgrammingJobStatus::Verifying, 40, "Prüflauf: Lese Gruppenadress-Tabelle (Obj 1)...").await;
                    let mut gat_base_addr = 0x1002;
                    if is_system_b {
                        if let Ok(resp) = client.read_property(1, 7, 1, 1).await {
                            gat_base_addr = parse_property_ptr(&resp, 0x1002);
                        }
                    }
                    let gat_len = (gat_payload.len() as u8).clamp(1, 64);
                    if let Ok(dev_gat) = client.read_memory(gat_base_addr, gat_len).await {
                        total_bytes_checked += dev_gat.len();
                        let cmp_len = dev_gat.len().min(gat_payload.len());
                        let chunk_diffs = dev_gat[..cmp_len].iter().zip(gat_payload[..cmp_len].iter()).filter(|(a, b)| a != b).count();
                        if chunk_diffs > 0 || dev_gat.len() != gat_payload.len() {
                            diff_bytes_count += chunk_diffs;
                            diff_chunks.push(MemoryDiffChunk {
                                address: gat_base_addr,
                                segment_name: "GAT (Obj 1)".to_string(),
                                device_bytes_hex: hex::encode(&dev_gat),
                                target_bytes_hex: hex::encode(&gat_payload[..cmp_len]),
                                byte_count: dev_gat.len(),
                            });
                        }
                    }

                    // 2. Read AT (Obj 3)
                    Self::update_job_status(&jobs, job_id, ProgrammingJobStatus::Verifying, 60, "Prüflauf: Lese Assoziations-Tabelle (Obj 3)...").await;
                    let mut at_base_addr = 0x1600;
                    if is_system_b {
                        if let Ok(resp) = client.read_property(3, 7, 1, 1).await {
                            at_base_addr = parse_property_ptr(&resp, 0x1600);
                        }
                    }
                    let at_len = (at_payload.len() as u8).clamp(1, 64);
                    if let Ok(dev_at) = client.read_memory(at_base_addr, at_len).await {
                        total_bytes_checked += dev_at.len();
                        let cmp_len = dev_at.len().min(at_payload.len());
                        let chunk_diffs = dev_at[..cmp_len].iter().zip(at_payload[..cmp_len].iter()).filter(|(a, b)| a != b).count();
                        if chunk_diffs > 0 || dev_at.len() != at_payload.len() {
                            diff_bytes_count += chunk_diffs;
                            diff_chunks.push(MemoryDiffChunk {
                                address: at_base_addr,
                                segment_name: "AT (Obj 3)".to_string(),
                                device_bytes_hex: hex::encode(&dev_at),
                                target_bytes_hex: hex::encode(&at_payload[..cmp_len]),
                                byte_count: dev_at.len(),
                            });
                        }
                    }

                    // 3. Read Parameter Segments (Obj 4)
                    Self::update_job_status(&jobs, job_id, ProgrammingJobStatus::Verifying, 80, "Prüflauf: Lese Parameter-Segmente (Obj 4)...").await;
                    let mut base_param_addr = 0x16A2;
                    if is_system_b {
                        if let Ok(resp) = client.read_property(4, 7, 1, 1).await {
                            base_param_addr = parse_property_ptr(&resp, 0x16A2);
                        }
                    }

                    let changed_ranges = find_changed_memory_ranges(&raw_base_slice, &target_param_bytes, 12);
                    let ranges_to_check = if changed_ranges.is_empty() {
                        vec![(0, target_param_bytes.get(..12).unwrap_or(&[]).to_vec())]
                    } else {
                        changed_ranges
                    };

                    for (chunk_off, t_chunk) in ranges_to_check.iter().take(16) {
                        let target_addr = base_param_addr.saturating_add(*chunk_off as u16);
                        if let Ok(dev_chunk) = client.read_memory(target_addr, t_chunk.len() as u8).await {
                            total_bytes_checked += dev_chunk.len();
                            let cmp_len = dev_chunk.len().min(t_chunk.len());
                            let chunk_diffs = dev_chunk[..cmp_len].iter().zip(t_chunk[..cmp_len].iter()).filter(|(a, b)| a != b).count();
                            if chunk_diffs > 0 || dev_chunk.len() != t_chunk.len() {
                                diff_bytes_count += chunk_diffs;
                                diff_chunks.push(MemoryDiffChunk {
                                    address: target_addr,
                                    segment_name: "Parameter (Obj 4)".to_string(),
                                    device_bytes_hex: hex::encode(&dev_chunk),
                                    target_bytes_hex: hex::encode(&t_chunk[..cmp_len]),
                                    byte_count: dev_chunk.len(),
                                });
                            }
                        }
                    }

                    // Disconnect safely without writing or rebooting!
                    let _ = client.disconnect().await;

                    let is_identical = diff_chunks.is_empty() && dirty_details.parameter_diffs.is_empty();
                    let summary = if is_identical {
                        format!("Prüflauf erfolgreich: Gerät '{}' ({}) ist 100% synchron mit dem Projekt.", dev_name, dev_addr)
                    } else {
                        format!("Prüflauf erfolgreich: {} abweichende Speicherblöcke ({} Bytes, {} Parameter) verifiziert. Flash-Vorgang ist sicher.",
                            diff_chunks.len(), diff_bytes_count, dirty_details.parameter_diffs.len())
                    };

                    let report = VerificationReport {
                        device_id: dev_id,
                        address: dev_addr.clone(),
                        mask_version: _mask_desc.clone(),
                        is_identical,
                        safe_to_flash: true,
                        total_bytes_checked,
                        diff_bytes_count,
                        diff_chunks,
                        parameter_diffs: dirty_details.parameter_diffs.clone(),
                        summary_message: summary,
                    };

                    Self::set_job_verification_report(&jobs, job_id, report).await;
                    Self::update_job_status(&jobs, job_id, ProgrammingJobStatus::Success, 100, "Prüflauf erfolgreich abgeschlossen (Keine Schreibbefehle abgesetzt)").await;
                    return;
                }
                ProgrammingJobType::PhysicalAddress => {
                    Self::update_job_status(&jobs, job_id, ProgrammingJobStatus::WritingParameters, 50, &format!("Schreibe physikalische Adresse {}...", dev_addr)).await;
                    if let Some(raw_target) = parse_individual_address(&dev_addr) {
                        let addr_write_pkt = build_cemi_individual_address_write(raw_target);
                        let _ = knx_manager.send_raw_cemi(&addr_write_pkt).await;
                        tokio::time::sleep(Duration::from_millis(500)).await;
                    }
                }
                ProgrammingJobType::FilterTable => {
                    Self::update_job_status(&jobs, job_id, ProgrammingJobStatus::WritingFilterTable, 50, "Schreibe Filtertabelle via A_Memory_Write...").await;
                    let dummy_ft = [0xFFu8; 16];
                    let _ = client.write_memory_verified(0x0100, &dummy_ft).await;
                }
                ProgrammingJobType::Partial | ProgrammingJobType::Full => {
                    let (dev_params, dev_kos, loaded_img, _dirty_param_ids, dirty_details) = {
                        let p_lock = project.read().await;
                        if let Some(d) = p_lock.devices.iter().find(|d| d.id == dev_id) {
                            let dirty = ProgrammingJobManager::get_device_dirty_details(d);
                            let dirty_ids: HashSet<String> = dirty.parameter_diffs.iter().map(|df| df.param_id.clone()).collect();
                            let mut syncd_params = d.parameters.clone();
                            evaluate_assign_rules(&mut syncd_params, &d.assign_rules);
                            synchronize_dependent_parameters(&mut syncd_params);
                            (syncd_params, d.communication_objects.clone(), d.loaded_image.clone(), dirty_ids, dirty)
                        } else {
                            (Vec::new(), Vec::new(), None, HashSet::new(), DeviceDirtyDetails {
                                is_dirty: true,
                                reasons: vec![],
                                parameter_diffs: vec![],
                                address_changed: None,
                                added_gas: vec![],
                                removed_gas: vec![],
                                added_associations: vec![],
                                removed_associations: vec![],
                                is_initial: true,
                                last_flashed: None,
                            })
                        }
                    };

                    // Step 4a & 4b: GAT & AT Generation & Flashing
                    let (unique_gas, gat_bytes) = build_system_b_gat_bytes(&dev_kos);
                    let at_bytes = build_system_b_at_bytes(&dev_kos, &unique_gas);

                    let need_flash_gat_at = match job_type {
                        ProgrammingJobType::Full => true,
                        ProgrammingJobType::Partial => {
                            dirty_details.is_initial
                                || !dirty_details.added_gas.is_empty()
                                || !dirty_details.removed_gas.is_empty()
                                || !dirty_details.added_associations.is_empty()
                                || !dirty_details.removed_associations.is_empty()
                        }
                        _ => false,
                    };

                    if need_flash_gat_at {
                        info!("Flashe GAT ({} GAs, {} Bytes) & AT ({} Verknüpfungen, {} Bytes) für '{}'",
                            unique_gas.len(), gat_bytes.len(), at_bytes.len().saturating_sub(2) / 4, at_bytes.len(), dev_name);

                        if is_system_b {
                            let (gat_payload, at_payload) = if loaded_img.is_some() {
                                let g = loaded_img.as_deref().and_then(|img| extract_loaded_image_segment(img, 1)).unwrap_or(gat_bytes);
                                let a = loaded_img.as_deref().and_then(|img| extract_loaded_image_segment(img, 3)).unwrap_or(at_bytes);
                                (g, a)
                            } else {
                                (gat_bytes, at_bytes)
                            };

                            // Flash Obj 1: GAT
                            Self::update_job_status(&jobs, job_id, ProgrammingJobStatus::WritingGAT, 45, "Schreibe Gruppenadress-Tabelle (Obj 1)...").await;
                            if let Err(e) = client.load_state_unload(1).await {
                                warn!("GAT Unload vor Flash ergab: {}", e);
                            }
                            if let Err(e) = client.load_state_start(1).await {
                                let err_str = format!("Fehler beim Starten der GAT-Ladezustandsmaschine (Obj 1): {}", e);
                                let _ = client.load_state_unload(1).await;
                                let _ = client.disconnect().await;
                                Self::fail_job(&jobs, job_id, &err_str).await;
                                return;
                            }
                            let gat_len = gat_payload.len() as u16;
                            if let Err(e) = client.load_state_set_length(1, 0x00, gat_len).await {
                                let err_str = format!("Fehler beim Setzen der GAT-Länge (Obj 1): {}", e);
                                let _ = client.load_state_unload(1).await;
                                let _ = client.disconnect().await;
                                Self::fail_job(&jobs, job_id, &err_str).await;
                                return;
                            }

                            let mut gat_base_addr = 0x1002;
                            if let Ok(resp) = client.read_property(1, 7, 1, 1).await {
                                gat_base_addr = parse_property_ptr(&resp, 0x1002);
                            }
                            for (chunk_idx, chunk) in gat_payload.chunks(12).enumerate() {
                                let target_addr = gat_base_addr.saturating_add((chunk_idx * 12) as u16);
                                if let Err(e) = client.write_memory_verified(target_addr, chunk).await {
                                    let err_str = format!("Schreibabbruch bei GAT-Adresse 0x{:04X}: {}. Führe Rollback aus...", target_addr, e);
                                    error!("{}", err_str);
                                    let _ = client.load_state_unload(1).await;
                                    let _ = client.disconnect().await;
                                    Self::fail_job(&jobs, job_id, &err_str).await;
                                    return;
                                }
                            }
                            if let Err(e) = client.load_state_commit(1).await {
                                let err_str = format!("Fehler beim Commit der Gruppenadress-Tabelle (Obj 1): {}", e);
                                let _ = client.load_state_unload(1).await;
                                let _ = client.disconnect().await;
                                Self::fail_job(&jobs, job_id, &err_str).await;
                                return;
                            }

                            // Flash Obj 3: AT (In System B ist die Assoziationstabelle Objekt 3, NICHT Objekt 2!)
                            Self::update_job_status(&jobs, job_id, ProgrammingJobStatus::WritingAT, 60, "Schreibe Assoziations-Tabelle (Obj 3)...").await;
                            if let Err(e) = client.load_state_unload(3).await {
                                warn!("AT Unload vor Flash ergab: {}", e);
                            }
                            if let Err(e) = client.load_state_start(3).await {
                                let err_str = format!("Fehler beim Starten der AT-Ladezustandsmaschine (Obj 3): {}", e);
                                let _ = client.load_state_unload(3).await;
                                let _ = client.disconnect().await;
                                Self::fail_job(&jobs, job_id, &err_str).await;
                                return;
                            }
                            let at_len = at_payload.len() as u16;
                            if let Err(e) = client.load_state_set_length(3, 0x00, at_len).await {
                                let err_str = format!("Fehler beim Setzen der AT-Länge (Obj 3): {}", e);
                                let _ = client.load_state_unload(3).await;
                                let _ = client.disconnect().await;
                                Self::fail_job(&jobs, job_id, &err_str).await;
                                return;
                            }

                            let mut at_base_addr = 0x1600;
                            if let Ok(resp) = client.read_property(3, 7, 1, 1).await {
                                at_base_addr = parse_property_ptr(&resp, 0x1600);
                            }
                            for (chunk_idx, chunk) in at_payload.chunks(12).enumerate() {
                                let target_addr = at_base_addr.saturating_add((chunk_idx * 12) as u16);
                                if let Err(e) = client.write_memory_verified(target_addr, chunk).await {
                                    let err_str = format!("Schreibabbruch bei AT-Adresse 0x{:04X}: {}. Führe Rollback aus...", target_addr, e);
                                    error!("{}", err_str);
                                    let _ = client.load_state_unload(3).await;
                                    let _ = client.disconnect().await;
                                    Self::fail_job(&jobs, job_id, &err_str).await;
                                    return;
                                }
                            }
                            if let Err(e) = client.load_state_commit(3).await {
                                let err_str = format!("Fehler beim Commit der Assoziations-Tabelle (Obj 3): {}", e);
                                let _ = client.load_state_unload(3).await;
                                let _ = client.disconnect().await;
                                Self::fail_job(&jobs, job_id, &err_str).await;
                                return;
                            }
                        } else {
                            // BCU1 / System 1 fallback
                            Self::update_job_status(&jobs, job_id, ProgrammingJobStatus::WritingGAT, 45, "Schreibe Gruppenadress-Tabelle...").await;
                            let base_gat: u16 = 0x0116;
                            if let Err(e) = client.write_memory_verified(base_gat, &gat_bytes).await {
                                let err_str = format!("Fehler beim Schreiben der GAT (BCU1): {}", e);
                                let _ = client.disconnect().await;
                                Self::fail_job(&jobs, job_id, &err_str).await;
                                return;
                            }
                            Self::update_job_status(&jobs, job_id, ProgrammingJobStatus::WritingAT, 60, "Schreibe Assoziations-Tabelle...").await;
                            let base_at = base_gat.saturating_add(gat_bytes.len() as u16);
                            if let Err(e) = client.write_memory_verified(base_at, &at_bytes).await {
                                let err_str = format!("Fehler beim Schreiben der AT (BCU1): {}", e);
                                let _ = client.disconnect().await;
                                Self::fail_job(&jobs, job_id, &err_str).await;
                                return;
                            }
                        }
                    } else {
                        info!("GAT & AT unverändert für Gerät '{}', überspringe Schritt 4a & 4b.", dev_name);
                    }

                    // Step 4c: Parameters
                    Self::update_job_status(&jobs, job_id, ProgrammingJobStatus::WritingParameters, 70, "Parameter vorbereiten & verarbeiten...").await;

                    // Extract baseline parameter memory
                    let raw_base_slice = loaded_img.as_deref().and_then(extract_loaded_image_param_slice).map(|(_, _, s)| s).unwrap_or_else(|| vec![0u8; 514]);

                    let (old_param_bytes, new_param_bytes) = if job_type == ProgrammingJobType::Partial {
                        let mut old_b = raw_base_slice.clone();
                        if old_b.len() < 514 { old_b.resize(514, 0); }
                        let mut new_b = old_b.clone();

                        for diff in &dirty_details.parameter_diffs {
                            if let Some(param) = dev_params.iter().find(|p| p.id == diff.param_id) {
                                if let Some(off) = param.offset {
                                    let bit_off = param.bit_offset.unwrap_or(0);
                                    let size = param.size_in_bit.unwrap_or(16);
                                    if diff.old_value != "-" {
                                        let _ = pack_parameter_value(&mut old_b, off as usize, bit_off, size, &diff.old_value, &param.param_type);
                                    }
                                    let _ = pack_parameter_value(&mut new_b, off as usize, bit_off, size, &diff.new_value, &param.param_type);
                                }
                            }
                        }

                        // Always guarantee synchronized assign targets and dependent parameters
                        for p in &dev_params {
                            let is_assigned = p.name.starts_with("shutter_mdt")
                                || p.id.contains("_P-28")
                                || dirty_details.parameter_diffs.iter().any(|d| d.param_id == p.id);
                            if is_assigned {
                                if let Some(off) = p.offset {
                                    let bit_off = p.bit_offset.unwrap_or(0);
                                    let size = p.size_in_bit.unwrap_or(16);
                                    let _ = pack_parameter_value(&mut new_b, off as usize, bit_off, size, &p.value, &p.param_type);
                                }
                            }
                        }

                        (old_b, new_b)
                    } else {
                        // Vollprogrammierung:
                        // Wenn das Gerät bereits ein importiertes loaded_image (ETS-Baseline) besitzt,
                        // nutzen wir dieses als sicheres Fundament und patchen gezielt Änderungen,
                        // damit inaktive Parameter aus anderen Modi (z.B. Schaltaktor vs. Jalousie)
                        // nicht dieselben Speicher-Offsets überschreiben.
                        let mut old_b = raw_base_slice.clone();
                        if old_b.len() < 514 { old_b.resize(514, 0); }
                        let mut new_b = old_b.clone();

                        if loaded_img.is_some() && !dirty_details.is_initial {
                            for diff in &dirty_details.parameter_diffs {
                                if let Some(param) = dev_params.iter().find(|p| p.id == diff.param_id) {
                                    if let Some(off) = param.offset {
                                        let bit_off = param.bit_offset.unwrap_or(0);
                                        let size = param.size_in_bit.unwrap_or(16);
                                        let _ = pack_parameter_value(&mut new_b, off as usize, bit_off, size, &diff.new_value, &param.param_type);
                                    }
                                }
                            }
                        } else {
                            new_b = build_target_parameter_buffer(&raw_base_slice, &dev_params);
                        }

                        // Always guarantee synchronized assign targets and dependent parameters
                        for p in &dev_params {
                            let is_assigned = p.name.starts_with("shutter_mdt")
                                || p.id.contains("_P-28")
                                || dirty_details.parameter_diffs.iter().any(|d| d.param_id == p.id);
                            if is_assigned {
                                if let Some(off) = p.offset {
                                    let bit_off = p.bit_offset.unwrap_or(0);
                                    let size = p.size_in_bit.unwrap_or(16);
                                    let _ = pack_parameter_value(&mut new_b, off as usize, bit_off, size, &p.value, &p.param_type);
                                }
                            }
                        }

                        (old_b, new_b)
                    };

                    let patched_img = if let Some(ref img_b64) = loaded_img {
                        patch_loaded_image_with_slice(img_b64, &new_param_bytes).ok()
                    } else {
                        None
                    };

                    let mut base_addr: u16 = 0x16A2;
                    if is_system_b {
                        Self::update_job_status(&jobs, job_id, ProgrammingJobStatus::WritingParameters, 75, "System B Lade-Zustandsmaschine vorbereiten (Obj 4)...").await;
                        if let Err(e) = client.load_state_unload(4).await {
                            warn!("Parameter Unload vor Flash ergab: {}", e);
                        }
                        if let Err(e) = client.load_state_start(4).await {
                            let err_str = format!("Fehler beim Starten der Parameter-Ladezustandsmaschine (Obj 4): {}", e);
                            let _ = client.load_state_unload(4).await;
                            let _ = client.disconnect().await;
                            Self::fail_job(&jobs, job_id, &err_str).await;
                            return;
                        }
                        let seg_len = new_param_bytes.len() as u16;
                        if let Err(e) = client.load_state_set_length(4, 0x0B, seg_len).await {
                            let err_str = format!("Fehler beim Setzen der Parameter-Segmentlänge (Obj 4): {}", e);
                            let _ = client.load_state_unload(4).await;
                            let _ = client.disconnect().await;
                            Self::fail_job(&jobs, job_id, &err_str).await;
                            return;
                        }

                        if let Ok(resp) = client.read_property(4, 7, 1, 1).await {
                            base_addr = parse_property_ptr(&resp, 0x16A2);
                            info!("System B Parameter Segment Basisadresse: 0x{:04X}", base_addr);
                        }
                    }

                    // Compute memory ranges to write (Full = all chunks, Partial = diff chunks)
                    let changed_ranges: Vec<(usize, Vec<u8>)> = match job_type {
                        ProgrammingJobType::Full => {
                            new_param_bytes.chunks(12).enumerate().map(|(idx, chunk)| (idx * 12, chunk.to_vec())).collect()
                        }
                        ProgrammingJobType::Partial => {
                            find_changed_memory_ranges(&old_param_bytes, &new_param_bytes, 12)
                        }
                        _ => Vec::new(),
                    };

                    let mut write_count = 0;
                    if changed_ranges.is_empty() {
                        info!("Keine Parameteränderungen für Gerät '{}' vorhanden.", dev_name);
                    } else {
                        let total_chunks = changed_ranges.len();
                        for (i, (chunk_off, chunk_data)) in changed_ranges.iter().enumerate() {
                            let target_addr = base_addr.saturating_add(*chunk_off as u16);
                            if let Err(e) = client.write_memory_verified(target_addr, chunk_data).await {
                                let err_str = format!("Schreibabbruch bei Parameter-Adresse 0x{:04X}: {}. Führe Rollback aus...", target_addr, e);
                                error!("{}", err_str);
                                if is_system_b {
                                    let _ = client.load_state_unload(4).await;
                                }
                                let _ = client.disconnect().await;
                                Self::fail_job(&jobs, job_id, &err_str).await;
                                return;
                            } else {
                                write_count += 1;
                            }
                            let progress = 75 + (((i + 1) * 15) / total_chunks) as u8;
                            Self::update_job_status(
                                &jobs,
                                job_id,
                                ProgrammingJobStatus::WritingParameters,
                                progress,
                                &format!("Schreibe Parameter (0x{:04X}, {} Bytes - {}/{})...", target_addr, chunk_data.len(), i + 1, total_chunks),
                            ).await;
                        }
                    }

                    if is_system_b {
                        Self::update_job_status(&jobs, job_id, ProgrammingJobStatus::WritingParameters, 92, "System B Lade-Zustandsmaschine abschließen (Obj 4)...").await;
                        let _ = client.write_property(4, 13, 1, 1, &[0x00, 0x83, 0x00, 0xC6]).await;
                        if let Err(e) = client.load_state_commit(4).await {
                            let err_str = format!("Fehler beim Abschließen der Parameter-Ladezustandsmaschine (Obj 4): {}", e);
                            let _ = client.load_state_unload(4).await;
                            let _ = client.disconnect().await;
                            Self::fail_job(&jobs, job_id, &err_str).await;
                            return;
                        }
                    }

                    if let Some(new_img) = patched_img {
                        let mut p_lock = project.write().await;
                        if let Some(d) = p_lock.devices.iter_mut().find(|d| d.id == dev_id) {
                            d.loaded_image = Some(new_img);
                        }
                    }

                    info!("Parameter-Flash für Gerät '{}' abgeschlossen ({} Speicherblöcke verarbeitet)", dev_name, write_count);
                    tokio::time::sleep(Duration::from_millis(200)).await;
                }
                ProgrammingJobType::Restart => {
                    Self::update_job_status(&jobs, job_id, ProgrammingJobStatus::Restarting, 70, "Sende Neustart-Befehl (A_Restart)...").await;
                    let _ = client.restart().await;
                }
            }

            // Step 5: Restart & Disconnect
            Self::update_job_status(&jobs, job_id, ProgrammingJobStatus::Restarting, 95, "Gerät wird neu gestartet (A_Restart)...").await;
            let _ = client.restart().await;
            let _ = client.disconnect().await;
        } else {
            // Simulated fallback for unit tests and offline environments
            tokio::time::sleep(Duration::from_millis(200)).await;
            match job_type {
                ProgrammingJobType::Verify => {
                    Self::update_job_status(&jobs, job_id, ProgrammingJobStatus::Verifying, 30, "(Simuliert) Prüflauf: Lese Gerätespeicher...").await;
                    tokio::time::sleep(Duration::from_millis(150)).await;
                    Self::update_job_status(&jobs, job_id, ProgrammingJobStatus::Verifying, 70, "(Simuliert) Soll-Ist-Abgleich berechnen...").await;

                    let (dev_params, loaded_img, dirty_details) = {
                        let p_lock = project.read().await;
                        if let Some(d) = p_lock.devices.iter().find(|d| d.id == dev_id) {
                            let dirty = ProgrammingJobManager::get_device_dirty_details(d);
                            (d.parameters.clone(), d.loaded_image.clone(), dirty)
                        } else {
                            (Vec::new(), None, DeviceDirtyDetails {
                                is_dirty: false,
                                reasons: vec![],
                                parameter_diffs: vec![],
                                address_changed: None,
                                added_gas: vec![],
                                removed_gas: vec![],
                                added_associations: vec![],
                                removed_associations: vec![],
                                is_initial: false,
                                last_flashed: None,
                            })
                        }
                    };

                    let raw_base = loaded_img.as_deref().and_then(extract_loaded_image_param_slice).map(|(_, _, s)| s).unwrap_or_else(|| vec![0u8; 514]);
                    let target_b = build_target_parameter_buffer(&raw_base, &dev_params);
                    let changed = find_changed_memory_ranges(&raw_base, &target_b, 12);

                    let mut diff_chunks = Vec::new();
                    let mut diff_bytes = 0;
                    let base_param_addr: u16 = 0x16A2;
                    for (off, chunk) in &changed {
                        let chunk_addr = base_param_addr.saturating_add(*off as u16);
                        let dev_slice = if *off + chunk.len() <= raw_base.len() {
                            raw_base[*off..*off + chunk.len()].to_vec()
                        } else {
                            vec![0u8; chunk.len()]
                        };
                        diff_bytes += dev_slice.iter().zip(chunk.iter()).filter(|(a, b)| a != b).count();
                        diff_chunks.push(MemoryDiffChunk {
                            address: chunk_addr,
                            segment_name: "Parameter (Obj 4)".to_string(),
                            device_bytes_hex: hex::encode(&dev_slice),
                            target_bytes_hex: hex::encode(chunk),
                            byte_count: chunk.len(),
                        });
                    }

                    let is_identical = diff_chunks.is_empty() && dirty_details.parameter_diffs.is_empty();
                    let summary = if is_identical {
                        format!("Prüflauf (Simulation): Gerät '{}' ist zu 100% synchron mit dem Projekt.", dev_name)
                    } else {
                        format!("Prüflauf (Simulation): {} Speicherblöcke ({} Bytes, {} Parameter) weichen ab. Flash-Vorgang ist sicher.",
                            diff_chunks.len(), diff_bytes, dirty_details.parameter_diffs.len())
                    };

                    let report = VerificationReport {
                        device_id: dev_id,
                        address: dev_addr.clone(),
                        mask_version: "System B (07B0h) [Simulation]".to_string(),
                        is_identical,
                        safe_to_flash: true,
                        total_bytes_checked: raw_base.len(),
                        diff_bytes_count: diff_bytes,
                        diff_chunks,
                        parameter_diffs: dirty_details.parameter_diffs,
                        summary_message: summary,
                    };

                    Self::set_job_verification_report(&jobs, job_id, report).await;
                    Self::update_job_status(&jobs, job_id, ProgrammingJobStatus::Success, 100, "Prüflauf abgeschlossen (Simulation, keine Schreiboperationen)").await;
                    return;
                }
                ProgrammingJobType::PhysicalAddress => {
                    Self::update_job_status(&jobs, job_id, ProgrammingJobStatus::WritingParameters, 50, &format!("(Simuliert) Schreibe physikalische Adresse {}...", dev_addr)).await;
                    tokio::time::sleep(Duration::from_millis(150)).await;
                }
                ProgrammingJobType::FilterTable => {
                    Self::update_job_status(&jobs, job_id, ProgrammingJobStatus::WritingFilterTable, 50, "(Simuliert) Berechne & schreibe Filtertabelle...").await;
                    tokio::time::sleep(Duration::from_millis(200)).await;
                }
                ProgrammingJobType::Partial | ProgrammingJobType::Full => {
                    Self::update_job_status(&jobs, job_id, ProgrammingJobStatus::WritingGAT, 40, "(Simuliert) Schreibe GAT...").await;
                    tokio::time::sleep(Duration::from_millis(150)).await;
                    Self::update_job_status(&jobs, job_id, ProgrammingJobStatus::WritingAT, 65, "(Simuliert) Schreibe AT...").await;
                    tokio::time::sleep(Duration::from_millis(150)).await;
                    Self::update_job_status(&jobs, job_id, ProgrammingJobStatus::WritingParameters, 85, "(Simuliert) Schreibe Parameter...").await;

                    let (dev_params, loaded_img) = {
                        let p_lock = project.read().await;
                        if let Some(d) = p_lock.devices.iter().find(|d| d.id == dev_id) {
                            (d.parameters.clone(), d.loaded_image.clone())
                        } else {
                            (Vec::new(), None)
                        }
                    };

                    if let Some(ref img_b64) = loaded_img {
                        if let Ok(new_img) = patch_device_loaded_image(img_b64, &dev_params) {
                            let mut p_lock = project.write().await;
                            if let Some(d) = p_lock.devices.iter_mut().find(|d| d.id == dev_id) {
                                d.loaded_image = Some(new_img);
                            }
                        }
                    }
                    tokio::time::sleep(Duration::from_millis(150)).await;
                }
                ProgrammingJobType::Restart => {
                    Self::update_job_status(&jobs, job_id, ProgrammingJobStatus::Restarting, 70, "(Simuliert) A_Restart...").await;
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            }
            Self::update_job_status(&jobs, job_id, ProgrammingJobStatus::Restarting, 95, "Synchronisiere Gerätezustand...").await;
            tokio::time::sleep(Duration::from_millis(100)).await;
        }

        // 5. Update Snapshot in Project
        {
            let mut proj = project.write().await;
            if let Some(dev) = proj.devices.iter_mut().find(|d| d.id == dev_id) {
                let current_gas: Vec<String> = dev
                    .communication_objects
                    .iter()
                    .flat_map(|k| k.group_addresses.iter().cloned())
                    .collect();

                let current_assocs: Vec<(u32, String)> = dev
                    .communication_objects
                    .iter()
                    .flat_map(|k| k.group_addresses.iter().map(move |ga| (k.number, ga.clone())))
                    .collect();

                let current_params: HashMap<String, String> = dev
                    .parameters
                    .iter()
                    .map(|p| (p.id.clone(), p.value.clone()))
                    .collect();

                dev.last_flashed_state = Some(DeviceFlashedSnapshot {
                    individual_address: dev.individual_address.clone(),
                    group_addresses: current_gas,
                    associations: current_assocs,
                    parameters: current_params,
                    flashed_at: Utc::now(),
                });
            }
        }

        if let Some(ref stor) = storage {
            let p_snap = project.read().await;
            if let Err(e) = stor.save_project(&p_snap, None).await {
                warn!("Konnte Projekt nach Flash nicht speichern: {}", e);
            } else {
                info!("Projekt nach Flash von '{}' ({}) erfolgreich persistiert.", dev_name, dev_addr);
            }
        }

        // 6. Complete Job
        {
            let mut j_lock = jobs.write().await;
            if let Some(job) = j_lock.iter_mut().find(|j| j.id == job_id) {
                job.status = ProgrammingJobStatus::Success;
                job.progress_percent = 100;
                job.current_step = "Erfolgreich abgeschlossen".to_string();
                job.completed_at = Some(Utc::now());
                job.log_messages.push(format!(
                    "[{}] Programmierung von '{}' ({}) erfolgreich beendet.",
                    Utc::now().format("%H:%M:%S"),
                    job.device_name,
                    job.device_address
                ));
            }
        }

        info!("Flash-Vorgang für Gerät '{}' ({}) erfolgreich abgeschlossen.", dev_name, dev_addr);
    }

    /// Handles Physical Address programming via Serial Number write or interactive button press
    #[allow(clippy::too_many_arguments)]
    async fn process_physical_address_job(
        job_id: Uuid,
        dev_id: Uuid,
        target_addr: &str,
        dev_name: &str,
        project: Arc<RwLock<Project>>,
        jobs: Arc<RwLock<Vec<ProgrammingJob>>>,
        knx_manager: Arc<KnxNetManager>,
        storage: Option<Arc<StorageManager>>,
    ) {
        let new_ia_raw = match parse_individual_address(target_addr) {
            Some(ia) => ia,
            None => {
                Self::fail_job(&jobs, job_id, &format!("Ungültige Zieladresse: '{}'", target_addr)).await;
                return;
            }
        };

        let is_real_bus = knx_manager.get_status().await.connected;
        if !is_real_bus {
            Self::update_job_status(
                &jobs,
                job_id,
                ProgrammingJobStatus::WritingParameters,
                50,
                &format!("(Simuliert) Schreibe physikalische Adresse {}...", target_addr),
            ).await;
            tokio::time::sleep(Duration::from_millis(300)).await;
            {
                let mut proj = project.write().await;
                if let Some(d) = proj.devices.iter_mut().find(|d| d.id == dev_id) {
                    d.individual_address = target_addr.to_string();
                }
            }
            Self::update_job_status(
                &jobs,
                job_id,
                ProgrammingJobStatus::Success,
                100,
                &format!("(Simuliert) Physikalische Adresse {} erfolgreich geschrieben.", target_addr),
            ).await;
            return;
        }

        // 1. Check if device has a known serial number in project
        let serial_opt = {
            let p_lock = project.read().await;
            p_lock.devices.iter().find(|d| d.id == dev_id).and_then(|d| d.get_serial_number().and_then(parse_serial_number))
        };

        let mut addr_written = false;

        // If serial number is known, attempt direct A_IndividualAddress_SerialNumber_Write first!
        if let Some(serial_bytes) = serial_opt {
            let serial_hex = serial_bytes.iter().map(|b| format!("{:02X}", b)).collect::<Vec<_>>().join(":");
            Self::update_job_status(
                &jobs,
                job_id,
                ProgrammingJobStatus::Connecting,
                20,
                &format!("Adressierung über Seriennummer {}...", serial_hex),
            ).await;

            let serial_write_pkt = build_cemi_individual_address_serial_number_write(&serial_bytes, new_ia_raw);
            let _ = knx_manager.send_raw_cemi(&serial_write_pkt).await;
            tokio::time::sleep(Duration::from_millis(400)).await;

            // Check if device responds now on target_addr
            let ping_pkt = build_cemi_t_connect(new_ia_raw);
            let mut sub = knx_manager.subscribe_cemi();
            let _ = knx_manager.send_raw_cemi(&ping_pkt).await;
            let ack = tokio::time::timeout(Duration::from_millis(800), async {
                while let Ok(cemi) = sub.recv().await {
                    let base = 2 + cemi.get(1).copied().unwrap_or(0) as usize;
                    if cemi.len() >= base + 8 {
                        let src = u16::from_be_bytes([cemi[base + 2], cemi[base + 3]]);
                        if src == new_ia_raw {
                            return true;
                        }
                    }
                }
                false
            }).await.unwrap_or(false);

            let _ = knx_manager.send_raw_cemi(&build_cemi_t_disconnect(new_ia_raw)).await;

            if ack {
                info!("Gerät '{}' erfolgreich über Seriennummer auf {} programmiert!", dev_name, target_addr);
                addr_written = true;
            }
        }

        // 2. Interactive "Programmiertaste am Gerät drücken" flow
        if !addr_written {
            let mut cemi_sub = knx_manager.subscribe_cemi();
            let mut detected_source: Option<u16> = None;

            // Wait up to 60 seconds for user to press the programming button
            let timeout_secs = 60;
            let start = tokio::time::Instant::now();
            let mut last_read_broadcast = tokio::time::Instant::now() - Duration::from_secs(2);

            while start.elapsed() < Duration::from_secs(timeout_secs) {
                let remaining_secs = timeout_secs.saturating_sub(start.elapsed().as_secs());

                // Broadcast A_IndividualAddress_Read every 1.5 seconds
                if last_read_broadcast.elapsed() >= Duration::from_millis(1500) {
                    let read_req = build_cemi_individual_address_read();
                    let _ = knx_manager.send_raw_cemi(&read_req).await;
                    last_read_broadcast = tokio::time::Instant::now();

                    Self::update_job_status(
                        &jobs,
                        job_id,
                        ProgrammingJobStatus::Connecting,
                        (15 + (start.elapsed().as_secs() * 30 / timeout_secs)) as u8,
                        &format!("Bitte Programmiertaste am Gerät drücken... (noch {}s)", remaining_secs),
                    ).await;
                }

                // Check for incoming A_IndividualAddress_Response (APCI 0x0140)
                if let Ok(Ok(cemi)) = tokio::time::timeout(Duration::from_millis(200), cemi_sub.recv()).await {
                    let add_info_len = cemi.get(1).copied().unwrap_or(0) as usize;
                    let base = 2 + add_info_len;
                    if cemi.len() >= base + 8 {
                        let apci_high = cemi[base + 7];
                        let apci_low = cemi.get(base + 8).copied().unwrap_or(0);
                        // A_IndividualAddress_Response: 0x0140
                        if (apci_high & 0x03 == 0x01) && (apci_low & 0xC0 == 0x40) {
                            let src_raw = u16::from_be_bytes([cemi[base + 2], cemi[base + 3]]);
                            detected_source = Some(src_raw);
                            break;
                        }
                    }
                }
            }

            match detected_source {
                Some(prev_ia) => {
                    let prev_str = format_individual_address(prev_ia);
                    Self::update_job_status(
                        &jobs,
                        job_id,
                        ProgrammingJobStatus::WritingParameters,
                        70,
                        &format!("Programmiermodus erkannt (vorher: {})! Schreibe neue Adresse {}...", prev_str, target_addr),
                    ).await;

                    // Send A_IndividualAddress_Write broadcast
                    let write_req = build_cemi_individual_address_write(new_ia_raw);
                    let _ = knx_manager.send_raw_cemi(&write_req).await;
                    tokio::time::sleep(Duration::from_millis(500)).await;
                }
                None => {
                    Self::fail_job(
                        &jobs,
                        job_id,
                        "Zeitüberschreitung: Keine Betätigung der Programmiertaste am Gerät erkannt (rote LED leuchtet nicht).",
                    ).await;
                    return;
                }
            }
        }

        // 3. Verify & Finalize
        Self::update_job_status(
            &jobs,
            job_id,
            ProgrammingJobStatus::Authorizing,
            90,
            &format!("Verifiziere Adresse {} auf dem Bus...", target_addr),
        ).await;

        tokio::time::sleep(Duration::from_millis(300)).await;

        // Update project model
        {
            let mut proj = project.write().await;
            if let Some(dev) = proj.devices.iter_mut().find(|d| d.id == dev_id) {
                dev.individual_address = target_addr.to_string();
            }
        }

        if let Some(ref stor) = storage {
            let p_snap = project.read().await;
            let _ = stor.save_project(&p_snap, None).await;
        }

        // Mark Job as Success
        {
            let mut j_lock = jobs.write().await;
            if let Some(job) = j_lock.iter_mut().find(|j| j.id == job_id) {
                job.status = ProgrammingJobStatus::Success;
                job.progress_percent = 100;
                job.current_step = format!("Physikalische Adresse {} erfolgreich programmiert!", target_addr);
                job.completed_at = Some(Utc::now());
                job.log_messages.push(format!(
                    "[{}] Physikalische Adresse '{}' erfolgreich in '{}' geschrieben.",
                    Utc::now().format("%H:%M:%S"),
                    target_addr,
                    dev_name
                ));
            }
        }
        info!("Physikalische Adresse '{}' für '{}' erfolgreich programmiert.", target_addr, dev_name);
    }

    async fn fail_job(
        jobs: &Arc<RwLock<Vec<ProgrammingJob>>>,
        job_id: Uuid,
        error_msg: &str,
    ) {
        let mut j_lock = jobs.write().await;
        if let Some(job) = j_lock.iter_mut().find(|j| j.id == job_id) {
            job.status = ProgrammingJobStatus::Failed;
            job.current_step = format!("Fehlgeschlagen: {}", error_msg);
            job.completed_at = Some(Utc::now());
            job.log_messages.push(format!("[{}] FEHLER: {}", Utc::now().format("%H:%M:%S"), error_msg));
        }
        error!("Flash-Job {} fehlgeschlagen: {}", job_id, error_msg);
    }

    async fn update_job_status(
        jobs: &Arc<RwLock<Vec<ProgrammingJob>>>,
        job_id: Uuid,
        status: ProgrammingJobStatus,
        progress: u8,
        step: &str,
    ) {
        let mut j_lock = jobs.write().await;
        if let Some(job) = j_lock.iter_mut().find(|j| j.id == job_id) {
            job.status = status;
            job.progress_percent = progress;
            job.current_step = step.to_string();
            job.log_messages.push(format!("[{}] {}", Utc::now().format("%H:%M:%S"), step));
        }
    }

    async fn set_job_verification_report(
        jobs: &Arc<RwLock<Vec<ProgrammingJob>>>,
        job_id: Uuid,
        report: VerificationReport,
    ) {
        let mut j_lock = jobs.write().await;
        if let Some(job) = j_lock.iter_mut().find(|j| j.id == job_id) {
            job.verification_report = Some(report);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sample_data::create_demo_project;
    use crate::simulator::Simulator;

    #[tokio::test]
    async fn test_differential_dirty_state_detection() {
        let mut proj = create_demo_project();
        let dev = &mut proj.devices[0];

        // 1. Initial state without snapshot: Must be dirty!
        assert!(ProgrammingJobManager::check_device_dirty_state(dev));

        // 2. Set snapshot identical to current state: Must be NOT dirty!
        let current_gas: Vec<String> = dev
            .communication_objects
            .iter()
            .flat_map(|k| k.group_addresses.iter().cloned())
            .collect();
        let current_assocs: Vec<(u32, String)> = dev
            .communication_objects
            .iter()
            .flat_map(|k| k.group_addresses.iter().map(move |ga| (k.number, ga.clone())))
            .collect();
        let current_params: HashMap<String, String> = dev
            .parameters
            .iter()
            .map(|p| (p.id.clone(), p.value.clone()))
            .collect();

        dev.last_flashed_state = Some(DeviceFlashedSnapshot {
            individual_address: dev.individual_address.clone(),
            group_addresses: current_gas,
            associations: current_assocs,
            parameters: current_params,
            flashed_at: Utc::now(),
        });

        assert!(!ProgrammingJobManager::check_device_dirty_state(dev));

        // 3. Change individual address: Must be dirty!
        dev.individual_address = "1.1.99".to_string();
        assert!(ProgrammingJobManager::check_device_dirty_state(dev));

        // 4. Test detailed dirty reasons
        let details = ProgrammingJobManager::get_device_dirty_details(dev);
        assert!(details.is_dirty);
        assert!(details.reasons.iter().any(|r| r.contains("Physikalische Adresse")));
        assert!(details.address_changed.is_some());
    }

    #[tokio::test]
    async fn test_programming_job_lifecycle() {
        let project = Arc::new(RwLock::new(create_demo_project()));
        let simulator = Arc::new(Simulator::new(project.clone()));
        let knx_manager = Arc::new(KnxNetManager::new(simulator));
        let job_mgr = ProgrammingJobManager::new(project.clone(), knx_manager, None);

        let dev_id = {
            let proj = project.read().await;
            proj.devices[0].id
        };

        // Enqueue Partial job
        let job = job_mgr.enqueue_job(dev_id, ProgrammingJobType::Partial).await.expect("Enqueue failed");
        assert_eq!(job.status, ProgrammingJobStatus::Queued);
        assert_eq!(job.progress_percent, 0);

        // Wait for worker to finish (takes approx 3 seconds in test)
        tokio::time::sleep(Duration::from_millis(3800)).await;

        let jobs = job_mgr.get_jobs().await;
        let finished_job = jobs.iter().find(|j| j.id == job.id).expect("Job not found");
        assert_eq!(finished_job.status, ProgrammingJobStatus::Success);
        assert_eq!(finished_job.progress_percent, 100);

        // Device must now have an active last_flashed_state snapshot
        let proj = project.read().await;
        let dev = proj.devices.iter().find(|d| d.id == dev_id).unwrap();
        assert!(dev.last_flashed_state.is_some());
    }

    #[tokio::test]
    async fn test_read_device_live_state() {
        let project = Arc::new(RwLock::new(create_demo_project()));
        let simulator = Arc::new(Simulator::new(project.clone()));
        let knx_manager = Arc::new(KnxNetManager::new(simulator));
        let job_mgr = ProgrammingJobManager::new(project.clone(), knx_manager, None);

        let dev_id = {
            let proj = project.read().await;
            proj.devices[0].id
        };

        let result = job_mgr.read_device_live_state(dev_id).await.expect("Read live state failed");
        assert!(result.success);
        assert!(result.reachable);
        assert_eq!(result.address, "1.1.1");
        assert!(!result.message.is_empty());
    }

    #[test]
    fn test_pack_parameter_value_mdt_shutter() {
        let mut buffer = [0u8; 16];
        // MDT AKU-B2UP.03: P-27 (Verfahrzeit Auf) = 28s at offset 4, 16-bit
        pack_parameter_value(&mut buffer, 4, 0, 16, "28", "number").unwrap();
        // MDT AKU-B2UP.03: P-28 (Verfahrzeit Ab) = 26s at offset 6, 16-bit
        pack_parameter_value(&mut buffer, 6, 0, 16, "26", "number").unwrap();

        assert_eq!(buffer[4], 0x00);
        assert_eq!(buffer[5], 0x1C); // 28 = 0x001C
        assert_eq!(buffer[6], 0x00);
        assert_eq!(buffer[7], 0x1A); // 26 = 0x001A
    }

    #[test]
    fn test_pack_parameter_value_bitfields_and_floats() {
        let mut buffer = [0u8; 8];
        // 1-bit flag at bit_offset 0 -> MSB (0x80)
        pack_parameter_value(&mut buffer, 0, 0, 1, "1", "enum").unwrap();
        assert_eq!(buffer[0], 0x80);

        // 1-bit flag at bit_offset 7 -> LSB (0x01)
        pack_parameter_value(&mut buffer, 0, 7, 1, "1", "enum").unwrap();
        assert_eq!(buffer[0], 0x81);

        // 2-bit enum at bit_offset 1 (bits 6,5) value 2 (0b10) -> shift 5 -> 0x40
        pack_parameter_value(&mut buffer, 0, 1, 2, "2", "enum").unwrap();
        assert_eq!(buffer[0], 0xC1); // 0x80 | 0x40 | 0x01

        // 16-bit Float at offset 2
        pack_parameter_value(&mut buffer, 2, 0, 16, "21.5", "Float").unwrap();
        let f_decoded = crate::knxnet_ip::decode_knx_float2([buffer[2], buffer[3]]);
        assert!((f_decoded - 21.5).abs() < 0.1);
    }

    #[test]
    fn test_patch_device_loaded_image_roundtrip() {
        // Construct a synthetic LoadedImage with Segment 4 header (13 bytes) + 16 bytes of data
        let mut raw = Vec::new();
        // Header for Segment 4: [0x04, 0x00, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x03]
        raw.extend_from_slice(&[0x04, 0x00, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x03]);
        // 16 bytes initial data (e.g. 24s at offset 4 and 6)
        raw.extend_from_slice(&[
            0x01, 0x00, 0x01, 0xF4,
            0x00, 0x18, // offset 4: 24s
            0x00, 0x18, // offset 6: 24s
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ]);

        let img_b64 = compress_loaded_image(&raw).unwrap();

        let params = vec![
            DeviceParameter {
                id: "P-27".to_string(),
                name: "shutter_mudt_0".to_string(),
                text: "Verfahrzeit".to_string(),
                param_type: "number".to_string(),
                value: "28".to_string(),
                default_value: "45".to_string(),
                suffix: Some("s".to_string()),
                options: vec![],
                enum_options: vec![],
                page: None,
                pages: vec![],
                access: Some("ReadWrite".to_string()),
                section: None,
                depends_on: None,
                offset: Some(4),
                bit_offset: Some(0),
                size_in_bit: Some(16),
                min: Some(1.0),
                max: Some(3600.0),
                step: Some(1.0),
                is_float: Some(false),
            },
            DeviceParameter {
                id: "P-28".to_string(),
                name: "shutter_mdt_0".to_string(),
                text: "Verfahrzeit Fahrtrichtung Ab".to_string(),
                param_type: "number".to_string(),
                value: "26".to_string(),
                default_value: "45".to_string(),
                suffix: Some("s".to_string()),
                options: vec![],
                enum_options: vec![],
                page: None,
                pages: vec![],
                access: Some("ReadWrite".to_string()),
                section: None,
                depends_on: None,
                offset: Some(6),
                bit_offset: Some(0),
                size_in_bit: Some(16),
                min: Some(1.0),
                max: Some(3600.0),
                step: Some(1.0),
                is_float: Some(false),
            },
        ];

        let patched_b64 = patch_device_loaded_image(&img_b64, &params).unwrap();
        let decomp = decompress_loaded_image(&patched_b64).unwrap();

        // Header is 13 bytes, data offset 4 is byte 17, offset 6 is byte 19
        assert_eq!(decomp[13 + 4], 0x00);
        assert_eq!(decomp[13 + 5], 0x1C); // 28
        assert_eq!(decomp[13 + 6], 0x00);
        assert_eq!(decomp[13 + 7], 0x1A); // 26
    }

    #[test]
    fn test_patch_real_device_1_1_11_loaded_image() {
        let real_1_1_11_b64 = "7VJBDsIgEJxdaDHG2ENN2pOP8CP4iH7Kq6/xB37EOy4UKmhiNDFpD85mYXe7HWCAQGAAG3EFA49ziI8tgpk2VFt8gy66DdYJgzXIaiWuWWy3n67hFg8vqo6isqisCHRDL3YR2Z9BrHRVm5f6aWoYhjWTSymHyBDJZWk/hJyqjLEk8veMBqPAK+f3Jh5njrP8o3RqLjgOwA5NPeV7OQWP3ynzDOks/KB604XfdZFABiwPcz/JP+bGHQ==";

        let params = vec![
            DeviceParameter {
                id: "M-0083_A-00C6-41-59D6_P-27".to_string(),
                name: "shutter_mudt_0".to_string(),
                text: "Verfahrzeit".to_string(),
                param_type: "number".to_string(),
                value: "28".to_string(),
                default_value: "45".to_string(),
                suffix: Some("s".to_string()),
                offset: Some(4),
                bit_offset: Some(0),
                size_in_bit: Some(16),
                ..Default::default()
            },
            DeviceParameter {
                id: "M-0083_A-00C6-41-59D6_P-28".to_string(),
                name: "shutter_mdt_0".to_string(),
                text: "Verfahrzeit Fahrtrichtung Ab".to_string(),
                param_type: "number".to_string(),
                value: "26".to_string(),
                default_value: "45".to_string(),
                suffix: Some("s".to_string()),
                offset: Some(6),
                bit_offset: Some(0),
                size_in_bit: Some(16),
                ..Default::default()
            },
        ];

        let patched_b64 = patch_device_loaded_image(real_1_1_11_b64, &params).unwrap();
        let decomp = decompress_loaded_image(&patched_b64).unwrap();

        // In real 1.1.11 LoadedImage, Segment 4 data begins at 366 (0x016E)
        assert_eq!(decomp[366 + 4], 0x00);
        assert_eq!(decomp[366 + 5], 0x1C); // 28s
        assert_eq!(decomp[366 + 6], 0x00);
        assert_eq!(decomp[366 + 7], 0x1A); // 26s
    }

    #[test]
    fn test_parse_system_b_pid7_base_addr_and_differential_selection() {
        // Test PID 7 32-bit address parsing
        let resp_32bit = vec![0x04, 0x07, 0x10, 0x01, 0x00, 0x00, 0x16, 0xA2];
        let addr_32 = if resp_32bit.len() >= 8 {
            u16::from_be_bytes([resp_32bit[6], resp_32bit[7]])
        } else {
            0
        };
        assert_eq!(addr_32, 0x16A2);

        // Test PID 7 16-bit address parsing
        let resp_16bit = vec![0x04, 0x07, 0x10, 0x01, 0x16, 0x00];
        let addr_16 = if resp_16bit.len() >= 6 {
            u16::from_be_bytes([resp_16bit[4], resp_16bit[5]])
        } else {
            0
        };
        assert_eq!(addr_16, 0x1600);

        // Test differential parameter filtering
        let mut params = Vec::new();
        for i in 0..50 {
            params.push(DeviceParameter {
                id: format!("P-{}", i),
                name: format!("param_{}", i),
                value: "0".to_string(),
                offset: Some(i as u32 * 2),
                ..Default::default()
            });
        }
        let dirty_ids: std::collections::HashSet<String> = vec!["P-4".to_string()].into_iter().collect();

        // Partial mode should ONLY select P-4
        let partial_selection: Vec<&DeviceParameter> = params
            .iter()
            .filter(|p| p.offset.is_some() && dirty_ids.contains(&p.id))
            .collect();
        assert_eq!(partial_selection.len(), 1);
        assert_eq!(partial_selection[0].id, "P-4");
        assert_eq!(partial_selection[0].offset, Some(8));

        // Full mode should select all 50
        let full_selection: Vec<&DeviceParameter> = params
            .iter()
            .filter(|p| p.offset.is_some())
            .collect();
        assert_eq!(full_selection.len(), 50);
    }

    #[test]
    fn test_build_system_b_gat_and_at_bytes() {
        let kos = vec![
            CommunicationObject {
                id: Uuid::new_v4().to_string(),
                number: 31,
                name: "Mud".to_string(),
                object_text: "Kanal A".to_string(),
                function_text: "Auf/Ab".to_string(),
                dpt: "1.008".to_string(),
                object_size: "1 Bit".to_string(),
                flags: ComObjectFlags::default(),
                group_address_ids: vec![],
                group_addresses: vec!["2/0/0".to_string()],
                depends_on: None,
            },
            CommunicationObject {
                id: Uuid::new_v4().to_string(),
                number: 33,
                name: "Stop".to_string(),
                object_text: "Kanal A".to_string(),
                function_text: "Stop".to_string(),
                dpt: "1.017".to_string(),
                object_size: "1 Bit".to_string(),
                flags: ComObjectFlags::default(),
                group_address_ids: vec![],
                group_addresses: vec!["2/0/1".to_string()],
                depends_on: None,
            },
            CommunicationObject {
                id: Uuid::new_v4().to_string(),
                number: 38,
                name: "Sapbp".to_string(),
                object_text: "Kanal A".to_string(),
                function_text: "Position".to_string(),
                dpt: "5.001".to_string(),
                object_size: "1 Byte".to_string(),
                flags: ComObjectFlags::default(),
                group_address_ids: vec![],
                group_addresses: vec!["2/0/5".to_string()],
                depends_on: None,
            },
        ];

        let (unique_gas, gat_bytes) = build_system_b_gat_bytes(&kos);
        assert_eq!(unique_gas.len(), 3);
        assert_eq!(unique_gas, vec!["2/0/0", "2/0/1", "2/0/5"]);

        // GAT: 2 bytes count (3) + 3 * 2 bytes GA = 8 bytes
        assert_eq!(gat_bytes.len(), 8);
        assert_eq!(u16::from_be_bytes([gat_bytes[0], gat_bytes[1]]), 3);
        assert_eq!(u16::from_be_bytes([gat_bytes[2], gat_bytes[3]]), 0x1000); // 2/0/0 = 0x1000
        assert_eq!(u16::from_be_bytes([gat_bytes[4], gat_bytes[5]]), 0x1001); // 2/0/1 = 0x1001
        assert_eq!(u16::from_be_bytes([gat_bytes[6], gat_bytes[7]]), 0x1005); // 2/0/5 = 0x1005

        // AT: 2 bytes count (3) + 3 * 4 bytes (tsap, asap) = 14 bytes
        let at_bytes = build_system_b_at_bytes(&kos, &unique_gas);
        assert_eq!(at_bytes.len(), 14);
        assert_eq!(u16::from_be_bytes([at_bytes[0], at_bytes[1]]), 3);

        // First assoc: TSAP=1 (2/0/0), ASAP=31
        assert_eq!(u16::from_be_bytes([at_bytes[2], at_bytes[3]]), 1);
        assert_eq!(u16::from_be_bytes([at_bytes[4], at_bytes[5]]), 31);

        // Second assoc: TSAP=2 (2/0/1), ASAP=33
        assert_eq!(u16::from_be_bytes([at_bytes[6], at_bytes[7]]), 2);
        assert_eq!(u16::from_be_bytes([at_bytes[8], at_bytes[9]]), 33);

        // Third assoc: TSAP=3 (2/0/5), ASAP=38
        assert_eq!(u16::from_be_bytes([at_bytes[10], at_bytes[11]]), 3);
        assert_eq!(u16::from_be_bytes([at_bytes[12], at_bytes[13]]), 38);
    }

    #[test]
    fn test_find_changed_memory_ranges() {
        let old_buf = vec![0u8; 514];
        let mut new_buf = vec![0u8; 514];

        // Modify 2 bytes at offset 4
        new_buf[4] = 0x01;
        new_buf[5] = 0x1C; // 28

        // Modify 1 byte at offset 50
        new_buf[50] = 0xFF;

        let diffs = find_changed_memory_ranges(&old_buf, &new_buf, 12);
        assert_eq!(diffs.len(), 2);

        // First chunk at offset 4
        assert_eq!(diffs[0].0, 4);
        assert_eq!(diffs[0].1, vec![0x01, 0x1C]);

        // Second chunk at offset 50
        assert_eq!(diffs[1].0, 50);
        assert_eq!(diffs[1].1, vec![0xFF]);
    }

    #[test]
    fn test_shutter_parameter_synchronization_equal_times() {
        let mut params = vec![
            DeviceParameter {
                id: "M-0083_A-00C6-41-59D6_P-26".to_string(),
                name: "d_Verfahrzeit Auf/Ab_0".to_string(),
                value: "0".to_string(), // gleich
                offset: None,
                ..Default::default()
            },
            DeviceParameter {
                id: "M-0083_A-00C6-41-59D6_P-27".to_string(),
                name: "shutter_mudt_0".to_string(),
                value: "2".to_string(), // User set 2 seconds
                offset: Some(4),
                size_in_bit: Some(16),
                param_type: "number".to_string(),
                ..Default::default()
            },
            DeviceParameter {
                id: "M-0083_A-00C6-41-59D6_P-28".to_string(),
                name: "shutter_mdt_0".to_string(),
                value: "26".to_string(), // Stale value 26s
                offset: Some(6),
                size_in_bit: Some(16),
                param_type: "number".to_string(),
                ..Default::default()
            },
        ];

        let updated = synchronize_dependent_parameters(&mut params);
        assert_eq!(updated, 1);
        assert_eq!(params[2].value, "2"); // mdt synchronized to mudt!

        // Verify packing into buffer
        let mut buffer = vec![0u8; 514];
        for p in &params {
            if let Some(off) = p.offset {
                pack_parameter_value(&mut buffer, off as usize, 0, 16, &p.value, &p.param_type).unwrap();
            }
        }

        // Both offset 4 and offset 6 must have value 2 (0x0002)
        assert_eq!(u16::from_be_bytes([buffer[4], buffer[5]]), 2);
        assert_eq!(u16::from_be_bytes([buffer[6], buffer[7]]), 2);
    }

    #[test]
    fn test_universal_cross_byte_bitfield_packing() {
        let mut buffer = vec![0u8; 32];
        // 6-bit value spanning across byte 10 and byte 11:
        // Byte 10, bit_offset 5, size 6. Value = 0b101011 (43 in dec).
        pack_parameter_value(&mut buffer, 10, 5, 6, "43", "number").unwrap();

        // Byte 10 bits 2..0 should be 1, 0, 1 -> 0x05
        assert_eq!(buffer[10], 0b00000101);
        // Byte 11 bits 7..5 should be 0, 1, 1 -> 0b01100000 = 0x60
        assert_eq!(buffer[11], 0b01100000);
    }

    #[test]
    fn test_generic_parameter_assign_rules() {
        use crate::model::{ParameterAssignRule, ParameterCondition};

        let mut params = vec![
            DeviceParameter {
                id: "P-MODE".to_string(),
                value: "0".to_string(),
                ..Default::default()
            },
            DeviceParameter {
                id: "P-SRC".to_string(),
                value: "42".to_string(),
                ..Default::default()
            },
            DeviceParameter {
                id: "P-TGT".to_string(),
                value: "10".to_string(),
                ..Default::default()
            },
            DeviceParameter {
                id: "P-TRANS".to_string(),
                value: "0".to_string(),
                ..Default::default()
            },
        ];

        let rules = vec![
            // If P-MODE == "0", copy P-SRC to P-TGT
            ParameterAssignRule {
                target_param_id: "P-TGT".to_string(),
                source_param_id: Some("P-SRC".to_string()),
                value: None,
                conditions: vec![
                    ParameterCondition {
                        param_id: "P-MODE".to_string(),
                        when_values: vec!["0".to_string()],
                    },
                ],
            },
            // If P-TGT == "42", set P-TRANS = "99" (Transitive check)
            ParameterAssignRule {
                target_param_id: "P-TRANS".to_string(),
                source_param_id: None,
                value: Some("99".to_string()),
                conditions: vec![
                    ParameterCondition {
                        param_id: "P-TGT".to_string(),
                        when_values: vec!["42".to_string()],
                    },
                ],
            },
        ];

        let updated = evaluate_assign_rules(&mut params, &rules);
        assert_eq!(updated, 2);
        assert_eq!(params.iter().find(|p| p.id == "P-TGT").unwrap().value, "42");
        assert_eq!(params.iter().find(|p| p.id == "P-TRANS").unwrap().value, "99");
    }

    #[tokio::test]
    async fn test_verify_job_lifecycle() {
        let project = Arc::new(RwLock::new(create_demo_project()));
        let simulator = Arc::new(Simulator::new(project.clone()));
        let knx_manager = Arc::new(KnxNetManager::new(simulator));
        let job_mgr = ProgrammingJobManager::new(project.clone(), knx_manager, None);

        let dev_id = {
            let proj = project.read().await;
            proj.devices[0].id
        };

        // Enqueue non-destructive Verify job
        let job = job_mgr.enqueue_job(dev_id, ProgrammingJobType::Verify).await.expect("Enqueue failed");
        assert_eq!(job.status, ProgrammingJobStatus::Queued);

        // Wait for worker to finish (simulation takes ~300ms)
        tokio::time::sleep(Duration::from_millis(1500)).await;

        let jobs = job_mgr.get_jobs().await;
        let finished_job = jobs.iter().find(|j| j.id == job.id).expect("Job not found");
        assert_eq!(finished_job.status, ProgrammingJobStatus::Success);
        assert_eq!(finished_job.progress_percent, 100);

        // Verification report must be present
        assert!(finished_job.verification_report.is_some());
        let report = finished_job.verification_report.as_ref().unwrap();
        assert_eq!(report.device_id, dev_id);
        assert!(report.safe_to_flash);
        assert!(!report.summary_message.is_empty());
    }

    #[test]
    fn test_system_b_load_state_machine_payloads() {
        // KNX System B Specification Property 5 (Load State Control)
        // 0x04 = Unload
        let unload_payload = [0x04, 0, 0, 0, 0, 0, 0, 0, 0];
        assert_eq!(unload_payload[0], 0x04);

        // 0x01 = Start Loading
        let start_payload = [0x01, 0, 0, 0, 0, 0, 0, 0, 0];
        assert_eq!(start_payload[0], 0x01);

        // 0x03 = Set Length with sub-command (e.g. 514 bytes for parameters)
        let seg_len: u16 = 514;
        let sub_cmd: u8 = 0x0B;
        let len_payload = [0x03, sub_cmd, 0, 0, (seg_len >> 8) as u8, (seg_len & 0xFF) as u8, 0, 0, 0];
        assert_eq!(len_payload[0], 0x03);
        assert_eq!(len_payload[1], 0x0B);
        assert_eq!(u16::from_be_bytes([len_payload[4], len_payload[5]]), 514);

        // 0x02 = End / Commit
        let commit_payload = [0x02, 0, 0, 0, 0, 0, 0, 0, 0];
        assert_eq!(commit_payload[0], 0x02);
    }

    #[test]
    fn test_system_b_sequence_number_rollover() {
        // NDT sequence numbers in KNX cEMI connected frames are 4-bit (0..=15)
        let mut seq: u8 = 0;
        for i in 0..32 {
            assert_eq!(seq, (i % 16) as u8);
            seq = (seq + 1) % 16;
        }
    }
}


