import React, { useState, useMemo } from 'react'
import {
  X,
  Search,
  Sliders,
  Layers,
  Cpu,
  Link,
  Unlink,
  Check,
  Save,
  RotateCcw,
  Sparkles,
  ChevronDown,
  Info,
  Filter,
  Plus,
  Folder,
  FolderOpen,
  ChevronRight,
  SlidersHorizontal,
  Settings,
  AlertCircle,
  Lock,
  ArrowUpRight,
  Eye,
  EyeOff,
  Activity,
  CheckCircle2,
  Zap,
} from 'lucide-react'
import {
  KnxDevice,
  Project,
  CommunicationObject,
  DeviceParameter,
  GroupAddress,
  DeviceLiveStateResult,
  DeviceChannel,
} from '../../types/knx'
import {
  linkKoToGroupAddress,
  updateDeviceParameters,
  readDeviceLiveState,
  createProgrammingJob,
} from '../../services/api'
import { lookupDpt } from '../../utils/dptRegistry'
import { ParameterInputField } from './ParameterInputField'

interface DeviceKoParamModalProps {
  isOpen: boolean
  onClose: () => void
  device: KnxDevice | null
  project: Project | null
  onUpdateDevice: (updatedDevice: KnxDevice) => void
}

const EMPTY_KOS: CommunicationObject[] = []
const EMPTY_PARAMS: DeviceParameter[] = []
const EMPTY_CHANNELS: DeviceChannel[] = []
const EMPTY_GAS: GroupAddress[] = []

