import React, { useState, memo } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  EdgeProps,
  getSmoothStepPath,
} from '@xyflow/react'
import { X } from 'lucide-react'
import { useTranslation } from '../../../i18n'

export interface KnxWireEdgeData {
  gaAddress?: string
  gaName?: string
  dpt?: string
  onDelete?: (edgeId: string) => void
  [key: string]: unknown
}

const getWireColor = (dpt?: string, isHighlighted?: boolean) => {
  if (isHighlighted) return '#38bdf8'
  if (!dpt) return '#0284c7'
  if (dpt.startsWith('1.')) return '#10b981' // Bool / Schalten: Smaragdgrün
  if (dpt.startsWith('3.') || dpt.startsWith('5.')) return '#f59e0b' // Dimmen / Position: Bernstein
  if (dpt.startsWith('9.')) return '#ec4899' // Float / Temperatur / Lux: Rose
  if (dpt.startsWith('17.') || dpt.startsWith('18.')) return '#a855f7' // Szene: Violett
  return '#0284c7'
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
  const { t } = useTranslation()
  const [isHovered, setIsHovered] = useState(false)

  // Professionelles orthogonales SmoothStep-Routing mit abgerundeten Ecken
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetPosition,
    targetX,
    targetY,
    borderRadius: 12,
    offset: 20,
  })

  const edgeData = data as KnxWireEdgeData | undefined
  const gaAddress = edgeData?.gaAddress
  const gaName = edgeData?.gaName
  const dpt = edgeData?.dpt
  const onDelete = edgeData?.onDelete

  const isHighlighted = selected || isHovered
  const strokeColor = getWireColor(dpt, isHighlighted)

  return (
    <>
      {/* Unsichtbarer breiterer Klick-/Hover-Pfad (24px) für einfaches Anklicken */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={24}
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
          stroke: isHighlighted ? '#38bdf8' : (style.stroke || strokeColor),
          strokeWidth: isHighlighted ? 3 : 2,
          strokeDasharray: animated ? '6 6' : undefined,
          filter: isHighlighted ? 'drop-shadow(0 0 5px rgba(56, 189, 248, 0.8))' : undefined,
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
            title={`KNX GA ${gaAddress}${gaName ? ` (${gaName})` : ''} - [Del]`}
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
                title={t('nodes.wire.deleteTooltip')}
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
