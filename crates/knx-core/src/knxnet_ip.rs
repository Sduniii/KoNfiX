use crate::model::*;
use crate::simulator::Simulator;
use chrono::Utc;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UdpSocket;
use tokio::sync::{broadcast, Mutex, RwLock};
use tokio::time::sleep;
use tracing::{debug, info, warn};
use uuid::Uuid;

pub const KNX_PORT: u16 = 3671;
pub const KNX_MULTICAST_IP: &str = "224.0.23.12";

// Service Identifiers
pub const SERVICE_SEARCH_REQ: u16 = 0x0201;
pub const SERVICE_SEARCH_RES: u16 = 0x0202;
pub const SERVICE_CONNECT_REQ: u16 = 0x0205;
pub const SERVICE_CONNECT_RES: u16 = 0x0206;
pub const SERVICE_CONNECTIONSTATE_REQ: u16 = 0x0207;
pub const SERVICE_CONNECTIONSTATE_RES: u16 = 0x0208;
pub const SERVICE_DISCONNECT_REQ: u16 = 0x0209;
pub const SERVICE_DISCONNECT_RES: u16 = 0x020A;
pub const SERVICE_TUNNELLING_REQ: u16 = 0x0420;
pub const SERVICE_TUNNELLING_ACK: u16 = 0x0421;

/// KNX Individual Address helper: u16 -> "area.line.device"
pub fn format_individual_address(raw: u16) -> String {
    let area = (raw >> 12) & 0x0F;
    let line = (raw >> 8) & 0x0F;
    let device = raw & 0xFF;
    format!("{}.{}.{}", area, line, device)
}

/// KNX Group Address helper: "main/middle/sub" -> u16
pub fn parse_group_address(ga: &str) -> Option<u16> {
    let parts: Vec<&str> = ga.trim().split('/').collect();
    if parts.len() != 3 {
        return None;
    }
    let main = parts[0].parse::<u16>().ok()?;
    let middle = parts[1].parse::<u16>().ok()?;
    let sub = parts[2].parse::<u16>().ok()?;
    if main > 31 || middle > 7 || sub > 255 {
        return None;
    }
    Some((main << 11) | (middle << 8) | sub)
}

/// KNX Group Address helper: u16 -> "main/middle/sub"
pub fn format_group_address(raw: u16) -> String {
    let main = (raw >> 11) & 0x1F;
    let middle = (raw >> 8) & 0x07;
    let sub = raw & 0xFF;
    format!("{}/{}/{}", main, middle, sub)
}

/// KNX Individual Address helper: "area.line.device" -> u16
pub fn parse_individual_address(ia: &str) -> Option<u16> {
    let parts: Vec<&str> = ia.trim().split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    let area = parts[0].parse::<u16>().ok()?;
    let line = parts[1].parse::<u16>().ok()?;
    let device = parts[2].parse::<u16>().ok()?;
    if area > 15 || line > 15 || device > 255 {
        return None;
    }
    Some((area << 12) | (line << 8) | device)
}

/// Decodes 16-bit KNX Device Descriptor / Mask Version into human-readable description and hex string
pub fn decode_mask_version(mask: u16) -> (&'static str, String) {
    let hex_str = format!("{:04X}h", mask);
    let desc = match mask {
        0x0010..=0x0013 => "BCU 1 (TP)",
        0x0020..=0x0025 => "BCU 2 (TP)",
        0x0300 => "BIM M113 (PL110)",
        0x0701 => "System 7 (TP, Media Coupler)",
        0x0705 => "System 7 (TP, Flash)",
        0x07B0 => "System B (TP, BIM M112)",
        0x091A => "KNX IP Interface / Router",
        0x1012 => "BCU 1 (RF)",
        0x1013 => "BCU 1 (RF Multi)",
        0x17B0 => "System B (RF)",
        0x1900 => "System 9 (KNX IP)",
        0x27B0 => "System B Secure (KNX Data Secure)",
        0x57B0 => "System B Secure (Long Frame)",
        _ => "KNX Standard-Gerät",
    };
    (desc, hex_str)
}

/// Decodes 16-bit KNX Manufacturer Code
pub fn decode_manufacturer(mfg_id: u16) -> &'static str {
    match mfg_id {
        0x0001 => "KNX Association",
        0x0002 => "ABB Stotz-Kontakt",
        0x0004 => "Albrecht Jung",
        0x0005 => "Siemens AG",
        0x0007 => "Hager Electro",
        0x0008 => "Gira Giersiepen",
        0x0009 => "Berker",
        0x0017 => "Insta GmbH",
        0x0024 => "Theben AG",
        0x0083 | 0x00C5 => "MDT Technologies",
        0x00C8 => "Weinzierl Engineering",
        0x00FE => "Hager",
        0x0113 => "Zennio",
        0x0129 => "Enertex Bayern",
        0x027A => "Lingg & Janke",
        _ => "KNX Hersteller",
    }
}

/// Builds broadcast A_IndividualAddress_Read cEMI frame (Message Code 0x11, Dest 0.0.0, APCI 0x0100)
pub fn build_cemi_individual_address_read() -> Vec<u8> {
    let mut cemi = Vec::with_capacity(11);
    cemi.push(0x11); // Message Code: L_Data.req
    cemi.push(0x00); // Additional Info len = 0
    cemi.push(0xBC); // Control 1: Standard frame, normal priority
    cemi.push(0x60); // Control 2: Individual address / Broadcast, Hop count 6
    cemi.extend_from_slice(&[0x00, 0x00]); // Source address (overwritten by interface)
    cemi.extend_from_slice(&[0x00, 0x00]); // Destination: 0.0.0 (Broadcast)
    cemi.push(0x01); // Data length = 1
    cemi.push(0x01); // TPCI: 0x00, APCI bits 9..8: 0x01
    cemi.push(0x00); // APCI bits 7..6: 0x00 (0x0100 = A_IndividualAddress_Read)
    cemi
}

/// Builds broadcast A_IndividualAddress_Write cEMI frame (Message Code 0x11, Dest 0.0.0, APCI 0x00C0)
pub fn build_cemi_individual_address_write(new_ia: u16) -> Vec<u8> {
    let mut cemi = Vec::with_capacity(13);
    cemi.push(0x11); // Message Code: L_Data.req
    cemi.push(0x00); // Additional Info len = 0
    cemi.push(0xBC); // Control 1: Standard frame, normal priority
    cemi.push(0x60); // Control 2: Individual address / Broadcast, Hop count 6
    cemi.extend_from_slice(&[0x00, 0x00]); // Source
    cemi.extend_from_slice(&[0x00, 0x00]); // Destination: 0.0.0 (Broadcast to device in prog mode)
    cemi.push(0x03); // Data length = 3 (1 APCI + 2 data)
    cemi.push(0x00); // TPCI: 0x00, APCI bits 9..8: 0x00
    cemi.push(0xC0); // APCI bits 7..6: 0x03 (0x00C0 = A_IndividualAddress_Write)
    cemi.extend_from_slice(&new_ia.to_be_bytes()); // New IA payload
    cemi
}

/// Parses a 6-byte hex serial number string (e.g. "00:83:76:8A:0C:65" or "0083768A0C65")
pub fn parse_serial_number(s: &str) -> Option<[u8; 6]> {
    let clean: String = s.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if clean.len() == 12 {
        let mut bytes = [0u8; 6];
        for i in 0..6 {
            bytes[i] = u8::from_str_radix(&clean[i * 2..i * 2 + 2], 16).ok()?;
        }
        Some(bytes)
    } else {
        None
    }
}

/// Builds broadcast A_IndividualAddress_SerialNumber_Write cEMI frame (Message Code 0x11, Dest 0.0.0, APCI 0x03E2)
pub fn build_cemi_individual_address_serial_number_write(serial: &[u8; 6], new_ia: u16) -> Vec<u8> {
    let mut cemi = Vec::with_capacity(21);
    cemi.push(0x11); // Message Code: L_Data.req
    cemi.push(0x00); // Additional Info len = 0
    cemi.push(0xBC); // Control 1: Standard frame, normal priority
    cemi.push(0x60); // Control 2: Individual address / Broadcast, Hop count 6
    cemi.extend_from_slice(&[0x00, 0x00]); // Source
    cemi.extend_from_slice(&[0x00, 0x00]); // Destination: 0.0.0 (Broadcast)
    cemi.push(0x0B); // Data length = 11 (1 APCI + 6 serial + 2 IA + 2 domain)
    cemi.push(0x03); // TPCI: 0x00, APCI bits 9..8: 0x03
    cemi.push(0xE2); // APCI bits 7..0: 0xE2 (0x03E2 = A_IndividualAddress_SerialNumber_Write)
    cemi.extend_from_slice(serial); // 6-byte Serial Number
    cemi.extend_from_slice(&new_ia.to_be_bytes()); // 2-byte New Individual Address
    cemi.extend_from_slice(&[0x00, 0x00]); // 2-byte Domain Address / Subnet
    cemi
}

/// Builds point-to-point T_Connect cEMI frame (Message Code 0x11, TPCI 0x80)
pub fn build_cemi_t_connect(target_ia: u16) -> Vec<u8> {
    let mut cemi = Vec::with_capacity(10);
    cemi.push(0x11); // Message Code: L_Data.req
    cemi.push(0x00); // Additional Info len = 0
    cemi.push(0xB2); // Control 1: Standard frame, System Priority, Ack requested
    cemi.push(0x60); // Control 2: Individual address destination, Hop count 6
    cemi.extend_from_slice(&[0x00, 0x00]); // Source
    cemi.extend_from_slice(&target_ia.to_be_bytes()); // Destination IA
    cemi.push(0x00); // Data length = 0
    cemi.push(0x80); // TPCI: 0x80 (T_Connect UCD)
    cemi
}

