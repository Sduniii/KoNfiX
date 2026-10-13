import React, { useMemo, useCallback } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  Connection,
  Edge,
  Node,
  addEdge,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  useStore,
  ConnectionLineType,
} from '@xyflow/react'
import { Wand2, Maximize2, Grid3X3, Map as MapIcon, Zap } from 'lucide-react'
import { useTranslation } from '../../i18n/I18nContext'
import { Project, GroupAddress } from '../../types/knx'
import { LightBlockNode } from './nodes/LightBlockNode'
import { BlindBlockNode } from './nodes/BlindBlockNode'
import { ClimateBlockNode } from './nodes/ClimateBlockNode'
import { SceneBlockNode } from './nodes/SceneBlockNode'
import { StaircaseBlockNode } from './nodes/StaircaseBlockNode'
import { LogicBlockNode } from './nodes/LogicBlockNode'
import { AstroBlockNode } from './nodes/AstroBlockNode'
import { TimerBlockNode } from './nodes/TimerBlockNode'
import { ThresholdBlockNode } from './nodes/ThresholdBlockNode'
import { SwitchNode } from './nodes/SwitchNode'
import { ActuatorNode } from './nodes/ActuatorNode'
import { ChannelTerminalNode } from './nodes/ChannelTerminalNode'
import { KnxDeviceBlockNode } from './nodes/KnxDeviceBlockNode'
import { RoomPortalNode } from './nodes/RoomPortalNode'
import { KnxWireEdge } from './edges/KnxWireEdge'
import { FunctionBlock, FunctionBlockType, KnxDevice } from '../../types/knx'

interface FlowCanvasProps {
  project: Project
  selectedRoomId: string | null
  selectedBlockId: string | null
  isSimulating: boolean
  onToggleSimulate?: () => void
  onSelectBlock: (blockId: string | null) => void
  onBlockAction: (blockId: string, pin: string, value: any) => void
  onTriggerSwitch: (deviceId: string, channelId: string, channelCode: string) => void
  onUpdateNodePosition?: (id: string, x: number, y: number) => void
  onUpdateNodesPositions?: (positions: { id: string; x: number; y: number }[]) => void
  portalPositions?: Record<string, { x: number; y: number }>
  onPortalPositionsChange?: (positions: Record<string, { x: number; y: number }>) => void
  savedViewport?: { x: number; y: number; zoom: number }
  onViewportChange?: (viewport: { x: number; y: number; zoom: number }) => void
  onAddConnection?: (fromNode: string, fromPin: string, toNode: string, toPin: string, connId?: string) => void
  onDeleteBlock?: (blockId: string) => void
  onDeleteBlocks?: (blockIds: string[]) => void
  onDeleteConnection?: (connectionId: string) => void
  onDeleteConnections?: (connectionIds: string[]) => void
  onPlaceChannel?: (channelId: string, deviceId: string, position: { x: number; y: number }) => void
  onRemoveChannel?: (channelId: string) => void
  onPlaceDevice?: (deviceId: string, position: { x: number; y: number }) => void
  onRemoveDeviceFromCanvas?: (deviceId: string) => void
  onOpenDeviceSettings?: (device: KnxDevice) => void
  onUpdateDeviceVisibleKos?: (deviceId: string, koNumbers: number[]) => void
  onAddBlockAt?: (type: FunctionBlockType, position: { x: number; y: number }) => void
  onOpenMixer?: (block: FunctionBlock) => void
  onNavigateToRoom?: (roomId: string, targetNodeId?: string) => void
}

const nodeTypes = {
  lightBlock: LightBlockNode,
  blindBlock: BlindBlockNode,
  climateBlock: ClimateBlockNode,
  sceneBlock: SceneBlockNode,
  staircaseBlock: StaircaseBlockNode,
  logicBlock: LogicBlockNode,
  astroBlock: AstroBlockNode,
  timerBlock: TimerBlockNode,
  thresholdBlock: ThresholdBlockNode,
  switchNode: SwitchNode,
  actuatorNode: ActuatorNode,
  channelTerminal: ChannelTerminalNode,
  knxDevice: KnxDeviceBlockNode,
  roomPortal: RoomPortalNode,
}

const edgeTypes = {
  knxWire: KnxWireEdge,
}

/**
 * Dynamische Zoom- & Snap-Stufen mit vergrößertem, modernem Hintergrund-Punktraster:
 * - Zoom > 1.25 (Detail): Feiner 8px-Fang, 24px-Musterabstand (Dot 2.0px)
 * - Zoom 0.65 .. 1.25 (Standard): 16px-Fang, 32px-Musterabstand (Dot 2.5px) — großzügig & klar
 * - Zoom 0.35 .. 0.65 (Übersicht): 32px-Fang, 64px-Musterabstand (Dot 3.0px) — flimmerfrei
 * - Zoom < 0.35 (Vogelperspektive): 64px-Fang, 128px-Musterabstand (Dot 3.5px) — Makro-Orientierung
 */
const ZOOM_TIERS = [
  { snap: 8, gap: 24, dotSize: 2.0 },
  { snap: 16, gap: 32, dotSize: 2.5 },
  { snap: 32, gap: 64, dotSize: 3.0 },
  { snap: 64, gap: 128, dotSize: 3.5 },
] as const

const getTierIndex = (zoom: number): number => {
  if (zoom > 1.25) return 0
  if (zoom >= 0.65) return 1
  if (zoom >= 0.35) return 2
  return 3
}

/**
 * Reaktive Zoom- und Snap-Anzeige in der Canvas-Kopfzeile
 */
const CanvasZoomSnapIndicator: React.FC = React.memo(() => {
  const { t } = useTranslation()
  const zoom = useStore((state) => state.transform[2])
  const tierIndex = getTierIndex(zoom)
  const tier = ZOOM_TIERS[tierIndex]
  const zoomPct = Math.round(zoom * 100)

  return (
    <div
      className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-900/90 text-slate-300 border border-slate-800 shadow-lg shadow-black/60 select-none backdrop-blur whitespace-nowrap"
      title={`${t('canvas.gridPattern')}: ${tier.gap}px, ${t('canvas.snap')} ${tier.snap}px (${zoomPct}%)`}
    >
      <Grid3X3 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
      <span>
        <strong className="text-white font-mono">{tier.gap}px</strong> Raster
      </span>
      <span className="text-slate-600">·</span>
      <span className="text-slate-400 font-mono">Fang {tier.snap}px</span>
      <span className="text-slate-600">·</span>
      <span className="font-mono text-slate-300">{zoomPct}%</span>
    </div>
  )
})

