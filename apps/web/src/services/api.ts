import {
  Project,
  KnxTelegram,
  DiscoveredGateway,
  GatewayConnectionStatus,
  KnxSecureCredentials,
  DecryptedKeyring,
  DetectedImportFile,
  ImportSummary,
  ScannedAddressInfo,
  LineScanProgress,
  DeviceProgModeInfo,
  DeviceDetailedInfo,
  ProgramAddressResult,
  CatalogProduct,
  CatalogProductSummary,
  KnxDevice,
  WireConnection,
  GroupAddress,
  DeviceLiveStateResult,
} from '../types/knx'
import {
  TopologyResponse,
  ProjectTopology,
  FilterTableSummary,
  TopologyValidationIssue,
  AddAreaRequest,
  AddLineRequest,
  UpdateLineRequest,
  MoveDeviceRequest,
} from '../types/topology'
import {
  ProgrammingJob,
  ProgrammingJobType,
  DeviceDirtyStatus,
  KnxDataSecureConfig,
  UpdateDeviceSecurityRequest,
} from '../types/programming'
import {
  StorageSettings,
  ProjectMetadata,
  ProjectViewState,
} from '../types/storage'

const API_BASE = '/api'

export interface AppVersionInfo {
  version: string
  name?: string
}

export async function fetchAppVersion(): Promise<AppVersionInfo> {
  const res = await fetch(`${API_BASE}/version`)
  if (!res.ok) {
    throw new Error(`Failed to load version: ${res.statusText}`)
  }
  return res.json()
}

export async function fetchProject(): Promise<Project> {
  const res = await fetch(`${API_BASE}/project`)
  if (!res.ok) {
    throw new Error(`Failed to load project: ${res.statusText}`)
  }
  return res.json()
}

export async function updateProject(project: Project): Promise<Project> {
  const res = await fetch(`${API_BASE}/project`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(project),
  })
  if (!res.ok) {
    throw new Error(`Failed to save project: ${res.statusText}`)
  }
  return res.json()
}

export async function updateDevicePosition(
  deviceId: string,
  position?: { x: number; y: number } | null,
  roomId?: string | null,
  visibleKoNumbers?: number[]
): Promise<KnxDevice> {
  const res = await fetch(`${API_BASE}/devices/${deviceId}/position`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      position: position !== undefined ? position : undefined,
      room_id: roomId !== undefined ? (roomId || null) : undefined,
      visible_ko_numbers: visibleKoNumbers,
    }),
  })
  if (!res.ok) {
    throw new Error(`Failed to update device position: ${res.statusText}`)
  }
  return res.json()
}

export async function triggerAutoRoute(): Promise<Project> {
  const res = await fetch(`${API_BASE}/project/auto-route`, {
    method: 'POST',
  })
  if (!res.ok) {
    throw new Error(`Auto-route failed: ${res.statusText}`)
  }
  return res.json()
}

export async function simulateAction(
  sourceNodeId: string,
  pin: string,
  value: any
): Promise<KnxTelegram[]> {
  const res = await fetch(`${API_BASE}/simulate/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_node_id: sourceNodeId,
      pin,
      value,
    }),
  })
  if (!res.ok) {
    throw new Error(`Simulation action failed: ${res.statusText}`)
  }
  return res.json()
}

export function downloadEtsCsv() {
  window.open(`${API_BASE}/project/export/ets-csv`, '_blank')
}

export function downloadEtsXml() {
  window.open(`${API_BASE}/project/export/ets-xml`, '_blank')
}

export async function downloadKnxproj(options?: { password?: string }): Promise<void> {
  const pwd = options?.password?.trim()
  if (!pwd) {
    const link = document.createElement('a')
    link.href = `${API_BASE}/project/export/knxproj`
    link.download = ''
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    return
  }

  const res = await fetch(`${API_BASE}/project/export/knxproj`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pwd }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(errText || `Export fehlgeschlagen (${res.status})`)
  }

  const blob = await res.blob()
  const contentDisposition = res.headers.get('Content-Disposition')
  let filename = 'knx_project.knxproj'
  if (contentDisposition) {
    const match = contentDisposition.match(/filename="?([^";]+)"?/)
    if (match && match[1]) {
      filename = match[1]
    }
  }

  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.URL.revokeObjectURL(url)
}

export async function discoverGateways(): Promise<DiscoveredGateway[]> {
  const res = await fetch(`${API_BASE}/knx/discover`)
  if (!res.ok) {
    throw new Error(`Gateway discovery failed: ${res.statusText}`)
  }
  return res.json()
}

export async function connectGateway(
  ip: string,
  port: number = 3671,
  secure?: KnxSecureCredentials | null
): Promise<{ success: boolean; message?: string }> {
  const res = await fetch(`${API_BASE}/knx/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ip, port, secure }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error(err.message || `Connection failed: ${res.statusText}`)
  }
  return res.json()
}

