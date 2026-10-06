import React, { useState, useEffect } from 'react'
import {
  Sliders,
  Network,
  Tag,
  Trash2,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  Lock,
  Unlock,
  Sparkles,
  Edit2,
  Check,
  Activity,
  Layers,
  Plus,
  X,
  Search,
  RotateCcw,
  Save,
  Zap,
  ChevronDown,
  Play,
  Info,
  AlertCircle,
} from 'lucide-react'
import { Project, FunctionBlock, GroupAddress, KnxDevice, DeviceLiveStateResult } from '../../types/knx'
import {
  linkKoToGroupAddress,
  updateDeviceParameters,
  createProgrammingJob,
  checkDeviceDirty,
  markDeviceSynced,
  readDeviceLiveState,
} from '../../services/api'
import { ProgrammingJobType, DeviceDirtyStatus } from '../../types/programming'
import { useTranslation } from '../../i18n/I18nContext'
import { ParameterInputField } from '../devices/ParameterInputField'

interface RightSidebarProps {
  project: Project | null
  selectedBlockId: string | null
  onUpdateBlockParams: (blockId: string, params: any) => void
  onDeleteBlock: (blockId: string) => void
  onRemoveChannel?: (channelId: string) => void
  onDeleteDevice?: (deviceId: string) => void
  onUpdateGroupAddress?: (ga: GroupAddress) => void
  onOpenGaManager?: () => void
  onOpenDiagnostics?: (deviceAddress?: string) => void
  onUpdateDevice?: (device: KnxDevice) => void
  onOpenDeviceKoModal?: (device: KnxDevice) => void
  onOpenSecurityModal?: (device: KnxDevice) => void
}

