import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Network,
  Layers,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  ArrowLeftRight,
  Filter,
  Download,
  Plus,
  Trash2,
  Edit2,
  Search,
  RefreshCw,
  Cpu,
  Tag,
  Server,
  Check,
  X,
  ShieldAlert,
  ChevronRight,
  ChevronDown,
  Binary,
  Info,
  Sliders,
  ExternalLink,
  HelpCircle,
  Zap,
  Activity,
  HeartPulse,
} from 'lucide-react'
import {
  Project,
  KnxDevice,
  GroupAddress,
  TopologyHealthReport,
  CouplerDiagnosticInfo,
  LineBandwidthInfo,
} from '../../types/knx'
import {
  ProjectTopology,
  TopologyArea,
  TopologyLine,
  FilterTableSummary,
  FilterTableEntry,
  TopologyValidationIssue,
  KnxMediumType,
  LineCouplerFilterMode,
} from '../../types/topology'
import {
  fetchTopology,
  fetchLineFilterTable,
  addArea,
  addLine,
  updateLine,
  deleteLine,
  moveDeviceToLine,
  validateTopology,
  flashFilterTable,
  fetchTopologyDiagnostics,
} from '../../services/api'
import { useTranslation } from '../../i18n/I18nContext'


interface TopologyWorkspaceProps {
  project: Project | null
  onReloadProject?: () => void
  onSwitchToCanvas?: () => void
  onOpenDeviceModal?: (device: KnxDevice) => void
}

