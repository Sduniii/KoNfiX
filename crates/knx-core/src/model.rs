use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum DptType {
    #[serde(rename = "1.001")]
    Dpt1_001, // Switch (1 bit: 0=Off, 1=On)
    #[serde(rename = "1.005")]
    Dpt1_005, // Alarm (1 bit: 0=No Alarm, 1=Alarm)
    #[serde(rename = "1.008")]
    Dpt1_008, // Up/Down (1 bit: 0=Up, 1=Down)
    #[serde(rename = "1.010")]
    Dpt1_010, // Start/Stop (1 bit: 0=Stop, 1=Start)
    #[serde(rename = "3.007")]
    Dpt3_007, // Dimming Step (4 bit: Direction + StepCode)
    #[serde(rename = "3.008")]
    Dpt3_008, // Blind Step (4 bit: Direction + StepCode)
    #[serde(rename = "5.001")]
    Dpt5_001, // Scaling / Percentage (8 bit: 0..100%)
    #[serde(rename = "9.001")]
    Dpt9_001, // Temperature (°C, 2-byte float)
    #[serde(rename = "17.001")]
    Dpt17_001, // Scene Number (8 bit: 0..63)
    #[serde(rename = "18.001")]
    Dpt18_001, // Scene Control (8 bit: activate/learn + scene number)
    #[serde(rename = "20.102")]
    Dpt20_102, // HVAC Mode (1 byte: Auto, Comfort, Standby, Economy, Building Protection)
}