export const RightSidebar: React.FC<RightSidebarProps> = ({
  project,
  selectedBlockId,
  onUpdateBlockParams,
  onDeleteBlock,
  onRemoveChannel,
  onDeleteDevice,
  onUpdateGroupAddress,
  onOpenGaManager,
  onOpenDiagnostics,
  onUpdateDevice,
  onOpenDeviceKoModal,
  onOpenSecurityModal,
}) => {
  const { t } = useTranslation()
  const [editingGaId, setEditingGaId] = useState<string | null>(null)
  const [editAddressInput, setEditAddressInput] = useState<string>('')
  const [editError, setEditError] = useState<string | null>(null)

  // Device Inspector KO & Parameter state
  const [deviceTab, setDeviceTab] = useState<'channels' | 'kos' | 'params'>('channels')
  const [deviceKoSearch, setDeviceKoSearch] = useState('')
  const [deviceParamSearch, setDeviceParamSearch] = useState('')
  const [linkingKoNum, setLinkingKoNum] = useState<number | null>(null)
  const [paramEdits, setParamEdits] = useState<Record<string, string>>({})
  const [isSavingParams, setIsSavingParams] = useState(false)

  // Device Programming & Dirty status
  const [deviceDirty, setDeviceDirty] = useState<DeviceDirtyStatus | null>(null)
  const [isProgrammingDropdownOpen, setIsProgrammingDropdownOpen] = useState<boolean>(false)
  const [isStartingJob, setIsStartingJob] = useState<boolean>(false)
  const [verifyBeforeFlash, setVerifyBeforeFlash] = useState<boolean>(() => {
    return localStorage.getItem('konfix_verify_before_flash') === 'true'
  })

  const handleToggleVerifyBeforeFlash = (checked: boolean) => {
    setVerifyBeforeFlash(checked)
    localStorage.setItem('konfix_verify_before_flash', checked ? 'true' : 'false')
  }

  const handleStartEditGa = (ga: GroupAddress) => {
    setEditingGaId(ga.id)
    setEditAddressInput(ga.address)
    setEditError(null)
  }

  const handleSaveGa = (ga: GroupAddress) => {
    const parts = editAddressInput.trim().split('/')
    if (parts.length !== 3) {
      setEditError('Format: 0..31/0..7/0..255')
      return
    }
    const main = parseInt(parts[0], 10)
    const middle = parseInt(parts[1], 10)
    const sub = parseInt(parts[2], 10)
    if (
      isNaN(main) ||
      isNaN(middle) ||
      isNaN(sub) ||
      main < 0 ||
      main > 31 ||
      middle < 0 ||
      middle > 7 ||
      sub < 0 ||
      sub > 255
    ) {
      setEditError('KNX-Grenzen: 0..31 / 0..7 / 0..255')
      return
    }
    const collision = project?.group_addresses.find(
      (g) => g.id !== ga.id && g.address === `${main}/${middle}/${sub}`
    )
    if (collision) {
      setEditError(`Bereits belegt durch "${collision.name}"!`)
      return
    }
    onUpdateGroupAddress?.({
      ...ga,
      address: `${main}/${middle}/${sub}`,
      main,
      middle,
      sub,
      is_custom: true,
    })
    setEditingGaId(null)
  }

  const handleResetGaToAuto = (ga: GroupAddress) => {
    onUpdateGroupAddress?.({
      ...ga,
      is_custom: false,
    })
    setEditingGaId(null)
  }
  const selectedBlock = project?.blocks.find((b) => b.id === selectedBlockId)
  const selectedDevice = project?.devices.find((d) => d.id === selectedBlockId)

  const [showDirtyReasons, setShowDirtyReasons] = useState<boolean>(false)
  const [isMarkingSynced, setIsMarkingSynced] = useState<boolean>(false)
  const [isReadingLive, setIsReadingLive] = useState<boolean>(false)
  const [liveResult, setLiveResult] = useState<DeviceLiveStateResult | null>(null)

  // Fetch dirty status whenever selectedDevice changes
  useEffect(() => {
    if (selectedDevice) {
      checkDeviceDirty(selectedDevice.id)
        .then(setDeviceDirty)
        .catch(() => setDeviceDirty(null))
    } else {
      setDeviceDirty(null)
    }
    setIsProgrammingDropdownOpen(false)
    setShowDirtyReasons(false)
    setLiveResult(null)
  }, [selectedDevice?.id])

  const handleStartProgramming = async (jobType: ProgrammingJobType) => {
    if (!selectedDevice) return
    setIsStartingJob(true)
    setIsProgrammingDropdownOpen(false)
    try {
      const targetJobType =
        verifyBeforeFlash && (jobType === 'Partial' || jobType === 'Full')
          ? 'Verify'
          : jobType
      await createProgrammingJob(selectedDevice.id, targetJobType)
      const status = await checkDeviceDirty(selectedDevice.id)
      setDeviceDirty(status)
    } catch (err: any) {
      alert(err.message || 'Fehler beim Starten des Programmier-Jobs')
    } finally {
      setIsStartingJob(false)
    }
  }

  const handleMarkSynced = async () => {
    if (!selectedDevice) return
    setIsMarkingSynced(true)
    try {
      const status = await markDeviceSynced(selectedDevice.id)
      setDeviceDirty(status)
      setShowDirtyReasons(false)
    } catch (err: any) {
      alert(err.message || 'Fehler beim Markieren als synchronisiert')
    } finally {
      setIsMarkingSynced(false)
    }
  }

  const handleReadLiveState = async () => {
    if (!selectedDevice) return
    setIsReadingLive(true)
    try {
      const res = await readDeviceLiveState(selectedDevice.id)
      setLiveResult(res)
      if (res.reachable) {
        const dirty = await checkDeviceDirty(selectedDevice.id)
        setDeviceDirty(dirty)
      }
    } catch (err: any) {
      setLiveResult({
        success: false,
        address: selectedDevice.individual_address,
        reachable: false,
        is_synchronized: false,
        diff_count: 0,
        diff_details: [],
        message: err.message || 'Kommunikationsfehler mit dem KNX-Gateway',
      })
    } finally {
      setIsReadingLive(false)
    }
  }

  // Check if selected is a hardware channel terminal
  const selectedChannelInfo = project
    ? (() => {
        for (const dev of project.devices) {
          const ch = dev.channels.find((c) => c.id === selectedBlockId)
          if (ch) return { channel: ch, device: dev }
        }
        return null
      })()
    : null

  // Filter GAs generated by this block
  const blockGas: GroupAddress[] =
    project?.group_addresses.filter((ga) => ga.origin_block_id === selectedBlockId) ?? []

  const room = project?.rooms.find((r) => r.id === (selectedBlock?.room_id || selectedChannelInfo?.channel.room_id))

  // Find GA for selected channel terminal if wired
  const channelGa = selectedChannelInfo && project ? (() => {
    const ch = selectedChannelInfo.channel
    const dev = selectedChannelInfo.device
    const conn = project.connections.find(
      (c) =>
        c.from_node_id === ch.id ||
        c.to_node_id === ch.id ||
        (c.from_node_id === dev.id && (c.from_pin === `out-${ch.id}` || c.from_pin === 'out')) ||
        (c.to_node_id === dev.id && (c.to_pin === `in-${ch.id}` || c.to_pin === 'in'))
    )
    if (!conn) return undefined
    return project.group_addresses.find(
      (g) =>
        (g.origin_block_id === conn.from_node_id && g.origin_pin_name === conn.from_pin) ||
        (g.origin_block_id === conn.to_node_id)
    )
  })() : undefined

  return (
    <aside className="w-80 border-l border-slate-800 bg-slate-900/95 flex flex-col select-none shrink-0 z-20">
      {/* Header */}
      <div className="h-10 border-b border-slate-800 px-4 flex items-center justify-between text-xs font-semibold text-slate-300 bg-slate-950/40">
        <div className="flex items-center gap-1.5">
          <Sliders className="w-3.5 h-3.5 text-emerald-400" />
          <span>
            {selectedBlock
              ? 'Baustein-Eigenschaften'
              : selectedChannelInfo
              ? 'Kanal-Eigenschaften'
              : selectedDevice
              ? 'Geräte-Eigenschaften'
              : t('inspector.projectInspector')}
          </span>
        </div>
        {selectedBlock && (
          <button
            onClick={() => onDeleteBlock(selectedBlock.id)}
            className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Baustein löschen"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
        {selectedDevice && onDeleteDevice && (
          <button
            onClick={() => {
              if (
                window.confirm(
                  `Gerät "${selectedDevice.name}" (${selectedDevice.individual_address}) und alle zugehörigen Klemmen/Verbindungen wirklich löschen?`
                )
              ) {
                onDeleteDevice(selectedDevice.id)
              }
            }}
            className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Gerät löschen"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
        {selectedChannelInfo && onRemoveChannel && (
          <button
            onClick={() => onRemoveChannel(selectedChannelInfo.channel.id)}
            className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Kanal von Canvas entfernen"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {selectedBlock ? (
          <>
            {/* General Info */}
            <div className="space-y-3">
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Allgemein
              </div>
              <div className="space-y-2 text-xs">
                <div>
                  <label className="text-slate-400 text-[11px] block mb-1">Baustein-Name</label>
                  <input
                    type="text"
                    value={selectedBlock.name}
                    readOnly
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200 font-medium"
                  />
                </div>
                <div>
                  <label className="text-slate-400 text-[11px] block mb-1">Zugewiesener Raum</label>
                  <div className="bg-slate-800/80 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-300">
                    {room ? room.name : 'Kein Raum (Global)'}
                  </div>
                </div>
              </div>
            </div>

            {/* Generated KNX Group Addresses Table */}
            <div className="space-y-3">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <span className="flex items-center gap-1.5">
                  <Network className="w-3.5 h-3.5 text-emerald-400" />
                  Auto-GAs (KNX)
                </span>
                <span className="text-emerald-400 font-mono text-[10px]">
                  {blockGas.length} zugewiesen
                </span>
              </div>

              <div className="space-y-1.5">
                {blockGas.map((ga) => {
                  const isEditing = editingGaId === ga.id

                  return (
                    <div
                      key={ga.id}
                      className={`p-2.5 rounded-lg border transition-all space-y-1.5 ${
                        ga.is_custom
                          ? 'border-amber-500/40 bg-amber-950/20'
                          : 'border-slate-800 bg-slate-950/50'
                      }`}
                    >
                      <div className="flex items-center justify-between font-mono">
                        {isEditing ? (
                          <div className="flex items-center gap-1.5 flex-1 mr-2">
                            <input
                              type="text"
                              value={editAddressInput}
                              onChange={(e) => setEditAddressInput(e.target.value)}
                              className="w-24 bg-slate-800 border border-emerald-500 rounded px-1.5 py-0.5 text-xs text-emerald-400 font-bold focus:outline-none"
                              placeholder="1/1/10"
                              autoFocus
                            />
                            <button
                              onClick={() => handleSaveGa(ga)}
                              className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[10px] font-sans font-semibold transition-colors"
                            >
                              OK
                            </button>
                            <button
                              onClick={() => setEditingGaId(null)}
                              className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded text-[10px] font-sans transition-colors"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`font-bold text-xs px-1.5 py-0.5 rounded border ${
                                ga.is_custom
                                  ? 'bg-amber-950/80 text-amber-400 border-amber-800/60'
                                  : 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/40'
                              }`}
                            >
                              {ga.address}
                            </span>
                            {ga.is_custom ? (
                              <span className="flex items-center gap-0.5 text-[9px] font-sans font-semibold text-amber-400 bg-amber-500/10 px-1 py-0.2 rounded border border-amber-500/30">
                                <Lock className="w-2.5 h-2.5" /> Fixiert
                              </span>
                            ) : (
                              <span className="flex items-center gap-0.5 text-[9px] font-sans text-emerald-400/80 bg-emerald-500/10 px-1 py-0.2 rounded">
                                <Sparkles className="w-2.5 h-2.5" /> Auto
                              </span>
                            )}
                          </div>
                        )}

                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
                            DPT {ga.dpt}
                          </span>
                          {!isEditing && (
                            <>
                              <button
                                onClick={() => handleStartEditGa(ga)}
                                className="p-0.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                                title="Gruppenadresse manuell anpassen"
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                              {ga.is_custom && (
                                <button
                                  onClick={() => handleResetGaToAuto(ga)}
                                  className="p-0.5 rounded text-amber-400 hover:text-emerald-400 hover:bg-slate-800 transition-colors"
                                  title="Auf Auto-Routing zurücksetzen"
                                >
                                  <Unlock className="w-3 h-3" />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>

                      {isEditing && editError && (
                        <div className="text-[10px] text-red-400 font-sans">{editError}</div>
                      )}

                      <div className="text-[11px] text-slate-200 font-medium truncate" title={ga.name}>
                        {ga.name}
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          <span>Pin:</span>
                          <span className="text-sky-400 font-bold">{ga.origin_pin_name}</span>
                        </div>
                        {ga.is_custom && (
                          <span className="text-[9px] text-amber-500/80 font-sans">
                            Gesperrt für Auto-Router
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Parameters */}
            <div className="space-y-3">
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Parameter
              </div>
              <div className="space-y-2 text-xs">
                {selectedBlock.block_type === 'LightController' && (
                  <>
                    <div>
                      <label className="text-slate-400 text-[11px] block mb-1">Dimm-Fahrzeit (Sekunden)</label>
                      <input
                        type="number"
                        defaultValue={selectedBlock.parameters?.fade_time_sec ?? 1.5}
                        step="0.5"
                        className="w-full bg-slate-800 border border-slate-700 rounded px-2.5 py-1 text-slate-200"
                      />
                    </div>
                    <div>
                      <label className="text-slate-400 text-[11px] block mb-1">Einschalt-Helligkeit (%)</label>
                      <input
                        type="number"
                        defaultValue={selectedBlock.parameters?.default_brightness ?? 80}
                        min="1"
                        max="100"
                        className="w-full bg-slate-800 border border-slate-700 rounded px-2.5 py-1 text-slate-200"
                      />
                    </div>
                  </>
                )}

                {selectedBlock.block_type === 'BlindController' && (
                  <>
                    <div>
                      <label className="text-slate-400 text-[11px] block mb-1">Gesamtfahrzeit (Sekunden)</label>
                      <input
                        type="number"
                        defaultValue={selectedBlock.parameters?.travel_time_sec ?? 32}
                        className="w-full bg-slate-800 border border-slate-700 rounded px-2.5 py-1 text-slate-200"
                      />
                    </div>
                    <div>
                      <label className="text-slate-400 text-[11px] block mb-1">Lamellen-Wendelaufzeit (Sek.)</label>
                      <input
                        type="number"
                        defaultValue={selectedBlock.parameters?.slat_time_sec ?? 2.5}
                        step="0.1"
                        className="w-full bg-slate-800 border border-slate-700 rounded px-2.5 py-1 text-slate-200"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          </>
        ) : selectedChannelInfo ? (
          /* Channel Terminal Inspector */
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Hardware-Kanal (Klemme)
              </div>
              <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/40 space-y-2 text-xs">
                <div>
                  <label className="text-slate-400 text-[11px] block mb-1">Kanal-Bezeichnung</label>
                  <div className="font-semibold text-slate-200">{selectedChannelInfo.channel.name}</div>
                </div>
                <div className="flex justify-between border-t border-slate-800/80 pt-2">
                  <span className="text-slate-400">Kanal-Code:</span>
                  <span className="font-mono text-sky-400 font-bold bg-sky-950/80 px-1.5 py-0.5 rounded border border-sky-800/40">
                    {selectedChannelInfo.channel.channel_code}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Kanal-Typ:</span>
                  <span className="text-slate-300 font-mono">{selectedChannelInfo.channel.channel_type}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Raum:</span>
                  <span className="text-slate-200 font-medium">{room ? room.name : 'Kein Raum (Global)'}</span>
                </div>
                {selectedChannelInfo.channel.position && (
                  <div className="flex justify-between border-t border-slate-800/80 pt-2">
                    <span className="text-slate-400">Position (X, Y):</span>
                    <span className="text-slate-300 font-mono">
                      {Math.round(selectedChannelInfo.channel.position.x)}, {Math.round(selectedChannelInfo.channel.position.y)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Parent Hardware Device Info */}
            <div className="space-y-2">
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Zugehöriges KNX-Gerät
              </div>
              <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/40 space-y-2 text-xs">
                <div className="font-semibold text-slate-200">{selectedChannelInfo.device.name}</div>
                <div className="flex justify-between border-t border-slate-800/80 pt-2">
                  <span className="text-slate-400">Phys. Adresse:</span>
                  <span className="font-mono text-emerald-400 font-bold bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-800/40">
                    {selectedChannelInfo.device.individual_address}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Hersteller:</span>
                  <span className="text-slate-300">{selectedChannelInfo.device.manufacturer}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Modell:</span>
                  <span className="text-slate-300 font-mono">{selectedChannelInfo.device.model}</span>
                </div>
                {onOpenDiagnostics && (
                  <button
                    type="button"
                    onClick={() => onOpenDiagnostics(selectedChannelInfo.device.individual_address)}
                    className="w-full mt-2 flex items-center justify-center gap-1.5 py-1 px-2 rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 text-[11px] font-medium transition-colors"
                  >
                    <Activity className="w-3 h-3 text-sky-400" />
                    <span>In ETS-Diagnose prüfen</span>
                  </button>
                )}
              </div>
            </div>

            {/* Linked Group Address */}
            <div className="space-y-2">
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Verknüpfte KNX Gruppenadresse
              </div>
              {channelGa ? (
                <div className="p-3 rounded-xl border border-emerald-800/60 bg-emerald-950/20 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between font-mono">
                    <span className="text-emerald-400 font-bold bg-emerald-950 px-2 py-0.5 rounded border border-emerald-700/60 text-xs">
                      {channelGa.address}
                    </span>
                    <span className="text-[10px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
                      DPT {channelGa.dpt}
                    </span>
                  </div>
                  <div className="text-slate-200 font-medium">{channelGa.name}</div>
                </div>
              ) : (
                <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/40 text-xs text-slate-400 italic">
                  Noch keine Gruppenadresse verdrahtet. Ziehe eine Verbindungslinie zwischen Klemme und Funktionsbaustein.
                </div>
              )}
            </div>
          </div>
        ) : selectedDevice ? (
          /* Device Inspector when a physical device is selected */
          <div className="space-y-4">
            {/* Device Basic Info Card */}
            <div className="space-y-2">
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Geräte-Information
              </div>
              <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/40 space-y-2 text-xs">
                <div>
                  <label className="text-slate-400 text-[11px] block mb-1">Gerätename</label>
                  <div className="font-semibold text-slate-200">{selectedDevice.name}</div>
                </div>
                <div className="flex justify-between border-t border-slate-800/80 pt-2">
                  <span className="text-slate-400">Phys. Adresse:</span>
                  <span className="font-mono text-sky-400 font-bold bg-sky-950/80 px-1.5 py-0.5 rounded border border-sky-800/40">
                    {selectedDevice.individual_address}
                  </span>
                </div>
                {selectedDevice.security?.serial_number && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Seriennummer:</span>
                    <span className="font-mono text-emerald-400 font-semibold text-[10px] bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/40">
                      {selectedDevice.security.serial_number}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-400">Hersteller:</span>
                  <span className="text-slate-300">{selectedDevice.manufacturer}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Modell:</span>
                  <span className="text-slate-300 font-mono">{selectedDevice.model}</span>
                </div>
                {selectedDevice.application_program && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Applikation:</span>
                    <span className="text-slate-300 font-mono text-[10px] truncate max-w-[170px]" title={selectedDevice.application_program}>
                      {selectedDevice.application_program}
                    </span>
                  </div>
                )}
                {selectedDevice.bus_current_ma && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Stromaufnahme:</span>
                    <span className="text-slate-300 font-mono">{selectedDevice.bus_current_ma} mA</span>
                  </div>
                )}
              </div>
            </div>

            {/* Programming & KNX Data Secure Card */}
            <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/40 space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  Bus-Synchronisation
                </span>
                {deviceDirty ? (
                  deviceDirty.is_dirty ? (
                    <button
                      type="button"
                      onClick={() => setShowDirtyReasons(!showDirtyReasons)}
                      className="text-[10px] font-bold text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 px-2 py-0.5 rounded flex items-center gap-1 transition-colors cursor-pointer"
                      title="Klicken, um die genauen Unterschiede zum Bus anzuzeigen"
                    >
                      <span>Geändert (Flash nötig)</span>
                      <Info className="w-3 h-3 text-amber-400" />
                    </button>
                  ) : (
                    <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Synchronisiert
                    </span>
                  )
                ) : (
                  <span className="text-[10px] text-slate-500">Prüfe Status...</span>
                )}
              </div>

              {/* Expandable Reasons Box */}
              {deviceDirty?.is_dirty && showDirtyReasons && (
                <div className="p-2.5 rounded-lg bg-amber-950/30 border border-amber-500/30 space-y-2 text-[11px] animate-in fade-in duration-150">
                  <div className="flex items-center justify-between font-semibold text-amber-300">
                    <span className="flex items-center gap-1">
                      <Info className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span>Erkannte Änderungen zum Bus:</span>
                    </span>
                    <span className="text-[10px] text-amber-400/80 font-mono">
                      {deviceDirty.reasons?.length ?? 0} {deviceDirty.reasons?.length === 1 ? 'Eintrag' : 'Einträge'}
                    </span>
                  </div>

                  <ul className="space-y-1.5 max-h-48 overflow-y-auto pr-1 text-slate-300 text-[11px]">
                    {deviceDirty.reasons && deviceDirty.reasons.length > 0 ? (
                      deviceDirty.reasons.map((r, i) => (
                        <li key={i} className="flex items-start gap-1.5 leading-snug bg-slate-900/60 p-1.5 rounded border border-slate-800">
                          <span className="text-amber-400 select-none font-bold shrink-0">•</span>
                          <span className="break-words">{r}</span>
                        </li>
                      ))
                    ) : (
                      <li className="text-slate-400 italic">Keine näheren Details verfügbar.</li>
                    )}
                  </ul>

                  <div className="pt-1.5 border-t border-amber-500/20 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                      <span>Gerät bereits auf diesem Stand?</span>
                    </div>
                    <button
                      type="button"
                      disabled={isMarkingSynced}
                      onClick={handleMarkSynced}
                      className="w-full py-1 px-2 rounded bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-emerald-400 border border-emerald-500/30 text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors"
                      title="Setzt den Snapshot auf den aktuellen Zustand, ohne Telegramme auf den Bus zu senden"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{isMarkingSynced ? 'Speichere...' : 'Als synchronisiert markieren'}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Live Readout & Comparison Button */}
              <div className="pt-1">
                <button
                  type="button"
                  disabled={isReadingLive}
                  onClick={handleReadLiveState}
                  className="w-full py-1.5 px-2.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 active:bg-sky-500/30 text-sky-400 border border-sky-500/30 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                  title="Fragt das physikalische Gerät live über den Bus ab (Device-Descriptor & Maske)"
                >
                  <Activity className={`w-3.5 h-3.5 ${isReadingLive ? 'animate-spin' : ''}`} />
                  <span>{isReadingLive ? 'Lese Gerät aus...' : 'Vom Gerät auslesen & vergleichen'}</span>
                </button>
              </div>

              {/* Live Result Details */}
              {liveResult && (
                <div
                  className={`p-2.5 rounded-lg border text-[11px] space-y-1.5 animate-in fade-in duration-150 ${
                    liveResult.reachable
                      ? liveResult.is_synchronized
                        ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-200'
                        : 'bg-amber-950/30 border-amber-500/30 text-amber-200'
                      : 'bg-red-950/30 border-red-500/30 text-red-200'
                  }`}
                >
                  <div className="flex items-center justify-between font-semibold">
                    <span className="flex items-center gap-1">
                      {liveResult.reachable ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                      )}
                      <span>{liveResult.reachable ? 'Gerät online & erreichbar' : 'Gerät antwortet nicht'}</span>
                    </span>
                    {liveResult.rtt_ms !== undefined && liveResult.rtt_ms !== null && (
                      <span className="font-mono text-[10px] text-slate-400">{liveResult.rtt_ms} ms</span>
                    )}
                  </div>

                  {liveResult.mask_version && (
                    <div className="text-[10px] text-slate-300 flex justify-between bg-slate-900/60 px-1.5 py-0.5 rounded border border-slate-800">
                      <span>Maskenversion:</span>
                      <span className="font-mono font-semibold text-sky-400">{liveResult.mask_version}</span>
                    </div>
                  )}

                  <div className="text-[10px] text-slate-300 leading-tight">
                    {liveResult.message}
                  </div>

                  {liveResult.diff_details && liveResult.diff_details.length > 0 && (
                    <div className="pt-1.5 border-t border-amber-500/20 space-y-1">
                      <div className="flex items-center justify-between text-[10px] font-semibold text-amber-300">
                        <span>Abweichungen zum Projekt:</span>
                        <span className="font-mono text-amber-400/80">{liveResult.diff_details.length}</span>
                      </div>
                      <ul className="space-y-1 max-h-32 overflow-y-auto pr-0.5 font-mono text-[10px] text-slate-300">
                        {liveResult.diff_details.map((d, i) => (
                          <li key={i} className="bg-slate-900/80 p-1.5 rounded border border-slate-800 text-[10px] leading-snug">
                            • {d}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Programming Action Buttons */}
              <div className="space-y-1.5 pt-1">
                {/* 2-Stage Mode Toggle */}
                <div className="flex items-center justify-between px-1 pb-1">
                  <label className="flex items-center gap-1.5 cursor-pointer select-none text-slate-300 hover:text-slate-100">
                    <input
                      type="checkbox"
                      checked={verifyBeforeFlash}
                      onChange={(e) => handleToggleVerifyBeforeFlash(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-950 text-amber-500 focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5 cursor-pointer"
                    />
                    <span className="text-[11px] font-medium">Vorher verifizieren (Dry-Run)</span>
                  </label>
                  <span className="text-[10px] font-mono text-slate-400 bg-slate-950 px-1 py-0.2 rounded border border-slate-800">
                    {verifyBeforeFlash ? '2-Stufig' : 'Direkt'}
                  </span>
                </div>

                <div className="relative">
                  <div className="flex rounded-lg overflow-hidden shadow-sm">
                    <button
                      type="button"
                      disabled={isStartingJob}
                      onClick={() => handleStartProgramming('Partial')}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 ${
                        verifyBeforeFlash
                          ? 'bg-cyan-700 hover:bg-cyan-600'
                          : 'bg-amber-600 hover:bg-amber-500'
                      } disabled:opacity-50 text-white text-xs font-semibold transition-colors`}
                      title={
                        verifyBeforeFlash
                          ? 'Führt erst einen Lese-Prüflauf durch und verlangt Freigabe vor dem Schreiben'
                          : 'Flasht differentiell nur geänderte Gruppenadressen und Parameter'
                      }
                    >
                      {verifyBeforeFlash ? (
                        <ShieldCheck className="w-3.5 h-3.5 text-cyan-200" />
                      ) : (
                        <Zap className="w-3.5 h-3.5 text-amber-200" />
                      )}
                      <span>
                        {isStartingJob
                          ? 'Starte...'
                          : verifyBeforeFlash
                          ? 'Prüfen & Flashen (2-Stufig)'
                          : 'Partiell flashen (Smart)'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsProgrammingDropdownOpen(!isProgrammingDropdownOpen)}
                      className={`px-2 ${
                        verifyBeforeFlash
                          ? 'bg-cyan-800 hover:bg-cyan-700 border-cyan-600/30'
                          : 'bg-amber-700 hover:bg-amber-600 border-amber-500/30'
                      } text-white border-l transition-colors flex items-center justify-center`}
                      title="Weitere Programmier-Modi"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={isStartingJob}
                    onClick={() => handleStartProgramming('Verify')}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 bg-cyan-950/50 hover:bg-cyan-900/70 border border-cyan-700/40 text-cyan-300 rounded-lg text-xs font-semibold transition-colors shadow-sm mt-1.5 cursor-pointer"
                    title="Führt einen gefahrlosen Soll-Ist-Speicherabgleich ohne Schreibbefehle durch (100% Lese-Modus)"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Trockenlauf / Prüfen (Dry-Run)</span>
                  </button>

                  {/* Dropdown for other flash actions */}
                  {isProgrammingDropdownOpen && (
                    <div className="absolute right-0 left-0 mt-1.5 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-1.5 z-30 space-y-1 animate-in fade-in duration-150">
                      <button
                        type="button"
                        onClick={() => handleStartProgramming('Verify')}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-cyan-300 text-xs flex items-center gap-2 border-b border-slate-800/80 pb-1.5 mb-1"
                      >
                        <ShieldCheck className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                        <div>
                          <div className="font-semibold text-slate-100">Trockenlauf / Prüfen (Dry-Run)</div>
                          <div className="text-[10px] text-slate-400">
                            100% Schreibschutz: Speicher auslesen & Diff prüfen
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleStartProgramming('Partial')}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-slate-200 text-xs flex items-center gap-2"
                      >
                        <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <div>
                          <div className="font-semibold text-slate-100">Partiell programmieren</div>
                          <div className="text-[10px] text-slate-400">
                            Nur geänderte GAs & Parameter schreiben
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleStartProgramming('Full')}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-slate-200 text-xs flex items-center gap-2"
                      >
                        <RotateCcw className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                        <div>
                          <div className="font-semibold text-slate-100">Vollständig programmieren</div>
                          <div className="text-[10px] text-slate-400">
                            Alle Tabellen & Parameter überschreiben
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleStartProgramming('PhysicalAddress')}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-slate-200 text-xs flex items-center gap-2"
                      >
                        <Tag className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <div>
                          <div className="font-semibold text-slate-100">
                            Physikalische Adresse schreiben
                          </div>
                          <div className="text-[10px] text-slate-400">
                            Schreibt {selectedDevice.individual_address} ins Gerät
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleStartProgramming('Restart')}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-slate-200 text-xs flex items-center gap-2 border-t border-slate-800 pt-1"
                      >
                        <Play className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                        <div>
                          <div className="font-semibold text-slate-100">Gerät neu starten</div>
                          <div className="text-[10px] text-slate-400">
                            Sendet A_Restart Telegramm
                          </div>
                        </div>
                      </button>
                    </div>
                  )}
                </div>

                {/* KNX Data Secure Button */}
                {onOpenSecurityModal && (
                  <button
                    type="button"
                    onClick={() => onOpenSecurityModal(selectedDevice)}
                    className={`w-full flex items-center justify-between py-1.5 px-3 rounded-lg border text-xs font-semibold transition-all ${
                      selectedDevice.security?.is_secure_enabled
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                        : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {selectedDevice.security?.is_secure_enabled ? (
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <ShieldAlert className="w-3.5 h-3.5 text-slate-500" />
                      )}
                      <span>KNX Data Secure (TP)</span>
                    </div>
                    <span className="text-[10px] font-mono">
                      {selectedDevice.security?.is_secure_enabled ? 'Aktiviert' : 'Inaktiv'}
                    </span>
                  </button>
                )}
              </div>
            </div>

            {/* Big Open KO/Parameter Manager Button */}
            {onOpenDeviceKoModal && (
              <button
                type="button"
                onClick={() => onOpenDeviceKoModal(selectedDevice)}
                className="w-full flex items-center justify-between py-2 px-3 rounded-xl border border-sky-500/50 bg-sky-500/15 text-sky-300 hover:bg-sky-500/25 text-xs font-bold transition-all shadow-md shadow-sky-950"
                title="Öffnet die vollständige KO-Tabelle und den Parametermixer"
              >
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-sky-400" />
                  <span>KO- & Parametertabelle</span>
                </div>
                <span className="text-[10px] font-mono px-1.5 py-0.5 bg-sky-950 rounded text-sky-300 border border-sky-800/60">
                  {(selectedDevice.communication_objects || []).length} KOs
                </span>
              </button>
            )}

            {/* Tab Selector: Channels | KOs | Parameters */}
            <div className="flex rounded-lg bg-slate-950 p-1 border border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setDeviceTab('channels')}
                className={`flex-1 py-1 rounded transition-colors text-center text-[11px] font-medium ${
                  deviceTab === 'channels'
                    ? 'bg-slate-800 text-slate-100 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Kanäle ({selectedDevice.channels.length})
              </button>
              <button
                type="button"
                onClick={() => setDeviceTab('kos')}
                className={`flex-1 py-1 rounded transition-colors text-center text-[11px] font-medium ${
                  deviceTab === 'kos'
                    ? 'bg-sky-500/20 text-sky-300 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                KOs ({(selectedDevice.communication_objects || []).length})
              </button>
              <button
                type="button"
                onClick={() => setDeviceTab('params')}
                className={`flex-1 py-1 rounded transition-colors text-center text-[11px] font-medium ${
                  deviceTab === 'params'
                    ? 'bg-emerald-500/20 text-emerald-300 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Param ({(selectedDevice.parameters || []).length})
              </button>
            </div>

            {/* TAB 1: Channels */}
            {deviceTab === 'channels' && (
              <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                {selectedDevice.channels.map((ch) => (
                  <div
                    key={ch.id}
                    className="p-2.5 rounded-lg border border-slate-800 bg-slate-950/50 space-y-1 text-xs"
                  >
                    <div className="flex items-center justify-between font-mono">
                      <span className="text-sky-400 font-bold bg-sky-950/80 px-1.5 py-0.5 rounded border border-sky-800/40 text-[11px]">
                        {ch.channel_code}
                      </span>
                      <span className="text-[10px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
                        {ch.channel_type}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-200 font-medium truncate">
                      {ch.name}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* TAB 2: Communication Objects (KOs) */}
            {deviceTab === 'kos' && (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2" />
                  <input
                    type="text"
                    placeholder="KOs filtern..."
                    value={deviceKoSearch}
                    onChange={(e) => setDeviceKoSearch(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-2 py-1 text-[11px] text-slate-200 placeholder:text-slate-500 outline-none focus:border-sky-500"
                  />
                </div>

                <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1 text-xs">
                  {(!selectedDevice.communication_objects || selectedDevice.communication_objects.length === 0) ? (
                    <div className="p-3 text-center text-slate-500 text-xs italic">
                      Keine Kommunikationsobjekte vorhanden.
                    </div>
                  ) : (
                    selectedDevice.communication_objects
                      .filter((ko) => {
                        const q = deviceKoSearch.toLowerCase().trim()
                        return (
                          !q ||
                          ko.number.toString().includes(q) ||
                          ko.name.toLowerCase().includes(q) ||
                          ko.object_text.toLowerCase().includes(q) ||
                          ko.function_text.toLowerCase().includes(q) ||
                          ko.dpt.toLowerCase().includes(q) ||
                          ko.group_addresses.some((ga) => ga.toLowerCase().includes(q))
                        )
                      })
                      .map((ko) => {
                        const isLinking = linkingKoNum === ko.number
                        return (
                          <div
                            key={ko.number}
                            className="p-2 rounded-lg border border-slate-800 bg-slate-950/50 space-y-1.5 text-[11px]"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5 truncate">
                                <span className="font-mono text-slate-400 font-bold">
                                  #{ko.number}
                                </span>
                                <span className="font-medium text-slate-200 truncate" title={ko.object_text || ko.name}>
                                  {ko.object_text || ko.name}
                                </span>
                              </div>
                              <span className="font-mono text-[10px] text-sky-400 bg-sky-950 px-1.5 py-0.5 rounded border border-sky-800/40 shrink-0">
                                {ko.dpt}
                              </span>
                            </div>

                            {ko.function_text && (
                              <div className="text-[10px] text-slate-400 truncate">
                                {ko.function_text}
                              </div>
                            )}

                            {/* Flags: C, R, W, T, U */}
                            <div className="flex items-center justify-between pt-1 border-t border-slate-800/60">
                              <div className="flex gap-0.5 font-mono text-[9px] font-bold">
                                <span className={ko.flags.communication ? 'text-emerald-400' : 'text-slate-600'}>C</span>
                                <span className={ko.flags.read ? 'text-blue-400' : 'text-slate-600'}>R</span>
                                <span className={ko.flags.write ? 'text-amber-400' : 'text-slate-600'}>W</span>
                                <span className={ko.flags.transmit ? 'text-purple-400' : 'text-slate-600'}>T</span>
                                <span className={ko.flags.update ? 'text-teal-400' : 'text-slate-600'}>U</span>
                              </div>

                              {/* Linked GAs */}
                              <div className="flex flex-wrap items-center gap-1 justify-end">
                                {ko.group_addresses.map((gaAddr) => (
                                  <span
                                    key={gaAddr}
                                    className="font-mono text-[10px] bg-slate-900 border border-sky-800 text-sky-300 px-1 py-0.5 rounded flex items-center gap-0.5"
                                  >
                                    <span>{gaAddr}</span>
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        try {
                                          const gaObj = project?.group_addresses.find((g) => g.address === gaAddr)
                                          const upd = await linkKoToGroupAddress(
                                            selectedDevice.id,
                                            ko.number,
                                            gaObj?.id,
                                            gaAddr,
                                            true
                                          )
                                          onUpdateDevice?.(upd)
                                        } catch (e) {
                                          console.error(e)
                                        }
                                      }}
                                      className="text-slate-500 hover:text-red-400"
                                      title="Trennen"
                                    >
                                      <X className="w-2.5 h-2.5" />
                                    </button>
                                  </span>
                                ))}

                                <div className="relative">
                                  <button
                                    type="button"
                                    onClick={() => setLinkingKoNum(isLinking ? null : ko.number)}
                                    className="text-[9px] px-1 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-0.5"
                                    title="GA verknüpfen"
                                  >
                                    <Plus className="w-2.5 h-2.5" />
                                    <span>GA</span>
                                  </button>

                                  {isLinking && (
                                    <div className="absolute right-0 bottom-full mb-1 w-52 bg-slate-900 border border-slate-700 rounded-xl shadow-xl z-30 p-2 space-y-1">
                                      <div className="text-[10px] font-bold text-slate-300 px-1">
                                        GA zuweisen:
                                      </div>
                                      <div className="max-h-36 overflow-y-auto space-y-0.5">
                                        {(project?.group_addresses || []).map((ga) => (
                                          <button
                                            key={ga.id}
                                            type="button"
                                            disabled={ko.group_addresses.includes(ga.address)}
                                            onClick={async () => {
                                              try {
                                                const upd = await linkKoToGroupAddress(
                                                  selectedDevice.id,
                                                  ko.number,
                                                  ga.id,
                                                  ga.address,
                                                  false
                                                )
                                                onUpdateDevice?.(upd)
                                                setLinkingKoNum(null)
                                              } catch (e) {
                                                console.error(e)
                                              }
                                            }}
                                            className="w-full text-left px-1.5 py-0.5 rounded text-[10px] flex items-center justify-between hover:bg-sky-500/20 text-slate-200 disabled:opacity-40"
                                          >
                                            <span className="font-mono text-sky-400 font-bold">{ga.address}</span>
                                            <span className="truncate max-w-[100px] text-slate-400">{ga.name}</span>
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      })
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: Parameters */}
            {deviceTab === 'params' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2" />
                    <input
                      type="text"
                      placeholder="Parameter filtern..."
                      value={deviceParamSearch}
                      onChange={(e) => setDeviceParamSearch(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-2 py-1 text-[11px] text-slate-200 placeholder:text-slate-500 outline-none focus:border-emerald-500"
                    />
                  </div>

                  <button
                    type="button"
                    disabled={isSavingParams}
                    onClick={async () => {
                      setIsSavingParams(true)
                      const updates = Object.entries(paramEdits).map(([id, value]) => ({ id, value }))
                      try {
                        const upd = await updateDeviceParameters(selectedDevice.id, updates)
                        onUpdateDevice?.(upd)
                      } catch (e) {
                        console.error(e)
                      } finally {
                        setIsSavingParams(false)
                      }
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold transition-colors shrink-0"
                    title="Geänderte Parameter speichern"
                  >
                    <Save className="w-3 h-3" />
                    <span>Speichern</span>
                  </button>
                </div>

                <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1 text-xs">
                  {(!selectedDevice.parameters || selectedDevice.parameters.length === 0) ? (
                    <div className="p-3 text-center text-slate-500 text-xs italic">
                      Keine Parameter vorhanden.
                    </div>
                  ) : (
                    selectedDevice.parameters
                      .filter((p) => {
                        const q = deviceParamSearch.toLowerCase().trim()
                        return !q || p.id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || p.text.toLowerCase().includes(q)
                      })
                      .slice(0, 30)
                      .map((p) => {
                        const val = paramEdits[p.id] !== undefined ? paramEdits[p.id] : p.value
                        return (
                          <div
                            key={p.id}
                            className="p-2 rounded-lg border border-slate-800 bg-slate-950/50 space-y-1 text-[11px]"
                          >
                            <div className="flex items-center justify-between text-slate-300 font-medium truncate" title={p.text || p.name}>
                              <span className="truncate">{p.text || p.name}</span>
                              <span className="text-[10px] text-slate-500 font-mono shrink-0">
                                Std: {p.default_value}
                              </span>
                            </div>

                            {p.options && p.options.length > 0 ? (
                              <select
                                value={val}
                                onChange={(e) => setParamEdits((prev) => ({ ...prev, [p.id]: e.target.value }))}
                                className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-emerald-500"
                              >
                                {p.options.map((opt) => (
                                  <option key={opt} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <ParameterInputField
                                param={p}
                                value={val}
                                compact={true}
                                onChange={(newVal) => setParamEdits((prev) => ({ ...prev, [p.id]: newVal }))}
                              />
                            )}
                          </div>
                        )
                      })
                  )}
                </div>
              </div>
            )}

            {/* Address in Diagnostics Button */}
            {onOpenDiagnostics && (
              <button
                type="button"
                onClick={() => onOpenDiagnostics(selectedDevice.individual_address)}
                className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg border border-sky-500/40 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 text-xs font-semibold transition-colors shadow-sm"
                title="Öffnet die ETS-Diagnose und scannt/programmiert dieses Gerät"
              >
                <Activity className="w-3.5 h-3.5 text-sky-400" />
                <span>In ETS-Diagnose adressieren</span>
              </button>
            )}

            {/* Delete Device Button */}
            {onDeleteDevice && (
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      `Gerät "${selectedDevice.name}" (${selectedDevice.individual_address}) und alle zugehörigen Klemmen/Verbindungen wirklich löschen?`
                    )
                  ) {
                    onDeleteDevice(selectedDevice.id)
                  }
                }}
                className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-medium transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Gerät vollständig löschen</span>
              </button>
            )}
          </div>
        ) : (
          /* Project Overview when nothing selected */
          <div className="space-y-5">
            <div className="space-y-2">
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                {t('inspector.projectOverview')}
              </div>
              <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/40 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">{t('inspector.projectLabel')}</span>
                  <span className="font-semibold text-slate-200">{project?.name}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">{t('inspector.gaSchemaLabel')}</span>
                  <span className="font-mono text-emerald-400 font-semibold text-[11px]">
                    {project?.ga_scheme === 'TradeRoomFunction'
                      ? 'Gewerk / Raum / Fkt'
                      : project?.ga_scheme === 'TradeFunctionDevice'
                      ? 'Gewerk / Fkt / Baustein'
                      : 'Etage / Gewerk / Fkt'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">{t('inspector.securityLabel')}</span>
                  <span className="text-emerald-400 flex items-center gap-1 font-semibold">
                    <ShieldCheck className="w-3.5 h-3.5" /> KNX Data Secure
                  </span>
                </div>

                {onOpenGaManager && (
                  <button
                    onClick={onOpenGaManager}
                    className="w-full mt-2 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 text-xs font-semibold transition-colors"
                  >
                    <Network className="w-3.5 h-3.5" />
                    <span>{t('inspector.openGaManager')}</span>
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <span>{t('inspector.allGasTitle')}</span>
                <span className="font-mono text-emerald-400 text-[10px]">
                  {t('inspector.activeGasCount', { count: project?.group_addresses.length ?? 0 })}
                </span>
              </div>
              <div className="max-h-72 overflow-y-auto space-y-1 pr-1 font-mono">
                {project?.group_addresses.map((ga) => (
                  <div
                    key={ga.id}
                    className={`p-2 rounded border flex items-center justify-between text-xs transition-colors ${
                      ga.is_custom
                        ? 'bg-amber-950/20 border-amber-800/40 text-amber-300'
                        : 'bg-slate-800/60 border-slate-700/50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={`font-bold ${ga.is_custom ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {ga.address}
                      </span>
                      {ga.is_custom && (
                        <span title="Manuell fixiert (gesperrt)">
                          <Lock className="w-3 h-3 text-amber-400 shrink-0" />
                        </span>
                      )}
                    </div>
                    <span className="text-slate-300 truncate max-w-[130px] font-sans text-[11px]">
                      {ga.name}
                    </span>
                    <span className="text-[10px] text-slate-500 shrink-0">DPT {ga.dpt}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
