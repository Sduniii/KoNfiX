use crate::knxprod::{format_knxprod_dpt, infer_channels_from_product, parse_app_program_xml};
use crate::model::*;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use tracing::info;
use uuid::Uuid;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ImportSummary {
    pub success: bool,
    pub file_name: String,
    pub project_name: String,
    pub group_address_count: usize,
    pub room_count: usize,
    pub floor_count: usize,
    pub block_count: usize,
    pub message: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DetectedImportFile {
    pub path: String,
    pub name: String,
    pub file_type: String, // "knxproj" | "csv"
    pub size_bytes: u64,
}

/// Discovers local .knxproj and .csv files in common user directories
pub fn find_local_import_files() -> Vec<DetectedImportFile> {
    let mut files = Vec::new();
    let mut search_dirs = Vec::new();

    if let Ok(home) = std::env::var("HOME") {
        search_dirs.push(PathBuf::from(format!("{}/.konfix", home)));
        search_dirs.push(PathBuf::from(format!("{}/Downloads", home)));
        search_dirs.push(PathBuf::from(format!("{}/Documents", home)));
        search_dirs.push(PathBuf::from(format!("{}/Desktop", home)));
    }
    search_dirs.push(PathBuf::from("."));

    let mut seen = HashSet::new();

    for dir in search_dirs {
        if !dir.exists() {
            continue;
        }
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_file() {
                    let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
                    if ext == "knxproj" || ext == "csv" {
                        let path_str = p.to_string_lossy().to_string();
                        if seen.insert(path_str.clone()) {
                            let meta = entry.metadata().ok();
                            let size = meta.map(|m| m.len()).unwrap_or(0);
                            let file_name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                            files.push(DetectedImportFile {
                                path: path_str,
                                name: file_name,
                                file_type: ext,
                                size_bytes: size,
                            });
                        }
                    }
                }
            }
        }
    }

    files
}

/// Infers KNX Datapoint Type from German function name
pub fn infer_dpt_from_name(name: &str) -> &'static str {
    let lower = name.to_lowercase();
    if lower.contains("auf/ab") || lower.contains("auf-ab") || lower.contains("auf / ab") || lower.contains("fahren") {
        "1.008"
    } else if lower.contains("stopp") || lower.contains("stop") {
        "1.010"
    } else if lower.contains("schalten")
        || lower.contains("ein/aus")
        || (lower.contains("status") && !lower.contains("wert") && !lower.contains("position"))
        || lower.contains("präsenz")
        || lower.contains("bewegung")
        || lower.contains("kontakt")
        || lower.contains("fenster")
        || lower.contains("tag / nacht")
        || lower.contains("tag/nacht")
        || lower.contains("frost")
        || lower.contains("komfort")
    {
        "1.001"
    } else if lower.contains("dimmen") && !lower.contains("wert") {
        "3.007"
    } else if lower.contains("lamelle") && !lower.contains("position") {
        "3.008"
    } else if lower.contains("position") || lower.contains("stellwert") || lower.contains("stellgröße") || lower.contains("prozent") || lower.contains("dimmwert") || lower.contains("luftfeuchtigkeit") || lower.contains("uv") {
        "5.001"
    } else if lower.contains("temperatur") || lower.contains("sollwert") || lower.contains("istwert") || lower.contains("regen") || lower.contains("wind") || lower.contains("luftdruck") {
        "9.001"
    } else if lower.contains("hvac") || lower.contains("betriebsart") || lower.contains("betriebsvorwahl") {
        "20.102"
    } else if lower.contains("szene") {
        "18.001"
    } else {
        "1.001"
    }
}

/// Maps room name to suitable Lucide icon name
fn get_room_icon(name: &str) -> &'static str {
    let lower = name.to_lowercase();
    if lower.contains("wohn") || lower.contains("couch") {
        "sofa"
    } else if lower.contains("küche") || lower.contains("kueche") || lower.contains("essen") || lower.contains("esstisch") {
        "utensils"
    } else if lower.contains("schlaf") || lower.contains("bett") {
        "bed"
    } else if lower.contains("bad") || lower.contains("wc") || lower.contains("dusche") {
        "bath"
    } else if lower.contains("flur") || lower.contains("diele") || lower.contains("gang") || lower.contains("treppe") {
        "door-open"
    } else if lower.contains("büro") || lower.contains("arbeit") || lower.contains("server") {
        "briefcase"
    } else if lower.contains("keller") || lower.contains("lager") || lower.contains("technik") || lower.contains("heizung") {
        "wrench"
    } else if lower.contains("wasch") || lower.contains("hwr") {
        "shirt"
    } else if lower.contains("aussen") || lower.contains("außen") || lower.contains("garten") || lower.contains("terrasse") || lower.contains("balkon") || lower.contains("wetter") {
        "sun"
    } else {
        "home"
    }
}

/// Canonical room grouping: groups sub-zones like "Küche Arbeitsbereich" or "Wohnzimmer Couch"
/// into main room "Küche", "Wohnzimmer" for cleaner room tabs
fn canonicalize_room_name(raw: &str) -> (String, Option<String>) {
    let raw = raw.trim();
    if let Some(pos) = raw.find(" - ") {
        let parent = raw[..pos].trim().to_string();
        let sub = raw[pos + 3..].trim().to_string();
        return (parent, Some(sub));
    }

    let main_rooms = [
        "Wohnzimmer",
        "Küche",
        "Schlafzimmer",
        "Bad",
        "Flur",
        "Server",
        "Heizungraum",
        "Heizungsraum",
        "Kriechkeller",
        "Lager",
        "Waschraum",
        "Eingang",
        "Bresser",
    ];

    for main in main_rooms {
        if let Some(sub_slice) = raw.strip_prefix(main) {
            let sub = sub_slice.trim();
            let sub_opt = if sub.is_empty() { None } else { Some(sub.to_string()) };
            let display_main = if main == "Heizungraum" { "Heizungsraum" } else { main };
            return (display_main.to_string(), sub_opt);
        }
    }

    (raw.to_string(), None)
}

/// Parses ETS Group Address CSV (UTF-8 or Latin-1)
pub fn parse_ets_csv(content: &str, project_name: &str) -> Result<Project, String> {
    let mut group_addresses = Vec::new();
    let mut current_main_name = String::new();
    let mut current_mid_name = String::new();

    // Floor & Room tracking
    let building_id = Uuid::new_v4();
    let mut floor_map: HashMap<String, (Uuid, i32)> = HashMap::new(); // floor_name -> (id, level)
    let mut room_map: HashMap<String, (Uuid, Uuid)> = HashMap::new();  // room_name -> (id, floor_id)
    let mut rooms_list = Vec::new();

    // Map common floor codes
    let get_or_create_floor = |floor_name: &str, floor_map: &mut HashMap<String, (Uuid, i32)>| -> Uuid {
        let (canonical_floor, level) = match floor_name.to_uppercase().as_str() {
            "EG" | "ERDGESCHOSS" => ("Erdgeschoss", 0),
            "OG" | "OBERGESCHOSS" | "1.OG" => ("Obergeschoss", 1),
            "KG" | "KELLER" | "KELLERGESCHOSS" | "UG" => ("Kellergeschoss", -1),
            "DG" | "DACHGESCHOSS" | "2.OG" => ("Dachgeschoss", 2),
            "AUSSEN" | "AUßEN" | "AUSSENBEREICH" => ("Außenbereich", 0),
            "ZENTRAL" | "ZENTRALFUNKTION" => ("Zentral / Allgemein", 0),
            _ => (floor_name, 0),
        };

        if let Some((id, _)) = floor_map.get(canonical_floor) {
            *id
        } else {
            let id = Uuid::new_v4();
            floor_map.insert(canonical_floor.to_string(), (id, level));
            id
        }
    };

    // Parse lines
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // Split by semicolon (ETS CSV standard)
        let cols: Vec<&str> = line
            .split(';')
            .map(|s| s.trim().trim_matches('"').trim())
            .collect();

        if cols.len() < 4 {
            continue;
        }

        let c0 = cols[0];
        let c1 = cols[1];
        let c2 = cols[2];
        let c3 = cols[3];

        // Main group: "Rollos";;;"1/-/-"
        if !c0.is_empty() && c3.ends_with("/-/-") {
            current_main_name = c0.to_string();
            continue;
        }

        // Middle group: ;"EG";;"1/0/-"
        if !c1.is_empty() && c3.ends_with("/-") {
            current_mid_name = c1.to_string();
            continue;
        }

        // Concrete Group Address: ;;"|Wohnzimmer Süd Links| Auf/Ab";"1/0/0"
        if !c2.is_empty() && c3.contains('/') && !c3.ends_with('-') {
            let ga_parts: Vec<&str> = c3.split('/').collect();
            if ga_parts.len() != 3 {
                continue;
            }

            let main_num = ga_parts[0].parse::<u8>().unwrap_or(0);
            let mid_num = ga_parts[1].parse::<u8>().unwrap_or(0);
            let sub_num = ga_parts[2].parse::<u8>().unwrap_or(0);

            let dpt = infer_dpt_from_name(c2);

            // Extract room: |RoomName| FunctionName
            let (room_name_opt, _func_name) = if let Some(stripped) = c2.strip_prefix('|') {
                if let Some(end_idx) = stripped.find('|') {
                    let r_raw = &stripped[..end_idx];
                    let f_raw = stripped[end_idx + 1..].trim();
                    (Some(r_raw.trim().to_string()), f_raw.to_string())
                } else {
                    (None, c2.to_string())
                }
            } else {
                (None, c2.to_string())
            };

            // Associate room with floor
            if let Some(r_name) = room_name_opt {
                let (canonical_room, _) = canonicalize_room_name(&r_name);
                let floor_name = if !current_mid_name.is_empty() {
                    current_mid_name.as_str()
                } else if !current_main_name.is_empty() {
                    current_main_name.as_str()
                } else {
                    "Erdgeschoss"
                };

                let floor_id = get_or_create_floor(floor_name, &mut floor_map);

                if !room_map.contains_key(&canonical_room) {
                    let r_id = Uuid::new_v4();
                    room_map.insert(canonical_room.clone(), (r_id, floor_id));
                    rooms_list.push(Room {
                        id: r_id,
                        floor_id,
                        name: canonical_room.clone(),
                        icon: get_room_icon(&canonical_room).to_string(),
                    });
                }
            }

            let description = if !current_main_name.is_empty() && !current_mid_name.is_empty() {
                format!("{} / {}", current_main_name, current_mid_name)
            } else if !current_main_name.is_empty() {
                current_main_name.clone()
            } else {
                "Importiert aus ETS".to_string()
            };

            group_addresses.push(GroupAddress {
                id: Uuid::new_v4(),
                address: c3.to_string(),
                main: main_num,
                middle: mid_num,
                sub: sub_num,
                name: c2.to_string(),
                dpt: dpt.to_string(),
                description,
                origin_block_id: None,
                origin_pin_name: None,
                is_custom: true, // Preserve real ETS addresses
                ..Default::default()
            });
        }
    }

    if group_addresses.is_empty() {
        return Err("Keine gültigen KNX-Gruppenadressen in der CSV-Datei gefunden. Bitte ETS-Format prüfen.".to_string());
    }

    // Build Floors
    let mut floors = Vec::new();
    for (name, (id, level)) in floor_map {
        floors.push(Floor {
            id,
            building_id,
            name,
            level,
        });
    }
    floors.sort_by_key(|f| f.level);

    // If no rooms extracted, create default EG room
    if rooms_list.is_empty() {
        let default_floor_id = floors.first().map(|f| f.id).unwrap_or_else(Uuid::new_v4);
        rooms_list.push(Room {
            id: Uuid::new_v4(),
            floor_id: default_floor_id,
            name: "Erdgeschoss".to_string(),
            icon: "home".to_string(),
        });
    }

    // Auto-generate sample function blocks for discovered roller/blind and climate rooms
    let mut blocks = Vec::new();
    let mut room_blocks_count: HashMap<Uuid, usize> = HashMap::new();

    // Group rollos by room
    let mut rollos_by_room: HashMap<String, Vec<&GroupAddress>> = HashMap::new();
    for ga in &group_addresses {
        if (ga.main == 1 || ga.description.to_lowercase().contains("rollo") || ga.name.to_lowercase().contains("auf/ab"))
            && ga.name.starts_with('|')
        {
            if let Some(end) = ga.name[1..].find('|') {
                let r_raw = &ga.name[1..1 + end];
                rollos_by_room.entry(r_raw.trim().to_string()).or_default().push(ga);
            }
        }
    }

    for (r_raw, ga_list) in rollos_by_room {
        let (canonical_r, sub) = canonicalize_room_name(&r_raw);
        if let Some((room_id, _)) = room_map.get(&canonical_r) {
            let block_name = if let Some(s) = sub {
                format!("Jalousie {}", s)
            } else {
                format!("Jalousie {}", canonical_r)
            };

            let block_id = Uuid::new_v4();
            let count = room_blocks_count.entry(*room_id).or_insert(0);
            let pos_y = 120.0 + (*count as f64 * 160.0);
            *count += 1;

            let move_ga = ga_list.iter().find(|g| g.name.contains("Auf/Ab")).map(|g| g.id);
            let stop_ga = ga_list.iter().find(|g| g.name.contains("Stopp") || g.name.contains("Stop")).map(|g| g.id);
            let pos_ga = ga_list.iter().find(|g| g.name.contains("Position") && !g.name.contains("Status")).map(|g| g.id);

            blocks.push(FunctionBlock {
                id: block_id,
                name: block_name,
                block_type: FunctionBlockType::BlindController,
                room_id: Some(*room_id),
                position: Position { x: 320.0, y: pos_y },
                inputs: vec![
                    BlockPin {
                        id: format!("{}-in-up", block_id),
                        name: "up".to_string(),
                        description: "Aufwärts / Öffnen".to_string(),
                        dpt: DptType::Dpt1_008,
                        direction: PinDirection::Input,
                        group_address_id: move_ga,
                    },
                    BlockPin {
                        id: format!("{}-in-down", block_id),
                        name: "down".to_string(),
                        description: "Abwärts / Schließen".to_string(),
                        dpt: DptType::Dpt1_008,
                        direction: PinDirection::Input,
                        group_address_id: move_ga,
                    },
                    BlockPin {
                        id: format!("{}-in-stop", block_id),
                        name: "stop".to_string(),
                        description: "Fahrt anhalten".to_string(),
                        dpt: DptType::Dpt1_010,
                        direction: PinDirection::Input,
                        group_address_id: stop_ga,
                    },
                ],
                outputs: vec![
                    BlockPin {
                        id: format!("{}-out-pos", block_id),
                        name: "pos".to_string(),
                        description: "Jalousie-Position (0-100%)".to_string(),
                        dpt: DptType::Dpt5_001,
                        direction: PinDirection::Output,
                        group_address_id: pos_ga,
                    },
                ],
                parameters: serde_json::json!({
                    "full_drive_time_ms": 25000,
                    "blade_turn_time_ms": 1200
                }),
                state: serde_json::json!({
                    "current_position": 0,
                    "blade_position": 0,
                    "is_moving": false
                }),
            });
        }
    }

    info!(
        "ETS CSV Import erfolgreich: {} Gruppenadressen, {} Räume, {} Etagen, {} generierte Bausteine",
        group_addresses.len(),
        rooms_list.len(),
        floors.len(),
        blocks.len()
    );

    let mut project = Project {
        id: Uuid::new_v4(),
        name: if project_name.is_empty() { "KNX Importiertes Projekt".to_string() } else { project_name.to_string() },
        ga_scheme: GaScheme::TradeRoomFunction,
        buildings: vec![Building {
            id: building_id,
            name: "Hauptgebäude".to_string(),
        }],
        floors,
        rooms: rooms_list,
        devices: Vec::new(),
        blocks,
        connections: Vec::new(),
        group_addresses,
        topology: None,
        ..Default::default()
    };
    crate::topology::TopologyManager::ensure_topology(&mut project);
    Ok(project)
}