export async function disconnectGateway(): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/knx/disconnect`, {
    method: 'POST',
  })
  if (!res.ok) {
    throw new Error(`Disconnect failed: ${res.statusText}`)
  }
  return res.json()
}

export async function getGatewayStatus(): Promise<GatewayConnectionStatus> {
  const res = await fetch(`${API_BASE}/knx/status`)
  if (!res.ok) {
    throw new Error(`Status query failed: ${res.statusText}`)
  }
  return res.json()
}

export async function fetchLocalKeyrings(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/knx/keyring/local-files`)
  if (!res.ok) {
    return []
  }
  return res.json()
}

export async function decryptKeyring(options: {
  filePath?: string
  content?: string
  password: string
}): Promise<DecryptedKeyring> {
  const res = await fetch(`${API_BASE}/knx/keyring/decrypt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_path: options.filePath,
      content: options.content,
      password: options.password,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `Keyring Entschlüsselung fehlgeschlagen: ${res.statusText}`)
  }
  return res.json()
}

export async function connectKeyring(options: {
  ip: string
  port?: number
  filePath?: string
  content?: string
  password: string
  userId?: number
}): Promise<{ success: boolean; message: string; tunnel_used: number; project: string }> {
  const res = await fetch(`${API_BASE}/knx/connect-keyring`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ip: options.ip,
      port: options.port,
      file_path: options.filePath,
      content: options.content,
      password: options.password,
      user_id: options.userId,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `Verbindung über Schlüsselbund fehlgeschlagen: ${res.statusText}`)
  }
  return res.json()
}

export async function fetchLocalImportFiles(): Promise<DetectedImportFile[]> {
  const res = await fetch(`${API_BASE}/knx/import/local-files`)
  if (!res.ok) {
    return []
  }
  return res.json()
}

export async function importEtsCsv(options: {
  filePath?: string
  content?: string
  projectName?: string
}): Promise<ImportSummary> {
  const res = await fetch(`${API_BASE}/knx/import/csv`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_path: options.filePath,
      content: options.content,
      project_name: options.projectName,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `ETS CSV Import fehlgeschlagen: ${res.statusText}`)
  }
  return res.json()
}

export async function importKnxproj(options: {
  filePath?: string
  contentBase64?: string
  password?: string
  projectName?: string
}): Promise<ImportSummary> {
  const res = await fetch(`${API_BASE}/knx/import/knxproj`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_path: options.filePath,
      content_base64: options.contentBase64,
      password: options.password,
      project_name: options.projectName,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `ETS .knxproj Import fehlgeschlagen: ${res.statusText}`)
  }
  return res.json()
}

export async function sendKnxTelegram(
  destination: string,
  dpt: string,
  value: any
): Promise<{ success: boolean; telegram: KnxTelegram }> {
  const res = await fetch(`${API_BASE}/knx/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      destination,
      dpt,
      value,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `Telegramm senden fehlgeschlagen: ${res.statusText}`)
  }
  return res.json()
}

// ==========================================
// KNX DIAGNOSTICS & MANAGEMENT API
// ==========================================

export async function getDiagnosticsResults(): Promise<ScannedAddressInfo[]> {
  const res = await fetch(`${API_BASE}/diagnostics/results`)
  if (!res.ok) {
    throw new Error(`Failed to load scan results: ${res.statusText}`)
  }
  return res.json()
}

export async function getDiagnosticsProgress(): Promise<LineScanProgress> {
  const res = await fetch(`${API_BASE}/diagnostics/progress`)
  if (!res.ok) {
    throw new Error(`Failed to load scan progress: ${res.statusText}`)
  }
  return res.json()
}

export async function startLineScan(
  line: string,
  start: number = 1,
  end: number = 255
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/diagnostics/scan/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ line, start, end }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `Scan-Start fehlgeschlagen: ${res.statusText}`)
  }
  return res.json()
}

