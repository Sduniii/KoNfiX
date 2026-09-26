use std::collections::{HashMap, HashSet};
use uuid::Uuid;
use tracing::info;
use crate::model::{
    FilterAction, FilterTableEntry, FilterTableSummary, KnxMediumType, LineCouplerFilterMode,
    Project, ProjectTopology, TopologyArea, TopologyLine,
};

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct TopologyValidationIssue {
    pub severity: String, // "error", "warning", "info"
    pub message: String,
    pub device_id: Option<Uuid>,
    pub device_address: Option<String>,
    pub line_address: Option<String>,
}

pub struct TopologyManager;

impl TopologyManager {
    /// Ensures that a Project has a valid ProjectTopology.
    /// If none exists, it auto-discovers areas and lines from all KnxDevices in the project.
    pub fn ensure_topology(project: &mut Project) {
        if project.topology.as_ref().map(|t| !t.areas.is_empty()).unwrap_or(false) {
            // Already initialized, ensure devices are mapped and couplers are detected
            Self::sync_couplers(project);
            return;
        }

        info!("Auto-discovering KNX topology from devices for project '{}'...", project.name);

        // Map: area_num -> (Map: line_num -> Vec<device_address>)
        let mut area_map: HashMap<u8, HashMap<u8, Vec<Uuid>>> = HashMap::new();

        for dev in &project.devices {
            let parts: Vec<&str> = dev.individual_address.split('.').collect();
            if parts.len() == 3 {
                let area: u8 = parts[0].parse().unwrap_or(1);
                let line: u8 = parts[1].parse().unwrap_or(1);
                area_map
                    .entry(area)
                    .or_default()
                    .entry(line)
                    .or_default()
                    .push(dev.id);
            }
        }

        if area_map.is_empty() {
            // Default: Area 1, Line 1.1
            area_map.entry(1).or_default().entry(1).or_default();
        }

        let mut areas: Vec<TopologyArea> = Vec::new();
        let mut sorted_areas: Vec<u8> = area_map.keys().copied().collect();
        sorted_areas.sort();

        for area_num in sorted_areas {
            let line_map = &area_map[&area_num];
            let mut sorted_lines: Vec<u8> = line_map.keys().copied().collect();
            sorted_lines.sort();

            let area_id = Uuid::new_v4();
            let mut lines: Vec<TopologyLine> = Vec::new();

            for line_num in sorted_lines {
                let line_addr = format!("{}.{}", area_num, line_num);
                let line_id = Uuid::new_v4();

                // Detect line coupler (device with address x.y.0 or named Koppler/Router)
                let coupler_dev = project.devices.iter().find(|d| {
                    let parts: Vec<&str> = d.individual_address.split('.').collect();
                    if parts.len() == 3 && parts[0] == area_num.to_string() && parts[1] == line_num.to_string() {
                        parts[2] == "0"
                            || d.name.to_lowercase().contains("koppler")
                            || d.model.to_lowercase().contains("koppler")
                            || d.name.to_lowercase().contains("coupler")
                    } else {
                        false
                    }
                });

                let line_name = if line_num == 0 {
                    format!("Bereich {}.0 Hauptlinie", area_num)
                } else {
                    format!("Linie {}.{} TP", area_num, line_num)
                };

                let medium = if line_num == 0 {
                    KnxMediumType::Ip
                } else {
                    KnxMediumType::Tp
                };

                lines.push(TopologyLine {
                    id: line_id,
                    area_id,
                    line_number: line_num,
                    address: line_addr,
                    name: line_name,
                    medium,
                    coupler_device_id: coupler_dev.map(|d| d.id),
                    coupler_filter_mode: LineCouplerFilterMode::Filter,
                    manual_forward_gas: Vec::new(),
                    description: format!("Automatisch generierte KNX Linie {}.{}", area_num, line_num),
                });
            }

            areas.push(TopologyArea {
                id: area_id,
                area_number: area_num,
                address: area_num.to_string(),
                name: if area_num == 0 {
                    "Backbone Bereich 0 (IP)".to_string()
                } else {
                    format!("Bereich {}", area_num)
                },
                medium: if area_num == 0 { KnxMediumType::Ip } else { KnxMediumType::Tp },
                lines,
            });
        }

        project.topology = Some(ProjectTopology { areas });
    }