/// Builds point-to-point T_Disconnect cEMI frame (Message Code 0x11, TPCI 0x81)
pub fn build_cemi_t_disconnect(target_ia: u16) -> Vec<u8> {
    let mut cemi = Vec::with_capacity(10);
    cemi.push(0x11); // Message Code: L_Data.req
    cemi.push(0x00); // Additional Info len = 0
    cemi.push(0xB2); // Control 1: Standard frame, System Priority, Ack requested
    cemi.push(0x60); // Control 2: Individual address destination, Hop count 6
    cemi.extend_from_slice(&[0x00, 0x00]); // Source
    cemi.extend_from_slice(&target_ia.to_be_bytes()); // Destination IA
    cemi.push(0x00); // Data length = 0
    cemi.push(0x81); // TPCI: 0x81 (T_Disconnect UCD)
    cemi
}

/// Builds point-to-point T_ACK cEMI frame (Message Code 0x11, NCD ACK)
pub fn build_cemi_t_ack(target_ia: u16, seq: u8) -> Vec<u8> {
    let mut cemi = Vec::with_capacity(10);
    cemi.push(0x11); // Message Code: L_Data.req
    cemi.push(0x00); // Additional Info len = 0
    cemi.push(0xB2); // Control 1: Standard frame, System Priority, Ack requested
    cemi.push(0x60); // Control 2: Individual address destination, Hop count 6
    cemi.extend_from_slice(&[0x00, 0x00]); // Source
    cemi.extend_from_slice(&target_ia.to_be_bytes()); // Destination IA
    cemi.push(0x00); // Data length = 0
    cemi.push(0xC2 | ((seq & 0x0F) << 2)); // TPCI: NCD ACK with sequence number
    cemi
}

/// Builds point-to-point A_DeviceDescriptor_Read cEMI frame (Message Code 0x11, APCI 0x0000 | desc_type)
/// When `connection_oriented` is true, sends Numbered Data Packet (NDP, TPCI: 0x40). Otherwise UDP (0x00).
pub fn build_cemi_device_descriptor_read(target_ia: u16, desc_type: u8) -> Vec<u8> {
    build_cemi_device_descriptor_read_ex(target_ia, desc_type, true)
}

/// Builds point-to-point A_DeviceDescriptor_Read cEMI frame with explicit NDP or UDP
pub fn build_cemi_device_descriptor_read_ex(target_ia: u16, desc_type: u8, connection_oriented: bool) -> Vec<u8> {
    let mut cemi = Vec::with_capacity(11);
    cemi.push(0x11); // Message Code: L_Data.req
    cemi.push(0x00); // Additional Info len = 0
    cemi.push(0xB2); // Control 1: Standard frame, System priority, Ack requested
    cemi.push(0x60); // Control 2: Individual address destination, Hop count 6
    cemi.extend_from_slice(&[0x00, 0x00]); // Source
    cemi.extend_from_slice(&target_ia.to_be_bytes()); // Destination IA
    cemi.push(0x01); // Data length = 1
    cemi.push(if connection_oriented { 0x40 } else { 0x00 }); // TPCI: 0x40 (NDP) or 0x00 (UDP)
    cemi.push(desc_type & 0x3F); // APCI bits 7..6: 0x00, Descriptor type in lower 6 bits
    cemi
}

/// Builds point-to-point A_PropertyValue_Read cEMI frame (Message Code 0x11, APCI 0x03D5)
pub fn build_cemi_property_value_read(
    target_ia: u16,
    obj_index: u8,
    prop_id: u8,
    count: u8,
    start_index: u16,
) -> Vec<u8> {
    let mut cemi = Vec::with_capacity(15);
    cemi.push(0x11); // Message Code: L_Data.req
    cemi.push(0x00); // Additional Info len = 0
    cemi.push(0xB2); // Control 1: System Priority, Ack requested
    cemi.push(0x60); // Control 2: Individual address
    cemi.extend_from_slice(&[0x00, 0x00]);
    cemi.extend_from_slice(&target_ia.to_be_bytes());
    cemi.push(0x05); // Data length = 5
    cemi.push(0x03); // TPCI: 0x00, APCI bits 9..8: 0x03
    cemi.push(0xD5); // APCI bits 7..0: 0xD5 (A_PropertyValue_Read)
    cemi.push(obj_index);
    cemi.push(prop_id);
    let count_start = ((count as u16 & 0x0F) << 12) | (start_index & 0x0FFF);
    cemi.extend_from_slice(&count_start.to_be_bytes());
    cemi
}

/// Builds point-to-point A_Restart cEMI frame
/// Builds a connected Numbered Data Packet (NDT) cEMI frame (Message Code 0x11, L_Data.req)
/// with 4-bit sequence counter (seq 0..15 modulo 16) and 10-bit APCI
pub fn build_cemi_t_data_connected(target_ia: u16, seq: u8, apci: u16, payload: &[u8]) -> Vec<u8> {
    let mut cemi = Vec::with_capacity(10 + payload.len());
    cemi.push(0x11); // Message Code: L_Data.req
    cemi.push(0x00); // Additional Info len = 0
    cemi.push(0xB2); // Control 1: System Priority, Ack requested
    cemi.push(0x60); // Control 2: Individual address, Hop count 6
    cemi.extend_from_slice(&[0x00, 0x00]); // Source (gateway fills in assigned IA)
    cemi.extend_from_slice(&target_ia.to_be_bytes()); // Destination IA
    cemi.push((1 + payload.len()) as u8); // Data len: 1 byte APCI_low + payload
    // TPCI: 0x40 (NDT) | 4-bit sequence number (seq & 0x0F) << 2 | APCI bits 9..8
    let tpci = 0x40 | ((seq & 0x0F) << 2) | ((apci >> 8) as u8 & 0x03);
    cemi.push(tpci);
    cemi.push((apci & 0xFF) as u8);
    cemi.extend_from_slice(payload);
    cemi
}

/// Builds connected A_Authorize_Request (APCI 0x03D1, 4-byte key)
pub fn build_cemi_authorize_request_connected(target_ia: u16, seq: u8, key: &[u8; 4]) -> Vec<u8> {
    build_cemi_t_data_connected(target_ia, seq, 0x03D1, key)
}

/// Builds connected A_DeviceDescriptor_Read (System B APCI 0x0300 | desc_type)
pub fn build_cemi_device_descriptor_read_connected(target_ia: u16, seq: u8, desc_type: u8) -> Vec<u8> {
    build_cemi_t_data_connected(target_ia, seq, 0x0300 | (desc_type as u16 & 0x3F), &[])
}

/// Builds connected A_PropertyValue_Read (APCI 0x03D5)
pub fn build_cemi_property_value_read_connected(
    target_ia: u16,
    seq: u8,
    obj_index: u8,
    prop_id: u8,
    count: u8,
    start_index: u16,
) -> Vec<u8> {
    let count_start = ((count as u16 & 0x0F) << 12) | (start_index & 0x0FFF);
    let mut payload = Vec::with_capacity(4);
    payload.push(obj_index);
    payload.push(prop_id);
    payload.extend_from_slice(&count_start.to_be_bytes());
    build_cemi_t_data_connected(target_ia, seq, 0x03D5, &payload)
}

/// Builds connected A_PropertyValue_Write (APCI 0x03D7)
pub fn build_cemi_property_value_write_connected(
    target_ia: u16,
    seq: u8,
    obj_index: u8,
    prop_id: u8,
    count: u8,
    start_index: u16,
    data: &[u8],
) -> Vec<u8> {
    let count_start = ((count as u16 & 0x0F) << 12) | (start_index & 0x0FFF);
    let mut payload = Vec::with_capacity(4 + data.len());
    payload.push(obj_index);
    payload.push(prop_id);
    payload.extend_from_slice(&count_start.to_be_bytes());
    payload.extend_from_slice(data);
    build_cemi_t_data_connected(target_ia, seq, 0x03D7, &payload)
}

/// Builds connected A_Memory_Write (APCI 0x0280 | count)
pub fn build_cemi_memory_write_connected(
    target_ia: u16,
    seq: u8,
    address: u16,
    data: &[u8],
) -> Vec<u8> {
    let count = (data.len() as u8).clamp(1, 64) & 0x3F;
    let mut payload = Vec::with_capacity(2 + data.len());
    payload.extend_from_slice(&address.to_be_bytes());
    payload.extend_from_slice(data);
    build_cemi_t_data_connected(target_ia, seq, 0x0280 | count as u16, &payload)
}

/// Builds connected A_Memory_Read (APCI 0x0200 | count)
pub fn build_cemi_memory_read_connected(
    target_ia: u16,
    seq: u8,
    address: u16,
    count: u8,
) -> Vec<u8> {
    let count_clamped = count.clamp(1, 64) & 0x3F;
    let payload = address.to_be_bytes();
    build_cemi_t_data_connected(target_ia, seq, 0x0200 | count_clamped as u16, &payload)
}

/// Builds connected A_Restart (APCI 0x0380)
pub fn build_cemi_restart_connected(target_ia: u16, seq: u8) -> Vec<u8> {
    build_cemi_t_data_connected(target_ia, seq, 0x0380, &[])
}

