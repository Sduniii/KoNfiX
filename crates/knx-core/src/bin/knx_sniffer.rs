use chrono::Local;
use knx_core::keyring::parse_and_decrypt_knxkeys;
use knx_core::knx_secure::{
    establish_secure_session, unwrap_secure_frame, wrap_secure_frame, KnxSecureCredentials,
    CLIENT_SERIAL,
};
use knx_core::knxnet_ip::*;
use std::fs::OpenOptions;
use std::io::Write;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket as StdUdpSocket};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, UdpSocket};
use tokio::sync::{broadcast, mpsc, Mutex};

// Extended KNXnet/IP Service constants
const SERVICE_DESCRIPTION_REQ: u16 = 0x0203;
const SERVICE_DESCRIPTION_RES: u16 = 0x0204;
const SERVICE_SEARCH_REQ_EXT: u16 = 0x020B;
const SERVICE_SEARCH_RES_EXT: u16 = 0x020C;
const SERVICE_DEVICE_CONFIG_REQ: u16 = 0x0310;
const _SERVICE_DEVICE_CONFIG_ACK: u16 = 0x0311;
const DEFAULT_KNX_PORT: u16 = 3671;

struct Logger {
    file_path: PathBuf,
    filter: Option<String>,
}

impl Logger {
    fn new(path: PathBuf, filter: Option<String>) -> Self {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        Self {
            file_path: path,
            filter,
        }
    }

    fn matches_filter(&self, text: &str) -> bool {
        match &self.filter {
            Some(f) => text.contains(f),
            None => true,
        }
    }

    fn log(&self, msg: &str) {
        let ts = Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let line = format!("[{}] {}", ts, msg);
        if self.matches_filter(msg) {
            println!("{}", line);
        }
        if let Ok(mut f) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.file_path)
        {
            let _ = writeln!(f, "{}", line);
        }
    }

    fn log_highlight(&self, prefix: &str, msg: &str) {
        let ts = Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let term_line = format!("\x1b[1;33m[{}]\x1b[0m \x1b[1;36m{}\x1b[0m {}", ts, prefix, msg);
        let raw_line = format!("[{}] {} {}", ts, prefix, msg);
        if self.matches_filter(msg) || self.matches_filter(prefix) {
            println!("{}", term_line);
        }
        if let Ok(mut f) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.file_path)
        {
            let _ = writeln!(f, "{}", raw_line);
        }
    }
}

/// Helper: Parses string into SocketAddr, defaulting port to 3671 if not provided
fn parse_socket_addr(s: &str) -> Result<SocketAddr, String> {
    if let Ok(addr) = s.parse::<SocketAddr>() {
        return Ok(addr);
    }
    if let Ok(ip) = s.parse::<IpAddr>() {
        return Ok(SocketAddr::new(ip, DEFAULT_KNX_PORT));
    }
    Err(format!(
        "Ungültige IP-Adresse: '{}'. Erwartet: IP oder IP:PORT (z.B. 192.168.1.120 oder 192.168.1.120:3671)",
        s
    ))
}

