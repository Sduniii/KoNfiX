import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Room, Floor, FunctionBlock } from '../../types/knx'
import { useTranslation } from '../../i18n/I18nContext'
import {
  Layers,
  Plus,
  Home,
  Sofa,
  Utensils,
  Bed,
  Bath,
  DoorClosed,
  Warehouse,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'

interface RoomTabBarProps {
  rooms: Room[]
  floors: Floor[]
  blocks: FunctionBlock[]
  selectedRoomId: string | null
  onSelectRoom: (roomId: string | null) => void
  onAddRoom?: (name: string, floorId: string) => void
}

const getRoomIcon = (iconName: string) => {
  switch (iconName?.toLowerCase()) {
    case 'sofa':
      return <Sofa className="w-3.5 h-3.5" />
    case 'utensils':
      return <Utensils className="w-3.5 h-3.5" />
    case 'bed':
      return <Bed className="w-3.5 h-3.5" />
    case 'bath':
      return <Bath className="w-3.5 h-3.5" />
    case 'door':
      return <DoorClosed className="w-3.5 h-3.5" />
    case 'warehouse':
      return <Warehouse className="w-3.5 h-3.5" />
    default:
      return <Home className="w-3.5 h-3.5" />
  }
}

export const RoomTabBar: React.FC<RoomTabBarProps> = ({
  rooms,
  floors,
  blocks,
  selectedRoomId,
  onSelectRoom,
  onAddRoom,
}) => {
  const { t } = useTranslation()
  const [isAdding, setIsAdding] = useState(false)
  const [newRoomName, setNewRoomName] = useState('')
  const [selectedFloorId, setSelectedFloorId] = useState<string>(
    floors[0]?.id || ''
  )

  const tabsRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const checkScroll = useCallback(() => {
    if (tabsRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = tabsRef.current
      setCanScrollLeft(scrollLeft > 4)
      setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 4)
    }
  }, [])

  useEffect(() => {
    checkScroll()
    const timer = setTimeout(checkScroll, 150)
    window.addEventListener('resize', checkScroll)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', checkScroll)
    }
  }, [rooms, checkScroll])

  const handleWheel = (e: React.WheelEvent) => {
    if (tabsRef.current && e.deltaY !== 0) {
      tabsRef.current.scrollLeft += e.deltaY * 0.9
      checkScroll()
    }
  }

  const scrollTabs = (offset: number) => {
    if (tabsRef.current) {
      tabsRef.current.scrollBy({ left: offset, behavior: 'smooth' })
      setTimeout(checkScroll, 250)
    }
  }

  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newRoomName.trim()) return
    const floorId = selectedFloorId || floors[0]?.id
    if (floorId) {
      onAddRoom?.(newRoomName.trim(), floorId)
      setNewRoomName('')
      setIsAdding(false)
    }
  }

  // Count central / global blocks
  const centralBlocksCount = blocks.filter((b) => !b.room_id).length

  return (
    <div
      onWheel={handleWheel}
      className="h-10 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between px-2 gap-1.5 select-none shrink-0 z-10 overflow-hidden"
    >
      {/* Scroll Left Button */}
      {canScrollLeft && (
        <button
          type="button"
          onClick={() => scrollTabs(-200)}
          className="p-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 shadow-sm shrink-0 transition-colors z-20"
          title="Räume nach links scrollen"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Scrollable Tabs */}
      <div
        ref={tabsRef}
        onScroll={checkScroll}
        className="flex-1 flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-none"
      >
        {/* Tab 1: Global / Central Page */}
        <button
          onClick={() => onSelectRoom(null)}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all shrink-0 ${
            selectedRoomId === null
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm shadow-emerald-950/40'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
          }`}
          title={t('rooms.centralOverviewTooltip')}
        >
          <Layers className="w-3.5 h-3.5 text-emerald-400" />
          <span>{t('rooms.centralOverview')}</span>
          <span
            className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
              selectedRoomId === null
                ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/40'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            {blocks.length}
          </span>
        </button>

        <div className="w-px h-4 bg-slate-800 mx-1 shrink-0" />

        {/* Room Tabs */}
        {rooms.map((room) => {
          const isSelected = selectedRoomId === room.id
          const floor = floors.find((f) => f.id === room.floor_id)
          const roomBlockCount = blocks.filter((b) => b.room_id === room.id).length

          return (
            <button
              key={room.id}
              onClick={() => onSelectRoom(room.id)}
              className={`flex items-center gap-2 px-3 py-1 rounded-lg text-xs font-medium transition-all shrink-0 group ${
                isSelected
                  ? 'bg-slate-800 text-slate-100 border border-slate-700 shadow-sm shadow-black/40'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent'
              }`}
            >
              <span
                className={`${
                  isSelected
                    ? 'text-sky-400'
                    : 'text-slate-500 group-hover:text-slate-400'
                }`}
              >
                {getRoomIcon(room.icon)}
              </span>

              <span>{room.name}</span>

              {floor && (
                <span className="text-[9px] font-mono uppercase bg-slate-950/80 text-slate-500 px-1 py-0.2 rounded border border-slate-800">
                  {floor.name}
                </span>
              )}

              <span
                className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                  isSelected
                    ? 'bg-slate-900 text-sky-400 border border-slate-700/60'
                    : 'bg-slate-800 text-slate-500'
                }`}
              >
                {roomBlockCount}
              </span>
            </button>
          )
        })}
      </div>

      {/* Scroll Right Button */}
      {canScrollRight && (
        <button
          type="button"
          onClick={() => scrollTabs(200)}
          className="p-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 shadow-sm shrink-0 transition-colors z-20"
          title="Räume nach rechts scrollen"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Add Room Quick Trigger */}
      <div className="flex items-center gap-1 shrink-0 ml-auto">
        {isAdding ? (
          <form
            onSubmit={handleCreateRoom}
            className="flex items-center gap-1.5 bg-slate-950 border border-slate-700 px-2 py-0.5 rounded-lg text-xs animate-in fade-in zoom-in-95 duration-150"
          >
            <input
              type="text"
              autoFocus
              placeholder={t('rooms.newRoomPlaceholder')}
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
              className="bg-transparent text-slate-200 text-xs outline-none w-28 placeholder:text-slate-600"
            />
            {floors.length > 1 && (
              <select
                value={selectedFloorId}
                onChange={(e) => setSelectedFloorId(e.target.value)}
                className="bg-slate-900 text-slate-300 text-[10px] rounded px-1 py-0.5 border border-slate-800 outline-none"
              >
                {floors.map((fl) => (
                  <option key={fl.id} value={fl.id}>
                    {fl.name}
                  </option>
                ))}
              </select>
            )}
            <button
              type="submit"
              className="p-1 rounded text-emerald-400 hover:bg-emerald-500/20"
              title={t('common.confirm')}
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/20"
              title={t('common.cancel')}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </form>
        ) : (
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-slate-800/80 transition-colors"
            title={t('rooms.addRoomTooltip')}
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t('rooms.newRoom')}</span>
          </button>
        )}
      </div>
    </div>
  )
}
