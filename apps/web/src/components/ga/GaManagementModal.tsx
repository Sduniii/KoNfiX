import React, { useState, useMemo } from 'react'
import {
  X,
  Network,
  Layers,
  Sparkles,
  Lock,
  Unlock,
  Check,
  Search,
  Filter,
  Download,
  FileSpreadsheet,
  FileCode,
  Sliders,
  Edit2,
  Building,
} from 'lucide-react'
import { Project, GroupAddress, GaScheme } from '../../types/knx'
import { downloadEtsCsv, downloadEtsXml } from '../../services/api'

interface GaManagementModalProps {
  isOpen: boolean
  onClose: () => void
  project: Project | null
  onSetScheme: (scheme: GaScheme) => void
  onUpdateGroupAddress: (ga: GroupAddress) => void
}

export const GaManagementModal: React.FC<GaManagementModalProps> = ({
  isOpen,
  onClose,
  project,
  onSetScheme,
  onUpdateGroupAddress,
}) => {
  const [tab, setTab] = useState<'scheme' | 'list'>('scheme')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTrade, setSelectedTrade] = useState<string>('all')
  const [selectedStatus, setSelectedStatus] = useState<'all' | 'auto' | 'custom'>('all')

  // Inline editing state for a row
  const [editingGaId, setEditingGaId] = useState<string | null>(null)
  const [editAddress, setEditAddress] = useState('')
  const [editError, setEditError] = useState<string | null>(null)

  const activeScheme: GaScheme = project?.ga_scheme || 'FloorTradeFunction'

  // Map of GA address -> list of { deviceAddr, deviceName, koNum, koName }
  const gaDeviceMap = useMemo(() => {
    const map = new Map<string, Array<{ deviceAddr: string; deviceName: string; koNum: number; koName: string }>>()
    if (!project?.devices) return map

    for (const dev of project.devices) {
      if (!dev.communication_objects) continue
      for (const ko of dev.communication_objects) {
        for (const addr of ko.group_addresses) {
          const list = map.get(addr) || []
          list.push({
            deviceAddr: dev.individual_address,
            deviceName: dev.name,
            koNum: ko.number,
            koName: ko.object_text || ko.function_text || ko.name || `KO ${ko.number}`,
          })
          map.set(addr, list)
        }
      }
    }
    return map
  }, [project?.devices])

  // Filter GAs
  const filteredGas = useMemo(() => {
    if (!project?.group_addresses) return []
    return project.group_addresses.filter((ga) => {
      // Search
      const matchSearch =
        searchQuery.trim() === '' ||
        ga.address.includes(searchQuery) ||
        ga.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ga.dpt.includes(searchQuery) ||
        (gaDeviceMap.get(ga.address)?.some((d) =>
          d.deviceAddr.includes(searchQuery) ||
          d.deviceName.toLowerCase().includes(searchQuery.toLowerCase())
        ) ?? false)

      // Status
      const matchStatus =
        selectedStatus === 'all' ||
        (selectedStatus === 'custom' && ga.is_custom) ||
        (selectedStatus === 'auto' && !ga.is_custom) ||
        ((selectedStatus as string) === 'linked' && (gaDeviceMap.get(ga.address)?.length ?? 0) > 0)

      // Trade
      let matchTrade = true
      if (selectedTrade === 'lighting') {
        matchTrade = ga.name.toLowerCase().includes('licht') || ga.dpt.startsWith('1.001') || ga.dpt.startsWith('3.007') || ga.dpt.startsWith('5.001')
      } else if (selectedTrade === 'shading') {
        matchTrade = ga.name.toLowerCase().includes('jalousie') || ga.name.toLowerCase().includes('raffstore') || ga.dpt.startsWith('1.008') || ga.dpt.startsWith('1.010')
      } else if (selectedTrade === 'climate') {
        matchTrade = ga.name.toLowerCase().includes('temp') || ga.name.toLowerCase().includes('heiz') || ga.dpt.startsWith('9.001') || ga.dpt.startsWith('20.102')
      }

      return matchSearch && matchStatus && matchTrade
    })
  }, [project?.group_addresses, searchQuery, selectedStatus, selectedTrade, gaDeviceMap])

  if (!isOpen) return null

  const handleStartEdit = (ga: GroupAddress) => {
    setEditingGaId(ga.id)
    setEditAddress(ga.address)
    setEditError(null)
  }

  const handleSaveEdit = (ga: GroupAddress) => {
    const parts = editAddress.trim().split('/')
    if (parts.length !== 3) {
      setEditError('Format muss Haupt/Mittel/Unter sein (z. B. 1/1/10)')
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
      setEditError('KNX-Grenzen: Haupt (0..31) / Mittel (0..7) / Unter (0..255)')
      return
    }

    const collision = project?.group_addresses.find(
      (g) => g.id !== ga.id && g.address === `${main}/${middle}/${sub}`
    )
    if (collision) {
      setEditError(`Bereits vergeben für "${collision.name}"!`)
      return
    }

    onUpdateGroupAddress({
      ...ga,
      address: `${main}/${middle}/${sub}`,
      main,
      middle,
      sub,
      is_custom: true,
    })
    setEditingGaId(null)
  }

  const handleResetToAuto = (ga: GroupAddress) => {
    onUpdateGroupAddress({
      ...ga,
      is_custom: false,
    })
    setEditingGaId(null)
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[85vh] shadow-2xl flex flex-col overflow-hidden text-slate-100 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Network className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <span>KNX Gruppenadressen & Adressier-Muster</span>
                <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                  {project?.group_addresses.length ?? 0} Adressen
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Konfiguriere automatische Adressierungs-Profile oder passe Gruppenadressen manuell an.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-800 bg-slate-950/30 px-6 text-xs font-semibold">
          <button
            onClick={() => setTab('scheme')}
            className={`py-3 px-4 border-b-2 transition-colors flex items-center gap-2 ${
              tab === 'scheme'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Adressier-Muster (Schema)</span>
          </button>
          <button
            onClick={() => setTab('list')}
            className={`py-3 px-4 border-b-2 transition-colors flex items-center gap-2 ${
              tab === 'list'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Network className="w-4 h-4" />
            <span>Gruppenadress-Tabelle ({filteredGas.length})</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'scheme' ? (
            <div className="space-y-6 max-w-3xl mx-auto">
              <div>
                <h3 className="text-sm font-semibold text-slate-200">
                  Wähle das KNX-Adressierungsmuster für dein Projekt
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Der Auto-GA Router strukturiert alle 3-stufigen Gruppenadressen nach dem gewählten Schema.
                  Manuell fixierte Adressen werden geschützt und niemals überschrieben.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4">
                {/* Scheme 1: FloorTradeFunction */}
                <div
                  onClick={() => onSetScheme('FloorTradeFunction')}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    activeScheme === 'FloorTradeFunction'
                      ? 'border-emerald-500 bg-emerald-950/20 ring-1 ring-emerald-500/50'
                      : 'border-slate-800 bg-slate-950/40 hover:border-slate-700 hover:bg-slate-900/60'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                          activeScheme === 'FloorTradeFunction'
                            ? 'border-emerald-500 bg-emerald-500 text-slate-950'
                            : 'border-slate-600'
                        }`}
                      >
                        {activeScheme === 'FloorTradeFunction' && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-slate-200 flex items-center gap-2">
                          <span>Etage / Gewerk / Funktion</span>
                          <span className="text-[10px] font-mono bg-slate-800 text-sky-400 px-1.5 py-0.5 rounded border border-slate-700">
                            Standard
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 mt-1">
                          Hauptgruppe = <strong>Stockwerk</strong> (1=EG, 2=OG, 3=KG, 0=Zentral) •
                          Mittelgruppe = <strong>Gewerk</strong> (1=Licht, 2=Jalousie, 3=Heizung, 4=Logik) •
                          Untergruppe = <strong>Funktion</strong>.
                        </div>
                      </div>
                    </div>
                    <span className="font-mono text-xs bg-slate-800 px-2 py-1 rounded text-emerald-400 border border-slate-700">
                      z.B. 1/1/10
                    </span>
                  </div>
                </div>

                {/* Scheme 2: TradeRoomFunction */}
                <div
                  onClick={() => onSetScheme('TradeRoomFunction')}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    activeScheme === 'TradeRoomFunction'
                      ? 'border-emerald-500 bg-emerald-950/20 ring-1 ring-emerald-500/50'
                      : 'border-slate-800 bg-slate-950/40 hover:border-slate-700 hover:bg-slate-900/60'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                          activeScheme === 'TradeRoomFunction'
                            ? 'border-emerald-500 bg-emerald-500 text-slate-950'
                            : 'border-slate-600'
                        }`}
                      >
                        {activeScheme === 'TradeRoomFunction' && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-slate-200 flex items-center gap-2">
                          <span>Gewerk / Raum / Funktion</span>
                          <span className="text-[10px] font-mono bg-emerald-950 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-800/40">
                            ZVEI Empfehlung
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 mt-1">
                          Hauptgruppe = <strong>Gewerk</strong> (1=Licht, 2=Jalousie, 3=Heizung, 4=Logik) •
                          Mittelgruppe = <strong>Raum</strong> (1=Wohnzimmer, 2=Küche, 3=Schlafzimmer...) •
                          Untergruppe = <strong>Funktion</strong>.
                        </div>
                      </div>
                    </div>
                    <span className="font-mono text-xs bg-slate-800 px-2 py-1 rounded text-emerald-400 border border-slate-700">
                      z.B. 1/2/10
                    </span>
                  </div>
                </div>

                {/* Scheme 3: TradeFunctionDevice */}
                <div
                  onClick={() => onSetScheme('TradeFunctionDevice')}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    activeScheme === 'TradeFunctionDevice'
                      ? 'border-emerald-500 bg-emerald-950/20 ring-1 ring-emerald-500/50'
                      : 'border-slate-800 bg-slate-950/40 hover:border-slate-700 hover:bg-slate-900/60'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                          activeScheme === 'TradeFunctionDevice'
                            ? 'border-emerald-500 bg-emerald-500 text-slate-950'
                            : 'border-slate-600'
                        }`}
                      >
                        {activeScheme === 'TradeFunctionDevice' && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-slate-200 flex items-center gap-2">
                          <span>Gewerk / Funktion / Baustein</span>
                          <span className="text-[10px] font-mono bg-slate-800 text-purple-400 px-1.5 py-0.5 rounded border border-slate-700">
                            Kompakt
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 mt-1">
                          Hauptgruppe = <strong>Gewerk</strong> •
                          Mittelgruppe = <strong>Befehl</strong> (1=Schalten, 2=Dimmen, 3=Wert, 4=Status Schalten, 5=Status Wert) •
                          Untergruppe = <strong>Aktor-/Baustein-ID</strong>.
                        </div>
                      </div>
                    </div>
                    <span className="font-mono text-xs bg-slate-800 px-2 py-1 rounded text-emerald-400 border border-slate-700">
                      z.B. 1/1/1 & 1/4/1
                    </span>
                  </div>
                </div>
              </div>

              {/* Information Note */}
              <div className="p-4 rounded-xl border border-sky-500/30 bg-sky-950/20 flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
                <div className="text-xs text-slate-300 leading-relaxed">
                  <strong>Echtzeit-Routing:</strong> Beim Wechsel des Schemas werden alle noch nicht manuell
                  fixierten Gruppenadressen im gesamten Projekt augenblicklich im Hintergrund neu geordnet.
                  Alle Verdrahtungen und Baustein-Verknüpfungen bleiben voll funktionsfähig erhalten.
                </div>
              </div>
            </div>
          ) : (
            /* Tab 2: Group Address Table */
            <div className="space-y-4">
              {/* Filter & Search Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950/40 p-3 rounded-xl border border-slate-800">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Suche nach Adresse, Name oder DPT..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={selectedTrade}
                    onChange={(e) => setSelectedTrade(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="all">Alle Gewerke</option>
                    <option value="lighting">Beleuchtung</option>
                    <option value="shading">Beschattung</option>
                    <option value="climate">Heizung / Klima</option>
                  </select>

                  <select
                    value={selectedStatus}
                    onChange={(e) => setSelectedStatus(e.target.value as any)}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="all">Alle Status</option>
                    <option value="linked">Nur mit Busteilnehmern verknüpft</option>
                    <option value="auto">Nur Auto-GAs</option>
                    <option value="custom">Nur Manuell fixiert</option>
                  </select>
                </div>
              </div>

              {/* Table */}
              <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/30">
                <div className="overflow-x-auto max-h-[50vh]">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-950/80 sticky top-0 z-10 border-b border-slate-800 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      <tr>
                        <th className="py-2.5 px-4">Adresse</th>
                        <th className="py-2.5 px-4">Name & Verknüpfte Busteilnehmer</th>
                        <th className="py-2.5 px-4">DPT</th>
                        <th className="py-2.5 px-4">Typ</th>
                        <th className="py-2.5 px-4 text-right">Aktionen</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono">
                      {filteredGas.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-slate-500 italic font-sans">
                            Keine Gruppenadressen gefunden.
                          </td>
                        </tr>
                      ) : (
                        filteredGas.map((ga) => {
                          const isEditing = editingGaId === ga.id

                          return (
                            <tr
                              key={ga.id}
                              className={`hover:bg-slate-800/30 transition-colors ${
                                ga.is_custom ? 'bg-amber-500/5' : ''
                              }`}
                            >
                              <td className="py-2.5 px-4 whitespace-nowrap font-bold">
                                {isEditing ? (
                                  <div className="space-y-1">
                                    <input
                                      type="text"
                                      value={editAddress}
                                      onChange={(e) => setEditAddress(e.target.value)}
                                      className="w-24 bg-slate-800 border border-emerald-500 rounded px-2 py-1 text-xs text-emerald-400 font-bold focus:outline-none"
                                      placeholder="1/1/10"
                                      autoFocus
                                    />
                                    {editError && (
                                      <div className="text-[10px] text-red-400 font-sans max-w-[200px]">
                                        {editError}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <span
                                    className={`px-2 py-0.5 rounded border text-xs ${
                                      ga.is_custom
                                        ? 'bg-amber-950/80 text-amber-400 border-amber-800/60'
                                        : 'bg-emerald-950/80 text-emerald-400 border-emerald-800/40'
                                    }`}
                                  >
                                    {ga.address}
                                  </span>
                                )}
                              </td>

                              <td className="py-2.5 px-4 font-sans text-slate-200">
                                <div className="font-medium truncate max-w-sm" title={ga.name}>
                                  {ga.name}
                                </div>
                                {ga.origin_pin_name && (
                                  <div className="text-[10px] text-slate-500 font-mono">
                                    Pin: {ga.origin_pin_name}
                                  </div>
                                )}
                                {(() => {
                                  const linked = gaDeviceMap.get(ga.address)
                                  if (!linked || linked.length === 0) return null
                                  return (
                                    <div className="flex flex-wrap gap-1 mt-1.5">
                                      {linked.map((item, i) => (
                                        <span
                                          key={i}
                                          className="inline-flex items-center gap-1 text-[10px] bg-slate-900/90 text-slate-300 border border-slate-700/70 px-1.5 py-0.5 rounded font-mono"
                                          title={`${item.deviceAddr} ${item.deviceName} — KO ${item.koNum}: ${item.koName}`}
                                        >
                                          <span className="text-sky-400 font-bold">{item.deviceAddr}</span>
                                          <span className="text-slate-300 font-sans truncate max-w-[130px]">{item.deviceName}</span>
                                          <span className="text-purple-400 font-semibold">KO {item.koNum}</span>
                                        </span>
                                      ))}
                                    </div>
                                  )
                                })()}
                              </td>

                              <td className="py-2.5 px-4 whitespace-nowrap">
                                <span className="bg-slate-800 px-1.5 py-0.5 rounded text-[11px] text-slate-300 border border-slate-700">
                                  DPT {ga.dpt}
                                </span>
                              </td>

                              <td className="py-2.5 px-4 whitespace-nowrap font-sans">
                                {ga.is_custom ? (
                                  <span className="flex items-center gap-1 text-[11px] text-amber-400 font-medium bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                                    <Lock className="w-3 h-3" /> Fixiert
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                                    <Sparkles className="w-3 h-3" /> Auto
                                  </span>
                                )}
                              </td>

                              <td className="py-2.5 px-4 text-right whitespace-nowrap font-sans">
                                {isEditing ? (
                                  <div className="flex items-center justify-end gap-1.5">
                                    <button
                                      onClick={() => handleSaveEdit(ga)}
                                      className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-medium transition-colors"
                                    >
                                      Speichern
                                    </button>
                                    <button
                                      onClick={() => setEditingGaId(null)}
                                      className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 text-[11px] transition-colors"
                                    >
                                      Abbrechen
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-end gap-1">
                                    <button
                                      onClick={() => handleStartEdit(ga)}
                                      className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                                      title="Gruppenadresse manuell anpassen"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                    {ga.is_custom && (
                                      <button
                                        onClick={() => handleResetToAuto(ga)}
                                        className="p-1 rounded text-amber-400 hover:text-emerald-400 hover:bg-slate-800 transition-colors"
                                        title="Auf automatische Vergabe zurücksetzen"
                                      >
                                        <Unlock className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-2">
            <button
              onClick={() => downloadEtsCsv()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
              <span>ETS CSV</span>
            </button>
            <button
              onClick={() => downloadEtsXml()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
            >
              <FileCode className="w-3.5 h-3.5 text-sky-400" />
              <span>ETS XML</span>
            </button>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-700/20 transition-all"
          >
            Fertig
          </button>
        </div>
      </div>
    </div>
  )
}
