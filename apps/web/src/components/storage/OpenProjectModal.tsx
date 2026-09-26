import React, { useState, useEffect } from 'react'
import {
  FolderOpen,
  X,
  Plus,
  Calendar,
  Layers,
  Cpu,
  CheckCircle2,
  HardDrive,
  Loader2,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react'
import { ProjectMetadata } from '../../types/storage'
import {
  listStorageProjects,
  loadStorageProject,
  createStorageProject,
} from '../../services/api'
import { Project } from '../../types/knx'
import { useTranslation } from '../../i18n/I18nContext'

interface OpenProjectModalProps {
  isOpen: boolean
  onClose: () => void
  activeProjectName: string | null
  onProjectLoaded: (project: Project) => void
}

export const OpenProjectModal: React.FC<OpenProjectModalProps> = ({
  isOpen,
  onClose,
  activeProjectName,
  onProjectLoaded,
}) => {
  const { t } = useTranslation()
  const [projects, setProjects] = useState<ProjectMetadata[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingProjectName, setLoadingProjectName] = useState<string | null>(null)

  // New project creation state
  const [isCreatingNew, setIsCreatingNew] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')

  const fetchList = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const list = await listStorageProjects()
      setProjects(list)
    } catch (err: any) {
      setError(err?.message || 'Fehler beim Laden der Projektliste')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      fetchList()
      setIsCreatingNew(false)
      setNewProjectName('')
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleSelect = async (name: string) => {
    setLoadingProjectName(name)
    setError(null)
    try {
      const loaded = await loadStorageProject(name)
      onProjectLoaded(loaded)
      onClose()
    } catch (err: any) {
      setError(err?.message || `Fehler beim Laden von ${name}`)
    } finally {
      setLoadingProjectName(null)
    }
  }

  const handleCreate = async () => {
    const trimmed = newProjectName.trim()
    if (!trimmed) return
    setIsLoading(true)
    setError(null)
    try {
      const created = await createStorageProject(trimmed)
      onProjectLoaded(created)
      onClose()
    } catch (err: any) {
      setError(err?.message || 'Fehler beim Erstellen des neuen Projekts')
      setIsLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100 max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-900/30 text-white">
              <FolderOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <span>{t('storage.openProjectTitle')}</span>
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  ~/.konfix/projects
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                {t('storage.openProjectSubtitle')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="px-6 py-3 bg-red-950/40 border-b border-red-500/40 flex items-center gap-2 text-xs text-red-300">
            <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Action Bar: Create New Project Toggle */}
        <div className="px-6 py-3 border-b border-slate-800/80 bg-slate-950/30 flex items-center justify-between shrink-0">
          <span className="text-xs text-slate-400 font-medium">
            {projects.length} {projects.length === 1 ? 'Projekt' : 'Projekte'}
          </span>
          <button
            onClick={() => setIsCreatingNew(!isCreatingNew)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t('storage.newProject')}</span>
          </button>
        </div>

        {/* Create New Project Form (Collapsible) */}
        {isCreatingNew && (
          <div className="px-6 py-4 bg-slate-950/60 border-b border-slate-800 space-y-3 animate-in slide-in-from-top-2 duration-150 shrink-0">
            <div className="text-xs font-semibold text-slate-200">
              {t('storage.newProject')}:
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder={t('storage.newProjectPlaceholder')}
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                autoFocus
                className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              />
              <button
                onClick={handleCreate}
                disabled={!newProjectName.trim() || isLoading}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all"
              >
                <span>{t('common.create')}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Project List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-2.5">
          {isLoading && projects.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-slate-500 space-y-2">
              <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
              <span className="text-xs">{t('common.loading')}</span>
            </div>
          ) : projects.length === 0 ? (
            <div className="py-12 text-center text-slate-400 space-y-3">
              <HardDrive className="w-10 h-10 text-slate-600 mx-auto" />
              <div className="text-sm font-semibold text-slate-300">
                {t('storage.noProjectsFound')}
              </div>
            </div>
          ) : (
            projects.map((proj) => {
              const isActive =
                activeProjectName?.toLowerCase() === proj.name.toLowerCase()
              const isOpening = loadingProjectName === proj.name

              return (
                <div
                  key={proj.filename}
                  onClick={() => !isOpening && handleSelect(proj.name)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer flex items-center justify-between group ${
                    isActive
                      ? 'bg-emerald-950/30 border-emerald-500/50 shadow-sm'
                      : 'bg-slate-950/40 hover:bg-slate-800/60 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-100 group-hover:text-emerald-400 transition-colors">
                        {proj.name}
                      </span>
                      {isActive && (
                        <span className="text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Aktiv</span>
                        </span>
                      )}
                      <span className="text-[10px] text-slate-500 font-mono">
                        {(proj.size_bytes / 1024).toFixed(1)} KB
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-xs text-slate-400">
                      <span className="flex items-center gap-1">
                        <Layers className="w-3.5 h-3.5 text-emerald-400" />
                        <span>{proj.ga_count} GAs</span>
                      </span>
                      <span className="text-slate-700">•</span>
                      <span className="flex items-center gap-1">
                        <Cpu className="w-3.5 h-3.5 text-sky-400" />
                        <span>{proj.device_count} Geräte</span>
                      </span>
                      <span className="text-slate-700">•</span>
                      <span className="flex items-center gap-1 text-[11px] text-slate-500">
                        <Calendar className="w-3 h-3" />
                        <span>{new Date(proj.modified_at).toLocaleString('de-DE')}</span>
                      </span>
                    </div>
                  </div>

                  <button
                    disabled={isOpening}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                      isActive
                        ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/30'
                        : 'bg-slate-800 group-hover:bg-emerald-600 text-slate-300 group-hover:text-white'
                    }`}
                  >
                    {isOpening ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>{t('common.loading')}</span>
                      </>
                    ) : (
                      <>
                        <span>{isActive ? 'Reload' : t('header.openProject').split(' ')[0]}</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/40 flex items-center justify-between shrink-0 text-xs text-slate-400">
          <span className="text-[11px] text-slate-500">
            Strg + S
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-slate-100 hover:bg-slate-800 transition-colors"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