    /// Detects and links coupler devices to lines if not set
    fn sync_couplers(project: &mut Project) {
        if let Some(topo) = &mut project.topology {
            for area in &mut topo.areas {
                for line in &mut area.lines {
                    if line.coupler_device_id.is_none() {
                        let coupler_dev = project.devices.iter().find(|d| {
                            let parts: Vec<&str> = d.individual_address.split('.').collect();
                            if parts.len() == 3 && parts[0] == area.area_number.to_string() && parts[1] == line.line_number.to_string() {
                                parts[2] == "0"
                                    || d.name.to_lowercase().contains("koppler")
                                    || d.model.to_lowercase().contains("koppler")
                                    || d.name.to_lowercase().contains("coupler")
                            } else {
                                false
                            }
                        });
                        if let Some(c) = coupler_dev {
                            line.coupler_device_id = Some(c.id);
                        }
                    }
                }
            }
        }
    }

    /// Calculates the 100% accurate KNX filter table (Forward / Block) for a specific line.
    /// Returns detailed explanation per GA plus the exact 8192-byte binary bitmask for hardware flashing.
    pub fn calculate_filter_table(project: &Project, line_id: Uuid) -> Result<FilterTableSummary, String> {
        let topo = project
            .topology
            .as_ref()
            .ok_or_else(|| "Projekt besitzt keine Topologie".to_string())?;

        // Locate line in areas
        let mut target_line: Option<&TopologyLine> = None;
        let mut target_area: Option<&TopologyArea> = None;

        for a in &topo.areas {
            for l in &a.lines {
                if l.id == line_id {
                    target_line = Some(l);
                    target_area = Some(a);
                    break;
                }
            }
            if target_line.is_some() {
                break;
            }
        }

        let line = target_line.ok_or_else(|| "Linie nicht gefunden".to_string())?;
        let _area = target_area.ok_or_else(|| "Bereich nicht gefunden".to_string())?;

        let line_prefix = format!("{}.", line.address); // e.g. "1.1."
        let coupler_addr_str = format!("{}.0", line.address);

        // Subline devices: Address starts with "1.1." but is NOT the coupler itself ("1.1.0")
        let subline_devices: Vec<&_> = project
            .devices
            .iter()
            .filter(|d| d.individual_address.starts_with(&line_prefix) && d.individual_address != coupler_addr_str)
            .collect();

        // External devices: All devices outside this subline (other lines or backbone)
        let extline_devices: Vec<&_> = project
            .devices
            .iter()
            .filter(|d| !d.individual_address.starts_with(&line_prefix) || d.individual_address == coupler_addr_str)
            .collect();

        // Canvas blocks are running 24/7 on the Server / Backbone IP
        let has_canvas_blocks = !project.blocks.is_empty();

        let mut entries: Vec<FilterTableEntry> = Vec::new();
        let mut forwarded_count = 0usize;
        let mut filtered_count = 0usize;

        // 8192 bytes bitmap (65,536 bits) for full KNX Group Address range 0/0/0 to 31/7/255
        let mut bitmap = vec![0u8; 8192];

        // Process all configured Group Addresses
        for ga in &project.group_addresses {
            // Which subline devices use this GA?
            let sub_devs: Vec<String> = subline_devices
                .iter()
                .filter(|d| {
                    d.communication_objects
                        .iter()
                        .any(|k| k.group_addresses.contains(&ga.address) || k.group_address_ids.contains(&ga.id))
                })
                .map(|d| format!("{} ({})", d.name, d.individual_address))
                .collect();

            // Which external devices use this GA?
            let ext_devs: Vec<String> = extline_devices
                .iter()
                .filter(|d| {
                    d.communication_objects
                        .iter()
                        .any(|k| k.group_addresses.contains(&ga.address) || k.group_address_ids.contains(&ga.id))
                })
                .map(|d| format!("{} ({})", d.name, d.individual_address))
                .collect();

            // Is this GA used by a Canvas Function Block?
            let used_by_block = has_canvas_blocks && project.blocks.iter().any(|b| {
                b.inputs.iter().any(|p| p.group_address_id == Some(ga.id))
                    || b.outputs.iter().any(|p| p.group_address_id == Some(ga.id))
            });

            let sub_uses = !sub_devs.is_empty();
            let ext_uses = !ext_devs.is_empty() || used_by_block;

            // Decision: Forward if subline communicates with outside world, or if manually forced
            let is_manual = line.manual_forward_gas.contains(&ga.address);
            let action: FilterAction;
            let reason: String;

            if line.coupler_filter_mode == LineCouplerFilterMode::RouteAll {
                action = FilterAction::Forward;
                reason = "Weitergeleitet: Koppler-Modus 'Durchzug / Diagnose'".to_string();
            } else if line.coupler_filter_mode == LineCouplerFilterMode::BlockAll {
                action = FilterAction::Block;
                reason = "Blockiert: Koppler-Modus 'Sperren'".to_string();
            } else if is_manual {
                action = FilterAction::Forward;
                reason = "Weitergeleitet: Manuelle Freigabe in Koppler-Konfiguration".to_string();
            } else if sub_uses && ext_uses {
                action = FilterAction::Forward;
                let ext_desc = if !ext_devs.is_empty() {
                    ext_devs.join(", ")
                } else {
                    "Canvas Server-Funktionsblock".to_string()
                };
                reason = format!(
                    "Weitergeleitet: Sublinie [{}] kommuniziert mit extern [{}]",
                    sub_devs.join(", "),
                    ext_desc
                );
            } else if sub_uses && !ext_uses {
                action = FilterAction::Block;
                reason = format!(
                    "Gefiltert: Rein interne Linien-Kommunikation auf [{}] (schont Hauptlinie)",
                    sub_devs.join(", ")
                );
            } else if !sub_uses && ext_uses {
                action = FilterAction::Block;
                reason = "Gefiltert: Kein Gerät auf dieser Sublinie benötigt diese Gruppenadresse".to_string();
            } else {
                action = FilterAction::Block;
                reason = "Gefiltert: Gruppenadresse im Projekt ungenutzt".to_string();
            }

            if action == FilterAction::Forward {
                forwarded_count += 1;
                // Set bit in 8192-byte bitmap
                // 16-bit GA = (main << 11) | (middle << 8) | sub
                let ga_num = ((ga.main as u16) << 11) | ((ga.middle as u16) << 8) | (ga.sub as u16);
                let byte_idx = (ga_num / 8) as usize;
                let bit_idx = (ga_num % 8) as usize;
                if byte_idx < 8192 {
                    bitmap[byte_idx] |= 1 << bit_idx;
                }
            } else {
                filtered_count += 1;
            }

            entries.push(FilterTableEntry {
                ga_address: ga.address.clone(),
                ga_name: ga.name.clone(),
                dpt: ga.dpt.clone(),
                action,
                reason,
                subline_devices: sub_devs,
                extline_devices: ext_devs,
            });
        }

        // Sort entries: Forwarded first, then by GA address
        entries.sort_by(|a, b| {
            if a.action != b.action {
                match a.action {
                    FilterAction::Forward => std::cmp::Ordering::Less,
                    FilterAction::Block => std::cmp::Ordering::Greater,
                }
            } else {
                // Natural GA sort
                let a_parts: Vec<u16> = a.ga_address.split('/').filter_map(|s| s.parse().ok()).collect();
                let b_parts: Vec<u16> = b.ga_address.split('/').filter_map(|s| s.parse().ok()).collect();
                a_parts.cmp(&b_parts)
            }
        });

        // Hex string of bitmap
        let raw_bitmap_hex = hex::encode(&bitmap);

        let coupler_device_addr = line.coupler_device_id.and_then(|cid| {
            project.devices.iter().find(|d| d.id == cid).map(|d| d.individual_address.clone())
        }).or_else(|| Some(coupler_addr_str));

        Ok(FilterTableSummary {
            line_address: line.address.clone(),
            line_name: line.name.clone(),
            coupler_address: coupler_device_addr,
            filter_mode: line.coupler_filter_mode,
            total_gas: project.group_addresses.len(),
            forwarded_count,
            filtered_count,
            entries,
            raw_bitmap_hex,
        })
    }

