import React, { useState, useEffect } from 'react'
import {
  X,
  GitCompare,
  Check,
  Upload,
  ArrowRight,
  Plus,
  Trash2,
  Edit2,
  Layers,
  Cpu,
  Sliders,
  Link as LinkIcon,
  RefreshCw,
  FolderOpen,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react'
import {
  Project,
  ProjectDiff,
  SelectiveMergeRequest,
  MergeSummary,
} from '../../types/knx'
import { ProjectMetadata } from '../../types/storage'
import {
  compareProjects,
  mergeProjects,
  listStorageProjects,
  loadStorageProject,
} from '../../services/api'
import { useTranslation } from '../../i18n/I18nContext'

interface ProjectCompareModalProps {
  isOpen: boolean
  onClose: () => void
  currentProject: Project | null
  onProjectUpdated?: (updatedProject: Project) => void
}

export const ProjectCompareModal: React.FC<ProjectCompareModalProps> = ({
  isOpen,
  onClose,
  currentProject,
  onProjectUpdated,
}) => {
  const { t } = useTranslation()

  // State
  const [availableProjects, setAvailableProjects] = useState<ProjectMetadata[]>([])
  const [selectedFilename, setSelectedFilename] = useState<string>('')
  const [compareProject, setCompareProject] = useState<Project | null>(null)
  const [diff, setDiff] = useState<ProjectDiff | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [isMerging, setIsMerging] = useState<boolean>(false)
  const [mergeSummary, setMergeSummary] = useState<MergeSummary | null>(null)
  const [activeTab, setActiveTab] = useState<'gas' | 'devices' | 'parameters' | 'kos'>('gas')
  const [error, setError] = useState<string | null>(null)

  // Selection state for selective merge
  const [selectedGas, setSelectedGas] = useState<Set<string>>(new Set())
  const [selectedDevices, setSelectedDevices] = useState<Set<string>>(new Set())
  const [selectedParams, setSelectedParams] = useState<Set<string>>(new Set()) // `${device_address}:${param_id}`
  const [selectedKos, setSelectedKos] = useState<Set<string>>(new Set()) // `${device_address}:${ko_number}`

  useEffect(() => {
    if (isOpen) {
      loadProjectsList()
      setDiff(null)
      setMergeSummary(null)
      setError(null)
    }
  }, [isOpen])

  const loadProjectsList = async () => {
    try {
      const list = await listStorageProjects()
      // Exclude current project if possible
      setAvailableProjects(list.filter((p: ProjectMetadata) => p.name !== currentProject?.name))
    } catch (err: any) {
      console.error('Failed to list projects:', err)
    }
  }

  const handleSelectProject = async (filename: string) => {
    setSelectedFilename(filename)
    if (!filename || !currentProject) return

    setIsLoading(true)
    setError(null)
    setMergeSummary(null)
    try {
      const loaded = await loadStorageProject(filename)
      setCompareProject(loaded)
      const diffResult = await compareProjects(loaded)
      setDiff(diffResult)
      // Preselect all changes by default
      selectAllDiffs(diffResult)
    } catch (err: any) {
      setError(err.message || 'Fehler beim Laden des Vergleichsprojekts')
    } finally {
      setIsLoading(false)
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !currentProject) return

    setIsLoading(true)
    setError(null)
    setMergeSummary(null)

    try {
      const text = await file.text()
      let parsedProj: Project
      try {
        parsedProj = JSON.parse(text)
      } catch {
        throw new Error('Ungültiges Projektdateiformat (erwartet JSON oder exportiertes KoNfiX-Projekt)')
      }

      setCompareProject(parsedProj)
      const diffResult = await compareProjects(parsedProj)
      setDiff(diffResult)
      selectAllDiffs(diffResult)
    } catch (err: any) {
      setError(err.message || 'Fehler beim Parsen der Datei')
    } finally {
      setIsLoading(false)
    }
  }

  const selectAllDiffs = (d: ProjectDiff) => {
    setSelectedGas(new Set(d.group_addresses.map((g) => g.address)))
    setSelectedDevices(new Set(d.devices.map((dev) => dev.individual_address)))
    setSelectedParams(new Set(d.parameters.map((p) => `${p.device_address}:${p.param_id}`)))
    setSelectedKos(new Set(d.ko_links.map((k) => `${k.device_address}:${k.ko_number}`)))
  }

  const deselectAll = () => {
    setSelectedGas(new Set())
    setSelectedDevices(new Set())
    setSelectedParams(new Set())
    setSelectedKos(new Set())
  }

  const toggleGa = (addr: string) => {
    const next = new Set(selectedGas)
    if (next.has(addr)) next.delete(addr)
    else next.add(addr)
    setSelectedGas(next)
  }

  const toggleDevice = (addr: string) => {
    const next = new Set(selectedDevices)
    if (next.has(addr)) next.delete(addr)
    else next.add(addr)
    setSelectedDevices(next)
  }

  const toggleParam = (key: string) => {
    const next = new Set(selectedParams)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setSelectedParams(next)
  }

  const toggleKo = (key: string) => {
    const next = new Set(selectedKos)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setSelectedKos(next)
  }

  const handleMerge = async (mergeAll: boolean = false) => {
    if (!compareProject) return

    setIsMerging(true)
    setError(null)

    try {
      const paramItems = (diff?.parameters || [])
        .filter((p) => mergeAll || selectedParams.has(`${p.device_address}:${p.param_id}`))
        .map((p) => ({
          device_address: p.device_address,
          param_id: p.param_id,
          value: p.value_compare || '',
        }))

      const koItems = (diff?.ko_links || [])
        .filter((k) => mergeAll || selectedKos.has(`${k.device_address}:${k.ko_number}`))
        .map((k) => ({
          device_address: k.device_address,
          ko_number: k.ko_number,
          gas: k.gas_compare,
        }))

      const req: SelectiveMergeRequest = {
        compare_project: compareProject,
        compare_project_filename: selectedFilename || null,
        merge_gas: mergeAll ? (diff?.group_addresses.map((g) => g.address) || []) : Array.from(selectedGas),
        merge_devices: mergeAll ? (diff?.devices.map((d) => d.individual_address) || []) : Array.from(selectedDevices),
        merge_parameters: paramItems,
        merge_ko_links: koItems,
        merge_all: mergeAll,
      }

      const summary = await mergeProjects(req)
      setMergeSummary(summary)

      // Re-run compare to reflect merged changes
      const updatedDiff = await compareProjects(compareProject)
      setDiff(updatedDiff)
      selectAllDiffs(updatedDiff)
    } catch (err: any) {
      setError(err.message || 'Fehler beim Zusammenführen der Projekte')
    } finally {
      setIsMerging(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-5xl h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-sky-500/20">
              <GitCompare className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                Projekt-Vergleich & Revisions-Diff
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20 font-semibold">
                  ETS ProjectCompare
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Vergleiche das aktive Projekt mit einem früheren Revisionsstand oder Backup und führe Änderungen selektiv zusammen.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Top Controls: Choose comparison source */}
        <div className="px-6 py-3 bg-slate-950/60 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4 shrink-0 text-xs">
          <div className="flex items-center gap-3">
            <span className="text-slate-400 font-medium">Vergleichen mit:</span>
            <div className="relative">
              <select
                value={selectedFilename}
                onChange={(e) => handleSelectProject(e.target.value)}
                disabled={isLoading}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 focus:outline-none focus:border-sky-500 text-xs pr-8"
              >
                <option value="">-- Gespeichertes Projekt / Backup wählen --</option>
                {availableProjects.map((p) => (
                  <option key={p.filename} value={p.filename}>
                    {p.name} ({new Date(p.modified_at).toLocaleDateString()})
                  </option>
                ))}
              </select>
            </div>

            <span className="text-slate-500 text-[11px]">oder</span>

            <label className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700/80 text-slate-300 rounded-lg border border-slate-700 cursor-pointer transition-colors">
              <Upload className="w-3.5 h-3.5" />
              <span>Projektdatei hochladen...</span>
              <input type="file" accept=".json" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>

          {diff && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => selectAllDiffs(diff)}
                className="px-2.5 py-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded text-[11px] transition-colors"
              >
                Alle auswählen
              </button>
              <button
                onClick={deselectAll}
                className="px-2.5 py-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded text-[11px] transition-colors"
              >
                Keine auswählen
              </button>
            </div>
          )}
        </div>

        {/* Feedback / Notification Banners */}
        {error && (
          <div className="px-6 py-2 bg-rose-500/10 border-b border-rose-500/20 text-rose-300 text-xs flex items-center gap-2 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {mergeSummary && (
          <div className="px-6 py-2 bg-emerald-500/10 border-b border-emerald-500/20 text-emerald-300 text-xs flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{mergeSummary.message}</span>
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <div className="flex-1 flex overflow-hidden">
          {isLoading ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-3">
              <RefreshCw className="w-8 h-8 animate-spin text-sky-400" />
              <p className="text-sm">Analysiere Projektunterschiede...</p>
            </div>
          ) : !diff ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 gap-3 p-8 text-center">
              <FolderOpen className="w-12 h-12 text-slate-600 stroke-1" />
              <h3 className="text-sm font-semibold text-slate-300">Kein Vergleichsprojekt ausgewählt</h3>
              <p className="text-xs max-w-md text-slate-500">
                Wähle oben ein vorhandenes Projekt oder lade eine Sicherung hoch, um Differenzen in Gruppenadressen, Geräten, Parametern und KO-Verknüpfungen granular zu vergleichen.
              </p>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Diff Summary Bar */}
              <div className="px-6 py-2.5 bg-slate-950/40 border-b border-slate-800 flex items-center justify-between text-xs">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-slate-200">
                    {diff.total_differences} Unterschiede gefunden
                  </span>
                  <span className="text-slate-500">•</span>
                  <span className="text-slate-400">
                    Basis: <strong className="text-slate-300">{diff.base_project_name}</strong>
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                  <span className="text-slate-400">
                    Vergleich: <strong className="text-sky-300">{diff.compare_project_name}</strong>
                  </span>
                </div>

                {/* Tabs */}
                <div className="flex items-center gap-1 bg-slate-800/80 p-0.5 rounded-lg border border-slate-700/60">
                  <button
                    onClick={() => setActiveTab('gas')}
                    className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                      activeTab === 'gas'
                        ? 'bg-sky-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Gruppenadressen ({diff.group_addresses.length})
                  </button>
                  <button
                    onClick={() => setActiveTab('devices')}
                    className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                      activeTab === 'devices'
                        ? 'bg-sky-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Geräte ({diff.devices.length})
                  </button>
                  <button
                    onClick={() => setActiveTab('parameters')}
                    className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                      activeTab === 'parameters'
                        ? 'bg-sky-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Parameter ({diff.parameters.length})
                  </button>
                  <button
                    onClick={() => setActiveTab('kos')}
                    className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                      activeTab === 'kos'
                        ? 'bg-sky-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    KO-Links ({diff.ko_links.length})
                  </button>
                </div>
              </div>

              {/* Tab Content List */}
              <div className="flex-1 overflow-y-auto p-6 space-y-2">
                {activeTab === 'gas' && (
                  <div className="space-y-1.5">
                    {diff.group_addresses.length === 0 ? (
                      <p className="text-xs text-slate-500 py-4 text-center">Keine Unterschiede bei Gruppenadressen.</p>
                    ) : (
                      diff.group_addresses.map((ga) => {
                        const isSelected = selectedGas.has(ga.address)
                        return (
                          <div
                            key={ga.address}
                            onClick={() => toggleGa(ga.address)}
                            className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                              isSelected
                                ? 'bg-slate-800/80 border-sky-500/50 shadow-sm'
                                : 'bg-slate-900/50 border-slate-800 hover:border-slate-700'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleGa(ga.address)}
                                className="w-4 h-4 rounded text-sky-500 bg-slate-950 border-slate-700 focus:ring-0"
                              />
                              <span className="font-mono text-xs font-bold text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded border border-sky-500/20">
                                {ga.address}
                              </span>
                              <div className="flex flex-col">
                                <span className="text-xs font-medium text-slate-200">
                                  {ga.name_compare || ga.name_base}
                                </span>
                                {ga.name_base && ga.name_compare && ga.name_base !== ga.name_compare && (
                                  <span className="text-[10px] text-slate-400 line-through">
                                    {ga.name_base}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-3">
                              <span className="text-[10px] font-mono text-slate-400">
                                {ga.dpt_compare || ga.dpt_base || '1.001'}
                              </span>
                              <span
                                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                                  ga.status === 'Added'
                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                    : ga.status === 'Deleted'
                                    ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                    : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                }`}
                              >
                                {ga.status === 'Added' && <Plus className="w-3 h-3" />}
                                {ga.status === 'Deleted' && <Trash2 className="w-3 h-3" />}
                                {ga.status === 'Modified' && <Edit2 className="w-3 h-3" />}
                                {ga.status === 'Added' ? 'Neu' : ga.status === 'Deleted' ? 'Entfernt' : 'Geändert'}
                              </span>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                )}

                {activeTab === 'devices' && (
                  <div className="space-y-1.5">
                    {diff.devices.length === 0 ? (
                      <p className="text-xs text-slate-500 py-4 text-center">Keine Unterschiede bei Geräten.</p>
                    ) : (
                      diff.devices.map((dev) => {
                        const isSelected = selectedDevices.has(dev.individual_address)
                        return (
                          <div
                            key={dev.individual_address}
                            onClick={() => toggleDevice(dev.individual_address)}
                            className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                              isSelected
                                ? 'bg-slate-800/80 border-sky-500/50 shadow-sm'
                                : 'bg-slate-900/50 border-slate-800 hover:border-slate-700'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleDevice(dev.individual_address)}
                                className="w-4 h-4 rounded text-sky-500 bg-slate-950 border-slate-700 focus:ring-0"
                              />
                              <span className="font-mono text-xs font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                                {dev.individual_address}
                              </span>
                              <div className="flex flex-col">
                                <span className="text-xs font-medium text-slate-200">
                                  {dev.name_compare || dev.name_base}
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  {dev.model_compare || dev.model_base}
                                </span>
                              </div>
                            </div>

                            <span
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                                dev.status === 'Added'
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                  : dev.status === 'Deleted'
                                  ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                              }`}
                            >
                              {dev.status === 'Added' ? 'Neu' : dev.status === 'Deleted' ? 'Entfernt' : 'Geändert'}
                            </span>
                          </div>
                        )
                      })
                    )}
                  </div>
                )}

                {activeTab === 'parameters' && (
                  <div className="space-y-1.5">
                    {diff.parameters.length === 0 ? (
                      <p className="text-xs text-slate-500 py-4 text-center">Keine abweichenden Parameterwerte.</p>
                    ) : (
                      diff.parameters.map((p) => {
                        const key = `${p.device_address}:${p.param_id}`
                        const isSelected = selectedParams.has(key)
                        return (
                          <div
                            key={key}
                            onClick={() => toggleParam(key)}
                            className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                              isSelected
                                ? 'bg-slate-800/80 border-sky-500/50 shadow-sm'
                                : 'bg-slate-900/50 border-slate-800 hover:border-slate-700'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleParam(key)}
                                className="w-4 h-4 rounded text-sky-500 bg-slate-950 border-slate-700 focus:ring-0"
                              />
                              <div className="flex flex-col">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-[11px] text-slate-400">{p.device_address}</span>
                                  <span className="text-xs font-semibold text-slate-200">{p.param_name}</span>
                                </div>
                                <span className="text-[10px] text-slate-500 font-mono">{p.param_id}</span>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 text-xs font-mono">
                              <span className="px-2 py-0.5 rounded bg-slate-950 text-slate-400 border border-slate-800">
                                {p.value_base || '(leer)'}
                              </span>
                              <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                              <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 font-bold">
                                {p.value_compare || '(leer)'}
                              </span>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                )}

                {activeTab === 'kos' && (
                  <div className="space-y-1.5">
                    {diff.ko_links.length === 0 ? (
                      <p className="text-xs text-slate-500 py-4 text-center">Keine geänderten KO-Verknüpfungen.</p>
                    ) : (
                      diff.ko_links.map((k) => {
                        const key = `${k.device_address}:${k.ko_number}`
                        const isSelected = selectedKos.has(key)
                        return (
                          <div
                            key={key}
                            onClick={() => toggleKo(key)}
                            className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                              isSelected
                                ? 'bg-slate-800/80 border-sky-500/50 shadow-sm'
                                : 'bg-slate-900/50 border-slate-800 hover:border-slate-700'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleKo(key)}
                                className="w-4 h-4 rounded text-sky-500 bg-slate-950 border-slate-700 focus:ring-0"
                              />
                              <div className="flex flex-col">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-[11px] text-slate-400">{k.device_address}</span>
                                  <span className="text-xs font-semibold text-slate-200">{k.ko_name}</span>
                                </div>
                                <span className="text-[10px] text-slate-500 font-mono">KO #{k.ko_number}</span>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 text-xs font-mono">
                              <span className="px-2 py-0.5 rounded bg-slate-950 text-slate-400 border border-slate-800">
                                {k.gas_base.join(', ') || 'Keine GA'}
                              </span>
                              <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                              <span className="px-2 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/20 font-bold">
                                {k.gas_compare.join(', ') || 'Keine GA'}
                              </span>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-900/90 flex items-center justify-between shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            Schließen
          </button>

          {diff && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleMerge(false)}
                disabled={isMerging || (selectedGas.size === 0 && selectedDevices.size === 0 && selectedParams.size === 0 && selectedKos.size === 0)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white shadow-lg shadow-sky-600/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isMerging ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                <span>Ausgewählte Differenzen übernehmen</span>
              </button>

              <button
                onClick={() => handleMerge(true)}
                disabled={isMerging}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20 transition-all disabled:opacity-50"
              >
                <span>Alles zusammenführen (Merge All)</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