/// Builds point-to-point A_Restart cEMI frame (Unconnected)
pub fn build_cemi_restart(target_ia: u16) -> Vec<u8> {
    let mut cemi = Vec::with_capacity(11);
    cemi.push(0x11);
    cemi.push(0x00);
    cemi.push(0xB2);
    cemi.push(0x60);
    cemi.extend_from_slice(&[0x00, 0x00]);
    cemi.extend_from_slice(&target_ia.to_be_bytes());
    cemi.push(0x01);
    cemi.push(0x03);
    cemi.push(0x80); // 0x0380 = A_Restart
    cemi
}

/// Builds point-to-point A_Memory_Read cEMI frame (Message Code 0x11, APCI 0x0200 | count)
/// Data length = 3 (1 byte APCI/count + 2 bytes address)
pub fn build_cemi_memory_read(target_ia: u16, address: u16, count: u8) -> Vec<u8> {
    let count_clamped = count.clamp(1, 64) & 0x3F;
    let mut cemi = Vec::with_capacity(14);
    cemi.push(0x11); // Message Code: L_Data.req
    cemi.push(0x00); // Additional Info len = 0
    cemi.push(0xB2); // Control 1: System Priority, Ack requested
    cemi.push(0x60); // Control 2: Individual address, Hop count 6
    cemi.extend_from_slice(&[0x00, 0x00]); // Source
    cemi.extend_from_slice(&target_ia.to_be_bytes()); // Destination IA
    cemi.push(0x03); // Data length = 3
    cemi.push(0x42); // TPCI: 0x40 (NDP) | APCI bits 9..8: 0x02
    cemi.push(count_clamped); // APCI bits 7..6: 0x00, lower 6 bits: count
    cemi.extend_from_slice(&address.to_be_bytes()); // Memory address
    cemi
}

/// Builds point-to-point A_Memory_Write cEMI frame (Message Code 0x11, APCI 0x0280 | count)
/// Data length = 3 + data.len() (1 byte APCI/count + 2 bytes address + data bytes)
pub fn build_cemi_memory_write(target_ia: u16, address: u16, data: &[u8]) -> Vec<u8> {
    let count = (data.len() as u8).clamp(1, 64) & 0x3F;
    let mut cemi = Vec::with_capacity(14 + data.len());
    cemi.push(0x11); // Message Code: L_Data.req
    cemi.push(0x00); // Additional Info len = 0
    cemi.push(0xB2); // Control 1: System Priority, Ack requested
    cemi.push(0x60); // Control 2: Individual address, Hop count 6
    cemi.extend_from_slice(&[0x00, 0x00]); // Source
    cemi.extend_from_slice(&target_ia.to_be_bytes()); // Destination IA
    cemi.push(3 + count); // Data length = 3 + count
    cemi.push(0x42); // TPCI: 0x40 (NDP) | APCI bits 9..8: 0x02
    cemi.push(0x80 | count); // APCI bits 7..6: 0x02 (0x80 = write), lower 6 bits: count
    cemi.extend_from_slice(&address.to_be_bytes()); // Memory address
    cemi.extend_from_slice(data); // Payload bytes
    cemi
}

/// Builds point-to-point A_PropertyValue_Write cEMI frame (Message Code 0x11, APCI 0x03D7)
pub fn build_cemi_property_value_write(
    target_ia: u16,
    obj_index: u8,
    prop_id: u8,
    count: u8,
    start_index: u16,
    data: &[u8],
) -> Vec<u8> {
    let mut cemi = Vec::with_capacity(15 + data.len());
    cemi.push(0x11); // Message Code: L_Data.req
    cemi.push(0x00); // Additional Info len = 0
    cemi.push(0xB2); // Control 1: System Priority, Ack requested
    cemi.push(0x60); // Control 2: Individual address, Hop count 6
    cemi.extend_from_slice(&[0x00, 0x00]); // Source
    cemi.extend_from_slice(&target_ia.to_be_bytes()); // Destination IA
    cemi.push(5 + data.len() as u8); // Data length = 5 + data
    cemi.push(0x43); // TPCI: 0x40 (NDP) | APCI bits 9..8: 0x03
    cemi.push(0xD7); // APCI bits 7..0: 0xD7 (A_PropertyValue_Write)
    cemi.push(obj_index);
    cemi.push(prop_id);
    let count_start = ((count as u16 & 0x0F) << 12) | (start_index & 0x0FFF);
    cemi.extend_from_slice(&count_start.to_be_bytes());
    cemi.extend_from_slice(data);
    cemi
}

/// Builds TUNNELLING_REQUEST frame wrapping raw cEMI bytes
pub fn build_tunnelling_request_raw(
    channel_id: u8,
    seq_counter: u8,
    cemi: &[u8],
) -> Vec<u8> {
    let total_len = (6 + 4 + cemi.len()) as u16;
    let mut pkt = Vec::with_capacity(total_len as usize);
    pkt.extend_from_slice(&[0x06, 0x10, 0x04, 0x20]);
    pkt.extend_from_slice(&total_len.to_be_bytes());
    pkt.extend_from_slice(&[0x04, channel_id, seq_counter, 0x00]);
    pkt.extend_from_slice(cemi);
    pkt
}


/// Builds SEARCH_REQUEST frame
pub fn build_search_request(local_ip: [u8; 4], local_port: u16) -> Vec<u8> {
    let mut pkt = Vec::with_capacity(14);
    // KNXnet/IP Header (6 bytes)
    pkt.extend_from_slice(&[0x06, 0x10, 0x02, 0x01, 0x00, 0x0E]);
    // HPAI Control Endpoint (8 bytes)
    pkt.extend_from_slice(&[
        0x08,
        0x01,
        local_ip[0],
        local_ip[1],
        local_ip[2],
        local_ip[3],
        (local_port >> 8) as u8,
        (local_port & 0xFF) as u8,
    ]);
    pkt
}

/// Parses SEARCH_RESPONSE frame
pub fn parse_search_response(buf: &[u8], src_ip: Ipv4Addr) -> Option<DiscoveredGateway> {
    if buf.len() < 14 || buf[0] != 0x06 || buf[1] != 0x10 {
        return None;
    }
    let service_type = u16::from_be_bytes([buf[2], buf[3]]);
    if service_type != SERVICE_SEARCH_RES {
        return None;
    }

    // Control Endpoint (HPAI)
    let ctrl_port = if buf.len() >= 14 && buf[6] == 0x08 {
        u16::from_be_bytes([buf[12], buf[13]])
    } else {
        KNX_PORT
    };

    let mut device_name = format!("KNX IP Gateway ({})", src_ip);
    let mut ind_addr = "1.1.250".to_string();
    let mut mac_addr = "00:00:00:00:00:00".to_string();
    let mut medium = "TP1".to_string();

    // Parse DIBs starting after HPAI (offset 14)
    let mut offset = 14;
    while offset + 2 <= buf.len() {
        let dib_len = buf[offset] as usize;
        let dib_type = buf[offset + 1];
        if dib_len == 0 || offset + dib_len > buf.len() {
            break;
        }

        if dib_type == 0x01 && dib_len >= 54 {
            // Device Info DIB
            let med_code = buf[offset + 2];
            medium = match med_code {
                0x02 => "TP1 (Twisted Pair)".to_string(),
                0x04 => "PL110 (Powerline)".to_string(),
                0x08 => "RF (Radio Frequency)".to_string(),
                0x20 => "IP (Ethernet)".to_string(),
                _ => format!("Medium 0x{:02X}", med_code),
            };

            let ia_raw = u16::from_be_bytes([buf[offset + 4], buf[offset + 5]]);
            ind_addr = format_individual_address(ia_raw);

            // MAC (offset 12..18)
            let mac_slice = &buf[offset + 12..offset + 18];
            mac_addr = format!(
                "{:02X}:{:02X}:{:02X}:{:02X}:{:02X}:{:02X}",
                mac_slice[0], mac_slice[1], mac_slice[2], mac_slice[3], mac_slice[4], mac_slice[5]
            );

            // Device Friendly Name (offset 24..54, 30 bytes)
            let name_bytes = &buf[offset + 24..offset + 54];
            let name_str = String::from_utf8_lossy(name_bytes)
                .trim_matches(char::from(0))
                .trim()
                .to_string();
            if !name_str.is_empty() {
                device_name = name_str;
            }
        }

        offset += dib_len;
    }

    Some(DiscoveredGateway {
        ip: src_ip.to_string(),
        port: ctrl_port,
        name: device_name,
        individual_address: ind_addr,
        mac_address: mac_addr,
        medium,
    })
}

/// Builds CONNECT_REQUEST frame for Tunneling
pub fn build_connect_request(local_ip: [u8; 4], local_port: u16) -> Vec<u8> {
    let mut pkt = Vec::with_capacity(26);
    // Header
    pkt.extend_from_slice(&[0x06, 0x10, 0x02, 0x05, 0x00, 0x1A]);
    // HPAI Control Endpoint
    pkt.extend_from_slice(&[
        0x08,
        0x01,
        local_ip[0],
        local_ip[1],
        local_ip[2],
        local_ip[3],
        (local_port >> 8) as u8,
        (local_port & 0xFF) as u8,
    ]);
    // HPAI Data Endpoint
    pkt.extend_from_slice(&[
        0x08,
        0x01,
        local_ip[0],
        local_ip[1],
        local_ip[2],
        local_ip[3],
        (local_port >> 8) as u8,
        (local_port & 0xFF) as u8,
    ]);
    // CRI: Tunneling Layer Link (4 bytes)
    pkt.extend_from_slice(&[0x04, 0x04, 0x02, 0x00]);
    pkt
}

