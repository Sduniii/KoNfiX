use crate::model::*;
use std::collections::HashSet;
use uuid::Uuid;

pub struct AutoGaRouter;

impl AutoGaRouter {
    /// Helper to parse a "main/middle/sub" string into components
    pub fn parse_ga_str(address: &str) -> Option<(u8, u8, u8)> {
        let parts: Vec<&str> = address.trim().split('/').collect();
        if parts.len() != 3 {
            return None;
        }
        let main = parts[0].parse::<u8>().ok()?;
        let middle = parts[1].parse::<u8>().ok()?;
        let sub = parts[2].parse::<u8>().ok()?;
        if main > 31 || middle > 7 {
            return None;
        }
        Some((main, middle, sub))
    }

    /// Determines the Middle Group based on function block type
    pub fn get_middle_group(block_type: &FunctionBlockType) -> u8 {
        match block_type {
            FunctionBlockType::LightController => 1,   // 1 = Beleuchtung
            FunctionBlockType::BlindController => 2,   // 2 = Beschattung
            FunctionBlockType::ClimateController => 3, // 3 = Heizung / Klima
            FunctionBlockType::SceneController => 1,   // 1 = Lichtszenen / Beleuchtung
            FunctionBlockType::StaircaseTimer => 1,    // 1 = Treppenlicht / Beleuchtung
            FunctionBlockType::LogicGate => 4,         // 4 = Logik & Zentral
            FunctionBlockType::AstroSunProtection => 2,// 2 = Beschattung & Wetter
            FunctionBlockType::TimerScheduler => 4,    // 4 = Logik & Zentral
            FunctionBlockType::ThresholdSwitch => 4,   // 4 = Logik & Zentral
        }
    }

    /// Determines the Main Group based on floor level
    /// Level 0 (EG) -> Main 1
    /// Level 1 (OG) -> Main 2
    /// Level -1 (KG) -> Main 3
    /// Default / Global -> Main 0
    pub fn get_main_group(floor: Option<&Floor>) -> u8 {
        match floor {
            Some(f) => {
                if f.level >= 0 {
                    ((f.level as u8) + 1).min(31)
                } else {
                    ((f.level.unsigned_abs() as u8) + 2).min(31)
                }
            }
            None => 0, // Central / Global
        }
    }

    /// Finds the next free sub-group block of length `block_size` in the given `(main, middle)` segment.
    pub fn find_next_free_sub_group(
        existing_gas: &[GroupAddress],
        main: u8,
        middle: u8,
        block_size: u8,
    ) -> u8 {
        let occupied_subs: HashSet<u8> = existing_gas
            .iter()
            .filter(|ga| ga.main == main && ga.middle == middle)
            .map(|ga| ga.sub)
            .collect();

        let mut candidate_start = 10u8;
        while candidate_start <= (255 - block_size) {
            let has_collision =
                (0..block_size).any(|offset| occupied_subs.contains(&(candidate_start + offset)));
            if !has_collision {
                return candidate_start;
            }
            candidate_start += 5;
        }

        // Fallback if full
        1
    }

    /// Finds next free sub address available across multiple middle groups (for TradeFunctionDevice scheme)
    pub fn find_next_free_device_sub(
        existing_gas: &[GroupAddress],
        main: u8,
        middle_groups: &[u8],
    ) -> u8 {
        let mut candidate = 1u16;
        while candidate <= 255 {
            let sub = candidate as u8;
            let collision = middle_groups.iter().any(|&mid| {
                existing_gas
                    .iter()
                    .any(|ga| ga.main == main && ga.middle == mid && ga.sub == sub)
            });
            if !collision {
                return sub;
            }
            candidate += 1;
        }
        1
    }

    /// Helper to assign or preserve a GA for a specific block pin
    fn assign_pin_ga(
        block: &mut FunctionBlock,
        pin_id: &str,
        suffix: &str,
        dpt: DptType,
        main: u8,
        middle: u8,
        sub: u8,
        room_prefix: &str,
        allocated_gas: &mut Vec<GroupAddress>,
        custom_block_pin_map: &HashSet<(Uuid, String)>,
    ) {
        // If this pin has a locked custom GA, link and preserve it
        if custom_block_pin_map.contains(&(block.id, pin_id.to_string())) {
            if let Some(custom_ga) = allocated_gas.iter().find(|g| {
                g.origin_block_id == Some(block.id) && g.origin_pin_name.as_deref() == Some(pin_id)
            }) {
                let ga_id = custom_ga.id;
                if let Some(pin) = block.outputs.iter_mut().find(|p| p.id == pin_id) {
                    pin.group_address_id = Some(ga_id);
                } else if let Some(pin) = block.inputs.iter_mut().find(|p| p.id == pin_id) {
                    pin.group_address_id = Some(ga_id);
                }

                // Associate matching logical inputs
                if pin_id == "sw" {
                    if let Some(pin) = block.inputs.iter_mut().find(|p| p.id == "t") {
                        pin.group_address_id = Some(ga_id);
                    }
                    if let Some(pin) = block.inputs.iter_mut().find(|p| p.id == "p") {
                        pin.group_address_id = Some(ga_id);
                    }
                    if let Some(pin) = block.inputs.iter_mut().find(|p| p.id == "trig") {
                        pin.group_address_id = Some(ga_id);
                    }
                }
                if pin_id == "move" {
                    if let Some(pin) = block.inputs.iter_mut().find(|p| p.id == "up") {
                        pin.group_address_id = Some(ga_id);
                    }
                    if let Some(pin) = block.inputs.iter_mut().find(|p| p.id == "down") {
                        pin.group_address_id = Some(ga_id);
                    }
                }
            }
            return;
        }

        // Generate and link new auto-GA
        let ga_id = Uuid::new_v4();
        let ga = GroupAddress {
            id: ga_id,
            address: format!("{}/{}/{}", main, middle, sub),
            main,
            middle,
            sub,
            name: format!("{} - {}", room_prefix, suffix),
            dpt: dpt.as_str().to_string(),
            description: format!("Automatisch generiert für Baustein {}", block.name),
            origin_block_id: Some(block.id),
            origin_pin_name: Some(pin_id.to_string()),
            is_custom: false,
        };
        allocated_gas.push(ga);

        if let Some(pin) = block.outputs.iter_mut().find(|p| p.id == pin_id) {
            pin.group_address_id = Some(ga_id);
        } else if let Some(pin) = block.inputs.iter_mut().find(|p| p.id == pin_id) {
            pin.group_address_id = Some(ga_id);
        }

        if pin_id == "sw" {
            if let Some(pin) = block.inputs.iter_mut().find(|p| p.id == "t") {
                pin.group_address_id = Some(ga_id);
            }
            if let Some(pin) = block.inputs.iter_mut().find(|p| p.id == "p") {
                pin.group_address_id = Some(ga_id);
            }
            if let Some(pin) = block.inputs.iter_mut().find(|p| p.id == "trig") {
                pin.group_address_id = Some(ga_id);
            }
        }
        if pin_id == "move" {
            if let Some(pin) = block.inputs.iter_mut().find(|p| p.id == "up") {
                pin.group_address_id = Some(ga_id);
            }
            if let Some(pin) = block.inputs.iter_mut().find(|p| p.id == "down") {
                pin.group_address_id = Some(ga_id);
            }
        }
    }