const FlowCanvasInternal: React.FC<FlowCanvasProps> = ({
  project,
  selectedRoomId,
  selectedBlockId,
  isSimulating,
  onToggleSimulate,
  onSelectBlock,
  onBlockAction,
  onTriggerSwitch,
  onUpdateNodePosition,
  onUpdateNodesPositions,
  portalPositions: propPortalPositions,
  onPortalPositionsChange,
  savedViewport,
  onViewportChange,
  onAddConnection,
  onDeleteBlock,
  onDeleteBlocks,
  onDeleteConnection,
  onDeleteConnections,
  onPlaceChannel,
  onRemoveChannel,
  onPlaceDevice,
  onRemoveDeviceFromCanvas,
  onOpenDeviceSettings,
  onUpdateDeviceVisibleKos,
  onAddBlockAt,
  onOpenMixer,
  onNavigateToRoom,
}) => {
  const { t } = useTranslation()
  const [reactFlowInstance, setReactFlowInstance] = React.useState<any>(null)
  const [showMiniMap, setShowMiniMap] = React.useState<boolean>(false)

  // Zoom-abhängige dynamische Raster- & Fang-Stufe (re-rendert nur wenn Stufe wechselt!)
  const tierIndex = useStore((state) => getTierIndex(state.transform[2]))
  const tier = ZOOM_TIERS[tierIndex]
  const snapGrid = useMemo<[number, number]>(() => [tier.snap, tier.snap], [tier.snap])

  // Persistent portal positions (synced with parent view state and localStorage fallback)
  const [localPortalPositions, setLocalPortalPositions] = React.useState<Record<string, { x: number; y: number }>>(() => {
    try {
      const saved = localStorage.getItem(`konfix_portal_pos_${project?.name}`)
      return saved ? JSON.parse(saved) : {}
    } catch {
      return {}
    }
  })

  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(`konfix_portal_pos_${project?.name}`)
      if (saved) {
        setLocalPortalPositions(JSON.parse(saved))
      } else {
        setLocalPortalPositions({})
      }
    } catch {
      setLocalPortalPositions({})
    }
  }, [project?.name])

  const portalPositions = useMemo(() => {
    return propPortalPositions && Object.keys(propPortalPositions).length > 0
      ? propPortalPositions
      : localPortalPositions
  }, [propPortalPositions, localPortalPositions])

  const handleUpdatePortals = useCallback(
    (newPositions: Record<string, { x: number; y: number }>) => {
      setLocalPortalPositions(newPositions)
      try {
        localStorage.setItem(`konfix_portal_pos_${project?.name}`, JSON.stringify(newPositions))
      } catch {}
      onPortalPositionsChange?.(newPositions)
    },
    [project?.name, onPortalPositionsChange]
  )

  // Helper to resolve KNX Group Address for any connection or pin
  const getGaForConn = useCallback(
    (conn: { from_node_id: string; from_pin: string; to_node_id: string; to_pin: string }): GroupAddress | undefined => {
      // 0. Check if source is a physical device KO
      const parseKo = (pin: string) => {
        if (pin.startsWith('ko-')) return parseInt(pin.replace('ko-', ''), 10)
        const n = parseInt(pin, 10)
        return isNaN(n) ? null : n
      }

      const fromKoNum = parseKo(conn.from_pin)
      if (fromKoNum !== null) {
        const dev = project.devices.find((d) => d.id === conn.from_node_id)
        if (dev) {
          const ko = dev.communication_objects?.find((k) => k.number === fromKoNum)
          if (ko && ko.group_addresses && ko.group_addresses.length > 0) {
            const ga = project.group_addresses.find((g) => g.address === ko.group_addresses[0])
            if (ga) return ga
          }
          if (ko && ko.group_address_ids && ko.group_address_ids.length > 0) {
            const ga = project.group_addresses.find((g) => g.id === ko.group_address_ids[0])
            if (ga) return ga
          }
        }
      }

      // 0.1 Check if target is a physical device KO
      const toKoNum = parseKo(conn.to_pin)
      if (toKoNum !== null) {
        const dev = project.devices.find((d) => d.id === conn.to_node_id)
        if (dev) {
          const ko = dev.communication_objects?.find((k) => k.number === toKoNum)
          if (ko && ko.group_addresses && ko.group_addresses.length > 0) {
            const ga = project.group_addresses.find((g) => g.address === ko.group_addresses[0])
            if (ga) return ga
          }
          if (ko && ko.group_address_ids && ko.group_address_ids.length > 0) {
            const ga = project.group_addresses.find((g) => g.id === ko.group_address_ids[0])
            if (ga) return ga
          }
        }
      }

      // 1. Check if source is a block pin that originated a GA
      let ga = project.group_addresses.find(
        (g) => g.origin_block_id === conn.from_node_id && g.origin_pin_name === conn.from_pin
      )
      if (ga) return ga

      // 2. Check if target is a block with an associated GA
      const targetBlock = project.blocks.find((b) => b.id === conn.to_node_id)
      if (targetBlock) {
        if (conn.to_pin === 'up' || conn.to_pin === 'down') {
          ga = project.group_addresses.find(
            (g) => g.origin_block_id === targetBlock.id && g.origin_pin_name === 'move'
          )
        } else if (conn.to_pin === 't' || conn.to_pin === 'p') {
          ga = project.group_addresses.find(
            (g) => g.origin_block_id === targetBlock.id && g.origin_pin_name === 'sw'
          )
        } else if (conn.to_pin === 't_act') {
          ga = project.group_addresses.find(
            (g) => g.origin_block_id === targetBlock.id && g.origin_pin_name === 't_act'
          )
        } else if (conn.to_pin === 'trig') {
          ga = project.group_addresses.find(
            (g) =>
              g.origin_block_id === targetBlock.id &&
              (g.origin_pin_name === 'sw' || g.origin_pin_name === 'scene_ctrl')
          )
        } else {
          ga = project.group_addresses.find(
            (g) => g.origin_block_id === targetBlock.id && g.origin_pin_name === conn.to_pin
          )
        }
        if (ga) return ga

        const p = targetBlock.inputs.find((pin) => pin.id === conn.to_pin)
        if (p?.group_address_id) {
          ga = project.group_addresses.find((g) => g.id === p.group_address_id)
          if (ga) return ga
        }
      }

      // 3. Check if source is a block
      const sourceBlock = project.blocks.find((b) => b.id === conn.from_node_id)
      if (sourceBlock) {
        const p = sourceBlock.outputs.find((pin) => pin.id === conn.from_pin)
        if (p?.group_address_id) {
          ga = project.group_addresses.find((g) => g.id === p.group_address_id)
          if (ga) return ga
        }
      }

      return undefined
    },
    [project]
  )

  // Transform project.blocks, placed channels, and devices into ReactFlow Nodes
  const initialNodes: Node[] = useMemo(() => {
    const nodes: Node[] = []

    // 1. Function Block Nodes
    project.blocks
      .filter((b) => !selectedRoomId || b.room_id === selectedRoomId)
      .forEach((b, idx) => {
        let nodeType = 'lightBlock'
        if (b.block_type === 'BlindController') nodeType = 'blindBlock'
        if (b.block_type === 'ClimateController') nodeType = 'climateBlock'
        if (b.block_type === 'SceneController') nodeType = 'sceneBlock'
        if (b.block_type === 'StaircaseTimer') nodeType = 'staircaseBlock'
        if (b.block_type === 'LogicGate') nodeType = 'logicBlock'
        if (b.block_type === 'AstroSunProtection') nodeType = 'astroBlock'
        if (b.block_type === 'TimerScheduler') nodeType = 'timerBlock'
        if (b.block_type === 'ThresholdSwitch') nodeType = 'thresholdBlock'

        nodes.push({
          id: b.id,
          type: nodeType,
          position: {
            x: b.position?.x ?? 120 + (idx % 4) * 280,
            y: b.position?.y ?? 80 + Math.floor(idx / 4) * 220,
          },
          data: {
            block: b,
            groupAddresses: project.group_addresses,
            isSimulating,
            onAction: (pin: string, value: any) => onBlockAction(b.id, pin, value),
            onDelete: (blockId: string) => {
              onDeleteBlock?.(blockId)
            },
            onOpenMixer: (block: FunctionBlock) => onOpenMixer?.(block),
          },
          selected: selectedBlockId === b.id,
        })
      })

    // 2. Placed Hardware Channels (Compact ChannelTerminalNode)
    project.devices.forEach((dev) => {
      dev.channels.forEach((ch) => {
        if (!ch.position) return
        if (selectedRoomId && ch.room_id !== selectedRoomId) return

        // Resolve connection & GA for this terminal node
        const conn = project.connections.find(
          (c) =>
            c.from_node_id === ch.id ||
            c.to_node_id === ch.id ||
            (c.from_node_id === dev.id && (c.from_pin === `out-${ch.id}` || c.from_pin === 'out')) ||
            (c.to_node_id === dev.id && (c.to_pin === `in-${ch.id}` || c.to_pin === 'in'))
        )
        const ga = conn ? getGaForConn(conn) : undefined

        nodes.push({
          id: ch.id,
          type: 'channelTerminal',
          position: { x: ch.position?.x ?? 200, y: ch.position?.y ?? 200 },
          data: {
            channelId: ch.id,
            channelCode: ch.channel_code,
            channelName: ch.name,
            channelType: ch.channel_type,
            deviceAddress: dev.individual_address,
            deviceName: dev.name,
            manufacturer: dev.manufacturer,
            gaAddress: ga?.address,
            isSimulating,
            onTrigger: () => onTriggerSwitch(dev.id, ch.id, ch.channel_code),
            onDelete: () => onRemoveChannel?.(ch.id),
          },
          selected: selectedBlockId === ch.id,
        })
      })
    })

    // 3. Placed Physical KNX Devices (Blueprint Nodes)
    project.devices.forEach((dev) => {
      if (!dev.position) return
      if (selectedRoomId && dev.room_id && dev.room_id !== selectedRoomId) return

      nodes.push({
        id: dev.id,
        type: 'knxDevice',
        position: { x: dev.position?.x ?? 300, y: dev.position?.y ?? 300 },
        data: {
          device: dev,
          groupAddresses: project.group_addresses,
          isSimulating,
          onAction: (pin: string, value: any) => onBlockAction(dev.id, pin, value),
          onOpenSettings: (d: KnxDevice) => onOpenDeviceSettings?.(d),
          onRemove: (devId: string) => onRemoveDeviceFromCanvas?.(devId),
          onUpdateVisibleKos: (devId: string, koNumbers: number[]) =>
            onUpdateDeviceVisibleKos?.(devId, koNumbers),
        },
        selected: selectedBlockId === dev.id,
      })
    })

    // 4. Cross-Room Portals (for connections that link into or out of selectedRoomId)
    if (selectedRoomId) {
      const getEndpointRoomId = (nodeId: string, pin: string): string | null => {
        const blk = project.blocks.find((b) => b.id === nodeId)
        if (blk) return blk.room_id

        for (const dev of project.devices) {
          const ch = dev.channels.find((c) => c.id === nodeId)
          if (ch) return ch.room_id || dev.room_id || null
        }

        const dev = project.devices.find((d) => d.id === nodeId)
        if (dev) {
          if (pin.startsWith('out-') || pin.startsWith('in-')) {
            const chId = pin.replace(/^out-|^in-/, '')
            const ch = dev.channels.find((c) => c.id === chId || c.channel_code === chId)
            if (ch && ch.room_id) return ch.room_id
          }
          return dev.room_id || null
        }
        return null
      }

      const createdPortalKeys = new Set<string>()

      project.connections.forEach((conn) => {
        const sourceRoomId = getEndpointRoomId(conn.from_node_id, conn.from_pin)
        const targetRoomId = getEndpointRoomId(conn.to_node_id, conn.to_pin)

        // Case A: Outgoing connection (source in selected room, target in another room)
        if (sourceRoomId === selectedRoomId && targetRoomId && targetRoomId !== selectedRoomId) {
          const portalId = `portal-out-${conn.id}`
          if (!createdPortalKeys.has(portalId)) {
            createdPortalKeys.add(portalId)
            const targetRoomObj = project.rooms.find((r) => r.id === targetRoomId)
            const targetDev = project.devices.find(
              (d) => d.id === conn.to_node_id || d.channels.some((c) => c.id === conn.to_node_id)
            )
            const targetChannel = targetDev?.channels.find(
              (c) => c.id === conn.to_node_id || conn.to_pin.includes(c.id) || conn.to_pin.includes(c.channel_code)
            )
            const targetBlock = project.blocks.find((b) => b.id === conn.to_node_id)
            const ga = getGaForConn(conn)

            const defaultPos = { x: 920, y: 100 + nodes.length * 45 }
            const pos = portalPositions[portalId] || defaultPos

            nodes.push({
              id: portalId,
              type: 'roomPortal',
              position: pos,
              data: {
                portalId,
                direction: 'out',
                targetRoomId,
                targetRoomName: targetRoomObj?.name || 'Anderer Raum',
                targetDeviceId: targetDev?.id,
                targetDeviceName: targetDev?.name || targetBlock?.name || 'Externes Ziel',
                targetIndividualAddress: targetDev?.individual_address,
                targetChannelId: targetChannel?.id,
                targetChannelName: targetChannel ? `${targetChannel.name} (${targetChannel.channel_code})` : targetBlock?.name,
                targetPinName: conn.to_pin,
                gaAddress: ga?.address,
                gaName: ga?.name ? ga.name.split(' - ').pop() : undefined,
                dpt: ga?.dpt ? `DPT ${ga.dpt}` : undefined,
                isSimulating,
                onNavigateToRoom,
              },
            })
          }
        }

        // Case B: Incoming connection (source in another room, target in selected room)
        if (targetRoomId === selectedRoomId && sourceRoomId && sourceRoomId !== selectedRoomId) {
          const portalId = `portal-in-${conn.id}`
          if (!createdPortalKeys.has(portalId)) {
            createdPortalKeys.add(portalId)
            const sourceRoomObj = project.rooms.find((r) => r.id === sourceRoomId)
            const sourceDev = project.devices.find(
              (d) => d.id === conn.from_node_id || d.channels.some((c) => c.id === conn.from_node_id)
            )
            const sourceChannel = sourceDev?.channels.find(
              (c) => c.id === conn.from_node_id || conn.from_pin.includes(c.id) || conn.from_pin.includes(c.channel_code)
            )
            const sourceBlock = project.blocks.find((b) => b.id === conn.from_node_id)
            const ga = getGaForConn(conn)

            const defaultPos = { x: 80, y: 100 + nodes.length * 45 }
            const pos = portalPositions[portalId] || defaultPos

            nodes.push({
              id: portalId,
              type: 'roomPortal',
              position: pos,
              data: {
                portalId,
                direction: 'in',
                targetRoomId: sourceRoomId,
                targetRoomName: sourceRoomObj?.name || 'Anderer Raum',
                targetDeviceId: sourceDev?.id,
                targetDeviceName: sourceDev?.name || sourceBlock?.name || 'Externe Quelle',
                targetIndividualAddress: sourceDev?.individual_address,
                targetChannelId: sourceChannel?.id,
                targetChannelName: sourceChannel ? `${sourceChannel.name} (${sourceChannel.channel_code})` : sourceBlock?.name,
                targetPinName: conn.from_pin,
                gaAddress: ga?.address,
                gaName: ga?.name ? ga.name.split(' - ').pop() : undefined,
                dpt: ga?.dpt ? `DPT ${ga.dpt}` : undefined,
                isSimulating,
                onNavigateToRoom,
              },
            })
          }
        }
      })
    }

    return nodes
  }, [
    project,
    selectedRoomId,
    selectedBlockId,
    isSimulating,
    onBlockAction,
    onTriggerSwitch,
    onDeleteBlock,
    onRemoveChannel,
    onRemoveDeviceFromCanvas,
    onOpenDeviceSettings,
    onUpdateDeviceVisibleKos,
    getGaForConn,
    onNavigateToRoom,
    portalPositions,
  ])

  // Build edges from project.connections with Custom KnxWireEdge
  const initialEdges: Edge[] = useMemo(() => {
    return project.connections.flatMap((conn) => {
      let sourceId = conn.from_node_id
      let sourceHandle = conn.from_pin
      let targetId = conn.to_node_id
      let targetHandle = conn.to_pin

      // 1. Resolve source channel if needed
      if (!initialNodes.some((n) => n.id === sourceId)) {
        const dev = project.devices.find((d) => d.id === conn.from_node_id)
        if (dev) {
          if (conn.from_pin.startsWith('out-')) {
            const chId = conn.from_pin.replace('out-', '')
            if (initialNodes.some((n) => n.id === chId)) {
              sourceId = chId
              sourceHandle = 'out'
            }
          } else {
            const placed = dev.channels.find((ch) => initialNodes.some((n) => n.id === ch.id))
            if (placed) {
              sourceId = placed.id
              sourceHandle = 'out'
            }
          }
        }
      }

      // 2. Resolve target channel if needed
      if (!initialNodes.some((n) => n.id === targetId)) {
        const dev = project.devices.find((d) => d.id === conn.to_node_id)
        if (dev) {
          if (conn.to_pin.startsWith('in-')) {
            const chId = conn.to_pin.replace('in-', '')
            if (initialNodes.some((n) => n.id === chId)) {
              targetId = chId
              targetHandle = 'in'
            }
          } else {
            const placed = dev.channels.find((ch) => initialNodes.some((n) => n.id === ch.id))
            if (placed) {
              targetId = placed.id
              targetHandle = 'in'
            }
          }
        }
      }

      // 3. Resolve Cross-Room Portal redirection
      const outPortal = initialNodes.find((n) => n.id === `portal-out-${conn.id}`)
      if (outPortal) {
        targetId = outPortal.id
        targetHandle = 'in'
      }
      const inPortal = initialNodes.find((n) => n.id === `portal-in-${conn.id}`)
      if (inPortal) {
        sourceId = inPortal.id
        sourceHandle = 'out'
      }

      // Only render edge if both source and target nodes are present in the current canvas!
      const hasSource = initialNodes.some((n) => n.id === sourceId)
      const hasTarget = initialNodes.some((n) => n.id === targetId)
      if (!hasSource || !hasTarget) return []

      const ga = getGaForConn(conn)
      const suffixName = ga?.name ? ga.name.split(' - ').pop() : undefined

      return [
        {
          id: conn.id,
          type: 'knxWire',
          source: sourceId,
          sourceHandle: sourceHandle,
          target: targetId,
          targetHandle: targetHandle,
          animated: isSimulating,
          data: {
            gaAddress: ga?.address,
            gaName: suffixName,
            dpt: ga?.dpt ? `DPT ${ga.dpt}` : undefined,
            onDelete: (edgeId: string) => {
              onDeleteConnection?.(edgeId)
            },
          },
        },
      ]
    })
  }, [
    project.connections,
    project.devices,
    initialNodes,
    isSimulating,
    getGaForConn,
    onDeleteConnection,
  ])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  // Sync nodes and edges with selective memoized updates to avoid full canvas re-renders
  React.useEffect(() => {
    setNodes((currentNodes) => {
      if (currentNodes.length === 0) return initialNodes

      const currMap = new Map<string, Node>(currentNodes.map((n) => [n.id, n]))
      let hasStructuralChanges = false

      const nextNodes = initialNodes.map((initNode) => {
        const curr = currMap.get(initNode.id)
        if (!curr) {
          hasStructuralChanges = true
          return initNode
        }

        // If currently dragging, keep curr.position so dragging isn't interrupted.
        // Otherwise, sync with the authoritative initNode.position (or portal position).
        let nextPos = (curr as any).dragging ? curr.position : initNode.position
        if (initNode.id.startsWith('portal-') && portalPositions[initNode.id]) {
          nextPos = portalPositions[initNode.id]
        }

        const isSelected = selectedBlockId === initNode.id

        // Compare position, selection and data
        const posChanged = curr.position.x !== nextPos.x || curr.position.y !== nextPos.y
        const selChanged = curr.selected !== isSelected

        // Shallow comparison of data properties
        const currData = curr.data as Record<string, any>
        const initData = initNode.data as Record<string, any>
        const dataChanged =
          currData.isSimulating !== initData.isSimulating ||
          currData.block?.state !== initData.block?.state ||
          currData.groupAddresses !== initData.groupAddresses ||
          currData.device !== initData.device

        if (!posChanged && !selChanged && !dataChanged) {
          return curr // Reuse unchanged node reference!
        }

        hasStructuralChanges = true
        return {
          ...curr,
          position: nextPos,
          selected: isSelected,
          data: initNode.data,
        }
      })

      if (!hasStructuralChanges && nextNodes.length === currentNodes.length) {
        return currentNodes // Return unchanged state array -> zero re-renders!
      }
      return nextNodes
    })
  }, [initialNodes, portalPositions, selectedBlockId, setNodes])

  React.useEffect(() => {
    setEdges((currentEdges) => {
      if (currentEdges.length === 0) return initialEdges

      const currMap = new Map<string, Edge>(currentEdges.map((e) => [e.id, e]))
      let hasChanges = false

      const nextEdges = initialEdges.map((initEdge) => {
        const curr = currMap.get(initEdge.id)
        if (!curr) {
          hasChanges = true
          return initEdge
        }
        if (
          curr.source === initEdge.source &&
          curr.target === initEdge.target &&
          curr.animated === initEdge.animated &&
          (curr.data as any)?.gaAddress === (initEdge.data as any)?.gaAddress
        ) {
          return curr // Reuse unchanged edge reference!
        }
        hasChanges = true
        return initEdge
      })

      if (!hasChanges && nextEdges.length === currentEdges.length) {
        return currentEdges
      }
      return nextEdges
    })
  }, [initialEdges, setEdges])

  const savedViewportRef = React.useRef(savedViewport)
  savedViewportRef.current = savedViewport
  const currentRoomRef = React.useRef<string | null>(selectedRoomId)
  const initialViewportRestored = React.useRef(false)

  // Center & fit or restore view on room change
  React.useEffect(() => {
    if (!reactFlowInstance) return
    currentRoomRef.current = selectedRoomId

    const timer = setTimeout(() => {
      const vp = savedViewportRef.current
      if (vp && typeof vp.zoom === 'number') {
        reactFlowInstance.setViewport(vp, { duration: 250 })
      } else {
        reactFlowInstance.fitView({ padding: 0.25, duration: 250 })
      }
    }, 60)
    return () => clearTimeout(timer)
  }, [selectedRoomId, reactFlowInstance])

  // Restore saved viewport on initial mount as soon as savedViewport becomes available
  React.useEffect(() => {
    if (reactFlowInstance && savedViewport && !initialViewportRestored.current) {
      initialViewportRestored.current = true
      reactFlowInstance.setViewport(savedViewport, { duration: 250 })
    }
  }, [reactFlowInstance, savedViewport])

  // Interactive Pin-to-Pin connection
  const onConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target) return
      const connId = crypto.randomUUID()
      const newEdge: Edge = {
        id: connId,
        type: 'knxWire',
        source: params.source,
        sourceHandle: params.sourceHandle,
        target: params.target,
        targetHandle: params.targetHandle,
        animated: isSimulating,
      }
      setEdges((eds) => addEdge(newEdge, eds))
      onAddConnection?.(
        params.source,
        params.sourceHandle || '',
        params.target,
        params.targetHandle || '',
        connId
      )
    },
    [isSimulating, onAddConnection, setEdges]
  )

  // Dragging nodes (Blocks, Channels, Devices, and Portals!)
  const onNodeDragStop = useCallback(
    (_: any, node: Node) => {
      const rx = Math.round(node.position.x)
      const ry = Math.round(node.position.y)
      if (node.type === 'roomPortal' || node.id.startsWith('portal-')) {
        const next = { ...portalPositions, [node.id]: { x: rx, y: ry } }
        handleUpdatePortals(next)
        return
      }
      onUpdateNodePosition?.(node.id, rx, ry)
    },
    [portalPositions, handleUpdatePortals, onUpdateNodePosition]
  )

  // Handle deletions triggered by keyboard (Entf / Delete / Backspace)
  const handleNodesDelete = useCallback(
    (deletedNodes: Node[]) => {
      const blockIds = deletedNodes
        .map((n) => n.id)
        .filter((id) => project.blocks.some((b) => b.id === id))
      if (blockIds.length > 0) {
        onDeleteBlocks?.(blockIds)
      }

      // Also remove channel terminals or devices if deleted via keyboard
      deletedNodes.forEach((node) => {
        if (node.type === 'channelTerminal') {
          onRemoveChannel?.(node.id)
        } else if (node.type === 'knxDevice') {
          onRemoveDeviceFromCanvas?.(node.id)
        }
      })
    },
    [project.blocks, onDeleteBlocks, onRemoveChannel, onRemoveDeviceFromCanvas]
  )

  const handleEdgesDelete = useCallback(
    (deletedEdges: Edge[]) => {
      const edgeIds = deletedEdges.map((e) => e.id)
      if (edgeIds.length > 0) {
        onDeleteConnections?.(edgeIds)
      }
    },
    [onDeleteConnections]
  )

  // Drag & Drop onto Flow Canvas
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      event.stopPropagation()

      let position = { x: 280, y: 150 }
      if (reactFlowInstance) {
        try {
          position = reactFlowInstance.screenToFlowPosition({
            x: event.clientX,
            y: event.clientY,
          })
        } catch (err) {
          console.warn('screenToFlowPosition fallback:', err)
        }
      }

      // 1. Physical KNX device dropped from sidebar (handles custom MIME and text/plain fallback)
      let deviceId: string | null = null
      const deviceData = event.dataTransfer.getData('application/knx-device')
      if (deviceData) {
        try {
          const parsed = JSON.parse(deviceData)
          deviceId = parsed.deviceId || parsed.id || parsed
        } catch {
          deviceId = deviceData
        }
      }

      if (!deviceId) {
        const textPlain = event.dataTransfer.getData('text/plain') || event.dataTransfer.getData('text')
        if (textPlain) {
          if (textPlain.startsWith('knx-device:')) {
            deviceId = textPlain.replace('knx-device:', '').trim()
          } else if (project.devices.some((d) => d.id === textPlain.trim())) {
            deviceId = textPlain.trim()
          } else {
            try {
              const parsed = JSON.parse(textPlain)
              if (parsed?.deviceId) deviceId = parsed.deviceId
            } catch {}
          }
        }
      }

      if (deviceId) {
        onPlaceDevice?.(deviceId, position)
        return
      }

      // 2. Channel dropped from hardware pool
      let channelId: string | null = null
      let chDeviceId: string | null = null
      const channelData = event.dataTransfer.getData('application/knx-channel')
      if (channelData) {
        try {
          const parsed = JSON.parse(channelData)
          channelId = parsed.channelId
          chDeviceId = parsed.deviceId
        } catch {}
      }

      if (!channelId) {
        const textPlain = event.dataTransfer.getData('text/plain') || event.dataTransfer.getData('text')
        if (textPlain && textPlain.startsWith('knx-channel:')) {
          const parts = textPlain.replace('knx-channel:', '').split(':')
          chDeviceId = parts[0]
          channelId = parts[1]
        }
      }

      if (channelId && chDeviceId) {
        onPlaceChannel?.(channelId, chDeviceId, position)
        return
      }

      // 3. Function block dropped from sidebar
      let blockType = event.dataTransfer.getData('application/knx-block') as FunctionBlockType
      if (!blockType) {
        const textPlain = event.dataTransfer.getData('text/plain') || event.dataTransfer.getData('text')
        if (textPlain && textPlain.startsWith('knx-block:')) {
          blockType = textPlain.replace('knx-block:', '').trim() as FunctionBlockType
        }
      }
      if (blockType) {
        onAddBlockAt?.(blockType, position)
        return
      }
    },
    [reactFlowInstance, project.devices, onPlaceChannel, onPlaceDevice, onAddBlockAt]
  )

  // Auto-Layout: Intelligente hierarchische Signalfluss-Architektur mit topologischer Zeilenausrichtung
  // 1. Spaltenaufteilung (X-Achse):
  //    - Spalte 0 (Links): Bediengeräte / Taster / Sensoren / Portale (IN)
  //    - Spalte 1..k (Mitte): Verknüpfungsblöcke / Logik (Licht, Jalousie, Klima, Astro, etc.)
  //    - Spalte k+1 (Rechts): Aktoren / Ausgänge / Portale (OUT)
  // 2. Sortierung (Y-Achse):
  //    - Funktionale Gruppierung: Bediengeräte/Taster zuerst, dann Aktoren
  //    - Innerhalb der Kategorien numerisch nach physikalischer Adresse (1.1.1, 1.1.2, ...) aufsteigend
  // 3. Zeilenausrichtung:
  //    - Zusammenhängende Schaltungsketten und semantisch assoziierte Paare (über Name/GA)
  //      liegen auf gleicher Zeilenhöhe für horizontale Leitungen
  //    - Verbleibende freie Knoten ordnen sich kompakt in ihre jeweilige Funktionsspalte ein
  const handleAutoLayout = useCallback(() => {
    const updatedPositions: { id: string; x: number; y: number }[] = []
    const placedIds = new Set<string>()

    // Reale Nodes mit ggf. bereits vom Browser ermittelten Maßen (node.measured)
    const liveNodes = reactFlowInstance ? reactFlowInstance.getNodes() : nodes
    const nodeMap = new Map<string, Node>()
    nodes.forEach((n) => {
      const live = liveNodes.find((l: Node) => l.id === n.id)
      nodeMap.set(n.id, live || n)
    })

    // Exakte / sichere Breitenberechnung
    const getNodeWidth = (node: Node): number => {
      if (node.measured?.width && node.measured.width > 50) {
        return Math.ceil(node.measured.width)
      }
      if ((node as any).width && (node as any).width > 50) {
        return Math.ceil((node as any).width)
      }
      if (node.type === 'knxDevice') {
        const isCollapsed = (node.data as any)?.isCollapsed
        return isCollapsed ? 320 : 420
      }
      if (node.type === 'roomPortal') return 260
      if (node.type === 'channelTerminal') return 260
      if (node.type === 'sceneBlock' || node.type === 'astroBlock') return 340
      return 320
    }

    // Exakte / sichere Höhenberechnung
    const getNodeHeight = (node: Node): number => {
      if (node.measured?.height && node.measured.height > 40) {
        return Math.ceil(node.measured.height)
      }
      if ((node as any).height && (node as any).height > 40) {
        return Math.ceil((node as any).height)
      }

      if (node.type === 'roomPortal') return 110
      if (node.type === 'channelTerminal') return 145
      if (node.type === 'knxDevice') {
        const dev = (node.data as any)?.device as KnxDevice | undefined
        const isCollapsed = (node.data as any)?.isCollapsed
        if (isCollapsed) return 72

        const visibleKos = dev?.visible_ko_numbers || []
        const pinCount = visibleKos.length > 0
          ? visibleKos.length
          : dev?.communication_objects?.filter((k) => (k.group_addresses?.length || 0) > 0).length || 0

        if (pinCount === 0) return 180
        return 120 + pinCount * 42
      }

      if (node.type === 'astroBlock') return 440
      if (node.type === 'sceneBlock') return 400
      if (node.type === 'blindBlock') return 400
      if (node.type === 'climateBlock') return 360
      if (node.type === 'lightBlock') return 340
      if (node.type === 'timerBlock') return 340
      if (node.type === 'thresholdBlock') return 320
      if (node.type === 'logicBlock') return 290
      if (node.type === 'staircaseBlock') return 280

      return 300
    }

    // Präziser Handle Y-Offset bezogen auf die Oberkante des Knotens
    const getHandleRelativeY = (node: Node, handleId?: string | null, isSource?: boolean): number => {
      const h = getNodeHeight(node)
      if (!handleId) return h / 2

      if (node.type === 'knxDevice') {
        const dev = (node.data as any)?.device as KnxDevice | undefined
        const isCollapsed = (node.data as any)?.isCollapsed
        if (isCollapsed) return 36

        if (dev && handleId.startsWith('ko-')) {
          const koNum = parseInt(handleId.replace('ko-', ''), 10)
          const kos = dev.communication_objects || []
          const visibleNums = dev.visible_ko_numbers && dev.visible_ko_numbers.length > 0
            ? dev.visible_ko_numbers
            : kos.filter((k) => (k.group_addresses?.length || 0) > 0 || (k.group_address_ids?.length || 0) > 0).map((k) => k.number)

          const visibleKos = kos.filter((k) => visibleNums.includes(k.number))
          const inputKos = visibleKos.filter((k) => k.flags?.write || (!k.flags?.transmit && !k.flags?.write))
          const outputKos = visibleKos.filter((k) => k.flags?.transmit)

          const HEADER_H = 110
          const ROW_H = 38
          const SECTION_TITLE_H = 28

          // Input Pin Suche (linke Seite)
          if (!isSource || inputKos.some((k) => k.number === koNum)) {
            const idx = inputKos.findIndex((k) => k.number === koNum)
            if (idx !== -1) {
              return HEADER_H + SECTION_TITLE_H + idx * ROW_H + ROW_H / 2
            }
          }

          // Output Pin Suche (rechte Seite)
          const inputSectionH = inputKos.length > 0 ? (SECTION_TITLE_H + inputKos.length * ROW_H + 8) : 0
          const outIdx = outputKos.findIndex((k) => k.number === koNum)
          if (outIdx !== -1) {
            return HEADER_H + inputSectionH + SECTION_TITLE_H + outIdx * ROW_H + ROW_H / 2
          }
        }
      }

      return h / 2
    }

    // Numerischer Parser für physikalische KNX-Adressen (z.B. 1.1.1, 1.1.10)
    const parseIndividualAddress = (addr?: string): number => {
      if (!addr) return 999999
      const parts = addr.split('.').map((p) => parseInt(p, 10))
      if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
        return (parts[0] << 12) | (parts[1] << 8) | parts[2]
      }
      return 999999
    }

    // 5-Stufen Signalfluss-Klassifizierung:
    // 0: external_input  (AUS RAUM)
    // 1: local_sensor    (Taster, Sensor, Binäreingang, Präsenz im Raum)
    // 2: logic           (LightBlock, BlindBlock, LogicBlock, SceneBlock...)
    // 3: local_actuator  (Schaltaktor, Dimmaktor, Jalousieaktor lokal im Raum)
    // 4: external_output (NACH RAUM)
    type LayoutTier = 'external_input' | 'local_sensor' | 'logic' | 'local_actuator' | 'external_output'

    const getNodeTier = (node: Node): LayoutTier => {
      if (node.type === 'roomPortal') {
        const dir = (node.data as any)?.direction
        return dir === 'out' ? 'external_output' : 'external_input'
      }
      if (node.type === 'channelTerminal') {
        const t = (node.data as any)?.channelType
        if (t === 'PushButtonInput' || t === 'PresenceSensorInput') return 'local_sensor'
        return 'local_actuator'
      }
      if (node.type === 'knxDevice') {
        const dev = (node.data as any)?.device as KnxDevice | undefined
        const name = (dev?.name || '').toLowerCase()
        const model = (dev?.model || '').toLowerCase()
        const isSens =
          name.includes('taster') ||
          model.includes('taster') ||
          name.includes('sensor') ||
          name.includes('wetter') ||
          name.includes('präsenz') ||
          name.includes('bewegung') ||
          name.includes('binär') ||
          name.includes('interface')
        return isSens ? 'local_sensor' : 'local_actuator'
      }
      return 'logic'
    }

    const getNodeIa = (node: Node): number => {
      const dev = (node.data as any)?.device as KnxDevice | undefined
      if (dev?.individual_address) return parseIndividualAddress(dev.individual_address)
      const chAddr = (node.data as any)?.deviceAddress
      if (chAddr) return parseIndividualAddress(chAddr)
      const tgtAddr = (node.data as any)?.targetIndividualAddress
      if (tgtAddr) return parseIndividualAddress(tgtAddr)
      return 999999
    }

    const getNodeName = (node: Node): string => {
      return (
        (node.data as any)?.block?.name ||
        (node.data as any)?.device?.name ||
        (node.data as any)?.channelName ||
        (node.data as any)?.targetDeviceName ||
        (node.data as any)?.gaAddress ||
        node.id
      )
    }

    // Gültige Kanten auf dem Canvas
    const validEdges = edges.filter((e) => nodeMap.has(e.source) && nodeMap.has(e.target))

    // Vorwärts-Kanten vs. Rückmelde-Kanten
    const forwardEdges: Edge[] = []
    validEdges.forEach((e) => {
      const srcNode = nodeMap.get(e.source)
      const tgtNode = nodeMap.get(e.target)
      if (
        srcNode &&
        tgtNode &&
        (getNodeTier(srcNode) === 'local_actuator' || getNodeTier(srcNode) === 'external_output') &&
        (getNodeTier(tgtNode) === 'local_sensor' || getNodeTier(tgtNode) === 'external_input')
      ) {
        // Rückmelde-Linie Aktor -> Taster-Status LED ignorieren
      } else {
        forwardEdges.push(e)
      }
    })

    // Topologische Tiefenberechnung innerhalb der Logik-Ebene
    const logicDepths = new Map<string, number>()
    nodes.forEach((n) => {
      if (getNodeTier(n) === 'logic') {
        logicDepths.set(n.id, 0)
      }
    })

    let logicChanged = true
    let logicIt = 0
    while (logicChanged && logicIt < 20) {
      logicChanged = false
      logicIt++
      forwardEdges.forEach((e) => {
        const srcNode = nodeMap.get(e.source)
        const tgtNode = nodeMap.get(e.target)
        if (
          srcNode &&
          tgtNode &&
          getNodeTier(srcNode) === 'logic' &&
          getNodeTier(tgtNode) === 'logic'
        ) {
          const sD = logicDepths.get(srcNode.id) || 0
          const tD = logicDepths.get(tgtNode.id) || 0
          if (sD + 1 > tD) {
            logicDepths.set(tgtNode.id, sD + 1)
            logicChanged = true
          }
        }
      })
    }

    const maxLogicDepth = Math.max(0, ...Array.from(logicDepths.values()))

    // Roh-Spaltenindex (0: ExtIn, 1: Sensor, 2..2+d: Logic, 2+d+1: Actuator, 2+d+2: ExtOut)
    const getNodeRawColumn = (node: Node): number => {
      const tier = getNodeTier(node)
      if (tier === 'external_input') return 0
      if (tier === 'local_sensor') return 1
      if (tier === 'logic') return 2 + (logicDepths.get(node.id) || 0)
      if (tier === 'local_actuator') return 2 + maxLogicDepth + 1
      return 2 + maxLogicDepth + 2
    }

    // Kompaktierung: Nur tatsächlich vorkommende Spalten erhalten X-Koordinaten
    const populatedRawCols = Array.from(new Set(nodes.map(getNodeRawColumn))).sort((a, b) => a - b)
    const rawToCompactCol = new Map<number, number>()
    populatedRawCols.forEach((rawCol, idx) => rawToCompactCol.set(rawCol, idx))

    const getNodeColumn = (node: Node): number => {
      return rawToCompactCol.get(getNodeRawColumn(node)) ?? 0
    }

    const totalCompactCols = populatedRawCols.length
    const START_X = 60
    const HORIZONTAL_GAP = 120
    const VERTICAL_GAP = 28

    const colWidths = new Array<number>(totalCompactCols).fill(280)
    nodes.forEach((n) => {
      const col = getNodeColumn(n)
      const w = getNodeWidth(n)
      if (w > colWidths[col]) colWidths[col] = w
    })

    const colXMap = new Map<number, number>()
    let curX = START_X
    for (let c = 0; c < totalCompactCols; c++) {
      colXMap.set(c, curX)
      curX += colWidths[c] + HORIZONTAL_GAP
    }

    // Nodes nach kompakter Spalte gruppieren
    const nodesByCol = new Map<number, Node[]>()
    for (let c = 0; c < totalCompactCols; c++) {
      nodesByCol.set(c, [])
    }
    nodes.forEach((n) => {
      const col = getNodeColumn(n)
      nodesByCol.get(col)!.push(n)
    })

    // Map zur Speicherung der endgültig berechneten Y-Koordinaten
    const assignedYMap = new Map<string, number>()

    // Finden der "primären" Spalte (Local Sensors falls vorhanden, sonst Spalte 0)
    const sensorColIndex = rawToCompactCol.has(1) ? rawToCompactCol.get(1)! : 0
    const primaryColIndex = nodesByCol.get(sensorColIndex)?.length ? sensorColIndex : 0

    // 1. Primäre Spalte platzieren (Lokale Sensoren / Hauptgeräte)
    const primaryNodes = nodesByCol.get(primaryColIndex) || []
    primaryNodes.sort((a, b) => {
      const iaA = getNodeIa(a)
      const iaB = getNodeIa(b)
      if (iaA !== iaB) return iaA - iaB
      return getNodeName(a).localeCompare(getNodeName(b))
    })

    let curPrimaryY = 80
    primaryNodes.forEach((n) => {
      assignedYMap.set(n.id, curPrimaryY)
      placedIds.add(n.id)
      curPrimaryY += getNodeHeight(n) + VERTICAL_GAP + 16
    })

    // 2. Linke Spalten platzieren (z. B. external_input vor primaryColIndex)
    for (let c = primaryColIndex - 1; c >= 0; c--) {
      const colNodes = nodesByCol.get(c) || []

      // Für jeden Knoten idealen Y-Wert basierend auf verbundenen Ziel-Pins berechnen
      const idealYList = colNodes.map((n) => {
        // Kanten von diesem Knoten zu bereits platzierten Knoten
        const outEdges = validEdges.filter((e) => e.source === n.id && placedIds.has(e.target))
        if (outEdges.length > 0) {
          const wireTargets = outEdges.map((e) => {
            const tgtNode = nodeMap.get(e.target)!
            const tgtY = assignedYMap.get(tgtNode.id) || 80
            const tgtHandleRelY = getHandleRelativeY(tgtNode, e.targetHandle, false)
            return tgtY + tgtHandleRelY
          })
          const avgWireY = wireTargets.reduce((a, b) => a + b, 0) / wireTargets.length
          const myHandleRelY = getHandleRelativeY(n, outEdges[0]?.sourceHandle, true)
          return { node: n, idealY: avgWireY - myHandleRelY }
        }
        return { node: n, idealY: 80 }
      })

      // Barycenter-Sortierung: Exakt nach idealY sortieren -> KREUZUNGSFREI!
      idealYList.sort((a, b) => {
        if (Math.abs(a.idealY - b.idealY) > 5) return a.idealY - b.idealY
        return getNodeName(a.node).localeCompare(getNodeName(b.node))
      })

      let curY = 80
      idealYList.forEach(({ node, idealY }) => {
        const y = Math.max(idealY, curY)
        assignedYMap.set(node.id, Math.round(y))
        placedIds.add(node.id)
        curY = y + getNodeHeight(node) + VERTICAL_GAP
      })
    }

    // 3. Rechte Spalten platzieren (Spalten nach primaryColIndex von links nach rechts)
    for (let c = primaryColIndex + 1; c < totalCompactCols; c++) {
      const colNodes = nodesByCol.get(c) || []

      // Für jeden Knoten idealen Y-Wert basierend auf Quell-Pins berechnen
      const idealYList = colNodes.map((n) => {
        // Eingehende Kanten von bereits platzierten Vorgängern
        const inEdges = validEdges.filter((e) => e.target === n.id && placedIds.has(e.source))
        if (inEdges.length > 0) {
          const wireSources = inEdges.map((e) => {
            const srcNode = nodeMap.get(e.source)!
            const srcY = assignedYMap.get(srcNode.id) || 80
            const srcHandleRelY = getHandleRelativeY(srcNode, e.sourceHandle, true)
            return srcY + srcHandleRelY
          })
          const avgWireY = wireSources.reduce((a, b) => a + b, 0) / wireSources.length
          const myHandleRelY = getHandleRelativeY(n, inEdges[0]?.targetHandle, false)
          return { node: n, idealY: avgWireY - myHandleRelY }
        }

        // Falls unverbunden: Prüfen ob es ausgehende Kanten gibt
        const outEdges = validEdges.filter((e) => e.source === n.id && placedIds.has(e.target))
        if (outEdges.length > 0) {
          const tgt = nodeMap.get(outEdges[0].target)!
          const tgtY = assignedYMap.get(tgt.id) || 80
          return { node: n, idealY: tgtY }
        }

        return { node: n, idealY: 80 }
      })

      // Barycenter-Sortierung: Exakt nach idealY sortieren -> KREUZUNGSFREI!
      idealYList.sort((a, b) => {
        if (Math.abs(a.idealY - b.idealY) > 5) return a.idealY - b.idealY
        return getNodeName(a.node).localeCompare(getNodeName(b.node))
      })

      let curY = 80
      idealYList.forEach(({ node, idealY }) => {
        const y = Math.max(idealY, curY)
        assignedYMap.set(node.id, Math.round(y))
        placedIds.add(node.id)
        curY = y + getNodeHeight(node) + VERTICAL_GAP
      })
    }

    // 4. Alle berechneten Positionen zusammenführen
    nodes.forEach((n) => {
      const col = getNodeColumn(n)
      const x = colXMap.get(col) ?? (START_X + col * 420)
      const y = assignedYMap.get(n.id) ?? 80
      updatedPositions.push({ id: n.id, x, y })
    })

    // Update state immediately
    setNodes((currentNodes) =>
      currentNodes.map((n) => {
        const found = updatedPositions.find((p) => p.id === n.id)
        return found ? { ...n, position: { x: found.x, y: found.y } } : n
      })
    )

    // Persist to backend for blocks, channels, and devices
    const blockAndDevPositions = updatedPositions.filter((p) => !p.id.startsWith('portal-'))
    if (onUpdateNodesPositions) {
      onUpdateNodesPositions(blockAndDevPositions)
    } else {
      blockAndDevPositions.forEach((pos) => {
        onUpdateNodePosition?.(pos.id, pos.x, pos.y)
      })
    }

    // Also update and persist portal positions from auto-layout
    const newPortalPositions: Record<string, { x: number; y: number }> = { ...portalPositions }
    let hasPortalChanges = false
    updatedPositions.forEach((pos) => {
      if (pos.id.startsWith('portal-')) {
        newPortalPositions[pos.id] = { x: pos.x, y: pos.y }
        hasPortalChanges = true
      }
    })

    if (hasPortalChanges) {
      handleUpdatePortals(newPortalPositions)
    }

    // Smooth zoom to fit
    if (reactFlowInstance) {
      setTimeout(() => {
        reactFlowInstance.fitView({ padding: 0.15, duration: 500 })
      }, 50)
    }
  }, [nodes, edges, setNodes, onUpdateNodePosition, onUpdateNodesPositions, reactFlowInstance, portalPositions, handleUpdatePortals])

  return (
    <div
      className="w-full h-full bg-slate-950 relative"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodesDelete={handleNodesDelete}
        onEdgesDelete={handleEdgesDelete}
        deleteKeyCode={['Backspace', 'Delete']}
        edgesFocusable={true}
        nodesFocusable={true}
        onInit={setReactFlowInstance}
        onNodeClick={(_, node) => {
          onSelectBlock(node.id)
        }}
        onPaneClick={() => onSelectBlock(null)}
        onNodeDragStop={onNodeDragStop}
        onMoveEnd={(_, vp) => {
          onViewportChange?.(vp)
        }}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        minZoom={0.2}
        maxZoom={2}
        onlyRenderVisibleElements={true}
        elevateNodesOnSelect={false}
        snapToGrid={true}
        snapGrid={snapGrid}
        connectionRadius={28}
        connectionLineType={ConnectionLineType.SmoothStep}
        defaultEdgeOptions={{ type: 'knxWire' }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#334155" gap={tier.gap} size={tier.dotSize} />
        <Controls />
        <Panel position="top-right" className="flex items-center gap-1.5 sm:gap-2 m-2 sm:m-3">
          <CanvasZoomSnapIndicator />
          <button
            type="button"
            onClick={handleAutoLayout}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900/90 hover:bg-slate-800 text-sky-400 border border-sky-500/40 shadow-lg shadow-black/60 backdrop-blur transition-all active:scale-95 cursor-pointer whitespace-nowrap"
            title={t('canvas.autoLayoutTooltip')}
          >
            <Wand2 className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">{t('canvas.autoLayout')}</span>
          </button>
          {onToggleSimulate && (
            <button
              type="button"
              onClick={onToggleSimulate}
              className={`p-1.5 rounded-lg border shadow-lg shadow-black/60 transition-all cursor-pointer ${
                isSimulating
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 shadow-emerald-950/40'
                  : 'bg-slate-900/90 text-slate-500 hover:text-slate-300 border-slate-800 hover:bg-slate-800'
              }`}
              title={
                isSimulating
                  ? 'Signalfluss-Animation pausieren (wandernde Leitungs-Impulse ausschalten)'
                  : 'Signalfluss-Animation aktivieren (wandernde Leitungs-Impulse einschalten)'
              }
            >
              <Zap className={`w-4 h-4 ${isSimulating ? 'fill-emerald-400 text-emerald-400' : ''}`} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowMiniMap((prev) => !prev)}
            className={`p-1.5 rounded-lg border shadow-lg shadow-black/60 transition-all cursor-pointer ${
              showMiniMap
                ? 'bg-sky-500/20 text-sky-400 border-sky-500/40'
                : 'bg-slate-900/90 text-slate-400 hover:text-slate-200 border-slate-800 hover:bg-slate-800'
            }`}
            title={showMiniMap ? 'Minimap verbergen' : 'Minimap einblenden'}
          >
            <MapIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => reactFlowInstance?.fitView({ padding: 0.2, duration: 400 })}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 bg-slate-900/90 border border-slate-800 shadow-lg shadow-black/60 hover:bg-slate-800 transition-all cursor-pointer"
            title={t('canvas.fitViewTooltip')}
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </Panel>
        {showMiniMap && (
          <MiniMap
            className="!m-3 !rounded-lg !border !border-slate-800 !bg-slate-950/90 !shadow-xl !backdrop-blur"
            nodeColor={(node) => {
              if (node.type === 'lightBlock') return '#eab308'
              if (node.type === 'blindBlock') return '#14b8a6'
              if (node.type === 'climateBlock') return '#f97316'
              if (node.type === 'sceneBlock') return '#a855f7'
              if (node.type === 'staircaseBlock') return '#eab308'
              if (node.type === 'logicBlock') return '#ec4899'
              if (node.type === 'channelTerminal') return '#38bdf8'
              if (node.type === 'knxDevice') return '#0284c7'
              return '#38bdf8'
            }}
            maskColor="rgba(15, 23, 42, 0.7)"
            zoomable
            pannable
          />
        )}
      </ReactFlow>
    </div>
  )
}

export const FlowCanvas: React.FC<FlowCanvasProps> = (props) => {
  return (
    <ReactFlowProvider>
      <FlowCanvasInternal {...props} />
    </ReactFlowProvider>
  )
}

export default FlowCanvas