export async function stopLineScan(): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/diagnostics/scan/stop`, {
    method: 'POST',
  })
  if (!res.ok) {
    throw new Error(`Scan-Stopp fehlgeschlagen: ${res.statusText}`)
  }
  return res.json()
}

export async function scanProgrammingMode(
  timeoutMs: number = 1500
): Promise<DeviceProgModeInfo[]> {
  const res = await fetch(`${API_BASE}/diagnostics/prog-mode/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeout_ms: timeoutMs }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `Programmiermodus-Scan fehlgeschlagen: ${res.statusText}`)
  }
  return res.json()
}

export async function getProgrammingModeDevices(): Promise<DeviceProgModeInfo[]> {
  const res = await fetch(`${API_BASE}/diagnostics/prog-mode/devices`)
  if (!res.ok) {
    throw new Error(`Failed to load programming mode devices: ${res.statusText}`)
  }
  return res.json()
}

export async function queryDeviceInfo(address: string): Promise<DeviceDetailedInfo> {
  const res = await fetch(`${API_BASE}/diagnostics/device-info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `Geräte-Info Abfrage fehlgeschlagen: ${res.statusText}`)
  }
  return res.json()
}

export async function programIndividualAddress(
  targetAddress: string,
  deviceId?: string
): Promise<ProgramAddressResult> {
  const res = await fetch(`${API_BASE}/diagnostics/program-address`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_address: targetAddress, device_id: deviceId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `Programmieren der physikalischen Adresse fehlgeschlagen: ${res.statusText}`)
  }
  return res.json()
}

export async function fetchCatalogProducts(): Promise<CatalogProductSummary[]> {
  const res = await fetch(`${API_BASE}/catalog/products`)
  if (!res.ok) {
    throw new Error(`Katalog konnte nicht geladen werden: ${res.statusText}`)
  }
  return res.json()
}

export async function fetchCatalogProduct(id: string): Promise<CatalogProduct> {
  const res = await fetch(`${API_BASE}/catalog/products/${encodeURIComponent(id)}`)
  if (!res.ok) {
    throw new Error(`Produktdetails konnten nicht geladen werden: ${res.statusText}`)
  }
  return res.json()
}

export async function importKnxprodFile(
  filePath?: string,
  dataBase64?: string
): Promise<CatalogProductSummary[]> {
  const res = await fetch(`${API_BASE}/catalog/import-knxprod`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_path: filePath, data_base64: dataBase64 }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `.knxprod Import fehlgeschlagen: ${res.statusText}`)
  }
  return res.json()
}

export interface DownloadDefaultCatalogResponse {
  success: boolean
  loaded_count: number
  total_catalog_products: number
  message: string
}

export async function downloadDefaultCatalog(): Promise<DownloadDefaultCatalogResponse> {
  const res = await fetch(`${API_BASE}/catalog/download-default`, {
    method: 'POST',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `Fehler beim Laden der Standard-Datenbank: ${res.statusText}`)
  }
  return res.json()
}

export interface SyncProjectCatalogResponse {
  success: boolean
  enriched_count: number
  message: string
  project: Project
}

export async function syncProjectWithCatalog(): Promise<SyncProjectCatalogResponse> {
  const res = await fetch(`${API_BASE}/catalog/sync-project`, {
    method: 'POST',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `Fehler beim Synchronisieren des Projekts: ${res.statusText}`)
  }
  return res.json()
}

export async function createDeviceFromProduct(
  productId: string,
  individualAddress: string,
  customName?: string,
  roomId?: string
): Promise<KnxDevice> {
  const res = await fetch(`${API_BASE}/catalog/create-device`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      product_id: productId,
      individual_address: individualAddress,
      custom_name: customName,
      room_id: roomId,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `Gerät konnte nicht hinzugefügt werden: ${res.statusText}`)
  }
  return res.json()
}

export async function linkKoToGroupAddress(
  deviceId: string,
  koNumber: number,
  groupAddressId?: string,
  groupAddress?: string,
  unlink: boolean = false
): Promise<KnxDevice> {
  const res = await fetch(`${API_BASE}/devices/${deviceId}/kos/${koNumber}/link-ga`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      group_address_id: groupAddressId,
      group_address: groupAddress,
      unlink,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `Verknüpfung der GA fehlgeschlagen: ${res.statusText}`)
  }
  return res.json()
}

export async function updateDeviceParameters(
  deviceId: string,
  parameters: { id: string; value: string }[]
): Promise<KnxDevice> {
  const res = await fetch(`${API_BASE}/devices/${deviceId}/parameters`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parameters }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `Parameter-Aktualisierung fehlgeschlagen: ${res.statusText}`)
  }
  return res.json()
}

export interface ConnectPinsResponse {
  success: boolean
  connection: WireConnection
  group_address?: GroupAddress | null
  project: Project
}

export async function connectPins(
  fromNodeId: string,
  fromPin: string,
  toNodeId: string,
  toPin: string,
  connectionId?: string
): Promise<ConnectPinsResponse> {
  const res = await fetch(`${API_BASE}/wiring/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from_node_id: fromNodeId,
      from_pin: fromPin,
      to_node_id: toNodeId,
      to_pin: toPin,
      connection_id: connectionId,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `Verdrahtung fehlgeschlagen: ${res.statusText}`)
  }
  return res.json()
}