    /// Automatically generates and links all necessary KNX Group Addresses for all blocks in the project
    pub fn route_project(project: &mut Project) {
        let scheme = project.ga_scheme;

        // 1. Preserve custom/locked GAs and manual unattached GAs
        let mut allocated_gas: Vec<GroupAddress> = Vec::new();
        let mut custom_block_pin_map: HashSet<(Uuid, String)> = HashSet::new();

        for ga in &project.group_addresses {
            if ga.is_custom || ga.origin_block_id.is_none() {
                allocated_gas.push(ga.clone());
                if let (Some(b_id), Some(pin)) = (ga.origin_block_id, &ga.origin_pin_name) {
                    custom_block_pin_map.insert((b_id, pin.clone()));
                }
            }
        }

        let all_rooms = project.rooms.clone();
        let all_floors = project.floors.clone();

        for block in &mut project.blocks {
            let room = block.room_id.and_then(|r_id| all_rooms.iter().find(|r| r.id == r_id));
            let floor = room.and_then(|r| all_floors.iter().find(|f| f.id == r.floor_id));

            let room_prefix = match (floor, room) {
                (Some(f), Some(r)) => format!("{}.{} - {}", f.name, r.name, block.name),
                (None, Some(r)) => format!("{} - {}", r.name, block.name),
                _ => block.name.clone(),
            };

            let room_idx = room
                .and_then(|r| all_rooms.iter().position(|x| x.id == r.id))
                .map(|i| ((i as u8) + 1).min(7))
                .unwrap_or(0);

            match block.block_type {
                FunctionBlockType::LightController => {
                    let specs = [
                        ("sw", "Schalten", DptType::Dpt1_001),
                        ("dim", "Dimmen relativ", DptType::Dpt3_007),
                        ("val", "Dimmwert absolut", DptType::Dpt5_001),
                        ("stat_sw", "Status Schalten", DptType::Dpt1_001),
                        ("stat_val", "Status Dimmwert", DptType::Dpt5_001),
                    ];

                    match scheme {
                        GaScheme::FloorTradeFunction => {
                            let main = Self::get_main_group(floor);
                            let middle = Self::get_middle_group(&block.block_type);
                            let start_sub =
                                Self::find_next_free_sub_group(&allocated_gas, main, middle, 5);

                            for (i, (pin_id, suffix, dpt)) in specs.iter().enumerate() {
                                Self::assign_pin_ga(
                                    block,
                                    pin_id,
                                    suffix,
                                    dpt.clone(),
                                    main,
                                    middle,
                                    start_sub + (i as u8),
                                    &room_prefix,
                                    &mut allocated_gas,
                                    &custom_block_pin_map,
                                );
                            }
                        }
                        GaScheme::TradeRoomFunction => {
                            let main = Self::get_middle_group(&block.block_type); // 1 = Beleuchtung
                            let middle = room_idx; // 1..7 (Raum)
                            let start_sub =
                                Self::find_next_free_sub_group(&allocated_gas, main, middle, 5);

                            for (i, (pin_id, suffix, dpt)) in specs.iter().enumerate() {
                                Self::assign_pin_ga(
                                    block,
                                    pin_id,
                                    suffix,
                                    dpt.clone(),
                                    main,
                                    middle,
                                    start_sub + (i as u8),
                                    &room_prefix,
                                    &mut allocated_gas,
                                    &custom_block_pin_map,
                                );
                            }
                        }
                        GaScheme::TradeFunctionDevice => {
                            let main = 1u8; // Beleuchtung
                            let middle_groups = [1u8, 2, 3, 4, 5];
                            let sub =
                                Self::find_next_free_device_sub(&allocated_gas, main, &middle_groups);

                            for (i, (pin_id, suffix, dpt)) in specs.iter().enumerate() {
                                let mid = middle_groups[i];
                                Self::assign_pin_ga(
                                    block,
                                    pin_id,
                                    suffix,
                                    dpt.clone(),
                                    main,
                                    mid,
                                    sub,
                                    &room_prefix,
                                    &mut allocated_gas,
                                    &custom_block_pin_map,
                                );
                            }
                        }
                    }
                }
                FunctionBlockType::BlindController => {
                    let specs = [
                        ("move", "Auf/Ab", DptType::Dpt1_008),
                        ("step_stop", "Lamelle/Stop", DptType::Dpt1_010),
                        ("pos", "Position absolut", DptType::Dpt5_001),
                        ("slat", "Lamellenposition", DptType::Dpt5_001),
                        ("stat_pos", "Status Position", DptType::Dpt5_001),
                    ];

                    match scheme {
                        GaScheme::FloorTradeFunction => {
                            let main = Self::get_main_group(floor);
                            let middle = Self::get_middle_group(&block.block_type);
                            let start_sub =
                                Self::find_next_free_sub_group(&allocated_gas, main, middle, 5);

                            for (i, (pin_id, suffix, dpt)) in specs.iter().enumerate() {
                                Self::assign_pin_ga(
                                    block,
                                    pin_id,
                                    suffix,
                                    dpt.clone(),
                                    main,
                                    middle,
                                    start_sub + (i as u8),
                                    &room_prefix,
                                    &mut allocated_gas,
                                    &custom_block_pin_map,
                                );
                            }
                        }
                        GaScheme::TradeRoomFunction => {
                            let main = Self::get_middle_group(&block.block_type); // 2 = Beschattung
                            let middle = room_idx;
                            let start_sub =
                                Self::find_next_free_sub_group(&allocated_gas, main, middle, 5);

                            for (i, (pin_id, suffix, dpt)) in specs.iter().enumerate() {
                                Self::assign_pin_ga(
                                    block,
                                    pin_id,
                                    suffix,
                                    dpt.clone(),
                                    main,
                                    middle,
                                    start_sub + (i as u8),
                                    &room_prefix,
                                    &mut allocated_gas,
                                    &custom_block_pin_map,
                                );
                            }
                        }
                        GaScheme::TradeFunctionDevice => {
                            let main = 2u8; // Beschattung
                            let middle_groups = [1u8, 2, 3, 4, 5];
                            let sub =
                                Self::find_next_free_device_sub(&allocated_gas, main, &middle_groups);

                            for (i, (pin_id, suffix, dpt)) in specs.iter().enumerate() {
                                let mid = middle_groups[i];
                                Self::assign_pin_ga(
                                    block,
                                    pin_id,
                                    suffix,
                                    dpt.clone(),
                                    main,
                                    mid,
                                    sub,
                                    &room_prefix,
                                    &mut allocated_gas,
                                    &custom_block_pin_map,
                                );
                            }
                        }
                    }
                }
                FunctionBlockType::ClimateController => {
                    let specs = [
                        ("t_act", "Ist-Temperatur", DptType::Dpt9_001),
                        ("t_set", "Soll-Temperatur", DptType::Dpt9_001),
                        ("heat_val", "Stellgröße Heizen", DptType::Dpt5_001),
                        ("mode", "HVAC Modus", DptType::Dpt20_102),
                    ];

                    match scheme {
                        GaScheme::FloorTradeFunction => {
                            let main = Self::get_main_group(floor);
                            let middle = Self::get_middle_group(&block.block_type);
                            let start_sub =
                                Self::find_next_free_sub_group(&allocated_gas, main, middle, 4);

                            for (i, (pin_id, suffix, dpt)) in specs.iter().enumerate() {
                                Self::assign_pin_ga(
                                    block,
                                    pin_id,
                                    suffix,
                                    dpt.clone(),
                                    main,
                                    middle,
                                    start_sub + (i as u8),
                                    &room_prefix,
                                    &mut allocated_gas,
                                    &custom_block_pin_map,
                                );
                            }
                        }
                        GaScheme::TradeRoomFunction => {
                            let main = Self::get_middle_group(&block.block_type); // 3 = Klima
                            let middle = room_idx;
                            let start_sub =
                                Self::find_next_free_sub_group(&allocated_gas, main, middle, 4);

                            for (i, (pin_id, suffix, dpt)) in specs.iter().enumerate() {
                                Self::assign_pin_ga(
                                    block,
                                    pin_id,
                                    suffix,
                                    dpt.clone(),
                                    main,
                                    middle,
                                    start_sub + (i as u8),
                                    &room_prefix,
                                    &mut allocated_gas,
                                    &custom_block_pin_map,
                                );
                            }
                        }
                        GaScheme::TradeFunctionDevice => {
                            let main = 3u8; // Klima
                            let middle_groups = [1u8, 2, 3, 4];
                            let sub =
                                Self::find_next_free_device_sub(&allocated_gas, main, &middle_groups);

                            for (i, (pin_id, suffix, dpt)) in specs.iter().enumerate() {
                                let mid = middle_groups[i];
                                Self::assign_pin_ga(
                                    block,
                                    pin_id,
                                    suffix,
                                    dpt.clone(),
                                    main,
                                    mid,
                                    sub,
                                    &room_prefix,
                                    &mut allocated_gas,
                                    &custom_block_pin_map,
                                );
                            }
                        }
                    }
                }
                FunctionBlockType::SceneController => {
                    let specs = [
                        ("scene_ctrl", "Szenensteuerung", DptType::Dpt18_001),
                        ("all_off", "Alles Aus", DptType::Dpt1_001),
                    ];

                    match scheme {
                        GaScheme::FloorTradeFunction => {
                            let main = Self::get_main_group(floor);
                            let middle = Self::get_middle_group(&block.block_type);
                            let start_sub =
                                Self::find_next_free_sub_group(&allocated_gas, main, middle, 2);

                            for (i, (pin_id, suffix, dpt)) in specs.iter().enumerate() {
                                Self::assign_pin_ga(
                                    block,
                                    pin_id,
                                    suffix,
                                    dpt.clone(),
                                    main,
                                    middle,
                                    start_sub + (i as u8),
                                    &room_prefix,
                                    &mut allocated_gas,
                                    &custom_block_pin_map,
                                );
                            }
                        }
                        GaScheme::TradeRoomFunction => {
                            let main = 1u8; // Lichtszenen
                            let middle = room_idx;
                            let start_sub =
                                Self::find_next_free_sub_group(&allocated_gas, main, middle, 2);

                            for (i, (pin_id, suffix, dpt)) in specs.iter().enumerate() {
                                Self::assign_pin_ga(
                                    block,
                                    pin_id,
                                    suffix,
                                    dpt.clone(),
                                    main,
                                    middle,
                                    start_sub + (i as u8),
                                    &room_prefix,
                                    &mut allocated_gas,
                                    &custom_block_pin_map,
                                );
                            }
                        }
                        GaScheme::TradeFunctionDevice => {
                            let main = 1u8;
                            let mid = 6u8; // Szenen
                            let sub = Self::find_next_free_device_sub(&allocated_gas, main, &[mid]);

                            for (pin_id, suffix, dpt) in specs {
                                Self::assign_pin_ga(
                                    block,
                                    pin_id,
                                    suffix,
                                    dpt,
                                    main,
                                    mid,
                                    sub,
                                    &room_prefix,
                                    &mut allocated_gas,
                                    &custom_block_pin_map,
                                );
                            }
                        }
                    }
                }
                FunctionBlockType::StaircaseTimer => {
                    let specs = [
                        ("sw", "Schalten", DptType::Dpt1_001),
                        ("stat_sw", "Status", DptType::Dpt1_001),
                    ];

                    match scheme {
                        GaScheme::FloorTradeFunction => {
                            let main = Self::get_main_group(floor);
                            let middle = Self::get_middle_group(&block.block_type);
                            let start_sub =
                                Self::find_next_free_sub_group(&allocated_gas, main, middle, 2);

                            for (i, (pin_id, suffix, dpt)) in specs.iter().enumerate() {
                                Self::assign_pin_ga(
                                    block,
                                    pin_id,
                                    suffix,
                                    dpt.clone(),
                                    main,
                                    middle,
                                    start_sub + (i as u8),
                                    &room_prefix,
                                    &mut allocated_gas,
                                    &custom_block_pin_map,
                                );
                            }
                        }
                        GaScheme::TradeRoomFunction => {
                            let main = 1u8; // Beleuchtung
                            let middle = room_idx;
                            let start_sub =
                                Self::find_next_free_sub_group(&allocated_gas, main, middle, 2);

                            for (i, (pin_id, suffix, dpt)) in specs.iter().enumerate() {
                                Self::assign_pin_ga(
                                    block,
                                    pin_id,
                                    suffix,
                                    dpt.clone(),
                                    main,
                                    middle,
                                    start_sub + (i as u8),
                                    &room_prefix,
                                    &mut allocated_gas,
                                    &custom_block_pin_map,
                                );
                            }
                        }
                        GaScheme::TradeFunctionDevice => {
                            let main = 1u8;
                            let middle_groups = [1u8, 4u8]; // 1 = Schalten, 4 = Status
                            let sub =
                                Self::find_next_free_device_sub(&allocated_gas, main, &middle_groups);

                            for (i, (pin_id, suffix, dpt)) in specs.iter().enumerate() {
                                let mid = middle_groups[i];
                                Self::assign_pin_ga(
                                    block,
                                    pin_id,
                                    suffix,
                                    dpt.clone(),
                                    main,
                                    mid,
                                    sub,
                                    &room_prefix,
                                    &mut allocated_gas,
                                    &custom_block_pin_map,
                                );
                            }
                        }
                    }
                }
                FunctionBlockType::LogicGate => {
                    let specs = [("out", "Ausgang", DptType::Dpt1_001)];

                    match scheme {
                        GaScheme::FloorTradeFunction => {
                            let main = Self::get_main_group(floor);
                            let middle = Self::get_middle_group(&block.block_type);
                            let start_sub =
                                Self::find_next_free_sub_group(&allocated_gas, main, middle, 1);

                            for (pin_id, suffix, dpt) in specs {
                                Self::assign_pin_ga(
                                    block,
                                    pin_id,
                                    suffix,
                                    dpt,
                                    main,
                                    middle,
                                    start_sub,
                                    &room_prefix,
                                    &mut allocated_gas,
                                    &custom_block_pin_map,
                                );
                            }
                        }
                        GaScheme::TradeRoomFunction => {
                            let main = 4u8; // Logik
                            let middle = room_idx;
                            let start_sub =
                                Self::find_next_free_sub_group(&allocated_gas, main, middle, 1);

                            for (pin_id, suffix, dpt) in specs {
                                Self::assign_pin_ga(
                                    block,
                                    pin_id,
                                    suffix,
                                    dpt,
                                    main,
                                    middle,
                                    start_sub,
                                    &room_prefix,
                                    &mut allocated_gas,
                                    &custom_block_pin_map,
                                );
                            }
                        }
                        GaScheme::TradeFunctionDevice => {
                            let main = 4u8;
                            let mid = 1u8;
                            let sub = Self::find_next_free_device_sub(&allocated_gas, main, &[mid]);

                            for (pin_id, suffix, dpt) in specs {
                                Self::assign_pin_ga(
                                    block,
                                    pin_id,
                                    suffix,
                                    dpt,
                                    main,
                                    mid,
                                    sub,
                                    &room_prefix,
                                    &mut allocated_gas,
                                    &custom_block_pin_map,
                                );
                            }
                        }
                    }
                }
                FunctionBlockType::AstroSunProtection => {
                    let specs = [
                        ("wind_alarm", "Windalarm", DptType::Dpt1_005),
                        ("sun_active", "Sonnenschutz aktiv", DptType::Dpt1_001),
                        ("target_pos", "Sonnenschutz Position", DptType::Dpt5_001),
                        ("target_blade", "Sonnenschutz Lamelle", DptType::Dpt5_001),
                    ];
                    let main = 2u8; // Beschattung
                    let mid = 4u8;  // Automatik
                    let start_sub = Self::find_next_free_sub_group(&allocated_gas, main, mid, specs.len() as u8);
                    for (i, (pin_id, suffix, dpt)) in specs.iter().enumerate() {
                        Self::assign_pin_ga(
                            block,
                            pin_id,
                            suffix,
                            dpt.clone(),
                            main,
                            mid,
                            start_sub + (i as u8),
                            &room_prefix,
                            &mut allocated_gas,
                            &custom_block_pin_map,
                        );
                    }
                }
                FunctionBlockType::TimerScheduler => {
                    let specs = [("out", "Schaltbefehl Zeitschaltuhr", DptType::Dpt1_001)];
                    let main = 4u8;
                    let mid = 2u8;
                    let start_sub = Self::find_next_free_sub_group(&allocated_gas, main, mid, specs.len() as u8);
                    for (i, (pin_id, suffix, dpt)) in specs.iter().enumerate() {
                        Self::assign_pin_ga(
                            block,
                            pin_id,
                            suffix,
                            dpt.clone(),
                            main,
                            mid,
                            start_sub + (i as u8),
                            &room_prefix,
                            &mut allocated_gas,
                            &custom_block_pin_map,
                        );
                    }
                }
                FunctionBlockType::ThresholdSwitch => {
                    let specs = [("out", "Schaltausgang Schwellwert", DptType::Dpt1_001)];
                    let main = 4u8;
                    let mid = 3u8;
                    let start_sub = Self::find_next_free_sub_group(&allocated_gas, main, mid, specs.len() as u8);
                    for (i, (pin_id, suffix, dpt)) in specs.iter().enumerate() {
                        Self::assign_pin_ga(
                            block,
                            pin_id,
                            suffix,
                            dpt.clone(),
                            main,
                            mid,
                            start_sub + (i as u8),
                            &room_prefix,
                            &mut allocated_gas,
                            &custom_block_pin_map,
                        );
                    }
                }
            }
        }

        project.group_addresses = allocated_gas;
    }