export const TopologyWorkspace: React.FC<TopologyWorkspaceProps> = ({
  project,
  onReloadProject,
  onSwitchToCanvas,
  onOpenDeviceModal,
}) => {
  const { t } = useTranslation()
  const [topology, setTopology] = useState<ProjectTopology | null>(null)
  const [issues, setIssues] = useState<TopologyValidationIssue[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null)

  // Filter Table State
  const [filterTable, setFilterTable] = useState<FilterTableSummary | null>(null)
  const [loadingFilter, setLoadingFilter] = useState<boolean>(false)
  const [filterSearch, setFilterSearch] = useState<string>('')
  const [filterTab, setFilterTab] = useState<'all' | 'forward' | 'block' | 'manual'>('all')
  const [activeMainTab, setActiveMainTab] = useState<'filter' | 'devices' | 'coupler' | 'diagnostics'>('filter')
  const [showHexBitmap, setShowHexBitmap] = useState<boolean>(false)

  // Topology Health & Coupler Diagnostics State
  const [healthReport, setHealthReport] = useState<TopologyHealthReport | null>(null)
  const [loadingHealth, setLoadingHealth] = useState<boolean>(false)

  // Area / Line Modals
  const [isAddAreaOpen, setIsAddAreaOpen] = useState<boolean>(false)
  const [newAreaNumber, setNewAreaNumber] = useState<number>(2)
  const [newAreaName, setNewAreaName] = useState<string>('Bereich 2')
  const [newAreaMedium, setNewAreaMedium] = useState<KnxMediumType>('Tp')

  const [isAddLineOpen, setIsAddLineOpen] = useState<boolean>(false)
  const [addLineAreaId, setAddLineAreaId] = useState<string>('')
  const [newLineNumber, setNewLineNumber] = useState<number>(1)
  const [newLineName, setNewLineName] = useState<string>('Linie 1.1')
  const [newLineMedium, setNewLineMedium] = useState<KnxMediumType>('Tp')

  // Move Device State
  const [movingDeviceId, setMovingDeviceId] = useState<string | null>(null)
  const [targetLineAddress, setTargetLineAddress] = useState<string>('')
  const [isMoving, setIsMoving] = useState<boolean>(false)

  // Flash Filter Table State
  const [isFlashingFilterTable, setIsFlashingFilterTable] = useState<boolean>(false)

  const handleFlashFilterTable = async () => {
    if (!selectedLineId) return
    setIsFlashingFilterTable(true)
    try {
      await flashFilterTable(selectedLineId)
    } catch (err: any) {
      alert(err.message || 'Fehler beim Flashen der Filtertabelle')
    } finally {
      setIsFlashingFilterTable(false)
    }
  }

  // Load Topology
  const loadTopologyData = useCallback(async () => {
    setLoading(true)
    setLoadingHealth(true)
    try {
      const [res, diagReport] = await Promise.all([
        fetchTopology(),
        fetchTopologyDiagnostics().catch(() => null),
      ])
      setTopology(res.topology)
      setIssues(res.issues || [])
      if (diagReport) {
        setHealthReport(diagReport)
      }
      // Select first line if none selected
      if (!selectedLineId && res.topology.areas.length > 0) {
        const firstArea = res.topology.areas[0]
        if (firstArea.lines.length > 0) {
          setSelectedLineId(firstArea.lines[0].id)
        }
      }
    } catch (err) {
      console.error('Fehler beim Laden der Topologie:', err)
    } finally {
      setLoading(false)
      setLoadingHealth(false)
    }
  }, [selectedLineId])

  useEffect(() => {
    loadTopologyData()
  }, [])

  // Load Filter Table when selected line changes
  useEffect(() => {
    if (!selectedLineId) {
      setFilterTable(null)
      return
    }

    let isMounted = true
    setLoadingFilter(true)
    fetchLineFilterTable(selectedLineId)
      .then((summary) => {
        if (isMounted) {
          setFilterTable(summary)
          setLoadingFilter(false)
        }
      })
      .catch((err) => {
        console.error('Fehler beim Berechnen der Filtertabelle:', err)
        if (isMounted) setLoadingFilter(false)
      })

    return () => {
      isMounted = false
    }
  }, [selectedLineId])

  // Locate active line object
  const selectedLine = useMemo(() => {
    if (!topology || !selectedLineId) return null
    for (const area of topology.areas) {
      for (const line of area.lines) {
        if (line.id === selectedLineId) return line
      }
    }
    return null
  }, [topology, selectedLineId])

  // Locate active area object
  const selectedArea = useMemo(() => {
    if (!topology || !selectedLine) return null
    return topology.areas.find((a) => a.id === selectedLine.area_id) || null
  }, [topology, selectedLine])

  // Devices on the selected line
  const lineDevices = useMemo(() => {
    if (!project || !selectedLine) return []
    const prefix = `${selectedLine.address}.`
    return project.devices.filter((d) => d.individual_address.startsWith(prefix))
  }, [project, selectedLine])

  // Coupler device on this line if any
  const couplerDevice = useMemo(() => {
    if (!project || !selectedLine) return null
    return project.devices.find((d) => d.id === selectedLine.coupler_device_id) || null
  }, [project, selectedLine])

  // Filtered entries in the filter table
  const visibleFilterEntries = useMemo(() => {
    if (!filterTable) return []
    let list = filterTable.entries

    if (filterTab === 'forward') {
      list = list.filter((e) => e.action === 'Forward')
    } else if (filterTab === 'block') {
      list = list.filter((e) => e.action === 'Block')
    } else if (filterTab === 'manual') {
      list = list.filter((e) => selectedLine?.manual_forward_gas?.includes(e.ga_address))
    }

    if (filterSearch.trim()) {
      const q = filterSearch.toLowerCase()
      list = list.filter(
        (e) =>
          e.ga_address.toLowerCase().includes(q) ||
          e.ga_name.toLowerCase().includes(q) ||
          e.dpt.toLowerCase().includes(q) ||
          e.reason.toLowerCase().includes(q) ||
          e.subline_devices.some((d) => d.toLowerCase().includes(q)) ||
          e.extline_devices.some((d) => d.toLowerCase().includes(q))
      )
    }

    return list
  }, [filterTable, filterTab, filterSearch, selectedLine])

  // Handler: Update Coupler Mode
  const handleSetCouplerMode = async (mode: LineCouplerFilterMode) => {
    if (!selectedLineId) return
    try {
      const res = await updateLine(selectedLineId, { coupler_filter_mode: mode })
      setTopology(res.topology)
      const summary = await fetchLineFilterTable(selectedLineId)
      setFilterTable(summary)
    } catch (err: any) {
      alert(err.message || 'Fehler beim Aktualisieren des Filter-Modus')
    }
  }

  // Handler: Toggle manual forward GA
  const handleToggleManualGa = async (gaAddress: string) => {
    if (!selectedLine || !selectedLineId) return
    const current = selectedLine.manual_forward_gas || []
    const next = current.includes(gaAddress)
      ? current.filter((a) => a !== gaAddress)
      : [...current, gaAddress]

    try {
      const res = await updateLine(selectedLineId, { manual_forward_gas: next })
      setTopology(res.topology)
      const summary = await fetchLineFilterTable(selectedLineId)
      setFilterTable(summary)
    } catch (err: any) {
      alert(err.message || 'Fehler beim Ändern der manuellen Freigabe')
    }
  }

  // Handler: Add Area
  const handleCreateArea = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const res = await addArea({
        area_number: Number(newAreaNumber),
        name: newAreaName,
        medium: newAreaMedium,
      })
      setTopology(res.topology)
      setIsAddAreaOpen(false)
    } catch (err: any) {
      alert(err.message || 'Fehler beim Erstellen des Bereichs')
    }
  }

  // Handler: Add Line
  const handleCreateLine = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const res = await addLine({
        area_id: addLineAreaId,
        line_number: Number(newLineNumber),
        name: newLineName,
        medium: newLineMedium,
        coupler_filter_mode: 'Filter',
      })
      setTopology(res.topology)
      setIsAddLineOpen(false)
    } catch (err: any) {
      alert(err.message || 'Fehler beim Erstellen der Linie')
    }
  }

  // Handler: Delete Line
  const handleDeleteLine = async (lineId: string, lineAddr: string) => {
    if (!confirm(`Möchtest du die Linie ${lineAddr} wirklich löschen?`)) return
    try {
      const res = await deleteLine(lineId)
      setTopology(res.topology)
      if (selectedLineId === lineId) {
        setSelectedLineId(null)
      }
    } catch (err: any) {
      alert(err.message || 'Fehler beim Löschen der Linie')
    }
  }

  // Handler: Move Device
  const handleExecuteMoveDevice = async () => {
    if (!movingDeviceId || !targetLineAddress) return
    setIsMoving(true)
    try {
      const res = await moveDeviceToLine(movingDeviceId, targetLineAddress)
      if (res.success) {
        setMovingDeviceId(null)
        if (onReloadProject) onReloadProject()
        await loadTopologyData()
        if (selectedLineId) {
          const summary = await fetchLineFilterTable(selectedLineId)
          setFilterTable(summary)
        }
      }
    } catch (err: any) {
      alert(err.message || 'Fehler beim Verschieben des Geräts')
    } finally {
      setIsMoving(false)
    }
  }

  // Download raw binary filter table (8192 bytes)
  const handleDownloadFilterBinary = () => {
    if (!filterTable || !filterTable.raw_bitmap_hex) return
    const hex = filterTable.raw_bitmap_hex
    const bytes = new Uint8Array(hex.length / 2)
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
    }
    const blob = new Blob([bytes], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `filtertabelle_linie_${filterTable.line_address.replace('.', '_')}.bin`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Calculate high-level project stats
  const totalAreas = topology?.areas.length ?? 0
  const totalLines = topology?.areas.reduce((acc, a) => acc + a.lines.length, 0) ?? 0
  const totalCouplers = topology?.areas.reduce(
    (acc, a) => acc + a.lines.filter((l) => l.coupler_device_id !== null).length,
    0
  ) ?? 0
  const totalDevices = project?.devices?.length ?? 0

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 text-slate-100 overflow-hidden select-none">
      {/* 1. Header Toolbar */}
      <div className="h-14 border-b border-slate-800 bg-slate-900/90 backdrop-blur px-5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center font-bold">
            <Network className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-slate-100">{t('topology.title')}</h1>
              <span className="text-[10px] font-semibold uppercase bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded">
                Echtzeit Auto-Routing
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Bereiche, TP/IP-Linien, Koppler-Filtermodus & mathematisch exakte 8192-Byte Bitmasken
            </p>
          </div>
        </div>

        {/* Global Statistics Badges */}
        <div className="hidden md:flex items-center gap-4 text-xs font-mono text-slate-300">
          <div className="flex items-center gap-1.5 bg-slate-800/80 px-2.5 py-1 rounded border border-slate-700/60">
            <Layers className="w-3.5 h-3.5 text-amber-400" />
            <span>{totalAreas} Bereiche</span>
          </div>
          <div className="flex items-center gap-1.5 bg-slate-800/80 px-2.5 py-1 rounded border border-slate-700/60">
            <Network className="w-3.5 h-3.5 text-sky-400" />
            <span>{totalLines} Linien</span>
          </div>
          <div className="flex items-center gap-1.5 bg-slate-800/80 px-2.5 py-1 rounded border border-slate-700/60">
            <ArrowLeftRight className="w-3.5 h-3.5 text-emerald-400" />
            <span>{totalCouplers} Koppler</span>
          </div>
          <div className="flex items-center gap-1.5 bg-slate-800/80 px-2.5 py-1 rounded border border-slate-700/60">
            <Cpu className="w-3.5 h-3.5 text-purple-400" />
            <span>{totalDevices} Geräte</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setNewAreaNumber((topology?.areas.length || 0) + 1)
              setNewAreaName(`Bereich ${(topology?.areas.length || 0) + 1}`)
              setIsAddAreaOpen(true)
            }}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 hover:border-slate-600 transition-colors"
          >
            <Plus className="w-3.5 h-3.5 text-amber-400" />
            <span>Bereich</span>
          </button>
          <button
            onClick={() => {
              if (topology && topology.areas.length > 0) {
                setAddLineAreaId(topology.areas[0].id)
                setNewLineNumber(topology.areas[0].lines.length + 1)
                setNewLineName(`Linie ${topology.areas[0].area_number}.${topology.areas[0].lines.length + 1}`)
              }
              setIsAddLineOpen(true)
            }}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 hover:border-slate-600 transition-colors"
          >
            <Plus className="w-3.5 h-3.5 text-sky-400" />
            <span>Linie</span>
          </button>
          <button
            onClick={loadTopologyData}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-slate-800 transition-colors"
            title="Topologie aktualisieren"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {onSwitchToCanvas && (
            <button
              onClick={onSwitchToCanvas}
              className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-900/30 transition-all ml-1"
            >
              <span>Zurück zum Canvas</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Issues Banner if any */}
      {issues.length > 0 && (
        <div className="bg-rose-950/60 border-b border-rose-800/80 px-5 py-2 flex items-center justify-between text-xs text-rose-200 shrink-0">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="font-semibold">Topologie-Warnungen ({issues.length}):</span>
            <span>{issues[0].message}</span>
            {issues.length > 1 && (
              <span className="text-rose-400 underline cursor-pointer ml-2">
                +{issues.length - 1} weitere anzeigen
              </span>
            )}
          </div>
        </div>
      )}

      {/* 2. Main Workspace Split: Tree on Left, Detail on Right */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar: Topology Tree */}
        <aside className="w-80 border-r border-slate-800 bg-slate-900/50 flex flex-col shrink-0 overflow-y-auto">
          <div className="p-3 border-b border-slate-800 bg-slate-900/70 text-xs font-bold text-slate-300 flex items-center justify-between">
            <span className="uppercase tracking-wider text-[11px] text-slate-400">KNX Hierarchie</span>
            <span className="text-[10px] text-slate-500">{totalLines} Linien konfiguriert</span>
          </div>

          <div className="p-2 space-y-3">
            {topology?.areas.map((area) => (
              <div key={area.id} className="rounded-lg border border-slate-800/80 bg-slate-900/80 overflow-hidden">
                {/* Area Header */}
                <div className="px-3 py-2 bg-slate-800/60 border-b border-slate-800 flex items-center justify-between text-xs font-semibold text-slate-200">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-amber-400" />
                    <span>{area.name}</span>
                    <span className="text-[10px] font-mono text-slate-400">[{area.address}]</span>
                  </div>
                  <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-300">
                    {area.medium}
                  </span>
                </div>

                {/* Lines in Area */}
                <div className="divide-y divide-slate-800/50">
                  {area.lines.map((line) => {
                    const isSelected = selectedLineId === line.id
                    const devCount =
                      project?.devices.filter((d) => d.individual_address.startsWith(`${line.address}.`)).length ?? 0
                    const hasCoupler = line.coupler_device_id !== null

                    return (
                      <div
                        key={line.id}
                        onClick={() => setSelectedLineId(line.id)}
                        className={`px-3 py-2.5 text-xs flex items-center justify-between cursor-pointer transition-colors group ${
                          isSelected
                            ? 'bg-amber-500/15 border-l-4 border-amber-500 text-slate-100 font-semibold'
                            : 'hover:bg-slate-800/50 text-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              line.medium === 'Ip' ? 'bg-sky-400' : 'bg-emerald-400'
                            }`}
                          />
                          <div className="truncate">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-bold text-amber-400">{line.address}</span>
                              <span className="truncate">{line.name}</span>
                            </div>
                            <div className="text-[10px] text-slate-400 flex items-center gap-2 mt-0.5">
                              <span>{devCount} Geräte</span>
                              <span>•</span>
                              <span className="uppercase">{line.medium}</span>
                              {hasCoupler && (
                                <>
                                  <span>•</span>
                                  <span className="text-emerald-400">Koppler aktiv</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {devCount === 0 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDeleteLine(line.id, line.address)
                              }}
                              className="opacity-0 group-hover:opacity-100 p-1 hover:text-rose-400 transition-opacity"
                              title="Linie löschen"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <ChevronRight
                            className={`w-4 h-4 text-slate-500 transition-transform ${
                              isSelected ? 'text-amber-400 translate-x-0.5' : ''
                            }`}
                          />
                        </div>
                      </div>
                    )
                  })}

                  {area.lines.length === 0 && (
                    <div className="p-3 text-[11px] text-slate-500 text-center italic">
                      Keine Linien in diesem Bereich angelegt.
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Right Detail Pane */}
        {selectedLine ? (
          <main className="flex-1 flex flex-col overflow-hidden bg-slate-950">
            {/* Line Banner & Filter Mode Selector */}
            <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/60 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <span className="text-xl font-black font-mono text-amber-400">{selectedLine.address}</span>
                  <h2 className="text-base font-bold text-slate-100">{selectedLine.name}</h2>
                  <span className="text-xs uppercase font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                    Medium: {selectedLine.medium}
                  </span>
                  {selectedLine.line_number === 0 ? (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20">
                      Hauptlinie / Backbone
                    </span>
                  ) : (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      Sublinie
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Linienkoppler-Adresse:{' '}
                  <span className="font-mono text-slate-200">
                    {filterTable?.coupler_address || `${selectedLine.address}.0`}
                  </span>{' '}
                  • {lineDevices.length} physische Geräte auf dieser Linie verknüpft
                </p>
              </div>

              {/* Coupler Filter Mode Switcher */}
              <div className="flex items-center gap-2 bg-slate-950 p-1.5 rounded-lg border border-slate-800">
                <span className="text-[11px] font-semibold text-slate-400 px-2">Koppler-Modus:</span>
                <button
                  onClick={() => handleSetCouplerMode('Filter')}
                  className={`px-3 py-1 rounded text-xs font-semibold transition-all ${
                    selectedLine.coupler_filter_mode === 'Filter'
                      ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Normaler Betriebsmodus: Nur projektierte Gruppenadressen werden weitergeleitet, schont den Hauptlinien-Bus"
                >
                  Filtern (Normal)
                </button>
                <button
                  onClick={() => handleSetCouplerMode('RouteAll')}
                  className={`px-3 py-1 rounded text-xs font-semibold transition-all ${
                    selectedLine.coupler_filter_mode === 'RouteAll'
                      ? 'bg-amber-600 text-white shadow-md shadow-amber-950'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Inbetriebnahme & Diagnose: Alle Telegramme passieren ungefiltert (Durchzug)"
                >
                  Durchleiten (Diagnose)
                </button>
                <button
                  onClick={() => handleSetCouplerMode('BlockAll')}
                  className={`px-3 py-1 rounded text-xs font-semibold transition-all ${
                    selectedLine.coupler_filter_mode === 'BlockAll'
                      ? 'bg-rose-600 text-white shadow-md shadow-rose-950'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Sicherheit & Wartung: Sämtlicher Linienverkehr wird an der Koppler-Grenze blockiert"
                >
                  Sperren
                </button>
              </div>
            </div>

            {/* Navigation Tabs (Filtertabelle, Geräte auf Linie, Koppler-Hardware) */}
            <div className="px-6 border-b border-slate-800 bg-slate-900/40 flex items-center justify-between">
              <div className="flex items-center gap-6 text-xs font-semibold">
                <button
                  onClick={() => setActiveMainTab('filter')}
                  className={`py-3 border-b-2 flex items-center gap-2 transition-colors ${
                    activeMainTab === 'filter'
                      ? 'border-amber-400 text-amber-400'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Filter className="w-4 h-4" />
                  <span>Automatische Filtertabelle</span>
                  {filterTable && (
                    <span className="px-1.5 py-0.2 rounded-full bg-slate-800 text-[10px] text-slate-300">
                      {filterTable.forwarded_count} Pass / {filterTable.filtered_count} Block
                    </span>
                  )}
                </button>

                <button
                  onClick={() => setActiveMainTab('devices')}
                  className={`py-3 border-b-2 flex items-center gap-2 transition-colors ${
                    activeMainTab === 'devices'
                      ? 'border-amber-400 text-amber-400'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Cpu className="w-4 h-4" />
                  <span>Geräte auf dieser Linie ({lineDevices.length})</span>
                </button>

                <button
                  onClick={() => setActiveMainTab('diagnostics')}
                  className={`py-3 border-b-2 flex items-center gap-2 transition-colors ${
                    activeMainTab === 'diagnostics'
                      ? 'border-amber-400 text-amber-400'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Activity className="w-4 h-4" />
                  <span>Topologie-Integrität & Koppler-Health</span>
                  {healthReport && (
                    <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                      healthReport.health_score >= 90
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : healthReport.health_score >= 70
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                    }`}>
                      {healthReport.health_score}% Score
                    </span>
                  )}
                </button>
              </div>

              {/* Bitmask Download / Inspection Button */}
              {filterTable && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowHexBitmap(!showHexBitmap)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors"
                  >
                    <Binary className="w-3.5 h-3.5 text-sky-400" />
                    <span>8192-Byte Bitmaske</span>
                  </button>
                  <button
                    onClick={handleDownloadFilterBinary}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold text-slate-100 bg-emerald-600/80 hover:bg-emerald-600 transition-colors"
                    title="8192-Byte Rohbinärdatei für KNX Koppler-Flash herunterladen"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>.bin Export</span>
                  </button>
                  <button
                    onClick={handleFlashFilterTable}
                    disabled={isFlashingFilterTable}
                    className="flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold text-white bg-amber-600 hover:bg-amber-500 disabled:opacity-50 transition-colors shadow-sm"
                    title="Berechnete Filtertabelle per Live-Job direkt in den Linienkoppler flashen"
                  >
                    <Zap className="w-3.5 h-3.5 text-amber-200" />
                    <span>{isFlashingFilterTable ? 'Wird geflasht...' : 'In Koppler flashen'}</span>
                  </button>
                </div>
              )}
            </div>

            {/* TAB 1: Filter Table View */}
            {activeMainTab === 'filter' && (
              <div className="flex-1 flex flex-col overflow-hidden p-6 gap-4">
                {/* Statistics Cards */}
                {filterTable && (
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
                      <div>
                        <div className="text-[11px] text-slate-400 font-medium">Gruppenadressen im Projekt</div>
                        <div className="text-xl font-bold font-mono text-slate-100 mt-0.5">
                          {filterTable.total_gas}
                        </div>
                      </div>
                      <div className="w-8 h-8 rounded-lg bg-slate-800 text-slate-300 flex items-center justify-center font-bold">
                        <Tag className="w-4 h-4" />
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-800/60 flex items-center justify-between">
                      <div>
                        <div className="text-[11px] text-emerald-400 font-medium">Weitergeleitet (Bit = 1)</div>
                        <div className="text-xl font-bold font-mono text-emerald-300 mt-0.5">
                          {filterTable.forwarded_count}
                        </div>
                      </div>
                      <div className="w-8 h-8 rounded-lg bg-emerald-900/60 text-emerald-400 flex items-center justify-center font-bold">
                        <ArrowLeftRight className="w-4 h-4" />
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
                      <div>
                        <div className="text-[11px] text-slate-400 font-medium">Gefiltert / Blockiert (Bit = 0)</div>
                        <div className="text-xl font-bold font-mono text-slate-300 mt-0.5">
                          {filterTable.filtered_count}
                        </div>
                      </div>
                      <div className="w-8 h-8 rounded-lg bg-slate-800 text-slate-400 flex items-center justify-center font-bold">
                        <ShieldCheck className="w-4 h-4 text-slate-400" />
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-sky-950/40 border border-sky-800/60 flex items-center justify-between">
                      <div>
                        <div className="text-[11px] text-sky-400 font-medium">Buslast-Reduktion Hauptlinie</div>
                        <div className="text-xl font-bold font-mono text-sky-300 mt-0.5">
                          {filterTable.total_gas > 0
                            ? Math.round((filterTable.filtered_count / filterTable.total_gas) * 100)
                            : 100}
                          %
                        </div>
                      </div>
                      <div className="w-8 h-8 rounded-lg bg-sky-900/60 text-sky-400 flex items-center justify-center font-bold">
                        <Sliders className="w-4 h-4" />
                      </div>
                    </div>
                  </div>
                )}

                {/* Hex Bitmask Inspector Modal / Collapsible */}
                {showHexBitmap && filterTable && (
                  <div className="p-4 rounded-xl bg-slate-900 border border-sky-900/50 flex flex-col gap-2 animate-in fade-in duration-200">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
                      <span className="flex items-center gap-1.5 text-sky-400">
                        <Binary className="w-4 h-4" />
                        8192-Byte Binäre Filtertabelle (65.536 Bits für KNX GAs 0/0/0 bis 31/7/255)
                      </span>
                      <button
                        onClick={() => setShowHexBitmap(false)}
                        className="text-slate-400 hover:text-slate-200 p-1"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="max-h-32 overflow-y-auto p-2 rounded bg-slate-950 font-mono text-[11px] text-slate-400 break-all leading-relaxed select-all">
                      {filterTable.raw_bitmap_hex}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Exakte Übereinstimmung mit KNX System 2 / System 7 Linienkoppler-Speicherabbild.
                    </div>
                  </div>
                )}

                {/* Table Filter Controls */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder="Gruppenadresse, Name oder Aktor suchen..."
                        value={filterSearch}
                        onChange={(e) => setFilterSearch(e.target.value)}
                        className="pl-8 pr-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500 w-64 md:w-80"
                      />
                    </div>
                  </div>

                  {/* Filter Tabs */}
                  <div className="flex items-center bg-slate-900 p-1 rounded-lg border border-slate-800 text-xs">
                    <button
                      onClick={() => setFilterTab('all')}
                      className={`px-3 py-1 rounded font-medium transition-colors ${
                        filterTab === 'all'
                          ? 'bg-slate-800 text-slate-100 font-semibold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Alle ({filterTable?.entries.length || 0})
                    </button>
                    <button
                      onClick={() => setFilterTab('forward')}
                      className={`px-3 py-1 rounded font-medium transition-colors ${
                        filterTab === 'forward'
                          ? 'bg-emerald-950 text-emerald-300 font-semibold border border-emerald-800/80'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Weiterleiten ({filterTable?.forwarded_count || 0})
                    </button>
                    <button
                      onClick={() => setFilterTab('block')}
                      className={`px-3 py-1 rounded font-medium transition-colors ${
                        filterTab === 'block'
                          ? 'bg-slate-800 text-slate-300 font-semibold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Blockiert ({filterTable?.filtered_count || 0})
                    </button>
                    <button
                      onClick={() => setFilterTab('manual')}
                      className={`px-3 py-1 rounded font-medium transition-colors ${
                        filterTab === 'manual'
                          ? 'bg-amber-950 text-amber-300 font-semibold border border-amber-800/80'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Manuelle Freigaben ({selectedLine?.manual_forward_gas?.length || 0})
                    </button>
                  </div>
                </div>

                {/* Table Data Container */}
                <div className="flex-1 rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden flex flex-col">
                  <div className="overflow-y-auto flex-1">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-slate-900 border-b border-slate-800 text-[11px] font-semibold text-slate-400 uppercase tracking-wider z-10">
                        <tr>
                          <th className="py-2.5 px-4 w-28">Status</th>
                          <th className="py-2.5 px-4 w-24">GA</th>
                          <th className="py-2.5 px-4 w-48">Gruppenname</th>
                          <th className="py-2.5 px-4 w-20">DPT</th>
                          <th className="py-2.5 px-4">Routing-Entscheidung & Grund</th>
                          <th className="py-2.5 px-4 w-52">Sublinie & Extern</th>
                          <th className="py-2.5 px-4 w-24 text-right">Override</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-mono">
                        {visibleFilterEntries.map((entry) => {
                          const isForward = entry.action === 'Forward'
                          const isManual = selectedLine?.manual_forward_gas?.includes(entry.ga_address)

                          return (
                            <tr
                              key={entry.ga_address}
                              className={`hover:bg-slate-800/50 transition-colors ${
                                isForward ? 'bg-emerald-950/10' : ''
                              }`}
                            >
                              {/* Status Badge */}
                              <td className="py-3 px-4 font-sans">
                                {isForward ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                    <Check className="w-3 h-3" /> Weiterleiten
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
                                    <X className="w-3 h-3" /> Blockieren
                                  </span>
                                )}
                              </td>

                              {/* GA Address */}
                              <td className="py-3 px-4 font-bold text-amber-400">{entry.ga_address}</td>

                              {/* GA Name */}
                              <td className="py-3 px-4 font-sans text-slate-200 truncate max-w-xs font-medium">
                                {entry.ga_name}
                              </td>

                              {/* DPT */}
                              <td className="py-3 px-4 text-slate-400">{entry.dpt}</td>

                              {/* Decision Reason */}
                              <td className="py-3 px-4 font-sans text-xs text-slate-300">
                                <div className="flex items-center gap-1.5">
                                  {isManual && (
                                    <span className="text-[10px] font-bold bg-amber-500/20 text-amber-300 px-1 rounded">
                                      MANUELL
                                    </span>
                                  )}
                                  <span>{entry.reason}</span>
                                </div>
                              </td>

                              {/* Device Usage */}
                              <td className="py-3 px-4 font-sans text-[11px] text-slate-400">
                                {entry.subline_devices.length > 0 && (
                                  <div>
                                    <span className="text-emerald-400 font-medium">Intern:</span>{' '}
                                    {entry.subline_devices.join(', ')}
                                  </div>
                                )}
                                {entry.extline_devices.length > 0 && (
                                  <div>
                                    <span className="text-sky-400 font-medium">Extern:</span>{' '}
                                    {entry.extline_devices.join(', ')}
                                  </div>
                                )}
                              </td>

                              {/* Manual Override Action */}
                              <td className="py-3 px-4 text-right font-sans">
                                <button
                                  onClick={() => handleToggleManualGa(entry.ga_address)}
                                  className={`px-2 py-1 rounded text-[11px] font-semibold transition-colors ${
                                    isManual
                                      ? 'bg-amber-600 text-white'
                                      : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                                  }`}
                                  title="Erzwingt Weiterleitung dieser Gruppenadresse unabhängig vom Routing"
                                >
                                  {isManual ? 'Freigegeben' : 'Freigeben'}
                                </button>
                              </td>
                            </tr>
                          )
                        })}

                        {visibleFilterEntries.length === 0 && (
                          <tr>
                            <td colSpan={7} className="py-8 text-center text-slate-500 font-sans text-xs">
                              Keine Gruppenadressen für die ausgewählten Kriterien gefunden.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: Devices on Line View */}
            {activeMainTab === 'devices' && (
              <div className="flex-1 flex flex-col overflow-hidden p-6 gap-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-100">
                      Geräte auf Linie {selectedLine.address} ({lineDevices.length})
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Physische KNX Geräte mit Adressen im Bereich {selectedLine.address}.1 bis{' '}
                      {selectedLine.address}.255
                    </p>
                  </div>
                </div>

                <div className="flex-1 rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden flex flex-col">
                  <div className="overflow-y-auto flex-1">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-slate-900 border-b border-slate-800 text-[11px] font-semibold text-slate-400 uppercase tracking-wider z-10">
                        <tr>
                          <th className="py-2.5 px-4 w-28">Phys. Adresse</th>
                          <th className="py-2.5 px-4">Gerätename</th>
                          <th className="py-2.5 px-4 w-40">Hersteller / Modell</th>
                          <th className="py-2.5 px-4 w-28">KOs verknüpft</th>
                          <th className="py-2.5 px-4 w-48 text-right">Aktionen</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {lineDevices.map((dev) => {
                          const isCoupler = dev.id === selectedLine.coupler_device_id || dev.individual_address.endsWith('.0')
                          const koCount = dev.communication_objects?.length ?? 0
                          const linkedGaCount = dev.communication_objects?.filter(
                            (k) => k.group_addresses?.length > 0 || k.group_address_ids?.length > 0
                          ).length ?? 0

                          return (
                            <tr key={dev.id} className="hover:bg-slate-800/40 transition-colors font-sans">
                              {/* Address */}
                              <td className="py-3 px-4 font-mono font-bold text-amber-400">
                                {dev.individual_address}
                              </td>

                              {/* Name */}
                              <td className="py-3 px-4 text-slate-200 font-medium flex items-center gap-2">
                                <span>{dev.name}</span>
                                {isCoupler && (
                                  <span className="text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded">
                                    Linienkoppler
                                  </span>
                                )}
                              </td>

                              {/* Manufacturer */}
                              <td className="py-3 px-4 text-slate-400">
                                {dev.manufacturer} {dev.model ? `• ${dev.model}` : ''}
                              </td>

                              {/* KOs */}
                              <td className="py-3 px-4 text-slate-300 font-mono">
                                {linkedGaCount} / {koCount} KOs
                              </td>

                              {/* Actions */}
                              <td className="py-3 px-4 text-right space-x-2">
                                {onOpenDeviceModal && (
                                  <button
                                    onClick={() => onOpenDeviceModal(dev)}
                                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
                                  >
                                    KOs & Parameter
                                  </button>
                                )}
                                <button
                                  onClick={() => {
                                    setMovingDeviceId(dev.id)
                                    // Default target line
                                    const otherArea = topology?.areas[0]
                                    const otherLine = otherArea?.lines.find((l) => l.address !== selectedLine.address)
                                    setTargetLineAddress(otherLine ? otherLine.address : '1.2')
                                  }}
                                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-amber-600 hover:text-white text-slate-300 text-xs font-medium transition-colors"
                                  title="Gerät auf eine andere KNX Linie verschieben"
                                >
                                  Verschieben
                                </button>
                              </td>
                            </tr>
                          )
                        })}

                        {lineDevices.length === 0 && (
                          <tr>
                            <td colSpan={5} className="py-8 text-center text-slate-500 text-xs">
                              Auf dieser Linie sind noch keine KNX Geräte angelegt.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: Topology Health & Coupler Diagnostics View */}
            {activeMainTab === 'diagnostics' && (
              <div className="flex-1 flex flex-col overflow-y-auto p-6 gap-6">
                {/* Hero Header & Score */}
                <div className="bg-gradient-to-r from-slate-900 to-slate-950 rounded-2xl border border-slate-800 p-6 flex flex-wrap items-center justify-between gap-6 shadow-xl">
                  <div className="flex items-center gap-5">
                    <div
                      className={`w-18 h-18 rounded-2xl border flex flex-col items-center justify-center p-3 shadow-lg ${
                        (healthReport?.health_score ?? 100) >= 90
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-emerald-950/40'
                          : (healthReport?.health_score ?? 100) >= 70
                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 shadow-amber-950/40'
                          : 'bg-rose-500/10 border-rose-500/30 text-rose-400 shadow-rose-950/40'
                      }`}
                    >
                      <span className="text-2xl font-black font-mono leading-none">
                        {healthReport?.health_score ?? 100}%
                      </span>
                      <span className="text-[10px] uppercase font-bold tracking-wider mt-1 opacity-80">
                        Score
                      </span>
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-base font-bold text-slate-100">
                          {(healthReport?.health_score ?? 100) >= 90
                            ? 'Topologie-Integrität: Exzellent'
                            : (healthReport?.health_score ?? 100) >= 70
                            ? 'Topologie-Integrität: Optimierungsbedarf'
                            : 'Topologie-Integrität: Kritische Warnungen'}
                        </h2>
                        <span className="text-[10px] bg-slate-800 text-slate-300 border border-slate-700 px-2 py-0.5 rounded font-mono">
                          ETS-Topologie-Engine
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1 max-w-xl">
                        Automatische Prüfung der Linienkoppler-Filtertabellen auf Querverweis-Blockaden,
                        Berechnung der theoretischen TP-Buslast und Erkennung isolierter KNX-Geräte.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={loadTopologyData}
                      disabled={loadingHealth}
                      className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-2 border border-slate-700 transition-all cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${loadingHealth ? 'animate-spin' : ''}`} />
                      <span>Neu analysieren</span>
                    </button>
                  </div>
                </div>

                {/* KPI Summary Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-slate-900/60 rounded-xl border border-slate-800 p-4">
                    <div className="text-[11px] text-slate-400 font-medium">Bereiche (Subnetze)</div>
                    <div className="text-xl font-bold font-mono text-amber-400 mt-1">
                      {healthReport?.total_areas ?? totalAreas}
                    </div>
                  </div>
                  <div className="bg-slate-900/60 rounded-xl border border-slate-800 p-4">
                    <div className="text-[11px] text-slate-400 font-medium">KNX Linien</div>
                    <div className="text-xl font-bold font-mono text-sky-400 mt-1">
                      {healthReport?.total_lines ?? totalLines}
                    </div>
                  </div>
                  <div className="bg-slate-900/60 rounded-xl border border-slate-800 p-4">
                    <div className="text-[11px] text-slate-400 font-medium">Linienkoppler</div>
                    <div className="text-xl font-bold font-mono text-emerald-400 mt-1">
                      {healthReport?.total_couplers ?? totalCouplers}
                    </div>
                  </div>
                  <div className="bg-slate-900/60 rounded-xl border border-slate-800 p-4">
                    <div className="text-[11px] text-slate-400 font-medium">Isolierte Geräte</div>
                    <div className={`text-xl font-bold font-mono mt-1 ${
                      (healthReport?.isolated_devices?.length ?? 0) > 0 ? 'text-rose-400' : 'text-slate-400'
                    }`}>
                      {healthReport?.isolated_devices?.length ?? 0}
                    </div>
                  </div>
                </div>

                {/* Coupler Health & Cross-Line Filter Validation */}
                <div className="bg-slate-900/60 rounded-xl border border-slate-800 p-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                    <div className="flex items-center gap-2">
                      <ArrowLeftRight className="w-4 h-4 text-emerald-400" />
                      <h3 className="text-sm font-bold text-slate-100">
                        Linienkoppler-Filtertabellen & Querverweis-Prüfung
                      </h3>
                    </div>
                    <span className="text-xs text-slate-400 font-mono">
                      {healthReport?.couplers?.length ?? 0} Koppler analysiert
                    </span>
                  </div>

                  {healthReport?.couplers && healthReport.couplers.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {healthReport.couplers.map((c) => {
                        const hasBlockedCrossLine = c.blocked_cross_line_gas.length > 0
                        return (
                          <div
                            key={c.coupler_address}
                            className={`rounded-xl border p-4 transition-all ${
                              hasBlockedCrossLine
                                ? 'bg-rose-950/20 border-rose-500/40 shadow-lg shadow-rose-950/20'
                                : 'bg-slate-950/60 border-slate-800'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-amber-400 text-sm">
                                  {c.coupler_address}
                                </span>
                                <span className="text-xs text-slate-400">
                                  (Linie {c.line_address})
                                </span>
                              </div>
                              <span
                                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                  c.filter_mode === 'Filter'
                                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                    : c.filter_mode === 'RouteAll'
                                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                    : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                                }`}
                              >
                                {c.filter_mode}
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-xs py-2 border-y border-slate-800/60">
                              <div>
                                <span className="text-slate-500 block text-[10px]">Weitergeleitet:</span>
                                <span className="font-mono text-emerald-400 font-bold">
                                  {c.forwarded_gas_count} GAs
                                </span>
                              </div>
                              <div>
                                <span className="text-slate-500 block text-[10px]">Gesperrt:</span>
                                <span className="font-mono text-slate-400 font-bold">
                                  {c.blocked_gas_count} GAs
                                </span>
                              </div>
                            </div>

                            {/* Blocked Cross-Line GAs Warning */}
                            {hasBlockedCrossLine ? (
                              <div className="mt-3 p-2.5 rounded-lg bg-rose-950/50 border border-rose-500/40 text-xs text-rose-200 space-y-1">
                                <div className="font-bold flex items-center gap-1.5 text-rose-300">
                                  <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                                  <span>
                                    {c.blocked_cross_line_gas.length} Querverweis-GA(s) fälschlich blockiert!
                                  </span>
                                </div>
                                <div className="text-[11px] text-rose-200/80">
                                  Diese Gruppenadressen sind über Koppler-Grenzen hinweg verdrahtet, werden jedoch nicht weitergeleitet:
                                </div>
                                <div className="flex flex-wrap gap-1 pt-1">
                                  {c.blocked_cross_line_gas.map((ga) => (
                                    <span
                                      key={ga}
                                      className="font-mono text-[10px] bg-rose-900/60 border border-rose-500/50 text-rose-200 px-1.5 py-0.5 rounded"
                                    >
                                      {ga}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <div className="mt-3 text-[11px] text-emerald-400/80 flex items-center gap-1.5">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                <span>Alle linienübergreifenden GAs werden korrekt weitergeleitet.</span>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="py-6 text-center text-slate-500 text-xs">
                      Keine Linienkoppler in der Topologie konfiguriert (Einzellinien-System).
                    </div>
                  )}
                </div>

                {/* Line Bandwidth & Load Estimation */}
                <div className="bg-slate-900/60 rounded-xl border border-slate-800 p-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                    <div className="flex items-center gap-2">
                      <Network className="w-4 h-4 text-sky-400" />
                      <h3 className="text-sm font-bold text-slate-100">
                        Linien-Bandbreiten & Lastanalyse (9600 Baud TP / IP)
                      </h3>
                    </div>
                    <span className="text-xs text-slate-400 font-mono">
                      TP-Frame-Modell (11 Bit/Byte + 50 Bit Pausen)
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-950/80 border-b border-slate-800 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                        <tr>
                          <th className="py-2.5 px-4">Linie</th>
                          <th className="py-2.5 px-4">Medium</th>
                          <th className="py-2.5 px-4">Geräte</th>
                          <th className="py-2.5 px-4">KOs gesamt</th>
                          <th className="py-2.5 px-4">Geschätzte Buslast</th>
                          <th className="py-2.5 px-4 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-sans">
                        {(healthReport?.lines ?? []).map((l) => (
                          <tr key={l.line_address} className="hover:bg-slate-800/30 transition-colors">
                            <td className="py-3 px-4 font-mono font-bold text-sky-400">
                              Linie {l.line_address}
                            </td>
                            <td className="py-3 px-4">
                              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                                {l.medium}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-mono text-slate-200">
                              {l.device_count} Geräte
                            </td>
                            <td className="py-3 px-4 font-mono text-slate-300">
                              {l.total_kos} KOs
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-3">
                                <div className="w-24 h-2 rounded-full bg-slate-950 border border-slate-800 overflow-hidden">
                                  <div
                                    className={`h-full transition-all duration-300 ${
                                      l.estimated_load_percent > 70
                                        ? 'bg-rose-500'
                                        : l.estimated_load_percent > 40
                                        ? 'bg-amber-400'
                                        : 'bg-emerald-400'
                                    }`}
                                    style={{ width: `${Math.min(100, Math.max(5, l.estimated_load_percent))}%` }}
                                  />
                                </div>
                                <span className="font-mono text-slate-300 text-[11px]">
                                  {l.estimated_load_percent.toFixed(1)}%
                                </span>
                              </div>
                            </td>
                            <td className="py-3 px-4 text-right font-medium">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  l.status === 'Optimal'
                                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                    : l.status === 'Normal'
                                    ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                                    : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                                }`}
                              >
                                {l.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Validation Issues / Isolated Devices List if any */}
                {(healthReport?.issues?.length ?? 0) > 0 && (
                  <div className="bg-rose-950/30 rounded-xl border border-rose-500/30 p-5 space-y-3">
                    <div className="flex items-center gap-2 text-rose-300 text-sm font-bold">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                      <span>Gefundene Topologie-Konflikte & Warnungen ({healthReport?.issues.length})</span>
                    </div>
                    <div className="space-y-2">
                      {healthReport?.issues.map((issue, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-lg bg-slate-950/60 border border-rose-500/20 text-xs text-rose-200 flex items-start justify-between gap-3"
                        >
                          <div>
                            <span className="font-semibold text-rose-300">
                              {issue.line_address ? `Linie ${issue.line_address}` : issue.device_address ? `Gerät ${issue.device_address}` : 'Topologie'}:
                            </span>{' '}
                            <span>{issue.message}</span>
                          </div>
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-rose-900/40 text-rose-300 border border-rose-500/30 shrink-0">
                            {issue.severity || 'Warnung'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </main>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-xs p-8">
            <Network className="w-12 h-12 text-slate-700 mb-3" />
            <p className="text-sm font-semibold text-slate-400">Keine Linie ausgewählt</p>
            <p className="text-slate-600 mt-1">
              Wähle links im Topologie-Baum eine Linie aus, um deren Filtertabelle und Geräte einzusehen.
            </p>
          </div>
        )}
      </div>

      {/* MODAL: Add Area */}
      {isAddAreaOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateArea}
            className="w-full max-w-md bg-slate-900 rounded-xl border border-slate-800 shadow-2xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Layers className="w-4 h-4 text-amber-400" />
                Neuen KNX Bereich anlegen
              </h3>
              <button
                type="button"
                onClick={() => setIsAddAreaOpen(false)}
                className="text-slate-400 hover:text-slate-200 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Bereichsnummer (0..15)</label>
                <input
                  type="number"
                  min="0"
                  max="15"
                  value={newAreaNumber}
                  onChange={(e) => setNewAreaNumber(parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-1.5 rounded bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-amber-500"
                  required
                />
                <span className="text-[10px] text-slate-500">Bereich 0 ist der IP-Backbone.</span>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Name des Bereichs</label>
                <input
                  type="text"
                  value={newAreaName}
                  onChange={(e) => setNewAreaName(e.target.value)}
                  className="w-full px-3 py-1.5 rounded bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-amber-500"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Übertragungsmedium</label>
                <select
                  value={newAreaMedium}
                  onChange={(e) => setNewAreaMedium(e.target.value as KnxMediumType)}
                  className="w-full px-3 py-1.5 rounded bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-amber-500"
                >
                  <option value="Tp">TP (Twisted Pair / 9600 Baud)</option>
                  <option value="Ip">IP (KNXnet/IP Routing)</option>
                  <option value="Rf">RF (Radio Frequency)</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsAddAreaOpen(false)}
                className="px-3 py-1.5 rounded text-xs font-semibold text-slate-400 hover:text-slate-200"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white shadow"
              >
                Bereich erstellen
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: Add Line */}
      {isAddLineOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateLine}
            className="w-full max-w-md bg-slate-900 rounded-xl border border-slate-800 shadow-2xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Network className="w-4 h-4 text-sky-400" />
                Neue KNX Linie anlegen
              </h3>
              <button
                type="button"
                onClick={() => setIsAddLineOpen(false)}
                className="text-slate-400 hover:text-slate-200 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Bereich</label>
                <select
                  value={addLineAreaId}
                  onChange={(e) => setAddLineAreaId(e.target.value)}
                  className="w-full px-3 py-1.5 rounded bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-amber-500"
                  required
                >
                  {topology?.areas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} (Bereich {a.area_number})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Liniennummer (0..15)</label>
                <input
                  type="number"
                  min="0"
                  max="15"
                  value={newLineNumber}
                  onChange={(e) => setNewLineNumber(parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-1.5 rounded bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-amber-500"
                  required
                />
                <span className="text-[10px] text-slate-500">
                  Linie 0 ist die Hauptlinie des Bereichs. 1 bis 15 sind Sublinien.
                </span>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Name der Linie</label>
                <input
                  type="text"
                  value={newLineName}
                  onChange={(e) => setNewLineName(e.target.value)}
                  className="w-full px-3 py-1.5 rounded bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-amber-500"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Übertragungsmedium</label>
                <select
                  value={newLineMedium}
                  onChange={(e) => setNewLineMedium(e.target.value as KnxMediumType)}
                  className="w-full px-3 py-1.5 rounded bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-amber-500"
                >
                  <option value="Tp">TP (Twisted Pair)</option>
                  <option value="Ip">IP (KNXnet/IP)</option>
                  <option value="Rf">RF (Funk)</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsAddLineOpen(false)}
                className="px-3 py-1.5 rounded text-xs font-semibold text-slate-400 hover:text-slate-200"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white shadow"
              >
                Linie erstellen
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: Move Device to Line */}
      {movingDeviceId && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 rounded-xl border border-slate-800 shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <ArrowRight className="w-4 h-4 text-amber-400" />
                Gerät auf andere KNX Linie verschieben
              </h3>
              <button
                type="button"
                onClick={() => setMovingDeviceId(null)}
                className="text-slate-400 hover:text-slate-200 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-slate-300">
                Wähle die Ziellinie aus. Das Gerät erhält automatisch die nächste freie physikalische Adresse auf
                dieser Linie.
              </p>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Ziellinie</label>
                <select
                  value={targetLineAddress}
                  onChange={(e) => setTargetLineAddress(e.target.value)}
                  className="w-full px-3 py-1.5 rounded bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-amber-500 font-mono"
                >
                  {topology?.areas.flatMap((a) =>
                    a.lines.map((l) => (
                      <option key={l.id} value={l.address}>
                        {l.address} - {l.name}
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setMovingDeviceId(null)}
                className="px-3 py-1.5 rounded text-xs font-semibold text-slate-400 hover:text-slate-200"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={handleExecuteMoveDevice}
                disabled={isMoving}
                className="px-4 py-1.5 rounded text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white shadow disabled:opacity-50"
              >
                {isMoving ? 'Verschiebe...' : 'Auf Linie verschieben'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
