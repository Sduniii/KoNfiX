import React, { useState } from 'react'
import {
  Building2,
  FolderTree,
  Boxes,
  Cpu,
  Lightbulb,
  Sun,
  Flame,
  Plus,
  ChevronRight,
  ChevronDown,
  Layers,
  Sparkles,
  Palette,
  Timer,
  Binary,
  Compass,
  Clock,
  Sliders,
  Trash2,
} from 'lucide-react'
import { Project, Room, Floor, FunctionBlockType } from '../../types/knx'
import { useTranslation } from '../../i18n/I18nContext'

interface LeftSidebarProps {
  project: Project | null
  selectedRoomId: string | null
  onSelectRoom: (roomId: string | null) => void
  onAddBlock: (type: FunctionBlockType) => void
  onAddChannelNode: (channelId: string, deviceId: string) => void
  onOpenAddDeviceModal: () => void
  onSelectDevice?: (deviceId: string) => void
  onDeleteDevice?: (deviceId: string) => void
  onPlaceDevice?: (deviceId: string) => void
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  project,
  selectedRoomId,
  onSelectRoom,
  onAddBlock,
  onAddChannelNode,
  onOpenAddDeviceModal,
  onSelectDevice,
  onDeleteDevice,
  onPlaceDevice,
}) => {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<'rooms' | 'blocks' | 'devices'>('rooms')
  const [expandedFloors, setExpandedFloors] = useState<Record<string, boolean>>({
    all: true,
  })
  const [expandedRooms, setExpandedRooms] = useState<Record<string, boolean>>({
    all: true,
  })

  const toggleFloor = (floorId: string) => {
    setExpandedFloors((prev) => ({
      ...prev,
      [floorId]: !(prev[floorId] ?? true),
    }))
  }

  const toggleRoom = (roomId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedRooms((prev) => ({
      ...prev,
      [roomId]: !(prev[roomId] ?? true),
    }))
  }

  return (
    <aside className="w-72 border-r border-slate-800 bg-slate-900/95 flex flex-col select-none shrink-0 z-20">
      {/* Sidebar Tabs */}
      <div className="grid grid-cols-3 border-b border-slate-800 text-xs font-medium text-slate-400 bg-slate-950/40">
        <button
          onClick={() => setActiveTab('rooms')}
          className={`py-2.5 flex items-center justify-center gap-1.5 transition-colors border-b-2 ${
            activeTab === 'rooms'
              ? 'border-emerald-500 text-emerald-400 bg-slate-900 font-semibold'
              : 'border-transparent hover:text-slate-200'
          }`}
        >
          <FolderTree className="w-3.5 h-3.5" />
          <span>{t('rooms.title')}</span>
        </button>

        <button
          onClick={() => setActiveTab('blocks')}
          className={`py-2.5 flex items-center justify-center gap-1.5 transition-colors border-b-2 ${
            activeTab === 'blocks'
              ? 'border-emerald-500 text-emerald-400 bg-slate-900 font-semibold'
              : 'border-transparent hover:text-slate-200'
          }`}
        >
          <Boxes className="w-3.5 h-3.5" />
          <span>{t('sidebar.blocks')}</span>
        </button>

        <button
          onClick={() => setActiveTab('devices')}
          className={`py-2.5 flex items-center justify-center gap-1.5 transition-colors border-b-2 ${
            activeTab === 'devices'
              ? 'border-emerald-500 text-emerald-400 bg-slate-900 font-semibold'
              : 'border-transparent hover:text-slate-200'
          }`}
        >
          <Cpu className="w-3.5 h-3.5" />
          <span>{t('sidebar.devices')}</span>
        </button>
      </div>

      {/* Tab Contents */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* TAB 1: RÄUME (Gebäude & Etagen-Baum wie in Loxone Config) */}
        {activeTab === 'rooms' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 uppercase tracking-wider px-1">
              <span>{t('rooms.buildingHierarchy')}</span>
              <button
                onClick={() => onSelectRoom(null)}
                className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                  selectedRoomId === null ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t('rooms.allRooms')}
              </button>
            </div>

            {project?.floors.map((floor) => {
              const isExpanded = expandedFloors[floor.id] ?? true
              const roomsInFloor = project.rooms.filter((r) => r.floor_id === floor.id)

              return (
                <div key={floor.id} className="space-y-1">
                  <div
                    onClick={() => toggleFloor(floor.id)}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-800/80 cursor-pointer text-slate-300 text-xs font-semibold"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                    )}
                    <Layers className="w-3.5 h-3.5 text-sky-400" />
                    <span>{floor.name}</span>
                    <span className="text-[10px] text-slate-500 font-mono ml-auto">
                      Level {floor.level}
                    </span>
                  </div>

                  {isExpanded && (
                    <div className="pl-6 space-y-0.5">
                      {roomsInFloor.map((room) => {
                        const isSelected = selectedRoomId === room.id
                        const isRoomExpanded = expandedRooms[room.id] ?? true
                        const devicesInRoom = project.devices?.filter((d) => d.room_id === room.id) || []
                        const blocksInRoom = project.blocks?.filter((b) => b.room_id === room.id) || []

                        return (
                          <div key={room.id} className="space-y-0.5">
                            <div
                              onClick={() => onSelectRoom(isSelected ? null : room.id)}
                              className={`flex items-center justify-between px-2 py-1.5 rounded-md text-xs cursor-pointer transition-all ${
                                isSelected
                                  ? 'bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30'
                                  : 'text-slate-300 hover:bg-slate-800/60'
                              }`}
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                <button
                                  onClick={(e) => toggleRoom(room.id, e)}
                                  className="p-0.5 hover:text-white text-slate-400 hover:bg-slate-700/50 rounded transition-colors"
                                  title={isRoomExpanded ? 'Einklappen' : 'Ausklappen'}
                                >
                                  {isRoomExpanded ? (
                                    <ChevronDown className="w-3 h-3 text-slate-400" />
                                  ) : (
                                    <ChevronRight className="w-3 h-3 text-slate-400" />
                                  )}
                                </button>
                                <span className="truncate">{room.name}</span>
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                {devicesInRoom.length > 0 && (
                                  <span
                                    title={`${devicesInRoom.length} KNX-Geräte`}
                                    className="text-[10px] bg-sky-950/80 text-sky-400 border border-sky-800/40 px-1.5 py-0.2 rounded font-mono flex items-center gap-0.5"
                                  >
                                    <Cpu className="w-2.5 h-2.5" />
                                    {devicesInRoom.length}
                                  </span>
                                )}
                                {blocksInRoom.length > 0 && (
                                  <span
                                    title={`${blocksInRoom.length} Bausteine`}
                                    className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.2 rounded font-mono"
                                  >
                                    {blocksInRoom.length}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Devices in Room */}
                            {isRoomExpanded && devicesInRoom.length > 0 && (
                              <div className="pl-4 pr-1 py-0.5 space-y-0.5 border-l border-slate-800/70 ml-3.5">
                                {devicesInRoom.map((dev) => (
                                  <div
                                    key={dev.id}
                                    draggable={true}
                                    onDragStart={(e) => {
                                      e.dataTransfer.setData(
                                        'application/knx-device',
                                        JSON.stringify({ deviceId: dev.id })
                                      )
                                      e.dataTransfer.setData('text/plain', `knx-device:${dev.id}`)
                                      e.dataTransfer.effectAllowed = 'copy'
                                    }}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      if (onSelectDevice) onSelectDevice(dev.id)
                                    }}
                                    className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-slate-400 hover:text-sky-300 hover:bg-slate-800/70 cursor-grab active:cursor-grabbing transition-colors group select-none"
                                    title={`${dev.individual_address} - ${dev.name} (Auf Canvas ziehen oder per '+ Canvas' platzieren)`}
                                  >
                                    <span className="font-mono text-[10px] text-sky-400 bg-sky-950/70 border border-sky-800/30 px-1 py-0.2 rounded shrink-0">
                                      {dev.individual_address}
                                    </span>
                                    <span className="truncate text-[11px] group-hover:text-slate-200">
                                      {dev.name}
                                    </span>
                                    {dev.position ? (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          onPlaceDevice?.(dev.id)
                                        }}
                                        className="text-[8px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-1 py-0.2 rounded ml-auto hover:bg-emerald-800/60"
                                        title="Auf aktuellem Canvas platzieren / fokussieren"
                                      >
                                        ✓
                                      </button>
                                    ) : (
                                      onPlaceDevice && (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            onPlaceDevice(dev.id)
                                          }}
                                          className="text-[9px] font-mono text-sky-400 bg-sky-950/80 border border-sky-800/50 hover:bg-sky-800/80 px-1.5 py-0.2 rounded ml-auto transition-colors font-medium"
                                          title="Auf aktuellem Canvas platzieren"
                                        >
                                          + Canvas
                                        </button>
                                      )
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Unassigned Devices */}
            {(() => {
              const unassigned = project?.devices?.filter((d) => !d.room_id) || []
              if (unassigned.length === 0) return null

              return (
                <div className="pt-2 border-t border-slate-800/60 space-y-1">
                  <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-slate-400 font-semibold">
                    <Cpu className="w-3.5 h-3.5 text-amber-400" />
                    <span>Ohne Raumzuordnung</span>
                    <span className="text-[10px] bg-amber-950/60 text-amber-400 border border-amber-800/40 px-1.5 py-0.2 rounded font-mono ml-auto">
                      {unassigned.length}
                    </span>
                  </div>
                  <div className="pl-4 pr-1 py-0.5 space-y-0.5 border-l border-slate-800/70 ml-3.5">
                    {unassigned.map((dev) => (
                      <div
                        key={dev.id}
                        draggable={true}
                        onDragStart={(e) => {
                          e.dataTransfer.setData(
                            'application/knx-device',
                            JSON.stringify({ deviceId: dev.id })
                          )
                          e.dataTransfer.setData('text/plain', `knx-device:${dev.id}`)
                          e.dataTransfer.effectAllowed = 'copy'
                        }}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (onSelectDevice) onSelectDevice(dev.id)
                        }}
                        className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-slate-400 hover:text-amber-300 hover:bg-slate-800/70 cursor-grab active:cursor-grabbing transition-colors group select-none"
                        title={`${dev.individual_address} - ${dev.name} (Auf Canvas ziehen oder per '+ Canvas' platzieren)`}
                      >
                        <span className="font-mono text-[10px] text-amber-400 bg-amber-950/70 border border-amber-800/30 px-1 py-0.2 rounded shrink-0">
                          {dev.individual_address}
                        </span>
                        <span className="truncate text-[11px] group-hover:text-slate-200">
                          {dev.name}
                        </span>
                        {dev.position ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              onPlaceDevice?.(dev.id)
                            }}
                            className="text-[8px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-1 py-0.2 rounded ml-auto hover:bg-emerald-800/60"
                            title="Auf aktuellem Canvas platzieren / fokussieren"
                          >
                            ✓
                          </button>
                        ) : (
                          onPlaceDevice && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                onPlaceDevice(dev.id)
                              }}
                              className="text-[9px] font-mono text-amber-400 bg-amber-950/80 border border-amber-800/50 hover:bg-amber-800/80 px-1.5 py-0.2 rounded ml-auto transition-colors font-medium"
                              title="Auf aktuellem Canvas platzieren"
                            >
                              + Canvas
                            </button>
                          )
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}
          </div>
        )}

        {/* TAB 2: BAUSTEINE (Funktionsbausteine Bibliothek) */}
        {activeTab === 'blocks' && (
          <div className="space-y-3">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-1">
              Funktionsbausteine
            </div>
            <div className="text-xs text-slate-400 px-1">
              Klicke auf einen Baustein, um ihn im Canvas zu platzieren. Auto-GAs werden sofort generiert.
            </div>

            <div className="space-y-2 pt-1">
              {/* Lichtsteuerung */}
              <button
                draggable={true}
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/knx-block', 'LightController')
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => onAddBlock('LightController')}
                className="w-full flex items-start gap-3 p-2.5 rounded-xl border border-slate-800 bg-slate-950/40 hover:bg-slate-800/60 hover:border-amber-500/50 text-left transition-all group cursor-grab active:cursor-grabbing"
                title="Klicken oder auf den Canvas ziehen"
              >
                <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400 group-hover:scale-110 transition-transform">
                  <Lightbulb className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-200 group-hover:text-amber-400">
                    Lichtsteuerung
                  </div>
                  <div className="text-[11px] text-slate-400 leading-tight mt-0.5">
                    Schalten, Dimmen, Helligkeitswert & Status
                  </div>
                  <div className="text-[10px] text-amber-500/80 font-mono mt-1 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> Auto-GA: 5 Adressen
                  </div>
                </div>
              </button>

              {/* Automatikjalousie */}
              <button
                draggable={true}
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/knx-block', 'BlindController')
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => onAddBlock('BlindController')}
                className="w-full flex items-start gap-3 p-2.5 rounded-xl border border-slate-800 bg-slate-950/40 hover:bg-slate-800/60 hover:border-teal-500/50 text-left transition-all group cursor-grab active:cursor-grabbing"
                title="Klicken oder auf den Canvas ziehen"
              >
                <div className="p-2 rounded-lg bg-teal-500/20 text-teal-400 group-hover:scale-110 transition-transform">
                  <Sun className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-200 group-hover:text-teal-400">
                    Automatikjalousie
                  </div>
                  <div className="text-[11px] text-slate-400 leading-tight mt-0.5">
                    Auf/Ab, Lamelle, Position 0-100%
                  </div>
                  <div className="text-[10px] text-teal-500/80 font-mono mt-1 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> Auto-GA: 5 Adressen
                  </div>
                </div>
              </button>

              {/* Einzelraumregelung */}
              <button
                draggable={true}
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/knx-block', 'ClimateController')
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => onAddBlock('ClimateController')}
                className="w-full flex items-start gap-3 p-2.5 rounded-xl border border-slate-800 bg-slate-950/40 hover:bg-slate-800/60 hover:border-orange-500/50 text-left transition-all group cursor-grab active:cursor-grabbing"
                title="Klicken oder auf den Canvas ziehen"
              >
                <div className="p-2 rounded-lg bg-orange-500/20 text-orange-400 group-hover:scale-110 transition-transform">
                  <Flame className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-200 group-hover:text-orange-400">
                    Einzelraumregelung
                  </div>
                  <div className="text-[11px] text-slate-400 leading-tight mt-0.5">
                    Ist-/Solltemperatur, PWM-Ventil & HVAC
                  </div>
                  <div className="text-[10px] text-orange-500/80 font-mono mt-1 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> Auto-GA: 4 Adressen
                  </div>
                </div>
              </button>

              {/* Szenensteuerung */}
              <button
                draggable={true}
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/knx-block', 'SceneController')
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => onAddBlock('SceneController')}
                className="w-full flex items-start gap-3 p-2.5 rounded-xl border border-slate-800 bg-slate-950/40 hover:bg-slate-800/60 hover:border-purple-500/50 text-left transition-all group cursor-grab active:cursor-grabbing"
                title="Klicken oder auf den Canvas ziehen"
              >
                <div className="p-2 rounded-lg bg-purple-500/20 text-purple-400 group-hover:scale-110 transition-transform">
                  <Palette className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-200 group-hover:text-purple-400">
                    Lichtszenen & Mischpult
                  </div>
                  <div className="text-[11px] text-slate-400 leading-tight mt-0.5">
                    Lichtstimmungen, Studio-Fader & KNX DPT 18.001
                  </div>
                  <div className="text-[10px] text-purple-500/80 font-mono mt-1 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> Auto-GA: DPT 18.001 / 1.001
                  </div>
                </div>
              </button>

              {/* Treppenlichtzeitschalter */}
              <button
                draggable={true}
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/knx-block', 'StaircaseTimer')
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => onAddBlock('StaircaseTimer')}
                className="w-full flex items-start gap-3 p-2.5 rounded-xl border border-slate-800 bg-slate-950/40 hover:bg-slate-800/60 hover:border-yellow-500/50 text-left transition-all group cursor-grab active:cursor-grabbing"
                title="Klicken oder auf den Canvas ziehen"
              >
                <div className="p-2 rounded-lg bg-yellow-500/20 text-yellow-400 group-hover:scale-110 transition-transform">
                  <Timer className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-200 group-hover:text-yellow-400">
                    Treppenlichtzeitschalter
                  </div>
                  <div className="text-[11px] text-slate-400 leading-tight mt-0.5">
                    Einstellbare Nachlaufzeit & Vorwarnung
                  </div>
                  <div className="text-[10px] text-yellow-500/80 font-mono mt-1 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> Auto-GA: 2 Adressen
                  </div>
                </div>
              </button>

              {/* Logikgatter */}
              <button
                draggable={true}
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/knx-block', 'LogicGate')
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => onAddBlock('LogicGate')}
                className="w-full flex items-start gap-3 p-2.5 rounded-xl border border-slate-800 bg-slate-950/40 hover:bg-slate-800/60 hover:border-pink-500/50 text-left transition-all group cursor-grab active:cursor-grabbing"
                title="Klicken oder auf den Canvas ziehen"
              >
                <div className="p-2 rounded-lg bg-pink-500/20 text-pink-400 group-hover:scale-110 transition-transform">
                  <Binary className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-200 group-hover:text-pink-400">
                    Logikgatter
                  </div>
                  <div className="text-[11px] text-slate-400 leading-tight mt-0.5">
                    UND / ODER / XOR / NICHT Verknüpfung
                  </div>
                  <div className="text-[10px] text-pink-500/80 font-mono mt-1 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> Auto-GA: 1 Adresse
                  </div>
                </div>
              </button>

              {/* Astro & Sonnenschutz (Bresser Wetterstation) */}
              <button
                draggable={true}
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/knx-block', 'AstroSunProtection')
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => onAddBlock('AstroSunProtection')}
                className="w-full flex items-start gap-3 p-2.5 rounded-xl border border-slate-800 bg-slate-950/40 hover:bg-slate-800/60 hover:border-amber-500/50 text-left transition-all group cursor-grab active:cursor-grabbing"
                title="Klicken oder auf den Canvas ziehen"
              >
                <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400 group-hover:scale-110 transition-transform">
                  <Compass className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-200 group-hover:text-amber-400">
                    Astro & Sonnenschutz
                  </div>
                  <div className="text-[11px] text-slate-400 leading-tight mt-0.5">
                    Sonnenstand, Windalarm & Wetterstation
                  </div>
                  <div className="text-[10px] text-amber-500/80 font-mono mt-1 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> Bresser Wetter-Integration
                  </div>
                </div>
              </button>

              {/* Zeitschaltuhr (Wochenplan) */}
              <button
                draggable={true}
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/knx-block', 'TimerScheduler')
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => onAddBlock('TimerScheduler')}
                className="w-full flex items-start gap-3 p-2.5 rounded-xl border border-slate-800 bg-slate-950/40 hover:bg-slate-800/60 hover:border-teal-500/50 text-left transition-all group cursor-grab active:cursor-grabbing"
                title="Klicken oder auf den Canvas ziehen"
              >
                <div className="p-2 rounded-lg bg-teal-500/20 text-teal-400 group-hover:scale-110 transition-transform">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-200 group-hover:text-teal-400">
                    Zeitschaltuhr (Wochenplan)
                  </div>
                  <div className="text-[11px] text-slate-400 leading-tight mt-0.5">
                    Schaltfenster, Wochentage (Mo-So)
                  </div>
                  <div className="text-[10px] text-teal-500/80 font-mono mt-1 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> Auto-GA: DPT 1.001
                  </div>
                </div>
              </button>

              {/* Schwellwertschalter (Hysterese) */}
              <button
                draggable={true}
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/knx-block', 'ThresholdSwitch')
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => onAddBlock('ThresholdSwitch')}
                className="w-full flex items-start gap-3 p-2.5 rounded-xl border border-slate-800 bg-slate-950/40 hover:bg-slate-800/60 hover:border-orange-500/50 text-left transition-all group cursor-grab active:cursor-grabbing"
                title="Klicken oder auf den Canvas ziehen"
              >
                <div className="p-2 rounded-lg bg-orange-500/20 text-orange-400 group-hover:scale-110 transition-transform">
                  <Sliders className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-200 group-hover:text-orange-400">
                    Schwellwertschalter
                  </div>
                  <div className="text-[11px] text-slate-400 leading-tight mt-0.5">
                    Hysterese für Temp, Wind, Helligkeit
                  </div>
                  <div className="text-[10px] text-orange-500/80 font-mono mt-1 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> Auto-GA: DPT 1.001
                  </div>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* TAB 3: GERÄTE (KNX Aktoren & Sensoren) */}
        {activeTab === 'devices' && (
          <div className="space-y-3">
            {/* Action button to add KNX hardware device */}
            <button
              onClick={onOpenAddDeviceModal}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/30 rounded-lg text-xs font-medium transition-all shadow-sm group"
            >
              <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform duration-200" />
              <span>+ Neues KNX-Gerät hinzufügen</span>
            </button>

            <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 uppercase tracking-wider px-1 pt-1">
              <span>KNX Geräte-Pool</span>
              <span className="font-mono text-[10px] text-sky-400">
                {project?.devices.length ?? 0} Geräte
              </span>
            </div>
            <div className="text-xs text-slate-400 px-1">
              Gerät oder Kanal auf den Canvas ziehen zum visuellen Verdrahten.
            </div>

            <div className="space-y-3">
              {project?.devices.map((device) => (
                <div
                  key={device.id}
                  draggable={true}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(
                      'application/knx-device',
                      JSON.stringify({ deviceId: device.id })
                    )
                    e.dataTransfer.setData('text/plain', `knx-device:${device.id}`)
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  className="rounded-xl border border-slate-800 bg-slate-950/40 hover:border-sky-500/40 p-2.5 space-y-2 transition-all cursor-grab active:cursor-grabbing group/card select-none"
                  title="Gerät auf den Canvas ziehen oder per '+ Canvas' platzieren"
                >
                  <div
                    className="flex items-center justify-between cursor-pointer group/dev"
                    onClick={() => onSelectDevice?.(device.id)}
                    title="Klicken, um Geräteeigenschaften anzuzeigen"
                  >
                    <div>
                      <div className="text-xs font-semibold text-slate-200 group-hover/dev:text-sky-400 transition-colors">
                        {device.name}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {device.model} ({device.manufacturer})
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {device.position ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            onPlaceDevice?.(device.id)
                          }}
                          className="text-[9px] font-mono bg-emerald-950/80 text-emerald-400 border border-emerald-800/50 hover:bg-emerald-800/80 px-2 py-0.5 rounded transition-colors"
                          title="Auf aktuellem Canvas platzieren / fokussieren"
                        >
                          ✓ Canvas
                        </button>
                      ) : (
                        onPlaceDevice && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              onPlaceDevice(device.id)
                            }}
                            className="text-[9px] font-mono bg-sky-950/80 text-sky-400 border border-sky-800/50 hover:bg-sky-800/80 px-2 py-0.5 rounded transition-colors font-semibold flex items-center gap-1 shadow-sm"
                            title="Als Block auf aktuellem Canvas platzieren"
                          >
                            <Plus className="w-2.5 h-2.5" /> Canvas
                          </button>
                        )
                      )}
                      <span className="text-[10px] font-mono bg-slate-800 text-sky-400 px-1.5 py-0.5 rounded border border-slate-700">
                        {device.individual_address}
                      </span>
                      {onDeleteDevice && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (
                              window.confirm(
                                `Gerät "${device.name}" (${device.individual_address}) und alle zugehörigen Klemmen/Verbindungen wirklich löschen?`
                              )
                            ) {
                              onDeleteDevice(device.id)
                            }
                          }}
                          className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          title="Gerät löschen"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1 pt-1 border-t border-slate-800/80">
                    {device.channels.map((ch) => {
                      const isPlaced = ch.position != null
                      const room = project.rooms.find((r) => r.id === ch.room_id)

                      return (
                        <div
                          key={ch.id}
                          draggable={true}
                          onDragStart={(e) => {
                            e.stopPropagation()
                            e.dataTransfer.setData(
                              'application/knx-channel',
                              JSON.stringify({ channelId: ch.id, deviceId: device.id })
                            )
                            e.dataTransfer.setData('text/plain', `knx-channel:${device.id}:${ch.id}`)
                            e.dataTransfer.effectAllowed = 'copy'
                          }}
                          onClick={() => onAddChannelNode(ch.id, device.id)}
                          className={`w-full flex items-center justify-between p-1.5 rounded transition-all cursor-grab active:cursor-grabbing ${
                            isPlaced
                              ? 'bg-slate-800/40 text-slate-300 hover:bg-slate-800/80'
                              : 'hover:bg-slate-800 text-slate-400 hover:text-slate-200'
                          }`}
                          title={
                            isPlaced
                              ? `Bereits auf Canvas platziert${room ? ` (${room.name})` : ''}. Klicken zum Fokussieren.`
                              : 'Klicken oder auf Canvas ziehen zum Platzieren'
                          }
                        >
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <span className="font-mono text-[11px] text-emerald-400 shrink-0">
                              {ch.channel_code}:
                            </span>
                            <span className="text-slate-300 truncate text-[11px]">
                              {ch.name}
                            </span>
                          </div>

                          <div className="flex items-center gap-1 shrink-0 ml-1.5">
                            {isPlaced ? (
                              <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800/50 flex items-center gap-0.5">
                                ✓ Platziert
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="p-0.5 rounded hover:bg-emerald-500/20 text-slate-500 hover:text-emerald-400"
                                title="Auf Canvas platzieren"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