    /// Connects two pins (Device KO to Device KO, Device KO to FunctionBlock, Block to Block),
    /// generates/links a matching KNX Group Address automatically if needed, and records the WireConnection.
    pub fn connect_endpoints(
        project: &mut Project,
        from_node_id: Uuid,
        from_pin: &str,
        to_node_id: Uuid,
        to_pin: &str,
        conn_id: Option<Uuid>,
    ) -> (WireConnection, Option<GroupAddress>) {
        // Prevent duplicate connections
        let existing = project.connections.iter().find(|c| {
            c.from_node_id == from_node_id
                && c.from_pin == from_pin
                && c.to_node_id == to_node_id
                && c.to_pin == to_pin
        });
        if let Some(c) = existing {
            let ga = Self::resolve_ga_for_endpoints(project, from_node_id, from_pin, to_node_id, to_pin);
            return (c.clone(), ga);
        }

        let is_from_dev = project.devices.iter().any(|d| d.id == from_node_id);
        let is_to_dev = project.devices.iter().any(|d| d.id == to_node_id);
        let is_from_block = project.blocks.iter().any(|b| b.id == from_node_id);
        let is_to_block = project.blocks.iter().any(|b| b.id == to_node_id);

        let mut matched_ga: Option<GroupAddress> = None;

        let parse_ko_num = |pin: &str| -> Option<u32> {
            if let Some(rest) = pin.strip_prefix("ko-") {
                rest.parse::<u32>().ok()
            } else {
                pin.parse::<u32>().ok()
            }
        };

        if is_from_dev && is_to_dev {
            let from_ko_num = parse_ko_num(from_pin);
            let to_ko_num = parse_ko_num(to_pin);

            if let (Some(f_num), Some(t_num)) = (from_ko_num, to_ko_num) {
                let from_ga_addr = project.devices.iter()
                    .find(|d| d.id == from_node_id)
                    .and_then(|d| d.communication_objects.iter().find(|k| k.number == f_num))
                    .and_then(|k| k.group_addresses.first().cloned());

                let to_ga_addr = project.devices.iter()
                    .find(|d| d.id == to_node_id)
                    .and_then(|d| d.communication_objects.iter().find(|k| k.number == t_num))
                    .and_then(|k| k.group_addresses.first().cloned());

                if let Some(addr) = from_ga_addr {
                    if let Some(ga) = project.group_addresses.iter().find(|g| g.address == addr).cloned() {
                        let ga_id = ga.id;
                        if let Some(to_dev) = project.devices.iter_mut().find(|d| d.id == to_node_id) {
                            if let Some(ko) = to_dev.communication_objects.iter_mut().find(|k| k.number == t_num) {
                                if !ko.group_addresses.contains(&addr) {
                                    ko.group_addresses.push(addr.clone());
                                }
                                if !ko.group_address_ids.contains(&ga_id) {
                                    ko.group_address_ids.push(ga_id);
                                }
                            }
                        }
                        matched_ga = Some(ga);
                    }
                } else if let Some(addr) = to_ga_addr {
                    if let Some(ga) = project.group_addresses.iter().find(|g| g.address == addr).cloned() {
                        let ga_id = ga.id;
                        if let Some(from_dev) = project.devices.iter_mut().find(|d| d.id == from_node_id) {
                            if let Some(ko) = from_dev.communication_objects.iter_mut().find(|k| k.number == f_num) {
                                if !ko.group_addresses.contains(&addr) {
                                    ko.group_addresses.push(addr.clone());
                                }
                                if !ko.group_address_ids.contains(&ga_id) {
                                    ko.group_address_ids.push(ga_id);
                                }
                            }
                        }
                        matched_ga = Some(ga);
                    }
                } else {
                    let from_dev_info = project.devices.iter().find(|d| d.id == from_node_id).map(|d| {
                        let ko = d.communication_objects.iter().find(|k| k.number == f_num);
                        (d.name.clone(), d.room_id, ko.map(|k| (k.object_text.clone(), k.function_text.clone(), k.dpt.clone())))
                    });

                    let to_dev_info = project.devices.iter().find(|d| d.id == to_node_id).map(|d| {
                        let ko = d.communication_objects.iter().find(|k| k.number == t_num);
                        (d.name.clone(), d.room_id, ko.map(|k| (k.object_text.clone(), k.function_text.clone(), k.dpt.clone())))
                    });

                    let dpt_str = from_dev_info.as_ref()
                        .and_then(|(_, _, ko)| ko.as_ref().map(|(_, _, d)| d.clone()))
                        .filter(|d| !d.is_empty())
                        .or_else(|| to_dev_info.as_ref().and_then(|(_, _, ko)| ko.as_ref().map(|(_, _, d)| d.clone())))
                        .unwrap_or_else(|| "1.001".to_string());

                    let func_name = from_dev_info.as_ref()
                        .and_then(|(_, _, ko)| ko.as_ref().map(|(_, f, _)| f.clone()))
                        .filter(|f| !f.is_empty())
                        .or_else(|| to_dev_info.as_ref().and_then(|(_, _, ko)| ko.as_ref().map(|(_, f, _)| f.clone())))
                        .unwrap_or_else(|| "Schalten".to_string());

                    let middle = if func_name.contains("Jalousie") || func_name.contains("Auf/Ab") || func_name.contains("Lamelle") {
                        2
                    } else if func_name.contains("Temperatur") || func_name.contains("Heizung") || dpt_str.starts_with("9.") {
                        3
                    } else {
                        1
                    };

                    let room_id_opt = from_dev_info.as_ref().and_then(|(_, r, _)| *r)
                        .or_else(|| to_dev_info.as_ref().and_then(|(_, r, _)| *r));
                    let floor = room_id_opt.and_then(|r_id| project.rooms.iter().find(|r| r.id == r_id))
                        .and_then(|room| project.floors.iter().find(|f| f.id == room.floor_id));
                    let main = Self::get_main_group(floor);

                    let sub = Self::find_next_free_sub_group(&project.group_addresses, main, middle, 1);
                    let addr = format!("{}/{}/{}", main, middle, sub);
                    let from_name = from_dev_info.map(|(n, _, _)| n).unwrap_or_default();
                    let to_name = to_dev_info.map(|(n, _, _)| n).unwrap_or_default();

                    let ga_id = Uuid::new_v4();
                    let new_ga = GroupAddress {
                        id: ga_id,
                        address: addr.clone(),
                        main,
                        middle,
                        sub,
                        name: format!("{} / {}", from_name, func_name),
                        dpt: dpt_str,
                        description: format!("Automatische Verbindung: {} ➔ {}", from_name, to_name),
                        origin_block_id: None,
                        origin_pin_name: None,
                        is_custom: false,
                    };

                    project.group_addresses.push(new_ga.clone());

                    if let Some(from_dev) = project.devices.iter_mut().find(|d| d.id == from_node_id) {
                        if let Some(ko) = from_dev.communication_objects.iter_mut().find(|k| k.number == f_num) {
                            ko.group_addresses.push(addr.clone());
                            ko.group_address_ids.push(ga_id);
                        }
                    }
                    if let Some(to_dev) = project.devices.iter_mut().find(|d| d.id == to_node_id) {
                        if let Some(ko) = to_dev.communication_objects.iter_mut().find(|k| k.number == t_num) {
                            ko.group_addresses.push(addr);
                            ko.group_address_ids.push(ga_id);
                        }
                    }

                    matched_ga = Some(new_ga);
                }
            }
        } else if is_from_dev && is_to_block {
            let from_ko_num = parse_ko_num(from_pin);
            if let Some(f_num) = from_ko_num {
                let target_ga = project.blocks.iter()
                    .find(|b| b.id == to_node_id)
                    .and_then(|b| b.inputs.iter().find(|p| p.id == to_pin).or_else(|| b.outputs.iter().find(|p| p.id == to_pin)))
                    .and_then(|p| p.group_address_id)
                    .and_then(|ga_id| project.group_addresses.iter().find(|g| g.id == ga_id).cloned())
                    .or_else(|| {
                        project.group_addresses.iter().find(|g| g.origin_block_id == Some(to_node_id) && g.origin_pin_name.as_deref() == Some(to_pin)).cloned()
                    });

                if let Some(ga) = target_ga {
                    let ga_id = ga.id;
                    let addr = ga.address.clone();
                    if let Some(from_dev) = project.devices.iter_mut().find(|d| d.id == from_node_id) {
                        if let Some(ko) = from_dev.communication_objects.iter_mut().find(|k| k.number == f_num) {
                            if !ko.group_addresses.contains(&addr) {
                                ko.group_addresses.push(addr);
                            }
                            if !ko.group_address_ids.contains(&ga_id) {
                                ko.group_address_ids.push(ga_id);
                            }
                        }
                    }
                    matched_ga = Some(ga);
                }
            }
        } else if is_from_block && is_to_dev {
            let to_ko_num = parse_ko_num(to_pin);
            if let Some(t_num) = to_ko_num {
                let source_ga = project.blocks.iter()
                    .find(|b| b.id == from_node_id)
                    .and_then(|b| b.outputs.iter().find(|p| p.id == from_pin).or_else(|| b.inputs.iter().find(|p| p.id == from_pin)))
                    .and_then(|p| p.group_address_id)
                    .and_then(|ga_id| project.group_addresses.iter().find(|g| g.id == ga_id).cloned())
                    .or_else(|| {
                        project.group_addresses.iter().find(|g| g.origin_block_id == Some(from_node_id) && g.origin_pin_name.as_deref() == Some(from_pin)).cloned()
                    });

                if let Some(ga) = source_ga {
                    let ga_id = ga.id;
                    let addr = ga.address.clone();
                    if let Some(to_dev) = project.devices.iter_mut().find(|d| d.id == to_node_id) {
                        if let Some(ko) = to_dev.communication_objects.iter_mut().find(|k| k.number == t_num) {
                            if !ko.group_addresses.contains(&addr) {
                                ko.group_addresses.push(addr);
                            }
                            if !ko.group_address_ids.contains(&ga_id) {
                                ko.group_address_ids.push(ga_id);
                            }
                        }
                    }
                    matched_ga = Some(ga);
                }
            }
        } else if is_from_block && is_to_block {
            let source_ga = project.blocks.iter()
                .find(|b| b.id == from_node_id)
                .and_then(|b| b.outputs.iter().find(|p| p.id == from_pin))
                .and_then(|p| p.group_address_id)
                .and_then(|ga_id| project.group_addresses.iter().find(|g| g.id == ga_id).cloned());

            if let Some(ga) = source_ga {
                let ga_id = ga.id;
                if let Some(to_b) = project.blocks.iter_mut().find(|b| b.id == to_node_id) {
                    if let Some(p) = to_b.inputs.iter_mut().find(|p| p.id == to_pin) {
                        p.group_address_id = Some(ga_id);
                    }
                }
                matched_ga = Some(ga);
            }
        }

        let connection = WireConnection {
            id: conn_id.unwrap_or_else(Uuid::new_v4),
            from_node_id,
            from_pin: from_pin.to_string(),
            to_node_id,
            to_pin: to_pin.to_string(),
        };

        project.connections.push(connection.clone());

        (connection, matched_ga)
    }

