import React, { useState, memo } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  EdgeProps,
  getBezierPath,
} from '@xyflow/react'
import { X } from 'lucide-react'

export interface KnxWireEdgeData {
  gaAddress?: string
  gaName?: string
  dpt?: string
  onDelete?: (edgeId: string) => void
  [key: string]: unknown
}

export const KnxWireEdgeComponent: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
  selected,
  animated,
}) => {
  const [isHovered, setIsHovered] = useState(false)

  // n8n-typische harmonische Bezier-Kurve mit definierter Krümmung
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetPosition,
    targetX,
    targetY,
    curvature: 0.38,
  })

  const edgeData = data as KnxWireEdgeData | undefined
  const gaAddress = edgeData?.gaAddress
  const gaName = edgeData?.gaName
  const dpt = edgeData?.dpt
  const onDelete = edgeData?.onDelete

  const isHighlighted = selected || isHovered

  return (
    <>
      {/* Unsichtbarer breiterer Klick-/Hover-Pfad für einfache Interaktion */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        className="cursor-pointer"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      />

      {/* Haupt-Leitungspfad */}
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: isHighlighted ? '#38bdf8' : (style.stroke || '#0284c7'),
          strokeWidth: isHighlighted ? 3 : 2,
          strokeDasharray: animated ? '6 6' : undefined,
          filter: isHighlighted ? 'drop-shadow(0 0 4px rgba(56, 189, 248, 0.7))' : undefined,
          transition: 'stroke 0.15s ease, stroke-width 0.15s ease',
        }}
      />

      {/* n8n-Style Signal-Puls: Glühender Wanderimpuls bei aktiver Telegramm-Übertragung */}
      {animated && (
        <path
          d={edgePath}
          fill="none"
          stroke="#7dd3fc"
          strokeWidth={3}
          strokeDasharray="8 24"
          strokeLinecap="round"
          className="pointer-events-none animate-pulse"
        />
      )}

      {/* Kompaktes, performantes GA-Badge in Leitungsmitte */}
      {gaAddress && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate3d(${labelX}px,${labelY}px, 0)`,
              pointerEvents: 'all',
              willChange: 'transform',
            }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className={`nodrag nopan flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-mono border transition-all select-none ${
              isHighlighted
                ? 'bg-slate-900 text-sky-200 border-sky-400 shadow-md shadow-sky-500/30 ring-1 ring-sky-400/50 scale-105 z-30'
                : 'bg-slate-900/95 text-slate-300 border-slate-700/80 hover:border-slate-500 shadow-sm shadow-black/40 z-10'
            }`}
            title={`KNX Gruppenadresse ${gaAddress}${gaName ? ` (${gaName})` : ''} - [Entf] drücken zum Löschen`}
          >
            <span className="font-bold text-sky-400 bg-sky-950/80 px-1 py-0.2 rounded border border-sky-800/40">
              {gaAddress}
            </span>

            {/* Zusätzliche Details erscheinen dezent bei Hover/Auswahl */}
            {isHighlighted && gaName && (
              <span className="text-slate-300 max-w-[85px] truncate font-sans text-[10px]">
                {gaName}
              </span>
            )}

            {isHighlighted && dpt && (
              <span className="text-slate-500 text-[9px] hidden sm:inline">
                {dpt}
              </span>
            )}

            {/* Schneller Lösch-Button nur bei Hover oder Selektion */}
            {isHighlighted && onDelete && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(id)
                }}
                title="Verbindung löschen"
                className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-rose-500 transition-colors ml-0.5 shrink-0"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export const KnxWireEdge = memo(KnxWireEdgeComponent)