/// Parses CONNECT_RESPONSE frame: returns (channel_id, status, data_ip, data_port, assigned_ia)
pub fn parse_connect_response(buf: &[u8]) -> Option<(u8, u8, [u8; 4], u16, String)> {
    if buf.len() < 8 || buf[0] != 0x06 || buf[1] != 0x10 {
        return None;
    }
    let service_type = u16::from_be_bytes([buf[2], buf[3]]);
    if service_type != SERVICE_CONNECT_RES {
        return None;
    }

    let channel_id = buf[6];
    let status = buf[7];

    let mut data_ip = [0u8; 4];
    let mut data_port = KNX_PORT;
    let mut assigned_ia = "1.1.255".to_string();

    if status == 0 && buf.len() >= 16 {
        // Server Data Endpoint HPAI
        if buf[8] == 0x08 {
            data_ip.copy_from_slice(&buf[10..14]);
            data_port = u16::from_be_bytes([buf[14], buf[15]]);
        }
        // CRD
        if buf.len() >= 20 && buf[16] == 0x04 {
            let ia_raw = u16::from_be_bytes([buf[18], buf[19]]);
            assigned_ia = format_individual_address(ia_raw);
        }
    }

    Some((channel_id, status, data_ip, data_port, assigned_ia))
}

/// Builds CONNECTIONSTATE_REQUEST frame
pub fn build_connectionstate_request(channel_id: u8, local_ip: [u8; 4], local_port: u16) -> Vec<u8> {
    let mut pkt = Vec::with_capacity(16);
    pkt.extend_from_slice(&[0x06, 0x10, 0x02, 0x07, 0x00, 0x10]);
    pkt.push(channel_id);
    pkt.push(0x00); // reserved
    pkt.extend_from_slice(&[
        0x08,
        0x01,
        local_ip[0],
        local_ip[1],
        local_ip[2],
        local_ip[3],
        (local_port >> 8) as u8,
        (local_port & 0xFF) as u8,
    ]);
    pkt
}

/// Builds DISCONNECT_REQUEST frame
pub fn build_disconnect_request(channel_id: u8, local_ip: [u8; 4], local_port: u16) -> Vec<u8> {
    let mut pkt = Vec::with_capacity(16);
    pkt.extend_from_slice(&[0x06, 0x10, 0x02, 0x09, 0x00, 0x10]);
    pkt.push(channel_id);
    pkt.push(0x00);
    pkt.extend_from_slice(&[
        0x08,
        0x01,
        local_ip[0],
        local_ip[1],
        local_ip[2],
        local_ip[3],
        (local_port >> 8) as u8,
        (local_port & 0xFF) as u8,
    ]);
    pkt
}

/// Builds TUNNELLING_ACK frame
pub fn build_tunnelling_ack(channel_id: u8, seq_counter: u8, status: u8) -> Vec<u8> {
    vec![
        0x06, 0x10, 0x04, 0x21, 0x00, 0x0A, 0x04, channel_id, seq_counter, status,
    ]
}

/// Builds TUNNELLING_REQUEST frame with L_Data.req cEMI frame
pub fn build_tunnelling_request(
    channel_id: u8,
    seq_counter: u8,
    dest_ga: &str,
    dpt: &str,
    value: &serde_json::Value,
) -> Option<Vec<u8>> {
    let ga_raw = parse_group_address(dest_ga)?;

    let mut cemi = vec![
        0x11, // Message Code: L_Data.req
        0x00, // Additional Info length = 0
        0xBC, // Control 1: Standard frame, Priority normal
        0xE0, // Control 2: Group address destination, Hop count 6
    ];
    cemi.extend_from_slice(&[0x00, 0x00]); // Source address (filled by interface)
    cemi.extend_from_slice(&ga_raw.to_be_bytes()); // Destination Group Address

    if dpt.starts_with("1.") {
        // 1-bit boolean (Switch, Move, etc.)
        let is_on = value.as_bool().unwrap_or(false);
        cemi.push(0x01); // Data length = 1
        cemi.push(0x00); // TPCI: UDP
        cemi.push(if is_on { 0x81 } else { 0x80 }); // APCI: GroupValue_Write with 1-bit data
    } else if dpt.starts_with("5.") {
        // 8-bit scaling (0..100% -> 0..255)
        let pct = value.as_u64().unwrap_or(0).min(100) as f64;
        let val_byte = (pct * 255.0 / 100.0).round() as u8;
        cemi.push(0x02); // Data length = 2
        cemi.push(0x00); // TPCI: UDP
        cemi.push(0x80); // APCI: GroupValue_Write
        cemi.push(val_byte);
    } else if dpt.starts_with("9.") {
        // 2-byte float (Temperature)
        let temp = value.as_f64().unwrap_or(20.0);
        let float_bytes = encode_knx_float2(temp as f32);
        cemi.push(0x03);
        cemi.push(0x00);
        cemi.push(0x80);
        cemi.extend_from_slice(&float_bytes);
    } else if dpt.starts_with("18.") {
        // Scene control (1-byte)
        let scn = value.as_u64().unwrap_or(1).saturating_sub(1) as u8;
        cemi.push(0x02);
        cemi.push(0x00);
        cemi.push(0x80);
        cemi.push(scn & 0x3F);
    } else {
        // Default 1-bit write
        cemi.push(0x01);
        cemi.push(0x00);
        cemi.push(0x81);
    }

    let total_len = (6 + 4 + cemi.len()) as u16;
    let mut pkt = Vec::with_capacity(total_len as usize);
    // Header
    pkt.extend_from_slice(&[0x06, 0x10, 0x04, 0x20]);
    pkt.extend_from_slice(&total_len.to_be_bytes());
    // Tunnelling Request header
    pkt.extend_from_slice(&[0x04, channel_id, seq_counter, 0x00]);
    // cEMI
    pkt.extend_from_slice(&cemi);

    Some(pkt)
}