    /// Helper to resolve the GroupAddress associated with two endpoints if one exists
    pub fn resolve_ga_for_endpoints(
        project: &Project,
        from_node_id: Uuid,
        from_pin: &str,
        to_node_id: Uuid,
        to_pin: &str,
    ) -> Option<GroupAddress> {
        let parse_ko_num = |pin: &str| -> Option<u32> {
            if let Some(rest) = pin.strip_prefix("ko-") {
                rest.parse::<u32>().ok()
            } else {
                pin.parse::<u32>().ok()
            }
        };

        if let Some(f_num) = parse_ko_num(from_pin) {
            if let Some(dev) = project.devices.iter().find(|d| d.id == from_node_id) {
                if let Some(ko) = dev.communication_objects.iter().find(|k| k.number == f_num) {
                    if let Some(ga_id) = ko.group_address_ids.first() {
                        if let Some(ga) = project.group_addresses.iter().find(|g| g.id == *ga_id) {
                            return Some(ga.clone());
                        }
                    }
                    if let Some(addr) = ko.group_addresses.first() {
                        if let Some(ga) = project.group_addresses.iter().find(|g| g.address == *addr) {
                            return Some(ga.clone());
                        }
                    }
                }
            }
        }

        if let Some(t_num) = parse_ko_num(to_pin) {
            if let Some(dev) = project.devices.iter().find(|d| d.id == to_node_id) {
                if let Some(ko) = dev.communication_objects.iter().find(|k| k.number == t_num) {
                    if let Some(ga_id) = ko.group_address_ids.first() {
                        if let Some(ga) = project.group_addresses.iter().find(|g| g.id == *ga_id) {
                            return Some(ga.clone());
                        }
                    }
                    if let Some(addr) = ko.group_addresses.first() {
                        if let Some(ga) = project.group_addresses.iter().find(|g| g.address == *addr) {
                            return Some(ga.clone());
                        }
                    }
                }
            }
        }

        if let Some(b) = project.blocks.iter().find(|b| b.id == from_node_id) {
            if let Some(ga) = project.group_addresses.iter().find(|g| g.origin_block_id == Some(b.id) && g.origin_pin_name.as_deref() == Some(from_pin)) {
                return Some(ga.clone());
            }
        }
        if let Some(b) = project.blocks.iter().find(|b| b.id == to_node_id) {
            if let Some(ga) = project.group_addresses.iter().find(|g| g.origin_block_id == Some(b.id) && g.origin_pin_name.as_deref() == Some(to_pin)) {
                return Some(ga.clone());
            }
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_auto_ga_allocation_light() {
        let floor_id = Uuid::new_v4();
        let room_id = Uuid::new_v4();

        let floor = Floor {
            id: floor_id,
            building_id: Uuid::new_v4(),
            name: "EG".to_string(),
            level: 0,
        };

        let room = Room {
            id: room_id,
            floor_id,
            name: "Wohnzimmer".to_string(),
            icon: "sofa".to_string(),
        };

        let block = FunctionBlock {
            id: Uuid::new_v4(),
            name: "Deckenlampe".to_string(),
            block_type: FunctionBlockType::LightController,
            room_id: Some(room_id),
            position: Position { x: 100.0, y: 100.0 },
            inputs: vec![BlockPin {
                id: "sw".to_string(),
                name: "Schalten".to_string(),
                description: "Ein/Aus".to_string(),
                dpt: DptType::Dpt1_001,
                direction: PinDirection::Input,
                group_address_id: None,
            }],
            outputs: vec![
                BlockPin {
                    id: "dim".to_string(),
                    name: "Dimmen".to_string(),
                    description: "Relativ".to_string(),
                    dpt: DptType::Dpt3_007,
                    direction: PinDirection::Output,
                    group_address_id: None,
                },
                BlockPin {
                    id: "val".to_string(),
                    name: "Dimmwert".to_string(),
                    description: "0..100%".to_string(),
                    dpt: DptType::Dpt5_001,
                    direction: PinDirection::Output,
                    group_address_id: None,
                },
                BlockPin {
                    id: "stat_sw".to_string(),
                    name: "Status Schalten".to_string(),
                    description: "Status".to_string(),
                    dpt: DptType::Dpt1_001,
                    direction: PinDirection::Output,
                    group_address_id: None,
                },
                BlockPin {
                    id: "stat_val".to_string(),
                    name: "Status Dimmwert".to_string(),
                    description: "Status Wert".to_string(),
                    dpt: DptType::Dpt5_001,
                    direction: PinDirection::Output,
                    group_address_id: None,
                },
            ],
            parameters: serde_json::json!({}),
            state: serde_json::json!({}),
        };

        let mut project = Project {
            id: Uuid::new_v4(),
            name: "Test Projekt".to_string(),
            ga_scheme: GaScheme::FloorTradeFunction,
            buildings: vec![],
            floors: vec![floor],
            rooms: vec![room],
            devices: vec![],
            blocks: vec![block],
            connections: vec![],
            group_addresses: vec![],
            topology: None,
        };

        AutoGaRouter::route_project(&mut project);

        assert_eq!(project.group_addresses.len(), 5);
        assert_eq!(project.group_addresses[0].address, "1/1/10");
        assert_eq!(project.group_addresses[0].dpt, "1.001");
        assert_eq!(project.group_addresses[1].address, "1/1/11");
        assert_eq!(project.group_addresses[1].dpt, "3.007");
        assert_eq!(project.group_addresses[2].address, "1/1/12");
        assert_eq!(project.group_addresses[2].dpt, "5.001");
    }

    #[test]
    fn test_auto_ga_allocation_scene_and_staircase() {
        let floor_id = Uuid::new_v4();
        let room_id = Uuid::new_v4();

        let floor = Floor {
            id: floor_id,
            building_id: Uuid::new_v4(),
            name: "EG".to_string(),
            level: 0,
        };

        let room = Room {
            id: room_id,
            floor_id,
            name: "Flur".to_string(),
            icon: "door".to_string(),
        };

        let scene_block = FunctionBlock {
            id: Uuid::new_v4(),
            name: "Lichtszenen".to_string(),
            block_type: FunctionBlockType::SceneController,
            room_id: Some(room_id),
            position: Position { x: 100.0, y: 100.0 },
            inputs: vec![],
            outputs: vec![BlockPin {
                id: "scene_ctrl".to_string(),
                name: "SCENE".to_string(),
                description: "Szene".to_string(),
                dpt: DptType::Dpt18_001,
                direction: PinDirection::Output,
                group_address_id: None,
            }],
            parameters: serde_json::json!({}),
            state: serde_json::json!({}),
        };

        let staircase_block = FunctionBlock {
            id: Uuid::new_v4(),
            name: "Treppenhaus".to_string(),
            block_type: FunctionBlockType::StaircaseTimer,
            room_id: Some(room_id),
            position: Position { x: 100.0, y: 300.0 },
            inputs: vec![],
            outputs: vec![
                BlockPin {
                    id: "sw".to_string(),
                    name: "SW".to_string(),
                    description: "Schalten".to_string(),
                    dpt: DptType::Dpt1_001,
                    direction: PinDirection::Output,
                    group_address_id: None,
                },
                BlockPin {
                    id: "stat_sw".to_string(),
                    name: "STAT".to_string(),
                    description: "Status".to_string(),
                    dpt: DptType::Dpt1_001,
                    direction: PinDirection::Output,
                    group_address_id: None,
                },
            ],
            parameters: serde_json::json!({ "duration_sec": 180 }),
            state: serde_json::json!({}),
        };

        let mut project = Project {
            id: Uuid::new_v4(),
            name: "Test Pfad C".to_string(),
            ga_scheme: GaScheme::FloorTradeFunction,
            buildings: vec![],
            floors: vec![floor],
            rooms: vec![room],
            devices: vec![],
            blocks: vec![scene_block, staircase_block],
            connections: vec![],
            group_addresses: vec![],
            topology: None,
        };

        AutoGaRouter::route_project(&mut project);

        assert_eq!(project.group_addresses.len(), 4);
        assert_eq!(project.group_addresses[0].address, "1/1/10");
        assert_eq!(project.group_addresses[0].dpt, "18.001");
        assert_eq!(project.group_addresses[1].address, "1/1/11");
        assert_eq!(project.group_addresses[1].dpt, "1.001");
        assert_eq!(project.group_addresses[2].address, "1/1/15");
        assert_eq!(project.group_addresses[2].dpt, "1.001");
        assert_eq!(project.group_addresses[3].address, "1/1/16");
        assert_eq!(project.group_addresses[3].dpt, "1.001");
    }

    #[test]
    fn test_trade_room_function_scheme() {
        let floor_id = Uuid::new_v4();
        let room_wz_id = Uuid::new_v4();
        let room_kueche_id = Uuid::new_v4();

        let floor = Floor {
            id: floor_id,
            building_id: Uuid::new_v4(),
            name: "EG".to_string(),
            level: 0,
        };

        let room_wz = Room {
            id: room_wz_id,
            floor_id,
            name: "Wohnzimmer".to_string(),
            icon: "sofa".to_string(),
        };

        let room_kueche = Room {
            id: room_kueche_id,
            floor_id,
            name: "Küche".to_string(),
            icon: "utensils".to_string(),
        };

        let block_wz = FunctionBlock {
            id: Uuid::new_v4(),
            name: "WZ Licht".to_string(),
            block_type: FunctionBlockType::LightController,
            room_id: Some(room_wz_id),
            position: Position { x: 100.0, y: 100.0 },
            inputs: vec![BlockPin {
                id: "sw".to_string(),
                name: "Schalten".to_string(),
                description: "Ein/Aus".to_string(),
                dpt: DptType::Dpt1_001,
                direction: PinDirection::Input,
                group_address_id: None,
            }],
            outputs: vec![],
            parameters: serde_json::json!({}),
            state: serde_json::json!({}),
        };

        let block_kueche = FunctionBlock {
            id: Uuid::new_v4(),
            name: "Küche Raffstore".to_string(),
            block_type: FunctionBlockType::BlindController,
            room_id: Some(room_kueche_id),
            position: Position { x: 100.0, y: 300.0 },
            inputs: vec![BlockPin {
                id: "move".to_string(),
                name: "Fahrt".to_string(),
                description: "Auf/Ab".to_string(),
                dpt: DptType::Dpt1_008,
                direction: PinDirection::Input,
                group_address_id: None,
            }],
            outputs: vec![],
            parameters: serde_json::json!({}),
            state: serde_json::json!({}),
        };

        let mut project = Project {
            id: Uuid::new_v4(),
            name: "Test TradeRoom".to_string(),
            ga_scheme: GaScheme::TradeRoomFunction,
            buildings: vec![],
            floors: vec![floor],
            rooms: vec![room_wz, room_kueche],
            devices: vec![],
            blocks: vec![block_wz, block_kueche],
            connections: vec![],
            group_addresses: vec![],
            topology: None,
        };

        AutoGaRouter::route_project(&mut project);

        // Light (Main 1), Wohnzimmer is Room 1 (Middle 1), starts at sub 10
        let wz_sw = project.group_addresses.iter().find(|g| g.origin_pin_name.as_deref() == Some("sw")).unwrap();
        assert_eq!(wz_sw.main, 1);
        assert_eq!(wz_sw.middle, 1);
        assert_eq!(wz_sw.sub, 10);
        assert_eq!(wz_sw.address, "1/1/10");

        // Blind (Main 2), Küche is Room 2 (Middle 2), starts at sub 10
        let k_move = project.group_addresses.iter().find(|g| g.origin_pin_name.as_deref() == Some("move")).unwrap();
        assert_eq!(k_move.main, 2);
        assert_eq!(k_move.middle, 2);
        assert_eq!(k_move.sub, 10);
        assert_eq!(k_move.address, "2/2/10");
    }

    #[test]
    fn test_custom_locked_ga_preservation() {
        let floor_id = Uuid::new_v4();
        let room_id = Uuid::new_v4();

        let floor = Floor {
            id: floor_id,
            building_id: Uuid::new_v4(),
            name: "EG".to_string(),
            level: 0,
        };

        let room = Room {
            id: room_id,
            floor_id,
            name: "Wohnzimmer".to_string(),
            icon: "sofa".to_string(),
        };

        let block_id = Uuid::new_v4();
        let custom_ga_id = Uuid::new_v4();

        // Custom locked GA for "sw" manually set to 0/1/99
        let custom_ga = GroupAddress {
            id: custom_ga_id,
            address: "0/1/99".to_string(),
            main: 0,
            middle: 1,
            sub: 99,
            name: "Altanlage WZ Licht".to_string(),
            dpt: "1.001".to_string(),
            description: "Manuell fixiert".to_string(),
            origin_block_id: Some(block_id),
            origin_pin_name: Some("sw".to_string()),
            is_custom: true,
        };

        let block = FunctionBlock {
            id: block_id,
            name: "Deckenlampe".to_string(),
            block_type: FunctionBlockType::LightController,
            room_id: Some(room_id),
            position: Position { x: 100.0, y: 100.0 },
            inputs: vec![BlockPin {
                id: "sw".to_string(),
                name: "Schalten".to_string(),
                description: "Ein/Aus".to_string(),
                dpt: DptType::Dpt1_001,
                direction: PinDirection::Input,
                group_address_id: Some(custom_ga_id),
            }],
            outputs: vec![BlockPin {
                id: "val".to_string(),
                name: "Dimmwert".to_string(),
                description: "0..100%".to_string(),
                dpt: DptType::Dpt5_001,
                direction: PinDirection::Output,
                group_address_id: None,
            }],
            parameters: serde_json::json!({}),
            state: serde_json::json!({}),
        };

        let mut project = Project {
            id: Uuid::new_v4(),
            name: "Test Custom GA".to_string(),
            ga_scheme: GaScheme::FloorTradeFunction,
            buildings: vec![],
            floors: vec![floor],
            rooms: vec![room],
            devices: vec![],
            blocks: vec![block],
            connections: vec![],
            group_addresses: vec![custom_ga],
            topology: None,
        };

        AutoGaRouter::route_project(&mut project);

        // The custom GA must be preserved exactly as "0/1/99"
        let sw_ga = project.group_addresses.iter().find(|g| g.origin_pin_name.as_deref() == Some("sw")).unwrap();
        assert_eq!(sw_ga.id, custom_ga_id);
        assert_eq!(sw_ga.address, "0/1/99");
        assert!(sw_ga.is_custom);

        // Pin on block must still be linked to custom_ga_id
        let block = &project.blocks[0];
        assert_eq!(block.inputs[0].group_address_id, Some(custom_ga_id));

        // The other pin "val" gets automatically allocated in 1/1/x
        let val_ga = project.group_addresses.iter().find(|g| g.origin_pin_name.as_deref() == Some("val")).unwrap();
        assert_eq!(val_ga.address, "1/1/12");
        assert!(!val_ga.is_custom);
    }

    #[test]
    fn test_connect_endpoints_device_ko_to_ko_auto_ga() {
        let dev1_id = Uuid::new_v4();
        let dev2_id = Uuid::new_v4();

        let ko_taster = CommunicationObject {
            id: "O-0".to_string(),
            number: 0,
            name: "Taste 1".to_string(),
            object_text: "Taste 1".to_string(),
            function_text: "Schalten".to_string(),
            dpt: "1.001".to_string(),
            object_size: "1 Bit".to_string(),
            flags: ComObjectFlags {
                communication: true,
                read: false,
                write: false,
                transmit: true,
                update: false,
            },
            group_address_ids: vec![],
            group_addresses: vec![],
        };

        let ko_actuator = CommunicationObject {
            id: "O-0".to_string(),
            number: 0,
            name: "Kanal A".to_string(),
            object_text: "Kanal A".to_string(),
            function_text: "Switch On/Off".to_string(),
            dpt: "1.001".to_string(),
            object_size: "1 Bit".to_string(),
            flags: ComObjectFlags {
                communication: true,
                read: false,
                write: true,
                transmit: false,
                update: false,
            },
            group_address_ids: vec![],
            group_addresses: vec![],
        };

        let dev1 = KnxDevice {
            id: dev1_id,
            individual_address: "1.1.5".to_string(),
            manufacturer: "MDT".to_string(),
            model: "Glastaster".to_string(),
            name: "Taster WZ".to_string(),
            room_id: None,
            channels: vec![],
            position: None,
            order_number: None,
            application_program: None,
            mask_version: None,
            bus_current_ma: None,
            communication_objects: vec![ko_taster],
            parameters: vec![],
            assign_rules: vec![],
            visible_ko_numbers: vec![],
            last_flashed_state: None,
            security: None,
            loaded_image: None,
            checksums: None,
        };

        let dev2 = KnxDevice {
            id: dev2_id,
            individual_address: "1.1.16".to_string(),
            manufacturer: "MDT".to_string(),
            model: "Schaltaktor".to_string(),
            name: "Schaltaktor 12-fach".to_string(),
            room_id: None,
            channels: vec![],
            position: None,
            order_number: None,
            application_program: None,
            mask_version: None,
            bus_current_ma: None,
            communication_objects: vec![ko_actuator],
            parameters: vec![],
            assign_rules: vec![],
            visible_ko_numbers: vec![],
            last_flashed_state: None,
            security: None,
            loaded_image: None,
            checksums: None,
        };

        let mut project = Project {
            id: Uuid::new_v4(),
            name: "Test Visual Wiring".to_string(),
            ga_scheme: GaScheme::FloorTradeFunction,
            buildings: vec![],
            floors: vec![],
            rooms: vec![],
            devices: vec![dev1, dev2],
            blocks: vec![],
            connections: vec![],
            group_addresses: vec![],
            topology: None,
        };

        // Wire Taster KO 0 to Actuator KO 0!
        let (conn, ga_opt) = AutoGaRouter::connect_endpoints(
            &mut project,
            dev1_id,
            "ko-0",
            dev2_id,
            "ko-0",
            None,
        );

        assert_eq!(conn.from_node_id, dev1_id);
        assert_eq!(conn.from_pin, "ko-0");
        assert_eq!(conn.to_node_id, dev2_id);
        assert_eq!(conn.to_pin, "ko-0");

        assert!(ga_opt.is_some());
        let ga = ga_opt.unwrap();
        assert_eq!(ga.address, "0/1/10");
        assert_eq!(ga.dpt, "1.001");
        assert_eq!(project.group_addresses.len(), 1);

        // Verify that both devices now have the GA linked!
        let taster_ko = &project.devices[0].communication_objects[0];
        let actuator_ko = &project.devices[1].communication_objects[0];
        assert_eq!(taster_ko.group_addresses, vec!["0/1/10"]);
        assert_eq!(actuator_ko.group_addresses, vec!["0/1/10"]);
        assert_eq!(taster_ko.group_address_ids, vec![ga.id]);
        assert_eq!(actuator_ko.group_address_ids, vec![ga.id]);
        assert_eq!(project.connections.len(), 1);
    }
}

