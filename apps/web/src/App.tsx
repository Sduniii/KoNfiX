import React, { useState, useEffect, useCallback } from 'react'
import {
  Project,
  FunctionBlockType,
  FunctionBlock,
  WireConnection,
  KnxDevice,
  GroupAddress,
  GaScheme,
  GatewayConnectionStatus,
} from './types/knx'
import { createDefaultFunctionBlock } from './utils/blockFactory'
import {
  fetchAppVersion,
  fetchProject,
  updateProject,
  updateDevicePosition,
  triggerAutoRoute,
  simulateAction,
  getGatewayStatus,
  connectPins,
  disconnectPins,
  saveStorageProject,
  fetchStorageView,
  saveStorageView,
} from './services/api'
import { useBusMonitor } from './services/useBusMonitor'
import { Header } from './components/layout/Header'
import { RoomTabBar } from './components/layout/RoomTabBar'
import { LeftSidebar } from './components/sidebar/LeftSidebar'
import { RightSidebar } from './components/inspector/RightSidebar'
import { FlowCanvas } from './components/canvas/FlowCanvas'
import { BusMonitor } from './components/monitor/BusMonitor'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { Loader2 } from 'lucide-react'

// On-demand lazy-loaded workspaces and modals for optimal initial bundle size
const AddDeviceModal = React.lazy(() => import('./components/devices/AddDeviceModal').then(m => ({ default: m.AddDeviceModal })))
const DeviceKoParamModal = React.lazy(() => import('./components/devices/DeviceKoParamModal').then(m => ({ default: m.DeviceKoParamModal })))
const GaManagementModal = React.lazy(() => import('./components/ga/GaManagementModal').then(m => ({ default: m.GaManagementModal })))
const GatewayModal = React.lazy(() => import('./components/gateway/GatewayModal').then(m => ({ default: m.GatewayModal })))
const ImportModal = React.lazy(() => import('./components/import/ImportModal').then(m => ({ default: m.ImportModal })))
const SceneMixerModal = React.lazy(() => import('./components/scenes/SceneMixerModal').then(m => ({ default: m.SceneMixerModal })))
const DiagnosticsWorkspace = React.lazy(() => import('./components/diagnostics/DiagnosticsWorkspace').then(m => ({ default: m.DiagnosticsWorkspace })))
const TopologyWorkspace = React.lazy(() => import('./components/topology/TopologyWorkspace').then(m => ({ default: m.TopologyWorkspace })))
const DeviceSecurityModal = React.lazy(() => import('./components/devices/DeviceSecurityModal').then(m => ({ default: m.DeviceSecurityModal })))
const ExportKnxprojModal = React.lazy(() => import('./components/export/ExportKnxprojModal').then(m => ({ default: m.ExportKnxprojModal })))
const ProgrammingJobDrawer = React.lazy(() => import('./components/programming/ProgrammingJobDrawer').then(m => ({ default: m.ProgrammingJobDrawer })))
const OpenProjectModal = React.lazy(() => import('./components/storage/OpenProjectModal').then(m => ({ default: m.OpenProjectModal })))
const StorageSettingsModal = React.lazy(() => import('./components/storage/StorageSettingsModal').then(m => ({ default: m.StorageSettingsModal })))
const ProjectCompareModal = React.lazy(() => import('./components/compare/ProjectCompareModal').then(m => ({ default: m.ProjectCompareModal })))

function WorkspaceFallback({ label }: { label: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center h-full text-slate-400 gap-3">
      <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
      <span className="text-sm">{label} wird geladen...</span>
    </div>
  )
}