export async function disconnectPins(connectionId: string): Promise<{ success: boolean; project: Project }> {
  const res = await fetch(`${API_BASE}/wiring/disconnect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connection_id: connectionId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `Trennen fehlgeschlagen: ${res.statusText}`)
  }
  return res.json()
}

// ----------------------------------------------------------------------------
// KNX Topology & Filter Table API
// ----------------------------------------------------------------------------

export async function fetchTopology(): Promise<TopologyResponse> {
  const res = await fetch(`${API_BASE}/topology`)
  if (!res.ok) {
    throw new Error(`Fehler beim Laden der Topologie: ${res.statusText}`)
  }
  return res.json()
}

export async function addArea(req: AddAreaRequest): Promise<{ topology: ProjectTopology }> {
  const res = await fetch(`${API_BASE}/topology/areas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `Fehler beim Erstellen des Bereichs: ${res.statusText}`)
  }
  return res.json()
}

export async function addLine(req: AddLineRequest): Promise<{ topology: ProjectTopology }> {
  const res = await fetch(`${API_BASE}/topology/lines`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `Fehler beim Erstellen der Linie: ${res.statusText}`)
  }
  return res.json()
}

export async function updateLine(lineId: string, req: UpdateLineRequest): Promise<{ topology: ProjectTopology }> {
  const res = await fetch(`${API_BASE}/topology/lines/${lineId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `Fehler beim Aktualisieren der Linie: ${res.statusText}`)
  }
  return res.json()
}

export async function deleteLine(lineId: string): Promise<{ topology: ProjectTopology }> {
  const res = await fetch(`${API_BASE}/topology/lines/${lineId}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `Fehler beim Löschen der Linie: ${res.statusText}`)
  }
  return res.json()
}

export async function fetchLineFilterTable(lineId: string): Promise<FilterTableSummary> {
  const res = await fetch(`${API_BASE}/topology/lines/${lineId}/filter-table`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `Fehler beim Berechnen der Filtertabelle: ${res.statusText}`)
  }
  return res.json()
}

export async function moveDeviceToLine(
  deviceId: string,
  targetLineAddress: string
): Promise<{ success: boolean; new_address: string; project: Project }> {
  const res = await fetch(`${API_BASE}/topology/devices/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_id: deviceId,
      target_line_address: targetLineAddress,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `Fehler beim Verschieben des Geräts: ${res.statusText}`)
  }
  return res.json()
}

export async function validateTopology(): Promise<{ issues: TopologyValidationIssue[] }> {
  const res = await fetch(`${API_BASE}/topology/validate`)
  if (!res.ok) {
    throw new Error(`Fehler bei der Topologie-Validierung: ${res.statusText}`)
  }
  return res.json()
}

// ----------------------------------------------------------------------------
// Differential Programming & KNX Data Secure API
// ----------------------------------------------------------------------------

export async function fetchProgrammingJobs(): Promise<ProgrammingJob[]> {
  const res = await fetch(`${API_BASE}/programming/jobs`)
  if (!res.ok) {
    throw new Error(`Fehler beim Abrufen der Programmier-Jobs: ${res.statusText}`)
  }
  return res.json()
}

export async function createProgrammingJob(
  deviceId: string,
  jobType: ProgrammingJobType
): Promise<ProgrammingJob> {
  const res = await fetch(`${API_BASE}/programming/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId, job_type: jobType }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `Fehler beim Erstellen des Programmier-Jobs: ${res.statusText}`)
  }
  return res.json()
}

