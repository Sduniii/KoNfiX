export type ProgrammingJobType =
  | 'Partial'
  | 'Full'
  | 'PhysicalAddress'
  | 'FilterTable'
  | 'Restart'
  | 'Verify'

export type ProgrammingJobStatus =
  | 'Queued'
  | 'Connecting'
  | 'Authorizing'
  | 'WritingGAT'
  | 'WritingAT'
  | 'WritingParameters'
  | 'WritingFilterTable'
  | 'Verifying'
  | 'Restarting'
  | 'Success'
  | 'Failed'
  | 'Cancelled'

export interface MemoryDiffChunk {
  address: number
  segment_name: string
  device_bytes_hex: string
  target_bytes_hex: string
  byte_count: number
}

export interface VerificationReport {
  device_id: string
  address: string
  mask_version: string
  is_identical: boolean
  safe_to_flash: boolean
  total_bytes_checked: number
  diff_bytes_count: number
  diff_chunks: MemoryDiffChunk[]
  parameter_diffs: ParameterDiff[]
  summary_message: string
}

export interface ProgrammingJob {
  id: string
  device_id: string
  device_address: string
  device_name: string
  job_type: ProgrammingJobType
  status: ProgrammingJobStatus
  progress_percent: number
  current_step: string
  created_at: string
  completed_at?: string | null
  log_messages: string[]
  verification_report?: VerificationReport | null
}

export interface ParameterDiff {
  param_id: string
  param_name: string
  param_text: string
  old_value: string
  new_value: string
}

export interface DeviceDirtyStatus {
  device_id: string
  is_dirty: boolean
  reasons: string[]
  parameter_diffs?: ParameterDiff[]
  address_changed?: [string, string] | null
  added_gas?: string[]
  removed_gas?: string[]
  added_associations?: [number, string][]
  removed_associations?: [number, string][]
  is_initial?: boolean
  last_flashed?: string | null
  is_secure: boolean
}

export interface KnxDataSecureConfig {
  is_secure_enabled: boolean
  serial_number?: string | null
  fdsk?: string | null
  tool_key?: string | null
  sequence_number: number
}

export interface DeviceFlashedSnapshot {
  flashed_at: string
  individual_address: string
  assigned_gas: string[]
  ko_ga_links: Record<number, string[]>
  parameter_values: Record<string, string>
}


export interface UpdateDeviceSecurityRequest {
  is_secure_enabled: boolean
  serial_number?: string | null
  fdsk?: string | null
  generate_new_tool_key?: boolean
}

export interface CreateJobRequest {
  device_id: string
  job_type: ProgrammingJobType
}
