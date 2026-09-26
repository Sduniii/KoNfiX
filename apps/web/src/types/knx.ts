export type DptType =
  | '1.001'
  | '1.005'
  | '1.008'
  | '1.010'
  | '3.007'
  | '3.008'
  | '5.001'
  | '9.001'
  | '17.001'
  | '18.001'
  | '20.102'

export type FunctionBlockType =
  | 'LightController'
  | 'BlindController'
  | 'ClimateController'
  | 'SceneController'
  | 'StaircaseTimer'
  | 'LogicGate'
  | 'AstroSunProtection'
  | 'TimerScheduler'
  | 'ThresholdSwitch'

export type PinDirection = 'Input' | 'Output'

export interface BlockPin {
  id: string
  name: string
  description: string
  dpt: DptType
  direction: PinDirection
  group_address_id: string | null
}

export type ChannelType =
  | 'SwitchOutput'
  | 'DimmerOutput'
  | 'BlindOutput'
  | 'HeatingOutput'
  | 'PushButtonInput'
  | 'PresenceSensorInput'
  | 'TempSensorInput'

export interface DeviceChannel {
  id: string
  device_id: string
  channel_code: string
  name: string
  channel_type: ChannelType
  room_id: string | null
  position?: Position | null
}

export interface ComObjectFlags {
  communication: boolean
  read: boolean
  write: boolean
  transmit: boolean
  update: boolean
}

export interface CommunicationObject {
  id: string
  number: number
  name: string
  object_text: string
  function_text: string
  dpt: string
  object_size: string
  flags: ComObjectFlags
  group_addresses: string[]
  group_address_ids: string[]
}

export interface ParameterOption {
  value: string
  text: string
}

export interface ParameterCondition {
  param_id: string
  when_values: string[]
}

export interface ParameterDependency {
  param_id: string
  when_values: string[]
  conditions?: ParameterCondition[]
}

export interface ParameterAssignRule {
  target_param_id: string
  source_param_id?: string
  value?: string
  conditions: ParameterCondition[]
}

export interface DeviceParameter {
  id: string
  name: string
  text: string
  param_type: string
  value: string
  default_value: string
  suffix?: string | null
  options?: string[]
  enum_options?: ParameterOption[]
  page?: string | null
  pages?: string[]
  section?: string | null
  depends_on?: ParameterDependency | null
  access?: string | null
  offset?: number | null
  bit_offset?: number | null
  size_in_bit?: number | null
  min?: number | null
  max?: number | null
  step?: number | null
  is_float?: boolean | null
}

export interface CatalogProduct {
  id: string
  order_number: string
  manufacturer: string
  name: string
  hardware_name: string
  application_program: string
  mask_version: string
  bus_current_ma: number
  default_channels: DeviceChannel[]
  communication_objects: CommunicationObject[]
  parameters: DeviceParameter[]
  assign_rules?: ParameterAssignRule[]
}

export interface CatalogProductSummary {
  id: string
  order_number: string
  manufacturer: string
  name: string
  hardware_name: string
  application_program: string
  mask_version: string
  bus_current_ma: number
  channel_count: number
  ko_count: number
  param_count: number
}

import type { KnxDataSecureConfig, DeviceFlashedSnapshot } from './programming'

export interface KnxDevice {
  id: string
  individual_address: string
  manufacturer: string
  model: string
  name: string
  room_id?: string | null
  channels: DeviceChannel[]
  position?: Position | null
  order_number?: string | null
  application_program?: string | null
  mask_version?: string | null
  bus_current_ma?: number | null
  communication_objects?: CommunicationObject[]
  parameters?: DeviceParameter[]
  assign_rules?: ParameterAssignRule[]
  visible_ko_numbers?: number[]
  last_flashed_state?: DeviceFlashedSnapshot | null
  security?: KnxDataSecureConfig | null
  loaded_image?: string | null
  checksums?: string | null
}

export interface Position {
  x: number
  y: number
}

export interface LightCircuit {
  id: string
  name: string
  type: 'dimmer' | 'switch' | 'rgbw'
  color?: string
}

export interface SceneDefinition {
  no: number
  name: string
  icon?: string
  fade_time?: number
  values: Record<string, number>
}