impl DptType {
    pub fn as_str(&self) -> &'static str {
        match self {
            DptType::Dpt1_001 => "1.001",
            DptType::Dpt1_005 => "1.005",
            DptType::Dpt1_008 => "1.008",
            DptType::Dpt1_010 => "1.010",
            DptType::Dpt3_007 => "3.007",
            DptType::Dpt3_008 => "3.008",
            DptType::Dpt5_001 => "5.001",
            DptType::Dpt9_001 => "9.001",
            DptType::Dpt17_001 => "17.001",
            DptType::Dpt18_001 => "18.001",
            DptType::Dpt20_102 => "20.102",
        }
    }

    pub fn description(&self) -> &'static str {
        match self {
            DptType::Dpt1_001 => "DPT 1.001 (Schalten)",
            DptType::Dpt1_005 => "DPT 1.005 (Alarm 1-Bit)",
            DptType::Dpt1_008 => "DPT 1.008 (Auf/Ab)",
            DptType::Dpt1_010 => "DPT 1.010 (Start/Stop)",
            DptType::Dpt3_007 => "DPT 3.007 (Dimmen relativ 4-Bit)",
            DptType::Dpt3_008 => "DPT 3.008 (Lamellenverstellung 4-Bit)",
            DptType::Dpt5_001 => "DPT 5.001 (Prozentwert 0-100%)",
            DptType::Dpt9_001 => "DPT 9.001 (Temperatur 2-Byte)",
            DptType::Dpt17_001 => "DPT 17.001 (Szenennummer 1-Byte)",
            DptType::Dpt18_001 => "DPT 18.001 (Szenensteuerung 1-Byte)",
            DptType::Dpt20_102 => "DPT 20.102 (HVAC Betriebsmodus)",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum FunctionBlockType {
    LightController,
    BlindController,
    ClimateController,
    SceneController,
    StaircaseTimer,
    LogicGate,
    AstroSunProtection,
    TimerScheduler,
    ThresholdSwitch,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PinDirection {
    Input,
    Output,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlockPin {
    pub id: String,
    pub name: String,
    pub description: String,
    pub dpt: DptType,
    pub direction: PinDirection,
    pub group_address_id: Option<Uuid>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ChannelType {
    SwitchOutput,
    DimmerOutput,
    BlindOutput,
    HeatingOutput,
    PushButtonInput,
    PresenceSensorInput,
    TempSensorInput,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DeviceChannel {
    pub id: Uuid,
    pub device_id: Uuid,
    pub channel_code: String, // e.g. "Kanal A", "Taste 1"
    pub name: String,
    pub channel_type: ChannelType,
    pub room_id: Option<Uuid>,
    #[serde(default)]
    pub position: Option<Position>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ComObjectFlags {
    #[serde(default = "default_true")]
    pub communication: bool, // C-Flag
    #[serde(default)]
    pub read: bool,          // R-Flag
    #[serde(default = "default_true")]
    pub write: bool,         // W-Flag
    #[serde(default)]
    pub transmit: bool,      // T-Flag
    #[serde(default)]
    pub update: bool,        // U-Flag
}

fn default_true() -> bool {
    true
}

impl Default for ComObjectFlags {
    fn default() -> Self {
        Self {
            communication: true,
            read: false,
            write: true,
            transmit: false,
            update: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommunicationObject {
    pub id: String,                  // e.g. "O-0"
    pub number: u32,                 // e.g. 0
    pub name: String,                // internal identifier e.g. "Global_mud"
    pub object_text: String,         // group/channel e.g. "Kanal A" or "Zentral"
    pub function_text: String,       // function e.g. "Auf/Ab", "Schalten", "Status"
    pub dpt: String,                 // e.g. "1.008", "1.001", "5.001"
    pub object_size: String,         // e.g. "1 Bit", "1 Byte"
    pub flags: ComObjectFlags,
    #[serde(default)]
    pub group_address_ids: Vec<Uuid>,
    #[serde(default)]
    pub group_addresses: Vec<String>, // e.g. ["1/0/0"]
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ParameterOption {
    pub value: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ParameterCondition {
    pub param_id: String,
    pub when_values: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ParameterDependency {
    pub param_id: String,
    pub when_values: Vec<String>,
    #[serde(default)]
    pub conditions: Vec<ParameterCondition>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ParameterAssignRule {
    pub target_param_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_param_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(default)]
    pub conditions: Vec<ParameterCondition>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct DeviceParameter {
    pub id: String,                  // e.g. "P-10000"
    pub name: String,                // parameter key
    pub text: String,                // user-facing label e.g. "Fahrzeit"
    pub param_type: String,          // "number", "enum", "text", "boolean"
    pub value: String,               // current value
    pub default_value: String,       // factory default
    #[serde(default)]
    pub suffix: Option<String>,      // e.g. "s", "%", "ms"
    #[serde(default)]
    pub options: Vec<String>,        // dropdown choices for enums
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub enum_options: Vec<ParameterOption>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pages: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub section: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub depends_on: Option<ParameterDependency>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offset: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bit_offset: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_in_bit: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_float: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CatalogProduct {
    pub id: String,                  // e.g. "MDT_JAL-B1UP.02"
    pub order_number: String,        // e.g. "JAL-B1UP.02"
    pub manufacturer: String,        // e.g. "MDT Technologies"
    pub name: String,                // e.g. "JAL-B1UP.02 Jalousieaktor 1-fach"
    pub hardware_name: String,       // e.g. "Jalousieaktor 1-fach mit Tastereingang"
    pub application_program: String, // e.g. "Jalousieaktor V3.9"
    pub mask_version: String,        // e.g. "07B0h (System B)"
    pub bus_current_ma: u16,         // e.g. 10
    #[serde(default)]
    pub default_channels: Vec<DeviceChannel>,
    #[serde(default)]
    pub communication_objects: Vec<CommunicationObject>,
    #[serde(default)]
    pub parameters: Vec<DeviceParameter>,
    #[serde(default)]
    pub assign_rules: Vec<ParameterAssignRule>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CatalogProductSummary {
    pub id: String,
    pub order_number: String,
    pub manufacturer: String,
    pub name: String,
    pub hardware_name: String,
    pub application_program: String,
    pub mask_version: String,
    pub bus_current_ma: u16,
    pub channel_count: usize,
    pub ko_count: usize,
    pub param_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct KnxDevice {
    pub id: Uuid,
    pub individual_address: String, // e.g. "1.1.1"
    pub manufacturer: String,       // e.g. "MDT Technologies", "Gira"
    pub model: String,              // e.g. "AKD-0424R.02", "Glastaster II Smart"
    pub name: String,
    #[serde(default)]
    pub room_id: Option<Uuid>,
    pub channels: Vec<DeviceChannel>,
    #[serde(default)]
    pub position: Option<Position>,
    #[serde(default)]
    pub order_number: Option<String>,
    #[serde(default)]
    pub application_program: Option<String>,
    #[serde(default)]
    pub mask_version: Option<String>,
    #[serde(default)]
    pub bus_current_ma: Option<u16>,
    #[serde(default)]
    pub communication_objects: Vec<CommunicationObject>,
    #[serde(default)]
    pub parameters: Vec<DeviceParameter>,
    #[serde(default)]
    pub assign_rules: Vec<ParameterAssignRule>,
    #[serde(default)]
    pub visible_ko_numbers: Vec<u32>,
    #[serde(default)]
    pub last_flashed_state: Option<DeviceFlashedSnapshot>,
    #[serde(default)]
    pub security: Option<KnxDataSecureConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub loaded_image: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checksums: Option<String>,
}

impl KnxDevice {
    pub fn get_serial_number(&self) -> Option<&str> {
        self.security.as_ref().and_then(|s| s.serial_number.as_deref())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionBlock {
    pub id: Uuid,
    pub name: String,
    pub block_type: FunctionBlockType,
    pub room_id: Option<Uuid>,
    pub position: Position,
    pub inputs: Vec<BlockPin>,
    pub outputs: Vec<BlockPin>,
    pub parameters: serde_json::Value,
    pub state: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WireConnection {
    pub id: Uuid,
    pub from_node_id: Uuid,
    pub from_pin: String,
    pub to_node_id: Uuid,
    pub to_pin: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum GaScheme {
    #[default]
    FloorTradeFunction, // Main = Floor (1=EG, 2=OG...), Middle = Trade (1=Light, 2=Blind...), Sub = Function
    TradeRoomFunction,  // Main = Trade (1=Light, 2=Blind...), Middle = Room (1=WZ, 2=Küche...), Sub = Function
    TradeFunctionDevice,// Main = Trade (1=Light, 2=Blind...), Middle = Function (1=Switch, 2=Dim...), Sub = Device/Block
}

impl GaScheme {
    pub fn label(&self) -> &'static str {
        match self {
            GaScheme::FloorTradeFunction => "Etage / Gewerk / Funktion",
            GaScheme::TradeRoomFunction => "Gewerk / Raum / Funktion",
            GaScheme::TradeFunctionDevice => "Gewerk / Funktion / Baustein",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GroupAddress {
    pub id: Uuid,
    pub address: String, // "1/1/10"
    pub main: u8,
    pub middle: u8,
    pub sub: u8,
    pub name: String,
    pub dpt: String,
    pub description: String,
    pub origin_block_id: Option<Uuid>,
    pub origin_pin_name: Option<String>,
    #[serde(default)]
    pub is_custom: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Room {
    pub id: Uuid,
    pub floor_id: Uuid,
    pub name: String,
    pub icon: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Floor {
    pub id: Uuid,
    pub building_id: Uuid,
    pub name: String,
    pub level: i32, // 0 = EG, 1 = OG, -1 = KG
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Building {
    pub id: Uuid,
    pub name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum KnxMediumType {
    #[default]
    Tp, // Twisted Pair (TP-256)
    Ip, // KNXnet/IP Routing/Tunneling
    Rf, // Radio Frequency (KNX RF)
    Pl, // Powerline (PL110)
}

impl KnxMediumType {
    pub fn label(&self) -> &'static str {
        match self {
            KnxMediumType::Tp => "TP (Twisted Pair)",
            KnxMediumType::Ip => "IP (Ethernet)",
            KnxMediumType::Rf => "RF (Funk)",
            KnxMediumType::Pl => "PL (Powerline)",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum LineCouplerFilterMode {
    #[default]
    Filter,   // Normaler Modus: Nur GAs in Filtertabelle passieren lassen
    RouteAll, // Durchzug / Diagnose: Alle Gruppen-Telegramme weiterleiten
    BlockAll, // Sperren: Keine Gruppen-Telegramme weiterleiten
}

impl LineCouplerFilterMode {
    pub fn label(&self) -> &'static str {
        match self {
            LineCouplerFilterMode::Filter => "Filtern (Normal)",
            LineCouplerFilterMode::RouteAll => "Weiterleiten / Durchzug (Diagnose)",
            LineCouplerFilterMode::BlockAll => "Blockieren (Sperren)",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TopologyLine {
    pub id: Uuid,
    pub area_id: Uuid,
    pub line_number: u8,                  // 0 = Hauptlinie, 1..15 = Sublinie
    pub address: String,                  // "1.1" oder "1.0"
    pub name: String,                     // z.B. "Erdgeschoss TP"
    pub medium: KnxMediumType,            // Tp
    #[serde(default)]
    pub coupler_device_id: Option<Uuid>,  // z.B. Linienkoppler (1.1.0)
    #[serde(default)]
    pub coupler_filter_mode: LineCouplerFilterMode,
    #[serde(default)]
    pub manual_forward_gas: Vec<String>,  // Manuelle GA-Weiterleitungs-Freigaben
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TopologyArea {
    pub id: Uuid,
    pub area_number: u8,                  // 0 = Backbone, 1..15 = Bereich
    pub address: String,                  // "1" oder "0"
    pub name: String,                     // z.B. "Hauptgebäude"
    pub medium: KnxMediumType,
    pub lines: Vec<TopologyLine>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct ProjectTopology {
    pub areas: Vec<TopologyArea>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FilterAction {
    Forward,
    Block,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterTableEntry {
    pub ga_address: String,
    pub ga_name: String,
    pub dpt: String,
    pub action: FilterAction,
    pub reason: String,
    pub subline_devices: Vec<String>,
    pub extline_devices: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterTableSummary {
    pub line_address: String,
    pub line_name: String,
    pub coupler_address: Option<String>,
    pub filter_mode: LineCouplerFilterMode,
    pub total_gas: usize,
    pub forwarded_count: usize,
    pub filtered_count: usize,
    pub entries: Vec<FilterTableEntry>,
    pub raw_bitmap_hex: String, // 8192 Bytes hex-kodiert (65536 Bits)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnxTelegram {
    pub id: Uuid,
    pub timestamp: String,
    pub source: String,
    pub destination: String,
    pub dpt: String,
    pub value_raw: Vec<u8>,
    pub value_formatted: String,
    pub telegram_type: String, // "Write", "Read", "Response"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: Uuid,
    pub name: String,
    #[serde(default)]
    pub ga_scheme: GaScheme,
    pub buildings: Vec<Building>,
    pub floors: Vec<Floor>,
    pub rooms: Vec<Room>,
    pub devices: Vec<KnxDevice>,
    pub blocks: Vec<FunctionBlock>,
    pub connections: Vec<WireConnection>,
    pub group_addresses: Vec<GroupAddress>,
    #[serde(default)]
    pub topology: Option<ProjectTopology>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredGateway {
    pub ip: String,
    pub port: u16,
    pub name: String,
    pub individual_address: String,
    pub mac_address: String,
    pub medium: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayConnectionStatus {
    pub connected: bool,
    pub gateway_ip: Option<String>,
    pub gateway_port: Option<u16>,
    pub gateway_name: Option<String>,
    pub individual_address: Option<String>,
    pub channel_id: Option<u8>,
    pub last_heartbeat: Option<String>,
    pub telegrams_sent: u64,
    pub telegrams_received: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnxSecureCredentials {
    pub user_id: u8,
    pub user_password: String,
    #[serde(default)]
    pub device_authentication: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayConnectRequest {
    pub ip: String,
    pub port: Option<u16>,
    pub secure: Option<KnxSecureCredentials>,
}

// ----------------------------------------------------------------------------
// Programming Engine & KNX Data Secure Models
// ----------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DeviceFlashedSnapshot {
    pub individual_address: String,
    pub group_addresses: Vec<String>,
    pub associations: Vec<(u32, String)>, // (ko_number, ga_address)
    pub parameters: std::collections::HashMap<String, String>, // param_id -> value
    pub flashed_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParameterDiff {
    pub param_id: String,
    pub param_name: String,
    pub param_text: String,
    pub old_value: String,
    pub new_value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceDirtyDetails {
    pub is_dirty: bool,
    pub reasons: Vec<String>,
    pub parameter_diffs: Vec<ParameterDiff>,
    pub address_changed: Option<(String, String)>,
    pub added_gas: Vec<String>,
    pub removed_gas: Vec<String>,
    pub added_associations: Vec<(u32, String)>,
    pub removed_associations: Vec<(u32, String)>,
    pub is_initial: bool,
    pub last_flashed: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct KnxDataSecureConfig {
    pub is_secure_enabled: bool,
    #[serde(default)]
    pub serial_number: Option<String>, // e.g. "00:83:76:8A:0C:65"
    #[serde(default)]
    pub fdsk: Option<String>, // e.g. "01234-56789-ABCDE-FGHIJ-KLMNO-PQRST"
    #[serde(default)]
    pub tool_key: Option<String>, // 16-byte key as hex
    #[serde(default)]
    pub sequence_number: u64, // 48-bit monotonic sequence counter
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProgrammingJobType {
    Partial,         // Differential: GAT, AT & modified parameters
    Full,            // Complete rewrite of memory and application
    PhysicalAddress, // Only individual address (A_IndividualAddress_Write)
    FilterTable,     // 8192-byte binary bitmask for line couplers
    Restart,         // Device reboot (A_Restart)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProgrammingJobStatus {
    Queued,
    Connecting,
    Authorizing,
    WritingGAT,
    WritingAT,
    WritingParameters,
    WritingFilterTable,
    Restarting,
    Success,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgrammingJob {
    pub id: Uuid,
    pub device_id: Uuid,
    pub device_address: String,
    pub device_name: String,
    pub job_type: ProgrammingJobType,
    pub status: ProgrammingJobStatus,
    pub progress_percent: u8,
    pub current_step: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub completed_at: Option<chrono::DateTime<chrono::Utc>>,
    pub log_messages: Vec<String>,
}

