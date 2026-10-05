export interface StorageSettings {
  data_dir: string
  active_project_name: string | null
  auto_save: boolean
  signing_key?: string | null
}

export interface ProjectMetadata {
  name: string
  filename: string
  path: string
  modified_at: string
  size_bytes: number
  ga_count: number
  device_count: number
  block_count: number
  room_count: number
}

export interface ProjectViewState {
  active_workspace?: 'canvas' | 'topology' | 'diagnostics'
  selected_room_id?: string | null
  selected_block_id?: string | null
  zoom?: number
  pan_x?: number
  pan_y?: number
  portal_positions?: Record<string, { x: number; y: number }>
  room_viewports?: Record<string, { x: number; y: number; zoom: number }>
  [key: string]: any
}

