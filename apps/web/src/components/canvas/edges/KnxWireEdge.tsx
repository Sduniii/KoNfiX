import React, { useState, useRef, useCallback, useEffect, memo } from 'react'
import {
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

const getWireColor = (dpt?: string, isHovered?: boolean, isSelected?: boolean) => {
  if (isSelected) return '#fbbf24' // Markiert / Ausgewählt: Warmgold / Bernstein
  if (isHovered) return '#ffffff'  // Hover: Reines Neon-Weiß mit maximalem Kontrast
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
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleMouseEnter = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }
    setIsHovered(true)
  }, [])

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
    }
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovered(false)
      hoverTimeoutRef.current = null
    }, 120) // 120ms Grace-Period für nahtlosen Übergang zwischen Linie und Badge
  }, [])

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
      }
    }
  }, [])

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
  const strokeColor = getWireColor(dpt, isHovered, selected)

  return (
    <>
      {/* Gruppierte SVG-Elemente mit gemeinsamem Hover-Management */}
      <g
        className="knx-wire-group cursor-pointer"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* Unsichtbarer breiterer Klick-/Hover-Pfad (24px) für komfortables Treffen */}
        <path
          d={edgePath}
          fill="none"
          stroke="transparent"
          strokeWidth={24}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="cursor-pointer"
        />

        {/* Haupt-Leitungspfad: Reine Style-Transition (Geometrie 'd' aktualisiert latenzfrei mit 0ms) */}
        <path
          d={edgePath}
          fill="none"
          markerEnd={markerEnd}
          className="react-flow__edge-path pointer-events-none"
          style={{
            ...style,
            stroke: strokeColor,
            strokeWidth: selected ? 3.5 : isHovered ? 3 : 2,
            strokeDasharray: animated ? '6 6' : undefined,
            filter: selected
              ? 'drop-shadow(0 0 6px rgba(251, 191, 36, 0.9))'
              : isHovered
              ? 'drop-shadow(0 0 7px rgba(255, 255, 255, 0.95))'
              : undefined,
            transition: 'stroke 0.15s ease, stroke-width 0.15s ease, filter 0.15s ease',
          }}
        />

        {/* n8n-Style Signal-Puls: Glühender Wanderimpuls bei aktiver Telegramm-Übertragung */}
        {animated && (
          <path
            d={edgePath}
            fill="none"
            stroke={selected ? '#fde68a' : isHovered ? '#ffffff' : '#38bdf8'}
            strokeWidth={3}
            strokeDasharray="8 24"
            strokeLinecap="round"
            className="pointer-events-none animate-pulse"
          />
        )}
      </g>

      {/* Kompaktes GA-Badge: Äußeres Div folgt Position mit 0ms Latenz, Inneres Div zoomt weich */}
      {gaAddress && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate3d(${labelX}px,${labelY}px, 0)`,
              transformOrigin: 'center center',
              pointerEvents: 'all',
            }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            className="nodrag nopan"
          >
            <div
              style={{
                transform: isHighlighted ? 'scale(1.22)' : 'scale(1)',
                transformOrigin: 'center center',
                transition: 'transform 0.15s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.15s ease, border-color 0.15s ease',
              }}
              className={`relative flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-mono border select-none ${
                selected
                  ? 'bg-slate-900 text-amber-200 border-amber-400 shadow-md shadow-amber-500/30 ring-2 ring-amber-400/50 z-30'
                  : isHovered
                  ? 'bg-slate-900 text-white border-white shadow-md shadow-white/40 ring-2 ring-white/60 z-20'
                  : 'bg-slate-900/95 text-slate-300 border-slate-700/80 shadow-sm shadow-black/40 z-10'
              }`}
              title={`KNX GA ${gaAddress}${gaName ? ` (${gaName})` : ''}${dpt ? ` [${dpt}]` : ''} - [Del]`}
            >
              {/* Schwebendes Namens-Label oberhalb, ohne den Bezeichner zu verschieben */}
              {isHighlighted && gaName && (
                <div
                  className={`absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap px-1.5 py-0.2 rounded bg-slate-900/95 border text-[9px] font-sans shadow-md shadow-black/60 pointer-events-none select-none ${
                    selected
                      ? 'border-amber-700/60 text-amber-200'
                      : 'border-slate-500 text-white shadow-white/20'
                  }`}
                >
                  {gaName}
                </div>
              )}

              {/* Ortsfester GA-Bezeichner */}
              <span
                className={`font-bold px-1 py-0.2 rounded border transition-colors ${
                  selected
                    ? 'text-amber-300 bg-amber-950/80 border-amber-700/50'
                    : isHovered
                    ? 'text-white bg-slate-800 border-white/60'
                    : 'text-sky-400 bg-sky-950/80 border-sky-800/40'
                }`}
              >
                {gaAddress}
              </span>

              {/* Schneller Lösch-Button als Corner-Pin oben rechts – belässt Bezeichner exakt im Zentrum */}
              {isHighlighted && onDelete && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    onDelete(id)
                  }}
                  title={t('nodes.wire.deleteTooltip')}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full flex items-center justify-center bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-950 transition-transform active:scale-90 cursor-pointer"
                >
                  <X className="w-2.5 h-2.5 stroke-[2.5]" />
                </button>
              )}
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export const KnxWireEdge = memo(KnxWireEdgeComponent)