/// Derives ETS6 decryption key using PBKDF2-HMAC-SHA256 with standard ETS6 salt
pub fn derive_ets6_key(password: &str) -> String {
    use base64::Engine;
    use base64::prelude::BASE64_STANDARD;
    use sha2::Sha256;

    let pw_u16: Vec<u8> = password.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    let salt = b"21.project.ets.knx.org";
    let mut key = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha256>(&pw_u16, salt, 65536, &mut key);
    BASE64_STANDARD.encode(key)
}

/// Imports .knxproj archive, extracting project.xml and 0.xml
#[derive(Debug, Default, Clone)]
pub struct RawProductInfo {
    pub id: String,
    pub order_number: String,
    pub text: String,
    pub german_text: String,
    pub manufacturer_name: String,
    pub hardware_name: String,
    pub bus_current_ma: u16,
}

#[derive(Debug, Default, Clone)]
pub struct RawAppProgramInfo {
    pub id: String,
    pub name: String,
    pub mask_version: String,
    pub communication_objects: Vec<CommunicationObject>,
    pub parameters: Vec<DeviceParameter>,
    pub pref_to_param: HashMap<String, String>,
    pub assign_rules: Vec<ParameterAssignRule>,
}

#[derive(Debug, Default, Clone)]
pub struct KnxprojCatalogContext {
    pub manufacturers: HashMap<String, String>,
    pub hardware_products: HashMap<String, RawProductInfo>,
    pub hardware2program: HashMap<String, String>,
    pub app_programs: HashMap<String, RawAppProgramInfo>,
}

/// Maximum allowed decompressed size for an XML entry in a project archive (64 MB)
const MAX_DECOMPRESSED_ENTRY_SIZE: u64 = 64 * 1024 * 1024;

fn extract_catalog_context(outer_zip: &mut zip::ZipArchive<std::io::Cursor<&[u8]>>) -> KnxprojCatalogContext {
    use quick_xml::events::Event;
    use quick_xml::reader::Reader;
    use std::io::Read;

    let mut ctx = KnxprojCatalogContext::default();

    // 1. Read knx_master.xml
    if let Ok(mut f) = outer_zip.by_name("knx_master.xml") {
        let mut content = String::new();
        if f.by_ref().take(MAX_DECOMPRESSED_ENTRY_SIZE + 1).read_to_string(&mut content).is_ok() && content.len() as u64 <= MAX_DECOMPRESSED_ENTRY_SIZE {
            let mut reader = Reader::from_str(&content);
            reader.config_mut().trim_text(true);
            let mut buf = Vec::new();
            while let Ok(ev) = reader.read_event_into(&mut buf) {
                match ev {
                    Event::Start(e) | Event::Empty(e) => {
                        let tag = String::from_utf8_lossy(e.name().as_ref()).to_string();
                        if tag == "Manufacturer" {
                            let mut id = String::new();
                            let mut name = String::new();
                            for attr in e.attributes().flatten() {
                                if attr.key.as_ref() == b"Id" {
                                    id = String::from_utf8_lossy(&attr.value).to_string();
                                } else if attr.key.as_ref() == b"Name" {
                                    name = String::from_utf8_lossy(&attr.value).to_string();
                                }
                            }
                            if !id.is_empty() && !name.is_empty() {
                                ctx.manufacturers.insert(id, name);
                            }
                        }
                    }
                    Event::Eof => break,
                    _ => {}
                }
                buf.clear();
            }
        }
    }

    // 2. Scan Hardware.xml and ApplicationProgram XMLs
    let file_names: Vec<String> = (0..outer_zip.len())
        .filter_map(|i| outer_zip.by_index(i).ok().map(|f| f.name().to_string()))
        .collect();

    for name in &file_names {
        if name.ends_with("Hardware.xml") {
            let mut content = String::new();
            if let Ok(mut f) = outer_zip.by_name(name) {
                if f.by_ref().take(MAX_DECOMPRESSED_ENTRY_SIZE + 1).read_to_string(&mut content).is_ok() && content.len() as u64 <= MAX_DECOMPRESSED_ENTRY_SIZE {
                    let mfr_id = name.split('/').next().unwrap_or("").to_string();
                    let mfr_name = ctx.manufacturers.get(&mfr_id).cloned().unwrap_or_else(|| {
                        crate::knxprod::lookup_knx_manufacturer(&mfr_id)
                    });

                    let mut reader = Reader::from_str(&content);
                    reader.config_mut().trim_text(true);
                    let mut de_trans: HashMap<String, String> = HashMap::new();
                    let mut in_de = false;
                    let mut current_tr_ref = String::new();
                    let mut current_hw_name = String::new();
                    let mut current_bus_current = 10u16;
                    let mut current_h2p_id = String::new();
                    let mut buf = Vec::new();

                    while let Ok(ev) = reader.read_event_into(&mut buf) {
                        match ev {
                            Event::Start(e) | Event::Empty(e) => {
                                let tag = String::from_utf8_lossy(e.name().as_ref()).to_string();
                                match tag.as_str() {
                                    "Hardware" => {
                                        for attr in e.attributes().flatten() {
                                            if attr.key.as_ref() == b"Name" {
                                                current_hw_name = String::from_utf8_lossy(&attr.value).to_string();
                                            } else if attr.key.as_ref() == b"BusCurrent" {
                                                if let Ok(s) = std::str::from_utf8(&attr.value) {
                                                    current_bus_current = s.parse::<u16>().unwrap_or(10);
                                                }
                                            }
                                        }
                                    }
                                    "Hardware2Program" => {
                                        for attr in e.attributes().flatten() {
                                            if attr.key.as_ref() == b"Id" {
                                                current_h2p_id = String::from_utf8_lossy(&attr.value).to_string();
                                            }
                                        }
                                    }
                                    "ApplicationProgramRef" => {
                                        for attr in e.attributes().flatten() {
                                            if attr.key.as_ref() == b"RefId" {
                                                let apr_id = String::from_utf8_lossy(&attr.value).to_string();
                                                if !current_h2p_id.is_empty() {
                                                    ctx.hardware2program.insert(current_h2p_id.clone(), apr_id);
                                                }
                                            }
                                        }
                                    }
                                    "Product" => {
                                        let mut pid = String::new();
                                        let mut order = String::new();
                                        let mut text = String::new();
                                        for attr in e.attributes().flatten() {
                                            if attr.key.as_ref() == b"Id" {
                                                pid = String::from_utf8_lossy(&attr.value).to_string();
                                            } else if attr.key.as_ref() == b"OrderNumber" {
                                                order = String::from_utf8_lossy(&attr.value).to_string();
                                            } else if attr.key.as_ref() == b"Text" {
                                                text = String::from_utf8_lossy(&attr.value).to_string();
                                            }
                                        }
                                        if !pid.is_empty() {
                                            ctx.hardware_products.insert(pid.clone(), RawProductInfo {
                                                id: pid,
                                                order_number: order,
                                                text: text.clone(),
                                                german_text: text,
                                                manufacturer_name: mfr_name.clone(),
                                                hardware_name: current_hw_name.clone(),
                                                bus_current_ma: current_bus_current,
                                            });
                                        }
                                    }
                                    "Language" => {
                                        for attr in e.attributes().flatten() {
                                            if attr.key.as_ref() == b"Identifier" && attr.value.as_ref() == b"de-DE" {
                                                in_de = true;
                                            }
                                        }
                                    }
                                    "TranslationElement" if in_de => {
                                        for attr in e.attributes().flatten() {
                                            if attr.key.as_ref() == b"RefId" {
                                                current_tr_ref = String::from_utf8_lossy(&attr.value).to_string();
                                            }
                                        }
                                    }
                                    "Translation" if in_de && !current_tr_ref.is_empty() => {
                                        let mut attr_name = String::new();
                                        let mut text_val = String::new();
                                        for attr in e.attributes().flatten() {
                                            if attr.key.as_ref() == b"AttributeName" {
                                                attr_name = String::from_utf8_lossy(&attr.value).to_string();
                                            } else if attr.key.as_ref() == b"Text" {
                                                text_val = String::from_utf8_lossy(&attr.value).to_string();
                                            }
                                        }
                                        if attr_name == "Text" && !text_val.is_empty() {
                                            de_trans.insert(current_tr_ref.clone(), text_val);
                                        }
                                    }
                                    _ => {}
                                }
                            }
                            Event::End(e) => {
                                let tag = String::from_utf8_lossy(e.name().as_ref()).to_string();
                                if tag == "Language" {
                                    in_de = false;
                                } else if tag == "TranslationElement" {
                                    current_tr_ref.clear();
                                }
                            }
                            Event::Eof => break,
                            _ => {}
                        }
                        buf.clear();
                    }

                    // Apply German product translations
                    for (ref_id, de_text) in de_trans {
                        if let Some(prod) = ctx.hardware_products.get_mut(&ref_id) {
                            prod.german_text = de_text;
                        }
                    }
                }
            }
        } else if (name.contains("_A-") || name.contains("ApplicationProgram")) && name.ends_with(".xml") {
            let mut content = String::new();
            if let Ok(mut f) = outer_zip.by_name(name) {
                if f.by_ref().take(MAX_DECOMPRESSED_ENTRY_SIZE + 1).read_to_string(&mut content).is_ok() && content.len() as u64 <= MAX_DECOMPRESSED_ENTRY_SIZE {
                    let (mut cos, params, mask_version, app_name, pref_to_param, assign_rules) = parse_app_program_xml(&content);

                    // Also extract de-DE translations for KOs
                    let mut reader = Reader::from_str(&content);
                    reader.config_mut().trim_text(true);
                    let mut in_de = false;
                    let mut current_tr_ref = String::new();
                    let mut de_text_by_ref: HashMap<String, String> = HashMap::new();
                    let mut de_func_by_ref: HashMap<String, String> = HashMap::new();
                    let mut app_id = String::new();
                    let mut buf = Vec::new();

                    while let Ok(ev) = reader.read_event_into(&mut buf) {
                        match ev {
                            Event::Start(e) | Event::Empty(e) => {
                                let tag = String::from_utf8_lossy(e.name().as_ref()).to_string();
                                if tag == "ApplicationProgram" {
                                    for attr in e.attributes().flatten() {
                                        if attr.key.as_ref() == b"Id" {
                                            app_id = String::from_utf8_lossy(&attr.value).to_string();
                                        }
                                    }
                                } else if tag == "Language" {
                                    for attr in e.attributes().flatten() {
                                        if attr.key.as_ref() == b"Identifier" && attr.value.as_ref() == b"de-DE" {
                                            in_de = true;
                                        }
                                    }
                                } else if tag == "TranslationElement" && in_de {
                                    for attr in e.attributes().flatten() {
                                        if attr.key.as_ref() == b"RefId" {
                                            current_tr_ref = String::from_utf8_lossy(&attr.value).to_string();
                                        }
                                    }
                                } else if tag == "Translation" && in_de && !current_tr_ref.is_empty() {
                                    let mut attr_name = String::new();
                                    let mut text_val = String::new();
                                    for attr in e.attributes().flatten() {
                                        if attr.key.as_ref() == b"AttributeName" {
                                            attr_name = String::from_utf8_lossy(&attr.value).to_string();
                                        } else if attr.key.as_ref() == b"Text" {
                                            text_val = String::from_utf8_lossy(&attr.value).to_string();
                                        }
                                    }
                                    if attr_name == "Text" {
                                        de_text_by_ref.insert(current_tr_ref.clone(), text_val);
                                    } else if attr_name == "FunctionText" {
                                        de_func_by_ref.insert(current_tr_ref.clone(), text_val);
                                    }
                                }
                            }
                            Event::End(e) => {
                                let tag = String::from_utf8_lossy(e.name().as_ref()).to_string();
                                if tag == "Language" {
                                    in_de = false;
                                } else if tag == "TranslationElement" {
                                    current_tr_ref.clear();
                                }
                            }
                            Event::Eof => break,
                            _ => {}
                        }
                        buf.clear();
                    }

                    // Apply translations to COs
                    for co in &mut cos {
                        if let Some(txt) = de_text_by_ref.get(&co.id) {
                            co.object_text = txt.clone();
                        }
                        if let Some(f_txt) = de_func_by_ref.get(&co.id) {
                            co.function_text = f_txt.clone();
                        }
                    }

                    let raw_app = RawAppProgramInfo {
                        id: app_id.clone(),
                        name: app_name.unwrap_or_else(|| name.clone()),
                        mask_version: mask_version.unwrap_or_else(|| "07B0h (System B)".to_string()),
                        communication_objects: cos,
                        parameters: params,
                        pref_to_param,
                        assign_rules,
                    };

                    if !app_id.is_empty() {
                        ctx.app_programs.insert(app_id, raw_app.clone());
                    }
                    ctx.app_programs.insert(name.clone(), raw_app);
                }
            }
        }
    }

    ctx
}