export function App() {
  const [project, setProject] = useState<Project | null>(null)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [activeWorkspace, setActiveWorkspace] = useState<'canvas' | 'topology' | 'diagnostics'>('canvas')
  const [diagnosticsInitialAddress, setDiagnosticsInitialAddress] = useState<string | null>(null)
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [portalPositions, setPortalPositions] = useState<Record<string, { x: number; y: number }>>({})
  const [roomViewports, setRoomViewports] = useState<Record<string, { x: number; y: number; zoom: number }>>({})

  const projectRef = React.useRef(project)
  projectRef.current = project

  const portalPositionsRef = React.useRef(portalPositions)
  portalPositionsRef.current = portalPositions

  const roomViewportsRef = React.useRef(roomViewports)
  roomViewportsRef.current = roomViewports

  const [mixerBlock, setMixerBlock] = useState<FunctionBlock | null>(null)
  const [isAddDeviceModalOpen, setIsAddDeviceModalOpen] = useState<boolean>(false)
  const [isDeviceKoModalOpen, setIsDeviceKoModalOpen] = useState<boolean>(false)
  const [deviceForKoModal, setDeviceForKoModal] = useState<KnxDevice | null>(null)
  const [isSecurityModalOpen, setIsSecurityModalOpen] = useState<boolean>(false)
  const [deviceForSecurityModal, setDeviceForSecurityModal] = useState<KnxDevice | null>(null)
  const [isGaModalOpen, setIsGaModalOpen] = useState<boolean>(false)
  const [isGatewayModalOpen, setIsGatewayModalOpen] = useState<boolean>(false)
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false)
  const [isExportKnxprojModalOpen, setIsExportKnxprojModalOpen] = useState<boolean>(false)
  const [isOpenProjectModalOpen, setIsOpenProjectModalOpen] = useState<boolean>(false)
  const [isStorageSettingsModalOpen, setIsStorageSettingsModalOpen] = useState<boolean>(false)
  const [isProjectCompareModalOpen, setIsProjectCompareModalOpen] = useState<boolean>(false)
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState<boolean>(false)

  const [gatewayStatus, setGatewayStatus] = useState<GatewayConnectionStatus | null>(null)
  const [isSimulating, setIsSimulating] = useState<boolean>(true)
  const [isRouting, setIsRouting] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const {
    telegrams,
    isConnected: isWsConnected,
    isPaused,
    clearTelegrams,
    togglePause,
  } = useBusMonitor()

  // Debounced auto-save of project mutations (e.g. node dragging)
  const saveTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const debouncedSaveProject = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = setTimeout(async () => {
      if (projectRef.current) {
        try {
          await updateProject(projectRef.current)
        } catch (err) {
          console.error('Failed to auto-save project state:', err)
        }
      }
    }, 350)
  }, [])

  // Debounced save of view state (viewports, portal positions, active workspace)
  const viewSaveTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const debouncedSaveView = useCallback(() => {
    if (viewSaveTimeoutRef.current) {
      clearTimeout(viewSaveTimeoutRef.current)
    }
    viewSaveTimeoutRef.current = setTimeout(() => {
      if (!projectRef.current?.name) return
      saveStorageView(
        {
          active_workspace: activeWorkspace,
          selected_room_id: selectedRoomId,
          selected_block_id: selectedBlockId,
          portal_positions: portalPositionsRef.current,
          room_viewports: roomViewportsRef.current,
        },
        projectRef.current.name
      ).catch(() => {})
    }, 400)
  }, [activeWorkspace, selectedRoomId, selectedBlockId])

  const handleViewportChange = useCallback((viewport: { x: number; y: number; zoom: number }) => {
    const roomKey = selectedRoomId || '__all__'
    setRoomViewports((prev) => {
      const next = { ...prev, [roomKey]: viewport }
      roomViewportsRef.current = next
      return next
    })
    debouncedSaveView()
  }, [selectedRoomId, debouncedSaveView])

  const handlePortalPositionsChange = useCallback((positions: Record<string, { x: number; y: number }>) => {
    setPortalPositions(positions)
    portalPositionsRef.current = positions
    debouncedSaveView()
  }, [debouncedSaveView])

  // Initial load with backend retry
  useEffect(() => {
    let cancelled = false
    const MAX_RETRIES = 12
    const RETRY_DELAY_MS = 5000

    const tryLoad = async () => {
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        if (cancelled) return
        try {
          const p = await fetchProject()
          if (cancelled) return
          setProject(p)
          projectRef.current = p
          setLoading(false)
          if (p.name) {
            fetchStorageView(p.name).then((view) => {
              if (!view) return
              if (view.active_workspace && ['canvas', 'topology', 'diagnostics'].includes(view.active_workspace)) {
                setActiveWorkspace(view.active_workspace as 'canvas' | 'topology' | 'diagnostics')
              }
              if (view.selected_room_id && p.rooms.some((r) => r.id === view.selected_room_id)) {
                setSelectedRoomId(view.selected_room_id)
              }
              if (view.selected_block_id) {
                setSelectedBlockId(view.selected_block_id)
              }
              if (view.portal_positions) {
                setPortalPositions(view.portal_positions)
                portalPositionsRef.current = view.portal_positions
              }
              if (view.room_viewports) {
                setRoomViewports(view.room_viewports)
                roomViewportsRef.current = view.room_viewports
              }
            }).catch(() => {})
          }
          return // success
        } catch {
          if (cancelled) return
          if (attempt < MAX_RETRIES) {
            setError(`KoNFix Backend verbinden... (Versuch ${attempt}/${MAX_RETRIES})`)
            await new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, RETRY_DELAY_MS)
              // Store timer ID is not needed since we check `cancelled` after each retry
              void timer
            })
          } else {
            setError('Backend nicht erreichbar. Stelle sicher, dass der KoNFix-Daemon läuft (cargo run in crates/knx-core).')
            setLoading(false)
          }
        }
      }
    }

    tryLoad()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    fetchAppVersion().then((v) => setAppVersion(v.version)).catch(() => {})
    getGatewayStatus().then(setGatewayStatus).catch(() => {})
    const gwTimer = setInterval(() => {
      getGatewayStatus().then(setGatewayStatus).catch(() => {})
    }, 8000)
    return () => clearInterval(gwTimer)
  }, [])

  // Persist view state on navigation changes (workspace, room, block)
  useEffect(() => {
    if (!project?.name) return
    const timer = setTimeout(() => {
      saveStorageView(
        {
          active_workspace: activeWorkspace,
          selected_room_id: selectedRoomId,
          selected_block_id: selectedBlockId,
          portal_positions: portalPositionsRef.current,
          room_viewports: roomViewportsRef.current,
        },
        project.name
      ).catch(() => {})
    }, 500)
    return () => clearTimeout(timer)
  }, [project?.name, activeWorkspace, selectedRoomId, selectedBlockId])

  const handleSaveProject = useCallback(async () => {
    if (!project) return
    try {
      setIsSaving(true)
      // 1. Sync full in-memory client state to backend & save project to disk
      await updateProject(project)
      await saveStorageProject(project.name, project)
      // 2. Persist view state including portals & viewports
      await saveStorageView(
        {
          active_workspace: activeWorkspace,
          selected_room_id: selectedRoomId,
          selected_block_id: selectedBlockId,
          portal_positions: portalPositionsRef.current,
          room_viewports: roomViewportsRef.current,
        },
        project.name
      )
      const now = new Date()
      const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')} Uhr`
      setLastSavedTime(timeStr)
    } catch (err) {
      console.error('Failed to save project:', err)
    } finally {
      setIsSaving(false)
    }
  }, [project, activeWorkspace, selectedRoomId, selectedBlockId])

  // Keyboard shortcut Ctrl+S / Cmd+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        handleSaveProject()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSaveProject])

  const handleProjectLoaded = useCallback((newProject: Project) => {
    setProject(newProject)
    projectRef.current = newProject
    if (newProject.rooms.length > 0) {
      setSelectedRoomId(newProject.rooms[0].id)
    } else {
      setSelectedRoomId(null)
    }
    setSelectedBlockId(null)
    // Clear old project's viewport/portal state immediately so there's no flicker
    setPortalPositions({})
    portalPositionsRef.current = {}
    setRoomViewports({})
    roomViewportsRef.current = {}
    if (newProject.name) {
      fetchStorageView(newProject.name).then((view) => {
        if (view) {
          if (view.active_workspace && ['canvas', 'topology', 'diagnostics'].includes(view.active_workspace)) {
            setActiveWorkspace(view.active_workspace as 'canvas' | 'topology' | 'diagnostics')
          }
          if (view.selected_room_id && newProject.rooms.some((r) => r.id === view.selected_room_id)) {
            setSelectedRoomId(view.selected_room_id)
          }
          if (view.selected_block_id) {
            setSelectedBlockId(view.selected_block_id)
          }
          if (view.portal_positions) {
            setPortalPositions(view.portal_positions)
            portalPositionsRef.current = view.portal_positions
          }
          if (view.room_viewports) {
            setRoomViewports(view.room_viewports)
            roomViewportsRef.current = view.room_viewports
          }
        }
      }).catch(() => {})
    }
    const now = new Date()
    setLastSavedTime(`${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')} Uhr`)
  }, [])

  const handleReloadProject = useCallback(() => {
    fetchProject().then((p) => {
      setProject(p)
      projectRef.current = p
      if (p.rooms.length > 0) {
        setSelectedRoomId(p.rooms[0].id)
      }
    })
  }, [])

  // Live Bus Telegram synchronization: update block states in real-time when telegram arrives
  useEffect(() => {
    if (telegrams.length === 0 || !project) return
    const latest = telegrams[0] // latest telegram is at index 0
    if (!latest || !latest.destination) return

    // Find if destination matches any GroupAddress in project
    const ga = project.group_addresses.find((g) => g.address === latest.destination)
    if (!ga) return

    // Check if any block has a pin with this group_address_id
    setProject((prev) => {
      if (!prev) return prev
      let hasChange = false
      const nextBlocks = prev.blocks.map((block) => {
        const hasMatchingInput = block.inputs.some((p) => p.group_address_id === ga.id)
        const hasMatchingOutput = block.outputs.some((p) => p.group_address_id === ga.id)

        if (!hasMatchingInput && !hasMatchingOutput) return block

        const valStr = latest.value_formatted.toLowerCase().trim()
        const numVal = parseFloat(valStr)
        const isNumeric = !isNaN(numVal)

        if (block.block_type === 'BlindController') {
          if (valStr.includes('%') || (isNumeric && numVal >= 0 && numVal <= 100 && !valStr.includes('c'))) {
            if (block.state?.position === numVal) return block
            hasChange = true
            return {
              ...block,
              state: { ...block.state, position: numVal, current_position: numVal },
            }
          } else if (valStr === '1' || valStr === 'true' || valStr === 'ein' || valStr.includes('ab') || valStr.includes('auf')) {
            const isDown = ga.name.toLowerCase().includes('ab')
            if (block.state?.is_moving === true && block.state?.direction === (isDown ? 'down' : 'up')) return block
            hasChange = true
            return {
              ...block,
              state: { ...block.state, is_moving: true, direction: isDown ? 'down' : 'up' },
            }
          } else if (valStr === '0' || valStr === 'false' || valStr === 'aus' || valStr.includes('stopp')) {
            if (block.state?.is_moving === false) return block
            hasChange = true
            return {
              ...block,
              state: { ...block.state, is_moving: false },
            }
          }
        } else if (block.block_type === 'LightController') {
          if (valStr === '1' || valStr === 'true' || valStr === 'ein' || valStr === 'on') {
            if (block.state?.is_on === true) return block
            hasChange = true
            return {
              ...block,
              state: { ...block.state, is_on: true, brightness: block.state?.brightness || 100 },
            }
          } else if (valStr === '0' || valStr === 'false' || valStr === 'aus' || valStr === 'off') {
            if (block.state?.is_on === false) return block
            hasChange = true
            return {
              ...block,
              state: { ...block.state, is_on: false },
            }
          } else if (isNumeric) {
            const targetOn = numVal > 0
            if (block.state?.brightness === numVal && block.state?.is_on === targetOn) return block
            hasChange = true
            return {
              ...block,
              state: { ...block.state, is_on: targetOn, brightness: numVal },
            }
          }
        } else if (block.block_type === 'ClimateController') {
          if (isNumeric) {
            if (block.state?.current_temp === numVal) return block
            hasChange = true
            return {
              ...block,
              state: { ...block.state, current_temp: numVal },
            }
          }
        }
        return block
      })

      if (!hasChange) return prev
      return { ...prev, blocks: nextBlocks }
    })
  }, [telegrams, project?.group_addresses])

  // Auto-Route Trigger
  const handleAutoRoute = useCallback(async () => {
    if (!project) return
    setIsRouting(true)
    try {
      const updated = await triggerAutoRoute()
      setProject(updated)
    } catch (e) {
      console.error('Auto route error:', e)
    } finally {
      setIsRouting(false)
    }
  }, [project])

  // Block Action Trigger (Simulates KNX bus event)
  const handleBlockAction = useCallback(
    async (blockId: string, pin: string, value: any) => {
      if (!project) return
      try {
        await simulateAction(blockId, pin, value)

        // Optimistically update block state in UI
        setProject((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            blocks: prev.blocks.map((b) => {
              if (b.id === blockId) {
                if (b.block_type === 'LightController') {
                  const currentOn = b.state?.is_on ?? false
                  const newOn = pin === 't' ? !currentOn : value > 0
                  const newBrightness = pin === 'val' ? value : newOn ? 100 : 0
                  return {
                    ...b,
                    state: { ...b.state, is_on: newOn, brightness: newBrightness },
                  }
                }
                if (b.block_type === 'BlindController') {
                  return {
                    ...b,
                    state: { ...b.state, position: value },
                  }
                }
                if (b.block_type === 'ClimateController') {
                  return {
                    ...b,
                    state: { ...b.state, target_temp: value },
                  }
                }
              }
              return b
            }),
          }
        })
      } catch (err) {
        console.error('Simulate action error:', err)
      }
    },
    [project]
  )

  // Trigger from physical switch
  const handleTriggerSwitch = useCallback(
    async (deviceId: string, channelId: string, channelCode: string) => {
      if (!project) return
      // Find all wires originating from this switch channel or device
      const pinHandle = `out-${channelId}`
      const matchedConns = project.connections.filter(
        (c) =>
          (c.from_node_id === deviceId && (c.from_pin === pinHandle || c.from_pin === 'out')) ||
          (c.from_node_id === channelId)
      )

      if (matchedConns.length > 0) {
        // Trigger all connected target blocks!
        for (const conn of matchedConns) {
          const targetBlock = project.blocks.find((b) => b.id === conn.to_node_id)
          if (targetBlock) {
            if (conn.to_pin === 't') {
              const currentOn = targetBlock.state?.is_on ?? false
              await handleBlockAction(targetBlock.id, 't', !currentOn)
            } else {
              await handleBlockAction(targetBlock.id, conn.to_pin, true)
            }
          }
        }
      } else {
        // Fallback: If not wired yet, trigger relevant block based on channel
        if (channelCode.includes('1') && project.blocks[0]) {
          const currentOn = project.blocks[0].state?.is_on ?? false
          await handleBlockAction(project.blocks[0].id, 't', !currentOn)
        } else if (channelCode.includes('2') && project.blocks[1]) {
          await handleBlockAction(project.blocks[1].id, 'up', 0)
        } else if (project.blocks.length > 0) {
          const b = project.blocks[0]
          const currentOn = b.state?.is_on ?? false
          await handleBlockAction(b.id, 't', !currentOn)
        }
      }
    },
    [project, handleBlockAction]
  )

  // Add new block (supports drag drop at customPosition)
  const handleAddBlock = useCallback(
    async (type: FunctionBlockType, customPosition?: { x: number; y: number }) => {
      if (!project) return

      const roomId = selectedRoomId || project.rooms[0]?.id || null
      const newBlock = createDefaultFunctionBlock(
        type,
        project.blocks.length,
        roomId,
        customPosition
      )

      const updatedProject: Project = {
        ...project,
        blocks: [...project.blocks, newBlock],
      }

      try {
        const saved = await updateProject(updatedProject)
        setProject(saved)
        setSelectedBlockId(newBlock.id)
      } catch (err) {
        console.error('Failed to add block:', err)
      }
    },
    [project, selectedRoomId]
  )

  // Delete block
  // Delete block(s)
  const handleDeleteBlocks = useCallback(
    async (blockIds: string[]) => {
      if (!project || blockIds.length === 0) return
      const idSet = new Set(blockIds)
      const updatedProject: Project = {
        ...project,
        blocks: project.blocks.filter((b) => !idSet.has(b.id)),
        connections: project.connections.filter(
          (c) => !idSet.has(c.from_node_id) && !idSet.has(c.to_node_id)
        ),
        group_addresses: project.group_addresses.filter(
          (ga) => !ga.origin_block_id || !idSet.has(ga.origin_block_id)
        ),
      }
      try {
        const saved = await updateProject(updatedProject)
        setProject(saved)
        if (selectedBlockId && idSet.has(selectedBlockId)) {
          setSelectedBlockId(null)
        }
      } catch (err) {
        console.error('Failed to delete block(s):', err)
      }
    },
    [project, selectedBlockId]
  )

  const handleDeleteBlock = useCallback(
    async (blockId: string) => {
      handleDeleteBlocks([blockId])
    },
    [handleDeleteBlocks]
  )

  // Delete connection(s)
  const handleDeleteConnections = useCallback(
    async (connectionIds: string[]) => {
      if (!project || connectionIds.length === 0) return
      let currentProj = project
      const idSet = new Set(connectionIds)
      for (const id of connectionIds) {
        try {
          const res = await disconnectPins(id)
          if (res.project) {
            currentProj = res.project
          }
        } catch (err) {
          console.error(`Failed to disconnect pin ${id} via API:`, err)
        }
      }
      // Fallback: If any requested connection was not removed via API, clean up locally and sync once
      const remainingUnwanted = currentProj.connections.some((c) => idSet.has(c.id))
      if (remainingUnwanted) {
        try {
          currentProj = await updateProject({
            ...currentProj,
            connections: currentProj.connections.filter((c) => !idSet.has(c.id)),
          })
        } catch (updateErr) {
          console.error('Failed to update project after fallback connection deletion:', updateErr)
        }
      }
      setProject(currentProj)
    },
    [project]
  )

  const handleDeleteConnection = useCallback(
    async (connectionId: string) => {
      handleDeleteConnections([connectionId])
    },
    [handleDeleteConnections]
  )

  // Update position for function blocks, KNX devices, and channels (debounced auto-save)
  const handleUpdateNodePosition = useCallback(
    (id: string, x: number, y: number) => {
      setProject((prev) => {
        if (!prev) return prev
        const isBlock = prev.blocks.some((b) => b.id === id)
        const isDevice = prev.devices.some((d) => d.id === id)
        const isChannel = prev.devices.some((d) => d.channels.some((c) => c.id === id))

        let next = prev
        if (isBlock) {
          next = {
            ...prev,
            blocks: prev.blocks.map((b) => (b.id === id ? { ...b, position: { x, y } } : b)),
          }
        } else if (isDevice) {
          next = {
            ...prev,
            devices: prev.devices.map((d) => (d.id === id ? { ...d, position: { x, y } } : d)),
          }
        } else if (isChannel) {
          next = {
            ...prev,
            devices: prev.devices.map((d) => ({
              ...d,
              channels: d.channels.map((c) => (c.id === id ? { ...c, position: { x, y } } : c)),
            })),
          }
        }
        projectRef.current = next
        return next
      })
      debouncedSaveProject()
    },
    [debouncedSaveProject]
  )

  // Batch update positions for function blocks, KNX devices, and channels (e.g. from Auto-Layout)
  const handleUpdateNodesPositions = useCallback(
    (positions: { id: string; x: number; y: number }[]) => {
      if (positions.length === 0) return
      const posMap = new Map(positions.map((p) => [p.id, { x: p.x, y: p.y }]))

      setProject((prev) => {
        if (!prev) return prev
        const nextBlocks = prev.blocks.map((b) => {
          const p = posMap.get(b.id)
          return p ? { ...b, position: { x: p.x, y: p.y } } : b
        })
        const nextDevices = prev.devices.map((d) => {
          const devP = posMap.get(d.id)
          const updatedChannels = d.channels.map((c) => {
            const chP = posMap.get(c.id)
            return chP ? { ...c, position: { x: chP.x, y: chP.y } } : c
          })
          return {
            ...d,
            position: devP ? { x: devP.x, y: devP.y } : d.position,
            channels: updatedChannels,
          }
        })

        const updated: Project = {
          ...prev,
          blocks: nextBlocks,
          devices: nextDevices,
        }
        projectRef.current = updated
        // Flush immediately to backend for auto-layout batch
        updateProject(updated).catch((err) => {
          console.error('Failed to save layout positions:', err)
        })
        return updated
      })
    },
    []
  )

  // Place a hardware channel on the canvas as a terminal node
  const handlePlaceChannel = useCallback(
    async (channelId: string, deviceId: string, position: { x: number; y: number }) => {
      if (!project) return
      const targetRoomId = selectedRoomId || project.rooms[0]?.id || null
      const updated: Project = {
        ...project,
        devices: project.devices.map((dev) => {
          if (dev.id !== deviceId) return dev
          return {
            ...dev,
            channels: dev.channels.map((ch) => {
              if (ch.id !== channelId) return ch
              return {
                ...ch,
                position,
                room_id: targetRoomId || ch.room_id,
              }
            }),
          }
        }),
      }
      try {
        const saved = await updateProject(updated)
        setProject(saved)
      } catch (err) {
        console.error('Failed to place channel terminal:', err)
      }
    },
    [project, selectedRoomId]
  )

  // Remove a hardware channel terminal node from canvas
  const handleRemoveChannelTerminal = useCallback(
    async (channelId: string) => {
      if (!project) return
      const updated: Project = {
        ...project,
        devices: project.devices.map((dev) => ({
          ...dev,
          channels: dev.channels.map((ch) =>
            ch.id === channelId ? { ...ch, position: null } : ch
          ),
        })),
        connections: project.connections.filter(
          (c) => c.from_node_id !== channelId && c.to_node_id !== channelId
        ),
      }
      try {
        const saved = await updateProject(updated)
        setProject(saved)
        if (selectedBlockId === channelId) {
          setSelectedBlockId(null)
        }
      } catch (err) {
        console.error('Failed to remove channel terminal:', err)
      }
    },
    [project, selectedBlockId]
  )

  // Add new physical KNX device to project
  const handleAddDevice = useCallback(
    async (device: KnxDevice) => {
      if (!project) return
      const updatedProject: Project = {
        ...project,
        devices: [...project.devices, device],
      }
      try {
        const saved = await updateProject(updatedProject)
        setProject(saved)
        setSelectedBlockId(device.id)
        setIsAddDeviceModalOpen(false)
      } catch (err) {
        console.error('Failed to add device:', err)
      }
    },
    [project]
  )

  // Delete a physical KNX device from project
  const handleDeleteDevice = useCallback(
    async (deviceId: string) => {
      if (!project) return
      const targetDevice = project.devices.find((d) => d.id === deviceId)
      const channelIdSet = new Set(targetDevice ? targetDevice.channels.map((c) => c.id) : [])

      const updatedProject: Project = {
        ...project,
        devices: project.devices.filter((d) => d.id !== deviceId),
        connections: project.connections.filter((c) => {
          if (c.from_node_id === deviceId || c.to_node_id === deviceId) return false
          if (channelIdSet.has(c.from_node_id) || channelIdSet.has(c.to_node_id)) return false
          return true
        }),
      }
      try {
        const saved = await updateProject(updatedProject)
        setProject(saved)
        if (selectedBlockId === deviceId || channelIdSet.has(selectedBlockId || '')) {
          setSelectedBlockId(null)
        }
      } catch (err) {
        console.error('Failed to delete device:', err)
      }
    },
    [project, selectedBlockId]
  )

  // Place physical KNX device on canvas
  const handlePlaceDevice = useCallback(
    async (deviceId: string, position?: { x: number; y: number }) => {
      if (!project) return
      const placedCount = project.devices.filter((d) => d.position != null).length
      const targetPos = position || { x: 280, y: 120 + (placedCount % 4) * 220 }
      const currentDev = project.devices.find((d) => d.id === deviceId)
      const targetRoomId = selectedRoomId || currentDev?.room_id || null

      // 1. Optimistic update: instantly place device on canvas
      setProject((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          devices: prev.devices.map((d) =>
            d.id === deviceId
              ? {
                  ...d,
                  position: targetPos,
                  room_id: targetRoomId,
                }
              : d
          ),
        }
      })
      setSelectedBlockId(deviceId)

      // 2. Persist to backend via dedicated lightweight endpoint
      try {
        await updateDevicePosition(deviceId, targetPos, targetRoomId)
      } catch (err) {
        console.warn('Dedicated updateDevicePosition failed, trying updateProject fallback:', err)
        try {
          const updatedProject: Project = {
            ...project,
            devices: project.devices.map((d) =>
              d.id === deviceId
                ? {
                    ...d,
                    position: targetPos,
                    room_id: targetRoomId,
                  }
                : d
            ),
          }
          const saved = await updateProject(updatedProject)
          setProject(saved)
        } catch (fallbackErr) {
          console.error('Failed to place device on canvas:', fallbackErr)
        }
      }
    },
    [project, selectedRoomId]
  )

  // Remove physical KNX device from canvas (clears position, preserves device in project)
  const handleRemoveDeviceFromCanvas = useCallback(
    async (deviceId: string) => {
      if (!project) return
      // Optimistic update
      setProject((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          devices: prev.devices.map((d) =>
            d.id === deviceId ? { ...d, position: null } : d
          ),
          connections: prev.connections.filter(
            (c) => c.from_node_id !== deviceId && c.to_node_id !== deviceId
          ),
        }
      })
      if (selectedBlockId === deviceId) {
        setSelectedBlockId(null)
      }

      try {
        await updateDevicePosition(deviceId, null)
      } catch (err) {
        console.error('Failed to remove device from canvas:', err)
      }
    },
    [project, selectedBlockId]
  )

  // Update visible KOs (pins) for physical KNX device on canvas
  const handleUpdateDeviceVisibleKos = useCallback(
    async (deviceId: string, koNumbers: number[]) => {
      setProject((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          devices: prev.devices.map((d) =>
            d.id === deviceId ? { ...d, visible_ko_numbers: koNumbers } : d
          ),
        }
      })
      try {
        await updateDevicePosition(deviceId, undefined, undefined, koNumbers)
      } catch (err) {
        console.warn('Failed to update visible KOs:', err)
      }
    },
    []
  )

  // Update device in project (e.g. from KO link or parameter change)
  const handleUpdateDevice = useCallback(
    async (updatedDevice: KnxDevice) => {
      if (!project) return
      const updatedProject: Project = {
        ...project,
        devices: project.devices.map((d) => (d.id === updatedDevice.id ? updatedDevice : d)),
      }
      try {
        const saved = await updateProject(updatedProject)
        setProject(saved)
        if (deviceForKoModal?.id === updatedDevice.id) {
          setDeviceForKoModal(updatedDevice)
        }
      } catch (err) {
        console.error('Failed to update device:', err)
      }
    },
    [project, deviceForKoModal]
  )

  // Open KO & Parameter Modal for a device
  const handleOpenDeviceKoModal = useCallback((device: KnxDevice) => {
    setDeviceForKoModal(device)
    setIsDeviceKoModalOpen(true)
  }, [])

  // Set project GA scheme (FloorTradeFunction, TradeRoomFunction, TradeFunctionDevice)
  const handleSetGaScheme = useCallback(
    async (scheme: GaScheme) => {
      if (!project) return
      const updatedProject: Project = {
        ...project,
        ga_scheme: scheme,
      }
      try {
        const saved = await updateProject(updatedProject)
        setProject(saved)
      } catch (err) {
        console.error('Failed to set GA scheme:', err)
      }
    },
    [project]
  )

  // Update single Group Address (manual override / custom lock / unlock)
  const handleUpdateGroupAddress = useCallback(
    async (updatedGa: GroupAddress) => {
      if (!project) return
      const updatedProject: Project = {
        ...project,
        group_addresses: project.group_addresses.map((g) =>
          g.id === updatedGa.id ? updatedGa : g
        ),
      }
      try {
        const saved = await updateProject(updatedProject)
        setProject(saved)
      } catch (err) {
        console.error('Failed to update group address:', err)
      }
    },
    [project]
  )

  // Add new Room (from RoomTabBar)
  const handleAddRoom = useCallback(
    async (name: string, floorId: string) => {
      if (!project) return
      const newRoom = {
        id: crypto.randomUUID(),
        name,
        floor_id: floorId,
        icon: 'home',
      }
      const updated: Project = {
        ...project,
        rooms: [...project.rooms, newRoom],
      }
      try {
        const saved = await updateProject(updated)
        setProject(saved)
        setSelectedRoomId(newRoom.id)
      } catch (err) {
        console.error('Failed to add room:', err)
      }
    },
    [project]
  )

  // Interactive Wiring (Pin-to-Pin connection with Auto-GA generation)
  const handleAddConnection = useCallback(
    async (fromNode: string, fromPin: string, toNode: string, toPin: string, connId?: string) => {
      if (!project) return

      // Prevent duplicate connection between identical endpoints
      const alreadyExists = project.connections.some(
        (c) =>
          c.from_node_id === fromNode &&
          c.from_pin === fromPin &&
          c.to_node_id === toNode &&
          c.to_pin === toPin
      )
      if (alreadyExists) return

      try {
        const res = await connectPins(fromNode, fromPin, toNode, toPin, connId)
        if (res.project) {
          setProject(res.project)
        }
      } catch (err) {
        console.error('Failed to auto-wire pins via API, falling back:', err)
        const newConn: WireConnection = {
          id: connId || crypto.randomUUID(),
          from_node_id: fromNode,
          from_pin: fromPin,
          to_node_id: toNode,
          to_pin: toPin,
        }
        const updatedProject: Project = {
          ...project,
          connections: [...project.connections, newConn],
        }
        try {
          const saved = await updateProject(updatedProject)
          setProject(saved)
        } catch (saveErr) {
          console.error('Failed to save connection:', saveErr)
        }
      }
    },
    [project]
  )

  // JSON Project Export
  const handleExportJson = useCallback(() => {
    if (!project) return
    const dataStr =
      'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(project, null, 2))
    const dlAnchor = document.createElement('a')
    dlAnchor.setAttribute('href', dataStr)
    dlAnchor.setAttribute(
      'download',
      `${project.name.toLowerCase().replace(/\s+/g, '_')}_knx.json`
    )
    dlAnchor.click()
  }, [project])

  // JSON Project Import
  const handleImportJson = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (evt) => {
      try {
        const parsed = JSON.parse(evt.target?.result as string) as Project
        const saved = await updateProject(parsed)
        setProject(saved)
      } catch (err) {
        alert('Fehler beim Laden der Projektdatei: ' + err)
      }
    }
    reader.readAsText(file)
  }, [])

  if (loading) {
    const isRetrying = error && error.includes('Versuch')
    return (
      <div className="w-screen h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-300 gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
        <div className="font-semibold text-sm">KoNfiX Engine wird geladen...</div>
        {isRetrying && (
          <div className="text-xs text-slate-500 font-mono">{error}</div>
        )}
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="w-screen h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-300 gap-4 p-6 text-center">
        <div className="p-4 rounded-xl bg-red-950/40 border border-red-800 text-red-300 max-w-md">
          <div className="font-bold mb-1">Verbindungsfehler</div>
          <div className="text-xs text-red-200/80 mb-4">{error}</div>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium text-xs transition-colors"
          >
            Erneut versuchen
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="w-screen h-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden select-none">
      {/* 1. Header Bar */}
      <Header
        project={project}
        appVersion={appVersion}
        isSimulating={isSimulating}
        isWsConnected={isWsConnected}
        gatewayStatus={gatewayStatus}
        activeWorkspace={activeWorkspace}
        onWorkspaceChange={(ws) => {
          setActiveWorkspace(ws)
          if (ws === 'canvas') setDiagnosticsInitialAddress(null)
        }}
        onToggleSimulate={() => setIsSimulating(!isSimulating)}
        onAutoRoute={handleAutoRoute}
        isRouting={isRouting}
        onOpenGaManager={() => setIsGaModalOpen(true)}
        onOpenGatewayModal={() => setIsGatewayModalOpen(true)}
        onOpenImportModal={() => setIsImportModalOpen(true)}
        onOpenExportKnxprojModal={() => setIsExportKnxprojModalOpen(true)}
        onOpenProjectModal={() => setIsOpenProjectModalOpen(true)}
        onOpenStorageSettingsModal={() => setIsStorageSettingsModalOpen(true)}
        onOpenProjectCompareModal={() => setIsProjectCompareModalOpen(true)}
        onSaveProject={handleSaveProject}
        lastSavedTime={lastSavedTime}
        isSaving={isSaving}
        onExportJson={handleExportJson}
        onImportJson={handleImportJson}
      />

      {/* 2. Main Work Area: Either ETS Diagnostics Workspace, KNX Topology, or KoNfiX Logic Canvas */}
      {activeWorkspace === 'diagnostics' ? (
        <div className="flex-1 flex flex-col overflow-hidden relative w-full h-full">
          <ErrorBoundary fallbackTitle="Fehler im ETS-Diagnose-Workspace">
            <React.Suspense fallback={<WorkspaceFallback label="Diagnose-Arbeitsbereich" />}>
              <DiagnosticsWorkspace
                project={project}
                onReloadProject={handleReloadProject}
                initialAddress={diagnosticsInitialAddress}
                onSwitchToCanvas={() => {
                  setActiveWorkspace('canvas')
                  setDiagnosticsInitialAddress(null)
                }}
              />
            </React.Suspense>
          </ErrorBoundary>
        </div>
      ) : activeWorkspace === 'topology' ? (
        <div className="flex-1 flex flex-col overflow-hidden relative w-full h-full">
          <ErrorBoundary fallbackTitle="Fehler im KNX Topologie & Filtertabellen-Workspace">
            <React.Suspense fallback={<WorkspaceFallback label="Topologie-Arbeitsbereich" />}>
              <TopologyWorkspace
                project={project}
                onReloadProject={handleReloadProject}
                onSwitchToCanvas={() => setActiveWorkspace('canvas')}
                onOpenDeviceModal={(dev) => {
                  setDeviceForKoModal(dev)
                  setIsDeviceKoModalOpen(true)
                }}
              />
            </React.Suspense>
          </ErrorBoundary>
        </div>
      ) : (
        <ErrorBoundary fallbackTitle="Fehler im Projekt- & Canvas-Arbeitsbereich">
          <div className="flex-1 flex overflow-hidden relative">
            {/* Left Sidebar (Rooms & Blocks Tree) */}
            <LeftSidebar
              project={project}
              selectedRoomId={selectedRoomId}
              onSelectRoom={setSelectedRoomId}
              onAddBlock={(type) => handleAddBlock(type)}
              onAddChannelNode={(chId, devId) => handlePlaceChannel(chId, devId, { x: 80, y: 160 })}
              onOpenAddDeviceModal={() => setIsAddDeviceModalOpen(true)}
              onSelectDevice={(id) => setSelectedBlockId(id)}
              onDeleteDevice={handleDeleteDevice}
              onPlaceDevice={(id) => handlePlaceDevice(id)}
            />

            {/* Center: Visual Node Flow Canvas */}
            <main className="flex-1 h-full relative overflow-hidden flex flex-col">
              {/* Loxone-style Room / Page Tabs */}
              <RoomTabBar
                rooms={project.rooms}
                floors={project.floors}
                blocks={project.blocks}
                selectedRoomId={selectedRoomId}
                onSelectRoom={setSelectedRoomId}
                onAddRoom={handleAddRoom}
              />

              <div className="flex-1 relative overflow-hidden">
                <FlowCanvas
                  project={project}
                  selectedRoomId={selectedRoomId}
                  selectedBlockId={selectedBlockId}
                  isSimulating={isSimulating}
                  onSelectBlock={setSelectedBlockId}
                  onBlockAction={handleBlockAction}
                  onTriggerSwitch={handleTriggerSwitch}
                  onUpdateNodePosition={handleUpdateNodePosition}
                  onUpdateNodesPositions={handleUpdateNodesPositions}
                  portalPositions={portalPositions}
                  onPortalPositionsChange={handlePortalPositionsChange}
                  savedViewport={selectedRoomId ? roomViewports[selectedRoomId] : roomViewports['__all__']}
                  onViewportChange={handleViewportChange}
                  onAddConnection={handleAddConnection}
                  onDeleteBlock={handleDeleteBlock}
                  onDeleteBlocks={handleDeleteBlocks}
                  onDeleteConnection={handleDeleteConnection}
                  onDeleteConnections={handleDeleteConnections}
                  onPlaceChannel={handlePlaceChannel}
                  onRemoveChannel={handleRemoveChannelTerminal}
                  onPlaceDevice={(devId, pos) => handlePlaceDevice(devId, pos)}
                  onRemoveDeviceFromCanvas={handleRemoveDeviceFromCanvas}
                  onUpdateDeviceVisibleKos={handleUpdateDeviceVisibleKos}
                  onOpenDeviceSettings={handleOpenDeviceKoModal}
                  onAddBlockAt={(type, pos) => handleAddBlock(type, pos)}
                  onOpenMixer={(b) => setMixerBlock(b)}
                  onNavigateToRoom={(roomId, targetNodeId) => {
                    setSelectedRoomId(roomId)
                    if (targetNodeId) setSelectedBlockId(targetNodeId)
                  }}
                />
              </div>
            </main>

            {/* Right Sidebar: Block Inspector & Auto-GA Table */}
            <RightSidebar
              project={project}
              selectedBlockId={selectedBlockId}
              onUpdateBlockParams={() => {}}
              onDeleteBlock={handleDeleteBlock}
              onRemoveChannel={handleRemoveChannelTerminal}
              onDeleteDevice={handleDeleteDevice}
              onUpdateGroupAddress={handleUpdateGroupAddress}
              onOpenGaManager={() => setIsGaModalOpen(true)}
              onOpenDiagnostics={(devAddr) => {
                setDiagnosticsInitialAddress(devAddr || null)
                setActiveWorkspace('diagnostics')
              }}
              onUpdateDevice={handleUpdateDevice}
              onOpenDeviceKoModal={handleOpenDeviceKoModal}
              onOpenSecurityModal={(dev) => {
                setDeviceForSecurityModal(dev)
                setIsSecurityModalOpen(true)
              }}
            />
          </div>
        </ErrorBoundary>
      )}

      {/* 3. Bottom Drawer: Live Bus Monitor */}
      <ErrorBoundary fallbackTitle="Fehler im Live-Bus-Monitor">
        <BusMonitor
          telegrams={telegrams}
          isConnected={isWsConnected}
          isPaused={isPaused}
          onClear={clearTelegrams}
          onTogglePause={togglePause}
          project={project}
        />
      </ErrorBoundary>

      <React.Suspense fallback={null}>
        {/* 4. Hardware Catalog & Device Management Modal */}
        <AddDeviceModal
          isOpen={isAddDeviceModalOpen}
          onClose={() => setIsAddDeviceModalOpen(false)}
          existingDevices={project?.devices ?? []}
          rooms={project?.rooms ?? []}
          currentRoomId={selectedRoomId}
          onAddDevice={handleAddDevice}
        />

        {/* 4b. KNX Device KOs & Parameter Modal */}
        <ErrorBoundary fallbackTitle="Fehler im KO- & Parametertabellen-Dialog">
          {isDeviceKoModalOpen && deviceForKoModal && (
            <DeviceKoParamModal
              isOpen={isDeviceKoModalOpen}
              onClose={() => {
                setIsDeviceKoModalOpen(false)
                setDeviceForKoModal(null)
              }}
              device={deviceForKoModal}
              project={project}
              onUpdateDevice={handleUpdateDevice}
            />
          )}
        </ErrorBoundary>

        {/* 5. KNX Group Address Scheme & Management Modal */}
        <GaManagementModal
          isOpen={isGaModalOpen}
          onClose={() => setIsGaModalOpen(false)}
          project={project}
          onSetScheme={handleSetGaScheme}
          onUpdateGroupAddress={handleUpdateGroupAddress}
        />

        {/* 6. KNXnet/IP Live Gateway Connection Modal */}
        <GatewayModal
          isOpen={isGatewayModalOpen}
          onClose={() => setIsGatewayModalOpen(false)}
          connectionStatus={gatewayStatus}
          onStatusChange={setGatewayStatus}
        />

        {/* 7. ETS Project Import Modal (.knxproj / .csv) */}
        <ImportModal
          isOpen={isImportModalOpen}
          onClose={() => setIsImportModalOpen(false)}
          onImportSuccess={handleReloadProject}
        />

        {/* 7b. ETS Project Roundtrip Export Modal (.knxproj) */}
        <ExportKnxprojModal
          isOpen={isExportKnxprojModalOpen}
          onClose={() => setIsExportKnxprojModalOpen(false)}
          project={project}
        />

        {/* 8. Studio Light Mixer Modal (Loxone Stimmungen & KNX Szenen) */}
        {mixerBlock && (
          <SceneMixerModal
            isOpen={Boolean(mixerBlock)}
            onClose={() => setMixerBlock(null)}
            block={mixerBlock}
            onSaveBlock={async (updatedBlock) => {
              setMixerBlock(updatedBlock)
              if (!project) return
              const updatedBlocks = project.blocks.map((b) =>
                b.id === updatedBlock.id ? updatedBlock : b
              )
              const updatedProject = { ...project, blocks: updatedBlocks }
              setProject(updatedProject)
              try {
                await updateProject(updatedProject)
              } catch (err) {
                console.error('Failed to save project with updated scene block:', err)
              }
            }}
            onAction={async (pin, value) => {
              if (mixerBlock) {
                await handleBlockAction(mixerBlock.id, pin, value)
              }
            }}
            roomName={project?.rooms.find((r) => r.id === mixerBlock.room_id)?.name}
          />
        )}

        {/* 9. KNX Data Secure (TP) Configuration Modal */}
        <DeviceSecurityModal
          isOpen={isSecurityModalOpen}
          onClose={() => {
            setIsSecurityModalOpen(false)
            setDeviceForSecurityModal(null)
          }}
          device={deviceForSecurityModal}
          onSecuritySaved={handleReloadProject}
        />

        {/* 10. Floating KNX Flash-Manager & Sequential Job Queue */}
        <ProgrammingJobDrawer onJobsUpdated={handleReloadProject} />

        {/* 11. Open / Switch / Create Project Modal */}
        <OpenProjectModal
          isOpen={isOpenProjectModalOpen}
          onClose={() => setIsOpenProjectModalOpen(false)}
          activeProjectName={project?.name}
          onProjectLoaded={handleProjectLoaded}
        />

        {/* 12. Storage Directory & Settings Modal */}
        <StorageSettingsModal
          isOpen={isStorageSettingsModalOpen}
          onClose={() => setIsStorageSettingsModalOpen(false)}
        />

        {/* 13. Project Compare & Selective Merge Modal */}
        <ProjectCompareModal
          isOpen={isProjectCompareModalOpen}
          onClose={() => setIsProjectCompareModalOpen(false)}
          currentProject={project}
          onProjectUpdated={(p) => {
            setProject(p)
            handleReloadProject()
          }}
        />
      </React.Suspense>
    </div>
  )
}

export default App