export interface FunctionBlock {
  id: string
  name: string
  block_type: FunctionBlockType
  room_id: string | null
  position: Position
  inputs: BlockPin[]
  outputs: BlockPin[]
  parameters: Record<string, any>
  state: Record<string, any>
}

export interface WireConnection {
  id: string
  from_node_id: string
  from_pin: string
  to_node_id: string
  to_pin: string
}

export type GaScheme = 'FloorTradeFunction' | 'TradeRoomFunction' | 'TradeFunctionDevice'

export interface GroupAddress {
  id: string
  address: string // e.g. "1/1/10"
  main: number
  middle: number
  sub: number
  name: string
  dpt: string
  description: string
  origin_block_id: string | null
  origin_pin_name: string | null
  is_custom?: boolean
}

export interface Room {
  id: string
  floor_id: string
  name: string
  icon: string
}

export interface Floor {
  id: string
  building_id: string
  name: string
  level: number
}

export interface Building {
  id: string
  name: string
}

export interface KnxTelegram {
  id: string
  timestamp: string
  source: string
  destination: string
  dpt: string
  value_raw: number[]
  value_formatted: string
  telegram_type: string
}

export interface Project {
  id: string
  name: string
  ga_scheme?: GaScheme
  buildings: Building[]
  floors: Floor[]
  rooms: Room[]
  devices: KnxDevice[]
  blocks: FunctionBlock[]
  connections: WireConnection[]
  group_addresses: GroupAddress[]
}

export interface DiscoveredGateway {
  ip: string
  port: number
  name: string
  mac_address?: string | null
  individual_address?: string | null
  medium: string
  project_install_id?: number | null
}

export interface GatewayConnectionStatus {
  connected: boolean
  gateway_ip: string | null
  gateway_port: number | null
  gateway_name: string | null
  individual_address: string | null
  channel_id: number | null
  last_heartbeat: string | null
  telegrams_sent: number
  telegrams_received: number
}

export interface KnxSecureCredentials {
  user_id: number
  user_password: string
  device_authentication?: string | null
}

export interface GatewayConnectRequest {
  ip: string
  port?: number
  secure?: KnxSecureCredentials | null
}

export interface KeyringTunnel {
  individual_address: string
  user_id: number
  password: string
  authentication?: string | null
  host?: string | null
}

export interface DecryptedKeyring {
  project_name: string
  created: string
  tunnels: KeyringTunnel[]
}

export interface DetectedImportFile {
  path: string
  name: string
  file_type: 'knxproj' | 'csv'
  size_bytes: number
}

export interface ImportSummary {
  success: boolean
  file_name: string
  project_name: string
  group_address_count: number
  room_count: number
  floor_count: number
  block_count: number
  message: string
}

export type AddressScanStatus = 'Free' | 'Occupied' | 'Scanning' | 'Gateway' | 'ProgrammingMode'

export interface ScannedAddressInfo {
  address: string
  raw_address: number
  status: AddressScanStatus
  mask_version?: string | null
  mask_version_hex?: string | null
  manufacturer?: string | null
  rtt_ms?: number | null
  in_prog_mode: boolean
  device_name?: string | null
  last_seen?: string | null
}

export interface LineScanProgress {
  is_running: boolean
  line: string
  current_address?: string | null
  scanned_count: number
  total_count: number
  occupied_count: number
  percent: number
}

export interface DeviceProgModeInfo {
  address: string
  detected_at: string
  mask_version?: string | null
}

export interface DeviceDetailedInfo {
  address: string
  reachable: boolean
  mask_version?: string | null
  mask_version_raw?: number | null
  manufacturer?: string | null
  manufacturer_id?: number | null
  firmware_version?: string | null
  serial_number?: string | null
  prog_mode: boolean
  rtt_ms?: number | null
}

export interface ProgramAddressResult {
  success: boolean
  old_address?: string | null
  new_address: string
  message: string
}

export interface DeviceLiveStateResult {
  success: boolean
  address: string
  reachable: boolean
  rtt_ms?: number | null
  mask_version?: string | null
  is_synchronized: boolean
  diff_count: number
  diff_details: string[]
  message: string
}