    /// Validates the topology and flags address collisions, wrong line placement, etc.
    pub fn validate_topology(project: &Project) -> Vec<TopologyValidationIssue> {
        let mut issues = Vec::new();
        let mut seen_addresses: HashMap<String, Uuid> = HashMap::new();

        let topo = match &project.topology {
            Some(t) => t,
            None => return issues,
        };

        let valid_line_addresses: HashSet<String> = topo
            .areas
            .iter()
            .flat_map(|a| a.lines.iter().map(|l| l.address.clone()))
            .collect();

        for dev in &project.devices {
            // 1. Collision check
            if let Some(other_id) = seen_addresses.get(&dev.individual_address) {
                issues.push(TopologyValidationIssue {
                    severity: "error".to_string(),
                    message: format!(
                        "Adress-Kollision: Die physikalische Adresse '{}' ist doppelt vergeben (Geräte {} und {}).",
                        dev.individual_address, dev.name, other_id
                    ),
                    device_id: Some(dev.id),
                    device_address: Some(dev.individual_address.clone()),
                    line_address: None,
                });
            } else {
                seen_addresses.insert(dev.individual_address.clone(), dev.id);
            }

            // 2. Line check
            let parts: Vec<&str> = dev.individual_address.split('.').collect();
            if parts.len() == 3 {
                let dev_line = format!("{}.{}", parts[0], parts[1]);
                if !valid_line_addresses.contains(&dev_line) {
                    issues.push(TopologyValidationIssue {
                        severity: "warning".to_string(),
                        message: format!(
                            "Gerät '{}' ({}) liegt auf einer Linie ({}), die in der Topologie nicht existiert.",
                            dev.name, dev.individual_address, dev_line
                        ),
                        device_id: Some(dev.id),
                        device_address: Some(dev.individual_address.clone()),
                        line_address: Some(dev_line),
                    });
                }
            } else {
                issues.push(TopologyValidationIssue {
                    severity: "error".to_string(),
                    message: format!(
                        "Ungültiges Adressformat: '{}' bei Gerät '{}' (erwartet: Bereich.Linie.Teilnehmer, z.B. 1.1.5).",
                        dev.individual_address, dev.name
                    ),
                    device_id: Some(dev.id),
                    device_address: Some(dev.individual_address.clone()),
                    line_address: None,
                });
            }
        }

        issues
    }