/// Parses an incoming TUNNELLING_REQUEST frame with cEMI
pub fn parse_tunnelling_request(buf: &[u8]) -> Option<(u8, u8, KnxTelegram)> {
    if buf.len() < 20 || buf[0] != 0x06 || buf[1] != 0x10 {
        return None;
    }
    let service = u16::from_be_bytes([buf[2], buf[3]]);
    if service != SERVICE_TUNNELLING_REQ {
        return None;
    }

    let channel_id = buf[7];
    let seq_counter = buf[8];

    // cEMI starts at offset 10
    let cemi = &buf[10..];
    if cemi.len() < 10 {
        return None;
    }

    let msg_code = cemi[0];
    let is_req = msg_code == 0x11;
    let _is_ind = msg_code == 0x29;

    let add_info_len = cemi[1] as usize;
    let base = 2 + add_info_len;
    if cemi.len() < base + 8 {
        return None;
    }

    let _ctrl1 = cemi[base];
    let ctrl2 = cemi[base + 1];
    let src_raw = u16::from_be_bytes([cemi[base + 2], cemi[base + 3]]);
    let dest_raw = u16::from_be_bytes([cemi[base + 4], cemi[base + 5]]);
    let is_group = (ctrl2 & 0x80) != 0;

    let source = format_individual_address(src_raw);
    let destination = if is_group {
        format_group_address(dest_raw)
    } else if dest_raw == 0 {
        "0.0.0 (Broadcast)".to_string()
    } else {
        format_individual_address(dest_raw)
    };

    let data_len = cemi[base + 6] as usize;
    if cemi.len() < base + 8 + data_len.saturating_sub(1) {
        return None;
    }

    // APCI detection
    let apci_high = cemi[base + 7];
    let apci_low = cemi.get(base + 8).copied().unwrap_or(0);
    let apci = ((apci_high as u16 & 0x03) << 8) | (apci_low as u16 & 0xC0);
    let apci_full = ((apci_high as u16 & 0x03) << 8) | (apci_low as u16);

    let (tg_type, dpt, value_raw, value_fmt) = if !is_group {
        // Management / Point-to-Point telegram
        let payload = if cemi.len() >= base + 9 {
            cemi[base + 9..base + 8 + data_len].to_vec()
        } else {
            vec![]
        };

        if apci_full == 0x0100 {
            ("ProgMode-Read", "Mgmt", vec![], "Programmiermodus-Suche (Broadcast)".to_string())
        } else if (apci_high & 0x03 == 0x01) && (apci_low & 0xC0 == 0x40) {
            ("ProgMode-Resp", "Mgmt", vec![], format!("Gerät im Programmiermodus: {}", source))
        } else if (apci_high & 0x03 == 0x00) && (apci_low & 0xC0 == 0xC0) {
            let target_addr_str = if payload.len() >= 2 {
                format_individual_address(u16::from_be_bytes([payload[0], payload[1]]))
            } else {
                "Unbekannt".to_string()
            };
            ("Addr-Write", "Mgmt", payload, format!("Physikalische Adresse schreiben: {}", target_addr_str))
        } else if (apci_high & 0x03 == 0x00) && (apci_low & 0xC0 == 0x40) && data_len >= 3 {
            let mask = if payload.len() >= 2 {
                u16::from_be_bytes([payload[0], payload[1]])
            } else {
                0
            };
            let (desc, hex_str) = decode_mask_version(mask);
            ("Descriptor-Resp", "Mgmt", payload, format!("{} ({})", desc, hex_str))
        } else if (apci_high & 0x03 == 0x00) && (apci_low & 0xC0 == 0x00) && (apci_low & 0x3F <= 2) {
            ("Descriptor-Read", "Mgmt", vec![], format!("Gerätedeskriptor Typ {} lesen", apci_low & 0x3F))
        } else if (apci_high & 0x03 == 0x02) && (apci_low & 0xC0 == 0x00) {
            let count = apci_low & 0x3F;
            let mem_addr = if payload.len() >= 2 { u16::from_be_bytes([payload[0], payload[1]]) } else { 0 };
            ("Memory-Read", "Mgmt", payload, format!("Speicher lesen: 0x{:04X} ({} Bytes)", mem_addr, count))
        } else if (apci_high & 0x03 == 0x02) && (apci_low & 0xC0 == 0x40) {
            let count = apci_low & 0x3F;
            let mem_addr = if payload.len() >= 2 { u16::from_be_bytes([payload[0], payload[1]]) } else { 0 };
            ("Memory-Resp", "Mgmt", payload, format!("Speicher Antwort: 0x{:04X} ({} Bytes)", mem_addr, count))
        } else if (apci_high & 0x03 == 0x02) && (apci_low & 0xC0 == 0x80) {
            let count = apci_low & 0x3F;
            let mem_addr = if payload.len() >= 2 { u16::from_be_bytes([payload[0], payload[1]]) } else { 0 };
            ("Memory-Write", "Mgmt", payload, format!("Speicher schreiben: 0x{:04X} ({} Bytes)", mem_addr, count))
        } else if apci_full == 0x03D5 {
            ("PropValue-Read", "Mgmt", payload, "Property Wert lesen".to_string())
        } else if apci_full == 0x03D6 {
            ("PropValue-Resp", "Mgmt", payload, "Property Wert Antwort".to_string())
        } else if apci_full == 0x03D7 {
            ("PropValue-Write", "Mgmt", payload, "Property Wert schreiben".to_string())
        } else if apci_full == 0x0380 {
            ("Restart", "Mgmt", vec![], "Geräteneustart (A_Restart)".to_string())
        } else {
            ("Mgmt", "Mgmt", payload, format!("Management APCI 0x{:04X}", apci_full))
        }
    } else if apci == 0x0000 {
        ("Read", "1.001", vec![], "Read Request".to_string())
    } else {
        // Write or Response
        let tg_name = if is_req { "Write" } else { "Response" };
        if data_len <= 1 {
            // 1-bit boolean inside lowest bit of apci_low
            let bit_val = (apci_low & 0x01) == 1;
            (
                tg_name,
                "1.001",
                vec![if bit_val { 1 } else { 0 }],
                if bit_val { "EIN (1)".to_string() } else { "AUS (0)".to_string() },
            )
        } else {
            // Multi-byte data starts at offset base + 9
            let payload = if cemi.len() >= base + 9 {
                cemi[base + 9..base + 8 + data_len].to_vec()
            } else {
                vec![]
            };

            if payload.len() == 1 {
                let pct = (payload[0] as f64 * 100.0 / 255.0).round() as u8;
                (tg_name, "5.001", payload, format!("{} %", pct))
            } else if payload.len() == 2 {
                let temp = decode_knx_float2([payload[0], payload[1]]);
                (tg_name, "9.001", payload, format!("{:.1} °C", temp))
            } else {
                let hex = payload.iter().map(|b| format!("{:02X}", b)).collect::<Vec<_>>().join(" ");
                (tg_name, "var", payload, hex)
            }
        }
    };

    let now = Utc::now().format("%H:%M:%S%.3f").to_string();
    let telegram = KnxTelegram {
        id: Uuid::new_v4(),
        timestamp: now,
        source,
        destination,
        dpt: dpt.to_string(),
        value_raw,
        value_formatted: value_fmt,
        telegram_type: tg_type.to_string(),
    };

    Some((channel_id, seq_counter, telegram))
}

/// Encodes f32 to 2-byte KNX float (DPT 9.xxx)
pub fn encode_knx_float2(value: f32) -> [u8; 2] {
    let sign = if value < 0.0 { 0x8000 } else { 0x0000 };
    let abs_val = value.abs() * 100.0;
    let mut mantissa = abs_val as i32;
    let mut exponent = 0i32;

    while mantissa > 2047 && exponent < 15 {
        mantissa >>= 1;
        exponent += 1;
    }

    if value < 0.0 {
        mantissa = -mantissa & 0x07FF;
    }

    let raw = sign | ((exponent as u16 & 0x0F) << 11) | (mantissa as u16 & 0x07FF);
    raw.to_be_bytes()
}

/// Decodes 2-byte KNX float (DPT 9.xxx) to f32
pub fn decode_knx_float2(bytes: [u8; 2]) -> f32 {
    let raw = u16::from_be_bytes(bytes);
    let sign = (raw & 0x8000) != 0;
    let exponent = ((raw >> 11) & 0x0F) as i32;
    let mut mantissa = (raw & 0x07FF) as i32;

    if sign {
        mantissa -= 2048;
    }

    (0.01 * mantissa as f32) * (1 << exponent) as f32
}

// ==========================================
// KNXnet/IP Tunnel Manager
use crate::knx_secure::{
    establish_secure_session, unwrap_secure_frame, wrap_secure_frame, CLIENT_SERIAL,
    SERVICE_SECURE_WRAPPER,
};

pub enum ActiveTransport {
    PlainUdp {
        socket: Arc<UdpSocket>,
        data_endpoint: SocketAddr,
    },
    SecureTcp {
        writer: Arc<Mutex<tokio::net::tcp::OwnedWriteHalf>>,
        session_key: [u8; 16],
        session_id: u16,
        seq_out: Arc<AtomicU64>,
        serial: [u8; 6],
    },
}

struct ActiveConnection {
    channel_id: u8,
    gateway_ip: Ipv4Addr,
    gateway_port: u16,
    transport: ActiveTransport,
    seq_counter: AtomicU8,
    assigned_ia: String,
    gateway_name: String,
}

pub struct KnxNetManager {
    simulator: Arc<Simulator>,
    socket: Arc<Mutex<Option<Arc<UdpSocket>>>>,
    connection: Arc<RwLock<Option<ActiveConnection>>>,
    telegrams_sent: Arc<AtomicU64>,
    telegrams_received: Arc<AtomicU64>,
    last_heartbeat: Arc<RwLock<Option<String>>>,
    pub tx_cemi: broadcast::Sender<Vec<u8>>,
}

impl KnxNetManager {
    pub fn new(simulator: Arc<Simulator>) -> Self {
        let (tx_cemi, _) = broadcast::channel(300);
        Self {
            simulator,
            socket: Arc::new(Mutex::new(None)),
            connection: Arc::new(RwLock::new(None)),
            telegrams_sent: Arc::new(AtomicU64::new(0)),
            telegrams_received: Arc::new(AtomicU64::new(0)),
            last_heartbeat: Arc::new(RwLock::new(None)),
            tx_cemi,
        }
    }

    /// Subscribes to raw incoming cEMI frames (useful for diagnostic scans and management APDUs)
    pub fn subscribe_cemi(&self) -> broadcast::Receiver<Vec<u8>> {
        self.tx_cemi.subscribe()
    }


    /// Discovers KNXnet/IP Gateways via UDP Multicast (224.0.23.12:3671)
    pub async fn discover(&self, timeout_ms: u64) -> Vec<DiscoveredGateway> {
        let mut gateways = Vec::new();

        let socket = match UdpSocket::bind("0.0.0.0:0").await {
            Ok(s) => s,
            Err(e) => {
                warn!("Failed to bind UDP socket for KNX discovery: {}", e);
                return gateways;
            }
        };

        let local_addr = match socket.local_addr() {
            Ok(a) => a,
            Err(_) => return gateways,
        };

        let local_port = local_addr.port();
        let search_pkt = build_search_request([0, 0, 0, 0], local_port);
        let mcast_target = format!("{}:{}", KNX_MULTICAST_IP, KNX_PORT);

        if let Err(e) = socket.send_to(&search_pkt, &mcast_target).await {
            warn!("Failed to send KNX multicast discovery request: {}", e);
            return gateways;
        }

        let mut buf = [0u8; 1024];
        let deadline = tokio::time::Instant::now() + Duration::from_millis(timeout_ms);

        while tokio::time::Instant::now() < deadline {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            match tokio::time::timeout(remaining, socket.recv_from(&mut buf)).await {
                Ok(Ok((len, peer))) => {
                    if let SocketAddr::V4(v4) = peer {
                        let src_ip = *v4.ip();
                        if let Some(gw) = parse_search_response(&buf[..len], src_ip) {
                            if !gateways.iter().any(|g: &DiscoveredGateway| g.ip == gw.ip) {
                                gateways.push(gw);
                            }
                        }
                    }
                }
                _ => break,
            }
        }

        gateways
    }

