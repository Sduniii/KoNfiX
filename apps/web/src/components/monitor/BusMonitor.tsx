import React, { useState, useEffect, useRef } from 'react'
import {
  Activity,
  Trash2,
  Pause,
  Play,
  ChevronUp,
  ChevronDown,
  Search,
  Radio,
  Send,
  Sliders,
  Check,
  Tag,
  BarChart3,
  Filter,
  Download,
  Upload,
  Circle,
  Clock,
  Zap,
} from 'lucide-react'
import { KnxTelegram, Project, BusStatistics, TelegramFilter } from '../../types/knx'
import {
  sendKnxTelegram,
  fetchBusStatistics,
  startBusRecorder,
  stopBusRecorder,
  pauseBusRecorder,
  clearBusRecorder,
  getBusExportUrl,
  importBusTelegrams,
} from '../../services/api'
import { lookupDpt } from '../../utils/dptRegistry'
import { useTranslation } from '../../i18n/I18nContext'

interface BusMonitorProps {
  telegrams: KnxTelegram[]
  isConnected: boolean
  isPaused: boolean
  onClear: () => void
  onTogglePause: () => void
  project?: Project | null
}

export const BusMonitor: React.FC<BusMonitorProps> = ({
  telegrams,
  isConnected,
  isPaused,
  onClear,
  onTogglePause,
  project,
}) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(true)
  const [filterText, setFilterText] = useState('')
  const [showSender, setShowSender] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [showFilterMatrix, setShowFilterMatrix] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)

  // Filter matrix states
  const [sourceFilter, setSourceFilter] = useState('')
  const [destFilter, setDestFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('ALL')
  const [dptFilter, setDptFilter] = useState('ALL')

  // Recording status & statistics
  const [isRecording, setIsRecording] = useState(true)
  const [busStats, setBusStats] = useState<BusStatistics | null>(null)
  const [importStatus, setImportStatus] = useState<string | null>(null)

  // Send telegram form states
  const [sendGa, setSendGa] = useState('')
  const [sendDpt, setSendDpt] = useState('1.001')
  const [sendValBool, setSendValBool] = useState<boolean>(true)
  const [sendValPercent, setSendValPercent] = useState<number>(100)
  const [sendValFloat, setSendValFloat] = useState<number>(21.5)
  const [sendValNum, setSendValNum] = useState<number>(30)
  const [sending, setSending] = useState(false)
  const [sendSuccess, setSendSuccess] = useState(false)

  // Polling for live bus statistics
  useEffect(() => {
    let isMounted = true
    const interval = setInterval(async () => {
      if (isOpen) {
        try {
          const stats = await fetchBusStatistics()
          if (isMounted) setBusStats(stats)
        } catch {
          // ignore error if backend not yet running
        }
      }
    }, 2000)

    return () => {
      isMounted = false
      clearInterval(interval)
    }
  }, [isOpen])

  // Helper to find GA info from project
  const getGaInfo = (address: string) => {
    return project?.group_addresses?.find((g) => g.address === address)
  }

  // Auto-fill DPT when GA is selected from project
  const handleSelectGa = (addr: string) => {
    setSendGa(addr)
    const info = getGaInfo(addr)
    if (info) {
      setSendDpt(info.dpt || '1.001')
    }
  }

  const handleSend = async (customVal?: any) => {
    if (!sendGa.trim()) return
    setSending(true)
    setSendSuccess(false)

    try {
      let finalVal: any
      if (customVal !== undefined) {
        finalVal = customVal
      } else if (sendDpt.startsWith('1.')) {
        finalVal = sendValBool
      } else if (sendDpt.startsWith('5.')) {
        finalVal = sendValPercent
      } else if (sendDpt.startsWith('7.') || sendDpt.startsWith('8.') || sendDpt.startsWith('12.') || sendDpt.startsWith('13.') || sendDpt.startsWith('17.') || sendDpt.startsWith('18.')) {
        finalVal = sendValNum
      } else if (sendDpt.startsWith('9.')) {
        finalVal = sendValFloat
      } else {
        finalVal = sendValBool
      }

      await sendKnxTelegram(sendGa.trim(), sendDpt, finalVal)
      setSendSuccess(true)
      setTimeout(() => setSendSuccess(false), 1500)
    } catch (err) {
      console.error('Send error:', err)
    } finally {
      setSending(false)
    }
  }

  const toggleRecording = async () => {
    try {
      if (isRecording) {
        await stopBusRecorder()
        setIsRecording(false)
      } else {
        await startBusRecorder()
        setIsRecording(true)
      }
    } catch (err) {
      console.error('Toggle recording error:', err)
    }
  }

  const handleClearAll = async () => {
    onClear()
    try {
      await clearBusRecorder()
    } catch (err) {
      console.error('Clear recorder error:', err)
    }
  }

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const res = await importBusTelegrams(text)
      setImportStatus(res.message)
      setTimeout(() => setImportStatus(null), 3500)
    } catch (err: any) {
      setImportStatus(`Fehler: ${err.message}`)
      setTimeout(() => setImportStatus(null), 4000)
    }
  }

  const filteredTelegrams = (telegrams || []).filter((t) => {
    if (!t || typeof t !== 'object' || !t.destination) return false

    // Filter matrix checks
    if (sourceFilter) {
      const s = sourceFilter.toLowerCase()
      if (s.endsWith('*')) {
        if (!t.source.toLowerCase().startsWith(s.slice(0, -1))) return false
      } else if (!t.source.toLowerCase().includes(s)) {
        return false
      }
    }

    if (destFilter) {
      const d = destFilter.toLowerCase()
      if (d.endsWith('*')) {
        if (!t.destination.toLowerCase().startsWith(d.slice(0, -1))) return false
      } else if (!t.destination.toLowerCase().includes(d)) {
        return false
      }
    }

    if (typeFilter !== 'ALL') {
      if (!t.telegram_type.toLowerCase().includes(typeFilter.toLowerCase())) return false
    }

    if (dptFilter !== 'ALL') {
      if (!t.dpt.startsWith(dptFilter)) return false
    }

    // Quick text filter
    if (filterText) {
      const q = filterText.toLowerCase()
      const info = getGaInfo(t.destination)
      const dest = (t.destination || '').toLowerCase()
      const src = (t.source || '').toLowerCase()
      const val = (t.value_formatted || '').toLowerCase()
      const dpt = (t.dpt || '').toLowerCase()
      const name = (info?.name || '').toLowerCase()
      const desc = (info?.description || '').toLowerCase()
      return (
        dest.includes(q) ||
        src.includes(q) ||
        val.includes(q) ||
        dpt.includes(q) ||
        name.includes(q) ||
        desc.includes(q)
      )
    }

    return true
  })

  // Tag color by trade
  const getTradeBadgeColor = (desc: string) => {
    const lower = desc.toLowerCase()
    if (lower.includes('rollo') || lower.includes('jalousie')) {
      return 'bg-amber-500/10 text-amber-400 border-amber-500/20'
    } else if (lower.includes('licht') || lower.includes('dimm')) {
      return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
    } else if (lower.includes('heizung') || lower.includes('klima') || lower.includes('stellwert')) {
      return 'bg-rose-500/10 text-rose-400 border-rose-500/20'
    } else if (lower.includes('zentral') || lower.includes('wetter') || lower.includes('umwelt')) {
      return 'bg-sky-500/10 text-sky-400 border-sky-500/20'
    }
    return 'bg-slate-800 text-slate-400 border-slate-700'
  }

  const loadPercent = busStats?.bus_load_percent ?? 0
  const tlgSec = busStats?.telegrams_per_sec ?? 0

  return (
    <div
      className={`border-t border-slate-800 bg-slate-900/95 flex flex-col shrink-0 transition-all z-20 ${
        isOpen
          ? showStats
            ? 'h-96'
            : showSender || showFilterMatrix
            ? 'h-72'
            : 'h-60'
          : 'h-9'
      }`}
    >
      {/* Header bar */}
      <div className="h-9 border-b border-slate-800 px-4 flex items-center justify-between select-none bg-slate-950/60">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:text-white"
          >
            {isOpen ? (
              <ChevronDown className="w-4 h-4 text-slate-500" />
            ) : (
              <ChevronUp className="w-4 h-4 text-slate-500" />
            )}
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
            <span>{t('monitor.title')}</span>
            <span className="text-[10px] font-mono bg-slate-800 px-1.5 py-0.2 rounded text-slate-400">
              {filteredTelegrams.length} / {telegrams.length}
            </span>
          </button>

          {/* Recording Status Dot */}
          <button
            onClick={toggleRecording}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
              isRecording
                ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                : 'bg-slate-800 text-slate-500 hover:text-slate-300'
            }`}
            title={isRecording ? 'Aufzeichnung stoppen' : 'Aufzeichnung starten'}
          >
            <Circle className={`w-2 h-2 ${isRecording ? 'fill-rose-500 text-rose-500 animate-pulse' : 'text-slate-500'}`} />
            <span>{isRecording ? 'REC' : 'STOP'}</span>
          </button>

          {/* Live Bus Load Gauge */}
          <div
            className="hidden sm:flex items-center gap-2 px-2 py-0.5 rounded bg-slate-900 border border-slate-800"
            title="Berechnete KNX TP1-Buslast (9.600 Baud inklusive Frame-Pausen)"
          >
            <div className="w-12 h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  loadPercent > 50
                    ? 'bg-rose-500'
                    : loadPercent > 20
                    ? 'bg-amber-400'
                    : 'bg-emerald-400'
                }`}
                style={{ width: `${Math.min(100, Math.max(4, loadPercent))}%` }}
              />
            </div>
            <span className="text-[10px] font-mono text-slate-300 font-semibold">{loadPercent}% Buslast</span>
            <span className="text-slate-600">•</span>
            <span className="text-[10px] font-mono text-slate-400">{tlgSec} Tlg/s</span>
          </div>

          {isConnected ? (
            <div className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-mono">
              <Radio className="w-3 h-3 animate-pulse" />
              <span>{t('monitor.liveBusActive')}</span>
            </div>
          ) : (
            <div className="text-[10px] text-slate-500 font-mono">
              <span>Simulator</span>
            </div>
          )}

          {importStatus && (
            <span className="text-[10px] text-sky-400 font-sans px-2 py-0.5 rounded bg-sky-500/10 border border-sky-500/20 animate-fade-in">
              {importStatus}
            </span>
          )}
        </div>

        {isOpen && (
          <div className="flex items-center gap-1.5">
            {/* Stats HUD toggle */}
            <button
              onClick={() => setShowStats(!showStats)}
              className={`px-2 py-1 rounded text-xs flex items-center gap-1 transition-colors ${
                showStats
                  ? 'bg-emerald-600 text-white font-medium'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
              }`}
              title="Bus-Statistik & Analyse öffnen"
            >
              <BarChart3 className="w-3 h-3" />
              <span className="text-[10px]">Statistik</span>
            </button>

            {/* Filter Matrix toggle */}
            <button
              onClick={() => setShowFilterMatrix(!showFilterMatrix)}
              className={`px-2 py-1 rounded text-xs flex items-center gap-1 transition-colors ${
                showFilterMatrix || sourceFilter || destFilter || typeFilter !== 'ALL' || dptFilter !== 'ALL'
                  ? 'bg-indigo-600 text-white font-medium'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
              }`}
              title="Filtermatrix öffnen"
            >
              <Filter className="w-3 h-3" />
              <span className="text-[10px]">Filter</span>
            </button>

            {/* Sender toggle button */}
            <button
              onClick={() => setShowSender(!showSender)}
              className={`px-2 py-1 rounded text-xs flex items-center gap-1 transition-colors ${
                showSender
                  ? 'bg-sky-600 text-white font-medium'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
              }`}
              title={t('monitor.sendTelegram')}
            >
              <Send className="w-3 h-3" />
              <span className="text-[10px]">{t('monitor.sendTelegram')}</span>
            </button>

            {/* Filter Input */}
            <div className="relative">
              <Search className="w-3 h-3 text-slate-500 absolute left-2 top-2" />
              <input
                type="text"
                placeholder={t('monitor.filterPlaceholder')}
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-md pl-6 pr-2 py-0.5 text-xs text-slate-200 placeholder-slate-500 w-36 focus:w-48 transition-all"
              />
            </div>

            {/* Export Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors flex items-center gap-1"
                title="Telegramme exportieren"
              >
                <Download className="w-3 h-3" />
              </button>

              {showExportMenu && (
                <div className="absolute right-0 top-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl py-1 z-30 w-44 text-xs font-sans">
                  <a
                    href={getBusExportUrl('csv')}
                    download="busmonitor_export.csv"
                    onClick={() => setShowExportMenu(false)}
                    className="block px-3 py-1.5 hover:bg-slate-700 text-slate-200"
                  >
                    ETS CSV exportieren
                  </a>
                  <a
                    href={getBusExportUrl('xml')}
                    download="busmonitor_export.xml"
                    onClick={() => setShowExportMenu(false)}
                    className="block px-3 py-1.5 hover:bg-slate-700 text-slate-200"
                  >
                    ETS XML exportieren
                  </a>
                </div>
              )}
            </div>

            {/* Import Log */}
            <label
              className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer transition-colors"
              title="ETS-Logdatei (CSV/XML) importieren"
            >
              <Upload className="w-3 h-3" />
              <input type="file" accept=".csv,.xml,.txt" onChange={handleImportFile} className="hidden" />
            </label>

            {/* Pause / Resume */}
            <button
              onClick={onTogglePause}
              className={`px-2 py-1 rounded text-xs flex items-center gap-1 transition-colors ${
                isPaused
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
              }`}
              title={isPaused ? t('monitor.resume') : t('monitor.pause')}
            >
              {isPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
              <span className="text-[10px]">{isPaused ? t('monitor.paused') : t('monitor.pause')}</span>
            </button>

            {/* Clear button */}
            <button
              onClick={handleClearAll}
              className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
              title={t('monitor.clearLog')}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Filter Matrix Toolbar */}
      {isOpen && showFilterMatrix && (
        <div className="px-4 py-2 bg-slate-950/90 border-b border-slate-800 flex items-center gap-3 flex-wrap text-xs">
          <div className="flex items-center gap-1 text-slate-400">
            <Filter className="w-3.5 h-3.5 text-indigo-400" />
            <span className="font-semibold text-slate-200">Filtermatrix:</span>
          </div>

          <input
            type="text"
            placeholder="Quelle z.B. 1.1.*"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-xs text-sky-400 font-mono w-28 focus:outline-none focus:border-indigo-500"
          />

          <input
            type="text"
            placeholder="Ziel z.B. 2/0/*"
            value={destFilter}
            onChange={(e) => setDestFilter(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-xs text-emerald-400 font-mono w-28 focus:outline-none focus:border-indigo-500"
          />

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="ALL">Alle Dienste</option>
            <option value="Write">Write (Schreiben)</option>
            <option value="Read">Read (Lesen)</option>
            <option value="Response">Response (Antwort)</option>
          </select>

          <select
            value={dptFilter}
            onChange={(e) => setDptFilter(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="ALL">Alle DPTs</option>
            <option value="1.">DPT 1.* (1 Bit / Schalten)</option>
            <option value="5.">DPT 5.* (1 Byte / Prozent)</option>
            <option value="9.">DPT 9.* (2 Byte / Temperatur/Sensor)</option>
          </select>

          {(sourceFilter || destFilter || typeFilter !== 'ALL' || dptFilter !== 'ALL') && (
            <button
              onClick={() => {
                setSourceFilter('')
                setDestFilter('')
                setTypeFilter('ALL')
                setDptFilter('ALL')
              }}
              className="text-[11px] text-indigo-400 hover:text-indigo-300 underline ml-2"
            >
              Filter zurücksetzen
            </button>
          )}
        </div>
      )}

      {/* Statistics HUD Bar */}
      {isOpen && showStats && busStats && (
        <div className="px-4 py-3 bg-slate-950/95 border-b border-slate-800 text-xs shrink-0 grid grid-cols-2 md:grid-cols-4 gap-4 animate-in fade-in">
          {/* Box 1: Counts & Load */}
          <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">Telegramme & Rate</span>
            <div className="flex items-baseline gap-2">
              <span className="text-base font-bold text-slate-100">{busStats.total_telegrams}</span>
              <span className="text-[11px] text-slate-400">gesamt ({busStats.telegrams_per_sec} Tlg/s)</span>
            </div>
            <div className="mt-2 text-[10px] text-slate-400 flex items-center justify-between">
              <span>Buslast:</span>
              <span className={`font-mono font-bold ${loadPercent > 50 ? 'text-rose-400' : 'text-emerald-400'}`}>
                {busStats.bus_load_percent}%
              </span>
            </div>
          </div>

          {/* Box 2: Services */}
          <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">Dienste</span>
            <div className="space-y-1 text-[11px]">
              <div className="flex justify-between">
                <span className="text-slate-400">Write:</span>
                <span className="font-mono text-emerald-400 font-semibold">{busStats.write_count}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Read:</span>
                <span className="font-mono text-sky-400 font-semibold">{busStats.read_count}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Response:</span>
                <span className="font-mono text-indigo-400 font-semibold">{busStats.response_count}</span>
              </div>
            </div>
          </div>

          {/* Box 3: Top Senders */}
          <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">Top Sender (IA)</span>
            <div className="space-y-1 text-[11px] font-mono">
              {busStats.top_senders.length === 0 ? (
                <span className="text-slate-600 italic">Keine Daten</span>
              ) : (
                busStats.top_senders.slice(0, 3).map(([ia, count]) => (
                  <div key={ia} className="flex justify-between">
                    <span className="text-sky-400 font-semibold">{ia}</span>
                    <span className="text-slate-400">{count}x</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Box 4: Top GAs */}
          <div className="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">Top Zieladressen (GA)</span>
            <div className="space-y-1 text-[11px] font-mono">
              {busStats.top_destinations.length === 0 ? (
                <span className="text-slate-600 italic">Keine Daten</span>
              ) : (
                busStats.top_destinations.slice(0, 3).map(([ga, count]) => (
                  <div key={ga} className="flex justify-between">
                    <span className="text-emerald-400 font-semibold">{ga}</span>
                    <span className="text-slate-400">{count}x</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Interactive Telegram Sender Toolbar */}
      {isOpen && showSender && (
        <div className="px-4 py-2 bg-slate-950/90 border-b border-slate-800 flex items-center gap-3 flex-wrap text-xs">
          <div className="flex items-center gap-1 text-slate-400">
            <Sliders className="w-3.5 h-3.5 text-sky-400" />
            <span className="font-semibold text-slate-200">Befehl senden:</span>
          </div>

          {/* GA Input / Dropdown */}
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              placeholder="GA z.B. 1/0/0"
              value={sendGa}
              onChange={(e) => handleSelectGa(e.target.value)}
              list="ga-suggestions"
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-emerald-400 font-mono w-28 focus:outline-none focus:border-sky-500"
            />
            <datalist id="ga-suggestions">
              {project?.group_addresses?.slice(0, 150).map((g) => (
                <option key={g.id} value={g.address}>
                  {g.name} ({g.description})
                </option>
              ))}
            </datalist>
          </div>

          {/* DPT Selector */}
          <select
            value={sendDpt}
            onChange={(e) => setSendDpt(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
          >
            <option value="1.001">DPT 1.001 (Schalten Ein/Aus)</option>
            <option value="1.008">DPT 1.008 (Auf/Ab Jalousie)</option>
            <option value="1.010">DPT 1.010 (Stop/Schritt)</option>
            <option value="5.001">DPT 5.001 (Prozent 0-100%)</option>
            <option value="9.001">DPT 9.001 (Temperatur °C)</option>
            <option value="7.001">DPT 7.001 (2-Byte Unsigned)</option>
          </select>

          {/* Interactive Value Inputs */}
          {sendDpt.startsWith('1.') && sendDpt !== '1.008' && sendDpt !== '1.010' && (
            <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded border border-slate-700">
              <button
                type="button"
                onClick={() => setSendValBool(true)}
                className={`px-2 py-0.5 rounded text-xs transition-colors ${
                  sendValBool ? 'bg-emerald-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Ein (1)
              </button>
              <button
                type="button"
                onClick={() => setSendValBool(false)}
                className={`px-2 py-0.5 rounded text-xs transition-colors ${
                  !sendValBool ? 'bg-rose-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Aus (0)
              </button>
            </div>
          )}

          {sendDpt === '1.008' && (
            <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded border border-slate-700">
              <button
                type="button"
                onClick={() => handleSend(false)}
                disabled={sending}
                className="px-2 py-0.5 rounded text-xs bg-sky-700 hover:bg-sky-600 text-white font-semibold"
              >
                Auf (0)
              </button>
              <button
                type="button"
                onClick={() => handleSend(true)}
                disabled={sending}
                className="px-2 py-0.5 rounded text-xs bg-indigo-700 hover:bg-indigo-600 text-white font-semibold"
              >
                Ab (1)
              </button>
            </div>
          )}

          {sendDpt === '1.010' && (
            <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded border border-slate-700">
              <button
                type="button"
                onClick={() => handleSend(false)}
                disabled={sending}
                className="px-2 py-0.5 rounded text-xs bg-amber-700 hover:bg-amber-600 text-white font-semibold"
              >
                Stop (0)
              </button>
              <button
                type="button"
                onClick={() => handleSend(true)}
                disabled={sending}
                className="px-2 py-0.5 rounded text-xs bg-amber-700 hover:bg-amber-600 text-white font-semibold"
              >
                Schritt (1)
              </button>
            </div>
          )}

          {sendDpt === '5.001' && (
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0"
                max="100"
                value={sendValPercent}
                onChange={(e) => setSendValPercent(Number(e.target.value))}
                className="w-24 accent-sky-400"
              />
              <span className="font-mono text-xs text-sky-400 w-10">{sendValPercent}%</span>
            </div>
          )}

          {sendDpt.startsWith('9.') && (
            <div className="flex items-center gap-1">
              <input
                type="number"
                step="0.5"
                value={sendValFloat}
                onChange={(e) => setSendValFloat(Number(e.target.value))}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-sky-400 font-mono w-16 focus:outline-none focus:border-sky-500"
              />
              <span className="text-slate-400 text-xs">°C</span>
            </div>
          )}

          {/* Send Action */}
          {sendDpt !== '1.008' && sendDpt !== '1.010' && (
            <button
              onClick={() => handleSend()}
              disabled={sending || !sendGa.trim()}
              className="px-3 py-1 rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold flex items-center gap-1.5 transition-colors"
            >
              {sendSuccess ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Send className="w-3 h-3" />}
              <span>{sendSuccess ? 'Gesendet!' : 'Senden'}</span>
            </button>
          )}

          {/* GA Name hint */}
          {getGaInfo(sendGa) && (
            <span className="text-[11px] text-slate-400 truncate max-w-xs">
              → {getGaInfo(sendGa)?.name}
            </span>
          )}
        </div>
      )}

      {/* Telegrams Table */}
      {isOpen && (
        <div className="flex-1 overflow-y-auto font-mono text-xs">
          {filteredTelegrams.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-500 text-xs font-sans">
              {t('monitor.emptyLogMessage')}
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-950/80 sticky top-0 text-[10px] text-slate-400 border-b border-slate-800 uppercase tracking-wider">
                <tr>
                  <th className="py-1.5 px-3">{t('monitor.timeCol')}</th>
                  <th className="py-1.5 px-3">{t('monitor.sourceCol')}</th>
                  <th className="py-1.5 px-3">{t('monitor.destCol')}</th>
                  <th className="py-1.5 px-3">{t('monitor.assignedNameCol')}</th>
                  <th className="py-1.5 px-3">{t('monitor.dptCol')}</th>
                  <th className="py-1.5 px-3">{t('monitor.typeCol')}</th>
                  <th className="py-1.5 px-3 text-right">{t('monitor.valueCol')}</th>
                  <th className="py-1.5 px-3 text-center">{t('monitor.testCol')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {filteredTelegrams.map((t) => {
                  const gaInfo = getGaInfo(t.destination)
                  return (
                    <tr
                      key={t.id}
                      className="hover:bg-slate-800/40 transition-colors text-[11px]"
                    >
                      <td className="py-1 px-3 text-slate-400 whitespace-nowrap">
                        {t.timestamp}
                      </td>
                      <td className="py-1 px-3 text-sky-400 font-bold whitespace-nowrap">
                        {t.source}
                      </td>
                      <td className="py-1 px-3 text-emerald-400 font-bold whitespace-nowrap">
                        {t.destination}
                      </td>
                      <td className="py-1 px-3 whitespace-nowrap">
                        {gaInfo ? (
                          <div className="flex items-center gap-1.5">
                            <span className="font-sans text-slate-200 font-medium text-[11px]">
                              {gaInfo.name}
                            </span>
                            {gaInfo.description && (
                              <span
                                className={`text-[10px] font-sans px-1.5 py-0.2 rounded border ${getTradeBadgeColor(
                                  gaInfo.description
                                )}`}
                              >
                                {gaInfo.description}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-600 text-[10px] italic">Unbekannt</span>
                        )}
                      </td>
                      <td className="py-1 px-3 text-slate-300 whitespace-nowrap">
                        {(() => {
                          const meta = lookupDpt(t.dpt)
                          return (
                            <span
                              className="font-mono text-[11px] text-sky-400 hover:text-sky-300 cursor-help"
                              title={meta ? `${meta.name}: ${meta.descriptionDe} (${meta.format}${meta.unit ? `, ${meta.unit}` : ''})` : `DPT ${t.dpt}`}
                            >
                              {meta ? meta.dpt : t.dpt}
                            </span>
                          )
                        })()}
                      </td>
                      <td className="py-1 px-3 text-slate-400 whitespace-nowrap">
                        <span className="bg-slate-800 px-1 py-0.2 rounded text-[10px]">
                          {t.telegram_type}
                        </span>
                      </td>
                      <td className="py-1 px-3 text-right text-slate-100 font-semibold whitespace-nowrap">
                        {t.value_formatted}
                      </td>
                      <td className="py-1 px-3 text-center whitespace-nowrap">
                        <button
                          onClick={() => {
                            setShowSender(true)
                            handleSelectGa(t.destination)
                          }}
                          className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-sky-400 hover:text-sky-300 text-[10px] font-sans flex items-center gap-1 mx-auto"
                          title="GA in Sender übernehmen"
                        >
                          <Tag className="w-2.5 h-2.5" />
                          <span>Wählen</span>
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
