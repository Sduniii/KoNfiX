import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import {
  CadWall,
  CadOpening,
  CadOpeningType,
  FloorCadModel,
  FloorPlanWidget,
  Position,
  KnxTelegram,
} from '../../types/knx'
import {
  Lightbulb,
  ArrowUpDown,
  Thermometer,
  Zap,
  Sliders,
  Plus,
  Trash2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Move,
  CornerDownRight,
  Shield,
  Layers,
} from 'lucide-react'

export type CadTool = 'select' | 'wall_outer' | 'wall_inner' | 'door' | 'window' | 'widget'

interface CadCanvasProps {
  cadModel: FloorCadModel
  widgets: FloorPlanWidget[]
  backgroundImage?: string | null
  backgroundOpacity?: number | null
  isEditMode: boolean
  activeTool: CadTool
  scale: number // px per meter (e.g. 40)
  onUpdateCadModel: (model: FloorCadModel) => void
  onUpdateWidgets: (widgets: FloorPlanWidget[]) => void
  onSelectWidget?: (widget: FloorPlanWidget) => void
  onTriggerGa?: (ga: string, value: any, dpt?: string) => void
  latestTelegrams?: KnxTelegram[]
}

export const CadCanvas: React.FC<CadCanvasProps> = ({
  cadModel,
  widgets,
  backgroundImage,
  backgroundOpacity = 0.4,
  isEditMode,
  activeTool,
  scale = 40,
  onUpdateCadModel,
  onUpdateWidgets,
  onSelectWidget,
  onTriggerGa,
  latestTelegrams = [],
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  // Zoom & Pan Viewport State
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 100, y: 100 })
  const [isPanning, setIsPanning] = useState(false)
  const [startPan, setStartPan] = useState({ x: 0, y: 0 })

  // Interactive Drawing State
  const [drawingWallStart, setDrawingWallStart] = useState<Position | null>(null)
  const [currentCursorPos, setCurrentCursorPos] = useState<Position>({ x: 0, y: 0 })
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null)
  const [selectedOpeningId, setSelectedOpeningId] = useState<string | null>(null)
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null)
  const [isOrthoSnap, setIsOrthoSnap] = useState(true)

  // Cache live GA values from telegrams
  const gaLiveValues = useMemo(() => {
    const map = new Map<string, string>()
    latestTelegrams.forEach((t) => {
      map.set(t.destination, t.value_formatted)
    })
    return map
  }, [latestTelegrams])

  // Convert screen mouse coordinates to CAD world coordinates (in meters)
  const screenToWorld = useCallback(
    (clientX: number, clientY: number): Position => {
      if (!svgRef.current) return { x: 0, y: 0 }
      const rect = svgRef.current.getBoundingClientRect()
      const pxX = (clientX - rect.left - pan.x) / zoom
      const pxY = (clientY - rect.top - pan.y) / zoom
      return {
        x: Math.round((pxX / scale) * 20) / 20, // 0.05m (5cm) raster
        y: Math.round((pxY / scale) * 20) / 20,
      }
    },
    [pan, zoom, scale]
  )

  // Snap to nearest wall vertex
  const snapToVertex = useCallback(
    (pos: Position, snapRadiusMeters = 0.35): Position => {
      let nearest = pos
      let minDist = snapRadiusMeters

      cadModel.walls.forEach((w) => {
        const d1 = Math.hypot(w.x1 - pos.x, w.y1 - pos.y)
        if (d1 < minDist) {
          minDist = d1
          nearest = { x: w.x1, y: w.y1 }
        }
        const d2 = Math.hypot(w.x2 - pos.x, w.y2 - pos.y)
        if (d2 < minDist) {
          minDist = d2
          nearest = { x: w.x2, y: w.y2 }
        }
      })
      return nearest
    },
    [cadModel.walls]
  )

  // Apply 90-degree orthogonal constraint
  const applyOrtho = useCallback((start: Position, current: Position): Position => {
    const dx = Math.abs(current.x - start.x)
    const dy = Math.abs(current.y - start.y)
    if (dx >= dy) {
      return { x: current.x, y: start.y }
    } else {
      return { x: start.x, y: current.y }
    }
  }, [])

  // Mouse Down handler
  const handleMouseDown = (e: React.MouseEvent) => {
    // Pan with Middle Click or Alt/Space
    if (e.button === 1 || e.altKey || (!isEditMode && e.button === 0 && e.target === svgRef.current)) {
      setIsPanning(true)
      setStartPan({ x: e.clientX - pan.x, y: e.clientY - pan.y })
      return
    }

    if (e.button !== 0 || !isEditMode) return

    let worldPos = screenToWorld(e.clientX, e.clientY)
    worldPos = snapToVertex(worldPos)

    if (activeTool === 'wall_outer' || activeTool === 'wall_inner') {
      if (!drawingWallStart) {
        // Start wall
        setDrawingWallStart(worldPos)
      } else {
        // End wall
        let endPos = worldPos
        if (isOrthoSnap || e.shiftKey) {
          endPos = applyOrtho(drawingWallStart, endPos)
        }
        endPos = snapToVertex(endPos)

        const length = Math.hypot(endPos.x - drawingWallStart.x, endPos.y - drawingWallStart.y)
        if (length > 0.2) {
          const newWall: CadWall = {
            id: crypto.randomUUID(),
            x1: drawingWallStart.x,
            y1: drawingWallStart.y,
            x2: endPos.x,
            y2: endPos.y,
            thickness: activeTool === 'wall_outer' ? 0.24 : 0.12,
            is_outer: activeTool === 'wall_outer',
          }
          onUpdateCadModel({
            ...cadModel,
            walls: [...cadModel.walls, newWall],
          })
          // Chain to next wall from endpoint
          setDrawingWallStart(endPos)
        }
      }
    } else if (activeTool === 'select') {
      setDrawingWallStart(null)
      setSelectedWallId(null)
      setSelectedOpeningId(null)
      setSelectedWidgetId(null)
    }
  }

  // Mouse Move handler
  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({ x: e.clientX - startPan.x, y: e.clientY - startPan.y })
      return
    }

    let worldPos = screenToWorld(e.clientX, e.clientY)
    if (drawingWallStart && (isOrthoSnap || e.shiftKey)) {
      worldPos = applyOrtho(drawingWallStart, worldPos)
    }
    worldPos = snapToVertex(worldPos)
    setCurrentCursorPos(worldPos)
  }

  const handleMouseUp = () => {
    setIsPanning(false)
  }

  // Right-click or Escape cancels current drawing chain
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setDrawingWallStart(null)
  }

  // Keyboard navigation & deletion
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawingWallStart(null)
        setSelectedWallId(null)
        setSelectedOpeningId(null)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedWallId) {
          onUpdateCadModel({
            ...cadModel,
            walls: cadModel.walls.filter((w) => w.id !== selectedWallId),
            openings: cadModel.openings.filter((o) => o.wall_id !== selectedWallId),
          })
          setSelectedWallId(null)
        } else if (selectedOpeningId) {
          onUpdateCadModel({
            ...cadModel,
            openings: cadModel.openings.filter((o) => o.id !== selectedOpeningId),
          })
          setSelectedOpeningId(null)
        } else if (selectedWidgetId) {
          onUpdateWidgets(widgets.filter((w) => w.id !== selectedWidgetId))
          setSelectedWidgetId(null)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedWallId, selectedOpeningId, selectedWidgetId, cadModel, widgets, onUpdateCadModel, onUpdateWidgets])

  // Click on a wall to place door or window
  const handleWallClick = (wall: CadWall, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isEditMode) return

    if (activeTool === 'door' || activeTool === 'window') {
      const clickPos = screenToWorld(e.clientX, e.clientY)
      // Project click onto wall line
      const dx = wall.x2 - wall.x1
      const dy = wall.y2 - wall.y1
      const wallLen = Math.hypot(dx, dy)
      if (wallLen < 0.5) return

      const t = Math.max(0.1, Math.min(0.9, ((clickPos.x - wall.x1) * dx + (clickPos.y - wall.y1) * dy) / (wallLen * wallLen)))

      const newOpening: CadOpening = {
        id: crypto.randomUUID(),
        wall_id: wall.id,
        opening_type: activeTool === 'door' ? 'Door' : 'Window',
        position: t,
        width: activeTool === 'door' ? 0.9 : 1.2,
        flip: false,
      }

      onUpdateCadModel({
        ...cadModel,
        openings: [...cadModel.openings, newOpening],
      })
    } else if (activeTool === 'select') {
      setSelectedWallId(wall.id)
      setSelectedOpeningId(null)
      setSelectedWidgetId(null)
    }
  }

  // Handle widget toggle in live mode
  const handleWidgetClick = (widget: FloorPlanWidget, e: React.MouseEvent) => {
    e.stopPropagation()
    if (isEditMode) {
      setSelectedWidgetId(widget.id)
      onSelectWidget?.(widget)
      return
    }

    if (widget.widget_type === 'Light' && widget.ga_switch) {
      const currentState = gaLiveValues.get(widget.ga_state || widget.ga_switch)
      const nextVal = currentState === '1' || currentState === 'true' || currentState === 'On' ? 0 : 1
      onTriggerGa?.(widget.ga_switch, nextVal, '1.001')
    } else if (widget.widget_type === 'Blind' && widget.ga_switch) {
      // Toggle Blind Up/Down
      onTriggerGa?.(widget.ga_switch, 1, '1.008')
    }
  }

  // Calculate Wall Polygon (outer thickness)
  const getWallPolygon = (wall: CadWall) => {
    const dx = wall.x2 - wall.x1
    const dy = wall.y2 - wall.y1
    const len = Math.hypot(dx, dy)
    if (len === 0) return ''

    const halfThick = wall.thickness / 2
    const nx = (-dy / len) * halfThick
    const ny = (dx / len) * halfThick

    const p1 = `${(wall.x1 + nx) * scale},${(wall.y1 + ny) * scale}`
    const p2 = `${(wall.x2 + nx) * scale},${(wall.y2 + ny) * scale}`
    const p3 = `${(wall.x2 - nx) * scale},${(wall.y2 - ny) * scale}`
    const p4 = `${(wall.x1 - nx) * scale},${(wall.y1 - ny) * scale}`

    return `${p1} ${p2} ${p3} ${p4}`
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-slate-950 overflow-hidden select-none cursor-default"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onContextMenu={handleContextMenu}
    >
      {/* Zoom / Pan Controls Floating Toolbar */}
      <div className="absolute bottom-4 right-4 z-20 flex items-center gap-1.5 p-1 bg-slate-900/90 border border-slate-800 rounded-xl shadow-xl backdrop-blur">
        <button
          onClick={() => setZoom((z) => Math.min(z * 1.25, 4))}
          className="p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          title="Vergrößern (+)"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={() => setZoom((z) => Math.max(z * 0.8, 0.25))}
          className="p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          title="Verkleinern (-)"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={() => {
            setZoom(1)
            setPan({ x: 100, y: 100 })
          }}
          className="p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          title="Ansicht zurücksetzen"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
        <div className="h-4 w-[1px] bg-slate-800 mx-1" />
        <span className="text-[11px] font-mono text-slate-400 px-2">
          {Math.round(zoom * 100)}%
        </span>
      </div>

      {/* Primary SVG Canvas */}
      <svg
        ref={svgRef}
        className="w-full h-full"
        style={{
          cursor: isPanning
            ? 'grabbing'
            : activeTool.startsWith('wall')
            ? 'crosshair'
            : activeTool === 'door' || activeTool === 'window'
            ? 'cell'
            : 'default',
        }}
      >
        <defs>
          {/* Blueprint Grid Pattern */}
          <pattern id="cadGridSmall" width={scale * 0.5 * zoom} height={scale * 0.5 * zoom} patternUnits="userSpaceOnUse">
            <path d={`M ${scale * 0.5 * zoom} 0 L 0 0 0 ${scale * 0.5 * zoom}`} fill="none" stroke="#1e293b" strokeWidth="0.5" />
          </pattern>
          <pattern id="cadGridMajor" width={scale * 2 * zoom} height={scale * 2 * zoom} patternUnits="userSpaceOnUse">
            <rect width={scale * 2 * zoom} height={scale * 2 * zoom} fill="url(#cadGridSmall)" />
            <path d={`M ${scale * 2 * zoom} 0 L 0 0 0 ${scale * 2 * zoom}`} fill="none" stroke="#334155" strokeWidth="1" />
          </pattern>
        </defs>

        {/* Scaled & Panned Scene Group */}
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* Blueprint Grid Background */}
          <rect x={-5000} y={-5000} width={10000} height={10000} fill="url(#cadGridMajor)" />

          {/* Optional Trace Blueprint Image */}
          {backgroundImage && (
            <image
              href={backgroundImage}
              x={0}
              y={0}
              width={20 * scale}
              height={15 * scale}
              opacity={backgroundOpacity ?? 0.4}
              className="pointer-events-none select-none"
            />
          )}

          {/* 1. RENDER WALLS */}
          {cadModel.walls.map((wall) => {
            const isSelected = selectedWallId === wall.id
            const polyPoints = getWallPolygon(wall)
            const lengthMeters = Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1)
            const midX = ((wall.x1 + wall.x2) / 2) * scale
            const midY = ((wall.y1 + wall.y2) / 2) * scale

            return (
              <g
                key={wall.id}
                onClick={(e) => handleWallClick(wall, e)}
                className="cursor-pointer group"
              >
                {/* Wall Body Solid */}
                <polygon
                  points={polyPoints}
                  fill={wall.is_outer ? '#0f172a' : '#1e293b'}
                  stroke={isSelected ? '#38bdf8' : wall.is_outer ? '#475569' : '#334155'}
                  strokeWidth={isSelected ? 2 : 1}
                  className="transition-colors group-hover:stroke-sky-400"
                />

                {/* Wall Centerline Axis */}
                <line
                  x1={wall.x1 * scale}
                  y1={wall.y1 * scale}
                  x2={wall.x2 * scale}
                  y2={wall.y2 * scale}
                  stroke="#64748b"
                  strokeWidth={0.5}
                  strokeDasharray="4 2"
                  opacity={0.4}
                />

                {/* Dimension label in edit mode */}
                {isEditMode && lengthMeters > 0.8 && (
                  <text
                    x={midX}
                    y={midY - 4}
                    fill="#94a3b8"
                    fontSize={10}
                    fontFamily="monospace"
                    textAnchor="middle"
                    className="pointer-events-none select-none font-semibold bg-slate-900 px-1"
                  >
                    {lengthMeters.toFixed(2)}m
                  </text>
                )}
              </g>
            )
          })}

          {/* 2. RENDER OPENINGS (DOORS & WINDOWS) */}
          {cadModel.openings.map((opening) => {
            const wall = cadModel.walls.find((w) => w.id === opening.wall_id)
            if (!wall) return null

            const isSelected = selectedOpeningId === opening.id
            const dx = wall.x2 - wall.x1
            const dy = wall.y2 - wall.y1
            const wallLen = Math.hypot(dx, dy)
            const ux = dx / wallLen
            const uy = dy / wallLen
            const nx = -uy
            const ny = ux

            const posX = (wall.x1 + dx * opening.position) * scale
            const posY = (wall.y1 + dy * opening.position) * scale
            const widthPx = opening.width * scale

            return (
              <g
                key={opening.id}
                onClick={(e) => {
                  e.stopPropagation()
                  if (isEditMode) {
                    setSelectedOpeningId(opening.id)
                    setSelectedWallId(null)
                  }
                }}
                className="cursor-pointer"
              >
                {/* Wall Opening Cutout (Masks wall solid) */}
                <rect
                  x={posX - widthPx / 2}
                  y={posY - (wall.thickness * scale) / 2}
                  width={widthPx}
                  height={wall.thickness * scale}
                  fill="#020617"
                  stroke={isSelected ? '#38bdf8' : '#0284c7'}
                  strokeWidth={1}
                />

                {opening.opening_type === 'Door' ? (
                  // Architectural Door Symbol (Leaf + 90deg Arc)
                  <g transform={`translate(${posX - widthPx / 2}, ${posY})`}>
                    <line
                      x1={0}
                      y1={0}
                      x2={0}
                      y2={-widthPx}
                      stroke={isSelected ? '#38bdf8' : '#38bdf8'}
                      strokeWidth={2}
                    />
                    <path
                      d={`M 0 ${-widthPx} A ${widthPx} ${widthPx} 0 0 1 ${widthPx} 0`}
                      fill="none"
                      stroke="#0284c7"
                      strokeWidth={1}
                      strokeDasharray="2 2"
                    />
                  </g>
                ) : (
                  // Architectural Window Symbol (3 parallel glass panes)
                  <g>
                    <line
                      x1={posX - widthPx / 2}
                      y1={posY}
                      x2={posX + widthPx / 2}
                      y2={posY}
                      stroke="#38bdf8"
                      strokeWidth={2}
                    />
                    <line
                      x1={posX - widthPx / 2}
                      y1={posY - 2}
                      x2={posX + widthPx / 2}
                      y2={posY - 2}
                      stroke="#94a3b8"
                      strokeWidth={1}
                    />
                    <line
                      x1={posX - widthPx / 2}
                      y1={posY + 2}
                      x2={posX + widthPx / 2}
                      y2={posY + 2}
                      stroke="#94a3b8"
                      strokeWidth={1}
                    />
                  </g>
                )}
              </g>
            )
          })}

          {/* 3. ACTIVE DRAWING WALL PREVIEW */}
          {drawingWallStart && (
            <g className="pointer-events-none">
              <line
                x1={drawingWallStart.x * scale}
                y1={drawingWallStart.y * scale}
                x2={currentCursorPos.x * scale}
                y2={currentCursorPos.y * scale}
                stroke="#38bdf8"
                strokeWidth={activeTool === 'wall_outer' ? 0.24 * scale : 0.12 * scale}
                strokeLinecap="round"
                opacity={0.8}
              />
              {/* Length indicator label */}
              {(() => {
                const len = Math.hypot(
                  currentCursorPos.x - drawingWallStart.x,
                  currentCursorPos.y - drawingWallStart.y
                )
                const midX = ((drawingWallStart.x + currentCursorPos.x) / 2) * scale
                const midY = ((drawingWallStart.y + currentCursorPos.y) / 2) * scale
                return (
                  <text
                    x={midX}
                    y={midY - 8}
                    fill="#38bdf8"
                    fontSize={11}
                    fontFamily="monospace"
                    textAnchor="middle"
                    className="font-bold"
                  >
                    {len.toFixed(2)}m
                  </text>
                )
              })()}
            </g>
          )}

          {/* 4. RENDER KNX WIDGETS (LIGHTS, BLINDS, CLIMATE) */}
          {widgets.map((w) => {
            const isSelected = selectedWidgetId === w.id
            const posX = w.x * scale
            const posY = w.y * scale
            const liveVal = gaLiveValues.get(w.ga_state || w.ga_switch || '')
            const isLightOn = liveVal === '1' || liveVal === 'true' || liveVal === 'On'

            return (
              <g
                key={w.id}
                transform={`translate(${posX}, ${posY})`}
                onClick={(e) => handleWidgetClick(w, e)}
                className="cursor-pointer group"
              >
                {/* Outer Glow Halo for Active Lights */}
                {w.widget_type === 'Light' && isLightOn && (
                  <circle
                    r={24}
                    fill="#eab308"
                    opacity={0.25}
                    className="animate-pulse pointer-events-none"
                  />
                )}

                {/* Widget Icon Circle */}
                <circle
                  r={14}
                  fill={
                    isSelected
                      ? '#0284c7'
                      : w.widget_type === 'Light' && isLightOn
                      ? '#eab308'
                      : '#0f172a'
                  }
                  stroke={
                    isSelected
                      ? '#38bdf8'
                      : w.widget_type === 'Light' && isLightOn
                      ? '#fef08a'
                      : '#334155'
                  }
                  strokeWidth={isSelected ? 2.5 : 1.5}
                  className="transition-all shadow-md group-hover:scale-110"
                />

                {/* Embedded SVG Icons */}
                {w.widget_type === 'Light' && (
                  <g transform="translate(-7, -7)">
                    <path
                      d="M7 1v2M7 11v2M2.76 2.76l1.41 1.41M9.83 9.83l1.41 1.41M1 7h2M11 7h2M2.76 11.24l1.41-1.41M9.83 4.17l1.41-1.41"
                      stroke={isLightOn ? '#0f172a' : '#94a3b8'}
                      strokeWidth="1.2"
                      strokeLinecap="round"
                    />
                    <circle
                      cx="7"
                      cy="7"
                      r="3.5"
                      fill={isLightOn ? '#facc15' : 'none'}
                      stroke={isLightOn ? '#0f172a' : '#94a3b8'}
                      strokeWidth="1.2"
                    />
                  </g>
                )}

                {w.widget_type === 'Blind' && (
                  <g transform="translate(-6, -6)">
                    <path
                      d="M2 2h8M2 6h8M2 10h8M6 2v8"
                      stroke="#38bdf8"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </g>
                )}

                {w.widget_type === 'Climate' && (
                  <g transform="translate(-5, -7)">
                    <path
                      d="M5 2a2 2 0 0 0-2 2v5a3 3 0 1 0 4 0V4a2 2 0 0 0-2-2z"
                      fill="#f97316"
                      opacity="0.8"
                    />
                  </g>
                )}

                {/* Title badge below icon */}
                <text
                  y={22}
                  fill="#cbd5e1"
                  fontSize={10}
                  fontFamily="sans-serif"
                  textAnchor="middle"
                  className="font-semibold pointer-events-none select-none drop-shadow"
                >
                  {w.title}
                </text>

                {/* Live Value Subtitle (e.g. 21.5 °C or 80%) */}
                {liveVal && (
                  <text
                    y={32}
                    fill="#38bdf8"
                    fontSize={9}
                    fontFamily="monospace"
                    textAnchor="middle"
                    className="font-bold pointer-events-none select-none"
                  >
                    {liveVal}
                  </text>
                )}
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}