fn extract_ko_number(ref_id: &str) -> Option<u32> {
    if let Some(pos) = ref_id.find("O-") {
        let rest = &ref_id[pos + 2..];
        let token = rest.split('_').next()?;
        if let Ok(n) = token.parse::<u32>() {
            return Some(n);
        }
        if let Some(dash_pos) = token.rfind('-') {
            if let Ok(n) = token[dash_pos + 1..].parse::<u32>() {
                return Some(n);
            }
        }
    }
    None
}

fn extract_o_part(ref_id: &str) -> Option<String> {
    if let Some(pos) = ref_id.find("O-") {
        let rest = &ref_id[pos..];
        let token = rest.split('_').next()?;
        return Some(token.to_string());
    }
    None
}

fn attr_unescaped(val: &[u8]) -> String {
    let raw = String::from_utf8_lossy(val);
    quick_xml::escape::unescape(&raw).unwrap_or(std::borrow::Cow::Borrowed(&raw)).to_string()
}

/// Decodes a KNX device serial number from ETS XML (base64Binary or hex string) into standard colon format "00:83:76:8A:0C:65"
pub fn decode_ets_serial_number(s: &str) -> Option<String> {
    use base64::prelude::BASE64_STANDARD;
    use base64::Engine;

    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    // If it's already a 12-char hex string (like "00837B400286") or colon/dash separated
    if let Some(bytes) = crate::knxnet_ip::parse_serial_number(s) {
        return Some(format!(
            "{:02X}:{:02X}:{:02X}:{:02X}:{:02X}:{:02X}",
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]
        ));
    }
    // Otherwise try base64 decode (ETS Schema 23: xs:base64Binary, 6 bytes e.g. "AIN2igxl")
    if let Ok(bytes) = BASE64_STANDARD.decode(s) {
        if bytes.len() == 6 {
            return Some(format!(
                "{:02X}:{:02X}:{:02X}:{:02X}:{:02X}:{:02X}",
                bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]
            ));
        }
    }
    None
}

#[derive(Default)]
struct RawDeviceInstance {
    id: String,
    address: String,
    name: String,
    product_ref_id: String,
    hardware2program_ref_id: String,
    serial_number: Option<String>,
    cos: Vec<RawComObjectInstanceRef>,
    params: Vec<(String, String)>,
    loaded_image: Option<String>,
    checksums: Option<String>,
    puid: Option<u32>,
}

#[derive(Default)]
struct RawComObjectInstanceRef {
    ref_id: String,
    text: String,
    function_text: String,
    dpt: String,
    links: String,
    communication_flag: Option<bool>,
    read_flag: Option<bool>,
    write_flag: Option<bool>,
    transmit_flag: Option<bool>,
    update_flag: Option<bool>,
}

/// Bundles all non-project files (M-*, *.signature, knx_master.xml) into an asset zip
pub fn extract_project_assets<R: std::io::Read + std::io::Seek>(outer_zip: &mut zip::ZipArchive<R>) -> Vec<u8> {
    use std::io::Write;
    let mut buf = Vec::new();
    {
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for i in 0..outer_zip.len() {
            if let Ok(mut f) = outer_zip.by_index(i) {
                let name = f.name().to_string();
                if name == "knx_master.xml" || name.ends_with(".signature") || name.starts_with("M-") {
                    let mut content = Vec::new();
                    if std::io::copy(&mut f, &mut content).is_ok()
                        && writer.start_file(&name, options).is_ok()
                    {
                        let _ = writer.write_all(&content);
                    }
                }
            }
        }
        let _ = writer.finish();
    }
    buf
}

#[derive(Debug, Default)]
pub struct RawProjectInfo {
    pub id: Option<String>,
    pub name: Option<String>,
    pub guid: Option<String>,
    pub last_used_puid: Option<u32>,
    pub traces: Vec<ProjectTraceInfo>,
    pub certificates: Vec<DeviceCertificateInfo>,
}

