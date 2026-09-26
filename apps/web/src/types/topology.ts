import { KnxDevice, GroupAddress } from './knx'

export type KnxMediumType = 'Tp' | 'Ip' | 'Rf' | 'Pl'

export type LineCouplerFilterMode = 'Filter' | 'RouteAll' | 'BlockAll'

export interface TopologyLine {
  id: string
  area_id: string
  line_number: number
  address: string
  name: string
  medium: KnxMediumType
  coupler_device_id?: string | null
  coupler_filter_mode: LineCouplerFilterMode
  manual_forward_gas: string[]
  description: string
}

export interface TopologyArea {
  id: string
  area_number: number
  address: string
  name: string
  medium: KnxMediumType
  lines: TopologyLine[]
}

export interface ProjectTopology {
  areas: TopologyArea[]
}

export type FilterAction = 'Forward' | 'Block'

export interface FilterTableEntry {
  ga_address: string
  ga_name: string
  dpt: string
  action: FilterAction
  reason: string
  subline_devices: string[]
  extline_devices: string[]
}

export interface FilterTableSummary {
  line_address: string
  line_name: string
  coupler_address?: string | null
  filter_mode: LineCouplerFilterMode
  total_gas: number
  forwarded_count: number
  filtered_count: number
  entries: FilterTableEntry[]
  raw_bitmap_hex: string
}

export interface TopologyValidationIssue {
  severity: 'error' | 'warning' | 'info'
  message: string
  device_id?: string | null
  device_address?: string | null
  line_address?: string | null
}

export interface TopologyResponse {
  topology: ProjectTopology
  issues: TopologyValidationIssue[]
  devices: KnxDevice[]
  group_addresses: GroupAddress[]
}

export interface AddAreaRequest {
  area_number: number
  name: string
  medium: KnxMediumType
}

export interface AddLineRequest {
  area_id: string
  line_number: number
  name: string
  medium: KnxMediumType
  coupler_filter_mode?: LineCouplerFilterMode
}

export interface UpdateLineRequest {
  name?: string
  medium?: KnxMediumType
  coupler_filter_mode?: LineCouplerFilterMode
  manual_forward_gas?: string[]
  coupler_device_id?: string | null
  description?: string
}

export interface MoveDeviceRequest {
  device_id: string
  target_line_address: string
}
