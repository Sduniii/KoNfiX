import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Play,
  Square,
  Search,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Wrench,
  Network,
  Cpu,
  Radio,
  Activity,
  Check,
  Loader2,
  Sparkles,
  ArrowRight,
  Info,
  Layers,
  Clock,
  ShieldCheck,
  Eye,
  AlertTriangle,
  Zap,
  Hash,
} from 'lucide-react'
import {
  Project,
  KnxDevice,
  ScannedAddressInfo,
  LineScanProgress,
  DeviceProgModeInfo,
  DeviceDetailedInfo,
  AddressScanStatus,
  AddressCollisionInfo,
} from '../../types/knx'
import {
  getDiagnosticsResults,
  getDiagnosticsProgress,
  startLineScan,
  stopLineScan,
  scanProgrammingMode,
  queryDeviceInfo,
  programIndividualAddress,
  fetchAddressCollisions,
  locateDevice,
  programAddressBySerial,
} from '../../services/api'
import { useTranslation } from '../../i18n/I18nContext'

interface DiagnosticsWorkspaceProps {
  project: Project | null
  onReloadProject?: () => void
  initialAddress?: string | null
  onSwitchToCanvas?: () => void
}

export const DiagnosticsWorkspace: React.FC<DiagnosticsWorkspaceProps> = ({
  project,
  onReloadProject,
  initialAddress,
  onSwitchToCanvas,
}) => {
  const { t } = useTranslation()
  const [line, setLine] = useState<string>(() => {
    if (initialAddress) {
      const parts = initialAddress.split('.')
      if (parts.length === 3) return `${parts[0]}.${parts[1]}`
    }
    return '1.1'
  })
  const [scanStart, setScanStart] = useState<number>(1)
  const [scanEnd, setScanEnd] = useState<number>(255)
  const [scanResults, setScanResults] = useState<ScannedAddressInfo[]>([])
  const [progress, setProgress] = useState<LineScanProgress>({
    is_running: false,
    line: '1.1',
    current_address: null,
    scanned_count: 0,
    total_count: 255,
    occupied_count: 0,
    percent: 0,
  })
  const [selectedAddress, setSelectedAddress] = useState<string | null>(initialAddress || '1.1.252')

  useEffect(() => {
    if (initialAddress) {
      setSelectedAddress(initialAddress)
      const parts = initialAddress.split('.')
      if (parts.length === 3) {
        setLine(`${parts[0]}.${parts[1]}`)
      }
    }
  }, [initialAddress])
  const [deviceDetail, setDeviceDetail] = useState<DeviceDetailedInfo | null>(null)
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false)
  const [progModeDevices, setProgModeDevices] = useState<DeviceProgModeInfo[]>([])
  const [isScanningProgMode, setIsScanningProgMode] = useState<boolean>(false)

  // Program Address Modal State
  const [isProgramModalOpen, setIsProgramModalOpen] = useState<boolean>(false)
  const [programTargetAddress, setProgramTargetAddress] = useState<string>('1.1.10')
  const [programSelectedDeviceId, setProgramSelectedDeviceId] = useState<string>('')
  const [isProgramming, setIsProgramming] = useState<boolean>(false)
  const [programResult, setProgramResult] = useState<{ success: boolean; message: string } | null>(null)
  const [programTab, setProgramTab] = useState<'button' | 'serial'>('button')
  const [programSerialNumber, setProgramSerialNumber] = useState<string>('')

  // Collisions and Hardware-Wizard State
  const [collisions, setCollisions] = useState<AddressCollisionInfo[]>([])
  const [isCheckingCollisions, setIsCheckingCollisions] = useState<boolean>(false)
  const [isLocating, setIsLocating] = useState<boolean>(false)
  const [locateStatus, setLocateStatus] = useState<string | null>(null)

  // Fetch initial results and poll progress when running
  const refreshResults = useCallback(async () => {
    try {
      const [resList, prog] = await Promise.all([
        getDiagnosticsResults().catch(() => []),
        getDiagnosticsProgress().catch(() => null),
      ])
      if (Array.isArray(resList)) {
        setScanResults(resList)
      }
      if (prog && typeof prog === 'object') {
        setProgress(prog)
        if (prog.line && prog.is_running) {
          setLine(prog.line)
        }
      }
    } catch (err) {
      console.error('Error loading diagnostics data:', err)
    }
  }, [])

  useEffect(() => {
    refreshResults()
  }, [refreshResults])

  // Listen to live diagnostics events streamed over WebSocket
  useEffect(() => {
    const handleDiagEvent = (e: Event) => {
      const customEvt = e as CustomEvent
      const detail = customEvt.detail
      if (!detail) return

      if (detail.event === 'scan_progress' && detail.data) {
        const prog: LineScanProgress = detail.data
        setProgress(prog)
        if (prog.line) {
          setLine(prog.line)
        }
      } else if (detail.event === 'device_found' && detail.data) {
        const found: ScannedAddressInfo = detail.data
        setScanResults((prev) => {
          const list = Array.isArray(prev) ? prev : []
          const filtered = list.filter((r) => r.address !== found.address)
          return [...filtered, found]
        })
      } else if (detail.event === 'prog_mode_detected' && detail.data) {
        const progDev: DeviceProgModeInfo = detail.data
        setProgModeDevices((prev) => {
          const list = Array.isArray(prev) ? prev : []
          const filtered = list.filter((d) => d && d.address !== progDev.address)
          return [...filtered, progDev]
        })
      }
    }

    window.addEventListener('knx-diagnostics-event', handleDiagEvent)
    return () => {
      window.removeEventListener('knx-diagnostics-event', handleDiagEvent)
    }
  }, [])

  // Polling loop when scan is running
  useEffect(() => {
    let timer: any
    if (progress?.is_running) {
      timer = setInterval(() => {
        refreshResults()
      }, 500)
    }
    return () => clearInterval(timer)
  }, [progress?.is_running, refreshResults])

  // Fetch device details when selectedAddress changes
  useEffect(() => {
    if (!selectedAddress) return
    setLoadingDetail(true)
    queryDeviceInfo(selectedAddress)
      .then((det) => {
        setDeviceDetail(det)
        setLoadingDetail(false)
        if (det && det.reachable) {
          setScanResults((prev) => {
            const list = Array.isArray(prev) ? prev : []
            return list.map((item) => {
              if (item.address === det.address) {
                return {
                  ...item,
                  status: 'Occupied' as const,
                  mask_version: det.mask_version || item.mask_version,
                  rtt_ms: det.rtt_ms,
                  last_seen: `Online (${new Date().toLocaleTimeString()})`,
                }
              }
              return item
            })
          })
        }
      })
      .catch((_) => {
        setDeviceDetail(null)
        setLoadingDetail(false)
      })
  }, [selectedAddress])

  // Start Line Scan
  const handleStartScan = async () => {
    try {
      await startLineScan(line, scanStart, scanEnd)
      refreshResults()
    } catch (err: any) {
      alert(`Fehler beim Starten des Linien-Scans: ${err.message}`)
    }
  }

  // Stop Line Scan
  const handleStopScan = async () => {
    try {
      await stopLineScan()
      refreshResults()
    } catch (err: any) {
      alert(`Fehler beim Stoppen des Scans: ${err.message}`)
    }
  }

  // Scan Programming Mode
  const handleScanProgMode = async () => {
    setIsScanningProgMode(true)
    try {
      const devs = await scanProgrammingMode(1500)
      setProgModeDevices(devs)
      if (devs.length > 0) {
        setSelectedAddress(devs[0].address)
      }
    } catch (err: any) {
      alert(`Fehler bei Programmiermodus-Suche: ${err.message}`)
    } finally {
      setIsScanningProgMode(false)
    }
  }

  const isTargetAddressOccupied = useMemo(() => {
    return scanResults.some((r) => r.address === programTargetAddress && r.status === 'Occupied')
  }, [scanResults, programTargetAddress])

  // Automatically scan for devices in programming mode when opening program address modal
  useEffect(() => {
    if (isProgramModalOpen) {
      handleScanProgMode()
    }
  }, [isProgramModalOpen])

  // Program Address Handler (via Programming Button)
  const handleExecuteProgramAddress = async () => {
    setIsProgramming(true)
    setProgramResult(null)
    try {
      const res = await programIndividualAddress(
        programTargetAddress,
        programSelectedDeviceId || undefined
      )
      setProgramResult({ success: res.success, message: res.message })
      refreshResults()
      if (onReloadProject) {
        onReloadProject()
      }
    } catch (err: any) {
      setProgramResult({ success: false, message: err.message })
    } finally {
      setIsProgramming(false)
    }
  }

  // Program Address Handler (via 6-Byte Serial Number)
  const handleExecuteProgramBySerial = async () => {
    if (!programSerialNumber.trim()) {
      setProgramResult({ success: false, message: 'Bitte geben Sie die 6-Byte KNX-Seriennummer des Geräts ein (z. B. 00:83:7B:40:02:85)' })
      return
    }
    setIsProgramming(true)
    setProgramResult(null)
    try {
      const res = await programAddressBySerial(programSerialNumber.trim(), programTargetAddress)
      setProgramResult({ success: res.success, message: res.message })
      refreshResults()
      if (onReloadProject) {
        onReloadProject()
      }
    } catch (err: any) {
      setProgramResult({ success: false, message: err.message || 'Fehler beim Programmieren per Seriennummer' })
    } finally {
      setIsProgramming(false)
    }
  }

  // Optical locate / blink device
  const handleLocateSelectedDevice = async () => {
    if (!selectedAddress) return
    setIsLocating(true)
    setLocateStatus('Blink-Signal wird gesendet (5s)...')
    try {
      const res = await locateDevice(selectedAddress, 5)
      setLocateStatus(res.message || 'Blink-Signal aktiv')
      setTimeout(() => {
        setLocateStatus(null)
        setIsLocating(false)
      }, 5000)
    } catch (err: any) {
      setLocateStatus(`Fehler: ${err.message}`)
      setTimeout(() => {
        setLocateStatus(null)
        setIsLocating(false)
      }, 4000)
    }
  }

  // Check Address Collisions
  const handleCheckCollisions = useCallback(async () => {
    setIsCheckingCollisions(true)
    try {
      const cols = await fetchAddressCollisions()
      setCollisions(Array.isArray(cols) ? cols : [])
    } catch (err) {
      console.error('Fehler bei Prüfung auf Adresskollisionen:', err)
    } finally {
      setIsCheckingCollisions(false)
    }
  }, [])

  useEffect(() => {
    handleCheckCollisions()
  }, [handleCheckCollisions])

  // Map project devices by individual address
  const projectDevicesMap = useMemo(() => {
    const map = new Map<string, KnxDevice>()
    if (project?.devices && Array.isArray(project.devices)) {
      project.devices.forEach((d) => {
        if (d && d.individual_address) {
          map.set(d.individual_address, d)
        }
      })
    }
    return map
  }, [project?.devices])

  // Project devices on the current selected line (e.g. 1.1)
  const projectDevicesOnLine = useMemo(() => {
    if (!project?.devices) return []
    return project.devices.filter((d) => d && d.individual_address?.startsWith(`${line}.`))
  }, [project?.devices, line])

  // Stats
  const liveOccupiedCount = useMemo(() => {
    if (!Array.isArray(scanResults)) return 0
    return scanResults.filter((r) => r && r.status === 'Occupied' && (r.rtt_ms != null || r.last_seen?.includes('Online'))).length
  }, [scanResults])

  const occupiedCount = useMemo(() => {
    if (!Array.isArray(scanResults)) return 0
    return scanResults.filter((r) => r && (r.status === 'Occupied' || r.status === 'Gateway')).length
  }, [scanResults])

  const freeCount = useMemo(() => {
    if (!Array.isArray(scanResults)) return 0
    return scanResults.filter((r) => r && r.status === 'Free').length
  }, [scanResults])

  // Map scanResults by address string for quick lookup
  const resultsMap = useMemo(() => {
    const map = new Map<string, ScannedAddressInfo>()
    if (Array.isArray(scanResults)) {
      scanResults.forEach((r) => {
        if (r && r.address) map.set(r.address, r)
      })
    }
    return map
  }, [scanResults])

  const selectedProjDevice = useMemo(() => {
    if (!selectedAddress) return null
    return projectDevicesMap.get(selectedAddress) || null
  }, [selectedAddress, projectDevicesMap])

  const selectedInfo = useMemo(() => {
    if (!selectedAddress) return null
    return resultsMap.get(selectedAddress) || null
  }, [selectedAddress, resultsMap])

  return (
    <div className="flex-1 flex flex-col bg-slate-950 text-slate-100 overflow-hidden select-none w-full h-full">
      {/* Top Controls & Navigation Bar */}
      <div className="border-b border-slate-800 bg-slate-900/90 px-6 py-3 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400">
            <Wrench className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <span>{t('diagnostics.title')}</span>
              <span className="text-[10px] bg-sky-500/20 text-sky-400 border border-sky-500/30 px-2 py-0.5 rounded-full font-mono">
                KNX Management Layer
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              {t('diagnostics.subtitle')}
            </p>
          </div>
        </div>

        {/* Scan Controls */}
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800 text-xs gap-2">
            <span className="text-slate-400 font-medium">Linie:</span>
            <select
              value={line}
              onChange={(e) => setLine(e.target.value)}
              className="bg-transparent text-slate-200 font-mono font-bold focus:outline-none cursor-pointer"
            >
              <option value="1.1" className="bg-slate-900 text-slate-200">1.1 (Hauptlinie EG/OG)</option>
              <option value="1.0" className="bg-slate-900 text-slate-200">1.0 (Bereichslinie)</option>
              <option value="1.2" className="bg-slate-900 text-slate-200">1.2 (Sublinie)</option>
              <option value="1.3" className="bg-slate-900 text-slate-200">1.3 (Außenbereich)</option>
            </select>
          </div>

          <div className="flex items-center bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800 text-xs gap-1.5 font-mono">
            <span className="text-slate-400">Bereich:</span>
            <input
              type="number"
              min={1}
              max={255}
              value={scanStart}
              onChange={(e) => setScanStart(parseInt(e.target.value) || 1)}
              className="w-12 bg-slate-900 text-center rounded text-slate-200 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
            <span className="text-slate-600">..</span>
            <input
              type="number"
              min={1}
              max={255}
              value={scanEnd}
              onChange={(e) => setScanEnd(parseInt(e.target.value) || 255)}
              className="w-12 bg-slate-900 text-center rounded text-slate-200 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>

          {progress.is_running ? (
            <button
              onClick={handleStopScan}
              className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-lg shadow-rose-600/20 transition-all cursor-pointer"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Scan stoppen</span>
            </button>
          ) : (
            <button
              onClick={handleStartScan}
              className="px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-lg shadow-sky-600/20 transition-all cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Linie scannen</span>
            </button>
          )}

          <button
            onClick={handleScanProgMode}
            disabled={isScanningProgMode}
            className={`px-3.5 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              isScanningProgMode
                ? 'bg-slate-800 text-slate-500 border-slate-700'
                : 'bg-slate-800/80 hover:bg-slate-800 text-amber-300 border-amber-500/30 hover:border-amber-500/60'
            }`}
            title="Prüft per Broadcast A_IndividualAddress_Read, welche Geräte im Programmiermodus sind (LED an)"
          >
            {isScanningProgMode ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
            ) : (
              <Radio className="w-3.5 h-3.5 text-amber-400" />
            )}
            <span>Prog-Taste suchen</span>
          </button>

          <button
            onClick={handleCheckCollisions}
            disabled={isCheckingCollisions}
            className={`px-3.5 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              collisions.length > 0
                ? 'bg-rose-950/60 border-rose-500/50 text-rose-300 hover:bg-rose-900/60'
                : 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 border-slate-700/80'
            }`}
            title="Prüft das gesamte Projekt und den Bus-Scan auf doppelt belegte physikalische Adressen"
          >
            {isCheckingCollisions ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
            ) : (
              <ShieldCheck className={`w-3.5 h-3.5 ${collisions.length > 0 ? 'text-rose-400' : 'text-emerald-400'}`} />
            )}
            <span>Kollisionen {collisions.length > 0 ? `(${collisions.length})` : ''}</span>
          </button>

          <button
            onClick={() => setIsProgramModalOpen(true)}
            className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-lg shadow-emerald-600/20 transition-all cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Adresse programmieren</span>
          </button>
        </div>
      </div>

      {/* Collision Alert Banner */}
      {collisions.length > 0 && (
        <div className="bg-rose-950/70 border-b border-rose-500/40 px-6 py-2.5 flex items-center justify-between text-xs text-rose-200 animate-fadeIn">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <div>
              <span className="font-bold text-rose-300">
                Achtung: {collisions.length} Adresskollision(en) erkannt!
              </span>
              <span className="ml-2 text-rose-200/90 font-mono">
                {collisions.map((c) => `${c.address} (${c.device_names.join(' / ')})`).join(' • ')}
              </span>
            </div>
          </div>
          <button
            onClick={() => {
              if (collisions[0]?.address) setSelectedAddress(collisions[0].address)
            }}
            className="px-2.5 py-1 rounded bg-rose-800/80 hover:bg-rose-700 text-white font-semibold text-[11px] transition-colors cursor-pointer"
          >
            Zur ersten Kollision
          </button>
        </div>
      )}

      {/* Offline-Mode Banner (no live gateway) */}
      {!progress.is_running && scanResults.length === 0 && projectDevicesOnLine.length > 0 && (
        <div className="bg-indigo-950/40 border-b border-indigo-500/20 px-6 py-2 flex items-center gap-3 text-xs text-indigo-300">
          <Activity className="w-3.5 h-3.5 shrink-0 text-indigo-400" />
          <span>
            <strong>{projectDevicesOnLine.length} Projektgeräte</strong> auf Linie {line} — klicke „Linie scannen" für Live-Status vom physischen KNX-Bus.
          </span>
        </div>
      )}

      {/* Programming Mode Alert Banner if detected */}
      {progModeDevices.length > 0 && (
        <div className="bg-amber-950/50 border-b border-amber-500/30 px-6 py-2.5 flex items-center justify-between animate-fadeIn">
          <div className="flex items-center gap-3 text-amber-200 text-xs">
            <span className="w-3 h-3 rounded-full bg-rose-500 animate-ping shrink-0" />
            <span className="font-bold text-amber-300">
              {progModeDevices.length} Gerät im Programmiermodus aktiv!
            </span>
            <span className="text-amber-300/80 font-mono">
              Adresse: {progModeDevices.map((d) => d.address).join(', ')}
            </span>
            <span className="text-amber-400/60">
              (Erkannt um {progModeDevices[0].detected_at})
            </span>
          </div>

          <button
            onClick={() => {
              setProgramTargetAddress(progModeDevices[0].address)
              setIsProgramModalOpen(true)
            }}
            className="px-3 py-1 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1 cursor-pointer transition-colors"
          >
            <span>Jetzt physikalische Adresse zuweisen</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Content: Left Grid + Right Inspector */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: 255-Address Visual Matrix */}
        <div className="flex-1 flex flex-col p-6 overflow-y-auto">
          {/* Progress & Legend Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4 bg-slate-900/60 p-3 rounded-xl border border-slate-800 text-xs">
            {/* Scan Progress Bar */}
            <div className="flex-1 min-w-[240px] flex items-center gap-3">
              <span className="text-slate-400 font-medium whitespace-nowrap">
                {progress?.is_running ? 'Scan läuft...' : 'Bereit'}
              </span>
              <div className="flex-1 h-2 rounded-full bg-slate-950 overflow-hidden border border-slate-800">
                <div
                  className="h-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, progress?.percent ?? 0))}%` }}
                />
              </div>
              <span className="font-mono text-slate-300 w-12 text-right">
                {(progress?.percent ?? 0).toFixed(0)}%
              </span>
            </div>

            {/* Matrix Legend */}
            <div className="flex items-center gap-4 text-[11px] font-medium">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-emerald-500/25 border border-emerald-500" />
                <span className="text-emerald-300">Online auf Bus ({liveOccupiedCount})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-indigo-950/60 border border-indigo-500/70" />
                <span className="text-indigo-300">Im Projekt ({projectDevicesOnLine.length})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-sky-500/20 border border-sky-500/60" />
                <span className="text-sky-300">Gateway (1.1.252)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-slate-900 border border-slate-800" />
                <span className="text-slate-400">Frei ({Math.max(0, 255 - projectDevicesOnLine.length - (line === '1.1' ? 1 : 0))})</span>
              </div>
              {progress?.current_address && (
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-amber-500/30 border border-amber-500 animate-pulse" />
                  <span className="text-amber-300 font-mono">
                    Scanne {progress.current_address}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Interactive 16x16 / Grid Matrix */}
          <div className="flex-1 bg-slate-900/40 rounded-xl p-4 border border-slate-800/80">
            <div className="grid grid-cols-8 sm:grid-cols-12 md:grid-cols-16 lg:grid-cols-16 xl:grid-cols-16 gap-1.5">
              {Array.from({ length: 255 }, (_, i) => i + 1).map((devNum) => {
                const addrStr = `${line}.${devNum}`
                const info = resultsMap.get(addrStr)
                const projDev = projectDevicesMap.get(addrStr)
                const isSelected = selectedAddress === addrStr
                const isScanningThis = progress?.current_address === addrStr
                const isProg = (progModeDevices || []).some((d) => d && d.address === addrStr)
                const isGw = info?.status === 'Gateway' || addrStr === '1.1.252'
                const isOnline = info?.status === 'Occupied' && (info?.rtt_ms != null || info?.last_seen?.includes('Online'))
                const isProj = Boolean(projDev) || (info?.status === 'Occupied' && !isOnline)

                let cellBg = 'bg-slate-900/50 border-slate-800/50 text-slate-500 hover:border-slate-700'
                if (isProg) {
                  cellBg = 'bg-rose-500/30 border-rose-500 text-rose-200 animate-pulse font-bold'
                } else if (isScanningThis) {
                  cellBg = 'bg-amber-500/40 border-amber-400 text-amber-100 shadow-md shadow-amber-500/20'
                } else if (isGw) {
                  cellBg = 'bg-sky-500/20 border-sky-500/70 text-sky-300 font-bold hover:border-sky-400'
                } else if (isOnline) {
                  cellBg = 'bg-emerald-500/25 border-emerald-500 text-emerald-200 font-bold hover:border-emerald-400'
                } else if (isProj) {
                  cellBg = 'bg-indigo-950/60 border-indigo-500/70 text-indigo-300 font-semibold hover:border-indigo-400'
                }

                const displayName = projDev ? `${projDev.name} (${projDev.model})` : info?.device_name || (isGw ? 'KNX IP Interface' : '')
                const statusTooltip = isProg ? 'Im Programmiermodus' : isGw ? 'IP Interface / Gateway' : isOnline ? `Online (${info?.rtt_ms ? `${info.rtt_ms}ms` : 'Bus'})` : isProj ? 'Im Projekt projektiert' : 'Frei'

                return (
                  <button
                    key={devNum}
                    onClick={() => setSelectedAddress(addrStr)}
                    className={`aspect-square rounded flex flex-col items-center justify-center p-1 text-[11px] font-mono border transition-all cursor-pointer relative ${cellBg} ${
                      isSelected ? 'ring-2 ring-sky-400 scale-105 z-10' : ''
                    }`}
                    title={`${addrStr}: ${statusTooltip}${displayName ? ` — ${displayName}` : ''}`}
                  >
                    <span>{devNum}</span>
                    {isOnline && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50 mt-0.5" />
                    )}
                    {isGw && (
                      <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shadow-sm shadow-sky-400/50 mt-0.5" />
                    )}
                    {isProj && !isOnline && !isGw && (
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shadow-sm shadow-indigo-400/50 mt-0.5" />
                    )}
                    {isProg && (
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-ping mt-0.5" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Right: Detailed Device & Address Inspector */}
        <div className="w-96 border-l border-slate-800 bg-slate-900/70 p-6 flex flex-col gap-6 overflow-y-auto">
          <div>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
              Adress-Details
            </h2>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-black font-mono text-slate-100">
                {selectedAddress || 'Keine Adresse'}
              </span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                  selectedInfo?.status === 'Gateway' || selectedAddress === '1.1.252'
                    ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                    : deviceDetail?.reachable || (selectedInfo?.status === 'Occupied' && (selectedInfo?.rtt_ms != null || selectedInfo?.last_seen?.includes('Online')))
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : selectedProjDevice || selectedInfo?.status === 'Occupied'
                    ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}
              >
                {selectedInfo?.status === 'Gateway' || selectedAddress === '1.1.252'
                  ? 'IP Gateway'
                  : deviceDetail?.reachable || (selectedInfo?.status === 'Occupied' && (selectedInfo?.rtt_ms != null || selectedInfo?.last_seen?.includes('Online')))
                  ? 'Online auf Bus'
                  : selectedProjDevice || selectedInfo?.status === 'Occupied'
                  ? 'Im Projekt projektiert'
                  : 'Frei'}
              </span>
            </div>
          </div>

          {/* Quick Info Cards */}
          <div className="space-y-3">
            {/* Device Name Banner if in project */}
            {selectedProjDevice && (
              <div className="bg-indigo-950/40 p-3.5 rounded-xl border border-indigo-500/30">
                <div className="text-[11px] text-indigo-400 font-semibold mb-1 flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5" />
                  <span>Projektiertes KNX-Gerät</span>
                </div>
                <div className="text-sm font-bold text-slate-100">
                  {selectedProjDevice.name}
                </div>
                <div className="text-xs text-indigo-300/80 font-mono mt-0.5">
                  {selectedProjDevice.model}
                </div>
              </div>
            )}

            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
              <div className="text-[11px] text-slate-500 font-medium mb-1">
                Hersteller & Modell
              </div>
              <div className="text-xs font-semibold text-slate-200">
                {selectedProjDevice ? (
                  <span>
                    {selectedProjDevice.manufacturer} — <span className="font-mono text-slate-400">{selectedProjDevice.model}</span>
                  </span>
                ) : selectedInfo?.device_name ? (
                  selectedInfo.device_name
                ) : deviceDetail?.manufacturer ? (
                  deviceDetail.manufacturer
                ) : selectedInfo?.manufacturer ? (
                  selectedInfo.manufacturer
                ) : (
                  <span className="text-slate-500">Unbekannt / Unbelegt</span>
                )}
              </div>
            </div>

            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
              <div className="text-[11px] text-slate-500 font-medium mb-1">
                Maskenversion (Gerätedeskriptor)
              </div>
              <div className="text-xs font-mono font-semibold text-slate-200">
                {loadingDetail ? (
                  <span className="text-slate-500 flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Lese Gerätedeskriptor...
                  </span>
                ) : deviceDetail?.mask_version ? (
                  deviceDetail.mask_version
                ) : selectedInfo?.mask_version ? (
                  `${selectedInfo.mask_version} ${selectedInfo.mask_version_hex ? `(${selectedInfo.mask_version_hex})` : ''}`
                ) : selectedProjDevice ? (
                  <span className="text-slate-300">System B (07B0h) • Projektiert</span>
                ) : (
                  <span className="text-slate-500">Keine Antwort / Unbelegt</span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                <div className="text-[10px] text-slate-500 font-medium">Antwortzeit (RTT)</div>
                <div className="text-xs font-mono font-bold mt-0.5">
                  {loadingDetail ? (
                    <span className="text-slate-500 flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Messe...
                    </span>
                  ) : deviceDetail?.rtt_ms != null ? (
                    <span className="text-sky-400">{deviceDetail.rtt_ms} ms</span>
                  ) : selectedInfo?.rtt_ms != null ? (
                    <span className="text-sky-400">{selectedInfo.rtt_ms} ms</span>
                  ) : selectedProjDevice ? (
                    <span className="text-slate-500">Keine Antwort</span>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </div>
              </div>

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                <div className="text-[10px] text-slate-500 font-medium">Prog-Modus</div>
                <div className="text-xs font-bold mt-0.5">
                  {progModeDevices.some((d) => d.address === selectedAddress) ? (
                    <span className="text-rose-400 animate-pulse">Aktiv (LED an)</span>
                  ) : (
                    <span className="text-slate-400">Aus</span>
                  )}
                </div>
              </div>
            </div>

            {selectedProjDevice && (
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-slate-400">
                  <Network className="w-4 h-4 text-indigo-400" />
                  <span>Kommunikationsobjekte</span>
                </div>
                <span className="font-mono font-bold text-indigo-300">
                  {selectedProjDevice.communication_objects?.length ?? 0} KOs
                </span>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="space-y-2.5 pt-2 border-t border-slate-800">
            {onSwitchToCanvas && selectedProjDevice && (
              <button
                onClick={onSwitchToCanvas}
                className="w-full py-2 px-3 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/40 border border-indigo-500/40 text-indigo-200 text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Cpu className="w-3.5 h-3.5 text-indigo-400" />
                <span>Im Canvas-Editor anzeigen</span>
              </button>
            )}

            <button
              onClick={() => {
                if (selectedAddress) {
                  setProgramTargetAddress(selectedAddress)
                  setIsProgramModalOpen(true)
                }
              }}
              className="w-full py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 transition-all cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
              <span>Auf diese Adresse programmieren</span>
            </button>

            {/* Optical Locate / Blink Button */}
            <button
              onClick={handleLocateSelectedDevice}
              disabled={isLocating || !selectedAddress}
              className={`w-full py-2 px-3 rounded-lg border text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                isLocating
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 animate-pulse'
                  : 'bg-slate-800 hover:bg-slate-700 text-amber-300 border-amber-500/30 hover:border-amber-500/60'
              }`}
              title="Lässt die Programmier-LED des Geräts 5 Sekunden optisch blinken zur schnellen Lokalisierung im Schaltschrank"
            >
              <Eye className={`w-3.5 h-3.5 ${isLocating ? 'animate-bounce text-amber-400' : 'text-amber-400'}`} />
              <span>{isLocating ? 'Gerät blinkt...' : 'Gerät lokalisieren (LED blinken)'}</span>
            </button>
            {locateStatus && (
              <div className="text-[11px] text-center text-amber-300 font-medium py-1 px-2 rounded bg-amber-950/40 border border-amber-500/30">
                {locateStatus}
              </div>
            )}

            <button
              onClick={() => {
                if (selectedAddress) {
                  setLoadingDetail(true)
                  queryDeviceInfo(selectedAddress)
                    .then((det) => {
                      setDeviceDetail(det)
                      setLoadingDetail(false)
                      if (det && det.reachable) {
                        setScanResults((prev) => {
                          const list = Array.isArray(prev) ? prev : []
                          return list.map((item) => {
                            if (item.address === det.address) {
                              return {
                                ...item,
                                status: 'Occupied' as const,
                                mask_version: det.mask_version || item.mask_version,
                                rtt_ms: det.rtt_ms,
                                last_seen: `Online (${new Date().toLocaleTimeString()})`,
                              }
                            }
                            return item
                          })
                        })
                      }
                    })
                    .catch(() => setLoadingDetail(false))
                }
              }}
              disabled={loadingDetail}
              className="w-full py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${loadingDetail ? 'animate-spin' : ''}`} />
              <span>Geräte-Info erneut abfragen</span>
            </button>
          </div>

          {/* Info Hint */}
          <div className="mt-auto bg-sky-950/30 p-3 rounded-xl border border-sky-500/20 text-[11px] text-sky-300/80 leading-relaxed flex items-start gap-2">
            <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
            <span>
              <strong>Tipp:</strong> Drücken Sie die Programmiertaste an einem KNX-Aktor (LED leuchtet rot), um ihn mit "Prog-Taste suchen" sofort zu lokalisieren und eine neue physikalische Adresse zu vergeben.
            </span>
          </div>
        </div>
      </div>

      {/* Program Address Modal */}
      {isProgramModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-5 animate-scaleUp">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-100">
                    Physikalische Adresse programmieren
                  </h3>
                  <p className="text-xs text-slate-400">
                    Schreibt Adresse via KNX cEMI ins Gerät
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsProgramModalOpen(false)
                  setProgramResult(null)
                }}
                className="text-slate-400 hover:text-slate-200 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Programming Method Switcher */}
            <div className="flex rounded-lg bg-slate-950 p-1 border border-slate-800 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setProgramTab('button')}
                className={`flex-1 py-1.5 rounded-md flex items-center justify-center gap-1.5 transition-all ${
                  programTab === 'button'
                    ? 'bg-slate-800 text-slate-100 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Radio className="w-3.5 h-3.5 text-amber-400" />
                <span>Programmiertaste (LED)</span>
              </button>
              <button
                type="button"
                onClick={() => setProgramTab('serial')}
                className={`flex-1 py-1.5 rounded-md flex items-center justify-center gap-1.5 transition-all ${
                  programTab === 'serial'
                    ? 'bg-slate-800 text-slate-100 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Hash className="w-3.5 h-3.5 text-sky-400" />
                <span>Per Seriennummer</span>
              </button>
            </div>

            <div className="space-y-4">
              {programTab === 'button' ? (
                /* STEP 1: Program Mode Detection (ETS Parity) */
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                    <span className="flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center text-[10px] font-bold">1</span>
                      <span>Programmiermodus am Gerät</span>
                    </span>
                    <button
                      type="button"
                      onClick={handleScanProgMode}
                      disabled={isScanningProgMode}
                      className="text-[11px] text-sky-400 hover:text-sky-300 flex items-center gap-1 transition-colors"
                    >
                      <RotateCcw className={`w-3 h-3 ${isScanningProgMode ? 'animate-spin' : ''}`} />
                      <span>Erneut suchen</span>
                    </button>
                  </div>

                  {isScanningProgMode ? (
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center gap-2.5 text-xs text-slate-400">
                      <Loader2 className="w-4 h-4 text-sky-400 animate-spin shrink-0" />
                      <span>Scanne KNX-Bus nach Geräten im Programmiermodus...</span>
                    </div>
                  ) : progModeDevices.length === 1 ? (
                    <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
                        <div>
                          <div className="font-bold text-emerald-200">
                            Gerät im Programmiermodus erkannt!
                          </div>
                          <div className="text-[11px] font-mono text-emerald-300/80 mt-0.5">
                            Alte Adresse: <span className="font-bold text-white">{progModeDevices[0].address}</span>
                            {progModeDevices[0].mask_version && ` · ${progModeDevices[0].mask_version}`}
                          </div>
                        </div>
                      </div>
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    </div>
                  ) : progModeDevices.length > 1 ? (
                    <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/40 flex items-start gap-2.5 text-xs text-rose-200">
                      <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-bold">Mehrere Geräte im Programmiermodus ({progModeDevices.length})!</div>
                        <div className="text-[11px] text-rose-300/80 mt-0.5">
                          Gefunden: {progModeDevices.map((d) => d.address).join(', ')}. Bitte stellen Sie sicher, dass nur an genau einem Gerät die rote Taste aktiv ist.
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/30 flex items-start gap-2.5 text-xs text-amber-200">
                      <div className="w-3.5 h-3.5 rounded-full bg-rose-500/80 shrink-0 mt-0.5 animate-pulse" />
                      <div>
                        <div className="font-bold">Warten auf Tastendruck am Gerät</div>
                        <div className="text-[11px] text-amber-300/80 mt-0.5">
                          Drücken Sie die Programmiertaste am KNX-Gerät (rote LED muss leuchten), und klicken Sie anschließend auf „Erneut suchen“.
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* Hardware Wizard: KNX 6-Byte Serial Number Input */
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-sky-500/20 text-sky-400 border border-sky-500/40 flex items-center justify-center text-[10px] font-bold">1</span>
                    <span>Geräte-Seriennummer (6 Bytes)</span>
                  </div>
                  <input
                    type="text"
                    value={programSerialNumber}
                    onChange={(e) => setProgramSerialNumber(e.target.value)}
                    placeholder="00:83:7B:40:02:85 oder 00837B400285"
                    className="w-full bg-slate-950 border border-slate-800 focus:border-sky-500 rounded-lg px-3 py-2 text-sm font-mono text-slate-100 focus:outline-none transition-colors"
                  />
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Programmierung ohne Tastendruck via Broadcast <code>A_IndividualAddress_SerialNumber_Write</code> nach KNX-Spezifikation.
                  </p>
                </div>
              )}

              {/* STEP 2: Target Address & Collision Check */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center text-[10px] font-bold">2</span>
                  <span>Neue physikalische Ziel-Adresse</span>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    value={programTargetAddress}
                    onChange={(e) => setProgramTargetAddress(e.target.value)}
                    placeholder="1.1.10"
                    className={`w-full bg-slate-950 border rounded-lg px-3 py-2 text-sm font-mono text-slate-100 focus:outline-none transition-colors ${
                      isTargetAddressOccupied
                        ? 'border-amber-500/80 focus:border-amber-400'
                        : 'border-slate-800 focus:border-emerald-500'
                    }`}
                  />
                  {isTargetAddressOccupied && (
                    <div className="mt-1.5 p-2 rounded-lg bg-amber-950/40 border border-amber-500/40 flex items-center gap-2 text-[11px] text-amber-300">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span>
                        Achtung: Die Adresse <strong>{programTargetAddress}</strong> ist auf dem Bus laut Scan bereits belegt!
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* STEP 3: Project Device Association */}
              {project && project.devices.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center text-[10px] font-bold">3</span>
                    <span>Projekt-Gerät zuweisen (optional)</span>
                  </label>
                  <select
                    value={programSelectedDeviceId}
                    onChange={(e) => setProgramSelectedDeviceId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 cursor-pointer"
                  >
                    <option value="">— Kein Projekt-Gerät verknüpfen —</option>
                    {project.devices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.individual_address} • {d.name} ({d.model})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* STEP 4: Execution & Feedback */}
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-[11px] text-slate-400 space-y-1.5">
                <div className="font-semibold text-slate-300 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                  <span>Ablauf nach ETS-Standard:</span>
                </div>
                <div className="text-slate-400 space-y-1">
                  <div>1. Broadcast-Schreiben ({programTab === 'serial' ? 'A_IndividualAddress_SerialNumber_Write' : 'A_IndividualAddress_Write'}).</div>
                  <div>2. Geräteneustart (<code>A_Restart</code>), rote LED erlischt automatisch.</div>
                  <div>3. Lese-Verifikation via Gerätedeskriptor (<code>A_DeviceDescriptor_Read</code>).</div>
                </div>
              </div>

              {programResult && (
                <div
                  className={`p-3 rounded-xl border text-xs leading-relaxed flex items-start gap-2 ${
                    programResult.success
                      ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                      : 'bg-rose-950/40 border-rose-500/40 text-rose-200'
                  }`}
                >
                  {programResult.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  )}
                  <span>{programResult.message}</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setIsProgramModalOpen(false)
                  setProgramResult(null)
                }}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors cursor-pointer"
              >
                Schließen
              </button>
              <button
                type="button"
                onClick={programTab === 'serial' ? handleExecuteProgramBySerial : handleExecuteProgramAddress}
                disabled={isProgramming || (programTab === 'button' && progModeDevices.length > 1)}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition-all cursor-pointer"
              >
                {isProgramming ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Warte auf Gerät & programmiere...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Adresse jetzt schreiben</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
