import React, { useState, useMemo, useEffect, memo } from 'react'
import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react'
import {
  Cpu,
  Sliders,
  X,
  Search,
  Zap,
  Tag,
  Plus,
  ChevronDown,
  ChevronUp,
  Check,
  ArrowDownLeft,
  ArrowUpRight,
  Filter,
  Sparkles,
  Radio,
  ShieldCheck,
} from 'lucide-react'
import { KnxDevice, GroupAddress, CommunicationObject } from '../../../types/knx'
import { createProgrammingJob } from '../../../services/api'


export interface KnxDeviceBlockNodeProps {
  id?: string
  data: {
    device: KnxDevice
    groupAddresses: GroupAddress[]
    isSimulating: boolean
    onAction?: (pin: string, value: any) => void
    onOpenSettings?: (device: KnxDevice) => void
    onRemove?: (deviceId: string) => void
    onUpdateVisibleKos?: (deviceId: string, koNumbers: number[]) => void
  }
}

export const KnxDeviceBlockNodeComponent: React.FC<KnxDeviceBlockNodeProps> = ({ id, data }) => {
  const { device, onAction, onOpenSettings, onRemove, onUpdateVisibleKos } = data
  const nodeId = id || device.id
  const updateNodeInternals = useUpdateNodeInternals()

  const kos: CommunicationObject[] = device.communication_objects || []

  // Determine isSensor vs Actuator
  const isSensor = useMemo(() => {
    const name = device.name.toLowerCase()
    const model = device.model.toLowerCase()
    return (
      name.includes('taster') ||
      model.includes('taster') ||
      name.includes('wetter') ||
      name.includes('sensor') ||
      name.includes('präsenz') ||
      name.includes('bewegung')
    )
  }, [device.name, device.model])

  // Initial visible KOs: use device.visible_ko_numbers if present,
  // otherwise fallback to KOs linked to GAs (Auto-Import rule), or empty (manual rule)
  const initialVisibleKos = useMemo(() => {
    if (device.visible_ko_numbers && device.visible_ko_numbers.length > 0) {
      return device.visible_ko_numbers
    }
    const linked = kos
      .filter(
        (k) =>
          (k.group_addresses && k.group_addresses.length > 0) ||
          (k.group_address_ids && k.group_address_ids.length > 0)
      )
      .map((k) => k.number)
    return linked
  }, [device.visible_ko_numbers, kos])

  const [visibleKos, setVisibleKos] = useState<number[]>(initialVisibleKos)
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [pickerFilter, setPickerFilter] = useState<'all' | 'write' | 'transmit' | 'linked'>('all')
  const [selectedChannel, setSelectedChannel] = useState<string>('all')
  const [lastTriggeredKo, setLastTriggeredKo] = useState<number | null>(null)
  const [isFlashing, setIsFlashing] = useState(false)

  const handleQuickFlash = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsFlashing(true)
    try {
      await createProgrammingJob(device.id, 'Partial')
    } catch (err: any) {
      alert(err.message || 'Fehler beim Starten des Programmier-Jobs')
    } finally {
      setIsFlashing(false)
    }
  }


  // Sync when device.visible_ko_numbers changes from server/parent
  useEffect(() => {
    if (device.visible_ko_numbers) {
      setVisibleKos(device.visible_ko_numbers)
    }
  }, [device.visible_ko_numbers])

  // Notify React Flow to update handle coordinates whenever pins or collapse changes!
  useEffect(() => {
    if (nodeId) {
      updateNodeInternals(nodeId)
    }
  }, [nodeId, visibleKos, isCollapsed, updateNodeInternals])

  // Extract distinct channel/group names from object_text (e.g. "Taste 1", "Taste 2", "Kanal A", "Global")
  const distinctChannels = useMemo(() => {
    const set = new Set<string>()
    kos.forEach((k) => {
      if (k.object_text && k.object_text.trim() !== '') {
        set.add(k.object_text.trim())
      }
    })
    return Array.from(set)
  }, [kos])

  // Helper to add a KO pin (guarantees 1:1 uniqueness)
  const handleAddKo = (koNumber: number) => {
    if (visibleKos.includes(koNumber)) return
    const updated = [...visibleKos, koNumber]
    setVisibleKos(updated)
    onUpdateVisibleKos?.(device.id, updated)
  }

  // Helper to remove a KO pin from node
  const handleRemoveKo = (koNumber: number, e?: React.MouseEvent) => {
    e?.stopPropagation()
    const updated = visibleKos.filter((n) => n !== koNumber)
    setVisibleKos(updated)
    onUpdateVisibleKos?.(device.id, updated)
  }

  // Add all linked KOs
  const handleAddAllLinked = () => {
    const linked = kos
      .filter(
        (k) =>
          (k.group_addresses && k.group_addresses.length > 0) ||
          (k.group_address_ids && k.group_address_ids.length > 0)
      )
      .map((k) => k.number)
    const set = new Set([...visibleKos, ...linked])
    const updated = Array.from(set)
    setVisibleKos(updated)
    onUpdateVisibleKos?.(device.id, updated)
  }

  // Add all KOs
  const handleAddAll = () => {
    const all = kos.map((k) => k.number)
    setVisibleKos(all)
    onUpdateVisibleKos?.(device.id, all)
  }

  // Clear all KOs (returns to minimalist state)
  const handleClearAll = () => {
    setVisibleKos([])
    onUpdateVisibleKos?.(device.id, [])
  }

  // Determine KO direction (Input vs Output)
  const getKoDirection = (ko: CommunicationObject): 'input' | 'output' => {
    const isTransmit = ko.flags.transmit
    const isWrite = ko.flags.write

    if (isTransmit && !isWrite) return 'output'
    if (isWrite && !isTransmit) return 'input'

    // If both flags are set, apply domain heuristic
    const nameLower = (
      (ko.function_text || '') +
      ' ' +
      (ko.object_text || '') +
      ' ' +
      (ko.name || '')
    ).toLowerCase()

    if (isSensor) {
      if (
        nameLower.includes('sperr') ||
        nameLower.includes('wert empfangen') ||
        nameLower.includes('led') ||
        nameLower.includes('eingang') ||
        nameLower.includes('uhrzeit') ||
        nameLower.includes('datum')
      ) {
        return 'input'
      }
      return 'output'
    } else {
      if (
        nameLower.includes('status') ||
        nameLower.includes('rückmeldung') ||
        nameLower.includes('istwert') ||
        nameLower.includes('info') ||
        nameLower.includes('ausgang')
      ) {
        return 'output'
      }
      return 'input'
    }
  }

  // Visible KO objects
  const visibleKoObjects = useMemo(() => {
    return visibleKos
      .map((num) => kos.find((k) => k.number === num))
      .filter((k): k is CommunicationObject => k !== undefined)
      .sort((a, b) => a.number - b.number)
  }, [visibleKos, kos])

  // Split into Inputs and Outputs
  const inputKos = useMemo(() => {
    return visibleKoObjects.filter((ko) => {
      const dir = getKoDirection(ko)
      return dir === 'input' || ko.flags.write
    })
  }, [visibleKoObjects, isSensor])

  const outputKos = useMemo(() => {
    return visibleKoObjects.filter((ko) => {
      const dir = getKoDirection(ko)
      return dir === 'output' || ko.flags.transmit
    })
  }, [visibleKoObjects, isSensor])

  // Filtered KOs in the Add Pin Popover
  const pickerKos = useMemo(() => {
    return kos.filter((ko) => {
      // 1. Channel filter
      if (selectedChannel !== 'all' && ko.object_text?.trim() !== selectedChannel) {
        return false
      }

      // 2. Tab filter
      if (pickerFilter === 'write' && !ko.flags.write) return false
      if (pickerFilter === 'transmit' && !ko.flags.transmit) return false
      if (
        pickerFilter === 'linked' &&
        (!ko.group_addresses || ko.group_addresses.length === 0) &&
        (!ko.group_address_ids || ko.group_address_ids.length > 0)
      ) {
        return false
      }

      // 3. Search term
      if (searchTerm.trim() !== '') {
        const q = searchTerm.toLowerCase().trim()
        const matchNum = ko.number.toString() === q || `#${ko.number}` === q
        const matchObj = ko.object_text?.toLowerCase().includes(q)
        const matchFunc = ko.function_text?.toLowerCase().includes(q)
        const matchDpt = ko.dpt?.toLowerCase().includes(q)
        const matchGa = ko.group_addresses?.some((g) => g.toLowerCase().includes(q))
        return matchNum || matchObj || matchFunc || matchDpt || matchGa
      }

      return true
    })
  }, [kos, selectedChannel, pickerFilter, searchTerm])

  const handleTestKo = (ko: CommunicationObject, e: React.MouseEvent) => {
    e.stopPropagation()
    setLastTriggeredKo(ko.number)
    setTimeout(() => setLastTriggeredKo(null), 800)
    onAction?.(`ko-${ko.number}`, true)
  }

  const unaddedCount = kos.length - visibleKos.length

  return (
    <div
      className={`rounded-2xl border-2 bg-slate-900 shadow-xl transition-all select-none relative ${
        isSensor
          ? 'border-amber-500/70 shadow-amber-950/30 ring-1 ring-amber-500/20'
          : 'border-sky-500/70 shadow-sky-950/30 ring-1 ring-sky-500/20'
      } ${isCollapsed ? 'w-80' : 'w-[420px]'}`}
      style={{ minWidth: isCollapsed ? 320 : 420 }}
    >
      {/* Blueprint Header */}
      <div
        className={`flex items-center justify-between border-b border-slate-800 px-4 py-3 rounded-t-2xl bg-gradient-to-r ${
          isSensor
            ? 'from-slate-950 via-amber-950/25 to-slate-950'
            : 'from-slate-950 via-sky-950/25 to-slate-950'
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div
            className={`p-2 rounded-xl border shrink-0 shadow-inner ${
              isSensor
                ? 'bg-amber-500/20 text-amber-400 border-amber-500/40 shadow-amber-500/20'
                : 'bg-sky-500/20 text-sky-400 border-sky-500/40 shadow-sky-500/20'
            }`}
          >
            <Cpu className="w-4 h-4" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className={`font-mono text-[11px] font-bold px-1.5 py-0.5 rounded-md border shrink-0 shadow-sm ${
                  isSensor
                    ? 'bg-amber-950 text-amber-300 border-amber-700/60'
                    : 'bg-sky-950 text-sky-300 border-sky-700/60'
                }`}
              >
                {device.individual_address}
              </span>
              {device.security?.is_secure_enabled && (
                <span title="KNX Data Secure auf TP aktiv">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                </span>
              )}
              <span className="text-xs font-bold text-slate-100 truncate" title={device.name}>
                {device.name}
              </span>
            </div>
            <div className="text-[10px] text-slate-400 truncate mt-0.5 font-medium">
              {device.manufacturer} · {device.model}
            </div>
          </div>
        </div>

        {/* Header Action Buttons */}
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {/* Quick Flash */}
          <button
            type="button"
            onClick={handleQuickFlash}
            disabled={isFlashing}
            title="Gerät partiell flashen (GAs & Parameter übertragen)"
            className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-amber-500/10 transition-colors disabled:opacity-50"
          >
            <Zap className={`w-3.5 h-3.5 ${isFlashing ? 'animate-bounce text-amber-400' : ''}`} />
          </button>

          {/* + Pin Button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setIsPickerOpen(!isPickerOpen)
            }}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold border flex items-center gap-1 transition-all ${
              isPickerOpen
                ? 'bg-sky-400 text-slate-950 border-sky-300 shadow-md shadow-sky-500/40'
                : 'bg-slate-800/90 text-sky-300 border-slate-700 hover:bg-sky-500/20 hover:border-sky-500/50'
            }`}
            title="Kommunikationsobjekt (KO) als sichtbaren Pin hinzufügen"
          >
            <Plus className="w-3 h-3" />
            <span>Pin</span>
            {unaddedCount > 0 && (
              <span className="text-[9px] font-mono bg-slate-900/90 px-1 py-0.2 rounded text-slate-400">
                +{unaddedCount}
              </span>
            )}
          </button>

          {/* Settings / Inspector */}
          {onOpenSettings && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onOpenSettings(device)
              }}
              title="KO- & Parametertabelle öffnen"
              className="p-1.5 rounded-lg text-slate-400 hover:text-sky-300 hover:bg-sky-500/10 transition-colors"
            >
              <Sliders className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Collapse */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setIsCollapsed(!isCollapsed)
            }}
            title={isCollapsed ? 'Aufklappen' : 'Zuklappen'}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            {isCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>

          {/* Remove from canvas */}
          {onRemove && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onRemove(device.id)
              }}
              title="Vom Canvas entfernen"
              className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Main Pin Area (when not collapsed) */}
      {!isCollapsed && (
        <div className="p-3 space-y-3 bg-slate-950/80 rounded-b-2xl">
          {/* Minimalist Default State: No Pins Added */}
          {visibleKoObjects.length === 0 ? (
            <div className="py-6 px-4 text-center rounded-xl border border-dashed border-slate-800 bg-slate-900/40 space-y-2">
              <div className="text-slate-300 text-xs font-semibold flex items-center justify-center gap-1.5">
                <Sparkles className="w-4 h-4 text-sky-400" />
                <span>Kompakt-Modus (Keine Pins)</span>
              </div>
              <div className="text-[11px] text-slate-400 max-w-[280px] mx-auto leading-relaxed">
                Klicke auf <span className="text-sky-300 font-semibold">+ Pin</span>, um Kommunikationsobjekte dieses Geräts für Leitungen einzublenden.
              </div>
              <div className="pt-1.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setIsPickerOpen(true)
                  }}
                  className="px-3 py-1.5 bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/40 rounded-lg text-xs font-semibold transition-all inline-flex items-center gap-1.5 shadow-sm shadow-sky-950"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Pin hinzufügen</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* SECTION 1: EINGÄNGE (Inputs / Left Handles) */}
              {inputKos.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between px-1 text-[10px] font-bold uppercase tracking-wider text-sky-400 border-b border-sky-900/40 pb-1">
                    <span className="flex items-center gap-1">
                      <ArrowDownLeft className="w-3 h-3" />
                      <span>Eingänge (Empfangen / Write)</span>
                    </span>
                    <span className="font-mono text-[9px] bg-sky-950 px-1.5 py-0.2 rounded border border-sky-800/60">
                      {inputKos.length}
                    </span>
                  </div>

                  <div className="space-y-1">
                    {inputKos.map((ko) => {
                      const isTriggered = lastTriggeredKo === ko.number
                      const isLinked = (ko.group_addresses && ko.group_addresses.length > 0) || (ko.group_address_ids && ko.group_address_ids.length > 0)

                      return (
                        <div
                          key={`in-${ko.number}`}
                          className={`relative flex items-center justify-between px-2.5 py-1.5 rounded-lg border transition-all group ${
                            isTriggered
                              ? 'bg-sky-500/20 border-sky-400'
                              : isLinked
                              ? 'bg-slate-900/90 border-slate-800 hover:border-sky-700/60'
                              : 'bg-slate-900/50 border-slate-800/50 hover:border-slate-700'
                          }`}
                        >
                          {/* PROMINENT BLUEPRINT PIN HANDLE (LEFT EDGE) */}
                          <Handle
                            type="target"
                            position={Position.Left}
                            id={`ko-${ko.number}`}
                            style={{ left: -7, top: '50%', transform: 'translateY(-50%)' }}
                            className="!w-3.5 !h-3.5 !bg-sky-400 !border-2 !border-slate-950 shadow-[0_0_8px_rgba(56,189,248,0.9)] hover:!scale-125 !cursor-crosshair transition-transform z-20"
                            title={`Eingang-Pin ko-${ko.number}: Empfängt KNX Telegramme (Write)`}
                          />

                          {/* Left label & KO info */}
                          <div className="flex items-center gap-2 min-w-0 flex-1 pl-1">
                            <span className="font-mono text-[10px] font-bold text-sky-400 bg-sky-950/80 px-1.5 py-0.5 rounded border border-sky-800/60 shrink-0">
                              #{ko.number}
                            </span>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-semibold text-slate-100 truncate" title={ko.function_text || ko.name}>
                                  {ko.function_text || ko.name}
                                </span>
                                {ko.object_text && (
                                  <span className="text-[10px] text-slate-400 truncate font-mono">
                                    ({ko.object_text})
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                {ko.dpt && (
                                  <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-slate-800 text-slate-400 border border-slate-700/60">
                                    DPT {ko.dpt}
                                  </span>
                                )}
                                {ko.group_addresses?.map((ga) => (
                                  <span
                                    key={ga}
                                    className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-sky-950 text-sky-300 border border-sky-700/80 flex items-center gap-0.5 shadow-sm"
                                  >
                                    <Tag className="w-2.5 h-2.5 text-sky-400" />
                                    {ga}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>

                          {/* Pin Remove (Hide) Button */}
                          <button
                            type="button"
                            onClick={(e) => handleRemoveKo(ko.number, e)}
                            title="Pin ausblenden"
                            className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 opacity-40 group-hover:opacity-100 transition-all shrink-0 ml-1"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* SECTION 2: AUSGÄNGE (Outputs / Right Handles) */}
              {outputKos.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between px-1 text-[10px] font-bold uppercase tracking-wider text-amber-400 border-b border-amber-900/40 pb-1">
                    <span className="flex items-center gap-1">
                      <ArrowUpRight className="w-3 h-3" />
                      <span>Ausgänge (Senden / Transmit)</span>
                    </span>
                    <span className="font-mono text-[9px] bg-amber-950 px-1.5 py-0.2 rounded border border-amber-800/60">
                      {outputKos.length}
                    </span>
                  </div>

                  <div className="space-y-1">
                    {outputKos.map((ko) => {
                      const isTriggered = lastTriggeredKo === ko.number
                      const isLinked = (ko.group_addresses && ko.group_addresses.length > 0) || (ko.group_address_ids && ko.group_address_ids.length > 0)

                      return (
                        <div
                          key={`out-${ko.number}`}
                          className={`relative flex items-center justify-between px-2.5 py-1.5 rounded-lg border transition-all group ${
                            isTriggered
                              ? 'bg-amber-500/20 border-amber-400'
                              : isLinked
                              ? 'bg-slate-900/90 border-slate-800 hover:border-amber-700/60'
                              : 'bg-slate-900/50 border-slate-800/50 hover:border-slate-700'
                          }`}
                        >
                          {/* Pin Remove & Test actions on the left side of output row */}
                          <div className="flex items-center gap-1 shrink-0 mr-1.5">
                            <button
                              type="button"
                              onClick={(e) => handleRemoveKo(ko.number, e)}
                              title="Pin ausblenden"
                              className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 opacity-40 group-hover:opacity-100 transition-all shrink-0"
                            >
                              <X className="w-3 h-3" />
                            </button>

                            {ko.flags.transmit && (
                              <button
                                type="button"
                                onClick={(e) => handleTestKo(ko, e)}
                                title={`Telegramm senden (Test #${ko.number})`}
                                className={`p-1 rounded text-[10px] font-mono flex items-center gap-0.5 transition-all ${
                                  isTriggered
                                    ? 'bg-amber-500 text-slate-950 font-bold'
                                    : 'bg-slate-800 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20'
                                }`}
                              >
                                <Zap className="w-2.5 h-2.5" />
                              </button>
                            )}
                          </div>

                          {/* Right label & KO info */}
                          <div className="flex items-center justify-end gap-2 min-w-0 flex-1 text-right pr-1">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-end gap-1.5">
                                {ko.object_text && (
                                  <span className="text-[10px] text-slate-400 truncate font-mono">
                                    ({ko.object_text})
                                  </span>
                                )}
                                <span className="text-xs font-semibold text-slate-100 truncate" title={ko.function_text || ko.name}>
                                  {ko.function_text || ko.name}
                                </span>
                              </div>

                              <div className="flex items-center justify-end gap-1 mt-0.5 flex-wrap">
                                {ko.group_addresses?.map((ga) => (
                                  <span
                                    key={ga}
                                    className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-amber-950 text-amber-300 border border-amber-700/80 flex items-center gap-0.5 shadow-sm"
                                  >
                                    <Tag className="w-2.5 h-2.5 text-amber-400" />
                                    {ga}
                                  </span>
                                ))}
                                {ko.dpt && (
                                  <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-slate-800 text-slate-400 border border-slate-700/60">
                                    DPT {ko.dpt}
                                  </span>
                                )}
                              </div>
                            </div>

                            <span className="font-mono text-[10px] font-bold text-amber-400 bg-amber-950/80 px-1.5 py-0.5 rounded border border-amber-800/60 shrink-0">
                              #{ko.number}
                            </span>
                          </div>

                          {/* PROMINENT BLUEPRINT PIN HANDLE (RIGHT EDGE) */}
                          <Handle
                            type="source"
                            position={Position.Right}
                            id={`ko-${ko.number}`}
                            style={{ right: -7, top: '50%', transform: 'translateY(-50%)' }}
                            className="!w-3.5 !h-3.5 !bg-amber-400 !border-2 !border-slate-950 shadow-[0_0_8px_rgba(251,191,36,0.9)] hover:!scale-125 !cursor-crosshair transition-transform z-20"
                            title={`Ausgang-Pin ko-${ko.number}: Sendet KNX Telegramme (Transmit)`}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Floating KO Picker Popover / Dropdown */}
      {isPickerOpen && (
        <div
          className="absolute top-full left-0 right-0 mt-2 z-50 bg-slate-900 border-2 border-sky-500/60 rounded-xl shadow-2xl p-3 space-y-2.5 max-h-[440px] overflow-hidden flex flex-col backdrop-blur-md ring-4 ring-black/40"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Popover Header */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-sky-400" />
              <span className="text-xs font-bold text-slate-100">Pin hinzufügen</span>
              <span className="text-[10px] font-mono text-slate-400 bg-slate-800 px-1.5 py-0.2 rounded">
                {visibleKos.length} / {kos.length} aktiv
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIsPickerOpen(false)}
              className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Search bar */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="KO-Name, Funktion, #Nr oder GA suchen..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-700/80 rounded-lg text-xs text-slate-200 placeholder:text-slate-500 outline-none focus:border-sky-500 transition-colors"
              autoFocus
            />
          </div>

          {/* Filter Tabs & Channel Selector */}
          <div className="flex items-center justify-between gap-1 text-[10px]">
            <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => setPickerFilter('all')}
                className={`px-2 py-0.5 rounded font-medium transition-all ${
                  pickerFilter === 'all'
                    ? 'bg-sky-500 text-slate-950 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Alle ({kos.length})
              </button>
              <button
                type="button"
                onClick={() => setPickerFilter('write')}
                className={`px-2 py-0.5 rounded font-medium transition-all ${
                  pickerFilter === 'write'
                    ? 'bg-sky-500 text-slate-950 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Eingänge
              </button>
              <button
                type="button"
                onClick={() => setPickerFilter('transmit')}
                className={`px-2 py-0.5 rounded font-medium transition-all ${
                  pickerFilter === 'transmit'
                    ? 'bg-sky-500 text-slate-950 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Ausgänge
              </button>
              <button
                type="button"
                onClick={() => setPickerFilter('linked')}
                className={`px-2 py-0.5 rounded font-medium transition-all ${
                  pickerFilter === 'linked'
                    ? 'bg-sky-500 text-slate-950 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Mit GA
              </button>
            </div>

            {/* Channel filter dropdown if device has multiple channels */}
            {distinctChannels.length > 1 && (
              <select
                value={selectedChannel}
                onChange={(e) => setSelectedChannel(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-[10px] text-slate-300 outline-none max-w-[120px] truncate"
              >
                <option value="all">Alle Kanäle</option>
                {distinctChannels.map((ch) => (
                  <option key={ch} value={ch}>
                    {ch}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Quick Bulk Action Buttons */}
          <div className="flex items-center gap-1.5 pt-1 border-t border-slate-800/80">
            <button
              type="button"
              onClick={handleAddAllLinked}
              className="text-[9px] px-2 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/30 hover:bg-sky-500/20 font-medium transition-colors"
            >
              + Alle aktiven (mit GA)
            </button>
            <button
              type="button"
              onClick={handleAddAll}
              className="text-[9px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 font-medium transition-colors"
            >
              + Alle KOs
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              className="text-[9px] px-2 py-0.5 rounded bg-red-500/10 text-red-300 border border-red-500/20 hover:bg-red-500/20 font-medium ml-auto transition-colors"
            >
              Pins leeren
            </button>
          </div>

          {/* Scrollable KO List */}
          <div className="overflow-y-auto space-y-1 flex-1 pr-1 max-h-[220px] scrollbar-thin scrollbar-thumb-slate-700">
            {pickerKos.length === 0 ? (
              <div className="py-6 text-center text-slate-500 text-xs">
                Keine Kommunikationsobjekte gefunden
              </div>
            ) : (
              pickerKos.map((ko) => {
                const isAlreadyVisible = visibleKos.includes(ko.number)
                const direction = getKoDirection(ko)
                const isLinked = (ko.group_addresses && ko.group_addresses.length > 0) || (ko.group_address_ids && ko.group_address_ids.length > 0)

                return (
                  <button
                    key={ko.number}
                    type="button"
                    disabled={isAlreadyVisible}
                    onClick={() => handleAddKo(ko.number)}
                    className={`w-full text-left p-2 rounded-lg border flex items-center justify-between gap-2 transition-all ${
                      isAlreadyVisible
                        ? 'bg-slate-950/60 border-slate-800/60 opacity-50 cursor-not-allowed'
                        : 'bg-slate-950 border-slate-800 hover:border-sky-500/60 hover:bg-sky-950/20 cursor-pointer'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span
                        className={`text-[9px] font-mono px-1 py-0.2 rounded border shrink-0 flex items-center gap-0.5 ${
                          direction === 'input'
                            ? 'bg-sky-950 text-sky-400 border-sky-800/60'
                            : 'bg-amber-950 text-amber-400 border-amber-800/60'
                        }`}
                      >
                        {direction === 'input' ? (
                          <ArrowDownLeft className="w-2.5 h-2.5" />
                        ) : (
                          <ArrowUpRight className="w-2.5 h-2.5" />
                        )}
                        #{ko.number}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-slate-200 truncate">
                          {ko.function_text || ko.name}
                          {ko.object_text && (
                            <span className="text-slate-500 font-mono text-[10px] ml-1">
                              ({ko.object_text})
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                          {ko.dpt && (
                            <span className="text-[9px] font-mono text-slate-500">
                              DPT {ko.dpt}
                            </span>
                          )}
                          {ko.group_addresses?.map((ga) => (
                            <span
                              key={ga}
                              className="text-[9px] font-mono text-sky-400 bg-sky-950/80 px-1 py-0.2 rounded border border-sky-800/40"
                            >
                              {ga}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0">
                      {isAlreadyVisible ? (
                        <span className="text-[10px] font-medium text-emerald-400 flex items-center gap-0.5">
                          <Check className="w-3 h-3" />
                          <span>Sichtbar</span>
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold text-sky-400 flex items-center gap-0.5 bg-sky-500/10 px-2 py-0.5 rounded border border-sky-500/30">
                          <Plus className="w-3 h-3" />
                          <span>Hinzufügen</span>
                        </span>
                      )}
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export const KnxDeviceBlockNode = memo(KnxDeviceBlockNodeComponent)
