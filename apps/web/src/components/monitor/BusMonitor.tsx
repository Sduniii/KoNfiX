import React, { useState } from 'react'
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
} from 'lucide-react'
import { KnxTelegram, Project } from '../../types/knx'
import { sendKnxTelegram } from '../../services/api'
import { lookupDpt } from '../../utils/dptRegistry'

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
  const [isOpen, setIsOpen] = useState(true)
  const [filterText, setFilterText] = useState('')
  const [showSender, setShowSender] = useState(false)

  // Send telegram form states
  const [sendGa, setSendGa] = useState('')
  const [sendDpt, setSendDpt] = useState('1.001')
  const [sendValBool, setSendValBool] = useState<boolean>(true)
  const [sendValPercent, setSendValPercent] = useState<number>(100)
  const [sendValFloat, setSendValFloat] = useState<number>(21.5)
  const [sendValNum, setSendValNum] = useState<number>(30)
  const [sending, setSending] = useState(false)
  const [sendSuccess, setSendSuccess] = useState(false)

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

  const filteredTelegrams = (telegrams || []).filter((t) => {
    if (!t || typeof t !== 'object' || !t.destination) return false
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

  return (
    <div
      className={`border-t border-slate-800 bg-slate-900/95 flex flex-col shrink-0 transition-all z-20 ${
        isOpen ? (showSender ? 'h-72' : 'h-60') : 'h-9'
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
            <span>KNX Busmonitor (Live)</span>
            <span className="text-[10px] font-mono bg-slate-800 px-1.5 py-0.2 rounded text-slate-400">
              {telegrams.length} Telegramme
            </span>
          </button>

          {isConnected ? (
            <div className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-mono">
              <Radio className="w-3 h-3 animate-pulse" />
              <span>Live-Bus aktiv</span>
            </div>
          ) : (
            <div className="text-[10px] text-slate-500 font-mono">
              <span>Simulator</span>
            </div>
          )}
        </div>

        {isOpen && (
          <div className="flex items-center gap-2">
            {/* Sender toggle button */}
            <button
              onClick={() => setShowSender(!showSender)}
              className={`px-2 py-1 rounded text-xs flex items-center gap-1 transition-colors ${
                showSender
                  ? 'bg-sky-600 text-white font-medium'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
              }`}
              title="Test-Telegramm senden"
            >
              <Send className="w-3 h-3" />
              <span className="text-[10px]">Telegramm senden</span>
            </button>

            {/* Filter Input */}
            <div className="relative">
              <Search className="w-3 h-3 text-slate-500 absolute left-2 top-2" />
              <input
                type="text"
                placeholder="Filter GA, Name, Raum..."
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-md pl-6 pr-2 py-0.5 text-xs text-slate-200 placeholder-slate-500 w-44 focus:w-56 transition-all"
              />
            </div>

            {/* Pause / Resume */}
            <button
              onClick={onTogglePause}
              className={`px-2 py-1 rounded text-xs flex items-center gap-1 transition-colors ${
                isPaused
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
              }`}
              title={isPaused ? 'Fortsetzen' : 'Pausieren'}
            >
              {isPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
              <span className="text-[10px]">{isPaused ? 'Pausiert' : 'Pause'}</span>
            </button>

            {/* Clear button */}
            <button
              onClick={onClear}
              className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
              title="Log leeren"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

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
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-sky-500"
          >
            <option value="1.001">DPT 1.001 (Schalten)</option>
            <option value="1.008">DPT 1.008 (Auf/Ab)</option>
            <option value="1.010">DPT 1.010 (Stopp)</option>
            <option value="5.001">DPT 5.001 (Prozent 0-100%)</option>
            <option value="7.005">DPT 7.005 (Zeit Sekunden s)</option>
            <option value="9.001">DPT 9.001 (Temperatur °C)</option>
            <option value="18.001">DPT 18.001 (Szene)</option>
          </select>

          {/* Value Inputs based on DPT */}
          {sendDpt.startsWith('1.') && sendDpt !== '1.008' && sendDpt !== '1.010' && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setSendValBool(true)}
                className={`px-2.5 py-1 rounded text-xs font-semibold ${
                  sendValBool
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                EIN (1)
              </button>
              <button
                type="button"
                onClick={() => setSendValBool(false)}
                className={`px-2.5 py-1 rounded text-xs font-semibold ${
                  !sendValBool
                    ? 'bg-red-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                AUS (0)
              </button>
            </div>
          )}

          {sendDpt === '1.008' && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleSend(false)}
                className="px-2.5 py-1 rounded text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white"
              >
                ▲ AUF (0)
              </button>
              <button
                type="button"
                onClick={() => handleSend(true)}
                className="px-2.5 py-1 rounded text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white"
              >
                ▼ AB (1)
              </button>
            </div>
          )}

          {sendDpt === '1.010' && (
            <button
              type="button"
              onClick={() => handleSend(true)}
              className="px-3 py-1 rounded text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white"
            >
              ◼ STOPP (1)
            </button>
          )}

          {sendDpt.startsWith('5.') && (
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0"
                max="100"
                value={sendValPercent}
                onChange={(e) => setSendValPercent(Number(e.target.value))}
                className="w-24 accent-sky-500"
              />
              <span className="font-mono text-xs text-sky-400 w-10">{sendValPercent}%</span>
            </div>
          )}

          {sendDpt.startsWith('7.') && (
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                step="1"
                min="0"
                max="65535"
                value={sendValNum}
                onChange={(e) => setSendValNum(parseInt(e.target.value) || 0)}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-sky-400 font-mono w-20 text-right"
              />
              <span className="text-slate-400 font-mono text-xs">s</span>
            </div>
          )}

          {sendDpt.startsWith('18.') && (
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                step="1"
                min="1"
                max="64"
                value={sendValNum}
                onChange={(e) => setSendValNum(parseInt(e.target.value) || 1)}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-amber-400 font-mono w-16 text-right"
              />
              <span className="text-slate-400 font-mono text-xs">Nr. (1–64)</span>
            </div>
          )}

          {sendDpt.startsWith('9.') && (
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                step="0.5"
                value={sendValFloat}
                onChange={(e) => setSendValFloat(Number(e.target.value))}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-sky-400 font-mono w-20"
              />
              <span className="text-slate-400">°C</span>
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
              Noch keine Telegramme auf dem Bus empfangen. Schalte einen Taster im Haus oder sende oben ein Test-Telegramm.
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-950/80 sticky top-0 text-[10px] text-slate-400 border-b border-slate-800 uppercase tracking-wider">
                <tr>
                  <th className="py-1.5 px-3">Zeit</th>
                  <th className="py-1.5 px-3">Quelle (PA)</th>
                  <th className="py-1.5 px-3">Ziel (GA)</th>
                  <th className="py-1.5 px-3">Zugeordneter Name / Gewerk</th>
                  <th className="py-1.5 px-3">DPT</th>
                  <th className="py-1.5 px-3">Typ</th>
                  <th className="py-1.5 px-3 text-right">Wert</th>
                  <th className="py-1.5 px-3 text-center">Test</th>
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