    /// Connects to a specific KNXnet/IP Gateway and establishes Tunnel connection (Plain UDP or Secure TCP)
    pub async fn connect(
        &self,
        ip_str: &str,
        port: u16,
        secure: Option<KnxSecureCredentials>,
    ) -> Result<String, String> {
        let target_ip: Ipv4Addr = ip_str.parse().map_err(|e| format!("Invalid IP: {}", e))?;
        let target_addr = SocketAddr::V4(SocketAddrV4::new(target_ip, port));

        // Disconnect previous connection if exists
        self.disconnect().await?;

        if let Some(creds) = secure {
            // ==========================================
            // KNX IP SECURE TCP TUNNEL
            // ==========================================
            let mut sec_session = establish_secure_session(target_addr, &creds).await?;

            let hpai_tcp = [0x08, 0x02, 0, 0, 0, 0, 0, 0];
            let cri = [0x04, 0x04, 0x02, 0x00]; // Tunneling TP1
            let mut conn_req_pkt = Vec::with_capacity(26);
            conn_req_pkt.extend_from_slice(&[0x06, 0x10, 0x02, 0x05, 0x00, 0x1A]);
            conn_req_pkt.extend_from_slice(&hpai_tcp);
            conn_req_pkt.extend_from_slice(&hpai_tcp);
            conn_req_pkt.extend_from_slice(&cri);

            let seq_out = Arc::new(AtomicU64::new(1));
            let wrapped_conn_req = wrap_secure_frame(
                &sec_session.session_key,
                sec_session.session_id,
                seq_out.fetch_add(1, Ordering::SeqCst),
                &CLIENT_SERIAL,
                &conn_req_pkt,
            );

            sec_session
                .stream
                .write_all(&wrapped_conn_req)
                .await
                .map_err(|e| format!("Failed to send CONNECT_REQUEST over Secure TCP: {}", e))?;

            let mut wrap_hdr = [0u8; 6];
            tokio::time::timeout(Duration::from_millis(6000), sec_session.stream.read_exact(&mut wrap_hdr))
                .await
                .map_err(|_| "Gateway timed out waiting for CONNECT_RESPONSE".to_string())?
                .map_err(|e| format!("Read error: {}", e))?;

            let wrap_len = u16::from_be_bytes([wrap_hdr[4], wrap_hdr[5]]) as usize;
            if wrap_len < 6 + 16 + 16 {
                return Err(format!("SECURE_WRAPPER for CONNECT_RESPONSE too short: {}", wrap_len));
            }
            let mut wrap_rest = vec![0u8; wrap_len - 6];
            sec_session
                .stream
                .read_exact(&mut wrap_rest)
                .await
                .map_err(|e| format!("Read error: {}", e))?;

            let mut full_wrap = Vec::with_capacity(wrap_len);
            full_wrap.extend_from_slice(&wrap_hdr);
            full_wrap.extend_from_slice(&wrap_rest);

            let dec_conn_resp = unwrap_secure_frame(
                &sec_session.session_key,
                sec_session.session_id,
                &full_wrap,
            )?;

            let (channel_id, status, _data_ip, _data_port, assigned_ia) =
                parse_connect_response(&dec_conn_resp)
                    .ok_or_else(|| "Invalid CONNECT_RESPONSE inside SecureWrapper".to_string())?;

            if status != 0 {
                return Err(format!(
                    "Gateway hat Verbindung abgelehnt: Status 0x{:02X}",
                    status
                ));
            }

            info!(
                "KNXnet/IP Secure Tunnel established! Channel ID: {}, Assigned IA: {}, Device Serial: {:02X}:{:02X}:{:02X}:{:02X}:{:02X}:{:02X}",
                channel_id,
                assigned_ia,
                sec_session.serial_number[0],
                sec_session.serial_number[1],
                sec_session.serial_number[2],
                sec_session.serial_number[3],
                sec_session.serial_number[4],
                sec_session.serial_number[5]
            );

            let (reader, writer) = sec_session.stream.into_split();
            let writer = Arc::new(Mutex::new(writer));

            let active = ActiveConnection {
                channel_id,
                gateway_ip: target_ip,
                gateway_port: port,
                transport: ActiveTransport::SecureTcp {
                    writer: writer.clone(),
                    session_key: sec_session.session_key,
                    session_id: sec_session.session_id,
                    seq_out: seq_out.clone(),
                    serial: CLIENT_SERIAL,
                },
                seq_counter: AtomicU8::new(0),
                assigned_ia: assigned_ia.clone(),
                gateway_name: format!("KNX Secure Gateway {}", target_ip),
            };

            {
                let mut conn_guard = self.connection.write().await;
                *conn_guard = Some(active);
            }

            let now_str = Utc::now().format("%H:%M:%S").to_string();
            *self.last_heartbeat.write().await = Some(now_str);

            self.spawn_secure_tcp_listener_and_heartbeat(
                reader,
                writer,
                sec_session.session_key,
                sec_session.session_id,
                seq_out,
                CLIENT_SERIAL,
                channel_id,
            );

            Ok(format!(
                "Erfolgreich verbunden über KNX IP Secure mit {} (Kanal {}, IA {})",
                target_ip, channel_id, assigned_ia
            ))
        } else {
            // ==========================================
            // STANDARD PLAIN UDP TUNNEL
            // ==========================================
            // Determine local IP by routing to target_addr
            let local_ip = match UdpSocket::bind("0.0.0.0:0").await {
                Ok(dummy) => match dummy.connect(target_addr).await {
                    Ok(_) => match dummy.local_addr() {
                        Ok(SocketAddr::V4(v4)) => *v4.ip(),
                        _ => Ipv4Addr::new(0, 0, 0, 0),
                    },
                    Err(_) => Ipv4Addr::new(0, 0, 0, 0),
                },
                Err(_) => Ipv4Addr::new(0, 0, 0, 0),
            };

            let socket = UdpSocket::bind("0.0.0.0:0")
                .await
                .map_err(|e| format!("UDP bind error: {}", e))?;
            let local_port = socket.local_addr().unwrap().port();
            let socket = Arc::new(socket);

            let conn_req = build_connect_request(local_ip.octets(), local_port);

            socket
                .send_to(&conn_req, &target_addr)
                .await
                .map_err(|e| format!("Failed to send CONNECT_REQUEST: {}", e))?;

            let mut buf = [0u8; 1024];
            let res = tokio::time::timeout(Duration::from_millis(3000), socket.recv_from(&mut buf))
                .await
                .map_err(|_| "Gateway connection timeout (3000ms)".to_string())?
                .map_err(|e| format!("Recv error: {}", e))?;

            let (channel_id, status, data_ip, data_port, assigned_ia) =
                parse_connect_response(&buf[..res.0])
                    .ok_or_else(|| "Invalid CONNECT_RESPONSE frame".to_string())?;

            if status != 0 {
                let detail = match status {
                    0x22 => " (E_CONNECTION_TYPE: Verbindungstyp wird nicht unterstützt. Das Gateway verlangt sehr wahrscheinlich KNX IP Secure / gesichertes Tunneling)",
                    0x23 => " (E_CONNECTION_OPTION: Verbindungsoption nicht unterstützt)",
                    0x24 => " (E_NO_MORE_CONNECTIONS: Keine freien Tunnel-Verbindungen mehr verfügbar)",
                    _ => "",
                };
                return Err(format!(
                    "Gateway hat Verbindung abgelehnt: Status 0x{:02X}{}",
                    status, detail
                ));
            }

            let effective_data_ip = if data_ip == [0, 0, 0, 0] {
                target_ip
            } else {
                Ipv4Addr::from(data_ip)
            };
            let effective_data_port = if data_port == 0 { port } else { data_port };
            let data_endpoint =
                SocketAddr::V4(SocketAddrV4::new(effective_data_ip, effective_data_port));

            info!(
                "KNXnet/IP Tunnel established! Channel ID: {}, Assigned IA: {}, Endpoint: {}",
                channel_id, assigned_ia, data_endpoint
            );

            let active = ActiveConnection {
                channel_id,
                gateway_ip: target_ip,
                gateway_port: port,
                transport: ActiveTransport::PlainUdp {
                    socket: socket.clone(),
                    data_endpoint,
                },
                seq_counter: AtomicU8::new(0),
                assigned_ia: assigned_ia.clone(),
                gateway_name: format!("KNX Gateway {}", target_ip),
            };

            {
                let mut conn_guard = self.connection.write().await;
                *conn_guard = Some(active);
            }
            {
                let mut sock_guard = self.socket.lock().await;
                *sock_guard = Some(socket.clone());
            }

            let now_str = Utc::now().format("%H:%M:%S").to_string();
            *self.last_heartbeat.write().await = Some(now_str);

            self.spawn_listener_and_heartbeat(socket, channel_id, target_addr);

            Ok(format!(
                "Erfolgreich verbunden mit KNX Gateway {} (Kanal {}, IA {})",
                target_ip, channel_id, assigned_ia
            ))
        }
    }

    /// Disconnects the active tunnel
    pub async fn disconnect(&self) -> Result<(), String> {
        let (conn_opt, sock_opt) = {
            let conn = self.connection.write().await.take();
            let sock = self.socket.lock().await.take();
            (conn, sock)
        };

        if let Some(conn) = conn_opt {
            match conn.transport {
                ActiveTransport::PlainUdp { data_endpoint, .. } => {
                    if let Some(sock) = sock_opt {
                        let local_port = sock.local_addr().map(|a| a.port()).unwrap_or(0);
                        let disconn_pkt = build_disconnect_request(conn.channel_id, [0, 0, 0, 0], local_port);
                        let _ = sock.send_to(&disconn_pkt, &data_endpoint).await;
                    }
                }
                ActiveTransport::SecureTcp { writer, session_key, session_id, seq_out, serial } => {
                    let hpai_tcp = [0x08, 0x02, 0, 0, 0, 0, 0, 0];
                    let mut disconn_pkt = Vec::with_capacity(16);
                    disconn_pkt.extend_from_slice(&[0x06, 0x10, 0x02, 0x09, 0x00, 0x10]);
                    disconn_pkt.push(conn.channel_id);
                    disconn_pkt.push(0x00);
                    disconn_pkt.extend_from_slice(&hpai_tcp);

                    let seq = seq_out.fetch_add(1, Ordering::SeqCst);
                    let wrapped = wrap_secure_frame(&session_key, session_id, seq, &serial, &disconn_pkt);
                    let mut w = writer.lock().await;
                    let _ = w.write_all(&wrapped).await;
                }
            }
            info!("KNXnet/IP Tunnel disconnected for channel {}", conn.channel_id);
        }

        *self.last_heartbeat.write().await = None;
        Ok(())
    }