/// Dynamically locates active gateway IP in ~/.konfix/projects/*.konfix or /data/projects/*.konfix
fn find_gateway_in_konfix_projects() -> Option<SocketAddr> {
    let mut candidate_dirs = Vec::new();
    candidate_dirs.push(dirs_or_home_konfix().join("projects"));
    candidate_dirs.push(PathBuf::from("/data/projects"));

    for dir in candidate_dirs {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) == Some("konfix") {
                    if let Ok(content) = std::fs::read_to_string(&path) {
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                            if let Some(devices) = json.get("devices").and_then(|d| d.as_array()) {
                                for dev in devices {
                                    let order = dev.get("order_number").and_then(|o| o.as_str()).unwrap_or("");
                                    let name = dev.get("name").and_then(|n| n.as_str()).unwrap_or("");
                                    if order.contains("IP") || name.contains("IP") || name.contains("Gateway") {
                                        // Check parameters for IP address
                                        if let Some(params) = dev.get("parameters").and_then(|p| p.as_array()) {
                                            for param in params {
                                                if let Some(val) = param.get("value").and_then(|v| v.as_str()) {
                                                    if let Ok(ip) = val.parse::<IpAddr>() {
                                                        return Some(SocketAddr::new(ip, DEFAULT_KNX_PORT));
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    None
}

/// Dynamically resolves the target KNX gateway address without any hardcoded IPs
fn resolve_gateway_target(explicit_gw: Option<String>) -> Result<SocketAddr, String> {
    // 1. Explicit CLI argument (--gw or positional argument)
    if let Some(gw_str) = explicit_gw {
        return parse_socket_addr(&gw_str);
    }

    // 2. Environment variable KONFIX_GATEWAY_IP (and optional KONFIX_GATEWAY_PORT)
    if let Ok(ip_str) = std::env::var("KONFIX_GATEWAY_IP") {
        let port: u16 = std::env::var("KONFIX_GATEWAY_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(DEFAULT_KNX_PORT);
        let ip: IpAddr = ip_str
            .parse()
            .map_err(|e| format!("Ungültige IP in KONFIX_GATEWAY_IP ({}): {}", ip_str, e))?;
        return Ok(SocketAddr::new(ip, port));
    }

    // 3. Scan ~/.konfix/projects/ for an IP Gateway device
    if let Some(addr) = find_gateway_in_konfix_projects() {
        return Ok(addr);
    }

    // 4. No IP could be determined: Error with clear usage explanation
    Err(
        "Keine Gateway-IP angegeben!\n\
         Bitte übergeben Sie die IP des physischen KNX-Gateways:\n\
           cargo run --bin knx_sniffer -- <GATEWAY_IP[:PORT]> [OPTIONEN]\n\
           cargo run --bin knx_sniffer -- --gw <GATEWAY_IP[:PORT]> [OPTIONEN]\n\
           KONFIX_GATEWAY_IP=<IP> cargo run --bin knx_sniffer\n\n\
         Hilfe anzeigen: cargo run --bin knx_sniffer -- --help"
            .to_string(),
    )
}

/// Automatically detects local IPv4 interface used for reaching target gateway
fn detect_local_ip(target: SocketAddr, explicit_local: Option<Ipv4Addr>) -> Ipv4Addr {
    if let Some(ip) = explicit_local {
        return ip;
    }
    if let Ok(sock) = StdUdpSocket::bind("0.0.0.0:0") {
        if sock.connect(target).is_ok() {
            if let Ok(local) = sock.local_addr() {
                if let IpAddr::V4(ipv4) = local.ip() {
                    return ipv4;
                }
            }
        }
    }
    // Fallback: loopback if offline
    Ipv4Addr::new(127, 0, 0, 1)
}

/// Dynamically locates the .knxkeys keyring file and resolves its password
fn resolve_keyring(
    explicit_path: Option<String>,
    explicit_pass: Option<String>,
) -> Result<(PathBuf, String), String> {
    let mut candidates = Vec::new();

    if let Some(p) = explicit_path {
        candidates.push(PathBuf::from(p));
    }
    if let Ok(p) = std::env::var("KONFIX_KEYRING_PATH") {
        candidates.push(PathBuf::from(p));
    }

    // Standard directory searches
    let konfix_dir = dirs_or_home_konfix();
    candidates.push(konfix_dir.join("gateway.knxkeys"));
    if let Ok(entries) = std::fs::read_dir(&konfix_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("knxkeys") {
                candidates.push(path);
            }
        }
    }

    // Docker /data directory
    candidates.push(PathBuf::from("/data/gateway.knxkeys"));
    if let Ok(entries) = std::fs::read_dir("/data") {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("knxkeys") {
                candidates.push(path);
            }
        }
    }

    // User home directory
    if let Ok(home) = std::env::var("HOME") {
        let home_p = PathBuf::from(home);
        candidates.push(home_p.join(".konfix/gateway.knxkeys"));
    }

    let existing_path = candidates.into_iter().find(|p| p.exists()).ok_or_else(|| {
        "Keine .knxkeys Schlüsselbund-Datei gefunden!\n\
         Bitte übergeben Sie den Pfad mit '--keyring <PFAD>' oder setzen Sie 'KONFIX_KEYRING_PATH'."
            .to_string()
    })?;

    // Password resolution
    let passwords = if let Some(p) = explicit_pass {
        vec![p]
    } else if let Ok(p) = std::env::var("KONFIX_KEYRING_PASSWORD") {
        vec![p]
    } else {
        vec!["".to_string()]
    };

    let xml_text = std::fs::read_to_string(&existing_path)
        .map_err(|e| format!("Konnte Schlüsselbund ({}) nicht lesen: {}", existing_path.display(), e))?;

    for pass in passwords {
        if parse_and_decrypt_knxkeys(&xml_text, &pass).is_ok() {
            return Ok((existing_path, pass));
        }
    }

    Err(format!(
        "Konnte Schlüsselbund ({}) mit den bekannten Passwörtern nicht entschlüsseln.\n\
         Bitte übergeben Sie das korrekte Passwort mit '--pass <PASSWORT>' oder 'KONFIX_KEYRING_PASSWORD'.",
        existing_path.display()
    ))
}

/// Decodes cEMI frame into human-readable description
fn decode_cemi(data: &[u8]) -> String {
    if data.is_empty() {
        return "Leerer cEMI Frame".to_string();
    }
    let msg_code = data[0];
    let msg_type = match msg_code {
        0x11 => "L_Data.req (ETS -> Bus)",
        0x29 => "L_Data.ind (Bus -> ETS)",
        0x2E => "L_Data.con (Gateway Bestätigung)",
        0x2B => "L_Busmon.ind (Monitor)",
        0xFC => "M_PropRead.req",
        0xFB => "M_PropRead.con",
        0xF6 => "M_PropWrite.req",
        0xF5 => "M_PropWrite.con",
        0xF8 => "M_PropInfo.ind",
        _ => "Unbekannter cEMI Code",
    };

    if data.len() < 10 {
        return format!("{} [0x{:02X}] Raw: {}", msg_type, msg_code, hex::encode(data));
    }

    let add_info_len = data[1] as usize;
    let base = 2 + add_info_len;
    if data.len() < base + 8 {
        return format!("{} Raw: {}", msg_type, hex::encode(data));
    }

    let _ctrl1 = data[base];
    let ctrl2 = data[base + 1];
    let src_raw = u16::from_be_bytes([data[base + 2], data[base + 3]]);
    let dst_raw = u16::from_be_bytes([data[base + 4], data[base + 5]]);
    let is_ga = (ctrl2 & 0x80) != 0;

    let src_str = format_individual_address(src_raw);
    let dst_str = if is_ga {
        format_group_address(dst_raw)
    } else {
        format_individual_address(dst_raw)
    };

    let data_len = data[base + 6] as usize;
    let min_len = if data_len == 0 && data.len() > base + 7 { 1 } else { data_len };
    let payload_slice = if data.len() >= base + 7 + min_len {
        &data[base + 7..base + 7 + min_len]
    } else if data.len() > base + 7 {
        &data[base + 7..]
    } else {
        &[]
    };

    let (tpci_str, apci_desc) = decode_apdu(payload_slice, is_ga);

    let is_target_actor = dst_str == "1.1.11" || src_str == "1.1.11";
    let highlight_tag = if is_target_actor {
        "\x1b[1;32m[🎯 1.1.11]\x1b[0m "
    } else {
        ""
    };

    format!(
        "{}{}: {} -> {} | TPCI: {} | APCI/Daten: {} | Hex: {}",
        highlight_tag,
        msg_type,
        src_str,
        dst_str,
        tpci_str,
        apci_desc,
        hex::encode(payload_slice)
    )
}

fn decode_apdu(apdu: &[u8], is_ga: bool) -> (String, String) {
    if apdu.is_empty() {
        return ("None".to_string(), "Leeres APDU".to_string());
    }

    let b0 = apdu[0];
    let tpci_type = (b0 >> 6) & 0x03;
    let tpci_str = match tpci_type {
        0 => "UDT (Unnumbered Data)".to_string(),
        1 => format!("NDT (Numbered Data, seq={})", (b0 >> 2) & 0x0F),
        2 => match b0 {
            0x80 => "T_Connect".to_string(),
            0x81 => "T_Disconnect".to_string(),
            _ => format!("UCD (0x{:02X})", b0),
        },
        3 => {
            let seq = (b0 >> 2) & 0x0F;
            if (b0 & 0x03) == 0x02 {
                format!("T_ACK (seq={})", seq)
            } else if (b0 & 0x03) == 0x03 {
                format!("T_NAK (seq={})", seq)
            } else {
                format!("NCD (0x{:02X})", b0)
            }
        }
        _ => "Unbekannt".to_string(),
    };

    if apdu.len() < 2 {
        return (tpci_str, "Kein APCI".to_string());
    }

    let b1 = apdu[1];
    let apci = ((b0 as u16 & 0x03) << 8) | (b1 as u16);
    let data_rest = if apdu.len() > 2 { &apdu[2..] } else { &[] };

    let apci_desc = match apci & 0x03C0 {
        0x0000 => {
            if is_ga {
                "A_GroupValue_Read".to_string()
            } else {
                "A_IndividualAddress_Read".to_string()
            }
        }
        0x0040 => {
            let val = apci & 0x3F;
            if is_ga {
                format!("A_GroupValue_Response (val={})", val)
            } else {
                let ia = if !data_rest.is_empty() {
                    (b1 as u16) | ((data_rest[0] as u16) << 8)
                } else {
                    b1 as u16
                };
                format!("A_IndividualAddress_Response (ia={})", format_individual_address(ia))
            }
        }
        0x0080 => {
            let val = apci & 0x3F;
            format!("A_GroupValue_Write (val={})", val)
        }
        0x00C0 => {
            let ia = if data_rest.len() >= 2 {
                u16::from_be_bytes([data_rest[0], data_rest[1]])
            } else {
                0
            };
            format!("A_IndividualAddress_Write (IA: {})", format_individual_address(ia))
        }
        0x0100 => "A_DeviceDescriptor_Read".to_string(),
        0x0140 => format!("A_DeviceDescriptor_Response ({})", hex::encode(data_rest)),
        0x0180 => {
            if apci == 0x0180 {
                "A_Restart".to_string()
            } else if apci == 0x0182 {
                format!("A_Authorize_Request (Key={})", hex::encode(data_rest))
            } else if apci == 0x0183 {
                format!("A_Authorize_Response (Level={})", hex::encode(data_rest))
            } else {
                format!("APCI 0x{:04X}", apci)
            }
        }
        0x0200 => {
            let count = (apci & 0x003F) as usize;
            if data_rest.len() >= 2 {
                let addr = u16::from_be_bytes([data_rest[0], data_rest[1]]);
                format!("A_Memory_Read (Addr: 0x{:04X}, Count: {})", addr, count)
            } else {
                format!("A_Memory_Read (Count: {})", count)
            }
        }
        0x0240 => {
            let count = (apci & 0x003F) as usize;
            if data_rest.len() >= 2 {
                let addr = u16::from_be_bytes([data_rest[0], data_rest[1]]);
                let bytes = if data_rest.len() > 2 { &data_rest[2..] } else { &[] };
                format!("A_Memory_Response (Addr: 0x{:04X}, Count: {}, Data: {})", addr, count, hex::encode(bytes))
            } else {
                format!("A_Memory_Response (Count: {})", count)
            }
        }
        0x0280 => {
            let count = (apci & 0x003F) as usize;
            if data_rest.len() >= 2 {
                let addr = u16::from_be_bytes([data_rest[0], data_rest[1]]);
                let bytes = if data_rest.len() > 2 { &data_rest[2..] } else { &[] };
                let mut extra = String::new();
                if bytes.len() >= 2 {
                    let val_u16 = u16::from_be_bytes([bytes[0], bytes[1]]);
                    if val_u16 == 28 {
                        extra = " \x1b[1;32m★ EXAKT 28 SEKUNDEN (0x001C)! ★\x1b[0m".to_string();
                    } else if val_u16 == 26 {
                        extra = " \x1b[1;32m★ EXAKT 26 SEKUNDEN (0x001A)! ★\x1b[0m".to_string();
                    } else {
                        extra = format!(" (u16={})", val_u16);
                    }
                }
                format!("A_Memory_Write (Addr: 0x{:04X}, Count: {}, Data: [{}]{})", addr, count, hex::encode(bytes), extra)
            } else {
                format!("A_Memory_Write (Count: {})", count)
            }
        }
        _ => {
            match apci {
                0x03D1 => format!("A_Authorize_Request (Key={})", hex::encode(data_rest)),
                0x03D2 => format!("A_Authorize_Response (Level={})", hex::encode(data_rest)),
                0x03D5 => {
                    if data_rest.len() >= 4 {
                        let obj_idx = data_rest[0];
                        let prop_id = data_rest[1];
                        let count = (data_rest[2] >> 4) & 0x0F;
                        let start = (((data_rest[2] as u16 & 0x0F) << 8) | (data_rest[3] as u16)) & 0x0FFF;
                        format!("A_PropertyValue_Read (Obj: {}, PID: {}, Count: {}, Start: {})", obj_idx, prop_id, count, start)
                    } else {
                        "A_PropertyValue_Read".to_string()
                    }
                }
                0x03D6 => {
                    if data_rest.len() >= 4 {
                        let obj_idx = data_rest[0];
                        let prop_id = data_rest[1];
                        let count = (data_rest[2] >> 4) & 0x0F;
                        let start = (((data_rest[2] as u16 & 0x0F) << 8) | (data_rest[3] as u16)) & 0x0FFF;
                        let prop_val = if data_rest.len() > 4 { &data_rest[4..] } else { &[] };
                        format!("A_PropertyValue_Response (Obj: {}, PID: {}, Count: {}, Start: {}, Data: {})", obj_idx, prop_id, count, start, hex::encode(prop_val))
                    } else {
                        "A_PropertyValue_Response".to_string()
                    }
                }
                0x03D7 => {
                    if data_rest.len() >= 4 {
                        let obj_idx = data_rest[0];
                        let prop_id = data_rest[1];
                        let count = (data_rest[2] >> 4) & 0x0F;
                        let start = (((data_rest[2] as u16 & 0x0F) << 8) | (data_rest[3] as u16)) & 0x0FFF;
                        let prop_val = if data_rest.len() > 4 { &data_rest[4..] } else { &[] };
                        let pid_name = match prop_id {
                            56 => "PID_LOAD_STATE_MACHINE",
                            11 => "PID_OBJECT_INDEX",
                            63 => "PID_DEVICE_CONTROL",
                            78 => "PID_HARDWARE_TYPE",
                            51 => "PID_SERIAL_NUMBER",
                            _ => "Unknown_PID",
                        };
                        format!("A_PropertyValue_Write (Obj: {}, PID: {} ({}), Count: {}, Start: {}, Data: {})", obj_idx, prop_id, pid_name, count, start, hex::encode(prop_val))
                    } else {
                        "A_PropertyValue_Write".to_string()
                    }
                }
                0x03C5 => format!("A_FunctionPropertyCommand ({})", hex::encode(data_rest)),
                0x03C6 => format!("A_FunctionPropertyStateRead ({})", hex::encode(data_rest)),
                0x03C7 => format!("A_FunctionPropertyStateResponse ({})", hex::encode(data_rest)),
                _ => format!("APCI 0x{:04X} Data: {}", apci, hex::encode(data_rest)),
            }
        }
    };

    (tpci_str, apci_desc)
}

/// Builds SEARCH_RESPONSE or SEARCH_RESPONSE_EXTENDED packet
fn build_search_response(service_type: u16, local_ip: Ipv4Addr, local_port: u16) -> Vec<u8> {
    let mut resp = Vec::new();
    resp.extend_from_slice(&[0x06, 0x10]);
    resp.extend_from_slice(&service_type.to_be_bytes());
    let resp_len: u16 = 6 + 8 + 54 + 8; // Header + HPAI + DIB DevInfo + DIB SuppSvc
    resp.extend_from_slice(&resp_len.to_be_bytes());

    // HPAI Control Endpoint (UDP)
    let octets = local_ip.octets();
    resp.extend_from_slice(&[
        0x08, 0x01, octets[0], octets[1], octets[2], octets[3],
        (local_port >> 8) as u8, (local_port & 0xFF) as u8,
    ]);

    // DIB 0x01: Device Info (54 bytes)
    let mut dev_dib = vec![0u8; 54];
    dev_dib[0] = 54;
    dev_dib[1] = 0x01; // Device Info
    dev_dib[2] = 0x02; // Medium: TP1
    dev_dib[3] = 0x00; // Device status
    dev_dib[4] = 0x11; // IA: 1.1.250
    dev_dib[5] = 0xFA;
    dev_dib[6] = 0x00; // Project install id
    dev_dib[8..14].copy_from_slice(&[0x00, 0xFA, 0xCE, 0x00, 0x00, 0x01]); // Distinct Virtual Serial
    dev_dib[14..18].copy_from_slice(&[224, 0, 23, 12]); // Multicast
    dev_dib[18..24].copy_from_slice(&[0x02, 0x00, octets[0], octets[1], octets[2], octets[3]]); // MAC
    let dev_name = b"KoNfiX KNX Tunnel Proxy       ";
    dev_dib[24..54].copy_from_slice(&dev_name[..30]);
    resp.extend_from_slice(&dev_dib);

    // DIB 0x02: Supported Service Families (8 bytes)
    resp.extend_from_slice(&[
        0x08, 0x02,
        0x02, 0x01, // Core v1
        0x03, 0x01, // Device Management v1
        0x04, 0x01, // Tunneling v1
    ]);

    resp
}

/// Builds DESCRIPTION_RESPONSE packet
fn build_description_response(local_ip: Ipv4Addr) -> Vec<u8> {
    let mut resp = Vec::new();
    resp.extend_from_slice(&[0x06, 0x10]);
    resp.extend_from_slice(&SERVICE_DESCRIPTION_RES.to_be_bytes());
    let resp_len: u16 = 6 + 54 + 8;
    resp.extend_from_slice(&resp_len.to_be_bytes());

    let octets = local_ip.octets();
    let mut dev_dib = vec![0u8; 54];
    dev_dib[0] = 54;
    dev_dib[1] = 0x01;
    dev_dib[2] = 0x02; // TP1
    dev_dib[4] = 0x11; // 1.1.250
    dev_dib[5] = 0xFA;
    dev_dib[8..14].copy_from_slice(&[0x00, 0xFA, 0xCE, 0x00, 0x00, 0x01]);
    dev_dib[14..18].copy_from_slice(&[224, 0, 23, 12]);
    dev_dib[18..24].copy_from_slice(&[0x02, 0x00, octets[0], octets[1], octets[2], octets[3]]);
    let dev_name = b"KoNfiX KNX Tunnel Proxy       ";
    dev_dib[24..54].copy_from_slice(&dev_name[..30]);
    resp.extend_from_slice(&dev_dib);

    resp.extend_from_slice(&[0x08, 0x02, 0x02, 0x01, 0x03, 0x01, 0x04, 0x01]);
    resp
}

/// Generates M_PropRead.con response for ETS Device Management queries
fn handle_device_management_cemi(cemi: &[u8], assigned_ia: u16) -> Option<Vec<u8>> {
    if cemi.is_empty() || cemi[0] != 0xFC {
        return None;
    }
    if cemi.len() < 7 {
        return None;
    }
    let obj_type_hi = cemi[1];
    let obj_type_lo = cemi[2];
    let obj_inst = cemi[3];
    let prop_id = cemi[4];
    let count_start_hi = cemi[5];
    let count_start_lo = cemi[6];

    let mut con = Vec::new();
    con.push(0xFB); // M_PropRead.con
    con.push(obj_type_hi);
    con.push(obj_type_lo);
    con.push(obj_inst);
    con.push(prop_id);
    con.push(count_start_hi);
    con.push(count_start_lo);

    match prop_id {
        56 => {
            // PID_SERIAL_NUMBER (6 bytes)
            con.extend_from_slice(&[0x00, 0x83, 0x7B, 0x40, 0x02, 0x85]);
        }
        51 => {
            // PID_KNX_INDIVIDUAL_ADDRESS (2 bytes)
            con.extend_from_slice(&assigned_ia.to_be_bytes());
        }
        54 => {
            // PID_MAC_ADDRESS (6 bytes)
            con.extend_from_slice(&[0x00, 0x83, 0x7B, 0x40, 0x02, 0x85]);
        }
        58 => {
            // PID_PROJECT_INSTALLATION_ID (2 bytes)
            con.extend_from_slice(&[0x00, 0x00]);
        }
        _ => {
            con.extend_from_slice(&[0x00]);
        }
    }
    Some(con)
}

/// Builds typed CONNECT_RESPONSE (Device Management 0x03 vs Tunneling 0x04)
fn build_typed_connect_response(
    channel_id: u8,
    status: u8,
    conn_type: u8,
    assigned_ia: u16,
    is_tcp: bool,
    local_ip: Ipv4Addr,
    local_port: u16,
) -> Vec<u8> {
    let mut resp = Vec::new();
    resp.extend_from_slice(&[0x06, 0x10, 0x02, 0x06]);

    let crd_len: u16 = if conn_type == 0x03 {
        2 // Device Management: [0x02, 0x03]
    } else {
        4 // Tunneling: [0x04, 0x04, IA_HI, IA_LO]
    };

    let total_len = 6 + 2 + 8 + crd_len;
    resp.extend_from_slice(&total_len.to_be_bytes());
    resp.push(channel_id);
    resp.push(status);

    // HPAI Data Endpoint
    let octets = local_ip.octets();
    let proto = if is_tcp { 0x02 } else { 0x01 };
    resp.extend_from_slice(&[
        0x08, proto, octets[0], octets[1], octets[2], octets[3],
        (local_port >> 8) as u8, (local_port & 0xFF) as u8,
    ]);

    // CRD (Connect Response Data)
    if conn_type == 0x03 {
        resp.extend_from_slice(&[0x02, 0x03]); // Device Management
    } else {
        resp.extend_from_slice(&[
            0x04, 0x04,
            (assigned_ia >> 8) as u8,
            (assigned_ia & 0xFF) as u8,
        ]);
    }

    resp
}

struct ParsedArgs {
    explicit_gw: Option<String>,
    listen_port: u16,
    bind_ip: Ipv4Addr,
    explicit_local_ip: Option<Ipv4Addr>,
    explicit_keyring: Option<String>,
    explicit_pass: Option<String>,
    tunnel_user: Option<u8>,
    filter: Option<String>,
}

fn parse_cli_args() -> ParsedArgs {
    let args: Vec<String> = std::env::args().collect();
    let mut explicit_gw = None;
    let mut listen_port = DEFAULT_KNX_PORT;
    let mut bind_ip = Ipv4Addr::new(0, 0, 0, 0);
    let mut explicit_local_ip = None;
    let mut explicit_keyring = None;
    let mut explicit_pass = None;
    let mut tunnel_user = None;
    let mut filter = None;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--gw" if i + 1 < args.len() => {
                explicit_gw = Some(args[i + 1].clone());
                i += 2;
            }
            "--port" if i + 1 < args.len() => {
                if let Ok(p) = args[i + 1].parse() {
                    listen_port = p;
                }
                i += 2;
            }
            "--bind" if i + 1 < args.len() => {
                if let Ok(b) = args[i + 1].parse() {
                    bind_ip = b;
                }
                i += 2;
            }
            "--local-ip" if i + 1 < args.len() => {
                if let Ok(l) = args[i + 1].parse() {
                    explicit_local_ip = Some(l);
                }
                i += 2;
            }
            "--keyring" if i + 1 < args.len() => {
                explicit_keyring = Some(args[i + 1].clone());
                i += 2;
            }
            "--pass" if i + 1 < args.len() => {
                explicit_pass = Some(args[i + 1].clone());
                i += 2;
            }
            "--user" if i + 1 < args.len() => {
                if let Ok(u) = args[i + 1].parse() {
                    tunnel_user = Some(u);
                }
                i += 2;
            }
            "--filter" if i + 1 < args.len() => {
                filter = Some(args[i + 1].clone());
                i += 2;
            }
            "-h" | "--help" => {
                println!("KoNfiX KNX Sniffer & Transparent Proxy");
                println!();
                println!("Syntax:");
                println!("  cargo run --bin knx_sniffer -- [GATEWAY_IP[:PORT]] [OPTIONEN]");
                println!();
                println!("Optionen:");
                println!("  --gw <IP[:PORT]>     Ziel-Gateway (z.B. 192.168.1.120 oder 192.168.1.120:3671)");
                println!("  --local-ip <IP>      Lokale IP-Adresse zur Ankündigung an ETS (Standard: auto-detect)");
                println!("  --bind <IP>          Bind-Adresse für Server-Sockets (Standard: 0.0.0.0)");
                println!("  --port <PORT>        Lokaler Listen-Port für ETS (Standard: 3671)");
                println!("  --keyring <PFAD>     Pfad zu .knxkeys Schlüsselbund-Datei");
                println!("  --pass <PASS>        Passwort für Schlüsselbund");
                println!("  --user <USER_ID>     Tunnel User-ID (Standard: 4, Fallback: 5, 2, 3)");
                println!("  --filter <TEXT>      Filter für Terminal-Ausgabe (z.B. 1.1.11 oder 6/0/)");
                println!("  -h, --help           Diese Hilfe anzeigen");
                println!();
                println!("Umgebungsvariablen:");
                println!("  KONFIX_GATEWAY_IP         Standard Gateway-IP");
                println!("  KONFIX_GATEWAY_PORT       Standard Gateway-Port (Standard: 3671)");
                println!("  KONFIX_KEYRING_PATH       Pfad zu .knxkeys");
                println!("  KONFIX_KEYRING_PASSWORD   Passwort für .knxkeys");
                println!("  KONFIX_LOCAL_IP           Lokale IP zur Ankündigung an ETS");
                std::process::exit(0);
            }
            other => {
                // If it doesn't start with dash and explicit_gw is not set yet, treat as gateway IP
                if !other.starts_with('-') && explicit_gw.is_none() {
                    explicit_gw = Some(other.to_string());
                }
                i += 1;
            }
        }
    }

    ParsedArgs {
        explicit_gw,
        listen_port,
        bind_ip,
        explicit_local_ip,
        explicit_keyring,
        explicit_pass,
        tunnel_user,
        filter,
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = parse_cli_args();
    let log_path = dirs_or_home_konfix().join("ets_debug_capture.log");
    let logger = Arc::new(Logger::new(log_path.clone(), args.filter.clone()));

    logger.log_highlight("KoNfiX Sniffer", "=======================================================");
    logger.log_highlight("KoNfiX Sniffer", "  KNXnet/IP Sniffer & Transparent Proxy für ETS");
    logger.log_highlight("KoNfiX Sniffer", "=======================================================");
    logger.log(&format!("Logdatei: {}", log_path.display()));
    if let Some(ref f) = args.filter {
        logger.log_highlight("Filter", &format!("Aktiver Terminal-Filter: '{}'", f));
    }

    // 1. Resolve Gateway IP dynamically (CLI argument, Env variable, or active project)
    let gw_target_addr = match resolve_gateway_target(args.explicit_gw) {
        Ok(addr) => addr,
        Err(err_msg) => {
            eprintln!("\n\x1b[1;31m[FEHLER]\x1b[0m {}\n", err_msg);
            std::process::exit(1);
        }
    };

    // 2. Resolve Keyring & Password dynamically
    let (keyring_path, keyring_pass) = match resolve_keyring(args.explicit_keyring, args.explicit_pass) {
        Ok(res) => res,
        Err(err_msg) => {
            eprintln!("\n\x1b[1;31m[FEHLER]\x1b[0m {}\n", err_msg);
            std::process::exit(1);
        }
    };

    logger.log(&format!("Lade Schlüsselbund aus {}...", keyring_path.display()));
    let xml_text = std::fs::read_to_string(&keyring_path)
        .map_err(|e| format!("Konnte Schlüsselbund nicht lesen ({}): {}", keyring_path.display(), e))?;
    let decrypted = parse_and_decrypt_knxkeys(&xml_text, &keyring_pass)
        .map_err(|e| format!("Konnte Schlüsselbund nicht entschlüsseln: {}", e))?;

    // Pick tunnel based on preference: CLI param or user_id 4 -> 5 -> 2 -> 3
    let tunnel = if let Some(uid) = args.tunnel_user {
        decrypted.tunnels.iter().find(|t| t.user_id == uid)
    } else {
        decrypted
            .tunnels
            .iter()
            .find(|t| t.user_id == 4)
            .or_else(|| decrypted.tunnels.iter().find(|t| t.user_id == 5))
            .or_else(|| decrypted.tunnels.iter().find(|t| t.user_id == 2))
            .or_else(|| decrypted.tunnels.iter().find(|t| t.user_id == 3))
    }
    .or_else(|| decrypted.tunnels.first())
    .ok_or("Keine Tunnel-Schnittstelle im Schlüsselbund gefunden")?;

    logger.log(&format!(
        "Verwende Gateway-Tunnel User ID {} (IA: {})...",
        tunnel.user_id, tunnel.individual_address
    ));

    let creds = KnxSecureCredentials {
        user_id: tunnel.user_id,
        user_password: tunnel.password.clone(),
        device_authentication: tunnel.authentication.clone(),
    };

    // 3. Detect local interface IP purely dynamically
    let env_local_ip = std::env::var("KONFIX_LOCAL_IP").ok().and_then(|ip| ip.parse().ok());
    let local_ip = detect_local_ip(gw_target_addr, args.explicit_local_ip.or(env_local_ip));
    logger.log(&format!(
        "Lokale Schnittstellen-IP ermittelt: {} (Routing zu Gateway {})",
        local_ip, gw_target_addr
    ));

    // 4. Connect to physical KNX Gateway via KNXnet/IP Secure TCP
    logger.log(&format!("Verbinde mit echtem Gateway auf {}...", gw_target_addr));
    let mut session = establish_secure_session(gw_target_addr, &creds)
        .await
        .map_err(|e| format!("Fehler beim IP Secure Verbindungsaufbau zu {}: {}", gw_target_addr, e))?;
    logger.log_highlight("Gateway", "IP Secure Sitzung erfolgreich aufgebaut!");

    // Open Tunneling connection with gateway
    let gw_seq = Arc::new(AtomicU64::new(1));
    let hpai_tcp = [0x08, 0x02, 0, 0, 0, 0, 0, 0];
    let cri = [0x04, 0x04, 0x02, 0x00]; // Tunneling Link Layer (TP1)
    let mut conn_req = Vec::with_capacity(26);
    conn_req.extend_from_slice(&[0x06, 0x10, 0x02, 0x05, 0x00, 0x1A]);
    conn_req.extend_from_slice(&hpai_tcp);
    conn_req.extend_from_slice(&hpai_tcp);
    conn_req.extend_from_slice(&cri);

    let wrapped_conn = wrap_secure_frame(
        &session.session_key,
        session.session_id,
        gw_seq.fetch_add(1, Ordering::SeqCst),
        &CLIENT_SERIAL,
        &conn_req,
    );
    session.stream.write_all(&wrapped_conn).await?;

    // Read CONNECT_RESPONSE from Gateway
    let mut hdr = [0u8; 6];
    tokio::time::timeout(Duration::from_millis(6000), session.stream.read_exact(&mut hdr))
        .await
        .map_err(|_| format!("Timeout beim Warten auf CONNECT_RESPONSE vom Gateway ({})", gw_target_addr))??;
    let wrap_len = u16::from_be_bytes([hdr[4], hdr[5]]) as usize;
    let mut body = vec![0u8; wrap_len - 6];
    session.stream.read_exact(&mut body).await?;
    let mut full = Vec::with_capacity(wrap_len);
    full.extend_from_slice(&hdr);
    full.extend_from_slice(&body);

    let plain_resp = unwrap_secure_frame(&session.session_key, session.session_id, &full)?;
    let (gw_channel_id, gw_status, _, _, gw_assigned_ia) =
        parse_connect_response(&plain_resp).ok_or("Ungültige CONNECT_RESPONSE vom Gateway")?;

    if gw_status != 0 {
        return Err(format!("Gateway lehnte Tunnelverbindung ab: Status {}", gw_status).into());
    }

    logger.log_highlight(
        "Gateway Tunnel",
        &format!("Tunnel aktiv! Kanal-ID: {}, Zugewiesene IA: {}", gw_channel_id, gw_assigned_ia),
    );

    let assigned_ia_raw = parse_individual_address(&gw_assigned_ia).unwrap_or(0x11FB);

    let (gw_tx_frame, mut gw_rx_frame) = mpsc::channel::<Vec<u8>>(200);
    let (ets_broadcast_tx, _) = broadcast::channel::<Vec<u8>>(200);

    let (mut gw_read_stream, mut gw_write_stream) = session.stream.into_split();
    let session_key = session.session_key;
    let session_id = session.session_id;
    let gw_seq_writer = gw_seq.clone();
    let logger_clone = logger.clone();

    // Background task: Gateway Keep-Alive (every 20s)
    let gw_tx_keepalive = gw_tx_frame.clone();
    let local_octets = local_ip.octets();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(20));
        loop {
            interval.tick().await;
            let req = build_connectionstate_request(gw_channel_id, local_octets, 3671);
            if gw_tx_keepalive.send(req).await.is_err() {
                break;
            }
        }
    });

    // Background task: Write frames to Gateway via Secure TCP
    tokio::spawn(async move {
        while let Some(plain_frame) = gw_rx_frame.recv().await {
            let wrapped = wrap_secure_frame(
                &session_key,
                session_id,
                gw_seq_writer.fetch_add(1, Ordering::SeqCst),
                &CLIENT_SERIAL,
                &plain_frame,
            );
            if let Err(e) = gw_write_stream.write_all(&wrapped).await {
                logger_clone.log(&format!("Fehler beim Senden an Gateway: {}", e));
                break;
            }
        }
    });

    // Background task: Read incoming frames from Gateway via Secure TCP
    let logger_gw_reader = logger.clone();
    let ets_tx_broadcaster = ets_broadcast_tx.clone();
    let gw_tx_ack = gw_tx_frame.clone();
    tokio::spawn(async move {
        loop {
            let mut hdr = [0u8; 6];
            if gw_read_stream.read_exact(&mut hdr).await.is_err() {
                break;
            }
            let total_len = u16::from_be_bytes([hdr[4], hdr[5]]) as usize;
            if total_len < 6 {
                break;
            }
            let mut rest = vec![0u8; total_len - 6];
            if gw_read_stream.read_exact(&mut rest).await.is_err() {
                break;
            }
            let mut full = Vec::with_capacity(total_len);
            full.extend_from_slice(&hdr);
            full.extend_from_slice(&rest);

            if let Ok(plain) = unwrap_secure_frame(&session_key, session_id, &full) {
                if plain.len() >= 4 && plain[0] == 0x06 && plain[1] == 0x10 {
                    let svc = u16::from_be_bytes([plain[2], plain[3]]);
                    if svc == SERVICE_TUNNELLING_REQ && plain.len() >= 10 {
                        let ch = plain[7];
                        let seq = plain[8];
                        // Auto-ACK to Gateway
                        let ack = build_tunnelling_ack(ch, seq, 0);
                        let _ = gw_tx_ack.send(ack).await;

                        let cemi = &plain[10..];
                        let desc = decode_cemi(cemi);
                        logger_gw_reader.log(&format!("[GW -> Sniffer] {}", desc));

                        // Broadcast to ETS listeners (both UDP and TCP)
                        let _ = ets_tx_broadcaster.send(cemi.to_vec());
                    } else if svc == SERVICE_CONNECTIONSTATE_RES {
                        // Keep-alive OK
                    } else if svc == SERVICE_TUNNELLING_ACK {
                        // Tunnelling ACK from gateway
                    } else {
                        logger_gw_reader.log(&format!("[GW Service 0x{:04X}] Raw: {}", svc, hex::encode(&plain)));
                    }
                }
            }
        }
    });

    // 5. Start UDP Listener on bind_ip:listen_port
    let listen_addr_str = format!("{}:{}", args.bind_ip, args.listen_port);
    let udp_socket = Arc::new(UdpSocket::bind(&listen_addr_str).await?);
    logger.log_highlight(
        "UDP Server",
        &format!("Lausche auf UDP {} bereit für ETS-Verbindungen...", listen_addr_str),
    );

    let multi_addr: Ipv4Addr = KNX_MULTICAST_IP.parse().unwrap();
    if let Err(e) = udp_socket.join_multicast_v4(multi_addr, local_ip) {
        logger.log(&format!("Multicast Hinweis: {}", e));
    } else {
        logger.log(&format!("Erfolgreich Multicast {} auf {} beigetreten.", KNX_MULTICAST_IP, local_ip));
    }

    const CHANNEL_TUNNEL: u8 = 1;
    const CHANNEL_MGMT: u8 = 2;

    let active_tunnel_endpoint = Arc::new(Mutex::new(None::<SocketAddr>));
    let active_mgmt_endpoint = Arc::new(Mutex::new(None::<SocketAddr>));
    let ets_tunnel_out_seq = Arc::new(AtomicU8::new(0));

    // Task to forward bus responses to ETS via UDP TUNNELLING_REQUEST (nur an Tunnel-Endpunkt)
    {
        let udp_sock_tx = udp_socket.clone();
        let active_tunnel_ep = active_tunnel_endpoint.clone();
        let out_seq = ets_tunnel_out_seq.clone();
        let mut ets_rx_sub = ets_broadcast_tx.subscribe();
        let logger_fwd = logger.clone();

        tokio::spawn(async move {
            while let Ok(cemi) = ets_rx_sub.recv().await {
                if let Some(ets_addr) = *active_tunnel_ep.lock().await {
                    let desc = decode_cemi(&cemi);
                    let seq = out_seq.fetch_add(1, Ordering::SeqCst);
                    let req = build_tunnelling_request_raw(CHANNEL_TUNNEL, seq, &cemi);
                    let _ = udp_sock_tx.send_to(&req, ets_addr).await;
                    logger_fwd.log_highlight("Sniffer -> ETS (UDP)", &format!("cEMI seq={} an {}: {} | Hex: {}", seq, ets_addr, desc, hex::encode(&cemi)));
                }
            }
        });
    }

    // UDP Receive Loop
    let gw_tx_for_ets = gw_tx_frame.clone();
    let logger_udp = logger.clone();
    let udp_sock_rx = udp_socket.clone();
    let active_tunnel_ep_rx = active_tunnel_endpoint.clone();
    let active_mgmt_ep_rx = active_mgmt_endpoint.clone();
    let gw_send_seq = Arc::new(AtomicU8::new(0));
    let gw_send_seq_udp = gw_send_seq.clone();
    let listen_port = args.listen_port;
    let assigned_ia_udp = assigned_ia_raw;

    tokio::spawn(async move {
        let mut buf = [0u8; 2048];
        loop {
            let (len, src_addr) = match udp_sock_rx.recv_from(&mut buf).await {
                Ok(res) => res,
                Err(e) => {
                    logger_udp.log(&format!("UDP recv error: {}", e));
                    break;
                }
            };

            let pkt = &buf[..len];
            if pkt.len() < 6 || pkt[0] != 0x06 || pkt[1] != 0x10 {
                continue;
            }
            let service_type = u16::from_be_bytes([pkt[2], pkt[3]]);

            match service_type {
                SERVICE_SEARCH_REQ => {
                    logger_udp.log(&format!("[ETS -> UDP] SEARCH_REQUEST von {}", src_addr));
                    let resp = build_search_response(SERVICE_SEARCH_RES, local_ip, listen_port);
                    let _ = udp_sock_rx.send_to(&resp, src_addr).await;
                    logger_udp.log_highlight("UDP", &format!("SEARCH_RESPONSE gesendet an {}", src_addr));
                }
                SERVICE_SEARCH_REQ_EXT => {
                    logger_udp.log_highlight("UDP Discovery", &format!("[ETS -> UDP] SEARCH_REQUEST_EXTENDED (0x020B) von {}", src_addr));
                    let target_ep = if pkt.len() >= 14 && pkt[6] == 0x08 {
                        let ip = [pkt[8], pkt[9], pkt[10], pkt[11]];
                        let port = u16::from_be_bytes([pkt[12], pkt[13]]);
                        SocketAddr::from((ip, port))
                    } else {
                        src_addr
                    };
                    let resp = build_search_response(SERVICE_SEARCH_RES_EXT, local_ip, listen_port);
                    let _ = udp_sock_rx.send_to(&resp, target_ep).await;
                    logger_udp.log_highlight("UDP Discovery", &format!("SEARCH_RESPONSE_EXTENDED gesendet an {}", target_ep));
                }
                SERVICE_DESCRIPTION_REQ => {
                    logger_udp.log(&format!("[ETS -> UDP] DESCRIPTION_REQUEST von {}", src_addr));
                    let resp = build_description_response(local_ip);
                    let _ = udp_sock_rx.send_to(&resp, src_addr).await;
                }
                SERVICE_CONNECT_REQ => {
                    let (ctrl_ep, data_ep) = if pkt.len() >= 22 {
                        let cip = [pkt[8], pkt[9], pkt[10], pkt[11]];
                        let cport = u16::from_be_bytes([pkt[12], pkt[13]]);
                        let dip = [pkt[16], pkt[17], pkt[18], pkt[19]];
                        let dport = u16::from_be_bytes([pkt[20], pkt[21]]);
                        (
                            SocketAddr::from((cip, cport)),
                            SocketAddr::from((dip, dport)),
                        )
                    } else {
                        (src_addr, src_addr)
                    };

                    let conn_type = if pkt.len() >= 24 { pkt[23] } else { 0x04 };
                    let (type_name, channel_id) = match conn_type {
                        0x03 => ("Device Management (0x03)", CHANNEL_MGMT),
                        _ => ("Tunneling (0x04)", CHANNEL_TUNNEL),
                    };

                    logger_udp.log_highlight(
                        "ETS Connect (UDP)",
                        &format!("CONNECT_REQUEST von ETS! Typ: {}, Control: {}, Data: {} -> Weise Kanal {} zu", type_name, ctrl_ep, data_ep, channel_id),
                    );

                    if conn_type == 0x03 {
                        *active_mgmt_ep_rx.lock().await = Some(data_ep);
                    } else {
                        *active_tunnel_ep_rx.lock().await = Some(data_ep);
                        ets_tunnel_out_seq.store(0, Ordering::SeqCst);
                    }

                    let resp = build_typed_connect_response(
                        channel_id,
                        0x00, // Status OK
                        conn_type,
                        assigned_ia_udp, // Real Gateway Assigned IA (1.1.251)
                        false, // is_tcp = false
                        local_ip,
                        listen_port,
                    );

                    let _ = udp_sock_rx.send_to(&resp, ctrl_ep).await;
                    logger_udp.log_highlight(
                        "ETS Connect (UDP)",
                        &format!("CONNECT_RESPONSE ({}, Kanal {}) an ETS ({}) gesendet!", type_name, channel_id, ctrl_ep),
                    );
                }
                SERVICE_CONNECTIONSTATE_REQ => {
                    let ch = if pkt.len() > 6 { pkt[6] } else { 1 };
                    let mut resp = Vec::new();
                    resp.extend_from_slice(&[0x06, 0x10, 0x02, 0x08, 0x00, 0x08]);
                    resp.push(ch);
                    resp.push(0x00);
                    let _ = udp_sock_rx.send_to(&resp, src_addr).await;
                }
                SERVICE_TUNNELLING_REQ => {
                    if pkt.len() >= 10 {
                        let ch = pkt[7];
                        let seq = pkt[8];
                        let ack = build_tunnelling_ack(ch, seq, 0);
                        let _ = udp_sock_rx.send_to(&ack, src_addr).await;

                        let cemi = &pkt[10..];
                        let desc = decode_cemi(cemi);
                        logger_udp.log_highlight("ETS -> Bus (UDP)", &format!("{} | Hex: {}", desc, hex::encode(cemi)));

                        let gw_seq_val = gw_send_seq_udp.fetch_add(1, Ordering::SeqCst);
                        let gw_req = build_tunnelling_request_raw(gw_channel_id, gw_seq_val, cemi);
                        let _ = gw_tx_for_ets.send(gw_req).await;
                    }
                }
                SERVICE_TUNNELLING_ACK => {}
                SERVICE_DEVICE_CONFIG_REQ => {
                    if pkt.len() >= 10 {
                        let ch = pkt[7];
                        let seq = pkt[8];
                        let mut ack = Vec::with_capacity(10);
                        ack.extend_from_slice(&[0x06, 0x10, 0x03, 0x11, 0x00, 0x0A]);
                        ack.extend_from_slice(&[0x04, ch, seq, 0x00]);
                        let _ = udp_sock_rx.send_to(&ack, src_addr).await;

                        let cemi = &pkt[10..];
                        let desc = decode_cemi(cemi);
                        logger_udp.log_highlight("ETS Mgmt -> Bus (UDP)", &format!("{} | Hex: {}", desc, hex::encode(cemi)));

                        if let Some(con_cemi) = handle_device_management_cemi(cemi, assigned_ia_udp) {
                            let mut conf_req = Vec::new();
                            conf_req.extend_from_slice(&[0x06, 0x10, 0x03, 0x10]);
                            let total_len: u16 = 6 + 4 + con_cemi.len() as u16;
                            conf_req.extend_from_slice(&total_len.to_be_bytes());
                            conf_req.extend_from_slice(&[0x04, ch, 0, 0x00]);
                            conf_req.extend_from_slice(&con_cemi);
                            let _ = udp_sock_rx.send_to(&conf_req, src_addr).await;
                            logger_udp.log_highlight("Sniffer Mgmt -> ETS (UDP)", &format!("M_PropRead.con gesendet ({}) | Hex: {}", decode_cemi(&con_cemi), hex::encode(&con_cemi)));
                        }
                    }
                }
                SERVICE_DISCONNECT_REQ => {
                    let ch = if pkt.len() > 6 { pkt[6] } else { 1 };
                    let mut resp = Vec::new();
                    resp.extend_from_slice(&[0x06, 0x10, 0x02, 0x0A, 0x00, 0x08]);
                    resp.push(ch);
                    resp.push(0x00);
                    let _ = udp_sock_rx.send_to(&resp, src_addr).await;

                    if ch == CHANNEL_MGMT {
                        *active_mgmt_ep_rx.lock().await = None;
                        logger_udp.log_highlight(
                            "ETS Disconnect",
                            &format!("DISCONNECT_RESPONSE (UDP) für Device Management (Kanal {}) an {} gesendet. Tunnel-Kanal {} bleibt unberührt AKTIV.", ch, src_addr, CHANNEL_TUNNEL),
                        );
                    } else if ch == CHANNEL_TUNNEL {
                        *active_tunnel_ep_rx.lock().await = None;
                        logger_udp.log_highlight(
                            "ETS Disconnect",
                            &format!("DISCONNECT_RESPONSE (UDP) für Tunneling (Kanal {}) an {} gesendet.", ch, src_addr),
                        );
                    } else {
                        logger_udp.log_highlight(
                            "ETS Disconnect",
                            &format!("DISCONNECT_RESPONSE (UDP) für Kanal {} an {} gesendet.", ch, src_addr),
                        );
                    }
                }
                _ => {
                    logger_udp.log(&format!("[ETS UDP Service 0x{:04X}] Raw: {}", service_type, hex::encode(pkt)));
                }
            }
        }
    });

    // 6. Start TCP Listener on bind_ip:listen_port
    let tcp_listener = TcpListener::bind(&listen_addr_str).await?;
    logger.log_highlight(
        "TCP Server",
        &format!("Lausche auf TCP {} bereit für ETS-Verbindungen...", listen_addr_str),
    );

    let gw_tx_for_tcp = gw_tx_frame.clone();
    let logger_tcp = logger.clone();
    let gw_send_seq_tcp = gw_send_seq.clone();
    let ets_broadcast_tcp = ets_broadcast_tx.clone();
    let assigned_ia_tcp = assigned_ia_raw;

    tokio::spawn(async move {
        while let Ok((stream, peer_addr)) = tcp_listener.accept().await {
            logger_tcp.log_highlight("TCP Client", &format!("ETS TCP Verbindung akzeptiert von: {}", peer_addr));
            let gw_tx = gw_tx_for_tcp.clone();
            let logger_peer = logger_tcp.clone();
            let gw_seq_p = gw_send_seq_tcp.clone();
            let mut ets_rx_sub = ets_broadcast_tcp.subscribe();

            tokio::spawn(async move {
                let (mut reader, writer) = stream.into_split();
                let writer = Arc::new(Mutex::new(writer));

                // Forward incoming bus cEMI to TCP ETS
                let writer_fwd = writer.clone();
                let logger_fwd = logger_peer.clone();
                tokio::spawn(async move {
                    let mut out_seq: u8 = 0;
                    while let Ok(cemi) = ets_rx_sub.recv().await {
                        let desc = decode_cemi(&cemi);
                        let req = build_tunnelling_request_raw(1, out_seq, &cemi);
                        out_seq = out_seq.wrapping_add(1);
                        if let Ok(mut w) = writer_fwd.try_lock() {
                            if w.write_all(&req).await.is_err() {
                                break;
                            }
                            logger_fwd.log_highlight("Sniffer -> ETS (TCP)", &format!("cEMI seq={} an {}: {}", out_seq, peer_addr, desc));
                        }
                    }
                });

                // Read packets from ETS over TCP
                loop {
                    let mut hdr = [0u8; 6];
                    if reader.read_exact(&mut hdr).await.is_err() {
                        break;
                    }
                    if hdr[0] != 0x06 || hdr[1] != 0x10 {
                        continue;
                    }
                    let total_len = u16::from_be_bytes([hdr[4], hdr[5]]) as usize;
                    if total_len < 6 {
                        break;
                    }
                    let mut body = vec![0u8; total_len - 6];
                    if reader.read_exact(&mut body).await.is_err() {
                        break;
                    }

                    let mut pkt = Vec::with_capacity(total_len);
                    pkt.extend_from_slice(&hdr);
                    pkt.extend_from_slice(&body);

                    let service_type = u16::from_be_bytes([pkt[2], pkt[3]]);
                    match service_type {
                        SERVICE_CONNECT_REQ => {
                            let conn_type = if pkt.len() >= 24 { pkt[23] } else { 0x04 };
                            let type_name = match conn_type {
                                0x03 => "Device Management (0x03)",
                                0x04 => "Tunneling (0x04)",
                                _ => "Anderer Typ",
                            };
                            logger_peer.log_highlight(
                                "ETS Connect (TCP)",
                                &format!("CONNECT_REQUEST über TCP erhalten! Typ: {}", type_name),
                            );

                            let resp = build_typed_connect_response(
                                1, // Channel 1
                                0x00, // OK
                                conn_type,
                                assigned_ia_tcp, // Real Gateway Assigned IA (1.1.251)
                                true, // is_tcp = true
                                local_ip,
                                listen_port,
                            );

                            let mut w = writer.lock().await;
                            if let Err(e) = w.write_all(&resp).await {
                                logger_peer.log(&format!("Fehler beim Senden von CONNECT_RESPONSE (TCP): {}", e));
                            } else {
                                logger_peer.log_highlight(
                                    "ETS Connect (TCP)",
                                    &format!("CONNECT_RESPONSE ({}, Kanal 1) an ETS über TCP gesendet!", type_name),
                                );
                            }
                        }
                        SERVICE_CONNECTIONSTATE_REQ => {
                            let ch = if pkt.len() > 6 { pkt[6] } else { 1 };
                            let mut resp = Vec::new();
                            resp.extend_from_slice(&[0x06, 0x10, 0x02, 0x08, 0x00, 0x08]);
                            resp.push(ch);
                            resp.push(0x00);
                            let mut w = writer.lock().await;
                            let _ = w.write_all(&resp).await;
                        }
                        SERVICE_TUNNELLING_REQ => {
                            if pkt.len() >= 10 {
                                let ch = pkt[7];
                                let seq = pkt[8];

                                let ack = build_tunnelling_ack(ch, seq, 0);
                                {
                                    let mut w = writer.lock().await;
                                    let _ = w.write_all(&ack).await;
                                }

                                let cemi = &pkt[10..];
                                let desc = decode_cemi(cemi);
                                logger_peer.log_highlight("ETS -> Bus (TCP)", &desc);

                                let seq_gw = gw_seq_p.fetch_add(1, Ordering::SeqCst);
                                let gw_req = build_tunnelling_request_raw(gw_channel_id, seq_gw, cemi);
                                let _ = gw_tx.send(gw_req).await;
                            }
                        }
                        SERVICE_TUNNELLING_ACK => {}
                        SERVICE_DEVICE_CONFIG_REQ => {
                            if pkt.len() >= 10 {
                                let ch = pkt[7];
                                let seq = pkt[8];
                                let mut ack = Vec::with_capacity(10);
                                ack.extend_from_slice(&[0x06, 0x10, 0x03, 0x11, 0x00, 0x0A]);
                                ack.extend_from_slice(&[0x04, ch, seq, 0x00]);
                                let mut w = writer.lock().await;
                                let _ = w.write_all(&ack).await;

                                let cemi = &pkt[10..];
                                let desc = decode_cemi(cemi);
                                logger_peer.log_highlight("ETS Mgmt -> Bus (TCP)", &desc);

                                if let Some(con_cemi) = handle_device_management_cemi(cemi, assigned_ia_tcp) {
                                    let mut conf_req = Vec::new();
                                    conf_req.extend_from_slice(&[0x06, 0x10, 0x03, 0x10]);
                                    let total_len: u16 = 6 + 4 + con_cemi.len() as u16;
                                    conf_req.extend_from_slice(&total_len.to_be_bytes());
                                    conf_req.extend_from_slice(&[0x04, ch, 0, 0x00]);
                                    conf_req.extend_from_slice(&con_cemi);
                                    let _ = w.write_all(&conf_req).await;
                                    logger_peer.log_highlight("Sniffer Mgmt -> ETS (TCP)", &format!("M_PropRead.con gesendet ({})", decode_cemi(&con_cemi)));
                                }
                            }
                        }
                        SERVICE_DISCONNECT_REQ => {
                            let ch = if pkt.len() > 6 { pkt[6] } else { 1 };
                            let mut resp = Vec::new();
                            resp.extend_from_slice(&[0x06, 0x10, 0x02, 0x0A, 0x00, 0x08]);
                            resp.push(ch);
                            resp.push(0x00);
                            let mut w = writer.lock().await;
                            let _ = w.write_all(&resp).await;
                            logger_peer.log("DISCONNECT_RESPONSE (TCP) an ETS gesendet.");
                        }
                        _ => {
                            logger_peer.log(&format!("[ETS TCP Service 0x{:04X}] Raw: {}", service_type, hex::encode(&pkt)));
                        }
                    }
                }
            });
        }
    });

    logger.log_highlight("Bereit", "=======================================================");
    logger.log_highlight("Bereit", "Der KoNfiX Sniffer ist jetzt scharf geschaltet!");
    logger.log_highlight("Bereit", &format!("1. Live-Monitoring: Lauscht auf Bus-Telegramme via Gateway {}", gw_target_addr));
    logger.log_highlight("Bereit", &format!("2. ETS-Proxy:       Lauscht auf {}:{} (UDP & TCP)", local_ip, listen_port));
    logger.log_highlight("Bereit", "=======================================================");

    tokio::signal::ctrl_c().await?;
    logger.log_highlight("Sniffer", "Sniffer wird sauber beendet.");

    Ok(())
}

fn dirs_or_home_konfix() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home).join(".konfix")
    } else {
        PathBuf::from(".konfix")
    }
}
