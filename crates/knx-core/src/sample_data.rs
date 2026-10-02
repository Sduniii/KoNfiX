use crate::auto_ga::AutoGaRouter;
use crate::model::*;
use uuid::Uuid;

pub fn create_demo_project() -> Project {
    let bld_id = Uuid::new_v4();
    let fl_eg_id = Uuid::new_v4();
    let fl_og_id = Uuid::new_v4();

    let rm_wz_id = Uuid::new_v4();
    let rm_kueche_id = Uuid::new_v4();
    let rm_sz_id = Uuid::new_v4();

    let building = Building {
        id: bld_id,
        name: "Einfamilienhaus Smart Home".to_string(),
    };

    let floor_eg = Floor {
        id: fl_eg_id,
        building_id: bld_id,
        name: "Erdgeschoss".to_string(),
        level: 0,
    };

    let floor_og = Floor {
        id: fl_og_id,
        building_id: bld_id,
        name: "Obergeschoss".to_string(),
        level: 1,
    };

    let room_wz = Room {
        id: rm_wz_id,
        floor_id: fl_eg_id,
        name: "Wohnzimmer".to_string(),
        icon: "sofa".to_string(),
    };

    let room_kueche = Room {
        id: rm_kueche_id,
        floor_id: fl_eg_id,
        name: "Küche".to_string(),
        icon: "utensils".to_string(),
    };

    let room_sz = Room {
        id: rm_sz_id,
        floor_id: fl_og_id,
        name: "Schlafzimmer".to_string(),
        icon: "bed".to_string(),
    };

    // KNX Devices
    let dev_dim_id = Uuid::new_v4();
    let ch_dim_a_id = Uuid::new_v4();
    let dev_dim = KnxDevice {
        id: dev_dim_id,
        individual_address: "1.1.1".to_string(),
        manufacturer: "MDT Technologies".to_string(),
        model: "AKD-0424R.02".to_string(),
        name: "MDT 4-fach Dimmaktor 24V".to_string(),
        room_id: Some(rm_wz_id),
        channels: vec![
            DeviceChannel {
                id: ch_dim_a_id,
                device_id: dev_dim_id,
                channel_code: "Kanal A".to_string(),
                name: "Wohnzimmer Deckenbeleuchtung".to_string(),
                channel_type: ChannelType::DimmerOutput,
                room_id: Some(rm_wz_id),
                position: Some(Position { x: 800.0, y: 140.0 }),
            },
            DeviceChannel {
                id: Uuid::new_v4(),
                device_id: dev_dim_id,
                channel_code: "Kanal B".to_string(),
                name: "Wohnzimmer Wandspots".to_string(),
                channel_type: ChannelType::DimmerOutput,
                room_id: Some(rm_wz_id),
                position: None,
            },
            DeviceChannel {
                id: Uuid::new_v4(),
                device_id: dev_dim_id,
                channel_code: "Kanal C".to_string(),
                name: "Küche Arbeitsplatte LED".to_string(),
                channel_type: ChannelType::DimmerOutput,
                room_id: Some(rm_kueche_id),
                position: None,
            },
            DeviceChannel {
                id: Uuid::new_v4(),
                device_id: dev_dim_id,
                channel_code: "Kanal D".to_string(),
                name: "Reserve".to_string(),
                channel_type: ChannelType::DimmerOutput,
                room_id: None,
                position: None,
            },
        ],
        position: Some(Position { x: 780.0, y: 120.0 }),
        order_number: Some("AKD-0424R.02".to_string()),
        application_program: Some("Dimmaktor 4-fach 24V V2.1".to_string()),
        mask_version: Some("07B0h (System B)".to_string()),
        bus_current_ma: Some(10),
        communication_objects: vec![
            CommunicationObject {
                id: "AKD_KO_0".to_string(),
                number: 0,
                name: "ChA_Switch".to_string(),
                object_text: "Kanal A".to_string(),
                function_text: "Schalten Ein/Aus".to_string(),
                dpt: "1.001".to_string(),
                object_size: "1 Bit".to_string(),
                flags: ComObjectFlags::default(),
                group_address_ids: vec![],
                group_addresses: vec!["4/0/15".to_string()],
            },
            CommunicationObject {
                id: "AKD_KO_1".to_string(),
                number: 1,
                name: "ChA_DimRel".to_string(),
                object_text: "Kanal A".to_string(),
                function_text: "Dimmen relativ".to_string(),
                dpt: "3.007".to_string(),
                object_size: "4 Bit".to_string(),
                flags: ComObjectFlags::default(),
                group_address_ids: vec![],
                group_addresses: vec![],
            },
            CommunicationObject {
                id: "AKD_KO_2".to_string(),
                number: 2,
                name: "ChA_DimAbs".to_string(),
                object_text: "Kanal A".to_string(),
                function_text: "Dimmwert absolut".to_string(),
                dpt: "5.001".to_string(),
                object_size: "1 Byte".to_string(),
                flags: ComObjectFlags::default(),
                group_address_ids: vec![],
                group_addresses: vec!["4/0/16".to_string()],
            },
            CommunicationObject {
                id: "AKD_KO_3".to_string(),
                number: 3,
                name: "ChA_StateSwitch".to_string(),
                object_text: "Kanal A".to_string(),
                function_text: "Status Schalten".to_string(),
                dpt: "1.001".to_string(),
                object_size: "1 Bit".to_string(),
                flags: ComObjectFlags {
                    communication: true,
                    read: true,
                    write: false,
                    transmit: true,
                    update: false,
                },
                group_address_ids: vec![],
                group_addresses: vec!["4/0/17".to_string()],
            },
            CommunicationObject {
                id: "AKD_KO_4".to_string(),
                number: 4,
                name: "ChA_StateValue".to_string(),
                object_text: "Kanal A".to_string(),
                function_text: "Status Dimmwert".to_string(),
                dpt: "5.001".to_string(),
                object_size: "1 Byte".to_string(),
                flags: ComObjectFlags {
                    communication: true,
                    read: true,
                    write: false,
                    transmit: true,
                    update: false,
                },
                group_address_ids: vec![],
                group_addresses: vec!["4/0/18".to_string()],
            },
        ],
        parameters: vec![
            DeviceParameter {
                id: "AKD_P_fade".to_string(),
                name: "fade_time".to_string(),
                text: "Dimmzeit für relatives Dimmen".to_string(),
                param_type: "number".to_string(),
                value: "1.5".to_string(),
                default_value: "2.0".to_string(),
                suffix: Some("s".to_string()),
                options: vec![],
                enum_options: vec![],
                page: Some("Allgemeine Einstellung".to_string()),
                pages: vec![],
                section: Some("Dimmkurve".to_string()),
                depends_on: None,
                access: None,
                offset: None,
                bit_offset: None,
                size_in_bit: None,
                min: Some(0.0),
                max: Some(60.0),
                step: Some(0.5),
                is_float: Some(true),
            },
            DeviceParameter {
                id: "AKD_P_switch_on".to_string(),
                name: "switch_on_value".to_string(),
                text: "Einschaltwert bei 1-Bit EIN".to_string(),
                param_type: "enum".to_string(),
                value: "Letzter Wert (Memory)".to_string(),
                default_value: "100%".to_string(),
                suffix: None,
                options: vec!["100%".to_string(), "Letzter Wert (Memory)".to_string(), "50%".to_string()],
                enum_options: vec![
                    ParameterOption { value: "0".to_string(), text: "100%".to_string() },
                    ParameterOption { value: "1".to_string(), text: "Letzter Wert (Memory)".to_string() },
                    ParameterOption { value: "2".to_string(), text: "50%".to_string() },
                ],
                page: Some("Kanal A: Dimmer".to_string()),
                pages: vec![],
                section: Some("Einschaltverhalten".to_string()),
                depends_on: None,
                access: None,
                offset: None,
                bit_offset: None,
                size_in_bit: None,
                min: None,
                max: None,
                step: None,
                is_float: None,
            },
        ],
        assign_rules: vec![],
        visible_ko_numbers: vec![0, 1],
        last_flashed_state: None,
        security: None,
        loaded_image: None,
        checksums: None,
        ..Default::default()
    };

    let dev_jal_id = Uuid::new_v4();
    let ch_jal_a_id = Uuid::new_v4();
    let dev_jal = KnxDevice {
        id: dev_jal_id,
        individual_address: "1.1.2".to_string(),
        manufacturer: "MDT Technologies".to_string(),
        model: "JAL-0410M.02".to_string(),
        name: "MDT 4-fach Jalousieaktor".to_string(),
        room_id: Some(rm_wz_id),
        channels: vec![
            DeviceChannel {
                id: ch_jal_a_id,
                device_id: dev_jal_id,
                channel_code: "Kanal A".to_string(),
                name: "Wohnzimmer Schiebetür Süd".to_string(),
                channel_type: ChannelType::BlindOutput,
                room_id: Some(rm_wz_id),
                position: Some(Position { x: 800.0, y: 440.0 }),
            },
            DeviceChannel {
                id: Uuid::new_v4(),
                device_id: dev_jal_id,
                channel_code: "Kanal B".to_string(),
                name: "Küche Fenster Ost".to_string(),
                channel_type: ChannelType::BlindOutput,
                room_id: Some(rm_kueche_id),
                position: None,
            },
        ],
        position: Some(Position { x: 780.0, y: 440.0 }),
        order_number: Some("JAL-0410M.02".to_string()),
        application_program: Some("Jalousieaktor 4-fach V3.9".to_string()),
        mask_version: Some("07B0h (System B)".to_string()),
        bus_current_ma: Some(12),
        communication_objects: vec![
            CommunicationObject {
                id: "JAL_KO_0".to_string(),
                number: 0,
                name: "ChA_Move".to_string(),
                object_text: "Kanal A".to_string(),
                function_text: "Auf/Ab".to_string(),
                dpt: "1.008".to_string(),
                object_size: "1 Bit".to_string(),
                flags: ComObjectFlags::default(),
                group_address_ids: vec![],
                group_addresses: vec!["2/0/0".to_string()],
            },
            CommunicationObject {
                id: "JAL_KO_1".to_string(),
                number: 1,
                name: "ChA_Stop".to_string(),
                object_text: "Kanal A".to_string(),
                function_text: "Stop / Lamellenverstellung".to_string(),
                dpt: "1.010".to_string(),
                object_size: "1 Bit".to_string(),
                flags: ComObjectFlags::default(),
                group_address_ids: vec![],
                group_addresses: vec!["2/0/1".to_string()],
            },
            CommunicationObject {
                id: "JAL_KO_2".to_string(),
                number: 2,
                name: "ChA_PosAbs".to_string(),
                object_text: "Kanal A".to_string(),
                function_text: "Absolute Position (0-100%)".to_string(),
                dpt: "5.001".to_string(),
                object_size: "1 Byte".to_string(),
                flags: ComObjectFlags::default(),
                group_address_ids: vec![],
                group_addresses: vec!["2/0/2".to_string()],
            },
            CommunicationObject {
                id: "JAL_KO_3".to_string(),
                number: 3,
                name: "ChA_WindAlarm".to_string(),
                object_text: "Kanal A".to_string(),
                function_text: "Windalarm Sicherheitsfahrt".to_string(),
                dpt: "1.001".to_string(),
                object_size: "1 Bit".to_string(),
                flags: ComObjectFlags::default(),
                group_address_ids: vec![],
                group_addresses: vec![],
            },
        ],
        parameters: vec![
            DeviceParameter {
                id: "JAL_P_travel".to_string(),
                name: "travel_time_sec".to_string(),
                text: "Fahrzeit Behang (Sekunden)".to_string(),
                param_type: "number".to_string(),
                value: "35".to_string(),
                default_value: "30".to_string(),
                suffix: Some("s".to_string()),
                options: vec![],
                enum_options: vec![],
                page: Some("Kanal A: Jalousie".to_string()),
                pages: vec![],
                section: Some("Fahrzeiten".to_string()),
                depends_on: None,
                access: None,
                offset: None,
                bit_offset: None,
                size_in_bit: None,
                min: Some(1.0),
                max: Some(360.0),
                step: Some(1.0),
                is_float: Some(false),
            },
            DeviceParameter {
                id: "JAL_P_slat".to_string(),
                name: "slat_time_sec".to_string(),
                text: "Lamellen-Wendelaufzeit".to_string(),
                param_type: "number".to_string(),
                value: "2.5".to_string(),
                default_value: "2.0".to_string(),
                suffix: Some("s".to_string()),
                options: vec![],
                enum_options: vec![],
                page: Some("Kanal A: Jalousie".to_string()),
                pages: vec![],
                section: Some("Fahrzeiten".to_string()),
                depends_on: None,
                access: None,
                offset: None,
                bit_offset: None,
                size_in_bit: None,
                min: Some(0.1),
                max: Some(10.0),
                step: Some(0.1),
                is_float: Some(true),
            },
        ],
        assign_rules: vec![],
        visible_ko_numbers: vec![0, 1],
        last_flashed_state: None,
        security: None,
        loaded_image: None,
        checksums: None,
        ..Default::default()
    };

    let ch_t1_id = Uuid::new_v4();
    let ch_t2_id = Uuid::new_v4();
    let ch_t3_id = Uuid::new_v4();
    let ch_t4_id = Uuid::new_v4();

    let dev_taster_id = Uuid::new_v4();
    let dev_taster = KnxDevice {
        id: dev_taster_id,
        individual_address: "1.1.10".to_string(),
        manufacturer: "MDT Technologies".to_string(),
        model: "Glastaster II Smart".to_string(),
        name: "MDT Glastaster Eingang WZ".to_string(),
        room_id: Some(rm_wz_id),
        channels: vec![
            DeviceChannel {
                id: ch_t1_id,
                device_id: dev_taster_id,
                channel_code: "Taste 1".to_string(),
                name: "Deckenlicht Toggle".to_string(),
                channel_type: ChannelType::PushButtonInput,
                room_id: Some(rm_wz_id),
                position: Some(Position { x: 40.0, y: 140.0 }),
            },
            DeviceChannel {
                id: ch_t2_id,
                device_id: dev_taster_id,
                channel_code: "Taste 2".to_string(),
                name: "Raffstore Auf/Ab".to_string(),
                channel_type: ChannelType::PushButtonInput,
                room_id: Some(rm_wz_id),
                position: Some(Position { x: 40.0, y: 440.0 }),
            },
            DeviceChannel {
                id: ch_t3_id,
                device_id: dev_taster_id,
                channel_code: "Taste 3".to_string(),
                name: "Szenensteuerung".to_string(),
                channel_type: ChannelType::PushButtonInput,
                room_id: Some(rm_wz_id),
                position: None,
            },
            DeviceChannel {
                id: ch_t4_id,
                device_id: dev_taster_id,
                channel_code: "Taste 4".to_string(),
                name: "Alles Aus / Zentral".to_string(),
                channel_type: ChannelType::PushButtonInput,
                room_id: Some(rm_wz_id),
                position: None,
            },
        ],
        position: Some(Position { x: 40.0, y: 120.0 }),
        order_number: Some("BE-GT20W.02".to_string()),
        application_program: Some("Glastaster II Smart V2.4".to_string()),
        mask_version: Some("07B0h (System B)".to_string()),
        bus_current_ma: Some(15),
        communication_objects: vec![
            CommunicationObject {
                id: "GT_KO_1".to_string(),
                number: 1,
                name: "T1_Switch".to_string(),
                object_text: "Taste 1".to_string(),
                function_text: "Schalten Ein/Aus".to_string(),
                dpt: "1.001".to_string(),
                object_size: "1 Bit".to_string(),
                flags: ComObjectFlags {
                    communication: true,
                    read: false,
                    write: false,
                    transmit: true,
                    update: true,
                },
                group_address_ids: vec![],
                group_addresses: vec!["4/0/15".to_string()],
            },
            CommunicationObject {
                id: "GT_KO_2".to_string(),
                number: 2,
                name: "T2_Move".to_string(),
                object_text: "Taste 2".to_string(),
                function_text: "Jalousie Auf/Ab".to_string(),
                dpt: "1.008".to_string(),
                object_size: "1 Bit".to_string(),
                flags: ComObjectFlags {
                    communication: true,
                    read: false,
                    write: false,
                    transmit: true,
                    update: true,
                },
                group_address_ids: vec![],
                group_addresses: vec!["2/0/0".to_string()],
            },
        ],
        parameters: vec![
            DeviceParameter {
                id: "GT_P_bright".to_string(),
                name: "display_brightness".to_string(),
                text: "Display-Helligkeit aktiv".to_string(),
                param_type: "number".to_string(),
                value: "80".to_string(),
                default_value: "70".to_string(),
                suffix: Some("%".to_string()),
                options: vec![],
                enum_options: vec![],
                page: Some("Display & Tasten".to_string()),
                pages: vec![],
                section: Some("Helligkeit".to_string()),
                depends_on: None,
                access: None,
                offset: None,
                bit_offset: None,
                size_in_bit: None,
                min: Some(0.0),
                max: Some(100.0),
                step: Some(1.0),
                is_float: Some(false),
            },
        ],
        assign_rules: vec![],
        visible_ko_numbers: vec![0, 1],
        last_flashed_state: None,
        security: None,
        loaded_image: None,
        checksums: None,
        ..Default::default()
    };

    // Preconfigured Function Blocks
    let block_light_id = Uuid::new_v4();
    let block_light = FunctionBlock {
        id: block_light_id,
        name: "Deckenlicht".to_string(),
        block_type: FunctionBlockType::LightController,
        room_id: Some(rm_wz_id),
        position: Position { x: 380.0, y: 120.0 },
        inputs: vec![
            BlockPin {
                id: "t".to_string(),
                name: "T (Toggle)".to_string(),
                description: "Taster-Eingang Schalten/Dimmen".to_string(),
                dpt: DptType::Dpt1_001,
                direction: PinDirection::Input,
                group_address_id: None,
            },
            BlockPin {
                id: "p".to_string(),
                name: "P (Präsenz)".to_string(),
                description: "Präsenzmelder-Eingang".to_string(),
                dpt: DptType::Dpt1_001,
                direction: PinDirection::Input,
                group_address_id: None,
            },
        ],
        outputs: vec![
            BlockPin {
                id: "sw".to_string(),
                name: "SW (Schalten)".to_string(),
                description: "Ein/Aus Aktor-Befehl".to_string(),
                dpt: DptType::Dpt1_001,
                direction: PinDirection::Output,
                group_address_id: None,
            },
            BlockPin {
                id: "dim".to_string(),
                name: "DIM (Dimmen)".to_string(),
                description: "Relativ 4-Bit".to_string(),
                dpt: DptType::Dpt3_007,
                direction: PinDirection::Output,
                group_address_id: None,
            },
            BlockPin {
                id: "val".to_string(),
                name: "VAL (Wert)".to_string(),
                description: "Helligkeit 0..100%".to_string(),
                dpt: DptType::Dpt5_001,
                direction: PinDirection::Output,
                group_address_id: None,
            },
            BlockPin {
                id: "stat_sw".to_string(),
                name: "STAT (Status)".to_string(),
                description: "Rückmeldung Schalten".to_string(),
                dpt: DptType::Dpt1_001,
                direction: PinDirection::Output,
                group_address_id: None,
            },
            BlockPin {
                id: "stat_val".to_string(),
                name: "STAT_V (Status Wert)".to_string(),
                description: "Rückmeldung Helligkeit".to_string(),
                dpt: DptType::Dpt5_001,
                direction: PinDirection::Output,
                group_address_id: None,
            },
        ],
        parameters: serde_json::json!({
            "fade_time_sec": 1.5,
            "default_brightness": 80,
            "motion_timeout_sec": 120,
        }),
        state: serde_json::json!({
            "is_on": true,
            "brightness": 80,
        }),
    };

    let block_blind_id = Uuid::new_v4();
    let block_blind = FunctionBlock {
        id: block_blind_id,
        name: "Raffstore Süd".to_string(),
        block_type: FunctionBlockType::BlindController,
        room_id: Some(rm_wz_id),
        position: Position { x: 380.0, y: 440.0 },
        inputs: vec![
            BlockPin {
                id: "up".to_string(),
                name: "AUF".to_string(),
                description: "Fahrt nach oben".to_string(),
                dpt: DptType::Dpt1_008,
                direction: PinDirection::Input,
                group_address_id: None,
            },
            BlockPin {
                id: "down".to_string(),
                name: "AB".to_string(),
                description: "Fahrt nach unten".to_string(),
                dpt: DptType::Dpt1_008,
                direction: PinDirection::Input,
                group_address_id: None,
            },
        ],
        outputs: vec![
            BlockPin {
                id: "move".to_string(),
                name: "MOVE (Fahrt)".to_string(),
                description: "Fahrbefehl Auf/Ab".to_string(),
                dpt: DptType::Dpt1_008,
                direction: PinDirection::Output,
                group_address_id: None,
            },
            BlockPin {
                id: "step_stop".to_string(),
                name: "STOP (Lamelle)".to_string(),
                description: "Stop / Schritt".to_string(),
                dpt: DptType::Dpt1_010,
                direction: PinDirection::Output,
                group_address_id: None,
            },
            BlockPin {
                id: "pos".to_string(),
                name: "POS (Höhe)".to_string(),
                description: "Position in %".to_string(),
                dpt: DptType::Dpt5_001,
                direction: PinDirection::Output,
                group_address_id: None,
            },
        ],
        parameters: serde_json::json!({
            "travel_time_sec": 32,
            "slat_time_sec": 2.5,
        }),
        state: serde_json::json!({
            "position": 30,
            "slat": 45,
        }),
    };

    let initial_connections = vec![
        WireConnection {
            id: Uuid::new_v4(),
            from_node_id: ch_t1_id,
            from_pin: "out".to_string(),
            to_node_id: block_light_id,
            to_pin: "t".to_string(),
        },
        WireConnection {
            id: Uuid::new_v4(),
            from_node_id: ch_t2_id,
            from_pin: "out".to_string(),
            to_node_id: block_blind_id,
            to_pin: "up".to_string(),
        },
        WireConnection {
            id: Uuid::new_v4(),
            from_node_id: block_light_id,
            from_pin: "val".to_string(),
            to_node_id: ch_dim_a_id,
            to_pin: "in".to_string(),
        },
        WireConnection {
            id: Uuid::new_v4(),
            from_node_id: block_blind_id,
            from_pin: "move".to_string(),
            to_node_id: ch_jal_a_id,
            to_pin: "in".to_string(),
        },
    ];

    let mut project = Project {
        id: Uuid::new_v4(),
        name: "Musterhaus KNX".to_string(),
        buildings: vec![building],
        floors: vec![floor_eg, floor_og],
        rooms: vec![room_wz, room_kueche, room_sz],
        devices: vec![dev_dim, dev_jal, dev_taster],
        blocks: vec![block_light, block_blind],
        connections: initial_connections,
        group_addresses: vec![],
        ga_scheme: GaScheme::FloorTradeFunction,
        topology: None,
        ..Default::default()
    };

    // Run Auto-GA router to immediately initialize valid KNX group addresses!
    AutoGaRouter::route_project(&mut project);
    crate::topology::TopologyManager::ensure_topology(&mut project);

    project
}