pub fn parse_ets_project_info_xml(xml: &str) -> RawProjectInfo {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut info = RawProjectInfo::default();
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                let tag = String::from_utf8_lossy(e.name().as_ref()).to_string();
                if tag == "Project" {
                    for attr in e.attributes().flatten() {
                        if attr.key.as_ref() == b"Id" {
                            info.id = Some(String::from_utf8_lossy(&attr.value).to_string());
                        }
                    }
                } else if tag == "ProjectInformation" {
                    for attr in e.attributes().flatten() {
                        match attr.key.as_ref() {
                            b"Name" => info.name = Some(String::from_utf8_lossy(&attr.value).to_string()),
                            b"Guid" => info.guid = Some(String::from_utf8_lossy(&attr.value).to_string()),
                            b"LastUsedPuid" => {
                                if let Ok(val) = String::from_utf8_lossy(&attr.value).parse::<u32>() {
                                    info.last_used_puid = Some(val);
                                }
                            }
                            _ => {}
                        }
                    }
                } else if tag == "ProjectTrace" {
                    let mut date = String::new();
                    let mut user_name = String::new();
                    let mut comment = String::new();
                    for attr in e.attributes().flatten() {
                        match attr.key.as_ref() {
                            b"Date" => date = String::from_utf8_lossy(&attr.value).to_string(),
                            b"UserName" => user_name = String::from_utf8_lossy(&attr.value).to_string(),
                            b"Comment" => comment = String::from_utf8_lossy(&attr.value).to_string(),
                            _ => {}
                        }
                    }
                    info.traces.push(ProjectTraceInfo { date, user_name, comment });
                } else if tag == "DeviceCertificate" {
                    let mut serial_number = String::new();
                    let mut fdsk = String::new();
                    for attr in e.attributes().flatten() {
                        match attr.key.as_ref() {
                            b"SerialNumber" => serial_number = String::from_utf8_lossy(&attr.value).to_string(),
                            b"FDSK" => fdsk = String::from_utf8_lossy(&attr.value).to_string(),
                            _ => {}
                        }
                    }
                    if !serial_number.is_empty() && !fdsk.is_empty() {
                        info.certificates.push(DeviceCertificateInfo { serial_number, fdsk });
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    info
}

/// Imports .knxproj archive, extracting project.xml and 0.xml
pub fn parse_knxproj(file_bytes: &[u8], password: Option<&str>, default_name: &str) -> Result<Project, String> {
    use std::io::Cursor;
    let reader = Cursor::new(file_bytes);
    let mut outer_zip = zip::ZipArchive::new(reader)
        .map_err(|e| format!("Ungültiges .knxproj ZIP-Archiv: {}", e))?;

    // Extract catalog metadata and asset bundle from outer zip (Hardware.xml, knx_master.xml, ApplicationPrograms, signatures)
    let catalog_ctx = extract_catalog_context(&mut outer_zip);
    let assets_bytes = extract_project_assets(&mut outer_zip);

    // Look for P-XXXX.zip
    let mut p_zip_name = None;
    for i in 0..outer_zip.len() {
        if let Ok(f) = outer_zip.by_index(i) {
            let name = f.name().to_string();
            if name.starts_with("P-") && name.ends_with(".zip") {
                p_zip_name = Some(name);
                break;
            }
        }
    }

    let p_zip_name = p_zip_name.ok_or_else(|| "Keine Projektdatei (P-*.zip) im .knxproj Archiv gefunden.".to_string())?;

    let mut p_zip_bytes = Vec::new();
    {
        let mut p_file = outer_zip
            .by_name(&p_zip_name)
            .map_err(|e| format!("Fehler beim Lesen von {}: {}", p_zip_name, e))?;
        std::io::copy(&mut p_file, &mut p_zip_bytes)
            .map_err(|e| format!("Fehler beim Extrahieren von {}: {}", p_zip_name, e))?;
    }

    let mut xml_0_content = Vec::new();
    let mut xml_project_content = Vec::new();
    let mut decrypt_success = false;

    // 1. Try in-memory zip decryption with zip crate
    let p_reader = Cursor::new(&p_zip_bytes);
    if let Ok(mut inner_zip) = zip::ZipArchive::new(p_reader) {
        let passwords: Vec<Option<String>> = if let Some(pwd) = password {
            if !pwd.trim().is_empty() {
                vec![Some(derive_ets6_key(pwd)), Some(pwd.to_string()), None]
            } else {
                vec![None]
            }
        } else {
            vec![None]
        };

        for p_opt in passwords {
            let res_0 = match &p_opt {
                Some(p) => inner_zip.by_name_decrypt("0.xml", p.as_bytes()).map(|mut f| std::io::copy(&mut f, &mut xml_0_content)),
                None => inner_zip.by_name("0.xml").map(|mut f| std::io::copy(&mut f, &mut xml_0_content)),
            };
            if res_0.is_ok() && !xml_0_content.is_empty() {
                decrypt_success = true;
                let _ = match &p_opt {
                    Some(p) => inner_zip.by_name_decrypt("project.xml", p.as_bytes()).map(|mut f| std::io::copy(&mut f, &mut xml_project_content)),
                    None => inner_zip.by_name("project.xml").map(|mut f| std::io::copy(&mut f, &mut xml_project_content)),
                };
                break;
            }
        }
    }

    // 2. Fallback using system 7z if in-memory decrypt encountered an unsupported AES format
    if !decrypt_success {
        let temp_dir = std::env::temp_dir();
        let temp_file = temp_dir.join(format!("knx_import_{}.zip", Uuid::new_v4()));
        if std::fs::write(&temp_file, &p_zip_bytes).is_ok() {
            let mut passwords_to_try = Vec::new();
            if let Some(pwd) = password {
                if !pwd.trim().is_empty() {
                    passwords_to_try.push(derive_ets6_key(pwd));
                    passwords_to_try.push(pwd.to_string());
                }
            }
            passwords_to_try.push(String::new());

            for p in &passwords_to_try {
                let mut cmd = std::process::Command::new("7z");
                cmd.arg("e").arg("-so");
                if !p.is_empty() {
                    cmd.arg(format!("-p{}", p));
                }
                cmd.arg(&temp_file).arg("0.xml");
                if let Ok(output) = cmd.output() {
                    if output.status.success() && !output.stdout.is_empty() {
                        xml_0_content = output.stdout;
                        decrypt_success = true;

                        // Also extract project.xml
                        let mut cmd_p = std::process::Command::new("7z");
                        cmd_p.arg("e").arg("-so");
                        if !p.is_empty() {
                            cmd_p.arg(format!("-p{}", p));
                        }
                        cmd_p.arg(&temp_file).arg("project.xml");
                        if let Ok(out_p) = cmd_p.output() {
                            if out_p.status.success() {
                                xml_project_content = out_p.stdout;
                            }
                        }
                        break;
                    }
                }
            }
            let _ = std::fs::remove_file(temp_file);
        }
    }

    if !decrypt_success || xml_0_content.is_empty() {
        return Err("Entpacken von 0.xml fehlgeschlagen. Bitte Projektpasswort prüfen.".to_string());
    }

    let xml_str = String::from_utf8(xml_0_content)
        .map_err(|_| "0.xml ist keine gültige UTF-8 Datei".to_string())?;

    let res = parse_ets_project_xml(&xml_str, default_name, Some(&catalog_ctx));

    // Automatically cache extracted catalog products to ~/.konfix/catalog
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let catalog_dir = std::path::Path::new(&home).join(".konfix").join("catalog");
    if std::fs::create_dir_all(&catalog_dir).is_ok() {
        for (prod_id, prod) in &catalog_ctx.hardware_products {
            let app_ref = catalog_ctx.hardware2program.get(prod_id);
            let app = app_ref.and_then(|r| catalog_ctx.app_programs.get(r));
            let cat_prod = CatalogProduct {
                id: prod_id.clone(),
                order_number: prod.order_number.clone(),
                manufacturer: prod.manufacturer_name.clone(),
                name: if !prod.german_text.is_empty() {
                    prod.german_text.clone()
                } else if !prod.text.is_empty() {
                    prod.text.clone()
                } else {
                    prod.hardware_name.clone()
                },
                hardware_name: prod.hardware_name.clone(),
                application_program: app.map(|a| a.name.clone()).unwrap_or_default(),
                mask_version: app.map(|a| a.mask_version.clone()).unwrap_or_else(|| "07B0h (System B)".to_string()),
                bus_current_ma: prod.bus_current_ma,
                default_channels: vec![],
                communication_objects: app.map(|a| a.communication_objects.clone()).unwrap_or_default(),
                parameters: app.map(|a| a.parameters.clone()).unwrap_or_default(),
                assign_rules: app.map(|a| a.assign_rules.clone()).unwrap_or_default(),
            };

            let filename = format!("{}.json", prod_id.replace(['/', ':'], "_"));
            if let Ok(json) = serde_json::to_string_pretty(&cat_prod) {
                let _ = std::fs::write(catalog_dir.join(filename), json);
            }
        }
    }

    if let Ok(mut project) = res {
        let extracted_project_id = p_zip_name.strip_suffix(".zip").unwrap_or("P-0425").to_string();
        project.ets_project_id = Some(extracted_project_id);

        if !xml_project_content.is_empty() {
            let p_info = parse_ets_project_info_xml(&String::from_utf8_lossy(&xml_project_content));
            if let Some(id) = p_info.id {
                project.ets_project_id = Some(id);
            }
            if let Some(name) = p_info.name {
                if !name.trim().is_empty() {
                    project.name = name;
                }
            }
            if let Some(guid) = p_info.guid {
                project.ets_guid = Some(guid);
            }
            if let Some(puid) = p_info.last_used_puid {
                project.ets_last_used_puid = Some(puid);
            }
            if !p_info.traces.is_empty() {
                project.ets_traces = p_info.traces;
            }
            if !p_info.certificates.is_empty() {
                project.ets_device_certificates = p_info.certificates;
            }
        }

        // Persist assets to storage
        let storage = crate::storage::StorageManager::new();
        let _ = storage.save_project_assets_sync(&project.name, &assets_bytes);
        if project.name != default_name {
            let _ = storage.save_project_assets_sync(default_name, &assets_bytes);
        }

        Ok(project)
    } else {
        res
    }
}

/// Enriches an existing Project with parameter offsets, bit offsets, sizes, and LoadedImage from a .knxproj archive
pub fn enrich_project_from_knxproj(
    project: &mut Project,
    file_bytes: &[u8],
    password: Option<&str>,
) -> Result<usize, String> {
    use std::io::Cursor;
    let reader = Cursor::new(file_bytes);
    let mut outer_zip = zip::ZipArchive::new(reader)
        .map_err(|e| format!("Ungültiges .knxproj Archiv: {}", e))?;

    let catalog_ctx = extract_catalog_context(&mut outer_zip);

    // Try extracting 0.xml to get device images and serial numbers
    let mut dev_images: HashMap<String, (String, Option<String>)> = HashMap::new(); // IA -> (LoadedImage, CheckSums)
    let mut dev_images_by_name: HashMap<String, (String, Option<String>)> = HashMap::new();
    let mut dev_serials: HashMap<String, String> = HashMap::new(); // IA -> Serial
    let mut dev_serials_by_name: HashMap<String, String> = HashMap::new();

    // Look for P-XXXX.zip
    let mut p_zip_name = None;
    for i in 0..outer_zip.len() {
        if let Ok(f) = outer_zip.by_index(i) {
            let name = f.name().to_string();
            if name.starts_with("P-") && name.ends_with(".zip") {
                p_zip_name = Some(name);
                break;
            }
        }
    }

    if let Some(p_name) = p_zip_name {
        let mut p_zip_bytes = Vec::new();
        if let Ok(mut p_file) = outer_zip.by_name(&p_name) {
            let _ = std::io::copy(&mut p_file, &mut p_zip_bytes);
        }

        let mut xml_content = Vec::new();
        let mut decrypt_success = false;

        let p_reader = Cursor::new(&p_zip_bytes);
        if let Ok(mut inner_zip) = zip::ZipArchive::new(p_reader) {
            if password.is_none() {
                if let Ok(mut f) = inner_zip.by_name("0.xml") {
                    if std::io::copy(&mut f, &mut xml_content).is_ok() && !xml_content.is_empty() {
                        decrypt_success = true;
                    }
                }
            } else if let Some(pwd) = password {
                let derived = derive_ets6_key(pwd);
                if let Ok(mut f) = inner_zip.by_name_decrypt("0.xml", derived.as_bytes()) {
                    if std::io::copy(&mut f, &mut xml_content).is_ok() && !xml_content.is_empty() {
                        decrypt_success = true;
                    }
                }
                if !decrypt_success {
                    if let Ok(mut f) = inner_zip.by_name_decrypt("0.xml", pwd.as_bytes()) {
                        if std::io::copy(&mut f, &mut xml_content).is_ok() && !xml_content.is_empty() {
                            decrypt_success = true;
                        }
                    }
                }
            }
        }

        if !decrypt_success {
            let temp_dir = std::env::temp_dir();
            let temp_file = temp_dir.join(format!("knx_enrich_{}.zip", Uuid::new_v4()));
            if std::fs::write(&temp_file, &p_zip_bytes).is_ok() {
                let pw_candidates = match password {
                    Some(pwd) => vec![derive_ets6_key(pwd), pwd.to_string()],
                    None => vec!["".to_string()],
                };
                for pw in pw_candidates {
                    let mut cmd = std::process::Command::new("7z");
                    cmd.arg("e")
                        .arg("-so")
                        .arg(format!("-p{}", pw))
                        .arg(&temp_file)
                        .arg("0.xml");
                    if let Ok(output) = cmd.output() {
                        if output.status.success() && !output.stdout.is_empty() {
                            xml_content = output.stdout;
                            break;
                        }
                    }
                }
                let _ = std::fs::remove_file(&temp_file);
            }
        }

        if let Ok(xml_str) = String::from_utf8(xml_content) {
            use quick_xml::events::Event;
            use quick_xml::reader::Reader;
            let mut r = Reader::from_str(&xml_str);
            r.config_mut().trim_text(true);
            let mut cur_area = String::new();
            let mut cur_line = String::new();
            let mut buf = Vec::new();
            while let Ok(ev) = r.read_event_into(&mut buf) {
                match ev {
                    Event::Start(e) | Event::Empty(e) => {
                        let tag = String::from_utf8_lossy(e.name().as_ref()).to_string();
                        if tag == "Area" {
                            for a in e.attributes().flatten() {
                                if a.key.as_ref() == b"Address" {
                                    cur_area = String::from_utf8_lossy(&a.value).to_string();
                                }
                            }
                        } else if tag == "Line" {
                            for a in e.attributes().flatten() {
                                if a.key.as_ref() == b"Address" {
                                    cur_line = String::from_utf8_lossy(&a.value).to_string();
                                }
                            }
                        } else if tag == "DeviceInstance" {
                            let mut addr = String::new();
                            let mut name = String::new();
                            let mut img = None;
                            let mut chk = None;
                            let mut serial = None;
                            for a in e.attributes().flatten() {
                                match a.key.as_ref() {
                                    b"Address" => addr = String::from_utf8_lossy(&a.value).to_string(),
                                    b"Name" => name = String::from_utf8_lossy(&a.value).to_string(),
                                    b"LoadedImage" => img = Some(String::from_utf8_lossy(&a.value).to_string()),
                                    b"CheckSums" => chk = Some(String::from_utf8_lossy(&a.value).to_string()),
                                    b"SerialNumber" => serial = decode_ets_serial_number(&String::from_utf8_lossy(&a.value)),
                                    _ => {}
                                }
                            }
                            if let Some(i) = img {
                                if !addr.is_empty() {
                                    let full_ia = format!("{}.{}.{}", cur_area, cur_line, addr);
                                    dev_images.insert(full_ia, (i.clone(), chk.clone()));
                                }
                                if !name.is_empty() {
                                    dev_images_by_name.insert(name.clone(), (i, chk));
                                }
                            }
                            if let Some(sn) = serial {
                                if !addr.is_empty() {
                                    let full_ia = format!("{}.{}.{}", cur_area, cur_line, addr);
                                    dev_serials.insert(full_ia, sn.clone());
                                }
                                if !name.is_empty() {
                                    dev_serials_by_name.insert(name, sn);
                                }
                            }
                        }
                    }
                    Event::Eof => break,
                    _ => {}
                }
                buf.clear();
            }
        }
    }

    // Now enrich devices in project
    let mut enriched_count = 0;
    for dev in &mut project.devices {
        // 1. Populate LoadedImage if missing
        if dev.loaded_image.is_none() {
            if let Some((img, chk)) = dev_images.get(&dev.individual_address).or_else(|| dev_images_by_name.get(&dev.name)) {
                dev.loaded_image = Some(img.clone());
                if dev.checksums.is_none() {
                    dev.checksums = chk.clone();
                }
            }
        }

        // 1b. Populate SerialNumber if missing
        if dev.get_serial_number().is_none() {
            if let Some(sn) = dev_serials.get(&dev.individual_address).or_else(|| dev_serials_by_name.get(&dev.name)) {
                if let Some(ref mut sec) = dev.security {
                    sec.serial_number = Some(sn.clone());
                } else {
                    dev.security = Some(crate::model::KnxDataSecureConfig {
                        is_secure_enabled: false,
                        serial_number: Some(sn.clone()),
                        fdsk: None,
                        tool_key: None,
                        sequence_number: 0,
                    });
                }
                enriched_count += 1;
            }
        }

        // 2. Find matching application program parameters and assign rules
        let app_match: Option<&RawAppProgramInfo> = {
            let mut found = None;
            for (app_id, raw_app) in &catalog_ctx.app_programs {
                if let Some(ref dev_app) = dev.application_program {
                    if app_id == dev_app
                        || dev_app.contains(app_id)
                        || app_id.contains(dev_app)
                        || &raw_app.name == dev_app
                        || dev_app.contains(&raw_app.name)
                        || raw_app.name.contains(dev_app)
                    {
                        found = Some(raw_app);
                        break;
                    }
                }
                if found.is_none() && !dev.parameters.is_empty() {
                    let first_pid = &dev.parameters[0].id;
                    if first_pid.starts_with(app_id) || raw_app.parameters.iter().any(|p| &p.id == first_pid) {
                        found = Some(raw_app);
                        break;
                    }
                }
            }
            found
        };

        if let Some(raw_app) = app_match {
            if dev.assign_rules.is_empty() && !raw_app.assign_rules.is_empty() {
                dev.assign_rules = raw_app.assign_rules.clone();
                enriched_count += 1;
            }
            let cat_params = &raw_app.parameters;
            let param_by_id: HashMap<&str, &DeviceParameter> = cat_params.iter().map(|p| (p.id.as_str(), p)).collect();
            let param_by_name: HashMap<&str, &DeviceParameter> = cat_params.iter().map(|p| (p.name.as_str(), p)).collect();

            for p in &mut dev.parameters {
                if p.offset.is_none() {
                    let matched = param_by_id.get(p.id.as_str()).or_else(|| param_by_name.get(p.name.as_str()));
                    if let Some(cat_p) = matched {
                        if cat_p.offset.is_some() {
                            p.offset = cat_p.offset;
                            p.bit_offset = cat_p.bit_offset;
                            p.size_in_bit = cat_p.size_in_bit;
                            if p.min.is_none() { p.min = cat_p.min; }
                            if p.max.is_none() { p.max = cat_p.max; }
                            if p.step.is_none() { p.step = cat_p.step; }
                            if p.is_float.is_none() { p.is_float = cat_p.is_float; }
                            enriched_count += 1;
                        }
                    }
                }
            }
        }
    }

    Ok(enriched_count)
}

/// Parses ETS 0.xml content with catalog context
pub fn parse_ets_project_xml(
    xml: &str,
    project_name: &str,
    catalog: Option<&KnxprojCatalogContext>,
) -> Result<Project, String> {
    use quick_xml::events::Event;
    use quick_xml::reader::Reader;

    struct PendingKoLink {
        dev_id: Uuid,
        ko_number: u32,
        ko_id: String,
        links: String,
    }

    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let building_id = Uuid::new_v4();
    let mut buildings = Vec::new();
    let mut floors = Vec::new();
    let mut rooms = Vec::new();
    let mut group_addresses = Vec::new();
    let mut devices = Vec::new();

    let mut current_building_id = building_id;
    let mut current_floor_id = Uuid::new_v4();
    let mut current_room_id: Option<Uuid> = None;
    let mut device_ref_to_room: HashMap<String, Uuid> = HashMap::new();

    let mut current_main_name = "Zentral".to_string();
    let mut current_mid_name = "Zentral".to_string();
    let mut ga_by_id: HashMap<String, (Uuid, String)> = HashMap::new();
    let mut dev_xml_ids: HashMap<Uuid, String> = HashMap::new();
    let mut pending_ko_links: Vec<PendingKoLink> = Vec::new();

    let mut current_area_addr = "1".to_string();
    let mut current_line_addr = "1".to_string();
    let mut current_device: Option<RawDeviceInstance> = None;

    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                let tag_name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                match tag_name.as_str() {
                    "Space" => {
                        let mut space_type = String::new();
                        let mut space_name = String::new();
                        for attr in e.attributes().flatten() {
                            match attr.key.as_ref() {
                                b"Type" => space_type = String::from_utf8_lossy(&attr.value).to_string(),
                                b"Name" => space_name = attr_unescaped(&attr.value),
                                _ => {}
                            }
                        }

                        if space_type == "Building" || space_type == "BuildingPart" {
                            let b_id = Uuid::new_v4();
                            current_building_id = b_id;
                            buildings.push(Building {
                                id: b_id,
                                name: if space_name.is_empty() { "Gebäude".to_string() } else { space_name },
                            });
                        } else if space_type == "Floor" {
                            let f_id = Uuid::new_v4();
                            current_floor_id = f_id;
                            let level = if space_name.contains("OG") || space_name.contains("Ober") {
                                1
                            } else if space_name.contains("KG") || space_name.contains("Keller") || space_name.contains("UG") {
                                -1
                            } else {
                                0
                            };
                            floors.push(Floor {
                                id: f_id,
                                building_id: current_building_id,
                                name: if space_name.is_empty() { "Erdgeschoss".to_string() } else { space_name },
                                level,
                            });
                        } else if space_type == "Room" && !space_name.is_empty() {
                            let r_id = Uuid::new_v4();
                            current_room_id = Some(r_id);
                            rooms.push(Room {
                                id: r_id,
                                floor_id: current_floor_id,
                                name: space_name.clone(),
                                icon: get_room_icon(&space_name).to_string(),
                            });
                        }
                    }
                    "DeviceInstanceRef" => {
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"RefId" {
                                let ref_id = String::from_utf8_lossy(&attr.value).to_string();
                                if let Some(r_id) = current_room_id {
                                    device_ref_to_room.insert(ref_id, r_id);
                                }
                            }
                        }
                    }
                    "GroupRange" => {
                        let mut range_start = 0u16;
                        let mut range_end = 0u16;
                        let mut gr_name = String::new();
                        for attr in e.attributes().flatten() {
                            match attr.key.as_ref() {
                                b"RangeStart" => {
                                    if let Ok(s) = std::str::from_utf8(&attr.value) {
                                        range_start = s.parse::<u16>().unwrap_or(0);
                                    }
                                }
                                b"RangeEnd" => {
                                    if let Ok(s) = std::str::from_utf8(&attr.value) {
                                        range_end = s.parse::<u16>().unwrap_or(0);
                                    }
                                }
                                b"Name" => gr_name = attr_unescaped(&attr.value),
                                _ => {}
                            }
                        }
                        if (range_end - range_start) > 256 || (range_start.is_multiple_of(2048) && range_end > range_start + 256) {
                            if !gr_name.is_empty() {
                                current_main_name = gr_name;
                            }
                        } else if !gr_name.is_empty() {
                            current_mid_name = gr_name;
                        }
                    }
                    "GroupAddress" => {
                        let mut ga_addr = 0u16;
                        let mut ga_id = String::new();
                        let mut ga_name = String::new();
                        let mut ga_desc = String::new();
                        let mut dpt_str = String::new();
                        let mut ga_puid: Option<u32> = None;

                        for attr in e.attributes().flatten() {
                            match attr.key.as_ref() {
                                b"Id" => ga_id = String::from_utf8_lossy(&attr.value).to_string(),
                                b"Address" => {
                                    if let Ok(s) = std::str::from_utf8(&attr.value) {
                                        ga_addr = s.parse::<u16>().unwrap_or(0);
                                    }
                                }
                                b"Name" => ga_name = attr_unescaped(&attr.value),
                                b"Description" => ga_desc = attr_unescaped(&attr.value),
                                b"DatapointType" | b"DPTs" => dpt_str = String::from_utf8_lossy(&attr.value).to_string(),
                                b"Puid" => ga_puid = String::from_utf8_lossy(&attr.value).parse::<u32>().ok(),
                                _ => {}
                            }
                        }

                        if ga_addr > 0 {
                            let main = ((ga_addr >> 11) & 0x1F) as u8;
                            let mid = ((ga_addr >> 8) & 0x07) as u8;
                            let sub = (ga_addr & 0xFF) as u8;
                            let addr_str = format!("{}/{}/{}", main, mid, sub);

                            let effective_dpt = if dpt_str.is_empty() || dpt_str == "None" {
                                infer_dpt_from_name(&ga_name).to_string()
                            } else {
                                format_knxprod_dpt(&dpt_str)
                            };

                            let uuid = Uuid::new_v4();
                            ga_by_id.insert(ga_id.clone(), (uuid, addr_str.clone()));
                            if let Some(pos) = ga_id.rfind('_') {
                                ga_by_id.insert(ga_id[pos + 1..].to_string(), (uuid, addr_str.clone()));
                            }

                            group_addresses.push(GroupAddress {
                                id: uuid,
                                address: addr_str,
                                main,
                                middle: mid,
                                sub,
                                name: ga_name,
                                dpt: effective_dpt,
                                description: if !ga_desc.is_empty() { ga_desc } else { format!("{} / {}", current_main_name, current_mid_name) },
                                origin_block_id: None,
                                origin_pin_name: None,
                                is_custom: true,
                                ets_ga_id: if ga_id.is_empty() { None } else { Some(ga_id.clone()) },
                                ets_puid: ga_puid,
                            });
                        }
                    }
                    "Area" => {
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"Address" {
                                current_area_addr = String::from_utf8_lossy(&attr.value).to_string();
                            }
                        }
                    }
                    "Line" => {
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"Address" {
                                current_line_addr = String::from_utf8_lossy(&attr.value).to_string();
                            }
                        }
                    }
                    "DeviceInstance" => {
                        let mut raw_dev = RawDeviceInstance::default();
                        for attr in e.attributes().flatten() {
                            match attr.key.as_ref() {
                                b"Id" => raw_dev.id = String::from_utf8_lossy(&attr.value).to_string(),
                                b"Address" => raw_dev.address = String::from_utf8_lossy(&attr.value).to_string(),
                                b"Name" => raw_dev.name = attr_unescaped(&attr.value),
                                b"ProductRefId" => raw_dev.product_ref_id = String::from_utf8_lossy(&attr.value).to_string(),
                                b"Hardware2ProgramRefId" => raw_dev.hardware2program_ref_id = String::from_utf8_lossy(&attr.value).to_string(),
                                b"LoadedImage" => raw_dev.loaded_image = Some(String::from_utf8_lossy(&attr.value).to_string()),
                                b"CheckSums" => raw_dev.checksums = Some(String::from_utf8_lossy(&attr.value).to_string()),
                                b"SerialNumber" => raw_dev.serial_number = decode_ets_serial_number(&String::from_utf8_lossy(&attr.value)),
                                b"Puid" => raw_dev.puid = String::from_utf8_lossy(&attr.value).parse::<u32>().ok(),
                                _ => {}
                            }
                        }
                        current_device = Some(raw_dev);
                    }
                    "ComObjectInstanceRef" => {
                        if let Some(dev) = current_device.as_mut() {
                            let mut raw_co = RawComObjectInstanceRef::default();
                            for attr in e.attributes().flatten() {
                                match attr.key.as_ref() {
                                    b"RefId" => raw_co.ref_id = String::from_utf8_lossy(&attr.value).to_string(),
                                    b"Text" => raw_co.text = attr_unescaped(&attr.value),
                                    b"FunctionText" => raw_co.function_text = attr_unescaped(&attr.value),
                                    b"DatapointType" => raw_co.dpt = String::from_utf8_lossy(&attr.value).to_string(),
                                    b"Links" => raw_co.links = String::from_utf8_lossy(&attr.value).to_string(),
                                    b"CommunicationFlag" => raw_co.communication_flag = Some(attr.value.as_ref() == b"Enabled"),
                                    b"ReadFlag" => raw_co.read_flag = Some(attr.value.as_ref() == b"Enabled"),
                                    b"WriteFlag" => raw_co.write_flag = Some(attr.value.as_ref() == b"Enabled"),
                                    b"TransmitFlag" => raw_co.transmit_flag = Some(attr.value.as_ref() == b"Enabled"),
                                    b"UpdateFlag" => raw_co.update_flag = Some(attr.value.as_ref() == b"Enabled"),
                                    _ => {}
                                }
                            }
                            dev.cos.push(raw_co);
                        }
                    }
                    "ParameterInstanceRef" => {
                        if let Some(dev) = current_device.as_mut() {
                            let mut pref_id = String::new();
                            let mut pval = String::new();
                            for attr in e.attributes().flatten() {
                                match attr.key.as_ref() {
                                    b"RefId" => pref_id = String::from_utf8_lossy(&attr.value).to_string(),
                                    b"Value" => pval = attr_unescaped(&attr.value),
                                    _ => {}
                                }
                            }
                            if !pref_id.is_empty() {
                                dev.params.push((pref_id, pval));
                            }
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::End(e)) => {
                let tag_name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                if tag_name == "Space" {
                    if current_room_id.is_some() {
                        current_room_id = None;
                    }
                } else if tag_name == "DeviceInstance" {
                    if let Some(dev) = current_device.take() {
                        let ia = format!("{}.{}.{}", current_area_addr, current_line_addr, dev.address);
                        let dev_id = Uuid::new_v4();
                        dev_xml_ids.insert(dev_id, dev.id.clone());
                        let room_id = device_ref_to_room.get(&dev.id).copied();

                        // Find product & app program in catalog context
                        let prod_info = catalog.and_then(|c| c.hardware_products.get(&dev.product_ref_id));
                        let app_ref = catalog.and_then(|c| c.hardware2program.get(&dev.hardware2program_ref_id));
                        let app_info = app_ref.and_then(|r| catalog.and_then(|c| c.app_programs.get(r)));

                        let dev_name = if !dev.name.is_empty() {
                            dev.name.clone()
                        } else if let Some(p) = prod_info {
                            if !p.german_text.is_empty() {
                                p.german_text.clone()
                            } else if !p.text.is_empty() {
                                p.text.clone()
                            } else {
                                p.hardware_name.clone()
                            }
                        } else {
                            format!("KNX Gerät {}", ia)
                        };

                        let model = prod_info.map(|p| p.order_number.clone()).unwrap_or_default();
                        let manufacturer = prod_info.map(|p| p.manufacturer_name.clone()).unwrap_or_else(|| {
                            let mfr_id = dev.product_ref_id.split('_').next().unwrap_or("");
                            if !mfr_id.is_empty() {
                                catalog.and_then(|c| c.manufacturers.get(mfr_id)).cloned().unwrap_or_else(|| {
                                    crate::knxprod::lookup_knx_manufacturer(mfr_id)
                                })
                            } else {
                                "Unbekannter Hersteller".to_string()
                            }
                        });
                        let mask_version = app_info.map(|a| a.mask_version.clone());
                        let app_program_name = app_info.map(|a| a.name.clone());
                        let bus_current = prod_info.map(|p| p.bus_current_ma);

                        // Communication objects
                        let mut cos = app_info.map(|a| a.communication_objects.clone()).unwrap_or_default();

                        for raw_co in &dev.cos {
                            let mut matched_idx = cos.iter().position(|c| c.id == raw_co.ref_id);

                            if matched_idx.is_none() {
                                matched_idx = cos.iter().position(|c| {
                                    (c.id.len() < raw_co.ref_id.len() && raw_co.ref_id.ends_with(&format!("_{}", c.id)))
                                        || (raw_co.ref_id.len() < c.id.len() && c.id.ends_with(&format!("_{}", raw_co.ref_id)))
                                });
                            }

                            if matched_idx.is_none() {
                                if let Some(o_part) = extract_o_part(&raw_co.ref_id) {
                                    matched_idx = cos.iter().position(|c| c.id == o_part || c.id.ends_with(&format!("_{}", o_part)));
                                }
                            }

                            let num = extract_ko_number(&raw_co.ref_id);
                            if matched_idx.is_none() {
                                if let Some(n) = num {
                                    matched_idx = cos.iter().position(|c| c.number == n);
                                }
                            }

                            let co = if let Some(idx) = matched_idx {
                                &mut cos[idx]
                            } else {
                                let new_co = CommunicationObject {
                                    id: raw_co.ref_id.clone(),
                                    number: num.unwrap_or(0),
                                    name: raw_co.ref_id.clone(),
                                    object_text: raw_co.text.clone(),
                                    function_text: raw_co.function_text.clone(),
                                    dpt: if !raw_co.dpt.is_empty() { format_knxprod_dpt(&raw_co.dpt) } else { String::new() },
                                    object_size: String::new(),
                                    flags: ComObjectFlags::default(),
                                    group_address_ids: vec![],
                                    group_addresses: vec![],
                                };
                                cos.push(new_co);
                                cos.last_mut().unwrap()
                            };

                            if !raw_co.text.is_empty() {
                                co.object_text = raw_co.text.clone();
                            }
                            if !raw_co.function_text.is_empty() {
                                co.function_text = raw_co.function_text.clone();
                            }
                            if !raw_co.dpt.is_empty() {
                                co.dpt = format_knxprod_dpt(&raw_co.dpt);
                            }
                            if let Some(cf) = raw_co.communication_flag { co.flags.communication = cf; }
                            if let Some(rf) = raw_co.read_flag { co.flags.read = rf; }
                            if let Some(wf) = raw_co.write_flag { co.flags.write = wf; }
                            if let Some(tf) = raw_co.transmit_flag { co.flags.transmit = tf; }
                            if let Some(uf) = raw_co.update_flag { co.flags.update = uf; }

                            if !raw_co.links.is_empty() {
                                pending_ko_links.push(PendingKoLink {
                                    dev_id,
                                    ko_number: co.number,
                                    ko_id: co.id.clone(),
                                    links: raw_co.links.clone(),
                                });
                            }
                        }

                        cos.sort_by_key(|c| c.number);

                        // Parameters
                        let mut params = app_info.map(|a| a.parameters.clone()).unwrap_or_default();
                        for (pref_id, pval) in &dev.params {
                            let base_id = if let Some(pos) = pref_id.rfind("_R-") {
                                &pref_id[..pos]
                            } else {
                                pref_id.as_str()
                            };

                            let resolved_target_id = app_info
                                .and_then(|a| a.pref_to_param.get(pref_id))
                                .map(|s| s.as_str());

                            if let Some(p) = params.iter_mut().find(|p| {
                                if let Some(rid) = resolved_target_id {
                                    if p.id == rid {
                                        return true;
                                    }
                                }
                                if p.id == base_id {
                                    return true;
                                }
                                (p.id.len() < base_id.len() && base_id.ends_with(&format!("_{}", p.id)))
                                    || (base_id.len() < p.id.len() && p.id.ends_with(&format!("_{}", base_id)))
                            }) {
                                p.value = pval.clone();
                            }
                        }

                        // Channels
                        let mut channels = infer_channels_from_product(&model, &dev_name, &cos);
                        for (_pref_id, pval) in &dev.params {
                            if pval.starts_with("HK") || pval.contains("Rolladen") || pval.contains("Jalousie") || pval.contains("Licht") {
                                if pval.starts_with("HK") && pval.len() > 3 {
                                    if let Ok(ch_num) = pval[2..3].parse::<usize>() {
                                        if ch_num > 0 && ch_num <= channels.len() {
                                            channels[ch_num - 1].name = pval.clone();
                                        }
                                    }
                                } else if !channels.is_empty() {
                                    channels[0].name = pval.clone();
                                }
                            }
                        }

                        for ch in &mut channels {
                            ch.device_id = dev_id;
                            ch.room_id = room_id;
                        }

                        devices.push(KnxDevice {
                            id: dev_id,
                            individual_address: ia,
                            manufacturer,
                            model,
                            name: dev_name,
                            room_id,
                            channels,
                            position: None,
                            order_number: prod_info.map(|p| p.order_number.clone()),
                            application_program: app_program_name,
                            mask_version,
                            bus_current_ma: bus_current,
                            communication_objects: cos,
                            parameters: params,
                            assign_rules: app_info.map(|a| a.assign_rules.clone()).unwrap_or_default(),
                            visible_ko_numbers: Vec::new(),
                            last_flashed_state: None,
                            security: dev.serial_number.clone().map(|sn| crate::model::KnxDataSecureConfig {
                                is_secure_enabled: false,
                                serial_number: Some(sn),
                                fdsk: None,
                                tool_key: None,
                                sequence_number: 0,
                            }),
                            loaded_image: dev.loaded_image.clone(),
                            checksums: dev.checksums.clone(),
                            ets_device_id: Some(dev.id.clone()),
                            product_ref_id: if dev.product_ref_id.is_empty() { None } else { Some(dev.product_ref_id.clone()) },
                            hardware2program_ref_id: if dev.hardware2program_ref_id.is_empty() { None } else { Some(dev.hardware2program_ref_id.clone()) },
                            ets_puid: dev.puid,
                        });
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML-Parsing Fehler in 0.xml: {:?}", e)),
            _ => {}
        }
        buf.clear();
    }

    // Associate devices with rooms if rooms were parsed after devices (Locations is after Topology in ETS 0.xml)
    for dev in &mut devices {
        if dev.room_id.is_none() {
            if let Some(xml_id) = dev_xml_ids.get(&dev.id) {
                if let Some(r_id) = device_ref_to_room.get(xml_id) {
                    dev.room_id = Some(*r_id);
                    for ch in &mut dev.channels {
                        ch.room_id = Some(*r_id);
                    }
                }
            }
        }
    }

    // Resolve KO links to GroupAddresses (now that ga_by_id is fully populated from <GroupAddresses>)
    for pending in &pending_ko_links {
        if let Some(dev) = devices.iter_mut().find(|d| d.id == pending.dev_id) {
            if let Some(co) = dev.communication_objects.iter_mut().find(|c| c.number == pending.ko_number || c.id == pending.ko_id) {
                for link_token in pending.links.split_whitespace() {
                    if let Some((ga_id, ga_addr)) = ga_by_id.get(link_token) {
                        if !co.group_addresses.contains(ga_addr) {
                            co.group_addresses.push(ga_addr.clone());
                        }
                        if !co.group_address_ids.contains(ga_id) {
                            co.group_address_ids.push(*ga_id);
                        }
                    }
                }
            }
        }
    }

    // Initialize last_flashed_state snapshot for imported devices, as they represent the programmed state in the physical installation
    let import_time = chrono::Utc::now();
    for dev in &mut devices {
        let gas: Vec<String> = dev.communication_objects.iter().flat_map(|k| k.group_addresses.iter().cloned()).collect();
        let assocs: Vec<(u32, String)> = dev.communication_objects.iter().flat_map(|k| k.group_addresses.iter().map(move |ga| (k.number, ga.clone()))).collect();
        let params: HashMap<String, String> = dev.parameters.iter().map(|p| (p.id.clone(), p.value.clone())).collect();
        dev.last_flashed_state = Some(DeviceFlashedSnapshot {
            individual_address: dev.individual_address.clone(),
            group_addresses: gas,
            associations: assocs,
            parameters: params,
            flashed_at: import_time,
        });
    }

    // Sort devices by individual address (1.1.1 .. 1.1.16)
    devices.sort_by(|a, b| {
        let parse_ia = |s: &str| -> (u8, u8, u8) {
            let parts: Vec<u8> = s.split('.').filter_map(|p| p.parse::<u8>().ok()).collect();
            (parts.first().copied().unwrap_or(0), parts.get(1).copied().unwrap_or(0), parts.get(2).copied().unwrap_or(0))
        };
        parse_ia(&a.individual_address).cmp(&parse_ia(&b.individual_address))
    });

    if buildings.is_empty() {
        buildings.push(Building {
            id: building_id,
            name: "Haus".to_string(),
        });
    }

    if floors.is_empty() {
        current_floor_id = Uuid::new_v4();
        floors.push(Floor {
            id: current_floor_id,
            building_id,
            name: "Erdgeschoss".to_string(),
            level: 0,
        });
    }

    let default_floor_id = floors[0].id;

    // Fallback: discover rooms from group address "|Room| Function" ONLY if 0.xml contained NO rooms
    if rooms.is_empty() {
        let mut room_by_name: HashMap<String, Uuid> = HashMap::new();
        for ga in &group_addresses {
            if ga.name.starts_with('|') {
                if let Some(end_idx) = ga.name[1..].find('|') {
                    let r_raw = ga.name[1..1 + end_idx].trim();
                    let (canonical_r, _) = canonicalize_room_name(r_raw);
                    if !room_by_name.contains_key(&canonical_r) && !canonical_r.is_empty() {
                        let r_id = Uuid::new_v4();
                        room_by_name.insert(canonical_r.clone(), r_id);
                        rooms.push(Room {
                            id: r_id,
                            floor_id: default_floor_id,
                            name: canonical_r.clone(),
                            icon: get_room_icon(&canonical_r).to_string(),
                        });
                    }
                }
            }
        }
    }

    if rooms.is_empty() {
        rooms.push(Room {
            id: Uuid::new_v4(),
            floor_id: default_floor_id,
            name: "Erdgeschoss".to_string(),
            icon: "home".to_string(),
        });
    }

    // Auto-generate functional blocks & wires
    let mut blocks = Vec::new();
    let mut connections = Vec::new();

    // 1. BlindController blocks for blinds
    let blind_devices: Vec<&KnxDevice> = devices.iter()
        .filter(|d| d.model.contains("AKU") || d.model.contains("JAL") || d.name.to_lowercase().contains("rolladen") || d.name.to_lowercase().contains("jalousie"))
        .collect();

    if !blind_devices.is_empty() {
        for (i, dev) in blind_devices.iter().enumerate() {
            let block_id = Uuid::new_v4();
            let mut block_name = dev.name.clone();
            if block_name.starts_with("Rolladensteuerung ") {
                block_name = format!("Jalousie {}", &block_name["Rolladensteuerung ".len()..]);
            } else if !block_name.starts_with("Jalousie") {
                block_name = format!("Jalousie {}", block_name);
            }

            let move_ga = dev.communication_objects.iter()
                .find(|c| c.function_text.contains("Auf/Ab") || c.function_text.contains("Schalten") || c.number == 1 || c.number == 31)
                .and_then(|c| c.group_address_ids.first().copied());

            let stop_ga = dev.communication_objects.iter()
                .find(|c| c.function_text.contains("Stop") || c.function_text.contains("Lamelle") || c.function_text.contains("Schritt") || c.number == 2 || c.number == 33)
                .and_then(|c| c.group_address_ids.first().copied());

            let pos_ga = dev.communication_objects.iter()
                .find(|c| c.function_text.contains("Position") && !c.function_text.contains("Status"))
                .and_then(|c| c.group_address_ids.first().copied());

            blocks.push(FunctionBlock {
                id: block_id,
                name: block_name,
                block_type: FunctionBlockType::BlindController,
                room_id: dev.room_id,
                position: Position { x: 480.0, y: 120.0 + (i as f64 * 160.0) },
                inputs: vec![
                    BlockPin {
                        id: format!("{}-in-up", block_id),
                        name: "up".to_string(),
                        description: "Aufwärts / Öffnen".to_string(),
                        dpt: DptType::Dpt1_008,
                        direction: PinDirection::Input,
                        group_address_id: move_ga,
                    },
                    BlockPin {
                        id: format!("{}-in-down", block_id),
                        name: "down".to_string(),
                        description: "Abwärts / Schließen".to_string(),
                        dpt: DptType::Dpt1_008,
                        direction: PinDirection::Input,
                        group_address_id: move_ga,
                    },
                    BlockPin {
                        id: format!("{}-in-stop", block_id),
                        name: "stop".to_string(),
                        description: "Fahrt anhalten".to_string(),
                        dpt: DptType::Dpt1_010,
                        direction: PinDirection::Input,
                        group_address_id: stop_ga,
                    },
                    BlockPin {
                        id: format!("{}-in-pos", block_id),
                        name: "in-pos".to_string(),
                        description: "Soll-Position (0-100%)".to_string(),
                        dpt: DptType::Dpt5_001,
                        direction: PinDirection::Input,
                        group_address_id: pos_ga,
                    },
                    BlockPin {
                        id: format!("{}-in-alarm", block_id),
                        name: "alarm".to_string(),
                        description: "Windalarm Sicherheitsfahrt".to_string(),
                        dpt: DptType::Dpt1_005,
                        direction: PinDirection::Input,
                        group_address_id: None,
                    },
                ],
                outputs: vec![
                    BlockPin {
                        id: format!("{}-out-pos", block_id),
                        name: "pos".to_string(),
                        description: "Jalousie-Position (0-100%)".to_string(),
                        dpt: DptType::Dpt5_001,
                        direction: PinDirection::Output,
                        group_address_id: pos_ga,
                    },
                ],
                parameters: serde_json::json!({
                    "full_drive_time_ms": 25000,
                    "blade_turn_time_ms": 1200
                }),
                state: serde_json::json!({
                    "current_position": 0,
                    "blade_position": 0,
                    "is_moving": false
                }),
            });
        }
    }

    // 2. Weather & Astro
    let wind_ga = group_addresses.iter().find(|g| g.name.contains("Wind") && (g.name.contains("Avg") || g.name.contains("Bresser"))).map(|g| g.id);
    let rain_ga = group_addresses.iter().find(|g| g.name.contains("Regen")).map(|g| g.id);
    let lux_ga = group_addresses.iter().find(|g| g.name.contains("Lichtintensität") || g.name.contains("Helligkeit")).map(|g| g.id);
    let temp_ga = group_addresses.iter().find(|g| g.name.contains("Temperatur") && (g.name.contains("Bresser") || g.name.contains("Aussen"))).map(|g| g.id);

    if wind_ga.is_some() || lux_ga.is_some() {
        let astro_id = Uuid::new_v4();
        let target_room_id = blocks.iter()
            .find(|b| b.block_type == FunctionBlockType::BlindController)
            .and_then(|b| b.room_id)
            .or_else(|| rooms.iter().find(|r| r.name == "Wohnen 1").map(|r| r.id))
            .or_else(|| rooms.first().map(|r| r.id));

        blocks.push(FunctionBlock {
            id: astro_id,
            name: "Astro & Sonnenschutz".to_string(),
            block_type: FunctionBlockType::AstroSunProtection,
            room_id: target_room_id,
            position: Position { x: 50.0, y: 120.0 },
            inputs: vec![
                BlockPin {
                    id: format!("{}-in-wind", astro_id),
                    name: "wind_speed".to_string(),
                    description: "Bresser Windgeschwindigkeit".to_string(),
                    dpt: DptType::Dpt9_001,
                    direction: PinDirection::Input,
                    group_address_id: wind_ga,
                },
                BlockPin {
                    id: format!("{}-in-lux", astro_id),
                    name: "brightness".to_string(),
                    description: "Bresser Helligkeit".to_string(),
                    dpt: DptType::Dpt9_001,
                    direction: PinDirection::Input,
                    group_address_id: lux_ga,
                },
                BlockPin {
                    id: format!("{}-in-rain", astro_id),
                    name: "rain".to_string(),
                    description: "Bresser Regen".to_string(),
                    dpt: DptType::Dpt1_001,
                    direction: PinDirection::Input,
                    group_address_id: rain_ga,
                },
                BlockPin {
                    id: format!("{}-in-temp", astro_id),
                    name: "temp".to_string(),
                    description: "Bresser Außentemperatur".to_string(),
                    dpt: DptType::Dpt9_001,
                    direction: PinDirection::Input,
                    group_address_id: temp_ga,
                },
            ],
            outputs: vec![
                BlockPin {
                    id: format!("{}-out-alarm", astro_id),
                    name: "wind_alarm".to_string(),
                    description: "Windalarm Sicherheitsfahrt".to_string(),
                    dpt: DptType::Dpt1_005,
                    direction: PinDirection::Output,
                    group_address_id: None,
                },
                BlockPin {
                    id: format!("{}-out-sun", astro_id),
                    name: "sun_active".to_string(),
                    description: "Sonnenschutz aktiv".to_string(),
                    dpt: DptType::Dpt1_001,
                    direction: PinDirection::Output,
                    group_address_id: None,
                },
                BlockPin {
                    id: format!("{}-out-pos", astro_id),
                    name: "target_pos".to_string(),
                    description: "Soll-Position Jalousie".to_string(),
                    dpt: DptType::Dpt5_001,
                    direction: PinDirection::Output,
                    group_address_id: None,
                },
            ],
            parameters: serde_json::json!({
                "facade_orientation_deg": 180.0,
                "wind_alarm_threshold": 12.0,
                "sun_brightness_threshold": 35000.0,
                "sun_elevation_min": 10.0,
                "blind_protection_pos": 80,
                "blade_protection_pos": 45,
            }),
            state: serde_json::json!({
                "wind_speed": 3.2,
                "rain": false,
                "brightness": 42000,
                "temp": 22.4,
                "is_wind_alarm": false,
                "is_sun_protecting": false,
                "target_pos": 0,
                "calculated_azimuth": 183.4,
                "calculated_elevation": 60.9,
                "solar_direction": "Süd (S)",
            }),
        });

        // Wire Astro block to the first blind in that room
        if let Some(blind_block) = blocks.iter().find(|b| b.block_type == FunctionBlockType::BlindController && b.room_id == target_room_id) {
            connections.push(WireConnection {
                id: Uuid::new_v4(),
                from_node_id: astro_id,
                from_pin: "target_pos".to_string(),
                to_node_id: blind_block.id,
                to_pin: "in-pos".to_string(),
            });
            connections.push(WireConnection {
                id: Uuid::new_v4(),
                from_node_id: astro_id,
                from_pin: "wind_alarm".to_string(),
                to_node_id: blind_block.id,
                to_pin: "alarm".to_string(),
            });
        }

        // 3. SceneController & LightController in target room
        if let Some(target_room_id) = target_room_id {
            let sc_id = Uuid::new_v4();
            let light_id = Uuid::new_v4();

            let led_ga = group_addresses.iter()
                .find(|g| g.name.contains("LED") && g.name.contains("schalten"))
                .map(|g| g.id);

            blocks.push(FunctionBlock {
                id: sc_id,
                name: "Lichtszenen & Stimmungen".to_string(),
                block_type: FunctionBlockType::SceneController,
                room_id: Some(target_room_id),
                position: Position { x: 50.0, y: 440.0 },
                inputs: vec![
                    BlockPin {
                        id: format!("{}-in-trig", sc_id),
                        name: "trig".to_string(),
                        description: "Szene weiterschalten".to_string(),
                        dpt: DptType::Dpt1_001,
                        direction: PinDirection::Input,
                        group_address_id: None,
                    },
                    BlockPin {
                        id: format!("{}-in-prev", sc_id),
                        name: "prev".to_string(),
                        description: "Vorherige Szene".to_string(),
                        dpt: DptType::Dpt1_001,
                        direction: PinDirection::Input,
                        group_address_id: None,
                    },
                    BlockPin {
                        id: format!("{}-in-scene", sc_id),
                        name: "scene".to_string(),
                        description: "Szene Direktanwahl".to_string(),
                        dpt: DptType::Dpt18_001,
                        direction: PinDirection::Input,
                        group_address_id: None,
                    },
                    BlockPin {
                        id: format!("{}-in-all-off", sc_id),
                        name: "all_off".to_string(),
                        description: "Alles Aus".to_string(),
                        dpt: DptType::Dpt1_001,
                        direction: PinDirection::Input,
                        group_address_id: None,
                    },
                ],
                outputs: vec![
                    BlockPin {
                        id: format!("{}-out-scene", sc_id),
                        name: "scene_ctrl".to_string(),
                        description: "Szenensteuerung".to_string(),
                        dpt: DptType::Dpt18_001,
                        direction: PinDirection::Output,
                        group_address_id: None,
                    },
                    BlockPin {
                        id: format!("{}-out-all-off", sc_id),
                        name: "all_off".to_string(),
                        description: "Alles Aus Status".to_string(),
                        dpt: DptType::Dpt1_001,
                        direction: PinDirection::Output,
                        group_address_id: None,
                    },
                    BlockPin {
                        id: format!("{}-out-ch1-val", sc_id),
                        name: "ch1_val".to_string(),
                        description: "Kreis 1 Dimmwert".to_string(),
                        dpt: DptType::Dpt5_001,
                        direction: PinDirection::Output,
                        group_address_id: None,
                    },
                ],
                parameters: serde_json::json!({
                    "fade_time_sec": 1.5,
                    "circuits": [
                        { "id": "c1", "name": "LED Fenster", "type": "dimmer", "color": "#f59e0b" },
                        { "id": "c2", "name": "LED Esstisch", "type": "dimmer", "color": "#ec4899" }
                    ],
                    "scenes": [
                        { "no": 1, "name": "Normal / Hell", "icon": "☀️", "fade_time": 1.5, "values": { "c1": 90, "c2": 70 } },
                        { "no": 2, "name": "Kochen / Essen", "icon": "🍳", "fade_time": 1.5, "values": { "c1": 100, "c2": 80 } },
                        { "no": 3, "name": "TV / Relax", "icon": "🍿", "fade_time": 2.0, "values": { "c1": 0, "c2": 25 } },
                        { "no": 4, "name": "Nacht / Orientierung", "icon": "🌙", "fade_time": 2.5, "values": { "c1": 0, "c2": 10 } },
                        { "no": 5, "name": "Alles Aus", "icon": "🌑", "fade_time": 1.0, "values": { "c1": 0, "c2": 0 } }
                    ]
                }),
                state: serde_json::json!({
                    "active_scene": 1,
                    "scene_name": "Normal / Hell",
                    "scene_icon": "☀️",
                    "fader_values": { "c1": 90, "c2": 70 },
                    "is_all_off": false
                }),
            });

            blocks.push(FunctionBlock {
                id: light_id,
                name: "LED Beleuchtung".to_string(),
                block_type: FunctionBlockType::LightController,
                room_id: Some(target_room_id),
                position: Position { x: 480.0, y: 440.0 },
                inputs: vec![
                    BlockPin {
                        id: format!("{}-in-t", light_id),
                        name: "t".to_string(),
                        description: "Taster-Eingang".to_string(),
                        dpt: DptType::Dpt1_001,
                        direction: PinDirection::Input,
                        group_address_id: led_ga,
                    },
                    BlockPin {
                        id: format!("{}-in-val", light_id),
                        name: "val".to_string(),
                        description: "Dimmwert (0-100%)".to_string(),
                        dpt: DptType::Dpt5_001,
                        direction: PinDirection::Input,
                        group_address_id: None,
                    },
                ],
                outputs: vec![
                    BlockPin {
                        id: format!("{}-out-sw", light_id),
                        name: "sw".to_string(),
                        description: "Schalten".to_string(),
                        dpt: DptType::Dpt1_001,
                        direction: PinDirection::Output,
                        group_address_id: led_ga,
                    },
                ],
                parameters: serde_json::json!({}),
                state: serde_json::json!({
                    "is_on": true,
                    "brightness": 90
                }),
            });

            connections.push(WireConnection {
                id: Uuid::new_v4(),
                from_node_id: sc_id,
                from_pin: "ch1_val".to_string(),
                to_node_id: light_id,
                to_pin: "val".to_string(),
            });
        }
    }

    // 4. ClimateController blocks for heating
    let heating_dev_pos = devices.iter().position(|d| d.model.contains("AKH") || d.name.contains("Heizung"));
    if let Some(h_idx) = heating_dev_pos {
        let heating_channels = devices[h_idx].channels.clone();
        for (idx, ch) in heating_channels.iter().enumerate() {
            if ch.channel_type == ChannelType::HeatingOutput {
                let target_room_id = rooms.iter()
                    .find(|r| ch.name.to_lowercase().contains(&r.name.to_lowercase()))
                    .map(|r| r.id)
                    .or_else(|| rooms.iter().find(|r| r.name == "Wohnen 1").map(|r| r.id))
                    .or(ch.room_id);

                let cur_temp_ga = group_addresses.iter()
                    .find(|g| g.name.contains("Temperatur") && (g.name.contains("Esstisch") || g.name.contains("Wohn") || g.name.contains("HK1")) && !g.name.contains("Bresser") && !g.name.contains("Aussen"))
                    .map(|g| g.id);

                let set_temp_ga = group_addresses.iter()
                    .find(|g| g.name.contains("Sollwert") && !g.name.contains("verschiebung") && (g.name.contains("Esstisch") || g.name.contains("Wohn") || g.name.contains("HK1")))
                    .map(|g| g.id);

                let valve_ga = group_addresses.iter()
                    .find(|g| g.name.contains("Stellwert") && !g.name.contains("Status") && (g.name.contains("Esstisch") || g.name.contains("Wohn") || g.name.contains("HK1")))
                    .map(|g| g.id);

                let blk_id = Uuid::new_v4();
                blocks.push(FunctionBlock {
                    id: blk_id,
                    name: format!("Klima {}", ch.name),
                    block_type: FunctionBlockType::ClimateController,
                    room_id: target_room_id,
                    position: Position { x: 820.0, y: 140.0 + (idx as f64 * 220.0) },
                    inputs: vec![
                        BlockPin {
                            id: format!("{}-in-t-act", blk_id),
                            name: "t_act".to_string(),
                            description: "Ist-Temperatur (Sensor)".to_string(),
                            dpt: DptType::Dpt9_001,
                            direction: PinDirection::Input,
                            group_address_id: cur_temp_ga,
                        },
                        BlockPin {
                            id: format!("{}-in-t-set", blk_id),
                            name: "t_set".to_string(),
                            description: "Soll-Temperatur".to_string(),
                            dpt: DptType::Dpt9_001,
                            direction: PinDirection::Input,
                            group_address_id: set_temp_ga,
                        },
                    ],
                    outputs: vec![
                        BlockPin {
                            id: format!("{}-out-valve", blk_id),
                            name: "valve".to_string(),
                            description: "Stellwert Ventil (0-100%)".to_string(),
                            dpt: DptType::Dpt5_001,
                            direction: PinDirection::Output,
                            group_address_id: valve_ga,
                        },
                    ],
                    parameters: serde_json::json!({
                        "comfort_temp": 21.5,
                        "eco_temp": 19.0,
                    }),
                    state: serde_json::json!({
                        "target_temp": 21.5,
                        "act_temp": 21.2,
                        "valve_pwm": 35,
                    }),
                });

                // Place Taster channel and wire to ClimateController for the first room circuit
                if idx == 0 {
                    if let Some(taster_dev) = devices.iter_mut().find(|d| d.individual_address == "1.1.5" || d.name.contains("Taster WZ Esstisch")) {
                        if let Some(t_ch) = taster_dev.channels.first_mut() {
                            t_ch.position = Some(Position { x: 440.0, y: 160.0 });
                            t_ch.room_id = target_room_id;
                            let t_ch_id = t_ch.id;

                            connections.push(WireConnection {
                                id: Uuid::new_v4(),
                                from_node_id: t_ch_id,
                                from_pin: "out".to_string(),
                                to_node_id: blk_id,
                                to_pin: "t_act".to_string(),
                            });
                        }
                    }
                }
            }
        }
    }

    // 1. Auto-generate visible_ko_numbers and layout for devices
    let mut sensor_y = 60.0;
    let mut actuator_y = 60.0;

    for dev in &mut devices {
        // Active pins: only KOs linked to at least one GA
        let active_kos: Vec<u32> = dev
            .communication_objects
            .iter()
            .filter(|k| !k.group_addresses.is_empty() || !k.group_address_ids.is_empty())
            .map(|k| k.number)
            .collect();
        dev.visible_ko_numbers = active_kos;

        let name_lower = dev.name.to_lowercase();
        let model_lower = dev.model.to_lowercase();

        // Distinct classification: True sensors vs Actuators vs Gateway
        let is_sensor = name_lower.contains("taster")
            || model_lower.contains("taster")
            || name_lower.contains("wetter")
            || name_lower.contains("sensor")
            || name_lower.contains("präsenz")
            || name_lower.contains("bewegung");

        let is_gateway = name_lower.contains("ip interface") || model_lower.contains("ip000") || name_lower.contains("schnittstelle");

        // Estimated height: Header (70px) + pins (each 38px) + padding (30px)
        let est_height = 80.0 + (dev.visible_ko_numbers.len().max(1) as f64) * 38.0 + 30.0;

        if is_sensor || is_gateway {
            dev.position = Some(Position {
                x: 80.0,
                y: sensor_y,
            });
            sensor_y += est_height + 40.0;
        } else {
            dev.position = Some(Position {
                x: 1180.0,
                y: actuator_y,
            });
            actuator_y += est_height + 40.0;
        }
    }

    // 2. Auto-Wiring: For each GA, connect sender KOs to receiver KOs
    for ga in &group_addresses {
        // Find all (device_id, ko) that have this GA
        let mut endpoints: Vec<(Uuid, u32, bool)> = Vec::new();
        for dev in &devices {
            let is_sensor_device = dev.name.to_lowercase().contains("taster")
                || dev.model.to_lowercase().contains("taster")
                || dev.name.to_lowercase().contains("wetter")
                || dev.name.to_lowercase().contains("sensor");

            for ko in &dev.communication_objects {
                if ko.group_addresses.contains(&ga.address)
                    || ko.group_address_ids.contains(&ga.id)
                {
                    // A true sender has transmit=true and write=false
                    // Receivers have write=true
                    let is_sender = if is_sensor_device {
                        ko.flags.transmit && !ko.flags.write
                    } else {
                        // Actuator status output or Gateway broadcast
                        ko.flags.transmit && !ko.flags.write
                    };
                    endpoints.push((dev.id, ko.number, is_sender));
                }
            }
        }

        if endpoints.len() < 2 {
            continue;
        }

        let senders: Vec<_> = endpoints.iter().filter(|e| e.2).cloned().collect();
        let receivers: Vec<_> = endpoints.iter().filter(|e| !e.2).cloned().collect();

        if !senders.is_empty() && !receivers.is_empty() {
            for s in &senders {
                for r in &receivers {
                    if s.0 != r.0 || s.1 != r.1 {
                        // Never wire pushbutton/sensor directly to pushbutton/sensor
                        let is_input_device = |dev_id: Uuid| -> bool {
                            devices.iter().find(|d| d.id == dev_id).map(|d| {
                                let name_lower = d.name.to_lowercase();
                                name_lower.contains("taster") || name_lower.contains("sensor") || name_lower.contains("pushbutton") || name_lower.contains("button")
                                    || d.channels.iter().any(|ch| ch.channel_type == ChannelType::PushButtonInput)
                            }).unwrap_or(false)
                        };
                        if is_input_device(s.0) && is_input_device(r.0) {
                            continue;
                        }

                        let from_pin = format!("ko-{}", s.1);
                        let to_pin = format!("ko-{}", r.1);
                        if !connections.iter().any(|c| {
                            c.from_node_id == s.0 && c.from_pin == from_pin && c.to_node_id == r.0 && c.to_pin == to_pin
                        }) {
                            connections.push(WireConnection {
                                id: Uuid::new_v4(),
                                from_node_id: s.0,
                                from_pin,
                                to_node_id: r.0,
                                to_pin,
                            });
                        }
                    }
                }
            }
        }
    }

    info!(
        "ETS 0.xml Import erfolgreich: {} Gruppenadressen, {} Räume, {} Geräte, {} Blöcke, {} Verbindungen",
        group_addresses.len(),
        rooms.len(),
        devices.len(),
        blocks.len(),
        connections.len()
    );

    let mut project = Project {
        id: Uuid::new_v4(),
        name: project_name.to_string(),
        ga_scheme: GaScheme::TradeRoomFunction,
        buildings,
        floors,
        rooms,
        devices,
        blocks,
        connections,
        group_addresses,
        topology: None,
        ..Default::default()
    };
    crate::topology::TopologyManager::ensure_topology(&mut project);
    Ok(project)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_ets_csv_sample() {
        let csv_sample = r#"
"Zentralfunktion";;;"0/-/-"
;"Zentral";;"0/0/-"
;;"|Wetter| Temperatur";"0/0/1"
"Rollos";;;"1/-/-"
;"EG";;"1/0/-"
;;"|Wohnzimmer| Auf/Ab";"1/0/0"
;;"|Wohnzimmer| Stopp";"1/0/1"
;;"|Küche| Schalten";"2/0/0"
"#;

        let proj = parse_ets_csv(csv_sample, "Test Projekt").unwrap();
        assert_eq!(proj.group_addresses.len(), 4);
        assert_eq!(proj.group_addresses[1].address, "1/0/0");
        assert_eq!(proj.group_addresses[1].dpt, "1.008");
        assert_eq!(proj.group_addresses[2].dpt, "1.010");
        assert!(proj.rooms.len() >= 2);
    }

    #[test]
    fn test_derive_ets6_key() {
        let key = derive_ets6_key("TestSecret2026!");
        assert_eq!(key, "C7+xUhElHT+todNnjyZlO0SflC2e96bZfmlkjZbec2Y=");
    }

    #[test]
    fn test_decode_ets_serial_number() {
        // Example Base64 serial numbers from ETS project 0.xml
        assert_eq!(decode_ets_serial_number("AIN2igxl"), Some("00:83:76:8A:0C:65".to_string()));
        assert_eq!(decode_ets_serial_number("AIN7QAKF"), Some("00:83:7B:40:02:85".to_string()));
        assert_eq!(decode_ets_serial_number("AIN7QAKG"), Some("00:83:7B:40:02:86".to_string()));

        // Hex formats (from .knxkeys)
        assert_eq!(decode_ets_serial_number("00837B400286"), Some("00:83:7B:40:02:86".to_string()));
        assert_eq!(decode_ets_serial_number("00:83:76:8A:0C:65"), Some("00:83:76:8A:0C:65".to_string()));

        // Invalid
        assert_eq!(decode_ets_serial_number(""), None);
        assert_eq!(decode_ets_serial_number("short"), None);
    }
}