export const DeviceKoParamModal: React.FC<DeviceKoParamModalProps> = ({
  isOpen,
  onClose,
  device,
  project,
  onUpdateDevice,
}) => {
  const [activeTab, setActiveTab] = useState<'kos' | 'parameters' | 'channels'>('kos')
  const [searchQuery, setSearchQuery] = useState('')
  const [koFilter, setKoFilter] = useState<'active' | 'all' | 'linked' | 'unlinked'>('active')
  const [paramSearch, setParamSearch] = useState('')
  const [linkingKoNum, setLinkingKoNum] = useState<number | null>(null)
  const [isSavingParams, setIsSavingParams] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [isFlashing, setIsFlashing] = useState(false)
  const [showAllParams, setShowAllParams] = useState(false)

  // Local parameter edits: Map<param_id, value>
  const [paramEdits, setParamEdits] = useState<Record<string, string>>({})
  const [selectedPage, setSelectedPage] = useState<string>('')
  const [highlightedParamId, setHighlightedParamId] = useState<string | null>(null)
  const [isReadingLive, setIsReadingLive] = useState(false)
  const [liveResult, setLiveResult] = useState<DeviceLiveStateResult | null>(null)

  const handleJumpToParam = (targetPage: string, targetParamId?: string) => {
    setSelectedPage(targetPage)
    if (targetParamId) {
      setHighlightedParamId(targetParamId)
      setTimeout(() => setHighlightedParamId(null), 2500)
      setTimeout(() => {
        const el = document.getElementById(`param-row-${targetParamId}`)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 100)
    }
  }

  React.useEffect(() => {
    if (device) {
      const initial: Record<string, string> = {}
      device.parameters?.forEach((p) => {
        initial[p.id] = p.value
      })
      setParamEdits(initial)
      setLinkingKoNum(null)
      setSaveSuccess(false)
      setLiveResult(null)
    }
  }, [device, isOpen])

  const handleReadLiveState = async () => {
    if (!device) return
    setIsReadingLive(true)
    try {
      const res = await readDeviceLiveState(device.id)
      setLiveResult(res)
    } catch (err: any) {
      setLiveResult({
        success: false,
        address: device.individual_address,
        reachable: false,
        is_synchronized: false,
        diff_count: 0,
        diff_details: [],
        message: err.message || 'Kommunikationsfehler mit dem KNX-Gateway',
      })
    } finally {
      setIsReadingLive(false)
    }
  }

  const kos = device?.communication_objects ?? EMPTY_KOS
  const params = device?.parameters ?? EMPTY_PARAMS
  const channels = device?.channels ?? EMPTY_CHANNELS
  const allGas = project?.group_addresses ?? EMPTY_GAS

  // Detailed status for parameter dependencies (hierarchical choose/when)
  interface ParamConditionStatus {
    isActive: boolean
    ctrlParam?: DeviceParameter
    ctrlParamName: string
    requiredValuesText: string
    targetPage?: string
    targetParamId?: string
  }

  const getParamConditionStatus = (p: DeviceParameter): ParamConditionStatus => {
    if (!p.depends_on) {
      return { isActive: true, ctrlParamName: '', requiredValuesText: '' }
    }

    // Check primary condition and all conditions in chain
    const conditions =
      p.depends_on.conditions && p.depends_on.conditions.length > 0
        ? p.depends_on.conditions
        : [{ param_id: p.depends_on.param_id, when_values: p.depends_on.when_values }]

    for (const cond of conditions) {
      const ctrlParam = params.find((x) => x.id === cond.param_id)
      const currentVal =
        paramEdits[cond.param_id] !== undefined
          ? paramEdits[cond.param_id]
          : ctrlParam?.value ?? ''

      const isMatch = Array.isArray(cond.when_values) && cond.when_values.includes(currentVal)
      if (!isMatch) {
        let reqText = ''
        if (ctrlParam) {
          const matchedOptions = (ctrlParam.enum_options || [])
            .filter((o) => cond.when_values.includes(o.value))
            .map((o) => `"${o.text}"`)
          if (matchedOptions.length > 0) {
            reqText = matchedOptions.join(' oder ')
          } else if (cond.when_values.length > 0) {
            reqText = cond.when_values.map((v) => `"${v}"`).join(' / ')
          }
        } else {
          reqText = cond.when_values.map((v) => `"${v}"`).join(' / ')
        }

        const ctrlName = ctrlParam?.text || ctrlParam?.name || 'Übergeordneter Parameter'
        return {
          isActive: false,
          ctrlParam,
          ctrlParamName: ctrlName,
          requiredValuesText: reqText,
          targetPage: ctrlParam?.page || undefined,
          targetParamId: ctrlParam?.id || undefined,
        }
      }
    }

    return { isActive: true, ctrlParamName: '', requiredValuesText: '' }
  }

  // Check if a KO is active based on its depends_on conditions evaluated against paramEdits & params
  const isKoActive = (ko: CommunicationObject): boolean => {
    if (!ko.depends_on) {
      if (device?.visible_ko_numbers && device.visible_ko_numbers.length > 0) {
        return device.visible_ko_numbers.includes(ko.number)
      }
      return true
    }

    const conditions =
      ko.depends_on.conditions && ko.depends_on.conditions.length > 0
        ? ko.depends_on.conditions
        : [{ param_id: ko.depends_on.param_id, when_values: ko.depends_on.when_values }]

    for (const cond of conditions) {
      const ctrlParam = params.find((x) => x.id === cond.param_id || x.name === cond.param_id)
      const currentVal =
        paramEdits[cond.param_id] !== undefined
          ? paramEdits[cond.param_id]
          : ctrlParam?.value ?? ''

      const isMatch = Array.isArray(cond.when_values) && cond.when_values.includes(currentVal)
      if (!isMatch) {
        return false
      }
    }
    return true
  }

  const isParamVisible = (p: DeviceParameter): boolean => {
    if (p.access === 'None') return false
    const nameLower = p.name.toLowerCase()
    const textLower = (p.text || '').toLowerCase()
    if (nameLower.startsWith('dummy') || textLower.startsWith('dummy')) return false
    // Hide technical internal parameter names that have no translation and contain underscores
    if (!p.text || ((p.text === p.name || textLower.replace(/ /g, '_') === nameLower) && (p.name.includes('_') || p.name.startsWith('logic_') || p.name.startsWith('SetInvisible') || p.name.startsWith('GlobalSwitch') || p.name.startsWith('OM_') || p.name.startsWith('HWT')))) {
      return false
    }
    return getParamConditionStatus(p).isActive
  }

  // Build page tree from parameters
  const pageTree = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string
        fullPath: string
        children: Map<string, { name: string; fullPath: string; count: number; visibleCount: number }>
        count: number
        visibleCount: number
      }
    >()

    params.forEach((p) => {
      const pageList = p.pages && p.pages.length > 0 ? p.pages : (p.page ? [p.page] : [])
      pageList.forEach((rawPage) => {
        const parts = rawPage.split(' > ')
        const rootName = parts[0]
        const subName = parts.length > 1 ? parts.slice(1).join(' > ') : undefined

        if (!map.has(rootName)) {
          map.set(rootName, {
            name: rootName,
            fullPath: rootName,
            children: new Map(),
            count: 0,
            visibleCount: 0,
          })
        }

        const root = map.get(rootName)!
        const visible = isParamVisible(p)

        root.count++
        if (visible) root.visibleCount++

        if (subName) {
          if (!root.children.has(subName)) {
            root.children.set(subName, {
              name: subName,
              fullPath: rawPage,
              count: 0,
              visibleCount: 0,
            })
          }
          const sub = root.children.get(subName)!
          sub.count++
          if (visible) sub.visibleCount++
        }
      })
    })

    return Array.from(map.values())
      .filter((r) => showAllParams || r.visibleCount > 0)
      .map((r) => ({
        ...r,
        children: Array.from(r.children.values()).filter((c) => showAllParams || c.visibleCount > 0),
      }))
  }, [params, paramEdits, showAllParams])

  // Automatically select the first visible page if current becomes invalid (ETS TrySelectFirst parity)
  React.useEffect(() => {
    if (pageTree.length > 0) {
      const exists = pageTree.some(
        (p) => p.fullPath === selectedPage || p.children.some((c) => c.fullPath === selectedPage)
      )
      if (!exists || !selectedPage) {
        // ETS TrySelectFirst: 1. Try to stay within current root category if visible sibling exists
        const currentRootName = selectedPage ? selectedPage.split(' > ')[0] : null
        const currentRoot = currentRootName ? pageTree.find((p) => p.name === currentRootName) : null
        if (currentRoot && (showAllParams || currentRoot.visibleCount > 0)) {
          const firstVisibleChild = currentRoot.children.find((c) => showAllParams || c.visibleCount > 0)
          setSelectedPage(firstVisibleChild?.fullPath || currentRoot.fullPath)
        } else {
          // 2. Fallback to first visible root and its first visible child
          const firstVisibleRoot = pageTree.find((p) => showAllParams || p.visibleCount > 0) || pageTree[0]
          if (firstVisibleRoot) {
            const firstVisibleChild = firstVisibleRoot.children.find((c) => showAllParams || c.visibleCount > 0)
            setSelectedPage(firstVisibleChild?.fullPath || firstVisibleRoot.fullPath)
          }
        }
      }
    }
  }, [pageTree, selectedPage, showAllParams])

  // Count of modified parameters
  const changedCount = useMemo(() => {
    return params.filter((p) => {
      const cur = paramEdits[p.id] !== undefined ? paramEdits[p.id] : p.value
      return cur !== p.default_value
    }).length
  }, [params, paramEdits])

  // Count of unsaved changes in this session
  const unsavedCount = useMemo(() => {
    return params.filter((p) => {
      const cur = paramEdits[p.id] !== undefined ? paramEdits[p.id] : p.value
      return cur !== p.value
    }).length
  }, [params, paramEdits])

  const activeKosCount = useMemo(() => {
    return kos.filter((k) => isKoActive(k)).length
  }, [kos, device, paramEdits, params])

  const totalVisibleParamsCount = useMemo(() => {
    return params.filter((p) => isParamVisible(p)).length
  }, [params, paramEdits])

  // Parameters for current selection (strictly filtered in ETS mode)
  const visibleParamsForPage = useMemo(() => {
    const q = paramSearch.toLowerCase().trim()
    return params.filter((p) => {
      // 1. Access & condition filter:
      if (!showAllParams) {
        if (p.access === 'None') return false
        if (!isParamVisible(p)) return false
      }

      // 2. Search check (if search query present, search across all parameters)
      if (q) {
        return (
          p.id?.toLowerCase().includes(q) ||
          p.name?.toLowerCase().includes(q) ||
          p.text?.toLowerCase().includes(q) ||
          p.value?.toLowerCase().includes(q) ||
          (p.section && p.section.toLowerCase().includes(q)) ||
          (p.page && p.page.toLowerCase().includes(q)) ||
          (p.pages && p.pages.some((pg) => pg.toLowerCase().includes(q)))
        )
      }

      // 3. Page match
      const pagesToCheck = p.pages && p.pages.length > 0 ? p.pages : (p.page ? [p.page] : [])
      if (pagesToCheck.length === 0) return false
      return pagesToCheck.some((pg) => pg === selectedPage || pg.startsWith(selectedPage + ' > '))
    })
  }, [params, selectedPage, paramSearch, showAllParams, paramEdits])

  // Group visible parameters into sections
  const sectionGroups = useMemo(() => {
    const groups: { section: string; items: DeviceParameter[] }[] = []
    let currentGroup: { section: string; items: DeviceParameter[] } | null = null

    visibleParamsForPage.forEach((p) => {
      const secName = p.section || ''
      if (!currentGroup || currentGroup.section !== secName) {
        currentGroup = { section: secName, items: [p] }
        groups.push(currentGroup)
      } else {
        currentGroup.items.push(p)
      }
    })

    return groups
  }, [visibleParamsForPage])

  // Filtered KOs
  const filteredKos = useMemo(() => {
    return kos.filter((ko: CommunicationObject) => {
      const q = searchQuery.toLowerCase().trim()
      const gas = ko.group_addresses ?? []
      const gaIds = ko.group_address_ids ?? []
      const matchesSearch =
        !q ||
        (ko.number !== undefined && ko.number.toString().includes(q)) ||
        (ko.name && ko.name.toLowerCase().includes(q)) ||
        (ko.object_text && ko.object_text.toLowerCase().includes(q)) ||
        (ko.function_text && ko.function_text.toLowerCase().includes(q)) ||
        (ko.dpt && ko.dpt.toLowerCase().includes(q)) ||
        gas.some((ga) => ga && ga.toLowerCase().includes(q))

      const isLinked = gas.length > 0 || gaIds.length > 0
      const isDeviceActive = isKoActive(ko)

      if (koFilter === 'active') return matchesSearch && isDeviceActive
      if (koFilter === 'linked') return matchesSearch && isLinked
      if (koFilter === 'unlinked') return matchesSearch && !isLinked
      return matchesSearch
    })
  }, [kos, searchQuery, koFilter, device, paramEdits, params])

  // Link a GA to a KO
  const handleLinkGa = async (ko: CommunicationObject, ga: GroupAddress) => {
    if (!device) return
    try {
      const updated = await linkKoToGroupAddress(
        device.id,
        ko.number,
        ga.id,
        ga.address,
        false
      )
      onUpdateDevice(updated)
      setLinkingKoNum(null)
    } catch (e) {
      console.error('Failed to link GA:', e)
      // Fallback local update
      const updatedKos = kos.map((k) => {
        if (k.number === ko.number) {
          const newGAs = k.group_addresses.includes(ga.address)
            ? k.group_addresses
            : [...k.group_addresses, ga.address]
          const newGaIds = k.group_address_ids.includes(ga.id)
            ? k.group_address_ids
            : [...k.group_address_ids, ga.id]
          return { ...k, group_addresses: newGAs, group_address_ids: newGaIds }
        }
        return k
      })
      onUpdateDevice({ ...device, communication_objects: updatedKos })
      setLinkingKoNum(null)
    }
  }

  // Unlink a GA from a KO
  const handleUnlinkGa = async (ko: CommunicationObject, gaAddress: string) => {
    if (!device) return
    const gaObj = allGas.find((g) => g.address === gaAddress)
    try {
      const updated = await linkKoToGroupAddress(
        device.id,
        ko.number,
        gaObj?.id,
        gaAddress,
        true
      )
      onUpdateDevice(updated)
    } catch (e) {
      console.error('Failed to unlink GA:', e)
      const updatedKos = kos.map((k) => {
        if (k.number === ko.number) {
          return {
            ...k,
            group_addresses: k.group_addresses.filter((a) => a !== gaAddress),
            group_address_ids: gaObj
              ? k.group_address_ids.filter((id) => id !== gaObj.id)
              : k.group_address_ids,
          }
        }
        return k
      })
      onUpdateDevice({ ...device, communication_objects: updatedKos })
    }
  }

  // Handle parameter value change with automatic ETS <Assign> synchronization
  const handleParamChange = (id: string, val: string) => {
    setParamEdits((prev) => {
      const next = { ...prev, [id]: val }

      // Generic ETS Schema 23 <Assign> rules evaluation
      if (device?.assign_rules && device.assign_rules.length > 0) {
        for (let pass = 0; pass < 4; pass++) {
          let updated = false
          for (const rule of device.assign_rules) {
            const conditionsMet = rule.conditions.every((c) => {
              const condP = params.find(
                (p) => p.id === c.param_id || p.name === c.param_id || p.id.endsWith(c.param_id)
              )
              const curVal = condP ? (next[condP.id] !== undefined ? next[condP.id] : condP.value) : ''
              return c.when_values.includes(curVal)
            })

            if (conditionsMet) {
              let targetVal: string | undefined
              if (rule.source_param_id) {
                const srcP = params.find(
                  (p) => p.id === rule.source_param_id || p.name === rule.source_param_id || p.id.endsWith(rule.source_param_id!)
                )
                if (srcP) {
                  targetVal = next[srcP.id] !== undefined ? next[srcP.id] : srcP.value
                }
              } else if (rule.value !== undefined) {
                targetVal = rule.value
              }

              if (targetVal !== undefined) {
                const targetP = params.find(
                  (p) => p.id === rule.target_param_id || p.name === rule.target_param_id || p.id.endsWith(rule.target_param_id)
                )
                if (targetP) {
                  const curTargetVal = next[targetP.id] !== undefined ? next[targetP.id] : targetP.value
                  if (curTargetVal !== targetVal) {
                    next[targetP.id] = targetVal
                    updated = true
                  }
                }
              }
            }
          }
          if (!updated) break
        }
      }

      // Check if this edit affects shutter travel time (fallback sync)
      const changedParam = params.find((p) => p.id === id)
      if (changedParam) {
        const isMudt =
          changedParam.name.startsWith('shutter_mudt') || changedParam.id.endsWith('_P-27')
        const isDiffParam =
          changedParam.name.startsWith('d_Verfahrzeit Auf/Ab') ||
          changedParam.name.startsWith('shutter_up_down_time') ||
          changedParam.id.endsWith('_P-26')

        // Find difference mode param
        const diffP = params.find(
          (p) =>
            p.name.startsWith('d_Verfahrzeit Auf/Ab') ||
            p.name.startsWith('shutter_up_down_time') ||
            p.id.endsWith('_P-26')
        )
        const diffVal = diffP ? (next[diffP.id] !== undefined ? next[diffP.id] : diffP.value) : '0'
        const isDifferent = diffVal === '1' || diffVal.toLowerCase() === 'unterschiedlich'

        if (!isDifferent) {
          if (isMudt) {
            // Mudt changed, sync to mdt (P-28)
            const mdtParams = params.filter(
              (p) => p.name.startsWith('shutter_mdt') || p.id.endsWith('_P-28')
            )
            mdtParams.forEach((mdt) => {
              next[mdt.id] = val
            })
          } else if (isDiffParam) {
            // Switched to 'gleich' (0), sync mudt to mdt
            const mudtP = params.find(
              (p) => p.name.startsWith('shutter_mudt') || p.id.endsWith('_P-27')
            )
            if (mudtP) {
              const mudtVal = next[mudtP.id] !== undefined ? next[mudtP.id] : mudtP.value
              const mdtParams = params.filter(
                (p) => p.name.startsWith('shutter_mdt') || p.id.endsWith('_P-28')
              )
              mdtParams.forEach((mdt) => {
                next[mdt.id] = mudtVal
              })
            }
          }
        }
      }

      return next
    })
    setSaveSuccess(false)
  }

  // Reset a parameter to default value
  const handleResetParam = (p: DeviceParameter) => {
    setParamEdits((prev) => ({ ...prev, [p.id]: p.default_value }))
    setSaveSuccess(false)
  }

  // Save all modified parameters
  const handleSaveParameters = async () => {
    if (!device) return
    setIsSavingParams(true)
    const updates = Object.entries(paramEdits).map(([id, value]) => ({ id, value }))
    try {
      const updated = await updateDeviceParameters(device.id, updates)
      onUpdateDevice(updated)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (e) {
      console.error('Failed to save parameters:', e)
      // Fallback local update
      const updatedParams = params.map((p) => ({
        ...p,
        value: paramEdits[p.id] !== undefined ? paramEdits[p.id] : p.value,
      }))
      const activeKoNums = kos.filter(isKoActive).map((k) => k.number)
      onUpdateDevice({ ...device, parameters: updatedParams, visible_ko_numbers: activeKoNums })
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } finally {
      setIsSavingParams(false)
    }
  }

  // Save all modified parameters and immediately trigger partial programming
  const handleSaveAndFlash = async () => {
    if (!device) return
    setIsSavingParams(true)
    setIsFlashing(true)
    const updates = Object.entries(paramEdits).map(([id, value]) => ({ id, value }))
    try {
      let updatedDev = device
      if (updates.length > 0) {
        try {
          updatedDev = await updateDeviceParameters(device.id, updates)
          onUpdateDevice(updatedDev)
        } catch (e) {
          console.error('Failed to save parameters before flash:', e)
          const updatedParams = params.map((p) => ({
            ...p,
            value: paramEdits[p.id] !== undefined ? paramEdits[p.id] : p.value,
          }))
          const activeKoNums = kos.filter(isKoActive).map((k) => k.number)
          updatedDev = { ...device, parameters: updatedParams, visible_ko_numbers: activeKoNums }
          onUpdateDevice(updatedDev)
        }
      }
      setSaveSuccess(true)
      await createProgrammingJob(device.id, 'Partial')
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (e: any) {
      console.error('Failed to trigger programming job:', e)
      alert(`Fehler beim Starten des Flash-Vorgangs: ${e?.message || e}`)
    } finally {
      setIsSavingParams(false)
      setIsFlashing(false)
    }
  }

  const handleClose = () => {
    if (unsavedCount > 0) {
      if (
        window.confirm(
          `Sie haben ${unsavedCount} ungespeicherte Parameter-Änderungen. Möchten Sie das Fenster wirklich schließen, ohne zu speichern?`
        )
      ) {
        const initial: Record<string, string> = {}
        device?.parameters?.forEach((p) => {
          initial[p.id] = p.value
        })
        setParamEdits(initial)
        onClose()
      }
    } else {
      onClose()
    }
  }

  if (!isOpen || !device) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="flex flex-col w-full max-w-5xl h-[85vh] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-100">{device.name}</h2>
                <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-sky-950 border border-sky-800 text-sky-300">
                  {device.individual_address}
                </span>
                {device.mask_version && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                    Mask: {device.mask_version}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                {device.manufacturer} — {device.model}{' '}
                {device.application_program && `(${device.application_program})`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={isReadingLive}
              onClick={handleReadLiveState}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-sky-500/10 hover:bg-sky-500/20 active:bg-sky-500/30 text-sky-400 border border-sky-500/30 transition-colors disabled:opacity-50"
              title="Fragt das physikalische Gerät live über den Bus ab (Device-Descriptor & Maske)"
            >
              <Activity className={`w-3.5 h-3.5 ${isReadingLive ? 'animate-spin' : ''}`} />
              <span>{isReadingLive ? 'Lese Gerät aus...' : 'Vom Gerät auslesen & vergleichen'}</span>
            </button>
            <button
              onClick={handleClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Live State Alert Banner */}
        {liveResult && (
          <div
            className={`mx-6 mt-4 p-3 rounded-xl border text-xs flex items-start justify-between gap-3 animate-in fade-in duration-200 ${
              liveResult.reachable
                ? liveResult.is_synchronized
                  ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                  : 'bg-amber-950/40 border-amber-500/40 text-amber-200'
                : 'bg-red-950/40 border-red-500/40 text-red-200'
            }`}
          >
            <div className="flex items-start gap-2.5">
              {liveResult.reachable ? (
                liveResult.is_synchronized ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                )
              ) : (
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              )}
              <div className="space-y-1">
                <div className="flex items-center gap-2 font-semibold">
                  <span>
                    {liveResult.reachable
                      ? liveResult.is_synchronized
                        ? 'Gerät auf dem Bus ist synchronisiert'
                        : 'Abweichungen zwischen Gerät und Projekt erkannt'
                      : 'Gerät antwortet nicht auf dem Bus'}
                  </span>
                  {liveResult.rtt_ms !== undefined && liveResult.rtt_ms !== null && (
                    <span className="font-mono text-[10px] text-slate-300 bg-slate-900/60 px-1.5 py-0.5 rounded border border-slate-700">
                      RTT: {liveResult.rtt_ms} ms
                    </span>
                  )}
                  {liveResult.mask_version && (
                    <span className="font-mono text-[10px] text-slate-300 bg-slate-900/60 px-1.5 py-0.5 rounded border border-slate-700">
                      Maske: {liveResult.mask_version}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-300">{liveResult.message}</p>
                {liveResult.diff_details && liveResult.diff_details.length > 0 && (
                  <div className="pt-1">
                    <span className="text-[10px] font-semibold text-amber-300">
                      Gefundene Unterschiede ({liveResult.diff_details.length}):
                    </span>
                    <ul className="mt-1 space-y-1 font-mono text-[10px] text-slate-300 max-h-28 overflow-y-auto">
                      {liveResult.diff_details.map((d, i) => (
                        <li key={i} className="bg-slate-900/80 p-1 rounded border border-slate-800">
                          • {d}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
            <button
              onClick={() => setLiveResult(null)}
              className="text-slate-400 hover:text-slate-200 p-1 rounded hover:bg-slate-800 transition-colors"
              title="Ausblenden"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Tabs Bar */}
        <div className="flex items-center justify-between px-6 border-b border-slate-800 bg-slate-900/50">
          <div className="flex gap-1">
            <button
              onClick={() => setActiveTab('kos')}
              className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-all ${
                activeTab === 'kos'
                  ? 'border-sky-500 text-sky-400 bg-sky-500/5'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Kommunikationsobjekte (KOs)</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-800 text-slate-300">
                {activeKosCount < kos.length ? `${activeKosCount}/${kos.length}` : kos.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('parameters')}
              className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-all ${
                activeTab === 'parameters'
                  ? 'border-emerald-500 text-emerald-400 bg-emerald-500/5'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Geräte-Parameter</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-800 text-slate-300">
                {totalVisibleParamsCount < params.length ? `${totalVisibleParamsCount}/${params.length}` : params.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('channels')}
              className={`flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 transition-all ${
                activeTab === 'channels'
                  ? 'border-indigo-500 text-indigo-400 bg-indigo-500/5'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>Kanäle & Klemmen</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-800 text-slate-300">
                {channels.length}
              </span>
            </button>
          </div>

          {/* Quick info badges */}
          <div className="flex items-center gap-3 text-xs text-slate-400">
            {device.bus_current_ma && (
              <span className="bg-slate-800/80 px-2 py-1 rounded text-[11px] font-mono text-slate-300">
                Stromaufnahme: {device.bus_current_ma} mA
              </span>
            )}
          </div>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'kos' && (
            <div className="space-y-4">
              {/* Filter & Search Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950/40 p-3 rounded-xl border border-slate-800/80">
                <div className="relative flex-1 min-w-[240px]">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="KOs durchsuchen (Name, Funktion, #Nr, DPT, GA)..."
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-4 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5 bg-slate-900 p-1 rounded-lg border border-slate-800 text-xs">
                  <button
                    onClick={() => setKoFilter('active')}
                    className={`px-2.5 py-1 rounded transition-colors ${
                      koFilter === 'active'
                        ? 'bg-sky-500/20 text-sky-400 font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Aktive KOs ({activeKosCount})
                  </button>
                  <button
                    onClick={() => setKoFilter('linked')}
                    className={`px-2.5 py-1 rounded transition-colors ${
                      koFilter === 'linked'
                        ? 'bg-sky-500/20 text-sky-400 font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Verknüpft ({kos.filter((k) => (k.group_addresses ?? []).length > 0).length})
                  </button>
                  <button
                    onClick={() => setKoFilter('all')}
                    className={`px-2.5 py-1 rounded transition-colors ${
                      koFilter === 'all'
                        ? 'bg-sky-500/20 text-sky-400 font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Alle ({kos.length})
                  </button>
                </div>
              </div>

              {/* KOs Table or Empty State */}
              {kos.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-4 bg-slate-950/20 rounded-xl border border-slate-800/60 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-slate-800/60 border border-slate-700/40 flex items-center justify-center">
                    <Layers className="w-7 h-7 text-slate-500 opacity-60" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-300">Keine Kommunikationsobjekte</p>
                    <p className="text-xs text-slate-500 mt-1 max-w-sm">
                      Für dieses Gerät wurden noch keine KO-Daten importiert.
                      Laden Sie die passende <span className="font-mono text-sky-400">.knxprod</span>-Datei über den Katalog-Browser.
                    </p>
                  </div>
                </div>
              ) : (
              <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/30">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-950/60 border-b border-slate-800 text-slate-400 font-medium">
                      <th className="py-2.5 px-3 w-12 text-center">#</th>
                      <th className="py-2.5 px-3 w-44">Name / Objekt</th>
                      <th className="py-2.5 px-3 w-48">Funktion</th>
                      <th className="py-2.5 px-3 w-28">Länge / DPT</th>
                      <th className="py-2.5 px-3 w-24 text-center">Flags</th>
                      <th className="py-2.5 px-3">Verknüpfte Gruppenadressen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {filteredKos.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="py-8 text-center text-slate-500 italic"
                        >
                          Keine Kommunikationsobjekte entsprechen den Suchkriterien.
                        </td>
                      </tr>
                    ) : (
                      filteredKos.map((ko) => {
                        const isLinking = linkingKoNum === ko.number
                        return (
                          <tr
                            key={ko.id || ko.number}
                            className="hover:bg-slate-800/30 transition-colors group"
                          >
                            {/* # Number */}
                            <td className="py-2 px-3 text-center font-mono text-slate-400 font-bold">
                              {ko.number}
                            </td>

                            {/* Name */}
                            <td className="py-2 px-3">
                              <div className="font-semibold text-slate-200 truncate">
                                {ko.object_text || ko.name}
                              </div>
                              {ko.name && ko.object_text && ko.name !== ko.object_text && (
                                <div className="text-[10px] text-slate-400 font-mono truncate">
                                  {ko.name}
                                </div>
                              )}
                            </td>

                            {/* Function */}
                            <td className="py-2 px-3 text-slate-300 truncate">
                              {ko.function_text || '—'}
                            </td>

                            {/* DPT & Size */}
                            <td className="py-2 px-3">
                              {(() => {
                                const dptInfo = lookupDpt(ko.dpt)
                                const tooltipText = dptInfo
                                  ? `${dptInfo.name} (${dptInfo.dpt})\n${dptInfo.descriptionDe}\nFormat: ${dptInfo.format}${dptInfo.unit ? ` (${dptInfo.unit})` : ''}${dptInfo.isFloat ? ' [Fließkomma]' : ' [Ganzzahl]'}`
                                  : `DPT ${ko.dpt}`
                                return (
                                  <div className="flex items-center gap-1.5" title={tooltipText}>
                                    <span className="font-mono text-sky-400 bg-sky-950/80 px-1.5 py-0.5 rounded border border-sky-800/40 text-[11px] cursor-help hover:border-sky-500 transition-colors">
                                      {dptInfo ? dptInfo.dpt : ko.dpt}
                                    </span>
                                    {dptInfo?.unit && (
                                      <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 px-1 py-0.5 rounded border border-emerald-800/30">
                                        {dptInfo.unit}
                                      </span>
                                    )}
                                    {ko.object_size && (
                                      <span className="text-[10px] text-slate-400">
                                        {ko.object_size}
                                      </span>
                                    )}
                                  </div>
                                )
                              })()}
                            </td>

                            {/* Flags: C, R, W, T, U */}
                            <td className="py-2 px-3 text-center">
                              <div className="inline-flex gap-1 font-mono text-[10px] font-bold">
                                  <span
                                    title="Communication: Freigabe der Kommunikation"
                                    className={`w-4 h-4 rounded flex items-center justify-center ${
                                      ko.flags?.communication
                                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                        : 'bg-slate-800/50 text-slate-600'
                                    }`}
                                  >
                                    C
                                  </span>
                                  <span
                                    title="Read: Objektwert kann ausgelesen werden"
                                    className={`w-4 h-4 rounded flex items-center justify-center ${
                                      ko.flags?.read
                                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                        : 'bg-slate-800/50 text-slate-600'
                                    }`}
                                  >
                                    R
                                  </span>
                                  <span
                                    title="Write: Objektwert kann beschrieben werden"
                                    className={`w-4 h-4 rounded flex items-center justify-center ${
                                      ko.flags?.write
                                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                        : 'bg-slate-800/50 text-slate-600'
                                    }`}
                                  >
                                    W
                                  </span>
                                  <span
                                    title="Transmit: Objekt sendet Wertänderungen auf den Bus"
                                    className={`w-4 h-4 rounded flex items-center justify-center ${
                                      ko.flags?.transmit
                                        ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                                        : 'bg-slate-800/50 text-slate-600'
                                    }`}
                                  >
                                    T
                                  </span>
                                  <span
                                    title="Update: Objekt wird durch Antworttelegramme aktualisiert"
                                    className={`w-4 h-4 rounded flex items-center justify-center ${
                                      ko.flags?.update
                                        ? 'bg-teal-500/20 text-teal-400 border border-teal-500/30'
                                        : 'bg-slate-800/50 text-slate-600'
                                    }`}
                                  >
                                    U
                                  </span>
                                </div>
                              </td>

                              {/* Linked GAs */}
                              <td className="py-2 px-3">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {(ko.group_addresses ?? []).map((gaAddr) => {
                                    const gaObj = allGas.find((g) => g.address === gaAddr)
                                    const partnerDevs = project?.devices?.filter(
                                      (d) => d.id !== device.id && d.communication_objects?.some((k) => (k.group_addresses || []).includes(gaAddr))
                                    ) || []

                                  return (
                                    <span
                                      key={gaAddr}
                                      className="inline-flex items-center gap-1.5 font-mono text-[11px] bg-slate-900 border border-sky-800/40 text-sky-300 px-2 py-0.5 rounded-md group/chip"
                                      title={
                                        gaObj
                                          ? `${gaObj.name}${partnerDevs.length > 0 ? `\nVerbunden mit: ${partnerDevs.map(d => `${d.individual_address} ${d.name}`).join(', ')}` : ''}`
                                          : gaAddr
                                      }
                                    >
                                      <span className="font-bold">{gaAddr}</span>
                                      {gaObj && (
                                        <span className="text-slate-400 font-sans max-w-[120px] truncate text-[10px]">
                                          {gaObj.name}
                                        </span>
                                      )}
                                      {partnerDevs.length > 0 && (
                                        <span
                                          className="text-[9px] font-sans px-1 py-0.2 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800/40 flex items-center gap-0.5"
                                          title={`Verknüpft mit: ${partnerDevs.map(d => `${d.individual_address} ${d.name}`).join(', ')}`}
                                        >
                                          <span>↔</span>
                                          <span>{partnerDevs.map(d => d.individual_address).join(', ')}</span>
                                        </span>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => handleUnlinkGa(ko, gaAddr)}
                                        className="text-slate-500 hover:text-red-400 transition-colors ml-0.5"
                                        title="Verknüpfung trennen"
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    </span>
                                  )
                                })}

                                {/* Add GA Button */}
                                <div className="relative">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setLinkingKoNum(isLinking ? null : ko.number)
                                    }
                                    className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded border transition-colors ${
                                      isLinking
                                        ? 'bg-sky-500 text-slate-950 border-sky-400'
                                        : 'bg-slate-800/60 hover:bg-slate-800 text-slate-300 border-slate-700'
                                    }`}
                                  >
                                    <Plus className="w-3 h-3" />
                                    <span>GA</span>
                                  </button>

                                  {/* Popover to select an existing GA */}
                                  {isLinking && (
                                    <div className="absolute left-0 mt-1 w-64 bg-slate-900 border border-slate-700 rounded-xl shadow-xl z-30 p-2 space-y-1.5">
                                      <div className="text-[11px] font-bold text-slate-300 px-1">
                                        Gruppenadresse auswählen:
                                      </div>
                                      <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                                        {allGas.length === 0 ? (
                                          <div className="text-[11px] text-slate-500 p-2 italic">
                                            Keine Gruppenadressen im Projekt vorhanden.
                                          </div>
                                        ) : (
                                          allGas.map((ga) => {
                                            const alreadyLinked =
                                              (ko.group_addresses ?? []).includes(ga.address)
                                            return (
                                              <button
                                                key={ga.id}
                                                type="button"
                                                disabled={alreadyLinked}
                                                onClick={() => handleLinkGa(ko, ga)}
                                                className={`w-full text-left px-2 py-1 rounded text-[11px] flex items-center justify-between transition-colors ${
                                                  alreadyLinked
                                                    ? 'opacity-40 cursor-not-allowed bg-slate-950/40 text-slate-500'
                                                    : 'hover:bg-sky-500/20 hover:text-sky-300 text-slate-200'
                                                }`}
                                              >
                                                <span className="font-mono font-bold text-sky-400">
                                                  {ga.address}
                                                </span>
                                                <span className="truncate max-w-[130px] text-slate-400 text-[10px]">
                                                  {ga.name}
                                                </span>
                                              </button>
                                            )
                                          })
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
              )}
            </div>
          )}

          {activeTab === 'parameters' && (
            <div className="space-y-4">
              {/* Header bar with breadcrumb, search and Save button */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950/50 p-3 rounded-xl border border-slate-800/80">
                <div className="flex items-center gap-2 min-w-[200px]">
                  <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                    <SlidersHorizontal className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-slate-200">
                      {paramSearch ? 'Suchergebnisse' : selectedPage || pageTree[0]?.name || ''}
                    </h3>
                    <div className="flex items-center gap-2 text-[10px] text-slate-400">
                      <span>{visibleParamsForPage.length} Parameter aktiv</span>
                      {changedCount > 0 && (
                        <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-medium border border-amber-500/30">
                          {changedCount} geändert
                        </span>
                      )}
                      {unsavedCount > 0 && (
                        <span className="px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-300 font-medium border border-sky-500/30">
                          {unsavedCount} ungespeichert
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-1 max-w-md justify-end">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={paramSearch}
                      onChange={(e) => setParamSearch(e.target.value)}
                      placeholder="Parameter suchen (über alle Seiten)..."
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-7 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                    />
                    {paramSearch && (
                      <button
                        onClick={() => setParamSearch('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowAllParams(!showAllParams)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors shrink-0 ${
                      showAllParams
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
                        : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-slate-100'
                    }`}
                    title={showAllParams ? 'Entwickler-Modus: Alle internen und inaktiven Parameter anzeigen' : 'ETS-Modus: Nur aktive Parameter anzeigen'}
                  >
                    {showAllParams ? <Eye className="w-3.5 h-3.5 text-amber-400" /> : <EyeOff className="w-3.5 h-3.5 text-slate-400" />}
                    <span>{showAllParams ? 'Alle Parameter' : 'Nur aktive (ETS)'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveParameters}
                    disabled={isSavingParams || isFlashing}
                    className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all shrink-0 ${
                      saveSuccess
                        ? 'bg-emerald-500 text-slate-950'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    }`}
                  >
                    {saveSuccess ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Gespeichert</span>
                      </>
                    ) : (
                      <>
                        <Save className="w-3.5 h-3.5" />
                        <span>Speichern</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveAndFlash}
                    disabled={isSavingParams || isFlashing}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all shrink-0 bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white disabled:opacity-50"
                    title="Speichert alle Parameter und startet direkt die partielle KNX-Programmierung"
                  >
                    <Zap className={`w-3.5 h-3.5 ${isFlashing ? 'animate-bounce text-amber-300' : 'text-sky-200'}`} />
                    <span>{isFlashing ? 'Wird geflasht...' : 'Speichern & Flashen'}</span>
                  </button>
                </div>
              </div>

              {/* Two-Column ETS Workspace: Left Page Tree + Right Parameter List */}
              <div className="flex flex-col md:flex-row gap-4 min-h-[480px]">
                {/* Left Navigation Sidebar: Page Tree */}
                {!paramSearch && (
                  <div className="w-full md:w-64 shrink-0 bg-slate-950/40 border border-slate-800/80 rounded-xl p-2.5 overflow-y-auto max-h-[580px] space-y-1">
                    <div className="px-2 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-800/60 mb-1.5">
                      <Layers className="w-3 h-3 text-emerald-400" />
                      <span>Kanal & Parameterseiten</span>
                    </div>

                    {pageTree.map((root) => {
                      const isRootSelected = selectedPage === root.fullPath
                      const hasChildren = root.children.length > 0

                      return (
                        <div key={root.fullPath} className="space-y-0.5">
                          <button
                            type="button"
                            onClick={() => setSelectedPage(root.fullPath)}
                            className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between transition-colors ${
                              isRootSelected
                                ? 'bg-emerald-600 text-white font-medium shadow-sm'
                                : 'text-slate-300 hover:bg-slate-900 hover:text-slate-100'
                            }`}
                          >
                            <div className="flex items-center gap-2 truncate">
                              {hasChildren ? (
                                <Folder className={`w-3.5 h-3.5 shrink-0 ${isRootSelected ? 'text-white' : 'text-emerald-400'}`} />
                              ) : (
                                <Sliders className={`w-3.5 h-3.5 shrink-0 ${isRootSelected ? 'text-white' : 'text-slate-400'}`} />
                              )}
                              <span className="truncate">{root.name}</span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0 ml-1">
                              {root.visibleCount < root.count && (
                                <span title="Einige Parameter sind bedingt deaktiviert">
                                  <Lock className={`w-2.5 h-2.5 ${isRootSelected ? 'text-white/80' : 'text-amber-400'}`} />
                                </span>
                              )}
                              <span
                                className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                                  isRootSelected
                                    ? 'bg-emerald-700/80 text-white'
                                    : root.visibleCount > 0
                                    ? 'bg-slate-800 text-slate-400'
                                    : 'bg-slate-900 text-slate-600'
                                }`}
                                title={`${root.visibleCount} aktiv von ${root.count} Parametern`}
                              >
                                {root.visibleCount < root.count ? `${root.visibleCount}/${root.count}` : root.count}
                              </span>
                            </div>
                          </button>

                          {/* Sub-Pages */}
                          {hasChildren && (
                            <div className="pl-4 space-y-0.5 border-l border-slate-800/60 ml-3 my-0.5">
                              {root.children.map((child) => {
                                const isChildSelected = selectedPage === child.fullPath
                                const isChildActive = child.visibleCount > 0

                                return (
                                  <button
                                    key={child.fullPath}
                                    type="button"
                                    onClick={() => setSelectedPage(child.fullPath)}
                                    title={!isChildActive ? 'Aktuell inaktiv durch Optionsabhängigkeit' : `${child.visibleCount} aktiv von ${child.count}`}
                                    className={`w-full text-left px-2 py-1.2 rounded-md text-[11px] flex items-center justify-between transition-colors ${
                                      isChildSelected
                                        ? 'bg-emerald-600/90 text-white font-medium shadow-sm'
                                        : isChildActive
                                        ? 'text-slate-300 hover:bg-slate-900 hover:text-slate-100'
                                        : 'text-slate-500 hover:bg-slate-900/40 hover:text-slate-400 opacity-60'
                                    }`}
                                  >
                                    <span className="truncate">{child.name}</span>
                                    <div className="flex items-center gap-1 shrink-0 ml-1">
                                      {child.visibleCount < child.count && (
                                        <span title="Bedingt eingeschränkt">
                                          <Lock className={`w-2 h-2 ${isChildSelected ? 'text-white/80' : 'text-amber-400'}`} />
                                        </span>
                                      )}
                                      <span
                                        className={`text-[9px] px-1 rounded font-mono ${
                                          isChildSelected
                                            ? 'bg-emerald-700 text-white'
                                            : isChildActive
                                            ? 'bg-slate-800/80 text-slate-400'
                                            : 'text-slate-600'
                                        }`}
                                      >
                                        {child.visibleCount < child.count ? `${child.visibleCount}/${child.count}` : child.count}
                                      </span>
                                    </div>
                                  </button>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Right Parameter Workspace: Section Headers and Clean Rows */}
                <div className="flex-1 min-w-0 bg-slate-950/40 border border-slate-800/80 rounded-xl p-4 overflow-y-auto max-h-[580px] space-y-4">
                  {visibleParamsForPage.length === 0 ? (
                    <div className="py-16 text-center space-y-3">
                      <div className="inline-flex p-3 rounded-full bg-slate-900 text-slate-500 border border-slate-800">
                        <AlertCircle className="w-6 h-6" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-slate-300">
                          Keine aktiven Parameter in dieser Ansicht
                        </p>
                        <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                          Die zugehörige Funktion (z.B. Automatik, Sperre oder Alarm) ist für diesen Kanal aktuell nicht aktiviert. Aktivieren Sie die entsprechende Option in den Einstellungen, um die Parameter einzublenden.
                        </p>
                      </div>
                    </div>
                  ) : (
                    sectionGroups.map((group, groupIdx) => (
                      <div key={groupIdx} className="space-y-2">
                        {/* Section Divider Header (like in ETS) */}
                        {group.section && (
                          <div className="pt-3 pb-1.5 border-b border-slate-800/80 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="w-1.5 h-3 bg-emerald-500 rounded-full" />
                              <h4 className="text-xs font-bold text-slate-200 tracking-wide">
                                {group.section}
                              </h4>
                            </div>
                          </div>
                        )}

                        {/* Parameter Rows */}
                        <div className="space-y-1.5">
                          {group.items.map((p) => {
                            const condStatus = getParamConditionStatus(p)
                            const isActive = condStatus.isActive
                            const currentVal =
                              paramEdits[p.id] !== undefined ? paramEdits[p.id] : p.value
                            const isChanged = currentVal !== p.default_value

                            return (
                              <div
                                key={p.id}
                                id={`param-row-${p.id}`}
                                className={`flex flex-col gap-2 p-2.5 rounded-lg border transition-all ${
                                  highlightedParamId === p.id
                                    ? 'ring-2 ring-amber-400 bg-amber-500/15 border-amber-400 shadow-[0_0_15px_rgba(251,191,36,0.35)] animate-pulse'
                                    : !isActive
                                    ? 'opacity-60 bg-slate-950/40 border-dashed border-slate-800'
                                    : isChanged
                                    ? 'bg-emerald-950/20 border-emerald-800/50'
                                    : 'bg-slate-900/40 border-slate-800/60 hover:border-slate-700/80 hover:bg-slate-900/70'
                                }`}
                              >
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                  <div className="sm:w-1/2 pr-2">
                                    <div className="flex items-center gap-2">
                                      <label
                                        className={`text-xs font-medium block truncate ${
                                          !isActive ? 'text-slate-400' : 'text-slate-200'
                                        }`}
                                        title={p.text || p.name}
                                      >
                                        {p.text || p.name}
                                      </label>
                                      {!isActive && (
                                        <span title="Gesperrt">
                                          <Lock className="w-3 h-3 text-amber-400 shrink-0" />
                                        </span>
                                      )}
                                      {p.offset !== undefined && p.offset !== null && (
                                        <span
                                          className="text-[9px] font-mono text-slate-400 bg-slate-950/80 border border-slate-800 px-1 py-0.5 rounded shrink-0"
                                          title={`Speicher-Offset: 0x${p.offset.toString(16).toUpperCase().padStart(4, '0')} (${p.size_in_bit || 16} Bit, BitOffset: ${p.bit_offset || 0})`}
                                        >
                                          0x{p.offset.toString(16).toUpperCase().padStart(4, '0')}
                                        </span>
                                      )}
                                      {isChanged && isActive && (
                                        <span
                                          className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"
                                          title="Wert geändert"
                                        />
                                      )}
                                    </div>
                                    {paramSearch && p.page && (
                                      <span className="text-[10px] text-slate-500 block truncate mt-0.5">
                                        {p.page}
                                      </span>
                                    )}
                                  </div>

                                  <div className="sm:w-1/2 flex items-center justify-end gap-2">
                                    {/* Control 1: Binary Segmented Pill (2 options) */}
                                    {p.enum_options && p.enum_options.length === 2 ? (
                                      <div className={`inline-flex rounded-lg p-0.5 bg-slate-950/90 border border-slate-800 shrink-0 ${!isActive ? 'opacity-50 pointer-events-none' : ''}`}>
                                        {p.enum_options.map((opt) => {
                                          const isSelected = currentVal === opt.value
                                          return (
                                            <button
                                              key={opt.value}
                                              type="button"
                                              disabled={!isActive}
                                              onClick={() => handleParamChange(p.id, opt.value)}
                                              className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                                                isSelected
                                                  ? 'bg-emerald-600 text-white shadow-sm font-semibold'
                                                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                                              } disabled:cursor-not-allowed`}
                                            >
                                              {opt.text}
                                            </button>
                                          )
                                        })}
                                      </div>
                                    ) : p.enum_options && p.enum_options.length > 2 ? (
                                      /* Control 2: Multi-Option Select Dropdown */
                                      <select
                                        value={currentVal}
                                        disabled={!isActive}
                                        onChange={(e) => handleParamChange(p.id, e.target.value)}
                                        className="w-full max-w-[280px] bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 cursor-pointer truncate disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-900/50"
                                      >
                                        {p.enum_options.map((opt) => (
                                          <option key={opt.value} value={opt.value}>
                                            {opt.text}
                                          </option>
                                        ))}
                                      </select>
                                    ) : p.options && p.options.length > 0 ? (
                                      /* Control 3: Fallback Legacy Options */
                                      <select
                                        value={currentVal}
                                        disabled={!isActive}
                                        onChange={(e) => handleParamChange(p.id, e.target.value)}
                                        className="w-full max-w-[280px] bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 cursor-pointer truncate disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-900/50"
                                      >
                                        {p.options.map((opt) => (
                                          <option key={opt} value={opt}>
                                            {opt}
                                          </option>
                                        ))}
                                      </select>
                                    ) : p.param_type === 'number' || p.suffix || p.min !== undefined || p.max !== undefined ? (
                                      /* Control 4: Validated Number / Float / Time Input */
                                      <ParameterInputField
                                        param={p}
                                        value={currentVal}
                                        disabled={!isActive}
                                        onChange={(val) => handleParamChange(p.id, val)}
                                      />
                                    ) : (
                                      /* Control 5: Standard Text Input */
                                      <input
                                        type="text"
                                        value={currentVal}
                                        disabled={!isActive}
                                        onChange={(e) => handleParamChange(p.id, e.target.value)}
                                        className="w-full max-w-[280px] bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-900/50"
                                      />
                                    )}

                                    {/* Reset to default button */}
                                    {isChanged && isActive && (
                                      <button
                                        type="button"
                                        onClick={() => handleResetParam(p)}
                                        className="text-slate-400 hover:text-emerald-400 p-1.5 hover:bg-slate-800 rounded-lg transition-colors shrink-0"
                                        title={`Auf Standard zurücksetzen (${p.default_value}${p.suffix || ''})`}
                                      >
                                        <RotateCcw className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {/* Prerequisite Warning Banner if Inactive */}
                                {!isActive && (
                                  <div className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg bg-amber-950/30 border border-amber-500/25 text-amber-300 text-[11px] select-none">
                                    <div className="flex items-center gap-1.5 font-medium">
                                      <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                      <span>
                                        Gesperrt: Erfordert {condStatus.targetPage && condStatus.targetPage !== selectedPage ? `in "${condStatus.targetPage}" ` : ''}
                                        <strong>{condStatus.ctrlParamName}</strong> = <span className="font-bold text-amber-200">{condStatus.requiredValuesText}</span>
                                      </span>
                                    </div>
                                    {condStatus.targetPage && (
                                      <button
                                        type="button"
                                        onClick={() => handleJumpToParam(condStatus.targetPage!, condStatus.targetParamId)}
                                        className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-[10px] font-semibold transition-colors cursor-pointer"
                                        title={`Zu "${condStatus.targetPage}" springen und Parameter hervorheben`}
                                      >
                                        <span>Zur Einstellung</span>
                                        <ArrowUpRight className="w-3 h-3" />
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'channels' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {channels.map((ch) => {
                  const room = project?.rooms?.find((r) => r.id === ch.room_id)
                  return (
                    <div
                      key={ch.id}
                      className="p-3 rounded-xl border border-slate-800 bg-slate-950/30 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-sky-400 bg-sky-950/80 px-2 py-0.5 rounded border border-sky-800/40">
                          {ch.channel_code}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                          {ch.channel_type}
                        </span>
                      </div>
                      <div className="text-xs font-semibold text-slate-200">{ch.name}</div>
                      <div className="text-[11px] text-slate-400 flex items-center justify-between pt-1 border-t border-slate-800/60">
                        <span>Zugewiesener Raum:</span>
                        <span className="text-slate-200 font-medium">
                          {room ? room.name : '— (Nicht zugewiesen)'}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-800 bg-slate-950/50 text-xs text-slate-400">
          <div>
            Gerät ID: <span className="font-mono text-slate-500">{device.id}</span>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors font-medium"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  )
}