    /// Suggests the next available individual address on a given line (e.g. "1.1.17")
    pub fn suggest_next_address(project: &Project, line_address: &str) -> String {
        let prefix = format!("{}.", line_address);
        let used_device_nums: HashSet<u16> = project
            .devices
            .iter()
            .filter(|d| d.individual_address.starts_with(&prefix))
            .filter_map(|d| {
                let parts: Vec<&str> = d.individual_address.split('.').collect();
                if parts.len() == 3 {
                    parts[2].parse::<u16>().ok()
                } else {
                    None
                }
            })
            .collect();

        // 1 to 255
        for dev_num in 1..=255 {
            if !used_device_nums.contains(&dev_num) {
                return format!("{}.{}", line_address, dev_num);
            }
        }

        format!("{}.255", line_address)
    }

    /// Moves a device to a new line and reassigns its individual address automatically
    pub fn move_device_to_line(
        project: &mut Project,
        device_id: Uuid,
        target_line_address: &str,
    ) -> Result<String, String> {
        let new_addr = Self::suggest_next_address(project, target_line_address);

        let dev = project
            .devices
            .iter_mut()
            .find(|d| d.id == device_id)
            .ok_or_else(|| "Gerät nicht gefunden".to_string())?;

        let old_addr = dev.individual_address.clone();
        dev.individual_address = new_addr.clone();

        info!(
            "Gerät '{}' ({}) auf Linie '{}' verschoben -> Neue Adresse: {}",
            dev.name, old_addr, target_line_address, new_addr
        );

        Ok(new_addr)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::*;

    #[test]
    fn test_topology_auto_discovery() {
        let mut project = Project {
            id: Uuid::new_v4(),
            name: "Test Projekt".to_string(),
            ga_scheme: GaScheme::TradeRoomFunction,
            buildings: vec![],
            floors: vec![],
            rooms: vec![],
            devices: vec![
                KnxDevice {
                    id: Uuid::new_v4(),
                    individual_address: "1.1.1".to_string(),
                    manufacturer: "MDT".to_string(),
                    model: "AKD".to_string(),
                    name: "Dimmaktor".to_string(),
                    room_id: None,
                    channels: vec![],
                    position: None,
                    order_number: None,
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
                },
                KnxDevice {
                    id: Uuid::new_v4(),
                    individual_address: "1.2.1".to_string(),
                    manufacturer: "MDT".to_string(),
                    model: "JAL".to_string(),
                    name: "Jalousieaktor".to_string(),
                    room_id: None,
                    channels: vec![],
                    position: None,
                    order_number: None,
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
                },
            ],
            blocks: vec![],
            connections: vec![],
            group_addresses: vec![],
            topology: None,
        };

        TopologyManager::ensure_topology(&mut project);

        let topo = project.topology.as_ref().unwrap();
        assert_eq!(topo.areas.len(), 1);
        let area1 = &topo.areas[0];
        assert_eq!(area1.area_number, 1);
        assert_eq!(area1.lines.len(), 2);
        assert_eq!(area1.lines[0].address, "1.1");
        assert_eq!(area1.lines[1].address, "1.2");
    }

    #[test]
    fn test_calculate_filter_table_routing() {
        let ga_id_shared = Uuid::new_v4();
        let ga_id_local = Uuid::new_v4();

        let mut project = Project {
            id: Uuid::new_v4(),
            name: "Test Projekt".to_string(),
            ga_scheme: GaScheme::TradeRoomFunction,
            buildings: vec![],
            floors: vec![],
            rooms: vec![],
            devices: vec![
                // Device on Line 1.1 with shared GA and local GA
                KnxDevice {
                    id: Uuid::new_v4(),
                    individual_address: "1.1.5".to_string(),
                    manufacturer: "MDT".to_string(),
                    model: "Taster".to_string(),
                    name: "Taster WZ".to_string(),
                    room_id: None,
                    channels: vec![],
                    position: None,
                    order_number: None,
                    application_program: None,
                    mask_version: None,
                    bus_current_ma: None,
                    communication_objects: vec![
                        CommunicationObject {
                            id: "ko-1".to_string(),
                            number: 1,
                            name: "Taste 1".to_string(),
                            object_text: "".to_string(),
                            function_text: "Schalten".to_string(),
                            dpt: "1.001".to_string(),
                            object_size: "1 Bit".to_string(),
                            flags: ComObjectFlags { communication: true, read: false, write: false, transmit: true, update: false },
                            group_address_ids: vec![ga_id_shared],
                            group_addresses: vec!["1/1/10".to_string()],
                        },
                        CommunicationObject {
                            id: "ko-2".to_string(),
                            number: 2,
                            name: "Taste 2".to_string(),
                            object_text: "".to_string(),
                            function_text: "Schalten".to_string(),
                            dpt: "1.001".to_string(),
                            object_size: "1 Bit".to_string(),
                            flags: ComObjectFlags { communication: true, read: false, write: false, transmit: true, update: false },
                            group_address_ids: vec![ga_id_local],
                            group_addresses: vec!["1/1/20".to_string()],
                        },
                    ],
                    parameters: vec![],
                    assign_rules: vec![],
                    visible_ko_numbers: vec![],
                    last_flashed_state: None,
                    security: None,
                    loaded_image: None,
                    checksums: None,
                },
                // Local Aktor on Line 1.1 listening to local GA
                KnxDevice {
                    id: Uuid::new_v4(),
                    individual_address: "1.1.10".to_string(),
                    manufacturer: "MDT".to_string(),
                    model: "Aktor".to_string(),
                    name: "Schaltaktor WZ".to_string(),
                    room_id: None,
                    channels: vec![],
                    position: None,
                    order_number: None,
                    application_program: None,
                    mask_version: None,
                    bus_current_ma: None,
                    communication_objects: vec![
                        CommunicationObject {
                            id: "ko-1".to_string(),
                            number: 1,
                            name: "Kanal A".to_string(),
                            object_text: "".to_string(),
                            function_text: "Schalten".to_string(),
                            dpt: "1.001".to_string(),
                            object_size: "1 Bit".to_string(),
                            flags: ComObjectFlags { communication: true, read: false, write: true, transmit: false, update: false },
                            group_address_ids: vec![ga_id_local],
                            group_addresses: vec!["1/1/20".to_string()],
                        },
                    ],
                    parameters: vec![],
                    assign_rules: vec![],
                    visible_ko_numbers: vec![],
                    last_flashed_state: None,
                    security: None,
                    loaded_image: None,
                    checksums: None,
                },
                // External Aktor on Line 1.2 listening to shared GA
                KnxDevice {
                    id: Uuid::new_v4(),
                    individual_address: "1.2.1".to_string(),
                    manufacturer: "MDT".to_string(),
                    model: "Aktor".to_string(),
                    name: "Schaltaktor Flur".to_string(),
                    room_id: None,
                    channels: vec![],
                    position: None,
                    order_number: None,
                    application_program: None,
                    mask_version: None,
                    bus_current_ma: None,
                    communication_objects: vec![
                        CommunicationObject {
                            id: "ko-1".to_string(),
                            number: 1,
                            name: "Kanal A".to_string(),
                            object_text: "".to_string(),
                            function_text: "Schalten".to_string(),
                            dpt: "1.001".to_string(),
                            object_size: "1 Bit".to_string(),
                            flags: ComObjectFlags { communication: true, read: false, write: true, transmit: false, update: false },
                            group_address_ids: vec![ga_id_shared],
                            group_addresses: vec!["1/1/10".to_string()],
                        },
                    ],
                    parameters: vec![],
                    assign_rules: vec![],
                    visible_ko_numbers: vec![],
                    last_flashed_state: None,
                    security: None,
                    loaded_image: None,
                    checksums: None,
                },
            ],
            blocks: vec![],
            connections: vec![],
            group_addresses: vec![
                GroupAddress {
                    id: ga_id_shared,
                    address: "1/1/10".to_string(),
                    main: 1,
                    middle: 1,
                    sub: 10,
                    name: "Licht Zentral Flur".to_string(),
                    dpt: "1.001".to_string(),
                    description: "".to_string(),
                    origin_block_id: None,
                    origin_pin_name: None,
                    is_custom: false,
                },
                GroupAddress {
                    id: ga_id_local,
                    address: "1/1/20".to_string(),
                    main: 1,
                    middle: 1,
                    sub: 20,
                    name: "Licht WZ Lokal".to_string(),
                    dpt: "1.001".to_string(),
                    description: "".to_string(),
                    origin_block_id: None,
                    origin_pin_name: None,
                    is_custom: false,
                },
            ],
            topology: None,
        };

        TopologyManager::ensure_topology(&mut project);
        let line_1_1_id = project.topology.as_ref().unwrap().areas[0].lines[0].id;

        let summary = TopologyManager::calculate_filter_table(&project, line_1_1_id).unwrap();
        assert_eq!(summary.forwarded_count, 1);
        assert_eq!(summary.filtered_count, 1);

        let shared_entry = summary.entries.iter().find(|e| e.ga_address == "1/1/10").unwrap();
        assert_eq!(shared_entry.action, FilterAction::Forward);

        let local_entry = summary.entries.iter().find(|e| e.ga_address == "1/1/20").unwrap();
        assert_eq!(local_entry.action, FilterAction::Block);

        // Verify hex bitmap is 8192 bytes = 16384 hex chars
        assert_eq!(summary.raw_bitmap_hex.len(), 16384);
    }
}
