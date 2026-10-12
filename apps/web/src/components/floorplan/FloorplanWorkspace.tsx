import React, { useState, useMemo, useCallback } from 'react'
import {
  Project,
  Floor,
  Room,
  FloorPlan,
  FloorPlanWidget,
  FloorPlanWidgetType,
  FloorCadModel,
  KnxTelegram,
  GroupAddress,
} from '../../types/knx'
import { CadCanvas, CadTool } from './CadCanvas'
import {
  Home,
  Layers,
  Edit3,
  Eye,
  Grid3X3,
  Plus,
  Trash2,
  Upload,
  Lightbulb,
  ArrowUpDown,
  Thermometer,
  Sliders,
  Check,
  X,
  Sparkles,
  Info,
  Compass,
  Building,
} from 'lucide-react'
import { useTranslation } from '../../i18n/I18nContext'

interface FloorplanWorkspaceProps {
  project: Project
  onUpdateProject: (updatedProject: Project) => void
  telegrams?: KnxTelegram[]
  onSendTelegram?: (destination: string, value: any, dpt?: string) => Promise<void>
}

export const FloorplanWorkspace: React.FC<FloorplanWorkspaceProps> = ({
  project,
  onUpdateProject,
  telegrams = [],
  onSendTelegram,
}) => {
  const { t } = useTranslation()

  // 1. Etagen-Auswahl
  const floors = project.floors || []
  const [selectedFloorId, setSelectedFloorId] = useState<string>(() => {
    return floors[0]?.id || ''
  })

  // Falls selectedFloorId ungültig ist, auf erste Etage setzen
  const activeFloor = useMemo(() => {
    return floors.find((f) => f.id === selectedFloorId) || floors[0] || null
  }, [floors, selectedFloorId])

  // 2. Modus-Umschaltung
  // 'live': Bereinigter Architektenplan mit interaktiven Widgets
  // 'cad': Konstruktionsmodus mit Werkzeugleiste (Wand, Tür, Fenster etc.)
  // 'grid': Automatisches Raum-Grid (sofort nutzbar ohne CAD)
  const [viewMode, setViewMode] = useState<'live' | 'cad' | 'grid'>('live')
  const [cadTool, setCadTool] = useState<CadTool>('select')

  // 3. Aktueller FloorPlan für die gewählte Etage
  const currentFloorPlan = useMemo((): FloorPlan => {
    if (!activeFloor) {
      return { floor_id: '', widgets: [] }
    }
    const found = (project.floor_plans || []).find((fp) => fp.floor_id === activeFloor.id)
    if (found) return found

    // Fallback Default FloorPlan
    return {
      floor_id: activeFloor.id,
      cad_model: {
        walls: [],
        openings: [],
        room_zones: [],
        scale_pixels_per_meter: 40,
      },
      widgets: [],
    }
  }, [project.floor_plans, activeFloor])

  // Helper zum atomaren Speichern des FloorPlans im Projekt
  const saveFloorPlan = useCallback(
    (updatedFp: FloorPlan) => {
      const existing = project.floor_plans || []
      const index = existing.findIndex((fp) => fp.floor_id === updatedFp.floor_id)
      let nextList: FloorPlan[]
      if (index >= 0) {
        nextList = existing.map((fp, i) => (i === index ? updatedFp : fp))
      } else {
        nextList = [...existing, updatedFp]
      }
      onUpdateProject({
        ...project,
        floor_plans: nextList,
      })
    },
    [project, onUpdateProject]
  )

  // 4. Widget-Editor / Einstellungsdialog
  const [editingWidget, setEditingWidget] = useState<FloorPlanWidget | null>(null)
  const [isWidgetModalOpen, setIsWidgetModalOpen] = useState(false)

  // Räume der aktuellen Etage
  const floorRooms = useMemo(() => {
    if (!activeFloor) return []
    return (project.rooms || []).filter((r) => r.floor_id === activeFloor.id)
  }, [project.rooms, activeFloor])

  // Telegramm-Triggering
  const handleTriggerGa = async (ga: string, value: any, dpt?: string) => {
    if (onSendTelegram) {
      try {
        await onSendTelegram(ga, value, dpt)
      } catch (err) {
        console.error('Failed to trigger GA in Floorplan:', err)
      }
    }
  }

  // Hintergrundbild Upload (Abpaus-Vorlage)
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      saveFloorPlan({
        ...currentFloorPlan,
        background_image: dataUrl,
        background_opacity: currentFloorPlan.background_opacity || 0.4,
      })
    }
    reader.readAsDataURL(file)
  }

  // Neues Widget anlegen
  const handleAddNewWidget = (type: FloorPlanWidgetType) => {
    const newW: FloorPlanWidget = {
      id: crypto.randomUUID(),
      floor_id: activeFloor?.id || '',
      room_id: floorRooms[0]?.id || null,
      title: type === 'Light' ? 'Neue Deckenleuchte' : type === 'Blind' ? 'Neues Rollo' : 'Neues Thermostat',
      widget_type: type,
      x: 5, // 5m Default-Position
      y: 5,
    }
    const updated = [...(currentFloorPlan.widgets || []), newW]
    saveFloorPlan({
      ...currentFloorPlan,
      widgets: updated,
    })
    setEditingWidget(newW)
    setIsWidgetModalOpen(true)
  }

  return (
    <div className="flex flex-col w-full h-full bg-slate-950 overflow-hidden select-none">
      {/* ========================================================================= */}
      {/* 1. OBERE KOPFLEISTE: ETAGEN-TABS & MODUS-SWITCHER                         */}
      {/* ========================================================================= */}
      <div className="h-13 bg-slate-900 border-b border-slate-800 px-4 flex items-center justify-between gap-4 shrink-0 z-10 shadow-md">
        {/* Links: Etagen-Navigation */}
        <div className="flex items-center gap-2 overflow-x-auto py-1 scrollbar-none">
          <div className="flex items-center gap-1.5 mr-2 text-slate-400 text-xs font-semibold">
            <Building className="w-4 h-4 text-emerald-400" />
            <span className="hidden sm:inline">Etage:</span>
          </div>

          {floors.map((fl) => {
            const isActive = fl.id === selectedFloorId
            return (
              <button
                key={fl.id}
                onClick={() => setSelectedFloorId(fl.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  isActive
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/60 ring-1 ring-emerald-400/50'
                    : 'bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700/80 border border-slate-700/60'
                }`}
              >
                <span>{fl.name}</span>
                <span className="text-[10px] opacity-75 font-mono">
                  ({fl.level >= 0 ? `+${fl.level}` : fl.level})
                </span>
              </button>
            )
          })}

          {floors.length === 0 && (
            <span className="text-xs text-slate-400 italic">Keine Etagen im Projekt definiert</span>
          )}
        </div>

        {/* Mitte / Rechts: Haupt-Ansichtsmodus */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 shadow-inner">
            <button
              onClick={() => setViewMode('live')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                viewMode === 'live'
                  ? 'bg-sky-600 text-white shadow-md shadow-sky-950/60'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
              title="Interaktive Live-Bedienung: Lampen schalten, Rollos steuern"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Live-Bedienung</span>
            </button>

            <button
              onClick={() => {
                setViewMode('cad')
                setCadTool('select')
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                viewMode === 'cad'
                  ? 'bg-amber-600 text-white shadow-md shadow-amber-950/60'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
              title="CAD-Konstruktion: Wände, Türen und Fenster zeichnen"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>CAD-Editor</span>
            </button>

            <button
              onClick={() => setViewMode('grid')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                viewMode === 'grid'
                  ? 'bg-purple-600 text-white shadow-md shadow-purple-950/60'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
              title="Raum-Grid: Schnelle Kachel-Übersicht wie in Loxone"
            >
              <Grid3X3 className="w-3.5 h-3.5" />
              <span>Raum-Grid</span>
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. HAUPT-ARBEITSBEREICH                                                   */}
      {/* ========================================================================= */}
      <div className="flex-1 relative flex overflow-hidden">
        {/* A. CAD-WERKZEUGLEISTE (NUR IM CAD-MODUS SICHTBAR) */}
        {viewMode === 'cad' && (
          <div className="w-56 bg-slate-900/95 border-r border-slate-800 p-3 flex flex-col gap-3 shrink-0 z-10 shadow-lg backdrop-blur">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1">
              CAD-Konstruktion
            </div>

            <div className="space-y-1">
              <button
                onClick={() => setCadTool('select')}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  cadTool === 'select'
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <Sliders className="w-4 h-4 text-sky-400" />
                <span>Auswählen / Bewegen</span>
              </button>

              <button
                onClick={() => setCadTool('wall_outer')}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  cadTool === 'wall_outer'
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <div className="w-3.5 h-3.5 rounded-sm bg-slate-400 border border-slate-300 shrink-0" />
                <span>Außenwand (24cm)</span>
              </button>

              <button
                onClick={() => setCadTool('wall_inner')}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  cadTool === 'wall_inner'
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <div className="w-3.5 h-1.5 rounded-sm bg-slate-400 shrink-0" />
                <span>Innenwand (12cm)</span>
              </button>

              <button
                onClick={() => setCadTool('door')}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  cadTool === 'door'
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <span className="font-mono text-xs">🚪</span>
                <span>Tür einsetzen</span>
              </button>

              <button
                onClick={() => setCadTool('window')}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  cadTool === 'window'
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <span className="font-mono text-xs">🪟</span>
                <span>Fenster einsetzen</span>
              </button>
            </div>

            <div className="h-[1px] bg-slate-800 my-1" />

            {/* KNX-Widgets hinzufügen */}
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1">
              KNX-Elemente
            </div>
            <div className="space-y-1">
              <button
                onClick={() => handleAddNewWidget('Light')}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-amber-300 transition-colors cursor-pointer"
              >
                <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
                <span>+ Lampe platzieren</span>
              </button>
              <button
                onClick={() => handleAddNewWidget('Blind')}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-sky-300 transition-colors cursor-pointer"
              >
                <ArrowUpDown className="w-3.5 h-3.5 text-sky-400" />
                <span>+ Jalousie platzieren</span>
              </button>
              <button
                onClick={() => handleAddNewWidget('Climate')}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-orange-300 transition-colors cursor-pointer"
              >
                <Thermometer className="w-3.5 h-3.5 text-orange-400" />
                <span>+ Thermostat platzieren</span>
              </button>
            </div>

            <div className="h-[1px] bg-slate-800 my-1" />

            {/* Bauplan-Vorlage Upload (Trace-Overlay) */}
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1">
              Bauplan-Schablone
            </div>
            <label className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-800 border border-dashed border-slate-700 cursor-pointer transition-colors">
              <Upload className="w-3.5 h-3.5 text-slate-400" />
              <span>{currentFloorPlan.background_image ? 'Plan ersetzen' : 'Planbild hochladen'}</span>
              <input
                type="file"
                accept="image/*,.svg"
                onChange={handleImageUpload}
                className="hidden"
              />
            </label>

            {currentFloorPlan.background_image && (
              <div className="space-y-1 pt-1">
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>Transparenz:</span>
                  <span className="font-mono">
                    {Math.round((currentFloorPlan.background_opacity || 0.4) * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="0.9"
                  step="0.05"
                  value={currentFloorPlan.background_opacity || 0.4}
                  onChange={(e) =>
                    saveFloorPlan({
                      ...currentFloorPlan,
                      background_opacity: parseFloat(e.target.value),
                    })
                  }
                  className="w-full accent-sky-500 h-1 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>
            )}
          </div>
        )}

        {/* B. ZEICHENFLÄCHE (CAD / LIVE MODUS) */}
        {viewMode !== 'grid' && (
          <div className="flex-1 w-full h-full relative">
            <CadCanvas
              cadModel={
                currentFloorPlan.cad_model || {
                  walls: [],
                  openings: [],
                  room_zones: [],
                  scale_pixels_per_meter: 40,
                }
              }
              widgets={currentFloorPlan.widgets || []}
              backgroundImage={currentFloorPlan.background_image}
              backgroundOpacity={currentFloorPlan.background_opacity}
              isEditMode={viewMode === 'cad'}
              activeTool={cadTool}
              scale={currentFloorPlan.cad_model?.scale_pixels_per_meter || 40}
              onUpdateCadModel={(cad_model) =>
                saveFloorPlan({
                  ...currentFloorPlan,
                  cad_model,
                })
              }
              onUpdateWidgets={(widgets) =>
                saveFloorPlan({
                  ...currentFloorPlan,
                  widgets,
                })
              }
              onSelectWidget={(w) => {
                setEditingWidget(w)
                setIsWidgetModalOpen(true)
              }}
              onTriggerGa={handleTriggerGa}
              latestTelegrams={telegrams}
            />
          </div>
        )}

        {/* C. RAUM-GRID MODUS (LOXONE-STYLE KACHELN) */}
        {viewMode === 'grid' && (
          <div className="flex-1 w-full h-full p-6 overflow-y-auto">
            <div className="max-w-6xl mx-auto space-y-6">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                    <Grid3X3 className="w-5 h-5 text-purple-400" />
                    <span>Raum-Übersicht: {activeFloor?.name || 'Etage'}</span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Automatische Kacheldarstellung aller KNX-Funktionen dieser Etage
                  </p>
                </div>
              </div>

              {floorRooms.length === 0 ? (
                <div className="p-8 text-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/40">
                  <p className="text-sm text-slate-400">
                    Keine Räume für diese Etage definiert. Lege Räume im Gebäude-Baum an!
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {floorRooms.map((room) => {
                    const roomWidgets = (currentFloorPlan.widgets || []).filter(
                      (w) => w.room_id === room.id
                    )

                    return (
                      <div
                        key={room.id}
                        className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-lg hover:border-slate-700 transition-all flex flex-col justify-between"
                      >
                        <div className="space-y-3">
                          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                            <span className="font-bold text-sm text-slate-200">{room.name}</span>
                            <span className="text-[10px] font-mono text-purple-400 bg-purple-950/80 px-2 py-0.5 rounded border border-purple-800/60">
                              {roomWidgets.length} Geräte
                            </span>
                          </div>

                          {roomWidgets.length === 0 ? (
                            <p className="text-xs text-slate-400 italic py-4 text-center">
                              Keine Geräte verknüpft
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {roomWidgets.map((w) => (
                                <div
                                  key={w.id}
                                  className="flex items-center justify-between p-2 rounded-xl bg-slate-950/60 border border-slate-800/60"
                                >
                                  <div className="flex items-center gap-2">
                                    {w.widget_type === 'Light' ? (
                                      <Lightbulb className="w-4 h-4 text-amber-400" />
                                    ) : w.widget_type === 'Blind' ? (
                                      <ArrowUpDown className="w-4 h-4 text-sky-400" />
                                    ) : (
                                      <Thermometer className="w-4 h-4 text-orange-400" />
                                    )}
                                    <span className="text-xs text-slate-300 font-medium">
                                      {w.title}
                                    </span>
                                  </div>

                                  {/* Quick Action Button */}
                                  {w.widget_type === 'Light' && w.ga_switch && (
                                    <button
                                      onClick={() => handleTriggerGa(w.ga_switch!, 1, '1.001')}
                                      className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/40 transition-colors cursor-pointer"
                                    >
                                      Schalten
                                    </button>
                                  )}
                                  {w.widget_type === 'Blind' && w.ga_switch && (
                                    <button
                                      onClick={() => handleTriggerGa(w.ga_switch!, 1, '1.008')}
                                      className="px-2 py-1 rounded-lg text-xs font-semibold bg-sky-500/20 text-sky-300 hover:bg-sky-500/30 border border-sky-500/40 transition-colors cursor-pointer"
                                    >
                                      Auf / Ab
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <button
                          onClick={() => {
                            const newW: FloorPlanWidget = {
                              id: crypto.randomUUID(),
                              floor_id: activeFloor?.id || '',
                              room_id: room.id,
                              title: `${room.name} Licht`,
                              widget_type: 'Light',
                              x: 5,
                              y: 5,
                            }
                            saveFloorPlan({
                              ...currentFloorPlan,
                              widgets: [...(currentFloorPlan.widgets || []), newW],
                            })
                            setEditingWidget(newW)
                            setIsWidgetModalOpen(true)
                          }}
                          className="mt-4 w-full py-1.5 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg border border-dashed border-slate-700/60 transition-colors flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Gerät zu Raum hinzufügen</span>
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 3. WIDGET KONFIGURATIONS-MODAL                                           */}
      {/* ========================================================================= */}
      {isWidgetModalOpen && editingWidget && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-sky-400" />
                <span>KNX-Widget konfigurieren</span>
              </h3>
              <button
                onClick={() => setIsWidgetModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Bezeichnung
                </label>
                <input
                  type="text"
                  value={editingWidget.title}
                  onChange={(e) =>
                    setEditingWidget({ ...editingWidget, title: e.target.value })
                  }
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Typ
                </label>
                <select
                  value={editingWidget.widget_type}
                  onChange={(e) =>
                    setEditingWidget({
                      ...editingWidget,
                      widget_type: e.target.value as FloorPlanWidgetType,
                    })
                  }
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-sky-500"
                >
                  <option value="Light">Licht / Schalten (DPT 1.001)</option>
                  <option value="Blind">Jalousie / Rollo (DPT 1.008 / 5.001)</option>
                  <option value="Climate">Raumthermostat / Temperatur (DPT 9.001)</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Zugeordneter Raum
                </label>
                <select
                  value={editingWidget.room_id || ''}
                  onChange={(e) =>
                    setEditingWidget({ ...editingWidget, room_id: e.target.value || null })
                  }
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-sky-500"
                >
                  <option value="">Keiner (Allgemein)</option>
                  {floorRooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Schalt- / Steuer-Gruppenadresse
                </label>
                <select
                  value={editingWidget.ga_switch || ''}
                  onChange={(e) =>
                    setEditingWidget({ ...editingWidget, ga_switch: e.target.value || null })
                  }
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-sky-500"
                >
                  <option value="">Keine GA zugewiesen</option>
                  {(project.group_addresses || []).map((ga) => (
                    <option key={ga.id} value={ga.address}>
                      {ga.address} – {ga.name} ({ga.dpt})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Status- / Rückmelde-Gruppenadresse
                </label>
                <select
                  value={editingWidget.ga_state || ''}
                  onChange={(e) =>
                    setEditingWidget({ ...editingWidget, ga_state: e.target.value || null })
                  }
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-sky-500"
                >
                  <option value="">Gleiche wie Schalt-GA oder keine</option>
                  {(project.group_addresses || []).map((ga) => (
                    <option key={ga.id} value={ga.address}>
                      {ga.address} – {ga.name} ({ga.dpt})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-800">
              <button
                onClick={() => {
                  const updated = (currentFloorPlan.widgets || []).filter(
                    (w) => w.id !== editingWidget.id
                  )
                  saveFloorPlan({
                    ...currentFloorPlan,
                    widgets: updated,
                  })
                  setIsWidgetModalOpen(false)
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-400 hover:bg-rose-500/10 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Löschen</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsWidgetModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:bg-slate-800 transition-colors"
                >
                  Abbrechen
                </button>
                <button
                  onClick={() => {
                    const updated = (currentFloorPlan.widgets || []).map((w) =>
                      w.id === editingWidget.id ? editingWidget : w
                    )
                    saveFloorPlan({
                      ...currentFloorPlan,
                      widgets: updated,
                    })
                    setIsWidgetModalOpen(false)
                  }}
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white shadow-md shadow-sky-950 transition-colors"
                >
                  Speichern
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
