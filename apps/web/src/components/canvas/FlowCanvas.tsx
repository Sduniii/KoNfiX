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
} from '@xyflow/react'
import { Wand2, Maximize2, Grid3X3 } from 'lucide-react'
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
  const zoom = useStore((state) => state.transform[2])
  const tierIndex = getTierIndex(zoom)
  const tier = ZOOM_TIERS[tierIndex]
  const zoomPct = Math.round(zoom * 100)

  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-900/90 text-slate-300 border border-slate-800 shadow-lg shadow-black/60 select-none backdrop-blur"
      title={`Dynamisches Raster: ${tier.gap}px Musterabstand, ${tier.snap}px Fang-Schrittweite bei ${zoomPct}% Zoom`}
    >
      <Grid3X3 className="w-3.5 h-3.5 text-sky-400" />
      <span>
        Muster: <strong className="text-white font-mono">{tier.gap}px</strong>
      </span>
      <span className="text-slate-600">·</span>
      <span className="text-slate-400 font-mono">Snap {tier.snap}px</span>
      <span className="text-slate-600">·</span>
      <span className="font-mono text-slate-400">{zoomPct}%</span>
    </div>
  )
})

const FlowCanvasInternal: React.FC<FlowCanvasProps> = ({
  project,
  selectedRoomId,
  selectedBlockId,
  isSimulating,
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
  const [reactFlowInstance, setReactFlowInstance] = React.useState<any>(null)

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
    onDeleteBlocks,
    onRemoveChannel,
    onPlaceDevice,
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

  // Auto-Layout: Intelligenter hierarchischer Signalfluss mit topologischer Zeilenausrichtung (Swimlanes)
  // Strenges Gesetz: Für jede Verbindung liegt der OUT-Pin links neben dem IN-Pin der Ziel-Node!
  // Signale fließen ausnahmslos von Links nach Rechts (Eingänge ➔ Logik/Aktor ➔ Ausgänge/Portale).
  // Dynamische Spaltenbreiten & Höhen verhindern jegliche Überlappungen.
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
      if (node.type === 'roomPortal') return 280
      if (node.type === 'channelTerminal') return 260
      if (node.type === 'sceneBlock' || node.type === 'astroBlock') return 340
      return 320
    }

    // Exakte / sichere Höhenberechnung ohne künstliche Begrenzung
    const getNodeHeight = (node: Node): number => {
      if (node.measured?.height && node.measured.height > 40) {
        return Math.ceil(node.measured.height)
      }
      if ((node as any).height && (node as any).height > 40) {
        return Math.ceil((node as any).height)
      }

      if (node.type === 'roomPortal') return 125
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
        return 120 + pinCount * 56
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

    // Nur Kanten betrachten, bei denen Quelle und Ziel aktuell auf dem Canvas vorhanden sind
    const validEdges = edges.filter((e) => nodeMap.has(e.source) && nodeMap.has(e.target))

    // Klassifizierung für Rückmelde-Erkennung (z.B. Aktor-Status zurück auf Taster-LED)
    const isInputDevice = (node: Node): boolean => {
      if (node.type === 'roomPortal' && (node.data as any)?.direction === 'in') return true
      if (node.type === 'channelTerminal') {
        const type = (node.data as any)?.channelType
        return type === 'PushButtonInput' || type === 'PresenceSensorInput'
      }
      if (node.type === 'knxDevice') {
        const dev = (node.data as any)?.device as KnxDevice | undefined
        const name = (dev?.name || '').toLowerCase()
        const model = (dev?.model || '').toLowerCase()
        return (
          name.includes('taster') ||
          model.includes('taster') ||
          name.includes('sensor') ||
          name.includes('wetter') ||
          name.includes('präsenz') ||
          name.includes('bewegung')
        )
      }
      return false
    }

    const isActuator = (node: Node): boolean => {
      if (node.type === 'roomPortal' && (node.data as any)?.direction === 'out') return false
      if (node.type === 'channelTerminal') {
        const type = (node.data as any)?.channelType
        return type === 'BlindOutput' || type === 'SwitchOutput' || type === 'DimmingOutput'
      }
      if (node.type === 'knxDevice') {
        const dev = (node.data as any)?.device as KnxDevice | undefined
        const name = (dev?.name || '').toLowerCase()
        const model = (dev?.model || '').toLowerCase()
        return (
          name.includes('aktor') ||
          model.includes('aktor') ||
          name.includes('dimm') ||
          name.includes('schalt') ||
          name.includes('rolladen') ||
          name.includes('jalousie')
        )
      }
      return false
    }

    // Vorwärts-Kanten vs. Rückmelde-Kanten trennen (Rückmeldekanten ignorieren wir für die X-Layer-Berechnung)
    const forwardEdges: Edge[] = []
    validEdges.forEach((e) => {
      const srcNode = nodeMap.get(e.source)
      const tgtNode = nodeMap.get(e.target)
      if (srcNode && tgtNode && isActuator(srcNode) && isInputDevice(tgtNode)) {
        // Rückmelde-Linie: z.B. Aktor-Status KO -> Taster LED KO
      } else {
        forwardEdges.push(e)
      }
    })

    // Topologische Layer-Berechnung via Longest-Path auf dem gerichteten azyklischen Vorwärtsgraphen
    const layers = new Map<string, number>()
    nodes.forEach((n) => layers.set(n.id, 0))

    let changed = true
    let it = 0
    while (changed && it < 30) {
      changed = false
      it++
      forwardEdges.forEach((e) => {
        const sL = layers.get(e.source) || 0
        const tL = layers.get(e.target) || 0
        if (sL + 1 > tL) {
          layers.set(e.target, sL + 1)
          changed = true
        }
      })
    }

    // Zusammenhängende Komponenten (Weakly Connected Components) für Zeilen/Swimlanes bilden
    const adj = new Map<string, string[]>()
    nodes.forEach((n) => adj.set(n.id, []))
    validEdges.forEach((e) => {
      adj.get(e.source)!.push(e.target)
      adj.get(e.target)!.push(e.source)
    })

    const visited = new Set<string>()
    const components: Node[][] = []

    nodes.forEach((n) => {
      if (visited.has(n.id)) return
      if ((adj.get(n.id) || []).length === 0) return // Unverbunden

      const comp: Node[] = []
      const queue: string[] = [n.id]
      visited.add(n.id)
      while (queue.length > 0) {
        const curr = queue.shift()!
        const nodeObj = nodeMap.get(curr)
        if (nodeObj) comp.push(nodeObj)
        for (const next of adj.get(curr) || []) {
          if (!visited.has(next)) {
            visited.add(next)
            queue.push(next)
          }
        }
      }
      components.push(comp)
    })

    // Layout-Platzierung mit dynamischen Abständen
    const VERTICAL_GAP = 28
    const HORIZONTAL_GAP = 100
    const START_X = 80
    let currentY = 80

    // 1. Verbundene Komponenten als horizontale Swimlanes platzieren
    components.forEach((compNodes) => {
      const minLayer = Math.min(...compNodes.map((n) => layers.get(n.id) || 0))

      // Nach relativer Ebene (Spalte) gruppieren
      const layerGroups = new Map<number, Node[]>()
      compNodes.forEach((n) => {
        const relL = (layers.get(n.id) || 0) - minLayer
        if (!layerGroups.has(relL)) layerGroups.set(relL, [])
        layerGroups.get(relL)!.push(n)
      })

      // Innerhalb jeder Spalte deterministisch sortieren (nach Name) für gerade, parallele Leitungen
      layerGroups.forEach((group) => {
        group.sort((a, b) => {
          const nameA =
            (a.data as any)?.block?.name ||
            (a.data as any)?.device?.name ||
            (a.data as any)?.channelName ||
            a.id
          const nameB =
            (b.data as any)?.block?.name ||
            (b.data as any)?.device?.name ||
            (b.data as any)?.channelName ||
            b.id
          return nameA.localeCompare(nameB)
        })
      })

      // Maximale relative Spaltenebene ermitteln
      const maxRelL = Math.max(...Array.from(layerGroups.keys()))

      // Dynamische X-Position je Spalte anhand der tatsächlichen Breite der Nodes in der vorherigen Spalte
      const colXMap = new Map<number, number>()
      let curColX = START_X
      for (let l = 0; l <= maxRelL; l++) {
        colXMap.set(l, curColX)
        const group = layerGroups.get(l) || []
        const colWidth = group.length > 0 ? Math.max(...group.map(getNodeWidth), 280) : 280
        curColX += colWidth + HORIZONTAL_GAP
      }

      // Maximale Höhe dieser Kette ermitteln
      let maxChainHeight = 0
      layerGroups.forEach((group) => {
        const h = group.reduce((acc, n) => acc + getNodeHeight(n), 0) + (group.length - 1) * VERTICAL_GAP
        if (h > maxChainHeight) maxChainHeight = h
      })

      const chainHeight = Math.max(maxChainHeight, 120)

      // Nodes der Kette in ihren dynamisch berechneten Spalten und vertikal zentriert platzieren
      layerGroups.forEach((group, relL) => {
        const x = colXMap.get(relL) ?? (START_X + relL * 480)
        const layerH = group.reduce((acc, n) => acc + getNodeHeight(n), 0) + (group.length - 1) * VERTICAL_GAP
        let y = currentY + (chainHeight - layerH) / 2

        group.forEach((n) => {
          updatedPositions.push({ id: n.id, x, y: Math.round(y) })
          placedIds.add(n.id)
          y += getNodeHeight(n) + VERTICAL_GAP
        })
      })

      currentY += chainHeight + 80 // Großzügiger Abstand zur nächsten Zeile
    })

    // 2. Unverbundene Elemente in einer geordneten Ablage-Zone darunter platzieren
    const unconnectedNodes = nodes.filter((n) => !placedIds.has(n.id))
    if (unconnectedNodes.length > 0) {
      if (placedIds.size > 0) {
        currentY += 60 // Klarer Abstand von den Schaltungsketten
      }
      const COLS = 3
      const maxUnconnWidth = Math.max(...unconnectedNodes.map(getNodeWidth), 340)
      const UNCONN_COL_STEP = maxUnconnWidth + 60

      for (let i = 0; i < unconnectedNodes.length; i += COLS) {
        const slice = unconnectedNodes.slice(i, i + COLS)
        const rowHeight = Math.max(...slice.map(getNodeHeight), 120)

        slice.forEach((node, colIdx) => {
          const x = START_X + colIdx * UNCONN_COL_STEP
          updatedPositions.push({ id: node.id, x, y: Math.round(currentY) })
          placedIds.add(node.id)
        })

        currentY += rowHeight + 40
      }
    }

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
        defaultEdgeOptions={{ type: 'knxWire' }}
      >
        <Background color="#334155" gap={tier.gap} size={tier.dotSize} />
        <Controls />
        <Panel position="top-right" className="flex items-center gap-2 m-3">
          <CanvasZoomSnapIndicator />
          <button
            type="button"
            onClick={handleAutoLayout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900/90 hover:bg-slate-800 text-sky-400 border border-sky-500/40 shadow-lg shadow-black/60 backdrop-blur transition-all active:scale-95 cursor-pointer"
            title="Alle Geräte und Blöcke automatisch in saubere Signalfluss-Spalten ordnen (ohne Überlappung)"
          >
            <Wand2 className="w-3.5 h-3.5" />
            <span>Layout ordnen</span>
          </button>
          <button
            type="button"
            onClick={() => reactFlowInstance?.fitView({ padding: 0.2, duration: 400 })}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 bg-slate-900/90 border border-slate-800 shadow-lg shadow-black/60 hover:bg-slate-800 transition-all cursor-pointer"
            title="Ansicht zentrieren (Fit View)"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </Panel>
        <MiniMap
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
        />
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
