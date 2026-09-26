import React, { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { MapPin, ExternalLink, ArrowRight, ArrowLeft } from 'lucide-react'

export interface RoomPortalData {
  portalId: string
  direction: 'in' | 'out' // 'in' = signal from other room into here; 'out' = signal from here to other room
  targetRoomId: string
  targetRoomName: string
  targetDeviceId?: string
  targetDeviceName?: string
  targetIndividualAddress?: string
  targetChannelId?: string
  targetChannelName?: string
  targetPinName?: string
  gaAddress?: string
  gaName?: string
  dpt?: string
  isSimulating?: boolean
  onNavigateToRoom?: (roomId: string, targetNodeId?: string) => void
}

interface RoomPortalNodeProps {
  id: string
  data: RoomPortalData
  selected?: boolean
}

export const RoomPortalNodeComponent: React.FC<RoomPortalNodeProps> = ({ id, data, selected }) => {
  const {
    direction,
    targetRoomId,
    targetRoomName,
    targetDeviceId,
    targetDeviceName,
    targetIndividualAddress,
    targetChannelName,
    targetPinName,
    gaAddress,
    gaName,
    dpt,
    onNavigateToRoom,
  } = data

  const isIncoming = direction === 'in'

  return (
    <div
      className={`group relative min-w-[210px] max-w-[280px] rounded-xl border-2 bg-slate-900 shadow-md shadow-black/50 transition-all select-none ${
        selected
          ? 'border-indigo-400 ring-2 ring-indigo-400/50 shadow-indigo-500/20'
          : isIncoming
          ? 'border-sky-500/70 hover:border-sky-400'
          : 'border-purple-500/70 hover:border-purple-400'
      }`}
    >
      {/* Input Handle (if direction is out, wire connects here on the left) */}
      {!isIncoming && (
        <Handle
          type="target"
          position={Position.Left}
          id="in"
          className="!w-3 !h-3 !border-2 !border-slate-900 !bg-purple-400 hover:!bg-purple-300 transition-colors"
        />
      )}

      {/* Portal Header Pill */}
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-slate-800/80 bg-slate-800/50 rounded-t-lg">
        <div className="flex items-center gap-1.5 min-w-0">
          <div
            className={`p-1 rounded-md shrink-0 ${
              isIncoming ? 'bg-sky-500/20 text-sky-400' : 'bg-purple-500/20 text-purple-400'
            }`}
          >
            {isIncoming ? <ArrowRight className="w-3.5 h-3.5" /> : <ExternalLink className="w-3.5 h-3.5" />}
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 truncate">
            {isIncoming ? 'Aus Raum' : 'Nach Raum'}
          </span>
        </div>

        {/* Jump-Button to Room */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onNavigateToRoom?.(targetRoomId, targetDeviceId || targetChannelName)
          }}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/80 hover:border-indigo-500/60 transition-all cursor-pointer ml-1.5"
          title={`Zu Raum '${targetRoomName}' springen`}
        >
          <MapPin className="w-2.5 h-2.5 text-rose-400 shrink-0" />
          <span className="truncate max-w-[85px]">{targetRoomName}</span>
          <ExternalLink className="w-2.5 h-2.5 text-slate-400 group-hover:text-indigo-300 ml-0.5 shrink-0" />
        </button>
      </div>

      {/* Body: Target Device & Channel */}
      <div className="p-2.5 flex flex-col gap-1.5">
        <div className="flex items-start justify-between gap-1.5">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-slate-100 truncate" title={targetDeviceName || 'Externes Gerät'}>
              {targetDeviceName || 'Externes Gerät'}
            </div>
            {(targetChannelName || targetPinName) && (
              <div className="text-[11px] text-slate-300 font-medium truncate flex items-center gap-1 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                <span className="truncate">{targetChannelName || targetPinName}</span>
              </div>
            )}
          </div>
          {targetIndividualAddress && (
            <span className="text-[9px] font-mono bg-slate-950 text-slate-300 border border-slate-700 px-1 py-0.5 rounded shrink-0">
              {targetIndividualAddress}
            </span>
          )}
        </div>

        {/* GA Info Pill */}
        {gaAddress && (
          <div className="flex items-center justify-between text-[10px] bg-slate-950/80 px-2 py-1 rounded border border-slate-800/80 font-mono">
            <span className="text-amber-400 font-bold">{gaAddress}</span>
            <span className="text-slate-400 truncate max-w-[110px] text-[9px] font-sans">
              {gaName || dpt || 'KNX Signal'}
            </span>
          </div>
        )}
      </div>

      {/* Output Handle (if direction is in, wire connects from here to local block on the right) */}
      {isIncoming && (
        <Handle
          type="source"
          position={Position.Right}
          id="out"
          className="!w-3 !h-3 !border-2 !border-slate-900 !bg-sky-400 hover:!bg-sky-300 transition-colors"
        />
      )}
    </div>
  )
}

export const RoomPortalNode = memo(RoomPortalNodeComponent)