export async function flashFilterTable(lineId: string): Promise<ProgrammingJob> {
  const res = await fetch(`${API_BASE}/programming/lines/${lineId}/flash-filter-table`, {
    method: 'POST',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `Fehler beim Flashen der Filtertabelle: ${res.statusText}`)
  }
  return res.json()
}

export async function cancelProgrammingJob(jobId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/programming/jobs/${jobId}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `Fehler beim Abbrechen des Jobs: ${res.statusText}`)
  }
}

export async function checkDeviceDirty(deviceId: string): Promise<DeviceDirtyStatus> {
  const res = await fetch(`${API_BASE}/devices/${deviceId}/dirty`)
  if (!res.ok) {
    throw new Error(`Fehler beim Prüfen des Gerätestatus: ${res.statusText}`)
  }
  return res.json()
}

export async function readDeviceLiveState(deviceId: string): Promise<DeviceLiveStateResult> {
  const res = await fetch(`${API_BASE}/devices/${deviceId}/read-state`, {
    method: 'POST',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `Fehler beim Auslesen des Geräts: ${res.statusText}`)
  }
  return res.json()
}

export async function markDeviceSynced(deviceId: string): Promise<DeviceDirtyStatus> {
  const res = await fetch(`${API_BASE}/devices/${deviceId}/mark-synced`, {
    method: 'POST',
  })
  if (!res.ok) {
    throw new Error(`Fehler beim Synchronisieren des Gerätestatus: ${res.statusText}`)
  }
  return res.json()
}

export async function updateDeviceSecurity(
  deviceId: string,
  req: UpdateDeviceSecurityRequest
): Promise<{ success: boolean; security: KnxDataSecureConfig }> {
  const res = await fetch(`${API_BASE}/devices/${deviceId}/security`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `Fehler beim Speichern der Sicherheitskonfiguration: ${res.statusText}`)
  }
  return res.json()
}

// ============================================================================
// Storage & Persistence API (~/.konfix)
// ============================================================================

export async function fetchStorageSettings(): Promise<StorageSettings> {
  const res = await fetch(`${API_BASE}/storage/settings`)
  if (!res.ok) {
    throw new Error(`Fehler beim Laden der Speicher-Einstellungen: ${res.statusText}`)
  }
  return res.json()
}

export async function updateStorageSettings(
  dataDir: string,
  migrate: boolean = true
): Promise<StorageSettings> {
  const res = await fetch(`${API_BASE}/storage/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data_dir: dataDir, migrate }),
  })
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText)
    throw new Error(err || 'Fehler beim Aktualisieren des Speicherorts')
  }
  return res.json()
}

export async function listStorageProjects(): Promise<ProjectMetadata[]> {
  const res = await fetch(`${API_BASE}/storage/projects`)
  if (!res.ok) {
    throw new Error(`Fehler beim Auflisten der Projekte: ${res.statusText}`)
  }
  return res.json()
}

export async function saveStorageProject(name?: string, project?: Project): Promise<ProjectMetadata> {
  const res = await fetch(`${API_BASE}/storage/projects/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, project }),
  })
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText)
    throw new Error(err || 'Fehler beim Speichern des Projekts')
  }
  return res.json()
}

export async function loadStorageProject(name: string): Promise<Project> {
  const res = await fetch(`${API_BASE}/storage/projects/load`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText)
    throw new Error(err || `Fehler beim Laden des Projekts '${name}'`)
  }
  return res.json()
}

export async function createStorageProject(name: string): Promise<Project> {
  const res = await fetch(`${API_BASE}/storage/projects/new`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText)
    throw new Error(err || `Fehler beim Erstellen des Projekts '${name}'`)
  }
  return res.json()
}

export async function fetchStorageView(project?: string): Promise<ProjectViewState | null> {
  const url = project ? `${API_BASE}/storage/view?project=${encodeURIComponent(project)}` : `${API_BASE}/storage/view`
  const res = await fetch(url)
  if (!res.ok) return null
  return res.json()
}

export async function saveStorageView(viewData: ProjectViewState, project?: string): Promise<void> {
  const payload = { ...viewData, ...(project ? { project } : {}) }
  await fetch(`${API_BASE}/storage/view`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}