    /// Sends a telegram to the physical KNX bus via the active tunnel
    pub async fn send_telegram(
        &self,
        dest_ga: &str,
        dpt: &str,
        value: &serde_json::Value,
    ) -> Result<Option<KnxTelegram>, String> {
        let conn_guard = self.connection.read().await;
        let conn = match &*conn_guard {
            Some(c) => c,
            None => return Ok(None), // Not connected, skip physical send
        };

        let seq = conn.seq_counter.fetch_add(1, Ordering::SeqCst);
        let pkt = build_tunnelling_request(conn.channel_id, seq, dest_ga, dpt, value)
            .ok_or_else(|| "Failed to build TUNNELLING_REQUEST packet".to_string())?;

        match &conn.transport {
            ActiveTransport::PlainUdp { socket, data_endpoint } => {
                socket
                    .send_to(&pkt, data_endpoint)
                    .await
                    .map_err(|e| format!("Failed to send telegram over UDP: {}", e))?;
            }
            ActiveTransport::SecureTcp { writer, session_key, session_id, seq_out, serial } => {
                let seq = seq_out.fetch_add(1, Ordering::SeqCst);
                let wrapped = wrap_secure_frame(session_key, *session_id, seq, serial, &pkt);
                let mut w = writer.lock().await;
                w.write_all(&wrapped)
                    .await
                    .map_err(|e| format!("Failed to send telegram over Secure TCP: {}", e))?;
            }
        }

        self.telegrams_sent.fetch_add(1, Ordering::Relaxed);

        let now = Utc::now().format("%H:%M:%S%.3f").to_string();
        let value_fmt = crate::dpt::format_dpt_json_value(dpt, value);

        let telegram = KnxTelegram {
            id: Uuid::new_v4(),
            timestamp: now,
            source: conn.assigned_ia.clone(),
            destination: dest_ga.to_string(),
            dpt: dpt.to_string(),
            value_raw: vec![],
            value_formatted: value_fmt,
            telegram_type: "Write (LIVE)".to_string(),
        };

        Ok(Some(telegram))
    }

    /// Sends a raw cEMI frame through the active tunnel (Plain UDP or Secure TCP)
    pub async fn send_raw_cemi(&self, cemi: &[u8]) -> Result<(), String> {
        let conn_guard = self.connection.read().await;
        let conn = match &*conn_guard {
            Some(c) => c,
            None => return Err("Nicht mit einem physischen KNX-Gateway verbunden".to_string()),
        };

        let cemi_buf: Vec<u8>;
        let cemi_to_send: &[u8] = if cemi.len() >= 6 && cemi[4] == 0x00 && cemi[5] == 0x00 {
            if let Some(ia_u16) = parse_individual_address(&conn.assigned_ia) {
                let mut buf = cemi.to_vec();
                let ia_bytes = ia_u16.to_be_bytes();
                buf[4] = ia_bytes[0];
                buf[5] = ia_bytes[1];
                cemi_buf = buf;
                &cemi_buf
            } else {
                cemi
            }
        } else {
            cemi
        };

        let seq = conn.seq_counter.fetch_add(1, Ordering::SeqCst);
        let pkt = build_tunnelling_request_raw(conn.channel_id, seq, cemi_to_send);
        info!(
            "send_raw_cemi: ch={}, seq={}, len={}, hex={}",
            conn.channel_id,
            seq,
            cemi_to_send.len(),
            cemi_to_send.iter().map(|b| format!("{:02X}", b)).collect::<Vec<_>>().join(" ")
        );

        match &conn.transport {
            ActiveTransport::PlainUdp { socket, data_endpoint } => {
                socket
                    .send_to(&pkt, data_endpoint)
                    .await
                    .map_err(|e| format!("Fehler beim Senden von cEMI über UDP: {}", e))?;
            }
            ActiveTransport::SecureTcp { writer, session_key, session_id, seq_out, serial } => {
                let seq = seq_out.fetch_add(1, Ordering::SeqCst);
                let wrapped = wrap_secure_frame(session_key, *session_id, seq, serial, &pkt);
                let mut w = writer.lock().await;
                w.write_all(&wrapped)
                    .await
                    .map_err(|e| format!("Fehler beim Senden von cEMI über Secure TCP: {}", e))?;
            }
        }

        self.telegrams_sent.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }

    /// Background task for KNX IP Secure TCP session: receives frames and sends periodic heartbeat
    #[allow(clippy::too_many_arguments)]
    fn spawn_secure_tcp_listener_and_heartbeat(
        &self,
        mut reader: tokio::net::tcp::OwnedReadHalf,
        writer: Arc<Mutex<tokio::net::tcp::OwnedWriteHalf>>,
        session_key: [u8; 16],
        session_id: u16,
        seq_out: Arc<AtomicU64>,
        serial: [u8; 6],
        channel_id: u8,
    ) {
        let simulator = self.simulator.clone();
        let connection = self.connection.clone();
        let telegrams_received = self.telegrams_received.clone();
        let last_heartbeat = self.last_heartbeat.clone();
        let tx_cemi = self.tx_cemi.clone();

        // 1. TCP Secure Receiver Loop
        let conn_clone = connection.clone();
        let writer_clone = writer.clone();
        let seq_clone = seq_out.clone();
        tokio::spawn(async move {
            let mut hdr_buf = [0u8; 6];
            loop {
                {
                    let guard = conn_clone.read().await;
                    if guard.is_none() {
                        break;
                    }
                }

                if reader.read_exact(&mut hdr_buf).await.is_err() {
                    warn!("Secure TCP connection closed by gateway");
                    break;
                }

                if hdr_buf[0] != 0x06 || hdr_buf[1] != 0x10 {
                    continue;
                }

                let total_len = u16::from_be_bytes([hdr_buf[4], hdr_buf[5]]) as usize;
                if total_len < 6 {
                    continue;
                }

                let mut body_buf = vec![0u8; total_len - 6];
                if reader.read_exact(&mut body_buf).await.is_err() {
                    break;
                }

                let mut full_pkt = Vec::with_capacity(total_len);
                full_pkt.extend_from_slice(&hdr_buf);
                full_pkt.extend_from_slice(&body_buf);

                let service = u16::from_be_bytes([hdr_buf[2], hdr_buf[3]]);
                if service == SERVICE_SECURE_WRAPPER {
                    match unwrap_secure_frame(&session_key, session_id, &full_pkt) {
                        Ok(dec) => {
                            if dec.len() >= 4 {
                                let inner_service = u16::from_be_bytes([dec[2], dec[3]]);
                                match inner_service {
                                    SERVICE_TUNNELLING_REQ => {
                                        if dec.len() >= 10 {
                                            let ch = dec[7];
                                            let seq = dec[8];
                                            let cemi = &dec[10..];
                                            let cemi_hex = cemi.iter().map(|b| format!("{:02X}", b)).collect::<Vec<_>>().join(" ");
                                            debug!("TUNNELLING_REQ from gateway: ch={}, seq={}, cemi_hex={}", ch, seq, cemi_hex);

                                            // Send TUNNELLING_ACK inside SECURE_WRAPPER immediately
                                            let ack = build_tunnelling_ack(ch, seq, 0x00);
                                            let seq_o = seq_clone.fetch_add(1, Ordering::SeqCst);
                                            let wrapped_ack = wrap_secure_frame(
                                                &session_key,
                                                session_id,
                                                seq_o,
                                                &serial,
                                                &ack,
                                            );
                                            let mut w = writer_clone.lock().await;
                                            let _ = w.write_all(&wrapped_ack).await;

                                            // Broadcast raw cEMI to diagnostics / bus monitor listeners
                                            let _ = tx_cemi.send(cemi.to_vec());

                                            if let Some((_, _, mut telegram)) = parse_tunnelling_request(&dec) {
                                                telegrams_received.fetch_add(1, Ordering::Relaxed);
                                                telegram.telegram_type = format!("{} (LIVE)", telegram.telegram_type);
                                                simulator.emit_telegram(telegram).await;
                                            }
                                        }
                                    }
                                    SERVICE_TUNNELLING_ACK => {
                                        let ch = dec.get(7).copied().unwrap_or(0);
                                        let seq = dec.get(8).copied().unwrap_or(0);
                                        let status = dec.get(9).copied().unwrap_or(0xFF);
                                        debug!("TUNNELLING_ACK from gateway: ch={}, seq={}, status=0x{:02X}", ch, seq, status);
                                    }
                                    SERVICE_CONNECTIONSTATE_RES => {
                                        let now_str = Utc::now().format("%H:%M:%S").to_string();
                                        *last_heartbeat.write().await = Some(now_str);
                                    }
                                    other => {
                                        debug!("Secure Inner Service 0x{:04X}, len={}", other, dec.len());
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            warn!("Failed to unwrap SECURE_WRAPPER (len {}): {}", total_len, e);
                        }
                    }
                } else if service == SERVICE_TUNNELLING_REQ && full_pkt.len() >= 10 {
                    let ch = full_pkt[7];
                    let seq = full_pkt[8];
                    let cemi = &full_pkt[10..];
                    let cemi_hex = cemi.iter().map(|b| format!("{:02X}", b)).collect::<Vec<_>>().join(" ");
                    debug!("TUNNELLING_REQ (plain) from gateway: ch={}, seq={}, cemi_hex={}", ch, seq, cemi_hex);

                    // Send PLAIN TUNNELLING_ACK back immediately
                    let ack = build_tunnelling_ack(ch, seq, 0x00);
                    let mut w = writer_clone.lock().await;
                    let _ = w.write_all(&ack).await;

                    // Broadcast raw cEMI to diagnostics / bus monitor listeners
                    let _ = tx_cemi.send(cemi.to_vec());

                    if let Some((_, _, mut telegram)) = parse_tunnelling_request(&full_pkt) {
                        telegrams_received.fetch_add(1, Ordering::Relaxed);
                        telegram.telegram_type = format!("{} (LIVE)", telegram.telegram_type);
                        simulator.emit_telegram(telegram).await;
                    }
                } else if service == SERVICE_TUNNELLING_ACK {
                    let ch = full_pkt.get(7).copied().unwrap_or(0);
                    let seq = full_pkt.get(8).copied().unwrap_or(0);
                    let status = full_pkt.get(9).copied().unwrap_or(0xFF);
                    debug!("TUNNELLING_ACK (plain) from gateway: ch={}, seq={}, status=0x{:02X}", ch, seq, status);
                } else if service == SERVICE_CONNECTIONSTATE_RES {
                    let now_str = Utc::now().format("%H:%M:%S").to_string();
                    *last_heartbeat.write().await = Some(now_str);
                } else {
                    debug!("Received plain service 0x{:04X}, len={}", service, total_len);
                }
            }
        });

        // 2. TCP Secure Heartbeat Loop
        tokio::spawn(async move {
            loop {
                sleep(Duration::from_secs(30)).await;
                {
                    let guard = connection.read().await;
                    if guard.is_none() {
                        break;
                    }
                }

                let hpai_tcp = [0x08, 0x02, 0, 0, 0, 0, 0, 0];
                let mut req = Vec::with_capacity(16);
                req.extend_from_slice(&[0x06, 0x10, 0x02, 0x07, 0x00, 0x10]);
                req.push(channel_id);
                req.push(0x00);
                req.extend_from_slice(&hpai_tcp);

                let seq = seq_out.fetch_add(1, Ordering::SeqCst);
                let wrapped = wrap_secure_frame(&session_key, session_id, seq, &serial, &req);
                let mut w = writer.lock().await;
                if w.write_all(&wrapped).await.is_err() {
                    break;
                }
            }
        });
    }

    /// Background task for listening to incoming bus telegrams and maintaining connection state ping
    fn spawn_listener_and_heartbeat(
        &self,
        socket: Arc<UdpSocket>,
        channel_id: u8,
        ctrl_endpoint: SocketAddr,
    ) {
        let simulator = self.simulator.clone();
        let connection = self.connection.clone();
        let socket_rx = socket.clone();
        let telegrams_received = self.telegrams_received.clone();
        let last_heartbeat = self.last_heartbeat.clone();
        let tx_cemi = self.tx_cemi.clone();

        // 1. Receiver Loop
        tokio::spawn(async move {
            let mut buf = [0u8; 1024];
            loop {
                // Check if connection is still active
                {
                    let conn_guard = connection.read().await;
                    if conn_guard.is_none() {
                        break;
                    }
                }

                match socket_rx.recv_from(&mut buf).await {
                    Ok((len, src)) => {
                        let data = &buf[..len];
                        if data.len() < 6 || data[0] != 0x06 || data[1] != 0x10 {
                            continue;
                        }

                        let service = u16::from_be_bytes([data[2], data[3]]);
                        if service == SERVICE_TUNNELLING_REQ && data.len() >= 10 {
                            let ch = data[7];
                            let seq = data[8];

                            // Send ACK back immediately
                            let ack = build_tunnelling_ack(ch, seq, 0x00);
                            let _ = socket_rx.send_to(&ack, &src).await;

                            // Broadcast raw cEMI
                            let _ = tx_cemi.send(data[10..].to_vec());

                            if let Some((_, _, mut telegram)) = parse_tunnelling_request(data) {
                                telegrams_received.fetch_add(1, Ordering::Relaxed);
                                telegram.telegram_type = format!("{} (LIVE)", telegram.telegram_type);
                                simulator.emit_telegram(telegram).await;
                            }
                        } else if service == SERVICE_CONNECTIONSTATE_RES {
                            let now_str = Utc::now().format("%H:%M:%S").to_string();
                            *last_heartbeat.write().await = Some(now_str);
                        }

                    }
                    Err(_) => {
                        break;
                    }
                }
            }
        });

        // 2. Heartbeat Ping Loop (every 30 seconds)
        let socket_ping = socket.clone();
        let connection_ping = self.connection.clone();
        tokio::spawn(async move {
            loop {
                sleep(Duration::from_secs(30)).await;
                let is_active = {
                    let conn_guard = connection_ping.read().await;
                    conn_guard.is_some()
                };
                if !is_active {
                    break;
                }

                let local_port = socket_ping.local_addr().map(|a| a.port()).unwrap_or(0);
                let ping_pkt = build_connectionstate_request(channel_id, [0, 0, 0, 0], local_port);
                let _ = socket_ping.send_to(&ping_pkt, &ctrl_endpoint).await;
            }
        });
    }

    /// Returns current connection status
    pub async fn get_status(&self) -> GatewayConnectionStatus {
        let conn_guard = self.connection.read().await;
        let last_hb = self.last_heartbeat.read().await.clone();

        match &*conn_guard {
            Some(conn) => GatewayConnectionStatus {
                connected: true,
                gateway_ip: Some(conn.gateway_ip.to_string()),
                gateway_port: Some(conn.gateway_port),
                gateway_name: Some(conn.gateway_name.clone()),
                individual_address: Some(conn.assigned_ia.clone()),
                channel_id: Some(conn.channel_id),
                last_heartbeat: last_hb,
                telegrams_sent: self.telegrams_sent.load(Ordering::Relaxed),
                telegrams_received: self.telegrams_received.load(Ordering::Relaxed),
            },
            None => GatewayConnectionStatus {
                connected: false,
                gateway_ip: None,
                gateway_port: None,
                gateway_name: None,
                individual_address: None,
                channel_id: None,
                last_heartbeat: None,
                telegrams_sent: self.telegrams_sent.load(Ordering::Relaxed),
                telegrams_received: self.telegrams_received.load(Ordering::Relaxed),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_knx_address_helpers() {
        assert_eq!(format_individual_address(0x110A), "1.1.10");
        assert_eq!(format_group_address(0x090A), "1/1/10");
        assert_eq!(parse_group_address("1/1/10"), Some(0x090A));
        assert_eq!(parse_group_address("0/7/99"), Some(0x0763));
    }

    #[test]
    fn test_knx_float2_roundtrip() {
        let original = 21.5f32;
        let bytes = encode_knx_float2(original);
        let decoded = decode_knx_float2(bytes);
        assert!((decoded - original).abs() < 0.1);
    }

    #[test]
    fn test_search_and_connect_packet_builders() {
        let search = build_search_request([192, 168, 1, 100], 3671);
        assert_eq!(search.len(), 14);
        assert_eq!(&search[0..4], &[0x06, 0x10, 0x02, 0x01]);

        let connect = build_connect_request([192, 168, 1, 100], 3671);
        assert_eq!(connect.len(), 26);
        assert_eq!(&connect[0..4], &[0x06, 0x10, 0x02, 0x05]);

        let ack = build_tunnelling_ack(1, 42, 0x00);
        assert_eq!(ack.len(), 10);
        assert_eq!(&ack[0..4], &[0x06, 0x10, 0x04, 0x21]);
    }

    #[test]
    fn test_management_cemi_and_address_helpers() {
        assert_eq!(parse_individual_address("1.1.252"), Some(0x11FC));
        assert_eq!(format_individual_address(0x11FC), "1.1.252");

        let (desc, hex_str) = decode_mask_version(0x07B0);
        assert_eq!(desc, "System B (TP, BIM M112)");
        assert_eq!(hex_str, "07B0h");

        let mfg = decode_manufacturer(0x0083);
        assert_eq!(mfg, "MDT Technologies");

        let ia_read = build_cemi_individual_address_read();
        assert_eq!(ia_read[0], 0x11); // L_Data.req
        assert_eq!(ia_read[6..8], [0x00, 0x00]); // Dest 0.0.0
        assert_eq!(ia_read[9..11], [0x01, 0x00]); // APCI 0x0100

        let ia_write = build_cemi_individual_address_write(0x110A); // 1.1.10
        assert_eq!(ia_write[0], 0x11);
        assert_eq!(ia_write[8], 0x03); // Len 3
        assert_eq!(ia_write[10], 0xC0); // APCI 0x00C0
        assert_eq!(ia_write[11..13], [0x11, 0x0A]);

        let desc_read = build_cemi_device_descriptor_read(0x110A, 0);
        assert_eq!(desc_read[6..8], [0x11, 0x0A]); // Target 1.1.10

        let prop_read = build_cemi_property_value_read(0x110A, 0, 11, 1, 1);
        assert_eq!(prop_read[9..11], [0x03, 0xD5]); // APCI 0x03D5
    }
}

